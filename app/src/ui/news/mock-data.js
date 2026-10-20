// Fixture data for the browser dev harness (api-mock.js) – feeds, articles, podcasts, wikipedia, dictionary.
// Only used when window.api is absent (dev.html / dev-shot.js). Images are inline SVGs so no network is needed.
import { CATEGORIES, FEEDS } from '../../../../electron/feeds/feedlist.js';

const svgImage = (seed, w = 800, h = 500) => {
  const hues = [[28, 60], [200, 30], [90, 35], [340, 40], [45, 70], [160, 30], [260, 25], [15, 45]];
  const [h1, s1] = hues[seed % hues.length]; const h2 = (h1 + 40) % 360;
  const shapes = Array.from({ length: 5 }, (_, i) => { const r = ((seed * 7 + i * 13) % 50) + 30; const cx = ((seed * 31 + i * 97) % w); const cy = ((seed * 17 + i * 53) % h); return `<circle cx="${cx}" cy="${cy}" r="${r * 2}" fill="hsla(${(h1 + i * 25) % 360},${s1}%,${45 + i * 6}%,0.35)"/>`; }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1},${s1}%,38%)"/><stop offset="1" stop-color="hsl(${h2},${s1}%,62%)"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>${shapes}<rect x="0" y="${h * 0.7}" width="${w}" height="${h * 0.3}" fill="rgba(20,10,0,0.25)"/></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
};

