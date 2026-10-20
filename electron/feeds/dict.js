// Dictionary & translation: Wiktionary (en REST definition endpoint + de.wiktionary parse) and MyMemory translation.
const path = require('path');
const C = require('./common');

const opts = (extra = {}) => ({ ua: C.WIKI_UA, headers: { 'Api-User-Agent': C.WIKI_UA, ...extra }, timeout: 15000 });
const DICT_TTL = 7 * 24 * 3600 * 1000;

const POS_DE = { Substantiv: 'noun', Verb: 'verb', Adjektiv: 'adjective', Adverb: 'adverb', Pronomen: 'pronoun', Präposition: 'preposition', Konjunktion: 'conjunction', Interjektion: 'interjection', Artikel: 'article', Numerale: 'numeral', Partikel: 'particle' };

/** Parse the en.wiktionary REST definition response for a given language section ('en' | 'de' | …). */
function parseWiktionaryDefinition(json, section) {
  const secs = json && json[section];
  if (!Array.isArray(secs)) return [];
  const clean = (html) => C.htmlToText(String(html || '').replace(/<a[^>]*>/g, '').replace(/<\/a>/g, ''));
  return secs.map((s) => ({
    partOfSpeech: s.partOfSpeech || '', language: s.language || null,
    definitions: (s.definitions || []).map((d) => ({ definition: clean(d.definition), examples: (d.parsedExamples || []).map((x) => clean(x.example)).concat((d.examples || []).map(clean)).filter(Boolean).slice(0, 4) })).filter((d) => d.definition),
  })).filter((s) => s.definitions.length);
}

/** Extract "Bedeutungen" (and examples) from a de.wiktionary rendered page (action=parse&prop=text). */
function parseDeWiktionaryHtml(html) {
  const doc = C.parseHtml(html);
  const entries = [];
  let current = null;
  const flush = () => { if (current && current.definitions.length) entries.push(current); current = null; };
  const nodes = [...doc.body.querySelectorAll('h2, h3, p, dl')];
  for (const el of nodes) {
    const tag = el.tagName;
    if (tag === 'H2') { flush(); const t = C.collapseWs(el.textContent); if (!/\(Deutsch\)|Deutsch/.test(t) && entries.length) break; continue; }
    if (tag === 'H3') { flush(); const t = C.collapseWs(el.textContent.replace(/\[Bearbeiten.*$/, '')); current = { partOfSpeech: t, partOfSpeechEn: POS_DE[t.split(/[,\s]/)[0]] || null, definitions: [], examples: [], synonyms: [] }; continue; }
    if (!current) continue;
    if (tag === 'P') {
      const label = C.collapseWs(el.textContent).replace(/:$/, '');
      if (/^(Bedeutungen|Beispiele|Synonyme|Herkunft|Gegenwörter)$/.test(label)) { current._mode = label; continue; }
      if (/^(Wortbildungen|Charakteristische Wortkombinationen|Übersetzungen|Referenzen|Oberbegriffe|Unterbegriffe|Redewendungen|Sprichwörter|Abkürzungen|Aussprache|Worttrennung|Anmerkung|Sinnverwandte Wörter|Weibliche Wortformen|Männliche Wortformen|Verkleinerungsformen|Kurzformen)$/.test(label)) current._mode = null;
      continue;
    }
    if (tag === 'DL' && current._mode) {
      const items = [...el.querySelectorAll('dd')].map((dd) => C.collapseWs(dd.textContent)).filter(Boolean);
      if (current._mode === 'Bedeutungen') for (const it of items) { const m = /^\[([\d,\s–a-z]+)\]\s*(.*)$/.exec(it); current.definitions.push({ index: m ? m[1] : null, definition: m ? m[2] : it, examples: [] }); }
      else if (current._mode === 'Beispiele') for (const it of items) { const m = /^\[([\d,\s–a-z]+)\]\s*(.*)$/.exec(it); const idx = m ? m[1].split(/[,\s]+/)[0] : null; const def = current.definitions.find((d) => d.index && d.index.split(/[,\s]+/)[0] === idx) || current.definitions[0]; if (def && def.examples.length < 3) def.examples.push(m ? m[2] : it); }
      else if (current._mode === 'Synonyme') for (const it of items) current.synonyms.push(it.replace(/^\[[^\]]*\]\s*/, ''));
      current._mode = current._mode === 'Bedeutungen' ? null : current._mode; // definitions come in one <dl>
    }
  }
  flush();
  return entries.map((e) => { delete e._mode; return e; });
}

