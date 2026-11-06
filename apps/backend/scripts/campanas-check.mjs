/**
 * Comprobación de las campañas de marca (§9-quinquies del CLAUDE.md).
 *
 *   npm run test:campanas
 *
 * Levanta un Postgres de mentira EN MEMORIA (PGlite, solo en desarrollo: el
 * Dockerfile instala sin devDependencies) y le pasa las consultas TAL CUAL
 * están en src/routes/index.ts y la recogida de src/services/objetos.ts. No
 * toca ninguna base de datos de verdad.
 *
 * Cada caso es una regla del juego. Si uno falla, o alguien ve un reto que no
 * es de su ciudad, o alguien coge un logo sin haberse apuntado, o los logos
 * dejan de cogerse al apagar Halloween (que es justo lo que pasaba hasta el
 * 6-nov-2026). No se sube nada con esto en rojo.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const { recoger } = await import(join(raiz, 'dist/services/objetos.js'));
const fuente = readFileSync(join(raiz, 'src/routes/index.ts'), 'utf8');
const dist = readFileSync(join(raiz, 'dist/routes/index.js'), 'utf8');

let fallos = 0;
function comprueba(nombre, ok, detalle) {
  if (!ok) fallos++;
  console.log(`${ok ? '✔' : '✘'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
}

/** Una función suelta del JS compilado, tal cual la ejecuta el servidor. */
function sacar(nombre) {
  const i = dist.indexOf(`function ${nombre}(`);
  if (i < 0) throw new Error('No encuentro ' + nombre + ' en dist/routes/index.js');
  return dist.slice(i, dist.indexOf('\n}\n', i) + 2);
}
/** Una consulta SQL del código, entre su primer acento grave y el último. */
function consulta(desde, empieza, acaba) {
  const i = fuente.indexOf(desde);
  if (i < 0) throw new Error('No encuentro ' + desde);
  const a = fuente.indexOf(empieza, i) + 1;
  return fuente.slice(a, fuente.indexOf(acaba, a) + acaba.length - 1);
}
const iniC = dist.indexOf('const CELL_SIZE_M');
const constantes = dist.slice(iniC, dist.indexOf('\n', dist.indexOf('const CELL_LNG_DEG')) + 1);
const coordToCell = new Function(constantes + sacar('coordToCell') + '; return coordToCell;')();
const ajusteLeToca = new Function(sacar('ajusteLeToca') + '; return ajusteLeToca;')();
const { cajasDeCampana, cajaDeCampana } = new Function('coordToCell',
  sacar('cajasDeCampana') + sacar('cajaDeCampana') + '; return { cajasDeCampana, cajaDeCampana };')(coordToCell);

// ── El interruptor de prueba, con uno o con varios ──
comprueba('prueba de uno: le toca a él', ajusteLeToca('prueba:Ibanto', 'ibanto'));
comprueba('prueba de varios: le toca al cliente', ajusteLeToca('prueba:Ibanto,TiendaPepe', 'TiendaPepe'));
comprueba('prueba de varios: no le toca a otro', !ajusteLeToca('prueba:Ibanto,TiendaPepe', 'KarolK'));
comprueba('encendida: le toca a todos', ajusteLeToca('si', 'KarolK'));
comprueba('apagada: no le toca a nadie', !ajusteLeToca('no', 'Ibanto'));

// ── Las zonas de la campaña ──
const bcn = { sur: 41.317, norte: 41.468, oeste: 2.052, este: 2.228 };
const bdn = { sur: 41.43, norte: 41.49, oeste: 2.22, este: 2.30 };
const vieja = { tipo: 'vieja', ciudad: 'Málaga', lugar: 'Málaga…', limites: bcn };
const nueva = { tipo: 'tienda', ciudad: 'Barcelona, Badalona', lugar: 'x', limites: bcn,
  zonas: [{ ciudad: 'Barcelona', lugar: 'x', limites: bcn }, { ciudad: 'Badalona', lugar: 'y', limites: bdn }] };
comprueba('campaña de antes (sin zonas): una caja', cajasDeCampana(vieja).length === 1);
comprueba('campaña con dos ciudades: dos cajas', cajasDeCampana(nueva).length === 2);
const enBadalona = coordToCell(41.47, 2.29);
comprueba('un logo cogido en Badalona renace en Badalona',
  JSON.stringify(cajaDeCampana(nueva, enBadalona.x, enBadalona.y)) === JSON.stringify(cajasDeCampana(nueva)[1].caja));
comprueba('sin campaña: nada', cajaDeCampana(null, 0, 0) === null);

