// Writers for invented test audiobooks (dev only, no encoder needed): WAV with speech-like tones, MP3 of silent
// MPEG-2 Layer III frames with ID3v2.3/2.4 tags (APIC, CHAP/CTOC), MP4/M4B with the same MP3 frames as audio, iTunes
// tags, a QuickTime chapter track and Nero chapters, FLAC (verbatim frames) with Vorbis comments and a picture, Ogg
// Vorbis/Opus headers (tags only, not playable), and covers as PNG or baseline JPEG drawn from simple shapes and a
// small bitmap font. Used by build/testlib/gen_audiobooks.js and electron/audiobooks/test-audiobooks.js.
const zlib = require('zlib');

// ------------------------------------------------------------------------------------------------- checksums --
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
const OGG_TABLE = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let r = i << 24; for (let k = 0; k < 8; k++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0; t[i] = r >>> 0; } return t; })();
function oggCrc(buf) { let c = 0; for (const b of buf) c = ((c << 8) ^ OGG_TABLE[((c >>> 24) ^ b) & 0xff]) >>> 0; return c >>> 0; }
function crc8(buf) { let c = 0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; } return c; }
function crc16(buf) { let c = 0; for (const b of buf) { c ^= b << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff; } return c; }

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n & 0xffff); return b; };
const le32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const ss32 = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);

// ------------------------------------------------------------------------------------------------- pictures --
/** A tiny raster to draw covers on: RGBA, rectangles, circles, gradients and 5 × 7 capitals. */
class Raster {
  constructor(w, h) { this.w = w; this.h = h; this.px = Buffer.alloc(w * h * 4, 255); }
  set(x, y, [r, g, b], a = 1) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.px[i] = Math.round(this.px[i] * (1 - a) + r * a); this.px[i + 1] = Math.round(this.px[i + 1] * (1 - a) + g * a); this.px[i + 2] = Math.round(this.px[i + 2] * (1 - a) + b * a); this.px[i + 3] = 255;
  }
  gradient(top, bottom) { for (let y = 0; y < this.h; y++) { const k = y / (this.h - 1); const c = top.map((v, i) => v + (bottom[i] - v) * k); for (let x = 0; x < this.w; x++) this.set(x, y, c); } return this; }
  rect(x0, y0, w, h, c, a = 1) { for (let y = Math.max(0, y0 | 0); y < Math.min(this.h, y0 + h); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(this.w, x0 + w); x++) this.set(x, y, c, a); return this; }
  circle(cx, cy, r, c, a = 1) {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); const k = Math.max(0, Math.min(1, r - d + 0.5)); if (k > 0) this.set(x, y, c, a * k);
    }
    return this;
  }
  /** capitals, digits and a few marks, `s` pixels per font pixel, centred on cx */
  text(str, cx, y, s, c) {
    const chars = [...String(str).toUpperCase()];
    const w = chars.length * 6 * s - s;
    let x = Math.round(cx - w / 2);
    for (const ch of chars) {
      const g = FONT[ch] || FONT[' '];
      for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) if (g[row][col] === '#') this.rect(x + col * s, y + row * s, s, s, c);
      x += 6 * s;
    }
    return this;
  }
}
const F = (rows) => rows.split('|');
const FONT = {
  ' ': F('.....|.....|.....|.....|.....|.....|.....'), A: F('.###.|#...#|#...#|#####|#...#|#...#|#...#'), B: F('####.|#...#|#...#|####.|#...#|#...#|####.'),
  C: F('.###.|#...#|#....|#....|#....|#...#|.###.'), D: F('####.|#...#|#...#|#...#|#...#|#...#|####.'), E: F('#####|#....|#....|####.|#....|#....|#####'),
  F: F('#####|#....|#....|####.|#....|#....|#....'), G: F('.###.|#...#|#....|#.###|#...#|#...#|.####'), H: F('#...#|#...#|#...#|#####|#...#|#...#|#...#'),
  I: F('.###.|..#..|..#..|..#..|..#..|..#..|.###.'), J: F('..###|...#.|...#.|...#.|...#.|#..#.|.##..'), K: F('#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#'),
  L: F('#....|#....|#....|#....|#....|#....|#####'), M: F('#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#'), N: F('#...#|##..#|#.#.#|#..##|#...#|#...#|#...#'),
  O: F('.###.|#...#|#...#|#...#|#...#|#...#|.###.'), P: F('####.|#...#|#...#|####.|#....|#....|#....'), Q: F('.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#'),
  R: F('####.|#...#|#...#|####.|#.#..|#..#.|#...#'), S: F('.####|#....|#....|.###.|....#|....#|####.'), T: F('#####|..#..|..#..|..#..|..#..|..#..|..#..'),
  U: F('#...#|#...#|#...#|#...#|#...#|#...#|.###.'), V: F('#...#|#...#|#...#|#...#|#...#|.#.#.|..#..'), W: F('#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#'),
  X: F('#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#'), Y: F('#...#|#...#|.#.#.|..#..|..#..|..#..|..#..'), Z: F('#####|....#|...#.|..#..|.#...|#....|#####'),
  'Ä': F('#...#|.###.|#...#|#####|#...#|#...#|#...#'), 'Ö': F('#...#|.###.|#...#|#...#|#...#|#...#|.###.'), 'Ü': F('#...#|.....|#...#|#...#|#...#|#...#|.###.'),
  '0': F('.###.|#...#|#..##|#.#.#|##..#|#...#|.###.'), '1': F('..#..|.##..|..#..|..#..|..#..|..#..|.###.'), '2': F('.###.|#...#|....#|...#.|..#..|.#...|#####'),
  '3': F('####.|....#|....#|.###.|....#|....#|####.'), '4': F('...#.|..##.|.#.#.|#..#.|#####|...#.|...#.'), '5': F('#####|#....|####.|....#|....#|#...#|.###.'),
  '6': F('.###.|#....|#....|####.|#...#|#...#|.###.'), '7': F('#####|....#|...#.|..#..|.#...|.#...|.#...'), '8': F('.###.|#...#|#...#|.###.|#...#|#...#|.###.'),
  '9': F('.###.|#...#|#...#|.####|....#|....#|.###.'), '-': F('.....|.....|.....|.###.|.....|.....|.....'), '.': F('.....|.....|.....|.....|.....|.##..|.##..'),
  ':': F('.....|.##..|.##..|.....|.##..|.##..|.....'), ',': F('.....|.....|.....|.....|.##..|..#..|.#...'), "'": F('..#..|..#..|.....|.....|.....|.....|.....'),
};

