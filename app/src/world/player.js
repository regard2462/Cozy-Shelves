// First-person player: pointer-lock look, WASD movement with smooth acceleration, sliding collision, gentle head bob,
// a short jump (also onto low furniture), steps and falls, sitting/standing transitions and fade-teleports.
import * as THREE from 'three';
import { clamp, lerp, easeInOut } from './geo.js';

export const EYE = 1.62;
const RADIUS = 0.32;           // walls, bookcases, lamps, plants: they keep the camera clear
const LEG = 0.15;              // low furniture (its parts), what stands on it and the cat: only the legs come near them
// The jump: take-off speed and a little more than real gravity give an apex of 0.6 m and 0.63 s in the air, quick
// rather than floaty. Low furniture can be jumped onto: tables, chairs, sofas, benches, low cabinets and loungers
// carry their walkable tops (furniture.js `tops`, world.js turns them into parts of their colliders). A top that ends
// at most LEDGE above the feet near the top of the jump is still reached (the knees pull you up), so a table of 0.76 m
// is; nothing above MAX_TOP ever is, and walls, bookcases, lamps or the backs of seats stop you at any height. Walking
// climbs STEP_UP and walks off any edge, with a fall when it is deeper than a step.
const GRAVITY = 12;
export const JUMP_HEIGHT = 0.6;
const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
const AIR_CONTROL = 0.3;       // in the air the keys change the speed only slowly: the jump keeps its momentum
const STEP_UP = 0.2;           // walking climbs this much, and steps down as much without a fall
const LEDGE = 0.2;             // in the air a top this far above the feet is still reached
export const MAX_TOP = 0.9;    // the highest walkable top
const FEET = 0.12;             // a top carries you while it lies under this circle round your centre
// Nothing may come closer to the rising eye than HEAD_CLEAR: the camera's near plane lies 0.1 m in front of it, its
// corners 0.18 m away. A lamp right above the head stops the jump 0.18 m below its underside, one further to the
// side a little higher, one 0.18 m or more to the side not at all.
const HEAD_CLEAR = 0.18;
const DIP_TIME = 0.32;         // landing: the knees give way a little and straighten again
const Y_AXIS = new THREE.Vector3(0, 1, 0);
/** The length of one step at a pace (m/s): about 1.9 steps a second at the walking pace, 2.6 running, fewer and
 *  shorter steps when slow (the footsteps of audio/steps.js follow it). */
export const stepLength = (pace) => Math.max(0.35, pace / (1 + 0.38 * pace));

/**
 * Low things above the head for Player.setOverhead: every part of a lamp, sconce, picture or anything else whose
 * underside lies between the eye and the top of a jump from the highest walkable top, and colliders that end up there
 * (lintels). Whatever reaches down past the eye stands on the floor with a collider or hangs on a wall, so only these
 * can come near the camera when it rises. One box per mesh: the glow on the wall under a sconce is flat and does not
 * stop a jump in front of it.
 * roots: the placed objects; colliders: [{ min, max }]; floors: the heights of the floors people stand on (the ground
 * floor alone by default): the band above the head is counted from each of them.
 */
export function overheadBoxes(roots = [], colliders = [], floors = [0]) {
  // up to the top of a jump from the highest walkable top
  const lo = EYE - 0.02, hi = MAX_TOP + EYE + JUMP_HEIGHT + HEAD_CLEAR + 0.3;
  const out = [];
  const add = (x0, x1, z0, z1, y, what) => { if (floors.some((f) => y > f + lo && y < f + hi)) out.push({ x0, x1, z0, z1, y, what }); };
  const box = new THREE.Box3();
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      let bb;
      if (o.isInstancedMesh) { if (!o.boundingBox) o.computeBoundingBox(); bb = o.boundingBox; }
      else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); bb = o.geometry.boundingBox; }
      if (!bb || bb.isEmpty()) return;
      box.copy(bb).applyMatrix4(o.matrixWorld);
      add(box.min.x, box.max.x, box.min.z, box.max.z, box.min.y, root.userData.placement?.kind);
    });
  }
  for (const c of colliders) add(c.min[0], c.max[0], c.min[2], c.max[2], c.min[1], 'collider');
  return out;
}

