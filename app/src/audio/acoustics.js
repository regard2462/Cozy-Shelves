// How the house carries sound, for the soundscape (soundscape.js): which room you are in, how much of the weather
// outside reaches you through the glass, the windows and the open terrace door, how a bird in the garden or the fire in
// the hall arrives where you stand (loudness, how muffled, from which side), and what the ground under your feet is made
// of. Plain arithmetic on the layout (world.layout: its floors are the rooms, its openings the windows, the glass front
// and the arches between the rooms) and on the garden (outdoor.js); no audio nodes, so the checks can ask it directly.
//
// The model: outside, sound falls off with distance (1/d) and the house shadows what lies behind it. Inside, the outdoor
// sound enters through each opening in proportion to its area and transmission (glass lets through a little and only the
// low part of the sound, an open door nearly everything) and reaches you directly (more the closer you stand to the
// opening) and as the room's reverberant field (its area over the room's absorption); an arch passes part of a room's
// sound on to the next room. Point sources inside follow the same paths the other way round.
import { pathDist, trailDist, onJetty, beachWeight, HOUSE, outside as isOutside, terrainHeight, WATER_Y } from '../world/outdoor.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** Energy transmission of a closed window or the glass front (tuned for listening, real glazing is stricter). */
export const GLASS_T = 0.05;
/** The low pass of sound that came through glass, through an open door and from far away (Hz). */
const LP_GLASS = 1100, LP_OPEN = 12000;
/** Absorption per square metre of a room's surfaces (Sabine), for its reverberant field. */
const ALPHA = 0.2, ROOM_H = 5;
/** Amplitude over distance: 1 up to `ref`, then ref / d. */
export const falloff = (d, ref = 1) => (d <= ref ? 1 : ref / d);

/**
 * The acoustics of a built layout. `layout`: world.layout (floors, openings, placements, glassRoofs?).
 */
export class Acoustics {
  constructor(layout) {
    const floors = layout?.floors || [];
    const names = ['hall', 'passage', 'room'];
    this.zones = floors.map((f, i) => {
      const area = f.w * f.d, surface = 2 * area + 2 * (f.w + f.d) * ROOM_H;
      return { i, name: names[i] || 'zone' + i, x0: f.x - f.w / 2, x1: f.x + f.w / 2, z0: f.z - f.d / 2, z1: f.z + f.d / 2, R: ALPHA * surface };
    });
    // openings to the garden: the glass front, the windows (vertical rectangles with an outward normal)
    this.glass = [];
    for (const o of layout?.openings || []) {
      if (o.kind !== 'window' && o.kind !== 'glassfront') continue;
      const n = o.dir || [0, 0, 1], alongX = Math.abs(n[2]) > Math.abs(n[0]);
      const zone = this.zoneAt(o.x - n[0] * 0.6, o.z - n[2] * 0.6);
      if (zone < 0) continue;
      this.glass.push({ x: o.x, z: o.z, y0: o.y0 || 0, y1: (o.y0 || 0) + o.h, half: o.w / 2, nx: n[0], nz: n[2], alongX, area: o.w * o.h, zone, kind: o.kind });
    }
    // arches between two rooms
    this.portals = [];
    for (const o of layout?.openings || []) {
      if (o.kind !== 'arch') continue;
      const a = this.zoneAt(o.x, o.z + 0.4), b = this.zoneAt(o.x, o.z - 0.4);
      if (a >= 0 && b >= 0 && a !== b) this.portals.push({ x: o.x, z: o.z, area: o.w * (o.h || 3), a, b });
    }
    // rugs (footsteps): rotated rectangles
    this.rugs = (layout?.placements || []).filter((p) => p.kind === 'rug').map((p) => ({ x: p.x, z: p.z, c: Math.cos(p.rot || 0), s: Math.sin(p.rot || 0), hw: (p.opts?.w || 3) / 2, hd: (p.opts?.d || 2) / 2 }));
    // a glass roof over part of a room (a conservatory, if a layout has one): rain patters on it
    this.glassRoofs = layout?.glassRoofs || [];
  }

  /** The room (zone index) at (x, z), -1 outside. */
  zoneAt(x, z) {
    if (isOutside(x, z)) return -1;
    for (const zn of this.zones) if (x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1) return zn.i;
    return -1;
  }

