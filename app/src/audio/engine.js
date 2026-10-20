// Cozy Shelves audio engine – everything is generated procedurally with the Web Audio API (no asset files):
//   music   : generative "records" (see records.js), user's own files via HTMLAudioElement
//   ambient : the soundscape of the world (soundscape.js): rain, wind, thunder, the fire, the clock and the garden,
//             following the weather, the hour, the season and where you stand (no switches, only the volume)
//   sfx     : short procedural UI / world sounds (sfx.js), the footsteps (steps.js)
// Public interface: see docs/CONTRACTS.md plus currentRecord, onRecordChange, setMusicFolder, next/prev,
// duck, hold (pause for films and podcasts), suspend/resume, stopSfx, attachWorld, footstep, renderOffline (test helper).
import { api } from '../core/api.js';
import { touch } from '../core/platform.js';
import { bus } from '../core/bus.js';
import { tr } from '../core/i18n.js';
import { gainNode, impulseResponse, rampTo, clamp } from './dsp.js';
import { RECORD_DEFS, createRecordGen } from './records.js';
import { RainSound, WindSound, FireSound, ClockSound, CricketSound, thunder } from './ambient.js';
import { Soundscape } from './soundscape.js';
import { SFX, SFX_NAMES } from './sfx.js';
import { birdPhrase, owlCall, frogBout, treeFrog, duckCall, moorhenCall, waterLap } from './voices.js';
import { UserPlayer } from './player.js';

const MUSIC_EXT = ['.mp3', '.ogg', '.wav', '.flac', '.m4a', '.opus'];
const LOOKAHEAD = 2.5, LOOKAHEAD_HIDDEN = 12, TICK_MS = 120, CROSSFADE = 2;
// (a phone or a tablet: the ticker less often, its work is on the main thread; the lookahead covers it many times)
const TICK_MS_TOUCH = 200;
// hold(): the music fades out over HOLD_FADE s while a film or a podcast plays and comes back HOLD_RELEASE_MS after
// the last of them stopped (a short pause, a seek or a change of quality does not bring it back in between)
const HOLD_FADE = 1.2, HOLD_RELEASE_MS = 2500;
const vcurve = (v) => Math.pow(clamp(Number(v ?? 0), 0, 1), 1.5);

/** Bus graph shared by the live context and offline test renders. `short`: a phone or a tablet, where the music plays
 *  without its hall (a convolution of 3.2 s took some 5 % of a desktop core all the time, the audio thread shares the
 *  phone's few fast cores with the world). */
function buildGraph(ctx, { short = false } = {}) {
  const master = gainNode(ctx, 1);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 14; comp.ratio.value = 3; comp.attack.value = 0.012; comp.release.value = 0.3;
  master.connect(comp); comp.connect(ctx.destination);
  // music: dry + warm hall reverb, volume, ducking
  const music = { in: gainNode(ctx, 1), vol: gainNode(ctx, 0), duck: gainNode(ctx, 1), send: gainNode(ctx, 0.32), direct: gainNode(ctx, 1) };
  let hall = null;
  music.in.connect(music.vol);
  if (!short) { hall = ctx.createConvolver(); hall.buffer = impulseResponse(ctx, { seconds: 3.2, decay: 2.1, tone: 0.28 }); music.in.connect(music.send); music.send.connect(hall); hall.connect(music.vol); }
  music.direct.connect(music.vol); // user music, no reverb
  music.vol.connect(music.duck); music.duck.connect(master);
  const ambient = { in: gainNode(ctx, 1), vol: gainNode(ctx, 0) };
  ambient.in.connect(ambient.vol); ambient.vol.connect(master);
  // sfx: dry + small room
  const sfx = { in: gainNode(ctx, 1), vol: gainNode(ctx, 0), send: gainNode(ctx, 0.16) };
  const room = ctx.createConvolver(); room.buffer = impulseResponse(ctx, { seconds: 0.8, decay: 7, tone: 0.5 });
  sfx.in.connect(sfx.vol); sfx.in.connect(sfx.send); sfx.send.connect(room); room.connect(sfx.vol); sfx.vol.connect(master);
  return { master, comp, music, ambient, sfx, hall, room };
}

const STILLE = RECORD_DEFS.find((r) => r.silent);
const stripExt = (n) => String(n || '').replace(/\.[^.]+$/, '');
const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';

