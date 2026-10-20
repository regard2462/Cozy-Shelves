// Tracks in the snow: the prints of the player's boots (left and right at the real steps, longer and further apart when
// running, a scuffed mark where a jump lands), the hoof and paw prints of the deer, foxes and the wolf (wildlife.js) and
// the small three-toed prints of the birds that hop or walk on the ground (birds.js). They fade over some minutes,
// faster while snow falls, and are gone at once when the snow is.
//   No geometry: every print is a row in a small data texture, and the surfaces that carry snow (the garden's ground,
// the path, the deck, the jetty and the frozen lake: nature.js 'ground' and 'plain' kinds, ice.js) press it into their
// own snow in their own shader (TRACKS_GLSL): a hollow with walls and a raised rim in the surface's normal, the floor a
// little darker. So a print lies exactly on what it was made on, on slopes, at the edge of the path and on the boards,
// lit, shadowed and fogged like the snow round it, by day, at dusk and by moonlight, and no new shader program is ever
// needed. A grid of 1 m cells (a second texture) lists the prints that reach into each cell, so a fragment looks at
// no more than eight of them.
//   Budgets: 512 prints of the player, 256 of the animals, 256 of the birds; a new one takes the place of the oldest
// of its kind. The wear clock runs at 1 a second, 4 while it snows, 2.5 in rain; a print fades from 45 % of its life
// (8 minutes) on. Besides them lie the old, soft prints of earlier walkers (up to 256) along the middle of the path, from
// the glass doors over the deck, out on the jetty and up the trail to the knoll: they stay while the snow lies, and the
// player's fresh prints take their place where he treads.
import * as THREE from 'three';
import { NATURE } from './nature.js';
import { outside, onJetty, HOUSE, WATER_Y, terrainHeight, groundHeight, FIREBOWL, PATH, TRAILS, JETTY } from './outdoor.js';
import { seeded } from '../core/hash.js';

// ---------------------------------------------------------------- the kinds and their budgets ---------------------------
/** Print kinds as the shader knows them (TRACKS_GLSL). */
export const PRINT_KINDS = { boot: 0, run: 1, land: 2, hoof: 3, paw: 4, bird: 5 };
const POOL_OF = { boot: 'player', run: 'player', land: 'player', hoof: 'animal', paw: 'animal', bird: 'bird' };
const POOLS = { player: [0, 512], animal: [512, 256], bird: [768, 256], old: [1024, 256] };
const CAP = 1280;
const OLD = 10;                           // added to the kind of an earlier walker's print (the shader: old and soft)
/** How far a print reaches from its point (m; the shader looks no further than 0.3 m). */
const REACH = { boot: 0.19, run: 0.25, land: 0.3, hoof: 0.06, paw: 0.08, bird: 0.06 };
export const TRACK_LIFE = 480;           // wear seconds until a print is gone (8 minutes in dry weather)
const FADE_FROM = 0.45;                   // share of the life from which it fades
const SLOTS = 8;                          // prints a cell can list
// the grid: 1 m cells over the garden you can walk in, the lake included
const GX0 = -64, GZ0 = 0, GNX = 96, GNZ = 68;

// ---------------------------------------------------------------- the shared uniforms ------------------------------------
const dataArr = new Float32Array(CAP * 2 * 4);
const cellArr = new Float32Array(GNX * 2 * GNZ * 4);
function dataTexture(arr, w, h) {
  const t = new THREE.DataTexture(arr, w, h, THREE.RGBAFormat, THREE.FloatType);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  // (the first upload is the whole texture; after an upload the next changes go up in pieces again: see changed())
  t.userData.whole = true; t.onUpdate = () => { t.userData.whole = false; };
  return t;
}
/** Floats [start, start + count) of a texture changed: they go up with the next frame, in pieces (one call each); after
 *  many changes in one frame (the old prints laid at once) the whole texture in one call. */
