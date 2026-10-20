// Cozy Shelves – application bootstrap: settings, world, HUD, panels and the glue between them.
import { api } from './core/api.js';
import { bus } from './core/bus.js';
import { i18n, t, tr } from './core/i18n.js';
import { h, $, clear, escapeHtml } from './core/dom.js';
import { audio } from './audio/engine.js';
import { initPanels, openPanel, closePanel, closeAllPanels, currentPanel, dispatchPanelKey, trapTab, isPanelOpen, panelNav } from './ui/panels.js';
import { World } from './world/world.js';
import { Hud } from './ui/hud.js';
import { loadPaintings, instantPaintings } from './ui/paintings.js';
import { CategoryWheel } from './ui/wheel.js';
import './ui/reader/tts-client.js';   // side effect: registers the bus handlers for 'tts:speak' / 'tts:stop'
import { mediaPlayer } from './media/media-player.js';
import { activeTransport } from './media/transport.js';
import { initMediaSession } from './media/media-session.js';
import { MediaBar, mediaAction } from './ui/media-bar.js';
import { FilmFullscreen } from './ui/film-fullscreen.js';
import { HALL } from './world/layout.js';
import { wallMapAim } from './world/worldmap-prop.js';
import { applyTheme, themeOf, currentTheme, THEMES } from './core/theme.js';
import { refreshCoverImages } from './core/cover-art.js';
import { initAudiobooks, audiobookAction } from './ui/audiobooks/index.js';
import { initShelves, toggleReadAimed } from './ui/shelves.js';
// the gamepad: walking, looking, the buttons, the ring in the panels (it waits for 'gamepadconnected')
import { initGamepad } from './input/gamepad.js';
import { hintText } from './input/pad-hints.js';
import { startSearchActivity } from './ui/search/activity.js';
// the browser version leaves some things of the desktop out (core/platform.js has); a touch screen steers the player
// with a finger (input/touch.js)
import { has, touch, isWeb, UNAVAILABLE } from './core/platform.js';
import { TouchInput } from './input/touch.js';
import { TouchHud } from './ui/touch-hud.js';
// the textures of the rooms: kept from the last start, painted ahead by workers at a first one (world/texture-store.js)
import { textureStore } from './world/texture-store.js';

const state = { settings: null, basket: [], library: { books: [], departments: [] }, player: null, seated: null, entered: false, department: null, recent: [] };
let world, hud, wheel, mediaBar, filmFull, touchInput = null, touchHud = null;
let nativeFullscreen = false;   // the Fullscreen API for films, not in hidden test windows (app:info → hidden)
const RECENT_KEY = 'lesesaal.recent';
const toast = (msg, ms = 2800) => { const el = h('div.toast', { html: msg }); $('#toasts').appendChild(el); setTimeout(() => el.classList.add('fade'), ms); setTimeout(() => el.remove(), ms + 600); };
const shorten = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

// panel context shared with all UI modules
const worldApi = {
  teleport: (id) => teleportTo(id),
  // the World itself (for modules that need the engine)
  engine: () => world || null,
  places: () => (world?.places || []).map((p) => ({ id: p.id, label: p.label, group: p.group })),
  seats: () => [...(world?.seats.values() || [])].map((s) => ({ id: 'seat:' + s.id, label: s.label, group: ['rooms', 'garden'].includes(s.meta.group) ? s.meta.group : 'seats' })),
  hangPainting: (url, slot) => world?.actions.hangPainting(url, slot),
  setPaintings: (list, mode) => world?.actions.setPaintings(list, mode),
  setWeather: (w) => api.settings.set({ weather: w }),
  weatherState: () => world?.weatherState?.() ?? null,   // the weather now (world/sky-state.js)
  setLight: (l) => api.settings.set({ light: l }),
  goToBook: (id) => world?.actions.goToBook(id),
  departments: () => (state.library.departments || []).filter((d) => d.count > 0).map((d) => ({ name: d.name, count: d.count })),
  department: () => state.department,
  setDepartment: (name) => setDepartment(name),
  get basket() { return state.basket; },
  takeBook: (id, o) => world?.actions.takeBook(id, o),
  returnBook: (id) => world?.actions.returnBook(id),
  returnAll: () => world?.actions.returnAll(),
  stand: () => world?.actions.stand(),
  isSeated: () => !!world?.player.seated,
};
const ctx = {
  api, bus, i18n, audio, state, toast, world: worldApi, media: mediaPlayer,
  openPanel: (n, p) => openPanel(n, p, ctx),
  worldHour: () => world?.currentHour?.() ?? null,
  openWheel: () => { if (!currentPanel()) wheel?.show(false); },
  recentCount: () => state.recent.length,
  theme: () => currentTheme(),
  setTheme: (t) => (THEMES.includes(t) ? api.settings.set({ ui: { theme: t } }) : null),
};

