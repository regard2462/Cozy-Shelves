// The seasons in the garden (settings.season through season.js: by the calendar or chosen). Spring: a fresh light green,
// the fruit trees in white and pink blossom, white, yellow, blue and pink flowers in the meadow, young red lily pads
// and buds, last year's dry reed stems between the new ones. Summer: a deep green, poppies and cornflowers in the
// meadow, the lilies in bloom. Autumn: the beeches copper, the birches gold, the oaks brown, the shrubs red, every tree a
// little different (trees.js LEAF_SEASONS, nature.js); fallen leaves on the lawn, the paths and the boards, now and then
// a leaf drifting down; the lily pads yellowing, the reeds golden. Winter: the broadleaf trees bare, snow on the ground,
// on the conifers, the roofs and the jetty, a few withered lily pads, pale straw reeds, the lake dark with a thin rim of
// ice along the shore. A change of season never builds anything: colours, textures and counts are swapped, the colours
// blend over a few seconds (NATURE.uSeason).
import * as THREE from 'three';
import { seasonOf, SEASONS } from './season.js';
import { NATURE, foliageTexture } from './nature.js';
import { FLORA, floraGeometry, floraMesh } from './flora.js';
import { TREES, WATER_Y, groundHeight, terrainHeight, onJetty, JETTY } from './outdoor.js';

const L = (r, g, b) => new THREE.Color().setRGB(r, g, b);
/** Per season (linear colours): the lawn's blades and ground, the reeds' parts and how many stems are last year's. */
const LOOK = {
  spring: { grass: L(0.94, 1.1, 0.74), stem: L(0.17, 0.27, 0.07), leaf: L(0.15, 0.27, 0.06), plume: L(0.42, 0.38, 0.33), dry: L(0.44, 0.38, 0.24), old: 0.42, cattail: L(0.15, 0.27, 0.06), cob: L(0.2, 0.15, 0.1) },
  summer: { grass: L(1, 1, 1), stem: L(0.15, 0.21, 0.07), leaf: L(0.12, 0.19, 0.06), plume: L(0.3, 0.2, 0.19), dry: L(0.42, 0.36, 0.22), old: 0.06, cattail: L(0.12, 0.2, 0.06), cob: L(0.12, 0.065, 0.03) },
  autumn: { grass: L(1.12, 1.0, 0.7), stem: L(0.36, 0.28, 0.1), leaf: L(0.42, 0.3, 0.08), plume: L(0.52, 0.47, 0.42), dry: L(0.44, 0.38, 0.24), old: 0.0, cattail: L(0.36, 0.27, 0.08), cob: L(0.13, 0.07, 0.035) },
  winter: { grass: L(1.0, 0.92, 0.7), stem: L(0.42, 0.37, 0.27), leaf: L(0.45, 0.4, 0.29), plume: L(0.44, 0.42, 0.4), dry: L(0.42, 0.37, 0.27), old: 0.0, cattail: L(0.42, 0.36, 0.25), cob: L(0.32, 0.27, 0.22) },
};
/** The meadow's flowers: colours (sRGB) and the share of them in bloom. */
const MEADOW = {
  spring: { share: 1, cols: [0xffffff, 0xffffff, 0xfafaf2, 0xf2d23c, 0xf0cc30, 0x92a9ea, 0xe6a6c8, 0x9c7cd2] },
  summer: { share: 1, cols: [0xd8342a, 0xc8281e, 0x4a6ad8, 0xf4f0e8, 0xf0d040, 0xa86ab8, 0xd88aa8, 0xffffff] },
  autumn: { share: 0.32, cols: [0x9a78c8, 0x8c6cc0, 0xe0b840, 0xe8e4dc, 0xc89a40] },
  winter: { share: 0, cols: [0xffffff] },
};
const DECIDUOUS = new Set(['beech', 'oak', 'birch', 'bush', 'fruit']);

