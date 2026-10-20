// Einstellungen → Controller: whether a pad is connected (with its name), a picture of the pad whose buttons light up
// when they are pressed, the list of what every button does, the look speed, "Y invertieren" and the vibration (a short
// rumble when a book is taken; only for pads that can). The picture follows the pad's family (Xbox, PlayStation,
// Nintendo). Built by ui/settings.js with its own primitives.
import { h } from '../core/dom.js';
import { tr } from '../core/i18n.js';
import { padState, glyph, fillGlyphs } from './pad-hints.js';
import { gamepadInput } from './gamepad.js';

const T = (de, en) => tr({ de, en });

/** The rows of the section. ui: { s, set, slider, toggle, note, groupTitle, debounced, keep, bus } */
export function controllerSection(ui) {
  const { set, slider, toggle, note, groupTitle, debounced, keep, bus } = ui;
  const pad = () => ui.s().gamepad || {};

  // ---- connection
  const status = h('div.pad-status', { role: 'status' });
  const drawStatus = () => {
    status.replaceChildren();
    status.classList.toggle('on', padState.connected);
    if (padState.connected) {
      status.append(h('span.pad-dot'), h('span.pad-status-text', h('b', T('Verbunden', 'Connected')), ' ', padState.name));
      const fam = { xbox: T('Tasten wie bei Xbox', 'Xbox buttons'), playstation: T('Tasten wie bei PlayStation', 'PlayStation buttons'), nintendo: T('Tasten wie bei Nintendo', 'Nintendo buttons') }[padState.family];
      status.append(h('span.pad-status-fam', fam));
    } else {
      status.append(h('span.pad-dot'), h('span.pad-status-text', T('Kein Controller verbunden. Schließe einen Controller an und drücke eine seiner Tasten.', 'No controller connected. Connect a controller and press one of its buttons.')));
    }
  };
  drawStatus();
  const nonStandard = note('');
  const drawNote = () => { nonStandard.textContent = padState.connected && !padState.standard ? T('Dieser Controller meldet keine Standardbelegung. Einzelne Tasten können vertauscht sein.', 'This controller reports no standard layout. Some buttons may be swapped.') : ''; nonStandard.hidden = !nonStandard.textContent; };
  drawNote();

  // ---- the picture and the list
  const figure = h('div.pad-figure', { 'aria-hidden': 'true' });
  const list = h('div.pad-lists');
  const drawFigure = () => { figure.innerHTML = picture(padState.family); list.replaceChildren(...lists()); };
  drawFigure();
  keep(bus.on('pad:connection', () => { drawStatus(); drawNote(); drawFigure(); drawVib(); }));
  keep(bus.on('i18n:change', () => { drawStatus(); drawNote(); drawFigure(); }));
  // pressed buttons light up in the picture while the section is open
  let raf = 0;
  const live = () => {
    raf = 0;
    // (only while the section shows and a pad is connected: a new connection starts it again)
    if (!figure.isConnected || !padState.connected) return;
    const g = gamepadInput();
    if (g) {
      figure.querySelectorAll('[data-b]').forEach((el) => el.classList.toggle('lit', !!g.now[+el.dataset.b]));
      const [lx, ly, rx, ry] = g.axes;
      const ls = figure.querySelector('.pf-ls-cap'), rs = figure.querySelector('.pf-rs-cap');
      if (ls) ls.setAttribute('transform', `translate(${(lx * 7).toFixed(1)} ${(ly * 7).toFixed(1)})`);
      if (rs) rs.setAttribute('transform', `translate(${(rx * 7).toFixed(1)} ${(ry * 7).toFixed(1)})`);
    }
    raf = requestAnimationFrame(live);
  };
  const startLive = () => { if (!raf && padState.connected) raf = requestAnimationFrame(live); };
  keep(bus.on('pad:connection', startLive));
  keep(() => { cancelAnimationFrame(raf); raf = 0; });
  setTimeout(startLive, 0);

  // ---- vibration: the switch, and a test when the pad can
  const vibRow = toggle(T('Vibration', 'Vibration'), () => pad().vibration !== false, (v) => set({ gamepad: { vibration: v } }),
    { hint: T('ein kurzes Rütteln, wenn du ein Buch nimmst', 'a short rumble when you take a book') });
  const test = h('button.btn.small.pad-test', { type: 'button', onclick: () => gamepadInput()?.rumble('test', { force: true }) }, T('Testen', 'Test'));
  const drawVib = () => { test.disabled = !padState.connected || !padState.vibration; test.title = padState.connected && !padState.vibration ? T('Dieser Controller kann nicht vibrieren.', 'This controller cannot vibrate.') : ''; };
  drawVib();
  // the test button beside the switch, both in the row's control column
  const sw = vibRow.querySelector('.toggle');
  if (sw) { const ctl = h('div.ctl'); sw.replaceWith(ctl); ctl.append(test, sw); }

  return [
    groupTitle(T('Verbindung', 'Connection')),
    status,
    nonStandard,
    groupTitle(T('Umsehen', 'Looking around')),
    slider(T('Empfindlichkeit', 'Sensitivity'), () => pad().sensitivity || 1, debounced((v) => set({ gamepad: { sensitivity: v } })),
      { min: 0.3, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2) + '×', hint: T('wie schnell der rechte Stick die Blickrichtung dreht', 'how fast the right stick turns the view') }),
    toggle(T('Y invertieren', 'Invert Y'), () => pad().invertY === true, (v) => set({ gamepad: { invertY: v } }),
      { hint: T('Stick nach vorn schaut nach unten', 'stick forward looks down') }),
    vibRow,
    groupTitle(T('Tasten', 'Buttons')),
    figure,
    list,
    note(T('Die Hinweise im Bild zeigen die Tasten des Controllers, solange du ihn benutzt, und wieder die der Tastatur, sobald du Tastatur oder Maus verwendest.', 'The hints on the screen show the controller’s buttons while you use it, and the keys again as soon as you use the keyboard or the mouse.')),
  ];
}