async function main() {
  const fade = $('#fade'); const loading = $('#loading');
  textureStore.start();   // (first: the pictures of the rooms are restored or painted while the rest loads)
  initPanels($('#panels'));
  state.settings = await api.settings.get();
  // dev overrides: index.html?quality=low&scale=0.5
  const qp = new URLSearchParams(location.search);
  if (qp.get('quality')) { const q = qp.get('quality'), lowish = q === 'low' || q === 'mobile'; state.settings.graphics = { ...state.settings.graphics, quality: q, bloom: !lowish, shadows: !lowish }; }
  if (qp.get('scale')) state.settings.graphics = { ...state.settings.graphics, resolutionScale: parseFloat(qp.get('scale')) };
  if (qp.get('hour')) { state.settings.timeMode = 'fixed'; state.settings.fixedHour = parseFloat(qp.get('hour')); }
  if (qp.get('weather')) state.settings.weather = qp.get('weather');
  if (qp.get('nopaint')) state.settings.paintings = { ...state.settings.paintings, mode: 'off' };
  // ?theme=dark (dev and test runs) is stored like a choice in the settings, so later changes keep it
  if (THEMES.includes(qp.get('theme')) && qp.get('theme') !== themeOf(state.settings)) {
    state.settings.ui = { ...(state.settings.ui || {}), theme: qp.get('theme') };
    api.settings.set({ ui: { theme: qp.get('theme') } }).catch(() => {});
  }
  applyTheme(themeOf(state.settings));
  i18n.setLanguage(state.settings.language || 'de');
  loading.textContent = t('loading');
  api.settings.onChange((s) => { state.settings = s; onSettingsChanged(s); });

  // world (its floor asks for the boards' texture at once: the pictures of the rooms first, texture-store.js)
  await textureStore.ready();
  world = new World($('#world'), {
    // the quality 'mobile' draws without multisampling (the canvas keeps what it was made with until the next start)
    antialias: state.settings.graphics?.quality !== 'mobile',
    onTarget: (target) => hud.setTarget(target),
    onInteract: (kind, payload) => onInteract(kind, payload),
    onBasket: (ids, change) => {
      state.basket = [...ids]; hud.setBasket(ids); bus.emit('basket:change', ids);
      // the note names the book and the key that opens the basket (the title is text, the toast takes HTML)
      if (change.added) { const b = world.booksById[change.added]; if (b) toast(hintText('hud.inBasket', { title: escapeHtml(shorten(b.title, 60)) })); api.library.borrow(change.added, true).catch(() => {}); try { window.AndroidBooks?.vibrate(20); } catch {} }
      if (change.removed) api.library.borrow(change.removed, false).catch(() => {});
    },
    onSeat: (seat) => { state.seated = seat ? seat.id : null; hud.setSeated(!!seat); },
    onDepartment: (name) => { state.department = name; hud?.setDepartment(name); wheel?.refresh(); },
    onReturned: (id) => noteRecent(id),
    // footsteps on the ground under the player (the soundscape knows the surface), the landing after a jump
    onStep: (run, speed) => audio.footstep({ run, speed }),
    onLand: (impact) => audio.footstep({ landing: true, impact }),
    onPurr: (on) => { if (on) audio.sfx('purr', { loop: true, volume: 0.4 }); else audio.stopSfx?.('purr'); },
    onSfx: (name) => audio.sfx(name),
    // a lamp switched off or on by hand: the settings remember every lamp that is off (world/lamp-switch.js)
    onLamps: (ids) => { api.settings.set({ lampsOff: ids }).catch(() => {}); },
    coverUrl: (id) => { const b = world?.booksById?.[id]; return b?.hasCover === false ? null : api.library.coverUrl(id, b?.coverVersion); },
  });
  // the sounds of the world follow it (audio/soundscape.js): weather, hour, season, fire, clock, door, listener
  audio.attachWorld(world);
  hud = new Hud($('#hud'), ctx);
  mediaPlayer.bindContext(ctx);
  mediaBar = new MediaBar($('#hud'), ctx);
  initMediaSession();
  initAudiobooks(ctx, world, hud);   // the player, the cabinet in the hall (ui/audiobooks)
  filmFull = createFilmFullscreen();
  // only when the main process says so explicitly: a hidden test window must never cover a real display
  api.app.info?.().then((i) => { nativeFullscreen = i?.hidden === false; }).catch(() => {});
  state.player = world.player;
  // a touch screen (a phone, a tablet, the Android app): a finger looks around, a tap uses what the crosshair rests on,
  // the stick and the buttons of ui/touch-hud.js do the rest; the mouse is never caught there
  if (touch) {
    touchInput = new TouchInput($('#world'), world, { onUse: () => world.actions.act('E') });
    world.player.noLock = true;
    document.documentElement.classList.add('touch');   // styles/touch.css: the key caps of the panels go

    touchHud = new TouchHud($('#hud'), {
      touch: touchInput, act: (key) => world.actions.act(key),
      onMenu: () => { if (!currentPanel()) openPanel('menu', {}, ctx); },
      onWheel: () => { if (!currentPanel()) wheel?.toggle(false); },
    });
    hud.refresh();
  }
  window.__app = { world, state, ctx, openPanel: (n, p) => openPanel(n, p, ctx), closeAllPanels, touch: touchInput, touchHud };
  // the back button of a phone (docs/strands/android.md): the wheel or the topmost panel closes, else the menu opens;
  // false on the start menu before the library was entered (the app may then go to the background)
  window.__app.back = () => {
    if (wheel?.open) { wheel.close(true); return true; }
    const top = currentPanel();
    if (top) { if (top.name === 'menu' && !state.entered) return false; closePanel(); return true; }
    openPanel('menu', {}, ctx);
    return true;
  };
  // the browser version in the background (another tab, the home screen of a phone): the world rests and goes on
  // when the page is back; the desktop app keeps rendering (its hidden test windows count as hidden pages)
  if (isWeb) {
    let ranBeforeHidden = false;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { ranBeforeHidden = !!world.running; world.stop(); }
      else if (ranBeforeHidden && !filmFull?.isOpen) world.start();
    });
  }
  // a weather that changes by itself (or the real one outside): the rain's sound and the clock chip follow
  // the weather changed (changing or live weather): the HUD's weather icon; the sounds follow the world by themselves (audio/soundscape.js)
  world.sky.onChange(() => hud?.tick());
  world.applySettings(state.settings);

  wheel = new CategoryWheel($('#hud'), ctx, {
    onPick: (name) => setDepartment(name),
    onTeleport: (place) => teleportTo(place),
    onToggle: (open) => { world.player.enabled = !open && !currentPanel(); if (open) world.actions.rayTimer = 0.4; },
  });

  // frames are filled from the very first frame, the real watercolours replace these later
  world.actions.setPaintings(instantPaintings(), state.settings.paintings?.mode || 'impressionist');

  // library: listening starts before the state is asked for, so that no update, book or end of a scan that arrives
  // before the first build is lost (a small library is often indexed in that time)
  api.library.onUpdate((s) => onLibraryUpdate(s));
  api.library.onScan((sc) => hud.setScan(sc));
  api.library.onBook((b) => {
    const i = state.library.books.findIndex((x) => x.id === b.id);
    const old = i >= 0 ? state.library.books[i] : null;
    if (i >= 0) state.library.books[i] = b; else state.library.books.push(b); if (world.booksById) world.booksById[b.id] = b;
    // a new cover (from the internet, or page 1 turned out to be none): the world, the card and the lists follow at once
    if (old && (old.coverVersion !== b.coverVersion || old.coverWeak !== b.coverWeak || old.coverSource !== b.coverSource)) coverChanged(b);
  });
  const lib = await api.library.getState();
  await api.library._ensureCovers?.();
  state.library = lib;
  hud.setScan(lib.scan);
  loading.textContent = t('loading.books');
  await new Promise((r) => setTimeout(r, 30));
  state.recent = loadRecent(lib);
  state.department = localStorage.getItem('lesesaal.department') || null;
  world.build(lib, { department: state.department, recent: state.recent });
  // later updates compare with what was built: an update of the start scan that came before the listener was lost,
  // and a library that later became empty (the last folder removed) kept its old shelves
  lastShelfKey = shelfKeyOf(lib);
  hud.setDepartment(world.department);
  world.actions.setBasket(lib.books.filter((b) => b.borrowed).map((b) => b.id));
  state.basket = [...world.actions.basket]; hud.setBasket(state.basket);
  initShelves({ world, hud, ctx });   // the case "Gelesen", one copy of a book, the order (ui/shelves.js)

  // paintings (async); onSettingsChanged repaints only when the mode really changes
  lastPaintingsMode = state.settings.paintings?.mode;
  loadPaintings(state.settings, api).then((list) => world.actions.setPaintings(list, state.settings.paintings?.mode || 'impressionist')).catch((e) => console.warn('paintings', e));

  // rendering starts behind the menu
  world.start();
  loading.classList.add('hidden');
  androidReady();
  watchPhoneFrames();
  // the pictures painted at this start go into the store once the start is over (idle time)
  setTimeout(() => textureStore.settle().catch(() => {}), 4000);
  window.__app.textures = textureStore;   // (the checks: info())
  await openPanel('menu', { start: true, firstRun: !localStorage.getItem('lesesaal.seen') }, ctx);
  fade.classList.add('hidden');
  bindKeys();
  bindBus();
  window.__app.pad = initGamepad({ world, wheel, ctx, filmFull });
  // the full-text index reads books only while nobody reads, listens or watches (electron/search/fulltext.js)
  startSearchActivity({ api, bus, world });
  bus.on('panel:open', () => syncPointer());
  bus.on('panel:close', () => syncPointer());
  syncPointer();
  watchGpu();
  watchErrors();
  // no books folder yet (the first start, or every folder removed): the welcome card asks for one (ui/welcome.js)
  if (!(state.settings.folders || []).length) openPanel('welcome', {}, ctx);
  else resumeAfterGpu();
}

