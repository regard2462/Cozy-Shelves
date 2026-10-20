// The small menu at the read-aloud icon: the German and the English voices with their state (on this computer, to
// download with its size, loading), the speed and "Sprache automatisch". A voice chosen here is saved like in the
// settings (tts.germanVoice / tts.englishVoice) and takes over from the next sentence of a reading that runs
// (tts-client.js retune). A voice that is not on this computer yet is downloaded first; the reading goes on with the
// old voice until the new one is there. Used by the reader (reader-tts.js), the reading browser (browser/tts.js) and
// the read-aloud button of the newspaper and the encyclopedia (tts-button.js).
//
// Keyboard: the arrow keys move between the entries, Enter or Space chooses, Escape closes (the focus goes back to
// the button that opened the menu). Opened with a click on the arrow next to the icon, a right click on the icon,
// or Shift+V in the reader and the reading browser.
import { h, clear } from '../../core/dom.js';
import { tr } from '../../core/i18n.js';
import { api } from '../../core/api.js';
import { bus } from '../../core/bus.js';
import { ttsClient } from './tts-client.js';

const SPEEDS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
const mb = (bytes) => Math.max(1, Math.round((bytes || 0) / 1048576));
const fmtSpeed = (v) => String(v).replace('.', tr({ de: ',', en: '.' })) + '×';
let openMenu = null;

/** Is a voice menu open? (Escape closes it before anything else.) */
export const voiceMenuOpen = () => !!openMenu;
export function closeVoiceMenu() { openMenu?.close(); }

/**
 * @param {{
 *   anchor: Element,
 *   langMode?: { get: () => 'auto'|'de'|'en', set: (mode: 'auto'|'de'|'en') => void, detected?: () => 'de'|'en' },
 *   speed?: { get: () => number, set: (v: number) => void },
 *   current?: () => 'de'|'en',
 *   onVoice?: (lang: 'de'|'en', id: string) => void,
 *   openSettings?: () => void,
 *   onClose?: () => void,
 * }} opts
 */
