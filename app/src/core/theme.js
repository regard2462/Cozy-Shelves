// The appearance of the 2D interface: 'light' (Hell), 'sepia' (Sepia, the default) or 'dark' (Dunkel).
// app/theme-boot.js sets data-theme on <html> before the first paint; main.js calls applyTheme() whenever the
// settings change. The stylesheets react through the tokens in styles/ui.css, modules that draw with colours of
// their own (canvas games, the reader's first page theme, the reading browser) ask currentTheme() or listen.
import { bus } from './bus.js';

export const THEMES = ['light', 'sepia', 'dark'];
export const DEFAULT_THEME = 'sepia';

/** The theme stored in a settings object, always one of THEMES. */
export const themeOf = (settings) => (THEMES.includes(settings?.ui?.theme) ? settings.ui.theme : DEFAULT_THEME);

/** The theme that is shown right now. */
export function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return THEMES.includes(t) ? t : DEFAULT_THEME;
}
export const isDark = () => currentTheme() === 'dark';

/** Shows `theme` at once (no reload) and remembers it for the next start; 'ui:theme' goes out on a change. */
export function applyTheme(theme) {
  const t = THEMES.includes(theme) ? theme : DEFAULT_THEME;
  const root = document.documentElement;
  const changed = root.dataset.theme !== t;
  root.dataset.theme = t;
  try { localStorage.setItem('lesesaal.theme', t); } catch { /* private mode */ }
  if (changed) bus.emit('ui:theme', t);
  return t;
}

/** Calls fn(theme) after every change; returns the unsubscribe function. */
export const onTheme = (fn) => bus.on('ui:theme', fn);

/** Labels for the three choices (settings, computer). */
export const THEME_LABELS = {
  light: { de: 'Hell', en: 'Light' },
  sepia: { de: 'Sepia', en: 'Sepia' },
  dark: { de: 'Dunkel', en: 'Dark' },
};
