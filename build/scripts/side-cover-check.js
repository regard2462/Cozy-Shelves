// The covers on the sides of the books (app/src/world/side-covers.js). Every face of a book's cover that a visitor can
// see shows its cover picture: at the two ends of every row (next to the bookend, a plant or the side of the case) and
// next to a gap (a book in the basket, one pulled out), the front right of the spine, the back left of it with the
// front's picture; a book without a cover image shows its title card.
// Checks: which faces are open (row ends, gaps, pulled-out books); every open face gets its picture (cover or title
// card); the cells of the atlas hold the right pictures (read back from the graphics card and compared with the cover
// decoded here, the right way up); a cover chosen for a book (four coloured quarters) reaches its faces without a
// rebuild, upright and unmirrored on the front and on the back (rendered and sampled); the faces change from the
// binding colour to the picture, the spines do not change; the pulled-out book shows the whole picture (0.7.2); no shader
// program is compiled while the pictures arrive or the shelves are rebuilt; the costs (uploads, the frames while all
// pictures load anew, frame time in front of the shelves with the pictures on and off, a shelf rebuild); pictures from a
// visitor's places along the shelves.
//   COZYSHELVES_BOOKS="<library with covers, e.g. testbooks4 or books3\lib-generic>|structured" COZYSHELVES_USERDATA=<fresh dir>
//   SHOT_DIR=<dir> node build/screenshot.js side-cover-check
//   SC_PARTS=faces,atlas,render,newcover,gap,hover,spines,load,perf,rebuild,shots (default: all); SC_SHOTS=0 no pictures;
//   SC_SIZE=1600x900 (window); SC_PERF_SECONDS=2 (each of the six perf windows)
const fs = require('fs');
const path = require('path');
const { encode } = require('./png-lite.js');

