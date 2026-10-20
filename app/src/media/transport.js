// The source the HUD mini player (ui/media-bar.js), the keys K/J/L in the world (main.js) and the system media
// controls (media/media-session.js) act on: the film or the podcast that started last and still has something
// loaded (the order comes from media/focus.js). Both are wrapped in the same small interface:
//   { id, step (s for J/L), info() → { title, artist, album, artwork, playing, buffering, position, duration,
//     rate, live, error }, toggle(), play(), pause(), skip(Δs), seek(s), stop() }
// An audiobook (ui/audiobooks/ab-player.js) is a third source: it skips 15 s back and 30 s forward (back, fwd) and has
// chapters (previous(), next(): the media keys for the previous and the next track).
import { mediaPlayer } from './media-player.js';
import { mediaFocus } from './focus.js';
import { podcastPlayer } from '../ui/podcasts/player.js';
import { audiobookPlayer } from '../ui/audiobooks/ab-player.js';
import { errorText } from '../ui/audiobooks/ab-format.js';

const CHANNEL_NAMES = { 'ARTE.DE': 'arte', '3Sat': '3sat', PHOENIX: 'phoenix', 'Funk.net': 'funk', 'Radio Bremen TV': 'Radio Bremen', 'ZDF-tivi': 'ZDFtivi', 'ARD-alpha': 'ARD alpha' };
export const channelLabel = (c) => c?.channelName || CHANNEL_NAMES[c?.channel] || c?.channel || '';
const finite = (n) => (isFinite(n) && n > 0 ? n : 0);

export const filmTransport = {
  id: 'film', step: 10,
  info() {
    const s = mediaPlayer.state, c = s.current;
    if (!c) return null;
    const live = !!s.live;
    return {
      // live TV: the programme that runs now, under the channel's name
      title: (live && c.now) || c.title || '', artist: channelLabel(c), album: !live && c.topic && c.topic !== c.title ? c.topic : '',
      artwork: c.poster || '', playing: !!s.playing, buffering: !!s.buffering, position: s.position || 0,
      duration: live ? 0 : finite(s.duration), rate: 1, live, error: s.error || null,
    };
  },
  toggle: () => mediaPlayer.toggle(),
  play: () => mediaPlayer.resume(),
  pause: () => mediaPlayer.pause(),
  skip: (d) => mediaPlayer.skip(d),
  seek: (sec) => mediaPlayer.seek(sec),
  stop: () => mediaPlayer.stop(),
};

export const podcastTransport = {
  id: 'podcast', step: 15,
  info() {
    const s = podcastPlayer.state, c = s.current;
    if (!c) return null;
    return {
      title: c.episode?.title || '', artist: c.show?.title || '', album: c.show?.author || '',
      artwork: c.show?.artwork || c.episode?.image || '', playing: !!s.playing, buffering: !!s.buffering,
      position: s.position || 0, duration: finite(s.duration) || finite(c.episode?.duration), rate: s.rate || 1, live: false, error: s.error || null,
    };
  },
  toggle: () => podcastPlayer.toggle(),
  play: () => podcastPlayer.resume(),
  pause: () => podcastPlayer.pause(),
  skip: (d) => podcastPlayer.skip(d),
  seek: (sec) => podcastPlayer.seek(sec),
  stop: () => podcastPlayer.stop(),
};

export const audiobookTransport = {
  id: 'audiobook', step: 15, back: 15, fwd: 30,
  info() {
    const s = audiobookPlayer.state, b = s.book;
    if (!b) return null;
    return {
      title: b.title || '', artist: b.author || '', album: s.chapterTitle || '', artwork: s.artwork || '',
      playing: !!s.playing, buffering: !!s.buffering, position: s.position || 0, duration: finite(s.duration), rate: s.rate || 1, live: false, error: errorText(s.error),
    };
  },
  toggle: () => audiobookPlayer.toggle(),
  play: () => audiobookPlayer.resume(),
  pause: () => audiobookPlayer.pause(),
  skip: (d) => audiobookPlayer.skip(d),
  seek: (sec) => audiobookPlayer.seek(sec),
  stop: () => audiobookPlayer.stop(),
  previous: () => audiobookPlayer.prevChapter(),
  next: () => audiobookPlayer.nextChapter(),
};

const BY_ID = { film: filmTransport, podcast: podcastTransport, audiobook: audiobookTransport };

/** The film, the podcast or the audiobook the controls act on, or null when none has anything loaded. */
export function activeTransport() { return BY_ID[mediaFocus.active(['film', 'podcast', 'audiobook'])] || null; }

/** fn() on every change of the players and of the focus order → off */
export function onTransportChange(fn) {
  const offs = [mediaPlayer.onChange(fn), podcastPlayer.onChange(fn), audiobookPlayer.onChange(fn), mediaFocus.onChange(fn)];
  return () => { for (const off of offs) off(); };
}
