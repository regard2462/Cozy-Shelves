// Tiny i18n: t('key', {vars}) with German (default) and English dictionaries.
import de from '../i18n/de.js';
import en from '../i18n/en.js';
import { bus } from './bus.js';

const dicts = { de, en };
let lang = 'de';

export function setLanguage(l) { lang = dicts[l] ? l : 'de'; document.documentElement.lang = lang; bus.emit('i18n:change', lang); }
export function getLanguage() { return lang; }
// One pass with a function replacer: a string replacement reads "$&", "$'" and "$$" as patterns, so a book title with
// a dollar sign in it came out garbled ("Rock $& Roll" repeated the placeholder and the rest of the sentence), and a
// value is never read as a placeholder itself. A brace that names no value stays as it is.
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
export function t(key, vars) {
  const s = dicts[lang][key] ?? dicts.de[key] ?? key;
  return vars ? fill(s, vars) : s;
}
export const i18n = { t, setLanguage, getLanguage, get lang() { return lang; }, onChange: (fn) => bus.on('i18n:change', fn) };

/** Inline translation helper for modules: tr({ de: 'Hallo', en: 'Hello' }) */
export function tr(obj, vars) {
  const s = obj[lang] ?? obj.de ?? obj.en ?? '';
  return vars ? fill(s, vars) : s;
}
i18n.tr = tr;
