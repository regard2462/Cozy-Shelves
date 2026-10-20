// Small things on the shelves, never books: where a row of books leaves room at its end, and on the rows a small
// department leaves free, stands one plant, a ceramic vase or a framed photo. Nothing of it is interactive, and all
// of it is instanced: one draw call per kind of thing.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOOKCASE, SHELF_LEVELS } from './furniture.js';
import { seeded, hashStr } from './geo.js';
import { CARD_LEVEL } from './empty-library.js';

const DEPTH = 0.19;
const shared = (g) => { g.userData.shared = true; return g; };

// soft ceramic glazes and pot colours, leaf greens, frame finishes
const GLAZES = ['#f1ece2', '#9fbfa3', '#e9b8a8', '#c9785a', '#a9c7dc', '#d8d2c6', '#3d4148', '#e8cf9a', '#b9b3d9'];
const POTS = ['#c9785a', '#f1ece2', '#9fbfa3', '#e9b8a8', '#3d4148', '#d8d2c6'];
const GREENS = ['#4f8a4b', '#5f9a52', '#3f7a4a', '#6ea35a', '#487d57'];
const FRAMES = ['#f4f1ea', '#2c2e33', '#b88c5e', '#c9a27a'];
const NP = 4;          // photos in the picture atlas

/** A unit box whose six faces are sorted into contiguous groups (one draw call each):
 *  faceMat = material index for the faces +x −x +y −y +z −z. */
function regroupedBox(faceMat) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const idx = box.index.array, out = [], groups = [];
  for (let m = 0; m < 3; m++) {
    const start = out.length;
    faceMat.forEach((fm, f) => { if (fm === m) for (let k = 0; k < 6; k++) out.push(idx[f * 6 + k]); });
    if (out.length > start) groups.push({ start, count: out.length - start, materialIndex: m });
  }
  box.setIndex(out); box.clearGroups();
  for (const g of groups) box.addGroup(g.start, g.count, g.materialIndex);
  return box;
}

