// Builds a foliate-js "book" object (see vendor/foliate-js/README.md, "The Main Interface for Books")
// from plain text or HTML, so that TXT / MD / HTML / DOCX / RTF files can be read with the same
// paginator, CFIs, search, TTS and annotations as EPUBs.
import { escapeHtml } from '../../core/dom.js';

const SECTION_MAX = 40000;   // ~chars per section
const SECTION_SPLIT_MIN = 6000; // start a new section at a chapter heading once this many chars are collected

const RX_MD_HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;
const RX_CHAPTER = /^(kapitel|chapter|teil|part|buch|book|abschnitt|prolog|prologue|epilog|epilogue|vorwort|preface|einleitung|introduction)\b[\s.:\-–]*([\divxlc]+)?[\s.:\-–]*(.*)$/i;
const RX_ROMAN = /^[IVXLC]{1,7}\.?$/;

function isCapsHeading(line) {
  if (line.length < 3 || line.length > 60) return false;
  const letters = line.replace(/[^\p{L}]/gu, '');
  if (letters.length < 3) return false;
  return letters === letters.toUpperCase() && letters !== letters.toLowerCase() && !/[.!?,;:]$/.test(line);
}

function inline(md) {
  // tiny inline markdown: **strong**, *em*, `code`
  let s = escapeHtml(md);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(.+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  return s;
}

/** Plain text → blocks [{type:'h'|'p'|'q'|'li'|'hr', level?, text, html}] */
export function textToBlocks(text) {
  text = String(text || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  const lines = text.split('\n');
  const hasBlank = /\n[ \t]*\n/.test(text);
  const blocks = [];
  let para = [];
  const flush = () => { if (para.length) { blocks.push({ type: 'p', text: para.join(' '), html: inline(para.join(' ')) }); para = []; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    let m;
    if ((m = RX_MD_HEADING.exec(line))) { flush(); blocks.push({ type: 'h', level: Math.min(3, m[1].length), text: m[2], html: inline(m[2]) }); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { flush(); blocks.push({ type: 'hr', text: '', html: '' }); continue; }
    if ((m = RX_CHAPTER.exec(line)) && line.length < 80 && (m[2] || !/[.,;]$/.test(line))) { flush(); blocks.push({ type: 'h', level: 2, text: line, html: inline(line) }); continue; }
    if (RX_ROMAN.test(line) || isCapsHeading(line)) { flush(); blocks.push({ type: 'h', level: 2, text: line, html: inline(line) }); continue; }
    if (/^>\s?/.test(line)) { flush(); blocks.push({ type: 'q', text: line.replace(/^>\s?/, ''), html: inline(line.replace(/^>\s?/, '')) }); continue; }
    if (/^([-*•]|\d+[.)])\s+/.test(line)) { flush(); blocks.push({ type: 'li', text: line.replace(/^([-*•]|\d+[.)])\s+/, ''), html: inline(line.replace(/^([-*•]|\d+[.)])\s+/, '')) }); continue; }
    if (hasBlank) para.push(line); else blocks.push({ type: 'p', text: line, html: inline(line) });
  }
  flush();
  return blocks;
}

/** HTML string → blocks (top-level elements of the body). `base`: URL that relative links and images resolve against. */
export function htmlToBlocks(html, base = null) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  let root = doc.body;
  // unwrap a single wrapper element (mammoth / readability output)
  while (root.children.length === 1 && /^(div|article|section|main)$/i.test(root.children[0].tagName)) root = root.children[0];
  if (base) absolutizeUrls(root, base);
  const blocks = [];
  for (const node of [...root.childNodes]) {
    if (node.nodeType === 3) { const t = node.textContent.trim(); if (t) blocks.push({ type: 'p', text: t, html: `<p>${escapeHtml(t)}</p>` }); continue; }
    if (node.nodeType !== 1) continue;
    const tag = node.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta' || tag === 'title') continue;
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    // the heading keeps the id the author gave it: "#teil2" links point at it
    if (/^h[1-6]$/.test(tag)) { blocks.push({ type: 'h', level: Math.min(3, +tag[1]), text, html: node.innerHTML, raw: node, origId: node.getAttribute('id') || node.getAttribute('name') || null }); continue; }
    if (!text && !node.querySelector('img,svg,table,video,audio,hr')) continue;
    blocks.push({ type: 'raw', text, html: node.outerHTML, size: node.outerHTML.length });
  }
  return blocks;
}

/**
 * Make the relative URLs of a parsed document absolute. The section documents are blob: URLs whose
 * <base> element the app's CSP (base-uri 'self') blocks, so relative images and links would otherwise
 * resolve against the blob. In-page anchors (#…) stay as they are.
 */
