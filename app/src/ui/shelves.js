// The shelves between the library and the world (0.7): books read go to the case "Gelesen", a book that exists twice
// stands once, the books inside a shelf follow the chosen order (settings.shelves). This module notices when that changes
// (a book read, marked by hand, another copy read, a new order, metadata arriving) and lets the world rearrange its
// shelves, and handles C on a book: "Als gelesen markieren" / "Als ungelesen markieren". The reading goal and the streak
// are shown in the computer's statistics (ui/computer/sections/stats.js). main.js calls initShelves once the world is
// built.
import { tr } from '../core/i18n.js';
import { escapeHtml } from '../core/dom.js';
import { arrangeFor, shelfOptions } from '../world/layout.js';

let S = null;   // { world, hud, ctx }
const shorten = (s, n = 60) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

/** The arrangement the world shows now differs from the one its books and settings call for: rearrange (debounced). */
let checkTimer = null;
function scheduleCheck(ms = 350) {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(check, ms);
}
function check() {
  const w = S?.world;
  if (!w?.library || !w.layout) return;
  // behind the full-screen reader the world rests (a progress saved every few seconds would rebuild it again and again):
  // closing the book rebuilds the shelves anyway (main.js reader:closed → setRecent), with the arrangement of that moment
  if (w.background === 'paused') { scheduleCheck(2500); return; }
  const key = arrangeFor(w.library.departments, w.booksById || {}, S.ctx.state.settings?.shelves).key;
  if (key !== w.layout.arrangeKey) w.rearrangeShelves();
}

/**
 * "Als gelesen markieren" (read true) / "Als ungelesen markieren" (false), with a short note. The library tells the
 * world (library:book), which then moves the book (check above).
 */
export async function markRead(book, read) {
  if (!S || !book?.id) return null;
  const { api, toast, audio } = S.ctx;
  let updated = null;
  try { updated = await api.invoke('library:markRead', book.id, !!read); } catch (e) { console.warn('[shelves] markRead', e); }
  if (!updated) return null;
  const title = escapeHtml(shorten(book.title));
  const onCase = shelfOptions(S.ctx.state.settings?.shelves).finishedShelf;
  toast?.(read
    ? (onCase ? tr({ de: '„{t}“ steht jetzt im Regal „Gelesen“.', en: '“{t}” now stands on the “Read” shelf.' }, { t: title }) : tr({ de: '„{t}“ ist als gelesen markiert.', en: '“{t}” is marked as read.' }, { t: title }))
    : tr({ de: '„{t}“ ist wieder ungelesen.', en: '“{t}” is unread again.' }, { t: title }));
  audio?.sfx?.(read ? 'book-place' : 'click');
  return updated;
}

/** H in the world: the book under the crosshair (on a shelf or on the table at your seat) is read, or not any more. */
export function toggleReadAimed() {
  const t = S?.world?.actions.target;
  const id = t?.type === 'book' ? t.book?.id : t?.type === 'tablebook' ? t.id : null;
  if (!id) return false;
  const book = S.world.booksById?.[id] || t.book;
  if (!book) return false;
  markRead(book, !book.finished);
  return true;
}

/** Wire the shelves up (main.js, after the first build). */
export function initShelves({ world, hud, ctx }) {
  S = { world, hud, ctx };
  const { api } = ctx;
  const seen = new Map();   // id → what the shelves depend on of a book, as last seen
  const facts = (b) => `${b.finished ? 1 : 0}|${b.finishedAt || ''}|${b.dupGroup || ''}|${b.progress > 0.005 ? 1 : 0}`;
  for (const b of ctx.state.library?.books || []) seen.set(b.id, facts(b));
  // a book changed on its own (read, marked, metadata): the card on screen and maybe the shelves follow
  api.library.onBook((b) => {
    if (!b?.id) return;
    const before = seen.get(b.id), now = facts(b);
    seen.set(b.id, now);
    if (before !== now) hud?.refreshBook?.(b);
    scheduleCheck();
  });
  api.library.onUpdate(() => scheduleCheck(1200));
  let lastShelves = JSON.stringify(ctx.state.settings?.shelves || {});
  api.settings.onChange((s) => {
    const now = JSON.stringify(s?.shelves || {});
    if (now === lastShelves) return;
    lastShelves = now;
    // the world takes the new settings first (main.js onSettingsChanged → world.applySettings)
    scheduleCheck(60);
  });
  // the wheel (Tab) offers the case "Gelesen" next to "Zuletzt gelesen"
  ctx.world.readShelf = () => {
    const rd = world.layout?.bookcases?.find((b) => b.read);
    return rd ? { count: rd.rows.reduce((a, r) => a + r.items.length, 0) } : null;
  };
  // for the checks (build/scripts/shelves-*.js): the arrangement the world should show now
  if (window.__app) window.__app.shelves = { arrange: () => arrangeFor(world.library?.departments, world.booksById || {}, ctx.state.settings?.shelves), check };
  scheduleCheck(600);
}
