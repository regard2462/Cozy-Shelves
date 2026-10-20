# Cozy Shelves – deutsche Sprachausgabe (Kartoffelbox)

Dieser Ordner enthält den Python-„Sidecar“, mit Cozy Shelves deutsche Bücher, Zeitungsartikel und Wikipedia-Seiten
**lokal** vorliest. Verwendet wird **Kartoffelbox**, ein deutsches Fine-Tuning von Resemble AIs *Chatterbox*
(Hugging Face: `SebastianBodza/Kartoffelbox_Turbo` und `SebastianBodza/Kartoffelbox-v0.1`), ausgeführt mit dem
Python-Paket `chatterbox-tts`. Englische Texte liest Cozy Shelves mit *Kokoro* direkt im Programm vor – dafür ist keine
Einrichtung nötig.

Es werden keine Daten an Server geschickt; nach der einmaligen Einrichtung läuft alles offline.

## Voraussetzungen

* Windows 10/11 (Linux/macOS: siehe unten), ca. **8 GB freier Speicher** (Python-Pakete ≈ 3 GB, Modelle ≈ 3–5 GB)
* **Python 3.10, 3.11 oder 3.12** – Download: <https://www.python.org/downloads/windows/>
  (im Installer „Add python.exe to PATH“ anhaken; der „py“-Starter wird mitinstalliert)
* **NVIDIA-Grafikkarte** mit aktuellem Treiber (≥ 6 GB VRAM empfohlen). Ohne GPU funktioniert es auch, ist aber
  sehr langsam (mehrere Sekunden pro Satz auf der CPU).
* Internetverbindung für die Einrichtung (Pakete von PyPI/PyTorch, Modelle von huggingface.co).

## Einrichtung

1. In Cozy Shelves: **Einstellungen → Vorlesen → „Deutsche Sprachausgabe einrichten“** – oder direkt
   `setup_tts.bat` doppelklicken (Linux/macOS: `bash setup_tts.sh`).
2. Es öffnet sich ein Konsolenfenster. Das Skript
   * legt eine virtuelle Python-Umgebung in `tts-server/venv` an,
   * installiert `chatterbox-tts`, `huggingface_hub`, `safetensors` (siehe `requirements.txt`),
   * ersetzt PyTorch unter Windows durch die CUDA-Version (`--index-url https://download.pytorch.org/whl/cu124`,
     bei Bedarf cu126/cu128/cu121) in genau der von `chatterbox-tts` benötigten Version,
   * lädt die Modelle herunter und macht einen Selbsttest (`server.py --selftest --model turbo`),
   * erzeugt mit dem v0.1-Modell eine Standard-Referenzstimme `voices/default_de.wav` für das Turbo-Modell.
3. Dauer: 10–30 Minuten. Am Ende erscheint **FERTIG**; das Fenster bleibt offen, bis eine Taste gedrückt wird.
4. Cozy Shelves neu starten. Beim ersten „Vorlesen“ eines deutschen Textes startet der Server im Hintergrund
   (Modell laden: 15–60 s), danach folgen die Sätze zügig.

Optionen: `setup_tts.bat --turbo-only` (nur das Turbo-Modell, ohne v0.1 und ohne Standard-Referenzstimme),
`--cpu` (keine CUDA-Version installieren), `--skip-install` (nur Modelle laden/testen).

## Stimmen

* **Turbo** (Standard, schnell): `Kartoffelbox_Turbo` (`model.pt`, Schlüssel-Präfix `_orig_mod.` wird entfernt) in
  `ChatterboxTurboTTS`. Das Turbo-Modell klont die Stimme aus einer **Referenzaufnahme** (5–20 s WAV). Ohne eigene
  Aufnahme wird `voices/default_de.wav` verwendet (vom Setup erzeugt); fehlt auch diese, wird – falls vorhanden –
  die eingebaute Stimme des Basismodells genutzt, sonst meldet der Server einen Fehler mit Hinweis.
* **v0.1** (Original-Fine-Tune): `Kartoffelbox-v0.1` (`t3_cfg.safetensors`) in `ChatterboxTTS`; hat eine eingebaute
  Stimme, Referenzaufnahme optional. Umschalten: in den Cozy-Shelves-Einstellungen (`tts.germanModel = "v0.1"`).
* **Eigene Stimme**: Einstellungen → „Referenz-Aufnahme wählen“ (WAV/MP3/FLAC, 5–20 s klare Sprache ohne Musik).
  Der Pfad wird in den Einstellungen (`tts.germanPrompt`) gespeichert.

## Manuell starten / prüfen

```
venv\Scripts\python.exe server.py --port 8765 --model turbo      # Windows
venv/bin/python server.py --port 8765 --model turbo              # Linux/macOS
curl http://127.0.0.1:8765/health
curl -X POST http://127.0.0.1:8765/tts -H "Content-Type: application/json" -d "{\"text\":\"Guten Tag!\"}"
```

* `GET /health` → `{"ok":true,"model":"turbo","device":"cuda","sampleRate":24000,"builtinVoice":…,"defaultPrompt":…}`
* `POST /tts` `{"text": "…", "voice_prompt": "C:/…/stimme.wav" | null, "exaggeration": 0.5, "cfg_weight": 0.5,
  "temperature": 0.8}` → `{"sampleRate": 24000, "pcm": "<Base64, 16-Bit-PCM mono>", "seconds": 3.2}`
  (Geschwindigkeit wird im Programm über die Wiedergaberate geregelt, nicht vom Modell).
* `POST /shutdown`
* Auf stdout meldet der Server `PORT=<port>`, `STATUS=…`, `MODEL=…`, `DEVICE=…`, `READY`; Logs gehen nach stderr.
* `server.py --fake --port 0` startet ohne Modell (Sinuston) – zum Testen der Anbindung ohne GPU/Python-Pakete.
* `server.py --selftest`, `server.py --make-default-prompt`.

Cozy Shelves startet den Server automatisch beim ersten Vorlesen (`electron/tts/sidecar.js`), wählt einen freien Port,
startet ihn nach einem Absturz bis zu dreimal neu und beendet ihn beim Schließen des Programms. Umgebungsvariablen
für Entwickler: `COZYSHELVES_TTS_SERVER` (anderer Ordner), `COZYSHELVES_TTS_PYTHON` (anderer Interpreter),
`COZYSHELVES_TTS_FAKE=1` (Server im Fake-Modus).

## Modelle / Cache

Die Modelle liegen im Hugging-Face-Cache (`%USERPROFILE%\.cache\huggingface\hub`; änderbar mit der
Umgebungsvariable `HF_HOME`). Zum Entfernen der Sprachausgabe einfach den Ordner `venv` und den Cache löschen.

## Probleme

* **„CUDA verfügbar: False“** – NVIDIA-Treiber aktualisieren (GeForce Experience / nvidia.com) und Setup erneut
  ausführen; im Zweifel `setup_tts.bat --skip-install` nach manueller Installation von PyTorch aus
  <https://pytorch.org/get-started/locally/>.
* **Fehler bei `pip install chatterbox-tts`** – meist falsche Python-Version (3.13 wird nicht unterstützt) oder fehlende
  Internetverbindung.
* **„Das Turbo-Modell braucht eine Referenzstimme“** – `venv\Scripts\python.exe server.py --make-default-prompt`
  ausführen oder in den Einstellungen eine eigene WAV-Datei wählen.
* Protokoll des Servers: in Cozy Shelves per `api.invoke('tts:log')` bzw. in der Konsole von `server.py`.
