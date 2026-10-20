// The wall finish ("Wandgestaltung", settings.walls): the plaster above the panelling in the hall, the passage and the
// book room stays white, takes a calm colour or carries a graffiti mural (wall-art.js, painted in a worker).
//
// A thin skin 4 mm in front of every inner wall face does it: one mesh per wall, built once from the layout (the walls
// never move), so a change is a material swap and never a rebuild of the world. White hides the skin, a colour gives
// it the tinted plaster material (the walls' own textures, the same shader program), graffiti gives every wall its
// mural (uv1, one texture per wall). The mural of a seed is painted off the main thread and uploaded a strip per frame.
// Its words follow the language of the interface: another language paints the mural again in the background, the
// old one stays on the walls until the new one is there.
import * as THREE from 'three';
import { M } from './materials.js';
import { HALL, PASSAGE, ROOM, CASING_W } from './layout.js';
import { WALL_COLORS, wallStyleOf, wallPainting } from './wall-styles.js';
import { bus } from '../core/bus.js';
import { i18n } from '../core/i18n.js';
import { TextureStream } from './texture-stream.js';

/** The language of the mural's words (wall-art.js MURAL_WORDS): English, else German. */
const muralLangOf = (lang) => (lang === 'en' ? 'en' : 'de');

/** Mural texels per metre: sharp from about a metre away, 62 MB (MiB) on the graphics card for all walls with their
 *  mipmaps. A wall that is mostly glass (the hall's glass front) gets fewer: only narrow strips of it show. */
export const MURAL_DENSITY = 160, MURAL_DENSITY_GLASS = 64;
/** A mural nobody looks at any more (another finish chosen) leaves the graphics card after this long. */
const IDLE_MS = 45000;
const SKIN = 0.004;                     // the skin's distance from the wall face
const TILE = 1.2;                       // metres per tile of the plaster textures (as the walls themselves)
const PLASTER = '#f7f3ec';              // the walls' own plaster (world.js #buildStructure)

// ---------------------------------------------------------------- the walls as data -----------------------------------
/**
 * Every inner wall face that carries plaster: where it lies, its height band (above the panelling, below the cornice),
 * the parts of it that are wall (between doors and windows), and what stands on or in front of it. `u` runs along the
 * wall from its left end as seen from the room; a room's walls follow each other round the room (`s0`, `loop`), so the
 * background of a mural runs on round the corners.
 * `boxes`: [{ kind, box: THREE.Box3 }] of the furniture in the hall and the passage (fixed, unlike the book room's).
 */
