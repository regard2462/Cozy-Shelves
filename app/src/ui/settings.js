// Settings panel: general, graphics, light & weather, sound, read-aloud (TTS), library folders.
import { h, clear } from '../core/dom.js';
import { t, tr } from '../core/i18n.js';
import { THEMES, THEME_LABELS, themeOf, applyTheme } from '../core/theme.js';
import { WALL_STYLES, WALL_COLORS, WALL_LABELS, wallStyleOf, wallPainting } from '../world/wall-styles.js';
import { audiobookSettings } from './audiobooks/ab-settings.js';
import { shelfSettingsRows } from './shelf-settings.js';
import { allVoicesRows } from './tts-all-voices.js';
import { controllerSection } from '../input/pad-settings.js';
import { skyRows } from './settings-sky.js';
import { fulltextRows } from './search/search-settings.js';
import { PREFERENCES, preferenceOf } from '../media/quality.js';
import { FLOOR_STYLES, FLOOR_LABELS, FLOOR_SWATCH, floorStyleOf, floorPreview, floorPainting } from '../world/floor-styles.js';
import { coverSettingsRows } from './cover-settings.js';
import { soundSwitchRows } from './sound-settings.js';
import { has, isWeb } from '../core/platform.js';

// The read-aloud client is loaded on demand: the settings panel must still open if that module is missing.
let ttsPromise = null;
const getTts = () => (ttsPromise ||= import('./reader/tts-client.js')
  .then((m) => m.ttsClient || null)
  .catch((e) => { console.warn('[settings] tts client unavailable', e); return null; }));

// the browser version has no Mediathek and no audiobooks (core/platform.js): their sections stay away
const SECTIONS = ['general', 'graphics', 'light', 'audio', 'mediathek', 'tts', 'library', 'audiobooks', 'controller'].filter((k) => (k !== 'mediathek' || has('mediathek')) && (k !== 'audiobooks' || has('audiobooks')));
const BRIGHT_MIN = 0.6, BRIGHT_MAX = 1.3;   // the world clamps to 0.4…1.6 – we stay well inside that
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : lo));
/** the gallery used to write 'none' where everything else expects 'off' */
const paintingMode = (m) => (m === 'none' ? 'off' : (m || 'impressionist'));