// ---------------------------------------------------------------- falling leaves ------------------------------------
/** A leaf: a pointed oval, 6 cm, a little folded along its midrib (flora kind 10, coloured per instance). */
function leafGeometry(count) {
  const pos = [0, 0, 0], nor = [0, 1, 0], uv = [0.5, 0], part = [10, 0, 0, 0], idx = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2, x = Math.sin(a) * 0.016 * (1 - 0.35 * Math.cos(a)), z = 0.03 - Math.cos(a) * 0.03;
    pos.push(x, Math.abs(x) * 0.25, z); nor.push(0, 1, 0); uv.push(0.5 + x / 0.04, z / 0.06); part.push(10, 0, 0, 0);
  }
  for (let i = 1; i <= N; i++) idx.push(0, i + 1 > N ? 1 : i + 1, i);
  const g = floraGeometry({ pos, nor, uv, part, idx }, count);
  return g;
}
const FALL_COLS = [0xd8a030, 0xd07a22, 0xb85a1e, 0x9a6a2a, 0xc0382a, 0xe0b840].map((c) => new THREE.Color(c));
class FallingLeaves {
  constructor(n = 44) {
    this.mesh = floraMesh(leafGeometry(n), n, 'falling-leaves');
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.leaves = Array.from({ length: n }, () => ({ on: false }));
    this.spawnT = 0; this.near = []; this.nearT = 0; this.rate = 0;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3();
    this.c = new THREE.Color();
  }
  /** rate: leaves per second round the eye (0: none fall, those lying fade away). */
  update(dt, time, camera, rate, wind) {
    this.rate = rate;
    const cam = camera.position;
    // the broadleaf trees within 32 m, looked up again now and then
    this.nearT -= dt;
    if (this.nearT <= 0) { this.nearT = 1; this.near = TREES.filter((t) => DECIDUOUS.has(t.sp) && Math.hypot(t.x - cam.x, t.z - cam.z) < 32); }
    if (rate > 0 && this.near.length) {
      this.spawnT -= dt * rate * (1 + wind * 1.5);
      while (this.spawnT <= 0) {
        this.spawnT += 1;
        const leaf = this.leaves.find((l) => !l.on);
        if (!leaf) break;
        const t = this.near[Math.floor(Math.random() * this.near.length)];
        const crown = (t.sp === 'bush' ? 1.6 : t.sp === 'fruit' ? 3.2 : t.sp === 'birch' ? 8.5 : 9.5) * t.scale, spread = (t.sp === 'bush' ? 0.8 : t.sp === 'birch' ? 1.6 : 2.8) * t.scale;
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
        Object.assign(leaf, {
          on: true, x: t.x + Math.cos(a) * r, z: t.z + Math.sin(a) * r, y: terrainHeight(t.x, t.z) + crown * (0.5 + Math.random() * 0.6),
          fall: 0.8 + Math.random() * 0.7, sway: 0.25 + Math.random() * 0.5, period: 1.6 + Math.random() * 1.6, phase: Math.random() * 10,
          spin: (Math.random() - 0.5) * 6, rot: Math.random() * 6, lie: 0, life: 0, col: FALL_COLS[Math.floor(Math.random() * FALL_COLS.length)], tone: 0.8 + Math.random() * 0.35,
        });
      }
    }
    let n = 0;
    const { m, q, e, p, s } = this;
    for (const l of this.leaves) {
      if (!l.on) continue;
      l.life += dt;
      let scale = 1;
      if (!l.lie) {
        // a pendulum glide down, drifting with the wind
        const sw = Math.sin((l.life + l.phase) * Math.PI * 2 / l.period);
        l.x += (Math.cos(l.phase) * sw * l.sway * 1.6 + wind * 0.9) * dt;
        l.z += (Math.sin(l.phase) * sw * l.sway * 1.6 + wind * 0.3) * dt;
        l.y -= l.fall * (0.7 + 0.5 * Math.abs(sw)) * dt;
        l.rot += l.spin * dt;
        const ground = onJetty(l.x, l.z) ? JETTY.top : Math.max(groundHeight(l.x, l.z), WATER_Y);
        if (l.y <= ground + 0.012) { l.y = ground + (ground === WATER_Y ? 0.004 : 0.012); l.lie = l.life; }
        e.set(sw * 0.9, l.rot, Math.cos(l.life * 2.1 + l.phase) * 0.7);
      } else {
        // lying a while, then gone (on the water it drifts a little)
        const lay = l.life - l.lie;
        if (Math.abs(l.y - WATER_Y) < 0.01) { l.x += wind * 0.08 * dt; l.z += 0.03 * dt; }
        scale = 1 - Math.max(0, (lay - 6) / 1.5);
        if (scale <= 0) { l.on = false; continue; }
        e.set(0, l.rot, 0);
      }
      q.setFromEuler(e);
      m.compose(p.set(l.x, l.y, l.z), q, s.setScalar(Math.max(0.001, scale)));
      this.mesh.setMatrixAt(n, m);
      this.mesh.setColorAt(n, this.c.copy(l.col).multiplyScalar(l.tone));
      n++;
    }
    this.mesh.count = n;
    if (n) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; }
    this.mesh.visible = n > 0;
  }
}

