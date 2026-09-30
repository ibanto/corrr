/**
 * Comprobación de los cercos (src/services/territorio.ts).
 *
 *   npm run test:territorio
 *
 * Cada caso es una regla del juego escrita en cuadraditos. Si uno falla, el
 * mapa le estaría dando a alguien territorio que no ha rodeado — o quitándole
 * el que sí — así que no se sube nada con esto en rojo.
 */
import { celdasEncerradas, cajaDe, cajaDeTrabajo } from '../dist/services/territorio.js';

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

console.log(fallos ? `\n${fallos} comprobaciones FALLAN.` : '\nCercos en orden.');
process.exit(fallos ? 1 : 0);