/** A cover: a gradient, a motif, the title in capitals on a band and the author below. */
function drawCover({ size = 360, top = [40, 70, 110], bottom = [10, 20, 40], accent = [240, 200, 90], motif = 'sun', title = '', author = '' }) {
  const r = new Raster(size, size).gradient(top, bottom);
  const s = size / 360;
  if (motif === 'sun') r.circle(180 * s, 150 * s, 70 * s, accent);
  else if (motif === 'moon') { r.circle(200 * s, 130 * s, 60 * s, accent); r.circle(225 * s, 115 * s, 52 * s, top); }
  else if (motif === 'tower') { r.rect(160 * s, 70 * s, 40 * s, 170 * s, [235, 235, 230]); for (let k = 0; k < 4; k++) r.rect(160 * s, (90 + k * 40) * s, 40 * s, 14 * s, accent); r.circle(180 * s, 64 * s, 26 * s, [255, 240, 170], 0.9); }
  else if (motif === 'waves') for (let k = 0; k < 6; k++) for (let x = 0; x < size; x++) r.rect(x, (170 + k * 18 + Math.sin(x / (18 * s) + k) * 7 * s) * 1, 1, 5 * s, accent, 0.85 - k * 0.1);
  else if (motif === 'trees') for (let k = 0; k < 7; k++) { const x = (30 + k * 50) * s, h = (90 + (k % 3) * 30) * s; for (let y = 0; y < h; y++) r.rect(x - (y / h) * 26 * s, 250 * s - h + y, (y / h) * 52 * s, 1, accent); }
  else if (motif === 'stars') for (let k = 0; k < 40; k++) r.circle((37 * k * 7919) % size, ((k * 104729) % 220) * s, (1 + (k % 3)) * s, [255, 250, 220]);
  else r.rect(60 * s, 60 * s, 240 * s, 180 * s, accent, 0.8);
  r.rect(0, 258 * s, size, 72 * s, [250, 246, 236], 0.92);
  const words = String(title).toUpperCase();
  const fs = Math.max(1, Math.floor(Math.min(4 * s, (size - 24 * s) / (words.length * 6))));
  r.text(words, size / 2, 270 * s, fs, [30, 30, 34]);
  r.text(String(author).toUpperCase(), size / 2, 305 * s, Math.max(1, Math.floor(2 * s)), [90, 70, 50]);
  return r;
}