// ---------------------------------------------------------------- the seasons -------------------------------------------
/**
 * The season of the garden. set(setting) when the settings change ('auto' follows the calendar, checked every
 * minute), apply({ night, weather }) after the environment has set the sky's light (garden.js), update(dt, time,
 * camera) every frame. `parts`: { lilies (lilies.js), water (water.js), flowers: { geo, points } (the meadow's),
 * fruitMaterial (the fruit trees' leaves: their texture is swapped for the blossom in spring) }.
 */
export class Seasons {
  constructor(parts) {
    this.parts = parts;
    this.setting = 'auto'; this.name = null;
    this.w = new THREE.Vector4(0, 1, 0, 0);       // the blended weights (spring, summer, autumn, winter)
    this.target = new THREE.Vector4(0, 1, 0, 0);
    this.weather = 'clear'; this.night = 0; this.check = 0;
    this.leaves = new FallingLeaves();
    this.group = new THREE.Group(); this.group.name = 'seasons'; this.group.add(this.leaves.mesh);
    this.fruit = parts.fruitMaterial || null;
    this.fruitTex = this.fruit ? { leaves: this.fruit.map, blossom: foliageTexture('fruit-blossom') } : null;
    this.cols = { grass: new THREE.Color(), stem: new THREE.Color(), leaf: new THREE.Color(), plume: new THREE.Color(), dry: new THREE.Color(), cattail: new THREE.Color(), cob: new THREE.Color() };
  }
  /** The setting ('auto' | 'spring' | …). Returns the season it means. */
  set(setting = 'auto', { instant = false } = {}) {
    this.setting = setting;
    const name = seasonOf(setting);
    if (name !== this.name) {
      this.name = name;
      this.target.set(...SEASONS.map((s) => (s === name ? 1 : 0)));
      if (instant || !this.started) this.w.copy(this.target);
      this.#switch();
      this.#blend();
    }
    return name;
  }
  /** What changes at once: the blossom, the bare trees, the lilies, the meadow's flowers. */
  #switch() {
    const name = this.name, P = this.parts;
    if (this.fruit) { const tex = name === 'spring' ? this.fruitTex.blossom : this.fruitTex.leaves; if (this.fruit.map !== tex) this.fruit.map = tex; }
    P.lilies?.setSeason(name, this.weather === 'snow');
    const fl = P.flowers;
    if (fl) {
      // a drift of one colour each, here and there a flower of another kind among them
      const look = MEADOW[name], cols = look.cols.map((c) => new THREE.Color(c)), col = fl.geo.attributes.color, patch = fl.geo.userData.patch;
      for (let i = 0; i < col.count; i++) {
        const odd = (Math.imul(i, 2654435761) >>> 28) < 2, c = cols[((patch ? patch[i] : i) * 7 + (odd ? 3 + (i % 5) : 0)) % cols.length];
        col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
      fl.geo.setDrawRange(0, Math.round(col.count * look.share));
      fl.points.visible = look.share > 0 && this.weather !== 'snow';
    }
    this.#snow();
  }
  /** The weather and the light (garden.apply, right after the environment has set the sky's light): snow lies in
   *  winter, bare trees, the lilies open by day. */
  apply({ night = 0, weather = 'clear' } = {}) {
    const was = this.weather;
    this.weather = weather; this.night = night;
    // the weather's own snow and bare trees, as environment.js has just set them (the season adds its own: #snow)
    this.weatherSnow = NATURE.uSnow.value; this.weatherBare = NATURE.uWinter.value;
    if ((was === 'snow') !== (weather === 'snow')) this.#switch();
    this.parts.lilies?.setOpen(1 - THREE.MathUtils.smoothstep(night, 0.25, 0.7));
    // snow lying in winter throws the light back up, and a snowy night is never quite dark (environment.js does the same
    // while it snows): on the light the environment has just set
    const extra = this.name === 'winter' && weather !== 'snow' ? (weather === 'rain' || weather === 'storm' ? 0.55 : 1) : 0;
    if (extra > 0) {
      const g = NATURE.uGroundLight.value;
      g.setRGB(g.r * (1 + extra * (0.5 / 0.09 - 1)), g.g * (1 + extra * (0.52 / 0.11 - 1)), g.b * (1 + extra * (0.56 / 0.055 - 1)));
      NATURE.uSkyLight.value.add(L(0.018, 0.02, 0.028).multiplyScalar(night * extra));
    }
    this.#snow();
  }
  #snow() {
    const snowing = this.weather === 'snow', winter = this.name === 'winter';
    // bare in winter (and whenever the weather makes them so: while it snows, as before)
    NATURE.uWinter.value = Math.max(this.weatherBare ?? (snowing ? 1 : 0), winter ? 1 : 0);
    // snow lies in winter (wet and patchy while it rains), and as much as the weather brings
    NATURE.uSnow.value = Math.max(this.weatherSnow ?? (snowing ? 1 : 0), this.w.w * (this.weather === 'rain' || this.weather === 'storm' ? 0.55 : 1));
    this.parts.water?.setWinter?.(this.w.w, snowing);
  }
  /** The colours for the blended weights. */
  #blend() {
    const w = this.w, c = this.cols;
    const tmp = this.tmp ||= new THREE.Color();
    const mix = (key, out) => { out.setRGB(0, 0, 0); SEASONS.forEach((s, i) => out.add(tmp.copy(LOOK[s][key]).multiplyScalar(w.getComponent(i)))); return out; };
    NATURE.uSeason.value.copy(w);
    NATURE.uGrassTint.value.copy(mix('grass', c.grass));
    NATURE.uLitter.value = w.z;
    FLORA.uReedStem.value.copy(mix('stem', c.stem));
    FLORA.uReedLeaf.value.copy(mix('leaf', c.leaf));
    FLORA.uReedPlume.value.copy(mix('plume', c.plume));
    FLORA.uReedDry.value.copy(mix('dry', c.dry));
    FLORA.uCattail.value.copy(mix('cattail', c.cattail));
    FLORA.uCob.value.copy(mix('cob', c.cob));
    FLORA.uReedOld.value = SEASONS.reduce((a, s, i) => a + LOOK[s].old * w.getComponent(i), 0);
  }
  update(dt, time, camera) {
    this.started = true;
    // 'auto': the calendar may turn while the world runs
    this.check -= dt;
    if (this.check <= 0) { this.check = 60; if (this.setting === 'auto') this.set('auto'); }
    if (!this.w.equals(this.target)) {
      // the colours follow over some three seconds, whatever the frame rate
      const k = 1 - Math.exp(-dt / 0.6);
      for (let i = 0; i < 4; i++) { const v = this.w.getComponent(i), t = this.target.getComponent(i); this.w.setComponent(i, Math.abs(t - v) < 0.004 ? t : v + (t - v) * k); }
      this.#blend();
      this.#snow();
    }
    // now and then a leaf drifts down in autumn (fewer in rain or snow)
    const rate = this.w.z * (this.weather === 'snow' || this.weather === 'rain' ? 0.25 : 1) * 1.6;
    if (camera) this.leaves.update(dt, time, camera, rate, NATURE.uWind.value);
  }
  /** Jump to the end of a change (the checks, screenshots). */
  settle() { this.w.copy(this.target); this.#blend(); this.#snow(); }
}
