// Where people look out of the house, and what they see from there: the hall's glass front and the terrace in front of
// it look north over the garden, the wide window in the book room's back wall looks south, the narrow ones in its side
// walls east and west (layout.js GLASS, BACK_WIN, SIDE_WIN). The animals (wildlife.js) graze where somebody at a window
// sees them and walk in from where nobody does; the checks measure with the same numbers. Arithmetic only.
import { HALL, ROOM, GLASS, BACK_WIN, SIDE_WIN, TERRACE } from './layout.js';

const EYE = 1.62;   // a standing person's eye (player.js)
/**
 * The sides of the house you look out of: `pane` is the opening in the wall ({ axis: 'x' for a wall along x at z = `at`
 * (its inner face), 'z' for one along z at x = `at`; the opening from a0 to a1 along the wall and from y0 to y1; `out`:
 * the wall's thickness towards the outside, signed }), `viewers` where people stand to look out ([x, z] at eye height),
 * `n` the way they look, `near`/`far` the distances (m from the opening) at which an animal counts as seen from there.
 * The terrace has no pane: you look out from the deck in front of the glass.
 */
export const WINDOW_SIDES = (() => {
  const t = HALL.wall, back = BACK_WIN, side = SIDE_WIN;
  const sideWin = (x, out, n) => ({ axis: 'z', at: x, out, a0: side.z - side.w / 2, a1: side.z + side.w / 2, y0: side.y0, y1: side.y0 + side.h, n });
  return [
    { id: 'north', label: { de: 'Glasfront', en: 'Glass front' }, n: [0, 1], near: 8, far: 42,
      pane: { axis: 'x', at: HALL.z1, out: t, a0: GLASS.x0, a1: GLASS.x1, y0: GLASS.y0, y1: GLASS.y1 },
      viewers: [-6, -3.2, 0, 3.2, 6].map((x) => [x, HALL.z1 - 0.9]) },
    { id: 'terrace', label: { de: 'Terrasse', en: 'Terrace' }, n: [0, 1], near: 6, far: 42, pane: null,
      viewers: [[-5, TERRACE.deck.z1 - 1.0], [0.6, TERRACE.deck.z1 - 1.0], [5, TERRACE.deck.z1 - 1.0]] },
    { id: 'south', label: { de: 'Fenster im Bücherzimmer (Süden)', en: 'Book room window (south)' }, n: [0, -1], near: 8, far: 38,
      pane: { axis: 'x', at: ROOM.z0, out: -t, a0: -back.w / 2, a1: back.w / 2, y0: back.y0, y1: back.y0 + back.h },
      viewers: [-1.3, 0, 1.3].map((x) => [x, ROOM.z0 + 0.85]) },
    { id: 'east', label: { de: 'Fenster im Bücherzimmer (Osten)', en: 'Book room window (east)' }, n: [1, 0], near: 8, far: 38,
      pane: sideWin(ROOM.x1, t, [1, 0]), viewers: [-0.45, 0, 0.45].map((d) => [ROOM.x1 - 0.85, side.z + d]) },
    { id: 'west', label: { de: 'Fenster im Bücherzimmer (Westen)', en: 'Book room window (west)' }, n: [-1, 0], near: 8, far: 38,
      pane: sideWin(ROOM.x0, -t, [-1, 0]), viewers: [-0.45, 0, 0.45].map((d) => [ROOM.x0 + 0.85, side.z + d]) },
  ];
})();
export const SIDE_BITS = Object.fromEntries(WINDOW_SIDES.map((s, i) => [s.id, 1 << i]));

/** Does the line from the eye (vx, eyeY, vz) to (px, py, pz) go through the opening (both faces of the wall)? */
function throughPane(P, vx, vz, eyeY, px, py, pz) {
  const m = 0.04;
  for (const face of [P.at, P.at + P.out]) {
    const va = P.axis === 'x' ? vz : vx, pa = P.axis === 'x' ? pz : px;
    if ((face - va) * (pa - va) <= 0) return false;              // the wall is not between them
    const s = (face - va) / (pa - va);
    if (s <= 0 || s >= 1) return false;
    const along = P.axis === 'x' ? vx + (px - vx) * s : vz + (pz - vz) * s, y = eyeY + (py - eyeY) * s;
    if (along < P.a0 + m || along > P.a1 - m || y < P.y0 + 0.02 || y > P.y1 - 0.02) return false;
  }
  return true;
}

