// Reader appearance: themes, fonts, the width of the page and the CSS injected into the book's section documents
// (foliate paginator `renderer.setStyles([before, after])`).

export const DEFAULTS = {
  fontSize: 19, font: 'garamond', theme: 'paper', lineHeight: 1.55, justify: true, hyphenate: true,
  flow: 'paginated', pageAnimation: true, pageWidth: 68, columns: 2, pdfZoom: 'fit-page',
  // the PDFs shown in the text view ({ <book id>: true }) and how often the hint about it was shown (pdf-text-view.js)
  textView: {}, textViewHints: 0,
};

/** Font size in px and page width in characters per line: the ranges of the sliders in the Aa menu. */
export const FONT_SIZES = { min: 10, max: 48 };
export const PAGE_WIDTHS = { min: 45, max: 110 };
/** The page widths that the margin presets of 0.6 gave at 19 px EB Garamond (settings of older builds). */
export const MARGIN_WIDTHS = { narrow: 90, normal: 68, wide: 54 };

/** Settings of older builds: the margin presets become a page width, once (`widthSchema`). Returns true when changed. */
export function migrateReader(r) {
  if (!r || typeof r !== 'object' || (r.widthSchema || 0) >= 1) return false;
  if (MARGIN_WIDTHS[r.margin]) r.pageWidth = MARGIN_WIDTHS[r.margin];
  delete r.margin;
  r.widthSchema = 1;
  return true;
}

export const THEMES = {
  white: { bg: '#ffffff', fg: '#161616', fg2: '#4d4d4d', link: '#2c5d8c', rule: 'rgba(0,0,0,.22)' },
  paper: { bg: '#f4ecdb', fg: '#2a2016', fg2: '#5b4a39', link: '#8a5a2b', rule: 'rgba(60,40,20,.25)' },
  sepia: { bg: '#e8d5b0', fg: '#3a2914', fg2: '#66502f', link: '#7a4a1e', rule: 'rgba(70,45,15,.3)' },
  night: { bg: '#15110d', fg: '#d8ccb6', fg2: '#a89a84', link: '#e2a94f', rule: 'rgba(226,169,79,.3)' },
};

/** Page colours of fixed-layout pages (PDF, comics) per page theme, applied by page-theme.js: the light themes
 *  multiply the page with a paper colour a shade lighter than the reading area around it; the night theme maps
 *  white paper to `bg` and black ink to `fg` (sRGB 0–255). White shows the page as it is. */
export const PAGE_TINTS = {
  paper: [249, 243, 230],
  sepia: [241, 226, 196],
  night: { bg: [30, 26, 22], fg: [224, 214, 196] },
};

/** The page theme that goes with an appearance of the app (core/theme.js) while none was chosen in the reader. */
export const PAGE_THEME_FOR_UI = { light: 'paper', sepia: 'sepia', dark: 'night' };

// Reading fonts. `dir`: bundled in app/data/fonts (woff2, SIL OFL); EB Garamond comes with the vendored fonts; `system`:
// a font of the operating system (on Windows always there). `cw`: the average width of a character of running text
// in em, until it is measured (charWidth).
export const FONTS = {
  garamond: { label: 'EB Garamond', family: '"EB Garamond", "Palatino Linotype", "Book Antiqua", Georgia, serif', cw: 0.41 },
  literata: { label: 'Literata', family: '"Literata", Georgia, serif', name: 'Literata', dir: 'literata', cw: 0.52 },
  sourceserif: { label: 'Source Serif', family: '"Source Serif 4", Georgia, serif', name: 'Source Serif 4', dir: 'source-serif-4', cw: 0.49 },
  serif: { label: 'Palatino', family: '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, "Times New Roman", serif', system: 'Palatino Linotype', fallback: 'Serif', cw: 0.48 },
  atkinson: { label: 'Atkinson', title: 'Atkinson Hyperlegible Next', family: '"Atkinson Hyperlegible Next", "Segoe UI", system-ui, sans-serif', name: 'Atkinson Hyperlegible Next', dir: 'atkinson-hyperlegible-next', cw: 0.47 },
  sans: { label: 'Segoe UI', family: '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif', system: 'Segoe UI', fallback: 'Sans', cw: 0.48 },
};

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

