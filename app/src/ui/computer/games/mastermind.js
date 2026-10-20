// Mastermind – Farbcode raten. Schwarz = richtige Farbe am richtigen Platz, Weiß = richtige Farbe.
import { h, clear } from '../../../core/dom.js';
import { btn, segmented, T } from '../terminal.js';

const COLOURS = [
  { id: 0, hex: '#a8472f', de: 'Rot', en: 'Red' },
  { id: 1, hex: '#a9702c', de: 'Ocker', en: 'Ochre' },
  { id: 2, hex: '#5f7a49', de: 'Grün', en: 'Green' },
  { id: 3, hex: '#4a6fa5', de: 'Blau', en: 'Blue' },
  { id: 4, hex: '#7a4a7d', de: 'Violett', en: 'Purple' },
  { id: 5, hex: '#2f6a6a', de: 'Petrol', en: 'Teal' },
  { id: 6, hex: '#e8d6ad', de: 'Elfenbein', en: 'Ivory' },
  { id: 7, hex: '#3b2a1b', de: 'Sepia', en: 'Sepia' },
];

/** { black, white } feedback for a guess against the secret. Pure – used by the tests. */
export function feedback(secret, guess) {
  let black = 0;
  const sc = {}, gc = {};
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) black++;
    else { sc[secret[i]] = (sc[secret[i]] || 0) + 1; gc[guess[i]] = (gc[guess[i]] || 0) + 1; }
  }
  let white = 0;
  for (const k of Object.keys(gc)) white += Math.min(gc[k], sc[k] || 0);
  return { black, white };
}

