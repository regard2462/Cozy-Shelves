// Podcasts: iTunes search, curated list, subscriptions, episode parsing (iTunes RSS), OPML import/export, positions.
const path = require('path');
const RssParser = require('rss-parser');
const C = require('./common');
const { feedError } = require('./feeds');

const EPISODE_TTL = 30 * 60 * 1000;
const MAX_EPISODES = 200;
// Long-running shows publish their whole history in one feed (The Tim Ferriss Show and We Study Billionaires:
// more than 20 MB). Only the first 8 MB are read and parsed; feeds list the newest episodes first.
const PODCAST_MAX_BYTES = 8 * 1024 * 1024;

const P = (id, title, author, feedUrl, lang, topic, description) => ({ id, title, author, feedUrl, lang, topic, description, artwork: null });
// Same neutral vocabulary as the newspaper categories (feeds/feedlist.js), so the two
// panels do not disagree about what a topic is called.
const TOPICS = [
  { id: 'news', de: 'Nachrichten & Politik', en: 'News & Politics' },
  { id: 'science', de: 'Wissenschaft & Natur', en: 'Science & Nature' },
  { id: 'history', de: 'Geschichte & Philosophie', en: 'History & Philosophy' },
  { id: 'stories', de: 'Geschichten & Gespräche', en: 'Stories & Conversation' },
  { id: 'business', de: 'Wirtschaft & Finanzen', en: 'Business & Finance' },
  { id: 'technology', de: 'Technik & Digitales', en: 'Technology & Digital' },
  { id: 'culture', de: 'Kultur & Literatur', en: 'Culture & Literature' },
  { id: 'sports', de: 'Sport & Spiel', en: 'Sports & Games' },
];
/** Legacy topic ids → current ones (podcasts.json / OPML imports). */
const LEGACY_TOPIC_MAP = { finance: 'business', tech: 'technology', chess: 'sports' };

