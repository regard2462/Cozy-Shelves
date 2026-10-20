// Tags of audio files for the audiobooks (electron/audiobooks): title, album, artist, narrator, series, track and disc
// number, the duration, the chapters and where an embedded picture lies. Only headers are read: a few small reads per
// file, an embedded picture is skipped (its place is noted) and read only when it becomes a cover (readPicture). Audio
// is never decoded. Supported:
//   MP3   ID3v2.2/2.3/2.4 (text frames, TXXX, APIC/PIC, CHAP/CTOC chapters), ID3v1; the duration from the Xing/Info or
//         VBRI header, else from the bit rate of the first frame (TLEN as a hint)
//   MP4   M4A/M4B: iTunes tags (ilst, freeform ----), the QuickTime chapter track (tref/chap), Nero chapters (chpl)
//   FLAC  STREAMINFO, VORBIS_COMMENT (CHAPTERxxx), PICTURE
//   Ogg   Vorbis and Opus: comments, METADATA_BLOCK_PICTURE, the duration from the granule of the last page
//   WAV   fmt/data, LIST INFO, an embedded ID3 chunk
//   AAC   ADTS frames (estimated duration), an ID3v2 tag in front
// Every reader returns the same plain object (emptyMeta()); a file that cannot be read gives { error }.
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.m4b', '.aac', '.ogg', '.oga', '.opus', '.flac', '.wav']);
const SMALL = 256 * 1024;            // read a box or a list in one go up to this size
const WINDOW = 16 * 1024;            // ID3 frames are walked in windows of this size: a big picture is jumped over
const HEAD = 32 * 1024;              // the first read of every file: the format, the tag header, the first frames
const MAX_FRAME = 4 * 1024 * 1024;   // larger ID3 frames are only noted (pictures), never read while scanning

/** Positioned reads on an open file, clamped to its size; what lies in the first HEAD bytes comes from one read. */
class Source {
  constructor(fh, size) { this.fh = fh; this.size = size; this.reads = 0; this.bytes = 0; this.head = null; }
  async prime() { this.head = await this.read(0, HEAD); return this.head; }
  async read(pos, len) {
    pos = Math.max(0, Math.floor(pos));
    const n = Math.max(0, Math.min(Math.floor(len), this.size - pos));
    if (this.head && pos + n <= this.head.length) return this.head.subarray(pos, pos + n);
    const buf = Buffer.alloc(n);
    if (!n) return buf;
    const { bytesRead } = await this.fh.read(buf, 0, n, pos);
    this.reads++; this.bytes += bytesRead;
    return bytesRead === n ? buf : buf.subarray(0, bytesRead);
  }
}

function emptyMeta(format) {
  return {
    format, duration: null, durationExact: false,
    title: null, album: null, artist: null, albumArtist: null, composer: null, narrator: null, genre: null, year: null,
    comment: null, grouping: null, subtitle: null, series: null, seriesPart: null, mediaKind: null,
    track: null, trackTotal: null, disc: null, discTotal: null,
    chapters: [], picture: null,
  };
}

// ---------------------------------------------------------------------------------------------- text helpers --
/** A tag value as clean text: no control characters, no padding, single spaces; null when empty. */
function clean(s) {
  if (s == null) return null;
  const t = String(s).replace(/[\u0000-\u0008\u000b-\u001f\u007f﻿]/g, '').replace(/\s+/g, ' ').trim();
  return t || null;
}
function utf16(buf, order) {
  let le = order !== 'be', start = 0;
  if (buf.length >= 2) {
    if (buf[0] === 0xff && buf[1] === 0xfe) { le = true; start = 2; } else if (buf[0] === 0xfe && buf[1] === 0xff) { le = false; start = 2; }
  }
  let b = buf.subarray(start, start + ((buf.length - start) & ~1));
  if (!le) { b = Buffer.from(b); b.swap16(); }
  return b.toString('utf16le');
}
/** ID3 text encodings: 0 ISO-8859-1, 1 UTF-16 with BOM, 2 UTF-16BE, 3 UTF-8. */
function decodeText(buf, enc) {
  if (enc === 1) return utf16(buf, null);
  if (enc === 2) return utf16(buf, 'be');
  if (enc === 3) return buf.toString('utf8');
  return buf.toString('latin1');
}
/** The string up to the terminator of the encoding: [bytes, index after the terminator]. */
function splitTerm(buf, enc, from = 0) {
  if (enc === 1 || enc === 2) {
    for (let i = from; i + 1 < buf.length; i += 2) if (buf[i] === 0 && buf[i + 1] === 0) return [buf.subarray(from, i), i + 2];
    return [buf.subarray(from), buf.length];
  }
  const i = buf.indexOf(0, from);
  return i < 0 ? [buf.subarray(from), buf.length] : [buf.subarray(from, i), i + 1];
}
/** Several values (ID3v2.4 separates them with a terminator) joined with a comma. */
function textValues(buf, enc) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const [s, next] = splitTerm(buf, enc, i);
    const t = clean(decodeText(s, enc));
    if (t) out.push(t);
    if (next <= i) break;
    i = next;
  }
  return out;
}
const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
/** Undo the ID3 unsynchronisation (0xFF 0x00 → 0xFF). */
function deUnsync(buf) {
  const out = Buffer.alloc(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) { out[n++] = buf[i]; if (buf[i] === 0xff && buf[i + 1] === 0x00) i++; }
  return out.subarray(0, n);
}
/** "3/12" → [3, 12]; "1" → [1, null]. */
function numPair(s) {
  const m = /^\s*(\d{1,4})\s*(?:\/\s*(\d{1,4}))?/.exec(String(s || ''));
  return m ? [parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : null] : [null, null];
}
const yearOf = (s) => { const m = /(1[5-9]\d\d|20\d\d)/.exec(String(s || '')); return m ? parseInt(m[1], 10) : null; };
/** "01:02:03.500" or "62:03.5" or "3723.5" → seconds. */
function timeOf(s) {
  const t = String(s || '').trim();
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  const m = /^(?:(\d+):)?(\d{1,3}):(\d{1,2}(?:[.,]\d+)?)$/.exec(t);
  return m ? (parseInt(m[1] || '0', 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3].replace(',', '.'))) : null;
}
/** The ID3v1 genres a numeric genre ("(12)", "12") may refer to – only the ones an audiobook would carry. */
const GENRES = { 101: 'Speech', 183: 'Audiobook', 12: 'Other', 28: 'Vocal', 57: 'Comedy', 65: 'Cabaret', 186: 'Audio Theatre' };
function genreText(s) {
  const t = clean(s); if (!t) return null;
  const m = /^\(?(\d{1,3})\)?$/.exec(t);
  return m ? (GENRES[+m[1]] || null) : t.replace(/^\(\d+\)/, '').trim() || null;
}

