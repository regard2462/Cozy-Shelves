// Mediathek panel: the public broadcasters' Mediatheken (ARD, ZDF, arte, 3sat, phoenix, KiKA, the regional
// ARD broadcasters, DW, ORF, SRF … via MediathekViewWeb), English-language sources (DW, NHK WORLD-JAPAN,
// arte in English, NASA, the Internet Archive, TED), live TV, Merkliste, Weiterschauen and downloads. The sources of
// the interface language come first (views.js).
// Films play inside the panel, as sound only (HUD mini player) or on the screen in the hall.
//
// Contract: mount(container, ctx, params) → { unmount, onKey }.
//   params.section  'start' | 'search' | 'channels' | 'live' | 'favorites' | 'continue' | 'downloads'
//   params.query    text for the search section
//   params.play     item → open it and start it in the panel
//   params.open     item → open its detail view
//   params.show     'player' → show the film that is playing (from the mini player: "Im Fenster")
// Backend: electron/mediathek (api.invoke('mediathek:…')), player: app/src/media/media-player.js.
import { h, clear } from '../../core/dom.js';
import { tr } from '../../core/i18n.js';
import { mediaPlayer } from '../../media/media-player.js';
import { createStore } from './data.js';
import { createCards } from './cards.js';
import { createDetail } from './detail.js';
import { icon } from './icons.js';
import { channelName, errText } from './format.js';
import { startView, searchView, listView, channelsView, channelView, liveView, favoritesView, continueView, downloadsView } from './views.js';
import { createNavHistory } from '../nav-history.js';

const T = (de, en, vars) => tr({ de, en }, vars);
const CSS_HREF = './styles/mediathek.css';
function ensureCss() {
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /mediathek\.css/.test(l.getAttribute('href') || ''))) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href: CSS_HREF }));
}

const SECTIONS = [
  { id: 'start', icon: 'home', label: () => T('Start', 'Home') },
  { id: 'search', icon: 'search', label: () => T('Suche', 'Search') },
  { id: 'channels', icon: 'channels', label: () => T('Sender', 'Channels') },
  { id: 'live', icon: 'live', label: () => T('Live-TV', 'Live TV') },
  { id: 'favorites', icon: 'bookmark', label: () => T('Merkliste', 'Watchlist') },
  { id: 'continue', icon: 'resume', label: () => T('Weiterschauen', 'Continue') },
  { id: 'downloads', icon: 'download', label: () => T('Downloads', 'Downloads') },
];
const SECTION_OF = { start: 'start', search: 'search', channels: 'channels', channel: 'channels', topic: 'channels', live: 'live', favorites: 'favorites', continue: 'continue', downloads: 'downloads' };

