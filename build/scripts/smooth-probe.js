// How smooth the god rays are (godrays.js): numbers and image sequences for the strand "smooth". At a few views in the
// golden hour the world is drawn for N frames with a fixed step of time (the leaves sway, the dust drifts), each frame
// once with the rays and once more without at the same instant (the pass left alone, nothing added); the rays' share
// of the linear picture (on minus off, before tone mapping, without the vignette) and of the 8-bit one, and the rays'
// own low-resolution buffer are read back each frame. Reported per view and sequence, relative to the mean share:
//   flick      the mean change of the linear share from one frame to the next
//   still      the same over the pixels whose picture (without rays) did not change: what flickers although nothing
//              moved there (the reeds and leaves that sway change their share with right)
//   flick8     the change of the 8-bit share (what the eye sees, with the sway)
//   lowFlick   the change of the low-resolution buffer
//   rough      the fine detail of the linear share (its distance from a 3 × 3 box mean) where the picture is smooth
//   turning    the same while the view turns by a step each frame: the last frame is reprojected exactly (a turn in
//              place leaves the rays the same for every direction), so what is left is crawl, not motion
//   scene      the change of the picture without rays (relative to its mean), whole and in SM_REGION: with the time
//              still (SM_FROZEN=1) and the view turning this is the shimmer of edges and the sparkle of highlights
// Pictures (SHOT_DIR): the window with the rays, the rays' share (×4), its change between two frames (×8), the
// low-resolution buffer. The numbers go to <tag>-metrics.json. Env: SM_TIER=high|medium, SM_FRAMES=12, SM_STEP=2
// (pixels at the centre per frame while turning), SM_VIEWS=jetty,meadow,hall,south,shore,close or 'name:x:z:yaw:pitch;…',
// SM_TAG, SM_W/SM_H (1600 × 900), SM_HOUR (an hour instead of the golden hour), SM_WEATHER (clear),
// SM_DUMP=x,y,w,h (the raw low buffer in that region as JSON).
//   node build/screenshot.js smooth-probe
const fs = require('fs');
const path = require('path');

const VIEWS = {
  jetty: [-22, 37, 2.15, 0.02], meadow: [10, 25, 2.9, 0.06], hall: [7, -3, 1.75, 0.1], south: [0, -4.6, Math.PI, 0.1],
  // towards the sun over the lake from the shore path, the far birches in the light
  shore: [-8, 28, 2.55, 0.04],
  // looking up into a crown with the sun behind it (set SM_HOUR for a higher sun)
  close: [6.5, 29.5, 2.67, 0.35],
};

