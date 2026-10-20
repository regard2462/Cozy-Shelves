// In-browser mock of the backend API for developing UI modules without Electron.
import { makeTypographicCover } from './cover-art.js';

// an invented sample library (made-up titles and authors, one public-domain classic)
const SAMPLE = [
  ['Schach', 'Endspiel', 'Endspiele für Einsteiger', 'Theo Brandis', 'de', 'epub'],
  ['Schach', 'Eröffnungen', 'Opening Ideas in Plain Words', 'George Hartley', 'en', 'pdf'],
  ['Schach', 'Regeln & erste Schritte', 'Schach von Anfang an', 'Lea Kranich', 'de', 'epub'],
  ['Naturwissenschaften', 'Astronomie', 'Sterne über der Heide', 'Hanna Brückner', 'de', 'pdf'],
  ['Naturwissenschaften', 'Botanik', 'Bäume bestimmen', 'Felix Rautenberg', 'de', 'epub'],
  ['Geschichte', 'Allgemein', 'Kleine Geschichte der Welt', 'Clara Winterfeld', 'de', 'pdf'],
  ['Romane', 'Allgemein', 'Der Sommer am See', 'Ida Kampmann', 'de', 'epub'],
  ['Romane', 'Allgemein', 'Pride and Prejudice', 'Jane Austen', 'en', 'epub'],
  ['Reisen', 'Allgemein', 'Mit dem Zug durch Japan', 'Emil Sandvoss', 'de', 'pdf'],
  ['Kochen', 'Allgemein', 'The Everyday Kitchen', 'Margaret Ellison', 'en', 'pdf'],
];

const DEPTS = { Schach: ['01 Regeln & erste Schritte', '02 Eröffnungen', '03 Mittelspiel', '04 Endspiel', '05 Taktik', '07 Partiensammlungen'], Naturwissenschaften: ['01 Astronomie', '02 Physik', '04 Biologie', '09 Botanik', '11 Mathematik'], Geschichte: ['Allgemein'], Philosophie: ['Allgemein'], Kunst: ['Malerei', 'Musik'], Reisen: ['Allgemein'], Kochen: ['Allgemein'], Sprachen: ['Englisch', 'Latein'], Romane: ['Allgemein'], Wirtschaft: ['Allgemein'], Technik: ['Allgemein'] };
const WORDS = ['Die Kunst', 'Grundlagen', 'Handbuch', 'Geheimnisse', 'Praxis', 'Einführung', 'The Complete Guide to', 'Mastering', 'Understanding', 'Strategie', 'Lehrbuch', 'Chronik', 'Das große Buch', 'Wege zum', 'Erfolg mit', 'Notizen über', 'Analyse', 'Perspektiven', 'Essays über', 'A Short History of'];
const TOPICS = ['Schach', 'Endspiele', 'Eröffnungen', 'Sterne', 'Bäume', 'Vögel', 'Geschichte', 'Musik', 'Reisen', 'Brot', 'Freiheit', 'Wahrheit', 'Zahlen', 'Strategie', 'Gärten', 'Wolken', 'Europa', 'Japan', 'Sprache', 'Denken'];
const AUTHORS = ['Theo Brandis', 'George Hartley', 'Lea Kranich', 'Hanna Brückner', 'Felix Rautenberg', 'Clara Winterfeld', 'Ida Kampmann', 'Emil Sandvoss', 'Margaret Ellison', 'Paul Ostermann', 'Greta Hollander', 'Jonas Wendland', 'Rachel Ainsworth', 'Nora Talheim', 'Oliver Ashdown', 'Marta Feldhaus', 'Konrad Lindemeyer', 'Isabel Thornbury'];
function generateMockBooks(n) {
  let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const out = [];
  const deptNames = Object.keys(DEPTS);
  for (let i = 0; i < n; i++) {
    const department = deptNames[Math.floor(Math.pow(rnd(), 1.6) * deptNames.length)];
    const shelves = DEPTS[department]; const shelf = shelves[Math.floor(rnd() * shelves.length)];
    const title = `${WORDS[Math.floor(rnd() * WORDS.length)]} ${TOPICS[Math.floor(rnd() * TOPICS.length)]}${rnd() < 0.3 ? ' ' + (1 + Math.floor(rnd() * 3)) : ''}`;
    out.push([department, shelf.replace(/^\d+\s*/, ''), title, AUTHORS[Math.floor(rnd() * AUTHORS.length)], rnd() < 0.7 ? 'de' : 'en', rnd() < 0.8 ? 'pdf' : 'epub', shelf, 120 + Math.floor(rnd() * 600), `hsl(${Math.floor(rnd() * 360)}, ${30 + Math.floor(rnd() * 40)}%, ${25 + Math.floor(rnd() * 30)}%)`]);
  }
  return out;
}

