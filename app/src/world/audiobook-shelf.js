// The audiobook cabinet in the hall (layout.js placement 'audiobooks'): an oak display cabinet against the south wall
// between the easel and the music sideboard. It always stands; without an audiobook folder its ledges are empty. Its
// four ledges hold up to 24 audiobook boxes standing face out, the newest audiobooks first (the one heard last, then the
// ones added last); with more audiobooks than places the last place holds a card "Alle Hörbücher". Aiming at a box
// shows its card (hud.js), E plays it, F opens it in the panel; the cabinet, its plate and the card open the panel
// "Hörbücher" (main.js), which offers "Hörbuchordner hinzufügen" while there is none.
//
// Cheap on purpose: all boxes are one mesh with two groups (the covers on the front faces, the plastic of the cases on
// the others) and every cover is a cell of one canvas atlas, so the cabinet adds two draw calls and no shader program
// of its own (a standard material with a map and the same map as glow, like the pictures; the plain body material).
// The box under the crosshair tips forward: only its vertices are written again.
import * as THREE from 'three';
import { Parts, boxGeo, boxGeoUV, planeGeo } from './geo.js';
import { M } from './materials.js';
import { plateMaterial } from './furniture.js';
import { drawTypoCover, fontsLoaded, whenFontsLoaded } from './book-art.js';
import { tr } from '../core/i18n.js';
import { bus } from '../core/bus.js';

/** The cabinet (local frame: x across, y up, front towards +z, origin on the floor in its middle). */
export const AB_CASE = { w: 1.16, d: 0.3, h: 1.56, rows: [0.31, 0.61, 0.91, 1.21], cols: 6, box: 0.158, thick: 0.028, lean: 0.2 };
export const AB_CAPACITY = AB_CASE.rows.length * AB_CASE.cols;
const SIDE = 0.028, INNER = AB_CASE.w - 2 * SIDE;
const CELL = 256, ATLAS_W = AB_CASE.cols * CELL, ATLAS_H = AB_CASE.rows.length * CELL;
const FOOT_Z = AB_CASE.d / 2 - 0.035;                   // where the front edge of a box stands on its ledge
const HOVER_IN = 0.16, HOVER_OUT = 0.12;               // seconds
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _ray = new THREE.Ray(), _m = new THREE.Matrix4(), _p = new THREE.Vector3();
const UNIT = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
const smooth = (x) => x * x * (3 - 2 * x);

/** The unit box of an audiobook case: 24 vertices, faces +x −x +y −y +z −z (BoxGeometry order); +z is the cover. */
const TEMPLATE = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const r = { pos: g.attributes.position.array.slice(), nor: g.attributes.normal.array.slice(), uv: g.attributes.uv.array.slice(), index: g.index.array.slice() };
  g.dispose();
  return r;
})();