export async function mount(container, ctx, params = {}) {
  const { api, state, bus } = ctx;
  let section = SECTIONS.includes(params.section) ? params.section : (params.section === 'reading' ? 'tts' : 'general');
  let s = state.settings || {};
  // the change is taken into `s` before it is saved: saving re-renders the panel (every change passes i18n:change)
  // before the answer arrives, and a segmented choice used to show the old value then
  const merged = (a, p) => { const o = { ...(a || {}) }; for (const [k, v] of Object.entries(p || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) && a?.[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merged(a[k], v) : v; return o; };
  const set = async (patch) => { s = merged(s, patch); state.settings = s; s = (await api.settings.set(patch)) || s; state.settings = s; return s; };

  const panel = h('div.panel.settings-panel');
  container.appendChild(panel);

  // subscriptions that only live as long as the currently rendered section
  let sectionOffs = [];
  const keep = (off) => { if (typeof off === 'function') sectionOffs.push(off); return off; };
  const dropSection = () => { for (const off of sectionOffs) { try { off(); } catch (e) { console.warn('[settings]', e); } } sectionOffs = []; };

  // debounced writers – every timer is tracked so a closed panel can never write settings afterwards
  const timers = new Set();
  const debounced = (fn, ms = 250) => {
    let tm = null;
    return (v) => {
      if (tm) { clearTimeout(tm); timers.delete(tm); }
      tm = setTimeout(() => { timers.delete(tm); tm = null; fn(v); }, ms);
      timers.add(tm);
    };
  };

  // ---------------------------------------------------------------- primitives
  const slider = (label, get, apply, { min = 0, max = 1, step = 0.01, fmt = (v) => Math.round(v * 100) + ' %', hint = null } = {}) => {
    const val = h('span.val', fmt(get()));
    const input = h('input.range', { type: 'range', min, max, step, value: get(), 'aria-label': label, oninput: (e) => { const v = parseFloat(e.target.value); val.textContent = fmt(v); apply(v); } });
    return h('div.setting', h('label', label, hint ? h('span.setting-hint', hint) : null), h('div.ctl', input, val));
  };

  const toggle = (label, get, apply, { hint = null } = {}) => {
    const tg = h('div.toggle', { role: 'switch', tabindex: '0', 'aria-label': label, 'aria-checked': get() ? 'true' : 'false' });
    tg.classList.toggle('on', !!get());
    const flip = () => { const v = !tg.classList.contains('on'); tg.classList.toggle('on', v); tg.setAttribute('aria-checked', v ? 'true' : 'false'); apply(v); };
    tg.onclick = flip;
    tg.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') { e.preventDefault(); flip(); } };
    const row = h('div.setting', h('label', label, hint ? h('span.setting-hint', hint) : null), tg);
    row.toggleEl = tg;
    return row;
  };

  const seg = (label, options, get, apply) => {
    const el = h('div.seg', { role: 'radiogroup', 'aria-label': label });
    const draw = () => {
      clear(el);
      for (const [v, l] of options) {
        const on = get() === v;
        el.appendChild(h('button', { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', class: on ? 'on' : '', onclick: () => { apply(v); draw(); } }, l));
      }
    };
    draw();
    return h('div.setting', h('label', label), el);
  };

  /** Hell, Sepia, Dunkel: three small previews of a panel, the choice applies at once. */
  const themePicker = () => {
    const label = tr({ de: 'Erscheinungsbild', en: 'Appearance' });
    const el = h('div.theme-pick', { role: 'radiogroup', 'aria-label': label });
    const draw = () => {
      clear(el);
      for (const k of THEMES) {
        const on = themeOf(s) === k;
        el.appendChild(h('button.theme-opt', { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', class: on ? 'on' : '', dataset: { theme: k },
          onclick: () => { if (themeOf(s) === k) return; applyTheme(k); set({ ui: { theme: k } }).then(draw); } },
        h('span.theme-swatch', { 'aria-hidden': 'true' }, h('i.ts-bar'), h('i.ts-line'), h('i.ts-line.short'), h('i.ts-dot')),
        h('span.theme-name', tr(THEME_LABELS[k]))));
      }
    };
    draw();
    return h('div.setting.setting-theme', h('label', label, h('span.setting-hint', tr({ de: 'Farben der Tafeln, Menüs und Anzeigen im Raum', en: 'Colours of the panels, menus and on-screen labels' }))), el);
  };

  /** Wandgestaltung: the plaster above the panelling white, in a calm colour or as a graffiti mural ("Neu sprühen"
   *  paints another variant). The walls change at once, a mural as soon as it is painted (world/walls.js). */
  const wallPicker = () => {
    const label = tr({ de: 'Wandgestaltung', en: 'Walls' });
    const el = h('div.wall-pick', { role: 'radiogroup', 'aria-label': label });
    for (const k of WALL_STYLES) {
      const on = wallStyleOf(s).style === k;
      el.appendChild(h('button.wall-opt', { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', class: on ? 'on' : '', dataset: { wall: k },
        onclick: () => { if (wallStyleOf(s).style !== k) set({ walls: { style: k } }).then(render); } },
      h('span.wall-swatch', { 'aria-hidden': 'true', style: WALL_COLORS[k] ? { backgroundColor: WALL_COLORS[k] } : null }),
      h('span.wall-name', tr(WALL_LABELS[k]))));
    }
    const rows = [h('div.setting.setting-walls', h('label', label, h('span.setting-hint', tr({ de: 'Halle, Durchgang und Bücherzimmer über der Vertäfelung', en: 'Hall, passage and book room above the panelling' }))), el)];
    if (wallStyleOf(s).style === 'graffiti') {
      // while a mural is painted (about two seconds) the button says so
      const spray = h('button.btn.small.wall-spray', { onclick: () => { if (!wallPainting.busy) set({ walls: { seed: wallStyleOf(s).seed + 1 } }); } });
      const busy = (on) => { spray.disabled = on; spray.textContent = on ? tr({ de: 'Wird gesprüht …', en: 'Spraying …' }) : tr({ de: 'Neu sprühen', en: 'Spray again' }); };
      busy(wallPainting.busy);
      keep(bus.on('walls:painting', busy));
      rows.push(h('div.setting', h('label', tr({ de: 'Graffiti', en: 'Graffiti' }), h('span.setting-hint', tr({ de: 'Jede Variante hat eigene Farben, Wörter und Figuren', en: 'Every variant has its own colours, words and characters' }))), spray));
    }
    return rows;
  };

  /** Fußboden: the floor of the rooms, each style with a small picture of it (painted by the floor worker once per
   *  session). The floor changes as soon as its textures are painted (world/floors.js); meanwhile the chosen picture
   *  pulses. */
  const floorPicker = () => {
    const label = tr({ de: 'Fußboden', en: 'Floor' });
    const el = h('div.floor-pick', { role: 'radiogroup', 'aria-label': label });
    const opts = [];
    for (const k of FLOOR_STYLES) {
      const on = floorStyleOf(s) === k;
      const sw = h('canvas.floor-swatch', { width: 168, height: 104, 'aria-hidden': 'true', style: { backgroundColor: FLOOR_SWATCH[k] } });
      floorPreview(k).then((bmp) => { if (bmp) sw.getContext('2d').drawImage(bmp, 0, 0, sw.width, sw.height); });
      const btn = h('button.floor-opt', { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', class: on ? 'on' : '', dataset: { floor: k },
        onclick: () => { if (floorStyleOf(s) !== k) set({ floor: k }).then(render); } },
      sw, h('span.floor-name', tr(FLOOR_LABELS[k])));
      opts.push(btn); el.appendChild(btn);
    }
    const busy = (on) => { for (const b of opts) b.classList.toggle('busy', !!on && b.dataset.floor === floorStyleOf(s)); };
    busy(floorPainting.busy);
    keep(bus.on('floors:painting', busy));
    return h('div.setting.setting-floors', h('label', label, h('span.setting-hint', tr({ de: 'Halle, Durchgang und Bücherzimmer', en: 'Hall, passage and book room' }))), el);
  };

  const note = (text) => h('p.settings-note.small.muted', text);
  const groupTitle = (text) => h('h3.settings-group', text);
  /** The background music pauses while a film of the Mediathek or a podcast plays (in Klang and in Mediathek). */
  const pauseMusicRow = () => toggle(tr({ de: 'Hintergrundmusik pausieren', en: 'Pause the background music' }), () => s.audio?.pauseForMedia !== false, (v) => set({ audio: { pauseForMedia: v } }),
    { hint: tr({ de: 'solange ein Film aus der Mediathek, ein Podcast oder ein Hörbuch läuft', en: 'while a film from the Mediathek, a podcast or an audiobook is playing' }) });

  let liveFullscreen = null;    // kept in sync when F11 or the menu toggles fullscreen behind our back
  const fullscreenRow = () => {
    const row = toggle(t('menu.fullscreen'), () => !!s.window?.fullscreen, async (v) => {
      try { await api.app.setFullscreen(v); } catch (e) { console.warn('[settings] fullscreen', e); }
      await set({ window: { fullscreen: v } });
    });
    liveFullscreen = row.toggleEl;
    return row;
  };

  // ---------------------------------------------------------------- sections
  const sections = {
    general: () => [
      themePicker(),
      ...wallPicker(),
      floorPicker(),
      seg(t('settings.language'), [['de', 'Deutsch'], ['en', 'English']], () => s.language, (v) => set({ language: v }).then(render)),
      // the newspaper shows the papers of the interface language, this switch adds the others (ui/news/news-lang.js)
      has('feeds') ? toggle(tr({ de: 'Auch Zeitungen in anderen Sprachen', en: 'Also papers in other languages' }), () => s.news?.otherLanguages === true, (v) => set({ news: { otherLanguages: v } }),
        { hint: tr({ de: 'Sonst liegen am Zeitungsständer nur Zeitungen in der Sprache der Oberfläche', en: 'Otherwise the newspaper rack only holds papers in the language of the interface' }) }) : null,
      toggle(t('settings.hints'), () => s.hints !== false, (v) => set({ hints: v })),
      toggle(t('settings.cat'), () => s.cat !== false, (v) => set({ cat: v })),
      toggle(tr({ de: 'Wildtiere im Garten', en: 'Wildlife in the garden' }), () => s.wildlife !== false, (v) => set({ wildlife: v })),
      seg(tr({ de: 'Häufigkeit der Wildtiere', en: 'How often wildlife appears' }), [['rare', tr({ de: 'Selten', en: 'Rarely' })], ['normal', tr({ de: 'Normal', en: 'Normal' })], ['often', tr({ de: 'Oft', en: 'Often' })]],
        () => (['rare', 'normal', 'often'].includes(s.wildlifeRate) ? s.wildlifeRate : 'often'), (v) => set({ wildlifeRate: v })),
      toggle(tr({ de: 'Vögel und Tiere am See', en: 'Birds and pond life' }), () => s.fauna !== false, (v) => set({ fauna: v })),
      fullscreenRow(),
      // the browser version has no folder for pictures of your own: generated watercolours or none
      seg(t('settings.paintings'), has('paintingsFolder') ? [['impressionist', t('paintings.impressionist')], ['own', t('paintings.own')], ['off', t('paintings.off')]] : [['impressionist', t('paintings.impressionist')], ['off', t('paintings.off')]],
        () => paintingMode(s.paintings?.mode), (v) => set({ paintings: { mode: v } }).then(render)),
      has('paintingsFolder') ? h('div.setting',
        h('label', s.paintings?.folder
          ? h('span.settings-path', { title: s.paintings.folder }, s.paintings.folder)
          : h('span', tr({ de: 'Kein Bilderordner gewählt', en: 'No picture folder chosen' }))),
        h('button.btn.small', { onclick: async () => { const f = await api.files.pickFolder(t('settings.paintingsFolder')); if (f) { await set({ paintings: { mode: 'own', folder: f } }); render(); } } }, t('settings.paintingsFolder'))) : null,
      has('paintingsFolder') && paintingMode(s.paintings?.mode) === 'own' && !s.paintings?.folder
        ? note(tr({ de: 'Für „eigener Bilderordner“ fehlt noch ein Ordner. Bis dahin bleiben die Rahmen leer.', en: 'The “own picture folder” mode still needs a folder. Until then the frames stay empty.' }))
        : null,
    ],

    graphics: () => [
      groupTitle(tr({ de: 'Bild', en: 'Image' })),
      seg(t('settings.quality'), [['mobile', t('settings.quality.mobile')], ['low', t('settings.quality.low')], ['medium', t('settings.quality.medium')], ['high', t('settings.quality.high')]],
        () => s.graphics?.quality || 'high', (v) => set({ graphics: { quality: v } }).then(render)),
      // (world.js MOBILE_PIXELS: the budget the resolution scales)
      s.graphics?.quality === 'mobile' ? note(tr({ de: 'Mobil ist für Handys und Tablets gedacht: weniger Bildpunkte, weniger Lampenlichter, Bäume in der Ferne einfacher, keine Schatten und kein Leuchten. Die Renderauflösung verändert die Zahl der Bildpunkte. Die Kantenglättung ändert sich erst beim nächsten Start.', en: 'Mobile is meant for phones and tablets: fewer pixels, fewer lamp lights, simpler trees in the distance, no shadows and no glow. The render resolution changes the number of pixels. Edge smoothing changes at the next start.' })) : null,
      toggle(t('settings.shadows'), () => s.graphics?.shadows !== false, (v) => set({ graphics: { shadows: v } }),
        { hint: tr({ de: 'weiche Schatten von Sonne und Kaminfeuer', en: 'soft shadows from the sun and the fire' }) }),
      toggle(t('settings.bloom'), () => s.graphics?.bloom !== false, (v) => set({ graphics: { bloom: v } }),
        { hint: tr({ de: 'zartes Leuchten um Flammen und Lampen', en: 'a gentle glow around flames and lamps' }) }),
      toggle(t('settings.godrays'), () => s.graphics?.godrays !== false, (v) => set({ graphics: { godrays: v } }),
        { hint: tr({ de: 'Sonnenlicht in Staub und Dunst, ab Qualität Mittel und mit Schatten', en: 'sunlight in dust and haze, from medium quality with shadows' }) }),
      slider(t('settings.resolution'), () => clamp(s.graphics?.resolutionScale ?? 1, 0.5, 1.5), debounced((v) => set({ graphics: { resolutionScale: v } }), 400), { min: 0.5, max: 1.5, step: 0.05 }),
      // the frame cap: a phone starts at 30 (core/api-web.js), everything else draws at the display's rate
      seg(t('settings.frameCap'), [['0', t('settings.frameCap.display')], ['30', '30'], ['60', '60']],
        () => String([30, 60].includes(+s.graphics?.frameCap) ? +s.graphics.frameCap : 0), (v) => set({ graphics: { frameCap: +v } })),

      groupTitle(tr({ de: 'Licht', en: 'Light' })),
      slider(t('settings.brightness'), () => clamp(s.light?.brightness ?? 1, BRIGHT_MIN, BRIGHT_MAX), debounced((v) => set({ light: { brightness: v } }), 120),
        { min: BRIGHT_MIN, max: BRIGHT_MAX, step: 0.02, hint: tr({ de: '100 % ist das gemütliche Normalmaß', en: '100 % is the cosy default' }) }),
      slider(t('settings.warmth'), () => clamp(s.light?.warmth ?? 0.65, 0, 1), debounced((v) => set({ light: { warmth: v } }), 120)),

      groupTitle(tr({ de: 'Kamera', en: 'Camera' })),
      slider(t('settings.fov'), () => s.graphics?.fov || 72, debounced((v) => set({ graphics: { fov: v } })), { min: 55, max: 95, step: 1, fmt: (v) => Math.round(v) + '°' }),
      slider(t('settings.sensitivity'), () => s.graphics?.mouseSensitivity || 1, debounced((v) => set({ graphics: { mouseSensitivity: v } })), { min: 0.3, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2) + '×' }),
      note(tr({ de: 'Wenn das Bild zu hell wirkt, die Helligkeit auf 100 % stellen und „Weiches Leuchten“ ausschalten. Dann bleibt Cozy Shelves ruhig und warm.', en: 'If the picture looks too bright, set the brightness to 100 % and turn “soft glow” off. The reading room then stays calm and warm.' })),
    ],

    light: () => [
      slider(t('settings.brightness'), () => clamp(s.light?.brightness ?? 1, BRIGHT_MIN, BRIGHT_MAX), debounced((v) => set({ light: { brightness: v } }), 120), { min: BRIGHT_MIN, max: BRIGHT_MAX, step: 0.02 }),
      slider(t('settings.warmth'), () => clamp(s.light?.warmth ?? 0.65, 0, 1), debounced((v) => set({ light: { warmth: v } }), 120)),
      // the time of day and the weather (settings-sky.js)
      ...skyRows({ ui: { seg, slider, toggle, groupTitle, note, debounced, keep }, s: () => s, set, render, ctx }),
      // the season of the garden (world/season.js, seasons.js): by the calendar or one chosen
      // (the switch "Schnee" of the changing weather depends on the season: the section is drawn again)
      seg(tr({ de: 'Jahreszeit', en: 'Season' }), [['auto', tr({ de: 'Nach Kalender', en: 'By calendar' })], ['spring', tr({ de: 'Frühling', en: 'Spring' })], ['summer', tr({ de: 'Sommer', en: 'Summer' })], ['autumn', tr({ de: 'Herbst', en: 'Autumn' })], ['winter', tr({ de: 'Winter', en: 'Winter' })]], () => s.season || 'auto', (v) => set({ season: v }).then(render)),
    ],

    // the sounds of the world follow the world (audio/soundscape.js): only their volume is set here
    audio: () => [
      slider(t('settings.music'), () => s.audio?.music ?? 0.45, debounced((v) => set({ audio: { music: v } }), 100)),
      slider(tr({ de: 'Umgebung', en: 'Surroundings' }), () => s.audio?.ambient ?? 0.6, debounced((v) => set({ audio: { ambient: v } }), 100),
        { hint: tr({ de: 'Regen, Wind, Gewitter, Kaminfeuer, Uhr und Garten', en: 'Rain, wind, thunder, fireplace, clock and garden' }) }),
      slider(t('settings.sfx'), () => s.audio?.sfx ?? 0.7, debounced((v) => set({ audio: { sfx: v } }), 100),
        { hint: tr({ de: 'Schritte, Bücher, Sitzen und Knöpfe', en: 'Footsteps, books, sitting down and buttons' }) }),
      note(tr({
        de: 'Regen und Wind hörst du, wenn das Wetter sie bringt, den Donner nach dem Blitz. Kaminfeuer und Uhr hörst du in ihrer Nähe, durch Glas und Wände leiser. Im Garten singen am Tag die Vögel, in der Dämmerung quaken Frösche am See, im Sommer zirpen nachts Grillen, je nach Jahreszeit mehr oder weniger.',
        en: 'You hear rain and wind when the weather brings them, and the thunder after the lightning. You hear the fireplace and the clock near them, more softly through glass and walls. In the garden birds sing by day, frogs croak at the lake at dusk and crickets chirp on summer nights, more or less depending on the season.',
      })),
      ...soundSwitchRows({ s: () => s, set, toggle, groupTitle, note }),
      groupTitle(tr({ de: 'Musik', en: 'Music' })),
      pauseMusicRow(),
      h('div.setting', h('label', tr({ de: 'Plattenspieler & eigene Musik', en: 'Record player & own music' })),
        h('button.btn.small', { onclick: () => ctx.openPanel('records', {}) }, '♪ ' + tr({ de: 'Öffnen', en: 'Open' }))),
    ],

    // the films of the Mediathek: the resolution every film starts with (the closest one it has), and the music while
    // a film or a podcast plays
    mediathek: () => [
      seg(tr({ de: 'Bevorzugte Qualität', en: 'Preferred quality' }),
        PREFERENCES.map((v) => [v, v === 'auto' ? tr({ de: 'Automatisch', en: 'Automatic' }) : `${v}p`]),
        () => preferenceOf(s.mediathek?.quality), (v) => set({ mediathek: { quality: v } })),
      note(tr({
        de: 'Automatisch spielt die größte Auflösung, die zur Fenstergröße passt, und geht eine Stufe niedriger, wenn das Bild stockt. Mit einer festen Auflösung spielt jeder Film die nächstgelegene, die er anbietet. Live-TV passt sich bei Automatisch der Leitung selbst an. Im Player wählt die Qualitätstaste (Q) die Auflösung des laufenden Films. Beim Herunterladen ist die nächstgelegene Auflösung vorgewählt, bei Automatisch die größte.',
        en: 'Automatic plays the largest resolution that suits the window size and goes one step lower if the picture stalls. With a fixed resolution every film plays the closest one it offers. Live TV on Automatic adapts to the connection by itself. In the player the quality button (Q) chooses the resolution of the running film. Downloads preselect the closest resolution, the largest for Automatic.',
      })),
      pauseMusicRow(),
    ],

    tts: () => ttsSection(),

    // the gamepad: connection, its buttons, look speed, invert Y, vibration (input/pad-settings.js)
    controller: () => controllerSection({ s: () => s, set, slider, toggle, note, groupTitle, debounced, keep, bus }),

    library: () => {
      const rows = (s.folders || []).map((f, i) => h('div.folder-row',
        h('span.path', f.path),
        h('span.small.muted', t('settings.mode.' + (f.mode || 'structured'))),
        h('button.btn.small.ghost', { onclick: async () => { const folders = s.folders.filter((_, k) => k !== i); await api.library.setFolders(folders); await set({ folders }); render(); } }, t('settings.remove'))));
      return [
        groupTitle(t('settings.folders')),
        rows.length ? rows : note(tr({ de: 'Noch kein Bücherordner. Füge einen hinzu, damit sich die Regale füllen.', en: 'No book folder yet. Add one so the shelves fill up.' })),
        h('div.row', { style: { marginTop: '14px' } },
          h('button.btn', { onclick: async () => { const f = await api.library.addFolder('structured'); if (f) { s.folders = f; render(); } } }, '＋ ' + t('settings.addStructured')),
          h('button.btn', { onclick: async () => { const f = await api.library.addFolder('auto'); if (f) { s.folders = f; render(); } } }, '＋ ' + t('settings.addAuto')),
          h('button.btn.ghost', { onclick: () => api.library.rescan() }, '↻ ' + t('settings.rescan'))),
        note(tr({ de: '„Ordner = Regale“: Unterordner werden zu Abteilungen und Regalen. „Automatisch“: Bücher werden anhand von Metadaten, ISBN und Schlagwörtern einsortiert.', en: '“Folders = shelves”: sub-folders become departments and shelves. “Automatic”: books are shelved by metadata, ISBN and keywords.' })),
        // the browser version reads the folder in the page; Firefox and Safari forget it when the page closes
        isWeb ? note(tr({ de: 'Im Browser bleiben die Bücher auf deinem Rechner und werden nur gelesen. Chromium-Browser (Edge, Chrome) merken sich den Ordner und fragen nach einem Neustart einmal nach der Erlaubnis; Firefox und Safari brauchen den Ordner nach jedem Neustart erneut. Word- und RTF-Dateien bleiben im Browser außen vor.', en: 'In the browser the books stay on your computer and are only read. Chromium browsers (Edge, Chrome) remember the folder and ask for permission once after a restart; Firefox and Safari need the folder again after every restart. Word and RTF files are left out in the browser.' })) : null,
        ...(has('webCovers') ? coverRows() : []),
        // the order in the shelves, the case "Gelesen", the reading goal, duplicate books (shelf-settings.js)
        ...shelfSettingsRows({ cur: () => s, set, toggle, groupTitle, note, debounced, ctx }),
        ...(has('fulltext') ? fulltextRows({ api, s: () => s, set, toggle, note, groupTitle, keep, render }) : []),
        groupTitle(tr({ de: 'Am Sitzplatz', en: 'At your seat' })),
        toggle(tr({ de: 'Zuletzt geöffnetes Buch am Sitzplatz bereitlegen', en: 'Lay out the book you opened last at your seat' }), () => s.lastBookAtSeat === true, (v) => set({ lastBookAtSeat: v }),
          { hint: tr({ de: 'Es liegt beim Hinsetzen vor dir, auch wenn es nicht im Korb ist.', en: 'It lies in front of you when you sit down, also when it is not in the basket.' }) }),
      ];
    },

    // the audiobook folders (ui/audiobooks/ab-settings.js)
    audiobooks: () => audiobookSettings({ ctx, note, groupTitle, keep }),
  };

  // ---------------------------------------------------------------- covers from the internet
  /** Covers and metadata from the internet, "Alle Cover jetzt laden" and its progress (cover-settings.js). */
  function coverRows() {
    return coverSettingsRows({ api, ctx, getS: () => s, set, toggle, note, groupTitle, keep });
  }

  // ---------------------------------------------------------------- read aloud
  function ttsSection() {
    const statusLine = h('div.tts-status.small', h('span.tts-dot'), h('span.tts-text', tr({ de: 'Status wird geprüft …', en: 'checking status …' })));
    const loading = (label) => h('div.setting', h('label', label), h('div.ctl', h('span.small.muted', tr({ de: 'wird geladen …', en: 'loading …' }))));
    // deliberately not t('settings.ttsGerman') – that key still names one specific engine
    const germanLabel = tr({ de: 'Deutsche Stimme', en: 'German voice' });
    const germanWrap = loading(germanLabel);
    const englishWrap = loading(t('settings.ttsEnglish'));

    const showStatus = (st) => {
      if (!st) return;
      // 'loading' means two things: a download that runs right now, or a voice that is fetched on the first read-aloud
      const downloading = st.piperDetail?.state === 'loading';
      const de = {
        ready: tr({ de: 'deutsche Stimme bereit', en: 'German voice ready' }),
        loading: downloading ? tr({ de: 'deutsche Stimme wird geladen', en: 'German voice is downloading' }) : tr({ de: 'deutsche Stimme lädt beim ersten Vorlesen', en: 'German voice loads on first use' }),
        starting: tr({ de: 'deutsche Stimme startet …', en: 'German voice starting …' }),
        'not-installed': tr({ de: 'deutsche Stimme nicht eingerichtet', en: 'German voice not installed' }),
        unavailable: tr({ de: 'deutsche Stimme nicht verfügbar', en: 'German voice unavailable' }),
      }[st.german] || String(st.german || '');
      const en = {
        ready: tr({ de: 'englische Stimme bereit', en: 'English voice ready' }),
        loading: tr({ de: 'englische Stimme lädt beim ersten Vorlesen', en: 'English voice loads on first use' }),
        unavailable: tr({ de: 'englische Stimme nicht verfügbar', en: 'English voice unavailable' }),
      }[st.english] || String(st.english || '');
      const device = st.germanDetail?.device ? ' · ' + st.germanDetail.device : '';
      const msg = st.message ? ' · ' + st.message : '';
      statusLine.classList.toggle('ok', st.german === 'ready');
      statusLine.classList.toggle('warn', st.german === 'starting' || st.german === 'not-installed' || downloading);
      statusLine.classList.toggle('bad', st.german === 'unavailable');
      statusLine.querySelector('.tts-text').textContent = `${t('settings.ttsStatus')}: ${de} · ${en}${device}${msg}`;
    };
    const refresh = async () => {
      try { const c = await getTts(); if (c) showStatus(await c.status()); } catch (e) { console.warn('[settings] tts status', e); }
    };
    keep(bus.on('tts:status', showStatus));   // stays live while the sidecar starts up / downloads
    refresh();

    // Both voice lists come from the TTS client (local speech engines) – never hard-coded here.
    const SAMPLE = { de: 'Guten Abend. Setzen Sie sich ans Feuer, ich lese Ihnen vor.', en: 'Good evening. Sit down by the fire, I will read to you.' };
    // Rows that only make sense for the legacy Kartoffelbox engine are hidden unless it is selected.
    const legacyRows = [];
    const syncLegacy = async (voiceId) => {
      let engine = null;
      try { const c = await getTts(); engine = c?.engineForVoice?.(voiceId) ?? null; } catch {}
      const show = engine === 'kartoffelbox';
      for (const row of legacyRows) row.classList.toggle('hidden', !show);
    };

    const fillVoices = async (wrap, lang, label, settingKey, missing) => {
      let voices = [];
      const client = await getTts();
      try { voices = (await client?.voices(lang)) || []; } catch (e) { console.warn('[settings] tts voices', lang, e); }
      if (!wrap.isConnected) return;
      clear(wrap);
      if (!voices.length) { wrap.append(h('label', label), h('div.ctl', h('span.small.muted', missing))); return; }
      const current = voices.some((v) => v.id === s.tts?.[settingKey]) ? s.tts[settingKey] : voices[0].id;
      const sel = h('select.input', { 'aria-label': label, onchange: async () => { await set({ tts: { [settingKey]: sel.value } }); if (lang === 'de') { syncLegacy(sel.value); fillVoices(wrap, lang, label, settingKey, missing); } } },
        voices.map((v) => h('option', { value: v.id }, v.name || v.id)));
      sel.value = current;
      const test = h('button.btn.small.ghost', { title: tr({ de: 'Stimme anhören', en: 'Hear this voice' }), 'aria-label': tr({ de: 'Stimme anhören', en: 'Hear this voice' }), onclick: () => {
        try { client.speak([SAMPLE[lang] || SAMPLE.de], { lang, voice: sel.value, speed: s.tts?.speed || 1 }); }
        catch (e) { console.warn('[settings] tts preview', e); ctx.toast?.(tr({ de: 'Vorlesen nicht möglich', en: 'Cannot read aloud' })); }
      } }, '▶');
      const ctl = h('div.ctl', sel, test);
      const voice = voices.find((v) => v.id === current);
      // downloadable local voices (Piper/Thorsten): load once, remove again
      if (lang === 'de' && voice && voice.installed === false && client?.installVoice) {
        // one button: "Herunterladen", while the download runs "Abbrechen" (the progress is in the status line)
        const dl = h('button.btn.small');
        const busy = (on) => {
          dl.dataset.busy = on ? '1' : '';
          dl.textContent = on ? tr({ de: 'Abbrechen', en: 'Cancel' }) : tr({ de: 'Herunterladen', en: 'Download' });
          dl.title = on ? tr({ de: 'Download abbrechen', en: 'Cancel the download' }) : tr({ de: 'Stimme jetzt herunterladen ({mb} MB)', en: 'Download the voice now ({mb} MB)' }, { mb: Math.round((voice.bytes || 0) / 1048576) });
        };
        dl.onclick = async () => {
          if (dl.dataset.busy) { client.cancelVoiceDownload?.(voice.id); return; }
          busy(true);
          try { await client.installVoice(voice.id); ctx.toast?.(tr({ de: 'Die Stimme {v} ist geladen.', en: 'The voice {v} is ready.' }, { v: voice.plainName || voice.name })); }
          catch (err) {
            if (err?.code === 'cancelled') ctx.toast?.(tr({ de: 'Download abgebrochen', en: 'Download cancelled' }));
            else { ctx.toast?.(tr({ de: 'Download fehlgeschlagen: {m}', en: 'Download failed: {m}' }, { m: err?.message || '' })); console.warn('[settings] voice download', err); }
          }
          if (wrap.isConnected) { fillVoices(wrap, lang, label, settingKey, missing); refresh(); }
        };
        busy(!!voice.downloading);
        ctl.appendChild(dl);
      } else if (lang === 'de' && voice?.installed && voice.engine === 'piper' && client?.removeVoice) {
        ctl.appendChild(h('button.btn.small.ghost', {
          title: tr({ de: 'Stimme vom Rechner entfernen', en: 'Remove this voice from disk' }),
          onclick: async () => { try { await client.removeVoice(voice.id); } catch {} fillVoices(wrap, lang, label, settingKey, missing); refresh(); },
        }, '✕'));
      }
      wrap.append(h('label', label), ctl);
      // voices with several moods (thorsten_emotional) get a second selector
      if (lang === 'de' && voice?.speakers?.length > 1) {
        const cur = s.tts?.germanSpeaker && voice.speakers.includes(s.tts.germanSpeaker) ? s.tts.germanSpeaker : voice.speakers[0];
        const spk = h('select.input', { 'aria-label': tr({ de: 'Stimmung', en: 'Mood' }), onchange: () => set({ tts: { germanSpeaker: spk.value } }) },
          voice.speakers.map((x) => h('option', { value: x }, x)));
        spk.value = cur;
        wrap.after(h('div.setting', h('label', tr({ de: 'Stimmung', en: 'Mood' })), h('div.ctl', spk)));
      }
      if (lang === 'de') syncLegacy(current);
    };
    fillVoices(germanWrap, 'de', germanLabel, 'germanVoice', tr({ de: 'Keine deutsche Stimme gefunden.', en: 'No German voice found.' }));
    fillVoices(englishWrap, 'en', t('settings.ttsEnglish'), 'englishVoice', tr({ de: 'keine englische Stimme verfügbar', en: 'no English voice available' }));

    const legacyRow = (el) => { legacyRows.push(el); return el; };
    return [
      groupTitle(t('settings.tts')),
      statusLine,
      germanWrap,
      legacyRow(h('div.setting.hidden',
        h('label', s.tts?.germanPrompt
          ? h('span.settings-path', s.tts.germanPrompt.split(/[\\/]/).pop())
          : h('span', tr({ de: 'Keine eigene Referenzstimme', en: 'No custom reference voice' }))),
        h('div.ctl',
          h('button.btn.small', { onclick: async () => { const p = await api.tts.pickPrompt(); if (p) { await set({ tts: { germanPrompt: p } }); render(); } } }, t('settings.ttsPrompt')),
          s.tts?.germanPrompt ? h('button.btn.small.ghost', { title: tr({ de: 'Referenzstimme entfernen', en: 'Remove reference voice' }), onclick: async () => { await set({ tts: { germanPrompt: null } }); render(); } }, '✕') : null))),
      legacyRow(h('div.setting.hidden',
        h('label', tr({ de: 'Deutsche Sprachausgabe (Kartoffelbox)', en: 'German speech engine (Kartoffelbox)' })),
        h('div.ctl',
          h('button.btn.small', { onclick: () => { api.tts.setup(); setTimeout(refresh, 2000); } }, t('settings.ttsSetup')),
          h('button.btn.small.ghost', { title: tr({ de: 'Jetzt starten', en: 'Start now' }), onclick: () => api.tts.start().then(refresh).catch(() => refresh()) }, '▶'),
          h('button.btn.small.ghost', { title: tr({ de: 'Status neu prüfen', en: 'Re-check status' }), onclick: refresh }, '↻')))),
      groupTitle(tr({ de: 'Englisch', en: 'English' })),
      englishWrap,
      slider(t('settings.speed'), () => s.tts?.speed || 1, debounced((v) => set({ tts: { speed: v } })), { min: 0.7, max: 1.5, step: 0.05, fmt: (v) => v.toFixed(2) + '×' }),
      has('ttsDownloads') ? note(tr({
        de: 'Deutsche Texte spricht eine Stimme, die auf diesem Rechner läuft. Standard ist „Martin“ (Kokoro), die natürlichste Stimme. Martin und Thorsten (hoch) rechnen auf der Grafikkarte (WebGPU), die übrigen Piper-Stimmen auf dem Prozessor. Die gewählte Stimme wird beim ersten Vorlesen einmal heruntergeladen und arbeitet danach ohne Internet. Für die englische Stimme (Kokoro) gilt dasselbe.',
        en: 'German texts are spoken by a voice that runs on this computer. The default is “Martin” (Kokoro), the most natural voice. Martin and Thorsten (hoch) run on the graphics card (WebGPU), the other Piper voices on the processor. The selected voice is downloaded once on the first read-aloud and then works without internet. The same applies to the English voice (Kokoro).',
      })) : note(tr({
        de: 'Im Browser liest die Sprachausgabe des Browsers vor. Welche Stimmen es gibt, hängt vom Browser und vom Betriebssystem ab; die Stimmen der Desktop-App (Martin, Thorsten, Kokoro) gibt es hier nicht.',
        en: 'In the browser the browser’s own speech output reads aloud. Which voices exist depends on the browser and the operating system; the voices of the desktop app (Martin, Thorsten, Kokoro) are not here.',
      })),
      // every voice at once (tts-all-voices.js); afterwards the German list loses its "60 MB laden" notes
      ...(has('ttsDownloads') ? allVoicesRows({ getTts, keep, groupTitle, onDone: () => { if (germanWrap.isConnected) fillVoices(germanWrap, 'de', germanLabel, 'germanVoice', tr({ de: 'Keine deutsche Stimme gefunden.', en: 'No German voice found.' })); } }) : []),
    ];
  }

  // ---------------------------------------------------------------- render
  function render() {
    dropSection();
    clear(panel);
    const nav = h('div.settings-nav', { role: 'tablist' }, ...SECTIONS.map((k) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': section === k ? 'true' : 'false',
      class: section === k ? 'active' : '', onclick: () => { section = k; render(); },
    }, t('settings.' + k))));
    const content = h('div.settings-content', { role: 'tabpanel' }, ...sections[section]());
    panel.append(
      h('div.panel-header', t('settings.title'), h('span.spacer'),
        h('button.btn.icon', { title: tr({ de: 'Schließen', en: 'Close' }), 'aria-label': tr({ de: 'Schließen', en: 'Close' }), onclick: ctx.close }, '✕')),
      h('div.settings-body', nav, content),
    );
  }
  render();

  // Changes from outside (F11, the menu's ⛶ button) must not leave a stale switch behind.
  const offSettings = api.settings.onChange?.((ns) => {
    if (!ns) return;
    const themeChanged = themeOf(ns) !== themeOf(s);
    s = ns; state.settings = ns;
    if (themeChanged && section === 'general') render();
    if (liveFullscreen?.isConnected) {
      const v = !!ns.window?.fullscreen;
      liveFullscreen.classList.toggle('on', v);
      liveFullscreen.setAttribute('aria-checked', v ? 'true' : 'false');
    }
  });
  // Every change of the settings passes through i18n.setLanguage (main.js), before this panel's own copy has it: a
  // switch drew itself with the old value again (Bibliothekskatze off, still shown on). Draw anew only when the
  // language really changed, and with the settings of this moment.
  let shownLang = ctx.i18n?.lang;
  const offLang = bus.on('i18n:change', (lang) => {
    s = state.settings || s;
    if (lang === shownLang) return;
    shownLang = lang;
    render();
  });

  return {
    unmount() {
      offLang(); offSettings?.(); dropSection();
      for (const tm of timers) clearTimeout(tm);
      timers.clear();
    },
  };
}
