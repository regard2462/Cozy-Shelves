// The choices of the floor ("Fußboden", settings.floor) without three.js: the settings panel shows them (with a small
// picture of each, painted by the floor worker), floor-art.js paints them, floors.js puts them on the floors.

/** In the order of the settings: wood, stone and tiles, the soft one, the colourful one. */
export const FLOOR_STYLES = ['oak', 'herringbone', 'walnut', 'maple', 'marble', 'terracotta', 'stone', 'terrazzo', 'carpet', 'cement'];
export const FLOOR_LABELS = {
  oak: { de: 'Eichendielen', en: 'Oak boards' },
  herringbone: { de: 'Fischgrätparkett', en: 'Herringbone parquet' },
  walnut: { de: 'Dunkles Nussholz', en: 'Dark walnut' },
  maple: { de: 'Heller Ahorn', en: 'Light maple' },
  marble: { de: 'Schachbrett aus Marmor', en: 'Marble chequerboard' },
  terracotta: { de: 'Terrakottafliesen', en: 'Terracotta tiles' },
  stone: { de: 'Natursteinplatten', en: 'Natural stone slabs' },
  terrazzo: { de: 'Terrazzo', en: 'Terrazzo' },
  carpet: { de: 'Teppichboden', en: 'Carpet' },
  cement: { de: 'Bunte Zementfliesen', en: 'Colourful cement tiles' },
};
/** A plain colour for each swatch until its picture is painted. */
export const FLOOR_SWATCH = {
  oak: '#c3aa8b', herringbone: '#b4875a', walnut: '#5a3f2e', maple: '#e2cfae', marble: '#8f8f8f', terracotta: '#b65e3c',
  stone: '#c8bea9', terrazzo: '#ddd6ca', carpet: '#5a6474', cement: '#3d8a87',
};

/**
 * How each floor is laid and finished. All lengths in metres.
 *   tile        one texture tile (it wraps; its edges lie on joints, so whole rows of tiles may be shifted)
 *   size        texture pixels per tile side
 *   shift       floors.js moves every row of tiles along x by a random multiple of tile / shift (1 = never): the same
 *               boards or slabs never line up in a grid across the room. A multiple of the pattern's own period, so
 *               no joint breaks (the herringbone's zigzag, two marble squares for the chequerboard, two cement tiles
 *               for their motif)
 *   cell        squares of this size (tiles, poured fields) get a little brightness of their own in floors.js, not
 *               bound to the texture tile; 0: none (boards and slabs are not on a grid)
 *   cellVar     how much (± fraction)
 *   vary        a soft large-scale variation of the tone over the room (± fraction), against any repetition
 *   roughness   material factor on the roughness texture (the generated ones hold absolute values: 1)
 *   normal      normal scale (the generated normals are physical, from heights in millimetres)
 */
export const FLOOR_SPECS = {
  // the wide oiled oak boards of 0.5 and 0.6 (textures.js plankTexture), as before
  oak: { tile: 2.4, size: 1024, shift: 48, cell: 0, cellVar: 0, vary: 0.04, roughness: 0.62, normal: 0.2, builtin: true },
  // 7 × 42 cm oak strips at 45°: the pattern repeats every 9.9 cm along x and 59.4 cm along z (4 periods per tile)
  herringbone: { tile: 4 * 6 * Math.SQRT2 * 0.07, size: 2048, shift: 24, cell: 0, cellVar: 0, vary: 0.05, roughness: 1, normal: 1 },
  walnut: { tile: 3.6, size: 2048, shift: 48, cell: 0, cellVar: 0, vary: 0.05, roughness: 1, normal: 1 },
  maple: { tile: 2.8, size: 2048, shift: 48, cell: 0, cellVar: 0, vary: 0.04, roughness: 1, normal: 1 },
  // 40 cm squares, six by six per tile
  marble: { tile: 2.4, size: 2048, shift: 3, cell: 0.4, cellVar: 0.04, vary: 0.03, roughness: 1, normal: 1 },
  // 30 cm squares, eight by eight per tile
  terracotta: { tile: 2.4, size: 2048, shift: 8, cell: 0.3, cellVar: 0.09, vary: 0.06, roughness: 1, normal: 1 },
  // rows of 40 and 60 cm with slabs of 40, 60 and 80 cm
  stone: { tile: 2.4, size: 2048, shift: 12, cell: 0, cellVar: 0, vary: 0.05, roughness: 1, normal: 1 },
  // poured in fields of one metre between brass strips
  terrazzo: { tile: 2.0, size: 2048, shift: 2, cell: 1.0, cellVar: 0.03, vary: 0.035, roughness: 1, normal: 1 },
  carpet: { tile: 1.0, size: 2048, shift: 1, cell: 0, cellVar: 0, vary: 0.08, roughness: 1, normal: 1 },
  // 20 cm tiles, their motif closes over two by two of them
  cement: { tile: 1.6, size: 2048, shift: 4, cell: 0.2, cellVar: 0.04, vary: 0.04, roughness: 1, normal: 1 },
};

/** Whether a floor is being painted right now (floors.js keeps it, 'floors:painting' on the bus tells every change). */
export const floorPainting = { busy: false };

/** The floor stored in the settings, always valid ('oak' is the floor of earlier versions). */
export function floorStyleOf(settings) {
  const f = settings?.floor;
  return FLOOR_STYLES.includes(f) ? f : 'oak';
}

// ---------------------------------------------------------------- pictures for the settings ----------------------------
// Painted by the floor worker at a small size and kept for the session (an ImageBitmap per style).
const previews = new Map();
let previewWorker = null, previewSeq = 0;
const waiting = new Map();
/** A small picture of a floor (about a metre of it), or null when no worker can paint it. */
export function floorPreview(style, w = 168, h = 104) {
  const key = `${style}:${w}x${h}`;
  if (previews.has(key)) return previews.get(key);
  const p = new Promise((resolve) => {
    try {
      if (!previewWorker) {
        previewWorker = new Worker(new URL('./floor-worker.js', import.meta.url), { type: 'module', name: 'floor-preview' });
        previewWorker.onmessage = (e) => { const m = e.data, r = waiting.get(m.id); if (r) { waiting.delete(m.id); r(m.bitmap || null); } if (!waiting.size) { previewWorker?.terminate(); previewWorker = null; } };
        previewWorker.onerror = () => { for (const r of waiting.values()) r(null); waiting.clear(); previewWorker = null; };
      }
      const id = ++previewSeq;
      waiting.set(id, resolve);
      previewWorker.postMessage({ type: 'preview', id, style, w, h });
    } catch { resolve(null); }
  });
  previews.set(key, p);
  return p;
}
