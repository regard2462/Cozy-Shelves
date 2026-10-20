#!/usr/bin/env bash
# Cozy Shelves – deutsche Sprachausgabe (Kartoffelbox / Chatterbox) einrichten (Linux / macOS).
# Legt tts-server/venv an, installiert chatterbox-tts (+ PyTorch) und lädt die Modelle (ca. 5 GB).
set -u
cd "$(dirname "$0")"

echo "======================================================================"
echo " Cozy Shelves – deutsche Sprachausgabe (Kartoffelbox / Chatterbox) einrichten"
echo "======================================================================"
echo

PY=""
for c in python3.11 python3.12 python3.10 python3 python; do
  if command -v "$c" >/dev/null 2>&1; then
    if "$c" -c 'import sys; raise SystemExit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)' 2>/dev/null; then PY="$c"; break; fi
  fi
done
if [ -z "$PY" ]; then
  echo "FEHLER: Kein Python 3.10–3.12 gefunden. Bitte installieren (z. B. 'sudo apt install python3.11 python3.11-venv')."
  exit 1
fi
echo "Verwende Python: $PY ($("$PY" --version 2>&1))"

if [ ! -x "venv/bin/python" ]; then
  echo "Erstelle virtuelle Umgebung venv …"
  "$PY" -m venv venv || { echo "FEHLER: venv konnte nicht erstellt werden (fehlt das Paket python3-venv?)"; exit 1; }
fi

venv/bin/python setup_tts.py "$@"
RC=$?
echo
if [ "$RC" -ne 0 ]; then
  echo "FEHLER: Die Einrichtung ist fehlgeschlagen (Code $RC) – siehe Meldungen oben. Das Skript kann erneut gestartet werden."
else
  echo "FERTIG – die deutsche Sprachausgabe ist eingerichtet. Cozy Shelves (neu) starten und 'Vorlesen' wählen."
fi
# bei Start aus einem Terminalfenster (Einstellungen → Einrichten) das Fenster offen halten
if [ -t 0 ] && [ -n "${COZYSHELVES_SETUP_PAUSE:-}" ]; then read -r -p "Enter zum Schließen …" _; fi
exit $RC
