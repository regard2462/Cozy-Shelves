// Voice ids of the read-aloud engines. No browser dependency: tts-client.js imports this module, and so does the
// Node test electron/tts/test-tts.js.
// Martin (Kokoro) since 0.6: the most intelligible German voice and on WebGPU faster than real time (docs/TTS.md)
export const DEFAULT_GERMAN_VOICE = 'de_DE-martin-kokoro';
export const KOKORO_DE_VOICE = 'de_DE-martin-kokoro';
export const KARTOFFEL_PREFIX = 'kartoffelbox:';
/** The German engines in catalogue order. */
export const GERMAN_ENGINES = ['piper', 'kokoro-de', 'kartoffelbox'];

/** Which engine has to speak this voice id? */
export function engineForVoice(id) {
  const v = String(id || '');
  if (!v) return null;
  if (/^[ab][fm]_[a-z]+$/.test(v)) return 'kokoro';          // af_heart, bm_george …
  if (v.startsWith(KARTOFFEL_PREFIX) || v === 'default' || v === 'builtin' || /[\\/]/.test(v)) return 'kartoffelbox';
  if (/-kokoro$/.test(v)) return 'kokoro-de';               // de_DE-martin-kokoro
  if (/^[a-z]{2}_[A-Z]{2}-/.test(v)) return 'piper';
  return null;
}

/**
 * The German voice for the stored setting tts.germanVoice. Builds up to 0.2 stored 'default' or 'builtin' for
 * Kartoffelbox, which the local voices replaced: those values, an empty one and the id of an English voice all
 * mean the default voice. Kartoffelbox speaks only when it was chosen explicitly ('kartoffelbox:…').
 */
export function resolveGermanVoice(id) {
  const v = String(id || '');
  if (!v || v === 'default' || v === 'builtin') return DEFAULT_GERMAN_VOICE;
  return GERMAN_ENGINES.includes(engineForVoice(v)) ? v : DEFAULT_GERMAN_VOICE;
}
