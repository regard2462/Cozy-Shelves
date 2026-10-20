// Back and forward for panels with internal navigation (computer, Fernleihe, Mediathek, newspaper, podcasts).
// A panel keeps a history of its own states (sections, detail views, filters) and applies an entry in onGo.
// The same three ways as in a web browser lead through it:
//   * the two buttons of navButtons() in the panel header,
//   * Alt+← / Alt+→ (and the BrowserBack / BrowserForward keys) through onKey(e),
//   * the side buttons 4 and 5 of a mouse: panels.js hands them to the topmost panel's onNav(-1 | 1).
import { h } from '../core/dom.js';
import { tr } from '../core/i18n.js';
import { bus } from '../core/bus.js';

const CHEVRON = { back: 'M15 5l-7 7 7 7', forward: 'M9 5l7 7-7 7' };
/** The chevron of a back ('back') or forward ('forward') button, as used by every panel. */
export const chevron = (dir) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'nav-chevron');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', CHEVRON[dir]); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2.2'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(p);
  return svg;
};
const sameState = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * createNavHistory({ onGo(state, delta), same?, max? })
 *   push(state)     a new entry after the current one (the forward part is dropped); an entry equal to the
 *                   current one only replaces it, so repeated clicks on the same thing do not pile up
 *   replace(state)  updates the current entry (typing in a search field, scroll positions)
 *   back(), forward(), go(delta)  → true when there was an entry; onGo(state, delta) applies it
 *   peek(delta)     the entry delta steps away, or null
 *   onKey(e)        Alt+←/→, BrowserBack/BrowserForward → true when handled
 *   buttons(opts)   the two header buttons, kept enabled or disabled
 */
export function createNavHistory({ onGo, same = sameState, max = 100 } = {}) {
  const stack = [];
  let index = -1;
  const listeners = new Set();
  const emit = () => { for (const fn of [...listeners]) { try { fn(); } catch (e) { console.error('[nav-history]', e); } } };

  function go(delta) {
    const i = index + delta;
    if (!delta || i < 0 || i >= stack.length) return false;
    index = i;
    emit();
    try { onGo?.(stack[i], delta); } catch (e) { console.error('[nav-history] onGo', e); }
    return true;
  }

  const api = {
    get current() { return stack[index] ?? null; },
    get canBack() { return index > 0; },
    get canForward() { return index >= 0 && index < stack.length - 1; },
    get length() { return stack.length; },
    push(state) {
      if (index >= 0 && same(stack[index], state)) { stack[index] = state; emit(); return; }
      stack.splice(index + 1);
      stack.push(state);
      while (stack.length > max) stack.shift();
      index = stack.length - 1;
      emit();
    },
    replace(state) { if (index < 0) { api.push(state); return; } stack[index] = state; emit(); },
    peek(delta) { return stack[index + delta] ?? null; },
    back: () => go(-1),
    forward: () => go(1),
    go,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onKey(e) {
      if (!e) return false;
      if (e.key === 'BrowserBack') return go(-1) || true;
      if (e.key === 'BrowserForward') return go(1) || true;
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        go(e.key === 'ArrowLeft' ? -1 : 1);
        return true;   // Alt+arrow never moves anything else in a panel
      }
      return false;
    },
    /** The two header buttons. opts.cls: extra classes for both (e.g. 'term-hbtn'); default: small round .btn */
    buttons({ cls = 'btn small icon ghost' } = {}) {
      const mk = (dir, label, keys, delta) => {
        const b = h('button', { type: 'button', class: `nav-btn nav-${dir} ${cls}`, title: `${label} (${keys})`, 'aria-label': label, tabindex: -1,
          onclick: (e) => { e.stopPropagation(); go(delta); } }, chevron(dir));
        return b;
      };
      const back = mk('back', tr({ de: 'Zurück', en: 'Back' }), 'Alt+←', -1);
      const fwd = mk('forward', tr({ de: 'Vor', en: 'Forward' }), 'Alt+→', 1);
      const wrap = h('div.nav-arrows', { role: 'group', 'aria-label': tr({ de: 'Verlauf', en: 'History' }) }, back, fwd);
      const paint = () => { back.disabled = !api.canBack; fwd.disabled = !api.canForward; };
      // the language switched while the panel is open (the computer's system section does it): the buttons' names too
      const label = () => {
        const b = tr({ de: 'Zurück', en: 'Back' }), f = tr({ de: 'Vor', en: 'Forward' });
        back.title = `${b} (Alt+←)`; back.setAttribute('aria-label', b);
        fwd.title = `${f} (Alt+→)`; fwd.setAttribute('aria-label', f);
        wrap.setAttribute('aria-label', tr({ de: 'Verlauf', en: 'History' }));
      };
      paint();
      const off = api.onChange(paint), offLang = bus.on('i18n:change', label);
      wrap.dispose = () => { off(); offLang(); };
      return wrap;
    },
  };
  return api;
}