function changed(t, start, count) {
  if (!t.userData.whole) {
    if (t.updateRanges.length < 64) t.addUpdateRange(start, count);
    else { t.clearUpdateRanges(); t.userData.whole = true; }
  }
  t.needsUpdate = true;
}
/** The uniforms every snowy surface reads (nature.js adds them to its 'ground' and 'plain' kinds, ice.js to the ice). */
export const TRACKS = {
  uTrkData: { value: dataTexture(dataArr, CAP * 2, 1) },
  uTrkCells: { value: dataTexture(cellArr, GNX * 2, GNZ) },
  uTrkGrid: { value: new THREE.Vector4(GX0, GZ0, GNX, GNZ) },
  // the wear clock, the life, the share of the life from which a print fades, on (some print exists)
  uTrkTime: { value: new THREE.Vector4(0, TRACK_LIFE, FADE_FROM, 0) },
};

/**
 * GLSL: trkField(p, ps, shade) → (dh/dx, dh/dz, h, floor) of the prints at the world point p (ps: the size of a pixel
 * there in metres). h is the height of the snow's surface against the untouched snow round it (negative in a hollow),
 * floor how much of the point lies on the trodden floor of a print, shade how much of it lies in the shadow of a wall.
 * trkApply() presses them into a surface. Shapes in a print's own frame: x forward (towards the toes), y to the left; a
 * right boot, mirrored for the left one.
 */