const CURATED = [
  // German
  P('ldn', 'Lage der Nation', 'Philip Banse & Ulf Buermeyer', 'https://feeds.lagedernation.org/feeds/ldn-mp3.xml', 'de', 'news', 'Der Politik-Podcast aus Berlin.'),
  P('allesgesagt', 'Alles gesagt?', 'DIE ZEIT', 'https://feeds.simplecast.com/Y_bRXaw2', 'de', 'stories', 'Der unendliche Interview-Podcast.'),
  P('wasjetzt', 'Was jetzt?', 'DIE ZEIT', 'https://feeds.simplecast.com/Xtqjn37O', 'de', 'news', 'Das Nachrichten-Update, zweimal täglich.'),
  P('verbrechen', 'Verbrechen', 'DIE ZEIT', 'https://feeds.simplecast.com/dnJhzmyN', 'de', 'stories', 'Wahre Kriminalfälle, erzählt von Sabine Rückert.'),
  P('dlf-hintergrund', 'Hintergrund', 'Deutschlandfunk', 'https://www.deutschlandfunk.de/hintergrund-102.xml', 'de', 'news', 'Die Analyse zum Tagesgeschehen.'),
  P('dlf-dertag', 'Der Tag', 'Deutschlandfunk', 'https://www.deutschlandfunk.de/podcast-104.xml', 'de', 'news', 'Der tägliche Podcast des Deutschlandfunks zu einem Thema des Tages.'),
  P('dlf-forschung', 'Forschung aktuell', 'Deutschlandfunk', 'https://www.deutschlandfunk.de/forschung-aktuell-102.xml', 'de', 'science', 'Neues aus Wissenschaft und Forschung.'),
  P('sternengeschichten', 'Sternengeschichten', 'Florian Freistetter', 'https://sternengeschichten.podigee.io/feed/mp3', 'de', 'science', 'Geschichten aus dem Universum.'),
  P('gag', 'Geschichten aus der Geschichte', 'Richard Hemmer & Daniel Meßner', 'https://www.geschichte.fm/feed/mp3/', 'de', 'history', 'Jede Woche eine Geschichte aus der Geschichte.'),
  P('minkorrekt', 'Methodisch inkorrekt!', 'Nicolas Wöhrl & Reinhard Remfort', 'https://minkorrekt.de/feed/mp3/', 'de', 'science', 'Der Wissenschaftspodcast.'),
  P('lnp', 'Logbuch:Netzpolitik', 'Linus Neumann & Tim Pritlove', 'https://feeds.metaebene.me/lnp/mp3', 'de', 'technology', 'Netzpolitik aus Berlin.'),
  P('cre', 'CRE: Technik, Kultur, Gesellschaft', 'Tim Pritlove', 'https://feeds.metaebene.me/cre/m4a', 'de', 'culture', 'Der Interview-Podcast über Technik und Gesellschaft.'),
  P('streitkraefte', 'Streitkräfte und Strategien', 'NDR Info', 'https://www.ndr.de/nachrichten/info/podcast2998.xml', 'de', 'news', 'Sicherheitspolitik verständlich erklärt.'),
  P('finanzfluss', 'Finanzfluss Podcast', 'Finanzfluss', 'https://feeds.megaphone.fm/FGH3030202797', 'de', 'business', 'Geldanlage, ETFs und Finanzwissen.'),
  P('hbtoday', 'Handelsblatt Today', 'Handelsblatt', 'https://handelsblatt-today.podigee.io/feed/mp3', 'de', 'business', 'Das tägliche Wirtschafts-Briefing.'),
  P('dasuniversum', 'Das Universum', 'Florian Freistetter & Ruth Grützbauch', 'https://dasuniversum.podigee.io/feed/mp3', 'de', 'science', 'Astronomie zum Zuhören.'),
  P('perlen', 'Schachgeflüster', 'Chess Tigers', 'https://xt4oqp.podcaster.de/familienschach.rss', 'de', 'sports', 'Der deutsche Schach-Podcast.'),
  P('hotelmatze', 'Hotel Matze', 'Matze Hielscher', 'https://hotelmatze.podigee.io/feed/mp3', 'de', 'stories', 'Lange Gespräche mit interessanten Menschen.'),
  P('weltspiegel', 'Weltspiegel Podcast', 'ARD Weltspiegel', 'https://www.swr.de/~podcast/weltspiegel-thema/weltspiegel-podcast-102.xml', 'de', 'news', 'Auslandsreportagen der ARD.'),
  P('chaosradio', 'Chaosradio', 'Chaos Computer Club', 'https://chaosradio.de/feed/mp3', 'de', 'technology', 'Der Podcast des CCC Berlin.'),
  // English
  P('radiolab', 'Radiolab', 'WNYC Studios', 'https://feeds.simplecast.com/EmVW7VGp', 'en', 'science', 'Investigating a strange world.'),
  P('tal', 'This American Life', 'Ira Glass', 'https://www.thisamericanlife.org/podcast/rss.xml', 'en', 'stories', 'Stories from everyday life.'),
  P('99pi', '99% Invisible', 'Roman Mars', 'https://feeds.simplecast.com/BqbsxVfO', 'en', 'culture', 'The unnoticed design that shapes our world.'),
  P('planetmoney', 'Planet Money', 'NPR', 'https://feeds.npr.org/510289/podcast.xml', 'en', 'business', 'The economy explained.'),
  P('thedaily', 'The Daily', 'The New York Times', 'https://feeds.simplecast.com/54nAGcIl', 'en', 'news', 'This is what the news should sound like.'),
  P('hardcorehistory', "Dan Carlin's Hardcore History", 'Dan Carlin', 'https://feeds.feedburner.com/dancarlin/history?format=xml', 'en', 'history', 'Epic history, told in depth.'),
  P('inourtime', 'In Our Time', 'BBC Radio 4', 'https://podcasts.files.bbci.co.uk/b006qykl.rss', 'en', 'history', 'The history of ideas, with Melvyn Bragg.'),
  P('freakonomics', 'Freakonomics Radio', 'Stephen Dubner', 'https://feeds.simplecast.com/Y8lFbOT4', 'en', 'business', 'The hidden side of everything.'),
  P('lex', 'Lex Fridman Podcast', 'Lex Fridman', 'https://lexfridman.com/feed/podcast/', 'en', 'stories', 'Conversations about AI, science and life.'),
  P('huberman', 'Huberman Lab', 'Andrew Huberman', 'https://feeds.megaphone.fm/hubermanlab', 'en', 'science', 'Neuroscience and health tools.'),
  P('perpetualchess', 'Perpetual Chess Podcast', 'Ben Johnson', 'https://feeds.megaphone.fm/BLU4811105299', 'en', 'sports', 'Interviews with chess players and improvers.'),
  P('chessjourneys', 'Chess Journeys', 'Kevin Scull', 'https://feeds.megaphone.fm/COMG5914451027', 'en', 'sports', 'Tales of adult chess improvement.'),
  P('tip', 'We Study Billionaires', 'The Investor’s Podcast Network', 'https://feeds.megaphone.fm/PPLLC8974708240', 'en', 'business', 'Value investing and the world’s best investors.'),
  P('econtalk', 'EconTalk', 'Russ Roberts', 'https://feeds.simplecast.com/wgl4xEgL', 'en', 'business', 'Conversations for the curious.'),
  P('darknet', 'Darknet Diaries', 'Jack Rhysider', 'https://feeds.megaphone.fm/darknetdiaries', 'en', 'technology', 'True stories from the dark side of the internet.'),
  P('securitynow', 'Security Now', 'TWiT', 'https://feeds.twit.tv/sn.xml', 'en', 'technology', 'Steve Gibson on security, weekly.'),
  P('upfirst', 'Up First', 'NPR', 'https://feeds.npr.org/510318/podcast.xml', 'en', 'news', 'The morning news briefing from NPR.'),
  P('globalnews', 'Global News Podcast', 'BBC World Service', 'https://podcasts.files.bbci.co.uk/p02nq0gn.rss', 'en', 'news', 'The day’s top stories from around the world.'),
  P('hiddenbrain', 'Hidden Brain', 'Shankar Vedantam', 'https://feeds.npr.org/510308/podcast.xml', 'en', 'science', 'The unconscious patterns that drive us.'),
  P('economist', 'Economist Podcasts', 'The Economist', 'https://rss.acast.com/theeconomistallaudio', 'en', 'news', 'Intelligence on politics, business and science.'),
  P('timferriss', 'The Tim Ferriss Show', 'Tim Ferriss', 'https://rss.art19.com/tim-ferriss-show', 'en', 'stories', 'Deconstructing world-class performers.'),
  P('sysk', 'Stuff You Should Know', 'iHeartPodcasts', 'https://omny.fm/shows/stuff-you-should-know-1/playlists/podcast.rss', 'en', 'science', 'How things work, explained.'),
];