// ---- after the graphics process ended ----------------------------------------------------------------------------------
// When the graphics process ends (a driver hiccup, a crash), Chromium starts a new one and gives the world its WebGL
// context back, but the world stays black: its programs, buffers and render targets are gone. The window is built again
// and the player put back where they stood: at once when no panel is open, else when the last one closes, so that a
// book or a film is not cut short (the world is hidden behind them meanwhile). Never twice within a minute.
let gpuState = null;             // null, 'lost', 'restored'
function watchGpu() {
  const c = world.renderer.domElement;
  c.addEventListener('webglcontextlost', () => {
    gpuState = 'lost';
    // no context comes back (the graphics switched off after repeated crashes): a new start may still get one
    setTimeout(() => { if (gpuState === 'lost') { gpuState = 'restored'; restartAfterGpu(); } }, 6000);
  });
  c.addEventListener('webglcontextrestored', () => { gpuState = 'restored'; restartAfterGpu(); });
}
function restartAfterGpu() {
  if (gpuState !== 'restored' || currentPanel()) return;
  let last = 0;
  try { last = +sessionStorage.getItem('lesesaal.gpuRestartAt') || 0; } catch {}
  if (Date.now() - last < 60000) { console.warn('[main] the graphics failed again within a minute: no new start'); return; }
  const p = world.player;
  try {
    sessionStorage.setItem('lesesaal.gpuRestartAt', String(Date.now()));
    sessionStorage.setItem('lesesaal.gpuRestart', JSON.stringify({ entered: !!state.entered, pose: [p.position.x, p.position.z, p.yaw, p.pitch, p.ground] }));
  } catch {}
  location.reload();
}
function resumeAfterGpu() {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem('lesesaal.gpuRestart') || 'null'); sessionStorage.removeItem('lesesaal.gpuRestart'); } catch {}
  if (!saved?.entered) return;
  closeAllPanels();
  enterLibrary();
  const [x, z, yaw, pitch, ground] = saved.pose || [];
  if ([x, z, yaw].every(Number.isFinite)) world.player.setPose(x, z, yaw, Number.isFinite(pitch) ? pitch : 0, Number.isFinite(ground) ? ground : undefined);
  toast(tr({ de: 'Die Grafik war kurz unterbrochen. Die Welt ist neu aufgebaut.', en: 'The graphics were interrupted for a moment. The world has been rebuilt.' }));
}