/** Keys of freeform tags (TXXX, Vorbis comments, MP4 ----) that matter here, upper case without separators. */
const FREE = {
  SERIES: 'series', SERIESNAME: 'series', SERIESTITLE: 'series', MOVEMENTNAME: 'series', SHOW: 'series', SHOWMOVEMENT: null,
  SERIESPART: 'seriesPart', SERIESNUMBER: 'seriesPart', SERIESINDEX: 'seriesPart', SERIESSEQUENCE: 'seriesPart', MOVEMENT: 'seriesPart', VOLUME: 'seriesPart', BAND: 'seriesPart',
  NARRATOR: 'narrator', NARRATEDBY: 'narrator', READER: 'narrator', READBY: 'narrator', PERFORMER: 'narrator', SPRECHER: 'narrator', GELESENVON: 'narrator',
  ALBUMARTIST: 'albumArtist', ALBUMARTISTS: 'albumArtist', AUTHOR: 'author', WRITER: 'author',
  SUBTITLE: 'subtitle', GROUPING: 'grouping', CONTENTGROUP: 'grouping', DESCRIPTION: 'comment', COMMENT: 'comment',
};
const freeKey = (k) => String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function applyFree(meta, key, value) {
  const v = clean(value); if (!v) return;
  const field = FREE[freeKey(key)];
  if (!field) return;
  if (field === 'author') { if (!meta.artist) meta.artist = v; return; }
  if (field === 'seriesPart') { const n = parseFloat(String(v).replace(',', '.')); if (isFinite(n) && meta.seriesPart == null) meta.seriesPart = n; return; }
  if (meta[field] == null) meta[field] = v;
}

// ------------------------------------------------------------------------------------------------------ ID3v2 --
const V22 = { TT1: 'TIT1', TT2: 'TIT2', TT3: 'TIT3', TAL: 'TALB', TP1: 'TPE1', TP2: 'TPE2', TP3: 'TPE3', TCM: 'TCOM', TYE: 'TYER', TRK: 'TRCK', TPA: 'TPOS', TCO: 'TCON', COM: 'COMM', PIC: 'APIC', TXX: 'TXXX', TLE: 'TLEN' };
const WANT = new Set(['TIT1', 'TIT2', 'TIT3', 'TALB', 'TPE1', 'TPE2', 'TCOM', 'TYER', 'TDRC', 'TORY', 'TDOR', 'TRCK', 'TPOS', 'TCON', 'TLEN', 'TXXX', 'COMM', 'CHAP', 'CTOC', 'MVNM', 'MVIN', 'GRP1', 'TSST']);
const validId = (id) => /^[A-Z0-9]{3,4}$/.test(id);

/**
 * The ID3v2 tag at `pos` (start of the file, or an 'id3 ' chunk of a WAV file).
 * @returns null without a tag, else { end, meta fields …, tlen, chapters, picture }
 */
async function readId3v2(src, pos = 0, { maxSize = src.size } = {}) {
  const head = await src.read(pos, 10);
  if (head.length < 10 || head.toString('latin1', 0, 3) !== 'ID3') return null;
  const major = head[3], flags = head[5];
  if (major < 2 || major > 4) return null;
  const size = syncsafe(head, 6);
  const footer = major === 4 && (flags & 0x10) ? 10 : 0;
  const bodyEnd = Math.min(pos + 10 + size, src.size, pos + 10 + maxSize);
  const tag = { version: major, end: Math.min(pos + 10 + size + footer, src.size), values: {}, txxx: [], comments: [], chapters: [], tocs: [], picture: null, tlen: null };
  let bodyStart = pos + 10;
  if (major < 4 && flags & 0x80) {
    // the whole tag is unsynchronised: read it at once and undo that (rare; the picture is then found again in memory)
    const body = deUnsync(await src.read(bodyStart, Math.min(bodyEnd - bodyStart, 64 * 1024 * 1024)));
    parseFrames(tag, body, 0, major);
    if (tag.picture) tag.picture = { ...tag.picture, offset: null, reparse: 'id3', at: pos };
    return tag;
  }
  // an extended header comes first
  if (flags & 0x40 && major >= 3) {
    const eh = await src.read(bodyStart, 4);
    const ehSize = major === 4 ? syncsafe(eh, 0) : eh.readUInt32BE(0) + 4;
    if (ehSize > 0 && ehSize < size) bodyStart += ehSize;
  }
  await walkFrames(src, tag, bodyStart, bodyEnd, major, pos);
  return tag;
}

/** The frames of a tag read from the file in windows: big frames (pictures) are skipped, their place is noted. */
async function walkFrames(src, tag, start, end, major, tagPos) {
  const hsz = major === 2 ? 6 : 10;
  let win = Buffer.alloc(0), winPos = start, cur = start;
  for (let guard = 0; guard < 20000 && cur + hsz <= end; guard++) {
    if (cur < winPos || cur + hsz > winPos + win.length) { winPos = cur; win = await src.read(cur, Math.min(WINDOW, end - cur)); if (win.length < hsz) break; }
    const o = cur - winPos;
    if (win[o] === 0) break;                                   // padding
    const h = frameHeader(win, o, major, (at) => { const p = at - winPos; return p >= 0 && p + 4 <= win.length ? win.toString('latin1', p, p + 4) : null; }, cur, end);
    if (!h) break;
    const dataStart = cur + h.hsz, dataEnd = dataStart + h.size;
    if (dataEnd > end + 1) break;
    if (h.id === 'APIC') {
      // the picture: note where it is (type, mime); its bytes are read only for the cover
      const first = dataEnd <= winPos + win.length ? win.subarray(dataStart - winPos, dataEnd - winPos) : await src.read(dataStart, Math.min(h.size, 1024));
      const pic = h.flags.unsync || h.flags.compressed || h.flags.encrypted ? null : apicInfo(first, major);
      if (pic && pic.dataOffset < h.size) {
        const cand = { offset: dataStart + pic.dataOffset, length: h.size - pic.dataOffset, mime: pic.mime, type: pic.type };
        if (!tag.picture || (cand.type === 3 && tag.picture.type !== 3)) tag.picture = cand;
      } else if (!tag.picture && (h.flags.unsync || h.flags.compressed)) tag.picture = { offset: null, reparse: 'id3', at: tagPos, type: 3 };
    } else if (WANT.has(h.id) && h.size <= MAX_FRAME) {
      let data = dataEnd <= winPos + win.length ? win.subarray(dataStart - winPos, dataEnd - winPos) : await src.read(dataStart, h.size);
      data = frameData(data, h);
      if (data) frameValue(tag, h.id, data, major);
    }
    cur = dataEnd;
  }
}

/** A frame header at buffer offset `o`: { id, size, hsz, flags } or null. `peek(abs)` reads 4 bytes of the file
 *  (null when unknown) to tell a real syncsafe size from the plain one some taggers write into ID3v2.4. */
