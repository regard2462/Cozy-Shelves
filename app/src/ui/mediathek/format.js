// Small formatting helpers of the Mediathek panel: dates, durations, sizes, channel names and colours.
import { tr, i18n } from '../../core/i18n.js';

const T = (de, en, vars) => tr({ de, en }, vars);
const locale = () => (i18n.lang === 'en' ? 'en-GB' : 'de-DE');

/** Channel metadata; filled from 'mediathek:channels', with sensible defaults before that. */
const channelInfo = new Map();
export function setChannels(list) { for (const c of list || []) channelInfo.set(c.id, c); }
export const channelOf = (id) => channelInfo.get(id) || { id, name: id || '', color: '#5a6b78', group: 'intl' };
export const channelName = (id) => channelOf(id).name || id || '';
/** The long name of a channel ("Westdeutscher Rundfunk"; some English-language sources name it in both languages). */
export const channelLong = (c) => (c && c.long ? (typeof c.long === 'object' ? tr(c.long) : c.long) : (c && c.name) || '');
/** English-language channels (group 'en') and whether a channel belongs to them. */
export const isEnglish = (c) => !!c && (c.lang === 'en' || c.group === 'en');
export const channelColor = (id) => channelOf(id).color || '#5a6b78';

/** "Heute, 20:00" · "Gestern, 17:00" · "Mo., 21.09., 20:15" · "21.09.2025" */
export function formatWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return T('Heute, {t}', 'Today, {t}', { t: time });
  if (diff === 1) return T('Gestern, {t}', 'Yesterday, {t}', { t: time });
  if (diff > 1 && diff < 7) return d.toLocaleDateString(locale(), { weekday: 'short', day: '2-digit', month: '2-digit' }) + ', ' + time;
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
  return d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export const formatDate = (ts) => (ts ? new Date(ts).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) : '');
export const formatClock = (ts) => (ts ? new Date(ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '');

/** 95 → "2 Min.", 5280 → "1 Std. 28 Min." */
export function formatDuration(sec) {
  const s = Math.round(Number(sec) || 0);
  if (!s) return '';
  if (s < 60) return T('{n} Sek.', '{n} sec', { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return T('{n} Min.', '{n} min', { n: m });
  const hh = Math.floor(m / 60), mm = m % 60;
  return mm ? T('{h} Std. {m} Min.', '{h} h {m} min', { h: hh, m: mm }) : T('{h} Std.', '{h} h', { h: hh });
}

export function formatBytes(n) {
  if (!n || !isFinite(n)) return '';
  const fmt = (x, d) => x.toLocaleString(locale(), { maximumFractionDigits: d, minimumFractionDigits: d });
  if (n >= 1e9) return fmt(n / 1e9, 1) + ' GB';
  if (n >= 1e6) return fmt(n / 1e6, n >= 1e8 ? 0 : 1) + ' MB';
  return fmt(Math.max(1, n / 1e3), 0) + ' kB';
}
export const formatSpeed = (bps) => (bps > 0 ? formatBytes(bps) + '/s' : '');

export const QUALITY_NAMES = { low: () => T('Niedrig', 'Low'), sd: () => T('Mittel', 'Medium'), hd: () => T('Hoch (HD)', 'High (HD)'), auto: () => T('Automatisch', 'Automatic') };
/** The same on the player's small quality button ("Auto · HD" while 'auto' plays HD). */
export const QUALITY_SHORT = { low: () => T('Niedrig', 'Low'), sd: () => T('Mittel', 'Medium'), hd: () => 'HD', auto: () => 'Auto' };
/** A quality as people say it: its picture size ("720p") when known, else the old name of the key (0.7). */
export const qualityName = (key, height) => (height ? `${Math.round(height)}p` : QUALITY_NAMES[key] ? QUALITY_NAMES[key]() : /^h(\d{3,4})$/.test(key || '') ? key.slice(1) + 'p' : String(key || ''));
export const VARIANT_NAMES = { ad: () => T('Audiodeskription', 'Audio description'), dgs: () => T('Gebärdensprache', 'Sign language'), ks: () => T('Klare Sprache', 'Plain language'), ut: () => T('Mit Untertiteln', 'With subtitles'), ov: () => T('Originalversion', 'Original version') };
export const GEO_NOTE = { de: () => T('Nur in Deutschland abrufbar', 'Available in Germany only'), at: () => T('Nur in Österreich abrufbar', 'Available in Austria only'), dach: () => T('Nur in Deutschland, Österreich und der Schweiz abrufbar', 'Available in Germany, Austria and Switzerland only') };

/** The title as cards and the film view show it: an original version names itself in its badge, so the suffix of
 *  MediathekViewWeb ("(Originalversion mit Untertitel)", also on arte's English programmes) goes. */
export const titleOf = (item) => (item && item.variant === 'ov' ? String(item.title || '').replace(/\s*\((?:Originalversion|OV|OmU)\b[^()]*\)\s*$/i, '').trim() || item.title : (item && item.title) || '');

/** Two or three letters for a typographic card when a channel has no wordmark ("Radio Bremen" → "RB"). */
export function initials(name) {
  const n = String(name || '').trim();
  if (n.length <= 6) return n;
  return n.split(/[\s-]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
}
export const errText = (e) => String((e && e.message) || e || '').replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '') || T('Unbekannter Fehler', 'Unknown error');
