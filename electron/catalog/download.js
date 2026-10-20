// Downloads into the library folder ("Online-Katalog/<Source>"), with progress broadcasts, duplicate
// protection, content sniffing (no HTML error pages saved as .epub) and the in-app EPUB builder for
// wiki / web texts. After a download the library is rescanned quietly so the book appears on the shelf.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EXT } = require('./sources/util');
const { buildEpub } = require('./epub');

/** The id the library scanner gives this file (same formula as electron/library/library.js idFor):
 *  with it the panel can open a freshly downloaded PDF/EPUB in the reader right away. */
const libraryIdFor = (file) => crypto.createHash('sha1').update(path.normalize(file).toLowerCase()).digest('hex').slice(0, 16);

const PROGRESS_EVERY = 200; // ms
const INACTIVITY = 60000;   // ms without a chunk → abort
const MAX_NAME = 150;

function sanitizeName(s) {
  return String(s || '').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '').trim();
}
/** "<Title> - <Author>.<ext>" (author optional), limited in length. */
function fileNameFor(item, ext) {
  let title = sanitizeName(item.title) || 'Unbenannt';
  let author = sanitizeName(item.author || '');
  if (author.length > 60) author = author.slice(0, 60).replace(/[\s,;]+\S*$/, '');
  const room = MAX_NAME - ext.length - 1 - (author ? author.length + 3 : 0);
  if (title.length > room) title = title.slice(0, Math.max(20, room)).replace(/\s+\S*$/, '');
  return `${title}${author ? ' - ' + author : ''}.${ext}`;
}

/** Library target folder: first folder with mode 'auto', else the first one. */
function libraryFolder(settings) {
  const folders = settings.get('folders') || [];
  const f = folders.find((x) => x && x.mode === 'auto') || folders[0];
  if (!f || !f.path) throw new Error('Kein Bücherordner eingerichtet. Bitte zuerst in den Einstellungen einen Ordner wählen.');
  return f.path;
}

const MAGIC = {
  epub: (b) => b.length >= 2 && b[0] === 0x50 && b[1] === 0x4b,
  pdf: (b) => b.subarray(0, 8).toString('latin1').includes('%PDF'),
  mobi: (b) => b.length > 68 ? /BOOKMOBI|TEXtREAd|TPZ/.test(b.subarray(0, 80).toString('latin1')) : true,
};
const BINARY = new Set(['epub', 'pdf', 'mobi']);

