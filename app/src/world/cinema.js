// Home cinema in the hall: a roll-down projection screen in front of the chimney breast and a projector
// on a pedestal behind the sofa. The screen only comes down while a film runs in 'screen' mode
// (app/src/media/media-player.js). Then the hall lamps dim, the picture throws its colour into the
// room and the sound gets quieter the further you walk away from the screen.
// The colour of that light is measured without making anything wait (0.7): the browser shrinks the current frame to
// 16 × 9 pixels on the graphics card (createImageBitmap) and a worker of its own reads those back through a pixel
// buffer once the GPU is done. Up to 0.6 a 2D canvas copied the whole frame from the GPU five times a second on the
// main thread, 18 ms on average and up to 220 ms with a 1080p film, which made walking in the hall stutter while a
// film ran on the screen. Other ways stall as well: a readback on the main thread waits for the GPU process even
// through a pixel buffer (getBufferSubData, 20 ms and more while the graphics card is busy), and a video frame handed
// to a worker as a VideoFrame is copied to the CPU inside the GPU process, which holds up the frames of the window.
import * as THREE from 'three';
import { mediaPlayer } from '../media/media-player.js';
import { M } from './materials.js';
import { twoSided } from './two-sided.js';
import { Parts, boxGeo, cylGeo, sphereGeo, planeGeo, clamp, easeInOut } from './geo.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// screen group: local x runs along the screen, y up, +z points into the room
const PIC_W = 3.6, PIC_H = PIC_W * 9 / 16;   // 16:9 picture
const CLOTH_W = 3.84;
const PIC_BOTTOM = 2.0;                      // lower picture edge above the floor (clears the mantelpiece)
const BORDER = 0.1;                          // black border under the picture
const CASE_Y = 4.955;                        // centre of the roller case, just under the ceiling beam
const CASE_BOTTOM = CASE_Y - 0.085;
const CLOTH_H = CASE_BOTTOM - (PIC_BOTTOM - BORDER);
const TOP_DROP = CLOTH_H - PIC_H - BORDER;   // black leader between the case and the picture
const LENS = V(0, 1.25, 0.2);                // projector lens in the projector group's frame

const ROLL_DOWN = 3.2, ROLL_UP = 2.4;         // seconds
const SAMPLE_W = 16, SAMPLE_H = 9;            // pixels of the colour sample of the picture
const SAMPLE_EVERY = 0.25;                    // seconds between two colour samples
const SAMPLE_GIVE_UP = 3000;                  // ms after which an unanswered sample no longer blocks the next one
const SCREEN_LABEL = { de: 'Film anhalten oder fortsetzen (F Vollbild, J und L spulen, V öffnet die Mediathek)', en: 'Pause or resume the film (F full screen, J and L skip, V opens the media library)' };

/** The screen fabric: black leader, white picture area with narrow black side borders. */
function clothTexture() {
  const W = 1024, H = Math.round(W * CLOTH_H / CLOTH_W);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const px = W / CLOTH_W;
  g.fillStyle = '#141313'; g.fillRect(0, 0, W, H);
  const side = ((CLOTH_W - PIC_W) / 2) * px;
  const top = TOP_DROP * px;
  const grad = g.createLinearGradient(0, top, 0, top + PIC_H * px);
  grad.addColorStop(0, '#f1efe9'); grad.addColorStop(1, '#e9e6de');
  g.fillStyle = grad; g.fillRect(side, top, W - side * 2, PIC_H * px);
  // a faint woven structure so the white does not look like paper
  g.globalAlpha = 0.05; g.fillStyle = '#000';
  for (let y = top; y < top + PIC_H * px; y += 3) g.fillRect(side, y, W - side * 2, 1);
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

/** Gradient light cone from the lens to the picture corners (additive, very faint). */
const beamShader = {
  uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uStrength: { value: 0 }, uTime: { value: 0 } },
  vertexShader: `attribute float aK; varying float vK; varying vec3 vPos;
    void main(){ vK = aK; vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 uColor; uniform float uStrength; uniform float uTime; varying float vK; varying vec3 vPos;
    float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    void main(){
      float dust = 0.75 + 0.5 * hash(floor(vPos * 38.0 + vec3(0.0, uTime * 0.6, 0.0)));
      float a = uStrength * mix(0.9, 0.18, vK) * dust;
      gl_FragColor = vec4(uColor * a, 1.0);
    }`,
};

