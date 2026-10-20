// Books on shelves: instanced meshes with a spine-title atlas, the hovered book pulled out and turned towards the
// viewer (showing the whole cover in its own proportions, the turn stopping a little short so that the spine and the
// page block stay in view), face-out "presentation" copies, hide/show for borrowed books, plus stand-alone book
// meshes (with cover texture) for animations, tables and the basket.
//
// Hovering must never stutter, so nothing is created while you look along a shelf:
//  • a small pool of hover meshes with their materials is made once; a hover only sets colours, maps and uniforms
//    (no new geometry, no new material, no new shader program);
//  • cover images are decoded off the main thread (createImageBitmap, scaled to what a book in the room needs) and
//    put on the graphics card from a queue, at most two a frame, before anything shows them; the covers around the
//    crosshair are fetched ahead, the title cards of books without a cover are drawn ahead in idle time;
//  • picking tests the books of the cases the ray passes through (boxes), not every triangle.
// The cover faces at the ends of the rows and next to gaps show the cover picture (side-covers.js).
import * as THREE from 'three';
import { BOOKCASE } from './furniture.js';
import { spineWidth, bookHeight } from './layout.js';
import { hashStr, seeded, clamp } from './geo.js';
import { M } from './materials.js';
import { withShelfGlow } from './shelf-light.js';
import { CELL_W, CELL_H, bindingColor, hasCoverImage, spineCell, spineCanvas, spineDrawingKey, reserveSpines, drawTypoCover, fontsLoaded, whenFontsLoaded } from './book-art.js';
import { typoCoverUrl } from '../core/cover-art.js';
import { SideCovers, SIDE_UNIFORMS, SIDE_CELL, SIDE_COLS, SIDE_FADE, sideCrop } from './side-covers.js';

const ATLAS = 4096;
const COLS = ATLAS / CELL_W, ROWS = ATLAS / CELL_H, PER_ATLAS = COLS * ROWS;
const BOOK_DEPTH = 0.2;
const UNIT_BOX = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));

// hover motion: pulled straight out until the fore edge is clear of the case, then turned to face the viewer. The
// turned cover hides a few neighbours: once the crosshair is on one of them, the book goes back quickly.
const HOVER_IN = 0.28, HOVER_OUT = 0.14;         // seconds
const HOVER_DWELL = 0.09;                        // the crosshair rests this long on a book before it comes out
const HOVER_SLOTS = 3;
const MAX_TURN = 1.4;                            // radians away from the shelf direction at most (seen from the side)
// the turn stops this far short of facing the viewer (18°): the spine stays in view beside the cover and the book
// reads as a solid thing, not as a picture hanging in the air
const TURN_SHORT = 0.31;
// the tilt stops this far short of the viewer's elevation (6°): a book below the eye shows the head of its page block,
// one above the eye its foot (from eye level only the spine shows; a thin book's spine is a sliver)
const TILT_SHORT = 0.1;
// the pulled-out book takes the proportions of its cover picture (width = height × aspect), within these bounds; a
// wider or narrower picture is fitted to the bound (a tenth at most for a square cover)
const COVER_ASPECT_MIN = 0.55, COVER_ASPECT_MAX = 0.9;
const WIDEN_RATE = 10;                           // per second: a cover that arrives late widens the book smoothly

export { bindingColor, hasCoverImage };

/** How deep a book on the shelf is (from the spine to the fore edge): a little less than the shelf, per book. */
export function bookDepth(book) { return BOOK_DEPTH - Math.abs(seeded(hashStr(book.id + 'd'))() * 0.04); }

function makeBookGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const uv = g.attributes.uv;
  // faces +x −x +y −y +z −z: the two covers keep their picture coordinates, shifted to 2…3 (the front, right of the
  // spine) and 4…5 (the back); the head and the foot are marked −2 and −3, the fore edge −1 (the binding colour); the
  // spine keeps 0…1 (its cell of the atlas)
  const shift = [2, 4, null, null, 0, null], mark = [null, null, -2, -3, null, -1];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; if (mark[f] != null) uv.setXY(i, mark[f], mark[f]); else uv.setX(i, uv.getX(i) + shift[f]); }
  uv.needsUpdate = true;
  return g;
}

