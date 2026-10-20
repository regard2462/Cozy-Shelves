// "Webseite als Buch lesen": paste any URL – the page is extracted with Readability, multi-page texts are
// followed via "weiter"/next links, and the result can be read at once or saved as EPUB into the library.
// Also a small list of free German/English portals (bpb, Zeno, Gutenberg-DE …) to open in the reader/browser.
'use strict';
const U = require('./util');

// `feed`  – an RSS/Atom feed whose entries are the real articles (bpb renders its lists client-side,
//           so the landing page alone yields nothing readable)
// `index` – the page is a directory: its sub-pages become the chapters (readable.js index mode)
const PORTALS = [
  { title: 'bpb: Aus Politik und Zeitgeschichte (APuZ)', url: 'https://www.bpb.de/shop/zeitschriften/apuz/', feed: 'https://www.bpb.de/rss-feed/230868.rss', author: 'Bundeszentrale für politische Bildung', description: { de: 'Die Zeitschrift der bpb. Die aktuellen Ausgaben werden als Sammelband aufgeschlagen, jede Ausgabe gibt es zusätzlich kostenlos als PDF und EPUB.', en: 'The bpb journal – the current issues are opened as one volume; every issue is also free as PDF and EPUB.' }, lang: 'de' },
  { title: 'bpb: Hintergrund aktuell', url: 'https://www.bpb.de/kurz-knapp/hintergrund-aktuell/', feed: 'https://www.bpb.de/rss-feed/230153.rss', author: 'Bundeszentrale für politische Bildung', description: { de: 'Erklärstücke zu aktuellen politischen Ereignissen, als Sammelband lesbar.', en: 'Explainers on current political events – readable as one volume.' }, lang: 'de' },
  { title: 'bpb: Neue Publikationen', url: 'https://www.bpb.de/shop/buecher/schriftenreihe/', feed: 'https://www.bpb.de/rss-feed/62409.rss', author: 'Bundeszentrale für politische Bildung', description: { de: 'Sachbücher zu Politik, Geschichte und Gesellschaft, viele Titel kostenlos als PDF oder EPUB.', en: 'Non-fiction on politics, history and society; many titles free as PDF/EPUB.' }, lang: 'de' },
  { title: 'bpb: Dossiers', url: 'https://www.bpb.de/themen/', index: true, author: 'Bundeszentrale für politische Bildung', description: { de: 'Themen-Dossiers zu Politik und Zeitgeschichte. Die Dossierseiten werden zu einem Band zusammengefügt.', en: 'Topic dossiers on politics and contemporary history – the dossier pages are stitched into one volume.' }, lang: 'de' },
  { title: 'Projekt Gutenberg-DE', url: 'https://projekt-gutenberg.org/bibliothek/meistgelesen/', index: true, author: 'Projekt Gutenberg-DE', description: { de: 'Deutschsprachige Klassiker. Am besten über die eigene Schublade »Projekt Gutenberg-DE« suchen.', en: 'German classics – best searched in the dedicated “Projekt Gutenberg-DE” drawer.' }, lang: 'de' },
  { title: 'Zeno.org', url: 'http://www.zeno.org/Literatur', index: true, author: 'Zeno.org', description: { de: 'Volltextbibliothek für Literatur, Philosophie und Geschichte (die Seite kennt kein HTTPS).', en: 'Full-text library for literature, philosophy and history (the site speaks plain HTTP only).' }, lang: 'de' },
  { title: 'Deutsches Textarchiv', url: 'https://www.deutschestextarchiv.de/', author: 'BBAW', description: { de: 'Historische deutsche Texte 1600–1900, wissenschaftlich ediert.', en: 'Historical German texts 1600–1900, scholarly editions.' }, lang: 'de' },
  { title: 'Marxists Internet Archive (deutsch)', url: 'https://www.marxists.org/deutsch/', index: true, author: 'marxists.org', description: { de: 'Werke von Marx, Engels, Luxemburg u. a. im Volltext.', en: 'Works by Marx, Engels, Luxemburg and others in full text.' }, lang: 'de' },
  { title: 'Perseus Digital Library', url: 'https://www.perseus.tufts.edu/hopper/', author: 'Tufts University', description: { de: 'Griechische und lateinische Klassiker mit Übersetzungen.', en: 'Greek and Latin classics with translations.' }, lang: 'en' },
  { title: 'Sacred Texts', url: 'https://sacred-texts.com/', author: 'sacred-texts.com', description: { de: 'Religiöse und mythologische Texte der Welt.', en: 'Religious and mythological texts of the world.' }, lang: 'en' },
  { title: 'Gallica', url: 'https://gallica.bnf.fr/', author: 'Bibliothèque nationale de France', description: { de: 'Digitalisate der französischen Nationalbibliothek.', en: 'Digitised collections of the French national library.' }, lang: 'en' },
  { title: 'Deutsche Digitale Bibliothek', url: 'https://www.deutsche-digitale-bibliothek.de/', author: 'DDB', description: { de: 'Das Portal zu Kultur und Wissen in Deutschland.', en: 'The German portal to culture and knowledge.' }, lang: 'de' },
  { title: 'Münchener DigitalisierungsZentrum', url: 'https://www.digitale-sammlungen.de/', author: 'Bayerische Staatsbibliothek', description: { de: 'Digitalisierte historische Bücher der BSB.', en: 'Digitised historical books of the Bavarian State Library.' }, lang: 'de' },
];

