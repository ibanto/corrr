import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { hash, verify } from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { Resend } from 'resend';
import { randomBytes } from 'crypto';

/**
 * Genera un token criptográficamente seguro para email verification / reset
 * de password. Sustituye al patrón `Math.random().toString(36)` que NO es
 * seguro frente a predicción (Math.random comparte estado entre llamadas y
 * un atacante con un token expuesto podría aproximar el siguiente).
 * 32 bytes = 256 bits → ~10^77 espacios, imposible de adivinar.
 */
function secureToken(): string {
  return randomBytes(32).toString('hex');
}

dotenv.config();

// bodyLimit por defecto en Fastify es 1MB → demasiado pequeño para subir
// avatares como data URI base64 (una foto de móvil pesa ~150-500KB y base64
// añade ~33% encima). Subimos a 10MB para que quepan fotos sin compresión
// agresiva.
//
// trustProxy es CLAVE detrás de Railway: sin esto, req.ip devuelve la IP del
// proxy de Railway (la misma para TODOS los clientes) → el rate-limit global
// de 200/min se quemaba entre varios usuarios y caían en cascada. Con
// trustProxy: true, Fastify lee X-Forwarded-For y obtiene la IP real del
// móvil del usuario. Cada usuario tiene su propia cuota.
const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024, trustProxy: true });

const STRAVA_CLIENT_ID     = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const RAILWAY_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : (process.env.RAILWAY_URL ?? 'http://localhost:3000');
const db = new Pool({ connectionString: process.env.DATABASE_URL });
// JWT_ACCESS_SECRET sí o sí debe existir: sin él, TextEncoder().encode(undefined)
// produciría un secret literal "undefined" → cualquiera podría forjar tokens.
// Si es corto pero existe, avisamos (warning, no fail) para no romper deploys
// con secrets ya en producción.
if (!process.env.JWT_ACCESS_SECRET) {
  console.error('[FATAL] JWT_ACCESS_SECRET missing. Set it in Railway env vars.');
  process.exit(1);
}
if (process.env.JWT_ACCESS_SECRET.length < 32) {
  console.warn('[WARN] JWT_ACCESS_SECRET is shorter than 32 chars. Consider rotating to a 32+ char random value.');
}
const SECRET = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET);
const resend = new Resend(process.env.RESEND_API_KEY || '');

app.register(cors, { origin: '*' });

// Rate limiting global con override más estricto en endpoints sensibles
// (login / forgot-password / reset-password) para mitigar brute force y spam
// de emails. Sin esto, un atacante podía probar passwords sin límite o
// quemarnos la cuota de Resend mandando reset emails en bucle.
//
// Defaults globales: 200 req/min por IP (suficiente para uso normal —
// la app puede hacer ráfagas al arrancar). Endpoints sensibles fijan su
// propio config en el `preHandler`.
app.register(rateLimit, {
  global: true,
  // 500/min por IP global — un cliente al arrancar la app hace ~10 requests
  // (zonas, celdas, perfil, stats, taunts, achievements, friends, etc) +
  // saveRun + recargas tras carrera. 500/min deja margen amplio sin perder
  // protección contra scripts abusivos.
  max: 500,
  timeWindow: '1 minute',
  errorResponseBuilder: (_req, ctx) => ({
    error: 'Demasiadas peticiones, prueba en unos segundos',
    retryAfter: ctx.after,
  }),
});

