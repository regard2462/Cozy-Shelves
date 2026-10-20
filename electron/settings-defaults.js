// The defaults of every setting, the migrations of older files and the appearance helpers. Pure (no Electron):
// electron/settings.js uses them for settings.json, the browser version (app/src/core/api-web.js) for its IndexedDB copy.
const DEFAULTS = {
  language: 'de',
  firstRun: true,
  // appearance of the 2D interface: 'light' (Hell), 'sepia' (Sepia) or 'dark' (Dunkel)
  ui: { theme: 'sepia' },
  // the plaster walls above the panelling: 'white', 'cream', 'sage', 'dove', 'terracotta' or 'graffiti' (a mural,
  // `seed` picks the variant; app/src/world/walls.js)
  walls: { style: 'white', seed: 1 },
  // the floor of the hall, the passage and the book room (app/src/world/floors.js): 'oak' (Eichendielen),
  // 'herringbone', 'walnut', 'maple', 'marble', 'terracotta', 'stone', 'terrazzo', 'carpet' or 'cement' (colourful tiles)
  floor: 'oak',
  // the lamps switched off by hand (E or a click on a lamp): ids from their place in the layout (app/src/world/lamp-switch.js)
  lampsOff: [],
  folders: [], // [{ path, mode: 'structured' | 'auto' }]
  graphics: { quality: 'high', bloom: true, shadows: true, ssao: true, fov: 72, mouseSensitivity: 1.0, resolutionScale: 1.0, godrays: true },
  light: { brightness: 1.0, warmth: 0.65 },
  weather: 'clear', // clear | overcast | rain | storm | snow | fog (the fixed weather in the old words: see `sky`)
  // real | cycle (day and night in turn) | day (only the day) | night (only the night) | fixed | golden (a low evening sun
  // that stands still, app/src/world/godrays.js); app/src/world/sky-state.js
  timeMode: 'real',
  // the sky (app/src/world/sky-state.js): `mode` 'fixed' (the weather `base` with `fog` and `wind` where they fit;
  // `weather` above says the same in the old words), 'changing' (a new weather every 10 to 30 minutes from what `allow`
  // lets in, snow only in winter) or 'live' (the real weather at `place` { name, lat, lon }, Open-Meteo); `dayMinutes`
  // how long a day of the cycle, the day and the night mode takes (10, 20, 30, 60 or 120)
  sky: { mode: 'fixed', base: 'clear', fog: false, wind: false, allow: { rain: true, storm: true, fog: true, snow: true }, dayMinutes: 30, place: null },
  // the season of the garden: 'auto' (the calendar) | 'spring' | 'summer' | 'autumn' | 'winter' (app/src/world/season.js)
  season: 'auto',
  fixedHour: 20,
  // volumes 0 … 1: music, ambient (the sounds of the world, "Umgebung") and sfx ("Effekte"). The sounds of the world have
  // no switches since 0.7 (app/src/audio/soundscape.js): fire, rain, clock and wind of older files are ignored
  // sounds: single sounds of the world switched off by hand (0.7, app/src/audio/soundscape.js SOUND_SWITCHES); all on
  audio: { music: 0.45, ambient: 0.6, sfx: 0.7, record: 'nocturne', musicFolder: null, pauseForMedia: true,
    sounds: { rain: true, wind: true, thunder: true, fire: true, firebowl: true, clock: true, birds: true, frogs: true, crickets: true, water: true, steps: true } },
  // the video quality every film of the Mediathek starts with: 'auto' or a preferred picture height 1080 | 720 | 480 |
  // 360, the film plays the closest one it has (0.7; up to 0.6 'low' | 'sd' | 'hd', see migrateSettings).
  // mediathek.folder, the download folder, is set by electron/mediathek
  mediathek: { quality: 'auto' },
  // the newspaper shows the papers of the interface language; on: the papers in the other languages as well
  news: { otherLanguages: false },
  paintings: { mode: 'impressionist', folder: null },
  // pageWidth: characters per line (45–110, replaces the margin presets of 0.6, see migrateSettings); textView: the PDFs
  // read in the text view ({ <book id>: true }); textViewHints: how often the reader offered it (app/src/ui/reader)
  reader: { fontSize: 19, font: 'garamond', theme: 'paper', lineHeight: 1.55, justify: true, hyphenate: true, flow: 'paginated', pageAnimation: true, pageWidth: 68, textView: {}, textViewHints: 0 },
  // bookLang: the language of read-aloud chosen in the voice menu for single books ({ <book id>: 'de'|'en'|null },
  // null or missing = "Sprache automatisch", the language comes from the text; app/src/ui/reader/reader-tts.js)
  tts: { englishVoice: 'af_heart', germanVoice: 'de_DE-martin-kokoro', speed: 1.0, autoLang: true, germanPrompt: null, bookLang: {} },
  cat: true,
  wildlife: true, // deer, fox and wolf now and then in the garden (app/src/world/wildlife.js)
  // how often they come: 'rare' (one group now and then, as up to 0.6), 'normal' or 'often' (nearly always some in
  // sight of a window, several groups at once; app/src/world/wildlife.js MODES)
  wildlifeRate: 'often',
  fauna: true, // birds in the garden, koi and frogs in the lake (app/src/world/fauna.js)
  shelfView: 'spines',
  hints: true,
  // the gamepad (app/src/input/gamepad.js): look speed of the right stick, "Y invertieren", a short rumble when a book
  // is taken (only pads that can vibrate)
  gamepad: { sensitivity: 1.0, invertY: false, vibration: true },
  // books without a real cover get one from the book catalogues (Open Library, Goodreads, Apple Books, DNB, the Internet
  // Archive, Google Books, Amazon's pictures by ISBN), else the picture most image search results agree on
  // (library/web-covers.js)
  webCovers: true,
  // the reader's own key for the Google Books API ('' none: keyless requests currently get no quota)
  googleBooksKey: '',
  // the image search engines asked for covers the catalogues do not know, each within its own small budget
  // (library/image-engines.js); switched off, an engine is never asked
  coverEngines: { bing: true, yandex: true, duckduckgo: true },
  // the same catalogues fill in what a book does not say itself: author, year, publisher, ISBN, language, series and
  // volume (never a field the file or the reader set; library/book-match.js metadataFrom)
  webMetadata: true,
  // sitting down lays out the book opened last on the table or the armrest (off: only a book read there stays open)
  lastBookAtSeat: false,
  // audiobook folders [{ path }] (electron/audiobooks): scanned for audiobooks, shown in the panel "Hörbücher" and,
  // when there is at least one, in a cabinet in the hall (app/src/world/audiobook-shelf.js)
  audiobooks: { folders: [] },
  // the bookcases (app/src/world/shelf-arrange.js): finished books on the case "Gelesen" (finishedShelf), the reading
  // goal in books a year (0 = none), one copy of a book that exists twice (dedupe), the order inside every shelf:
  // 'title' | 'author' | 'year' | 'publisher' | 'series' | 'added' | 'read' (electron/library/shelf-order.js)
  shelves: { finishedShelf: true, readingGoal: 0, dedupe: true, sort: 'title' },
  // the full-text search over all books: its index is built in the background (electron/search/fulltext.js)
  fulltext: { enabled: true },
  window: { fullscreen: false },
  lastPosition: null,
};

