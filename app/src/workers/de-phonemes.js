// German text → phoneme sentences for the two German workers (Piper and Kokoro "Martin").
//
// espeak-ng (espeak-ng.js) gives the phonemes the voices were trained on. Only when it cannot be loaded (vendor files
// missing, wasm refused) the built-in rules of piper-de.js take over, mapped onto espeak-ng's symbols. The first call
// loads espeak-ng (about 0.9 MB of data, ~50 ms); every later call takes about a millisecond per sentence.
import { loadEspeak } from './espeak-ng.js';
import { normalizeGermanText, germanPhonemesEspeakStyle } from './piper-de.js';

let espeakPromise = null;
let espeakError = null;

/** Starts loading espeak-ng (idempotent). Resolves to the phonemizer or null. */
export function warmEspeak(appBaseUrl) {
  if (!espeakPromise) {
    espeakPromise = loadEspeak(appBaseUrl).catch((e) => {
      espeakError = e?.message || String(e);
      console.warn('[tts] espeak-ng is not available, the built-in German rules are used instead:', espeakError);
      return null;
    });
  }
  return espeakPromise;
}

/** 'espeak' | 'rules' | null (not loaded yet) */
export function phonemizerKind() {
  if (!espeakPromise) return null;
  return espeakError ? 'rules' : 'espeak';
}

/**
 * @param {string} text
 * @param {string} appBaseUrl  URL of app/ (…/app/)
 * @returns {Promise<{ norm: string, sentences: string[], source: 'espeak'|'rules' }>}
 *   norm = the normalised text, sentences = one phoneme string per espeak-ng sentence (NFD, Piper's form)
 */
export async function germanSentences(text, appBaseUrl) {
  const norm = normalizeGermanText(text);
  const espeak = await warmEspeak(appBaseUrl);
  if (espeak) {
    try { return { norm, sentences: (await espeak.phonemize([norm]))[0], source: 'espeak' }; }
    catch (e) { console.warn('[tts] espeak-ng failed, rules used for this sentence:', e?.message || e); }
  }
  const ph = germanPhonemesEspeakStyle(text);
  return { norm, sentences: ph ? [ph] : [], source: 'rules' };
}
