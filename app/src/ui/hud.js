// Heads-up display: crosshair, the book cover right of the crosshair, the label below the crosshair, basket strip,
// status chips, click-to-look overlay.
// A book under the crosshair shows its cover right of the middle (no title: it is on the cover) with its keys below
// when "Hinweise einblenden" is on. Everything else gets a small label below the crosshair: its name and, with the
// hints on, the key that uses it. The crosshair opens into a small ring when the thing is in reach.
import { h, clear } from '../core/dom.js';
import { t, tr } from '../core/i18n.js';
import { coverSrc, typoCoverUrl } from '../core/cover-art.js';
import { drawTypoCover, hasCoverImage, fontsLoaded, whenFontsLoaded } from '../world/book-art.js';
import { audiobookPeek } from './audiobooks/ab-card.js';
import { readKeyHint, readBadge } from './shelf-info.js';
// with a gamepad as the input used last, the hints show its buttons (input/pad-hints.js)
import { hintText, padState, touchState, useGlyph } from '../input/pad-hints.js';
import { fireBowlLit } from '../world/firebowl.js';
import { has, isAndroid, touch } from '../core/platform.js';

// on a phone or a tablet (the Android app, a touch screen in the browser) the name below the crosshair stays away:
// it covered the middle of the small screen; the ring still shows that the thing can be used
const NO_LOOK_LABEL = isAndroid || touch;

/** The label below the crosshair: [name, what E does] for each kind of target (world-actions.js). Books have none. */
const LOOK = {
  computer: [{ de: 'Computer', en: 'Computer' }, { de: 'Benutzen', en: 'Use' }],
  records: [{ de: 'Plattenspieler', en: 'Record player' }, { de: 'Musik wählen', en: 'Choose music' }],
  podcasts: [{ de: 'Radio', en: 'Radio' }, { de: 'Podcasts hören', en: 'Listen to podcasts' }],
  catalog: [{ de: 'Fernleihe', en: 'Interlibrary loan' }, { de: 'Bücher suchen', en: 'Find books' }],
  news: [{ de: 'Zeitungsständer', en: 'Newspaper rack' }, { de: 'Zeitung lesen', en: 'Read the papers' }],
  chess: [{ de: 'Schachbrett', en: 'Chessboard' }, { de: 'Schach spielen', en: 'Play chess' }],
  wiki: [{ de: 'Lexikon', en: 'Encyclopedia' }, { de: 'Nachschlagen', en: 'Look things up' }],
  browser: [{ de: 'Lesegerät', en: 'E-reader' }, { de: 'Lesebrowser öffnen', en: 'Open the reading browser' }],
  watercolor: [{ de: 'Staffelei', en: 'Easel' }, { de: 'Malen', en: 'Paint' }],
  worldmap: [{ de: 'Weltkarte', en: 'World map' }, { de: 'Öffnen', en: 'Open' }],
  mediathek: [{ de: 'Beamer', en: 'Projector' }, { de: 'Mediathek öffnen', en: 'Open the Mediathek' }],
  cat: [{ de: 'Katze', en: 'Cat' }, { de: 'Streicheln', en: 'Stroke' }],
  painting: [{ de: 'Bild', en: 'Picture' }, { de: 'Bild wechseln', en: 'Change the picture' }],
  audiobooks: [{ de: 'Hörbücher', en: 'Audiobooks' }, { de: 'Öffnen', en: 'Open' }],
};
const SEATS = { armchair: { de: 'Sessel', en: 'Armchair' }, sofa: { de: 'Sofa', en: 'Sofa' }, chair: { de: 'Stuhl', en: 'Chair' }, windowseat: { de: 'Fensterbank', en: 'Window seat' }, lounger: { de: 'Liegestuhl', en: 'Lounger' } };
const SIT = { de: 'Hinsetzen', en: 'Sit down' };
// the seats outside: the benches by the lake and on the hill, the stumps round the fire bowl
Object.assign(SEATS, { bench: { de: 'Bank', en: 'Bench' }, stump: { de: 'Baumstumpf', en: 'Tree stump' } });
const FIRE_BOWL = { de: 'Feuerschale', en: 'Fire bowl' };
const RETURN = { de: 'Rückgabe', en: 'Return desk' };
const SCREEN = { de: 'Leinwand', en: 'Screen' };
const USE = { de: 'Benutzen', en: 'Use' };
// the browser version: a thing of the desktop app (newspaper rack, radio, projector, e-reader …) says so
const DESKTOP_ONLY = { de: 'Nur in der Desktop-App', en: 'Desktop app only' };
/** Lamps (world/lamp-switch.js): the name by the builder's kind, and what E does, which depends on the lamp. */
const LAMPS = {
  pendant: { de: 'Hängelampe', en: 'Pendant lamp' }, desklamp: { de: 'Leselampe', en: 'Reading lamp' }, bankerlamp: { de: 'Bankerlampe', en: 'Banker’s lamp' },
  floorlamp: { de: 'Stehlampe', en: 'Floor lamp' }, tablelamp: { de: 'Tischlampe', en: 'Table lamp' }, sconce: { de: 'Wandleuchte', en: 'Wall light' },
  chandelier: { de: 'Kronleuchter', en: 'Chandelier' }, lamp: { de: 'Lampe', en: 'Lamp' },
};
const LIGHT_OFF = { de: 'Licht aus', en: 'Light off' }, LIGHT_ON = { de: 'Licht an', en: 'Light on' };