export const TRACKS_GLSL = `
uniform sampler2D uTrkData; uniform sampler2D uTrkCells; uniform vec4 uTrkGrid; uniform vec4 uTrkTime;
// iq's approximation of the distance to an ellipse (good near its outline), negative inside
float trkEll(vec2 p, vec2 r) { float k0 = length(p / r), k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / max(k1, 1e-6); }
float trkSeg(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
float trkSmin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
// a boot of about 29 cm: the ball of the foot (the big toe's side to the left: a right foot), the heel and the waist
float trkBoot(vec2 q) {
  float ball = trkEll(q - vec2(0.05, 0.005), vec2(0.088, 0.051)), heel = trkEll(q - vec2(-0.09, 0.0), vec2(0.058, 0.042));
  return trkSmin(min(ball, heel), trkSeg(q, vec2(-0.09, 0.0), vec2(0.04, 0.004), 0.036), 0.02);
}
// a roe deer's hoof: two halves, pointed in front (about 6 × 4.5 cm at size 1)
float trkHoof(vec2 q) {
  float n = 1.0 - 0.6 * smoothstep(-0.006, 0.03, q.x);
  float a = trkEll(vec2(q.x, (q.y - 0.0118) / n), vec2(0.031, 0.0102)) * n, b = trkEll(vec2(q.x, (q.y + 0.0118) / n), vec2(0.031, 0.0102)) * n;
  return min(a, b);
}
// a fox's paw: the heel pad and four toes (about 5 × 4 cm at size 1)
float trkPaw(vec2 q) {
  float d = trkEll(q - vec2(-0.012, 0.0), vec2(0.0115, 0.014));
  d = min(d, min(trkEll(q - vec2(0.016, 0.0072), vec2(0.0078, 0.006)), trkEll(q - vec2(0.016, -0.0072), vec2(0.0078, 0.006))));
  d = min(d, min(trkEll(q - vec2(0.0035, 0.0172), vec2(0.0072, 0.0058)), trkEll(q - vec2(0.0035, -0.0172), vec2(0.0072, 0.0058))));
  return d;
}
// a bird's foot: three toes forward, one back (t: the middle toe's length, w: half the width of a toe)
float trkBird(vec2 q, float t, float w) {
  float d = trkSeg(q, vec2(0.0), vec2(t, 0.0), w);
  d = min(d, trkSeg(q, vec2(0.0), vec2(0.62, 0.45) * t, w * 0.9));
  d = min(d, trkSeg(q, vec2(0.0), vec2(0.62, -0.45) * t, w * 0.9));
  return min(d, trkSeg(q, vec2(0.0), vec2(-0.55 * t, 0.0), w * 0.9));
}
// the snow's height over a print (m): the hollow (depth D, its walls w wide) and the snow pushed up round it (rim)
float trkProfile(float d, float D, float w, float rim) {
  float floorK = smoothstep(0.0, -w, d);
  float lip = exp(-pow((d - w * 0.7) / (w + 0.004), 2.0));
  return -D * floorK + rim * lip;
}
// one print: its height at q (its own frame) and the share of the trodden floor; k: kind, s: size, age: 0 … 1 of its life
vec2 trkPrint(float k, vec2 q, float s, float age, float ps) {
  // older prints are shallower, their edges softer (snow drifts in and settles)
  float soft = 1.0 + 1.6 * age, fill = 1.0 - 0.55 * smoothstep(0.0, 1.0, age);
  float h = 0.0, fl = 0.0;
  if (k < 2.5) {
    float D = 0.034 * fill, w = max(0.02 * soft, ps * 1.5), d = 1.0;
    if (k < 0.5) {
      d = trkBoot(q);
      D *= 0.85 + 0.25 * smoothstep(-0.12, 0.1, q.x);                       // the toes press deeper than the heel
    } else if (k < 1.5) {
      // running: a longer print, the toes dug in, the heel barely down, snow kicked ahead of it
      d = min(trkBoot(vec2(q.x * 0.87, q.y)), trkEll(q - vec2(0.2, 0.004), vec2(0.07, 0.034)) + 0.006);
      D *= 0.55 + 0.75 * smoothstep(-0.1, 0.12, q.x);
    }
    if (k < 1.5) {
      // the tread: fine lugs across the sole
      h = trkProfile(d, D, w, 0.0045 * fill) + 0.0016 * fill * smoothstep(-0.012, -0.024, d) * sin(q.x * 230.0) * step(ps, 0.004);
      fl = smoothstep(0.0, -w, d);
    } else {
      // a landing: both boots side by side, deeper, in a scuffed patch
      mat2 turn = mat2(0.99, -0.12, 0.12, 0.99);
      d = min(trkBoot(vec2(q.x, q.y - 0.11) * turn), trkBoot(vec2(q.x, -q.y - 0.11) * turn));
      float pit = trkEll(q - vec2(-0.02, 0.0), vec2(0.21, 0.2));
      h = trkProfile(d, D * 1.25, w, 0.005 * fill) + trkProfile(pit, D * 0.38, 0.06, 0.004 * fill);
      fl = smoothstep(0.0, -w, min(d, pit + 0.02));
    }
  } else if (k < 3.5) {
    float d = trkHoof(q / s) * s, w = max(0.007 * s * soft, ps * 1.3);
    h = trkProfile(d, 0.028 * fill, w, 0.003 * fill); fl = smoothstep(0.0, -w, d);
  } else if (k < 4.5) {
    float d = trkPaw(q / s) * s, w = max(0.005 * s * soft, ps * 1.3);
    // the whole foot sinks a little, the pads and toes deeper
    float all = trkEll(q / s - vec2(0.002, 0.0), vec2(0.027, 0.024)) * s;
    h = trkProfile(d, 0.02 * fill, w, 0.0) + trkProfile(all, 0.007 * fill, w * 1.6, 0.003 * fill); fl = smoothstep(0.0, -w, d);
  } else {
    // a bird: s is its middle toe's length; thin toes, a shallow print
    float d = trkBird(q, s, max(0.1 * s, ps * 0.7)), w = max(0.0035 * soft, ps * 1.1);
    h = trkProfile(d, 0.0065 * fill, w, 0.0012 * fill); fl = smoothstep(0.0, -w, d);
  }
  return vec2(h, fl);
}
// all prints at the world point p: (dh/dx, dh/dz, h, floor); shade: how much of the floor lies in the shadow of the wall
// towards the sun (or the moon)
vec4 trkField(vec3 p, float ps, out float shade) {
  vec4 acc = vec4(0.0);
  shade = 0.0;
  if (uTrkTime.w < 0.5) return acc;
  vec2 g = p.xz - uTrkGrid.xy;
  if (g.x < 0.0 || g.y < 0.0 || g.x >= uTrkGrid.z || g.y >= uTrkGrid.w) return acc;
  ivec2 c = ivec2(g);
  vec4 s0 = texelFetch(uTrkCells, ivec2(c.x * 2, c.y), 0), s1 = texelFetch(uTrkCells, ivec2(c.x * 2 + 1, c.y), 0);
  if (s0.x + s0.y + s0.z + s0.w + s1.x + s1.y + s1.z + s1.w < 0.5) return acc;
  for (int k = 0; k < 8; k++) {
    float id = k < 4 ? s0[k] : s1[k - 4];
    if (id < 0.5) continue;
    int i = int(id + 0.5) - 1;
    vec4 a = texelFetch(uTrkData, ivec2(i * 2, 0), 0);                // x, z, y, birth
    vec2 d = p.xz - a.xy;
    if (dot(d, d) > 0.09 || abs(p.y - a.z) > 0.25) continue;
    vec4 b = texelFetch(uTrkData, ivec2(i * 2 + 1, 0), 0);            // angle, kind, size, strength × side
    float age = (uTrkTime.x - a.w) / uTrkTime.y;
    // an earlier walker's print: old and soft, it does not wear away
    if (b.y > 9.5) { b.y -= 10.0; age = 0.62; }
    // (how far its hollow and its rim reach: a hoof, a paw or a bird's foot is far smaller than a boot)
    float reach = b.y < 0.5 ? 0.24 : b.y < 2.5 ? 0.3 : b.y < 3.5 ? 0.07 * max(1.0, b.z) : b.y < 4.5 ? 0.08 * max(1.0, b.z) : 0.08;
    if (dot(d, d) > reach * reach) continue;
    if (age >= 1.0 || age < -0.01) continue;
    float fade = 1.0 - smoothstep(uTrkTime.z, 1.0, age), str = abs(b.w) * fade;
    // too small to be seen here (a bird's foot far off): it fades out instead of glittering
    str *= smoothstep(2.5, 7.0, (b.y > 4.5 ? b.z : b.y > 2.5 ? 0.055 * b.z : 0.29) / ps);
    if (str <= 0.002) continue;
    vec2 f = vec2(cos(b.x), sin(b.x)), l = vec2(-f.y, f.x);
    float side = b.w < 0.0 ? -1.0 : 1.0;
    vec2 q = vec2(dot(d, f), dot(d, l) * side);
    float e = max(0.0025, ps * 0.6);
    vec2 h0 = trkPrint(b.y, q, b.z, age, ps);
    float hx = trkPrint(b.y, q + vec2(e, 0.0), b.z, age, ps).x, hy = trkPrint(b.y, q + vec2(0.0, e), b.z, age, ps).x;
    // the slope in the print's frame, back to the world (y was mirrored for a left foot)
    vec2 gl = vec2(hx - h0.x, (hy - h0.x) * side) / e;
    acc.xy += (f * gl.x + l * gl.y) * str;
    acc.z += h0.x * str;
    acc.w = max(acc.w, h0.y * str);
    // in the hollow: does the wall towards the light stand between the floor and it? (one look along the light, as far
    // as a ray from the floor needs to climb out)
    vec2 Ls = vec2(dot(uSunDirW.xz, f), dot(uSunDirW.xz, l) * side);
    float lh = length(Ls);
    if (h0.x < -0.002 && lh > 1e-3 && uSunDirW.y > 0.0) {
      float tanE = uSunDirW.y / lh, t1 = min(0.15, -h0.x / max(tanE, 0.12) * 0.85);
      float h1 = trkPrint(b.y, q + Ls / lh * t1, b.z, age, ps).x;
      shade = max(shade, smoothstep(0.0, -h0.x * 0.3 + 0.001, h1 - h0.x - t1 * tanE) * str);
    }
  }
  return acc;
}
// the prints pressed into the snow of a surface (cover: how much snow lies there): the world normal nW of its walls, the
// floor compacted (a little greyer and smoother), the floor's share of the direct light (sun: the wall's shadow) and of
// the sky's (sky: a hollow sees less of it)
void trkApply(inout vec3 nW, inout vec3 col, inout float rough, inout float sun, inout float sky, float cover, vec3 p, float ps) {
  if (uTrkTime.w < 0.5 || cover <= 0.02) return;
  float sh;
  vec4 t = trkField(p, ps, sh);
  if (t.w <= 0.0 && dot(t.xy, t.xy) < 1e-8) return;
  vec2 gr = t.xy * cover;
  float m = length(gr);
  if (m > 1.3) gr *= 1.3 / m;                                          // the steepest wall a normal may show
  nW = normalize(nW - vec3(gr.x, 0.0, gr.y));
  // a wall turned away from the eye would be hidden behind the rim: never let it face away (it went black)
  vec3 toEye = normalize(cameraPosition - p);
  float nv = dot(nW, toEye);
  if (nv < 0.3) nW = normalize(nW + toEye * (0.3 - nv));
  col *= 1.0 - cover * 0.05 * t.w;
  rough = mix(rough, rough * 0.82, t.w * cover);
  sun *= 1.0 - 0.85 * sh * cover;
  sky *= 1.0 - 0.38 * clamp(-t.z / 0.034, 0.0, 1.0) * cover;
}
`;

