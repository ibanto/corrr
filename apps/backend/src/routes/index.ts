import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { hash, verify } from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { Resend } from 'resend';

dotenv.config();

const app = Fastify({ logger: true });

const STRAVA_CLIENT_ID     = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const RAILWAY_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : (process.env.RAILWAY_URL ?? 'http://localhost:3000');
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const SECRET = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET);
const resend = new Resend(process.env.RESEND_API_KEY || '');

app.register(cors, { origin: '*' });

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

  // Track stolen zones in user_stats
  await db.query(`ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS total_steals INT DEFAULT 0`).catch(() => {});

  // ── Cells (grid-based territory, v2 model) ─────────────────────────────────
  // 5m × 5m cells. Identified by integer (cell_x, cell_y) computed from lat/lng.
  // Coexists with the polygon `zones` table during the v1 → v2 transition.
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

app.post('/auth/register', async (req: any, reply) => {
  const { email, password, displayName, city } = req.body;
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
    const verifyToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
    await db.query('UPDATE users SET verify_token = $1 WHERE id = $2', [verifyToken, uid]);
    const verifyUrl = `${RAILWAY_URL}/auth/verify-email?token=${verifyToken}`;
    try {
      await resend.emails.send({
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

app.post('/auth/login', async (req: any, reply) => {
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

app.post('/auth/forgot-password', async (req: any, reply) => {
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
    const resetToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
    await db.query('UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3', [resetToken, expires, userId]);

    // Enviar email
    const resetUrl = `${RAILWAY_URL}/auth/reset-password?token=${resetToken}`;
    try {
      await resend.emails.send({
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

app.post('/auth/reset-password', async (req: any, reply) => {
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

app.post('/auth/resend-verification', async (req: any, reply) => {
  const { email } = req.body;
  if (!email) return reply.status(400).send({ error: 'Email requerido' });
  try {
    const { rows } = await db.query('SELECT id, display_name, email_verified FROM users WHERE email = $1', [email]);
    if (!rows.length) return reply.send({ ok: true }); // No revelar si existe
    if (rows[0].email_verified) return reply.send({ ok: true, alreadyVerified: true });
    const verifyToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
    await db.query('UPDATE users SET verify_token = $1 WHERE id = $2', [verifyToken, rows[0].id]);
    const verifyUrl = `${RAILWAY_URL}/auth/verify-email?token=${verifyToken}`;
    try {
      await resend.emails.send({
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
    'SELECT id, email, display_name, city, avatar_url FROM users WHERE id = $1', [req.userId]
  );
  if (!rows.length) return reply.status(404).send({ error: 'Usuario no encontrado' });
  return reply.send(rows[0]);
});

app.put('/users/me', { preHandler: requireAuth }, async (req: any, reply) => {
  const { displayName, city, avatarUrl } = req.body;
  const updates: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (displayName !== undefined) { updates.push(`display_name = $${idx++}`); values.push(displayName); }
  if (city !== undefined) { updates.push(`city = $${idx++}`); values.push(city); }
  if (avatarUrl !== undefined) { updates.push(`avatar_url = $${idx++}`); values.push(avatarUrl); }

  if (updates.length === 0) return reply.status(400).send({ error: 'Nada que actualizar' });

  values.push(req.userId);
  await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, values);
  return reply.send({ ok: true });
});

// ── Push Token ───────────────────────────────────────────────────────────────

app.post('/users/push-token', { preHandler: requireAuth }, async (req: any, reply) => {
  const { pushToken } = req.body;
  if (!pushToken) return reply.status(400).send({ error: 'pushToken requerido' });
  await db.query('UPDATE users SET push_token = $1 WHERE id = $2', [pushToken, req.userId]);
  return reply.send({ ok: true });
});

// ── Ranking ───────────────────────────────────────────────────────────────────

app.get('/ranking/global', async (req, reply) => {
  const { rows } = await db.query(`
    SELECT u.id AS user_id, u.display_name, u.city,
           COALESCE(s.total_points, 0) AS total_points,
           s.total_zones
    FROM user_stats s
    JOIN users u ON u.id = s.user_id
    ORDER BY COALESCE(s.total_points, 0) DESC
    LIMIT 100
  `);
  return reply.send(rows);
});

app.get('/ranking/city', async (req: any, reply) => {
  const { city } = req.query;
  if (!city) return reply.status(400).send({ error: 'city requerido' });
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
  return reply.send(rows);
});

// Top 1 por cada ciudad, ordenado alfabéticamente
app.get('/ranking/cities', async (req, reply) => {
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

const ADMIN_KEY = process.env.ADMIN_KEY || 'corrr-admin-2024';

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
const CELL_SIZE_M = 5;
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
  const { distanceKm, durationSecs, points, zonesCount, zones, claimedCells } = req.body;
  const userId = req.userId;
  const client = await db.connect();

  const stolenZones: { id: string; ownerName: string; points: number }[] = [];
  const stolenCells: { x: number; y: number; prevOwnerId: string; prevOwnerName: string }[] = [];

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'INSERT INTO runs (user_id, distance_km, duration_secs, points, zones_count) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [userId, distanceKm, durationSecs, points, zonesCount]
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

    await client.query(
      `UPDATE user_stats
       SET total_zones  = total_zones  + $2,
           total_points = total_points + $3,
           total_km     = total_km     + $4,
           total_runs   = total_runs   + 1,
           total_steals = COALESCE(total_steals, 0) + $5,
           total_cells  = COALESCE(total_cells,  0) + $6
       WHERE user_id = $1`,
      [userId, zonesCount, points, distanceKm, stolenZones.length + stolenCells.length, newCellCount]
    );

    // Check and unlock achievements
    await checkAchievements(client, userId);

    await client.query('COMMIT');
    return reply.status(201).send({ runId, stolenZones, stolenCells, newCellCount });
  } catch (err) {
    await client.query('ROLLBACK');
    return reply.status(500).send({ error: String(err) });
  } finally {
    client.release();
  }
});

app.get('/runs/my', { preHandler: requireAuth }, async (req: any, reply) => {
  const { rows } = await db.query(
    `SELECT id, distance_km, duration_secs, points, zones_count, created_at
     FROM runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [req.userId]
  );
  return reply.send(rows);
});

// ── Stats ─────────────────────────────────────────────────────────────────────

app.get('/stats/me', { preHandler: requireAuth }, async (req: any, reply) => {
  const [statsRes, runsRes] = await Promise.all([
    db.query('SELECT total_zones, total_points, total_km, total_runs FROM user_stats WHERE user_id = $1', [req.userId]),
    db.query(
      'SELECT id, distance_km, duration_secs, points, zones_count, created_at FROM runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
      [req.userId]
    ),
  ]);
  const stats = statsRes.rows[0] ?? { total_zones: 0, total_points: 0, total_km: 0, total_runs: 0 };
  return reply.send({ stats, runs: runsRes.rows });
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
            u.display_name AS owner_name,
            (c.owner_id = $1) AS is_mine
     FROM cells c
     JOIN users u ON u.id = c.owner_id
     WHERE c.cell_x BETWEEN $2 AND $3 AND c.cell_y BETWEEN $4 AND $5
     LIMIT 5000`,
    [req.userId, swCell.x, neCell.x, swCell.y, neCell.y]
  );
  return reply.send({ cells: rows });
});

// ── Friends ──────────────────────────────────────────────────────────────────

// Enviar solicitud de amistad (por owner_id de zona rival)
app.post('/friends/request', { preHandler: requireAuth }, async (req: any, reply) => {
  const { receiverId } = req.body;
  if (!receiverId) return reply.status(400).send({ error: 'receiverId requerido' });
  if (receiverId === req.userId) return reply.status(400).send({ error: 'No puedes agregarte a ti mismo' });

  // Check si ya existe
  const { rows: existing } = await db.query(
    `SELECT id, status FROM friendships
     WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)`,
    [req.userId, receiverId]
  );
  if (existing.length > 0) {
    return reply.send({ status: existing[0].status, message: 'Solicitud ya existe' });
  }

  await db.query(
    `INSERT INTO friendships (sender_id, receiver_id, status) VALUES ($1, $2, 'pending')`,
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
async function importStravaActivity(userId: string, activityId: number, accessToken: string) {
  // Obtener detalle de la actividad
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

  const centerLat = coords.reduce((s: number, c: Coord) => s + c.latitude, 0) / coords.length;
  const centerLng = coords.reduce((s: number, c: Coord) => s + c.longitude, 0) / coords.length;
  const distKm = (act.distance ?? 0) / 1000;
  const durSecs = act.moving_time ?? act.elapsed_time ?? 0;
  const pts = Math.max(10, Math.round(distKm * 15));

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: runRows } = await client.query(
      `INSERT INTO runs (user_id, distance_km, duration_secs, points, zones_count, created_at)
       VALUES ($1,$2,$3,$4,1,$5) RETURNING id`,
      [userId, distKm, durSecs, pts, act.start_date ?? new Date().toISOString()]
    );
    const runId = runRows[0].id;

    // Robo automático: buscar zonas rivales solapadas
    const minLat = Math.min(...coords.map((c: Coord) => c.latitude));
    const maxLat = Math.max(...coords.map((c: Coord) => c.latitude));
    const minLng = Math.min(...coords.map((c: Coord) => c.longitude));
    const maxLng = Math.max(...coords.map((c: Coord) => c.longitude));

    const { rows: candidates } = await client.query(
      `SELECT z.id, z.owner_id, z.polygon, z.points, z.center_lat, z.center_lng,
              u.display_name AS owner_name, u.push_token AS owner_push_token
       FROM zones z JOIN users u ON u.id = z.owner_id
       WHERE z.owner_id != $1
         AND z.center_lat BETWEEN $2::float AND $3::float
         AND z.center_lng BETWEEN $4::float AND $5::float`,
      [userId, minLat, maxLat, minLng, maxLng]
    );

    let stolen = 0;
    const thiefName = (await client.query('SELECT display_name FROM users WHERE id = $1', [userId])).rows[0]?.display_name ?? 'Alguien';

    for (const rival of candidates) {
      if (pointInPolygon(rival.center_lat ?? 0, rival.center_lng ?? 0, coords)) {
        await client.query('UPDATE zones SET owner_id = $1, run_id = $2 WHERE id = $3', [userId, runId, rival.id]);
        await client.query(
          `UPDATE user_stats SET total_zones = GREATEST(0, total_zones - 1), total_points = GREATEST(0, total_points - $2) WHERE user_id = $1`,
          [rival.owner_id, rival.points]
        );
        stolen++;
        if (rival.owner_push_token) {
          sendPushNotification(rival.owner_push_token, '😱 ¡Te han robado una zona!',
            `${thiefName} ha conquistado una de tus zonas (${rival.points} pts). ¡Sal a recuperarla!`);
        }
      }
    }

    // Guardar nueva zona
    await client.query(
      `INSERT INTO zones (owner_id, run_id, polygon, area_km2, points, center_lat, center_lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [userId, runId, JSON.stringify(coords), distKm * 0.05, pts, centerLat, centerLng]
    );

    await client.query(
      `UPDATE user_stats SET total_zones = total_zones + 1, total_points = total_points + $2, total_km = total_km + $3, total_runs = total_runs + 1 WHERE user_id = $1`,
      [userId, pts, distKm]
    );

    await client.query('COMMIT');
    console.log(`[Strava] Importada actividad ${activityId} para usuario ${userId}: ${distKm.toFixed(1)} km, ${pts} pts, ${stolen} zonas robadas`);

    // Enviar push notification
    const { rows: userRows } = await db.query('SELECT push_token FROM users WHERE id = $1', [userId]);
    if (userRows[0]?.push_token) {
      const msg = stolen > 0
        ? `Tu carrera de ${distKm.toFixed(1)} km se ha sincronizado. +${pts} pts y ${stolen} zona${stolen > 1 ? 's' : ''} robada${stolen > 1 ? 's' : ''}!`
        : `Tu carrera de ${distKm.toFixed(1)} km se ha sincronizado. +${pts} pts`;
      await sendPushNotification(userRows[0].push_token, '🏃 ¡Carrera importada!', msg);
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
app.get('/app/version', async (_req: any, reply) => {
  reply.send({
    latestVersion: '1.6.0',
    latestVersionCode: 19,
    minVersion: '1.0.0',       // below this → force update
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
