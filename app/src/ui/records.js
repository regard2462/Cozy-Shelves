// Record player panel: rack of record sleeves (procedural records with generated watercolour sleeve art),
// a spinning turntable with tonearm, volume sliders and the user's own music folder. (The sounds of the world have no
// switches since 0.7: they follow the weather and the place, audio/soundscape.js.)
import { h, clear, $ } from '../core/dom.js';
import { tr } from '../core/i18n.js';
import { hashString } from '../core/cover-art.js';
import { has } from '../core/platform.js';

/** makes a non-<button> row behave like a button for mouse AND keyboard */
const clickable = (fn, label) => ({
  role: 'button', tabindex: '0', 'aria-label': label || undefined,
  onclick: fn,
  onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); } },
});

const CSS_HREF = './styles/records.css';
function ensureCss() {
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /records\.css/.test(l.getAttribute('href') || ''))) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href: CSS_HREF, id: 'rec-css' }));
}

// ---------------------------------------------------------------- sleeve art
const artCache = new Map();
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const MOODS = {
  warm: { hues: [28, 38, 18, 45], sat: [55, 75], light: [45, 62], paper: '#f4e8d2' },
  cool: { hues: [205, 215, 195, 230], sat: [30, 50], light: [42, 62], paper: '#eef0ea' },
  ember: { hues: [10, 22, 350, 30], sat: [50, 70], light: [35, 55], paper: '#f1e3cf' },
  pale: { hues: [215, 225, 200, 250], sat: [18, 32], light: [55, 75], paper: '#f2f2ee' },
  sea: { hues: [185, 175, 195, 210], sat: [35, 55], light: [35, 58], paper: '#eaefe9' },
  none: { hues: [40, 35, 45], sat: [10, 20], light: [55, 75], paper: '#f3ecdd' },
  user: { hues: [0], sat: [30, 55], light: [40, 60], paper: '#f2e9d8' },
};
/** Deterministic watercolour sleeve for a record. Returns a canvas (size × size). */
export function sleeveArt(rec, size = 320) {
  const key = rec.id + ':' + size;
  if (artCache.has(key)) return artCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  const r = mulberry(hashString(rec.id));
  const mood = MOODS[rec.mood] || MOODS.user;
  const baseHue = rec.hue ?? (hashString(rec.id) % 360);
  const hues = rec.mood && MOODS[rec.mood] ? mood.hues : [baseHue, baseHue + 25, baseHue - 30, baseHue + 160];
  // paper
  x.fillStyle = mood.paper; x.fillRect(0, 0, size, size);
  const grad = x.createLinearGradient(0, 0, size, size); grad.addColorStop(0, 'rgba(255,255,255,0.25)'); grad.addColorStop(1, 'rgba(90,60,30,0.08)');
  x.fillStyle = grad; x.fillRect(0, 0, size, size);
  // watercolour blobs: layered translucent organic shapes with darker pooled edges
  const blobs = 4 + Math.floor(r() * 3);
  for (let b = 0; b < blobs; b++) {
    const hue = hues[Math.floor(r() * hues.length)] + (r() - 0.5) * 14;
    const sat = mood.sat[0] + r() * (mood.sat[1] - mood.sat[0]);
    const lig = mood.light[0] + r() * (mood.light[1] - mood.light[0]);
    const cx = size * (0.2 + r() * 0.6), cy = size * (0.15 + r() * 0.55);
    const rad = size * (0.12 + r() * 0.22);
    for (let layer = 0; layer < 3; layer++) {
      const pts = 9 + Math.floor(r() * 5);
      const scale = 1 - layer * 0.22;
      x.beginPath();
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const rr = rad * scale * (0.72 + r() * 0.42);
        const px = cx + Math.cos(a) * rr * (1 + (r() - 0.5) * 0.2), py = cy + Math.sin(a) * rr * 0.85;
        if (i === 0) x.moveTo(px, py); else x.quadraticCurveTo(cx + Math.cos(a - Math.PI / pts) * rr * 1.08, cy + Math.sin(a - Math.PI / pts) * rr * 0.92, px, py);
      }
      x.closePath();
      x.fillStyle = `hsla(${hue},${sat}%,${lig}%,${0.16 + layer * 0.05})`; x.fill();
      x.strokeStyle = `hsla(${hue},${sat + 8}%,${lig - 12}%,${0.22})`; x.lineWidth = 1.2 + r(); x.stroke();
    }
  }
  // paper grain
  for (let i = 0; i < size * 6; i++) { x.fillStyle = `rgba(60,40,20,${0.02 + r() * 0.05})`; x.fillRect(r() * size, r() * size, 1, 1); }
  // typography
  const pad = size * 0.09;
  x.fillStyle = 'rgba(43,29,18,0.85)';
  x.textBaseline = 'alphabetic';
  let fs = size * 0.17;
  x.font = `600 ${fs}px "Cormorant Garamond", "EB Garamond", Georgia, serif`;
  while (x.measureText(rec.title).width > size - pad * 2 && fs > size * 0.07) { fs *= 0.92; x.font = `600 ${fs}px "Cormorant Garamond", "EB Garamond", Georgia, serif`; }
  x.fillText(rec.title, pad, size - pad - fs * 0.75);
  x.font = `italic ${size * 0.065}px "EB Garamond", Georgia, serif`;
  x.fillStyle = 'rgba(43,29,18,0.62)';
  const artist = String(rec.artist || '');
  let a = artist; while (x.measureText(a).width > size - pad * 2 && a.length > 3) a = a.slice(0, -2);
  x.fillText(a + (a !== artist ? '…' : ''), pad, size - pad);
  x.strokeStyle = 'rgba(43,29,18,0.35)'; x.lineWidth = 1;
  x.beginPath(); x.moveTo(pad, size - pad - fs * 0.75 - fs * 0.95); x.lineTo(pad + size * 0.22, size - pad - fs * 0.75 - fs * 0.95); x.stroke();
  // small edition mark
  x.font = `${size * 0.05}px "VT323", monospace`; x.fillStyle = 'rgba(43,29,18,0.4)';
  x.fillText((rec.procedural ? 'LS-' : 'MY-') + String(hashString(rec.id) % 900 + 100), size - pad - size * 0.16, pad + size * 0.05);
  artCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------- panel
