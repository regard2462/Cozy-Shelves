// Words and numbers of the audiobooks, in German and English: times, speeds, chapter names, errors, the cover of an
// audiobook without a picture (a square title card like the books' ones, world/book-art.js).
import { tr, i18n } from '../../core/i18n.js';
import { drawTypoCover } from '../../world/book-art.js';

/** 3725 → "1:02:05", 65 → "1:05". */
export function clock(sec) {
  const s = Math.max(0, Math.floor(sec || 0)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
}
/** A length in words: "3 Std. 12 Min." / "3 h 12 min", under an hour "47 Min." / "47 min". */
export function length(sec) {
  const m = Math.round((sec || 0) / 60), h = Math.floor(m / 60), r = m % 60;
  if (!h) return tr({ de: '{m} Min.', en: '{m} min' }, { m: Math.max(r, sec > 0 ? 1 : 0) });
  return r ? tr({ de: '{h} Std. {m} Min.', en: '{h} h {m} min' }, { h, m: r }) : tr({ de: '{h} Std.', en: '{h} h' }, { h });
}
/** "noch 2 Std. 3 Min." / "2 h 3 min left". */
export const remaining = (sec) => tr({ de: 'noch {t}', en: '{t} left' }, { t: length(sec) });
/** 1.25 → "1,25×" (German decimal comma), "1.25×". */
export const rateLabel = (r) => (Math.round((r || 1) * 100) / 100).toString().replace('.', i18n.lang === 'de' ? ',' : '.') + '×';
/** The name of a chapter, "Kapitel 3" when it has none. */
export const chapterName = (c, i) => c?.title || tr({ de: 'Kapitel {n}', en: 'Chapter {n}' }, { n: i + 1 });
/** A player error in words. */
export function errorText(kind) {
  if (!kind) return null;
  return {
    missing: tr({ de: 'Dieses Hörbuch ist nicht mehr da, oder sein Laufwerk ist gerade nicht angeschlossen.', en: 'This audiobook is no longer there, or its drive is not connected.' }),
    network: tr({ de: 'Die Datei konnte nicht gelesen werden.', en: 'The file could not be read.' }),
    decode: tr({ de: 'Die Datei ist beschädigt.', en: 'The file is damaged.' }),
    format: tr({ de: 'Diese Datei kann nicht abgespielt werden.', en: 'This file cannot be played.' }),
    aborted: tr({ de: 'Die Wiedergabe wurde abgebrochen.', en: 'Playback was interrupted.' }),
  }[kind] || tr({ de: 'Die Wiedergabe startet nicht.', en: 'Playback does not start.' });
}
/** "Erika Muster" or "Erika Muster · gelesen von Max Sprecher". */
export function byLine(b, { narrator = true } = {}) {
  const parts = [];
  if (b?.author) parts.push(b.author);
  if (narrator && b?.narrator && b.narrator !== b.author) parts.push(tr({ de: 'gelesen von {n}', en: 'read by {n}' }, { n: b.narrator }));
  return parts.join(' · ');
}
/** "Die Reihe vom Wald · Band 2". */
export function seriesLine(b) {
  if (!b?.series) return '';
  return b.seriesIndex != null ? tr({ de: '{s} · Band {n}', en: '{s} · Book {n}' }, { s: b.series, n: String(b.seriesIndex).replace('.', i18n.lang === 'de' ? ',' : '.') }) : b.series;
}
/** The text of a sleep timer that runs: "Schlaftimer 12:30" or "bis Kapitelende". */
export function sleepText(sl) {
  if (!sl) return '';
  if (sl.mode === 'chapter') return tr({ de: 'bis Kapitelende', en: 'until the chapter ends' });
  return clock(sl.left);
}

const typoCache = new Map();
/** The square title card of an audiobook without a picture (data URL, drawn once per title). */
export function typoCover(b, size = 360) {
  const key = `${b.id}|${b.title}|${b.author}|${size}`;
  let url = typoCache.get(key);
  if (url) return url;
  const c = document.createElement('canvas'); c.width = c.height = size;
  drawTypoCover(c.getContext('2d'), { id: 'ab:' + b.id, title: b.title || '', author: b.author || '' }, size, size);
  url = c.toDataURL('image/jpeg', 0.9);
  if (typoCache.size > 200) typoCache.delete(typoCache.keys().next().value);
  typoCache.set(key, url);
  return url;
}
/** The picture of an audiobook: its cover in the size asked for ('thumb' 320 px, 'large' 960 px), else the title card. */
export const coverUrl = (b, size = 'thumb') => (b?.cover ? (size === 'large' ? b.cover.large : b.cover.thumb) || b.cover.thumb : typoCover(b, size === 'large' ? 720 : 360));
