// Settings → Licht & Wetter: the time of day and the weather (the world's side is app/src/world/sky-state.js).
//   Tageszeit: Echte Uhrzeit, Tag-Nacht-Wechsel, Nur Tag, Nur Nacht (with the length of a day), Feste Uhrzeit (with the
//   hour), Goldene Stunde.
//   Wetter: Klar, Bewölkt, Regen, Gewitter, Schnee with the switches Nebel and Wind where they fit (a short reason where
//   not), Wechselnd with what it may bring, Wie draußen with the place.
import { h, clear } from '../core/dom.js';
import { t, tr } from '../core/i18n.js';
import { TIME_MODES, DAY_LENGTHS, BASES, fixedWeatherOf, weatherModeOf, timeModeOf, dayMinutesOf, legacyWeather, fits, REASONS, searchPlaces } from '../world/sky-state.js';
import { seasonOf } from '../world/season.js';

const TIME_LABELS = {
  real: { de: 'Echte Uhrzeit', en: 'Real time' }, cycle: { de: 'Tag-Nacht-Wechsel', en: 'Day–night cycle' },
  day: { de: 'Nur Tag', en: 'Day only' }, night: { de: 'Nur Nacht', en: 'Night only' },
  fixed: { de: 'Feste Uhrzeit', en: 'Fixed time' }, golden: { de: 'Goldene Stunde', en: 'Golden hour' },
};
const WEATHER_LABELS = {
  clear: { de: 'Klar', en: 'Clear' }, overcast: { de: 'Bewölkt', en: 'Overcast' }, rain: { de: 'Regen', en: 'Rain' },
  storm: { de: 'Gewitter', en: 'Thunderstorm' }, snow: { de: 'Schnee', en: 'Snow' },
  changing: { de: 'Wechselnd', en: 'Changing' }, live: { de: 'Wie draußen', en: 'Like outside' },
};
const PHASE_LABELS = {
  clear: { de: 'klar', en: 'clear' }, fair: { de: 'heiter', en: 'fair' }, overcast: { de: 'bewölkt', en: 'overcast' },
  rain: { de: 'Regen', en: 'rain' }, storm: { de: 'Gewitter', en: 'thunderstorm' }, snow: { de: 'Schnee', en: 'snow' },
  clearing: { de: 'aufklarend', en: 'clearing' }, mist: { de: 'Dunst', en: 'mist' }, fog: { de: 'Nebel', en: 'fog' },
  drizzle: { de: 'Nieselregen und Nebel', en: 'drizzle and fog' }, snowfog: { de: 'Schnee und Nebel', en: 'snow and fog' },
};
const minutes = (m) => (m < 60 ? tr({ de: '{n} Min.', en: '{n} min' }, { n: m }) : tr({ de: '{n} Std.', en: '{n} h' }, { n: m / 60 }));

/**
 * The rows of the section. `ui` = the settings panel's helpers { seg, slider, toggle, groupTitle, note, debounced },
 * `s()` the current settings, `set(patch)` stores a change (a promise), `render()` draws the section again, `ctx` the
 * panel context (ctx.world.weatherState for the live weather's status).
 */
