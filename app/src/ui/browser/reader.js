// Reader mode of the reading browser: the extracted article in the app's own typography, paginated like an
// e-reader with CSS columns (1 or 2 per page, "Seite 3 von 12"), or as one scrolling column.
// Pages turn by clicking the outer thirds, with the wheel, the keys (panel) and the strips at the edges.
// Find and read-aloud use the CSS Custom Highlight API, so the article DOM never changes after layout.
import { h, clear } from '../../core/dom.js';
import { FONTS } from './prefs.js';
import { icon } from './icons.js';
import { clamp } from './util.js';

const MARGIN = { narrow: [18, 22], normal: [30, 48], wide: [44, 92] };      // [vertical, minimal horizontal] padding
const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, dt, dd, td, th, pre, caption, summary';
const ABBR_END = /(?:\b\p{L}|\b(?:z\.\s?B|bzw|usw|etc|ca|vgl|Dr|Prof|Nr|Hr|Fr|Mr|Mrs|Ms|St|vs|Jr|Sr|Abs|Art|Bd|Jh|Mio|Mrd|u\.\s?a|d\.\s?h|o\.\s?ä|z\.\s?T|u\.\s?U|v\.\s?a|Chr)|\b\d{1,3})\.\s*$/u;
const hasHighlights = () => typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';
const SHY = '­';

// CSS "hyphens: auto" has no dictionaries in Electron on Windows, so the reader inserts soft hyphens itself
// (Liang's algorithm with the TeX patterns of the "hyphen" package, loaded on first use).
const HYPHENATORS = { de: () => import('hyphen/de'), en: () => import('hyphen/en') };
const hyphenLoads = {};
function loadHyphenator(lang) {
  if (!HYPHENATORS[lang]) return Promise.resolve(null);
  if (!hyphenLoads[lang]) {
    hyphenLoads[lang] = HYPHENATORS[lang]().then((m) => m.hyphenateSync || m.default?.hyphenateSync || null).catch((e) => { console.warn('[browser] hyphenation unavailable', e?.message); return null; });
  }
  return hyphenLoads[lang];
}
function hyphenateTree(root, fn) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue.length < 6 || n.parentElement?.closest('pre, code, kbd, samp, h1, h2, h3, h4, h5, h6')) continue;
    nodes.push(n);
  }
  for (const n of nodes) { try { n.nodeValue = fn(n.nodeValue, { minWordLength: 6 }); } catch { /* keep the text as it is */ } }
}
/** Text of a node without soft hyphens, plus the map back to offsets in the node. */
function plain(node) {
  const raw = node.nodeValue;
  if (!raw.includes(SHY)) return { text: raw, map: null };
  let text = '';
  const map = [];
  for (let i = 0; i < raw.length; i++) { if (raw[i] === SHY) continue; map.push(i); text += raw[i]; }
  map.push(raw.length);
  return { text, map };
}