const DE = [
  ['Chatkontrolle: Warum das Ende der Verschlüsselung alle betrifft', 'Die EU-Kommission will Messenger verpflichten, private Nachrichten auf verbotene Inhalte zu durchsuchen. Was das technisch bedeutet und warum Fachleute warnen.', 'Lena Brandau'],
  ['Bundestag debattiert über den Haushalt 2027', 'Mit einer Generaldebatte hat der Bundestag die Beratungen über den Haushalt 2027 begonnen. Der Etatentwurf sieht Ausgaben von 512 Milliarden Euro vor.', null],
  ['Die Alpengletscher verlieren ihr Eis schneller als gedacht', 'Neue Messungen zeigen: Viele Gletscher haben allein im vergangenen Sommer drei Meter Dicke verloren, ein Rekordwert.', 'Lena Hofer'],
  ['Wie die Deutsche Bahn den Winter überstehen will', 'Nach dem Chaos des vergangenen Jahres verspricht der Konzern mehr Personal, mehr Enteiser und einen Notfahrplan. Ob das reicht, ist fraglich.', 'Jonas Weber'],
  ['Kunsthalle zeigt vergessene Malerinnen des Expressionismus', 'Die Ausstellung „Unsichtbar“ holt 40 Künstlerinnen aus dem Depot – und stellt die Kanonfrage neu.', 'Maria Steinbach'],
  ['EZB lässt Leitzins unverändert', 'Die Europäische Zentralbank belässt den Einlagensatz bei 2,0 Prozent. Beobachter rechnen erst im Frühjahr mit einer weiteren Senkung.', null],
  ['Titelverteidigerin gewinnt die Schnellschach-Meisterschaft', 'Im Tiebreak behielt die Favoritin die Nerven. Ein Bericht aus der Halle.', 'Paul Seidel'],
  ['Warum wir wieder mehr Zeit in Bibliotheken verbringen', 'Die Besucherzahlen öffentlicher Bibliotheken steigen seit drei Jahren. Ein Essay über Stille, Gemeinschaft und die Sehnsucht nach analogen Orten.', 'Katrin Brandt'],
];
const EN = [
  ['The first e-ink monitor that doesn\'t make me want to throw it out the window', 'After a month with the newest generation of paper-like displays, I finally understand who this thing is for.', 'Sam Holloway'],
  ['Why the Baltic Sea is turning into a dead zone', 'Decades of fertilizer have created one of the largest human-made dead zones on Earth. The recovery will take generations.', 'Iris Lowell'],
  ['Inside the quiet revival of the neighbourhood library', 'Visitor numbers are up across Europe. What are people looking for?', 'Ruth Kane'],
  ['A new theory of why we dream', 'Neuroscientists propose that dreaming keeps the visual cortex from being colonised by other senses during the long dark of sleep.', 'Nora Castell'],
  ['Central banks hold steady as markets wait for clarity', 'The ECB and the Fed both paused this week. Investors are unsure whether the next move is up or down.', null],
  ['The chess boom is not over – it just moved online', 'Five years after the pandemic surge, membership at online chess platforms keeps climbing.', 'Leon Walsh'],
  ['How to build a house that lasts five hundred years', 'A Japanese timber technique is finding new fans among European architects.', 'Oliver Wade'],
  ['The dead-simple security habit most people skip', 'Passkeys are finally everywhere. Here is why you should switch this weekend.', 'Brian Kessler'],
];
const PARAS_DE = [
  'Die Verhandlungen gehen in die entscheidende Runde. Seit mehr als drei Jahren ringen Kommission, Parlament und Rat der Europäischen Union um eine Verordnung, die weitreichende Folgen für Millionen Menschen hätte. Was zunächst nach einem nachvollziehbaren Ziel klingt, entpuppt sich bei näherem Hinsehen als tiefer Eingriff in Grundrechte.',
  'Fachleute warnen seit Jahren. In einem offenen Brief, den mehr als 300 Wissenschaftlerinnen und Wissenschaftler unterzeichnet haben, heißt es, eine solche Infrastruktur werde „zwangsläufig missbraucht“ – sei es durch Kriminelle, die Schwachstellen ausnutzen, oder durch Regierungen, die den Katalog der gesuchten Inhalte erweitern.',
  'Selbst wenn man die grundsätzlichen Bedenken beiseiteschiebt, bleibt ein praktisches Problem: die Fehlerquote. Bei Milliarden Vorgängen pro Tag führt selbst eine Trefferquote von 99,9 Prozent zu Millionen falscher Meldungen. Die Schweizer Bundespolizei berichtete, dass rund 80 Prozent der automatisch generierten Meldungen nicht relevant waren.',
  'Die Bundesregierung hatte sich im Koalitionsvertrag festgelegt. Ob diese Position Bestand hat, entscheidet sich in den kommenden Wochen. Beobachter rechnen damit, dass die Ratspräsidentschaft einen weiteren Kompromissvorschlag vorlegen wird, der die Maßnahmen zunächst beschränkt.',
  'Für die Bürgerinnen und Bürger ändert das wenig: Auch eine eingeschränkte Variante setzt voraus, dass eine Software auf jedem Gerät mitliest. Und wer einmal eine solche Infrastruktur geschaffen hat, wird sie nicht so schnell wieder abbauen. Das zeigt die Geschichte der Vorratsdatenspeicherung, die in Deutschland seit fast zwei Jahrzehnten diskutiert wird.',
  'Am Ende bleibt die Frage, welchen Preis eine Gesellschaft für ein Versprechen von Sicherheit zu zahlen bereit ist – und wer diesen Preis trägt. Die Antwort fällt in Brüssel, Berlin und in den Wohnzimmern der Menschen, die ihre Nachrichten weiterhin privat halten wollen.',
];
const PARAS_EN = [
  'On a windless July morning, the water off the Swedish island of Gotland looks less like a sea than a bowl of pea soup. Streaks of yellow-green cyanobacteria stretch to the horizon, thick enough to smother a paddle. From orbit, the bloom is visible as a marbled swirl the size of a small country.',
  'The Baltic is an unusual sea. It is shallow, brackish, and almost entirely enclosed; water entering from the North Sea through the narrow Danish straits takes roughly thirty years to cycle out again. Whatever the nine surrounding countries put into it stays for a generation.',
  'When the blooms die and sink, bacteria consume them, and in doing so consume the oxygen in the deep water. Below about 70 metres, much of the central Baltic now contains no oxygen at all. Cod eggs, which need saline, oxygenated water to float, sink into the dead layer and suffocate.',
  'There is, at least, good news on the input side. Since the 1980s, the countries around the Baltic have cut phosphorus loads by roughly half and nitrogen by a third, through better sewage treatment and stricter farming rules. Helsinki\'s wastewater plant now removes more than 95 percent of the phosphorus that reaches it.',
  'But the sea is slow to respond. Decades of phosphorus have accumulated in the sediment, and each summer, as the deep water runs out of oxygen, chemical reactions release it back into the water column—what scientists call the “vicious circle” of eutrophication.',
  'Back on Gotland, the bloom will drift for a few more weeks before the autumn storms break it up. The tourists will go home. And below the surface, in the dark, the sediment will keep a patient ledger of everything the land has sent it.',
];

