// The sections of the Mediathek panel: Start, Suche, Sender (grid, channel page, programme A to Z),
// Live-TV, Merkliste, Weiterschauen, Downloads and plain result lists ("Alle anzeigen").
// Every view is { el, dispose(), onKey?(e) }; env = { store, cards, open(route), show(item), playLive(ch),
// toast(msg), ctx }.
// The English-language sources (0.7) stand next to the German broadcasters: on Start, in the Sender grid, in Live-TV
// and in the search the sources of the interface language come first, the others follow below (search: a switch).
import { h, clear } from '../../core/dom.js';
import { tr, i18n } from '../../core/i18n.js';
import { icon } from './icons.js';
import { thumbUrl } from './cards.js';
import { channelName, channelColor, channelOf, channelLong, isEnglish, formatBytes, formatSpeed, formatWhen, formatDuration, qualityName, errText } from './format.js';

const T = (de, en, vars) => tr({ de, en }, vars);
const num = (n) => Number(n || 0).toLocaleString(i18n.lang === 'en' ? 'en-GB' : 'de-DE');

/** The rows of the start page. `channel` rows use the channel's colour for their heading mark. */
const START_ROWS = [
  { id: 'latest', title: () => T('Neueste Sendungen', 'Latest programmes'), sub: () => T('Aus allen Mediatheken, neueste zuerst', 'From all Mediatheken, newest first'), query: { durationMin: 300, size: 30 } },
  { id: 'tagesschau', title: () => 'tagesschau', sub: () => 'Das Erste', query: { topic: 'tagesschau', channels: ['ARD'], durationMin: 600, size: 20 } },
  { id: 'heute-journal', title: () => 'heute journal', sub: () => 'ZDF', query: { topic: 'heute journal', channels: ['ZDF'], size: 20 } },
  { id: 'ard', channel: 'ARD', title: () => 'Das Erste', query: { channels: ['ARD'], durationMin: 900, size: 24 } },
  { id: 'zdf', channel: 'ZDF', title: () => 'ZDF', query: { channels: ['ZDF'], durationMin: 900, size: 24 } },
  { id: 'terrax', title: () => 'Terra X', sub: () => T('Geschichte, Natur und Wissenschaft im ZDF', 'History, nature and science on ZDF'), query: { topicsLike: ['Terra X'], channels: ['ZDF', 'ZDFinfo', 'ZDFneo'], durationMin: 1200, size: 24 } },
  { id: 'arte', channel: 'ARTE.DE', title: () => 'arte', query: { channels: ['ARTE.DE'], durationMin: 900, size: 24 } },
  { id: 'arte-doku', channel: 'ARTE.DE', title: () => T('arte Dokumentationen', 'arte documentaries'), query: { channels: ['ARTE.DE'], topicsLike: ['Geschichte', 'Wissenschaft', 'Entdeckung der Welt', 'Dokumentation'], durationMin: 2400, size: 24 } },
  { id: 'tatort', title: () => 'Tatort', query: { topic: 'Tatort', durationMin: 4800, size: 24 } },
  { id: 'filme', title: () => T('Spielfilme', 'Feature films'), query: { topicsLike: ['Filme im Ersten', 'Filme in der ARD', 'Fernsehfilm', 'Spielfilm', 'Kino', 'FilmMittwoch'], durationMin: 4800, size: 24 } },
  { id: '3sat', channel: '3Sat', title: () => '3sat', query: { channels: ['3Sat'], durationMin: 900, size: 24 } },
  { id: 'kinder', title: () => T('Kinder', 'Children'), sub: () => 'KiKA · ZDFtivi', query: { channels: ['KiKA', 'ZDF-tivi'], durationMin: 300, size: 24 } },
  { id: 'kultur', title: () => T('Kultur', 'Culture'), sub: () => 'Kulturzeit · ttt · aspekte · Kulturplatz · arte', query: { topicsLike: ['Kulturzeit', 'titel thesen temperamente', 'aspekte', 'Kulturplatz', 'Kultur und Pop'], durationMin: 600, size: 24 } },
  { id: 'wissen', title: () => T('Wissen', 'Science'), sub: () => 'Quarks · nano · Planet Wissen · scobel · alpha-Centauri', query: { topicsLike: ['Quarks', 'nano', 'Planet Wissen', 'scobel', 'Leschs Kosmos', 'alpha-Centauri', 'Wissen vor acht', 'Terra X Lesch'], durationMin: 600, size: 24 } },
  { id: 'phoenix', channel: 'PHOENIX', title: () => 'phoenix', query: { channels: ['PHOENIX'], durationMin: 900, size: 24 } },
  { id: 'doku', title: () => T('Dokumentationen und Reportagen', 'Documentaries and reports'), query: { topicsLike: ['Doku', 'Dokumentation', 'Dokumentarfilm', 'Reportage'], durationMin: 1800, size: 24 } },
];

