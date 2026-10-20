// STATISTIK – reading time and the collection. Four figures at the top; a time range (7, 30, 90 days) scopes the
// reading chart per day and the average per weekday below it; then the most read books and the collection by
// department and format. One hue (the accent) for every bar, gridlines as hairlines, each bar shows its value on
// hover or keyboard focus. Colours come from the tokens, so the charts read in Hell, Sepia and Dunkel.
import { h, clear } from '../../../core/dom.js';
import { fmtTime, T, Tn, notice, icon, cover, isEditable, meter } from '../terminal.js';

const RANGES = [7, 30, 90];
const NICE = [5, 10, 15, 20, 30, 40, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720, 900, 1200];
const niceMax = (v) => NICE.find((n) => n >= v) || Math.ceil(v / 300) * 300;
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function mount(root, s, params = {}) {
  const { ctx, sfx } = s;
  const lang = () => ctx.i18n?.lang || 'de';
  const L = lang() === 'de' ? 'de-DE' : 'en-GB';
  const el = h('div.term-stats');
  root.appendChild(el);
  el.appendChild(notice(T('Statistik wird geladen …', 'Loading statistics …')));
  let st = null;
  try { st = await ctx.api.library.stats(); } catch (e) { console.warn(e); }
  clear(el);
  if (!st) { el.appendChild(notice(T('Statistik nicht verfügbar.', 'Statistics unavailable.'))); return {}; }
  let range = RANGES.includes(+params.range) ? +params.range : 30;
  const books = ctx.state?.library?.books || [];
  const deps = ctx.state?.library?.departments || [];
  const days = st.days || {};
  // less than a minute is not "0 min"
  const time = (sec) => (sec > 0 && sec < 60 ? T('unter 1 min', 'under 1 min') : fmtTime(sec));
  const minutesOn = (d) => Math.round((days[localDay(d)]?.seconds || 0) / 60);

  // ---- four figures ------------------------------------------------------------------------------------------------
  // the streak: days in a row with at least 5 minutes of reading (electron/library/reading-log.js)
  const streak = st.streak || 0;
  const readToday = st.readToday ?? minutesOn(new Date()) >= 5;
  const tile = (ic, label, value, sub) => h('div.term-kpi', h('div.term-kpi-top', h('span.term-kpi-icon', icon(ic)), h('span.term-kpi-label', label)), h('div.term-kpi-value', value), sub ? h('div.term-kpi-sub', sub) : null);
  el.appendChild(h('div.term-kpis',
    tile('clock', T('Lesezeit gesamt', 'Total reading time'), time(st.totalSeconds || 0), T('in der Leseansicht gezählt', 'counted in the reader')),
    tile('flame', T('Lesesträhne', 'Reading streak'), streak === 1 ? T('1 Tag in Folge', '1 day in a row') : T('{n} Tage in Folge', '{n} days in a row', { n: streak }), streak ? (readToday ? T('heute schon 5 Minuten gelesen', '5 minutes read today') : T('heute noch keine 5 Minuten', 'not yet 5 minutes today')) : T('ab 5 Minuten am Tag', 'from 5 minutes a day')),
    tile('read', T('Begonnen / beendet', 'Started / finished'), `${st.started ?? 0} / ${st.finished ?? 0}`, T('Bücher', 'books')),
    tile('shelf', T('Bestand', 'Collection'), String(st.totalBooks ?? books.length), Tn(deps.length, ['in 1 Abteilung', 'in 1 department'], ['in {n} Abteilungen', 'in {n} departments']))));
  el.appendChild(goalCard(st, books, s, streak, readToday));

  // ---- reading time in a range: per day, per weekday ----------------------------------------------------------------
  const rangeSeg = h('div.term-seg', { role: 'radiogroup', 'aria-label': T('Zeitraum', 'Range') });
  const rangeBody = h('div.term-range-body');
  const paintRange = () => {
    clear(rangeSeg);
    for (const r of RANGES) rangeSeg.appendChild(h('button.term-seg-btn', { type: 'button', tabindex: -1, role: 'radio', 'aria-checked': r === range ? 'true' : 'false', class: r === range ? 'on' : '',
      onclick: () => setRange(r) }, T('{n} Tage', '{n} days', { n: r })));
  };
  function setRange(r, { record = true } = {}) {
    if (r === range) return;
    range = r; sfx.click();
    if (record) s.nav.push({ range: r === 30 ? null : r });
    paintRange(); renderRange();
  }
  el.appendChild(h('section.term-card.term-chart-card',
    h('div.term-card-head', h('h3.term-card-h', T('Lesezeit', 'Reading time')), h('span.spacer'), rangeSeg),
    rangeBody));

  function renderRange() {
    clear(rangeBody);
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const cols = [];
    for (let i = range - 1; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); cols.push({ d, min: minutesOn(d), today: i === 0 }); }
    const total = cols.reduce((a, c) => a + c.min, 0);
    const active = cols.filter((c) => c.min > 0).length;
    rangeBody.appendChild(h('div.term-chart-summary',
      h('span', h('b', T('{m} min', '{m} min', { m: total.toLocaleString(L) })), ' ', T('in {n} Tagen', 'in {n} days', { n: range })),
      h('span', h('b', String(active)), ' ', active === 1 ? T('Lesetag', 'reading day') : T('Lesetage', 'reading days')),
      h('span', h('b', T('{a} min', '{a} min', { a: Math.round(total / range) })), ' ', T('pro Tag im Schnitt', 'per day on average'))));
    if (!total) {
      rangeBody.appendChild(notice(T('In diesem Zeitraum wurde noch nicht gelesen. Gezählt wird die Zeit, in der ein Buch in der Leseansicht offen ist.', 'No reading in this range yet. The time a book is open in the reader is counted.')));
      return;
    }
    const every = range <= 7 ? 1 : range <= 30 ? 5 : 15;
    rangeBody.appendChild(columnChart(cols.map((c, i) => ({
      value: c.min,
      strong: c.today,
      // the day and the month in the order of the language ("14.10." in German, "14/10" in English)
      label: i === cols.length - 1 ? T('heute', 'today') : (range <= 7 ? c.d.toLocaleDateString(L, { weekday: 'short' }) : (cols.length - 1 - i) % every === 0 ? c.d.toLocaleDateString(L, { day: 'numeric', month: 'numeric' }) : ''),
      tip: `${c.d.toLocaleDateString(L, { weekday: 'short', day: 'numeric', month: 'short' })}: ${c.min} min`,
    })), { unit: 'min', aria: T('Minuten pro Tag, die letzten {n} Tage', 'Minutes per day, the last {n} days', { n: range }) }));

    // the average per weekday over the range (Monday first)
    const wd = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
    for (const c of cols) { const k = (c.d.getDay() + 6) % 7; wd[k].sum += c.min; wd[k].n++; }
    const names = Array.from({ length: 7 }, (_, k) => { const d = new Date(2024, 0, 1 + k); return d.toLocaleDateString(L, { weekday: 'short' }); });
    const todayK = (today.getDay() + 6) % 7;
    rangeBody.appendChild(h('h4.term-subhead', T('Im Schnitt pro Wochentag', 'Average per weekday')));
    rangeBody.appendChild(columnChart(wd.map((w, k) => ({ value: w.n ? Math.round(w.sum / w.n) : 0, strong: k === todayK, label: names[k], tip: `${names[k]}: ${w.n ? Math.round(w.sum / w.n) : 0} min` })),
      { unit: 'min', compact: true, aria: T('Durchschnittliche Minuten pro Wochentag', 'Average minutes per weekday') }));
  }
  paintRange(); renderRange();

  // ---- most read, and the collection ---------------------------------------------------------------------------------
  const top = (st.top || []).slice(0, 8);
  const topCard = h('section.term-card', h('div.term-card-head', h('h3.term-card-h', T('Meistgelesen', 'Most read')), h('span.term-card-note', T('insgesamt', 'all time'))));
  if (!top.length) topCard.appendChild(notice(T('Noch nichts gelesen.', 'Nothing read yet.')));
  else {
    const mx = top[0].seconds || 1;
    topCard.appendChild(h('div.term-bars', top.map((t) => barRow({
      lead: cover(t.book, ctx.api, 'term-cov-xs'),
      label: t.book.title || '?', sub: t.book.author || '',
      frac: t.seconds / mx, value: time(t.seconds),
      onclick: () => { sfx.click(); s.goSection('catalog', { book: t.book.id }); },
    }))));
  }
  const comp = deps.map((d) => ({ name: d.name, n: d.count ?? d.shelves?.reduce((a, x) => a + x.bookIds.length, 0) ?? 0 })).sort((a, b) => b.n - a.n).slice(0, 12);
  const deptCard = h('section.term-card', h('div.term-card-head', h('h3.term-card-h', T('Bestand nach Abteilung', 'Collection by department'))));
  if (!comp.length) deptCard.appendChild(notice(T('Keine Bücher gefunden.', 'No books found.')));
  else {
    const mx = comp[0].n || 1;
    deptCard.appendChild(h('div.term-bars', comp.map((c) => barRow({ label: c.name, frac: c.n / mx, value: String(c.n),
      onclick: () => { sfx.click(); s.goSection('catalog', { dept: c.name }); } }))));
  }
  el.appendChild(h('div.term-two', topCard, deptCard));

  const fm = {}; for (const b of books) fm[b.format || '?'] = (fm[b.format || '?'] || 0) + 1;
  const fmts = Object.entries(fm).sort((a, b) => b[1] - a[1]);
  if (fmts.length) {
    const mx = fmts[0][1] || 1;
    el.appendChild(h('section.term-card', h('div.term-card-head', h('h3.term-card-h', T('Formate', 'Formats'))),
      h('div.term-bars.term-bars-compact', fmts.map(([f, n]) => barRow({ label: String(f).toUpperCase(), frac: n / mx, value: String(n),
        onclick: f !== '?' ? () => { sfx.click(); s.goSection('catalog', { fmt: f }); } : null })))));
  }

  s.setHints([['↑↓', T('blättern', 'scroll')], ['←→', T('Zeitraum', 'range')], ['Esc', T('zurück', 'back')]]);
  return {
    navigate(p) { const r = RANGES.includes(+p.range) ? +p.range : 30; if (r !== range) setRange(r, { record: false }); return true; },
    onKey(e) {
      if (isEditable(e.target)) return false;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const i = RANGES.indexOf(range) + (e.key === 'ArrowRight' ? 1 : -1); if (RANGES[i]) setRange(RANGES[i]); return true; }
      if (e.key === 'ArrowDown' || e.key === 'PageDown') { root.scrollBy({ top: e.key === 'PageDown' ? 400 : 90, behavior: 'smooth' }); return true; }
      if (e.key === 'ArrowUp' || e.key === 'PageUp') { root.scrollBy({ top: e.key === 'PageUp' ? -400 : -90, behavior: 'smooth' }); return true; }
      return false;
    },
  };
}