function png(r) {
  const raw = Buffer.alloc((r.w * 4 + 1) * r.h);
  for (let y = 0; y < r.h; y++) { raw[y * (r.w * 4 + 1)] = 0; r.px.copy(raw, y * (r.w * 4 + 1) + 1, y * r.w * 4, (y + 1) * r.w * 4); }
  const chunk = (type, data) => { const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); return Buffer.concat([u32(data.length), td, u32(crc32(td))]); };
  const ihdr = Buffer.concat([u32(r.w), u32(r.h), Buffer.from([8, 6, 0, 0, 0])]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// baseline JPEG (YCbCr 4:4:4, the standard tables of the JPEG specification, Annex K)
const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const QY = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const QC = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, ...Array(32).fill(99)];
const H_DC_Y = { bits: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], vals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const H_DC_C = { bits: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], vals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const H_AC_Y = { bits: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], vals: [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa] };
const H_AC_C = { bits: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77], vals: [0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa] };
function huffCodes({ bits, vals }) {
  const out = {}; let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) { for (let i = 0; i < bits[len - 1]; i++) out[vals[k++]] = [code++, len]; code <<= 1; }
  return out;
}
const COS = Array.from({ length: 8 }, (_, x) => Array.from({ length: 8 }, (_, u) => Math.cos((2 * x + 1) * u * Math.PI / 16)));
function jpeg(r, quality = 88) {
  const scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
  const q = (t) => t.map((v) => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
  const qy = q(QY), qc = q(QC);
  const codes = [huffCodes(H_DC_Y), huffCodes(H_AC_Y), huffCodes(H_DC_C), huffCodes(H_AC_C)];
  const out = []; let bitBuf = 0, bitCnt = 0;
  const put = (code, len) => { for (let i = len - 1; i >= 0; i--) { bitBuf = (bitBuf << 1) | ((code >> i) & 1); if (++bitCnt === 8) { out.push(bitBuf); if (bitBuf === 0xff) out.push(0); bitBuf = 0; bitCnt = 0; } } };
  const cat = (v) => { let a = Math.abs(v), n = 0; while (a) { n++; a >>= 1; } return n; };
  const valBits = (v, n) => (v >= 0 ? v : v + (1 << n) - 1);
  const block = new Float64Array(64), tmp = new Float64Array(64), coef = new Int32Array(64);
  const prev = [0, 0, 0];
  const comp = (c, x, y) => { const i = (Math.min(r.h - 1, y) * r.w + Math.min(r.w - 1, x)) * 4; const R = r.px[i], G = r.px[i + 1], B = r.px[i + 2]; return c === 0 ? 0.299 * R + 0.587 * G + 0.114 * B - 128 : c === 1 ? -0.168736 * R - 0.331264 * G + 0.5 * B : 0.5 * R - 0.418688 * G - 0.081312 * B; };
  for (let by = 0; by < r.h; by += 8) for (let bx = 0; bx < r.w; bx += 8) for (let c = 0; c < 3; c++) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) block[y * 8 + x] = comp(c, bx + x, by + y);
    for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += block[y * 8 + x] * COS[x][u]; tmp[y * 8 + u] = s * (u ? 0.5 : 0.5 * Math.SQRT1_2); }
    const qt = c ? qc : qy;
    for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let s = 0; for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[y][v]; s *= (v ? 0.5 : 0.5 * Math.SQRT1_2); coef[v * 8 + u] = Math.round(s / qt[v * 8 + u]); }
    const [dc, ac] = c ? [codes[2], codes[3]] : [codes[0], codes[1]];
    const d = coef[0] - prev[c]; prev[c] = coef[0];
    const n = cat(d); put(...dc[n]); if (n) put(valBits(d, n), n);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const v = coef[ZIGZAG[k]];
      if (!v) { run++; continue; }
      while (run > 15) { put(...ac[0xf0]); run -= 16; }
      const m = cat(v); put(...ac[(run << 4) | m]); put(valBits(v, m), m); run = 0;
    }
    if (run) put(...ac[0x00]);
  }
  if (bitCnt) put((1 << (8 - bitCnt)) - 1, 8 - bitCnt);
  const seg = (marker, data) => Buffer.concat([Buffer.from([0xff, marker]), u16(data.length + 2), data]);
  const dqt = Buffer.concat([Buffer.from([0]), Buffer.from(ZIGZAG.map((i) => qy[i])), Buffer.from([1]), Buffer.from(ZIGZAG.map((i) => qc[i]))]);
  const sof = Buffer.concat([Buffer.from([8]), u16(r.h), u16(r.w), Buffer.from([3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1])]);
  const dht = (cls, id, t) => Buffer.concat([Buffer.from([(cls << 4) | id]), Buffer.from(t.bits), Buffer.from(t.vals)]);
  const sos = Buffer.from([3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])), seg(0xdb, dqt), seg(0xc0, sof),
    seg(0xc4, Buffer.concat([dht(0, 0, H_DC_Y), dht(1, 0, H_AC_Y), dht(0, 1, H_DC_C), dht(1, 1, H_AC_C)])), seg(0xda, sos), Buffer.from(out), Buffer.from([0xff, 0xd9]),
  ]);
}