/**
 * What the windows see. `hides`: what hides an animal ([{ x, z, r }]: the trunks, the shrubs, the low skirts of the
 * spruces, the feeding station); `height(x, z)`: the ground.
 *   seen(x, z, y?)       bit mask of the sides (SIDE_BITS) from which a point y m above the ground is in sight
 *   count(side, x, z, y?, far?)  from how many of that side's viewers (within `far` m)
 *   clear(ax, az, bx, bz) nothing in `hides` stands on that line (2D)
 */
export function houseViews(hides, height) {
  // the hiding things in 8 m cells, for the lines of sight
  const CELL = 8, cells = new Map(), key = (i, j) => i * 4096 + j;
  for (const h of hides) {
    for (let i = Math.floor((h.x - h.r) / CELL); i <= Math.floor((h.x + h.r) / CELL); i++) for (let j = Math.floor((h.z - h.r) / CELL); j <= Math.floor((h.z + h.r) / CELL); j++) {
      const k = key(i, j); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(h);
    }
  }
  let stamp = 0; const seenAt = new Map();
  /** Nothing that hides stands on the line from a to b (the cells along it, each circle once). */
  const clear = (ax, az, bx, bz, pad = 0.3) => {
    stamp++;
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-6, n = Math.ceil(Math.sqrt(L2) / (CELL * 0.5)) + 1;
    let pi = null, pj = null;
    for (let s = 0; s <= n; s++) {
      const x = ax + dx * s / n, z = az + dz * s / n, ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
      if (ci === pi && cj === pj) continue; pi = ci; pj = cj;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const list = cells.get(key(ci + a, cj + b)); if (!list) continue;
        for (const h of list) {
          if (seenAt.get(h) === stamp) continue; seenAt.set(h, stamp);
          const t = ((h.x - ax) * dx + (h.z - az) * dz) / L2;
          if (t <= 0 || t >= 1) continue;
          const qx = ax + dx * t - h.x, qz = az + dz * t - h.z;
          if (qx * qx + qz * qz < (h.r + pad) ** 2) return false;
        }
      }
    }
    return true;
  };
  /** From how many viewers of side S the point (x, z) at y m above the ground is in sight (within `far` m). */
  const count = (S, x, z, y = 0.55, far = S.far) => {
    const P = S.pane;
    // in front of the opening (or the deck), not too near and not too far
    const cx = P ? (P.axis === 'x' ? (P.a0 + P.a1) / 2 : P.at + P.out) : 0.6, cz = P ? (P.axis === 'x' ? P.at + P.out : (P.a0 + P.a1) / 2) : TERRACE.deck.z1;
    const ox = x - cx, oz = z - cz, d = Math.hypot(ox, oz);
    if (d < S.near || d > far || ox * S.n[0] + oz * S.n[1] < d * 0.15) return 0;
    const py = height(x, z) + y;
    let n = 0;
    for (const [vx, vz] of S.viewers) {
      if (P && !throughPane(P, vx, vz, EYE, x, py, z)) continue;
      if (clear(vx, vz, x, z)) n++;
    }
    return n;
  };
  return {
    sides: WINDOW_SIDES, clear, count: (id, x, z, y, far) => count(WINDOW_SIDES.find((s) => s.id === id), x, z, y, far),
    seen(x, z, y) { let m = 0; WINDOW_SIDES.forEach((S, i) => { if (count(S, x, z, y)) m |= 1 << i; }); return m; },
  };
}

/** The side of the house a camera looks out of: in the book room by the window it faces, in the hall or outside north. */
export function lookingOut(pos, dir) {
  if (pos.z < ROOM.z1 + 0.3) {
    // the book room: the window most nearly ahead
    let best = null, bestDot = 0.35;
    for (const S of WINDOW_SIDES) {
      if (!['south', 'east', 'west'].includes(S.id)) continue;
      const P = S.pane, wx = P.axis === 'x' ? (P.a0 + P.a1) / 2 : P.at, wz = P.axis === 'x' ? P.at : (P.a0 + P.a1) / 2;
      const tx = wx - pos.x, tz = wz - pos.z, l = Math.hypot(tx, tz) || 1, dot = (tx * dir.x + tz * dir.z) / l;
      if (dot > bestDot) { bestDot = dot; best = S.id; }
    }
    return best;
  }
  return pos.z > HALL.z1 + 0.2 ? 'terrace' : 'north';
}