module.exports = async ({ app, page, shot, sleep }) => {
  const parts = (process.env.SC_PARTS || 'faces,atlas,render,newcover,gap,hover,spines,load,perf,rebuild,shots').split(',');
  const has = (p) => parts.includes(p);
  const [SW, SH] = (process.env.SC_SIZE || '1600x900').split('x').map(Number);
  const log = (k, v) => console.log(k + ' ' + JSON.stringify(v));
  let passed = 0, failed = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (ok) passed++; else failed++; };
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [SW, SH]);

  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  // indexing finished and the rebuild after the last library update has run (the cases stand still)
  let last = '', quiet = 0;
  for (let i = 0; i < 600; i++) {
    const st = await page.evaluate(() => { const A = window.__app, b = A.state.library.books; return { n: b.length, idx: b.filter((x) => x.indexed).length, active: !!A.state.library.scan?.active, key: A.world.layout?.bookcases.map((c) => c.id + ':' + c.rows.map((r) => r.items.length).join('.')).join('|') + '#' + A.world.books.entries.size }; });
    const done = st.n > 0 && st.idx === st.n && !st.active;
    quiet = done && st.key === last ? quiet + 1 : 0; last = st.key;
    if (quiet >= 3) break;
    await sleep(1500);
  }
  await sleep(10500);   // the delayed rebuild of the shelves after the last library update (main.js)
  // the pictures of the open faces are there: every open face (as many as the atlas holds) has a ready cell
  const settle = async (timeout = 90000) => {
    const t0 = Date.now();
    let s = null;
    while (Date.now() - t0 < timeout) {
      s = await page.evaluate(() => window.__app.world.books.sideCovers.info());
      if (s.openReady >= Math.min(s.open, s.capacity) && !s.loading && !s.done && !s.queued) return { ...s, waited: Date.now() - t0 };
      await sleep(250);
    }
    return { ...s, waited: Date.now() - t0, timeout: true };
  };
  const ready0 = await settle();
  log('SIDE', ready0);

  // helpers in the page: poses, face points, the atlas read back, the rendered picture sampled
  await page.evaluate(() => {
    const w = window.__app.world, V = w.camera.position.constructor;
    const S = window.__sc = {};
    S.sides = () => w.books.sideCovers;
    /** A point on a book's cover face as a visitor sees it from outside: u from left to right, v from the foot up. */
    S.facePoint = (e, face, u, v) => new V(face === 'front' ? 0.5005 : -0.5005, v - 0.5, face === 'front' ? 0.5 - u : u - 0.5).applyMatrix4(e.matrix);
    /** Stand at (x, z) and look at `target`. */
    S.look = (x, z, target) => {
      if (w.actions.seatedId) w.actions.leaveSeat();
      w.player.transition = null; w.player.setPose(x, z, 0, 0); w.player.update(0.016); w.camera.updateMatrixWorld();
      const d = target.clone().sub(w.camera.position).normalize();
      w.player.yaw = Math.atan2(-d.x, -d.z); w.player.pitch = Math.asin(d.y);
    };
    /** The crosshair on the middle of a book's spine, from `dist` metres in front (the world's own look ray takes it). */
    S.aimAt = (e, dist = 0.9) => {
      const c = e.pos.clone().addScaledVector(e.forward, e.d / 2), p = c.clone().addScaledVector(e.forward, dist);
      S.look(p.x, p.z, c);
    };
    /** In front of a book's face, a little to its side: `side` metres out along the face's normal, `front` metres into the room. */
    S.lookAtFace = (e, face, side = 0.38, front = 0.62) => {
      const right = new V(1, 0, 0).applyQuaternion(e.quat).setY(0).normalize(), fwd = e.forward.clone().setY(0).normalize();
      const c = S.facePoint(e, face, 0.5, 0.62);
      const p = c.clone().addScaledVector(right, face === 'front' ? side : -side).addScaledVector(fwd, front);
      S.look(p.x, p.z, c);
    };
    /** Render one frame and sample the picture at points given in the world (rgb per point, null off screen). */
    S.sample = (points) => {
      w.frame();
      const gl = w.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(4), v = new V();
      return points.map((p) => {
        v.copy(p).project(w.camera);
        if (v.z > 1 || Math.abs(v.x) > 0.98 || Math.abs(v.y) > 0.98) return null;
        const x = Math.round((v.x + 1) / 2 * (W - 1)), y = Math.round((v.y + 1) / 2 * (H - 1));
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [px[0], px[1], px[2]];
      });
    };
    /** A book's cell read back from the atlas on the graphics card: RGBA rows from the foot of the cell up. */
    S.readCell = (id) => {
      const s = S.sides(), rc = s.cellRect(id); if (!rc || !s.atlas) return null;
      const r = w.renderer, gl = r.getContext(), tex = r.properties.get(s.atlas).__webglTexture;
      if (!tex) return null;
      const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING), fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const px = new Uint8Array(rc.w * rc.h * 4);
      gl.readPixels(rc.x, rc.y, rc.w, rc.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, prev); gl.deleteFramebuffer(fb);
      return { px, ...rc };
    };
    /** Mean colour of the picture in a cell (rows from the foot: `from`, `to` as shares of the height). */
    S.cellMean = (c, from = 0, to = 1) => {
      const P = c.pad, CW = c.w - 2 * P, CH = c.h - 2 * P, m = [0, 0, 0];
      let n = 0;
      for (let y = P + Math.floor(from * CH); y < P + Math.floor(to * CH); y++) for (let x = P; x < P + CW; x++) { const i = (y * c.w + x) * 4; m[0] += c.px[i]; m[1] += c.px[i + 1]; m[2] += c.px[i + 2]; n++; }
      return m.map((v) => Math.round(v / Math.max(1, n)));
    };
    /** The cover of a book decoded here and trimmed like a print to its face (side-cell.js cropOf, CROP_TOP 0.4). */
    S.reference = async (id) => {
      const e = w.books.entry(id), url = w.opts.coverUrl(id);
      const bmp = await createImageBitmap(await (await fetch(url)).blob(), { resizeHeight: 256, resizeQuality: 'high' });
      const a = e.d / e.h, iw = bmp.width, ih = bmp.height;
      let sx = 0, sy = 0, sw = iw, sh = ih;
      if (iw / ih > a) { sw = ih * a; sx = (iw - sw) / 2; } else { sh = iw / a; sy = (ih - sh) * 0.4; }
      const c = document.createElement('canvas'); c.width = 120; c.height = 184;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingQuality = 'medium'; g.drawImage(bmp, sx, sy, sw, sh, 0, 0, 120, 184); bmp.close();
      const d = g.getImageData(0, 0, 120, 184).data;
      const mean = (y0, y1) => { const m = [0, 0, 0]; let n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < 120; x++) { const i = (y * 120 + x) * 4; m[0] += d[i]; m[1] += d[i + 1]; m[2] += d[i + 2]; n++; } return m.map((v) => Math.round(v / n)); };
      // (canvas rows from the head down: the upper half is rows 0 … 91)
      return { all: mean(0, 184), top: mean(0, 92), foot: mean(92, 184) };
    };
    S.sideOf = (e) => { const a = e.mesh.geometry.attributes.aSide; return [a.getX(e.index), a.getY(e.index), a.getZ(e.index)]; };
    /** The look ray rests (true) or looks again (false); resting, no book comes out and a book that is out goes back. */
    S.rest = (on = true) => { w.actions.rayTimer = on ? 1e9 : 0; if (on) w.books.setHover(null); };
    S.allIn = () => !w.books.slots.some((x) => x.entry);
    /** The rows of the shelves: book ids along each row, with the case. */
    S.rows = () => {
      const out = [];
      for (const bc of w.layout.bookcases) for (const r of bc.rows) { const ids = r.items.map((it) => it.id).filter((id) => w.books.entry(id)); if (ids.length) out.push({ bc: bc.id, level: r.level, ids }); }
      return out;
    };
  });
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const programs = () => page.evaluate(() => window.__app.world.renderer.info.programs.length);
  const programs0 = await programs();
  const rebuilds = await page.evaluate(() => {
    const w = window.__app.world; window.__scBuilds = { build: 0, refresh: 0 };
    const b = w.build.bind(w), r = w.refreshShelves.bind(w);
    w.build = (...a) => { window.__scBuilds.build++; return b(...a); };
    w.refreshShelves = (...a) => { window.__scBuilds.refresh++; return r(...a); };
    return window.__scBuilds;
  });

  // ------------------------------------------------------------------ which faces are open ----
  if (has('faces')) {
    await page.evaluate(() => window.__sc.rest(true));
    for (let i = 0; i < 100 && !(await page.evaluate(() => window.__sc.allIn())); i++) await sleep(50);
    const f = await page.evaluate(() => {
      const w = window.__app.world, S = window.__sc, s = S.sides();
      const faces = new Map(s.faces().map((x) => [x.id, x]));
      const rows = S.rows(), bad = [];
      let ends = 0, inner = 0, innerOpen = 0, shown = 0, cover = 0, typo = 0, wrongKind = [];
      // (book-art.js hasCoverImage)
      const real = (b) => !!b && b.hasCover !== false && (b.coverSource === 'web' || (b.coverChoice !== 'card' && !(b.coverWeak && b.coverChoice !== 'book') && b.coverGenerated !== true));
      for (const r of rows) {
        const first = r.ids[0], lastId = r.ids[r.ids.length - 1];
        const a = faces.get(first), b = faces.get(lastId);
        ends += r.ids.length > 1 ? 2 : 1;
        if (!a?.back) bad.push(['back', first]);
        if (!b?.front) bad.push(['front', lastId]);
        for (const id of r.ids.slice(1, -1)) { inner++; if (faces.has(id) && !w.books.entry(id).hidden) innerOpen++; }
      }
      for (const [id, x] of faces) {
        const e = w.books.entry(id), side = S.sideOf(e);
        if (x.state === 'ready' && side[2] === 1) shown++;
        if (x.kind === 'cover') cover++; else if (x.kind === 'typo') typo++;
        const want = real(e.book) ? 'cover' : 'typo';
        if (x.kind && x.kind !== want && !(want === 'cover' && x.kind === 'typo')) wrongKind.push([id, x.kind, want]);
      }
      return { rows: rows.length, ends, open: faces.size, bad: bad.slice(0, 6), badN: bad.length, inner, innerOpen, shown, cover, typo, wrongKind: wrongKind.slice(0, 5), info: s.info() };
    });
    log('FACES', f);
    check('the faces at both ends of every row are open to view (first book: its back, last book: its front)', f.rows > 0 && f.badN === 0, { rows: f.rows, ends: f.ends, bad: f.bad });
    check('books inside a row (no gap beside them) keep their faces closed', f.innerOpen === 0, { inner: f.inner, innerOpen: f.innerOpen });
    check('every open face shows its picture once loaded (attribute on, cell ready)', f.shown === f.open && !ready0.timeout, { open: f.open, shown: f.shown, waited: ready0.waited });
    check('books with a cover image show it, books without one their title card', f.cover > 0 && f.wrongKind.length === 0, { cover: f.cover, typo: f.typo, wrong: f.wrongKind });
    check('no shader program was compiled for the pictures', (await programs()) === programs0, { before: programs0, after: await programs() });
  }

  // ------------------------------------------------------------------ the atlas holds the right pictures ----
  if (has('atlas')) {
    const r = await page.evaluate(async () => {
      const S = window.__sc, s = S.sides(), out = [];
      const list = s.faces().filter((x) => x.state === 'ready').slice(0, 40);
      for (const x of list) {
        const cell = S.readCell(x.id); if (!cell) { out.push({ id: x.id, kind: x.kind, cell: false }); continue; }
        const mean = S.cellMean(cell), top = S.cellMean(cell, 0.5, 1), foot = S.cellMean(cell, 0, 0.5);
        // the spread of the luminance: a title card or a cover has lettering and shapes, not one flat colour
        let sl = 0, sl2 = 0, n = 0;
        for (let i = 0; i < cell.px.length; i += 16) { const l = 0.2126 * cell.px[i] + 0.7152 * cell.px[i + 1] + 0.0722 * cell.px[i + 2]; sl += l; sl2 += l * l; n++; }
        const sd = Math.sqrt(Math.max(0, sl2 / n - (sl / n) ** 2));
        const row = { id: x.id, kind: x.kind, mean, top, foot, worker: x.mean, sd: Math.round(sd) };
        if (x.kind === 'cover' && out.filter((o) => o.ref).length < 12) row.ref = await S.reference(x.id);
        out.push(row);
      }
      return out;
    });
    const covers = r.filter((x) => x.ref), cards = r.filter((x) => x.kind === 'typo');
    const near = covers.map((x) => ({ id: x.id, d: dist(x.mean, x.ref.all), up: Math.sign(lum(x.top) - lum(x.foot)) === Math.sign(lum(x.ref.top) - lum(x.ref.foot)) || Math.abs(lum(x.ref.top) - lum(x.ref.foot)) < 12, dTop: dist(x.top, x.ref.top), dFoot: dist(x.foot, x.ref.foot) }));
    log('ATLAS', { covers: near, cards: cards.slice(0, 6).map((x) => ({ id: x.id, mean: x.mean, sd: x.sd })) });
    check('the cells hold the covers: the mean colour as decoded here (within 12 of 255)', covers.length > 0 && near.every((x) => x.d <= 12), near.filter((x) => x.d > 12).slice(0, 4));
    check('… the right way up: the upper and the lower half of each cell match the cover\'s (within 18)', covers.length > 0 && near.every((x) => x.up && x.dTop <= 18 && x.dFoot <= 18), near.filter((x) => !x.up || x.dTop > 18 || x.dFoot > 18).slice(0, 4));
    check('the cell read back from the graphics card matches the one the worker made', r.filter((x) => x.worker).every((x) => dist(x.mean, x.worker) <= 6), r.filter((x) => x.worker && dist(x.mean, x.worker) > 6).slice(0, 3));
    check('the title cards carry lettering (not one flat colour)', !cards.length || cards.every((x) => x.sd >= 6), cards.filter((x) => x.sd < 6).slice(0, 3));
    // a few cells as pictures (as read back from the graphics card, the right way up) to look at
    if (has('shots') && process.env.SC_SHOTS !== '0') {
      const ids = [...covers.slice(0, 3), ...cards.slice(0, 3)].map((x) => [x.id, x.kind]);
      for (const [id, kind] of ids) {
        const c = await page.evaluate((id) => { const c = window.__sc.readCell(id); return c && { w: c.w, h: c.h, px: Array.from(c.px) }; }, id);
        if (!c) continue;
        const data = Buffer.alloc(c.w * c.h * 4);
        for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w * 4; x++) data[(c.h - 1 - y) * c.w * 4 + x] = c.px[y * c.w * 4 + x];
        fs.writeFileSync(path.join(process.env.SHOT_DIR || '.', `sc-cell-${kind}-${id}.png`), encode({ width: c.w, height: c.h, data }));
      }
    }
  }

  // ------------------------------------------------------------------ the faces show the pictures ----
  if (has('render')) {
    const r = await page.evaluate(() => {
      const w = window.__app.world, S = window.__sc, s = S.sides(), out = [];
      // the last books of rows on the middle and the top shelf (the eye looks at them almost level)
      const picks = S.rows().filter((r) => r.level >= 1 && r.ids.length >= 3).map((r) => r.ids[r.ids.length - 1]).slice(0, 8);
      const grid = []; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) grid.push([0.12 + i * 0.25, 0.7 + j * 0.09]);   // above the bookend (13 cm)
      w.actions.rayTimer = 1e9; w.books.setHover(null);   // (no book comes out in front of the faces)
      for (const id of picks) {
        const e = w.books.entry(id), pts = grid.map(([u, v]) => S.facePoint(e, 'front', u, v));
        S.lookAtFace(e, 'front');
        const on = S.sample(pts);
        s.setEnabled(false); const off = S.sample(pts); s.setEnabled(true);
        const cell = S.readCell(id);
        // the cell at the same places (bilinear is not needed for a comparison of the pattern)
        const ref = cell ? grid.map(([u, v]) => { const x = cell.pad + Math.round(u * (cell.w - 2 * cell.pad - 1)), y = cell.pad + Math.round(v * (cell.h - 2 * cell.pad - 1)), i = (y * cell.w + x) * 4; return [cell.px[i], cell.px[i + 1], cell.px[i + 2]]; }) : null;
        // the binding colour the face shows without its picture (the instance colour is 0.92 of it, sRGB)
        const hex = e.color.getHex(), binding = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => Math.min(255, Math.round(v / 0.92)));
        out.push({ id, kind: s.faces().find((x) => x.id === id)?.kind, on, off, ref, binding });
      }
      w.actions.rayTimer = 0;
      w.frame();
      return out;
    });
    const res = r.map((x) => {
      const ok = x.on.map((c, i) => c && x.off[i] && x.ref ? i : -1).filter((i) => i >= 0);
      const diff = ok.reduce((a, i) => a + dist(x.on[i], x.off[i]), 0) / Math.max(1, ok.length);
      // how far the picture there is from the binding colour (a cover in the colour of its binding changes little)
      const expect = ok.reduce((a, i) => a + dist(x.ref[i], x.binding), 0) / Math.max(1, ok.length);
      // the pattern of light and dark of the face follows the picture (Pearson over the sample points)
      let corr = null;
      if (x.ref && ok.length >= 8) {
        const a = ok.map((i) => lum(x.on[i])), b = ok.map((i) => lum(x.ref[i]));
        const ma = a.reduce((p, q) => p + q) / a.length, mb = b.reduce((p, q) => p + q) / b.length;
        let sab = 0, saa = 0, sbb = 0; for (let k = 0; k < a.length; k++) { sab += (a[k] - ma) * (b[k] - mb); saa += (a[k] - ma) ** 2; sbb += (b[k] - mb) ** 2; }
        corr = saa > 1 && sbb > 200 ? +(sab / Math.sqrt(saa * sbb)).toFixed(2) : null;   // (a picture without contrast there: no verdict)
      }
      return { id: x.id, kind: x.kind, seen: ok.length, diff: Math.round(diff), expect: Math.round(expect), corr };
    });
    log('RENDER', res);
    // judged where the picture differs clearly from the binding colour; the face in the shade of its compartment shows
    // a fraction of the difference (lit and tone-mapped), never nothing
    const judged = res.filter((x) => x.seen >= 8 && x.expect >= 40);
    check('the open faces change from the binding colour to the picture (rendered, picture on and off)', judged.length >= 1 && judged.every((x) => x.diff >= 0.2 * x.expect), res);
    const corrs = judged.filter((x) => x.corr != null);
    check('the light and dark of a rendered face follow its picture', !corrs.length || corrs.filter((x) => x.corr >= 0.5).length >= Math.ceil(corrs.length * 0.75), corrs);
  }

  // ------------------------------------------------------------------ a new cover, upright and unmirrored ----
  if (has('newcover')) {
    // four coloured quarters: red top left, green top right, blue bottom left, yellow bottom right (with a little noise:
    // a picture, not a flat card)
    const W = 600, H = 900, data = new Uint8Array(W * H * 4);
    const Q = { tl: [225, 40, 40], tr: [40, 190, 60], bl: [45, 70, 230], br: [240, 210, 40] };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const q = y < H / 2 ? (x < W / 2 ? Q.tl : Q.tr) : (x < W / 2 ? Q.bl : Q.br), i = (y * W + x) * 4, n = ((x * 7 + y * 13) % 17) - 8;
      data[i] = Math.max(0, Math.min(255, q[0] + n)); data[i + 1] = Math.max(0, Math.min(255, q[1] + n)); data[i + 2] = Math.max(0, Math.min(255, q[2] + n)); data[i + 3] = 255;
    }
    const file = path.join(process.env.SHOT_DIR || '.', 'side-cover-quarters.png');
    fs.writeFileSync(file, encode({ width: W, height: H, data }));
    // a book in the middle of a row with two or more on each side: its neighbours go (hidden), both faces open
    const pick = await page.evaluate(() => {
      const w = window.__app.world, S = window.__sc;
      const row = S.rows().filter((r) => r.ids.length >= 5 && r.level >= 1).sort((a, b) => b.ids.length - a.ids.length)[0];
      if (!row) return null;
      const k = Math.floor(row.ids.length / 2), id = row.ids[k];
      for (const o of row.ids) if (o !== id) w.books.setHidden(o, true);
      const e = w.books.entry(id);
      window.__scPick = { id, others: row.ids.filter((o) => o !== id), url0: w.opts.coverUrl(id) };
      return { id, title: e.book.title, n: row.ids.length, open: S.sides().faces().find((x) => x.id === id) || null };
    });
    if (!pick) check('a row with five books for the new cover', false);
    else {
      const t0 = Date.now();
      const res = await page.evaluate(([id, f]) => window.__app.ctx.api.invoke('covers:chooseFile', id, f), [pick.id, file]);
      // the cell is made anew and shows the chosen picture (event: the cell shows the book's new cover address, and a
      // first picture has faded in from the binding colour)
      let st = null;
      for (let i = 0; i < 300; i++) {
        st = await page.evaluate(() => { const w = window.__app.world, S = window.__sc, s = S.sides(), p = window.__scPick, x = s.faces().find((f) => f.id === p.id), a = S.sideOf(w.books.entry(p.id)); return { url: w.opts.coverUrl(p.id), face: x || null, faded: a[2] === 1 && s.time - a[1] >= 0.35 }; });
        if (st.url && st.url !== pick.url0 && st.face?.state === 'ready' && String(st.face.shown || '').includes(st.url) && st.faded) break;
        await sleep(100);
      }
      const ms = Date.now() - t0;
      // from the front right and from the front left, a little more along the shelf than across (the sides of the case
      // stay out of the line of sight)
      const seen = await page.evaluate(() => {
        const w = window.__app.world, S = window.__sc, p = window.__scPick, e = w.books.entry(p.id);
        w.actions.rayTimer = 1e9; w.books.setHover(null);   // (the book stays on the shelf while it is looked at)
        const at = (face) => ({ tl: S.facePoint(e, face, 0.15, 0.8), tr: S.facePoint(e, face, 0.85, 0.8), bl: S.facePoint(e, face, 0.15, 0.2), br: S.facePoint(e, face, 0.85, 0.2) });
        const look = (face) => { const P = at(face); S.lookAtFace(e, face, 0.25, 0.75); const c = S.sample(Object.values(P)); return Object.fromEntries(Object.keys(P).map((k, i) => [k, c[i]])); };
        const out = { front: look('front'), back: look('back'), side: S.sideOf(e), rebuilds: { ...window.__scBuilds } };
        w.actions.rayTimer = 0;
        return out;
      });
      if (has('shots') && process.env.SC_SHOTS !== '0') {
        await page.evaluate(() => { const w = window.__app.world, S = window.__sc, e = w.books.entry(window.__scPick.id); w.actions.rayTimer = 1e9; S.lookAtFace(e, 'front', 0.25, 0.75); w.frame(); });
        await shot('sc-quarters-front');
        await page.evaluate(() => { const w = window.__app.world, S = window.__sc, e = w.books.entry(window.__scPick.id); S.lookAtFace(e, 'back', 0.25, 0.75); w.frame(); });
        await shot('sc-quarters-back');
        await page.evaluate(() => { window.__app.world.actions.rayTimer = 0; });
      }
      const what = (c) => {
        if (!c) return null;
        const [r, g, b] = c;
        if (r > 1.6 * b && g > 1.6 * b && Math.min(r, g) > 0.6 * Math.max(r, g)) return 'yellow';
        if (r > 1.5 * g && r > 1.5 * b) return 'red';
        if (g > 1.25 * r && g > 1.25 * b) return 'green';
        if (b > 1.25 * r && b > 1.1 * g) return 'blue';
        return 'other';
      };
      const want = { tl: 'red', tr: 'green', bl: 'blue', br: 'yellow' };
      const named = (o) => Object.fromEntries(Object.entries(o).map(([k, c]) => [k, what(c)]));
      const front = named(seen.front), back = named(seen.back);
      // three of the four quarters seen in their colour and none in another quarter's colour: a mirrored or upside-down
      // picture swaps at least two of them (a point hidden by something in front does not count against it)
      const verdict = (n) => { const right = Object.keys(want).filter((k) => n[k] === want[k]).length, wrong = Object.keys(want).filter((k) => ['red', 'green', 'blue', 'yellow'].includes(n[k]) && n[k] !== want[k]).length; return right >= 3 && wrong === 0; };
      log('NEWCOVER', { res: { ok: res.ok, error: res.error }, ms, st, seen, front, back });
      check('a chosen cover reaches the faces without a rebuild of the shelves', res.ok && st.face?.state === 'ready' && String(st.face?.shown || '').includes(st.url) && seen.side[2] === 1 && seen.rebuilds.build === rebuilds.build && seen.rebuilds.refresh === rebuilds.refresh, { ok: res.ok, state: st.face?.state, ms, rebuilds: seen.rebuilds });
      check('the front shows it upright and unmirrored (red top left, green top right, blue and yellow below)', verdict(front), { front, colours: seen.front });
      check('the back shows the same picture, upright and unmirrored as well', verdict(back), { back, colours: seen.back });
      // the book's own cover again, the neighbours back on the shelf
      await page.evaluate(async () => { const w = window.__app.world, p = window.__scPick; await window.__app.ctx.api.invoke('covers:useBook', p.id); for (const o of p.others) w.books.setHidden(o, false); });
    }
  }

  // ------------------------------------------------------------------ gaps: a book in the basket, one pulled out ----
  if (has('gap')) {
    // (a book still out from the parts before would close the faces beside it)
    await page.evaluate(() => window.__sc.rest(true));
    for (let i = 0; i < 100 && !(await page.evaluate(() => window.__sc.allIn())); i++) await sleep(50);
    const pick = await page.evaluate(() => {
      const w = window.__app.world, S = window.__sc;
      // (a row at eye height when there is one: the picture of the gap shows it best)
      const rows = S.rows().filter((r) => r.ids.length >= 5).sort((a, b) => (b.level >= 1) - (a.level >= 1) || b.ids.length - a.ids.length);
      const row = rows[0];
      if (!row) return null;
      const k = 2, ids = row.ids;
      window.__scGap = { mid: ids[k], left: ids[k - 1], right: ids[k + 1], other: ids[ids.length - 3] };
      const f = new Map(S.sides().faces().map((x) => [x.id, x]));
      return { ...window.__scGap, before: { left: f.get(ids[k - 1]) || null, right: f.get(ids[k + 1]) || null } };
    });
    if (!pick) check('a row with five books for the gap', false);
    else {
      await page.evaluate(() => { const g = window.__scGap; window.__app.world.books.setHidden(g.mid, true); });
      const gap = await settle(30000);
      const after = await page.evaluate(() => { const S = window.__sc, w = window.__app.world, g = window.__scGap, f = new Map(S.sides().faces().map((x) => [x.id, x])); return { left: f.get(g.left) || null, right: f.get(g.right) || null, sideL: S.sideOf(w.books.entry(g.left)), sideR: S.sideOf(w.books.entry(g.right)) }; });
      await page.evaluate(() => { const g = window.__scGap; window.__app.world.books.setHidden(g.mid, false); });
      await sleep(50);
      const back = await page.evaluate(() => { const S = window.__sc, g = window.__scGap, f = new Map(S.sides().faces().map((x) => [x.id, x])); return { left: f.get(g.left) || null, right: f.get(g.right) || null }; });
      log('GAP', { pick, after, back, waited: gap.waited });
      check('a book taken out (in the basket) opens the faces beside it: the front of its left neighbour, the back of its right one', !pick.before.left?.front && !pick.before.right?.back && after.left?.front && after.right?.back, { before: pick.before, after: { left: after.left, right: after.right } });
      check('… and they show their pictures', after.left?.state === 'ready' && after.right?.state === 'ready' && after.sideL[2] === 1 && after.sideR[2] === 1, { left: after.sideL, right: after.sideR, waited: gap.waited });
      check('put back, the faces beside it close again', !back.left?.front && !back.right?.back, back);
      // pulled out: the crosshair rests on a book (the world's look ray), it comes out, its neighbours show their covers
      // in the gap; the crosshair leaves it, it goes back
      const pull = await page.evaluate(async () => {
        const w = window.__app.world, g = window.__scGap, e = w.books.entry(g.mid), S = window.__sc;
        S.rest(false); S.aimAt(e);
        const t0 = performance.now();
        let out = null, ready = null, target = null;
        for (let i = 0; i < 600 && (!out || !ready); i++) {
          await new Promise((r) => requestAnimationFrame(r));
          target = w.actions.target?.book?.id || null;
          if (!out && w.books.hoverEntry === e) out = performance.now() - t0;
          const f = new Map(S.sides().faces().map((x) => [x.id, x]));
          if (!ready && f.get(g.left)?.state === 'ready' && f.get(g.right)?.state === 'ready' && f.get(g.left)?.front && f.get(g.right)?.back) ready = performance.now() - t0;
        }
        const f = new Map(S.sides().faces().map((x) => [x.id, x]));
        const r = { target: target === g.mid, out: out && Math.round(out), ready: ready && Math.round(ready), left: f.get(g.left) || null, right: f.get(g.right) || null };
        // the crosshair up to the wall above the cases
        const p = e.pos.clone().addScaledVector(e.forward, 0.9); S.look(p.x, p.z, e.pos.clone().setY(e.pos.y + 2.2));
        return r;
      });
      // back on the shelf: wait until the slot has let it go
      for (let i = 0; i < 100; i++) { if (await page.evaluate(() => !window.__app.world.books.slots.some((s) => s.entry))) break; await sleep(50); }
      const closed = await page.evaluate(() => { const S = window.__sc, g = window.__scGap, f = new Map(S.sides().faces().map((x) => [x.id, x])); return { left: f.get(g.left) || null, right: f.get(g.right) || null }; });
      log('PULL', { pull, closed });
      check('a book pulled out opens the faces beside it, and they show their pictures', pull.out != null && pull.ready != null && pull.left?.front && pull.right?.back, pull);
      check('back in its place, the faces beside it close again', !closed.left?.front && !closed.right?.back, closed);
      if (has('shots') && process.env.SC_SHOTS !== '0') {
        // three books in the basket: the gap shows the front of the book left of it and the back of the one right of it
        const ids = await page.evaluate(() => {
          const w = window.__app.world, S = window.__sc, g = window.__scGap;
          const row = S.rows().find((r) => r.ids.includes(g.mid)), k = row.ids.indexOf(g.mid), gone = row.ids.slice(k, k + 3);
          for (const id of gone) w.books.setHidden(id, true);
          window.__scGone = gone;
          return gone;
        });
        await settle(20000);
        await page.evaluate(() => {
          const w = window.__app.world, S = window.__sc, g = window.__scGap, e = w.books.entry(g.left);
          document.querySelector('#hud')?.style.setProperty('opacity', '0'); w.actions.rayTimer = 1e9; w.books.setHover(null);
          S.lookAtFace(e, 'front', 0.22, 0.55); for (let i = 0; i < 6; i++) w.frame();
        });
        await shot('sc-gap');
        await page.evaluate(() => { const w = window.__app.world; for (const id of window.__scGone) w.books.setHidden(id, false); document.querySelector('#hud')?.style.setProperty('opacity', '1'); w.actions.rayTimer = 0; });
        log('GAPSHOT', ids);
      }
    }
  }

  // ------------------------------------------------------------------ the pulled-out book ----
  if (has('hover')) {
    const r = await page.evaluate(async () => {
      const w = window.__app.world, S = window.__sc, s = S.sides();
      // the last book of a row with a cover image (its side shows the small picture)
      const f = s.faces().filter((x) => x.front && x.kind === 'cover');
      const id = f[Math.floor(f.length / 2)]?.id; if (!id) return null;
      const e = w.books.entry(id);
      S.aimAt(e);
      let first = null, fin = null;
      for (let i = 0; i < 600 && !fin; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const slot = w.books.slots.find((x) => x.entry === e);
        if (!slot || !slot.mesh.visible) continue;
        const map = slot.front.map, rect = slot.front.userData.uAtlas.value.toArray().map((v) => +v.toFixed(4));
        const kind = map === s.atlas ? 'side' : map?.image?.width > 1 ? 'cover' : 'none';
        if (!first) first = { kind, rect };
        // (0.7.2) out, turned and widened to the proportions of its picture: the whole picture on front and back
        if (kind === 'cover' && !slot.waiting && slot.t >= 1 && slot.dAsp === slot.coverD) fin = { kind, rect, img: [map.image.width, map.image.height], face: [+slot.mesh.scale.z.toFixed(4), +e.h.toFixed(4)], shelf: [+e.d.toFixed(4), +e.h.toFixed(4)], same: slot.mesh.material[0] === slot.mesh.material[1] };
      }
      const p = e.pos.clone().addScaledVector(e.forward, 0.9); S.look(p.x, p.z, e.pos.clone().setY(e.pos.y + 2.2));
      return { id, first, fin };
    });
    log('HOVER', r);
    if (!r) check('a row end with a cover image for the hover', false);
    else {
      // the width of the turned book follows its picture (books.js COVER_ASPECT_MIN … MAX), the picture is whole
      const aspect = r.fin ? Math.min(0.9, Math.max(0.55, r.fin.img[0] / r.fin.img[1])) : null;
      check('the pulled-out book shows the whole cover (nothing trimmed) on a face of the picture\'s proportions, on front and back', !!r.fin && r.fin.same && [0, 0, 1, 1].every((v, i) => Math.abs(v - r.fin.rect[i]) < 0.002) && Math.abs(r.fin.face[0] / r.fin.face[1] - aspect) < 0.003, { fin: r.fin, aspect });
      check('while its large cover loads, it shows the small picture of its side (or the large one at once)', r.first && (r.first.kind === 'side' || r.first.kind === 'cover'), r.first);
    }
  }

  // ------------------------------------------------------------------ the spines stay as they are ----
  if (has('spines')) {
    const r = await page.evaluate(() => {
      const w = window.__app.world, S = window.__sc, s = S.sides();
      // straight in front of the fullest case downstairs
      const n = (b) => b.rows.reduce((a, x) => a + x.items.length, 0);
      const bc = [...w.layout.bookcases].filter((b) => n(b) > 6).sort((a, b) => n(b) - n(a))[0];
      const obj = w.bookcaseObjects.get(bc.id); obj.updateMatrixWorld(true);
      const V = w.camera.position.constructor, c = new V(0, 1.4, 0).applyMatrix4(obj.matrixWorld), f = new V(0, 0, 1).transformDirection(obj.matrixWorld);
      const p = c.clone().addScaledVector(f, 1.35);
      S.rest(true);
      S.look(p.x, p.z, c);
      const gl = w.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const grab = () => { w.frame(); const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
      w.frame(); const a = grab(); s.setEnabled(false); w.frame(); const b = grab(); s.setEnabled(true); w.frame(); S.rest(false);
      // the spines: every book of the case that is no row end, as its spine rectangle on the screen
      const ends = new Set(s.faces().map((x) => x.id)), v = new V(), diffs = [];
      for (const r of bc.rows) for (const it of r.items) {
        const e = w.books.entry(it.id); if (!e || ends.has(it.id)) continue;
        for (const [du, dv] of [[0, 0], [-0.25, 0.3], [0.25, -0.3]]) {
          v.set(du, dv, 0.5).applyMatrix4(e.matrix).project(w.camera);
          const x = Math.round((v.x + 1) / 2 * (W - 1)), y = Math.round((v.y + 1) / 2 * (H - 1)), i = (y * W + x) * 4;
          diffs.push(Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])));
        }
      }
      diffs.sort((p, q) => p - q);
      return { case: bc.id, n: diffs.length, max: diffs[diffs.length - 1], p95: diffs[Math.floor(diffs.length * 0.95)], mean: +(diffs.reduce((p, q) => p + q, 0) / Math.max(1, diffs.length)).toFixed(2) };
    });
    log('SPINES', r);
    check('the spines look the same with the pictures on and off (the same pixels)', r.n > 10 && r.p95 <= 2 && r.mean <= 0.5, r);
  }

  // ------------------------------------------------------------------ loading every picture anew ----
  if (has('load')) {
    const r = await page.evaluate(async () => {
      const w = window.__app.world, S = window.__sc, s = S.sides();
      const rows = S.rows();
      const e = w.books.entry(rows[Math.floor(rows.length / 2)].ids[0]);
      S.lookAtFace(e, 'back', 1.2, 1.6);
      const frames = async (cond, max = 30000) => { const f = []; let last = performance.now(); const t0 = last; while (performance.now() - t0 < max) { await new Promise((r) => requestAnimationFrame(r)); const t = performance.now(); f.push(t - last); last = t; if (cond && cond()) break; } return f; };
      const stat = (f) => { const a = [...f].sort((p, q) => p - q); return { n: a.length, p50: +a[Math.floor(a.length / 2)].toFixed(1), p95: +a[Math.floor(a.length * 0.95)].toFixed(1), max: +a[a.length - 1].toFixed(1), over50: a.filter((x) => x > 50).length }; };
      const programs0 = w.renderer.info.programs.length;
      const quiet = await frames(null, 2500);
      const st0 = { ...s.stats };
      s.stats.max = 0;                    // (the longest upload of this loading only)
      s.reset();
      const t0 = performance.now();
      const all = () => { const i = s.info(); return i.openReady >= Math.min(i.open, i.capacity) && !i.loading && !i.done && !i.queued; };
      const load = await frames(all, 60000);
      const st = s.stats, n = st.uploads - st0.uploads;
      return { quiet: stat(quiet), load: stat(load), seconds: +((performance.now() - t0) / 1000).toFixed(2), cells: n, uploadAvg: +((st.ms - st0.ms) / Math.max(1, n)).toFixed(3), uploadMax: +st.max.toFixed(2), programs: [programs0, w.renderer.info.programs.length], info: s.info() };
    });
    log('LOAD', r);
    check('all pictures load anew in a few seconds, the near ones first', r.info.openReady >= Math.min(r.info.open, r.info.capacity) && r.seconds < 30, { seconds: r.seconds, cells: r.cells });
    // (a graphics card busy with other programs holds a single upload now and then for a few ms)
    check('putting a cell on the graphics card costs the main thread little (mean under 0.5 ms, longest under 8 ms)', r.uploadAvg < 0.5 && r.uploadMax < 8, { avg: r.uploadAvg, max: r.uploadMax });
    check('no long frame while the pictures load (no more frames over 50 ms than standing still)', r.load.over50 <= r.quiet.over50 + 1 && r.load.max < Math.max(100, r.quiet.max * 2), { quiet: r.quiet, load: r.load });
    check('loading the pictures compiles no shader program', r.programs[0] === r.programs[1], r.programs);
  }

  // ------------------------------------------------------------------ frame time in front of the shelves ----
  if (has('perf')) {
    const secs = +(process.env.SC_PERF_SECONDS || 2);
    const r = await page.evaluate(async (secs) => {
      const w = window.__app.world, S = window.__sc, s = S.sides();
      // along a wall downstairs, many row ends in view
      const rows = S.rows();
      const e = w.books.entry(rows[rows.length - 1].ids[0]);
      S.lookAtFace(e, 'front', 2.4, 2.2);
      const run = async () => { const f = []; let last = performance.now(); const t0 = last; while (performance.now() - t0 < secs * 1000) { await new Promise((r) => requestAnimationFrame(r)); const t = performance.now(); f.push(t - last); last = t; } f.shift(); const a = f.sort((p, q) => p - q); return { mean: +(a.reduce((p, q) => p + q, 0) / a.length).toFixed(2), p95: +a[Math.floor(a.length * 0.95)].toFixed(2) }; };
      // the draw calls of a frame are the same with and without the pictures (the fewest of ten frames: shadow maps and
      // reflections are not drawn in every frame)
      const r0 = w.renderer, auto = r0.info.autoReset;
      const calls = () => { let min = Infinity; for (let i = 0; i < 10; i++) { r0.info.autoReset = false; r0.info.reset(); w.frame(); min = Math.min(min, r0.info.render.calls); r0.info.autoReset = auto; } return min; };
      const out = { on: [], off: [], callsOn: calls(), callsOff: null };
      for (let k = 0; k < 3; k++) {
        s.setEnabled(true); await run(); out.on.push(await run());
        s.setEnabled(false); if (k === 0) out.callsOff = calls(); await run(); out.off.push(await run());
      }
      s.setEnabled(true);
      return out;
    }, secs);
    // the median of the three rounds: a hitch of another program on the same graphics card spoils one round, not all
    const med = (a, k) => [...a].map((x) => x[k]).sort((p, q) => p - q)[Math.floor(a.length / 2)];
    const on = { mean: med(r.on, 'mean'), p95: med(r.on, 'p95') }, off = { mean: med(r.off, 'mean'), p95: med(r.off, 'p95') };
    log('PERF', { on, off, rounds: r, size: [SW, SH] });
    check('the frame time in front of the shelves stays the same with the pictures (within 10 % or 0.5 ms)', on.mean <= off.mean * 1.1 + 0.5, { on, off });
    // (birds and deer in the windows come and go between the frames: a few calls either way)
    check('the pictures add no draw call (the same within the coming and going of the animals)', Math.abs(r.callsOn - r.callsOff) <= 12, { on: r.callsOn, off: r.callsOff });
  }

  // ------------------------------------------------------------------ a shelf rebuild ----
  if (has('rebuild')) {
    // (no book under the crosshair: the pictures of its neighbours would load meanwhile, the rebuild has no part in that)
    await page.evaluate(() => window.__sc.rest(true));
    for (let i = 0; i < 100 && !(await page.evaluate(() => window.__sc.allIn())); i++) await sleep(50);
    await settle(30000);
    const r = await page.evaluate(async () => {
      const w = window.__app.world, s = window.__sc.sides();
      const time = async (n) => { const t = []; for (let i = 0; i < n; i++) { const a = performance.now(); w.refreshShelves(); t.push(performance.now() - a); await new Promise((r) => setTimeout(r, 120)); } t.sort((p, q) => p - q); return +t[Math.floor(t.length / 2)].toFixed(1); };
      const programs0 = w.renderer.info.programs.length, up0 = s.stats.uploads;
      const on = await time(5);
      // the same shelves again: every picture stays, nothing is made or uploaded anew
      for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
      const upAfter = s.stats.uploads - up0;
      const info = s.info();
      s.setEnabled(false); const off = await time(5); s.setEnabled(true);
      window.__sc.rest(false);
      return { on, off, uploads: upAfter, programs: [programs0, w.renderer.info.programs.length], openReady: info.openReady, open: info.open };
    });
    log('REBUILD', r);
    check('a shelf rebuild keeps every picture (nothing made or uploaded anew) and compiles nothing', r.uploads === 0 && r.programs[0] === r.programs[1] && r.openReady >= Math.min(r.open, 9999), r);
    check('a shelf rebuild takes as long with the pictures as without (within 25 % or 5 ms)', r.on <= r.off * 1.25 + 5, { on: r.on, off: r.off });
  }

  // ------------------------------------------------------------------ pictures from a visitor's places ----
  if (has('shots') && process.env.SC_SHOTS !== '0') {
    await settle(30000);
    const views = await page.evaluate(() => {
      const w = window.__app.world, S = window.__sc, s = S.sides(), out = [];
      const ROOM = { x0: -11, x1: 11, z0: -23.6, z1: -9.2 };
      // along each wall, looking at the open fronts (the last books of the rows): from where the fronts face you
      const rows = S.rows();
      const groups = new Map();
      for (const r of rows) { const bc = w.layout.bookcases.find((b) => b.id === r.bc); const k = bc.wall || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push({ r, bc }); }
      for (const [k, list] of groups) {
        const { r } = list[Math.floor(list.length / 2)];
        const [side, front] = [2.2, 2.6];
        out.push(['wall-' + k, r.ids[r.ids.length - 1], 'front', side, front]);
        out.push(['wall-' + k + '-backs', r.ids[0], 'back', side * 0.75, front * 0.85]);
      }
      // close by: the end of a row with its bookend, as the user saw it
      const lastRow = rows.filter((r) => r.ids.length >= 4 && r.level >= 1)[0];
      if (lastRow) out.push(['rowend-close', lastRow.ids[lastRow.ids.length - 1], 'front', 0.55, 0.7]);
      const typoFace = s.faces().find((x) => x.front && x.kind === 'typo');
      if (typoFace) out.push(['titlecard-close', typoFace.id, 'front', 0.5, 0.7]);
      return out;
    });
    // (the look ray rests: no book comes out where the camera looks)
    await page.evaluate(() => { const w = window.__app.world; document.querySelector('#hud')?.style.setProperty('opacity', '0'); w.actions.rayTimer = 1e9; w.books.setHover(null); });
    for (const [name, id, face, side, front] of views) {
      await page.evaluate(([id, face, side, front]) => { const w = window.__app.world, S = window.__sc, e = w.books.entry(id); S.lookAtFace(e, face, side, front); for (let i = 0; i < 6; i++) w.frame(); }, [id, face, side, front]);
      await shot('sc-' + name);
    }
    await page.evaluate(() => { document.querySelector('#hud')?.style.setProperty('opacity', '1'); window.__app.world.actions.rayTimer = 0; });
  }

  log('INFO', await page.evaluate(() => window.__app.world.books.sideCovers.info()));
  check('no errors in the page', !errors.length, errors.slice(0, 5));
  console.log(`SIDE-COVER-CHECK ${failed ? 'FAILED' : 'OK'} passed=${passed} failed=${failed}`);
};