class AudioEngine {
  constructor() {
    this.ctx = null; this.graph = null; this.ready = false;
    this.volumes = { music: 0.45, ambient: 0.6, sfx: 0.7 };
    this.gens = new Set(); this.currentGen = null; this.current = null; this.lastRecord = null; this.pendingRecord = undefined;
    this.listeners = new Set(); this.loops = {}; this.lastSfx = {};
    this.userTracks = []; this.musicFolder = null; this.player = new UserPlayer();
    this.player.onEnded = () => { if (this.userTracks.length > 1) this.next(); else if (this.current && !this.current.procedural) this.player.play(this.current, { fade: 0.5 }); };
    this.player.onError = (track, err) => { console.warn('[audio] cannot play', track?.url, err); this.notify(); };
    // the world's sounds follow the world (soundscape.js); audio.ambient stays for older callers: set() does nothing
    // any more (there are no switches), state tells what plays
    this.scape = new Soundscape();
    this.ducked = false; this.timer = null; this.settingsApplied = false;
    // hold(): sources that want the music paused, whether it is paused, the record that comes back afterwards
    this.holders = new Set(); this.held = false; this.heldRecord = null; this.holdOverride = false; this.pauseForMedia = true;
    this.ambient = {
      set: () => {},
      get state() { return { ...engine.scape.levels }; },
    };
    bus.on('music:record', (id) => { if (id !== undefined && id !== this.current?.id) this.playRecord(id); });
    this._onVisibility = () => { if (!this.ctx) return; if (document.hidden) this._tick(); else if (this.ctx.state === 'interrupted') this.ctx.resume().catch(() => {}); };
  }

  // ------------------------------------------------------------ lifecycle
  init(opts = {}) {
    if (this.ctx) { if (this.ctx.state === 'suspended' && !this._userSuspended) this.ctx.resume().catch(() => {}); return this; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { console.warn('[audio] Web Audio not available'); return this; }
    try {
      this.ctx = new AC({ latencyHint: 'playback' });
      // a phone or a tablet: shorter reverbs (the audio thread shares the phone's few fast cores with the world)
      this.graph = buildGraph(this.ctx, { short: touch });
      this.scape.start(this.ctx, this.graph.ambient.in, { short: touch });
      this.player.attach(this.ctx, this.graph.music.direct);
      this._applyVolumes(0.05);
      this.timer = setInterval(() => this._tick(), touch ? TICK_MS_TOUCH : TICK_MS);
      document.addEventListener('visibilitychange', this._onVisibility);
      this.ready = true;
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch (e) { console.error('[audio] init failed', e); return this; }
    this._applySettings(opts).catch((e) => console.warn('[audio] settings', e));
    return this;
  }
  async _applySettings(opts) {
    let a = {};
    try { a = (await api.settings.get())?.audio || {}; } catch (e) { /* mock or no backend */ }
    this.setVolumes({ music: a.music ?? this.volumes.music, ambient: a.ambient ?? this.volumes.ambient, sfx: a.sfx ?? this.volumes.sfx });
    if (a.trackPositions && typeof a.trackPositions === 'object') Object.assign(this.player.positions, a.trackPositions);
    this.scape.setSwitches(a.sounds);   // the single sounds switched off by hand (settings.audio.sounds)
    // (audio.fire, rain, wind and clock of older settings files switched the atmosphere on and off: ignored since 0.7,
    // the world decides what is heard)
    if (a.musicFolder) await this.setMusicFolder(a.musicFolder).catch(() => {});
    this.settingsApplied = true;
    this.pauseForMedia = a.pauseForMedia !== false;
    this._syncHold(0);
    const want = this.pendingRecord !== undefined ? this.pendingRecord : (opts.autoplay === false ? undefined : a.record);
    this.pendingRecord = undefined;
    // a film or a podcast that already plays keeps the record of the session waiting (hold)
    if (want !== undefined && want !== null && want !== this.current?.id) this.playRecord(want, { auto: true });
    try { api.settings.onChange?.((s) => this._onSettings(s)); } catch (e) { /* */ }
  }
  _onSettings(s) {
    const a = s?.audio;
    if (a && (a.pauseForMedia !== false) !== this.pauseForMedia) { this.pauseForMedia = a.pauseForMedia !== false; this._syncHold(0); }
    if (a) this.scape.setSwitches(a.sounds);
    if (!a || !this.ctx) return;
    const v = {}; for (const k of ['music', 'ambient', 'sfx']) if (a[k] != null && a[k] !== this.volumes[k]) v[k] = a[k];
    if (Object.keys(v).length) this.setVolumes(v);
  }
  suspend() { this._userSuspended = true; this.player.pause(); return this.ctx ? this.ctx.suspend().catch(() => {}) : Promise.resolve(); }
  resume() { this._userSuspended = false; this.player.resume(); return this.ctx ? this.ctx.resume().catch(() => {}) : Promise.resolve(); }
  _tick() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD);
    for (const g of this.gens) { try { g.scheduleUntil(t); } catch (e) { console.error('[audio] record', e); this.gens.delete(g); } }
    try { this.scape.update(); this.scape.scheduleUntil(t); } catch (e) { console.error('[audio] soundscape', e); }
  }
  /** The world whose sounds play (main.js, once the world exists): the soundscape follows its weather, its hour, the
   *  season, the fire, the clock, the door and the camera. */
  attachWorld(world) { this.scape.attach(world); if (this.ctx) this._tick(); }
  /**
   * A footstep on the ground under the player (world.js → main.js: onStep and onLand). o: { run, speed (m/s), landing,
   * impact (m/s) }. The surface, a wet ground in the rain and the outdoors (no room around the step) come from the
   * soundscape.
   */
  footstep(o = {}) {
    if (!this.scape.on('steps')) return null;   // switched off by hand
    const info = this.scape.stepInfo();
    const gain = o.landing ? 1 : (o.run ? 0.9 : 0.75);
    return this.sfx('footstep', { ...o, ...info, gain, dry: info.outdoor });
  }

