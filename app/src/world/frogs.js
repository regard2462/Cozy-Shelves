// Frogs at the lake: green pond frogs sitting on the lily pads and at the water's edge, their throats swelling as they
// breathe; now and then one jumps into the water with a ring of ripples and comes up again a while later, only its eyes
// above the water at first, then it climbs back onto a pad. They jump off when somebody comes close outside. Most of
// them at dusk and in the warm months, a few by day, none in winter. The rings of the splashes are the lake's small
// ripples for everything else too (a swallow drinking, a koi at the surface).
//   The frogs share the birds' material and shader program (bird-models.js); the rings are one instanced quad.
import * as THREE from 'three';
import { buildFrog, creatureMaterial, poseAttributes } from './bird-models.js';
import { WATER_Y, terrainHeight } from './outdoor.js';
import { lilyPads, shoreSpots, depthAt } from './pond.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

let ringTex = null;
/** A ring of ripple: bright and narrow, a fainter one inside it. */
function ringTexture() {
  if (ringTex) return ringTex;
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d');
  for (const [r, w, a] of [[0.45, 0.035, 0.85], [0.33, 0.03, 0.4]]) {
    const gr = g.createRadialGradient(N / 2, N / 2, (r - w) * N, N / 2, N / 2, (r + w) * N);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
  }
  ringTex = new THREE.CanvasTexture(c);
  return ringTex;
}

/** How many frogs are about: by the season, the light and the weather (rain brings them out, cold keeps them away). */
function frogsWanted(season, light, weather) {
  if (season === 'winter' || weather === 'snow' || weather === 'storm') return 0;
  const table = { spring: { day: 3, dusk: 6, night: 4 }, summer: { day: 4, dusk: 8, night: 6 }, autumn: { day: 1, dusk: 3, night: 2 } };
  const n = table[season]?.[light] ?? 0;
  return Math.min(10, n + (weather === 'rain' && n ? 2 : 0));
}

class Frog {
  constructor() {
    this.pos = new THREE.Vector3(); this.yaw = 0; this.state = 'under'; this.t = 0; this.wait = rand(2, 20);
    this.home = null; this.jump = null; this.legs = 0; this.breath = Math.random() * 10; this.gulp = 0; this.pitch = 0.22;
    this.scale = rand(0.85, 1.15); this.seen = false;
  }
}