// ---- errors on record -----------------------------------------------------------------------------------------------------
// Uncaught exceptions and rejected promises of the page go to <userData>/logs/renderer.log (electron/main.js app:log):
// a fault on the user's system can be read there afterwards. At most 20 lines a minute, the rest is counted.
let errorBudget = 20, errorsDropped = 0;
setInterval(() => { if (errorsDropped) { api.app?.log?.({ kind: 'dropped', count: errorsDropped }); errorsDropped = 0; } errorBudget = 20; }, 60000);
export function noteError(entry) {
  if (errorBudget <= 0) { errorsDropped++; return; }
  errorBudget--;
  try { api.app?.log?.(entry); } catch { /* a note only */ }
}
function watchErrors() {
  const where = () => ({ panel: currentPanel()?.name || null, entered: !!state.entered, pose: world ? [+world.player.position.x.toFixed(1), +world.player.position.z.toFixed(1)] : null });
  window.addEventListener('error', (e) => noteError({ kind: 'error', message: String(e.message || e.error?.message || ''), stack: String(e.error?.stack || '').slice(0, 600), file: e.filename ? e.filename.replace(/^.*[\\/]/, '') + ':' + e.lineno : undefined, ...where() }));
  window.addEventListener('unhandledrejection', (e) => { const r = e.reason; noteError({ kind: 'rejection', message: String(r?.message || r || ''), stack: String(r?.stack || '').slice(0, 600), ...where() }); });
}

function coverChanged(b) {
  world.books.updateBook(b);
  hud.refreshBook(b);
  refreshCoverImages(b, api);
}

function syncPointer() {
  const open = !!currentPanel();
  // the world renders slowly behind a panel and not at all behind the full-screen reader and the world map, which
  // cover it and need every frame for themselves (world.js start)
  world.setBackground(!open ? null : ['reader', 'worldmap'].includes(currentPanel().name) ? 'paused' : 'dim');
  if (open && currentPanel().name === 'worldmap') stillBehind(currentPanel().el);
  world.player.enabled = !open;
  if (touchInput) touchInput.enabled = !open;
  // the Android app: the reader may turn with the phone and keeps the screen on, the world is landscape
  androidReading(open && currentPanel().name === 'reader');
  // a key held down while the focus moved into a page (Street View, the Lesebrowser) never reports its release to the
  // app: without this the player walked on after the panel closed
  world.player.keys.clear();
  if (open) world.player.unlock();
  hud.setPanelOpen(open);
  if (!open && state.entered) hud.showClickHint(!world.player.locked);
  if (!open) restartAfterGpu();
}