export class Hud {
  constructor(root, ctx) {
    this.root = root; this.ctx = ctx;
    this.target = null; this.seated = false; this.panelOpen = false; this.scan = null; this.basket = [];
    this.crosshair = h('div#crosshair'); root.appendChild(this.crosshair);
    // the label below the crosshair (not for books)
    this.labelName = h('span.ll-name'); this.labelWhat = h('span.ll-what');
    this.labelKbd = h('kbd', 'E');
    this.labelKeys = h('span.ll-keys', this.labelKbd, this.labelWhat);
    this.label = h('div#look-label', { 'aria-hidden': 'true' }, this.labelName, this.labelKeys); root.appendChild(this.label);
    this.bottom = h('div#hud-bottom'); root.appendChild(this.bottom);
    this.basketEl = h('div#basket-hud', { onclick: () => ctx.openPanel('basket', {}) }); this.bottom.appendChild(this.basketEl);
    this.seatChip = h('div.hud-chip.hidden', { html: hintText('hint.stand') }); this.bottom.appendChild(this.seatChip);
    this.topRight = h('div#hud-top-right'); root.appendChild(this.topRight);
    this.scanEl = h('div#scan-status'); root.appendChild(this.scanEl);
    this.clickHint = h('div#pointer-hint', t('hud.click')); root.appendChild(this.clickHint);
    this.clickHint.addEventListener('click', () => ctx.state.player?.lock());
    // a running podcast shows in the mini player bottom right (ui/media-bar.js), with its controls
    this.timeEl = h('div.hud-chip'); this.topRight.appendChild(this.timeEl);
    this.depEl = h('div.hud-chip.dep.hidden', { onclick: () => ctx.openWheel?.() }); this.topRight.appendChild(this.depEl);
    // the book card that appears on the right while you look at a book
    this.peek = h('div#book-peek'); root.appendChild(this.peek);
    // lay a card out once while it is still invisible, so that the first real one does not pay for its first style
    // and layout pass
    requestAnimationFrame(() => {
      const warm = h('div.peek-card', h('div.peek-cover'), h('div.peek-keys', { html: t('peek.keys') }));
      this.peek.appendChild(warm); void warm.offsetWidth;
      requestAnimationFrame(() => { if (warm.parentNode === this.peek) warm.remove(); });
    });
    // the label on the screen says whether E pauses or plays the film
    this.offMedia = ctx.bus?.on?.('media:change', () => { if (this.target?.kind === 'screen' && this.label.classList.contains('show')) this.#label(this.target, true); });
    // the keyboard and mouse or the gamepad took over: every hint in the other set of keys
    this.offDevice = ctx.bus?.on?.('input:device', () => this.refresh());
    this.offPad = ctx.bus?.on?.('pad:connection', () => { if (padState.active) this.refresh(); });
    this.timer = setInterval(() => this.tick(), 10000); this.tick();
  }
  destroy() { clearInterval(this.timer); this.offMedia?.(); this.offDevice?.(); this.offPad?.(); }

  /** The chip shows the world's own clock, not the system clock (fixed hour / day cycle). */
  tick() {
    const s = this.ctx.state.settings || {};
    const hour = this.ctx.worldHour ? this.ctx.worldHour() : null;
    let hh, mm;
    if (hour == null || !isFinite(hour)) { const d = new Date(); hh = d.getHours(); mm = d.getMinutes(); }
    else { hh = Math.floor(hour) % 24; mm = Math.floor((hour % 1) * 60); }
    // the weather now (a changing weather changes by itself: ctx.world.weatherState)
    const wl = { clear: '☀', overcast: '☁', rain: '🌧', storm: '⛈', snow: '❄', fog: '🌫' }[this.ctx.world?.weatherState?.()?.name || s.weather || 'clear'];
    this.timeEl.textContent = `${wl}  ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  setDepartment(name) {
    this.department = name;
    this.depEl.textContent = name ? '📚 ' + name : '';
    this.depEl.title = t('wheel.hint');
    this.depEl.classList.toggle('hidden', !name);
  }

  /** What the crosshair rests on (world-actions.js): the ring, a book's cover card or the label of anything else. */
  setTarget(target) {
    this.target = target;
    // a seat counts once it is close enough to sit down (target.near, world-actions.js SEAT_REACH)
    const reach = !this.panelOpen && !!target && (target.type !== 'seat' || !!target.near);
    this.crosshair.classList.toggle('active', reach);
    this.#label(target, reach);
    // over a running film the ring and the label would sit in the middle of the picture: only briefly
    clearTimeout(this.ringTimer);
    if (reach && target.type === 'interact' && target.kind === 'screen') this.ringTimer = setTimeout(() => { if (this.target === target) { this.crosshair.classList.remove('active'); this.label.classList.remove('show'); } }, 3000);
    this.#peek(!this.panelOpen && (target?.type === 'book' || target?.type === 'tablebook' || target?.type === 'audiobook') ? target : null);
  }

  /** [name, what E does] for a target; null for books (their cover card speaks for them) and for nothing. */
  #lookText(target) {
    if (!target || target.type === 'book' || target.type === 'tablebook') return null;
    if (target.type === 'seat') return [SEATS[target.seat?.kind] || SEATS.chair, SIT];
    if (target.type === 'painting') return LOOK.painting;
    // a lamp: E switches it off when it is on and on when it is off
    if (target.type === 'lamp') return [LAMPS[target.lampKind] || LAMPS.lamp, target.on ? LIGHT_OFF : LIGHT_ON];
    if (target.type !== 'interact') return null;
    if (target.kind === 'return') return [RETURN, this.basket.length ? { de: 'Alle Bücher abgeben', en: 'Return all books' } : { de: 'Korb öffnen', en: 'Open the basket' }];
    if (target.kind === 'screen') return [SCREEN, !has('mediathek') ? DESKTOP_ONLY : this.ctx.media?.state?.playing ? { de: 'Anhalten', en: 'Pause' } : { de: 'Weiter', en: 'Play' }];
    if (target.kind === 'firebowl') return [FIRE_BOWL, fireBowlLit() ? { de: 'Feuer löschen', en: 'Put out the fire' } : { de: 'Feuer anzünden', en: 'Light the fire' }];
    if (LOOK[target.kind]) return has(target.kind) ? LOOK[target.kind] : [LOOK[target.kind][0], DESKTOP_ONLY];
    // anything newer than this table: its own label from the layout
    const own = target.label ? (typeof target.label === 'string' ? target.label : tr(target.label)) : '';
    return own ? [own, USE] : null;
  }
  /** The label below the crosshair: the name, and the key while "Hinweise einblenden" is on. Only text changes,
   *  the label is positioned on its own, so nothing else moves. */
  #label(target, reach) {
    // E, the pad's A, or the use button of the touch screen
    const dev = padState.active ? 'pad:' + padState.family : touchState.active ? 'touch' : 'keys';
    if (this.labelDev !== dev) {
      this.labelDev = dev;
      const k = padState.active || touchState.active ? h('span', { html: useGlyph() }).firstElementChild : h('kbd', 'E');
      this.labelKbd.replaceWith(k); this.labelKbd = k;
    }
    const text = reach && !this.panelOpen && !NO_LOOK_LABEL ? this.#lookText(target) : null;
    if (!text) { this.label.classList.remove('show'); return; }
    const hints = this.ctx.state.settings?.hints !== false;
    const name = typeof text[0] === 'string' ? text[0] : tr(text[0]);
    const what = hints ? tr(text[1]) : '';
    const key = name + '|' + what + '|' + dev;
    if (this.labelKey !== key) {
      this.labelKey = key;
      this.labelName.textContent = name;
      this.labelWhat.textContent = what;
      this.labelKeys.hidden = !what;
    }
    this.label.classList.add('show');
  }

  /** The cover card right of the crosshair while a book is under it: the cover, large enough to read the title (two
   *  fifths of the window height, its left edge at 60 % of the width, never over the crosshair or the book), in its own
   *  proportions and without a panel around it; below it, on a small pill, the keys when "Hinweise einblenden" is on. */
  #peek(target) {
    if (target?.type === 'audiobook') { this.#peekAudiobook(target); return; }
    const book = target?.book || (target?.id ? this.ctx.state.library.books.find((b) => b.id === target.id) : null);
    if (!book) { this.peek.classList.remove('show'); this.peekKey = null; return; }
    const hints = this.ctx.state.settings?.hints !== false;
    const key = `${book.id}|${target.type}|${hints}|${book.finished ? 1 : 0}|${padState.active ? padState.family : touchState.active ? 'touch' : 'keys'}`;
    if (this.peekKey === key) { this.peek.classList.add('show'); return; }
    this.peekKey = key;
    const cover = h('div.peek-cover');
    let img = null;
    if (hasCoverImage(book)) {
      // the cover as the cover cache holds it (up to 900 px high): sharp at this size
      const url = target.coverUrl || coverSrc(book, this.ctx.api);
      if (url) {
        img = h('img', { alt: '', src: url });
        let retried = false;
        img.addEventListener('error', () => {
          if (!retried) { retried = true; setTimeout(() => { img.src = url + (url.includes('?') ? '&' : '?') + 'r=1'; }, 200); return; }
          img.replaceWith(fallbackCover(book));
        });
        cover.appendChild(img);
      } else cover.appendChild(fallbackCover(book));
    } else if (book.hasCover !== false) cover.appendChild(typoCanvas(book));
    else cover.appendChild(fallbackCover(book));
    // how far you have read: a thin line along the lower edge of the cover
    if (book.progress > 0.005) cover.appendChild(h('div.peek-progress', h('i', { style: { width: Math.round(Math.min(1, book.progress) * 100) + '%' } })));
    // a book that is read says so; H marks it as read or unread (ui/shelves.js)
    const badge = readBadge(book);
    if (badge) cover.appendChild(badge);

    const card = h('div.peek-card',
      cover,
      hints ? h('div.peek-keys', { html: hintText(target.type === 'tablebook' ? 'peek.keysTable' : 'peek.keys') + (padState.active || touchState.active ? '' : readKeyHint(book)) }) : null,
    );
    const show = () => {
      if (this.peekKey !== key) return;          // looked elsewhere in the meantime
      // the whole cover in its own proportions (a PDF page, a square cover), not a cropped one
      if (img?.naturalWidth && img.naturalHeight) cover.style.setProperty('--peek-ratio', String(Math.min(0.86, Math.max(0.5, img.naturalWidth / img.naturalHeight)).toFixed(4)));
      clear(this.peek); this.peek.appendChild(card); this.peek.classList.add('show');
    };
    // the cover is decoded off the main thread before the card shows: decoding it while painting cost the first card
    // of a session one frame of 30 to 40 ms (the previous card stays until then, so nothing flickers)
    if (img?.decode) img.decode().then(show, show); else show();
  }

  /** An audiobook box in the hall (world/audiobook-shelf.js): its square cover and its keys (ui/audiobooks/ab-card.js). */
  #peekAudiobook(target) {
    const card = audiobookPeek(target, { hints: this.ctx.state.settings?.hints !== false });
    if (this.peekKey === card.key) { this.peek.classList.add('show'); return; }
    this.peekKey = card.key;
    const show = () => { if (this.peekKey !== card.key) return; clear(this.peek); this.peek.appendChild(card.el); this.peek.classList.add('show'); };
    if (card.img?.decode) card.img.decode().then(show, show); else show();
  }

  /** A book's cover changed (from the internet, or the reader picked another): the card and the basket strip follow. */
  refreshBook(book) {
    const t = this.target;
    if (t && (t.book?.id === book.id || t.id === book.id)) {
      if (t.book) t.book = book;
      t.coverUrl = coverSrc(book, this.ctx.api);
      this.peekKey = null;
      this.setTarget(t);
    }
    if (this.basket.includes(book.id)) this.setBasket(this.basket);
  }

  setSeated(v) { this.seated = v; this.seatChip.classList.toggle('hidden', !v); }
  setPanelOpen(v) {
    this.panelOpen = v; this.root.classList.toggle('panel-open', v);
    if (v) { this.crosshair.classList.remove('active'); this.label.classList.remove('show'); this.clickHint.classList.remove('show'); this.peek.classList.remove('show'); }
    else this.setTarget(this.target);   // back in the world: ring, label and cover for what the crosshair still rests on
  }
  // (with the gamepad or a touch screen the mouse need not be caught: no "Klicken, um dich umzusehen")
  showClickHint(v) { this.clickWanted = !!v; this.clickHint.classList.toggle('show', !!v && !this.panelOpen && !padState.active && !touchState.active); }
  /** Bottom left: the covers in the basket, how many there are and the key that opens it (also when it is empty, so
   *  that the key is easy to find). */
  setBasket(ids) {
    this.basket = ids; clear(this.basketEl);
    const books = ids.map((id) => this.ctx.state.library.books.find((b) => b.id === id)).filter(Boolean);
    const n = books.length;
    this.basketEl.classList.toggle('empty', !n);
    this.basketEl.appendChild(h('span.bk-icon', { 'aria-hidden': 'true' }, '🧺'));
    if (n) this.basketEl.appendChild(h('span.bk-covers', books.slice(0, 8).map((b) => h('img', { src: coverSrc(b, this.ctx.api) || typoCoverUrl(b), title: b.title, alt: '' }))));
    this.basketEl.appendChild(h('span.bk-text',
      h('span.count', n ? t(n === 1 ? 'hud.basketOne' : 'hud.basketMany', { n }) : t('hud.basketEmpty')),
      h('span.bk-key', { html: hintText('hud.basketOpen') })));
    this.basketEl.title = tr({ de: 'Korb öffnen (B)', en: 'Open the basket (B)' });
    // the return desk's label says what E does with or without books
    if (this.target?.kind === 'return') this.#label(this.target, this.crosshair.classList.contains('active'));
  }
  setScan(sc) { this.scan = sc; if (sc && sc.active && sc.total) this.scanEl.textContent = t('hud.scanning', { done: sc.done, total: sc.total }); else this.scanEl.textContent = ''; }
  refresh() {
    this.seatChip.innerHTML = hintText('hint.stand'); this.clickHint.textContent = t('hud.click');
    this.showClickHint(this.clickWanted);
    this.setBasket(this.basket); this.peekKey = null; this.labelKey = null; this.setTarget(this.target); this.setDepartment(this.department); this.tick();
  }
}

/**
 * The title card of a book without a cover image, drawn for the card at about the size it shows (the room's
 * 360 × 540 card would be blurred there). A canvas needs no decoding; drawn before the web fonts arrived, it is drawn
 * again once they are there.
 */
function typoCanvas(book) {
  const dpr = window.devicePixelRatio || 1;
  // the size of the cover box in hud.css (.peek-cover): two fifths of the window height, at most the width it has
  const boxH = Math.min(window.innerHeight * 0.4, 960, (window.innerWidth * 0.4 - 50) * 1.5);
  const H = Math.round(Math.min(1200, Math.max(420, boxH * dpr))), W = Math.round(H * 2 / 3);
  const c = h('canvas.peek-typo', { width: W, height: H });
  const draw = () => { const g = c.getContext('2d'); g.clearRect(0, 0, W, H); drawTypoCover(g, book, W, H); };
  draw();
  if (!fontsLoaded()) whenFontsLoaded().then(() => { if (c.isConnected) draw(); });
  return c;
}

/** A typographic binding instead of a blank white rectangle (a book that has no cover yet). */
function fallbackCover(b) {
  const el = h('div.peek-fallback',
    h('div.pf-title', b.title || ''),
    h('div.pf-rule'),
    h('div.pf-author', b.author || ''),
  );
  const c = b?.coverColor || '#3d6f6b';
  el.style.background = `linear-gradient(150deg, ${c} 0%, rgba(0,0,0,0.3) 100%), ${c}`;
  return el;
}
