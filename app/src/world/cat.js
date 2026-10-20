// A procedural library cat: it sleeps on cosy seats, now and then wanders to another one, purrs when you are
// near and likes to be petted (look at it and press E). To change seats it jumps down next to the seat, walks a
// route around every piece of furniture (cat-nav.js) and jumps up again: it never walks through objects and never
// leaves the building. A seat it cannot reach is never visited, and if it cannot get away it stays where it is.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sphereGeo, cylGeo, coneGeo, torusGeo, lerp, clamp, seeded } from './geo.js';
import { CatNav, CAT_TOP } from './cat-nav.js';

export const PET_REACH = 2.2;           // metres from the eye within which the cat can be petted
export const CAT_RADIUS = 0.2;          // body circle the routes keep clear of every obstacle
const WALK = 0.8;                       // walking speed, m/s
const TURN = 4.2;                       // turning speed, rad/s
const PLAYER_R = 0.34;                  // the player's body circle (player.js: 0.32) and a little room
const PET_TIME = 4.6;                   // one round of petting, seconds
const RESTING = new Set(['sleep', 'sit', 'settle', 'pet', 'linger']);   // purrs when you are close
const HOPS = new Set(['hopdown', 'hopup']);
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const heading = (dx, dz) => Math.atan2(-dz, dx);   // the model looks along its local +x

// The whole cat is drawn with one material. The fur texture (1024 × 256) is an atlas of patches that the parts
// sample by their u range: the body with its tabby hoops, the head with the tabby "M", the tail, the ringed legs,
// the light fur of chest, belly, muzzle and paws, and a plain white spot for parts that only carry their vertex
// tint, so each moving part stays a single mesh. The body spheres lie with their axis along the body (nose to
// tail), so their u runs round the barrel: the spine at both edges of the patch, the belly in its middle, and the
// stripes are rows (constant v), hoops round the body. Head, tail and legs stand upright: the back at the top of
// their patch (v = 1), the underside at the bottom, with a gradient between them.
const ATLAS = { body: [0.002, 0.418], head: [0.422, 0.718], tail: [0.722, 0.798], leg: [0.802, 0.878], light: [0.882, 0.948], plain: [0.975, 0.975] };
const PAINT = { body: [0, 0.42], head: [0.42, 0.72], tail: [0.72, 0.8], leg: [0.8, 0.88], light: [0.88, 0.95] };   // painted a little wider than sampled
const TEX_W = 1024, TEX_H = 256;
const STRIPE = 'rgba(46,31,21,';
function furTexture(seed = 5) {
  const c = document.createElement('canvas'); c.width = TEX_W; c.height = TEX_H;
  const ctx = c.getContext('2d');
  const rnd = seeded(seed);
  const span = (name) => { const [a, b] = PAINT[name]; return [Math.round(a * TEX_W), Math.round((b - a) * TEX_W)]; };
  // the base of a patch: a gradient from the back to the underside, top to bottom (or, across, left to right)
  const base = (name, stops, across = false) => {
    const [x0, w] = span(name);
    const g = across ? ctx.createLinearGradient(x0, 0, x0 + w, 0) : ctx.createLinearGradient(0, 0, 0, TEX_H);
    for (const [at, col] of stops) g.addColorStop(at, col);
    ctx.fillStyle = g; ctx.fillRect(x0, 0, w, TEX_H);
    return [x0, w];
  };
  // markings go on a layer of their own and are blurred a little: the soft edge of fur
  const soft = (draw, blur = 1.4) => {
    const l = document.createElement('canvas'); l.width = TEX_W; l.height = TEX_H;
    const lc = l.getContext('2d'); lc.lineCap = 'round'; lc.lineJoin = 'round'; draw(lc);
    ctx.save(); ctx.filter = `blur(${blur}px)`; ctx.drawImage(l, 0, 0); ctx.restore();
  };
  // thousands of short hair strokes, a little lighter or darker than the fur beneath them
  const hair = (x0, w, density = 1, alpha = 1, across = false) => {
    ctx.lineWidth = 1; ctx.lineCap = 'round';
    const n = Math.round(w * TEX_H * density / 26);
    for (let i = 0; i < n; i++) {
      const x = x0 + rnd() * w, y = rnd() * TEX_H, len = 4 + rnd() * 9, a = (rnd() - 0.5) * 0.6 + (across ? Math.PI / 2 : 0);
      const al = (0.07 + rnd() * 0.13) * alpha;
      ctx.strokeStyle = rnd() < 0.5 ? `rgba(255,238,210,${al})` : `rgba(30,18,10,${al})`;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(a) * len, y + Math.cos(a) * len); ctx.stroke();
    }
  };
  // the markings fade into the light underside
  const fade = (x0, w, from, col) => {
    const g = ctx.createLinearGradient(0, from, 0, TEX_H); g.addColorStop(0, col + '0)'); g.addColorStop(1, col + '0.9)');
    ctx.fillStyle = g; ctx.fillRect(x0, from, w, TEX_H - from);
  };
  const BACK = [[0, '#5a4433'], [0.45, '#9a7857'], [1, '#dccbb0']];

  // --- body: the spine at both edges, the belly in the middle; mackerel hoops as wavy rows from spine to spine,
  //     fading out towards the belly, every third one broken ---------------------------------------------------------
  {
    const [x0, w] = base('body', [[0, '#5a4433'], [0.22, '#9a7857'], [0.5, '#dccbb0'], [0.78, '#9a7857'], [1, '#5a4433']], true);
    const cx = x0 + w / 2;
    soft((lc) => {
      lc.strokeStyle = STRIPE + '0.72)';
      lc.lineWidth = 7; for (const x of [x0 + 2, x0 + w - 2]) { lc.beginPath(); lc.moveTo(x, 0); lc.lineTo(x, TEX_H); lc.stroke(); }   // the line of the spine
      const n = 14;
      for (let i = 0; i < n; i++) {
        const y = 10 + (i + 0.2 + rnd() * 0.6) * (TEX_H - 20) / n, wob = 6 - rnd() * 12;
        lc.lineWidth = 3.5 + rnd() * 3.5;
        lc.beginPath(); lc.moveTo(x0, y + wob); lc.bezierCurveTo(cx - w * 0.2, y - wob, cx + w * 0.2, y + wob, x0 + w, y - wob); lc.stroke();
        if (i % 3 === 1) {   // a broken stripe: a gap on each flank
          lc.save(); lc.globalCompositeOperation = 'destination-out'; lc.lineWidth = 12;
          for (const s of [-1, 1]) { const gx = cx + s * w * (0.18 + rnd() * 0.12); lc.beginPath(); lc.moveTo(gx, y - 10); lc.lineTo(gx + 3, y + 10); lc.stroke(); }
          lc.restore();
        }
      }
    });
    // the hoops fade into the light belly
    const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
    for (const [at, a] of [[0, 0], [0.3, 0], [0.42, 0.85], [0.58, 0.85], [0.7, 0], [1, 0]]) g.addColorStop(at, `rgba(222,206,180,${a})`);
    ctx.fillStyle = g; ctx.fillRect(x0, 0, w, TEX_H);
    hair(x0, w, 1, 1, true);
  }
  // --- head: the "M" on the forehead, stripes over the crown, back from the eyes and across the cheeks, light rings
  //     round the eyes (the eyes sit at u = 0.5 ± 0.074 of the head sphere, v = 0.54) ---------------------------------
  {
    const [x0, w] = base('head', [[0, '#66503c'], [0.5, '#9a7857'], [1, '#d4c3a6']]);
    const cx = x0 + w / 2, ex = 0.074 * w, ey = 117;
    soft((lc) => {
      lc.strokeStyle = STRIPE + '0.75)'; lc.lineWidth = 4.5;
      lc.beginPath(); lc.moveTo(cx - 32, 94); lc.lineTo(cx - 17, 54); lc.lineTo(cx, 78); lc.lineTo(cx + 17, 54); lc.lineTo(cx + 32, 94); lc.stroke();
      lc.lineWidth = 4;
      lc.beginPath(); lc.moveTo(cx, 74); lc.lineTo(cx, 16); lc.stroke();
      for (const s of [-1, 1]) {
        lc.beginPath(); lc.moveTo(cx + s * 17, 54); lc.lineTo(cx + s * 25, 0); lc.stroke();
        lc.beginPath(); lc.moveTo(cx + s * (ex + 14), ey - 8); lc.quadraticCurveTo(cx + s * (ex + 40), ey - 22, cx + s * (ex + 62), ey - 14); lc.stroke();
        lc.beginPath(); lc.moveTo(cx + s * (ex + 16), ey + 12); lc.quadraticCurveTo(cx + s * (ex + 40), ey + 14, cx + s * (ex + 66), ey + 26); lc.stroke();
        for (const f of [0.04, 0.1, 0.17]) { const x = s > 0 ? x0 + w * (1 - f) : x0 + w * f; lc.beginPath(); lc.moveTo(x, 0); lc.lineTo(x - s * 6, 125); lc.stroke(); }
      }
    });
    for (const s of [-1, 1]) {
      const g = ctx.createRadialGradient(cx + s * ex, ey, 2, cx + s * ex, ey, 19);
      g.addColorStop(0, 'rgba(238,226,206,0.75)'); g.addColorStop(1, 'rgba(238,226,206,0)');
      ctx.fillStyle = g; ctx.fillRect(cx + s * ex - 20, ey - 20, 40, 40);
    }
    fade(x0, w, 170, 'rgba(226,212,190,');
    hair(x0, w);
  }
  // --- tail: no stripes, the rings are darker segments -------------------------------------------------------------
  { const [x0, w] = base('tail', BACK); hair(x0, w); }
  // --- legs: two dark rings on every leg bone, lighter towards the paw -----------------------------------------------
  {
    const [x0, w] = base('leg', [[0, '#8a6c4f'], [1, '#d3c1a5']]);
    soft((lc) => { lc.strokeStyle = STRIPE + '0.7)'; lc.lineWidth = 15; for (const y of [78, 162]) { lc.beginPath(); lc.moveTo(x0, y); lc.lineTo(x0 + w, y); lc.stroke(); } }, 2);
    hair(x0, w);
  }
  // --- light fur (chest, belly, muzzle, cheeks, paws, inner ears) and the plain white spot ----------------------------
  { const [x0, w] = base('light', [[0, '#e4d7c4'], [1, '#f2eadc']]); hair(x0, w, 0.5, 0.35); }
  const plainX = Math.round(0.955 * TEX_W);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(plainX, 0, TEX_W - plainX, TEX_H);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
