/**
 * Comprobación de los cercos (src/services/territorio.ts).
 *
 *   npm run test:territorio
 *
 * Cada caso es una regla del juego escrita en cuadraditos. Si uno falla, el
 * mapa le estaría dando a alguien territorio que no ha rodeado — o quitándole
 * el que sí — así que no se sube nada con esto en rojo.
 */
import { celdasEncerradas, cajaDe, cajaDeTrabajo, gruposDeCeldas, soloElBorde } from '../dist/services/territorio.js';

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

/** Disco relleno de radio r (en celdas), como lo deja fillEnclosedCells. */
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
  // Lo que la app no rellena nunca (caja de más de 2.000.000) no se toca.
  comprueba('una caja que la app no rellena se rechaza',
    soloElBorde([{ x: 0, y: 0 }, { x: 3000, y: 3000 }]) === null, 'null');
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
