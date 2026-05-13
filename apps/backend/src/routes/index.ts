import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Pool } from 'pg';
import { createClient } from 'redis';
import * as dotenv from 'dotenv';
import { hash, verify } from 'argon2';
import { SignJWT, jwtVerify } from 'jose';

dotenv.config();

const app = Fastify({ logger: true });
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = createClient({ url: process.env.REDIS_URL });
redis.connect().catch(console.error);

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
                  u.display_name AS owner_name
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

// ─────────────────────────────────────────────────────────────────────────────

initDB().catch(console.error);

app.listen({ port: 3000, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  console.log('[API] Servidor escuchando en :3000');
});
