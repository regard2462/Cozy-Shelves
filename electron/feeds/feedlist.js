// Curated list of free German & English feeds for Cozy Shelves reading room.
//
// The category set is NEUTRAL and identical for every user — a classic reading room,
// not one person's interests. Category ids are a persisted contract (they are stored on
// user-added feeds and used by the news panel), so ids are only ever added, never
// silently renamed: LEGACY_CATEGORY_MAP migrates the ones that were renamed once.
//
// fullText: true        → the feed itself carries the whole article (content:encoded)
//           'readability' → the article page is fetched and extracted with Readability
// type: 'tagesschau'    → JSON API (https://www.tagesschau.de/api2u/news/) delivers full text + images
// Some URLs may go stale over time – the in-app health check marks broken feeds.

const CATEGORIES = [
  { id: 'news', de: 'Nachrichten', en: 'News', icon: '📰', tagline: { de: 'Zeitungen aus aller Welt', en: 'Newspapers from around the world' } },
  { id: 'politics', de: 'Politik & Welt', en: 'Politics & World', icon: '🌍', tagline: { de: 'Analysen zur Weltlage', en: 'Analysis of world affairs' } },
  { id: 'business', de: 'Wirtschaft & Finanzen', en: 'Business & Finance', icon: '📈', tagline: { de: 'Märkte, Geldanlage, Ökonomie', en: 'Markets, investing, economics' } },
  { id: 'science', de: 'Wissenschaft & Natur', en: 'Science & Nature', icon: '🌿', tagline: { de: 'Forschung, Natur, Kosmos', en: 'Research, nature, cosmos' } },
  { id: 'technology', de: 'Technik & Digitales', en: 'Technology & Digital', icon: '💻', tagline: { de: 'IT, Netzpolitik, Sicherheit', en: 'IT, digital policy, security' } },
  { id: 'culture', de: 'Kultur & Kunst', en: 'Culture & Art', icon: '🎨', tagline: { de: 'Kunst, Musik, Ausstellungen', en: 'Art, music, exhibitions' } },
  { id: 'design', de: 'Architektur & Design', en: 'Architecture & Design', icon: '🏛', tagline: { de: 'Bauen, Räume, Gestaltung', en: 'Buildings, spaces, design' } },
  { id: 'history', de: 'Geschichte & Philosophie', en: 'History & Philosophy', icon: '🏺', tagline: { de: 'Vergangenheit und Denken', en: 'The past and thought' } },
  { id: 'literature', de: 'Literatur & Essays', en: 'Literature & Essays', icon: '📖', tagline: { de: 'Bücher, Essays, Langstrecke', en: 'Books, essays, long form' } },
  { id: 'sports', de: 'Sport & Spiel', en: 'Sports & Games', icon: '♞', tagline: { de: 'Sport, Schach, Spiele', en: 'Sport, chess, games' } },
  { id: 'health', de: 'Gesundheit & Leben', en: 'Health & Living', icon: '🌱', tagline: { de: 'Medizin, Ernährung, Küche', en: 'Medicine, nutrition, cooking' } },
  { id: 'travel', de: 'Reisen & Draußen', en: 'Travel & Outdoors', icon: '🧭', tagline: { de: 'Unterwegs, Berge, Entdeckungen', en: 'On the road, mountains, discoveries' } },
  { id: 'custom', de: 'Eigene', en: 'My feeds', icon: '✎', tagline: { de: 'Selbst hinzugefügte Feeds', en: 'Feeds you added yourself' } },
];

/** Category ids that existed in earlier versions → current id (feeds-state.json migration). */
const LEGACY_CATEGORY_MAP = {
  nature: 'science',
  finance: 'business',
  tech: 'technology',
  art: 'culture',
  architecture: 'design',
  longreads: 'literature',
  geopolitics: 'politics',
  chess: 'sports',
  misc: 'custom',
};

const F = (id, title, url, lang, category, fullText, hasImages, homepage, extra = {}) => ({ id, title, url, lang, category, fullText, hasImages, homepage, ...extra });
const TS = 'https://www.tagesschau.de/api2u/news/';