function articleHtml(lang, seed, title) {
  const P = lang === 'de' ? PARAS_DE : PARAS_EN;
  const h2 = lang === 'de' ? ['Was technisch passieren soll', 'Die Fehlerquote ist das Problem'] : ['A slow recovery', 'What happens next'];
  const quote = lang === 'de' ? '„Es gibt keinen Weg, eine Hintertür zu bauen, die nur die Guten benutzen können.“' : '“We are not fighting today\'s pollution. We are fighting the pollution of our grandparents.”';
  return `<p>${P[0]}</p><p>${P[1]}</p><figure><img src="${svgImage(seed + 3, 900, 560)}" alt=""><figcaption>${lang === 'de' ? 'Bildunterschrift: Ein Motiv zum Artikel. Foto: Cozy Shelves' : 'Caption: an image accompanying the article. Photo: Cozy Shelves'}</figcaption></figure><h2>${h2[0]}</h2><p>${P[2]}</p><blockquote><p>${quote}</p></blockquote><p>${P[3]}</p><h2>${h2[1]}</h2><p>${P[4]}</p><ul><li>${lang === 'de' ? 'Über 300 Fachleute lehnen den Entwurf ab' : 'More than 300 experts reject the draft'}</li><li>${lang === 'de' ? 'Das Parlament fordert Ausnahmen' : 'Parliament demands exemptions'}</li></ul><p>${P[5]}</p>`;
}

const readState = new Set();
const userFeeds = [];
const health = {};
const HOUR = 3600e3;

function itemsFor(feed) {
  const src = feed.lang === 'de' ? DE : EN;
  const n = 8;
  const items = [];
  for (let i = 0; i < n; i++) {
    const seedBase = [...feed.id].reduce((a, c) => a + c.charCodeAt(0), 0);
    const [title, summary, author] = src[(seedBase * 3 + i * 5) % src.length];
    const seed = seedBase + i;
    const full = feed.fullText === true || feed.type === 'tagesschau' || i % 3 !== 1;
    const hasImg = feed.hasImages ? i % 4 !== 3 : i % 5 === 0;
    const link = `${feed.homepage || 'https://example.org'}/${feed.id}/${i}`;
    items.push({ id: feed.id + '-' + i, title, link, date: Date.now() - (i * 5 + seedBase % 4) * HOUR - (seed % 60) * 60e3, author, summary, image: hasImg ? svgImage(seed, 800, 500) : null, content: full ? articleHtml(feed.lang, seed, title) : null, hasFullText: full, textLength: full ? 3000 : 200, categories: [], read: readState.has(feed.id + '-' + i), feedId: feed.id, feedTitle: feed.title, feedLang: feed.lang });
  }
  return items;
}
const allFeeds = () => [...FEEDS, ...userFeeds];
const decorate = (f) => ({ ...f, health: health[f.id] || { status: 'unknown' }, unread: itemsFor(f).filter((i) => !readState.has(i.id)).length, itemCount: 8, lastFetched: Date.now() - 5 * 60e3, cached: true });