export function makeMockApi() {
  const listeners = {};
  const mockN = parseInt(new URLSearchParams(location.search).get('mockbooks') || '0');
  const SAMPLE_ALL = mockN > 0 ? generateMockBooks(mockN) : SAMPLE;
  const on = (ch) => (fn) => { (listeners[ch] = listeners[ch] || []).push(fn); return () => { listeners[ch] = listeners[ch].filter((f) => f !== fn); }; };
  const emit = (ch, p) => (listeners[ch] || []).forEach((f) => f(p));
  const books = SAMPLE_ALL.map(([department, shelf, title, author, language, format, shelfKey, pages, color], i) => ({
    id: 'mock' + i, path: `C:/Bücher/${department}/${shelf}/${title}.${format}`, relPath: `${department}/${shelf}/${title}.${format}`, folder: 'C:/Bücher', folderMode: 'structured', format, size: 1e6 + i * 12345, mtime: Date.now(),
    title, author, language, isbn: null, subjects: [], department, shelf, shelfKey: shelfKey || shelf, departmentSource: 'folder', hasCover: true, coverColor: color || '#6b4a2a', pageCount: pages || 240 + i * 17,
    lastLocation: null, progress: (i % 3) * 0.3, lastRead: i < 3 ? Date.now() - i * 864e5 : null, addedAt: Date.now() - i * 1e7, bookmarks: [], annotations: [], positions: [], readingSeconds: i * 900, timesOpened: i, borrowed: false, indexed: true, isChess: department === 'Schach',
  }));
  const covers = {};
  let settings = { language: 'de', folders: [{ path: 'C:/Bücher', mode: 'structured' }], graphics: { quality: 'high', bloom: true, shadows: true, ssao: false, fov: 72, mouseSensitivity: 1, resolutionScale: 1 }, light: { brightness: 1, warmth: 0.65 }, weather: 'clear', timeMode: 'real', fixedHour: 20, audio: { music: 0.45, ambient: 0.6, sfx: 0.7, record: 'nocturne', musicFolder: null }, paintings: { mode: 'impressionist', folder: null }, reader: { fontSize: 19, font: 'garamond', theme: 'paper', lineHeight: 1.55, justify: true, hyphenate: true, flow: 'paginated', pageAnimation: true, margin: 'normal' }, tts: { englishVoice: 'af_heart', germanVoice: 'de_DE-thorsten-medium', speed: 1, autoLang: true }, cat: true, shelfView: 'spines', hints: true, window: { fullscreen: false } };
  const departments = () => {
    const map = new Map();
    for (const b of books) {
      if (!map.has(b.department)) map.set(b.department, { name: b.department, shelves: new Map(), count: 0, source: 'folder' });
      const d = map.get(b.department); d.count++;
      if (!d.shelves.has(b.shelf)) d.shelves.set(b.shelf, { name: b.shelf, key: b.shelfKey || b.shelf, bookIds: [] });
      d.shelves.get(b.shelf).bookIds.push(b.id);
    }
    return [...map.values()].sort((a, b) => b.count - a.count).map((d) => ({ ...d, shelves: [...d.shelves.values()].sort((a, b) => a.key.localeCompare(b.key, 'de', { numeric: true })) }));
  };
  const state = () => ({ books: books.map((b) => ({ ...b })), departments: departments(), folders: settings.folders, scan: { active: false, done: books.length, total: books.length, phase: 'idle' } });
  const find = (id) => books.find((b) => b.id === id);
  const deepMerge = (t, p) => { for (const [k, v] of Object.entries(p || {})) { if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object') deepMerge(t[k], v); else t[k] = v; } return t; };
  const history = [];
  return {
    isElectron: false,
    invoke: async () => null, on: () => () => {},
    settings: { get: async () => settings, set: async (patch) => { deepMerge(settings, patch); emit('settings:changed', settings); return settings; }, onChange: on('settings:changed') },
    library: {
      getState: async () => state(), onUpdate: on('library:update'), onBook: on('library:book'), onScan: on('library:scan'),
      rescan: async () => true, reindexAll: async () => true, reindex: async () => true, addFolder: async () => settings.folders, setFolders: async (f) => (settings.folders = f),
      book: async (id) => find(id), update: async (id, patch) => Object.assign(find(id), patch), setDepartment: async (id, d, s) => Object.assign(find(id), { department: d, shelf: s, departmentSource: 'manual' }),
      open: async (id) => { const b = find(id); b.timesOpened++; b.lastRead = Date.now(); history.unshift({ id, at: Date.now(), type: 'open' }); return b; },
      borrow: async (id, flag) => { const b = find(id); b.borrowed = flag; history.unshift({ id, at: Date.now(), type: flag ? 'borrow' : 'return', progress: b.progress }); return b; },
      history: async () => history.map((h) => ({ ...h, book: find(h.id) })), addReadingTime: async () => {}, stats: async () => ({ days: {}, streak: 2, top: [], totalSeconds: 5400, totalBooks: books.length, started: 3, finished: 1 }),
      search: async (q) => books.filter((b) => !q || (b.title + b.author + b.department).toLowerCase().includes(q.toLowerCase())), searchText: async () => [],
      bookUrl: async (id) => null, readText: async (id) => ({ text: 'Beispieltext. '.repeat(400), title: find(id).title }),
      coverUrl: (id) => covers[id] || '', revealFile: async () => {},
      _ensureCovers: async () => { for (const b of books) if (!covers[b.id]) covers[b.id] = (await makeTypographicCover(b.title, b.author, b.id)).dataUrl; },
    },
    files: { pickFolder: async () => null, pickFile: async () => null, list: async () => [], url: async (p) => p, savePainting: async (d) => ({ path: 'mock.png', url: d }), paintings: async () => [], deletePainting: async () => true, exportImage: async () => null, readJson: async () => null, readTextFile: async () => null },
    app: { quit: async () => {}, toggleFullscreen: async () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(), setFullscreen: async () => {}, openExternal: async (u) => window.open(u, '_blank'), info: async () => ({ version: 'mock', platform: 'web' }), streamStart: async () => null, streamStop: async () => null, onStream: () => () => {}, fetch: async (url, opts) => { try { const r = await fetch(url, opts); return { ok: r.ok, status: r.status, contentType: r.headers.get('content-type'), text: await r.text(), url: r.url }; } catch (e) { return { ok: false, status: 0, error: e.message }; } } },
    feeds: { // fixture-backed (app/src/ui/news/mock-data.js) so the panels render realistic content without Electron
      list: async () => (await import('../ui/news/mock-data.js')).feedsMock.list(), fetch: async (id, o) => (await import('../ui/news/mock-data.js')).feedsMock.fetch(id, o), article: async (u, f) => (await import('../ui/news/mock-data.js')).feedsMock.article(u, f),
      add: async (u, c, l) => (await import('../ui/news/mock-data.js')).feedsMock.add(u, c, l), remove: async (id) => (await import('../ui/news/mock-data.js')).feedsMock.remove(id), check: async (u) => (await import('../ui/news/mock-data.js')).feedsMock.check(u),
      readState: async () => (await import('../ui/news/mock-data.js')).feedsMock.readState(), markRead: async (f, i) => (await import('../ui/news/mock-data.js')).feedsMock.markRead(f, i), health: async () => (await import('../ui/news/mock-data.js')).feedsMock.health(emit), onUpdate: on('feeds:update') },
    podcasts: { search: async (t, l) => (await import('../ui/news/mock-data.js')).podcastsMock.search(t, l), curated: async () => (await import('../ui/news/mock-data.js')).podcastsMock.curated(), subscriptions: async () => (await import('../ui/news/mock-data.js')).podcastsMock.subscriptions(),
      subscribe: async (u, m) => (await import('../ui/news/mock-data.js')).podcastsMock.subscribe(u, m), unsubscribe: async (u) => (await import('../ui/news/mock-data.js')).podcastsMock.unsubscribe(u), episodes: async (u) => (await import('../ui/news/mock-data.js')).podcastsMock.episodes(u),
      importOpml: async () => (await import('../ui/news/mock-data.js')).podcastsMock.importOpml(), exportOpml: async () => (await import('../ui/news/mock-data.js')).podcastsMock.exportOpml(), getPositions: async () => (await import('../ui/news/mock-data.js')).podcastsMock.getPositions(), setPosition: async (i, s, d) => (await import('../ui/news/mock-data.js')).podcastsMock.setPosition(i, s, d) },
    wiki: { featured: async (l, d) => (await import('../ui/news/mock-data.js')).wikiMock.featured(l, d), search: async (l, q) => (await import('../ui/news/mock-data.js')).wikiMock.search(l, q), page: async (l, t) => (await import('../ui/news/mock-data.js')).wikiMock.page(l, t), summary: async (l, t) => (await import('../ui/news/mock-data.js')).wikiMock.summary(l, t), random: async (l) => (await import('../ui/news/mock-data.js')).wikiMock.random(l) },
    dict: { define: async (w, l) => (await import('../ui/news/mock-data.js')).dictMock.define(w, l), translate: async (t, f, o) => (await import('../ui/news/mock-data.js')).dictMock.translate(t, f, o) },
    // online catalog (Fernleihe): fixture-backed catalog:* channels (app/src/ui/catalog/mock-data.js)
    catalog: { invoke: async (ch, ...a) => (await import('../ui/catalog/mock-data.js')).catalogMock.invoke(ch, ...a), on: (ch, fn) => { let off = () => {}; import('../ui/catalog/mock-data.js').then((m) => { off = m.catalogMock.on(ch, fn); }); return () => off(); } },
    // fake German TTS: returns a short sine "voice" (16-bit PCM, base64) so the read-aloud client can be tested in Chromium
    tts: (() => {
      const st = { available: true, running: false, starting: false, port: 0, model: 'fake', device: 'mock', fake: true };
      const speak = async (text) => {
        if (!st.running) { st.starting = true; emit('tts:status', { ...st, message: 'Fake-TTS startet …' }); await new Promise((r) => setTimeout(r, 150)); st.starting = false; st.running = true; emit('tts:status', { ...st }); }
        const sampleRate = 24000, secs = Math.min(4, Math.max(0.3, (text || '').length * 0.04));
        const n = Math.floor(sampleRate * secs), pcm = new Int16Array(n), f = 180 + ((text || '').length % 7) * 30;
        for (let i = 0; i < n; i++) { const env = Math.min(1, i / 800, (n - i) / 800); pcm[i] = Math.round(Math.sin(2 * Math.PI * f * i / sampleRate) * env * 0.25 * 32767); }
        let bin = ''; const bytes = new Uint8Array(pcm.buffer); for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return { sampleRate, pcm: btoa(bin) };
      };
      return { status: async () => ({ ...st }), germanSpeak: speak, setup: async () => ({ ok: false, reason: 'mock' }), start: async () => { st.running = true; emit('tts:status', { ...st }); return { ...st }; }, stop: async () => { st.running = false; emit('tts:status', { ...st }); return { ...st }; }, pickPrompt: async () => null, onStatus: on('tts:status') };
    })(),
  };
}