  /** The nearest point of an opening to p: [x, y, z, distance]. */
  #near(g, px, py, pz) {
    const t = clamp(g.alongX ? px - g.x : pz - g.z, -g.half, g.half);
    const x = g.alongX ? g.x + t : g.x, z = g.alongX ? g.z : g.z + t, y = clamp(py, g.y0, g.y1);
    return [x, y, z, Math.hypot(px - x, py - y, pz - z)];
  }
  /** The terrace door as an opening while it stands open (world.door: x, z, w, h, t 0 … 1). */
  #doorOpening(door) {
    if (!door || !(door.t > 0.02)) return null;
    const k = door.t * door.t * (3 - 2 * door.t);
    return { x: door.x, z: door.z + 0.17, y0: 0, y1: door.h, half: door.w / 2, nx: 0, nz: 1, alongX: true, area: door.w * door.h * k, zone: this.zoneAt(door.x, door.z - 0.8), open: true };
  }
  /** The openings of the house now (the glass, the windows and the door while it is open). */
  #openings(door) { const d = this.#doorOpening(door); return d && d.zone >= 0 ? [...this.glass, d] : this.glass; }
  /** How squarely a point looks at an opening from the opening's nearest point (0.15 … 1). */
  static #facing(o, near, px, pz) {
    const dx = px - near[0], dz = pz - near[2], d = Math.hypot(dx, dz);
    return d < 0.3 ? 1 : Math.max(0.15, Math.abs(dx * o.nx + dz * o.nz) / d);
  }
  /** The reverberant field of every room that the outdoor sound (amplitude 1 at the openings) leaves inside, with
   *  what the arches pass on (up to two rooms further): [{ e (energy), log (energy-weighted log of the low pass) }]. */
  #reverb(openings) {
    const base = this.zones.map(() => ({ e: 0, log: 0 }));
    for (const o of openings) {
      const e = (o.open ? 1 : GLASS_T) * o.area / this.zones[o.zone].R;
      base[o.zone].e += e; base[o.zone].log += e * Math.log(o.open ? LP_OPEN : LP_GLASS);
    }
    const total = base.map((b) => ({ ...b }));
    let carry = base;
    for (let hop = 0; hop < 2; hop++) {
      const next = this.zones.map(() => ({ e: 0, log: 0 }));
      for (const p of this.portals) for (const [a, b] of [[p.a, p.b], [p.b, p.a]]) {
        if (!(carry[a].e > 0)) continue;
        const e = carry[a].e * Math.min(0.5, p.area / this.zones[b].R) * 0.5;
        next[b].e += e; next[b].log += e * (carry[a].log / carry[a].e + Math.log(0.7));
      }
      for (let i = 0; i < total.length; i++) { total[i].e += next[i].e; total[i].log += next[i].log; }
      carry = next;
    }
    return total;
  }

  /**
   * Where the listener stands and how much of the outdoor sound (rain, wind, the garden as a whole) reaches them:
   * { zone, name, inside, outdoor (amplitude, 1 outside), lp (Hz), glass (0 … 1: how close to a pane), glassPan, glassX,
   *   glassZ, door (0 … 1: how much comes through the open door), roof, glassRoof }
   */
  listen(L, door, yaw = 0) {
    const zone = this.zoneAt(L.x, L.z);
    if (zone < 0) return { zone, name: 'outside', inside: false, outdoor: 1, lp: LP_OPEN, glass: 0, glassPan: 0, door: 0, roof: 0, glassRoof: 0 };
    const zn = this.zones[zone];
    const openings = this.#openings(door);
    // the reverberant field of the room (with what the arches bring), then the direct part where you stand
    const rev = this.#reverb(openings)[zone];
    let direct = 0, dirLog = 0, glass = 0, glassAt = null, viaDoor = 0;
    for (const o of openings) {
      if (o.zone !== zone) continue;
      const near = this.#near(o, L.x, L.y ?? 1.6, L.z), r = near[3];
      const t = o.open ? 1 : GLASS_T, e = t * Math.min(0.5, o.area * Acoustics.#facing(o, near, L.x, L.z) / (TAU * Math.max(0.25, r * r)));
      direct += e; dirLog += e * Math.log(o.open ? LP_OPEN : LP_GLASS);
      if (o.open) viaDoor += e;
      else { const k = Math.pow(clamp(1 - r / 3.5, 0, 1), 1.5); if (k > glass) { glass = k; glassAt = [near[0], near[2]]; } }
    }
    const e = direct + rev.e, logLp = e > 0 ? (dirLog + rev.log + rev.e * Math.log(0.85)) / e : Math.log(LP_GLASS);
    const glassRoof = this.glassRoofs.some((r) => L.x >= r.x0 && L.x <= r.x1 && L.z >= r.z0 && L.z <= r.z1) ? 1 : 0;
    return {
      zone, name: zn.name, inside: true, outdoor: Math.min(1, Math.sqrt(e)), lp: clamp(Math.exp(logLp), 300, LP_OPEN),
      glass, glassPan: glassAt ? panOf(L, yaw, glassAt[0], glassAt[1]) : 0, glassX: glassAt?.[0], glassZ: glassAt?.[1],
      door: Math.min(1, Math.sqrt(viaDoor)), roof: 1, glassRoof,
    };
  }

  /**
   * A point source outside at S ({x, y, z}) heard at L: { gain, lp, pan, behind } with the distance (ref: the distance of
   * full loudness), the house in between, and inside the way through the openings.
   */
  fromOutside(S, L, door, yaw = 0, ref = 2) {
    const zone = this.zoneAt(L.x, L.z);
    const d = Math.hypot(S.x - L.x, (S.y ?? 1) - (L.y ?? 1.6), S.z - L.z);
    if (zone < 0) {
      let g = falloff(d, ref), lp = airLp(d);
      if (this.#houseBetween(S, L)) { g *= 0.3; lp = Math.min(lp, 1800); }
      return { gain: g, lp, pan: panOf(L, yaw, S.x, S.z), behind: behindOf(L, yaw, S.x, S.z) };
    }
    const openings = this.#openings(door);
    let e = 0, eLog = 0, best = 0, bx = S.x, bz = S.z;
    for (const o of openings) {
      const [ax, , az, ds] = this.#near(o, S.x, S.y ?? 1, S.z);
      // the source has to lie in front of the opening (a bird behind the house reaches it only round the corner)
      const facing = Math.max(0.1, ((S.x - ax) * o.nx + (S.z - az) * o.nz) / Math.max(0.5, Math.hypot(S.x - ax, S.z - az)));
      const g = falloff(ds, ref), t = o.open ? 1 : GLASS_T;
      const near = this.#near(o, L.x, L.y ?? 1.6, L.z), r = near[3];
      const into = o.zone === zone ? Math.min(0.5, o.area * Acoustics.#facing(o, near, L.x, L.z) / (TAU * Math.max(0.25, r * r))) + o.area / this.zones[o.zone].R : this.#coupling(o.zone, zone) * o.area / this.zones[o.zone].R;
      const c = g * g * facing * t * into;
      e += c; eLog += c * Math.log((o.open ? LP_OPEN : LP_GLASS) * (o.zone === zone ? 1 : 0.7));
      if (c > best) { best = c; bx = ax; bz = az; }
    }
    return { gain: Math.min(1, Math.sqrt(e)), lp: e > 0 ? clamp(Math.exp(eLog / e), 300, LP_OPEN) : LP_GLASS, pan: panOf(L, yaw, bx, bz) * 0.8, behind: false };
  }

  /** A point source inside room `srcZone` (the fire, the clock) heard at L: { gain, lp, pan }. */
  fromInside(S, srcZone, L, door, yaw = 0, ref = 1.5) {
    const zone = this.zoneAt(L.x, L.z);
    if (zone === srcZone) {
      const d = Math.hypot(S.x - L.x, (S.y ?? 1) - (L.y ?? 1.6), S.z - L.z);
      return { gain: falloff(d, ref), lp: LP_OPEN, pan: panOf(L, yaw, S.x, S.z), behind: behindOf(L, yaw, S.x, S.z) };
    }
    if (zone >= 0) {
      // through the arches: the way round, a share of the sound per arch
      const path = this.#route(srcZone, zone);
      if (!path) return { gain: 0, lp: LP_GLASS, pan: 0 };
      let len = 0, k = 1, px = S.x, pz = S.z;
      for (const p of path) { len += Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z; k *= Math.sqrt(Math.min(0.5, p.area / this.zones[p.to].R)); }
      len += Math.hypot(L.x - px, L.z - pz);
      const first = path[path.length - 1];
      return { gain: falloff(len, ref) * k, lp: 2500, pan: panOf(L, yaw, first.x, first.z) * 0.7, behind: false };
    }
    // outside: through the glass and the open door of that room
    let e = 0, best = 0, bx = S.x, bz = S.z, open = 0;
    for (const o of this.#openings(door)) {
      if (o.zone !== srcZone) continue;
      const ds = this.#near(o, S.x, S.y ?? 1, S.z)[3];
      const near = this.#near(o, L.x, L.y ?? 1.6, L.z), r = near[3];
      const out = Math.max(0.1, ((L.x - near[0]) * o.nx + (L.z - near[2]) * o.nz) / Math.max(0.3, Math.hypot(L.x - near[0], L.z - near[2])));
      const c = falloff(ds, ref) ** 2 * (o.open ? 1 : GLASS_T) * Math.min(0.5, o.area * out / (TAU * Math.max(0.25, r * r)));
      e += c; if (o.open) open += c;
      if (c > best) { best = c; bx = near[0]; bz = near[2]; }
    }
    return { gain: Math.min(1, Math.sqrt(e)), lp: e > 0 && open / e > 0.5 ? 6000 : LP_GLASS, pan: panOf(L, yaw, bx, bz), behind: false };
  }

  /** How much of one room's reverberant sound reaches another through the arches (0 … 1). */
  #coupling(a, b) {
    const path = this.#route(a, b); if (!path) return 0;
    let k = 1; for (const p of path) k *= Math.min(0.5, p.area / this.zones[p.to].R) * 0.5;
    return k;
  }
  /** The arches from room a to room b: [{ x, z, area, to }] (breadth first; the house has few rooms). */
  #route(a, b) {
    const seen = new Set([a]); let front = [[a, []]];
    while (front.length) {
      const next = [];
      for (const [z, path] of front) {
        if (z === b) return path;
        for (const p of this.portals) {
          const to = p.a === z ? p.b : p.b === z ? p.a : -1;
          if (to < 0 || seen.has(to)) continue;
          seen.add(to); next.push([to, [...path, { x: p.x, z: p.z, area: p.area, to }]]);
        }
      }
      front = next;
    }
    return null;
  }
  /** True when the house stands between two points outside (the hall, the passage and the book room as boxes). */
  #houseBetween(S, L) {
    for (const zn of this.zones) if (segmentHitsBox(S.x, S.z, L.x, L.z, zn.x0 - 0.35, zn.x1 + 0.35, zn.z0 - 0.35, Math.min(zn.z1 + 0.35, HOUSE.front))) return true;
    return false;
  }

  /**
   * The ground under the feet at (x, z) for the footsteps: { surface, outdoor }. `ground`: the height the player
   * stands on, `floorY`: the height of the floor there (player.groundAt),
   * `snow`: snow lies outside, `floor`: what the floors inside are made of (a floor style may make them stone or
   * carpet; wood when not given).
   */
  surfaceAt(x, z, { ground = 0, floorY = 0, snow = false, floor = 'wood' } = {}) {
    if (!isOutside(x, z)) {
      // on a piece of furniture (above the floor there): the seat cushions of chairs and sofas are low, tables higher
      const above = ground - floorY;
      if (above > 0.05) return { surface: above < 0.6 ? 'cushion' : 'wood', outdoor: false };
      // a floor above the ground floor: boards, no rug of the floor below
      if (floorY > 0.3) return { surface: floor === 'carpet' ? 'carpet' : 'wood', outdoor: false };
      for (const r of this.rugs) {
        const dx = x - r.x, dz = z - r.z, lx = dx * r.c - dz * r.s, lz = dx * r.s + dz * r.c;
        if (Math.abs(lx) <= r.hw && Math.abs(lz) <= r.hd) return { surface: 'carpet', outdoor: false };
      }
      return { surface: floor || 'wood', outdoor: false };
    }
    const D = HOUSE.deck;
    let surface;
    if (x >= D.x0 && x <= D.x1 && z >= D.z0 - 0.45 && z <= D.z1) surface = 'deck';
    else if (onJetty(x, z)) surface = 'jetty';
    else if (pathDist(x, z) < 0.8) surface = 'gravel';
    else if (beachWeight(x, z) > 0.45) surface = 'pebbles';
    else if (trailDist(x, z) < 0.45) surface = 'earth';
    else surface = 'grass';
    if (snow) surface = 'snow';
    // out on the frozen lake (it carries you only in winter: world/winter.js): the ice under its thin snow
    if (!onJetty(x, z) && terrainHeight(x, z) < WATER_Y - 0.01) surface = 'ice';
    return { surface, outdoor: true };
  }
}

/** Stereo position of a point seen from the listener (yaw: the view turned about the vertical, as player.js). */
export function panOf(L, yaw, x, z) {
  const dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
  if (d < 0.2) return 0;
  return clamp((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d, -1, 1);
}
/** True when the point lies behind the listener (a softer, darker sound). */
export function behindOf(L, yaw, x, z) {
  const dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
  return d > 0.5 && (-dx * Math.sin(yaw) - dz * Math.cos(yaw)) / d < -0.35;
}
/** The air takes the highs of far sounds. */
export const airLp = (d) => (d < 25 ? 16000 : clamp(16000 * 25 / d, 3500, 16000));

function segmentHitsBox(x0, z0, x1, z1, bx0, bx1, bz0, bz1) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  for (const [p, q] of [[-dx, x0 - bx0], [dx, bx1 - x0], [-dz, z0 - bz0], [dz, bz1 - z0]]) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 < t1;
}
