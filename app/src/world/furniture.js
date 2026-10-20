// Procedural furniture & props. Every builder returns a THREE.Group with userData.footprint = {w, d, h}
// (for collisions) and optionally userData.seat / userData.interact / userData.lights.
import * as THREE from 'three';
import { Parts, boxGeo, boxGeoUV, rboxGeo, cylGeo, sphereGeo, planeGeo, torusGeo, coneGeo, seeded } from './geo.js';
import { M } from './materials.js';
import { drawLabel, newspaperTexture } from './textures.js';
import { signs, SIGN_DENSITY } from './signs.js';
import { withShelfGlow } from './shelf-light.js';
import { plantingFor, weatheredWood, outdoorSteel } from './nature.js';
import { i18n } from '../core/i18n.js';
import { bus } from '../core/bus.js';
import { twoSided, twoSidedAll } from './two-sided.js';

const V = (x, y, z) => [x, y, z];
/** A top of a piece of furniture (player.js): `w` wide (centred), from z0 to z1 in its own frame, `y` high. Walkable
 *  unless `walk` is false: then it is a solid part such as the back of a seat, in the way at any height. */
const top = (w, [z0, z1], y, walk = true) => ({ x0: -w / 2, x1: w / 2, z0, z1, y, walk });

/** Name plates: off-white enamel with dark lettering (the dark brown plates with gold edges looked old). */
export const PLATE = { bg: '#f6f2ea', fg: '#28302d', border: '#cdbfa6' };
/** A name plate of `metres` [width, height] as a material. It is laid out 512 units wide (font `size` in those units)
 *  and drawn at the close-up density of signs.js, once: the next build of the room reuses it. */
export function plateMaterial(text, metres, { size = 44, roughness = 0.55 } = {}) {
  const [wm, hm] = metres, LW = 512, LH = Math.round(LW * hm / wm);
  const w = Math.round(wm * SIGN_DENSITY.close), k = w / LW, h = Math.round(LH * k);
  const opts = { width: LW, height: LH, bg: PLATE.bg, fg: PLATE.fg, border: PLATE.border, font: `600 ${size}px "Cormorant Garamond", "EB Garamond", Georgia, serif` };
  const sign = signs.get(`plate|${text}|${w}x${h}|${size}`, { kind: 'plate', w, h, metres, bg: PLATE.bg, group: 'furniture', draw: (g) => { g.scale(k, k); drawLabel(g, text, opts); } });
  const mat = new THREE.MeshStandardMaterial({ roughness }); mat.userData.disposable = true;
  return signs.use(sign, mat);
}

// ---- seating -----------------------------------------------------------------------------
export function armchair({ color = '#a4623b', material = 'leather', wood = 'oak', seed = 1 } = {}) {
  const fab = material === 'leather' ? M.leather(color) : M.fabric(color, seed);
  const p = new Parts();
  const w = 0.92, d = 0.9;
  p.add(rboxGeo(w, 0.36, d, 0.06, 3), fab, V(0, 0.36, 0));            // base
  p.add(rboxGeo(w - 0.3, 0.14, d - 0.2, 0.05, 3), fab, V(0, 0.58, 0.04)); // seat cushion
  p.add(rboxGeo(w - 0.3, 0.62, 0.22, 0.06, 3), fab, V(0, 0.82, -d / 2 + 0.16), [-0.12, 0, 0]); // back
  p.add(rboxGeo(0.16, 0.36, d - 0.1, 0.05, 3), fab, V(-w / 2 + 0.08, 0.68, 0));   // arms
  p.add(rboxGeo(0.16, 0.36, d - 0.1, 0.05, 3), fab, V(w / 2 - 0.08, 0.68, 0));
  const legM = M.wood(wood);
  for (const [x, z] of [[-w / 2 + 0.1, -d / 2 + 0.1], [w / 2 - 0.1, -d / 2 + 0.1], [-w / 2 + 0.1, d / 2 - 0.1], [w / 2 - 0.1, d / 2 - 0.1]]) p.add(cylGeo(0.035, 0.045, 0.2, 10), legM, V(x, 0.1, z));
  const g = p.build({ name: 'armchair' });
  g.userData.footprint = { w, d, h: 1.1 };
  g.userData.tops = [top(w, [-0.13, d / 2], 0.65), top(w, [-d / 2, -0.13], 1.1, false)];   // seat and arms; the back
  g.userData.seat = { eye: [0, 1.22, 0.08], look: [0, 1.15, 1], surface: null, kind: 'armchair', catSpot: [0, 0.66, 0.02] };
  return g;
}

export function sofa({ color = '#5b6b4a', seats = 3, seed = 2 } = {}) {
  const fab = M.fabric(color, seed);
  const p = new Parts();
  const w = 0.75 * seats + 0.3, d = 0.92;
  p.add(rboxGeo(w, 0.4, d, 0.06, 3), fab, V(0, 0.34, 0));
  for (let i = 0; i < seats; i++) {
    const x = -w / 2 + 0.15 + 0.375 + i * 0.75;
    p.add(rboxGeo(0.7, 0.14, 0.66, 0.05, 3), fab, V(x, 0.6, 0.06));
    p.add(rboxGeo(0.7, 0.5, 0.2, 0.06, 3), fab, V(x, 0.86, -d / 2 + 0.2), [-0.1, 0, 0]);
  }
  p.add(rboxGeo(0.15, 0.3, d - 0.1, 0.05, 3), fab, V(-w / 2 + 0.075, 0.68, 0));
  p.add(rboxGeo(0.15, 0.3, d - 0.1, 0.05, 3), fab, V(w / 2 - 0.075, 0.68, 0));
  const legM = M.wood('oak');
  for (const [x, z] of [[-w / 2 + 0.1, -d / 2 + 0.1], [w / 2 - 0.1, -d / 2 + 0.1], [-w / 2 + 0.1, d / 2 - 0.1], [w / 2 - 0.1, d / 2 - 0.1]]) p.add(cylGeo(0.03, 0.04, 0.16, 10), legM, V(x, 0.08, z));
  const g = p.build({ name: 'sofa' });
  g.userData.footprint = { w, d, h: 1.1 };
  g.userData.tops = [top(w, [-0.16, d / 2], 0.67), top(w, [-d / 2, -0.16], 1.1, false)];   // cushions and arms; the back
  g.userData.seat = { eye: [0, 1.22, 0.1], look: [0, 1.15, 1], kind: 'sofa', catSpot: [w / 2 - 0.5, 0.68, 0.05] };
  return g;
}

export function chair({ wood = 'oak', cushion = '#8fa487' } = {}) {
  const wm = M.wood(wood), fab = M.fabric(cushion, 3);
  const p = new Parts();
  p.add(rboxGeo(0.46, 0.05, 0.46, 0.01), wm, V(0, 0.45, 0));
  p.add(rboxGeo(0.42, 0.04, 0.42, 0.015), fab, V(0, 0.49, 0));
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) p.add(cylGeo(0.02, 0.025, 0.45, 8), wm, V(x, 0.225, z));
  p.add(boxGeo(0.04, 0.5, 0.04), wm, V(-0.2, 0.72, -0.21)); p.add(boxGeo(0.04, 0.5, 0.04), wm, V(0.2, 0.72, -0.21));
  p.add(rboxGeo(0.44, 0.12, 0.03, 0.01), wm, V(0, 0.92, -0.21)); p.add(rboxGeo(0.44, 0.06, 0.03, 0.01), wm, V(0, 0.72, -0.21));
  const g = p.build({ name: 'chair' });
  g.userData.footprint = { w: 0.5, d: 0.5, h: 1 };
  g.userData.tops = [top(0.4, [-0.17, 0.2], 0.51), top(0.4, [-0.2, -0.17], 0.98, false)];   // inside its collider (world.js)
  g.userData.seat = { eye: [0, 1.22, 0.02], look: [0, 1.1, 1], kind: 'chair' };
  return g;
}

/**
 * Built-in window bench along the glass front: an off-white painted carcass with panel fronts, an oak top,
 * one long seat cushion, back cushions leaning against the glass, scattered pillows and a folded throw.
 * Faces local -z (its back stands against the wall).
 */
export function windowBench({ w = 6, d = 0.62, h = 0.43, cushion = '#6f8f8a', seed = 3 } = {}) {
  const rnd = seeded(seed * 17 + 5);
  const body = M.paint('#efebe3'), oak = M.wood('oak');
  const p = new Parts();
  p.add(boxGeoUV(w, h - 0.03, d - 0.02, 0.5), body, V(0, (h - 0.03) / 2, 0.01));
  p.add(boxGeoUV(w + 0.02, 0.03, d + 0.01, 0.5), oak, V(0, h - 0.015, 0.005));
  const n = Math.max(2, Math.round(w / 0.8));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * (w / n);
    p.add(boxGeoUV(w / n - 0.07, h - 0.13, 0.012, 0.5), body, V(x, (h - 0.03) / 2, -d / 2 + 0.004));   // raised panel
    p.add(sphereGeo(0.012, 8), M.brass(), V(x, h - 0.1, -d / 2 - 0.006));
  }
  p.add(boxGeoUV(w, 0.05, 0.012, 0.5), M.paint('#ddd6ca'), V(0, 0.025, -d / 2 + 0.004));        // toe kick
  // seat cushion
  const seat = M.fabric(cushion, seed);
  p.add(rboxGeo(w - 0.04, 0.1, d - 0.08, 0.035, 3), seat, V(0, h + 0.05, -0.02));
  // back cushions against the glass, leaning back a little
  const backs = Math.max(2, Math.floor(w / 0.7));
  for (let i = 0; i < backs; i++) {
    const x = -w / 2 + (i + 0.5) * (w / backs);
    p.add(rboxGeo(w / backs - 0.06, 0.4, 0.13, 0.05, 3), seat, V(x, h + 0.1 + 0.19, d / 2 - 0.14), [0.18, 0, 0]);
  }
  // pillows in the accent colours, a few lying, a few propped up
  const accents = ['#d4a45c', '#b4674a', '#f0e6d4', '#3f6f6d', '#8fa487', '#c98b77'];
  for (let i = 0; i < Math.max(3, Math.floor(w / 1.3)); i++) {
    const x = -w / 2 + 0.45 + rnd() * (w - 0.9);
    const c = accents[Math.floor(rnd() * accents.length)];
    p.add(rboxGeo(0.4, 0.38, 0.12, 0.05, 3), M.fabric(c, 20), V(x, h + 0.1 + 0.18, d / 2 - 0.26), [0.28, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.12]);
  }
  // a folded throw at one end
  const throwM = M.fabric('#e9dfcf', 31);
  p.add(rboxGeo(0.5, 0.07, 0.42, 0.03, 2), throwM, V(-w / 2 + 0.42, h + 0.135, -0.05), [0, 0.12, 0]);
  const g = p.build({ name: 'windowbench' });
  g.userData.footprint = { w, d, h: 0.6 };
  g.userData.tops = [top(w, [-d / 2, 0.08], h + 0.1), top(w, [0.08, d / 2], 0.92, false)];   // the cushion; the back cushions
  // NOTE: `look` must point AWAY from the wall – the stand-up spot is derived from it.
  g.userData.seat = { eye: [0, 1.17, -0.08], look: [0, 1.07, -1], kind: 'windowseat', catSpot: [w / 2 - 0.9, h + 0.1, -0.05] };
  return g;
}

export function windowSeat({ w = 2.2, color = '#5e6f86' } = {}) {
  const p = new Parts();
  p.add(boxGeoUV(w, 0.42, 0.62, 0.55), M.wood('walnut'), V(0, 0.21, 0));
  p.add(rboxGeo(w - 0.06, 0.12, 0.58, 0.04), M.fabric(color, 5), V(0, 0.48, 0));
  p.add(rboxGeo(0.5, 0.36, 0.14, 0.05), M.fabric('#b98f5b', 6), V(-w / 2 + 0.32, 0.72, -0.2), [-0.2, 0, 0]);
  p.add(rboxGeo(0.5, 0.36, 0.14, 0.05), M.fabric('#8a4a3e', 7), V(w / 2 - 0.32, 0.72, -0.2), [-0.2, 0.2, 0]);
  const g = p.build({ name: 'windowseat' });
  g.userData.footprint = { w, d: 0.65, h: 0.6 };
  // NOTE: `look` must point AWAY from the wall – the stand-up spot is derived from it.
  g.userData.seat = { eye: [0, 1.15, -0.05], look: [0, 1.05, -1], kind: 'windowseat', catSpot: [w / 2 - 0.9, 0.56, 0] };
  return g;
}

