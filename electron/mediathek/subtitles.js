// Subtitles of the broadcasters → WebVTT for the <track> element of the one video player.
// ARD, ZDF, KiKA, SRF and ORF deliver TTML / EBU-TT-D (XML); some sources already use WebVTT or SRT.
// Speaker colours (yellow, cyan, magenta …) survive as WebVTT class spans (<c.yellow>), the panel styles
// them with ::cue(.yellow). Pure functions, no Electron.
'use strict';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEntities = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : all; }
  return ENTITIES[e.toLowerCase()] ?? all;
});
const escapeVtt = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Attributes of a tag, namespace prefixes dropped: tts:color → color, xml:id → id. */
function attrs(s) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s || ''))) out[m[1].replace(/^[\w-]+:/, '')] = decodeEntities(m[3] ?? m[4] ?? '');
  return out;
}
const local = (name) => name.replace(/^[\w-]+:/, '').toLowerCase();

const NAMED = { yellow: 'yellow', cyan: 'cyan', aqua: 'cyan', magenta: 'magenta', fuchsia: 'magenta', lime: 'green', green: 'green', red: 'red', blue: 'blue' };
/** TTML colour → WebVTT class name (white and unknown colours → null, i.e. the default colour). */
function colorClass(c) {
  if (!c) return null;
  const v = String(c).trim().toLowerCase();
  if (NAMED[v]) return NAMED[v];
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v) || /^#([0-9a-f]{3})$/.exec(v);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((x) => x + x).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const hi = (x) => x >= 0xc0, lo = (x) => x <= 0x60;
  if (hi(r) && hi(g) && lo(b)) return 'yellow';
  if (lo(r) && hi(g) && hi(b)) return 'cyan';
  if (hi(r) && lo(g) && hi(b)) return 'magenta';
  if (lo(r) && hi(g) && lo(b)) return 'green';
  if (hi(r) && lo(g) && lo(b)) return 'red';
  if (lo(r) && lo(g) && hi(b)) return 'blue';
  return null;
}

/**
 * TTML time expression → seconds. Clock times "00:01:02.500", "00:01:02:12" (frames) and offsets
 * "12.5s", "1500ms", "2m", "1h", "25f", "900t" (ticks).
 */