/** The two lists: in the library and in panels. */
function lists() {
  const row = ([keys, text]) => h('div.pad-row', h('span.pad-keys', { html: fillGlyphs(keys) }), h('span.pad-what', { html: fillGlyphs(text) }));
  const world = [
    ['{LS}', T('Gehen, je weiter geneigt, desto schneller. Gedrückt: rennen', 'Walk, the further tilted the faster. Pressed: run')],
    ['{RS}', T('Umsehen. Gedrückt: hinsetzen oder aufstehen', 'Look around. Pressed: sit down or stand up')],
    ['{A}', T('Benutzen wie E: Buch in den Korb, hinsetzen, öffnen', 'Use like E: book into the basket, sit down, open')],
    ['{B}', T('Zurück, im Sitzen aufstehen', 'Back, stand up when seated')],
    ['{X}', T('Springen', 'Jump')],
    ['{Y}', T('Korb öffnen', 'Open the basket')],
    ['{LB} {RB}', T('Zweite und dritte Taste der Buchkarte: Lesen, Info', 'Second and third key of the book card: read, info')],
    ['{LT} {RT}', T('Feiner zielen, heranzoomen', 'Aim finely, zoom in')],
    ['{DPAD}', T('Nachbarbuch im Regal. Ohne Buch im Blick: links und rechts spulen, unten bedient den kleinen Spieler', 'Next book on the shelf. Without a book in view: left and right seek, down operates the mini player')],
    ['{START} {VIEW}', T('Menü und Orte. {VIEW} gehalten: Abteilungsrad, dort wechseln {LB} und {RB} zwischen Abteilungen und Orten', 'Menu and places. {VIEW} held: department wheel, there {LB} and {RB} switch between departments and places')],
  ];
  const panels = [
    ['{DPAD} {LS}', T('Auswahl bewegen', 'Move the selection')],
    ['{A}', T('Drücken. Ein Textfeld öffnet die Tastatur auf dem Bildschirm', 'Press. A text field opens the on-screen keyboard')],
    ['{B}', T('Zurück oder schließen', 'Back or close')],
    ['{LB} {RB}', T('Reiter wechseln, im Buch blättern', 'Switch tabs, turn pages in a book')],
    ['{RS}', T('Rollen. Gedrückt: ein Mauszeiger für Schachbrett, Staffelei und Webseiten', 'Scroll. Pressed: a mouse pointer for the chess board, the easel and web pages')],
    ['{Y} {X}', T('Im Buch: vorlesen, Lesezeichen', 'In a book: read aloud, bookmark')],
    ['{LS} {LT} {RT}', T('Weltkarte: verschieben und zoomen, {A} öffnet den Steckbrief', 'World map: move and zoom, {A} opens the profile')],
  ];
  return [
    h('div.pad-list', h('h4', T('In der Bücherei', 'In the library')), ...world.map(row)),
    h('div.pad-list', h('h4', T('In Tafeln und Menüs', 'In panels and menus')), ...panels.map(row)),
  ];
}

