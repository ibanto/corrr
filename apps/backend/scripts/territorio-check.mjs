/**
 * Comprobación de los cercos (src/services/territorio.ts).
 *
 *   npm run test:territorio
 *
 * Cada caso es una regla del juego escrita en cuadraditos. Si uno falla, el
 * mapa le estaría dando a alguien territorio que no ha rodeado — o quitándole
 * el que sí — así que no se sube nada con esto en rojo.
 */
import { celdasEncerradas, cajaDe } from '../dist/services/territorio.js';

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

console.log(fallos ? `\n${fallos} comprobaciones FALLAN.` : '\nCercos en orden.');
process.exit(fallos ? 1 : 0);