function createDownloader({ settings, library, broadcast, net, sources, readable }) {
  const jobs = new Map();
  const emit = (payload) => { try { broadcast?.('catalog:progress', payload); } catch {} };

  function targetDirFor(item) {
    const src = sources.byId[item.source];
    const dir = path.join(libraryFolder(settings), 'Online-Katalog', sanitizeName(src ? src.name : item.source) || 'Sonstige');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async function resolveFormat(item, fmt) {
    if (/^ia:\/\//.test(fmt.url)) {
      const src = sources.byId[item.source];
      if (!src || !src.resolveFormat) throw new Error('Format nicht auflösbar');
      return src.resolveFormat(fmt, { net });
    }
    return fmt;
  }

  /**
   * The "thank you for downloading" pages some libraries put in front of the file (Standard Ebooks since 2024)
   * forward with <meta http-equiv="refresh" content="0; url=…">. Returns that URL, or null.
   */
  async function refreshTarget(res, baseUrl) {
    let html = '';
    try {
      const reader = res.body.getReader();
      while (html.length < 200000) { const { value, done } = await reader.read(); if (done) break; html += Buffer.from(value).toString('latin1'); }
      try { await reader.cancel(); } catch {}
    } catch { return null; }
    const m = /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']?\s*\d+\s*;\s*url\s*=\s*([^"'>\s]+)/i.exec(html)
      || /<meta[^>]+content\s*=\s*["']?\s*\d+\s*;\s*url\s*=\s*([^"'>\s]+)[^>]*http-equiv\s*=\s*["']?refresh/i.exec(html);
    if (!m) return null;
    try {
      const next = new URL(m[1].replace(/&amp;/g, '&'), baseUrl).href;
      return /^https?:/i.test(next) && next !== baseUrl ? next : null;
    } catch { return null; }
  }

  /** Stream a URL to `target` (via .part). Returns { received, total, contentType }. */
  async function streamToFile(url, target, { id, type, ctrl, accept, hops = 0 }) {
    let timer = null;
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(new Error('Zeitüberschreitung (keine Daten)')), INACTIVITY); };
    bump();
    const tmp = target + '.part';
    let fd = null, received = 0;
    try {
      const res = await net.stream(url, { signal: ctrl.signal, headers: { Accept: accept || '*/*' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      const total = Number(res.headers.get('content-length')) || null;
      if (BINARY.has(type) && /text\/html|application\/xhtml/.test(ct)) {
        // a download page that forwards to the file: follow it (at most twice), otherwise it is an error page
        const next = hops < 2 ? await refreshTarget(res, url) : null;
        if (next) { clearTimeout(timer); return streamToFile(next, target, { id, type, ctrl, accept, hops: hops + 1 }); }
        throw new Error('Keine Buchdatei erhalten (der Server lieferte eine HTML-Seite)');
      }
      const reader = res.body.getReader();
      fd = fs.openSync(tmp, 'w');
      let first = true, lastEmit = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bump();
        if (first) {
          first = false;
          const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
          if (BINARY.has(type) && MAGIC[type] && !MAGIC[type](buf)) throw new Error(`Die Datei ist kein ${type.toUpperCase()} (${ct || 'unbekannter Typ'})`);
          if (!BINARY.has(type) && buf.length > 4 && (buf[0] === 0x50 && buf[1] === 0x4b || buf.subarray(0, 5).toString('latin1') === '%PDF-')) throw new Error('Unerwartete Binärdatei');
        }
        fs.writeSync(fd, value);
        received += value.length;
        const now = Date.now();
        if (now - lastEmit > PROGRESS_EVERY) { lastEmit = now; emit({ id, received, total, done: false }); }
      }
      fs.closeSync(fd); fd = null;
      if (received < 64) throw new Error('Leere Datei erhalten');
      fs.renameSync(tmp, target);
      return { received, total, contentType: ct };
    } catch (e) {
      if (fd != null) { try { fs.closeSync(fd); } catch {} }
      try { fs.unlinkSync(tmp); } catch {}
      throw ctrl.signal.aborted ? (ctrl.signal.reason instanceof Error ? ctrl.signal.reason : new Error('Abgebrochen')) : e;
    } finally { clearTimeout(timer); }
  }

  /** Build an EPUB from the item's readable text (wiki / web / gutenberg-de …) and write it into `dir`. */
  async function buildFromText(item, dir, { id, ctrl }) {
    emit({ id, received: 0, total: null, done: false, phase: 'fetch' });
    const book = await readable.readItem(item, { chapters: 'all' }, { net, onProgress: (p) => emit({ id, received: p.pages, total: null, done: false, phase: 'pages', pages: p.pages }) });
    if (ctrl.signal.aborted) throw new Error('Abgebrochen');
    const title = book.title || item.title, author = book.author || item.author;
    const target = path.join(dir, fileNameFor({ title, author }, 'epub'));
    if (fs.existsSync(target) && fs.statSync(target).size > 64) return { target, received: 1, total: 1, existed: true, built: true };
    let cover = null;
    const coverUrl = item.cover || book.image;
    if (coverUrl) {
      try { const r = await net.raw(coverUrl, { timeout: 15000 }); if (r.ok && /^image\/(jpeg|png)/i.test(r.contentType) && r.buffer.length < 3e6) cover = { data: r.buffer, mime: /png/i.test(r.contentType) ? 'image/png' : 'image/jpeg' }; } catch {}
    }
    emit({ id, received: 0, total: null, done: false, phase: 'build' });
    const src = sources.byId[item.source];
    const buf = buildEpub({ title, author, language: book.language || item.language || 'de', identifier: 'urn:lesesaal:' + item.id, source: src ? src.name : item.source, sourceUrl: book.url || item.readOnlineUrl, description: item.description, chapters: book.chapterHtml || [{ title: book.title, html: book.html }], cover });
    fs.writeFileSync(target + '.part', buf);
    fs.renameSync(target + '.part', target);
    return { target, received: buf.length, total: buf.length, built: true, title };
  }

  /** 'catalog:download' – returns { path, existed?, built? }. */
  async function download(item, formatIndex = 0) {
    if (!item || !item.id) throw new Error('Kein Eintrag');
    const id = item.id;
    if (jobs.has(id)) throw new Error('Wird bereits geladen');
    const formats = Array.isArray(item.formats) ? item.formats : [];
    let fmt = formats[formatIndex] || formats.find((f) => f.type === 'epub') || formats[0];
    if (!fmt) throw new Error('Kein herunterladbares Format');
    if (fmt.type === 'audio-rss') throw new Error('Hörbücher werden im Podcast-Player abonniert');
    const ctrl = new AbortController();
    jobs.set(id, { ctrl });
    try {
      emit({ id, received: 0, total: fmt.size || null, done: false, phase: 'start' });
      const dir = targetDirFor(item);
      const wantsBuild = /^build:\/\//.test(fmt.url);
      let res, target = null;
      if (wantsBuild) res = await buildFromText(item, dir, { id, ctrl });
      else {
        fmt = await resolveFormat(item, fmt);
        target = path.join(dir, fileNameFor(item, EXT[fmt.type] || 'bin'));
        if (fs.existsSync(target) && fs.statSync(target).size > 64) { emit({ id, received: 1, total: 1, done: true, path: target, existed: true, bookId: libraryIdFor(target) }); return { path: target, existed: true, bookId: libraryIdFor(target) }; }
        try { res = await streamToFile(fmt.url, target, { id, type: fmt.type, ctrl, accept: fmt.type === 'epub' ? 'application/epub+zip, application/octet-stream;q=0.9, */*;q=0.5' : undefined }); }
        catch (e) {
          if (fmt.fallback === 'build' && !ctrl.signal.aborted) { console.warn('[catalog] download failed, building epub instead:', e.message); res = await buildFromText(item, dir, { id, ctrl }); }
          else throw e;
        }
      }
      if (res.target) target = res.target;
      const bookId = libraryIdFor(target);
      if (res.existed) { emit({ id, received: 1, total: 1, done: true, path: target, existed: true, bookId }); return { path: target, existed: true, built: true, bookId }; }
      emit({ id, received: res.received, total: res.total || res.received, done: true, path: target, built: !!res.built, bookId });
      try { await library?.rescanQuiet?.(); } catch (e) { console.warn('[catalog] rescan failed', e.message); }
      return { path: target, built: !!res.built, bookId };
    } catch (e) {
      emit({ id, received: 0, total: null, done: true, error: e.message || String(e) });
      throw e;
    } finally { jobs.delete(id); }
  }

  /** 'catalog:toEpub' – EPUB into the library (WS Export when available, otherwise built in-app). */
  async function toEpub(item) {
    const formats = Array.isArray(item?.formats) ? item.formats : [];
    let idx = formats.findIndex((f) => f.type === 'epub');
    if (idx < 0) { item = { ...item, formats: [{ type: 'epub', url: 'build://epub', label: 'EPUB' }, ...formats] }; idx = 0; }
    return download(item, idx);
  }

  function cancel(id) { const j = jobs.get(id); if (!j) return false; j.ctrl.abort(new Error('Abgebrochen')); return true; }
  function active() { return [...jobs.keys()]; }

  return { download, toEpub, cancel, active, fileNameFor, targetDirFor };
}

module.exports = { createDownloader, fileNameFor, sanitizeName, libraryFolder, libraryIdFor };