// ----------------------------------------------------------------------------------------------------- ID3v2 --
/** Text in an ID3 encoding: v2.3 UTF-16 with BOM (1), v2.4 UTF-8 (3). */
function id3Text(s, version) { return version === 4 ? Buffer.concat([Buffer.from([3]), Buffer.from(String(s), 'utf8')]) : Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(String(s), 'utf16le')]); }
const term = (version) => (version === 4 ? Buffer.from([0]) : Buffer.from([0, 0]));
function frame(id, data, version) { return Buffer.concat([Buffer.from(id, 'latin1'), version === 4 ? ss32(data.length) : u32(data.length), Buffer.from([0, 0]), data]); }
const id3 = {
  text: (id, s, v = 3) => frame(id, id3Text(s, v), v),
  txxx: (desc, s, v = 3) => { const d = id3Text(desc, v); return frame('TXXX', Buffer.concat([d, term(v), id3Text(s, v).subarray(1)]), v); },
  comm: (s, v = 3) => frame('COMM', Buffer.concat([id3Text('', v).subarray(0, 1), Buffer.from('deu', 'latin1'), v === 4 ? Buffer.alloc(0) : Buffer.from([0xff, 0xfe]), term(v), id3Text(s, v).subarray(1)]), v),
  apic: (mime, data, v = 3, type = 3) => frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from(mime, 'latin1'), Buffer.from([0, type]), Buffer.from('Cover', 'latin1'), Buffer.from([0]), data]), v),
  chap: (id, startMs, endMs, title, v = 3) => frame('CHAP', Buffer.concat([Buffer.from(id + '\0', 'latin1'), u32(startMs), u32(endMs), u32(0xffffffff), u32(0xffffffff), id3.text('TIT2', title, v)]), v),
  ctoc: (id, children, v = 3) => frame('CTOC', Buffer.concat([Buffer.from(id + '\0', 'latin1'), Buffer.from([0x03, children.length]), ...children.map((c) => Buffer.from(c + '\0', 'latin1'))]), v),
};
/** A whole ID3v2 tag with `padding` zero bytes after the frames. */
function id3Tag(frames, version = 3, padding = 256) {
  const body = Buffer.concat([...frames, Buffer.alloc(padding)]);
  return Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([version, 0, 0]), ss32(body.length), body]);
}

