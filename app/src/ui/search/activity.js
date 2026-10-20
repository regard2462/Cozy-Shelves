// What the user is doing, for the full-text index (electron/search/fulltext.js): it reads books only while nobody
// reads, listens to read-aloud or watches a film, and steps aside when the world drops frames while it runs.
// The frames are only timed while the index is actually reading a book; otherwise this costs one check a second.
import { isPanelOpen, currentPanel } from '../panels.js';
import { mediaPlayer } from '../../media/media-player.js';
import { ttsClient } from '../reader/tts-client.js';

const SLOW_MS = 1000 / 40;      // a frame slower than this is slow (the world aims at the display's rate)
const SLOW_SHARE = 0.3;         // the world "needs the time" when this share of the frames of a window is slow
const WINDOW_MS = 2000;
const HOLD_MS = 12000;          // a pause because of slow frames lasts this long …
const IGNORE_MS = 90000;        // … and when the frames stay slow during it, the index was not the cause

export function startSearchActivity({ api, bus, world }) {
  let sent = '';
  let running = false;          // the index reads a book right now (status broadcast)
  let busy = false, busyUntil = 0, ignoreUntil = 0, slowDuringHold = 0, windowsDuringHold = 0;
  let frames = [], lastT = 0, raf = 0, windowStart = 0;

  // only the world in front counts: behind a panel it renders slowly on purpose (world.setBackground)
  const worldVisible = () => !!world?.running && !document.hidden && !currentPanel();

  function frame(t) {
    raf = 0;
    if (lastT) frames.push(t - lastT);
    lastT = t;
    if (!windowStart) windowStart = t;
    if (t - windowStart >= WINDOW_MS) { judge(); windowStart = t; frames = []; }
    if ((running || busy) && worldVisible()) raf = requestAnimationFrame(frame);
    else { lastT = 0; windowStart = 0; frames = []; }
  }
  function judge() {
    if (frames.length < 10) return;
    const slow = frames.filter((d) => d > SLOW_MS).length / frames.length >= SLOW_SHARE;
    const now = performance.now();
    if (busy) {
      windowsDuringHold++;
      if (slow) slowDuringHold++;
      if (now >= busyUntil) {
        busy = false;
        // slow without the index as well: it was not the cause, let it work for a while
        if (windowsDuringHold && slowDuringHold === windowsDuringHold) ignoreUntil = now + IGNORE_MS;
        send();
      }
    } else if (slow && running && now >= ignoreUntil) {
      busy = true; busyUntil = now + HOLD_MS; slowDuringHold = 0; windowsDuringHold = 0;
      send();
    }
  }
  function timeFrames() { if (!raf && (running || busy) && worldVisible()) raf = requestAnimationFrame(frame); }

  function send() {
    const a = {
      reading: isPanelOpen('reader'),
      tts: (() => { try { const s = ttsClient.active; return !!s && !s.paused; } catch { return false; } })(),
      film: !!(mediaPlayer.current && mediaPlayer.video && !mediaPlayer.video.paused),
      busy,
    };
    const key = JSON.stringify(a);
    if (key === sent) return;
    sent = key;
    api.invoke?.('fulltext:activity', a).catch(() => {});
  }

  api.on?.('fulltext:status', (st) => { running = !!st?.running; timeFrames(); });
  bus.on('panel:open', () => setTimeout(send, 0));
  bus.on('panel:close', () => setTimeout(send, 60));
  setInterval(() => { if (busy && performance.now() >= busyUntil && !raf) { busy = false; } send(); timeFrames(); }, 1000);
  send();
}