// Curated feeds that moved to a new address (the old ones answer 404): subscriptions follow them.
const MOVED_FEEDS = {
  'https://allesgesagt.podigee.io/feed/mp3': 'https://feeds.simplecast.com/Y_bRXaw2',
  'https://wasjetzt.podigee.io/feed/mp3': 'https://feeds.simplecast.com/Xtqjn37O',
  'https://verbrechen.podigee.io/feed/mp3': 'https://feeds.simplecast.com/dnJhzmyN',
  'https://www.deutschlandfunk.de/der-tag-102.xml': 'https://www.deutschlandfunk.de/podcast-104.xml',
  'https://finanzfluss.podigee.io/feed/mp3': 'https://feeds.megaphone.fm/FGH3030202797',
  'https://schachgefluester.podigee.io/feed/mp3': 'https://xt4oqp.podcaster.de/familienschach.rss',
  'https://feeds.br.de/weltspiegel-podcast/feed.xml': 'https://www.swr.de/~podcast/weltspiegel-thema/weltspiegel-podcast-102.xml',
  'https://perpetualchesspod.libsyn.com/rss': 'https://feeds.megaphone.fm/BLU4811105299',
  'https://anchor.fm/s/2ee16b18/podcast/rss': 'https://feeds.megaphone.fm/COMG5914451027',
  'https://www.theinvestorspodcast.com/feed/': 'https://feeds.megaphone.fm/PPLLC8974708240',
};