function frameHeader(buf, o, major, peek, absPos, end) {
  if (major === 2) {
    if (o + 6 > buf.length) return null;
    const id = V22[buf.toString('latin1', o, o + 3)] || buf.toString('latin1', o, o + 3);
    if (!validId(id)) return null;
    return { id, size: buf.readUIntBE(o + 3, 3), hsz: 6, flags: {} };
  }
  if (o + 10 > buf.length) return null;
  const id = buf.toString('latin1', o, o + 4);
  if (!validId(id)) return null;
  let size = buf.readUInt32BE(o + 4);
  if (major === 4) {
    const safe = syncsafe(buf, o + 4);
    const isSafe = !(buf[o + 4] & 0x80 || buf[o + 5] & 0x80 || buf[o + 6] & 0x80 || buf[o + 7] & 0x80);
    if (isSafe && safe !== size) {
      // which size leads to the next frame (or the end)?
      const ok = (s) => { const at = absPos + 10 + s; if (at === end || at + 4 > end) return at <= end; const n = peek(at); return n == null ? null : (validId(n) || n.charCodeAt(0) === 0); };
      const a = ok(safe), b = ok(size);
      size = a === false && b === true ? size : safe;
    } else if (isSafe) size = safe;
  }
  const f1 = buf[o + 9];
  const flags = major === 4
    ? { grouping: !!(f1 & 0x40), compressed: !!(f1 & 0x08), encrypted: !!(f1 & 0x04), unsync: !!(f1 & 0x02), dli: !!(f1 & 0x01) }
    : { compressed: !!(f1 & 0x80), encrypted: !!(f1 & 0x40), grouping: !!(f1 & 0x20) };
  return { id, size, hsz: 10, flags, major };
}
/** The payload of a frame without its extra header bytes, unsynchronised and inflated when it says so; null when
 *  it cannot be read (encrypted). */
function frameData(data, h) {
  const f = h.flags || {};
  if (f.encrypted) return null;
  let d = data, skip = 0;
  if (h.major === 4) { if (f.grouping) skip += 1; if (f.dli) skip += 4; }
  else { if (f.compressed) skip += 4; if (f.encrypted) skip += 1; if (f.grouping) skip += 1; }
  d = d.subarray(skip);
  if (f.unsync) d = deUnsync(d);
  if (f.compressed) { try { d = zlib.inflateSync(d); } catch { return null; } }
  return d;
}
/** APIC / PIC: where the picture data starts inside the frame, its MIME type and picture type. */
function apicInfo(data, major) {
  if (!data || data.length < 4) return null;
  const enc = data[0];
  let i = 1, mime;
  if (major === 2) { const fmt = data.toString('latin1', 1, 4).toUpperCase(); mime = fmt === 'PNG' ? 'image/png' : 'image/jpeg'; i = 4; }
  else { const [m, next] = splitTerm(data, 0, 1); mime = m.toString('latin1').toLowerCase() || 'image/jpeg'; i = next; }
  const type = data[i]; i += 1;
  const [, next] = splitTerm(data, enc, i);
  if (!mime.includes('/')) mime = 'image/' + (mime === 'png' ? 'png' : 'jpeg');
  return { mime, type, dataOffset: next };
}
/** The value of a wanted frame into the tag. */
function frameValue(tag, id, data, major) {
  if (!data.length) return;
  if (id === 'TXXX') {
    const enc = data[0]; const [d, next] = splitTerm(data, enc, 1);
    tag.txxx.push([clean(decodeText(d, enc)), textValues(data.subarray(next), enc).join(', ')]);
    return;
  }
  if (id === 'COMM') {
    if (data.length < 5) return;
    const enc = data[0]; const [d, next] = splitTerm(data, enc, 4);
    tag.comments.push([clean(decodeText(d, enc)) || '', clean(decodeText(data.subarray(next), enc))]);
    return;
  }
  if (id === 'CHAP') {
    const [eid, next] = splitTerm(data, 0, 0);
    if (next + 16 > data.length) return;
    const start = data.readUInt32BE(next), endMs = data.readUInt32BE(next + 4);
    const sub = { values: {}, txxx: [], comments: [], chapters: [], tocs: [], picture: null };
    parseFrames(sub, data.subarray(next + 16), 0, major, 0, null);
    tag.chapters.push({ id: eid.toString('latin1'), start: start / 1000, end: endMs !== 0xffffffff && endMs > start ? endMs / 1000 : null, title: sub.values.TIT2 || sub.values.TIT3 || null });
    return;
  }
  if (id === 'CTOC') {
    const [eid, next] = splitTerm(data, 0, 0);
    if (next + 2 > data.length) return;
    const fl = data[next], count = data[next + 1];
    const children = []; let i = next + 2;
    for (let k = 0; k < count && i < data.length; k++) { const [c, n2] = splitTerm(data, 0, i); children.push(c.toString('latin1')); i = n2; }
    tag.tocs.push({ id: eid.toString('latin1'), top: !!(fl & 0x02), ordered: !!(fl & 0x01), children });
    return;
  }
  if (id[0] === 'T' || id === 'MVNM' || id === 'MVIN' || id === 'GRP1') {
    const vals = textValues(data.subarray(1), data[0]);
    if (vals.length && tag.values[id] == null) tag.values[id] = vals.join(', ');
  }
}
/** Frames of a buffer in memory (an unsynchronised tag, the sub-frames of a chapter). */
function parseFrames(tag, buf, start, major) {
  let o = start;
  const hsz = major === 2 ? 6 : 10;
  for (let guard = 0; guard < 20000 && o + hsz <= buf.length; guard++) {
    if (buf[o] === 0) break;
    const h = frameHeader(buf, o, major, (at) => (at + 4 <= buf.length ? buf.toString('latin1', at, at + 4) : null), o, buf.length);
    if (!h) break;
    const ds = o + h.hsz, de = ds + h.size;
    if (de > buf.length) break;
    if (h.id === 'APIC') {
      const pic = apicInfo(frameData(buf.subarray(ds, de), h), major);
      if (pic && (!tag.picture || (pic.type === 3 && tag.picture.type !== 3))) tag.picture = { offset: null, length: h.size - pic.dataOffset, mime: pic.mime, type: pic.type };
    } else if (WANT.has(h.id)) {
      const d = frameData(buf.subarray(ds, de), h);
      if (d) frameValue(tag, h.id, d, major);
    }
    o = de;
  }
}

