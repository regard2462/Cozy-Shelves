// Automatic shelving: keyword scoring + silent online metadata lookup (ISBN / title).
// The department set is fixed (taxonomy.js) — classify() only decides *which* of the
// fixed departments a book belongs to, it never invents one.
const { TAXONOMY, DEFAULT_DEPARTMENT, departmentById, legacyDepartmentId } = require('./taxonomy');

const stripNumbering = (s) => String(s || '').replace(/^[\s\d._-]+/, '').trim();
const norm = (s) => stripNumbering(s).toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

// Aliases sorted longest-first so "internetsicherheit" wins over "sicherheit".
const ALIAS_INDEX = TAXONOMY
  .flatMap((t) => t.aliases.map((a) => ({ alias: norm(a), t })))
  .filter((x) => x.alias.length >= 4)
  .sort((a, b) => b.alias.length - a.alias.length);

/**
 * Map a (folder) name onto a taxonomy entry — exact department name first, then aliases.
 * Used for pre-sorted libraries and for migrating legacy department names.
 */
function findTaxonomyByName(name) {
  const n = norm(name);
  if (!n) return null;
  for (const t of TAXONOMY) if (t.de.toLowerCase() === n || t.en.toLowerCase() === n) return t;
  const legacy = legacyDepartmentId(name);
  if (legacy) { const t = TAXONOMY.find((x) => x.id === legacy); if (t) return t; }
  for (const { alias, t } of ALIAS_INDEX) if (containsWord(n, alias)) return t;
  return null;
}

/** Department id for a folder name; falls back to 'misc' (never invents a department). */
function departmentIdFromFolder(name) {
  const t = findTaxonomyByName(name);
  return t ? t.id : DEFAULT_DEPARTMENT;
}

// --- the user's own folders as departments ('structured' books folders) ---------------------------------
const FOLDER_PREFIX = 'folder:';
/** Stable id of the department a top-level folder stands for: "02 Schach" and "Schach" are the same one. */
function folderDepartmentId(rawName) { return FOLDER_PREFIX + (norm(rawName) || String(rawName || '').trim().toLowerCase()); }
const isFolderDepartmentId = (id) => typeof id === 'string' && id.startsWith(FOLDER_PREFIX);
/** Display name of a folder: without its numbering ("01 Klassiker" → "Klassiker"). */
function folderDisplayName(rawName) { return stripNumbering(rawName) || String(rawName || '').trim(); }
// folders whose name says "not sorted yet": as a department they go last, as a shelf to the end of their department
const LEFTOVER = /^(sonstiges|sonstige|verschiedenes|diverses|unsortiert|misc|miscellaneous|other|others|temp|tmp|gehört nicht hierher|gehoert nicht hierher|neuzugänge|eingang)$/i;
function isLeftoverFolder(rawName) { return LEFTOVER.test(folderDisplayName(rawName).replace(/^[_\s]+/, '')); }

// --- ISBN --------------------------------------------------------------------
function isValidIsbn13(s) {
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (i % 2 ? 3 : 1) * +s[i];
  return (10 - (sum % 10)) % 10 === +s[12];
}
function isValidIsbn10(s) {
  if (!/^\d{9}[\dX]$/i.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * +s[i];
  const c = s[9].toUpperCase() === 'X' ? 10 : +s[9];
  return (sum + c) % 11 === 0;
}
function toIsbn13(s) {
  if (s.length === 13) return s;
  const core = '978' + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (i % 2 ? 3 : 1) * +core[i];
  return core + ((10 - (sum % 10)) % 10);
}
function extractIsbn(text) {
  if (!text) return null;
  const candidates = [];
  const re = /(?:isbn(?:-1[03])?[:\s]*)?((?:97[89][-\s]?)?\d{1,5}[-\s]?\d{1,7}[-\s]?\d{1,7}[-\s]?[\dX])\b/gi;
  let m;
  while ((m = re.exec(text)) && candidates.length < 40) {
    const raw = m[1].replace(/[-\s]/g, '').toUpperCase();
    const explicit = /isbn/i.test(m[0]);
    if (raw.length === 13 && isValidIsbn13(raw)) candidates.push({ isbn: raw, explicit });
    else if (raw.length === 10 && isValidIsbn10(raw)) candidates.push({ isbn: toIsbn13(raw), explicit });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.explicit ? 1 : 0) - (a.explicit ? 1 : 0));
  return candidates[0].isbn;
}