function absolutizeUrls(root, base) {
  for (const el of root.querySelectorAll('[src], [href], [poster]')) {
    for (const attr of ['src', 'href', 'poster']) {
      const v = el.getAttribute(attr);
      if (v == null || v.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(v.trim())) continue;
      try { el.setAttribute(attr, new URL(v.trim(), base).href); } catch { /* keep it */ }
    }
    if (el.hasAttribute('srcset')) el.removeAttribute('srcset');
  }
}

/** GitHub-style heading slug ("Abschnitt zwei" → "abschnitt-zwei"), so Markdown links like (#abschnitt-zwei) find their heading. */
export function slugify(text) {
  return String(text || '').trim().toLowerCase().normalize('NFC')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-');
}

function blockHtml(b, id) {
  const idAttr = id ? ` id="${id}"` : '';
  switch (b.type) {
    case 'h': return `<h${b.level}${idAttr}>${b.html}</h${b.level}>`;
    case 'q': return `<blockquote${idAttr}><p>${b.html}</p></blockquote>`;
    case 'li': return `<ul${idAttr}><li>${b.html}</li></ul>`;
    case 'hr': return `<hr${idAttr}>`;
    case 'raw': return b.html;
    default: return `<p${idAttr}>${b.html}</p>`;
  }
}

const DOC_CSS = `
  html { margin: 0; padding: 0; }
  body { margin: 0; padding: 0; }
  h1, h2, h3, h4 { font-weight: 600; line-height: 1.2; text-align: start; break-after: avoid; }
  h1 { font-size: 1.9em; text-align: center; margin: 1.4em 0 1em; }
  h2 { font-size: 1.45em; margin: 1.6em 0 .7em; }
  h3 { font-size: 1.15em; margin: 1.3em 0 .5em; }
  p { margin: 0 0 .8em; }
  blockquote { margin: 1em 1.6em; font-style: italic; }
  ul, ol { margin: 0 0 .8em; padding-inline-start: 1.6em; }
  ul + ul { margin-top: -.8em; }
  hr { border: 0; text-align: center; margin: 1.6em 0; }
  hr::after { content: "❦"; opacity: .5; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; max-width: 100%; }
  td, th { border: 1px solid currentColor; padding: .2em .5em; }
  pre { white-space: pre-wrap; font-size: .9em; }
  .rd-subtitle { text-align: center; font-style: italic; margin-top: -0.6em; opacity: .8; }
`;

/**
 * Create the book object.
 * @param {{text?:string, html?:string}} src
 * @param {{title?, author?, language?, format?, baseHref?}} meta
 */