/**
 * Columns from one baseline with hairline gridlines at 0, half and the top of a clean scale; every column is a
 * focusable hit area (wider than the bar) that shows its value in a tooltip. items: [{ value, label, tip, strong }]
 */
function columnChart(items, { unit = '', compact = false, aria = '' } = {}) {
  const max = niceMax(Math.max(1, ...items.map((i) => i.value)));
  const tip = h('div.term-tip', { role: 'status' });
  const grid = h('div.term-colchart-grid', [max, max / 2, 0].map((v) => h('div.term-gridline', { style: { bottom: `${(v / max) * 100}%` } }, h('span.term-gridlabel', `${Math.round(v)}${v === max && unit ? ' ' + unit : ''}`))));
  const colsEl = h('div.term-colchart-cols');
  const show = (col, it) => {
    tip.textContent = it.tip;
    tip.classList.add('on');
    // above the bar itself, so the tip covers neither the neighbours' tops nor the text over the chart
    const r = col.getBoundingClientRect(), pr = colsEl.getBoundingClientRect();
    const bar = col.firstElementChild?.getBoundingClientRect();
    tip.style.left = `${r.left - pr.left + r.width / 2}px`;
    tip.style.top = `${Math.max(0, (bar && bar.height ? bar.top : r.bottom) - pr.top) - 6}px`;
  };
  const hide = () => tip.classList.remove('on');
  items.forEach((it) => {
    const hgt = it.value ? Math.max(2, (it.value / max) * 100) : 0;
    const col = h('div.term-col', { tabindex: -1, 'aria-label': it.tip, class: it.strong ? 'strong' : '' },
      h('div.term-col-bar', { style: { height: hgt + '%' }, class: it.value ? '' : 'zero' }));
    col.addEventListener('pointerenter', () => show(col, it));
    col.addEventListener('pointerleave', hide);
    col.addEventListener('focus', () => show(col, it));
    col.addEventListener('blur', hide);
    colsEl.appendChild(col);
  });
  const xs = h('div.term-colchart-x', items.map((it) => h('span', { class: it.strong ? 'strong' : '' }, it.label)));
  return h('div.term-colchart' + (compact ? '.compact' : ''), { role: 'img', 'aria-label': aria },
    h('div.term-colchart-plot', grid, colsEl, tip), xs);
}

