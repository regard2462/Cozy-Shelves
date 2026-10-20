// "Vorlesen" button for panels that read a whole text aloud (newspaper article, encyclopedia page).
// The button shows what the speech output is doing: preparing or downloading a voice (with the progress
// message of the TTS client), speaking (a click stops it) or idle. dispose() stops a reading that is still
// running, so closing the panel never leaves a voice talking without any control. Before a voice is downloaded for
// the first time (a German voice of 20 to 311 MB, the English model), the button asks: a second click starts the
// download. The arrow next to it (or a right click on the button) opens the voice menu (tts-voice-menu.js).
import { h, clear } from '../../core/dom.js';
import { tr } from '../../core/i18n.js';
import { bus } from '../../core/bus.js';
import { api } from '../../core/api.js';
import { ttsClient } from './tts-client.js';
import { planLanguages } from './tts-lang.js';
import { openVoiceMenu } from './tts-voice-menu.js';

/**
 * @param {{ getText: () => string, getLang?: () => string, toast?: (msg: string) => void, className?: string, openSettings?: () => void }} opts
 * @returns {{ el: HTMLElement, dispose: () => void, stop: () => void }}
 */
export function readAloudButton({ getText, getLang, toast, className = 'btn.small', openSettings }) {
  let session = null;
  let speaking = false;
  let message = '';
  let offer = null, offerTimer = null;   // { name, mb, lang } while the button asks before a voice download
  let pausedShown = false;               // a film or a podcast paused the reading (media/focus.js)
  let langMode = 'auto';                 // the voice menu: automatic, or German/English for this text
  let speedNow = 1;
  const btn = h('button.' + className + '.tts-btn', { type: 'button', onclick: () => (session ? (session.paused ? resume() : stop()) : offer ? confirm() : request()) });
  const more = h('button.' + className + '.tts-btn-more', { type: 'button', 'aria-haspopup': 'dialog', onclick: () => openMenu() }, '▾');
  const el = h('span.tts-btn-group', btn, more);
  btn.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(); });

  function paint() {
    clear(btn);
    pausedShown = !!session?.paused;
    btn.classList.toggle('active', !!session);
    btn.classList.toggle('offer', !!offer && !session);
    more.title = tr({ de: 'Stimme und Tempo', en: 'Voice and speed' });
    more.setAttribute('aria-label', more.title);
    if (offer && !session) {
      btn.append('⇩ ', tr({ de: 'Stimme laden ({mb} MB) und vorlesen', en: 'Download the voice ({mb} MB) and read' }, { mb: offer.mb }));
      btn.title = offer.lang === 'en'
        ? tr({ de: 'Die englische Stimme wird einmal heruntergeladen und arbeitet danach ohne Internet.', en: 'The English voice is downloaded once and then works offline.' })
        : tr({ de: 'Die deutsche Stimme {v} wird einmal heruntergeladen und arbeitet danach ohne Internet.', en: 'The German voice {v} is downloaded once and then works offline.' }, { v: offer.name });
    } else if (!session) {
      btn.append('🔈 ', tr({ de: 'Vorlesen', en: 'Read aloud' }));
      btn.title = tr({ de: 'Den Text vorlesen lassen', en: 'Have the text read aloud' });
    } else if (session.paused) {
      btn.append('▶ ', tr({ de: 'Weiter vorlesen', en: 'Resume reading' }));
      btn.title = tr({ de: 'Das Vorlesen geht dort weiter, wo es angehalten wurde', en: 'Reading goes on where it stopped' });
    } else if (!speaking) {
      btn.append(h('span.tts-btn-spin'), ' ', short(message) || tr({ de: 'Stimme wird vorbereitet …', en: 'Preparing the voice …' }));
      btn.title = tr({ de: 'Klicken bricht das Vorlesen ab', en: 'Click to cancel' });
    } else {
      btn.append('■ ', tr({ de: 'Vorlesen beenden', en: 'Stop reading' }));
      btn.title = tr({ de: 'Vorlesen beenden', en: 'Stop reading' });
    }
  }
  // "Lade Stimme Thorsten (mittel) … 12 / 60 MB" → "12 / 60 MB": the button stays small
  const short = (m) => { const mb = /(\d+\s*\/\s*\d+\s*MB)/.exec(m || ''); return mb ? tr({ de: 'Stimme lädt {p}', en: 'Voice loading {p}' }, { p: mb[1] }) : ''; };

  /** The language the text is mostly in: chosen in the menu, else from its paragraphs (the page language as a hint). */
  function baseLang(text) {
    if (langMode === 'de' || langMode === 'en') return langMode;
    const paras = String(text || '').split(/\n\s*\n/).filter((p) => p.trim());
    return planLanguages(paras.length ? paras : [String(text || '')], { meta: getLang?.(), ui: document.documentElement.lang }).base;
  }

  /** A voice that is not on this computer yet: first ask (the button changes), else read. */
  async function request() {
    const text = String(getText?.() || '').trim();
    if (!text) return;
    let missing = null;
    if (typeof ttsClient.missingVoice === 'function') { try { missing = await ttsClient.missingVoice(baseLang(text.slice(0, 6000))); } catch { missing = null; } }
    if (!missing) { start(); return; }
    offer = { name: missing.name, mb: Math.max(1, Math.round((missing.bytes || 0) / 1048576)), lang: missing.lang };
    clearTimeout(offerTimer);
    offerTimer = setTimeout(() => { offer = null; paint(); }, 12000);
    paint();
  }
  function confirm() { clearTimeout(offerTimer); offer = null; start(); }

  function start() {
    const text = String(getText?.() || '').trim();
    if (!text) return;
    speaking = false; message = '';
    const lang = getLang?.();
    const fixed = langMode === 'de' || langMode === 'en' ? langMode : null;
    const mine = ttsClient.speakText(text, {
      lang: fixed || (lang === 'de' || lang === 'en' ? lang : 'auto'), force: !!fixed,
      onSentence: () => { if (session === mine && !speaking) { speaking = true; paint(); } },
      onStatus: (st) => { if (session === mine && !speaking && st?.message !== message) { message = st?.message || ''; paint(); } },
      onEnd: () => { if (session === mine) { session = null; paint(); } },
      onError: (e) => { if (session === mine) { session = null; paint(); toast?.(tr({ de: 'Vorlesen nicht möglich: {m}', en: 'Read-aloud failed: {m}' }, { m: e?.message || e })); } },
    });
    session = mine;
    paint();
  }
  function stop() { const s = session; session = null; speaking = false; try { s?.stop(); } catch {} paint(); }
  function resume() { try { session?.resume(); } catch {} paint(); }

  function openMenu() {
    const detected = () => baseLang(String(getText?.() || '').slice(0, 4000));
    openVoiceMenu({
      anchor: more,
      current: () => (session ? (session.lang === 'en' ? 'en' : 'de') : detected()),
      langMode: {
        get: () => langMode,
        // another language for this text: a reading that runs starts again with it
        set: (mode) => { langMode = mode === 'de' || mode === 'en' ? mode : 'auto'; if (session) { stop(); start(); } },
        detected,
      },
      speed: { get: () => speedNow, set: (v) => { speedNow = v; api.settings.set({ tts: { speed: v } }).catch(() => {}); } },
      openSettings,
    });
  }
  api.settings.get().then((s) => { speedNow = Number(s?.tts?.speed) || 1; }).catch(() => {});

  // another reading (reader, other panel) stops ours without calling onEnd, a film or a podcast pauses it:
  // follow the client's state
  const offStatus = bus.on('tts:status', () => {
    if (session && session.stopped) { session = null; speaking = false; paint(); }
    else if (session && session.paused !== pausedShown) paint();
  });
  const offLang = bus.on('i18n:change', paint);
  paint();
  return { el, stop, dispose() { clearTimeout(offerTimer); offer = null; offStatus(); offLang(); stop(); } };
}