export function createReader(B) {
  const T = B.T;
  const el = h('div.br-reader', { hidden: true });
  const viewport = h('div.br-rd-viewport');
  const flow = h('div.br-rd-flow');
  const stateEl = h('div.br-rd-state', { hidden: true });
  viewport.appendChild(flow);
  el.append(viewport, stateEl);

  let art = null, body = null;
  let page = 0, pages = 1, geo = null, paged = true;
  let layoutTimer = null, wheelAcc = 0, wheelAt = 0, wheelLast = 0;
  let findRanges = [], findIdx = 0;
  const offs = [];
  const on = (target, ev, fn, opts) => { target.addEventListener(ev, fn, opts); offs.push(() => target.removeEventListener(ev, fn, opts)); };

  // ---- state cards --------------------------------------------------------------------------------------------
  function showState(kind, title, detail, actions = []) {
    el.hidden = false;
    viewport.hidden = true;
    stateEl.hidden = false;
    clear(stateEl);
    // Element.append() would turn a null into the text "null": the parts are filtered first
    stateEl.append(...[
      kind === 'loading' ? h('span.br-spinner') : h('span.br-rd-state-icon', { html: icon('reader') }),
      h('h2', title),
      detail ? h('p', detail) : null,
      actions.length ? h('div.br-rd-state-actions', actions.map((a) => h('button.br-btn' + (a.primary ? '.primary' : ''), { type: 'button', onclick: a.onclick }, a.label))) : null,
    ].filter(Boolean));
  }
  const showLoading = (msg) => showState('loading', msg || T('Der Text wird aufbereitet …', 'Preparing the text …'));
  const showError = (msg, actions) => showState('error', T('Lesemodus nicht möglich', 'Reader mode not available'), msg, actions);

  // ---- content -------------------------------------------------------------------------------------------------
  function show(article, { progress } = {}) {
    art = article;
    clearFind(); clearSpeech();
    stateEl.hidden = true; viewport.hidden = false; el.hidden = false;
    clear(flow);
    const date = formatDate(article.published, B.lang);
    const kicker = [article.site, date].filter(Boolean).join(' · ');
    const src = h('a.br-rd-src', { href: article.url }, article.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''));
    body = h('div.br-rd-body', { html: article.html, lang: article.lang || null });
    flow.append(
      h('header.br-rd-head',
        kicker ? h('p.br-rd-kicker', kicker) : null,
        h('h1.br-rd-title', article.title),
        article.byline ? h('p.br-rd-byline', article.byline) : null,
        h('p.br-rd-meta', T('{n} Min. Lesezeit', '{n} min read', { n: article.minutes }))),
      body,
      h('footer.br-rd-end',
        h('p.br-rd-fleuron', '⁂'),
        h('p.br-rd-endsrc', T('Quelle: ', 'Source: '), src),
        article.next ? h('button.br-btn.primary.br-rd-next', { type: 'button', onclick: () => B.navigate(article.next, { reader: true }) }, T('Nächste Seite des Artikels', 'Next page of the article'), h('span', { html: icon('next') })) : null),
      h('span.br-rd-sentinel'));
    for (const img of body.querySelectorAll('img')) {
      img.addEventListener('load', scheduleLayout, { once: true });
      img.addEventListener('error', () => { img.closest('figure')?.classList.add('br-rd-broken'); img.remove(); scheduleLayout(); }, { once: true });
    }
    applyPrefs(false);
    layout({ progress: progress ?? 0 });
    if (document.fonts?.status !== 'loaded') document.fonts?.ready.then(() => { if (art === article) layout(); });
    hyphenateBody();
  }
  /** Soft hyphens into the article (once per article; the switch only changes the CSS). */
  function hyphenateBody() {
    const article = art, target = body;
    if (!article || !target || target.dataset.hyph || !B.prefs.hyphens) return;
    const lang = (article.lang || '').slice(0, 2);
    loadHyphenator(lang).then((fn) => {
      if (!fn || art !== article || body !== target || target.dataset.hyph) return;
      target.dataset.hyph = '1';
      hyphenateTree(target, fn);
      layout();
    });
  }
  function hide() { el.hidden = true; clearFind(); clearSpeech(); }

  // ---- typography ------------------------------------------------------------------------------------------------
  function applyPrefs(relayout = true) {
    const P = B.prefs;
    const keep = relayout && art ? anchor() : null;    // taken before the paging mode changes
    const f = FONTS[P.font] || FONTS.garamond;
    el.style.setProperty('--rd-font', f.css);
    el.style.setProperty('--rd-size', (P.fontSize * (f.scale || 1)).toFixed(1) + 'px');
    el.style.setProperty('--rd-lh', String(P.lineHeight));
    el.classList.toggle('justify', P.align === 'justify');
    el.classList.toggle('hyph', !!P.hyphens);
    el.classList.toggle('bold', !!P.bold);
    el.classList.toggle('black', !!P.black);
    el.classList.toggle('noimg', !P.readerImages || !P.images);
    paged = P.paging !== 'scroll';
    el.classList.toggle('scroll', !paged);
    if (P.hyphens) hyphenateBody();
    if (relayout && art) {
      layout({ keep });
      document.fonts?.load(`${P.fontSize}px ${f.css}`).then(() => { if (art) layout(); }).catch(() => {});
    }
  }

  // ---- layout / pagination -----------------------------------------------------------------------------------------
  function scheduleLayout() { clearTimeout(layoutTimer); layoutTimer = setTimeout(() => layout(), 120); }

  /** The first text position that is visible now (kept across a new layout). A paragraph that began on the
   *  previous page must not pull the anchor back there, so the caret under the page's first line is used. */
  function anchor() {
    if (!body || el.hidden || viewport.hidden) return null;
    const vr = viewport.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(flow).lineHeight) || 30;
    const onPage = (rr) => !paged || (rr.left >= vr.left - 2 && rr.left < vr.right);
    for (const [dx, dy] of [[4, lh * 0.5], [24, lh * 0.5], [4, lh * 1.5], [4, lh * 2.5], [4, lh * 4]]) {
      const c = document.caretRangeFromPoint?.(vr.left + dx, vr.top + dy);
      if (!c || !flow.contains(c.startContainer)) continue;
      const rr = c.getClientRects()[0] || c.getBoundingClientRect();
      if (rr && onPage(rr)) return c;
    }
    for (const b of flow.querySelectorAll(BLOCKS + ', img, figure, .br-rd-head')) {
      const r = b.getClientRects()[0];
      if (!r || r.width < 1 || !onPage(r) || r.bottom < vr.top || r.top > vr.bottom) continue;
      const rg = document.createRange(); rg.selectNodeContents(b); rg.collapse(true); return rg;
    }
    return null;
  }

  function layout({ progress, keep: given } = {}) {
    if (!art || el.hidden || viewport.hidden) return;
    const keep = given || (progress == null ? anchor() : null);
    const oldFrac = pages > 1 ? page / (pages - 1) : 0;
    const P = B.prefs;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 80) return;
    const f = FONTS[P.font] || FONTS.garamond;
    const fs = P.fontSize * (f.scale || 1);
    const [padY, padX] = MARGIN[P.margin] || MARGIN.normal;
    const colMax = P.measure ? P.measure * fs : Infinity;
    if (!paged) {
      geo = null;
      Object.assign(viewport.style, { left: '0px', top: '0px', width: r.width + 'px', height: r.height + 'px' });
      const w = Math.min(colMax, r.width - 2 * padX);
      Object.assign(flow.style, { width: Math.round(w) + 'px', height: 'auto', columnCount: 'auto', columnGap: 'normal', transform: 'none', margin: `0 auto`, padding: `${padY}px 0 ${padY * 2}px` });
      pages = 1; page = 0;
      if (keep) viewport.scrollTop += (keep.getClientRects()[0] || keep.getBoundingClientRect()).top - viewport.getBoundingClientRect().top - padY;
      else if (progress != null) viewport.scrollTop = Math.round(progress * Math.max(0, viewport.scrollHeight - viewport.clientHeight));
      report();
      return;
    }
    const availW = r.width - 2 * padX, availH = Math.floor(r.height - 2 * padY);
    const gap = Math.max(36, Math.round(fs * 2.4));
    let cols = 1;
    if (P.columns === '2') cols = availW >= 2 * 13 * fs + gap ? 2 : 1;
    else if (P.columns === 'auto') cols = availW >= 2 * Math.min(colMax, 22 * fs) + gap && r.width > r.height * 1.12 ? 2 : 1;
    const colW = Math.floor(Math.min(colMax, (availW - (cols - 1) * gap) / cols));
    const vw = cols * colW + (cols - 1) * gap;
    Object.assign(viewport.style, { left: Math.round((r.width - vw) / 2) + 'px', top: padY + 'px', width: vw + 'px', height: availH + 'px' });
    Object.assign(flow.style, { width: vw + 'px', height: availH + 'px', columnCount: String(cols), columnGap: gap + 'px', transform: 'none', margin: '0', padding: '0' });
    el.style.setProperty('--rd-page-h', availH + 'px');
    geo = { cols, colW, gap, vw, vh: availH, pitch: vw + gap };
    viewport.scrollLeft = 0; viewport.scrollTop = 0;
    const sentinel = flow.querySelector('.br-rd-sentinel');
    const x = sentinel.getBoundingClientRect().left - flow.getBoundingClientRect().left;
    const col = Math.max(0, Math.floor((x + 1) / (colW + gap)));
    pages = Math.floor(col / cols) + 1;
    if (keep) page = pageOfRange(keep);
    else if (progress != null) page = Math.max(0, Math.ceil(progress * pages) - 1);
    else page = Math.round(oldFrac * (pages - 1));
    go(page, true);
  }

  function pageOfRange(range) {
    if (!geo) return 0;
    const rects = range.getClientRects();
    const rr = rects.length ? rects[0] : range.getBoundingClientRect();
    const x = rr.left - flow.getBoundingClientRect().left;
    const col = Math.floor((x + 1) / (geo.colW + geo.gap));
    return clamp(Math.floor(col / geo.cols), 0, pages - 1);
  }

  function go(p, silent) {
    if (!paged || !geo) return false;
    const next = clamp(Math.round(p), 0, pages - 1);
    const moved = next !== page;
    page = next;
    flow.style.transform = `translateX(${-page * geo.pitch}px)`;
    report();
    return moved || !!silent;
  }
  function report() { B.onReaderPos?.(pos()); }

  function turn(dir) {
    if (!art) return false;
    if (paged) return go(page + dir);
    const lh = parseFloat(getComputedStyle(body || flow).lineHeight) || 30;
    const step = Math.max(viewport.clientHeight * 0.3, viewport.clientHeight - lh * (B.prefs.overlap || 1));
    const before = viewport.scrollTop;
    viewport.scrollTo({ top: before + dir * step, behavior: 'instant' });
    report();
    return viewport.scrollTop !== before;
  }
  function edge(end) {
    if (paged) return go(end ? pages - 1 : 0);
    viewport.scrollTo({ top: end ? viewport.scrollHeight : 0, behavior: 'instant' });
    report();
    return true;
  }
  function pos() {
    if (!art) return { page: 0, pages: 0, progress: 0 };
    if (paged) return { page: page + 1, pages, progress: pages ? (page + 1) / pages : 0, atEnd: page >= pages - 1 };
    const max = Math.max(1, viewport.scrollHeight - viewport.clientHeight);
    const step = Math.max(1, viewport.clientHeight * 0.9);
    const n = Math.max(1, Math.ceil(max / step) + 1);
    const atEnd = viewport.scrollTop >= max - 2;
    return { page: atEnd ? n : Math.floor(viewport.scrollTop / step) + 1, pages: n, progress: viewport.scrollHeight <= viewport.clientHeight ? 1 : Math.min(1, (viewport.scrollTop + viewport.clientHeight) / viewport.scrollHeight), atEnd };
  }

  // ---- input -----------------------------------------------------------------------------------------------------
  on(flow, 'click', (e) => {
    const a = e.target.closest('a[href]');
    if (a) {
      e.preventDefault();
      const href = a.getAttribute('href');
      if (href.startsWith('#')) { const t = body?.querySelector('#' + CSS.escape(href.slice(1))); if (t) reveal(rangeOf(t)); return; }
      B.navigate(href, { newTab: e.ctrlKey || e.metaKey, background: e.ctrlKey || e.metaKey });
    }
  });
  on(flow, 'auxclick', (e) => {
    const a = e.button === 1 && e.target.closest('a[href]');
    if (a && !a.getAttribute('href').startsWith('#')) { e.preventDefault(); B.navigate(a.getAttribute('href'), { newTab: true, background: true }); }
  });
  on(el, 'click', (e) => {
    if (!paged || !art || e.target.closest('a, button, input, select, .br-rd-state')) return;
    if (String(getSelection() || '').trim()) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    if (x < 0.3) { turn(-1); B.sfx?.('page'); } else if (x > 0.7) { turn(1); B.sfx?.('page'); }
  });
  on(el, 'wheel', (e) => {
    if (!paged || !art) return;
    e.preventDefault();
    const now = performance.now();
    if (now - wheelLast > 350) wheelAcc = 0;
    wheelLast = now;
    wheelAcc += Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(wheelAcc) >= 60 && now - wheelAt > 280) { turn(wheelAcc > 0 ? 1 : -1); wheelAt = now; wheelAcc = 0; }
  }, { passive: false });
  // keyboard focus on a link in another column must not scroll the clipped viewport behind our back
  on(viewport, 'scroll', () => {
    if (!paged || (!viewport.scrollLeft && !viewport.scrollTop)) return;
    viewport.scrollLeft = 0; viewport.scrollTop = 0;
    const f = document.activeElement;
    if (f && flow.contains(f)) go(pageOfRange(rangeOf(f)));
  });
  on(viewport, 'scroll', () => { if (!paged) report(); }, { passive: true });
  const ro = new ResizeObserver(() => scheduleLayout());
  ro.observe(el);
  offs.push(() => ro.disconnect());

  function rangeOf(node) { const r = document.createRange(); r.selectNodeContents(node); return r; }
  function reveal(range) {
    if (!range) return;
    if (paged) go(pageOfRange(range));
    else {
      const rr = range.getBoundingClientRect(), vr = viewport.getBoundingClientRect();
      if (rr.top < vr.top + 20 || rr.bottom > vr.bottom - 20) viewport.scrollTop += rr.top - vr.top - vr.height * 0.3;
      report();
    }
  }

  // ---- find ------------------------------------------------------------------------------------------------------
  function clearFind() {
    findRanges = []; findIdx = 0;
    if (hasHighlights()) { CSS.highlights.delete('br-find'); CSS.highlights.delete('br-find-now'); }
  }
  function find(q, { fresh = true, back = false } = {}) {
    if (!body) return null;
    if (fresh) {
      clearFind();
      const needle = String(q || '').toLocaleLowerCase();
      if (!needle) return null;
      const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n && findRanges.length < 1000; n = walker.nextNode()) {
        const { text, map } = plain(n);   // the soft hyphens of the hyphenation are invisible to the search
        const hay = text.toLocaleLowerCase();
        let i = hay.indexOf(needle);
        while (i >= 0 && findRanges.length < 1000) {
          const rg = document.createRange();
          rg.setStart(n, map ? map[i] : i);
          rg.setEnd(n, map ? map[i + needle.length - 1] + 1 : i + needle.length);
          findRanges.push(rg);
          i = hay.indexOf(needle, i + needle.length);
        }
      }
      if (!findRanges.length) return { active: 0, total: 0 };
      // start at the first hit on or after the current page
      findIdx = Math.max(0, findRanges.findIndex((rg) => !paged || pageOfRange(rg) >= page));
    } else if (findRanges.length) findIdx = (findIdx + (back ? -1 : 1) + findRanges.length) % findRanges.length;
    if (!findRanges.length) return { active: 0, total: 0 };
    if (hasHighlights()) {
      CSS.highlights.set('br-find', new Highlight(...findRanges));
      CSS.highlights.set('br-find-now', new Highlight(findRanges[findIdx]));
    }
    reveal(findRanges[findIdx]);
    return { active: findIdx + 1, total: findRanges.length };
  }

  // ---- read aloud --------------------------------------------------------------------------------------------------
  /** Sentences with their DOM ranges, from the current page (or the start) to the end. */
  function sentences({ fromCurrent = true } = {}) {
    if (!body) return [];
    const lang = art?.lang || B.lang || 'de';
    let seg;
    try { seg = new Intl.Segmenter(lang, { granularity: 'sentence' }); } catch { seg = new Intl.Segmenter('de', { granularity: 'sentence' }); }
    const blocks = [flow.querySelector('.br-rd-title'), ...[...body.querySelectorAll(BLOCKS)].filter((b) => !b.querySelector(BLOCKS))].filter(Boolean);
    const out = [];
    const startPage = fromCurrent && paged ? page : 0;
    const vr = viewport.getBoundingClientRect();
    for (const b of blocks) {
      if (b.closest('figure') && b.localName !== 'figcaption') continue;
      const nodes = [], strs = [];
      const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.parentElement?.closest('sup, .br-rd-src')) continue; nodes.push(n); strs.push(n.nodeValue); }
      const text = strs.join('');
      if (!text.trim()) continue;
      const bounds = [];
      let sum = 0;
      for (const s of strs) { bounds.push(sum); sum += s.length; }
      const at = (offset) => {
        let i = bounds.length - 1;
        while (i > 0 && bounds[i] > offset) i--;
        return [nodes[i], Math.min(offset - bounds[i], nodes[i].nodeValue.length)];
      };
      const raw = [];
      for (const { index, segment } of seg.segment(text)) { if (segment.trim()) raw.push({ start: index, end: index + segment.length, text: segment }); }
      const merged = [];
      for (const s of raw) {
        const prev = merged[merged.length - 1];
        if (prev && (ABBR_END.test(prev.text) || /^\s*\p{Ll}/u.test(s.text)) && prev.text.length + s.text.length < 600) { prev.text += s.text; prev.end = s.end; }
        else merged.push({ ...s });
      }
      for (const s of merged) {
        const t = s.text.replaceAll(SHY, '').replace(/\s+/g, ' ').trim();
        if (t.length < 2 || !/[\p{L}\p{N}]/u.test(t)) continue;
        const rg = document.createRange();
        const [sn, so] = at(s.start); const [en, eo] = at(Math.max(s.start, s.end - 1));
        rg.setStart(sn, so); rg.setEnd(en, Math.min(eo + 1, en.nodeValue.length));
        if (fromCurrent) {
          if (paged && pageOfRange(rg) < startPage) continue;
          if (!paged) { const rr = rg.getBoundingClientRect(); if (rr.bottom < vr.top) continue; }
        }
        out.push({ text: t, range: rg });
      }
    }
    return out;
  }
  function speak(range) {
    if (!range) return clearSpeech();
    if (hasHighlights()) CSS.highlights.set('br-tts', new Highlight(range));
    reveal(range);
  }
  function clearSpeech() { if (hasHighlights()) CSS.highlights.delete('br-tts'); }

  return {
    el, show, hide, showLoading, showError, applyPrefs, layout: () => layout(),
    next: () => turn(1), prev: () => turn(-1), first: () => edge(false), last: () => edge(true),
    pos, find, clearFind, sentences, speak, clearSpeech,
    get article() { return art; },
    get visible() { return !el.hidden && !!art && !viewport.hidden; },
    destroy() { for (const off of offs.splice(0)) { try { off(); } catch {} } clearTimeout(layoutTimer); clearFind(); clearSpeech(); },
  };
}

/** The date of an article in the language of the interface (it was always German, also in the English reader mode). */
export function formatDate(s, lang = 'de') {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
}
