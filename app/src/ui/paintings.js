// Pictures for the walls: generated impressionist watercolours (cached in IndexedDB), the user's
// own folder, or none. A frame is NEVER left empty – a fast procedural sketch goes up immediately
// and is replaced as soon as the proper watercolour has been painted.
import { PAINTERS, keyOf } from '../world/texture-paint.js';
import { textureStore } from '../world/texture-store.js';
import { touch } from '../core/platform.js';
const SEEDS = [[11, 'mountain-lake'], [23, 'lily-pond'], [37, 'haystacks'], [41, 'sunset-sea'], [53, 'garden-path'], [67, 'lavender'], [71, 'misty-forest'], [83, 'meadow'], [97, 'sailboat'], [101, 'winter'], [113, 'lighthouse'], [127, 'rainy-city'], [131, 'lily-pond'], [139, 'meadow'], [149, 'mountain-lake']];

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('lesesaal-paintings', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('img');
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
async function cacheGet(key) { try { const db = await idb(); return await new Promise((res) => { const tx = db.transaction('img', 'readonly'); const r = tx.objectStore('img').get(key); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); }); } catch { return null; } }
async function cachePut(key, val) { try { const db = await idb(); await new Promise((res) => { const tx = db.transaction('img', 'readwrite'); tx.objectStore('img').put(val, key); tx.oncomplete = res; tx.onerror = res; }); } catch {} }

// ---------------------------------------------------------------- instant sketches ----
/**
 * A quick, soft landscape in watercolour colours for every frame until the proper watercolours have been painted:
 * painted by world/texture-paint.js (at a first start by the texture workers, kept in the texture store afterwards,
 * else here in milliseconds), handed to the world as a picture (`image`), not as a data URL (fifteen JPEG encodings
 * took 0.7 s of the start).
 */
const quick = new Map();
function quickSketch(seed, motif) {
  const key = keyOf('sketch', { seed, motif });
  let image = quick.get(key);
  if (!image) {
    let images = textureStore.take(key);
    if (!images) { images = PAINTERS.sketch({ seed, motif }); textureStore.remember(key, images); }
    image = images.map;
    quick.set(key, image);
  }
  return { url: 'quick:' + key, image };
}

/** Frames are filled with these until the real watercolours arrive. */
export function instantPaintings() {
  return SEEDS.map(([seed, motif]) => ({ ...quickSketch(seed, motif), title: motif, key: `quick-${motif}-${seed}`, quick: true }));
}

let generating = null;
export async function loadPaintings(settings, api) {
  const mode = settings.paintings?.mode || 'impressionist';
  if (mode === 'off' || mode === 'none') return [];
  if (mode === 'own' && settings.paintings?.folder) {
    try {
      const files = await api.files.list(settings.paintings.folder, ['.jpg', '.jpeg', '.png', '.webp']);
      if (files.length) return files.map((f) => ({ url: f.url, title: f.name }));
    } catch (e) { console.warn('own picture folder unreadable', e); }
    // fall through: an unreachable folder must not leave every frame empty
  }
  // generated impressionist pictures, with instant sketches in the meantime
  const quick = instantPaintings();
  const list = [];
  const missing = [];
  for (const [seed, motif] of SEEDS) {
    const key = `wc-${motif}-${seed}-v1`;
    const cached = await cacheGet(key);
    if (cached) list.push({ url: cached, title: motif, key }); else missing.push({ seed, motif, key });
  }
  const merged = () => {
    // keep the frame count stable: real pictures first, sketches fill the rest
    const out = [...list];
    for (const q of quick) { if (out.length >= SEEDS.length) break; out.push(q); }
    return out;
  };
  if (missing.length && !generating) {
    generating = (async () => {
      try {
        const mod = await import('./watercolor/watercolor-generate.js');
        for (const m of missing) {
          try {
            // one picture at a time, with a pause so the 3D scene stays smooth; on a touch screen only while the menu
            // covers the world or the app is in the background (a phone painted them for a minute or more of the
            // world's frames at the first start)
            await new Promise((r) => setTimeout(r, 2500));
            while (touch && !document.hidden && !document.querySelector('.panel-layer.open.menu-layer')) await new Promise((r) => setTimeout(r, 2000));
            const url = await mod.generateWatercolor({ seed: m.seed, motif: m.motif, width: 768, height: 544, quality: 0.6, simScale: 0.5 });
            await cachePut(m.key, url);
            list.push({ url, title: m.motif, key: m.key });
            window.dispatchEvent(new CustomEvent('paintings:progress', { detail: { list: merged() } }));
          } catch (e) { console.warn('painting generation failed', m.motif, e); }
        }
        mod.disposeGenerator?.();
      } catch (e) { console.warn('watercolor module unavailable', e); }
      generating = null;
    })();
  }
  return merged();
}
