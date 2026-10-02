import { NativeModule, requireNativeModule } from 'expo';
import { PermissionsAndroid, Platform } from 'react-native';

/**
 * "¿Has salido a correr?" — el aviso de Android.
 *
 * En iPhone no existe y no hace falta: allí las carreras de Strava o del
 * Apple Watch entran solas por Salud. Todas las funciones son seguras de
 * llamar en iOS; simplemente no hacen nada.
 */

declare class DeteccionCarreraModule extends NativeModule {
  hayPermiso(): boolean;
  estaEncendido(): boolean;
  activar(): Promise<boolean>;
  desactivar(): Promise<void>;
  marcarCarreraEnMarcha(enMarcha: boolean): void;
}

// En iOS el módulo no se compila, así que pedirlo revienta. Se pide una vez y
// se guarda: si no está, todo lo de abajo se queda en nada.
const nativo: DeteccionCarreraModule | null = (() => {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeModule<DeteccionCarreraModule>('DeteccionCarrera');
  } catch {
    // Una build vieja del cliente de desarrollo no lleva el módulo. Mejor
    // quedarse sin la función que dejar la app sin arrancar.
    return null;
  }
})();

/** ¿Se puede usar esto en este teléfono? */
export const hayDeteccion = nativo !== null;

/** ¿Está el aviso encendido ahora mismo? */
export function estaEncendido(): boolean {
  return nativo?.estaEncendido() ?? false;
}

/**
 * Enciende el aviso, pidiendo el permiso si hace falta.
 *
 * Devuelve false si el usuario dice que no. El permiso es "Actividad física":
 * el mismo que usan las apps de pasos, y no tiene nada que ver con la
 * ubicación.
 */
export async function encender(): Promise<boolean> {
  if (!nativo) return false;
  if (!nativo.hayPermiso()) {
    const respuesta = await PermissionsAndroid.request(
      'android.permission.ACTIVITY_RECOGNITION' as any,
      {
        title: '¿Te avisamos cuando salgas a correr?',
        message:
          'CORRR usa el detector de actividad del teléfono para avisarte si echas a correr sin haber abierto la app. '
          + 'No es la ubicación: no sabemos por dónde vas hasta que empiezas una carrera.',
        buttonPositive: 'Vale',
        buttonNegative: 'Ahora no',
      },
    );
    if (respuesta !== PermissionsAndroid.RESULTS.GRANTED) return false;
  }
  return nativo.activar();
}

/** Apaga el aviso. */
export async function apagar(): Promise<void> {
  await nativo?.desactivar();
}

/** Mientras hay una carrera en marcha, el detector se calla. */
export function marcarCarreraEnMarcha(enMarcha: boolean): void {
  nativo?.marcarCarreraEnMarcha(enMarcha);
}
