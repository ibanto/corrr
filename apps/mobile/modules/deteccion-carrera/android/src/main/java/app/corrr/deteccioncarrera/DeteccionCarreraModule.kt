package app.corrr.deteccioncarrera

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.DetectedActivity
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Detectar que alguien ha salido a correr, en Android.
 *
 * Por qué existe: en iPhone, las carreras que graba otra app (Strava, el
 * Apple Watch) llegan a CORRR solas a través de Salud. En Android no hay ese
 * camino —Strava manda tiempo y distancia, pero no la ruta—, así que quien
 * sale a correr y no se acuerda de abrir CORRR pierde la carrera entera.
 *
 * Esto no la recupera: avisa. El sistema ya sabe cuándo estás corriendo (es
 * el mismo dato que usa para contarte los pasos), así que se le pide que nos
 * avise, y nosotros te avisamos a ti.
 *
 * NO usa la ubicación. El permiso es "Actividad física", que es mucho menos
 * de lo que pediría tener el GPS encendido en segundo plano.
 */
class DeteccionCarreraModule : Module() {

  private val contexto: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("DeteccionCarrera")

    Function("hayPermiso") {
      ContextCompat.checkSelfPermission(contexto, Manifest.permission.ACTIVITY_RECOGNITION) ==
        PackageManager.PERMISSION_GRANTED
    }

    Function("estaEncendido") { Ajustes.encendido(contexto) }

    AsyncFunction("activar") {
      if (ContextCompat.checkSelfPermission(contexto, Manifest.permission.ACTIVITY_RECOGNITION) !=
        PackageManager.PERMISSION_GRANTED
      ) {
        return@AsyncFunction false
      }
      registrar()
      Ajustes.ponEncendido(contexto, true)
      true
    }

    AsyncFunction("desactivar") {
      ActivityRecognition.getClient(contexto).removeActivityTransitionUpdates(pendingIntent())
      Ajustes.ponEncendido(contexto, false)
    }

    /** La app avisa de que hay una carrera en marcha: mientras dure, el
     *  detector se calla. Si no, al empezar a correr saltaría el aviso justo
     *  después de haber pulsado EMPEZAR. */
    Function("marcarCarreraEnMarcha") { enMarcha: Boolean ->
      Ajustes.ponCarreraEnMarcha(contexto, enMarcha)
    }
  }

  private fun registrar() {
    // Solo la ENTRADA en "corriendo". La salida no interesa: si deja de
    // correr, o ya está en la app o es que no quería que contara.
    val transiciones = listOf(
      ActivityTransition.Builder()
        .setActivityType(DetectedActivity.RUNNING)
        .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER)
        .build(),
    )
    ActivityRecognition.getClient(contexto)
      .requestActivityTransitionUpdates(ActivityTransitionRequest(transiciones), pendingIntent())
  }

  /** El aviso tiene que ser MUTABLE: Google Play Services le mete dentro cuál
   *  ha sido la transición. Con FLAG_IMMUTABLE llega vacío y el receptor no
   *  se entera de nada — falla en silencio, que es lo peor. */
  private fun pendingIntent(): PendingIntent {
    val intent = Intent(contexto, ReceptorActividad::class.java)
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
    } else {
      PendingIntent.FLAG_UPDATE_CURRENT
    }
    return PendingIntent.getBroadcast(contexto, CODIGO, intent, flags)
  }

  private companion object {
    const val CODIGO = 4201
  }
}
