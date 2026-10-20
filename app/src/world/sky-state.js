// The world's clock and weather, without any meshes (environment.js draws what they say).
//
// The clock (settings.timeMode): 'real' the computer's time; 'cycle' day and night in turn, one day in
// sky.dayMinutes; 'day' only the day: the sun goes from morning to evening in that time, then a short twilight under the
// northern horizon leads to the next morning; 'night' only the night: dusk to dawn in that time, then the sun goes back
// under the horizon unseen; 'fixed' a fixed hour; 'golden' the still evening sun of godrays.js. Besides the hour it keeps
// a sky time that never jumps (hours, not wrapped): the stars turn and the moon moves with it, also across the
// night mode's change from dawn back to dusk.
//
// The weather (settings.weather and settings.sky): a fixed weather is a base (clear, overcast, rain, storm, snow) with
// fog and wind where they fit; 'changing' goes on by itself every 10 to 30 minutes in a natural sequence (clear, clouds,
// rain, clearing …) from what sky.allow lets in (snow only in winter); 'live' follows the real weather at a place
// (Open-Meteo). Every weather is a mix of continuous parts, { cloud, overcast, rain, snow, thunder, fog, wind, wet,
// cover, frozen } (0 … 1), so one weather blends into the next. settings.weather keeps one of the six old words for
// code that knows only those: the fixed weather's summary (clear or overcast with fog is 'fog').
import * as THREE from 'three';
import { moonPhase, clockTime, sunPosition } from './celestial.js';
import { seasonOf } from './season.js';
import { api } from '../core/api.js';

export const TIME_MODES = ['real', 'cycle', 'day', 'night', 'fixed', 'golden'];
export const DAY_LENGTHS = [10, 20, 30, 60, 120];   // minutes
export const BASES = ['clear', 'overcast', 'rain', 'storm', 'snow'];
export const WEATHER_MODES = ['fixed', 'changing', 'live'];
/** The sun's part of a day in the day mode, the night's in the night mode (hours: a little before sunrise and after
 *  sunset, sunPosition: 6:30 and 20:30). */
export const DAY_SPAN = { from: 6.45, to: 20.55 };
export const NIGHT_SPAN = { from: 20.75, to: 6.25 };
const TWILIGHT_S = 40;   // the day and the night mode: seconds from evening to morning (or dawn back to dusk)

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** Minutes of a day in the day modes (a missing or unknown value: 30). */
export function dayMinutesOf(settings) {
  const m = +settings?.sky?.dayMinutes;
  return DAY_LENGTHS.includes(m) ? m : 30;
}
/** The time mode of the settings (an unknown one is the real time). */
export const timeModeOf = (settings) => (TIME_MODES.includes(settings?.timeMode) ? settings.timeMode : 'real');
/** The weather mode of the settings: 'fixed' (missing, unknown), 'changing' or 'live'. */
export const weatherModeOf = (settings) => (WEATHER_MODES.includes(settings?.sky?.mode) ? settings.sky.mode : 'fixed');

// ---------------------------------------------------------------- fixed weathers ---------------------------------------
/** The old single word for a base with or without fog (settings.weather). */
export function legacyWeather(base, fog) { return fog && (base === 'clear' || base === 'overcast') ? 'fog' : base; }

/** Whether fog and wind go with a base: { fog: true | reason, wind: true | reason } (the reason a key of REASONS). */
export function fits(base, { fog = false } = {}) {
  return {
    fog: base === 'storm' ? 'stormFog' : true,
    wind: base === 'storm' ? 'stormWind' : fog ? 'windFog' : true,
  };
}
/** Why an extra is not offered (the settings show it under the switch). */
export const REASONS = {
  stormFog: { de: 'Bei Gewitter gibt es keinen dichten Nebel.', en: 'A thunderstorm brings no dense fog.' },
  stormWind: { de: 'Ein Gewitter bringt seinen Wind mit.', en: 'A thunderstorm brings its own wind.' },
  windFog: { de: 'Wind vertreibt den Nebel.', en: 'Wind blows the fog away.' },
  notWinter: { de: 'Schnee fällt nur im Winter.', en: 'Snow falls only in winter.' },
};

