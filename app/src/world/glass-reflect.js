// The rooms mirrored in their windows at night. A window at night shows a faint picture of the lit room in front of the
// dark garden; without it the windows of the book room were black holes. Each room (the hall, the book room) is
// photographed from its middle into a small cube map (only the rooms: the garden, the sky and the weather are left out,
// dark behind the windows at night anyway), again only when its light changes (dusk, the brightness or the warmth of the
// lamps, a film dimming the hall, new books), one face per frame. The glass (materials.js) looks the mirrored ray up where
// it meets the room's walls (box projection), weighted like real glass (4 % straight on, more at a slant). By day the
// bright garden outshines it: then it is neither drawn nor photographed, also on a grey day.
import * as THREE from 'three';
import { HALL, ROOM } from './layout.js';
import { HOUSE } from './outdoor.js';
import { GLASS_LAMPS } from './materials.js';

const SIZE = 256;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class RoomReflections {
  constructor(world) {
    this.world = world;
    const U = GLASS_LAMPS.room;
    const rooms = [
      { min: [HALL.x0, 0, HALL.z0], max: [HALL.x1, HALL.h, HOUSE.front], centre: [0, 1.9, 0.6], tex: U.uRoomA, bmin: U.uBoxAMin, bmax: U.uBoxAMax, bc: U.uBoxACentre },
      { min: [ROOM.x0, 0, ROOM.z0], max: [ROOM.x1, ROOM.h, ROOM.z1], centre: [0, 1.9, (ROOM.z0 + ROOM.z1) / 2], tex: U.uRoomB, bmin: U.uBoxBMin, bmax: U.uBoxBMax, bc: U.uBoxBCentre },
    ];
    this.rooms = rooms.map((r) => {
      const rt = new THREE.WebGLCubeRenderTarget(SIZE, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
      const cam = new THREE.CubeCamera(0.05, 80, rt);
      cam.position.set(...r.centre); cam.updateMatrixWorld(true);
      r.tex.value = rt.texture; r.bmin.value.set(...r.min); r.bmax.value.set(...r.max); r.bc.value.set(...r.centre);
      return { rt, cam };
    });
    U.uRoomSplitZ.value = (HALL.z0 + ROOM.z1) / 2;
    this.queue = [];
    this.key = '';
    this.version = 0;
    this.captures = 0;       // faces drawn (the checks)
    this.timer = 0;
  }
  /** Photograph the rooms again (after a build or new books). */
  invalidate() { this.version++; }
  /** Every frame: how strong the mirror is; when the light changed, the next face. */
  frame(dt = 0.016) {
    const w = this.world, env = w.env;
    if (!env) return;
    // (the sun's dark, not the weather's: a grey noon has no mirror in its windows)
    const night = 1 - (env.day ?? 1);
    // ('mobile': no mirror; each new photograph drew the rooms twelve times more, and their programs were some sixty
    // more to compile on a phone)
    GLASS_LAMPS.room.uRoomRefl.value = w.mobile ? 0 : smooth(0.35, 0.85, night) * 0.6;
    if (w.mobile) return;
    if (night < 0.35) return;
    if (!this.queue.length) {
      // (the key is looked at four times a second)
      this.timer -= dt;
      if (this.timer > 0) return;
      this.timer = 0.25;
      const key = this.#key(night);
      if (key === this.key) return;
      this.key = key;
      for (const room of this.rooms) for (let face = 0; face < 6; face++) this.queue.push([room, face]);
    }
    const [room, face] = this.queue.shift();
    this.#draw(room, face);
  }
  /** What the rooms' light depends on: the night, the lamps, the settings, the build. */
  #key(night) {
    const w = this.world, s = w.settings || {};
    let lamps = 0; for (const l of w.lamps || []) lamps += l.base * (l.hall ? 1 - (w.cinema?.hallDim || 0) : 1);
    return [Math.round(night * 4), (s.light?.brightness ?? 1).toFixed(2), (s.light?.warmth ?? 0.65).toFixed(2), lamps.toFixed(1), Math.round((w.env?.golden || 0) * 4), this.version].join('|');
  }
  /** The glass would mirror itself, and only the rooms count: hidden while a room is photographed (the garden's lights
   *  stay: the number of lights is part of every shader program, one light fewer would compile them all again). */
  #hide() {
    const w = this.world, env = w.env, hidden = [];
    for (const o of [...env.scenery.children, env.sky, env.stars?.points, env.rain, env.weather?.splash, env.snow, w.wildlife?.group, w.godrays?.motes?.points]) if (o?.visible && !o.isLight) { hidden.push(o); o.visible = false; }
    w.scene.traverse((o) => { if (o.visible && o.material?.userData?.lamps === GLASS_LAMPS) { hidden.push(o); o.visible = false; } });
    return hidden;
  }
  #draw(room, face) {
    const w = this.world, r = w.renderer, scene = w.scene;
    const cam = room.cam;
    if (cam.coordinateSystem !== r.coordinateSystem) { cam.coordinateSystem = r.coordinateSystem; cam.updateCoordinateSystem(); cam.updateMatrixWorld(true); }
    const hidden = this.#hide();
    const prev = r.getRenderTarget(), prevFace = r.getActiveCubeFace(), prevMip = r.getActiveMipmapLevel();
    try {
      r.setRenderTarget(room.rt, face);
      r.render(scene, cam.children[face]);
      this.captures++;
    } finally {
      r.setRenderTarget(prev, prevFace, prevMip);
      for (const o of hidden) o.visible = true;
    }
  }
  dispose() { for (const room of this.rooms) room.rt.dispose(); }
}
