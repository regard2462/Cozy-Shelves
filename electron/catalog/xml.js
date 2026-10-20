// Tiny dependency-free XML parser for well-formed feeds (Atom / OPDS / arXiv). No DOM, no namespaces
// resolution – elements keep their qualified name and expose `local` (name without prefix).
// Node: { name, local, attrs: {}, children: [Node|string], parent }
'use strict';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  if (!s || s.indexOf('&') < 0) return s || '';
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}

const ATTR_RE = /([^\s=\/>"']+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
function parseAttrs(s) {
  const attrs = {};
  if (!s) return attrs;
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(s))) attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

function mk(name, attrs, parent) { return { name, local: name.includes(':') ? name.slice(name.indexOf(':') + 1) : name, attrs: attrs || {}, children: [], parent: parent || null }; }

/** Parse an XML string. Returns the root element (or null). Throws on grossly malformed input. */
function parseXml(input) {
  let s = String(input || '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const root = mk('#document', {}, null);
  let cur = root;
  let i = 0;
  const n = s.length;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { const t = s.slice(i); if (t.trim()) cur.children.push(decodeEntities(t)); break; }
    if (lt > i) { const t = s.slice(i, lt); if (t.trim() || cur !== root) cur.children.push(decodeEntities(t)); }
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (s.startsWith('<![CDATA[', lt)) { const e = s.indexOf(']]>', lt + 9); cur.children.push(s.slice(lt + 9, e < 0 ? n : e)); i = e < 0 ? n : e + 3; continue; }
    if (s.startsWith('<?', lt)) { const e = s.indexOf('?>', lt + 2); i = e < 0 ? n : e + 2; continue; }
    if (s.startsWith('<!', lt)) { // DOCTYPE (may contain [ ... ])
      let depth = 0, j = lt + 2;
      for (; j < n; j++) { const c = s[j]; if (c === '[') depth++; else if (c === ']') depth--; else if (c === '>' && depth <= 0) break; }
      i = j + 1; continue;
    }
    const gt = findTagEnd(s, lt);
    if (gt < 0) break;
    const raw = s.slice(lt + 1, gt);
    i = gt + 1;
    if (raw[0] === '/') { // closing tag
      const name = raw.slice(1).trim();
      let p = cur;
      while (p && p !== root && p.name !== name) p = p.parent; // tolerate unbalanced tags
      if (p && p !== root) cur = p.parent;
      continue;
    }
    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1) : raw;
    const sp = body.search(/[\s\/]/);
    const name = (sp < 0 ? body : body.slice(0, sp)).trim();
    if (!name) continue;
    const el = mk(name, parseAttrs(sp < 0 ? '' : body.slice(sp)), cur);
    cur.children.push(el);
    if (!selfClose) cur = el;
  }
  return root.children.find((c) => typeof c !== 'string') || null;
}

function findTagEnd(s, from) {
  let q = null;
  for (let j = from + 1; j < s.length; j++) {
    const c = s[j];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '>') return j;
  }
  return -1;
}

// --- helpers ---------------------------------------------------------------------------------------
const isEl = (x) => x && typeof x === 'object';
/** Direct element children with the given local name (or all elements if no name). */
function children(el, local) { return el ? el.children.filter((c) => isEl(c) && (!local || c.local === local)) : []; }
function child(el, local) { return children(el, local)[0] || null; }
/** Text content (recursive) of an element. */
function text(el) { if (!el) return ''; if (typeof el === 'string') return el; return el.children.map(text).join(''); }
function childText(el, local) { const c = child(el, local); return c ? text(c).trim() : ''; }
function attr(el, name) { return el && el.attrs[name] != null ? el.attrs[name] : null; }
/** Serialize the children of an element back to markup (used for xhtml content). */
function innerXml(el) { return el ? el.children.map(serialize).join('') : ''; }
function serialize(node) {
  if (typeof node === 'string') return node.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const a = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`).join('');
  return node.children.length ? `<${node.name}${a}>${innerXml(node)}</${node.name}>` : `<${node.name}${a}/>`;
}
/** Depth-first search for all elements with a local name. */
function findAll(el, local, out = []) { for (const c of el ? el.children : []) { if (!isEl(c)) continue; if (c.local === local) out.push(c); findAll(c, local, out); } return out; }

module.exports = { parseXml, decodeEntities, children, child, text, childText, attr, innerXml, serialize, findAll };
