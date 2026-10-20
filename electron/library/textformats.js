// Plain text and metadata from RTF and DOCX files (main process).
//
// The reader gets RTF as text (library:readText) and DOCX as HTML (mammoth); the indexer window
// cannot open either format, so the text sample, language, page estimate and metadata of these books
// come from here.
const fs = require('fs');

/* ------------------------------------------------------------------ RTF ---- */

// destinations whose content is never text
const SKIP_DEST = new Set(['fonttbl', 'colortbl', 'stylesheet', 'listtable', 'listoverridetable', 'revtbl', 'rsidtbl', 'generator',
  'pict', 'object', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'footnote', 'fldinst',
  'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'xmlnstbl', 'pgdsctbl', 'filetbl', 'mmathPr', 'wgrffmtfilter', 'bkmkstart', 'bkmkend']);
const INFO_FIELDS = new Set(['title', 'author', 'subject', 'keywords', 'doccomm', 'company']);
const SYMBOLS = { emdash: '—', endash: '–', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', bullet: '•', emspace: ' ', enspace: ' ', qmspace: ' ', tab: '\t', line: '\n' };

/** Windows-1252 bytes 0x80–0x9F (the rest of the range is Latin-1). */
const CP1252 = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' };
const cp1252 = (byte) => CP1252[byte] || String.fromCharCode(byte);

/**
 * RTF → { text, info: { title, author, … } }. Handles nested groups, \'hh escapes (cp1252), \uN with \ucN
 * fallback skipping, paragraph and line breaks, and ignores font/colour/style tables, pictures and fields.
 * @param {string} raw  the file read as latin1 (every byte one char)
 */
function rtfToText(raw) {
  const s = String(raw || '');
  let out = '';
  const info = {};
  let infoText = '';
  // group state: skip (ignore text), uc (fallback chars after \u), info field
  const stack = [];
  let state = { skip: false, uc: 1, info: null, infoGroup: false };
  let pendingSkip = 0;                 // fallback characters still to drop after a \uN
  const emit = (t) => {
    if (pendingSkip > 0) { const n = Math.min(pendingSkip, t.length); pendingSkip -= n; t = t.slice(n); if (!t) return; }
    if (state.skip) return;
    if (state.info) { infoText += t; return; }
    if (state.infoGroup) return;          // {\info …} holds metadata only, never body text
    out += t;
  };
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '{') {
      stack.push(state); state = { ...state };
      i++;
      // {\*\dest …} is an optional destination: skip it unless we know it (we know none worth keeping)
      if (s.startsWith('\\*', i)) state.skip = true;
      continue;
    }
    if (c === '}') {
      if (state.info && !stack[stack.length - 1]?.info) { info[state.info] = infoText.trim(); infoText = ''; }
      state = stack.pop() || { skip: false, uc: 1, info: null, infoGroup: false };
      pendingSkip = 0;
      i++;
      continue;
    }
    if (c === '\\') {
      const nx = s[i + 1];
      if (nx === '\\' || nx === '{' || nx === '}') { emit(nx); i += 2; continue; }
      if (nx === '\'') { const hex = s.substr(i + 2, 2); const b = parseInt(hex, 16); if (Number.isFinite(b)) emit(cp1252(b)); i += 4; continue; }
      if (nx === '~') { emit('\u00a0'); i += 2; continue; }
      if (nx === '-') { i += 2; continue; }                 // optional hyphen
      if (nx === '_') { emit('\u2011'); i += 2; continue; }  // non-breaking hyphen
      if (nx === '*') { state.skip = true; i += 2; continue; }
      if (nx === '\r' || nx === '\n') { emit('\n'); i += 2; continue; }
      const m = /^([a-zA-Z]{1,32})(-?\d{1,10})? ?/.exec(s.slice(i + 1, i + 48));
      if (!m) { i += 2; continue; }
      const word = m[1]; const arg = m[2] != null ? parseInt(m[2], 10) : null;
      i += 1 + m[0].length;
      if (SKIP_DEST.has(word)) { state.skip = true; continue; }
      if (word === 'info') { state.infoGroup = true; continue; }
      if (INFO_FIELDS.has(word)) { state.info = word; infoText = ''; continue; }
      if (word === 'uc') { state.uc = arg ?? 1; continue; }
      if (word === 'u') { let code = arg ?? 0; if (code < 0) code += 65536; emit(String.fromCharCode(code)); pendingSkip = state.uc; continue; }
      if (word === 'par' || word === 'sect' || word === 'page') { emit('\n'); continue; }
      if (word === 'row') { emit('\n'); continue; }
      if (word === 'cell') { emit('\t'); continue; }
      if (SYMBOLS[word] != null) { emit(SYMBOLS[word]); continue; }
      continue;                                              // formatting control word: no text
    }
    if (c === '\r' || c === '\n') { i++; continue; }          // raw line breaks carry no meaning in RTF
    // plain run up to the next special character
    let j = i;
    while (j < n && s[j] !== '\\' && s[j] !== '{' && s[j] !== '}' && s[j] !== '\r' && s[j] !== '\n') j++;
    emit(s.slice(i, j));
    i = j;
  }
  const text = out.replace(/[ \t\u00a0]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, info };
}

/* ----------------------------------------------------------------- DOCX ---- */

const xmlText = (xml, tag) => {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml || '');
  return m ? m[1].replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim() : '';
};

/** Core properties of a DOCX (docProps/core.xml): title, creator, language, subject, keywords. */
async function docxInfo(file) {
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const core = await zip.file('docProps/core.xml')?.async('string');
    if (!core) return {};
    return { title: xmlText(core, 'dc:title'), author: xmlText(core, 'dc:creator'), language: xmlText(core, 'dc:language'), subject: xmlText(core, 'dc:subject'), keywords: xmlText(core, 'cp:keywords') };
  } catch { return {}; }
}

/**
 * Text sample + metadata for the formats the indexer window cannot read.
 * @returns {Promise<{ text: string, metadata: object } | null>}
 */
async function extractTextAndMeta(file, format) {
  if (format === 'rtf') {
    const { text, info } = rtfToText(fs.readFileSync(file, 'latin1'));
    return { text, metadata: { title: info.title || '', author: info.author || '', subjects: splitKeywords(info.keywords), description: info.subject || info.doccomm || '' } };
  }
  if (format === 'docx') {
    const mammoth = require('mammoth');
    const [raw, meta] = await Promise.all([mammoth.extractRawText({ path: file }).catch(() => ({ value: '' })), docxInfo(file)]);
    return { text: String(raw.value || '').replace(/\n{3,}/g, '\n\n').trim(), metadata: { title: meta.title || '', author: meta.author || '', language: (meta.language || '').slice(0, 2).toLowerCase(), subjects: splitKeywords(meta.keywords), description: meta.subject || '' } };
  }
  return null;
}
const splitKeywords = (s) => String(s || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean).slice(0, 20);

module.exports = { rtfToText, docxInfo, extractTextAndMeta };