// ------------------------------------------------------------------------------------------------------- MP3 --
// MPEG-2 Layer III, 16 kHz, 8 kbit/s, mono: 36-byte frames of 576 samples (36 ms), all zero = silence
const MP3 = { rate: 16000, spf: 576, bytes: 36, header: Buffer.from([0xff, 0xf3, 0x18, 0xc4]) };
/** `seconds` of silent MP3 frames; the first one carries a Xing header with the frame count. */
function mp3Frames(seconds, { xing = true } = {}) {
  const n = Math.max(2, Math.round(seconds * MP3.rate / MP3.spf));
  const frames = [];
  for (let i = 0; i < n; i++) {
    const f = Buffer.alloc(MP3.bytes); MP3.header.copy(f, 0);
    if (i === 0 && xing) { f.write('Xing', 4 + 9, 'latin1'); f.writeUInt32BE(0x3, 4 + 9 + 4); f.writeUInt32BE(n, 4 + 9 + 8); f.writeUInt32BE(n * MP3.bytes, 4 + 9 + 12); }
    frames.push(f);
  }
  return frames;
}
const mp3Seconds = (frames) => frames.length * MP3.spf / MP3.rate;
function mp3File({ seconds, tag = null, xing = true }) { return Buffer.concat([tag || Buffer.alloc(0), ...mp3Frames(seconds, { xing })]); }

// ------------------------------------------------------------------------------------------------------- WAV --
/** 8-bit mono PCM with a speech-like rhythm: syllables of a gliding tone, short pauses between words. */
function wavFile({ seconds, rate = 8000, seed = 1, info = {} }) {
  const n = Math.round(seconds * rate), pcm = Buffer.alloc(n);
  let s = seed >>> 0 || 1; const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
  let i = 0;
  while (i < n) {
    const syl = Math.round(rate * (0.08 + rnd() * 0.16)), pause = Math.round(rate * (rnd() < 0.25 ? 0.25 + rnd() * 0.3 : 0.03 + rnd() * 0.05));
    const f0 = 110 + rnd() * 90, f1 = f0 * (0.85 + rnd() * 0.3);
    for (let k = 0; k < syl && i < n; k++, i++) {
      const t = k / syl, env = Math.sin(Math.PI * t) ** 1.5, f = f0 + (f1 - f0) * t;
      const v = Math.sin(2 * Math.PI * f * i / rate) * 0.6 + Math.sin(4 * Math.PI * f * i / rate) * 0.25 + Math.sin(6 * Math.PI * f * i / rate) * 0.1;
      pcm[i] = 128 + Math.round(v * env * 90);
    }
    for (let k = 0; k < pause && i < n; k++, i++) pcm[i] = 128;
  }
  const chunks = [];
  const fmt = Buffer.alloc(16); fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(rate, 4); fmt.writeUInt32LE(rate, 8); fmt.writeUInt16LE(1, 12); fmt.writeUInt16LE(8, 14);
  chunks.push(Buffer.from('fmt ', 'latin1'), le32(16), fmt);
  const entries = Object.entries(info).filter(([, v]) => v != null && v !== '');
  if (entries.length) {
    const sub = entries.map(([k, v]) => { let d = Buffer.from(String(v) + '\0', 'utf8'); if (d.length & 1) d = Buffer.concat([d, Buffer.alloc(1)]); return Buffer.concat([Buffer.from(k, 'latin1'), le32(d.length), d]); });
    const list = Buffer.concat([Buffer.from('INFO', 'latin1'), ...sub]);
    chunks.push(Buffer.from('LIST', 'latin1'), le32(list.length), list);
  }
  chunks.push(Buffer.from('data', 'latin1'), le32(pcm.length), pcm);
  if (pcm.length & 1) chunks.push(Buffer.alloc(1));
  const body = Buffer.concat(chunks);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), le32(body.length + 4), Buffer.from('WAVE', 'latin1'), body]);
}