// ---------------------------------------------------------------- textures ------------------------------
let photoAtlas = null;
/** Four little pictures for the photo frames (a white mount around each). */
function photos() {
  if (photoAtlas) return photoAtlas;
  const W = 128, H = 160, c = document.createElement('canvas'); c.width = W * NP; c.height = H;
  const g = c.getContext('2d');
  const mount = 12;
  for (let p = 0; p < NP; p++) {
    const x0 = p * W, iw = W - mount * 2, ih = H - mount * 2, ix = x0 + mount, iy = mount;
    g.fillStyle = '#f6f3ec'; g.fillRect(x0, 0, W, H);
    g.save(); g.beginPath(); g.rect(ix, iy, iw, ih); g.clip();
    const sky = g.createLinearGradient(0, iy, 0, iy + ih);
    if (p === 0) {        // sea and beach
      sky.addColorStop(0, '#9cc9e8'); sky.addColorStop(0.55, '#d9ecf5'); g.fillStyle = sky; g.fillRect(ix, iy, iw, ih);
      g.fillStyle = '#3f8fb5'; g.fillRect(ix, iy + ih * 0.52, iw, ih * 0.2);
      g.fillStyle = '#ecdcb8'; g.fillRect(ix, iy + ih * 0.72, iw, ih * 0.28);
      g.fillStyle = '#ffffff'; g.fillRect(ix, iy + ih * 0.71, iw, 2);
    } else if (p === 1) { // mountains and a lake
      sky.addColorStop(0, '#b9d4ea'); sky.addColorStop(1, '#eef4f6'); g.fillStyle = sky; g.fillRect(ix, iy, iw, ih);
      g.fillStyle = '#7d93a8'; g.beginPath(); g.moveTo(ix, iy + ih * 0.62); g.lineTo(ix + iw * 0.35, iy + ih * 0.25); g.lineTo(ix + iw * 0.62, iy + ih * 0.55); g.lineTo(ix + iw * 0.8, iy + ih * 0.35); g.lineTo(ix + iw, iy + ih * 0.6); g.lineTo(ix + iw, iy + ih); g.lineTo(ix, iy + ih); g.fill();
      g.fillStyle = '#f7f7f4'; g.beginPath(); g.moveTo(ix + iw * 0.28, iy + ih * 0.33); g.lineTo(ix + iw * 0.35, iy + ih * 0.25); g.lineTo(ix + iw * 0.42, iy + ih * 0.33); g.fill();
      g.fillStyle = '#5f8a6a'; g.fillRect(ix, iy + ih * 0.62, iw, ih * 0.12);
      g.fillStyle = '#6fa3c4'; g.fillRect(ix, iy + ih * 0.74, iw, ih * 0.26);
    } else if (p === 2) { // evening sun over hills
      sky.addColorStop(0, '#f4a582'); sky.addColorStop(0.6, '#fbe0b8'); g.fillStyle = sky; g.fillRect(ix, iy, iw, ih);
      g.fillStyle = '#fff3d6'; g.beginPath(); g.arc(ix + iw * 0.62, iy + ih * 0.5, iw * 0.16, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#9b7fa6'; g.beginPath(); g.ellipse(ix + iw * 0.2, iy + ih * 0.95, iw * 0.7, ih * 0.35, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#6f5a86'; g.beginPath(); g.ellipse(ix + iw * 0.85, iy + ih * 1.02, iw * 0.7, ih * 0.36, 0, 0, Math.PI * 2); g.fill();
    } else {              // a pressed leaf on paper
      g.fillStyle = '#efe9dc'; g.fillRect(ix, iy, iw, ih);
      g.strokeStyle = '#4f7d4f'; g.fillStyle = '#6f9f62'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(ix + iw / 2, iy + ih * 0.88); g.lineTo(ix + iw / 2, iy + ih * 0.18); g.stroke();
      for (let k = 0; k < 5; k++) for (const s of [-1, 1]) {
        const y = iy + ih * (0.28 + k * 0.12);
        g.beginPath(); g.ellipse(ix + iw / 2 + s * iw * 0.16, y, iw * 0.15, ih * 0.035, s * -0.5, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1; g.strokeRect(ix + 0.5, iy + 0.5, iw - 1, ih - 1);
  }
  photoAtlas = new THREE.CanvasTexture(c);
  photoAtlas.colorSpace = THREE.SRGBColorSpace; photoAtlas.anisotropy = 4;
  return photoAtlas;
}

// ---------------------------------------------------------------- materials ------------------------------
const matCache = new Map();
const cached = (key, make) => matCache.get(key) || (matCache.set(key, make()), matCache.get(key));
/** A material that ignores the instance colour (soil, pictures). */
function plainOf(params, key) {
  return cached(key, () => {
    const m = new THREE.MeshStandardMaterial(params);
    m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', ''); };
    m.customProgramCacheKey = () => 'decor-nocolor';
    return m;
  });
}
/** The picture of a photo frame, chosen per instance. */
function pictureMat() {
  return cached('picture', () => {
    const m = new THREE.MeshStandardMaterial({ map: photos(), roughness: 0.45 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aVariant;\nvarying float vVariant;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvVariant = aVariant;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vVariant;')
        .replace('#include <map_fragment>', `diffuseColor *= texture2D(map, vec2((floor(vVariant + 0.5) + vMapUv.x) / ${NP}.0, vMapUv.y));`)
        .replace('#include <color_fragment>', '');
    };
    m.customProgramCacheKey = () => 'decor-picture';
    return m;
  });
}
const glazeMat = () => cached('glaze', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.02 }));
const matteMat = () => cached('matte', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78 }));
const leafMat = () => cached('leaf', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, flatShading: true }));
const soilMat = () => plainOf({ color: 0x3b2f27, roughness: 1 }, 'soil');