// ---- tables ---------------------------------------------------------------------------------
export function table({ w = 2.4, d = 1.1, h = 0.76, wood = 'oak' } = {}) {
  const wm = M.wood(wood);
  const p = new Parts();
  p.add(rboxGeo(w, 0.05, d, 0.01), wm, V(0, h - 0.025, 0));
  // the apron runs between the legs, 1 cm inside their centres: the legs stand at its corners, none pokes out
  const lx = w / 2 - 0.12, lz = d / 2 - 0.12;
  p.add(boxGeoUV(2 * lx - 0.02, 0.1, 2 * lz - 0.02, 0.5), wm, V(0, h - 0.1, 0));
  for (const [x, z] of [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]]) p.add(cylGeo(0.035, 0.05, h - 0.05, 10), wm, V(x, (h - 0.05) / 2, z));   // up to the underside of the top
  const g = p.build({ name: 'table' });
  g.userData.footprint = { w, d, h };
  g.userData.tops = [top(w, [-d / 2, d / 2], h)];
  g.userData.surface = { y: h, w: w - 0.2, d: d - 0.2 };
  return g;
}
export function sideTable({ r = 0.3, h = 0.6, wood = 'oak' } = {}) {
  const wm = M.wood(wood);
  const p = new Parts();
  p.add(cylGeo(r, r, 0.04, 24), wm, V(0, h - 0.02, 0));
  // the column stands on the foot and carries the top (it used to end 6 cm below it)
  p.add(cylGeo(0.04, 0.06, h - 0.07, 10), wm, V(0, 0.03 + (h - 0.07) / 2, 0));
  p.add(cylGeo(Math.min(0.18, r * 0.75), Math.min(0.2, r * 0.8), 0.03, 20), wm, V(0, 0.015, 0));
  const g = p.build({ name: 'sidetable' });
  g.userData.footprint = { w: r * 2, d: r * 2, h };
  g.userData.tops = [top(r * 1.6, [-r * 0.8, r * 0.8], h)];   // a square inside the round top
  g.userData.surface = { y: h, w: r * 1.5, d: r * 1.5 };
  return g;
}
export function desk({ w = 1.8, d = 0.8, wood = 'oak' } = {}) {
  const wm = M.wood(wood), leatherM = M.leather('#8e9c86');
  const p = new Parts();
  p.add(rboxGeo(w, 0.05, d, 0.01), wm, V(0, 0.75, 0));
  p.add(boxGeo(w - 0.5, 0.01, d - 0.3), leatherM, V(0, 0.78, 0));
  // the two pedestals stand on the floor and carry the top (they used to end 1.5 cm below it)
  p.add(boxGeoUV(0.45, 0.725, d - 0.08, 0.5), wm, V(-w / 2 + 0.25, 0.3625, 0));
  p.add(boxGeoUV(0.45, 0.725, d - 0.08, 0.5), wm, V(w / 2 - 0.25, 0.3625, 0));
  // drawer pulls on the pedestal fronts (they used to sit 1 cm inside them)
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) p.add(boxGeo(0.12, 0.012, 0.014), M.blackMetal(), V(sx * (w / 2 - 0.25), 0.15 + i * 0.2, (d - 0.08) / 2 + 0.007));
  const g = p.build({ name: 'desk' });
  g.userData.footprint = { w, d, h: 0.78 };
  g.userData.tops = [top(w, [-d / 2, d / 2], 0.78)];
  g.userData.surface = { y: 0.78, w: w - 0.6, d: d - 0.3 };
  return g;
}

/**
 * Display table ("Präsentationstisch"): books lie face-up on it (world-actions.refreshDisplayTable). Square legs
 * under the corners of the top, all inset by the same 7 cm; an apron between them right under the top; a lower
 * shelf between the legs, resting on two rails; the name plate on the front apron. Front = local +z.
 */
export function displayTable({ w = 1.8, d = 0.95, h = 0.72, wood = 'oak' } = {}) {
  const wm = M.wood(wood);
  const p = new Parts();
  const T = 0.04, L = 0.055, inset = 0.07, AH = 0.1, AT = 0.022;          // top, leg section, leg inset, apron height and board
  const lx = w / 2 - inset - L / 2, lz = d / 2 - inset - L / 2;            // leg centres
  p.add(rboxGeo(w, T, d, 0.01), wm, V(0, h - T / 2, 0));
  for (const [x, z] of [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]]) p.add(boxGeoUV(L, h - T, L, 0.5), wm, V(x, (h - T) / 2, z));
  // aprons between the legs, 8 mm behind their outer faces, touching the underside of the top
  const ay = h - T - AH / 2, face = L / 2 - 0.008 - AT / 2;
  for (const sz of [-1, 1]) p.add(boxGeoUV(2 * lx - L, AH, AT, 0.5), wm, V(0, ay, sz * (lz + face)));
  for (const sx of [-1, 1]) p.add(boxGeoUV(AT, AH, 2 * lz - L, 0.5), wm, V(sx * (lx + face), ay, 0));
  // the lower shelf: between the legs from left to right, as deep as the legs stand apart; on two rails
  const sy = 0.17, ST = 0.024;
  for (const sz of [-1, 1]) p.add(boxGeoUV(2 * lx - L, 0.045, 0.028, 0.5), wm, V(0, sy - ST / 2 - 0.0225, sz * lz));
  p.add(boxGeoUV(2 * lx - L - 0.004, ST, 2 * lz + L - 0.02, 0.5), wm, V(0, sy, 0));
  const g = p.build({ name: 'displaytable' });
  const plateMat = plateMaterial('Empfehlungen · Picks', [0.44, 0.074], { size: 40 });
  const plate = new THREE.Mesh(planeGeo(0.44, 0.074), plateMat);
  plate.position.set(0, ay, lz + face + AT / 2 + 0.0015); g.add(plate);
  g.userData.footprint = { w, d, h };
  g.userData.tops = [top(w, [-d / 2, d / 2], h)];
  g.userData.surface = { y: h, w: w - 0.2, d: d - 0.2 };
  g.userData.display = { y: h, w: w - 0.25, d: d - 0.25 };
  return g;
}

/** Low record sideboard: light oak body with slatted fronts on slim black legs. Front = local +z. */
export function sideboard({ w = 2.2, d = 0.46, h = 0.76 } = {}) {
  const oak = M.wood('oak'), slat = M.wood('oak', { along: 'y', seed: 3 }), groove = M.plain(0x6f5a44, { roughness: 0.9 });
  const legH = 0.15, bodyH = h - legH;
  const p = new Parts();
  p.add(boxGeoUV(w, bodyH, d, 0.5), oak, V(0, legH + bodyH / 2, 0));
  const n = 4, fw = w / n;
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + (i + 0.5) * fw;
    p.add(boxGeoUV(fw - 0.014, bodyH - 0.05, 0.014, 0.5), slat, V(cx, legH + bodyH / 2, d / 2 + 0.006));
    for (let k = 1; k < 9; k++) p.add(boxGeo(0.004, bodyH - 0.08, 0.004), groove, V(cx - (fw - 0.014) / 2 + k * (fw - 0.014) / 9, legH + bodyH / 2, d / 2 + 0.0135));
  }
  for (const [x, z] of [[-w / 2 + 0.08, -d / 2 + 0.06], [w / 2 - 0.08, -d / 2 + 0.06], [-w / 2 + 0.08, d / 2 - 0.06], [w / 2 - 0.08, d / 2 - 0.06]]) p.add(cylGeo(0.016, 0.011, legH, 10), M.blackMetal(), V(x, legH / 2, z));
  const g = p.build({ name: 'sideboard' });
  g.userData.footprint = { w, d, h };
  g.userData.tops = [top(w, [-d / 2, d / 2], h)];
  g.userData.surface = { y: h, w: w - 0.2, d: d - 0.12 };
  return g;
}

let sleeveMat = null;
/** A small oak crate with LP sleeves standing in it. */
export function recordCrate() {
  const oak = M.wood('oak');
  const p = new Parts();
  const W = 0.36, D = 0.34, H = 0.2, t = 0.012;
  p.add(boxGeo(W, t, D), oak, V(0, t / 2, 0));
  for (const s of [-1, 1]) { p.add(boxGeo(t, H, D), oak, V(s * (W / 2 - t / 2), H / 2, 0)); p.add(boxGeo(W, H * 0.6, t), oak, V(0, H * 0.3, s * (D / 2 - t / 2))); }
  // one material for all sleeves: every sleeve samples its own pixel of a small colour strip
  const sleeves = ['#e0a458', '#3f6f6d', '#d9d2c5', '#b4674a', '#2d3a4f', '#8fa487', '#e8c9b0', '#c24f3f', '#f0e6d4', '#5a6f8f', '#d4a45c', '#6c4f7d'];
  if (!sleeveMat) {
    const c = document.createElement('canvas'); c.width = sleeves.length; c.height = 1;
    const g2 = c.getContext('2d'); sleeves.forEach((col, i) => { g2.fillStyle = col; g2.fillRect(i, 0, 1, 1); });
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    sleeveMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
  }
  const rnd = seeded(41);
  sleeves.forEach((c, i) => {
    const z = -D / 2 + 0.035 + i * ((D - 0.07) / (sleeves.length - 1));
    const geo = new THREE.BoxGeometry(0.31, 0.31, 0.004);
    const uv = geo.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, (i + 0.5) / sleeves.length, 0.5);
    p.add(geo, sleeveMat, V((rnd() - 0.5) * 0.01, t + 0.155, z), [0.12 + (rnd() - 0.5) * 0.06, 0, (rnd() - 0.5) * 0.02]);
  });
  const g = p.build({ name: 'records' });
  g.userData.footprint = null;
  return g;
}

// ---- lamps ------------------------------------------------------------------------------------
// Every lamp keeps its light for good (world.js). `tier` says from which graphics quality on a lamp gets a
// real light: 1 always, 2 from 'medium', 3 only on 'high'. Below its tier a lamp only glows.
// Small lamps (sconces, candles, screens, shelf strips) have no real light at all: they get a glow decal
// on the wall or a glowing material instead, which costs nothing and never switches off.
// Every lamp builder below names its kind in `userData.lamp`: world.js registers such a lamp when it is placed, and E
// or a click switches it off and on (lamp-switch.js: the light, the decals and the glowing parts fade together).
// Glowing parts outside the shared lamp materials go into `userData.lampParts` (kept out of the static batches).

/** Soft round glow (white in the middle, transparent at the rim) for light decals. */
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.2, 'rgba(255,255,255,0.62)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.2)'); grad.addColorStop(0.78, 'rgba(255,255,255,0.05)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, N, N);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}
/** A pool of light on a table top or the floor: an even disc that fades out towards a soft rim (the shade cuts
 *  the light off there). */
let poolTex = null;
function poolTexture() {
  if (poolTex) return poolTex;
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const r = Math.hypot((x + 0.5) / N - 0.5, (y + 0.5) / N - 0.5) * 2;
    const rim = 1 - Math.min(1, Math.max(0, (r - 0.35) / 0.65));
    const a = rim * rim * (3 - 2 * rim) * (0.72 + 0.28 * Math.max(0, 1 - r * r));
    img.data.set([255, 255, 255, Math.round(255 * a)], (y * N + x) * 4);
  }
  g.putImageData(img, 0, 0);
  poolTex = new THREE.CanvasTexture(c);
  return poolTex;
}
/** What a wall light with an open linen cylinder throws onto the wall: a bright fan of light above and below the
 *  shade that widens and fades with the distance, and a soft halo round the shade. The texture is 1 m × 2.4 m on
 *  the wall with the shade (17 cm wide, 21 cm high) in the middle. */
let washTex = null;
function washTexture() {
  if (washTex) return washTex;
  const W = 128, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H);
  const HW = 0.5, HH = 1.2, sw = 0.085, sh = 0.105;     // half sizes in metres: texture, shade
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = ((x + 0.5) / W * 2 - 1) * HW, v = (1 - (y + 0.5) / H * 2) * HH;   // metres from the shade's middle, v up
    let a = 0;
    for (const [dir, spread, reach, gain] of [[1, 0.62, 0.75, 0.95], [-1, 0.5, 0.62, 1.0]]) {
      const d = dir * v - sh;                          // distance beyond the rim, along the fan
      if (d <= -0.02) continue;
      const half = sw + Math.max(0, d) * spread;       // the fan opens up from the rim of the shade
      const across = 1 - sstep(half * 0.5, half * 1.08, Math.abs(u));
      const along = Math.exp(-Math.max(0, d) / reach) * (1 - sstep(HH * 0.72, HH * 0.98, Math.abs(v))) * sstep(-0.02, 0.03, d);
      a += across * along * gain;
    }
    a += 0.55 * Math.exp(-(u * u) / (2 * 0.1 * 0.1) - (v * v) / (2 * 0.16 * 0.16));   // halo round the shade
    img.data.set([255, 255, 255, Math.round(255 * Math.min(1, a))], (y * W + x) * 4);
  }
  g.putImageData(img, 0, 0);
  washTex = new THREE.CanvasTexture(c);
  return washTex;
}

/** The light a lamp throws onto a wall, the floor or a table: an additive gradient just in front of the surface.
 *  world.js scales `userData.glow.base` with the brightness setting (and dims it in the hall while a film runs),
 *  tints it with the lamp colour × `gain`, and uses `noLight` instead of `base` when the graphics quality leaves
 *  the lamp without a real light (then the decal alone has to show that the lamp is on). */
export function glowDecal(w, h, strength = 0.3, color = 0xffd9a8, { map = null, gain = 1, noLight = null } = {}) {
  const mat = new THREE.MeshBasicMaterial({ map: map || glowTexture(), color, transparent: true, opacity: strength, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  mat.userData.disposable = true; mat.userData.keepMap = true;
  const m = new THREE.Mesh(planeGeo(w, h), mat);
  m.renderOrder = 2; m.castShadow = false; m.receiveShadow = false;
  m.userData.noAO = true; m.userData.glow = { base: strength, gain, noLight };
  // light lying on a surface is never hit by the look ray: aiming at the floor by a lamp aims at the floor
  m.raycast = () => {};
  return m;
}
/** A pool of light lying on a horizontal surface at local height `y` (radius `r`). */
function poolDecal(r, y, strength, noLight) {
  const m = glowDecal(r * 2, r * 2, strength, 0xffd9a8, { map: poolTexture(), noLight });
  m.rotation.x = -Math.PI / 2; m.position.y = y;
  return m;
}

/** Large linen drum pendant on a thin cable: the main light of a room. `drop` = cable length up to the ceiling. */
export function pendant({ r = 0.55, h = 0.4, drop = 1.5 } = {}) {
  const p = new Parts();
  const metal = M.blackMetal();
  p.add(cylGeo(0.004, 0.004, drop, 6), metal, V(0, h / 2 + drop / 2, 0));
  p.add(cylGeo(0.07, 0.07, 0.025, 20), metal, V(0, h / 2 + drop - 0.0125, 0));          // ceiling rose
  for (const y of [h / 2, -h / 2]) p.add(torusGeo(r, 0.006, 6, 56), metal, V(0, y, 0), [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; p.add(cylGeo(0.004, 0.004, r, 5), metal, V(Math.cos(a) * r / 2, h / 2, Math.sin(a) * r / 2), [0, -a, Math.PI / 2]); }
  const g = p.build({ name: 'pendant', castShadow: false });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 56, 1, true), M.lampShade(0xffe1b4, 0.55));
  shade.castShadow = false; g.add(shade);
  const diffuser = new THREE.Mesh(new THREE.CircleGeometry(r - 0.01, 48), M.lampLight(0xffdcab, 1.05));
  diffuser.rotation.x = Math.PI / 2; diffuser.position.y = -h / 2 + 0.03; g.add(diffuser);
  // range 15 m: a room is lit to its corners, the garden outside the windows stays dark at night (no shadows,
  // so a longer range lit the lawn through the walls)
  const light = new THREE.PointLight(0xffd2a0, 0, 15, 1.25); light.position.y = -h / 2 - 0.15; g.add(light);
  // the drum is open at the top: a soft warm circle on the ceiling above it
  const up = glowDecal(r * 7, r * 7, 0.2, 0xffd9a8); up.rotation.x = Math.PI / 2; up.position.y = h / 2 + drop - 0.006; g.add(up);
  g.userData.lights = [{ light, intensity: 10 * Math.min(1, (r / 0.6) ** 2), tier: 1 }];   // smaller shades hang lower: less light
  g.userData.glows = [up];
  g.userData.footprint = null;
  g.userData.lamp = 'pendant';
  return g;
}

/** Reading lamp for tables and desks: brass stem, cream dome shade (replaces the green banker lamp). */
export function deskLamp() {
  const p = new Parts();
  p.add(cylGeo(0.085, 0.095, 0.022, 24), M.blackMetal(), V(0, 0.011, 0));
  p.add(cylGeo(0.009, 0.009, 0.36, 10), M.brass(), V(0, 0.2, 0));
  const g = p.build({ name: 'desklamp' });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.ceramic(0xefe8dc));
  dome.position.y = 0.37; dome.castShadow = true; g.add(dome);
  const under = new THREE.Mesh(new THREE.CircleGeometry(0.125, 32), M.lampLight(0xffd9a4, 1.35));
  under.rotation.x = Math.PI / 2; under.position.y = 0.372; g.add(under);
  const light = new THREE.PointLight(0xffc98a, 0, 4.5, 1.3); light.position.y = 0.3; g.add(light);
  // its circle of light on the desk: faint next to the real light, clear where the quality leaves it without one
  const pool = poolDecal(0.34, 0.003, 0.14, 0.34); g.add(pool);
  g.userData.lights = [{ light, intensity: 1.8, tier: 3 }];
  g.userData.glows = [pool];
  g.userData.footprint = null;
  g.userData.lamp = 'desklamp';
  return g;
}

