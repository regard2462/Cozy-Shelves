// 3D renderer: Three.js scene with a wooden board, procedural Staunton pieces, orbit camera and drag & drop.
// Same renderer contract as board-2d.js: setPosition / setOrientation / setFree / dragSpare / show / resize / destroy.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { h } from '../../core/dom.js';
import { pieceGeometries } from './pieces-3d.js';
import { boardTopCanvas, woodCanvas, canvasTexture, environmentTexture, radialCanvas } from './textures-3d.js';
import { key2pos, pos2key } from './position.js';

const BOARD = 9.2;           // outer size incl. frame
const THICK = 0.36;
const LIFT = 0.55;           // height of a dragged piece
const CAM_R = 14.9, CAM_PHI = 0.95;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const sqCenter = (key) => { const [f, r] = key2pos(key); return new THREE.Vector3(f - 3.5, 0, 3.5 - r); };
const keyAt = (x, z) => { const f = Math.floor(x + 4), r = Math.floor(4 - z); return f >= 0 && f < 8 && r >= 0 && r < 8 ? pos2key(f, r) : null; };

export function create3dBoard(host, handlers, opts = {}) {
  const el = h('div.chess-board-3d');
  host.appendChild(el);
  let free = !!opts.free;
  let orientation = opts.orientation || 'white';
  let visible = true, destroyed = false, dirty = true;

  // ---- renderer / scene / camera ----
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  const spherical = new THREE.Spherical(CAM_R, CAM_PHI, orientation === 'white' ? 0 : Math.PI);
  camera.position.setFromSpherical(spherical);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = true; controls.dampingFactor = 0.09;
  controls.rotateSpeed = 0.55; controls.zoomSpeed = 0.7;
  controls.minDistance = 8; controls.maxDistance = 20;
  controls.minPolarAngle = 0.18; controls.maxPolarAngle = 1.28;
  controls.target.set(0, -0.35, 0);
  controls.addEventListener('change', () => { dirty = true; });
  controls.update();

  // environment + lights
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = environmentTexture();
  const env = pmrem.fromEquirectangular(envTex).texture;
  scene.environment = env;
  envTex.dispose(); pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x5a3d26, 0.55));
  const key = new THREE.DirectionalLight(0xffe4bd, 2.4);
  key.position.set(4.5, 10, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -6.5; key.shadow.camera.right = 6.5; key.shadow.camera.top = 6.5; key.shadow.camera.bottom = -6.5;
  key.shadow.camera.near = 2; key.shadow.camera.far = 30;
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd6e0ff, 0.55);
  fill.position.set(-7, 6, -4);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffd9a8, 0.6);
  rim.position.set(0, 5, -9);
  scene.add(rim);

  // ---- board ----
  const top = boardTopCanvas({ size: 1536 });
  const topTex = canvasTexture(top.canvas, { repeat: 1, anisotropy: 8 });
  topTex.wrapS = topTex.wrapT = THREE.ClampToEdgeWrapping;
  const sideTex = canvasTexture(top.frame, { repeat: 1, anisotropy: 4 });
  sideTex.repeat.set(3, 0.35);
  const topMat = new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.42, metalness: 0.02, envMapIntensity: 0.55 });
  const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.55, metalness: 0.02, envMapIntensity: 0.35 });
  const bottomMat = new THREE.MeshStandardMaterial({ color: 0x2a170b, roughness: 0.9 });
  const boardGroup = new THREE.Group();
  const slab = new THREE.Mesh(new THREE.BoxGeometry(BOARD, THICK, BOARD), [sideMat, sideMat, bottomMat, bottomMat, sideMat, sideMat]);
  slab.position.y = -THICK / 2 - 0.002;
  slab.castShadow = true; slab.receiveShadow = true;
  boardGroup.add(slab);
  const topPlane = new THREE.Mesh(new THREE.PlaneGeometry(BOARD, BOARD), topMat);
  topPlane.rotation.x = -Math.PI / 2;
  topPlane.receiveShadow = true;
  boardGroup.add(topPlane);
  // soft bevel: a slightly bigger, thin dark ring under the top edge
  const lip = new THREE.Mesh(new THREE.BoxGeometry(BOARD + 0.08, 0.05, BOARD + 0.08), new THREE.MeshStandardMaterial({ map: canvasTexture(woodCanvas({ light: '#4a2a14', dark: '#24120a', size: 256, rings: 10, seed: 23 })), roughness: 0.6 }));
  lip.position.y = -THICK + 0.03;
  lip.castShadow = true;
  boardGroup.add(lip);
  scene.add(boardGroup);

  // ground shadow catcher (the board sits on the paper page)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.28 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -THICK - 0.01; ground.receiveShadow = true;
  scene.add(ground);

  // ---- highlight overlays ----
  const overlays = new THREE.Group();
  scene.add(overlays);
  const mkSquare = (color, opacity, tex) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, map: tex || null, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.004; m.visible = false; m.renderOrder = 2;
    overlays.add(m); return m;
  };
  const lastA = mkSquare(0xb5d03a, 0.45), lastB = mkSquare(0xb5d03a, 0.45);
  const hover = mkSquare(0xfff2c0, 0.30);
  const selected = mkSquare(0x2f7d3a, 0.42);
  const checkTex = new THREE.CanvasTexture(radialCanvas('255,45,30'));
  const checkSq = mkSquare(0xffffff, 0.95, checkTex);
  checkSq.scale.set(1.15, 1.15, 1);
  const dotGeo = new THREE.CircleGeometry(0.16, 24);
  const ringGeo = new THREE.RingGeometry(0.36, 0.46, 32);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0x1f6b2c, transparent: true, opacity: 0.5, depthWrite: false });
  const dots = new THREE.Group(); overlays.add(dots);

  // ---- pieces ----
  const geos = pieceGeometries();
  const matWhite = new THREE.MeshPhysicalMaterial({ color: 0xf1e4c8, roughness: 0.36, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.6 });
  const matBlack = new THREE.MeshPhysicalMaterial({ color: 0x2a221c, roughness: 0.4, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.35, envMapIntensity: 0.7 });
  const pieces = new THREE.Group();
  scene.add(pieces);
  const meshes = new Map();      // key → mesh

  function makeMesh(piece) {
    const m = new THREE.Mesh(geos[piece.role], piece.color === 'white' ? matWhite : matBlack);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.piece = { color: piece.color, role: piece.role };
    if (piece.role === 'knight' && piece.color === 'black') m.rotation.y = Math.PI;
    pieces.add(m);
    return m;
  }
  const samePiece = (a, b) => a && b && a.color === b.color && a.role === b.role;

  // ---- tweens ----
  const tweens = new Set();
  function tween(obj, { to, dur = 260, ease = easeOut, arc = 0, scaleTo = null, onDone = null }) {
    for (const t of tweens) if (t.obj === obj) tweens.delete(t);
    const from = obj.position.clone();
    const fromScale = obj.scale.clone();
    const t = { obj, from, to: to.clone(), dur, ease, arc, t0: performance.now(), scaleFrom: fromScale, scaleTo, onDone };
    tweens.add(t); dirty = true;
    return t;
  }
  function stepTweens(now) {
    for (const t of tweens) {
      const k = Math.min(1, (now - t.t0) / t.dur);
      const e = t.ease(k);
      t.obj.position.lerpVectors(t.from, t.to, e);
      if (t.arc) t.obj.position.y += Math.sin(k * Math.PI) * t.arc;
      if (t.scaleTo) t.obj.scale.lerpVectors(t.scaleFrom, t.scaleTo, e);
      if (k >= 1) { tweens.delete(t); t.onDone?.(); }
    }
    if (tweens.size) dirty = true;
  }
  function removeMesh(m, animate) {
    if (animate) tween(m, { to: m.position.clone().setY(m.position.y + 0.25), dur: 220, scaleTo: new THREE.Vector3(0.001, 0.001, 0.001), onDone: () => pieces.remove(m) });
    else pieces.remove(m);
  }

  // ---- state ----
  let dests = new Map(), turn = 'white', lastMove = null, checkKey = null;
  let selKey = null;
  let drag = null;          // { mesh, orig, spare, moved, startClient }

  function setPosition(map, o = {}) {
    const animate = o.animate !== false && visible;
    if (drag && !drag.spare) endDrag(null, true);
    dests = o.dests || new Map(); turn = o.turn || 'white'; lastMove = o.lastMove || null; checkKey = o.check || null;
    const remaining = new Map(meshes);
    meshes.clear();
    const todo = [];
    // 1. pieces that stay on their square
    for (const [k, p] of map) {
      const m = remaining.get(k);
      if (m && samePiece(m.userData.piece, p)) { meshes.set(k, m); remaining.delete(k); }
      else todo.push([k, p]);
    }
    // 2. moved pieces: reuse a leftover mesh of the same kind (nearest)
    for (const [k, p] of todo) {
      let best = null, bestD = Infinity;
      const target = sqCenter(k);
      for (const [rk, m] of remaining) {
        if (!samePiece(m.userData.piece, p)) continue;
        const d = m.position.distanceTo(target);
        if (d < bestD) { bestD = d; best = rk; }
      }
      if (best != null) {
        const m = remaining.get(best); remaining.delete(best);
        meshes.set(k, m);
      } else {
        const m = makeMesh(p);
        m.position.copy(target);
        if (animate) { m.scale.setScalar(0.001); m.position.y = 0.3; }
        meshes.set(k, m);
      }
    }
    // 3. leftovers are captured/removed
    for (const [, m] of remaining) removeMesh(m, animate);
    // 4. settle every mesh on its square
    for (const [k, m] of meshes) {
      const target = sqCenter(k);
      const off = m.position.distanceTo(target) > 1e-4 || m.scale.x < 0.999;
      if (!off) continue;
      if (animate) {
        const far = m.position.distanceTo(target) > 1.2;
        tween(m, { to: target, dur: far ? 380 : 260, arc: m.position.y < 0.05 ? (far ? 0.45 : 0.25) : 0, scaleTo: m.scale.x < 0.999 ? new THREE.Vector3(1, 1, 1) : null, ease: far ? easeInOut : easeOut });
      } else { m.position.copy(target); m.scale.setScalar(1); }
    }
    selKey = null;
    updateOverlays();
    dirty = true;
  }

  function updateOverlays() {
    const place = (mesh, k) => { if (k) { mesh.position.copy(sqCenter(k)); mesh.position.y = mesh === checkSq ? 0.006 : 0.004; mesh.visible = true; } else mesh.visible = false; };
    place(lastA, lastMove && lastMove[0]); place(lastB, lastMove && lastMove[1]);
    place(checkSq, checkKey);
    place(selected, selKey);
    dots.clear();
    if (selKey && !free) {
      for (const d of dests.get(selKey) || []) {
        const occupied = meshes.has(d);
        const m = new THREE.Mesh(occupied ? ringGeo : dotGeo, dotMat);
        m.rotation.x = -Math.PI / 2; m.position.copy(sqCenter(d)); m.position.y = 0.006; m.renderOrder = 3;
        dots.add(m);
      }
    }
    dirty = true;
  }

  // ---- picking ----
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const planeGround = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const planeLift = new THREE.Plane(new THREE.Vector3(0, 1, 0), -LIFT);
  const tmp = new THREE.Vector3();
  function setRay(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }
  function pickPiece(clientX, clientY) {
    setRay(clientX, clientY);
    const hits = raycaster.intersectObjects([...meshes.values()], false);
    if (!hits.length) return null;
    for (const [k, m] of meshes) if (m === hits[0].object) return { key: k, mesh: m };
    return null;
  }
  function pickSquare(clientX, clientY, plane = planeGround) {
    setRay(clientX, clientY);
    if (!raycaster.ray.intersectPlane(plane, tmp)) return null;
    return { key: keyAt(tmp.x, tmp.z), point: tmp.clone() };
  }
  const movable = (piece) => free || piece.color === turn;

  function onPointerDown(e) {
    if (e.button !== 0 || drag) return;
    const hit = pickPiece(e.clientX, e.clientY);
    const sq = pickSquare(e.clientX, e.clientY);
    if (selKey && sq && sq.key && sq.key !== selKey && (!hit || (dests.get(selKey) || []).includes(sq.key))) {
      // click-click move
      e.stopImmediatePropagation(); e.preventDefault();
      const from = selKey; selKey = null; updateOverlays();
      handlers.move?.(from, sq.key);
      return;
    }
    if (hit && movable(hit.mesh.userData.piece)) {
      e.stopImmediatePropagation(); e.preventDefault();
      startDrag(hit.mesh, hit.key, e);
      return;
    }
    if (selKey) { selKey = null; updateOverlays(); }
  }
  function startDrag(mesh, orig, e) {
    drag = { mesh, orig, spare: null, moved: false, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId };
    try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    controls.enabled = false;
    el.classList.add('grabbing');
    tween(mesh, { to: mesh.position.clone().setY(LIFT), dur: 140 });
    hover.visible = false;
    dirty = true;
  }
  function onPointerMove(e) {
    if (drag) {
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) drag.moved = true;
      if (drag.moved || drag.spare) {
        const sq = pickSquare(e.clientX, e.clientY, planeLift);
        if (sq) {
          for (const t of tweens) if (t.obj === drag.mesh) tweens.delete(t);
          drag.mesh.position.set(sq.point.x, LIFT, sq.point.z);
          const k = keyAt(sq.point.x, sq.point.z);
          if (k) { hover.position.copy(sqCenter(k)); hover.position.y = 0.005; hover.visible = true; } else hover.visible = false;
          dirty = true;
        }
      }
      return;
    }
    // hover feedback
    const hit = pickPiece(e.clientX, e.clientY);
    const grab = !!(hit && movable(hit.mesh.userData.piece));
    el.classList.toggle('grab', grab);
    const sq = pickSquare(e.clientX, e.clientY);
    const k = sq && sq.key;
    if (k && (grab || selKey)) { hover.position.copy(sqCenter(k)); hover.position.y = 0.005; hover.visible = true; }
    else hover.visible = false;
    dirty = true;
  }
  function onPointerUp(e) {
    if (!drag) return;
    const d = drag;
    const sq = pickSquare(e.clientX, e.clientY, planeLift);
    const target = sq ? keyAt(sq.point.x, sq.point.z) : null;
    endDrag(target, false, d);
  }
  function endDrag(target, cancel, d = drag) {
    if (!d) return;
    drag = null;
    controls.enabled = true;
    el.classList.remove('grabbing');
    hover.visible = false;
    try { renderer.domElement.releasePointerCapture(d.pointerId); } catch (err) { /* ignore */ }
    const mesh = d.mesh;
    if (d.spare) {
      if (cancel || !target) { removeMesh(mesh, true); dirty = true; return; }
      const old = meshes.get(target);
      if (old) { removeMesh(old, true); meshes.delete(target); }
      meshes.set(target, mesh);
      const ok = handlers.drop?.(d.spare, target);
      if (!ok) { /* facade re-synced; mesh removed if not accepted */ }
      return;
    }
    if (cancel) { tween(mesh, { to: sqCenter(d.orig), dur: 160 }); return; }
    if (!d.moved || target === d.orig) {
      // click: toggle selection
      tween(mesh, { to: sqCenter(d.orig), dur: 160 });
      selKey = selKey === d.orig ? null : d.orig;
      updateOverlays();
      handlers.select?.(selKey);
      return;
    }
    if (!target) {
      if (free) { handlers.remove?.(d.orig); }
      else tween(mesh, { to: sqCenter(d.orig), dur: 220, ease: easeInOut });
      return;
    }
    const res = handlers.move?.(d.orig, target);
    if (!res) tween(mesh, { to: sqCenter(d.orig), dur: 220, ease: easeInOut });
    else if (res === 'promotion') { mesh.position.copy(sqCenter(target)); dirty = true; }
  }
  function dragSpare(piece, event) {
    if (drag) endDrag(null, true);
    const mesh = makeMesh(piece);
    const cx = event.clientX ?? event.touches?.[0]?.clientX ?? 0, cy = event.clientY ?? event.touches?.[0]?.clientY ?? 0;
    const sq = pickSquare(cx, cy, planeLift);
    mesh.position.set(sq ? sq.point.x : 0, LIFT, sq ? sq.point.z : 6);
    drag = { mesh, orig: null, spare: { color: piece.color, role: piece.role }, moved: true, startX: cx, startY: cy, pointerId: event.pointerId };
    controls.enabled = false;
    el.classList.add('grabbing');
    const move = (e) => onPointerMove(e.touches ? e.touches[0] : e);
    const up = (e) => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up); const t = e.changedTouches ? e.changedTouches[0] : e; onPointerUp(t); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, { passive: false }); document.addEventListener('touchend', up);
    dirty = true;
  }
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', () => endDrag(null, true));
  canvas.addEventListener('pointerleave', () => { if (!drag) { hover.visible = false; el.classList.remove('grab'); dirty = true; } });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- orientation (camera swings around the board) ----
  let flipAnim = null;
  function setOrientation(color) {
    orientation = color;
    const target = color === 'white' ? 0 : Math.PI;
    const cur = controls.getAzimuthalAngle();
    let delta = target - cur;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    if (Math.abs(delta) < 1e-3) return;
    if (!visible) { placeCamera(target); return; }
    flipAnim = { from: cur, delta, t0: performance.now(), dur: 750 };
    controls.enabled = false;
    dirty = true;
  }
  function placeCamera(theta) {
    const off = camera.position.clone().sub(controls.target);
    const s = new THREE.Spherical().setFromVector3(off);
    s.theta = theta;
    camera.position.setFromSpherical(s).add(controls.target);
    camera.lookAt(controls.target);
    controls.update();
    dirty = true;
  }

  // ---- render loop ----
  function resize() {
    const w = el.clientWidth, hgt = el.clientHeight;
    if (!w || !hgt) return;
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt; camera.updateProjectionMatrix();
    dirty = true;
  }
  function frame(now) {
    if (destroyed) return;
    if (!visible) { raf = 0; return; }
    raf = requestAnimationFrame(frame);
    if (flipAnim) {
      const k = Math.min(1, (now - flipAnim.t0) / flipAnim.dur);
      placeCamera(flipAnim.from + flipAnim.delta * easeInOut(k));
      if (k >= 1) { flipAnim = null; controls.enabled = !drag; }
    }
    stepTweens(now);
    const moved = controls.update();
    if (dirty || moved) { renderer.render(scene, camera); dirty = false; }
  }
  let raf = 0;
  function start() { if (!raf && visible && !destroyed) raf = requestAnimationFrame(frame); }
  resize();
  start();

  return {
    el,
    kind: '3d',
    setPosition,
    setOrientation,
    setFree(v) { free = !!v; selKey = null; updateOverlays(); },
    dragSpare,
    setShapes() {},
    resize,
    show(v) { visible = !!v; el.classList.toggle('hidden', !visible); if (visible) { resize(); dirty = true; start(); } },
    destroy() {
      destroyed = true; visible = false;
      if (raf) cancelAnimationFrame(raf);
      controls.dispose();
      for (const t of [topTex, sideTex, checkTex, env]) t.dispose();
      for (const m of [topMat, sideMat, bottomMat, matWhite, matBlack, dotMat]) m.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      el.remove();
    },
    // for tests
    _debug: { scene, camera, controls, meshes, renderer },
  };
}