function parseTime(s, { frameRate = 25, tickRate = 1 } = {}) {
  if (s == null) return null;
  const v = String(s).trim();
  let m = /^(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/.exec(v);
  if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + (m[4] ? parseFloat('0.' + m[4]) : 0);
  m = /^(\d+):(\d{1,2}):(\d{1,2}):(\d+)(?:\.\d+)?$/.exec(v);
  if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + (+m[4] / (frameRate || 25));
  m = /^([\d.]+)(h|ms|m|s|f|t)$/.exec(v);
  if (m) {
    const n = parseFloat(m[1]);
    return { h: n * 3600, m: n * 60, s: n, ms: n / 1000, f: n / (frameRate || 25), t: n / (tickRate || 1) }[m[2]];
  }
  return null;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
function formatTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

/** TTML / EBU-TT-D → cues [{ start, end, runs: [{ text, cls }] }] */
function parseTtml(xml) {
  const src = String(xml);
  const root = /<(?:[\w-]+:)?tt\b([^>]*)>/i.exec(src);
  const rootAttrs = attrs(root ? root[1] : '');
  const frameRate = (parseFloat(rootAttrs.frameRate) || 25) * (rootAttrs.frameRateMultiplier ? (() => { const [a, b] = rootAttrs.frameRateMultiplier.split(/\s+/).map(Number); return a && b ? a / b : 1; })() : 1);
  const tickRate = parseFloat(rootAttrs.tickRate) || (rootAttrs.frameRate ? frameRate : 1);
  const tm = { frameRate, tickRate };

  // styles: id → colour (a style may reference other styles)
  const styles = {};
  for (const m of src.matchAll(/<(?:[\w-]+:)?style\b([^>]*?)\/?>/gi)) {
    const a = attrs(m[1]);
    if (a.id) styles[a.id] = { color: a.color || null, ref: a.style || null };
  }
  const styleColor = (ids, depth = 0) => {
    if (!ids || depth > 4) return null;
    let color = null;
    for (const id of String(ids).split(/\s+/)) {
      const s = styles[id];
      if (!s) continue;
      if (s.color) color = s.color;
      else if (s.ref) color = styleColor(s.ref, depth + 1) || color;
    }
    return color;
  };
  const colorOf = (a) => a.color || styleColor(a.style);

  const bodyStart = src.search(/<(?:[\w-]+:)?body\b/i);
  const body = bodyStart >= 0 ? src.slice(bodyStart) : src;
  const cues = [];
  const stack = [];          // colours of open spans
  let cue = null, pColor = null;
  const re = /<(\/?)([\w:.-]+)([^>]*?)(\/?)>|<!--[\s\S]*?-->|([^<]+)/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[5] != null) {
      if (!cue) continue;
      let t = m[5];
      if (!t.trim() && /\n/.test(t)) continue;          // indentation between tags
      t = decodeEntities(t).replace(/[\t\r\n ]+/g, ' ');
      const cls = colorClass(stack.length ? stack[stack.length - 1] : pColor);
      cue.runs.push({ text: t, cls });
      continue;
    }
    if (!m[2]) continue;
    const name = local(m[2]), closing = m[1] === '/', selfClosing = m[4] === '/';
    if (name === 'p') {
      if (closing) { if (cue) cues.push(cue); cue = null; stack.length = 0; continue; }
      const a = attrs(m[3]);
      const start = parseTime(a.begin, tm);
      let end = parseTime(a.end, tm);
      if (end == null && a.dur != null && start != null) end = start + parseTime(a.dur, tm);
      pColor = colorOf(a);
      cue = start != null && end != null && end > start ? { start, end, runs: [] } : null;
      if (selfClosing) { cue = null; }
      continue;
    }
    if (!cue) continue;
    if (name === 'br') { cue.runs.push({ text: '\n', cls: null }); continue; }
    if (name === 'span') {
      if (closing) { stack.pop(); continue; }
      if (selfClosing) continue;
      const a = attrs(m[3]);
      stack.push(colorOf(a) || (stack.length ? stack[stack.length - 1] : pColor));
    }
  }

  // ARD used to deliver subtitles on a 10:00:00 timecode base – shift them back to zero
  if (cues.length && cues.every((c) => c.start >= 36000)) for (const c of cues) { c.start -= 36000; c.end -= 36000; }
  return cues;
}

/** Runs → WebVTT cue payload: colour spans merged, lines trimmed, no empty lines (they would end the cue). */
function payloadOf(runs) {
  const lines = [[]];
  for (const r of runs) {
    if (r.text === '\n') { lines.push([]); continue; }
    const line = lines[lines.length - 1];
    const last = line[line.length - 1];
    if (last && last.cls === r.cls) last.text += r.text; else line.push({ ...r });
  }
  return lines.map((line) => {
    if (line.length) { line[0].text = line[0].text.replace(/^\s+/, ''); line[line.length - 1].text = line[line.length - 1].text.replace(/\s+$/, ''); }
    return line.filter((r) => r.text).map((r) => (r.cls ? `<c.${r.cls}>${escapeVtt(r.text)}</c>` : escapeVtt(r.text))).join('');
  }).filter((l) => l.trim()).join('\n');
}

function cuesToVtt(cues) {
  const out = ['WEBVTT', ''];
  let n = 0;
  for (const c of cues) {
    const text = payloadOf(c.runs);
    if (!text) continue;
    out.push(String(++n), `${formatTime(c.start)} --> ${formatTime(c.end)}`, text, '');
  }
  return out.join('\n');
}

function srtToVtt(srt) {
  const body = String(srt).replace(/\r\n?/g, '\n').replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2');
  return 'WEBVTT\n\n' + body.trim() + '\n';
}

/** Anything the broadcasters deliver → WebVTT text (throws when it is no subtitle format at all). */
function toVtt(input) {
  const text = String(input || '').replace(/^\s+/, '');
  if (/^WEBVTT/.test(text)) return text.replace(/\r\n?/g, '\n');
  if (/^\d+\s*\n\s*\d\d:\d\d:\d\d[,.]\d{3}\s*-->/.test(text.replace(/\r\n?/g, '\n'))) return srtToVtt(text);
  if (/<(?:[\w-]+:)?tt\b/i.test(text)) return cuesToVtt(parseTtml(text));
  throw new Error('Unbekanntes Untertitelformat');
}

module.exports = { toVtt, parseTtml, parseTime, formatTime, colorClass, cuesToVtt, decodeEntities };