function makeSpineMaterial(atlasTexture) {
  const mat = new THREE.MeshStandardMaterial({ map: atlasTexture, roughness: 0.75, metalness: 0.02 });
  const { w, h, pad } = SIDE_CELL, cw = w - 2 * pad, ch = h - 2 * pad;
  mat.onBeforeCompile = (shader) => {
    // the covers at the ends of the rows (side-covers.js): aSide = cell of the side atlas, start of the fade, shown
    Object.assign(shader.uniforms, SIDE_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aAtlas;\nvarying vec4 vAtlas;\nattribute vec4 aSide;\nuniform vec2 uSideSize;\nuniform float uSideTime;\nvarying vec3 vSide;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vAtlas = aAtlas;
        float sideRow = floor((aSide.x + 0.5) / ${SIDE_COLS}.0);
        vSide = vec3((vec2(aSide.x - sideRow * ${SIDE_COLS}.0, sideRow) * vec2(${w}.0, ${h}.0) + ${pad}.0) / uSideSize, aSide.z * clamp((uSideTime - aSide.y) / ${SIDE_FADE.toFixed(3)}, 0.0, 1.0));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vAtlas;\nuniform sampler2D uSideAtlas;\nuniform vec2 uSideSize;\nvarying vec3 vSide;')
      .replace('#include <map_fragment>', `
        vec4 sampledDiffuseColor = vec4(1.0);
        float coverMix = 0.0;                                            // the share of a cover face that shows its picture
        bool bound = vMapUv.x < 0.0 && vMapUv.x > -1.5;                  // the binding colour (fore edge, plain covers)
        if (vMapUv.x > 1.5) {
          // a cover: the front (2…3) or the back (4…5), the picture fading in over the binding colour
          bound = true;
          coverMix = vSide.z;
          if (coverMix > 0.0) {
            vec2 f = clamp(vec2(vMapUv.x - (vMapUv.x > 3.5 ? 4.0 : 2.0), vMapUv.y), 0.0, 1.0);
            sampledDiffuseColor = mix(vec4(1.0), texture2D(uSideAtlas, vSide.xy + f * vec2(${cw}.0, ${ch}.0) / uSideSize), coverMix);
          }
        }
        else if (vMapUv.x >= 0.0) { sampledDiffuseColor = texture2D(map, vAtlas.xy + vec2(vMapUv.x, vMapUv.y) * vAtlas.zw); }
        else if (vMapUv.x < -1.5 && vMapUv.x > -2.5) { sampledDiffuseColor = vec4(0.84, 0.82, 0.77, 1.0); }   // clean, warm white page edges
        else if (vMapUv.x < -2.5) { sampledDiffuseColor = vec4(0.3, 0.29, 0.28, 1.0); }
        diffuseColor *= sampledDiffuseColor;`)
      .replace('#include <color_fragment>', `
        #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
          if (bound) diffuseColor *= mix(vColor, vec4(1.0), coverMix);
        #endif`);
  };
  mat.customProgramCacheKey = () => 'spine-atlas-sides';
  return mat;
}

/** Copies the (cached) spine drawings of `chunk` ({ book, w }) into the atlas cells of `tex`. */
function paintAtlas(tex, chunk) {
  const canvas = tex.image, ctx = canvas.getContext('2d');
  chunk.forEach((e, i) => {
    const cell = spineCell(e.book, e.w, bookHeight(e.book));
    ctx.drawImage(cell.canvas, cell.x, cell.y, CELL_W, CELL_H, (i % COLS) * CELL_W, Math.floor(i / COLS) * CELL_H, CELL_W, CELL_H);
  });
  // unused cells get a neutral tone, so the far mip levels do not darken the last spines
  const n = chunk.length, rows = Math.ceil(n / COLS);
  ctx.fillStyle = '#8c8578';
  if (n % COLS) ctx.fillRect((n % COLS) * CELL_W, (rows - 1) * CELL_H, canvas.width - (n % COLS) * CELL_W, CELL_H);
  if (rows * CELL_H < canvas.height) ctx.fillRect(0, rows * CELL_H, canvas.width, canvas.height - rows * CELL_H);
  tex.needsUpdate = true;
}

/** What the atlases of these books (sorted by id) show: which book has which cell and how every spine looks. */
const atlasKey = (list) => list.map(({ book, w }) => book.id + '\u0001' + spineDrawingKey(book, w, bookHeight(book))).join('\n');

// ---------------------------------------------------------------- covers ----------------------------------------
const COVER_H = 512;                  // pixels: a book cover in the room is never shown larger
const COVER_KEEP = 96;                // decoded covers kept on the graphics card (least recently used go first)
const TYPO_KEEP = 64;
/**
 * Cover images for the 3D books. A texture is handed out only when it is on the graphics card already: decoding
 * (off the main thread) and the upload (from a queue, at most two a frame) happen before anything shows it.
 */
class CoverStore {
  /** @param keep  how many decoded pictures stay on the graphics card (least recently used go first) */
  constructor(keep = COVER_KEEP) { this.keep = keep; this.map = new Map(); this.queue = []; this.renderer = null; this.stats = { uploads: 0, ms: 0, max: 0, typo: 0, typoMs: 0, typoMax: 0 }; }
  /** Starts loading (when needed) and returns the entry { tex, ready, promise }. */
  request(url, { maxHeight = COVER_H, front = false } = {}) {
    let e = this.map.get(url);
    if (e) { e.used = performance.now(); return e; }
    e = { url, tex: null, ready: false, failed: false, used: performance.now(), pins: 0, waiters: [] };
    this.map.set(url, e);
    e.promise = new Promise((resolve) => e.waiters.push(resolve));
    decodeImage(url, maxHeight).then((bitmap) => {
      if (!bitmap) { this.#done(e, null); return; }
      const tex = new THREE.Texture(bitmap);
      tex.flipY = false;                           // the bitmap is flipped while decoding
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.needsUpdate = true;
      tex.userData.cover = true;
      e.tex = tex;
      this.upload(tex, (ok) => this.#done(e, ok ? tex : null), front, () => this.map.get(url) === e);
    });
    this.#evict();
    return e;
  }
  /** The texture when it is ready (uploaded), else null (it gets loaded). */
  get(url, opts) { const e = this.request(url, opts); return e.ready ? e.tex : null; }
  /** Promise of the uploaded texture (null when the image could not be loaded). */
  load(url, opts) { const e = this.request(url, opts); return e.ready || e.failed ? Promise.resolve(e.tex) : e.promise; }
  pin(url) { const e = this.map.get(url); if (e) e.pins++; }
  unpin(url) { const e = this.map.get(url); if (e && e.pins > 0) e.pins--; }
  /** Queue a texture for the graphics card; `done(ok)` follows the upload, `alive()` false skips it. */
  upload(tex, done, front = false, alive = () => true) {
    const job = { tex, done, alive };
    if (front) this.queue.unshift(job); else this.queue.push(job);
  }
  /** Put up to `n` queued textures on the graphics card (called once a frame). */
  pump(n = 2) {
    const t0 = performance.now();
    // at most n a frame, and no second one once a millisecond is spent
    for (let i = 0; i < n && this.queue.length && performance.now() - t0 < 1; i++) {
      const job = this.queue.shift();
      if (!job.alive()) { i--; continue; }
      let ok = true;
      const a = performance.now();
      try { this.renderer?.initTexture(job.tex); } catch { ok = false; }
      const ms = performance.now() - a;
      this.stats.uploads++; this.stats.ms += ms; this.stats.max = Math.max(this.stats.max, ms);
      job.done(ok);
    }
  }
  #done(e, tex) {
    e.ready = !!tex; e.failed = !tex;
    for (const w of e.waiters.splice(0)) w(tex);
  }
  #evict() {
    if (this.map.size <= this.keep) return;
    const old = [...this.map.values()].filter((e) => !e.pins && (e.ready || e.failed)).sort((a, b) => a.used - b.used);
    for (const e of old.slice(0, this.map.size - this.keep)) { this.map.delete(e.url); e.tex?.dispose(); }
  }
}
async function decodeImage(url, maxHeight) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const opts = { imageOrientation: 'flipY', premultiplyAlpha: 'none' };
    if (maxHeight) { opts.resizeHeight = maxHeight; opts.resizeQuality = 'high'; }
    return await createImageBitmap(blob, opts);
  } catch { return null; }
}
const covers = new CoverStore();
// the pictures on the walls (watercolours, the user's own images) are few and hang for good: never evicted, and they
// share the upload queue (and its budget) with the covers
const pictures = new CoverStore(Infinity);
pictures.queue = covers.queue;
/** Book covers are scaled down to COVER_H; any other picture (paintings) keeps its size. */
const isBookCover = (url) => /^cover:/i.test(url || '');
export function loadCover(url) {
  if (!url) return Promise.resolve(null);
  return isBookCover(url) ? covers.load(url, { maxHeight: COVER_H }) : pictures.load(url, { maxHeight: null });
}

/** Title cards (books without a cover image) as textures, drawn once and kept for a while. */
const typoTextures = new Map();
function typoKey(book) { return `${book.id}|${book.title || ''}|${book.author || ''}|${fontsLoaded() ? 1 : 0}`; }
function typoTexture(book, { draw = true } = {}) {
  const key = typoKey(book);
  let e = typoTextures.get(key);
  if (e) { typoTextures.delete(key); typoTextures.set(key, e); return e.ready ? e.tex : null; }
  if (!draw) return null;
  const t0 = performance.now();
  // in the proportions of the book's cover face: the lettering is never stretched on the pulled-out book
  const c = document.createElement('canvas'); c.width = 256; c.height = clamp(Math.round(256 * bookHeight(book) / bookDepth(book)), 200, 520);
  // a canvas in main memory: drawing it never waits for the graphics card (a busy card held an accelerated
  // canvas for up to 140 ms), the upload later copies a few hundred kilobytes
  drawTypoCover(c.getContext('2d', { willReadFrequently: true }), book, c.width, c.height);
  const ms = performance.now() - t0;
  covers.stats.typo++; covers.stats.typoMs += ms; covers.stats.typoMax = Math.max(covers.stats.typoMax, ms);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  e = { tex, ready: false };
  typoTextures.set(key, e);
  covers.upload(tex, () => { e.ready = true; }, true, () => typoTextures.get(key) === e);
  if (typoTextures.size > TYPO_KEEP) { const [k, old] = typoTextures.entries().next().value; typoTextures.delete(k); old.tex.dispose(); }
  return null;
}