export class Player {
  constructor(camera, domElement, colliders) {
    this.camera = camera; this.dom = domElement; this.colliders = colliders;
    this.position = new THREE.Vector3(5.4, EYE, 0.4);
    this.yaw = -Math.PI / 2; this.pitch = 0;
    this.velocity = new THREE.Vector3();
    this.keys = new Set();
    this.locked = false; this.enabled = true;
    this.sensitivity = 1;
    this.bobT = 0; this.bob = 0;
    this.seated = null;
    this.transition = null;
    this.speedWalk = 2.4; this.speedRun = 4.2;
    this.onStep = null; this.stepAcc = 0;
    this.air = null;                  // { y, v } while in the air: height above the standing eye, vertical speed
    this.ground = 0;                  // what the feet stand on: the floor (0) or a walkable top; the eye is EYE above it
    this.lift = 0;                    // a step up or down moves the eye at once, the camera follows smoothly
    this.catBlock = null;             // { x, z, r }: the cat resting on a seat (world.js), in the way up there
    this.floorAt = null;              // (x, z, ref) => height of the floor; 0 everywhere without it (outside: the deck, the
                                      // jetty, the ground of the garden; world.js wires it to outdoor.js). Where floors lie
                                      // above each other the highest one not above `ref`, the feet plus a step
    this.bounds = null;               // outside: the walkable area, { keep(p, r, feet), free(x, z, r, feet) } (outdoor.js):
                                      // back inside its edge and out of the trunks, or whether a spot is free
    this.speedAt = null;              // (x, z, feet) => factor of the walking speed there (1 without it)
    this.noJumpAt = null;             // (x, z, feet) => true where a jump is not possible
    this.gripAt = null;               // (x, z, feet) => grip of the feet there (1; less on the ice: winter.js)
    this.dip = 0; this.dipT = 0; this.dipAmp = 0;
    this.onLand = null;
    this.overhead = [];               // low things above the head (setOverhead)
    this._dir = new THREE.Vector3(); this._next = new THREE.Vector3();
    this.fov = 72;
    // a gamepad (input/gamepad.js): the left stick { x right, y forward, run } (its length the share of the speed),
    // and the zoom of the right trigger (1 = none)
    this.pad = null; this.zoom = 1;
    this.#bind();
  }
  /** The colliders: { min, max } boxes; furniture with walkable tops carries `parts` (world.js) and is tested by those. */
  get colliders() { return this._colliders; }
  set colliders(list) { this._colliders = list || []; this._walk = null; }
  /** The walkable parts of all colliders (cached until the colliders are set again): tops at most MAX_TOP above the
   *  floor their furniture stands on. */
  get walkParts() { return (this._walk ||= this._colliders.flatMap((c) => (c.parts || []).filter((p) => p.walk && p.top - p.y0 <= MAX_TOP))); }
  #bind() {
    this.noLock = /[?&]nolock=1/.test(location.search);
    // a click into the view captures the mouse again, also while seated (after closing a book at the table
    // only the small "Klicken, um dich umzusehen" pill used to do that)
    this._onClick = () => { if (this.enabled && !this.locked) this.lock(); };
    this._onLockChange = () => { this.locked = document.pointerLockElement === this.dom; this.onLockChange?.(this.locked); };
    this._onMove = (e) => {
      if (!this.locked || !this.enabled) return;
      const s = 0.0022 * this.sensitivity;
      this.yaw -= e.movementX * s; this.pitch -= e.movementY * s;
      this.pitch = clamp(this.pitch, -1.35, 1.35);
    };
    this._onKeyDown = (e) => { if (!e.repeat) this.keys.add(e.code); };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => this.keys.clear();
    this.dom.addEventListener('click', this._onClick);
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('mousemove', this._onMove);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }
  dispose() {
    this.dom.removeEventListener('click', this._onClick);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('mousemove', this._onMove);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
  }
  // requestPointerLock() returns a promise that rejects when the document has no focus (e.g. right after
  // start-up); unhandled, that showed up as a page error on every start
  lock() { if (this.noLock || this.locked) return; try { this.dom.requestPointerLock?.()?.catch?.(() => {}); } catch {} }
  unlock() { if (this.locked) document.exitPointerLock?.(); }

  /** Height of the floor at (x, z): 0 in the rooms, outside the deck, the jetty or the ground of the garden. Where floors
   *  lie above each other the highest one not above `ref`: by default the one you can step onto from where you stand. */
  groundAt(x, z, ref = this.ground + STEP_UP) { return this.floorAt ? this.floorAt(x, z, ref) : 0; }
  /** Stand at (x, z) on the floor (or on `ground`, the height of a walkable top there). */
  setPose(x, z, yaw, pitch = 0, ground = this.groundAt(x, z)) { this.ground = ground; this.lift = 0; this.position.set(x, EYE + ground, z); this.yaw = yaw; this.pitch = pitch; this.velocity.set(0, 0, 0); this.air = null; this.dip = this.dipAmp = 0; }
  get forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  /**
   * Space while standing: a short jump. Not while seated, between two poses (sitting down, standing up, a walk-to),
   * disabled (a panel or the wheel is open) or already in the air. Under a low lamp the jump is only as high as
   * the room above the head allows.
   */
  jump() {
    if (!this.enabled || this.seated || this.transition || this.air) return false;
    if (this.noJumpAt?.(this.position.x, this.position.z, this.ground)) return false;
    const h = Math.min(JUMP_HEIGHT, this.headroom(this.position.x, this.position.z));
    if (h < 0.08) return false;
    this.air = { y: 0, v: Math.sqrt(2 * GRAVITY * h) };
    return true;
  }

  /** Low things above the head: [{ x0, x1, z0, z1, y }] with y the height of their underside (overheadBoxes). */
  setOverhead(list) { this.overhead = list || []; }
  /** How far the eye may rise at (x, z) before something overhead comes closer than HEAD_CLEAR; Infinity when
   *  nothing hangs low there. */
  headroom(x, z) { return this.roomAt(x, z, this.position.y); }
  /** The same for an eye at height `eyeY` (standing on a top: negative when the head would not fit there). */
  roomAt(x, z, eyeY) {
    let room = Infinity;
    const c2 = HEAD_CLEAR * HEAD_CLEAR, knees = eyeY - EYE + 0.3;
    for (const o of this.overhead) {
      if (o.y < knees) continue;   // below the knees (a floor you stand on, seen from below): not overhead
      const dx = x - clamp(x, o.x0, o.x1), dz = z - clamp(z, o.z0, o.z1), d2 = dx * dx + dz * dz;
      if (d2 < c2) room = Math.min(room, o.y - eyeY - Math.sqrt(c2 - d2));
    }
    return room;
  }
  /** What the feet stand on at (x, z): the floor, or the highest walkable top under them that is not higher than
   *  `maxTop` (one above it would have to be climbed). */
  supportAt(x, z, maxTop) {
    let s = this.floorAt ? this.floorAt(x, z, maxTop) : 0;
    for (const p of this.walkParts) if (p.top > s && p.top <= maxTop && partDist2(p, x, z) < FEET * FEET) s = p.top;
    return s;
  }
  /** The feet: the ground, or in the air the height they have reached. */
  get feet() { return this.ground + (this.air ? this.air.y : 0); }
  /** True when the player fits at (x, z) with the feet at `feet` (nothing there stops them). */
  fits(x, z, feet = this.groundAt(x, z)) { const v = (this._probe ||= new THREE.Vector3()).set(x, 0, z); this.#collide(v, feet, false); return Math.abs(v.x - x) < 1e-6 && Math.abs(v.z - z) < 1e-6; }

  /** True when a player-sized cylinder at (x, z) does not overlap any collider (standing on the floor at `floor`: by
   *  default the one at the height you stand at). */
  isFree(x, z, margin = 0.02, floor) {
    const r = RADIUS + margin, base = floor != null ? this.groundAt(x, z, floor + STEP_UP) : this.groundAt(x, z);
    if (this.bounds && !this.bounds.free(x, z, r, base)) return false;
    for (const c of this.colliders) {
      if (c.max[1] < base + 0.25 || c.min[1] > base + EYE) continue;
      const cx = clamp(x, c.min[0], c.max[0]);
      const cz = clamp(z, c.min[2], c.max[2]);
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < r * r) return false;
    }
    return true;
  }

  /**
   * A reachable spot next to a seat: try the seat's own exit direction first, then fan out.
   * Without this, standing up from a bench that faces a wall teleported you outside the building.
   */
  findExit(origin, preferred, maxDist = 1.15) {
    const base = Math.atan2(preferred.x, preferred.z);
    for (const dist of [maxDist, maxDist * 0.75, maxDist * 0.55]) {
      for (const da of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.2, -2.2, Math.PI]) {
        const a = base + da;
        const x = origin.x + Math.sin(a) * dist, z = origin.z + Math.cos(a) * dist;
        // on the floor the seat stands on, not on one below or above it
        if (this.isFree(x, z, 0.05) && Math.abs(this.groundAt(x, z) - this.ground) <= STEP_UP) return new THREE.Vector3(x, EYE + this.groundAt(x, z), z);
      }
    }
    return new THREE.Vector3(origin.x, EYE + this.groundAt(origin.x, origin.z), origin.z);
  }

  /**
   * Slide `next` out of everything in the way at the height of the feet. A walkable top no higher than a step does not
   * stop you (the support takes you up), nor in the air one that the feet are about to clear: that one comes back as
   * `reach` (the highest such top) for the ledge assist; `this.blocked` says whether anything else stopped the move.
   * Everything else stops you at any height: walls, bookcases, lamps, the backs of seats (their solid parts).
   * Outside the walkable area keeps you on it and out of the trunks (bounds), and once more off the furniture that may
   * have put you there.
   */
  #collide(next, feet = 0, inAir = false, again = true) {
    const r = RADIUS, base = this.groundAt(next.x, next.z, feet + STEP_UP);   // the floor or the ground there
    // the knees: over an edge (a table) only what reaches up to the feet is in the way
    const knees = Math.max(base, feet - STEP_UP) + 0.25;
    let reach = null;
    this.blocked = false;
    // a top just above the feet does not stop a jump on its way up (the assist lifts you onto it), nor before the assist
    const ledge = inAir && (!this.air?.assisted || this.air.v > 0);
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const c of this.colliders) {
        if (c.parts) {
          for (const p of c.parts) {
            if (p.y0 > feet + EYE) continue;                               // above the head
            if (p.walk && p.top - p.y0 <= MAX_TOP) {
              if (p.top <= feet + (inAir ? 1e-3 : STEP_UP)) continue;       // under the feet, or a step
              if (ledge && p.top <= feet + LEDGE) { if (partDist2(p, next.x, next.z) < LEG * LEG) reach = Math.max(reach ?? 0, p.top); continue; }
            }
            if (p.top < knees - 0.25 - 0.05) continue;                      // far below the feet
            if (pushOutOfPart(p, next, LEG)) moved = true;
          }
          continue;
        }
        if (c.max[1] < knees || c.min[1] > feet + EYE) continue; // below the knees (rugs, an open door) or above the head (beams)
        const rr = c.prop ? LEG : r;
        const cx = clamp(next.x, c.min[0], c.max[0]);
        const cz = clamp(next.z, c.min[2], c.max[2]);
        const dx = next.x - cx, dz = next.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        if (d2 < 1e-8) { // inside: push out along the smallest penetration axis
          const px = Math.min(next.x - c.min[0], c.max[0] - next.x), pz = Math.min(next.z - c.min[2], c.max[2] - next.z);
          if (px < pz) next.x += (next.x - (c.min[0] + c.max[0]) / 2 > 0 ? 1 : -1) * (px + rr); else next.z += (next.z - (c.min[2] + c.max[2]) / 2 > 0 ? 1 : -1) * (pz + rr);
        } else {
          const d = Math.sqrt(d2); const push = rr - d;
          next.x += dx / d * push; next.z += dz / d * push;
        }
        moved = true;
      }
      // the cat asleep on a seat: up there it is in the way like a cushion that does not give
      const cat = this.catBlock;
      if (cat && feet > 0.25) {
        const dx = next.x - cat.x, dz = next.z - cat.z, d2 = dx * dx + dz * dz, rr = LEG + cat.r;
        if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-6; next.x = cat.x + dx / d * rr; next.z = cat.z + dz / d * rr; moved = true; }
      }
      if (!moved) break;
      this.blocked = true;
    }
    if (this.bounds?.keep(next, r, feet)) {
      if (again) { const more = this.#collide(next, feet, inAir, false); if (more != null) reach = Math.max(reach ?? 0, more); }
      this.blocked = true;
    }
    return reach;
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    if (this.transition) {
      const tr = this.transition; tr.t += dt / tr.duration;
      const k = easeInOut(clamp(tr.t, 0, 1));
      this.position.lerpVectors(tr.from.pos, tr.to.pos, k);
      if (tr.collide) { const next = this.position.clone(); this.#collide(next, this.ground); this.position.x = next.x; this.position.z = next.z; }
      this.yaw = lerp(tr.from.yaw, tr.to.yaw, k); this.pitch = lerp(tr.from.pitch, tr.to.pitch, k);
      // every move ends on the floor (a seat, a spot to stand at, a department; outside the deck, the jetty or the
      // ground) or on a seat
      if (tr.t >= 1) { const done = tr.onDone; this.transition = null; this.ground = Math.max(this.groundAt(this.position.x, this.position.z), this.position.y - EYE); this.lift = 0; done?.(); }
    } else if (!this.seated && this.enabled) {
      const k = this.keys;
      const pad = this.pad;
      const run = k.has('ShiftLeft') || k.has('ShiftRight') || !!pad?.run;
      // (a slower pace with shorter steps where speedAt says so)
      const paceFactor = this.speedAt?.(this.position.x, this.position.z, this.ground) ?? 1;
      const speed = (run ? this.speedRun : this.speedWalk) * paceFactor;
      const dir = this._dir.set(0, 0, 0);
      if (k.has('KeyW') || k.has('ArrowUp')) dir.z -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) dir.z += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) dir.x -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) dir.x += 1;
      // no key held: the stick, as far as it is tilted
      let share = 1;
      if (pad && dir.lengthSq() === 0 && (pad.x || pad.y)) { dir.set(pad.x, 0, -pad.y); share = Math.min(1, dir.length()); }
      const moving = dir.lengthSq() > 0;
      if (moving) dir.normalize().applyAxisAngle(Y_AXIS, this.yaw);
      const target = dir.multiplyScalar(speed * share);
      // (on ice the feet find little grip: starting, stopping and turning take longer, winter.js gripAt)
      const grip = this.air ? 1 : this.gripAt?.(this.position.x, this.position.z, this.ground) ?? 1;
      const accel = (moving ? 10 : 14) * (this.air ? AIR_CONTROL : grip);
      this.velocity.lerp(target, Math.min(1, accel * dt));
      const x0 = this.position.x, z0 = this.position.z;
      if (this.velocity.lengthSq() > 1e-6) {
        const next = this._next.copy(this.position).addScaledVector(this.velocity, dt);
        const feet = this.feet;
        const reach = this.#collide(next, feet, !!this.air);
        // in the air the head has to fit under whatever hangs at the next spot (a low lamp): otherwise it stops there
        let ok = !this.air || this.headroom(next.x, next.z) >= this.air.y;
        // onto a higher top (a step, or one reached in the air) only where the head fits above it
        const up = this.air ? reach : this.supportAt(next.x, next.z, this.ground + STEP_UP);
        if (ok && up != null && up > feet + 1e-4 && this.roomAt(next.x, next.z, EYE + up) < 0) ok = false;
        if (ok) {
          this.position.x = next.x; this.position.z = next.z;
          // the ledge assist, once a jump and only when nothing else is in the way: the jump carries the feet just over
          // the top they end below
          if (this.air && reach != null && !this.blocked && !this.air.assisted) { this.air.v = Math.max(this.air.v, Math.sqrt(2 * GRAVITY * (reach + 0.03 - feet))); this.air.assisted = true; }
        } else this.velocity.set(0, 0, 0);
      }
      // the pace over the ground really covered: walking into a wall makes no steps and no bob
      const pace = Math.min(this.velocity.length(), Math.hypot(this.position.x - x0, this.position.z - z0) / Math.max(dt, 1e-4));
      // the head sinks once per step and the foot lands at its lowest point: one bob per step, as many steps a second as
      // the pace takes (stepLength), a footstep at every lowest point. The depth of the bob fades in and out smoothly, its
      // phase does not lag behind (the step is heard when the head is lowest).
      const before = this.bobT;
      // (gliding on with no key held on the ice: the feet stand still, no steps)
      if (!this.air && pace > 0.05 && (moving || grip > 0.9)) this.bobT += dt * 2 * pace / stepLength(pace);
      this.bobAmp = lerp(this.bobAmp || 0, !this.air && pace > 0.3 ? 0.018 * Math.min(1, pace / 2.4) : 0, dt * 8);   // no bob in the air
      this.bob = Math.sin(this.bobT * Math.PI) * this.bobAmp;
      if (!this.air && Math.floor((this.bobT - 1.5) / 2) > Math.floor((before - 1.5) / 2) && pace > 0.5) this.onStep?.(run, pace);
    }
    if (!this.seated && !this.transition) this.#settle();
    this.#vertical(dt);
    this.lift = Math.abs(this.lift) < 1e-4 ? 0 : this.lift * Math.exp(-dt / 0.06);
    this.camera.position.copy(this.position); this.camera.position.y += this.bob + (this.air ? this.air.y : 0) - this.dip - this.lift;
    this.camera.rotation.set(0, 0, 0, 'YXZ'); this.camera.rotation.y = this.yaw; this.camera.rotation.x = this.pitch;
    const targetFov = (this.seated ? this.fov - 6 : this.fov) / (this.zoom || 1);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) { this.camera.fov = lerp(this.camera.fov, targetFov, dt * 4); this.camera.updateProjectionMatrix(); }
  }

  /** Standing: the top under the feet carries on, a step up or down (the camera follows smoothly; outside also the
   *  slopes of the garden and the step off the deck), or an edge: a fall. */
  #settle() {
    if (this.air) return;
    const s = this.supportAt(this.position.x, this.position.z, this.ground + STEP_UP);
    if (Math.abs(s - this.ground) < 1e-4) return;
    if (s < this.ground - STEP_UP) { this.air = { y: 0, v: 0 }; return; }   // over the edge: gravity takes over
    this.lift += s - this.ground;
    this.ground = s; this.position.y = EYE + s;
  }

  /** The vertical part of a jump or a fall (exact for constant gravity, whatever the frame rate), the landing on the
   *  floor or on a top, and the dip on landing. */
  #vertical(dt) {
    const a = this.air;
    if (a) {
      const y = a.y + a.v * dt - 0.5 * GRAVITY * dt * dt, v = a.v - GRAVITY * dt;
      const room = this.headroom(this.position.x, this.position.z);
      // what the feet come down on: the highest top under them that they have not sunk below
      const feet = this.ground + a.y, s = this.supportAt(this.position.x, this.position.z, feet + 1e-3);
      if (v <= 0 && this.ground + y <= s) {
        // touch down: the speed there follows from the energy of the last state
        const impact = Math.sqrt(a.v * a.v + 2 * GRAVITY * Math.max(0, feet - s));
        this.air = null; this.stepAcc = 0; this.bobT = 1.5;   // the feet land: the next step a whole step later
        this.lift += s - feet;
        this.ground = s; this.position.y = EYE + s;
        this.dipAmp = clamp(impact * 0.02, 0.015, 0.07); this.dipT = 0;
        this.onLand?.(impact);
      } else if (y > room) { a.y = Math.max(room, Math.min(a.y, 0)); a.v = Math.min(0, v); }   // the head reached something: fall from here
      else { a.y = y; a.v = v; }
    }
    if (this.dipAmp > 0) {
      // down quickly, up again smoothly
      this.dipT += dt;
      const k = this.dipT / DIP_TIME;
      if (k >= 1) { this.dip = 0; this.dipAmp = 0; }
      else this.dip = this.dipAmp * (k < 0.3 ? Math.sin(k / 0.3 * Math.PI / 2) : 0.5 + 0.5 * Math.cos((k - 0.3) / 0.7 * Math.PI));
    }
  }

  moveTo(pos, yaw, pitch, duration = 1.2, onDone, opts = {}) {
    // a jump still in the air ends in the move (sitting down in mid-air): it starts where the eye really is
    const from = this.position.clone();
    if (this.air) { from.y += this.air.y; this.air = null; }
    this.transition = { from: { pos: from, yaw: this.yaw, pitch: this.pitch }, to: { pos: pos.clone(), yaw: shortestYaw(this.yaw, yaw), pitch }, t: 0, duration, onDone, collide: !!opts.collide };
    this.velocity.set(0, 0, 0);
  }
  sit(seat) {
    this.seated = { seat, from: { pos: this.position.clone(), yaw: this.yaw, pitch: this.pitch } };
    // ready (for standing up with W A S D) only once this sit-down has finished, also when changing seats
    this.seatedReady = false;
    this.moveTo(seat.eye, seat.yaw, seat.pitch ?? -0.15, 1.0, () => { this.seatedReady = true; });
    this.keys.clear();
  }
  stand() {
    if (!this.seated) return;
    const s = this.seated; this.seated = null; this.seatedReady = false;
    const seat = s.seat;
    const origin = seat.eye ? new THREE.Vector3(seat.eye.x, EYE, seat.eye.z) : this.position.clone();
    const prefer = seat.standPos
      ? new THREE.Vector3(seat.standPos.x - origin.x, 0, seat.standPos.z - origin.z).normalize()
      : new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    if (!prefer.lengthSq()) prefer.set(0, 0, 1);
    const target = this.findExit(origin, prefer, 1.1);
    this.moveTo(target, seat.standYaw ?? this.yaw, 0, 0.8, null, { collide: true });
  }
}
function shortestYaw(from, to) { let d = to - from; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return from + d; }

