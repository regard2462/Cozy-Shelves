// Read-aloud for the reader mode: the article's sentences (with their DOM ranges, from the current page on) go
// to the app's TTS client (German: Piper/Kokoro voices, English: Kokoro); the spoken sentence is highlighted and
// the reader turns the page when the voice reaches the next one.
// A German voice that is not on disk yet is never downloaded behind the user's back: the bar names the voice and
// its size and offers "Laden und vorlesen" (or the voice settings). During the download it shows the progress.
// Every paragraph is read in its own language (the lang of the page decides only text that says nothing clear), and
// the voice menu (tts-voice-menu.js) is at the voice button of the bar, a right click on the icon or Shift+V.
import { h, clear } from '../../core/dom.js';
import { bus } from '../../core/bus.js';
import { ttsClient, DEFAULT_GERMAN_VOICE, engineForVoice } from '../reader/tts-client.js';
import { planLanguages } from '../reader/tts-lang.js';
import { openVoiceMenu, closeVoiceMenu, voiceMenuOpen } from '../reader/tts-voice-menu.js';
import { icon } from './icons.js';

const SPEEDS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75];
const BLOCK = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, dd, dt, td, th, figcaption, pre, div';

export function createReadAloud(B) {
  const T = B.T;
  const bar = h('div.br-tts', { hidden: true, role: 'region', 'aria-label': T('Vorlesen', 'Read aloud') });
  let session = null, list = [], idx = -1, active = false, paused = false, status = '', error = null, offer = null, voiceId = null, lang = 'auto';
  let langMode = 'auto';    // the menu: 'auto' or German/English for the page that is read now
  let names = new Map();     // voice id → name, for the voice button

  function describe(s) {
    if (!s) return '';
    const p = s.piperDetail;
    if (p && p.state === 'loading' && typeof p.progress === 'number' && p.progress > 0 && p.progress < 1) {
      return T('Stimme wird geladen … {p} %', 'Loading the voice … {p} %', { p: Math.round(p.progress * 100) });
    }
    return s.message || '';
  }

  /** The German voice to use: the one chosen in the settings, else one on disk, else an offer to load one. */
  async function chooseVoice(language) {
    if (language === 'en') {
      // the English model is not on this computer: asked first, like a German voice
      let missing = null;
      try { missing = await ttsClient.missingVoice('en'); } catch { missing = null; }
      return missing ? { offer: missing } : { voice: undefined };
    }
    let s = null;
    try { s = await ttsClient.status(); } catch { s = null; }
    const chosen = B.ctx.state?.settings?.tts?.germanVoice || '';
    const engine = engineForVoice(chosen);
    // the voice of the settings: not passed on, so that a voice chosen in the menu takes over at the next sentence
    if (engine === 'piper' || engine === 'kokoro-de') {
      const v = (s?.piperDetail?.voices || []).find((x) => x.id === chosen);
      if (!v || v.installed) return { voice: undefined };
    }
    if (engine === 'kartoffelbox' && s?.germanDetail?.available) return { voice: undefined };
    const voices = s?.piperDetail?.voices || [];
    const have = voices.filter((v) => v.installed);
    if (have.length) return { voice: (have.find((v) => v.id === DEFAULT_GERMAN_VOICE) || have[0]).id };
    if (engine === 'piper' || engine === 'kokoro-de') return { offer: voices.find((v) => v.id === chosen) || { id: chosen, name: chosen, bytes: 0 } };
    return { offer: voices.find((v) => v.id === DEFAULT_GERMAN_VOICE) || { id: DEFAULT_GERMAN_VOICE, name: 'Martin (Kokoro)', bytes: 326035136 } };
  }

  /** The language of every sentence: by its paragraph (the closest block element), the page language as a hint. */
  function planFor(items) {
    if (langMode === 'de' || langMode === 'en') return { base: langMode, langs: items.map(() => langMode) };
    const paras = [], at = new Map();
    const keyOf = (s) => s.range?.startContainer?.parentElement?.closest?.(BLOCK) || s;
    for (const s of items) { const k = keyOf(s); if (!at.has(k)) { at.set(k, paras.length); paras.push(''); } paras[at.get(k)] += s.text + ' '; }
    const res = planLanguages(paras, { meta: B.reader.article?.lang, ui: B.ctx.state?.settings?.language });
    return { base: res.base, langs: items.map((s) => res.langs[at.get(keyOf(s))] || res.base) };
  }

  async function start({ voice, english = false } = {}) {
    stop(true);
    const ok = await B.ensureReader();
    if (!ok) return false;
    list = B.reader.sentences({ fromCurrent: true });
    if (!list.length) list = B.reader.sentences({ fromCurrent: false });
    if (!list.length) { B.toast(T('Kein Text zum Vorlesen gefunden.', 'No text to read aloud.')); return false; }
    const plan = planFor(list);
    lang = plan.base;
    list.forEach((s, i) => { s.lang = plan.langs[i]; });
    active = true; paused = false; error = null; offer = null; idx = -1;
    status = T('Die Stimme wird vorbereitet …', 'Preparing the voice …');
    render();
    ttsClient.voices('de').then((v) => { names = new Map(v.map((x) => [x.id, String(x.plainName || x.name || x.id)])); render(); }).catch(() => {});
    let pick = voice ? { voice } : english ? { voice: undefined } : await chooseVoice(lang);
    if (!active) return false;
    if (pick.offer) { active = false; offer = pick.offer; render(); return false; }
    voiceId = pick.voice || null;
    speakFrom(list);
    B.onTtsChange?.(true);
    return true;
  }

  function speakFrom(items) {
    list = items; idx = -1;
    const mine = ttsClient.speak(list.map((s) => s.text), {
      lang, langs: list.map((s) => s.lang || lang), voice: voiceId || undefined, speed: B.prefs.ttsSpeed,
      onSentence: (i) => { if (session !== mine) return; idx = i; status = ''; B.reader.speak(list[i]?.range); render(); },
      onEnd: () => { if (session !== mine) return; stop(true); B.toast(T('Ende des Textes.', 'End of the text.')); },
      onError: (e) => { if (session !== mine) return; fail(e); },
      onStatus: (s) => {
        if (session !== mine || !active) return;
        // a film or a podcast that started paused the reading (media/focus.js): the bar offers to resume
        if (mine.paused && !paused) { paused = true; render(); return; }
        const d = describe(s); if (d && idx < 0) { status = d; render(); }
      },
    });
    session = mine;
    render();
  }

  function fail(e) {
    const msg = String(e?.message || e || '').trim();
    session = null; active = false; paused = false;
    B.reader.clearSpeech();
    error = msg || T('Unbekannter Fehler', 'Unknown error');
    render();
    B.onTtsChange?.(false);
  }

  function pause() { if (!session || paused) return; paused = true; try { session.pause(); } catch {} render(); }
  function resume() { if (!session || !paused) return; paused = false; try { session.resume(); } catch {} render(); }
  function toggle() { if (!active) return start(); if (paused) resume(); else pause(); return true; }
  function skip(d) { if (!session) return; try { session.skip(d); } catch {} }

  /** quiet: no bar left behind (tab switch, panel closed, Escape). */
  function stop(quiet) {
    const had = active || !!session || !!error || !!offer;
    const s = session;
    session = null; active = false; paused = false; idx = -1; status = '';
    if (quiet) { error = null; offer = null; }
    try { s?.stop(); } catch {}
    B.reader?.clearSpeech();
    render();
    if (had) B.onTtsChange?.(false);
  }

  /** The new speed from the next sentence on (the browser keeps its own speed, B.prefs.ttsSpeed). */
  function setSpeed(v) {
    B.setPrefs({ ttsSpeed: v });
    if (session) { try { session.update({ speed: v }); } catch {} }
    render();
  }
  /** German or English for this page, or automatic again: the reading goes on from the sentence that sounds now. */
  function setLangMode(mode) {
    langMode = mode === 'de' || mode === 'en' ? mode : 'auto';
    if (!active || !session || idx < 0) return;
    const rest = list.slice(idx);
    const plan = planFor(rest);
    lang = plan.base;
    rest.forEach((s, i) => { s.lang = plan.langs[i]; });
    const old = session; session = null;
    try { old?.stop(); } catch {}
    paused = false;
    speakFrom(rest);
  }
  function openMenu(anchor) {
    return openVoiceMenu({
      anchor: anchor || bar.querySelector('.br-tts-voicebtn') || bar,
      current: () => (idx >= 0 && list[idx]?.lang) || (lang === 'en' ? 'en' : 'de'),
      langMode: { get: () => langMode, set: setLangMode, detected: () => (idx >= 0 && list[idx]?.lang) || (lang === 'en' ? 'en' : 'de') },
      speed: { get: () => B.prefs.ttsSpeed || 1, set: setSpeed },
      onVoice: () => onVoiceChosen(),
      openSettings: () => { stop(true); B.ctx.openPanel?.('settings', { section: 'tts' }); },
      onClose: () => render(),
    });
  }
  // the voice of the settings changed in the menu: a fallback voice of this reading gives way to it
  function onVoiceChosen() { if (session && voiceId) { voiceId = null; try { session.update({ voice: undefined }); } catch {} } render(); }
  const closeMenu = () => { if (!voiceMenuOpen()) return false; closeVoiceMenu(); return true; };

  function voiceLabel() {
    const t = B.ctx.state?.settings?.tts || {};
    const cur = (idx >= 0 && list[idx]?.lang) || lang;
    if (cur === 'en') { const v = ttsClient.englishVoices().find((x) => x.id === (t.englishVoice || 'af_heart')); return v ? v.name.replace(/\s*\(.*\)$/, '') : 'Kokoro'; }
    const id = voiceId || t.germanVoice || DEFAULT_GERMAN_VOICE;
    return names.get(id) || id.replace(/^de_DE-/, '').replace(/[-_]/g, ' ');
  }

  function render() {
    clear(bar);
    bar.hidden = !active && !error && !offer;
    if (bar.hidden) return;
    const btn = (name, label, fn, cls = '') => h('button.br-ibtn' + cls, { type: 'button', title: label, 'aria-label': label, onclick: fn, html: icon(name) });
    const settingsBtn = h('button.br-btn.small', { type: 'button', onclick: () => { stop(true); B.ctx.openPanel?.('settings', { section: 'tts' }); } }, T('Stimmen einrichten', 'Set up voices'));
    if (offer) {
      const mb = Math.max(1, Math.round((offer.bytes || 0) / 1048576));
      bar.append(
        h('span.br-tts-ico', { html: icon('speak') }),
        h('span.br-tts-status.wrap', offer.lang === 'en'
          ? T('Zum Vorlesen fehlt die englische Stimme. Sie wird dafür einmalig geladen ({mb} MB).', 'Reading aloud needs the English voice. It is downloaded once for it ({mb} MB).', { mb })
          : T('Zum Vorlesen fehlt eine deutsche Stimme. {n} ({mb} MB) wird dafür einmalig geladen.', 'Reading aloud needs a German voice. {n} ({mb} MB) is downloaded once for it.', { n: String(offer.name || 'Martin').replace(/\s*\(.*\)$/, ''), mb })),
        h('button.br-btn.small.primary', { type: 'button', onclick: () => { const o = offer; offer = null; start(o.lang === 'en' ? { english: true } : { voice: o.id }); } }, T('Laden und vorlesen', 'Download and read')),
        settingsBtn,
        btn('close', T('Schließen', 'Close'), () => stop(true)));
      return;
    }
    if (error) {
      bar.append(
        h('span.br-tts-ico', { html: icon('speak') }),
        h('span.br-tts-status.err', T('Vorlesen nicht möglich: {m}', 'Read-aloud failed: {m}', { m: error })),
        settingsBtn,
        btn('close', T('Schließen', 'Close'), () => stop(true)));
      return;
    }
    const cur = idx >= 0 ? list[idx]?.text || '' : '';
    const curLang = idx >= 0 ? list[idx]?.lang : null;
    bar.append(...[
      h('span.br-tts-ico', { html: icon('speak') }),
      btn('skipBack', T('Vorheriger Satz', 'Previous sentence'), () => skip(-1)),
      btn(paused ? 'play' : 'pause', paused ? T('Weiter vorlesen', 'Resume') : T('Pause', 'Pause'), () => (paused ? resume() : pause()), '.main'),
      btn('skipFwd', T('Nächster Satz', 'Next sentence'), () => skip(1)),
      btn('stop', T('Vorlesen beenden', 'Stop reading'), () => stop(true)),
      h('select.br-select.br-tts-speed', { title: T('Tempo', 'Speed'), 'aria-label': T('Tempo', 'Speed'), onchange: (e) => setSpeed(parseFloat(e.target.value)) },
        SPEEDS.map((v) => h('option', { value: String(v), selected: Math.abs(v - B.prefs.ttsSpeed) < 0.01 }, String(v).replace('.', B.lang === 'en' ? '.' : ',') + '×'))),
      h('button.br-btn.small.br-tts-voicebtn', { type: 'button', title: T('Stimme und Tempo (Umschalt+V)', 'Voice and speed (Shift+V)'), 'aria-haspopup': 'dialog', onclick: (e) => openMenu(e.currentTarget) },
        voiceLabel(), h('span', { 'aria-hidden': 'true' }, '▾')),
      h('span.br-tts-status', status || (idx >= 0 ? T('Satz {a} von {b}', 'Sentence {a} of {b}', { a: idx + 1, b: list.length }) : ''), curLang ? ' · ' + curLang.toUpperCase() : ''),
      cur ? h('span.br-tts-text', cur.length > 110 ? cur.slice(0, 108) + ' …' : cur) : null].filter(Boolean));
  }

  // the language of the interface: the bar in it at once (texts, the names of the voices)
  const offLang = bus.on('i18n:change', () => {
    if (active) ttsClient.voices('de').then((v) => { names = new Map(v.map((x) => [x.id, String(x.plainName || x.name || x.id)])); render(); }).catch(() => {});
    render();
  });

  return {
    destroy() { try { offLang(); } catch {} closeMenu(); },
    el: bar, start, stop, toggle, pause, resume, skip, openMenu, closeMenu, onVoiceChosen,
    get active() { return active; },
    get paused() { return paused; },
    get index() { return idx; },
    get total() { return list.length; },
    get error() { return error; },
    get offer() { return offer; },
    get voice() { return voiceId; },
    get session() { return session; },
    get langs() { return list.map((s) => s.lang); },
    get langMode() { return langMode; },
  };
}