/** The ID3v2 values in the common meta fields. */
function id3Meta(meta, tag) {
  const v = tag.values;
  meta.title ??= v.TIT2 || null;
  meta.album ??= v.TALB || null;
  meta.artist ??= v.TPE1 || null;
  meta.albumArtist ??= v.TPE2 || null;
  meta.composer ??= v.TCOM || null;
  meta.genre ??= genreText(v.TCON);
  meta.year ??= yearOf(v.TDRC || v.TYER || v.TORY || v.TDOR);
  meta.grouping ??= v.GRP1 || v.TIT1 || null;
  meta.subtitle ??= v.TIT3 || v.TSST || null;
  if (v.MVNM) meta.series ??= v.MVNM;
  if (v.MVIN && meta.seriesPart == null) { const n = numPair(v.MVIN)[0]; if (n != null) meta.seriesPart = n; }
  const [tn, tt] = numPair(v.TRCK); const [dn, dt] = numPair(v.TPOS);
  meta.track ??= tn; meta.trackTotal ??= tt; meta.disc ??= dn; meta.discTotal ??= dt;
  for (const [k, val] of tag.txxx) applyFree(meta, k, val);
  const comment = tag.comments.find(([d]) => !d || /^(comment|description|beschreibung)$/i.test(d));
  if (comment && !meta.comment) meta.comment = comment[1];
  if (tag.chapters.length && !meta.chapters.length) meta.chapters = orderChapters(tag.chapters, tag.tocs);
  if (tag.picture && !meta.picture) meta.picture = tag.picture;
  const tlen = parseInt(v.TLEN, 10);
  if (tlen > 0) tag.tlen = tlen / 1000;
}
/** Chapters in the order of the top table of contents (CTOC), else by start time; one ID3 chapter = { start, end, title }. */
function orderChapters(chapters, tocs) {
  let list = chapters;
  const top = tocs.find((t) => t.top) || tocs[0];
  if (top && top.children.length) {
    const byId = new Map(chapters.map((c) => [c.id, c]));
    const ordered = top.children.map((id) => byId.get(id)).filter(Boolean);
    if (ordered.length >= Math.min(2, chapters.length)) list = ordered;
  }
  return [...list].sort((a, b) => a.start - b.start).map(({ start, end, title }) => ({ start, end, title: clean(title) }));
}

// ------------------------------------------------------------------------------------------------------- MP3 --
const BITRATES = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };
/** An MPEG audio frame header at `o`: { version, layer, bitrate, rate, spf, length, mono } or null. */
function mpegHeader(b, o) {
  if (o + 4 > b.length || b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null;
  const vbits = (b[o + 1] >> 3) & 3, lbits = (b[o + 1] >> 1) & 3;
  if (vbits === 1 || lbits === 0) return null;
  const version = vbits === 3 ? 1 : vbits === 2 ? 2 : 2.5, layer = 4 - lbits;
  const bi = b[o + 2] >> 4, ri = (b[o + 2] >> 2) & 3, pad = (b[o + 2] >> 1) & 1;
  if (bi === 0 || bi === 15 || ri === 3) return null;
  const table = version === 1 ? BITRATES['1-' + layer] : BITRATES[layer === 1 ? '2-1' : '2-2'];
  const bitrate = table[bi] * 1000, rate = RATES[version][ri];
  const spf = layer === 1 ? 384 : layer === 2 ? 1152 : version === 1 ? 1152 : 576;
  const length = layer === 1 ? (Math.floor(12 * bitrate / rate) + pad) * 4 : Math.floor((spf / 8) * bitrate / rate) + pad;
  return { version, layer, bitrate, rate, spf, length, mono: (b[o + 3] >> 6) === 3 };
}
/** Duration of the MPEG audio from `start`: Xing/Info or VBRI frame count, else the bit rate of the first frame.
 *  The first frame nearly always follows the tag at once: 8 KB are read, 64 KB only when there is junk in front. */
async function mpegDuration(src, start, end) {
  const first = await mpegScan(await src.read(start, Math.min(8 * 1024, Math.max(0, end - start))), start, end);
  if (first.duration != null || end - start <= 8 * 1024) return first;
  return mpegScan(await src.read(start, Math.min(64 * 1024, Math.max(0, end - start))), start, end);
}
function mpegScan(buf, start, end) {
  for (let o = 0; o + 4 <= buf.length; o++) {
    if (buf[o] !== 0xff) continue;
    const h = mpegHeader(buf, o);
    if (!h || h.length < 21) continue;
    // a real frame is followed by another one (unless the file ends): no false sync in garbage before the audio
    const n = o + h.length;
    if (n + 4 <= buf.length && !mpegHeader(buf, n)) continue;
    const side = h.version === 1 ? (h.mono ? 17 : 32) : (h.mono ? 9 : 17);
    const x = o + 4 + side, tagName = buf.toString('latin1', x, x + 4);
    if ((tagName === 'Xing' || tagName === 'Info') && x + 12 <= buf.length) {
      const fl = buf.readUInt32BE(x + 4);
      if (fl & 1) { const frames = buf.readUInt32BE(x + 8); if (frames > 0) return { duration: frames * h.spf / h.rate, exact: true, header: h, audioStart: start + o }; }
    }
    const v = o + 36;
    if (buf.toString('latin1', v, v + 4) === 'VBRI' && v + 18 <= buf.length) {
      const frames = buf.readUInt32BE(v + 14);
      if (frames > 0) return { duration: frames * h.spf / h.rate, exact: true, header: h, audioStart: start + o };
    }
    const bytes = Math.max(0, end - (start + o));
    return { duration: h.bitrate ? bytes * 8 / h.bitrate : null, exact: false, header: h, audioStart: start + o };
  }
  return { duration: null, exact: false };
}

async function readMp3(src) {
  const meta = emptyMeta('mp3');
  let start = 0, tlen = null;
  // a tag, sometimes two in a row
  for (let k = 0; k < 2; k++) {
    const tag = await readId3v2(src, start);
    if (!tag) break;
    id3Meta(meta, tag);
    if (tag.tlen) tlen = tag.tlen;
    start = tag.end;
  }
  let end = src.size;
  const tail = await src.read(src.size - 128, 128);
  if (tail.length === 128 && tail.toString('latin1', 0, 3) === 'TAG') { id3v1(meta, tail); end -= 128; }
  const d = await mpegDuration(src, start, end);
  meta.duration = d.duration ?? tlen; meta.durationExact = !!d.exact;
  if (!d.exact && tlen && d.duration && Math.abs(tlen - d.duration) / tlen < 0.2) meta.duration = tlen;
  return meta;
}
function id3v1(meta, t) {
  const s = (a, b) => clean(t.toString('latin1', a, b).replace(/\0.*$/s, ''));
  meta.title ??= s(3, 33); meta.artist ??= s(33, 63); meta.album ??= s(63, 93); meta.year ??= yearOf(s(93, 97));
  if (t[125] === 0 && t[126] && meta.track == null) meta.track = t[126];
}

// ------------------------------------------------------------------------------------------------------- MP4 --
/** The child boxes between `start` and `end` (one small read per box header). */
async function childBoxes(src, start, end) {
  const out = [];
  let pos = start;
  for (let guard = 0; guard < 4096 && pos + 8 <= end; guard++) {
    const h = await src.read(pos, 16);
    if (h.length < 8) break;
    let size = h.readUInt32BE(0), hs = 8;
    const type = h.toString('latin1', 4, 8);
    if (size === 1) { if (h.length < 16) break; size = Number(h.readBigUInt64BE(8)); hs = 16; } else if (size === 0) size = end - pos;
    if (size < hs) break;
    out.push({ type, start: pos, data: pos + hs, end: Math.min(end, pos + size) });
    pos += size;
  }
  return out;
}
/** Child boxes of a box held in memory (offsets relative to the buffer). */
function memBoxes(buf, start = 0, end = buf.length) {
  const out = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos), hs = 8;
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (size === 1) { if (pos + 16 > end) break; size = Number(buf.readBigUInt64BE(pos + 8)); hs = 16; } else if (size === 0) size = end - pos;
    if (size < hs || pos + size > end) break;
    out.push({ type, start: pos, data: pos + hs, end: pos + size });
    pos += size;
  }
  return out;
}
const find = (list, type) => list.find((b) => b.type === type);

