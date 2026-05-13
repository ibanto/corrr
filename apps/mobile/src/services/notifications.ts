import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './api';

// Configurar cómo se muestran las notificaciones cuando la app está abierta
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Registra el dispositivo para push notifications y envía el token al backend. */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('[Push] Solo funciona en dispositivos físicos');
    return null;
  }

  // Pedir permisos
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Push] Permisos denegados');
    return null;
  }

  // Obtener token de Expo Push
  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: '406f1da5-ff06-4b8a-b015-16fbdb5b3058',
  });
  const token = tokenData.data;
  console.log('[Push] Token:', token);

  // Canal de Android
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('zones', {
      name: 'Zonas',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF6600',
    });
  }

  // Enviar token al backend
  try {
    await api.savePushToken(token);
  } catch (e) {
    console.log('[Push] Error al guardar token:', e);
  }

  return token;
}