export function bankerLamp() {
  const p = new Parts();
  p.add(cylGeo(0.1, 0.12, 0.02, 20), M.brass(), V(0, 0.01, 0));
  p.add(cylGeo(0.012, 0.012, 0.3, 8), M.brass(), V(0, 0.16, 0));
  p.add(boxGeo(0.02, 0.02, 0.12), M.brass(), V(0, 0.31, 0.04));
  // Classic green glass shade: dark and matte on the OUTSIDE, warm on the inside.
  // (It used to have a green emissive, which made the whole lamp glow green.)
  const outer = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.13, 0.28, 24, 1, true, Math.PI, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x14512c, roughness: 0.32, metalness: 0.05, side: THREE.FrontSide }),
  );
  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.118, 0.128, 0.276, 24, 1, true, Math.PI, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0xf0dcb8, emissive: 0xffcf94, emissiveIntensity: 0.3, roughness: 0.75, side: THREE.BackSide }),
  );
  // the half cylinder must cover the TOP (rotation −90°): at +90° the shade was an open trough and you
  // looked straight into its lit inside from almost everywhere
  for (const s of [outer, inner]) { s.rotation.z = -Math.PI / 2; s.position.set(0, 0.36, 0.05); s.castShadow = false; }
  const bulb = new THREE.Mesh(sphereGeo(0.025, 10), M.plain(0xfff3d2, { emissive: 0xffd9a0, emissiveIntensity: 1.4 })); bulb.position.set(0, 0.33, 0.06);
  const g = p.build({ name: 'bankerlamp' }); g.add(outer, inner, bulb);
  const light = new THREE.PointLight(0xffc98a, 0, 3.6, 1.35); light.position.set(0, 0.28, 0.1); g.add(light);
  g.userData.lights = [{ light, intensity: 1.5 }];
  g.userData.footprint = null;
  g.userData.lamp = 'bankerlamp';
  // switched off, the inside of the shade and the bulb lose their glow (their own materials, not batched)
  g.userData.lampParts = [inner, bulb];
  for (const m of g.userData.lampParts) m.userData.dynamic = true;
  return g;
}
export function floorLamp({ shade = 0xffe3b8 } = {}) {
  const p = new Parts();
  p.add(cylGeo(0.15, 0.16, 0.025, 28), M.blackMetal(), V(0, 0.0125, 0));
  p.add(cylGeo(0.011, 0.011, 1.5, 8), M.blackMetal(), V(0, 0.77, 0));
  p.add(cylGeo(0.016, 0.016, 0.06, 8), M.brass(), V(0, 1.45, 0));
  const g = p.build({ name: 'floorlamp' });
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.32, 32, 1, true), M.lampShade(shade, 0.78)); sh.position.y = 1.6; sh.castShadow = false; g.add(sh);
  // the bright underside of the shade (seen from a chair) and the bulb
  const under = new THREE.Mesh(new THREE.CircleGeometry(0.205, 32), M.lampLight(0xffd9a0, 1.2)); under.rotation.x = Math.PI / 2; under.position.y = 1.47; g.add(under);
  const bulb = new THREE.Mesh(sphereGeo(0.035, 12), M.lampLight(0xffd9a0, 1.6)); bulb.position.y = 1.56; g.add(bulb);
  const light = new THREE.PointLight(0xffc98a, 0, 8, 1.3); light.position.y = 1.58; g.add(light);
  const pool = poolDecal(1.15, 0.026, 0.1, 0.26); g.add(pool);
  g.userData.lights = [{ light, intensity: 2.8, tier: 2 }];
  g.userData.glows = [pool];
  g.userData.footprint = { w: 0.36, d: 0.36, h: 1.8 };
  g.userData.lamp = 'floorlamp';
  return g;
}
export function tableLamp({ base = 0xa9b8a5, pool = 0.25 } = {}) {
  const p = new Parts();
  p.add(cylGeo(0.06, 0.075, 0.03, 20), M.ceramic(base), V(0, 0.015, 0));
  const pts = [[0, 0], [0.07, 0], [0.095, 0.06], [0.1, 0.13], [0.08, 0.2], [0.035, 0.25], [0.02, 0.3], [0, 0.3]].map(([x, y]) => new THREE.Vector2(x, y));
  p.add(new THREE.LatheGeometry(pts, 24), M.ceramic(base), V(0, 0.02, 0));
  const g = p.build({ name: 'tablelamp' });
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.2, 28, 1, true), M.lampShade(0xffe1b4, 0.8)); sh.position.y = 0.42; sh.castShadow = false; g.add(sh);
  // looking down into the shade from above: the bright opening
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.115, 28), M.lampLight(0xffd9a0, 1.3)); top.rotation.x = -Math.PI / 2; top.position.y = 0.505; g.add(top);
  const light = new THREE.PointLight(0xffc98a, 0, 5, 1.3); light.position.y = 0.4; g.add(light);
  // on the small table it stands on (the pool must stay on the table top: `pool` = its radius)
  const disc = poolDecal(pool, 0.003, 0.12, 0.3); g.add(disc);
  g.userData.lights = [{ light, intensity: 1.8, tier: 2 }];
  g.userData.glows = [disc];
  g.userData.footprint = null;
  g.userData.lamp = 'tablelamp';
  return g;
}
export function chandelier({ candles = 8, r = 0.7 } = {}) {
  const p = new Parts();
  p.add(torusGeo(r, 0.03, 8, 40), M.iron(), V(0, 0, 0), [Math.PI / 2, 0, 0]);
  p.add(cylGeo(0.012, 0.012, 1.4, 6), M.iron(), V(0, 0.7, 0));
  for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; p.add(cylGeo(0.006, 0.006, 0.8, 5), M.iron(), V(Math.cos(a) * r * 0.5, 0.38, Math.sin(a) * r * 0.5), [Math.sin(a) * 1.0, 0, -Math.cos(a) * 1.0]); }
  for (let i = 0; i < candles; i++) { const a = i * Math.PI * 2 / candles; p.add(cylGeo(0.02, 0.02, 0.16, 8), M.plain(0xf1e6c8), V(Math.cos(a) * r, 0.1, Math.sin(a) * r)); }
  const g = p.build({ name: 'chandelier', castShadow: false });
  const flames = new THREE.Group();
  for (let i = 0; i < candles; i++) { const a = i * Math.PI * 2 / candles; const f = new THREE.Mesh(sphereGeo(0.02, 8), M.plain(0xffe0a0, { emissive: 0xffb347, emissiveIntensity: 1.6 })); f.position.set(Math.cos(a) * r, 0.21, Math.sin(a) * r); f.scale.y = 1.6; flames.add(f); }
  g.add(flames);
  const light = new THREE.PointLight(0xffc27a, 0, 18, 1.35); light.position.y = 0.1; g.add(light);
  g.userData.lights = [{ light, intensity: 6.5, flicker: 0.05, tier: 1 }];
  g.userData.flames = flames;
  g.userData.footprint = null;
  g.userData.lamp = 'chandelier';
  return g;
}
/** Wall light: a round backplate, a short arm and a linen cylinder, open at both ends, that shines up and down.
 *  It has no real light: its fans of light on the wall are a decal (washTexture), so it stays lit from any
 *  distance and at every quality. `glow` sets how strong they are. The group origin sits 4 cm in front of the
 *  wall (the placements put it there). */
export function wallSconce({ glow = 0.26 } = {}) {
  const p = new Parts();
  p.add(cylGeo(0.055, 0.055, 0.018, 24), M.blackMetal(), V(0, 0, -0.03), [Math.PI / 2, 0, 0]);
  p.add(cylGeo(0.008, 0.008, 0.13, 8), M.blackMetal(), V(0, 0, 0.035), [Math.PI / 2, 0, 0]);
  p.add(cylGeo(0.02, 0.02, 0.035, 10), M.brass(), V(0, 0, 0.1));
  const g = p.build({ name: 'sconce', castShadow: false });
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.21, 28, 1, true), M.lampShade(0xffd9a6, 0.9)); sh.position.set(0, 0, 0.1); sh.castShadow = false; g.add(sh);
  // the open underside: the bright inside of the shade, seen from below
  const under = new THREE.Mesh(new THREE.CircleGeometry(0.082, 24), M.lampLight(0xffd6a0, 1.5)); under.rotation.x = Math.PI / 2; under.position.set(0, -0.09, 0.1); g.add(under);
  const wash = glowDecal(1.0, 2.4, Math.min(1, glow * 1.75), 0xffd9a8, { map: washTexture() }); wash.position.set(0, 0, -0.028); g.add(wash);
  g.userData.lights = [];
  g.userData.glows = [wash];
  g.userData.footprint = null;
  g.userData.lamp = 'sconce';
  return g;
}

// ---- bookcase -----------------------------------------------------------------------------------
export const SHELF_LEVELS = [0.98, 1.34, 1.70]; // y of shelf boards (books stand on these)
export const BOOKCASE = { w: 1.2, d: 0.34, h: 2.3, innerW: 1.1, shelfH: 0.34, displayY: 0.94 };
// The sloped display board in front of the lowest shelf, like a lectern that runs the whole width of the
// case (and, case after case, along the whole wall). The recommended books lie on it (books.js #buildDisplays).
// origin: middle of its upper edge (mid-plane), angle: slope against the horizontal, len: length down the slope.
export const DISPLAY = { angle: 0.61, origin: [0, 0.962, BOOKCASE.d / 2 + 0.006], len: 0.34, t: 0.022, lip: 0.032 };

/** Oak for the inside of the cases: a touch lighter, and lit by the strips (shelf-light.js). */
function shelfInterior() { return withShelfGlow(M.wood('oak', { along: 'x', contrast: 0.45, grainScale: 1.7, tint: 0xf4ece0, seed: 2 }), 0.55); }
/** The LED strip: a warm, bright bar. */
function ledStrip() { return M.plain(0xfff4e4, { emissive: 0xffdcaa, emissiveIntensity: 1.5, roughness: 0.4 }); }