/** The worker behind Cinema#samplePicture: it gets the picture already shrunk to a few pixels (an ImageBitmap on the
 *  GPU), copies it into a texture of its own WebGL2 context and reads it back through a pixel buffer once a fence says
 *  the GPU is done, so neither the main thread nor the GPU process waits. It answers with the mean of the sRGB values
 *  (0 … 1), the light looks as in 0.6. Its source is this function's text (toString), so it must not use any name
 *  from outside. */
function colourWorker() {
  let gl = null, tex = null, size = 0, buf = new Uint8Array(0);
  const setup = () => {
    gl = new OffscreenCanvas(1, 1).getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl) throw new Error('no WebGL2 in the worker');
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, gl.createBuffer());
  };
  // the fence is looked at once per task, as WebGL wants it
  const done = (sync) => new Promise((resolve, reject) => {
    const look = () => {
      const state = gl.clientWaitSync(sync, 0, 0);
      if (state === gl.WAIT_FAILED) reject(new Error('fence failed'));
      else if (state === gl.TIMEOUT_EXPIRED) setTimeout(look, 4);
      else resolve();
    };
    setTimeout(look, 4);
  });
  self.onmessage = async (e) => {
    const bitmap = e.data;
    try {
      if (!gl) setup();
      const w = bitmap.width, h = bitmap.height, n = w * h * 4;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      bitmap.close();
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (n !== size) { size = n; buf = new Uint8Array(n); gl.bufferData(gl.PIXEL_PACK_BUFFER, n, gl.STREAM_READ); }
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      await done(sync);
      gl.deleteSync(sync);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, buf);
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < n; i += 4) { r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; }
      const k = 4 / n / 255;
      self.postMessage({ rgb: [r * k, g * k, b * k] });
    } catch (err) {
      try { bitmap.close(); } catch {}
      self.postMessage({ error: String(err?.message || err), unreadable: err?.name === 'SecurityError' });
    }
  };
}

