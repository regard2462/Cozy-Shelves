// Text on signs: the directory in the passage, the department signs, the shelf labels, the card in the empty
// "recently read" case and the plates on the furniture. Every canvas is as large as its sign needs at a fixed texel
// density (a sign that is twice as wide gets twice the pixels), with mipmaps, the card's full anisotropy and sRGB.
// A sign is drawn once per content: rebuilding the shelves after every returned book reuses what is there. A new one
// is drawn on a later frame and put on the graphics card on the next (one job a frame), so no rebuild stalls on it;
// until then the sign shows its plain background colour. Once on the graphics card with its real fonts, a sign lets its
// canvas go (three.js keeps the texture and uploads it only when told to): some 65 MB for a large library. Told to
// (a restored WebGL context, anything that sets needsUpdate), it is drawn again.
import * as THREE from 'three';

/**
 * Texels per metre. `close`: what you can walk up to (the directory, the plates on the furniture): one texel per
 * screen pixel of a 1440p picture with a 72° field of view at 50 cm, so small text stays crisp from 30 to 50 cm
 * (the 0.5 board had 711 texels per metre and blurred at that distance). `shelf`: the shelf labels and the card in
 * the empty case, which the display boards keep at 62 cm and more. `high`: the department signs above the cases,
 * seen from 1.1 m and further.
 */
export const SIGN_DENSITY = { close: 2000, shelf: 1600, high: 900 };

const cache = new Map();       // key → entry { key, kind, w, h, metres, draw, bg, tex, state, mats, group, gen, fonts }
const queue = [];              // entries to draw (state 'queued'), to upload (state 'drawn') or to draw again (redraw)
const flat = new Map();        // background colour → 1 × 1 texture shown until the sign is ready
const gens = new Map();        // group → generation of its latest build
const released = new Set();    // ready entries whose canvas is let go (drawn again when their texture is to go up again)
let renderer = null, maxAniso = 8;

// The web fonts of the signs. A canvas that draws before they are loaded silently falls back to Georgia: such a sign is
// drawn again, into the same texture, once they are there.
const FONTS = ['600 40px "Cormorant Garamond"', '600 40px "EB Garamond"', '600 28px "Segoe UI"'];
let fontsReady = typeof document === 'undefined' || !document.fonts;
if (!fontsReady) {
  Promise.all(FONTS.map((f) => document.fonts.load(f).catch(() => null))).then(() => {
    fontsReady = true;
    for (const e of cache.values()) if (e.state === 'ready' && !e.fonts && e.draw) { e.redraw = true; queue.push(e); }
  });
}

function placeholder(bg) {
  let t = flat.get(bg);
  if (!t) {
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, 1, 1);
    t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    flat.set(bg, t);
  }
  return t;
}