export async function mount(root, g) {
  let slots = 4, palette = 6, rows = 10, allowRepeat = true;
  let secret = [], guesses = [], cur = [], curSlot = 0, pen = 0, over = false, won = false;

  const boardEl = h('div.term-mm');
  const paletteEl = h('div.term-mm-palette');
  const msg = h('div.term-game-msg');
  const statusEl = h('div.term-chess-status');
  const slotSeg = segmented([[4, '4'], [5, '5']], 4, (v) => { slots = +v; start(); });
  const palSeg = segmented([[6, '6'], [8, '8']], 6, (v) => { palette = +v; start(); });
  const repSeg = segmented([[1, T('mit Wiederholung', 'with repeats')], [0, T('ohne', 'without')]], 1, (v) => { allowRepeat = !!+v; start(); });

  root.appendChild(h('div.term-game-center',
    h('div.term-game-bar',
      h('span.term-prompt', T('Stellen', 'Slots')), slotSeg.el,
      h('span.term-prompt', T('Farben', 'Colours')), palSeg.el,
      repSeg.el, h('span.spacer'),
      btn(T('Neu (N)', 'New (N)'), () => { start(); g.sfx.click(); })),
    statusEl, paletteEl, boardEl, msg,
    h('div.term-game-bar.term-dim', T('←→ Stelle wählen · ↑↓ oder 1-8 Farbe setzen · ⏎ raten · ⌫ löschen · Maus: Farbe anklicken, dann Stelle',
      '←→ choose slot · ↑↓ or 1-8 set colour · ⏎ guess · ⌫ clear · mouse: pick a colour, then a slot'))));

  function start() {
    secret = [];
    const pool = COLOURS.slice(0, palette).map((c) => c.id);
    if (allowRepeat) for (let i = 0; i < slots; i++) secret.push(pool[(Math.random() * pool.length) | 0]);
    else { const p = pool.slice(); for (let i = 0; i < slots; i++) { const k = (Math.random() * p.length) | 0; secret.push(p.splice(k, 1)[0]); } }
    guesses = []; cur = Array(slots).fill(null); curSlot = 0; pen = 0; over = false; won = false;
    msg.textContent = '';
    slotSeg.set(slots); palSeg.set(palette); repSeg.set(allowRepeat ? 1 : 0);
    renderPalette(); render();
  }
  function renderPalette() {
    clear(paletteEl);
    COLOURS.slice(0, palette).forEach((c, i) => {
      const sw = h('button.term-mm-swatch', { type: 'button', tabindex: -1, title: `${i + 1} · ${g.tr({ de: c.de, en: c.en })}`,
        style: { background: c.hex }, onclick: () => { pen = c.id; renderPalette(); if (!over) setColour(c.id); } });
      if (c.id === pen) sw.classList.add('on');
      paletteEl.appendChild(sw);
    });
  }
  function pegEl(v, onclick, isCur) {
    const c = COLOURS[v];
    const el = h('button.term-mm-peg', { type: 'button', tabindex: -1, style: { background: c ? c.hex : '' }, onclick });
    if (isCur) el.classList.add('cur');
    return el;
  }
  function render() {
    clear(boardEl);
    boardEl.style.setProperty('--mm-slots', String(slots));
    for (let r = 0; r < rows; r++) {
      const gu = guesses[r];
      const active = !over && r === guesses.length;
      const row = h('div.term-mm-row', { class: active ? 'active' : '' }, h('span.term-mm-no', String(r + 1)));
      row.style.setProperty('--mm-slots', String(slots));
      for (let i = 0; i < slots; i++) {
        const v = gu ? gu.guess[i] : (active ? cur[i] : null);
        row.appendChild(pegEl(v == null ? -1 : v, active ? () => { curSlot = i; if (pen != null) setColour(pen); else render(); } : null, active && i === curSlot));
      }
      const key = h('div.term-mm-key');
      if (gu) {
        for (let i = 0; i < slots; i++) key.appendChild(h('i', { class: i < gu.fb.black ? 'black' : i < gu.fb.black + gu.fb.white ? 'white' : '' }));
      } else for (let i = 0; i < slots; i++) key.appendChild(h('i'));
      row.appendChild(key);
      boardEl.appendChild(row);
    }
    if (over) {
      const reveal = h('div.term-mm-row', h('span.term-mm-no', '★'));
      reveal.style.setProperty('--mm-slots', String(slots));
      for (let i = 0; i < slots; i++) reveal.appendChild(pegEl(secret[i], null, false));
      reveal.appendChild(h('div.term-mm-key'));
      boardEl.appendChild(reveal);
    }
    statusEl.textContent = over ? (won ? T('Geknackt!', 'Cracked!') : T('Aufgebraucht. Der Code wird gezeigt.', 'Out of tries – here is the code.'))
      : T('Versuch {n} von {m}', 'Guess {n} of {m}', { n: guesses.length + 1, m: rows });
  }
  function setColour(v) {
    if (over) return;
    cur[curSlot] = v;
    if (curSlot < slots - 1) curSlot++;
    g.sfx.type(); render();
  }
  function guess() {
    if (over) return;
    if (cur.some((v) => v == null)) { g.sfx.error(); msg.textContent = T('Es fehlen noch Farben.', 'Some slots are still empty.'); return; }
    const fb = feedback(secret, cur);
    guesses.push({ guess: cur.slice(), fb });
    msg.textContent = T('{b} schwarz · {w} weiß', '{b} black · {w} white', { b: fb.black, w: fb.white });
    if (fb.black === slots) {
      over = true; won = true;
      msg.textContent = T('Code geknackt in {n} Versuchen!', 'Code cracked in {n} guesses!', { n: guesses.length });
      if (g.best.set(guesses.length, '', false)) msg.textContent += T(' Neuer Rekord!', ' New record!');
      g.sfx.open();
    } else if (guesses.length >= rows) { over = true; g.sfx.error(); }
    else { cur = Array(slots).fill(null); curSlot = 0; g.sfx.click(); }
    render();
  }

  start();
  g.setHints([['←→', T('Stelle', 'slot')], ['1-8', T('Farbe', 'colour')], ['⏎', T('raten', 'guess')], ['⌫', T('löschen', 'clear')], ['N', T('neu', 'new')], ['Esc', T('Spiele', 'games')]]);
  return {
    unmount() {},
    onKey(e) {
      const k = e.key;
      if (k === 'ArrowLeft') { curSlot = (curSlot + slots - 1) % slots; render(); e.preventDefault(); return true; }
      if (k === 'ArrowRight') { curSlot = (curSlot + 1) % slots; render(); e.preventDefault(); return true; }
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        const d = k === 'ArrowUp' ? 1 : -1;
        const v = cur[curSlot] == null ? 0 : (cur[curSlot] + d + palette) % palette;
        cur[curSlot] = v; pen = v; renderPalette(); render(); e.preventDefault(); return true;
      }
      if (/^[1-8]$/.test(k)) { const v = +k - 1; if (v < palette) { pen = v; renderPalette(); setColour(v); } return true; }
      if (k === 'Enter') { guess(); e.preventDefault(); return true; }
      if (k === 'Backspace' || k === 'Delete') { cur[curSlot] = null; render(); return true; }
      if (k === 'n' || k === 'N') { start(); g.sfx.click(); return true; }
      return false;
    },
  };
}