export class Cinema {
  constructor(world) {
    this.world = world;
    this.active = false;      // a film is shown on the screen
    this.drop = 0;            // 0 = rolled up, 1 = fully down
    this.picture = 0;         // picture visibility 0..1 (fades in once the cloth is down)
    this.dim = 0;             // 0 = normal light, 1 = cinema light in the hall
    this.gainApplied = 1;
    this.screen = null; this.projector = null; this.beam = null;
    this.parts = {};
    this.texture = null;
    this.clothTex = clothTexture();
    this.clothMat = new THREE.MeshStandardMaterial({ map: this.clothTex, roughness: 0.96, metalness: 0 });
    this.clothMat.userData.keepMap = true;
    this.pictureMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0 });
    this.beamMat = new THREE.ShaderMaterial({ ...beamShader, uniforms: THREE.UniformsUtils.clone(beamShader.uniforms), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.lensMat = new THREE.MeshStandardMaterial({ color: 0x1d2328, emissive: 0xfff4dc, emissiveIntensity: 0, roughness: 0.15, metalness: 0.3 });
    this.ledMat = new THREE.MeshStandardMaterial({ color: 0x331a10, emissive: 0xff5a2a, emissiveIntensity: 0.4, roughness: 0.4 });
    // One permanent light, dark while idle: adding a light only when the film starts would make
    // three.js recompile every shader in the scene at that moment.
    this.spill = new THREE.SpotLight(0xffffff, 0, 12, Math.PI * 0.4, 0.95, 1.4);
    this.spill.castShadow = false;
    world.scene.add(this.spill, this.spill.target);
    // the colour sample of the picture comes from a worker (#samplePicture), started with the first film on the screen
    this.worker = null; this.workerUrl = null; this.workerFailed = false;
    this.sampling = false; this.sampleDue = false; this.sampleSent = 0; this.samples = 0; this.sampleCol = new THREE.Color();
    this.avg = new THREE.Color(0.8, 0.8, 0.8); this.luma = 0.5; this.sampleTimer = 0; this.tainted = false;
    this.raycaster = new THREE.Raycaster(); this.raycaster.far = 18;
    this.off = mediaPlayer.onChange((s) => this.#onMedia(s));
    this.#onMedia(mediaPlayer.state);
  }

  dispose() {
    this.off?.();
    this.world.scene.remove(this.spill, this.spill.target);
    this.#releaseTexture();
    this.clothTex.dispose(); this.clothMat.dispose(); this.pictureMat.dispose(); this.beamMat.dispose(); this.lensMat.dispose(); this.ledMat.dispose();
    this.worker?.terminate(); this.worker = null;
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    this.placeholder?.dispose();
  }

  // ------------------------------------------------------------------ building ----
  /** The roller screen (called from World#buildPlacements for the 'screen' placement). */
  buildScreen() {
    const g = new THREE.Group(); g.name = 'cinema-screen';
    const housing = M.plain(0x2c2a28, { roughness: 0.42, metalness: 0.55 });
    const p = new Parts();
    p.add(boxGeo(CLOTH_W + 0.2, 0.17, 0.17), housing, V(0, CASE_Y, 0));
    for (const s of [-1, 1]) {
      p.add(boxGeo(0.035, 0.2, 0.19), housing, V(s * (CLOTH_W / 2 + 0.1), CASE_Y, 0));
      p.add(boxGeo(0.05, 0.05, 0.2), housing, V(s * 0.72, CASE_Y + 0.03, -0.17));     // brackets to the chimney breast
    }
    g.add(p.build({ name: 'screen-case', castShadow: false }));
    // the cloth hangs from the case; its pivot is its top edge, scale.y = how far it is unrolled
    const cloth = new THREE.Mesh(planeGeo(CLOTH_W, CLOTH_H), this.clothMat);
    const pivot = new THREE.Group(); pivot.position.set(0, CASE_BOTTOM, 0.02); pivot.add(cloth);
    cloth.position.y = -CLOTH_H / 2;
    cloth.receiveShadow = true;
    g.add(pivot);
    const bar = new THREE.Mesh(boxGeo(CLOTH_W + 0.04, 0.035, 0.035), M.plain(0x8d8a84, { roughness: 0.35, metalness: 0.8 }));
    const handle = new THREE.Mesh(boxGeo(0.12, 0.05, 0.02), M.plain(0x2c2a28, { roughness: 0.5 })); handle.position.set(0, -0.035, 0.012);
    bar.add(handle); g.add(bar);
    const pic = new THREE.Mesh(planeGeo(PIC_W, PIC_H), this.pictureMat);
    pic.position.set(0, PIC_BOTTOM + PIC_H / 2, 0.026); pic.renderOrder = 2;
    pic.userData.interact = { kind: 'screen', label: SCREEN_LABEL };
    g.add(pic);
    g.userData.footprint = null;
    this.screen = g; this.parts = { pivot, cloth, bar, pic };
    this.#applyDrop();
    return g;
  }

  /** The projector on its pedestal (the 'projector' placement, interact → Mediathek). */
  buildProjector() {
    const wood = M.wood('walnut'), dark = M.plain(0x2a2521, { roughness: 0.5, metalness: 0.35 }), cream = M.plain(0xd8cdb8, { roughness: 0.45, metalness: 0.1 });
    const p = new Parts();
    p.add(cylGeo(0.2, 0.23, 0.05, 24), wood, V(0, 0.025, 0));
    p.add(cylGeo(0.05, 0.065, 1.05, 16), wood, V(0, 0.575, 0));
    p.add(cylGeo(0.09, 0.05, 0.08, 16), wood, V(0, 1.12, 0));
    p.add(boxGeo(0.4, 0.035, 0.44), wood, V(0, 1.1775, 0));
    // body: two-tone, a little retro
    p.add(boxGeo(0.3, 0.12, 0.34), cream, V(0, 1.255, -0.01));
    p.add(boxGeo(0.31, 0.02, 0.35), dark, V(0, 1.325, -0.01));
    for (let i = 0; i < 5; i++) p.add(boxGeo(0.005, 0.07, 0.2), dark, V(0.152, 1.25, -0.06 + (i - 2) * 0.035));  // vents
    p.add(cylGeo(0.058, 0.058, 0.06, 24), dark, V(0, LENS.y, 0.17), [Math.PI / 2, 0, 0]);
    for (const s of [-1, 1]) p.add(cylGeo(0.012, 0.012, 0.04, 8), dark, V(s * 0.11, 1.195, 0.12));             // feet
    const g = p.build({ name: 'projector' });
    const lens = new THREE.Mesh(cylGeo(0.042, 0.042, 0.012, 24), this.lensMat); lens.rotation.x = Math.PI / 2; lens.position.set(0, LENS.y, 0.2); g.add(lens);
    const led = new THREE.Mesh(sphereGeo(0.008, 8), this.ledMat); led.position.set(0.1, 1.305, 0.16); g.add(led);
    g.userData.footprint = { w: 0.46, d: 0.46, h: 1.35 };
    this.projector = g;
    return g;
  }

  /** Called after every world build: the beam spans lens → picture corners. */
  onBuilt() {
    if (this.beam) { this.beam.parent?.remove(this.beam); this.beam.geometry.dispose(); this.beam = null; }
    if (!this.screen || !this.projector) { this.#applyDrop(); return; }
    this.screen.updateMatrixWorld(true); this.projector.updateMatrixWorld(true);
    const lens = LENS.clone().setZ(LENS.z + 0.02).applyMatrix4(this.projector.matrixWorld);
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => V(sx * PIC_W / 2, PIC_BOTTOM + PIC_H / 2 + sy * PIC_H / 2, 0.03).applyMatrix4(this.screen.matrixWorld));
    const pos = [], k = [];
    for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; pos.push(lens.x, lens.y, lens.z, a.x, a.y, a.z, b.x, b.y, b.z); k.push(0, 1, 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aK', new THREE.Float32BufferAttribute(k, 1));
    this.beam = twoSided(new THREE.Mesh(geo, this.beamMat)); this.beam.frustumCulled = false; this.beam.renderOrder = 3; this.beam.visible = false;
    this.world.scene.add(this.beam);
    const centre = V(0, PIC_BOTTOM + PIC_H / 2, 0.3).applyMatrix4(this.screen.matrixWorld);
    const into = V(0, PIC_BOTTOM + PIC_H / 2 - 1.6, 6).applyMatrix4(this.screen.matrixWorld);
    this.spill.position.copy(centre); this.spill.target.position.copy(into); this.spill.target.updateMatrixWorld();
    this.centre = V(0, PIC_BOTTOM + PIC_H / 2, 0).applyMatrix4(this.screen.matrixWorld);
    this.#applyDrop();
    this.#warmUp();
  }

  /** Compile the program of the picture with a video texture before a film starts: compiled at the start it costs a
   *  quarter of a second on Direct3D. A placeholder video texture stands in for the film; the picture is drawn into the
   *  composer's buffer when there is one. */
  #warmUp() {
    const w = this.world, r = w.renderer, pic = this.parts.pic;
    if (!r?.compileAsync || !pic) return;
    const composed = !!(w.bloom?.enabled || w.ao?.enabled || w.godrays?.wanted);
    const key = composed ? 'composed' : 'canvas';
    if (this.warmKey === key) return;
    this.warmKey = key;
    if (!this.placeholder) { this.placeholder = new THREE.VideoTexture(document.createElement('video')); this.placeholder.colorSpace = THREE.SRGBColorSpace; }
    const prev = r.getRenderTarget(), map = this.pictureMat.map, visible = pic.visible;
    try {
      this.pictureMat.map = this.texture || this.placeholder; pic.visible = true;
      r.setRenderTarget(composed ? w.composer?.readBuffer ?? null : null);
      r.compileAsync(pic, w.camera, w.scene)?.catch?.(() => {});
    } catch {} finally {
      r.setRenderTarget(prev);
      this.pictureMat.map = map; pic.visible = visible;
    }
  }

  // ------------------------------------------------------------------ state ----
  #onMedia(s) {
    const want = !!(s.current && s.mode === 'screen');
    if (want === this.active) return;
    this.active = want;
    if (want) this.#acquireTexture(); // the picture fades in once the cloth is down
  }
  #acquireTexture() {
    if (this.texture) return;
    const tex = new THREE.VideoTexture(mediaPlayer.video);
    tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    this.texture = tex; this.pictureMat.map = tex; this.pictureMat.needsUpdate = true;
    this.tainted = false;   // a new film may be readable where the last one was not
  }
  #releaseTexture() {
    if (!this.texture) return;
    this.pictureMat.map = null; this.pictureMat.needsUpdate = true;
    this.texture.dispose(); this.texture = null;
  }

  /** Pitch that looks from `eye` at the middle of the picture. */
  pitchFrom(eye) {
    if (!this.centre) return -0.1;
    const dx = this.centre.x - eye.x, dz = this.centre.z - eye.z;
    return clamp(Math.atan2(this.centre.y - eye.y, Math.hypot(dx, dz)), -0.4, 0.55);
  }

  /** Aiming at the picture from further away than the normal interaction range (used by #look). */
  pick(camera, occluders) {
    if (!this.parts.pic || this.drop < 0.98) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hits = this.raycaster.intersectObjects([this.parts.pic, ...occluders], true);
    const first = hits[0];
    if (!first || first.object !== this.parts.pic) return null;
    return { type: 'interact', kind: 'screen', label: SCREEN_LABEL, distance: first.distance };
  }

  #applyDrop() {
    const { pivot, cloth, bar, pic } = this.parts;
    if (!pivot) return;
    const f = easeInOut(this.drop);
    pivot.scale.y = Math.max(0.0005, f);
    cloth.visible = f > 0.002;
    // the bar is fixed to the lower end of the cloth, so the part that is unrolled first is the bottom
    this.clothTex.repeat.set(1, Math.max(0.0005, f)); this.clothTex.offset.set(0, 0);
    bar.position.set(0, CASE_BOTTOM - CLOTH_H * f - 0.018, 0.02);
    pic.visible = this.picture > 0.001;
    this.pictureMat.opacity = this.picture;
  }

  update(dt) {
    const w = this.world;
    const target = this.active ? 1 : 0;
    // roll the cloth first, then the picture; switching off goes the other way round
    if (this.active) {
      if (this.drop < 1) this.drop = Math.min(1, this.drop + dt / ROLL_DOWN);
      else this.picture = Math.min(1, this.picture + dt / 0.8);
    } else {
      if (this.picture > 0) this.picture = Math.max(0, this.picture - dt / 0.45);
      else if (this.drop > 0) this.drop = Math.max(0, this.drop - dt / ROLL_UP);
      if (this.picture <= 0 && this.texture) this.#releaseTexture();
    }
    this.dim += clamp((target - this.dim), -dt / 2.2, dt / 2.2);
    this.#applyDrop();

    // projector lamp, beam and the light the picture throws into the room
    const on = this.picture;
    this.lensMat.emissiveIntensity = 1.6 * on;
    this.ledMat.emissive.setHex(this.active ? 0x6cff7a : 0xff5a2a); this.ledMat.emissiveIntensity = this.active ? 1.2 : 0.4;
    if (on > 0.01 && this.texture) {
      this.sampleTimer -= dt;
      // the sample starts when the main thread has nothing else to do between two frames
      if (this.sampleTimer <= 0 && !this.sampleDue) {
        this.sampleTimer = SAMPLE_EVERY; this.sampleDue = true;
        requestIdleCallback(() => { this.sampleDue = false; this.#samplePicture(); }, { timeout: 200 });
      }
    }
    const light = on * (0.35 + 0.65 * this.luma);
    this.spill.color.copy(this.avg); this.spill.intensity = 7 * light;
    if (this.beam) {
      this.beam.visible = on > 0.01;
      const u = this.beamMat.uniforms;
      u.uColor.value.copy(this.avg).lerp(new THREE.Color(1, 1, 1), 0.4);
      // a beam is only visible in a dim room
      const daylight = w.env?.daylight ?? 0;
      u.uStrength.value = on * 0.09 * (1 - 0.85 * daylight) * (0.55 + 0.45 * this.luma);
      u.uTime.value += dt;
    }

    // sound: full in front of the screen, fainter across the hall, faint in the book room
    let gain = 1;
    if (this.active && this.centre) {
      const cam = w.camera.position;
      const d = cam.distanceTo(this.centre);
      gain = d < 5.5 ? 1 : clamp(1 - (d - 5.5) / 16, 0.2, 1);
      if (cam.z < -9.1) gain *= 0.6;          // behind the passage walls
    }
    if (Math.abs(gain - this.gainApplied) > 0.01) { this.gainApplied = gain; mediaPlayer.setSpatialGain(gain); }
  }

  /** Average colour of the current frame → colour of the light the screen throws into the room. The browser shrinks
   *  the frame to SAMPLE_W × SAMPLE_H pixels on the GPU, the worker (colourWorker) reads them back; the answer arrives
   *  a few frames later in #onColour. A film whose pictures may not be read (another origin) keeps a neutral light. */
  #samplePicture() {
    if (this.tainted || this.workerFailed || !this.texture) return;
    if (this.sampling && performance.now() - this.sampleSent < SAMPLE_GIVE_UP) return;
    const v = mediaPlayer.video;
    if (!v || v.readyState < 2 || !v.videoWidth) return;
    if (!this.#colourWorker()) return;
    this.sampling = true; this.sampleSent = performance.now();
    createImageBitmap(v, { resizeWidth: SAMPLE_W, resizeHeight: SAMPLE_H, resizeQuality: 'medium' }).then((bitmap) => {
      if (this.worker) this.worker.postMessage(bitmap, [bitmap]);
      else { bitmap.close(); this.sampling = false; }
    }, () => { this.sampling = false; });
  }

  #colourWorker() {
    if (this.worker) return this.worker;
    try {
      this.workerUrl = URL.createObjectURL(new Blob([`(${colourWorker.toString()})();`], { type: 'text/javascript' }));
      this.worker = new Worker(this.workerUrl, { name: 'cinema-colour' });
      this.worker.onmessage = (e) => this.#onColour(e.data);
      this.worker.onerror = (e) => { console.warn('[cinema] colour worker', e.message || e); this.#workerGone(); };
    } catch (err) { console.warn('[cinema] colour worker', err?.message || err); this.#workerGone(); }
    return this.worker;
  }
  /** Without the worker the light keeps its neutral colour. */
  #workerGone() {
    this.workerFailed = true; this.sampling = false;
    this.worker?.terminate(); this.worker = null;
  }
  #onColour(d) {
    this.sampling = false;
    if (d?.unreadable) { this.tainted = true; return; }
    if (!d || d.error) { if (d?.error) console.warn('[cinema] colour sample', d.error); this.#workerGone(); return; }
    const col = this.sampleCol.setRGB(d.rgb[0], d.rgb[1], d.rgb[2], THREE.SRGBColorSpace);
    this.avg.lerp(col, 0.5);
    this.luma = 0.5 * this.luma + 0.5 * (0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b);
    this.samples++;
  }

  /** How much the hall lamps are turned down right now (0 … 0.72). */
  get hallDim() { return 0.72 * this.dim; }
}
