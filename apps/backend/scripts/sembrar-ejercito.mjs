/**
 * Pinta el decorado del EJÉRCITO CORRR en las ciudades donde no corre nadie.
 *
 *   node scripts/sembrar-ejercito.mjs            # ENSAYO
 *   node scripts/sembrar-ejercito.mjs --de-verdad
 *
 * PARA QUÉ: de 47 corredores, 26 no han corrido nunca y hay 27 ciudades con una
 * sola persona. Quien se da de alta en Burgos abre el mapa, lo ve gris y no
 * vuelve. Esto NO es el juego de los bots (§13 del CLAUDE.md) — eso llega en
 * noviembre. Esto es territorio pintado para que una ciudad vacía no parezca un
 * pueblo fantasma.
 *
 * CÓMO SE PINTA, que es lo que importa. La primera versión dejaba rectángulos
 * perfectos y cantaba a la legua: "es un cuadrado, no nos sirve" (Iban, 4-oct).
 * Ahora se imita lo que hace una persona: se DA UNA VUELTA saltando de punto de
 * calle en punto de calle —así el recorrido va por la calle y no por dentro de
 * las manzanas—, se vuelve al principio y se rellena lo de dentro. Sale una
 * mancha con bordes irregulares, con mordiscos donde hay un parque o un río, y
 * con la forma del callejero de esa ciudad.
 *
 * Y la vuelta se da EN EL CENTRO: el centro se saca de los datos, buscando dónde
 * hay más calles por kilómetro cuadrado, que es el casco urbano. Antes salía en
 * un descampado junto a la M-30.
 *
 * No roba nada: solo ocupa celdas sin dueño.
 */
import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const deVerdad = process.argv.includes('--de-verdad');

const EJERCITO = ['El Galgo', 'La Liebre', 'El Zorro', 'El Lobo', 'La Gaviota'];
const CIUDAD = 'EJÉRCITO CORRR';

/** Vueltas por ciudad, según lo grande que sea.
 *
 *  Dos para todas no vale: Madrid son 600 km² y dos manchas se pierden ("queda
 *  desangelado", Iban). Se calcula con los puntos de calle de la zona, que es
 *  una buena medida de cuánto casco urbano hay: Madrid saca 7, una capital
 *  mediana 4, un pueblo 2. */
const vueltasDe = (puntosDeCalle) =>
  Math.max(2, Math.min(8, Math.round(puntosDeCalle / 900)));
/** Separación mínima entre los barrios que se rodean, en celdas. 120 = 1,2 km:
 *  lo bastante lejos para que se vean como sitios distintos de la ciudad. */
const SEPARACION_BARRIOS = 120;
/** Pasos por vuelta. El mapa COMPLETO (datos/calles.json) tiene un punto cada
 *  40 m, así que 130 pasos son unos 5 km: una vuelta larga de barrio.
 *
 *  Se usa el fichero completo y no la tabla `calles` a propósito: la tabla está
 *  adelgazada a un punto cada 100 m —vale para sembrar calabazas, que solo
 *  necesitan saber que ahí hay asfalto— y con esa separación el paseo salta en
 *  línea recta de punto a punto y corta por encima de las manzanas. Con 40 m,
 *  el salto cabe dentro de la propia calle y el recorrido la sigue. */
const PASOS = 130;
/** Salto máximo entre dos puntos seguidos, en celdas. 6 = 60 m: por encima del
 *  paso de 40 m del mapa, pero menos que el ancho de una manzana. */
const SALTO = 6;
/** Ancho del rastro, en celdas a cada lado (1 = 30 m de ancho). */
const ANCHO = 1;

const ca = readFileSync(new URL('../src/db/supabase-ca.ts', import.meta.url), 'utf8')
  .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];
const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }, max: 2,
});

const CELL_LAT = 10 / 111000, CELL_LNG = 10 / (111000 * Math.cos(40 * Math.PI / 180));

/** El mapa de calles SIN adelgazar, tal y como se bajó: un punto cada 40 m. */
const MAPA_COMPLETO = (() => {
  const c = JSON.parse(readFileSync(new URL('../datos/calles.json', import.meta.url), 'utf8'));
  return Array.isArray(c) ? c : (c.celdas ?? []);
})();
console.log(`Mapa de calles completo: ${MAPA_COMPLETO.length.toLocaleString('es-ES')} puntos (uno cada 40 m)\n`);

