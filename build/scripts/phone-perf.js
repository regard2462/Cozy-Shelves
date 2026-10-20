// What a frame of the browser build costs on a touch device (the phone strand of 0.10): headless Edge emulates a
// mid-range phone in landscape (WEB_DEVICE=phone: 914 × 411 CSS px at a pixel ratio of 2.625, touch, the mobile viewport,
// so main-web.js zooms the page out and core/api-web.js gives the fresh profile of a touch screen), a test library is
// put in through the hook of web-check, and the world is measured at fixed views with the graphics the page chose:
//   SETUP   the graphics settings, the canvas (CSS size, drawing buffer, pixel ratio, the page's zoom, multisampling of
//           the canvas), the lights the shaders loop over, the programs, the materials and textures of the scene
//   CELL    per view and condition: the card's time (card: a timer query with the card kept busy before the frame, so
//           that the frame's commands run without gaps; gpu: timer queries with the frames back to back, which on a
//           fast card measures how quickly the graphics process hands the commands over), CPU time of World#frame (each
//           frame finished on the card), draw calls, triangles, WebGL calls of one frame, the drawing buffer
//   SCALE   the card's time at the phone's pixels and at four times as many (what is paid per pixel, what per frame)
//   DRAWS   the draws of one frame by object: calls and triangles
//   PROBE   the GPU time with parts left out (the garden, the books, the furniture, every point light, the lit
//           materials replaced by unlit ones, multisampling): what each part costs
//   STEPS   the CPU time of the steps of World#frame, at the processor's speed and slowed down (PH_THROTTLE, default 4:
//           Emulation.setCPUThrottlingRate, a proxy for the slower cores of a phone)
//   LIVE    the running loop (its frame cap) at full speed: the processor time of the graphics process and of the
//           renderer per drawn frame, and with the world at rest
//   SOUND   the renderer's processor time with the world at rest, with the sound running and suspended
//   LOOP    the running loop for PH_LOOP_MS per view (PH_LOOP_VIEWS, the player looking round) with the throttle: the
//           intervals between drawn frames, the main thread's time per frame, long tasks
//   ALLOC   the bytes allocated per frame (the sampling heap profiler with collected objects counted)
// Everything also as JSON into SHOT_DIR/phone-perf-<PH_TAG>.json; screenshots phone-<view>.png (the page as shown).
//   WEB_DEVICE=phone WEB_BOOKS=<library> node build/web-shot.js phone-perf
//   PH_PARTS=cells,draws,scale,probe,steps,live,sound,loop,alloc   PH_VIEWS=hall,room,shelves,terrace,jetty,glass   PH_N=60
//   PH_WARM=200 (frames before each measurement: the card's clocks)   PH_THROTTLE=4   PH_TAG=run   PH_LOOP_MS=6000
//   PH_GRAPHICS='{"quality":"low"}' (graphics settings laid over the page's own before measuring)
const fs = require('fs');
const path = require('path');

function listFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, base, out);
    else if (e.isFile()) out.push({ abs: p, rel: path.relative(base, p).split(path.sep).join('/') });
  }
  return out;
}

/** Copies the test library into the OPFS of the page (as web-check does). */
async function fillOpfs(page, dir, name) {
  const files = listFiles(dir);
  await page.evaluate(async (n) => { const root = await navigator.storage.getDirectory(); try { await root.removeEntry(n, { recursive: true }); } catch {} await root.getDirectoryHandle(n, { create: true }); }, name);
  for (const f of files) {
    const buf = fs.readFileSync(f.abs);
    const parts = []; for (let i = 0; i < buf.length; i += 4194304) parts.push(buf.subarray(i, i + 4194304).toString('base64'));
    if (!parts.length) parts.push('');
    await page.evaluate(async ({ n, rel, parts }) => {
      const root = await navigator.storage.getDirectory();
      let dir = await root.getDirectoryHandle(n, { create: true });
      const segs = rel.split('/');
      for (const s of segs.slice(0, -1)) dir = await dir.getDirectoryHandle(s, { create: true });
      const fh = await dir.getFileHandle(segs[segs.length - 1], { create: true });
      const w = await fh.createWritable();
      for (const b64 of parts) { const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); await w.write(u8); }
      await w.close();
    }, { n: name, rel: f.rel, parts });
  }
  return files.length;
}

/** The processor time (ms) of the browser's graphics process and of its renderers so far, found through the profile
 *  folder of this run (Windows: Win32_Process; elsewhere null). Only the processes this run started are read. */
