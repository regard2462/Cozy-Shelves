// Weltkarte: an interactive map of the world (OpenStreetMap's tiles in Leaflet since 0.9.1, osm-view.js) with country
// and city cards from the Natural Earth and Wikidata data of the app, search, Wikipedia summaries (online, in the UI
// language) and Street View in an embedded browser view.
//
//   mount(container, ctx, { country: 'DEU' | city: 'Berlin' | 123 | q: 'Lima' | aim: [x, y] })     panel 'worldmap'
//   (aim: the point of the wall map the crosshair rested on, worldmap-prop.js wallMapAim: its country opens)
//
// Keys: arrows pan, + and - zoom, 0 shows the whole world, / focuses the search, Esc closes the Street View, then
// the card, then the panel. Mouse: drag, wheel, double click; a click opens the card of a country or a city.
// Back and forward (the buttons in the header, Alt+arrows, the mouse's side buttons: onNav) lead through the cards
// shown, inside Street View through its pages.
import { h, clear } from '../../core/dom.js';
import { tr, i18n } from '../../core/i18n.js';
import { loadWorld, fold, flagOf } from './data.js';
import { OsmView } from './osm-view.js';
import { createStreetView } from './streetview.js';
import * as fmt from './format.js';
import { touch, isAndroid } from '../../core/platform.js';
import { isDark, onTheme } from '../../core/theme.js';
import { MODES, modeName, legendOf, densityOf, perHeadOf, continentName } from './map-style.js';

// the view of the map the reader chose last (a convenience of this device)
const MODE_KEY = 'lesesaal.worldmapMode';
const savedMode = () => { try { const m = localStorage.getItem(MODE_KEY); return MODES.includes(m) ? m : 'countries'; } catch { return 'countries'; } };

const CARD_W = 392;

