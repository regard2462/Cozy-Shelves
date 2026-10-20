// Audiobooks in the app (main.js): the player gets the app's context (the music pauses for it), the cabinet in the hall
// gets the newest audiobooks, and what happens in the world comes here: E on a box plays it or pauses it, F opens it in
// the panel, the cabinet and the card "Alle Hörbücher" open the panel.
import { tr } from '../../core/i18n.js';
import { escapeHtml } from '../../core/dom.js';
import { abStore, recentOrder } from './ab-store.js';
import { audiobookPlayer } from './ab-player.js';
import { errorText } from './ab-format.js';
import { AB_CAPACITY } from '../../world/audiobook-shelf.js';

const shorten = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

export function initAudiobooks(ctx, world, hud) {
  audiobookPlayer.attach(ctx);
  // the cabinet: the newest audiobooks first; the order is taken when the list changes (a scan), not while listening,
  // so that a box never moves away from the hand that just took it
  const feed = () => {
    const books = abStore.books;
    const list = recentOrder(books).slice(0, AB_CAPACITY).map((b) => ({ id: b.id, title: b.title, author: b.author, cover: b.cover?.thumb || null, color: b.cover?.color || null }));
    world?.audiobooks?.setBooks(list, books.length);
  };
  abStore.onChange(({ reason } = {}) => { if (reason === 'update' || reason === 'load') feed(); });
  abStore.start().then(feed);
  // the card of an aimed box says what E does: it follows the player
  let lastKey = '';
  audiobookPlayer.onChange((s) => {
    const key = (s.book?.id || '') + '|' + s.playing;
    if (key === lastKey) return;
    lastKey = key;
    if (hud?.target?.type === 'audiobook') hud.setTarget(hud.target);
  });
}

/** The world's actions (main.js onInteract): 'audiobooks' (the cabinet, its card) or 'audiobook' ({ id, key }). */
export function audiobookAction(kind, payload = {}, ctx) {
  if (kind === 'audiobooks') { ctx.openPanel('audiobooks', {}); return; }
  const id = payload?.id;
  if (!id) return;
  if (payload.key === 'F') { ctx.openPanel('audiobooks', { id }); return; }
  const player = audiobookPlayer;
  if (player.current?.id === id) { player.toggle(); return; }
  player.open(id).then((ok) => {
    if (!ok) { ctx.toast?.(errorText('missing')); return; }
    const b = abStore.get(id);
    ctx.toast?.(tr({ de: '„{t}“ läuft. <kbd>K</kbd> hält an, <kbd>O</kbd> öffnet den Player.', en: '“{t}” is playing. <kbd>K</kbd> pauses, <kbd>O</kbd> opens the player.' }, { t: escapeHtml(shorten(b?.title || '', 60)) }));
  });
}
