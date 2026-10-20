// Minimal EPUB 3 builder (dependency-free zip writer with deflate via zlib) used to turn wiki pages,
// Gutenberg-DE works and arbitrary web texts into books for the shelf.
'use strict';
const zlib = require('zlib');
const C = require('../feeds/common');

// --- zip ---------------------------------------------------------------------------------------------
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function dosTime(d = new Date()) { return { time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff, date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff }; }

/** entries: [{ name, data: Buffer|string, store?: boolean }] → zip Buffer. */
function zip(entries) {
  const parts = [], central = [];
  let offset = 0;
  const { time, date } = dosTime();
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const method = e.store ? 0 : 8;
    const comp = method ? zlib.deflateRawSync(data, { level: 6 }) : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, comp);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12); cd.writeUInt16LE(date, 14); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32); cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + comp.length;
  }
  const cdStart = offset;
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(cdStart, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

// --- xhtml -------------------------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** HTML fragment → well-formed XHTML (serialized through the DOM). */
function toXhtml(html) {
  const doc = C.parseHtml(`<div>${html || ''}</div>`);
  const wrap = doc.body.firstElementChild;
  // things that are not allowed / useful inside an EPUB document
  for (const el of wrap.querySelectorAll('script, style, iframe, object, embed, form, input, button, video, audio, source, noscript, template')) el.remove();
  for (const el of wrap.querySelectorAll('*')) {
    for (const a of [...el.attributes]) if (/^on|^xmlns|[^\w:.-]/.test(a.name) || a.name === 'loading') el.removeAttribute(a.name);
    if (el.tagName === 'A' && !el.getAttribute('href')) { /* wiki links without href → keep as span-like anchor */ }
  }
  const w = C.getWindow();
  let out = new w.XMLSerializer().serializeToString(wrap);
  // XMLSerializer emits the XHTML namespace on the wrapper; keep the inner markup only
  out = out.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '');
  return out;
}

const CSS = `body { font-family: serif; line-height: 1.5; margin: 1em; } h1, h2, h3 { font-family: sans-serif; line-height: 1.2; page-break-after: avoid; }
img { max-width: 100%; height: auto; } .cat-chapter + .cat-chapter { page-break-before: always; } .cat-source { font-size: .8em; color: #666; margin-top: 3em; border-top: 1px solid #ccc; padding-top: .6em; }
table { border-collapse: collapse; } td, th { padding: .15em .4em; vertical-align: top; } blockquote { margin: 1em 2em; } .poem, .verse { white-space: pre-wrap; }`;

/**
 * Build an EPUB. chapters: [{ title, html }]. Returns a Buffer.
 * cover: optional { data: Buffer, mime: 'image/jpeg'|'image/png' }.
 * resources: optional [{ name: 'img/a.jpg', data: Buffer, mime }]: files the chapters reference (images).
 * forceChapterTitles: a single chapter still gets its own heading and TOC entry (a Sammelband with one article).
 */