// A part of a collider (world.js): a rectangle on the floor plane turned with its furniture, { x, z (centre), c, s
// (cos and sin of the turn), hx, hz (half sizes), y0, top, walk }.
const _lp = [0, 0];
/** (x, z) in the part's own frame */
function partLocal(p, x, z) { const dx = x - p.x, dz = z - p.z; _lp[0] = dx * p.c - dz * p.s; _lp[1] = dx * p.s + dz * p.c; return _lp; }
/** Squared distance on the floor plane from (x, z) to the part (0 inside). */
function partDist2(p, x, z) {
  const [lx, lz] = partLocal(p, x, z);
  const ex = Math.max(Math.abs(lx) - p.hx, 0), ez = Math.max(Math.abs(lz) - p.hz, 0);
  return ex * ex + ez * ez;
}
/** Push the circle (next, r) out of the part; true when it had to move. */
function pushOutOfPart(p, next, r) {
  const [lx, lz] = partLocal(p, next.x, next.z);
  const qx = clamp(lx, -p.hx, p.hx), qz = clamp(lz, -p.hz, p.hz);
  let ex = lx - qx, ez = lz - qz;
  const d2 = ex * ex + ez * ez;
  if (d2 >= r * r) return false;
  if (d2 < 1e-8) {   // inside: out along the smallest penetration axis
    const px = p.hx - Math.abs(lx), pz = p.hz - Math.abs(lz);
    if (px < pz) { ex = (lx >= 0 ? 1 : -1) * (px + r); ez = 0; } else { ez = (lz >= 0 ? 1 : -1) * (pz + r); ex = 0; }
  } else { const d = Math.sqrt(d2), push = (r - d) / d; ex *= push; ez *= push; }
  // back to the world: the inverse of partLocal
  next.x += ex * p.c + ez * p.s; next.z += -ex * p.s + ez * p.c;
  return true;
}