export function skyRows({ ui, s, set, render, ctx }) {
  const { seg, slider, toggle, groupTitle, note, debounced } = ui;
  const st = s(), mode = timeModeOf(st), wmode = weatherModeOf(st), fixed = fixedWeatherOf(st);
  const rows = [];

  // --- the time of day ---------------------------------------------------------------------------------------------------
  rows.push(groupTitle(t('settings.time')));
  // the long choices keep their label readable and wrap in a narrow panel (.sky-wide in menu.css)
  const wide = (row) => { row.classList.add('sky-wide'); return row; };
  rows.push(wide(seg(t('settings.time'), TIME_MODES.map((m) => [m, tr(TIME_LABELS[m])]), () => timeModeOf(s()), (v) => set({ timeMode: v }).then(render))));
  if (mode === 'cycle' || mode === 'day' || mode === 'night') {
    const label = mode === 'night' ? tr({ de: 'Dauer einer Nacht', en: 'Length of a night' }) : tr({ de: 'Dauer eines Tages', en: 'Length of a day' });
    const hint = { cycle: { de: 'ein ganzer Tag mit seiner Nacht', en: 'a whole day with its night' }, day: { de: 'vom Morgen bis zum Abend, dann folgt gleich der nächste Morgen', en: 'from morning to evening, then the next morning follows' }, night: { de: 'von der Dämmerung bis zum Morgengrauen, dann folgt gleich die nächste Nacht', en: 'from dusk to dawn, then the next night follows' } }[mode];
    const row = seg(label, DAY_LENGTHS.map((m) => [m, minutes(m)]), () => dayMinutesOf(s()), (v) => set({ sky: { dayMinutes: v } }));
    row.querySelector('label')?.append(h('span.setting-hint', tr(hint)));
    rows.push(row);
  }
  if (mode === 'fixed') {
    rows.push(slider(t('settings.hour'), () => s().fixedHour ?? 20, debounced((v) => set({ fixedHour: v }), 100), { min: 0, max: 23.75, step: 0.25, fmt: (v) => `${Math.floor(v).toString().padStart(2, '0')}:${Math.round((v % 1) * 60).toString().padStart(2, '0')}` }));
  }

  // --- the weather ---------------------------------------------------------------------------------------------------------
  rows.push(groupTitle(t('settings.weather')));
  const current = () => (weatherModeOf(s()) === 'fixed' ? fixedWeatherOf(s()).base : weatherModeOf(s()));
  rows.push(wide(seg(t('settings.weather'), [...BASES, 'changing', 'live'].map((w) => [w, tr(WEATHER_LABELS[w])]), current, (v) => {
    if (v === 'changing' || v === 'live') return set({ sky: { mode: v } }).then(render);
    // a base: fog and wind stay on where they still fit
    const f = fixedWeatherOf(s()), ok = fits(v, { fog: f.fog });
    const fog = f.fog && ok.fog === true, wind = f.wind && fits(v, { fog }).wind === true;
    return set({ weather: legacyWeather(v, fog), sky: { mode: 'fixed', base: v, fog, wind } }).then(render);
  })));
  // a switch that may not fit: greyed out with its reason underneath, and it does nothing
  const extra = (label, hint, get, apply, reason) => {
    const row = toggle(label, () => !reason && get(), reason ? () => {} : apply, { hint: reason ? tr(REASONS[reason]) : hint });
    if (reason) { row.classList.add('setting-off'); row.toggleEl.setAttribute('aria-disabled', 'true'); row.toggleEl.title = tr(REASONS[reason]); row.toggleEl.onclick = null; row.toggleEl.onkeydown = null; }
    return row;
  };
  if (wmode === 'fixed') {
    const ok = fits(fixed.base, { fog: fixed.fog });
    rows.push(extra(tr({ de: 'Nebel', en: 'Fog' }), tr({ de: 'bei klarem Himmel ein Morgendunst, bei Regen Nieselregen', en: 'a morning mist under a clear sky, drizzle with rain' }),
      () => fixed.fog, (v) => set({ weather: legacyWeather(fixed.base, v), sky: { base: fixed.base, fog: v, wind: v ? false : fixed.wind } }).then(render), ok.fog === true ? null : ok.fog));
    rows.push(extra(tr({ de: 'Wind', en: 'Wind' }), tr({ de: 'die Bäume wiegen sich stärker, Regen und Schnee treiben schräg', en: 'the trees sway more, rain and snow drive slanting' }),
      () => fixed.wind, (v) => set({ sky: { wind: v } }).then(render), ok.wind === true ? null : ok.wind));
  } else if (wmode === 'changing') {
    const allow = st.sky?.allow || {}, winter = seasonOf(st.season) === 'winter';
    rows.push(note(tr({ de: 'Das Wetter wechselt alle 10 bis 30 Minuten von selbst: klar, Wolken, Regen, Aufklaren. Hier steht, was dabei kommen darf.', en: 'The weather changes by itself every 10 to 30 minutes: clear, clouds, rain, clearing. Choose what it may bring.' })));
    const may = (key, label, hint, reason) => extra(label, hint, () => allow[key] !== false, (v) => set({ sky: { allow: { [key]: v } } }), reason);
    rows.push(may('rain', tr({ de: 'Regen', en: 'Rain' }), tr({ de: 'auch Nieselregen', en: 'drizzle as well' })));
    rows.push(may('storm', tr({ de: 'Gewitter', en: 'Thunderstorm' }), tr({ de: 'mit Blitz und Donner, bei Tag wie bei Nacht', en: 'with lightning and thunder, by day and by night' })));
    rows.push(may('fog', tr({ de: 'Nebel', en: 'Fog' }), tr({ de: 'Morgendunst und dichter Nebel', en: 'morning mist and dense fog' })));
    const snowHint = winter ? tr({ de: 'jetzt im Winter', en: 'now, in winter' }) : null;
    const row = may('snow', tr({ de: 'Schnee', en: 'Snow' }), snowHint, winter ? null : 'notWinter');
    rows.push(row);
  } else {
    rows.push(...liveRows({ s, set, render, ctx, ui }));
  }
  return rows;
}