/**
 * Settings of older builds, adjusted once (tts.voiceSchema and reader.pageSchema mark the adjustments, so a later
 * explicit choice stays).
 * Up to 0.2 the German voice was Kartoffelbox: 'default', 'builtin', 'kartoffelbox:…' or the path of a reference
 * recording. Kartoffelbox is replaced by the local voices, and those values now mean the default voice. An English id in
 * this field would route German text through Kokoro and is replaced as well. Returns true when `data` changed.
 */
function migrateSettings(data) {
  let changed = false;
  const tts = data.tts && typeof data.tts === 'object' ? data.tts : (data.tts = { ...DEFAULTS.tts });
  if ((tts.voiceSchema || 0) < 2) {
    const v = String(tts.germanVoice || '');
    // Piper and Kokoro-de ids look like 'de_DE-thorsten-medium' (a path or 'kartoffelbox:…' never does)
    if (!/^[a-z]{2}_[A-Z]{2}-[\w-]+$/.test(v)) tts.germanVoice = DEFAULTS.tts.germanVoice;
    tts.voiceSchema = 2;
    changed = true;
  }
  // 0.6: PDF and comic pages take the page colour for the first time. A colour chosen before 0.6 (often "Nacht",
  // which never reached the PDF pages) is set back once, so that the pages follow the appearance (Sepia gives sepia
  // pages). reader.pageSchema marks the adjustment: a colour picked in the Aa menu afterwards stays.
  const reader = data.reader && typeof data.reader === 'object' ? data.reader : null;
  if (reader && (reader.pageSchema || 0) < 1) {
    if (reader.themeChosen) { reader.themeChosen = false; reader.theme = 'paper'; changed = true; }
    reader.pageSchema = 1;   // saved with the next change when nothing was set back
  }
  // 0.7: the margin presets (narrow, normal, wide) become a page width in characters per line, the one they gave at
  // the default font and size (app/src/ui/reader/reader-styles.js MARGIN_WIDTHS). reader.widthSchema marks it.
  if (reader && (reader.widthSchema || 0) < 1) {
    const widths = { narrow: 90, normal: 68, wide: 54 };
    if (widths[reader.margin]) reader.pageWidth = widths[reader.margin];
    if ('margin' in reader) { delete reader.margin; changed = true; }
    reader.widthSchema = 1;
  }
  // 0.6: the render resolution reaches the post effects for the first time. Up to 0.5 a scale above 1 did nothing
  // while bloom or AO were on (nearly always), so it is set back once to what was really drawn; raised again, it works.
  const g = data.graphics && typeof data.graphics === 'object' ? data.graphics : null;
  if (g && (g.scaleSchema || 0) < 1) {
    if ((g.resolutionScale || 1) > 1) { g.resolutionScale = 1; changed = true; }
    g.scaleSchema = 1;
  }
  // 0.7: the weather becomes a base with fog and wind (`sky`). An old single word is taken over once (sky.schema marks it):
  // 'fog' is the grey fog of before, overcast with dense fog; every other word is the base itself.
  const sky = data.sky && typeof data.sky === 'object' ? data.sky : (data.sky = structuredClone(DEFAULTS.sky));
  if ((sky.schema || 0) < 1) {
    const w = data.weather;
    const base = w === 'fog' ? 'overcast' : ['clear', 'overcast', 'rain', 'storm', 'snow'].includes(w) ? w : sky.base;
    const fog = w === 'fog' ? true : base === sky.base ? !!sky.fog : false;
    if (base !== sky.base || fog !== !!sky.fog) { sky.base = base; sky.fog = fog; changed = true; }
    sky.schema = 1;   // (saved with the next change when nothing was set)
  }
  // 0.7: the video quality names picture heights. 'hd' (the best a film had) becomes 1080, 'sd' (about 540) 480,
  // 'low' 360; the closest height a film offers plays, as before.
  const m = data.mediathek && typeof data.mediathek === 'object' ? data.mediathek : null;
  const OLD_QUALITY = { hd: 1080, sd: 480, low: 360 };
  if (m && OLD_QUALITY[m.quality]) { m.quality = OLD_QUALITY[m.quality]; changed = true; }
  return changed;
}

