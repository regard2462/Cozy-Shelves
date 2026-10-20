// Podcasts: a warm "radio" panel – iTunes search, curated recommendations, subscriptions, episodes and the player bar.
// The player itself (player.js) survives panel close so audio keeps playing; the HUD can use `podcastPlayer`.
import { h, clear, escapeHtml } from '../../core/dom.js';
import { tr, i18n } from '../../core/i18n.js';
import { podcastPlayer, formatTime } from './player.js';
import { openInApp, openSystemBrowser, sanitizeFragment, interceptLinks, externalLabel } from '../reader/link-nav.js';
import { createNavHistory } from '../nav-history.js';

export { podcastPlayer };

const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString(i18n.lang === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const SLEEP_OPTIONS = [15, 30, 60];

export async function mount(container, ctx, params = {}) {
  const { api, bus } = ctx;
  podcastPlayer.attach(ctx);
  const st = { tab: params.tab || 'subs', subs: [], curated: null, results: [], query: '', langFilter: 'all', topic: 'all', show: null, episodes: [], epLoading: false, epError: null, searching: false, positions: {}, token: 0 };
  const sfx = (n) => ctx.audio?.sfx?.(n);
  const toast = (m) => ctx.toast?.(m);

  const panel = h('div.panel.pod-panel');
  const header = h('div.panel-header.pod-header');
  const shows = h('div.pod-shows');
  const detail = h('div.pod-detail');
  const playerBar = h('div.pod-player');
  panel.append(header, h('div.pod-body', shows, detail), playerBar);
  container.appendChild(panel);

  const isSubscribed = (feedUrl) => st.subs.some((s) => s.feedUrl === feedUrl);

  // back and forward: tabs, filters, a search and the chosen podcast are steps
  let restoring = false;
  const snapshot = () => ({ tab: st.tab, langFilter: st.langFilter, topic: st.topic, query: st.tab === 'search' ? st.query : '', show: st.show ? { feedUrl: st.show.feedUrl, title: st.show.title, author: st.show.author, artwork: st.show.artwork } : null });
  const hist = createNavHistory({ onGo: (e) => restore(e), same: (a, b) => JSON.stringify({ ...a, show: a?.show?.feedUrl || null }) === JSON.stringify({ ...b, show: b?.show?.feedUrl || null }) });
  const navBtns = hist.buttons();
  const record = () => { if (!restoring) hist.push(snapshot()); };
  function restore(e) {
    restoring = true;
    try {
      st.tab = e.tab; st.langFilter = e.langFilter; st.topic = e.topic;
      if (e.tab === 'search' && e.query && e.query !== st.query) doSearch(e.query); else if (e.tab === 'search') st.query = e.query || '';
      renderHeader(); renderShows();
      if (e.show && st.show?.feedUrl !== e.show.feedUrl) openShow(e.show);
      else if (!e.show && st.show) { st.show = null; ++st.token; renderShows(); renderDetail(); }
    } finally { restoring = false; }
  }

  // ---- header ---------------------------------------------------------------------------------------------
  function renderHeader() {
    clear(header);
    const tabs = [['subs', tr({ de: 'Abonnements', en: 'Subscriptions' })], ['curated', tr({ de: 'Empfehlungen', en: 'Recommendations' })], ['search', tr({ de: 'Suche', en: 'Search' })]];
    header.append(
      navBtns,
      h('span.pod-logo', '📻'), h('span.pod-title', tr({ de: 'Radio & Podcasts', en: 'Radio & Podcasts' })),
      h('div.tabs.pod-tabs', tabs.map(([id, label]) => h('div.tab', { class: st.tab === id ? 'active' : '', onclick: () => { if (st.tab === id) return; sfx('click'); st.tab = id; record(); renderHeader(); renderShows(); } }, label))),
      h('span.spacer'),
      h('button.btn.small', { title: tr({ de: 'OPML importieren (z. B. AntennaPod-Export)', en: 'Import OPML (e.g. AntennaPod export)' }), onclick: importOpml }, '⇩ OPML'),
      h('button.btn.small', { title: tr({ de: 'Abonnements als OPML exportieren', en: 'Export subscriptions as OPML' }), onclick: exportOpml }, '⇧ OPML'),
      h('button.btn.small.icon', { title: tr({ de: 'Schließen', en: 'Close' }), onclick: () => ctx.close() }, '✕'),
    );
  }

  // ---- left column ---------------------------------------------------------------------------------------------
  function showCard(p, { subscribed } = {}) {
    const active = st.show && st.show.feedUrl === p.feedUrl;
    return h('div.pod-show', { class: active ? 'active' : '', onclick: () => openShow(p) },
      h('div.pod-art', p.artwork ? h('img', { src: p.artwork, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : h('span', '🎙'), p.lang ? h('span.pod-lang', p.lang.toUpperCase()) : null),
      h('div.pod-show-body', h('div.pod-show-title', p.title), h('div.pod-show-author', p.author || ''), p.description ? h('div.pod-show-desc', p.description) : null),
      subscribed ? h('span.pod-sub-mark', { title: tr({ de: 'Abonniert', en: 'Subscribed' }) }, '✓') : null,
    );
  }

  function renderShows() {
    clear(shows);
    if (st.tab === 'subs') {
      if (!st.subs.length) { shows.appendChild(h('div.pod-empty', h('div.pod-empty-icon', '🎧'), h('p', tr({ de: 'Noch keine Abonnements. Stöbere in den Empfehlungen oder suche einen Podcast.', en: 'No subscriptions yet. Browse the recommendations or search for a podcast.' })), h('button.btn.primary', { onclick: () => { st.tab = 'curated'; record(); renderHeader(); renderShows(); } }, tr({ de: 'Empfehlungen ansehen', en: 'See recommendations' })))); return; }
      shows.appendChild(h('div.pod-section-title', tr({ de: '{n} Podcasts abonniert', en: '{n} subscribed podcasts' }, { n: st.subs.length })));
      for (const s of [...st.subs].sort((a, b) => a.title.localeCompare(b.title))) shows.appendChild(showCard(s, { subscribed: true }));
    } else if (st.tab === 'curated') {
      if (!st.curated) { shows.appendChild(h('div.pod-empty', h('div.pod-spinner'))); return; }
      const filters = h('div.pod-filters',
        ['all', 'de', 'en'].map((l) => h('button.pod-chip', { class: st.langFilter === l ? 'active' : '', onclick: () => { if (st.langFilter === l) return; st.langFilter = l; record(); renderShows(); } }, l === 'all' ? tr({ de: 'Alle', en: 'All' }) : l.toUpperCase())),
        h('span.pod-chip-sep'),
        h('button.pod-chip', { class: st.topic === 'all' ? 'active' : '', onclick: () => { if (st.topic === 'all') return; st.topic = 'all'; record(); renderShows(); } }, tr({ de: 'Alle Themen', en: 'All topics' })),
        st.curated.topics.map((t) => h('button.pod-chip', { class: st.topic === t.id ? 'active' : '', onclick: () => { if (st.topic === t.id) return; st.topic = t.id; record(); renderShows(); } }, tr({ de: t.de, en: t.en }))),
      );
      shows.appendChild(filters);
      const list = st.curated.podcasts.filter((p) => (st.langFilter === 'all' || p.lang === st.langFilter) && (st.topic === 'all' || p.topic === st.topic));
      const groups = st.topic === 'all' ? st.curated.topics.map((t) => [t, list.filter((p) => p.topic === t.id)]).filter(([, l]) => l.length) : [[st.curated.topics.find((t) => t.id === st.topic), list]];
      for (const [t, l] of groups) { shows.appendChild(h('div.pod-section-title', tr({ de: t.de, en: t.en }))); for (const p of l) shows.appendChild(showCard(p, { subscribed: isSubscribed(p.feedUrl) })); }
    } else {
      const input = h('input.input.pod-search', { placeholder: tr({ de: 'Podcast suchen (Apple Podcasts) …', en: 'Search podcasts (Apple Podcasts) …' }), value: st.query });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(input.value); });
      shows.appendChild(h('div.pod-search-row', input, h('button.btn.small', { onclick: () => doSearch(input.value) }, tr({ de: 'Suchen', en: 'Search' }))));
      if (st.searching) shows.appendChild(h('div.pod-empty', h('div.pod-spinner')));
      else if (st.query && !st.results.length) shows.appendChild(h('div.pod-empty', h('p.muted', tr({ de: 'Nichts gefunden.', en: 'Nothing found.' }))));
      else if (!st.query) shows.appendChild(h('div.pod-empty', h('p.muted', tr({ de: 'Den Namen eines Podcasts eingeben. Die Ergebnisse stammen aus dem Podcast-Verzeichnis von Apple, abgespielt wird direkt aus dem RSS-Feed des Podcasts.', en: 'Type the name of a podcast. The results come from the Apple podcast directory, playback uses the podcast’s RSS feed directly.' }))));
      for (const r of st.results) shows.appendChild(showCard(r, { subscribed: isSubscribed(r.feedUrl) }));
      setTimeout(() => input.focus(), 30);
    }
  }

  async function doSearch(q) {
    st.query = q.trim(); if (!st.query) { st.results = []; renderShows(); return; }
    record();
    st.searching = true; renderShows();
    try { st.results = await api.podcasts.search(st.query, i18n.lang); }
    catch (e) { st.results = []; toast(tr({ de: 'Suche fehlgeschlagen: ', en: 'Search failed: ' }) + e.message); }
    st.searching = false; renderShows();
  }

  // ---- right column: show + episodes ---------------------------------------------------------------------------
  async function openShow(p) {
    sfx('click');
    st.show = { ...p }; st.episodes = []; st.epError = null; st.epLoading = true;
    record();
    renderShows(); renderDetail();
    const token = ++st.token;
    try {
      const res = await api.podcasts.episodes(p.feedUrl);
      if (token !== st.token) return;
      st.show = { ...p, ...res.show, artwork: p.artwork || res.show?.artwork, feedUrl: p.feedUrl };
      st.episodes = res.episodes || [];
    } catch (e) { if (token !== st.token) return; st.epError = e.message; }
    st.epLoading = false;
    renderDetail();
  }

  function renderDetail() {
    clear(detail);
    const p = st.show;
    if (!p) { detail.appendChild(h('div.pod-empty.pod-detail-empty', h('div.pod-dial'), h('p', tr({ de: 'Links einen Podcast wählen, seine Folgen erscheinen hier.', en: 'Pick a podcast on the left, its episodes appear here.' })))); return; }
    const subscribed = isSubscribed(p.feedUrl);
    const head = h('div.pod-show-head',
      h('div.pod-art.big', p.artwork ? h('img', { src: p.artwork, alt: '', onerror: (e) => e.target.remove() }) : h('span', '🎙')),
      h('div.pod-show-head-body',
        h('h2.pod-show-h', p.title),
        h('div.pod-show-author', p.author || ''),
        p.description ? h('p.pod-show-long', p.description) : null,
        h('div.row',
          h('button.btn.small', { class: subscribed ? '' : 'primary', title: subscribed ? tr({ de: 'Du hast diesen Podcast abonniert', en: 'You subscribe to this podcast' }) : '', onclick: () => toggleSub(p) }, subscribed ? tr({ de: 'Abonnement beenden', en: 'Unsubscribe' }) : '+ ' + tr({ de: 'Abonnieren', en: 'Subscribe' })),
          p.link || p.homepage ? h('button.btn.small.ghost', { title: p.link || p.homepage, onclick: () => openInApp(p.link || p.homepage, ctx, { from: 'podcasts', title: p.title }) }, '📖 ' + tr({ de: 'Website', en: 'Website' })) : null,
          p.link || p.homepage ? h('button.btn.small.ghost', { title: externalLabel(), onclick: () => openSystemBrowser(api, p.link || p.homepage) }, '↗') : null,
          h('button.btn.small.ghost', { onclick: () => openShow({ ...p }), title: tr({ de: 'Folgen neu laden', en: 'Reload episodes' }) }, '↻'),
          st.episodes.length ? h('span.muted.small', `${st.episodes.length} ${tr({ de: 'Folgen', en: 'episodes' })}`) : null,
        )),
    );
    detail.appendChild(head);
    const list = h('div.pod-episodes');
    if (st.epLoading) list.appendChild(h('div.pod-empty', h('div.pod-spinner'), h('p.muted', tr({ de: 'Folgen werden geladen …', en: 'Loading episodes …' }))));
    else if (st.epError) list.appendChild(h('div.pod-empty', h('p.pod-err', '✗ ' + st.epError), h('button.btn.small', { onclick: () => openShow(p) }, tr({ de: 'Erneut versuchen', en: 'Try again' }))));
    else if (!st.episodes.length) list.appendChild(h('div.pod-empty', h('p.muted', tr({ de: 'Keine Folgen gefunden.', en: 'No episodes found.' }))));
    for (const ep of st.episodes) list.appendChild(episodeRow(ep));
    detail.appendChild(list);
  }

  function episodeRow(ep) {
    const cur = podcastPlayer.current;
    const isCur = cur && cur.episode.id === ep.id;
    const ps = podcastPlayer.state;
    const pos = isCur ? ps.position : (ep.position?.seconds || 0);
    const dur = isCur && ps.duration ? ps.duration : ep.duration || 0;
    const done = ep.position?.done && !isCur;
    const pct = dur ? Math.min(100, (pos / dur) * 100) : 0;
    const row = h('div.pod-ep', { class: [isCur ? 'current' : '', done ? 'done' : ''].filter(Boolean).join(' '), dataset: { id: ep.id } },
      h('button.pod-play', { title: isCur && ps.playing ? tr({ de: 'Pause', en: 'Pause' }) : tr({ de: 'Abspielen', en: 'Play' }), onclick: (e) => { e.stopPropagation(); playEpisode(ep); } }, isCur && ps.playing ? '❚❚' : '▶'),
      h('div.pod-ep-body',
        h('div.pod-ep-meta', h('span', fmtDate(ep.date)), ep.episode ? h('span', '#' + ep.episode) : null, dur ? h('span', formatTime(dur)) : null, done ? h('span.pod-done', '✓ ' + tr({ de: 'gehört', en: 'played' })) : (pos > 30 && dur ? h('span.pod-resume', tr({ de: 'noch {t}', en: '{t} left' }, { t: formatTime(dur - pos) })) : null)),
        h('div.pod-ep-title', ep.title),
        h('div.pod-ep-summary', ep.summary || ''),
        pct > 0 && !done ? h('div.progress-bar.pod-ep-progress', h('i', { style: { width: pct + '%' } })) : null,
      ),
      h('button.btn.small.ghost.pod-ep-more', { title: tr({ de: 'Beschreibung', en: 'Description' }), onclick: (e) => { e.stopPropagation(); toggleDesc(row, ep); } }, '…'),
    );
    row.addEventListener('click', () => toggleDesc(row, ep));
    return row;
  }
  function toggleDesc(row, ep) {
    const open = row.querySelector('.pod-ep-desc');
    if (open) { open.remove(); row.classList.remove('open'); return; }
    const base = ep.link || st.show?.link || st.show?.homepage || '';
    // the episode description is remote HTML: sanitize it, and keep its links inside the app
    const text = h('div');
    text.append(sanitizeFragment(ep.description || `<p>${escapeHtml(ep.summary || '')}</p>`, base));
    const d = h('div.pod-ep-desc', text, h('div.row',
      h('button.btn.small.ghost', { onclick: async (e) => { e.stopPropagation(); await podcastPlayer.markDone(ep, !ep.position?.done); ep.position = { ...(ep.position || {}), done: !ep.position?.done, seconds: ep.position?.done ? 0 : ep.duration }; renderDetail(); } }, ep.position?.done ? tr({ de: 'Als ungehört markieren', en: 'Mark as unplayed' }) : tr({ de: 'Als gehört markieren', en: 'Mark as played' })),
      ep.link ? h('button.btn.small.ghost', { title: ep.link, onclick: (e) => { e.stopPropagation(); openInApp(ep.link, ctx, { from: 'podcasts', title: ep.title }); } }, '📖 ' + tr({ de: 'Shownotes', en: 'Show notes' })) : null,
      ep.link ? h('button.btn.small.ghost', { title: externalLabel(), onclick: (e) => { e.stopPropagation(); openSystemBrowser(api, ep.link); } }, '↗') : null));
    // links in the show notes open in the reading browser; a click inside the notes must not fold them away
    interceptLinks(text, ctx, base);
    d.addEventListener('click', (e) => e.stopPropagation());
    row.querySelector('.pod-ep-body').appendChild(d); row.classList.add('open');
  }

  async function playEpisode(ep) {
    const cur = podcastPlayer.current;
    if (cur && cur.episode.id === ep.id) { podcastPlayer.toggle(); return; }
    sfx('click');
    await podcastPlayer.play(ep, { title: st.show.title, artwork: st.show.artwork, feedUrl: st.show.feedUrl, author: st.show.author });
  }

  async function toggleSub(p) {
    sfx('click');
    try {
      if (isSubscribed(p.feedUrl)) { await api.podcasts.unsubscribe(p.feedUrl); toast(tr({ de: 'Abonnement entfernt', en: 'Unsubscribed' })); }
      else { await api.podcasts.subscribe(p.feedUrl, { title: p.title, author: p.author, artwork: p.artwork, homepage: p.link || p.homepage }); toast(tr({ de: 'Abonniert: ', en: 'Subscribed: ' }) + p.title); }
      st.subs = await api.podcasts.subscriptions();
      if (st.curated) for (const c of st.curated.podcasts) c.subscribed = isSubscribed(c.feedUrl);
    } catch (e) { toast(e.message); }
    renderShows(); renderDetail();
  }

  async function importOpml() {
    try {
      const r = await api.podcasts.importOpml();
      if (!r) return;
      toast(tr({ de: '{a} von {t} Podcasts importiert', en: 'Imported {a} of {t} podcasts' }, { a: r.added, t: r.total }));
      st.subs = await api.podcasts.subscriptions(); st.tab = 'subs'; renderHeader(); renderShows();
    } catch (e) { toast(e.message); }
  }
  async function exportOpml() {
    try { const f = await api.podcasts.exportOpml(); if (f) toast(tr({ de: 'Gespeichert: ', en: 'Saved: ' }) + f); } catch (e) { toast(e.message); }
  }

  // ---- player bar ----------------------------------------------------------------------------------------------------
  let dragging = false;
  function renderPlayer(s = podcastPlayer.state) {
    clear(playerBar);
    const cur = s.current;
    if (!cur) { playerBar.appendChild(h('div.pod-player-idle', h('span.pod-dial.small'), h('span.muted', tr({ de: 'Kein Podcast läuft. Zum Abspielen eine Folge wählen.', en: 'Nothing is playing. Pick an episode to play it.' })))); playerBar.classList.add('idle'); return; }
    playerBar.classList.remove('idle');
    const dur = s.duration || cur.episode.duration || 0;
    const slider = h('input.range.pod-slider', { type: 'range', min: 0, max: Math.max(1, Math.round(dur)), value: Math.round(s.position), step: 1 });
    slider.addEventListener('input', () => { dragging = true; playerBar.querySelector('.pod-time-cur').textContent = formatTime(+slider.value); });
    slider.addEventListener('change', () => { dragging = false; podcastPlayer.seek(+slider.value); });
    const sleepLeft = s.sleepUntil ? Math.max(0, Math.ceil((s.sleepUntil - Date.now()) / 60000)) : 0;
    const sleepBtn = h('button.btn.small.ghost.pod-sleep', { class: s.sleepUntil ? 'on' : '', title: tr({ de: 'Einschlaf-Timer', en: 'Sleep timer' }), onclick: (e) => { e.stopPropagation(); openSleepMenu(sleepBtn); } }, '☾ ' + (s.sleepUntil ? sleepLeft + ' min' : tr({ de: 'Timer', en: 'Timer' })));
    playerBar.append(
      h('div.pod-player-art', cur.show?.artwork || cur.episode.image ? h('img', { src: cur.show?.artwork || cur.episode.image, alt: '', onerror: (e) => e.target.remove() }) : h('span', '🎙')),
      h('div.pod-player-info', h('div.pod-player-title', { title: cur.episode.title }, cur.episode.title), h('div.pod-player-show', cur.show?.title || '', s.buffering ? h('span.pod-buffering', ' · ' + tr({ de: 'lädt …', en: 'buffering …' })) : null, s.error ? h('span.pod-err', ' · ' + s.error) : null)),
      h('div.pod-player-controls',
        h('button.btn.icon.pod-ctl', { title: '−30 s', onclick: () => podcastPlayer.skip(-30) }, h('span.pod-ctl-l', '−30')),
        h('button.btn.icon.pod-ctl', { title: '−15 s', onclick: () => podcastPlayer.skip(-15) }, h('span.pod-ctl-l', '−15')),
        h('button.btn.icon.pod-ctl.main', { title: s.playing ? tr({ de: 'Pause', en: 'Pause' }) : tr({ de: 'Weiter', en: 'Play' }), onclick: () => podcastPlayer.toggle() }, s.playing ? '❚❚' : '▶'),
        h('button.btn.icon.pod-ctl', { title: '+15 s', onclick: () => podcastPlayer.skip(15) }, h('span.pod-ctl-l', '+15')),
        h('button.btn.icon.pod-ctl', { title: '+30 s', onclick: () => podcastPlayer.skip(30) }, h('span.pod-ctl-l', '+30')),
      ),
      h('div.pod-player-seek', h('span.pod-time.pod-time-cur', formatTime(s.position)), slider, h('span.pod-time', formatTime(dur))),
      h('div.pod-player-extra',
        h('button.btn.small.ghost.pod-rate', { title: tr({ de: 'Geschwindigkeit', en: 'Speed' }), onclick: () => podcastPlayer.cycleRate() }, s.rate.toFixed(2).replace(/\.?0+$/, '').replace('.', i18n.lang === 'en' ? '.' : ',') + '×'),
        sleepBtn,
        h('span.pod-vol', '🔉', h('input.range.pod-volume', { type: 'range', min: 0, max: 1, step: 0.02, value: s.volume, oninput: (e) => podcastPlayer.setVolume(+e.target.value) })),
        h('button.btn.small.ghost', { title: tr({ de: 'Stopp', en: 'Stop' }), onclick: () => podcastPlayer.stop() }, '■'),
      ),
    );
  }
  function openSleepMenu(anchor) {
    const existing = panel.querySelector('.pod-sleep-menu'); if (existing) { existing.remove(); return; }
    const menu = h('div.pod-sleep-menu', SLEEP_OPTIONS.map((m) => h('button.btn.small.ghost', { onclick: () => { podcastPlayer.setSleep(m); menu.remove(); toast(tr({ de: `Schlaf-Timer: ${m} Minuten`, en: `Sleep timer: ${m} minutes` })); } }, `${m} min`)), h('button.btn.small.ghost', { onclick: () => { podcastPlayer.setSleep(null); menu.remove(); } }, tr({ de: 'Aus', en: 'Off' })));
    const r = anchor.getBoundingClientRect(); const pr = panel.getBoundingClientRect();
    menu.style.left = (r.left - pr.left) + 'px'; menu.style.bottom = (pr.bottom - r.top + 6) + 'px';
    panel.appendChild(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
  }

  // live updates from the player: cheap partial update while dragging, full re-render on state changes
  let lastKey = '';
  const offPlayer = podcastPlayer.onChange((s) => {
    // the minutes left of the sleep timer are part of the key: the button showed its first value until something else changed
    const sleepLeft = s.sleepUntil ? Math.max(0, Math.ceil((s.sleepUntil - Date.now()) / 60000)) : 0;
    const key = [s.current?.episode.id, s.playing, s.rate, s.buffering, s.error, s.sleepUntil, sleepLeft, Math.round(s.duration)].join('|');
    if (key !== lastKey) { lastKey = key; renderPlayer(s); if (st.show) renderDetail(); return; }
    if (!dragging) { const sl = playerBar.querySelector('.pod-slider'); if (sl) { sl.value = Math.round(s.position); playerBar.querySelector('.pod-time-cur').textContent = formatTime(s.position); } }
    const bar = detail.querySelector(`.pod-ep[data-id="${s.current?.episode.id}"] .pod-ep-progress > i`);
    if (bar && s.duration) bar.style.width = ((s.position / s.duration) * 100).toFixed(1) + '%';
  });
  const offLang = bus.on('i18n:change', () => { renderHeader(); renderShows(); renderDetail(); renderPlayer(); });

  // ---- boot ---------------------------------------------------------------------------------------------------------
  renderHeader(); renderShows(); renderDetail(); renderPlayer();
  try { st.subs = await api.podcasts.subscriptions(); } catch (e) { toast(e.message); }
  if (!st.subs.length && st.tab === 'subs' && !params.tab) st.tab = 'curated';
  renderHeader(); renderShows();
  api.podcasts.curated().then((c) => { st.curated = c && c.podcasts ? c : { topics: [], podcasts: c || [] }; if (st.tab === 'curated') renderShows(); }).catch(() => {});
  // the first view is one step, whichever podcast it shows
  restoring = true;
  if (params.feedUrl) openShow({ feedUrl: params.feedUrl, title: params.title || params.feedUrl });
  else if (podcastPlayer.current) openShow(podcastPlayer.current.show);
  else if (st.subs.length) openShow(st.subs[0]);
  restoring = false;
  hist.push(snapshot());

  return {
    unmount() { offPlayer(); offLang(); navBtns.dispose?.(); ++st.token; },
    /** the mouse's side buttons (panels.js) */
    onNav(dir) { hist.go(dir); return true; },
    onKey(e) {
      if (hist.onKey(e)) return true;
      if (e.target && /input|textarea/i.test(e.target.tagName)) return false;
      if (e.key === ' ') { if (podcastPlayer.current) { podcastPlayer.toggle(); return true; } return false; }
      if (e.key === 'ArrowLeft') { podcastPlayer.skip(-15); return true; }
      if (e.key === 'ArrowRight') { podcastPlayer.skip(15); return true; }
      return false;
    },
  };
}