// --- keyword scoring -------------------------------------------------------
// A keyword only counts as a hit when it starts at a word boundary. It may *end*
// inside a word only for stems of >= 5 letters, so German compounds still match
// ("schach" → "Schachtaktik") while short words cannot glue themselves onto a
// longer one ("oper" must not match "Operation", "art" is not a keyword at all).
const WORD_CHAR = /[a-z0-9äöüßàáâãåæçèéêëìíîïñòóôõøùúûýþœ]/i;
const LETTER = /[a-zäöüßàáâãåæçèéêëìíîïñòóôõøùúûýþœ]/i;

const usable = (kw) => typeof kw === 'string' && kw.trim().length >= 4;

/** Relative importance of a keyword: longer and multi-word keywords are more specific. */
function weightOf(kw) {
  const words = kw.split(/\s+/).filter(Boolean).length;
  let w = 1;
  if (words > 1) w += 0.6 * (words - 1);
  if (kw.length >= 14) w += 0.7;
  else if (kw.length >= 10) w += 0.45;
  else if (kw.length >= 7) w += 0.2;
  return Math.min(w, 2.6);
}

const TAIL_MIN = 7;        // "Aquarell|malerei", "Wissenschafts|geschichte"
const TAIL_FACTOR = 0.6;   // a compound tail is a weaker signal than a word start

function countHits(haystack, kw, cap = 3) {
  if (!haystack || !kw) return 0;
  const allowSuffix = kw.length >= 5 && LETTER.test(kw[kw.length - 1]);
  const allowTail = kw.length >= TAIL_MIN && LETTER.test(kw[0]);
  let n = 0, idx = 0;
  while (n < cap) {
    idx = haystack.indexOf(kw, idx);
    if (idx < 0) break;
    const prev = idx > 0 ? haystack[idx - 1] : ' ';
    const nextIdx = idx + kw.length;
    const next = nextIdx < haystack.length ? haystack[nextIdx] : ' ';
    const leftOk = !WORD_CHAR.test(prev);
    const rightOk = !WORD_CHAR.test(next) || (allowSuffix && LETTER.test(next));
    if (leftOk && rightOk) n += 1;
    else if (allowTail && !leftOk && LETTER.test(prev) && !WORD_CHAR.test(next)) n += TAIL_FACTOR;
    idx = nextIdx;
  }
  return n;
}

/** True when `hay` contains `needle` as a whole word / word prefix. */
function containsWord(hay, needle) { return countHits(hay, needle, 1) > 0; }

// "Die Kunst des Gärtnerns" / "The Art of Packing" are idioms, not art books —
// drop the phrase unless it really introduces an art (or war) subject.
const ART_IDIOM = /\b(?:die\s+|the\s+)?(?:kunst|art)\s+(?:des|der|of|zu)\s+(?!krieg|war\b|malerei|renaissance|fotograf|zeichn|barock|antike|moderne|schönen|fuge)/gi;
const deIdiom = (s) => s.replace(ART_IDIOM, ' ').replace(/\s+/g, ' ').trim();

function buildSignals(book) {
  const title = deIdiom(norm(book.title || ''));
  const file = deIdiom(norm((book.relPath || book.path || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '')));
  const folder = norm((book.relPath || '').split(/[\\/]/).slice(0, -1).join(' '));
  const subjects = norm((book.subjects || []).concat(book.onlineSubjects || []).join(' | '));
  const desc = deIdiom(norm(book.description || ''));
  const text = deIdiom(norm((book.textSample || '').slice(0, 12000)));
  const author = norm(book.author || '');
  return { title, file, folder, subjects, desc, text, author };
}