/** Los puntos de ese mapa que caen en una caja. */
function calles(caja) {
  const out = [];
  for (const p of MAPA_COMPLETO) {
    const x = Array.isArray(p) ? p[0] : p.x, y = Array.isArray(p) ? p[1] : p.y;
    if (x >= caja.x0 && x <= caja.x1 && y >= caja.y0 && y <= caja.y1) out.push({ x, y });
  }
  return out;
}
const aCelda = (lat, lon) => ({ x: Math.floor(lon / CELL_LNG), y: Math.floor(lat / CELL_LAT) });
const clave = (x, y) => x + ',' + y;

/** Línea entre dos celdas (Bresenham), para que el rastro no tenga huecos. */
function entre(a, b, dentro) {
  let x = a.x, y = a.y;
  const dx = Math.abs(b.x - x), dy = Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1, sy = y < b.y ? 1 : -1;
  let err = dx - dy, guarda = 0;
  for (;;) {
    for (let i = -ANCHO; i <= ANCHO; i++) for (let j = -ANCHO; j <= ANCHO; j++) dentro.add(clave(x + i, y + j));
    if ((x === b.x && y === b.y) || guarda++ > 3000) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

/** Una vuelta ALREDEDOR de un barrio, siguiendo las calles.
 *
 *  Dos intentos fallidos antes de llegar aquí, y los dos se vieron dibujando el
 *  resultado antes de pintar nada:
 *
 *   1. Cerrar uniendo el último punto con el primero en línea recta. Si el
 *      paseo acababa lejos, esa recta cruzaba media ciudad por encima de los
 *      edificios ("El Galgo ha hecho una cosa muy rara, una recta", Iban).
 *   2. Alejarse todo lo posible y volver. Sale una tira larga y estrecha: es
 *      una ida y vuelta, no un circuito, y no encierra un barrio.
 *
 *  Lo que hace una persona es DAR LA VUELTA a una manzana. Así que se elige un
 *  centro y un radio, y se va rodeándolo: en cada paso se busca el punto de
 *  calle más parecido al siguiente punto del círculo. Como los puntos son calles
 *  de verdad, el recorrido va por ellas y el círculo sale abollado — que es
 *  exactamente como se ve el territorio de alguien que ha dado la vuelta a su
 *  barrio.
 */
function daUnaVuelta(puntos, centro) {
  const porClave = new Map(puntos.map(p => [clave(p.x, p.y), p]));

  // CADA VUELTA, SU FORMA. La primera versión usaba siempre el mismo molde
  // —un círculo con tres bultos— y puestas en el mapa una al lado de otra
  // cantaban: "las formas son todas muy iguales" (Iban, 4-oct). El territorio
  // de una persona no se parece al de otra, y eso es lo que hay que imitar.
  //
  // Tres cosas al azar en cada una:
  //   · el tamaño, de 250 a 900 m de radio — hay quien da la vuelta a la
  //     manzana y quien se hace el barrio entero;
  //   · un achatamiento en una dirección cualquiera, que es lo que sale cuando
  //     corres a lo largo de un río, una avenida o un paseo marítimo;
  //   · dos o tres ondas de distinto tamaño, que hacen los entrantes y
  //     salientes. Antes era siempre una, y de ahí el aire de familia.
  const radio = 25 + Math.random() * 65;
  const giro = Math.random() < 0.5 ? 1 : -1;      // a derechas o a izquierdas
  const desde = Math.random() * Math.PI * 2;
  // Achatamiento: 1 es redonda, 0,45 es claramente alargada.
  const achata = 0.45 + Math.random() * 0.55;
  const ejeAchatado = Math.random() * Math.PI;
  // Las ondas del borde.
  const ondas = Array.from({ length: 2 + Math.floor(Math.random() * 2) }, () => ({
    veces: 2 + Math.floor(Math.random() * 4),     // cuántos entrantes da
    tamano: 0.06 + Math.random() * 0.17,
    giro: Math.random() * Math.PI * 2,
  }));
  /** El radio en un ángulo dado, ya con sus ondas. */
  const radioEn = (a) => {
    let r = 1;
    for (const o of ondas) r += o.tamano * Math.sin(o.veces * a + o.giro);
    return radio * Math.max(0.35, r);
  };

  /** El punto de calle más cercano a una posición ideal, dentro de un margen. */
  const masCerca = (x, y, margen) => {
    let mejor = null, mejorD = Infinity;
    for (let dx = -margen; dx <= margen; dx++) for (let dy = -margen; dy <= margen; dy++) {
      const c = clave(Math.round(x) + dx, Math.round(y) + dy);
      if (!porClave.has(c)) continue;
      const d = dx * dx + dy * dy;
      if (d < mejorD) { mejorD = d; mejor = porClave.get(c); }
    }
    return mejor;
  };

  // Los sitios por los que tiene que pasar la vuelta, repartidos por el
  // contorno. NO son el recorrido: son las balizas. Entre una y otra se va
  // ANDANDO por las calles.
  const balizas = [];
  const vueltas = 36;
  for (let i = 0; i < vueltas; i++) {
    const a = desde + giro * (i / vueltas) * Math.PI * 2;
    const r = radioEn(a);
    // Se achata en una dirección cualquiera: se gira el punto al eje, se
    // aplasta, y se devuelve. Es lo que convierte un redondel en la forma de
    // quien corre siempre a lo largo de la misma avenida.
    const bx = r * Math.cos(a), by = r * Math.sin(a);
    const cs = Math.cos(ejeAchatado), sn = Math.sin(ejeAchatado);
    const gx = (bx * cs + by * sn), gy = (-bx * sn + by * cs) * achata;
    balizas.push({ x: centro.x + (gx * cs - gy * sn), y: centro.y + (gx * sn + gy * cs) });
  }

  // Y ahora, de baliza en baliza, ANDANDO.
  //
  // Antes se unía una baliza con la siguiente en línea recta, y esas rectas
  // cruzaban por encima de las manzanas: "deben seguir las calles, que si no es
  // muy fake" (Iban, 4-oct). Ahora se da un paso de 60 m cada vez, siempre a un
  // punto de calle, eligiendo el que más acerca a la baliza. Como todos los
  // puntos son calle de verdad, el recorrido entero va por la calle y el
  // contorno sale con los quiebros del callejero, no redondeado.
  const PASO = 4;                                  // 40 m: el mismo paso con el que se bajó el mapa
  const primera = masCerca(balizas[0].x, balizas[0].y, 16);
  if (!primera) return null;
  const ruta = [primera];
  let actual = primera;
  let rumbo = null;                                // hacia dónde se venía andando
  let perdidas = 0;
  for (const baliza of [...balizas.slice(1), balizas[0]]) {
    let margen = 80;                               // pasos como mucho por tramo
    while (margen-- > 0) {
      const d = Math.hypot(actual.x - baliza.x, actual.y - baliza.y);
      if (d <= PASO) break;
      let mejor = null, mejorNota = -Infinity;
      for (let dx = -PASO; dx <= PASO; dx++) for (let dy = -PASO; dy <= PASO; dy++) {
        if (dx === 0 && dy === 0) continue;
        const c = porClave.get(clave(actual.x + dx, actual.y + dy));
        if (!c) continue;
        const nd = Math.hypot(c.x - baliza.x, c.y - baliza.y);
        if (nd >= d) continue;                     // solo pasos que acercan
        // LA INERCIA, que es lo que hace que parezca de verdad.
        //
        // Sin esto, el paseo va casi recto hacia la baliza: en el centro de una
        // ciudad hay puntos de calle cada 40 m en todas direcciones, así que
        // siempre hay uno "hacia allá" y el borde sale redondeado. Una persona
        // no hace eso: tira recto por la calle hasta la esquina y entonces
        // gira. Premiando seguir en la misma dirección salen tramos rectos y
        // esquinas, que es lo que se ve en el mapa de alguien de verdad.
        const largo = Math.hypot(dx, dy) || 1;
        const seguido = rumbo ? (dx * rumbo.x + dy * rumbo.y) / largo : 0;
        // El 14 está medido, no puesto a ojo: con 4,5 el borde serpentea y
        // sale redondeado; con 14 tira recto por la calle y solo gira cuando
        // no le queda otra, que es lo que hace esquinas en ángulo. Se comparó
        // dibujando las dos con la misma forma de partida.
        const nota = (d - nd) + seguido * 14;
        if (nota > mejorNota) { mejorNota = nota; mejor = c; }
      }
      if (!mejor) break;                           // calle sin salida hacia allí
      const vx = mejor.x - actual.x, vy = mejor.y - actual.y;
      const n = Math.hypot(vx, vy) || 1;
      rumbo = { x: vx / n, y: vy / n };
      ruta.push(mejor);
      actual = mejor;
    }
    if (Math.hypot(actual.x - baliza.x, actual.y - baliza.y) > PASO * 4) perdidas++;
  }
  // Si no ha podido llegar a un tercio de las balizas, ahí no hay callejero
  // suficiente: se descarta la vuelta entera en vez de inventar un atajo.
  if (perdidas > vueltas / 3 || ruta.length < 40) return null;
  ruta.push(ruta[0]);

  const celdas = new Set();
  for (let i = 1; i < ruta.length; i++) entre(ruta[i - 1], ruta[i], celdas);
  return celdas;
}

/** Lo de dentro de la vuelta: se inunda desde el borde y lo que no se moja,
 *  está encerrado. Es lo mismo que hace el servidor con los cercos. */
function rellena(celdas) {
  const xs = [...celdas].map(k => +k.split(',')[0]), ys = [...celdas].map(k => +k.split(',')[1]);
  const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1;
  const y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1;
  const fuera = new Set();
  const cola = [];
  for (let x = x0; x <= x1; x++) { cola.push([x, y0]); cola.push([x, y1]); }
  for (let y = y0; y <= y1; y++) { cola.push([x0, y]); cola.push([x1, y]); }
  while (cola.length) {
    const [x, y] = cola.pop();
    const k = clave(x, y);
    if (x < x0 || x > x1 || y < y0 || y > y1 || fuera.has(k) || celdas.has(k)) continue;
    fuera.add(k);
    cola.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  const todo = new Set(celdas);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const k = clave(x, y);
    if (!fuera.has(k)) todo.add(k);
  }
  return todo;
}

// ── Dónde hace falta ────────────────────────────────────────────────────────
const zonas = JSON.parse(readFileSync(new URL('../datos/zonas.json', import.meta.url), 'utf8'));
const objetivo = [];
for (const z of zonas) {
  const a = aCelda(z.sur, z.oeste), b = aCelda(z.norte, z.este);
  const { rows: [g] } = await db.query(
    `SELECT COUNT(DISTINCT c.owner_id)::int AS gente FROM cells c JOIN users u ON u.id = c.owner_id
      WHERE NOT u.es_bot AND c.cell_x BETWEEN $1 AND $2 AND c.cell_y BETWEEN $3 AND $4`,
    [a.x, b.x, a.y, b.y]);
  const { rows: [c] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM calles WHERE cell_x BETWEEN $1 AND $2 AND cell_y BETWEEN $3 AND $4`,
    [a.x, b.x, a.y, b.y]);
  if (c.n < 500 || g.gente > 1) continue;

  // El centro: si hay una persona, su barrio. Si no, donde más calles hay por
  // km², que es el casco urbano — no el descampado de la salida de la ciudad.
  let centro = null;
  if (g.gente === 1) {
    const { rows: [p] } = await db.query(
      `SELECT ROUND(AVG(c.cell_x))::int x, ROUND(AVG(c.cell_y))::int y FROM cells c JOIN users u ON u.id = c.owner_id
        WHERE NOT u.es_bot AND c.cell_x BETWEEN $1 AND $2 AND c.cell_y BETWEEN $3 AND $4`,
      [a.x, b.x, a.y, b.y]);
    if (p?.x != null) centro = { x: p.x, y: p.y, porque: 'junto a esa persona' };
  }
  if (!centro) {
    const { rows: [p] } = await db.query(
      `SELECT (cell_x / 100 * 100) gx, (cell_y / 100 * 100) gy, COUNT(*)::int n FROM calles
        WHERE cell_x BETWEEN $1 AND $2 AND cell_y BETWEEN $3 AND $4
        GROUP BY 1, 2 ORDER BY n DESC LIMIT 1`,
      [a.x, b.x, a.y, b.y]);
    if (p) centro = { x: p.gx + 50, y: p.gy + 50, porque: 'el centro' };
  }
  if (!centro) continue;
  objetivo.push({ caja: { x0: a.x, x1: b.x, y0: a.y, y1: b.y }, gente: g.gente, calles: c.n, centro,
                  donde: `${((z.sur + z.norte) / 2).toFixed(3)}, ${((z.oeste + z.este) / 2).toFixed(3)}` });
}
objetivo.sort((p, q) => q.calles - p.calles);
console.log(`Ciudades a decorar: ${objetivo.length}\n`);

// ── Las vueltas ─────────────────────────────────────────────────────────────
const plan = [];
let total = 0;
for (const [i, z] of objetivo.entries()) {
  // Los barrios a rodear: los cuadrados de 1 km con más calles, repartidos por
  // la ciudad y separados entre sí. Así en Madrid salen manchas en el centro y
  // en varios barrios, en vez de todas apiladas en el mismo sitio.
  const { rows: densos } = await db.query(
    `SELECT (cell_x / 100 * 100) gx, (cell_y / 100 * 100) gy, COUNT(*)::int n FROM calles
      WHERE cell_x BETWEEN $1 AND $2 AND cell_y BETWEEN $3 AND $4
      GROUP BY 1, 2 ORDER BY n DESC LIMIT 80`,
    [z.caja.x0, z.caja.x1, z.caja.y0, z.caja.y1]);
  const cuantas = vueltasDe(z.calles);
  const barrios = [];
  // El primero, el centro de la ciudad (o el barrio de quien vive ahí).
  barrios.push({ x: z.centro.x, y: z.centro.y });
  for (const d of densos) {
    if (barrios.length >= cuantas) break;
    const c = { x: d.gx + 50, y: d.gy + 50 };
    if (barrios.every(b => Math.abs(b.x - c.x) > SEPARACION_BARRIOS || Math.abs(b.y - c.y) > SEPARACION_BARRIOS)) {
      barrios.push(c);
    }
  }
  // Los puntos de calle de TODA la ciudad: las vueltas ya no son solo del centro.
  const puntos = calles(z.caja);
  if (puntos.length < 400) { console.log(`  ${z.donde.padEnd(18)} pocas calles, se salta`); continue; }
  let deLaCiudad = 0;
  for (const [v, barrio] of barrios.entries()) {
    // Solo las calles de ese barrio: así la vuelta no se va a buscar una calle
    // al otro lado de la ciudad.
    const cerca = puntos.filter(p => Math.abs(p.x - barrio.x) < 120 && Math.abs(p.y - barrio.y) < 120);
    if (cerca.length < 300) continue;
    const ruta = daUnaVuelta(cerca, barrio);
    if (!ruta || ruta.size < 300) continue;
    const mancha = rellena(ruta);
    plan.push({ dueno: (i * 3 + v) % EJERCITO.length, celdas: mancha });
    deLaCiudad += mancha.size; total += mancha.size;
  }
  console.log(`  ${z.donde.padEnd(18)} ${String(z.gente)} corredor(es) · ${String(barrios.length).padStart(2)} barrios → ${(deLaCiudad / 10000).toFixed(2)} km²`);
}
console.log(`\n${plan.length} vueltas · ${total.toLocaleString('es-ES')} celdas = ${(total / 10000).toFixed(1)} km² en total`);

if (!deVerdad) { console.log('\nEnsayo. Para hacerlo de verdad: --de-verdad'); await db.end(); process.exit(0); }

// ── Hacerlo ─────────────────────────────────────────────────────────────────
const cliente = await db.connect();
try {
  await cliente.query('BEGIN');
  const ids = [];
  for (const nombre of EJERCITO) {
    const { rows: ya } = await cliente.query('SELECT id FROM users WHERE LOWER(display_name) = LOWER($1)', [nombre]);
    if (ya.length) { ids.push(ya[0].id); continue; }
    const { rows: [u] } = await cliente.query(
      `INSERT INTO users (email, password_hash, display_name, city, es_bot)
       VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
      [`ejercito-${randomUUID()}@corrr.invalid`, 'x', nombre, CIUDAD]);
    await cliente.query('INSERT INTO user_stats (user_id) VALUES ($1)', [u.id]);
    ids.push(u.id);
    console.log(`  creado: ${nombre}`);
  }
  // Fuera lo de la vez anterior (los cuadrados). Solo lo suyo.
  const { rowCount: borradas } = await cliente.query(
    `DELETE FROM cells WHERE owner_id = ANY($1::uuid[])`, [ids]);
  if (borradas) console.log(`  borradas ${borradas.toLocaleString('es-ES')} celdas de la vez anterior`);

  let puestas = 0;
  for (const m of plan) {
    const xs = [], ys = [];
    for (const k of m.celdas) { const [x, y] = k.split(',').map(Number); xs.push(x); ys.push(y); }
    for (let i = 0; i < xs.length; i += 5000) {
      const { rowCount } = await cliente.query(
        `INSERT INTO cells (cell_x, cell_y, owner_id, claimed_at)
         SELECT x, y, $3::uuid, NOW() FROM unnest($1::int[], $2::int[]) AS t(x, y)
         ON CONFLICT (cell_x, cell_y) DO NOTHING`,
        [xs.slice(i, i + 5000), ys.slice(i, i + 5000), ids[m.dueno]]);
      puestas += rowCount ?? 0;
    }
  }
  for (const id of ids) {
    await cliente.query(
      `UPDATE user_stats SET total_cells = (SELECT COUNT(*) FROM cells WHERE owner_id = $1) WHERE user_id = $1`, [id]);
  }
  await cliente.query('COMMIT');
  console.log(`\nHecho. ${puestas.toLocaleString('es-ES')} celdas pintadas.`);
} catch (e) {
  await cliente.query('ROLLBACK');
  console.error('\nNo se ha tocado nada:', e.message);
  throw e;
} finally { cliente.release(); }
await db.end();
