// Finished books, the reading goal and the streak, the pure part: the rules for when a book counts as read, the days in a
// row with reading and the books read in a year. library.js keeps the records (finishedAt, readMark) and the reading time
// per day (stats.json: days[YYYY-MM-DD] = { seconds, books }); the renderer uses the same rules for the "Gelesen" case
// (app/src/world/shelf-arrange.js). No Electron, no Node APIs: the unit tests (test-shelves.js) call everything directly.
'use strict';

/** From this progress on a book counts as read (the last pages of a book are often notes, an index or adverts). */
const FINISHED_AT = 0.97;
/** A day counts for the streak from this much reading on. */
const STREAK_SECONDS = 300;

const pad = (n) => String(n).padStart(2, '0');
/** The local calendar day of a time ('2026-01-31'), never the UTC one. */
function localDay(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Is the book read? Marked as read by hand, or read up to 97 % once (finishedAt stays when the reader later goes back to
 * the start). "Als ungelesen markieren" (readMark false) wins over both until the book is read to the end again.
 */
function isFinished(b) {
  if (!b || b.readMark === false) return false;
  return !!b.finishedAt || (Number(b.progress) || 0) >= FINISHED_AT;
}

/**
 * The reader saved a new position: a book that crosses 97 % from below is read from now on (an old "unread" mark is
 * dropped: it was read to the end once more). `before` is the progress before the change.
 * @returns true when the book just became read
 */
function noteProgress(b, before, now = Date.now()) {
  const after = Number(b?.progress) || 0;
  if (!b || after < FINISHED_AT || (Number(before) || 0) >= FINISHED_AT) return false;
  const was = b.readMark !== false && !!b.finishedAt;   // read already (by hand) before this position
  if (b.readMark === false) delete b.readMark;
  if (!b.finishedAt) b.finishedAt = now;
  return !was;
}

/**
 * "Als gelesen markieren" (read = true) and "Als ungelesen markieren" (false). A book marked as read keeps the day it was
 * read first; one marked as unread forgets it, and a progress of 97 % or more no longer counts (readMark false) until
 * the book is read to the end again.
 * @returns true when the state changed
 */
function setReadMark(b, read, now = Date.now()) {
  if (!b) return false;
  const was = isFinished(b);
  if (read) {
    delete b.readMark;
    if (!b.finishedAt) b.finishedAt = now;
  } else {
    delete b.finishedAt;
    if ((Number(b.progress) || 0) >= FINISHED_AT) b.readMark = false; else delete b.readMark;
  }
  return was !== isFinished(b);
}

/**
 * Records from before finishedAt existed: a book read to 97 % or more gets the day it was last read (or added) as the day
 * it was finished, so that it stands in the right place on the "Gelesen" case and counts for its year.
 * @returns true when the record changed
 */
function migrateFinished(b) {
  if (!b || b.finishedAt || b.readMark === false || !((Number(b.progress) || 0) >= FINISHED_AT)) return false;
  b.finishedAt = b.lastRead || b.addedAt || Date.now();
  return true;
}

/**
 * Days in a row with at least `min` seconds of reading, up to today. A day that has not reached it yet does not break
 * the streak: until midnight it still counts from yesterday. `days` maps local days ('2026-01-31') to { seconds }.
 * Steps go from local noon to local noon, so a day of 23 or 25 hours (daylight saving) is still one day.
 * @returns { streak, today: true when today counts already, todaySeconds }
 */
function streakOf(days, now = new Date(), min = STREAK_SECONDS) {
  const d = new Date(now instanceof Date ? now.getTime() : now);
  d.setHours(12, 0, 0, 0);
  const secondsOn = (x) => Number(days?.[localDay(x)]?.seconds) || 0;
  const todaySeconds = secondsOn(d);
  const today = todaySeconds >= min;
  if (!today) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (secondsOn(d) >= min && streak < 36500) { streak++; d.setDate(d.getDate() - 1); }
  return { streak, today, todaySeconds };
}

/** The local year of a time. */
const yearOf = (ms) => new Date(ms).getFullYear();

/**
 * The books read in `year` (local time): every book whose finishedAt lies in it, a book that exists twice (duplicates.js
 * groups) once. `groupOf(id)` gives the group of a copy (null: no other copy).
 * @returns { year, count, ids (newest first) }
 */
function booksReadIn(books, year, groupOf = () => null) {
  const all = (books || []).filter((b) => b && isFinished(b) && b.finishedAt && yearOf(b.finishedAt) === year)
    .sort((a, b) => b.finishedAt - a.finishedAt || String(a.id).localeCompare(String(b.id)));
  // of two copies the one finished last stands for the book
  const seen = new Set();
  const list = all.filter((b) => { const key = groupOf(b.id) || b.id; if (seen.has(key)) return false; seen.add(key); return true; });
  return { year, count: list.length, ids: list.map((b) => b.id) };
}

/** The reading goal from the settings: a whole number of books a year, 0 = no goal. */
function readingGoal(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : 0;
}

module.exports = { FINISHED_AT, STREAK_SECONDS, localDay, isFinished, noteProgress, setReadMark, migrateFinished, streakOf, yearOf, booksReadIn, readingGoal };
