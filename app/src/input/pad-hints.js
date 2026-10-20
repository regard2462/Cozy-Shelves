// What the HUD shows for a gamepad: the pad's buttons as small caps in place of the keys, while the pad is the input
// used last (input/gamepad.js sets padState.active and emits 'input:device' on the bus). The face buttons are drawn in
// their colours, the shoulders and triggers as rounded caps, the D-pad, the sticks and the two middle buttons as
// small icons. Xbox and other pads with the standard mapping show A B X Y, LB RB, LT RT; PlayStation pads ✕ ○ □ △,
// L1 R1, L2 R2; Nintendo pads their own letters at the same places (B A Y X), L R, ZL ZR, − and +.
// This module holds no timers and polls nothing: without a pad it costs nothing.
import { t, tr } from '../core/i18n.js';

/** The pad as the HUD sees it: active = the pad was the input used last; family picks the glyphs. */
export const padState = { active: false, connected: false, family: 'xbox', name: '', vibration: false, standard: true };

const LABELS = {
  xbox: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT' },
  playstation: { a: '✕', b: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2' },
  nintendo: { a: 'B', b: 'A', x: 'Y', y: 'X', lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR' },
};

/** Which glyphs fit a pad: its id names the maker (Sony 054c, Nintendo 057e) or the model. */
export function familyOf(id = '') {
  const s = String(id);
  if (/vendor:\s*054c|playstation|dualshock|dualsense/i.test(s)) return 'playstation';
  if (/vendor:\s*057e|nintendo|switch pro|joy-con/i.test(s)) return 'nintendo';
  return 'xbox';
}
/** The pad's name without the technical part Chromium adds: "Xbox Wireless Controller". */
export function padName(id = '') {
  const s = String(id).replace(/\s*\((?:[^()]*?)(?:STANDARD GAMEPAD|Vendor:|XInput)[^()]*\)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
  return s || tr({ de: 'Controller', en: 'Controller' });
}

const svg = (body, vb = '0 0 16 16') => `<svg viewBox="${vb}" width="1em" height="1em" aria-hidden="true" focusable="false">${body}</svg>`;
// the D-pad: a cross, the arms that act drawn bright
const ARM = { up: 'M6 1h4v5H6z', down: 'M6 10h4v5H6z', left: 'M1 6h5v4H1z', right: 'M10 6h5v4h-5z' };
function dpad(arms) {
  const lit = arms.map((a) => `<path d="${ARM[a]}" class="lit"/>`).join('');
  return svg(`<path d="M6 1h4v5h5v4h-5v5H6v-5H1V6h5z" class="cross"/>${lit}`);
}
const ICONS = {
  view: svg('<rect x="2.5" y="4.5" width="7" height="6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="6.5" y="6.5" width="7" height="6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/>'),
  start: svg('<path d="M3 4.5h10M3 8h10M3 11.5h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
};

/**
 * One button as HTML: a, b, x, y, lb, rb, lt, rt, view, start, ls, rs (the sticks), l3, r3 (pressed), dpad (all
 * four arms), dpad-h, dpad-v, dpad-up, dpad-down, dpad-left, dpad-right.
 */
export function glyph(name, family = padState.family) {
  const fam = LABELS[family] ? family : 'xbox';
  const L = LABELS[fam];
  const cap = (cls, inner, title) => `<kbd class="pad ${cls}" data-fam="${fam}"${title ? ` title="${title}"` : ''}>${inner}</kbd>`;
  if (L[name]) return cap(`pad-${name}${'abxy'.includes(name) ? ' pad-face' : ' pad-shoulder'}`, L[name]);
  if (name === 'view' || name === 'start') {
    if (fam === 'nintendo') return cap(`pad-${name} pad-mid`, name === 'view' ? '−' : '+');
    return cap(`pad-${name} pad-mid`, ICONS[name]);
  }
  if (name === 'ls' || name === 'rs') return cap('pad-stick', name === 'ls' ? 'L' : 'R');
  if (name === 'l3' || name === 'r3') return cap('pad-stick pad-press', name === 'l3' ? 'L' : 'R');
  if (name.startsWith('dpad')) {
    const part = name.slice(5);
    const arms = part === 'h' ? ['left', 'right'] : part === 'v' ? ['up', 'down'] : part ? [part] : ['up', 'down', 'left', 'right'];
    return cap('pad-dpad', dpad(arms));
  }
  return cap('pad-mid', name);
}

/** {A}, {LB}, {DPAD_H} … in a text become the glyphs of the current pad. */
export function fillGlyphs(text, family = padState.family) {
  return String(text).replace(/\{(A|B|X|Y|LB|RB|LT|RT|VIEW|START|LS|RS|L3|R3|DPAD(?:_[A-Z]+)?)\}/g, (_, k) => glyph(k.toLowerCase().replace('_', '-'), family));
}

/** The pad's versions of the key hints of the HUD (app/src/i18n: the same keys). */
const PAD_TEXTS = {
  'peek.keys': {
    de: '<span>{A} In den Korb</span><span>{LB} Lesen</span><span>{RB} Info</span><span class="pk-more">{DPAD} Nachbarbuch</span>',
    en: '<span>{A} Into the basket</span><span>{LB} Read</span><span>{RB} Info</span><span class="pk-more">{DPAD} Next book</span>',
  },
  'peek.keysTable': {
    de: '<span>{A} Lesen</span><span>{LB} Info</span><span>{RB} Ins Regal</span>',
    en: '<span>{A} Read</span><span>{LB} Info</span><span>{RB} To the shelf</span>',
  },
  'hint.stand': { de: '{B} oder {LS} Aufstehen', en: '{B} or {LS} Stand up' },
  'hud.basketOpen': { de: '{Y} Korb öffnen', en: '{Y} Open the basket' },
  'hud.inBasket': { de: '„{title}“ liegt im Korb. {Y} öffnet den Korb.', en: '“{title}” is in your basket. {Y} opens the basket.' },
  'wheel.hint': { de: 'Stick neigen · {A} wählen · {B} zurück · {LB} {RB} Orte', en: 'Tilt a stick · {A} choose · {B} back · {LB} {RB} places' },
  'wheel.hintPlaces': { de: 'Stick neigen · {A} wählen · {B} zurück · {LB} {RB} Abteilungen', en: 'Tilt a stick · {A} choose · {B} back · {LB} {RB} departments' },
};

// ---- a touch screen (ui/touch-hud.js): the buttons of the screen in place of the keys --------------------------------
/** The touch screen as the HUD sees it: active = the on-screen controls are the input (a phone, the Android app). */
export const touchState = { active: false };
const TOUCH_GLYPHS = {
  USE: '<kbd class="pad touch-key" data-fam="touch" title="Benutzen">✋</kbd>',
  READ: '<kbd class="pad touch-key" data-fam="touch" title="Lesen">📖</kbd>',
  INFO: '<kbd class="pad touch-key" data-fam="touch" title="Info">i</kbd>',
  BASKET: '<kbd class="pad touch-key" data-fam="touch" title="Korb">🧺</kbd>',
  STICK: '<kbd class="pad touch-key" data-fam="touch" title="Stick">◎</kbd>',
};
const TOUCH_TEXTS = {
  'peek.keys': {
    de: '<span>{USE} In den Korb</span><span>{READ} Lesen</span><span>{INFO} Info</span>',
    en: '<span>{USE} Into the basket</span><span>{READ} Read</span><span>{INFO} Info</span>',
  },
  'peek.keysTable': {
    de: '<span>{USE} Lesen</span><span>{INFO} Info</span><span>{READ} Ins Regal</span>',
    en: '<span>{USE} Read</span><span>{INFO} Info</span><span>{READ} To the shelf</span>',
  },
  'hint.stand': { de: '{STICK} Aufstehen', en: '{STICK} Stand up' },
  'hud.basketOpen': { de: '{BASKET} Korb öffnen', en: '{BASKET} Open the basket' },
  'hud.inBasket': { de: '„{title}“ liegt im Korb. {BASKET} öffnet den Korb.', en: '“{title}” is in your basket. {BASKET} opens the basket.' },
  'wheel.hint': { de: 'Antippen wählt · zurück schließt', en: 'Tap to choose · back closes' },
  'wheel.hintPlaces': { de: 'Antippen wählt · zurück schließt', en: 'Tap to choose · back closes' },
};
const fillTouch = (text) => String(text).replace(/\{(USE|READ|INFO|BASKET|STICK)\}/g, (_, k) => TOUCH_GLYPHS[k]);

/** A key hint of the HUD (HTML): the pad's version while the pad is the input used last, the touch version on a
 *  touch screen without a pad, else the keys (t()). */
export function hintText(key, vars) {
  const p = padState.active ? PAD_TEXTS[key] : touchState.active ? TOUCH_TEXTS[key] : null;
  if (!p) return t(key, vars);
  // the glyphs first: a book title with braces in it stays text
  let s = padState.active ? fillGlyphs(tr(p)) : fillTouch(tr(p));
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), () => String(v));
  return s;
}
/** The glyph that stands for "E" in the labels below the crosshair. */
export const useGlyph = () => (padState.active || !touchState.active ? glyph('a') : TOUCH_GLYPHS.USE);
