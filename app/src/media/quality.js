// Video qualities as picture heights ("1080p", "720p", "540p" …) instead of "Niedrig / Mittel / Hoch":
// the renditions of a film with their real sizes, the one closest to a preferred height, what 'auto' plays, the step
// below a rendition, the levels of an HLS master, and the stored preference (0.6 kept 'low' | 'sd' | 'hd').
// Pure functions without the DOM (the unit tests bundle them with esbuild, see electron/mediathek/test-mediathek.js).

/** The choices of the setting "Bevorzugte Qualität". */
export const PREFERENCES = ['auto', 1080, 720, 480, 360];
const OLD = { hd: 1080, sd: 480, low: 360 };
/** Where a quality of MediathekViewWeb stands while its size is not known yet (order only, never shown). */
const GUESS = { low: 360, sd: 540, hd: 720 };
const LADDER = [144, 180, 216, 240, 270, 288, 360, 432, 480, 540, 576, 720, 1080, 1440, 2160];
const STD_WIDTHS = [3840, 2560, 1920, 1280, 1024, 960, 854, 768, 720, 640, 512, 480, 426, 384, 320, 256];

/** A stored or chosen preference → 'auto' | height. Takes the old names, '720p', '720' and numbers. */
export function preferenceOf(v) {
  if (v === 'auto' || v == null || v === '') return 'auto';
  if (OLD[v]) return OLD[v];
  const n = typeof v === 'number' ? v : parseInt(String(v).replace(/p$/i, ''), 10);
  return Number.isFinite(n) && n >= 100 && n <= 4320 ? n : 'auto';
}

/** The class of a picture, as in electron/mediathek/heights.js: its height, the short side of a portrait video, and
 *  for letterboxed films of a standard width the height that width stands for. */
export function classOf(width, height) {
  const w = Math.round(Number(width) || 0), h = Math.round(Number(height) || 0);
  if (!h) return 0;
  let v = h;
  if (w && w < h) v = w;
  else if (w && w / h > 1.85 && STD_WIDTHS.some((s) => Math.abs(w - s) / s < 0.015)) v = Math.max(h, Math.round(w * 9 / 16));
  return LADDER.find((l) => Math.abs(l - v) / l <= 0.025) || v;
}
export const labelOf = (p) => (p ? `${Math.round(p)}p` : '');

/**
 * The renditions of `video` ({ key: url }): [{ key, url, height, known, label }] biggest first. `heights` = { key:
 * { p | height, width } } (from the item or mediathek:heights). Two keys of the same size and address collapse; two
 * of the same size keep the one later in low → sd → hd order (more bits). Unknown sizes of MediathekViewWeb's low,
 * sd, hd stand where they usually are and carry no label.
 */
export function renditionsOf(video, heights = {}) {
  const order = (k) => ({ low: 0, sd: 1, hd: 2 }[k] ?? 1);
  const list = Object.entries(video || {}).filter(([, u]) => typeof u === 'string' && u).map(([key, url]) => {
    const h = heights && heights[key];
    const p = h ? (h.p || classOf(h.width, h.height)) : 0;
    const keyed = /^h(\d{3,4})$/.exec(key);
    const height = p || (keyed ? +keyed[1] : 0);
    return { key, url, height: height || GUESS[key] || 0, known: !!height, label: height ? labelOf(height) : '' };
  });
  const out = [];
  for (const r of list.sort((a, b) => order(a.key) - order(b.key))) {
    const same = out.findIndex((x) => x.url === r.url || (x.known && r.known && x.height === r.height));
    if (same >= 0) { if (out[same].url !== r.url) out[same] = r; continue; }
    out.push(r);
  }
  return out.sort((a, b) => (b.height - a.height) || (order(b.key) - order(a.key)));
}

/** The entry closest to a preferred height; at equal distance the smaller one. list items need `.height`. */
export function closest(list, pref) {
  const target = preferenceOf(pref);
  if (!list || !list.length) return null;
  if (target === 'auto') return list[0];
  let best = null;
  for (const r of list) {
    const d = Math.abs(r.height - target);
    if (!best || d < best.d || (d === best.d && r.height < best.r.height)) best = { r, d };
  }
  return best.r;
}

/** 'auto': the biggest entry up to the height of the window in device pixels (a fifth more is fine), never above
 *  `cap` (a height 'auto' stepped down to after stalls). */
export function autoPick(list, screenPx, cap = null) {
  if (!list || !list.length) return null;
  const limit = Math.max(360, (Number(screenPx) || 0) * 1.2);
  const fit = list.filter((r) => r.height <= limit && (!cap || r.height <= cap));
  return fit.length ? fit[0] : list[list.length - 1];
}

/** The entry one step below `key` (null when it is the smallest). */
export function lower(list, key) {
  const i = (list || []).findIndex((r) => r.key === key);
  return i >= 0 && i < list.length - 1 ? list[i + 1] : null;
}

/** HLS levels (hls.js) → [{ key: 'h720', height, index, bitrate, label }] one per size (the best bitrate), biggest
 *  first. Levels without a size keep their place by bitrate and get no label. */
export function levelsOf(levels) {
  const byKey = new Map();
  (levels || []).forEach((l, index) => {
    const height = classOf(l.width, l.height);
    const key = height ? 'h' + height : 'b' + (l.bitrate || index);
    const prev = byKey.get(key);
    if (!prev || (l.bitrate || 0) > prev.bitrate) byKey.set(key, { key, height, index, bitrate: l.bitrate || 0, label: labelOf(height) });
  });
  return [...byKey.values()].sort((a, b) => (b.height - a.height) || (b.bitrate - a.bitrate));
}

/** What a download menu marks as default: the entry closest to the preference ('auto' → the biggest). */
export const defaultDownload = (list, pref) => closest(list, preferenceOf(pref));
