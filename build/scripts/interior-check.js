// Interior checks for 0.6: the dark corner patches at the passage casing are gone (pixels at the four corners and a
// search for faces of the house's shell that lie in the plaster), the fire's shadow beside the wall light on the
// hall's south wall has a soft edge (no staircase of light), the signs have the texel density for crisp text up
// close (mipmaps, full anisotropy, sRGB, drawn over several frames, canvases let go once on the graphics card), the
// hover follows the shelf slot under the crosshair (a sweep along a row, and a neighbour hidden behind the turned
// cover), jumping onto low furniture (a table after a jump, walking off its edge, steps, never onto a bookcase or
// anything above 0.9 m, head clearance up there, sitting down from a table, the cat on a seat, the terrace doors and
// the edge of the garden), the wall clock shows the system time, and at a seat no books lie on the table unless
// "Zuletzt geöffnetes Buch am Sitzplatz bereitlegen" is on (then only the book opened last; an open book there reads
// the right way up).
// The world loop rests; the script steps the player and the frames itself. Runs muted and hidden.
//   node build/screenshot.js interior-check        IX_PARTS=corners,signs,hover,jump,clock,tablebooks (default: all)
module.exports = async ({ page, shot, sleep }) => {
  const parts = (process.env.IX_PARTS || 'corners,signs,hover,jump,clock,tablebooks').split(',');
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });
  const texWarnings = [];
  page.on('console', (m) => { if (/no image data found|image is incomplete/i.test(m.text())) texWarnings.push(m.text().slice(0, 160)); });
  const cc = (fn, arg) => page.evaluate(fn, arg);

  // ---- boot -------------------------------------------------------------------------------------------------------
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 60; i++) {
    const st = await cc(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active, hud: document.querySelector('#scan-status')?.textContent || '' }));
    if (!st.active && !st.hud && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(3000);
  await cc(() => { window.__app.world.stop(); window.__app.closeAllPanels(); });
  await sleep(600);
  await cc(() => {
    const w = window.__app.world, p = w.player;
    const sfx = [];
    const audio = window.__app.ctx.audio, origSfx = audio.sfx.bind(audio);
    audio.sfx = (name, o) => { sfx.push(name); return origSfx(name, o); };
    window.__ix = {
      sfx,
      key(code, type = 'keydown', extra = {}) { document.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true, ...extra })); },
      press(code) { this.key(code); this.key(code, 'keyup'); },
      /** stand at (x, z) on the floor looking at (tx, ty, tz) */
      aim(x, z, tx, ty, tz, ground = 0) {
        if (w.actions.seatedId || p.seated) w.actions.leaveSeat();
        p.transition = null;
        p.setPose(x, z, Math.atan2(-(tx - x), -(tz - z)), Math.atan2(ty - 1.62 - ground, Math.hypot(tx - x, tz - z)), ground);
        return this.look();
      },
      look() { p.update(0.001); w.scene.updateMatrixWorld(); w.camera.updateMatrixWorld(); w.actions.rayTimer = 0; w.actions.update(0.001); const t = w.actions.target; return t ? { type: t.type, kind: t.kind || null, seat: t.seat?.id || null, book: t.book?.id || t.id || null } : null; },
      step(n, dt = 1 / 60) { for (let i = 0; i < n; i++) p.update(dt); },
      state() { return { x: +p.position.x.toFixed(3), z: +p.position.z.toFixed(3), ground: +p.ground.toFixed(3), eye: +p.position.y.toFixed(3), air: p.air ? +p.air.y.toFixed(3) : null, cam: +w.camera.position.y.toFixed(3) }; },
      panels() { return [...document.querySelectorAll('.panel-layer:not(.closing)')].map((l) => l.dataset.panel); },
    };
  });

  // ================================================================= 1. the corner patches =========================================
  if (parts.includes('corners')) {
    // faces of the house's shell (garden.js: plinth, roofs, deck) that lie in a face of the building pointing the same way
    const audit = await cc(() => {
      const w = window.__app.world, L = w.layout;
      const faces = (min, max, what) => { const out = []; for (let a = 0; a < 3; a++) for (const s of [-1, 1]) out.push({ a, s, at: s > 0 ? max[a] : min[a], min, max, what }); return out; };
      const building = [];
      for (const b of L.walls) building.push(...faces([b.x - b.w / 2, b.y - b.h / 2, b.z - b.d / 2], [b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2], 'wall'));
      for (const f of L.floors) building.push({ a: 1, s: 1, at: 0, min: [f.x - f.w / 2, 0, f.z - f.d / 2], max: [f.x + f.w / 2, 0, f.z + f.d / 2], what: 'floor' });
      for (const c of L.ceilings) building.push({ a: 1, s: -1, at: c.y, min: [c.x - c.w / 2, c.y, c.z - c.d / 2], max: [c.x + c.w / 2, c.y, c.z + c.d / 2], what: 'ceiling' });
      const shell = [];
      const garden = w.scene.children.find((o) => o.name === 'garden');
      const V = w.camera.position.constructor;
      garden?.traverse((o) => {
        if (!o.isMesh || o.geometry?.type !== 'BoxGeometry') return;
        o.updateMatrixWorld(true);
        const e = o.matrixWorld.elements;                       // axis-aligned boxes only (no turn)
        if (Math.abs(e[1]) + Math.abs(e[2]) + Math.abs(e[4]) + Math.abs(e[6]) + Math.abs(e[8]) + Math.abs(e[9]) > 1e-6) return;
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
        shell.push(...faces(bb.min.toArray(), bb.max.toArray(), 'shell ' + (o.material?.color ? '#' + o.material.color.getHexString() : '') + ' y' + bb.min.y.toFixed(2) + '..' + bb.max.y.toFixed(2)));
      });
      const hits = [];
      for (const f of shell) for (const g of building) {
        if (f.a !== g.a || f.s !== g.s || Math.abs(f.at - g.at) > 0.002) continue;
        const [u, v] = [0, 1, 2].filter((k) => k !== f.a);
        const du = Math.min(f.max[u], g.max[u]) - Math.max(f.min[u], g.min[u]), dv = Math.min(f.max[v], g.max[v]) - Math.max(f.min[v], g.min[v]);
        if (du > 0.001 && dv > 0.001 && du * dv > 1e-4) hits.push({ shell: f.what, building: g.what, axis: 'xyz'[f.a] + (f.s > 0 ? '+' : '-'), at: +f.at.toFixed(3), area: +(du * dv).toFixed(3) });
      }
      return { shellFaces: shell.length, buildingFaces: building.length, hits: hits.slice(0, 8), count: hits.length, V: !!V };
    });
    check('no face of the house\'s shell lies in a face of the walls, floors or ceilings (nothing to z-fight with the plaster)', audit.shellFaces > 0 && audit.count === 0, audit);

    // the pixels beside the four upper corners of the passage casing, in the hall and in the book room
    // both corners from the middle, and the two oblique views of a user's screenshots (the z-fight depended on the angle)
    const views = [['hall', 0, -2.5, 0, 3.3, -5.55, -5.5, 1, [-1, 1]], ['room', 0, -12.5, 0, 3.3, -9.25, -9.2, -1, [-1, 1]],
      ['hall-oblique', -2.4, -3.2, -2.1, 3.3, -5.5, -5.5, 1, [-1]], ['room-oblique', 3.6, -11.3, 2.1, 3.3, -9.25, -9.2, -1, [1]]];
    for (const [name, x, z, tx, ty, tz, wallZ, dir, sides] of views) {
      const r = await cc(([x, z, tx, ty, tz, wallZ, dir, sides]) => {
        const w = window.__app.world, c = window.__ix;
        c.aim(x, z, tx, ty, tz);
        for (let i = 0; i < 6; i++) w.frame();
        const gl = w.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
        const V = w.camera.position.constructor, v = new V(), q = new V();
        w.frame();                                              // read in the same task, before the picture is shown
        const buf = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const lum = (px, py) => { const i = ((H - 1 - py) * W + px) * 4; return 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]; };
        // the casing in front of the wall (world.js #buildStructure): a wall point seen past its edge does not count
        const o = w.layout.openings.find((op) => op.kind === 'arch' && Math.abs(op.z - wallZ) < 0.01);
        const Box = w.actions.occluders[0].constructor, Ray = w.actions.raycaster.ray.constructor;
        const zr = (d) => [Math.min(o.z, o.z + o.dir * d), Math.max(o.z, o.z + o.dir * d)];
        const casing = [];
        for (const s of [-1, 1]) { const [z0, z1] = zr(0.16); casing.push(new Box(new V(Math.min(s * o.w / 2, s * (o.w / 2 + 0.36)), 0, z0), new V(Math.max(s * o.w / 2, s * (o.w / 2 + 0.36)), o.h, z1))); }
        { const [z0, z1] = zr(0.16); casing.push(new Box(new V(-o.w / 2 - 0.36, o.h, z0), new V(o.w / 2 + 0.36, o.h + 0.22, z1))); }
        { const [z0, z1] = zr(0.19); casing.push(new Box(new V(-o.w / 2 - 0.39, o.h + 0.22, z0), new V(o.w / 2 + 0.39, o.h + 0.26, z1))); }
        const ray = new Ray();
        const seen = (pt) => { ray.origin.copy(w.camera.position); ray.direction.copy(pt).sub(w.camera.position); const d = ray.direction.length(); ray.direction.normalize(); return casing.every((b) => { const h = ray.intersectBox(b, q); return !h || h.distanceTo(ray.origin) > d - 0.003; }); };
        const sample = (x0, x1, y0, y1) => {
          const out = [];
          for (let ix = 0; ix <= 12; ix++) for (let iy = 0; iy <= 10; iy++) {
            const pt = new V(x0 + (x1 - x0) * ix / 12, y0 + (y1 - y0) * iy / 10, wallZ + dir * 0.002);
            if (!seen(pt)) continue;
            v.copy(pt).project(w.camera);
            const px = Math.round((v.x + 1) / 2 * W), py = Math.round((1 - v.y) / 2 * H);
            if (px >= 0 && py >= 0 && px < W && py < H && v.z < 1) out.push(lum(px, py));
          }
          return out;
        };
        const res = {};
        const capEnd = 1.7 + 0.36 + 0.03;                       // PASSAGE.w / 2 + CASING_W + the cap's overhang
        for (const side of sides) {
          const a = capEnd + 0.03, b = capEnd + 0.2;
          const patch = sample(side * a, side * b, 3.16, 3.42), ref = sample(side * (capEnd + 0.45), side * (capEnd + 0.65), 3.16, 3.42);
          const refMean = ref.reduce((s, l) => s + l, 0) / Math.max(1, ref.length);
          const dark = patch.filter((l) => l < refMean * 0.55).length;
          res[side < 0 ? 'left' : 'right'] = { samples: patch.length, dark, darkShare: +(dark / Math.max(1, patch.length)).toFixed(3), min: Math.round(Math.min(...patch)), mean: Math.round(patch.reduce((s, l) => s + l, 0) / Math.max(1, patch.length)), ref: Math.round(refMean) };
        }
        return res;
      }, [x, z, tx, ty, tz, wallZ, dir, sides]);
      for (const side of sides.map((s) => (s < 0 ? 'left' : 'right'))) check(`${name}: no dark patch beside the ${side} upper corner of the passage casing`, r[side].samples > 40 && r[side].darkShare < 0.02 && r[side].mean > r[side].ref * 0.8, r[side]);
      await shot(`ix-corners-${name}`);
    }

    // the stepped light patch beside the wall light on the hall's south wall (x = -4.55): the edge of the fire's shadow
    // (the firebox shades the far wall). Its edge must be soft: the same spot with the old shadow radius 1 and as it is now.
    // Measured in the morning: the checks run at the real time of day, and in the evening the low sun throws the shadows
    // of the glass front's bars onto this wall; their hard edges were measured instead (on 0.7.0 as well)
    const sky0 = await cc(() => { const s = window.__app.state.settings; return { timeMode: s.timeMode, fixedHour: s.fixedHour }; });
    await cc(() => window.__app.ctx.api.settings.set({ timeMode: 'fixed', fixedHour: 10.25 }));
    await sleep(1200);
    const edge = await cc(async () => {
      const w = window.__app.world, c = window.__ix, fl = w.fire?.light;
      if (!fl?.castShadow) return { skipped: true };
      c.aim(-4.55, -2.0, -4.55, 2.6, -5.5);
      const gl = w.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, V = w.camera.position.constructor, v = new V();
      const profile = () => {
        fl.shadow.needsUpdate = true;
        for (let i = 0; i < 4; i++) w.frame();
        const buf = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const lum = (px, py) => { const i = ((H - 1 - py) * W + px) * 4; return 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]; };
        // left of the wall light and above its fan of light (x -5.9 … -5.06, y 4.1 … 4.9), averaged up the wall
        const cols = [];
        for (let k = 0; k <= 60; k++) {
          let s = 0, n = 0;
          for (let j = 0; j <= 20; j++) {
            v.set(-5.9 + 0.84 * k / 60, 4.1 + 0.8 * j / 20, -5.498).project(w.camera);
            const px = Math.round((v.x + 1) / 2 * W), py = Math.round((1 - v.y) / 2 * H);
            if (px >= 0 && py >= 0 && px < W && py < H) { s += lum(px, py); n++; }
          }
          cols.push(n ? s / n : 0);
        }
        let step = 0; for (let k = 2; k < cols.length; k++) step = Math.max(step, Math.abs(cols[k] - cols[k - 2]));
        return { step: +step.toFixed(2), rise: +(Math.max(...cols) - Math.min(...cols)).toFixed(1) };
      };
      const now = fl.shadow.radius;
      fl.shadow.radius = 1; const hard = profile();
      fl.shadow.radius = now; const soft = profile();
      return { radius: now, hard, soft };
    });
    if (edge.skipped) console.log('SKIP fire shadow edge: no shadow from the fire at this quality');
    else check('the fire\'s shadow edge beside the wall light on the south wall is soft (no staircase of light)', edge.radius >= 4 && edge.soft.step <= edge.hard.step * 0.8, edge);
    await shot('ix-south-wall-sconce');
    await cc((sk) => window.__app.ctx.api.settings.set(sk), sky0);
    await sleep(800);
  }

  // ================================================================= 2. the signs ===============================================
  if (parts.includes('signs')) {
    const signs = await cc(() => {
      const w = window.__app.world;
      if (!w.signs) return { missing: true };
      w.signs.flush();
      return w.signs.stats();
    });
    if (signs.missing) check('the sign painter exists (signs.js)', false, signs);
    else {
      // texels per metre each kind needs (signs.js SIGN_DENSITY): close up 2000, shelf labels and the card 1600, high 900
      const need = { directory: 1990, plate: 1990, nameplate: 1990, plates: 1590, card: 1590, signs: 890 };
      const kinds = [...new Set(signs.list.map((s) => s.kind))];
      const low = signs.list.filter((s) => !(s.density >= (need[s.kind] || 1990)));
      check('every sign is there: the directory, the department signs, the shelf labels and the plates on the furniture', ['directory', 'signs', 'plates', 'plate'].every((k) => kinds.includes(k)) && signs.list.filter((s) => s.kind === 'plate').length >= 4, { kinds, plates: signs.list.filter((s) => s.kind === 'plate').length });
      check('every sign has the texel density of its kind (2000/m close up, 1600/m on the shelves, 900/m up on the wall)', !low.length, { low, list: signs.list.map((s) => [s.kind, s.w, s.h, Math.round(s.density)]) });
      check('every sign has mipmaps, the full anisotropy and sRGB colours, and is on the graphics card', signs.list.every((s) => s.mipmaps && s.anisotropy === signs.maxAnisotropy && s.srgb && s.ready) && signs.maxAnisotropy >= 8, { maxAnisotropy: signs.maxAnisotropy, bad: signs.list.filter((s) => !(s.mipmaps && s.anisotropy === signs.maxAnisotropy && s.srgb && s.ready)) });
      console.log('SIGN-MEMORY ' + JSON.stringify({ MB: +(signs.bytes / 1048576).toFixed(1), canvasMB: +((signs.canvasBytes || 0) / 1048576).toFixed(1), byKind: Object.fromEntries(kinds.map((k) => [k, +(signs.list.filter((s) => s.kind === k).reduce((a, s) => a + s.bytes, 0) / 1048576).toFixed(1)])) }));
      // a rebuild with the loop running: the same signs come from the cache, new ones are drawn on later frames
      const lazy = await cc(async () => {
        const w = window.__app.world;
        w.running = true;                                        // what refreshShelves sees while the loop runs
        try {
          let t0 = performance.now();
          w.refreshShelves();
          const same = { ms: +(performance.now() - t0).toFixed(1), pending: w.signs.pending };
          const before = w.signs.stats().list.length;
          // other texts (English) for every sign of the room: nothing may be drawn inside the rebuild
          window.__app.ctx.i18n.setLanguage('en');
          t0 = performance.now();
          w.refreshShelves();
          const other = { ms: +(performance.now() - t0).toFixed(1), pending: w.signs.pending };
          const jobs = [];
          for (let i = 0; i < 40 && w.signs.pending; i++) { const a = performance.now(); w.signs.pump(); jobs.push(+(performance.now() - a).toFixed(1)); await new Promise((r) => requestAnimationFrame(r)); }
          const after = w.signs.stats();
          const times = after.list.map((s) => [s.kind, s.w + 'x' + s.h, s.paintMs, s.uploadMs]);
          window.__app.ctx.i18n.setLanguage('de');
          w.refreshShelves();
          for (let i = 0; i < 40 && w.signs.pending; i++) { w.signs.pump(); await new Promise((r) => requestAnimationFrame(r)); }
          return { same, other, jobs, times, maxJob: Math.max(0, ...jobs), allReady: after.list.every((s) => s.ready), signs: before, freed: w.signs.stats().list.length };
        } finally { w.running = false; }
      });
      check('rebuilding the shelves with the same signs draws nothing (cached)', lazy.same.pending === 0, lazy.same);
      check('new sign texts are not drawn inside the rebuild but over the next frames, one job a frame, each under 40 ms', lazy.other.pending > 0 && lazy.allReady && lazy.maxJob < 40, lazy);
      check('replaced signs are freed (the cache holds one set)', lazy.freed <= lazy.signs + 1, lazy);
      // close-ups for the eye: the directory at 35 cm, a department sign, the shelf labels
      const d = await cc(() => { const L = window.__app.world.layout; return { dir: L.directory, sign: (L.signs || []).find((s) => s.kind === 'department') }; });
      if (d.dir) {
        await cc((dir) => { const c = window.__ix, w = window.__app.world; c.aim(dir.x - 0.35, dir.z - 0.55, dir.x, dir.y + 0.35, dir.z - 0.55); for (let i = 0; i < 4; i++) w.frame(); }, d.dir);
        await shot('ix-signs-directory-35cm');
      }
      if (d.sign) {
        await cc((s) => { const c = window.__ix, w = window.__app.world; c.aim(s.x + Math.sin(s.rot) * 1.4, s.z + Math.cos(s.rot) * 1.4, s.x, s.y, s.z); for (let i = 0; i < 4; i++) w.frame(); }, d.sign);
        await shot('ix-signs-department');
      }
      // the canvases go once their signs are on the graphics card (only the textures stay); a texture that is to go up
      // again (a restored WebGL context, anything that sets needsUpdate) is drawn again and the board looks the same
      if (d.dir) {
        const rel = await cc(async (dir) => {
          const w = window.__app.world, c = window.__ix;
          w.signs.flush();
          const st = w.signs.stats();
          c.aim(dir.x - 0.35, dir.z - 0.55, dir.x, dir.y + 0.35, dir.z - 0.55);
          const gl = w.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
          const grab = () => { w.frame(); const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
          // the middle of the picture (the board fills it): mean and spread of the luminance (the type makes the spread)
          const stat = (b) => { let n = 0, s = 0, s2 = 0; for (let y = Math.floor(H * 0.25); y < H * 0.75; y += 3) for (let x = Math.floor(W * 0.25); x < W * 0.75; x += 3) { const i = (y * W + x) * 4, l = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2]; n++; s += l; s2 += l * l; } const m = s / n; return { mean: +m.toFixed(1), sd: +Math.sqrt(Math.max(0, s2 / n - m * m)).toFixed(1) }; };
          const diff = (a, b) => { let d = 0, n = 0; for (let i = 0; i < a.length; i += 28) { d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 3; } return +(d / n).toFixed(2); };
          for (let i = 0; i < 4; i++) w.frame();
          const a = grab(), a2 = grab();
          const e = w.signs.entries('directory')[0];
          const p0 = e.paints, textures0 = w.renderer.info.memory.textures;
          e.tex.needsUpdate = true;
          const b = grab();                                   // signs.pump draws and uploads it again before this frame's picture
          for (let i = 0; i < 3; i++) w.frame();
          const c2 = grab();
          return { canvasBytes: st.canvasBytes, canvases: st.list.filter((s) => s.canvas).map((s) => s.kind), ready: st.list.every((s) => s.ready), signs: st.list.length,
            before: stat(a), during: stat(b), after: stat(c2), noise: diff(a, a2), diffDuring: diff(a, b), diffAfter: diff(a, c2), paints: [p0, e.paints], freedAgain: !e.tex.image,
            textures: [textures0, w.renderer.info.memory.textures], pending: w.signs.pending };
        }, d.dir);
        rel.texWarnings = texWarnings.slice(0, 3);
        check('once on the graphics card the signs let their canvases go (only the textures stay)', rel.ready && rel.canvasBytes === 0, rel);
        check('a sign texture that is to go up again is drawn again and the board looks the same (never blank or black)',
          rel.paints[1] === rel.paints[0] + 1 && rel.freedAgain && rel.before.sd > 8 && rel.after.sd > 0.8 * rel.before.sd && rel.diffDuring <= rel.noise + 2 && rel.diffAfter <= rel.noise + 2 && rel.textures[0] === rel.textures[1] && !texWarnings.length, rel);
      }
    }
  }

  // ================================================================= 3. the hover follows the slot ==================================
  if (parts.includes('hover')) {
    await cc(() => {
      const w = window.__app.world;
      const n = (b) => b.rows.reduce((a, r) => a + r.items.length, 0);
      const bc = [...w.layout.bookcases].filter((b) => !b.recent).sort((a, b) => n(b) - n(a))[0];
      window.__hoverRow = bc.rows.filter((r) => r.items.length >= 6).sort((a, b) => b.items.length - a.items.length)[0];
    });
    // the slot under the crosshair, found independently: the nearest book box (at rest, not grown) along the view ray
    const sweeps = [];
    for (const dist of [0.8, 1.4]) {
      const setup = await cc((dist) => {
        const w = window.__app.world, row = window.__hoverRow;
        const a = w.books.entry(row.items[0].id), b = w.books.entry(row.items[row.items.length - 1].id);
        const mid = a.pos.clone().lerp(b.pos, 0.5), p = mid.clone().addScaledVector(a.forward, dist);
        return { x: p.x, z: p.z, yaw0: Math.atan2(a.forward.x, a.forward.z), half: Math.atan2(a.pos.distanceTo(b.pos) / 2 + 0.03, dist), pitch: Math.atan2(mid.y - 1.62, dist), ids: row.items.map((it) => it.id) };
      }, dist);
      const N = 240, seq = [];
      for (let i = 0; i <= N; i++) {
        const yaw = setup.yaw0 + setup.half - (2 * setup.half * i) / N;
        seq.push(await cc(([x, z, yaw, pitch, ids]) => {
          const w = window.__app.world, p = w.player;
          p.transition = null; p.setPose(x, z, yaw, pitch);
          w.frame(); w.actions.rayTimer = 0; w.actions.update(0);
          // the expected slot: the nearest book box of the row along the view ray (instances at rest)
          const ray = w.actions.raycaster.ray, B = new (w.camera.position.constructor)();
          const Box = w.actions.occluders[0].constructor;
          let best = null, bestD = Infinity, grown = false;
          const box = new Box(), inv = new w.camera.matrix.constructor(), r2 = ray.clone();
          for (const id of ids) {
            const e = w.books.entry(id); if (!e || e.hidden) continue;
            inv.copy(e.matrix).invert(); r2.copy(ray).applyMatrix4(inv);
            box.min.set(-0.5, -0.5, -0.5); box.max.set(0.5, 0.5, 0.5);
            const hit = r2.intersectBox(box, B); if (!hit) continue;
            const d = hit.applyMatrix4(e.matrix).distanceTo(ray.origin);
            if (d < bestD) { bestD = d; best = id; }
          }
          // inside the band where the previous target's slot, grown by 5 mm, still holds it
          const t = w.actions.target?.book?.id || null;
          if (t) { const e = w.books.entry(t); if (e) { const m = e.matrix.clone(); const s = new (w.camera.position.constructor)(e.w + 0.01, e.h + 0.01, e.d + 0.01); m.compose(e.pos, e.quat, s); inv.copy(m).invert(); r2.copy(ray).applyMatrix4(inv); grown = !!r2.intersectBox(box, B); } }
          const out = w.books.hoverMesh ? 1 : 0;
          return [t, best, grown, out];
        }, [setup.x, setup.z, yaw, setup.pitch, setup.ids]));
        await sleep(12);
      }
      const order = Object.fromEntries(setup.ids.map((id, i) => [id, i]));
      const runs = seq.map((s) => s[0]).filter((x, i, a) => x && x !== a[i - 1]);
      // a target that is not the slot under the crosshair is stale, unless the crosshair is in the 5 mm border of the
      // target's own slot: in the gap to its neighbour or just over the neighbour's edge
      const stale = seq.filter(([t, want, grown]) => t !== want && !(grown && (want == null || Math.abs((order[t] ?? -9) - (order[want] ?? -9)) === 1))).length;
      let back = 0; for (let i = 1; i < runs.length; i++) if (order[runs[i]] < order[runs[i - 1]]) back++;
      // a book is missed when its slot was under the crosshair outside the border band of its neighbour and it never
      // became the target (a narrow book can fall between two samples or into the band: that is no miss)
      const held = (st) => st[0] !== st[1] && st[2];          // the step falls into the border band of another book
      const missing = setup.ids.filter((id) => !runs.includes(id) && seq.some((st) => st[1] === id && !held(st)));
      // a missed book: how wide it is and what was targeted while its slot was under the crosshair
      const missed = await cc((ids) => ids.map((id) => { const e = window.__app.world.books.entry(id); return { id, w: e ? +e.w.toFixed(3) : null, hidden: !!e?.hidden }; }), missing);
      for (const m of missed) m.whileUnder = seq.filter((s) => s[1] === m.id).map((s) => [s[0] === m.id ? 'it' : s[0] ? 'other' : 'none', s[2]]);
      // (a book lower than its neighbours can stay under the line of the sweep: it is not under the crosshair then)
      const reachable = setup.ids.filter((id) => seq.some((st) => st[1] === id && !held(st))).length;
      sweeps.push({ dist, steps: N + 1, books: setup.ids.length, reachable, targets: runs.length, stale, backwards: back, revisits: runs.length - new Set(runs).size, missing: missing.length, missed, outWhileSweeping: seq.filter((s) => s[3]).length });
    }
    console.log('HOVER-SWEEP ' + JSON.stringify(sweeps));
    check('sweeping the crosshair along a row: every book under it becomes the target, in order', sweeps.every((s) => s.missing === 0 && s.targets >= s.reachable && s.reachable >= s.books * 0.9 && s.backwards === 0), sweeps);
    check('the target is always the slot under the crosshair (no stale target, only the 5 mm border band)', sweeps.every((s) => s.stale === 0), sweeps);
    check('no flicker or ping-pong at the slot borders (no book is targeted twice in one sweep)', sweeps.every((s) => s.revisits === 0), sweeps);

    // the case from a user's report: a book is out and turned to the viewer; the crosshair moves onto a neighbour that the cover hides
    const hidden = await cc(async () => {
      const w = window.__app.world, row = window.__hoverRow, p = w.player;
      const i0 = Math.floor(row.items.length / 2), A = w.books.entry(row.items[i0].id);
      const pos = A.pos.clone().addScaledVector(A.forward, 0.85);
      p.transition = null; p.setPose(pos.x, pos.z, Math.atan2(A.forward.x, A.forward.z), Math.atan2(A.pos.y - 1.62, 0.85));
      const look = (target) => { p.update(0.001); w.camera.updateMatrixWorld(); const d = target.clone().sub(w.camera.position).normalize(); p.yaw = Math.atan2(-d.x, -d.z); p.pitch = Math.asin(d.y); p.update(0.001); w.camera.updateMatrixWorld(); w.actions.rayTimer = 0; w.actions.update(0); return w.actions.target?.book?.id || null; };
      const front = (e) => e.pos.clone().addScaledVector(e.forward, e.d / 2 - 0.004);
      const first = look(front(A));
      for (let i = 0; i < 30; i++) { w.books.update(0.03, w.camera); w.frame(); await new Promise((r) => setTimeout(r, 10)); }
      const out = { mesh: !!w.books.hoverMesh, entry: w.books.hoverEntry?.book.id === A.book.id };
      // the neighbours whose spine lies behind the turned cover, seen from here
      const m = w.books.hoverMesh; m.updateMatrixWorld();
      const RC = w.actions.raycaster.constructor, rc = new RC();
      const res = [];
      for (const k of [i0 - 3, i0 - 2, i0 - 1, i0 + 1, i0 + 2, i0 + 3]) {
        const it = row.items[k]; if (!it) continue;
        const B = w.books.entry(it.id), aim = front(B);
        rc.set(w.camera.position, aim.clone().sub(w.camera.position).normalize());
        const behindCover = rc.intersectObject(m, false).length > 0;
        if (!behindCover) continue;
        const t = look(aim);
        res.push({ k: k - i0, behindCover, target: t === B.book.id, stale: t === A.book.id });
        // back onto the book that is out (it stays the target while the crosshair is on its slot)
        look(front(A));
      }
      return { first: first === A.book.id, out, res };
    });
    check('a hovered book comes out and turns its cover to the viewer', hidden.first && hidden.out.mesh && hidden.out.entry, hidden.out);
    check('the crosshair over a neighbour hidden behind the turned cover makes that neighbour the target at once', hidden.res.length >= 2 && hidden.res.every((r) => r.target && !r.stale), hidden.res);
    await cc(() => { const w = window.__app.world; for (let i = 0; i < 20; i++) w.frame(); });
    await shot('ix-hover-switched');
  }

  // ================================================================= 4. jumping onto things ========================================
  if (parts.includes('jump')) {
    // onto the reading table in the hall (1.6, -2.4, top 0.76, 2.5 × 1.15 m): from its east end, walking west, a jump
    const onto = await cc(() => {
      const c = window.__ix, w = window.__app.world, p = w.player;
      c.aim(3.6, -2.2, 0, 1.2, -2.2);
      const n0 = c.sfx.length, cams = [];
      c.key('KeyW');
      let maxStep = 0, last = w.camera.position.y, landedAt = null;
      for (let i = 0; i < 70; i++) {
        if (i === 10) c.press('Space');
        p.update(1 / 60);
        const y = w.camera.position.y; maxStep = Math.max(maxStep, Math.abs(y - last)); last = y; cams.push(+y.toFixed(3));
        if (landedAt == null && p.ground > 0.5) landedAt = i;
      }
      c.key('KeyW', 'keyup'); c.step(30);
      return { ...c.state(), maxCamStep: +maxStep.toFixed(3), landedAt, sounds: c.sfx.slice(n0) };
    });
    check('a jump at the reading table lands on top of it (0.76 m) and stays there', onto.ground === 0.76 && Math.abs(onto.eye - (1.62 + 0.76)) < 0.002 && onto.air == null, onto);
    // (the take-off itself moves the eye 6.3 cm a frame at 60 fps: anything above that would be a jump in the picture)
    check('the camera rises smoothly onto the table (no step over 7 cm between frames at 60 fps)', onto.maxCamStep < 0.07, onto);
    // the view from up there: along the table to its lamp and chairs
    await cc(() => { const w = window.__app.world; w.player.yaw = -Math.PI / 2 - 0.25; w.player.pitch = -0.55; w.player.update(0.001); for (let i = 0; i < 6; i++) w.frame(); });
    await shot('ix-jump-on-table');
    // a full rebuild of the world (here: another quality tier) keeps you up there
    const rebuilt = await cc(async () => {
      const w = window.__app.world, p = w.player, api = window.__app.ctx.api, g = window.__app.state.settings.graphics || {};
      const before = window.__ix.state(), n0 = (w.buildTimes || []).length;
      await api.settings.set({ graphics: { ...g, quality: 'medium' } });
      await new Promise((r) => setTimeout(r, 1500));
      for (let i = 0; i < 20; i++) p.update(1 / 60);
      const after = window.__ix.state();
      await api.settings.set({ graphics: { ...g, quality: 'high' } });
      await new Promise((r) => setTimeout(r, 1500));
      for (let i = 0; i < 20; i++) p.update(1 / 60);
      return { before, after, back: window.__ix.state(), builds: (w.buildTimes || []).length - n0 };
    });
    check('a rebuild of the world while you stand on the table keeps you on it', rebuilt.builds >= 2 && rebuilt.after.ground === 0.76 && rebuilt.back.ground === 0.76 && Math.abs(rebuilt.after.x - rebuilt.before.x) < 1e-3, rebuilt);
    const off = await cc(() => {
      const c = window.__ix, w = window.__app.world, p = w.player;
      p.yaw = -Math.PI / 2; p.pitch = 0;                        // east: back over the table's end at x = 2.85
      const n0 = c.sfx.length;
      c.key('KeyW');
      let fellAt = null, landedAt = null, minCam = Infinity;
      for (let i = 0; i < 90; i++) {
        p.update(1 / 60);
        if (fellAt == null && p.air) fellAt = i;
        if (fellAt != null && landedAt == null && !p.air) landedAt = i;
        minCam = Math.min(minCam, w.camera.position.y);
      }
      c.key('KeyW', 'keyup'); c.step(40);
      return { ...c.state(), fall: fellAt != null && landedAt != null ? +((landedAt - fellAt) / 60).toFixed(3) : null, sounds: c.sfx.slice(n0), free: p.isFree(p.position.x, p.position.z, 0) };
    });
    check('walking off the edge of the table falls with gravity (about 0.36 s) and lands on the floor with a step', off.ground === 0 && off.eye === 1.62 && off.fall >= 0.3 && off.fall <= 0.45 && off.sounds.includes('footstep') && off.free, off);

    // a bookcase: walking into it and jumping, also from a running start, never gets you up
    const bookcase = await cc(() => {
      const c = window.__ix, w = window.__app.world, p = w.player;
      const bc = w.layout.bookcases.find((b) => !b.recent && b.rot === 0) || w.layout.bookcases[0];
      const fx = Math.sin(bc.rot), fz = Math.cos(bc.rot);
      c.aim(bc.x + fx * 2.2, bc.z + fz * 2.2, bc.x, 1.4, bc.z);
      c.key('KeyW'); c.key('ShiftLeft');
      let maxGround = 0, maxFeet = 0;
      for (let i = 0; i < 160; i++) { if (i % 20 === 5) c.press('Space'); p.update(1 / 60); maxGround = Math.max(maxGround, p.ground); maxFeet = Math.max(maxFeet, p.feet); }
      c.key('KeyW', 'keyup'); c.key('ShiftLeft', 'keyup'); c.step(60);
      const dist = Math.hypot(p.position.x - bc.x, p.position.z - bc.z);
      return { maxGround, maxFeet: +maxFeet.toFixed(3), dist: +dist.toFixed(2), ...c.state() };
    });
    check('no jump onto a bookcase (it stops you at any height)', bookcase.maxGround === 0 && bookcase.ground === 0 && bookcase.dist > 0.7, bookcase);

    // everything walkable and everything reached: a jump at every piece of low furniture from in front of it
    const pieces = await cc(() => {
      const c = window.__ix, w = window.__app.world, p = w.player;
      const out = [];
      const kinds = ['table', 'desk', 'sideboard', 'displaytable', 'sidetable', 'chair', 'armchair', 'sofa', 'windowbench', 'lounger', 'planter', 'returncounter', 'cardcatalog', 'newsrack', 'lectern', 'fireplace', 'bookcase'];
      const seen = new Set();
      for (const pl of w.layout.placements) {
        const key = ['sidetable', 'chair', 'armchair'].includes(pl.kind) ? pl.kind + pl.x.toFixed(2) + pl.z.toFixed(2) : pl.kind;
        if (!kinds.includes(pl.kind) || seen.has(key)) continue;
        seen.add(key);
        const col = w.colliders.find((k) => k.parts && Math.abs((k.min[0] + k.max[0]) / 2 - pl.x) < 0.01 && Math.abs((k.min[2] + k.max[2]) / 2 - pl.z) < 0.01) || null;
        const tops = col ? col.parts.filter((q) => q.walk) : [];
        const maxTop = tops.length ? Math.max(...tops.map((q) => q.top)) : null;
        // the spots up there where you would fit (lamps or a candle may stand on it); the middle of anything else
        const spots = [];
        for (const q of tops) for (const i of [0, -0.9, 0.9, -0.45, 0.45]) for (const j of [0, -0.9, 0.9, -0.45, 0.45]) {
          const lx = i * q.hx, lz = j * q.hz, x = q.x + lx * q.c + lz * q.s, z = q.z - lx * q.s + lz * q.c;
          if (p.supportAt(x, z, q.top + 1e-3) === q.top && p.fits(x, z, q.top)) spots.push([x, z]);
        }
        if (!tops.length) spots.push([pl.x, pl.z]);
        // walk at a spot from 1.3 m away (eight directions), jumping on the way; the best outcome counts
        let best = 0, tried = 0;
        for (const [tx, tz] of spots.slice(0, 4)) {
          for (let k = 0; k < 8 && best < 0.3; k++) {
            const a = k * Math.PI / 4, sx = tx + Math.sin(a) * 1.3, sz = tz + Math.cos(a) * 1.3;
            if (!p.isFree(sx, sz, 0.02)) continue;
            tried++;
            c.aim(sx, sz, tx, 0.8, tz);
            c.key('KeyW');
            for (let i = 0; i < 110; i++) { if (i === 12 || i === 60) c.press('Space'); p.update(1 / 60); best = Math.max(best, p.ground); }
            c.key('KeyW', 'keyup'); c.step(30);
            best = Math.max(best, p.ground);
          }
          if (best >= 0.3) break;
        }
        out.push({ kind: pl.kind, at: [+pl.x.toFixed(2), +pl.z.toFixed(2)], walkTop: maxTop != null ? +maxTop.toFixed(2) : null, spots: spots.length, reached: +best.toFixed(2), tried });
      }
      return out;
    });
    console.log('PIECES ' + JSON.stringify(pieces));
    const walkable = pieces.filter((x) => x.walkTop != null && x.tried);
    check('tables, desks, the sideboard, chairs, armchairs, the sofa, the window bench, loungers and planters can be jumped onto', ['table', 'desk', 'sideboard', 'chair', 'armchair', 'sofa', 'windowbench', 'lounger'].every((k) => walkable.some((x) => x.kind === k && x.reached > 0.3)), walkable);
    check('nothing above 0.9 m is ever reached (counters, cabinets, the rack, the fireplace, bookcases)', pieces.every((x) => x.reached <= 0.9) && pieces.filter((x) => ['returncounter', 'cardcatalog', 'newsrack', 'lectern', 'fireplace', 'bookcase'].includes(x.kind)).every((x) => x.reached === 0), pieces.filter((x) => x.walkTop == null));

    // small steps are climbed while walking, a step down needs no fall; a higher one stops you (a test top of 15 and 25 cm)
    const steps = await cc(() => {
      const c = window.__ix, w = window.__app.world, p = w.player;
      const mk = (x, z, top) => ({ min: [x - 0.4, 0, z - 0.4], max: [x + 0.4, top, z + 0.4], parts: [{ x, z, c: 1, s: 0, hx: 0.4, hz: 0.4, y0: 0, top, walk: true }] });
      const lo = mk(-0.8, -0.2, 0.15), hi = mk(-0.8, 3.4, 0.25);
      const list = p.colliders; list.push(lo, hi); p.colliders = list;
      try {
        c.aim(-0.8, 1.3, -0.8, 1.62, -3);
        const n0 = c.sfx.length;
        c.key('KeyW'); let maxStep = 0, last = w.camera.position.y, air = false;
        for (let i = 0; i < 45; i++) { p.update(1 / 60); maxStep = Math.max(maxStep, Math.abs(w.camera.position.y - last)); last = w.camera.position.y; air ||= !!p.air; }
        const on = c.state();
        for (let i = 0; i < 40; i++) { p.update(1 / 60); air ||= !!p.air; }
        c.key('KeyW', 'keyup'); c.step(20);
        const down = c.state();
        c.aim(-0.8, 2.3, -0.8, 1.62, 6);
        c.key('KeyW'); c.step(60); c.key('KeyW', 'keyup');
        const blocked = c.state();
        return { on, down, air, maxCamStep: +maxStep.toFixed(3), blocked, sounds: c.sfx.slice(n0) };
      } finally { list.splice(list.indexOf(lo), 1); list.splice(list.indexOf(hi), 1); p.colliders = list; }
    });
    check('a 15 cm step is climbed while walking (smoothly) and walked down again without a fall', steps.on.ground === 0.15 && steps.down.ground === 0 && !steps.air && steps.maxCamStep < 0.05, steps);
    check('a 25 cm top stops you while walking (the legs at 15 cm from its edge)', steps.blocked.ground === 0 && steps.blocked.z <= 3.4 - 0.4 - 0.14, steps.blocked);

    // up there the head keeps its clearance: every spot of every walkable top you can stand on, and a jump from there
    const heads = await cc(() => {
      const w = window.__app.world, p = w.player;
      const V3 = w.camera.position.constructor, Ray = w.actions.raycaster.constructor;
      const small = [];
      const walk = (o) => { if (o.userData?.batch) return; if (o.isMesh && !o.isInstancedMesh && o.geometry) { o.geometry.boundingBox || o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); if (bb.max.x - bb.min.x < 6 && bb.max.z - bb.min.z < 6) small.push({ o, bb }); } for (const ch of o.children) walk(ch); };
      w.static.updateMatrixWorld(true); walk(w.static);
      const rc = new Ray(); rc.far = 1.0;
      const dirs = [new V3(0, 1, 0)]; for (const el of [20, 50, 75]) for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, e = el * Math.PI / 180; dirs.push(new V3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a))); }
      const nearest = (x, y, z) => {
        const cand = small.filter((m) => m.bb.max.x > x - 1 && m.bb.min.x < x + 1 && m.bb.max.z > z - 1 && m.bb.min.z < z + 1 && m.bb.max.y > y - 0.2 && m.bb.min.y < y + 1).map((m) => m.o);
        let best = Infinity, what = null; const o = new V3(x, y, z);
        for (const d of dirs) { rc.set(o, d); const h = rc.intersectObjects(cand, false)[0]; if (h && h.distance < best) { best = h.distance; what = h.object.userData?.root?.userData?.placement?.kind || h.object.parent?.userData?.placement?.kind || h.object.name; } }
        return { d: best, what };
      };
      let spots = 0, bad = [], minClear = Infinity, minWhat = null;
      for (const q of p.walkParts) {
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
          const lx = i * q.hx * 0.8, lz = j * q.hz * 0.8;
          const x = q.x + lx * q.c + lz * q.s, z = q.z - lx * q.s + lz * q.c;
          if (p.supportAt(x, z, q.top + 1e-3) !== q.top || !p.fits(x, z, q.top)) continue;   // something higher there, or no room
          spots++;
          p.transition = null; p.setPose(x, z, 0, 0, q.top);
          const room = p.headroom(x, z);
          if (room < 0) { bad.push({ x: +x.toFixed(2), z: +z.toFixed(2), top: q.top, room: +room.toFixed(3) }); continue; }
          let apex = 0;
          if (p.jump()) { for (let k = 0; k < 120 && p.air; k++) { p.update(1 / 120); apex = Math.max(apex, p.air ? p.air.y : 0); } }
          const top = nearest(x, 1.62 + q.top + apex, z);
          if (top.d < minClear) { minClear = top.d; minWhat = top.what + ' at ' + x.toFixed(2) + ',' + z.toFixed(2); }
          if (top.d < 0.12) bad.push({ x: +x.toFixed(2), z: +z.toFixed(2), top: q.top, apex: +apex.toFixed(2), clear: +top.d.toFixed(3), what: top.what });
        }
      }
      p.setPose(0, 0, 0, 0);
      return { spots, bad: bad.slice(0, 6), badCount: bad.length, minClear: +minClear.toFixed(3), nearest: minWhat };
    });
    check('standing on any walkable top and jumping from there, nothing overhead comes within 12 cm of the eye', heads.spots > 40 && heads.badCount === 0, heads);

    // sitting down from the table: E on a chair within reach; standing up puts you on the floor
    const sit = await cc(() => {
      const c = window.__ix, w = window.__app.world, p = w.player;
      const s = w.seats.get('table1d'), o = s.obj.position;     // chair 4 of the hall's reading table
      c.aim(2.5, -2.4, o.x, 0.5, o.z, 0.76);                   // on the table, east of the lamp
      const t = c.look();
      c.press('KeyE');
      const r = { t, seated: !!p.seated, id: w.actions.seatedId };
      c.step(40, 0.05);
      r.eye = +p.position.y.toFixed(3);
      c.press('Space'); c.step(40, 0.05);
      r.after = { ...c.state(), free: p.isFree(p.position.x, p.position.z, 0), seated: !!p.seated };
      return r;
    });
    check('standing on the table, E on a chair within reach sits you down; standing up puts you on the floor', sit.t?.type === 'seat' && sit.seated && sit.id === 'table1d' && Math.abs(sit.eye - 1.22) < 0.15 && !sit.after.seated && sit.after.ground === 0 && sit.after.free, sit);

    // the sofa: the cushions carry you, the back stops you; the cat asleep on it is in the way up there
    const sofa = await cc(() => {
      const c = window.__ix, w = window.__app.world, p = w.player;
      const s = w.seats.get('sofa'), pl = s.obj.userData.placement;
      const fx = Math.sin(pl.rot), fz = Math.cos(pl.rot);       // the sofa faces local +z
      c.aim(pl.x + fx * 1.3, pl.z + fz * 1.3, pl.x, 0.6, pl.z);
      c.key('KeyW');
      let best = 0, maxBack = -Infinity;
      for (let i = 0; i < 120; i++) { if (i === 8) c.press('Space'); p.update(1 / 60); best = Math.max(best, p.ground); maxBack = Math.max(maxBack, -((p.position.x - pl.x) * fx + (p.position.z - pl.z) * fz)); }
      c.key('KeyW', 'keyup'); c.step(20);
      const r = { onSofa: +best.toFixed(2), behind: +maxBack.toFixed(2), ...c.state() };
      // the cat on the sofa: it stops you up there
      const cat = w.cat;
      if (cat) {
        const i = cat.spots.findIndex((sp) => sp.id === 'sofa');
        if (i >= 0) {
          cat.goTo(i, true); cat.nextMove = 1e9; w.frame();
          const cp = cat.group.position;
          // walk along the cushions towards it
          const ax = -fz, az = fx;                              // along the sofa
          const side = Math.sign((p.position.x - cp.x) * ax + (p.position.z - cp.z) * az) || 1;
          p.yaw = Math.atan2(side * ax, side * az);
          c.key('KeyW'); c.step(90); c.key('KeyW', 'keyup');
          r.cat = { y: +cp.y.toFixed(2), dist: +Math.hypot(p.position.x - cp.x, p.position.z - cp.z).toFixed(2), ground: p.ground, state: cat.state };
        }
      }
      return r;
    });
    check('the sofa cushions carry you (0.67 m), its back stops you', sofa.onSofa === 0.67 && sofa.behind < 0.2, sofa);
    if (sofa.cat) check('the cat asleep on the sofa is in the way of a player walking on it (the legs stop 15 cm from its 22 cm)', sofa.cat.ground > 0.5 && sofa.cat.dist >= 0.36, sofa.cat);
    await cc(() => { const c = window.__ix; c.aim(-0.8, 1.4, -0.8, 1.62, -3); });

    // the terrace: out through the glass doors, onto a lounger; the edge of the walkable garden stops you at any height
    const terrace = await cc(() => {
      const c = window.__ix, w = window.__app.world, p = w.player;
      c.aim(0, 3.8, 0, 1.62, 9);                              // in front of the doors, looking out
      c.key('KeyW');
      for (let i = 0; i < 200; i++) { w.updateDoor(1 / 60); p.update(1 / 60); }
      c.key('KeyW', 'keyup');
      const out = c.state();
      const l = w.seats.get('lounger2').obj.userData.placement;
      c.aim(l.x - 1.2, l.z, l.x, 0.4, l.z);
      c.key('KeyW'); let best = 0;
      for (let i = 0; i < 80; i++) { if (i === 10) c.press('Space'); w.updateDoor(1 / 60); p.update(1 / 60); best = Math.max(best, p.ground); }
      c.key('KeyW', 'keyup'); c.step(20);
      // the edge of the walkable garden (outdoor.js; 0.6): the split-rail fence along the meadow in the east, jumping
      const O = w.env.garden.outdoor;
      c.aim(23.6, 30, 40, 1.62, 30, p.groundAt(23.6, 30));
      c.key('KeyW'); let maxX = -Infinity, off = 0;
      for (let i = 0; i < 150; i++) { if (i % 25 === 3) c.press('Space'); p.update(1 / 60); maxX = Math.max(maxX, p.position.x); if (!O.inRegion(p.position.x, p.position.z, 0.3)) off++; }
      c.key('KeyW', 'keyup'); c.step(40);
      // and back in: the doors open again
      c.aim(0, 7.0, 0, 1.62, 0);
      c.key('KeyW');
      for (let i = 0; i < 260; i++) { w.updateDoor(1 / 60); p.update(1 / 60); }
      c.key('KeyW', 'keyup');
      return { out, lounger: +best.toFixed(2), maxX: +maxX.toFixed(2), off, back: c.state() };
    });
    check('out through the glass doors onto the terrace and onto a lounger (0.36 m), and back in', terrace.out.z > 6.3 && terrace.lounger === 0.36 && terrace.back.z < 4.5, terrace);
    check('the edge of the walkable garden stops you, also when you jump at it', terrace.off === 0 && terrace.maxX < 27.2, terrace);
    await cc(() => { const c = window.__ix; c.aim(-0.8, 1.4, -0.8, 1.62, -3); });
  }

  // ================================================================= 5. the clock =================================================
  if (parts.includes('clock')) {
    const clock = await cc(async () => {
      const w = window.__app.world, hands = w.wallClock?.userData.hands;
      if (!hands) return { missing: true };
      const out = [];
      // with the world at a fixed hour and in the day cycle: the clock keeps the time of the computer
      for (const [mode, hour] of [['fixed', 15], ['fixed', 3.5], ['cycle', null]]) {
        w.settings = { ...w.settings, timeMode: mode, fixedHour: hour ?? w.settings.fixedHour };
        w.frame();
        const d = new Date();
        const s = d.getSeconds(), m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60, TAU = Math.PI * 2;
        const diff = (a, b) => { let x = (a - b) % TAU; if (x > Math.PI) x -= TAU; if (x < -Math.PI) x += TAU; return Math.abs(x) * 180 / Math.PI; };
        out.push({ mode, hour, worldHour: +w.currentHour().toFixed(2), time: d.toTimeString().slice(0, 8), hourOff: +diff(hands.hour.rotation.z, -h / 12 * TAU).toFixed(2), minOff: +diff(hands.min.rotation.z, -m / 60 * TAU).toFixed(2), secOff: hands.sec ? +diff(hands.sec.rotation.z, -s / 60 * TAU).toFixed(2) : null });
        await new Promise((r) => setTimeout(r, 1100));
      }
      // the second hand moves on with the seconds
      const a0 = hands.sec?.rotation.z; await new Promise((r) => setTimeout(r, 2100)); w.frame();
      const moved = !!hands.sec && Math.abs(hands.sec.rotation.z - a0) > 0.1;
      return { out, moved };
    });
    check('the wall clock shows the time of the computer (hour, minute and second hand), whatever hour the world shows', !clock.missing && clock.out.every((o) => o.hourOff < 0.5 && o.minOff < 0.5 && o.secOff != null && o.secOff < 6.1) && clock.moved, clock);
    await cc(() => {
      const w = window.__app.world, c = window.__ix, o = w.wallClock; const pp = o.getWorldPosition(o.position.clone());
      c.aim(pp.x + 1.1, pp.z, pp.x, pp.y, pp.z); w.player.position.y = 2.2; w.player.update(0.001);
      w.player.pitch = Math.atan2(pp.y - w.camera.position.y, 1.1); w.player.update(0.001); for (let i = 0; i < 6; i++) w.frame();
    });
    await shot('ix-clock');
    await cc(() => { const c = window.__ix; c.aim(-0.8, 1.4, -0.8, 1.62, -3); });
  }

  // ================================================================= 6. books at the seat ==========================================
  if (parts.includes('tablebooks')) {
    const sitAt = (id) => cc(async (id) => {
      const w = window.__app.world, p = w.player, s = w.seats.get(id);
      p.transition = null; p.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0);
      w.actions.sit(id);
      for (let i = 0; i < 30; i++) { p.update(0.05); w.actions.update(0.05); }
      await new Promise((r) => setTimeout(r, 450));            // the books are laid out 0.3 s after sitting down
      for (let i = 0; i < 40; i++) w.actions.update(0.05);
      w.scene.updateMatrixWorld();
      return { seated: w.actions.seatedId, table: [...w.actions.tableBooks.keys()], open: [...w.actions.tableBooks.values()].map((t) => t.open), basket: [...w.actions.basket] };
    }, id);
    const ids = await cc(() => {
      const w = window.__app.world;
      const list = [...w.books.entries.values()].filter((e) => !e.hidden && !w.actions.basket.includes(e.book.id)).map((e) => e.book.id);
      return list.slice(0, 4);
    });
    await cc(async (ids) => { const w = window.__app.world; for (const id of ids.slice(0, 3)) await w.actions.takeBook(id, { silent: true }); for (let i = 0; i < 60; i++) w.actions.update(0.05); }, ids);
    const def = await cc(() => window.__app.state.settings.lastBookAtSeat);
    const r0 = await sitAt('table1a');
    check('by default no book lies in front of you when you sit down (three in the basket)', def !== true && r0.seated === 'table1a' && r0.table.length === 0 && r0.basket.length >= 3, { def, ...r0 });
    await cc(() => { const w = window.__app.world; w.actions.stand(); for (let i = 0; i < 30; i++) w.player.update(0.05); });

    // read a book (the reader opens and closes again) and put it back on its shelf: the book opened last, not in the basket
    const X = ids[3];
    await cc((id) => window.__app.ctx.bus.emit('book:open', { id }), X);
    await sleep(4000);
    await cc(() => window.__app.closeAllPanels());
    await sleep(2500);
    await cc(async (id) => { const w = window.__app.world; w.actions.returnBook(id, { animate: false }); for (let i = 0; i < 30; i++) w.actions.update(0.05); }, X);
    const last = await cc(() => window.__app.world.actions.lastOpened());
    await cc(() => window.__app.ctx.api.settings.set({ lastBookAtSeat: true }));
    await sleep(800);
    const r1 = await sitAt('roomchair1');
    const shelf = await cc((id) => { const e = window.__app.world.books.entry(id); return e ? { hidden: e.hidden } : null; }, X);
    check('with the setting on, only the book opened last lies there, also when it is not in the basket', last === X && r1.table.length === 1 && r1.table[0] === X && !r1.basket.includes(X), { last, X, ...r1 });
    check('the book on the table is not on its shelf at the same time', !shelf || shelf.hidden, shelf);
    await cc((id) => {
      const w = window.__app.world, p = w.player, tb = w.actions.tableBooks.get(id); if (!tb) return;
      for (let i = 0; i < 20; i++) w.actions.update(0.05);
      const m = tb.mesh.position, eye = w.camera.position;
      p.yaw = Math.atan2(-(m.x - eye.x), -(m.z - eye.z)); p.pitch = Math.atan2(m.y - eye.y, Math.hypot(m.x - eye.x, m.z - eye.z));
      p.update(0.001); for (let i = 0; i < 10; i++) w.frame();
    }, X);
    await shot('ix-tablebook-armchair');
    // its actions: aimed at it shows its card, F the info, E opens it, R puts it back on the shelf
    const acts = await cc(async (id) => {
      const w = window.__app.world, p = w.player, c = window.__ix;
      const tb = w.actions.tableBooks.get(id); const m = tb.mesh.position, eye = w.camera.position;
      p.yaw = Math.atan2(-(m.x - eye.x), -(m.z - eye.z)); p.pitch = Math.atan2(m.y - eye.y, Math.hypot(m.x - eye.x, m.z - eye.z));
      const t = c.look();
      c.press('KeyF');
      await new Promise((r) => setTimeout(r, 1200));
      const info = c.panels();
      window.__app.closeAllPanels();
      return { t, info };
    }, X);
    check('the book at the seat is a target: F shows its info', acts.t?.type === 'tablebook' && acts.t.book === X && acts.info.includes('bookinfo'), acts);
    await sleep(900);
    await cc(() => { const w = window.__app.world; window.__ix.look(); window.__ix.press('KeyE'); });
    await sleep(4000);
    const opened = await cc(() => window.__ix.panels());
    await cc(() => window.__app.closeAllPanels());
    await sleep(2500);
    const afterRead = await cc((id) => { const w = window.__app.world, tb = w.actions.tableBooks.get(id); return { open: !!tb?.open, seated: !!w.player.seated, table: [...w.actions.tableBooks.keys()] }; }, X);
    check('E opens it in the reader; after reading it lies open in front of you', opened.includes('reader') && afterRead.open && afterRead.seated && afterRead.table.length === 1, { opened, afterRead });
    await cc(() => { const w = window.__app.world; for (let i = 0; i < 10; i++) w.frame(); });
    await shot('ix-tablebook-open');
    // the open pages read the right way up from the seat: the top of the text (the open book's local -z) points away
    const facing = await cc((id) => {
      const w = window.__app.world, tb = w.actions.tableBooks.get(id), V = w.camera.position.constructor;
      const top = new V(0, 0, -1).applyQuaternion(tb.mesh.getWorldQuaternion(tb.mesh.quaternion.clone()));
      const fwd = w.camera.getWorldDirection(new V());
      top.y = 0; fwd.y = 0; top.normalize(); fwd.normalize();
      return { dot: +top.dot(fwd).toFixed(3), open: !!tb.open };
    }, X);
    check('the open book reads the right way up from the seat (the top of its pages points away from you)', facing.open && facing.dot > 0.7, facing);
    const back = await cc(async (id) => {
      const w = window.__app.world, c = window.__ix, p = w.player;
      const tb = w.actions.tableBooks.get(id); const m = tb.mesh.position, eye = w.camera.position;
      p.yaw = Math.atan2(-(m.x - eye.x), -(m.z - eye.z)); p.pitch = Math.atan2(m.y - eye.y, Math.hypot(m.x - eye.x, m.z - eye.z));
      c.look(); c.press('KeyR');
      for (let i = 0; i < 40; i++) w.actions.update(0.05);
      const e = w.books.entry(id);
      return { table: [...w.actions.tableBooks.keys()], basket: w.actions.basket.includes(id), shelfHidden: e ? e.hidden : null };
    }, X);
    check('R puts it back on its shelf (off the table, out of the basket, on the shelf again)', back.table.length === 0 && !back.basket && back.shelfHidden === false, back);
    // setting off again: read a basket book at the seat, it stays open there; standing up and sitting elsewhere clears the table
    await cc(() => window.__app.ctx.api.settings.set({ lastBookAtSeat: false }));
    await sleep(800);
    const Y = ids[0];
    await cc((id) => window.__app.ctx.bus.emit('book:open', { id }), Y);
    await sleep(4000);
    await cc(() => window.__app.closeAllPanels());
    await sleep(2500);
    const readHere = await cc(() => { const w = window.__app.world; return { table: [...w.actions.tableBooks.keys()], open: [...w.actions.tableBooks.values()].map((t) => t.open), seated: w.actions.seatedId }; });
    check('setting off: a book read at the seat lies open in front of you afterwards', readHere.table.length === 1 && readHere.table[0] === Y && readHere.open[0] && readHere.seated === 'roomchair1', readHere);
    await cc(() => { const w = window.__app.world; w.actions.stand(); for (let i = 0; i < 30; i++) w.player.update(0.05); });
    const r2 = await sitAt('table1b');
    check('setting off: sitting down elsewhere, nothing lies there', r2.table.length === 0, r2);
    await cc(() => { const w = window.__app.world; w.actions.stand(); for (let i = 0; i < 30; i++) w.player.update(0.05); });
  }

  check('no uncaught errors in the renderer', errors.length === 0, errors.slice(0, 5));
  const failed = results.filter((r) => !r.ok);
  console.log(`INTERIOR-CHECK ${results.length - failed.length}/${results.length} passed` + (failed.length ? ' · failed: ' + failed.map((f) => f.name).join(' | ') : ''));
};
