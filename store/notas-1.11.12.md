# Notas de la versión 1.11.12 (solo Android, vc88)

Sale **solo en Android**: los arreglos son de cómo Android cierra la app para
ahorrar batería. El iPhone se queda en la 1.11.11 (build 34), así que en App
Store Connect no hay nada que pegar.

---

## 1 · Para la prueba interna (ahora)

Da igual el formato, lo lee solo tu gente.

```
La carrera ya no se pierde si el móvil cierra CORRR para ahorrar batería
(pasaba en Xiaomi al guardar el móvil): al volver sigue la misma carrera.

El GPS empieza a grabar en cuanto pulsas INICIAR. Mientras engancha sale
«Buscando GPS…», sin vibrar.

Una carrera que no se pudo guardar ya no se manda dos veces.
```

---

## 2 · Para producción, cuando la prueba en la calle salga bien

### Google Play — "Novedades" (máx. 500 caracteres; esto son 468)

```
Arreglos para que no se te escape ni un metro:

· Si guardas el móvil a mitad de carrera y el sistema cierra CORRR para ahorrar batería, ya no la pierdes: al volver sigue donde iba, con lo corrido en el bolsillo.
· El GPS empieza a grabar en cuanto pulsas INICIAR. Mientras engancha verás «Buscando GPS…», sin vibraciones de falsa alarma.
· Una carrera que no se pudo guardar ya no se cuenta dos veces.

Halloween sigue hasta el 1 de noviembre. ¡A por las calabazas! 🎃
```

Después de que Google la publique: Railway → `LATEST_APP_VERSION` = 1.11.12 ·
`LATEST_APP_VC` = 88 (y desplegar). **`MIN_APP_VERSION` NO se toca**: subirla
con gente corriendo saca la pantalla de «actualiza» y les corta la carrera.