export function wallSpecs(L, boxes = []) {
  const specs = [];
  const room = (name, B, y0, y1, top, pieceMin) => {
    const W = B.x1 - B.x0, D = B.z1 - B.z0, loop = 2 * (W + D);
    specs.push(
      { id: name + ':south', room: name, axis: 'x', at: B.z0, dir: 1, a0: B.x0, a1: B.x1, flip: false, s0: 0, loop, y0, y1, top, pieceMin },
      { id: name + ':east', room: name, axis: 'z', at: B.x1, dir: -1, a0: B.z0, a1: B.z1, flip: false, s0: W, loop, y0, y1, top, pieceMin },
      { id: name + ':north', room: name, axis: 'x', at: B.z1, dir: -1, a0: B.x0, a1: B.x1, flip: true, s0: W + D, loop, y0, y1, top, pieceMin },
      { id: name + ':west', room: name, axis: 'z', at: B.x0, dir: 1, a0: B.z0, a1: B.z1, flip: true, s0: 2 * W + D, loop, y0, y1, top, pieceMin },
    );
  };
  // the chair rail ends at 1.0 m, the cornice starts 24 cm under the ceiling (`top`): the skin hides behind both
  room('hall', HALL, 0.98, HALL.h - 0.18, HALL.h - 0.25, 1.05);
  // in the book room pieces only go above the department signs (the shelves below change with the library)
  room('room', ROOM, 0.98, ROOM.h - 0.18, ROOM.h - 0.25, 3.0);
  const P = PASSAGE, plen = P.z1 - P.z0;
  specs.push(
    { id: 'passage:west', room: 'passage', axis: 'z', at: P.x - P.w / 2, dir: 1, a0: P.z0, a1: P.z1, flip: true, s0: 0, loop: 0, y0: 0, y1: P.h, top: P.h - 0.05, pieceMin: 0.9 },
    { id: 'passage:east', room: 'passage', axis: 'z', at: P.x + P.w / 2, dir: -1, a0: P.z0, a1: P.z1, flip: false, s0: plen + P.w, loop: 0, y0: 0, y1: P.h, top: P.h - 0.05, pieceMin: 0.9 },
  );
  for (const s of specs) {
    s.len = s.a1 - s.a0;
    s.parts = []; s.blocks = [];
    const toU = (a, b) => (s.flip ? [s.a1 - b, s.a1 - a] : [a - s.a0, b - s.a0]);
    // the wall boxes whose face lies on this plane: the skin covers them, the gaps are doors and windows
    for (const b of L.walls) {
      const along = s.axis === 'x' ? [b.x - b.w / 2, b.x + b.w / 2] : [b.z - b.d / 2, b.z + b.d / 2];
      const face = s.axis === 'x' ? b.z + s.dir * b.d / 2 : b.x + s.dir * b.w / 2;
      const thin = s.axis === 'x' ? b.d < 0.6 : b.w < 0.6;
      if (!thin || Math.abs(face - s.at) > 1e-3) continue;
      const a = Math.max(along[0], s.a0), c = Math.min(along[1], s.a1);
      const y0 = Math.max(b.y - b.h / 2, s.y0), y1 = Math.min(b.y + b.h / 2, s.y1);
      if (c - a < 0.01 || y1 - y0 < 0.01) continue;
      const [u0, u1] = toU(a, c);
      s.parts.push({ u0, u1, y0, y1 });
    }
    const on = (x, z, slack = 0.4) => (s.axis === 'x' ? Math.abs(z - s.at) < slack && x > s.a0 - 0.1 && x < s.a1 + 0.1 : Math.abs(x - s.at) < slack && z > s.a0 - 0.1 && z < s.a1 + 0.1);
    const block = (a, half, y0, y1, extra = {}) => { const [u0, u1] = toU(a - half, a + half); s.blocks.push({ u0, u1, y0, y1, ...extra }); };
    const alongOf = (x, z) => (s.axis === 'x' ? x : z);
    // doorways: the timber casing round the passage openings, the frame of the front door, window frames and sills
    for (const o of L.openings) {
      if (!on(o.x, o.z, 0.05)) continue;
      const a = alongOf(o.x, o.z);
      if (o.kind === 'arch') block(a, o.w / 2 + CASING_W + 0.02, 0, o.h + 0.28);
      else block(a, o.w / 2 + 0.1, (o.y0 || 0) - 0.12, (o.y0 || 0) + o.h + 0.1);
    }
    for (const pl of L.placements) {
      const y = pl.meta?.y || 0, a = alongOf(pl.x, pl.z), o = pl.opts || {};
      // the book room's pictures, chairs and plants follow the shelves: they are not part of the composition
      const inRoom = pl.z < ROOM.z1 + 0.2;
      switch (pl.kind) {
        case 'painting': if (!inRoom && on(pl.x, pl.z)) block(a, (o.w || 1.2) / 2 + 0.06, y - (o.h || 0.9) / 2 - 0.06, y + (o.h || 0.9) / 2 + 0.06); break;
        case 'sconce': if (on(pl.x, pl.z)) block(a, 0.14, y - 0.17, y + 0.17); break;
        case 'door': if (on(pl.x, pl.z)) block(a, (o.w || 2) / 2 + 0.2, 0, (o.h || 2.9) + 0.2); break;
        case 'worldmap': if (on(pl.x, pl.z)) block(a, (o.w || 3.6) / 2 + 0.08, y - (o.h || 2.1) / 2 - 0.08, y + (o.h || 2.1) / 2 + 0.08); break;
        case 'fireplace': if (on(pl.x, pl.z, 0.8)) { block(a, (o.w || 2.6) / 2 + 0.22, 0, 1.75); block(a, (o.w || 2.6) * 0.35 + 0.06, 0, 9); } break;
        // the film screen rolls down in front of the chimney breast: its case always, the cloth only while a film runs
        case 'screen': if (on(pl.x, pl.z, 0.8)) { block(a, 2.02, 4.78, 9); block(a, 1.98, 1.85, 4.8, { soft: true }); } break;
        case 'beam': {
          // the beams run across the room and end in the side walls
          if (s.axis !== 'z') break;
          const x0 = pl.x - (o.len || 0) / 2, x1 = pl.x + (o.len || 0) / 2;
          if (s.at > x0 - 0.05 && s.at < x1 + 0.05 && pl.z > s.a0 && pl.z < s.a1) block(pl.z, (o.w || 0.3) / 2 + 0.05, y - (o.h || 0.4) / 2 - 0.05, 9);
          break;
        }
      }
    }
    if (L.directory && on(L.directory.x, L.directory.z)) { const d = L.directory; block(alongOf(d.x, d.z), d.w / 2 + 0.08, d.y - d.h / 2 - 0.08, d.y + d.h / 2 + 0.08); }
    // furniture in front of the wall (hall and passage): small things may go behind it, pieces and characters not
    for (const { box } of boxes) {
      const near = s.axis === 'x' ? (s.dir > 0 ? box.min.z - s.at : s.at - box.max.z) : (s.dir > 0 ? box.min.x - s.at : s.at - box.max.x);
      if (near > 1.3 || near < -0.4) continue;
      const lo = s.axis === 'x' ? box.min.x : box.min.z, hi = s.axis === 'x' ? box.max.x : box.max.z;
      if (hi < s.a0 || lo > s.a1 || box.max.y < s.y0 + 0.05) continue;
      const [u0, u1] = toU(Math.max(lo, s.a0), Math.min(hi, s.a1));
      s.blocks.push({ u0: u0 - 0.05, u1: u1 + 0.05, y0: 0, y1: box.max.y + 0.12, soft: true, margin: 0 });
    }
  }
  return specs;
}

