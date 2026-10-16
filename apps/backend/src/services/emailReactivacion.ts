/**
 * Email "Una vuelta basta": para quien se registró y ha salido poco o nada
 * (100 puntos o menos). Dos versiones que solo cambian el arranque: a quien no
 * tiene ninguna carrera no se le puede decir que su territorio es pequeño, y a
 * quien ya salió no se le puede decir que no tiene zona.
 *
 * Es una comunicación comercial según la LSSI aunque CORRR sea gratis, así
 * que va con lo que exige el art. 21.2 para escribir a los propios usuarios:
 * solo sobre CORRR, se ve claro quién escribe, baja con un clic y un email
 * válido para pedirla. La baja también va en las cabeceras (List-Unsubscribe),
 * que Gmail y Apple Mail muestran como botón.
 *
 * El HTML va con tablas y estilos en línea porque Gmail y Outlook no leen
 * <style> de forma fiable. Gmail tampoco carga fuentes web: ahí sale la
 * condensada del sistema (Arial Narrow, Roboto Condensed).
 */

export const CAMPANA_REACTIVACION = 'una-vuelta-basta';
export const ASUNTO_REACTIVACION = 'Una vuelta basta';

/** Segundo aviso, una semana después, para quien sigue sin estrenarse. El
 *  gancho ya no es "sal a correr" —eso ya se lo dijimos— sino que mientras
 *  tenga 100 puntos o menos su carrera cuenta doble, que es verdad y está
 *  activo en el servidor desde el 23-sep. */
export const CAMPANA_DOBLE = 'cuenta-doble';
export const ASUNTO_DOBLE = 'Tu primera carrera cuenta doble';

/** Halloween 2026: va a TODO EL MUNDO, no solo a quien no ha corrido. Es la
 *  única campaña que no persigue a nadie — anuncia el evento y punto. El tono
 *  lo pidió Iban el 16-oct: "con los emojis y cachondo, animando a entrar y
 *  conquistar".
 *
 *  **Está escrito EN FUTURO a propósito.** La primera versión decía "tu ciudad
 *  se ha llenado de calabazas" y se iba a mandar el 16, siete días antes del
 *  evento: 50 personas abrirían la app y no verían ni una. Iban lo cazó
 *  ("cambiamos por la ciudad se va a llenar de..."). En futuro se puede mandar
 *  cuando se quiera, y además hace el trabajo que más falta hace ahora mismo:
 *  **que la gente ACTUALICE**, porque las calabazas solo las ven las apps
 *  1.11.11 o más nuevas y el 22 por la noche `MIN_APP_VERSION` las va a
 *  exigir. El botón lleva a la tienda, donde sale "Actualizar". */
export const CAMPANA_HALLOWEEN = 'halloween-2026';
export const ASUNTO_HALLOWEEN = '🎃 Tu barrio se va a llenar de calabazas';

/** 'nada': ninguna carrera. 'poco': alguna, pero 100 puntos o menos.
 *  'doble': ninguna carrera, y se le recuerda con el x2 por delante.
 *  'halloween': el evento, para todos. */
export type Variante = 'nada' | 'poco' | 'doble' | 'halloween';