const faceCache = new Map();
/** @font-face rules with absolute URLs (blob: section documents load the fonts from the app) for one reading font */
export function fontFaces(key = 'garamond') {
  if (faceCache.has(key)) return faceCache.get(key);
  const f = FONTS[key];
  const out = [];
  if (key === 'garamond') {
    const base = new URL('vendor/fonts/eb-garamond/files/', document.baseURI).href;
    const face = (weight, style, subset, range) => `@font-face { font-family: "EB Garamond"; font-style: ${style}; font-weight: ${weight}; font-display: swap; src: url("${base}eb-garamond-${subset}-${weight}-${style}.woff2") format("woff2"); unicode-range: ${range}; }`;
    for (const [w, s] of [[400, 'normal'], [400, 'italic'], [500, 'normal'], [600, 'normal'], [700, 'normal'], [700, 'italic']]) out.push(face(w, s, 'latin', LATIN), face(w, s, 'latin-ext', LATIN_EXT));
  } else if (f?.dir) {
    const base = new URL(`data/fonts/${f.dir}/`, document.baseURI).href;
    for (const [w, s] of [[400, 'normal'], [400, 'italic'], [700, 'normal'], [700, 'italic']]) {
      for (const [subset, range] of [['latin', LATIN], ['latin-ext', LATIN_EXT]]) {
        out.push(`@font-face { font-family: "${f.name}"; font-style: ${s}; font-weight: ${w}; font-display: swap; src: url("${base}${f.dir}-${subset}-${w}-${s}.woff2") format("woff2"); unicode-range: ${range}; }`);
      }
    }
  }
  const css = out.join('\n');
  faceCache.set(key, css);
  return css;
}

/** The bundled reading fonts in the app's own document as well (the Aa menu shows every font name in its face). */
export function ensureUiFonts() {
  if (document.getElementById('rd-reading-fonts')) return;
  const style = document.createElement('style');
  style.id = 'rd-reading-fonts';
  style.textContent = Object.keys(FONTS).filter((k) => FONTS[k].dir).map((k) => fontFaces(k)).join('\n');
  document.head.append(style);
}

const systemSeen = new Map();
/** Whether a system font is installed (its letters differ in width from a generic fallback). */
function systemFont(name) {
  if (systemSeen.has(name)) return systemSeen.get(name);
  let ok = true;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    const probe = 'mmmmmmmmmmlliWWQqg 0123456789';
    ok = ['monospace', 'serif', 'sans-serif'].some((generic) => {
      ctx.font = `72px ${generic}`; const a = ctx.measureText(probe).width;
      ctx.font = `72px "${name}", ${generic}`; const b = ctx.measureText(probe).width;
      return Math.abs(a - b) > 0.5;
    });
  } catch { ok = true; }
  systemSeen.set(name, ok);
  return ok;
}
/** The name shown in the Aa menu ("Palatino" where it is installed, else "Serif"). */
export const fontLabel = (key) => { const f = FONTS[key] || FONTS.garamond; return f.system && !systemFont(f.system) ? f.fallback : f.label; };

// running text, mostly German with some English: the width of a character, and how much of a line stays empty at its
// end because the next word does not fit (SLACK, measured on justified and hyphenated book text)
const SAMPLE = 'Im Sommer wird der Fluss zum Treffpunkt des ganzen Ortes. An den flachen Stellen baden die Kinder, auf den Wiesen liegen Decken, und am Abend riecht es nach Holzfeuer. Das Wasser ist dann warm genug, um eine Stunde darin zu schwimmen. The river wakes up slowly, and a thin mist hangs above the reeds.';
const SLACK = 1.045;
const widthCache = new Map();
/** Average width of a character of running text in `key`, in em (measured once the font is loaded). */
export function charWidth(key) {
  const f = FONTS[key] || FONTS.garamond;
  if (widthCache.has(key)) return widthCache.get(key);
  if (typeof document === 'undefined') return f.cw;   // the tests in Node
  // a bundled face must be known to the document first: else check() says "loaded" and the fallback is measured
  if (f.dir) ensureUiFonts();
  const face = f.name || (key === 'garamond' ? 'EB Garamond' : null);
  const loaded = !face || document.fonts?.check?.(`100px "${face}"`);
  if (loaded) {
    try {
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = `100px ${f.family}`;
      const w = (ctx.measureText(SAMPLE).width / SAMPLE.length / 100) * SLACK;
      if (w > 0.3 && w < 0.8) { widthCache.set(key, w); return w; }
    } catch { /* below */ }
  }
  return f.cw;
}
/** Loads a reading font in the app's document (for charWidth and the menu); resolves when it is there. */
export function loadFont(key) {
  const f = FONTS[key];
  const face = f?.name || (key === 'garamond' ? 'EB Garamond' : null);
  if (!face || !document.fonts?.load) return Promise.resolve();
  if (f?.dir) ensureUiFonts();
  return Promise.all([document.fonts.load(`400 100px "${face}"`), document.fonts.load(`italic 400 100px "${face}"`)]).then(() => { widthCache.delete(key); }).catch(() => {});
}

