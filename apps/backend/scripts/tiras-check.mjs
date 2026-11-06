/**
 * Comprobación de las tiras PRECALCULADAS del mapa (services/tiras.ts y la
 * tabla tiras_casilla).
 *
 *   npm run test:tiras
 *
 * Levanta un Postgres de mentira EN MEMORIA (PGlite) con celdas inventadas
 * —varios dueños, coordenadas negativas, tiras que cruzan de una casilla a
 * otra, filas enteras— y comprueba:
 *   1. que lo que sale de la tabla es EXACTAMENTE lo que daba la consulta al
 *      vuelo (SQL_TIRAS + tirasDesdeDuenos) para los mismos encuadres;
 *   2. que si alguien toca `cells` por fuera del servidor (robo, celdas
 *      nuevas, borrado), la comprobación de descuadre señala justo esas
 *      casillas, y tras rehacerlas vuelve a no señalar ninguna;
 *   3. que una casilla que se queda sin celdas desaparece de la tabla.
 * No toca ninguna base de datos de verdad.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const {
  SQL_TIRAS, tirasDesdeDuenos, CASILLA_TIRAS, casillaDe, casillasDe,
  SQL_TIRAS_CASILLA, SQL_TIRAS_DESCUADRE, tirasDesdeCasillas,
} = await import(join(raiz, 'dist/services/tiras.js'));
const fuente = readFileSync(join(raiz, 'src/routes/index.ts'), 'utf8');
const dist = readFileSync(join(raiz, 'dist/routes/index.js'), 'utf8');

let fallos = 0;
function comprueba(nombre, ok, detalle) {
  if (!ok) fallos++;
  console.log(`${ok ? '✔' : '✘'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
}

// La función de recálculo tal cual la ejecuta el servidor (del JS compilado).
function sacarAsync(nombre) {
  const i = dist.indexOf(`async function ${nombre}(`);
  if (i < 0) throw new Error('No encuentro ' + nombre + ' en dist/routes/index.js');
  return dist.slice(i, dist.indexOf('\n}\n', i) + 2);
}
const recalcularCasillas = new Function('SQL_TIRAS_CASILLA', 'hashCasillas',
  sacarAsync('recalcularCasillas') + '; return recalcularCasillas;')(SQL_TIRAS_CASILLA, 1961);

// La tabla, con la misma definición que crea el servidor al arrancar.
const iniT = fuente.indexOf('CREATE TABLE IF NOT EXISTS tiras_casilla');
const ddl = fuente.slice(iniT, fuente.indexOf('`', iniT));

// ── Casillas y coordenadas negativas ──
comprueba('casilla de 0 y de 127 es la 0', casillaDe(0) === 0 && casillaDe(127) === 0);
comprueba('casilla de 128 es la 1', casillaDe(128) === 1);
comprueba('casilla de -1 y de -128 es la -1 (hacia abajo, no hacia cero)', casillaDe(-1) === -1 && casillaDe(-128) === -1);
comprueba('casilla de -129 es la -2', casillaDe(-129) === -2);
const cs = casillasDe([{ x: 300, y: 5 }, { x: -1, y: -1 }, { x: 299, y: 6 }, { x: 0, y: 0 }]);
comprueba('casillasDe: sin repetir y en orden (x, y)',
  JSON.stringify(cs) === JSON.stringify([{ cx: -1, cy: -1 }, { cx: 0, cy: 0 }, { cx: 2, cy: 0 }]), JSON.stringify(cs));

// ── La base de datos ──
const db = new PGlite();
await db.exec(`
  CREATE TABLE users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), display_name TEXT, war_cry TEXT, color_idx INTEGER);
  CREATE TABLE cells (cell_x INTEGER NOT NULL, cell_y INTEGER NOT NULL, owner_id UUID NOT NULL, run_id UUID,
    claimed_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (cell_x, cell_y));
  CREATE INDEX cells_owner_idx ON cells(owner_id);
  ${ddl};
`);
const alta = async (nombre, idx) => (await db.query(
  'INSERT INTO users (display_name, war_cry, color_idx) VALUES ($1, $2, $3) RETURNING id', [nombre, nombre + '!', idx])).rows[0].id;
const duenos = [await alta('Ibanto', 1), await alta('KarolK', 2), await alta('Oriol15', 3), await alta('Olga', 4)];

// Celdas inventadas con un generador fijo (que la prueba sea la misma cada vez).
let semilla = 20261106;
const azar = () => { semilla = (semilla * 1103515245 + 12345) & 0x7fffffff; return semilla / 0x7fffffff; };
const celdas = new Map(); // "x,y" -> dueño
const pon = (x, y, d) => celdas.set(`${x},${y}`, d);
// Manchas por dueño, a caballo entre casillas (la casilla cambia en x = 0, 128, 256… y también en negativos).
for (let d = 0; d < duenos.length; d++) {
  for (let m = 0; m < 6; m++) {
    const cx = Math.floor(azar() * 500) - 200, cy = Math.floor(azar() * 400) - 150;
    const ancho = 10 + Math.floor(azar() * 90), alto = 5 + Math.floor(azar() * 40);
    for (let y = cy; y < cy + alto; y++) for (let x = cx; x < cx + ancho; x++) if (azar() < 0.85) pon(x, y, d);
  }
}
// Una fila ENTERA de casilla a casilla (tira de 300 celdas que cruza tres casillas).
for (let x = -50; x < 250; x++) pon(x, 77, 1);
// Y celdas sueltas en los bordes exactos.
pon(127, 200, 2); pon(128, 200, 2); pon(-129, -1, 3); pon(-128, -1, 3); pon(-1, 0, 0); pon(0, 0, 0);
{
  const xs = [], ys = [], os = [];
  for (const [k, d] of celdas) { const [x, y] = k.split(',').map(Number); xs.push(x); ys.push(y); os.push(duenos[d]); }
  await db.query(`INSERT INTO cells (cell_x, cell_y, owner_id) SELECT * FROM unnest($1::int[], $2::int[], $3::uuid[])`, [xs, ys, os]);
}
const total = (await db.query('SELECT COUNT(*)::int n FROM cells')).rows[0].n;
console.log(`\n${total} celdas de ${duenos.length} dueños`);

const color = (idx) => `#c${idx}`;
/** Tiras normalizadas para comparar, sin que importe el orden de los dueños. */
function normaliza(r) {
  const out = [];
  for (let i = 0; i < r.tiras.length; i += 4) out.push(`${r.duenos[r.tiras[i]].id} ${r.tiras[i + 1]} ${r.tiras[i + 2]} ${r.tiras[i + 3]}`);
  return out.sort();
}
async function alVuelo(x0, x1, y0, y1) {
  const { rows } = await db.query(SQL_TIRAS, [x0, x1 - 1, y0, y1 - 1]);
  return tirasDesdeDuenos(rows, x0, y0, color);
}
async function deLaTabla(x0, x1, y0, y1) {
  const { rows } = await db.query(
    `SELECT t.casilla_x, t.casilla_y, t.owner_id, u.display_name AS owner_name, u.war_cry AS owner_war_cry,
            u.color_idx AS owner_color_idx, t.ys, t.x0s, t.x1s
       FROM tiras_casilla t JOIN users u ON u.id = t.owner_id
      WHERE t.casilla_x BETWEEN $1 AND $2 AND t.casilla_y BETWEEN $3 AND $4`,
    [Math.floor(x0 / CASILLA_TIRAS), Math.floor((x1 - 1) / CASILLA_TIRAS), Math.floor(y0 / CASILLA_TIRAS), Math.floor((y1 - 1) / CASILLA_TIRAS)]);
  return tirasDesdeCasillas(rows, color);
}
async function descuadradas() {
  return (await db.query(SQL_TIRAS_DESCUADRE)).rows.map(r => `${r.cx}:${r.cy}`);
}
async function rehacer(claves) {
  const casillas = claves.map(k => { const [cx, cy] = k.split(':').map(Number); return { cx, cy }; });
  await db.query('BEGIN');
  await recalcularCasillas(db, casillas);
  await db.query('COMMIT');
}

