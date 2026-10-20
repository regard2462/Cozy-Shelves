// Checks the language tag of every paper in the feed list (electron/feeds/feedlist.js): every feed is fetched once
// (four at a time), the language of its titles and summaries is recognised by function words and compared with the
// tag and with the <language> the feed declares. Writes electron/feeds/fixtures/feed-languages.json, which the unit
// tests (electron/feeds/test-feeds.js) compare with the list.
//   node build/feeds-lang-audit.js            needs the network; prints one line per feed and a summary
'use strict';
const fs = require('fs');
const path = require('path');
const { FEEDS } = require('../electron/feeds/feedlist');

const UA = 'CozyShelves/0.7 (feed language check)';
const WORDS = {
  de: 'der die das und ist nicht mit sich auf für den dem des ein eine einer eines im zu von wie auch bei nach aus über wird werden hat haben sind war wurde noch nur einem sie er es wir ich',
  en: 'the and of to in is that for on with as was are be by this from at it an have has not but which their its will been were who they you more after',
  fr: 'le la les et des une est du pour dans que qui sur pas au avec ce il elle sont aux par plus',
  es: 'el los las y en un una es por con para del se no lo como más pero sus',
  it: 'il di che e per un una sono del della non con gli le si nel alla',
  nl: 'het een en van dat op te met voor niet zijn ook bij om naar maar',
};
const SETS = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v.split(' '))]));

/** The language of a text by its function words: { lang, scores, words } (lang null when unclear). */
function detect(text) {
  const tokens = String(text || '').toLowerCase().replace(/<[^>]+>/g, ' ').split(/[^\p{L}]+/u).filter(Boolean);
  const scores = Object.fromEntries(Object.keys(SETS).map((k) => [k, 0]));
  for (const t of tokens) for (const [k, s] of Object.entries(SETS)) if (s.has(t)) scores[k]++;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  const lang = best[1] >= 8 && best[1] >= 2 * second[1] ? best[0] : null;
  return { lang, scores, words: tokens.length };
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, application/json;q=0.8, */*;q=0.5' }, signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(timer); }
}

/** The readable text of a feed: titles and summaries of the items (RSS, Atom, the tagesschau API). */
function textOf(body, feed) {
  if (feed.type === 'tagesschau') {
    try { const j = JSON.parse(body); return (j.news || []).map((n) => `${n.title || ''}. ${n.firstSentence || ''}`).join(' '); } catch { return ''; }
  }
  const parts = [];
  for (const m of body.matchAll(/<(title|description|summary|content:encoded)[^>]*>([\s\S]*?)<\/\1>/gi)) parts.push(m[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;[\s\S]*?&gt;/g, ' '));
  return parts.join(' ').slice(0, 60000);
}
const declaredOf = (body) => ((/<language>\s*([a-z]{2})/i.exec(body) || /<feed[^>]*xml:lang="([a-z]{2})/i.exec(body) || [])[1] || '').toLowerCase() || null;

(async () => {
  const out = {};
  const queue = [...FEEDS];
  let bad = 0, unclear = 0, failed = 0;
  async function worker() {
    while (queue.length) {
      const f = queue.shift();
      try {
        const body = await fetchText(f.url);
        const d = detect(textOf(body, f));
        const declared = f.type === 'tagesschau' ? 'de' : declaredOf(body);
        out[f.id] = { tag: f.lang, detected: d.lang, declared, words: d.words };
        const ok = d.lang ? d.lang === f.lang : true;
        if (!d.lang) unclear++;
        if (!ok) bad++;
        console.log(`${ok ? (d.lang ? 'OK     ' : 'UNCLEAR') : 'WRONG  '} ${f.id.padEnd(22)} tag=${f.lang} detected=${d.lang || '-'} declared=${declared || '-'} ${JSON.stringify(d.scores)}`);
      } catch (e) {
        failed++;
        out[f.id] = { tag: f.lang, detected: null, declared: null, error: String(e.message || e) };
        console.log(`FAILED  ${f.id.padEnd(22)} tag=${f.lang} ${e.message}`);
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  const file = path.join(__dirname, '..', 'electron', 'feeds', 'fixtures', 'feed-languages.json');
  const sorted = Object.fromEntries(FEEDS.map((f) => [f.id, out[f.id]]));
  fs.writeFileSync(file, JSON.stringify({ checked: new Date().toISOString().slice(0, 10), feeds: sorted }, null, 1));
  console.log(`FEEDS-LANG ${FEEDS.length} feeds · ${bad} wrong · ${unclear} unclear · ${failed} not reachable → ${path.relative(process.cwd(), file)}`);
})();

module.exports = { detect };
