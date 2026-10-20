// Procedural wood textures (canvas) for the 3D chess board.
import * as THREE from 'three';

// --- tiny value noise -------------------------------------------------------------------------
function makeNoise(seed = 1) {
  const perm = new Uint8Array(512);
  let s = seed >>> 0 || 1;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t) => t * t * (3 - 2 * t);
  const grad = (h, x, y) => { switch (h & 3) { case 0: return x + y; case 1: return -x + y; case 2: return x - y; default: return -x - y; } };
  function noise2(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const a = perm[X] + Y, b = perm[X + 1] + Y;
    return 0.5 + 0.5 * (
      (1 - v) * ((1 - u) * grad(perm[a], x, y) + u * grad(perm[b], x - 1, y)) +
      v * ((1 - u) * grad(perm[a + 1], x, y - 1) + u * grad(perm[b + 1], x - 1, y - 1)));
  }
  return { noise2, fbm(x, y, oct = 4) { let a = 0.5, f = 1, sum = 0, norm = 0; for (let i = 0; i < oct; i++) { sum += a * noise2(x * f, y * f); norm += a; a *= 0.5; f *= 2.1; } return sum / norm; } };
}

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mix = (a, b, t) => a + (b - a) * t;

/**
 * Wood grain canvas. { light, dark, size, rings (grain frequency), seed, streak }
 */
