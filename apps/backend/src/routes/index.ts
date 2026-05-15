import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { hash, verify } from 'argon2';
import { SignJWT, jwtVerify } from 'jose';

dotenv.config();

const app = Fastify({ logger: true });

const STRAVA_CLIENT_ID     = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const RAILWAY_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : (process.env.RAILWAY_URL ?? 'http://localhost:3000');
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const SECRET = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET);

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

  // Push tokens + avatar
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`);

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
    const ph = await hash(password);
    const { rows } = await db.query(
      'INSERT INTO users (email, password_hash, display_name, city) VALUES ($1,$2,$3,$4) RETURNING id',
      [email, ph, displayName, city]
    );
    const uid = rows[0].id;
    await db.query('INSERT INTO user_stats (user_id) VALUES ($1)', [uid]);
    const token = await new SignJWT({ sub: uid })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .sign(SECRET);
    return reply.status(201).send({ userId: uid, accessToken: token });
  } catch (err) { return reply.status(500).send({ error: String(err) }); }
});

app.post('/auth/login', async (req: any, reply) => {
  const { email, password } = req.body;
  try {
    const { rows } = await db.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
    if (!rows.length) return reply.status(401).send({ error: 'Credenciales incorrectas' });
    const valid = await verify(rows[0].password_hash, password);
    if (!valid) return reply.status(401).send({ error: 'Credenciales incorrectas' });
    const token = await new SignJWT({ sub: rows[0].id })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .sign(SECRET);
    return reply.send({ userId: rows[0].id, accessToken: token });
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
           COALESCE(s.total_points, 0) + (s.total_zones * 450) AS total_points,
           s.total_zones
    FROM user_stats s
    JOIN users u ON u.id = s.user_id
    ORDER BY (COALESCE(s.total_points, 0) + s.total_zones * 450) DESC
    LIMIT 100
  `);
  return reply.send(rows);
});

app.get('/ranking/city', async (req: any, reply) => {
  const { city } = req.query;
  if (!city) return reply.status(400).send({ error: 'city requerido' });
  const { rows } = await db.query(`
    SELECT u.id AS user_id, u.display_name, u.city,
           COALESCE(s.total_points, 0) + (s.total_zones * 450) AS total_points,
           s.total_zones
    FROM user_stats s
    JOIN users u ON u.id = s.user_id
    WHERE LOWER(u.city) = LOWER($1)
    ORDER BY (COALESCE(s.total_points, 0) + s.total_zones * 450) DESC
    LIMIT 100
  `, [city]);
  return reply.send(rows);
});

app.get('/challenges', async (req, reply) => {
  const { rows } = await db.query('SELECT * FROM challenges WHERE ends_at > NOW() ORDER BY difficulty ASC');
  return reply.send(rows);
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

// ── Runs ──────────────────────────────────────────────────────────────────────

app.post('/runs', { preHandler: requireAuth }, async (req: any, reply) => {
  const { distanceKm, durationSecs, points, zonesCount, zones } = req.body;
  const userId = req.userId;
  const client = await db.connect();

  const stolenZones: { id: string; ownerName: string; points: number }[] = [];

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'INSERT INTO runs (user_id, distance_km, duration_secs, points, zones_count) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [userId, distanceKm, durationSecs, points, zonesCount]
    );
    const runId = rows[0].id;

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
           total_runs   = total_runs   + 1
       WHERE user_id = $1`,
      [userId, zonesCount, points, distanceKm]
    );

    await client.query('COMMIT');
    return reply.status(201).send({ runId, stolenZones });
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
      'Cerraste la ventana sin conectar Strava. Vuelve a la app e inténtalo de nuevo.', '#FF3B30'));
  }

  let userId: string;
  try { userId = Buffer.from(state, 'base64url').toString('utf8'); } catch {
    return reply.type('text/html').send(htmlPage('❌ Error', 'Estado inválido.', '#FF3B30'));
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
      `Strava dijo: ${tokenData.message ?? 'token inválido'}`, '#FF3B30'));
  }

  // 2. Obtener últimas actividades
  const actsRes  = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=10', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const allActs  = await actsRes.json() as any[];
  const runs     = allActs.filter((a: any) => a.type === 'Run' && a.map?.summary_polyline).slice(0, 5);

  if (runs.length === 0) {
    return reply.type('text/html').send(htmlPage('😕 Sin carreras',
      'No encontramos carreras recientes con ruta GPS en tu cuenta de Strava.', '#FF9500'));
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
      const pts       = Math.max(10, Math.round(distKm * 15));
      await client.query(
        `INSERT INTO zones (owner_id, polygon, area_km2, points, center_lat, center_lng)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, JSON.stringify(coords), distKm * 0.05, pts, centerLat, centerLng]
      );
      await client.query(
        `UPDATE user_stats SET total_zones = total_zones + 1, total_points = total_points + $2 WHERE user_id = $1`,
        [userId, pts]
      );
      created++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return reply.type('text/html').send(htmlPage('❌ Error al importar',
      `Error interno: ${String(err)}`, '#FF3B30'));
  } finally { client.release(); }

  return reply.type('text/html').send(htmlPage('✅ ¡Zonas importadas!',
    `Se han conquistado <strong>${created} zona${created !== 1 ? 's' : ''}</strong> a partir de tus últimas carreras en Strava.<br><br>Cierra esta ventana y abre CORRR para verlas en el mapa.`,
    '#FF6600'));
});

function htmlPage(title: string, body: string, accent: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>CORRR × Strava</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0A0A0A;color:#fff;font-family:-apple-system,sans-serif;
         display:flex;flex-direction:column;align-items:center;justify-content:center;
         min-height:100vh;padding:32px;text-align:center}
    .logo{font-size:36px;font-weight:900;letter-spacing:-1px;margin-bottom:24px;color:${accent}}
    h2{font-size:22px;font-weight:800;margin-bottom:12px}
    p{font-size:15px;color:#aaa;line-height:1.6}
    strong{color:#fff}
  </style></head><body>
  <div class="logo">CORRR</div>
  <h2>${title}</h2>
  <p>${body}</p>
  </body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────

initDB().catch(console.error);

app.listen({ port: 3000, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  console.log('[API] Servidor escuchando en :3000');
});