// ---- the Android app (android/, docs/strands/android.md) ------------------------------------------------------------
let androidReadingOn = false;
/** The reader is open: the phone may turn and the screen stays on (BooksBridge.kt); the world is landscape. */
function androidReading(on) {
  const b = window.AndroidBooks;
  if (!b || androidReadingOn === !!on) return;
  androidReadingOn = !!on;
  try { b.setOrientation(on ? 'any' : 'landscape'); b.keepScreenOn(!!on); } catch (e) { console.warn('[main] android', e?.message || e); }
}
/** The first picture is drawn: the app takes its start screen away. */
function androidReady() { try { window.AndroidBooks?.ready(); } catch {} }
/**
 * A phone that cannot keep up: once the world has drawn 60 frames (and nothing lies over it), a slow median frame
 * lowers the render resolution by a tenth; the settings keep it, and the user's own choice afterwards wins. Only on
 * touch devices.
 *   'mobile' (the phone's default): slow is a median above 1.15 times the cap's interval (38 ms at 30 fps: most frames
 *   missed their turn), down to 0.7 (half the pixels of the budget), three times at most, and only while the main
 *   thread is not what holds the frame up (its median under three quarters of the interval: then fewer pixels would
 *   not help).
 *   The other qualities: a median above one and a half times the interval (50 ms at 30 fps), down to a half, twice.
 */
function watchPhoneFrames() {
  if (!touch) return;
  let steps = 0;
  const check = () => {
    if (!world) return;
    const g = state.settings.graphics || {}, mobile = g.quality === 'mobile';
    if (steps >= (mobile ? 3 : 2)) return;
    const st = world.frameStats();
    if (!st || st.n < 60 || currentPanel() || document.hidden) { setTimeout(check, 5000); return; }
    const interval = st.cap ? 1000 / st.cap : 0;
    const limit = mobile && interval ? interval * 1.15 : interval ? Math.max(40, interval * 1.5) : 40;
    if (st.median > limit) {
      if (mobile && st.work > st.median * 0.75) { console.log(`[main] slow frames (median ${Math.round(st.median)} ms), the main thread takes ${Math.round(st.work)} ms of them: the resolution stays`); setTimeout(check, 30000); return; }
      const now = g.resolutionScale ?? (mobile ? 1 : 0.75);
      const scale = Math.round(Math.max(mobile ? 0.7 : 0.5, now - 0.1) * 100) / 100;
      if (scale >= now) return;
      steps++;
      console.log(`[main] slow frames (median ${Math.round(st.median)} ms at ${st.n} frames): render resolution ${now} → ${scale}`);
      api.settings.set({ graphics: { resolutionScale: scale } }).catch(() => {});
      world.resetFrameStats();
    }
    setTimeout(check, 10000);
  };
  setTimeout(check, 10000);
}

/** Behind the world map the world stands still: a small still of it under the veil of the panel layer, in place of the
 *  blurred view through it (world map CSS). A paused 3D canvas did not reach the screen on some Windows systems, and
 *  the margins around the map stayed black there. */
function stillBehind(layer) {
  if (!layer || layer.classList.contains('has-still')) return;
  try {
    const c = world.still();
    if (!c) return;
    layer.style.setProperty('--panel-still', `url("${c.toDataURL('image/jpeg', 0.85)}")`);
    layer.classList.add('has-still');
  } catch (e) { console.warn('[main] still of the world', e?.message || e); }
}

function enterLibrary() {
  state.entered = true; localStorage.setItem('lesesaal.seen', '1');
  audio.init();
  world.actions.musicPlaying = (state.settings.audio?.record || 'nocturne') !== 'stille';
  syncPointer();
  setTimeout(() => { if (!currentPanel()) world.player.lock(); }, 50);
}
document.addEventListener('pointerlockchange', () => { if (hud) hud.showClickHint(!document.pointerLockElement && !currentPanel() && state.entered); });

// what a thing in the world needs from the backend (the browser version has not all of it, core/platform.js)
const FEATURE_OF = { podcasts: 'podcasts', news: 'feeds', catalog: 'catalog', mediathek: 'mediathek', browser: 'browser', audiobook: 'audiobooks', audiobooks: 'audiobooks', screen: 'mediathek' };
function onInteract(kind, payload) {
  audio.sfx('click');
  if (FEATURE_OF[kind] && !has(FEATURE_OF[kind])) { toast(tr(UNAVAILABLE)); return; }
  switch (kind) {
    case 'read': openReader(payload.id); break;
    case 'bookinfo': openPanel('bookinfo', { id: payload.id }, ctx); break;
    case 'computer': openPanel('computer', {}, ctx); break;
    case 'records': openPanel('records', {}, ctx); break;
    case 'podcasts': openPanel('podcasts', {}, ctx); break;
    case 'watercolor': openPanel('watercolor', {}, ctx); break;
    case 'wiki': openPanel('wiki', {}, ctx); break;
    case 'news': openPanel('news', {}, ctx); break;
    case 'chess': openPanel('chess', {}, ctx); break;
    case 'catalog': openPanel('catalog', {}, ctx); break;
    case 'mediathek': openPanel('mediathek', {}, ctx); break;
    case 'browser': openPanel('browser', {}, ctx); break;
    // the panel opens at the country the crosshair rests on (the whole world when it rests on the sea or the frame)
    case 'worldmap': openPanel('worldmap', { aim: wallMapAim(payload?.hit) }, ctx); break;
    case 'screen': if (mediaPlayer.current) mediaPlayer.toggle(); else openPanel('mediathek', {}, ctx); break;
    case 'gallery': openPanel('gallery', { slot: payload.slot }, ctx); break;
    case 'audiobook': case 'audiobooks': audiobookAction(kind, payload, ctx); break;
    case 'return': if (state.basket.length) { world.actions.returnAll(); toast(t('hud.returned')); audio.sfx('bell'); } else openPanel('basket', {}, ctx); break;
    case 'basket-full': toast(t('hud.basketFull')); audio.sfx('error'); break;
  }
}
async function openReader(id, extra = {}) {
  const book = world.booksById?.[id] || state.library.books.find((b) => b.id === id);
  if (!book) return;
  if (!state.basket.includes(id) && !extra.noBorrow) { world.actions.takeBook(id, { silent: true }); }
  await api.library.borrow(id, true).catch(() => {});
  openPanel('reader', { id, ...extra }, ctx);
}

