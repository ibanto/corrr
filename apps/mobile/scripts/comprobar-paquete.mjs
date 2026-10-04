/**
 * Mira DENTRO de un paquete montado y comprueba que va a producción.
 *
 *   node scripts/comprobar-paquete.mjs <ruta del .aab o del .xcarchive>
 *
 * PARA QUÉ: el 4-oct-2026 se le dio a Iban una build de iPhone que apuntaba a
 * `10.0.2.2:8787` —el servidor de mentira de este Mac— y en el teléfono no
 * cargaba NADA: ni ranking, ni stats, ni perfil, ni territorio. Solo las calles,
 * que las sirve Google. El motivo: el archivado se lanzó en segundo plano y,
 * mientras se montaba, se cambió `API_BASE` para probar en el emulador de
 * Android. Xcode no compila lo que hay en git, compila lo que hay en la carpeta
 * EN ESE MOMENTO.
 *
 * Mirar el código fuente no vale para esto: hay que mirar el paquete. Es lo
 * único que demuestra qué se va a instalar de verdad.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PRODUCCION = 'corrr-api-production.up.railway.app';
/** Lo que NUNCA puede viajar en un paquete que se sube a una tienda. */
const PROHIBIDO = ['10.0.2.2', 'localhost:8787', '127.0.0.1:8787', 'usesCleartextTraffic'];

const ruta = process.argv[2];
if (!ruta || !existsSync(ruta)) {
  console.error('Uso: node scripts/comprobar-paquete.mjs <paquete.aab | archivo.xcarchive>');
  process.exit(1);
}

/** El JavaScript que lleva dentro, venga de donde venga. */
function bundleDe(p) {
  if (p.endsWith('.xcarchive')) {
    const b = join(p, 'Products/Applications/CORRR.app/main.jsbundle');
    if (!existsSync(b)) throw new Error('no encuentro el JavaScript dentro del archivo de Xcode');
    return readFileSync(b);
  }
  const dir = mkdtempSync(join(tmpdir(), 'corrr-'));
  execSync(`unzip -qo "${p}" "base/assets/index.android.bundle" -d "${dir}"`);
  return readFileSync(join(dir, 'base/assets/index.android.bundle'));
}

const datos = bundleDe(ruta);
const texto = datos.toString('latin1');
let mal = 0;

if (texto.includes(PRODUCCION)) {
  console.log(`✔ apunta a producción (${PRODUCCION})`);
} else {
  console.log(`✘ NO apunta a producción: no aparece ${PRODUCCION}`);
  mal++;
}
for (const aguja of PROHIBIDO) {
  if (texto.includes(aguja)) { console.log(`✘ lleva dentro "${aguja}", que es de pruebas`); mal++; }
}
if (!mal) console.log('\nEl paquete se puede subir.');
else { console.log(`\n${mal} problema(s). NO subir esto.`); process.exit(1); }