async function readMp4(src) {
  const meta = emptyMeta('mp4');
  const top = await childBoxes(src, 0, src.size);
  if (!top.length || !['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip'].includes(top[0].type)) throw new Error('not an MP4 file');
  const moov = find(top, 'moov');
  if (!moov) throw new Error('no moov box');
  const kids = await childBoxes(src, moov.data, moov.end);
  const mvhd = find(kids, 'mvhd');
  if (mvhd) {
    const b = await src.read(mvhd.data, 32);
    const v1 = b[0] === 1;
    const scale = b.readUInt32BE(v1 ? 20 : 12), dur = v1 ? Number(b.readBigUInt64BE(24)) : b.readUInt32BE(16);
    if (scale) { meta.duration = dur / scale; meta.durationExact = true; }
  }
  // tracks: the audio track's chapter reference (tref/chap), the text tracks with the chapter titles
  const tracks = [];
  for (const trak of kids.filter((b) => b.type === 'trak')) {
    const t = { id: null, chap: [], handler: null, scale: 0, duration: 0, stbl: null };
    const tk = await childBoxes(src, trak.data, trak.end);
    const tkhd = find(tk, 'tkhd');
    if (tkhd) { const b = await src.read(tkhd.data, 24); t.id = b[0] === 1 ? b.readUInt32BE(20) : b.readUInt32BE(12); }
    const tref = find(tk, 'tref');
    if (tref && tref.end - tref.data < 4096) {
      const b = await src.read(tref.data, tref.end - tref.data);
      for (const r of memBoxes(b)) if (r.type === 'chap') for (let i = r.data; i + 4 <= r.end; i += 4) t.chap.push(b.readUInt32BE(i));
    }
    const mdia = find(tk, 'mdia');
    if (mdia) {
      const md = await childBoxes(src, mdia.data, mdia.end);
      const mdhd = find(md, 'mdhd');
      if (mdhd) { const b = await src.read(mdhd.data, 32); const v1 = b[0] === 1; t.scale = b.readUInt32BE(v1 ? 20 : 12); t.duration = v1 ? Number(b.readBigUInt64BE(24)) : b.readUInt32BE(16); }
      const hdlr = find(md, 'hdlr');
      if (hdlr) t.handler = (await src.read(hdlr.data + 8, 4)).toString('latin1');
      const minf = find(md, 'minf');
      if (minf) { const mi = await childBoxes(src, minf.data, minf.end); t.stbl = find(mi, 'stbl') || null; }
    }
    tracks.push(t);
  }
  if (!meta.duration) { const a = tracks.find((t) => t.handler === 'soun' && t.scale); if (a) { meta.duration = a.duration / a.scale; meta.durationExact = true; } }
  // tags: moov/udta/meta/ilst (iTunes), also moov/meta
  const udta = find(kids, 'udta');
  const udtaKids = udta ? await childBoxes(src, udta.data, udta.end) : [];
  for (const m of [find(udtaKids, 'meta'), find(kids, 'meta')].filter(Boolean)) await mp4Meta(src, m, meta);
  // chapters: the QuickTime chapter track, else Nero's chpl
  const chapIds = new Set(tracks.flatMap((t) => t.chap));
  let chapTrack = tracks.find((t) => chapIds.has(t.id) && t.stbl);
  if (!chapTrack && tracks.filter((t) => t.handler === 'soun').length === 1) chapTrack = tracks.find((t) => t.handler === 'text' && t.stbl);
  if (chapTrack) { try { meta.chapters = await qtChapters(src, chapTrack); } catch { meta.chapters = []; } }
  const chpl = find(udtaKids, 'chpl');
  if (!meta.chapters.length && chpl && chpl.end - chpl.data < 1024 * 1024) meta.chapters = neroChapters(await src.read(chpl.data, chpl.end - chpl.data));
  if (meta.duration) for (const c of meta.chapters) if (c.end != null && c.end > meta.duration + 1) c.end = null;
  return meta;
}

