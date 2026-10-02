/**
 * Baja las calles por donde se puede correr y las guarda como celdas.
 *
 *   npm run calles           (baja y guarda en calles.json)
 *   npm run calles -- --subir (además las mete en la base de datos)
 *
 * PARA QUÉ: las calabazas se sembraban solo sobre calles que alguien ya había
 * pisado — 18,9 km² de los 506.000 que tiene España. Con esto se pueden
 * sembrar por CUALQUIER calle, la haya pisado alguien o no, y siguen siendo
 * cogibles: están sobre asfalto, no en mitad de un campo.
 *
 * DE DÓNDE SALEN: de OpenStreetMap, que es libre y gratis, a través de su API
 * pública (Overpass). No se baja España entera: solo las zonas donde hay gente
 * corriendo, con 3 km de margen. Son unos 1.000 km², no 506.000.
 *
 * QUÉ SE CONSIDERA "calle por donde se corre": lo peatonal y lo urbano. Se
 * dejan fuera autopistas y autovías (no se puede correr y es peligroso) y las
 * pistas de tierra y caminos de servicio (llenan el mapa de ruido).
 *
 * ESTO NO TOCA EL MAPA. Escribe en una tabla propia (`calles`) que solo lee la
 * siembra de calabazas. El territorio sigue saliendo de `cells`.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CELL_LAT_DEG = 10 / 111000;
const CELL_LNG_DEG = 10 / (111000 * Math.cos((40 * Math.PI) / 180));

/** Un punto cada 40 m: más junto no aporta (la celda mide 10 m y la separación
 *  entre calabazas es de 300 m), y más suelto deja huecos en las curvas. */
const PASO_M = 40;

/** Trozos de 3×3 km. Medido contra el servidor: 3x3 va (unos 3 MB y 16 s) y
 *  5x5 lo agota. Los 504 que salen de vez en cuando son por carga del momento,
 *  no por el tamaño — por eso los reintentos son tan pacientes. */
const TROZO_KM = 3;

const TIPOS = [
  'residential', 'living_street', 'pedestrian', 'footway', 'path',
  'unclassified', 'tertiary', 'secondary', 'primary', 'cycleway', 'steps',
].join('|');

// Cortesía con un servidor público y gratuito — y conveniencia propia: con
// 2 s empezaba a contestar 429 ("vas muy rápido"), y entonces toca esperar
// mucho más. Pidiendo más despacio se termina antes.
const ESPERA_MS = 7000;

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

function trozos({ sur, norte, oeste, este }) {
  const altoKm = (norte - sur) / CELL_LAT_DEG / 100;
  const anchoKm = (este - oeste) / CELL_LNG_DEG / 100;
  const filas = Math.max(1, Math.ceil(altoKm / TROZO_KM));
  const cols = Math.max(1, Math.ceil(anchoKm / TROZO_KM));
  const out = [];
  for (let f = 0; f < filas; f++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        sur: sur + ((norte - sur) * f) / filas,
        norte: sur + ((norte - sur) * (f + 1)) / filas,
        oeste: oeste + ((este - oeste) * c) / cols,
        este: oeste + ((este - oeste) * (c + 1)) / cols,
      });
    }
  }
  return out;
}

async function pideOverpass(caja, intento = 1) {
  const consulta = `[out:json][timeout:120];
way["highway"~"^(${TIPOS})$"](${caja.sur},${caja.oeste},${caja.norte},${caja.este});
out geom;`;
  try {
    // Formulario, no texto plano: con `Content-Type: text/plain` Overpass
    // contesta 406 y no explica por qué. Y con User-Agent propio, que es lo
    // educado con un servicio público y gratuito.
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'CORRR/1.0 (hola@corrr.es)',
      },
      body: new URLSearchParams({ data: consulta }).toString(),
      signal: AbortSignal.timeout(180000),
    });
    if (r.status === 429 || r.status === 504) throw new Error('ocupado (' + r.status + ')');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    // Overpass es gratis y a ratos va saturado: contesta 504 en segundos y a
    // los dos minutos va perfecto. Merece la pena esperar antes que rendirse.
    if (intento >= 6) throw e;
    const espera = [15000, 30000, 60000, 90000, 120000][intento - 1] ?? 120000;
    console.log(`     reintento ${intento} en ${espera / 1000}s (${e.message})`);
    await dormir(espera);
    return pideOverpass(caja, intento + 1);
  }
}