/**
 * One geometry out of several parts: { geo, pos, rot, scale (or matrix), tint (THREE.Color), patch }. Every part
 * keeps its own UVs, squeezed into the u range of its atlas patch; a point patch (plain) samples one white texel.
 */
function mergeParts(parts) {
  return mergeGeometries(parts.map(({ geo, pos, rot, scale, matrix, tint, patch }) => {
    const g = geo.clone(); delete g.userData.shared;
    g.applyMatrix4(matrix || _m.compose(_v.set(...(pos || [0, 0, 0])), _q.setFromEuler(_e.set(...(rot || [0, 0, 0]))), _s.set(...(scale || [1, 1, 1]))));
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const [u0, u1] = ATLAS[patch], uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) { if (u0 === u1) uv.setXY(i, u0, 0.5); else uv.setX(i, uv.getX(i) * (u1 - u0) + u0); }
    return g;
  }), false);
}
/** A thin rod from a to b (whiskers, the mouth line): geometry and matrix of a part. */
function rod(a, b, r) {
  _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _v.length();
  _q.setFromUnitVectors(Y, _v.normalize());
  return { geo: cylGeo(r, r, 1, 5), matrix: new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, new THREE.Vector3(1, len, 1)) };
}
const BLINK = 0.24;                                       // one blink, seconds
const TAIL_RING = [0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1];   // the darker rings of the tail, the tip included

/** Placed props that stand on the floor without a collider of their own (footprint null) still block the cat. */
function propObstacles(objects) {
  const out = [], box = new THREE.Box3();
  for (const o of objects || []) {
    if (!o?.userData?.placement || o.userData.footprint) continue;
    box.setFromObject(o);
    if (box.isEmpty() || box.min.y > CAT_TOP || box.max.y < 0.08) continue;   // hangs above the cat, or flat (rugs)
    out.push({ min: box.min.toArray(), max: box.max.toArray() });
  }
  return out;
}