/** The rows of the English-language sources (sources/*.js; arte in English comes from MediathekViewWeb). */
const EN_ROWS = [
  { id: 'en-dw', channel: 'DW.EN', title: () => 'DW', sub: () => T('Neueste Videos auf Englisch', 'Latest videos in English'), query: { source: 'dw', size: 24 } },
  { id: 'en-nhk', channel: 'NHK', title: () => 'NHK WORLD-JAPAN', sub: () => T('Dokumentationen, Reisen und Küche aus Japan', 'Documentaries, travel and food from Japan'), query: { source: 'nhk', size: 24 } },
  { id: 'en-arte', channel: 'ARTE.EN', title: () => T('arte auf Englisch', 'arte in English'), query: { source: 'arte-en', durationMin: 600, size: 24 } },
  { id: 'en-dw-docs', channel: 'DW.EN', title: () => T('DW Dokumentationen', 'DW documentaries'), sub: () => T('ab 20 Minuten', '20 minutes and longer'), query: { source: 'dw', topic: 'long', size: 24 } },
  { id: 'en-nasa', channel: 'NASA', title: () => 'NASA', sub: () => T('Neue Videos aus der Raumfahrt', 'New videos from space flight'), query: { source: 'nasa', topic: 'recent', size: 24 } },
  { id: 'en-ted', channel: 'TED', title: () => 'TED Talks', sub: () => T('Vorträge über Wissenschaft, Technik und Gesellschaft', 'Talks on science, technology and society'), query: { source: 'ted', size: 24 } },
  { id: 'en-prelinger', channel: 'IA', title: () => 'Prelinger Archives', sub: () => T('Gemeinfreie Lehr- und Industriefilme im Internet Archive', 'Public-domain educational and industrial films at the Internet Archive'), query: { source: 'archive', topic: 'prelinger', size: 24 } },
  { id: 'en-films', channel: 'IA', title: () => T('Gemeinfreie Spielfilme', 'Public-domain feature films'), sub: () => 'Internet Archive', query: { source: 'archive', topic: 'feature_films', size: 24 } },
  { id: 'en-silent', channel: 'IA', title: () => T('Stummfilme', 'Silent films'), sub: () => 'Internet Archive', query: { source: 'archive', topic: 'silent_films', size: 24 } },
];
/** The English-language channels of the search, in the order of EN_ROWS. */
const EN_SEARCH = ['DW.EN', 'NHK', 'ARTE.EN', 'NASA', 'IA', 'TED'];
const english = () => i18n.lang === 'en';

const MAIN_CHANNELS = ['ARD', 'ZDF', 'ARTE.DE', '3Sat', 'PHOENIX', 'KiKA', 'ZDFinfo', 'ZDFneo'];
const DURATIONS = [
  { id: 'all', label: () => T('Alle Längen', 'Any length') },
  { id: 'short', label: () => T('bis 15 Min.', 'up to 15 min'), max: 900 },
  { id: 'mid', label: () => T('15 bis 60 Min.', '15 to 60 min'), min: 900, max: 3600 },
  { id: 'long', label: () => T('über 60 Min.', 'over 60 min'), min: 3600 },
];
const SORTS = [
  { id: 'new', label: () => T('Neueste zuerst', 'Newest first') },
  { id: 'relevance', label: () => T('Passendste zuerst', 'Best match first') },
  { id: 'long', label: () => T('Längste zuerst', 'Longest first') },
  { id: 'short', label: () => T('Kürzeste zuerst', 'Shortest first') },
  { id: 'old', label: () => T('Älteste zuerst', 'Oldest first') },
];
const LIVE_GROUPS = [
  { title: () => T('Hauptprogramme', 'Main channels'), ids: ['das_erste', 'zdf', 'arte', 'dreisat', 'phoenix', 'kika'] },
  { title: () => T('Nachrichten und Spartenkanäle', 'News and special-interest channels'), ids: ['tagesschau24', 'zdf_info', 'zdf_neo', 'one', 'ard_alpha'] },
  { title: () => T('Dritte Programme', 'Regional channels'), group: 'regional' },
  { title: () => T('International', 'International'), group: 'intl' },
];
/** The English-language news channels: first with the English interface, last with the German one. */
const LIVE_EN = { title: () => T('Englischsprachige Nachrichtensender', 'English-language news channels'), group: 'en', english: true };

const disposeAll = (nodes) => { for (const n of nodes) n?._dispose?.(); };
function viewHead(title, sub, extra) {
  return h('header.mt-view-head', h('div', h('h1.mt-view-title', title), sub ? h('p.mt-view-sub', sub) : null), extra || null);
}
function emptyState(ico, text, action) {
  return h('div.mt-empty', icon(ico, 'big'), h('p', text), action || null);
}

