# Medir cuánto tarda el mapa (solo lectura)

Cinco scripts que miden contra PRODUCCIÓN sin escribir nada. Se corren desde
`apps/backend` con el `.env` local (lleva `DATABASE_URL` y `JWT_ACCESS_SECRET`):

```bash
node --env-file=.env scripts/medir-mapa/mide-mapa.mjs
```

- `mide-mapa.mjs`: las peticiones que hace la app al abrir el mapa (`/cells/viewport`,
  `/objetos/viewport`, `/zones/nearby`, `/app/retos`), tres veces cada una, en tres encuadres.
- `mide-mapa-2.mjs`: territorio SIN caché en seis encuadres (espera 32 s a que caduque la caché).
- `mide-frio.mjs`: territorio tras 50 s sin peticiones (pool de conexiones frío). Tarda 3 minutos.
- `mide-sql.mjs`: EXPLAIN ANALYZE de `SQL_TIRAS` y de la consulta de objetos, tamaños e índices.
- `mide-union.mjs`: lo que tarda el móvil en unir tiras en polígonos (`unionStripsToPolygons`),
  con las tiras reales; en un móvil es 3-6 veces más lento que en el Mac.

Firman un token de Ibanto con el secreto del `.env` para llamar a la API como la app.

Medido el 6-nov-2026 (1.000.935 celdas): territorio sin caché 300-550 ms en Barcelona
(Postgres 150-240 ms leyendo 122.000-138.000 celdas por encuadre), con caché 40-60 ms,
tras 50 s en silencio 400-650 ms; objetos 0,6 ms; unir en el Mac 50-110 ms.