export function bookcase({ wood = 'oak', columns = 1 } = {}) {
  // a finer, calmer grain: at full contrast the carcasses read as tiger stripes
  const wm = M.wood(wood, { along: 'y', contrast: 0.5, grainScale: 1.7 });
  const inside = shelfInterior(), led = ledStrip();
  const W = BOOKCASE.w * columns, D = BOOKCASE.d, H = BOOKCASE.h;
  const p = new Parts();
  p.add(boxGeoUV(0.05, H, D, 0.5), wm, V(-W / 2 + 0.025, H / 2, 0));
  p.add(boxGeoUV(0.05, H, D, 0.5), wm, V(W / 2 - 0.025, H / 2, 0));
  for (let c = 1; c < columns; c++) p.add(boxGeoUV(0.04, H - 0.1, D - 0.02, 0.5), wm, V(-W / 2 + c * BOOKCASE.w, H / 2, 0));
  p.add(boxGeoUV(W - 0.06, H - 0.1, 0.02, 0.5), inside, V(0, H / 2, -D / 2 + 0.012)); // back panel
  p.add(boxGeoUV(W, 0.05, D, 0.5), wm, V(0, 0.025, 0));
  p.add(boxGeoUV(W, 0.05, D, 0.5), wm, V(0, H - 0.025, 0));
  // stiles on both sides fill the 6 cm between neighbouring cases (slot pitch 1.26 m): a built-in wall of
  // shelves instead of dark gaps; the cornice is exactly one pitch wide, so neighbours meet without overlapping
  for (const s of [-1, 1]) p.add(boxGeoUV(0.03, H, D, 0.5), wm, V(s * (W / 2 + 0.015), H / 2, 0));
  p.add(boxGeoUV(W + 0.06, 0.06, D + 0.05, 0.5), wm, V(0, H + 0.03, 0.015)); // cornice
  // cabinet below the first shelf: two flat doors with slim black pulls
  p.add(boxGeoUV(W - 0.1, 0.84, 0.02, 0.5), wm, V(0, 0.47, D / 2 - 0.012));
  for (let c = 0; c < columns; c++) {
    const cx = -W / 2 + BOOKCASE.w * (c + 0.5);
    for (const s of [-1, 1]) {
      p.add(boxGeoUV(0.49, 0.72, 0.014, 0.5), wm, V(cx + s * 0.2525, 0.47, D / 2 + 0.003));
      p.add(boxGeo(0.012, 0.16, 0.014), M.blackMetal(), V(cx + s * 0.03, 0.6, D / 2 + 0.017));
    }
  }
  // shelves (the insides get the strip light), and a strip under every board that has a compartment below it
  for (const y of SHELF_LEVELS) p.add(boxGeoUV(W - 0.1, 0.03, D - 0.04, 0.5), inside, V(0, y - 0.015, 0.01));
  p.add(boxGeoUV(W - 0.1, 0.03, D - 0.04, 0.5), wm, V(0, 0.9 - 0.015, 0.01)); // top of the cabinet
  for (const y of [SHELF_LEVELS[1] - 0.03, SHELF_LEVELS[2] - 0.03, H - 0.05]) p.add(boxGeo(W - 0.12, 0.008, 0.012), led, V(0, y - 0.004, D / 2 - 0.035));
  // the sloped display board: board, a lip along its lower edge, three brackets underneath
  const a = DISPLAY.angle, [ox, oy, oz] = DISPLAY.origin, L = DISPLAY.len, t = DISPLAY.t;
  const at = (s, n) => V(ox, oy - Math.sin(a) * s + Math.cos(a) * n, oz + Math.cos(a) * s + Math.sin(a) * n);
  const BW = W + 0.06;   // 3 cm past both sides: next to each other the boards of neighbouring cases meet
  p.add(boxGeoUV(BW, t, L, 0.5), wm, at(L / 2, 0), [a, 0, 0]);
  p.add(boxGeoUV(BW, DISPLAY.lip + t, 0.018, 0.5), wm, at(L - 0.009, DISPLAY.lip / 2), [a, 0, 0]);
  // bracket: a triangle in the y/z plane between the case front and the underside of the board
  const top = at(0.004, -t / 2), tip = at(L * 0.78, -t / 2);
  const tri = new THREE.Shape();
  tri.moveTo(D / 2 + 0.004, top[1]); tri.lineTo(tip[2], tip[1]); tri.lineTo(D / 2 + 0.004, top[1] - 0.3); tri.closePath();
  const bracket = new THREE.ExtrudeGeometry(tri, { depth: 0.018, bevelEnabled: false });
  // shape (x, y) → (z, y), the extrusion along -x: a quarter turn (a plain swap of x and z would mirror it)
  bracket.rotateY(-Math.PI / 2); bracket.translate(0.009, 0, 0);
  for (const bx of [-W / 2 + 0.06, 0, W / 2 - 0.06]) p.add(bracket, wm, V(bx, 0, 0));
  const g = p.build({ name: 'bookcase' });
  for (const m of g.children) if (m.material === led) m.castShadow = false;
  g.userData.lights = [];
  // the display board sticks out 0.45 m in front of the case's middle: the collider reaches that far
  g.userData.footprint = { w: W + 0.1, d: 0.9, h: H + 0.2 };
  g.userData.shadowFootprint = { w: W + 0.1, d: D + 0.12 };
  g.userData.shelves = SHELF_LEVELS.map((y) => ({ y, x0: -W / 2 + 0.06, x1: W / 2 - 0.06, z: 0.02 }));
  g.userData.display = { ...DISPLAY, w: W };
  return g;
}

// ---- windows, doors, fireplace, decor ----------------------------------------------------------------
/**
 * Arched window. Total height = h + w/2 (the arch is a half circle of radius w/2); the wall
 * opening is cut to exactly that, and the frame is placed at the opening's sill height.
 * `reveal` lines the wall thickness so you never look into the void inside a wall.
 */
let revealDouble = null;
export function windowFrame({ w = 1.6, h = 3.2, arch = true, wood = 'walnut', reveal = 0.35, wallMat = 'wall' } = {}) {
  const wm = M.wood(wood);
  const p = new Parts();
  const t = 0.08;
  const rise = arch ? w / 2 : 0;
  // reveal (plaster lining of the wall opening) – slightly inset so it never z-fights the wall
  const rv = M.wall('#e8dac0');
  const rd = Math.max(0.04, reveal);
  const sideH = arch ? h : h + rise;   // on an arched window the curved lining takes over at the springing line
  p.add(boxGeoUV(0.03, sideH, rd, 0.6), rv, V(-w / 2 - 0.015, sideH / 2, -rd / 2 - 0.02));
  p.add(boxGeoUV(0.03, sideH, rd, 0.6), rv, V(w / 2 + 0.015, sideH / 2, -rd / 2 - 0.02));
  if (!arch) p.add(boxGeoUV(w + 0.06, 0.03, rd, 0.6), rv, V(0, h + rise + 0.015, -rd / 2 - 0.02));
  else {
    // The wall opening is rectangular, the frame is round: fill the two corners above the arch with wall
    // (they used to be open to the outside) and line the arch itself with a curved plaster reveal.
    const r = w / 2 + 0.015;
    const wallM = wallMat === 'wallpaper' ? M.wallpaper('#e3d5b8') : M.wall('#e8dcc2');
    for (const sx of [-1, 1]) {
      const sh = new THREE.Shape();
      sh.moveTo(sx * r, 0); sh.lineTo(sx * r, r); sh.lineTo(0, r);
      sh.absarc(0, 0, r, Math.PI / 2, sx < 0 ? Math.PI : 0, sx > 0);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: rd + 0.03, bevelEnabled: false, curveSegments: 18 });
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 1.2, uv.getY(i) / 1.2);
      geo.translate(0, h, -rd - 0.03);
      p.add(geo, wallM, V(0, 0, -0.008));   // front face flush with the wall surface
    }
    revealDouble ||= (() => { const m = rv.clone(); m.side = THREE.DoubleSide; return m; })();
    const lining = new THREE.CylinderGeometry(r - 0.004, r - 0.004, rd, 28, 1, true, Math.PI / 2, Math.PI);
    lining.rotateX(Math.PI / 2); lining.translate(0, h, -rd / 2 - 0.02);
    p.add(lining, revealDouble, V(0, 0, 0));
  }
  // frame
  p.add(boxGeoUV(t, h, 0.16, 0.5), wm, V(-w / 2 + t / 2, h / 2, 0)); p.add(boxGeoUV(t, h, 0.16, 0.5), wm, V(w / 2 - t / 2, h / 2, 0));
  p.add(boxGeoUV(w, t, 0.16, 0.5), wm, V(0, t / 2, 0));
  p.add(boxGeoUV(w + 0.34, 0.07, 0.4, 0.6), M.marble('#d8d2c6', '#8a8074'), V(0, -0.035, 0.05)); // sill
  p.add(boxGeoUV(0.04, h - 0.1, 0.03, 0.5), wm, V(0, h / 2, 0)); // muntins
  for (let i = 1; i < 4; i++) p.add(boxGeoUV(w - t * 2, 0.04, 0.03, 0.5), wm, V(0, (h / 4) * i, 0));
  if (arch) {
    p.add(torusGeo(w / 2 - t / 2, t / 2, 8, 28, Math.PI), wm, V(0, h, 0));
    // radial glazing bars in the fanlight
    for (const a of [Math.PI * 0.25, Math.PI * 0.5, Math.PI * 0.75]) p.add(boxGeo(0.03, w / 2 - t, 0.03), wm, V(Math.cos(a) * (w / 4 - t / 2), h + Math.sin(a) * (w / 4 - t / 2), 0), [0, 0, a - Math.PI / 2]);
  } else p.add(boxGeoUV(w, t, 0.16, 0.5), wm, V(0, h - t / 2, 0));
  const g = p.build({ name: 'window' });
  const glass = new THREE.Mesh(planeGeo(w - t * 2, h - t), M.glass()); glass.position.set(0, h / 2, 0); glass.castShadow = false; glass.receiveShadow = false; g.add(twoSided(glass));
  if (arch) { const arcGlass = new THREE.Mesh(new THREE.CircleGeometry(w / 2 - t, 24, 0, Math.PI), M.glass()); arcGlass.position.set(0, h, 0); arcGlass.castShadow = false; g.add(twoSided(arcGlass)); }
  g.userData.footprint = null;
  g.userData.height = h + rise;
  return g;
}
/**
 * Steel window / glass front in a rectangular wall opening: slim black frames, `bays` vertical fields, an
 * optional transom, and an oak sill board lying on the opening's lower edge (2 cm proud of the wall face).
 * Local frame: origin at the middle of the opening's lower edge on the inner wall face, +z into the room,
 * the wall reaches back to z = -reveal.
 * `open` = [first, last] bay of a door: there the sill, the lower frame and the lower panes are left out (the
 * leaves of glassDoor() fill them) and the mullions on both sides of the door run down to the floor (`floor`, the
 * floor's local height, negative when the glazing sits on a parapet).
 */
export function glazing({ w = 1.6, h = 2.9, bays = 1, transom = 0, reveal = 0.35, open = null, floor = 0 } = {}) {
  const steel = M.blackMetal();
  const frame = new Parts(), glass = new Parts();
  const fz = -Math.min(0.12, reveal * 0.4), fd = 0.08, outer = 0.07, bar = 0.05, sillT = 0.03;
  const sillBack = fz - fd / 2, sillFront = 0.02;
  const bayX = (i) => -w / 2 + (i * w) / bays;
  const isDoor = (i) => !!open && i >= open[0] && i <= open[1];
  // the runs of sill and lower frame: the whole width, or both sides of the door
  const runs = open ? [[-w / 2, bayX(open[0])], [bayX(open[1] + 1), w / 2]].filter(([a, b]) => b - a > 0.01) : [[-w / 2, w / 2]];
  for (const [a, b] of runs) frame.add(boxGeoUV(b - a, sillT, sillFront - sillBack, 0.5), M.wood('oak'), V((a + b) / 2, sillT / 2, (sillBack + sillFront) / 2));
  const y0 = sillT, y1 = h;
  // perimeter
  for (const s of [-1, 1]) frame.add(boxGeo(outer, y1 - y0, fd), steel, V(s * (w / 2 - outer / 2), (y0 + y1) / 2, fz));
  frame.add(boxGeo(w, outer, fd), steel, V(0, y1 - outer / 2, fz));
  for (const [a, b] of runs) frame.add(boxGeo(b - a, outer, fd), steel, V((a + b) / 2, y0 + outer / 2, fz));
  // mullions and transom
  const inner0 = y0 + outer, inner1 = y1 - outer;
  const tY = transom > 0 ? y0 + transom : null;
  for (let i = 1; i < bays; i++) {
    const left = isDoor(i - 1), right = isDoor(i);
    // between the two leaves only above the door; beside the door it is the door post, down to the floor
    const a = left && right ? (tY ?? inner1) : left || right ? floor : inner0;
    frame.add(boxGeo(bar, inner1 - a, fd * 0.85), steel, V(bayX(i), (a + inner1) / 2, fz));
  }
  if (tY) frame.add(boxGeo(w - outer * 2, bar, fd * 0.85), steel, V(0, tY, fz));
  // glass: one pane per field, merged
  const rows = tY ? [[inner0, tY - bar / 2], [tY + bar / 2, inner1]] : [[inner0, inner1]];
  for (let i = 0; i < bays; i++) {
    const xa = bayX(i) + (i === 0 ? outer : bar / 2), xb = bayX(i + 1) - (i === bays - 1 ? outer : bar / 2);
    for (const [ya, yb] of rows) {
      if (isDoor(i) && ya < (tY ?? inner1)) continue;
      glass.add(planeGeo(xb - xa, yb - ya), M.glass(), V((xa + xb) / 2, (ya + yb) / 2, fz));
    }
  }
  const g = frame.build({ name: 'glazing' });
  const pane = glass.build({ name: 'glazing-glass', castShadow: false, receiveShadow: false });
  // nothing is targeted through the glass (world-actions: occluders): the loungers outside are not seats from in here
  pane.traverse((o) => { if (o.isMesh) { o.userData.noAO = true; o.userData.occluder = true; } });
  // (its back faces and its front faces as two meshes: two-sided.js)
  g.add(twoSidedAll(pane));
  g.userData.footprint = null;
  g.userData.height = h;
  g.userData.glassPanes = pane;
  return g;
}

/**
 * The pair of glazed steel doors in the glass front (same local frame as glazing(), the floor at y = 0): each leaf
 * has a steel kick panel as high as the parapet beside it, one pane above and a bar handle, and swings on its hinge at
 * the door post, outwards or inwards: world.js turns the hinges (userData.door), puts the hinge on the face the leaf
 * swings to (userData.hinge) and moves the colliders with the leaves.
 */
