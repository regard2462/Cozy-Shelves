// ÜBERSICHT – the start page of the computer: a greeting with a search field, "Weiterlesen" with the covers of
// the books in progress, one card per section with what is in it right now, and the two programmes.
import { h, clear } from '../../../core/dom.js';
import { keyList, isEditable, T, Tn, icon, cover, progress, shortcutLabel, shortcutIndex, shortcutRange } from '../terminal.js';
import { THEME_LABELS } from '../../../core/theme.js';
import { GAMES } from './games.js';

const hours = (sec, lang) => {
  const hh = (sec || 0) / 3600;
  if (hh < 1) return `${Math.round((sec || 0) / 60)} min`;
  return `${(Math.round(hh * 10) / 10).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB')} h`;
};
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Minutes of the last `n` days as small bars (today on the right, in the accent). */
function sparkline(days, n = 14) {
  const vals = [];
  const today = new Date(); today.setHours(12, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); vals.push(Math.round((days?.[localDay(d)]?.seconds || 0) / 60)); }
  const max = Math.max(1, ...vals);
  const W = 124, H = 30, gap = 3, bw = (W - gap * (n - 1)) / n;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'term-spark'); svg.setAttribute('aria-hidden', 'true');
  vals.forEach((v, i) => {
    const bh = v ? Math.max(3, (v / max) * H) : 1.5;
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', (i * (bw + gap)).toFixed(1)); r.setAttribute('y', (H - bh).toFixed(1));
    r.setAttribute('width', bw.toFixed(1)); r.setAttribute('height', bh.toFixed(1)); r.setAttribute('rx', '1.5');
    r.setAttribute('class', !v ? 'zero' : i === n - 1 ? 'today' : '');
    svg.appendChild(r);
  });
  return svg;
}