/** Puntos cada PASO_M metros a lo largo de una calle, convertidos a celdas. */
function celdasDeLaCalle(geometria, dentro) {
  for (let i = 1; i < geometria.length; i++) {
    const a = geometria[i - 1], b = geometria[i];
    const dy = (b.lat - a.lat) / CELL_LAT_DEG * 10;   // metros
    const dx = (b.lon - a.lon) / CELL_LNG_DEG * 10;
    const largo = Math.hypot(dx, dy);
    const pasos = Math.max(1, Math.ceil(largo / PASO_M));
    for (let p = 0; p <= pasos; p++) {
      const t = p / pasos;
      const lat = a.lat + (b.lat - a.lat) * t;
      const lon = a.lon + (b.lon - a.lon) * t;
      dentro.add(`${Math.floor(lon / CELL_LNG_DEG)},${Math.floor(lat / CELL_LAT_DEG)}`);
    }
  }
}

const DATOS = new URL('../datos/', import.meta.url);
const PROGRESO = new URL('calles-progreso.json', DATOS);
const ZONAS = new URL('zonas.json', DATOS);
const SALIDA = new URL('calles.json', DATOS);

const zonas = JSON.parse(readFileSync(ZONAS, 'utf8'));
const todos = zonas.flatMap(z => trozos(z));

// Se retoma donde se quedó. Overpass es gratis y a ratos está saturado: esto
// puede tardar horas, y perder lo bajado por un corte sería absurdo.
let hechos = new Set();
let celdas = new Set();
if (existsSync(PROGRESO)) {
  const g = JSON.parse(readFileSync(PROGRESO, 'utf8'));
  hechos = new Set(g.hechos);
  celdas = new Set(g.celdas);
  console.log(`Retomando: ${hechos.size}/${todos.length} trozos y ${celdas.size.toLocaleString('es-ES')} celdas ya bajadas\n`);
} else {
  console.log(`${zonas.length} zonas → ${todos.length} trozos de ${TROZO_KM}x${TROZO_KM} km como mucho\n`);
}

function guarda() {
  writeFileSync(PROGRESO, JSON.stringify({ hechos: [...hechos], celdas: [...celdas] }));
}

let fallados = 0;
for (const [i, caja] of todos.entries()) {
  const clave = `${caja.sur.toFixed(4)},${caja.oeste.toFixed(4)}`;
  if (hechos.has(clave)) continue;
  const antes = celdas.size;
  let datos;
  try {
    datos = await pideOverpass(caja);
  } catch (e) {
    // Ni se rinde ni se cae: lo deja pendiente y sigue. Al volver a lanzarlo
    // solo reintenta los que faltan.
    fallados++;
    console.log(`  ${String(i + 1).padStart(3)}/${todos.length}  PENDIENTE (${e.message})`);
    await dormir(ESPERA_MS);
    continue;
  }
  for (const el of datos.elements ?? []) {
    if (el.type === 'way' && Array.isArray(el.geometry)) celdasDeLaCalle(el.geometry, celdas);
  }
  hechos.add(clave);
  guarda();
  console.log(`  ${String(i + 1).padStart(3)}/${todos.length}  +${(celdas.size - antes).toLocaleString('es-ES').padStart(7)} celdas  (total ${celdas.size.toLocaleString('es-ES')})`);
  if (i < todos.length - 1) await dormir(ESPERA_MS);
}

const lista = [...celdas].map(k => k.split(',').map(Number));
writeFileSync(SALIDA, JSON.stringify(lista));
console.log(`\n${hechos.size}/${todos.length} trozos hechos${fallados ? `, ${fallados} pendientes (vuelve a lanzarlo)` : ''}`);
console.log(`${lista.length.toLocaleString('es-ES')} celdas de calle = ${(lista.length / 10000).toFixed(1)} km²`);
console.log('Guardadas en apps/backend/datos/calles.json');