export function woodCanvas({ light = '#e6d0a6', dark = '#c9a76f', size = 512, rings = 9, seed = 7, streak = 0.25, angle = 0 } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const N = makeNoise(seed);
  const L = hex(light), D = hex(dark);
  const ca = Math.cos(angle), sa = Math.sin(angle);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x * ca - y * sa) / size, v = (x * sa + y * ca) / size;
      const warp = N.fbm(u * 1.2 + 3, v * 0.7, 3);
      const g = Math.sin((v * rings + warp * 0.9 + Math.sin(u * 5) * 0.05) * Math.PI * 2);
      let t = 0.5 + 0.5 * g;                                 // ring bands
      t = Math.pow(t, 1.6);
      const fine = N.noise2(u * 180, v * 9) * streak;         // fine longitudinal streaks
      const pores = N.noise2(u * 400 + 11, v * 60) * 0.08;
      t = Math.min(1, Math.max(0, t * (1 - streak) + fine + pores - 0.04));
      const i = (y * size + x) * 4;
      d[i] = mix(L[0], D[0], t); d[i + 1] = mix(L[1], D[1], t); d[i + 2] = mix(L[2], D[2], t); d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Board top: frame + 64 parquet squares + coordinates. Returns { canvas, squarePx, framePx }.
 * The canvas is drawn with rank 8 at the top and file a at the left (White's view).
 */
export function boardTopCanvas({ size = 1536, frameRatio = 0.6 / 9.2, coordFont = '"EB Garamond", Georgia, serif' } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const framePx = size * frameRatio;
  const boardPx = size - 2 * framePx;
  const sq = boardPx / 8;
  const maple = woodCanvas({ light: '#f1e2bf', dark: '#dcc39a', size: 512, rings: 11, seed: 3, streak: 0.4, angle: 0.03 });
  const walnut = woodCanvas({ light: '#8a5a33', dark: '#5e3719', size: 512, rings: 12, seed: 11, streak: 0.36, angle: -0.02 });
  const frame = woodCanvas({ light: '#5b3418', dark: '#33190b', size: 512, rings: 12, seed: 19, streak: 0.22, angle: 0.02 });
  // frame (draw as four boards with grain running along each edge)
  const fp = ctx.createPattern(frame, 'repeat');
  ctx.save(); ctx.fillStyle = fp; ctx.fillRect(0, 0, size, size); ctx.restore();
  ctx.save(); ctx.translate(size, 0); ctx.rotate(Math.PI / 2); ctx.fillStyle = fp; ctx.fillRect(0, 0, size, framePx); ctx.fillRect(0, size - framePx, size, framePx); ctx.restore();
  // mitre lines
  ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
  for (const [x0, y0, x1, y1] of [[0, 0, framePx, framePx], [size, 0, size - framePx, framePx], [0, size, framePx, size - framePx], [size, size, size - framePx, size - framePx]]) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
  ctx.restore();
  // squares – random offsets/rotations for a parquet feel
  let seed = 5;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const light = (r + f) % 2 === 0;   // top-left (a8) is light
    const src = light ? maple : walnut;
    const x = framePx + f * sq, y = framePx + r * sq;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, sq, sq); ctx.clip();
    ctx.translate(x + sq / 2, y + sq / 2);
    ctx.rotate(Math.floor(rnd() * 4) * Math.PI / 2);
    const ox = Math.floor(rnd() * (src.width - sq)), oy = Math.floor(rnd() * (src.height - sq));
    ctx.drawImage(src, ox, oy, sq, sq, -sq / 2, -sq / 2, sq, sq);
    // subtle edge darkening between squares
    ctx.strokeStyle = 'rgba(30,15,5,0.22)'; ctx.lineWidth = 1.5; ctx.strokeRect(-sq / 2, -sq / 2, sq, sq);
    ctx.restore();
  }
  // inlay lines around the playing field
  ctx.save();
  ctx.strokeStyle = 'rgba(240, 215, 170, 0.55)'; ctx.lineWidth = size * 0.0028;
  ctx.strokeRect(framePx - size * 0.012, framePx - size * 0.012, boardPx + size * 0.024, boardPx + size * 0.024);
  ctx.strokeStyle = 'rgba(20, 8, 2, 0.5)'; ctx.lineWidth = size * 0.0018;
  ctx.strokeRect(framePx - size * 0.006, framePx - size * 0.006, boardPx + size * 0.012, boardPx + size * 0.012);
  ctx.restore();
  // coordinates: files along bottom (white side) and top (rotated for black), ranks left and right
  ctx.save();
  ctx.fillStyle = 'rgba(238, 214, 168, 0.78)';
  ctx.font = `600 ${Math.round(size * 0.026)}px ${coordFont}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const files = 'abcdefgh';
  for (let i = 0; i < 8; i++) {
    const cx = framePx + i * sq + sq / 2;
    ctx.fillText(files[i], cx, size - framePx / 2);
    ctx.save(); ctx.translate(cx, framePx / 2); ctx.rotate(Math.PI); ctx.fillText(files[i], 0, 0); ctx.restore();
    const cy = framePx + i * sq + sq / 2;
    const rank = String(8 - i);
    ctx.fillText(rank, framePx / 2, cy);
    ctx.save(); ctx.translate(size - framePx / 2, cy); ctx.rotate(Math.PI); ctx.fillText(rank, 0, 0); ctx.restore();
  }
  ctx.restore();
  return { canvas: c, squarePx: sq, framePx, frame };
}

export function canvasTexture(canvas, { repeat = 1, anisotropy = 8, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

/** Small warm equirectangular environment (for soft reflections on the pieces). */
export function environmentTexture() {
  const w = 128, hgt = 64;
  const data = new Uint8Array(w * hgt * 4);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    const v = y / (hgt - 1);                       // 0 = top
    const u = x / (w - 1);
    // sky-ish warm ceiling, darker wooden floor, a bright window on one side
    let r = mix(250, 70, v), g = mix(238, 45, v), b = mix(215, 28, v);
    const win = Math.exp(-(((u - 0.72) * 6) ** 2 + ((v - 0.35) * 5) ** 2));
    r = Math.min(255, r + win * 90); g = Math.min(255, g + win * 80); b = Math.min(255, b + win * 60);
    const i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, w, hgt, THREE.RGBAFormat);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = true;
  t.needsUpdate = true;
  return t;
}

/** Radial highlight sprite texture (for check / hover). */
export function radialCanvas(color = '255,40,30', size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${color},0.9)`); g.addColorStop(0.45, `rgba(${color},0.55)`); g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return c;
}