// ---- Start ---------------------------------------------------------------------------------------------
export function startView(env) {
  const { store, cards, open } = env;
  const rows = [];
  const cont = cards.row({
    title: T('Weiterschauen', 'Continue watching'), lazy: false, empty: null,
    load: async () => (await store.continueList()).map((e) => e.item).filter(Boolean),
    onAll: () => open({ kind: 'continue' }),
  });
  rows.push(cont);
  const kids = [cont];
  const addRows = (list, opts = {}) => {
    for (const r of list) {
      const row = cards.row({
        title: r.channel ? h('span.mt-row-mark', { style: '--ch:' + (channelColor(r.channel)) }, r.title()) : r.title(),
        subtitle: r.sub ? r.sub() : null,
        lazy: rows.length > 3,
        empty: opts.empty,
        load: async () => (await store.query(r.query)).items,
        onAll: () => open({ kind: 'list', title: r.title(), sub: r.sub ? r.sub() : null, query: r.query }),
      });
      row.dataset.row = r.id;
      rows.push(row);
      kids.push(row);
    }
  };
  // the sources of the interface language first, the others below their own heading
  const head = (text, lang) => h('h2.mt-group-title.mt-start-group', { dataset: { lang } }, text);
  if (english()) {
    addRows(EN_ROWS);
    kids.push(head(T('Deutsche öffentlich-rechtliche Sender', 'German public broadcasters'), 'de'));
    addRows(START_ROWS);
  } else {
    addRows(START_ROWS);
    kids.push(head(T('Englischsprachige Mediatheken', 'English-language media libraries'), 'en'));
    addRows(EN_ROWS, { empty: null });
  }
  const el = h('div.mt-view.mt-start', { dataset: { first: english() ? 'en' : 'de' } }, kids);
  return { el, dispose: () => disposeAll(rows) };
}

