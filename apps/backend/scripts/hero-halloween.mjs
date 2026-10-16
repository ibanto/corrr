/** Cabecera del correo de Halloween, al estilo de las dos que ya existen:
 *  negro, rejilla de calles tenue, el logo de verdad arriba, raya naranja y
 *  titular condensado. Solo escribe un fichero local. */
import { createRequire } from 'node:module';
const sharp = createRequire('/Users/iban/corrr/apps/backend/')('sharp');

const W = 1200, H = 688, NARANJA = '#FF5500';
const R = '/Users/iban/corrr';

// Rejilla de calles: líneas largas en ángulos raros, muy apagadas. Semilla
// fija para que salga igual cada vez que se regenere.
let semilla = 20261023;
const azar = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;
let lineas = '';
for (let i = 0; i < 26; i++) {
  const x1 = azar() * W * 1.4 - 200, y1 = azar() * H;
  const ang = (azar() * 160 - 80) * Math.PI / 180, largo = 500 + azar() * 900;
  lineas += `<line x1="${x1.toFixed(0)}" y1="${y1.toFixed(0)}" x2="${(x1 + Math.cos(ang) * largo).toFixed(0)}" y2="${(y1 + Math.sin(ang) * largo).toFixed(0)}" stroke="#262626" stroke-width="${(1 + azar() * 2).toFixed(1)}"/>`;
}
for (let i = 0; i < 40; i++) {
  lineas += `<circle cx="${(azar() * W).toFixed(0)}" cy="${(azar() * H).toFixed(0)}" r="${(1 + azar() * 2.5).toFixed(1)}" fill="${NARANJA}" opacity="${(0.12 + azar() * 0.35).toFixed(2)}"/>`;
}

const fondo = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#000000"/>${lineas}
  <line x1="88" y1="268" x2="1112" y2="268" stroke="${NARANJA}" stroke-width="3"/></svg>`;

const textos = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <text x="88" y="400" font-family="Oswald" font-weight="700" font-size="104" fill="#FFFFFF" letter-spacing="1">LLEGA</text>
  <text x="88" y="516" font-family="Oswald" font-weight="700" font-size="104" fill="${NARANJA}" letter-spacing="1">HALLOWEEN</text>
  <text x="92" y="590" font-family="Oswald" font-weight="500" font-size="34" fill="#FFFFFF" letter-spacing="4" opacity="0.85">23 OCT — 1 NOV</text>
</svg>`;

// El logo sale del PNG de la marca, no se vuelve a componer: así es
// exactamente el mismo que en los otros dos correos.
const logo = await sharp(`${R}/docs/logo.png`)
  .extract({ left: 48, top: 330, width: 976, height: 400 })
  .resize({ width: 470 }).png().toBuffer();

// Pixel art: se agranda SIN suavizar (`nearest`), que si no se convierte en
// una mancha borrosa y pierde justo lo que la hace bonita.
const calabaza = await sharp(`${R}/apps/mobile/assets/calabaza.png`)
  .resize({ width: 420, kernel: 'nearest' }).png().toBuffer();
const fantasma = await sharp(`${R}/apps/mobile/assets/fantasma.png`)
  .resize({ width: 210, kernel: 'nearest' }).png().toBuffer();

await sharp(Buffer.from(fondo))
  .composite([
    { input: fantasma, left: 700, top: 120 },
    { input: calabaza, left: 740, top: 250 },
    { input: logo, left: 88, top: 60 },
    { input: Buffer.from(textos), left: 0, top: 0 },
  ])
  .jpeg({ quality: 86, progressive: true })
  .toFile(`${R}/docs/email/halloween.jpg`);

const m = await sharp(`${R}/docs/email/halloween.jpg`).metadata();
console.log(`docs/email/halloween.jpg ${m.width}x${m.height}`);