export class Frogs {
  constructor(owner) {
    this.owner = owner; this.world = owner.world;
    this.group = new THREE.Group(); this.group.name = 'frogs';
    this.N = 10;
    const g = buildFrog(0);
    this.at = poseAttributes(g, this.N);
    this.mesh = new THREE.InstancedMesh(g, creatureMaterial(), this.N);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = false; this.mesh.receiveShadow = true;
    this.mesh.userData.noAO = true; this.mesh.renderOrder = 10; this.mesh.name = 'frogs';
    this.group.add(this.mesh);
    // the rings on the water: additive, faded by their colour, drawn after the water and the koi
    const rm = new THREE.MeshBasicMaterial({ map: ringTexture(), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    rm.name = 'ripples';
    this.rings = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), rm, 24);
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(24 * 3), 3);
    this.rings.count = 0; this.rings.frustumCulled = false; this.rings.renderOrder = 4.6; this.rings.userData.noAO = true; this.rings.name = 'ripples';
    this.group.add(this.rings);
    this.ringList = [];
    this.frogs = []; this.homes = null; this.clock = 0; this.checkT = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(); this._v = new THREE.Vector3(); this._c = new THREE.Color();
    this._f = new THREE.Frustum(); this._pm = new THREE.Matrix4(); this._sph = new THREE.Sphere();
    this.prewarm = 4;
  }
  /** Where frogs sit: the lily pads (from the garden, or as the water shader draws them) and the edge of the shore. */
  prepare() {
    if (this.homes) return;
    const pads = lilyPads(this.world.env?.garden).filter((p) => p.r >= 0.18).map((p) => ({ kind: 'pad', x: p.x, z: p.z, y: (p.y ?? WATER_Y) + 0.004, r: p.r, notch: p.notch, by: null }));
    const shore = shoreSpots().filter((_, i) => i % 3 === 0).map((s) => ({ kind: 'shore', x: s.x, z: s.z, y: s.y, yaw: s.yaw, by: null }));
    this.homes = [...pads, ...shore];
    this.pads = pads.length; this.shore = shore.length;
  }
  clear() { for (const h of this.homes || []) h.by = null; this.frogs = []; this.mesh.count = 0; this.ringList = []; this.rings.count = 0; }
  dispose() { this.mesh.geometry.dispose(); this.rings.geometry.dispose(); this.rings.material.dispose(); }

  /** A ring of ripples at (x, z); `size` about 1 for a frog. */
  ring(x, z, size = 1, small = false) {
    const n = small ? 1 : 2;
    for (let i = 0; i < n; i++) this.ringList.push({ x, z, t: -i * 0.28, life: small ? 0.9 : 1.5, size: (small ? 0.35 : 0.7) * size });
    while (this.ringList.length > 24) this.ringList.shift();
  }

  /** A free home near (x, z) or anywhere; pads more often than the shore. */
  #freeHome(near = null) {
    const free = this.homes.filter((h) => !h.by);
    if (!free.length) return null;
    if (near) { free.sort((a, b) => Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z)); return free[Math.floor(Math.random() * Math.min(3, free.length))]; }
    const pads = free.filter((h) => h.kind === 'pad');
    return pads.length && Math.random() < 0.7 ? pads[Math.floor(Math.random() * pads.length)] : free[Math.floor(Math.random() * free.length)];
  }
  #sitOn(f, h) {
    if (f.home && f.home !== h) f.home.by = null;
    f.home = h; h.by = f; f.state = 'sit'; f.t = 0; f.wait = rand(40, 150); f.legs = 0;
    // on a pad a little off its middle, facing out over the water; on the shore facing the water
    const a = rand(0, TAU), r = h.kind === 'pad' ? h.r * rand(0.1, 0.35) : 0;
    f.pos.set(h.x + Math.cos(a) * r, h.kind === 'pad' ? h.y : terrainHeight(h.x, h.z), h.z + Math.sin(a) * r);
    f.yaw = h.kind === 'pad' ? rand(-Math.PI, Math.PI) : h.yaw + rand(-0.6, 0.6);
  }
  /** Into the water: a jump of half a metre to a metre, away from `from` when given. */
  #dive(f, from = null) {
    let a = from ? Math.atan2(f.pos.x - from.x, f.pos.z - from.z) + rand(-0.5, 0.5) : f.yaw + rand(-0.4, 0.4);
    let to = null;
    for (let k = 0; k < 12 && !to; k++) {
      const d = rand(0.5, 1.1), x = f.pos.x + Math.sin(a) * d, z = f.pos.z + Math.cos(a) * d;
      if (depthAt(x, z) > 0.12) to = new THREE.Vector3(x, WATER_Y - 0.04, z);
      else a += 0.6;
    }
    if (!to) to = f.pos.clone().setY(WATER_Y - 0.04);
    f.yaw = Math.atan2(to.x - f.pos.x, to.z - f.pos.z);
    f.jump = { from: f.pos.clone(), to, T: 0.4, s: 0, h: 0.12 + f.pos.distanceTo(to) * 0.08, into: true };
    f.state = 'jump'; f.t = 0;
    if (f.home) { f.home.by = null; f.home = null; }
  }

  update(dt, posed = true) {
    if (!this.homes) return;
    this.clock += dt;
    const o = this.owner, y = o.sunHeight(), light = y > 0.035 ? 'day' : y > -0.12 ? 'dusk' : 'night';
    // the garden's lily pads change with the season (lilies.js): the frogs take the pads that are there now
    if (this.homes && this.homesSeason !== o.seasonNow()) { this.clear(); this.homes = null; this.prepare(); }
    this.homesSeason = o.seasonNow();
    const want = frogsWanted(o.seasonNow(), light, o.weatherNow());
    // the number of frogs: newcomers come up out of the water, frogs no longer wanted go into it
    this.checkT -= dt;
    if (this.checkT <= 0 || o.jumped) {
      this.checkT = 3;
      const active = this.frogs.filter((f) => !f.leaving);
      if (active.length < want) {
        for (let i = active.length; i < want; i++) {
          const f = new Frog(); this.frogs.push(f);
          const h = this.#freeHome();
          if (!h) { f.gone = true; continue; }
          if (!this.started || o.jumped) this.#sitOn(f, h);
          else { f.state = 'under'; f.wait = rand(1, 12); f.next = h; h.by = f; }
        }
      } else if (active.length > want) {
        for (const f of active.slice(want)) { f.leaving = true; if (f.state === 'sit' && f.seen && !o.jumped) this.#dive(f); else { f.gone = true; } }
      }
      this.started = true;
    }
    const pl = this.world.player.position, outside = o.playerOutside();
    const plMove = Math.hypot(pl.x - (this.plx ?? pl.x), pl.z - (this.plz ?? pl.z)) / Math.max(dt, 1e-3); this.plx = pl.x; this.plz = pl.z;
    for (const f of this.frogs) {
      f.t += dt; f.breath += dt;
      switch (f.state) {
        case 'sit': {
          // breathing: the throat swells and sinks; now and then a deep gulp
          f.gulp = Math.max(0, f.gulp - dt * 2.5);
          if (Math.random() < dt * 0.06) f.gulp = 1;
          const d = Math.hypot(f.pos.x - pl.x, f.pos.z - pl.z);
          if (outside && !this.tame && (d < 2.6 || (d < 4 && plMove > 0.6))) { this.#dive(f, pl); break; }
          if (f.t > f.wait) { if (f.leaving || Math.random() < 0.7) this.#dive(f); else { f.t = 0; f.wait = rand(30, 120); f.yaw += rand(-1, 1); } }
          break;
        }
        case 'jump': {
          const J = f.jump; J.s = Math.min(1, J.s + dt / J.T);
          f.pos.lerpVectors(J.from, J.to, J.s); f.pos.y += Math.sin(J.s * Math.PI) * J.h;
          f.legs = J.s < 0.25 ? J.s / 0.25 : 1;
          f.pitch = 0.22 + (J.into ? -0.9 : -0.4) * Math.sin(J.s * Math.PI * 0.8);
          if (J.s >= 1) {
            if (J.into) {
              // the splash: rings, and the koi dart off
              this.owner.splash(f.pos.x, f.pos.z, 1);
              f.state = 'under'; f.t = 0; f.wait = rand(20, 80);
              if (f.leaving) f.gone = true;
            } else this.#sitOn(f, J.home);
          }
          break;
        }
        case 'under': {
          if (f.t < f.wait) break;
          // up again: first only the eyes look out of the water near a free pad or a place on the shore
          const h = f.next || this.#freeHome(f.pos.lengthSq() ? f.pos : null);
          if (!h) { f.t = 0; break; }
          f.next = h; h.by = f;
          let x = h.x, z = h.z;
          for (let k = 0; k < 8; k++) { const a = rand(0, TAU), r = rand(0.35, 0.7); if (depthAt(h.x + Math.cos(a) * r, h.z + Math.sin(a) * r) > 0.1) { x = h.x + Math.cos(a) * r; z = h.z + Math.sin(a) * r; break; } }
          f.pos.set(x, WATER_Y - 0.026, z); f.yaw = Math.atan2(h.x - x, h.z - z); f.pitch = 0.05; f.legs = 0.6;
          f.state = 'surface'; f.t = 0; f.wait = rand(3, 9);
          this.ring(x, z, 0.35, true);
          break;
        }
        case 'surface': {
          const d = Math.hypot(f.pos.x - pl.x, f.pos.z - pl.z);
          if (outside && !this.tame && d < 2.2) { f.state = 'under'; f.t = 0; f.wait = rand(15, 40); if (f.next) f.next.by = null; f.next = null; this.ring(f.pos.x, f.pos.z, 0.4, true); break; }
          if (f.t > f.wait) {
            // a hop out onto the pad or the shore
            const h = f.next; f.next = null;
            const to = new THREE.Vector3(h.x, h.kind === 'pad' ? h.y : terrainHeight(h.x, h.z), h.z);
            f.jump = { from: f.pos.clone(), to, T: 0.3, s: 0, h: 0.08, into: false, home: h };
            f.state = 'jump'; f.t = 0;
          }
          break;
        }
      }
    }
    if (this.frogs.some((f) => f.gone)) { for (const f of this.frogs) if (f.gone) { if (f.home?.by === f) f.home.by = null; if (f.next?.by === f) f.next.by = null; } this.frogs = this.frogs.filter((f) => !f.gone); }
    // the rings spread and fade
    for (const r of this.ringList) r.t += dt;
    this.ringList = this.ringList.filter((r) => r.t < r.life);
    if (posed) this.#draw();
  }

  #draw() {
    const cam = this.world.camera; cam.updateMatrixWorld();
    this._f.setFromProjectionMatrix(this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let n = 0;
    for (const f of this.frogs) {
      f.seen = false;
      if (f.state === 'under') continue;
      if (f.pos.distanceTo(cam.position) > 40 || !this._f.intersectsSphere(this._sph.set(f.pos, 0.12))) continue;
      f.seen = true;
      const throat = f.state === 'sit' ? 0.0012 + 0.0016 * Math.max(0, Math.sin(f.breath * TAU * 1.4)) + 0.0045 * Math.sin(f.gulp * Math.PI) : 0;
      this._q.setFromEuler(this._e.set(-f.pitch, f.yaw, 0, 'YXZ'));
      this._m.compose(f.pos, this._q, this._s.setScalar(f.scale));
      this.mesh.setMatrixAt(n, this._m);
      this.at.aWing.setXYZW(n, 0, 0, 0, 0);
      this.at.aPose.setXYZW(n, 0, 0, 0, f.state === 'jump' ? -0.3 * f.legs : 0);
      this.at.aPose2.setXYZW(n, 0, 0, throat, f.legs);
      n++;
    }
    if (this.prewarm > 0 && n < this.N) { this.prewarm--; this._m.makeTranslation(0, -80, 0); this.mesh.setMatrixAt(n, this._m); n++; }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true; this.at.aWing.data.needsUpdate = true;
    // the rings: as bright as the sky makes the water (faint at night)
    const sky = this.world.env ? 0.2 + 0.8 * clamp(this.world.env.daylight ?? 1, 0, 1) : 1;
    let k = 0;
    for (const r of this.ringList) {
      if (r.t < 0) continue;
      const u = r.t / r.life, s = r.size * (0.15 + 1.6 * Math.sqrt(u));
      this._m.compose(this._s.set(r.x, WATER_Y + 0.006, r.z), this._q.identity(), this._v.set(s, 1, s));
      this.rings.setMatrixAt(k, this._m);
      this.rings.setColorAt(k, this._c.setScalar(0.13 * (1 - smooth(0.15, 1, u)) * sky));
      k++;
    }
    this.rings.count = k; this.rings.visible = k > 0;
    if (k) { this.rings.instanceMatrix.needsUpdate = true; this.rings.instanceColor.needsUpdate = true; }
  }
  /** Tests and pictures: a frog sitting on the free home nearest to (x, z) now. */
  placeNear(x, z) {
    const h = this.homes.filter((q) => !q.by).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    if (!h) return null;
    const f = new Frog(); this.frogs.push(f); this.#sitOn(f, h); f.wait = 1e9;
    return f;
  }
  info() {
    return { spots: this.homes?.length || 0, pads: this.pads || 0, shore: this.shore || 0, frogs: this.frogs.map((f) => ({ state: f.state, x: +f.pos.x.toFixed(2), y: +f.pos.y.toFixed(3), z: +f.pos.z.toFixed(2), home: f.home?.kind || null, seen: f.seen })), rings: this.ringList.length };
  }
}