const FEEDS = [
  // ---- Nachrichten ----------------------------------------------------------------------------------
  F('tagesschau', 'tagesschau', TS, 'de', 'news', true, true, 'https://www.tagesschau.de', { type: 'tagesschau', rss: 'https://www.tagesschau.de/index~rss2.xml' }),
  F('tagesschau-inland', 'tagesschau · Inland', TS + '?ressort=inland', 'de', 'news', true, true, 'https://www.tagesschau.de/inland', { type: 'tagesschau', rss: 'https://www.tagesschau.de/inland/index~rss2.xml' }),
  F('tagesschau-ausland', 'tagesschau · Ausland', TS + '?ressort=ausland', 'de', 'news', true, true, 'https://www.tagesschau.de/ausland', { type: 'tagesschau', rss: 'https://www.tagesschau.de/ausland/index~rss2.xml' }),
  F('dw-de', 'Deutsche Welle', 'https://rss.dw.com/xml/rss-de-all', 'de', 'news', 'readability', true, 'https://www.dw.com/de'),
  F('dw-en', 'DW News', 'https://rss.dw.com/xml/rss-en-all', 'en', 'news', 'readability', true, 'https://www.dw.com/en'),
  F('taz', 'taz', 'https://taz.de/!p4608;rss/', 'de', 'news', 'readability', false, 'https://taz.de'),
  F('zeit', 'ZEIT ONLINE', 'https://newsfeed.zeit.de/index', 'de', 'news', 'readability', true, 'https://www.zeit.de'),
  F('spiegel', 'DER SPIEGEL', 'https://www.spiegel.de/schlagzeilen/index.rss', 'de', 'news', 'readability', true, 'https://www.spiegel.de'),
  F('sz', 'Süddeutsche Zeitung', 'https://rss.sueddeutsche.de/rss/Topthemen', 'de', 'news', 'readability', false, 'https://www.sueddeutsche.de'),
  F('faz', 'FAZ', 'https://www.faz.net/rss/aktuell/', 'de', 'news', 'readability', true, 'https://www.faz.net'),
  F('dlf', 'Deutschlandfunk', 'https://www.deutschlandfunk.de/nachrichten-100.rss', 'de', 'news', 'readability', false, 'https://www.deutschlandfunk.de'),
  F('nzz', 'NZZ', 'https://www.nzz.ch/recent.rss', 'de', 'news', 'readability', true, 'https://www.nzz.ch'),
  F('srf', 'SRF News', 'https://www.srf.ch/news/bnf/rss/1646', 'de', 'news', 'readability', true, 'https://www.srf.ch/news'),
  F('orf', 'ORF News', 'https://rss.orf.at/news.xml', 'de', 'news', 'readability', false, 'https://orf.at'),
  F('derstandard', 'DER STANDARD', 'https://www.derstandard.at/rss', 'de', 'news', 'readability', true, 'https://www.derstandard.at'),
  F('zdfheute', 'ZDFheute', 'https://www.zdf.de/rss/zdf/nachrichten', 'de', 'news', 'readability', true, 'https://www.zdf.de/nachrichten'),
  F('bbk', 'BBK · Bevölkerungsschutz', 'https://www.bbk.bund.de/DE/Infothek/Unsere-Meldungen/RSSNewsfeed/_functions/rssnewsfeed-bbk.xml', 'de', 'news', 'readability', false, 'https://www.bbk.bund.de'),
  F('guardian-world', 'The Guardian · World', 'https://www.theguardian.com/world/rss', 'en', 'news', 'readability', true, 'https://www.theguardian.com/world'),
  F('guardian-europe', 'The Guardian · Europe', 'https://www.theguardian.com/world/europe-news/rss', 'en', 'news', 'readability', true, 'https://www.theguardian.com/world/europe-news'),
  F('bbc', 'BBC News', 'https://feeds.bbci.co.uk/news/rss.xml', 'en', 'news', 'readability', true, 'https://www.bbc.co.uk/news'),
  F('bbc-world', 'BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml', 'en', 'news', 'readability', true, 'https://www.bbc.co.uk/news/world'),
  F('npr', 'NPR News', 'https://feeds.npr.org/1001/rss.xml', 'en', 'news', 'readability', true, 'https://www.npr.org'),
  F('aljazeera', 'Al Jazeera English', 'https://www.aljazeera.com/xml/rss/all.xml', 'en', 'news', 'readability', true, 'https://www.aljazeera.com'),
  F('france24', 'France 24', 'https://www.france24.com/en/rss', 'en', 'news', 'readability', true, 'https://www.france24.com/en/'),
  F('nyt-world', 'The New York Times · World', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', 'en', 'news', 'readability', true, 'https://www.nytimes.com/section/world'),
  F('euronews', 'euronews', 'https://www.euronews.com/rss', 'en', 'news', 'readability', true, 'https://www.euronews.com'),
  F('conversation-uk', 'The Conversation', 'https://theconversation.com/uk/articles.atom', 'en', 'news', true, true, 'https://theconversation.com/uk'),

  // ---- Politik & Welt -------------------------------------------------------------------------------
  F('dlf-politik', 'Deutschlandfunk · Politik', 'https://www.deutschlandfunk.de/politikportal-100.rss', 'de', 'politics', 'readability', false, 'https://www.deutschlandfunk.de/politik'),
  F('zeit-politik', 'ZEIT · Politik', 'https://newsfeed.zeit.de/politik/index', 'de', 'politics', 'readability', true, 'https://www.zeit.de/politik'),
  F('spiegel-politik', 'SPIEGEL · Politik', 'https://www.spiegel.de/politik/index.rss', 'de', 'politics', 'readability', true, 'https://www.spiegel.de/politik/'),
  F('swp', 'SWP Berlin', 'https://www.swp-berlin.org/rss.xml', 'de', 'politics', 'readability', false, 'https://www.swp-berlin.org'),
  F('correctiv', 'CORRECTIV', 'https://correctiv.org/feed/', 'de', 'politics', 'readability', true, 'https://correctiv.org'),
  F('propublica', 'ProPublica', 'https://www.propublica.org/feeds/propublica/main', 'en', 'politics', true, true, 'https://www.propublica.org'),
  F('bellingcat', 'Bellingcat', 'https://www.bellingcat.com/feed/', 'en', 'politics', 'readability', true, 'https://www.bellingcat.com'),
  F('foreignpolicy', 'Foreign Policy', 'https://foreignpolicy.com/feed/', 'en', 'politics', 'readability', true, 'https://foreignpolicy.com'),
  F('thediplomat', 'The Diplomat', 'https://thediplomat.com/feed/', 'en', 'politics', 'readability', true, 'https://thediplomat.com'),
  F('cfr', 'Council on Foreign Relations', 'https://www.cfr.org/feed/', 'en', 'politics', 'readability', true, 'https://www.cfr.org'),
  F('rs', 'Responsible Statecraft', 'https://responsiblestatecraft.org/feeds/feed.rss', 'en', 'politics', 'readability', true, 'https://responsiblestatecraft.org'),
  F('lawfare', 'Lawfare', 'https://www.lawfaremedia.org/feeds/articles', 'en', 'politics', 'readability', false, 'https://www.lawfaremedia.org'),
  F('wotr', 'War on the Rocks', 'https://warontherocks.com/feed/', 'en', 'politics', 'readability', true, 'https://warontherocks.com'),
  F('politico-eu', 'POLITICO Europe', 'https://www.politico.eu/feed/', 'en', 'politics', 'readability', true, 'https://www.politico.eu'),
  F('kyivindependent', 'The Kyiv Independent', 'https://kyivindependent.com/news-archive/rss/', 'en', 'politics', 'readability', true, 'https://kyivindependent.com'),
  F('guardian-commentisfree', 'The Guardian · Opinion', 'https://www.theguardian.com/commentisfree/rss', 'en', 'politics', 'readability', true, 'https://www.theguardian.com/commentisfree'),

  // ---- Wirtschaft & Finanzen ------------------------------------------------------------------------
  F('tagesschau-wirtschaft', 'tagesschau · Wirtschaft', TS + '?ressort=wirtschaft', 'de', 'business', true, true, 'https://www.tagesschau.de/wirtschaft', { type: 'tagesschau', rss: 'https://www.tagesschau.de/wirtschaft/index~rss2.xml' }),
  F('handelsblatt', 'Handelsblatt', 'https://www.handelsblatt.com/contentexport/feed/schlagzeilen', 'de', 'business', 'readability', true, 'https://www.handelsblatt.com'),
  F('wiwo', 'WirtschaftsWoche', 'https://www.wiwo.de/contentexport/feed/rss/schlagzeilen', 'de', 'business', 'readability', true, 'https://www.wiwo.de'),
  F('manager-magazin', 'manager magazin', 'https://www.manager-magazin.de/news/index.rss', 'de', 'business', 'readability', true, 'https://www.manager-magazin.de'),
  F('capital', 'Capital', 'https://www.capital.de/rss', 'de', 'business', 'readability', true, 'https://www.capital.de'),
  F('zeit-wirtschaft', 'ZEIT · Wirtschaft', 'https://newsfeed.zeit.de/wirtschaft/index', 'de', 'business', 'readability', true, 'https://www.zeit.de/wirtschaft'),
  F('finanzmarktwelt', 'finanzmarktwelt.de', 'https://finanzmarktwelt.de/feed/', 'de', 'business', 'readability', true, 'https://finanzmarktwelt.de'),
  F('finanzwesir', 'Finanzwesir', 'https://www.finanzwesir.com/feed/', 'de', 'business', true, false, 'https://www.finanzwesir.com'),
  F('ecb', 'ECB Press', 'https://www.ecb.europa.eu/rss/press.html', 'en', 'business', 'readability', false, 'https://www.ecb.europa.eu'),
  F('marginalrevolution', 'Marginal Revolution', 'https://marginalrevolution.com/feed', 'en', 'business', true, false, 'https://marginalrevolution.com'),
  F('calculatedrisk', 'Calculated Risk', 'https://www.calculatedriskblog.com/feeds/posts/default', 'en', 'business', true, true, 'https://www.calculatedriskblog.com'),
  F('awocs', 'A Wealth of Common Sense', 'https://awealthofcommonsense.com/feed/', 'en', 'business', true, true, 'https://awealthofcommonsense.com'),
  F('collabfund', 'Collaborative Fund', 'https://collabfund.com/feed.xml', 'en', 'business', true, false, 'https://collabfund.com/blog/'),
  F('ofdollars', 'Of Dollars and Data', 'https://ofdollarsanddata.com/feed/', 'en', 'business', true, true, 'https://ofdollarsanddata.com'),
  F('bogleheads', 'Bogleheads Blog', 'https://www.bogleheads.org/blog/feed/', 'en', 'business', true, false, 'https://www.bogleheads.org/blog/'),
  F('cnbc', 'CNBC Top News', 'https://www.cnbc.com/id/100003114/device/rss/rss.html', 'en', 'business', 'readability', true, 'https://www.cnbc.com'),
  F('economist-finance', 'The Economist · Finance', 'https://www.economist.com/finance-and-economics/rss.xml', 'en', 'business', 'readability', true, 'https://www.economist.com/finance-and-economics'),
  F('guardian-business', 'The Guardian · Business', 'https://www.theguardian.com/uk/business/rss', 'en', 'business', 'readability', true, 'https://www.theguardian.com/business'),

  // ---- Wissenschaft & Natur -------------------------------------------------------------------------
  F('spektrum', 'Spektrum der Wissenschaft', 'https://www.spektrum.de/alias/rss/spektrum-de-rss-feed/996406', 'de', 'science', 'readability', true, 'https://www.spektrum.de'),
  F('scinexx', 'scinexx', 'https://www.scinexx.de/feed/', 'de', 'science', 'readability', true, 'https://www.scinexx.de'),
  F('wissenschaft-de', 'wissenschaft.de', 'https://www.wissenschaft.de/feed/', 'de', 'science', 'readability', true, 'https://www.wissenschaft.de'),
  F('mpg', 'Max-Planck-Gesellschaft', 'https://www.mpg.de/de/forschung.rss', 'de', 'science', 'readability', true, 'https://www.mpg.de'),
  F('geo', 'GEO', 'https://www.geo.de/feed/rss/geo/', 'de', 'science', 'readability', true, 'https://www.geo.de'),
  F('dlf-forschung', 'Deutschlandfunk · Forschung aktuell', 'https://www.deutschlandfunk.de/forschung-aktuell-100.rss', 'de', 'science', 'readability', false, 'https://www.deutschlandfunk.de/forschung-aktuell-100.html'),
  F('weltderphysik', 'Welt der Physik', 'https://www.weltderphysik.de/rss.xml', 'de', 'science', 'readability', true, 'https://www.weltderphysik.de'),
  F('zeit-wissen', 'ZEIT · Wissen', 'https://newsfeed.zeit.de/wissenschaft/index', 'de', 'science', 'readability', true, 'https://www.zeit.de/wissen'),
  F('quanta', 'Quanta Magazine', 'https://www.quantamagazine.org/feed/', 'en', 'science', true, true, 'https://www.quantamagazine.org'),
  F('knowable', 'Knowable Magazine', 'https://knowablemagazine.org/rss', 'en', 'science', 'readability', true, 'https://knowablemagazine.org'),
  F('undark', 'Undark', 'https://undark.org/feed/', 'en', 'science', 'readability', true, 'https://undark.org'),
  F('physorg', 'Phys.org', 'https://phys.org/rss-feed/', 'en', 'science', 'readability', true, 'https://phys.org'),
  F('sciencedaily', 'ScienceDaily', 'https://www.sciencedaily.com/rss/top/science.xml', 'en', 'science', 'readability', false, 'https://www.sciencedaily.com'),
  F('nasa', 'NASA News', 'https://www.nasa.gov/rss/dyn/breaking_news.rss', 'en', 'science', 'readability', true, 'https://www.nasa.gov'),
  F('nasa-eo', 'NASA Earth Observatory', 'https://earthobservatory.nasa.gov/feeds/image-of-the-day.rss', 'en', 'science', 'readability', true, 'https://earthobservatory.nasa.gov'),
  F('esa', 'ESA Space News', 'https://www.esa.int/rssfeed/Our_Activities/Space_News', 'en', 'science', 'readability', true, 'https://www.esa.int'),
  F('apod', 'Astronomy Picture of the Day', 'https://apod.nasa.gov/apod.rss', 'en', 'science', 'readability', true, 'https://apod.nasa.gov/apod/'),
  F('biographic', 'bioGraphic', 'https://www.biographic.com/feed/', 'en', 'science', 'readability', true, 'https://www.biographic.com'),
  F('mongabay', 'Mongabay', 'https://news.mongabay.com/feed/', 'en', 'science', true, true, 'https://news.mongabay.com'),
  F('e360', 'Yale Environment 360', 'https://e360.yale.edu/feed.xml', 'en', 'science', 'readability', true, 'https://e360.yale.edu'),
  F('insideclimate', 'Inside Climate News', 'https://insideclimatenews.org/feed/', 'en', 'science', 'readability', true, 'https://insideclimatenews.org'),
  F('emergence', 'Emergence Magazine', 'https://emergencemagazine.org/feed/', 'en', 'science', 'readability', true, 'https://emergencemagazine.org'),
  F('smithsonian', 'Smithsonian Magazine', 'https://www.smithsonianmag.com/rss/latest_articles/', 'en', 'science', 'readability', true, 'https://www.smithsonianmag.com'),

  // ---- Technik & Digitales --------------------------------------------------------------------------
  F('heise', 'heise online', 'https://www.heise.de/rss/heise-atom.xml', 'de', 'technology', 'readability', true, 'https://www.heise.de'),
  F('heise-security', 'heise Security', 'https://www.heise.de/security/rss/news-atom.xml', 'de', 'technology', 'readability', false, 'https://www.heise.de/security/'),
  F('golem', 'Golem.de', 'https://rss.golem.de/rss.php?feed=RSS2.0', 'de', 'technology', 'readability', true, 'https://www.golem.de'),
  F('t3n', 't3n', 'https://t3n.de/rss.xml', 'de', 'technology', 'readability', true, 'https://t3n.de'),
  F('netzpolitik', 'netzpolitik.org', 'https://netzpolitik.org/feed/', 'de', 'technology', true, true, 'https://netzpolitik.org'),
  F('kuketz', 'Kuketz-Blog', 'https://www.kuketz-blog.de/feed/', 'de', 'technology', true, true, 'https://www.kuketz-blog.de'),
  F('zeit-digital', 'ZEIT · Digital', 'https://newsfeed.zeit.de/digital/index', 'de', 'technology', 'readability', true, 'https://www.zeit.de/digital'),
  F('arstechnica', 'Ars Technica', 'https://feeds.arstechnica.com/arstechnica/index', 'en', 'technology', true, true, 'https://arstechnica.com'),
  F('theverge', 'The Verge', 'https://www.theverge.com/rss/index.xml', 'en', 'technology', true, true, 'https://www.theverge.com'),
  F('wired', 'WIRED', 'https://www.wired.com/feed/rss', 'en', 'technology', 'readability', true, 'https://www.wired.com'),
  F('mittr', 'MIT Technology Review', 'https://www.technologyreview.com/feed/', 'en', 'technology', 'readability', true, 'https://www.technologyreview.com'),
  F('hn', 'Hacker News · Front Page', 'https://hnrss.org/frontpage', 'en', 'technology', 'readability', false, 'https://news.ycombinator.com'),
  F('krebs', 'Krebs on Security', 'https://krebsonsecurity.com/feed/', 'en', 'technology', true, true, 'https://krebsonsecurity.com'),
  F('schneier', 'Schneier on Security', 'https://www.schneier.com/feed/atom/', 'en', 'technology', true, false, 'https://www.schneier.com'),
  F('thehackernews', 'The Hacker News', 'https://feeds.feedburner.com/TheHackersNews', 'en', 'technology', 'readability', true, 'https://thehackernews.com'),
  F('eff', 'EFF Deeplinks', 'https://www.eff.org/rss/updates.xml', 'en', 'technology', true, false, 'https://www.eff.org/deeplinks'),
  F('bbc-technology', 'BBC Technology', 'https://feeds.bbci.co.uk/news/technology/rss.xml', 'en', 'technology', 'readability', true, 'https://www.bbc.co.uk/news/technology'),

  // ---- Kultur & Kunst -------------------------------------------------------------------------------
  F('zeit-kultur', 'ZEIT · Kultur', 'https://newsfeed.zeit.de/feuilleton/index', 'de', 'culture', 'readability', true, 'https://www.zeit.de/kultur'),
  F('monopol', 'Monopol', 'https://www.monopol-magazin.de/rss.xml', 'de', 'culture', 'readability', true, 'https://www.monopol-magazin.de'),
  F('perlentaucher', 'Perlentaucher', 'https://www.perlentaucher.de/index.rss', 'de', 'culture', 'readability', false, 'https://www.perlentaucher.de'),
  F('nmz', 'neue musikzeitung', 'https://www.nmz.de/rss.xml', 'de', 'culture', 'readability', true, 'https://www.nmz.de'),
  F('colossal', 'Colossal', 'https://www.thisiscolossal.com/feed/', 'en', 'culture', true, true, 'https://www.thisiscolossal.com'),
  F('hyperallergic', 'Hyperallergic', 'https://hyperallergic.com/feed/', 'en', 'culture', 'readability', true, 'https://hyperallergic.com'),
  F('artnews', 'ARTnews', 'https://www.artnews.com/feed/', 'en', 'culture', 'readability', true, 'https://www.artnews.com'),
  F('artnewspaper', 'The Art Newspaper', 'https://www.theartnewspaper.com/rss.xml', 'en', 'culture', 'readability', true, 'https://www.theartnewspaper.com'),
  F('pdr', 'The Public Domain Review', 'https://publicdomainreview.org/rss.xml', 'en', 'culture', 'readability', true, 'https://publicdomainreview.org'),
  F('openculture', 'Open Culture', 'https://www.openculture.com/feed', 'en', 'culture', true, true, 'https://www.openculture.com'),
  F('guardian-culture', 'The Guardian · Culture', 'https://www.theguardian.com/culture/rss', 'en', 'culture', 'readability', true, 'https://www.theguardian.com/culture'),

  // ---- Architektur & Design -------------------------------------------------------------------------
  F('baunetz', 'BauNetz', 'https://www.baunetz.de/meldungen/rss.xml', 'de', 'design', 'readability', true, 'https://www.baunetz.de'),
  F('designtagebuch', 'Design Tagebuch', 'https://www.designtagebuch.de/feed/', 'de', 'design', true, true, 'https://www.designtagebuch.de'),
  F('dezeen', 'Dezeen', 'https://www.dezeen.com/feed/', 'en', 'design', true, true, 'https://www.dezeen.com'),
  F('archdaily', 'ArchDaily', 'https://www.archdaily.com/feed', 'en', 'design', true, true, 'https://www.archdaily.com'),
  F('designboom', 'designboom', 'https://www.designboom.com/feed/', 'en', 'design', 'readability', true, 'https://www.designboom.com'),
  F('wallpaper', 'Wallpaper*', 'https://www.wallpaper.com/rss', 'en', 'design', 'readability', true, 'https://www.wallpaper.com'),
  F('yanko', 'Yanko Design', 'https://www.yankodesign.com/feed/', 'en', 'design', true, true, 'https://www.yankodesign.com'),
  F('core77', 'Core77', 'https://www.core77.com/blog/rss.xml', 'en', 'design', 'readability', true, 'https://www.core77.com'),

  // ---- Geschichte & Philosophie ---------------------------------------------------------------------
  F('gdg', 'Geschichte der Gegenwart', 'https://geschichtedergegenwart.ch/feed/', 'de', 'history', true, true, 'https://geschichtedergegenwart.ch'),
  F('philomag', 'Philosophie Magazin', 'https://www.philomag.de/rss.xml', 'de', 'history', 'readability', true, 'https://www.philomag.de'),
  F('zeit-geschichte', 'ZEIT · Geschichte', 'https://newsfeed.zeit.de/wissen/zeit-geschichte/index', 'de', 'history', 'readability', true, 'https://www.zeit.de/zeit-geschichte'),
  F('historytoday', 'History Today', 'https://www.historytoday.com/feed/rss.xml', 'en', 'history', 'readability', true, 'https://www.historytoday.com'),
  F('dailystoic', 'Daily Stoic', 'https://dailystoic.com/feed/', 'en', 'history', true, false, 'https://dailystoic.com'),
  F('3qd', '3 Quarks Daily', 'https://3quarksdaily.com/feed', 'en', 'history', true, true, 'https://3quarksdaily.com'),
  F('historyextra', 'HistoryExtra · BBC History', 'https://www.historyextra.com/feed/', 'en', 'history', 'readability', true, 'https://www.historyextra.com'),
  F('spiegel-geschichte', 'SPIEGEL · Geschichte', 'https://www.spiegel.de/geschichte/index.rss', 'de', 'history', 'readability', true, 'https://www.spiegel.de/geschichte/'),
  F('smithsonian-history', 'Smithsonian · History', 'https://www.smithsonianmag.com/rss/history/', 'en', 'history', 'readability', true, 'https://www.smithsonianmag.com/history/'),

  // ---- Literatur & Essays ---------------------------------------------------------------------------
  F('54books', '54books', 'https://www.54books.de/feed/', 'de', 'literature', true, false, 'https://www.54books.de'),
  F('literaturcafe', 'literaturcafe.de', 'https://www.literaturcafe.de/feed/', 'de', 'literature', 'readability', true, 'https://www.literaturcafe.de'),
  F('dlf-buecher', 'Deutschlandfunk · Büchermarkt', 'https://www.deutschlandfunk.de/buechermarkt-100.rss', 'de', 'literature', 'readability', false, 'https://www.deutschlandfunk.de/buechermarkt-100.html'),
  F('longreads', 'Longreads', 'https://longreads.com/feed/', 'en', 'literature', 'readability', true, 'https://longreads.com'),
  F('aeon', 'Aeon', 'https://aeon.co/feed.rss', 'en', 'literature', 'readability', true, 'https://aeon.co'),
  F('nautilus', 'Nautilus', 'https://nautil.us/feed/', 'en', 'literature', 'readability', true, 'https://nautil.us'),
  F('lithub', 'Literary Hub', 'https://lithub.com/feed/', 'en', 'literature', 'readability', true, 'https://lithub.com'),
  F('parisreview', 'The Paris Review Daily', 'https://www.theparisreview.org/blog/feed/', 'en', 'literature', 'readability', true, 'https://www.theparisreview.org/blog/'),
  F('gutenberg', 'Project Gutenberg · New Books', 'https://www.gutenberg.org/cache/epub/feeds/today.rss', 'en', 'literature', false, false, 'https://www.gutenberg.org'),
  F('newyorker', 'The New Yorker', 'https://www.newyorker.com/feed/everything', 'en', 'literature', 'readability', true, 'https://www.newyorker.com'),
  F('atlantic', 'The Atlantic', 'https://www.theatlantic.com/feed/all/', 'en', 'literature', 'readability', true, 'https://www.theatlantic.com'),
  F('marginalian', 'The Marginalian', 'https://www.themarginalian.org/feed/', 'en', 'literature', true, true, 'https://www.themarginalian.org'),
  F('guardian-books', 'The Guardian · Books', 'https://www.theguardian.com/books/rss', 'en', 'literature', 'readability', true, 'https://www.theguardian.com/books'),

  // ---- Sport & Spiel --------------------------------------------------------------------------------
  F('sportschau', 'Sportschau', 'https://www.sportschau.de/index~rss2.xml', 'de', 'sports', 'readability', true, 'https://www.sportschau.de'),
  F('kicker', 'kicker', 'https://newsfeed.kicker.de/news/aktuell', 'de', 'sports', 'readability', true, 'https://www.kicker.de'),
  F('sz-sport', 'Süddeutsche · Sport', 'https://rss.sueddeutsche.de/rss/Sport', 'de', 'sports', 'readability', false, 'https://www.sueddeutsche.de/sport'),
  F('bbc-sport', 'BBC Sport', 'https://feeds.bbci.co.uk/sport/rss.xml', 'en', 'sports', 'readability', true, 'https://www.bbc.co.uk/sport'),
  F('guardian-sport', 'The Guardian · Sport', 'https://www.theguardian.com/sport/rss', 'en', 'sports', 'readability', true, 'https://www.theguardian.com/sport'),
  F('chessbase-de', 'ChessBase', 'https://de.chessbase.com/feed', 'de', 'sports', 'readability', true, 'https://de.chessbase.com'),
  F('perlen', 'Perlen vom Bodensee', 'https://perlenvombodensee.de/feed/', 'de', 'sports', true, true, 'https://perlenvombodensee.de'),
  F('lichess', 'lichess.org Blog', 'https://lichess.org/blog.atom', 'en', 'sports', true, true, 'https://lichess.org/blog'),
  F('chessbase-en', 'ChessBase (EN)', 'https://en.chessbase.com/feed', 'en', 'sports', 'readability', true, 'https://en.chessbase.com'),
  F('twic', 'The Week in Chess', 'https://theweekinchess.com/twic-rss-feed', 'en', 'sports', 'readability', false, 'https://theweekinchess.com'),
  F('chesscom', 'Chess.com News', 'https://www.chess.com/rss/news', 'en', 'sports', 'readability', true, 'https://www.chess.com/news'),

  // ---- Gesundheit & Leben ---------------------------------------------------------------------------
  F('aerzteblatt', 'Deutsches Ärzteblatt', 'https://www.aerzteblatt.de/rss/news', 'de', 'health', 'readability', false, 'https://www.aerzteblatt.de'),
  F('zeit-gesundheit', 'ZEIT · Gesundheit', 'https://newsfeed.zeit.de/gesundheit/index', 'de', 'health', 'readability', true, 'https://www.zeit.de/gesundheit'),
  F('psychologie-heute', 'Psychologie Heute', 'https://www.psychologie-heute.de/feed.rss', 'de', 'health', 'readability', true, 'https://www.psychologie-heute.de'),
  F('utopia', 'Utopia.de', 'https://utopia.de/feed/', 'de', 'health', 'readability', true, 'https://utopia.de'),
  F('nyt-well', 'The New York Times · Well', 'https://rss.nytimes.com/services/xml/rss/nyt/Well.xml', 'en', 'health', 'readability', true, 'https://www.nytimes.com/section/well'),
  F('guardian-food', 'The Guardian · Food', 'https://www.theguardian.com/food/rss', 'en', 'health', 'readability', true, 'https://www.theguardian.com/food'),
  F('smittenkitchen', 'Smitten Kitchen', 'https://smittenkitchen.com/feed/', 'en', 'health', true, true, 'https://smittenkitchen.com'),
  F('spiegel-gesundheit', 'SPIEGEL · Gesundheit', 'https://www.spiegel.de/gesundheit/index.rss', 'de', 'health', 'readability', true, 'https://www.spiegel.de/gesundheit/'),
  F('faz-medizin', 'FAZ · Medizin & Ernährung', 'https://www.faz.net/rss/aktuell/wissen/medizin-ernaehrung/', 'de', 'health', 'readability', true, 'https://www.faz.net/aktuell/wissen/medizin-ernaehrung/'),
  F('guardian-health', 'The Guardian · Health', 'https://www.theguardian.com/society/health/rss', 'en', 'health', 'readability', true, 'https://www.theguardian.com/society/health'),

  // ---- Reisen & Draußen -----------------------------------------------------------------------------
  F('zeit-reisen', 'ZEIT · Entdecken', 'https://newsfeed.zeit.de/entdecken/index', 'de', 'travel', 'readability', true, 'https://www.zeit.de/reisen'),
  F('sz-reise', 'Süddeutsche · Reise', 'https://rss.sueddeutsche.de/rss/Reise', 'de', 'travel', 'readability', false, 'https://www.sueddeutsche.de/reise'),
  F('atlasobscura', 'Atlas Obscura', 'https://www.atlasobscura.com/feeds/latest', 'en', 'travel', 'readability', true, 'https://www.atlasobscura.com'),
  F('outside', 'Outside', 'https://www.outsideonline.com/feed/', 'en', 'travel', 'readability', true, 'https://www.outsideonline.com'),
  F('adventurejournal', 'Adventure Journal', 'https://www.adventure-journal.com/feed/', 'en', 'travel', true, true, 'https://www.adventure-journal.com'),
  F('guardian-travel', 'The Guardian · Travel', 'https://www.theguardian.com/travel/rss', 'en', 'travel', 'readability', true, 'https://www.theguardian.com/travel'),
  F('spiegel-reise', 'SPIEGEL · Reise', 'https://www.spiegel.de/reise/index.rss', 'de', 'travel', 'readability', true, 'https://www.spiegel.de/reise/'),
  F('faz-reise', 'FAZ · Reise', 'https://www.faz.net/rss/aktuell/reise/', 'de', 'travel', 'readability', true, 'https://www.faz.net/aktuell/reise/'),
  F('cntraveler', 'Condé Nast Traveler', 'https://www.cntraveler.com/feed/rss', 'en', 'travel', 'readability', true, 'https://www.cntraveler.com'),
];

function feedById(id) { return FEEDS.find((f) => f.id === id) || null; }
function categoryById(id) { return CATEGORIES.find((c) => c.id === id) || null; }
/** Current id for a (possibly legacy) category id — unknown ids fall back to 'custom'. */
function migrateCategoryId(id) {
  if (!id) return 'custom';
  if (CATEGORIES.some((c) => c.id === id)) return id;
  return LEGACY_CATEGORY_MAP[id] || 'custom';
}

module.exports = { CATEGORIES, FEEDS, LEGACY_CATEGORY_MAP, feedById, categoryById, migrateCategoryId };