const isUrl = (s) => /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(String(s || '').trim());

const source = {
  id: 'web', name: 'Webseite als Buch', icon: '🌐', kind: 'books', lang: ['de', 'en'], canSearch: true, urlInput: true,
  description: { de: 'Beliebige Adresse einfügen. Der Text der Seite wird herausgelöst, mehrseitige Werke (»weiter«-Links) werden zusammengefügt. Lesen oder als EPUB ins Regal stellen.', en: 'Paste any address: the page text is extracted, multi-page works ("next" links) are stitched together – read now or shelve as EPUB.' },
  chips: [
    { id: 'portals', label: { de: 'Freie Portale', en: 'Free portals' } },
    { id: 'de', label: { de: 'Deutsch', en: 'German' } },
    { id: 'en', label: { de: 'International', en: 'International' } },
  ],

  async search(query) {
    const q = String(query || '').trim();
    if (!q) return U.result([], { page: 1, hasMore: false });
    if (!isUrl(q)) return U.result([], { page: 1, hasMore: false, note: 'Bitte eine Web-Adresse eingeben (z. B. https://www.bpb.de/…).' });
    const url = /^https?:\/\//i.test(q) ? q : 'https://' + q;
    let host = url; try { host = new URL(url).hostname; } catch {}
    return U.result([toItem({ title: url.replace(/^https?:\/\//, ''), url, author: host, description: 'Die Seite mit »Jetzt lesen« als Buch aufschlagen. Der Titel wird beim Laden ermittelt.', follow: true })], { page: 1, hasMore: false });
  },
  async browse(browseId) {
    const list = PORTALS.filter((p) => browseId === 'portals' || !browseId || p.lang === browseId);
    return U.result(list.map((p) => toItem({ ...p, description: p.description.de + ' / ' + p.description.en, follow: false })), { page: 1, hasMore: false });
  },
};

function toItem({ title, url, author, description, follow, lang, index, feed, cover }) {
  return U.mkItem('web', url, {
    title, author, language: lang || null, description, cover: cover || null,
    formats: [{ type: 'epub', url: 'build://epub', label: 'EPUB (aus der Seite erzeugt)' }, { type: 'html', url, label: 'HTML' }],
    readOnlineUrl: url, license: null, canRead: true, kind: 'web',
    meta: { web: true, url, follow: follow !== false, index: !!index, feed: feed || null },
  });
}

module.exports = { ...source, toItem, PORTALS, isUrl };