export async function mount(container, ctx, params = {}) {
  ensureCss();
  const store = createStore();
  const toast = (m) => ctx.toast?.(m);
  let view = null, route = null, nav = 'start', liveNow = {};
  const offs = [];
  // back and forward: every section, sub-page and film view is a step
  let restoring = false;
  const routeKey = (r) => JSON.stringify(r || {}, (k, v) => (k === 'back' ? undefined : v));
  const hist = createNavHistory({
    onGo: (e) => {
      restoring = true;
      try {
        // the same page under a film view stays as it is (scroll position, loaded results)
        if (routeKey(e.route) !== routeKey(route)) open(e.route);
        else if (detail.open && !e.item) { detail.hide(); syncDock(); }
        if (e.item && detail.item?.id !== e.item.id) show(e.item);
      } finally { restoring = false; }
    },
    same: (a, b) => routeKey(a?.route) === routeKey(b?.route) && (a?.item?.id || null) === (b?.item?.id || null),
  });
  const record = (entry) => { if (!restoring) hist.push(entry); };
  const navBtns = hist.buttons();

  // ---- skeleton ----
  const nowChip = h('button.mt-nowchip.hidden', { onclick: () => showPlaying() });
  const brandSub = h('div.mt-brand-sub');
  const brandText = () => { brandSub.textContent = T('ARD · ZDF · arte · 3sat · phoenix und die Dritten · Englischsprachiges von DW, NHK, NASA und TED', 'DW · NHK WORLD · NASA · TED · Internet Archive · ARD · ZDF · arte and the German public broadcasters'); };
  brandText();
  const header = h('header.mt-header',
    navBtns,
    h('div.mt-brand', h('span.mt-brand-mark', icon('film')), h('div', h('div.mt-brand-title', T('Mediathek', 'Mediathek')), brandSub)),
    h('span.spacer'), nowChip,
    h('button.btn.small.icon.mt-close', { title: T('Schließen (Esc)', 'Close (Esc)'), 'aria-label': T('Schließen', 'Close'), onclick: () => ctx.close() }, icon('close')));
  const navEl = h('nav.mt-nav', { 'aria-label': T('Bereiche', 'Sections') });
  const main = h('main.mt-main');
  const dockHost = h('div.mt-dock-video');
  const dockTitle = h('div.mt-dock-title');
  const dock = h('div.mt-dock.hidden', { role: 'button', tabindex: 0, title: T('Zum Film', 'Back to the film'), onclick: () => showPlaying(), onkeydown: (e) => { if (e.key === 'Enter') showPlaying(); } },
    dockHost, h('div.mt-dock-bar', dockTitle, h('button.mt-dock-x', { title: T('Film beenden', 'Stop the film'), onclick: (e) => { e.stopPropagation(); mediaPlayer.stop(); } }, icon('close'))));
  const cards = createCards({ store, onOpen: (it) => show(it), onPlayLive: (ch) => playLive(ch) });
  /** the film view closed by hand: back when the page under it is the step before, else a new step */
  const onDetailClosed = () => {
    if (restoring) return;
    const prev = hist.peek(-1);
    if (prev && !prev.item && routeKey(prev.route) === routeKey(route)) { restoring = true; try { hist.back(); } finally { restoring = false; } return; }
    record({ route });
  };
  const detail = createDetail({ ctx, store, cards, open, watch, toast, onClose: onDetailClosed });
  const body = h('div.mt-body', navEl, h('div.mt-content', main, detail.el, dock));
  const panel = h('div.panel.paper.mt-panel', { role: 'dialog', 'aria-label': T('Mediathek', 'Mediathek') }, header, body);
  container.appendChild(panel);

  const env = { store, cards, open, show, playLive, playDownload, toast, ctx, onNow: (n) => { liveNow = { ...liveNow, ...n }; } };

  function renderNav() {
    clear(navEl);
    const favs = store.state.favorites.length;
    const active = [...store.state.downloads.values()].filter((d) => d.status === 'running' || d.status === 'queued').length;
    for (const s of SECTIONS) {
      const count = s.id === 'favorites' && favs ? String(favs) : s.id === 'downloads' && active ? String(active) : null;
      navEl.appendChild(h('button.mt-navitem', { class: nav === s.id ? 'active' : '', 'aria-current': nav === s.id ? 'page' : null, title: s.label(), onclick: () => open({ kind: s.id }) },
        icon(s.icon), h('span.mt-navlabel', s.label()), count ? h('span.mt-navcount', { class: s.id === 'downloads' ? 'busy' : '' }, count) : null));
    }
    navEl.appendChild(h('div.mt-nav-foot', T('Daten von MediathekViewWeb, DW, NHK WORLD-JAPAN, NASA, dem Internet Archive und TED, Live-Liste aus der App Zapp', 'Data by MediathekViewWeb, DW, NHK WORLD-JAPAN, NASA, the Internet Archive and TED, live list from the Zapp app')));
  }

  /** Open a section or sub-page. */
  function open(r) {
    if (detail.open) detail.hide();
    syncDock();
    view?.dispose?.();
    route = r;
    record({ route: r });
    nav = SECTION_OF[r.kind] || nav;
    renderNav();
    clear(main);
    main.scrollTop = 0;
    const back = r.back?.route ? { label: r.back.label, go: () => open(r.back.route) } : r.back;
    switch (r.kind) {
      case 'search': view = searchView(env, r); break;
      case 'channels': view = channelsView(env); break;
      case 'channel': view = channelView(env, r); break;
      case 'topic': view = listView(env, { title: r.topic, sub: r.channel ? channelName(r.channel) : null, query: { topic: r.topic, channels: r.channel ? [r.channel] : undefined }, back: r.channel ? { label: channelName(r.channel), go: () => open({ kind: 'channel', channel: r.channel }) } : null }); break;
      case 'list': view = listView(env, { title: r.title, sub: r.sub, query: r.query, back }); break;
      case 'live': view = liveView(env); break;
      case 'favorites': view = favoritesView(env); break;
      case 'continue': view = continueView(env); break;
      case 'downloads': view = downloadsView(env); break;
      default: route = { kind: 'start' }; view = startView(env);
    }
    main.appendChild(view.el);
  }

  function show(item, opts) { detail.show(item, opts); syncDock(); record({ route, item }); }

  const liveItem = (ch) => {
    const n = liveNow[ch.id];
    return { id: 'live:' + ch.id, title: ch.name, channel: ch.mvw, channelName: ch.name, color: ch.color, live: true, hls: true, src: ch.src || ch.stream, program: n || null, now: n ? n.title : null, lang: ch.lang || null };
  };
  function playLive(ch) { show(liveItem(ch), { autoplay: 'panel' }); }

  async function playDownload(d, mode = 'panel') {
    try {
      const p = await store.playable(d.id);
      if (!p || p.missing) { toast(T('Die heruntergeladene Datei fehlt.', 'The downloaded file is missing.')); return; }
      const item = { ...d.item, src: p.src, hls: p.hls, subtitleUrl: p.subtitleUrl, local: true };
      if (mode === 'screen') { await watch(item, 'screen'); return; }
      show(item, { autoplay: 'panel' });
    } catch (e) { toast(errText(e)); }
  }

  /** Start a film: 'panel' (in the detail view), 'audio' (sound only) or 'screen' (the screen in the hall). */
  async function watch(item, mode) {
    if (!item) return;
    if (mode === 'panel') {
      if (!detail.open || detail.item?.id !== item.id) detail.show(item);
      await detail.play(item, 'panel');
      syncDock();
      return;
    }
    const p = detail.play(item, mode);
    if (mode === 'screen') { ctx.bus.emit('cinema:watch'); return p; }
    await p;
    syncDock();
    toast(T('Der Ton läuft weiter, auch wenn die Mediathek zu ist. K hält an, V öffnet sie wieder.', 'The sound keeps playing when the Mediathek is closed. K pauses, V opens it again.'));
  }

  /** The film that is playing, shown in the detail view with the player (from the dock, the header chip or the mini player). */
  function showPlaying() {
    const cur = mediaPlayer.current;
    if (!cur) return;
    if (!detail.open || detail.item?.id !== cur.id) detail.show(cur);
    if (mediaPlayer.mode !== 'panel') mediaPlayer.setMode('panel');
    detail.stage.attach();
    syncDock();
  }

  /** A film playing in the panel while no detail view is open lives in the small dock at the bottom right. */
  function syncDock() {
    const s = mediaPlayer.state;
    const inPanel = !!s.current && s.mode === 'panel';
    // the dock also stays while the detail view of another film is open
    const wantDock = inPanel && !(detail.open && detail.stage.attached);
    dock.classList.toggle('hidden', !wantDock);
    if (wantDock && !dockHost.contains(mediaPlayer.video)) mediaPlayer.attach(dockHost);
    if (wantDock) dockTitle.textContent = s.current.title || '';
    // header chip: something plays as sound or on the screen
    const elsewhere = !!s.current && (s.mode === 'audio' || s.mode === 'screen');
    nowChip.classList.toggle('hidden', !elsewhere);
    if (elsewhere) {
      clear(nowChip);
      nowChip.append(icon(s.mode === 'screen' ? 'screen' : 'headphones'), h('span.mt-nowchip-text', h('span.mt-nowchip-label', s.mode === 'screen' ? T('Auf der Leinwand', 'On the screen') : T('Läuft als Ton', 'Playing as sound')), h('span.mt-nowchip-title', s.current.title || '')), h('span.mt-nowchip-go', T('Im Fenster ansehen', 'Watch in the window')));
    }
  }
  let lastKey = '';
  offs.push(mediaPlayer.onChange((s) => {
    const key = `${s.current?.id || ''}|${s.mode || ''}|${detail.open}|${detail.stage.attached}`;
    if (key !== lastKey) { lastKey = key; syncDock(); }
  }));
  offs.push(store.on((topic) => { if (topic === 'favorites' || topic === 'downloads') renderNav(); }));
  offs.push(ctx.bus.on('i18n:change', () => { brandText(); renderNav(); if (route) open(route); }));

  // ---- start ----
  renderNav();
  main.appendChild(h('div.mt-loading', h('div.mt-spinner')));
  try { await store.channels(); } catch (e) { console.warn('[mediathek] channels', e); }
  store.loadFavorites().catch(() => {});
  store.loadProgress().catch(() => {});
  store.loadDownloads().catch(() => {});
  store.live().catch(() => {});
  const section = SECTIONS.some((s) => s.id === params.section) ? params.section : params.query ? 'search' : 'start';
  open({ kind: section, text: params.query || '' });
  if (params.play) show(params.play, { autoplay: 'panel' });
  else if (params.open) show(params.open);
  else if (params.show === 'player' && mediaPlayer.current) showPlaying();
  syncDock();

  return {
    unmount() {
      if (mediaPlayer.current && mediaPlayer.mode === 'panel') mediaPlayer.setMode('audio');
      mediaPlayer.detach();
      for (const off of offs) { try { off(); } catch {} }
      view?.dispose?.();
      detail.destroy();
      navBtns.dispose?.();
      cards.dispose();
      store.dispose();
    },
    /** the mouse's side buttons (panels.js) */
    onNav(dir) { hist.go(dir); return true; },
    onKey(e) {
      if (hist.onKey(e)) return true;
      if (detail.onKey(e)) return true;
      // the film in the dock keeps its keys
      if (!dock.classList.contains('hidden') && mediaPlayer.mode === 'panel') {
        const k = e.key;
        if (k === ' ' || k === 'k' || k === 'K') { mediaPlayer.toggle(); return true; }
        if (k === 'j' || k === 'J' || k === 'ArrowLeft') { mediaPlayer.skip(k === 'ArrowLeft' ? -5 : -10); return true; }
        if (k === 'l' || k === 'L' || k === 'ArrowRight') { mediaPlayer.skip(k === 'ArrowRight' ? 5 : 10); return true; }
        if (k === 'm' || k === 'M') { mediaPlayer.toggleMute(); return true; }
        if (k === 'f' || k === 'F') { showPlaying(); detail.stage.toggleFullscreen(true); return true; }
      }
      if (e.key === 'Escape') {
        if (route?.kind === 'channel') { open({ kind: 'channels' }); return true; }
        if (route?.kind === 'topic' && route.channel) { open({ kind: 'channel', channel: route.channel }); return true; }
        if (route?.kind === 'list' && route.back) { const b = route.back.route ? () => open(route.back.route) : route.back.go; b(); return true; }
        return false;
      }
      if (e.key === '/' && route?.kind !== 'search') { open({ kind: 'search' }); return true; }
      return false;
    },
  };
}
export default { mount };