// ── 1. Primer llenado: con la tabla vacía, el descuadre son todas las casillas con celdas ──
const conCeldas = (await db.query(`SELECT COUNT(*)::int n FROM (SELECT DISTINCT FLOOR(cell_x/128.0), FLOOR(cell_y/128.0) FROM cells) t`)).rows[0].n;
let malas = await descuadradas();
comprueba('tabla vacía: el descuadre señala todas las casillas con celdas', malas.length === conCeldas, `${malas.length} de ${conCeldas}`);
const t0 = performance.now();
await rehacer(malas);
console.log(`  (rehechas ${malas.length} casillas en ${Math.round(performance.now() - t0)} ms)`);
malas = await descuadradas();
comprueba('tras rehacerlas, nada descuadrado', malas.length === 0, malas.join(' '));
const filas = (await db.query('SELECT COUNT(*)::int n, SUM(celdas)::int c FROM tiras_casilla')).rows[0];
comprueba('la tabla suma las mismas celdas que cells', filas.c === total, `${filas.c} en ${filas.n} filas`);

// ── 2. Mismas tiras que al vuelo, en varios encuadres (cajas redondeadas a casillas, como el servidor) ──
const cajas = [
  [-256, 384, -256, 512],   // todo
  [0, 128, 0, 128],         // una casilla
  [-128, 256, 0, 128],      // la fila entera que cruza tres casillas
  [-256, 0, -128, 0],       // solo negativos
  [128, 256, 128, 256],     // una casilla con los bordes 127/128
  [256, 512, 256, 512],     // puede que vacía
];
for (const [x0, x1, y0, y1] of cajas) {
  const a = await alVuelo(x0, x1, y0, y1), b = await deLaTabla(x0, x1, y0, y1);
  const na = normaliza(a), nb = normaliza(b);
  const iguales = na.length === nb.length && na.every((v, i) => v === nb[i]);
  comprueba(`encuadre [${x0}..${x1}]×[${y0}..${y1}]: ${a.n} tiras, ${a.celdas} celdas, iguales`,
    iguales && a.celdas === b.celdas, iguales ? '' : `al vuelo ${na.length} tiras, tabla ${nb.length}`);
}
// Las coordenadas guardadas son relativas a la casilla (0-127), que es lo que las hace pequeñas.
const rango = (await db.query(`SELECT MIN(v) a, MAX(v) b FROM (SELECT unnest(ys) v FROM tiras_casilla UNION ALL SELECT unnest(x0s) FROM tiras_casilla UNION ALL SELECT unnest(x1s) FROM tiras_casilla) t`)).rows[0];
comprueba('las coordenadas de la tabla van de 0 a 127', rango.a === 0 && rango.b === 127, `${rango.a}..${rango.b}`);

