/**
 * Objetos en el mapa: cosas que se recogen pisándolas al correr.
 *
 * Empieza con las calabazas de Halloween (29 al 31 de octubre de 2026), pero
 * está hecho para que sirva para lo que venga: el tipo es un texto y los
 * puntos van en cada objeto, así que montar otro juego es sembrar objetos de
 * otro tipo, sin tocar nada más.
 *
 * Tres decisiones que lo hacen simple y difícil de romper:
 *
 *   · SE SIEMBRAN SOBRE CALLES DE VERDAD, no al azar por el mapa. España son
 *     506.000 km² y las calles por las que se puede correr son una porción
 *     mínima: tirándolas al azar, prácticamente todas caerían en un campo, en
 *     el monte o en el mar, y una calabaza mide 10×10 m — hay que pisar ese
 *     cuadrado exacto. Las calles salen de OpenStreetMap (tabla `calles`,
 *     ver scripts/bajar-calles.mjs), que es libre y gratis. También se puede
 *     sembrar solo sobre calles YA pisadas (`fuente: 'pisadas'`).
 *
 *   · LAS RECOGE EL SERVIDOR, no la app. Al guardar la carrera se mira qué
 *     objetos libres caen en las celdas que esa carrera reclama. La app no
 *     puede decir "me he comido diez calabazas": solo puede correr por ellas.
 *
 *   · AL COMERSE UNA, NACE OTRA en otro sitio. Así el número se mantiene
 *     durante todo el evento y el mapa no se queda pelado el primer día.
 */

/** Distancia mínima entre dos objetos, en celdas (10 m cada una). 30 celdas =
 *  300 m: lo bastante cerca para cruzarte varias en una carrera, lo bastante
 *  lejos para que no salgan de dos en dos en la misma esquina. */
const SEPARACION_CELDAS = 30;

export type Objeto = { id: number; x: number; y: number; puntos: number; tipo: string;
  /** Fin del evento al que pertenece; lo hereda el que nace en su lugar. */
  hasta: string | null };

/** Siembra `cuantos` objetos en celdas ya pisadas dentro de la caja indicada.
 *  Devuelve cuántos se pudieron colocar: si la zona es pequeña o ya está llena
 *  de objetos, pueden ser menos de los pedidos, y eso no es un error. */
export async function sembrar(
  db: { query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }> },
  opciones: {
    cuantos: number;
    tipo: string;
    puntos: number;
    desde: Date;
    hasta: Date;
    /** Caja en celdas. Sin ella, cualquier celda del mapa. */
    caja?: { x0: number; x1: number; y0: number; y1: number };
    /** De dónde salen las candidatas:
     *   · 'calles'  — CUALQUIER calle de OpenStreetMap, la haya pisado alguien
     *                 o no. Es lo que hace que salgan por sitios nuevos.
     *   · 'pisadas' — solo calles por las que ya ha corrido alguien.
     *  Las dos garantizan que la calabaza cae sobre asfalto y se puede coger:
     *  soltarlas al azar por España dejaría el 99,99% en mitad de un campo. */
    fuente?: 'calles' | 'pisadas';
  },
): Promise<number> {
  const { cuantos, tipo, puntos, desde, hasta, caja, fuente = 'calles' } = opciones;
  if (cuantos <= 0) return 0;

  // Candidatas en orden aleatorio. Se piden de más porque muchas se
  // descartarán por caer demasiado cerca de otro objeto.
  // Si el mapa de calles aún no se ha cargado, se tira de las pisadas en vez
  // de sembrar cero calabazas y dejar el evento vacío sin decir nada.
  let tabla = fuente === 'pisadas' ? 'cells' : 'calles';
  if (tabla === 'calles') {
    const { rows: hay } = await db.query('SELECT 1 FROM calles LIMIT 1');
    if (hay.length === 0) tabla = 'cells';
  }
  const filtro = caja
    ? `WHERE cell_x BETWEEN ${caja.x0} AND ${caja.x1} AND cell_y BETWEEN ${caja.y0} AND ${caja.y1}`
    : '';
  const { rows: candidatas } = await db.query(
    `SELECT cell_x, cell_y FROM ${tabla} ${filtro} ORDER BY random() LIMIT $1`,
    [cuantos * 25],
  );

  // Los que ya están puestos y siguen libres, para respetar la separación.
  const { rows: puestos } = await db.query(
    `SELECT cell_x, cell_y FROM objetos WHERE tomado_por IS NULL AND (hasta IS NULL OR hasta > NOW())`,
  );
  const ocupadas = puestos.map((o: any) => ({ x: o.cell_x, y: o.cell_y }));

  const nuevas: { x: number; y: number }[] = [];
  for (const c of candidatas) {
    if (nuevas.length >= cuantos) break;
    const x = c.cell_x, y = c.cell_y;
    const lejos = (p: { x: number; y: number }) =>
      Math.abs(p.x - x) > SEPARACION_CELDAS || Math.abs(p.y - y) > SEPARACION_CELDAS;
    if (!ocupadas.every(lejos) || !nuevas.every(lejos)) continue;
    nuevas.push({ x, y });
  }
  if (nuevas.length === 0) return 0;

  await db.query(
    `INSERT INTO objetos (tipo, cell_x, cell_y, puntos, desde, hasta)
     SELECT $1, x, y, $2, $3, $4 FROM unnest($5::int[], $6::int[]) AS t(x, y)`,
    [tipo, puntos, desde.toISOString(), hasta.toISOString(),
     nuevas.map(n => n.x), nuevas.map(n => n.y)],
  );
  return nuevas.length;
}