  // ------------------------------------------------------------ volumes / ducking
  setVolumes(v = {}) {
    for (const k of ['music', 'ambient', 'sfx']) if (v[k] != null && !Number.isNaN(Number(v[k]))) this.volumes[k] = clamp(Number(v[k]), 0, 1);
    this._applyVolumes(0.6);
    return { ...this.volumes };
  }
  _applyVolumes(seconds) {
    if (!this.graph) return;
    const t = this.ctx.currentTime;
    rampTo(this.graph.music.vol.gain, vcurve(this.volumes.music), t, seconds);
    rampTo(this.graph.ambient.vol.gain, vcurve(this.volumes.ambient), t, seconds);
    rampTo(this.graph.sfx.vol.gain, vcurve(this.volumes.sfx), t, seconds);
  }
  /**
   * Lower the music while something else speaks or plays. Several sources can duck at the same time (podcast,
   * read-aloud, film): the music comes back when the last of them is done. Callers without a name share one key.
   */
  duck(on = true, source = 'default') {
    this.duckers ||= new Set();
    if (on) this.duckers.add(source); else this.duckers.delete(source);
    this.ducked = this.duckers.size > 0;
    if (this.graph) rampTo(this.graph.music.duck.gain, this.ducked ? 0.28 : 1, this.ctx.currentTime, this.ducked ? 0.8 : 1.6);
  }
  /**
   * Pause the background music while a film of the Mediathek or a podcast plays (settings.audio.pauseForMedia, on by
   * default) and play the same record again afterwards: a generated record starts anew, a track of the own music
   * goes on where it stopped. Several sources can hold it; it comes back HOLD_RELEASE_MS after the last of them let
   * go. A record chosen by hand meanwhile plays anyway. With the setting off the music only ducks (duck()).
   * Read-aloud does not hold, it ducks.
   */
  hold(on = true, source = 'default') {
    if (on) this.holders.add(source); else this.holders.delete(source);
    if (!this.holders.size) this.holdOverride = false;
    this._syncHold(on ? 0 : HOLD_RELEASE_MS);
  }
  get holding() { return this.holders.size > 0 && this.pauseForMedia && !this.holdOverride; }
  _syncHold(delay = 0) {
    clearTimeout(this._holdTimer); this._holdTimer = null;
    const want = this.holding;
    if (want === this.held) return;
    if (want) this._pauseMusic();
    else if (delay > 0) this._holdTimer = setTimeout(() => { this._holdTimer = null; this._syncHold(0); }, delay);
    else this._resumeMusic();
  }
  _pauseMusic() {
    this.held = true;
    const rec = this.current;
    // only what really plays comes back (a stopped record or "Stille" stay as they are)
    if (rec && !rec.silent && this.playing) {
      this.heldRecord = rec;
      if (this.ctx) this._stopCurrent(this.ctx.currentTime, HOLD_FADE);
    }
    this.notify(); bus.emit('music:hold', true);
  }
  _resumeMusic() {
    this.held = false;
    const rec = this.heldRecord; this.heldRecord = null;
    // the same record is still on the platter (nothing else was chosen or stopped meanwhile)
    if (rec && this.ctx && this.current?.id === rec.id && !this.playing) this._start(rec);
    this.notify(); bus.emit('music:hold', false);
  }

