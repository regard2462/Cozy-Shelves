// Watercolor studio panel: the easel in the 3D library. Left: brushes / palette / paper / reference image.
// Centre: the paper on a wooden easel (WebGL2 simulation, see watercolor-sim.js). Right: procedural generator.
import { h, clear } from '../../core/dom.js';
import { tr } from '../../core/i18n.js';
import { isElectron } from '../../core/api.js';
import { createWatercolorSim, pigmentFromColor, hexToRgb, rgbToHex } from './watercolor-sim.js';
import { generateWatercolor, generateFromImage, disposeGenerator, MOTIFS } from './watercolor-generate.js';

const BRUSHES = [
  { id: 'round-s', de: 'Rund S', en: 'Round S', icon: '·', radius: 5, water: 0.45, load: 1, mode: 'wet' },
  { id: 'round-m', de: 'Rund M', en: 'Round M', icon: '●', radius: 12, water: 0.55, load: 1, mode: 'wet' },
  { id: 'round-l', de: 'Rund L', en: 'Round L', icon: '⬤', radius: 26, water: 0.65, load: 0.9, mode: 'wet' },
  { id: 'flat', de: 'Flach', en: 'Flat', icon: '▬', radius: 24, water: 0.5, load: 1, mode: 'wet', aspect: 0.3, follow: true },
  { id: 'mop', de: 'Mop', en: 'Mop', icon: '☁', radius: 48, water: 0.95, load: 0.5, mode: 'wet', soft: 0.85 },
  { id: 'water', de: 'Wasser', en: 'Water', icon: '💧', radius: 22, water: 1, load: 0, mode: 'wet', clean: true },
  { id: 'dry', de: 'Trocken', en: 'Dry brush', icon: '≋', radius: 14, water: 0.08, load: 1.2, mode: 'dry' },
  { id: 'lift', de: 'Auswaschen', en: 'Lift', icon: '◌', radius: 18, water: 0.4, load: 1, mode: 'lift' },
];