// ---- Suche ---------------------------------------------------------------------------------------------
export function searchView(env, params = {}) {
  const { store, cards } = env;
  // scope: 'de' the German broadcasters (MediathekViewWeb), 'en' the English-language sources (one cursor per source)
  const st = { text: params.text || '', scope: params.scope === 'en' || params.scope === 'de' ? params.scope : (english() ? 'en' : 'de'), cursor: null,
    channels: new Set(params.channels || []), duration: params.duration || 'all', sort: params.sort || 'new', inDescription: false, variants: false, offset: 0, items: [], total: 0, relation: 'eq', hasMore: false, loading: false, token: 0, error: null, moreChannels: false };
  let timer = null;
  const input = h('input.input.mt-search-input', { type: 'search', placeholder: T('Sendung, Thema oder Titel suchen', 'Search for a programme, topic or title'), value: st.text, autocomplete: 'off', spellcheck: false,
    oninput: () => { st.text = input.value; clearTimeout(timer); timer = setTimeout(() => run(), 380); },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); run(); } } });
  const chipsEl = h('div.mt-chips');
  const scopeEl = h('div.mt-seg.mt-scope', { role: 'radiogroup', 'aria-label': T('Sprache der Mediatheken', 'Language of the media libraries') });
  const hint = h('p.mt-hint');
  const durEl = h('div.mt-seg', { role: 'radiogroup', 'aria-label': T('Länge', 'Length') });
  const sortSel = h('select.input.mt-sort', { 'aria-label': T('Sortierung', 'Sort order'), onchange: () => { st.sort = sortSel.value; run(); } }, SORTS.map((s) => h('option', { value: s.id, selected: s.id === st.sort }, s.label())));
  const descBox = h('input', { type: 'checkbox', onchange: () => { st.inDescription = descBox.checked; run(); } });
  const varBox = h('input', { type: 'checkbox', onchange: () => { st.variants = varBox.checked; run(); } });
  const status = h('div.mt-results-status');
  const grid = h('div.mt-grid');
  const moreBtn = h('button.btn.mt-loadmore.hidden', { onclick: () => loadMore() }, T('Weitere Treffer laden', 'Load more results'));
  const sentinel = h('div.mt-sentinel');
  const el = h('div.mt-view.mt-search',
    h('div.mt-searchbar', icon('search'), input, h('button.btn.primary', { onclick: () => run() }, T('Suchen', 'Search'))),
    h('div.mt-scope-row', scopeEl, hint),
    h('div.mt-filters', chipsEl, h('div.mt-filter-row', durEl, h('label.mt-check.mt-de-only', descBox, T('Auch Beschreibungen', 'Descriptions too')), h('label.mt-check.mt-de-only', varBox, T('Barrierefreie Fassungen', 'Accessible versions')), h('span.spacer'), sortSel)),
    status, grid, moreBtn, sentinel);

  function renderScope() {
    clear(scopeEl);
    const opts = [['de', T('Deutsche Sender', 'German broadcasters')], ['en', T('Englischsprachig', 'English-language')]];
    if (english()) opts.reverse();
    for (const [id, label] of opts) scopeEl.appendChild(h('button.mt-seg-item', { class: st.scope === id ? 'on' : '', role: 'radio', 'aria-checked': String(st.scope === id), dataset: { scope: id }, onclick: () => { if (st.scope === id) return; st.scope = id; st.channels.clear(); st.moreChannels = false; renderScope(); renderChips(); run(); } }, label));
    hint.textContent = st.scope === 'en'
      ? T('Sucht in DW, NHK WORLD, arte, NASA, im Internet Archive und bei TED.', 'Searches DW, NHK WORLD, arte, NASA, the Internet Archive and TED.')
      : T('Mit !arte grenzt du auf einen Sender ein, mit #Tatort auf eine Sendung, mit >60 auf Filme ab 60 Minuten.', 'Use !arte to limit to a channel, #Tatort for a programme, >60 for films from 60 minutes.');
    el.classList.toggle('scope-en', st.scope === 'en');
  }
  function renderChips() {
    clear(chipsEl);
    if (st.scope === 'en') {
      const list = EN_SEARCH.map((id) => store.state.channels.find((c) => c.id === id)).filter(Boolean);
      chipsEl.appendChild(h('button.mt-chip', { class: st.channels.size ? '' : 'on', onclick: () => { st.channels.clear(); renderChips(); run(); } }, T('Alle Quellen', 'All sources')));
      for (const c of list) {
        chipsEl.appendChild(h('button.mt-chip', { class: st.channels.has(c.id) ? 'on' : '', style: '--ch:' + (c.color), 'aria-pressed': String(st.channels.has(c.id)), dataset: { channel: c.id },
          onclick: () => { if (st.channels.has(c.id)) st.channels.delete(c.id); else st.channels.add(c.id); renderChips(); run(); } }, h('i'), c.name));
      }
      return;
    }
    const all = store.state.channels.filter((c) => c.de);
    const list = st.moreChannels ? all : all.filter((c) => MAIN_CHANNELS.includes(c.id) || st.channels.has(c.id));
    chipsEl.appendChild(h('button.mt-chip', { class: st.channels.size ? '' : 'on', onclick: () => { st.channels.clear(); renderChips(); run(); } }, T('Alle Sender', 'All channels')));
    for (const c of list) {
      chipsEl.appendChild(h('button.mt-chip', { class: st.channels.has(c.id) ? 'on' : '', style: '--ch:' + (c.color), 'aria-pressed': String(st.channels.has(c.id)),
        onclick: () => { if (st.channels.has(c.id)) st.channels.delete(c.id); else st.channels.add(c.id); renderChips(); run(); } }, h('i'), c.name));
    }
    chipsEl.appendChild(h('button.mt-chip.more', { onclick: () => { st.moreChannels = !st.moreChannels; renderChips(); } }, st.moreChannels ? T('Weniger Sender', 'Fewer channels') : T('Weitere Sender', 'More channels')));
  }
  function renderDurations() {
    clear(durEl);
    for (const d of DURATIONS) durEl.appendChild(h('button.mt-seg-item', { class: st.duration === d.id ? 'on' : '', role: 'radio', 'aria-checked': String(st.duration === d.id), onclick: () => { st.duration = d.id; renderDurations(); run(); } }, d.label()));
  }
  const opts = () => {
    const d = DURATIONS.find((x) => x.id === st.duration) || DURATIONS[0];
    if (st.scope === 'en') {
      const picked = (st.channels.size ? [...st.channels] : EN_SEARCH).map((id) => channelOf(id).source).filter(Boolean);
      return { text: st.text.trim(), sources: picked, durationMin: d.min, durationMax: d.max, sort: st.sort, size: 48 };
    }
    return { text: st.text.trim(), channels: [...st.channels], durationMin: d.min, durationMax: d.max, sort: st.sort, inDescription: st.inDescription, variants: st.variants, size: 48 };
  };
  function renderStatus() {
    clear(status);
    if (st.error) { status.append(h('span.err', st.error), ' ', h('button.linkish', { onclick: () => run() }, T('Erneut versuchen', 'Try again'))); return; }
    if (st.loading && !st.items.length) { status.textContent = T('Suche läuft', 'Searching'); return; }
    if (!st.items.length) return;
    const what = st.text.trim() ? T('Treffer', 'results') : T('Sendungen', 'programmes');
    status.textContent = st.relation === 'gte' ? T('Mehr als {n} {w}', 'More than {n} {w}', { n: num(st.total), w: what }) : `${num(st.total)} ${what}`;
  }
  async function run() {
    const my = ++st.token;
    st.offset = 0; st.loading = true; st.error = null;
    clear(grid); grid.append(...cards.skeletons(12));
    moreBtn.classList.add('hidden');
    renderStatus();
    try {
      const r = await store.query(opts());
      if (my !== st.token) return;
      st.items = r.items; st.total = r.total; st.relation = r.totalRelation; st.hasMore = r.hasMore; st.offset = r.received; st.cursor = r.cursor || null;
      clear(grid);
      if (!r.items.length) grid.appendChild(emptyState('search', st.text.trim() ? T('Dazu gibt es gerade nichts in den Mediatheken. Andere Wörter oder weniger Filter helfen.', 'Nothing in the Mediatheken right now. Other words or fewer filters may help.') : T('Keine Sendungen mit diesen Filtern.', 'No programmes with these filters.')));
      for (const it of r.items) grid.appendChild(cards.card(it));
    } catch (e) { if (my === st.token) { st.error = errText(e); clear(grid); } }
    finally { if (my === st.token) { st.loading = false; moreBtn.classList.toggle('hidden', !st.hasMore); renderStatus(); } }
  }
  async function loadMore() {
    if (st.loading || !st.hasMore) return;
    const my = st.token;
    st.loading = true; moreBtn.disabled = true;
    try {
      const r = await store.query({ ...opts(), offset: st.offset, cursor: st.cursor || undefined });
      if (my !== st.token) return;
      const known = new Set(st.items.map((x) => x.id));
      const fresh = r.items.filter((x) => !known.has(x.id));
      st.items.push(...fresh); st.hasMore = r.hasMore; st.offset += r.received; st.cursor = r.cursor || null;
      for (const it of fresh) grid.appendChild(cards.card(it));
    } catch (e) { env.toast(errText(e)); }
    finally { st.loading = false; moreBtn.disabled = false; moreBtn.classList.toggle('hidden', !st.hasMore); }
  }
  const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting) && st.items.length) loadMore(); }, { rootMargin: '600px 0px' });
  io.observe(sentinel);
  renderScope(); renderChips(); renderDurations(); run();
  setTimeout(() => input.focus({ preventScroll: true }), 60);
  return { el, input, dispose() { clearTimeout(timer); io.disconnect(); st.token++; } };
}