// ------------------------------------------------------------------------------------------------------- MP4 --
const box = (type, ...parts) => { const body = Buffer.concat(parts.flat()); return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]); };
const full = (type, v, flags, ...parts) => box(type, Buffer.from([v, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...parts);
function ilstItem(key, value) {
  if (key === 'covr') return box('covr', box('data', u32(value.mime === 'image/png' ? 14 : 13), u32(0), value.data));
  if (key === 'trkn' || key === 'disk') return box(key, box('data', u32(0), u32(0), Buffer.from([0, 0]), u16(value[0]), u16(value[1] || 0), key === 'trkn' ? Buffer.from([0, 0]) : Buffer.alloc(0)));
  if (key.startsWith('----:')) { const [, mean, name] = key.split(':'); return box('----', full('mean', 0, 0, Buffer.from(mean, 'utf8')), full('name', 0, 0, Buffer.from(name, 'utf8')), box('data', u32(1), u32(0), Buffer.from(String(value), 'utf8'))); }
  return box(key, box('data', u32(1), u32(0), Buffer.from(String(value), 'utf8')));
}
/**
 * An M4B/M4A file: the MP3 frames as its audio (object type 0x69, MPEG-2 audio), iTunes tags, the chapters as a
 * QuickTime text track (qt) and/or Nero chpl (nero), a cover. chapters: [{ start (s), title }].
 */
function mp4File({ seconds, tags = {}, chapters = [], cover = null, qt = true, nero = true, brand = 'M4B ' }) {
  const frames = mp3Frames(seconds, { xing: false });
  const total = frames.length * MP3.spf;
  const durMs = Math.round(total * 1000 / MP3.rate);
  const ftyp = box('ftyp', Buffer.from(brand, 'latin1'), u32(0), Buffer.from(brand + 'M4A mp42isom', 'latin1'));
  const texts = chapters.map((c) => { const t = Buffer.from(c.title, 'utf8'); return Buffer.concat([u16(t.length), t, box('encd', u32(0x100))]); });
  const build = (mdatStart) => {
    const audioOff = mdatStart + 8;
    let off = audioOff + frames.length * MP3.bytes;
    const textOffs = texts.map((t) => { const o = off; off += t.length; return o; });
    const esds = full('esds', 0, 0, Buffer.from([0x03, 0x15, 0x00, 0x01, 0x00, 0x04, 0x0d, 0x69, 0x15, 0x00, 0x01, 0x00]), u32(8000), u32(8000), Buffer.from([0x06, 0x01, 0x02]));
    const mp4a = box('mp4a', Buffer.alloc(6), u16(1), Buffer.alloc(8), u16(1), u16(16), u16(0), u16(0), u32(MP3.rate << 16), esds);
    const audioStbl = box('stbl',
      full('stsd', 0, 0, u32(1), mp4a),
      full('stts', 0, 0, u32(1), u32(frames.length), u32(MP3.spf)),
      full('stsc', 0, 0, u32(1), u32(1), u32(frames.length), u32(1)),
      full('stsz', 0, 0, u32(MP3.bytes), u32(frames.length)),
      full('stco', 0, 0, u32(1), u32(audioOff)));
    const tkhd = (id, flags) => full('tkhd', 0, flags, u32(0), u32(0), u32(id), u32(0), u32(durMs), Buffer.alloc(8), u16(0), u16(0), u16(id === 1 ? 0x0100 : 0), u16(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000), u32(0), u32(0));
    const mdhd = (scale, dur) => full('mdhd', 0, 0, u32(0), u32(0), u32(scale), u32(dur), u16(0x55c4), u16(0));
    const hdlr = (type, name) => full('hdlr', 0, 0, u32(0), Buffer.from(type, 'latin1'), Buffer.alloc(12), Buffer.from(name + '\0', 'latin1'));
    const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
    const audio = box('trak', tkhd(1, 3), qt && chapters.length ? box('tref', box('chap', u32(2))) : Buffer.alloc(0),
      box('mdia', mdhd(MP3.rate, total), hdlr('soun', 'SoundHandler'), box('minf', full('smhd', 0, 0, u32(0)), dinf, audioStbl)));
    const traks = [audio];
    if (qt && chapters.length) {
      const ms = chapters.map((c, i) => Math.round(((chapters[i + 1]?.start ?? total / MP3.rate) - c.start) * 1000));
      const textEntry = box('text', Buffer.alloc(6), u16(1), Buffer.alloc(51));
      const stbl = box('stbl', full('stsd', 0, 0, u32(1), textEntry),
        full('stts', 0, 0, u32(ms.length), ...ms.map((d) => [u32(1), u32(d)])),
        full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
        full('stsz', 0, 0, u32(0), u32(texts.length), ...texts.map((t) => u32(t.length))),
        full('stco', 0, 0, u32(textOffs.length), ...textOffs.map((o) => u32(o))));
      traks.push(box('trak', tkhd(2, 0), box('mdia', mdhd(1000, durMs), hdlr('text', 'ChapterHandler'), box('minf', box('gmhd', full('gmin', 0, 0, Buffer.alloc(12))), dinf, stbl))));
    }
    const items = Object.entries(tags).filter(([, v]) => v != null).map(([k, v]) => ilstItem(k, v));
    if (cover) items.push(ilstItem('covr', cover));
    const udtaParts = [full('meta', 0, 0, hdlr('mdir', ''), box('ilst', ...items))];
    if (nero && chapters.length) {
      const entries = chapters.map((c) => { const t = Buffer.from(c.title, 'utf8'); const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(Math.round(c.start * 1e7))); return Buffer.concat([b, Buffer.from([t.length]), t]); });
      udtaParts.unshift(full('chpl', 1, 0, u32(0), Buffer.from([chapters.length]), ...entries));
    }
    const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(durMs), u32(0x10000), u16(0x100), Buffer.alloc(10), u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000), Buffer.alloc(24), u32(3));
    return box('moov', mvhd, ...traks, box('udta', ...udtaParts));
  };
  // moov first (fast start): its size does not depend on the offsets, so build it twice
  const probe = build(0);
  const moov = build(ftyp.length + probe.length);
  const mdat = box('mdat', ...frames, ...texts);
  return Buffer.concat([ftyp, moov, mdat]);
}

