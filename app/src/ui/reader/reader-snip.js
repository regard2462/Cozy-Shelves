// Diagram snip in the reader, like the Windows Snipping Tool: the page dims, the cursor becomes a crosshair, a
// rectangle is dragged over a chess diagram, Esc cancels. The rectangle is captured at a high resolution (a PDF
// page is rendered again by pdf.js just for that region; pictures in EPUB, comic and other pages are taken at
// their own resolution; the screen as a last resort), recognised offline (app/src/ui/chess/diagram) and set up
// on the board of the chess pane. Coordinates and a caption such as "Schwarz am Zug" are read from the text
// layer of the page when there is one.
import { h } from '../../core/dom.js';

const MIN = 24;   // smallest rectangle (CSS pixels) that counts as a snip

export function createSnip(R) {
  const { els, T } = R;
  let layer = null, rect = null, start = null, busy = false;

  function isActive() { return !!layer; }

  function cancel() {
    if (!layer || busy) return false;
    layer.remove(); layer = null; rect = null; start = null;
    return true;
  }

  function begin() {
    if (layer) return;
    R.annotations?.hideAll?.();
    layer = h('div.rd-snip', { tabindex: -1 },
      h('div.rd-snip-hint', T('Rahmen um ein Diagramm ziehen. Esc bricht ab.', 'Drag a frame around a diagram. Esc cancels.')));
    rect = h('div.rd-snip-rect.hidden');
    layer.append(rect);
    els.stage.append(layer);
    layer.focus({ preventScroll: true });
    const sr = () => els.stage.getBoundingClientRect();
    const pos = (e) => { const r = sr(); return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) }; };
    layer.addEventListener('pointerdown', (e) => {
      if (busy) return;
      if (e.button !== 0) { cancel(); return; }
      e.preventDefault();
      layer.setPointerCapture?.(e.pointerId);
      start = pos(e);
      layer.classList.add('dragging');
      rect.classList.remove('hidden');
      draw(start, start);
    });
    layer.addEventListener('pointermove', (e) => { if (start && !busy) draw(start, pos(e)); });
    layer.addEventListener('pointerup', (e) => {
      if (!start || busy) return;
      const end = pos(e);
      const r = box(start, end);
      start = null;
      if (r.w < MIN || r.h < MIN) { layer.classList.remove('dragging'); rect.classList.add('hidden'); return; }
      finish(r);
    });
    layer.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); });
    layer.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } });
  }

  const box = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  function draw(a, b) {
    const r = box(a, b);
    Object.assign(rect.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  }

  /** stage-relative rectangle → recognised position, handed to the chess pane */
  async function finish(r) {
    busy = true;
    layer.classList.add('working');
    rect.append(h('div.rd-snip-busy', h('div.rd-spinner.small'), h('span', T('Erkenne die Stellung …', 'Reading the position …'))));
    try {
      const shot = await capture(r);
      if (!shot) throw new Error('no-capture');
      window.__lastSnip = shot;   // tests save what was captured
      await R.onSnip?.(shot);
    } catch (e) {
      console.warn('[reader] snip failed', e);
      R.showNotice?.(e?.message === 'no-board'
        ? T('Kein Brett gefunden. Ziehe den Rahmen enger um das Diagramm.', 'No board found. Drag the frame closer around the diagram.')
        : T('Das Diagramm konnte nicht gelesen werden.', 'The diagram could not be read.'), 4200);
    } finally {
      busy = false;
      if (layer) { layer.remove(); layer = null; rect = null; }
    }
  }

  /** the content under a stage rectangle as RGBA pixels: { data, width, height, scale, source, hints } */
  async function capture(r) {
    const stage = els.stage.getBoundingClientRect();
    const client = { left: stage.left + r.x, top: stage.top + r.y, right: stage.left + r.x + r.w, bottom: stage.top + r.y + r.h };
    // the page documents under the rectangle, by overlap
    const docs = (R.view?.renderer?.getContents?.() || []).map((c) => c.doc).filter((d) => d?.defaultView?.frameElement)
      .map((doc) => ({ doc, fr: doc.defaultView.frameElement.getBoundingClientRect() }))
      .map((o) => ({ ...o, overlap: Math.max(0, Math.min(o.fr.right, client.right) - Math.max(o.fr.left, client.left)) * Math.max(0, Math.min(o.fr.bottom, client.bottom) - Math.max(o.fr.top, client.top)) }))
      .filter((o) => o.overlap > 0).sort((a, b) => b.overlap - a.overlap);
    const pdfPage = docs.find((o) => o.doc.querySelector('#canvas > canvas'));
    if (pdfPage && R.fbook?.pdf) {
      const shot = await capturePdf(pdfPage, client);
      if (shot) return shot;
    }
    for (const o of docs) {
      const shot = await captureImages(o, client);
      if (shot) return shot;
    }
    return captureScreen(client);
  }

  /** a PDF region rendered again at about 1000 pixels on its longer side */
  async function capturePdf({ doc, fr }, client) {
    const canvas = doc.querySelector('#canvas > canvas');
    const index = canvas.pageIndex ?? R.docIndex?.get(doc);
    if (index == null) return null;
    const page = await R.fbook.pdf.getPage(index + 1);
    const vp1 = page.getViewport({ scale: 1 });
    const zoom = fr.width / vp1.width;
    const x0 = Math.max(0, (client.left - fr.left) / zoom), y0 = Math.max(0, (client.top - fr.top) / zoom);
    const x1 = Math.min(vp1.width, (client.right - fr.left) / zoom), y1 = Math.min(vp1.height, (client.bottom - fr.top) / zoom);
    const w = x1 - x0, hh = y1 - y0;
    if (w < 8 || hh < 8) return null;
    const scale = Math.max(1.5, Math.min(7, 1000 / Math.max(w, hh)));
    const out = document.createElement('canvas');
    out.width = Math.round(w * scale); out.height = Math.round(hh * scale);
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
    const viewport = page.getViewport({ scale, offsetX: -x0 * scale, offsetY: -y0 * scale });
    await page.render({ canvasContext: ctx, viewport }).promise;
    const img = ctx.getImageData(0, 0, out.width, out.height);
    return { data: img.data, width: out.width, height: out.height, canvas: out, source: 'pdf', page: index, hints: textHints(doc, fr, client) };
  }

  /** text of a PDF page near the snip (its text layer): coordinate letters in order, a caption naming the side
   *  to move */
  function textHints(doc, fr, client) {
    // the text layer is scaled with the page document (transform on <html>): its client rects are in iframe px
    return hintsFrom([...doc.querySelectorAll('.textLayer span')].map((s) => ({ t: s.textContent, b: s.getBoundingClientRect() })), fr, 1, client);
  }

  /** the same for the text of an EPUB page: the caption under a diagram picture */
  function domHints(doc, fr, scale, client) {
    const items = [];
    const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_TEXT);
    const range = doc.createRange();
    const top = (client.top - fr.top) / scale - 400, bottom = (client.bottom - fr.top) / scale + 400;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      range.selectNodeContents(n);
      const b = range.getBoundingClientRect();
      if (b.bottom < top || b.top > bottom) continue;
      items.push({ t: n.textContent, b });
    }
    return hintsFrom(items, fr, scale, client);
  }

  /** hints from text pieces { t, b (client rect in the page document) } around the snip */
  function hintsFrom(items, fr, scale, client) {
    const hits = [];
    let caption = '';
    const pad = (client.bottom - client.top) * 0.25;
    for (const { t: raw, b } of items) {
      const t = (raw || '').trim();
      if (!t) continue;
      const cx = fr.left + ((b.left + b.right) / 2) * scale, cy = fr.top + ((b.top + b.bottom) / 2) * scale;
      if (cx >= client.left && cx <= client.right && cy >= client.top - pad * 0.3 && cy <= client.bottom + pad) {
        if (/^[a-h]$/.test(t) && cy > (client.top + client.bottom) / 2) hits.push({ t, x: cx });
        if (t.length > 3) caption += ' ' + t;
      }
    }
    hits.sort((a, b) => a.x - b.x);
    const files = hits.map((x) => x.t).join('');
    return {
      files: files === 'abcdefgh' || files === 'hgfedcba' ? files : null,
      toMove: /schwarz (ist )?am zug|schwarz zieht|black to (move|play)|black moves/i.test(caption) ? 'black' : /wei(ß|ss) (ist )?am zug|wei(ß|ss) zieht|white to (move|play)|white moves/i.test(caption) ? 'white' : null,
    };
  }

  /** pictures (img, svg, canvas) of a page under the rectangle, drawn at their own resolution */
  async function captureImages({ doc, fr }, client) {
    const frame = doc.defaultView.frameElement;
    const sx = frame.offsetWidth ? fr.width / frame.offsetWidth : 1, sy = frame.offsetHeight ? fr.height / frame.offsetHeight : 1;
    const els2 = [...doc.querySelectorAll('img, canvas, svg image, image')];
    const parts = [];
    for (const el of els2) {
      const b = el.getBoundingClientRect();
      const left = fr.left + b.left * sx, top = fr.top + b.top * sy, right = left + b.width * sx, bottom = top + b.height * sy;
      const ov = Math.max(0, Math.min(right, client.right) - Math.max(left, client.left)) * Math.max(0, Math.min(bottom, client.bottom) - Math.max(top, client.top));
      if (ov < 0.2 * (client.right - client.left) * (client.bottom - client.top)) continue;
      const nat = el.naturalWidth || el.width?.baseVal?.value || el.width || 0;
      parts.push({ el, left, top, right, bottom, res: nat && b.width ? nat / (b.width * sx) : 1 });
    }
    if (!parts.length) return null;
    const res = Math.max(1, Math.min(4, Math.max(...parts.map((p) => p.res))));
    const W = Math.round((client.right - client.left) * res), H = Math.round((client.bottom - client.top) * res);
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    try {
      for (const p of parts) {
        let src = p.el;
        if (p.el.tagName?.toLowerCase() === 'image') { const href = p.el.getAttribute('href') || p.el.getAttribute('xlink:href'); src = new Image(); src.src = href; await src.decode(); }
        ctx.drawImage(src, (p.left - client.left) * res, (p.top - client.top) * res, (p.right - p.left) * res, (p.bottom - p.top) * res);
      }
      const img = ctx.getImageData(0, 0, W, H);
      return { data: img.data, width: W, height: H, canvas: out, source: 'image', hints: domHints(doc, fr, sx, client) };
    } catch (e) { console.warn('[reader] snip: image not readable', e); return null; }
  }

  /** the window itself (text drawn with a chess font in an EPUB): the screen resolution is all there is */
  async function captureScreen(client) {
    const cap = R.api?.app?.capturePage;
    if (typeof cap !== 'function') return null;
    if (layer) layer.style.visibility = 'hidden';
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    let url = null;
    try { url = await cap({ x: Math.round(client.left), y: Math.round(client.top), width: Math.round(client.right - client.left), height: Math.round(client.bottom - client.top) }); }
    finally { if (layer) layer.style.visibility = ''; }
    if (!url) return null;
    const img = new Image(); img.src = url; await img.decode();
    const out = document.createElement('canvas');
    out.width = img.naturalWidth; out.height = img.naturalHeight;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, out.width, out.height);
    return { data: data.data, width: out.width, height: out.height, canvas: out, source: 'screen', hints: {} };
  }

  return { begin, cancel, isActive, capture };
}