export function glassDoor({ w = 3.16, h = 2.5, reveal = 0.35 } = {}) {
  const steel = M.blackMetal(), brass = M.brass();
  const g = new THREE.Group(); g.name = 'glassdoor';
  const fz = -Math.min(0.12, reveal * 0.4), fd = 0.08;
  // an oak threshold across the wall opening, flush with the deck outside
  const sill = new Parts();
  sill.add(boxGeoUV(w, 0.012, reveal, 0.5), M.wood('oak'), V(0, 0.006, -reveal / 2));
  g.add(sill.build({ name: 'threshold' }));
  const post = 0.025, gap = 0.004, lw = w / 2 - post - gap, t = 0.045;
  const kick = GLASS_KICK, stile = 0.055, rail = 0.055, y0 = 0.014, y1 = h - 0.006;
  const leaves = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    // hinge on the outer face of the frame, at the inner edge of the door post
    pivot.position.set(s * (w / 2 - post), 0, fz - fd / 2);
    const p = new Parts(), gl = new Parts();
    const dir = -s;                                        // the leaf runs from the hinge towards the middle
    const cx = dir * lw / 2, zc = t / 2;
    p.add(boxGeo(stile, y1 - y0, t), steel, V(dir * stile / 2, (y0 + y1) / 2, zc));
    p.add(boxGeo(stile, y1 - y0, t), steel, V(dir * (lw - stile / 2), (y0 + y1) / 2, zc));
    p.add(boxGeo(lw, rail, t), steel, V(cx, y1 - rail / 2, zc));
    p.add(boxGeo(lw, kick - y0, t), steel, V(cx, (y0 + kick) / 2, zc));             // kick panel
    gl.add(planeGeo(lw - stile * 2, y1 - rail - kick), M.glass(), V(cx, (kick + y1 - rail) / 2, zc));
    // bar handles on both faces near the meeting stiles
    for (const f of [-1, 1]) {
      p.add(cylGeo(0.011, 0.011, 0.42, 10), brass, V(dir * (lw - 0.1), 1.08, zc + f * (t / 2 + 0.045)));
      for (const y of [0.9, 1.26]) p.add(cylGeo(0.007, 0.007, 0.045, 8), brass, V(dir * (lw - 0.1), y, zc + f * (t / 2 + 0.0225)), [Math.PI / 2, 0, 0]);
    }
    const leaf = p.build({ name: 'door-leaf' });
    const pane = gl.build({ name: 'door-glass', castShadow: false, receiveShadow: false });
    pane.traverse((o) => { if (o.isMesh) { o.userData.noAO = true; o.userData.occluder = true; } });
    leaf.add(twoSidedAll(pane));
    pivot.add(leaf);
    pivot.userData.dynamic = true;
    pivot.userData.far = [dir * lw, 0, zc];                // the leaf's free edge, for the colliders of the open door
    pivot.userData.sign = -s;                              // rotation.y = sign × angle swings it outwards (local −z)
    // the hinge on the outer face (swinging out) or on the inner face (swinging in), the leaf in the same place when shut
    pivot.userData.hinge = { out: [pivot.position.z, 0], in: [pivot.position.z + t, -t] };
    g.add(pivot); leaves.push(pivot);
  }
  g.userData.door = { leaves, w, h, angle: 1.62 };
  g.userData.footprint = null;
  return g;
}
/** Height of the doors' kick panels: level with the parapet, sill and frame of the fixed panes beside them. */
const GLASS_KICK = 0.45 + 0.03 + 0.07;

/** A teak lounger with a raised back and a linen cushion, facing local +z (the feet). */
export function lounger({ seed = 1 } = {}) {
  const wood = M.wood('ash', { contrast: 0.5, seed: 11, tint: 0xd8cfc2 }), fab = M.fabric('#e9e2d4', 40);
  const p = new Parts();
  const L2 = 1.95, W = 0.66, H = 0.3;
  // frame: two side rails, slats, legs
  for (const s of [-1, 1]) p.add(boxGeoUV(0.045, 0.07, L2, 0.5), wood, V(s * (W / 2 - 0.022), H - 0.035, 0));
  for (let i = 0; i < 12; i++) p.add(boxGeoUV(W - 0.09, 0.018, 0.075, 0.5), wood, V(0, H - 0.012, 0.95 - 0.15 - i * 0.09));
  for (const s of [-1, 1]) for (const z of [-0.85, 0.85]) p.add(boxGeoUV(0.05, H - 0.02, 0.05, 0.5), wood, V(s * (W / 2 - 0.03), (H - 0.02) / 2, z));
  // the raised back rest: a slatted board at 50°, propped on a bar
  const back = new THREE.Matrix4().compose(new THREE.Vector3(0, H + 0.24, -0.62), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.87, 0, 0)), new THREE.Vector3(1, 1, 1));
  const put = (geo, mat, pos, rot = [0, 0, 0]) => p.addMatrix(geo, mat, back.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1))));
  for (const s of [-1, 1]) put(boxGeoUV(0.04, 0.72, 0.035, 0.5), wood, [s * (W / 2 - 0.05), 0, -0.02]);
  for (let i = 0; i < 7; i++) put(boxGeoUV(W - 0.12, 0.07, 0.016, 0.5), wood, [0, -0.3 + i * 0.1, 0]);
  put(rboxGeo(W - 0.1, 0.62, 0.06, 0.025, 2), fab, [0, 0.02, 0.045]);
  put(rboxGeo(0.36, 0.2, 0.1, 0.04, 2), M.fabric('#c9a86a', 44), [0, 0.25, 0.12]);   // head cushion
  p.add(rboxGeo(W - 0.08, 0.06, 1.18, 0.025, 2), fab, V(0, H + 0.03, 0.34));
  const g = p.build({ name: 'lounger' });
  g.userData.footprint = { w: W + 0.04, d: L2, h: 0.75 };
  g.userData.tops = [top(W + 0.04, [-0.25, L2 / 2], H + 0.06), top(W + 0.04, [-L2 / 2, -0.25], 0.75, false)];   // the cushion; the back rest
  // lying back, looking out over the garden (world.js takes `pitch` from here)
  g.userData.seat = { eye: [0, 0.96, -0.7], look: [0, 1.06, 1.6], kind: 'lounger', pitch: 0.03 };
  return g;
}

/** A long planter of weathered steel with ornamental grass and lavender (nature.js: they sway, snow settles on them). */
export function planter({ w = 1.6, seed = 1 } = {}) {
  const corten = M.plain(0x7a4a33, { roughness: 0.85, metalness: 0.2 });
  const p = new Parts();
  const d = 0.42, h = 0.46, t = 0.02;
  for (const s of [-1, 1]) { p.add(boxGeo(w, h, t), corten, V(0, h / 2, s * (d / 2 - t / 2))); p.add(boxGeo(t, h, d - 2 * t), corten, V(s * (w / 2 - t / 2), h / 2, 0)); }
  p.add(boxGeo(w - 2 * t, 0.02, d - 2 * t), M.plain(0x2e2318, { roughness: 1 }), V(0, h - 0.05, 0));   // soil
  const g = p.build({ name: 'planter' });
  g.add(plantingFor(w - 0.1, d - 0.08, h - 0.05, seed));
  g.userData.footprint = { w, d, h };
  g.userData.tops = [top(w, [-d / 2, d / 2], h)];
  return g;
}

export function doubleDoor({ w = 2.2, h = 3, wood = 'oak' } = {}) {
  // oak frame with panels in the sage of the wainscot (dark walnut panels were the last old-fashioned brown)
  const wm = M.wood(wood, { along: 'y' }), dark = M.paint('#a9b6a0');
  const p = new Parts();
  p.add(boxGeoUV(0.12, h, 0.24, 0.5), wm, V(-w / 2 - 0.06, h / 2, 0)); p.add(boxGeoUV(0.12, h, 0.24, 0.5), wm, V(w / 2 + 0.06, h / 2, 0)); p.add(boxGeoUV(w + 0.24, 0.14, 0.24, 0.5), wm, V(0, h + 0.07, 0));
  for (const s of [-1, 1]) {
    const cx = s * w / 4;
    p.add(boxGeoUV(w / 2 - 0.02, h - 0.04, 0.06, 0.5), wm, V(cx, h / 2, 0));
    for (let i = 0; i < 3; i++) p.add(boxGeoUV(w / 2 - 0.26, (h - 0.5) / 3 - 0.12, 0.02, 0.5), dark, V(cx, 0.35 + ((h - 0.5) / 3) * (i + 0.5), 0.04));
    p.add(cylGeo(0.02, 0.02, 0.16, 8), M.blackMetal(), V(cx - s * 0.16, 1.05, 0.08), [Math.PI / 2, 0, 0]);
  }
  const g = p.build({ name: 'door' });
  g.userData.footprint = { w: w + 0.3, d: 0.3, h };
  return g;
}
export function fireplace({ w = 2.6, ceiling = 4.7 } = {}) {
  // limewashed brick, a pale stone hearth and an oak mantel: warm, but no longer dark red and brown
  const brick = M.brick('white'), stone = M.marble('#e7e2d8', '#b5ada0'), wm = M.wood('oak');
  const p = new Parts();
  const d = 0.7, h = 1.5;
  const ow = w * 0.5, oh = 0.95;
  p.add(boxGeoUV((w - ow) / 2, h, d, 0.7), brick, V(-(ow / 2 + (w - ow) / 4), h / 2, 0));
  p.add(boxGeoUV((w - ow) / 2, h, d, 0.7), brick, V((ow / 2 + (w - ow) / 4), h / 2, 0));
  p.add(boxGeoUV(ow, h - oh - 0.05, d, 0.7), brick, V(0, oh + 0.05 + (h - oh - 0.05) / 2, 0));
  p.add(boxGeoUV(ow, 0.05, d, 0.7), brick, V(0, 0.025, 0));
  p.add(boxGeo(ow, oh, 0.08), M.plain(0x120a06, { roughness: 1 }), V(0, oh / 2, -d / 2 + 0.04)); // firebox back
  p.add(boxGeo(0.08, oh, d), M.plain(0x1a0f09, { roughness: 1 }), V(-ow / 2 + 0.04, oh / 2, 0)); p.add(boxGeo(0.08, oh, d), M.plain(0x1a0f09, { roughness: 1 }), V(ow / 2 - 0.04, oh / 2, 0));
  p.add(boxGeoUV(w + 0.4, 0.12, d + 0.3, 0.5), wm, V(0, h + 0.06, 0.1)); // mantel
  p.add(boxGeoUV(w + 0.2, 0.06, d + 0.2, 0.6), stone, V(0, h + 0.15, 0.08));
  p.add(boxGeoUV(w + 0.6, 0.06, d + 0.8, 0.6), stone, V(0, 0.03, 0.3)); // hearth
  const breast = Math.max(1, ceiling - h);   // the chimney breast runs up to the ceiling
  p.add(boxGeoUV(w * 0.7, breast, d * 0.6, 0.7), brick, V(0, h + breast / 2, -d * 0.2));
  const g = p.build({ name: 'fireplace' });
  const grate = new Parts();
  for (let i = -3; i <= 3; i++) grate.add(cylGeo(0.012, 0.012, d * 0.5, 6), M.iron(), V(i * 0.1, 0.16, 0.12), [Math.PI / 2, 0, 0]);
  const logs = new Parts();
  logs.add(cylGeo(0.07, 0.08, 0.7, 10), M.wood('ebony'), V(-0.05, 0.25, 0.14), [0, 0, Math.PI / 2 - 0.1]);
  logs.add(cylGeo(0.06, 0.07, 0.6, 10), M.wood('walnut'), V(0.08, 0.33, 0.1), [0.3, 0, Math.PI / 2 + 0.2]);
  logs.add(cylGeo(0.05, 0.06, 0.5, 10), M.wood('ebony'), V(-0.02, 0.38, 0.2), [0, 0, Math.PI / 2 - 0.4]);
  g.add(grate.build(), logs.build());
  g.userData.footprint = { w: w + 0.6, d: d + 0.6, h: 2 };
  g.userData.fireAnchor = [0, 0.3, 0.12];
  return g;
}

/** A rug: a thin slab with a bevelled edge so it reads as pile rather than a decal. */
export function rug({ w = 3.5, d = 2.4, seed = 10, palette, style = 'persian' } = {}) {
  const m = M.rug(seed, palette, style, d / w);
  const g = new THREE.Group(); g.name = 'rug';
  const top = new THREE.Mesh(planeGeo(w, d), m);
  top.rotation.x = -Math.PI / 2; top.position.y = 0.014; top.receiveShadow = true; top.castShadow = false;
  g.add(top);
  const edge = new THREE.Mesh(boxGeo(w, 0.013, d), M.plain(0x4a3527, { roughness: 1 }));
  edge.position.y = 0.007; edge.receiveShadow = true; edge.castShadow = false;
  g.add(edge);
  g.userData.footprint = null;
  return g;
}

// ---- plants --------------------------------------------------------------------------------------
/** A pointed-oval leaf blade, curved downwards along its length. */
function leafGeometry(len, wid, { curve = 0.3, segments = 6 } = {}) {
  const pos = [], idx = [], uvs = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // width profile: narrow at the base, widest at 40 %, pointed at the tip
    const wprof = Math.sin(Math.pow(t, 0.7) * Math.PI) * (1 - t * 0.25);
    const y = t * len;
    const z = -Math.pow(t, 2) * curve * len;
    pos.push(-wid / 2 * wprof, y, z, wid / 2 * wprof, y, z);
    uvs.push(0, t, 1, t);
    if (i < segments) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A potted plant. All the foliage is merged per material by Parts, so a plant costs two or three
 * geometries instead of the ~700 it would take with one mesh per leaflet.
 */
export function plant({ kind = 'palm', seed = 1 } = {}) {
  const rnd = seeded(seed);
  const p = new Parts();
  // terracotta pot with a rim and a saucer
  const terra = M.plain(0xa15b3a, { roughness: 0.92 });
  p.add(cylGeo(0.185, 0.145, 0.34, 20), terra, V(0, 0.17, 0));
  p.add(cylGeo(0.205, 0.195, 0.045, 20), terra, V(0, 0.355, 0));
  p.add(cylGeo(0.22, 0.2, 0.02, 20), M.plain(0x8e4f32, { roughness: 0.95 }), V(0, 0.01, 0));
  p.add(cylGeo(0.175, 0.175, 0.02, 18), M.plain(0x2e2318, { roughness: 1 }), V(0, 0.355, 0)); // soil

  const dark = M.leaf(0x2c5a2c), mid = M.leaf(0x3d7a34), light = M.leaf(0x4f8f3e);
  const stemM = M.plain(0x6b5236, { roughness: 0.85 });

  /** A pinnate frond: a rachis with many small leaflets, merged into the part collector. */
  const frond = (base, yaw, pitchA, len, mat, leaflets, width) => {
    // build the frond in its own local frame, then transform every piece into the plant's frame
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchA, yaw, 0, 'YXZ'));
    const m = new THREE.Matrix4().compose(base, q, new THREE.Vector3(1, 1, 1));
    const put = (geo, material, pos, rot) => {
      const local = new THREE.Matrix4().compose(
        new THREE.Vector3(...pos),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
        new THREE.Vector3(1, 1, 1),
      );
      p.addMatrix(geo, material, new THREE.Matrix4().multiplyMatrices(m, local));
    };
    put(cylGeo(0.004, 0.009, len, 5), stemM, [0, len / 2, 0], [0, 0, 0]);
    for (let i = 1; i <= leaflets; i++) {
      const t = i / (leaflets + 1);
      const l = width * (2.6 - Math.abs(t - 0.45) * 2.4);
      for (const s2 of [-1, 1]) {
        put(leafGeometry(l, l * 0.34, { curve: 0.22, segments: 3 }), mat, [0, t * len, 0], [-0.25 - rnd() * 0.2, 0, s2 * (1.15 + rnd() * 0.25)]);
      }
    }
  };

  if (kind === 'fern') {
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 * 3 + rnd() * 0.4;
      frond(new THREE.Vector3(Math.cos(a) * 0.045, 0.37, Math.sin(a) * 0.045), -a, 0.55 + rnd() * 0.35, 0.40 + rnd() * 0.26, i % 3 === 0 ? dark : mid, 14, 0.05);
    }
  } else if (kind === 'palm') {
    p.add(cylGeo(0.035, 0.055, 0.55, 10), M.plain(0x7a5c3a, { roughness: 0.9 }), V(0, 0.37 + 0.275, 0));
    for (let i = 0; i < 15; i++) {
      const a = (i / 15) * Math.PI * 2 * 2 + rnd() * 0.3;
      frond(new THREE.Vector3(Math.cos(a) * 0.03, 0.9, Math.sin(a) * 0.03), -a, 0.8 + rnd() * 0.4, 0.58 + rnd() * 0.3, i % 2 ? mid : dark, 20, 0.075);
    }
  } else { // ficus / rubber plant: a woody stem with big glossy leaves
    p.add(cylGeo(0.018, 0.035, 0.85, 8), stemM, V(0, 0.37 + 0.425, 0));
    for (const [bx, by, ba] of [[0.1, 0.72, 0.5], [-0.09, 0.9, -0.6], [0.05, 1.05, 0.25]]) {
      p.add(cylGeo(0.01, 0.016, 0.3, 6), stemM, V(bx * 0.5, 0.37 + by, 0), [0, 0, -ba]);
    }
    for (let i = 0; i < 54; i++) {
      const t = i / 54;
      const a = i * 2.399;                    // golden-angle phyllotaxis
      const y = 0.37 + 0.35 + t * 0.85;
      const r = 0.06 + (1 - Math.abs(t - 0.5) * 1.15) * 0.17;
      const len = 0.17 + rnd() * 0.11;
      p.add(leafGeometry(len, len * 0.62, { curve: 0.25, segments: 5 }),
        i % 3 === 0 ? dark : (i % 3 === 1 ? mid : light),
        V(Math.cos(a) * r, y, Math.sin(a) * r),
        [-0.5 - rnd() * 0.5, -a + Math.PI / 2, (rnd() - 0.5) * 0.3]);
    }
  }
  const g = p.build({ name: 'plant' });
  g.userData.footprint = { w: 0.46, d: 0.46, h: kind === 'fern' ? 0.9 : 1.5 };
  return g;
}

