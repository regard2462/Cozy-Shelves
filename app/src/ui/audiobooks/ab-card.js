// The card on the right while an audiobook box in the hall is under the crosshair (hud.js #peek): the square cover with
// a line for how far the listener is, and with "Hinweise einblenden" its keys: E plays it (goes on, pauses it while it
// plays), F opens it in the panel. Built like the book card (.peek-card), so it sits in the same place.
import { h } from '../../core/dom.js';
import { tr } from '../../core/i18n.js';
import { audiobookPlayer } from './ab-player.js';
import { abStore, progressOf } from './ab-store.js';
import { coverUrl } from './ab-format.js';

/** What E does with this audiobook right now: 'pause', 'continue' or 'play'. */
export function audiobookVerb(b) {
  const s = audiobookPlayer.state;
  if (s.book?.id === b?.id && s.playing) return 'pause';
  return b?.progress && !b.progress.finished && (b.progress.position || 0) > 1 ? 'continue' : 'play';
}

/** { el, img, key } for the target of an audiobook box (world-actions.js: { type: 'audiobook', id, audiobook }). */
export function audiobookPeek(target, { hints = true } = {}) {
  const b = abStore.get(target.id) || target.audiobook || { id: target.id, title: '' };
  const verb = audiobookVerb(b);
  const img = h('img', { alt: '', src: coverUrl(b, 'large'), draggable: false });
  img.addEventListener('error', () => { img.src = coverUrl({ ...b, cover: null }, 'large'); }, { once: true });
  const cover = h('div.peek-cover.ab-peek-cover', img);
  cover.style.setProperty('--peek-ratio', '1');
  const p = progressOf(b);
  if (p > 0.005 && p < 1) cover.appendChild(h('div.peek-progress', h('i', { style: { width: Math.round(p * 100) + '%' } })));
  const word = { pause: tr({ de: 'Pause', en: 'Pause' }), continue: tr({ de: 'Weiterhören', en: 'Continue' }), play: tr({ de: 'Abspielen', en: 'Play' }) }[verb];
  const keys = hints ? h('div.peek-keys', h('span', h('kbd', 'E'), ' ' + word), h('span', h('kbd', 'F'), ' ' + tr({ de: 'Details', en: 'Details' }))) : null;
  const el = h('div.peek-card.ab-peek', { dataset: { id: b.id } }, cover, keys);
  return { el, img, key: `ab|${b.id}|${verb}|${hints}|${b.cover?.large || ''}|${Math.round(p * 100)}` };
}
