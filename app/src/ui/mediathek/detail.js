// Detail view of a film or a live channel: picture or player, the facts (Sendung, Sender, Datum, Dauer,
// Beschreibung) and the actions Ansehen · Auf der Leinwand zeigen · Anhören · Herunterladen · Untertitel ·
// Merken · Webseite öffnen. It lies over the section view inside the panel; Escape or "Zurück" closes it.
// A film of an English-language source is first resolved (its files and their sizes, sources/*.js); the download
// menu lists the real picture sizes ("1080p · 1,2 GB") with the one closest to the setting preselected.
import { h, clear } from '../../core/dom.js';
import { tr } from '../../core/i18n.js';
import { mediaPlayer } from '../../media/media-player.js';
import { createStage } from './player-ui.js';
import { thumbUrl } from './cards.js';
import { icon } from './icons.js';
import { channelName, channelColor, channelOf, channelLong, titleOf, formatDate, formatClock, formatDuration, formatBytes, formatSpeed, qualityName, VARIANT_NAMES, GEO_NOTE, errText } from './format.js';
import { defaultDownload } from '../../media/quality.js';

const T = (de, en, vars) => tr({ de, en }, vars);
const btn = (cls, ico, label, props = {}) => h('button.btn' + cls, props, ico ? icon(ico) : null, label ? h('span', label) : null);
/** append children, skipping null/false (the DOM's own append() would insert the text "null") */
const put = (el, ...kids) => { for (const k of kids.flat()) if (k != null && k !== false) el.append(k); return el; };

/**
 * Where the "Sendung" of a film leads and what "Mehr aus …" lists: a topic of MediathekViewWeb, or for the
 * English-language sources an NHK programme, a NASA keyword, an archive collection, a TED speaker.
 * DW names only a category its API cannot list: null (the category stays plain text).
 */
function topicOf(it) {
  if (!it || it.live || !it.topic || it.topic === it.title) return null;
  if (!it.source) return { label: T('Sendung', 'Programme'), query: { topic: it.topic, channels: [it.channel] }, route: { kind: 'topic', topic: it.topic, channel: it.channel } };
  const list = (query, label) => ({ label, query, route: { kind: 'list', title: it.topic, sub: channelLong(channelOf(it.channel)), query } });
  switch (it.source) {
    case 'nhk': return it.programId ? list({ source: 'nhk', topic: 'program:' + it.programId }, T('Sendung', 'Programme')) : null;
    case 'nasa': return list({ source: 'nasa', text: it.topic }, T('Thema', 'Topic'));
    case 'archive': return it.collectionId ? list({ source: 'archive', topic: it.collectionId }, T('Sammlung', 'Collection')) : null;
    case 'ted': return list({ source: 'ted', text: it.topic }, T('Vortrag von', 'Talk by'));
    default: return null;
  }
}