// title cards are drawn in idle time (a few milliseconds each): the hovered book first, then its neighbours
const typoQueue = [];
let typoIdle = false;
const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 60 }) : setTimeout(() => fn({ didTimeout: true, timeRemaining: () => 0 }), 30));
function scheduleTypo(book, front = false) {
  if (typoTextures.has(typoKey(book))) return;
  const i = typoQueue.indexOf(book);
  if (i >= 0) { if (!front) return; typoQueue.splice(i, 1); }
  if (front) typoQueue.unshift(book); else typoQueue.push(book);
  if (typoQueue.length > 16) typoQueue.length = 16;
  if (!typoIdle) { typoIdle = true; idle(runTypo); }
}
function runTypo(deadline) {
  typoIdle = false;
  let n = 0;
  while (typoQueue.length && (deadline.didTimeout ? n < 1 : deadline.timeRemaining() > 6)) { typoTexture(typoQueue.shift()); n++; }
  if (typoQueue.length) { typoIdle = true; idle(runTypo); }
}

let blankTex = null;
/** A white 1 × 1 texture: materials that show a picture always have one (no second shader for "no map"). */
function blank() {
  if (!blankTex) { blankTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); blankTex.colorSpace = THREE.SRGBColorSpace; blankTex.needsUpdate = true; }
  return blankTex;
}

// ---------------------------------------------------------------- the hover pool -----------------------------------
let hoverGeo = null;
/** Unit book box: +x front cover (group 0), −x back cover (1), top, bottom and fore edge (2), +z spine (3).
 *  With the front on +x the spine is on the left of the cover, as on a real book. */
function hoverGeometry() {
  if (hoverGeo) return hoverGeo;
  const g = new THREE.BoxGeometry(1, 1, 1);
  const idx = g.index.array, out = [];
  for (const f of [0, 1, 2, 3, 5, 4]) for (let k = 0; k < 6; k++) out.push(idx[f * 6 + k]);
  g.setIndex(out); g.clearGroups();
  g.addGroup(0, 6, 0); g.addGroup(6, 6, 1); g.addGroup(12, 18, 2); g.addGroup(30, 6, 3);
  g.userData.shared = true;
  return (hoverGeo = g);
}
/** The spine of a hovered book: the book's cell of the shelf atlas (no drawing, no upload). The covers and the page
 *  block take the same material (one shader program): a rectangle of their picture. */
function hoverSpineMaterial(params = { roughness: 0.75, metalness: 0.02 }) {
  const mat = new THREE.MeshStandardMaterial({ map: blank(), ...params });
  const uAtlas = { value: new THREE.Vector4(0, 0, 1, 1) };
  mat.userData.uAtlas = uAtlas;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uAtlas = uAtlas;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uAtlas;')
      .replace('#include <map_fragment>', 'diffuseColor *= texture2D(map, uAtlas.xy + vMapUv * uAtlas.zw);');
  };
  mat.customProgramCacheKey = () => 'hover-spine';
  return mat;
}
let pageTex = null, pageMat = null;
/** Cream paper with fine page lines for the page block of the pulled-out book (head, foot and fore edge). The lines
 *  are stacked across u, which runs along the thickness on all three faces (BoxGeometry), and tile along the pages.
 *  A small canvas, drawn once. */
function pageBlockTexture() {
  if (pageTex) return pageTex;
  const W = 128, H = 64, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
  const rnd = seeded(hashStr('pages'));
  // the edges of the sheets: a shadow line every three to six texels, a few sheets standing out a little
  const line = new Float32Array(W), wave = new Float32Array(W);
  for (let x = 0; x < W;) { line[x] = rnd() < 0.2 ? 0.16 : 0.06 + rnd() * 0.05; wave[x] = rnd() * 6.28; x += 3 + Math.floor(rnd() * 4); }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    // a sheet's edge is not perfectly straight: its line fades in and out along the page, the paper has a faint grain
    const tone = 1 - line[x] * (0.7 + 0.3 * Math.sin(y * 0.3 + wave[x])) + (rnd() - 0.5) * 0.035;
    d[i] = Math.round(244 * tone); d[i + 1] = Math.round(237 * tone); d[i + 2] = Math.round(219 * tone); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  pageTex = new THREE.CanvasTexture(c);
  pageTex.colorSpace = THREE.SRGBColorSpace; pageTex.anisotropy = 8;
  pageTex.wrapS = pageTex.wrapT = THREE.RepeatWrapping;
  return pageTex;
}
/** The page block of every pulled-out book: one material for all slots, on the spine's shader program (no program
 *  of its own, uAtlas tiles the paper three times along the pages), lit by the compartment like the covers. */
function pageBlockMaterial() {
  if (pageMat) return pageMat;
  pageMat = hoverSpineMaterial({ roughness: 0.9, metalness: 0 });
  pageMat.map = pageBlockTexture();
  pageMat.userData.uAtlas.value.set(0, 0, 1, 3);
  pageMat.userData.pageBlock = true;
  withShelfGlow(pageMat, 0.55);
  return pageMat;
}
class HoverSlot {
  constructor() {
    // front and back show the same picture (the back of the books on the shelf shows the front's, side-covers.js)
    this.front = hoverSpineMaterial({ roughness: 0.55 });
    this.spine = hoverSpineMaterial();
    // the pulled-out book keeps the light of its compartment
    for (const m of [this.front, this.spine]) withShelfGlow(m, 0.55);
    this.mesh = new THREE.Mesh(hoverGeometry(), [this.front, this.front, pageBlockMaterial(), this.spine]);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.visible = false; this.mesh.name = 'hoverbook';
    this.mesh.userData.hoverMesh = true;      // never a look target itself (world-actions skips it)
    this.entry = null; this.t = 0; this.target = 0;
    this.face = new THREE.Quaternion(); this.faceInit = false;
    this.coverUrl = null; this.typo = false;
    // what the front shows ('cover', 'typo', 'side' or 'none') and the width the book takes once it is turned: that
    // of its cover picture (coverD = aspect × height), else the face's; dAsp eases towards it, dcur is the width now
    this.kind = 'none'; this.aspect = 0; this.coverD = 0; this.dAsp = 0; this.dcur = 0;
  }
  get busy() { return !!this.entry && (this.t > 0 || this.target > 0); }
}