/** Wie draußen: the place, the search, how the weather there is. */
function liveRows({ s, set, render, ctx, ui }) {
  const { note } = ui;
  const place = s().sky?.place;
  const status = h('p.settings-note.small.muted.sky-live-status');
  const show = () => {
    const ws = ctx.world?.weatherState?.();
    const live = ws?.live;
    if (!status.isConnected && status.dataset.drawn) return;
    status.dataset.drawn = '1';
    if (!place) { status.textContent = tr({ de: 'Noch kein Ort gewählt. Bis dahin bleibt das Wetter, wie es ist.', en: 'No place chosen yet. Until then the weather stays as it is.' }); return; }
    if (!live || live.status === 'loading' || live.status === 'idle') { status.textContent = tr({ de: 'Das Wetter wird abgefragt …', en: 'Asking for the weather …' }); return; }
    const parts = [];
    if (live.phase) parts.push(tr(PHASE_LABELS[live.phase] || PHASE_LABELS.clear) + (live.wind ? tr({ de: ', windig', en: ', windy' }) : '') + (live.temp != null ? `, ${Math.round(live.temp)} °C` : ''));
    if (live.at) parts.push(tr({ de: 'Stand {t}', en: 'as of {t}' }, { t: new Date(live.at).toLocaleTimeString(ctx.i18n?.lang === 'en' ? 'en-GB' : 'de-DE', { hour: '2-digit', minute: '2-digit' }) }));
    if (live.status === 'stale' || live.status === 'error') parts.push(tr({ de: 'keine Verbindung, das letzte Wetter bleibt', en: 'no connection, the last weather stays' }));
    status.textContent = parts.join(' · ');
  };
  const timer = setInterval(show, 3000);
  setTimeout(show, 0);
  ui.keep?.(() => clearInterval(timer));
  const input = h('input.input.sky-place-input', { type: 'text', value: '', placeholder: tr({ de: 'Ort, z. B. Hamburg', en: 'Place, e.g. Hamburg' }), 'aria-label': tr({ de: 'Ort für das Wetter', en: 'Place for the weather' }) });
  const results = h('div.sky-places', { role: 'list' });
  const search = async () => {
    clear(results);
    const q = input.value.trim();
    if (q.length < 2) return;
    results.append(h('span.small.muted', tr({ de: 'Suche …', en: 'Searching …' })));
    let list = [];
    try { list = await searchPlaces(q, ctx.i18n?.lang); } catch (e) { clear(results); results.append(h('span.small.muted', tr({ de: 'Keine Verbindung zum Wetterdienst.', en: 'No connection to the weather service.' }))); return; }
    clear(results);
    if (!list.length) { results.append(h('span.small.muted', tr({ de: 'Kein Ort gefunden.', en: 'No place found.' }))); return; }
    for (const p of list) {
      const label = [p.name, p.region, p.country].filter(Boolean).join(', ');
      results.append(h('button.place.sky-place', { type: 'button', role: 'listitem', onclick: () => set({ sky: { place: { name: label, lat: p.lat, lon: p.lon } } }).then(render) }, label));
    }
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } };
  return [
    h('div.setting.setting-sky-place',
      h('label', tr({ de: 'Ort', en: 'Place' }), h('span.setting-hint', place ? place.name : tr({ de: 'keiner gewählt', en: 'none chosen' }))),
      h('div.ctl', input, h('button.btn.small', { type: 'button', onclick: search }, tr({ de: 'Suchen', en: 'Search' })))),
    results,
    status,
    note(tr({ de: 'Das Wetter kommt von Open-Meteo (ohne Konto) und wird alle 30 Minuten neu abgefragt. Dafür geht nur der Ort an den Dienst, kein Standort wird ermittelt. Ohne Verbindung bleibt das zuletzt abgefragte Wetter.', en: 'The weather comes from Open-Meteo (no account) and is asked for every 30 minutes. Only the place goes to the service, no location is detected. Without a connection the last weather stays.' })),
  ];
}