export function makeTextBook(src, meta = {}) {
  const format = meta.format || (src.html ? 'html' : 'txt');
  const BASE = meta.baseHref || null;
  // relative URLs are made absolute here (web pages, file:// for local HTML books); an lfile:// or blob: base
  // cannot resolve them (the lfile scheme addresses a whole file path in its first segment)
  const resolvable = BASE && /^(https?|file):/i.test(BASE) ? BASE : null;
  const blocks = src.html != null ? htmlToBlocks(src.html, resolvable) : textToBlocks(src.text);
  const lang = (meta.language || '').slice(0, 5);
  const title = meta.title || blocks.find((b) => b.type === 'h')?.text || 'Text';

  // ---- group blocks into sections ----
  const sections = [];
  let cur = null;
  let headingCount = 0;
  const newSection = () => { cur = { blocks: [], size: 0, title: '', headings: [] }; sections.push(cur); return cur; };
  for (const b of blocks) {
    const size = b.size || b.html.length + 8;
    if (!cur) newSection();
    else if (b.type === 'h' && b.level <= 2 && cur.size > SECTION_SPLIT_MIN) newSection();
    else if (cur.size + size > SECTION_MAX && cur.blocks.length) newSection();
    if (b.type === 'h') { b.id = 'rd-h' + (headingCount++); if (!cur.title) cur.title = b.text; cur.headings.push(b); }
    cur.blocks.push(b); cur.size += size;
  }
  if (!sections.length) newSection().blocks.push({ type: 'p', text: '', html: '' });
  sections.forEach((s, i) => { if (!s.title) s.title = i === 0 ? title : (s.blocks.find((b) => b.text)?.text || '').slice(0, 60); });

  // Anchors: the heading ids stay "rd-hN" (saved CFIs and notes point at them); the ids the author gave a
  // heading and the slug of its text ("#abschnitt-zwei" in Markdown) are aliases. anchorSection knows which
  // section holds every id, so a link into another section lands there instead of on this section's start.
  const alias = new Map();
  const anchorSection = new Map();
  sections.forEach((s, index) => {
    for (const b of s.blocks) {
      if (b.type === 'h') {
        anchorSection.set(b.id, index);
        for (const a of [b.origId, slugify(b.text)]) if (a && !alias.has(a) && a !== b.id) { alias.set(a, b.id); if (!anchorSection.has(a)) anchorSection.set(a, index); }
      } else if (b.type === 'raw') {
        for (const m of b.html.matchAll(/\s(?:id|name)="([^"]+)"/g)) if (!anchorSection.has(m[1])) anchorSection.set(m[1], index);
      }
    }
  });
  const decode = (id) => { try { return decodeURIComponent(id); } catch { return id; } };
  const findAnchor = (doc, id) => {
    if (!id) return null;
    const d = decode(id);
    return doc.getElementById(d) || (alias.has(d) ? doc.getElementById(alias.get(d)) : null) || doc.getElementsByName?.(d)?.[0] || null;
  };

  // no <base> element: the CSP of the app (base-uri 'self') blocks it in the blob: section documents
  const urls = [];
  const sectionObjs = sections.map((s, index) => {
    const body = s.blocks.map((b) => blockHtml(b, b.id)).join('\n');
    const html = `<!DOCTYPE html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>${escapeHtml(s.title || title)}</title><style>${DOC_CSS}</style></head><body>${body}</body></html>`;
    let url = null;
    return {
      id: index,
      title: s.title,
      size: Math.max(200, s.blocks.reduce((a, b) => a + (b.text?.length || 0), 0)),
      linear: 'yes',
      load: () => { if (!url) { url = URL.createObjectURL(new Blob([html], { type: 'text/html' })); urls.push(url); } return url; },
      unload: () => {},
      createDocument: () => new DOMParser().parseFromString(html, 'text/html'),
      // foliate (view.js #handleLinks) resolves every clicked href through the section first:
      // fragments stay inside this section, everything else becomes absolute against the document base.
      resolveHref: (href) => {
        const s2 = String(href ?? '');
        if (!s2) return s2;
        if (s2.startsWith('#')) { const id = decode(s2.slice(1)); return `${anchorSection.get(id) ?? index}#${id}`; }
        if (/^\d+(#|$)/.test(s2)) return s2;
        if (!BASE) return s2;
        try { return new URL(s2, BASE).href; } catch { return s2; }
      },
    };
  });

  // ---- table of contents from headings (nested by level) ----
  const toc = [];
  const stack = [];
  sections.forEach((s, index) => {
    for (const hb of s.headings) {
      const item = { label: hb.text, href: `${index}#${hb.id}`, subitems: [], level: hb.level };
      while (stack.length && stack[stack.length - 1].level >= hb.level) stack.pop();
      if (stack.length) stack[stack.length - 1].subitems.push(item); else toc.push(item);
      stack.push(item);
    }
  });
  const prune = (items) => items.map((it) => ({ label: it.label, href: it.href, subitems: it.subitems.length ? prune(it.subitems) : null }));
  const tocOut = toc.length ? prune(toc) : sections.map((s, i) => ({ label: s.title || `${i + 1}`, href: `${i}`, subitems: null }));

  return {
    metadata: { title, author: meta.author || '', language: lang, format },
    dir: 'ltr',
    baseHref: BASE,
    sections: sectionObjs,
    toc: tocOut,
    // this adapter addresses its own sections as "<index>" / "<index>#<anchor-id>"
    resolveHref: (href) => {
      const raw = String(href ?? '');
      const [a, b] = raw.split('#');
      const index = Number(a);
      // anything that is not one of our own hrefs must never silently jump to section 0
      if (a !== '' && !/^\d+$/.test(a)) return { index: 0, anchor: (doc) => doc.body };
      return { index: Number.isFinite(index) && a !== '' ? index : 0, anchor: (doc) => findAnchor(doc, b) || doc.body };
    },
    splitTOCHref: (href) => { const [a, b] = String(href || '').split('#'); return [/^\d+$/.test(a) ? Number(a) : 0, b || null]; },
    getTOCFragment: (doc, id) => (id ? findAnchor(doc, id) : doc.body),
    // "external" = leaves this adapter's addressing space. Section.resolveHref() has already made
    // relative hrefs absolute, so everything that is neither "<index>[#id]" nor a bare fragment goes
    // to the reader's in-app navigator instead of dying in resolveHref (finding 2).
    isExternal: (uri) => {
      const s = String(uri ?? '');
      if (!s || s.startsWith('#')) return false;
      return !/^\d+(#|$)/.test(s);
    },
    destroy: () => { for (const u of urls) URL.revokeObjectURL(u); urls.length = 0; },
  };
}
