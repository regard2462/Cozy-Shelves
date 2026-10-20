// Read-aloud controller: collects sentences (with DOM ranges) from the current position onward,
// feeds them to the TTS client (tts-client.js, written by the TTS module), highlights the spoken
// sentence, turns pages and continues with the next section. Degrades gracefully when the client
// is missing.
//
// What reaches the voices (0.7): PDF pages are put together from the positions of the text items (tts-pdf.js:
// spaces at line ends, columns, hyphenated words, without running heads and page numbers), a page without readable
// text (a scan, a broken font) is skipped with a short note, and every paragraph gets its language from its text
// (tts-lang.js planLanguages): the metadata of a book is only asked when the text says nothing clear, because a
// German book marked 'en' or with a broken entry was read by the English voice, which sounds like gibberish.
// The voice menu (tts-voice-menu.js) sits at the read-aloud icon: ▾ next to it, a right click on it, or Shift+V.
import { h, clear } from '../../core/dom.js';
import { planLanguages, normalizeLangCode } from './tts-lang.js';
import { collectPdfPage } from './tts-pdf.js';
import { openVoiceMenu, closeVoiceMenu, voiceMenuOpen } from './tts-voice-menu.js';

const BLOCK_TAGS = new Set(['article', 'aside', 'blockquote', 'caption', 'dd', 'details', 'dialog', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'li', 'main', 'p', 'pre', 'section', 'td', 'th', 'tr']);
const ABBR_END = /(?:\b\p{L}|\b(?:z\.\s?B|bzw|usw|etc|ca|vgl|Dr|Prof|Nr|Hr|Fr|Mr|Mrs|Ms|St|vs|Jr|Sr|u\.\s?a|d\.\s?h|o\.\s?ä|z\.\s?T)|\b\d{1,3}(?:\.\.)?)\.\s*$/u;
const MAX_UNREADABLE = 8;   // pages without readable text in a row that are skipped, then the reading stops
const NOTE_MS = 1400;       // the note about such a page stays this long before the next page
const SPEEDS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
const str = (x) => (!x ? '' : typeof x === 'string' ? x : Array.isArray(x) ? x.map(str).filter(Boolean).join(', ') : typeof x === 'object' ? str(x.name ?? Object.values(x)[0]) : String(x));

function* getBlocks(doc) {
  let last = null;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (BLOCK_TAGS.has(node.tagName.toLowerCase())) {
      if (last) { last.setEndBefore(node); if (last.toString().trim()) yield last; }
      last = doc.createRange(); last.setStart(node, 0);
    }
  }
  if (!last) { last = doc.createRange(); last.setStart(doc.body.firstChild ?? doc.body, 0); }
  last.setEndAfter(doc.body.lastChild ?? doc.body);
  if (last.toString().trim()) yield last;
}

/**
 * The sentences of a block of a reflowable section, with their ranges. The text nodes are joined like the reader
 * sees them: a <br> is a space (a poem line, a line break of a converted book), never "zweiZeilen".
 */