/** iTunes metadata: the ilst items. A cover (covr) is only noted. */
async function mp4Meta(src, metaBox, meta) {
  // ISO 'meta' is a full box (4 bytes version/flags before its children), the QuickTime one is not
  const probe = await src.read(metaBox.data, 12);
  const start = probe.length >= 12 && /^(hdlr|ilst|keys|free)$/.test(probe.toString('latin1', 4, 8)) ? metaBox.data : metaBox.data + 4;
  const mk = await childBoxes(src, start, metaBox.end);
  const ilst = find(mk, 'ilst');
  if (!ilst) return;
  for (const item of await childBoxes(src, ilst.data, ilst.end)) {
    if (item.type === 'covr') {
      const h = await src.read(item.data, 16);
      if (h.length >= 16 && h.toString('latin1', 4, 8) === 'data') {
        const size = h.readUInt32BE(0), type = h.readUInt32BE(8) & 0xffffff;
        if (!meta.picture && size > 16) meta.picture = { offset: item.data + 16, length: size - 16, mime: type === 14 ? 'image/png' : type === 27 ? 'image/bmp' : 'image/jpeg', type: 3 };
      }
      continue;
    }
    if (item.end - item.start > SMALL) continue;
    const b = await src.read(item.start, item.end - item.start);
    let mean = '', name = '';
    for (const c of memBoxes(b, 8)) {
      if (c.type === 'mean') mean = b.toString('utf8', c.data + 4, c.end);
      else if (c.type === 'name') name = b.toString('utf8', c.data + 4, c.end);
      else if (c.type === 'data' && c.end - c.data >= 8) {
        const type = b.readUInt32BE(c.data) & 0xffffff, val = b.subarray(c.data + 8, c.end);
        ilstValue(meta, item.type, name, mean, type, val);
        break;
      }
    }
  }
}
function ilstValue(meta, key, name, mean, type, val) {
  const text = () => clean(type === 2 ? utf16(val, 'be') : val.toString('utf8'));
  const int = () => (val.length >= 4 ? val.readInt32BE(val.length - 4) : val.length === 2 ? val.readUInt16BE(0) : val.length === 1 ? val[0] : null);
  switch (key) {
    case '©nam': meta.title ??= text(); break;
    case '©alb': meta.album ??= text(); break;
    case '©ART': meta.artist ??= text(); break;
    case 'aART': meta.albumArtist ??= text(); break;
    case '©wrt': meta.composer ??= text(); break;
    case '©nrt': meta.narrator ??= text(); break;
    case '©day': meta.year ??= yearOf(text()); break;
    case '©gen': meta.genre ??= genreText(text()); break;
    case 'gnre': if (val.length >= 2 && !meta.genre) meta.genre = GENRES[val.readUInt16BE(0) - 1] || null; break;
    case '©cmt': meta.comment ??= text(); break;
    case 'desc': case 'ldes': if (!meta.comment || key === 'ldes') meta.comment = text() || meta.comment; break;
    case '©grp': meta.grouping ??= text(); break;
    case '©mvn': meta.series ??= text(); break;
    case '©mvi': if (meta.seriesPart == null) { const n = int(); if (n) meta.seriesPart = n; } break;
    case 'stik': meta.mediaKind = val.length ? val[val.length - 1] : null; break;
    case 'trkn': if (val.length >= 6) { meta.track ??= val.readUInt16BE(2) || null; meta.trackTotal ??= val.readUInt16BE(4) || null; } break;
    case 'disk': if (val.length >= 6) { meta.disc ??= val.readUInt16BE(2) || null; meta.discTotal ??= val.readUInt16BE(4) || null; } break;
    case '----': if (name) applyFree(meta, name, text()); break;
    default: break;
  }
  void mean;
}
/** The titles and start times of the chapter text track (one sample per chapter). */
async function qtChapters(src, t) {
  if (!t.scale || !t.stbl || t.stbl.end - t.stbl.data > 8 * 1024 * 1024) return [];
  const b = await src.read(t.stbl.data, t.stbl.end - t.stbl.data);
  const kids = memBoxes(b);
  const stts = find(kids, 'stts'), stsz = find(kids, 'stsz'), stsc = find(kids, 'stsc'), stco = find(kids, 'stco') || find(kids, 'co64');
  if (!stts || !stsz || !stco) return [];
  const durations = [];
  for (let i = 0, n = b.readUInt32BE(stts.data + 4), o = stts.data + 8; i < n && o + 8 <= stts.end; i++, o += 8) {
    const count = b.readUInt32BE(o), delta = b.readUInt32BE(o + 4);
    for (let k = 0; k < count && durations.length < 10000; k++) durations.push(delta);
  }
  const fixed = b.readUInt32BE(stsz.data + 4), count = Math.min(b.readUInt32BE(stsz.data + 8), 10000);
  const sizes = [];
  for (let i = 0; i < count; i++) sizes.push(fixed || b.readUInt32BE(stsz.data + 12 + i * 4));
  const offsets = [];
  const n64 = stco.type === 'co64';
  for (let i = 0, n = b.readUInt32BE(stco.data + 4); i < n; i++) offsets.push(n64 ? Number(b.readBigUInt64BE(stco.data + 8 + i * 8)) : b.readUInt32BE(stco.data + 8 + i * 4));
  // samples per chunk (stsc): [first chunk (1-based), samples per chunk]
  const runs = [];
  if (stsc) for (let i = 0, n = b.readUInt32BE(stsc.data + 4); i < n; i++) runs.push([b.readUInt32BE(stsc.data + 8 + i * 12), b.readUInt32BE(stsc.data + 12 + i * 12)]);
  if (!runs.length) runs.push([1, 1]);
  const sampleOffsets = [];
  for (let c = 0, s = 0; c < offsets.length && s < count; c++) {
    let per = 1;
    for (const [first, spc] of runs) if (c + 1 >= first) per = spc;
    let off = offsets[c];
    for (let k = 0; k < per && s < count; k++, s++) { sampleOffsets.push(off); off += sizes[s]; }
  }
  const out = [];
  let time = 0;
  for (let i = 0; i < sampleOffsets.length; i++) {
    const sz = Math.min(sizes[i], 1024);
    const raw = sz >= 2 ? await src.read(sampleOffsets[i], sz) : Buffer.alloc(0);
    let title = null;
    if (raw.length >= 2) {
      const len = Math.min(raw.readUInt16BE(0), raw.length - 2), tb = raw.subarray(2, 2 + len);
      title = clean(tb.length >= 2 && ((tb[0] === 0xfe && tb[1] === 0xff) || (tb[0] === 0xff && tb[1] === 0xfe)) ? utf16(tb, null) : tb.toString('utf8'));
    }
    const d = durations[i] ?? 0;
    out.push({ start: time / t.scale, end: (time + d) / t.scale, title });
    time += d;
  }
  return out;
}
/** Nero chapters (udta/chpl): start times in 100 ns, titles in UTF-8. */
function neroChapters(b) {
  if (b.length < 5) return [];
  const version = b[0];
  let o = 4 + (version ? 4 : 0);
  const n = b[o]; o += 1;
  const out = [];
  for (let i = 0; i < n && o + 9 <= b.length; i++) {
    const start = Number(b.readBigUInt64BE(o)) / 1e7, len = b[o + 8];
    const title = clean(b.toString('utf8', o + 9, Math.min(b.length, o + 9 + len)));
    out.push({ start, end: null, title });
    o += 9 + len;
  }
  out.sort((a, b2) => a.start - b2.start);
  for (let i = 0; i < out.length - 1; i++) out[i].end = out[i + 1].start;
  return out;
}

