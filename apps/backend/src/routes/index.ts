import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';
import sharp from 'sharp';
import heicConvert from 'heic-convert';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { hash, verify } from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { Resend } from 'resend';
import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { SUPABASE_ROOT_CA } from '../db/supabase-ca.js';
import { agruparEnTiras, Dueno } from '../services/tiras.js';
import {
  CAMPANA_REACTIVACION, ASUNTO_REACTIVACION, htmlReactivacion, textoReactivacion, Variante,
} from '../services/emailReactivacion.js';

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

/** Miniatura del avatar, como data URI.
 *
 *  Las fotos de perfil se guardan enteras, tal cual salen de la cámara (solo
 *  se les baja la calidad al subirlas): medidas en producción, hasta 2,3 MB y
 *  587 KB de media. El mapa las mandaba así, una por corredor visible, en CADA
 *  refresco — megas por cada vez que alguien mueve el dedo, y creciendo con el
 *  número de usuarios. En pantalla se ven como un círculo de 40 px, así que
 *  128 px sobran y ocupan unos pocos KB.
 *
 *  Devuelve null si la imagen no se puede leer; quien llama decide qué hacer. */
const AVATAR_THUMB_PX = 128;
async function makeAvatarThumb(dataUri: string | null | undefined): Promise<string | null> {
  if (!dataUri) return null;
  const comma = dataUri.indexOf(',');
  const base64 = comma >= 0 ? dataUri.slice(comma + 1) : dataUri;
  const original = Buffer.from(base64, 'base64');

  const shrink = (input: Buffer) =>
    sharp(input, { failOn: 'none' })
      .rotate() // respeta la orientación EXIF; si no, las fotos verticales salen tumbadas
      .resize(AVATAR_THUMB_PX, AVATAR_THUMB_PX, { fit: 'cover' })
      .jpeg({ quality: 70 })
      .toBuffer();

  try {
    const out = await shrink(original);
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch {
    // Las fotos del iPhone llegan en HEIC aunque la app las etiquete como JPEG
    // (medido: 2,3 MB la mayor). Eso no lo lee ni sharp ni Android, así que
    // aquí se convierte a JPEG de verdad. Tarda ~1 s, pero es una sola vez por
    // usuario: después queda guardada.
    try {
      const jpeg = await heicConvert({ buffer: original, format: 'JPEG', quality: 0.9 });
      const out = await shrink(Buffer.from(jpeg));
      return `data:image/jpeg;base64,${out.toString('base64')}`;
    } catch {
      return null;
    }
  }
}

/** "hoy a las 8:15", "ayer a las 19:40" o "el 12 de septiembre a las 8:15",
 *  en hora de España: la app solo está en español y sus usuarios están aquí. */
export function formatRunMoment(ms: number, nowMs: number = Date.now()): string {
  const tz = 'Europe/Madrid';
  const dayKey = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: tz });
  const hora = new Date(ms).toLocaleTimeString('es-ES', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  if (dayKey(ms) === dayKey(nowMs)) return `hoy a las ${hora}`;
  if (dayKey(ms) === dayKey(nowMs - 86_400_000)) return `ayer a las ${hora}`;
  const fecha = new Date(ms).toLocaleDateString('es-ES', { timeZone: tz, day: 'numeric', month: 'long' });
  return `el ${fecha} a las ${hora}`;
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
// El pool se creaba sin opciones, y eso tenía un fallo capaz de tumbar el
// servidor entero. Estamos contra el *pooler* de Supabase, que cierra las
// conexiones que llevan un rato sin usarse. Cuando eso pasa, el pool de `pg`
// emite un evento 'error' sobre una conexión dormida; si nadie lo escucha,
// Node lo trata como excepción no capturada y MATA el proceso. No es un
// fallo de una petición: se cae el servicio para todos, en mitad de la noche
// y sin que nadie esté haciendo nada.
//
// El manejador de abajo es lo que lo evita: registra el problema y deja que
// el pool descarte esa conexión y abra otra, que es su comportamiento normal.
//
// Los tiempos límite acompañan: soltamos las conexiones ociosas nosotros
// (30s) antes de que las cierre el pooler por su cuenta, y no dejamos que una
// petición se quede colgada indefinidamente esperando conexión (10s) — mejor
// un error claro que un usuario mirando una pantalla congelada.
const db = new Pool({
  ...databaseConfig(),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

db.on('error', (err) => {
  console.error('[DB] Error en conexión inactiva (se descarta y se reabre):', err.message);
});

// Conexión con la base de datos CIFRADA y VERIFICADA.
//
// Hasta septiembre de 2026 iba sin cifrar: node-postgres no pide TLS si la
// cadena de conexión no lo dice, y la nuestra no lo decía. Emails, hashes de
// contraseña, ubicaciones y tokens viajaban en claro entre Railway y Supabase,
// por internet. El RGPD (art. 32) pide cifrado adecuado al riesgo, y la
// política de privacidad lo prometía.
//
// Se VERIFICA contra la CA raíz de Supabase, no solo se cifra: cifrar sin
// verificar deja pasar a quien se ponga en medio con su propio certificado.
//
// Los parámetros ssl* de la URL se quitan porque en node-postgres los de la
// cadena de conexión PISAN la opción `ssl` de aquí. Solo se reescribe la URL si
// los trae, para no tocar una contraseña con caracteres raros.
//
// Salida de emergencia: DATABASE_SSL=no-verify en Railway cifra SIN verificar
// el certificado. Solo para levantar el servicio si Supabase cambiara de CA
// (la actual caduca en 2031) mientras se actualiza db/supabase-ca.ts.
function databaseConfig(): { connectionString: string; ssl: { ca?: string; rejectUnauthorized: boolean } } {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.error('[FATAL] DATABASE_URL missing. Set it in Railway env vars.');
    process.exit(1);
  }
  let connectionString = raw;
  if (/[?&](sslmode|sslrootcert|sslcert|sslkey|ssl|uselibpqcompat)=/.test(raw)) {
    const url = new URL(raw);
    for (const p of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl', 'uselibpqcompat']) {
      url.searchParams.delete(p);
    }
    connectionString = url.toString();
  }
  if (process.env.DATABASE_SSL === 'no-verify') {
    console.warn('[DB] DATABASE_SSL=no-verify: conexión cifrada pero SIN verificar el certificado.');
    return { connectionString, ssl: { rejectUnauthorized: false } };
  }
  return { connectionString, ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true } };
}
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
// TTL del token de SESIÓN. Subido de 7d a 90d: no hay refresh tokens, así que el
// access token ES la sesión; con 7d el usuario tenía que re-loguear cada semana
// (mala UX, sobre todo en producción pública). 90d = re-login ~trimestral. La
// app (vc52+) maneja el 401 al caducar mandando a login, así que es indoloro.
// (Futuro: refresh tokens de verdad si hace falta acortar el access token.)
const SESSION_TOKEN_TTL = '90d';

/** Edad mínima para registrarse. 14 es la edad de consentimiento digital en
 *  España (LOPDGDD art. 7). El RGPD permite fijarla entre 13 y 16 y cada
 *  estado elige; si algún día se abre a otros países habrá que revisarlo,
 *  porque en varios son 16. */
const MIN_AGE_YEARS = 14;
const resend = new Resend(process.env.RESEND_API_KEY || '');

app.register(cors, { origin: '*' });

// Las respuestas iban sin comprimir. La del mapa es la peor: miles de celdas
// con el mismo nombre de dueño repetido en cada una, que en gzip se queda en
// una fracción. No hace falta tocar la app: iOS y Android ya piden compresión
// en cada petición. Por debajo de 1 KB no compensa.
app.register(compress, { global: true, threshold: 1024, encodings: ['gzip', 'deflate'] });

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
  // Carreras importadas del Apple Watch (vía Salud). `source` dice de dónde
  // vino; `external_id` es el UUID del entreno en Salud y la clave de
  // idempotencia: la app puede reintentar la importación sin duplicar nada.
  await db.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'app'`).catch(() => {});
  await db.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS external_id TEXT`).catch(() => {});
  // Cifras técnicas de cada carrera, SIN coordenadas: lecturas, salto más
  // largo, trozos del recorrido, circuitos rellenados o descartados. Sirven
  // para entender por qué una carrera reclamó lo que reclamó (cuñas en
  // diagonal de sep-2026) sin guardar por dónde ha ido nadie, que sería otra
  // categoría de dato personal y obligaría a cambiar la política.
  await db.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS diag JSONB`).catch(() => {});
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS runs_user_external_id_uniq ON runs(user_id, external_id) WHERE external_id IS NOT NULL`).catch(() => {});

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
  // La foto entera (hasta 2,3 MB medidos) solo hace falta en el perfil. El
  // mapa manda la miniatura, que es lo que se ve: un círculo de 40 px.
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_thumb TEXT`);

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
  // Fecha de alta para /admin/panel (la tabla users es anterior a este archivo
  // y nunca la tuvo). Postgres rellena las filas existentes con NOW() al hacer
  // el ALTER: aceptable — la BD se vació el 21-jul-2026, así que ninguna alta
  // real es anterior a la columna.
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`).catch(() => {});

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
  // Cuándo declaró el usuario tener la edad mínima. Guardamos la marca de
  // tiempo, no la fecha de nacimiento: para acreditar el cumplimiento basta
  // con poder demostrar que se le preguntó y cuándo (RGPD art. 8 y principio
  // de minimización). Nulo en las cuentas anteriores a esta comprobación.
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS age_confirmed_at TIMESTAMPTZ`).catch(() => {});
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_from TIMESTAMPTZ`).catch(() => {});
  // Cuándo pidió el usuario no recibir más emails sobre CORRR (enlace de baja).
  // Nulo = los recibe. No afecta a los de verificación ni de contraseña.
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_baja_at TIMESTAMPTZ`).catch(() => {});
  // Qué email de campaña se ha mandado a quién. La clave primaria impide
  // mandar dos veces el mismo a la misma persona aunque se lance dos veces.
  await db.query(`
    CREATE TABLE IF NOT EXISTS email_envios (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      campana TEXT NOT NULL,
      enviado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, campana)
    )
  `).catch(() => {});
  await db.query(`ALTER TABLE email_envios ENABLE ROW LEVEL SECURITY`).catch(() => {});
  // Avisos: el pop-up que sale al abrir la app y que se escribe desde el
  // panel, sin sacar versión nueva. La app (1.11.10+) pregunta por el suyo al
  // arrancar; las anteriores ni preguntan, así que no les afecta.
  await db.query(`
    CREATE TABLE IF NOT EXISTS avisos (
      id SERIAL PRIMARY KEY,
      titulo TEXT NOT NULL,
      texto TEXT NOT NULL,
      imagen_url TEXT,
      boton TEXT,
      enlace TEXT,
      publico TEXT NOT NULL DEFAULT 'todos',
      ciudad TEXT,
      desde TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      hasta TIMESTAMPTZ,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  // Quién ha visto qué. La clave primaria es lo que hace que un aviso salga
  // UNA vez por persona, aunque cierre y vuelva a abrir la app.
  await db.query(`
    CREATE TABLE IF NOT EXISTS aviso_vistas (
      aviso_id INTEGER NOT NULL REFERENCES avisos(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      visto_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (aviso_id, user_id)
    )
  `).catch(() => {});
  // Adornos del cartel (la línea de arriba, el sello de la esquina y la nota
  // del botón). Opcionales: un aviso sin ellos se ve bien igual.
  await db.query(`ALTER TABLE avisos ADD COLUMN IF NOT EXISTS etiqueta TEXT`).catch(() => {});
  await db.query(`ALTER TABLE avisos ADD COLUMN IF NOT EXISTS sello TEXT`).catch(() => {});
  await db.query(`ALTER TABLE avisos ADD COLUMN IF NOT EXISTS nota TEXT`).catch(() => {});
  // Para probar un aviso en tu propio móvil antes de soltarlo a todo el mundo.
  await db.query(`ALTER TABLE avisos ADD COLUMN IF NOT EXISTS corredor TEXT`).catch(() => {});
  // Qué teléfono usa cada corredor. Se apunta cuando la app pide su aviso, y
  // sirve para mandar un aviso solo a iPhone o solo a Android.
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plataforma TEXT`).catch(() => {});
  await db.query(`ALTER TABLE avisos ENABLE ROW LEVEL SECURITY`).catch(() => {});
  await db.query(`ALTER TABLE aviso_vistas ENABLE ROW LEVEL SECURITY`).catch(() => {});
  // Motivo por el que una carrera quedó marcada como geométricamente inusual.
  // Nulo en las normales. Se guarda en vez de rechazar la carrera: ver el
  // bloque de anti-trampas en POST /runs.
  await db.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS flagged_reason TEXT`).catch(() => {});


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

  // Lista de sesiones revocadas: se carga ya y se refresca cada minuto.
  await refreshRevokedSessions();
  setInterval(refreshRevokedSessions, 60_000).unref();
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

// ── Revocación de sesiones ───────────────────────────────────────────────────
// Un JWT vale hasta que caduca, así que cambiar la contraseña no echaba a nadie:
// si alguien te robaba el móvil o el token, cambiar la clave no servía de nada.
// Ahora, al restablecer la contraseña, se marca la hora en la que dejan de valer
// los tokens anteriores y los que se emitieron antes se rechazan.
//
// Lo guardamos en memoria en vez de consultarlo en cada petición: sería una
// consulta extra en TODAS las peticiones autenticadas para un caso rarísimo.
// Solo se listan los usuarios que alguna vez han restablecido la contraseña
// (un puñado), la lista se carga al arrancar y se refresca cada minuto — así
// otra réplica se entera igual, con un minuto de margen como mucho.
const revokedBefore = new Map<string, number>();

async function refreshRevokedSessions() {
  try {
    const { rows } = await db.query(
      `SELECT id, sessions_valid_from FROM users WHERE sessions_valid_from IS NOT NULL`
    );
    revokedBefore.clear();
    for (const r of rows) revokedBefore.set(r.id, new Date(r.sessions_valid_from).getTime());
  } catch {
    // Si la consulta falla mantenemos la lista anterior: preferimos seguir
    // aplicando revocaciones conocidas a quedarnos sin ninguna.
  }
}

const requireAuth = async (req: any, reply: any) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return reply.status(401).send({ error: 'No autorizado' });
  try {
    const { payload } = await jwtVerify(auth.slice(7), SECRET);
    const userId = payload.sub as string;
    const cutoff = revokedBefore.get(userId);
    // "iat" va en segundos; damos 5s de margen por el redondeo al firmar.
    if (cutoff !== undefined && payload.iat !== undefined && payload.iat * 1000 + 5000 < cutoff) {
      return reply.status(401).send({ error: 'Sesión caducada, vuelve a entrar' });
    }
    req.userId = userId;
  } catch {
    return reply.status(401).send({ error: 'Token inválido' });
  }
};

// ── Auth ──────────────────────────────────────────────────────────────────────

