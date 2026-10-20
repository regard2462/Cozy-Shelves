// Which hosts the media:// proxy may reach. Only hosts that came out of the Mediathek itself: video and
// subtitle addresses of MediathekViewWeb results, the live channel list and hosts named inside playlists
// the proxy has already fetched. Everything else is refused, so media:// never becomes an open proxy.
// Since 0.7 the English-language sources (sources/*.js) name their hosts themselves: their items only add
// addresses on those hosts (see index.js noteItems).
'use strict';

const hostOf = (url) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase() : null; } catch { return null; } };

/** Every address of an item: all its qualities (low, sd, hd or the sizes of a source), subtitles, stream, src. */
const addressesOf = (item) => (item ? [...Object.values(item.video && typeof item.video === 'object' ? item.video : {}), item.subtitle, item.stream, item.src].filter((u) => typeof u === 'string' && u) : []);

class Allowlist {
  constructor() { this.hosts = new Set(); }
  /** Add the host of an http(s) address; returns true when it was usable. */
  add(url) { const h = hostOf(url); if (!h) return false; this.hosts.add(h); return true; }
  /** Add the hosts of an item; `accept(url)` (optional) decides per address (the hosts a source names). */
  addItem(item, accept = null) {
    for (const u of addressesOf(item)) if (!accept || accept(u)) this.add(u);
  }
  has(url) { const h = hostOf(url); return !!h && this.hosts.has(h); }
  get size() { return this.hosts.size; }
}

module.exports = { Allowlist, hostOf, addressesOf };