export class Cat {
  /**
   * @param spots   [{ id, position (on the cushion), yaw }]: the cat lies there facing along its yaw
   * @param onPurr  (on) => void
   * @param opts    { colliders, floors (the building), props (placed objects), sfx: (name) => void, memo }
   */
  constructor(spots, onPurr, { colliders = [], floors = null, props = null, sfx = null, memo = null } = {}) {
    this.spots = spots;
    this.onPurr = onPurr;
    this.sfx = sfx;
    this.nav = new CatNav([...colliders, ...propObstacles(props)], { floors, cell: 0.2, radius: CAT_RADIUS });
    this.group = new THREE.Group(); this.group.name = 'cat';
    // everything but the tail hangs in `root`, which lifts, lowers and tilts the body for the poses
    const root = new THREE.Group(); this.group.add(root); this.root = root;

    const map = furTexture(7);
    const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.97, metalness: 0 });
    const eyeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, emissive: 0x3a3210, emissiveIntensity: 0.25 });
    // (the same material for the instanced legs and tail, as a copy: one material drawn on plain and on instanced
    // meshes made three look its program up again at every change between them, twice a frame; the copy has the
    // same program)
    const matI = mat.clone();
    // textured parts carry the colours of their atlas patch and a white tint; the plain parts only their tint
    const WHITE = new THREE.Color(0xffffff), RING = new THREE.Color(0x6a5648), EAR = new THREE.Color(0xf2c9bf), PINK = new THREE.Color(0xd98d92);
    const DARK = new THREE.Color(0x3a2a24), BLACK = new THREE.Color(0x14100e), IRIS = new THREE.Color(0xd9a73c), WHISKER = new THREE.Color(0xe0d8cc);
    const part = (patch, tint) => (geo, pos, rot, scale) => ({ geo, pos, rot, scale, tint, patch });
    const body = part('body', WHITE), headFur = part('head', WHITE), legFur = part('leg', WHITE), tailPart = part('tail', WHITE), ring = part('tail', RING);
    const light = part('light', WHITE), ear = part('light', EAR), pink = part('plain', PINK), dark = part('plain', DARK), black = part('plain', BLACK), iris = part('plain', IRIS), white = part('plain', WHITE);
    const line = (tint) => (a, b, r) => ({ ...rod(a, b, r), tint, patch: 'plain' });
    const ALONG = [0, 0, -Math.PI / 2];   // a sphere lying with its axis along the body (its scale is given in its own frame)
    const mouth = line(DARK), whisker = line(WHISKER);

    // --- torso: a round barrel, a plump rump with thighs, a lighter chest with a ruff, a short thick neck --------
    this.torso = new THREE.Mesh(mergeParts([
      body(sphereGeo(0.15, 24), [0, 0.155, 0], ALONG, [1.0, 1.55, 1.1]),
      body(sphereGeo(0.13, 20), [-0.16, 0.165, 0], ALONG, [1.1, 1.05, 1.15]),
      body(sphereGeo(0.07, 14), [-0.14, 0.125, 0.11]), body(sphereGeo(0.07, 14), [-0.14, 0.125, -0.11]),
      light(sphereGeo(0.11, 20), [0.165, 0.14, 0], null, [0.95, 0.95, 0.92]),
      light(sphereGeo(0.06, 14), [0.175, 0.11, 0.075]), light(sphereGeo(0.06, 14), [0.175, 0.11, -0.075]),
      body(cylGeo(0.062, 0.085, 0.09, 16), [0.215, 0.205, 0], [0, 0, -0.6]),
    ]), mat);
    root.add(this.torso);
    // the soft belly hangs under the barrel; its own mesh, so it can sag when the cat sits (#applyPose)
    this.belly = new THREE.Mesh(mergeParts([light(sphereGeo(0.13, 20), null, null, [1.3, 0.8, 1.0])]), mat);
    root.add(this.belly);

    // --- head (yaw, then nod, then tilt: the order a looking and rubbing head moves in) ----------
    const head = new THREE.Group(); head.position.set(0.27, 0.245, 0); head.rotation.order = 'YZX'; root.add(head); this.head = head;
    // a round head with cheeks, a short light muzzle and chin, a pink nose and the mouth line under it
    const face = [
      headFur(sphereGeo(0.092, 24), null, null, [1.0, 0.94, 1.0]),
      light(sphereGeo(0.042, 16), [0.04, -0.038, 0.052], null, [0.95, 0.85, 1]), light(sphereGeo(0.042, 16), [0.04, -0.038, -0.052], null, [0.95, 0.85, 1]),
      light(sphereGeo(0.043, 16), [0.063, -0.03, 0], null, [0.9, 0.72, 1.0]),
      light(sphereGeo(0.03, 12), [0.056, -0.06, 0], null, [1, 0.8, 1]),
      pink(sphereGeo(0.012, 10), [0.099, -0.011, 0], null, [0.7, 0.72, 1.0]),
      mouth([0.1025, -0.021, 0], [0.1025, -0.033, 0], 0.0014),
      mouth([0.1025, -0.033, 0], [0.097, -0.0315, 0.014], 0.0013), mouth([0.1025, -0.033, 0], [0.097, -0.0315, -0.014], 0.0013),
    ];
    const eyes = [], lids = [];
    for (const s of [-1, 1]) {
      // ears with a lighter inner ear, tilted a little outwards
      const earRot = [s * 0.2, 0, -0.1];
      face.push(headFur(coneGeo(0.04, 0.085, 12), [-0.012, 0.085, s * 0.052], earRot, [1, 1, 0.55]));
      face.push(ear(coneGeo(0.026, 0.06, 10), [0.002, 0.08, s * 0.052], earRot, [1, 1, 0.5]));
      // three whiskers a side, fanned from the whisker pad
      for (const e of [0.28, 0.04, -0.2]) { const d = Math.hypot(0.25, e, 1); face.push(whisker([0.09, -0.022, s * 0.03], [0.09 + 0.25 / d * 0.12, -0.022 + e / d * 0.12, s * (0.03 + 0.12 / d)], 0.0006)); }
      // eyes around y = 0: an amber iris, a slit pupil and a highlight (both eyes lit from the same side); the eye
      // mesh sits at the eyes' height and closes by squashing, then a dark arc (the lids) shows instead
      eyes.push(iris(sphereGeo(0.018, 16), [0.07, 0, s * 0.039], null, [1, 0.96, 1.05]));
      eyes.push(black(sphereGeo(0.0085, 10), [0.0845, 0, s * 0.041], null, [0.5, 1.45, 0.5]));
      eyes.push(white(sphereGeo(0.0038, 8), [0.0855, 0.007, s * 0.039 + 0.0055]));
      lids.push(dark(torusGeo(0.015, 0.0026, 5, 14, Math.PI), [0.0835, -0.004, s * 0.0395], [0, Math.PI / 2, 0], [1, 0.6, 1]));
    }
    head.add(new THREE.Mesh(mergeParts(face), mat));
    this.eyes = new THREE.Mesh(mergeParts(eyes), eyeMat); this.eyes.position.y = 0.012; head.add(this.eyes);
    this.lids = new THREE.Mesh(mergeParts(lids), mat); this.lids.position.y = 0.012; this.lids.visible = false; head.add(this.lids);

    // --- legs: short and sturdy, upper + lower + paw with three toes, all four in one instanced mesh (front: 0, 1;
    //     hind: 2, 3) -------------------------------------------------------------------------------------------
    this.legMesh = new THREE.InstancedMesh(mergeParts([
      legFur(cylGeo(0.036, 0.04, 0.1, 10), [0, -0.05, 0]),
      legFur(cylGeo(0.027, 0.031, 0.08, 10), [0.004, -0.125, 0]),
      light(sphereGeo(0.031, 12), [0.014, -0.158, 0], null, [1.3, 0.62, 1.05]),
      ...[-1, 0, 1].map((k) => light(sphereGeo(0.011, 8), [0.046, -0.165, k * 0.017], null, [1, 0.75, 0.9])),
    ]), matI, 4);
    this.legMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.05, 0), 0.5);   // for culling
    root.add(this.legMesh);
    this.legs = [[0.16, 0.08], [0.16, -0.08], [-0.16, 0.088], [-0.16, -0.088]];

    // --- tail: a thick chain of spheres stretched along it that can curl; the rings and the tip are darker --------
    this.tailFur = new THREE.InstancedMesh(mergeParts([tailPart(sphereGeo(1, 12))]), matI, TAIL_RING.filter((r) => !r).length);
    this.tailRings = new THREE.InstancedMesh(mergeParts([ring(sphereGeo(1, 12))]), matI, TAIL_RING.filter((r) => r).length);
    for (const m of [this.tailFur, this.tailRings]) { m.boundingSphere = new THREE.Sphere(new THREE.Vector3(-0.25, 0.2, 0), 0.6); this.group.add(m); }
    this.tailR = Array.from({ length: 12 }, (_, i) => (i < 10 ? 0.036 - i * 0.0009 : i === 10 ? 0.03 : 0.025));
    this.tailP = Array.from({ length: 12 }, () => new THREE.Vector3());

    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    // --- an invisible, slightly larger volume that the look ray hits (world-actions.js) ------------
    const pickMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const pick = new THREE.Mesh(sphereGeo(1, 12), pickMat);
    pick.visible = false; pick.castShadow = false; pick.name = 'cat-pick';
    pick.userData.interact = { kind: 'cat', label: { de: 'Katze', en: 'Cat' } };
    const raycast = THREE.Mesh.prototype.raycast;
    // only a visible cat on the ground or on a seat answers, and only within reach: further away the ray just
    // passes on to the books behind it
    pick.raycast = (raycaster, hits) => {
      if (!this.pettable) return;
      const n = hits.length;
      raycast.call(pick, raycaster, hits);
      for (let i = hits.length - 1; i >= n; i--) if (hits[i].distance > PET_REACH) hits.splice(i, 1);
    };
    this.group.add(pick); this.pick = pick;

    this.materials = [mat, matI, eyeMat, pickMat];
    this.map = map;

    // pose parameters (0..1), eased towards the targets of the current state every frame
    this.pose = { lie: 1, sit: 0, headUp: 0, paws: 0, eyes: 0, tailUp: 0, rub: 0, knead: 0, stretch: 0, crouch: 0, swish: 0, stride: 0 };
    this.t = 0; this.gait = 0; this.turnRate = 0; this.hopPitch = 0; this.lookYaw = 0; this.lookPitch = 0;
    this.blinkIn = 2 + Math.random() * 3; this.blink = 0;    // seconds to the next blink, and the one under way
    this.purring = false; this.boostT = 0; this.pets = 0;
    this.route = null; this.routeI = 0; this.pending = -1; this.after = null; this.player = null;
    this.#prepareSpots();
    const start = memo ? spots.findIndex((s) => s.id != null && s.id === memo.spot) : -1;
    this.goTo(start >= 0 ? start : 0, true);
    if (memo?.at && start >= 0 && this.nav.freeAt(memo.at.x, memo.at.z)) {
      // it was on its way there: it walks on from where it was (or, if that fails, it is there already)
      this.onSpot = false; this.group.position.set(memo.at.x, 0, memo.at.z); this.yaw = memo.yaw ?? this.yaw;
      Object.assign(this.pose, { lie: 0, sit: 0, eyes: 1 });
      if (!this.goTo(start)) this.goTo(start, true);
    }
    this.nextMove = memo ? Math.max(20, memo.nextMove || 0) : 45 + Math.random() * 60;
  }

  /** Landing place next to every spot: on the floor, on the seat's free side. */
  #prepareSpots() {
    for (const s of this.spots) {
      const out = new THREE.Vector3(Math.cos(s.yaw || 0), 0, -Math.sin(s.yaw || 0));   // the way the cat faces on the seat
      const l = this.nav.landing(s.position, out);
      s.landing = l ? l.point : null;          // null: the cat can neither jump down there nor up
      s.own = l ? l.own : [];
    }
  }

  get pettable() { return this.group.visible && !HOPS.has(this.state); }
  /** Where the cat is headed or resting, and where it walks, for a rebuild (world.build creates a new cat). */
  memo() {
    const p = this.group.position, H = this.hop;
    const at = this.state === 'hopdown' ? { x: H.bx, z: H.bz } : !this.onSpot && this.state !== 'hopup' ? { x: p.x, z: p.z } : null;
    return { spot: this.spots[this.spot]?.id ?? null, nextMove: this.nextMove, at, yaw: this.yaw };
  }

  setEnabled(on) {
    this.group.visible = !!on;
    if (on) return;
    if (this.purring) { this.purring = false; this.onPurr?.(false); }
    if (this.state === 'pet') this.#endPet();
  }

  dispose() {
    if (this.purring) { this.purring = false; this.onPurr?.(false); }
    // never dispose the shared geometry cache - only what this cat created itself (and the instance buffers of the legs
    // and the tail: three.js frees those only on the mesh's own dispose, so every rebuild left three of them behind)
    this.group.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
    for (const m of this.materials) m.dispose();
    this.map?.dispose();
  }

  /** Send the cat to spot i (immediate: it is there, asleep). False when the spot is out of reach: the cat stays put. */
  goTo(i, immediate = false) {
    const s = this.spots[i]; if (!s) return false;
    if (immediate) {
      this.spot = i; this.from = i; this.route = null; this.pending = -1; this.after = null; this.onSpot = true;
      this.group.position.copy(s.position); this.yaw = s.yaw || 0; this.group.rotation.y = this.yaw;
      this.#enter('sleep');
      Object.assign(this.pose, this.#targets(), { stride: 0 });
      return true;
    }
    if (!s.landing) return false;
    if (HOPS.has(this.state)) { this.pending = i; return true; }   // after the jump
    const here = this.state === 'rise' ? this.from : this.spot;     // the seat it is on (still the old one while rising)
    if (this.onSpot && i === here) {
      if (this.state === 'rise') { this.spot = here; this.route = null; this.sitFor = 2; this.#enter('sit'); }
      return true;
    }
    const from = this.onSpot ? this.spots[here]?.landing : this.group.position;
    if (!from) return false;                                        // it cannot get off this seat
    const route = this.nav.path(from, s.landing);
    if (!route) return false;
    this.route = route; this.routeI = 1; this.pending = -1; this.after = null;
    if (this.onSpot) { this.from = here; this.spot = i; this.#enter('rise'); }
    else { this.spot = i; this.#enter('walk'); }
    return true;
  }

  /** E on the cat: returns true when it reacts. */
  pet(from) {
    if (!this.pettable) return false;
    if (from && from.distanceTo(this.group.position) > PET_REACH + 0.8) return false;
    if (this.state !== 'pet') {
      const lying = this.state === 'sleep' || this.state === 'rise';
      // a sleeping cat raises its head and kneads, a sitting one stays upright, a standing one lifts its tail
      this.petPose = lying ? 'lie' : this.onSpot || this.state === 'wait' || this.state === 'linger' ? 'sit' : 'stand';
      // afterwards: back to sleep on its seat (still turning round there: finish that first), or sit a while
      this.after = this.onSpot ? (this.state === 'settle' ? 'settle' : lying ? 'sleep' : 'sit') : 'linger';
      this.sitFor = 3 + Math.random() * 3;
      if (this.state === 'rise') { this.spot = this.from; this.route = null; }   // it stays for more of this
      this.#enter('pet');
      this.sfx?.('mrrp');
    } else this.stateT = Math.min(this.stateT, 0.6);    // stroked again: the rubbing goes on
    if (this.boostT < 1) { this.sfx?.('purr-pet'); this.boostT = 4.2; }
    this.nextMove = Math.max(this.nextMove, 45 + Math.random() * 30);   // a petted cat does not wander off right away
    this.pets++;
    return true;
  }

  // ------------------------------------------------------------------ behaviour ----
  #enter(state) { this.state = state; this.stateT = 0; this.replanT = 0; }

  /** Pick another reachable seat. */
  #wander(exclude = -1) {
    const order = this.spots.map((_, i) => i).filter((i) => i !== this.spot && i !== exclude && this.spots[i].landing);
    for (let k = order.length - 1; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [order[k], order[r]] = [order[r], order[k]]; }
    for (const i of order) if (this.goTo(i)) return true;
    this.nextMove = 30;
    return false;
  }

  update(dt, playerPos = null, seated = false) {
    dt = Math.min(dt, 0.1);
    this.t += dt; this.stateT += dt; this.boostT -= dt;
    // a seated player sits inside the seat's collider: only a standing one can be in the way
    const pl = this.playerCircle || (this.playerCircle = { x: 0, z: 0, r: PLAYER_R + CAT_RADIUS });
    if (playerPos && !seated) { pl.x = playerPos.x; pl.z = playerPos.z; this.player = pl; } else this.player = null;
    this.hopPitch = 0; this.turnRate = 0;
    let speed = 0;
    switch (this.state) {
      case 'sleep': case 'sit': this.#rest(dt); break;
      case 'rise': this.#rise(dt); break;
      case 'hopdown': case 'hopup': this.#hop(dt); break;
      case 'walk': speed = this.#walk(dt); break;
      case 'wait': this.#wait(); break;
      case 'linger': if (this.stateT > this.lingerFor) this.#walkOn(); break;
      case 'prep': this.#prep(dt); break;
      case 'settle': this.#settle(dt); break;
      case 'pet': this.#petting(dt, playerPos); break;
    }
    this.group.rotation.y = this.yaw;
    const d = playerPos ? playerPos.distanceTo(this.group.position) : 99;
    const purr = this.state === 'pet' || (d < 1.6 && RESTING.has(this.state));
    if (purr !== this.purring) { this.purring = purr; this.onPurr?.(purr); }
    this.#look(dt, playerPos);
    this.#applyPose(dt, speed);
  }

  #turn(want, dt, rate) {
    const e = wrap(want - this.yaw), step = clamp(e, -rate * dt, rate * dt);
    this.yaw = wrap(this.yaw + step); this.turnRate = step / Math.max(dt, 1e-4);
    return Math.abs(e - step);
  }

  #rest(dt) {
    if (this.state === 'sit' && this.stateT > this.sitFor) this.#enter('sleep');
    this.nextMove -= dt;
    if (this.nextMove <= 0) { this.nextMove = 70 + Math.random() * 140; this.#wander(); }
  }

  /** Stand up on the seat and turn towards the landing place. */
  #rise(dt) {
    const s = this.spots[this.from];
    const pl = this.player;
    if (pl && Math.hypot(pl.x - s.landing.x, pl.z - s.landing.z) < pl.r + 0.1) {
      // somebody stands where it would land: it stays a little longer
      this.spot = this.from; this.route = null; this.nextMove = 12 + Math.random() * 10; this.sitFor = 3; this.#enter('sit');
      return;
    }
    const left = this.#turn(heading(s.landing.x - s.position.x, s.landing.z - s.position.z), dt, TURN * 0.7);
    if (this.stateT > 0.7 && left < 0.08) this.#startHop('hopdown');
  }

  #startHop(kind) {
    const down = kind === 'hopdown';
    const s = this.spots[down ? this.from : this.spot];
    const a = down ? s.position : s.landing, b = down ? s.landing : s.position;
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    this.hop = { ax: a.x, az: a.z, bx: b.x, bz: b.z, y0: down ? s.position.y : 0, y1: down ? 0 : s.position.y, h: 0.12 + 0.12 * dist, dur: 0.38 + 0.22 * dist, k: 0 };
    this.#enter(kind);
  }

  /** A jump between the seat and its landing place: x/z straight, y on an arc that clears the seat's edge. */
  #hop(dt) {
    const H = this.hop, p = this.group.position, down = this.state === 'hopdown';
    H.k = Math.min(1, H.k + dt / H.dur);
    const k = H.k;
    p.x = lerp(H.ax, H.bx, k); p.z = lerp(H.az, H.bz, k);
    const e = down ? k * k : 1 - (1 - k) * (1 - k);            // falls late when jumping down, rises early when jumping up
    p.y = H.y0 + (H.y1 - H.y0) * e + 4 * H.h * k * (1 - k);
    this.hopPitch = (down ? -0.3 : 0.35) * Math.sin(Math.PI * k);
    if (k < 1) return;
    if (down) { p.y = 0; this.onSpot = false; this.#enter('walk'); }
    else { p.copy(this.spots[this.spot].position); this.onSpot = true; this.route = null; this.#enter('settle'); }
    if (this.pending >= 0) { const i = this.pending; this.pending = -1; this.goTo(i); }
  }

  /** Follow the route; at a sharp corner it stops and turns first, so its body never swings wide. */
  #walk(dt) {
    const p = this.group.position; p.y = 0;
    if (this.player && this.#playerAhead()) { this.#enter('wait'); return 0; }
    while (this.routeI < this.route.length && Math.hypot(this.route[this.routeI].x - p.x, this.route[this.routeI].z - p.z) < 1e-4) this.routeI++;
    let q = this.route[this.routeI];
    if (!q) { this.#enter('prep'); return 0; }
    const want = heading(q.x - p.x, q.z - p.z);
    this.#turn(want, dt, TURN);
    const speed = WALK * clamp((Math.cos(wrap(want - this.yaw)) - 0.35) / 0.65, 0, 1);
    let step = speed * dt;
    while (step > 1e-6 && this.routeI < this.route.length) {
      q = this.route[this.routeI];
      const dx = q.x - p.x, dz = q.z - p.z, dist = Math.hypot(dx, dz);
      if (dist <= step) {
        p.x = q.x; p.z = q.z; step -= dist; this.routeI++;
        const n = this.route[this.routeI];
        if (n && Math.abs(wrap(heading(n.x - p.x, n.z - p.z) - this.yaw)) > 0.5) break;
      } else { p.x += dx / dist * step; p.z += dz / dist * step; step = 0; }
    }
    if (this.routeI >= this.route.length) this.#enter('prep');
    return speed;
  }

  /** Does the next stretch of the route run into the (standing) player? */
  #playerAhead() {
    const pl = this.player, p = this.group.position;
    const now = Math.hypot(pl.x - p.x, pl.z - p.z);
    let budget = 0.9, ax = p.x, az = p.z;
    for (let i = this.routeI; i < this.route.length && budget > 0; i++) {
      const q = this.route[i], seg = Math.hypot(q.x - ax, q.z - az);
      const n = Math.max(1, Math.ceil(Math.min(seg, budget) / 0.1));
      for (let k = 1; k <= n; k++) {
        const f = Math.min(1, (k * 0.1) / (seg || 1));
        const d = Math.hypot(pl.x - (ax + (q.x - ax) * f), pl.z - (az + (q.z - az) * f));
        if (d < pl.r && d < now - 0.02) return true;
      }
      budget -= seg; ax = q.x; az = q.z;
    }
    return false;
  }

  /** Somebody is in the way: sit and wait, then look for a way round, and in the end give the seat up. */
  #wait() {
    if (!this.player || !this.#playerAhead()) { this.#enter('walk'); return; }
    if (this.stateT < 1.2 || this.stateT < this.replanT) return;
    this.replanT = this.stateT + 2;
    const route = this.nav.path(this.group.position, this.spots[this.spot].landing, this.player);
    if (route) { this.route = route; this.routeI = 1; this.#enter('walk'); return; }
    if (this.stateT > 14 && this.#wander(this.spot)) return;
  }

  /** At the landing place: face the seat, crouch, jump. */
  #prep(dt) {
    const s = this.spots[this.spot], p = this.group.position;
    const left = this.#turn(heading(s.position.x - p.x, s.position.z - p.z), dt, TURN);
    if (left > 0.1) this.stateT = Math.min(this.stateT, 0.05);
    else if (this.stateT > 0.35) this.#startHop('hopup');
  }

  /** Up on the seat: turn round to the seat's direction, sit a moment, then lie down. */
  #settle(dt) {
    const s = this.spots[this.spot];
    const left = this.#turn(s.yaw || 0, dt, TURN * 0.7);
    if (left < 0.02 && this.stateT > 0.4) { this.sitFor = 2 + Math.random() * 3; this.#enter('sit'); }
  }

  /** Being petted; on the floor it turns a little towards you when you stand behind it. */
  #petting(dt, playerPos) {
    if (!this.onSpot && playerPos) {
      const p = this.group.position, want = heading(playerPos.x - p.x, playerPos.z - p.z), rel = wrap(want - this.yaw);
      if (Math.abs(rel) > 0.9) this.#turn(want - Math.sign(rel) * 0.6, dt, 1.6);
    }
    if (this.stateT >= PET_TIME) this.#endPet();
  }
  #endPet() {
    const next = this.after || (this.onSpot ? 'sleep' : 'linger');
    this.after = null; this.lingerFor = 5 + Math.random() * 3; this.#enter(next);
  }
  /** After sitting a while on the floor: on along the route, up onto the seat, or (no route) plan a new one. */
  #walkOn() {
    if (this.route && this.routeI < this.route.length) this.#enter('walk');
    else if (this.route) this.#enter('prep');
    else if (!this.goTo(this.spot)) this.lingerFor = this.stateT + 10;   // nowhere to go: it sits on
  }

  /** Head towards the player while awake. */
  #look(dt, playerPos) {
    let yaw = 0, pitch = 0;
    const awake = this.state !== 'sleep' && this.state !== 'walk' && !HOPS.has(this.state);
    if (playerPos && awake) {
      const p = this.group.position;
      const dx = playerPos.x - p.x, dz = playerPos.z - p.z, d = Math.hypot(dx, dz);
      if (d < 3.5) {
        yaw = clamp(wrap(heading(dx, dz) - this.yaw), -1.1, 1.1);
        pitch = clamp(Math.atan2(playerPos.y - 0.25 - (p.y + 0.3), Math.max(0.2, d)), -0.2, 0.75) * (this.state === 'pet' ? 1 : 0.6);
      }
    }
    const k = 1 - Math.exp(-4 * dt);
    this.lookYaw += (yaw - this.lookYaw) * k; this.lookPitch += (pitch - this.lookPitch) * k;
  }

  // ------------------------------------------------------------------ poses ----
  /** Pose targets of the current state. */
  #targets() {
    const T = { lie: 0, sit: 0, headUp: 0, paws: 0, eyes: 1, tailUp: 0, rub: 0, knead: 0, stretch: 0, crouch: 0, swish: 0 };
    const t = this.stateT;
    switch (this.state) {
      case 'sleep': T.lie = 1; T.eyes = 0; break;
      case 'sit': case 'wait': T.sit = 1; break;
      case 'linger': if (t < 0.9) { T.stretch = 1; T.tailUp = 0.6; } else T.sit = 1; T.eyes = t < 2.5 ? 0.35 : 1; break;
      case 'prep': T.crouch = t > 0.05 ? 1 : 0; break;
      case 'pet': {
        const wake = t < 0.4, ending = t > PET_TIME - 0.6;
        const knead = t > 0.7 && !ending ? 1 : 0;
        T.eyes = wake ? 1 : 0;                        // content: the eyes close while it is stroked
        T.rub = wake || ending ? 0 : 1;               // head rubs against the hand
        if (this.petPose === 'lie') { T.lie = 1; T.headUp = ending ? 0 : 1; T.paws = ending ? 0 : 1; T.swish = 1; T.knead = knead; }
        else if (this.petPose === 'sit') { T.sit = 1; T.swish = 1; }
        else { T.tailUp = ending ? 0.3 : 1; T.knead = knead; }   // tail up like a question mark, swishing
        break;
      }
      default: break;                                  // rise, hops, walk, settle: standing
    }
    return T;
  }

  #applyPose(dt, speed) {
    const P = this.pose, T = this.#targets();
    const ease = (k, rate) => { P[k] += (T[k] - P[k]) * (1 - Math.exp(-rate * dt)); };
    ease('lie', 3); ease('sit', 4); ease('headUp', 5); ease('paws', 4); ease('eyes', 9); ease('tailUp', 3.5);
    ease('rub', 5); ease('knead', 4); ease('stretch', 5); ease('crouch', 8); ease('swish', 3);
    P.stride += (clamp(speed / WALK, 0, 1) - P.stride) * (1 - Math.exp(-8 * dt));
    this.gait += dt * (speed * 14 + Math.min(4, Math.abs(this.turnRate)) * 2.5);
    const t = this.t;
    const lie = clamp(P.lie, 0, 1), sit = clamp(P.sit, 0, 1) * (1 - lie), stretch = clamp(P.stretch, 0, 1) * (1 - lie);
    const stand = Math.max(0, 1 - lie - sit), up = clamp(P.headUp, 0, 1) * lie;
    const moving = Math.max(P.stride, Math.min(1, Math.abs(this.turnRate) / 2));

    // --- root: lift the paws onto the ground, lower the body when lying, tilt about the hips --------
    const pitch = sit * 0.34 - stretch * 0.24 + this.hopPitch;
    const bob = moving * Math.abs(Math.sin(this.gait)) * 0.008;
    const lift = 0.042 * stand - 0.035 * lie - 0.022 * sit - 0.035 * P.crouch - 0.012 * stretch + bob;
    const c = Math.cos(pitch), s = Math.sin(pitch), hx = -0.15, hy = 0.03;
    this.root.position.set(hx - (hx * c - hy * s), lift + hy - (hx * s + hy * c), 0);
    this.root.rotation.z = pitch;
    // leans into the stroking hand
    const lean = -Math.sign(this.lookYaw) * Math.min(1, Math.abs(this.lookYaw) * 2) * 0.1 * P.rub * (1 - lie);
    this.root.rotation.x += (lean - this.root.rotation.x) * (1 - Math.exp(-4 * dt));

    // --- torso: flatter when lying (about the belly's centre), breathing while it rests ------------------
    const br = 1 + Math.sin(t * 1.6) * 0.03 * (lie + sit), sq = 1 - 0.2 * lie;
    this.torso.scale.set(br, sq, br);
    this.torso.position.set(0, 0.155 * (1 - sq), 0);
    // the belly hangs low under the barrel, sags onto the floor when it sits and tucks up into the body when it lies
    this.belly.position.set(-0.01 - 0.02 * sit, lerp(0.088 + 0.017 * sit, 0.15, lie), 0);
    this.belly.scale.set(br * (1 + 0.08 * sit), lerp(1 - 0.06 * sit, 0.8, lie), br * (1 + 0.1 * sit));

    // --- legs ------------------------------------------------------------------------------------------
    for (let i = 0; i < 4; i++) {
      const [lx, lz] = this.legs[i], front = i < 2;
      const swing = Math.sin(this.gait + (i % 2 ? Math.PI : 0) + (i > 1 ? 0.7 : 0)) * 0.5 * moving;
      let rz = stand * swing;
      rz += lie * (front ? lerp(-1.3, 1.25, P.paws) : -1.3);   // folded under the body, or stretched out in front
      rz += sit * (front ? -0.34 : 1.15);                       // front legs upright, hind legs tucked
      rz += stretch * (front ? 0.95 : -0.25);
      let ky = 0;
      if (front && P.knead > 0.01) {                             // kneading: the front paws press in turn
        const ph = Math.sin(t * 7 + (i ? Math.PI : 0));
        rz += P.knead * (lie > 0.5 ? 0.16 : 0.22) * ph; ky = P.knead * 0.012 * Math.max(0, ph) * (1 - lie);
      }
      _m.compose(_v.set(lx, 0.135 - 0.05 * lie + ky, lz), _q.setFromAxisAngle(Z, rz), _s.set(1, front ? 1 + sit * 0.19 + stretch * 0.12 : 1, 1));
      this.legMesh.setMatrixAt(i, _m);
    }
    this.legMesh.instanceMatrix.needsUpdate = true;

    // --- head: looks at you, rubs against the hand, tucks in when asleep -------------------------------
    const bunt = Math.sin(t * 3.1);
    this.head.position.set(lerp(0.27, lerp(0.23, 0.265, up), lie) + P.rub * 0.012 * Math.max(0, bunt), lerp(0.245, lerp(0.155, 0.215, up), lie) + P.rub * 0.01 * Math.max(0, bunt), 0);
    const nod = lie * (1 - up) * -0.35 - sit * 0.22 + stretch * 0.28 + P.rub * (0.16 + 0.1 * Math.max(0, bunt)) + this.lookPitch * (1 - lie + up);
    this.head.rotation.set(P.rub * 0.32 * bunt, this.lookYaw * (1 - lie + up), nod);

    // --- eyes: a thin slit, then a small arc when closed; awake it blinks now and then --------------------
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) { this.blinkIn = 2.5 + Math.random() * 4.5; this.blink = BLINK; }
    this.blink = Math.max(0, this.blink - dt);
    const open = clamp(P.eyes, 0, 1) * (1 - Math.sin(Math.PI * this.blink / BLINK));
    this.eyes.scale.y = Math.max(0.1, open); this.eyes.visible = open > 0.12;
    this.lids.visible = open < 0.35;

    // --- tail, in the group's frame from the base of the spine ----------------------------------------
    const ax = this.root.position.x + (-0.26 * c - 0.19 * s), ay = this.root.position.y + (-0.26 * s + 0.19 * c);
    const wUp = clamp(P.tailUp, 0, 1) * (1 - lie), wCurl = lie * (1 - wUp), wSit = sit * (1 - wUp);
    const wWalk = Math.max(0, 1 - wUp - wCurl - wSit);
    const sway = Math.sin(t * 2.4);
    const TP = this.tailP;
    for (let i = 0; i < 12; i++) {
      const f = i / 11, tip = Math.max(0, i - 8);
      // behind, gently swinging
      const wx = ax - i * 0.028, wy = ay + Math.sin(t * 2.2 + i * 0.45) * 0.03 * f + f * 0.09, wz = Math.sin(t * 1.5 + i * 0.35) * 0.035 * f;
      // raised like a question mark, swishing slowly
      const ux = ax - 0.02 - i * 0.006 + tip * 0.024, uy = ay + i * 0.03 - tip * tip * 0.006, uz = sway * 0.07 * f * f;
      // curled from the rump along the flank of the lying body; the tip flicks while it is stroked
      const a = 2.9 + i * 0.15 + Math.sin(t * 0.7 + i * 0.4) * 0.03 + P.swish * Math.max(0, i - 6) * 0.05 * Math.sin(t * 3.2);
      const r = 0.2 + i * 0.002;
      const cx = -0.13 + Math.cos(a) * r, cy = this.root.position.y + 0.075 + i * 0.001, cz = Math.sin(a) * r;
      // wrapped round the front paws when sitting; the tip flicks while it is stroked
      const b = 3.3 - i * 0.15 + P.swish * Math.max(0, i - 7) * 0.06 * Math.sin(t * 3.2);
      const sx = -0.03 + Math.cos(b) * 0.21, sy = 0.034, sz = Math.sin(b) * 0.2;
      TP[i].set(wx * wWalk + ux * wUp + cx * wCurl + sx * wSit, wy * wWalk + uy * wUp + cy * wCurl + sy * wSit, wz * wWalk + uz * wUp + cz * wCurl + sz * wSit);
    }
    // every segment is stretched along the tail (towards its neighbours), so the chain reads as one furry tail
    for (let i = 0, nf = 0, nr = 0; i < 12; i++) {
      const p = TP[i], rr = this.tailR[i];
      _v.subVectors(TP[Math.min(11, i + 1)], TP[Math.max(0, i - 1)]);
      if (_v.lengthSq() < 1e-10) _v.set(1, 0, 0);
      _q.setFromRotationMatrix(_m.lookAt(p, _v.add(p), Y));
      _m.compose(p, _q, _s.set(rr, rr, rr * 1.45));
      if (TAIL_RING[i]) this.tailRings.setMatrixAt(nr++, _m); else this.tailFur.setMatrixAt(nf++, _m);
    }
    this.tailFur.instanceMatrix.needsUpdate = true; this.tailRings.instanceMatrix.needsUpdate = true;

    // --- pick volume follows the silhouette with a few centimetres to spare ------------------------------
    this.pick.position.set(0.04 * stand + 0.03 * sit, 0.2 * stand + (0.09 + 0.03 * up) * lie + 0.2 * sit, 0);
    this.pick.scale.set(0.37 * stand + 0.31 * lie + 0.27 * sit, 0.21 * stand + (0.15 + 0.04 * up) * lie + 0.28 * sit, 0.2 * stand + 0.28 * lie + 0.2 * sit);
  }
}