export async function mount(container, ctx, params = {}) {
  const T = (de, en, v) => tr({ de, en }, v);
  const sfx = (n) => { try { ctx.audio?.sfx?.(n); } catch { /* audio optional */ } };
  const toast = (m) => ctx.toast?.(m);

  // ---------------------------------------------------------------- state
  const st = {
    brush: BRUSHES[1], pigment: 5, radius: 12, water: 0.55, load: 1, paper: params.paper || 'cold', paperSeed: +(params.paperSeed || 7),
    painting: false, last: null, dirty: true, title: '', refMode: 'under', refOpacity: 0.35, refImg: null, custom: [],
    genBusy: false, genResult: null, genSeed: +(params.seed || 1) || 1, genMotif: 'random', genPhoto: null,
    usedGenerator: false,
    slot: Number.isFinite(+params.slot) ? +params.slot : null,   // the frame the player is standing in front of
  };
  const stepsPerFrame = +(params.steps || 3);
  const dryingSpeed = +(params.drying || 0.12);

  // ---------------------------------------------------------------- DOM
  const canvas = h('canvas.wc-canvas');
  const refSide = h('img.wc-ref-side', { hidden: true, alt: '' });
  const easel = h('div.wc-easel', h('div.wc-easel-top'), h('div.wc-easel-frame', h('div.wc-paper', canvas, refSide)), h('div.wc-easel-ledge'), h('div.wc-easel-legs'));
  const status = h('span.wc-status.small.muted');
  const titleInput = h('input.wc-title.hand', { placeholder: T('Ohne Titel', 'Untitled'), maxlength: 60, oninput: () => { st.title = titleInput.value; } });

  const btn = (label, fn, cls = '', title) => h('button.btn.small' + (cls ? '.' + cls.split(' ').join('.') : ''), { onclick: fn, title: title || label }, label);
  const undoBtn = btn('↶', () => doUndo(), '', T('Rückgängig (Strg+Z)', 'Undo (Ctrl+Z)'));
  const redoBtn = btn('↷', () => doRedo(), '', T('Wiederholen (Strg+Y)', 'Redo (Ctrl+Y)'));
  // setWet(flag) sets `paused = !flag`, so resuming means setWet(true) – i.e. setWet(sim.paused) toggles it.
  const pauseBtn = btn('⏸', () => { sim.setWet(sim.paused); syncPause(); markDirty(); sfx('click'); }, '', T('Trocknen anhalten / fortsetzen', 'Pause / resume drying'));
  const syncPause = () => { const p = sim?.paused; pauseBtn.textContent = p ? '▶' : '⏸'; pauseBtn.setAttribute('aria-pressed', p ? 'true' : 'false'); };
  const header = h('div.panel-header',
    h('span.wc-logo', '🎨'), h('span', T('Aquarell-Atelier', 'Watercolor Studio')), titleInput, status, h('span.spacer'),
    undoBtn, redoBtn, pauseBtn,
    btn(T('Trocknen', 'Dry'), () => { sim.dry(); markDirty(); sfx('click'); }, '', T('Sofort trocknen', 'Dry instantly')),
    btn(T('Neu', 'New'), () => confirmClear(), '', T('Neues Blatt', 'New sheet')),
    btn(T('Speichern', 'Save'), () => save(), 'primary'),
    btn(T('Aufhängen', 'Hang'), () => hang()),
    btn(T('Exportieren', 'Export'), () => exportImage()),
    btn('✕', () => ctx.close(), 'icon'),
  );

  // --- left tools
  const brushGrid = h('div.wc-brushes');
  for (const b of BRUSHES) brushGrid.appendChild(h('button.wc-brush', { dataset: { id: b.id }, title: tr(b), onclick: () => selectBrush(b) }, h('span.wc-brush-icon', b.icon), h('span.wc-brush-name', tr(b))));
  const sizeRange = h('input.range', { type: 'range', min: 1, max: 80, step: 1, value: st.radius, oninput: () => { st.radius = +sizeRange.value; sizeVal.textContent = st.radius * 2 + ' px'; } });
  const sizeVal = h('span.wc-val', st.radius * 2 + ' px');
  const waterRange = h('input.range', { type: 'range', min: 0, max: 100, value: Math.round(st.water * 100), oninput: () => { st.water = +waterRange.value / 100; waterVal.textContent = waterRange.value + ' %'; } });
  const waterVal = h('span.wc-val', Math.round(st.water * 100) + ' %');
  const loadRange = h('input.range', { type: 'range', min: 0, max: 200, value: Math.round(st.load * 100), oninput: () => { st.load = +loadRange.value / 100; loadVal.textContent = loadRange.value + ' %'; } });
  const loadVal = h('span.wc-val', Math.round(st.load * 100) + ' %');
  const palette = h('div.wc-palette');
  const pigInfo = h('div.wc-piginfo.small.muted');
  const colorInput = h('input.wc-color', { type: 'color', value: '#7a4b8c', title: T('Eigene Farbe (Pigment aus Farbe ableiten)', 'Custom colour (derive pigment from colour)'), oninput: () => addCustom(colorInput.value) });
  const paperSel = h('select.input.wc-paper-sel', { onchange: () => setPaper(paperSel.value) },
    h('option', { value: 'rough' }, T('Rau (Torchon)', 'Rough')), h('option', { value: 'cold' }, T('Satiniert (Cold-pressed)', 'Cold-pressed')), h('option', { value: 'hot' }, T('Glatt (Hot-pressed)', 'Hot-pressed')));
  paperSel.value = st.paper;
  const refModeSel = h('select.input', { onchange: () => { st.refMode = refModeSel.value; applyRef(); } }, h('option', { value: 'under' }, T('Unter dem Papier', 'Under the paper')), h('option', { value: 'side' }, T('Daneben', 'Side by side')));
  const refOpacity = h('input.range', { type: 'range', min: 0, max: 100, value: 35, oninput: () => { st.refOpacity = +refOpacity.value / 100; applyRef(); } });
  const refThumb = h('div.wc-ref-thumb');
  const tools = h('aside.wc-tools',
    h('h4', T('Pinsel', 'Brushes')), brushGrid,
    h('label.wc-row', h('span', T('Größe', 'Size')), sizeRange, sizeVal),
    h('label.wc-row', h('span', T('Wasser', 'Water')), waterRange, waterVal),
    h('label.wc-row', h('span', T('Farbmenge', 'Pigment')), loadRange, loadVal),
    h('h4', T('Palette', 'Palette')), palette, h('div.wc-row', colorInput, h('span.small.muted', T('Eigene Farbe', 'Custom colour'))), pigInfo,
    h('h4', T('Papier', 'Paper')), h('div.wc-row', paperSel, btn('🎲', () => setPaper(st.paper, Math.floor(Math.random() * 1000)), '', T('Neue Papierstruktur', 'New paper texture'))),
    h('h4', T('Referenzbild', 'Reference image')),
    h('div.wc-row', btn(T('Bild laden…', 'Load image…'), () => loadReference()), btn('✕', () => clearReference(), 'ghost', T('Entfernen', 'Remove'))),
    h('label.wc-row', h('span', T('Anzeige', 'Show')), refModeSel),
    h('label.wc-row', h('span', T('Deckkraft', 'Opacity')), refOpacity),
    refThumb,
    h('p.wc-hint.small.muted', T('Tipp: Nass-in-nass verlaufen die Farben; Wassertropfen in trocknende Flächen erzeugen Blüten. [ ] Pinselgröße, Strg+Z rückgängig.', 'Tip: wet-in-wet colours bleed; water drops into a drying wash make blooms. [ ] brush size, Ctrl+Z undo.')),
  );

  // --- right: generator
  const motifSel = h('select.input', { onchange: () => { st.genMotif = motifSel.value; } }, h('option', { value: 'random' }, T('Zufälliges Motiv', 'Random motif')), ...MOTIFS.map((m) => h('option', { value: m.id }, tr(m))));
  const seedInput = h('input.input.wc-seed', { type: 'number', value: st.genSeed, min: 1, max: 999999, oninput: () => { st.genSeed = +seedInput.value || 1; } });
  const genProgress = h('div.wc-progress', h('i'));
  const genLabel = h('div.wc-progress-label.small.muted');
  const genPreview = h('div.wc-preview', h('span.muted.small', T('Noch kein Bild', 'No picture yet')));
  const genRun = btn(T('Malen lassen', 'Paint for me'), () => runGenerator(), 'primary');
  const genPhoto = btn(T('Aus Foto…', 'From photo…'), () => runFromPhoto());
  const genUse = btn(T('Als Bild übernehmen', 'Use on easel'), () => useGenerated());
  const genSave = btn(T('Speichern', 'Save'), () => saveDataUrl(st.genResult, genTitle()));
  const genHang = btn(T('Aufhängen', 'Hang'), () => hangDataUrl(st.genResult, genTitle()));
  for (const b of [genUse, genSave, genHang]) b.disabled = true;
  const generator = h('aside.wc-generator',
    h('h4', T('Generator', 'Generator')),
    h('p.small.muted', T('Der Computer malt ein impressionistisches Aquarell, mit derselben Simulation wie beim eigenen Malen.', 'The computer paints an impressionist watercolor, with the same simulation as your own painting.')),
    h('label.wc-row', h('span', T('Motiv', 'Motif')), motifSel),
    h('label.wc-row', h('span', T('Zahl', 'Seed')), seedInput, btn('🎲', () => { st.genSeed = 1 + Math.floor(Math.random() * 99999); seedInput.value = st.genSeed; }, '', T('Zufallszahl', 'Random seed'))),
    h('div.wc-row', genRun, genPhoto),
    genProgress, genLabel, genPreview,
    h('div.wc-row', genUse, genSave, genHang),
  );

  const body = h('div.wc-body', tools, h('main.wc-center', easel), generator);
  const panel = h('div.panel.paper.wc-panel', header, body);
  container.appendChild(panel);

  // ---------------------------------------------------------------- simulation
  /** paper size that fits between the two tool columns of the current window */
  function fitSize() {
    const maxW = Math.max(400, Math.min(1100, Math.floor(window.innerWidth * 0.94 - 620)));
    const maxH = Math.max(300, Math.min(780, Math.floor(window.innerHeight * 0.94 - 180)));
    let w = maxW, ht = Math.round(maxW * 0.7);
    if (ht > maxH) { ht = maxH; w = Math.round(maxH / 0.7); }
    return { w, h: ht };
  }
  let { w: cw, h: chh } = fitSize();
  if (params.w) { cw = +params.w; chh = +params.h || Math.round(cw * 0.7); }
  const simScale = params.simScale ? +params.simScale : (cw * chh > 700000 ? 0.75 : 1);
  canvas.style.width = cw + 'px'; canvas.style.height = chh + 'px';
  let sim;
  try {
    sim = createWatercolorSim({ width: cw, height: chh, canvas, paperSeed: st.paperSeed, paper: st.paper, simScale, numPigmentTextures: 3, undoLevels: 10, forceByte: params.forceByte === '1' });
  } catch (e) {
    clear(easel); easel.appendChild(h('div.wc-nogl', T('WebGL2 ist nicht verfügbar. Das Atelier braucht eine Grafikkarte.', 'WebGL2 is not available. The studio needs a GPU.'), h('pre.small', String(e.message || e))));
    return { unmount() {}, onKey() { return false; } };
  }
  sim.setDryingSpeed(dryingSpeed);
  sim.params.stepsPerFrame = stepsPerFrame;
  syncPause();

  // The paper size was computed once at mount – follow the window so the easel never overflows its column.
  let resizeTm = 0;
  const onResize = () => {
    if (params.w) return;                       // fixed size for the screenshot harness
    clearTimeout(resizeTm);
    resizeTm = setTimeout(() => {
      const { w, h: ht } = fitSize();
      if (w === cw && ht === chh) return;
      cw = w; chh = ht;
      canvas.style.width = cw + 'px'; canvas.style.height = chh + 'px';
      try { sim.resize(cw, chh); } catch (e) { console.warn('[watercolor] resize', e); }
      markDirty();
    }, 180);
  };
  window.addEventListener('resize', onResize);
  if (!isElectron) { window.__wcSim = sim; window.__wcPanel = { st, selectBrush, selectPigment, addCustom, applyRef, runGenerator, runFromPhoto, useGenerated, BRUSHES }; }

  // render loop
  let raf = 0, alive = true;
  function loop() {
    if (!alive) return;
    if (sim.isActive() && !document.hidden && !st.genOnEasel) { sim.step(sim.params.stepsPerFrame); st.dirty = true; }
    if (st.dirty) { sim.render(); st.dirty = false; }
    updateStatus();
    raf = requestAnimationFrame(loop);
  }
  function markDirty() { st.dirty = true; undoBtn.disabled = !sim.canUndo; redoBtn.disabled = !sim.canRedo; }
  let lastStatus = '';
  function updateStatus() {
    const s = sim.isActive() ? (sim.paused ? T('pausiert', 'paused') : T('trocknet …', 'drying …')) : T('trocken', 'dry');
    if (s !== lastStatus) { lastStatus = s; status.textContent = s; }
  }

  // ---------------------------------------------------------------- brushes / palette
  function selectBrush(b) {
    st.brush = b; st.radius = b.radius; st.water = b.water; st.load = b.load;
    sizeRange.value = b.radius; sizeVal.textContent = b.radius * 2 + ' px';
    waterRange.value = Math.round(b.water * 100); waterVal.textContent = waterRange.value + ' %';
    loadRange.value = Math.round(b.load * 100); loadVal.textContent = loadRange.value + ' %';
    for (const el of brushGrid.children) el.classList.toggle('active', el.dataset.id === b.id);
    canvas.dataset.brush = b.id;
  }
  function swatchColor(p) { return rgbToHex(p.rw.map((c, i) => c * 0.85 + p.rb[i] * 0.15)); }
  function renderPalette() {
    clear(palette);
    sim.pigments.forEach((p, i) => {
      const el = h('button.wc-swatch', { style: { background: `linear-gradient(135deg, ${rgbToHex(p.rw)} 0 55%, ${swatchColor(p)} 100%)` }, title: tr(p), dataset: { idx: i }, onclick: () => selectPigment(i) });
      if (p.custom) el.classList.add('custom');
      el.classList.toggle('active', i === st.pigment);
      palette.appendChild(el);
    });
    const p = sim.pigments[st.pigment];
    if (p) {
      const tags = [];
      if (p.omega >= 0.6) tags.push(T('granulierend', 'granulating')); else if (p.omega <= 0.2) tags.push(T('gleichmäßig', 'smooth'));
      if (p.sigma >= 2.8) tags.push(T('lasierend/färbend', 'staining')); else if (p.sigma <= 1.3) tags.push(T('deckend, auswaschbar', 'opaque, liftable'));
      pigInfo.textContent = tags.length ? `${tr(p)} · ${tags.join(', ')}` : tr(p);
    }
  }
  function selectPigment(i) { st.pigment = i; if (st.brush.clean || st.brush.mode === 'lift') selectBrush(BRUSHES[1]); renderPalette(); }
  function addCustom(hex) {
    const def = pigmentFromColor(hexToRgb(hex), { id: 'custom-' + Date.now(), de: 'Eigene Farbe ' + hex, en: 'Custom ' + hex });
    const existing = sim.pigments.findIndex((p) => p.custom && rgbToHex(p.rw) === rgbToHex(def.rw));
    if (existing >= 0) { selectPigment(existing); return; }
    // keep at most 4 custom pigments
    const customs = sim.pigments.map((p, i) => (p.custom ? i : -1)).filter((i) => i >= 0);
    if (customs.length >= 4) { sim.updatePigment(customs[0], def); selectPigment(customs[0]); return; }
    selectPigment(sim.addPigment(def));
  }
  function setPaper(type, seed) { st.paper = type; if (seed != null) st.paperSeed = seed; sim.setPaper(type, seed); markDirty(); }

  // ---------------------------------------------------------------- painting (pointer events)
  function canvasPoint(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cw / r.width), y: (e.clientY - r.top) * (chh / r.height), p: e.pointerType === 'mouse' ? 0.6 : (e.pressure || 0.5) }; }
  function dabOpts(p, angle) {
    const b = st.brush;
    return { radius: st.radius, pigment: b.clean ? null : st.pigment, water: st.water, pressure: p, load: st.load, mode: b.mode, aspect: b.aspect, angle: b.follow ? angle : undefined, soft: b.soft };
  }
  function onDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault(); canvas.setPointerCapture(e.pointerId);
    sim.snapshot();
    const pt = canvasPoint(e); st.painting = true; st.last = pt;
    sim.stroke({ x: pt.x, y: pt.y, ...dabOpts(pt.p, 0) });
    markDirty();
  }
  function onMove(e) {
    if (!st.painting) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const pt = canvasPoint(ev);
      const d = Math.hypot(pt.x - st.last.x, pt.y - st.last.y);
      if (d < 0.5) continue;
      const ang = Math.atan2(pt.y - st.last.y, pt.x - st.last.x);
      sim.strokeLine(st.last.x, st.last.y, pt.x, pt.y, dabOpts(pt.p, ang), 0.22);
      st.last = pt;
    }
    markDirty();
  }
  function onUp(e) { if (!st.painting) return; st.painting = false; st.last = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ } markDirty(); }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function doUndo() { if (sim.undo()) { markDirty(); sfx('click'); } }
  function doRedo() { if (sim.redo()) { markDirty(); sfx('click'); } }
  function confirmClear() {
    const dlg = h('div.wc-confirm', h('p', T('Neues Blatt? Das aktuelle Bild wird verworfen.', 'New sheet? The current painting will be discarded.')),
      h('div.row', btn(T('Verwerfen', 'Discard'), () => { sim.snapshot(); sim.clear(); markDirty(); dlg.remove(); sfx('page'); }, 'primary'), btn(T('Abbrechen', 'Cancel'), () => dlg.remove())));
    panel.appendChild(dlg);
  }

  // ---------------------------------------------------------------- reference image
  async function loadImageFromPath(path) {
    if (!path) return null;
    const url = await ctx.api.files.url(path);
    return loadImage(url);
  }
  // the blob URLs of the reference pictures: a picture that was replaced, cleared or left with the panel is let go,
  // else its bytes stayed in memory for the rest of the session
  const blobUrls = [];
  const dropBlobUrls = () => { for (const u of blobUrls.splice(0)) { try { URL.revokeObjectURL(u); } catch { /* ignore */ } } };
  /** loads an image so that it can be used in WebGL / canvas without taint (fetch -> blob URL, plain <img> as fallback) */
  async function loadImage(url) {
    const viaImg = (src) => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('image load failed')); img.src = src; });
    if (url.startsWith('data:') || url.startsWith('blob:')) return viaImg(url);
    try { const r = await fetch(url); if (!r.ok) throw new Error('fetch ' + r.status); const blob = await r.blob(); const u = URL.createObjectURL(blob); blobUrls.push(u); return await viaImg(u); }
    catch { return viaImg(url); }
  }
  async function loadReference() {
    try {
      const path = await ctx.api.files.pickFile(T('Referenzbild wählen', 'Choose reference image'), [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]);
      if (!path) return;
      const img = await loadImageFromPath(path);
      // the previous picture's blob URL goes before the new one takes its place (it is the last one in the list)
      const keep = blobUrls.length && img.src === blobUrls[blobUrls.length - 1] ? blobUrls.pop() : null;
      dropBlobUrls(); if (keep) blobUrls.push(keep);
      st.refImg = img;
      clear(refThumb); refThumb.appendChild(h('img', { src: st.refImg.src, alt: '' }));
      applyRef();
    } catch (e) { toast(T('Bild konnte nicht geladen werden', 'Could not load image')); }
  }
  function clearReference() { st.refImg = null; clear(refThumb); applyRef(); dropBlobUrls(); }
  function applyRef() {
    if (st.refMode === 'under' && st.refImg) { sim.loadImageAsUnderdrawing(st.refImg, st.refOpacity); refSide.hidden = true; }
    else { sim.loadImageAsUnderdrawing(null, 0); if (st.refImg) { refSide.src = st.refImg.src; refSide.hidden = false; refSide.style.opacity = String(0.4 + 0.6 * st.refOpacity); } else refSide.hidden = true; }
    markDirty();
  }

  // ---------------------------------------------------------------- save / hang / export
  // letters of every script stay (\w would turn „Blühende Wiese“ into „Bl_hende_Wiese“, the gallery shows the name)
  const fileName = (t) => (t || T('aquarell', 'watercolor')).trim().replace(/[^\p{L}\p{N}.-]+/gu, '_').slice(0, 40) + '-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  async function saveDataUrl(dataUrl, title) {
    if (!dataUrl) return null;
    try {
      const r = await ctx.api.files.savePainting(dataUrl, fileName(title));
      if (r?.path) { ctx.bus.emit('painting:saved', { path: r.path, url: r.url, title }); toast(T('Bild gespeichert', 'Painting saved')); sfx('page'); }
      return r;
    } catch (e) { toast(T('Speichern fehlgeschlagen', 'Saving failed')); return null; }
  }
  async function hangDataUrl(dataUrl, title) {
    if (!dataUrl) return;
    const r = await saveDataUrl(dataUrl, title);
    // the world confirms with its own message ("Das Bild hängt jetzt an der Wand.")
    ctx.bus.emit('gallery:hang', { url: r?.url || dataUrl, title: title || T('Ohne Titel', 'Untitled'), path: r?.path, slot: st.slot });
    sfx('book-place');
  }
  const save = () => saveDataUrl(sim.toDataURL(), st.title);
  const hang = () => hangDataUrl(sim.toDataURL(), st.title);
  async function exportImage() {
    try { const p = await ctx.api.files.exportImage(sim.toDataURL(), fileName(st.title) + '.png'); if (p) toast(T('Exportiert', 'Exported')); }
    catch (e) { toast(T('Export fehlgeschlagen', 'Export failed')); }
  }

  // ---------------------------------------------------------------- generator
  const genTitle = () => st.genPhoto ? T('Aus Foto', 'From photo') : tr(MOTIFS.find((m) => m.id === st.genMotifUsed) || { de: 'Aquarell', en: 'Watercolor' });
  function setProgress(v, label) { genProgress.firstChild.style.width = Math.round(v * 100) + '%'; genLabel.textContent = label ? `${Math.round(v * 100)} % · ${label}` : ''; }
  function genBusy(b) { st.genBusy = b; if (b) st.usedGenerator = true; genRun.disabled = b; genPhoto.disabled = b; panel.classList.toggle('busy', b); }
  function showResult(dataUrl) {
    st.genResult = dataUrl; clear(genPreview); genPreview.appendChild(h('img', { src: dataUrl, alt: '' }));
    for (const x of [genUse, genSave, genHang]) x.disabled = !dataUrl;
  }
  const genOpts = () => ({ width: +(params.genW || 640), height: +(params.genH || 448), quality: +(params.genQ || 0.6), simScale: +(params.genScale || 0.5) });
  async function runGenerator() {
    if (st.genBusy) return;
    genBusy(true); st.genPhoto = null; setProgress(0, T('Skizziere …', 'Sketching …'));
    try {
      const motif = st.genMotif === 'random' ? MOTIFS[st.genSeed % MOTIFS.length].id : st.genMotif;
      st.genMotifUsed = motif;
      const url = await generateWatercolor({ seed: st.genSeed, motif, ...genOpts(), onProgress: (v, label) => setProgress(v, label) });
      showResult(url); setProgress(1, T('Fertig', 'Done'));
    } catch (e) { console.error('[watercolor] generator', e); toast(T('Generator-Fehler', 'Generator error')); setProgress(0, ''); }
    genBusy(false);
  }
  async function runFromPhoto(imgOverride) {
    if (st.genBusy) return;
    let img = imgOverride;
    if (!img) {
      const path = await ctx.api.files.pickFile(T('Foto wählen', 'Choose photo'), [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]);
      if (!path) return;
      try { img = await loadImageFromPath(path); } catch { toast(T('Bild konnte nicht geladen werden', 'Could not load image')); return; }
    }
    genBusy(true); st.genPhoto = img; setProgress(0, T('Analysiere …', 'Analysing …'));
    try {
      const url = await generateFromImage(img, { seed: st.genSeed, strokes: 1, ...genOpts(), onProgress: (v, label) => setProgress(v, label) });
      showResult(url); setProgress(1, T('Fertig', 'Done'));
    } catch (e) { console.error('[watercolor] from image', e); toast(T('Generator-Fehler', 'Generator error')); setProgress(0, ''); }
    genBusy(false);
  }
  /** Re-runs the generator directly on the easel simulation (same seed -> same picture, but real, editable pigment). */
  async function useGenerated() {
    if (st.genBusy || !st.genResult) return;
    genBusy(true); sim.snapshot(); st.genOnEasel = true;
    try {
      setProgress(0, T('Male auf die Staffelei …', 'Painting onto the easel …'));
      const prog = (v, label) => { setProgress(v, label); st.dirty = true; };
      if (st.genPhoto) await generateFromImage(st.genPhoto, { seed: st.genSeed, strokes: 1, sim, quality: +(params.genQ || 1), onProgress: prog });
      else await generateWatercolor({ seed: st.genSeed, motif: st.genMotifUsed, sim, quality: +(params.genQ || 1), onProgress: prog });
      setProgress(1, T('Fertig', 'Done')); toast(T('Bild auf der Staffelei', 'Picture is on the easel')); sfx('page');
    } catch (e) { console.error('[watercolor] use generated', e); toast(T('Generator-Fehler', 'Generator error')); }
    st.genOnEasel = false; sim.setWet(true); sim.setDryingSpeed(dryingSpeed); syncPause(); markDirty(); genBusy(false);
  }

  // ---------------------------------------------------------------- init
  selectBrush(BRUSHES[1]); renderPalette(); markDirty();
  const offLang = ctx.bus.on('i18n:change', () => renderPalette());
  loop();

  return {
    unmount() {
      alive = false; cancelAnimationFrame(raf); offLang();
      window.removeEventListener('resize', onResize); clearTimeout(resizeTm);
      try { sim.destroy(); } catch (e) { console.warn('[watercolor] destroy', e); }
      dropBlobUrls();
      // the generator keeps its own offscreen WebGL2 context alive – give it back (it defers while busy)
      if (st.usedGenerator) { try { disposeGenerator(); } catch (e) { console.warn('[watercolor] disposeGenerator', e); } }
      if (!isElectron) { delete window.__wcSim; delete window.__wcPanel; }
    },
    onKey(e) {
      if (e.target === titleInput || e.target === seedInput) return false;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { doUndo(); return true; }
      if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { doRedo(); return true; }
      if (e.key === '[') { st.radius = Math.max(1, Math.round(st.radius * 0.85)); sizeRange.value = st.radius; sizeVal.textContent = st.radius * 2 + ' px'; return true; }
      if (e.key === ']') { st.radius = Math.min(80, Math.round(st.radius * 1.18 + 1)); sizeRange.value = st.radius; sizeVal.textContent = st.radius * 2 + ' px'; return true; }
      if (k === 'b') { selectBrush(BRUSHES[1]); return true; }
      if (k === 'w') { selectBrush(BRUSHES[5]); return true; }
      if (k === 'e') { selectBrush(BRUSHES[7]); return true; }
      return false;
    },
  };
}