module.exports = async ({ app, page, shot, sleep }) => {
  const W = +process.env.SM_W || 1600, H = +process.env.SM_H || 900;
  const N = +process.env.SM_FRAMES || 12, STEP = +process.env.SM_STEP || 2;
  const tier = process.env.SM_TIER || 'high', tag = process.env.SM_TAG || `sm-${tier}`;
  const weather = process.env.SM_WEATHER || 'clear', hour = process.env.SM_HOUR ? +process.env.SM_HOUR : null;
  const outDir = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const views = (process.env.SM_VIEWS || 'jetty,meadow,hall,south').split(/[;,]/).filter(Boolean).map((s) => {
    const p = s.split(':');
    return p.length >= 4 ? { name: p[0], pose: p.slice(1, 5).map(Number) } : { name: s, pose: VIEWS[s] };
  }).filter((v) => v.pose);
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [W, H]);
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(2000);
  await page.evaluate(() => { window.__app.world.stop(); window.__app.closeAllPanels(); document.querySelector('#hud')?.style.setProperty('opacity', '0'); });
  await page.evaluate(([weather, hour, tier, dump, region, frozen, emu]) => {
    const w = window.__app.world;
    const t = hour == null ? { timeMode: 'golden' } : { timeMode: 'fixed', fixedHour: hour };
    w.applySettings({ ...w.settings, weather, ...t, graphics: { ...w.settings.graphics, quality: tier, bloom: true, shadows: true, ssao: tier === 'high', resolutionScale: 1, fov: 72, godrays: true } });
    // a fixed step of time: the same sway of the leaves and drift of the dust in every run
    window.__smDt = 1 / 60;
    w.clock.getDelta = () => window.__smDt;
    // no vignette: the rays' share is then the same for a direction whichever way the view turns
    w.vignette.uniforms.uStrength.value = 0; w.vignette.uniforms.uWarm.value = 0;
    // the old window shafts and the motes stay out of the measure (the rays' share alone); a frame "without" the rays
    // leaves the pass's state alone (its history, its jitter) and adds nothing to the picture
    const g = w.godrays, orig = g.beforeRender.bind(g);
    g.beforeRender = (dt) => {
      orig(dt); w.env.shafts.visible = false; g.motes.points.visible = false;
      if (window.__smOff) { g.pass.enabled = false; g.pass.compU.uGrColor.value.setScalar(0); }
    };
    // the picture before tone mapping (linear): the buffer the output pass reads
    const op = w.output, origOut = op.render;
    op.render = function (r, wb, rb, ...a) { window.__smLin = rb; return origOut.call(this, r, wb, rb, ...a); };
    window.__smDump = dump; window.__smRegion = region; window.__smFrozen = frozen;
    // SM_EMU=2560x1440: a window larger than the screen is cut to it, so the drawing buffer is scaled up instead (the
    // composer keeps the pixel ratio it was made with, so it is told as well; as godrays-check does)
    if (emu) { const pr = emu[0] / innerWidth; w.renderer.setPixelRatio(pr); w.renderer.setSize(innerWidth, innerHeight, false); w.composer.setPixelRatio(pr); }
  }, [weather, hour, tier, process.env.SM_DUMP ? process.env.SM_DUMP.split(',').map(Number) : null, process.env.SM_REGION ? process.env.SM_REGION.split(',').map(Number) : null, !!process.env.SM_FROZEN, process.env.SM_EMU ? process.env.SM_EMU.split('x').map(Number) : null]);

  const measure = (pose, turnPx, frames, saveTag) => page.evaluate(async ([pose, turnPx, frames, saveTag]) => {
    const w = window.__app.world, g = w.godrays, r = w.renderer, gl = r.getContext(), p = w.player, cam = w.camera;
    if (w.actions.seatedId) w.actions.leaveSeat?.();
    p.transition = null; p.setPose(pose[0], pose[1], pose[2], pose[3]);
    for (let i = 0; i < 40; i++) w.updateDoor(0.05);
    window.__smDt = 1 / 60;
    g.enabled = true;
    for (let i = 0; i < 30; i++) { w.frame(); if (i === 2) g.settle(); await new Promise((res) => setTimeout(res, 8)); }
    g.strength = Math.max(g.strength, w.env.rays || 0);
    const cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight, n = cw * ch;
    // the turn: so many pixels at the centre of the picture per frame
    const f = cw / (2 * Math.tan(cam.fov * Math.PI / 360) * cam.aspect);
    const turnStep = turnPx ? Math.atan(turnPx / f) : 0;
    const rgba = new Uint8Array(n * 4);
    const lum = () => { gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, rgba); const out = new Float32Array(n); for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = 0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2]; return out; };
    // the rays' own buffer (the one the composite reads: after the blur and the temporal blend, if there is one)
    const lowRt = () => g.pass.compU.tGrRays.value ? [g.pass.rtA, g.pass.rtB, ...(g.pass.hist || [])].find((t) => t.texture === g.pass.compU.tGrRays.value) || g.pass.rtA : g.pass.rtA;
    const lw = g.pass.rtA.width, lh = g.pass.rtA.height, ln = lw * lh;
    const lowBuf = new Float32Array(ln * 4);
    const low = () => { const rt = lowRt(), prev = r.getRenderTarget(); r.setRenderTarget(rt); gl.readPixels(0, 0, lw, lh, gl.RGBA, gl.FLOAT, lowBuf); r.setRenderTarget(prev); const out = new Float32Array(ln); for (let i = 0; i < ln; i++) out[i] = lowBuf[i * 4]; return out; };
    // the linear picture (before tone mapping) from the composer's buffer: its resolved framebuffer, bound by hand
    const linBuf = new Float32Array(n * 4);
    const linear = () => {
      const rt = window.__smLin; if (!rt) return null;
      const fb = r.properties.get(rt).__webglFramebuffer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.FLOAT, linBuf); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const out = new Float32Array(n); for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = 0.2126 * linBuf[j] + 0.7152 * linBuf[j + 1] + 0.0722 * linBuf[j + 2]; return out;
    };
    const shares = [], lows = [], shotsOn = [], linShares = [], offs = [], cams = [];
    for (let fr = 0; fr < frames; fr++) {
      if (turnStep) p.yaw += turnStep;
      // with the rays (time goes on, unless frozen), then without at the same instant
      window.__smDt = fr === 0 || window.__smFrozen ? 0 : 1 / 60; g.enabled = true; g.strength = Math.max(g.strength, w.env.rays || 0); w.frame();
      const on = lum(), lo = low(), onL = linear();
      cams.push({ invProj: cam.projectionMatrixInverse.toArray(), world: cam.matrixWorld.toArray(), proj: cam.projectionMatrix.toArray(), view: cam.matrixWorldInverse.toArray() });
      if (fr < 3) { const c = document.createElement('canvas'); c.width = cw; c.height = ch; const id = c.getContext('2d').createImageData(cw, ch); for (let i = 0; i < n * 4; i += 4) { id.data[i] = rgba[i]; id.data[i + 1] = rgba[i + 1]; id.data[i + 2] = rgba[i + 2]; id.data[i + 3] = 255; } c.getContext('2d').putImageData(id, 0, 0); shotsOn.push(c.toDataURL('image/png')); }
      window.__smDt = 0; window.__smOff = true; w.frame(); window.__smOff = false;
      const off = lum(), offL = linear();
      const share = new Float32Array(n); for (let i = 0; i < n; i++) share[i] = on[i] - off[i];
      shares.push(share); lows.push(lo); offs.push(offL);
      const s = new Float32Array(n); for (let i = 0; i < n; i++) s[i] = onL[i] - offL[i]; linShares.push(s);
    }
    g.enabled = true; g.strength = Math.max(g.strength, w.env.rays || 0);
    // the last frame's picture where this frame's pixel looks (a turn in place: the same direction), bilinear
    const m4 = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3], m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3]];
    // (the same turn every frame: the map from this frame's pixels to the last frame's is made once)
    let map = null;
    const mapFor = (now, before) => {
      const out = new Float32Array(n * 2).fill(-1);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const v = m4(now.invProj, [(x + 0.5) / cw * 2 - 1, (y + 0.5) / ch * 2 - 1, 1, 1]);
        const pw = m4(now.world, [v[0] / v[3], v[1] / v[3], v[2] / v[3], 1]);
        const c = m4(before.proj, m4(before.view, pw));
        if (c[3] <= 0) continue;
        out[(y * cw + x) * 2] = (c[0] / c[3] * 0.5 + 0.5) * cw - 0.5; out[(y * cw + x) * 2 + 1] = (c[1] / c[3] * 0.5 + 0.5) * ch - 0.5;
      }
      return out;
    };
    const reproject = (img, now, before) => {
      if (!turnStep) return img;
      map ||= mapFor(now, before);
      const out = new Float32Array(n).fill(NaN);
      for (let i = 0; i < n; i++) {
        const px = map[i * 2], py = map[i * 2 + 1];
        const x0 = Math.floor(px), y0 = Math.floor(py);
        if (x0 < 0 || y0 < 0 || x0 + 1 >= cw || y0 + 1 >= ch) continue;
        const fx = px - x0, fy = py - y0, j = y0 * cw + x0;
        out[i] = (img[j] * (1 - fx) + img[j + 1] * fx) * (1 - fy) + (img[j + cw] * (1 - fx) + img[j + cw + 1] * fx) * fy;
      }
      return out;
    };
    // the mean linear share: the unit of the numbers
    let lm = 0; for (const s of linShares) for (let i = 0; i < n; i++) lm += s[i]; lm /= n * linShares.length;
    const flick = [], still = [], flick8 = [], stillShare = [], scene = [], sceneRegion = [], sceneChange = new Float32Array(n);
    let stillPart = 0, om = 0;
    for (const o of offs) for (let i = 0; i < n; i++) om += o[i]; om /= n * offs.length;
    // SM_REGION=x0,y0,x1,y1 (fractions of the picture, from the top): the scene's change there (the lake, a crown)
    const reg = window.__smRegion, rx0 = reg ? Math.round(reg[0] * cw) : 0, rx1 = reg ? Math.round(reg[2] * cw) : cw, ry0 = reg ? Math.round((1 - reg[3]) * ch) : 0, ry1 = reg ? Math.round((1 - reg[1]) * ch) : ch;
    for (let fr = 1; fr < frames; fr++) {
      const a = linShares[fr], b = reproject(linShares[fr - 1], cams[fr], cams[fr - 1]);
      const oa = offs[fr], ob = reproject(offs[fr - 1], cams[fr], cams[fr - 1]);
      const a8 = shares[fr], b8 = reproject(shares[fr - 1], cams[fr], cams[fr - 1]);
      let s = 0, c = 0, ss = 0, sc = 0, s8 = 0, so = 0, sr = 0, cr = 0;
      for (let i = 0; i < n; i++) {
        if (Number.isNaN(b[i])) continue;
        const d = Math.abs(a[i] - b[i]); s += d; s8 += Math.abs(a8[i] - b8[i]); c++;
        // the picture without rays: its own change (sway, sparkle, shimmer of edges), whole and in the region
        const od = Math.abs(oa[i] - ob[i]); so += od;
        const x = i % cw, y = (i / cw) | 0;
        if (x >= rx0 && x < rx1 && y >= ry0 && y < ry1) { sr += od; cr++; }
        // the picture itself the same here (within half a percent, a little more where it is dark)
        if (od < 0.005 * Math.max(oa[i], 0.05)) { ss += d; sc++; }
      }
      flick.push(s / c / lm); still.push(ss / Math.max(sc, 1) / lm); flick8.push(s8 / c); stillPart += sc / c / (frames - 1);
      scene.push(so / c / om); sceneRegion.push(sr / Math.max(cr, 1) / om);
      if (fr === 1) { for (let i = 0; i < n; i++) { stillShare[i] = Number.isNaN(b[i]) ? 0 : Math.abs(a[i] - b[i]); sceneChange[i] = Number.isNaN(ob[i]) ? 0 : Math.abs(oa[i] - ob[i]); } }
    }
    // the low buffer: its change frame to frame relative to its mean (no reprojection: the whole-pixel shift at the
    // centre, when turning)
    let lmean = 0; for (const l of lows) for (let i = 0; i < ln; i++) lmean += l[i] / (ln * lows.length);
    const lflick = [], sh = turnStep ? Math.round(turnPx * lw / cw) : 0;
    for (let fr = 1; fr < lows.length; fr++) { let s = 0, c = 0; const a = lows[fr], b = lows[fr - 1]; for (let y = 0; y < lh; y++) for (let x = Math.max(sh, 0); x < lw + Math.min(sh, 0); x++) { s += Math.abs(a[y * lw + x] - b[y * lw + x - sh]); c++; } lflick.push(s / c / Math.max(lmean, 1e-6)); }
    // fine detail of the linear share where the picture is smooth (no edge within the 3 × 3 round the pixel)
    const rough = (img, ref, wdt, hgt) => { let s = 0, m = 0, c = 0; for (let y = 1; y < hgt - 1; y++) for (let x = 1; x < wdt - 1; x++) { const i = y * wdt + x; let b = 0, lo = Infinity, hi = -Infinity; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { b += img[i + dy * wdt + dx]; if (ref) { const q = ref[i + dy * wdt + dx]; lo = Math.min(lo, q); hi = Math.max(hi, q); } } if (ref && hi - lo > 0.02 * Math.max(hi, 0.05)) continue; b /= 9; s += Math.abs(img[i] - b); m += img[i]; c++; } return { rel: m > 0 ? s / m : 0, part: c / (wdt * hgt) }; };
    const roughLin = rough(linShares[0], offs[0], cw, ch), roughLow = rough(lows[0], null, lw, lh);
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[s.length >> 1].toFixed(4) : null; };
    const mean = (a) => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(4) : null;
    // pictures: the share ×4 (8-bit), its change ×8 (linear, relative to the mean, reprojected when turning), the low
    // buffer and its change
    const grey = (img, wdt, hgt, gain) => { const c = document.createElement('canvas'); c.width = wdt; c.height = hgt; const ctx = c.getContext('2d'), id = ctx.createImageData(wdt, hgt); for (let y = 0; y < hgt; y++) for (let x = 0; x < wdt; x++) { const v = Math.max(0, Math.min(255, (img[(hgt - 1 - y) * wdt + x] || 0) * gain)); const j = (y * wdt + x) * 4; id.data[j] = id.data[j + 1] = id.data[j + 2] = v; id.data[j + 3] = 255; } ctx.putImageData(id, 0, 0); return c.toDataURL('image/png'); };
    const lowChange = new Float32Array(ln); for (let i = 0; i < ln; i++) lowChange[i] = Math.abs(lows[1][i] - lows[0][i]);
    const pics = saveTag ? { share: grey(shares[0], cw, ch, 4), change: grey(stillShare, cw, ch, 255 * 0.5 / lm), low: grey(lows[0], lw, lh, 255 * 0.5 / Math.max(lmean, 1e-6)), lowChange: grey(lowChange, lw, lh, 255 * 2 / Math.max(lmean, 1e-6)), scene: grey(sceneChange, cw, ch, 255 * 0.5 / Math.max(om, 1e-6)), on: shotsOn } : null;
    // SM_DUMP=x,y,w,h (low-resolution pixels, from the top): the raw low buffer of the last frame in that region
    let dump = null;
    if (window.__smDump) {
      const [dx, dy, dw, dh] = window.__smDump;
      dump = { x: dx, y: dy, w: dw, h: dh, rows: [] };
      for (let y = 0; y < dh; y++) { const row = []; for (let x = 0; x < dw; x++) { const i = ((lh - 1 - (dy + y)) * lw + dx + x) * 4; row.push([+lowBuf[i].toFixed(5), +lowBuf[i + 1].toFixed(2), +lowBuf[i + 2].toFixed(5), +lowBuf[i + 3].toFixed(2)]); } dump.rows.push(row); }
    }
    return { size: [cw, ch], low: [lw, lh], frames, turnStep: +turnStep.toFixed(5), mean: +lm.toFixed(5), stillPart: +stillPart.toFixed(3),
      flick: med(flick), flickMean: mean(flick), still: med(still), stillMean: mean(still), flick8: med(flick8), lowFlick: med(lflick),
      scene: med(scene), sceneRegion: med(sceneRegion), sceneMean: +om.toFixed(5),
      rough: +roughLin.rel.toFixed(4), roughPart: +roughLin.part.toFixed(3), roughLow: +roughLow.rel.toFixed(4),
      perFrame: { flick: flick.map((v) => +v.toFixed(4)), still: still.map((v) => +v.toFixed(4)), low: lflick.map((v) => +v.toFixed(4)) }, pics, dump };
  }, [pose, turnPx, frames, saveTag]);

  const save = (name, dataUrl, flip) => {
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    if (!flip) { fs.writeFileSync(path.join(outDir, name + '.png'), buf); return; }
    const png = require('./png-lite.js'), img = png.decode(buf), out = Buffer.alloc(img.data.length), stride = img.width * 4;
    for (let y = 0; y < img.height; y++) img.data.copy(out, (img.height - 1 - y) * stride, y * stride, (y + 1) * stride);
    fs.writeFileSync(path.join(outDir, name + '.png'), png.encode({ width: img.width, height: img.height, data: out }));
  };
  const results = { tier, weather, hour, size: [W, H], frames: N, stepPx: STEP, views: {} };
  for (const v of views) {
    const st = await measure(v.pose, 0, N, true);
    const tn = await measure(v.pose, STEP, N, true);
    for (const [k, seq] of [['static', st], ['turn', tn]]) {
      if (seq.dump) { fs.writeFileSync(path.join(outDir, `${tag}-${v.name}-${k}-dump.json`), JSON.stringify(seq.dump)); delete seq.dump; }
      if (seq.pics) {
        save(`${tag}-${v.name}-${k}-share`, seq.pics.share); save(`${tag}-${v.name}-${k}-change`, seq.pics.change);
        save(`${tag}-${v.name}-${k}-low`, seq.pics.low); save(`${tag}-${v.name}-${k}-lowchange`, seq.pics.lowChange); save(`${tag}-${v.name}-${k}-scene`, seq.pics.scene);
        seq.pics.on.forEach((d, i) => save(`${tag}-${v.name}-${k}-on${i}`, d, true));
        delete seq.pics;
      }
    }
    results.views[v.name] = { static: st, turn: tn };
    const line = (k, s) => `METRIC ${tag} ${v.name} ${k}: flick=${s.flick} still=${s.still} (${s.stillPart} of the picture) flick8=${s.flick8} lowFlick=${s.lowFlick} rough=${s.rough} (${s.roughPart}) roughLow=${s.roughLow} mean=${s.mean} scene=${s.scene} region=${s.sceneRegion}`;
    console.log(line('static', st)); console.log(line('turn', tn));
  }
  fs.writeFileSync(path.join(outDir, `${tag}-metrics.json`), JSON.stringify(results, null, 1));
  console.log(`SUMMARY smooth-probe ${views.length} views measured (${tag})`);
};
