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
 * Cada caso es una regla del juego. Si uno falla, o alguien deja de ver un
 * reto encendido, o alguien coge un logo sin haberse apuntado, o los logos
 * dejan de cogerse al apagar Halloween (que es justo lo que pasaba hasta el
 * 6-nov-2026), o un reto terminado vuelve a parecer en marcha (12-nov-2026).
 * No se sube nada con esto en rojo.
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
/** Lo mismo para las que hablan con la base de datos (`async function`). */
function sacarAsync(nombre) {
  const i = dist.indexOf(`async function ${nombre}(`);
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
// Desde el 12-nov-2026 el reto lo ve todo el mundo; «de aquí» solo lo ordena.
comprueba('reto de dos ciudades: es de la ciudad de uno de Badalona', await deAqui(karol, 'Badalona', 'tienda') === true);
comprueba('reto de dos ciudades: es de la ciudad de uno de Barcelona', await deAqui(iban, 'Barcelona', 'tienda') === true);
comprueba('reto de dos ciudades: NO es de la ciudad de uno de Sevilla', await deAqui(sevi, 'Sevilla', 'tienda') === false);
comprueba('campaña de antes: es de la ciudad de uno de «malaga» sin tilde', await deAqui(malaga, 'malaga', 'vieja') === true);
comprueba('campaña de antes: NO es de la ciudad de uno de Sevilla', await deAqui(sevi, 'Sevilla', 'vieja') === false);

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

// ── Retos de todas las ciudades y retos terminados (12-nov-2026) ──
// Las funciones del servidor TAL CUAL, hablando con este Postgres de mentira.
const lineaEvento = dist.slice(dist.indexOf('const DE_ESTE_EVENTO'), dist.indexOf('\n', dist.indexOf('const DE_ESTE_EVENTO')) + 1);
const { retosPara, clasificacionDe, retoTerminado, cuantosGanan, retoParaAppDeAntes } = new Function('db', 'ajusteLeToca',
  lineaEvento + sacar('cuantosGanan') + sacar('retoParaAppDeAntes') + sacarAsync('clasificacionDe')
  + sacarAsync('retoTerminado') + sacarAsync('retosPara')
  + '; return { retosPara, clasificacionDe, retoTerminado, cuantosGanan, retoParaAppDeAntes };')(db, ajusteLeToca);

const ana = await alta('Ana', 'Sevilla');
const hace = (horas) => new Date(Date.now() - horas * 3600000).toISOString();
await db.query(`INSERT INTO campanas (tipo, datos, modo, creada_at) VALUES
  ('acabado', $1, 'si', NOW() - INTERVAL '3 days'), ('desierto', $2, 'si', NOW() - INTERVAL '4 days'),
  ('oculto', $3, 'no', NOW()), ('enprueba', $4, 'prueba:Ibanto', NOW() - INTERVAL '5 days')`,
  [JSON.stringify({ tipo: 'acabado', nombre: 'Acabado', ciudad: 'Sevilla', fechas: 'DEL 1 AL 7', texto: 'Cómo va', ganan: 2 }),
   JSON.stringify({ tipo: 'desierto', nombre: 'Desierto', ciudad: 'Barcelona', fechas: '', texto: 'Cómo va' }),
   JSON.stringify({ tipo: 'oculto', nombre: 'Oculto', ciudad: 'Barcelona' }),
   JSON.stringify({ tipo: 'enprueba', nombre: 'En prueba', ciudad: 'Sevilla' })]);
// «acabado»: sus logos caducaron hace una hora. Ibanto y KarolK empatan a 3,
// pero Ibanto llegó antes; Ana cogió 1; Sevillano cogió 5 SIN apuntarse.
const cogido = (tipo, quien, cuando, hasta) => db.query(
  `INSERT INTO objetos (tipo, cell_x, cell_y, puntos, desde, hasta, tomado_por, tomado_at)
   VALUES ($1, 1, 1, 200, $4, $5, $2, $3)`, [tipo, quien, cuando, hace(200), hasta]);
const finAcabado = hace(1);
for (const h of [50, 40, 30]) await cogido('acabado', iban, hace(h), finAcabado);
for (const h of [45, 35, 20]) await cogido('acabado', karol, hace(h), finAcabado);
await cogido('acabado', ana, hace(25), finAcabado);
for (const h of [60, 59, 58, 57, 56]) await cogido('acabado', sevi, hace(h), finAcabado);
await db.query(`INSERT INTO campana_apuntados (tipo, user_id) VALUES ('acabado', $1), ('acabado', $2), ('acabado', $3)`,
  [iban, karol, ana]);
// «desierto»: caducó y nadie cogió nada. Y unas calabazas viejas, que no son un reto.
await db.query(`INSERT INTO objetos (tipo, cell_x, cell_y, puntos, desde, hasta) VALUES
  ('desierto', 5, 5, 200, $1, $2), ('calabaza', 900, 900, 200, $1, $2)`, [hace(200), hace(2)]);

const deSevi = await retosPara(sevi, true);
const deIban = await retosPara(iban, true);
const el = (lista, tipo) => lista.find(x => x.tipo === tipo);
comprueba('uno de Sevilla ve el reto de Barcelona y Badalona', !!el(deSevi, 'tienda') && el(deSevi, 'tienda').deAqui === false);
comprueba('y el suyo le sale marcado como de su ciudad', el(deSevi, 'acabado')?.deAqui === true);
comprueba('el apagado no lo ve nadie', !el(deSevi, 'oculto') && !el(deIban, 'oculto'));
comprueba('el que está en prueba solo lo ve quien lo prueba', !el(deSevi, 'enprueba') && !!el(deIban, 'enprueba'));
comprueba('no viajan los límites de la ciudad', !('limites' in el(deSevi, 'tienda')) && !('zonas' in el(deSevi, 'tienda')));
comprueba('en marcha delante (los de su ciudad primero) y terminados al final',
  deIban.map(x => x.tipo).join(',') === 'tienda,vieja,enprueba,desierto,acabado', deIban.map(x => x.tipo).join(','));
comprueba('con logos sin caducar: en marcha y sin ganadores', el(deIban, 'tienda').finalizado === false && !el(deIban, 'tienda').ganadores);
comprueba('sin logos sembrados: ni terminado ni fecha de fin', el(deIban, 'vieja').finalizado === false && el(deIban, 'vieja').hasta === null);
const acabado = el(deIban, 'acabado');
comprueba('logos caducados: terminado, con su fecha de fin', acabado.finalizado === true && acabado.hasta === finAcabado, acabado.hasta);
comprueba('ganan los que diga el panel (2), en orden, y el empate es para quien llegó antes',
  acabado.ganadores.map(g => g.name).join(',') === 'Ibanto,KarolK', acabado.ganadores.map(g => `${g.name} ${g.cuantos}`).join(', '));
comprueba('el ganador se reconoce a sí mismo', acabado.ganadores[0].mine === true && acabado.ganadores[1].mine === false
  && el(deSevi, 'acabado').ganadores.every(g => !g.mine));
comprueba('quien no se apuntó no gana aunque cogiera más', !(await clasificacionDe('acabado', 20)).some(g => g.display_name === 'Sevillano'));
comprueba('la clasificación final entera: Ibanto, KarolK, Ana',
  (await clasificacionDe('acabado', 20)).map(g => `${g.display_name} ${g.cuantos}`).join(', ') === 'Ibanto 3, KarolK 3, Ana 1');
const desierto = el(deIban, 'desierto');
comprueba('terminado sin que nadie cogiera nada: sin ganadores', desierto.finalizado === true && desierto.ganadores.length === 0);
comprueba('sin nada escrito en el panel ganan 3', desierto.ganan === 3 && acabado.ganan === 2);
comprueba('cuántos ganan: ni cero, ni letras, ni más de veinte',
  cuantosGanan({ ganan: '1' }) === 1 && cuantosGanan({ ganan: 0 }) === 3 && cuantosGanan({ ganan: 'x' }) === 3
  && cuantosGanan({ ganan: 99 }) === 20 && cuantosGanan(null) === 3);
comprueba('retoTerminado: el acabado sí, el que sigue no, y las calabazas viejas no son un reto',
  await retoTerminado('acabado') === true && await retoTerminado('tienda') === false
  && await retoTerminado('vieja') === false && await retoTerminado('calabaza') === false);

// Lo que reciben las apps de hasta la 1.11.16, que no saben de retos terminados.
const viejoAcabado = retoParaAppDeAntes(acabado);
comprueba('app de antes: el terminado lleva FINALIZADO delante de las fechas', viejoAcabado.fechas === 'FINALIZADO · SEVILLA · DEL 1 AL 7', viejoAcabado.fechas);
comprueba('app de antes: los ganadores van en el texto',
  viejoAcabado.texto === 'Este reto ha terminado. Ya no se puede apuntar nadie.\n\nGANADORES\n1.º Ibanto · 3 logos\n2.º KarolK · 3 logos',
  JSON.stringify(viejoAcabado.texto));
comprueba('app de antes: al de esa ciudad no se le repite la ciudad', retoParaAppDeAntes(el(deSevi, 'acabado')).fechas === 'FINALIZADO · DEL 1 AL 7');
const viejoDesierto = retoParaAppDeAntes(desierto);
comprueba('app de antes: terminado sin ganadores, y lo dice', viejoDesierto.fechas === 'FINALIZADO' && /sin ganadores/.test(viejoDesierto.texto), viejoDesierto.fechas);
comprueba('app de antes: un reto en marcha de su ciudad va tal cual', retoParaAppDeAntes(el(deIban, 'tienda')) === el(deIban, 'tienda'));
comprueba('app de antes: un reto en marcha de otra ciudad dice dónde es',
  retoParaAppDeAntes(el(deSevi, 'tienda')).fechas === 'BARCELONA, BADALONA' && retoParaAppDeAntes(el(deSevi, 'tienda')).texto === el(deSevi, 'tienda').texto);

// Sembrar más logos con otra fecha en un reto terminado lo vuelve a poner en marcha.
await db.query(`INSERT INTO objetos (tipo, cell_x, cell_y, puntos, desde, hasta) VALUES ('acabado', 7, 7, 200, $1, $2)`, [antes, futuro]);
comprueba('si se vuelve a sembrar con otra fecha, vuelve a estar en marcha y de cero',
  el(await retosPara(iban, true), 'acabado').finalizado === false && await retoTerminado('acabado') === false
  && (await clasificacionDe('acabado', 20)).length === 0);

console.log(fallos ? `\n${fallos} fallo(s) en las campañas.` : '\nCampañas en orden.');
process.exit(fallos ? 1 : 0);
