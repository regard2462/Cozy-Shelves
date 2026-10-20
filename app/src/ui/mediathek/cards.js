// Cards, rows and grids of the Mediathek panel. A card shows a 16:9 picture (the broadcaster's preview
// image, fetched lazily through media://thumb once the card is near the viewport; the English-language sources name
// their picture, it comes through media://image) over a typographic card in the channel's colour, which also stays
// when no image exists. A film in the other language than the interface carries a small language mark.
import { h, clear } from '../../core/dom.js';
import { tr, i18n } from '../../core/i18n.js';
import { b64url } from '../../media/media-player.js';
import { channelName, channelColor, channelOf, channelLong, titleOf, formatWhen, formatDuration, formatClock, initials, VARIANT_NAMES, errText } from './format.js';

const T = (de, en, vars) => tr({ de, en }, vars);
export const thumbUrl = (item) => (item && typeof item.image === 'string' && /^https:\/\//.test(item.image) ? `media://image/${b64url(item.image)}/bild.jpg`
  : item && item.website ? `media://thumb/${b64url(item.website)}/bild.jpg` : null);
/** The language of a film: its own, its channel's, or German (the public broadcasters). */
export const langOf = (item) => (item && (item.lang || channelOf(item.channel).lang)) || 'de';

export function createCards({ store, onOpen, onPlayLive }) {
  // one observer for all pictures of the panel: they load when they come near the visible area
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const img = e.target;
      if (img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; }
    }
  }, { rootMargin: '300px 400px' });

  function picture(url, alt) {
    if (!url) return null;
    const img = h('img.mt-img', { alt: alt || '', decoding: 'async', draggable: false, dataset: { src: url } });
    img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
    img.addEventListener('error', () => img.remove(), { once: true });
    io.observe(img);
    return img;
  }

  /** The typographic card behind every picture: channel wordmark and the name of the programme. */
  function typographic(channel, text, { big = false } = {}) {
    const name = channelName(channel);
    return h('div.mt-type', { class: big ? 'big' : '' },
      h('span.mt-type-channel', name),
      h('span.mt-type-text', text || name));
  }

  function progressBar(id, duration) {
    const p = store.progressOf(id);
    if (!p || p.state !== 'resume') return null;
    const dur = p.duration || duration || 0;
    if (!dur) return null;
    return h('div.mt-prog', { title: T('Weiterschauen ab {t}', 'Resume at {t}', { t: formatDuration(p.position) }) }, h('i', { style: { width: Math.min(100, (p.position / dur) * 100) + '%' } }));
  }

  /** A film of the Mediathek. */
  function card(item, { wide = false } = {}) {
    const p = store.progressOf(item.id);
    const dl = store.downloadsOf(item.id).find((d) => d.status === 'done');
    const poster = h('div.mt-poster', { style: '--ch:' + (channelColor(item.channel)) },
      typographic(item.channel, item.topic || item.title),
      picture(thumbUrl(item), ''),
      item.duration ? h('span.mt-badge.mt-dur', formatDuration(item.duration)) : null,
      item.variant && VARIANT_NAMES[item.variant] ? h('span.mt-badge.mt-var', VARIANT_NAMES[item.variant]()) : null,
      p && p.state === 'done' ? h('span.mt-badge.mt-seen', { title: T('Gesehen', 'Watched') }, '✓') : null,
      h('span.mt-marks', langOf(item) !== i18n.lang ? h('span.mt-mark.mt-lang', { title: langOf(item) === 'en' ? T('Auf Englisch', 'In English') : T('Auf Deutsch', 'In German') }, langOf(item).toUpperCase()) : null,
        store.isFavorite(item.id) ? h('span.mt-mark', { title: T('Auf der Merkliste', 'On your watchlist') }, '★') : null, dl ? h('span.mt-mark', { title: T('Heruntergeladen', 'Downloaded') }, '⤓') : null),
      progressBar(item.id, item.duration));
    const el = h('article.mt-card', { class: wide ? 'wide' : '', role: 'button', tabindex: 0, dataset: { id: item.id }, 'aria-label': `${item.title}, ${channelName(item.channel)}`,
      onclick: () => onOpen(item), onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); onOpen(item); } } },
      poster,
      h('div.mt-card-body',
        h('div.mt-card-meta', h('span.mt-card-channel', channelName(item.channel)), item.year ? h('span', String(item.year)) : item.timestamp ? h('span', formatWhen(item.timestamp)) : null),
        h('h3.mt-card-title', { title: item.title }, titleOf(item)),
        item.topic && item.topic !== item.title ? h('div.mt-card-topic', item.topic) : null));
    return el;
  }

  /** A live channel; `now` = { title, start, end } of the programme running now (optional). */
  function liveCard(ch, now) {
    const nowLine = h('div.mt-card-topic.mt-now', now ? now.title : T('Livestream', 'Live stream'));
    const until = h('span.mt-until', now && now.end ? T('bis {t}', 'until {t}', { t: formatClock(now.end) }) : '');
    const el = h('article.mt-card.mt-live-card', { role: 'button', tabindex: 0, dataset: { live: ch.id }, 'aria-label': T('{n} live', '{n} live', { n: ch.name }),
      onclick: () => onPlayLive(ch), onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); onPlayLive(ch); } } },
      h('div.mt-poster', { style: '--ch:' + (ch.color || channelColor(ch.mvw)) },
        h('div.mt-type.live', h('span.mt-type-text', ch.name)),
        h('span.mt-badge.mt-onair', h('i'), 'LIVE')),
      h('div.mt-card-body',
        h('div.mt-card-meta', h('span.mt-card-channel', ch.name), until),
        nowLine));
    el._setNow = (n) => { nowLine.textContent = n ? n.title : T('Livestream', 'Live stream'); nowLine.title = n && n.subtitle ? n.subtitle : ''; until.textContent = n && n.end ? T('bis {t}', 'until {t}', { t: formatClock(n.end) }) : ''; };
    return el;
  }

  /** A channel tile of the "Sender" grid. */
  function channelTile(c, onPick) {
    return h('button.mt-chan', { style: '--ch:' + (c.color), onclick: () => onPick(c), title: channelLong(c) },
      h('span.mt-chan-name', c.name),
      c.long ? h('span.mt-chan-long', channelLong(c)) : null);
  }

  function skeletons(n, wide) { return Array.from({ length: n }, () => h('div.mt-card.mt-skel', { class: wide ? 'wide' : '' }, h('div.mt-poster'), h('div.mt-card-body', h('i'), h('i'), h('i')))); }

  /**
   * A horizontal row: title, "Alle anzeigen", arrows. load() → Promise<items>. The row loads when it comes
   * near the visible area (lazy) and shows skeleton cards meanwhile.
   */
  function row({ title, subtitle, load, onAll, empty, lazy = true, render = card }) {
    const track = h('div.mt-row-track', skeletons(6));
    const left = h('button.mt-scroll.left', { 'aria-label': T('Zurück blättern', 'Scroll back'), onclick: () => track.scrollBy({ left: -track.clientWidth * 0.85, behavior: 'smooth' }) }, '‹');
    const right = h('button.mt-scroll.right', { 'aria-label': T('Weiter blättern', 'Scroll on'), onclick: () => track.scrollBy({ left: track.clientWidth * 0.85, behavior: 'smooth' }) }, '›');
    const updateArrows = () => { left.classList.toggle('off', track.scrollLeft < 8); right.classList.toggle('off', track.scrollLeft + track.clientWidth >= track.scrollWidth - 8); };
    track.addEventListener('scroll', updateArrows, { passive: true });
    const head = h('header.mt-row-head', h('div', h('h2.mt-row-title', title), subtitle ? h('div.mt-row-sub', subtitle) : null),
      onAll ? h('button.mt-all', { onclick: onAll }, T('Alle anzeigen', 'Show all'), ' ›') : null);
    const el = h('section.mt-row', head, h('div.mt-row-wrap', left, track, right));
    let loaded = false;
    async function run() {
      if (loaded) return;
      loaded = true;
      try {
        const items = await load();
        clear(track);
        if (!items || !items.length) { if (empty === null) { el.remove(); return; } track.appendChild(h('div.mt-row-empty', empty || T('Gerade nichts gefunden.', 'Nothing found right now.'))); return; }
        for (const it of items) track.appendChild(render(it));
        requestAnimationFrame(updateArrows);
      } catch (e) {
        clear(track);
        track.appendChild(h('div.mt-row-empty.err', errText(e), ' ', h('button.linkish', { onclick: () => { loaded = false; clear(track); track.append(...skeletons(6)); run(); } }, T('Erneut versuchen', 'Try again'))));
      }
    }
    if (lazy) {
      const ro = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { ro.disconnect(); run(); } }, { rootMargin: '500px 0px' });
      ro.observe(el);
      el._dispose = () => ro.disconnect();
    } else run();
    return el;
  }

  return { card, liveCard, channelTile, row, skeletons, picture, typographic, dispose: () => io.disconnect() };
}

export const variantLabel = (v) => (VARIANT_NAMES[v] ? VARIANT_NAMES[v]() : '');
export { initials };