export function ladder({ h = 2.4 } = {}) {
  const wm = M.wood('oak');
  const p = new Parts();
  p.add(boxGeoUV(0.05, h, 0.04, 0.5), wm, V(-0.22, h / 2, 0)); p.add(boxGeoUV(0.05, h, 0.04, 0.5), wm, V(0.22, h / 2, 0));
  for (let i = 0; i < 7; i++) p.add(cylGeo(0.015, 0.015, 0.44, 8), wm, V(0, 0.25 + i * (h - 0.5) / 6, 0), [0, 0, Math.PI / 2]);
  const g = p.build({ name: 'ladder' }); g.rotation.x = -0.14;
  const wrap = new THREE.Group(); wrap.add(g); wrap.userData.footprint = { w: 0.5, d: 0.5, h }; return wrap;
}
/** A picture in a slim oak frame with a white mount. The picture glows a little (world.js keeps its
 *  emissiveMap on the image): wall lights have no real light any more, and a gallery picture should read as lit. */
export function paintingFrame({ w = 1.2, h = 0.9, texture = null } = {}) {
  const fm = M.wood('oak', { contrast: 0.6 });
  const p = new Parts();
  const t = 0.045, mount = Math.min(0.08, Math.min(w, h) * 0.08);
  p.add(boxGeo(w + t * 2, t, 0.045), fm, V(0, h / 2 + t / 2, 0)); p.add(boxGeo(w + t * 2, t, 0.045), fm, V(0, -h / 2 - t / 2, 0));
  p.add(boxGeo(t, h, 0.045), fm, V(-w / 2 - t / 2, 0, 0)); p.add(boxGeo(t, h, 0.045), fm, V(w / 2 + t / 2, 0, 0));
  p.add(boxGeo(w, h, 0.02), M.plain(0xf6f3ec, { roughness: 0.9 }), V(0, 0, -0.005));
  const g = p.build({ name: 'painting' });
  const canvasMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.16 });
  canvasMat.userData.disposable = true; canvasMat.userData.keepMap = true;
  const canvasMesh = new THREE.Mesh(planeGeo(w - mount * 2, h - mount * 2), canvasMat); canvasMesh.position.z = 0.0065; canvasMesh.castShadow = false; g.add(canvasMesh);
  g.userData.canvas = canvasMesh; g.userData.footprint = null; g.userData.size = { w, h };
  return g;
}
export function ceilingBeam({ len = 16, w = 0.3, h = 0.4 } = {}) { const mesh = new THREE.Mesh(boxGeoUV(len, h, w, 0.5), M.wood('oak', { contrast: 0.7 })); mesh.castShadow = true; mesh.receiveShadow = true; return mesh; }
export function column({ h = 6.5, r = 0.28 } = {}) {
  const st = M.marble('#d9d3c7', '#8c8378');
  const p = new Parts();
  p.add(cylGeo(r, r * 1.05, h - 0.6, 20), st, V(0, (h - 0.6) / 2 + 0.3, 0));
  p.add(boxGeo(r * 2.6, 0.3, r * 2.6), st, V(0, 0.15, 0)); p.add(boxGeo(r * 2.6, 0.3, r * 2.6), st, V(0, h - 0.15, 0));
  const g = p.build({ name: 'column' }); g.userData.footprint = { w: r * 2.6, d: r * 2.6, h }; return g;
}

// ---- interactive props -------------------------------------------------------------------------------
export function computerTerminal({ screenTexture = null } = {}) {
  const p = new Parts();
  const beige = M.plain(0xd9cfb7, { roughness: 0.8 });
  p.add(rboxGeo(0.44, 0.36, 0.38, 0.02), beige, V(0, 0.28, -0.02)); // monitor
  p.add(rboxGeo(0.5, 0.06, 0.4, 0.01), beige, V(0, 0.03, -0.02)); // base unit
  p.add(rboxGeo(0.42, 0.025, 0.16, 0.01), beige, V(0, 0.015, 0.24)); // keyboard
  const g = p.build({ name: 'computer' });
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x0b0806, emissive: 0xe8c07a, emissiveIntensity: 0.55, emissiveMap: screenTexture, roughness: 0.4 });
  screenMat.userData.disposable = true; screenMat.userData.keepMap = true;
  const screen = new THREE.Mesh(planeGeo(0.36, 0.27), screenMat);
  screen.position.set(0, 0.29, 0.171); g.add(screen);
  g.userData.lights = [];
  g.userData.screen = screen;
  g.userData.footprint = null;
  g.userData.interact = { kind: 'computer' };
  return g;
}
export function recordPlayer() {
  const p = new Parts();
  p.add(rboxGeo(0.5, 0.12, 0.42, 0.01), M.wood('oak'), V(0, 0.06, 0));
  p.add(cylGeo(0.16, 0.16, 0.01, 32), M.plain(0x151212, { roughness: 0.6 }), V(-0.04, 0.125, 0));
  p.add(cylGeo(0.006, 0.006, 0.02, 8), M.darkMetal(), V(-0.04, 0.14, 0));
  p.add(cylGeo(0.02, 0.025, 0.03, 12), M.darkMetal(), V(0.19, 0.135, -0.14));
  const g = p.build({ name: 'recordplayer' });
  const disc = new THREE.Mesh(cylGeo(0.15, 0.15, 0.004, 40), M.plain(0x0d0b0b, { roughness: 0.35, metalness: 0.1 })); disc.position.set(-0.04, 0.132, 0); g.add(disc);
  const label = new THREE.Mesh(cylGeo(0.05, 0.05, 0.005, 24), M.plain(0xc9a35a)); label.position.set(-0.04, 0.133, 0); g.add(label);
  const arm = new THREE.Mesh(cylGeo(0.006, 0.006, 0.22, 8), M.darkMetal()); arm.position.set(0.1, 0.16, -0.06); arm.rotation.z = Math.PI / 2; arm.rotation.y = 0.6; g.add(arm);
  for (const o of [disc, label, arm]) o.userData.dynamic = true;
  g.userData.disc = disc; g.userData.label = label; g.userData.arm = arm;
  g.userData.footprint = null; g.userData.interact = { kind: 'records' };
  return g;
}
export function radio() {
  const p = new Parts();
  p.add(rboxGeo(0.46, 0.26, 0.2, 0.02), M.wood('cherry'), V(0, 0.13, 0));
  p.add(boxGeo(0.22, 0.16, 0.01), M.fabric('#c9b48a', 9), V(-0.08, 0.14, 0.1));
  p.add(cylGeo(0.03, 0.03, 0.02, 16), M.brass(), V(0.14, 0.09, 0.1), [Math.PI / 2, 0, 0]);
  p.add(cylGeo(0.03, 0.03, 0.02, 16), M.brass(), V(0.14, 0.19, 0.1), [Math.PI / 2, 0, 0]);
  const g = p.build({ name: 'radio' });
  const dial = new THREE.Mesh(planeGeo(0.12, 0.05), M.plain(0xf3d9a4, { emissive: 0xffc46b, emissiveIntensity: 0.5 }));
  dial.position.set(0.01, 0.235, 0.101); dial.scale.set(0.6, 0.5, 1); g.add(dial);
  g.userData.footprint = null; g.userData.interact = { kind: 'podcasts' };
  return g;
}
/**
 * The easel of the watercolour studio: an A-frame studio easel. Two front legs stand apart on the floor and meet at a
 * head piece at the top, a mast runs up their middle and on above the head, a rear leg hinged behind the head reaches
 * the floor behind, a spreader bar holds it at the mast. The front frame leans back by `lean`; the canvas stands on a
 * ledge fixed to the mast and leans against the mast, a clamp on the mast holds its top edge. (Up to 0.7 the legs met at
 * the floor and spread upwards, and the canvas hung forward in the air.) Local frame: x across, y up, the front towards
 * +z, the footprint centred on the origin: the collider is a box round it (world.js).
 */