/** Los objetos libres que caen dentro de las celdas de una carrera, marcados
 *  como recogidos por ese corredor. Devuelve los que se ha llevado.
 *
 *  El `UPDATE ... WHERE tomado_por IS NULL` es lo que impide que dos carreras
 *  guardadas a la vez se lleven la misma calabaza: la segunda no encuentra
 *  nada que actualizar. */
export async function recoger(
  client: { query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }> },
  userId: string,
  /** Las celdas que ha PISADO. De aquí se coge todo, bueno y malo. */
  pisadas: { x: number; y: number }[],
  cuando: Date,
  /** Las que han quedado DENTRO de un cerco. De aquí solo se coge lo que
   *  suma.
   *
   *  LA REGLA: el cerco recoge lo que suma; lo que resta hay que pisarlo.
   *  Si rodeas una manzana, la calabaza de dentro es tuya —te has ganado el
   *  barrio—, pero el zombi que haya ahí no te hace nada: al zombi hay que
   *  pisarlo. Si no, cerrar un cerco sería una ruleta rusa y nadie cerraría
   *  ninguno. Vale igual para lo que venga después: lo que puntúe en negativo
   *  nunca entra por el cerco. */
  cercadas: { x: number; y: number }[] = [],
): Promise<Objeto[]> {
  const celdas = [...pisadas, ...cercadas];
  if (celdas.length === 0) return [];
  // Las de dentro del cerco solo valen si el objeto suma. Se marca con un
  // booleano por celda, en paralelo a las coordenadas.
  const soloSiSuma = [
    ...pisadas.map(() => false),
    ...cercadas.map(() => true),
  ];
  const { rows } = await client.query(
    `UPDATE objetos o
        SET tomado_por = $1, tomado_at = $4
      WHERE o.tomado_por IS NULL
        AND o.desde <= $4 AND (o.hasta IS NULL OR o.hasta > $4)
        AND EXISTS (
          SELECT 1 FROM unnest($2::int[], $3::int[], $5::boolean[]) AS t(x, y, solo_suma)
           WHERE t.x = o.cell_x AND t.y = o.cell_y
             AND (NOT t.solo_suma OR o.puntos > 0))
      RETURNING o.id, o.cell_x, o.cell_y, o.puntos, o.tipo, o.hasta`,
    [userId, celdas.map(c => c.x), celdas.map(c => c.y), cuando.toISOString(), soloSiSuma],
  );
  return rows.map((r: any) => ({
    id: r.id, x: r.cell_x, y: r.cell_y, puntos: r.puntos, tipo: r.tipo,
    hasta: r.hasta ? new Date(r.hasta).toISOString() : null,
  }));
}
