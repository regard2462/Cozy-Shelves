// "Weiterschauen": which playback positions are worth remembering and where a film resumes.
// Pure functions (used by library.js, tested by test-mediathek.js).
'use strict';

const MIN_POSITION = 30;      // s: earlier than this counts as "not started"
const END_SECONDS = 90;       // s before the end (credits) count as watched
const END_FRACTION = 0.95;
const STEP_BACK = 5;          // s: resume a little earlier to find the thread again
const MAX_ENTRIES = 300;

/** 'none' (forget), 'resume' (keep the position) or 'done' (watched to the end). */
function classify(position, duration) {
  const pos = Number(position) || 0, dur = Number(duration) || 0;
  if (dur > 0 && (pos >= dur - Math.min(END_SECONDS, dur * 0.1) || pos / dur >= END_FRACTION)) return 'done';
  if (pos < MIN_POSITION) return 'none';
  if (dur > 0 && dur < 3 * 60) return 'none';
  return 'resume';
}

/** Where playback of `entry` ({ position, duration, state }) starts: 0 unless it is a resumable position. */
function startAt(entry) {
  if (!entry || entry.state !== 'resume') return 0;
  const pos = Number(entry.position) || 0;
  return pos > MIN_POSITION ? Math.max(0, pos - STEP_BACK) : 0;
}

/**
 * Apply one progress report to the map { [id]: entry }. Returns the new entry or null when the
 * position is not worth keeping (an older resumable entry of that film is removed then).
 */
function update(map, item, position, duration, now = Date.now()) {
  if (!item || !item.id || item.live) return null;
  const state = classify(position, duration);
  const prev = map[item.id];
  if (state === 'none') {
    if (prev && prev.state === 'resume') delete map[item.id];
    return null;
  }
  const entry = { id: item.id, position: Math.round(Number(position) || 0), duration: Math.round(Number(duration) || 0), state, updatedAt: now, item: prev && prev.item && !item.title ? prev.item : item };
  map[item.id] = entry;
  return entry;
}

/** Keep the newest MAX_ENTRIES entries. */
function prune(map, max = MAX_ENTRIES) {
  const ids = Object.keys(map);
  if (ids.length <= max) return map;
  ids.sort((a, b) => (map[b].updatedAt || 0) - (map[a].updatedAt || 0));
  for (const id of ids.slice(max)) delete map[id];
  return map;
}

/** The "Weiterschauen" list: resumable entries, newest first. */
function continueList(map, limit = 60) {
  return Object.values(map).filter((e) => e.state === 'resume').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

module.exports = { classify, startAt, update, prune, continueList, MIN_POSITION };