// ---------------------------------------------------------------- geometry ------------------------------
let G = null;
function geometries() {
  if (G) return G;
  const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
  // a round-bellied vase and a slim bottle, both 0.2 m tall at scale 1
  const vase = lathe([[0.0, 0], [0.036, 0], [0.044, 0.012], [0.056, 0.05], [0.058, 0.09], [0.047, 0.13], [0.028, 0.16], [0.024, 0.19], [0.03, 0.2], [0.026, 0.2], [0.02, 0.185], [0.0, 0.185]], 22);
  const bottle = lathe([[0.0, 0], [0.03, 0], [0.034, 0.01], [0.034, 0.12], [0.022, 0.15], [0.012, 0.17], [0.012, 0.2], [0.009, 0.2], [0.0, 0.19]], 18);
  // plant pot with soil (0.09 tall), a round leafy clump and an upright snake plant
  const pot = lathe([[0.0, 0.002], [0.038, 0], [0.046, 0.075], [0.05, 0.078], [0.05, 0.09], [0.044, 0.09], [0.04, 0.078], [0.0, 0.078]], 20);
  const soil = new THREE.CircleGeometry(0.041, 16); soil.rotateX(-Math.PI / 2); soil.translate(0, 0.08, 0);
  const clump = [];
  for (const [x, y, z, r] of [[0, 0.13, 0, 0.055], [0.035, 0.115, 0.012, 0.04], [-0.034, 0.118, -0.01, 0.042], [0.008, 0.16, -0.018, 0.038], [-0.012, 0.112, 0.034, 0.036], [0.02, 0.15, 0.03, 0.03]]) {
    const s = new THREE.IcosahedronGeometry(r, 1); s.translate(x, y, z); clump.push(s);   // already non-indexed
  }
  const blades = [];
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4, lean = 0.08 + (i % 3) * 0.07, h = 0.1 + (i % 4) * 0.02;      // 0.235 m tall with the pot
    const b = new THREE.ConeGeometry(0.014, h, 4, 1); b.scale(1, 1, 0.3); b.translate(0, h / 2, 0);
    b.rotateZ(lean); b.rotateY(a); b.translate(Math.cos(a) * 0.012, 0.075, Math.sin(a) * 0.012); blades.push(b.toNonIndexed());
  }
  G = { vase: shared(vase), bottle: shared(bottle), pot: shared(pot), soil: shared(soil), clump: shared(mergeGeometries(clump)), blades: shared(mergeGeometries(blades)) };
  return G;
}

/**
 * @param layout            world layout (bookcases with rows)
 * @param bookcaseObjects   id → bookcase Object3D (world matrices up to date)
 * @returns THREE.Group with a few instanced meshes
 */
