// What the gamepad does in particular panels (input/gamepad.js asks the adapter first, then does the common thing:
// the ring moves, A presses, B goes back, LB and RB switch tabs). An adapter may name stages (input/pad-nav.js): a
// film, the page of a book, the map, whose own buttons act while the ring rests on them.
//   reader      LB/RB and ◀▶ turn the page, A shows the bars and puts the ring on them, Y reads aloud, X bookmarks
//   mediathek   on the film: A pause and play, ◀▶ 10 s, ▼ into its controls; LB/RB the sections
//   podcasts    on the player: A pause and play, ◀▶ 15 s, ▼ into its buttons
//   worldmap    the left stick moves the map, the triggers zoom, A opens the card under the cross, LB/RB back and
//               forward through the cards, X zooms to the card, Y shows the whole world
//   computer    in a game the D-pad is the arrow keys, A Enter, X Space, Y undo; LB/RB reach the game's buttons
//   browser     LB/RB page back and forward, the right stick scrolls the page, X reading mode, Y read aloud
//   menu        LB/RB guide, places, recently read; View the places; Start back into the library
import { t } from '../core/i18n.js';
import { mediaPlayer } from '../media/media-player.js';

const cache = new WeakMap();
const ARROWS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

/** The adapter for a panel entry of ui/panels.js (one per open panel, it may keep a little state). */
export function adapterFor(top) {
  if (!top) return null;
  let a = cache.get(top);
  if (a === undefined) { const make = MAKERS[top.name]; a = make ? make(top) : null; cache.set(top, a); }
  return a;
}

const visibleEl = (el) => !!el && el.isConnected && el.getClientRects().length > 0 && el.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) !== false;
/** A pointer move over an element: players show their controls again (they hide them after a moment). */
function poke(el) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
}