function blockSentences(block, segmenter) {
  const doc = block.startContainer.ownerDocument;
  let root = block.commonAncestorContainer;
  if (root.nodeType !== 1) root = root.parentNode;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      if (n.nodeType === 1) {
        const tag = n.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'rt' || tag === 'rp') return NodeFilter.FILTER_REJECT;
        return tag === 'br' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = '';
  const parts = [];   // [at, node, length]
  // from the start of the block on, not from the start of the section (long chapters have thousands of blocks)
  const from = block.startContainer;
  if (from.nodeType === 1 && from !== root && root.contains(from)) walker.currentNode = from;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const c = block.comparePoint(n, 0);
    if (c < 0) continue;
    if (c > 0) break;
    if (n.nodeType === 1) { if (!/\s$/.test(text)) text += ' '; continue; }
    const v = n.nodeValue ?? '';
    if (!v) continue;
    parts.push([text.length, n, v.length]);
    text += v;
  }
  if (!text.trim()) return [];
  const at = (pos, end) => {
    let best = null;
    for (const [p, node, len] of parts) {
      if (pos >= p && pos < p + len) return [node, pos - p + (end ? 1 : 0)];
      if (!end && p > pos) return [node, 0];
      if (end && p + len <= pos) best = [node, len];
    }
    return best;
  };
  const raw = [];
  for (const { index, segment } of segmenter.segment(text)) if (segment.trim()) raw.push({ start: index, end: index + segment.length, text: segment });
  // merge segments that were split after abbreviations, move numbers ("2. Sf3") or before lower-case continuations
  const merged = [];
  for (const s of raw) {
    const prev = merged[merged.length - 1];
    if (prev && (ABBR_END.test(prev.text) || /^\s*\p{Ll}/u.test(s.text)) && (prev.text.length + s.text.length) < 600) { prev.text += s.text; prev.end = s.end; }
    else merged.push({ ...s });
  }
  const out = [];
  for (const s of merged) {
    const t = s.text.replace(/­/g, '').replace(/\s+/g, ' ').trim();
    if (t.length < 2) continue;
    // the range from the first to the last visible character of the sentence
    let a = s.start, b = s.end - 1;
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b])) b--;
    const from = at(a, false), to = at(b, true);
    let range = null;
    if (from && to) { try { range = doc.createRange(); range.setStart(from[0], Math.min(from[1], from[0].length)); range.setEnd(to[0], Math.min(to[1], to[0].length)); } catch { range = null; } }
    if (range) out.push({ text: t, range });
  }
  return out;
}