// ---- Result list ("Alle anzeigen", programme pages) ------------------------------------------------------
export function listView(env, { title, sub, query, back, compact = false }) {
  const { store, cards } = env;
  const grid = h('div.mt-grid', cards.skeletons(12));
  const moreBtn = h('button.btn.mt-loadmore.hidden', { onclick: () => more() }, T('Weitere laden', 'Load more'));
  const status = h('div.mt-results-status');
  const sentinel = h('div.mt-sentinel');
  const el = h('div.mt-view.mt-list', { class: compact ? 'compact' : '' }, back ? h('button.btn.small.ghost.mt-crumb', { onclick: back.go }, icon('left'), h('span', back.label)) : null, compact ? null : viewHead(title, sub), status, grid, moreBtn, sentinel);
  let offset = 0, hasMore = false, busy = false, alive = true;
  const ids = new Set();
  async function more(first) {
    if (busy || (!first && !hasMore)) return;
    busy = true; moreBtn.disabled = true;
    try {
      const r = await store.query({ ...query, size: 48, offset });
      if (!alive) return;
      if (first) { clear(grid); status.textContent = r.total ? (r.totalRelation === 'gte' ? T('Mehr als {n} Sendungen', 'More than {n} programmes', { n: num(r.total) }) : T('{n} Sendungen', '{n} programmes', { n: num(r.total) })) : ''; }
      if (r.cursor) query = { ...query, cursor: r.cursor };
      offset += r.received; hasMore = r.hasMore;
      for (const it of r.items) if (!ids.has(it.id)) { ids.add(it.id); grid.appendChild(cards.card(it)); }
      if (first && !r.items.length) grid.appendChild(emptyState('film', T('Hier ist gerade nichts zu sehen.', 'Nothing to see here right now.')));
    } catch (e) { if (first) { clear(grid); grid.appendChild(emptyState('info', errText(e), h('button.btn', { onclick: () => more(true) }, T('Erneut versuchen', 'Try again')))); } else env.toast(errText(e)); }
    finally { busy = false; moreBtn.disabled = false; moreBtn.classList.toggle('hidden', !hasMore); }
  }
  const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting) && offset) more(); }, { rootMargin: '600px 0px' });
  io.observe(sentinel);
  more(true);
  return { el, dispose() { alive = false; io.disconnect(); } };
}

// ---- Sender ------------------------------------------------------------------------------------------------
export function channelsView(env) {
  const { store, cards, open } = env;
  const el = h('div.mt-view.mt-channels', viewHead(T('Sender', 'Channels'), T('Die öffentlich-rechtlichen Mediatheken aus MediathekViewWeb und englischsprachige Quellen', 'The German public broadcasters from MediathekViewWeb and English-language sources')));
  const groups = store.state.groups.slice().sort((a, b) => (english() ? (b.lang === 'en') - (a.lang === 'en') : (a.lang === 'en') - (b.lang === 'en')));
  for (const g of groups) {
    const list = store.state.channels.filter((c) => c.group === g.id);
    if (!list.length) continue;
    el.appendChild(h('section.mt-chan-group', { dataset: { group: g.id } }, h('h2.mt-group-title', tr(g.label)), h('div.mt-chan-grid', list.map((c) => cards.channelTile(c, () => open({ kind: 'channel', channel: c.id }))))));
  }
  return { el, dispose() {} };
}

/** One channel: its newest programmes grouped by Sendung, and all Sendungen from A to Z. A channel of an English-language
 *  source shows its newest films and its topics (categories, programmes, collections) instead. */
