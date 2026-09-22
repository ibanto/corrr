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

/** 'nada': ninguna carrera. 'poco': alguna, pero 100 puntos o menos. */
export type Variante = 'nada' | 'poco';

const TEXTOS: Record<Variante, {
  preheader: string; intro: string; circuito: string; misiones: string; boton: string;
}> = {
  nada: {
    preheader: 'Te uniste a CORRR y tu primera zona sigue sin dueño.',
    intro: 'Te uniste a CORRR pero todavía no has reclamado tu primera zona.',
    circuito: 'CORRR solo necesita que salgas y cierres un circuito.',
    misiones: '// PRIMERA ZONA: ELIGE TU MISIÓN',
    boton: 'Reclama tu primera zona',
  },
  poco: {
    preheader: 'Ya saliste con CORRR. Tu territorio todavía cabe en una calle.',
    intro: 'Ya has salido con CORRR, pero tu territorio todavía es pequeño.',
    circuito: 'Cierra un circuito y todo lo que queda dentro es tuyo.',
    misiones: '// SIGUIENTE ZONA: ELIGE TU MISIÓN',
    boton: 'Amplía tu territorio',
  },
};

const HERO_URL = 'https://ibanto.github.io/corrr/email/una-vuelta-basta.jpg';
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
<title>${ASUNTO_REACTIVACION}</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono&family=Oswald:wght@500;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#000000;" bgcolor="#000000">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#000000;">${t.preheader}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

  <tr><td>
    <a href="${urlAbrir}" style="text-decoration:none;">
      <img src="${HERO_URL}" width="600" alt="CORRR — Una vuelta basta" style="display:block;width:100%;max-width:600px;height:auto;border:0;color:#FFFFFF;font-family:${CONDENSADA};font-size:32px;">
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
            <td style="font-family:${CONDENSADA};font-weight:600;font-size:28px;line-height:32px;color:#000000;text-transform:uppercase;">Da igual que corras<br>o que camines</td>
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
            ${mision('01', 'Una vuelta a la manzana')}
            ${mision('02', 'Un paseo al parque y vuelta')}
            ${mision('03', '10 minutos caminando después de comer')}
          </table>
        </td></tr>
        ${linea}

        <tr><td style="font-family:${CONDENSADA};text-transform:uppercase;padding-bottom:22px;">
          <div style="font-weight:600;font-size:31px;line-height:37px;color:${NARANJA};">Nada de maratones.</div>
          <div style="font-weight:600;font-size:24px;line-height:30px;color:#FFFFFF;">Solo salir. Cerrar el círculo.</div>
          <div style="font-weight:600;font-size:20px;line-height:28px;color:${NARANJA};">Te está esperando.</div>
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

Da igual que corras o que camines. ${t.circuito}

Elige tu misión:
01 · Una vuelta a la manzana
02 · Un paseo al parque y vuelta
03 · 10 minutos caminando después de comer

Nada de maratones. Solo salir. Cerrar el círculo. Te está esperando.

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