/**
 * The paginator's layout for a page width of `s.pageWidth` characters per line: the text of a column is that wide
 * (as far as the reading area allows), two columns stand side by side when both fit (Doppelseite).
 * foliate (paginator.js #beforeRender) makes a column `maxInline · (1 − n·a)` wide, a = gap / (1 − gap).
 * @returns {{ maxInline: number, columns: 1|2, gap: string, margin: string, text: number }}
 */
export function pageLayout(s, viewWidth, viewHeight) {
  const G = 0.06, a = G / (1 - G);
  const width = Math.max(PAGE_WIDTHS.min, Math.min(PAGE_WIDTHS.max, Number(s.pageWidth) || DEFAULTS.pageWidth));
  const text = width * charWidth(s.font) * (s.fontSize || DEFAULTS.fontSize);
  if (s.flow === 'scrolled') return { maxInline: Math.round(text), columns: 1, gap: '6%', margin: '48px', text };
  let columns = viewHeight > viewWidth ? 1 : Math.min(2, s.columns || 2);
  if (columns === 2 && (2 * text) / (1 - 2 * a) > viewWidth * (1 - G)) columns = 1;
  return { maxInline: Math.round(text / (1 - columns * a)), columns, gap: '6%', margin: '48px', text };
}

/** CSS of the pictures of the text view of a PDF (pdf-text-view.js) in a page colour: paper and sepia multiply,
 *  night inverts drawings and scans and dims photos and chess diagrams (filters inside each section document). */
export function figureCSS(theme) {
  // scanned pages first get a white point (#tv-f-<theme>-scan)
  if (theme === 'paper' || theme === 'sepia') return `.tv-fig img { filter: url(#tv-f-${theme}) !important; } .tv-fig.tv-page img { filter: url(#tv-f-${theme}-scan) !important; }`;
  if (theme === 'night') return '.tv-fig img { filter: url(#tv-f-night) !important; } .tv-fig.tv-page img { filter: url(#tv-f-night-scan) !important; } .tv-fig.tv-photo img, .tv-fig.tv-chess img { filter: url(#tv-f-dim) !important; }';
  return '.tv-fig img { filter: none !important; } .tv-fig.tv-page img { filter: url(#tv-f-white-scan) !important; }';
}


/** CSS pair [before, after] for the section documents */
export function bookCSS(s) {
  const t = THEMES[s.theme] || THEMES.paper;
  const key = FONTS[s.font] ? s.font : 'garamond';
  const font = FONTS[key].family;
  const before = `
    ${fontFaces(key)}
    @namespace epub "http://www.idpf.org/2007/ops";
    html { color-scheme: ${s.theme === 'night' ? 'dark' : 'light'}; }
  `;
  const after = `
    html, body { background: transparent !important; color: ${t.fg} !important; }
    html { font-size: ${s.fontSize}px !important; font-family: ${font} !important; }
    body { font-family: ${font} !important; }
    p, li, blockquote, dd, dt, div, td, th, span, em, strong, i, b, small, figcaption, h1, h2, h3, h4, h5, h6 { font-family: inherit !important; }
    pre, code, tt, kbd, samp { font-family: "Consolas", "Cascadia Mono", Menlo, monospace !important; }
    p, li, blockquote, dd {
      line-height: ${s.lineHeight};
      text-align: ${s.justify ? 'justify' : 'start'};
      -webkit-hyphens: ${s.hyphenate ? 'auto' : 'none'};
      hyphens: ${s.hyphenate ? 'auto' : 'none'};
      -webkit-hyphenate-limit-before: 3; -webkit-hyphenate-limit-after: 2; -webkit-hyphenate-limit-lines: 2;
      hanging-punctuation: allow-end last; widows: 2; orphans: 2;
    }
    [align="left"] { text-align: left; } [align="right"] { text-align: right; } [align="center"] { text-align: center; } [align="justify"] { text-align: justify; }
    h1, h2, h3, h4, h5, h6 { color: ${t.fg} !important; line-height: 1.2; }
    a:link, a:visited { color: ${t.link} !important; text-decoration-color: ${t.rule}; }
    hr { border-color: ${t.rule}; }
    img, svg, video { ${s.theme === 'night' ? 'filter: brightness(.82);' : ''} }
    pre { white-space: pre-wrap !important; }
    ::selection { background: rgba(226, 169, 79, .45); }
    aside[epub|type~="endnote"], aside[epub|type~="footnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
    foliate-mark { display: none; }
    ${figureCSS(s.theme)}
    p.tv-center { text-align: center !important; }
    aside.tv-notes { color: ${t.fg2} !important; }
  `;
  return [before, after];
}
