// One cell of the atlas of the side covers (side-covers.js), made from a picture: no three.js here, the worker
// (app/src/workers/side-cover-worker.js) makes the cells of the cover images and of the title cards with it (it loads
// the web fonts of the page itself); without a worker the main thread does it in idle time.

/** A cell: 120 × 184 px of picture inside a 4 px border that repeats its edge, 128 × 192 in all. */
export const SIDE_CELL = { w: 128, h: 192, pad: 4 };
/** The levels every cell brings itself: 128 × 192 down to 2 × 3 (box-filtered halves). */
export const SIDE_LEVELS = 7;
/** A picture taller than its face loses this share of the excess at the head, the rest at the foot (titles sit high). */
export const CROP_TOP = 0.4;

/** RGBA pixels (w × h, both even) at half the size, every pixel the mean of four. */
function half(src, w, h) {
  const w2 = w >> 1, h2 = h >> 1, out = new Uint8Array(w2 * h2 * 4), row = w * 4;
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      const a = y * 2 * row + x * 8, b = a + row, o = (y * w2 + x) * 4;
      out[o] = (src[a] + src[a + 4] + src[b] + src[b + 4] + 2) >> 2;
      out[o + 1] = (src[a + 1] + src[a + 5] + src[b + 1] + src[b + 5] + 2) >> 2;
      out[o + 2] = (src[a + 2] + src[a + 6] + src[b + 2] + src[b + 6] + 2) >> 2;
      out[o + 3] = (src[a + 3] + src[a + 7] + src[b + 3] + src[b + 7] + 2) >> 2;
    }
  }
  return out;
}

/** The part of a picture (iw × ih px) a face of these proportions (width / height) shows: trimmed like a print. */
export function cropOf(iw, ih, aspect) {
  if (iw / ih > aspect) { const sw = ih * aspect; return { sx: (iw - sw) / 2, sy: 0, sw, sh: ih }; }
  const sh = iw / aspect;
  return { sx: 0, sy: (ih - sh) * CROP_TOP, sw: iw, sh };
}

/**
 * Paints a cell: `paint(g, x, y, w, h)` draws the picture into the rectangle of the cell's picture, the border repeats
 * its edge (filtering at the edge of a face never reaches the next cell), and the six smaller levels are box-filtered
 * halves. `g` is the 2D context of a canvas of SIDE_CELL size in main memory (willReadFrequently).
 * @returns { levels: [Uint8Array RGBA, 128 × 192 … 2 × 3], mean: [r, g, b] of the picture }
 */
export function paintCell(g, paint) {
  const { w: W, h: H, pad: P } = SIDE_CELL, CW = W - 2 * P, CH = H - 2 * P;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  g.save();
  paint(g, P, P, CW, CH);
  g.restore();
  const d = new Uint8Array(g.getImageData(0, 0, W, H).data.buffer);
  const row = W * 4;
  for (let y = P; y < P + CH; y++) {
    const l = y * row + P * 4, r = y * row + (P + CW - 1) * 4;
    for (let x = 0; x < P; x++) { d.copyWithin(y * row + x * 4, l, l + 4); d.copyWithin(y * row + (P + CW + x) * 4, r, r + 4); }
  }
  for (let y = 0; y < P; y++) { d.copyWithin(y * row, P * row, (P + 1) * row); d.copyWithin((P + CH + y) * row, (P + CH - 1) * row, (P + CH) * row); }
  const levels = [d];
  for (let k = 1, w = W, h = H; k < SIDE_LEVELS; k++, w >>= 1, h >>= 1) levels.push(half(levels[k - 1], w, h));
  const s = levels[SIDE_LEVELS - 1], n = s.length / 4, mean = [0, 0, 0];
  for (let i = 0; i < s.length; i += 4) { mean[0] += s[i]; mean[1] += s[i + 1]; mean[2] += s[i + 2]; }
  return { levels, mean: mean.map((v) => Math.round(v / n)) };
}

/** A cover image (an ImageBitmap) into a cell, trimmed to a face of `aspect` (width / height). */
export function paintCoverCell(g, bitmap, aspect) {
  const { sx, sy, sw, sh } = cropOf(bitmap.width, bitmap.height, aspect);
  return paintCell(g, (c, x, y, w, h) => { c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'medium'; c.drawImage(bitmap, sx, sy, sw, sh, x, y, w, h); });
}
