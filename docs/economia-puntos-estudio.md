# CORRR — Estudio de la ponderación de puntos (economía v1.7)

Análisis exhaustivo del sistema de puntos, multiplicadores, bonos y logros.
Cómo funciona hoy, dónde tiene inconsistencias, y propuesta de rebalanceo.

> Momento ideal para tocar esto: estás en beta con ~12 testers y muy pocos
> usuarios reales. Cualquier rebalanceo de economía **debe hacerse ANTES del
> lanzamiento a producción**, cuando casi nadie tiene puntuación acumulada.

---

## 1. Cómo funciona HOY (mapa completo)

### 1.1 Puntos por carrera (autoritativo, backend `POST /runs`)

```
km_points_base = round(distance_km * 10)                 # 10 pts/km
pb_mult        = (distance_km > best_daily_km) ? 1.2 : 1  # récord
km_points      = round(km_points_base * pb_mult)

cell_points    = new_cells * 1 + stolen_cells * 2         # 1 nueva / 2 robada
loop_bonus     = (confiado del cliente)                   # ver 1.2

subtotal       = km_points + cell_points + loop_bonus
streak_mult    = (streak_days >= 3) ? 1.5 : 1
TOTAL_RUN      = round(subtotal * streak_mult)
```

### 1.2 Bono de cierre de loop (cliente, `closeLoop` en MapScreen)

```
loop_base   = (distance >= 3 km) ? 50 : 25
loop_points = loop_base + (stealCount * 25)
```
`stealCount` aquí cuenta **zonas-polígono rivales** robadas al cerrar (sistema
LEGACY v1.5). Se envía al backend como `loopBonus` y se confía sin recálculo.

### 1.3 Penalizaciones (a la víctima de un robo)

- Celda robada: **−1 pt** por celda al dueño anterior + `total_cells −1`.
- Zona-polígono robada (legacy): **−rival.points** a la víctima.
- La pérdida real es el territorio, no los puntos (el castigo en pts es leve).

### 1.4 Bonos fuera de carrera

- Completar el perfil entero (una vez): **+50 pts + 10 bonus_xp**.

### 1.5 Logros (one-time, suman a `total_points`)

| Categoría | Logros (target → recompensa) |
|---|---|
| Distancia | 10km→100, 50km→300, 100km→600, 500km→1500 |
| Zonas | 5→100, 25→400, 50→800, 100→2000 |
| Carreras | 5→100, 20→400, 50→1000 |
| Robos | 1→150, 10→500, 25→1200 |
| Racha | 3d→200, 7d→500, 14d→1000 |

### 1.6 XP / Nivel

```
XP = floor(total_points / 100) + bonus_xp
```
No hay curva de nivel: el "nivel" es literalmente puntos÷100, lineal e infinito.

---

## 2. Hallazgos

### 2.1 Inconsistencias / deuda técnica (CRÍTICO)

**H1 — El bono de loop vive en el sistema LEGACY de polígonos.**
`closeLoop` calcula `loop_points` con `polyIntersection`/`stolenPieces`, que es
el sistema de zonas v1.5. En el juego actual (celdas v1.6+) los robos se cuentan
server-side (`stolen_cells`). Resultado: el `+25 por rival` del loop **casi nunca
se dispara** en el mundo de celdas, y el `loop_base` (25/50) se suma ENCIMA de
los cell_points que ya cuentan las celdas interiores del flood-fill → posible
doble contabilidad del cierre de loop.

**H2 — `best_daily_km` mal nombrado y mal semánticado.**
Se llama "mejor km del día" pero se compara contra la distancia de UNA carrera y
se guarda como `max(best_daily_km, distance)`. Es en realidad "mejor distancia de
una sola carrera". Si haces 2 carreras en un día no se suman. El multiplicador PB
es correcto pero el nombre y la idea de "diario" engañan.

**H3 — Bypass de cliente legacy.**
Si `loopBonus === undefined` (clientes v1.6), el backend **confía el estimate del
cliente sin recálculo**. Agujero anti-cheat. Bajo riesgo ahora (fuerzas updates)
pero conviene cerrarlo.

**H4 — Asimetría de robo infla el pool global.**
Ladrón +2 / víctima −1 por celda → cada robo añade +1 neto al total global.
Inflación lenta pero constante. Puede ser intencional (premiar robos), pero no
está documentado como decisión.