/**
 * The fixed weather of the settings: { base, fog, wind }. sky.base and sky.fog count when settings.weather is their
 * summary (written together by the settings); otherwise settings.weather alone decides (old settings files, the tests and
 * ?weather=… set only that word: 'fog' is the old grey fog, overcast with dense fog).
 */
export function fixedWeatherOf(settings) {
  const sky = settings?.sky || {}, w = settings?.weather;
  let base, fog;
  if (BASES.includes(sky.base) && legacyWeather(sky.base, !!sky.fog) === (w || 'clear')) { base = sky.base; fog = !!sky.fog; }
  else if (w === 'fog') { base = 'overcast'; fog = true; }
  else { base = BASES.includes(w) ? w : 'clear'; fog = false; }
  const ok = fits(base, { fog });
  if (ok.fog !== true) fog = false;
  const wind = !!sky.wind && fits(base, { fog }).wind === true;
  return { base, fog, wind };
}

// what each weather is made of (0 … 1); fog: the clear sky's morning mist, the old grey fog, drizzle in fog, snow in fog
const PROFILES = {
  clear: { cloud: 0.36, overcast: 0, rain: 0, snow: 0, thunder: 0, fog: 0, wind: 0.3 },
  fair: { cloud: 0.62, overcast: 0.12, rain: 0, snow: 0, thunder: 0, fog: 0, wind: 0.38 },
  overcast: { cloud: 0.93, overcast: 0.8, rain: 0, snow: 0, thunder: 0, fog: 0, wind: 0.45 },
  rain: { cloud: 0.97, overcast: 0.9, rain: 0.6, snow: 0, thunder: 0, fog: 0, wind: 0.6 },
  storm: { cloud: 1, overcast: 1, rain: 1, snow: 0, thunder: 1, fog: 0, wind: 1 },
  snow: { cloud: 0.92, overcast: 0.7, rain: 0, snow: 1, thunder: 0, fog: 0, wind: 0.32 },
  clearing: { cloud: 0.7, overcast: 0.3, rain: 0, snow: 0, thunder: 0, fog: 0, wind: 0.45 },
  mist: { cloud: 0.36, overcast: 0.15, rain: 0, snow: 0, thunder: 0, fog: 0.55, wind: 0.1 },
  fog: { cloud: 0.95, overcast: 0.85, rain: 0, snow: 0, thunder: 0, fog: 1, wind: 0.12 },
  drizzle: { cloud: 0.97, overcast: 0.9, rain: 0.3, snow: 0, thunder: 0, fog: 0.75, wind: 0.15 },
  snowfog: { cloud: 0.95, overcast: 0.8, rain: 0, snow: 0.7, thunder: 0, fog: 0.7, wind: 0.15 },
};
/** A fixed weather's phase: the base with its fog. */
export function phaseOf({ base, fog }) {
  if (!fog) return base;
  return { clear: 'mist', overcast: 'fog', rain: 'drizzle', snow: 'snowfog' }[base] || base;
}
/** The continuous parts of a phase (PROFILES), with wind added and the ground as it is after it for a while. */
export function mixOf(phase, { wind = false } = {}) {
  const p = PROFILES[phase] || PROFILES.clear;
  const m = { ...p, wet: p.rain > 0 ? 1 : 0, cover: p.snow > 0 ? 1 : 0, frozen: p.snow > 0 ? 1 : 0, phase };
  // wind: a windy day, driving rain, blowing snow (never with fog: fits())
  if (wind) m.wind = Math.max(m.wind, { clear: 0.7, fair: 0.72, overcast: 0.76, rain: 0.86, snow: 0.8, clearing: 0.74 }[phase] ?? 0.75);
  return m;
}
/** The old single word for a mix (code that knows only 'clear' … 'fog'). */
export function nameOfMix(m) {
  if (m.thunder > 0.5) return 'storm';
  if (m.snow > 0.15) return 'snow';
  if (m.rain > 0.15) return 'rain';
  if (m.fog > 0.5) return 'fog';
  return m.overcast > 0.45 ? 'overcast' : 'clear';
}
/** A value of each old weather (`P`: { clear, overcast, rain, storm, snow, fog }, numbers or arrays) for a mix: the old
 *  weathers give their old values exactly, everything between blends. An array result goes into `out` (no garbage: this
 *  runs every frame while the weather or the time moves). */