// ------------------------------------------------------------------------------------------------------ FLAC --
async function readFlac(src) {
  const meta = emptyMeta('flac');
  let pos = 0;
  const tag = await readId3v2(src, 0);
  if (tag) { id3Meta(meta, tag); pos = tag.end; }
  if ((await src.read(pos, 4)).toString('latin1') !== 'fLaC') throw new Error('not a FLAC file');
  pos += 4;
  for (let guard = 0; guard < 512 && pos + 4 <= src.size; guard++) {
    const h = await src.read(pos, 4);
    const last = !!(h[0] & 0x80), type = h[0] & 0x7f, len = h.readUIntBE(1, 3);
    const data = pos + 4;
    if (type === 0) {
      const b = await src.read(data, 34);
      if (b.length >= 18) {
        const rate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
        const total = (b[13] & 0x0f) * 2 ** 32 + b.readUInt32BE(14);
        if (rate && total) { meta.duration = total / rate; meta.durationExact = true; }
      }
    } else if (type === 4 && len <= 4 * 1024 * 1024) {
      vorbisComments(meta, await src.read(data, len), 0);
    } else if (type === 6 && !meta.picture) {
      const b = await src.read(data, Math.min(len, 4096));
      const p = flacPicture(b, 0, false);
      if (p) meta.picture = { offset: data + p.dataOffset, length: p.length, mime: p.mime, type: p.type };
    }
    pos = data + len;
    if (last) break;
  }
  return meta;
}
/** A FLAC picture block: { type, mime, dataOffset, length, data? }. */
function flacPicture(b, o, withData) {
  if (o + 8 > b.length) return null;
  const type = b.readUInt32BE(o); let i = o + 4;
  const ml = b.readUInt32BE(i); i += 4;
  const mime = b.toString('latin1', i, i + ml).toLowerCase() || 'image/jpeg'; i += ml;
  if (i + 4 > b.length) return null;
  const dl = b.readUInt32BE(i); i += 4 + dl + 16;
  if (i + 4 > b.length) return null;
  const length = b.readUInt32BE(i); i += 4;
  return { type, mime, dataOffset: i - o, length, data: withData ? b.subarray(i, i + length) : null };
}
/** Vorbis comments (FLAC, Ogg): little-endian lengths, KEY=value. CHAPTERxxx / CHAPTERxxxNAME are chapters. */
function vorbisComments(meta, b, o) {
  if (o + 4 > b.length) return;
  const vl = b.readUInt32LE(o); o += 4 + vl;
  if (o + 4 > b.length) return;
  const n = b.readUInt32LE(o); o += 4;
  const chapters = new Map();
  for (let i = 0; i < n && o + 4 <= b.length; i++) {
    const len = b.readUInt32LE(o); o += 4;
    if (o + len > b.length) break;
    const eq = b.indexOf(0x3d, o);
    if (eq > o && eq < o + len) {
      const key = b.toString('utf8', o, eq).toUpperCase();
      if (key === 'METADATA_BLOCK_PICTURE' || key === 'COVERART') { if (!meta.picture) meta.picture = { offset: null, reparse: 'ogg', type: 3 }; }
      else vorbisValue(meta, key, b.toString('utf8', eq + 1, o + len), chapters);
    }
    o += len;
  }
  if (chapters.size && !meta.chapters.length) {
    meta.chapters = [...chapters.values()].filter((c) => c.start != null).sort((a, c) => a.start - c.start).map((c) => ({ start: c.start, end: null, title: clean(c.title) }));
    for (let i = 0; i < meta.chapters.length - 1; i++) meta.chapters[i].end = meta.chapters[i + 1].start;
  }
}
function vorbisValue(meta, key, value, chapters) {
  const ch = /^CHAPTER(\d{1,4})(NAME)?$/.exec(key);
  if (ch) { const c = chapters.get(ch[1]) || { start: null, title: null }; if (ch[2]) c.title = value; else c.start = timeOf(value); chapters.set(ch[1], c); return; }
  const v = clean(value); if (!v) return;
  switch (key) {
    case 'TITLE': meta.title ??= v; break;
    case 'ALBUM': meta.album ??= v; break;
    case 'ARTIST': meta.artist ??= v; break;
    case 'ALBUMARTIST': case 'ALBUM ARTIST': case 'ALBUM_ARTIST': meta.albumArtist ??= v; break;
    case 'COMPOSER': meta.composer ??= v; break;
    case 'DATE': case 'YEAR': meta.year ??= yearOf(v); break;
    case 'GENRE': meta.genre ??= genreText(v); break;
    case 'TRACKNUMBER': { const [a, b] = numPair(v); meta.track ??= a; meta.trackTotal ??= b; break; }
    case 'TRACKTOTAL': case 'TOTALTRACKS': meta.trackTotal ??= numPair(v)[0]; break;
    case 'DISCNUMBER': { const [a, b] = numPair(v); meta.disc ??= a; meta.discTotal ??= b; break; }
    case 'DISCTOTAL': case 'TOTALDISCS': meta.discTotal ??= numPair(v)[0]; break;
    default: applyFree(meta, key, v);
  }
}

// ------------------------------------------------------------------------------------------------------- Ogg --
/** The first packets of an Ogg stream (up to `maxPackets`), each cut at `cap` bytes: the pages of a packet beyond
 *  the cap (a big picture in the comments) are skipped without reading them. */
async function oggPackets(src, maxPackets, cap = 16 * 1024 * 1024) {
  const packets = []; let cur = [], curLen = 0, pos = 0;
  for (let guard = 0; guard < 65536 && packets.length < maxPackets && pos + 27 <= src.size; guard++) {
    const h = await src.read(pos, 27 + 255);
    if (h.length < 27 || h.toString('latin1', 0, 4) !== 'OggS') break;
    const nseg = h[26], lace = h.subarray(27, 27 + nseg);
    const total = lace.reduce((a, x) => a + x, 0);
    const body = curLen < cap ? await src.read(pos + 27 + nseg, total) : null;
    let o = 0;
    for (const l of lace) {
      if (body && curLen < cap) { cur.push(body.subarray(o, o + l)); curLen += l; }
      o += l;
      if (l < 255) { packets.push(Buffer.concat(cur)); cur = []; curLen = 0; if (packets.length >= maxPackets) break; }
    }
    pos += 27 + nseg + total;
  }
  return packets;
}
async function readOgg(src) {
  const [id, comment] = await oggPackets(src, 2, 1024 * 1024);
  if (!id) throw new Error('not an Ogg file');
  let meta, rate = 0, preskip = 0;
  if (id.toString('latin1', 0, 8) === 'OpusHead') { meta = emptyMeta('opus'); preskip = id.readUInt16LE(10); rate = 48000; }
  else if (id[0] === 1 && id.toString('latin1', 1, 7) === 'vorbis') { meta = emptyMeta('ogg'); rate = id.readUInt32LE(12); }
  else if (id.toString('latin1', 1, 5) === 'FLAC') { meta = emptyMeta('ogg'); rate = id.length >= 31 ? ((id[27] << 12) | (id[28] << 4) | (id[29] >> 4)) : 0; }
  else throw new Error('unknown Ogg stream');
  if (comment) {
    if (comment.toString('latin1', 0, 8) === 'OpusTags') vorbisComments(meta, comment, 8);
    else if (comment[0] === 3 && comment.toString('latin1', 1, 7) === 'vorbis') vorbisComments(meta, comment, 7);
    else if ((comment[0] & 0x7f) === 4) vorbisComments(meta, comment, 4);
  }
  // the duration: granule position of the last page
  const tail = await src.read(Math.max(0, src.size - 65536), 65536);
  for (let i = tail.length - 27; i >= 0; i--) {
    if (tail[i] !== 0x4f || tail.toString('latin1', i, i + 4) !== 'OggS') continue;
    const g = Number(tail.readBigUInt64LE(i + 6));
    if (g > 0 && g < 2 ** 52 && rate) { meta.duration = Math.max(0, g - preskip) / rate; meta.durationExact = true; break; }
  }
  return meta;
}