function scoreTaxonomy(sig, entry) {
  let score = 0;
  for (const kw of entry.keywords) {
    if (!usable(kw)) continue;
    const w = weightOf(kw);
    let s = 0;
    s += 4 * countHits(sig.title, kw, 2);
    s += 2 * countHits(sig.file, kw, 2);
    s += 3 * countHits(sig.subjects, kw, 3);
    s += 1.5 * countHits(sig.desc, kw, 3);
    s += 1 * countHits(sig.text, kw, 3);
    s += 2 * countHits(sig.folder, kw, 1);
    s += 2 * countHits(sig.author, kw, 1);      // "… - Friedrich Nietzsche" is a signal
    score += s * w;
  }
  return score;
}

function scoreShelf(sig, keywords) {
  let score = 0;
  for (const kw of keywords) {
    if (!usable(kw)) continue;
    const w = weightOf(kw);
    score += w * (4 * countHits(sig.title, kw, 2) + 2 * countHits(sig.file, kw, 1) + 2 * countHits(sig.subjects, kw, 2)
      + 1 * countHits(sig.desc, kw, 2) + 0.5 * countHits(sig.text, kw, 3));
  }
  return score;
}

const MIN_SCORE = 4;

/**
 * Classify a book into one of the fixed departments (and a shelf inside it).
 * @param book book record (title, subjects, description, textSample, relPath …)
 * @param existingDepartments [{name, id?, shelves:[{name}]}] departments that already exist
 * @returns {departmentId, department, departmentEn, shelf, confidence, taxonomyId}
 */
function classify(book, existingDepartments = []) {
  const sig = buildSignals(book);
  const scored = TAXONOMY.filter((t) => t.id !== 'misc').map((t) => ({ t, s: scoreTaxonomy(sig, t) })).sort((a, b) => b.s - a.s);
  const best = scored[0];
  const second = scored[1];
  const confidence = best && best.s > 0 ? Math.min(1, (best.s - (second?.s || 0)) / 16 + best.s / 60) : 0;
  const entry = best && best.s >= MIN_SCORE ? best.t : TAXONOMY.find((t) => t.id === 'misc');

  // Does an existing department correspond to this taxonomy entry? (keeps the user's own label)
  let department = null;
  for (const d of existingDepartments) {
    const id = d.id || (findTaxonomyByName(d.name) || {}).id;
    if (id === entry.id) { department = d; break; }
  }

  // Shelf: prefer existing shelves in that department, matched by taxonomy shelf keywords
  let shelf = null;
  const shelfDefs = entry.shelves || [];
  if (department && department.shelves?.length) {
    let bestShelf = null, bestScore = 0;
    for (const sh of department.shelves) {
      const shName = norm(sh.name);
      const def = shelfDefs.find(([name]) => norm(name) === shName || shName.includes(norm(name).split(' ')[0]) || norm(name).includes(shName.split(' ')[0]));
      const kws = def ? def[1] : shName.split(/[\s&,·]+/).filter((w) => w.length > 3);
      const s = scoreShelf(sig, kws);
      if (s > bestScore) { bestScore = s; bestShelf = sh.name; }
    }
    shelf = bestScore >= MIN_SCORE ? bestShelf : null;
  } else if (shelfDefs.length) {
    let bestShelf = null, bestScore = 0;
    for (const [name, kws] of shelfDefs) {
      const s = scoreShelf(sig, kws);
      if (s > bestScore) { bestScore = s; bestShelf = name; }
    }
    shelf = bestScore >= MIN_SCORE ? bestShelf : null;
  }
  const dep = departmentById(entry.id);
  return {
    departmentId: entry.id,
    department: department ? department.name : dep.de,
    departmentEn: dep.en,
    shelf,
    confidence,
    taxonomyId: entry.id,
    score: best ? Math.round(best.s * 10) / 10 : 0,
  };
}

// --- online lookup (silent) --------------------------------------------------
// Uses electron.net through feeds/common (proxy + system certificates); falls back to
// the global fetch outside Electron so this module stays unit-testable.
const LOOKUP_UA = 'CozyShelves/0.1 (personal library app)';
let common;
function getCommon() {
  if (common === undefined) { try { common = require('../feeds/common'); } catch { common = null; } }
  return common;
}

class LookupUnavailable extends Error {}

