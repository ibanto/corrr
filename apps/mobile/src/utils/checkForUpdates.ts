import { Alert, Linking } from 'react-native';

const VERSION_ENDPOINT = 'https://corrr-api-production.up.railway.app/app/version';

/** Versión actual del cliente. Se exporta desde aquí (no desde App.tsx)
 *  para evitar la dependencia circular App ↔ PerfilScreen, que dejaba
 *  CURRENT_VERSION como `undefined` en PerfilScreen y rompía el botón
 *  "Buscar actualizaciones" en silencio. Recordatorio: bumpear esto JUNTO
 *  con versionCode/versionName de build.gradle en cada release (CLAUDE.md §4). */
export const CURRENT_VERSION = '1.10.6';

/** Compara dos versiones semver tipo "1.10.5". Devuelve true si `latest`
 *  es estrictamente más nueva que `current`. Asume formato X.Y.Z fijo. */
function isNewerVersion(latest: string, current: string): boolean {
  const l = latest.split('.').map(Number);
  const c = current.split('.').map(Number);
  if (l[0] !== c[0]) return l[0] > c[0];
  if (l[1] !== c[1]) return l[1] > c[1];
  return l[2] > c[2];
}

/** Pregunta al backend la última versión y, si es más nueva que la del
 *  cliente, ofrece abrir Play Store. Compartida entre el auto-check del
 *  arranque y el botón manual "Buscar actualizaciones" de Perfil.
 *
 *  silent=true → solo avisa si hay update (auto-check al arrancar y al
 *    volver de background). Errores y "estás al día" se tragan en silencio.
 *  silent=false → siempre da feedback (botón manual): muestra "estás al
 *    día" o "no se pudo comprobar" para que el usuario sepa que ha pasado
 *    algo tras pulsar. */
export async function checkForUpdates(currentVersion: string, silent: boolean): Promise<void> {
  let data: { latestVersion?: string; updateUrl?: string };
  try {
    const res = await fetch(VERSION_ENDPOINT);
    data = await res.json();
  } catch {
    if (!silent) Alert.alert('Sin conexión', 'No se pudo comprobar si hay actualizaciones. Inténtalo de nuevo más tarde.');
    return;
  }
  if (!data.latestVersion) {
    if (!silent) Alert.alert('Error', 'El servidor no devolvió información de versión.');
    return;
  }
  if (isNewerVersion(data.latestVersion, currentVersion)) {
    Alert.alert(
      '¡Nueva versión disponible!',
      `CORRR ${data.latestVersion} ya está disponible. Actualiza para disfrutar de las últimas mejoras.`,
      [
        { text: 'Ahora no', style: 'cancel' },
        { text: 'Actualizar', onPress: () => data.updateUrl && Linking.openURL(data.updateUrl) },
      ],
    );
  } else if (!silent) {
    Alert.alert('Estás al día', `Tienes la última versión (${currentVersion}).`);
  }
}
