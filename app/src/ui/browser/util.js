// Small helpers of the reading browser: address parsing, search engines, hosts, tracking parameters, dates.

export const SEARCH_ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s&kl=de-de' },
  ddglite: { name: 'DuckDuckGo Lite', url: 'https://lite.duckduckgo.com/lite/?q=%s&kl=de-de' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s&language=deutsch' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s&hl=de' },
  wikipedia: { name: 'Wikipedia', url: 'https://de.wikipedia.org/w/index.php?search=%s' },
};

/** Sites offered on an empty start page. */
export const SUGGESTIONS = [
  { url: 'https://de.wikipedia.org/wiki/Wikipedia:Hauptseite', title: 'Wikipedia' },
  { url: 'https://www.tagesschau.de/', title: 'tagesschau.de' },
  { url: 'https://www.deutschlandfunk.de/', title: 'Deutschlandfunk' },
  { url: 'https://www.spektrum.de/', title: 'Spektrum der Wissenschaft' },
  { url: 'https://www.projekt-gutenberg.org/', title: 'Projekt Gutenberg-DE' },
  { url: 'https://www.zeno.org/', title: 'Zeno.org' },
  { url: 'https://de.wikisource.org/wiki/Hauptseite', title: 'Wikisource' },
  { url: 'https://www.perlentaucher.de/', title: 'Perlentaucher' },
  { url: 'https://www.bpb.de/', title: 'Bundeszentrale für politische Bildung' },
  { url: 'https://www.gutenberg.org/', title: 'Project Gutenberg' },
];

const TRACKING = /^(utm_[a-z_]+|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|_hsenc|_hsmi|mkt_tok|yclid|ysclid|twclid|ttclid|li_fat_id|s_cid|wt_mc|wt_zmc|ref_src|xtor)$/i;

export const isWeb = (u) => /^https?:\/\//i.test(String(u || ''));

// Map applications (Google Maps with Street View, Google Earth, OpenStreetMap) fill the page and use the keys, the
// mouse wheel and WebGL themselves: page turning, reader mode, page styles and the consent heuristics stay out of them.
const APP_PAGES = [
  /^https:\/\/(www\.)?google\.[a-z.]{2,6}\/maps(\/|\?|#|$)/i,
  /^https:\/\/maps\.google\.[a-z.]{2,6}\//i,
  /^https:\/\/earth\.google\.com\//i,
  /^https:\/\/(www\.)?openstreetmap\.(org|de)\//i,
];
export const isAppPage = (u) => APP_PAGES.some((re) => re.test(String(u || '')));

/** Text from the address field → { url } for an address, { url, query } for a search, or null. */
export function parseInput(raw, engineId = 'duckduckgo') {
  const q = String(raw || '').trim();
  if (!q) return null;
  if (isWeb(q)) { try { return { url: new URL(q).href }; } catch { return null; } }
  // everything that is neither http(s) nor a host name becomes a search: javascript:, file:, data: … are never opened
  if (!/\s/.test(q) && (/^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(q) || /^localhost(:\d+)?([/?#]|$)/i.test(q) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/.test(q))) {
    try { return { url: new URL('https://' + q).href }; } catch { /* fall through to search */ }
  }
  const engine = SEARCH_ENGINES[engineId] || SEARCH_ENGINES.duckduckgo;
  return { url: engine.url.replace('%s', encodeURIComponent(q)), query: q };
}

export function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
export function originOf(u) { try { return new URL(u).origin; } catch { return ''; } }

/** URL without tracking parameters (bookmarks, reading list and history keep the clean form). */
export function cleanUrl(u) {
  try {
    const url = new URL(u);
    let changed = false;
    for (const k of [...url.searchParams.keys()]) if (TRACKING.test(k)) { url.searchParams.delete(k); changed = true; }
    return changed ? url.href : u;
  } catch { return u; }
}

/** Same page, independent of the fragment and a trailing slash. */
export function samePage(a, b) {
  const k = (u) => String(u || '').split('#')[0].replace(/\/$/, '');
  return !!a && !!b && k(a) === k(b);
}

/** Address shown in the field: the full URL, without the "https://" noise. */
export function displayUrl(u) {
  if (!u) return '';
  return String(u).replace(/^https:\/\//i, '').replace(/\/$/, '');
}

export function monogram(title, url) {
  const src = (hostOf(url) || title || '?').replace(/^(de|en|m|mobile)\./, '');
  return (src.match(/[\p{L}\p{N}]/u)?.[0] || '?').toUpperCase();
}

/** "gerade eben", "vor 5 Min.", "gestern", "12. Sept." */
export function relTime(ts, lang = 'de') {
  if (!ts) return '';
  const d = Date.now() - ts;
  const de = lang !== 'en';
  if (d < 60000) return de ? 'gerade eben' : 'just now';
  if (d < 3600000) return de ? `vor ${Math.round(d / 60000)} Min.` : `${Math.round(d / 60000)} min ago`;
  const date = new Date(ts), now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString(de ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (date.toDateString() === y.toDateString()) return de ? 'gestern' : 'yesterday';
  return date.toLocaleDateString(de ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'short', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Rejects after `ms` (webview calls can hang when a guest is torn down). */
export function withTimeout(p, ms, msg = 'Zeitüberschreitung') {
  let t;
  return Promise.race([Promise.resolve(p).finally(() => clearTimeout(t)), new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]);
}

/** File extension of a download offer that can go onto the shelf. */
export function shelfFormat(name, mime) {
  const ext = (/\.([a-z0-9]{2,5})(?:$|\?)/i.exec(String(name || '')) || [])[1]?.toLowerCase();
  if (ext && ['pdf', 'epub', 'mobi', 'azw3', 'fb2', 'txt', 'cbz', 'djvu'].includes(ext)) return ext;
  if (/pdf/i.test(mime || '')) return 'pdf';
  if (/epub/i.test(mime || '')) return 'epub';
  return null;
}

/** "2,4 MB" in German, "2.4 MB" in English (the decimal comma used to be fixed). */
export function formatBytes(n, lang = 'de') {
  if (!n) return '';
  if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
  return (n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0).replace('.', decimal(lang)) + ' MB';
}
/** The decimal separator of the interface language. */
export const decimal = (lang = 'de') => (lang === 'en' ? '.' : ',');