export const feedsMock = {
  list: async () => ({ categories: CATEGORIES.map((c) => ({ ...c })), feeds: allFeeds().map(decorate) }),
  fetch: async (id) => { const f = allFeeds().find((x) => x.id === id || x.url === id); if (!f) throw new Error('unknown feed ' + id); await new Promise((r) => setTimeout(r, 120)); return { feed: { ...f, link: f.homepage, description: f.title + ' – Feed', fetchedAt: Date.now() }, items: itemsFor(f), fromCache: true }; },
  article: async (url, feedId) => {
    const f = allFeeds().find((x) => x.id === feedId) || FEEDS[0];
    const item = itemsFor(f).find((i) => i.link === url) || itemsFor(f)[0];
    await new Promise((r) => setTimeout(r, 250));
    const content = item.content || articleHtml(f.lang, 7, item.title);
    const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return { title: item.title, byline: item.author, content, textContent: text, excerpt: item.summary, image: item.image, siteName: f.title, lang: f.lang, published: item.date, readingMinutes: Math.max(1, Math.round(text.split(' ').length / 220)), url, source: item.content ? 'feed' : 'readability' };
  },
  check: async (url) => { await new Promise((r) => setTimeout(r, 400)); if (!/^https?:\/\/.+\..+/.test(url)) return { ok: false, url, error: 'Ungültige URL / invalid url' }; return { ok: true, url, title: 'Beispiel-Blog', link: url, itemCount: 20, fullText: true, fullTextItems: 18, imageCount: 12, hasImages: true, sample: ['Erster Beitrag', 'Zweiter Beitrag', 'Dritter Beitrag'], lang: 'de', newest: Date.now() - HOUR }; },
  add: async (url, category, lang) => { const f = { id: 'u-' + userFeeds.length, title: 'Beispiel-Blog', url, lang: lang || 'de', category: category || 'custom', fullText: true, hasImages: true, homepage: url, custom: true }; userFeeds.push(f); return decorate(f); },
  remove: async (id) => { const i = userFeeds.findIndex((f) => f.id === id); if (i >= 0) userFeeds.splice(i, 1); return true; },
  readState: async () => ({ read: Object.fromEntries([...readState].map((k) => [k, Date.now()])) }),
  markRead: async (feedId, itemId) => { readState.add(itemId); return { feedId, itemId }; },
  health: async (emit) => { const feeds = allFeeds(); let done = 0; for (const f of feeds) { setTimeout(() => { health[f.id] = { status: done % 9 === 4 ? 'broken' : 'ok', checkedAt: Date.now(), error: done % 9 === 4 ? 'HTTP 404' : null }; done++; emit('feeds:update', { type: 'health', feedId: f.id, health: health[f.id] }); emit('feeds:update', { type: 'health-progress', done, total: feeds.length }); if (done === feeds.length) emit('feeds:update', { type: 'health-done', total: feeds.length }); }, 30 * done); } return { started: true, total: feeds.length }; },
};