const TEXTOS: Record<Variante, {
  preheader: string; intro: string; circuito: string; misiones: string; boton: string;
  /** El bloque naranja grande y la imagen de cabecera cambian por campaña. */
  bloque: string; hero: string; asunto: string;
  /** Las tres líneas de la lista naranja. Eran fijas hasta el 16-oct, cuando
   *  entró Halloween: ahí no son misiones, son lo que te puedes encontrar. */
  lista: [string, string, string];
  /** El cierre grande antes del botón: naranja, blanco, naranja. */
  cierre: [string, string, string];
}> = {
  nada: {
    preheader: 'Te uniste a CORRR y tu primera zona sigue sin dueño.',
    intro: 'Te uniste a CORRR pero todavía no has reclamado tu primera zona.',
    circuito: 'CORRR solo necesita que salgas y cierres un circuito.',
    misiones: '// PRIMERA ZONA: ELIGE TU MISIÓN',
    boton: 'Reclama tu primera zona',
    bloque: 'Da igual que corras<br>o que camines',
    hero: 'https://ibanto.github.io/corrr/email/una-vuelta-basta.jpg',
    asunto: ASUNTO_REACTIVACION,
    lista: ['Una vuelta a la manzana', 'Un paseo al parque y vuelta', '10 minutos caminando después de comer'],
    cierre: ['Nada de maratones.', 'Solo salir. Cerrar el círculo.', 'Te está esperando.'],
  },
  poco: {
    preheader: 'Ya saliste con CORRR. Tu territorio todavía cabe en una calle.',
    intro: 'Ya has salido con CORRR, pero tu territorio todavía es pequeño.',
    circuito: 'Cierra un circuito y todo lo que queda dentro es tuyo.',
    misiones: '// SIGUIENTE ZONA: ELIGE TU MISIÓN',
    boton: 'Amplía tu territorio',
    bloque: 'Da igual que corras<br>o que camines',
    hero: 'https://ibanto.github.io/corrr/email/una-vuelta-basta.jpg',
    asunto: ASUNTO_REACTIVACION,
    lista: ['Una vuelta a la manzana', 'Un paseo al parque y vuelta', '10 minutos caminando después de comer'],
    cierre: ['Nada de maratones.', 'Solo salir. Cerrar el círculo.', 'Te está esperando.'],
  },
  doble: {
    preheader: 'Mientras tengas menos de 100 puntos, cada carrera te cuenta el doble.',
    intro: 'Sigues sin estrenar tu primera zona, así que te hemos puesto los puntos al doble.',
    circuito: 'Sal, cierra un circuito y todo lo de dentro es tuyo. Y esta vez, puntúa el doble.',
    misiones: '// ESTRÉNATE: ELIGE TU MISIÓN',
    boton: 'Estrenar el doble',
    bloque: 'Tu primera carrera<br>cuenta doble',
    hero: 'https://ibanto.github.io/corrr/email/cuenta-doble.jpg',
    asunto: ASUNTO_DOBLE,
    lista: ['Una vuelta a la manzana', 'Un paseo al parque y vuelta', '10 minutos caminando después de comer'],
    cierre: ['Nada de maratones.', 'Solo salir. Cerrar el círculo.', 'Te está esperando.'],
  },
  halloween: {
    preheader: 'El 23 de octubre empieza. Actualiza la app y que no te pille dormido. 🎃',
    intro: 'el 23 de octubre tu ciudad se va a llenar de calabazas. 🎃 Y de fantasmas, que esos muerden.',
    circuito: 'Las pillas corriendo. Y si cierras un círculo, las que queden dentro también son tuyas.',
    misiones: '// TRUCO O TRATO: LO QUE TE VAS A ENCONTRAR',
    boton: 'Actualizo y me apunto 🎃',
    bloque: '200 puntos<br>cada calabaza',
    hero: 'https://ibanto.github.io/corrr/email/halloween.jpg',
    asunto: ASUNTO_HALLOWEEN,
    lista: [
      'Calabaza 🎃 — 200 puntos y un mensaje nuevo',
      'Fantasma 👻 — o +500, o −1.000, o nada',
      'Cierra un círculo ⭕ — las de dentro, tuyas',
    ],
    cierre: [
      'Del 23 de octubre al 1 de noviembre.',
      'Actualiza la app: sin la versión nueva no las vas a ver.',
      'Tu barrio no se va a defender solo. 🎃',
    ],
  },
};

export const PRIVACIDAD_URL = 'https://ibanto.github.io/corrr/privacy.html';

const NARANJA = '#FF5500';
const CONDENSADA = "'Oswald','Arial Narrow','Roboto Condensed','sans-serif-condensed','Helvetica Neue',Arial,sans-serif";
const MONO = "'IBM Plex Mono','Courier New',Courier,monospace";