async function initDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      distance_km FLOAT NOT NULL DEFAULT 0,
      duration_secs INT NOT NULL DEFAULT 0,
      points INT NOT NULL DEFAULT 0,
      zones_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS distance_km FLOAT DEFAULT 0`);
  await db.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS duration_secs INT DEFAULT 0`);
  await db.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS points INT DEFAULT 0`);
  await db.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS zones_count INT DEFAULT 0`);
  await db.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
  await db.query(`ALTER TABLE runs ALTER COLUMN started_at SET DEFAULT NOW()`).catch(() => {});
  // Idempotencia para imports de Strava: si el webhook reenvía el mismo evento
  // (Strava reintenta hasta 3 veces ante 5xx) o un retry manual de admin
  // dispara el import dos veces, evitamos crear runs duplicados consultando
  // este campo + UNIQUE.
  await db.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS strava_activity_id BIGINT`).catch(() => {});
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS runs_strava_activity_id_uniq ON runs(strava_activity_id) WHERE strava_activity_id IS NOT NULL`).catch(() => {});

  await db.query(`ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS total_points INT DEFAULT 0`);
  await db.query(`ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS total_km FLOAT DEFAULT 0`);
  await db.query(`ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS total_runs INT DEFAULT 0`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS zones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
      run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
      polygon JSONB NOT NULL,
      area_km2 FLOAT DEFAULT 0,
      points INT DEFAULT 0,
      center_lat FLOAT,
      center_lng FLOAT,
      conquered_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS zones_owner_idx ON zones(owner_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS zones_center_idx ON zones(center_lat, center_lng)`);

  // Friendships
  await db.query(`
    CREATE TABLE IF NOT EXISTS friendships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
      receiver_id UUID REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(sender_id, receiver_id)
    )
  `);

  // Challenges
  await db.query(`
    CREATE TABLE IF NOT EXISTS challenges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'shape',
      icon TEXT DEFAULT '⭐',
      progress_default INT DEFAULT 0,
      total INT NOT NULL DEFAULT 1,
      reward INT NOT NULL DEFAULT 100,
      difficulty INT DEFAULT 1,
      category TEXT DEFAULT 'semanales',
      starts_at TIMESTAMPTZ DEFAULT NOW(),
      ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE challenges ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'semanales'`);

  // Push tokens + avatar
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`);

  // Strava tokens
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS strava_athlete_id BIGINT`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS strava_access_token TEXT`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS strava_refresh_token TEXT`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS strava_token_expires_at BIGINT`);
  await db.query(`CREATE INDEX IF NOT EXISTS users_strava_idx ON users(strava_athlete_id)`).catch(() => {});
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_unique ON users(LOWER(display_name))`).catch(() => {});
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT`).catch(() => {});
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ`).catch(() => {});
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE`).catch(() => {});
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token TEXT`).catch(() => {});

  // ── Profile fields (v1.9 — formulario "Editar perfil" del usuario) ─────────
  // Datos del corredor que rellena en su perfil. Al completarse todos los
  // campos requeridos se otorga un bonus único (controlado con profile_bonus_claimed).
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT`).catch(() => {});
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS surname TEXT`).catch(() => {});
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS war_cry TEXT`).catch(() => {});
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS shoe_brand TEXT`).catch(() => {});
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS shoe_brand_other TEXT`).catch(() => {});
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_year INT`).catch(() => {});
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT`).catch(() => {}); // 'M' | 'F' | 'O'
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS usual_distance TEXT`).catch(() => {}); // '1-3' | '3-5' | '5-10' | '10+'
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_frequency TEXT`).catch(() => {}); // '1-2' | '3-4' | '5+'
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_bonus_claimed BOOLEAN DEFAULT FALSE`).catch(() => {});

  // Track stolen zones in user_stats
  await db.query(`ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS total_steals INT DEFAULT 0`).catch(() => {});
  // bonus_xp se suma al XP calculado desde puntos (XP = floor(points/100) + bonus_xp).
  // Permite dar XP "directo" sin tener que sumar 100 pts por cada XP. Usado por
  // el bonus de completar perfil: +50 pts + 10 bonus_xp.
  await db.query(`ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS bonus_xp INT DEFAULT 0`).catch(() => {});

  // ── Taunts (chat-with-emotes between rivals) ───────────────────────────────
  // Three "modes" of entry:
  //   - 'robo_notif': system-generated when someone steals from you. No taunt_id.
  //   - 'taunt':      first message from the victim back to the thief (1-10).
  //   - 'response':   any subsequent reply (also 1-10, from the response set).
  await db.query(`
    CREATE TABLE IF NOT EXISTS taunts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      from_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      taunt_id INT,
      run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS taunts_to_unread_idx ON taunts(to_user_id, read_at) WHERE read_at IS NULL`).catch(() => {});

  // ── Points engine state (v1.7 economy) ─────────────────────────────────────
  // last_run_date + streak_days power the "carrera 3 días seguidos = ×1.5" bonus.
  // best_daily_km: pese al nombre, almacena la MEJOR DISTANCIA DE UNA SOLA
  // CARRERA (no la suma diaria). El multiplicador PB ×1.2 se aplica cuando la
  // carrera supera ese récord. NO renombramos la columna en producción (datos
  // vivos) para evitar una migración arriesgada; el nombre se mantiene por
  // compatibilidad pero la semántica real es "best_single_run_km".
  await db.query(`ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS last_run_date DATE`).catch(() => {});
  await db.query(`ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS streak_days INT DEFAULT 0`).catch(() => {});
  await db.query(`ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS best_daily_km FLOAT DEFAULT 0`).catch(() => {});

  // ── Índices de rendimiento (rankings) ──────────────────────────────────────
  // /ranking/global, /city y /cities ordenan por total_points DESC. Sin índice,
  // Postgres ordena TODA la tabla en cada request. Con el índice DESC puede
  // leerlo ya ordenado y cortar en LIMIT 100. user_id ya tiene unique/PK (el
  // INSERT sin ON CONFLICT no genera duplicados), así que no hace falta tocarlo.
  await db.query(`CREATE INDEX IF NOT EXISTS user_stats_total_points_idx ON user_stats(total_points DESC)`).catch(() => {});
  // /ranking/city filtra y /cities agrupa por LOWER(city). Índice funcional.
  await db.query(`CREATE INDEX IF NOT EXISTS users_city_lower_idx ON users(LOWER(city))`).catch(() => {});

  // ── Cells (grid-based territory, v2 model) ─────────────────────────────────
  // 10m × 10m cells (v1.8.0 — was 5m before). Identified by integer (cell_x,
  // cell_y) computed from lat/lng. Coexists with the polygon `zones` table
  // during the v1 → v2 transition.
  //
  // One-time migration: drop the 5m-cell data when the cell size changed. The
  // marker table prevents the drop from re-running on every restart. Safe to
  // remove this whole block in a follow-up deploy once everyone is on 10m.
  const { rows: alreadyMigrated } = await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'cells_v1_8_migrated'`
  ).catch(() => ({ rows: [] }));
  if (alreadyMigrated.length === 0) {
    await db.query(`DROP TABLE IF EXISTS cells CASCADE`).catch(() => {});
    await db.query(`CREATE TABLE IF NOT EXISTS cells_v1_8_migrated (created_at TIMESTAMPTZ DEFAULT NOW())`).catch(() => {});
    await db.query(`UPDATE user_stats SET total_cells = 0`).catch(() => {});
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS cells (
      cell_x INT NOT NULL,
      cell_y INT NOT NULL,
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
      claimed_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (cell_x, cell_y)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS cells_owner_idx ON cells(owner_id)`);
  // Range queries on (cell_x, cell_y) for viewport loads use the PK B-tree.
  await db.query(`ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS total_cells INT DEFAULT 0`).catch(() => {});

  // Achievements unlocked per user
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_achievements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      achievement_key TEXT NOT NULL,
      unlocked_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, achievement_key)
    )
  `);

  // Activar Row Level Security en todas las tablas (bloquea acceso directo vía Supabase API)
  for (const table of ['users', 'user_stats', 'runs', 'zones']) {
    await db.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`).catch(() => {});
  }
}

/** Envía una push notification via Expo Push Service. */
async function sendPushNotification(pushToken: string, title: string, body: string) {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: pushToken,
        sound: 'default',
        title,
        body,
        channelId: 'zones',
      }),
    });
  } catch (e) {
    console.error('[Push] Error:', e);
  }
}

/** Envía un email SIN bloquear la respuesta (fire-and-forget). Antes cada
 *  `await resend.emails.send(...)` añadía ~300-800ms a lo que esperaba el
 *  usuario en registro / reset / Strava. Resend ya es "best-effort" (si el
 *  email falla, el flujo no debe romperse), así que disparamos en background
 *  y logueamos el error. El usuario recibe su respuesta al instante.
 *  Nota: cuando crezca el volumen, migrar a una cola real (BullMQ) con
 *  reintentos — ver backlog de escalabilidad. */
function sendEmail(payload: { from: string; to: string; subject: string; html: string }) {
  resend.emails.send(payload).catch((emailErr) => {
    console.error('[Email] Error enviando a', payload.to, ':', emailErr);
  });
}

const requireAuth = async (req: any, reply: any) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return reply.status(401).send({ error: 'No autorizado' });
  try {
    const { payload } = await jwtVerify(auth.slice(7), SECRET);
    req.userId = payload.sub as string;
  } catch {
    return reply.status(401).send({ error: 'Token inválido' });
  }
};

// ── Auth ──────────────────────────────────────────────────────────────────────

app.get('/health', async (req, reply) => {
  try { await db.query('SELECT 1'); } catch (err) { return reply.status(503).send({ ok: false, error: String(err) }); }
  return reply.send({ ok: true, ts: Date.now() });
});

app.post('/auth/register', {
  // 5 registros/hora por IP — evita spam de signups (que mandan email).
  config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
}, async (req: any, reply) => {
  const { email, password, displayName, city } = req.body ?? {};
  // Validación de inputs (defense in depth — el frontend también valida).
  // Antes no había checks → email vacío, password '' o displayName null
  // podían crear cuentas inválidas.
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return reply.status(400).send({ error: 'Email no válido' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return reply.status(400).send({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }
  if (typeof displayName !== 'string' || displayName.trim().length < 2 || displayName.length > 32) {
    return reply.status(400).send({ error: 'El nombre de usuario debe tener entre 2 y 32 caracteres' });
  }
  try {
    const ex = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (ex.rows.length) return reply.status(400).send({ error: 'Email ya registrado' });
    // Comprobar nombre de usuario único (case-insensitive)
    const nameCheck = await db.query('SELECT id FROM users WHERE LOWER(display_name) = LOWER($1)', [displayName]);
    if (nameCheck.rows.length) return reply.status(400).send({ error: 'Ese nombre de usuario ya está en uso' });
    const ph = await hash(password);
    const { rows } = await db.query(
      'INSERT INTO users (email, password_hash, display_name, city) VALUES ($1,$2,$3,$4) RETURNING id',
      [email, ph, displayName, city]
    );
    const uid = rows[0].id;
    await db.query('INSERT INTO user_stats (user_id) VALUES ($1)', [uid]);

    // Enviar email de verificación
    const verifyToken = secureToken();
    await db.query('UPDATE users SET verify_token = $1 WHERE id = $2', [verifyToken, uid]);
    const verifyUrl = `${RAILWAY_URL}/auth/verify-email?token=${verifyToken}`;
    try {
      sendEmail({
        from: 'CORRR <hola@corrr.es>',
        to: email,
        subject: 'Verifica tu email — CORRR',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0A0A0A;padding:32px;border-radius:12px;">
            <div style="text-align:center;margin-bottom:16px;"><img src="https://ibanto.github.io/corrr/logo.png" alt="CORRR" style="width:140px;"></div>
            <p style="color:#fff;font-size:16px;">Hola ${displayName},</p>
            <p style="color:#ccc;font-size:14px;">Bienvenido a CORRR. Verifica tu email para activar todas las funciones:</p>
            <div style="text-align:center;margin:24px 0;">
              <a href="${verifyUrl}" style="background:#FF6600;color:#fff;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:bold;font-size:16px;">Verificar email</a>
            </div>
            <p style="color:#888;font-size:12px;">Si no has creado esta cuenta, ignora este email.</p>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error('[Email] Error enviando verificación:', emailErr);
    }

    // No devolver token — el usuario debe verificar su email primero
    return reply.status(201).send({ pendingVerification: true, message: 'Revisa tu email para verificar tu cuenta' });
  } catch (err) { return reply.status(500).send({ error: String(err) }); }
});

app.post('/auth/login', {
  // 10 intentos/minuto por IP. Frena brute force sin molestar a usuario
  // honesto que se equivoque escribiendo la contraseña.
  config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
}, async (req: any, reply) => {
  const { email, password } = req.body;
  try {
    const { rows } = await db.query('SELECT id, password_hash, display_name, email, city, email_verified FROM users WHERE email = $1', [email]);
    if (!rows.length) return reply.status(401).send({ error: 'Credenciales incorrectas' });
    const valid = await verify(rows[0].password_hash, password);
    if (!valid) return reply.status(401).send({ error: 'Credenciales incorrectas' });
    const u = rows[0];
    if (!u.email_verified) {
      return reply.status(403).send({ error: 'Email no verificado', pendingVerification: true });
    }
    const token = await new SignJWT({ sub: u.id })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .sign(SECRET);
    return reply.send({ accessToken: token, user: { id: u.id, username: u.display_name, email: u.email, city: u.city } });
  } catch (err) { return reply.status(500).send({ error: String(err) }); }
});

app.post('/auth/google', async (req: any, reply) => {
  const { idToken } = req.body;
  if (!idToken) return reply.status(400).send({ error: 'idToken requerido' });
  try {
    // Verificar el token de Google
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
    if (!googleRes.ok) return reply.status(401).send({ error: 'Token de Google inválido' });
    const gUser: any = await googleRes.json();

    const googleId = gUser.sub;
    const email = gUser.email;
    const name = gUser.name || email.split('@')[0];

    // Buscar usuario existente por google_id o email
    let { rows } = await db.query(
      'SELECT id FROM users WHERE google_id = $1 OR email = $2 LIMIT 1',
      [googleId, email]
    );

    let userId: string;
    if (rows.length) {
      userId = rows[0].id;
      // Actualizar google_id si no lo tenía
      await db.query('UPDATE users SET google_id = $1 WHERE id = $2 AND google_id IS NULL', [googleId, userId]);
    } else {
      // Crear usuario nuevo (sin password)
      const res = await db.query(
        'INSERT INTO users (email, display_name, google_id) VALUES ($1,$2,$3) RETURNING id',
        [email, name, googleId]
      );
      userId = res.rows[0].id;
      await db.query('INSERT INTO user_stats (user_id) VALUES ($1)', [userId]);
    }

    // Obtener datos completos del usuario
    const userRow = await db.query('SELECT id, email, display_name, city FROM users WHERE id = $1', [userId]);
    const u = userRow.rows[0];

    const token = await new SignJWT({ sub: userId })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .sign(SECRET);

    return reply.send({
      accessToken: token,
      user: { id: u.id, username: u.display_name, email: u.email, city: u.city },
    });
  } catch (err) { return reply.status(500).send({ error: String(err) }); }
});

// ── Recuperar contraseña ─────────────────────────────────────────────────────

app.post('/auth/forgot-password', {
  // 3/hora por IP — evita spam de emails de reset (quema cuota de Resend).
  config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
}, async (req: any, reply) => {
  const { email } = req.body;
  if (!email) return reply.status(400).send({ error: 'Email requerido' });
  try {
    const { rows } = await db.query('SELECT id, display_name FROM users WHERE email = $1', [email]);
    if (!rows.length) {
      // No revelar si el email existe o no
      return reply.send({ ok: true });
    }
    const userId = rows[0].id;
    const name = rows[0].display_name || 'Corredor';
    // Generar token aleatorio
    const resetToken = secureToken();
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
    await db.query('UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3', [resetToken, expires, userId]);

    // Enviar email
    const resetUrl = `${RAILWAY_URL}/auth/reset-password?token=${resetToken}`;
    try {
      sendEmail({
        from: 'CORRR <hola@corrr.es>',
        to: email,
        subject: 'Restablecer tu contraseña — CORRR',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0A0A0A;padding:32px;border-radius:12px;">
            <h1 style="color:#FF6600;text-align:center;font-size:28px;letter-spacing:3px;">CORRR</h1>
            <p style="color:#fff;font-size:16px;">Hola ${name},</p>
            <p style="color:#ccc;font-size:14px;">Has solicitado restablecer tu contraseña. Haz clic en el botón para crear una nueva:</p>
            <div style="text-align:center;margin:24px 0;">
              <a href="${resetUrl}" style="background:#FF6600;color:#fff;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:bold;font-size:16px;">Restablecer contraseña</a>
            </div>
            <p style="color:#888;font-size:12px;">Este enlace expira en 1 hora. Si no has sido tú, ignora este email.</p>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error('[Email] Error enviando reset:', emailErr);
    }

    return reply.send({ ok: true });
  } catch (err) { return reply.status(500).send({ error: String(err) }); }
});

// Página web para resetear contraseña (el usuario abre el enlace del email)
app.get('/auth/reset-password', async (req: any, reply) => {
  const { token } = req.query;
  reply.type('text/html').send(`
    <!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>CORRR — Nueva contraseña</title>
    <style>body{font-family:sans-serif;background:#0A0A0A;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;}
    .box{max-width:400px;width:90%;padding:32px;text-align:center;}
    h1{color:#FF6600;letter-spacing:3px;}input{width:100%;padding:14px;border-radius:8px;border:1px solid #333;background:#1a1a1a;color:#fff;font-size:16px;margin:8px 0;box-sizing:border-box;}
    button{width:100%;padding:16px;border-radius:50px;border:none;background:#FF6600;color:#fff;font-size:16px;font-weight:bold;cursor:pointer;margin-top:16px;}
    .msg{margin-top:16px;font-size:14px;}</style></head><body>
    <div class="box"><h1>CORRR</h1><p>Introduce tu nueva contraseña</p>
    <input type="password" id="pw" placeholder="Nueva contraseña" />
    <input type="password" id="pw2" placeholder="Repetir contraseña" />
    <button onclick="doReset()">Cambiar contraseña</button>
    <p class="msg" id="msg"></p></div>
    <script>async function doReset(){const pw=document.getElementById('pw').value;const pw2=document.getElementById('pw2').value;
    if(!pw||pw.length<6){document.getElementById('msg').textContent='Mínimo 6 caracteres';return;}
    if(pw!==pw2){document.getElementById('msg').textContent='Las contraseñas no coinciden';return;}
    const r=await fetch('/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'${token}',password:pw})});
    const d=await r.json();document.getElementById('msg').textContent=d.ok?'✅ Contraseña cambiada. Ya puedes abrir CORRR.':d.error||'Error';}</script></body></html>
  `);
});

app.post('/auth/reset-password', {
  // 10/hora por IP — el reset token ya hace heavy lifting de seguridad,
  // pero limitamos para evitar fuerza bruta sobre el token (32 bytes hex,
  // imposible de adivinar pero defensa en profundidad nunca está de más).
  config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
}, async (req: any, reply) => {
  const { token, password } = req.body;
  if (!token || !password) return reply.status(400).send({ error: 'Datos incompletos' });
  if (password.length < 6) return reply.status(400).send({ error: 'Mínimo 6 caracteres' });
  try {
    const { rows } = await db.query('SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()', [token]);
    if (!rows.length) return reply.status(400).send({ error: 'Enlace inválido o expirado' });
    const ph = await hash(password);
    await db.query('UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2', [ph, rows[0].id]);
    return reply.send({ ok: true });
  } catch (err) { return reply.status(500).send({ error: String(err) }); }
});

// ── Check username disponible ───────────────────────────────────────────────

app.get('/auth/check-username', async (req: any, reply) => {
  const { username } = req.query;
  if (!username || username.length < 3) return reply.send({ available: false, reason: 'Mínimo 3 caracteres' });
  if (username.length > 20) return reply.send({ available: false, reason: 'Máximo 20 caracteres' });
  if (!/^[a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ]+$/.test(username)) return reply.send({ available: false, reason: 'Solo letras, números y _' });
  try {
    const { rows } = await db.query('SELECT id FROM users WHERE LOWER(display_name) = LOWER($1)', [username]);
    return reply.send({ available: rows.length === 0 });
  } catch (err) { return reply.status(500).send({ error: String(err) }); }
});

// ── Reenviar verificación ──────────────────────────────────────────────────

app.post('/auth/resend-verification', {
  // 3/hora — el usuario que se acaba de registrar probablemente no necesita
  // reenviar más de un par de veces.
  config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
}, async (req: any, reply) => {
  const { email } = req.body;
  if (!email) return reply.status(400).send({ error: 'Email requerido' });
  try {
    const { rows } = await db.query('SELECT id, display_name, email_verified FROM users WHERE email = $1', [email]);
    if (!rows.length) return reply.send({ ok: true }); // No revelar si existe
    if (rows[0].email_verified) return reply.send({ ok: true, alreadyVerified: true });
    const verifyToken = secureToken();
    await db.query('UPDATE users SET verify_token = $1 WHERE id = $2', [verifyToken, rows[0].id]);
    const verifyUrl = `${RAILWAY_URL}/auth/verify-email?token=${verifyToken}`;
    try {
      sendEmail({
        from: 'CORRR <hola@corrr.es>',
        to: email,
        subject: 'Verifica tu email — CORRR',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0A0A0A;padding:32px;border-radius:12px;">
            <div style="text-align:center;margin-bottom:16px;"><img src="https://ibanto.github.io/corrr/logo.png" alt="CORRR" style="width:140px;"></div>
            <p style="color:#fff;font-size:16px;">Hola ${rows[0].display_name},</p>
            <p style="color:#ccc;font-size:14px;">Verifica tu email para acceder a CORRR:</p>
            <div style="text-align:center;margin:24px 0;">
              <a href="${verifyUrl}" style="background:#FF6600;color:#fff;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:bold;font-size:16px;">Verificar email</a>
            </div>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error('[Email] Error reenviando verificación:', emailErr);
    }
    return reply.send({ ok: true });
  } catch (err) { return reply.status(500).send({ error: String(err) }); }
});

// ── Verificación de email ───────────────────────────────────────────────────

app.get('/auth/verify-email', async (req: any, reply) => {
  const { token } = req.query;
  try {
    const { rows } = await db.query('SELECT id FROM users WHERE verify_token = $1', [token]);
    if (!rows.length) {
      reply.type('text/html').send('<html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;background:#0A0A0A;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;"><div style="text-align:center;"><img src="https://ibanto.github.io/corrr/logo.png" alt="CORRR" style="width:180px;margin-bottom:24px;"><p>Enlace inválido o ya verificado.</p></div></body></html>');
      return;
    }
    await db.query('UPDATE users SET email_verified = TRUE, verify_token = NULL WHERE id = $1', [rows[0].id]);
    reply.type('text/html').send('<html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;background:#0A0A0A;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;"><div style="text-align:center;"><img src="https://ibanto.github.io/corrr/logo.png" alt="CORRR" style="width:180px;margin-bottom:24px;"><p style="font-size:24px;">✅ Email verificado</p><p>Ya puedes usar CORRR con todas las funciones.</p></div></body></html>');
  } catch (err) { return reply.status(500).send({ error: String(err) }); }
});

// ── Cuenta ───────────────────────────────────────────────────────────────────

app.delete('/users/me', { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = req.userId;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM zones WHERE owner_id = $1', [userId]);
    await client.query('DELETE FROM runs WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM user_stats WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
    return reply.send({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    return reply.status(500).send({ error: String(err) });
  } finally { client.release(); }
});

// ── Perfil ───────────────────────────────────────────────────────────────────

app.get('/users/me', { preHandler: requireAuth }, async (req: any, reply) => {
  const { rows } = await db.query(
    `SELECT id, email, display_name, city, avatar_url,
            first_name, surname, war_cry, shoe_brand, shoe_brand_other,
            birth_year, gender, usual_distance, weekly_frequency,
            profile_bonus_claimed
       FROM users WHERE id = $1`, [req.userId]
  );
  if (!rows.length) return reply.status(404).send({ error: 'Usuario no encontrado' });
  return reply.send(rows[0]);
});

app.put('/users/me', { preHandler: requireAuth }, async (req: any, reply) => {
  const {
    displayName, city, avatarUrl,
    firstName, surname, warCry,
    shoeBrand, shoeBrandOther,
    birthYear, gender, usualDistance, weeklyFrequency,
  } = req.body;
  const updates: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (displayName !== undefined) { updates.push(`display_name = $${idx++}`); values.push(displayName); }
  if (city !== undefined) { updates.push(`city = $${idx++}`); values.push(city); }
  if (avatarUrl !== undefined) { updates.push(`avatar_url = $${idx++}`); values.push(avatarUrl); }
  if (firstName !== undefined) { updates.push(`first_name = $${idx++}`); values.push(firstName); }
  if (surname !== undefined) { updates.push(`surname = $${idx++}`); values.push(surname); }
  if (warCry !== undefined) { updates.push(`war_cry = $${idx++}`); values.push(warCry); }
  if (shoeBrand !== undefined) { updates.push(`shoe_brand = $${idx++}`); values.push(shoeBrand); }
  if (shoeBrandOther !== undefined) { updates.push(`shoe_brand_other = $${idx++}`); values.push(shoeBrandOther); }
  if (birthYear !== undefined) { updates.push(`birth_year = $${idx++}`); values.push(birthYear); }
  if (gender !== undefined) { updates.push(`gender = $${idx++}`); values.push(gender); }
  if (usualDistance !== undefined) { updates.push(`usual_distance = $${idx++}`); values.push(usualDistance); }
  if (weeklyFrequency !== undefined) { updates.push(`weekly_frequency = $${idx++}`); values.push(weeklyFrequency); }

  if (updates.length === 0) return reply.status(400).send({ error: 'Nada que actualizar' });

  values.push(req.userId);
  await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, values);

  // Bonus único de 50 pts cuando se completa todo el perfil por primera vez.
  // Requerimos los 8 campos del MVP (los 4 que pidió el usuario + 4 míos).
  let bonusAwarded = false;
  const { rows: full } = await db.query(
    `SELECT first_name, surname, war_cry, shoe_brand, birth_year, gender,
            usual_distance, weekly_frequency, profile_bonus_claimed
       FROM users WHERE id = $1`, [req.userId]
  );
  const u = full[0];
  const allFilled = u && u.first_name && u.surname && u.war_cry && u.shoe_brand
    && u.birth_year && u.gender && u.usual_distance && u.weekly_frequency;
  if (allFilled && !u.profile_bonus_claimed) {
    await db.query(`UPDATE users SET profile_bonus_claimed = TRUE WHERE id = $1`, [req.userId]);
    // Bonus al completar perfil: +50 pts + 10 XP directos (vía bonus_xp).
    // El XP final que ve el usuario = floor(total_points/100) + bonus_xp.
    await db.query(
      `UPDATE user_stats SET total_points = total_points + 50, bonus_xp = COALESCE(bonus_xp, 0) + 10 WHERE user_id = $1`,
      [req.userId]
    );
    bonusAwarded = true;
  }
  return reply.send({ ok: true, bonusAwarded });
});

// ── Push Token ───────────────────────────────────────────────────────────────

app.post('/users/push-token', { preHandler: requireAuth }, async (req: any, reply) => {
  const { pushToken } = req.body;
  if (!pushToken) return reply.status(400).send({ error: 'pushToken requerido' });
  await db.query('UPDATE users SET push_token = $1 WHERE id = $2', [pushToken, req.userId]);
  return reply.send({ ok: true });
});

// ── Ranking ───────────────────────────────────────────────────────────────────

// Cache en memoria de rankings. Son read-heavy y toleran ~30s de desfase, así
// que servimos el resultado cacheado y solo golpeamos la BD cuando expira. Vive
// en la instancia (1 sola en Railway → sin Redis). Al escalar a multi-instancia,
// migrar a Redis (ver backlog). No invalidamos al guardar carreras a propósito:
// 30s de leaderboard "viejo" es aceptable y evita acoplar /runs con el ranking.
const RANKING_TTL_MS = 30_000;
const rankingCache = new Map<string, { data: any; expires: number }>();
function getRankingCache(key: string): any | null {
  const hit = rankingCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  if (hit) rankingCache.delete(key);
  return null;
}
function setRankingCache(key: string, data: any) {
  rankingCache.set(key, { data, expires: Date.now() + RANKING_TTL_MS });
}

app.get('/ranking/global', async (req, reply) => {
  const cached = getRankingCache('global');
  if (cached) return reply.send(cached);
  const { rows } = await db.query(`
    SELECT u.id AS user_id, u.display_name, u.city,
           COALESCE(s.total_points, 0) AS total_points,
           s.total_zones
    FROM user_stats s
    JOIN users u ON u.id = s.user_id
    ORDER BY COALESCE(s.total_points, 0) DESC
    LIMIT 100
  `);
  setRankingCache('global', rows);
  return reply.send(rows);
});

app.get('/ranking/city', async (req: any, reply) => {
  const { city } = req.query;
  if (!city) return reply.status(400).send({ error: 'city requerido' });
  const cacheKey = `city:${String(city).toLowerCase()}`;
  const cached = getRankingCache(cacheKey);
  if (cached) return reply.send(cached);
  const { rows } = await db.query(`
    SELECT u.id AS user_id, u.display_name, u.city,
           COALESCE(s.total_points, 0) AS total_points,
           s.total_zones
    FROM user_stats s
    JOIN users u ON u.id = s.user_id
    WHERE LOWER(u.city) = LOWER($1)
    ORDER BY COALESCE(s.total_points, 0) DESC
    LIMIT 100
  `, [city]);
  setRankingCache(cacheKey, rows);
  return reply.send(rows);
});

// Top 1 por cada ciudad, ordenado alfabéticamente
app.get('/ranking/cities', async (req, reply) => {
  const cached = getRankingCache('cities');
  if (cached) return reply.send(cached);
  const { rows } = await db.query(`
    SELECT DISTINCT ON (LOWER(u.city))
           u.id AS user_id, u.display_name, u.city,
           COALESCE(s.total_points, 0) AS total_points,
           s.total_zones
    FROM user_stats s
    JOIN users u ON u.id = s.user_id
    WHERE u.city IS NOT NULL AND u.city != ''
    ORDER BY LOWER(u.city), COALESCE(s.total_points, 0) DESC
  `);
  setRankingCache('cities', rows);
  return reply.send(rows);
});

app.get('/challenges', async (req, reply) => {
  const { rows } = await db.query('SELECT * FROM challenges WHERE ends_at > NOW() ORDER BY difficulty ASC');
  // Map to frontend Challenge interface
  const challenges = rows.map((r: any) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    type: r.type,
    progress: r.progress_default ?? 0,
    total: r.total,
    reward: r.reward,
    icon: r.icon,
    category: r.category,
  }));
  return reply.send(challenges);
});

// ── Achievements (logros) ──────────────────────────────────────────────────

app.get('/achievements', { preHandler: requireAuth }, async (req: any, reply) => {
  const userId = req.userId;

  // Get user stats
  const { rows: statsRows } = await db.query(
    'SELECT total_zones, total_points, total_km, total_runs, COALESCE(total_steals,0) AS total_steals FROM user_stats WHERE user_id = $1',
    [userId]
  );
  const stats = statsRows[0] || { total_zones: 0, total_points: 0, total_km: 0, total_runs: 0, total_steals: 0 };

  // Get streak
  const { rows: runDays } = await db.query(
    `SELECT DISTINCT DATE(created_at AT TIME ZONE 'Europe/Madrid') AS d
     FROM runs WHERE user_id = $1 ORDER BY d DESC LIMIT 60`,
    [userId]
  );
  let streak = 0;
  if (runDays.length) {
    streak = 1;
    for (let i = 1; i < runDays.length; i++) {
      const prev = new Date(runDays[i - 1].d);
      const curr = new Date(runDays[i].d);
      const diff = (prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24);
      if (Math.round(diff) === 1) streak++;
      else break;
    }
  }

  // Get unlocked achievements
  const { rows: unlocked } = await db.query(
    'SELECT achievement_key, unlocked_at FROM user_achievements WHERE user_id = $1',
    [userId]
  );
  const unlockedMap = new Map(unlocked.map((r: any) => [r.achievement_key, r.unlocked_at]));

  // Build all achievements with progress
  const allAchievements = [
    ...ACHIEVEMENTS.map(a => ({
      key: a.key,
      title: a.title,
      description: a.description,
      icon: a.icon,
      category: a.category,
      target: a.target,
      progress: Math.min(parseFloat(stats[a.stat] ?? 0), a.target),
      reward: a.reward,
      unlocked: unlockedMap.has(a.key),
      unlockedAt: unlockedMap.get(a.key) || null,
    })),
    // Streak achievements
    { key: 'streak_3',  title: 'Racha de 3',      description: 'Corre 3 días seguidos',  icon: '🔥', category: 'racha', target: 3,  progress: Math.min(streak, 3),  reward: 200,  unlocked: unlockedMap.has('streak_3'),  unlockedAt: unlockedMap.get('streak_3') || null },
    { key: 'streak_7',  title: 'Semana perfecta',  description: 'Corre 7 días seguidos',  icon: '📅', category: 'racha', target: 7,  progress: Math.min(streak, 7),  reward: 500,  unlocked: unlockedMap.has('streak_7'),  unlockedAt: unlockedMap.get('streak_7') || null },
    { key: 'streak_14', title: 'Imparable',         description: 'Corre 14 días seguidos', icon: '🌟', category: 'racha', target: 14, progress: Math.min(streak, 14), reward: 1000, unlocked: unlockedMap.has('streak_14'), unlockedAt: unlockedMap.get('streak_14') || null },
  ];

  return reply.send(allAchievements);
});

// ── Admin: Challenges CRUD ──────────────────────────────────────────────────

// ADMIN_KEY: antes había fallback `'corrr-admin-2024'` hardcodeado — cualquiera
// con acceso al repo podía llamar /admin/* si la env var no estaba puesta.
// Ahora:
//   - Si la env var está → se usa esa.
//   - Si no está → generamos un random de 64 chars EN MEMORIA al arrancar.
//     Los admin endpoints quedan inaccesibles hasta que el operador ponga
//     ADMIN_KEY en Railway, pero el server arranca normalmente (evitamos
//     romper la API de los usuarios por una env var de admin mal puesta).
let ADMIN_KEY: string;
if (process.env.ADMIN_KEY) {
  ADMIN_KEY = process.env.ADMIN_KEY;
  if (ADMIN_KEY.length < 16) {
    console.warn('[WARN] ADMIN_KEY shorter than 16 chars. Considera rotar a 16+ chars.');
  }
} else {
  ADMIN_KEY = randomBytes(32).toString('hex');
  console.warn('[WARN] ADMIN_KEY missing — generado uno aleatorio en memoria.');
  console.warn('[WARN] /admin/* endpoints inaccesibles hasta que se defina la env var.');
}

const requireAdmin = async (req: any, reply: any) => {
  const key = req.headers['x-admin-key'] || (req.query as any)?.key;
  if (key !== ADMIN_KEY) return reply.status(403).send({ error: 'Acceso denegado' });
};

app.post('/admin/challenges', { preHandler: requireAdmin }, async (req: any, reply) => {
  const { title, description, type, icon, total, reward, difficulty, category, starts_at, ends_at } = req.body;
  if (!title || !description || !total || !reward) {
    return reply.status(400).send({ error: 'Faltan campos obligatorios: title, description, total, reward' });
  }
  const { rows } = await db.query(
    `INSERT INTO challenges (title, description, type, icon, total, reward, difficulty, category, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      title, description,
      type || 'shape',
      icon || '⭐',
      total, reward,
      difficulty || 1,
      category || 'semanales',
      starts_at || new Date().toISOString(),
      ends_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    ]
  );
  return reply.status(201).send(rows[0]);
});

app.put('/admin/challenges/:id', { preHandler: requireAdmin }, async (req: any, reply) => {
  const { id } = req.params;
  const { title, description, type, icon, total, reward, difficulty, category, starts_at, ends_at } = req.body;
  const { rows } = await db.query(
    `UPDATE challenges SET
      title = COALESCE($1, title),
      description = COALESCE($2, description),
      type = COALESCE($3, type),
      icon = COALESCE($4, icon),
      total = COALESCE($5, total),
      reward = COALESCE($6, reward),
      difficulty = COALESCE($7, difficulty),
      category = COALESCE($8, category),
      starts_at = COALESCE($9, starts_at),
      ends_at = COALESCE($10, ends_at)
     WHERE id = $11
     RETURNING *`,
    [title, description, type, icon, total, reward, difficulty, category, starts_at, ends_at, id]
  );
  if (rows.length === 0) return reply.status(404).send({ error: 'Reto no encontrado' });
  return reply.send(rows[0]);
});

app.delete('/admin/challenges/:id', { preHandler: requireAdmin }, async (req: any, reply) => {
  const { id } = req.params;
  const { rowCount } = await db.query('DELETE FROM challenges WHERE id = $1', [id]);
  if (rowCount === 0) return reply.status(404).send({ error: 'Reto no encontrado' });
  return reply.send({ ok: true });
});

app.get('/admin/challenges', { preHandler: requireAdmin }, async (req: any, reply) => {
  const { rows } = await db.query('SELECT * FROM challenges ORDER BY created_at DESC');
  return reply.send(rows);
});

/** DELETE /admin/wipe-users — vacía TODAS las tablas con datos de usuarios.
 *  Operación destructiva, solo accesible con la admin key. Mantiene intactas
 *  las tablas de definiciones (challenges, etc.) que son configuración. */
app.delete('/admin/wipe-users', { preHandler: requireAdmin }, async (req: any, reply) => {
  const { confirm } = req.query as any;
  if (confirm !== 'YES_WIPE_EVERYTHING') {
    return reply.status(400).send({
      error: 'Falta confirmación. Añade ?confirm=YES_WIPE_EVERYTHING a la URL.',
    });
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // TRUNCATE con CASCADE recorre las FKs y vacía todo de golpe. RESTART
    // IDENTITY reinicia secuencias autoincrementales (no usamos pero por si).
    await client.query(`
      TRUNCATE TABLE
        users, user_stats, runs, zones, cells, taunts, friendships
      RESTART IDENTITY CASCADE
    `);
    // El marker de migración v1.8 se mantiene — no queremos que se borre la
    // tabla cells (que TRUNCATE no borra schema, solo filas) y la migración
    // ya está aplicada.
    await client.query('COMMIT');
    return reply.send({ ok: true, message: 'Wipe completo. Todos los usuarios y datos relacionados eliminados.' });
  } catch (err) {
    await client.query('ROLLBACK');
    return reply.status(500).send({ error: String(err) });
  } finally {
    client.release();
  }
});

/** GET /admin/strava/subscriptions — lista las suscripciones webhook activas
 *  con Strava (solo puede haber 1 por app). Útil para diagnosticar. */
app.get('/admin/strava/subscriptions', { preHandler: requireAdmin }, async (_req, reply) => {
  const url = `https://www.strava.com/api/v3/push_subscriptions?client_id=${STRAVA_CLIENT_ID}&client_secret=${STRAVA_CLIENT_SECRET}`;
  const res = await fetch(url);
  const data = await res.json();
  return reply.send(data);
});

/** POST /admin/strava/subscribe — registra el webhook con Strava (uno solo
 *  por app). Llamar UNA VEZ tras desplegar el backend para activar el flujo
 *  Strava → CORRR auto-import. */
app.post('/admin/strava/subscribe', { preHandler: requireAdmin }, async (_req, reply) => {
  const callbackUrl = `${RAILWAY_URL}/strava/webhook`;
  const form = new URLSearchParams();
  form.append('client_id', String(STRAVA_CLIENT_ID));
  form.append('client_secret', String(STRAVA_CLIENT_SECRET));
  form.append('callback_url', callbackUrl);
  form.append('verify_token', STRAVA_VERIFY_TOKEN);
  const res = await fetch('https://www.strava.com/api/v3/push_subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const data = await res.json();
  if (!res.ok) return reply.status(res.status).send({ error: 'Strava rechazó la suscripción', strava: data });
  return reply.send({ ok: true, subscription: data, callback: callbackUrl });
});

/** DELETE /admin/strava/unsubscribe?id=<subscriptionId> — borra una suscripción.
 *  Útil si necesitas re-suscribir con otro callback URL. */
app.delete('/admin/strava/unsubscribe', { preHandler: requireAdmin }, async (req: any, reply) => {
  const { id } = req.query as any;
  if (!id) return reply.status(400).send({ error: 'id requerido' });
  const url = `https://www.strava.com/api/v3/push_subscriptions/${id}?client_id=${STRAVA_CLIENT_ID}&client_secret=${STRAVA_CLIENT_SECRET}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) return reply.status(res.status).send({ error: 'Fallo al desuscribir', status: res.status });
  return reply.send({ ok: true });
});

app.get('/admin/zones', { preHandler: requireAdmin }, async (req: any, reply) => {
  const { rows } = await db.query(
    `SELECT z.id, z.area_km2, z.points, z.center_lat, z.center_lng, z.conquered_at,
            u.display_name, array_length(regexp_split_to_array(z.polygon::text, ','), 1) as poly_size
     FROM zones z JOIN users u ON z.owner_id = u.id ORDER BY z.conquered_at DESC`
  );
  return reply.send(rows);
});

// ── Admin Stats ──────────────────────────────────────────────────────────────

app.get('/admin/stats', { preHandler: requireAdmin }, async (req: any, reply) => {
  const [users, runs, zones, stats, today, week] = await Promise.all([
    db.query('SELECT COUNT(*) as total FROM users'),
    db.query('SELECT COUNT(*) as total FROM runs'),
    db.query('SELECT COUNT(*) as total FROM zones'),
    db.query('SELECT COALESCE(SUM(total_km),0) as km, COALESCE(SUM(total_points),0) as points FROM user_stats'),
    db.query("SELECT COUNT(*) as runs, COUNT(DISTINCT user_id) as active_users FROM runs WHERE created_at > NOW() - INTERVAL '1 day'"),
    db.query("SELECT COUNT(*) as new_users FROM users WHERE created_at > NOW() - INTERVAL '7 days'"),
  ]);

  const data = {
    usuarios_total: parseInt(users.rows[0].total),
    usuarios_nuevos_7d: parseInt(week.rows[0].new_users),
    usuarios_activos_hoy: parseInt(today.rows[0].active_users),
    carreras_total: parseInt(runs.rows[0].total),
    carreras_hoy: parseInt(today.rows[0].runs),
    zonas_total: parseInt(zones.rows[0].total),
    km_total: parseFloat(stats.rows[0].km).toFixed(1),
    puntos_total: parseInt(stats.rows[0].points),
  };

  // Si piden HTML (navegador), devolver página bonita
  const accept = req.headers.accept || '';
  if (accept.includes('text/html')) {
    return reply.type('text/html').send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CORRR Admin</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0A0A0A;color:#fff;font-family:-apple-system,sans-serif;padding:24px}
  h1{font-size:28px;font-weight:900;color:#FF5500;margin-bottom:24px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .card{background:#111;border:1px solid #222;border-radius:16px;padding:20px}
  .card .num{font-size:32px;font-weight:900;color:#FF5500}
  .card .label{font-size:13px;color:#888;margin-top:4px}
</style></head><body>
<h1>CORRR Dashboard</h1>
<div class="grid">
  <div class="card"><div class="num">${data.usuarios_total}</div><div class="label">Usuarios total</div></div>
  <div class="card"><div class="num">${data.usuarios_nuevos_7d}</div><div class="label">Nuevos (7 días)</div></div>
  <div class="card"><div class="num">${data.usuarios_activos_hoy}</div><div class="label">Activos hoy</div></div>
  <div class="card"><div class="num">${data.carreras_hoy}</div><div class="label">Carreras hoy</div></div>
  <div class="card"><div class="num">${data.carreras_total}</div><div class="label">Carreras total</div></div>
  <div class="card"><div class="num">${data.zonas_total}</div><div class="label">Zonas total</div></div>
  <div class="card"><div class="num">${data.km_total} km</div><div class="label">Km recorridos</div></div>
  <div class="card"><div class="num">${data.puntos_total.toLocaleString()}</div><div class="label">Puntos total</div></div>
</div>
</body></html>`);
  }

  return reply.send(data);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

interface Coord { latitude: number; longitude: number; }

/** Decodifica un polyline codificado (formato Google/Strava). */
function decodePolyline(encoded: string): Coord[] {
  const coords: Coord[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return coords;
}

// ── Grid (5m × 5m cells) ─────────────────────────────────────────────────────
// Cell coordinates are integer indices computed by dividing lat/lng by a fixed
// per-axis degree step. The lng step is scaled by cos(SPAIN_LAT) so cells stay
// roughly square (~5m × 5m) at Spanish latitudes. Tradeoff vs. proper Mercator:
// at Canarias (~28°N) cells are ~7% larger east-west, at Pirineos (~43°N) ~3%
// smaller. Imperceptible for gameplay; keeps math trivial.
// Cell size moved from 5m to 10m in v1.8.0. Smaller cells were too prone to
// urban GPS drift (5-15m typical accuracy) — every reading would fall in a
// different cell, producing zigzag claims. 10m gives the GPS room to "settle"
// inside one cell across multiple readings, so the resulting blob looks clean.
const CELL_SIZE_M = 10;
const SPAIN_REF_LAT_RAD = 40 * Math.PI / 180;
const CELL_LAT_DEG = CELL_SIZE_M / 111000;
const CELL_LNG_DEG = CELL_SIZE_M / (111000 * Math.cos(SPAIN_REF_LAT_RAD));

function coordToCell(lat: number, lng: number): { x: number; y: number } {
  return {
    x: Math.floor(lng / CELL_LNG_DEG),
    y: Math.floor(lat / CELL_LAT_DEG),
  };
}

function cellToCoord(x: number, y: number): { lat: number; lng: number } {
  return {
    lat: y * CELL_LAT_DEG,
    lng: x * CELL_LNG_DEG,
  };
}

/** Línea 4-conexa entre dos coordenadas de celda. Mismo algoritmo que el mobile
 *  (greedy: cada paso es un único movimiento ortogonal hacia el destino). Sirve
 *  para "puentear" lecturas GPS consecutivas que estén separadas por más de una
 *  celda — así el rastro queda continuo. */
function cellLine(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [{ x: x0, y: y0 }];
  let x = x0, y = y0, guard = 0;
  while ((x !== x1 || y !== y1) && guard++ < 5000) {
    const remX = x1 - x, remY = y1 - y;
    if (Math.abs(remX) >= Math.abs(remY) && remX !== 0) x += Math.sign(remX);
    else if (remY !== 0) y += Math.sign(remY);
    else if (remX !== 0) x += Math.sign(remX);
    cells.push({ x, y });
  }
  return cells;
}

/** Flood fill — para cada celda vacía rodeada por celdas claimed (cualquier
 *  forma), la añade al set. Garantiza "si se cierra, se cierra". */
function fillEnclosedCells(cellKeys: Set<string>): Set<string> {
  if (cellKeys.size < 8) return cellKeys;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  cellKeys.forEach(k => {
    const ci = k.indexOf(',');
    const x = parseInt(k.slice(0, ci), 10);
    const y = parseInt(k.slice(ci + 1), 10);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });
  minX--; maxX++; minY--; maxY++;
  if ((maxX - minX) * (maxY - minY) > 2_000_000) return cellKeys; // safety cap
  const outside = new Set<string>();
  const stack: [number, number][] = [[minX, minY]];
  outside.add(`${minX},${minY}`);
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
      const nk = `${nx},${ny}`;
      if (outside.has(nk) || cellKeys.has(nk)) continue;
      outside.add(nk);
      stack.push([nx, ny]);
    }
  }
  const result = new Set(cellKeys);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const k = `${x},${y}`;
      if (!outside.has(k) && !cellKeys.has(k)) result.add(k);
    }
  }
  return result;
}

/** Ray-casting point-in-polygon. Devuelve true si (lat,lng) está dentro del polígono. */
function pointInPolygon(lat: number, lng: number, polygon: Coord[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].latitude,  yi = polygon[i].longitude;
    const xj = polygon[j].latitude,  yj = polygon[j].longitude;
    const intersect = ((yi > lng) !== (yj > lng)) &&
      (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ── Achievements system ────────────────────────────────────────────────────────

interface AchievementDef {
  key: string;
  title: string;
  description: string;
  icon: string;
  category: 'distancia' | 'zonas' | 'carreras' | 'robos' | 'racha';
  target: number;
  stat: string; // which stat to check
  reward: number;
}

const ACHIEVEMENTS: AchievementDef[] = [
  // Distancia
  { key: 'dist_10',   title: 'Primeros pasos',       description: 'Acumula 10 km corriendo',       icon: '👟', category: 'distancia', target: 10,   stat: 'total_km',     reward: 100 },
  { key: 'dist_50',   title: 'Medio maratón',        description: 'Acumula 50 km corriendo',       icon: '🏃', category: 'distancia', target: 50,   stat: 'total_km',     reward: 300 },
  { key: 'dist_100',  title: 'Centenario',           description: 'Acumula 100 km corriendo',      icon: '💯', category: 'distancia', target: 100,  stat: 'total_km',     reward: 600 },
  { key: 'dist_500',  title: 'Ultra runner',          description: 'Acumula 500 km corriendo',      icon: '🏅', category: 'distancia', target: 500,  stat: 'total_km',     reward: 1500 },
  // Zonas
  { key: 'zones_5',   title: 'Conquistador novato',   description: 'Conquista 5 zonas',             icon: '🗺️', category: 'zonas',     target: 5,    stat: 'total_zones',  reward: 100 },
  { key: 'zones_25',  title: 'Señor del territorio',  description: 'Conquista 25 zonas',            icon: '🏰', category: 'zonas',     target: 25,   stat: 'total_zones',  reward: 400 },
  { key: 'zones_50',  title: 'Emperador',             description: 'Conquista 50 zonas',            icon: '👑', category: 'zonas',     target: 50,   stat: 'total_zones',  reward: 800 },
  { key: 'zones_100', title: 'Leyenda territorial',   description: 'Conquista 100 zonas',           icon: '⚔️', category: 'zonas',     target: 100,  stat: 'total_zones',  reward: 2000 },
  // Carreras
  { key: 'runs_5',    title: 'Calentamiento',         description: 'Completa 5 carreras',           icon: '🔥', category: 'carreras',  target: 5,    stat: 'total_runs',   reward: 100 },
  { key: 'runs_20',   title: 'Rutina sana',           description: 'Completa 20 carreras',          icon: '💪', category: 'carreras',  target: 20,   stat: 'total_runs',   reward: 400 },
  { key: 'runs_50',   title: 'Máquina imparable',     description: 'Completa 50 carreras',          icon: '⚡', category: 'carreras',  target: 50,   stat: 'total_runs',   reward: 1000 },
  // Robos
  { key: 'steals_1',  title: 'Primer robo',           description: 'Roba tu primera zona',          icon: '🎭', category: 'robos',     target: 1,    stat: 'total_steals', reward: 150 },
  { key: 'steals_10', title: 'Ladrón experto',        description: 'Roba 10 zonas a rivales',       icon: '🦹', category: 'robos',     target: 10,   stat: 'total_steals', reward: 500 },
  { key: 'steals_25', title: 'El terror del barrio',  description: 'Roba 25 zonas a rivales',       icon: '😈', category: 'robos',     target: 25,   stat: 'total_steals', reward: 1200 },
];

async function getRunStreak(client: any, userId: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT DISTINCT DATE(created_at AT TIME ZONE 'Europe/Madrid') AS d
     FROM runs WHERE user_id = $1
     ORDER BY d DESC LIMIT 60`,
    [userId]
  );
  if (!rows.length) return 0;
  let streak = 1;
  for (let i = 1; i < rows.length; i++) {
    const prev = new Date(rows[i - 1].d);
    const curr = new Date(rows[i].d);
    const diff = (prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24);
    if (Math.round(diff) === 1) streak++;
    else break;
  }
  return streak;
}

async function checkAchievements(client: any, userId: string) {
  // Get user stats
  const { rows: statsRows } = await client.query(
    'SELECT total_zones, total_points, total_km, total_runs, COALESCE(total_steals,0) AS total_steals FROM user_stats WHERE user_id = $1',
    [userId]
  );
  if (!statsRows.length) return;
  const stats = statsRows[0];

  // Get already unlocked
  const { rows: unlocked } = await client.query(
    'SELECT achievement_key FROM user_achievements WHERE user_id = $1',
    [userId]
  );
  const unlockedSet = new Set(unlocked.map((r: any) => r.achievement_key));

  // Check stat-based achievements
  for (const ach of ACHIEVEMENTS) {
    if (unlockedSet.has(ach.key)) continue;
    const val = parseFloat(stats[ach.stat] ?? 0);
    if (val >= ach.target) {
      await client.query(
        'INSERT INTO user_achievements (user_id, achievement_key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, ach.key]
      );
      // Award bonus points
      await client.query(
        'UPDATE user_stats SET total_points = total_points + $2 WHERE user_id = $1',
        [userId, ach.reward]
      );
    }
  }

  // Check streak achievements
  const streak = await getRunStreak(client, userId);
  const streakAchievements = [
    { key: 'streak_3',  target: 3,  title: 'Racha de 3',   description: 'Corre 3 días seguidos',  icon: '🔥', reward: 200 },
    { key: 'streak_7',  target: 7,  title: 'Semana perfecta', description: 'Corre 7 días seguidos', icon: '📅', reward: 500 },
    { key: 'streak_14', target: 14, title: 'Imparable',     description: 'Corre 14 días seguidos', icon: '🌟', reward: 1000 },
  ];
  for (const sa of streakAchievements) {
    if (unlockedSet.has(sa.key)) continue;
    if (streak >= sa.target) {
      await client.query(
        'INSERT INTO user_achievements (user_id, achievement_key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, sa.key]
      );
      await client.query(
        'UPDATE user_stats SET total_points = total_points + $2 WHERE user_id = $1',
        [userId, sa.reward]
      );
    }
  }
}

// ── Runs ──────────────────────────────────────────────────────────────────────

app.post('/runs', { preHandler: requireAuth }, async (req: any, reply) => {
  // `points` (legacy) is the client's estimate. We recompute authoritatively
  // server-side below using loopBonus + cellPoints + kmPoints * multipliers.
  const { distanceKm, durationSecs, points: clientPointsEstimate, loopBonus, loopClosed, zonesCount, zones, claimedCells } = req.body ?? {};

  // Sanitización + límites anti-cheat. Aunque la lógica de puntos se
  // recomputa server-side, valores absurdos en los inputs (carreras de
  // 10000 km, arrays de millones de celdas) podrían romper queries o
  // dejar runs falsos en la BD. Top-cap a valores físicos creíbles:
  //   - distanceKm: máx 100 km por carrera (ultramarathon teórico).
  //   - durationSecs: máx 24h.
  //   - claimedCells: máx 50.000 celdas (~500 km de territorio, holgado).
  //   - zones: máx 200.
  const isFiniteNum = (v: any) => typeof v === 'number' && Number.isFinite(v);
  if (!isFiniteNum(distanceKm) || distanceKm < 0 || distanceKm > 100) {
    return reply.status(400).send({ error: 'distanceKm fuera de rango (0-100 km)' });
  }
  if (!isFiniteNum(durationSecs) || durationSecs < 0 || durationSecs > 86400) {
    return reply.status(400).send({ error: 'durationSecs fuera de rango (0-86400 s)' });
  }
  if (claimedCells != null && (!Array.isArray(claimedCells) || claimedCells.length > 50000)) {
    return reply.status(400).send({ error: 'claimedCells inválido o demasiado grande' });
  }
  if (zones != null && (!Array.isArray(zones) || zones.length > 200)) {
    return reply.status(400).send({ error: 'zones inválido o demasiado grande' });
  }

  const userId = req.userId;
  const client = await db.connect();

  const stolenZones: { id: string; ownerName: string; points: number }[] = [];
  const stolenCells: { x: number; y: number; prevOwnerId: string; prevOwnerName: string }[] = [];

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'INSERT INTO runs (user_id, distance_km, duration_secs, points, zones_count) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [userId, distanceKm, durationSecs, clientPointsEstimate || 0, zonesCount]
    );
    const runId = rows[0].id;

    // ── Grid (v2) — process claimedCells if present ──────────────────────────
    // Coexists with the polygon logic below. v1.5.x clients send only `zones`,
    // v1.6+ clients send `claimedCells`. Server handles whichever arrives.
    let newCellCount = 0;
    if (Array.isArray(claimedCells) && claimedCells.length > 0) {
      // Bounding box of all claims — used to fetch existing ownership in one query.
      const xs = claimedCells.map((c: any) => c.x);
      const ys = claimedCells.map((c: any) => c.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);

      const { rows: existing } = await client.query(
        `SELECT cell_x, cell_y, owner_id FROM cells
         WHERE cell_x BETWEEN $1 AND $2 AND cell_y BETWEEN $3 AND $4`,
        [minX, maxX, minY, maxY]
      );
      const existingMap = new Map<string, string>();
      for (const e of existing) existingMap.set(`${e.cell_x},${e.cell_y}`, e.owner_id);

      // Classify: new claims vs robos vs self-reclaims.
      const robosByPrevOwner = new Map<string, { x: number; y: number }[]>();
      for (const c of claimedCells) {
        const prev = existingMap.get(`${c.x},${c.y}`);
        if (!prev) {
          newCellCount++;
        } else if (prev !== userId) {
          const list = robosByPrevOwner.get(prev) ?? [];
          list.push({ x: c.x, y: c.y });
          robosByPrevOwner.set(prev, list);
        }
        // prev === userId → self-reclaim, just refresh timestamp (no count change)
      }

      // Batch upsert all claimed cells. ON CONFLICT transfers ownership for robos
      // and refreshes the timestamp for self-reclaims.
      const xArr = claimedCells.map((c: any) => c.x);
      const yArr = claimedCells.map((c: any) => c.y);
      await client.query(
        `INSERT INTO cells (cell_x, cell_y, owner_id, run_id)
         SELECT x, y, $3::uuid, $4::uuid
         FROM unnest($1::int[], $2::int[]) AS t(x, y)
         ON CONFLICT (cell_x, cell_y) DO UPDATE
         SET owner_id = EXCLUDED.owner_id, run_id = EXCLUDED.run_id, claimed_at = NOW()`,
        [xArr, yArr, userId, runId]
      );

      // Decrement total_cells for each robbed user and notify them.
      for (const [prevOwnerId, robosList] of robosByPrevOwner.entries()) {
        await client.query(
          `UPDATE user_stats SET total_cells = GREATEST(0, total_cells - $2) WHERE user_id = $1`,
          [prevOwnerId, robosList.length]
        );
        const { rows: prev } = await client.query(
          `SELECT push_token, display_name FROM users WHERE id = $1`, [prevOwnerId]
        );
        const prevName = prev[0]?.display_name ?? 'Alguien';
        for (const r of robosList) stolenCells.push({ x: r.x, y: r.y, prevOwnerId, prevOwnerName: prevName });
        // Create the "robo_notif" inbox entry that the victim sees when they
        // open the app — gateway to the taunt chat. One row per robo (per
        // thief/victim/run trio). The mobile shows the existing "te han robado"
        // image popup with a "Devolver" button that opens the TauntSelector.
        await client.query(
          `INSERT INTO taunts (from_user_id, to_user_id, mode, run_id) VALUES ($1, $2, 'robo_notif', $3)`,
          [userId, prevOwnerId, runId]
        );
        if (prev[0]?.push_token) {
          const { rows: thief } = await client.query(
            `SELECT display_name FROM users WHERE id = $1`, [userId]
          );
          sendPushNotification(
            prev[0].push_token,
            '😱 ¡Te han robado territorio!',
            `${thief[0]?.display_name ?? 'Alguien'} te ha quitado ${robosList.length} ${robosList.length === 1 ? 'celda' : 'celdas'}. ¡Sal a recuperarlas!`
          );
        }
      }
    }

    if (Array.isArray(zones) && zones.length > 0) {
      for (const z of zones) {
        const coords: Coord[] = z.coords;
        const centerLat = coords.reduce((s, c) => s + c.latitude,  0) / coords.length;
        const centerLng = coords.reduce((s, c) => s + c.longitude, 0) / coords.length;

        // Bounding box del nuevo polígono para pre-filtrar candidatos
        const minLat = Math.min(...coords.map(c => c.latitude));
        const maxLat = Math.max(...coords.map(c => c.latitude));
        const minLng = Math.min(...coords.map(c => c.longitude));
        const maxLng = Math.max(...coords.map(c => c.longitude));

        // Zonas de otros usuarios cuyo centro cae en el bounding box
        const { rows: candidates } = await client.query(
          `SELECT z.id, z.owner_id, z.polygon, z.points, z.center_lat, z.center_lng,
                  u.display_name AS owner_name, u.push_token AS owner_push_token
           FROM zones z
           JOIN users u ON u.id = z.owner_id
           WHERE z.owner_id != $1
             AND z.center_lat BETWEEN $2::float AND $3::float
             AND z.center_lng BETWEEN $4::float AND $5::float`,
          [userId, minLat, maxLat, minLng, maxLng]
        );

        // Point-in-polygon: ¿el centroide de la zona rival cae dentro del nuevo polígono?
        for (const rival of candidates) {
          if (pointInPolygon(rival.center_lat ?? 0, rival.center_lng ?? 0, coords)) {
            // ROBO: transferir ownership
            await client.query('UPDATE zones SET owner_id = $1, run_id = $2 WHERE id = $3',
              [userId, runId, rival.id]);

            // Restar stats al usuario robado (nunca baja de 0)
            await client.query(
              `UPDATE user_stats
               SET total_zones  = GREATEST(0, total_zones  - 1),
                   total_points = GREATEST(0, total_points - $2)
               WHERE user_id = $1`,
              [rival.owner_id, rival.points]
            );

            stolenZones.push({ id: rival.id, ownerName: rival.owner_name, points: rival.points });

            // Notificar al usuario robado
            if (rival.owner_push_token) {
              const thiefName = (await client.query('SELECT display_name FROM users WHERE id = $1', [userId])).rows[0]?.display_name ?? 'Alguien';
              sendPushNotification(
                rival.owner_push_token,
                '😱 ¡Te han robado una zona!',
                `${thiefName} ha conquistado una de tus zonas (${rival.points} pts). ¡Sal a recuperarla!`
              );
            }
          }
        }

        // Guardar nueva zona (o actualizar si ya era nuestra y la reconquistamos)
        await client.query(
          `INSERT INTO zones (owner_id, run_id, polygon, area_km2, points, center_lat, center_lng)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [userId, runId, JSON.stringify(coords), z.area, z.points, centerLat, centerLng]
        );
      }
    }

    // ── Points engine (v1.7 economy) ─────────────────────────────────────────
    // Authoritative computation server-side. Client sends a rough estimate but
    // we ignore it. Formula:
    //   km_points   = round(distance * 10) * pb_mult   (10 pts/km, ×1.2 if PB)
    //   cell_points = new_cells * 1 + stolen_cells * 2
    //   loop_bonus  = trusted from client (it knows when loops closed)
    //   subtotal    = km_points + cell_points + loop_bonus
    //   total       = round(subtotal * streak_mult)    (×1.5 if streak ≥ 3 days)
    const kmPointsBase = Math.round((distanceKm || 0) * 10);
    const cellPoints = newCellCount * 1 + stolenCells.length * 2;
    // Loop bonus — AUTORITATIVO server-side (v1.10.10+). El cliente moderno
    // envía `loopClosed` (bool: ¿cerró un círculo en la carrera?). Calculamos
    // aquí el bono y NO confiamos en ningún estimate del cliente:
    //   - El territorio interior del loop ya se premia como cell_points (1/celda
    //     vía flood-fill), así que el bono es un "extra plano por cerrar", no
    //     por-celda → evita el doble conteo que tenía el sistema legacy.
    //   - 25 pts por loop; 50 si la carrera fue ≥ 3 km (premia loops grandes).
    // Compat: clientes antiguos sin `loopClosed` pero con `loopBonus` → usamos
    // su valor con clamp (cap 75). Si NO mandan ninguno de los dos → 0. Antes
    // ahí confiábamos el estimate COMPLETO del cliente (bypass anti-cheat);
    // ahora siempre recomputamos.
    const sentLoopClosed = typeof loopClosed === 'boolean';
    let safeLoopBonus = 0;
    if (sentLoopClosed) {
      safeLoopBonus = loopClosed ? (distanceKm >= 3 ? 50 : 25) : 0;
    } else if (loopBonus !== undefined) {
      safeLoopBonus = Math.max(0, Math.min(75, Math.floor(Number(loopBonus) || 0)));
    }

    // Streak: look at last_run_date. Same day = no change. Consecutive day = +1.
    // Anything else = reset to 1.
    const { rows: statsRows } = await client.query(
      'SELECT last_run_date, streak_days, best_daily_km FROM user_stats WHERE user_id = $1',
      [userId]
    );
    const prevStats = statsRows[0] || { last_run_date: null, streak_days: 0, best_daily_km: 0 };
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    let newStreak = 1;
    if (prevStats.last_run_date) {
      const last = new Date(prevStats.last_run_date); last.setUTCHours(0, 0, 0, 0);
      const diffDays = Math.round((today.getTime() - last.getTime()) / 86_400_000);
      if (diffDays === 0) newStreak = prevStats.streak_days || 1; // same day, keep
      else if (diffDays === 1) newStreak = (prevStats.streak_days || 0) + 1; // consecutive
      // else: streak broken, newStreak stays at 1
    }
    const streakMultiplier = newStreak >= 3 ? 1.5 : 1;
    const pbMultiplier = distanceKm > (prevStats.best_daily_km || 0) ? 1.2 : 1;
    const newBestKm = Math.max(prevStats.best_daily_km || 0, distanceKm || 0);

    const kmPoints = Math.round(kmPointsBase * pbMultiplier);
    const subtotal = kmPoints + cellPoints + safeLoopBonus;
    // Siempre recomputamos server-side (el bypass legacy que confiaba el
    // estimate del cliente se ha eliminado). clientPointsEstimate solo se usa
    // ya como valor de display optimista en el cliente, nunca aquí.
    const authoritativePoints = Math.round(subtotal * streakMultiplier);

    // Persist the recomputed points on the run row (we inserted with the
    // client's estimate earlier).
    await client.query(`UPDATE runs SET points = $1 WHERE id = $2`, [authoritativePoints, runId]);

    // Robos: deduct 1 pt per stolen cell from each previous owner (in addition
    // to the cell ownership transfer + total_cells decrement above). 1 pt feels
    // like a light enough castigo — territory loss is the real penalty.
    if (stolenCells.length > 0) {
      // Re-group by previous owner to batch the deduction.
      const robbedByOwner = new Map<string, number>();
      for (const sc of stolenCells) {
        robbedByOwner.set(sc.prevOwnerId, (robbedByOwner.get(sc.prevOwnerId) || 0) + 1);
      }
      for (const [prevOwnerId, count] of robbedByOwner.entries()) {
        await client.query(
          `UPDATE user_stats SET total_points = GREATEST(0, total_points - $2) WHERE user_id = $1`,
          [prevOwnerId, count]
        );
      }
    }

    await client.query(
      `UPDATE user_stats
       SET total_zones    = total_zones  + $2,
           total_points   = total_points + $3,
           total_km       = total_km     + $4,
           total_runs     = total_runs   + 1,
           total_steals   = COALESCE(total_steals, 0) + $5,
           total_cells    = COALESCE(total_cells,  0) + $6,
           last_run_date  = $7::date,
           streak_days    = $8,
           best_daily_km  = $9
       WHERE user_id = $1`,
      [userId, zonesCount, authoritativePoints, distanceKm,
       stolenZones.length + stolenCells.length, newCellCount,
       today.toISOString().slice(0, 10), newStreak, newBestKm]
    );

    // Check and unlock achievements
    await checkAchievements(client, userId);

    await client.query('COMMIT');
    return reply.status(201).send({
      runId,
      stolenZones,
      stolenCells,
      newCellCount,
      points: authoritativePoints,
      breakdown: {
        kmPoints,
        cellPoints,
        newCells: newCellCount,
        stolenCells: stolenCells.length,
        loopBonus: safeLoopBonus,
        streakMultiplier,
        pbMultiplier,
        streakDays: newStreak,
        beatPB: pbMultiplier > 1,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    return reply.status(500).send({ error: String(err) });
  } finally {
    client.release();
  }
});

/** Lista paginada de las carreras del usuario. `?limit` y `?offset` opcionales
 *  (defaults: 30 y 0). Devuelve también `total` para que el cliente pueda
 *  decidir si pedir más. */
app.get('/runs/my', { preHandler: requireAuth }, async (req: any, reply) => {
  const q = req.query as any;
  const limit = Math.min(Math.max(parseInt(q.limit ?? '30', 10) || 30, 1), 100);
  const offset = Math.max(parseInt(q.offset ?? '0', 10) || 0, 0);
  const [rowsRes, countRes] = await Promise.all([
    db.query(
      `SELECT id, distance_km, duration_secs, points, zones_count, created_at
       FROM runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.userId, limit, offset]
    ),
    db.query(`SELECT COUNT(*)::int AS total FROM runs WHERE user_id = $1`, [req.userId]),
  ]);
  return reply.send({ runs: rowsRes.rows, total: countRes.rows[0]?.total ?? 0, limit, offset });
});

// ── Stats ─────────────────────────────────────────────────────────────────────

app.get('/stats/me', { preHandler: requireAuth }, async (req: any, reply) => {
  const [statsRes, runsRes] = await Promise.all([
    db.query(
      // total_steals lo usamos en mobile para el desbloqueo progresivo de
      // taunts (cada 10 robos desbloquea el siguiente mensaje y respuesta).
      `SELECT total_zones, total_points, total_km, total_runs,
              COALESCE(bonus_xp, 0)     AS bonus_xp,
              COALESCE(total_steals, 0) AS total_steals
       FROM user_stats WHERE user_id = $1`,
      [req.userId]
    ),
    db.query(
      'SELECT id, distance_km, duration_secs, points, zones_count, created_at FROM runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.userId]
    ),
  ]);
  const base = statsRes.rows[0] ?? { total_zones: 0, total_points: 0, total_km: 0, total_runs: 0, bonus_xp: 0, total_steals: 0 };
  // XP final = puntos/100 (parte entera) + bonus_xp (regalado por completar perfil, etc.)
  const total_xp = Math.floor((base.total_points || 0) / 100) + (base.bonus_xp || 0);
  return reply.send({ stats: { ...base, total_xp }, runs: runsRes.rows });
});

// ── Zones ─────────────────────────────────────────────────────────────────────

// Mis zonas (para cargar el mapa al abrir la app)
app.get('/zones/my', { preHandler: requireAuth }, async (req: any, reply) => {
  const { rows } = await db.query(
    `SELECT id, polygon, area_km2, points, center_lat, center_lng, conquered_at
     FROM zones WHERE owner_id = $1 ORDER BY conquered_at DESC`,
    [req.userId]
  );
  return reply.send(rows);
});

// Zonas cercanas de otros usuarios (para ver el territorio rival)
app.get('/zones/nearby', { preHandler: requireAuth }, async (req: any, reply) => {
  const { lat, lng, radius = 0.05 } = req.query as any; // radius en grados (~5 km)
  if (!lat || !lng) return reply.status(400).send({ error: 'lat y lng requeridos' });

  const { rows } = await db.query(
    `SELECT z.id, z.polygon, z.area_km2, z.points, z.center_lat, z.center_lng,
            z.conquered_at,
            z.owner_id,
            u.display_name AS owner_name,
            (z.owner_id = $1) AS is_mine
     FROM zones z
     JOIN users u ON u.id = z.owner_id
     WHERE z.center_lat BETWEEN ($2::float - $4::float) AND ($2::float + $4::float)
       AND z.center_lng BETWEEN ($3::float - $4::float) AND ($3::float + $4::float)
     LIMIT 200`,
    [req.userId, parseFloat(lat), parseFloat(lng), parseFloat(radius)]
  );
  return reply.send(rows);
});

// ── Cells (grid territory, v2) ───────────────────────────────────────────────

/** Return all claimed cells inside a lat/lng viewport. Used by the mobile map. */
app.get('/cells/viewport', { preHandler: requireAuth }, async (req: any, reply) => {
  const { north, south, east, west } = req.query as any;
  const n = parseFloat(north), s = parseFloat(south);
  const e = parseFloat(east), w = parseFloat(west);
  if (![n, s, e, w].every(Number.isFinite)) {
    return reply.status(400).send({ error: 'north, south, east, west requeridos (float)' });
  }

  const swCell = coordToCell(s, w);
  const neCell = coordToCell(n, e);

  // The PK on (cell_x, cell_y) supports the range scan. LIMIT prevents catastrophe
  // when the user zooms way out — clients should detect that and skip the call.
  const { rows } = await db.query(
    `SELECT c.cell_x, c.cell_y, c.owner_id, c.claimed_at,
            u.display_name AS owner_name, u.war_cry AS owner_war_cry,
            (c.owner_id = $1) AS is_mine
     FROM cells c
     JOIN users u ON u.id = c.owner_id
     WHERE c.cell_x BETWEEN $2 AND $3 AND c.cell_y BETWEEN $4 AND $5
     LIMIT 5000`,
    [req.userId, swCell.x, neCell.x, swCell.y, neCell.y]
  );
  return reply.send({ cells: rows });
});

// ── Taunts (emote chat) ──────────────────────────────────────────────────────

/** Inbox: all unread taunt entries for the current user, oldest first.
 *  Includes the sender's display_name and the runId so the client can group
 *  notifs by run if needed. */
app.get('/taunts/unread', { preHandler: requireAuth }, async (req: any, reply) => {
  const { rows } = await db.query(
    `SELECT t.id, t.mode, t.taunt_id, t.run_id, t.created_at,
            t.from_user_id, u.display_name AS from_user_name
       FROM taunts t
       LEFT JOIN users u ON u.id = t.from_user_id
      WHERE t.to_user_id = $1 AND t.read_at IS NULL
      ORDER BY t.created_at ASC
      LIMIT 50`,
    [req.userId]
  );
  return reply.send({ taunts: rows });
});

/** Send a taunt to another user. Used when victim hits "Devolver" on a robo
 *  notif (mode='taunt') or when the original thief replies to a taunt (mode='response').
 *
 *  Reglas del hilo (corta el bucle infinito):
 *   - taunt: la víctima del robo le manda mensaje al ladrón. Permitido solo si
 *     existe un robo_notif previo del ladrón hacia la víctima (no obligatorio
 *     a nivel servidor por ahora — el cliente lo enforce — pero la UI no abre
 *     este path en otro caso).
 *   - response: el ladrón responde a un taunt previo. Solo se permite si
 *     existe un taunt previo del 'toUserId' hacia el 'fromUserId' en el mismo
 *     runId (o sin runId). Si ya hay una response previa para ese hilo,
 *     rechazamos — un response cierra el hilo, no se puede responder a una
 *     response. */
app.post('/taunts', { preHandler: requireAuth }, async (req: any, reply) => {
  const { toUserId, tauntId, mode, runId } = req.body as any;
  if (!toUserId || !tauntId || !mode) {
    return reply.status(400).send({ error: 'toUserId, tauntId y mode requeridos' });
  }
  if (mode !== 'taunt' && mode !== 'response') {
    return reply.status(400).send({ error: 'mode debe ser taunt o response' });
  }
  if (toUserId === req.userId) {
    return reply.status(400).send({ error: 'No puedes enviarte un taunt a ti mismo' });
  }
  // Cortar el bucle: por cada hilo (mismo runId) solo se permite UNA ida
  // (taunt) y UNA vuelta (response). El runId es el identificador del robo
  // original — todos los mensajes del hilo lo arrastran. Así:
  //   - B no puede enviar 2 taunts para el mismo robo.
  //   - A no puede enviar 2 responses para el mismo robo.
  //   - Cuando A roba a B en OTRO run (otro runId), nace un hilo nuevo y
  //     se vuelve a permitir 1+1.
  const { rows: prev } = await db.query(
    `SELECT 1 FROM taunts
      WHERE from_user_id = $1 AND to_user_id = $2 AND mode = $3
        AND (run_id = $4 OR ($4::uuid IS NULL AND run_id IS NULL))
      LIMIT 1`,
    [req.userId, toUserId, mode, runId || null]
  );
  if (prev.length > 0) {
    return reply.status(409).send({
      error: mode === 'taunt'
        ? 'Ya enviaste un mensaje en este hilo.'
        : 'Ya enviaste tu respuesta en este hilo.',
    });
  }
  const { rows } = await db.query(
    `INSERT INTO taunts (from_user_id, to_user_id, mode, taunt_id, run_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [req.userId, toUserId, mode, tauntId, runId || null]
  );

  // Push notif to the recipient.
  const { rows: target } = await db.query(
    `SELECT push_token FROM users WHERE id = $1`, [toUserId]
  );
  if (target[0]?.push_token) {
    const { rows: sender } = await db.query(
      `SELECT display_name FROM users WHERE id = $1`, [req.userId]
    );
    const senderName = sender[0]?.display_name ?? 'Alguien';
    const title = mode === 'response' ? '🔥 Te han devuelto la jugada' : '💬 Mensaje recibido';
    sendPushNotification(target[0].push_token, title, `${senderName} te ha enviado un mensaje.`);
  }
  return reply.status(201).send({ id: rows[0].id, createdAt: rows[0].created_at });
});

/** Mark a taunt as read (single or batch). */
app.put('/taunts/read', { preHandler: requireAuth }, async (req: any, reply) => {
  const { ids } = req.body as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return reply.status(400).send({ error: 'ids[] requerido' });
  }
  await db.query(
    `UPDATE taunts SET read_at = NOW() WHERE to_user_id = $1 AND id = ANY($2::uuid[])`,
    [req.userId, ids]
  );
  return reply.send({ ok: true });
});

// ── Friends ──────────────────────────────────────────────────────────────────

// Enviar solicitud de amistad (por owner_id de zona rival)
app.post('/friends/request', { preHandler: requireAuth }, async (req: any, reply) => {
  const { receiverId } = req.body;
  if (!receiverId) return reply.status(400).send({ error: 'receiverId requerido' });
  if (receiverId === req.userId) return reply.status(400).send({ error: 'No puedes agregarte a ti mismo' });

  // Check si ya existe (en CUALQUIER dirección).
  const { rows: existing } = await db.query(
    `SELECT id, status FROM friendships
     WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)`,
    [req.userId, receiverId]
  );
  if (existing.length > 0) {
    return reply.send({ status: existing[0].status, message: 'Solicitud ya existe' });
  }

  // ON CONFLICT DO NOTHING absorbe race conditions de doble click: si dos
  // requests llegan al mismo tiempo, la primera inserta y la segunda no
  // tira 500 — ambas devuelven 'pending'.
  await db.query(
    `INSERT INTO friendships (sender_id, receiver_id, status)
     VALUES ($1, $2, 'pending')
     ON CONFLICT (sender_id, receiver_id) DO NOTHING`,
    [req.userId, receiverId]
  );
  return reply.send({ status: 'pending', message: 'Solicitud enviada' });
});

// Solicitudes pendientes (que me han enviado)
app.get('/friends/pending', { preHandler: requireAuth }, async (req: any, reply) => {
  const { rows } = await db.query(
    `SELECT f.id, f.sender_id, u.display_name AS sender_name, f.created_at
     FROM friendships f
     JOIN users u ON u.id = f.sender_id
     WHERE f.receiver_id = $1 AND f.status = 'pending'
     ORDER BY f.created_at DESC`,
    [req.userId]
  );
  return reply.send(rows);
});

// Aceptar / rechazar solicitud
app.put('/friends/:id', { preHandler: requireAuth }, async (req: any, reply) => {
  const { id } = req.params;
  const { action } = req.body; // 'accept' | 'reject'

  if (action === 'accept') {
    await db.query(
      `UPDATE friendships SET status = 'accepted' WHERE id = $1 AND receiver_id = $2`,
      [id, req.userId]
    );
  } else {
    await db.query(
      `DELETE FROM friendships WHERE id = $1 AND receiver_id = $2`,
      [id, req.userId]
    );
  }
  return reply.send({ ok: true });
});

// Lista de amigos aceptados + sus stats (para ranking)
app.get('/friends', { preHandler: requireAuth }, async (req: any, reply) => {
  const { rows } = await db.query(
    `SELECT u.id AS user_id, u.display_name, u.city,
            COALESCE(s.total_points, 0) AS total_points,
            COALESCE(s.total_zones, 0) AS total_zones
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.sender_id = $1 THEN f.receiver_id ELSE f.sender_id END
     LEFT JOIN user_stats s ON s.user_id = u.id
     WHERE f.status = 'accepted' AND (f.sender_id = $1 OR f.receiver_id = $1)
     ORDER BY COALESCE(s.total_points, 0) DESC`,
    [req.userId]
  );
  return reply.send(rows);
});

// Eliminar amigo
app.delete('/friends/:userId', { preHandler: requireAuth }, async (req: any, reply) => {
  const { userId: friendId } = req.params;
  await db.query(
    `DELETE FROM friendships
     WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)`,
    [req.userId, friendId]
  );
  return reply.send({ ok: true });
});

// ── Strava OAuth ──────────────────────────────────────────────────────────────

/** Mobile signup/login con Strava (v1.9). Flujo:
 *  1) App pide la URL → `/auth/strava/mobile-init`
 *  2) Browser → Strava → autoriza → Strava redirige a `/auth/strava/mobile-callback`
 *  3) Backend intercambia code → atleta + tokens → firma temp JWT → 302 al deep link `corrr://strava-auth?temp=JWT`
 *  4) App captura el deep link → POST `/auth/strava/exchange` con el temp
 *  5) Backend decide: login (atleta ya vinculado) o signup (devuelve prefill + signup token)
 *  6) Si signup → app pide email+password → POST `/auth/strava/register` → cuenta creada
 *
 *  Los tokens temporales son JWTs cortos (10 min) firmados con nuestro SECRET. */
const STRAVA_TEMP_JWT_EXP = '10m';

/** GET /auth/strava/mobile-init — público. Devuelve URL para autorizar. */
app.get('/auth/strava/mobile-init', async (_req, reply) => {
  const redirect = encodeURIComponent(`${RAILWAY_URL}/auth/strava/mobile-callback`);
  const scope = 'read,profile:read_all,activity:read_all';
  const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code` +
              `&redirect_uri=${redirect}&approval_prompt=auto&scope=${scope}`;
  return reply.send({ url });
});

/** GET /auth/strava/mobile-callback — Strava redirige aquí tras autorizar.
 *  Intercambia el code, firma un JWT temporal con los datos del atleta + tokens,
 *  y redirige al deep link `corrr://strava-auth?temp=JWT`. La app captura el deep
 *  link, extrae el token y llama a `/auth/strava/exchange`. */
app.get('/auth/strava/mobile-callback', async (req: any, reply) => {
  const { code, error } = req.query as any;
  if (error || !code) {
    return reply.type('text/html').send(htmlPage('❌ Cancelado',
      'Has cerrado el flujo de Strava. Vuelve a la app.', '#FF3B30', true));
  }
  // Intercambiar code → access_token + athlete
  const tokenRes = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
    }),
  });
  const tokenData = await tokenRes.json() as any;
  if (!tokenData.access_token || !tokenData.athlete) {
    return reply.type('text/html').send(htmlPage('❌ Error',
      `Strava dijo: ${tokenData.message ?? 'token inválido'}`, '#FF3B30', true));
  }
  // Firmar JWT temporal con todo lo que necesita la app después
  const temp = await new SignJWT({
    kind: 'strava-temp',
    athleteId: tokenData.athlete.id,
    firstName: tokenData.athlete.firstname ?? null,
    lastName: tokenData.athlete.lastname ?? null,
    city: tokenData.athlete.city ?? null,
    sex: tokenData.athlete.sex ?? null,
    profile: tokenData.athlete.profile ?? null,
    bio: tokenData.athlete.bio ?? null,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: tokenData.expires_at,
  }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(STRAVA_TEMP_JWT_EXP).sign(SECRET);

  // 302 al deep link de la app
  return reply.redirect(`corrr://strava-auth?temp=${encodeURIComponent(temp)}`);
});

/** POST /auth/strava/exchange — la app llama aquí con el temp JWT del deep link.
 *  Si el atleta ya está vinculado a una cuenta → login. Si no → devuelve prefill
 *  + un signup_token que la app usará en /register-strava después de pedir email+password. */
app.post('/auth/strava/exchange', async (req: any, reply) => {
  const { temp } = req.body as any;
  if (!temp) return reply.status(400).send({ error: 'temp requerido' });
  let payload: any;
  try {
    const v = await jwtVerify(temp, SECRET);
    payload = v.payload;
    if (payload.kind !== 'strava-temp') throw new Error('kind');
  } catch {
    return reply.status(400).send({ error: 'Token temporal inválido o expirado' });
  }

  // ¿Atleta ya vinculado a un usuario CORRR?
  const { rows } = await db.query(
    'SELECT id, email, display_name, city FROM users WHERE strava_athlete_id = $1',
    [payload.athleteId]
  );
  if (rows.length > 0) {
    const u = rows[0];
    // Refrescar los tokens de Strava por si han cambiado
    await db.query(
      `UPDATE users SET strava_access_token = $1, strava_refresh_token = $2, strava_token_expires_at = $3 WHERE id = $4`,
      [payload.accessToken, payload.refreshToken, payload.expiresAt, u.id]
    );
    const accessToken = await new SignJWT({ sub: u.id })
      .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('7d').sign(SECRET);
    return reply.send({
      kind: 'login',
      accessToken,
      user: { id: u.id, username: u.display_name, email: u.email, city: u.city },
    });
  }

  // Atleta nuevo → devolver prefill + signup token (mismo payload re-firmado)
  // El signup token vale 30 min para dar tiempo a rellenar el formulario.
  const signupToken = await new SignJWT({ ...payload, kind: 'strava-signup' })
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('30m').sign(SECRET);
  return reply.send({
    kind: 'signup',
    signupToken,
    prefill: {
      firstName: payload.firstName,
      lastName: payload.lastName,
      city: payload.city,
      gender: payload.sex === 'M' ? 'M' : payload.sex === 'F' ? 'F' : null,
      avatarUrl: payload.profile,
      bio: payload.bio,
    },
  });
});

/** POST /auth/strava/register — finaliza el signup con Strava. Crea el usuario
 *  con todos los datos prefilled + email + password que el usuario añadió. */
app.post('/auth/strava/register', async (req: any, reply) => {
  const { signupToken, email, password, displayName, firstName, surname, city, gender } = req.body as any;
  if (!signupToken || !email || !password || !displayName) {
    return reply.status(400).send({ error: 'Faltan campos requeridos' });
  }
  let payload: any;
  try {
    const v = await jwtVerify(signupToken, SECRET);
    payload = v.payload;
    if (payload.kind !== 'strava-signup') throw new Error('kind');
  } catch {
    return reply.status(400).send({ error: 'Signup token inválido o expirado' });
  }

  // Comprobar que el email no esté ya en uso. Si colisiona, el usuario
  // probablemente tiene cuenta CORRR clásica con ese email — exponemos
  // `canLink:true` para que el cliente ofrezca el flujo de vinculación
  // (POST /auth/strava/link) en vez de fallar en seco.
  const { rows: exists } = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (exists.length > 0) return reply.status(409).send({
    error: 'Ese email ya está registrado',
    code: 'EMAIL_EXISTS',
    canLink: true,
  });

  const ph = await hash(password);
  const verifyToken = secureToken();
  // Crear usuario con todos los datos prefilled de Strava + lo que el usuario
  // añadió manualmente (email, password, displayName).
  const { rows } = await db.query(
    `INSERT INTO users (
       email, password_hash, display_name, city,
       first_name, surname, gender, avatar_url,
       strava_athlete_id, strava_access_token, strava_refresh_token, strava_token_expires_at,
       email_verified, verify_token
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, FALSE, $13) RETURNING id`,
    [
      email, ph, displayName, city ?? null,
      firstName ?? payload.firstName, surname ?? payload.lastName,
      gender ?? (payload.sex === 'M' ? 'M' : payload.sex === 'F' ? 'F' : null),
      payload.profile,
      payload.athleteId, payload.accessToken, payload.refreshToken, payload.expiresAt,
      verifyToken,
    ]
  );
  const userId = rows[0].id;
  await db.query('INSERT INTO user_stats (user_id) VALUES ($1)', [userId]);

  // Email de verificación (mismo bloque que el /auth/register clásico)
  const verifyUrl = `${RAILWAY_URL}/auth/verify-email?token=${verifyToken}`;
  try {
    sendEmail({
      from: 'CORRR <hola@corrr.es>',
      to: email,
      subject: 'Verifica tu email — CORRR',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0A0A0A;padding:32px;border-radius:12px;">
          <div style="text-align:center;margin-bottom:16px;"><img src="https://ibanto.github.io/corrr/logo.png" alt="CORRR" style="width:140px;"></div>
          <p style="color:#fff;font-size:16px;">Hola ${displayName},</p>
          <p style="color:#ccc;font-size:14px;">Te acabas de registrar con Strava. Verifica tu email para activar todas las funciones:</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${verifyUrl}" style="background:#FF6600;color:#fff;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:bold;font-size:16px;">Verificar email</a>
          </div>
          <p style="color:#888;font-size:12px;">Si no has creado esta cuenta, ignora este email.</p>
        </div>
      `,
    });
  } catch (e) { console.error('[Email] verify err:', e); }

  const accessToken = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('7d').sign(SECRET);
  return reply.status(201).send({
    accessToken,
    user: { id: userId, username: displayName, email, city: city ?? null },
    pendingVerification: true,
  });
});

/** POST /auth/strava/link — vincula la cuenta Strava del signupToken a una
 *  cuenta CORRR existente. Se usa cuando el usuario hace OAuth con Strava
 *  pero su email ya está registrado clásicamente y elige vincular en vez de
 *  crear una cuenta nueva. Exige password actual para evitar que cualquiera
 *  con una cuenta Strava se apropie de cuentas ajenas (Strava no expone email
 *  vía OAuth → no podemos verificar identidad sin password). */
app.post('/auth/strava/link', {
  // Mismo límite que /auth/login — es un endpoint de password.
  config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
}, async (req: any, reply) => {
  const { signupToken, email, password } = req.body as any;
  if (!signupToken || !email || !password) {
    return reply.status(400).send({ error: 'Faltan campos requeridos' });
  }
  let payload: any;
  try {
    const v = await jwtVerify(signupToken, SECRET);
    payload = v.payload;
    if (payload.kind !== 'strava-signup') throw new Error('kind');
  } catch {
    return reply.status(400).send({ error: 'Token inválido o expirado' });
  }

  const { rows } = await db.query(
    'SELECT id, password_hash, display_name, city, email_verified, strava_athlete_id FROM users WHERE email = $1',
    [email]
  );
  if (rows.length === 0) {
    return reply.status(404).send({ error: 'No existe cuenta con ese email' });
  }
  const u = rows[0];

  const valid = await verify(u.password_hash, password);
  if (!valid) return reply.status(401).send({ error: 'Contraseña incorrecta' });

  // Si la cuenta ya está vinculada a OTRO athleteId, no sobrescribir
  // silenciosamente — el cambio debe ser explícito (desvincular primero
  // desde Perfil) para evitar que el usuario pierda el vínculo previo sin
  // querer.
  if (u.strava_athlete_id && String(u.strava_athlete_id) !== String(payload.athleteId)) {
    return reply.status(409).send({
      error: 'Esta cuenta ya está vinculada a otra cuenta Strava. Desvincúlala primero desde Perfil.',
    });
  }

  // Si el athleteId ya está vinculado a OTRA cuenta CORRR, rechazar — un
  // atleta Strava no puede estar en dos cuentas a la vez.
  const { rows: athleteCheck } = await db.query(
    'SELECT id FROM users WHERE strava_athlete_id = $1 AND id <> $2',
    [payload.athleteId, u.id]
  );
  if (athleteCheck.length > 0) {
    return reply.status(409).send({
      error: 'Esta cuenta Strava ya está vinculada a otra cuenta CORRR.',
    });
  }

  await db.query(
    `UPDATE users SET strava_athlete_id = $1, strava_access_token = $2,
       strava_refresh_token = $3, strava_token_expires_at = $4 WHERE id = $5`,
    [payload.athleteId, payload.accessToken, payload.refreshToken, payload.expiresAt, u.id]
  );

  // Respetar verificación de email — mismo gating que /auth/login.
  if (!u.email_verified) {
    return reply.status(403).send({ error: 'Email no verificado', pendingVerification: true });
  }

  const accessToken = await new SignJWT({ sub: u.id })
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('7d').sign(SECRET);
  return reply.send({
    accessToken,
    user: { id: u.id, username: u.display_name, email, city: u.city },
  });
});

/** Devuelve la URL de autorización de Strava para el usuario autenticado. */
app.get('/auth/strava', { preHandler: requireAuth }, async (req: any, reply) => {
  const state   = Buffer.from(req.userId).toString('base64url');
  const redirect = encodeURIComponent(`${RAILWAY_URL}/auth/strava/callback`);
  const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code` +
              `&redirect_uri=${redirect}&approval_prompt=auto&scope=activity:read_all&state=${state}`;
  return reply.send({ url });
});

/** Callback OAuth: importa las 5 últimas carreras como zonas conquistadas. */
app.get('/auth/strava/callback', async (req: any, reply) => {
  const { code, state, error } = req.query as any;

  if (error || !code) {
    return reply.type('text/html').send(htmlPage('❌ Conexión cancelada',
      'Cerraste la ventana sin conectar Strava. Vuelve a la app e inténtalo de nuevo.', '#FF3B30', true));
  }

  let userId: string;
  try { userId = Buffer.from(state, 'base64url').toString('utf8'); } catch {
    return reply.type('text/html').send(htmlPage('❌ Error', 'Estado inválido.', '#FF3B30', true));
  }

  // 1. Intercambiar code → access_token
  const tokenRes  = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET,
                           code, grant_type: 'authorization_code' }),
  });
  const tokenData = await tokenRes.json() as any;
  if (!tokenData.access_token) {
    return reply.type('text/html').send(htmlPage('❌ Error al conectar',
      `Strava dijo: ${tokenData.message ?? 'token inválido'}`, '#FF3B30', true));
  }

  // 1b. Guardar tokens de Strava en el usuario
  await db.query(
    `UPDATE users SET strava_athlete_id = $1, strava_access_token = $2, strava_refresh_token = $3, strava_token_expires_at = $4 WHERE id = $5`,
    [tokenData.athlete?.id, tokenData.access_token, tokenData.refresh_token, tokenData.expires_at, userId]
  );

  // 2. Obtener últimas actividades
  const actsRes  = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=10', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const allActs  = await actsRes.json() as any[];
  const runs     = allActs.filter((a: any) => a.type === 'Run' && a.map?.summary_polyline).slice(0, 5);

  if (runs.length === 0) {
    return reply.type('text/html').send(htmlPage('😕 Sin carreras',
      'No encontramos carreras recientes con ruta GPS en tu cuenta de Strava.', '#FF9500', true));
  }

  // 3. Guardar zonas en BD
  const client = await db.connect();
  let created = 0;
  try {
    await client.query('BEGIN');
    for (const act of runs) {
      const coords = decodePolyline(act.map.summary_polyline);
      if (coords.length < 3) continue;
      const centerLat = coords.reduce((s: number, c: Coord) => s + c.latitude,  0) / coords.length;
      const centerLng = coords.reduce((s: number, c: Coord) => s + c.longitude, 0) / coords.length;
      const distKm    = (act.distance ?? 0) / 1000;
      const durSecs   = act.moving_time ?? act.elapsed_time ?? 0;
      const pts       = Math.max(10, Math.round(distKm * 15));

      // Crear run
      const { rows: runRows } = await client.query(
        `INSERT INTO runs (user_id, distance_km, duration_secs, points, zones_count, created_at)
         VALUES ($1,$2,$3,$4,1,$5) RETURNING id`,
        [userId, distKm, durSecs, pts, act.start_date ?? new Date().toISOString()]
      );
      const runId = runRows[0].id;

      // Crear zona vinculada al run
      await client.query(
        `INSERT INTO zones (owner_id, run_id, polygon, area_km2, points, center_lat, center_lng)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [userId, runId, JSON.stringify(coords), distKm * 0.05, pts, centerLat, centerLng]
      );
      await client.query(
        `UPDATE user_stats SET total_zones = total_zones + 1, total_points = total_points + $2, total_km = total_km + $3, total_runs = total_runs + 1 WHERE user_id = $1`,
        [userId, pts, distKm]
      );
      created++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return reply.type('text/html').send(htmlPage('❌ Error al importar',
      `Error interno: ${String(err)}`, '#FF3B30', true));
  } finally { client.release(); }

  return reply.type('text/html').send(htmlPage('✅ ¡Zonas importadas!',
    `Se han conquistado <strong>${created} zona${created !== 1 ? 's' : ''}</strong> a partir de tus últimas carreras en Strava.`,
    '#FF6600', true));
});

// ── Strava Webhook ────────────────────────────────────────────────────────────

const STRAVA_VERIFY_TOKEN = process.env.STRAVA_VERIFY_TOKEN || 'corrr-strava-webhook-2024';

/** Refresca el access_token de Strava si ha expirado. */
async function refreshStravaToken(userId: string): Promise<string | null> {
  const { rows } = await db.query(
    'SELECT strava_access_token, strava_refresh_token, strava_token_expires_at FROM users WHERE id = $1',
    [userId]
  );
  if (!rows[0]?.strava_refresh_token) return null;

  const now = Math.floor(Date.now() / 1000);
  // Token aún válido
  if (rows[0].strava_token_expires_at > now + 60) {
    return rows[0].strava_access_token;
  }

  // Refrescar
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: rows[0].strava_refresh_token,
    }),
  });
  const data = await res.json() as any;
  if (!data.access_token) return null;

  await db.query(
    'UPDATE users SET strava_access_token = $1, strava_refresh_token = $2, strava_token_expires_at = $3 WHERE id = $4',
    [data.access_token, data.refresh_token, data.expires_at, userId]
  );
  return data.access_token;
}

/** Importa una actividad de Strava como run + zona. */
/** Strava v2 (v1.9): importa una actividad de Strava como carrera CORRR con el
 *  modelo grid. Pasos:
 *   - Decodifica la polyline → coords
 *   - Mapea cada coord a su celda (5m → 10m grid) y "puente" con cellLine
 *   - Si el rastro forma un loop (inicio cerca del final), flood fill rellena
 *     el interior — mismas reglas que las carreras nativas
 *   - Detecta robos: celdas de rivales que pisas se transfieren
 *   - Computa puntos con economía v1.7 (10 pts/km + 1 nueva + 2 robada + bonus loop)
 *   - Envía push al usuario con el resumen (engagement loop)
 */
async function importStravaActivity(userId: string, activityId: number, accessToken: string) {
  // Idempotencia: si ya importamos esta actividad antes, saltamos. Strava
  // reenvía webhooks ante 5xx (hasta 3 reintentos) y un admin podría re-disparar
  // imports a mano — sin este guard, los runs y stats se contaban x2 / x3.
  const { rows: existing } = await db.query(
    'SELECT id FROM runs WHERE strava_activity_id = $1 LIMIT 1',
    [activityId]
  );
  if (existing.length > 0) {
    console.log(`[Strava] Actividad ${activityId} ya importada (run ${existing[0].id}), skip`);
    return;
  }

  // Detalle de la actividad
  const actRes = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const act = await actRes.json() as any;
  if (act.type !== 'Run' || !act.map?.summary_polyline) {
    console.log(`[Strava] Actividad ${activityId} ignorada (tipo: ${act.type}, sin polyline)`);
    return;
  }
  const coords = decodePolyline(act.map.summary_polyline);
  if (coords.length < 3) return;

  const distKm = (act.distance ?? 0) / 1000;
  const durSecs = act.moving_time ?? act.elapsed_time ?? 0;

  // 1) Coords → celdas con puente continuo (line bridge). Igual que mobile.
  const cellSet = new Set<string>();
  let prevCell: { x: number; y: number } | null = null;
  for (const c of coords) {
    const cell = coordToCell(c.latitude, c.longitude);
    if (!prevCell) {
      cellSet.add(`${cell.x},${cell.y}`);
    } else {
      for (const bc of cellLine(prevCell.x, prevCell.y, cell.x, cell.y)) {
        cellSet.add(`${bc.x},${bc.y}`);
      }
    }
    prevCell = cell;
  }

  // 2) Si el recorrido es un loop (inicio cerca del final, <50m), flood fill
  //    los interiores. Bridge implícito + flood fill da el mismo resultado que
  //    una carrera nativa en CORRR.
  const start = coords[0], end = coords[coords.length - 1];
  const dx = (end.latitude - start.latitude) * 111000;
  const dy = (end.longitude - start.longitude) * 111000 * Math.cos(start.latitude * Math.PI / 180);
  const isLoop = Math.sqrt(dx * dx + dy * dy) < 50;
  const finalCells = isLoop ? fillEnclosedCells(cellSet) : cellSet;

  const claimedCells = Array.from(finalCells).map(k => {
    const [xs, ys] = k.split(',');
    return { x: parseInt(xs, 10), y: parseInt(ys, 10) };
  });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 3) Insertar run placeholder; puntos se actualizan al final.
    //    strava_activity_id es la clave de idempotencia: el UNIQUE index
    //    rechaza inserts duplicados si la actividad ya se procesó.
    const { rows: runRows } = await client.query(
      `INSERT INTO runs (user_id, distance_km, duration_secs, points, zones_count, created_at, strava_activity_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (strava_activity_id) WHERE strava_activity_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [userId, distKm, durSecs, 0, isLoop ? 1 : 0, act.start_date ?? new Date().toISOString(), activityId]
    );
    // Si ON CONFLICT disparó, runRows está vacío → otra ejecución concurrente
    // lo metió primero. Salimos sin tocar nada.
    if (runRows.length === 0) {
      console.log(`[Strava] Actividad ${activityId} insertada por otro proceso, skip`);
      await client.query('ROLLBACK');
      return;
    }
    const runId = runRows[0].id;

    // 4) Procesar celdas — detectar new vs robos (mismo patrón que POST /runs)
    let newCellCount = 0;
    const stolenCells: { x: number; y: number; prevOwnerId: string }[] = [];
    if (claimedCells.length > 0) {
      const xs = claimedCells.map(c => c.x);
      const ys = claimedCells.map(c => c.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const { rows: existing } = await client.query(
        `SELECT cell_x, cell_y, owner_id FROM cells
         WHERE cell_x BETWEEN $1 AND $2 AND cell_y BETWEEN $3 AND $4`,
        [minX, maxX, minY, maxY]
      );
      const existingMap = new Map<string, string>();
      for (const e of existing) existingMap.set(`${e.cell_x},${e.cell_y}`, e.owner_id);

      const robosByPrev = new Map<string, { x: number; y: number }[]>();
      for (const c of claimedCells) {
        const prev = existingMap.get(`${c.x},${c.y}`);
        if (!prev) newCellCount++;
        else if (prev !== userId) {
          const list = robosByPrev.get(prev) ?? [];
          list.push({ x: c.x, y: c.y });
          robosByPrev.set(prev, list);
          stolenCells.push({ x: c.x, y: c.y, prevOwnerId: prev });
        }
      }

      // Upsert batch
      await client.query(
        `INSERT INTO cells (cell_x, cell_y, owner_id, run_id)
         SELECT x, y, $3::uuid, $4::uuid FROM unnest($1::int[], $2::int[]) AS t(x, y)
         ON CONFLICT (cell_x, cell_y) DO UPDATE
         SET owner_id = EXCLUDED.owner_id, run_id = EXCLUDED.run_id, claimed_at = NOW()`,
        [xs, ys, userId, runId]
      );

      // Robos: decrement victim total_cells + push notification
      const thiefName = (await client.query('SELECT display_name FROM users WHERE id = $1', [userId])).rows[0]?.display_name ?? 'Alguien';
      for (const [prevOwnerId, robosList] of robosByPrev.entries()) {
        await client.query(
          `UPDATE user_stats SET total_cells = GREATEST(0, total_cells - $2), total_points = GREATEST(0, total_points - $2) WHERE user_id = $1`,
          [prevOwnerId, robosList.length]
        );
        const { rows: prev } = await client.query(`SELECT push_token FROM users WHERE id = $1`, [prevOwnerId]);
        await client.query(
          `INSERT INTO taunts (from_user_id, to_user_id, mode, run_id) VALUES ($1, $2, 'robo_notif', $3)`,
          [userId, prevOwnerId, runId]
        );
        if (prev[0]?.push_token) {
          sendPushNotification(
            prev[0].push_token,
            '😱 ¡Te han robado territorio!',
            `${thiefName} (vía Strava) te ha quitado ${robosList.length} ${robosList.length === 1 ? 'celda' : 'celdas'}. ¡Sal a recuperarlas!`
          );
        }
      }
    }

    // 5) Puntos con economía v1.7
    const kmPoints = Math.round(distKm * 10);
    const cellPoints = newCellCount + stolenCells.length * 2;
    const loopBonus = isLoop ? (distKm >= 3 ? 50 : 25) : 0;
    const totalPoints = kmPoints + cellPoints + loopBonus;

    // Actualizar run + user_stats
    await client.query(`UPDATE runs SET points = $1 WHERE id = $2`, [totalPoints, runId]);
    await client.query(
      `UPDATE user_stats
       SET total_zones  = total_zones  + $2,
           total_points = total_points + $3,
           total_km     = total_km     + $4,
           total_runs   = total_runs   + 1,
           total_steals = COALESCE(total_steals, 0) + $5,
           total_cells  = COALESCE(total_cells,  0) + $6
       WHERE user_id = $1`,
      [userId, isLoop ? 1 : 0, totalPoints, distKm, stolenCells.length, newCellCount]
    );

    await checkAchievements(client, userId);
    await client.query('COMMIT');

    console.log(`[Strava v2] ${activityId} → ${userId}: ${distKm.toFixed(1)}km, +${totalPoints}pts (${newCellCount} celdas nuevas, ${stolenCells.length} robadas, loop=${isLoop})`);

    // 6) Push al importador (el ANZUELO de engagement)
    const { rows: ur } = await db.query('SELECT push_token FROM users WHERE id = $1', [userId]);
    if (ur[0]?.push_token) {
      const parts: string[] = [];
      if (newCellCount > 0) parts.push(`+${newCellCount} celdas`);
      if (stolenCells.length > 0) parts.push(`${stolenCells.length} robadas 🔥`);
      if (isLoop) parts.push('loop cerrado');
      const summary = parts.length > 0 ? parts.join(' · ') : `${distKm.toFixed(1)} km`;
      sendPushNotification(
        ur[0].push_token,
        '🏃 Carrera de Strava importada',
        `+${totalPoints} pts · ${summary}. ¡Abre CORRR para ver tu territorio!`
      );
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[Strava] Error importando actividad ${activityId}:`, err);
  } finally {
    client.release();
  }
}

/** Webhook de validación (Strava envía GET para verificar). */
app.get('/strava/webhook', async (req: any, reply) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === STRAVA_VERIFY_TOKEN) {
    console.log('[Strava] Webhook verificado');
    return reply.send({ 'hub.challenge': challenge });
  }
  return reply.status(403).send({ error: 'Token inválido' });
});

/** Webhook de eventos (Strava envía POST cuando hay nueva actividad). */
app.post('/strava/webhook', async (req: any, reply) => {
  const { object_type, aspect_type, object_id, owner_id } = req.body;

  // Solo nos interesan actividades nuevas
  if (object_type !== 'activity' || aspect_type !== 'create') {
    return reply.send({ ok: true });
  }

  console.log(`[Strava] Nueva actividad ${object_id} del atleta ${owner_id}`);

  // Buscar usuario por strava_athlete_id
  const { rows } = await db.query('SELECT id FROM users WHERE strava_athlete_id = $1', [owner_id]);
  if (rows.length === 0) {
    console.log(`[Strava] Atleta ${owner_id} no encontrado en CORRR`);
    return reply.send({ ok: true });
  }

  const userId = rows[0].id;
  const accessToken = await refreshStravaToken(userId);
  if (!accessToken) {
    console.log(`[Strava] No se pudo refrescar token para usuario ${userId}`);
    return reply.send({ ok: true });
  }

  // Importar en background (Strava espera respuesta rápida < 2s)
  setImmediate(() => importStravaActivity(userId, object_id, accessToken));

  return reply.send({ ok: true });
});

// ── App version check ────────────────────────────────────────────────────────
//
// El cliente lo consulta al arrancar; si latestVersion > CURRENT_VERSION del
// cliente, muestra el alert "¡Nueva versión disponible!" con link a Play.
//
// Configurable vía env vars en Railway (LATEST_APP_VERSION / LATEST_APP_VC /
// MIN_APP_VERSION) para no tener que hacer redeploy del backend en cada
// release. Si las env vars no están, se usan los fallbacks hardcodeados —
// que SÍ hay que mantener sincronizados manualmente con cada subida a Play.
const LATEST_APP_VERSION = process.env.LATEST_APP_VERSION ?? '1.10.16';
const LATEST_APP_VC = parseInt(process.env.LATEST_APP_VC ?? '52', 10);
const MIN_APP_VERSION = process.env.MIN_APP_VERSION ?? '1.0.0';

app.get('/app/version', async (_req: any, reply) => {
  reply.send({
    latestVersion: LATEST_APP_VERSION,
    latestVersionCode: LATEST_APP_VC,
    minVersion: MIN_APP_VERSION,       // below this → force update
    updateUrl: 'https://play.google.com/store/apps/details?id=app.corrr',
  });
});

// ─────────────────────────────────────────────────────────────────────────────

function htmlPage(title: string, body: string, accent: string, showBackBtn = false): string {
  const backBtn = showBackBtn
    ? `<a href="corrr://" style="display:inline-block;margin-top:24px;background:${accent};color:#fff;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:bold;font-size:16px;">Volver a CORRR</a>`
    : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>CORRR × Strava</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0A0A0A;color:#fff;font-family:-apple-system,sans-serif;
         display:flex;flex-direction:column;align-items:center;justify-content:center;
         min-height:100vh;padding:32px;text-align:center}
    img.logo{width:160px;margin-bottom:24px}
    h2{font-size:22px;font-weight:800;margin-bottom:12px}
    p{font-size:15px;color:#aaa;line-height:1.6}
    strong{color:#fff}
  </style></head><body>
  <img class="logo" src="https://ibanto.github.io/corrr/logo.png" alt="CORRR">
  <h2>${title}</h2>
  <p>${body}</p>
  ${backBtn}
  </body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────

initDB().catch(console.error);

app.listen({ port: 3000, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  console.log('[API] Servidor escuchando en :3000');
});