export function channelView(env, { channel, tab = 'new' }) {
  const { store, cards, open } = env;
  const c = channelOf(channel);
  if (c.source && c.source !== 'arte-en') return sourceView(env, c, tab);
  const body = h('div.mt-chan-body');
  const tabs = h('div.tabs.mt-tabs');
  // the live streams of this broadcaster (NDR, MDR, BR … have several regional ones)
  const liveBox = h('div.mt-chan-lives');
  store.live().then((list) => {
    const mine = (list || []).filter((l) => l.mvw === channel).slice(0, 4);
    for (const l of mine) liveBox.appendChild(h('button.btn.small.mt-chan-live', { onclick: () => env.playLive(l) }, icon('live'), h('span', mine.length > 1 ? l.name : T('Live ansehen', 'Watch live'))));
  }).catch(() => {});
  const head = h('header.mt-chan-head', { style: '--ch:' + (c.color) },
    h('div.mt-chan-badge', c.name),
    h('div.mt-chan-headtext', h('h1.mt-view-title', channelLong(c)), c.note ? h('p.mt-view-sub', tr(c.note)) : null),
    h('span.spacer'), liveBox);
  const el = h('div.mt-view.mt-channel', h('button.btn.small.ghost.mt-crumb', { onclick: () => open({ kind: 'channels' }) }, icon('left'), h('span', T('Alle Sender', 'All channels'))), head, tabs, body);
  let rows = [], alive = true, current = tab;

  function renderTabs() {
    clear(tabs);
    for (const [id, label] of [['new', T('Neu', 'New')], ['az', T('Sendungen von A bis Z', 'Programmes A to Z')]]) {
      tabs.appendChild(h('button.tab', { class: current === id ? 'active' : '', onclick: () => { current = id; renderTabs(); render(); } }, label));
    }
  }
  async function renderNew() {
    body.appendChild(h('div.mt-row-empty', cards.skeletons(4)));
    try {
      const r = await store.query({ channels: [channel], size: 200, durationMin: 120 });
      if (!alive || current !== 'new') return;
      clear(body);
      if (!r.items.length) { body.appendChild(emptyState('film', T('Von diesem Sender gibt es gerade keine Sendungen.', 'This channel has no programmes right now.'))); return; }
      const newest = cards.row({ title: T('Neueste Sendungen', 'Latest programmes'), lazy: false, load: async () => r.items.slice(0, 24), onAll: () => open({ kind: 'list', title: channelLong(c), query: { channels: [channel] }, back: { label: c.name, route: { kind: 'channel', channel } } }) });
      rows = [newest];
      const byTopic = new Map();
      for (const it of r.items) { if (!it.topic) continue; if (!byTopic.has(it.topic)) byTopic.set(it.topic, []); byTopic.get(it.topic).push(it); }
      const topics = [...byTopic.entries()].filter(([, list]) => list.length >= 2).slice(0, 14);
      for (const [topic, list] of topics) {
        rows.push(cards.row({ title: topic, subtitle: T('{n} neue Folgen', '{n} new episodes', { n: list.length }), lazy: false, load: async () => list, onAll: () => open({ kind: 'topic', topic, channel }) }));
      }
      body.append(...rows);
    } catch (e) { if (alive) { clear(body); body.appendChild(emptyState('info', errText(e))); } }
  }
  async function renderAz() {
    const filter = h('input.input.mt-az-filter', { type: 'search', placeholder: T('Sendung finden', 'Find a programme'), oninput: () => draw() });
    const list = h('div.mt-az');
    body.append(filter, list);
    let topics = [];
    list.appendChild(h('p.mt-hint', T('Die Liste wird geladen.', 'Loading the list.')));
    try { topics = await store.topics(channel); } catch (e) { clear(list); list.appendChild(emptyState('info', errText(e))); return; }
    if (!alive || current !== 'az') return;
    function draw() {
      clear(list);
      const q = filter.value.trim().toLowerCase();
      const shown = topics.filter((t) => !q || t.toLowerCase().includes(q));
      const groups = new Map();
      for (const t of shown) { const k = (t[0] || '#').toUpperCase().replace(/[^A-ZÄÖÜ]/, '#'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
      for (const [k, ts] of groups) list.appendChild(h('section.mt-az-group', h('h3', k), h('div.mt-az-items', ts.map((t) => h('button.mt-az-item', { onclick: () => open({ kind: 'topic', topic: t, channel }) }, t)))));
      if (!shown.length) list.appendChild(h('p.mt-hint', T('Keine Sendung mit diesem Namen.', 'No programme with this name.')));
    }
    draw();
  }
  function render() {
    disposeAll(rows); rows = [];
    clear(body);
    if (current === 'az') renderAz(); else renderNew();
  }
  renderTabs(); render();
  return { el, dispose() { alive = false; disposeAll(rows); } };
}

/** The page of an English-language source: "Neu" (its newest films as a grid) and "Themen" (its topics as tiles). */
function sourceView(env, c, tab = 'new') {
  const { store, cards, open } = env;
  const body = h('div.mt-chan-body');
  const tabs = h('div.tabs.mt-tabs');
  const liveBox = h('div.mt-chan-lives');
  store.live().then((list) => {
    for (const l of (list || []).filter((x) => x.mvw === c.id).slice(0, 2)) liveBox.appendChild(h('button.btn.small.mt-chan-live', { onclick: () => env.playLive(l) }, icon('live'), h('span', T('Live ansehen', 'Watch live'))));
  }).catch(() => {});
  const head = h('header.mt-chan-head', { style: '--ch:' + c.color },
    h('div.mt-chan-badge', c.name),
    h('div.mt-chan-headtext', h('h1.mt-view-title', channelLong(c)), c.note ? h('p.mt-view-sub', tr(c.note)) : null),
    h('span.spacer'), liveBox);
  const el = h('div.mt-view.mt-channel.mt-source', { dataset: { source: c.source } }, h('button.btn.small.ghost.mt-crumb', { onclick: () => open({ kind: 'channels' }) }, icon('left'), h('span', T('Alle Sender', 'All channels'))), head, tabs, body);
  let current = tab, alive = true, inner = null, topics = null;
  store.sourceTopics(c.source).then((t) => { topics = t || []; if (alive) renderTabs(); });
  function renderTabs() {
    clear(tabs);
    const list = [['new', T('Neu', 'New')]];
    if (topics && topics.length) list.push(['topics', T('Themen', 'Topics')]);
    for (const [id, label] of list) tabs.appendChild(h('button.tab', { class: current === id ? 'active' : '', dataset: { tab: id }, onclick: () => { current = id; renderTabs(); render(); } }, label));
  }
  function render() {
    inner?.dispose?.();
    clear(body);
    if (current === 'topics' && topics) {
      body.appendChild(h('div.mt-topic-grid', topics.map((t) => h('button.mt-topic', { style: '--ch:' + c.color, dataset: { topic: t.id },
        onclick: () => open({ kind: 'list', title: tr(t.title), sub: channelLong(c), query: { source: c.source, topic: t.id }, back: { label: c.name, route: { kind: 'channel', channel: c.id } } }) },
      h('span.mt-topic-title', tr(t.title)), t.sub ? h('span.mt-topic-sub', tr(t.sub)) : t.count ? h('span.mt-topic-sub', T('{n} Folgen', '{n} episodes', { n: t.count })) : null))));
      return;
    }
    inner = listView(env, { title: T('Neueste Filme', 'Latest films'), query: { source: c.source }, compact: true });
    body.appendChild(inner.el);
  }
  renderTabs(); render();
  return { el, dispose() { alive = false; inner?.dispose?.(); } };
}

// ---- Live-TV -------------------------------------------------------------------------------------------------
export function liveView(env) {
  const { store, cards } = env;
  const el = h('div.mt-view.mt-livetv', viewHead(T('Live-TV', 'Live TV'), T('Die Programme der öffentlich-rechtlichen Sender, live aus dem Netz', 'The public broadcasters’ channels, live from the web')));
  const body = h('div', cards.skeletons(8));
  el.appendChild(body);
  const tiles = new Map();
  let timer = null, alive = true;
  (async () => {
    let list;
    try { list = await store.live(); } catch (e) { clear(body); body.appendChild(emptyState('info', errText(e))); return; }
    if (!alive) return;
    clear(body);
    const used = new Set();
    // the English news channels first with the English interface, last with the German one
    for (const g of english() ? [LIVE_EN, ...LIVE_GROUPS] : [...LIVE_GROUPS, LIVE_EN]) {
      const chans = g.ids ? g.ids.map((id) => list.find((c) => c.id === id)).filter(Boolean) : list.filter((c) => c.group === g.group && !used.has(c.id));
      const rest = g.group === 'intl' ? list.filter((c) => !used.has(c.id) && !chans.includes(c) && c.group !== 'regional' && c.group !== 'en') : [];
      const all = [...chans, ...rest];
      if (!all.length) continue;
      for (const c of all) used.add(c.id);
      body.appendChild(h('section.mt-live-group', { dataset: { group: g.group || 'main' } }, h('h2.mt-group-title', g.title()), h('div.mt-grid.mt-live-grid', all.map((c) => { const t = cards.liveCard(c, null); tiles.set(c.id, t); return t; }))));
    }
    refreshNow();
    timer = setInterval(refreshNow, 60000);
  })();
  async function refreshNow() {
    const now = await store.liveNow([...tiles.keys()]);
    if (!alive) return;
    for (const [id, t] of tiles) t._setNow(now[id] || null);
    env.onNow?.(now);
  }
  return { el, dispose() { alive = false; clearInterval(timer); } };
}

// ---- Merkliste / Weiterschauen ---------------------------------------------------------------------------------
export function favoritesView(env) {
  const { store, cards } = env;
  const grid = h('div.mt-grid');
  const el = h('div.mt-view.mt-favs', viewHead(T('Merkliste', 'Watchlist'), T('Filme, die du dir für später aufgehoben hast', 'Films you saved for later')), grid);
  function draw() {
    clear(grid);
    const list = store.state.favorites;
    if (!list.length) { grid.appendChild(emptyState('bookmark', T('Noch nichts gemerkt. In der Ansicht eines Films setzt »Merken« ihn auf diese Liste.', 'Nothing saved yet. “Save” in a film’s view puts it on this list.'))); return; }
    for (const it of list) grid.appendChild(cards.card(it));
  }
  store.loadFavorites().then(draw).catch(() => draw());
  draw();
  const off = store.on((topic) => { if (topic === 'favorites') draw(); });
  return { el, dispose: off };
}

export function continueView(env) {
  const { store, cards } = env;
  const grid = h('div.mt-grid');
  const el = h('div.mt-view.mt-continue', viewHead(T('Weiterschauen', 'Continue watching'), T('Angefangene Filme, zuletzt gesehene zuerst', 'Films you started, most recent first')), grid);
  async function draw() {
    const list = await store.continueList();
    clear(grid);
    if (!list.length) { grid.appendChild(emptyState('resume', T('Hier erscheinen Filme, die du angefangen und nicht zu Ende gesehen hast.', 'Films you started and did not finish appear here.'))); return; }
    for (const e of list) {
      if (!e.item) continue;
      const card = cards.card(e.item);
      card.appendChild(h('button.mt-card-x', { title: T('Aus der Liste nehmen', 'Remove from the list'), onclick: async (ev) => { ev.stopPropagation(); await store.forget(e.id); draw(); } }, icon('close')));
      grid.appendChild(card);
    }
  }
  draw();
  return { el, dispose() {} };
}

// ---- Downloads ----------------------------------------------------------------------------------------------------
export function downloadsView(env) {
  const { store, ctx } = env;
  const folderPath = h('span.mt-path');
  const resetBtn = h('button.btn.small.ghost.hidden', { onclick: async () => { await store.resetFolder(); drawFolder(); } }, T('Standardordner', 'Default folder'));
  const folderBar = h('div.mt-folder', icon('folder'), h('div.mt-folder-text', h('span.mt-label', T('Download-Ordner', 'Download folder')), folderPath),
    h('button.btn.small', { onclick: async () => { try { await store.pickFolder(); drawFolder(); } catch (e) { env.toast(errText(e)); } } }, T('Ordner ändern', 'Change folder')), resetBtn);
  const list = h('div.mt-dls');
  const el = h('div.mt-view.mt-downloads', viewHead(T('Downloads', 'Downloads'), T('Heruntergeladene Filme laufen auch ohne Internet', 'Downloaded films play without an internet connection')), folderBar, list);
  async function drawFolder() { const f = await store.folder(); if (f) { folderPath.textContent = f.folder; folderPath.title = f.folder; resetBtn.classList.toggle('hidden', !!f.isDefault); } }
  const rows = new Map();
  function rowFor(d) {
    const it = d.item || {};
    const bar = h('div.mt-dlbar', h('i'));
    const state = h('div.mt-dl-state');
    const acts = h('div.mt-dl-acts');
    const thumb = h('div.mt-dl-thumb.mt-poster', { style: '--ch:' + (channelColor(it.channel)) }, env.cards.typographic(it.channel, it.topic || it.title), env.cards.picture(thumbUrl(it), ''));
    const row = h('article.mt-dl', thumb, h('div.mt-dl-main', h('div.mt-card-meta', h('span.mt-card-channel', channelName(it.channel)), it.timestamp ? h('span', formatWhen(it.timestamp)) : null, it.duration ? h('span', formatDuration(it.duration)) : null),
      h('h3.mt-dl-title', it.title || ''), bar, state), acts);
    row._update = (x) => {
      const q = qualityName(x.quality, x.height);
      const pct = Math.round((x.fraction || 0) * 100);
      bar.firstChild.style.width = pct + '%';
      row.className = 'mt-dl ' + x.status;
      let text;
      if (x.status === 'done') text = T('Fertig · {q} · {s}', 'Done · {q} · {s}', { q, s: formatBytes(x.bytes) || '' });
      else if (x.status === 'running') text = T('{p} % · {b} · {v}', '{p} % · {b} · {v}', { p: pct, b: formatBytes(x.bytes) || '0 MB', v: formatSpeed(x.speed) || T('verbindet', 'connecting') });
      else if (x.status === 'queued') text = T('Wartet auf einen freien Platz', 'Waiting for a free slot');
      else if (x.status === 'paused') text = x.error || T('Angehalten', 'Paused');
      else text = x.error || T('Fehler', 'Error');
      state.textContent = text;
      clear(acts);
      const b = (ico, label, fn, cls = '') => h('button.btn.small' + cls, { onclick: fn }, icon(ico), h('span', label));
      if (x.status === 'done') acts.append(b('play', T('Abspielen', 'Play'), () => env.playDownload(x), '.primary'), b('screen', T('Leinwand', 'Screen'), () => env.playDownload(x, 'screen')));
      if (x.status === 'running' || x.status === 'queued') acts.append(b('pause', T('Anhalten', 'Pause'), () => store.pause(x.id)));
      if (x.status === 'paused' || x.status === 'error') acts.append(b('retry', T('Fortsetzen', 'Resume'), () => store.resume(x.id)));
      acts.append(b('folder', T('Im Ordner zeigen', 'Show in folder'), () => store.reveal(x.id), '.ghost'),
        b('trash', T('Löschen', 'Delete'), async () => { await store.remove(x.id, true); env.toast(T('Download gelöscht', 'Download deleted')); }, '.ghost'));
    };
    row._update(d);
    return row;
  }
  function draw() {
    const all = [...store.state.downloads.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!all.length) { clear(list); rows.clear(); list.appendChild(emptyState('download', T('Noch keine Downloads. In der Ansicht eines Films lädt »Herunterladen« ihn in den Download-Ordner.', 'No downloads yet. “Download” in a film’s view saves it to the download folder.'))); return; }
    const ids = new Set(all.map((d) => d.id));
    for (const [id, r] of rows) if (!ids.has(id)) { r.remove(); rows.delete(id); }
    if (list.querySelector('.mt-empty')) clear(list);
    all.forEach((d, i) => {
      let r = rows.get(d.id);
      if (!r) { r = rowFor(d); rows.set(d.id, r); }
      else r._update(d);
      if (list.children[i] !== r) list.insertBefore(r, list.children[i] || null);
    });
  }
  drawFolder();
  store.loadDownloads().then(draw);
  draw();
  const off = store.on((topic) => { if (topic === 'downloads') draw(); if (topic === 'folder') drawFolder(); });
  return { el, dispose: off };
}