export function openVoiceMenu(opts) {
  if (openMenu?.anchor === opts.anchor) { openMenu.close(); return null; }
  openMenu?.close();
  const el = h('div.tts-menu', { role: 'dialog', 'aria-label': tr({ de: 'Stimme und Tempo', en: 'Voice and speed' }), tabindex: '-1' });
  let settings = {}, deVoices = [], enModel = { cached: null, bytes: 0 }, busy = new Map(), closed = false;
  const offs = [];

  const save = (patch) => api.settings.set({ tts: patch }).then((s) => { if (s) settings = s; }).catch(() => {});
  async function load() {
    try { settings = (await api.settings.get()) || {}; } catch { settings = {}; }
    try { deVoices = (await ttsClient.voices('de')).filter((v) => v.engine !== 'kartoffelbox' || v.id === settings.tts?.germanVoice); } catch { deVoices = []; }
    try { enModel = await ttsClient.englishModel(); } catch { enModel = { cached: null, bytes: 0 }; }
    if (!closed) render();
  }

  /** The German voice: chosen at once when it is on this computer, else downloaded first (the old one reads on). */
  async function chooseGerman(v) {
    if (v.installed || v.engine === 'kartoffelbox') { await save({ germanVoice: v.id }); opts.onVoice?.('de', v.id); render(); return; }
    if (busy.has(v.id)) { ttsClient.cancelVoiceDownload(v.id); return; }
    busy.set(v.id, 0); render();
    try {
      await ttsClient.installVoice(v.id);
      await save({ germanVoice: v.id });
      opts.onVoice?.('de', v.id);
      deVoices = (await ttsClient.voices('de')).filter((x) => x.engine !== 'kartoffelbox' || x.id === settings.tts?.germanVoice);
    } catch (e) {
      if (e?.code !== 'cancelled') flash(tr({ de: 'Download fehlgeschlagen: {m}', en: 'Download failed: {m}' }, { m: e?.message || '' }));
    }
    busy.delete(v.id);
    if (!closed) render();
  }
  async function chooseEnglish(v) { await save({ englishVoice: v.id }); opts.onVoice?.('en', v.id); render(); }
  async function loadEnglish() {
    if (busy.has('en')) { ttsClient.cancelEnglish(); return; }
    busy.set('en', 0); render();
    try { await ttsClient.installEnglish(); enModel = await ttsClient.englishModel(true); }
    catch (e) { if (e?.code !== 'cancelled') flash(tr({ de: 'Download fehlgeschlagen: {m}', en: 'Download failed: {m}' }, { m: e?.message || '' })); }
    busy.delete('en');
    if (!closed) render();
  }
  let flashText = '';
  const flash = (t) => { flashText = t; render(); };

  // progress of a download (German voices: tts:piper through the client status, English: the worker status)
  offs.push(bus.on('tts:status', (st) => {
    if (closed) return;
    const p = st?.piperDetail;
    let changed = false;
    if (p?.voice && busy.has(p.voice) && typeof p.progress === 'number') { busy.set(p.voice, p.progress); changed = true; }
    if (busy.has('en') && typeof st?.englishDetail?.progress === 'number') { busy.set('en', st.englishDetail.progress); changed = true; }
    if (changed) paintProgress();
  }));
  offs.push(bus.on('i18n:change', () => { if (!closed) render(); }));

  function paintProgress() {
    for (const row of el.querySelectorAll('[data-busy]')) {
      const f = busy.get(row.dataset.busy);
      const badge = row.querySelector('.tts-menu-badge');
      if (badge && typeof f === 'number') badge.textContent = tr({ de: 'lädt {p} %', en: 'loading {p} %' }, { p: Math.round(f * 100) });
    }
  }

  function render() {
    const focusKey = document.activeElement?.closest?.('.tts-menu') === el ? document.activeElement.dataset.key : null;
    clear(el);
    const t = settings.tts || {};
    const head = h('div.tts-menu-head', h('span.tts-menu-title', tr({ de: 'Vorlesen', en: 'Read aloud' })),
      h('button.tts-menu-x', { type: 'button', dataset: { key: 'close' }, title: tr({ de: 'Schließen (Esc)', en: 'Close (Esc)' }), 'aria-label': tr({ de: 'Schließen', en: 'Close' }), onclick: () => close() }, '✕'));
    el.append(head);
    if (flashText) el.append(h('div.tts-menu-flash', { role: 'status' }, flashText));
    // language: automatic, or German / English for this book
    if (opts.langMode) {
      const mode = opts.langMode.get();
      const auto = mode === 'auto';
      const sw = h('button.tts-menu-switch', { type: 'button', role: 'switch', 'aria-checked': auto ? 'true' : 'false', dataset: { key: 'auto' }, class: auto ? 'on' : '',
        onclick: () => { opts.langMode.set(auto ? (opts.langMode.detected?.() || 'de') : 'auto'); render(); } },
      h('span', tr({ de: 'Sprache automatisch', en: 'Detect the language' })), h('span.toggle', { class: auto ? 'on' : '', 'aria-hidden': 'true' }));
      el.append(h('div.tts-menu-sec', sw));
      if (!auto) {
        el.append(h('div.tts-menu-seg', { role: 'radiogroup', 'aria-label': tr({ de: 'Sprache dieses Textes', en: 'Language of this text' }) },
          [['de', tr({ de: 'Deutsch', en: 'German' })], ['en', tr({ de: 'Englisch', en: 'English' })]].map(([k, label]) => h('button', {
            type: 'button', role: 'radio', 'aria-checked': mode === k ? 'true' : 'false', class: mode === k ? 'on' : '', dataset: { key: 'lang-' + k },
            onclick: () => { opts.langMode.set(k); render(); },
          }, label))));
      }
    }
    const lists = [];
    // German voices
    const deSel = deVoices.some((v) => v.id === t.germanVoice) ? t.germanVoice : (deVoices.find((v) => v.id === 'de_DE-martin-kokoro') || deVoices[0])?.id;
    lists.push(['de', h('div.tts-menu-sec',
      h('div.tts-menu-label', tr({ de: 'Deutsche Stimme', en: 'German voice' })),
      h('div.tts-menu-list', { role: 'radiogroup', 'aria-label': tr({ de: 'Deutsche Stimme', en: 'German voice' }) },
        deVoices.map((v) => {
          const name = String(v.plainName || v.name || v.id);
          const loading = busy.has(v.id);
          const badge = loading ? tr({ de: 'lädt {p} %', en: 'loading {p} %' }, { p: Math.round((busy.get(v.id) || 0) * 100) })
            : v.installed || v.engine === 'kartoffelbox' ? '' : tr({ de: '⇩ {mb} MB', en: '⇩ {mb} MB' }, { mb: mb(v.bytes) });
          const title = v.installed || v.engine === 'kartoffelbox' ? tr({ de: 'Auf diesem Rechner', en: 'On this computer' })
            : loading ? tr({ de: 'Wird geladen, ein Klick bricht ab', en: 'Downloading, a click cancels' })
              : tr({ de: 'Wird einmal heruntergeladen ({mb} MB) und dann gewählt', en: 'Downloaded once ({mb} MB), then chosen' }, { mb: mb(v.bytes) });
          return h('button.tts-menu-item', { type: 'button', role: 'radio', 'aria-checked': deSel === v.id ? 'true' : 'false', class: deSel === v.id ? 'on' : '', title,
            dataset: { key: 'de-' + v.id, ...(loading ? { busy: v.id } : {}) }, onclick: () => chooseGerman(v) },
          h('span.tts-menu-dot', { 'aria-hidden': 'true' }), h('span.tts-menu-name', name),
          badge ? h('span.tts-menu-badge', { class: v.installed ? '' : 'get' }, badge) : h('span.tts-menu-badge.ok', { 'aria-hidden': 'true' }, '✓'));
        })))]);
    // English voices: one model for all of them
    const enLoading = busy.has('en');
    const modelLine = enModel.cached === true ? null
      : h('div.tts-menu-model', { dataset: enLoading ? { busy: 'en' } : {} },
        h('span', enLoading ? tr({ de: 'Das englische Modell wird geladen.', en: 'The English model is downloading.' })
          : tr({ de: 'Das englische Modell fehlt noch ({mb} MB).', en: 'The English model is not here yet ({mb} MB).' }, { mb: mb(enModel.bytes) })),
        h('button.btn.small.tts-menu-get', { type: 'button', dataset: { key: 'en-model', ...(enLoading ? { busy: 'en' } : {}) }, onclick: () => loadEnglish() },
          enLoading ? h('span.tts-menu-badge', tr({ de: 'lädt {p} %', en: 'loading {p} %' }, { p: Math.round((busy.get('en') || 0) * 100) })) : tr({ de: 'Laden', en: 'Download' })));
    const enVoices = ttsClient.englishVoices?.() || [];
    const enSel = enVoices.some((v) => v.id === t.englishVoice) ? t.englishVoice : 'af_heart';
    lists.push(['en', h('div.tts-menu-sec',
      h('div.tts-menu-label', tr({ de: 'Englische Stimme', en: 'English voice' })),
      modelLine,
      h('div.tts-menu-list.tts-menu-en', { role: 'radiogroup', 'aria-label': tr({ de: 'Englische Stimme', en: 'English voice' }) },
        enVoices.map((v) => h('button.tts-menu-item', { type: 'button', role: 'radio', 'aria-checked': enSel === v.id ? 'true' : 'false', class: enSel === v.id ? 'on' : '',
          dataset: { key: 'en-' + v.id }, onclick: () => chooseEnglish(v) },
        h('span.tts-menu-dot', { 'aria-hidden': 'true' }), h('span.tts-menu-name', v.name))))) ]);
    // the language that is read now comes first
    if ((opts.current?.() || 'de') === 'en') lists.reverse();
    // side by side in a wide window (the menu stays low), one above the other in a narrow one
    el.append(h('div.tts-menu-voices', lists.map(([, sec]) => sec)));
    if (opts.speed) {
      const cur = opts.speed.get();
      el.append(h('div.tts-menu-sec', h('div.tts-menu-label', tr({ de: 'Tempo', en: 'Speed' })),
        h('div.tts-menu-seg', { role: 'radiogroup', 'aria-label': tr({ de: 'Tempo', en: 'Speed' }) },
          SPEEDS.map((v) => h('button', { type: 'button', role: 'radio', 'aria-checked': Math.abs(v - cur) < 0.01 ? 'true' : 'false', class: Math.abs(v - cur) < 0.01 ? 'on' : '',
            dataset: { key: 'speed-' + v }, onclick: () => { opts.speed.set(v); render(); } }, fmtSpeed(v))))));
    }
    if (opts.openSettings) {
      el.append(h('div.tts-menu-foot', h('button.btn.small.ghost', { type: 'button', dataset: { key: 'settings' }, onclick: () => { close(); opts.openSettings(); } },
        tr({ de: 'Alle Stimmen in den Einstellungen', en: 'All voices in the settings' }))));
    }
    place();
    const again = focusKey && el.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
    (again || el.querySelector('[aria-checked="true"].tts-menu-item') || el.querySelector('button'))?.focus({ preventScroll: true });
    if (!again) el.querySelector('[aria-checked="true"].tts-menu-item')?.scrollIntoView?.({ block: 'nearest' });
  }

  /** Next to the button: below it when it sits in the upper half of the window, above it otherwise. */
  function place() {
    const r = opts.anchor.getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight;
    const w = Math.min(W >= 760 ? 600 : 340, W - 16);
    el.style.width = w + 'px';
    el.classList.toggle('wide', w >= 560);
    el.style.left = Math.max(8, Math.min(W - w - 8, r.right - w)) + 'px';
    if (r.top + r.height / 2 < H / 2) { el.style.top = (r.bottom + 6) + 'px'; el.style.bottom = ''; el.style.maxHeight = (H - r.bottom - 16) + 'px'; }
    else { el.style.bottom = (H - r.top + 6) + 'px'; el.style.top = ''; el.style.maxHeight = (r.top - 16) + 'px'; }
  }

  // keyboard: arrows move, Escape closes; the keys never reach the panel behind (it would turn a page)
  el.addEventListener('keydown', (e) => {
    const items = [...el.querySelectorAll('button:not([disabled])')];
    const at = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); items[(at + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === 'Tab') { e.preventDefault(); items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus(); }
    else if (e.key !== 'Enter' && e.key !== ' ') return;
    e.stopPropagation();
  });
  // a click outside closes the menu (not the one on the button that opened it: that one toggles)
  const outside = (e) => { if (!el.contains(e.target) && !opts.anchor.contains(e.target)) close(); };
  const onResize = () => place();
  // a click into a page of the book (an iframe) never reaches this document: the window loses the focus instead
  const onBlur = () => setTimeout(() => { if (!closed && document.activeElement?.tagName === 'IFRAME') close(false); }, 0);
  setTimeout(() => { if (!closed) document.addEventListener('pointerdown', outside, true); }, 0);
  window.addEventListener('resize', onResize);
  window.addEventListener('blur', onBlur);

  function close(restoreFocus = true) {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('blur', onBlur);
    for (const off of offs) { try { off(); } catch {} }
    el.remove();
    if (openMenu === handle) openMenu = null;
    opts.anchor?.setAttribute?.('aria-expanded', 'false');
    if (restoreFocus) { try { opts.anchor?.focus?.({ preventScroll: true }); } catch {} }
    opts.onClose?.();
  }
  const handle = { el, anchor: opts.anchor, close, refresh: () => load() };
  openMenu = handle;
  opts.anchor?.setAttribute?.('aria-expanded', 'true');
  el.append(h('div.tts-menu-head', h('span.tts-menu-title', tr({ de: 'Vorlesen', en: 'Read aloud' }))), h('div.tts-menu-sec.small', tr({ de: 'Stimmen werden geladen …', en: 'Loading the voices …' })));
  document.body.append(el);
  place();
  el.focus({ preventScroll: true });
  load();
  return handle;
}