export const EASEL = { lean: 0.21, footX: 0.3, frontZ: 0.335, rearZ: -0.335, apex: 1.72, mastTop: 2.0, ledgeY: 0.86, canvas: [0.66, 0.52, 0.03] };
export function easel({ canvasTexture = null } = {}) {
  const E = EASEL, ca = Math.cos(E.lean), sa = Math.sin(E.lean);
  // the grain along every piece (each one is built along its own y axis); the same material as the audiobook cabinet
  const wood = M.wood('oak', { along: 'y', contrast: 0.5, grainScale: 1.7 });
  const metal = M.blackMetal(), brass = M.brass();
  /** A point of the front frame: `u` metres up along it from the floor line of the front feet, `n` metres in front of
   *  its middle plane, `x` across. */
  const F = (x, u, n = 0) => new THREE.Vector3(x, u * ca + n * sa, E.frontZ - u * sa + n * ca);
  const X = new THREE.Vector3(1, 0, 0), UP = new THREE.Vector3(0, ca, -sa), Z = new THREE.Vector3(0, 0, 1);
  const p = new Parts();
  /** A piece from a to b, `w` thick towards `side` and `d` the other way (its grain along it). */
  const strut = (a, b, w, d, side = X, mat = wood) => {
    const dir = b.clone().sub(a), len = dir.length(); dir.normalize();
    const x = side.clone().addScaledVector(dir, -side.dot(dir)).normalize(), z = new THREE.Vector3().crossVectors(x, dir);
    p.addMatrix(boxGeoUV(w, len, d, 0.4), mat, new THREE.Matrix4().makeBasis(x, dir, z).setPosition(a.clone().add(b).multiplyScalar(0.5)));
  };
  /** A box in the leaning frame, its middle at F(x, u, n). */
  const inFrame = (geo, mat, x, u, n) => p.addMatrix(geo, mat, new THREE.Matrix4().makeRotationX(-E.lean).setPosition(F(x, u, n)));
  const cap = (x, z) => p.add(boxGeo(0.06, 0.012, 0.06), metal, V(x, 0.006, z));   // a cap under every foot
  /** A brass wing nut on the back of the mast at `at`. */
  const wingNut = (at) => {
    p.add(cylGeo(0.016, 0.016, 0.022, 14), brass, V(at.x, at.y, at.z - 0.011), [Math.PI / 2, 0, 0]);
    p.add(boxGeo(0.055, 0.012, 0.006), brass, V(at.x, at.y, at.z - 0.025));
  };

  // --- the front frame: two legs from the feet to the head, a brace low between them, the mast up the middle ----------
  const u0 = 0.02 / ca;                                                       // the legs' ends sit on their caps
  for (const s of [-1, 1]) {
    strut(F(s * E.footX, u0), F(s * 0.032, E.apex), 0.045, 0.04);
    const f = F(s * E.footX, 0); cap(f.x, f.z);
  }
  const braceU = 0.3 / ca, braceX = E.footX - (E.footX - 0.032) * (braceU - u0) / (E.apex - u0);
  strut(F(-braceX - 0.012, braceU), F(braceX + 0.012, braceU), 0.04, 0.03, UP);
  const MAST_N = 0.008, MAST_D = 0.045;                                      // the mast stands a little in front of the legs
  strut(F(0, braceU, MAST_N), F(0, E.mastTop, MAST_N), 0.05, MAST_D);
  inFrame(boxGeoUV(0.15, 0.09, 0.055, 0.4), wood, 0, E.apex - 0.02, 0);      // the head, where the legs meet the mast
  // --- the rear leg: hinged behind the head, down to the floor behind; the spreader bar holds it at the mast ---------
  const hinge = F(0, E.apex - 0.065, -0.048), foot = new THREE.Vector3(0, 0.016, E.rearZ + 0.005);
  strut(foot, hinge, 0.045, 0.04);
  cap(0, E.rearZ);
  const pin = F(0, E.apex - 0.055, -0.04);
  p.add(cylGeo(0.011, 0.011, 0.085, 12), brass, V(pin.x, pin.y, pin.z), [0, 0, Math.PI / 2]);   // the hinge pin, across
  const spreadY = 0.62, backN = MAST_N - MAST_D / 2;
  const mastBack = F(0, (spreadY - backN * sa) / ca, backN), legAt = foot.clone().lerp(hinge, (spreadY - foot.y) / (hinge.y - foot.y));
  strut(new THREE.Vector3(0, spreadY, mastBack.z + 0.004), new THREE.Vector3(0, spreadY, legAt.z), 0.025, 0.035);
  // --- the ledge the canvas stands on: a board across the mast with a lip at its front, a bracket below --------------
  const [cw, ch, cd] = E.canvas, nBack = MAST_N + MAST_D / 2;                // the canvas leans on the mast's front face
  const sb = (E.ledgeY - nBack * sa) / ca;                                    // its lower back edge stands on the ledge
  const back = F(0, sb, nBack).z - 0.005, depth = 0.085, ly = E.ledgeY - 0.011;
  strut(new THREE.Vector3(-0.4, ly, back + depth / 2), new THREE.Vector3(0.4, ly, back + depth / 2), depth, 0.022, Z);
  strut(new THREE.Vector3(-0.4, E.ledgeY + 0.012, back + depth - 0.006), new THREE.Vector3(0.4, E.ledgeY + 0.012, back + depth - 0.006), 0.012, 0.046, Z);
  const below = F(0, (E.ledgeY - 0.06 - backN * sa) / ca, backN);
  p.add(boxGeoUV(0.075, 0.07, back + 0.02 - below.z, 0.4), wood, V(0, E.ledgeY - 0.057, (below.z + back + 0.02) / 2));
  wingNut(F(0, (E.ledgeY - 0.055 - backN * sa) / ca, backN));
  // --- the clamp on the mast over the canvas' top edge: a collar, an arm forwards, a lip down in front ---------------
  const top = sb + ch;
  inFrame(boxGeoUV(0.085, 0.07, 0.075, 0.4), wood, 0, top + 0.047, MAST_N);
  inFrame(boxGeoUV(0.07, 0.024, cd + 0.018, 0.4), wood, 0, top + 0.012, nBack + (cd + 0.018) / 2);
  inFrame(boxGeoUV(0.07, 0.06, 0.012, 0.4), wood, 0, top - 0.006, nBack + cd + 0.012);
  wingNut(F(0, top + 0.047, MAST_N - 0.0375));
  const g = new THREE.Group(); g.name = 'easel';
  g.add(p.build({ name: 'easelframe' }));

  // --- the canvas: primed cotton over a pine stretcher, the picture on its front ------------------------------------
  const pic = new THREE.Group(); pic.name = 'easel-canvas';
  const white = M.plain(0xf3eee0, { roughness: 0.95 }), raw = M.plain(0xd9ceb6, { roughness: 0.95 }), pine = M.wood('pine');
  const c = new Parts();
  c.add(boxGeo(cw, ch, 0.003), white, V(0, 0, cd / 2 - 0.0015));                         // the primed front
  c.add(boxGeo(cw - 0.006, ch - 0.006, 0.002), raw, V(0, 0, cd / 2 - 0.004));             // its raw back, seen between the bars
  for (const s of [-1, 1]) {
    c.add(boxGeo(cw, 0.003, cd), white, V(0, s * (ch / 2 - 0.0015), 0));                   // the cotton wrapped round the bars
    c.add(boxGeo(0.003, ch, cd), white, V(s * (cw / 2 - 0.0015), 0, 0));
    c.add(boxGeo(cw - 0.006, 0.042, cd - 0.005), pine, V(0, s * (ch / 2 - 0.024), -0.0025));
    c.add(boxGeo(0.042, ch - 0.09, cd - 0.005), pine, V(s * (cw / 2 - 0.024), 0, -0.0025));
  }
  pic.add(c.build({ name: 'canvas' }));
  const paintMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, map: canvasTexture });
  paintMat.userData.disposable = true; paintMat.userData.keepMap = true;
  const paint = new THREE.Mesh(planeGeo(cw - 0.004, ch - 0.004), paintMat);
  paint.position.z = cd / 2 + 0.0004; paint.receiveShadow = true; pic.add(paint);
  pic.position.copy(F(0, sb + ch / 2, nBack + cd / 2)); pic.rotation.x = -E.lean;
  g.add(pic);
  g.userData.canvas = paint;
  g.userData.footprint = { w: 0.82, d: 0.73, h: E.mastTop * ca + 0.02 }; g.userData.interact = { kind: 'watercolor' };
  g.userData.shadowFootprint = { w: 0.62, d: 0.62 };   // the soft patch on the floor under the three feet
  return g;
}
/** The reading board of both lecterns, the encyclopedia's and the e-reader's: the middle of the board `y` above the
 *  floor, sloping by `tilt` towards the reader (positive: the front (+z) edge is the low one). */
export const LECTERN_TOP = { y: 1.07, tilt: 0.33 };
/** Encyclopedia lectern. The reading board slopes DOWN towards the reader (local +z), with a ledge along
 *  its lower front edge, and an open book lies on it. (It used to be tilted the other way round: the front
 *  edge high, the book facing the wall.) */
export function lectern() {
  const wm = M.wood('oak');
  const p = new Parts();
  p.add(cylGeo(0.2, 0.24, 0.035, 28), wm, V(0, 0.0175, 0));
  p.add(cylGeo(0.045, 0.06, 1.0, 16), wm, V(0, 0.52, 0));
  const top = new THREE.Group(); top.position.set(0, LECTERN_TOP.y, 0); top.rotation.x = LECTERN_TOP.tilt;
  top.name = 'lectern-board';
  const tp = new Parts();
  tp.add(boxGeoUV(0.64, 0.035, 0.5, 0.4), wm, V(0, 0, 0));
  tp.add(boxGeoUV(0.26, 0.05, 0.18, 0.4), wm, V(0, -0.0425, 0));      // support block, the stem ends inside it
  tp.add(boxGeoUV(0.64, 0.045, 0.03, 0.4), wm, V(0, 0.035, 0.235));   // ledge that holds the book
  top.add(tp.build({ name: 'lectern-top' }));
  // the open book: two page blocks rising gently towards the spine, a cloth cover underneath
  const book = new THREE.Group(); book.position.set(0, 0.0175, -0.01); top.add(book);
  const cloth = M.fabric('#3f6f6d', 12);
  const cover = new THREE.Mesh(boxGeo(0.58, 0.012, 0.4), cloth); cover.position.y = 0.006; book.add(cover);
  const pageTex = lecternPageTexture();
  const pageMat = new THREE.MeshStandardMaterial({ map: pageTex, roughness: 0.9 }); pageMat.userData.keepMap = true;
  for (const s of [-1, 1]) {
    const block = new THREE.Mesh(boxGeo(0.27, 0.03, 0.37), M.paper()); block.position.set(s * 0.14, 0.027, 0); block.rotation.z = s * 0.06; book.add(block);
    // Euler XYZ: after the -90° turn about x, the page's local y is the book's -z, so -s tilts it like the block
    const page = new THREE.Mesh(planeGeo(0.26, 0.36), pageMat); page.rotation.x = -Math.PI / 2; page.rotation.y = -s * 0.06;
    page.position.set(s * 0.14, 0.0435, 0); page.geometry = page.geometry.clone(); flipUvX(page.geometry, s < 0); book.add(page);
  }
  book.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const g = p.build({ name: 'lectern' }); g.add(top);
  g.userData.footprint = { w: 0.6, d: 0.6, h: 1.3 }; g.userData.interact = { kind: 'wiki' };
  return g;
}
/** Left and right page of the encyclopedia: the left half of the texture on the left page and so on. */
function flipUvX(geo, left) { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, left ? uv.getX(i) * 0.5 : 0.5 + uv.getX(i) * 0.5); uv.needsUpdate = true; }
let lecternTex = null;
function lecternPageTexture() {
  if (lecternTex) return lecternTex;
  const W = 1024, H = 720, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#f7f3ea'; g.fillRect(0, 0, W, H);
  const gutter = g.createLinearGradient(W / 2 - 40, 0, W / 2 + 40, 0);
  gutter.addColorStop(0, 'rgba(0,0,0,0)'); gutter.addColorStop(0.5, 'rgba(60,50,40,0.18)'); gutter.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gutter; g.fillRect(W / 2 - 40, 0, 80, H);
  const rnd = seeded(91);
  for (const [x0, head] of [[56, 'Bibliothek'], [W / 2 + 40, 'Lexikon']]) {
    g.fillStyle = '#2b2b2b'; g.font = '600 34px "Cormorant Garamond", Georgia, serif'; g.fillText(head, x0, 70);
    g.fillStyle = '#9aa59a'; g.fillRect(x0, 86, 150, 3);
    let y = 120;
    for (let para = 0; para < 5; para++) {
      const lines = 3 + Math.floor(rnd() * 4);
      for (let i = 0; i < lines && y < H - 50; i++) { const w = i === lines - 1 ? 120 + rnd() * 200 : W / 2 - 120 - rnd() * 20; g.fillStyle = 'rgba(50,50,50,0.55)'; g.fillRect(x0, y, w, 7); y += 19; }
      y += 16;
    }
  }
  lecternTex = new THREE.CanvasTexture(c); lecternTex.colorSpace = THREE.SRGBColorSpace; lecternTex.anisotropy = 8;
  return lecternTex;
}
/** The papers on the rack: those of the interface language, as in the newspaper (0.7, ui/news/news-lang.js). */
const RACK_PAPERS = {
  de: ['tagesschau', 'DIE ZEIT', 'Süddeutsche Zeitung', 'FAZ', 'DER SPIEGEL', 'Spektrum', 'heise online', 'Deutschlandfunk', 'Monopol'],
  en: ['The Guardian', 'BBC News', 'The New York Times', 'NPR', 'Quanta Magazine', 'The Atlantic', 'The New Yorker', 'Aeon', 'Smithsonian'],
};
const NEWS_CW = 384, NEWS_CH = 520;
/** Draw the nine front pages into the atlas canvas (3 × 3 cells, row 0 at the top). */
function drawNewsAtlas(c, titles, lang) {
  const g = c.getContext('2d');
  for (let cell = 0; cell < 9; cell++) {
    const t = titles[cell % Math.max(1, titles.length)] || (lang === 'en' ? 'Newspaper' : 'Zeitung');
    const page = newspaperTexture(t, { seed: cell + 1, width: NEWS_CW, height: NEWS_CH, lang }).map.image;
    g.drawImage(page, (cell % 3) * NEWS_CW, Math.floor(cell / 3) * NEWS_CH);
  }
}
/** The nine front pages of the rack in one texture (3 × 3 cells, row 0 at the top). */
let newsAtlasMat = null, newsAtlasKey = '', newsAtlasLang = null;
function newsAtlas(titles, lang = 'de') {
  const key = titles.join('|') + '|' + lang;
  if (newsAtlasMat && newsAtlasKey === key) return newsAtlasMat;
  const c = document.createElement('canvas'); c.width = NEWS_CW * 3; c.height = NEWS_CH * 3;
  drawNewsAtlas(c, titles, lang);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  newsAtlasMat?.map?.dispose(); newsAtlasMat?.dispose();
  newsAtlasMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 });
  newsAtlasKey = key;
  return newsAtlasMat;
}
/** Another interface language: the same texture is drawn again (no new material, no new shader program). */
function relabelNewsRack(lang) {
  if (!newsAtlasMat || newsAtlasLang === null || lang === newsAtlasLang) return;
  newsAtlasLang = lang;
  drawNewsAtlas(newsAtlasMat.map.image, RACK_PAPERS[lang] || RACK_PAPERS.de, lang);
  newsAtlasMat.map.needsUpdate = true;
  newsAtlasKey = '';
}
bus.on('i18n:change', relabelNewsRack);
/** Newspaper rack with real folded papers (front page texture, correct aspect ratio). */
export function newspaperRack({ titles = [] } = {}) {
  const wm = M.wood("oak");
  const H = 1.86, W = 1.1, D = 0.46;
  const SHELVES = [0.42, 0.88, 1.34];
  const TILT = 0.4;
  const p = new Parts();
  p.add(boxGeoUV(W, 0.05, D, 0.4), wm, V(0, 0.025, 0));
  p.add(boxGeoUV(0.05, H, D, 0.4), wm, V(-W / 2 + 0.025, H / 2, 0));
  p.add(boxGeoUV(0.05, H, D, 0.4), wm, V(W / 2 - 0.025, H / 2, 0));
  p.add(boxGeoUV(W, 0.05, D, 0.4), wm, V(0, H - 0.025, 0));
  p.add(boxGeoUV(W - 0.12, 0.04, 0.03, 0.4), wm, V(0, H - 0.12, D / 2 - 0.05));
  for (const y of SHELVES) {
    p.add(boxGeoUV(W - 0.12, 0.03, 0.34, 0.4), wm, V(0, y, 0), [TILT, 0, 0]);     // sloped board
    p.add(boxGeoUV(W - 0.12, 0.05, 0.02, 0.4), wm, V(0, y + 0.05, 0.16));         // retaining lip
  }
  const g = p.build({ name: "newsrack" });
  const paperEdge = M.plain(0xe7dfcd, { roughness: 0.95 });
  const rnd = seeded(5);
  const pw = 0.3, ph = 0.42;   // a folded newspaper is taller than it is wide
  // all nine front pages in one texture: nine papers with six materials each cost 54 draw calls; without titles the
  // rack shows the papers of the interface language and follows a change of it
  const lang = i18n.lang === 'en' ? 'en' : 'de';
  const atlas = newsAtlas(titles.length ? titles : RACK_PAPERS[lang], lang);
  newsAtlasLang = titles.length ? null : lang;
  const papers = new Parts();
  SHELVES.forEach((shelfY, i) => {
    for (let k = 0; k < 3; k++) {
      // the sheet stands ON the sloped board and leans back against the rack
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(-0.33 + k * 0.33, shelfY + Math.cos(TILT) * ph / 2 + 0.03, (rnd() - 0.5) * 0.015),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-TILT + (rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * 0.04)),
        new THREE.Vector3(1, 1, 1));
      papers.addMatrix(boxGeo(pw, ph, 0.012), paperEdge, m);
      const front = planeGeo(pw, ph).clone();
      const cell = i * 3 + k, cu = (cell % 3) / 3, cv = 1 - (Math.floor(cell / 3) + 1) / 3;
      const uv = front.attributes.uv; for (let n = 0; n < uv.count; n++) uv.setXY(n, cu + uv.getX(n) / 3, cv + uv.getY(n) / 3);
      papers.addMatrix(front, atlas, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.0065)));
      front.dispose();
    }
  });
  g.add(papers.build({ name: 'newspapers' }));
  const rackMat = plateMaterial('Zeitungen · Newspapers', [0.62, 0.1], { size: 36 });
  const plate = new THREE.Mesh(planeGeo(0.62, 0.1), rackMat);
  plate.position.set(0, H - 0.09, D / 2 + 0.002); g.add(plate);
  g.userData.footprint = { w: W + 0.05, d: D + 0.06, h: H }; g.userData.interact = { kind: "news" };
  return g;
}
export function returnCounter() {
  const wm = M.wood('oak');
  const p = new Parts();
  p.add(boxGeoUV(1.6, 1.0, 0.7, 0.5), wm, V(0, 0.5, 0));
  p.add(boxGeoUV(1.7, 0.06, 0.8, 0.6), M.marble('#ece8e1', '#c2baae'), V(0, 1.03, 0));
  p.add(boxGeoUV(0.5, 0.35, 0.5, 0.5), M.wood('oak'), V(0.4, 1.23, 0)); // book bin
  const g = p.build({ name: 'returncounter' });
  const plateMat = plateMaterial('Rückgabe · Returns', [0.7, 0.13], { size: 42, roughness: 1 });
  const plate = new THREE.Mesh(planeGeo(0.7, 0.13), plateMat); plate.position.set(-0.2, 0.8, 0.36); g.add(plate);
  const bell = new THREE.Mesh(sphereGeo(0.05, 12), M.brass()); bell.scale.y = 0.7; bell.position.set(-0.45, 1.1, 0.1); g.add(bell);
  g.userData.footprint = { w: 1.7, d: 0.8, h: 1.1 }; g.userData.interact = { kind: 'return' };
  g.userData.surface = { y: 1.06, w: 0.5, d: 0.4, offset: [-0.2, 0, 0] };
  return g;
}
export function basketProp() {
  const p = new Parts();
  const wicker = M.fabric('#b08a55', 11);
  p.add(new THREE.CylinderGeometry(0.22, 0.17, 0.22, 20, 1, true), wicker, V(0, 0.11, 0));
  p.add(cylGeo(0.17, 0.17, 0.01, 20), wicker, V(0, 0.005, 0));
  p.add(torusGeo(0.19, 0.012, 6, 24, Math.PI), M.wood('oak'), V(0, 0.22, 0));
  const g = p.build({ name: 'basket' }); g.userData.footprint = null; return g;
}
export function clock() {
  const p = new Parts();
  p.add(cylGeo(0.26, 0.26, 0.05, 48), M.blackMetal(), V(0, 0, 0), [Math.PI / 2, 0, 0]);
  p.add(cylGeo(0.24, 0.24, 0.02, 48), M.plain(0xf7f4ee), V(0, 0, 0.025), [Math.PI / 2, 0, 0]);
  const g = p.build({ name: 'clock' });
  const hour = new THREE.Mesh(boxGeo(0.02, 0.13, 0.01), M.plain(0x222222)); hour.position.set(0, 0.06, 0.045); const hp = new THREE.Group(); hp.add(hour); g.add(hp);
  const min = new THREE.Mesh(boxGeo(0.014, 0.19, 0.01), M.plain(0x222222)); min.position.set(0, 0.09, 0.05); const mp = new THREE.Group(); mp.add(min); g.add(mp);
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; const tick = new THREE.Mesh(boxGeo(0.01, i % 3 ? 0.02 : 0.04, 0.005), M.plain(0x333333)); tick.position.set(Math.sin(a) * 0.19, Math.cos(a) * 0.19, 0.042); tick.rotation.z = -a; g.add(tick); }
  // a slim rust-red second hand with a short tail, in front of the others, and a cap over the three pivots
  const red = M.plain(0x9c3b28, { roughness: 0.5 });
  const sec = new THREE.Mesh(boxGeo(0.005, 0.21, 0.004), red); sec.position.set(0, 0.06, 0.059); const sp = new THREE.Group(); sp.add(sec); g.add(sp);
  const cap = new THREE.Mesh(cylGeo(0.011, 0.011, 0.008, 16), red); cap.rotation.x = Math.PI / 2; cap.position.z = 0.061; g.add(cap);
  hp.userData.dynamic = true; mp.userData.dynamic = true; sp.userData.dynamic = true;   // turned every frame: not part of the static batch
  g.userData.hands = { hour: hp, min: mp, sec: sp }; g.userData.footprint = null;
  return g;
}
export function bust() {
  const p = new Parts();
  const st = M.marble('#e6e1d6', '#a29a8c');
  p.add(boxGeo(0.16, 0.06, 0.16), st, V(0, 0.03, 0));
  p.add(cylGeo(0.05, 0.07, 0.08, 10), st, V(0, 0.1, 0));
  p.add(boxGeo(0.2, 0.1, 0.1), st, V(0, 0.18, 0));
  p.add(cylGeo(0.05, 0.06, 0.06, 10), st, V(0, 0.26, 0));
  p.add(sphereGeo(0.075, 14), st, V(0, 0.34, 0), [0, 0, 0], [0.85, 1, 0.95]);
  const g = p.build({ name: 'bust' }); g.userData.footprint = null; return g;
}
export function candle() {
  const p = new Parts();
  p.add(cylGeo(0.04, 0.05, 0.02, 12), M.brass(), V(0, 0.01, 0));
  p.add(cylGeo(0.016, 0.016, 0.14, 10), M.plain(0xf1e6c8), V(0, 0.09, 0));
  const g = p.build({ name: 'candle', castShadow: false });
  const flame = new THREE.Mesh(sphereGeo(0.013, 8), M.plain(0xffe0a0, { emissive: 0xffb347, emissiveIntensity: 1.6 })); flame.position.y = 0.18; flame.scale.y = 1.7; g.add(flame);
  // a candle only glows: a real light for a 2 m halo cost as much as a floor lamp
  g.userData.lights = []; g.userData.flames = flame; g.userData.footprint = null; return g;
}

