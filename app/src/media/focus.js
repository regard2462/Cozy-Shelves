// One source at a time: films (media/media-player.js), podcasts (ui/podcasts/player.js) and read-aloud
// (ui/reader/tts-client.js) register here and claim the focus when they start. Every other source is then asked to
// hold: films and podcasts pause, a reading pauses (its bar offers to resume). Nothing is thrown away, so the paused
// source can go on later. The record player is no source: the background music ducks (audio/engine.js duck()) and,
// while a film or a podcast plays, pauses until they are over (hold(), settings.audio.pauseForMedia).
//
// The order of the claims decides which source the HUD mini player, the keys K/J/L and the system media controls
// act on (media/transport.js): the one that claimed last and still has something loaded.
//
//   mediaFocus.register(id, { hold(), loaded() }) → off   hold: pause yourself · loaded: something is loaded
//   mediaFocus.claim(id)                                   id starts playing, all other sources hold
//   mediaFocus.active(ids?)                                most recently claimed source that is loaded (among ids)
//   mediaFocus.changed()                                   a source loaded or dropped something (listeners re-check)
//   mediaFocus.onChange(fn) → off                          fn(active()) after every claim and every changed()
// This module imports nothing, the players import it (no import cycle).

function createFocus() {
  const sources = new Map();    // id → { hold, loaded }
  let order = [];               // ids in the order of their last claim, the newest last
  const listeners = new Set();
  const isLoaded = (s) => { try { return !!s?.loaded?.(); } catch { return false; } };

  function active(ids) {
    const allowed = (id) => !ids || ids.includes(id);
    for (let i = order.length - 1; i >= 0; i--) if (allowed(order[i]) && isLoaded(sources.get(order[i]))) return order[i];
    // loaded without a claim yet (a start that failed before it played): still worth showing
    for (const [id, s] of sources) if (allowed(id) && isLoaded(s)) return id;
    return null;
  }
  function notify() {
    const a = active();
    for (const fn of [...listeners]) { try { fn(a); } catch (e) { console.error('[focus]', e); } }
  }

  return {
    register(id, src) { sources.set(id, src); return () => { if (sources.get(id) === src) sources.delete(id); }; },
    claim(id) {
      order = [...order.filter((x) => x !== id), id];
      for (const [other, s] of sources) {
        if (other === id) continue;
        try { s.hold?.(); } catch (e) { console.error('[focus] hold', other, e); }
      }
      notify();
    },
    active,
    changed: notify,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get order() { return order.slice(); },
  };
}

// one instance even when a second bundle (dev harness) loads this module again, like the players
export const mediaFocus = (globalThis.__cozyshelvesMediaFocus ||= createFocus());
export default mediaFocus;