export function buildShelfDecor(layout, bookcaseObjects) {
  const geo = geometries();
  const lists = { vase: [], bottle: [], pot: [], clump: [], blades: [], photo: [] };
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(), caseQ = new THREE.Quaternion();
  const x0 = -BOOKCASE.innerW / 2 + 0.03, x1 = BOOKCASE.innerW / 2 - 0.03;
  const zFront = BOOKCASE.d / 2 - 0.03 - DEPTH / 2;

  for (const bc of layout.bookcases) {
    const obj = bookcaseObjects.get(bc.id); if (!obj) continue;
    // an empty case (the recently-read one) explains itself with a card; the waiting cases of a library without books
    // (empty-library.js) are furnished, but not on the shelf with their card
    if (!bc.waiting && !bc.rows.some((r) => r.items.length)) continue;
    const world = obj.matrixWorld;
    caseQ.setFromRotationMatrix(world);
    const put = (list, x, y, z, w, h, d, extra = {}, rz = 0, ry = 0, rx = 0) => {
      p.set(x, y, z).applyMatrix4(world);
      e.set(rx, ry, rz); q.setFromEuler(e).premultiply(caseQ);
      sc.set(w, h, d);
      list.push({ m: new THREE.Matrix4().compose(p.clone(), q.clone(), sc.clone()), ...extra });
    };
    bc.rows.forEach((row, level) => {
      const room = (level < SHELF_LEVELS.length - 1 ? SHELF_LEVELS[level + 1] - SHELF_LEVELS[level] : BOOKCASE.h - 0.05 - SHELF_LEVELS[level]) - 0.05;
      const rnd = seeded(hashStr(bc.id + ':' + level + ':things'));
      if (bc.waiting && (bc.card ? level === CARD_LEVEL : rnd() < 0.3)) return;
      let cx;
      if (!row.items.length) cx = (x0 + x1) / 2 + (rnd() - 0.5) * 0.3;           // a free row: one thing, not in a line
      else {
        const last = row.items[row.items.length - 1];
        const end = x0 + last.x + last.w + 0.016;                                   // behind the bookend (world.js)
        const free = x1 - end;
        if (free < 0.24 || rnd() < 0.35) return;                                    // not every row end: it would look arranged
        cx = end + Math.max(0.11, free / 2);
      }
      const y0 = row.y;
      const k = rnd();
      if (k < 0.45 && room > 0.22) {
        const s = Math.min(1.15, (room - 0.03) / 0.235) * (0.95 + rnd() * 0.15);
        const pc = POTS[Math.floor(rnd() * POTS.length)], gc = GREENS[Math.floor(rnd() * GREENS.length)], ry = rnd() * Math.PI * 2;
        put(lists.pot, cx, y0, zFront, s, s, s, { color: pc }, 0, ry);
        put(rnd() < 0.5 ? lists.blades : lists.clump, cx, y0, zFront, s, s, s, { color: gc }, 0, ry);
      } else if (k < 0.8 && room > 0.2) {
        const s = Math.min(1.1, (room - 0.03) / 0.2) * (0.85 + rnd() * 0.25);
        put(rnd() < 0.55 ? lists.vase : lists.bottle, cx, y0, zFront, s, s, s, { color: GLAZES[Math.floor(rnd() * GLAZES.length)] }, 0, rnd() * 6);
      } else if (room > 0.2) {
        // a framed photo, leaning back a little against the back panel
        const fw = 0.12 + rnd() * 0.03, fh = fw * 1.25;
        put(lists.photo, cx, y0 + fh / 2 * Math.cos(0.12) + 0.002, zFront - 0.03, fw, fh, 0.016, { color: FRAMES[Math.floor(rnd() * FRAMES.length)], v: Math.floor(rnd() * NP) }, 0, (rnd() - 0.5) * 0.4, -0.12);
      }
    });
  }

  const group = new THREE.Group(); group.name = 'shelfdecor';
  const color = new THREE.Color();
  const inst = (g, mat, list, { variant = false } = {}) => {
    if (!list.length) return;
    // the per-instance design index lives on a geometry of this build (shared ones are never disposed)
    let geom = g;
    if (variant && g.userData.shared) { geom = g.clone(); geom.userData = {}; }
    if (variant) geom.setAttribute('aVariant', new THREE.InstancedBufferAttribute(new Float32Array(list.map((x) => x.v || 0)), 1));
    const mesh = new THREE.InstancedMesh(geom, mat, list.length);
    list.forEach((x, i) => { mesh.setMatrixAt(i, x.m); mesh.setColorAt(i, color.set(x.color)); });
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.decor = true;
    group.add(mesh);
  };
  inst(geo.vase, glazeMat(), lists.vase);
  inst(geo.bottle, glazeMat(), lists.bottle);
  inst(geo.pot, matteMat(), lists.pot);
  inst(geo.soil, soilMat(), lists.pot);            // the soil in every pot
  inst(geo.clump, leafMat(), lists.clump);
  inst(geo.blades, leafMat(), lists.blades);
  // photo frames: the frame takes the instance colour, the front shows one of the pictures
  inst(regroupedBox([0, 0, 0, 0, 1, 0]), [matteMat(), pictureMat()], lists.photo, { variant: true });
  return group;
}
