/**
 * Busca hooks (useState, useEffect…) colocados DETRÁS de un `return`.
 *
 * PARA QUÉ: React cuenta los hooks que ejecuta en cada pintada y exige que
 * siempre sean los mismos. Un hook escrito debajo de un `return` se ejecuta
 * unos ratos sí y otros no —cuando ese return no salta— y en cuanto el número
 * baila, React tira la app abajo. No avisa al compilar: la app se monta bien,
 * se instala bien, y se cierra sola al abrirla.
 *
 * Pasó de verdad: en la 1.11.11 (21) / vc75 un useEffect quedó debajo de la
 * pantalla de carga de App.tsx. Recién instalada iba —nunca pasaba de la
 * pantalla de bienvenida—, pero a quien ya tenía la sesión guardada se le
 * cerraba nada más abrir. En iPhone y en Android.
 *
 *   node scripts/hooks-check.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Todos los .tsx de la app. */
function ficheros(dir, salida = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) ficheros(p, salida);
    else if (p.endsWith('.tsx')) salida.push(p);
  }
  return salida;
}

/** Quita comentarios y textos, que dentro llevan llaves y despistan la cuenta. */
function limpia(src) {
  let fuera = '';
  let i = 0;
  while (i < src.length) {
    const dos = src.slice(i, i + 2);
    if (dos === '//') { const f = src.indexOf('\n', i); const t = f < 0 ? src.length : f; fuera += ' '.repeat(t - i); i = t; continue; }
    if (dos === '/*') { const f = src.indexOf('*/', i); const t = f < 0 ? src.length : f + 2; fuera += src.slice(i, t).replace(/[^\n]/g, ' '); i = t; continue; }
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      fuera += src.slice(i, j + 1).replace(/[^\n]/g, ' ');
      i = j + 1; continue;
    }
    fuera += c; i++;
  }
  return fuera;
}

const linea = (src, pos) => src.slice(0, pos).split('\n').length;

/** ¿Esta llave abre un `if`/`else`/`for`/`while`/`try`, o el cuerpo de una
 *  función? Lo segundo no cuenta: sus `return` son de esa función, no del
 *  componente. */
function esControl(src, pos) {
  const antes = src.slice(Math.max(0, pos - 400), pos).trimEnd();
  if (/(?:^|[^\w$])(?:else|try|do|finally)$/.test(antes)) return true;
  if (!antes.endsWith(')')) return false;          // objeto, bloque suelto…
  if (/=>\s*$/.test(src.slice(Math.max(0, pos - 400), pos))) return false;
  // Retrocedemos hasta el `(` que cierra y miramos qué palabra lo abría.
  let p = antes.length - 1, hondo = 0;
  for (; p >= 0; p--) {
    if (antes[p] === ')') hondo++;
    else if (antes[p] === '(') { hondo--; if (hondo === 0) break; }
  }
  return /(?:^|[^\w$])(?:if|for|while|switch|catch)\s*$/.test(antes.slice(0, p));
}

/** Un hook por debajo de un return, dentro del mismo componente. */
function revisa(ruta) {
  const crudo = readFileSync(ruta, 'utf8');
  const src = limpia(crudo);
  const fallos = [];

  // Dónde empieza cada componente o hook propio: `function Algo(`, y también
  // `const Algo = (…) => {` y `const useAlgo = …`.
  const cabeceras = [...src.matchAll(/(?:function\s+([A-Z]\w*|use[A-Z]\w*)\s*\(|(?:const|let)\s+([A-Z]\w*|use[A-Z]\w*)\s*(?::[^=]+)?=\s*(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>)/g)];

  for (const cab of cabeceras) {
    const nombre = cab[1] || cab[2];
    // La llave que abre el cuerpo.
    let i = cab.index + cab[0].length;
    while (i < src.length && src[i] !== '{' && src[i] !== ';') i++;
    if (src[i] !== '{') continue;

    const fondo = 0;           // profundidad dentro del cuerpo
    let prof = 0;
    let retorno = -1;          // dónde vimos el primer `return` que sale del componente
    // Para cada llave abierta, si es un `if`/`for`/… del cuerpo o si es el
    // cuerpo de otra función. Dentro de otra función, un `return` es suyo y no
    // del componente: el `return () => …` con el que un useEffect se recoge es
    // el caso de todos los días.
    const pila = [];
    i++;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') { pila.push(esControl(src, i)); prof++; continue; }
      if (c === '}') { if (prof === fondo) break; pila.pop(); prof--; continue; }
      // Solo miramos el cuerpo del componente y los `if` de primer nivel.
      if (prof > fondo + 1 || (prof === fondo + 1 && !pila[pila.length - 1])) continue;

      if (src.startsWith('return', i) && !/\w/.test(src[i - 1] ?? ' ') && !/\w/.test(src[i + 6] ?? ' ')) {
        if (retorno < 0) retorno = i;
        i += 5; continue;
      }
      if (prof !== fondo) continue;
      const m = /^use[A-Z]\w*\s*\(/.exec(src.slice(i, i + 40));
      if (m && !/[\w.]/.test(src[i - 1] ?? ' ')) {
        if (retorno >= 0) {
          fallos.push({ nombre, hook: m[0].replace(/\s*\($/, ''), hookLinea: linea(crudo, i), retornoLinea: linea(crudo, retorno) });
        }
        i += m[0].length - 1;
      }
    }
  }
  return fallos;
}

const raiz = new URL('..', import.meta.url).pathname;
let total = 0;
for (const f of ficheros(raiz).sort()) {
  for (const x of revisa(f)) {
    total++;
    const corto = f.slice(raiz.length);
    console.error(`✗ ${corto}:${x.hookLinea} — ${x.hook} dentro de ${x.nombre}() está detrás del return de la línea ${x.retornoLinea}.`);
  }
}
if (total) {
  console.error(`\n${total} hook(s) detrás de un return. Súbelos con los demás, antes del primer return,`);
  console.error('o la app se cerrará sola al abrirla en cuanto ese return deje de saltar.');
  process.exit(1);
}
console.log('Hooks: ninguno detrás de un return.');