  // ------------------------------------------------------------ sfx
  sfx(name, opts = {}) {
    if (!this.ctx || !this.graph) return null;
    const fn = SFX[name];
    if (!fn) { if (name) console.warn('[audio] unknown sfx', name); return null; }
    const now = performance.now();
    if (!opts.loop && name !== 'purr' && this.lastSfx[name] && now - this.lastSfx[name] < 25) return null; // de-bounce double triggers
    this.lastSfx[name] = now;
    try {
      const t = this.ctx.currentTime + 0.01;
      // outside there is no room round a sound: past the room's reverberation
      const dry = opts.dry ?? (this.scape.listener ? !this.scape.listener.inside : false);
      const bus = dry ? this.graph.sfx.vol : this.graph.sfx.in;
      let dest = bus;
      if (opts.volume != null) { const g = gainNode(this.ctx, clamp(opts.volume, 0, 2)); g.connect(bus); dest = g; }
      if (name === 'purr' || opts.loop) {
        if (this.loops[name]) return this.loops[name];
        const h = fn(this.ctx, dest, t, opts);
        if (h && h.stop) this.loops[name] = h;
        return h;
      }
      return fn(this.ctx, dest, t, opts) || null;
    } catch (e) { console.error('[audio] sfx', name, e); return null; }
  }
  stopSfx(name) {
    const h = this.loops[name]; if (!h) return false;
    try { h.stop(this.ctx.currentTime); } catch (e) { /* */ }
    delete this.loops[name];
    return true;
  }
  sfxNames() { return [...SFX_NAMES]; }

