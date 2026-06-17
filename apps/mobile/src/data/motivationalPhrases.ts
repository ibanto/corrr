/**
 * Frases motivacionales "canallas" que rotan en el HUD de carrera (sustituyen
 * al antiguo km/h). Cambian cada minuto. Tono: chulesco, con humor, territorial
 * — la marca CORRR (robar zonas, conquistar el barrio). Se muestran en MAYÚSCULAS
 * (lo aplica el estilo), así que aquí van en caja normal.
 *
 * Reglas de contenido (Play PEGI 3): nada de tacos fuertes, insultos a colectivos
 * ni violencia real. Chulería y piques de barrio sí, pero limpios.
 *
 * Para ampliar: añade líneas al array. El HUD elige una al azar y evita repetir
 * la inmediatamente anterior. Lote inicial ~150; escalable a gusto.
 */
export const MOTIVATIONAL_PHRASES: string[] = [
  // ── Esfuerzo / no rendirse ───────────────────────────────────────────────
  'Un paso más y el barrio es tuyo',
  'El sofá no conquista nada',
  'Hoy sudas, mañana reinas',
  'Menos excusas y más kilómetros',
  'La calle se gana corriendo',
  'Tus piernas pueden más que tu cabeza',
  'No pares, que casi lo tienes',
  'Cada zancada es territorio',
  'El asfalto es tuyo, fírmalo',
  'Duele porque está funcionando',
  'Last km, primer trofeo',
  'Quien aprieta, conquista',
  'Hazlo por el tú de mañana',
  'El cansancio se va, el barrio se queda',
  'Corre ahora, presume luego',
  'Un kilómetro más no mató a nadie',
  'Aguanta, que la cuesta también se acaba',
  'Tú a lo tuyo: comerte la calle',
  'El que resopla, avanza',
  'Hoy no es día de medias tintas',
  'Más rápido que tus dudas',
  'El límite te lo pones tú',
  'Piernas, no me falléis ahora',
  'Sigue, que esto ya es tuyo',
  'El dolor es temporal, el mapa es para siempre',

  // ── Chulería / canalla ───────────────────────────────────────────────────
  'Esos matados no te alcanzan ni en bici',
  'Pisa fuerte, que tiemblen los vecinos',
  'Aquí mando yo, y se nota',
  'Corre como si fuera tuyo, porque lo es',
  'Que aprendan viéndote pasar',
  'Tú no corres, desfilas',
  'El barrio ya sabe quién manda',
  'Deja huella, no excusas',
  'Llegas tú y se acaba la fiesta ajena',
  'Modo jefe activado',
  'No te sigo, te adelanto',
  'El asfalto te conoce de sobra',
  'Más leyenda y menos charla',
  'Que te vean, que para eso corres',
  'Polvo es lo que vas a dejar',
  'Te lo ganas tú, no te lo regalan',
  'Calle conquistada, ego intacto',
  'El miedo se queda en casa',
  'Vas sobrado y se nota',
  'Hoy el récord lo pones tú',

  // ── Robo / piques con rivales ────────────────────────────────────────────
  'Roba hoy y no lo dejes para mañana',
  'El que no corre, te lo roba',
  'Quítale el barrio al de al lado',
  'Tu rival desayuna, tú conquistas',
  'Mientras otros duermen, tú pintas el mapa',
  'Esa zona pide tu nombre',
  'Hoy le toca llorar al vecino',
  'Píllale las calles antes que él',
  'Si no es tuyo, hazlo tuyo',
  'Devuélvele la visita al que te robó',
  'El mapa no se comparte, se conquista',
  'Tú robas zonas, ellos excusas',
  'Que se entere quién pisó primero',
  'A por las calles del rival',
  'Lo que pisas, lo firmas',
  'Hoy cae otra zona enemiga',
  'No le dejes ni una manzana',
  'El rey del barrio eres tú',
  'Pinta de naranja lo que era suyo',
  'Vienen a por lo tuyo: corre más',

  // ── Humor ────────────────────────────────────────────────────────────────
  'Corre como si te persiguiera tu ex',
  'El bus no espera, tú tampoco',
  'Más sudor que un examen final',
  'Tus excusas no caben en las zapatillas',
  'El sofá llamó: que no le hagas caso',
  'Hoy las croquetas las has ganado',
  'Corre, que el helado se derrite',
  'Ni el wifi te llega tan lejos',
  'Vas tan rápido que Google Maps suda',
  'El gimnasio cobra, la calle no',
  'Menos scroll y más rock',
  'La báscula te va a aplaudir',
  'Corre hoy, presume en stories',
  'Esa cuesta era una excusa con asfalto',
  'Adelantas hasta a tus problemas',
  'Tu playlist no se va a escuchar sola',
  'Más millas que tu coche este mes',
  'Si llueve, mejor: menos testigos',
  'El semáforo en rojo no cuenta como descanso',
  'Corre, que el lunes vuelve igual',

  // ── Identidad CORRR / territorio ─────────────────────────────────────────
  'Cada celda cuenta, píntala',
  'El mapa es un lienzo y tú el spray',
  'Naranja manda',
  'Conquista lo que pisas',
  'Tu nombre en cada esquina',
  'El barrio se pinta con sudor',
  'Suma calles, no excusas',
  'De esquina en esquina, todo tuyo',
  'Hoy el mapa cambia de dueño',
  'Pisada a pisada se hace imperio',
  'No corres por correr, conquistas',
  'Cada metro es una bandera',
  'El territorio no se hereda, se corre',
  'Que el mapa hable de ti',
  'Hazte grande calle a calle',
  'La ciudad es tuya si la pisas',
  'Pinta tu zona antes de que oscurezca',
  'Tu reino empieza en la siguiente esquina',
  'Más zonas, más leyenda',
  'El asfalto recuerda a los que corren',

  // ── Arranque / motivación pura ───────────────────────────────────────────
  'Empieza ya, lo demás es ruido',
  'El primer paso es el más valiente',
  'No esperes el lunes, hazlo hoy',
  'Las ganas se construyen corriendo',
  'Sal y rómpela',
  'Tú decides hasta dónde llega tu barrio',
  'La mejor versión de ti va corriendo',
  'Hoy te superas, mañana presumes',
  'Demuéstrate de lo que vas',
  'Lo difícil es salir; lo demás, inercia',
  'Cada salida es una victoria',
  'Conviértete en el rival a batir',
  'Hoy escribes tu propio récord',
  'El asfalto premia a los constantes',
  'Sé el motivo de envidia del barrio',
  'A correr, que la vida es corta y la calle larga',
  'Ponte las pilas y las zapatillas',
  'Tu única competencia eres tú de ayer',
  'Hazlo cansado, hazlo igual',
  'El barrio no se conquista solo',

  // ── Aguante / momento duro ───────────────────────────────────────────────
  'Cuando quieras parar, una más',
  'La cabeza se rinde antes que las piernas',
  'Respira, aprieta, sigue',
  'Esto que duele es lo que cuenta',
  'No bajes el ritmo, baja el ego del rival',
  'Que el cansancio te pille corriendo',
  'Aguanta: ya estás más cerca que antes',
  'El que no afloja, gana terreno',
  'Sufre ahora, fardea luego',
  'Convierte el ardor en kilómetros',
  'No es una cuesta, es un trampolín',
  'Tú puedes con esto y con el rival',
  'Cada respiración te acerca al mapa',
  'El último esfuerzo es el que se nota',
  'No pares por una excusa con piernas',

  // ── Cierre / cierre de zona ──────────────────────────────────────────────
  'Cierra el círculo y el barrio es tuyo',
  'Vuelve al inicio y firma la zona',
  'Un loop más y a presumir',
  'Encierra el territorio, no las dudas',
  'Cierra la zona antes que el rival',
  'El círculo se cierra, el barrio cae',
  'Dale la vuelta y conquista',
  'Casi cierras: no aflojes ahora',
  'Termina lo que empezaste, jefe',
  'Cierra fuerte y que tiemblen',
];

/** Devuelve una frase al azar distinta de `prev` (si se pasa) para no repetir
 *  la inmediatamente anterior. */
export function randomPhrase(prev?: string): string {
  const list = MOTIVATIONAL_PHRASES;
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  let next = list[Math.floor(Math.random() * list.length)];
  // Evita repetir la frase inmediatamente anterior (bucle acotado: 2+ elementos).
  while (next === prev) {
    next = list[Math.floor(Math.random() * list.length)];
  }
  return next;
}