export const signs = {
  setRenderer(r) {
    renderer = r; maxAniso = Math.max(1, r?.capabilities?.getMaxAnisotropy?.() || 8);
    // a restored WebGL context uploads every texture again: the signs without a canvas are drawn again (pump)
    r?.domElement?.addEventListener?.('webglcontextrestored', () => { for (const e of released) e.tex.needsUpdate = true; });
  },
  /** A build of `group` ('shelves', 'furniture') starts: what it does not ask for again is freed at end(group). */
  begin(group) { gens.set(group, (gens.get(group) || 0) + 1); },
  end(group) {
    const gen = gens.get(group);
    for (const [k, e] of cache) if (e.group === group && e.gen !== gen) { cache.delete(k); released.delete(e); e.tex?.dispose(); e.state = 'gone'; }
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].state === 'gone') queue.splice(i, 1);
  },
  /**
   * The sign `key`: a w × h canvas for a sign of `metres` [width, height], drawn by draw(ctx) when its turn comes.
   * @returns the entry; signs.use(entry, material, slots) puts its texture (or the background until it is ready)
   *          into the material's slots.
   */
  get(key, { kind, w, h, metres, draw, bg = '#ffffff', group = 'shelves' }) {
    let e = cache.get(key);
    if (!e) {
      e = { key, kind, w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), metres, draw, bg, tex: null, state: 'queued', mats: [], group };
      cache.set(key, e); queue.push(e);
    }
    e.gen = gens.get(e.group) || 0;
    return e;
  },
  use(e, material, slots = ['map']) {
    const t = e.state === 'ready' ? e.tex : placeholder(e.bg);
    for (const s of slots) material[s] = t;
    material.userData.keepMap = true;          // the texture belongs to this cache (world.js disposeTree)
    if (e.state !== 'ready') e.mats.push([material, slots]);
    return material;
  },
  /** One job a frame: draw the next sign, or put the one drawn before on the graphics card and show it. */
  pump() {
    // a sign without its canvas whose texture is to go up again comes first: drawn and uploaded in one job
    for (const e of released) if (e.tex.version !== e.uploaded) { released.delete(e); e.redraw = true; queue.unshift(e); }
    const e = queue[0]; if (!e) return false;
    if (e.redraw) { queue.shift(); e.redraw = false; this.paint(e); this.upload(e); e.state = 'ready'; this.release(e); return true; }
    if (e.state === 'queued') { this.paint(e); return true; }
    queue.shift();
    this.upload(e);
    this.show(e);
    this.release(e);
    return true;
  },
  upload(e) {
    const t0 = performance.now(); e.onCard = false;
    try { if (renderer) { renderer.initTexture(e.tex); e.onCard = true; } } catch {}
    e.uploadMs = performance.now() - t0;
  },
  /** On the graphics card with its real fonts, a sign needs its canvas no more: three.js keeps the texture and
   *  uploads it only when told to (then pump draws the sign again). */
  release(e) {
    if (!e.onCard || !e.fonts || e.state !== 'ready' || !e.tex) return;
    e.tex.image = null; e.uploaded = e.tex.version; released.add(e);
  },
  /** Everything now (the first build behind the start screen, tests). */
  flush() { while (queue.length) this.pump(); },
  paint(e) {
    const t0 = performance.now();
    const c = document.createElement('canvas'); c.width = e.w; c.height = e.h;
    const g = c.getContext('2d');
    g.fillStyle = e.bg; g.fillRect(0, 0, e.w, e.h);
    e.draw(g, e.w, e.h);
    e.fonts = fontsReady;
    if (e.tex) { e.tex.image = c; e.tex.needsUpdate = true; }   // drawn again (the web fonts arrived): the same texture
    else {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
      t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      e.tex = t;
    }
    e.state = 'drawn'; e.paints = (e.paints || 0) + 1;
    e.paintMs = performance.now() - t0;                         // (draw stays: the sign may have to be drawn again)
  },
  show(e) {
    if (e.state !== 'drawn') return;
    e.state = 'ready';
    for (const [m, slots] of e.mats) for (const s of slots) m[s] = e.tex;
    e.mats.length = 0;
  },
  get pending() { return queue.length; },
  /** For the checks: the entries of one kind. */
  entries(kind) { return [...cache.values()].filter((e) => !kind || e.kind === kind); },
  /** For the checks: every sign with its size, texel density, mipmaps, anisotropy and colour space; `bytes` is its
   *  texture on the graphics card (with mipmaps), `canvasBytes` the canvases still held. */
  stats() {
    const list = [...cache.values()].map((e) => ({
      key: e.key.slice(0, 60), kind: e.kind, w: e.w, h: e.h, metres: e.metres, ready: e.state === 'ready', canvas: !!e.tex?.image, paints: e.paints || 0,
      density: e.metres ? Math.min(e.w / e.metres[0], e.h / e.metres[1]) : null,
      mipmaps: !!e.tex?.generateMipmaps && e.tex.minFilter === THREE.LinearMipmapLinearFilter, anisotropy: e.tex?.anisotropy ?? null,
      srgb: e.tex?.colorSpace === THREE.SRGBColorSpace, bytes: Math.round(e.w * e.h * 4 * 4 / 3),
      paintMs: e.paintMs != null ? +e.paintMs.toFixed(1) : null, uploadMs: e.uploadMs != null ? +e.uploadMs.toFixed(1) : null,
    }));
    return { list, bytes: list.reduce((a, s) => a + s.bytes, 0), canvasBytes: list.reduce((a, s) => a + (s.canvas ? s.w * s.h * 4 : 0), 0), maxAnisotropy: maxAniso, queued: queue.length };
  },
};