// ---------------------------------------------------------------- the system ---------------------------------------------
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The prints of everything that walks on snow. stamp() makes one (or a bird's pair); update(dt) runs the wear clock;
 * playerStep / playerLand are called with the player's steps (winter.js wires them).
 */
export class Tracks {
  constructor(world) {
    this.world = world;
    this.prints = new Array(CAP).fill(null);
    this.next = { player: 0, animal: 0, bird: 0, old: 0 };   // the next place in each pool (POOLS)
    this.clock = 0;
    this.count = 0;
    this.steps = 0;                // the player's steps on snow so far (left and right alternate)
    this.sweep = 0;                // where the check for expired prints goes on
    this.cellBirth = new Float32Array(GNX * GNZ * SLOTS).fill(-1);   // birth of the print in each slot (eviction)
    this.stats = { stamped: 0, refused: 0, evicted: 0 };
    this.iceAt = null;             // (x, z) → how much snow lies on the ice there (0 … 1), or null off the lake (ice.js)
  }

  /** How much snow lies at (x, z) for a print (0 … 1): none indoors or without snow, little under the eaves of the deck
   *  and on the trodden ring round the fire bowl, on the lake the snow on its ice. */
  coverAt(x, z) {
    if (!outside(x, z)) return 0;
    const s = NATURE.uSnow.value;
    if (s < 0.3) return 0;
    const D = HOUSE.deck;
    if (x >= D.x0 && x <= D.x1 && z >= D.z0 - 0.45 && z <= D.z1) return s * smooth(6.2, 7.3, z);
    if (!onJetty(x, z) && terrainHeight(x, z) < WATER_Y - 0.02) { const ice = this.iceAt?.(x, z); return ice == null ? 0 : s * ice; }
    const f = Math.hypot(x - FIREBOWL.x, z - FIREBOWL.z);
    if (f < 2.6) return s * smooth(1.0, 2.6, f);
    return s;
  }

  /**
   * A print of `kind` ('boot', 'run', 'land', 'hoof', 'paw', 'bird') at (x, z), its toes towards `angle` (radians, as
   * Math.atan2(dz, dx)). opts: side (1 right, -1 left), size (hoof and paw: the animal's scale; bird: the middle toe's
   * length in m), strength (0 … 1), y (the height of what it is made on; the player's floor by default). Returns the
   * print's index, or -1 where no snow lies.
   */
  stamp(kind, x, z, angle, { side = 1, size = 1, strength = 1, y = null, old = false } = {}) {
    const k = PRINT_KINDS[kind];
    if (k == null) return -1;
    const cover = this.coverAt(x, z);
    if (cover < 0.3) { this.stats.refused++; return -1; }
    const pool = old ? 'old' : POOL_OF[kind], [start, n] = POOLS[pool];
    const i = start + this.next[pool]; this.next[pool] = (this.next[pool] + 1) % n;
    if (this.prints[i]) this.#unlist(i);
    const yy = y ?? this.world.player?.groundAt?.(x, z) ?? terrainHeight(x, z);
    const str = Math.min(1, strength * Math.min(1, cover * 1.15));
    // (an earlier walker's print counts as the oldest of all: a fresh one takes its place in a full cell)
    const birth = old ? -1e9 : this.clock;
    const p = { i, kind, x, z, y: yy, angle, side: side < 0 ? -1 : 1, size, strength: str, birth, old, cells: [] };
    this.prints[i] = p; this.count++;
    dataArr.set([x, z, yy, old ? 0 : this.clock, angle, k + (old ? OLD : 0), size, str * p.side], i * 8);
    changed(TRACKS.uTrkData.value, i * 8, 8);
    // listed in every cell its reach touches
    const r = REACH[kind] * (kind === 'hoof' || kind === 'paw' ? Math.max(1, size) : 1);
    const i0 = Math.floor(x - r - GX0), i1 = Math.floor(x + r - GX0), j0 = Math.floor(z - r - GZ0), j1 = Math.floor(z + r - GZ0);
    for (let ci = i0; ci <= i1; ci++) for (let cj = j0; cj <= j1; cj++) {
      if (ci < 0 || cj < 0 || ci >= GNX || cj >= GNZ) continue;
      this.#list(i, ci, cj);
    }
    TRACKS.uTrkTime.value.w = 1;
    this.stats.stamped++;
    return i;
  }

  /** Put print i into cell (ci, cj): a free slot, else the slot of the oldest print there. */
  #list(i, ci, cj) {
    const cell = cj * GNX + ci, base = (cj * GNX * 2 + ci * 2) * 4;
    let slot = -1, oldest = Infinity, oldSlot = 0;
    for (let s = 0; s < SLOTS; s++) {
      const v = cellArr[base + s];
      if (v === 0) { slot = s; break; }
      const b = this.cellBirth[cell * SLOTS + s];
      if (b < oldest) { oldest = b; oldSlot = s; }
    }
    if (slot < 0) {
      // full: the oldest print there gives way in this cell
      slot = oldSlot; this.stats.evicted++;
      const old = this.prints[cellArr[base + slot] - 1];
      if (old) old.cells = old.cells.filter((c) => c !== cell);
    }
    cellArr[base + slot] = i + 1;
    this.cellBirth[cell * SLOTS + slot] = this.prints[i].birth;
    this.prints[i].cells.push(cell);
    changed(TRACKS.uTrkCells.value, base, 8);
  }
  /** Take print i out of its cells and the list. */
  #unlist(i) {
    const p = this.prints[i]; if (!p) return;
    for (const cell of p.cells) {
      const cj = Math.floor(cell / GNX), ci = cell - cj * GNX, base = (cj * GNX * 2 + ci * 2) * 4;
      for (let s = 0; s < SLOTS; s++) if (cellArr[base + s] === i + 1) { cellArr[base + s] = 0; this.cellBirth[cell * SLOTS + s] = -1; }
      changed(TRACKS.uTrkCells.value, base, 8);
    }
    this.prints[i] = null; this.count--;
  }
  /** Every print gone at once (the snow has gone, the checks). */
  clear() {
    cellArr.fill(0); this.cellBirth.fill(-1);
    this.prints.fill(null); this.count = 0; this.oldLaid = false;
    const t = TRACKS.uTrkCells.value; t.clearUpdateRanges(); t.userData.whole = true; t.needsUpdate = true;
    TRACKS.uTrkTime.value.w = 0;
  }

  /** The wear clock, prints past their life out of the cells, everything gone when the snow is. */
  update(dt) {
    const ws = this.world.weatherState?.() || {};
    // falling snow covers them, rain softens them
    const rate = ws.snow > 0.3 ? 4 : ws.rain > 0.3 ? 2.5 : 1;
    this.clock += dt * rate;
    TRACKS.uTrkTime.value.x = this.clock;
    // the old prints of earlier walkers, once the snow lies (and again after it came back)
    if (!this.oldLaid && NATURE.uSnow.value >= 0.6) this.layOld();
    if (!this.count) return;
    if (NATURE.uSnow.value < 0.25) { this.clear(); return; }
    // a slice of the list a frame: the expired ones leave their cells
    for (let n = 0; n < 64; n++) {
      const p = this.prints[this.sweep]; this.sweep = (this.sweep + 1) % CAP;
      if (p && !p.old && this.clock - p.birth >= TRACK_LIFE) this.#unlist(p.i);
    }
    if (!this.count) TRACKS.uTrkTime.value.w = 0;
  }

  /**
   * The old prints of people who walked here before: two walkers down the middle of the path to the jetty and back,
   * one from the glass doors over the deck, one out along the jetty to its bench and back, one up the trail to the
   * knoll. Soft and shallow, a calm pace, a little off the middle; the same every time (seeded).
   */
  layOld() {
    this.oldLaid = true;
    const rnd = seeded(733);
    const walk = (pts, offset, step = 0.68) => {
      // pts: [x, z] points along the way about 0.1 m apart; the prints a step apart, left and right in turn
      let acc = rnd() * step, side = rnd() < 0.5 ? 1 : -1;
      for (let i = 1; i < pts.length; i++) {
        const [x0, z0] = pts[i - 1], [x1, z1] = pts[i], d = Math.hypot(x1 - x0, z1 - z0);
        if (d < 1e-6) continue;
        acc += d;
        while (acc >= step) {
          acc -= step * (0.92 + rnd() * 0.16);
          const a = Math.atan2(z1 - z0, x1 - x0), lx = -Math.sin(a), lz = Math.cos(a), lat = offset + side * -0.085 + (rnd() - 0.5) * 0.04;
          const x = x1 - lx * lat, z = z1 - lz * lat;
          this.stamp('boot', x, z, a - side * 0.11 + (rnd() - 0.5) * 0.12, { side, old: true, strength: 0.7 + rnd() * 0.3, y: groundHeight(x, z) });
          side = -side;
        }
      }
    };
    const curve = (c, n) => Array.from({ length: n + 1 }, (_, i) => { const p = c.getPointAt(i / n); return [p.x, p.z]; });
    const line = (a, b) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1); return Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]); };
    const path = curve(PATH, Math.ceil(PATH.getLength() / 0.1));
    walk(line([0.3, HOUSE.front + 0.2], [0.1, HOUSE.deck.z1]), 0.05);   // from the doors over the deck
    walk(path, -0.1);
    walk(path.slice().reverse(), 0.18);
    const J = JETTY, bench = J.len - J.platLen / 2 - 1.0;
    walk(line(J.at(0, 0), J.at(bench, 0)), -0.08);
    walk(line(J.at(bench, 0.4), J.at(0, 0.3)), 0.1);
    walk(curve(TRAILS[0], Math.ceil(TRAILS[0].getLength() / 0.1)), 0.02);
  }

  // ---------------------------------------------------------------- the player -------------------------------------------
  /** A step of the player (player.js onStep): the foot that comes down now, left and right in turn, beside the way he
   *  goes, its toes turned out a little. Running: the long print with the toes dug in. */
  playerStep(run) {
    const P = this.world.player; if (!P || P.seated) return -1;
    const v = P.velocity, sp = Math.hypot(v.x, v.z);
    // the feet point where he goes when that is roughly where he looks (backwards or sideways: where he looks)
    const look = Math.atan2(-Math.cos(P.yaw), -Math.sin(P.yaw));
    let a = sp > 0.3 ? Math.atan2(v.z, v.x) : look;
    if (sp > 0.3 && Math.abs(wrapAngle(a - look)) > 1.1) a = look;
    const side = this.steps++ % 2 ? -1 : 1, lat = run ? 0.055 : 0.09;
    // (left of the way: +90° from it)
    const x = P.position.x + Math.cos(a + Math.PI / 2) * lat * -side, z = P.position.z + Math.sin(a + Math.PI / 2) * lat * -side;
    return this.stamp(run ? 'run' : 'boot', x, z, a - side * 0.11, { side, y: P.groundAt(x, z), strength: this.#onIce(x, z) ? 0.5 : 1 });
  }
  /** The landing after a jump: both feet in a scuffed patch. */
  playerLand() {
    const P = this.world.player; if (!P) return -1;
    const a = Math.atan2(-Math.cos(P.yaw), -Math.sin(P.yaw));
    return this.stamp('land', P.position.x, P.position.z, a, { y: P.ground, strength: this.#onIce(P.position.x, P.position.z) ? 0.5 : 1 });
  }
  #onIce(x, z) { return !onJetty(x, z) && terrainHeight(x, z) < WATER_Y - 0.02; }

  // ---------------------------------------------------------------- the animals ------------------------------------------
  /** A foot of a deer, a fox or the wolf comes down (wildlife.js): `deer` hoof or paw, (x, z) where the foot is, `yaw` as
   *  wildlife.js turns the animal (forward = (sin yaw, cos yaw)), `leg` 0 … 3 (front left, front right, hind left, hind
   *  right), `size` the animal's scale. A walking deer or fox puts its hind foot into the print of its front foot: only
   *  the front feet print. */
  animal(deer, x, z, yaw, leg, size = 1) {
    if (leg > 1) return -1;
    return this.stamp(deer ? 'hoof' : 'paw', x, z, Math.atan2(Math.cos(yaw), Math.sin(yaw)), { side: leg % 2 ? 1 : -1, size, y: terrainHeight(x, z) });
  }
  /** A bird on the ground (birds.js): a hop lands both feet side by side, a step of a crow one foot, left and right in
   *  turn. `span` the bird's wingspan (its toes grow with it), `walk` true for a walking bird, `y` the height of what it
   *  stands on. */
  bird(x, z, yaw, span, walk = false, y = null) {
    const t = 0.017 + 0.04 * Math.min(1, Math.max(0, (span - 0.2) / 0.8));
    const a = Math.atan2(Math.cos(yaw), Math.sin(yaw));          // birds.js: forward = (sin yaw, cos yaw)
    const lx = -Math.sin(a), lz = Math.cos(a), off = t * 0.45, o = { size: t, y };
    if (walk) { const s = (this.birdStep = (this.birdStep || 0) + 1) % 2 ? 1 : -1; return this.stamp('bird', x - lx * off * s, z - lz * off * s, a + s * 0.12, o); }
    const r = this.stamp('bird', x - lx * off, z - lz * off, a + 0.08, o);
    this.stamp('bird', x + lx * off, z + lz * off, a - 0.08, o);
    return r;
  }

  /** For the checks: the prints of one kind (or all) as they lie. */
  list(kind = null) {
    return this.prints.filter((p) => p && !p.old && (!kind || p.kind === kind)).sort((a, b) => a.birth - b.birth)
      .map((p) => ({ i: p.i, kind: p.kind, x: +p.x.toFixed(3), z: +p.z.toFixed(3), y: +p.y.toFixed(4), angle: +p.angle.toFixed(3), side: p.side, size: +p.size.toFixed(3), strength: +p.strength.toFixed(2), age: +(this.clock - p.birth).toFixed(1), cells: p.cells.length }));
  }
  info() {
    const by = {};
    for (const p of this.prints) if (p) { const k = p.old ? 'old' : p.kind; by[k] = (by[k] || 0) + 1; }
    return { count: this.count, by, clock: +this.clock.toFixed(1), life: TRACK_LIFE, fadeFrom: FADE_FROM, pools: Object.fromEntries(Object.entries(POOLS).map(([k, [, n]]) => [k, n])), stats: { ...this.stats } };
  }
}
function wrapAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