/** @returns parsed JSON, or null when the service answered "nothing found". Throws when unreachable. */
async function fetchJson(url, timeoutMs = 9000) {
  const C = getCommon();
  if (C && typeof C.fetchText === 'function') {
    let r;
    try { r = await C.fetchText(url, { timeout: timeoutMs, ua: LOOKUP_UA, headers: { Accept: 'application/json' } }); }
    catch (e) { throw new LookupUnavailable(e.message); }
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) throw new LookupUnavailable('HTTP ' + r.status);
    try { return JSON.parse(r.text); } catch { return null; }
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': LOOKUP_UA } });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new LookupUnavailable('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    if (e instanceof LookupUnavailable) throw e;
    throw new LookupUnavailable(e.message);
  } finally { clearTimeout(t); }
}

/**
 * Silent metadata lookup (OpenLibrary + Google Books).
 * Resolves with `{…, source, checked:true}` — `source === null` means "looked it up,
 * nothing there" (safe to cache). Rejects when no service could be reached at all,
 * so a machine that is merely offline does not poison the cache.
 */
async function lookupOnline(book) {
  const out = { subjects: [], description: null, title: null, author: null, year: null, publisher: null, source: null, checked: true };
  let attempts = 0, failures = 0;
  const tryJson = async (url) => {
    attempts++;
    try { return await fetchJson(url); }
    catch (e) { failures++; if (!(e instanceof LookupUnavailable)) console.warn('[classify] lookup failed', e.message); return null; }
  };
  const isbn = book.isbn;
  if (isbn) {
    const ol = await tryJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    const rec = ol && ol[`ISBN:${isbn}`];
    if (rec) {
      out.subjects.push(...(rec.subjects || []).map((s) => s.name || s).slice(0, 25));
      out.title = rec.title || null;
      out.author = (rec.authors || []).map((a) => a.name).join(', ') || null;
      out.publisher = (rec.publishers || []).map((p) => p.name).join(', ') || null;
      out.year = rec.publish_date ? parseInt(String(rec.publish_date).match(/\d{4}/)?.[0]) || null : null;
      out.source = 'openlibrary';
    }
    const gb = await tryJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`);
    const vi = gb && gb.items && gb.items[0] && gb.items[0].volumeInfo;
    if (vi) {
      out.subjects.push(...(vi.categories || []));
      out.description = out.description || vi.description || null;
      out.title = out.title || vi.title || null;
      out.author = out.author || (vi.authors || []).join(', ') || null;
      out.year = out.year || (vi.publishedDate ? parseInt(vi.publishedDate.slice(0, 4)) || null : null);
      out.source = out.source || 'googlebooks';
    }
  }
  if (!out.source && book.title && book.title.length > 3) {
    const q = encodeURIComponent(`intitle:${book.title.slice(0, 80)}` + (book.author ? `+inauthor:${book.author.split(/[,;]/)[0].slice(0, 40)}` : ''));
    const gb = await tryJson(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1`);
    const vi = gb && gb.items && gb.items[0] && gb.items[0].volumeInfo;
    if (vi && vi.title && similar(vi.title, book.title)) {
      out.subjects.push(...(vi.categories || []));
      out.description = vi.description || null;
      out.year = vi.publishedDate ? parseInt(vi.publishedDate.slice(0, 4)) || null : null;
      out.source = 'googlebooks-title';
    }
  }
  if (!out.source && attempts > 0 && failures === attempts) throw new LookupUnavailable('no metadata service reachable');
  out.subjects = [...new Set(out.subjects.map((s) => String(s).trim()).filter(Boolean))];
  return out;
}

function similar(a, b) {
  const na = norm(a).replace(/[^a-z0-9äöüß ]/g, ''), nb = norm(b).replace(/[^a-z0-9äöüß ]/g, '');
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = new Set(na.split(' ').filter((w) => w.length > 3));
  const wb = nb.split(' ').filter((w) => w.length > 3);
  const common2 = wb.filter((w) => wa.has(w)).length;
  return common2 >= Math.min(3, Math.max(1, Math.floor(Math.min(wa.size, wb.length) * 0.6)));
}

module.exports = {
  classify, extractIsbn, lookupOnline, findTaxonomyByName, departmentIdFromFolder,
  folderDepartmentId, isFolderDepartmentId, folderDisplayName, isLeftoverFolder,
  stripNumbering, norm, countHits, weightOf, LookupUnavailable,
};