const MAKERS = {
  // ---------------------------------------------------------------------------------------------- the menu ----
  menu: (top) => {
    const tabs = (root) => [t('menu.guide'), t('menu.places'), t('menu.recent')]
      .map((label) => [...root.querySelectorAll('.menu-buttons > .menu-btn')].find((b) => b.textContent.trim() === label)).filter(Boolean);
    return {
      initial: (root) => root.querySelector('.menu-btn.primary'),
      button(name, io) {
        const root = top.el;
        if (name === 'lb' || name === 'rb') {
          const list = tabs(root);
          let i = list.findIndex((b) => b.classList.contains('active'));
          i = i < 0 ? (name === 'rb' ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + (name === 'rb' ? 1 : -1)));
          const ring = io.nav.el && list.includes(io.nav.el);
          list[i]?.click();
          if (ring) io.pad.after = () => { const b = tabs(root).find((x) => x.classList.contains('active')); if (b) io.nav.focus(b); };
          return true;
        }
        if (name === 'view') { tabs(root)[1]?.click(); return true; }
        return false;
      },
    };
  },

  // ---------------------------------------------------------------------------------------------- the reader ----
  reader: (top) => {
    let bars = false;      // false: reading (the page is the stage, no ring); true: the ring is on the bars
    let currentIo = null;  // the stage's callbacks run inside nav.move and nav.activate: the frame's io
    const api = () => top.instance?.pad || null;
    const setBars = (on, io, focus) => {
      bars = on;
      const p = api(); p?.keepBars?.(on);
      if (on) {
        io.nav.stage = null;
        const el = focus || p?.firstBar?.();
        if (el) io.nav.focus(el);
      } else { const st = p?.stage?.(); if (st) io.nav.focus(st); }
    };
    return {
      stages(root) {
        const p = api(); if (!p || bars) return [];
        const el = p.stage?.(); if (!el) return [];
        return [{
          el, ring: 'none',
          onA: () => { const io = currentIo; if (io) setBars(true, io); return true; },
          onDir: (dir) => {
            const io = currentIo;
            if (dir === 'left' || dir === 'right') { p.turn(dir); return true; }
            if (io) setBars(true, io, dir === 'down' ? p.slider?.() : p.firstBar?.());
            return true;
          },
        }];
      },
      initial: () => (bars ? api()?.firstBar?.() : api()?.stage?.()) || null,
      frame(io) {
        currentIo = io;
        const p = api(); if (!p) return;
        if (bars) p.keepBars?.(true);
      },
      button(name, io) {
        const p = api(); if (!p) return false;
        if (name === 'lb' || name === 'rb') { p.turn(name === 'lb' ? 'left' : 'right'); return true; }
        if (name === 'y') { p.readAloud(); return true; }
        if (name === 'x') { p.bookmark(); return true; }
        if (name === 'b' && bars) {
          // first the open card (contents, appearance), then back to the page
          if (p.popupOpen()) { io.key('Escape', 'Escape'); return true; }
          setBars(false, io);
          return true;
        }
        return false;
      },
    };
  },

  // ---------------------------------------------------------------------------------------------- Mediathek ----
  mediathek: (top) => {
    let pokedAt = 0;
    const stage = (root) => root.querySelector('.mt-detail:not(.hidden) .mt-stage.active');
    return {
      stages(root) {
        const el = stage(root); if (!el) return [];
        return [{
          el, ring: 'inset', entry: '.mt-cplay',
          onA: () => { mediaPlayer.toggle(); poke(el); return true; },
          onDir: (dir) => { if (dir === 'left' || dir === 'right') { mediaPlayer.skip(dir === 'left' ? -10 : 10); poke(el); return true; } return false; },
        }];
      },
      initial: (root) => stage(root),
      frame(io) {
        // the controls of the film stay while the ring is on them
        const el = stage(top.el);
        if (el && io.nav.el && el.contains(io.nav.el) && performance.now() - pokedAt > 800) { pokedAt = performance.now(); poke(el); }
      },
    };
  },

  // ---------------------------------------------------------------------------------------------- podcasts ----
  podcasts: (top) => ({
    // with an episode loaded the ring starts on its player
    initial: (root) => root.querySelector('.pod-player:not(.idle)'),
    stages(root) {
      const el = root.querySelector('.pod-player:not(.idle)'); if (!el) return [];
      return [{
        el, ring: 'normal', entry: '.pod-ctl.main',
        onA: () => { el.querySelector('.pod-ctl.main')?.click(); return true; },
        onDir: (dir) => {
          if (dir !== 'left' && dir !== 'right') return false;
          el.querySelectorAll('.pod-ctl')[dir === 'left' ? 1 : 3]?.click();   // −15 and +15
          return true;
        },
      }];
    },
  }),

  // ---------------------------------------------------------------------------------------------- the world map ----
  worldmap: (top) => {
    let aimEl = null, hoverAt = 0, moved = false;
    const wm = () => top.el.querySelector('.wm-panel')?.__wm || null;
    const svOpen = () => !!top.el.querySelector('.wm-body.sv-open');
    /** The cross: the middle of the part of the map the card leaves free (body coordinates). */
    const point = () => {
      const body = top.el.querySelector('.wm-body'); if (!body) return null;
      const b = body.getBoundingClientRect();
      const card = body.querySelector('.wm-card:not([hidden])');
      let w = b.width;
      if (card && body.classList.contains('has-card') && b.width > 900) w = Math.max(200, card.getBoundingClientRect().left - b.left);
      return { body, x: w / 2, y: b.height / 2, cx: b.left + w / 2, cy: b.top + b.height / 2 };
    };
    // the map (osm-view.js) answers at a point of its own: the hover (the highlight and the name) and the click
    return {
      ownsStick: true,
      stages(root) {
        const canvas = root.querySelector('.wm-canvas');
        if (!canvas || svOpen()) return [];
        return [{
          el: canvas, ring: 'inset',
          // A: a click at the cross (the map opens the card of the country or city under it)
          onA: () => { const p = point(), v = wm()?.view; if (p && v) { v.hoverAt(p.x, p.y); v.clickAt(p.x, p.y); } return true; },
        }];
      },
      initial: (root) => (svOpen() ? null : root.querySelector('.wm-canvas')),
      frame(io) {
        const w = wm(), view = w?.view;
        const p = point();
        const onMap = !!io.nav.el && io.nav.el.classList?.contains('wm-canvas') && !svOpen();
        if (p && !aimEl?.isConnected) { aimEl = document.createElement('div'); aimEl.className = 'wm-pad-aim'; p.body.appendChild(aimEl); }
        if (aimEl) { aimEl.classList.toggle('show', onMap && document.documentElement.dataset.input === 'pad'); if (p) aimEl.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`; }
        if (!view || svOpen() || !p) return;
        // the left stick moves the map (up to 900 px a second), the triggers zoom about the cross
        const [lx, ly, lm] = io.stick('left');
        const zin = io.trigger('rt'), zout = io.trigger('lt');
        const dt = io.dt;
        if (lm > 0) {
          if (!onMap) io.nav.focus(top.el.querySelector('.wm-canvas'), { reveal: false });
          const v = 900 * Math.pow(lm, 1.5) / lm;
          view.panBy(lx * v * dt, ly * v * dt, false);
          moved = true;
        }
        const z = (zin > 0.05 ? zin : 0) - (zout > 0.05 ? zout : 0);
        if (z) {
          const f = Math.exp(z * 1.8 * dt);
          view.zoomAt(f, p.x, p.y);
          moved = true;
        }
        // what lies under the cross: the map's own hover (the hand, the highlight and the name)
        if (onMap && (moved || performance.now() - hoverAt > 400) && performance.now() - hoverAt > 90) { hoverAt = performance.now(); moved = false; view.hoverAt(p.x, p.y); }
      },
      button(name, io) {
        const inst = top.instance;
        if (name === 'lb' || name === 'rb') { inst?.onNav?.(name === 'lb' ? -1 : 1); return true; }
        if (svOpen()) return false;
        if (name === 'x') { io.key('Enter', 'Enter'); return true; }   // zoom to the card
        if (name === 'y') { io.key('Digit0', '0'); return true; }     // the whole world
        return false;
      },
    };
  },

  // ---------------------------------------------------------------------------------------------- the computers ----
  computer: (top) => {
    let currentIo = null;  // the stage's callbacks send keys with the frame's io
    let shownGame = null;  // the game board the ring was put on (a new game takes the ring once)
    const game = (root) => { const g = root.querySelector('.term-game-body'); return g && g.firstElementChild && !g.querySelector(':scope > .term-notice') ? g : null; };
    const gameButtons = (root) => {
      const g = root.querySelector('.term-games'); if (!g) return [];
      return [...g.querySelectorAll('button, [role="button"]')].filter((b) => visibleEl(b) && !b.disabled);
    };
    return {
      stages(root) {
        const g = game(root); if (!g) return [];
        return [{
          el: g, ring: 'none',
          onA: () => { currentIo?.key('Enter', 'Enter'); return true; },
          onDir: (dir) => { const k = ARROWS[dir]; currentIo?.key(k, k); return true; },
        }];
      },
      // a game: the board; else the first entry of the screen (not the brand in the header)
      initial: (root) => game(root) || [...root.querySelectorAll('.term-content .term-row, .term-content button, .term-content [role="button"]')].find(visibleEl) || root.querySelector('.term-nav-item.active'),
      frame(io) {
        currentIo = io;
        // a game that has just started (its module loads after the card was pressed): the ring goes onto its board
        const g = game(top.el);
        if (g && g !== shownGame) { shownGame = g; if (io.nav.el !== g && !g.closest('.term-games')?.querySelector('.term-game-head')?.contains(io.nav.el)) io.nav.focus(g); }
        if (!g) shownGame = null;
      },
      onFocus(el) {
        // the terminal marks its own choice in a list: it follows the ring
        if (el?.classList?.contains('term-row')) el.dispatchEvent(new MouseEvent('mouseenter'));
      },
      button(name, io) {
        const g = game(top.el); if (!g) return false;
        const onStage = io.nav.el === g;
        if (name === 'x' && onStage) { io.key('Space', ' '); return true; }
        if (name === 'y' && onStage) { io.key('KeyU', 'u'); return true; }
        // LB and RB: the game's own buttons (new game, undo, size …) one after the other; back to the board after A
        if (name === 'lb' || name === 'rb') {
          const list = gameButtons(top.el); if (!list.length) return true;
          const i = list.indexOf(io.nav.el);
          const next = i < 0 ? list[name === 'rb' ? 0 : list.length - 1] : list[(i + (name === 'rb' ? 1 : -1) + list.length) % list.length];
          io.nav.focus(next);
          return true;
        }
        if (name === 'a' && !onStage && g.closest('.term-games')?.contains(io.nav.el)) { io.nav.activate(); const gg = game(top.el); if (gg) io.pad.after = () => io.nav.focus(game(top.el) || gg); return true; }
        return false;
      },
    };
  },

  // ---------------------------------------------------------------------------------------------- the reading browser ----
  browser: (top) => {
    let acc = 0;
    return {
      button(name, io) {
        if (name === 'lb') { io.key('PageUp', 'PageUp'); return true; }
        if (name === 'rb') { io.key('PageDown', 'PageDown'); return true; }
        if (name === 'x') { io.key('KeyR', 'r'); return true; }
        if (name === 'y') { io.key('KeyV', 'v'); return true; }
        return false;
      },
      scroll(rx, ry, rm, io) {
        // a list of the browser (bookmarks, history) scrolls itself; the page scrolls by lines
        const sheet = top.el.querySelector('.br-sheet, .br-lib');
        if (sheet && visibleEl(sheet)) return false;
        acc += ry * 900 * rm * io.dt;
        while (Math.abs(acc) >= 60) { const d = Math.sign(acc); acc -= d * 60; io.key(d > 0 ? 'ArrowDown' : 'ArrowUp', d > 0 ? 'ArrowDown' : 'ArrowUp'); }
        return true;
      },
    };
  },
};

/** The mini player of the HUD (D-pad down in the world): the ring starts on its play button. */
export const hudAdapter = {
  initial: (root) => root.querySelector('.mb-play'),
};