export async function mount(root, s) {
  const { ctx, sfx } = s;
  const lang = ctx.i18n?.lang || 'de';
  const lib = ctx.state?.library || {};
  const books = lib.books || [];
  const deps = lib.departments || [];
  const basket = ctx.state?.basket || [];
  const el = h('div.term-home');
  root.appendChild(el);
  let list = null;

  // ---- greeting + search ---------------------------------------------------------------------------------------
  const now = new Date();
  const hr = now.getHours();
  const greeting = hr >= 5 && hr < 11 ? T('Guten Morgen', 'Good morning') : hr >= 11 && hr < 17 ? T('Guten Tag', 'Good afternoon') : hr >= 17 && hr < 23 ? T('Guten Abend', 'Good evening') : T('Gute Nacht', 'Good night');
  const dateLine = now.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const search = h('input.term-input.term-home-search-input', { type: 'search', spellcheck: false, autocomplete: 'off', placeholder: T('Im Bestand suchen: Titel, Autor, ISBN …', 'Search the collection: title, author, ISBN …'),
    onkeydown: (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const q = search.value.trim(); sfx.click(); s.goSection('catalog', q ? { q } : {}); }
      if (e.key === 'ArrowDown') { e.preventDefault(); search.blur(); s.focusScreen(); list?.set(0); }
    } });
  el.appendChild(h('div.term-hero',
    h('div.term-hero-text',
      h('h2.term-hero-h', greeting),
      h('p.term-hero-sub', dateLine, ' · ', Tn(books.length, ['1 Buch', '1 book'], ['{n} Bücher', '{n} books']), ' ', Tn(deps.length, ['in 1 Abteilung', 'in 1 department'], ['in {n} Abteilungen', 'in {n} departments']))),
    h('label.term-search.term-home-search', icon('search'), search)));

  // ---- continue reading ------------------------------------------------------------------------------------------
  const byLast = books.filter((b) => b.lastRead).sort((a, b) => b.lastRead - a.lastRead);
  const inProgress = byLast.filter((b) => (b.progress || 0) < 0.985);
  const cont = (inProgress.length ? inProgress : byLast).slice(0, 3);
  const contCards = cont.map((b) => {
    const card = h('div.term-cont', { dataset: { book: b.id }, role: 'button', title: T('Weiterlesen: {t}', 'Continue reading: {t}', { t: b.title || '' }) },
      cover(b, ctx.api, 'term-cont-cover'),
      h('div.term-cont-body',
        h('div.term-cont-title', b.title || '?'),
        b.author ? h('div.term-cont-author', b.author) : null,
        progress(b.progress || 0),
        h('div.term-cont-actions',
          h('span.term-cont-go', icon('read'), T('Weiterlesen', 'Continue')),
          h('button.term-linkbtn', { type: 'button', tabindex: -1, onclick: (e) => { e.stopPropagation(); sfx.click(); s.goSection('catalog', { book: b.id }); } }, T('Details', 'Details')))));
    return card;
  });
  if (contCards.length) {
    el.appendChild(h('section.term-block',
      h('div.term-block-head', h('h3.term-h', T('Weiterlesen', 'Continue reading')), h('span.spacer'),
        h('button.term-linkbtn', { type: 'button', tabindex: -1, onclick: () => { sfx.click(); s.goSection('history'); } }, T('Ganzer Verlauf', 'Full history'), icon('arrow'))),
      h('div.term-continue', contCards)));
  }

  // ---- one card per section --------------------------------------------------------------------------------------
  const annotations = books.reduce((a, b) => a + (b.annotations?.length || 0), 0);
  const bookmarks = books.reduce((a, b) => a + (b.bookmarks?.length || 0), 0);
  const folders = (ctx.state?.settings?.folders || lib.folders || []).length;
  const theme = ctx.theme?.() || 'sepia';
  const statsValue = h('div.term-ov-value', '…');
  const statsSub = h('div.term-ov-sub', T('Lesezeit wird gezählt', 'Counting reading time'));
  const statsViz = h('div.term-ov-viz');
  const facts = {
    catalog: [Tn(books.length, ['1 Buch', '1 book'], ['{n} Bücher', '{n} books']), Tn(deps.length, ['in 1 Abteilung', 'in 1 department'], ['in {n} Abteilungen', 'in {n} departments'])],
    history: [basket.length ? T('{n} im Korb', '{n} in the basket', { n: basket.length }) : T('Korb leer', 'Basket empty'),
      byLast[0] ? T('zuletzt: {t}', 'last: {t}', { t: byLast[0].title || '?' }) : T('noch nichts gelesen', 'nothing read yet')],
    diary: [Tn(annotations, ['1 Anmerkung', '1 annotation'], ['{n} Anmerkungen', '{n} annotations']), Tn(bookmarks, ['1 Lesezeichen', '1 bookmark'], ['{n} Lesezeichen', '{n} bookmarks'])],
    stats: null,
    games: [T('{n} Spiele', '{n} games', { n: GAMES.length }), T('Schach, Go, Sudoku und mehr', 'chess, go, sudoku and more')],
    system: [s.tr(THEME_LABELS[theme] || THEME_LABELS.sepia), `${lang === 'en' ? 'English' : 'Deutsch'} · ${Tn(folders, ['1 Bücherordner', '1 book folder'], ['{n} Bücherordner', '{n} book folders'])}`],
  };
  const ovCards = s.sections.map((sec, i) => {
    const f = facts[sec.id];
    return h('div.term-ov', { dataset: { id: sec.id }, role: 'button' },
      h('div.term-ov-top', h('span.term-ov-icon', icon(sec.icon)), h('span.term-ov-title', s.tr(sec.label)), h('kbd.term-key', shortcutLabel(i))),
      f ? h('div.term-ov-value', f[0]) : statsValue,
      f ? h('div.term-ov-sub', f[1]) : statsSub,
      sec.id === 'stats' ? statsViz : null);
  });
  el.appendChild(h('section.term-block', h('h3.term-h', T('Bereiche', 'Sections')), h('div.term-overview', ovCards)));

  // ---- programmes ------------------------------------------------------------------------------------------------
  const appCards = s.apps.map((a, i) => h('div.term-app', { dataset: { app: a.id }, role: 'button' },
    h('span.term-app-icon', icon(a.icon)),
    h('span.term-app-body', h('span.term-app-title', s.tr(a.label)), h('span.term-app-desc', s.tr(a.desc))),
    h('kbd.term-key', shortcutLabel(s.sections.length + i))));
  el.appendChild(h('section.term-block', h('h3.term-h', T('Programme', 'Programmes')), h('div.term-apps', appCards)));

  // ---- keyboard --------------------------------------------------------------------------------------------------
  const rows = [...contCards, ...ovCards, ...appCards];
  const activate = (row) => {
    if (row.dataset.book) { s.readBook(row.dataset.book); return; }
    if (row.dataset.app) { s.openApp(row.dataset.app); return; }
    sfx.click(); s.goSection(row.dataset.id);
  };
  list = keyList(rows, { spatial: true, onEnter: (row, i, e) => { if (e?.target?.closest?.('.term-linkbtn')) return; activate(row); } });
  list.set(contCards.length, false);      // the first section card (Katalog); ↑ reaches the books
  const total = s.sections.length + s.apps.length;
  s.setHints([['↑↓←→', T('wählen', 'select')], ['⏎', T('öffnen', 'open')], [shortcutRange(total), T('direkt', 'direct')], ['/', T('suchen', 'search')], ['Esc', T('schließen', 'close')]]);

  // ---- statistics arrive later -----------------------------------------------------------------------------------
  let disposed = false;
  (async () => {
    let st = null;
    try { st = await ctx.api.library.stats(); } catch (e) { console.warn('[computer] stats', e); }
    if (disposed) return;
    const total = st?.totalSeconds ?? books.reduce((a, b) => a + (b.readingSeconds || 0), 0);
    statsValue.textContent = total ? T('{t} Lesezeit', '{t} reading', { t: hours(total, lang) }) : T('Noch keine Lesezeit', 'No reading time yet');
    const streak = st?.streak || 0;
    statsSub.textContent = streak === 1 ? T('Serie: 1 Tag', 'Streak: 1 day') : streak ? T('Serie: {n} Tage', 'Streak: {n} days', { n: streak }) : T('letzte 14 Tage', 'last 14 days');
    clear(statsViz);
    if (st?.days) statsViz.appendChild(sparkline(st.days));
  })();

  return {
    unmount() { disposed = true; },
    onKey(e) {
      if (isEditable(e.target)) return false;
      const i = shortcutIndex(e);
      if (i >= 0 && i < total && /^[0-9]$/.test(e.key)) {
        sfx.click();
        if (i < s.sections.length) s.goSection(s.sections[i].id); else s.openApp(s.apps[i - s.sections.length].id);
        return true;
      }
      if (e.key === '/') { e.preventDefault(); search.focus(); return true; }
      if (list.onKey(e)) { e.preventDefault(); return true; }
      // type-to-search: letters go into the search field (the key itself still reaches the field)
      if (e.key.length === 1 && /\p{L}/u.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { search.focus(); return false; }
      return false;
    },
  };
}
