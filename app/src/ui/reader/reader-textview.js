// The text view of a PDF in the reader: the switch between the pages of the PDF and its text (pdf-text-view.js), the
// place in PDF pages (labels, progress, bookmarks, the saved position), and the hint that offers the text view the
// first times a PDF with text is opened. The switch is remembered per book (settings.reader.textView).
//
// The PDF book of foliate stays R.fbook (snip, read-aloud and search use its pdf.js document); the view shows either
// that book (fixed layout) or the reflowable book of the text view. Positions are kept as page CFIs of the PDF
// (epubcfi(/6/2n)), so the page view, the shelf "Zuletzt gelesen" and the bookmarks keep working; the exact place
// inside the text view is kept per book in localStorage (it comes back when it lies on the saved page).
import { h } from '../../core/dom.js';
import { createTextView, pdfPageCfi, pageOfPdfCfi, TEXT_CFI_PREFIX } from './pdf-text-view.js';
import { inspectText } from './tts-junk.js';

const POS_KEY = 'lesesaal.reader.textpos';
const MAX_POS = 300;
const HINTS = 3;
const readPos = () => { try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}') || {}; } catch { return {}; } };
const raf = () => new Promise((r) => requestAnimationFrame(() => r()));

export function createTextViewSwitch(R, hooks) {
  const { T } = R;
  let tv = null, active = false, busy = false, hintEl = null, hintTimer = null, posTimer = null;
  const settings = R.settings;
  const pdfBook = () => (R.fbook?.pdf && R.record?.format === 'pdf' ? R.fbook : null);
  const bookId = () => (R.record && !R.record._dev ? R.record.id : null);
  const available = () => !!pdfBook();
  const wanted = () => { const id = bookId(); return !!(id && settings.textView?.[id]); };

  async function ensure() {
    if (tv) return tv;
    const book = pdfBook();
    const rec = R.record || {};
    tv = await createTextView({
      pdf: book.pdf, CFI: R.CFI, key: `${rec.id || R.bookUrl}:${rec.size || ''}:${rec.mtime || ''}`,
      title: R.title, author: R.author, lang: R.lang || 'de', uiLang: R.uiLang, chess: !!rec.isChess,
    });
    return tv;
  }

  /** The PDF page on screen (page view: the section; text view: where the visible text starts). */
  function currentPage() {
    const loc = R.loc;
    if (!loc) return pageOfPdfCfi(R.record?.lastLocation) ?? 0;
    if (loc.pdf) return loc.pdf.page;
    return loc.section?.current ?? 0;
  }

  /** remembers the exact place in the text view for this book (the page CFI goes to the library as usual) */
  function savePos(page, cfi) {
    const id = bookId();
    if (!id || !cfi || !String(cfi).startsWith(TEXT_CFI_PREFIX)) return;
    clearTimeout(posTimer);
    posTimer = setTimeout(() => {
      try {
        const all = readPos();
        all[id] = { page, cfi, v: tv?.ASSEMBLY_VERSION, at: Date.now() };
        const ids = Object.keys(all);
        if (ids.length > MAX_POS) for (const k of ids.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, ids.length - MAX_POS)) delete all[k];
        localStorage.setItem(POS_KEY, JSON.stringify(all));
      } catch { /* storage full or blocked: the page is enough */ }
    }, 600);
  }
  function savedPos(page) {
    const id = bookId();
    const p = id ? readPos()[id] : null;
    return p && p.page === page && p.v === tv?.ASSEMBLY_VERSION ? p.cfi : null;
  }

  /** The target of the text view for a target of the reader (a page CFI, a page index, a CFI of the text view …). */
  const mapTarget = (target) => (active && tv ? tv.mapTarget(target) : target);

  /**
   * The book the reader opens for this PDF and where: the text view when it is on for this book.
   * @returns {Promise<{ book: object, target: any }|null>} null: the page view
   */
  async function initial(target) {
    if (!available() || !wanted()) return null;
    try {
      await ensure();
      const page = pageOfPdfCfi(target) ?? (typeof target === 'number' ? target : 0);
      await tv.prepare(page);
      active = true;
      return { book: tv.book, target: savedPos(page) || tv.hrefOfPage(page) };
    } catch (e) {
      console.warn('[reader] text view could not be built', e);
      active = false;
      return null;
    }
  }

  /** Switches the text view on or off at the page that is on screen. */
  async function set(on) {
    on = !!on;
    if (!available() || busy || R.closed || on === active) return false;
    busy = true;
    hideHint();
    const page = currentPage();
    let slow = null;
    try {
      try { R.tts.stop?.(); } catch {}
      R.annotations.hideAll();
      R.snip?.cancel?.();
      await hooks.flushSave?.();
      if (on) {
        slow = setTimeout(() => hooks.showLoading?.(T('Text wird aufgebaut …', 'Building the text …')), 160);
        await ensure();
        await tv.prepare(page);
      }
      const target = on ? (savedPos(page) || tv.hrefOfPage(page)) : pdfPageCfi(page);
      try { R.view.close(); } catch {}
      await raf(); await raf();
      if (R.closed) return false;
      await R.view.open(on ? tv.book : pdfBook());
      active = on;
      // the background work of the text view only runs while it is shown
      if (on) tv.resume(); else tv?.pause();
      R.isFixed = !!R.view.isFixedLayout;
      await raf();
      hooks.afterOpen?.();
      try { await R.view.init({ lastLocation: target }); }
      catch (e) { console.warn('[reader] view switch: init failed', e); try { await R.view.init({ lastLocation: on ? tv.hrefOfPage(0) : pdfPageCfi(0) }); } catch {} }
      remember(on);
      if (on) { settings.textViewHints = HINTS; hooks.persist?.(); }
      return true;
    } catch (e) {
      console.warn('[reader] view switch failed', e);
      R.showNotice?.(T('Die Textansicht konnte nicht aufgebaut werden.', 'The text view could not be built.'), 4000);
      return false;
    } finally {
      clearTimeout(slow);
      hooks.hideLoading?.();
      busy = false;
      hooks.afterSwitch?.();
    }
  }
  function remember(on) {
    const id = bookId();
    if (!id) return;
    // off is kept as false: the main process merges the settings key by key, a deleted key would stay on
    settings.textView = { ...(settings.textView || {}), [id]: on };
    hooks.persist?.();
  }

  /** The PDF pages of a relocate event in the text view: { page, last, total } (else null). */
  function relocate(detail) {
    if (!active || !tv || !detail) return null;
    const [page, last] = tv.pagesOf(detail.range, detail.index);
    tv.touch();
    savePos(page, detail.cfi);
    return { page, last, total: tv.numPages };
  }

  // ---- the hint
  function hideHint() {
    clearTimeout(hintTimer);
    if (hintEl) { hintEl.remove(); hintEl = null; }
  }
  /** Offers the text view the first times a PDF with text is shown in the page view. Resolves true when it did. */
  async function maybeHint() {
    if (!available() || active || wanted() || (settings.textViewHints || 0) >= HINTS || !bookId()) return false;
    // only PDFs with a text layer that a voice could read
    let text = '';
    try {
      const pdf = pdfBook().pdf;
      const first = Math.min(pdf.numPages - 1, currentPage());
      for (let p = first; p < Math.min(pdf.numPages, first + 3); p++) {
        const tc = await (await pdf.getPage(p + 1)).getTextContent();
        text += tc.items.map((it) => it.str || '').join(' ') + ' ';
      }
    } catch { return false; }
    if (R.closed || active || text.replace(/\s+/g, '').length < 200 || inspectText(text).junk) return false;
    settings.textViewHints = (settings.textViewHints || 0) + 1;
    hooks.persist?.();
    hideHint();
    hintEl = h('div.rd-tvhint', { role: 'dialog', 'aria-label': T('Textansicht', 'Text view') },
      h('button.rd-btn.small.rd-btn-close.rd-tvhint-close', { title: T('Schließen', 'Close'), 'aria-label': T('Schließen', 'Close'), onclick: () => hideHint() }, '✕'),
      h('div.rd-tvhint-text', T('Dieses PDF lässt sich auch als Fließtext lesen, mit eigener Schrift, Schriftgröße und Seitenbreite.',
        'This PDF can also be read as flowing text, with your own font, font size and page width.')),
      h('div.rd-tvhint-actions',
        h('button.btn.small.primary', { onclick: () => set(true) }, T('Textansicht einschalten', 'Switch to text view'), h('kbd', 'X')),
        h('button.btn.small.ghost', { onclick: () => { settings.textViewHints = HINTS; hooks.persist?.(); hideHint(); } }, T('Nicht mehr zeigen', 'Do not show again'))));
    R.els.stage.append(hintEl);
    hintTimer = setTimeout(hideHint, 14000);
    return true;
  }

  const handle = {
    available, wanted, initial, set, relocate, mapTarget, currentPage, maybeHint, hideHint,
    toggle: () => set(!active),
    get active() { return active; },
    get busy() { return busy; },
    get view() { return tv; },
    /** the PDF pages a bookmark covers on this screen (text view) */
    bookmarkPages: (bm) => (bm.page != null ? bm.page - 1 : pageOfPdfCfi(bm.location)),
    destroy() { hideHint(); clearTimeout(posTimer); try { tv?.destroy(); } catch {} tv = null; try { if (window.__readerText === handle) window.__readerText = null; } catch {} },
  };
  // for the checks (build/scripts/reader-text-check.js)
  try { window.__readerText = handle; } catch {}
  return handle;
}