/** A drawing of a pad (Xbox layout; the labels follow the family), every button marked with its index. */
function picture(family) {
  const L = (name) => glyphText(name, family);
  const face = (b, x, y, name) => `<g class="pf-btn pf-face pf-${name}" data-b="${b}"><circle cx="${x}" cy="${y}" r="11"/><text x="${x}" y="${y + 4.5}">${L(name)}</text></g>`;
  const pill = (b, x, y, w, label, cls = '') => `<g class="pf-btn ${cls}" data-b="${b}"><rect x="${x - w / 2}" y="${y - 7}" width="${w}" height="14" rx="7"/><text x="${x}" y="${y + 4}">${label}</text></g>`;
  const stickAt = (b, x, y, cls) => `<g class="pf-btn pf-stick" data-b="${b}"><circle cx="${x}" cy="${y}" r="20" class="pf-well"/><g class="${cls}"><circle cx="${x}" cy="${y}" r="14"/><circle cx="${x}" cy="${y}" r="8" class="pf-dimple"/></g></g>`;
  const dpad = (x, y) => [['up', 12, x, y - 13], ['down', 13, x, y + 13], ['left', 14, x - 13, y], ['right', 15, x + 13, y]]
    .map(([n, b, cx, cy]) => `<rect class="pf-btn pf-dpad" data-b="${b}" x="${cx - 7}" y="${cy - 7}" width="14" height="14" rx="2.5"/>`).join('') + `<rect class="pf-dpad-hub" x="${x - 7}" y="${y - 7}" width="14" height="14"/>`;
  const sh = (b, x, y, w, label) => `<g class="pf-btn pf-shoulder" data-b="${b}"><rect x="${x - w / 2}" y="${y - 9}" width="${w}" height="18" rx="8"/><text x="${x}" y="${y + 4}">${label}</text></g>`;
  const mid = family === 'nintendo' ? ['−', '+'] : ['⧉', '≡'];
  return `<svg viewBox="0 0 360 236" class="pad-svg">
    ${sh(6, 92, 14, 58, L('lt'))}${sh(7, 268, 14, 58, L('rt'))}
    ${sh(4, 92, 38, 70, L('lb'))}${sh(5, 268, 38, 70, L('rb'))}
    <path class="pf-body" d="M64 58 C92 44 140 50 180 50 C220 50 268 44 296 58 C326 74 346 150 342 196 C339 226 312 234 292 214 C272 194 258 172 232 168 L128 168 C102 172 88 194 68 214 C48 234 21 226 18 196 C14 150 34 74 64 58 Z"/>
    ${stickAt(10, 98, 96, 'pf-ls-cap')}
    ${dpad(134, 146)}
    ${stickAt(11, 226, 146, 'pf-rs-cap')}
    ${face(3, 262, 74, 'y')}${face(2, 240, 96, 'x')}${face(1, 284, 96, 'b')}${face(0, 262, 118, 'a')}
    ${pill(8, 158, 86, 22, mid[0], 'pf-mid')}${pill(9, 202, 86, 22, mid[1], 'pf-mid')}
  </svg>`;
}
/** The plain label of a button (for the drawing). */
function glyphText(name, family) {
  const tmp = document.createElement('span');
  tmp.innerHTML = glyph(name, family);
  return tmp.textContent;
}