export class AudiobookShelf {
  constructor(world) {
    this.world = world;
    this.enabled = false;
    this.books = [];                     // what the panel's list says, newest first: [{ id, title, author, cover, color }]
    this.total = 0;                      // all audiobooks (the card says how many)
    this.slots = [];                     // [{ book | null, all?, matrix, inv, base (Matrix4) }]
    this.caseObj = null; this.plate = null;
    this.hover = -1; this.hoverT = new Float32Array(AB_CAPACITY); this.hoverTarget = new Float32Array(AB_CAPACITY);
    this.layoutDirty = false; this.atlasDirty = false; this.lastUpload = 0; this.loading = 0;   // covers on their way
    // the atlas of the covers: one canvas, one texture, made once and kept across rebuilds of the world
    this.canvas = document.createElement('canvas'); this.canvas.width = ATLAS_W; this.canvas.height = ATLAS_H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false });
    this.ctx.fillStyle = '#2b2b2e'; this.ctx.fillRect(0, 0, ATLAS_W, ATLAS_H);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8; this.tex.generateMipmaps = true; this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.cells = Array.from({ length: AB_CAPACITY }, () => ({ key: null, seq: 0 }));
    // materials of their own, never disposed with a rebuild (no userData.disposable): the covers glow a little with their
    // own picture, like the pictures on the walls, so that they read in the shade of the ledges
    this.coverMat = new THREE.MeshStandardMaterial({ map: this.tex, emissive: 0xffffff, emissiveMap: this.tex, emissiveIntensity: 0.12, roughness: 0.42 });
    this.coverMat.userData.keepMap = true;
    this.caseMat = M.plain(0x2c2c2f, { roughness: 0.42 });
    this.geometry = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geometry, [this.coverMat, this.caseMat]);
    this.mesh.name = 'audiobook-boxes'; this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.mesh.userData.dynamic = true;
    this.group = new THREE.Group(); this.group.name = 'audiobooks'; this.group.visible = false;
    this.group.add(this.mesh);
    world.scene.add(this.group);
    this.#allocGeometry();
    bus.on('i18n:change', () => this.#relabel());
    if (!fontsLoaded()) whenFontsLoaded().then(() => { for (const c of this.cells) if (c.typo) c.key = null; this.#fillCells(); });
  }

  /** settings.audiobooks.folders: the boxes show while there is a folder. The cabinet itself always stands, so nothing
   *  is rebuilt: the boxes come with the first folder (setBooks) and go with the last one, the cabinet stays empty. */
  applySettings(s) {
    this.enabled = Array.isArray(s?.audiobooks?.folders) && s.audiobooks.folders.length > 0;
    if (!this.enabled) this.setHover(-1);
    return false;
  }

  // ------------------------------------------------------------------------------------------------ the cabinet --
  /** The cabinet itself (world.js #buildPlacements). Its boxes are laid out once it stands in its place. */
  buildCase() {
    const { w, d, h, rows } = AB_CASE;
    const wood = M.wood('oak', { along: 'y', contrast: 0.5, grainScale: 1.7 });
    const dark = M.wood('oak', { seed: 5, contrast: 0.7 });
    const p = new Parts();
    p.add(boxGeoUV(w - 0.04, 0.08, d - 0.04, 0.5), dark, [0, 0.04, -0.01]);                                  // plinth
    for (const s of [-1, 1]) p.add(boxGeoUV(SIDE, h - 0.08, d, 0.5), wood, [s * (w / 2 - SIDE / 2), 0.08 + (h - 0.08) / 2, 0]);
    p.add(boxGeoUV(w + 0.03, 0.03, d + 0.02, 0.5), wood, [0, h - 0.015, 0.01]);                                // top
    p.add(boxGeoUV(INNER, h - 0.11, 0.014, 0.5), wood, [0, 0.08 + (h - 0.11) / 2, -d / 2 + 0.007]);           // back
    // the drawer at the foot: two fronts with slim black pulls
    p.add(boxGeoUV(INNER, 0.02, d - 0.02, 0.5), wood, [0, 0.09, 0]);
    for (const s of [-1, 1]) {
      p.add(boxGeoUV(INNER / 2 - 0.008, 0.19, 0.018, 0.5), wood, [s * (INNER / 4), 0.195, d / 2 - 0.009]);
      p.add(boxGeo(0.14, 0.012, 0.014), M.blackMetal(), [s * (INNER / 4), 0.245, d / 2 + 0.006]);
    }
    // ledges with a lip in front of the boxes' feet and a slim rail the boxes lean on
    for (const y of rows) {
      p.add(boxGeoUV(INNER, 0.022, d - 0.03, 0.5), wood, [0, y - 0.011, 0.0]);
      p.add(boxGeoUV(INNER, 0.024, 0.012, 0.5), wood, [0, y + 0.001, d / 2 - 0.016]);
      const rz = FOOT_Z - AB_CASE.thick * Math.cos(AB_CASE.lean) - 0.12 * Math.tan(AB_CASE.lean) - 0.007;
      p.add(boxGeo(INNER, 0.012, 0.012), M.blackMetal(), [0, y + 0.12, rz]);
    }
    // the header with the plate "Hörbücher"
    p.add(boxGeoUV(INNER, 0.1, 0.018, 0.5), wood, [0, h - 0.03 - 0.05, d / 2 - 0.009]);
    const g = p.build({ name: 'audiobook-case' });
    this.plate = new THREE.Mesh(planeGeo(0.44, 0.066), this.#plateMat());
    this.plate.position.set(0, h - 0.08, d / 2 + 0.0015);
    this.plate.userData.dynamic = true; this.plate.name = 'audiobook-plate';
    g.add(this.plate);
    g.userData.footprint = { w: w + 0.04, d: d + 0.04, h };
    this.caseObj = g;
    this.layoutDirty = true;
    return g;
  }
  #plateMat() {
    const m = plateMaterial(tr({ de: 'Hörbücher', en: 'Audiobooks' }), [0.44, 0.066], { size: 46 });
    m.userData.disposable = true;
    return m;
  }
  /** The language changed: the plate and the card "Alle Hörbücher" in the new one. */
  #relabel() {
    if (this.plate) { const old = this.plate.material; this.plate.material = this.#plateMat(); old?.dispose?.(); }
    const last = this.cells[AB_CAPACITY - 1];
    if (last?.key?.startsWith('all|')) { last.key = null; this.#fillCells(); }
  }

  // ------------------------------------------------------------------------------------------------ the boxes --
  /**
   * The audiobooks, newest first: [{ id, title, author, cover (URL of a small picture) | null, color }]; total = how many
   * there are in all (more than fit: the last place says "Alle Hörbücher").
   */
  setBooks(list, total = list?.length || 0) {
    this.books = (list || []).slice(0, AB_CAPACITY);
    this.total = total;
    const more = total > AB_CAPACITY || (list || []).length > AB_CAPACITY;
    const n = more ? AB_CAPACITY - 1 : Math.min(AB_CAPACITY, this.books.length);
    this.slots = Array.from({ length: n + (more ? 1 : 0) }, (_, i) => ({ book: i < n ? this.books[i] : null, all: i >= n }));
    if (this.hover >= this.slots.length) this.hover = -1;
    this.layoutDirty = true;
    this.#fillCells();
  }
  /** Where every box stands: on its ledge, leaning back against the rail; the hovered one tipped towards the viewer. */
  #layout() {
    const c = this.caseObj;
    if (!c?.parent) return;
    c.updateMatrixWorld(true);
    const { cols, rows, box, thick, lean } = AB_CASE, pitch = INNER / cols;
    // the boxes fill the ledges from the top one down (the top ledge is closest to the eye)
    this.slots.forEach((s, i) => {
      const row = rows.length - 1 - Math.floor(i / cols), col = i % cols;
      s.foot = new THREE.Vector3(-INNER / 2 + pitch * (col + 0.5), rows[row], FOOT_Z);
    });
    for (let i = 0; i < this.slots.length; i++) this.#place(i);
    this.#writeAll();
    this.group.visible = this.enabled && !!this.slots.length;
    void box; void thick; void lean;
  }
  /** The matrix of box i (unit box scaled to the case), leaning back by `lean`, tipped by its hover state. */
  #place(i) {
    const s = this.slots[i]; if (!s?.foot) return;
    const { box, thick, lean } = AB_CASE;
    const k = smooth(this.hoverT[i] || 0);
    const a = lean * (1 - k) - 0.06 * k;                         // the tilt: back against the rail, a little forward when aimed at
    const pull = 0.035 * k, lift = 0.02 * k;
    // the box turns about its front lower edge: local box centre relative to that edge
    const local = new THREE.Matrix4().makeTranslation(s.foot.x, s.foot.y + lift, s.foot.z + pull)
      .multiply(new THREE.Matrix4().makeRotationX(-a))
      .multiply(new THREE.Matrix4().makeTranslation(0, box / 2, -thick / 2))
      .multiply(new THREE.Matrix4().makeScale(box, box, thick));
    s.matrix = this.caseObj.matrixWorld.clone().multiply(local);
    s.inv = s.matrix.clone().invert();
  }
  #allocGeometry() {
    const n = AB_CAPACITY, nv = n * 24;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    // indices: the cover faces of all boxes first (group 0), then the other faces (group 1)
    const front = [], rest = [];
    for (let b = 0; b < n; b++) for (let f = 0; f < 6; f++) for (let k = 0; k < 6; k++) (f === 4 ? front : rest).push(TEMPLATE.index[f * 6 + k] + b * 24);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geometry.setIndex([...front, ...rest]);
    this.geometry.clearGroups();
    this.geometry.addGroup(0, front.length, 0); this.geometry.addGroup(front.length, rest.length, 1);
    this.frontCount = front.length / 6;
    this.geometry.setDrawRange(0, 0);
  }
  /** Write the vertices of box i (or collapse it when the place is empty). */
  #writeBox(i) {
    const pos = this.geometry.attributes.position.array, nor = this.geometry.attributes.normal.array, uv = this.geometry.attributes.uv.array;
    const s = this.slots[i], o = i * 24;
    if (!s?.matrix) { pos.fill(0, o * 3, (o + 24) * 3); return; }
    const nm = new THREE.Matrix3().getNormalMatrix(s.matrix);
    // the cover's cell in the atlas, 1.5 texels inside its borders
    const cx = i % AB_CASE.cols, cy = Math.floor(i / AB_CASE.cols), e = 1.5;
    const u0 = (cx * CELL + e) / ATLAS_W, u1 = ((cx + 1) * CELL - e) / ATLAS_W, v1 = 1 - (cy * CELL + e) / ATLAS_H, v0 = 1 - ((cy + 1) * CELL - e) / ATLAS_H;
    for (let k = 0; k < 24; k++) {
      _v.fromArray(TEMPLATE.pos, k * 3).applyMatrix4(s.matrix); _v.toArray(pos, (o + k) * 3);
      _n.fromArray(TEMPLATE.nor, k * 3).applyMatrix3(nm).normalize(); _n.toArray(nor, (o + k) * 3);
      if (k >= 16 && k < 20) { uv[(o + k) * 2] = TEMPLATE.uv[k * 2] ? u1 : u0; uv[(o + k) * 2 + 1] = TEMPLATE.uv[k * 2 + 1] ? v1 : v0; }
    }
  }
  #writeAll() {
    for (let i = 0; i < AB_CAPACITY; i++) this.#writeBox(i);
    this.#upload(true);
  }
  #upload(uvs = false) {
    const g = this.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
    if (uvs) g.attributes.uv.needsUpdate = true;
    g.setDrawRange(0, Infinity);
    g.computeBoundingSphere();
  }

  // ------------------------------------------------------------------------------------------------ covers --
  /** Draw every cell whose content changed: the cover image (decoded off the main thread), else a title card. */
  #fillCells() {
    this.slots.forEach((s, i) => {
      const cell = this.cells[i];
      const key = s.all ? `all|${this.total}|${tr({ de: 'de', en: 'en' })}` : s.book ? `${s.book.id}|${s.book.cover || ''}|${s.book.title}` : null;
      if (cell.key === key) return;
      cell.key = key; cell.typo = false;
      const seq = ++cell.seq;
      const x = (i % AB_CASE.cols) * CELL, y = Math.floor(i / AB_CASE.cols) * CELL, g = this.ctx;
      if (s.all) { this.#drawAllCard(g, x, y); this.atlasDirty = true; return; }
      const b = s.book;
      if (!b) return;
      // until the picture is there: the title card (it is also the cover of an audiobook without a picture)
      g.save(); g.translate(x, y); drawTypoCover(g, { id: 'ab:' + b.id, title: b.title || '', author: b.author || '' }, CELL, CELL); g.restore();
      cell.typo = !b.cover;
      this.atlasDirty = true;
      if (!b.cover) return;
      this.loading++;
      fetch(b.cover).then((r) => (r.ok ? r.blob() : null)).then((blob) => (blob ? createImageBitmap(blob) : null)).then((img) => {
        if (!img || cell.seq !== seq) return;
        g.save(); g.translate(x, y);
        const ar = img.width / img.height;
        if (ar > 0.85 && ar < 1.18) g.drawImage(img, 0, 0, CELL, CELL);
        else {
          // not square (a cassette's portrait cover): the whole picture on its own colour
          g.fillStyle = b.color || '#2b2b2e'; g.fillRect(0, 0, CELL, CELL);
          const k = Math.min(CELL / img.width, CELL / img.height), w = img.width * k, hh = img.height * k;
          g.drawImage(img, (CELL - w) / 2, (CELL - hh) / 2, w, hh);
        }
        g.restore(); img.close?.();
        this.atlasDirty = true;
      }).catch(() => {}).finally(() => { this.loading--; });
    });
  }
  #drawAllCard(g, x, y) {
    g.save(); g.translate(x, y);
    g.fillStyle = '#f6f2ea'; g.fillRect(0, 0, CELL, CELL);
    g.strokeStyle = '#cdbfa6'; g.lineWidth = 4; g.strokeRect(10, 10, CELL - 20, CELL - 20);
    g.fillStyle = '#28302d'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '600 40px "Cormorant Garamond", "EB Garamond", Georgia, serif';
    g.fillText(tr({ de: 'Alle', en: 'All' }), CELL / 2, 82);
    g.fillText(tr({ de: 'Hörbücher', en: 'audiobooks' }), CELL / 2, 124);
    g.fillStyle = '#5c544a'; g.font = '500 26px "Segoe UI", Arial, sans-serif';
    g.fillText(String(this.total), CELL / 2, 178);
    g.restore();
  }

  // ------------------------------------------------------------------------------------------------ looking --
  /** The box (or the card) the ray meets first within `far`: { index, distance, book | null, all } or null. */
  pick(ray, far) {
    if (!this.group.visible) return null;
    let best = null, bestD = far;
    this.slots.forEach((s, i) => {
      if (!s.inv) return;
      _ray.copy(ray).applyMatrix4(s.inv);
      const hit = _ray.intersectBox(UNIT, _p);
      if (!hit) return;
      const d = _p.applyMatrix4(s.matrix).distanceTo(ray.origin);
      if (d < bestD) { bestD = d; best = { index: i, distance: d, book: s.book, all: !!s.all }; }
    });
    return best;
  }
  /** The box under the crosshair tips forward, the previous one goes back. */
  setHover(index) {
    const i = index == null || index < 0 ? -1 : index;
    if (i === this.hover) return;
    if (this.hover >= 0) this.hoverTarget[this.hover] = 0;
    this.hover = i;
    if (i >= 0) this.hoverTarget[i] = 1;
  }
  /** The index of the box of an audiobook (tests, the HUD): -1 when it is not in the cabinet. */
  indexOf(id) { return this.slots.findIndex((s) => s.book?.id === id); }
  /** Where a visitor stands to look at box i: { x, z, yaw, pitch } (tests). */
  viewOf(i, dist = 1.1) {
    const s = this.slots[i]; if (!s?.matrix) return null;
    const c = new THREE.Vector3(0, 0, 0).applyMatrix4(s.matrix);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(this.caseObj.matrixWorld));
    const x = c.x + fwd.x * dist, z = c.z + fwd.z * dist;
    return { x, z, yaw: Math.atan2(-(c.x - x), -(c.z - z)), pitch: Math.atan2(c.y - 1.62, Math.hypot(c.x - x, c.z - z)), center: c };
  }

  update(dt) {
    if (!this.enabled || !this.caseObj) { if (this.group.visible) this.group.visible = false; return; }
    if (this.layoutDirty && this.caseObj.parent) { this.layoutDirty = false; this.#layout(); }
    // the tipping box (and the one going back): only their vertices
    let moved = false;
    for (let i = 0; i < this.slots.length; i++) {
      const t = this.hoverTarget[i], v = this.hoverT[i];
      if (t === v) continue;
      this.hoverT[i] = t > v ? Math.min(t, v + dt / HOVER_IN) : Math.max(t, v - dt / HOVER_OUT);
      this.#place(i); this.#writeBox(i); moved = true;
    }
    if (moved) this.#upload();
    // the covers: at most one upload of the atlas every 150 ms while pictures arrive
    const now = performance.now();
    if (this.atlasDirty && now - this.lastUpload > 150) { this.atlasDirty = false; this.lastUpload = now; this.tex.needsUpdate = true; }
  }
}
