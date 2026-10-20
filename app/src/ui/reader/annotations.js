// Annotations: text selection toolbar, highlights (foliate overlayer / own overlay for PDFs), notes,
// dictionary, translation and Wikipedia cards.
import { h, clear } from '../../core/dom.js';

export const COLORS = [
  { id: 'yellow', hex: '#f2d24b' },
  { id: 'green', hex: '#9ad06d' },
  { id: 'blue', hex: '#7fb6e6' },
  { id: 'pink', hex: '#f29ab8' },
];
export const colorHex = (c) => COLORS.find((x) => x.id === c)?.hex || c || COLORS[0].hex;

export function createAnnotations(R) {
  const { T } = R;
  const el = h('div.rd-annot');
  const toolbar = h('div.rd-seltool.hidden');
  const card = h('div.rd-card.hidden');
  el.append(toolbar, card);
  const docIndex = new WeakMap();
  const watchers = new Set(); // MutationObservers of fixed-layout (PDF) pages – see destroy()
  let sel = null; // { doc, index, range, text }
  let cardAnchor = null;
  let destroyed = false;
  let noteTimer = null;

  const list = () => { if (!R.record) return []; if (!R.record.annotations) R.record.annotations = []; return R.record.annotations; };
  const persist = () => R.queueSave({ annotations: list() }, true);
  const byValue = (value) => list().find((a) => a.value === value);

  /* ---------- placement ---------- */
  function place(box, rect, prefer = 'above') {
    const sr = R.stageRect();
    box.classList.remove('hidden');
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let left = rect.left + rect.width / 2 - bw / 2;
    left = Math.max(8, Math.min(sr.width - bw - 8, left));
    let top = prefer === 'above' ? rect.top - bh - 10 : rect.top + rect.height + 10;
    if (top < 8) top = rect.top + rect.height + 10;
    if (top + bh > sr.height - 8) top = Math.max(8, sr.height - bh - 8);
    box.style.left = left + 'px'; box.style.top = top + 'px';
  }

  /* ---------- selection toolbar ---------- */
  const tbtn = (label, title, onclick, cls = '') => h(`button.rd-tb${cls ? '.' + cls : ''}`, { title, onclick: (e) => { e.stopPropagation(); onclick(); } }, label);
  function buildToolbar() {
    clear(toolbar);
    toolbar.append(
      h('div.rd-tb-colors', COLORS.map((c) => h('button.rd-tb-color', { style: { background: c.hex }, title: T('Markieren', 'Highlight'), onclick: (e) => { e.stopPropagation(); addHighlight(c.id); } }))),
      h('span.rd-tb-sep'),
      tbtn('✎ ' + T('Notiz', 'Note'), T('Notiz hinzufügen', 'Add note'), () => addNote()),
      tbtn('📖', T('Wörterbuch', 'Dictionary'), () => lookup('dict')),
      tbtn('⇄', T('Übersetzen', 'Translate'), () => lookup('translate')),
      tbtn('W', T('Wikipedia', 'Wikipedia'), () => lookup('wiki'), 'rd-tb-wiki'),
      tbtn('⎘', T('Kopieren', 'Copy'), () => copy()),
      tbtn('🔈', T('Vorlesen ab hier', 'Read aloud from here'), () => { const s = sel; hideToolbar(); if (s) R.tts.startFrom(s.range, s.doc); }),
    );
  }
  buildToolbar();
  toolbar.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection in the iframe

  function captureSelection(doc) {
    const s = doc.getSelection?.();
    if (!s || s.isCollapsed || !s.rangeCount) return null;
    const range = s.getRangeAt(0).cloneRange();
    // without the soft hyphens of the text view of a PDF (pdf-text-view.js)
    const text = range.toString().replace(/­/g, '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return { doc, index: docIndex.get(doc) ?? R.view?.renderer?.getContents?.()[0]?.index ?? 0, range, text };
  }
  function showToolbar(doc) {
    const s = captureSelection(doc);
    if (!s) { hideToolbar(); return; }
    sel = s;
    const rect = R.rangeRect(s.range, doc);
    if (!rect) return;
    hideCard();
    place(toolbar, rect, 'above');
    R.showChrome?.();
  }
  function hideToolbar() { toolbar.classList.add('hidden'); }
  function hideCard() {
    // the note textarea keeps DOM focus otherwise, and every reader shortcut dies (finding 3)
    if (card.contains(document.activeElement)) { document.activeElement.blur?.(); R.els?.root?.focus?.(); }
    card.classList.add('hidden'); cardAnchor = null;
  }
  function hideAll() { const was = !toolbar.classList.contains('hidden') || !card.classList.contains('hidden'); hideToolbar(); hideCard(); return was; }
  const isOpen = () => !card.classList.contains('hidden');

  /* ---------- section documents ---------- */
  function onLoad(doc, index) {
    docIndex.set(doc, index);
    let pointerDown = false;
    doc.addEventListener('pointerdown', () => { pointerDown = true; });
    doc.addEventListener('pointerup', () => { pointerDown = false; setTimeout(() => showToolbar(doc), 30); });
    doc.addEventListener('keyup', (e) => { if (e.shiftKey || e.key === 'Shift') setTimeout(() => showToolbar(doc), 30); });
    doc.addEventListener('selectionchange', () => { if (pointerDown) return; const s = doc.getSelection(); if (!s || s.isCollapsed) hideToolbar(); });
    if (R.isFixed) watchFixed(doc, index);
  }
  /** PDF pages render their text layer asynchronously (and again on zoom): draw once it exists, redraw on changes.
   *  Observer and pending timer are kept so they can be disconnected on teardown (finding 8). */
  function watchFixed(doc, index) {
    if (destroyed) return;
    const layer = doc.querySelector('.textLayer') || doc.body;
    let t = null;
    const schedule = () => { clearTimeout(t); t = setTimeout(() => { if (!destroyed && (layer.childElementCount || layer === doc.body)) drawFixed(doc, index); }, 120); };
    let obs = null;
    try { obs = new MutationObserver(schedule); obs.observe(layer, { childList: true, subtree: false }); } catch { obs = null; }
    const entry = { doc, cancel: () => { clearTimeout(t); try { obs?.disconnect(); } catch {} } };
    // a page document can be re-rendered (zoom): drop the watcher that belonged to the old one
    for (const w of [...watchers]) if (w.doc === doc) { w.cancel(); watchers.delete(w); }
    watchers.add(entry);
    if (layer.childElementCount) schedule();
  }
  function destroy() {
    destroyed = true;
    clearTimeout(noteTimer); noteTimer = null;
    for (const w of watchers) w.cancel();
    watchers.clear();
  }

  /* ---------- drawing ---------- */
  // The text view of a PDF (pdf-text-view.js) has its own CFIs (epubcfi(/8/…)): its highlights are drawn there, those
  // of the PDF pages only on the pages. From the list in the sidebar, a highlight of the other view leads to its page.
  const textViewCfi = (a) => String(a?.value || '').startsWith('epubcfi(/8/');
  const fits = (a) => (R.tvs?.active ? textViewCfi(a) : !textViewCfi(a));
  function onCreateOverlay({ index }) {
    for (const a of list()) { if (!fits(a)) continue; try { R.view.addAnnotation(a); } catch (e) { /* section not loaded */ } }
  }
  function onDraw({ draw, annotation }) {
    const color = colorHex(annotation.color);
    if (annotation.color === 'none') draw(R.Overlayer.underline, { color: '#d9743f', width: 2 });
    else draw(R.Overlayer.highlight, { color });
  }
  function drawFixed(doc, index) {
    const overlay = R.overlayFor(doc, true); if (!overlay) return;
    for (const a of list()) {
      if (!fits(a)) continue;
      try {
        const res = R.view.resolveNavigation(a.value); if (!res || res.index !== index) continue;
        const range = res.anchor(doc); if (!range) continue;
        overlay.add(a.value, range, a.color === 'none' ? R.Overlayer.underline : R.Overlayer.highlight, { color: a.color === 'none' ? '#d9743f' : colorHex(a.color) });
      } catch (e) { console.warn('[reader] pdf highlight failed', e); }
    }
  }
  function redrawAll() {
    if (R.isFixed) { for (const doc of R.docs()) { const idx = docIndex.get(doc); if (idx != null) drawFixed(doc, idx); } }
    else for (const a of list()) { if (!fits(a)) continue; try { R.view.addAnnotation(a); } catch {} }
  }
  function undraw(a) {
    if (R.isFixed) { for (const doc of R.docs()) R.overlayFor(doc)?.remove(a.value); }
    else { try { R.view.deleteAnnotation(a); } catch {} }
  }

  /* ---------- create / edit ---------- */
  /** move element-boundary range ends into text nodes (CFIs keep only text offsets reliably) */
  function normalizeRange(range) {
    const r = range.cloneRange();
    const firstText = (n) => { if (!n) return null; if (n.nodeType === 3) return n; for (const c of n.childNodes) { const t = firstText(c); if (t) return t; } return null; };
    const lastText = (n) => { if (!n) return null; if (n.nodeType === 3) return n; for (let i = n.childNodes.length - 1; i >= 0; i--) { const t = lastText(n.childNodes[i]); if (t) return t; } return null; };
    if (r.startContainer.nodeType === 1) { let n = r.startContainer.childNodes[r.startOffset], t = firstText(n); while (!t && n?.nextSibling) { n = n.nextSibling; t = firstText(n); } if (t) r.setStart(t, 0); }
    if (r.endContainer.nodeType === 1) { let n = r.endContainer.childNodes[r.endOffset - 1], t = lastText(n); while (!t && n?.previousSibling) { n = n.previousSibling; t = lastText(n); } if (t) r.setEnd(t, t.length); }
    return r;
  }
  function makeAnnotation(s, color) {
    s.range = normalizeRange(s.range);
    const value = R.view.getCFI(s.index, s.range);
    return { id: 'an' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), value, color, note: '', text: s.text.slice(0, 600), createdAt: Date.now(), label: (R.loc?.tocItem?.label && String(R.loc.tocItem.label)) || '', ...(R.loc?.pdf ? { page: R.loc.pdf.page } : {}) };
  }
  function addHighlight(color, openCard = false) {
    if (!sel) return;
    const s = sel;
    let a;
    try { a = makeAnnotation(s, color); } catch (e) { R.toast(T('Markierung hier nicht möglich', 'Cannot highlight here')); console.warn(e); return; }
    list().push(a);
    try { if (R.isFixed) drawFixed(s.doc, s.index); else R.view.addAnnotation(a); }
    catch (e) { console.warn('[reader] draw failed', e); if (R.isFixed) R.showNotice(T('PDF: Die Markierung konnte nicht gezeichnet werden, nur Lesezeichen sind möglich.', 'PDF: could not draw highlight – bookmarks only.')); }
    try { s.doc.getSelection()?.removeAllRanges(); } catch {}
    persist();
    R.sidebar.refresh('notes');
    R.ctx.audio?.sfx?.('click');
    hideToolbar();
    if (openCard) showNoteCard(a, s.range, s.doc, true);
    return a;
  }
  function addNote() { if (!sel) return; addHighlight('yellow', true); }
  function updateAnnotation(a, patch) { Object.assign(a, patch); persist(); R.sidebar.refresh('notes'); }
  function removeAnnotation(a) {
    undraw(a);
    R.record.annotations = list().filter((x) => x.id !== a.id);
    persist(); R.sidebar.refresh('notes');
    hideCard();
  }
  function recolor(a, color) { a.color = color; undraw(a); try { if (R.isFixed) redrawAll(); else R.view.addAnnotation(a); } catch {} persist(); R.sidebar.refresh('notes'); }
  async function copy(text) {
    text = text ?? sel?.text; if (!text) return;
    try { await navigator.clipboard.writeText(text); R.toast(T('Kopiert', 'Copied')); } catch { R.toast(T('Kopieren nicht möglich', 'Copy failed')); }
    hideToolbar();
  }

  /* ---------- cards ---------- */
  function openCard(rect, title, body, opts = {}) {
    clear(card);
    card.className = 'rd-card' + (opts.cls ? ' ' + opts.cls : '');
    card.append(h('div.rd-card-head', h('span.rd-card-title', title), h('span.spacer'), opts.headExtra, h('button.rd-btn.small', { onclick: () => hideCard() }, '✕')), h('div.rd-card-body', body));
    cardAnchor = rect;
    place(card, rect, 'below');
    hideToolbar();
    R.showChrome?.();
  }
  function showNoteCard(a, range, doc, focus) {
    let rect = range ? R.rangeRect(range, doc) : null;
    if (!rect) { const sr = R.stageRect(); rect = { left: sr.width / 2 - 160, top: sr.height * 0.3, width: 320, height: 0 }; }
    const ta = h('textarea.input.rd-note-input', { placeholder: T('Notiz …', 'Note …'), rows: 4, value: a.note || '' });
    ta.addEventListener('input', () => { clearTimeout(noteTimer); noteTimer = setTimeout(() => { if (!destroyed) updateAnnotation(a, { note: ta.value }); }, 500); });
    ta.addEventListener('blur', () => { clearTimeout(noteTimer); if (!destroyed && ta.value !== (a.note || '')) updateAnnotation(a, { note: ta.value }); });
    const body = h('div',
      h('div.rd-card-excerpt', { style: { borderColor: colorHex(a.color) } }, a.text),
      ta,
      h('div.rd-card-actions',
        h('div.rd-tb-colors', COLORS.map((c) => h('button.rd-tb-color', { class: a.color === c.id ? 'active' : '', style: { background: c.hex }, onclick: () => { recolor(a, c.id); showNoteCard(a, range, doc); } }))),
        h('span.spacer'),
        h('button.btn.small', { onclick: () => copy(a.text) }, T('Kopieren', 'Copy')),
        h('button.btn.small.rd-danger', { onclick: () => removeAnnotation(a) }, T('Löschen', 'Delete'))));
    openCard(rect, T('Notiz', 'Note'), body, { cls: 'rd-card-note' });
    if (focus) setTimeout(() => ta.focus(), 30);
  }
  function onShow({ value, index, range }) {
    const a = byValue(value); if (!a) return;
    const doc = R.docs().find((d) => range?.startContainer?.ownerDocument === d) || R.currentDoc();
    showNoteCard(a, range, doc, false);
  }
  function handleDocClick(doc, e) {
    if (!R.isFixed) return false;
    const overlay = R.docOverlays.get(doc); if (!overlay) return false;
    const [value, range] = overlay.hitTest({ x: e.clientX, y: e.clientY });
    if (!value) return false;
    onShow({ value, index: docIndex.get(doc), range });
    return true;
  }
  function showAnnotation(a) {
    // a highlight of the other view of a PDF: its page
    if (!fits(a)) { const m = /^epubcfi\(\/6\/(\d+)/.exec(a.value); const page = a.page ?? (m ? +m[1] / 2 - 1 : null); if (page != null) R.goTo(page); return; }
    // from the sidebar: navigate and open the card
    R.view.showAnnotation?.(a).catch?.(() => R.goTo(a.value));
  }

  /* ---------- dictionary / translation / wikipedia ---------- */
  const bookLang = () => (R.lang || R.uiLang || 'de').slice(0, 2);
  const otherLang = () => { const b = bookLang(), u = (R.uiLang || 'de').slice(0, 2); return b === u ? (u === 'de' ? 'en' : 'de') : u; };
  const spinner = (msg) => h('div.rd-card-loading', h('div.rd-spinner.small'), msg);
  const notFound = () => h('div.rd-card-empty', T('Nichts gefunden.', 'Nothing found.'));

  function normalizeDict(res) {
    if (!res || res.notFound) return null;
    if (typeof res === 'string') return { meanings: [{ pos: '', defs: [{ def: res }] }] };
    const out = { word: res.word || res.term || '', phonetic: res.phonetic || res.pronunciation || '', meanings: [], source: [].concat(res.source || []).filter(Boolean).join(' · ') };
    const addSection = (m, extraPos) => {
      if (!m || typeof m !== 'object') return;
      const defs = (m.definitions || m.defs || m.senses || (m.definition ? [m] : []))
        .map((d) => (typeof d === 'string' ? { def: d } : { def: d.definition || d.def || d.text || d.gloss || '', example: d.example || d.examples?.[0] || '', synonyms: d.synonyms || [] }))
        .filter((d) => d.def);
      if (defs.length) out.meanings.push({ pos: [m.partOfSpeech || m.pos || '', extraPos].filter(Boolean).join(' · '), defs, synonyms: m.synonyms || [] });
    };
    // backend shape: { entries: [...], glosses: [...] } – glosses are definitions in the other language
    const entries = Array.isArray(res) ? res : res.entries || res.results || res.meanings || res.senses || res.definitions || [];
    if (Array.isArray(entries)) for (const e of entries) {
      if (typeof e === 'string') { out.meanings.push({ pos: '', defs: [{ def: e }] }); continue; }
      if (e.meanings || e.senses) { out.word ||= e.word || ''; out.phonetic ||= e.phonetic || e.phonetics?.find?.((p) => p.text)?.text || ''; for (const m of e.meanings || e.senses) addSection(m); }
      else addSection(e);
    }
    for (const g of res.glosses || []) addSection(g, T('Übersetzung', 'gloss'));
    return out.meanings.length ? out : null;
  }
  function renderDict(d, word) {
    if (!d) return notFound();
    return h('div.rd-dict',
      h('div.rd-dict-word', d.word || word, d.phonetic ? h('span.rd-dict-phon', d.phonetic) : null),
      d.meanings.slice(0, 4).map((m) => h('div.rd-dict-meaning', m.pos ? h('div.rd-dict-pos', m.pos) : null,
        h('ol.rd-dict-defs', m.defs.slice(0, 4).map((x) => h('li', x.def, x.example ? h('div.rd-dict-example', '„' + x.example + '“') : null))),
        m.synonyms?.length ? h('div.rd-dict-example', T('Synonyme: ', 'Synonyms: ') + m.synonyms.slice(0, 6).join(', ')) : null)),
      d.source ? h('div.rd-card-source', d.source) : null);
  }
  const translationText = (r) => {
    if (!r) return '';
    if (typeof r === 'string') return r;
    return r.translated || r.translation || r.translatedText || r.result || r.translations?.[0]?.text || r.data?.translations?.[0]?.translatedText || (r.text && r.text !== r.source ? r.text : '') || '';
  };
  async function lookup(kind) {
    if (!sel) return;
    const s = sel;
    const text = s.text;
    const rect = R.rangeRect(s.range, s.doc) || { left: 100, top: 100, width: 100, height: 0 };
    const api = R.api;
    if (kind === 'dict') {
      const words = text.split(/\s+/);
      const word = (words.length <= 3 ? text : words[0]).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      const lang = bookLang();
      const body = h('div', spinner(T('Suche „{w}“ …', 'Looking up “{w}” …', { w: word })));
      openCard(rect, T('Wörterbuch', 'Dictionary') + ' · ' + lang.toUpperCase(), body);
      try { const res = await api.dict.define(word, lang); if (cardAnchor !== rect) return; clear(body); body.append(renderDict(normalizeDict(res), word)); }
      catch (e) { clear(body); body.append(h('div.rd-card-empty', T('Wörterbuch nicht erreichbar.', 'Dictionary unavailable.'))); }
      return;
    }
    if (kind === 'translate') {
      const from = bookLang(), to = otherLang();
      const body = h('div', spinner(T('Übersetze …', 'Translating …')));
      openCard(rect, `${T('Übersetzung', 'Translation')} ${from.toUpperCase()} → ${to.toUpperCase()}`, body);
      try {
        const res = await api.dict.translate(text.slice(0, 1500), from, to);
        if (cardAnchor !== rect) return; clear(body);
        const t = translationText(res);
        const alts = (res?.alternatives || []).map((a) => (typeof a === 'string' ? a : a.text)).filter((a) => a && a !== t).slice(0, 3);
        body.append(t ? h('div.rd-translation', h('div.rd-translation-src', text.slice(0, 400)), h('div.rd-translation-out', t), alts.length ? h('div.rd-dict-example', T('Alternativen: ', 'Alternatives: ') + alts.join(' · ')) : null, res?.source ? h('div.rd-card-source', String(res.source)) : null) : notFound());
      } catch (e) { clear(body); body.append(h('div.rd-card-empty', T('Übersetzung nicht erreichbar.', 'Translation unavailable.'))); }
      return;
    }
    if (kind === 'wiki') {
      const term = text.slice(0, 80);
      const lang = bookLang() === 'en' ? 'en' : 'de';
      const body = h('div', spinner(T('Suche im Lexikon …', 'Searching the encyclopedia …')));
      openCard(rect, 'Wikipedia', body, { cls: 'rd-card-wide' });
      try {
        const res = await api.wiki.summary(lang, term);
        if (cardAnchor !== rect) return; clear(body);
        if (!res || !(res.extract || res.summary || res.text)) { body.append(notFound()); return; }
        const thumb = typeof res.thumbnail === 'string' ? res.thumbnail : res.thumbnail?.url || res.thumbnail?.source || res.image || null;
        body.append(h('div.rd-wiki', thumb ? h('img.rd-wiki-thumb', { src: thumb, alt: '' }) : null,
          h('div.rd-wiki-text', h('div.rd-wiki-title', res.displayTitle || res.title || term), res.description ? h('div.rd-wiki-desc', res.description) : null, h('div.rd-wiki-extract', res.extract || res.summary || res.text))),
          h('div.rd-card-actions', h('span.spacer'), h('button.btn.small.primary', { onclick: () => { hideCard(); R.ctx.openPanel?.('wiki', { title: res.title || term, lang }); } }, T('Im Lexikon öffnen', 'Open in encyclopedia'))));
      } catch (e) { clear(body); body.append(h('div.rd-card-empty', T('Wikipedia nicht erreichbar.', 'Wikipedia unavailable.'))); }
    }
  }

  return {
    el, onLoad, onCreateOverlay, onDraw, onShow, handleDocClick, hideToolbar, hideCard, hideAll, isOpen, destroy,
    list, showAnnotation, showNoteCard, removeAnnotation, updateAnnotation, redrawAll, addHighlight,
    get selection() { return sel; },
  };
}