function procTimes(profile) {
  if (process.platform !== 'win32' || !profile) return null;
  const esc = profile.replace(/'/g, "''");
  // (the renderers carry the profile folder on their command line; their parent is the browser of this run, whose
  // children include the graphics process)
  const ps = `$all = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'"; $r = $all | Where-Object { $_.CommandLine -like '*--type=renderer*' -and $_.CommandLine -like '*${esc}*' } | Select-Object -First 1; ` +
    `if ($r) { $all | Where-Object { $_.ParentProcessId -eq $r.ParentProcessId } | ForEach-Object { $t = if ($_.CommandLine -match '--type=([a-z-]+)') { $Matches[1] } else { 'other' }; '{0} {1} {2}' -f $t, $_.ProcessId, [int64](($_.KernelModeTime + $_.UserModeTime) / 10000) } }`;
  try {
    const out = require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    const r = { gpu: 0, renderer: 0 };
    for (const line of out.split(/\r?\n/)) { const [t, , ms] = line.trim().split(' '); if (t === 'gpu-process') r.gpu += +ms; else if (t === 'renderer') r.renderer += +ms; }
    return r;
  } catch { return null; }
}

module.exports = async ({ page, context, shot, sleep, baseUrl, outDir, profile }) => {
  const parts = new Set((process.env.PH_PARTS || 'cells,draws,scale,probe,steps,live,sound,loop,alloc').split(','));
  const N = +process.env.PH_N || 60;
  const warm = +process.env.PH_WARM || 200;
  const throttle = +process.env.PH_THROTTLE || 4;
  const tag = process.env.PH_TAG || 'run';
  const loopMs = +process.env.PH_LOOP_MS || 6000;
  const overlay = process.env.PH_GRAPHICS ? JSON.parse(process.env.PH_GRAPHICS) : null;
  const books = process.env.WEB_BOOKS;
  if (!books || !fs.existsSync(books)) throw new Error('no test library: set WEB_BOOKS');
  const log = (s) => console.log(s);
  const result = { tag, setup: null, cells: [], scale: [], probe: [], steps: [], loop: null, alloc: [] };

  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  try { await page.waitForFunction(() => document.querySelector('.welcome-card'), null, { timeout: 15000 }); } catch {}
  const libName = path.basename(books).replace(/[^\p{L}\p{N}._-]+/gu, '_');
  const nFiles = await fillOpfs(page, books, libName);
  const folders = await page.evaluate(async (n) => { const root = await navigator.storage.getDirectory(); const h = await root.getDirectoryHandle(n); return window.__cozyshelvesWeb.useHandle(h, 'structured'); }, libName);
  await page.evaluate((f) => { window.__app.ctx.bus.emit('welcome:folder', f); }, folders);
  await page.keyboard.press('Escape');
  for (const start = Date.now(); Date.now() - start < 420000;) {
    const st = await page.evaluate(() => { const l = window.__cozyshelvesWeb.library; const b = Object.values(l.books).filter((x) => !x.missing); return { n: b.length, idle: !l.scanState.active && !l._scanning && !l.queue.length, indexed: b.filter((x) => x.indexed).length }; });
    if (st.n > 0 && st.idle && st.indexed === st.n) break;
    await sleep(1500);
  }
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  try { await page.waitForFunction(() => (window.__app.world.books?.entries?.size || 0) > 0, null, { timeout: 60000 }); } catch {}
  await sleep(12000);   // the rebuild after the library settled, the shelves' texts, the textures' uploads
  if (overlay) {
    await page.evaluate((g) => window.api.settings.set({ graphics: g }), overlay);
    await sleep(4000);
  }
  const cdp = await context.newCDPSession(page);

  // ---- the setup the page chose ------------------------------------------------------------------------------------
  const setup = await page.evaluate(() => {
    const w = window.__app.world, r = w.renderer, gl = r.getContext(), c = r.domElement;
    let gpu = ''; try { gpu = gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL); } catch {}
    const lights = { point: 0, pointPads: 0, spot: 0, dir: 0, hemi: 0, ambient: 0, shadowCasting: 0 };
    w.scene.traverseVisible((o) => {
      if (o.isPointLight) { if (o.userData.pad) lights.pointPads++; else lights.point++; }
      if (o.isSpotLight) lights.spot++; if (o.isDirectionalLight) lights.dir++; if (o.isHemisphereLight) lights.hemi++; if (o.isAmbientLight) lights.ambient++;
      if (o.isLight && o.castShadow) lights.shadowCasting++;
    });
    // what the programs were built with (from their fragment sources)
    const progs = r.info.programs || [];
    const nums = new Map();
    for (const p of progs) {
      try {
        const sh = gl.getAttachedShaders(p.program).map((s) => gl.getShaderSource(s)).join('\n');
        const m = sh.match(/PointLight pointLights\[\s*(\d+)\s*\]/);
        const k = m ? +m[1] : 0; nums.set(k, (nums.get(k) || 0) + 1);
      } catch {}
    }
    const mats = {}, matSet = new Set(), texSet = new Set(); let meshes = 0, instanced = 0;
    const aniso = {};
    w.scene.traverseVisible((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
      meshes++; if (o.isInstancedMesh) instanced++;
      for (const m of [o.material].flat()) {
        if (!m || matSet.has(m)) continue; matSet.add(m);
        mats[m.type] = (mats[m.type] || 0) + 1;
        for (const k in m) { const t = m[k]; if (t?.isTexture && !texSet.has(t)) { texSet.add(t); aniso[t.anisotropy] = (aniso[t.anisotropy] || 0) + 1; } }
      }
    });
    const attrs = gl.getContextAttributes();
    return {
      gpu, settings: JSON.parse(JSON.stringify(w.settings.graphics || {})), quality: w.quality, frameCap: w.frameCap,
      css: [c.clientWidth, c.clientHeight], buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      megapixels: +(gl.drawingBufferWidth * gl.drawingBufferHeight / 1e6).toFixed(2),
      dpr: devicePixelRatio, pixelRatio: r.getPixelRatio(), zoom: window.visualViewport?.scale, inner: [innerWidth, innerHeight], screen: [screen.width, screen.height],
      antialias: attrs.antialias, samples: gl.getParameter(gl.SAMPLES), composed: w.bloom.enabled || w.ao.enabled || w.godrays.wanted,
      shadows: r.shadowMap.enabled, lights, programs: progs.length, numPointLights: Object.fromEntries(nums),
      meshesVisible: meshes, instancedVisible: instanced, materials: mats, materialCount: matSet.size, textures: texSet.size, anisotropy: aniso,
      memory: { ...r.info.memory }, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      touch: !!window.__app.touch, ua: navigator.userAgent.slice(0, 80),
    };
  });
  result.setup = setup;
  log('SETUP ' + JSON.stringify(setup));

  // ---- the helpers in the page ---------------------------------------------------------------------------------------
  await page.evaluate(([warm]) => {
    const w = window.__app.world, gl = w.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const px = new Uint8Array(4), wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const P = window.__ph = { w, gl, ext, wait, warm };
    w.stop(); window.__app.closeAllPanels();
    P.sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    P.stats = (a) => { const s = a.filter((v) => v != null).sort((x, y) => x - y); if (!s.length) return null; const q = (f) => +s[Math.min(s.length - 1, Math.floor(f * s.length))].toFixed(3); return { p10: q(0.1), p50: q(0.5), p90: q(0.9), max: q(1), n: s.length }; };
    P.cond = (c) => { w.applySettings({ ...w.settings, weather: c.weather, timeMode: 'fixed', fixedHour: c.hour }); };
    P.view = async (x, z, yaw, pitch, frames = 30) => {
      const p = w.player;
      if (w.actions.seatedId) w.actions.leaveSeat?.();
      p.transition = null; p.setPose(x, z, yaw, pitch);
      for (let i = 0; i < 40; i++) w.updateDoor(0.05);
      for (let i = 0; i < frames; i++) { w.frame(); P.sync(); await wait(2); }
    };
    // no shadow map redrawn during a measurement (when there are any: their cadence would add noise)
    P.hold = (fn) => async (...a) => {
      const g = w.godrays, orig = g.beforeRender;
      g.beforeRender = function (dt) { orig.call(this, dt); if (w.env) w.env.sun.shadow.needsUpdate = false; if (w.fire) w.fire.light.shadow.needsUpdate = false; };
      try { return await fn(...a); } finally { g.beforeRender = orig; }
    };
    P.gpu = P.hold(async (N, fn = () => w.frame()) => {
      if (!ext) return null;
      for (let i = 0; i < P.warm; i++) fn();
      const qs = [];
      for (let i = 0; i < N; i++) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); fn(); gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
      for (let k = 0; k < 3000 && !gl.getQueryParameter(qs[qs.length - 1], gl.QUERY_RESULT_AVAILABLE); k++) await wait(2);
      const dis = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const out = qs.map((q) => (!dis && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) ? gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 : null));
      for (const q of qs) gl.deleteQuery(q);
      return P.stats(out);
    });
    P.cpu = P.hold(async (N) => { const t = []; for (let i = 0; i < N; i++) { const a = performance.now(); w.frame(); t.push(performance.now() - a); P.sync(); if (i % 10 === 9) await wait(1); } return P.stats(t); });
    // a frame from its start until the card has finished it (the main thread, the graphics process and the card one
    // after the other, nothing overlapped): the longest a single frame can take
    P.whole = P.hold(async (N) => { const t = []; for (let i = 0; i < N; i++) { await wait(1); const a = performance.now(); w.frame(); P.sync(); t.push(performance.now() - a); } return P.stats(t); });
    // the WebGL calls of one frame, by name (what the browser's graphics process and the driver have to carry out)
    P.glCalls = () => {
      const counts = {}, orig = {};
      const proto = Object.getPrototypeOf(gl);
      for (const k of Object.getOwnPropertyNames(proto)) {
        const d = Object.getOwnPropertyDescriptor(proto, k);
        if (!d || typeof d.value !== 'function' || k === 'constructor') continue;
        orig[k] = gl[k];
        gl[k] = function (...a) { counts[k] = (counts[k] || 0) + 1; return orig[k].apply(this, a); };
      }
      // the multi-draws of three's BatchedMesh (WEBGL_multi_draw): one call, a draw per sub-mesh in the graphics process
      const md = gl.getExtension('WEBGL_multi_draw'), mdOrig = {};
      if (md) for (const k of ['multiDrawArraysWEBGL', 'multiDrawElementsWEBGL', 'multiDrawArraysInstancedWEBGL', 'multiDrawElementsInstancedWEBGL']) {
        if (typeof md[k] !== 'function') continue;
        mdOrig[k] = md[k];
        md[k] = function (...a) { counts[k] = (counts[k] || 0) + 1; counts.subDraws = (counts.subDraws || 0) + (a[a.length - 1] | 0); return mdOrig[k].apply(this, a); };
      }
      const info = w.renderer.info; info.autoReset = false; info.reset();
      try { w.frame(); } finally { for (const k in orig) delete gl[k]; for (const k in mdOrig) md[k] = mdOrig[k]; }
      const calls = info.render.calls, tris = info.render.triangles; info.autoReset = true;
      P.sync();
      const total = Object.entries(counts).reduce((a, [k, b]) => a + (k === 'subDraws' ? 0 : b), 0);
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      return { calls, tris, gl: total, top };
    };
    P.setScale = (k) => { const pr = w.renderer.getPixelRatio(); P.basePr ??= pr; const pr2 = P.basePr * k; w.renderer.setPixelRatio(pr2); w.renderer.setSize(w.canvas.clientWidth, w.canvas.clientHeight, false); w.composer.setPixelRatio(pr2); w.composer.setSize(w.canvas.clientWidth, w.canvas.clientHeight); };
    // The card's own time for a frame. On a fast card the frame's commands arrive slower than the card carries them
    // out, and a timer query round the frame measures the graphics process (the card idles in between). So the card
    // is kept busy first (a heavy shader into a small buffer of its own, some 40 ms), and the frame's commands queue up
    // behind it: the query then holds the card's work alone. Raw WebGL, three's state reset afterwards.
    P.blocker = (() => {
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, '#version 300 es\nvoid main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }'));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float; uniform float uN; out vec4 o; void main() { float a = gl_FragCoord.x * 0.001 + gl_FragCoord.y; for (float i = 0.0; i < uN; i += 1.0) { a = fract(sin(a * 12.9898 + i) * 43758.5453); } o = vec4(a); }'));
      gl.linkProgram(prog);
      const loc = gl.getUniformLocation(prog, 'uN');
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 256, 256);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const vao = gl.createVertexArray();
      w.renderer.resetState();
      let n = 2000;
      const run = () => {
        const target = w.renderer.getRenderTarget();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, 256, 256); gl.useProgram(prog); gl.bindVertexArray(vao);
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE); gl.colorMask(true, true, true, true);
        gl.uniform1f(loc, n); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.flush();
        w.renderer.resetState(); w.renderer.setRenderTarget(target);
      };
      // calibrate to about 40 ms of the card's time
      const time = async () => { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); run(); gl.endQuery(ext.TIME_ELAPSED_EXT); for (let k = 0; k < 3000 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await wait(2); const v = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q); return v; };
      return { run, calibrate: async () => { for (let i = 0; i < 6; i++) { const t = await time(); if (t > 30 && t < 60) break; n = Math.max(50, Math.round(n * 40 / Math.max(0.5, t))); } return { n, ms: await time() }; } };
    })();
    P.pure = P.hold(async (N, fn = () => w.frame()) => {
      if (!ext) return null;
      if (!P.calibrated) P.calibrated = await P.blocker.calibrate();
      for (let i = 0; i < 20; i++) fn();
      const qs = [];
      for (let i = 0; i < N; i++) {
        P.blocker.run();
        const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); fn(); gl.endQuery(ext.TIME_ELAPSED_EXT); gl.flush(); qs.push(q);
        if (i % 8 === 7) { for (let k = 0; k < 3000 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await wait(1); }
      }
      for (let k = 0; k < 3000 && !gl.getQueryParameter(qs[qs.length - 1], gl.QUERY_RESULT_AVAILABLE); k++) await wait(2);
      const dis = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const out = qs.map((q) => (!dis && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) ? gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 : null));
      for (const q of qs) gl.deleteQuery(q);
      return P.stats(out);
    });
  }, [warm]);

  const VIEWS = {
    hall: [0, 0, Math.PI / 2, 0], room: [0, -12, 0, 0], shelves: null,
    terrace: [0.6, 8.7, Math.PI + 0.15, 0.05], jetty: [-22, 37, 2.15, 0.02], glass: [0, -2.2, Math.PI, 0.05],
  };
  VIEWS.shelves = await page.evaluate(() => { const w = window.__app.world; const count = (bc) => bc.rows.reduce((a, r) => a + r.items.length, 0); const bc = [...w.layout.bookcases].sort((a, b) => count(b) - count(a))[0]; const fx = Math.sin(bc.rot), fz = Math.cos(bc.rot); return [bc.x + fx * 1.5, bc.z + fz * 1.5, Math.atan2(fx, fz), -0.05]; });
  const CONDS = { day: { hour: 11, weather: 'clear' }, night: { hour: 23, weather: 'clear' }, rain: { hour: 14, weather: 'rain' } };
  const PLAN = { hall: ['day', 'night'], room: ['day', 'night'], shelves: ['day'], terrace: ['day', 'night', 'rain'], jetty: ['day'], glass: ['day'] };
  const views = (process.env.PH_VIEWS || Object.keys(VIEWS).join(',')).split(',');

  if (parts.has('cells')) {
    for (const view of views) {
      for (const cond of PLAN[view] || ['day']) {
        const r = await page.evaluate(async ([c, pose, N]) => {
          const P = window.__ph;
          P.cond(c); await P.view(...pose);
          const gpu = await P.gpu(N);
          const pure = await P.pure(Math.max(24, N >> 1));
          const cpu = await P.cpu(Math.max(20, N >> 1));
          const whole = await P.whole(Math.max(20, N >> 1));
          const g = P.glCalls();
          // the frames back to back for a second, finished at the end: the rate the whole pipeline sustains
          return { gpu, pure, cpu, whole, ...g, buffer: [P.gl.drawingBufferWidth, P.gl.drawingBufferHeight], programs: P.w.renderer.info.programs.length };
        }, [CONDS[cond], VIEWS[view], N]);
        // the processor time of the graphics process and of the renderer for a block of frames drawn back to back
        // (the main thread, the graphics process and the card overlapping as in the running app)
        // (the frames run while neither query of the process times does: the times before and after hold the frames and
        // a little of the idle page round them)
        const K = 150;
        await page.evaluate(async (K) => { const P = window.__ph; for (let i = 0; i < 30; i++) P.w.frame(); P.sync(); }, K);
        const t0 = procTimes(profile);
        const wall = await page.evaluate(async (K) => { const P = window.__ph; const a = performance.now(); for (let i = 0; i < K; i++) P.w.frame(); P.sync(); return (performance.now() - a) / K; }, K);
        const t1 = procTimes(profile);
        r.pipeline = { msPerFrame: +wall.toFixed(2), gpuProcessMsPerFrame: t0 && t1 ? +((t1.gpu - t0.gpu) / K).toFixed(2) : null, rendererMsPerFrame: t0 && t1 ? +((t1.renderer - t0.renderer) / K).toFixed(2) : null };
        result.cells.push({ view, cond, ...r });
        log(`CELL ${view} ${cond} card=${r.pure?.p50} (p10 ${r.pure?.p10}, p90 ${r.pure?.p90}) gpu=${r.gpu?.p50} (p10 ${r.gpu?.p10}, p90 ${r.gpu?.p90}) cpu=${r.cpu?.p50} (p90 ${r.cpu?.p90}) whole=${r.whole?.p50} pipeline=${JSON.stringify(r.pipeline)} draws=${r.calls} tris=${r.tris} glcalls=${r.gl} buf=${r.buffer.join('x')} prog=${r.programs} top=${JSON.stringify(r.top)}`);
        if (cond === 'day') {
          // the picture as the page shows it (the HUD included), drawn once more right before the screenshot
          await page.evaluate(() => { window.__ph.w.frame(); });
          await shot(`phone-${tag}-${view}`);
        }
      }
    }
  }

  // the draws of one frame by object (calls, triangles) at the main views
  if (parts.has('draws')) {
    for (const view of ['hall', 'shelves', 'terrace'].filter((v) => views.includes(v))) {
      const r = await page.evaluate(async ([c, pose]) => {
        const P = window.__ph, w = P.w, rr = w.renderer;
        P.cond(c); await P.view(...pose, 10);
        const calls = {}, tris = {};
        const ob = rr.renderBufferDirect;
        const top = (o) => { let n = o; const names = []; while (n && n !== w.scene && names.length < 3) { if (n.name) names.push(n.name); n = n.parent; } return names.reverse().join('/') || o.type; };
        rr.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
          const key = top(object) + ' [' + material.type + (object.isInstancedMesh ? ' inst ' + object.count : '') + (object.isBatchedMesh ? ' batch' : '') + ']';
          calls[key] = (calls[key] || 0) + 1;
          const idx = geometry.index, cnt = (group ? group.count : idx ? idx.count : geometry.attributes.position?.count || 0) / 3;
          tris[key] = (tris[key] || 0) + Math.round(cnt * (object.isInstancedMesh ? object.count : 1));
          return ob.call(this, camera, scene, geometry, material, object, group);
        };
        try { w.frame(); P.sync(); } finally { rr.renderBufferDirect = ob; }
        return Object.entries(calls).map(([k, v]) => [k, v, tris[k]]).sort((a, b) => b[2] - a[2]);
      }, [CONDS.day, VIEWS[view]]);
      result.draws = result.draws || {};
      result.draws[view] = r;
      log(`DRAWS ${view} by triangles: ${r.slice(0, 25).map(([k, v, t]) => `${k} ${v}× ${t}`).join(' | ')}`);
      const byCalls = [...r].sort((a, b) => b[1] - a[1]);
      log(`DRAWS ${view} by calls: ${byCalls.slice(0, 25).map(([k, v, t]) => `${k} ${v}× ${t}`).join(' | ')}`);
    }
  }

  if (parts.has('scale')) {
    for (const view of ['hall', 'shelves', 'terrace'].filter((v) => views.includes(v))) {
      const r = await page.evaluate(async ([c, pose, N]) => {
        const P = window.__ph;
        P.cond(c); await P.view(...pose);
        const out = {};
        for (const k of [1, 2]) { P.setScale(k); for (let i = 0; i < 3; i++) P.w.frame(); out['x' + k] = { gpu: (await P.pure(Math.max(24, N >> 1)))?.p50, buffer: [P.gl.drawingBufferWidth, P.gl.drawingBufferHeight] }; }
        P.setScale(1);
        const a = out.x1, b = out.x2, pa = a.buffer[0] * a.buffer[1], pb = b.buffer[0] * b.buffer[1];
        const perMpx = (b.gpu - a.gpu) / ((pb - pa) / 1e6);
        return { ...out, perMpx: +perMpx.toFixed(3), fixed: +(a.gpu - perMpx * pa / 1e6).toFixed(3) };
      }, [CONDS.day, VIEWS[view], N]);
      result.scale.push({ view, ...r });
      log(`SCALE ${view} ${JSON.stringify(r)}`);
    }
  }

  if (parts.has('probe')) {
    for (const view of ['hall', 'shelves', 'terrace', 'glass'].filter((v) => views.includes(v))) {
      const r = await page.evaluate(async ([c, pose, N]) => {
        const P = window.__ph, w = P.w, env = w.env;
        P.cond(c); await P.view(...pose);
        const out = { base: (await P.pure(Math.max(24, N >> 1)))?.p50, ...(() => { const g = P.glCalls(); return { calls: g.calls, tris: g.tris }; })() };
        const toggles = {
          noGarden: () => { env.scenery.visible = false; return () => { env.scenery.visible = true; }; },
          noBooks: () => { const l = w.books.meshes.filter((m) => m.visible); for (const m of l) m.visible = false; return () => { for (const m of l) m.visible = true; }; },
          noStatic: () => { w.static.visible = false; return () => { w.static.visible = true; }; },
          noAnimals: () => { const gs = [w.fauna?.group, w.wildlife?.group, w.cat?.group].filter(Boolean); const v = gs.map((g) => g.visible); gs.forEach((g) => { g.visible = false; }); return () => gs.forEach((g, i) => { g.visible = v[i]; }); },
          // every point light out: the programs are built for none (a compile, once); what the light loops cost
          noPointLights: () => { const l = []; w.scene.traverse((o) => { if (o.isPointLight && o.visible) { l.push(o); o.visible = false; } }); return () => { for (const o of l) o.visible = true; }; },
          // the frame into a buffer of the canvas' size with four samples and with none (the programs of a render
          // target: compiled once here): what the canvas' multisampling costs the card
          target4: () => { const RT = w.composer.renderTarget1.constructor, gl = P.gl; const t = P.t4 ||= new RT(gl.drawingBufferWidth, gl.drawingBufferHeight, { samples: 4 }); w.renderer.setRenderTarget(t); return () => w.renderer.setRenderTarget(null); },
          target0: () => { const RT = w.composer.renderTarget1.constructor, gl = P.gl; const t = P.t0 ||= new RT(gl.drawingBufferWidth, gl.drawingBufferHeight, { samples: 0 }); w.renderer.setRenderTarget(t); return () => w.renderer.setRenderTarget(null); },
          // the lit materials drawn unlit with their colour and map: what the lighting costs as a whole
          unlit: () => {
            const swaps = [];
            P.basic ||= new Map();
            w.scene.traverse((o) => {
              if (!o.isMesh || Array.isArray(o.material)) return;
              const m = o.material;
              if (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) swaps.push([o, m]);
            });
            for (const [o, m] of swaps) { let b = P.basic.get(m); if (!b) { b = new P.Basic({ color: m.color, map: m.map, transparent: m.transparent, opacity: m.opacity, side: m.side, alphaTest: m.alphaTest, vertexColors: m.vertexColors }); P.basic.set(m, b); } o.material = b; }
            return () => { for (const [o, m] of swaps) o.material = m; };
          },
        };
        // (three's MeshBasicMaterial, taken from a material of the scene)
        w.scene.traverse((o) => { if (!P.Basic && o.material && !Array.isArray(o.material) && o.material.type === 'MeshBasicMaterial') P.Basic = o.material.constructor; });
        for (const [name, on] of Object.entries(toggles)) {
          if (name === 'unlit' && !P.Basic) continue;
          const off = on();
          try { for (let i = 0; i < 4; i++) { w.frame(); P.sync(); } await P.wait(50); out[name] = (await P.pure(Math.max(24, N >> 1)))?.p50; const g = P.glCalls(); out[name + 'Draws'] = g.calls; out[name + 'Tris'] = g.tris; }
          catch (e) { out[name] = 'error: ' + String(e.message || e).slice(0, 80); }
          finally { off(); }
          for (let i = 0; i < 3; i++) { try { w.frame(); P.sync(); } catch {} }
        }
        return out;
      }, [CONDS.day, VIEWS[view], N]);
      result.probe.push({ view, ...r });
      log(`PROBE ${view} ${JSON.stringify(r)}`);
    }
  }

  // ---- where the CPU time of a frame goes, at full speed and slowed down ---------------------------------------------------
  if (parts.has('steps')) {
    for (const rate of [1, throttle]) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      for (const view of ['hall', 'shelves', 'terrace', 'jetty'].filter((v) => views.includes(v))) {
        const r = await page.evaluate(async ([c, pose, N]) => {
          const P = window.__ph, w = P.w;
          P.cond(c); await P.view(...pose, 10);
          const sums = {}, wraps = [];
          const wrap = (obj, key, name) => {
            if (!obj || typeof obj[key] !== 'function') return;
            const f = obj[key];
            obj[key] = function (...a) { const t = performance.now(); const res = f.apply(this, a); sums[name] = (sums[name] || 0) + performance.now() - t; return res; };
            wraps.push(() => { obj[key] = f; });
          };
          wrap(w, 'updateDoor', 'door'); wrap(w.player, 'update', 'player'); wrap(w.sky, 'frame', 'sky'); wrap(w.env, 'update', 'env'); wrap(w.reflections, 'frame', 'reflections');
          wrap(w.wildlife, 'update', 'wildlife'); wrap(w.fauna, 'update', 'fauna'); wrap(w.winter, 'update', 'winter'); wrap(w.books, 'update', 'books'); wrap(w.audiobooks, 'update', 'audiobooks');
          wrap(w.cat, 'update', 'cat'); wrap(w.cinema, 'update', 'cinema'); wrap(w.actions, 'update', 'actions'); wrap(w.godrays, 'beforeRender', 'godrays');
          wrap(w.walls, 'update', 'walls'); wrap(w.floors, 'update', 'floors'); wrap(w.signs, 'pump', 'signs'); wrap(w.lampSwitch, 'update', 'lampSwitch');
          wrap(w.renderer, 'render', 'render'); wrap(w.composer, 'render', 'render');
          // inside the render: the matrices, the sorting and the draws
          wrap(w.scene, 'updateMatrixWorld', 'render:matrices');
          wrap(w.renderer, 'renderBufferDirect', 'render:draws');
          const totals = [];
          try {
            for (let i = 0; i < N; i++) { const t = performance.now(); w.frame(); totals.push(performance.now() - t); P.sync(); if (i % 10 === 9) await P.wait(1); }
          } finally { for (const un of wraps.reverse()) un(); }
          const avg = Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, +(v / N).toFixed(3)]).sort((a, b) => b[1] - a[1]));
          return { total: P.stats(totals), avg };
        }, [CONDS.day, VIEWS[view], Math.max(30, N)]);
        result.steps.push({ rate, view, ...r });
        log(`STEPS x${rate} ${view} total=${JSON.stringify(r.total)} ${JSON.stringify(r.avg)}`);
      }
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }

  // ---- the running loop at full speed: the processor time of the processes per drawn frame -------------------------------
  if (parts.has('live')) {
    for (const view of ['hall', 'terrace', 'shelves'].filter((v) => views.includes(v))) {
      await page.evaluate(async ([pose]) => { const P = window.__ph, w = P.w; P.cond({ hour: 11, weather: 'clear' }); await P.view(...pose, 10); w.resetFrameStats(); w.start(); }, [VIEWS[view]]);
      await sleep(1500);
      await page.evaluate(() => { const P = window.__ph; P.liveFrames = 0; const f = P.w.frame; P.liveOrig = f; P.w.frame = function (...a) { P.liveFrames++; return f.apply(this, a); }; });
      // (a sample: the process times, the moment they were taken (the middle of the query, which takes a while) and the
      // frames drawn by then, read on both sides of the query)
      const count = () => page.evaluate(() => window.__ph.liveFrames);
      const sample = async () => { const f0 = await count(), a = Date.now(); const t = procTimes(profile); const b = Date.now(), f1 = await count(); return t && { ...t, at: (a + b) / 2, frames: (f0 + f1) / 2 }; };
      const t0 = await sample();
      await sleep(4000);
      const t1 = await sample();
      await page.evaluate(() => { const P = window.__ph; P.w.frame = P.liveOrig; P.w.stop(); });
      const secs = t0 && t1 ? (t1.at - t0.at) / 1000 : 0, frames = t0 && t1 ? t1.frames - t0.frames : 0;
      const r = t0 && t1 ? { view, frames, fps: +(frames / secs).toFixed(1), gpuProcessMsPerFrame: +((t1.gpu - t0.gpu) / frames).toFixed(2), rendererMsPerFrame: +((t1.renderer - t0.renderer) / frames).toFixed(2), gpuProcessCore: +((t1.gpu - t0.gpu) / 10 / secs).toFixed(1), rendererCore: +((t1.renderer - t0.renderer) / 10 / secs).toFixed(1) } : { view };
      // and with the world at rest (no frame drawn): what the page does besides the world
      const s0 = await sample(); await sleep(4000); const s1 = await sample();
      r.idle = s0 && s1 ? { gpuProcessCore: +((s1.gpu - s0.gpu) / 10 / ((s1.at - s0.at) / 1000)).toFixed(1), rendererCore: +((s1.renderer - s0.renderer) / 10 / ((s1.at - s0.at) / 1000)).toFixed(1) } : null;
      (result.live ||= []).push(r);
      log(`LIVE ${view} ${JSON.stringify(r)} (core: % of one processor core)`);
    }
  }

  // ---- the sound of the world: the renderer's processor time with the world at rest, with and without the audio ----------
  if (parts.has('sound')) {
    const rest = async () => { await sleep(2000); const a = Date.now(), s0 = procTimes(profile), b = Date.now(); await sleep(5000); const c = Date.now(), s1 = procTimes(profile), d = Date.now(); return s0 && s1 ? +((s1.renderer - s0.renderer) / 10 / (((c + d) - (a + b)) / 2000)).toFixed(1) : null; };
    await page.evaluate(() => { window.__ph.w.stop(); });
    const state = await page.evaluate(() => { const a = window.__app.ctx.audio; return { state: a.ctx?.state, record: a.current?.id, layers: Object.keys(a.scape?.layers || {}) }; });
    const on = await rest();
    await page.evaluate(() => window.__app.ctx.audio.suspend());
    const off = await rest();
    await page.evaluate(() => window.__app.ctx.audio.resume());
    result.sound = { ...state, rendererCore: on, suspended: off, audio: on != null && off != null ? +(on - off).toFixed(1) : null };
    log(`SOUND ${JSON.stringify(result.sound)} (renderer, % of one processor core, the world at rest)`);
  }

  // ---- the running loop, slowed down: the frames as the display gets them -------------------------------------------------
  if (parts.has('loop')) {
    // per view (PH_LOOP_VIEWS): the player stands and looks round slowly (a finger dragging), the world's own loop
    // runs at its cap with the processor slowed down
    result.loop = [];
    for (const view of (process.env.PH_LOOP_VIEWS || 'hall,room,shelves,terrace').split(',').filter((v) => VIEWS[v])) {
      await page.evaluate(async ([pose]) => { const P = window.__ph; P.cond({ hour: 11, weather: 'clear' }); await P.view(...pose, 10); }, [VIEWS[view]]);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      const r = await page.evaluate(async ([ms]) => {
        const P = window.__ph, w = P.w;
        const raf = [], work = [];
        let on = true;
        const tick = (t) => { if (!on) return; raf.push(t); requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        const f = w.frame;
        w.frame = function (...a) { const t = performance.now(); const res = f.apply(this, a); work.push([t, performance.now() - t]); return res; };
        const long = [];
        let obs = null;
        try { obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(Math.round(e.duration)); }); obs.observe({ type: 'longtask', buffered: false }); } catch {}
        const yaw0 = w.player.yaw, t0 = performance.now();
        const turn = setInterval(() => { w.player.yaw = yaw0 + 0.35 * Math.sin((performance.now() - t0) / 1000 * 0.8); }, 16);
        w.resetFrameStats(); w.start();
        await P.wait(ms);
        clearInterval(turn); w.player.yaw = yaw0;
        w.stop(); on = false; w.frame = f; obs?.disconnect();
        const iv = []; for (let i = 1; i < raf.length; i++) iv.push(raf[i] - raf[i - 1]);
        const drawn = []; for (let i = 1; i < work.length; i++) drawn.push(work[i][0] - work[i - 1][0]);
        return { rafHz: +(1000 / P.stats(iv).p50).toFixed(1), drawnInterval: P.stats(drawn), fps: +(work.length / (ms / 1000)).toFixed(1), frameWork: P.stats(work.map((x) => x[1])), longTasks: long.length, longest: Math.max(0, ...long) };
      }, [loopMs]);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      result.loop.push({ view, throttle, ...r });
      log(`LOOP x${throttle} ${view} fps=${r.fps} interval=${r.drawnInterval?.p50}/${r.drawnInterval?.p90} work=${r.frameWork?.p50}/${r.frameWork?.p90} long=${r.longTasks} ${JSON.stringify(r)}`);
    }
  }

  // ---- garbage per frame ------------------------------------------------------------------------------------------------
  if (parts.has('alloc')) {
    for (const view of ['hall', 'terrace'].filter((v) => views.includes(v))) {
      await page.evaluate(async ([pose]) => { const P = window.__ph; P.cond({ hour: 11, weather: 'clear' }); await P.view(...pose, 10); }, [VIEWS[view]]);
      await cdp.send('HeapProfiler.enable');
      await cdp.send('HeapProfiler.collectGarbage');
      await cdp.send('HeapProfiler.startSampling', { samplingInterval: 1024, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      const frames = 200;
      await page.evaluate(async (n) => { const P = window.__ph; for (let i = 0; i < n; i++) { P.w.frame(); P.sync(); if (i % 20 === 19) await P.wait(1); } }, frames);
      const { profile } = await cdp.send('HeapProfiler.stopSampling');
      await cdp.send('HeapProfiler.disable');
      // the bytes per function (self), the whole tree summed
      const per = new Map(); let total = 0;
      const walk = (n, stack) => { const cf = n.callFrame; const name = `${cf.functionName || '(anon)'} ${(cf.url || '').replace(/^.*\//, '')}:${cf.lineNumber}`; if (n.selfSize) { total += n.selfSize; per.set(name, (per.get(name) || 0) + n.selfSize); } for (const c of n.children || []) walk(c, stack); };
      walk(profile.head, []);
      const top = [...per.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => [Math.round(v / frames), k]);
      const r = { view, frames, bytesPerFrame: Math.round(total / frames), top };
      result.alloc.push(r);
      log(`ALLOC ${view} ${r.bytesPerFrame} B/frame ${JSON.stringify(top.slice(0, 8))}`);
    }
  }

  const after = await page.evaluate(() => ({ programs: window.__app.world.renderer.info.programs.length, memory: { ...window.__app.world.renderer.info.memory } }));
  result.after = after;
  log(`AFTER ${JSON.stringify(after)} (programs ${setup.programs} at the start)`);
  fs.writeFileSync(path.join(outDir, `phone-perf-${tag}.json`), JSON.stringify(result, null, 1));
  log(`DONE phone-perf ${tag}`);
};
module.exports.procTimes = procTimes;
