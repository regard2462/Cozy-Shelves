// Procedural PBR textures (no asset files): wood, parquet, plaster, brick, fabric, leather, marble, paper, rugs. The
// pictures themselves are painted by texture-paint.js (on the main thread, in a worker at a first start, or taken from
// the store of the last start: texture-store.js); this makes the three.js textures of them and remembers them by key.
import * as THREE from 'three';
import { PAINTERS, keyOf, canvas, paperGrain, mulberry32 } from './texture-paint.js';
import { textureStore } from './texture-store.js';

export { mulberry32 };
const cache = new Map();

function toTexture(img, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(img);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
/** The textures of a painting: from the store or the workers when they have it, else painted now (and then kept).
 *  `specs` says how each picture becomes a texture ({ map: { repeat, srgb, aniso }, normalMap: … }). */
function make(kind, opts, specs) {
  const key = keyOf(kind, opts);
  if (cache.has(key)) return cache.get(key);
  let images = textureStore.take(key);
  if (!images) {
    const t0 = performance.now();
    images = PAINTERS[kind](opts);
    textureStore.stats[key] = Math.round(performance.now() - t0);
    textureStore.remember(key, images);
  }
  const res = {};
  for (const [name, spec] of Object.entries(specs)) if (images[name]) { res[name] = toTexture(images[name], spec); res[name].userData.key = key; }   // (the key: the checks)
  cache.set(key, res); return res;
}
const linear = (repeat, aniso) => ({ repeat, srgb: false, aniso });

/** Plank wood (planks along x). tone: 'oak'|'walnut'|'mahogany'|'pine'|'ebony'|'cherry' */
export function woodTexture(opts = {}) {
  const { repeat = [2, 2] } = opts;
  return make('wood', opts, { map: { repeat }, normalMap: linear(repeat), roughnessMap: linear(repeat) });
}
/** Wide oiled oak boards ("Landhausdielen"), texture-paint.js. */
export function plankTexture(opts = {}) {
  return make('planks', opts, { map: { aniso: 16 }, normalMap: linear([1, 1], 16), roughnessMap: linear([1, 1]) });
}
/** Painted panelling: an even coat with the faintest brush marks along the boards. */
export function paintTexture(opts = {}) { return make('paint', opts, { map: {}, normalMap: linear([1, 1]) }); }
/** Herringbone / plank parquet floor */
export function parquetTexture(opts = {}) {
  const { repeat = [6, 6] } = opts;
  return make('parquet', opts, { map: { repeat, aniso: 16 }, normalMap: linear(repeat, 16), roughnessMap: linear(repeat) });
}
export function plasterTexture(opts = {}) {
  const { repeat = [4, 4] } = opts;
  return make('plaster', opts, { map: { repeat }, normalMap: linear(repeat), roughnessMap: linear(repeat) });
}
/** Regency stripes, tone on tone (the hall), texture-paint.js. */
export function wallpaperTexture(opts = {}) { return make('wallpaper', opts, { map: {}, normalMap: linear([1, 1]), roughnessMap: linear([1, 1]) }); }
/** Four coffers per tile of the ceiling, texture-paint.js. */
export function cofferTexture(opts = {}) { return make('coffer', opts, { map: {}, normalMap: linear([1, 1]) }); }
export function brickTexture(opts = {}) {
  const { repeat = [2, 2] } = opts;
  return make('brick', opts, { map: { repeat }, normalMap: linear(repeat), roughnessMap: linear(repeat) });
}
export function fabricTexture(opts = {}) {
  const { repeat = [4, 4] } = opts;
  return make('fabric', opts, { map: { repeat }, normalMap: linear(repeat) });
}
export function leatherTexture(opts = {}) {
  const { repeat = [3, 3] } = opts;
  return make('leather', opts, { map: { repeat }, normalMap: linear(repeat), roughnessMap: linear(repeat) });
}
/** A rug: hand-knotted ('persian', 'kilim', 'runner') or a calm modern flat-weave, texture-paint.js. */
export function rugTexture(opts = {}) {
  const res = make('rug', opts, { map: { repeat: [1, 1], aniso: 16 } });
  res.map.wrapS = res.map.wrapT = THREE.ClampToEdgeWrapping;
  return res;
}
export function marbleTexture(opts = {}) {
  const { repeat = [2, 2] } = opts;
  return make('marble', opts, { map: { repeat }, roughnessMap: linear(repeat) });
}
/** Paper (open book pages). */
export function paperTexture(opts = {}) { return make('paper', opts, { map: { repeat: [1, 1] } }); }

// ---- newspapers ---------------------------------------------------------------
/** A folded newspaper front page: masthead, rule, headline, columns, one photo block; `lang` 'en' prints the line
 *  under the masthead and the headline in English (the rack shows the papers of the interface language). */
const NEWS_LINES = {
  de: { sub: 'Unabhängige Tageszeitung · Cozy-Shelves-Ausgabe', heads: ['Neue Funde im alten Archiv', 'Das lange Wochenende der Leser', 'Ein Abend in der Bibliothek', 'Vom Wert der stillen Stunde', 'Was die Regale erzählen'] },
  en: { sub: 'Independent daily · Cozy Shelves edition', heads: ['New finds in an old archive', 'The long weekend of readers', 'An evening in the library', 'The value of a quiet hour', 'What the shelves tell'] },
};
export function newspaperTexture(title, { seed = 1, width = 512, height = 700, lang = 'de' } = {}) {
  const lines = NEWS_LINES[lang] || NEWS_LINES.de;
  const key = `news:${title}:${seed}:${width}:${height}:${lang}`;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(width, height); const ctx = c.getContext('2d');
  const rnd = mulberry32(seed + title.length * 31);
  ctx.fillStyle = '#efe8d8'; ctx.fillRect(0, 0, width, height);
  paperGrain(ctx, width, height, seed);

  const pad = width * 0.06;
  ctx.fillStyle = '#20180f';
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  let fs = Math.round(width * 0.12);
  ctx.font = `900 ${fs}px "Playfair Display", Georgia, serif`;
  while (ctx.measureText(title).width > width - pad * 2 && fs > 14) { fs -= 2; ctx.font = `900 ${fs}px "Playfair Display", Georgia, serif`; }
  ctx.fillText(title, width / 2, pad + fs);
  // rules under the masthead
  ctx.strokeStyle = '#20180f'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(pad, pad + fs * 1.25); ctx.lineTo(width - pad, pad + fs * 1.25); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, pad + fs * 1.4); ctx.lineTo(width - pad, pad + fs * 1.4); ctx.stroke();
  ctx.font = `400 ${Math.round(width * 0.028)}px "EB Garamond", Georgia, serif`;
  ctx.fillStyle = '#5b4b36';
  ctx.fillText(lines.sub, width / 2, pad + fs * 1.34);

  // headline
  let y = pad + fs * 2.2;
  ctx.textAlign = 'left'; ctx.fillStyle = '#20180f';
  const hs = Math.round(width * 0.062);
  ctx.font = `700 ${hs}px "Playfair Display", Georgia, serif`;
  const heads = lines.heads;
  const head = heads[Math.floor(rnd() * heads.length)];
  const words = head.split(' '); let line = '';
  for (const wd of words) {
    const test = line ? line + ' ' + wd : wd;
    if (ctx.measureText(test).width > width - pad * 2) { ctx.fillText(line, pad, y); y += hs * 1.05; line = wd; } else line = test;
  }
  if (line) { ctx.fillText(line, pad, y); y += hs * 1.05; }
  y += 6;

  // photo block
  const ph = height * 0.16;
  const gx = ctx.createLinearGradient(0, y, 0, y + ph);
  gx.addColorStop(0, '#8d8778'); gx.addColorStop(1, '#4b4639');
  ctx.fillStyle = gx; ctx.fillRect(pad, y, width - pad * 2, ph);
  ctx.fillStyle = 'rgba(30,24,16,0.55)';
  for (let i = 0; i < 7; i++) { const bw = (width - pad * 2) / 9; ctx.fillRect(pad + i * bw * 1.2 + 6, y + ph - 8 - rnd() * ph * 0.65, bw * 0.75, ph); }
  y += ph + height * 0.02;

  // three text columns
  const cols = 3, gutter = width * 0.025;
  const colW = (width - pad * 2 - gutter * (cols - 1)) / cols;
  const lh = Math.max(3, height * 0.0125);
  ctx.strokeStyle = 'rgba(40,32,22,0.62)'; ctx.lineWidth = Math.max(1, height * 0.0035);
  for (let ci = 0; ci < cols; ci++) {
    const cx = pad + ci * (colW + gutter);
    let cy = y;
    while (cy < height - pad) {
      const frac = 0.72 + rnd() * 0.28;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + colW * frac, cy); ctx.stroke();
      cy += lh;
      if (rnd() < 0.06) cy += lh * 0.7;   // paragraph break
    }
    if (ci < cols - 1) { ctx.save(); ctx.strokeStyle = 'rgba(40,32,22,0.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx + colW + gutter / 2, y); ctx.lineTo(cx + colW + gutter / 2, height - pad); ctx.stroke(); ctx.restore(); }
  }
  // fold shadow across the middle
  const fold = ctx.createLinearGradient(0, height * 0.46, 0, height * 0.54);
  fold.addColorStop(0, 'rgba(0,0,0,0)'); fold.addColorStop(0.5, 'rgba(60,45,25,0.20)'); fold.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fold; ctx.fillRect(0, height * 0.46, width, height * 0.08);

  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  const res = { map: t };
  cache.set(key, res); return res;
}

// ---- misc: solid canvas with text (labels) -----------------------------------------
/** A label: background, a frame line, the text centred and shrunk until it fits; drawn into a width × height area
 *  (canvas units, a scaled context draws it larger: signs.js). */
export function drawLabel(ctx, text, { width = 512, height = 128, bg = '#3a2a1a', fg = '#e8d8b0', font = '600 54px "Cormorant Garamond", Georgia, serif', border = '#c9a35a' } = {}) {
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 4; ctx.strokeRect(6, 6, width - 12, height - 12); }
  ctx.fillStyle = fg; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let size = parseInt(font.match(/(\d+)px/)[1]);
  while (ctx.measureText(text).width > width - 40 && size > 18) { size -= 2; ctx.font = font.replace(/\d+px/, size + 'px'); }
  ctx.fillText(text, width / 2, height / 2 + 2);
}
export function labelTexture(text, opts = {}) {
  const { width = 512, height = 128 } = opts;
  const c = canvas(width, height); drawLabel(c.getContext('2d'), text, opts);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export function disposeTextureCache() { for (const v of cache.values()) for (const t of Object.values(v)) t.dispose?.(); cache.clear(); }