  // ------------------------------------------------------------ records
  records() {
    const proc = RECORD_DEFS.map((d) => ({ id: d.id, title: d.title, artist: tr(d.artist), procedural: true, url: null, hue: d.hue, mood: d.mood, silent: !!d.silent }));
    return proc.concat(this.userTracks.map((t) => ({ ...t })));
  }
  get currentRecord() { return this.current ? { ...this.current } : null; }
  get playing() { return !!(this.currentGen || this.player.playing); }
  onRecordChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify() { const rec = this.currentRecord; for (const fn of [...this.listeners]) { try { fn(rec, this); } catch (e) { console.error(e); } } }
  /** Put a record on. { auto: true } is the record of the last session at the start: it waits while a film or a
   *  podcast holds the music. A record chosen by hand plays anyway (see hold()). */
  playRecord(id, { auto = false } = {}) {
    if (id === undefined) return false;
    if (id === null || id === 'stille' || id === '') { this.stopRecord(); if (id === 'stille') { this.current = { ...STILLE, artist: tr(STILLE.artist), procedural: true, url: null }; this.notify(); } return true; }
    if (!this.ctx) { this.pendingRecord = id; return true; }
    const rec = this.records().find((r) => r.id === id);
    if (!rec) { console.warn('[audio] unknown record', id); return false; }
    if (this.current?.id === id && this.playing) return true;
    if (this.holding) {
      if (auto) {
        this._stopCurrent(this.ctx.currentTime);
        this.current = rec; this.lastRecord = rec.id; this.heldRecord = rec;
        if (!this.held) { this.held = true; bus.emit('music:hold', true); }
        this.notify();
        return true;
      }
      // chosen by hand while a film or a podcast plays: the music plays along until they are over
      this.holdOverride = true; clearTimeout(this._holdTimer); this._holdTimer = null;
      if (this.held) { this.held = false; this.heldRecord = null; bus.emit('music:hold', false); }
    }
    this._stopCurrent(this.ctx.currentTime);
    if (!this._start(rec)) return false;
    this.sfx('record-needle');
    this.notify();
    return true;
  }
  /** Start a record on the music bus: a new generator, or the file player (a paused track goes on where it was). */
  _start(rec) {
    const t = this.ctx.currentTime;
    if (rec.procedural) {
      const gen = createRecordGen(rec.id, this.ctx, this.graph.music.in);
      if (!gen) return false;
      gen.start(t + 0.05);
      this.gens.add(gen); this.currentGen = gen;
      this._tick();
    } else {
      this.player.play(rec, { fade: CROSSFADE });
    }
    this.current = rec; this.lastRecord = rec.id;
    return true;
  }
  _stopCurrent(t, fade = CROSSFADE) {
    if (this.currentGen) {
      const gen = this.currentGen; this.currentGen = null;
      gen.stop(t, fade);
      setTimeout(() => { this.gens.delete(gen); gen.dispose(); }, fade * 1000 + 600);
    }
    if (this.player.playing) { this.player.stop({ fade }); this._persistPositions(); }
  }
  stopRecord() {
    this.heldRecord = null;   // stopped by hand: nothing comes back after a film
    if (!this.ctx) { this.pendingRecord = null; this.current = null; return; }
    this._stopCurrent(this.ctx.currentTime);
    this.current = null;
    this.notify();
  }
  async setMusicFolder(folder) {
    this.musicFolder = folder || null;
    this.userTracks = [];
    if (folder) {
      let files = [];
      try { files = (await api.files.list(folder, MUSIC_EXT)) || []; } catch (e) { console.warn('[audio] list folder', e); }
      const artist = baseName(folder) || tr({ de: 'Eigene Musik', en: 'Own music' });
      this.userTracks = files
        .filter((f) => f && f.url)
        .map((f) => ({ id: 'file:' + f.path, title: stripExt(f.name || baseName(f.path)), artist, procedural: false, url: f.url, path: f.path }))
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    }
    if (this.current && !this.current.procedural && !this.userTracks.some((t) => t.id === this.current.id)) this.stopRecord();
    this.notify();
    return this.userTracks.map((t) => ({ ...t }));
  }
  _userIndex() { return this.current ? this.userTracks.findIndex((t) => t.id === this.current.id) : -1; }
  next() { const n = this.userTracks.length; if (!n) return false; const i = this._userIndex(); return this.playRecord(this.userTracks[(i + 1) % n].id); }
  prev() {
    const n = this.userTracks.length; if (!n) return false;
    const i = this._userIndex();
    if (i >= 0 && this.player.position > 4) { try { this.player.el.currentTime = 0; } catch (e) { /* */ } return true; } // restart current track first
    return this.playRecord(this.userTracks[(i - 1 + n) % n].id);
  }
  _persistPositions() {
    clearTimeout(this._posTimer);
    this._posTimer = setTimeout(() => { try { api.settings.set({ audio: { trackPositions: { ...this.player.positions } } }); } catch (e) { /* */ } }, 800);
  }
  get trackPosition() { return { position: this.player.position, duration: this.player.duration }; }

  /** Play any URL (podcast, stream) through the sfx bus. Returns { el, stop(), setVolume() }. */
  playUrl(url, { loop = false, volume = 1 } = {}) {
    const el = new Audio(url); el.loop = !!loop; el.preload = 'auto';
    let g = null;
    if (this.ctx && this.graph) {
      try { const src = this.ctx.createMediaElementSource(el); g = gainNode(this.ctx, clamp(volume, 0, 1)); src.connect(g); g.connect(this.graph.sfx.in); } catch (e) { el.volume = clamp(volume, 0, 1); }
    } else el.volume = clamp(volume, 0, 1);
    el.play().catch((e) => console.warn('[audio] playUrl', e));
    return { el, stop: () => { try { el.pause(); el.src = ''; } catch (e) { /* */ } }, setVolume: (v) => { if (g) rampTo(g.gain, clamp(v, 0, 1), this.ctx.currentTime, 0.2); else el.volume = clamp(v, 0, 1); } };
  }

  // ------------------------------------------------------------ state for the UI
  get state() {
    return { ready: this.ready, playing: this.playing, record: this.currentRecord, volumes: { ...this.volumes }, ambient: this.ambient.state, musicFolder: this.musicFolder, userTracks: this.userTracks.map((t) => ({ ...t })), ducked: this.ducked, held: this.held };
  }