/** One horizontal bar with its label in front and the value at the tip. */
function barRow({ lead = null, label, sub = '', frac, value, onclick = null }) {
  const f = Math.max(0, Math.min(1, frac || 0));
  const cls = lead ? 'has-lead' : '';
  return h(onclick ? 'button.term-hbar.link' : 'div.term-hbar', onclick ? { type: 'button', tabindex: -1, onclick, title: label, class: cls } : { title: label, class: cls },
    lead,
    h('span.term-hbar-label', h('span.term-hbar-name', label), sub ? h('span.term-hbar-sub', sub) : null),
    h('span.term-hbar-track', h('i', { style: { width: (f * 100).toFixed(1) + '%' } })),
    h('span.term-hbar-val', value));
}

/**
 * The reading goal of the year (Einstellungen → Bücherordner → Regale) and the books read in it, the newest first; without
 * a goal the number of books read.
 */
function goalCard(st, books, s, streak, readToday) {
  const { ctx, sfx } = s;
  const g = st.goal || { year: new Date().getFullYear(), count: 0, target: 0, ids: [] };
  const head = g.target ? T('Leseziel {y}', 'Reading goal {y}', { y: g.year }) : T('Gelesen in {y}', 'Read in {y}', { y: g.year });
  const streakText = streak ? (streak === 1 ? T('1 Tag in Folge', '1 day in a row') : T('{n} Tage in Folge', '{n} days in a row', { n: streak })) + (readToday ? '' : ' · ' + T('heute noch keine 5 Minuten', 'not yet 5 minutes today')) : T('Noch keine Lesesträhne', 'No reading streak yet');
  const big = g.target ? T('{n} von {g} Büchern', '{n} of {g} books', { n: g.count, g: g.target }) : Tn(g.count, ['1 Buch', '1 book'], ['{n} Bücher', '{n} books']);
  // ahead of or behind the goal, measured by the share of the year gone by
  let plan = null;
  if (g.target) {
    const now = new Date(), start = new Date(g.year, 0, 1), end = new Date(g.year + 1, 0, 1);
    const due = g.target * Math.min(1, Math.max(0, (now - start) / (end - start)));
    const d = Math.round(g.count - due);
    plan = g.count >= g.target ? T('Ziel erreicht', 'Goal reached')
      : d === 0 ? T('im Zeitplan', 'on schedule')
        : d > 0 ? Tn(d, ['1 Buch vor dem Zeitplan', '1 book ahead of schedule'], ['{n} Bücher vor dem Zeitplan', '{n} books ahead of schedule'])
          : Tn(-d, ['1 Buch hinter dem Zeitplan', '1 book behind schedule'], ['{n} Bücher hinter dem Zeitplan', '{n} books behind schedule']);
  }
  const card = h('section.term-card.term-goal',
    h('div.term-card-head', h('h3.term-card-h', head), h('span.spacer'), h('span.term-card-note', T('ein Buch gilt ab 97 % als gelesen', 'a book counts as read from 97 %'))),
    h('div.term-goal-row',
      h('div.term-goal-big', big),
      g.target ? h('div.term-goal-meter', meter(g.count / g.target)) : null,
      h('div.term-goal-sub', [plan, streakText].filter(Boolean).join(' · '))));
  if (!g.target) card.appendChild(notice(T('Ein Leseziel lässt sich unter Einstellungen → Bücherordner festlegen.', 'A reading goal can be set in Settings → Book folders.')));
  const read = (g.ids || []).map((id) => books.find((b) => b.id === id)).filter(Boolean).slice(0, 16);
  if (read.length) {
    card.appendChild(h('div.term-goal-covers', read.map((b) => h('button.term-goal-book', { type: 'button', tabindex: -1, title: b.title || '',
      onclick: () => { sfx.click(); s.goSection('catalog', { book: b.id }); } }, cover(b, ctx.api, 'term-cov-s')))));
  }
  return card;
}