/** Card catalogue cabinet (online catalogue / "Fernleihe") */
export function cardCatalog() {
  const wm = M.wood('oak', { along: 'y' }), dark = M.wood('oak', { seed: 5, contrast: 0.7 });
  const p = new Parts();
  const w = 0.9, h = 1.4, d = 0.5;
  p.add(boxGeoUV(w, h, d, 0.5), wm, V(0, h / 2, 0));
  p.add(boxGeoUV(w + 0.06, 0.04, d + 0.06, 0.5), dark, V(0, h + 0.02, 0));
  p.add(boxGeoUV(w + 0.04, 0.08, d + 0.04, 0.5), dark, V(0, 0.04, 0));
  const cols = 3, rows = 6;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = -w / 2 + (c + 0.5) * (w / cols), y = 0.15 + (r + 0.5) * ((h - 0.2) / rows);
    p.add(boxGeoUV(w / cols - 0.04, (h - 0.2) / rows - 0.03, 0.015, 0.4), dark, V(x, y, d / 2 + 0.005));
    p.add(boxGeo(0.06, 0.02, 0.012), M.brass(), V(x, y - 0.02, d / 2 + 0.018));
    p.add(boxGeo(0.09, 0.03, 0.004), M.plain(0xf1e7cf), V(x, y + 0.035, d / 2 + 0.016));
  }
  const g = p.build({ name: 'cardcatalog' });
  const ccMat = plateMaterial('Fernleihe · Online', [0.6, 0.11], { size: 40 });
  const plate = new THREE.Mesh(planeGeo(0.6, 0.11), ccMat); plate.position.set(0, h + 0.1, d / 2 - 0.1); g.add(plate);
  const backing = new THREE.Mesh(boxGeo(0.66, 0.16, 0.02), dark); backing.position.set(0, h + 0.1, d / 2 - 0.115); g.add(backing);
  g.userData.footprint = { w: w + 0.1, d: d + 0.1, h: h + 0.2 }; g.userData.interact = { kind: 'catalog' };
  return g;
}

// ---- e-reader on a standing desk (opens the reading browser) ---------------------------------------
function einkPageTexture() {
  const W = 360, H = 480;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#e8e5dc'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#2b2b2b'; g.font = '600 26px Georgia, serif'; g.fillText('Lesebrowser', 26, 50);
  g.fillStyle = '#6a6a66'; g.fillRect(26, 64, W - 52, 2);
  g.fillStyle = '#3a3a38'; g.font = '600 19px Georgia, serif'; g.fillText('Cozy Shelves im Netz', 26, 104);
  const rnd = seeded(77);
  let y = 132;
  for (let para = 0; para < 4; para++) {
    const lines = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < lines; i++) { const w = i === lines - 1 ? 90 + rnd() * 150 : W - 52 - rnd() * 18; g.fillStyle = '#5c5c58'; g.fillRect(26, y, w, 7); y += 17; }
    y += 12;
  }
  g.fillStyle = '#9a9890'; g.fillRect(26, H - 40, W - 52, 1);
  g.fillStyle = '#6a6a66'; g.font = '15px Georgia, serif'; g.fillText('Seite 3 von 12', W / 2 - 50, H - 16);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}
let einkTex = null;
/** The stand of the e-reader (Lesebrowser): a slim standing desk with a sloped reading top at the height and slope of
 *  the encyclopedia lectern (LECTERN_TOP), two legs that reach into the top, a rail between them and a shelf below. */
export function ereaderStand() {
  const wm = M.wood('oak');
  const p = new Parts();
  // the legs end inside the sloping top (it is 1.6 cm higher at their back face than at their front)
  const legH = LECTERN_TOP.y + 0.005;
  for (const sx of [-0.24, 0.24]) p.add(boxGeoUV(0.05, legH, 0.05, 0.5), wm, V(sx, legH / 2, -0.05));
  p.add(boxGeoUV(0.56, 0.05, 0.3, 0.5), wm, V(0, 0.12, -0.05));
  p.add(boxGeoUV(0.43, 0.04, 0.04, 0.5), wm, V(0, 0.9, -0.05));        // the rail between the legs
  const top = new THREE.Group(); top.position.set(0, LECTERN_TOP.y, 0); top.rotation.x = LECTERN_TOP.tilt;   // front edge lower, like a lectern
  top.name = 'lectern-board';
  const tp = new Parts();
  tp.add(boxGeoUV(0.62, 0.035, 0.44, 0.5), wm, V(0, 0, 0));
  tp.add(boxGeoUV(0.6, 0.03, 0.03, 0.5), wm, V(0, 0.03, 0.205));      // ledge
  top.add(tp.build({ name: 'ereader-top' }));
  // the device: dark bezel, e-ink page with a very soft front light
  einkTex ||= einkPageTexture();
  const bezel = new THREE.Mesh(boxGeo(0.25, 0.012, 0.33), M.plain(0x1e1e1f, { roughness: 0.55, metalness: 0.1 }));
  bezel.position.set(0, 0.024, 0.03); top.add(bezel);
  const screenMat = new THREE.MeshStandardMaterial({ map: einkTex, roughness: 0.85, emissive: 0xfff6e8, emissiveMap: einkTex, emissiveIntensity: 0.12 });
  screenMat.userData.keepMap = true;
  const scr = new THREE.Mesh(planeGeo(0.21, 0.28), screenMat); scr.rotation.x = -Math.PI / 2; scr.position.set(0, 0.031, 0.02); top.add(scr);
  const g = p.build({ name: 'ereader' }); g.add(top);
  g.userData.footprint = { w: 0.62, d: 0.42, h: 1.15 };
  return g;
}

/**
 * A park bench outside (outdoor.js BENCHES): weathered slats on two black steel frames with armrests, facing local +z.
 * Snow settles on it and rain darkens it (nature.js materials); a seat like the chairs inside.
 */
export function parkBench() {
  const wood = weatheredWood(), steel = outdoorSteel();
  const p = new Parts();
  const W = 1.6, seatH = 0.45, lean = -0.18;
  for (const s of [-1, 1]) {
    const x = s * (W / 2 - 0.13);
    p.add(boxGeo(0.045, seatH - 0.02, 0.05), steel, V(x, (seatH - 0.02) / 2, 0.17));                  // front leg
    p.add(boxGeo(0.045, 0.92, 0.05), steel, V(x, 0.46, -0.21), [lean, 0, 0]);                         // back leg, up into the back
    p.add(boxGeo(0.045, 0.05, 0.47), steel, V(x, seatH - 0.045, -0.02));                              // seat rail
    p.add(boxGeo(0.055, 0.035, 0.44), steel, V(x, 0.67, 0.0));                                        // armrest
    p.add(boxGeo(0.035, 0.2, 0.035), steel, V(x, 0.56, 0.19));                                        // its support
  }
  for (let i = 0; i < 5; i++) p.add(boxGeoUV(W, 0.03, 0.078, 1.45), wood, V(0, seatH + 0.004, 0.18 - i * 0.093));
  for (let i = 0; i < 3; i++) p.add(boxGeoUV(W - 0.02, 0.09, 0.028, 1.45), wood, V(0, 0.6 + i * 0.12, -0.225 - i * 0.022), [lean, 0, 0]);
  const g = p.build({ name: 'parkbench' });
  // no box collider: it stands at an angle outside, where a box round it would block half the jetty's platform;
  // outdoor.js holds it as a row of circles instead
  g.userData.footprint = null;
  g.userData.seat = { eye: [0, 1.17, -0.06], look: [0, 1.12, 2.0], kind: 'bench', pitch: -0.04 };
  return g;
}