const W_KEYS = ['overcast', 'rain', 'storm', 'snow', 'fog'], _w = [0, 0, 0, 0, 0];
export function blendWeather(m, P, out) {
  _w[0] = Math.min(1, Math.max(0, m.overcast / 0.8)); _w[1] = Math.min(1, m.rain / 0.6) * (1 - m.thunder);
  _w[2] = m.thunder; _w[3] = Math.min(1, m.snow); _w[4] = Math.min(1, m.fog);
  if (!Array.isArray(P.clear)) {
    let v = P.clear;
    for (let j = 0; j < 5; j++) if (_w[j] > 0) v += (P[W_KEYS[j]] - v) * _w[j];
    return v;
  }
  const n = P.clear.length;
  out ||= new Array(n);
  for (let i = 0; i < n; i++) {
    let v = P.clear[i];
    for (let j = 0; j < 5; j++) if (_w[j] > 0) v += (P[W_KEYS[j]][i] - v) * _w[j];
    out[i] = v;
  }
  return out;
}
/** The base of a mix without its fog (weatherState().base). */
function baseOfMix(m) {
  const n = nameOfMix(m);
  return n !== 'fog' ? n : m.overcast > 0.45 ? 'overcast' : 'clear';
}

// ---------------------------------------------------------------- the changing weather -----------------------------------
// where a phase may go next (weights); every phase lasts 10 to 30 minutes
const NEXT = {
  clear: { fair: 0.6, overcast: 0.12, mist: 0.18 },
  fair: { overcast: 0.45, clear: 0.33, rain: 0.1, storm: 0.1 },
  overcast: { rain: 0.42, snow: 0.42, fair: 0.25, fog: 0.1, drizzle: 0.1 },
  rain: { clearing: 0.4, overcast: 0.25, storm: 0.2, drizzle: 0.1 },
  storm: { rain: 0.6, clearing: 0.4 },
  clearing: { fair: 0.55, clear: 0.3, mist: 0.12 },
  mist: { clear: 0.7, fair: 0.3 },
  fog: { overcast: 0.5, mist: 0.3, drizzle: 0.2 },
  drizzle: { overcast: 0.5, rain: 0.3, fog: 0.2 },
  snow: { overcast: 0.55, snowfog: 0.2, clear: 0.25 },
  snowfog: { snow: 0.5, overcast: 0.5 },
};
/** What a phase needs from sky.allow (and snow from the winter). */
const NEEDS = { rain: ['rain'], drizzle: ['rain', 'fog'], storm: ['storm'], mist: ['fog'], fog: ['fog'], snow: ['snow'], snowfog: ['snow', 'fog'] };
/** May the changing weather bring this phase? */
export function phaseAllowed(phase, allow = {}, winter = false) {
  const needs = NEEDS[phase] || [];
  if (needs.includes('snow') && !winter) return false;
  return needs.every((k) => allow[k] !== false);
}
/** The phase after `phase` for a random number r (0 … 1): only allowed ones, else a dry one. */
export function nextPhase(phase, r, allow = {}, winter = false) {
  const options = Object.entries(NEXT[phase] || NEXT.clear).filter(([p]) => phaseAllowed(p, allow, winter));
  if (!options.length) return phase === 'fair' ? 'clear' : 'fair';
  let total = options.reduce((a, [, w]) => a + w, 0), x = r * total;
  for (const [p, w] of options) { x -= w; if (x <= 0) return p; }
  return options[options.length - 1][0];
}
// how fast each part follows a new weather (seconds of a 1/e step): the clouds come before the rain, fog slowly
const EASE = { cloud: 80, overcast: 90, rain: 40, snow: 60, thunder: 25, fog: 120, wind: 50 };

