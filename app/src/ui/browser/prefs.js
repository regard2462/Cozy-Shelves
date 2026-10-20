// Preferences of the reading browser (settings.browser): typography, themes, paging and the quick switches.
// The main process reads adblock / js / images / textOnly / sites from the same object (electron/browser).
import { clamp } from './util.js';

export const THEMES = {
  paper: { de: 'Papier', en: 'Paper' },
  sepia: { de: 'Sepia', en: 'Sepia' },
  eink: { de: 'E-Ink', en: 'E-Ink' },
  night: { de: 'Nacht', en: 'Night' },
};

/** css: font stack in the app (bundled fonts first); web: stack for guest pages, which only have system fonts. */
export const FONTS = {
  garamond: { label: 'EB Garamond', css: '"EB Garamond", "Palatino Linotype", Georgia, serif', web: '"EB Garamond", Garamond, "Palatino Linotype", Georgia, serif' },
  cormorant: { label: 'Cormorant', css: '"Cormorant Garamond", "EB Garamond", Georgia, serif', web: '"Cormorant Garamond", Garamond, Georgia, serif', scale: 1.08 },
  playfair: { label: 'Playfair', css: '"Playfair Display", Georgia, serif', web: '"Playfair Display", Georgia, serif', scale: 0.92 },
  georgia: { label: 'Georgia', css: 'Georgia, "Times New Roman", serif', web: 'Georgia, "Times New Roman", serif', scale: 0.93 },
  palatino: { label: 'Palatino', css: '"Palatino Linotype", Palatino, "Book Antiqua", serif', web: '"Palatino Linotype", Palatino, "Book Antiqua", serif', scale: 0.95 },
  sans: { label: 'Serifenlos', en: 'Sans serif', css: '"Segoe UI", "Source Sans 3", Arial, sans-serif', web: '"Segoe UI", Arial, sans-serif', scale: 0.92 },
  verdana: { label: 'Verdana', css: 'Verdana, "Segoe UI", sans-serif', web: 'Verdana, "Segoe UI", sans-serif', scale: 0.84 },
  mono: { label: 'Mono', css: '"Cascadia Mono", Consolas, "Courier New", monospace', web: '"Cascadia Mono", Consolas, "Courier New", monospace', scale: 0.84 },
};

export const MEASURES = [26, 32, 38, 46, 0];      // text width in em (0 = the full width of the page)
export const MARGINS = ['narrow', 'normal', 'wide'];

export const DEFAULT_PREFS = {
  theme: 'paper',
  themeChosen: false,    // false: Papier follows the appearance of the app (Nacht with "Dunkel")
  font: 'garamond',
  fontSize: 21,          // px in the reader
  lineHeight: 1.55,
  measure: 32,
  margin: 'normal',
  align: 'justify',      // justify | left
  hyphens: true,
  bold: false,           // "Fett": heavier text for low-contrast screens
  black: false,          // "Tiefschwarz": all text pure black (reader and pages)
  readerImages: true,
  columns: 'auto',       // auto | 1 | 2
  paging: 'pages',       // pages | scroll (reader mode)
  overlap: 2,            // lines kept visible when a web page is turned
  zones: true,           // page-turn strips left and right
  line: true,            // overlap line after a page turn
  webFont: false,        // the reader font on web pages too
  webStyle: true,        // theme (night: dark pages, E-Ink: no animations) and bold/black on web pages
  // quick switches
  adblock: true, js: true, images: true, cookies: true, textOnly: false, mobile: false,
  searchEngine: 'duckduckgo',
  restoreSession: true,
  ttsSpeed: 1,
  sites: {},             // host → { js?: boolean, adblock?: boolean, zoom?: number }
};

const pick = (v, list, d) => (list.includes(v) ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? clamp(Number(v), lo, hi) : d);

export function normalizePrefs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const D = DEFAULT_PREFS;
  const sites = {};
  if (r.sites && typeof r.sites === 'object') {
    for (const [host, v] of Object.entries(r.sites).slice(0, 800)) {
      if (!v || typeof v !== 'object' || !/^[\w.-]+$/.test(host)) continue;
      const o = {};
      if (typeof v.js === 'boolean') o.js = v.js;
      if (v.adblock === false) o.adblock = false;
      if (Number.isFinite(v.zoom) && Math.abs(v.zoom - 1) > 0.001) o.zoom = clamp(v.zoom, 0.3, 3);
      if (Object.keys(o).length) sites[host] = o;
    }
  }
  return {
    theme: pick(r.theme, Object.keys(THEMES), D.theme),
    themeChosen: bool(r.themeChosen, D.themeChosen),
    font: pick(r.font, Object.keys(FONTS), D.font),
    fontSize: Math.round(num(r.fontSize, 13, 44, D.fontSize)),
    lineHeight: Math.round(num(r.lineHeight, 1.1, 2.2, D.lineHeight) * 100) / 100,
    measure: MEASURES.includes(Number(r.measure)) ? Number(r.measure) : D.measure,
    margin: pick(r.margin, MARGINS, D.margin),
    align: pick(r.align, ['justify', 'left'], D.align),
    hyphens: bool(r.hyphens, D.hyphens),
    bold: bool(r.bold, D.bold),
    black: bool(r.black, D.black),
    readerImages: bool(r.readerImages, D.readerImages),
    columns: pick(String(r.columns), ['auto', '1', '2'], D.columns),
    paging: pick(r.paging, ['pages', 'scroll'], D.paging),
    overlap: Math.round(num(r.overlap, 0, 6, D.overlap)),
    zones: bool(r.zones, D.zones),
    line: bool(r.line, D.line),
    webFont: bool(r.webFont, D.webFont),
    webStyle: bool(r.webStyle, D.webStyle),
    adblock: bool(r.adblock, D.adblock), js: bool(r.js, D.js), images: bool(r.images, D.images),
    cookies: bool(r.cookies, D.cookies), textOnly: bool(r.textOnly, D.textOnly), mobile: bool(r.mobile, D.mobile),
    searchEngine: typeof r.searchEngine === 'string' && /^[a-z]+$/.test(r.searchEngine) ? r.searchEngine : D.searchEngine,
    restoreSession: bool(r.restoreSession, D.restoreSession),
    ttsSpeed: num(r.ttsSpeed, 0.5, 2, D.ttsSpeed),
    sites,
  };
}

/** Colours per theme for the guest overlap line and the print/PDF view. */
export const LINE_COLOR = { paper: '#b5562a', sepia: '#8a4a1c', eink: '#000000', night: '#1d56b0' /* drawn into an inverted page */ };
