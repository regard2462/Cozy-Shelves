// The lake as the koi and the frogs know it (koi.js, frogs.js): how deep it is, where the water lilies float, where a
// frog can sit on the shore. Data and arithmetic only.
//   The lily pads are read from the garden when it says where they are (garden.lilyPads: [{ x, z, r }]); otherwise
// they are those the water shader draws (water.js lilies(): one pad in some of the 0.85 m cells of the two bays), found
// with the same hash, so a frog sits where a pad is drawn.
import { LAKE, WATER_Y, terrainHeight, lakeDist, shorePoint, onJetty, beachWeight, JETTY } from './outdoor.js';

const f32 = Math.fround;
const fract = (x) => f32(x - Math.floor(x));

/** Water depth at (x, z) (0 on land). */
export function depthAt(x, z) { return Math.max(0, WATER_Y - terrainHeight(x, z)); }

/** Where the water shader puts lilies (water.js lilyWeight): the east bay and a calm corner of the north shore, not near
 *  the jetty (0 … 0.45). */
export function lilyWeight(x, z, depth) {
  const top = lilyReach(x, z);
  if (top <= 0) return 0;
  depth ??= depthAt(x, z);
  return depth < 0.18 ? 0 : top * Math.min(1, (depth - 0.18) / 0.25);
}
/** The weight without the depth (the most it can be there). */
function lilyReach(x, z) {
  const bay = Math.exp(-(((x + 12.4) / 4.2) ** 2 + ((z - 46.5) / 5.5) ** 2));
  const north = Math.exp(-(((x + 41) / 5.5) ** 2 + ((z - 60.2) / 2.6) ** 2));
  const away = Math.min(1, Math.hypot(x - JETTY.end[0], z - JETTY.end[1]) / 8);
  return Math.min(0.45, (bay * 0.5 + north * 0.4) * away);
}

/** The shader's hash (water.js hash21), in single precision like the graphics card. */
function hash21(x, y) {
  let px = fract(f32(x * f32(123.34))), py = fract(f32(y * f32(456.21)));
  const d = f32(f32(px * f32(px + f32(45.32))) + f32(py * f32(py + f32(45.32))));
  px = f32(px + d); py = f32(py + d);
  return fract(f32(px * py));
}

/**
 * The lily pads: [{ x, z, r, notch }] (notch: the direction of the cut, radians from +x towards +z). From the garden
 * if it lists them, else the pads of the water shader that lie well inside their bay (a pad at the edge of a bay may be
 * drawn only in part).
 */
export function lilyPads(garden) {
  // (an empty list counts: no pads while it snows)
  if (Array.isArray(garden?.lilyPads)) return garden.lilyPads.map((p) => ({ notch: 0, ...p }));
  const out = [], C = 0.85;
  for (const [cx, cz, rx, rz] of [[-12.4, 46.5, 9, 12], [-41, 60.2, 12, 6]]) {
    for (let i = Math.floor((cx - rx) / C); i <= Math.floor((cx + rx) / C); i++) for (let j = Math.floor((cz - rz) / C); j <= Math.floor((cz + rz) / C); j++) {
      // (17.31 is a single-precision constant in the shader: added as one, the hash comes out the same)
      const h = hash21(f32(i + f32(17.31)), f32(j + f32(17.31)));
      const x = (i + 0.5 + (fract(f32(h * f32(31.7))) - 0.5) * 0.45) * C, z = (j + 0.5 + (fract(f32(h * f32(57.3))) - 0.5) * 0.45) * C;
      const r = 0.15 + 0.15 * fract(f32(h * f32(91.7)));
      // drawn where the weight under the fragment exceeds the hash: take pads whose whole disc lies well inside (the
      // weight without the depth first: it is cheap and rules most cells out)
      if (h + 0.06 >= 0.45 || lilyReach(x, z) <= h + 0.06) continue;
      let ok = lilyWeight(x, z) > h + 0.06;
      for (let k = 0; k < 12 && ok; k++) { const a = k * Math.PI / 6; if (lilyWeight(x + Math.cos(a) * r * 1.2, z + Math.sin(a) * r * 1.2) < h + 0.06) ok = false; }
      if (ok) out.push({ x, z, r, notch: Math.PI - h * Math.PI * 2 });
    }
  }
  return out;
}

/** Places on the shore where a frog can sit at the water's edge: [{ x, z, y, yaw }] (yaw: facing the water). Not on the
 *  beach, the jetty or among the reeds' densest clumps; a little above the water. */
export function shoreSpots() {
  const out = [];
  for (let a = -Math.PI; a < Math.PI; a += Math.PI / 90) {
    // the stretches the walkers see: the east and south shore and the bays round them
    const [sx, sz] = shorePoint(a, 0.03);
    if (onJetty(sx, sz) || beachWeight(sx, sz) > 0.05 || Math.hypot(sx - JETTY.root[0], sz - JETTY.root[1]) < 3) continue;
    if (lakeDist(sx, sz) < 0.9) continue;
    const y = terrainHeight(sx, sz);
    if (y < WATER_Y + 0.005 || y > WATER_Y + 0.09) continue;
    out.push({ x: sx, z: sz, y, yaw: Math.atan2(LAKE.x - sx, LAKE.z - sz) });
  }
  return out;
}