export type DatosEmail = {
  nombre: string;
  urlAbrir: string;
  urlBaja: string;
  variante: Variante;
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const linea = `<tr><td style="padding:10px 0 14px;"><div style="height:1px;line-height:1px;font-size:1px;background:${NARANJA};">&nbsp;</div></td></tr>`;

function mision(num: string, texto: string): string {
  return `<tr>
    <td width="44" style="font-family:${CONDENSADA};font-weight:600;font-size:22px;line-height:28px;color:${NARANJA};padding:3px 0;">${num}</td>
    <td bgcolor="${NARANJA}" style="background:${NARANJA};font-family:${CONDENSADA};font-weight:600;font-size:19px;line-height:26px;color:#000000;text-transform:uppercase;padding:4px 12px;">${texto}</td>
  </tr>
  <tr><td colspan="2" style="height:6px;line-height:6px;font-size:6px;">&nbsp;</td></tr>`;
}

export function htmlReactivacion({ nombre, urlAbrir, urlBaja, variante }: DatosEmail): string {
  const n = esc(nombre.toUpperCase());
  const t = TEXTOS[variante];
  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${t.asunto}</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono&family=Oswald:wght@500;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#000000;" bgcolor="#000000">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#000000;">${t.preheader}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

  <tr><td>
    <a href="${urlAbrir}" style="text-decoration:none;">
      <img src="${t.hero}" width="600" alt="CORRR — ${t.asunto}" style="display:block;width:100%;max-width:600px;height:auto;border:0;color:#FFFFFF;font-family:${CONDENSADA};font-size:32px;">
    </a>
  </td></tr>

  <tr><td style="padding:0 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000"
      style="background:#000000;border:2px solid ${NARANJA};border-right-width:6px;border-bottom-width:6px;">
    <tr><td style="padding:22px 22px 26px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

        <tr><td style="font-family:${MONO};font-size:12px;letter-spacing:1px;color:${NARANJA};">// TRANSMISIÓN CORRR</td></tr>
        ${linea}

        <tr><td style="font-family:${CONDENSADA};font-weight:600;font-size:20px;line-height:26px;color:#FFFFFF;text-transform:uppercase;padding-bottom:16px;">
          Hola, ${n},<br>
          ${t.intro}
        </td></tr>

        <tr><td bgcolor="${NARANJA}" style="background:${NARANJA};padding:14px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font-family:${CONDENSADA};font-weight:600;font-size:28px;line-height:32px;color:#000000;text-transform:uppercase;">${t.bloque}</td>
            <td width="36" align="right" style="font-family:${CONDENSADA};font-weight:600;font-size:34px;color:#000000;">//</td>
          </tr></table>
        </td></tr>

        <tr><td style="font-family:${CONDENSADA};font-weight:600;font-size:20px;line-height:26px;color:#FFFFFF;text-transform:uppercase;padding-top:18px;">
          ${t.circuito}
        </td></tr>

        <tr><td style="font-family:${MONO};font-size:11px;letter-spacing:1px;color:${NARANJA};padding-top:6px;">${t.misiones}</td></tr>
        ${linea}

        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${mision('01', t.lista[0])}
            ${mision('02', t.lista[1])}
            ${mision('03', t.lista[2])}
          </table>
        </td></tr>
        ${linea}

        <tr><td style="font-family:${CONDENSADA};text-transform:uppercase;padding-bottom:22px;">
          <div style="font-weight:600;font-size:31px;line-height:37px;color:${NARANJA};">${t.cierre[0]}</div>
          <div style="font-weight:600;font-size:24px;line-height:30px;color:#FFFFFF;">${t.cierre[1]}</div>
          <div style="font-weight:600;font-size:20px;line-height:28px;color:${NARANJA};">${t.cierre[2]}</div>
        </td></tr>

        <tr><td bgcolor="${NARANJA}" align="center" style="background:${NARANJA};">
          <a href="${urlAbrir}" style="display:block;padding:16px 12px;font-family:${CONDENSADA};font-weight:600;font-size:21px;line-height:26px;color:#000000;text-decoration:none;text-transform:uppercase;letter-spacing:0.5px;">${t.boton}&nbsp;&rarr;</a>
        </td></tr>

      </table>
    </td></tr>
    </table>
  </td></tr>

  <tr><td align="center" style="padding:30px 16px 4px;font-family:${CONDENSADA};font-weight:600;font-size:32px;line-height:36px;color:#FFFFFF;text-transform:uppercase;">CORRR Crew</td></tr>
  <tr><td align="center" style="padding:0 16px 30px;font-family:${MONO};font-size:12px;letter-spacing:2px;color:#777777;">CORRE.&nbsp; CONQUISTA.&nbsp; DOMINA.</td></tr>

  <tr><td style="padding:0 24px 36px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#8A8A8A;">
    Te escribimos porque te registraste en CORRR con este email. No queremos llenarte el buzón: si prefieres no recibir
    más emails como este, <a href="${urlBaja}" style="color:#BBBBBB;text-decoration:underline;">date de baja con un clic</a>
    o escríbenos a <a href="mailto:hola@corrr.es" style="color:#BBBBBB;">hola@corrr.es</a>. Los correos de tu cuenta
    (verificación y contraseña) te seguirán llegando.<br><br>
    El 22 de septiembre de 2026 actualizamos la <a href="${PRIVACIDAD_URL}" style="color:#BBBBBB;text-decoration:underline;">política de privacidad</a>
    para contar que podemos escribirte de vez en cuando sobre CORRR.<br><br>
    CORRR · Iván García-Castrillón Cerdá · España
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Versión en texto plano: la leen los clientes sin HTML y los filtros de spam
 *  la tienen en cuenta (un email solo HTML puntúa peor). */
export function textoReactivacion({ nombre, urlAbrir, urlBaja, variante }: DatosEmail): string {
  const t = TEXTOS[variante];
  return `Hola, ${nombre}:

${t.intro}

${t.bloque.replace('<br>', ' ')}. ${t.circuito}

${t.misiones.replace('// ', '')}:
01 · ${t.lista[0]}
02 · ${t.lista[1]}
03 · ${t.lista[2]}

${t.cierre[0]} ${t.cierre[1]} ${t.cierre[2]}

${t.boton}: ${urlAbrir}

CORRR Crew
Corre. Conquista. Domina.

--
Te escribimos porque te registraste en CORRR con este email. Si no quieres recibir más emails como este, date de baja aquí: ${urlBaja}
o escríbenos a hola@corrr.es. Los correos de tu cuenta (verificación y contraseña) te seguirán llegando.
El 22 de septiembre de 2026 actualizamos la política de privacidad para contar que podemos escribirte de vez en cuando sobre CORRR: ${PRIVACIDAD_URL}
CORRR · Iván García-Castrillón Cerdá · España
`;
}
