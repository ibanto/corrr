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
 *   · SE SIEMBRAN SOBRE CALLES YA PISADAS. Se eligen celdas que alguien ha
 *     corrido de verdad (tabla `cells`), así que ninguna calabaza cae dentro
 *     de un edificio, en un río o en mitad de una autopista. Y no hace falta
 *     ningún mapa de calles de pago.
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
  },
): Promise<number> {
  const { cuantos, tipo, puntos, desde, hasta, caja } = opciones;
  if (cuantos <= 0) return 0;

  // Candidatas: celdas pisadas, en orden aleatorio. Se piden de más porque
  // muchas se descartarán por estar demasiado cerca de otro objeto.
  const filtro = caja
    ? `WHERE cell_x BETWEEN ${caja.x0} AND ${caja.x1} AND cell_y BETWEEN ${caja.y0} AND ${caja.y1}`
    : '';
  const { rows: candidatas } = await db.query(
    `SELECT cell_x, cell_y FROM cells ${filtro} ORDER BY random() LIMIT $1`,
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
  celdas: { x: number; y: number }[],
  cuando: Date,
): Promise<Objeto[]> {
  if (celdas.length === 0) return [];
  const { rows } = await client.query(
    `UPDATE objetos o
        SET tomado_por = $1, tomado_at = $4
      WHERE o.tomado_por IS NULL
        AND o.desde <= $4 AND (o.hasta IS NULL OR o.hasta > $4)
        AND (o.cell_x, o.cell_y) IN (SELECT x, y FROM unnest($2::int[], $3::int[]) AS t(x, y))
      RETURNING o.id, o.cell_x, o.cell_y, o.puntos, o.tipo, o.hasta`,
    [userId, celdas.map(c => c.x), celdas.map(c => c.y), cuando.toISOString()],
  );
  return rows.map((r: any) => ({
    id: r.id, x: r.cell_x, y: r.cell_y, puntos: r.puntos, tipo: r.tipo,
    hasta: r.hasta ? new Date(r.hasta).toISOString() : null,
  }));
}