export function createTTS(R) {
  const { T } = R;
  const el = h('div.rd-ttsbar.hidden');
  const docIndex = new WeakMap();
  let client = null, clientTried = false;
  let session = null, sentences = [], current = -1, active = false, paused = false, awaitingNext = false, lastDoc = null, pendingList = null, endedWhilePaused = false;
  let voiceNames = new Map();
  // the language of the book once its text decided it (planLanguages: later pages keep it, single paragraphs may differ)
  let plan = { base: null, source: null };
  let sessionLang = null;          // German or English chosen in the menu for a text without a library book
  const heads = new Set();         // running heads seen on the PDF pages before (tts-pdf.js)
  let unreadable = 0;              // pages without readable text in a row
  let paraSeq = 0;                 // paragraph numbers across the pages of a reading
  let noteTimer = null;

  async function getClient() {
    if (clientTried) return client;
    clientTried = true;
    try { const mod = await import('./tts-client.js'); client = mod.ttsClient || mod.default || null; if (typeof client?.speak !== 'function') client = null; }
    catch (e) { console.warn('[reader] tts-client.js not available', e?.message); client = null; }
    return client;
  }
  const settingsTts = () => R.ctx.state?.settings?.tts || {};
  const bookId = () => (R.record && !R.record._dev ? R.record.id : null);
  /** The language chosen in the menu for this book ('de'|'en'), or null for "Sprache automatisch". */
  function langOverride() {
    const id = bookId();
    const v = id ? settingsTts().bookLang?.[id] : sessionLang;
    return v === 'de' || v === 'en' ? v : null;
  }
  const metaLang = () => R.record?.language || str(R.fbook?.metadata?.language) || '';
  const segLang = () => plan.base || normalizeLangCode(metaLang()) || normalizeLangCode(R.uiLang) || 'de';

  /* ---------- sentence collection ---------- */
  /**
   * The sentences of a section document from `fromRange` on: [{ text, range, doc, para }], and for a PDF page
   * whether it has readable text at all (`junk`: 'empty' for a scan or an empty page, else why the text is broken).
   */
  async function collect(doc, fromRange) {
    if (R.isFixed) {
      // the sentences of every paragraph are split by the rules of its own language (lang 'auto', see splitSentences)
      const page = await collectPdfPage(doc, { title: R.title, heads, lang: langOverride() || 'auto' });
      for (const k of page.heads) heads.add(k);
      if (page.junk) return { list: [], junk: page.junk, chars: page.chars };
      const out = [];
      for (const para of page.paragraphs) {
        const p = ++paraSeq;
        for (const s of para.sentences) {
          if (!s.text || s.text.length < 2) continue;
          if (fromRange && s.range && s.range.compareBoundaryPoints(Range.START_TO_END, fromRange) <= 0) continue;
          out.push({ text: s.text, range: s.range, doc, para: p });
        }
      }
      return { list: out, junk: null, chars: page.chars };
    }
    let segmenter;
    try { segmenter = new Intl.Segmenter(segLang(), { granularity: 'sentence' }); } catch { segmenter = new Intl.Segmenter('de', { granularity: 'sentence' }); }
    const out = [];
    for (const block of getBlocks(doc)) {
      // skip blocks that end before the starting range
      if (fromRange && block.compareBoundaryPoints(Range.START_TO_END, fromRange) <= 0) continue;
      const p = ++paraSeq;
      for (const s of blockSentences(block, segmenter)) {
        if (fromRange && s.range.compareBoundaryPoints(Range.START_TO_END, fromRange) <= 0) continue;
        out.push({ ...s, doc, para: p });
      }
    }
    return { list: out, junk: null };
  }
  /** The visible page documents of a PDF (one, or two side by side), in page order. */
  const pageDocs = () => [...new Set(R.docs())].sort((a, b) => (docIndex.get(a) ?? 0) - (docIndex.get(b) ?? 0));

  /** Every sentence gets its language: the one chosen in the menu, else the one of its paragraph. */
  function assignLangs(list) {
    const fixed = langOverride();
    if (fixed) { for (const s of list) s.lang = fixed; plan = { base: fixed, source: 'user' }; return; }
    const texts = [], at = new Map();
    for (const s of list) { if (!at.has(s.para)) { at.set(s.para, texts.length); texts.push(''); } texts[at.get(s.para)] += s.text + ' '; }
    const keep = plan.source === 'text' ? plan.base : undefined;
    const res = planLanguages(texts, { meta: metaLang(), ui: R.uiLang, base: keep });
    if (!keep) plan = { base: res.base, source: res.source };
    for (const s of list) s.lang = res.langs[at.get(s.para)] || plan.base;
  }

  /* ---------- highlighting ---------- */
  const KEY = 'rd-tts';
  function unhighlight() { for (const doc of R.docs()) { try { R.overlayFor(doc)?.remove(KEY); } catch {} } }
  function highlight(s) {
    unhighlight();
    if (!s.range) return;
    try {
      if (!R.isFixed && !R.isRangeVisible(s.range)) R.view.renderer.scrollToAnchor?.(s.range);
      R.overlayFor(s.doc)?.add(KEY, s.range, R.Overlayer.highlight, { color: '#e2a94f' });
    } catch (e) { /* range may be stale */ }
  }

  /* ---------- playback ---------- */
  /** One place for every failure of the async read-aloud chain (collect, page turn, synthesis). */
  function fail(e) {
    console.warn('[reader] tts', e);
    R.showNotice?.(T('Vorlesen fehlgeschlagen: {m}', 'Read-aloud failed: {m}', { m: e?.message || e }));
    stop();
  }

  async function speakList(list) {
    sentences = list; current = -1;
    if (!list.length) { continueNext().catch(fail); return; }
    if (paused) { pendingList = list; session = null; renderBar(); return; }
    assignLangs(list);
    const mine = { list };
    const opts = {
      lang: plan.base, langs: list.map((s) => s.lang), chess: !!R.record?.isChess,
      onSentence: (i) => { if (session !== mine.session) return; current = i; const s = sentences[i]; if (s) highlight(s); renderBar(); },
      onStatus: (st) => {
        if (session !== mine.session) return;
        // a film or a podcast that started paused the reading (media/focus.js): the bar offers to resume
        if (active && !paused && session?.paused) { paused = true; renderBar(); return; }
        // until the first sentence plays, the bar shows what the speech output does (voice download, model start)
        if (!active || current >= 0 || !st?.message) return; const t = el.querySelector('.rd-tts-status-text'); if (t) t.textContent = st.message;
      },
      onEnd: () => { if (session !== mine.session || !active) return; if (paused) endedWhilePaused = true; else continueNext().catch(fail); },
      onError: (e) => { if (session === mine.session) fail(e); },
    };
    try { session = mine.session = client.speak(list.map((s) => s.text), opts); }
    catch (e) { opts.onError(e); }
    renderBar();
  }

  /**
   * The next page or section. A PDF page without readable text is skipped with a note; after MAX_UNREADABLE such
   * pages in a row the reading stops (a scanned book has no text at all).
   */
  async function continueNext() {
    if (!active || R.closed) return;
    unhighlight();
    const v = R.view;
    if (R.isFixed) {
      const before = R.loc?.section?.current;
      await v.next();
      if (!active || R.closed) return;
      if (R.loc?.section?.current === before) { R.toast(T('Ende des Buches', 'End of book')); return stop(); }
      return speakPages(null);
    }
    const idx = v.renderer.getContents()[0]?.index ?? -1;
    const sections = v.book.sections;
    let next = -1;
    for (let i = idx + 1; i < sections.length; i++) if (sections[i].linear !== 'no') { next = i; break; }
    if (next < 0) { R.toast(T('Ende des Buches', 'End of book')); return stop(); }
    awaitingNext = true;
    await v.goTo(next);
  }
  /** The visible PDF pages: their sentences are read, a page without readable text is announced and skipped. */
  async function speakPages(fromRange, doc) {
    let list = [], junk = 0;
    for (const d of pageDocs()) {
      const r = await collect(d, d === doc ? fromRange : null);
      if (r.junk) junk++;
      list = list.concat(r.list);
    }
    if (!active || R.closed) return;
    if (list.length) { unreadable = 0; return speakList(list); }
    if (!junk) return speakList([]);
    // nothing to read on these pages: a short note, then the next page
    unreadable++;
    if (unreadable > MAX_UNREADABLE) {
      R.showNotice?.(T('Vorlesen beendet. Die nächsten Seiten haben keinen lesbaren Text.', 'Reading stopped. The next pages have no readable text.'), 5000);
      return stop();
    }
    const note = T('Diese Seite hat keinen lesbaren Text', 'This page has no readable text');
    sentences = []; current = -1;   // the bar shows the note, not the last sentence of the page before
    renderBar(note);
    R.showNotice?.(note, NOTE_MS + 600);
    clearTimeout(noteTimer);
    await new Promise((r) => { noteTimer = setTimeout(r, NOTE_MS); });
    if (!active || R.closed) return;
    if (paused) { pendingList = []; return; }
    return continueNext();
  }
  function onLoad(doc, index) {
    docIndex.set(doc, index);
    lastDoc = doc;
    if (active && awaitingNext && !R.isFixed) { awaitingNext = false; collect(doc, null).then((r) => speakList(r.list)).catch(fail); }
  }

  async function start(fromRange, doc) {
    const c = await getClient();
    if (!c) { showHint(); return; }
    doc = doc || (fromRange?.startContainer?.ownerDocument) || R.currentDoc();
    if (!doc) return;
    active = true; paused = false; unreadable = 0;
    R.ctx.audio?.duck?.(true, 'reader');
    el.classList.remove('hidden');
    renderBar(T('Sätze werden gesammelt …', 'Collecting sentences …'));
    loadVoiceNames(c);
    if (R.isFixed) {
      // the visible pages first: the language of the book is decided on them before a voice is asked for
      let list = [], junk = 0;
      try {
        for (const d of pageDocs()) { const r = await collect(d, d === doc ? fromRange : null); if (r.junk) junk++; list = list.concat(r.list); }
      } catch (e) { return fail(e); }
      if (!active) return;
      if (!list.length) return junk ? speakPagesNote() : speakList([]);
      assignLangs(list);
      if (await askBeforeDownload(c, list)) return;
      return speakList(list);
    }
    let list = [];
    try {
      list = (await collect(doc, fromRange || R.loc?.range || null)).list;
      if (!list.length) list = (await collect(doc, null)).list;
    } catch (e) { return fail(e); }
    if (!active) return;
    if (list.length) assignLangs(list);
    if (await askBeforeDownload(c, list)) return;
    await speakList(list);
  }
  /** The first page of a reading has no readable text: the note, then the next page (as speakPages does). */
  async function speakPagesNote() {
    unreadable++;
    const note = T('Diese Seite hat keinen lesbaren Text', 'This page has no readable text');
    sentences = []; current = -1;
    renderBar(note);
    R.showNotice?.(note, NOTE_MS + 600);
    clearTimeout(noteTimer);
    await new Promise((r) => { noteTimer = setTimeout(r, NOTE_MS); });
    if (!active || R.closed) return;
    return continueNext().catch(fail);
  }
  /**
   * The voice for the language of the book is not on this computer yet: the bar names it with its size and asks
   * (a German voice of 20 to 311 MB, the English model of 90 or 330 MB). Returns true when it asked.
   */
  async function askBeforeDownload(c, list) {
    if (!list.length || typeof c.missingVoice !== 'function') return false;
    let missing = null;
    try { missing = await c.missingVoice(plan.base === 'en' ? 'en' : 'de'); } catch { missing = null; }
    if (!missing || !active) return false;
    offerDownload(missing, list);
    return true;
  }
  /** The voice for the text has to be downloaded first: the bar says so and the reader decides. */
  function offerDownload(missing, list) {
    active = false;
    R.ctx.audio?.duck?.(false, 'reader');
    clear(el);
    el.classList.remove('hidden');
    el.classList.add('offer');
    const mb = Math.max(1, Math.round((missing.bytes || 0) / 1048576));
    const english = missing.lang === 'en';
    el.append(
      h('span.rd-tts-icon', '🔈'),
      h('span.rd-tts-offer', english
        ? T('Zum Vorlesen wird die englische Stimme einmal heruntergeladen ({mb} MB). Danach liest sie auch ohne Internet.',
          'Reading aloud needs the English voice, a one-time download of {mb} MB. After that it also works offline.', { mb })
        : T('Zum Vorlesen wird die deutsche Stimme {v} einmal heruntergeladen ({mb} MB). Danach liest sie auch ohne Internet.',
          'Reading aloud needs the German voice {v}, a one-time download of {mb} MB. After that it also works offline.', { v: missing.name, mb })),
      h('button.btn.small.primary', { onclick: () => {
        el.classList.remove('offer');
        active = true; paused = false;
        R.ctx.audio?.duck?.(true, 'reader');
        renderBar(T('Stimme wird heruntergeladen …', 'Downloading the voice …'));
        speakList(list).catch(fail);
      } }, T('Herunterladen und vorlesen', 'Download and read')),
      h('button.btn.small.ghost', { 'aria-haspopup': 'dialog', onclick: (e) => openMenu(e.currentTarget) }, T('Andere Stimme wählen', 'Choose another voice')),
      h('button.rd-btn.rd-btn-close', { title: T('Schließen', 'Close'), 'aria-label': T('Schließen', 'Close'), onclick: () => stop() }, '✕'));
  }
  function pause() { if (!active) return; paused = true; try { session?.pause(); } catch {} renderBar(); }
  function resume() {
    if (!active) return;
    paused = false;
    if (pendingList) { const l = pendingList; pendingList = null; (l.length ? speakList(l) : continueNext()).catch(fail); return; }
    if (endedWhilePaused) { endedWhilePaused = false; continueNext().catch(fail); return; }
    try { session?.resume(); } catch {}
    renderBar();
  }
  function stop() {
    active = false; paused = false; awaitingNext = false; pendingList = null; endedWhilePaused = false;
    clearTimeout(noteTimer);
    try { session?.stop(); } catch {}
    session = null; sentences = []; current = -1;
    unhighlight();
    R.ctx.audio?.duck?.(false, 'reader');
    el.classList.add('hidden');
    el.classList.remove('offer');
  }
  function skip(d) { if (!session) return; try { session.skip(d); } catch {} }
  function toggle() { if (!active) return start().catch(fail); paused ? resume() : pause(); }
  function startFrom(range, doc) { if (active) stop(); return start(range, doc).catch(fail); }
  const isActive = () => active;
  const isVisible = () => !el.classList.contains('hidden');
  /** The reading again from the sentence that sounds now (another language for this book). */
  function restartAtCurrent() {
    if (!session || current < 0) return;
    const rest = sentences.slice(current);
    try { session.stop(); } catch {}
    session = null;
    speakList(rest).catch(fail);
  }

  /* ---------- voice menu ---------- */
  async function loadVoiceNames(c) {
    try {
      const de = await c.voices('de');
      voiceNames = new Map([...de.map((v) => [v.id, String(v.plainName || v.name || v.id)]), ...(c.englishVoices?.() || []).map((v) => [v.id, v.name.replace(/\s*\(.*\)$/, '')])]);
      if (active) renderBar();
    } catch {}
  }
  const currentLang = () => (current >= 0 && sentences[current]?.lang) || plan.base || 'de';
  function voiceLabel() {
    const t = settingsTts();
    const id = currentLang() === 'en' ? (t.englishVoice || 'af_heart') : (t.germanVoice || 'de_DE-martin-kokoro');
    return voiceNames.get(id) || id;
  }
  const keepSettings = (s) => { if (s && R.ctx.state) R.ctx.state.settings = s; };
  function openMenu(anchor) {
    return openVoiceMenu({
      anchor,
      current: currentLang,
      langMode: { get: () => langOverride() || 'auto', set: (mode) => setLangMode(mode), detected: () => currentLang() },
      speed: { get: () => Number(settingsTts().speed) || 1, set: (v) => R.api.settings.set({ tts: { speed: v } }).then((s) => { keepSettings(s); renderBar(); }).catch(() => {}) },
      openSettings: () => { stop(); R.ctx.openPanel?.('settings', { section: 'tts' }); },
      onClose: () => { if (active) renderBar(); },
    });
  }
  /** "Sprache automatisch" or German/English for this book (kept per book in settings.tts.bookLang). */
  function setLangMode(mode) {
    const value = mode === 'de' || mode === 'en' ? mode : null;
    const id = bookId();
    if (id) {
      // the choice has to be in the settings cache before the sentences are planned again
      if (R.ctx.state?.settings) R.ctx.state.settings = { ...R.ctx.state.settings, tts: { ...settingsTts(), bookLang: { ...(settingsTts().bookLang || {}), [id]: value } } };
      R.api.settings.set({ tts: { bookLang: { [id]: value } } }).then(keepSettings).catch(() => {});
    } else sessionLang = value;
    plan = { base: value, source: value ? 'user' : null };
    if (active && session) restartAtCurrent();
  }
  function closeMenu() { if (!voiceMenuOpen()) return false; closeVoiceMenu(); return true; }

  /* ---------- bar ---------- */
  function renderBar(statusText) {
    if (el.classList.contains('offer')) return;
    clear(el);
    const b = (label, title, onclick, cls = '') => h(`button.rd-btn${cls ? '.' + cls : ''}`, { title, onclick, 'aria-label': title }, label);
    const status = statusText || (current >= 0 ? T('Satz {a} / {b}', 'Sentence {a} / {b}', { a: current + 1, b: sentences.length }) : T('Vorlesen', 'Read aloud'));
    const speed = Number(settingsTts().speed) || 1;
    const lang = current >= 0 ? sentences[current]?.lang : plan.base;
    el.append(
      h('span.rd-tts-icon', '🔈'),
      b(paused ? '▶' : '⏸', paused ? T('Fortsetzen', 'Resume') : T('Pause', 'Pause'), () => (paused ? resume() : pause())),
      b('⏹', T('Stopp', 'Stop'), () => stop()),
      b('⏮', T('Vorheriger Satz', 'Previous sentence'), () => skip(-1)),
      b('⏭', T('Nächster Satz', 'Next sentence'), () => skip(1)),
      h('select.input.rd-tts-speed', { title: T('Geschwindigkeit', 'Speed'), 'aria-label': T('Geschwindigkeit', 'Speed'), onchange: (e) => { R.api.settings.set({ tts: { speed: parseFloat(e.target.value) } }).then(keepSettings).catch(() => {}); } },
        SPEEDS.map((v) => h('option', { value: v, selected: Math.abs(v - speed) < 0.01 }, String(v).replace('.', T(',', '.')) + '×'))),
      h('button.rd-btn.rd-tts-voicebtn', { title: T('Stimme und Tempo (Umschalt+V)', 'Voice and speed (Shift+V)'), 'aria-haspopup': 'dialog', onclick: (e) => openMenu(e.currentTarget) }, voiceLabel(), h('span.rd-tts-caret', { 'aria-hidden': 'true' }, '▾')),
      h('span.rd-tts-status', h('span.rd-tts-status-text', status), lang ? h('span.rd-tts-lang', { title: T('Sprache des Satzes', 'Language of the sentence') }, lang.toUpperCase()) : null),
      h('span.rd-tts-text', sentences[current]?.text?.slice(0, 90) || ''),
      b('✕', T('Schließen', 'Close'), () => stop(), 'rd-btn-close'),
    );
  }
  function showHint() {
    el.classList.remove('hidden');
    clear(el);
    el.append(h('span.rd-tts-icon', '🔈'),
      h('span.rd-tts-status', T('Vorlesen ist nicht verfügbar. Die Sprachausgabe muss zuerst eingerichtet werden.', 'Read-aloud is not available. Speech output has to be set up first.')),
      h('button.btn.small', { onclick: () => { el.classList.add('hidden'); R.ctx.openPanel?.('settings', { section: 'reading' }); } }, T('Einstellungen', 'Settings')),
      h('button.rd-btn.rd-btn-close', { onclick: () => el.classList.add('hidden') }, '✕'));
    setTimeout(() => el.classList.add('hidden'), 8000);
  }
  async function showStatusHint() {
    const c = await getClient(); if (!c?.status) return;
    try {
      const s = await c.status();
      const need = segLang() === 'en' ? 'english' : 'german';
      if (s && s[need] && s[need] !== 'ready' && s[need] !== 'loading' && s[need] !== 'starting') R.showNotice?.(T('Sprachausgabe ({l}): {s}. Siehe Einstellungen.', 'Speech ({l}): {s}. See the settings.', { l: need, s: s[need] }), 5000);
    } catch {}
  }

  const handle = {
    el, onLoad, toggle, start, startFrom, stop, pause, resume, isActive, isVisible, openMenu, closeMenu,
    get active() { return active; },
    destroy() { stop(); closeMenu(); try { client?.dispose?.(); } catch {} try { if (window.__readerTts === handle) window.__readerTts = null; } catch {} },
    checkStatus: showStatusHint,
    // for the checks (build/scripts/reader-tts-check.js): what the reading consists of right now
    get plan() { return { ...plan }; },
    get sentences() { return sentences.map((s) => ({ text: s.text, lang: s.lang, para: s.para })); },
    get current() { return current; },
  };
  // the language of the interface changes the names in the bar ("männlich" or "male") and its texts at once
  const offLang = R.bus?.on?.('i18n:change', () => { if (client) loadVoiceNames(client); if (active) renderBar(); });
  const destroy = handle.destroy;
  handle.destroy = () => { try { offLang?.(); } catch {} destroy(); };
  try { window.__readerTts = handle; } catch {}
  return handle;
}
