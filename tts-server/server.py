#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Cozy Shelves – deutscher TTS-Sidecar (Kartoffelbox = deutsches Fine-Tuning von Resemble AI's Chatterbox).

Wird von electron/tts/sidecar.js gestartet:  python server.py --port 0 --model turbo|v0.1 [--device auto|cuda|cpu]
Protokoll auf stdout (jeweils eine Zeile, sofort geflusht):
    PORT=<port>        gewählter TCP-Port (bei --port 0 ein freier Port)
    STATUS=<text>      Fortschrittsmeldung während des Ladens
    MODEL=<name>       DEVICE=<cuda|cpu|fake>
    READY              Server nimmt Anfragen an
Alle Logs gehen nach stderr.

HTTP-API (nur 127.0.0.1):
    GET  /health  → {"ok": true, "model": "turbo", "device": "cuda", "sampleRate": 24000, "defaultPrompt": "...", "builtinVoice": true}
    POST /tts     {"text": "...", "voice_prompt": "C:/…/stimme.wav" | null, "exaggeration": 0.5, "cfg_weight": 0.5,
                   "temperature": 0.8}
                  (Chatterbox kennt keinen Geschwindigkeitsparameter; der Client regelt das Tempo über
                   playbackRate – "speed" wird deshalb nicht mehr gesendet und nicht mehr dokumentiert)
                  → {"sampleRate": 24000, "pcm": "<base64 16-bit little-endian PCM mono>", "seconds": 3.2}
    POST /shutdown

Weitere Aufrufe:
    python server.py --fake --port 0            Platzhalter-Sinuston statt Modell (Diagnose/Tests, braucht kein torch)
    python server.py --selftest [--model …]     Modell laden + einen Satz synthetisieren (lädt die Gewichte herunter)
    python server.py --make-default-prompt      erzeugt voices/default_de.wav mit der eingebauten Stimme des v0.1-Modells
                                                (Referenzstimme für das Turbo-Modell, falls dieses keine eingebaute hat)