// ── La base de datos ──
const db = new PGlite();
await db.exec(`
  CREATE TABLE users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), display_name TEXT, email TEXT, city TEXT);
  CREATE TABLE campanas (tipo TEXT PRIMARY KEY, datos JSONB NOT NULL, modo TEXT NOT NULL DEFAULT 'no',
    creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE campana_apuntados (tipo TEXT NOT NULL REFERENCES campanas(tipo) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, apuntado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tipo, user_id));
  CREATE TABLE objetos (id SERIAL PRIMARY KEY, tipo TEXT NOT NULL DEFAULT 'calabaza', cell_x INTEGER NOT NULL,
    cell_y INTEGER NOT NULL, puntos INTEGER NOT NULL DEFAULT 200, desde TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hasta TIMESTAMPTZ, tomado_por UUID REFERENCES users(id) ON DELETE SET NULL, tomado_at TIMESTAMPTZ,
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);
// La función de comparar ciudades, la misma que crea el servidor al arrancar.
const iniF = fuente.indexOf('CREATE OR REPLACE FUNCTION corrr_ciudad');
await db.exec(fuente.slice(iniF, fuente.indexOf('$f$`', iniF) + 3));

const alta = async (nombre, ciudad) => (await db.query(
  'INSERT INTO users (display_name, email, city) VALUES ($1, $2, $3) RETURNING id',
  [nombre, nombre + '@x.es', ciudad])).rows[0].id;
const iban = await alta('Ibanto', 'Barcelona');
const karol = await alta('KarolK', 'Badalona');
const sevi = await alta('Sevillano', 'Sevilla');
const malaga = await alta('Malagueño', 'malaga');
await db.query(`INSERT INTO campanas (tipo, datos, modo) VALUES ('tienda', $1, 'si'), ('vieja', $2, 'si')`,
  [JSON.stringify(nueva), JSON.stringify(vieja)]);

// retosPara: ¿de quién es cada reto?
const sqlRetos = consulta('async function retosPara', '`SELECT c.datos, c.modo,', 'ORDER BY c.creada_at DESC`');
const deAqui = async (id, ciudad, tipo) =>
  (await db.query(sqlRetos, [id, ciudad])).rows.find(r => r.datos.tipo === tipo)?.de_aqui;
comprueba('reto de dos ciudades: lo ve uno de Badalona', await deAqui(karol, 'Badalona', 'tienda') === true);
comprueba('reto de dos ciudades: lo ve uno de Barcelona', await deAqui(iban, 'Barcelona', 'tienda') === true);
comprueba('reto de dos ciudades: NO lo ve uno de Sevilla', await deAqui(sevi, 'Sevilla', 'tienda') === false);
comprueba('campaña de antes: la ve uno de «malaga» sin tilde', await deAqui(malaga, 'malaga', 'vieja') === true);
comprueba('campaña de antes: NO la ve uno de Sevilla', await deAqui(sevi, 'Sevilla', 'vieja') === false);

// /runs: ¿tiene retos a los que apuntarse la recogida?
const sqlTiene = consulta("let tieneRetos = false", '`SELECT 1 FROM campana_apuntados', "c.modo <> 'no' LIMIT 1`");
await db.query(`INSERT INTO campana_apuntados (tipo, user_id) VALUES ('tienda', $1)`, [karol]);
comprueba('apuntada a un reto encendido: tiene retos', (await db.query(sqlTiene, [karol])).rows.length === 1);
comprueba('sin apuntarse: no tiene retos', (await db.query(sqlTiene, [sevi])).rows.length === 0);

// La recogida con Halloween APAGADO: el logo sí, la calabaza no.
const futuro = new Date(Date.now() + 86400000).toISOString();
const antes = new Date(Date.now() - 3600000).toISOString();
await db.query(`INSERT INTO objetos (tipo, cell_x, cell_y, puntos, desde, hasta) VALUES
  ('tienda', 100, 100, 200, $1, $2), ('calabaza', 100, 100, 200, $1, $2), ('tienda', 202, 200, 1000, $1, $2)`,
  [antes, futuro]);
const ahora = new Date();
let r = await recoger(db, karol, [{ x: 100, y: 100 }, { x: 200, y: 200 }], ahora, [], false);
comprueba('Halloween apagado: coge sus dos logos (uno pisado y otro a 20 m)',
  r.filter(o => o.tipo === 'tienda').length === 2, r.map(o => `${o.tipo} ${o.puntos}`).join(', '));
comprueba('Halloween apagado: la calabaza NO se coge', !r.some(o => o.tipo === 'calabaza'));
r = await recoger(db, karol, [{ x: 100, y: 100 }], ahora, [], true);
comprueba('Halloween encendido: la calabaza sí', r.some(o => o.tipo === 'calabaza'));
await db.query(`INSERT INTO objetos (tipo, cell_x, cell_y, puntos, desde, hasta) VALUES ('tienda', 300, 300, 200, $1, $2)`,
  [antes, futuro]);
r = await recoger(db, sevi, [{ x: 300, y: 300 }], ahora, [], false);
comprueba('sin apuntarse: el logo no se coge', r.length === 0);

// /admin/campanas: el «Hasta» de los logos que quedan, para proponerlo al sembrar más.
const sqlPanel = consulta("app.get('/admin/campanas'", '`SELECT c.datos', 'ORDER BY c.creada_at DESC`');
const t = (await db.query(sqlPanel)).rows.find(f => f.datos.tipo === 'tienda');
comprueba('el panel recibe el «Hasta» de los logos puestos',
  t.hasta && new Date(t.hasta).toISOString() === futuro, String(t.hasta));
comprueba('y cuenta bien libres y cogidos', t.libres === 1 && t.cogidos === 2, `libres ${t.libres}, cogidos ${t.cogidos}`);

console.log(fallos ? `\n${fallos} fallo(s) en las campañas.` : '\nCampañas en orden.');
process.exit(fallos ? 1 : 0);
