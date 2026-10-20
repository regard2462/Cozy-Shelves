#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Einrichtung der deutschen Sprachausgabe für Cozy Shelves (wird von setup_tts.bat / setup_tts.sh aus dem venv heraus
aufgerufen; kann auch direkt gestartet werden:  venv/Scripts/python.exe setup_tts.py [--turbo-only] [--cpu]).

Schritte:
  1. pip aktualisieren, requirements.txt installieren (chatterbox-tts bringt eine CPU-Version von PyTorch mit)
  2. unter Windows: PyTorch/torchaudio in genau der installierten Version durch die CUDA-Variante ersetzen
  3. prüfen, ob CUDA verfügbar ist
  4. Modelle herunterladen + Selbsttest (Turbo, optional auch v0.1) und voices/default_de.wav erzeugen
"""
import argparse
import os
import platform
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
CUDA_INDEXES = ["cu124", "cu126", "cu128", "cu121"]


def say(msg=""):
    print(msg, flush=True)


def run(args, check=True, capture=False):
    say("  > " + " ".join(a if " " not in a else '"%s"' % a for a in args))
    if capture:
        r = subprocess.run(args, cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        return r.returncode, r.stdout
    r = subprocess.run(args, cwd=HERE)
    if check and r.returncode != 0:
        raise SystemExit("FEHLER: Befehl fehlgeschlagen (Code %d)" % r.returncode)
    return r.returncode, ""


def torch_versions():
    code = "import torch, torchaudio; print(torch.__version__.split('+')[0]); print(torchaudio.__version__.split('+')[0]); print(torch.cuda.is_available())"
    rc, outp = run([PY, "-c", code], check=False, capture=True)
    if rc != 0:
        return None, None, False
    lines = [l.strip() for l in outp.strip().splitlines() if l.strip()]
    if len(lines) < 3:
        return None, None, False
    return lines[-3], lines[-2], lines[-1] == "True"


def has_nvidia():
    if platform.system() == "Darwin":
        return False
    try:
        r = subprocess.run(["nvidia-smi", "-L"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=20)
        return r.returncode == 0 and "GPU" in r.stdout
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--turbo-only", action="store_true", help="nur das Turbo-Modell laden (keine v0.1-Gewichte, keine Standard-Referenzstimme)")
    ap.add_argument("--cpu", action="store_true", help="keine CUDA-Version von PyTorch installieren")
    ap.add_argument("--skip-install", action="store_true", help="nur Modelle laden/testen")
    args = ap.parse_args()

    say("=" * 70)
    say(" Cozy Shelves – deutsche Sprachausgabe (Kartoffelbox / Chatterbox) einrichten")
    say("=" * 70)
    say("Python: %s (%s)" % (sys.version.split()[0], PY))
    if sys.version_info < (3, 10) or sys.version_info >= (3, 13):
        say("WARNUNG: Empfohlen ist Python 3.10 bis 3.12 – mit %d.%d kann die Installation fehlschlagen." % sys.version_info[:2])
    t0 = time.time()

    if not args.skip_install:
        say("\n[1/4] Aktualisiere pip …")
        run([PY, "-m", "pip", "install", "--upgrade", "pip", "wheel", "setuptools"], check=False)
        say("\n[2/4] Installiere chatterbox-tts und Abhängigkeiten (das dauert einige Minuten) …")
        run([PY, "-m", "pip", "install", "-r", os.path.join(HERE, "requirements.txt")])

        tv, tav, cuda = torch_versions()
        say("\n[3/4] PyTorch %s / torchaudio %s installiert, CUDA verfügbar: %s" % (tv, tav, cuda))
        want_cuda = not args.cpu and platform.system() == "Windows" and not cuda
        if want_cuda and not has_nvidia():
            say("Hinweis: nvidia-smi meldet keine GPU – die CUDA-Version wird trotzdem versucht (Treiber ggf. aktualisieren).")
        if want_cuda and tv and tav:
            ok = None
            for idx in CUDA_INDEXES:
                say("  Versuche CUDA-Build %s …" % idx)
                rc, _ = run([PY, "-m", "pip", "install", "--force-reinstall", "--no-deps", "torch==" + tv, "torchaudio==" + tav,
                             "--index-url", "https://download.pytorch.org/whl/" + idx], check=False)
                if rc == 0:
                    ok = idx
                    break
            if ok:
                tv, tav, cuda = torch_versions()
                say("  PyTorch %s (%s) installiert, CUDA verfügbar: %s" % (tv, ok, cuda))
            else:
                say("WARNUNG: Es konnte keine CUDA-Version von PyTorch installiert werden – die Sprachausgabe läuft auf der CPU (langsam).")
        if not cuda:
            say("Hinweis: Ohne CUDA-GPU ist die Synthese sehr langsam (mehrere Sekunden pro Satz).")
    else:
        say("\n[1-3/4] Installation übersprungen (--skip-install)")

    say("\n[4/4] Lade Modelle von huggingface.co herunter und teste die Synthese (ca. 3–5 GB, einmalig) …")
    server = os.path.join(HERE, "server.py")
    run([PY, server, "--selftest", "--model", "turbo"])
    if not args.turbo_only:
        say("\n  Erzeuge Standard-Referenzstimme (voices/default_de.wav) mit dem v0.1-Modell …")
        rc, _ = run([PY, server, "--make-default-prompt"], check=False)
        if rc != 0:
            say("WARNUNG: Referenzstimme konnte nicht erzeugt werden. Falls das Turbo-Modell keine eingebaute Stimme hat,")
            say("         bitte in den Cozy-Shelves-Einstellungen eine eigene WAV-Aufnahme (5–20 s) als Stimme wählen.")

    say("\nFERTIG in %.0f s. Die deutsche Sprachausgabe ist eingerichtet – Cozy Shelves kann jetzt vorlesen." % (time.time() - t0))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit as e:
        if e.code not in (0, None):
            say("\n%s" % e)
        raise
    except KeyboardInterrupt:
        say("\nAbgebrochen.")
        sys.exit(130)