/** Subscriptions of moved feeds get the new address (a duplicate of an existing subscription is dropped). */
function migrateSubscriptions(list) {
  let changed = false;
  const out = [];
  for (const s of list || []) {
    const moved = MOVED_FEEDS[s.feedUrl];
    if (moved) { changed = true; if (list.some((x) => x.feedUrl === moved) || out.some((x) => x.feedUrl === moved)) continue; out.push({ ...s, feedUrl: moved }); }
    else out.push(s);
  }
  return changed ? out : null;
}

const parser = new RssParser({
  timeout: 15000,
  customFields: {
    feed: [['itunes:image', 'itunesImage'], ['itunes:author', 'itunesAuthor'], ['itunes:summary', 'itunesSummary'], 'language', 'image'],
    item: [['itunes:duration', 'itunesDuration'], ['itunes:image', 'itunesImage'], ['itunes:summary', 'itunesSummary'], ['itunes:subtitle', 'itunesSubtitle'], ['itunes:episode', 'itunesEpisode'], ['itunes:season', 'itunesSeason'], ['itunes:episodeType', 'itunesEpisodeType'], ['content:encoded', 'contentEncoded'], ['media:content', 'mediaContent', { keepArray: true }], 'description', 'summary'],
  },
});

function parseDuration(d) {
  if (d == null) return null;
  if (typeof d === 'number') return d;
  const s = String(d).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));
  const parts = s.split(':').map((x) => parseInt(x, 10));
  if (parts.some((x) => Number.isNaN(x))) return null;
  return parts.reduce((a, x) => a * 60 + x, 0);
}