// ---- podcasts -------------------------------------------------------------------------------------------------
const TOPICS = [{ id: 'news', de: 'Nachrichten & Politik', en: 'News & Politics' }, { id: 'science', de: 'Wissen & Geschichte', en: 'Science & History' }, { id: 'stories', de: 'Geschichten & Gespräche', en: 'Stories & Conversation' }, { id: 'finance', de: 'Finanzen & Wirtschaft', en: 'Finance & Economy' }, { id: 'tech', de: 'Technik & Sicherheit', en: 'Tech & Security' }, { id: 'chess', de: 'Schach', en: 'Chess' }];
const PODS = [
  ['ldn', 'Lage der Nation', 'Philip Banse & Ulf Buermeyer', 'de', 'news', 'Der Politik-Podcast aus Berlin.'], ['sterne', 'Sternengeschichten', 'Florian Freistetter', 'de', 'science', 'Geschichten aus dem Universum.'], ['gag', 'Geschichten aus der Geschichte', 'Hemmer & Meßner', 'de', 'science', 'Jede Woche eine Geschichte aus der Geschichte.'], ['finanzfluss', 'Finanzfluss Podcast', 'Thomas Kehl', 'de', 'finance', 'Geldanlage, ETFs und Finanzwissen.'], ['lnp', 'Logbuch:Netzpolitik', 'Linus Neumann & Tim Pritlove', 'de', 'tech', 'Netzpolitik aus Berlin.'], ['schach', 'Schachgeflüster', 'Michael Busse', 'de', 'chess', 'Der deutsche Schach-Podcast.'],
  ['radiolab', 'Radiolab', 'WNYC Studios', 'en', 'science', 'Investigating a strange world.'], ['tal', 'This American Life', 'Ira Glass', 'en', 'stories', 'Stories from everyday life.'], ['99pi', '99% Invisible', 'Roman Mars', 'en', 'stories', 'The unnoticed design that shapes our world.'], ['planetmoney', 'Planet Money', 'NPR', 'en', 'finance', 'The economy explained.'], ['darknet', 'Darknet Diaries', 'Jack Rhysider', 'en', 'tech', 'True stories from the dark side of the internet.'], ['perpetual', 'Perpetual Chess Podcast', 'Ben Johnson', 'en', 'chess', 'Interviews with chess players and improvers.'], ['hardcore', "Dan Carlin's Hardcore History", 'Dan Carlin', 'en', 'science', 'Epic history, told in depth.'], ['thedaily', 'The Daily', 'The New York Times', 'en', 'news', 'This is what the news should sound like.'],
].map(([id, title, author, lang, topic, description], i) => ({ id, title, author, feedUrl: `https://example.org/podcasts/${id}/feed.xml`, lang, topic, description, artwork: svgImage(i * 11 + 5, 400, 400) }));
const subs = [PODS[2], PODS[4], PODS[7], PODS[9]].map((p) => ({ feedUrl: p.feedUrl, title: p.title, author: p.author, artwork: p.artwork, homepage: 'https://example.org', addedAt: Date.now() }));
const positions = {};
const EP_DE = ['Der Kosmische Kalender', 'Warum der Mond keine Atmosphäre hat', 'Die Oortsche Wolke', 'Was ein Sonnensturm mit dem Stromnetz macht', 'Die dunkle Seite der Milchstraße', 'Ein Jahr auf dem Mars'];
const EP_EN = ['The Cosmic Calendar', 'Why the Moon has no atmosphere', 'The Oort Cloud', 'What a solar storm does to the grid', 'The dark side of the Milky Way', 'A year on Mars'];
function episodesFor(feedUrl) {
  const p = PODS.find((x) => x.feedUrl === feedUrl) || { ...PODS[0], title: feedUrl, lang: 'de' };
  const names = p.lang === 'de' ? EP_DE : EP_EN;
  const episodes = names.map((t, i) => { const id = p.id + '-ep-' + i; return { id, guid: id, title: `${p.title.split(' ')[0]} ${640 - i}: ${t}`, description: `<p>${p.lang === 'de' ? PARAS_DE[i % PARAS_DE.length] : PARAS_EN[i % PARAS_EN.length]}</p><ul><li>00:00 Intro</li><li>02:15 ${t}</li></ul>`, summary: (p.lang === 'de' ? PARAS_DE : PARAS_EN)[i % 6].slice(0, 160) + ' …', audio: `https://example.org/audio/${id}.mp3`, audioType: 'audio/mpeg', size: 9e6, duration: 754 + i * 313, date: Date.now() - i * 7 * 24 * HOUR, image: p.artwork, link: 'https://example.org/' + id, episode: 640 - i, season: null, type: 'full', position: positions[id] || (i === 1 ? { seconds: 400, done: false } : i === 2 ? { seconds: 1380, done: true } : null) }; });
  return { show: { feedUrl, title: p.title, author: p.author, artwork: p.artwork, description: p.description + ' ' + (p.lang === 'de' ? 'Jede Woche neu.' : 'New every week.'), link: 'https://example.org', lang: p.lang }, episodes };
}
export const podcastsMock = {
  search: async (term) => { await new Promise((r) => setTimeout(r, 300)); return PODS.filter((p) => !term || p.title.toLowerCase().includes(term.toLowerCase()) || p.author.toLowerCase().includes(term.toLowerCase())).map((p) => ({ id: p.id, title: p.title, author: p.author, artwork: p.artwork, feedUrl: p.feedUrl, genre: 'Science', episodes: 640 })); },
  curated: async () => ({ topics: TOPICS, podcasts: PODS.map((p) => ({ ...p, subscribed: subs.some((s) => s.feedUrl === p.feedUrl) })) }),
  subscriptions: async () => subs.map((s) => ({ ...s })),
  subscribe: async (feedUrl, meta) => { if (!subs.some((s) => s.feedUrl === feedUrl)) { const p = PODS.find((x) => x.feedUrl === feedUrl); subs.push({ feedUrl, title: meta?.title || p?.title || feedUrl, author: meta?.author || p?.author || null, artwork: meta?.artwork || p?.artwork || null, addedAt: Date.now() }); } return subs.find((s) => s.feedUrl === feedUrl); },
  unsubscribe: async (feedUrl) => { const i = subs.findIndex((s) => s.feedUrl === feedUrl); if (i >= 0) subs.splice(i, 1); return true; },
  episodes: async (feedUrl) => { await new Promise((r) => setTimeout(r, 150)); return episodesFor(feedUrl); },
  importOpml: async () => ({ total: 3, added: 2, file: 'antennapod.opml' }),
  exportOpml: async () => 'cozy-shelves-podcasts.opml',
  getPositions: async () => ({ ...positions }),
  setPosition: async (id, seconds, done) => { positions[id] = { seconds, done: !!done, updatedAt: Date.now() }; return positions[id]; },
};