"""
import argparse
import base64
import inspect
import json
import math
import os
import re
import struct
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
VOICES_DIR = os.path.join(HERE, "voices")
DEFAULT_PROMPT = os.path.join(VOICES_DIR, "default_de.wav")
DEFAULT_PROMPT_TEXT = (
    "Guten Abend und herzlich willkommen in Cozy Shelves. Hier werden Bücher, Zeitungen und Artikel in Ruhe vorgelesen, "
    "während draußen der Regen an die Fenster klopft und im Kamin ein Feuer knistert."
)
REPO_V01 = "SebastianBodza/Kartoffelbox-v0.1"
REPO_TURBO = "SebastianBodza/Kartoffelbox_Turbo"
SR_FALLBACK = 24000


def log(*args):
    print(*args, file=sys.stderr, flush=True)


def out(line):
    print(line, flush=True)


# ----------------------------------------------------------------------------------------------------------------------
# text helpers
# ----------------------------------------------------------------------------------------------------------------------
_ABBR = {"z", "b", "u", "a", "d", "h", "bzw", "usw", "etc", "ca", "dr", "prof", "nr", "hr", "fr", "st", "vgl", "evtl",
         "ggf", "jh", "bd", "s", "abs", "art", "mio", "mrd", "inkl", "zzgl", "sog", "geb", "gest", "std", "min", "tel",
         "str", "hrsg", "kap", "abb", "tab", "anm", "mr", "mrs", "ms", "vs", "jr", "sr", "e", "g", "i", "o", "ä"}


def split_sentences(text, max_len=350):
    """Grobe Satztrennung für lange Eingaben (der Client schickt normalerweise einzelne Sätze)."""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= max_len:
        return [text] if text else []
    parts, start = [], 0
    for m in re.finditer(r"([.!?…]+)([\"'“”„»«)\]]*)(?=\s|$)", text):
        end = m.end()
        before = text[start:m.start()]
        last = re.search(r"(\S+)$", before)
        last = (last.group(1) if last else "").strip("\"'“”„»«()[]").lower().rstrip(".")
        nxt = text[end:].lstrip()[:1]
        if nxt and nxt.islower():
            continue
        if m.group(1) == "." and (last in _ABBR or len(last) == 1 or (last.isdigit() and len(last) <= 2)):
            continue
        seg = text[start:end].strip()
        if seg:
            parts.append(seg)
        start = end
    tail = text[start:].strip()
    if tail:
        parts.append(tail)
    # Sätze, die immer noch zu lang sind, an Kommas teilen
    result = []
    for p in parts:
        while len(p) > max_len:
            cut = max(p.rfind(", ", 0, max_len), p.rfind("; ", 0, max_len), p.rfind(" ", 0, max_len))
            if cut < max_len * 0.3:
                cut = max_len
            result.append(p[:cut + 1].strip())
            p = p[cut + 1:].strip()
        if p:
            result.append(p)
    return result


def normalize_text(text):
    text = text.replace("\u00ad", "")
    text = re.sub(r"[\u0000-\u0008\u000b-\u001f\u007f]", " ", text)
    text = text.replace("„", '"').replace("“", '"').replace("”", '"').replace("»", '"').replace("«", '"')
    text = text.replace("‚", "'").replace("‘", "'").replace("’", "'")
    text = text.replace("–", "-").replace("—", "-").replace("…", "...")
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ----------------------------------------------------------------------------------------------------------------------
# engines
# ----------------------------------------------------------------------------------------------------------------------
class FakeEngine:
    """Sinus-Platzhalter: Länge proportional zur Textlänge. Braucht kein torch."""
    name = "fake"
    device = "fake"
    sr = SR_FALLBACK
    builtin_voice = True

    def load(self):
        out("STATUS=Fake-Engine (Sinuston) aktiv")

    def synth(self, text, **kw):
        secs = min(6.0, max(0.3, len(text) * 0.045))
        n = int(self.sr * secs)
        f = 160.0 + (sum(map(ord, text)) % 9) * 25.0
        pcm = bytearray()
        for i in range(n):
            env = min(1.0, i / 600.0, (n - i) / 600.0)
            v = math.sin(2 * math.pi * f * i / self.sr) * 0.3 * env
            pcm += struct.pack("<h", int(v * 32767))
        return bytes(pcm), self.sr


class KartoffelboxEngine:
    def __init__(self, model="turbo", device="auto"):
        self.name = "turbo" if model == "turbo" else "v0.1"
        self.requested_device = device
        self.device = None
        self.model = None
        self.sr = SR_FALLBACK
        self.builtin_voice = False
        self._gen_params = set()
        self.torch = None
        self._builtin_conds = None
        self._last_prompt = object()  # sentinel: no prompt prepared yet

    # -- loading -------------------------------------------------------------------------------------------------------
    def _pick_device(self):
        import torch
        self.torch = torch
        if self.requested_device and self.requested_device != "auto":
            return self.requested_device
        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
            return "mps"
        return "cpu"

    def load(self):
        t0 = time.time()
        out("STATUS=Lade PyTorch …")
        self.device = self._pick_device()
        out("DEVICE=" + self.device)
        if self.device == "cpu":
            log("[tts] WARNUNG: keine CUDA-GPU gefunden – Synthese auf der CPU ist sehr langsam.")
        from huggingface_hub import hf_hub_download
        if self.name == "turbo":
            out("STATUS=Lade Chatterbox-Turbo-Basismodell (erster Start: Download von huggingface.co) …")
            from chatterbox.tts_turbo import ChatterboxTurboTTS
            self.model = ChatterboxTurboTTS.from_pretrained(device=self.device)
            out("STATUS=Lade Kartoffelbox-Turbo-Gewichte …")
            path = hf_hub_download(REPO_TURBO, "model.pt")
            sd = self._load_torch(path)
            self._apply_state_dict(sd)
        else:
            out("STATUS=Lade Chatterbox-Basismodell (erster Start: Download von huggingface.co) …")
            from chatterbox.tts import ChatterboxTTS
            self.model = ChatterboxTTS.from_pretrained(device=self.device)
            out("STATUS=Lade Kartoffelbox-v0.1-Gewichte …")
            from safetensors.torch import load_file
            path = hf_hub_download(REPO_V01, "t3_cfg.safetensors")
            sd = load_file(path)
            self._apply_state_dict(sd)
        self.sr = int(getattr(self.model, "sr", SR_FALLBACK))
        self.builtin_voice = getattr(self.model, "conds", None) is not None
        self._builtin_conds = getattr(self.model, "conds", None)
        try:
            self._gen_params = set(inspect.signature(self.model.generate).parameters.keys())
        except Exception:
            self._gen_params = set()
        try:
            self.model.t3.eval()
        except Exception:
            pass
        out("MODEL=" + self.name)
        log(f"[tts] Modell {self.name} geladen auf {self.device} in {time.time() - t0:.1f} s; eingebaute Stimme: {self.builtin_voice}; generate(): {sorted(self._gen_params)}")

    def _load_torch(self, path):
        torch = self.torch
        try:
            sd = torch.load(path, map_location="cpu", weights_only=True)
        except Exception as e:
            log("[tts] torch.load(weights_only=True) fehlgeschlagen, versuche weights_only=False:", e)
            sd = torch.load(path, map_location="cpu", weights_only=False)
        for key in ("state_dict", "model", "t3", "module"):
            if isinstance(sd, dict) and key in sd and isinstance(sd[key], dict) and len(sd) <= 3:
                sd = sd[key]
        return sd

    def _apply_state_dict(self, sd):
        """Lädt die Fine-Tuning-Gewichte in model.t3; entfernt Präfixe wie '_orig_mod.' (torch.compile) oder 'module.'."""
        def strip(k):
            for pre in ("_orig_mod.", "module.", "t3.", "model."):
                while k.startswith(pre):
                    k = k[len(pre):]
            return k
        cleaned = {strip(k): v for k, v in sd.items()}
        t3 = self.model.t3
        try:
            t3.load_state_dict(cleaned, strict=True)
            log(f"[tts] {len(cleaned)} Tensoren strikt geladen")
            return
        except Exception as e:
            log("[tts] striktes Laden fehlgeschlagen, versuche strict=False:", str(e)[:300])
        res = t3.load_state_dict(cleaned, strict=False)
        missing = list(getattr(res, "missing_keys", []))
        unexpected = list(getattr(res, "unexpected_keys", []))
        log(f"[tts] geladen mit strict=False – fehlend: {len(missing)}, unerwartet: {len(unexpected)}")
        if missing:
            log("[tts] fehlende Schlüssel (Auszug):", missing[:8])
        if unexpected:
            log("[tts] unerwartete Schlüssel (Auszug):", unexpected[:8])
        try:
            total = len(t3.state_dict())
        except Exception:
            total = len(cleaned)
        if missing and len(missing) > max(2, total // 2):
            raise RuntimeError("Kartoffelbox-Gewichte passen nicht zum Chatterbox-Modell (zu viele fehlende Schlüssel) – "
                               "bitte chatterbox-tts aktualisieren (pip install -U chatterbox-tts)")
        try:
            t3.to(self.device)
        except Exception:
            pass

    # -- synthesis -----------------------------------------------------------------------------------------------------
    def synth(self, text, voice_prompt=None, exaggeration=None, cfg_weight=None, temperature=None, **_):
        torch = self.torch
        kw = {}
        prompt = voice_prompt if voice_prompt and os.path.exists(voice_prompt) else None
        if prompt is None and os.path.exists(DEFAULT_PROMPT):
            prompt = DEFAULT_PROMPT
        if prompt is None and not self.builtin_voice:
            raise RuntimeError("Das Turbo-Modell braucht eine Referenzstimme: bitte in den Einstellungen eine WAV-Datei "
                               "wählen oder 'python server.py --make-default-prompt' ausführen (erzeugt voices/default_de.wav).")
        # Referenzstimme nur neu berechnen, wenn sie sich geändert hat (prepare_conditionals ist teuer)
        if "audio_prompt_path" in self._gen_params:
            if prompt != self._last_prompt:
                if prompt:
                    kw["audio_prompt_path"] = prompt
                elif self._builtin_conds is not None:
                    self.model.conds = self._builtin_conds
                self._last_prompt = prompt
            elif prompt and getattr(self.model, "conds", None) is None:
                kw["audio_prompt_path"] = prompt
        if exaggeration is not None and "exaggeration" in self._gen_params:
            kw["exaggeration"] = float(exaggeration)
        if cfg_weight is not None and "cfg_weight" in self._gen_params:
            kw["cfg_weight"] = float(cfg_weight)
        if temperature is not None and "temperature" in self._gen_params:
            kw["temperature"] = float(temperature)
        try:
            with torch.inference_mode():
                wav = self.model.generate(text, **kw)
        except Exception:
            self._last_prompt = object()  # beim nächsten Aufruf Referenz neu vorbereiten
            raise
        if hasattr(wav, "detach"):
            wav = wav.detach().float().cpu()
            if wav.dim() > 1:
                wav = wav.reshape(-1) if wav.shape[0] == 1 else wav.mean(dim=0)
            arr = wav.clamp(-1.0, 1.0).mul(32767).round().to(torch.int16).numpy()
        else:
            import numpy as np
            arr = np.clip(np.asarray(wav, dtype="float32").reshape(-1), -1, 1)
            arr = (arr * 32767).round().astype("<i2")
        return arr.astype("<i2").tobytes(), self.sr


# ----------------------------------------------------------------------------------------------------------------------
# HTTP server
# ----------------------------------------------------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    engine = None
    lock = threading.Lock()
    server_version = "CozyShelvesTTS/1.0"

    def log_message(self, fmt, *args):  # quiet access log → stderr only for errors
        pass

    def _json(self, code, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/health"):
            e = self.engine
            return self._json(200, {
                "ok": True, "model": e.name, "device": e.device, "sampleRate": e.sr,
                "builtinVoice": bool(getattr(e, "builtin_voice", False)),
                "defaultPrompt": DEFAULT_PROMPT if os.path.exists(DEFAULT_PROMPT) else None,
                "fake": isinstance(e, FakeEngine),
            })
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path.startswith("/shutdown"):
            self._json(200, {"ok": True})
            threading.Thread(target=lambda: (time.sleep(0.2), os._exit(0)), daemon=True).start()
            return
        if not self.path.startswith("/tts"):
            return self._json(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        except Exception as e:
            return self._json(400, {"error": "ungültiges JSON: %s" % e})
        text = normalize_text(str(body.get("text") or ""))
        if not text:
            return self._json(200, {"sampleRate": self.engine.sr, "pcm": "", "seconds": 0})
        opts = {k: body.get(k) for k in ("voice_prompt", "exaggeration", "cfg_weight", "temperature")}
        t0 = time.time()
        try:
            with self.lock:  # GPU-Synthese seriell
                chunks = []
                sr = self.engine.sr
                gap = b"\x00\x00" * int(sr * 0.12)
                for i, sent in enumerate(split_sentences(text)):
                    pcm, sr = self.engine.synth(sent, **opts)
                    if i:
                        chunks.append(gap)
                    chunks.append(pcm)
            pcm = b"".join(chunks)
        except Exception as e:
            log("[tts] Synthese fehlgeschlagen:", repr(e))
            return self._json(500, {"error": "Synthese fehlgeschlagen: %s" % e})
        seconds = len(pcm) / 2 / sr
        log(f"[tts] {len(text)} Zeichen → {seconds:.1f} s Audio in {time.time() - t0:.1f} s")
        return self._json(200, {"sampleRate": sr, "pcm": base64.b64encode(pcm).decode("ascii"), "seconds": round(seconds, 3)})


def watch_stdin():
    """Beendet den Server, wenn der Elternprozess (Electron) stirbt und damit stdin schließt."""
    try:
        while True:
            data = sys.stdin.buffer.read(1024)
            if not data:
                break
    except Exception:
        pass
    log("[tts] stdin geschlossen – beende Server")
    os._exit(0)


def make_default_prompt(device, path=DEFAULT_PROMPT):
    """Erzeugt eine deutsche Referenzaufnahme mit der eingebauten Stimme des v0.1-Modells."""
    eng = KartoffelboxEngine(model="v0.1", device=device)
    eng.load()
    if not eng.builtin_voice:
        raise RuntimeError("Das v0.1-Modell hat keine eingebaute Stimme – bitte eine eigene WAV-Datei als Referenz wählen.")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pcm, sr = eng.synth(DEFAULT_PROMPT_TEXT, exaggeration=0.4, cfg_weight=0.5)
    import wave
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm)
    log(f"[tts] Referenzstimme gespeichert: {path} ({len(pcm) / 2 / sr:.1f} s)")
    return path


def main():
    ap = argparse.ArgumentParser(description="Cozy Shelves German TTS sidecar (Kartoffelbox)")
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--model", choices=["turbo", "v0.1"], default="turbo")
    ap.add_argument("--device", default="auto", help="auto|cuda|cpu|mps")
    ap.add_argument("--fake", action="store_true", help="Sinuston statt Modell (Tests, kein torch nötig)")
    ap.add_argument("--watch-stdin", action="store_true", help="beenden, wenn stdin geschlossen wird (vom Sidecar gesetzt)")
    ap.add_argument("--selftest", action="store_true", help="Modell laden, einen Satz synthetisieren, beenden")
    ap.add_argument("--make-default-prompt", action="store_true", help="voices/default_de.wav mit dem v0.1-Modell erzeugen")
    args = ap.parse_args()

    if args.make_default_prompt:
        make_default_prompt(args.device)
        return 0

    engine = FakeEngine() if args.fake else KartoffelboxEngine(model=args.model, device=args.device)
    try:
        engine.load()
    except Exception as e:
        log("[tts] Modell konnte nicht geladen werden:", repr(e))
        import traceback
        traceback.print_exc(file=sys.stderr)
        return 2

    if args.selftest:
        t0 = time.time()
        pcm, sr = engine.synth("Guten Tag! Dies ist ein kurzer Test der deutschen Sprachausgabe in Cozy Shelves.")
        log(f"[tts] Selbsttest OK: {len(pcm) / 2 / sr:.1f} s Audio in {time.time() - t0:.1f} s (Modell {engine.name}, {engine.device})")
        out("SELFTEST=OK")
        return 0

    Handler.engine = engine
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    httpd.daemon_threads = True
    port = httpd.server_address[1]
    out(f"PORT={port}")
    out("MODEL=" + engine.name)
    out("DEVICE=" + str(engine.device))
    out("READY")
    log(f"[tts] bereit auf http://{args.host}:{port} (Modell {engine.name}, {engine.device})")
    if args.watch_stdin:
        threading.Thread(target=watch_stdin, daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