// ── 3. Cambios por fuera del servidor ──
// Un robo (cambia el dueño, no el número de celdas) en la casilla (0,0).
await db.query(`UPDATE cells SET owner_id = $1 WHERE cell_x = 0 AND cell_y = 0`, [duenos[2]]);
malas = await descuadradas();
comprueba('un robo hecho por fuera descuadra justo su casilla', malas.length === 1 && malas[0] === '0:0', malas.join(' '));
// Celdas nuevas en una casilla donde no había nada, y un borrado en otra.
await db.query(`INSERT INTO cells (cell_x, cell_y, owner_id) VALUES (1000, 1000, $1), (1001, 1000, $1)`, [duenos[3]]);
await db.query(`DELETE FROM cells WHERE cell_x BETWEEN -129 AND -128 AND cell_y = -1`);
malas = await descuadradas();
// El borrado toca dos casillas (x = -129 está en la -2, x = -128 en la -1).
comprueba('celdas nuevas y borradas: las cuatro casillas, y solo esas',
  JSON.stringify(malas) === JSON.stringify(['-2:-1', '-1:-1', '0:0', '7:7']), malas.join(' '));
await rehacer(malas);
comprueba('tras rehacer, nada descuadrado', (await descuadradas()).length === 0);
const b00 = await deLaTabla(0, 128, 0, 128), a00 = await alVuelo(0, 128, 0, 128);
comprueba('y la casilla del robo vuelve a ser igual que al vuelo', JSON.stringify(normaliza(a00)) === JSON.stringify(normaliza(b00)));
// Una casilla que se queda sin celdas desaparece de la tabla.
await db.query(`DELETE FROM cells WHERE cell_x >= 1000`);
malas = await descuadradas();
comprueba('vaciar una casilla la descuadra', malas.length === 1 && malas[0] === '7:7', malas.join(' '));
await rehacer(malas);
const quedan = (await db.query(`SELECT COUNT(*)::int n FROM tiras_casilla WHERE casilla_x = 7 AND casilla_y = 7`)).rows[0].n;
comprueba('y al rehacerla, sus filas se van de la tabla', quedan === 0 && (await descuadradas()).length === 0);

// ── 4. Rehacer una casilla dos veces no cambia nada (es idempotente) ──
const antes = (await db.query('SELECT casilla_x, casilla_y, owner_id, ys, x0s, x1s, celdas FROM tiras_casilla ORDER BY 1,2,3')).rows;
await rehacer(['0:0', '1:0', '-1:-1']);
const despues = (await db.query('SELECT casilla_x, casilla_y, owner_id, ys, x0s, x1s, celdas FROM tiras_casilla ORDER BY 1,2,3')).rows;
comprueba('rehacer sin cambios deja la tabla igual', JSON.stringify(antes) === JSON.stringify(despues));

console.log(fallos ? `\n${fallos} fallo(s) en las tiras precalculadas.` : '\nTiras precalculadas en orden.');
process.exit(fallos ? 1 : 0);