// ---- wikipedia -------------------------------------------------------------------------------------------------
const WIKI_PAGES = {
  de: {
    Rhonegletscher: { description: 'Gletscher in der Schweiz', html: `<table class="infobox float-right"><tbody><tr><th colspan="2" style="background:#cee0f2">Rhonegletscher</th></tr><tr><td colspan="2" class="infobox-image"><figure><img src="${svgImage(21, 520, 300)}" alt=""><figcaption>Der Gletscher 2024</figcaption></figure></td></tr><tr><th>Lage</th><td><a data-wiki="Kanton Wallis">Wallis</a>, <a data-wiki="Schweiz">Schweiz</a></td></tr><tr><th>Fläche</th><td>15,9 km²<sup class="reference"><a data-anchor="cite_note-1">[1]</a></sup></td></tr><tr><th>Höhe</th><td>3600 – 2200 m ü. M.</td></tr></tbody></table><div class="hatnote">Dieser Artikel behandelt den Gletscher; zum Fluss siehe <a data-wiki="Rhone">Rhone</a>.</div><p>Der <b>Rhonegletscher</b> (<i>französisch</i> <i>Glacier du Rhône</i>) ist ein <a data-wiki="Talgletscher">Talgletscher</a> im <a data-wiki="Kanton Wallis">Kanton Wallis</a> in der Schweiz. Er ist der Ursprung der <a data-wiki="Rhone">Rhone</a> und liegt am Ostende des Kantons, nahe der <a data-wiki="Furkapass">Furkapass</a>-Straße. Seit dem Ende der <a data-wiki="Kleine Eiszeit">Kleinen Eiszeit</a> um 1850 hat er sich um mehr als 1,4 Kilometer zurückgezogen und dabei einen <a data-wiki="Gletschersee">Gletschersee</a> hinterlassen, der sich seit 2005 rasch vergrößert.</p><p>${PARAS_DE[0]}</p><section><h2 id="Geographie">Geographie</h2><figure class="mw-default-size"><img src="${svgImage(4, 440, 330)}" alt=""><figcaption>Der Gletscher um 1900, als er noch bis ins Tal reichte</figcaption></figure><p>Der Gletscher entspringt am <a data-wiki="Dammastock">Dammastock</a> auf rund 3600 Metern und fließt über etwa acht Kilometer nach Süden. Sein Nährgebiet umfasst das <a data-wiki="Rhonefirn">Rhonefirn</a>-Plateau. ${PARAS_DE[1]}</p><h3 id="Gletschersee">Gletschersee</h3><p>Seit 2005 bildet sich an der Gletscherzunge ein See, der 2024 eine Fläche von rund 0,4 km² erreichte.<sup class="reference"><a data-anchor="cite_note-2">[2]</a></sup> ${PARAS_DE[2]}</p></section><section><h2 id="Rückzug_seit_1850">Rückzug seit 1850</h2><p>Der Rhonegletscher gehört zu den am besten dokumentierten Gletschern der Alpen. Erste Vermessungen fanden 1874 statt. Seit 2009 wird die Gletscherzunge im Sommer mit Vliesdecken abgedeckt, um die <a data-wiki="Eisgrotte">Eisgrotte</a> für Touristen zu erhalten.</p><table class="wikitable"><tbody><tr><th>Jahr</th><th>Länge (km)</th><th>Fläche (km²)</th></tr><tr><td>1850</td><td>10,2</td><td>22,1</td></tr><tr><td>1900</td><td>9,5</td><td>20,4</td></tr><tr><td>2020</td><td>7,7</td><td>15,9</td></tr></tbody></table><p>${PARAS_DE[3]}</p></section><section><h2 id="Einzelnachweise">Einzelnachweise</h2><ol class="references"><li id="cite_note-1">GLAMOS: Gletscherberichte 2024.</li><li id="cite_note-2">Glaziologische Messreihe, 2024.</li></ol></section>`, toc: [{ id: 'Geographie', text: 'Geographie', level: 2 }, { id: 'Gletschersee', text: 'Gletschersee', level: 3 }, { id: 'Rückzug_seit_1850', text: 'Rückzug seit 1850', level: 2 }, { id: 'Einzelnachweise', text: 'Einzelnachweise', level: 2 }] },
  },
  en: {
    'Rhône Glacier': { description: 'Glacier in Switzerland', html: `<table class="infobox"><tbody><tr><th colspan="2">Rhône Glacier</th></tr><tr><td colspan="2"><figure><img src="${svgImage(21, 520, 300)}" alt=""><figcaption>The glacier in 2024</figcaption></figure></td></tr><tr><th>Location</th><td><a data-wiki="Valais">Valais</a>, <a data-wiki="Switzerland">Switzerland</a></td></tr></tbody></table><p>The <b>Rhône Glacier</b> (German: <i>Rhonegletscher</i>) is a glacier in the Swiss Alps and the source of the river <a data-wiki="Rhône">Rhône</a>. ${PARAS_EN[0]}</p><section><h2 id="Geography">Geography</h2><p>${PARAS_EN[1]}</p></section><section><h2 id="Retreat">Retreat</h2><p>${PARAS_EN[3]}</p></section>`, toc: [{ id: 'Geography', text: 'Geography', level: 2 }, { id: 'Retreat', text: 'Retreat', level: 2 }] },
  },
};
const genericPage = (lang, title) => ({ description: lang === 'de' ? 'Begriff aus der Wikipedia' : 'Wikipedia article', html: `<p><b>${title}</b> ${lang === 'de' ? 'ist ein Artikel der deutschsprachigen Wikipedia.' : 'is an article in the English Wikipedia.'} ${(lang === 'de' ? PARAS_DE : PARAS_EN)[0]} <a data-wiki="Rhonegletscher">Rhonegletscher</a>.</p><section><h2 id="Geschichte">${lang === 'de' ? 'Geschichte' : 'History'}</h2><p>${(lang === 'de' ? PARAS_DE : PARAS_EN)[1]}</p></section>`, toc: [{ id: 'Geschichte', text: lang === 'de' ? 'Geschichte' : 'History', level: 2 }] });
const summ = (lang, title, i, extra = {}) => ({ title, displayTitle: title, description: extra.description || (lang === 'de' ? 'Artikel' : 'Article'), extract: extra.extract || (lang === 'de' ? PARAS_DE : PARAS_EN)[i % 6].slice(0, 220), thumbnail: extra.noImage ? null : { url: svgImage(i + 40, 320, 240), width: 320, height: 240 }, image: null, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`, lang, ...extra });
export const wikiMock = {
  featured: async (lang) => { lang = lang === 'en' ? 'en' : 'de'; await new Promise((r) => setTimeout(r, 200)); return { lang, date: new Date().toISOString().slice(0, 10), tfa: summ(lang, lang === 'de' ? 'Alexander von Humboldt' : 'Alexander von Humboldt', 3, { description: lang === 'de' ? 'deutscher Naturforscher (1769–1859)' : 'Prussian naturalist and explorer (1769–1859)', extract: lang === 'de' ? 'Friedrich Wilhelm Heinrich Alexander von Humboldt war ein deutscher Naturforscher mit einem weit über Europa hinausreichenden Wirkungsfeld. In seinem über einige Jahrzehnte entstandenen Gesamtwerk schuf er „einen neuen Wissensstand und neue Reflexionsebenen des Wissens von der Welt“ und wurde Mitbegründer der Geographie als empirischer Wissenschaft.' : 'Friedrich Wilhelm Heinrich Alexander von Humboldt was a German polymath, geographer, naturalist and explorer. His quantitative work on botanical geography laid the foundation for the field of biogeography, and his advocacy of long-term systematic observation laid the foundation for modern monitoring of the Earth.' }), image: { title: 'Rhône Glacier Panorama', thumbnail: svgImage(21, 900, 420), image: svgImage(21, 900, 420), description: lang === 'de' ? 'Panorama des Rhonegletschers im Kanton Wallis, Schweiz.' : 'Panorama of the Rhône Glacier in the canton of Valais, Switzerland.', artist: 'Example User', credit: 'Own work', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org' }, mostread: [summ(lang, lang === 'de' ? 'Oktoberfest' : 'Oktoberfest', 5, { views: 184321 }), summ(lang, lang === 'de' ? 'Bundestagswahl 2025' : 'Battle of Britain', 6, { views: 90111, noImage: true }), summ(lang, lang === 'de' ? 'Rhonegletscher' : 'Rhône Glacier', 7, { views: 77123 }), summ(lang, lang === 'de' ? 'Hermann Hesse' : 'Jane Austen', 8, { views: 61000 }), summ(lang, lang === 'de' ? 'Schach' : 'Chess', 9, { views: 52000, noImage: true })], onthisday: [{ year: 1789, text: lang === 'de' ? 'Die Erklärung der Menschen- und Bürgerrechte wird in Frankreich verabschiedet.' : 'The Declaration of the Rights of Man and of the Citizen is adopted in France.', pages: [summ(lang, lang === 'de' ? 'Erklärung der Menschen- und Bürgerrechte' : 'Declaration of the Rights of Man', 1)] }, { year: 1959, text: lang === 'de' ? 'Die Sowjetunion startet die Raumsonde Luna 2, die als erstes von Menschen gebautes Objekt den Mond erreicht.' : 'The Soviet probe Luna 2 becomes the first human-made object to reach the Moon.', pages: [summ(lang, 'Luna 2', 2, { noImage: true })] }, { year: 1519, text: lang === 'de' ? 'Der Reformator Ulrich Zwingli beginnt seine Predigten in Zürich.' : 'Reformer Huldrych Zwingli begins preaching in Zürich.', pages: [] }, { year: 1812, text: lang === 'de' ? 'Napoleons Grande Armée erreicht Moskau.' : "Napoleon's Grande Armée reaches Moscow.", pages: [summ(lang, lang === 'de' ? 'Russlandfeldzug 1812' : "French invasion of Russia", 3, { noImage: true })] }], news: lang === 'en' ? [{ story: 'The Rhône Glacier loses a record three metres of ice in a single summer.', storyHtml: 'The <a data-wiki="Rhône Glacier">Rhône Glacier</a> loses a record three metres of ice in a single summer.', pages: [summ('en', 'Rhône Glacier', 7)] }] : [] }; },
  search: async (lang, q) => { await new Promise((r) => setTimeout(r, 120)); const base = lang === 'de' ? ['Rhonegletscher', 'Rhone', 'Rhonefirn', 'Rhône-Alpes', 'Rhonetal'] : ['Rhône Glacier', 'Rhône', 'Rhône-Alpes', 'Rhône Valley']; return base.filter((t) => t.toLowerCase().startsWith(q.toLowerCase().slice(0, 2))).map((title, i) => ({ id: i, title, key: title, description: lang === 'de' ? ['Gletscher in der Schweiz', 'Fluss in der Schweiz und Frankreich', 'Firnfeld', 'Region in Frankreich', 'Tal'][i] : ['Glacier in Switzerland', 'River in Switzerland and France', 'Region in France', 'Valley'][i], excerpt: '', thumbnail: i === 0 ? svgImage(21, 120, 80) : null, lang })); },
  page: async (lang, title) => { lang = lang === 'en' ? 'en' : 'de'; await new Promise((r) => setTimeout(r, 250)); const p = WIKI_PAGES[lang][title] || genericPage(lang, title); const text = p.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); return { title, displayTitle: title, description: p.description, lang, html: p.html, toc: p.toc, textContent: text, image: null, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`, readingMinutes: Math.max(1, Math.round(text.split(' ').length / 220)) }; },
  summary: async (lang, title) => summ(lang, title, 4),
  random: async (lang) => summ(lang, lang === 'de' ? 'Kaffeehaus' : 'Coffeehouse', 11, { description: lang === 'de' ? 'Gaststätte' : 'Establishment serving coffee' }),
};

export const dictMock = {
  define: async (word, lang) => ({ word, lang, entries: [{ partOfSpeech: lang === 'de' ? 'Substantiv, n' : 'Noun', definitions: [{ definition: lang === 'de' ? 'Gebäude, das Menschen zum Wohnen dient' : 'A structure built or serving as an abode of human beings.', examples: [lang === 'de' ? 'Das Haus hat drei Stockwerke.' : 'This house has three bedrooms.'] }, { definition: lang === 'de' ? 'übertragen: die Bewohner eines Hauses, Familie' : 'The people who live in a house; a household.', examples: [] }], synonyms: lang === 'de' ? ['Gebäude, Bau'] : [] }], glosses: lang === 'de' ? [{ partOfSpeech: 'Noun', definitions: [{ definition: 'house, building', examples: ['Das Haus steht am Fluss.'] }] }] : [], source: ['de.wiktionary', 'en.wiktionary'] }),
  translate: async (text, from, to) => ({ text, from, to, translated: to === 'en' ? 'The library is open until midnight.' : 'Die Bibliothek ist bis Mitternacht geöffnet.', alternatives: [], source: 'mymemory' }),
};