// ---------------------------------------------------------------- the real weather (Open-Meteo) ---------------------------
/** The phase and wind for an Open-Meteo weather code (WMO) and the wind in km/h. */
export function phaseOfCode(code, windKmh = 0, cloud = null) {
  const c = +code;
  let phase = 'clear';
  if (c === 0) phase = cloud != null && cloud > 40 ? 'fair' : 'clear';
  else if (c === 1 || c === 2) phase = 'fair';
  else if (c === 3) phase = 'overcast';
  else if (c === 45 || c === 48) phase = cloud != null && cloud < 50 ? 'mist' : 'fog';
  else if (c >= 51 && c <= 57) phase = 'drizzle';
  else if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) phase = 'rain';
  else if ((c >= 71 && c <= 77) || c === 85 || c === 86) phase = 'snow';
  else if (c >= 95) phase = 'storm';
  return { phase, wind: windKmh >= 30 && !['fog', 'mist', 'drizzle', 'snowfog', 'storm'].includes(phase) };
}
const LIVE_KEY = 'lesesaal.liveWeather';
const LIVE_EVERY = 30 * 60 * 1000;

/** Places by name for the live weather (Open-Meteo's geocoding): [{ name, region, country, lat, lon }]. */
export async function searchPlaces(name, lang = 'de', fetch = (url) => api.app?.fetch?.(url)) {
  const q = String(name || '').trim();
  if (q.length < 2) return [];
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=${lang === 'en' ? 'en' : 'de'}&format=json`);
  if (!r?.ok) throw new Error(r?.error || ('HTTP ' + (r?.status ?? '?')));
  return (JSON.parse(r.text || '{}').results || []).map((p) => ({ name: p.name, region: p.admin1 || '', country: p.country || '', lat: +(+p.latitude).toFixed(3), lon: +(+p.longitude).toFixed(3) }));
}

// ---------------------------------------------------------------- the whole -----------------------------------------------
/** What decides the fixed weather (a change of it applies at once). */
const fixedKeyOf = (s) => `${s?.weather}|${s?.sky?.base}|${s?.sky?.fog}|${s?.sky?.wind}`;
const PARTS = ['cloud', 'overcast', 'rain', 'snow', 'thunder', 'fog', 'wind'];
export class SkyState {
  /** (the checks reach the functions of this module through the world: world.sky.constructor.helpers) */
  static helpers = { fixedWeatherOf, fits, legacyWeather, mixOf, phaseOf, nameOfMix, phaseAllowed, nextPhase, phaseOfCode, moonPhase, sunPosition };
  /** `world` gives settings, env (the environment to drive), and optionally api.app.fetch for the live weather. */
  constructor(world, { fetch = (url) => api.app?.fetch?.(url) } = {}) {
    this.world = world;
    this.fetch = fetch;
    this.t = 0;                    // own seconds (the loop's time)
    this.clockKey = null;
    this.hour = 12; this.skyHour = 12; this.sun = null; this.loop = 0;
    this.day0 = clockTime(0);      // midnight of the first day: the sky time counts from there
    this.mix = mixOf('clear');
    this.target = mixOf('clear');
    this.phase = 'clear';          // the changing weather's phase now
    this.phaseLeft = 0;            // seconds until the next one
    this.history = [];             // [{ t, phase }] (the checks)
    this.rnd = Math.random;
    this.moonOverride = null;      // the checks and the screenshots: a phase instead of the date's
    this.version = 0;              // goes up whenever the weather changes (state() is kept until then)
    this.live = { status: 'idle', at: 0, place: null, phase: null, error: null };
    this.listeners = new Set();
    this.lastName = null;
    this.modeKey = null;
    try { const q = new URLSearchParams(location.search); if (q.has('moon')) this.moonOverride = +q.get('moon'); } catch {}
  }

  // ------------------------------------------------------------ the clock -------------------------------------------
  /** The local clock hour of the computer, with seconds. */
  static realHour(d = new Date()) { return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600 + d.getMilliseconds() / 3.6e6; }
  /** The share of the day and night modes' loop the change to the next morning (or dusk) takes. */
  static twilightShare(seconds) { return Math.min(0.08, TWILIGHT_S / seconds); }
  /** Where the hour `h` lies in a span (0 … 1), or null outside it. */
  static #within(h, span) {
    const len = (span.to - span.from + 24) % 24, d = ((h - span.from) % 24 + 24) % 24;
    return d <= len ? d / len : null;
  }
  /** Bring the clock to the settings: the hour and the sky time, the sun of the day mode's twilight. `dt` seconds pass. */
  tick(dt = 0) {
    const s = this.world.settings || {}, mode = timeModeOf(s), D = dayMinutesOf(s) * 60;
    this.t += dt;
    const key = mode + ':' + D;
    if (key !== this.clockKey) this.#anchor(mode, D);
    this.clockKey = key;
    this.sun = null;
    if (mode === 'fixed') { this.hour = this.skyHour = +(s.fixedHour ?? 20); return; }
    if (mode === 'golden') { this.hour = this.skyHour = this.world.godrays?.golden?.hour ?? 19.9; return; }
    if (mode === 'real') { const h = SkyState.realHour(); this.hour = h; this.skyHour = h; return; }
    if (mode === 'cycle') {
      const total = this.anchor + (this.t - this.t0) * 24 / D;
      this.hour = ((total % 24) + 24) % 24; this.skyHour = total;
      return;
    }
    // the day and the night mode: a loop of D seconds, the last part of it the twilight to the next one
    const span = mode === 'day' ? DAY_SPAN : NIGHT_SPAN, len = (span.to - span.from + 24) % 24;
    const tau = SkyState.twilightShare(D), u = this.anchor + (this.t - this.t0) / D, loop = Math.floor(u), f = u - loop;
    this.loop = loop;
    // the sky time goes on from loop to loop without a jump: the stars and the moon of one night's dawn are those of the
    // next night's dusk (it stands while the twilight leads over)
    const part = Math.min(1, f / (1 - tau));
    this.skyHour = span.from + (loop + part) * len;
    if (f < 1 - tau) { this.hour = (span.from + part * len) % 24; return; }
    // the twilight: the sun goes along under the northern horizon (from where it set to where it rises, or back from
    // dawn to dusk); the clock stays at the evening (the dawn) and goes over to the morning (the dusk) half way, so it
    // never shows the hours left out
    const g = (f - (1 - tau)) / tau;
    this.hour = g < 0.5 ? (span.to + g * 0.4) % 24 : (span.from - (1 - g) * 0.4 + 24) % 24;
    this.sun = SkyState.twilightSun(mode, g, this._sun || (this._sun = new THREE.Vector3()));
  }
  /** The sun of the twilight between two days (day mode, g 0 … 1) or two nights (night mode). */
  static twilightSun(mode, g, out = new THREE.Vector3()) {
    const span = mode === 'day' ? DAY_SPAN : NIGHT_SPAN;
    const from = sunPosition(span.to), to = sunPosition(span.from);
    let a0 = Math.atan2(from.z, from.x), a1 = Math.atan2(to.z, to.x);
    // the short way round through the north (+z): the day mode goes on the way the sun went, the night mode back
    if (mode === 'day') { while (a1 < a0) a1 += Math.PI * 2; } else { while (a1 > a0) a1 -= Math.PI * 2; }
    const e0 = Math.asin(from.y), e1 = Math.asin(to.y);
    const s = g * g * (3 - 2 * g), a = lerp(a0, a1, s);
    // the day mode dips only to a blue hour; the night mode goes deeper, unseen
    const e = lerp(e0, e1, s) - (mode === 'day' ? 0.02 : 0.09) * Math.sin(Math.PI * g);
    return out.set(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).normalize();
  }
  /** A new mode or day length: go on from the hour shown now (a mode switched on at start: from the real time). */
  #anchor(mode, D) {
    const first = this.clockKey === null;
    const from = first ? SkyState.realHour() : this.hour;
    this.t0 = this.t;
    if (mode === 'cycle') { this.anchor = from; return; }
    if (mode === 'day' || mode === 'night') {
      const span = mode === 'day' ? DAY_SPAN : NIGHT_SPAN, tau = SkyState.twilightShare(D);
      const at = SkyState.#within(from, span);
      // inside the span: from there on; outside it the loop starts at its beginning (morning, dusk)
      this.anchor = at == null ? 0 : at * (1 - tau);
    }
  }
  /** The moment the sky shows (ms): the real time, else the sky time counted from the first day's midnight. */
  skyTime() { return timeModeOf(this.world.settings) === 'real' ? Date.now() : this.day0 + this.skyHour * 3600000; }
  /** The moon's phase now (the date's, or the override of the checks). */
  moonPhase() { return this.moonOverride != null && isFinite(this.moonOverride) ? ((this.moonOverride % 1) + 1) % 1 : moonPhase(); }

  // ------------------------------------------------------------ the weather ------------------------------------------
  /** The settings changed: a fixed weather applies at once, a changing one keeps its phase, the live one fetches. */
  applySettings() {
    const s = this.world.settings || {}, mode = weatherModeOf(s), first = this.modeKey === null;
    const winter = seasonOf(s.season) === 'winter';
    this.fixedKey = fixedKeyOf(s);
    if (mode === 'fixed') {
      const fw = fixedWeatherOf(s);
      this.phase = phaseOf(fw);
      this.target = mixOf(this.phase, { wind: fw.wind });
      // the ground as it is in that weather at once: snow lies, the boards are wet (as before)
      this.mix = { ...this.target };
    } else if (mode === 'changing') {
      const allow = s.sky?.allow || {};
      if (this.modeKey !== 'changing' || !phaseAllowed(this.phase, allow, winter)) {
        // at the start a dry or a rainy weather by chance; switched on later, the weather shown now goes on if it may
        const start = ['clear', 'fair', 'fair', 'overcast', 'clearing', 'rain'].filter((p) => phaseAllowed(p, allow, winter));
        const now = first ? start[Math.floor(this.rnd() * start.length)] : this.modeKey === 'fixed' ? phaseOf(fixedWeatherOf(s)) : this.phase;
        this.phase = phaseAllowed(now, allow, winter) ? now : 'fair';
        this.phaseLeft = 600 + this.rnd() * 1200;
        this.history.push({ t: this.t, phase: this.phase });
      }
      this.target = mixOf(this.phase);
      if (first) this.mix = { ...this.target };
    } else if (mode === 'live') {
      this.#liveStart(s);
      if (first) this.mix = { ...this.target };
    }
    this.modeKey = mode;
    this.dirty = true;
    this.version++;
    this.#emit();
  }
  /** Every frame: the changing weather goes on, the mix follows its target. True when the mix moved. */
  #weather(dt) {
    const s = this.world.settings || {}, mode = weatherModeOf(s);
    // (settings changed without applySettings: the checks set world.settings directly)
    if (mode !== this.modeKey || (mode === 'fixed' && fixedKeyOf(s) !== this.fixedKey)) this.applySettings();
    if (mode === 'changing') {
      this.phaseLeft -= dt;
      if (this.phaseLeft <= 0) {
        const winter = seasonOf(s.season) === 'winter';
        this.phase = nextPhase(this.phase, this.rnd(), s.sky?.allow || {}, winter);
        this.phaseLeft = 600 + this.rnd() * 1200;
        this.target = mixOf(this.phase);
        this.history.push({ t: this.t, phase: this.phase }); if (this.history.length > 500) this.history.shift();
      }
    } else if (mode === 'live') this.#liveTick(s);
    return this.#ease(dt);
  }
  /** Move the mix towards the target; the ground gets wet and dries, snow settles and melts slowly. */
  #ease(dt) {
    if (dt <= 0) return false;
    const m = this.mix, T = this.target;
    let moved = false;
    for (const k of PARTS) {
      const d = T[k] - m[k];
      if (Math.abs(d) < 1e-4) { if (m[k] !== T[k]) { m[k] = T[k]; moved = true; } continue; }
      m[k] += d * Math.min(1, dt / EASE[k]); moved = true;
    }
    const toward = (k, goal, up, down) => { const d = goal - m[k]; if (Math.abs(d) < 1e-4) { if (m[k] !== goal) { m[k] = goal; moved = true; } return; } m[k] += d * Math.min(1, dt / (d > 0 ? up : down)); moved = true; };
    toward('wet', m.rain > 0.05 ? 1 : 0, 25, 420);
    toward('cover', m.snow > 0.1 ? 1 : 0, 150, 900);
    toward('frozen', m.cover > 0.6 ? 1 : 0, 300, 600);
    m.phase = T.phase;
    return moved;
  }

  /** The live weather: fetch now and every 30 minutes (the last state from the last run until then, also offline). */
  #liveStart(s) {
    const place = s.sky?.place;
    const key = place ? `${place.lat},${place.lon}` : '';
    if (key !== this.live.key) {
      this.live = { status: place ? 'loading' : 'noplace', at: 0, place, phase: null, error: null, key };
      try { const last = JSON.parse(localStorage.getItem(LIVE_KEY) || 'null'); if (last && last.key === key) Object.assign(this.live, { phase: last.phase, wind: last.wind, at: last.at, status: 'stale', code: last.code, temp: last.temp }); } catch {}
    }
    this.#liveTarget();
    if (place && Date.now() - (this.live.at || 0) > LIVE_EVERY) this.#liveFetch();
  }
  #liveTick(s) {
    if (s.sky?.place && !this.live.busy && Date.now() - (this.live.tried || 0) > 60000 && Date.now() - (this.live.at || 0) > LIVE_EVERY) this.#liveFetch();
  }
  #liveTarget() {
    // (nothing fetched yet: the weather stays as it is)
    if (this.live.phase) { this.phase = this.live.phase; this.target = mixOf(this.live.phase, { wind: !!this.live.wind }); }
    else this.target = { ...this.mix };
  }
  async #liveFetch() {
    const place = this.live.place, fetch = this.fetch;
    if (!place || !fetch || this.live.busy) return;
    this.live.busy = true; this.live.tried = Date.now();
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${(+place.lat).toFixed(3)}&longitude=${(+place.lon).toFixed(3)}&current=weather_code,cloud_cover,wind_speed_10m,temperature_2m&timezone=auto`;
      const r = await fetch(url);
      const cur = r?.ok ? JSON.parse(r.text || '{}').current : null;
      if (!cur || cur.weather_code == null) throw new Error(r?.error || ('HTTP ' + (r?.status ?? '?')));
      if (this.live.place !== place) return;
      const { phase, wind } = phaseOfCode(cur.weather_code, cur.wind_speed_10m, cur.cloud_cover);
      const fresh = !this.live.phase;
      Object.assign(this.live, { phase, wind, at: Date.now(), status: 'ok', error: null, code: cur.weather_code, temp: cur.temperature_2m });
      try { localStorage.setItem(LIVE_KEY, JSON.stringify({ key: this.live.key, phase, wind, at: this.live.at, code: cur.weather_code, temp: cur.temperature_2m })); } catch {}
      if (weatherModeOf(this.world.settings) === 'live') {
        this.#liveTarget();
        // a place just chosen shows its weather at once; the later ones blend in over a few minutes
        if (fresh) { this.mix = { ...this.target }; this.dirty = true; }
      }
      this.version++;
    } catch (e) {
      // offline or the service is down: the last weather stays
      Object.assign(this.live, { status: this.live.phase ? 'stale' : 'error', error: String(e?.message || e) });
    } finally { this.live.busy = false; this.version++; this.#emit(true); }
  }

  // ------------------------------------------------------------ each frame -------------------------------------------
  /** The clock and the weather for this frame; the environment gets them when anything changed. */
  frame(dt) {
    const env = this.world.env;
    const h0 = this.hour, s0 = this.skyHour;
    this.tick(dt);
    const moved = this.#weather(dt);
    if (moved) this.version++;
    if (!env) return;
    const timeMoved = this.hour !== h0 || this.skyHour !== s0 || !!this.sun;
    if (moved || timeMoved || this.dirty) {
      this.dirty = false;
      env.set(this.#envState());
    }
    if (moved) this.#emit();
  }
  /** Apply at once (after a rebuild or a settings change). */
  push() {
    this.dirty = true;
    this.tick(0);
    this.world.env?.set(this.#envState());
  }
  #envState() {
    const e = this._env ||= {};
    e.hour = this.hour; e.skyHour = this.skyHour; e.skyTime = this.skyTime(); e.sun = this.sun; e.moonPhase = this.moonPhase(); e.mix = this.mix; e.weather = nameOfMix(this.mix);
    return e;
  }

  /** The weather now for other code: { name (the old word), base, phase, fog, wind, thunder, rain, snow, cloud, overcast,
   *  wet, cover, mode }; the parts 0 … 1. */
  state() {
    if (this._state && this._stateAt === this.version) return this._state;
    this._stateAt = this.version;
    return (this._state = this.#makeState());
  }
  #makeState() {
    const m = this.mix;
    return { name: nameOfMix(m), base: baseOfMix(m), phase: this.phase, mode: weatherModeOf(this.world.settings), fog: m.fog, wind: m.wind, thunder: m.thunder, rain: m.rain, snow: m.snow, cloud: m.cloud, overcast: m.overcast, wet: m.wet, cover: m.cover, live: weatherModeOf(this.world.settings) === 'live' ? { ...this.live } : null };
  }
  /** fn(state) whenever the weather's word, rain or thunder changes (or the live weather was fetched). */
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  #emit(force = false) {
    const st = this.state(), key = `${st.name}|${st.rain > 0.05}|${st.thunder > 0.5}|${st.snow > 0.1}|${st.wind > 0.6}|${st.fog > 0.5}`;
    if (!force && key === this.lastName) return;
    this.lastName = key;
    for (const fn of this.listeners) { try { fn(st); } catch (e) { console.warn('[sky] listener', e); } }
  }

  /** The checks: go over to a phase of the changing weather now (it blends in as any other). */
  force(phase) { this.phase = phase; this.target = mixOf(phase); this.phaseLeft = 600 + this.rnd() * 1200; this.history.push({ t: this.t, phase }); }
  /**
   * The checks: run the changing weather for `seconds` (in steps of `step`) with a seeded random source; returns the
   * phases it went through [{ t, phase }]. The weather of the world is set back afterwards.
   */
  simulate(seconds, { allow = { rain: true, storm: true, fog: true, snow: true }, winter = false, seed = 7, step = 5, start = 'clear' } = {}) {
    let x = seed >>> 0;
    const rnd = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
    let phase = start, left = 600 + rnd() * 1200;
    const out = [{ t: 0, phase }];
    for (let t = 0; t < seconds; t += step) {
      left -= step;
      if (left <= 0) { phase = nextPhase(phase, rnd(), allow, winter); left = 600 + rnd() * 1200; out.push({ t: t + step, phase }); }
    }
    return out;
  }
}
