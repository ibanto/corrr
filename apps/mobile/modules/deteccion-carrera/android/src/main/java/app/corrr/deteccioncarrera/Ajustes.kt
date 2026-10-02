package app.corrr.deteccioncarrera

import android.content.Context

/**
 * Lo poco que el detector necesita recordar entre avisos.
 *
 * Va en SharedPreferences y no en la app porque el receptor salta con CORRR
 * CERRADA: cuando el sistema avisa de que alguien ha echado a correr, no hay
 * JavaScript vivo a quien preguntarle nada.
 */
internal object Ajustes {
  private const val FICHERO = "deteccion_carrera"
  private const val ENCENDIDO = "encendido"
  private const val ULTIMO_AVISO = "ultimo_aviso"
  private const val CARRERA_EN_MARCHA = "carrera_en_marcha"

  /** Media hora entre avisos. Sin esto, una carrera con semáforos puede
   *  generar varias transiciones "empieza a correr" y sonarle al usuario tres
   *  veces en diez minutos, que es la forma más rápida de que lo apague. */
  const val ESPERA_ENTRE_AVISOS_MS = 30 * 60 * 1000L

  private fun prefs(contexto: Context) =
    contexto.getSharedPreferences(FICHERO, Context.MODE_PRIVATE)

  fun encendido(contexto: Context): Boolean = prefs(contexto).getBoolean(ENCENDIDO, false)

  fun ponEncendido(contexto: Context, valor: Boolean) {
    prefs(contexto).edit().putBoolean(ENCENDIDO, valor).apply()
  }

  fun carreraEnMarcha(contexto: Context): Boolean =
    prefs(contexto).getBoolean(CARRERA_EN_MARCHA, false)

  fun ponCarreraEnMarcha(contexto: Context, valor: Boolean) {
    prefs(contexto).edit().putBoolean(CARRERA_EN_MARCHA, valor).apply()
  }

  /** ¿Toca avisar? Solo si está encendido, no hay carrera ya en marcha y ha
   *  pasado el rato de cortesía desde el último aviso. */
  fun tocaAvisar(contexto: Context): Boolean {
    if (!encendido(contexto)) return false
    if (carreraEnMarcha(contexto)) return false
    val ultimo = prefs(contexto).getLong(ULTIMO_AVISO, 0L)
    return System.currentTimeMillis() - ultimo > ESPERA_ENTRE_AVISOS_MS
  }

  fun apuntaAviso(contexto: Context) {
    prefs(contexto).edit().putLong(ULTIMO_AVISO, System.currentTimeMillis()).apply()
  }
}