### 2.2 Balance / progresión

**B1 — Sin curva de nivel real (el hueco más grande).**
`XP = puntos/100` es lineal e infinito. No hay "subir de nivel" con umbrales
crecientes. Para retención a largo plazo falta una curva (nivel N cuesta más que
N−1) y/o prestigio.

**B2 — Logros front-loaded y de una sola vez.**
Recompensas grandes (hasta 2000) pero al agotarlos no queda nada repetible. La
pantalla **Retos está en "Próximamente"** (placeholder). Ese es el hueco de
retención semanal.

**B3 — Distancia domina para el casual, celdas para el territorial.**
1 km = 10 pts; 50 celdas nuevas = 50 pts (≈5000 m² de territorio). El equilibrio
entre estilo "corredor" y estilo "conquistador" no está afinado, simplemente
emerge. Ninguno está mal, pero no es una decisión tomada.

**B4 — Multiplicadores se apilan sin techo claro.**
`subtotal * streak_mult` aplica ×1.5 a TODO (km + celdas + loop). Con PB (×1.2 en
km) un PB en racha da ×1.8 sobre km. Fuerte pero acotado; conviene decidir si la
racha debe multiplicar también celdas/loop o solo el esfuerzo (km).

### 2.3 UX / transparencia

**U1 — Estimate cliente ≠ total autoritativo.**
El móvil muestra durante la carrera un estimate (asume todas las celdas nuevas a
1 pt) y luego el backend recalcula (robos a 2 pts, multiplicadores). El número del
resumen puede "saltar" respecto a lo que vio el usuario. El `breakdown` ya viene
del backend pero conviene mostrarlo desglosado.

**U2 — Mecánicas invisibles.**
El jugador no sabe que cerrar un loop da +25/+50, ni que la racha multiplica. Las
mecánicas ocultas no enganchan. Mostrarlas (en el resumen + un "cómo funcionan los
puntos" que ya existe) sube el engagement.

---

## 3. Propuesta de cambios (priorizada)

### Tier A — Coherencia y honestidad del sistema (recomendado para vc46)

1. **Unificar el bono de loop al mundo de celdas.** Mover el cálculo del bono de
   cierre al backend, basado en celdas interiores rellenadas por flood-fill (no en
   polígonos legacy). Evita H1 (doble conteo) y deja UNA fuente de verdad.
2. **Renombrar `best_daily_km` → `best_run_km`** (o implementar "diario" de
   verdad). Arreglar H2: el nombre debe decir lo que hace.
3. **Cerrar el bypass legacy (H3):** recomputar siempre server-side; si falta
   `loopBonus`, asumir 0 en vez de confiar el estimate del cliente.
4. **Mostrar el breakdown autoritativo en el resumen** (U1): km / celdas / robos /
   bono loop / ×racha / ×PB. Convierte un número opaco en una recompensa legible.

### Tier B — Progresión y retención (siguiente release, más diseño)

5. **Curva de nivel real (B1).** Definir niveles con umbrales crecientes (p.ej.
   nivel N requiere `50 * N^1.5` XP) y mostrar barra de progreso al siguiente nivel.
6. **Retos semanales repetibles (B2).** Activar la pantalla Retos con 3 retos
   rotativos (p.ej. "corre 10 km esta semana", "roba 5 celdas", "cierra 3 loops")
   con recompensa de puntos. Es el motor de retención que falta.

### Tier C — Decisiones de diseño a tomar (no urgentes)

7. Decidir si la racha multiplica TODO o solo km (B4).
8. Decidir/documentar la inflación por robo (H4): mantener +2/−1, o ir a +2/−2
   (suma cero global), o +1/−1.
9. Soft-caps diarios anti-farmeo (B3) cuando crezca la base.

---

## 4. Recomendación

Para **vc46** (4ª iteración de la beta): implementar **Tier A completo** (1-4).
Son fixes de coherencia y transparencia, bajo riesgo, y mejoran de verdad la
sensación del juego. Además es un cambio "presentable" para el formulario de
producción ("refinamos el motor de puntos y su transparencia tras analizar la
economía").

**Tier B** (nivel + retos) es más ambicioso y mejor como release post-lanzamiento
dedicada, no metido a última hora en la beta.
