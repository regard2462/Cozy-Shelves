// Merkliste (saved films) and Weiterschauen (playback positions), kept in userData/mediathek/library.json.
// Items saved here come back after a restart, so their hosts are put on the proxy allowlist when the
// file is loaded. Items handed in by the renderer only keep addresses whose hosts are already allowed.
'use strict';
const path = require('path');
const { Store } = require('../store');
const resume = require('./resume');

const MAX_FAVORITES = 500;

/** The fields of an item worth storing (descriptions are capped). Every quality of `video` is kept: low, sd, hd of
 *  MediathekViewWeb or the sizes of an English-language source (h1080, h720 …, see sources/common.js). */
function slim(item) {
  if (!item || !item.id) return null;
  const v = item.video && typeof item.video === 'object' ? item.video : {};
  const video = {};
  for (const [k, u] of Object.entries(v)) if (/^[\w-]{1,16}$/.test(k) && typeof u === 'string' && u) video[k] = u;
  const out = {
    id: String(item.id), channel: item.channel || '', topic: item.topic || '', title: item.title || '',
    description: String(item.description || '').slice(0, 4000), timestamp: Number(item.timestamp) || 0,
    duration: Number(item.duration) || 0, size: Number(item.size) || null, website: item.website || null,
    subtitle: item.subtitle || null, video: { low: null, sd: null, hd: null, ...video },
    hls: !!item.hls, variant: item.variant || null, geo: item.geo || null,
  };
  // the English-language sources: where the item comes from and what resolving it needs again
  if (item.source && /^[\w-]{1,24}$/.test(item.source)) {
    out.source = item.source;
    for (const k of ['ref', 'programme', 'programId', 'collectionId', 'speaker', 'lang']) if (typeof item[k] === 'string' && item[k].length < 300) out[k] = item[k];
    if (typeof item.image === 'string' && /^https:\/\//.test(item.image)) out.image = item.image;
    if (item.lazy) out.lazy = true;
    if (Number.isInteger(item.year) && item.year > 1800 && item.year < 2200) out.year = item.year;
  }
  if (item.heights && typeof item.heights === 'object') {
    const hs = {};
    for (const [k, h] of Object.entries(item.heights)) if (video[k] && h && Number(h.height) > 0) hs[k] = { width: Number(h.width) || 0, height: Number(h.height), p: Number(h.p) || 0 };
    if (Object.keys(hs).length) out.heights = hs;
  }
  return out;
}

function createLibrary({ file, allow }) {
  const store = new Store(file, { favorites: [], positions: {} });
  const data = store.get();
  if (!Array.isArray(data.favorites)) data.favorites = [];
  if (!data.positions || typeof data.positions !== 'object') data.positions = {};
  for (const f of data.favorites) allow.addItem(f);
  for (const e of Object.values(data.positions)) if (e && e.item) allow.addItem(e.item);

  /** Addresses of a renderer-supplied item survive only when their host came out of the Mediathek. */
  function trusted(item) {
    const s = slim(item);
    if (!s) return null;
    const ok = (u) => (u && allow.has(u) ? u : null);
    for (const k of Object.keys(s.video)) s.video[k] = ok(s.video[k]);
    s.subtitle = ok(s.subtitle);
    if (s.website && !/^https?:\/\//i.test(s.website)) s.website = null;
    // an item of a source that still has to be resolved keeps no addresses, its id is enough to find it again
    if (!Object.values(s.video).some(Boolean) && !(s.source && s.lazy)) return null;
    return s;
  }

  const save = () => store.save();

  return {
    favorites: () => data.favorites.slice(),
    isFavorite: (id) => data.favorites.some((f) => f.id === id),
    setFavorite(item, on) {
      const id = item && item.id;
      if (!id) return false;
      data.favorites = data.favorites.filter((f) => f.id !== id);
      if (on) {
        const s = trusted(item);
        if (!s) return false;
        data.favorites.unshift({ ...s, savedAt: Date.now() });
        data.favorites = data.favorites.slice(0, MAX_FAVORITES);
      }
      save();
      return !!on;
    },
    /** Progress report from the player; returns the stored entry (or null). */
    position(item, position, duration) {
      if (!item || !item.id || item.live || item.local && !item.video) return null;
      const s = trusted(item) || (data.positions[item.id] && data.positions[item.id].item) || null;
      if (!s) return null;
      const entry = resume.update(data.positions, s, position, duration);
      resume.prune(data.positions);
      save();
      return entry;
    },
    entry: (id) => data.positions[id] || null,
    startAt: (id) => resume.startAt(data.positions[id]),
    forget(id) { if (data.positions[id]) { delete data.positions[id]; save(); } return true; },
    continueList: (limit) => resume.continueList(data.positions, limit),
    /** { id: { position, duration, state } } for progress bars and "gesehen" marks on cards. */
    progressMap() {
      const out = {};
      for (const [id, e] of Object.entries(data.positions)) out[id] = { position: e.position, duration: e.duration, state: e.state };
      return out;
    },
    flush: () => store.flush(),
  };
}

module.exports = { createLibrary, slim };
module.exports.defaultFile = (userData) => path.join(userData, 'mediathek', 'library.json');