export function createDetail({ ctx, store, cards, open, watch, toast, onClose = null }) {
  let item = null, token = 0, menu = null, offStore = null, offPlayer = null, moreRow = null, actionsKey = '';
  const stage = createStage({
    onScreen: () => watch(item, 'screen'),
    onAudio: () => watch(item, 'audio'),
    onFullscreen: (on) => el.closest('.mt-panel')?.classList.toggle('stage-full', on),
  });
  const facts = h('div.mt-facts');
  const actions = h('div.mt-actions');
  const status = h('div.mt-dlstatus');
  const desc = h('div.mt-desc');
  const extra = h('div.mt-extra');
  const more = h('div.mt-more');
  const scroller = h('div.mt-detail-scroll',
    h('div.mt-detail-top', h('div.mt-detail-stage', stage.el), h('div.mt-detail-info', facts, actions, status, desc, extra)),
    more);
  // closed by the person (Zurück, Escape): the panel records it as a step of its history
  const backBtn = h('button.btn.small.ghost.mt-back', { onclick: () => { api.hide(); onClose?.(); } }, icon('left'), h('span', T('Zurück', 'Back')));
  const el = h('div.mt-detail.hidden', { role: 'dialog', 'aria-modal': 'false' }, h('div.mt-detail-bar', backBtn, h('span.mt-detail-crumb')), scroller);

  function posterFor(it) {
    const box = h('div.mt-poster.big', { style: '--ch:' + (it.live ? (it.color || channelColor(it.channel)) : channelColor(it.channel)) },
      cards.typographic(it.channel, it.live ? it.channelName : (it.topic || it.title), { big: true }));
    const url = !it.live && thumbUrl(it);
    if (url) {
      const img = h('img.mt-img', { alt: '', src: url, draggable: false });
      img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
      img.addEventListener('error', () => img.remove(), { once: true });
      box.appendChild(img);
    }
    if (it.live) box.appendChild(h('span.mt-badge.mt-onair', h('i'), 'LIVE'));
    return box;
  }

  /** The item the player gets: poster, channel name, local source of a finished download if asked for. */
  const forPlayer = (it) => ({ ...it, poster: it.live ? '' : thumbUrl(it) || '', channelName: it.channelName || channelName(it.channel) });

  function renderFacts() {
    clear(facts);
    const it = item;
    const meta = [];
    meta.push(h('span.mt-chip', { style: '--ch:' + (it.live ? it.color : channelColor(it.channel)) }, it.live ? it.channelName : channelName(it.channel)));
    if (it.live) meta.push(h('span.mt-live-dot', h('i'), T('Live', 'Live')));
    // films of the Internet Archive only know their year; the English-language sources name the day, not the hour
    if (it.year) meta.push(h('span', String(it.year)));
    else if (it.timestamp && it.source) meta.push(h('span', formatDate(it.timestamp)));
    else if (it.timestamp) meta.push(h('span', T('{d}, {t} Uhr', '{d}, {t}', { d: formatDate(it.timestamp), t: formatClock(it.timestamp) })));
    if (it.duration) meta.push(h('span', formatDuration(it.duration)));
    put(facts,
      h('div.mt-facts-meta', meta),
      h('h1.mt-detail-title', it.live ? (it.program?.title || it.channelName) : titleOf(it)),
      topicOf(it) ? h('div.mt-detail-topic', h('span.mt-label', topicOf(it).label), h('button.linkish', { onclick: () => open(topicOf(it).route) }, it.topic))
        : !it.live && it.topic && it.topic !== it.title ? h('div.mt-detail-topic', h('span.mt-label', T('Thema', 'Topic')), it.topic) : null,
      it.live && it.program ? h('div.mt-detail-topic', h('span.mt-label', T('Läuft gerade', 'On now')), it.program.start && it.program.end ? T('{a} bis {b} Uhr', '{a} to {b}', { a: formatClock(it.program.start), b: formatClock(it.program.end) }) : '', it.program.subtitle ? ' · ' + it.program.subtitle : '') : null,
    );
    const notes = [];
    if (it.geo && GEO_NOTE[it.geo]) notes.push(GEO_NOTE[it.geo]());
    const cn = channelOf(it.channel).note;
    if (cn && !it.geo) notes.push(tr(cn));
    if (it.variant && VARIANT_NAMES[it.variant]) notes.push(VARIANT_NAMES[it.variant]());
    if (notes.length) facts.appendChild(h('div.mt-notes', notes.map((n) => h('span.mt-note', icon('info'), n))));
  }

  /** Two groups: the three ways to watch, then download, subtitles, watchlist and web page (smaller). */
  function renderActions() {
    clear(actions);
    const it = item;
    const s = mediaPlayer.state;
    const running = s.current && s.current.id === it.id && s.mode === 'panel' && !s.error;
    const main = put(h('div.mt-actions-main'),
      btn('.primary.mt-act-watch', 'play', running ? T('Läuft', 'Playing') : T('Ansehen', 'Watch'), { onclick: () => watch(it, 'panel') }),
      btn('.mt-act-screen', 'screen', T('Auf der Leinwand zeigen', 'Show on the screen'), { onclick: () => watch(it, 'screen') }),
      btn('.mt-act-audio', 'headphones', T('Anhören', 'Listen'), { onclick: () => watch(it, 'audio') }));
    actions.appendChild(main);
    if (it.live) return;
    const dlWrap = h('span.mt-menu-wrap');
    dlWrap.appendChild(btn('.small.mt-act-dl', 'download', T('Herunterladen', 'Download'), { 'aria-haspopup': 'menu', onclick: (e) => { e.stopPropagation(); toggleDownloadMenu(dlWrap); } }));
    const fav = store.isFavorite(it.id);
    actions.appendChild(put(h('div.mt-actions-more'), dlWrap,
      it.subtitle ? btn('.small.mt-act-subs' + (s.subtitles ? '.on' : ''), 'subtitles', s.subtitles ? T('Untertitel an', 'Subtitles on') : T('Untertitel aus', 'Subtitles off'), { 'aria-pressed': String(s.subtitles), onclick: () => { mediaPlayer.setSubtitles(!mediaPlayer.state.subtitles); renderActions(); } }) : null,
      btn('.small.mt-act-fav' + (fav ? '.on' : ''), fav ? 'starFilled' : 'star', fav ? T('Gemerkt', 'Saved') : T('Merken', 'Save'), { 'aria-pressed': String(fav), onclick: async () => { try { const on = await store.toggleFavorite(item || it); toast(on ? T('Auf die Merkliste gesetzt', 'Added to your watchlist') : T('Von der Merkliste genommen', 'Removed from your watchlist')); } catch (e) { toast(errText(e)); } renderActions(); } }),
      it.website ? btn('.small.ghost.mt-act-web', 'globe', T('Webseite öffnen', 'Open web page'), { title: it.website, onclick: () => ctx.openPanel('browser', { url: it.website }) }) : null));
  }

  function renderStatus() {
    clear(status);
    if (!item || item.live) return;
    const list = store.downloadsOf(item.id);
    for (const d of list) {
      const q = qualityName(d.quality, d.height);
      if (d.status === 'done') {
        status.appendChild(h('div.mt-dlline.done', icon('check'), h('span', T('Heruntergeladen ({q})', 'Downloaded ({q})', { q })), h('button.linkish', { onclick: () => playLocal(d) }, T('Offline abspielen', 'Play offline')), h('button.linkish', { onclick: () => store.reveal(d.id) }, T('Im Ordner zeigen', 'Show in folder'))));
      } else if (d.status === 'running' || d.status === 'queued') {
        const pct = Math.round((d.fraction || 0) * 100);
        status.appendChild(h('div.mt-dlline', h('div.mt-dlbar', h('i', { style: { width: pct + '%' } })),
          h('span', d.status === 'queued' ? T('Wartet', 'Waiting') : T('{p} % · {s}', '{p} % · {s}', { p: pct, s: [formatBytes(d.bytes), formatSpeed(d.speed)].filter(Boolean).join(' · ') })),
          h('button.linkish', { onclick: () => store.pause(d.id) }, T('Anhalten', 'Pause'))));
      } else {
        status.appendChild(h('div.mt-dlline.err', h('span', d.status === 'paused' ? T('Angehalten', 'Paused') : (d.error || T('Fehler', 'Error'))), h('button.linkish', { onclick: () => store.resume(d.id) }, T('Fortsetzen', 'Resume')), h('button.linkish', { onclick: () => store.remove(d.id) }, T('Verwerfen', 'Discard'))));
      }
    }
  }

  async function playLocal(d) {
    try {
      const p = await store.playable(d.id);
      if (!p || p.missing) { toast(T('Die heruntergeladene Datei fehlt.', 'The downloaded file is missing.')); return; }
      await startPlayback({ ...d.item, ...p, poster: thumbUrl(d.item) || '', channelName: channelName(d.item.channel), local: true }, 'panel');
    } catch (e) { toast(errText(e)); }
  }

  function closeMenu() { if (menu) { menu.remove(); menu = null; return true; } return false; }
  async function toggleDownloadMenu(wrap) {
    if (closeMenu()) return;
    const it = item;
    if (!it) return;
    const list = h('div.mt-dlq');
    const folderLine = h('div.mt-menu-foot');
    menu = h('div.mt-menu', { role: 'menu', onclick: (e) => e.stopPropagation(), onkeydown: (e) => menuKeys(e) }, h('div.mt-menu-head', T('Qualität wählen', 'Choose quality')), list, folderLine);
    wrap.appendChild(menu);
    list.appendChild(h('div.mt-dlq-wait', T('Größen werden ermittelt', 'Checking the sizes')));
    store.folder().then((f) => { if (f && menu) folderLine.append(h('span', T('Speichert in', 'Saves to')), ' ', h('span.mt-path', f.folder)); });
    // the picture sizes and file sizes of every quality; the size closest to the setting is preselected
    // ("Automatisch": the biggest)
    const ready = await ensure(it);
    const options = ready ? await store.downloadOptions(ready) : [];
    if (!menu || item !== it && item?.id !== it.id) return;
    clear(list);
    const known = options.filter((o) => o.height);
    const def = (defaultDownload(known, ctx.state?.settings?.mediathek?.quality) || options[0] || {}).quality;
    for (const o of options) {
      const sizeText = o.bytes ? formatBytes(o.bytes) : o.error === 'gone' ? T('nicht mehr verfügbar', 'no longer available') : T('Größe unbekannt', 'size unknown');
      list.appendChild(h('button.mt-dlq-item', { role: 'menuitem', class: o.quality === def ? 'default' : '', dataset: { q: o.quality, height: o.height || '' }, onclick: () => startDownload(ready, o.quality, o) },
        h('span.mt-dlq-name', qualityName(o.quality, o.height)), o.quality === def ? h('span.mt-dlq-tag', T('Voreinstellung', 'Default')) : null,
        h('span.mt-dlq-size', { class: o.error ? 'bad' : '' }, sizeText)));
    }
    if (!options.length) list.appendChild(h('div.mt-dlq-wait', T('Dieser Film lässt sich nicht herunterladen.', 'This film cannot be downloaded.')));
    // the default has the focus: Enter downloads it, the arrows move
    setTimeout(() => menu?.querySelector('.mt-dlq-item.default')?.focus({ preventScroll: true }), 0);
  }
  /** Arrow keys inside the download menu. */
  function menuKeys(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(menu?.querySelectorAll('.mt-dlq-item') || [])];
    if (!items.length) return;
    e.preventDefault(); e.stopPropagation();
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus({ preventScroll: true });
  }
  async function startDownload(it, q, option = null) {
    closeMenu();
    try {
      // the picture size travels with the film, the download list names it
      const withSize = option && option.height && it.video && it.video[q] ? { ...it, heights: { ...(it.heights || {}), [q]: { width: option.width || 0, height: option.height, p: option.height } } } : it;
      const d = await store.download(withSize, q);
      toast(d.status === 'done' ? T('Dieser Film ist schon heruntergeladen.', 'This film is already downloaded.') : T('»{t}« wird heruntergeladen.', '“{t}” is being downloaded.', { t: it.title }));
    } catch (e) { toast(errText(e)); }
    renderStatus();
  }

  async function renderMore() {
    clear(more);
    moreRow?._dispose?.();
    const it = item;
    const tp = topicOf(it);
    if (it.live) {
      if (!it.channel) return;
      // a live channel of an English-language source shows the newest films of that source
      const src = channelOf(it.channel).source;
      const q = src && src !== 'arte-en' ? { source: src, size: 24 } : { channels: [it.channel], durationMin: 300, size: 24 };
      moreRow = cards.row({ title: T('Neu in der Mediathek von {c}', 'New in the {c} Mediathek', { c: channelName(it.channel) }), load: async () => (await store.query(q)).items, onAll: () => open({ kind: 'channel', channel: it.channel }), empty: null });
    } else if (tp) {
      moreRow = cards.row({ title: T('Mehr aus »{t}«', 'More from “{t}”', { t: it.topic }), load: async () => (await store.query({ ...tp.query, size: 24 })).items.filter((x) => x.id !== it.id), onAll: () => open(tp.route), empty: null });
    }
    if (moreRow) more.appendChild(moreRow);
  }

  async function renderVariants() {
    clear(extra);
    const it = item, my = token;
    if (it.live) return;
    const vs = await store.variants(it);
    if (my !== token || !vs.length) return;
    extra.appendChild(h('div.mt-variants', h('span.mt-variants-label', T('Weitere Fassungen', 'Other versions')),
      vs.slice(0, 6).map((v) => h('button.mt-vchip', { onclick: () => api.show(v) }, v.variant && VARIANT_NAMES[v.variant] ? VARIANT_NAMES[v.variant]() : v.title))));
  }

  function renderDesc() {
    clear(desc);
    const text = String((item.live ? item.program?.description : item.description) || '').trim();
    // MediathekViewWeb repeats the title as description for many short clips
    if (!text || text === item.title || text === item.topic) return;
    const p = h('p.mt-desc-text', text);
    desc.appendChild(p);
    if (text.length > 420) {
      p.classList.add('clamped');
      desc.appendChild(h('button.linkish.mt-desc-more', { onclick: (e) => { p.classList.toggle('clamped'); e.target.textContent = p.classList.contains('clamped') ? T('Mehr lesen', 'Read more') : T('Weniger', 'Less'); } }, T('Mehr lesen', 'Read more')));
    }
  }

  /** An item of an English-language source with its files (resolved once per view); null when that failed. */
  let resolving = null;
  async function ensure(it) {
    if (!it || !it.source || !it.lazy) return it;
    if (resolving && resolving.id === it.id) return resolving.p;
    const p = store.resolve(it).then((r) => {
      if (item && item.id === it.id) { item = { ...item, ...r, lazy: false }; renderFacts(); renderDesc(); if (!menu) renderActions(); }
      return r;
    }).catch((e) => { toast(errText(e)); if (resolving && resolving.id === it.id) resolving = null; return null; });
    resolving = { id: it.id, p };
    return p;
  }

  async function startPlayback(playItem, mode) {
    if (playItem.lazy) {
      const r = await ensure(playItem);
      if (!r) return;
      playItem = forPlayer(r);
    }
    // the positions of Weiterschauen arrive with the panel; a film started at once waits for them
    if (!playItem.live) await store.progressReady();
    const startAt = playItem.live ? 0 : store.startAt(playItem.id);
    if (mode === 'panel') {
      // the stage takes the video before play() starts, so the first frame already appears in it
      stage.attach();
    }
    try { await mediaPlayer.play(playItem, { mode, startAt }); }
    catch (e) { console.warn('[mediathek] play', e); }
    if (mode === 'panel') stage.attach();
    renderActions();
  }

  const api = {
    el,
    stage,
    get item() { return item; },
    get open() { return !el.classList.contains('hidden'); },
    /** Show a film (or live channel); { autoplay: 'panel' } starts it right away. */
    show(it, { autoplay = null } = {}) {
      closeMenu();
      token++;
      item = it;
      el.querySelector('.mt-detail-crumb').textContent = it.live ? T('Live-TV', 'Live TV') : channelName(it.channel);
      stage.setPoster(posterFor(it));
      renderFacts(); renderActions(); renderStatus(); renderDesc(); renderVariants(); renderMore();
      el.classList.remove('hidden');
      scroller.scrollTop = 0;
      const cur = mediaPlayer.current;
      if (cur && cur.id === it.id && mediaPlayer.mode === 'panel') stage.attach();
      else if (stage.attached) stage.detach();
      offStore ||= store.on((topic) => { if (!item) return; if (topic === 'downloads') renderStatus(); if (topic === 'favorites') renderActions(); });
      // labels that follow the player: "Läuft" on the watch button, "Untertitel an/aus"
      offPlayer ||= mediaPlayer.onChange((s) => {
        if (!item) return;
        const key = `${s.current?.id === item.id}|${s.mode}|${s.subtitles}|${!!s.error}`;
        if (key !== actionsKey) { actionsKey = key; if (!menu) renderActions(); }
      });
      if (autoplay) startPlayback(forPlayer(it), autoplay);
      else ensure(it);
      setTimeout(() => backBtn.focus({ preventScroll: true }), 30);
    },
    hide() {
      closeMenu();
      if (stage.fullscreen) stage.toggleFullscreen(false);
      el.classList.add('hidden');
      moreRow?._dispose?.();
      const wasAttached = stage.attached;
      if (wasAttached) stage.detach();
      item = null;
      return wasAttached;
    },
    /** Start the film of this view in a mode ('panel' | 'audio' | 'screen'). */
    play: (it, mode) => startPlayback(forPlayer(it), mode),
    forPlayer,
    refresh() { if (item) { renderActions(); renderStatus(); } },
    onKey(e) {
      if (!api.open) return false;
      if (e.key === 'Escape') {
        if (closeMenu() || stage.closeMenus()) return true;
        if (stage.fullscreen) { stage.toggleFullscreen(false); return true; }
        api.hide();
        onClose?.();
        return true;
      }
      return stage.onKey(e);
    },
    closeMenus() { return closeMenu() || stage.closeMenus(); },
    destroy() { closeMenu(); offStore?.(); offPlayer?.(); moreRow?._dispose?.(); stage.destroy(); },
  };
  el.addEventListener('click', () => closeMenu());
  return api;
}
