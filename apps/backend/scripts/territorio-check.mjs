/**
 * Comprobación de los cercos (src/services/territorio.ts).
 *
 *   npm run test:territorio
 *
 * Cada caso es una regla del juego escrita en cuadraditos. Si uno falla, el
 * mapa le estaría dando a alguien territorio que no ha rodeado — o quitándole
 * el que sí — así que no se sube nada con esto en rojo.
 */
import { celdasEncerradas, cajaDe, cajaDeTrabajo, gruposDeCeldas, soloElBorde, celdasParaGuardar } from '../dist/services/territorio.js';

let fallos = 0;
function comprueba(nombre, ok, detalle) {
  if (!ok) fallos++;
  console.log(`${ok ? '✔' : '✘'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
}

/** Marco hueco de lado n, esquina inferior izquierda en (0,0). */
function marco(n) {
  const c = [];
  for (let i = 0; i < n; i++) {
    c.push({ x: i, y: 0 }, { x: i, y: n - 1 }, { x: 0, y: i }, { x: n - 1, y: i });
  }
  return c;
}

{
  const dentro = celdasEncerradas(marco(10));
  comprueba('un cerco cerrado deja dentro su interior', dentro.length === 64, `${dentro.length} celdas (8×8)`);
}

{
  // El mismo marco con una celda menos: por ahí se escapa la inundación.
  const roto = marco(10).filter(c => !(c.x === 5 && c.y === 0));
  comprueba('un cerco con un hueco no encierra nada', celdasEncerradas(roto).length === 0, '0 celdas');
}

{
  // Rombo: sus lados solo se tocan en diagonal. Tiene que cerrar igual, que
  // es lo que perdona el zigzag del GPS.
  const r = 6, rombo = [];
  for (let i = 0; i <= r; i++) {
    rombo.push({ x: i, y: r - i }, { x: -i, y: r - i }, { x: i, y: i - r }, { x: -i, y: i - r });
  }
  const dentro = celdasEncerradas(rombo);
  comprueba('un cerco en diagonal también cierra', dentro.length > 30, `${dentro.length} celdas dentro`);
}

{
  // Dos cercos separados: cada uno con lo suyo, sin unirlos por el camino.
  const a = marco(6);
  const b = marco(6).map(c => ({ x: c.x + 40, y: c.y + 40 }));
  const dentro = celdasEncerradas([...a, ...b]);
  comprueba('dos cercos separados no se unen', dentro.length === 32, `${dentro.length} celdas (16 + 16)`);
}

{
  // Una recta no encierra nada, por larga que sea.
  const recta = Array.from({ length: 500 }, (_, i) => ({ x: i, y: 0 }));
  comprueba('una recta no encierra nada', celdasEncerradas(recta).length === 0, '0 celdas');
}

{
  // El tope de trabajo: una caja enorme no se intenta siquiera.
  const lejos = [{ x: 0, y: 0 }, { x: 5000, y: 5000 }];
  comprueba('una caja desmesurada se deja estar', celdasEncerradas(lejos).length === 0, 'no se calcula');
}

{
  const c = cajaDe([{ x: 3, y: 7 }, { x: 5, y: 2 }]);
  comprueba('la caja lleva un margen para poder rodear',
    c.x0 === 2 && c.x1 === 6 && c.y0 === 1 && c.y1 === 8, JSON.stringify(c));
}

{
  // El tope son 10 km² (100.000 celdas, MAX_CELDAS_CERCO). Un cerco de casi
  // ese tamaño tiene que salir entero y rápido: esto corre DENTRO de guardar
  // la carrera, así que si se arrastra, al corredor se le queda la app
  // pensando al pulsar STOP.
  const lado = 310;
  const t0 = Date.now();
  const dentro = celdasEncerradas(marco(lado));
  const ms = Date.now() - t0;
  const esperado = (lado - 2) ** 2;
  comprueba('un cerco de casi 10 km² se calcula entero y rápido',
    dentro.length === esperado && ms < 2000,
    `${dentro.length} celdas en ${ms} ms (esperadas ${esperado})`);
}

{
  // Lo que le pasó a Zuckerbax (30-sep-2026): una carrera ancha pedía 3 km de
  // margen, no cabía en la caja de trabajo y el servidor se SALTABA el cerco
  // entero sin decir nada, así que hubo que dárselo a mano desde el panel.
  // Ahora el margen se encoge y se mira igual.
  for (const km of [1, 2, 4, 8]) {
    const carrera = [{ x: 0, y: 0 }, { x: km * 100, y: km * 100 }];
    const caja = cajaDeTrabajo(carrera, 300);
    comprueba(`una carrera de ${km} km de ancho sigue teniendo caja`, caja !== null,
      caja ? `margen de ${-caja.x0} celdas` : 'NO SE MIRA EL CERCO');
  }
}

{
  // Y que el cerco grande de verdad se llene, con esa caja encogida.
  const anillo = marco(200); // 2 km de lado
  const caja = cajaDeTrabajo(anillo, 300);
  const dentro = caja ? celdasEncerradas(anillo, caja) : [];
  comprueba('un anillo de 2 km de lado se llena entero', dentro.length === 198 * 198,
    `${dentro.length} celdas (esperadas ${198 * 198})`);
}

{
  // Quien corre en dos ciudades: su caja abarca el vacío de en medio y no se
  // le podía mirar el cerco NUNCA. Separando las zonas, cada una cabe.
  const barcelona = marco(60);
  const asturias = marco(60).map(c => ({ x: c.x + 60000, y: c.y + 30000 }));
  const grupos = gruposDeCeldas([...barcelona, ...asturias]);
  comprueba('dos ciudades se separan en dos zonas', grupos.length === 2,
    `${grupos.length} zonas de ${grupos.map(g => g.length).join(' y ')} celdas`);

  const dentro = grupos.reduce((n, g) => n + celdasEncerradas(g).length, 0);
  comprueba('y el cerco de cada ciudad se llena', dentro === 58 * 58 * 2,
    `${dentro} celdas (esperadas ${58 * 58 * 2})`);

  // Sin separar, ni se intenta: es justo el caso que se escapaba.
  comprueba('sin separar, esa misma caja es inabarcable',
    celdasEncerradas([...barcelona, ...asturias]).length === 0, 'no se calcula');
}

{
  // Un barrio no se parte en trozos por tener huecos: las calles de una zona
  // están a metros, no a kilómetros.
  const barrio = [];
  for (let i = 0; i < 300; i += 3) barrio.push({ x: i, y: 0 }, { x: 0, y: i });
  comprueba('un barrio con huecos sigue siendo UNA zona',
    gruposDeCeldas(barrio).length === 1, `${gruposDeCeldas(barrio).length} zona(s)`);
}

// ── Vueltas demasiado grandes para apuntarlas enteras (POST /runs) ─────────
// La app manda el recorrido MÁS el interior relleno. Por encima de 100.000
// celdas el servidor se queda solo con el borde y el interior lo decide el
// cerco. Si el borde no encerrase lo de dentro, la vuelta se perdería en
// silencio: por eso se comprueba con el MISMO cálculo de cercos.

/** Disco relleno de radio r (en celdas), como lo deja la app al rellenar una
 *  vuelta (claimLoopInterior). */
function discoRelleno(r, cx = 0, cy = 0) {
  const c = [];
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) c.push({ x: x + cx, y: y + cy });
  }
  return c;
}

{
  // Un cuadrado relleno: el borde es su contorno, y el contorno encierra
  // exactamente lo que se ha quitado.
  const lado = 400, lleno = [];
  for (let y = 0; y < lado; y++) for (let x = 0; x < lado; x++) lleno.push({ x, y });
  const borde = soloElBorde(lleno);
  comprueba('el borde de un cuadrado relleno es su contorno', borde.length === 4 * lado - 4,
    `${borde.length} celdas (esperadas ${4 * lado - 4})`);
  const caja = cajaDeTrabajo(borde, 300);
  const dentro = caja ? celdasEncerradas(borde, caja) : [];
  comprueba('y el cerco ve dentro todo lo quitado', dentro.length === lleno.length - borde.length,
    `${dentro.length} celdas (esperadas ${lleno.length - borde.length})`);
}

{
  // El caso de verdad: una vuelta redonda de ~15 km, ~18 km² (~179.000
  // celdas). Con el tope en 100.000 se perdía ENTERA.
  const t0 = Date.now();
  const vuelta = discoRelleno(239, 17000, 460000);
  const borde = soloElBorde(vuelta);
  const ms = Date.now() - t0;
  const caja = cajaDeTrabajo(borde, 300);
  const dentro = caja ? celdasEncerradas(borde, caja) : [];
  comprueba('una vuelta de ~18 km² se queda en su borde, y rápido',
    borde.length < 5000 && ms < 1000, `${vuelta.length} → ${borde.length} celdas en ${ms} ms`);
  comprueba('y su interior entero llega al cerco (que avisará: pasa de 10 km²)',
    dentro.length === vuelta.length - borde.length && dentro.length > 100_000,
    `${dentro.length} celdas`);
}

{
  // Repetidas: salen una vez (el INSERT no admite dos veces la misma celda).
  const lleno = [];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) lleno.push({ x, y });
  const borde = soloElBorde([...lleno, ...lleno]);
  comprueba('las celdas repetidas salen una sola vez', borde.length === 36, `${borde.length} celdas`);
}

{
  // Una recta o un recorrido sin rellenar se quedan como están.
  const recta = Array.from({ length: 500 }, (_, i) => ({ x: i, y: 0 }));
  comprueba('un recorrido sin relleno es todo borde', soloElBorde(recta).length === 500, '500 celdas');
}

{
  // Dos vueltas rellenas lejos una de otra: la caja de la carrera no cabe en
  // la rejilla (más de 4.000.000) y va por el Set. Tiene que dar lo mismo que
  // mirar cada vuelta por su cuenta.
  const a = discoRelleno(150, 0, 0), b = discoRelleno(150, 3000, 3000);
  const juntas = soloElBorde([...a, ...b]).length;
  const separadas = soloElBorde(a).length + soloElBorde(b).length;
  comprueba('dos vueltas lejos (caja de más de 4.000.000) dan el mismo borde que por separado',
    juntas === separadas, `${juntas} celdas (esperadas ${separadas})`);
  comprueba('y dos celdas sueltas en una caja enorme son las dos borde',
    soloElBorde([{ x: 0, y: 0 }, { x: 3000, y: 3000 }]).length === 2);
}

// ── Qué se apunta de una carrera (celdasParaGuardar, POST /runs) ───────────
// Hasta el 10-nov-2026, por encima de 100.000 celdas el servidor contestaba
// 400 y la carrera se perdía ENTERA, kilómetros incluidos.

/** Rectángulo relleno de a × b celdas: lo que manda la app al cerrar una
 *  vuelta de a/100 × b/100 km (el recorrido es su contorno). */
function rectanguloRelleno(a, b, x0 = 0, y0 = 0) {
  const c = [];
  for (let y = 0; y < b; y++) for (let x = 0; x < a; x++) c.push({ x: x + x0, y: y + y0 });
  return c;
}

{
  // Lo de siempre no cambia: hasta 100.000 se apunta todo, tal cual.
  const vuelta = rectanguloRelleno(300, 300);
  const r = celdasParaGuardar(vuelta);
  comprueba('una vuelta de 3 × 3 km (90.000) se apunta entera, como siempre',
    r !== null && r.celdas === vuelta && r.dentro === 0, `${r?.celdas.length} celdas`);
}

{
  // El caso que se perdía: vuelta de 4 × 3 km, 14 km corridos, 120.000 celdas.
  const vuelta = rectanguloRelleno(400, 300, 17000, 460000);
  const r = celdasParaGuardar(vuelta);
  comprueba('una vuelta de 4 × 3 km (120.000) ya no se rechaza: se apunta el borde',
    r !== null && r.celdas.length <= 100_000, r ? `${r.celdas.length} celdas, ${r.dentro} para el cerco` : 'rechazada');
  const fuera = (c) => c.x === 17000 || c.x === 17399 || c.y === 460000 || c.y === 460299;
  const contorno = vuelta.filter(fuera).length;
  comprueba('y el borde es todo el contorno de la vuelta (lo que da al exterior)',
    r !== null && r.celdas.length === contorno && r.celdas.every(fuera), `${contorno} celdas`);
  const caja = r ? cajaDeTrabajo(r.celdas, 300) : null;
  const dentro = caja ? celdasEncerradas(r.celdas, caja) : [];
  comprueba('el cerco ve dentro todo lo que no se apuntó (más de 100.000: avisará)',
    r !== null && dentro.length === r.dentro && dentro.length > 100_000, `${dentro.length} celdas`);
}

{
  // Justo por encima: una vuelta de casi 10 km² más 10 km de ida y vuelta
  // hasta ella. Pasa de 100.000 entre las dos cosas, pero lo de dentro cabe en
  // el tope del cerco: el corredor lo recupera entero al guardar.
  const vuelta = rectanguloRelleno(316, 316);
  const ida = Array.from({ length: 1000 }, (_, i) => ({ x: -1 - i, y: 150 }));
  const carrera = [...vuelta, ...ida];
  const r = celdasParaGuardar(carrera);
  const caja = r ? cajaDeTrabajo(r.celdas, 300) : null;
  const dentro = caja ? celdasEncerradas(r.celdas, caja) : [];
  comprueba('justo por encima del tope, lo de dentro vuelve entero por el cerco',
    carrera.length > 100_000 && r !== null && dentro.length === r.dentro && dentro.length <= 100_000
      && r.celdas.length + dentro.length === carrera.length,
    `${carrera.length} → ${r?.celdas.length} apuntadas + ${dentro.length} por el cerco`);
}

{
  // Una petición fabricada que no es una vuelta (todo borde, un tablero de
  // ajedrez) sigue rechazándose: ni el borde cabe.
  const tablero = [];
  for (let y = 0; y < 500; y++) for (let x = 0; x < 500; x++) if ((x + y) % 2 === 0) tablero.push({ x, y });
  comprueba('un tablero de 125.000 celdas sueltas se sigue rechazando',
    tablero.length > 100_000 && celdasParaGuardar(tablero) === null, `${tablero.length} celdas`);
}

{
  // Cerca de lo máximo que deja pasar el bodyLimit (10 MB, ~450.000 celdas).
  const vuelta = discoRelleno(366, 17000, 460000);
  const t0 = Date.now();
  const borde = soloElBorde(vuelta);
  const ms = Date.now() - t0;
  const caja = cajaDeTrabajo(borde, 300);
  comprueba('con ~420.000 celdas sigue cabiendo el cerco y tarda poco',
    caja !== null && ms < 1000, `${vuelta.length} → ${borde.length} celdas en ${ms} ms, caja ${caja ? 'sí' : 'NO'}`);
}

console.log(fallos ? `\n${fallos} comprobaciones FALLAN.` : '\nCercos en orden.');
process.exit(fallos ? 1 : 0);