app.get('/health', async (req, reply) => {
  // dbTls dice si la conexión con la base de datos va cifrada y con el
  // certificado verificado. Es la única forma de comprobarlo desde fuera, y
  // si algún día alguien quita la configuración de TLS, se ve aquí.
  let client;
  try {
    client = await db.connect();
    await client.query('SELECT 1');
    const stream: any = (client as any).connection?.stream;
    const dbTls = { encrypted: stream?.encrypted === true, verified: stream?.authorized === true };
    return reply.send({ ok: true, ts: Date.now(), dbTls });
  } catch (err) {
    return reply.status(503).send({ ok: false, error: String(err) });
  } finally {
    client?.release();
  }
});

app.post('/auth/register', {
  // 5 registros/hora por IP — evita spam de signups (que mandan email).
  config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
}, async (req: any, reply) => {
  const { email, password, displayName, city, ageConfirmed } = req.body ?? {};
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
  // Edad mínima. En España la edad de consentimiento digital son 14 años
  // (LOPDGDD art. 7, que concreta el art. 8 del RGPD): por debajo hace falta
  // consentimiento de los padres, que no tenemos forma de recabar.
  //
  // Hasta ahora la política de privacidad prometía que no se admiten menores
  // y que "si detectamos que un menor se ha registrado, eliminaremos su
  // cuenta", pero NADA lo comprobaba — prometer algo que no se cumple es peor
  // que no prometerlo, porque ante una reclamación el propio documento te
  // señala. Esto es lo que hace cierta esa promesa.
  //
  // Es una DECLARACIÓN del usuario, no una verificación: comprobarlo de verdad
  // exigiría documentación, desproporcionado para este servicio. Y se pide
  // como booleano en vez de la fecha de nacimiento a propósito — el principio
  // de minimización del RGPD dice recoger solo lo necesario, y para saber si
  // alguien supera una edad basta un sí, no su fecha exacta.
  //
  // TRANSICIÓN: la app que hay ahora mismo en las tiendas se compiló antes de
  // que existiera esta casilla, así que no manda el campo. Exigirlo a secas
  // dejó el registro roto para todo el mundo (nadie podía crear cuenta). Por
  // eso el criterio es la PRESENCIA del campo, que es lo que distingue a un
  // cliente nuevo de uno viejo:
  //
  //   · lo manda en false → app nueva y el usuario no marcó la casilla: se rechaza.
  //   · lo manda en true  → app nueva y sí la marcó: adelante, y se anota cuándo.
  //   · no lo manda       → app antigua: se le deja pasar, sin anotar nada.
  //
  // El tercer caso se cierra en cuanto la versión con la casilla esté en las
  // dos tiendas y la comprobación de versión obligue a actualizar: entonces
  // esto vuelve a ser un `ageConfirmed !== true` a secas. Mientras tanto no se
  // pierde gran cosa: es una declaración, no una verificación, y quien quiera
  // mentir sobre su edad puede hacerlo igual marcando la casilla.
  if (ageConfirmed !== undefined && ageConfirmed !== true) {
    return reply.status(403).send({
      error: `Tienes que declarar que tienes al menos ${MIN_AGE_YEARS} años para usar CORRR`,
      underage: true,
    });
  }
  try {
    const ex = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (ex.rows.length) return reply.status(400).send({ error: 'Email ya registrado' });
    // Comprobar nombre de usuario único (case-insensitive)
    const nameCheck = await db.query('SELECT id FROM users WHERE LOWER(display_name) = LOWER($1)', [displayName]);
    if (nameCheck.rows.length) return reply.status(400).send({ error: 'Ese nombre de usuario ya está en uso' });
    const ph = await hash(password);
    const { rows } = await db.query(
      // La marca de tiempo solo se pone si el usuario declaró de verdad su
      // edad. Sellarla siempre dejaría constancia de un consentimiento que
      // nadie dio (los clientes antiguos ni siquiera preguntan), que es
      // justo lo contrario de lo que sirve para acreditar cumplimiento.
      `INSERT INTO users (email, password_hash, display_name, city, age_confirmed_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [email, ph, displayName, city, ageConfirmed === true ? new Date() : null]
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
      .setExpirationTime(SESSION_TOKEN_TTL)
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
      .setExpirationTime(SESSION_TOKEN_TTL)
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
    await db.query(
      `UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL,
              sessions_valid_from = NOW()
       WHERE id = $2`,
      [ph, rows[0].id]
    );
    // Efecto inmediato en esta réplica; las demás lo cogen en el refresco.
    revokedBefore.set(rows[0].id, Date.now());
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

/** GET /users/me/export — todos los datos del usuario en JSON.
 *
 *  Derechos de acceso y portabilidad (RGPD art. 15 y 20). La política de
 *  privacidad ya los ofrece por email con respuesta en 30 días, que cumple;
 *  esto lo hace instantáneo y deja de requerir que alguien entre a la base de
 *  datos a mano por cada solicitud. Con pocos usuarios da igual; en cuanto
 *  crezca, no.
 *
 *  Devuelve JSON plano —"formato estructurado, de uso común y lectura
 *  mecánica", que es lo que exige el art. 20— y NO incluye password_hash ni
 *  los tokens de Strava: son credenciales, no datos personales del usuario, y
 *  exponerlos sería un problema de seguridad, no una mejora de transparencia. */
app.get('/users/me/export', {
  preHandler: requireAuth,
  config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
}, async (req: any, reply) => {
  const uid = req.userId;
  const [perfil, stats, carreras, celdas, mensajes, amigos, logros, emails] = await Promise.all([
    db.query(`SELECT id, email, display_name, city, first_name, surname, war_cry,
                     shoe_brand, shoe_brand_other, birth_year, gender, usual_distance,
                     weekly_frequency, email_verified, strava_athlete_id, created_at,
                     email_baja_at
              FROM users WHERE id = $1`, [uid]),
    db.query('SELECT * FROM user_stats WHERE user_id = $1', [uid]),
    db.query(`SELECT id, distance_km, duration_secs, points, zones_count, created_at
              FROM runs WHERE user_id = $1 ORDER BY created_at`, [uid]),
    db.query(`SELECT cell_x, cell_y, run_id, claimed_at
              FROM cells WHERE owner_id = $1 ORDER BY claimed_at`, [uid]),
    db.query(`SELECT id, mode, taunt_id, from_user_id, to_user_id, run_id, created_at, read_at
              FROM taunts WHERE from_user_id = $1 OR to_user_id = $1 ORDER BY created_at`, [uid]),
    db.query(`SELECT id, sender_id, receiver_id, status, created_at
              FROM friendships WHERE sender_id = $1 OR receiver_id = $1`, [uid]),
    db.query('SELECT * FROM user_achievements WHERE user_id = $1', [uid]).catch(() => ({ rows: [] })),
    db.query('SELECT campana, enviado_at FROM email_envios WHERE user_id = $1 ORDER BY enviado_at', [uid])
      .catch(() => ({ rows: [] })),
  ]);

  reply.header('Content-Disposition', `attachment; filename="corrr-mis-datos.json"`);
  return reply.send({
    exportadoEl: new Date().toISOString(),
    aviso: 'Copia de todos los datos que CORRR guarda sobre tu cuenta. No incluye tu contraseña (guardada cifrada y no recuperable) ni los tokens de Strava (credenciales de acceso).',
    perfil: perfil.rows[0] ?? null,
    estadisticas: stats.rows[0] ?? null,
    carreras: carreras.rows,
    celdasConquistadas: celdas.rows,
    mensajes: mensajes.rows,
    amistades: amigos.rows,
    logros: logros.rows,
    emailsSobreCorrr: emails.rows,
  });
});

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
  if (avatarUrl !== undefined) {
    updates.push(`avatar_url = $${idx++}`); values.push(avatarUrl);
    // La miniatura se rehace con la foto nueva; si falla, se borra para que el
    // mapa la vuelva a intentar en vez de enseñar la del avatar anterior.
    updates.push(`avatar_thumb = $${idx++}`); values.push(await makeAvatarThumb(avatarUrl));
  }
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
const RANKING_CACHE_MAX = 500;
function getRankingCache(key: string): any | null {
  const hit = rankingCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  if (hit) rankingCache.delete(key);
  return null;
}
function setRankingCache(key: string, data: any) {
  // Tope de entradas: el caché guarda una por ciudad consultada y solo se
  // limpiaba al volver a pedir esa misma ciudad, así que con muchas ciudades
  // la memoria subía y no bajaba nunca. Al llegar al tope tiramos las
  // caducadas y, si aun así no cabe, la más antigua (los Map de JS conservan
  // el orden de inserción, así que la primera clave es la más vieja).
  if (rankingCache.size >= RANKING_CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of rankingCache) if (v.expires <= now) rankingCache.delete(k);
    if (rankingCache.size >= RANKING_CACHE_MAX) {
      const oldest = rankingCache.keys().next().value;
      if (oldest !== undefined) rankingCache.delete(oldest);
    }
  }
  rankingCache.set(key, { data, expires: Date.now() + RANKING_TTL_MS });
}

// Requiere auth como el resto: devuelve nombre y ciudad de usuarios reales, y
// sin autenticación cualquiera podía recopilarlos en bucle sin tener cuenta.
app.get('/ranking/global', { preHandler: requireAuth }, async (req, reply) => {
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

/** Inicio de la semana del podio: el sábado a las 00:00 de España.
 *  El pop-up sale los sábados, así que la semana va de sábado a sábado: lo que
 *  se enseña es lo conseguido desde el sábado anterior. En la semana del
 *  cambio de hora el corte se mueve una hora; da igual para un podio. */
export function podiumWeekStart(nowMs: number = Date.now()): Date {
  const tz = 'Europe/Madrid';
  const offsetMs = (at: number) => {
    const m = new Date(at)
      .toLocaleString('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!m) return 0;
    return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) * 60_000;
  };
  const shift = offsetMs(nowMs);
  // Con el desfase sumado, los getUTC* dan el día y la hora de España.
  const local = new Date(nowMs + shift);
  const daysSinceSaturday = (local.getUTCDay() + 1) % 7; // sábado = 0
  const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
    - daysSinceSaturday * 86_400_000;
  return new Date(localMidnight - offsetMs(localMidnight - shift));
}

/** Podio para el pop-up de los sábados: los tres mejores de la semana y los
 *  tres de siempre, en España y en tu ciudad.
 *
 *  Va en una sola llamada —y no reutilizando /ranking/global— porque el
 *  pop-up sale nada más abrir la app: cuatro peticiones ahí dentro competirían
 *  con la carga del mapa justo cuando más se nota. */
app.get('/ranking/podium', { preHandler: requireAuth }, async (req: any, reply) => {
  const since = podiumWeekStart();

  const { rows: me } = await db.query(`SELECT city FROM users WHERE id = $1`, [req.userId]);
  const city: string | null = me[0]?.city?.trim() || null;

  const cacheKey = `podium:${city ? city.toLowerCase() : '-'}`;
  const cached = getRankingCache(cacheKey);
  if (cached) return reply.send(cached);

  // Semana: se suman los puntos de las carreras de los últimos días. Para una
  // carrera importada del reloj cuenta CUÁNDO SE CORRIÓ (started_at), no
  // cuándo se importó, igual que en el historial.
  const weekQuery = (filterCity: boolean) => db.query(
    `SELECT u.id AS user_id, u.display_name, u.city, u.avatar_thumb,
            SUM(r.points)::int AS points
       FROM runs r
       JOIN users u ON u.id = r.user_id
      WHERE COALESCE(r.started_at, r.created_at) >= $1
        ${filterCity ? 'AND LOWER(u.city) = LOWER($2)' : ''}
      GROUP BY u.id, u.display_name, u.city, u.avatar_thumb
     HAVING SUM(r.points) > 0
      ORDER BY points DESC
      LIMIT 3`,
    filterCity ? [since, city] : [since],
  );

  const allTimeQuery = (filterCity: boolean) => db.query(
    `SELECT u.id AS user_id, u.display_name, u.city, u.avatar_thumb,
            COALESCE(s.total_points, 0)::int AS points
       FROM user_stats s
       JOIN users u ON u.id = s.user_id
      WHERE COALESCE(s.total_points, 0) > 0
        ${filterCity ? 'AND LOWER(u.city) = LOWER($1)' : ''}
      ORDER BY points DESC
      LIMIT 3`,
    filterCity ? [city] : [],
  );

  const [weekSpain, allTimeSpain, weekCity, allTimeCity] = await Promise.all([
    weekQuery(false),
    allTimeQuery(false),
    city ? weekQuery(true) : Promise.resolve({ rows: [] as any[] }),
    city ? allTimeQuery(true) : Promise.resolve({ rows: [] as any[] }),
  ]);

  // Si alguien del podio aún no tiene miniatura, se hace aquí y se guarda:
  // son como mucho doce filas y así el podio sale con fotos desde el primer
  // sábado, sin esperar a que ese corredor aparezca en el mapa de alguien.
  const thumbCache = new Map<string, string | null>();
  const thumbOf = async (userId: string, thumb: string | null) => {
    if (thumb) return thumb;
    if (thumbCache.has(userId)) return thumbCache.get(userId)!;
    const { rows } = await db.query(`SELECT avatar_url FROM users WHERE id = $1`, [userId]);
    const hecha = await makeAvatarThumb(rows[0]?.avatar_url);
    if (hecha) await db.query(`UPDATE users SET avatar_thumb = $1 WHERE id = $2`, [hecha, userId]);
    thumbCache.set(userId, hecha);
    return hecha;
  };

  const clean = async (rows: any[]) => Promise.all(rows.map(async r => ({
    userId: r.user_id,
    name: r.display_name,
    city: r.city,
    points: r.points,
    avatar: await thumbOf(r.user_id, r.avatar_thumb ?? null),
  })));

  const payload = {
    weekStart: since.toISOString(),
    city,
    week: { spain: await clean(weekSpain.rows), city: await clean(weekCity.rows) },
    allTime: { spain: await clean(allTimeSpain.rows), city: await clean(allTimeCity.rows) },
  };
  setRankingCache(cacheKey, payload);
  return reply.send(payload);
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

/** La clave SOLO viaja por cabecera.
 *
 *  Antes también se aceptaba por query string (`?key=…`), que era cómodo para
 *  abrir el panel desde el navegador pero dejaba la clave escrita en todas
 *  partes: los registros de Railway (el logger de Fastify guarda la ruta
 *  completa), el historial del navegador y cualquier proxy intermedio. Detrás
 *  de esa clave están los datos de todos los usuarios.
 *
 *  El panel HTML sigue siendo accesible: pide la clave una vez y la guarda en
 *  el navegador (sessionStorage), mandándola por cabecera en cada petición. */
const requireAdmin = async (req: any, reply: any) => {
  const key = req.headers['x-admin-key'];
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

/** GET /admin/panel — panel de administración en HTML. Abrir en el navegador:
 *  https://<api>/admin/panel?key=ADMIN_KEY
 *  Server-rendered a propósito: mismo origen (sin CORS), nada que desplegar
 *  aparte del backend, y desde el móvil va igual de bien. Todo texto que
 *  origina el usuario (nombre, email, ciudad) se escapa SIEMPRE — un
 *  display_name malicioso no puede inyectar HTML en el panel del admin. */
/** GET /admin — puerta de entrada al panel, sin auth.
 *
 *  Existe porque la clave ya no viaja por la URL: este cascarón la pide una
 *  vez, la guarda en sessionStorage (se borra al cerrar la pestaña) y pide el
 *  panel real mandándola por cabecera. Así nunca queda escrita en registros,
 *  historial ni proxies. No expone nada por sí mismo: sin clave válida, el
 *  /admin/panel de debajo responde 403. */
app.get('/admin', async (_req, reply) => {
  return reply.type('text/html; charset=utf-8').send(`<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CORRR — Panel</title>
<style>
  body{margin:0;background:#0A0A0A;color:#eee;font-family:-apple-system,Roboto,sans-serif}
  .gate{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{background:#161616;border:1px solid #262626;border-radius:14px;padding:28px;max-width:340px;width:100%}
  h1{color:#FF6600;font-size:20px;margin:0 0 6px}
  p{color:#888;font-size:13px;margin:0 0 18px}
  input{width:100%;background:#0A0A0A;border:1px solid #333;border-radius:8px;padding:12px;
    color:#fff;font-size:15px;box-sizing:border-box}
  button{width:100%;margin-top:12px;background:#FF6600;color:#fff;border:0;border-radius:8px;
    padding:12px;font-weight:700;font-size:15px;cursor:pointer}
  .err{color:#f44336;font-size:13px;margin-top:10px;min-height:18px}
</style></head><body>
<div id="app"><div class="gate"><form class="card" id="f">
  <h1>Panel de CORRR</h1>
  <p>Introduce la clave de administración.</p>
  <input type="password" id="k" autocomplete="current-password" autofocus>
  <button type="submit">Entrar</button>
  <div class="err" id="e"></div>
</form></div></div>
<script>
  async function load(key){
    const r = await fetch('/admin/panel', { headers: { 'x-admin-key': key } });
    if (!r.ok) throw new Error('Clave incorrecta');
    sessionStorage.setItem('corrr_admin_key', key);
    document.open(); document.write(await r.text()); document.close();
  }
  const saved = sessionStorage.getItem('corrr_admin_key');
  if (saved) load(saved).catch(() => sessionStorage.removeItem('corrr_admin_key'));
  document.getElementById('f').addEventListener('submit', async ev => {
    ev.preventDefault();
    const e = document.getElementById('e'); e.textContent = '';
    try { await load(document.getElementById('k').value); }
    catch (err) { e.textContent = err.message; }
  });
</script></body></html>`);
});

app.get('/admin/panel', { preHandler: requireAdmin }, async (req: any, reply) => {
  const esc = (s: any) =>
    String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const fmtDate = (d: any) =>
    d ? new Date(d).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtDur = (secs: number) => `${Math.floor(secs / 60)}'${String(Math.round(secs % 60)).padStart(2, '0')}"`;

  const [totals, signups, lastUsers, lastRuns] = await Promise.all([
    db.query(`SELECT
      (SELECT COUNT(*)::int FROM users)                                                    AS users,
      (SELECT COUNT(*)::int FROM users WHERE email_verified)                               AS verified,
      (SELECT COUNT(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '24 hours')    AS users_24h,
      (SELECT COUNT(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '7 days')      AS users_7d,
      (SELECT COUNT(*)::int FROM runs)                                                     AS runs,
      (SELECT COUNT(*)::int FROM runs WHERE created_at >= NOW() - INTERVAL '24 hours')     AS runs_24h,
      (SELECT COALESCE(ROUND(SUM(distance_km)::numeric, 1), 0) FROM runs)                  AS km,
      (SELECT COUNT(*)::int FROM cells)                                                    AS cells`),
    db.query(`SELECT DATE(created_at AT TIME ZONE 'Europe/Madrid') AS d, COUNT(*)::int AS n
              FROM users WHERE created_at >= NOW() - INTERVAL '14 days'
              GROUP BY d ORDER BY d DESC`),
    db.query(`SELECT u.display_name, u.email, u.city, u.email_verified, u.created_at,
                     COALESCE(s.total_runs, 0) AS total_runs,
                     COALESCE(s.total_km, 0)   AS total_km,
                     COALESCE(s.total_cells, 0) AS total_cells
              FROM users u LEFT JOIN user_stats s ON s.user_id = u.id
              ORDER BY u.created_at DESC NULLS LAST LIMIT 50`),
    db.query(`SELECT u.display_name, r.distance_km, r.duration_secs, r.points, r.created_at
              FROM runs r JOIN users u ON u.id = r.user_id
              ORDER BY r.created_at DESC LIMIT 20`),
  ]);
  const t = totals.rows[0];
  const maxSignups = Math.max(1, ...signups.rows.map((r: any) => r.n));

  const kpi = (label: string, value: any, sub = '') =>
    `<div class="kpi"><div class="v">${value}</div><div class="l">${label}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;

  const html = `<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="300">
<title>CORRR — Panel</title>
<style>
  body{margin:0;background:#0A0A0A;color:#eee;font-family:-apple-system,Roboto,sans-serif;padding:16px;}
  h1{color:#FF6600;font-size:22px;margin:0 0 4px;} .sub{color:#888;font-size:12px;margin-bottom:16px;}
  h2{font-size:15px;color:#FF6600;margin:24px 0 8px;text-transform:uppercase;letter-spacing:1px;}
  .kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;}
  .kpi{background:#161616;border:1px solid #262626;border-radius:12px;padding:12px;}
  .kpi .v{font-size:26px;font-weight:800;color:#fff;} .kpi .l{font-size:11px;color:#999;margin-top:2px;}
  .kpi .s{font-size:11px;color:#FF6600;margin-top:2px;}
  table{width:100%;border-collapse:collapse;font-size:13px;} .wrap{overflow-x:auto;}
  th{color:#888;text-align:left;font-weight:600;padding:6px 8px;border-bottom:1px solid #262626;font-size:11px;text-transform:uppercase;}
  td{padding:7px 8px;border-bottom:1px solid #1c1c1c;white-space:nowrap;}
  .ok{color:#4caf50;} .no{color:#f44336;}
  .bar{background:#FF6600;height:10px;border-radius:5px;display:inline-block;vertical-align:middle;margin-right:8px;}
  .day{color:#999;font-size:12px;padding:3px 0;}
  .btn{background:#FF6600;color:#fff;border:none;border-radius:20px;padding:8px 20px;font-weight:700;cursor:pointer;font-size:13px;}
  .form{display:grid;gap:8px;max-width:520px;}
  .form input,.form textarea,.form select{background:#0A0A0A;border:1px solid #333;border-radius:8px;
    padding:10px;color:#fff;font-size:14px;font-family:inherit;box-sizing:border-box;width:100%;}
  .form textarea{min-height:76px;resize:vertical;}
  .nota{color:#888;font-size:12px;margin:0 0 10px;}
  .aviso{background:#161616;border:1px solid #262626;border-radius:12px;padding:12px;margin-top:10px;max-width:520px;}
  .aviso h3{margin:0 0 4px;font-size:15px;color:#fff;} .aviso p{margin:0 0 8px;color:#bbb;font-size:13px;white-space:pre-wrap;}
  .aviso .meta{color:#888;font-size:12px;margin-bottom:8px;}
  .apagado{opacity:.5;}
  .mini{background:#262626;color:#eee;border:0;border-radius:16px;padding:6px 14px;font-size:12px;
    font-weight:700;cursor:pointer;margin-right:6px;}
  /* El corte de las esquinas se hace igual que en la app: el marco naranja
     debajo y el cartel encima, los dos con la misma esquina recortada. */
  .previo{background:#FF5500;padding:2px;max-width:364px;margin-top:10px;
    clip-path:polygon(28px 0,100% 0,100% calc(100% - 28px),calc(100% - 28px) 100%,0 100%,0 28px);}
  .previo .dentro{background:#080808;padding:20px;position:relative;overflow:hidden;
    clip-path:polygon(27px 0,100% 0,100% calc(100% - 27px),calc(100% - 27px) 100%,0 100%,0 27px);
    font-family:'Avenir Next Condensed','Roboto Condensed',Impact,sans-serif;}
  .previo .rayas{position:absolute;top:0;right:0;height:30px;width:130px;overflow:hidden;}
  .previo .rayas i{position:absolute;top:-10px;width:7px;height:56px;background:#FF5500;
    transform:skewX(-20deg);}
  .previo .etq{color:#fff;font-size:11px;font-weight:800;letter-spacing:1.6px;}
  .previo .t1{color:#fff;font-size:42px;line-height:40px;font-weight:900;letter-spacing:.5px;}
  .previo .sub{height:5px;background:#FF5500;margin:-4px 0 2px;}
  .previo .t2{display:inline-block;background:#FF5500;color:#080808;font-size:42px;line-height:46px;
    font-weight:900;padding:0 10px;}
  .previo .x{color:#fff;font-size:18px;line-height:22px;margin-top:14px;font-weight:700;}
  .previo .x b{color:#FF5500;font-weight:700;}
  .previo .pie{display:flex;gap:8px;margin-top:18px;align-items:stretch;}
  .previo .b{flex:1;background:#FF5500;color:#080808;padding:10px;text-align:center;
    font-weight:900;font-size:22px;letter-spacing:1px;transform:skewX(-12deg);}
  .previo .b span{display:inline-block;transform:skewX(12deg);}
  .previo .nt{border:1px solid #FF5500;color:#FF5500;font-size:12px;font-weight:700;
    padding:6px 10px;display:flex;flex-direction:column;justify-content:center;max-width:120px;}

</style></head><body>
<h1>CORRR — Panel de control</h1>
<div class="sub">Generado ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })} (hora Madrid) · se auto-refresca cada 5 min · <button class="btn" onclick="location.reload()">Actualizar</button></div>

<div class="kpis">
  ${kpi('Usuarios', t.users, `${t.verified} verificados`)}
  ${kpi('Altas 24h', t.users_24h, `${t.users_7d} esta semana`)}
  ${kpi('Carreras', t.runs, `${t.runs_24h} en 24h`)}
  ${kpi('Km totales', t.km)}
  ${kpi('Celdas conquistadas', t.cells)}
</div>

<h2>Altas por día (14 días)</h2>
${signups.rows.length === 0 ? '<div class="day">Sin altas todavía</div>' : signups.rows.map((r: any) =>
  `<div class="day">${esc(new Date(r.d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }))} <span class="bar" style="width:${Math.round((r.n / maxSignups) * 200)}px"></span>${r.n}</div>`).join('')}

<h2>Últimos usuarios (50)</h2>
<div class="wrap"><table>
<tr><th>Nombre</th><th>Email</th><th>Ciudad</th><th>Verif.</th><th>Alta</th><th>Carreras</th><th>Km</th><th>Celdas</th></tr>
${lastUsers.rows.map((u: any) =>
  `<tr><td><b>${esc(u.display_name)}</b></td><td>${esc(u.email)}</td><td>${esc(u.city)}</td>
   <td class="${u.email_verified ? 'ok' : 'no'}">${u.email_verified ? '✓' : '✗'}</td>
   <td>${fmtDate(u.created_at)}</td><td>${u.total_runs}</td><td>${Number(u.total_km).toFixed(1)}</td><td>${u.total_cells}</td></tr>`).join('')}
</table></div>

<h2>Últimas carreras (20)</h2>
<div class="wrap"><table>
<tr><th>Corredor</th><th>Km</th><th>Tiempo</th><th>Puntos</th><th>Cuándo</th></tr>
${lastRuns.rows.length === 0 ? '<tr><td colspan="5" style="color:#666">Sin carreras todavía</td></tr>' : lastRuns.rows.map((r: any) =>
  `<tr><td><b>${esc(r.display_name)}</b></td><td>${Number(r.distance_km).toFixed(2)}</td>
   <td>${fmtDur(r.duration_secs)}</td><td>${r.points}</td><td>${fmtDate(r.created_at)}</td></tr>`).join('')}
</table></div>

<h2>Aviso en la app</h2>
<p class="nota">El pop-up que sale al abrir la app. Se publica desde aquí, sin sacar versión nueva.
Sale UNA vez por persona; para repetirlo, se crea otro. Solo lo ven las apps 1.11.10 o más nuevas.</p>
<form class="form" id="fa">
  <input id="a_titulo" placeholder="Título — p. ej. NUEVO RETO" maxlength="60" required>
  <textarea id="a_texto" placeholder="Texto del aviso" maxlength="400" required></textarea>
  <input id="a_boton" placeholder="Texto del botón (si lo dejas vacío: VALE)" maxlength="24">
  <input id="a_enlace" placeholder="Enlace que abre el botón (opcional)">
  <input id="a_imagen" placeholder="Imagen, dirección https (opcional)">
  <input id="a_etiqueta" placeholder="Línea pequeña de arriba, p. ej. MAPA ACTUALIZADO (opcional)" maxlength="30">
  <input id="a_sello" placeholder="Sello de la esquina, p. ej. TERRITORIO LIBRE (opcional)" maxlength="24">
  <input id="a_nota" placeholder="Nota junto al botón, p. ej. AHORA / SIN CORTES (opcional)" maxlength="40">
  <select id="a_publico">
    <option value="todos">A todo el mundo</option>
    <option value="ciudad">Solo a una ciudad</option>
    <option value="sin-carreras">Solo a quien no ha corrido nunca</option>
    <option value="dormidos">Solo a quien no corre desde hace 2 semanas</option>
    <option value="pocos-puntos">Solo a quien tiene 100 puntos o menos (les cuenta doble)</option>
    <option value="ios">Solo a los de iPhone</option>
    <option value="android">Solo a los de Android</option>
    <option value="corredor">Solo a un corredor (para probarlo tú antes)</option>
  </select>
  <input id="a_ciudad" placeholder="Ciudad (p. ej. Barcelona)" style="display:none">
  <input id="a_corredor" placeholder="Nombre del corredor (p. ej. Ibanto)" style="display:none">
  <button class="btn" type="submit">Publicar aviso</button>
  <div class="err" id="a_err" style="color:#f44336;font-size:13px;"></div>
</form>
<div class="previo" id="previo"><div class="dentro">
  <div class="rayas" id="p_rayas"></div>
  <div class="etq" id="p_etiqueta"></div>
  <div class="t1" id="p_t1"></div><div class="sub" id="p_sub"></div>
  <div><span class="t2" id="p_t2">TÍTULO</span></div>
  <div class="x" id="p_texto">Así se verá en el móvil.</div>
  <div class="pie">
    <div class="b"><span id="p_boton">VALE</span></div>
    <div class="nt" id="p_nota" style="display:none"></div>
  </div>
</div></div>
<div id="lista_avisos"></div>

<h2>Strava</h2>
<p class="nota">Comprueba si nuestra app de Strava sigue funcionando con las claves de siempre.
La suscripción de pago la exigen para <b>crear</b> apps nuevas; la nuestra es anterior.</p>
<button class="btn" id="bstrava">Comprobar Strava</button>
<div id="strava_msg" style="font-size:13px;min-height:18px;margin-top:8px;"></div>

<h2>Bajas del correo</h2>
<p class="nota">Si alguien pide la baja <b>respondiendo al email</b> (Mail de Apple manda un correo a
hola@corrr.es en vez de avisarnos), apúntala aquí: si no, seguiría recibiendo campañas.
Quien usa el enlace del correo se da de baja solo.</p>
<form class="form" id="fb">
  <input id="b_quien" placeholder="Nombre del corredor o su email" required>
  <button class="btn" type="submit">Dar de baja del correo</button>
  <div id="b_msg" style="font-size:13px;min-height:18px;"></div>
</form>

<script>
  var K = sessionStorage.getItem('corrr_admin_key');
  function api(ruta, opts) {
    opts = opts || {};
    opts.headers = { 'Content-Type': 'application/json', 'x-admin-key': K };
    return fetch(ruta, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || 'Error del servidor');
        return d;
      });
    });
  }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var val = function (id) { return document.getElementById(id).value.trim(); };
  // Rayas de obra de la esquina, las mismas que pinta la app.
  for (var k = 0; k < 9; k++) {
    var r = document.createElement('i');
    r.style.right = (k * 13) + 'px';
    document.getElementById('p_rayas').appendChild(r);
  }
  function previo() {
    // El título se parte igual que en la app: lo de delante en blanco y la
    // última palabra sobre el bloque naranja.
    var t = (val('a_titulo') || 'TÍTULO').toUpperCase().replace(/\s+/g, ' ').trim();
    var corte = t.lastIndexOf(' ');
    document.getElementById('p_t1').textContent = corte === -1 ? '' : t.slice(0, corte);
    document.getElementById('p_sub').style.display = corte === -1 ? 'none' : 'block';
    document.getElementById('p_t2').textContent = corte === -1 ? t : t.slice(corte + 1);
    // Lo que va entre asteriscos sale en naranja, como en el móvil.
    var x = val('a_texto') || 'Así se verá en el móvil.';
    document.getElementById('p_texto').innerHTML = esc(x).split('*').map(function (trozo, i) {
      return i % 2 === 1 ? '<b>' + trozo + '</b>' : trozo;
    }).join('');
    document.getElementById('p_boton').textContent = '▶ ' + (val('a_boton') || 'VALE').toUpperCase();
    var etq = document.getElementById('p_etiqueta');
    etq.textContent = val('a_etiqueta').toUpperCase();
    var nota = val('a_nota');
    var caja = document.getElementById('p_nota');
    caja.style.display = nota ? 'flex' : 'none';
    caja.innerHTML = nota.split('/').slice(0, 2).map(function (l) {
      return '<div>' + esc(l.trim().toUpperCase()) + '</div>';
    }).join('');
  }
  ['a_titulo', 'a_texto', 'a_boton', 'a_etiqueta', 'a_nota'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', previo);
  });
  document.getElementById('a_publico').addEventListener('change', function (e) {
    document.getElementById('a_ciudad').style.display = e.target.value === 'ciudad' ? 'block' : 'none';
    document.getElementById('a_corredor').style.display = e.target.value === 'corredor' ? 'block' : 'none';
  });
  function pintar(avisos) {
    document.getElementById('lista_avisos').innerHTML = avisos.length === 0
      ? '<p class="nota">Todavía no has publicado ninguno.</p>'
      : avisos.map(function (a) {
        var quien = { todos: 'a todo el mundo', ciudad: 'solo en ' + esc(a.ciudad || ''),
          'sin-carreras': 'a quien no ha corrido nunca', dormidos: 'a quien no corre hace 2 semanas',
          'pocos-puntos': 'a quien tiene 100 puntos o menos',
          corredor: 'solo a ' + esc(a.corredor || ''),
          ios: 'solo a los de iPhone', android: 'solo a los de Android' }[a.publico];
        return '<div class="aviso' + (a.activo ? '' : ' apagado') + '">'
          + '<h3>' + esc(a.titulo) + (a.activo ? '' : ' · APAGADO') + '</h3>'
          + '<p>' + esc(a.texto) + '</p>'
          + '<div class="meta">' + quien + ' · lo han visto ' + a.vistas + ' de ' + a.publico_total + '</div>'
          + '<button class="mini" data-encender="' + a.id + '">' + (a.activo ? 'Apagar' : 'Encender') + '</button>'
          + '<button class="mini" data-borrar="' + a.id + '">Borrar</button></div>';
      }).join('');
  }
  function cargar() { api('/admin/avisos').then(pintar).catch(function () {}); }
  document.getElementById('lista_avisos').addEventListener('click', function (ev) {
    var enc = ev.target.getAttribute('data-encender');
    var bor = ev.target.getAttribute('data-borrar');
    if (enc) {
      var apagar = ev.target.textContent === 'Apagar';
      api('/admin/avisos/' + enc, { method: 'PUT', body: JSON.stringify({ activo: !apagar }) }).then(cargar);
    } else if (bor && confirm('¿Borrar este aviso? Deja de salir y se pierde el recuento de quién lo vio.')) {
      api('/admin/avisos/' + bor, { method: 'DELETE' }).then(cargar);
    }
  });
  document.getElementById('fa').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var err = document.getElementById('a_err'); err.textContent = '';
    api('/admin/avisos', { method: 'POST', body: JSON.stringify({
      titulo: val('a_titulo'), texto: val('a_texto'), boton: val('a_boton') || null,
      enlace: val('a_enlace') || null, imagen: val('a_imagen') || null,
      publico: document.getElementById('a_publico').value, ciudad: val('a_ciudad') || null,
      etiqueta: val('a_etiqueta') || null, sello: val('a_sello') || null,
      corredor: val('a_corredor') || null,
      nota: val('a_nota').split('/').slice(0, 2).map(function (l) { return l.trim(); }).join('\n') || null,
    }) }).then(function () {
      document.getElementById('fa').reset(); previo(); cargar();
    }).catch(function (e) { err.textContent = e.message; });
  });
  document.getElementById('fb').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var msg = document.getElementById('b_msg');
    msg.style.color = '#888'; msg.textContent = 'Un momento…';
    api('/admin/email/baja', { method: 'POST', body: JSON.stringify({ quien: val('b_quien') }) })
      .then(function (r) {
        msg.style.color = '#4caf50';
        msg.textContent = 'Hecho: ' + r.dados_de_baja.join(', ') + ' ya no recibirá más correos de campaña.';
        document.getElementById('fb').reset();
      })
      .catch(function (e) { msg.style.color = '#f44336'; msg.textContent = e.message; });
  });
  document.getElementById('bstrava').addEventListener('click', function () {
    var m = document.getElementById('strava_msg');
    m.style.color = '#888'; m.textContent = 'Preguntando a Strava…';
    api('/admin/strava/estado').then(function (r) {
      m.style.color = r.ok ? '#4caf50' : '#f44336';
      m.textContent = r.mensaje;
    }).catch(function (e) { m.style.color = '#f44336'; m.textContent = e.message; });
  });
  cargar();
</script>
</body></html>`;

  return reply.type('text/html; charset=utf-8').send(html);
});

// El endpoint /admin/wipe-users vivía aquí: vaciaba de golpe usuarios,
// carreras, celdas, taunts y amistades. Se hizo para un borrado puntual
// durante el desarrollo y se quedó, pero con la app ya publicada y gente
// real dentro era una mina: una sola petición, y todo fuera. La barrera
// del ?confirm=... no protege de lo que de verdad pasa (una clave
// filtrada, un copia-pega), solo de un despiste.
//
// No se sustituye por nada. Si algún día hay que vaciar la base de datos,
// se hace desde Supabase: cuesta más y obliga a pensarlo, que es
// justamente lo que quieres antes de un borrado irreversible.

/** ¿Sigue viva nuestra app de Strava? Lo pregunta a Strava con las claves que
 *  hay configuradas y contesta en cristiano. Sirve para saber si podemos usar
 *  su API sin pagar nada (la suscripción la exigen para CREAR apps nuevas; la
 *  nuestra es anterior) antes de escribirles o de tocar código. */
app.get('/admin/strava/estado', { preHandler: requireAdmin }, async (_req, reply) => {
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    return reply.send({ ok: false, mensaje: 'No hay claves de Strava configuradas en el servidor.' });
  }
  const url = `https://www.strava.com/api/v3/push_subscriptions?client_id=${STRAVA_CLIENT_ID}&client_secret=${STRAVA_CLIENT_SECRET}`;
  try {
    const res = await fetch(url);
    const texto = await res.text();
    if (res.ok) {
      let n = 0;
      try { n = (JSON.parse(texto) as any[]).length; } catch {}
      return reply.send({
        ok: true,
        mensaje: `La app de Strava responde bien (${n} aviso${n === 1 ? '' : 's'} automático${n === 1 ? '' : 's'} configurado${n === 1 ? '' : 's'}). Las claves siguen valiendo.`,
      });
    }
    return reply.send({
      ok: false,
      mensaje: `Strava responde ${res.status}: ${texto.slice(0, 200)}`,
    });
  } catch (e: any) {
    return reply.send({ ok: false, mensaje: `No se pudo preguntar a Strava: ${String(e?.message ?? e)}` });
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

/** Coordenada de celda máxima admisible. El planeta entero cabe de sobra:
 *  ±180° / CELL_LNG_DEG ≈ 1,53M. Fuera de esto son coords corruptas o
 *  fabricadas, y meterlas en la BD ensucia el grid global. */
const MAX_CELL_COORD = 1_600_000;

/** Holgura del tope de SUPERFICIE. Es un máximo matemático que una carrera
 *  real nunca alcanza, así que un 15% cubre el ruido del GPS de sobra. */
const RUN_AREA_TOLERANCE = 1.15;

/** Holgura del tope de EXTENSIÓN, mucho mayor. Contrastado con carreras
 *  reales: el GPS dispersa las celdas bastante más de lo que sugiere la
 *  distancia contabilizada (saltos de señal, distancia infracontada por el
 *  Doppler), y con un 15% se rechazaban carreras legítimas. El trabajo duro lo
 *  hace el tope de superficie, que sí es exacto; este solo caza dispersiones
 *  descaradas del tipo "celdas por toda la ciudad". */
const RUN_SPAN_TOLERANCE = 2.0;
const RUN_SPAN_FLOOR_M = 300;

/** Techo absoluto de celdas por carrera, independiente de lo que se declare.
 *  El tope isoperimétrico se dispara con distancias grandes (un supuesto
 *  ultramaratón de 100 km lo dejaría en millones), así que sin este techo
 *  bastaba con declarar una carrera larga para saltárselo. 25.000 celdas son
 *  2,5 km² — veinte veces la mayor conquista real registrada. */
const MAX_CELLS_PER_RUN = 25_000;

/** Velocidad máxima sostenida creíble. El récord de maratón ronda los 21 km/h;
 *  30 deja margen para ciclistas ocasionales y errores del GPS sin permitir
 *  "100 km en diez minutos". */
const MAX_AVG_SPEED_KMH = 30;

/** ¿Son las celdas reclamadas compatibles con la carrera declarada?
 *
 *  Sin esto, /runs se limitaba a comprobar que la distancia fuese < 100 km y
 *  que el array no pasara de 50.000 celdas — pero NO que las celdas tuvieran
 *  nada que ver con la carrera. Cualquiera con una cuenta podía mandar una
 *  petición con 50.000 celdas de toda la ciudad y quedarse con el territorio
 *  de todos los usuarios de una sentada, porque el UPSERT de más abajo
 *  reasigna owner_id sin preguntar.
 *
 *  Dos límites, ambos derivados de la física del recorrido:
 *
 *  1. EXTENSIÓN. Un recorrido de D metros no puede separarse más de D metros
 *     de su punto de partida (el caso extremo es la línea recta), así que la
 *     diagonal de la caja que contiene las celdas no puede superar D.
 *
 *  2. SUPERFICIE. Por la desigualdad isoperimétrica, la mayor área que puede
 *     encerrar una curva cerrada de perímetro P es la del círculo: P²/4π. Como
 *     el flood-fill solo rellena lo que el corredor encierra, y su perímetro
 *     no puede exceder la distancia recorrida, el área total reclamable está
 *     acotada. Le sumamos el propio rastro (D/10 celdas) porque una carrera en
 *     línea recta pinta celdas sin encerrar nada.
 *
 *  Devuelve null si todo correcto, o el motivo del rechazo. */
function validateClaimedCellsGeometry(
  cells: { x: number; y: number }[],
  distanceKm: number,
  durationSecs: number,
): string | null {
  if (cells.length === 0) return null;

  if (cells.length > MAX_CELLS_PER_RUN) {
    return 'demasiadas celdas para una sola carrera';
  }

  // Velocidad media creíble. Sin esto bastaba con declarar una distancia
  // enorme para ensanchar todos los límites de abajo.
  if (durationSecs > 0) {
    const speedKmh = distanceKm / (durationSecs / 3600);
    if (speedKmh > MAX_AVG_SPEED_KMH) {
      return 'la velocidad media declarada no es creíble';
    }
  }

  for (const c of cells) {
    if (!Number.isInteger(c?.x) || !Number.isInteger(c?.y)) {
      return 'claimedCells contiene coordenadas no enteras';
    }
    if (Math.abs(c.x) > MAX_CELL_COORD || Math.abs(c.y) > MAX_CELL_COORD) {
      return 'claimedCells contiene coordenadas fuera del planeta';
    }
  }

  const distanceM = distanceKm * 1000;

  // 1. Extensión: la caja envolvente no puede ser mayor que el recorrido.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of cells) {
    if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
  }
  const widthM  = (maxX - minX + 1) * CELL_SIZE_M;
  const heightM = (maxY - minY + 1) * CELL_SIZE_M;
  const diagonalM = Math.hypot(widthM, heightM);
  // Suelo: en carreras muy cortas el redondeo a celdas domina sobre la
  // distancia y un corredor legítimo daría falso positivo.
  const maxSpanM = Math.max(distanceM * RUN_SPAN_TOLERANCE, RUN_SPAN_FLOOR_M);
  if (diagonalM > maxSpanM) {
    return 'las celdas cubren un área mayor que la distancia recorrida';
  }

  // 2. Superficie: tope isoperimétrico + el propio rastro.
  const maxEnclosedCells = (distanceM * distanceM) / (4 * Math.PI * CELL_SIZE_M * CELL_SIZE_M);
  const trailCells = distanceM / CELL_SIZE_M;
  const maxCells = Math.ceil((maxEnclosedCells + trailCells) * RUN_AREA_TOLERANCE) + 20;
  if (cells.length > maxCells) {
    return 'demasiadas celdas para la distancia recorrida';
  }

  return null;
}

app.post('/runs', {
  preHandler: requireAuth,
  // Nadie corre 20 veces en una hora. Sin este límite, el endpoint solo tenía
  // el global de 500/min, suficiente para automatizar la conquista del mapa.
  // Va por USUARIO, no por IP: el endpoint está autenticado, y con la clave
  // por IP bastaría con cambiar de red (o salir por CGNAT) para esquivarlo.
  config: {
    rateLimit: {
      max: 20,
      timeWindow: '1 hour',
      keyGenerator: (req: any) => req.userId ?? req.ip,
    },
  },
}, async (req: any, reply) => {
  // `points` (legacy) is the client's estimate. We recompute authoritatively
  // server-side below using loopBonus + cellPoints + kmPoints * multipliers.
  const { distanceKm, durationSecs, points: clientPointsEstimate, loopBonus, loopClosed, zonesCount, zones, claimedCells,
          source, externalId, startedAt, endedAt, diag } = req.body ?? {};

  // Sanitización + límites anti-cheat. Aunque la lógica de puntos se
  // recomputa server-side, valores absurdos en los inputs (carreras de
  // 10000 km, arrays de millones de celdas) podrían romper queries o
  // dejar runs falsos en la BD. Top-cap a valores físicos creíbles:
  //   - distanceKm: máx 100 km por carrera (ultramarathon teórico).
  //   - durationSecs: máx 24h.
  //   - claimedCells: máx 50.000 celdas (~500 km de territorio, holgado).
  //   - zones: máx 200.
  const isFiniteNum = (v: any) => typeof v === 'number' && Number.isFinite(v);

  // `diag` viene del móvil: se guarda solo si son números y son pocos, para
  // que nadie pueda meter ahí texto libre ni un objeto enorme.
  let diagSafe: Record<string, number> | null = null;
  if (diag && typeof diag === 'object' && !Array.isArray(diag)) {
    const pares = Object.entries(diag)
      .filter(([k, v]) => /^[a-zA-Z]{1,20}$/.test(k) && isFiniteNum(v))
      .slice(0, 20)
      .map(([k, v]) => [k, Math.round(v as number)]);
    if (pares.length > 0) diagSafe = Object.fromEntries(pares);
  }
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

  // ── Cuándo se corrió ─────────────────────────────────────────────────────
  // Las carreras del Apple Watch llegan horas después de correrse. Para que el
  // territorio sea justo, una celda la gana quien PASÓ por ella más tarde, no
  // quien guardó más tarde: si alguien te la quitó a mediodía, tu carrera de
  // la mañana importada por la noche no se la vuelve a robar.
  //
  // La app manda startedAt/endedAt desde la 1.11.6. Las versiones anteriores
  // no, y para ellas la carrera acaba "ahora", como hasta hoy.
  const isImport = source === 'healthkit';
  if (source !== undefined && source !== 'app' && !isImport) {
    return reply.status(400).send({ error: 'source no válido' });
  }
  const nowMs = Date.now();
  let runStartMs = nowMs - durationSecs * 1000;
  let runEndMs = nowMs;
  if (startedAt !== undefined || endedAt !== undefined) {
    const s = typeof startedAt === 'string' ? Date.parse(startedAt) : NaN;
    const e = typeof endedAt === 'string' ? Date.parse(endedAt) : NaN;
    if (!Number.isFinite(s) || !Number.isFinite(e) || s >= e || e > nowMs + 5 * 60_000 || e - s > 86_400_000) {
      return reply.status(400).send({ error: 'startedAt/endedAt no válidos' });
    }
    runStartMs = s;
    runEndMs = e;
  }
  if (isImport) {
    if (typeof externalId !== 'string' || externalId.length < 8 || externalId.length > 100) {
      return reply.status(400).send({ error: 'externalId no válido' });
    }
    if (startedAt === undefined) {
      return reply.status(400).send({ error: 'Una carrera importada necesita startedAt y endedAt' });
    }
    // La app solo importa entrenos posteriores a conectar el reloj; esto es un
    // tope por si acaso, para que nadie se traiga meses de carreras de golpe.
    if (nowMs - runEndMs > 8 * 86_400_000) {
      return reply.status(400).send({ error: 'Entreno demasiado antiguo para importar' });
    }
  }
  // Las carreras hechas con la app ganan sus celdas "ahora", igual que siempre,
  // con la hora de la propia base de datos (NOW()): así ni el reloj del móvil
  // ni una diferencia de reloj entre Railway y Supabase pueden bloquear un robo.
  const claimAtMs = runEndMs;

  // Duplicados de una importación: el mismo entreno otra vez, o una carrera
  // que ya registraste con CORRR a la vez que con el reloj (se solapan más de
  // la mitad). Las carreras antiguas no guardaban la hora de fin: su
  // started_at es el momento de guardarlas, y empezaron duration_secs antes.
  if (isImport) {
    const { rows: dup } = await db.query(
      `SELECT id FROM runs
       WHERE user_id = $1
         AND (external_id = $2 OR (
           LEAST(COALESCE(ended_at, started_at), $4::timestamptz)
           - GREATEST(CASE WHEN ended_at IS NULL
                           THEN started_at - make_interval(secs => duration_secs)
                           ELSE started_at END, $3::timestamptz)
           > ($4::timestamptz - $3::timestamptz) * 0.5
         ))
       LIMIT 1`,
      [req.userId, externalId, new Date(runStartMs).toISOString(), new Date(runEndMs).toISOString()],
    );
    if (dup.length > 0) return reply.send({ duplicate: true, runId: dup[0].id });
  }

  // Coherencia geométrica: las celdas tienen que ser compatibles con la
  // carrera declarada. Ver validateClaimedCellsGeometry — es lo que impide
  // reclamar territorio arbitrario con una petición fabricada.
  //
  // NO se rechaza la carrera: se anota y se guarda igual. Esta comprobación
  // rechazaba, y tiró carreras de corredoras reales — la carrera se perdía
  // para siempre, el mapa del móvil quedaba diciendo una cosa y el servidor
  // otra, y la persona se quedaba sin su esfuerzo y sin explicación.
  //
  // El error de los dos lados no cuesta lo mismo. Si acepto por error a un
  // tramposo, gana unas celdas que puedo revertir en cuanto lo vea. Si
  // rechazo por error a alguien que ha salido a correr, le borro su carrera
  // y probablemente lo pierdo como usuario. Lo primero se arregla; lo
  // segundo no. Así que ante la duda, se guarda.
  //
  // La señal anti-trampas no se pierde: queda registrada en flagged_reason y
  // en el log con las cifras, para poder revisarla y calibrar el umbral con
  // datos reales en vez de a ojo. Los topes duros de más arriba (distancia
  // 0-100 km, máximo de celdas, velocidad media) sí siguen rechazando: esos
  // son físicamente imposibles, no discutibles.
  let flaggedReason: string | null = null;
  if (Array.isArray(claimedCells) && claimedCells.length > 0) {
    flaggedReason = validateClaimedCellsGeometry(claimedCells, distanceKm, durationSecs);
    if (flaggedReason) {
      req.log.warn(
        {
          userId: req.userId,
          cells: claimedCells.length,
          distanceKm,
          durationSecs,
          reason: flaggedReason,
          // Cifras para poder recalibrar sin adivinar.
          maxCellsPermitidas: Math.ceil(
            (((distanceKm * 1000) ** 2) / (4 * Math.PI * CELL_SIZE_M * CELL_SIZE_M)
              + (distanceKm * 1000) / CELL_SIZE_M) * RUN_AREA_TOLERANCE,
          ) + 20,
        },
        '[anti-cheat] carrera MARCADA (se guarda igual) por geometría inusual',
      );
    }
  }

  const userId = req.userId;
  const client = await db.connect();

  const stolenZones: { id: string; ownerName: string; points: number }[] = [];
  const stolenCells: { x: number; y: number; prevOwnerId: string; prevOwnerName: string }[] = [];

  try {
    await client.query('BEGIN');

    // created_at es la fecha que ve el usuario en su historial: para una
    // importada, la del entreno, no la de la importación (como con Strava).
    const { rows } = await client.query(
      `INSERT INTO runs (user_id, distance_km, duration_secs, points, zones_count, flagged_reason,
                         started_at, ended_at, created_at, source, external_id, diag)
       VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9::timestamptz,$10,$11,$12::jsonb) RETURNING id`,
      [userId, distanceKm, durationSecs, clientPointsEstimate || 0, zonesCount, flaggedReason,
       new Date(runStartMs).toISOString(), new Date(runEndMs).toISOString(),
       new Date(isImport ? runEndMs : nowMs).toISOString(),
       isImport ? 'healthkit' : 'app', isImport ? externalId : null,
       diagSafe ? JSON.stringify(diagSafe) : null]
    );
    const runId = rows[0].id;

    // ── Grid (v2) — process claimedCells if present ──────────────────────────
    // Coexists with the polygon logic below. v1.5.x clients send only `zones`,
    // v1.6+ clients send `claimedCells`. Server handles whichever arrives.
    let newCellCount = 0;
    let newerCellsKept = 0;
    if (Array.isArray(claimedCells) && claimedCells.length > 0) {
      // Bounding box of all claims — used to fetch existing ownership in one query.
      const xs = claimedCells.map((c: any) => c.x);
      const ys = claimedCells.map((c: any) => c.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);

      const { rows: existing } = await client.query(
        `SELECT cell_x, cell_y, owner_id, claimed_at FROM cells
         WHERE cell_x BETWEEN $1 AND $2 AND cell_y BETWEEN $3 AND $4`,
        [minX, maxX, minY, maxY]
      );
      const existingMap = new Map<string, { owner: string; at: number }>();
      for (const e of existing) {
        existingMap.set(`${e.cell_x},${e.cell_y}`, {
          owner: e.owner_id,
          at: e.claimed_at ? new Date(e.claimed_at).getTime() : 0,
        });
      }

      // Classify: new claims vs robos vs self-reclaims — y las que NO se tocan
      // porque alguien pasó por ellas después de esta carrera (solo ocurre con
      // importadas: una carrera de la app siempre es la más reciente).
      const robosByPrevOwner = new Map<string, { x: number; y: number }[]>();
      const toClaim: { x: number; y: number }[] = [];
      for (const c of claimedCells) {
        const prev = existingMap.get(`${c.x},${c.y}`);
        if (!prev) {
          newCellCount++;
        } else if (isImport && prev.at > claimAtMs) {
          newerCellsKept++;
          continue;
        } else if (prev.owner !== userId) {
          const list = robosByPrevOwner.get(prev.owner) ?? [];
          list.push({ x: c.x, y: c.y });
          robosByPrevOwner.set(prev.owner, list);
        }
        // prev.owner === userId → self-reclaim, just refresh timestamp (no count change)
        toClaim.push({ x: c.x, y: c.y });
      }

      // Batch upsert all claimed cells. ON CONFLICT transfers ownership for robos
      // and refreshes the timestamp for self-reclaims.
      // claimed_at = cuándo se pasó por la celda. El WHERE repite la regla de
      // arriba dentro de la base de datos, por si dos carreras se guardan a la vez.
      const xArr = toClaim.map(c => c.x);
      const yArr = toClaim.map(c => c.y);
      await client.query(
        `INSERT INTO cells (cell_x, cell_y, owner_id, run_id, claimed_at)
         SELECT x, y, $3::uuid, $4::uuid, COALESCE($5::timestamptz, NOW())
         FROM unnest($1::int[], $2::int[]) AS t(x, y)
         ON CONFLICT (cell_x, cell_y) DO UPDATE
         SET owner_id = EXCLUDED.owner_id, run_id = EXCLUDED.run_id, claimed_at = EXCLUDED.claimed_at
         WHERE COALESCE(cells.claimed_at, '-infinity'::timestamptz) <= EXCLUDED.claimed_at`,
        [xArr, yArr, userId, runId, isImport ? new Date(claimAtMs).toISOString() : null]
      );
      // El mapa de esta zona acaba de cambiar de dueño: tira su caché para que
      // el robo se vea al instante y no dentro de 30 segundos.
      invalidateViewportCache(toClaim);

      // Aquí solo se restan CELDAS. Los puntos de la víctima se descuentan más
      // abajo, en el bloque que recorre stolenCells (1 punto por celda). Están
      // separados desde el principio; restarlos también aquí penalizaba el
      // doble — comprobado con un robo real: 12 puntos por 6 celdas.
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
            // Se dice el coste en puntos a propósito: si la penalización no se ve,
            // no genera ninguna reacción. Es 1 punto por celda, mismo número.
            `${thief[0]?.display_name ?? 'Alguien'} te ha quitado ${robosList.length} ${robosList.length === 1 ? 'celda' : 'celdas'} y ${robosList.length} ${robosList.length === 1 ? 'punto' : 'puntos'}`
              // Una importada roba con horas de retraso: se dice cuándo corrió,
              // para que no parezca que alguien te está robando ahora mismo.
              + (isImport ? ` con su Apple Watch ${formatRunMoment(runStartMs)}` : '')
              + '. ¡Sal a recuperarlas!'
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
      'SELECT last_run_date, streak_days, best_daily_km, total_points FROM user_stats WHERE user_id = $1',
      [userId]
    );
    const prevStats = statsRows[0] || { last_run_date: null, streak_days: 0, best_daily_km: 0, total_points: 0 };
    // El día de la carrera, no el de guardarla: una importada de ayer cuenta
    // para ayer. Si es anterior a tu última carrera, la racha no se toca (ni
    // se rompe ni se mueve la fecha hacia atrás).
    // Carreras de la app: la fecha del servidor, como siempre (el reloj del
    // móvil puede ir mal). Importadas: la del entreno.
    const today = new Date(isImport ? runEndMs : nowMs); today.setUTCHours(0, 0, 0, 0);
    let newStreak = 1;
    let lastRunDay = today;
    if (prevStats.last_run_date) {
      const last = new Date(prevStats.last_run_date); last.setUTCHours(0, 0, 0, 0);
      const diffDays = Math.round((today.getTime() - last.getTime()) / 86_400_000);
      if (diffDays < 0) { newStreak = prevStats.streak_days || 1; lastRunDay = last; }
      else if (diffDays === 0) newStreak = prevStats.streak_days || 1; // same day, keep
      else if (diffDays === 1) newStreak = (prevStats.streak_days || 0) + 1; // consecutive
      // else: streak broken, newStreak stays at 1
    }
    // DOBLE PARA QUIEN EMPIEZA. Con 100 puntos o menos —que es prácticamente
    // nadie que haya corrido un par de veces— la carrera cuenta doble. Está
    // pensado para el primer empujón: quien se registra y no sale, o sale una
    // vez y ve cuatro puntos al lado de los miles de los demás, no vuelve.
    // Se apaga solo en cuanto pasa de 100, así que no hace falta gestionarlo
    // ni caduca; y se mira lo que tenía ANTES de esta carrera, para que la
    // que le hace pasar de 100 también cuente doble.
    const dobleBienvenida = Number(prevStats.total_points || 0) <= 100;
    const streakMultiplier = newStreak >= 3 ? 1.5 : 1;
    const pbMultiplier = distanceKm > (prevStats.best_daily_km || 0) ? 1.2 : 1;
    const newBestKm = Math.max(prevStats.best_daily_km || 0, distanceKm || 0);

    const kmPoints = Math.round(kmPointsBase * pbMultiplier);
    const subtotal = kmPoints + cellPoints + safeLoopBonus;
    // Siempre recomputamos server-side (el bypass legacy que confiaba el
    // estimate del cliente se ha eliminado). clientPointsEstimate solo se usa
    // ya como valor de display optimista en el cliente, nunca aquí.
    const authoritativePoints = Math.round(subtotal * streakMultiplier * (dobleBienvenida ? 2 : 1));

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
       lastRunDay.toISOString().slice(0, 10), newStreak, newBestKm]
    );

    // Check and unlock achievements
    await checkAchievements(client, userId);

    await client.query('COMMIT');
    return reply.status(201).send({
      runId,
      stolenZones,
      stolenCells,
      newCellCount,
      // Celdas de la carrera que se quedan con quien pasó por ellas después.
      newerCellsKept,
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
        // Para que la app pueda enseñar de dónde sale el ×2 en vez de un
        // número que no cuadra con el desglose.
        dobleBienvenida,
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
      `SELECT id, distance_km, duration_secs, points, zones_count, created_at, source
       FROM runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.userId, limit, offset]
    ),
    db.query(`SELECT COUNT(*)::int AS total FROM runs WHERE user_id = $1`, [req.userId]),
  ]);
  return reply.send({ runs: rowsRes.rows, total: countRes.rows[0]?.total ?? 0, limit, offset });
});

// ── Stats ─────────────────────────────────────────────────────────────────────

/** GET /territory/:userId — el marcador de territorio de un corredor.
 *
 *  Sirve tanto para tu propio perfil como para el de un rival al tocar su
 *  zona en el mapa, así que devuelve lo mismo en ambos casos.
 *
 *  Los porcentajes se miden sobre el territorio YA CONQUISTADO, no sobre la
 *  superficie real del municipio ni de España. Es una decisión, no un atajo:
 *  medido contra el terreno real, el mejor corredor tiene el 0,46% de su
 *  ciudad y el 0,000122% de España — números que no dicen nada y que no van a
 *  mejorar, porque España son 505.990 km2. Contado sobre lo conquistado, ese
 *  mismo corredor tiene el 69% de Valencia y es el nº 2 del país: eso sí se
 *  entiende y se persigue.
 *
 *  Y tiene un efecto buscado: tu porcentaje BAJA cuando entra gente nueva a
 *  tu ciudad, aunque nadie te robe. Empuja a salir a correr.
 *
 *  Además va el área absoluta, que es el dato honesto y no depende de con
 *  quién te compares. */
app.get('/territory/:userId', { preHandler: requireAuth }, async (req: any, reply) => {
  const { userId } = req.params as any;
  if (!/^[0-9a-f-]{36}$/i.test(String(userId))) {
    return reply.status(400).send({ error: 'userId no válido' });
  }

  // Sin avatar_url a propósito: las fotos se guardan como la imagen entera en
  // base64 (hasta 2,3 MB) y esta respuesta solo debería llevar números. Quien
  // la necesita ya la tiene por otra vía — el mapa la manda en `owners` y el
  // perfil propio la tiene en su ficha.
  const { rows: u } = await db.query(
    'SELECT display_name, city FROM users WHERE id = $1',
    [userId],
  );
  if (u.length === 0) return reply.status(404).send({ error: 'Usuario no encontrado' });
  const user = u[0];

  // La ciudad se guarda como texto libre, así que "Valencia" y "València"
  // conviven. Se comparan sin distinguir mayúsculas ni acentos (unaccent no
  // está disponible, así que se normaliza a mano lo que aparece de verdad).
  const cityKey = (user.city ?? '').trim();

  const [mine, cityTotal, national, ranking] = await Promise.all([
    db.query('SELECT count(*)::int n FROM cells WHERE owner_id = $1', [userId]),
    cityKey
      ? db.query(
          `SELECT count(*)::int n FROM cells c JOIN users u ON u.id = c.owner_id
            WHERE LOWER(TRANSLATE(u.city, 'àèìòùáéíóúÀÈÌÒÙÁÉÍÓÚ', 'aeiouaeiouAEIOUAEIOU'))
                = LOWER(TRANSLATE($1,     'àèìòùáéíóúÀÈÌÒÙÁÉÍÓÚ', 'aeiouaeiouAEIOUAEIOU'))`,
          [cityKey],
        )
      : Promise.resolve({ rows: [{ n: 0 }] } as any),
    db.query('SELECT count(*)::int n FROM cells', []),
    db.query(
      `SELECT owner_id, count(*)::int n FROM cells GROUP BY owner_id ORDER BY n DESC`,
      [],
    ),
  ]);

  const cells = mine.rows[0]?.n ?? 0;
  const cityCells = cityTotal.rows[0]?.n ?? 0;
  const allCells = national.rows[0]?.n ?? 0;
  const pos = ranking.rows.findIndex((r: any) => r.owner_id === userId);

  return reply.send({
    displayName: user.display_name,
    city: cityKey || null,
    cells,
    // Cada celda son 10x10 m = 100 m2. Se manda en metros cuadrados y que
    // decida el cliente cómo presentarlo (m2 o hectáreas según tamaño).
    areaM2: cells * 100,
    citySharePct: cityCells > 0 ? Math.round((cells / cityCells) * 100) : null,
    nationalSharePct: allCells > 0 ? Math.round((cells / allCells) * 1000) / 10 : 0,
    nationalRank: pos >= 0 ? pos + 1 : null,
    nationalTotal: ranking.rows.length,
  });
});

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
// ── Caché del mapa ───────────────────────────────────────────────────────────
// /cells/viewport es la consulta caliente: se dispara cada vez que alguien
// mueve el mapa e iba directa a la base de datos. Es lo primero que se
// atascará al crecer, así que la cacheamos.
//
// Dos decisiones que la hacen realmente útil:
//
//   · CUADRÍCULA. Si la clave fuese el viewport exacto, cada pixel de
//     desplazamiento generaría una clave distinta y el caché no acertaría
//     jamás. Redondeamos la caja hacia fuera a múltiplos de VIEWPORT_TILE
//     celdas: los encuadres parecidos caen en la misma casilla y comparten
//     resultado.
//
//   · SIN "is_mine". La consulta marcaba qué celdas son tuyas, lo que haría
//     el caché privado de cada usuario y por tanto casi inservible. Ahora
//     guardamos los dueños en crudo —iguales para todos— y el "es mía" se
//     calcula al responder. Así un barrio se consulta una vez y sirve a
//     todos los que lo miren.
//
// En memoria del proceso, no en Redis: con una sola réplica en Railway es más
// rápido (sin salto de red) y no añade otra pieza que pueda fallar. Si algún
// día hay varias réplicas, cada una tendrá su copia — sigue funcionando, solo
// que con menos aciertos, y ahí sí compensaría Redis.
const VIEWPORT_TILE = 128;              // celdas por lado (≈1,3 km)
const VIEWPORT_TTL_MS = 30_000;
// Tope de celdas por respuesta. Estaba en 5.000 y se quedó corto: con la
// cuña de KarolK (47.000 celdas) en el Eixample, la casilla de la Sagrada
// Família tenía 25.294, y como salían ordenadas por cell_x, las que pasaban
// del tope eran las del este — el mapa cortaba todo el territorio con una
// recta vertical en la longitud 2,17298 (Ibanto, 21-sep: "la diagonal que
// cruza los edificios"). Ahora el tope es mucho más alto y, si se alcanza,
// se quedan fuera las celdas MÁS LEJANAS al centro, no las del este.
const VIEWPORT_MAX_CELLS = 40_000;
// Menos entradas que antes y en formato compacto: una casilla densa son
// decenas de miles de celdas, y como objetos sueltos ocuparían varios MB
// cada una.
const VIEWPORT_CACHE_MAX = 120;
type ViewportEntry = {
  expires: number;
  /** 4 enteros por celda: x, y, índice del dueño, claimed_at en segundos. */
  datos: Int32Array;
  n: number;
  duenos: { id: string; name: string | null; warCry: string | null }[];
};
const viewportCache = new Map<string, ViewportEntry>();

// ── Formato "tiras" (app 1.11.10+) ───────────────────────────────────────────
// En vez de una fila por celda, una fila por TIRA: celdas seguidas de un mismo
// dueño en una misma fila del mapa ("de x0 a x1 en la fila y, todo de
// Ibanto"). La casilla de la Sagrada Família son 25.294 celdas y 1.072 tiras.
// Con eso no hace falta ningún tope: aunque una zona se llene entera, la
// respuesta sigue siendo pequeña. Era el tope lo que cortaba el mapa con una
// recta vertical (21-sep).
//
// El formato viejo se mantiene para las apps ya instaladas.
type StripsEntry = {
  expires: number;
  /** 4 enteros por tira: índice del dueño, y, x0, x1. */
  tiras: Int32Array;
  n: number;
  duenos: Dueno[];
};
const stripsCache = new Map<string, StripsEntry>();
// Red de seguridad para la memoria del servidor, no un límite de uso: hoy hay
// 95.000 celdas en TODA España (21-sep-2026). Si algún día una sola pantalla
// llega a esto, avisa en el registro y hay que repensarlo (bajar el zoom
// máximo con territorio, o tiras precalculadas en la base de datos).
const STRIPS_MAX_CELLS = 400_000;

/** Foto (miniatura) de cada dueño, una vez por dueño y no por celda. */
async function ownerAvatars(ownerIds: string[], log: any): Promise<Record<string, { avatar: string | null }>> {
  const owners: Record<string, { avatar: string | null }> = {};
  if (ownerIds.length === 0) return owners;
  const av = await db.query(
    `SELECT id, avatar_thumb, avatar_url FROM users WHERE id = ANY($1::uuid[]) AND avatar_url IS NOT NULL`,
    [ownerIds],
  );
  for (const o of av.rows) {
    let thumb: string | null = o.avatar_thumb;
    if (!thumb) {
      // Primera vez que se ve a este corredor desde el cambio: se genera la
      // miniatura y se guarda, así solo pasa una vez por usuario. Si la foto
      // no se puede leer, se manda la original (como antes) para no dejar a
      // nadie sin foto por un fallo nuestro.
      thumb = await makeAvatarThumb(o.avatar_url);
      if (thumb) {
        await db.query(`UPDATE users SET avatar_thumb = $1 WHERE id = $2`, [thumb, o.id]);
      } else {
        log.warn({ userId: o.id }, 'no se pudo hacer la miniatura del avatar');
      }
    }
    owners[o.id] = { avatar: thumb ?? o.avatar_url };
  }
  return owners;
}

async function loadStrips(x0: number, x1: number, y0: number, y1: number, log: any): Promise<StripsEntry> {
  const q = await db.query(
    `SELECT c.cell_x, c.cell_y, c.owner_id, u.display_name AS owner_name, u.war_cry AS owner_war_cry
       FROM cells c
       JOIN users u ON u.id = c.owner_id
      WHERE c.cell_x BETWEEN $1 AND $2 AND c.cell_y BETWEEN $3 AND $4
      LIMIT $5`,
    [x0, x1, y0, y1, STRIPS_MAX_CELLS],
  );
  if (q.rows.length >= STRIPS_MAX_CELLS) {
    log.warn({ x0, x1, y0, y1 }, '[viewport] casilla con más celdas de las esperables');
  }
  return { expires: Date.now() + VIEWPORT_TTL_MS, ...agruparEnTiras(q.rows) };
}

app.get('/cells/viewport', { preHandler: requireAuth }, async (req: any, reply) => {
  const { north, south, east, west } = req.query as any;
  const n = parseFloat(north), s = parseFloat(south);
  const e = parseFloat(east), w = parseFloat(west);
  if (![n, s, e, w].every(Number.isFinite)) {
    return reply.status(400).send({ error: 'north, south, east, west requeridos (float)' });
  }

  const swCell = coordToCell(s, w);
  const neCell = coordToCell(n, e);

  // Redondeo hacia fuera: nunca devolvemos menos de lo pedido.
  const x0 = Math.floor(swCell.x / VIEWPORT_TILE) * VIEWPORT_TILE;
  const x1 = Math.ceil((neCell.x + 1) / VIEWPORT_TILE) * VIEWPORT_TILE;
  const y0 = Math.floor(swCell.y / VIEWPORT_TILE) * VIEWPORT_TILE;
  const y1 = Math.ceil((neCell.y + 1) / VIEWPORT_TILE) * VIEWPORT_TILE;
  const cacheKey = `${x0}:${x1}:${y0}:${y1}`;

  if (String(req.query?.formato ?? '') === 'tiras') {
    let st = stripsCache.get(cacheKey);
    if (!st || st.expires <= Date.now()) {
      st = await loadStrips(x0, x1, y0, y1, req.log);
      if (stripsCache.size >= VIEWPORT_CACHE_MAX) {
        const now = Date.now();
        for (const [k, v] of stripsCache) if (v.expires <= now) stripsCache.delete(k);
        if (stripsCache.size >= VIEWPORT_CACHE_MAX) {
          const oldest = stripsCache.keys().next().value;
          if (oldest !== undefined) stripsCache.delete(oldest);
        }
      }
      stripsCache.set(cacheKey, st);
    }
    const avatares = await ownerAvatars(st.duenos.map(d => d.id), req.log);
    return reply.send({
      formato: 'tiras',
      duenos: st.duenos.map(d => ({ id: d.id, name: d.name, warCry: d.warCry, mine: d.id === req.userId })),
      // Plano: dueño, y, x0, x1, dueño, y, x0, x1…
      tiras: Array.from(st.tiras),
      owners: avatares,
    });
  }

  let entry = viewportCache.get(cacheKey);
  if (!entry || entry.expires <= Date.now()) {
    // Ordenadas por cercanía al centro de la casilla: si algún día se llega
    // al tope, lo que se pierde son los bordes, repartido, y no una franja
    // entera del mapa. El centro es el de la casilla (no el de quien pide)
    // para que la respuesta cacheada sirva igual a todos.
    const cx = Math.round((x0 + x1) / 2);
    const cy = Math.round((y0 + y1) / 2);
    const q = await db.query(
      `SELECT c.cell_x, c.cell_y, c.owner_id,
              EXTRACT(EPOCH FROM c.claimed_at)::int AS claimed_s,
              u.display_name AS owner_name, u.war_cry AS owner_war_cry
       FROM cells c
       JOIN users u ON u.id = c.owner_id
       WHERE c.cell_x BETWEEN $1 AND $2 AND c.cell_y BETWEEN $3 AND $4
       ORDER BY (c.cell_x - $5) * (c.cell_x - $5) + (c.cell_y - $6) * (c.cell_y - $6)
       LIMIT $7`,
      [x0, x1, y0, y1, cx, cy, VIEWPORT_MAX_CELLS]
    );
    if (q.rows.length >= VIEWPORT_MAX_CELLS) {
      req.log.warn({ cacheKey, tope: VIEWPORT_MAX_CELLS }, '[viewport] casilla recortada por el tope de celdas');
    }
    const indice = new Map<string, number>();
    const duenos: ViewportEntry['duenos'] = [];
    const datos = new Int32Array(q.rows.length * 4);
    q.rows.forEach((r: any, i: number) => {
      let d = indice.get(r.owner_id);
      if (d === undefined) {
        d = duenos.length;
        indice.set(r.owner_id, d);
        duenos.push({ id: r.owner_id, name: r.owner_name, warCry: r.owner_war_cry });
      }
      datos[i * 4] = r.cell_x;
      datos[i * 4 + 1] = r.cell_y;
      datos[i * 4 + 2] = d;
      datos[i * 4 + 3] = r.claimed_s ?? 0;
    });
    entry = { expires: Date.now() + VIEWPORT_TTL_MS, datos, n: q.rows.length, duenos };
    if (viewportCache.size >= VIEWPORT_CACHE_MAX) {
      const now = Date.now();
      for (const [k, v] of viewportCache) if (v.expires <= now) viewportCache.delete(k);
      if (viewportCache.size >= VIEWPORT_CACHE_MAX) {
        const oldest = viewportCache.keys().next().value;
        if (oldest !== undefined) viewportCache.delete(oldest);
      }
    }
    viewportCache.set(cacheKey, entry);
  }

  // Las fotos van APARTE, una por dueño, no repetidas en cada celda.
  //
  // Esto no es una optimización de manual: los avatares se guardan como la
  // imagen entera en base64, no como una URL. La de un usuario ocupa 2,3 MB.
  // Devolverla en cada fila —540 celdas de un mismo corredor es un encuadre
  // normal— daban 56 MB en UNA carga del mapa, que además se repite cada vez
  // que el usuario mueve el dedo. Mandarlas una vez por dueño lo deja en unos
  // pocos cientos de KB.
  //
  // Va fuera del caché de celdas a propósito: el caché guarda muchos encuadres
  // y no conviene tener la misma foto duplicada en cada uno.
  const owners = await ownerAvatars(entry.duenos.map(d => d.id), req.log);

  // "Es mía" se calcula aquí, no en SQL: así el caché sirve a todos.
  // Se rehace el formato de siempre (una fila por celda) para que las
  // versiones de la app que ya están en los móviles lo sigan entendiendo.
  const { datos, n: total, duenos } = entry;
  const cells = new Array(total);
  for (let i = 0; i < total; i++) {
    const d = duenos[datos[i * 4 + 2]];
    cells[i] = {
      cell_x: datos[i * 4],
      cell_y: datos[i * 4 + 1],
      owner_id: d.id,
      claimed_at: new Date(datos[i * 4 + 3] * 1000).toISOString(),
      owner_name: d.name,
      owner_war_cry: d.warCry,
      is_mine: d.id === req.userId,
    };
  }
  return reply.send({ cells, owners });
});

/** Invalida el caché del mapa alrededor de unas celdas recién conquistadas.
 *  Sin esto, quien acabara de robar territorio seguiría viéndolo del dueño
 *  anterior hasta 30 segundos, que en un juego de robos se nota. */
function invalidateViewportCache(cells: { x: number; y: number }[]) {
  if (cells.length === 0) return;
  // Cada entrada cubre un rectángulo de varias casillas (x0..x1, y0..y1). Antes
  // solo se miraba la casilla de la esquina, y un robo en otra parte del
  // rectángulo no lo borraba.
  const toca = (key: string) => {
    const [x0, x1, y0, y1] = key.split(':').map(Number);
    return cells.some(c => c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1);
  };
  for (const cache of [viewportCache, stripsCache] as Map<string, unknown>[]) {
    for (const key of [...cache.keys()]) if (toca(key)) cache.delete(key);
  }
}

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
      .setProtectedHeader({ alg: 'HS256' }).setExpirationTime(SESSION_TOKEN_TTL).sign(SECRET);
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
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime(SESSION_TOKEN_TTL).sign(SECRET);
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
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime(SESSION_TOKEN_TTL).sign(SECRET);
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
      invalidateViewportCache(xs.map((x: number, i: number) => ({ x, y: ys[i] })));

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
            `${thiefName} (vía Strava) te ha quitado ${robosList.length} ${robosList.length === 1 ? 'celda' : 'celdas'} y ${robosList.length} ${robosList.length === 1 ? 'punto' : 'puntos'}. ¡Sal a recuperarlas!`
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
const LATEST_APP_VERSION = process.env.LATEST_APP_VERSION ?? '1.11.9';
const LATEST_APP_VC = parseInt(process.env.LATEST_APP_VC ?? '66', 10);
const MIN_APP_VERSION = process.env.MIN_APP_VERSION ?? '1.0.0';

// iOS va por su cuenta: sube a App Store cuando Apple aprueba, no cuando
// subimos a Play. Antes había UNA sola versión y UNA sola URL, las de
// Android, y eso rompía a los usuarios de iPhone por partida doble: se les
// anunciaba una versión que en su tienda no existe, y el botón "Actualizar"
// les abría Google Play, que en un iPhone no lleva a ninguna parte.
const LATEST_IOS_VERSION = process.env.LATEST_IOS_VERSION ?? '1.11.9';
const LATEST_IOS_BUILD = parseInt(process.env.LATEST_IOS_BUILD ?? '16', 10);
const ANDROID_UPDATE_URL = 'https://play.google.com/store/apps/details?id=app.corrr';
// ID asignado por App Store Connect al publicarse (consultable sin claves en
// https://itunes.apple.com/lookup?bundleId=app.corrr). Configurable por
// variable de entorno por si algún día cambia.
const IOS_UPDATE_URL = process.env.IOS_UPDATE_URL
  ?? 'https://apps.apple.com/es/app/corrr-conquista-tu-ciudad/id6805088892';

/** Averigua desde qué plataforma se pregunta.
 *
 *  Lo ideal es que el cliente lo diga (?platform=ios), y las versiones nuevas
 *  lo hacen. Pero las que ya están publicadas —incluida la que Apple tiene en
 *  revisión— no mandan nada, y a esas no las podemos actualizar. Por eso
 *  miramos también el User-Agent, que sí distingue: en iOS las peticiones
 *  salen por NSURLSession y llevan "CFNetwork"/"Darwin"; en Android salen por
 *  okhttp. Así el arreglo alcanza a los clientes que ya existen. */
// User-Agent real medido en un iPhone 15 con la app de TestFlight:
//   CORRR/1 CFNetwork/3860.700.1 Darwin/25.6.0
// La app de React Native no manda cabecera propia; sale la de NSURLSession.
// Comprobado con tráfico real, no con una cadena inventada.
function detectPlatform(req: any): 'ios' | 'android' {
  const explicit = String((req.query as any)?.platform ?? '').toLowerCase();
  if (explicit === 'ios' || explicit === 'android') return explicit;
  const ua = String(req.headers['user-agent'] ?? '');
  if (/CFNetwork|Darwin|iPhone|iPad|iOS/i.test(ua)) return 'ios';
  return 'android';
}

app.get('/app/version', async (req: any, reply) => {
  const platform = detectPlatform(req);
  const isIos = platform === 'ios';

  reply.send({
    platform,
    latestVersion: isIos ? LATEST_IOS_VERSION : LATEST_APP_VERSION,
    latestVersionCode: isIos ? LATEST_IOS_BUILD : LATEST_APP_VC,
    minVersion: MIN_APP_VERSION,       // below this → force update
    // En iOS se omite mientras no haya App Store: mejor sin botón que con un
    // botón que lleva a la tienda equivocada.
    ...(isIos
      ? (IOS_UPDATE_URL ? { updateUrl: IOS_UPDATE_URL } : {})
      : { updateUrl: ANDROID_UPDATE_URL }),
  });
});

// ── Avisos en la app ─────────────────────────────────────────────────────────
// El pop-up que sale al abrir. Se escribe desde /admin y se cambia cuando
// haga falta: no necesita versión nueva de la app, que es justo para lo que
// existe (anunciar una novedad, lanzar un reto, avisar de una caída).
//
// Un aviso sale UNA vez por persona: el servidor apunta quién lo ha visto. Si
// quieres repetirlo, se crea otro.

/** A quién le toca cada tipo de aviso. Se calcula en el servidor para no
 *  mandarle a la app datos de nadie. */
const SQL_PUBLICO_AVISO = `(
     a.publico = 'todos'
  OR (a.publico = 'ciudad' AND a.ciudad IS NOT NULL AND LOWER(u.city) = LOWER(a.ciudad))
  OR (a.publico = 'sin-carreras' AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.user_id = u.id))
  OR (a.publico = 'ios' AND u.plataforma = 'ios')
  OR (a.publico = 'android' AND u.plataforma = 'android')
  OR (a.publico = 'corredor' AND a.corredor IS NOT NULL AND LOWER(u.display_name) = LOWER(a.corredor))
  OR (a.publico = 'pocos-puntos' AND COALESCE(
        (SELECT st.total_points FROM user_stats st WHERE st.user_id = u.id), 0) <= 100)
  OR (a.publico = 'dormidos' AND NOT EXISTS (
        SELECT 1 FROM runs r WHERE r.user_id = u.id AND r.created_at >= NOW() - INTERVAL '14 days'))
)`;

/** El aviso que toca ver a quien pregunta, o nada. */
app.get('/app/aviso', { preHandler: requireAuth }, async (req: any, reply) => {
  // De paso queda apuntado el teléfono: es lo único que permite luego mandar
  // un aviso solo a iPhone (Salud) o solo a Android.
  const plataforma = String(req.query?.plataforma ?? '');
  if (plataforma === 'ios' || plataforma === 'android') {
    await db.query(
      `UPDATE users SET plataforma = $2 WHERE id = $1 AND plataforma IS DISTINCT FROM $2`,
      [req.userId, plataforma],
    ).catch(() => {});
  }
  const { rows } = await db.query(
    `SELECT a.id, a.titulo, a.texto, a.imagen_url AS imagen, a.boton, a.enlace,
            a.etiqueta, a.sello, a.nota
       FROM avisos a, users u
      WHERE u.id = $1
        AND a.activo
        AND a.desde <= NOW()
        AND (a.hasta IS NULL OR a.hasta > NOW())
        AND ${SQL_PUBLICO_AVISO}
        AND NOT EXISTS (SELECT 1 FROM aviso_vistas v WHERE v.aviso_id = a.id AND v.user_id = u.id)
      ORDER BY a.creado_at DESC
      LIMIT 1`,
    [req.userId],
  );
  return reply.send({ aviso: rows[0] ?? null });
});

/** La app avisa de que ya lo ha enseñado, para no repetirlo. */
app.post('/app/aviso/:id/visto', { preHandler: requireAuth }, async (req: any, reply) => {
  const id = parseInt(String(req.params?.id ?? ''), 10);
  if (!Number.isInteger(id)) return reply.status(400).send({ error: 'id no válido' });
  await db.query(
    `INSERT INTO aviso_vistas (aviso_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [id, req.userId],
  ).catch(() => {});
  return reply.send({ ok: true });
});

const PUBLICOS_AVISO = ['todos', 'ciudad', 'sin-carreras', 'dormidos', 'pocos-puntos', 'corredor', 'ios', 'android'];

/** Lista de avisos con cuánta gente los ha visto y a cuánta le tocan. */
app.get('/admin/avisos', { preHandler: requireAdmin }, async (_req, reply) => {
  const { rows } = await db.query(
    `SELECT a.*,
            (SELECT COUNT(*)::int FROM aviso_vistas v WHERE v.aviso_id = a.id) AS vistas,
            (SELECT COUNT(*)::int FROM users u WHERE ${SQL_PUBLICO_AVISO}) AS publico_total
       FROM avisos a ORDER BY a.creado_at DESC LIMIT 50`,
  );
  return reply.send(rows);
});

app.post('/admin/avisos', { preHandler: requireAdmin }, async (req: any, reply) => {
  const { titulo, texto, imagen, boton, enlace, publico, ciudad, hasta, etiqueta, sello, nota, corredor } = req.body ?? {};
  if (typeof titulo !== 'string' || !titulo.trim()) return reply.status(400).send({ error: 'Falta el título' });
  if (typeof texto !== 'string' || !texto.trim()) return reply.status(400).send({ error: 'Falta el texto' });
  const pub = PUBLICOS_AVISO.includes(publico) ? publico : 'todos';
  if (pub === 'ciudad' && (typeof ciudad !== 'string' || !ciudad.trim())) {
    return reply.status(400).send({ error: 'Para el público "ciudad" hace falta la ciudad' });
  }
  if (pub === 'corredor') {
    if (typeof corredor !== 'string' || !corredor.trim()) {
      return reply.status(400).send({ error: 'Falta el nombre del corredor' });
    }
    const { rows: existe } = await db.query(
      'SELECT 1 FROM users WHERE LOWER(display_name) = LOWER($1)', [corredor.trim()],
    );
    if (existe.length === 0) return reply.status(400).send({ error: `No hay ningún corredor que se llame "${corredor.trim()}"` });
  }
  const { rows } = await db.query(
    `INSERT INTO avisos (titulo, texto, imagen_url, boton, enlace, publico, ciudad, hasta, etiqueta, sello, nota, corredor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [titulo.trim(), texto.trim(), imagen || null, boton || null, enlace || null,
     pub, pub === 'ciudad' ? ciudad.trim() : null, hasta || null,
     etiqueta || null, sello || null, nota || null,
     pub === 'corredor' ? corredor.trim() : null],
  );
  return reply.status(201).send(rows[0]);
});

/** Encender, apagar o corregir un aviso ya creado. */
app.put('/admin/avisos/:id', { preHandler: requireAdmin }, async (req: any, reply) => {
  const { titulo, texto, imagen, boton, enlace, activo, hasta } = req.body ?? {};
  const { rows } = await db.query(
    `UPDATE avisos SET
       titulo = COALESCE($1, titulo), texto = COALESCE($2, texto),
       imagen_url = COALESCE($3, imagen_url), boton = COALESCE($4, boton),
       enlace = COALESCE($5, enlace), activo = COALESCE($6, activo), hasta = COALESCE($7, hasta)
     WHERE id = $8 RETURNING *`,
    [titulo ?? null, texto ?? null, imagen ?? null, boton ?? null, enlace ?? null,
     typeof activo === 'boolean' ? activo : null, hasta ?? null, req.params.id],
  );
  if (rows.length === 0) return reply.status(404).send({ error: 'No existe ese aviso' });
  return reply.send(rows[0]);
});

app.delete('/admin/avisos/:id', { preHandler: requireAdmin }, async (req: any, reply) => {
  await db.query(`DELETE FROM avisos WHERE id = $1`, [req.params.id]);
  return reply.send({ ok: true });
});

// ── Emails sobre CORRR ───────────────────────────────────────────────────────
// De momento uno solo: "Una vuelta basta", para quien se registró y ha
// salido poco o nada. Nada se envía solo: se lanza a mano desde
// /admin/email/reactivacion, primero en prueba y luego por tandas.

/** Días de calendario (hora de España) que tienen que pasar desde el alta
 *  antes de escribirle: al que se registró ayer no hace falta recordarle
 *  nada. Con 4, el día 22 entran los registrados hasta el 18 incluido. */
const DIAS_DESDE_EL_ALTA = 4;
const SQL_ALTA_CON_MARGEN = `(u.created_at AT TIME ZONE 'Europe/Madrid')::date
        <= (NOW() AT TIME ZONE 'Europe/Madrid')::date - ${DIAS_DESDE_EL_ALTA}`;

/** A quien ha guardado una carrera en estos últimos días no se le empuja. */
const DIAS_SIN_CORRER = 7;

/** El plan gratis de Resend manda 100 al día, y cuentan también las
 *  verificaciones y los cambios de contraseña: se deja hueco para esos. */
const MAX_ENVIOS_POR_TANDA = 80;

/** Enlace de baja firmado: no hay que guardar tokens y nadie puede dar de baja
 *  a otro cambiando el id de la URL. Va firmado con el secreto de los JWT; si
 *  algún día se rota, los enlaces viejos dejan de valer y la página remite a
 *  hola@corrr.es, que también sirve para pedir la baja. */
function firmaBaja(userId: string): string {
  return createHmac('sha256', process.env.JWT_ACCESS_SECRET!)
    .update(`baja-email:${userId}`)
    .digest('base64url')
    .slice(0, 32);
}

function firmaBajaValida(userId: string, firma: string): boolean {
  const esperada = Buffer.from(firmaBaja(userId));
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

function urlBajaEmail(userId: string): string {
  return `${RAILWAY_URL}/email/baja?u=${encodeURIComponent(userId)}&t=${firmaBaja(userId)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Id de los envíos de prueba: su enlace de baja enseña la página de
 *  confirmación sin tocar la base de datos. */
const USUARIO_PRUEBA = 'prueba';

/** Hasta cuántos puntos se considera que alguien ha salido "poco". A 10
 *  puntos por km más las celdas, 100 son unos pocos km en total. Cuentan
 *  todos los puntos, también los 50 de completar el perfil. */
const MAX_PUNTOS_REACTIVACION = 100;

const FROM_REACTIVACION = `users u LEFT JOIN user_stats s ON s.user_id = u.id`;

/** Quién recibe "Una vuelta basta". Un solo sitio para el recuento y el envío.
 *  - Email verificado, o cuenta de Google (Google ya lo verificó y
 *    /auth/google no marca email_verified). Sin verificar puede ser una
 *    dirección mal escrita, de otra persona.
 *  - 100 puntos o menos, contando carreras de cualquier origen.
 *  - Registrado hace al menos DIAS_DESDE_EL_ALTA días de calendario.
 *  - Nada de carreras en la última semana: a quien acaba de salir no hace
 *    falta empujarle.
 *  - Fuera las cuentas de revisión de Apple (@corrr.es) y de Google (+googletest). */
const SQL_PENDIENTES_REACTIVACION = `
      (u.email_verified OR u.google_id IS NOT NULL)
      AND u.email_baja_at IS NULL
      AND ${SQL_ALTA_CON_MARGEN}
      AND u.email NOT ILIKE '%@corrr.es'
      AND u.email NOT ILIKE '%+googletest@%'
      AND COALESCE(s.total_points, 0) <= ${MAX_PUNTOS_REACTIVACION}
      AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.user_id = u.id
                        AND r.created_at >= NOW() - make_interval(days => ${DIAS_SIN_CORRER}))
      AND NOT EXISTS (SELECT 1 FROM email_envios e WHERE e.user_id = u.id AND e.campana = $1)`;

/** Qué versión del email le toca: 'poco' si tiene alguna carrera, 'nada' si no. */
const SQL_VARIANTE_REACTIVACION =
  `CASE WHEN EXISTS (SELECT 1 FROM runs r WHERE r.user_id = u.id) THEN 'poco' ELSE 'nada' END`;

function enviarReactivacion(
  para: string, nombre: string, urlBaja: string, variante: Variante, asunto = ASUNTO_REACTIVACION,
) {
  const datos = { nombre, urlAbrir: `${RAILWAY_URL}/app/abrir`, urlBaja, variante };
  return resend.emails.send({
    from: 'CORRR <hola@corrr.es>',
    to: para,
    subject: asunto,
    html: htmlReactivacion(datos),
    text: textoReactivacion(datos),
    // Gmail y Apple Mail enseñan un botón de baja con esto. El POST de un clic
    // (RFC 8058) llega a /email/baja; el mailto es la alternativa.
    headers: {
      'List-Unsubscribe': `<${urlBaja}>, <mailto:hola@corrr.es?subject=Baja>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}

/** Botón de los emails: lleva a la ficha de CORRR en la tienda del móvil, que
 *  con la app instalada ofrece "Abrir". Un enlace corrr:// no sirve aquí:
 *  Gmail y la mayoría de clientes solo abren enlaces web. */
app.get('/app/abrir', async (req: any, reply) => {
  const ua = String(req.headers['user-agent'] ?? '');
  const destino = /iPhone|iPad|iPod/i.test(ua) ? IOS_UPDATE_URL
    : /Android/i.test(ua) ? ANDROID_UPDATE_URL
    : 'https://corrr.es';
  return reply.redirect(destino);
});

function paginaBaja(titulo: string, texto: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <title>CORRR · Emails</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#000;color:#fff;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;
         display:flex;flex-direction:column;align-items:center;justify-content:center;
         min-height:100vh;padding:32px 16px;text-align:center}
    img{width:160px;margin-bottom:28px}
    h1{font-size:24px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px;color:#FF5500}
    p{font-size:15px;color:#aaa;line-height:1.6;max-width:420px}
    a{color:#fff}
  </style></head><body>
  <img src="https://ibanto.github.io/corrr/logo.png" alt="CORRR">
  <h1>${titulo}</h1>
  <p>${texto}</p>
  </body></html>`;
}

async function darDeBajaEmail(req: any): Promise<boolean> {
  const id = String(req.query?.u ?? '');
  const firma = String(req.query?.t ?? '');
  if (id !== USUARIO_PRUEBA && !UUID_RE.test(id)) return false;
  if (!firmaBajaValida(id, firma)) return false;
  if (id === USUARIO_PRUEBA) return true;
  // COALESCE: si ya estaba de baja se conserva la fecha en que la pidió.
  await db.query('UPDATE users SET email_baja_at = COALESCE(email_baja_at, NOW()) WHERE id = $1', [id]);
  return true;
}

app.register(async (scope) => {
  // El botón de baja de Gmail y Apple Mail hace un POST a esta URL con el
  // cuerpo "List-Unsubscribe=One-Click" en form-urlencoded, que Fastify no
  // sabe leer y rechazaría con un 415. Solo cuentan u y t de la URL, así que
  // en estas dos rutas se acepta cualquier cuerpo y se descarta.
  scope.addContentTypeParser('*', { parseAs: 'string' }, (_req, _body, done) => done(null, undefined));

  // Un solo clic, sin botón de confirmar: la ley pide un procedimiento
  // sencillo. Si un antivirus de correo abre el enlace por su cuenta, lo peor
  // que pasa es que esa persona deja de recibir estos emails.
  scope.get('/email/baja', async (req: any, reply) => {
    try {
      const ok = await darDeBajaEmail(req);
      reply.type('text/html; charset=utf-8');
      return ok
        ? paginaBaja('Hecho',
            'No te mandaremos más emails sobre CORRR. Los de tu cuenta (verificación y contraseña) te seguirán llegando. '
            + 'Si ha sido sin querer, escríbenos a <a href="mailto:hola@corrr.es">hola@corrr.es</a>.')
        : paginaBaja('Enlace no válido',
            'No hemos podido darte de baja con este enlace. Escríbenos a '
            + '<a href="mailto:hola@corrr.es?subject=Baja">hola@corrr.es</a> y lo hacemos a mano.');
    } catch (err) {
      console.error('[Email] Error en la baja:', err);
      return reply.status(500).type('text/html; charset=utf-8').send(paginaBaja('Algo ha fallado',
        'Vuelve a intentarlo en un rato o escríbenos a <a href="mailto:hola@corrr.es?subject=Baja">hola@corrr.es</a>.'));
    }
  });

  scope.post('/email/baja', async (req: any, reply) => {
    try {
      const ok = await darDeBajaEmail(req);
      return reply.status(ok ? 200 : 400).send({ ok });
    } catch (err) {
      console.error('[Email] Error en la baja (un clic):', err);
      return reply.status(500).send({ ok: false });
    }
  });
});

/** GET: cuántos lo recibirían, sin enviar nada. */
/** Baja del correo apuntada a mano.
 *
 *  Hace falta porque la cabecera List-Unsubscribe ofrece dos caminos y solo
 *  uno pasa por nosotros: Gmail llama al enlace (y queda apuntado), pero Mail
 *  de Apple manda un CORREO a hola@corrr.es con asunto "Baja" — que es
 *  perfectamente válido para quien lo pide, pero no toca la base de datos. Sin
 *  esto, esa persona seguiría recibiendo campañas: la baja hay que respetarla
 *  llegue por donde llegue. (Javier, 23-sep-2026.) */
app.post('/admin/email/baja', { preHandler: requireAdmin }, async (req: any, reply) => {
  const quien = String(req.body?.quien ?? '').trim();
  if (!quien) return reply.status(400).send({ error: 'Falta el nombre o el email' });
  const { rows } = await db.query(
    `UPDATE users SET email_baja_at = COALESCE(email_baja_at, NOW())
      WHERE LOWER(email) = LOWER($1) OR LOWER(display_name) = LOWER($1)
      RETURNING display_name, email, email_baja_at`,
    [quien],
  );
  if (rows.length === 0) return reply.status(404).send({ error: `No hay nadie con nombre o email "${quien}"` });
  if (rows.length > 1) {
    req.log.warn({ quien, n: rows.length }, '[baja] el nombre coincidía con varias personas');
  }
  return reply.send({ ok: true, dados_de_baja: rows.map((r: any) => r.display_name) });
});

app.get('/admin/email/reactivacion', { preHandler: requireAdmin }, async (_req: any, reply) => {
  const pocos = `COALESCE(s.total_points, 0) <= ${MAX_PUNTOS_REACTIVACION}`;
  const { rows } = await db.query(`
    SELECT
      COUNT(*)::int AS usuarios,
      COUNT(*) FILTER (WHERE ${pocos})::int AS con_pocos_puntos,
      COUNT(*) FILTER (WHERE ${pocos} AND NOT (u.email_verified OR u.google_id IS NOT NULL))::int AS fuera_sin_verificar,
      COUNT(*) FILTER (WHERE ${pocos}
                         AND NOT (${SQL_ALTA_CON_MARGEN}))::int AS fuera_alta_reciente,
      COUNT(*) FILTER (WHERE ${pocos} AND EXISTS (SELECT 1 FROM runs r WHERE r.user_id = u.id
                         AND r.created_at >= NOW() - make_interval(days => ${DIAS_SIN_CORRER})))::int AS fuera_salio_esta_semana,
      COUNT(*) FILTER (WHERE u.email_baja_at IS NOT NULL)::int AS de_baja,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM email_envios e
                                     WHERE e.user_id = u.id AND e.campana = $1))::int AS ya_enviados,
      COUNT(*) FILTER (WHERE ${SQL_PENDIENTES_REACTIVACION} AND ${SQL_VARIANTE_REACTIVACION} = 'nada')::int AS pendientes_sin_carreras,
      COUNT(*) FILTER (WHERE ${SQL_PENDIENTES_REACTIVACION} AND ${SQL_VARIANTE_REACTIVACION} = 'poco')::int AS pendientes_con_poco,
      -- Efecto del email: de los que lo recibieron, cuántos han guardado una
      -- carrera después (de cualquier origen) y cuántos se han dado de baja.
      (SELECT COUNT(*)::int FROM email_envios e
        WHERE e.campana = $1
          AND EXISTS (SELECT 1 FROM runs r WHERE r.user_id = e.user_id AND r.created_at > e.enviado_at)
      ) AS enviados_que_han_salido,
      (SELECT COUNT(*)::int FROM email_envios e JOIN users b ON b.id = e.user_id
        WHERE e.campana = $1 AND b.email_baja_at IS NOT NULL
      ) AS enviados_de_baja
    FROM ${FROM_REACTIVACION}`, [CAMPANA_REACTIVACION]);
  return reply.send({
    campana: CAMPANA_REACTIVACION,
    asunto: ASUNTO_REACTIVACION,
    maxPuntos: MAX_PUNTOS_REACTIVACION,
    diasDesdeElAlta: DIAS_DESDE_EL_ALTA,
    diasSinCorrer: DIAS_SIN_CORRER,
    maxPorTanda: MAX_ENVIOS_POR_TANDA,
    ...rows[0],
  });
});

/** POST { modo: 'prueba', para: 'tu@email', variante?: 'nada'|'poco' } → un envío de prueba, sin apuntar nada.
 *  POST { modo: 'enviar', max?: 80 }        → una tanda a los pendientes. */
app.post('/admin/email/reactivacion', { preHandler: requireAdmin }, async (req: any, reply) => {
  const { modo, para, max, variante } = req.body ?? {};

  if (modo === 'prueba') {
    if (typeof para !== 'string' || !para.includes('@')) return reply.status(400).send({ error: 'Falta "para"' });
    const { rows } = await db.query('SELECT display_name FROM users WHERE email = $1', [para]);
    const { data, error } = await enviarReactivacion(
      para, rows[0]?.display_name ?? 'Corredor', urlBajaEmail(USUARIO_PRUEBA),
      variante === 'poco' ? 'poco' : 'nada', `[PRUEBA] ${ASUNTO_REACTIVACION}`,
    );
    if (error) return reply.status(502).send({ error: error.message });
    return reply.send({ ok: true, id: data?.id });
  }

  if (modo !== 'enviar') return reply.status(400).send({ error: 'modo tiene que ser "prueba" o "enviar"' });

  const limite = Math.min(Math.max(1, Number(max) || MAX_ENVIOS_POR_TANDA), MAX_ENVIOS_POR_TANDA);
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.display_name, ${SQL_VARIANTE_REACTIVACION} AS variante
       FROM ${FROM_REACTIVACION}
      WHERE ${SQL_PENDIENTES_REACTIVACION}
      ORDER BY u.created_at LIMIT $2`,
    [CAMPANA_REACTIVACION, limite],
  );

  let enviados = 0;
  let fallosSeguidos = 0;
  const fallos: { userId: string; error: string }[] = [];
  for (const u of rows) {
    // Se apunta ANTES de enviar: si se lanzan dos tandas a la vez, la segunda
    // choca con la clave primaria y no manda el mismo email dos veces.
    const hueco = await db.query(
      `INSERT INTO email_envios (user_id, campana) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING user_id`,
      [u.id, CAMPANA_REACTIVACION],
    );
    if (!hueco.rowCount) continue;

    let error: string | null = null;
    try {
      const r = await enviarReactivacion(u.email, u.display_name ?? 'Corredor', urlBajaEmail(u.id), u.variante);
      if (r.error) error = r.error.message;
    } catch (err) {
      error = String(err);
    }

    if (error) {
      // No salió: se quita la marca para que entre en la próxima tanda.
      await db.query('DELETE FROM email_envios WHERE user_id = $1 AND campana = $2', [u.id, CAMPANA_REACTIVACION]);
      fallos.push({ userId: u.id, error });
      // Tres seguidos suele ser la cuota del día o la clave: el resto fallaría igual.
      if (++fallosSeguidos >= 3) break;
    } else {
      enviados++;
      fallosSeguidos = 0;
    }
    // Resend admite unas 2 peticiones por segundo.
    await new Promise((r) => setTimeout(r, 600));
  }

  const quedan = await db.query(
    `SELECT COUNT(*)::int AS n FROM ${FROM_REACTIVACION} WHERE ${SQL_PENDIENTES_REACTIVACION}`, [CAMPANA_REACTIVACION],
  );
  return reply.send({ enviados, fallos, quedan: quedan.rows[0].n });
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
