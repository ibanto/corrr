/**
 * La parte que escribe en la base de datos al importar una carrera a mano.
 *
 * Va aparte para que el script de arriba sea solo "leer el GPX y contar", y
 * esto sea "y ahora apúntalo", que es lo único que toca datos de verdad.
 *
 * Hace lo mismo que una carrera normal, en una transacción:
 *   · crea la carrera
 *   · reclama las celdas, quitándoselas a quien las tuviera
 *   · le resta a cada víctima su celda y su punto, y le manda el aviso
 *   · suma los puntos con el mismo tope que las carreras de verdad
 */

/** Robar al que va por delante vale el doble; al que va por detrás, la mitad.
 *  La misma regla que en el servidor (`factorRobo`). */
function factorRobo(mios, suyos) {
  if (suyos > mios * 1.2) return 2;
  if (suyos < mios * 0.8) return 0.5;
  return 1;
}

export async function ocuparCeldas(db, { corredor, celdas, km, cuando, deVerdad, MAX_PUNTOS_CARRERA }) {
  const xs = celdas.map(c => c.x), ys = celdas.map(c => c.y);

  // Quién tiene ahora cada celda del recorrido.
  const { rows: antes } = await db.query(
    `SELECT c.owner_id, u.display_name, COUNT(*)::int AS n
       FROM cells c JOIN users u ON u.id = c.owner_id
       JOIN unnest($1::int[], $2::int[]) AS t(x, y) ON c.cell_x = t.x AND c.cell_y = t.y
      WHERE c.owner_id <> $3
      GROUP BY c.owner_id, u.display_name ORDER BY COUNT(*) DESC`,
    [xs, ys, corredor.id]);
  const { rows: [yaMias] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM cells c
       JOIN unnest($1::int[], $2::int[]) AS t(x, y) ON c.cell_x = t.x AND c.cell_y = t.y
      WHERE c.owner_id = $3`, [xs, ys, corredor.id]);

  const robadas = antes.reduce((a, r) => a + r.n, 0);
  const nuevas = celdas.length - robadas - yaMias.n;

  const { rows: [st] } = await db.query(
    `SELECT total_points, streak_days, best_daily_km FROM user_stats WHERE user_id = $1`, [corredor.id]);
  const misPuntos = Number(st?.total_points) || 0;

  // Puntos, con las mismas reglas que una carrera normal.
  const { rows: pts } = await db.query(
    `SELECT user_id, total_points FROM user_stats WHERE user_id = ANY($1::uuid[])`,
    [antes.map(r => r.owner_id)]);
  const suyos = new Map(pts.map(r => [r.user_id, Number(r.total_points) || 0]));
  let puntosRobo = 0;
  for (const r of antes) puntosRobo += r.n * 2 * factorRobo(misPuntos, suyos.get(r.owner_id) ?? 0);

  const kmPoints = Math.round(km * 10);
  const brutos = kmPoints + nuevas + Math.round(puntosRobo);
  const puntos = Math.min(brutos, MAX_PUNTOS_CARRERA);

  console.log('  celdas nuevas:', nuevas.toLocaleString('es-ES'));
  console.log('  ya eran suyas:', yaMias.n.toLocaleString('es-ES'));
  console.log('  se las quita a:');
  for (const r of antes) {
    console.log(`     ${r.display_name.padEnd(14)} ${String(r.n).padStart(6)} celdas · ×${factorRobo(misPuntos, suyos.get(r.owner_id) ?? 0)}`);
  }
  if (!antes.length) console.log('     (a nadie)');
  console.log(`\n  puntos: ${kmPoints} por km + ${nuevas} por celda nueva + ${Math.round(puntosRobo)} por robo = ${brutos.toLocaleString('es-ES')}`);
  console.log(`  se le dan: ${puntos.toLocaleString('es-ES')}${brutos > MAX_PUNTOS_CARRERA ? ` (tope de ${MAX_PUNTOS_CARRERA.toLocaleString('es-ES')})` : ''}`);

  if (!deVerdad) {
    console.log('\nEnsayo. Para hacerlo de verdad, añade --de-verdad');
    return;
  }

  const cliente = await db.connect();
  try {
    await cliente.query('BEGIN');
    const { rows: [run] } = await cliente.query(
      `INSERT INTO runs (user_id, distance_km, duration_secs, points, created_at, source)
       VALUES ($1, $2, $3, $4, $5, 'importada') RETURNING id`,
      [corredor.id, km, Math.round(km * 1000 / 3), puntos, cuando]);

    await cliente.query(
      `INSERT INTO cells (cell_x, cell_y, owner_id, run_id, claimed_at)
       SELECT x, y, $3::uuid, $4::uuid, $5 FROM unnest($1::int[], $2::int[]) AS t(x, y)
       ON CONFLICT (cell_x, cell_y) DO UPDATE
          SET owner_id = EXCLUDED.owner_id, run_id = EXCLUDED.run_id, claimed_at = EXCLUDED.claimed_at
        WHERE cells.owner_id <> EXCLUDED.owner_id`,
      [xs, ys, corredor.id, run.id, cuando]);

    for (const r of antes) {
      await cliente.query(
        `UPDATE user_stats SET total_cells = GREATEST(0, COALESCE(total_cells,0) - $2),
                               total_points = GREATEST(0, total_points - $2)
          WHERE user_id = $1`, [r.owner_id, r.n]);
      await cliente.query(
        `INSERT INTO avisos (titulo, texto, boton, etiqueta, sello, nota, publico, corredor)
         VALUES ($1,$2,$3,$4,$5,$6,'corredor',$7)`,
        ['Te han robado',
         `${corredor.display_name} ha pasado por tu zona y se ha quedado *${r.n.toLocaleString('es-ES')} celdas* tuyas. Ve a recuperarlas.`,
         'Ver el mapa', 'Territorio', 'Robo', `-${r.n.toLocaleString('es-ES')}\nCELDAS`, r.display_name]);
    }

    await cliente.query(
      `UPDATE user_stats
          SET total_runs = COALESCE(total_runs,0) + 1,
              total_km = COALESCE(total_km,0) + $2,
              total_cells = COALESCE(total_cells,0) + $3,
              total_points = COALESCE(total_points,0) + $4,
              best_daily_km = GREATEST(COALESCE(best_daily_km,0), $2)
        WHERE user_id = $1`,
      [corredor.id, km, nuevas + robadas, puntos]);

    await cliente.query('COMMIT');
    console.log(`\nHecho. Carrera ${run.id} creada.`);
  } catch (e) {
    await cliente.query('ROLLBACK');
    console.error('\nNo se ha tocado nada:', e.message);
    throw e;
  } finally {
    cliente.release();
  }
}