// ------------------------------------------------------------------------------------------------------ FLAC --
function vorbisComment(vendor, comments) {
  const items = comments.map((c) => Buffer.from(c, 'utf8'));
  return Buffer.concat([le32(Buffer.byteLength(vendor)), Buffer.from(vendor, 'utf8'), le32(items.length), ...items.map((b) => Buffer.concat([le32(b.length), b]))]);
}
function flacPictureBlock(data, mime) {
  return Buffer.concat([u32(3), u32(mime.length), Buffer.from(mime, 'latin1'), u32(5), Buffer.from('Cover', 'latin1'), u32(0), u32(0), u32(24), u32(0), u32(data.length), data]);
}
/** FLAC, 8 kHz, 8 bit, mono, verbatim frames of 4096 samples with the speech-like tone of wavFile. */
function flacFile({ seconds, comments = [], picture = null, seed = 3 }) {
  const rate = 8000, block = 4096;
  const wav = wavFile({ seconds, rate, seed });
  const pcm = wav.subarray(wav.indexOf('data', 0, 'latin1') + 8);
  const n = pcm.length;
  const si = Buffer.alloc(34);
  si.writeUInt16BE(block, 0); si.writeUInt16BE(block, 2);
  // sample rate (20 bits), channels − 1 (3 bits), bits per sample − 1 (5 bits: 7), total samples (36 bits)
  si[10] = (rate >> 12) & 0xff; si[11] = (rate >> 4) & 0xff; si[12] = ((rate & 0x0f) << 4) | (0 << 1) | ((7 >> 4) & 1);
  si[13] = ((7 & 0x0f) << 4) | (Math.floor(n / 2 ** 32) & 0x0f); si.writeUInt32BE(n >>> 0, 14);
  const blocks = [[0, si], [4, vorbisComment('Cozy Shelves test writer', comments)]];
  if (picture) blocks.push([6, flacPictureBlock(picture.data, picture.mime)]);
  const meta = blocks.map(([type, data], i) => Buffer.concat([Buffer.from([(i === blocks.length - 1 ? 0x80 : 0) | type]), Buffer.from([(data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255]), data]));
  const frames = [];
  for (let f = 0, s0 = 0; s0 < n; f++, s0 += block) {
    const len = Math.min(block, n - s0);
    // block size code 12 (4096), for the last short frame 7 (16-bit size − 1 follows); 8 kHz = code 4; mono; 8 bit
    const head = [0xff, 0xf8, ((len === block ? 12 : 7) << 4) | 4, (0 << 4) | (1 << 1) | 0];
    const num = []; if (f < 0x80) num.push(f); else num.push(0xc0 | (f >> 6), 0x80 | (f & 0x3f));
    const hb = Buffer.from([...head, ...num, ...(len === block ? [] : [(len - 1) >> 8, (len - 1) & 0xff])]);
    const h = Buffer.concat([hb, Buffer.from([crc8(hb)])]);
    const sub = Buffer.alloc(1 + len); sub[0] = 0x02;
    for (let k = 0; k < len; k++) sub[1 + k] = (pcm[s0 + k] - 128) & 0xff;
    const body = Buffer.concat([h, sub]);
    frames.push(body, u16(crc16(body)));
  }
  return Buffer.concat([Buffer.from('fLaC', 'latin1'), ...meta, ...frames]);
}

// ------------------------------------------------------------------------------------------------------- Ogg --
function oggPage(packetData, { serial = 0x1234, seq, granule, bos = false, eos = false, continued = false }) {
  const lace = []; let rest = packetData.length;
  while (rest >= 255) { lace.push(255); rest -= 255; }
  lace.push(rest);
  const h = Buffer.alloc(27);
  h.write('OggS', 0, 'latin1'); h[4] = 0; h[5] = (continued ? 1 : 0) | (bos ? 2 : 0) | (eos ? 4 : 0);
  h.writeBigUInt64LE(BigInt(granule), 6); h.writeUInt32LE(serial, 14); h.writeUInt32LE(seq, 18); h[26] = lace.length;
  const page = Buffer.concat([h, Buffer.from(lace), packetData]);
  page.writeUInt32LE(oggCrc(page), 22);
  return page;
}
/** Ogg Vorbis or Opus headers with comments (a picture as METADATA_BLOCK_PICTURE) and one last page whose granule
 *  gives `seconds`: enough for the tag reader, not playable. */
function oggFile({ kind = 'vorbis', seconds, comments = [], picture = null }) {
  const all = [...comments];
  if (picture) all.push('METADATA_BLOCK_PICTURE=' + flacPictureBlock(picture.data, picture.mime).toString('base64'));
  let id, comment, rate;
  if (kind === 'opus') {
    rate = 48000;
    id = Buffer.concat([Buffer.from('OpusHead', 'latin1'), Buffer.from([1, 1]), Buffer.from([0x38, 0x01]), le32(44100), Buffer.from([0, 0, 0])]);
    comment = Buffer.concat([Buffer.from('OpusTags', 'latin1'), vorbisComment('Cozy Shelves', all)]);
  } else {
    rate = 44100;
    id = Buffer.concat([Buffer.from([1]), Buffer.from('vorbis', 'latin1'), le32(0), Buffer.from([1]), le32(rate), le32(0), le32(64000), le32(0), Buffer.from([0xb8, 1])]);
    comment = Buffer.concat([Buffer.from([3]), Buffer.from('vorbis', 'latin1'), vorbisComment('Cozy Shelves', all), Buffer.from([1])]);
  }
  const preskip = kind === 'opus' ? 312 : 0;
  // the comment packet may span pages: split at 255 × 255 bytes per page
  const pages = [oggPage(id, { seq: 0, granule: 0, bos: true })];
  let seq = 1;
  for (let o = 0; o < comment.length; o += 255 * 255) {
    const part = comment.subarray(o, o + 255 * 255);
    const lastPart = o + 255 * 255 >= comment.length;
    // a packet that continues on the next page ends its page with a 255 lacing value: write the page raw
    if (!lastPart) {
      const h = Buffer.alloc(27); h.write('OggS', 0, 'latin1'); h[5] = o ? 1 : 0; h.writeBigInt64LE(-1n, 6); h.writeUInt32LE(0x1234, 14); h.writeUInt32LE(seq++, 18); h[26] = 255;
      const page = Buffer.concat([h, Buffer.alloc(255, 255), part]); page.writeUInt32LE(oggCrc(page), 22); pages.push(page);
    } else pages.push(oggPage(part, { seq: seq++, granule: 0, continued: o > 0 }));
  }
  pages.push(oggPage(Buffer.from([0]), { seq: seq++, granule: Math.round(seconds * rate) + preskip, eos: true }));
  return Buffer.concat(pages);
}

module.exports = { Raster, drawCover, png, jpeg, id3, id3Tag, mp3Frames, mp3File, mp3Seconds, MP3, wavFile, mp4File, flacFile, oggFile, crc32 };