function buildEpub({ title, author, language, identifier, source, sourceUrl, description, chapters, cover, resources, forceChapterTitles }) {
  title = C.collapseWs(title) || 'Ohne Titel';
  author = C.collapseWs(author || '');
  language = (language || 'de').slice(0, 5);
  const uid = identifier || 'urn:uuid:' + require('crypto').randomUUID();
  const chs = (chapters && chapters.length ? chapters : [{ title, html: '<p></p>' }]).map((c, i) => ({ id: `ch${String(i + 1).padStart(3, '0')}`, title: C.collapseWs(c.title) || `${i + 1}`, html: c.html || '' }));
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const entries = [{ name: 'mimetype', data: 'application/epub+zip', store: true }];
  entries.push({ name: 'META-INF/container.xml', data: `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` });
  entries.push({ name: 'OEBPS/style.css', data: CSS });
  const coverExt = cover ? (cover.mime === 'image/png' ? 'png' : 'jpg') : null;
  if (cover) entries.push({ name: `OEBPS/cover.${coverExt}`, data: cover.data, store: true });
  const items = [], spine = [];
  (resources || []).forEach((r, i) => {
    const name = safeResourceName(r && r.name);
    if (!name || !r.data) return;
    entries.push({ name: `OEBPS/${name}`, data: r.data, store: /^image\/(jpeg|png|gif|webp)$/.test(r.mime || '') });
    items.push(`<item id="res${i + 1}" href="${esc(name)}" media-type="${esc(r.mime || 'application/octet-stream')}"/>`);
  });
  if (cover) {
    entries.push({ name: 'OEBPS/cover.xhtml', data: xhtmlDoc('Cover', language, `<div style="text-align:center"><img src="cover.${coverExt}" alt="${esc(title)}"/></div>`) });
    items.push(`<item id="cover-image" href="cover.${coverExt}" media-type="${cover.mime}" properties="cover-image"/>`, `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push('<itemref idref="cover" linear="no"/>');
  }
  const single = chs.length === 1 && !forceChapterTitles;
  const navItems = [];
  chs.forEach((c, i) => {
    const heading = single ? '' : `<h2 class="cat-chapter-title">${esc(c.title)}</h2>\n`;
    const foot = i === chs.length - 1 && (source || sourceUrl) ? `<p class="cat-source">${esc(source || '')}${sourceUrl ? `, <a href="${esc(sourceUrl)}">${esc(sourceUrl)}</a>` : ''}</p>` : '';
    const body = `<section class="cat-chapter" epub:type="chapter">${i === 0 ? `<h1>${esc(title)}</h1>${author ? `<p class="cat-author"><em>${esc(author)}</em></p>` : ''}` : ''}${heading}${toXhtml(c.html)}${foot}</section>`;
    entries.push({ name: `OEBPS/${c.id}.xhtml`, data: xhtmlDoc(c.title, language, body) });
    items.push(`<item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${c.id}"/>`);
    navItems.push(`<li><a href="${c.id}.xhtml">${esc(single ? title : c.title)}</a></li>`);
  });
  entries.push({ name: 'OEBPS/nav.xhtml', data: xhtmlDoc('Inhalt', language, `<nav epub:type="toc" id="toc"><h1>${esc(language.startsWith('de') ? 'Inhalt' : 'Contents')}</h1><ol>${navItems.join('')}</ol></nav>`) });
  items.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', '<item id="css" href="style.css" media-type="text/css"/>');
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${esc(language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${esc(uid)}</dc:identifier>
    <dc:title>${esc(title)}</dc:title>
    ${author ? `<dc:creator id="creator">${esc(author)}</dc:creator>` : ''}
    <dc:language>${esc(language)}</dc:language>
    ${source ? `<dc:publisher>${esc(source)}</dc:publisher>` : ''}
    ${sourceUrl ? `<dc:source>${esc(sourceUrl)}</dc:source>` : ''}
    ${description ? `<dc:description>${esc(C.collapseWs(description).slice(0, 2000))}</dc:description>` : ''}
    <meta property="dcterms:modified">${now}</meta>
    ${cover ? '<meta name="cover" content="cover-image"/>' : ''}
  </metadata>
  <manifest>${items.join('')}</manifest>
  <spine>${spine.join('')}</spine>
</package>`;
  entries.push({ name: 'OEBPS/content.opf', data: opf });
  return zip(entries);
}

function xhtmlDoc(title, lang, body, css = 'style.css') {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}" lang="${esc(lang)}"><head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="${esc(css)}"/></head><body>${body}</body></html>`;
}

/** Resource names inside the book: relative, no "..", only plain characters. */
function safeResourceName(name) {
  const n = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!n || n.includes('..') || !/^[\w./-]+$/.test(n)) return null;
  return n;
}

// --- reading and extending existing EPUBs ("Sammelband") ------------------------------------------------------
/** zip Buffer → [{ name, data }] (stored and deflated entries; sizes come from the central directory). */
function unzip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('Keine ZIP-Datei');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Keine ZIP-Datei (Verzeichnis fehlt)');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Beschädigtes ZIP-Verzeichnis');
    const method = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28), xlen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nlen).toString('utf8');
    off += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('Beschädigter ZIP-Eintrag: ' + name);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error('Nicht unterstützte ZIP-Kompression (' + method + ')');
    out.push({ name, data });
  }
  return out;
}

const attrOf = (tag, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag); return m ? (m[2] ?? m[3]) : null; };
const unesc = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
/** Relative href from the directory of the zip file `from` to the zip file `to`. */
function relHref(from, to) {
  const a = dirOf(from).split('/').filter(Boolean), b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}