function pickAudio(item) {
  const enc = item.enclosure;
  if (enc && enc.url && (!enc.type || /^audio\//.test(enc.type) || /\.(mp3|m4a|ogg|opus|aac|wav|flac)(\?|$)/i.test(enc.url))) return { url: enc.url, type: enc.type || 'audio/mpeg', size: parseInt(enc.length || '0', 10) || null };
  for (const m of item.mediaContent || []) { const a = m.$ || m; if (a.url && (/^audio\//.test(a.type || '') || a.medium === 'audio' || /\.(mp3|m4a|ogg|opus)(\?|$)/i.test(a.url))) return { url: a.url, type: a.type || 'audio/mpeg', size: parseInt(a.fileSize || '0', 10) || null }; }
  if (enc && enc.url && /^video\//.test(enc.type || '')) return { url: enc.url, type: enc.type, size: parseInt(enc.length || '0', 10) || null, video: true };
  return null;
}

/** Parse a podcast RSS feed → { show, episodes }. */
async function parsePodcastXml(xml, feedUrl) {
  xml = String(xml || '').replace(/^﻿/, '').replace(/^[\s\S]*?(?=<\?xml|<rss|<feed)/i, '');
  const parsed = await parser.parseString(xml);
  const it = parsed.itunes || {};
  const artwork = C.absolutize(it.image || (typeof parsed.itunesImage === 'object' ? parsed.itunesImage.$?.href : parsed.itunesImage) || parsed.image?.url, parsed.link) || null;
  const show = {
    feedUrl, title: C.collapseWs(C.htmlToText(parsed.title || feedUrl)), author: C.collapseWs(it.author || parsed.itunesAuthor || parsed.creator || ''), artwork,
    description: C.summarize(C.htmlToText(parsed.description || it.summary || parsed.itunesSummary || ''), 400), link: parsed.link || null, lang: (parsed.language || '').slice(0, 2) || null,
    categories: it.categories || [],
  };
  const episodes = [];
  for (const item of parsed.items.slice(0, MAX_EPISODES)) {
    const audio = pickAudio(item);
    if (!audio) continue;
    const guid = (typeof item.guid === 'string' && item.guid) || item.id || audio.url;
    // a placeholder in place of a text ("None", "null", an empty body) is no description (common.js isPlaceholderText)
    const rawDesc = [item.contentEncoded, item.content, item.description, item.itunesSummary, item.summary].find((v) => !C.isPlaceholderText(v)) || '';
    const s = C.sanitizeHtml(rawDesc, { baseUrl: item.link || parsed.link });
    const image = C.absolutize(item.itunes?.image || (typeof item.itunesImage === 'object' ? item.itunesImage.$?.href : item.itunesImage), parsed.link) || null;
    episodes.push({
      id: C.shortId(feedUrl + '|' + guid, 20), guid, title: C.collapseWs(C.htmlToText(item.title || '')) || '(ohne Titel)', description: s.html, summary: C.summarize(s.text || C.htmlToText(item.itunesSubtitle || ''), 240),
      audio: audio.url, audioType: audio.type, size: audio.size, video: !!audio.video, duration: parseDuration(item.itunes?.duration || item.itunesDuration), date: C.toMs(item.isoDate || item.pubDate) || null,
      image: image || artwork, link: item.link || null, episode: parseInt(item.itunes?.episode || item.itunesEpisode || '', 10) || null, season: parseInt(item.itunes?.season || item.itunesSeason || '', 10) || null, type: item.itunes?.episodeType || item.itunesEpisodeType || null,
    });
  }
  episodes.sort((a, b) => (b.date || 0) - (a.date || 0));
  return { show, episodes };
}

/** A feed that was cut after PODCAST_MAX_BYTES ends after its last complete episode and is closed again. */
function closeTruncatedFeed(xml) {
  xml = String(xml || '');
  const item = xml.lastIndexOf('</item>');
  if (item > 0) return xml.slice(0, item + 7) + (/<rdf:RDF[\s>]/i.test(xml.slice(0, 4000)) ? '</rdf:RDF>' : '</channel></rss>');
  const entry = xml.lastIndexOf('</entry>');
  if (entry > 0) return xml.slice(0, entry + 8) + '</feed>';
  return xml;
}

/** Parse OPML (incl. AntennaPod / gPodder exports) → [{ title, feedUrl, homepage }]. */
function parseOpml(xml) {
  const out = []; const seen = new Set();
  const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
  const re = /<outline\b([^>]*?)\/?>/gi;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const attrs = {};
    m[1].replace(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (mm, k, v, a, b) => { attrs[k.toLowerCase()] = decode(a != null ? a : b); return ''; });
    const url = attrs.xmlurl || attrs.url;
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ feedUrl: url, title: attrs.text || attrs.title || url, homepage: attrs.htmlurl || null });
  }
  return out;
}

function buildOpml(subs, title = 'Cozy Shelves Podcasts') {
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>\n    <title>${esc(title)}</title>\n    <dateCreated>${new Date().toUTCString()}</dateCreated>\n  </head>\n  <body>\n${subs.map((s) => `    <outline type="rss" text="${esc(s.title)}" title="${esc(s.title)}" xmlUrl="${esc(s.feedUrl)}"${s.homepage ? ` htmlUrl="${esc(s.homepage)}"` : ''} />`).join('\n')}\n  </body>\n</opml>\n`;
}

function mapItunesResult(r) {
  return { id: String(r.collectionId || r.trackId), title: r.collectionName || r.trackName, author: r.artistName, artwork: r.artworkUrl600 || r.artworkUrl100 || null, feedUrl: r.feedUrl || null, genre: r.primaryGenreName || null, episodes: r.trackCount || null, lastRelease: C.toMs(r.releaseDate) };
}

function register(ctx) {
  const { ipcMain, app, dialog } = ctx;
  const { Store } = require('../store');
  const fs = require('fs');
  const userData = app.getPath('userData');
  // artwork: feedUrl → cover of every show opened once, so the recommendations show covers instead of a microphone
  const store = new Store(path.join(userData, 'podcasts.json'), { subs: [], positions: {}, artwork: {} });
  const cache = new C.DiskCache(path.join(userData, 'feeds-cache', 'podcasts'), { memoryLimit: 20 });
  const inflight = new Map();

  const subs = () => store.get('subs') || [];
  const migrated = migrateSubscriptions(subs());
  if (migrated) store.set('subs', migrated);

  async function loadEpisodes(feedUrl, force = false) {
    const key = C.shortId(feedUrl, 20);
    const entry = cache.get(key);
    if (entry && !force && Date.now() - entry.at < EPISODE_TTL) return { ...entry.data, fromCache: true };
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      try {
        const r = await C.fetchText(feedUrl, { xml: true, timeout: 20000, maxBytes: PODCAST_MAX_BYTES, truncate: true, headers: { Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        let res;
        try { res = await parsePodcastXml(r.truncated ? closeTruncatedFeed(r.text) : r.text, feedUrl); }
        catch { throw new Error('not a feed'); }
        cache.set(key, res);
        if (res.show.artwork && store.get('artwork')?.[feedUrl] !== res.show.artwork) {
          const art = { ...(store.get('artwork') || {}), [feedUrl]: res.show.artwork };
          const keys = Object.keys(art);
          if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete art[k];
          store.set('artwork', art);
        }
        // keep subscription metadata fresh
        const list = subs(); const s = list.find((x) => x.feedUrl === feedUrl);
        if (s && (s.title !== res.show.title || (!s.artwork && res.show.artwork))) { Object.assign(s, { title: res.show.title, artwork: s.artwork || res.show.artwork, author: s.author || res.show.author }); store.set('subs', list); }
        return res;
      } catch (e) {
        // the panels show this text: German, without the raw network error
        const err = feedError(e);
        if (entry) return { ...entry.data, fromCache: true, stale: true, error: err.message };
        throw err;
      }
      finally { inflight.delete(key); }
    })();
    inflight.set(key, p);
    return p;
  }

  ipcMain.handle('podcasts:search', async (e, term, lang) => {
    term = String(term || '').trim();
    if (!term) return [];
    const country = (lang || 'de').toLowerCase() === 'en' ? 'US' : 'DE';
    const url = `https://itunes.apple.com/search?media=podcast&entity=podcast&term=${encodeURIComponent(term)}&country=${country}&limit=25`;
    let json;
    try { json = await C.fetchJson(url, { timeout: 15000 }); }
    catch (err) { throw new Error('Das Podcast-Verzeichnis von Apple antwortet nicht. ' + feedError(err).message); }
    return (json.results || []).map(mapItunesResult).filter((r) => r.feedUrl);
  });

  ipcMain.handle('podcasts:curated', () => {
    const art = store.get('artwork') || {};
    const list = subs();
    return { topics: TOPICS, podcasts: CURATED.map((p) => ({ ...p, artwork: p.artwork || art[p.feedUrl] || list.find((s) => s.feedUrl === p.feedUrl)?.artwork || null, subscribed: list.some((s) => s.feedUrl === p.feedUrl) })) };
  });

  ipcMain.handle('podcasts:subscriptions', () => subs().map((s) => ({ ...s })));

  ipcMain.handle('podcasts:subscribe', async (e, feedUrl, meta) => {
    feedUrl = String(feedUrl || '').trim();
    if (!/^https?:\/\//i.test(feedUrl)) throw new Error('Die Adresse eines Podcast-Feeds beginnt mit http:// oder https://.');
    const list = subs();
    if (list.some((s) => s.feedUrl === feedUrl)) return list.find((s) => s.feedUrl === feedUrl);
    let sub = { feedUrl, title: meta?.title || feedUrl, author: meta?.author || null, artwork: meta?.artwork || null, homepage: meta?.homepage || null, addedAt: Date.now() };
    try { const res = await loadEpisodes(feedUrl); sub = { ...sub, title: meta?.title || res.show.title, author: sub.author || res.show.author, artwork: sub.artwork || res.show.artwork, homepage: sub.homepage || res.show.link, episodeCount: res.episodes.length }; }
    catch (err) { if (!meta?.title) throw err; sub.error = err.message; }
    list.push(sub);
    store.set('subs', list);
    return sub;
  });

  ipcMain.handle('podcasts:unsubscribe', (e, feedUrl) => { store.set('subs', subs().filter((s) => s.feedUrl !== feedUrl)); return true; });

  ipcMain.handle('podcasts:episodes', async (e, feedUrl, opts) => {
    const res = await loadEpisodes(feedUrl, !!opts?.force);
    const pos = store.get('positions') || {};
    return { ...res, episodes: res.episodes.map((ep) => ({ ...ep, position: pos[ep.id] || null })) };
  });

  ipcMain.handle('podcasts:importOpml', async () => {
    const r = await dialog.showOpenDialog(ctx.getMainWindow?.() || undefined, { title: 'OPML importieren', properties: ['openFile'], filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }, { name: 'Alle Dateien', extensions: ['*'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const xml = fs.readFileSync(r.filePaths[0], 'utf8');
    const entries = parseOpml(xml);
    const list = subs(); let added = 0;
    for (const en of entries) {
      if (list.some((s) => s.feedUrl === en.feedUrl)) continue;
      list.push({ feedUrl: en.feedUrl, title: en.title, author: null, artwork: null, homepage: en.homepage, addedAt: Date.now(), imported: true });
      added++;
    }
    store.set('subs', list);
    // enrich in the background (artwork, author)
    (async () => { for (const en of entries) { try { await loadEpisodes(en.feedUrl); } catch {} } })();
    return { total: entries.length, added, file: r.filePaths[0] };
  });

  ipcMain.handle('podcasts:exportOpml', async () => {
    const r = await dialog.showSaveDialog(ctx.getMainWindow?.() || undefined, { title: 'OPML exportieren', defaultPath: 'cozy-shelves-podcasts.opml', filters: [{ name: 'OPML', extensions: ['opml'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, buildOpml(subs()), 'utf8');
    return r.filePath;
  });

  ipcMain.handle('podcasts:positions', () => ({ ...(store.get('positions') || {}) }));

  ipcMain.handle('podcasts:setPosition', (e, episodeId, seconds, done) => {
    if (!episodeId) return null;
    const positions = { ...(store.get('positions') || {}) };
    positions[episodeId] = { seconds: Math.max(0, Math.round(seconds || 0)), done: !!done, updatedAt: Date.now() };
    const keys = Object.keys(positions);
    if (keys.length > 2000) { keys.sort((a, b) => positions[a].updatedAt - positions[b].updatedAt); for (const k of keys.slice(0, keys.length - 2000)) delete positions[k]; }
    store.set('positions', positions);
    return positions[episodeId];
  });

  app.on('before-quit', () => { try { store.flush(); } catch {} });
}

module.exports = { register, parsePodcastXml, closeTruncatedFeed, migrateSubscriptions, MOVED_FEEDS, parseOpml, buildOpml, parseDuration, mapItunesResult, CURATED, TOPICS, LEGACY_TOPIC_MAP, PODCAST_MAX_BYTES };