// keys that would reach the prototype chain instead of the settings: a patch { "__proto__": { … } } (an own key after
// JSON.parse and structured clone) used to merge into Object.prototype itself
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (UNSAFE_KEYS.has(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.hasOwn(target, k) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      deepMerge(target[k], v);
    } else target[k] = v;
  }
  return target;
}

/** The graphics of a phone or a tablet at its first start (the browser version, the Android app: app/src/core/api-web.js):
 *  the quality 'mobile' (app/src/world/world.js: a budget of pixels, which resolutionScale scales, and the other
 *  savings), 30 frames a second (even pacing, a cooler phone) and a wider view on the small screen; the app lowers the
 *  resolution further by itself when the frames stay slow (app/src/main.js watchPhoneFrames). */
const PHONE_GRAPHICS = { quality: 'mobile', bloom: false, shadows: false, ssao: false, godrays: false, resolutionScale: 1, frameCap: 30, fov: 80 };

/** 0.10.2: a phone (`phone`: the page tells) that started with 0.10.1 or earlier has the phone defaults of then, the
 *  quality 'low' at six tenths of the display's pixels: once, it gets the quality 'mobile' with its whole budget of
 *  pixels (graphics.tierSchema marks it). Every other choice stays: medium or high, the field of view, the frame cap.
 *  True when the settings changed. */
function migratePhoneGraphics(data, phone) {
  const g = data && data.graphics && typeof data.graphics === 'object' ? data.graphics : null;
  if (!g || (g.tierSchema || 0) >= 1) return false;
  g.tierSchema = 1;
  if (phone && g.quality === 'low') { g.quality = 'mobile'; g.resolutionScale = 1; }
  return true;
}

const THEMES = ['light', 'sepia', 'dark'];
/** The appearance of the 2D interface, always one of THEMES (a missing or unknown value is the default Sepia). */
const themeOf = (data) => (THEMES.includes(data?.ui?.theme) ? data.ui.theme : DEFAULTS.ui.theme);
/** The window background per appearance (the colour behind the loading screen, never a white flash). */
const THEME_BG = { light: '#f3f1ec', sepia: '#e3dccf', dark: '#121315' };

module.exports = { DEFAULTS, deepMerge, migrateSettings, THEMES, themeOf, THEME_BG, PHONE_GRAPHICS, migratePhoneGraphics };