// ------------------------------------------------------------------------------------------------------- WAV --
async function readWav(src) {
  const meta = emptyMeta('wav');
  const h = await src.read(0, 12);
  if (h.toString('latin1', 0, 4) !== 'RIFF' || h.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let pos = 12, byteRate = 0, dataSize = 0;
  for (let guard = 0; guard < 256 && pos + 8 <= src.size; guard++) {
    const c = await src.read(pos, 8);
    const id = c.toString('latin1', 0, 4), size = c.readUInt32LE(4), data = pos + 8;
    if (id === 'fmt ') { const f = await src.read(data, 16); byteRate = f.readUInt32LE(8); }
    else if (id === 'data') dataSize = Math.min(size, src.size - data);
    else if (id === 'LIST' && size <= SMALL) {
      const b = await src.read(data, size);
      if (b.toString('latin1', 0, 4) === 'INFO') {
        for (let o = 4; o + 8 <= b.length;) {
          const k = b.toString('latin1', o, o + 4), l = b.readUInt32LE(o + 4);
          const v = clean(b.toString('utf8', o + 8, Math.min(b.length, o + 8 + l)).replace(/\0+$/, ''));
          if (v) ({ INAM: () => { meta.title ??= v; }, IART: () => { meta.artist ??= v; }, IPRD: () => { meta.album ??= v; }, ICMT: () => { meta.comment ??= v; }, ICRD: () => { meta.year ??= yearOf(v); }, IGNR: () => { meta.genre ??= v; }, ITRK: () => { meta.track ??= numPair(v)[0]; }, IPRT: () => { meta.track ??= numPair(v)[0]; } })[k]?.();
          o += 8 + l + (l & 1);
        }
      }
    } else if (id === 'id3 ' || id === 'ID3 ') {
      const tag = await readId3v2(src, data, { maxSize: size });
      if (tag) id3Meta(meta, tag);
    }
    pos = data + size + (size & 1);
  }
  if (byteRate && dataSize) { meta.duration = dataSize / byteRate; meta.durationExact = true; }
  return meta;
}

// ------------------------------------------------------------------------------------------------------- AAC --
const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
async function readAac(src) {
  const meta = emptyMeta('aac');
  let start = 0;
  const tag = await readId3v2(src, 0);
  if (tag) { id3Meta(meta, tag); start = tag.end; }
  const b = await src.read(start, 256 * 1024);
  let o = b.findIndex((x, i) => x === 0xff && (b[i + 1] & 0xf6) === 0xf0);
  if (o < 0) return meta;
  let frames = 0, bytes = 0, rate = 0;
  while (o + 7 <= b.length && frames < 2000) {
    if (b[o] !== 0xff || (b[o + 1] & 0xf6) !== 0xf0) break;
    rate = AAC_RATES[(b[o + 2] >> 2) & 0x0f] || rate;
    const len = ((b[o + 3] & 3) << 11) | (b[o + 4] << 3) | (b[o + 5] >> 5);
    if (len < 7) break;
    frames++; bytes += len; o += len;
  }
  if (frames && rate) {
    const total = src.size - start;
    meta.duration = (total / (bytes / frames)) * 1024 / rate;
    meta.durationExact = bytes >= total - 8;
  }
  return meta;
}

// ---------------------------------------------------------------------------------------------------- public --
const READERS = { '.mp3': readMp3, '.m4a': readMp4, '.m4b': readMp4, '.mp4': readMp4, '.aac': readAac, '.ogg': readOgg, '.oga': readOgg, '.opus': readOgg, '.flac': readFlac, '.wav': readWav };
/** What the first bytes say a file is (a file named .mp3 that is really an MP4, and the like). */
function sniff(b) {
  if (b.length < 12) return null;
  if (b.toString('latin1', 4, 8) === 'ftyp') return readMp4;
  if (b.toString('latin1', 0, 4) === 'fLaC') return readFlac;
  if (b.toString('latin1', 0, 4) === 'OggS') return readOgg;
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE') return readWav;
  return null;
}

/**
 * Tags, duration and chapters of an audio file (see emptyMeta). Never throws: a broken file gives
 * { …emptyMeta, error } so the scanner can still list it by its name.
 * @param opts.size  the file size when known (saves a stat)
 */
async function readTags(file, { size } = {}) {
  const ext = path.extname(file).toLowerCase();
  let fh = null;
  try {
    fh = await fsp.open(file, 'r');
    if (size == null) size = (await fh.stat()).size;
    const src = new Source(fh, size);
    const head = await src.prime();
    const reader = sniff(head) || READERS[ext] || readMp3;
    const meta = await reader(src);
    meta.reads = src.reads; meta.bytes = src.bytes;
    if (meta.duration != null && !(meta.duration >= 0 && isFinite(meta.duration))) meta.duration = null;
    return meta;
  } catch (e) {
    return { ...emptyMeta(ext.slice(1)), error: String(e?.message || e) };
  } finally { try { await fh?.close(); } catch {} }
}

/**
 * The bytes of the embedded picture noted in `meta.picture` (or found again: an unsynchronised ID3 tag, a picture in
 * Ogg comments): { data: Buffer, mime } or null.
 */
async function readPicture(file, picture, { maxBytes = 24 * 1024 * 1024 } = {}) {
  if (!picture) return null;
  let fh = null;
  try {
    fh = await fsp.open(file, 'r');
    const size = (await fh.stat()).size;
    const src = new Source(fh, size);
    if (picture.offset != null && picture.length > 0 && picture.length <= maxBytes) {
      return { data: await src.read(picture.offset, picture.length), mime: picture.mime || 'image/jpeg' };
    }
    if (picture.reparse === 'id3') {
      const pos = picture.at ?? 0;
      const head = await src.read(pos, 10);
      if (head.toString('latin1', 0, 3) !== 'ID3') return null;
      const major = head[3], flags = head[5], tsize = syncsafe(head, 6);
      let body = await src.read(pos + 10, Math.min(tsize, maxBytes * 2));
      if (major < 4 && flags & 0x80) body = deUnsync(body);
      for (let o = 0; o + 10 <= body.length;) {
        if (body[o] === 0) break;
        const h = frameHeader(body, o, major, () => null, o, body.length);
        if (!h) break;
        if (h.id === 'APIC') {
          const d = frameData(body.subarray(o + h.hsz, o + h.hsz + h.size), h);
          const p = d && apicInfo(d, major);
          if (p) return { data: d.subarray(p.dataOffset), mime: p.mime };
        }
        o += h.hsz + h.size;
      }
      return null;
    }
    if (picture.reparse === 'ogg') {
      const [, comment] = await oggPackets(src, 2, maxBytes * 2);
      if (!comment) return null;
      let o = comment.toString('latin1', 0, 8) === 'OpusTags' ? 8 : 7;
      const vl = comment.readUInt32LE(o); o += 4 + vl;
      const n = comment.readUInt32LE(o); o += 4;
      for (let i = 0; i < n && o + 4 <= comment.length; i++) {
        const len = comment.readUInt32LE(o); o += 4;
        const s = comment.toString('utf8', o, o + Math.min(len, 64));
        if (/^METADATA_BLOCK_PICTURE=/i.test(s)) {
          const raw = Buffer.from(comment.toString('latin1', o + 23, o + len), 'base64');
          const p = flacPicture(raw, 0, true);
          if (p?.data?.length) return { data: Buffer.from(p.data), mime: p.mime };
        } else if (/^COVERART=/i.test(s)) {
          return { data: Buffer.from(comment.toString('latin1', o + 9, o + len), 'base64'), mime: 'image/jpeg' };
        }
        o += len;
      }
    }
    return null;
  } catch { return null; } finally { try { await fh?.close(); } catch {} }
}

module.exports = { readTags, readPicture, AUDIO_EXT, clean, timeOf, numPair, _test: { mpegHeader, neroChapters, deUnsync, syncsafe, decodeText } };