export async function mount(container, ctx, params = {}) {
  const { api, bus } = ctx;
  const T = (de, en, vars) => tr({ de, en }, vars);
  const sfx = (n) => { try { ctx.audio?.sfx?.(n); } catch {} };
  const isDe = () => i18n.lang !== 'en';
  container.classList.add('wm-host');

  // ---- skeleton --------------------------------------------------------------------------------------------------
  const panel = h('div.panel.wm-panel', { tabIndex: -1 });
  const titleEl = h('div.wm-title');
  const search = h('input.input.wm-search', { type: 'search', autocomplete: 'off', spellcheck: false });
  const results = h('div.wm-results', { hidden: true, role: 'listbox' });
  const btnWorld = h('button.btn.small.ghost.wm-worldbtn', { type: 'button', onclick: () => { sfx('click'); view?.fit(); } });
  const btnClose = h('button.btn.small.icon.wm-close', { type: 'button', onclick: () => ctx.close() }, '✕');
  const btnBack = h('button.btn.small.icon.wm-nav-back', { type: 'button', disabled: true, onmousedown: (e) => e.preventDefault(), onclick: () => nav(-1) }, '‹');
  const btnFwd = h('button.btn.small.icon.wm-nav-fwd', { type: 'button', disabled: true, onmousedown: (e) => e.preventDefault(), onclick: () => nav(1) }, '›');
  const header = h('div.wm-head', h('div.wm-nav', btnBack, btnFwd), titleEl, h('div.wm-search-wrap', search, results), h('span.spacer'), btnWorld, btnClose);
  // the map: Leaflet with OpenStreetMap's tiles, plain images in the page (osm-view.js)
  const mapEl = h('div.wm-canvas.wm-osm');
  const tip = h('div.wm-tip', { hidden: true });
  // the views of the map (Länder, Kontinente, Bevölkerung, Wohlstand) and the legend of the chosen one
  const legend = h('div.wm-legend');
  let mode = savedMode();
  const zoomIn = h('button.wm-zbtn', { type: 'button', onclick: () => view?.zoomAt(2) }, '+');
  const zoomOut = h('button.wm-zbtn', { type: 'button', onclick: () => view?.zoomAt(0.5) }, '−');
  const zoomAll = h('button.wm-zbtn.wm-zall', { type: 'button', onclick: () => view?.fit() }, '⌂');
  const zoomBox = h('div.wm-zoom', zoomIn, zoomOut, zoomAll);
  const card = h('aside.wm-card', { hidden: true });
  // what the map is for, until the first card opens (Einstellungen → Hinweise einblenden)
  const hint = h('div.wm-hint', { role: 'note', hidden: ctx.state?.settings?.hints === false });
  const state = h('div.wm-state', h('div.wm-spinner'), h('p', T('Die Karte wird aufgeschlagen …', 'Unfolding the map …')));
  const sv = createStreetView(ctx, { onClose: () => { body.classList.remove('sv-open'); panel.focus({ preventScroll: true }); renderNav(); }, onNav: () => renderNav() });
  // without a connection the tiles do not come: a note with a button to try again (onTiles below)
  const offline = h('div.wm-offline', { hidden: true, role: 'status' });
  const body = h('div.wm-body', mapEl, legend, zoomBox, tip, hint, card, offline, state, sv.el);
  panel.append(header, body);
  container.appendChild(panel);

  const st = { sel: null, wiki: new Map(), wikiToken: 0, results: [], resIndex: -1, destroyed: false };
  let data = null, view = null, index = null;

  function renderChrome() {
    titleEl.replaceChildren(h('span.wm-globe', '🌍'), h('span', T('Weltkarte', 'World map')));
    search.placeholder = T('Land oder Stadt suchen …', 'Search a country or city …');
    search.setAttribute('aria-label', T('Land oder Stadt suchen', 'Search a country or city'));
    btnWorld.textContent = T('Ganze Welt', 'Whole world');
    btnWorld.title = T('Ganze Welt zeigen (0)', 'Show the whole world (0)');
    btnClose.title = T('Schließen (Esc)', 'Close (Esc)');
    btnBack.title = T('Zurück (Alt+←)', 'Back (Alt+←)'); btnFwd.title = T('Vor (Alt+→)', 'Forward (Alt+→)');
    btnBack.setAttribute('aria-label', btnBack.title); btnFwd.setAttribute('aria-label', btnFwd.title);
    hint.textContent = touch || isAndroid
      ? T('Tippen auf ein Land oder eine Stadt öffnet den Steckbrief · Wischen verschiebt · zwei Finger zoomen', 'Tap a country or a city for its profile · Swipe to move · Pinch to zoom')
      : T('Klick auf ein Land oder eine Stadt öffnet den Steckbrief · Ziehen verschiebt · Mausrad zoomt', 'Click a country or a city for its profile · Drag to move · Wheel to zoom');
    zoomIn.title = T('Vergrößern (+)', 'Zoom in (+)'); zoomOut.title = T('Verkleinern (−)', 'Zoom out (−)'); zoomAll.title = T('Ganze Welt (0)', 'Whole world (0)');
    renderLegend();
    offline.replaceChildren(
      h('p', T('Ohne Internet zeigt die Karte nur Länder und Namen, keine Landschaft und Straßen.', 'Without the internet the map shows countries and names only, no landscape or streets.')),
      h('button.btn.small', { type: 'button', onclick: () => { offline.hidden = true; view?.reload(); } }, T('Erneut versuchen', 'Try again')));
  }
  function renderLegend() {
    const lg = legendOf(mode, isDark());
    legend.replaceChildren(...[
      lg ? h('div.wm-lg-scale', lg.title ? h('span.wm-lg-title', lg.title) : null,
        ...lg.items.map(([col, text]) => h('span.wm-lg-item', h('i.wm-lg-swatch', { style: { background: col } }), text))) : null,
      h('div.wm-modes', { role: 'radiogroup', 'aria-label': T('Ansicht der Karte', 'View of the map') },
        ...MODES.map((m) => h('button.wm-mode' + (m === mode ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(m === mode), onclick: () => setMode(m) }, modeName(m))))].filter(Boolean));
  }
  function setMode(m) {
    if (m === mode) return;
    sfx('click');
    mode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch { /* private mode */ }
    // the legend first: view.setMode places the names anew, clear of the legend's new height
    renderLegend();
    view?.setMode(m);
  }
  renderChrome();

  // ---- data ------------------------------------------------------------------------------------------------------------
  try { data = await loadWorld(); } catch (e) {
    clear(state); state.append(h('p', T('Die Kartendaten fehlen: {e}', 'The map data is missing: {e}', { e: e.message })));
    return { unmount() {}, onKey: () => false };
  }
  if (!container.isConnected) return { unmount() {} };
  state.remove();

  view = new OsmView(mapEl, data, {
    dark: isDark(), mode,
    // the views colour the atlas only: in the streets of the tiles the switch would do nothing
    onAtlas: (shown) => { legend.hidden = !shown; },
    // the names of the atlas keep clear of the legend, the zoom buttons and the card (boxes in the map's px)
    reserved: () => {
      const b = mapEl.getBoundingClientRect();
      return [legend, zoomBox, card].filter((el) => el && !el.hidden && el.offsetParent).map((el) => { const r = el.getBoundingClientRect(); return [r.left - b.left - 4, r.top - b.top - 4, r.right - b.left + 4, r.bottom - b.top + 4]; });
    },
    onHover: (hit, e) => showTip(hit, e),
    // no tile came and several failed: no connection (or OpenStreetMap unreachable)
    onTiles: (t) => { if (!st.destroyed) offline.hidden = !(t.failed >= 4 && t.loaded === 0); },
    onClick: (hit) => {
      if (!hit || hit.type === 'sea') { if (st.sel) { sfx('click'); select(null); } return; }
      sfx('click');
      if (hit.type === 'city') select({ city: hit.city }, { fly: false });
      else select({ country: hit.country }, { fly: false });
    },
  });
  // the panel slides into place while it opens: Leaflet measures its box again once it stands (and on every resize);
  // the dark theme has tiles and colours of its own, sepia tints the light tiles in CSS (worldmap.css)
  const ro = new ResizeObserver(() => view?.resize());
  ro.observe(body);
  const offTheme = onTheme(() => { view?.setDark(isDark()); renderLegend(); });
  // the card slides in, the legend and the zoom buttons move aside for it and back (worldmap.css): the names are placed
  // anew once they stand (not in a flight or a zoom, whose end places them anyway)
  const replaceNames = (e) => { if (e.target === e.currentTarget && !mapEl.querySelector('.wm-labels.zooming')) view?.invalidate(); };
  legend.addEventListener('transitionend', replaceNames);
  zoomBox.addEventListener('transitionend', replaceNames);
  card.addEventListener('animationend', replaceNames);

  // ---- names, search ---------------------------------------------------------------------------------------------------
  const nameOf = (x) => (isDe() ? x.de : x.en);
  const countryOf = (pl) => (pl && pl.country >= 0 ? data.countries[pl.country] : null);
  const flagEl = (c, cls = '') => h('span.wm-flag' + cls, { 'aria-hidden': 'true' }, (c && flagOf(c.iso2)) || '🏳');
  function buildIndex() {
    const list = [];
    for (const c of data.countries) {
      const keys = new Set([c.de, c.en, c.formal, c.iso2, c.iso3].filter(Boolean).map(fold));
      list.push({ kind: 'country', ref: c, keys: [...keys], weight: 1e12 + c.pop });
    }
    for (const p of data.places) {
      const keys = new Set([p.de, p.en, p.name, ...String(p.alt || '').split(/[|,;]/)].filter(Boolean).map(fold));
      list.push({ kind: 'city', ref: p, keys: [...keys], weight: (p.cls === 0 ? 5e11 : 0) + p.pop });
    }
    return list;
  }
  function find(q) {
    const f0 = fold(q);
    if (!f0) return [];
    index = index || buildIndex();
    // "Muenchen", "Zuerich", "Koeln": the German way of writing without umlauts is tried as well
    const forms = [f0];
    const plain = f0.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
    if (plain !== f0) forms.push(plain);
    const out = [];
    for (const it of index) {
      let s = 0;
      for (const f of forms) {
        for (const k of it.keys) {
          if (k === f) { s = Math.max(s, 4); break; }
          if (k.startsWith(f)) s = Math.max(s, 3);
          else if (k.includes(' ' + f)) s = Math.max(s, 2);
          else if (f.length >= 3 && k.includes(f)) s = Math.max(s, 1);
        }
      }
      if (s) out.push([s, it]);
    }
    out.sort((a, b) => b[0] - a[0] || b[1].weight - a[1].weight);
    return out.slice(0, 9).map((x) => x[1]);
  }
  function renderResults() {
    clear(results);
    results.hidden = !st.results.length;
    st.results.forEach((it, i) => {
      const c = it.kind === 'country' ? it.ref : countryOf(it.ref);
      results.append(h('div.wm-res', {
        role: 'option', class: i === st.resIndex ? 'on' : '', 'aria-selected': i === st.resIndex ? 'true' : 'false',
        onmousedown: (e) => { e.preventDefault(); pick(it); },
      }, flagEl(c), h('span.wm-res-name', nameOf(it.ref)),
      h('span.wm-res-kind', it.kind === 'country' ? T('Land', 'Country') : [it.ref.cls === 0 ? T('Hauptstadt', 'Capital') : T('Stadt', 'City'), c ? ' · ' + nameOf(c) : ''].join(''))));
    });
    if (search.value.trim() && !st.results.length) { results.hidden = false; results.append(h('div.wm-res.none', T('Nichts gefunden', 'Nothing found'))); }
  }
  function pick(it) {
    search.value = ''; st.results = []; st.resIndex = -1; renderResults();
    search.blur();
    sfx('click');
    if (it.kind === 'country') select({ country: it.ref }, { fly: true });
    else select({ city: it.ref }, { fly: true });
  }
  search.addEventListener('input', () => { st.results = find(search.value); st.resIndex = st.results.length ? 0 : -1; renderResults(); });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && st.results.length) { e.preventDefault(); st.resIndex = (st.resIndex + 1) % st.results.length; renderResults(); }
    else if (e.key === 'ArrowUp' && st.results.length) { e.preventDefault(); st.resIndex = (st.resIndex - 1 + st.results.length) % st.results.length; renderResults(); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = st.results[Math.max(0, st.resIndex)]; if (it) pick(it); }
  });
  search.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== search) { results.hidden = true; } }, 150));
  search.addEventListener('focus', () => { if (st.results.length) results.hidden = false; });

  // ---- tooltip -----------------------------------------------------------------------------------------------------------
  /** The short facts under the name in the tooltip: for a country what the chosen view shows, for a city its country
   *  and its inhabitants. */
  function tipFacts(hit, c) {
    if (hit.type === 'city') {
      const p = hit.city;
      return [c ? nameOf(c) : '', p.cls === 0 ? T('Hauptstadt', 'Capital') : '', fmt.people(p.popCity || p.pop) ? T('{n} Einw.', '{n} people', { n: fmt.people(p.popCity || p.pop) }) : ''].filter(Boolean).join(' · ');
    }
    if (mode === 'density') { const d = densityOf(c); return d ? fmt.density(d) : T('keine Angabe', 'no data'); }
    if (mode === 'wealth') { const v = perHeadOf(c); return v ? T('{v} je Einwohner', '{v} per head', { v: fmt.perHead(v) }) : T('keine Angabe', 'no data'); }
    if (mode === 'continents') return continentName(c.cont);
    const capital = c.cap?.length ? data.places[c.cap[0]] : null;
    return [capital ? T('Hauptstadt {c}', 'Capital {c}', { c: nameOf(capital) }) : '', fmt.people(c.pop) ? T('{n} Einw.', '{n} people', { n: fmt.people(c.pop) }) : ''].filter(Boolean).join(' · ');
  }
  function showTip(hit, e) {
    if (!hit || hit.type === 'sea' || !e) { tip.hidden = true; return; }
    const c = hit.type === 'city' ? countryOf(hit.city) : hit.country;
    const facts = tipFacts(hit, c);
    tip.replaceChildren(...[flagEl(c), h('span.wm-tip-text', h('b', nameOf(hit.type === 'city' ? hit.city : hit.country)), facts ? h('span.wm-tip-facts', facts) : null)].filter(Boolean));
    tip.hidden = false;
    const r = body.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const w = tip.offsetWidth;
    tip.style.transform = `translate(${Math.round(x + 16 + w > r.width - 8 ? x - w - 14 : x + 16)}px, ${Math.round(y + 18)}px)`;
  }

  // ---- selection and the card ---------------------------------------------------------------------------------------------
  function select(sel, { fly = false, record = true } = {}) {
    st.sel = sel;
    if (sel?.city) sel.country = countryOf(sel.city);
    body.classList.toggle('has-card', !!sel);
    renderCard();
    // after the card: the names placed with the selection keep clear of it
    view.setSelected(sel ? { country: sel.city ? null : sel.country, city: sel.city || null } : null);
    if (sel) { hideHint(); if (record) remember(sel); }
    renderNav();
    if (!sel || !fly) return;
    const right = body.clientWidth > 900 ? (card.offsetWidth || CARD_W) + 24 : 0;
    if (sel.city) view.flyToCity(sel.city, { right });
    else view.flyToCountry(sel.country, { right });
  }
  function zoomToSelection() {
    const sel = st.sel; if (!sel) return;
    sfx('click');
    const right = body.clientWidth > 900 ? (card.offsetWidth || CARD_W) + 24 : 0;
    if (sel.city) view.zoomIntoCity(sel.city, { right });
    else view.flyToCountry(sel.country, { right, maxZoom: 12 });
  }

  // ---- back and forward through the cards shown ------------------------------------------------------------------------
  // Closing a card is no step: back first opens the last card again, then the ones before it.
  const hist = { list: [], i: -1 };
  const keyOf = (sel) => (sel?.city ? 'c' + sel.city.index : sel?.country ? 'k' + sel.country.id : '');
  const fromKey = (k) => (k[0] === 'c' ? { city: data.places[+k.slice(1)] } : { country: data.byId.get(k.slice(1)) });
  function remember(sel) {
    const k = keyOf(sel);
    if (!k || hist.list[hist.i] === k) return;
    hist.list.splice(hist.i + 1);
    hist.list.push(k);
    if (hist.list.length > 80) hist.list.shift();
    hist.i = hist.list.length - 1;
  }
  const canBack = () => (st.sel && keyOf(st.sel) === hist.list[hist.i] ? hist.i > 0 : hist.i >= 0);
  const canFwd = () => hist.i < hist.list.length - 1;
  function renderNav() {
    const inSv = sv.isOpen();
    btnBack.disabled = !(inSv || canBack());
    btnFwd.disabled = !(inSv ? sv.canForward() : canFwd());
  }
  /** -1 back, 1 forward; true when something happened. In Street View its own pages, then back to the map. */
  function nav(dir) {
    if (!view) return false;
    if (sv.isOpen()) { const done = dir < 0 ? sv.back() : sv.forward(); renderNav(); return done; }
    let j = hist.i + dir;
    if (dir < 0 && !(st.sel && keyOf(st.sel) === hist.list[hist.i])) j = hist.i;   // the closed card first
    if (j < 0 || j >= hist.list.length) return false;
    hist.i = j;
    sfx('page');
    select(fromKey(hist.list[j]), { fly: true, record: false });
    return true;
  }

  function hideHint() { if (!hint.hidden && !hint.classList.contains('gone')) { hint.classList.add('gone'); setTimeout(() => { hint.hidden = true; }, 400); } }

  /** Element.append would turn null into the text "null": leave empty parts out. */
  const put = (el, ...nodes) => el.append(...nodes.flat().filter((n) => n != null && n !== false && n !== ''));
  const link = (label, onclick, title) => h('button.wm-link', { type: 'button', title: title || label, onclick }, label);
  const cityLink = (p) => link(nameOf(p), () => { sfx('click'); select({ city: p }, { fly: true }); });
  const countryLink = (c) => h('button.wm-chip', { type: 'button', title: nameOf(c), onclick: () => { sfx('click'); select({ country: c }, { fly: true }); } }, flagEl(c), nameOf(c));
  const fact = (label, ...value) => (value.some((v) => v != null && v !== '' && v !== false) ? [h('dt', label), h('dd', ...value)] : []);
  const small = (s) => (s ? h('small', ' ', s) : null);
  const sortNames = (a, b) => a.localeCompare(b, isDe() ? 'de' : 'en');

  function renderCard() {
    clear(card);
    const sel = st.sel;
    card.hidden = !sel;
    if (!sel) return;
    card.scrollTop = 0;
    const closeBtn = h('button.wm-card-close', { type: 'button', title: T('Karte schließen (Esc)', 'Close the card (Esc)'), onclick: () => { sfx('click'); select(null); } }, '✕');
    if (sel.city) cityCard(sel.city, closeBtn); else countryCard(sel.country, closeBtn);
  }

  function countryCard(c, closeBtn) {
    const lang = isDe() ? 'de' : 'en';
    const caps = c.cap.map((i) => data.places[i]).filter(Boolean);
    const seats = c.seat.map((i) => data.places[i]).filter(Boolean);
    const sov = c.sov ? data.byId.get(c.sov) : null;
    const dens = c.area > 0 && c.pop > 0 ? c.pop / c.area : 0;
    const perHead = c.pop > 0 && c.gdp > 0 ? c.gdp * 1e6 / c.pop : 0;
    const langs = c.lang.map((l) => (lang === 'de' ? l[0] || l[1] : l[1] || l[0])).filter(Boolean).sort(sortNames);
    const curs = c.cur.map((x) => { const n = lang === 'de' ? x[1] || x[2] : x[2] || x[1]; return x[0] && n ? `${n} (${x[0]})` : n || x[0]; }).filter(Boolean);
    const nbs = c.nb.map((id) => data.byId.get(id)).filter(Boolean).sort((a, b) => sortNames(nameOf(a), nameOf(b)));
    const cities = (data.citiesOf.get(c.index) || []).slice(0, 6);
    const list = (items, n) => items.length > n ? `${items.slice(0, n).join(', ')} ${T('und {k} weitere', 'and {k} more', { k: items.length - n })}` : items.join(', ');
    const sub = [fmt.continent(c.cont), c.sub && c.sub !== c.cont ? fmt.subregion(c.sub) : ''].filter(Boolean).join(' · ');
    put(card,
      closeBtn,
      h('header.wm-card-head', flagEl(c, '.big'), h('div', h('h2', nameOf(c)), lang === 'en' && c.formal && c.formal !== c.en ? h('div.wm-card-formal', c.formal) : null, h('div.wm-card-sub', sub))),
      sov ? h('p.wm-card-note', T('Gehört zu', 'Part of'), ' ', countryLink(sov)) : null,
      // Street View and the zoom right under the name: below the Wikipedia text they were out of sight
      h('div.wm-actions',
        h('button.btn.small.primary', { type: 'button', title: caps[0] ? T('Street View in {c}', 'Street View in {c}', { c: nameOf(caps[0]) }) : 'Street View', onclick: () => openStreetView(caps[0] ? { lat: caps[0].lat, lon: caps[0].lon, title: `${nameOf(caps[0])}, ${nameOf(c)}` } : labelPoint(c)) },
          'Street View', caps[0] ? h('small', ' · ' + nameOf(caps[0])) : null),
        h('button.btn.small', { type: 'button', onclick: zoomToSelection }, T('Heranzoomen', 'Zoom in'))),
      h('dl.wm-facts',
        caps.length ? fact(caps.length > 1 ? T('Hauptstädte', 'Capitals') : T('Hauptstadt', 'Capital'), ...joinNodes(caps.map(cityLink))) : [],
        seats.length ? fact(caps.length ? T('Weitere Sitze von Staatsorganen', 'Further seats of state institutions') : T('Regierungssitz', 'Seat of government'), ...joinNodes(seats.map(cityLink))) : [],
        fact(T('Einwohner', 'Population'), fmt.people(c.pop), small(c.popY ? `(${c.popY})` : '')),
        fact(T('Fläche', 'Area'), fmt.area(c.area), small(c.areaSrc === 'ne' ? T('(aus den Umrissen berechnet)', '(measured from the outline)') : '')),
        fact(T('Bevölkerungsdichte', 'Population density'), fmt.density(dens)),
        fact(T('Bruttoinlandsprodukt', 'Gross domestic product'), fmt.money(c.gdp), small(c.gdpY ? `(${c.gdpY})` : '')),
        fact(T('BIP pro Kopf', 'GDP per capita'), fmt.perHead(perHead)),
        fact(T('Einkommensgruppe', 'Income group'), fmt.income(c.inc)),
        fact(T('Wirtschaft', 'Economy'), fmt.economy(c.eco)),
        fact(langs.length > 1 ? T('Amtssprachen', 'Official languages') : T('Amtssprache', 'Official language'), list(langs, 5)),
        fact(curs.length > 1 ? T('Währungen', 'Currencies') : T('Währung', 'Currency'), curs.join(', ')),
        fact(T('Ländercode', 'Country code'), [c.iso2, c.iso3].filter(Boolean).join(' · '))),
      h('section.wm-sec', h('h3', T('Nachbarländer', 'Neighbouring countries')), nbs.length ? h('div.wm-chips', nbs.map(countryLink)) : h('p.muted', T('Keine Landgrenze zu einem anderen Land.', 'No land border with another country.'))),
      cities.length ? h('section.wm-sec', h('h3', T('Größte Städte', 'Largest cities')), h('ol.wm-cities', cities.map((p) => h('li', h('button.wm-city', { type: 'button', onclick: () => { sfx('click'); select({ city: p }, { fly: true }); } }, h('span.wm-city-name', nameOf(p), p.cls === 0 ? h('i.wm-cap-mark', { title: T('Hauptstadt', 'Capital') }) : null), h('span.wm-city-pop', fmt.people(p.popCity || p.pop))))))) : null,
      wikiSection({ wikidata: c.wd, title: nameOf(c) }),
      h('footer.wm-card-src', T('Einwohner und Wirtschaft: Schätzungen aus Natural Earth. Sprachen, Währungen und Fläche: Wikidata.', 'Population and economy: estimates from Natural Earth. Languages, currencies and area: Wikidata.')),
    );
  }
  function labelPoint(c) {
    const lon = c.lbl[0], lat = c.lbl[1];
    return { lat, lon, title: nameOf(c) };
  }
  function joinNodes(nodes) { const out = []; nodes.forEach((n, i) => { if (i) out.push(', '); out.push(n); }); return out; }

  function cityCard(p, closeBtn) {
    const c = countryOf(p);
    const lang = isDe() ? 'de' : 'en';
    const other = [];
    if (lang === 'de' && p.en !== p.de) other.push(`${p.en} (${T('englisch', 'English')})`);
    if (lang === 'en' && p.de !== p.en) other.push(`${p.de} (${T('deutsch', 'German')})`);
    if (p.name !== p.de && p.name !== p.en) other.push(p.name);
    const time = fmt.localTime(p.tz);
    put(card,
      closeBtn,
      h('header.wm-card-head', h('span.wm-citymark', { class: p.cls === 0 ? 'cap' : '' }), h('div', h('h2', nameOf(p)), h('div.wm-card-sub', fmt.placeStatus(p.cls, c ? nameOf(c) : '')))),
      h('div.wm-actions',
        h('button.btn.small.primary', { type: 'button', onclick: () => openStreetView({ lat: p.lat, lon: p.lon, title: c ? `${nameOf(p)}, ${nameOf(c)}` : nameOf(p) }) }, 'Street View'),
        h('button.btn.small', { type: 'button', onclick: zoomToSelection }, T('Heranzoomen', 'Zoom in'))),
      h('dl.wm-facts',
        c ? fact(T('Land', 'Country'), countryLink(c)) : [],
        fact(T('Region', 'Region'), p.region && p.region !== p.name ? p.region : ''),
        p.popCity ? fact(T('Einwohner', 'Population'), fmt.people(p.popCity), small(p.popYear ? `(${p.popYear})` : '')) : fact(T('Einwohner', 'Population'), fmt.people(p.pop), small(T('(Ballungsraum, Schätzung)', '(urban area, estimate)'))),
        fact(T('Koordinaten', 'Coordinates'), fmt.coords(p.lat, p.lon)),
        fact(T('Ortszeit', 'Local time'), time),
        fact(T('Andere Namen', 'Other names'), other.join(' · '))),
      wikiSection({ wikidata: p.wd, title: nameOf(p) }),
      h('footer.wm-card-src', p.popCity ? T('Einwohner der Gemeinde: Wikidata. Lage und Status: Natural Earth.', 'Population of the municipality: Wikidata. Position and status: Natural Earth.') : T('Einwohnerzahl: Schätzung aus Natural Earth.', 'Population: estimate from Natural Earth.')),
    );
  }

  // ---- Wikipedia --------------------------------------------------------------------------------------------------------------
  function wikiSection(ref) {
    const lang = isDe() ? 'de' : 'en';
    const box = h('section.wm-sec.wm-wiki', h('h3', 'Wikipedia'));
    const key = `${lang}:${ref.wikidata || ref.title}`;
    const token = ++st.wikiToken;
    const render = (s, err) => {
      if (token !== st.wikiToken || st.destroyed) return;
      box.replaceChildren(h('h3', 'Wikipedia'));
      if (err) {
        box.append(h('p.muted', T('Keine Verbindung zu Wikipedia.', 'No connection to Wikipedia.')), h('button.btn.small', { type: 'button', onclick: () => { st.wiki.delete(key); box.replaceWith(wikiSection(ref)); } }, T('Erneut versuchen', 'Try again')));
        return;
      }
      if (!s || !s.extract) { box.append(h('p.muted', T('Kein Artikel gefunden.', 'No article found.'))); return; }
      put(box,
        s.thumbnail?.url ? h('img.wm-wiki-img', { src: s.thumbnail.url, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null,
        s.description ? h('p.wm-wiki-desc', s.description) : null,
        h('p.wm-wiki-text', s.extract),
        h('div.wm-wiki-actions',
          h('button.btn.small', { type: 'button', onclick: () => { sfx('page'); ctx.openPanel?.('wiki', { title: s.title, lang }); } }, T('Im Lexikon lesen', 'Read in the encyclopedia')),
          h('span.wm-wiki-lic', 'CC BY-SA 4.0')));
    };
    const cached = st.wiki.get(key);
    if (cached) { render(cached); return box; }
    box.append(h('p.wm-wiki-loading', h('span.wm-mini-spin'), T('Wird aus Wikipedia geladen …', 'Loading from Wikipedia …')));
    const get = typeof api?.invoke === 'function' ? api.invoke('wiki:summaryFor', lang, { wikidata: ref.wikidata || '', title: ref.title }) : api?.wiki?.summary?.(lang, ref.title);
    Promise.resolve(get).then((s) => { st.wiki.set(key, s || null); render(s); }, (e) => render(null, e));
    return box;
  }

  // ---- Street View ---------------------------------------------------------------------------------------------------------------
  function openStreetView(t) {
    if (!t) return;
    body.classList.add('sv-open');
    tip.hidden = true;
    sv.open(t);
  }

  const offLang = bus.on('i18n:change', () => { renderChrome(); renderCard(); index = null; view?.invalidate(); });

  // ---- start ---------------------------------------------------------------------------------------------------------------
  if (params.country && data.byId.get(params.country)) select({ country: data.byId.get(params.country) }, { fly: true });
  else if (params.city != null) {
    const p = typeof params.city === 'number' ? data.places[params.city] : find(String(params.city)).find((x) => x.kind === 'city')?.ref;
    if (p) select({ city: p }, { fly: true });
  } else if (params.q) { search.value = String(params.q); st.results = find(search.value); st.resIndex = 0; renderResults(); }
  else if (Array.isArray(params.aim)) { const c = data.countryAt(params.aim[0], params.aim[1]); if (c) select({ country: c }, { fly: true }); }
  setTimeout(() => panel.focus({ preventScroll: true }), 60);
  const hintTimer = setTimeout(hideHint, 14000);

  // handle for build/scripts/worldmap-check.js
  Object.defineProperty(panel, '__wm', {
    configurable: true,
    value: {
      data, view, sv, find, select: (s, o) => select(s, o), state: () => ({ sel: st.sel ? { country: st.sel.country?.id || null, city: st.sel.city ? st.sel.city.name : null } : null, zoom: view.zoom, center: view.center, sv: sv.state(), card: card.hidden ? '' : card.innerText, history: { list: [...hist.list], i: hist.i }, offline: !offline.hidden }),
      stats: () => view.stats(),
    },
  });

  return {
    unmount() {
      st.destroyed = true; ++st.wikiToken;
      offLang(); offTheme(); ro.disconnect(); clearTimeout(hintTimer);
      view?.destroy();
      return sv.destroy();
    },
    /** Alt+←/→, the mouse's side buttons and Windows' app commands (panels.js panelNav) */
    onNav(dir) { return st.destroyed ? false : nav(dir); },
    onKey(e) {
      if (st.destroyed) return false;
      if (sv.isOpen()) return sv.onKey(e);
      if (e.target === search) {
        // Esc: first the list of hits goes, then the text, and the keys belong to the map again
        if (e.key === 'Escape') { if (!results.hidden) results.hidden = true; else { search.value = ''; st.results = []; search.blur(); panel.focus({ preventScroll: true }); } return true; }
        return false;
      }
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return false;
      if (e.key === 'Escape') { if (st.sel) { select(null); return true; } return false; }
      if (e.ctrlKey || e.metaKey || e.altKey) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { search.focus(); return true; } return false; }
      const pan = Math.round(Math.min(body.clientWidth, body.clientHeight) * 0.18);
      switch (e.key) {
        case 'ArrowLeft': view.panBy(-pan, 0); return true;
        case 'ArrowRight': view.panBy(pan, 0); return true;
        case 'ArrowUp': view.panBy(0, -pan); return true;
        case 'ArrowDown': view.panBy(0, pan); return true;
        case '+': case '=': case 'Add': view.zoomAt(2); return true;
        case '-': case '_': case 'Subtract': view.zoomAt(0.5); return true;
        case '0': case 'Home': view.fit(); return true;
        case '/': search.focus(); return true;
        case 'Enter': if (st.sel) { zoomToSelection(); return true; } return false;
        default: return false;
      }
    },
  };
}
