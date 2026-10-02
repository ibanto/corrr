package app.corrr.deteccioncarrera

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity

/**
 * Lo que pasa cuando el teléfono decide que has echado a correr.
 *
 * Esto salta con CORRR cerrada: Google Play Services despierta al receptor y
 * le entrega la transición. Aquí no se puede llamar a nada de JavaScript, así
 * que el aviso se monta a mano, en Kotlin.
 *
 * Solo hace una cosa: sacar una notificación. No arranca la carrera ni toca el
 * GPS — eso sería registrar a alguien sin que lo haya pedido. El usuario toca
 * la notificación, se abre CORRR y él decide.
 */
class ReceptorActividad : BroadcastReceiver() {

  override fun onReceive(contexto: Context, intent: Intent) {
    if (!ActivityTransitionResult.hasResult(intent)) return
    val resultado = ActivityTransitionResult.extractResult(intent) ?: return

    val haEmpezadoACorrer = resultado.transitionEvents.any { evento ->
      evento.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER &&
        evento.activityType == DetectedActivity.RUNNING
    }
    if (!haEmpezadoACorrer) return
    if (!Ajustes.tocaAvisar(contexto)) return

    avisar(contexto)
    Ajustes.apuntaAviso(contexto)
  }

  private fun avisar(contexto: Context) {
    val gestor = contexto.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val canal = NotificationChannel(
        CANAL,
        "¿Estás corriendo?",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "Te avisamos cuando el teléfono detecta que has salido a correr."
      }
      gestor.createNotificationChannel(canal)
    }

    // Abrir la app tal cual. Sin pantalla especial ni carrera empezada: quien
    // toca decide qué hacer, y si no toca no pasa nada.
    val abrir = contexto.packageManager.getLaunchIntentForPackage(contexto.packageName)
      ?.apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP }
    val alPulsar = PendingIntent.getActivity(
      contexto,
      0,
      abrir,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val aviso = NotificationCompat.Builder(contexto, CANAL)
      .setSmallIcon(contexto.applicationInfo.icon)
      .setContentTitle("¿Has salido a correr?")
      .setContentText("Abre CORRR y el asfalto que pises es tuyo.")
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
      .setContentIntent(alPulsar)
      .setAutoCancel(true)
      .build()

    // Si el usuario ha dicho que no a las notificaciones, esto no lanza: se
    // queda sin hacer nada, que es lo correcto.
    try {
      NotificationManagerCompat.from(contexto).notify(ID_AVISO, aviso)
    } catch (_: SecurityException) {
    }
  }

  private companion object {
    const val CANAL = "carrera_detectada"
    const val ID_AVISO = 4201
  }
}