function parseMyMemory(json) {
  const t = json?.responseData?.translatedText;
  if (!t || json.responseStatus && String(json.responseStatus) !== '200') throw new Error(json?.responseDetails || 'translation failed');
  const alt = (json.matches || []).filter((m) => m.translation && m.translation !== t).slice(0, 3).map((m) => ({ text: m.translation, quality: m.quality, source: m['created-by'] }));
  return { translated: C.collapseWs(C.htmlToText(t)), match: json.responseData.match, alternatives: alt, source: 'mymemory' };
}

function register(ctx) {
  const { ipcMain, app, settings } = ctx;
  const cache = new C.DiskCache(path.join(app.getPath('userData'), 'feeds-cache', 'dict'), { memoryLimit: 200 });

  ipcMain.handle('dict:define', async (e, word, lang) => {
    word = String(word || '').trim().replace(/[.,;:!?"'()\[\]«»„“”]+$/g, '').replace(/^[.,;:!?"'()\[\]«»„“”]+/g, '');
    lang = (lang || 'de').toLowerCase().slice(0, 2);
    if (!word) return null;
    const key = `def-${lang}-${C.shortId(word.toLowerCase(), 16)}`;
    const c = cache.get(key);
    if (c && Date.now() - c.at < DICT_TTL) return c.data;
    const result = { word, lang, entries: [], glosses: [], source: [], errors: [] };
    const variants = [word, word.toLowerCase(), word[0].toUpperCase() + word.slice(1)].filter((v, i, a) => a.indexOf(v) === i);
    // 1) en.wiktionary REST definition – gives English definitions ('en') or English glosses of German words ('de')
    for (const v of variants) {
      try {
        const j = await C.fetchJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(v)}?redirect=true`, opts());
        const sec = parseWiktionaryDefinition(j, lang);
        if (sec.length) { if (lang === 'en') result.entries = sec; else result.glosses = sec; result.source.push('en.wiktionary'); result.word = v; break; }
        // English word looked up while in German mode (or vice versa): still show what we have
        const other = parseWiktionaryDefinition(j, lang === 'en' ? 'de' : 'en');
        if (other.length) { if (lang === 'en') result.glosses = other; else result.entries = other; result.source.push('en.wiktionary'); result.word = v; break; }
      } catch (err) { if (!/HTTP 404/.test(err.message)) result.errors.push(err.message); }
    }
    // 2) German: de.wiktionary page with "Bedeutungen"
    if (lang === 'de') {
      for (const v of variants) {
        try {
          const j = await C.fetchJson(`https://de.wiktionary.org/w/api.php?action=parse&format=json&formatversion=2&prop=text&redirects=1&disabletoc=1&disableeditsection=1&page=${encodeURIComponent(v)}`, opts());
          if (j.error) continue;
          const entries = parseDeWiktionaryHtml(j.parse?.text || '');
          if (entries.length) { result.entries = entries; result.source.push('de.wiktionary'); result.word = j.parse?.title || v; break; }
        } catch (err) { result.errors.push(err.message); }
      }
    }
    if (!result.entries.length && !result.glosses.length) { result.notFound = true; return result; }
    cache.set(key, result);
    return result;
  });

  ipcMain.handle('dict:translate', async (e, text, from, to) => {
    text = String(text || '').trim().slice(0, 500);
    from = (from || 'de').toLowerCase().slice(0, 2); to = (to || (from === 'de' ? 'en' : 'de')).toLowerCase().slice(0, 2);
    if (!text) return null;
    const key = `tr-${from}-${to}-${C.shortId(text, 20)}`;
    const c = cache.get(key);
    if (c && Date.now() - c.at < DICT_TTL) return c.data;
    let res;
    const libre = settings?.get?.('translate')?.libreUrl;
    try {
      const j = await C.fetchJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`, { timeout: 15000 });
      res = { text, from, to, ...parseMyMemory(j) };
    } catch (err) {
      if (!libre) throw err;
      const r = await C.fetchText(libre.replace(/\/$/, '') + '/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: text, source: from, target: to, format: 'text', api_key: settings.get('translate')?.libreKey || '' }) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = JSON.parse(r.text);
      res = { text, from, to, translated: j.translatedText, alternatives: [], source: 'libretranslate' };
    }
    cache.set(key, res);
    return res;
  });
}

module.exports = { register, parseWiktionaryDefinition, parseDeWiktionaryHtml, parseMyMemory };
