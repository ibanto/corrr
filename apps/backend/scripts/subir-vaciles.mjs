/**
 * Sube una carpeta de carteles como una pestaña de vaciles DE IMÁGENES, desde
 * el Mac, sin pasar por el panel (§9-sexies del CLAUDE.md).
 *
 *   node scripts/subir-vaciles.mjs --carpeta ../mobile/assets/taunts/vaciles --nombre "Tótems"
 *   node scripts/subir-vaciles.mjs --carpeta ../mobile/assets/taunts/AURA --nombre Aura --modo prueba --probadores Ibanto
 *
 * Opciones:
 *   --carpeta <ruta>      la carpeta con los PNG (592×1280). Obligatoria.
 *   --nombre <texto>      el nombre de la pestaña (18 letras como mucho). Obligatorio.
 *   --modo apagado|prueba|todos   (prueba, si no se dice)
 *   --probadores "A, B"   quién la ve en prueba (vacío = Ibanto)
 *   --orden N             dónde sale en el selector (0, si no se dice)
 *   --url <servidor>      https://corrr-api-production.up.railway.app, si no se dice
 *   --solo-mirar          enseña las parejas que subiría y no toca nada
 *
 * Los archivos se emparejan por el número del nombre: `01_PROVOCACION_lobo.png`
 * con `01_RESPUESTA_lobo.png` (también vale `01_01_PROVOCACION_…` y
 * `01_02_RESPUESTA_…`). Si ya hay una pestaña con ese nombre, se usa esa (y
 * una pareja con el mismo nombre sustituye a la que había). La clave del
 * panel se lee de ADMIN_KEY en el .env y NUNCA se imprime.
 */
import 'dotenv/config';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(nombre);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : porDefecto;
};
const carpeta = opcion('--carpeta', null);
const nombre = opcion('--nombre', null);
const modo = opcion('--modo', 'prueba');
const probadores = opcion('--probadores', '');
const orden = Number(opcion('--orden', '0')) || 0;
const url = opcion('--url', 'https://corrr-api-production.up.railway.app').replace(/\/$/, '');
const soloMirar = args.includes('--solo-mirar');

if (!carpeta || !nombre) {
  console.error('Faltan --carpeta y --nombre. Lee la cabecera de este archivo.');
  process.exit(1);
}
if (!['apagado', 'prueba', 'todos'].includes(modo)) {
  console.error('--modo tiene que ser apagado, prueba o todos');
  process.exit(1);
}
const clave = process.env.ADMIN_KEY;
if (!clave && !soloMirar) {
  console.error('No hay ADMIN_KEY en el .env de apps/backend');
  process.exit(1);
}

/** La misma regla que parteDeCartel en src/services/vaciles.ts y en el panel. */
function parteDeCartel(archivo) {
  const m = /^(\d+)(?:[_-]0?[12])?[_-](PROVOCACION|RESPUESTA)[_-](.+)\.png$/i.exec(archivo.trim());
  if (!m) return null;
  return { numero: Number(m[1]), cual: m[2].toUpperCase() === 'PROVOCACION' ? 'provocacion' : 'respuesta',
    nombre: m[3].replace(/[_-]+/g, ' ').trim() };
}

const dir = resolve(carpeta);
const porNumero = new Map();
const sueltos = [];
for (const f of readdirSync(dir)) {
  if (!statSync(join(dir, f)).isFile()) continue;
  const p = parteDeCartel(f);
  if (!p) { if (/\.png$/i.test(f)) sueltos.push(f); continue; }
  const pareja = porNumero.get(p.numero) ?? { numero: p.numero };
  pareja[p.cual] = join(dir, f);
  if (p.cual === 'provocacion' || !pareja.nombre) pareja.nombre = p.nombre;
  porNumero.set(p.numero, pareja);
}
const todas = [...porNumero.values()].sort((a, b) => a.numero - b.numero);
const parejas = todas.filter(p => p.provocacion && p.respuesta);
const incompletas = todas.filter(p => !p.provocacion || !p.respuesta);

console.log(`Carpeta: ${dir}`);
for (const p of parejas) console.log(`  ${String(p.numero).padStart(2, '0')}  ${p.nombre}  ←  ${basename(p.provocacion)} + ${basename(p.respuesta)}`);
for (const p of incompletas) console.log(`  ✘ ${String(p.numero).padStart(2, '0')}  ${p.nombre}: falta la ${p.provocacion ? 'respuesta' : 'provocación'}`);
for (const f of sueltos) console.log(`  ✘ no entiendo el nombre: ${f}`);
if (parejas.length === 0) { console.error('No hay ninguna pareja completa que subir.'); process.exit(1); }
if (soloMirar) { console.log('\n--solo-mirar: no se sube nada.'); process.exit(0); }

async function api(ruta, cuerpo, metodo = 'POST') {
  const r = await fetch(url + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'x-admin-key': clave },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `El servidor ha contestado ${r.status}`);
  return d;
}
const dataUrl = (ruta) => 'data:image/png;base64,' + readFileSync(ruta).toString('base64');

// ¿Ya existe una pestaña con ese nombre? Se usa esa.
const { pestanas } = await api('/admin/vaciles', undefined, 'GET');
const yaEstaba = (pestanas ?? []).find(p => p.nombre.toLowerCase() === nombre.trim().toLowerCase());
if (yaEstaba && yaEstaba.tipo !== 'imagen') {
  console.error(`Ya hay una pestaña «${yaEstaba.nombre}» y es de textos: ponle otro nombre a esta.`);
  process.exit(1);
}
const guardada = await api('/admin/vaciles', {
  id: yaEstaba?.id ?? null, nombre, orden, modo, corredores: probadores, tipo: 'imagen', mensajes: '', respuestas: '',
});
const pestana = guardada.pestana;
console.log(`\nPestaña «${pestana.nombre}» (${yaEstaba ? 'ya estaba, id ' + pestana.id : 'nueva, id ' + pestana.id}), ${pestana.modo === 'si' ? 'ENCENDIDA' : pestana.modo === 'no' ? 'apagada' : pestana.modo.replace('prueba:', 'en prueba para ')}.`);

for (const p of parejas) {
  process.stdout.write(`  subiendo ${p.nombre}… `);
  const r = await api('/admin/vaciles/imagen', {
    pestanaId: pestana.id, orden: p.numero, nombre: p.nombre,
    provocacion: dataUrl(p.provocacion), respuesta: dataUrl(p.respuesta),
  });
  console.log(`ok (ids ${r.mensajeId} y ${r.respuestaId})`);
}
const { pestanas: despues } = await api('/admin/vaciles', undefined, 'GET');
const final = (despues ?? []).find(p => p.id === pestana.id);
console.log(`\nHecho: «${final?.nombre}» tiene ${final?.mensajes.length ?? 0} parejas con cartel.`);
