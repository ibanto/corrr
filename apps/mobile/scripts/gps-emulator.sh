#!/usr/bin/env bash
# Carrera simulada en el emulador Android con la pantalla apagada a mitad.
#
# Comprueba en el sistema operativo de verdad lo que gps-check.ts no puede:
# que el contador siga avanzando con la pantalla apagada y el permiso de
# ubicación en "Mientras se usa la app".
#
# Antes de lanzarlo:
#   1. Emulador arrancado, app instalada y con sesión iniciada.
#   2. En la app, INICIAR CARRERA.
# No pulsa STOP: al acabar cierra la app a la fuerza y la carrera NO se guarda.
set -uo pipefail
ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
PKG=app.corrr
OUT="${OUT:-/tmp/corrr-gps-emu}"
mkdir -p "$OUT"

LAT=41.3900; LNG=2.1600      # Eixample, hacia el este
KMH=10; EVERY=3
STEP_M=$(echo "$KMH / 3.6 * $EVERY" | bc -l)
DLNG=$(echo "$STEP_M / (111000 * c($LAT * 3.14159265 / 180))" | bc -l)
KNOTS=$(echo "$KMH / 1.852" | bc -l)

numbers_on_screen() {
  "$ADB" shell uiautomator dump /sdcard/corrr-ui.xml >/dev/null 2>&1
  "$ADB" shell cat /sdcard/corrr-ui.xml 2>/dev/null | grep -o 'text="[0-9]*\.[0-9][0-9]"' | grep -o '[0-9.]*' | tr '\n' ' '
}
walk() { # segundos
  local n=$(( $1 / EVERY ))
  for ((i = 0; i < n; i++)); do
    LNG=$(echo "$LNG + $DLNG" | bc -l)
    "$ADB" emu geo fix "$LNG" "$LAT" 10 12 "$KNOTS" >/dev/null
    sleep "$EVERY"
  done
}
shot() { "$ADB" exec-out screencap -p > "$OUT/$1.png"; }

echo "1) 60 s andando con la pantalla encendida (≈ 167 m)"
walk 60; shot 1-encendida; A=$(numbers_on_screen); echo "   en pantalla: $A"

echo "2) Pantalla apagada, 90 s más andando (≈ 250 m)"
"$ADB" shell input keyevent KEYCODE_SLEEP
walk 90

echo "3) Encender y desbloquear"
"$ADB" shell input keyevent KEYCODE_WAKEUP
"$ADB" shell wm dismiss-keyguard
sleep 4; shot 3-al-volver; B=$(numbers_on_screen); echo "   en pantalla: $B"

echo "4) 30 s más con la pantalla encendida"
walk 30; shot 4-final; C=$(numbers_on_screen); echo "   en pantalla: $C"

"$ADB" shell am force-stop "$PKG"
echo "App cerrada sin guardar. Capturas en $OUT"
echo "Esperado: el km al volver (paso 3) ≈ 0.42, no ≈ 0.17."
