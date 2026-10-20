// Electron test of the Lesebrowser (app/src/ui/browser) against real web sites.
//   COZYSHELVES_BOOKS=<test library>|structured COZYSHELVES_USERDATA=<dir> SHOT_DIR=<dir> node build/screenshot.js browser-check
// Sections can be chosen with BR_ONLY=start,web,reader,find,tabs,collect,save,collection,pdf,tts,toggles,context,catalog,
// sites,translate,download,sizes,session,escape
// Screenshots are taken with webContents.capturePage() of the main window, the only capture that contains
// the composited <webview> guests. Every check prints PASS/FAIL; the summary counts them.
const path = require('path');
const fs = require('fs');

module.exports = async ({ app, page, sleep }) => {
  const dir = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const only = process.env.BR_ONLY ? new Set(process.env.BR_ONLY.split(',')) : null;
  const want = (s) => !only || only.has(s);
  const results = [];
  const ok = (name, cond, detail = '') => { results.push({ name, ok: !!cond }); console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); return !!cond; };
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 240)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 240)));
  const mainErr = [];
  app.process().stderr?.on('data', (d) => { const s = String(d); if (/error|exception|uncaught/i.test(s) && !/Debugger|DevTools|GPU|gpu_|Gtk|dbus|swiftshader|angle/i.test(s)) mainErr.push(s.trim().slice(0, 240)); });

  const snap = async (name) => {
    try {
      // A window behind other windows stops producing frames (Windows occlusion). A capturer count makes the
      // host and the guests count as visible while the picture is taken, so the frame is current.
      const b64 = await app.evaluate(async ({ BrowserWindow, webContents }) => {
        const w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL()));
        const all = [w.webContents, ...webContents.getAllWebContents().filter((x) => x.getType() === 'webview')];
        for (const c of all) { try { c.incrementCapturerCount(undefined, false, false); } catch {} }
        try {
          w.webContents.invalidate();
          await new Promise((r) => setTimeout(r, 700));
          return (await w.webContents.capturePage()).toPNG().toString('base64');
        } finally { for (const c of all) { try { if (!c.isDestroyed()) c.decrementCapturerCount(false, false); } catch {} } }
      });
      fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(b64, 'base64'));
      console.log('shot', name);
    } catch (e) { console.log('shot failed', name, e.message); }
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const st = () => ev(() => {
    const B = document.querySelector('.br-panel')?.__br;
    if (!B) return null;
    const t = B.activeTab();
    return {
      tabs: B.tabs.length, mode: t?.mode, url: t?.url || '', title: t?.title || '', loading: !!t?.loading, domReady: !!t?.domReady, wcId: t?.wcId ?? null,
      web: t?.webPos || null, blocked: t?.blocked || 0, error: t?.error || null, readerVisible: B.reader.visible, rpos: B.reader.visible ? B.reader.pos() : null,
      art: t?.article ? { title: t.article.title, words: t.article.words, lang: t.article.lang, imgs: (t.article.html.match(/<img/g) || []).length } : null,
      status: document.querySelector('.br-status')?.innerText.replace(/\s+/g, ' ').trim() || '',
      sheet: document.querySelector('.br-sheets:not([hidden])')?.dataset.kind || null,
      rstate: (() => { const e = document.querySelector('.br-rd-state'); return e && !e.hidden ? e.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : ''; })(),
    };
  });
  const until = async (label, fn, timeout = 30000, step = 400) => {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeout) {
      try { last = await st(); if (last && fn(last)) return last; } catch (e) { last = { err: e.message }; }
      await sleep(step);
    }
    console.log(`  (timeout waiting for ${label}: ${JSON.stringify(last)?.slice(0, 300)})`);
    return null;
  };
  const loaded = (urlPart, timeout = 45000) => until('load ' + urlPart, (s) => s.url.includes(urlPart) && !s.loading && s.domReady && s.web, timeout);
  const nav = async (url) => { await ev((u) => document.querySelector('.br-panel').__br.navigate(u), url); };
  const hostKey = async (key) => { await ev(() => { const p = document.querySelector('.br-panel'); if (!p.contains(document.activeElement) || /INPUT|WEBVIEW/.test(document.activeElement.tagName)) p.focus(); }); await page.keyboard.press(key); };
  const guestKey = async (keyCode, modifiers = []) => {
    await ev(() => { const t = document.querySelector('.br-panel').__br.activeTab(); t.view?.focus(); });
    await sleep(150);
    const id = (await st()).wcId;
    await app.evaluate(({ webContents }, a) => {
      const wc = webContents.fromId(a.id);
      if (!wc) return;
      wc.sendInputEvent({ type: 'keyDown', keyCode: a.keyCode, modifiers: a.modifiers });
      if (a.keyCode.length === 1 && !a.modifiers.length) wc.sendInputEvent({ type: 'char', keyCode: a.keyCode, modifiers: a.modifiers });
      wc.sendInputEvent({ type: 'keyUp', keyCode: a.keyCode, modifiers: a.modifiers });
    }, { id, keyCode, modifiers });
  };
  const guestJs = async (code, gesture = false) => ev(async ({ code, gesture }) => { const t = document.querySelector('.br-panel').__br.activeTab(); return t.view.executeJavaScript(code, gesture); }, { code, gesture });
  const rpc = (ch, ...a) => ev(({ ch, a }) => window.api.invoke(ch, ...a), { ch, a });
  const setPrefs = (patch, opts) => ev(({ patch, opts }) => document.querySelector('.br-panel').__br.setPrefs(patch, opts), { patch, opts });
  const libraryHas = (id, timeout = 40000) => page.waitForFunction((i) => (window.__app.state.library.books || []).some((b) => b.id === i), id, { timeout, polling: 500 }).then(() => true).catch(() => false);
  const firstLink = (re) => guestJs(`(() => { const re = new RegExp(${JSON.stringify(re)}); return [...document.querySelectorAll('a[href]')].map((a) => a.href).find((h) => re.test(h)) || null; })()`);

  // ---- start -------------------------------------------------------------------------------------------------------
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await ev(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(1000);
  for (let i = 0; i < 30; i++) { const s = await ev(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active })); if (!s.active && s.n > 0) break; await sleep(1500); }
  await ev(() => window.__app.ctx.openPanel('browser', {}));
  await page.waitForSelector('.br-panel', { timeout: 30000 });
  await until('boot', (s) => !!s.mode, 20000);
  // a clean state for the run: one start tab
  await ev(async () => { const B = document.querySelector('.br-panel').__br; while (B.tabs.length > 1) B.closeTab(B.tabs[B.tabs.length - 1]); const t = B.activeTab(); if (t.mode !== 'start') { B.closeTab(t); } });
  await sleep(800);

  if (want('start')) {
    const s = await st();
    ok('Startseite nach dem Öffnen', s.mode === 'start' && await ev(() => !document.querySelector('.br-start').hidden), JSON.stringify({ mode: s.mode }));
    await snap('br-01-start');
  }

  // ---- web page + paging ----------------------------------------------------------------------------------------------
  const WIKI = 'https://de.wikipedia.org/wiki/Lesesaal';
  if (want('web') || want('reader') || want('find') || want('collect') || want('save') || want('collection') || want('pdf') || want('tts')) {
    await ev(() => { const a = document.querySelector('.br-address'); a.focus(); a.value = ''; });
    await page.keyboard.type(WIKI);
    await page.keyboard.press('Enter');
    let s = await loaded('wikipedia.org/wiki/Lesesaal');
    ok('Adresszeile lädt eine Seite', !!s, s ? s.status : '');
    await snap('br-02-web');
    if (want('web') && s) {
      const p0 = s.web.page;
      await hostKey('Space');
      s = await until('page 2 (host key)', (x) => x.web && x.web.page > p0, 8000);
      ok('Leertaste im Panel blättert die Webseite', !!s, s ? s.status : '');
      await sleep(250);
      await snap('br-03-web-page2-line');
      const p1 = s?.web.page || 0;
      await guestKey('PageDown');
      s = await until('page 3 (guest key)', (x) => x.web && (x.web.page > p1 || x.web.atEnd), 8000);
      ok('Bild-ab in der Seite blättert (Skript in der Seite)', !!s, s ? s.status : '');
      await hostKey('PageUp');
      s = await until('page back', (x) => x.web && x.web.page < (s?.web.page || 99), 8000);
      ok('Bild-auf blättert zurück', !!s, s ? s.status : '');
      const before = (await st()).web.page;
      await ev(() => document.querySelector('.br-turn.next').click());
      s = await until('strip turn', (x) => x.web && x.web.page > before, 8000);
      ok('Blätterleiste rechts blättert vor', !!s, s ? s.status : '');
      const line = await guestJs('!!document.querySelector("lesesaal-seitenrand")');
      ok('Überlappungslinie nach dem Blättern gezeichnet', line === true);
      await guestJs('window.scrollTo(0, 0)');
    }
  }

  // ---- reader mode ------------------------------------------------------------------------------------------------------
  if (want('reader') || want('find') || want('save') || want('collection') || want('pdf') || want('tts')) {
    await hostKey('r');
    let s = await until('reader', (x) => x.readerVisible && x.art, 30000);
    ok('Taste R öffnet den Lesemodus', !!s, s ? JSON.stringify(s.art) : '');
    ok('Lesemodus mit Bildern und Seitenzahl', s && s.art.imgs > 0 && /Seite 1 von \d+/.test(s.status), s?.status);
    await snap('br-04-reader');
    if (want('reader') && s) {
      const r0 = s.rpos;
      const rr = await ev(() => { const r = document.querySelector('.br-reader').getBoundingClientRect(); return { x: r.right - 40, y: r.top + r.height / 2 }; });
      await page.mouse.click(rr.x, rr.y);
      s = await until('reader page 2', (x) => x.rpos && x.rpos.page === 2, 5000);
      ok('Klick ins rechte Drittel blättert im Lesemodus', !!s || r0.pages === 1, s?.status || JSON.stringify(r0));
      await snap('br-05-reader-page2');
      await hostKey('ArrowLeft');
      s = await until('reader page 1', (x) => x.rpos && x.rpos.page === 1, 5000);
      ok('Pfeil links blättert zurück', !!s);
      const cols2 = await ev(() => { const f = document.querySelector('.br-rd-flow'); return f.style.columnCount; });
      await setPrefs({ columns: '1', fontSize: 26 });
      await sleep(900);
      s = await st();
      const cols1 = await ev(() => document.querySelector('.br-rd-flow').style.columnCount);
      ok('Spalten und Schriftgröße ändern die Seitenzahl', cols1 === '1' && s.rpos.pages > r0.pages, `${cols2}→${cols1} Spalten, ${r0.pages}→${s.rpos.pages} Seiten`);
      await snap('br-06-reader-onecolumn-large');
      await setPrefs({ font: 'sans', align: 'left', lineHeight: 1.8 });
      await sleep(700);
      await snap('br-07-reader-sans-left');
      await setPrefs({ columns: 'auto', fontSize: 21, font: 'garamond', align: 'justify', lineHeight: 1.55 });
      for (const theme of ['sepia', 'eink', 'night']) {
        await setPrefs({ theme });
        await sleep(600);
        const th = await ev(() => document.querySelector('.br-panel').dataset.theme);
        ok(`Farbschema ${theme}`, th === theme);
        await snap(`br-08-reader-${theme}`);
      }
      await setPrefs({ theme: 'eink', bold: true, black: true });
      await sleep(500);
      await snap('br-09-reader-eink-bold');
      await setPrefs({ theme: 'paper', bold: false, black: false });
      await setPrefs({ paging: 'scroll' });
      await sleep(700);
      await snap('br-10-reader-scroll');
      await setPrefs({ paging: 'pages' });
      await ev(() => document.querySelector('.br-panel').__br.openSheet('look'));
      await sleep(600);
      await snap('br-11-look');
      await ev(() => document.querySelector('.br-panel').__br.closeSheet());
      const hy = await ev(() => (document.querySelector('.br-rd-body').textContent.match(/­/g) || []).length);
      ok('Silbentrennung setzt weiche Trennstriche', hy > 20, `${hy} Trennstellen`);
    }
  }

  // ---- find ----------------------------------------------------------------------------------------------------------------
  if (want('find')) {
    await hostKey('Control+f');
    await sleep(300);
    await page.keyboard.type('Bibliothek');
    await sleep(700);
    let r = await ev(() => document.querySelector('.br-find-count')?.textContent || '');
    ok('Suche im Lesemodus findet Treffer', /\d+ von \d+/.test(r), r);
    await snap('br-12-find-reader');
    await page.keyboard.press('Escape');
    await ev(() => document.querySelector('.br-panel').__br.closeReader());
    await sleep(800);
    await hostKey('Control+f');
    await sleep(300);
    await page.keyboard.type('Lesesaal');
    let found = null;
    for (let i = 0; i < 20 && !found; i++) { await sleep(400); r = await ev(() => document.querySelector('.br-find-count')?.textContent || ''); if (/\d+ von \d+/.test(r)) found = r; }
    ok('Suche auf der Webseite findet Treffer', !!found, r + ' :: ' + JSON.stringify(await ev(() => ({ value: document.querySelector('.br-find-input')?.value, active: document.activeElement?.className, mode: document.querySelector('.br-panel').__br.activeTab().mode }))));
    await page.keyboard.press('Escape');
    await sleep(300);
  }

  // ---- tabs --------------------------------------------------------------------------------------------------------------------
  if (want('tabs')) {
    const n0 = (await st()).tabs;
    await hostKey('Control+t');
    let s = await until('new tab', (x) => x.tabs === n0 + 1 && x.mode === 'start', 5000);
    ok('Strg+T öffnet einen neuen Tab mit Startseite', !!s);
    await nav('https://www.tagesschau.de/');
    s = await loaded('tagesschau.de');
    ok('tagesschau.de lädt im neuen Tab', !!s, s?.status);
    await snap('br-13-tagesschau');
    const n1 = (await st()).tabs;
    await guestKey('T', ['control']);
    s = await until('tab from guest shortcut', (x) => x.tabs === n1 + 1, 6000);
    ok('Strg+T aus der Seite heraus (before-input-event)', !!s);
    await hostKey('Control+w');
    s = await until('close start tab', (x) => x.tabs === n1, 5000);
    ok('Strg+W schließt den Tab', !!s);
    await ev(() => { const B = document.querySelector('.br-panel').__br; B.activate(B.tabs.find((t) => /tagesschau/.test(t.url))); });
    await sleep(600);
    await hostKey('Control+w');
    s = await until('closed tagesschau', (x) => x.tabs === n1 - 1, 5000);
    await hostKey('Control+Shift+t');
    s = await until('restored', (x) => x.tabs === n1 && /tagesschau/.test(x.url), 8000);
    ok('Strg+Umschalt+T holt den geschlossenen Tab zurück', !!s, s?.url);
    await loaded('tagesschau.de');
    const n2 = (await st()).tabs;
    await guestJs('window.open("https://example.com/", "_blank"); true', true);
    s = await until('popup tab', (x) => x.tabs === n2 + 1, 8000);
    const popupUrl = await ev(() => document.querySelector('.br-panel').__br.tabs.map((t) => t.url).find((u) => /example\.com/.test(u)) || '');
    ok('Popup (target=_blank) wird ein Tab im Lesebrowser', !!s && !!popupUrl, popupUrl);
    await ev(() => document.querySelector('.br-panel').__br.openSheet('tabs'));
    await sleep(1500);
    await snap('br-14-tabs');
    await ev(() => document.querySelector('.br-panel').__br.closeSheet());
    await ev(() => { const B = document.querySelector('.br-panel').__br; for (const t of [...B.tabs]) if (/example\.com/.test(t.url)) B.closeTab(t); B.activate(B.tabs.find((t) => /wikipedia/.test(t.url)) || B.tabs[0]); });
    await sleep(800);
  }

  // ---- bookmarks, reading list, history -------------------------------------------------------------------------------------------
  if (want('collect')) {
    let s = await st();
    if (!/wikipedia/.test(s.url)) { await nav(WIKI); s = await loaded('wikipedia.org/wiki/Lesesaal'); }
    const had = await ev(() => { const B = document.querySelector('.br-panel').__br; return !!B.store.bookmarkOf(B.activeTab().url); });
    if (had) await hostKey('Control+d');
    await hostKey('Control+d');
    await sleep(400);
    const bm = await ev(() => { const B = document.querySelector('.br-panel').__br; return { mark: !!B.store.bookmarkOf(B.activeTab().url), star: document.querySelector('.br-star').classList.contains('on') }; });
    ok('Strg+D setzt ein Lesezeichen', bm.mark && bm.star, JSON.stringify(bm));
    await ev(() => { const B = document.querySelector('.br-panel').__br; if (!B.store.laterOf(B.activeTab().url)) B.toggleLater(); });
    await ev(() => document.querySelector('.br-panel').__br.openReader());
    await until('reader for progress', (x) => x.readerVisible, 20000);
    // images, fonts and hyphenation settle the page count first: wait until it stays the same for 2 s
    let pages = -1, stable = 0;
    for (let i = 0; i < 40 && stable < 4; i++) {
      await sleep(500);
      const n = await ev(() => document.querySelector('.br-panel').__br.reader.pos().pages);
      if (n === pages) stable++; else { stable = 0; pages = n; }
    }
    await ev(() => document.querySelector('.br-panel').__br.reader.last());
    await sleep(1500);
    const later = await ev(() => { const B = document.querySelector('.br-panel').__br; return B.store.laterOf(B.activeTab().url); });
    ok('Leseliste speichert den Lesefortschritt', later && later.progress > 0.5 && later.mode === 'reader', JSON.stringify(later));
    await ev(() => document.querySelector('.br-panel').__br.reader.first());
    const hist = await ev(() => document.querySelector('.br-panel').__br.store.data.history.slice(0, 5).map((h) => h.url));
    ok('Verlauf enthält die besuchte Seite', hist.some((u) => /wiki\/Lesesaal/.test(u)), hist.join(' '));
    for (const tab of ['bookmarks', 'later', 'history']) {
      await ev((t) => document.querySelector('.br-panel').__br.openSheet('library', { tab: t }), tab);
      await sleep(600);
      await snap(`br-15-library-${tab}`);
    }
    await ev(() => document.querySelector('.br-panel').__br.closeSheet());
    // the stored file (main process) has them as well
    await sleep(1500);
    const data = await rpc('browser:data:get');
    ok('browser-data.json enthält Lesezeichen und Leseliste', data.bookmarks.some((b) => /Lesesaal/.test(b.url)) && data.readingList.some((b) => /Lesesaal/.test(b.url)), `${data.bookmarks.length} Lesezeichen, ${data.readingList.length} Leseliste`);
  }

  // ---- save as book ----------------------------------------------------------------------------------------------------------------
  if (want('save')) {
    let s = await st();
    if (s.mode !== 'reader') { await ev(() => document.querySelector('.br-panel').__br.openReader()); s = await until('reader', (x) => x.readerVisible, 20000); }
    await hostKey('Control+s');
    await sleep(700);
    ok('Strg+S öffnet „Seite behalten“', (await st()).sheet === 'dialog');
    await snap('br-16-save-dialog');
    await ev(() => [...document.querySelectorAll('.br-save .br-btn.primary')].pop().click());
    const res = await page.waitForFunction(() => document.querySelector('.br-save .br-msg')?.textContent || '', null, { timeout: 60000, polling: 500 }).then((h) => h.jsonValue()).catch(() => '');
    ok('Als Buch gespeichert', /Regal/.test(res), res);
    await sleep(500);
    await snap('br-17-saved');
    const book = await ev(() => (window.__app.state.library.books || []).length);
    await ev(() => document.querySelector('.br-panel').__br.closeSheet());
    const r = await ev(async () => { const B = document.querySelector('.br-panel').__br; return B.saveBook({ title: 'Lesesaal (Test)', images: true }); }).catch((e) => ({ error: e.message }));
    ok('saveBook liefert Pfad und Buch-ID', r && r.bookId && /Webseite als Buch/.test(r.path || ''), JSON.stringify(r));
    if (r?.bookId) ok('Das gespeicherte Buch steht in der Bibliothek', await libraryHas(r.bookId), `${book} Bücher vorher`);
    if (r?.path) {
      const sum = await app.evaluate(async (_e, p) => { try { const fs = process.getBuiltinModule ? process.getBuiltinModule('fs') : process.mainModule.require('fs'); const b = fs.readFileSync(p); return { size: b.length, zip: b[0] === 0x50 && b[1] === 0x4b, img: b.includes(Buffer.from('OEBPS/img/')) }; } catch (e) { return { err: e.message }; } }, r.path);
      ok('EPUB-Datei mit eingebetteten Bildern', sum.zip && sum.img, JSON.stringify(sum));
    }
  }

  // ---- Sammelband -------------------------------------------------------------------------------------------------------------------
  if (want('collection')) {
    const name = 'Sammelband Test ' + new Date().toISOString().slice(11, 19).replace(/:/g, '-');
    let s = await st();
    if (!/wikipedia/.test(s.url)) { await nav(WIKI); await loaded('wikipedia.org/wiki/Lesesaal'); }
    const a = await ev(async (n) => document.querySelector('.br-panel').__br.appendToCollection({ path: null, name: n, title: '', images: true }), name).catch((e) => ({ error: e.message }));
    ok('Neuer Sammelband mit erstem Kapitel', a && a.path && /Sammelb/.test(a.path), JSON.stringify(a));
    await nav('https://de.wikipedia.org/wiki/Bibliothek');
    await loaded('wikipedia.org/wiki/Bibliothek');
    const b = await ev(async (p) => document.querySelector('.br-panel').__br.appendToCollection({ path: p, name: '', title: '', images: false }), a?.path).catch((e) => ({ error: e.message }));
    ok('Zweiter Artikel als Kapitel angehängt', b && /Kapitel 2/.test(b.text || ''), JSON.stringify(b));
    const list = await rpc('browser:collections');
    const mine = list.find((c) => c.path === a?.path);
    ok('Sammelband hat zwei Kapitel', mine && mine.chapters === 2, JSON.stringify(mine));
    if (a?.bookId) ok('Sammelband steht in der Bibliothek', await libraryHas(a.bookId));
    await ev(() => document.querySelector('.br-panel').__br.openSheet('save', { mode: 'collection' }));
    await sleep(1800);
    await snap('br-18-collection-dialog');
    await ev(() => document.querySelector('.br-panel').__br.closeSheet());
  }

  // ---- PDF ----------------------------------------------------------------------------------------------------------------------------
  if (want('pdf')) {
    let s = await st();
    if (s.mode === 'reader') { await ev(() => document.querySelector('.br-panel').__br.closeReader()); await sleep(500); }
    if (!/wikipedia/.test(s.url)) { await nav(WIKI); await loaded('wikipedia.org'); }
    const p1 = await ev(async () => document.querySelector('.br-panel').__br.savePdf({ title: 'Webseite als PDF' })).catch((e) => ({ error: e.message }));
    ok('PDF der Webseite', p1 && /\.pdf$/.test(p1.path || ''), JSON.stringify(p1));
    if (p1?.bookId) ok('PDF steht in der Bibliothek', await libraryHas(p1.bookId));
    await ev(() => document.querySelector('.br-panel').__br.openReader());
    await until('reader', (x) => x.readerVisible, 20000);
    const p2 = await ev(async () => document.querySelector('.br-panel').__br.savePdf({ title: 'Lesemodus als PDF' })).catch((e) => ({ error: e.message }));
    ok('PDF des Lesemodus', p2 && /\.pdf$/.test(p2.path || ''), JSON.stringify(p2));
    if (p2?.path) {
      const head = await app.evaluate(async (_e, p) => { try { const b = (process.getBuiltinModule ? process.getBuiltinModule('fs') : process.mainModule.require('fs')).readFileSync(p); return { size: b.length, pdf: b.subarray(0, 5).toString() }; } catch (e) { return { err: e.message }; } }, p2.path);
      ok('PDF-Datei ist gültig', head.pdf === '%PDF-' && head.size > 5000, JSON.stringify(head));
    }
  }

  // ---- read aloud -----------------------------------------------------------------------------------------------------------------------
  if (want('tts')) {
    let s = await st();
    if (s.mode !== 'reader') { await ev(() => document.querySelector('.br-panel').__br.openReader()); s = await until('reader', (x) => x.readerVisible, 20000); }
    await hostKey('v');
    const t0 = Date.now();
    let info = null;
    const ttsInfo = () => ev(() => { const T = document.querySelector('.br-panel').__br.tts; return { active: T.active, session: !!T.session && !T.session.stopped, index: T.index, total: T.total, error: T.error, offer: T.offer ? T.offer.id : null, voice: T.voice, bar: document.querySelector('.br-tts')?.innerText.replace(/\s+/g, ' ').slice(0, 200) || '' }; });
    for (let i = 0; i < 20; i++) { await sleep(500); info = await ttsInfo(); if (info.offer || info.session || info.error) break; }
    if (info.offer) {
      ok('Fehlende Stimme wird angeboten, nicht ungefragt geladen', !info.session, info.bar);
      await snap('br-19-tts-offer');
      await ev(() => document.querySelector('.br-tts .br-btn.primary').click());
    }
    let sawProgress = '';
    for (let i = 0; i < 240; i++) {
      await sleep(1000);
      info = await ttsInfo();
      if (/geladen|vorbereitet/.test(info.bar) && !sawProgress) sawProgress = info.bar;
      if (info.index >= 0 || info.error) break;
    }
    if (sawProgress) console.log('  Fortschritt:', sawProgress);
    ok('Vorlesen spricht (Satz markiert)', info && info.index >= 0 && info.session, JSON.stringify(info) + ` nach ${Math.round((Date.now() - t0) / 1000)} s`);
    if (info?.index >= 0) ok('Gesprochener Satz ist markiert', await ev(() => CSS.highlights.has('br-tts')));
    await snap('br-19-tts');
    await hostKey('Escape');
    await sleep(500);
    const after = await ev(() => { const T = document.querySelector('.br-panel').__br.tts; return { active: T.active, session: T.session, hl: CSS.highlights.has('br-tts'), bar: !document.querySelector('.br-tts').hidden }; });
    ok('Esc beendet das Vorlesen', !after.active && !after.session && !after.hl && !after.bar, JSON.stringify(after));
    // do not leave a large voice download running in the test profile (the default voice is Martin since 0.6)
    for (const v of ['de_DE-martin-kokoro', 'de_DE-thorsten-medium']) await rpc('tts:piperCancel', v).catch(() => {});
  }

  // ---- switches against real sites ---------------------------------------------------------------------------------------------------------
  if (want('toggles')) {
    await ev(() => document.querySelector('.br-panel').__br.closeReader());
    await nav(WIKI);
    await loaded('wikipedia.org/wiki/Lesesaal');
    const probe = 'window.__lsbJs = 0; (() => { const s = document.createElement("script"); s.textContent = "window.__lsbJs = 1"; document.head.appendChild(s); return window.__lsbJs === 1; })()';
    ok('JavaScript an: Skripte laufen', await guestJs(probe) === true);
    await setPrefs({ js: false }, { reload: true });
    await sleep(1500);
    await loaded('wikipedia.org/wiki/Lesesaal');
    ok('JavaScript aus: Skripte der Seite laufen nicht (CSP)', await guestJs(probe) === false);
    const hasClientJs = await guestJs('document.documentElement.className');
    console.log('  html class ohne JS:', String(hasClientJs).slice(0, 80));
    await snap('br-20-js-off');
    await setPrefs({ js: true }, { reload: true });
    await sleep(1500);
    await nav('https://www.spektrum.de/');
    let s = await loaded('spektrum.de', 60000);
    await sleep(3000);
    s = await st();
    ok('Blocker blockiert Anfragen auf spektrum.de', s.blocked > 0, `${s.blocked} blockiert`);
    const blockedOn = s.blocked;
    await setPrefs({ adblock: false }, { reload: true });
    await sleep(2500);
    await loaded('spektrum.de', 60000);
    await sleep(3000);
    s = await st();
    ok('Blocker aus: nichts blockiert', s.blocked === 0, `${blockedOn} → ${s.blocked}`);
    await setPrefs({ adblock: true }, { reload: true });
    await sleep(2500);
    await loaded('spektrum.de', 60000);
    await setPrefs({ images: false }, { reload: true });
    await sleep(2500);
    await loaded('spektrum.de', 60000);
    await sleep(2500);
    const imgs = await guestJs('(() => { const a = [...document.images]; return { total: a.length, shown: a.filter((i) => i.complete && i.naturalWidth > 1 && getComputedStyle(i).display !== "none").length }; })()');
    ok('Bilder aus: keine Bilder geladen', imgs && imgs.shown === 0, JSON.stringify(imgs));
    await snap('br-21-images-off');
    await setPrefs({ images: true, textOnly: true }, { reload: true });
    await sleep(2500);
    await loaded('spektrum.de', 60000);
    await sleep(1500);
    await snap('br-22-text-only');
    await setPrefs({ textOnly: false, mobile: true }, { reload: true });
    await sleep(2500);
    await loaded('spektrum.de', 60000);
    const ua = await guestJs('navigator.userAgent');
    ok('Mobilansicht: Telefon-Kennung', /Mobile/.test(ua || ''), ua);
    await snap('br-23-mobile');
    await setPrefs({ mobile: false }, { reload: true });
    await sleep(2000);
    await loaded('spektrum.de', 60000);
    const ua2 = await guestJs('navigator.userAgent');
    ok('Normale Kennung ohne Electron', !/Mobile|Electron|lesesaal/i.test(ua2 || ''), ua2);
    await ev(() => document.querySelector('.br-panel').__br.openSheet('toggles'));
    await sleep(500);
    await snap('br-24-toggles');
    await ev(() => document.querySelector('.br-panel').__br.closeSheet());
    // consent dialogs of the common platforms stay hidden (only checked when the site shows one)
    const cmp = await guestJs('[...document.querySelectorAll(\'[id^="sp_message_container"], iframe[src*="privacy-mgmt.com"], #onetrust-consent-sdk, #CybotCookiebotDialog, #usercentrics-root, .fc-consent-root, #didomi-host\')].map((e) => getComputedStyle(e).display)');
    if (cmp && cmp.length) ok('Cookie-Hinweise ausgeblendet', cmp.every((d) => d === 'none'), JSON.stringify(cmp));
    else console.log('  (spektrum.de zeigt hier keinen Einwilligungsdialog)');
    // a consent layer no selector knows: the guest script recognises it by its text and hides it with its veil
    const wall = await guestJs(`(() => {
      const veil = document.createElement('div'); veil.id = 'v' + Date.now(); veil.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99998';
      const box = document.createElement('div'); box.id = 'b' + Date.now(); box.style.cssText = 'position:fixed;left:25%;top:20%;width:50%;height:50%;background:#fff;z-index:99999';
      box.innerHTML = '<h2>Wie wollen Sie diese Seite nutzen?</h2><p>Wir und unsere Partner verarbeiten Daten. Ihre Zustimmung zu Werbung und Tracking können Sie widerrufen. Datenschutz</p><button>Akzeptieren</button>';
      const note = document.createElement('div'); note.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:30%;background:#eef;z-index:99990'; note.textContent = 'Ein gewöhnlicher Hinweis der Seite.';
      document.body.append(veil, box, note);
      document.documentElement.style.overflow = 'hidden';
      window.__cozyshelvesBrowser.hideWalls();
      const out = { veil: getComputedStyle(veil).display, box: getComputedStyle(box).display, note: getComputedStyle(note).display, scroll: getComputedStyle(document.documentElement).overflow };
      veil.remove(); box.remove(); note.remove();
      return out;
    })()`);
    ok('Unbekannter Einwilligungsdialog wird erkannt und ausgeblendet', wall && wall.veil === 'none' && wall.box === 'none' && wall.note !== 'none' && wall.scroll !== 'hidden', JSON.stringify(wall));
    // night theme on a web page: the page is darkened with the theme
    await setPrefs({ theme: 'night' });
    await sleep(900);
    const filter = await guestJs('getComputedStyle(document.documentElement).filter');
    ok('Nacht dunkelt die Webseite ab', /invert/.test(filter || ''), filter);
    await snap('br-24b-web-night');
    await setPrefs({ theme: 'eink' });
    await sleep(900);
    await snap('br-24c-web-eink');
    await setPrefs({ theme: 'paper' });
  }

  // ---- context menu of a page -------------------------------------------------------------------------------------------------------------------
  if (want('context')) {
    await ev(() => document.querySelector('.br-panel').__br.closeReader());
    await nav(WIKI);
    await loaded('wikipedia.org/wiki/Lesesaal');
    const pt = await guestJs('(() => { const a = [...document.querySelectorAll("#mw-content-text a[href*=\\"/wiki/\\"]")].find((x) => { const r = x.getBoundingClientRect(); return r.top > 60 && r.bottom < innerHeight - 20 && r.width > 20; }); if (!a) return null; const r = a.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), href: a.href }; })()');
    if (pt) {
      const id = (await st()).wcId;
      await app.evaluate(({ webContents }, a) => {
        const wc = webContents.fromId(a.id);
        wc.sendInputEvent({ type: 'mouseDown', x: a.x, y: a.y, button: 'right', clickCount: 1 });
        wc.sendInputEvent({ type: 'mouseUp', x: a.x, y: a.y, button: 'right', clickCount: 1 });
      }, { id, x: pt.x, y: pt.y });
      await sleep(900);
      const items = await ev(() => [...document.querySelectorAll('.br-ctx .br-mitem-label')].map((e) => e.textContent));
      ok('Kontextmenü eines Links', items.includes('In neuem Tab öffnen'), items.join(' | '));
      await snap('br-24d-context');
      const n = (await st()).tabs;
      await ev(() => [...document.querySelectorAll('.br-ctx .br-mitem')].find((b) => /neuem Tab/.test(b.textContent))?.click());
      const s = await until('context tab', (x) => x.tabs === n + 1, 5000);
      ok('„In neuem Tab öffnen“ öffnet den Link im Hintergrund', !!s && s.url.includes('Lesesaal'), pt.href);
    } else ok('Kontextmenü eines Links', false, 'kein Link gefunden');
  }

  // ---- the browser inside the Fernleihe (catalogue) -------------------------------------------------------------------------------------------------
  if (want('catalog')) {
    await ev(() => window.__app.closeAllPanels());
    await sleep(800);
    await ev(() => window.__app.ctx.openPanel('catalog', {}));
    await page.waitForSelector('.cat-panel', { timeout: 30000 });
    await sleep(1500);
    // the Fernleihe opens the reading browser as its own panel on top of it; Esc / close leads back
    await ev(() => [...document.querySelectorAll('.cat-header .btn')].find((b) => /browser/i.test(b.textContent))?.click());
    await page.waitForSelector('.panel-layer[data-panel="browser"] .br-panel', { timeout: 20000 });
    await sleep(1500);
    ok('Lesebrowser aus der Fernleihe', await ev(() => !!document.querySelector('.panel-layer[data-panel="browser"] .br-panel') && !!document.querySelector('.cat-panel')));
    await nav('https://www.gutenberg.org/ebooks/2229');
    const s = await loaded('gutenberg.org/ebooks/2229', 60000);
    ok('Seite lädt im Lesebrowser über der Fernleihe', !!s, s?.status);
    await snap('br-24e-catalog-browser');
    // Esc from inside a web page first only hands the focus back ("Esc noch einmal schließt …"), the second closes.
    // Playwright's synthetic keys do not reach a focused <webview>, so the keys go in as native input events.
    const nativeEsc = () => app.evaluate(({ webContents }) => {
      const g = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && !w.isDestroyed());
      if (!g) return false;
      g.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); g.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      return true;
    });
    await nativeEsc();
    await sleep(700);
    ok('Erstes Esc in der Webseite gibt den Fokus zurück', await ev(() => /Esc noch einmal/.test(document.body.innerText)));
    await page.keyboard.press('Escape');
    await sleep(1200);
    ok('Esc kehrt zur Fernleihe zurück', await ev(() => !document.querySelector('.panel-layer[data-panel="browser"]:not(.closing)') && !!document.querySelector('.cat-panel')));
    await ev(() => window.__app.closeAllPanels());
    await sleep(600);
    await ev(() => window.__app.ctx.openPanel('browser', {}));
    await page.waitForSelector('.br-panel', { timeout: 20000 });
    await until('boot', (x) => !!x.mode, 20000);
  }

  // ---- reader mode on real article pages ----------------------------------------------------------------------------------------------------
  if (want('sites')) {
    const cases = [
      ['tagesschau', 'https://www.tagesschau.de/', '/(inland|ausland|wirtschaft|wissen)/.+\\.html$'],
      ['spektrum', 'https://www.spektrum.de/', '/news/[^/]+/\\d+'],
      ['heise', 'https://www.heise.de/', '/news/[^/]+\\.html'],
      ['gutenberg', 'https://www.gutenberg.org/cache/epub/2229/pg2229-images.html', null],
    ];
    for (const [name, home, linkRe] of cases) {
      await ev(() => document.querySelector('.br-panel').__br.closeReader());
      await nav(home);
      let s = await loaded(new URL(home).hostname.replace(/^www\./, ''), 60000);
      let target = home;
      if (linkRe && s) { const l = await firstLink(linkRe); if (l) { target = l; await nav(l); s = await loaded(new URL(l).pathname.slice(0, 20), 60000); } }
      if (!s) { ok(`Lesemodus ${name}`, false, 'Seite nicht geladen'); continue; }
      await snap(`br-25-${name}-web`);
      await ev(() => document.querySelector('.br-panel').__br.openReader());
      s = await until('reader ' + name, (x) => x.readerVisible || /nicht möglich/.test(x.rstate), 40000);
      const now = await st();
      ok(`Lesemodus ${name}`, now.art && now.art.words > 150, `${target} :: ${JSON.stringify(now.art) || now.rstate}`);
      await snap(`br-26-${name}-reader`);
    }
  }

  // ---- translate -------------------------------------------------------------------------------------------------------------------------------
  if (want('translate')) {
    await ev(() => document.querySelector('.br-panel').__br.closeReader());
    await nav('https://www.gutenberg.org/ebooks/1342');
    await loaded('gutenberg.org', 60000);
    await ev(() => document.querySelector('.br-panel').__br.translate());
    const s = await until('translated', (x) => /translate/.test(x.url) && !x.loading, 40000);
    ok('Übersetzen lädt die Google-Übersetzung', !!s, s?.url);
    await sleep(2500);
    await snap('br-27-translated');
    await ev(() => document.querySelector('.br-panel').__br.translate());
    const back = await until('original', (x) => /gutenberg\.org\/ebooks\/1342/.test(x.url), 30000);
    ok('Zurück zum Original', !!back, back?.url);
  }

  // ---- download offer ----------------------------------------------------------------------------------------------------------------------------
  if (want('download')) {
    await ev(() => document.querySelector('.br-panel').__br.closeReader());
    await nav('https://www.gutenberg.org/ebooks/2229');
    await loaded('gutenberg.org/ebooks/2229', 60000);
    const epubLink = await firstLink('\\.epub3?\\.images$|\\.epub\\.noimages$|/ebooks/2229\\.epub');
    if (epubLink) {
      await guestJs(`location.href = ${JSON.stringify(epubLink)}`);
      const sheet = await until('download sheet', (x) => x.sheet === 'dialog', 20000);
      ok('Download-Angebot als Dialog', !!sheet && await ev(() => !!document.querySelector('.br-download')), epubLink);
      await snap('br-28-download');
      if (sheet) {
        await ev(() => document.querySelector('.br-download .br-btn.primary')?.click());
        const res = await page.waitForFunction(() => document.querySelector('.br-download .br-msg')?.textContent || '', null, { timeout: 120000, polling: 1000 }).then((h) => h.jsonValue()).catch(() => '');
        ok('Datei ins Regal gelegt', /Regal/.test(res), res);
        await snap('br-29-download-done');
        await ev(() => document.querySelector('.br-panel').__br.closeSheet());
      }
    } else ok('Download-Angebot', false, 'kein EPUB-Link gefunden');
  }

  // ---- window sizes --------------------------------------------------------------------------------------------------------------------------------
  if (want('sizes')) {
    const size = (w, h) => app.evaluate(async ({ BrowserWindow }, s) => {
      const win = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL()));
      if (win.isMinimized()) win.restore();
      if (win.isFullScreen()) win.setFullScreen(false);
      if (win.isMaximized()) win.unmaximize();
      win.setContentSize(s.w, s.h);
      await new Promise((r) => setTimeout(r, 600));
      return win.getContentSize();
    }, { w, h });
    await nav(WIKI);
    await loaded('wikipedia.org/wiki/Lesesaal');
    for (const [w, hgt] of [[1024, 640], [2560, 1440]]) {
      const got = await size(w, hgt);
      await sleep(2000);
      await snap(`br-30-web-${w}`);
      await ev(() => document.querySelector('.br-panel').__br.openReader());
      await until('reader', (x) => x.readerVisible, 20000);
      await sleep(1200);
      const r = await st();
      await snap(`br-31-reader-${w}`);
      ok(`Lesemodus bei ${w}×${hgt}`, r.rpos && r.rpos.pages >= 1 && Math.abs(got[0] - w) < 40, `Fenster ${JSON.stringify(got)} ${r.status}`);
      await ev(() => document.querySelector('.br-panel').__br.closeReader());
      await ev(() => document.querySelector('.br-panel').__br.newTab());
      await sleep(800);
      await snap(`br-32-start-${w}`);
      await ev(() => { const B = document.querySelector('.br-panel').__br; B.closeTab(B.activeTab()); });
      await sleep(500);
    }
    await size(1600, 900);
    await sleep(1500);
  }

  // ---- session ---------------------------------------------------------------------------------------------------------------------------------------
  if (want('session')) {
    const before = await ev(() => document.querySelector('.br-panel').__br.tabs.map((t) => t.url).filter(Boolean));
    await ev(() => window.__app.closeAllPanels());
    await sleep(1500);
    await ev(() => window.__app.ctx.openPanel('browser', { url: 'https://de.wikipedia.org/wiki/Zeitung' }));
    await page.waitForSelector('.br-panel', { timeout: 20000 });
    const s = await until('restored tabs', (x) => x.tabs >= before.length + 1 && /Zeitung/.test(x.url), 20000);
    const after = await ev(() => document.querySelector('.br-panel').__br.tabs.map((t) => t.url));
    ok('Tabs nach dem Wiederöffnen wiederhergestellt, neue Adresse im eigenen Tab', !!s && before.every((u) => after.includes(u)), `${before.length} → ${after.length}`);
  }

  // ---- escape ---------------------------------------------------------------------------------------------------------------------------------------
  if (want('escape')) {
    await loaded('wikipedia.org', 30000);
    await ev(() => document.querySelector('.br-panel').__br.openSheet('menu'));
    await sleep(300);
    await snap('br-33-menu');
    await hostKey('Escape');
    ok('Esc schließt zuerst das Menü', (await st()).sheet === null && await ev(() => !!document.querySelector('.br-panel')));
    await guestKey('Escape');
    await sleep(500);
    const hint = await ev(() => { const h = document.querySelector('.br-hint'); return h && !h.hidden ? h.textContent : ''; });
    ok('Esc in der Seite zeigt den Hinweis', /Esc/.test(hint), hint);
    await hostKey('Escape');
    await sleep(800);
    ok('Zweites Esc schließt den Lesebrowser', await ev(() => !document.querySelector('.br-panel')));
  }

  // ---- summary ----------------------------------------------------------------------------------------------------------------------------------------
  const known = /Invalid guestInstanceId|status of 404|pointer lock|THREE\.Clock/;
  const errs = errors.filter((e) => !known.test(e));
  console.log(`\nKonsole: ${errs.length} Fehler${errs.length ? '\n  ' + errs.slice(0, 15).join('\n  ') : ''}`);
  console.log(`Hauptprozess: ${mainErr.length} Fehlermeldungen${mainErr.length ? '\n  ' + mainErr.slice(0, 10).join('\n  ') : ''}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\nBROWSER-CHECK ${results.length - failed.length}/${results.length} bestanden${failed.length ? '; fehlgeschlagen: ' + failed.map((f) => f.name).join(' | ') : ''}`);
};
