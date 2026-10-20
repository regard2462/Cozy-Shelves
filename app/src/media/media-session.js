// The system's media controls for the film or the podcast that is active (media/transport.js): title, show or
// channel and picture in the Windows media overlay, and the hardware media keys. Play/pause and stop act on the
// active source; "previous"/"next" and the seek buttons jump back and forward (films 10 s, podcasts 15 s), because
// neither a film nor a podcast has a playlist here. An audiobook goes to the previous and the next chapter instead
// and seeks 15 s back and 30 s forward. Live TV cannot seek, so those actions are not offered then.
// The handlers are set again whenever the active source changes (a test can watch setActionHandler()).
import { activeTransport, onTransportChange } from './transport.js';

const SEEKING = ['seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'seekto'];

export function initMediaSession() {
  const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : null;
  if (!ms || typeof MediaMetadata === 'undefined') return () => {};
  // a handler always asks for the source that is active at the moment of the key press
  const act = (fn) => (details) => { const tp = activeTransport(); if (tp) fn(tp, details || {}); };
  const HANDLERS = {
    play: act((tp) => tp.play()),
    pause: act((tp) => tp.pause()),
    stop: act((tp) => tp.stop()),
    seekbackward: act((tp, d) => tp.skip(-(d.seekOffset || tp.back || tp.step))),
    seekforward: act((tp, d) => tp.skip(d.seekOffset || tp.fwd || tp.step)),
    previoustrack: act((tp) => (tp.previous ? tp.previous() : tp.skip(-tp.step))),
    nexttrack: act((tp) => (tp.next ? tp.next() : tp.skip(tp.step))),
    seekto: act((tp, d) => { if (isFinite(d.seekTime)) tp.seek(d.seekTime); }),
  };
  const set = (name, fn) => { try { ms.setActionHandler(name, fn); } catch { /* an action this Chromium does not know */ } };
  let handlerKey = null, metaKey = null, stateKey = null, lastPos = 0, hasPos = false, lastPosition = null;

  function update() {
    const tp = activeTransport();
    const info = tp?.info() || null;
    const hk = info ? tp.id + (info.live ? ':live' : '') : '';
    if (hk !== handlerKey) {
      handlerKey = hk;
      for (const name of Object.keys(HANDLERS)) set(name, info && !(info.live && SEEKING.includes(name)) ? HANDLERS[name] : null);
    }
    const mk = info ? [tp.id, info.title, info.artist, info.album, info.artwork].join('\u0001') : '';
    if (mk !== metaKey) {
      metaKey = mk;
      try { ms.metadata = info ? new MediaMetadata({ title: info.title, artist: info.artist, album: info.album, artwork: info.artwork ? [{ src: info.artwork }] : [] }) : null; } catch {}
    }
    const playback = info ? (info.playing ? 'playing' : 'paused') : 'none';
    if (ms.playbackState !== playback) { try { ms.playbackState = playback; } catch {} }
    // position for the overlay's time bar: on every play/pause/seek change, otherwise once a second
    if (info && info.duration > 0 && !info.live) {
      const sk = [tp.id, info.title, info.playing, info.rate].join('|');
      const now = performance.now();
      const jumped = lastPosition != null && Math.abs(info.position - lastPosition) > 3;   // a seek
      if (sk !== stateKey || jumped || now - lastPos > 1000) {
        stateKey = sk; lastPos = now; hasPos = true;
        try { ms.setPositionState({ duration: info.duration, playbackRate: info.rate || 1, position: Math.max(0, Math.min(info.position, info.duration)) }); } catch {}
      }
      lastPosition = info.position;
    } else if (hasPos) {
      hasPos = false; stateKey = null; lastPosition = null;
      try { ms.setPositionState(); } catch {}
    }
  }
  const off = onTransportChange(update);
  update();
  return off;
}