// scratch objects (no allocations per frame or per ray)
const _m = new THREE.Matrix4(), _mi = new THREE.Matrix4(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _ray = new THREE.Ray(), _box = new THREE.Box3();
const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3(), _col = new THREE.Color();
const smooth = (x) => x * x * (3 - 2 * x);

export class BookShelves {
  constructor(scene, opts = {}) {
    this.scene = scene; this.opts = opts;
    covers.renderer = pictures.renderer = opts.renderer || covers.renderer;
    this.group = new THREE.Group(); this.group.name = 'books'; scene.add(this.group);
    this.extras = new THREE.Group(); this.extras.name = 'bookextras'; scene.add(this.extras);
    this.geometry = makeBookGeometry();
    this.meshes = [];
    this.retired = [];               // meshes of the last build, disposed once the new one compiled (disposeRetired)
    this.atlas = null;               // the spine atlases of the books on the shelves (#atlasFor), kept while they fit
    this.retiredAtlases = [];        // atlas textures replaced by new ones, disposed with the retired meshes
    this.entries = new Map();
    this.byInstance = new Map();     // `${mesh.id}:${index}` → entry (O(1) hover lookups)
    this.cells = [];                 // per bookcase: { box (world AABB of its books), entries }
    this.hover = null;               // the entry under the crosshair
    this.pending = null;             // { e, t }: the hover waits HOVER_DWELL before the book comes out
    this.slots = Array.from({ length: HOVER_SLOTS }, () => new HoverSlot());
    for (const s of this.slots) this.extras.add(s.mesh);
    this.tmpM = new THREE.Matrix4(); this.tmpP = new THREE.Vector3(); this.tmpS = new THREE.Vector3();
    this.animating = new Set();
    this.displayMeshes = [];
    this.pinned = [];
    this.prefetchQ = [];
    // the cover pictures on the faces at the ends of the rows and next to gaps (side-covers.js)
    this.sides = new SideCovers({ renderer: opts.renderer, coverUrl: (id) => this.opts.coverUrl?.(id) });
    coverUrlOf = (id) => this.opts.coverUrl?.(id);
  }

  /** (Re)build all shelves from the layout's bookcases + book records */
  build(layout, booksById, bookcaseObjects) {
    this.clear();
    const items = [];
    for (const bc of layout.bookcases) {
      const obj = bookcaseObjects.get(bc.id);
      if (!obj) continue;
      for (const row of bc.rows) for (const it of row.items) {
        const book = booksById[it.id]; if (!book) continue;
        items.push({ book, bc, obj, row, it });
      }
    }
    reserveSpines(items.length);
    const atlas = this.#atlasFor(items);
    // one instanced mesh per atlas, with the books whose spines that atlas holds (in the order of the shelves)
    const perAtlas = atlas.textures.map(() => []);
    for (const e of items) perAtlas[atlas.cellOf.get(e.book.id).a].push(e);
    const cells = new Map();
    for (let a = 0; a < perAtlas.length; a++) {
      const chunk = perAtlas[a];
      if (!chunk.length) continue;
      const { tex, atlasH } = atlas.textures[a];
      const geom = this.geometry.clone();
      const mesh = new THREE.InstancedMesh(geom, makeSpineMaterial(tex), chunk.length);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.name = 'shelfbooks' + a;
      const atlasAttr = new THREE.InstancedBufferAttribute(new Float32Array(chunk.length * 4), 4);
      // the picture on the cover faces, per book (side-covers.js writes it): cell, start of the fade, shown
      const sideAttr = new THREE.InstancedBufferAttribute(new Float32Array(chunk.length * 4), 4);
      sideAttr.setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute('aSide', sideAttr);
      const color = new THREE.Color();
      chunk.forEach((e, i) => {
        const { book, obj, row, it } = e;
        const w = it.w, h = bookHeight(book), d = bookDepth(book);
        const localX = -BOOKCASE.innerW / 2 + 0.03 + it.x + w / 2;
        const localZ = BOOKCASE.d / 2 - 0.02 - d / 2 - 0.01;
        const local = new THREE.Vector3(localX, row.y + h / 2, localZ);
        obj.updateMatrixWorld(true);
        const pos = local.applyMatrix4(obj.matrixWorld);
        const quat = new THREE.Quaternion().setFromRotationMatrix(obj.matrixWorld);
        const scale = new THREE.Vector3(w, h, d);
        const matrix = new THREE.Matrix4().compose(pos, quat, scale);
        mesh.setMatrixAt(i, matrix);
        const bc2 = bindingColor(book);
        color.setRGB(bc2[0] / 255 * 0.92, bc2[1] / 255 * 0.92, bc2[2] / 255 * 0.92, THREE.SRGBColorSpace);
        mesh.setColorAt(i, color);
        const c = atlas.cellOf.get(book.id).i;   // the book's own cell of the atlas
        const cx = (c % COLS) * CELL_W / ATLAS, cy = 1 - (Math.floor(c / COLS) + 1) * CELL_H / atlasH;
        atlasAttr.setXYZW(i, cx, cy, CELL_W / ATLAS, CELL_H / atlasH);
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
        const entry = {
          mesh, index: i, pos, quat, scale, forward, pull: 0, target: 0, hidden: false, preview: false, bookcase: e.bc, row, slotX: it.x, w, h, d, book,
          atlas: [cx, cy, CELL_W / ATLAS, CELL_H / atlasH], color: color.clone(), matrix, inv: matrix.clone().invert(),
        };
        this.entries.set(book.id, entry);
        this.byInstance.set(mesh.id + ':' + i, entry);
        let cell = cells.get(e.bc.id);
        if (!cell) cells.set(e.bc.id, cell = { box: new THREE.Box3(), entries: [] });
        cell.entries.push(entry);
        cell.box.expandByPoint(_v.copy(pos).addScaledVector(forward, d / 2 + 0.02)).expandByPoint(_v.copy(pos).addScaledVector(forward, -d / 2));
        cell.box.expandByPoint(_v.set(pos.x, pos.y - h / 2, pos.z)).expandByPoint(_v.set(pos.x, pos.y + h / 2, pos.z));
      });
      geom.setAttribute('aAtlas', atlasAttr);
      mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh); this.meshes.push(mesh);
    }
    // the books of a case in one box (a little wider than the books, so the side of a book counts)
    this.cells = [...cells.values()];
    for (const c of this.cells) c.box.expandByScalar(0.03);
    // the hover pool samples the atlases: give the spine materials one now, so their shader is the final one
    if (this.meshes[0]) for (const s of this.slots) s.spine.map = this.meshes[0].material.map;
    // draw the hover books once, tiny, right in front of the camera: the graphics driver finishes their shaders on
    // the first real draw (a pause of some 40 ms on Direct3D), which then falls on the rebuild, not on the first hover
    this.warmFrames = 2;
    for (const [id, e] of this.entries) if (booksById[id]?.borrowed) this.setHidden(id, true, true);
    // the rows along the shelves: which cover faces are open to view (side-covers.js)
    const rowsOf = new Map();
    for (const e of this.entries.values()) { let list = rowsOf.get(e.row); if (!list) rowsOf.set(e.row, list = []); list.push(e); }
    for (const list of rowsOf.values()) list.sort((p, q) => p.slotX - q.slotX);
    this.sides.attach(this.entries, rowsOf);
    this.#buildDisplays(layout, booksById, bookcaseObjects);
  }

  /**
   * The spine atlases: one cell per book, the books in a fixed order (by id), so that the cell of a book does not depend
   * on where it stands. A rebuild that only moves books (another sort order, the case "Zuletzt gelesen" or "Gelesen")
   * keeps the atlases as they are: nothing is drawn or put on the graphics card again. Painting and uploading two
   * atlases of 4096 px for some 800 books held the picture for about half a second after every such rebuild. Another
   * set of books or a spine that looks different (book-art.js spineDrawingKey, the web fonts included) paints them anew.
   * @returns { key, textures: [{ tex, atlasH, chunk }], cellOf: Map(book id → { a, i }) }
   */
  #atlasFor(items) {
    const byId = new Map();
    for (const e of items) if (!byId.has(e.book.id)) byId.set(e.book.id, { book: e.book, w: e.it.w });
    const list = [...byId.values()].sort((x, y) => (x.book.id < y.book.id ? -1 : x.book.id > y.book.id ? 1 : 0));
    const key = atlasKey(list);
    const old = this.atlas;
    if (old && old.key === key) return old;
    const textures = [], cellOf = new Map();
    for (let a = 0; a * PER_ATLAS < list.length; a++) {
      const chunk = list.slice(a * PER_ATLAS, (a + 1) * PER_ATLAS);
      const atlasH = Math.max(1, Math.ceil(chunk.length / COLS)) * CELL_H;   // only the rows we fill (WebGL 2 mipmaps any size)
      const canvas = document.createElement('canvas'); canvas.width = ATLAS; canvas.height = atlasH;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.flipY = true;
      paintAtlas(tex, chunk);
      chunk.forEach((e, i) => cellOf.set(e.book.id, { a, i }));
      textures.push({ tex, atlasH, chunk });
    }
    const atlas = this.atlas = { key, textures, cellOf };
    // the old atlases go once the new shelves hold their programs (disposeRetired)
    if (old) for (const t of old.textures) this.retiredAtlases.push(t.tex);
    // spines drawn before the web fonts arrived used Georgia: draw them again once the fonts are there
    if (!fontsLoaded()) {
      whenFontsLoaded().then(() => {
        if (this.atlas !== atlas) return;
        for (const t of atlas.textures) paintAtlas(t.tex, t.chunk);
        atlas.key = atlasKey(list);
      });
    }
    return atlas;
  }

  /** Face-out copies lying on the sloped display board of every bookcase (furniture.js DISPLAY): front cover
   *  up, the lower edge resting on the board's lip. (They used to lean against a thin rail in mid-air.) */
  #buildDisplays(layout, booksById, bookcaseObjects) {
    for (const bc of layout.bookcases) {
      const obj = bookcaseObjects.get(bc.id); if (!obj || !bc.display?.length) continue;
      const spec = obj.userData.display; if (!spec?.len) continue;
      obj.updateMatrixWorld(true);
      const quat = new THREE.Quaternion().setFromRotationMatrix(obj.matrixWorld);
      const a = spec.angle;
      const slope = new THREE.Vector3(0, -Math.sin(a), Math.cos(a)), normal = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
      // local axes of a book mesh: +x back cover (into the board), +y top edge (up the slope), +z spine
      const lie = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(normal.clone().negate(), slope.clone().negate(), new THREE.Vector3(1, 0, 0)));
      const n = bc.display.length, gap = Math.min(0.36, (spec.w - 0.1) / Math.max(1, n));
      bc.display.forEach((id, k) => {
        const book = booksById[id]; if (!book) return;
        const h = Math.min(spec.len - 0.03, bookHeight(book) * 1.06), w = h * 0.68, t = Math.max(0.022, spineWidth(book) * 1.1);
        const mesh = makeBookMesh(book, null, [t, h, w], { standing: true, faceOut: true });
        const local = new THREE.Vector3(...spec.origin).addScaledVector(slope, spec.len - 0.02 - h / 2).addScaledVector(normal, spec.t / 2 + t / 2 + 0.001);
        local.x = bc.displayX?.[k] ?? (k - (n - 1) / 2) * gap;   // the case "Gelesen" keeps the middle for its plaque
        mesh.position.copy(local.applyMatrix4(obj.matrixWorld));
        mesh.quaternion.copy(quat).multiply(lie);
        mesh.userData.displayBook = id;
        mesh.traverse((o) => { o.userData.displayBook = id; });
        mesh.updateMatrixWorld(true);
        mesh.userData.box = new THREE.Box3().setFromObject(mesh);
        this.extras.add(mesh); this.displayMeshes.push(mesh);
        this.#applyCover(mesh, id);
      });
    }
  }

  /** Books lying face-up on the display table in the book room. */
  buildTableDisplay(tableObj, spec, ids, booksById) {
    for (const m of this.tableDisplay || []) { this.extras.remove(m); this.#unpinMesh(m); disposeBookMesh(m); }
    this.tableDisplay = [];
    if (!tableObj || !spec || !ids?.length) return;
    tableObj.updateMatrixWorld(true);
    const quat = new THREE.Quaternion().setFromRotationMatrix(tableObj.matrixWorld);
    const list = ids.slice(0, 6);
    const cols = 3, rows = Math.ceil(list.length / cols);
    list.forEach((id, i) => {
      const book = booksById[id]; if (!book) return;
      const hgt = bookHeight(book) * 1.05, wid = hgt * 0.7, th = Math.max(0.022, spineWidth(book) * 1.1);
      const mesh = makeBookMesh(book, null, [th, hgt, wid], { standing: false, faceOut: true });
      const cx = ((i % cols) - (cols - 1) / 2) * (spec.w / cols);
      const cz = (Math.floor(i / cols) - (rows - 1) / 2) * (spec.d / Math.max(1, rows));
      const local = new THREE.Vector3(cx, spec.y + th / 2, cz);
      mesh.position.copy(local.applyMatrix4(tableObj.matrixWorld));
      mesh.quaternion.copy(quat);
      mesh.rotateY(((i * 37) % 11 - 5) * 0.02);
      mesh.userData.displayBook = id;
      mesh.traverse((o) => { o.userData.displayBook = id; });
      mesh.updateMatrixWorld(true);
      mesh.userData.box = new THREE.Box3().setFromObject(mesh);
      this.extras.add(mesh); this.tableDisplay.push(mesh);
      this.#applyCover(mesh, id);
    });
  }

  /** The real cover onto a face-out copy, once it is decoded and on the graphics card. */
  #applyCover(mesh, id) {
    // books without a cover image keep the typographic front makeBookMesh gave them
    const url = hasCoverImage(mesh.userData.book) ? this.opts.coverUrl?.(id) : null;
    if (!url) return;
    covers.request(url);
    covers.pin(url); mesh.userData.pinned = url;
    covers.load(url).then((tex) => {
      if (!mesh.parent) return;
      const idx = mesh.userData.frontIndex ?? 1;
      // a cover that cannot be loaded gets the typographic one, like a book without any cover
      if (!tex && mesh.userData.typoCover) return;
      const m = tex ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }) : typoCoverMaterial(mesh.userData.book, mesh.userData.size);
      m.userData.disposable = true;
      if (tex) m.userData.keepMap = true;          // the cover belongs to the store, not to this material
      if (!tex) mesh.userData.typoCover = true;
      const old = mesh.material[idx];
      mesh.material = mesh.material.map((x, i) => (i === idx ? m : x));
      // only dispose the old front material when no other face still uses it
      if (old?.userData?.disposable && !mesh.material.includes(old)) { if (!old.userData.keepMap) old.map?.dispose(); old.dispose(); }
    });
  }
  #unpinMesh(m) { if (m.userData.pinned) { covers.unpin(m.userData.pinned); m.userData.pinned = null; } }

  /** Take every book mesh out of the scene. They are disposed later (disposeRetired): disposing their materials first let
   *  three.js delete the shader programs, and the next build, made of the same materials, compiled them all again. */
  clear() {
    for (const m of this.meshes) { this.group.remove(m); this.retired.push({ m, shelf: true }); }
    this.meshes = []; this.entries.clear(); this.byInstance.clear(); this.cells = []; this.hover = null; this.pending = null;
    for (const s of this.slots) this.#releaseSlot(s);
    for (const m of this.displayMeshes) { this.extras.remove(m); this.#unpinMesh(m); this.retired.push({ m }); }
    this.displayMeshes = [];
    for (const m of this.tableDisplay || []) { this.extras.remove(m); this.#unpinMesh(m); this.retired.push({ m }); }
    this.tableDisplay = [];
    this.animating.clear();
    this.prefetchQ.length = 0;
  }
  /** Dispose what clear() took out, after the new shelves hold their shader programs (world.js #disposeRetired). */
  disposeRetired() {
    const old = this.retired; this.retired = [];
    for (const { m, shelf } of old) {
      // (the atlas a shelf mesh shows belongs to #atlasFor: kept while it fits, else in retiredAtlases)
      if (shelf) { m.geometry.dispose(); m.material.dispose(); }
      else disposeBookMesh(m);
    }
    for (const t of this.retiredAtlases.splice(0)) t.dispose();
  }

  /**
   * The cover the info card shows for a book: the real image, or for a book with only the indexer's stand-in
   * title card the same typographic cover the book shows in the room (null: no cover at all).
   */
  coverUrlFor(book) {
    if (!book) return null;
    if (hasCoverImage(book)) return this.opts.coverUrl?.(book.id) || null;
    if (book.hasCover === false) return null;
    return typoCoverUrl(book);
  }

  /**
   * A book's record changed without the shelves being rebuilt (a cover from the internet arrived, page 1 turned out
   * to be no cover): the shelf entry and the face-out copies take the new record, and a book that is pulled out right
   * now swaps its front once the new picture is decoded and on the graphics card. Nothing is created or drawn here.
   */
  updateBook(book) {
    const e = book && this.entries.get(book.id);
    this.sides.updateBook(book);   // the picture on the side follows (side-covers.js)
    if (e) {
      e.book = book;
      const s = this.slots.find((x) => x.entry === e);
      if (s) {
        const url = hasCoverImage(book) ? this.opts.coverUrl?.(book.id) : null;
        if (!url) this.#setFront(s, book);
        else covers.load(url).then(() => { if (s.entry === e) this.#setFront(s, book); });
      }
    }
    for (const m of [...this.displayMeshes, ...(this.tableDisplay || [])]) {
      if (m.userData.displayBook !== book?.id || !m.parent) continue;
      m.userData.book = book;
      if (hasCoverImage(book)) { this.#unpinMesh(m); this.#applyCover(m, book.id); }
      // the reader chose the title card in the book info ("Generiertes Titelbild")
      else if (book.coverChoice === 'card' && !m.userData.typoCover) { this.#unpinMesh(m); this.#setTitleCard(m); }
    }
  }
  /** The title card onto a face-out copy (the same kind of material as every front: no new shader program). */
  #setTitleCard(mesh) {
    const idx = mesh.userData.frontIndex ?? 1;
    const m = typoCoverMaterial(mesh.userData.book, mesh.userData.size);
    m.userData.disposable = true;
    mesh.userData.typoCover = true;
    const old = mesh.material[idx];
    mesh.material = mesh.material.map((x, i) => (i === idx ? m : x));
    if (old?.userData?.disposable && !mesh.material.includes(old)) { if (!old.userData.keepMap) old.map?.dispose(); old.dispose(); }
  }

  bookAt(intersection) {
    if (!intersection || intersection.instanceId == null) return null;
    return this.byInstance.get(intersection.object.id + ':' + intersection.instanceId) || null;
  }
  entry(id) { return this.entries.get(id) || null; }

  /**
   * The nearest shelf slot the ray hits within `far`: { entry, distance } or null. A slot is where its book stands
   * on the shelf, also while the book is pulled out or on its way back (the crosshair over the slot means that book,
   * whatever the turned cover in front of it hides); only borrowed books leave no slot. Only the books of the cases
   * whose box the ray passes are tested, each as a box.
   */
  pick(ray, far) {
    let best = null, bestD = far;
    for (const c of this.cells) {
      const hit = ray.intersectBox(c.box, _v);
      if (!hit) continue;
      const inside = c.box.containsPoint(ray.origin);
      if (!inside && ray.origin.distanceTo(hit) > bestD) continue;
      for (const e of c.entries) {
        if (e.hidden) continue;
        _ray.copy(ray).applyMatrix4(e.inv);
        const p = _ray.intersectBox(UNIT_BOX, _v2);
        if (!p) continue;
        const d = p.applyMatrix4(e.matrix).distanceTo(ray.origin);
        if (d < bestD) { bestD = d; best = e; }
      }
    }
    return best ? { entry: best, distance: bestD } : null;
  }

  #write(e) {
    const p = this.tmpP.copy(e.pos).addScaledVector(e.forward, e.pull * 0.05);
    const s = (e.hidden || e.preview) ? this.tmpS.set(0.0001, 0.0001, 0.0001) : this.tmpS.copy(e.scale);
    this.tmpM.compose(p, e.quat, s);
    e.mesh.setMatrixAt(e.index, this.tmpM);
    e.mesh.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ hover ----
  /** The book under the crosshair (null: none). It comes out after a short rest, the previous one goes back. */
  setHover(e) {
    if (this.hover === e) return;
    this.hover = e || null;
    for (const s of this.slots) if (s.entry && s.entry !== e) s.target = 0;
    const back = e ? this.slots.find((s) => s.entry === e) : null;
    if (back) { back.target = 1; this.pending = null; }      // it was on its way back: out again
    else this.pending = e && !e.hidden ? { e, t: 0 } : null;
    // a book without a cover image: its title card is drawn while the crosshair rests on it
    if (e && !hasCoverImage(e.book)) scheduleTypo(e.book, true);
    if (e) this.#prefetchAround(e);
    // when it comes out, the covers of its neighbours show in the gap: their pictures first
    if (e) this.sides.anticipate(e);
  }
  /** The mesh of the book that is out (or coming out), for tests and the look ray. */
  get hoverMesh() { const s = this.slots.find((x) => x.entry && x.entry === this.hover && x.target > 0); return s ? s.mesh : null; }
  get hoverEntry() { return this.slots.find((x) => x.entry && x.entry === this.hover && x.target > 0)?.entry || null; }

  #activate(e) {
    // a free slot, or the one that is furthest on its way back
    let s = this.slots.find((x) => !x.busy);
    if (!s) { s = this.slots.filter((x) => x.target === 0).sort((a, b) => a.t - b.t)[0] || this.slots[0]; this.#releaseSlot(s); }
    s.entry = e; s.t = 0; s.target = 1; s.faceInit = false;
    s.kind = 'none'; s.coverD = s.dAsp = s.dcur = e.d;
    e.preview = true; this.#write(e);
    this.sides.rowChanged(e);   // the gap it leaves shows the covers of its neighbours
    const m = s.mesh;
    m.scale.copy(e.scale); m.position.copy(e.pos); m.quaternion.copy(e.quat);
    // the spine: the book's own cell of the shelf atlas
    s.spine.map = e.mesh.material.map;
    s.spine.userData.uAtlas.value.set(e.atlas[0], e.atlas[1], e.atlas[2], e.atlas[3]);
    this.#setFront(s, e.book);
    m.visible = true;
  }
  /**
   * The covers (front and back): the real cover when it is on the graphics card, whole (the turned book takes the
   * picture's proportions, #pose; until it has them the picture is trimmed to the face like the small picture on the
   * side, so that nothing is ever stretched); else the title card; until one of them is there, the small picture of
   * the side (when the book has one), else the binding colour.
   */
  #setFront(s, book) {
    const e = s.entry;
    const url = hasCoverImage(book) ? this.opts.coverUrl?.(book.id) : null;
    if (s.coverUrl && s.coverUrl !== url) covers.unpin(s.coverUrl);
    let tex = null, failed = false;
    if (url) {
      if (s.coverUrl !== url) { covers.request(url, { front: true }); covers.pin(url); }
      const c = covers.request(url);
      tex = c.ready ? c.tex : null; failed = c.failed;
    }
    s.coverUrl = url;
    s.typo = false;
    const rect = s.front.userData.uAtlas.value;
    // the width the book takes once it is turned: that of its cover picture (within bounds), else the face's own
    s.coverD = e ? e.d : 0;
    if (tex) {
      s.kind = 'cover'; s.aspect = clamp(tex.image.width / tex.image.height, COVER_ASPECT_MIN, COVER_ASPECT_MAX);
      if (e) { s.coverD = s.aspect * e.h; sideCrop(rect, s.aspect, s.dcur / e.h); } else rect.set(0, 0, 1, 1);
    }
    // no cover image, or one that cannot be loaded: the title card (drawn in the proportions of the face)
    else if (!url || failed) { tex = typoTexture(book, { draw: false }); if (!tex) scheduleTypo(book, true); s.typo = true; s.kind = 'typo'; rect.set(0, 0, 1, 1); }
    s.waiting = !tex;
    if (!tex) { tex = this.sides.cellFor(book.id, rect); s.kind = tex ? 'side' : 'none'; }
    if (tex) { s.front.map = tex; s.front.color.setRGB(1, 1, 1); }
    else { s.front.map = blank(); rect.set(0, 0, 1, 1); s.front.color.copy(e?.color || _col.setRGB(0.5, 0.5, 0.5)); }
    s.mesh.userData.typoCover = s.typo;
  }
  #releaseSlot(s) {
    if (s.entry) {
      s.entry.preview = false;
      if (this.entries.get(s.entry.book.id) === s.entry) { this.#write(s.entry); this.sides.rowChanged(s.entry); }
    }
    if (s.coverUrl) covers.unpin(s.coverUrl);
    s.coverUrl = null; s.entry = null; s.t = 0; s.target = 0; s.waiting = false; s.kind = 'none';
    s.front.map = blank();      // (never a texture that a rebuild may replace: the hover books are drawn while warming up)
    s.mesh.visible = false;
  }
  /** Pose of a slot's book: pulled straight out until the fore edge is clear of the case, then turned towards the
   *  camera, stopping TURN_SHORT short of facing it, and widened to the proportions of its cover. */
  #pose(s, dt, camera) {
    const e = s.entry, k = smooth(s.t);
    const pull = e.d + 0.07;
    const a = smooth(clamp(k / 0.5, 0, 1)), b = smooth(clamp((k - 0.45) / 0.55, 0, 1));
    const m = s.mesh;
    m.position.copy(e.pos).addScaledVector(e.forward, pull * a);
    m.position.y += 0.012 * a;
    // the width: the face's while the book slides out, the cover picture's once it is turned. The change comes with
    // the turn (b), after the fore edge is clear of the case, so it never cuts into the neighbours, and goes back the
    // same way; a cover that arrives when the book is out widens it smoothly. The picture follows the width: the part
    // the face shows grows from the trimmed middle to the whole picture, nothing is stretched on the way.
    s.dAsp += (s.coverD - s.dAsp) * (1 - Math.exp(-dt * WIDEN_RATE));
    if (Math.abs(s.coverD - s.dAsp) < 0.0002) s.dAsp = s.coverD;
    s.dcur = e.d + (s.dAsp - e.d) * b;
    m.scale.set(e.w, e.h, s.dcur);
    if (s.kind === 'cover') sideCrop(s.front.userData.uAtlas.value, s.aspect, s.dcur / e.h);
    if (camera && b > 0) {
      // face the camera: +x (the front cover) towards it, tilted back or forward at most 40°, never into the case
      _v.copy(camera.position).sub(_v2.copy(e.pos).addScaledVector(e.forward, pull));
      const hl = Math.hypot(_v.x, _v.z) || 1e-6;
      const ang = Math.atan2(_v.x / hl * e.forward.z - _v.z / hl * e.forward.x, _v.x / hl * e.forward.x + _v.z / hl * e.forward.z);
      // the cover's direction, measured from the shelf direction towards its rest pose (+x, along the shelf): at most
      // MAX_TURN from the shelf direction, TURN_SHORT short of the camera, never past the rest pose
      const face = Math.min(Math.PI / 2, clamp(ang, -MAX_TURN, MAX_TURN) + TURN_SHORT), c = Math.cos(face), sn = Math.sin(face);
      const hx = e.forward.x * c + e.forward.z * sn, hz = e.forward.z * c - e.forward.x * sn;
      const elev = clamp(Math.atan2(_v.y, hl), -0.7, 0.7);
      const tilt = elev - Math.sign(elev) * Math.min(Math.abs(elev), TILT_SHORT), ct = Math.cos(tilt), st = Math.sin(tilt);
      _X.set(hx * ct, st, hz * ct); _Y.set(-hx * st, ct, -hz * st); _Z.crossVectors(_X, _Y);
      _q.setFromRotationMatrix(_m.makeBasis(_X, _Y, _Z));
      if (!s.faceInit) { s.face.copy(_q); s.faceInit = true; } else s.face.slerp(_q, 1 - Math.exp(-dt * 12));
      m.quaternion.slerpQuaternions(e.quat, s.face, b);
    } else m.quaternion.copy(e.quat);
  }

  /**
   * Where `ray` passes through the slot of the hovered book, grown by `margin` (a little hysteresis at the borders to
   * the neighbours: the target never flickers between two books), as a distance (null when it misses). Only the slot
   * counts, not the pulled-out book: turned to the viewer it hides several neighbours, and it used to keep the target
   * while the crosshair was already over one of them.
   */
  hoverHit(ray, margin = 0.005) {
    const e = this.hover;
    if (!e || e.hidden) return null;
    _m.compose(e.pos, e.quat, _v.set(e.w + margin * 2, e.h + margin * 2, e.d + margin * 2));
    const p = _ray.copy(ray).applyMatrix4(_mi.copy(_m).invert()).intersectBox(UNIT_BOX, _v2);
    return p ? p.applyMatrix4(_m).distanceTo(ray.origin) : null;
  }

  setHidden(id, hidden) {
    const e = this.entries.get(id); if (!e) return;
    for (const s of this.slots) if (s.entry === e) this.#releaseSlot(s);
    if (this.pending?.e === e) this.pending = null;
    e.hidden = hidden; e.pull = 0; e.target = 0;
    this.#write(e);
    this.sides.rowChanged(e);   // a book in the basket leaves a gap: the covers beside it show
  }
  setDisplayVisible(id, visible) {
    for (const m of [...this.displayMeshes, ...(this.tableDisplay || [])]) if (m.userData.displayBook === id) m.visible = visible;
  }

  /** Fetch the covers of the books around `e` (same row), so the next hover finds them ready. */
  #prefetchAround(e) {
    const row = e.row?.items; if (!row) return;
    const i = row.findIndex((it) => it.id === e.book.id);
    this.prefetchQ.length = 0;
    for (let k = 1; k <= 4; k++) for (const j of [i + k, i - k]) { const it = row[j]; if (it) this.prefetchQ.push(it.id); }
  }
  #runPrefetch() {
    // real covers: request right away (decoding runs off the main thread); title cards: in idle time
    while (this.prefetchQ.length) {
      const id = this.prefetchQ.shift();
      const e = this.entries.get(id); if (!e) continue;
      if (hasCoverImage(e.book)) { const url = this.opts.coverUrl?.(id); if (url) covers.request(url); }
      else scheduleTypo(e.book);
    }
  }
  /** Upload and drawing statistics (tests). */
  get coverStats() { return { ...covers.stats, cached: covers.map.size, queued: covers.queue.length, typoCached: typoTextures.size }; }
  /** The cover pictures on the sides (tests): side-covers.js info() and faces(). */
  get sideCovers() { return this.sides; }

  update(dt, camera) {
    covers.pump(2);
    this.sides.update(dt, camera);
    if (this.warmFrames > 0 && camera) {
      this.warmFrames--;
      camera.getWorldDirection(_v);
      for (const s of this.slots) {
        if (s.entry) continue;
        s.mesh.visible = this.warmFrames > 0;
        s.mesh.position.copy(camera.position).addScaledVector(_v, 0.3);
        s.mesh.scale.setScalar(0.0005);
      }
    }
    for (const e of [...this.animating]) {
      const t = e.target ?? 0;
      e.pull = THREE.MathUtils.lerp(e.pull, t, Math.min(1, dt * 12));
      if (Math.abs(e.pull - t) < 0.01) { e.pull = t; this.animating.delete(e); }
      this.#write(e);
    }
    if (this.pending) {
      this.pending.t += dt;
      if (this.pending.t >= HOVER_DWELL) { const e = this.pending.e; this.pending = null; if (this.hover === e && !e.hidden && this.entries.get(e.book.id) === e) this.#activate(e); }
    }
    for (const s of this.slots) {
      if (!s.entry) continue;
      if (s.target > s.t) s.t = Math.min(s.target, s.t + dt / HOVER_IN);
      else if (s.target < s.t) s.t = Math.max(s.target, s.t - dt / HOVER_OUT);
      if (s.t === 0 && s.target === 0) { this.#releaseSlot(s); continue; }
      if (s.waiting) this.#setFront(s, s.entry.book);
      this.#pose(s, dt, camera);
    }
    if (this.prefetchQ.length) this.#runPrefetch();
  }
  worldInfo(e) { return { position: e.pos.clone(), forward: e.forward.clone(), quat: e.quat.clone(), size: [e.w, e.h, e.d] }; }
}

// ---------------------------------------------------------------- stand-alone books -------------------
export function disposeBookMesh(mesh) {
  mesh.geometry?.dispose?.();
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of new Set(mats)) if (m?.userData?.disposable) { if (!m.userData.keepMap) m.map?.dispose(); m.dispose(); }
}

/** Typographic front cover (title, author, binding colour) for a cover face of size [w, h, d]. */
function typoCoverMaterial(book, size) {
  const [, h, d] = size || [0, 0.22, 0.16];
  const W = 320, H = clamp(Math.round(W * h / Math.max(0.05, d)), 280, 640);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  drawTypoCover(c.getContext('2d'), book, W, H);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
  m.userData.disposable = true;
  return m;
}

/** The address of a book's cover image (BookShelves sets it), for makeBookMesh. */
let coverUrlOf = null;

/** A closed book mesh. size = [w (thickness), h (height), d (depth)]. */
export function makeBookMesh(book, coverTexture, size, { standing = false, faceOut = false } = {}) {
  const [w, h, d] = size || [spineWidth(book), bookHeight(book), 0.16];
  // a cover that is on the graphics card already (the book was looked at a moment ago) shows from the first frame: a
  // book taken from the end of a row, or put back there, keeps the picture its side showed
  if (!coverTexture && hasCoverImage(book)) { const c = covers.map.get(coverUrlOf?.(book.id)); if (c?.ready) coverTexture = c.tex; }
  const base = bindingColor(book).map((v) => v / 255);
  const coverMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(base[0], base[1], base[2], THREE.SRGBColorSpace), roughness: 0.6 });
  coverMat.userData.disposable = true;
  // a book without a cover image (or with the indexer's stand-in title card) shows a typographic front
  const typo = !coverTexture && !hasCoverImage(book);
  const frontMat = coverTexture ? new THREE.MeshStandardMaterial({ map: coverTexture, roughness: 0.55 }) : typo ? typoCoverMaterial(book, [w, h, d]) : coverMat;
  if (coverTexture) { frontMat.userData.disposable = true; frontMat.userData.keepMap = true; }
  const paper = M.paper();
  // the spine drawing comes from the shelf cache (same look as on the shelf, drawn only once)
  const spineTex = new THREE.CanvasTexture(spineCanvas(book, spineWidth(book), bookHeight(book))); spineTex.colorSpace = THREE.SRGBColorSpace; spineTex.anisotropy = 4;
  const spineMat = new THREE.MeshStandardMaterial({ map: spineTex, roughness: 0.7 });
  spineMat.userData.disposable = true;
  const geo = new THREE.BoxGeometry(w, h, d);
  // faces: +x back cover, -x front cover, +y top edge, -y bottom edge, +z spine, -z fore edge
  const mats = [coverMat, frontMat, paper, paper, spineMat, paper];
  // the three paper faces in one group, and the back cover shows the front's picture as on the shelves (side-covers.js):
  // a book taken from the end of a row keeps the picture on the side you saw; three draw calls per book
  { const idx = geo.index.array, order = [0, 1, 2, 3, 5, 4], out = [];
    for (const f of order) for (let k = 0; k < 6; k++) out.push(idx[f * 6 + k]);
    geo.setIndex(out); geo.clearGroups();
    geo.addGroup(0, 12, 1); geo.addGroup(12, 18, 2); geo.addGroup(30, 6, 4); }
  if (!standing) geo.rotateZ(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mats);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.book = book; mesh.userData.size = [w, h, d]; mesh.userData.faceOut = faceOut;
  mesh.userData.frontIndex = 1; mesh.userData.typoCover = typo;
  return mesh;
}

