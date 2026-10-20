// The check of the Android app on an emulator (npm run test:android): the debug APK is installed, a test library is
// pushed to the device and handed to the app as a plain folder (the debug build's USE_FOLDER broadcast, the same
// listing and serving code as a folder from the system picker), and the page is driven through the EVAL broadcast
// of the debug build (android/app/src/debug/.../DebugHooks.kt): the page starts with the Android backend, the folder
// goes through the bridge, the shelves fill, the world draws (screencap, a varied picture), the stick moves and a
// drag turns the player, a book opens in the reader, the back button closes it, the app survives home and back,
// a rotation in the reader, and a force-stop with its settings, folder and reading position; the release APK starts
// and draws too when it is there. The emulator is never shown and never heard: start it yourself headless
// (docs/strands/android.md) or set ANDROID_START=1.
// Env: ANDROID_SERIAL (default emulator-5600), ANDROID_APK (default dist/android/cozy-shelves-<version>-debug.apk),
//      ANDROID_RELEASE_APK (default the release APK next to it, skipped when missing), ANDROID_BOOKS (the test library,
//      default $SCRATCHW/testbooks2 or build/testlib/books), SHOT_DIR (default shots/android), ANDROID_START=1 (starts
//      `emulator -avd $ANDROID_AVD` (Medium_Phone_API_35) on the port of the serial, headless, and stops it at the end),
//      ANDROID_SDK (default ANDROID_HOME or %LOCALAPPDATA%\Android\Sdk), VERBOSE=1 (every console line of the page).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { decode } = require('./scripts/png-lite.js');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const serial = process.env.ANDROID_SERIAL || 'emulator-5600';
const sdk = process.env.ANDROID_SDK || process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : path.join(os.homedir(), 'Android', 'Sdk'));
const adbBin = fs.existsSync(path.join(sdk, 'platform-tools', 'adb.exe')) ? path.join(sdk, 'platform-tools', 'adb.exe') : fs.existsSync(path.join(sdk, 'platform-tools', 'adb')) ? path.join(sdk, 'platform-tools', 'adb') : 'adb';
const apk = process.env.ANDROID_APK || path.join(root, 'dist', 'android', `cozy-shelves-${pkg.version}-debug.apk`);
const releaseApk = process.env.ANDROID_RELEASE_APK || path.join(root, 'dist', 'android', `cozy-shelves-${pkg.version}-release.apk`);
const outDir = process.env.SHOT_DIR || path.join(root, 'shots', 'android');
const books = process.env.ANDROID_BOOKS || [path.join(process.env.SCRATCHW || '', 'testbooks2'), path.join(root, 'build', 'testlib', 'books')].find((p) => p && fs.existsSync(p));
const PKG = 'com.cozyshelves.app';
const DEVICE_BOOKS = '/sdcard/Documents/Testbuecher';
const SCAN_TIMEOUT = +(process.env.ANDROID_SCAN_TIMEOUT || 420000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (args, opts = {}) => execFileSync(adbBin, ['-s', serial, ...args], { encoding: opts.binary ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', opts.quiet ? 'ignore' : 'pipe'], ...opts });
const shell = (cmd, opts) => adb(['shell', cmd], opts).toString().trim();
const tryShell = (cmd) => { try { return shell(cmd, { quiet: true }); } catch { return ''; } };
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ' · ' + detail : ''}`); return !!ok; };

// ---- the page through the EVAL broadcast ----------------------------------------------------------------------------
let evalId = 0;
/** Runs `body` (the body of an async function, with a `return`) in the page and gives its result back (JSON). */
async function evalPage(body, { timeout = 20000 } = {}) {
  const id = 'e' + (++evalId) + Date.now().toString(36);
  const js = `(async()=>{try{const r=await (async()=>{${body}})();CozyDebug.result('${id}',JSON.stringify(r===undefined?null:r))}catch(e){CozyDebug.result('${id}',JSON.stringify({__error:String(e&&e.stack||e)}))}})();'sent'`;
  adb(['shell', 'am', 'broadcast', '-a', `${PKG}.EVAL`, '--es', 'id', id + 's', '--es', 'js64', Buffer.from(js, 'utf8').toString('base64')], { quiet: true });
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const log = adb(['logcat', '-d', '-s', 'CozyEval:I'], { quiet: true });
    // every line ends in \r on Windows, which `.` does not match: trimmed first
    const m = log.split('\n').map((l) => l.trim().match(/CozyEval\s*:\s*(\S+) (.*)$/)).find((x) => x && x[1] === id);
    if (m) {
      let v;
      try { v = JSON.parse(m[2].trim()); } catch { v = m[2].trim(); }
      if (v && typeof v === 'object' && v.__error) throw new Error('page: ' + v.__error.split('\n')[0]);
      return v;
    }
    await sleep(250);
  }
  throw new Error('no answer from the page for: ' + body.slice(0, 80));
}
async function waitFor(body, { timeout = 60000, every = 1000, label = body.slice(0, 60) } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try { last = await evalPage(body, { timeout: 15000 }); if (last) return last; } catch (e) { last = e.message; }
    await sleep(every);
  }
  throw new Error(`timeout waiting for ${label} (last: ${JSON.stringify(last).slice(0, 200)})`);
}
/** A screenshot of the device (screencap -p) into SHOT_DIR; returns the PNG buffer. */
function shot(name) {
  const png = adb(['exec-out', 'screencap', '-p'], { binary: true, quiet: true });
  fs.writeFileSync(path.join(outDir, `${name}.png`), png);
  console.log('shot', name, `(${(png.length / 1024).toFixed(0)} KB)`);
  return png;
}
/** How varied a picture is: the share of 8 × 8 cells whose mean differs from the overall mean (as in web-check). */
function variety(png) {
  const { width, height, data } = decode(png);
  const cells = [];
  for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) {
    let s = 0, n = 0;
    for (let y = Math.floor(cy * height / 8); y < Math.floor((cy + 1) * height / 8); y += 6) for (let x = Math.floor(cx * width / 8); x < Math.floor((cx + 1) * width / 8); x += 6) { const i = (y * width + x) * 4; s += data[i] + data[i + 1] + data[i + 2]; n += 3; }
    cells.push(s / n);
  }
  const mean = cells.reduce((a, b) => a + b, 0) / cells.length;
  return { mean: Math.round(mean), varied: cells.filter((c) => Math.abs(c - mean) > 12).length / cells.length };
}
/** CSS coordinates of the page → device pixels: devicePixelRatio times the zoom of the page (the page is zoomed out
 *  on a phone, main-web.js, which devicePixelRatio does not carry but visualViewport.scale does). */
const px = (v, dpr) => Math.round(v * dpr);
async function pageMetrics() {
  return evalPage(`const r = document.querySelector('.th-stick')?.getBoundingClientRect(); const u = document.querySelector('.th-use')?.getBoundingClientRect(); const rd = document.querySelector('.th-read')?.getBoundingClientRect();
    return { dpr: devicePixelRatio * (window.visualViewport ? visualViewport.scale : 1), w: innerWidth, h: innerHeight, stick: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null, use: u ? { x: u.left + u.width / 2, y: u.top + u.height / 2 } : null, read: rd ? { x: rd.left + rd.width / 2, y: rd.top + rd.height / 2 } : null };`);
}
/** "All files access" for the debug build's test folder, checked: the install resets the app ops a moment after it
 *  reports success, so one `appops set` right after it is lost. */
async function grantAllFiles() {
  for (let i = 0; i < 10; i++) {
    tryShell(`appops set ${PKG} MANAGE_EXTERNAL_STORAGE allow`);
    await sleep(700);
    if (/: allow/.test(tryShell(`appops get ${PKG} MANAGE_EXTERNAL_STORAGE`))) return true;
  }
  return false;
}
async function startApp() {
  shell(`am start -W -n ${PKG}/.MainActivity`, { quiet: true });
  await waitFor('return !!(window.__app && document.querySelector(".menu-btn.primary"))', { timeout: 180000, every: 1500, label: 'the page' });
}
/** The system's "Viewing full screen" note over the app (Android reads immersive_mode_confirmations only at its start,
 *  so on a freshly booted emulator the note may come anyway, and it takes the taps meant for the app): "Got it". */
async function dismissSystemNote() {
  for (let i = 0; i < 3; i++) {
    const xml = tryShell('uiautomator dump /sdcard/cz-ui.xml >/dev/null 2>&1; cat /sdcard/cz-ui.xml');
    const m = xml.match(/text="(Got it|Verstanden|OK)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!m) return i > 0;
    shell(`input tap ${Math.round((+m[2] + +m[4]) / 2)} ${Math.round((+m[3] + +m[5]) / 2)}`, { quiet: true });
    console.log('  ..   the full-screen note of the system dismissed');
    await sleep(1000);
  }
  return true;
}
async function libraryState() {
  return evalPage(`const l = window.__cozyshelvesWeb.library; const books = Object.values(l.books).filter((b) => !b.missing);
    return { n: books.length, active: !!l.scanState.active, phase: l.scanState.phase, done: l.scanState.done, total: l.scanState.total, indexed: books.filter((b) => b.indexed).length, queue: l.queue.length, scanning: !!l._scanning, sources: [...l.sources.values()].map((s) => ({ kind: s.kind, name: s.name, available: s.available })) };`);
}

function listFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, base, out);
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

// ---- the emulator ------------------------------------------------------------------------------------------------------
let emulatorProc = null;
/** adb install in up to three tries: right after a cold boot the package manager may still turn an install down
 *  (the system updates its own apps then); the last answer, or the last error's text, comes back */
async function install(file) {
  let last = '';
  for (let i = 0; i < 3; i++) {
    try { last = adb(['install', '-r', '-g', file], { quiet: true }).toString(); if (/Success/.test(last)) return last; } catch (e) { last = String(e.stdout || e.message); }
    console.log(`  (install of ${path.basename(file)} failed, try ${i + 1}: ${last.trim().split('\n').pop().slice(0, 160)})`);
    await sleep(20000);
  }
  return last;
}

async function ensureDevice() {
  const devices = () => { try { return execFileSync(adbBin, ['devices'], { encoding: 'utf8' }).split('\n').map((l) => l.trim()).filter((l) => /\tdevice$/.test(l)).map((l) => l.split('\t')[0]); } catch { return []; } };
  if (!devices().includes(serial)) {
    if (process.env.ANDROID_START !== '1') throw new Error(`device ${serial} is not connected (start the emulator headless, or ANDROID_START=1)`);
    const port = +(serial.match(/-(\d+)$/) || [])[1] || 5600;
    const emu = fs.existsSync(path.join(sdk, 'emulator', 'emulator.exe')) ? path.join(sdk, 'emulator', 'emulator.exe') : path.join(sdk, 'emulator', 'emulator');
    const avd = process.env.ANDROID_AVD || 'Medium_Phone_API_35';
    console.log(`starting the emulator ${avd} on port ${port} (headless, muted)`);
    emulatorProc = spawn(emu, ['-avd', avd, '-read-only', '-port', String(port), '-no-window', '-no-audio', '-no-boot-anim', '-gpu', 'host', '-no-snapshot-load', '-no-snapshot-save', '-memory', '4096'], { detached: true, stdio: 'ignore' });
    emulatorProc.unref();
    for (let i = 0; i < 120 && !devices().includes(serial); i++) await sleep(2000);
    if (!devices().includes(serial)) throw new Error('the emulator did not come up');
  }
  // the package manager comes later than sys.boot_completed
  for (let i = 0; i < 120; i++) { if (/^package:/.test(tryShell('pm path android'))) break; await sleep(3000); }
  if (!/^package:/.test(tryShell('pm path android'))) throw new Error('the device did not finish booting');
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(apk)) throw new Error('no debug APK at ' + apk + ' (run `npm run build:android` first)');
  if (!books) throw new Error('no test library: set ANDROID_BOOKS');
  await ensureDevice();
  console.log(`device ${serial}: Android ${tryShell('getprop ro.build.version.release')} (API ${tryShell('getprop ro.build.version.sdk')}), ${tryShell('wm size').replace(/.*: /, '')}`);
  // no animations, no "viewing full screen" dialogue of the system, the home screen clean
  tryShell('settings put global window_animation_scale 0; settings put global transition_animation_scale 0; settings put global animator_duration_scale 0');
  tryShell('settings put secure immersive_mode_confirmations confirmed');
  tryShell('settings put system accelerometer_rotation 0; settings put system user_rotation 1');

  // ---- 1. install and the test library -----------------------------------------------------------------------------
  tryShell(`pm uninstall ${PKG}`);
  const inst = await install(apk);
  check('debug APK installs', /Success/.test(inst), `${path.basename(apk)}, ${(fs.statSync(apk).size / 1048576).toFixed(1)} MB`);
  // the debug build reads a plain folder with "all files access" (its manifest asks for it; release builds do not);
  // the install resets the app ops a moment after it reports success, so the grant is checked and set again
  await grantAllFiles();
  tryShell(`rm -rf ${DEVICE_BOOKS}; mkdir -p ${DEVICE_BOOKS}`);
  // right after a cold boot the shared storage may not take files yet: a few tries, and adb's own message if all fail
  for (let k = 1; ; k++) {
    try { adb(['push', books + path.sep + '.', DEVICE_BOOKS], { quiet: true }); break; }
    catch (e) {
      if (k >= 3) throw new Error('adb push failed: ' + String(e.stderr || e.stdout || e.message).trim().slice(0, 400));
      await new Promise((r) => setTimeout(r, 5000));
      tryShell(`mkdir -p ${DEVICE_BOOKS}`);
    }
  }
  const expected = listFiles(books).filter((f) => /\.(pdf|epub|mobi|azw3|fb2|cbz|txt|md|html?)$/i.test(f)).length;
  const onDevice = +tryShell(`find ${DEVICE_BOOKS} -type f | wc -l`) || 0;
  check('test library on the device', onDevice >= expected, `${onDevice} files under ${DEVICE_BOOKS}`);

  // ---- 2. the app starts with the Android backend -----------------------------------------------------------------
  adb(['logcat', '-c'], { quiet: true });
  const t0 = Date.now();
  await startApp();
  const boot = await evalPage(`try { await new Promise((r) => setTimeout(r, 1500)); } catch {}
    const gl = (() => { try { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); } catch { return null; } })();
    return { platform: window.api.platform, android: !!window.__cozyshelvesWeb.android, bridge: !!window.AndroidBooks, version: window.api.version, secure: window.isSecureContext, origin: location.origin, gl, welcome: !!document.querySelector('.welcome-card'), folders: (await window.api.settings.get()).folders.length, touch: !!document.querySelector('#hud.touch'), vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, graphics: (await window.api.settings.get()).graphics };`);
  console.log('BOOT ' + JSON.stringify(boot) + ' in ' + (Date.now() - t0) + ' ms');
  check('page starts with the Android backend', boot.platform === 'android' && boot.android && boot.bridge && boot.secure, `version ${boot.version}, ${boot.origin}, WebGL ${boot.gl}`);
  check('phone preset: the quality mobile, 30 fps cap, zoomed-out page', boot.graphics?.quality === 'mobile' && boot.graphics?.resolutionScale === 1 && boot.graphics?.frameCap === 30 && boot.vh >= 500, `${boot.vw}×${boot.vh} CSS px, dpr ${(+boot.dpr).toFixed(2)}, resolution ${boot.graphics?.resolutionScale}`);
  check('welcome card asks for a folder, touch HUD attached', boot.welcome && boot.folders === 0 && boot.touch);
  shot('android-start');

  // ---- 3. the folder through the bridge ----------------------------------------------------------------------------
  check('all files access granted to the debug build', await grantAllFiles());
  adb(['shell', 'am', 'broadcast', '-a', `${PKG}.USE_FOLDER`, '--es', 'path', DEVICE_BOOKS], { quiet: true });
  const src = await waitFor(`const l = window.__cozyshelvesWeb.library; const s = [...l.sources.values()][0]; return s && s.kind === 'bridge' ? { name: s.name, key: s.key, available: s.available, folders: (await window.api.settings.get()).folders } : null;`, { timeout: 30000, label: 'the bridge source' });
  check('folder accepted through the bridge', src.available && src.folders.length === 1 && src.folders[0].kind === 'bridge' && src.folders[0].key === src.key, JSON.stringify(src.folders));
  // "Später" closes the welcome card and leaves the start menu underneath (the folder is set already)
  await evalPage(`window.__app.ctx.bus.emit('welcome:folder', ${JSON.stringify(src.folders)}); [...document.querySelectorAll('.welcome-card button')].find((b) => /später|later/i.test(b.textContent))?.click(); return true;`);
  let st = null;
  for (const start = Date.now(); Date.now() - start < SCAN_TIMEOUT;) {
    st = await libraryState();
    if (st.n > 0 && !st.active && !st.scanning && st.indexed === st.n && !st.queue) break;
    await sleep(2000);
  }
  console.log('SCAN ' + JSON.stringify(st) + ' in ' + (Date.now() - t0) + ' ms');
  check('all books listed through the bridge and indexed', st && st.n === expected && st.indexed === st.n && !st.active, `${st?.n} of ${expected} files, ${st?.indexed} indexed`);
  // one book through fetch(): the served file has the size the listing said
  const served = await evalPage(`const l = window.__cozyshelvesWeb.library; const b = Object.values(l.books).find((x) => !x.missing); const f = await l.fileOf(b.id); return { name: f?.name, size: f?.size, expected: b.size, type: f?.type };`);
  check('a book file is served to the page', served.name && served.size === served.expected && served.size > 0, `${served.name}: ${served.size} bytes, ${served.type}`);

  // ---- 4. the world: shelves, the picture --------------------------------------------------------------------------
  await evalPage(`await new Promise((r) => setTimeout(r, 300)); window.__app.state.library = await window.api.library.getState(); document.querySelector('.menu-btn.primary')?.click(); return true;`);
  await waitFor('return window.__app.state.entered && (window.__app.world.books?.entries?.size || 0) > 0', { timeout: 60000, label: 'the shelves' });
  await sleep(3000);
  const world = await evalPage(`const w = window.__app.world, s = window.__app.state.library;
    const gl = w.renderer.getContext();
    return { entered: window.__app.state.entered, running: w.running, cases: w.layout?.bookcases?.length || 0, entries: w.books?.entries?.size || 0, deps: s.departments.map((d) => d.name + ':' + d.count), covers: s.books.filter((b) => b.hasCover).length, cap: w.frameCap, hud: !!document.querySelector('#hud.touch .touch-hud'), hudShown: getComputedStyle(document.querySelector('.touch-hud')).display, panel: !!document.querySelector('.panel-layer'), mobile: !!w.mobile, quality: w.quality, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], aniso: w.renderer.capabilities.getMaxAnisotropy(), antialias: gl.getContextAttributes().antialias, lights: (() => { let n = 0; w.scene.traverseVisible((o) => { if (o.isPointLight && o.layers.mask !== 0) n++; }); return n; })(), zones: w.mobileTier?.stats?.zones };`);
  console.log('WORLD ' + JSON.stringify(world));
  check('library entered, world running at the frame cap', world.entered && world.running && world.cap === 30);
  // the quality 'mobile' (world.js): drawn as 'low', at most 0.6 million pixels on a phone, anisotropic filtering up to 4
  const pixels = world.buffer[0] * world.buffer[1];
  check('the world draws with the quality mobile and its budget of pixels', world.mobile && world.quality === 'low' && pixels <= 0.62e6 && pixels >= 0.4e6 && world.aniso <= 4, `${world.buffer.join('×')} = ${(pixels / 1e6).toFixed(2)} million pixels, anisotropy ${world.aniso}`);
  // (mobile.js: four point lights in the shaders, the canvas without multisampling, the zones culled through the openings)
  check('the quality mobile: no multisampling, four point lights, the zones culled', world.antialias === false && world.lights === 4 && /^[-PF]{4}$/.test(world.zones || ''), JSON.stringify({ antialias: world.antialias, lights: world.lights, zones: world.zones }));
  check('shelves filled through the bridge', world.cases > 0 && world.entries > 0, `${world.cases} cases, ${world.entries} books, ${world.deps.length} departments`);
  check('touch HUD shown in the world', world.hud && world.hudShown !== 'none' && !world.panel);
  const png = shot('android-world');
  const v = variety(png);
  check('the world draws a picture', v.varied > 0.25 && v.mean > 8, `mean ${v.mean}, varied ${(v.varied * 100).toFixed(0)} %`);
  const fps = await evalPage(`await new Promise((r) => setTimeout(r, 4000)); return window.__app.world.frameStats();`);
  check('frame time measured', fps && fps.n > 10, fps ? `median ${fps.median.toFixed(1)} ms over ${fps.n} frames (cap ${fps.cap})` : 'none');
  // the memory of the app and of the WebView's renderer (its own sandboxed process) with the library indexed
  // the WebView's renderer is a sandboxed process of the WebView provider (com.google.android.webview:sandboxed_process0…)
  const procs = tryShell('ps -A -o PID,NAME').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p[1] && (p[1].startsWith(PKG) || /webview:sandboxed_process/.test(p[1])));
  const mem = procs.map(([pid, name]) => { const m = tryShell(`dumpsys meminfo ${pid} | grep -m1 "TOTAL PSS"`).match(/TOTAL PSS:\s*(\d+)/); return { name: name.replace(PKG, 'app').replace(/^.*webview:sandboxed_process(\d+).*$/, 'renderer $1'), mb: m ? Math.round(+m[1] / 1024) : null }; });
  console.log(`MEMORY ${mem.reduce((a, p) => a + (p.mb || 0), 0)} MB PSS: ` + mem.map((p) => `${p.name} ${p.mb} MB`).join(', '));

  // ---- 5. touch: a drag turns, the stick walks, the read button opens the reader -------------------------------------
  await dismissSystemNote();
  const m = await pageMetrics();
  const before = await evalPage('const p = window.__app.world.player; return { yaw: p.yaw, x: p.position?.x ?? p.object?.position?.x ?? null, z: p.position?.z ?? p.object?.position?.z ?? null };');
  const cx = px(m.w * 0.7, m.dpr), cy = px(m.h * 0.45, m.dpr);
  shell(`input swipe ${cx} ${cy} ${cx - px(160, m.dpr)} ${cy} 400`, { quiet: true });
  await sleep(600);
  const afterLook = await evalPage('return window.__app.world.player.yaw;');
  check('a drag on the right half turns the view', Math.abs(afterLook - before.yaw) > 0.05, `yaw ${before.yaw.toFixed(2)} → ${afterLook.toFixed(2)}`);
  check('the stick and the buttons are on the screen', m.stick && m.use && m.read && m.stick.x < m.w / 2 && m.use.x > m.w / 2, JSON.stringify({ stick: m.stick, use: m.use }));
  const pos = async () => evalPage('const p = window.__app.world.player; const o = p.position || p.object?.position || p.camera?.position || window.__app.world.camera.position; return [o.x, o.z];');
  const p0 = await pos();
  shell(`input swipe ${px(m.stick.x, m.dpr)} ${px(m.stick.y, m.dpr)} ${px(m.stick.x, m.dpr)} ${px(m.stick.y - 40, m.dpr)} 1500`, { quiet: true });
  await sleep(500);
  const p1 = await pos();
  const walked = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  check('the stick walks the player', walked > 0.3, `${walked.toFixed(2)} m`);
  const stickRest = await evalPage('return { pad: window.__app.world.player.pad, stick: window.__app.touch.stick.x + "," + window.__app.touch.stick.y };');
  check('the stick rests when released', !stickRest.pad && stickRest.stick === '0,0', JSON.stringify(stickRest));
  // aiming at a thing on the phone: the ring opens, the name below the crosshair stays away (hud.js NO_LOOK_LABEL)
  const look = await evalPage(`const on = window.__app.world.opts.onTarget; on({ type: 'interact', kind: 'computer', distance: 1 }); const r = { ring: document.querySelector('#crosshair').classList.contains('active'), label: document.querySelector('#look-label').classList.contains('show') }; on(null); return r;`);
  check('aiming at a thing shows the ring without a name', look.ring && !look.label, JSON.stringify(look));
  // the world map: OpenStreetMap's tiles in the WebView (a handful of real tiles, as one person looking at the map);
  // without a connection in the emulator the panel's note counts as an answer too, with the reason in the detail
  await evalPage(`window.__app.openPanel('worldmap', {}); return true;`);
  const map = await waitFor(`const p = document.querySelector('.wm-panel')?.__wm; if (!p) return null; const s = p.stats(), st = p.state(); return s.tiles >= 6 || st.offline ? { tiles: s.tiles, loaded: s.loaded, failed: s.failed, offline: st.offline, zoom: s.zoom, hint: document.querySelector('.wm-hint')?.textContent || '' } : null;`, { timeout: 30000, label: 'the world map tiles' }).catch(() => null);
  if (map && !map.offline) shot('android-worldmap');
  check('the world map shows OpenStreetMap tiles', map && (map.tiles >= 6 || map.offline), map ? (map.offline ? 'no connection in the emulator: the note shows' : `${map.tiles} tiles at zoom ${map.zoom}`) : 'no answer');
  check('the hint of the map speaks of tapping, not of a mouse', map && /Tippen|Tap/.test(map.hint) && !/Mausrad|Wheel/.test(map.hint), map?.hint);
  await evalPage(`window.__app.closeAllPanels(); return true;`);
  await sleep(800);
  // a book in front of the crosshair, then the read button of the HUD
  const pick = await evalPage(`const s = window.__app.state.library; const b = s.books.find((x) => x.format === 'epub') || s.books.find((x) => x.format === 'txt') || s.books[0]; window.__app.world.actions.goToBook(b.id); return { id: b.id, title: b.title, format: b.format };`);
  const aimed = await waitFor(`const t = window.__app.world.actions.target; return t && (t.type === 'book' || t.type === 'tablebook') ? { type: t.type, id: t.book?.id || t.id } : null;`, { timeout: 15000, label: 'a book under the crosshair' }).catch(() => null);
  check('the crosshair rests on a book after goToBook', !!aimed, JSON.stringify(aimed));
  shell(`input tap ${px(m.read.x, m.dpr)} ${px(m.read.y, m.dpr)}`, { quiet: true });
  // a reader that never finishes loading is a failed check, not the end of the run
  await waitFor(`return !!document.querySelector('.panel-layer[data-panel="reader"]') && !document.querySelector('.rd-loading')`, { timeout: 60000, label: 'the reader' }).catch((e) => console.log('  ..   ' + e.message));
  await sleep(2000);
  const reader = await evalPage(`const layer = document.querySelector('.panel-layer[data-panel="reader"]'); const frames = [...layer.querySelectorAll('iframe')];
    let text = 0; for (const f of frames) { try { text += (f.contentDocument?.body?.innerText || '').trim().length; } catch {} }
    const fv = layer.querySelector('foliate-view'); if (fv) { try { const doc = fv.renderer?.getContents?.()?.[0]?.doc; text += (doc?.body?.innerText || '').trim().length; } catch {} }
    text += (layer.querySelector('.rd-textview, .rd-text, .tv-page')?.innerText || '').trim().length;
    return { title: layer.querySelector('.rd-title')?.textContent || '', text, error: document.querySelector('.panel-error')?.textContent?.slice(0, 120) || null, hudHidden: getComputedStyle(document.querySelector('.touch-hud')).display === 'none', paused: window.__app.world.background };`);
  shot('android-reader');
  check(`reader opens "${pick.title}" (${pick.format}) from the read button`, !reader.error && reader.text > 20 && reader.hudHidden, reader.error || `${reader.text} characters, title "${reader.title}", world ${reader.paused}`);
  // a page turn by a tap on the right edge of the page
  const rz = await evalPage(`const z = document.querySelector('.rd-zone-right')?.getBoundingClientRect(); return z ? { x: z.left + z.width / 2, y: z.top + z.height / 2 } : null;`);
  const bookBefore = await evalPage(`const b = await window.api.library.book('${pick.id}'); return { progress: b.progress, loc: b.lastLocation };`);
  if (rz) { shell(`input tap ${px(rz.x, m.dpr)} ${px(rz.y, m.dpr)}`, { quiet: true }); await sleep(1500); }
  const bookAfter = await evalPage(`const b = await window.api.library.book('${pick.id}'); return { progress: b.progress, loc: b.lastLocation, opened: b.timesOpened };`);
  check('a tap on the page edge turns the page, the position is saved', !!rz && bookAfter.opened >= 1 && !!bookAfter.loc && (bookAfter.progress || 0) >= (bookBefore.progress || 0), `progress ${((bookAfter.progress || 0) * 100).toFixed(1)} %`);

  // ---- 6. rotation in the reader, the back button -------------------------------------------------------------------
  tryShell('settings put system user_rotation 0');
  await sleep(2500);
  const portrait = await evalPage('return { w: innerWidth, h: innerHeight, reader: !!document.querySelector(\'.panel-layer[data-panel="reader"]\'), app: !!window.__app };');
  shot('android-reader-portrait');
  check('the reader turns with the phone, the page survives the rotation', portrait.h > portrait.w && portrait.reader && portrait.app, `${portrait.w}×${portrait.h}`);
  tryShell('settings put system user_rotation 1');
  await sleep(2000);
  shell('input keyevent 4', { quiet: true });   // back: the reader closes
  await sleep(1500);
  const b1 = await evalPage(`const b = await window.api.library.book('${pick.id}'); return { panel: document.querySelector(".panel-layer:last-of-type")?.dataset?.panel || null, w: innerWidth, h: innerHeight, running: window.__app.world.running, loc: b?.lastLocation };`);
  check('back closes the reader, the world is landscape again', b1.panel === null && b1.w > b1.h && b1.running, JSON.stringify({ ...b1, loc: undefined }));
  // the position the reader saved last (the rotation laid the page out again, which moved the CFI a little)
  const locAtClose = b1.loc;
  shell('input keyevent 4', { quiet: true });   // back: the menu opens
  await sleep(1500);
  const b2 = await evalPage('return document.querySelector(".panel-layer:last-of-type")?.dataset?.panel || null;');
  check('back in the world opens the menu', b2 === 'menu', String(b2));
  shot('android-menu');
  shell('input keyevent 4', { quiet: true });   // back: the menu closes
  await sleep(1200);
  const b3 = await evalPage('return { panel: document.querySelector(".panel-layer:last-of-type")?.dataset?.panel || null, hud: getComputedStyle(document.querySelector(".touch-hud")).display };');
  check('back closes the menu, the HUD is back', b3.panel === null && b3.hud !== 'none', JSON.stringify(b3));

  // ---- 7. home and back: the world rests, the app goes on ----------------------------------------------------------------
  await evalPage(`await window.api.settings.set({ reader: { fontSize: 21 } }); return true;`);
  shell('input keyevent 3', { quiet: true });   // home
  await sleep(2500);
  const hidden = await evalPage('return { hidden: document.hidden, running: window.__app.world.running };', { timeout: 15000 }).catch((e) => ({ error: e.message }));
  const activityPaused = !tryShell('dumpsys activity activities | grep -m1 topResumedActivity').includes(PKG);
  check('in the background the page is hidden and the world rests', (hidden.hidden && !hidden.running) || (hidden.error && activityPaused), JSON.stringify(hidden));
  shell(`am start -n ${PKG}/.MainActivity`, { quiet: true });
  await sleep(2500);
  const back = await evalPage('return { hidden: document.hidden, running: window.__app.world.running, entered: window.__app.state.entered, books: window.__app.state.library.books.length };');
  check('back from the home screen the world runs on', !back.hidden && back.running && back.entered && back.books === expected, JSON.stringify(back));
  shot('android-resumed');

  // ---- 8. a force-stop: settings, the folder and the reading position come back ----------------------------------------
  // (and the graphics of a phone of 0.10.1, quality 'low' at six tenths of the pixels, become 'mobile' once at the start)
  // (leaving 'mobile' builds the world anew in the running page: on a busy emulator that takes a while)
  await evalPage(`await window.api.settings.set({ graphics: { quality: 'low', resolutionScale: 0.6, tierSchema: 0 } }); return true;`, { timeout: 240000 });
  await evalPage('await window.__cozyshelvesWeb.flush(); return true;', { timeout: 120000 });
  shell(`am force-stop ${PKG}`, { quiet: true });
  await sleep(1500);
  adb(['logcat', '-c'], { quiet: true });
  // the plain test folder lives only in the process: the check hands it over again before the library looks for it
  await grantAllFiles();
  shell(`am start -W -n ${PKG}/.MainActivity`, { quiet: true });
  await waitFor('return !!(window.__app && document.querySelector(".menu-btn.primary"))', { timeout: 180000, every: 1500, label: 'the page after the restart' });
  // the page is there: the folder joins its records again (a folder from the system's picker needs none of this,
  // Android keeps its permission; the plain test folder lives only in the process)
  adb(['shell', 'am', 'broadcast', '-a', `${PKG}.USE_FOLDER`, '--es', 'path', DEVICE_BOOKS], { quiet: true });
  await waitFor('const l = window.__cozyshelvesWeb.library; const s = [...l.sources.values()][0]; return s && s.available && !l._scanning && !l.scanState.active ? true : null;', { timeout: 60000, label: 'the folder after the restart' }).catch((e) => console.log('  ..   ' + e.message));
  await sleep(2000);
  const again = await evalPage(`const s = await window.api.settings.get(); const lib = window.__app.state.library; const b = await window.api.library.book('${pick.id}'); const l = window.__cozyshelvesWeb.library;
    return { graphics: s.graphics, mobile: !!window.__app.world.mobile, fontSize: s.reader?.fontSize, folders: s.folders.length, kind: s.folders[0]?.kind, books: lib.books.length, indexed: lib.books.filter((x) => x.indexed).length, loc: b?.lastLocation, welcome: !!document.querySelector('.welcome-card'), menuText: document.querySelector('.menu-btn.primary')?.textContent, reindexed: l.scanState.done, attention: l.attention() };`);
  console.log('RESTART ' + JSON.stringify(again));
  // the start menu offers the library again (no welcome card): "Bücherei betreten" or "Weiter" in either language
  check('settings survive a force-stop', again.fontSize === 21 && /betreten|weiter|enter|continue/i.test(again.menuText || ''), again.menuText);
  check('library and folder survive a force-stop', again.folders === 1 && again.kind === 'bridge' && again.books === expected && again.indexed === expected && !again.welcome && again.reindexed === 0 && !again.attention.length, `${again.books} books, reindexed ${again.reindexed}, attention ${JSON.stringify(again.attention)}`);
  check('reading position survives a force-stop', !!again.loc && again.loc === locAtClose, `${again.loc}`);
  check('the graphics of a phone of 0.10.1 become the quality mobile once', again.graphics?.quality === 'mobile' && again.graphics?.resolutionScale === 1 && again.graphics?.tierSchema === 1 && again.graphics?.frameCap === 30 && again.mobile, JSON.stringify(again.graphics));

  // ---- 9. the release APK starts and draws ---------------------------------------------------------------------------------
  if (fs.existsSync(releaseApk)) {
    tryShell(`pm uninstall ${PKG}`);
    const rel = await install(releaseApk);
    check('release APK installs', /Success/.test(rel), `${path.basename(releaseApk)}, ${(fs.statSync(releaseApk).size / 1048576).toFixed(1)} MB`);
    shell(`am start -W -n ${PKG}/.MainActivity`, { quiet: true });
    // (a first start paints its textures and compiles its programs: on a busy host that may take well over 25 s, so
    // the picture is looked at every ten seconds, up to two minutes)
    let rpng = null, rv = { varied: 0, mean: 0 };
    for (let t = 0; t < 12 && rv.varied <= 0.1; t++) { await sleep(t ? 10000 : 25000); await dismissSystemNote(); rpng = shot('android-release'); rv = variety(rpng); }
    const alive = !!tryShell(`pidof ${PKG}`) || tryShell('dumpsys activity activities | grep -m1 topResumedActivity').includes(PKG);
    check('release build starts and draws', alive && rv.varied > 0.1, `mean ${rv.mean}, varied ${(rv.varied * 100).toFixed(0)} %`);
    const evalRefused = await evalPage('return 1', { timeout: 6000 }).then(() => false).catch(() => true);
    check('release build has no EVAL hook', evalRefused);
    tryShell(`am force-stop ${PKG}`);
  } else console.log('no release APK at ' + releaseApk + ': skipped');

  // ---- 10. the console of the page --------------------------------------------------------------------------------------
  const log = adb(['logcat', '-d', '-s', 'CozyWeb:E', 'AndroidRuntime:E'], { quiet: true });
  const noise = log.split('\n').filter((l) => /CozyWeb|AndroidRuntime/.test(l) && !/android-webview-video-poster|favicon|KHR_parallel_shader_compile/.test(l));
  check('no errors in the page console after the restart', noise.length === 0, noise.slice(0, 3).join(' || ').slice(0, 300));

  const failed = results.filter((r) => !r.ok);
  console.log(`ANDROID-CHECK ${failed.length ? 'FAILED ' + failed.length + ' of ' + results.length : 'OK ' + results.length + ' checks'}; screenshots in ${outDir}`);
  if (emulatorProc) { try { adb(['emu', 'kill'], { quiet: true }); } catch {} }
  if (failed.length) process.exit(1);
})().catch((e) => {
  console.error('ANDROID-CHECK ERROR', e.message);
  try { shot('android-error'); } catch {}
  if (emulatorProc) { try { adb(['emu', 'kill'], { quiet: true }); } catch {} }
  process.exit(1);
});
