// Basket panel: the books you carry.
import { h, clear } from '../core/dom.js';
import { t, tr } from '../core/i18n.js';
import { coverThumb } from '../core/cover-art.js';

export async function mount(container, ctx) {
  const panel = h('div.panel.paper.basket-panel');
  container.appendChild(panel);
  const sfx = (n) => { try { ctx.audio?.sfx?.(n); } catch { /* audio optional */ } };

  const render = () => {
    clear(panel);
    const ids = ctx.world?.basket || ctx.state.basket || [];
    const books = ids.map((id) => ctx.state.library.books.find((b) => b.id === id)).filter(Boolean);
    const body = h('div.panel-body');
    if (!books.length) body.appendChild(h('p.muted', t('basket.empty')));
    else {
      const grid = h('div.basket-grid');
      for (const b of books) {
        const open = () => { ctx.close(); ctx.bus.emit('book:open', { id: b.id }); };
        grid.appendChild(h('div.basket-item',
          coverThumb(b, ctx.api),
          h('div.col',
            h('div.book-title', { title: b.title }, b.title),
            h('div.book-author', b.author || ''),
            // a book not started yet shows no empty bar
            (b.progress || 0) > 0 ? h('div.basket-progress',
              h('div.progress-bar', { role: 'progressbar', 'aria-valuenow': Math.round(b.progress * 100), 'aria-valuemin': '0', 'aria-valuemax': '100' },
                h('i', { style: { width: Math.round(b.progress * 100) + '%' } })),
              h('span.small.muted', Math.round(b.progress * 100) + ' %')) : null),
          h('div.actions',
            h('button.btn.primary.small', { onclick: open }, t('basket.read')),
            h('button.btn.small', { onclick: () => ctx.openPanel('bookinfo', { id: b.id }) }, t('basket.info')),
            h('button.btn.small.ghost', { onclick: () => { ctx.bus.emit('book:return', { id: b.id }); setTimeout(render, 50); } }, t('basket.return'))),
        ));
      }
      body.appendChild(grid);
    }
    panel.append(
      h('div.panel-header', '🧺 ' + t('basket.title'), h('span.spacer'),
        books.length ? h('button.btn.small', { onclick: () => { try { ctx.world?.returnAll?.(); } catch (e) { console.warn('[basket]', e); } sfx('bell'); setTimeout(render, 50); } }, t('basket.returnAll')) : null,
        h('button.btn.icon', { title: tr({ de: 'Schließen', en: 'Close' }), 'aria-label': tr({ de: 'Schließen', en: 'Close' }), onclick: ctx.close }, '✕')),
      body);
  };

  render();
  const off = ctx.bus.on('basket:change', render);
  const offLang = ctx.bus.on('i18n:change', render);   // every label comes from t() – redraw on Deutsch/English
  return {
    unmount() { off(); offLang(); },
    onKey(e) { if (e.code === 'KeyB' && !e.ctrlKey && !e.metaKey && !e.altKey) { ctx.close(); return true; } return false; },
  };
}