export async function mount(container, ctx, params = {}) {
  ensureCss();
  const { audio, api, bus } = ctx;
  try { audio.init?.(); } catch (e) { /* */ }
  const settingsAudio = () => (ctx.state?.settings?.audio) || {};
  const T = (de, en) => tr({ de, en });

  const state = () => {
    const s = audio.state || {};
    const sa = settingsAudio();
    return {
      volumes: s.volumes || { music: sa.music ?? 0.45, ambient: sa.ambient ?? 0.6 },
      record: s.record || null, playing: !!s.playing, musicFolder: s.musicFolder ?? sa.musicFolder ?? null, userTracks: s.userTracks || [],
    };
  };
  let saveTimer = null, pendingPatch = {};
  const save = (patch) => {
    Object.assign(pendingPatch, patch);
    if (ctx.state?.settings) ctx.state.settings.audio = { ...(ctx.state.settings.audio || {}), ...patch };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { const p = pendingPatch; pendingPatch = {}; try { api.settings.set({ audio: p }); } catch (e) { console.warn('[records] save', e); } }, 250);
  };
  const click = () => audio.sfx?.('click');

  const play = (id) => {
    click();
    const cur = audio.currentRecord;
    if (cur && cur.id === id && audio.playing) { audio.stopRecord(); save({ record: null }); bus.emit('music:record', null); return; }
    audio.playRecord(id);
    save({ record: id });
    bus.emit('music:record', id);
  };
  const stop = () => { click(); audio.stopRecord(); save({ record: null }); bus.emit('music:record', null); };

  // ---- build
  const panel = h('div.panel.paper.rec-panel');
  container.appendChild(panel);
  let timeTimer = null;

  function render() {
    clear(panel);
    const s = state();
    const records = audio.records ? audio.records() : [];
    const procedural = records.filter((r) => r.procedural);
    const user = records.filter((r) => !r.procedural);

    // ---- turntable
    const label = h('div.rec-label');
    const disc = h('div.rec-disc', label, h('div.rec-spindle'));
    const platter = h('div.rec-platter', disc);
    const arm = h('div.rec-arm', h('div.rec-arm-base'), h('div.rec-arm-tube'), h('div.rec-arm-head'));
    const nowTitle = h('div.rec-now-title'), nowArtist = h('div.rec-now-artist'), nowTime = h('div.rec-now-time.mono');
    // the record waits on the platter while a film or a podcast plays (audio/engine.js hold); ▶ plays it anyway
    const nowHeld = h('div.rec-now-held', { hidden: true }, T('Pausiert, solange ein Film oder ein Podcast läuft', 'Paused while a film or a podcast is playing'));
    const btnPrev = h('button.btn.icon.rec-btn', { title: T('Vorheriger Titel', 'Previous track'), onclick: () => { click(); audio.prev(); } }, '⏮');
    const btnPlay = h('button.btn.icon.primary.rec-btn.rec-play', { title: T('Abspielen / Stopp', 'Play / stop') });
    const btnNext = h('button.btn.icon.rec-btn', { title: T('Nächster Titel', 'Next track'), onclick: () => { click(); audio.next(); } }, '⏭');
    btnPlay.onclick = () => {
      const cur = audio.currentRecord;
      if (audio.playing) return stop();
      const id = cur?.id || audio.lastRecord || settingsAudio().record || (procedural[0] && procedural[0].id);
      if (id) play(id);
    };
    const deck = h('div.rec-deck',
      h('div.rec-plinth', platter, arm, h('div.rec-plinth-foot')),
      h('div.rec-now', nowTitle, nowArtist, nowTime, nowHeld),
      h('div.rec-controls', btnPrev, btnPlay, btnNext),
      h('div.rec-volumes',
        volumeRow(T('Musik', 'Music'), s.volumes.music, (v) => { audio.setVolumes({ music: v }); save({ music: v }); }),
        volumeRow(T('Umgebung', 'Surroundings'), s.volumes.ambient, (v) => { audio.setVolumes({ ambient: v }); save({ ambient: v }); }),
      ),
    );

    // ---- rack of sleeves
    const rack = h('div.rec-rack');
    const sleeves = new Map();
    for (const rec of procedural) {
      const el = h('div.rec-sleeve', { dataset: { id: rec.id }, title: rec.silent ? T('Nur die Geräusche ringsum', 'Only the sounds around you') : T('Auflegen', 'Put on'), ...clickable(() => play(rec.id), `${rec.title}, ${rec.artist || ''}`) },
        h('div.rec-sleeve-art', sleeveArt(rec, 300), h('div.rec-sleeve-disc'), h('div.rec-sleeve-badge', T('läuft', 'playing'))),
        h('div.rec-sleeve-title', rec.title), h('div.rec-sleeve-artist', rec.artist));
      if (rec.silent) el.classList.add('silent');
      sleeves.set(rec.id, el); rack.appendChild(el);
    }

    // ---- own music
    const trackList = h('div.list.rec-tracks');
    const folderLabel = h('span.rec-folder', { title: s.musicFolder || '' });
    const btnFolder = h('button.btn.small', { onclick: async () => {
      click();
      let folder = null;
      try { folder = await api.files.pickFolder(T('Musikordner wählen', 'Choose music folder')); } catch (e) { /* */ }
      if (!folder) { if (!s.musicFolder) ctx.toast?.(T('Kein Ordner gewählt', 'No folder chosen')); return; }
      await audio.setMusicFolder(folder);
      save({ musicFolder: folder });
      render();
      const n = audio.state.userTracks.length;
      ctx.toast?.(n ? T(`${n} Titel gefunden`, `${n} tracks found`) : T('Keine Musikdateien in diesem Ordner', 'No music files in this folder'));
    } }, T('Ordner wählen…', 'Choose folder…'));
    const btnClear = h('button.btn.small.ghost', { title: T('Ordner entfernen', 'Remove folder'), onclick: async () => { click(); await audio.setMusicFolder(null); save({ musicFolder: null }); render(); } }, '✕');
    // the browser version cannot read a music folder: the section says so instead of offering the picker
    const own = has('musicFolder') ? h('section.rec-section.rec-own',
      h('h3.rec-h', T('Eigene Musik', 'Own music')),
      h('div.row.rec-folder-row', btnFolder, folderLabel, s.musicFolder ? btnClear : null),
      trackList,
    ) : h('section.rec-section.rec-own', h('h3.rec-h', T('Eigene Musik', 'Own music')), h('p.small.muted', T('Einen eigenen Musikordner spielt nur die Cozy-Shelves-App für den Desktop.', 'Only the Cozy Shelves desktop app plays a music folder of your own.')));

    panel.append(
      h('div.panel-header', h('span.rec-title', T('Plattenspieler', 'Record player')), h('span.rec-sub.muted.small', T('Leise Musik zum Lesen', 'Quiet music for reading')), h('span.spacer'), h('button.btn.small', { onclick: () => { click(); ctx.close(); } }, '✕')),
      h('div.panel-body.rec-body', deck, h('div.rec-right', h('h3.rec-h', T('Platten', 'Records')), rack, h('div.rec-sections', own))),
    );

    // ---- dynamic updates
    const fmt = (sec) => { sec = Math.max(0, Math.floor(sec || 0)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
    function updateTracks() {
      clear(trackList);
      const st = state();
      folderLabel.textContent = st.musicFolder ? st.musicFolder.split(/[\\/]/).filter(Boolean).slice(-2).join(' / ') : T('Kein Ordner gewählt', 'No folder chosen');
      folderLabel.title = st.musicFolder || '';
      const cur = audio.currentRecord;
      if (!st.userTracks.length) { trackList.appendChild(h('div.rec-empty.muted.small', st.musicFolder ? T('Keine Musikdateien (mp3, ogg, wav, flac, m4a, opus) gefunden.', 'No music files (mp3, ogg, wav, flac, m4a, opus) found.') : T('Wähle einen Ordner mit deiner Musik, die Titel erscheinen hier.', 'Choose a folder with your music – the tracks will appear here.'))); return; }
      st.userTracks.forEach((t, i) => {
        const active = cur && cur.id === t.id;
        trackList.appendChild(h('div.list-item.rec-track', { class: active ? 'active' : '', ...clickable(() => play(t.id), t.title) },
          h('span.rec-track-no.mono', String(i + 1).padStart(2, '0')), h('span.rec-track-title', t.title), h('span.spacer'), active ? h('span.rec-track-mark', audio.playing ? '♪' : '‖') : null));
      });
      btnPrev.disabled = btnNext.disabled = st.userTracks.length < 2;
    }
    function updateNow() {
      const st = state();
      const cur = st.record;
      const playing = st.playing;
      platter.classList.toggle('spinning', !!playing);
      platter.classList.toggle('empty', !cur || !!cur.silent);
      arm.classList.toggle('on', !!playing);
      clear(label);
      if (cur && !cur.silent) label.appendChild(sleeveArt(cur, 160));
      nowTitle.textContent = cur ? cur.title : T('Keine Platte aufgelegt', 'No record on the platter');
      nowArtist.textContent = cur ? (cur.silent ? T('Nur die Geräusche ringsum', 'Only the sounds around you') : cur.artist) : T('Wähle eine Platte aus dem Regal', 'Pick a record from the rack');
      btnPlay.textContent = playing ? '■' : '▶';
      nowHeld.hidden = !(audio.state?.held && cur && !cur.silent && !playing);
      for (const [id, el] of sleeves) { el.classList.toggle('playing', !!cur && cur.id === id && playing); el.classList.toggle('selected', !!cur && cur.id === id); }
      const userPlaying = cur && !cur.procedural;
      nowTime.hidden = !userPlaying;
      clearInterval(timeTimer); timeTimer = null;
      if (userPlaying) { const tick = () => { const p = audio.trackPosition || {}; nowTime.textContent = fmt(p.position) + (p.duration ? ' / ' + fmt(p.duration) : ''); }; tick(); timeTimer = setInterval(tick, 1000); }
      updateTracks();
    }
    updateNow();
    render.update = updateNow;
  }
  function volumeRow(label, value, onChange) {
    const input = h('input.range.rec-range', { type: 'range', min: 0, max: 100, value: Math.round((value ?? 0.5) * 100), 'aria-label': label });
    const val = h('span.rec-vol-val.mono', Math.round((value ?? 0.5) * 100) + '%');
    let t = null;
    input.oninput = () => { const v = Number(input.value) / 100; val.textContent = Math.round(v * 100) + '%'; clearTimeout(t); t = setTimeout(() => onChange(v), 60); };
    return h('label.rec-vol-row', h('span.rec-vol-label', label), input, val);
  }
  render();

  const offRecord = audio.onRecordChange?.(() => render.update?.());
  const offLang = bus.on('i18n:change', () => render());
  if (params.play) play(params.play);

  return {
    unmount() { offRecord?.(); offLang?.(); clearInterval(timeTimer); clearTimeout(saveTimer); if (Object.keys(pendingPatch).length) { try { api.settings.set({ audio: pendingPatch }); } catch (e) { /* */ } } },
    onKey(e) {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return false;
      if (e.key === ' ') { e.preventDefault(); $('.rec-play', panel)?.click(); return true; }
      if (e.key === 'ArrowRight') { audio.next(); return true; }
      if (e.key === 'ArrowLeft') { audio.prev(); return true; }
      return false;
    },
  };
}