  // ------------------------------------------------------------ offline rendering (tests / previews)
  /** Renders a record / ambient layer / sfx through the real bus graph in an OfflineAudioContext. Returns Float32Array (left channel). */
  async renderOffline(kind, id, seconds = 8, { sampleRate = 44100, params = {}, both = false } = {}) {
    const off = new OfflineAudioContext(2, Math.ceil(sampleRate * seconds), sampleRate);
    const g = buildGraph(off);
    g.music.vol.gain.value = 1; g.ambient.vol.gain.value = 1; g.sfx.vol.gain.value = 1;
    if (kind === 'record') {
      const gen = createRecordGen(id, off, g.music.in);
      if (!gen) throw new Error('unknown record ' + id);
      gen.start(0); gen.scheduleUntil(seconds + 1);
    } else if (kind === 'ambient') {
      // a layer heard as given in `params` (soundscape.js sets them from the world), e.g. rain outdoors:
      // { level: 0.6, outdoor: 1 }, indoors: { level: 0.6, outdoor: 0.2, lp: 1000, glass: 0.6, roof: 1 }
      if (id === 'thunder') thunder(off, g.ambient.in, 0.2, { distance: params.distance ?? 1500, gain: params.gain ?? 0.9 });
      else {
        const make = { rain: () => new RainSound(off, g.ambient.in), wind: () => new WindSound(off, g.ambient.in), fire: () => new FireSound(off, g.ambient.in), firebowl: () => new FireSound(off, g.ambient.in, { open: true }), clock: () => new ClockSound(off, g.ambient.in), cricket: () => new CricketSound(off, g.ambient.in, params.voice || 'cricket-b') }[id];
        if (!make) throw new Error('unknown ambient ' + id);
        const layer = make(); layer.start(0);
        layer.set({ gain: 1, level: 0.6, outdoor: 1, wind: 0.6, foliage: 0.8, ...params }, 0, 0.01);
        layer.scheduleUntil(seconds + 1);
      }
    } else if (kind === 'voice') {
      // a voice of the garden: 'blackbird', 'robin' … (voices.js BIRDS), 'owl', 'owl-female', 'frog', 'treefrog', 'duck',
      // 'moorhen', 'lap'
      const o = { rnd: Math.random, seed: params.seed ?? 1, ...params }, d = g.ambient.in;
      const voices = { owl: () => owlCall(off, d, 0.1, o), 'owl-female': () => owlCall(off, d, 0.1, { ...o, female: true }), frog: () => frogBout(off, d, 0.1, o), treefrog: () => treeFrog(off, d, 0.1, o), duck: () => duckCall(off, d, 0.1, o), moorhen: () => moorhenCall(off, d, 0.1, o), lap: () => waterLap(off, d, 0.1, o) };
      (voices[id] || (() => birdPhrase(off, d, 0.1, { ...o, species: id })))();
    } else if (kind === 'sfx') {
      const fn = SFX[id]; if (!fn) throw new Error('unknown sfx ' + id);
      const h = fn(off, params.dry ? g.sfx.vol : g.sfx.in, 0.1, { ...params });
      if (h && h.stop) h.stop(Math.max(0.5, seconds - 1.5));
    } else throw new Error('kind must be record | ambient | voice | sfx');
    const buf = await off.startRendering();
    return both ? [buf.getChannelData(0), buf.getChannelData(1)] : buf.getChannelData(0);
  }
  /** Convenience: stats of an offline render { peak, rms, nan, silent } */
  async renderStats(kind, id, seconds = 8, opts = {}) {
    const d = await this.renderOffline(kind, id, seconds, opts);
    let peak = 0, sum = 0, nan = 0;
    for (let i = 0; i < d.length; i++) { const x = d[i]; if (Number.isNaN(x) || !Number.isFinite(x)) { nan++; continue; } const a = Math.abs(x); if (a > peak) peak = a; sum += x * x; }
    const rms = Math.sqrt(sum / d.length);
    return { kind, id, seconds, peak: +peak.toFixed(4), rms: +rms.toFixed(5), nan, silent: rms < 1e-5 };
  }
}

const engine = new AudioEngine();
export const audio = engine;
export default audio;
