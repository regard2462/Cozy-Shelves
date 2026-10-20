// The typography of the reader's Aa menu: font (every name in its own face), font size and page width as sliders with a
// live preview, line height, justification, hyphenation, pages or scrolling, one or two columns, and for PDFs the switch
// of the text view (reader-textview.js). Used by reader-panel.js renderSettings().
import { h } from '../../core/dom.js';
import { FONTS, FONT_SIZES, PAGE_WIDTHS, DEFAULTS, fontLabel, ensureUiFonts } from './reader-styles.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** A switch row (a button, so that it is reached with Tab and toggled with Enter or Space). */
export function switchRow(label, on, onclick, hint = '') {
  return h('button.rd-toggle-row', { type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false', onclick },
    h('span.rd-toggle-label', label, hint ? h('span.rd-set-hint', ` ${hint}`) : null), h('span.toggle', { class: on ? 'on' : '' }));
}

/**
 * @param {object} R  the reader
 * @param {{ settings: object, set: (k, v) => void, live: (k, v) => void, group: Function, seg: Function }} o
 *   set: change, apply, save and draw the menu again; live: change and apply while a slider moves (no redraw)
 * @returns {HTMLElement[]}
 */
export function typographyGroups(R, { settings, set, live, group, seg }) {
  const { T } = R;
  ensureUiFonts();
  const fonts = h('div.rd-fonts', { role: 'radiogroup', 'aria-label': T('Schrift', 'Font') },
    Object.keys(FONTS).map((k) => h('button.rd-font', {
      type: 'button', role: 'radio', 'aria-checked': settings.font === k ? 'true' : 'false', class: settings.font === k ? 'active' : '',
      style: { fontFamily: FONTS[k].family }, title: FONTS[k].title || fontLabel(k), dataset: { font: k }, onclick: () => set('font', k),
    }, fontLabel(k))));

  const sizeVal = h('span.rd-set-value.rd-size-val', `${settings.fontSize} px`);
  const sizeRange = h('input.range.rd-range.rd-size-range', {
    type: 'range', min: FONT_SIZES.min, max: FONT_SIZES.max, step: 1, value: settings.fontSize, 'aria-label': T('Schriftgröße', 'Font size'),
    oninput: (e) => { const v = +e.target.value; sizeVal.textContent = `${v} px`; live('fontSize', v); },
  });
  const step = (d) => { const v = clamp((settings.fontSize || DEFAULTS.fontSize) + d, FONT_SIZES.min, FONT_SIZES.max); set('fontSize', v); };

  const widthVal = h('span.rd-set-value.rd-width-val', T('{n} Zeichen', '{n} characters', { n: settings.pageWidth }));
  const widthRange = h('input.range.rd-range.rd-width-range', {
    type: 'range', min: PAGE_WIDTHS.min, max: PAGE_WIDTHS.max, step: 1, value: settings.pageWidth, 'aria-label': T('Seitenbreite', 'Page width'),
    oninput: (e) => { const v = +e.target.value; widthVal.textContent = T('{n} Zeichen', '{n} characters', { n: v }); live('pageWidth', v); },
  });

  const lhVal = h('span.rd-set-value.rd-lh-val', Number(settings.lineHeight).toFixed(2));
  const lhRange = h('input.range.rd-range', {
    type: 'range', min: 1.2, max: 2.1, step: 0.05, value: settings.lineHeight, 'aria-label': T('Zeilenabstand', 'Line height'),
    oninput: (e) => { const v = parseFloat(e.target.value); lhVal.textContent = v.toFixed(2); live('lineHeight', v); },
  });

  return [
    group(T('Schrift', 'Font'), fonts),
    group(T('Schriftgröße', 'Font size'),
      h('button.rd-seg.rd-step', { type: 'button', title: T('Kleiner (Strg −)', 'Smaller (Ctrl −)'), 'aria-label': T('Kleiner', 'Smaller'), onclick: () => step(-1) }, '−'),
      sizeRange,
      h('button.rd-seg.rd-step', { type: 'button', title: T('Größer (Strg +)', 'Larger (Ctrl +)'), 'aria-label': T('Größer', 'Larger'), onclick: () => step(1) }, '+'),
      sizeVal),
    group(T('Seitenbreite', 'Page width'), widthRange, widthVal),
    group(T('Zeilenabstand', 'Line height'), lhRange, lhVal),
    h('div.rd-set-group',
      switchRow(T('Blocksatz', 'Justify'), settings.justify, () => set('justify', !settings.justify)),
      switchRow(T('Silbentrennung', 'Hyphenation'), settings.hyphenate, () => set('hyphenate', !settings.hyphenate))),
    group(T('Anzeige', 'Layout'), seg('flow', [['paginated', T('Seiten', 'Pages')], ['scrolled', T('Fließend', 'Scrolled')]])),
    ...(settings.flow === 'paginated' ? [group(T('Spalten', 'Columns'), seg('columns', [[1, T('Eine Seite', 'One page')], [2, T('Doppelseite', 'Two pages')]]))] : []),
  ];
}

/** The switch of the text view for a PDF, with a line that says what it does. */
export function textViewGroup(R, on, onToggle) {
  const { T } = R;
  return h('div.rd-set-group.rd-tv-group',
    switchRow(T('Textansicht', 'Text view'), on, onToggle, '(X)'),
    h('div.rd-set-note', on
      ? T('Der Text des PDFs fließt in Schrift, Größe und Breite nach Wahl. Bilder und Diagramme stehen an ihrer Stelle.', 'The text of the PDF flows in the font, size and width you choose. Pictures and diagrams stay in place.')
      : T('Zeigt den Text des PDFs als Fließtext, mit Schrift, Schriftgröße und Seitenbreite nach Wahl.', 'Shows the text of the PDF as flowing text, with the font, font size and page width you choose.')));
}
