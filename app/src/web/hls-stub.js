// hls.js in the web build: the Mediathek and its streams are not part of the browser version (no proxy for the
// broadcasters' playlists), so the media player's dynamic import gets a player that says it cannot play. build/web.js
// points 'hls.js' here, which keeps 2.8 MB out of dist/web.
export default class HlsStub {
  static isSupported() { return false; }
  constructor() { throw new Error('HLS is not available in the browser version'); }
}
