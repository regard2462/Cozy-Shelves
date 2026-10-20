// `require('path')` of the backend modules the web build bundles (electron/feeds/wiki.js, dict.js): they only join
// cache folder names, which the browser version never writes. build/web.js points the module name here.
const norm = (s) => String(s || '').replace(/\\/g, '/');
export function join(...parts) { return parts.map(norm).filter(Boolean).join('/').replace(/\/+/g, '/'); }
export function basename(p, ext) { const b = norm(p).split('/').filter(Boolean).pop() || ''; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; }
export function extname(p) { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; }
export function dirname(p) { const parts = norm(p).split('/'); parts.pop(); return parts.join('/') || '.'; }
export function normalize(p) { return norm(p); }
export function isAbsolute(p) { return /^([a-zA-Z]:)?\//.test(norm(p)); }
export function relative(from, to) { return norm(to).startsWith(norm(from)) ? norm(to).slice(norm(from).length).replace(/^\//, '') : norm(to); }
export function resolve(...parts) { return join(...parts); }
export const sep = '/';
export default { join, basename, extname, dirname, normalize, isAbsolute, relative, resolve, sep };
