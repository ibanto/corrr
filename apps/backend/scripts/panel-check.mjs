/**
 * Comprueba que el JavaScript del panel de administración es válido.
 *
 *   npm run test:panel
 *
 * Por qué existe: el panel se escribe dentro de una plantilla de TypeScript y
 * el navegador lo recibe por `document.write`, así que TODO su código pasa por
 * dos procesados. Una barra mal escapada (`\n` en vez de `\\n`) deja un salto
 * de línea dentro de una cadena y el navegador tira el script ENTERO sin
 * decir nada: los botones dejan de hacer nada y el panel parece "roto porque
 * sí". Pasó el 23-sep-2026 y se tardó en ver, porque el HTML se pinta igual.
 *
 * Esto genera el panel con datos inventados y le pasa el analizador de node.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const fuente = readFileSync(join(raiz, 'src/routes/index.ts'), 'utf8');

/** La pantalla que pide la clave (`/admin`). Va aparte del panel y también
 *  lleva código: si se rompe, no se puede ni entrar. */
const desdeGate = fuente.indexOf("app.get('/admin', async (_req, reply) => {");
if (desdeGate === -1) throw new Error('No encuentro la pantalla de la clave en src/routes/index.ts');
const iniGate = fuente.indexOf('`<!doctype html>', desdeGate) + 1;
const finGate = fuente.indexOf('`);', iniGate);
// Se EVALÚA como plantilla, igual que hace el servidor: leerla como texto
// plano dejaría las barras sin procesar y el fallo pasaría desapercibido
// (que es justo lo que ocurrió la primera vez).
const gate = new Function('return `' + fuente.slice(iniGate, finGate) + '`;')();

/** La plantilla del HTML del panel, tal cual está en el código. */
const desde = fuente.indexOf('  const html = `<!doctype html>');
if (desde === -1) throw new Error('No encuentro la plantilla del panel en src/routes/index.ts');
const ini = fuente.indexOf('`', desde) + 1;
// El final de la plantilla: el primer cierre de acento grave seguido de ';'
// que va justo antes del `return reply`. Si esto deja de encontrarse, la
// comprobación avisa en vez de analizar código que no es el del panel.
const fin = fuente.indexOf('`;\n\n  return reply', ini);
if (fin === -1) throw new Error('No encuentro el final de la plantilla del panel');
// Las anotaciones de tipo no llegan al navegador; se quitan para poder evaluar.
const plantilla = fuente.slice(ini, fin).replace(/: any\b/g, '');

const esc = (x) => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const datos = {
  esc,
  fmtDate: (d) => (d ? new Date(d).toLocaleString('es-ES') : '—'),
  fmtDur: (s) => `${Math.floor(s / 60)}'${String(Math.round(s % 60)).padStart(2, '0')}"`,
  kpi: (label, value, sub = '') => `<div class="kpi">${value} ${label} ${sub}</div>`,
  t: { users: 1, verified: 1, users_24h: 0, users_7d: 0, runs: 0, runs_24h: 0, km: 0, cells: 0 },
  signups: { rows: [{ d: '2026-09-22', n: 1 }] },
  maxSignups: 1,
  lastUsers: { rows: [{ display_name: 'X', email: 'a@b.c', city: 'Y', email_verified: true, created_at: new Date(), total_runs: 1, total_km: 1, total_cells: 1 }] },
  lastRuns: { rows: [{ display_name: 'X', distance_km: 1, duration_secs: 60, points: 1, created_at: new Date() }] },
};

const html = new Function(...Object.keys(datos), 'return `' + plantilla + '`;')(...Object.values(datos));

const sacarScripts = (pagina) => [...pagina.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const scripts = [...sacarScripts(gate), ...sacarScripts(html)];
if (scripts.length === 0) {
  console.error('✘ El panel no tiene ningún <script>: ¿se ha perdido el código de los botones?');
  process.exit(1);
}

let fallos = 0;
scripts.forEach((codigo, i) => {
  try {
    new vm.Script(codigo, { filename: `panel-script-${i + 1}.js` });
    console.log(`✔ El código ${i + 1} del panel es válido (${codigo.length} caracteres)`);
  } catch (e) {
    fallos++;
    console.error(`✘ El código ${i + 1} del panel NO se puede leer: ${e.message}`);
    const linea = Number(String(e.stack).match(/panel-script-\d+\.js:(\d+)/)?.[1] ?? 0);
    if (linea) console.error(`   línea ${linea}: ${codigo.split('\n')[linea - 1]?.trim()}`);
  }
});

// Los botones tienen que seguir enganchados a algo: si alguien quita un id, el
// código sigue siendo válido pero el panel deja de responder.
const necesarios = ['fa', 'lista_avisos', 'bstrava', 'strava_msg', 'fb', 'b_quien'];
for (const id of necesarios) {
  if (!html.includes(`id="${id}"`)) { console.error(`✘ Falta en el panel el elemento "${id}"`); fallos++; }
  if (!scripts.some(s => s.includes(`'${id}'`))) { console.error(`✘ Nadie usa "${id}" en el código del panel`); fallos++; }
}

console.log(fallos ? `\n${fallos} problema(s) en el panel.` : '\nPanel en orden.');
process.exit(fallos ? 1 : 0);