/** An href relative to the zip file `base`, resolved into a zip path. */
function resolveHref(base, href) {
  let h = String(href || '').split('#')[0];
  try { h = decodeURIComponent(h); } catch { /* keep as is */ }
  const out = [];
  for (const p of (dirOf(base) + h).split('/')) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
  return out.join('/');
}

function opfOf(files) {
  const container = files.find((f) => f.name === 'META-INF/container.xml');
  if (!container) throw new Error('Kein EPUB (container.xml fehlt)');
  const m = /<rootfile\b[^>]*>/i.exec(container.data.toString('utf8'));
  const opfName = m && attrOf(m[0], 'full-path');
  const opf = opfName && files.find((f) => f.name === opfName);
  if (!opf) throw new Error('Kein EPUB (Paketdatei fehlt)');
  return { opfName, opf };
}

/** Title, language and number of documents in the reading order of an EPUB. */
function readEpubSummary(buf) {
  const files = unzip(buf);
  const { opf } = opfOf(files);
  const text = opf.data.toString('utf8');
  const title = unesc((/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(text) || [])[1] || '').replace(/\s+/g, ' ').trim();
  const language = unesc((/<dc:language[^>]*>([\s\S]*?)<\/dc:language>/i.exec(text) || [])[1] || '').trim();
  const spine = (/<spine\b[\s\S]*?<\/spine>/i.exec(text) || [''])[0];
  const chapters = (spine.match(/<itemref\b[^>]*>/gi) || []).filter((t) => !/linear\s*=\s*["']no["']/i.test(t)).length;
  return { title, language, chapters };
}

/**
 * Appends chapters to an existing EPUB (version 2 or 3) and returns the new file as a Buffer.
 * chapters: [{ title, html }]; resources: [{ name, data, mime }] that the chapters reference.
 * The package document gets manifest and spine entries; the EPUB 3 navigation document and the EPUB 2 NCX
 * (whichever exist) get one entry per chapter. All other files of the book stay as they are.
 */
function appendChapters(buf, chapters, { resources = [], language } = {}) {
  const files = unzip(buf);
  const { opfName, opf } = opfOf(files);
  const opfDir = dirOf(opfName);
  let text = opf.data.toString('utf8');
  if (!/<\/manifest>/i.test(text) || !/<\/spine>/i.test(text)) throw new Error('Unvollständige Paketdatei');
  const lang = (language || ((/<dc:language[^>]*>([^<]+)</i.exec(text) || [])[1] || 'de')).trim().slice(0, 5);
  const ids = new Set([...text.matchAll(/\bid\s*=\s*"([^"]+)"/gi)].map((m) => m[1]));
  const names = new Set(files.map((f) => f.name));
  const itemTags = text.match(/<item\b[^>]*>/gi) || [];
  const navItem = itemTags.find((t) => /(^|\s)nav(\s|$)/.test(attrOf(t, 'properties') || ''));
  const ncxItem = itemTags.find((t) => /application\/x-dtbncx\+xml/i.test(attrOf(t, 'media-type') || ''));
  const uniqueId = (base) => { let id = base, i = 1; while (ids.has(id)) id = `${base}-${++i}`; ids.add(id); return id; };
  const uniqueName = (base, ext) => { let n = `${base}.${ext}`, i = 1; while (names.has(opfDir + n)) n = `${base}-${++i}.${ext}`; names.add(opfDir + n); return n; };

  const manifest = [], spine = [], added = [];
  // one small stylesheet of our own, shared by every appended chapter
  const cssName = 'lesesaal-sammelband.css';
  if (!names.has(opfDir + cssName)) {
    files.push({ name: opfDir + cssName, data: Buffer.from(CSS + '\n.lsb-meta { color: #666; } .lsb-source { font-size: .8em; color: #666; margin-top: 2em; word-break: break-all; }') });
    names.add(opfDir + cssName);
    manifest.push(`<item id="${uniqueId('lesesaal-css')}" href="${cssName}" media-type="text/css"/>`);
  }
  for (const r of resources) {
    const name = safeResourceName(r && r.name);
    if (!name || !r.data || names.has(opfDir + name)) continue;
    files.push({ name: opfDir + name, data: r.data });
    names.add(opfDir + name);
    manifest.push(`<item id="${uniqueId('lsb-res')}" href="${esc(name)}" media-type="${esc(r.mime || 'application/octet-stream')}"/>`);
  }
  for (const c of chapters) {
    const title = C.collapseWs(c.title) || 'Kapitel';
    const file = uniqueName('lesesaal-kapitel', 'xhtml');
    const id = uniqueId('lsb-kapitel');
    const body = `<section class="cat-chapter" epub:type="chapter"><h2 class="cat-chapter-title">${esc(title)}</h2>${toXhtml(c.html)}</section>`;
    files.push({ name: opfDir + file, data: Buffer.from(xhtmlDoc(title, lang, body, cssName)) });
    manifest.push(`<item id="${id}" href="${esc(file)}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    added.push({ title, full: opfDir + file });
  }
  text = text.replace(/<\/manifest>/i, `${manifest.join('')}</manifest>`).replace(/<\/spine>/i, `${spine.join('')}</spine>`);
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  text = text.replace(/(<meta\b[^>]*property\s*=\s*"dcterms:modified"[^>]*>)[^<]*(<\/meta>)/i, `$1${now}$2`);
  opf.data = Buffer.from(text);

  if (navItem) {
    const navName = resolveHref(opfName, unesc(attrOf(navItem, 'href')));
    const nav = files.find((f) => f.name === navName);
    if (nav) nav.data = Buffer.from(insertIntoTocList(nav.data.toString('utf8'), added.map((n) => `<li><a href="${esc(relHref(navName, n.full))}">${esc(n.title)}</a></li>`).join('')));
  }
  if (ncxItem) {
    const ncxName = resolveHref(opfName, unesc(attrOf(ncxItem, 'href')));
    const ncx = files.find((f) => f.name === ncxName);
    if (ncx) {
      let x = ncx.data.toString('utf8');
      let order = Math.max(0, ...[...x.matchAll(/playOrder\s*=\s*"(\d+)"/gi)].map((m) => Number(m[1])));
      const ncxIds = new Set([...x.matchAll(/\bid\s*=\s*"([^"]+)"/gi)].map((m) => m[1]));
      const points = added.map((n) => {
        order++;
        let pid = 'lsb-navpoint-' + order;
        while (ncxIds.has(pid)) pid += '-x';
        ncxIds.add(pid);
        return `<navPoint id="${pid}" playOrder="${order}"><navLabel><text>${esc(n.title)}</text></navLabel><content src="${esc(relHref(ncxName, n.full))}"/></navPoint>`;
      });
      if (/<\/navMap>/i.test(x)) x = x.replace(/<\/navMap>/i, `${points.join('')}</navMap>`);
      ncx.data = Buffer.from(x);
    }
  }
  const mimetype = files.find((f) => f.name === 'mimetype');
  const rest = files.filter((f) => f.name !== 'mimetype');
  return zip([{ name: 'mimetype', data: mimetype ? mimetype.data : 'application/epub+zip', store: true },
    ...rest.map((f) => ({ name: f.name, data: f.data, store: /\.(jpe?g|png|gif|webp|mp3|mp4|m4a|woff2?)$/i.test(f.name) }))]);
}

/** Puts `lis` at the end of the top-level list of the toc <nav> (the first <nav> when none is marked as toc). */
function insertIntoTocList(html, lis) {
  const marked = html.search(/<nav\b[^>]*epub:type\s*=\s*"[^"]*\btoc\b[^"]*"[^>]*>/i);
  const navStart = marked >= 0 ? marked : html.search(/<nav\b/i);
  if (navStart < 0) return html;
  const olStart = html.slice(navStart).search(/<ol\b/i);
  if (olStart < 0) return html;
  const re = /<(\/?)ol\b[^>]*>/gi;
  re.lastIndex = navStart + olStart;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (m[1]) { depth--; if (depth === 0) return html.slice(0, m.index) + lis + html.slice(m.index); }
    else depth++;
  }
  return html;
}

/** Sanity check of a produced/downloaded EPUB: zip signature + mimetype entry. */
function looksLikeEpub(buf) { return Buffer.isBuffer(buf) && buf.length > 60 && buf[0] === 0x50 && buf[1] === 0x4b && buf.subarray(0, 200).toString('latin1').includes('mimetype'); }

module.exports = { buildEpub, zip, crc32, toXhtml, looksLikeEpub, unzip, appendChapters, readEpubSummary };