// ---------------------------------------------------------------- the skin -------------------------------------------
/** One mesh per wall: quads over the wall parts, uv in plaster tiles, uv1 over the whole wall (0..1, top row first). */
function skinGeometry(s) {
  const pos = [], nrm = [], uv = [], uv1 = [], idx = [];
  const n = s.axis === 'x' ? [0, 0, s.dir] : [s.dir, 0, 0];
  const at = s.at + s.dir * SKIN;
  const P = (u, y) => { const a = s.flip ? s.a1 - u : s.a0 + u; return s.axis === 'x' ? [a, y, at] : [at, y, a]; };
  for (const p of s.parts) {
    const base = pos.length / 3;
    for (const [u, y] of [[p.u0, p.y0], [p.u1, p.y0], [p.u1, p.y1], [p.u0, p.y1]]) {
      pos.push(...P(u, y)); nrm.push(...n);
      uv.push(u / TILE, y / TILE); uv1.push(u / s.len, (s.y1 - y) / (s.y1 - s.y0));
    }
    // counter-clockwise as seen from the room
    const a = new THREE.Vector3(...P(p.u0, p.y0)), b = new THREE.Vector3(...P(p.u1, p.y0)), c = new THREE.Vector3(...P(p.u1, p.y1));
    const front = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).dot(new THREE.Vector3(...n)) > 0;
    if (front) idx.push(base, base + 1, base + 2, base, base + 2, base + 3); else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** The linear tint that turns the white plaster texture into `target` (both sRGB). */
function tintFor(target) {
  const base = new THREE.Color(PLASTER).multiplyScalar(0.93), want = new THREE.Color(target);   // THREE.Color holds linear values
  return new THREE.Color(want.r / base.r, want.g / base.g, want.b / base.b);
}

export class WallFinish {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group(); this.group.name = 'wall-finish'; this.group.visible = false;
    this.meshes = null;          // wall id → mesh
    this.want = { style: 'white', seed: 1, lang: muralLangOf(i18n.lang) };
    this.shown = 'white';        // what the walls show right now (a colour, 'graffiti' or 'white')
    this.mural = null;           // { seed, lang, textures: Map } of the mural on the walls
    this.job = null;             // the mural being painted: { id, seed, lang, queue, textures, t0 }
    this.jobId = 0;
    this.stats = { paintMs: 0, uploadMs: [], bytes: 0, plan: null, swaps: 0 };
    // the words of the mural follow the language of the interface
    this.offLang = bus.on('i18n:change', (lang) => this.setLanguage(lang));
  }

  /** The language of the interface changed: a mural on the walls is painted again with the words of that language in
   *  the background (the one on the walls stays until the new one is there). */
  setLanguage(lang) {
    const l = muralLangOf(lang);
    if (l === this.want.lang) return;
    this.want = { ...this.want, lang: l };
    if (!this.meshes || !this.applied || this.want.style !== 'graffiti') return;
    if (!this.#isMural(this.want)) this.#paint(this.want.seed);
    this.#show();
  }
  /** Is the mural on the walls the one of `want` (seed and language)? */
  #isMural(want) { return this.mural?.seed === want.seed && this.mural?.lang === want.lang; }

  /** Builds the skins (once: the walls stay where they are when the shelves or the quality change). */
  build(layout) {
    if (this.meshes) return;
    const w = this.world;
    // furniture in front of the walls of the hall and the passage keeps pieces and characters away
    const boxes = [];
    for (const o of w.static.children) {
      const pl = o.userData.placement;
      if (!pl || pl.z < PASSAGE.z0 - 0.2 || ['rug', 'beam', 'pendant', 'painting', 'sconce', 'glazing', 'glassdoor', 'door', 'fireplace', 'screen', 'clock'].includes(pl.kind)) continue;
      const box = new THREE.Box3().setFromObject(o);
      if (!box.isEmpty()) boxes.push({ kind: pl.kind, box });
    }
    this.specs = wallSpecs(layout, boxes).filter((s) => s.parts.length);
    for (const s of this.specs) {
      const area = s.parts.reduce((a, p) => a + (p.u1 - p.u0) * (p.y1 - p.y0), 0);
      s.density = area < 0.35 * s.len * (s.y1 - s.y0) ? MURAL_DENSITY_GLASS : MURAL_DENSITY;
    }
    const base = M.wall(PLASTER);
    this.plain = new THREE.MeshStandardMaterial({ map: base.map, normalMap: base.normalMap, normalScale: base.normalScale.clone(), roughnessMap: base.roughnessMap, roughness: base.roughness });
    this.plain.name = 'wall-colour';
    this.meshes = new Map();
    const aniso = Math.min(16, w.renderer.capabilities.getMaxAnisotropy());
    this.placeholder = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1); this.placeholder.channel = 1; this.placeholder.colorSpace = THREE.SRGBColorSpace; this.placeholder.needsUpdate = true;
    for (const s of this.specs) {
      const mat = new THREE.MeshStandardMaterial({ map: this.placeholder, normalMap: base.normalMap, normalScale: new THREE.Vector2(0.18, 0.18), roughnessMap: base.roughnessMap, roughness: 0.84 });
      mat.name = 'wall-mural';
      const mesh = new THREE.Mesh(skinGeometry(s), this.plain);
      mesh.name = 'wall-skin:' + s.id; mesh.receiveShadow = true; mesh.castShadow = false;
      mesh.userData.mural = mat; mesh.userData.spec = s;
      this.meshes.set(s.id, mesh);
      this.group.add(mesh);
    }
    this.aniso = aniso;
    this.stream = new TextureStream(w.renderer);   // the painted walls onto the graphics card, a strip per frame
    // A centimetre of mural inside the hall's south wall, drawn every frame and never seen: the mural shader is
    // compiled with the rest of the scene (world.js #warmUp) and keeps up with the lights, and every freshly uploaded
    // wall texture is drawn once here before the walls switch to it (Direct3D finishes an upload on the first draw;
    // ten new textures in one frame cost 35 ms).
    this.warmMat = new THREE.MeshStandardMaterial({ map: this.placeholder, normalMap: base.normalMap, normalScale: new THREE.Vector2(0.18, 0.18), roughnessMap: base.roughnessMap, roughness: 0.84 });
    const warm = this.warm = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), this.warmMat);
    warm.geometry.setAttribute('uv1', warm.geometry.attributes.uv.clone());
    warm.position.set(PASSAGE.x + 3, 4.6, HALL.z0 - HALL.wall / 2);
    warm.frustumCulled = false; warm.receiveShadow = true; warm.castShadow = false; warm.name = 'wall-mural-warm';
    w.scene.add(warm);
    w.scene.add(this.group);
    this.#show();
  }

  /** settings.walls → the walls (at once for white and the colours; a new mural appears once it is painted). */
  apply(cfg) {
    const want = { ...wallStyleOf({ walls: cfg }), lang: this.want.lang };
    // every settings change passes here (a slider, the volume): nothing to do unless the walls change
    if (want.style === this.want.style && want.seed === this.want.seed && this.meshes && this.applied) return;
    this.want = want;
    if (!this.meshes) return;
    this.applied = true;
    if (want.style === 'graffiti') { this.idleSince = 0; if (!this.#isMural(want)) this.#paint(want.seed); }
    else if (this.mural || this.job) this.idleSince ||= performance.now();
    this.#show();
  }

  /** What the walls show for `want`, as far as it is there already. */
  #show() {
    const { style } = this.want;
    if (style === 'graffiti') {
      // until the mural of this seed and language is painted the walls keep what they showed before
      if (!this.#isMural(this.want)) return;
      for (const m of this.meshes.values()) m.material = m.userData.mural;
      this.group.visible = true; this.shown = 'graffiti';
      return;
    }
    if (style === 'white') { this.group.visible = false; this.shown = 'white'; return; }
    this.plain.color.copy(tintFor(WALL_COLORS[style]));
    for (const m of this.meshes.values()) m.material = this.plain;
    this.group.visible = true; this.shown = style;
  }

  #worker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./wall-art-worker.js', import.meta.url), { type: 'module', name: 'wall-art' });
    this.worker.onmessage = (e) => this.#onMessage(e.data);
    // a worker that cannot start leaves the walls as they are (and the spray button usable)
    this.worker.onerror = (e) => { console.warn('[walls] worker', e.message || e); this.job = null; this.#busy(false); };
    return this.worker;
  }
  #paint(seed) {
    const lang = this.want.lang;
    if (this.job?.seed === seed && this.job.lang === lang) return;
    this.stream.clear();
    for (const t of this.job?.textures?.values() || []) t.dispose();
    this.warmMat.map = this.placeholder;
    const id = ++this.jobId;
    this.job = { id, seed, lang, textures: new Map(), ready: 0, t0: performance.now(), done: false, drawn: false };
    this.stats.uploadMs = [];
    this.#busy(true);
    this.#worker().postMessage({ type: 'paint', id, seed, lang, density: MURAL_DENSITY, walls: this.painterWalls() });
  }
  /** The walls as the painter needs them (structured clone): also for the checks, which plan murals themselves. */
  painterWalls() {
    return this.specs.map(({ id: wid, room, len, y0, y1, top, s0, loop, parts, blocks, pieceMin, density }) => ({ id: wid, room, len, y0, y1, top, s0, loop, parts, blocks, pieceMin, density }));
  }
  #onMessage(m) {
    const job = this.job;
    if (!job || m.id !== job.id) return;
    if (m.type === 'wall') {
      // the wall's texture gets its storage now and its pixels a strip per frame (texture-stream.js); once complete it
      // is drawn once by the warm-up centimetre (see build)
      const tex = this.stream.add(m.data, m.w, m.h, { srgb: true, anisotropy: this.aniso, channel: 1, done: (t) => { if (this.job === job) { this.warmMat.map = t; job.ready++; } }, release: (d) => { try { this.worker?.postMessage({ type: 'recycle' }, [d.buffer]); } catch {} } });
      job.textures.set(m.wall, tex);
    } else if (m.type === 'done') { job.done = true; job.paintMs = m.ms; job.plan = m.stats; }
    else if (m.type === 'error') { console.warn('[walls] mural', m.message); this.stream.clear(); this.job = null; this.#busy(false); }
  }

  /** Every frame: a strip of a finished wall onto the graphics card, and the mural onto the walls once all are there. */
  update() {
    // a mural that is not wanted any more leaves the graphics card after a while
    if (this.idleSince && performance.now() - this.idleSince > IDLE_MS) { this.idleSince = 0; if (this.want.style !== 'graffiti') this.#drop(); }
    this.stream?.tidy();   // textures no longer shown go one a frame (texture-stream.js retire)
    const job = this.job;
    if (!job) return;
    if (this.stream.busy) {
      const t0 = performance.now();
      this.stream.step();
      this.stats.uploadMs.push(+(performance.now() - t0).toFixed(2));
      return;
    }
    if (!job.done || job.ready < this.meshes.size) return;
    // the last wall is drawn once by the warm-up centimetre before the walls switch
    if (!job.drawn) { job.drawn = true; return; }
    this.warmMat.map = this.placeholder;
    // all walls are there: swap the mural
    const old = this.mural;
    for (const [id, mesh] of this.meshes) { const t = job.textures.get(id); if (t) mesh.userData.mural.map = t; }
    this.mural = { seed: job.seed, lang: job.lang, textures: job.textures };
    this.stats.paintMs = Math.round(job.paintMs || 0); this.stats.plan = job.plan; this.stats.swaps++;
    this.stats.totalMs = Math.round(performance.now() - job.t0);
    this.stats.bytes = [...job.textures.values()].reduce((a, t) => a + (t.userData.bytes || 0), 0);
    this.job = null;
    if (old) for (const t of old.textures.values()) this.stream.retire(t);
    this.#show();
    this.#busy(false);
  }

  /** The settings panel shows "Wird gesprüht …" while a mural is painted. */
  #busy(on) { if (wallPainting.busy !== on) { wallPainting.busy = on; bus.emit('walls:painting', on); } }

  /** Frees the mural textures (the materials get the placeholder back). */
  #drop() {
    if (this.job) { this.stream.clear(); for (const t of this.job.textures.values()) t.dispose(); this.job = null; this.jobId++; this.warmMat.map = this.placeholder; this.#busy(false); }
    if (!this.mural) return;
    for (const m of this.meshes.values()) m.userData.mural.map = this.placeholder;
    for (const t of this.mural.textures.values()) this.stream.retire(t);
    this.mural = null; this.stats.bytes = 0; this.stats.dropped = (this.stats.dropped || 0) + 1;
  }

  /** For the checks: what the walls show and what they cost. */
  info() {
    return { want: { ...this.want }, shown: this.shown, visible: this.group.visible, walls: this.meshes?.size || 0, painting: !!this.job, muralSeed: this.mural?.seed ?? null, muralLang: this.mural?.lang ?? null, ...this.stats, mb: +(this.stats.bytes / 1048576).toFixed(1) };
  }

  dispose() {
    this.offLang?.(); this.offLang = null;
    this.worker?.terminate(); this.worker = null;
    this.stream?.dispose();
    for (const t of this.mural?.textures?.values() || []) t.dispose();
    for (const t of this.job?.textures?.values() || []) t.dispose();
    for (const m of this.meshes?.values() || []) { m.geometry.dispose(); m.userData.mural.dispose(); }
    this.plain?.dispose(); this.placeholder?.dispose(); this.warmMat?.dispose(); this.warm?.geometry.dispose(); this.warm?.removeFromParent();
    this.group.removeFromParent();
  }
}