function bindBus() {
  bus.on('book:open', ({ id, location }) => openReader(id, { location }));
  bus.on('book:open-external', (ext) => openPanel('reader', { external: ext }, ctx));
  // a hit of the full-text search: the reader opens at its page with the words marked (ui/reader/reader-hit.js)
  bus.on('book:open-hit', ({ id, hit }) => openReader(id, { hit }));
  bus.on('book:borrow', ({ id }) => world.actions.takeBook(id));
  bus.on('book:return', ({ id }) => { world.actions.returnBook(id); api.library.borrow(id, false).catch(() => {}); });
  // at once: the shelf is rebuilt while the reader fades out (the fade runs on the compositor and stays smooth)
  bus.on('reader:closed', ({ id, currentPageText }) => { if (id) { world.actions.markOpen(id, currentPageText); noteRecent(id, { now: true }); } });
  bus.on('world:department', (name) => setDepartment(name));
  bus.on('gallery:hang', ({ url, slot }) => { world.actions.hangPainting(url, slot); toast(t('hud.hung')); });
  bus.on('painting:saved', ({ url }) => world.actions.setEaselImage(url));
  // the easel shows the watercolour painted last (a plain white canvas before the first one)
  api.files.paintings?.().then((list) => { if (list?.[0]?.url) world.actions.setEaselImage(list[0].url); }).catch(() => {});
  bus.on('music:record', (id) => { world.actions.musicPlaying = id !== 'stille'; });
  // the platter stands still while the music pauses for a film or a podcast (audio/engine.js hold)
  bus.on('music:hold', (held) => { const rec = audio.currentRecord; world.actions.musicPlaying = !held && !!rec && !rec.silent; });
  bus.on('world:goto-book', ({ id }) => { closeAllPanels(); fadeAround(() => world.actions.goToBook(id)); });
  bus.on('world:teleport', (id) => teleportTo(id));
  bus.on('catalog:downloaded', () => toast(t('hud.downloaded')));
  // the signs and the directory in the book room are drawn in the chosen language: draw them again when it really
  // changes (every settings change passes through setLanguage), on the shelves as they stand (world.relabel;
  // refreshShelves did nothing once indexed books had changed the cases, and the signs stayed in the old language)
  let shelfLang = i18n.lang;
  bus.on('i18n:change', (lang) => { hud.refresh(); if (lang !== shelfLang) { shelfLang = lang; if (!world.relabel()) world.updateLibrary(state.library); } });
  bus.on('world:enter', () => enterLibrary());
  // window.open / target=_blank anywhere in the app: the main process hands the address to the reading browser
  api.on?.('browser:open', (url) => { if (/^https?:\/\//i.test(url || '')) openPanel('browser', { url }, ctx); });
  // the mouse's back and forward buttons, reported by Windows as app commands (electron/main.js)
  api.on?.('app:nav', (dir) => { if (dir === -1 || dir === 1) panelNav(dir, 'app-command'); });
  // a film goes onto the projection screen: close the panels, the screen rolls down (nobody is seated)
  bus.on('cinema:watch', () => watchScreen());
  bus.on('media:fullscreen', () => openFilmFullscreen());
  bus.on('panel:open', () => filmFull?.close());   // a panel that opens anyway (browser:open …) must be visible
  window.addEventListener('paintings:progress', (e) => world.actions.setPaintings(e.detail.list, state.settings.paintings?.mode || 'impressionist'));
}

/** The radial menu's choice: walk to the department (all departments stand in the book room), or switch the room
 *  to it (a library too big for the walls shows one department at a time). */
function setDepartment(name) {
  if (!name) return;
  if (world.layout?.allDepartments) {
    closeAllPanels();
    if (world.showDepartment(name, fadeAround)) { state.department = name; hud.setDepartment(name); }
    return;
  }
  if (name === state.department) return;
  closeAllPanels();
  fadeAround(() => {
    world.setDepartment(name);
    state.department = world.department;
    try { localStorage.setItem('lesesaal.department', state.department || ''); } catch {}
    hud.setDepartment(state.department);
    toast(t('wheel.switched', { name: state.department }));
  });
}

/** The "recently read" shelf: books you read or handed back, newest first. */
function loadRecent(lib) {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch {}
  const byLastRead = (lib.books || []).filter((b) => b.lastRead).sort((a, b) => b.lastRead - a.lastRead).map((b) => b.id);
  const ids = [...saved, ...byLastRead].filter((id, i, a) => a.indexOf(id) === i);
  const known = new Set((lib.books || []).map((b) => b.id));
  return ids.filter((id) => known.has(id)).slice(0, 27);
}
function noteRecent(id, { now = false } = {}) {
  if (!id) return;
  state.recent = [id, ...state.recent.filter((x) => x !== id)].slice(0, 27);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(state.recent)); } catch {}
  clearTimeout(recentTimer);
  if (now) { world?.setRecent(state.recent); return; }
  recentTimer = setTimeout(() => world?.setRecent(state.recent), 900);
}
let recentTimer = null;

function fadeAround(fn) {
  const fade = $('#fade'); fade.style.transition = 'opacity .45s ease'; fade.classList.remove('hidden');
  setTimeout(() => { fn(); setTimeout(() => { fade.classList.add('hidden'); setTimeout(() => { fade.style.transition = ''; }, 500); }, 120); }, 460);
}
/** A film goes onto the screen at the fireplace wall: the panels close and the screen rolls down, the player stays
 *  where they are (no automatic seat on the sofa). Outside the hall a short note says where the film runs. */
function watchScreen() {
  closeAllPanels();
  if (!state.entered) enterLibrary();
  // already seated on the sofa: look up at the screen
  if (world.actions.seatedId === 'sofa') { world.actions.aimAtScreen(); return; }
  if (world.player.position.z < HALL.z0) toast(tr({ de: 'Der Film läuft auf der Leinwand in der Halle.', en: 'The film is playing on the screen in the hall.' }));
}
/** The film in full screen over everything (app/src/ui/film-fullscreen.js); the world rests meanwhile. */
function createFilmFullscreen() {
  let wasRunning = false, relock = false;
  return new FilmFullscreen({
    nativeFullscreen: () => nativeFullscreen,
    onOpen() {
      wasRunning = !!world.running; relock = world.player.locked;
      world.stop();
      world.player.enabled = false; world.player.keys.clear(); world.player.unlock();
    },
    onClose() {
      if (wasRunning) world.start();
      syncPointer();
      if (relock && !currentPanel()) world.player.lock();
    },
  });
}
/** F in the world, the mini player's "Vollbild": a film that runs on the screen or as sound, seated or standing. */
function openFilmFullscreen() {
  if (!filmFull || !mediaPlayer.current || !['screen', 'audio'].includes(mediaPlayer.mode) || currentPanel() || wheel?.open) return false;
  return filmFull.open();
}
function teleportTo(id) {
  closeAllPanels();
  if (id.startsWith('seat:')) { const sid = id.slice(5); const seat = world.seats.get(sid); if (!seat) return; fadeAround(() => { world.actions.standBy(sid); world.actions.sit(sid); }); return; }
  fadeAround(() => world.actions.teleport(id));
}

/** Ctrl+F (Cmd+F): the full-text search over all books */
const fulltextKey = (e) => (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyF';

function bindKeys() {
  document.addEventListener('keydown', (e) => {
    const editing = e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
    // Alt+←/→ and the browser keys: back and forward inside the open panel, also from a search field
    const navKey = (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) || e.key === 'BrowserBack' || e.key === 'BrowserForward';
    if (navKey && currentPanel() && !wheel?.open) {
      if (!editing && dispatchPanelKey(e)) { e.preventDefault(); return; }
      if (panelNav(e.key === 'ArrowLeft' || e.key === 'BrowserBack' ? -1 : 1, 'key')) e.preventDefault();
      return;
    }
    // Tab from a field of a panel stays inside the panel as well (ui/panels.js trapTab)
    if (editing && e.key !== 'Escape') { if (e.key === 'Tab' && !wheel?.open) trapTab(e); return; }
    // the radial category wheel owns the keyboard while it is open
    if (wheel?.open) { if (e.code === 'Tab') e.preventDefault(); if (wheel.onKey(e)) { e.preventDefault(); return; } }
    if (currentPanel()) {
      if (dispatchPanelKey(e)) { e.preventDefault(); return; }
      if (trapTab(e)) return;
      // Ctrl+F: the full-text search over the panel (panels with a search of their own have taken the key above)
      if (fulltextKey(e) && currentPanel().name !== 'search') { openPanel('search', {}, ctx); e.preventDefault(); return; }
      if (e.key === 'Escape') { const top = currentPanel(); if (top.name === 'menu' && !state.entered) return; closePanel(); e.preventDefault(); }
      return;
    }
    if (fulltextKey(e)) { openPanel('search', {}, ctx); e.preventDefault(); return; }
    switch (e.code) {
      case 'Escape': openPanel('menu', {}, ctx); break;
      case 'KeyE': case 'Enter': world.actions.act('E'); break;
      // F on a book is its info card, otherwise a running film goes full screen
      case 'KeyF': if (!world.actions.act('F')) openFilmFullscreen(); break;
      case 'KeyR': world.actions.act('R'); break;
      // C on a book (shelf or table): "Als gelesen markieren" / "Als ungelesen markieren" (ui/shelves.js)
      case 'KeyC': if (e.repeat || !toggleReadAimed()) return; break;
      // Space stands up from a seat, otherwise jumps; nothing else (no scrolling, no focused button). Holding it
      // down does not repeat: a key still held from before must not stand you up or jump again and again.
      case 'Space': e.preventDefault(); if (!e.repeat) world.actions.act('Space'); break;
      // walking is player.js; a fresh press also stands up from a seat once the sit-down has finished
      case 'KeyW': case 'KeyA': case 'KeyS': case 'KeyD': case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight':
        if (!e.repeat) world.actions.act('Move'); break;
      case 'KeyB': openPanel('basket', {}, ctx); break;
      case 'Tab': e.preventDefault(); wheel?.show(true); break;
      case 'KeyG': openPanel('menu', { tab: 'places' }, ctx); break;
      case 'KeyM': openPanel('records', {}, ctx); break;
      // the programmes of the desktop app: the browser version says so instead of opening an empty panel
      case 'KeyV': if (!has('mediathek')) { toast(tr(UNAVAILABLE)); return; } openPanel('mediathek', {}, ctx); break;
      case 'KeyI': if (!has('browser')) { toast(tr(UNAVAILABLE)); return; } openPanel('browser', {}, ctx); break;
      case 'KeyH': if (!has('audiobooks')) { toast(tr(UNAVAILABLE)); return; } openPanel('audiobooks', {}, ctx); break;
      case 'KeyT': if (e.ctrlKey || e.metaKey || e.altKey) return; openPanel('search', {}, ctx); break;
      // film, podcast or audiobook: whichever started last and is still loaded (media/transport.js)
      case 'KeyK': { const tp = activeTransport(); if (!tp) return; tp.toggle(); break; }
      case 'KeyJ': { const tp = activeTransport(); if (!tp) return; tp.skip(-(tp.back || tp.step)); break; }
      case 'KeyL': { const tp = activeTransport(); if (!tp) return; tp.skip(tp.fwd || tp.step); break; }
      // the mini player's actions (ui/media-bar.js): P onto the screen or back to sound only, O in the window, X stop
      case 'KeyP': if (!mediaAction('screen', ctx)) return; break;
      case 'KeyO': if (!mediaAction('window', ctx)) return; break;
      case 'KeyX': if (!mediaAction('stop', ctx)) return; break;
      case 'F11': api.app.toggleFullscreen(); break;
      default: return;
    }
  });
  document.addEventListener('keyup', (e) => { if (e.code === 'Tab' && wheel?.open) { e.preventDefault(); wheel.release(); } });
  // a left click acts on what you look at (world-actions.js act('Click')); the click that catches the mouse does not
  // (the pointer is not locked yet when it goes down), the right button stays free
  document.addEventListener('mousedown', (e) => { if (!currentPanel() && !wheel?.open && world.player.locked && e.button === 0) world.actions.act('Click'); });
}

function onSettingsChanged(s) {
  applyTheme(themeOf(s));
  i18n.setLanguage(s.language || 'de');
  world.applySettings(s);
  audio.setVolumes?.({ music: s.audio?.music, ambient: s.audio?.ambient, sfx: s.audio?.sfx });
  if (s.paintings?.mode !== lastPaintingsMode) { lastPaintingsMode = s.paintings?.mode; loadPaintings(s, api).then((list) => world.actions.setPaintings(list, s.paintings?.mode || 'impressionist')); }
  hud.refresh();
}
let lastPaintingsMode = null;

let rebuildTimer = null, lastShelfKey = '';
const shelfKeyOf = (s) => s.departments.map((d) => d.name + ':' + d.shelves.map((sh) => sh.name + '=' + sh.bookIds.length).join(',')).join('|');
function onLibraryUpdate(s) {
  state.library = s;
  // the scan state goes to the chip as it arrives: a delayed rebuild would put back an old one ("16 / 17")
  hud.setScan(s.scan);
  const key = shelfKeyOf(s);
  // the same shelves: the world takes the new records without a rebuild (its library state as well: the display table
  // and the next rebuild read world.library, which kept the state of the first build and its old borrowed flags)
  if (key === lastShelfKey) { world.library = s; world.booksById = Object.fromEntries(s.books.map((b) => [b.id, b])); return; }
  lastShelfKey = key;
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    // the newest state, not the one of 9 s ago: books indexed meanwhile keep their covers
    const cur = state.library;
    state.recent = loadRecent(cur);
    world.recent = state.recent;
    // only the shelves are rebuilt (world.js refreshShelves), the rooms and the player stay as they are
    world.updateLibrary(cur);
    hud.setDepartment(world.department);
    wheel?.refresh();
    world.actions.setBasket(state.basket.filter((id) => cur.books.some((b) => b.id === id)));
  }, s.scan?.active ? 9000 : 800);
}

main().catch((e) => { console.error(e); $('#loading').textContent = 'Fehler beim Start: ' + e.message; });