/** An open book (two page planes with a text texture) for tables */
export function makeOpenBookMesh(book, pageText, size = [0.36, 0.25]) {
  const [pw, ph] = size;
  const g = new THREE.Group();
  const base = bindingColor(book).map((v) => v / 255);
  const coverMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(base[0], base[1], base[2], THREE.SRGBColorSpace), roughness: 0.6 });
  coverMat.userData.disposable = true;
  const cover = new THREE.Mesh(new THREE.BoxGeometry(pw + 0.02, 0.008, ph + 0.02), coverMat); cover.position.y = 0.004; g.add(cover);
  const pages = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.018, ph), M.paper()); pages.position.y = 0.017; g.add(pages);
  const tex = pageTextTexture(pageText, book);
  const pageMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }); pageMat.userData.disposable = true;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(pw - 0.01, ph - 0.01), pageMat); plane.rotation.x = -Math.PI / 2; plane.position.y = 0.0275; g.add(plane);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.024, ph + 0.02), coverMat); spine.position.y = 0.012; g.add(spine);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.book = book;
  return g;
}

export function pageTextTexture(text, book) {
  const W = 1024, H = 700; const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
  ctx.fillStyle = '#e9dfc6'; ctx.fillRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(W / 2 - 40, 0, W / 2 + 40, 0); grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.5, 'rgba(0,0,0,0.22)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad; ctx.fillRect(W / 2 - 40, 0, 80, H);
  ctx.fillStyle = '#2b1d12'; ctx.font = '500 27px "EB Garamond", Georgia, serif'; ctx.textBaseline = 'top';
  const words = String(text || (book?.title ? book.title + '. ' : '') + '…').replace(/\s+/g, ' ').split(' ');
  const cols = [[60, 40, W / 2 - 100], [W / 2 + 40, 40, W / 2 - 100]];
  let ci = 0, line = '', y = cols[0][1];
  const lh = 36;
  const flush = () => { ctx.fillText(line, cols[ci][0], y); line = ''; y += lh; if (y > H - 60) { ci++; y = 40; } };
  for (const wd of words) {
    if (ci > 1) break;
    const test = line ? line + ' ' + wd : wd;
    if (ctx.measureText(test).width > cols[ci][2]) flush();
    if (ci > 1) break;
    line = line ? line + ' ' + wd : wd;
  }
  if (line && ci <= 1) flush();
  ctx.font = 'italic 16px "EB Garamond", Georgia, serif'; ctx.fillStyle = '#6a5a48';
  if (book?.title) ctx.fillText(book.title.slice(0, 60), 60, H - 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
