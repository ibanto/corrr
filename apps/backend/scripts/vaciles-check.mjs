/**
 * Comprobación de los vaciles del panel (§9-sexies del CLAUDE.md).
 *
 *   npm run test:vaciles
 *
 * Levanta un Postgres de mentira EN MEMORIA (PGlite, solo en desarrollo) y le
 * pasa la lógica compilada de src/services/vaciles.ts y la consulta de
 * `/taunts/unread` TAL CUAL está en src/routes/index.ts. No toca ninguna base
 * de datos de verdad.
 *
 * Cada caso es una regla: si uno falla, o un vacile nuevo le sale a quien no
 * toca, o al editar una pestaña cambian los ids (y a quien ya recibió uno le
 * saldría otro texto), o el texto no llega a quien lo recibe.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const {
  prepararVaciles, guardarPestanaVaciles, borrarPestanaVaciles, pestanasVacilesAdmin,
  pestanasVacilesPara, lineasDeVaciles, PRIMER_ID_VACILE,
  guardarParejaVacile, quitarParejaVacile, imagenVacile, parteDeCartel,
  pestanasDibujadasPara, interruptorParaPanel,
} = await import(join(raiz, 'dist/services/vaciles.js'));
const fuente = readFileSync(join(raiz, 'src/routes/index.ts'), 'utf8');
const dist = readFileSync(join(raiz, 'dist/routes/index.js'), 'utf8');

let fallos = 0;
function comprueba(nombre, ok, detalle) {
  if (!ok) fallos++;
  console.log(`${ok ? '✔' : '✘'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
}
function sacar(nombre) {
  const i = dist.indexOf(`function ${nombre}(`);
  if (i < 0) throw new Error('No encuentro ' + nombre + ' en dist/routes/index.js');
  return dist.slice(i, dist.indexOf('\n}\n', i) + 2);
}
function consulta(desde, empieza, acaba) {
  const i = fuente.indexOf(desde);
  if (i < 0) throw new Error('No encuentro ' + desde);
  const a = fuente.indexOf(empieza, i) + 1;
  return fuente.slice(a, fuente.indexOf(acaba, a) + acaba.length - 1);
}
const ajusteLeToca = new Function(sacar('ajusteLeToca') + '; return ajusteLeToca;')();

// ── Lo que se pega en el panel ──
const lineas = lineasDeVaciles('  Eh {nombre}, esa calle era mía  \n\n\neh {NOMBRE}, esa calle era mía\r\nVoy   a por ti\n');
comprueba('líneas: quita vacías, espacios de más y repetidas (sin mirar mayúsculas)',
  lineas.length === 2 && lineas[0] === 'Eh {nombre}, esa calle era mía' && lineas[1] === 'Voy a por ti', JSON.stringify(lineas));
comprueba('líneas: corta a 140 letras', lineasDeVaciles('x'.repeat(300))[0].length === 140);
comprueba('líneas: como mucho 50', lineasDeVaciles(Array.from({ length: 80 }, (_, i) => 'm' + i)).length === 50);
comprueba('líneas: también vale una lista', lineasDeVaciles(['a', 'b']).length === 2);

// ── La base de datos ──
const db = new PGlite();
await db.exec(`
  CREATE TABLE users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), display_name TEXT, email TEXT, city TEXT);
  CREATE TABLE runs (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE taunts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL, taunt_id INT, run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
    read_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW());
`);
await prepararVaciles(db);
await prepararVaciles(db);
comprueba('preparar las tablas dos veces no rompe (arranca cada despliegue)', true);

const alta = async (nombre) => (await db.query(
  'INSERT INTO users (display_name, email, city) VALUES ($1, $2, $3) RETURNING id',
  [nombre, nombre.toLowerCase() + '@x.es', 'Barcelona'])).rows[0].id;
const iban = await alta('Ibanto');
const karol = await alta('KarolK');

// Crear una pestaña
const navidad = await guardarPestanaVaciles(db, {
  id: null, nombre: '  Navidad  ', orden: 2, modo: 'no',
  mensajes: ['Eh {nombre}, esa calle era mía', 'Voy a por ti', 'Te veo en la próxima'], respuestas: [],
});
comprueba('crear: el nombre sale limpio', navidad.nombre === 'Navidad');
comprueba('crear: tres mensajes y ninguna respuesta propia', navidad.mensajes.length === 3 && navidad.respuestas.length === 0);
comprueba(`crear: los ids empiezan en ${PRIMER_ID_VACILE} (por debajo están los dibujados)`,
  navidad.mensajes[0].id === PRIMER_ID_VACILE && navidad.mensajes[2].id === PRIMER_ID_VACILE + 2,
  navidad.mensajes.map(m => m.id).join(', '));
const idVoy = navidad.mensajes[1].id;

// Editar: quitar uno, añadir otro, cambiar el orden
const editada = await guardarPestanaVaciles(db, {
  id: navidad.id, nombre: 'Navidad', orden: 2, modo: 'si',
  mensajes: ['Voy a por ti', 'Eh {nombre}, esa calle era mía', 'Feliz Navidad, {nombre}'], respuestas: ['Jo, jo, jo'],
});
comprueba('editar: el que sigue conserva su id aunque cambie de sitio', editada.mensajes[0].id === idVoy);
comprueba('editar: el orden es el de la lista', editada.mensajes.map(m => m.texto).join('|') === 'Voy a por ti|Eh {nombre}, esa calle era mía|Feliz Navidad, {nombre}');
comprueba('editar: el nuevo lleva un id nuevo', editada.mensajes[2].id > navidad.mensajes[2].id);
comprueba('editar: el quitado ya no sale', !editada.mensajes.some(m => m.texto === 'Te veo en la próxima'));
comprueba('editar: con respuesta propia', editada.respuestas.length === 1 && editada.respuestas[0].texto === 'Jo, jo, jo');
const { rows: apagados } = await db.query(`SELECT id FROM vacile_mensajes WHERE NOT activo`);
comprueba('el quitado se apaga, no se borra (su texto sigue ahí para quien lo recibió)', apagados.length === 1);
// Revivir el quitado: mismo id
const revivida = await guardarPestanaVaciles(db, {
  id: navidad.id, nombre: 'Navidad', orden: 2, modo: 'si',
  mensajes: ['Voy a por ti', 'Te veo en la próxima'], respuestas: [],
});
comprueba('revivir un texto quitado le devuelve su id de antes', revivida.mensajes[1].id === navidad.mensajes[2].id);
comprueba('sin respuestas propias otra vez', revivida.respuestas.length === 0);

// Otras pestañas: una en prueba y una apagada
const prueba = await guardarPestanaVaciles(db, { id: null, nombre: 'Prueba', orden: 1, modo: 'prueba:Ibanto', mensajes: ['Solo yo'], respuestas: [] });
await guardarPestanaVaciles(db, { id: null, nombre: 'Apagada', orden: 0, modo: 'no', mensajes: ['Nadie'], respuestas: [] });

// Lo que ve cada corredor
const deIban = await pestanasVacilesPara(db, 'Ibanto', ajusteLeToca);
const deKarol = await pestanasVacilesPara(db, 'KarolK', ajusteLeToca);
const deNadie = await pestanasVacilesPara(db, null, ajusteLeToca);
comprueba('Ibanto ve la de prueba y la encendida, por orden', deIban.map(p => p.nombre).join(',') === 'Prueba,Navidad', deIban.map(p => p.nombre).join(','));
comprueba('KarolK solo ve la encendida', deKarol.map(p => p.nombre).join(',') === 'Navidad');
comprueba('sin nombre, solo las encendidas', deNadie.map(p => p.nombre).join(',') === 'Navidad');
comprueba('la apagada no la ve nadie', !deIban.some(p => p.nombre === 'Apagada'));
comprueba('sin respuestas propias, las respuestas son los mensajes', deKarol[0].respuestas.length === 2 && deKarol[0].respuestas[0].id === deKarol[0].mensajes[0].id);
comprueba('la app no recibe el interruptor', !('modo' in deKarol[0]));

// Pestaña sin mensajes (todos quitados) → no sale aunque esté encendida
await guardarPestanaVaciles(db, { id: prueba.id, nombre: 'Prueba', orden: 1, modo: 'si', mensajes: ['Solo yo'], respuestas: [] });
let saltó = false;
try { await guardarPestanaVaciles(db, { id: prueba.id, nombre: 'Prueba', orden: 1, modo: 'si', mensajes: [], respuestas: [] }); } catch { saltó = true; }
comprueba('guardar sin mensajes no se deja', saltó);
saltó = false;
try { await guardarPestanaVaciles(db, { id: null, nombre: '   ', orden: 0, modo: 'no', mensajes: ['x'], respuestas: [] }); } catch { saltó = true; }
comprueba('guardar sin nombre no se deja', saltó);
saltó = false;
try { await guardarPestanaVaciles(db, { id: 999999, nombre: 'Fantasma', orden: 0, modo: 'no', mensajes: ['x'], respuestas: [] }); } catch { saltó = true; }
comprueba('editar una pestaña que no existe no se deja', saltó);

// ── Enviar y recibir: la consulta de /taunts/unread tal cual está en el código ──
const sqlUnread = consulta("app.get('/taunts/unread'", '`SELECT t.id, t.mode', 'LIMIT 50`');
const idEh = revivida.mensajes[0].id === idVoy ? editada.mensajes[1].id : idVoy;
await db.query(`INSERT INTO taunts (from_user_id, to_user_id, mode, taunt_id) VALUES ($1, $2, 'taunt', $3)`, [iban, karol, idEh]);
await db.query(`INSERT INTO taunts (from_user_id, to_user_id, mode, taunt_id) VALUES ($1, $2, 'response', 3)`, [iban, karol]);
await db.query(`INSERT INTO taunts (from_user_id, to_user_id, mode) VALUES ($1, $2, 'robo_notif')`, [iban, karol]);
const bandeja = (await db.query(sqlUnread, [karol])).rows;
comprueba('la bandeja trae los tres avisos', bandeja.length === 3, String(bandeja.length));
const nuevo = bandeja.find(t => t.taunt_id === idEh);
comprueba('el vacile del panel llega con su texto y el nombre de quien lo recibe puesto',
  nuevo?.texto === 'Eh KarolK, esa calle era mía', nuevo?.texto);
comprueba('y con el nombre de su pestaña', nuevo?.pestana === 'Navidad');
comprueba('y dice quién lo manda', nuevo?.from_user_name === 'Ibanto');
const clasico = bandeja.find(t => t.taunt_id === 3);
comprueba('un clásico (id 3) llega sin texto: la app enseña su dibujo', clasico && clasico.texto === null && clasico.pestana === null);
comprueba('el aviso de robo llega sin texto', bandeja.find(t => t.mode === 'robo_notif')?.texto === null);

// Quitar el mensaje de la lista y eliminar la pestaña: el enviado se sigue leyendo
await guardarPestanaVaciles(db, { id: navidad.id, nombre: 'Navidad', orden: 2, modo: 'si', mensajes: ['Voy a por ti'], respuestas: [] });
comprueba('eliminar la pestaña', await borrarPestanaVaciles(db, navidad.id));
comprueba('eliminarla dos veces dice que ya no está', !(await borrarPestanaVaciles(db, navidad.id)));
comprueba('eliminada: no sale en el panel', !(await pestanasVacilesAdmin(db)).some(p => p.nombre === 'Navidad'));
comprueba('eliminada: no la ve nadie en la app', !(await pestanasVacilesPara(db, 'KarolK', ajusteLeToca)).some(p => p.nombre === 'Navidad'));
const despues = (await db.query(sqlUnread, [karol])).rows.find(t => t.taunt_id === idEh);
comprueba('pero el vacile ya enviado sigue llegando con su texto', despues?.texto === 'Eh KarolK, esa calle era mía', despues?.texto);

// ── Pestañas de carteles (imágenes), como los tótems de Iban ──
const sharp = (await import('sharp')).default;
const png = (color) => sharp({ create: { width: 592, height: 1280, channels: 3, background: color } }).png().toBuffer();
comprueba('parteDeCartel: tótems (03_01_PROVOCACION_sombra_azul.png)',
  JSON.stringify(parteDeCartel('03_01_PROVOCACION_sombra_azul.png')) === JSON.stringify({ numero: 3, cual: 'provocacion', nombre: 'sombra azul' }));
comprueba('parteDeCartel: aura (04_RESPUESTA_amarillo_rankings.png)',
  JSON.stringify(parteDeCartel('04_RESPUESTA_amarillo_rankings.png')) === JSON.stringify({ numero: 4, cual: 'respuesta', nombre: 'amarillo rankings' }));
comprueba('parteDeCartel: otro nombre no vale', parteDeCartel('vista_general.jpg') === null && parteDeCartel('.DS_Store') === null);
const totems = await guardarPestanaVaciles(db, { id: null, nombre: 'Tótems', orden: 5, modo: 'prueba:Ibanto', tipo: 'imagen', mensajes: [], respuestas: [] });
comprueba('pestaña de carteles: se crea vacía', totems.tipo === 'imagen' && totems.mensajes.length === 0);
comprueba('vacía no sale en la app aunque esté en prueba', !(await pestanasVacilesPara(db, 'Ibanto', ajusteLeToca)).some(p => p.nombre === 'Tótems'));
const lobo = await guardarParejaVacile(db, { pestanaId: totems.id, orden: 1, nombre: 'lobo_naranja', provocacion: await png('#ff5500'), respuesta: await png('#0000ff') });
comprueba('pareja: dos ids nuevos, provocación y respuesta', lobo.mensajeId > PRIMER_ID_VACILE && lobo.respuestaId === lobo.mensajeId + 1);
const conCartel = (await pestanasVacilesPara(db, 'Ibanto', ajusteLeToca, 'https://s')).find(p => p.nombre === 'Tótems');
comprueba('con una pareja ya sale, con el cartel y la miniatura', !!conCartel && conCartel.mensajes.length === 1
  && conCartel.mensajes[0].imagen.startsWith('https://s/vaciles/imagen/' + lobo.mensajeId + '.png?v=')
  && conCartel.mensajes[0].miniatura.startsWith('https://s/vaciles/imagen/' + lobo.mensajeId + '-v.jpg?v='), JSON.stringify(conCartel?.mensajes));
comprueba('el texto de reserva es el nombre, con espacios', conCartel?.mensajes[0].texto === 'lobo naranja');
comprueba('la respuesta es la suya, no el mensaje', conCartel?.respuestas[0].id === lobo.respuestaId && !!conCartel?.respuestas[0].imagen);
const guardado = await imagenVacile(db, lobo.mensajeId);
const metaPng = await sharp(guardado.png).metadata();
const metaJpg = await sharp(guardado.jpg).metadata();
comprueba('el cartel se guarda en PNG 592×1280', metaPng.format === 'png' && metaPng.width === 592 && metaPng.height === 1280);
comprueba('la miniatura es JPG 288×512', metaJpg.format === 'jpeg' && metaJpg.width === 288 && metaJpg.height === 512);
comprueba('un mensaje sin cartel da null', (await imagenVacile(db, 3)) === null);
const chica = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } }).png().toBuffer();
const lobo2 = await guardarParejaVacile(db, { pestanaId: totems.id, orden: 1, nombre: 'lobo naranja', provocacion: chica, respuesta: chica });
comprueba('subir otra vez la misma pareja conserva los ids', lobo2.mensajeId === lobo.mensajeId && lobo2.respuestaId === lobo.respuestaId);
const g2 = await imagenVacile(db, lobo.mensajeId);
const meta2 = await sharp(g2.png).metadata();
comprueba('y el cartel nuevo se encaja a 592×1280 con otra versión', meta2.width === 592 && meta2.height === 1280 && g2.version !== guardado.version);
saltó = false;
try { await guardarParejaVacile(db, { pestanaId: totems.id, orden: 2, nombre: 'rota', provocacion: Buffer.from('no soy una imagen'), respuesta: chica }); } catch { saltó = true; }
comprueba('una imagen que no se puede leer no se guarda', saltó);
saltó = false;
try { await guardarParejaVacile(db, { pestanaId: prueba.id, orden: 1, nombre: 'x', provocacion: chica, respuesta: chica }); } catch { saltó = true; }
comprueba('una pestaña de texto no admite carteles', saltó);
await db.query(`INSERT INTO taunts (from_user_id, to_user_id, mode, taunt_id) VALUES ($1, $2, 'taunt', $3)`, [iban, karol, lobo.mensajeId]);
const deCartel = (await db.query(sqlUnread, [karol])).rows.find(t => t.taunt_id === lobo.mensajeId);
comprueba('en la bandeja viene la versión del cartel y el nombre de reserva', !!deCartel && deCartel.imagen_version === g2.version && deCartel.texto === 'lobo naranja');
comprueba('un clásico sigue llegando sin versión de cartel', clasico.imagen_version === null);
comprueba('guardar el nombre o el interruptor no toca los carteles',
  (await guardarPestanaVaciles(db, { id: totems.id, nombre: 'Tótems', orden: 5, modo: 'si', tipo: 'imagen', mensajes: [], respuestas: [] })).mensajes.length === 1);
comprueba('quitar la pareja', await quitarParejaVacile(db, totems.id, 'lobo_naranja'));
comprueba('quitada: la pestaña se queda vacía y no sale en la app', !(await pestanasVacilesPara(db, 'KarolK', ajusteLeToca)).some(p => p.nombre === 'Tótems'));
comprueba('pero el vacile de cartel enviado sigue trayendo su cartel',
  (await db.query(sqlUnread, [karol])).rows.find(t => t.taunt_id === lobo.mensajeId)?.imagen_version === g2.version);

// La pestaña HALLOWEEN, dibujada en la app, con su interruptor del panel.
comprueba('la pestaña Halloween va apagada mientras nadie la toque',
  !pestanasDibujadasPara(undefined, 'Ibanto', ajusteLeToca).halloween && !pestanasDibujadasPara('no', 'KarolK', ajusteLeToca).halloween);
comprueba('en prueba solo le sale a quien se diga',
  pestanasDibujadasPara('prueba:Ibanto', 'Ibanto', ajusteLeToca).halloween && !pestanasDibujadasPara('prueba:Ibanto', 'KarolK', ajusteLeToca).halloween);
comprueba('encendida le sale a todo el mundo', pestanasDibujadasPara('si', null, ajusteLeToca).halloween);
const interruptor = interruptorParaPanel('prueba:Ibanto,KarolK');
comprueba('el interruptor se pinta en el panel como los de las demás',
  interruptor.modo === 'prueba' && interruptor.corredores === 'Ibanto,KarolK'
  && interruptorParaPanel('si').modo === 'todos' && interruptorParaPanel(null).modo === 'apagado');

console.log(fallos ? `\n${fallos} fallo(s) en los vaciles.` : '\nVaciles en orden.');
process.exit(fallos ? 1 : 0);
