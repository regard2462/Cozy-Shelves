// Read-aloud of books (0.7): what reaches the voices, the voice menu at the read-aloud icon, all voices at once.
// Every reading is muted (build/screenshot.js); most of them run "dry": the client answers with a short quiet tone
// instead of a voice (window.__ttsDryRun) and records what it would have spoken (window.__ttsTrace: text, spoken
// text, language, engine, voice, phonemes).
//
//   python build/testlib/gen_tts_books.py <folder>
//   COZYSHELVES_BOOKS="<folder>/lib|structured" TTS_BOOKS=<folder> COZYSHELVES_PIPER_DIR=<voices with Thorsten (mittel)>
//   COZYSHELVES_USERDATA=<fresh folder> node build/screenshot.js reader-tts-check
//
// TTS_PARTS (default books,real,menu,browser):
//   books    every test book, with the language of its metadata right, wrong, broken and missing, and with the app in
//            English: the language of the reading and of every sentence, the voice, the first sentences, no junk,
//            chess notation in words, pages without readable text skipped with a note
//   real     the first sentences of three books through a real German voice (Thorsten mittel on the processor): the
//            phonemes espeak-ng made are those of the clean book text; with the English model in the user data
//            (TTS_EN=1) the English paragraph of the mixed book through Kokoro
//   menu     the voice menu in the reader: Shift+V, right click, the voices with their state, another voice from the
//            next sentence on and saved, speed, "Sprache automatisch" off and German/English for the book, Escape
//   browser  the same text as an encyclopedia page in the reading browser (served from 127.0.0.1): the same sentences
//            and languages as from the PDF, and the voice menu there
//   all      settings → "Alle Stimmen herunterladen" against a local stand-in for Hugging Face (needs its own run):
//            COZYSHELVES_PIPER_DIR=<empty folder> COZYSHELVES_PIPER_BASE=http://127.0.0.1:47321/piper/
//            COZYSHELVES_KOKORO_DE_BASE=http://127.0.0.1:47321/kokoro/ TTS_PARTS=all (TTS_MOCK_PORT=47321)
//            total size, progress, cancel and resume (a Range request), a failure and its retry, skipping
//   wav      (with TTS_WAV_DIR=<folder>) the first sentences of every book as WAV the way the voices say them now
//            (render, nothing is played), with the text next to it, for a speech recognizer
const fs = require('fs');
const path = require('path');
const http = require('http');

const PARTS = (process.env.TTS_PARTS || 'books,real,menu,browser').split(',').map((s) => s.trim()).filter(Boolean);
const BOOKS = process.env.TTS_BOOKS;
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

module.exports = async ({ app, page, sleep, shot }) => {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail).slice(0, 900) : '')); };
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const truth = BOOKS ? JSON.parse(fs.readFileSync(path.join(BOOKS, 'tts-truth.json'), 'utf8')) : {};

  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary') && window.__ttsClient, null, { timeout: 240000 });
  await ev(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(900);
  for (let i = 0; i < 150; i++) {
    const st = await ev(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active, idx: window.__app.state.library.books.filter((b) => b.indexed).length }));
    if (!st.active && st.n > 0 && st.idx >= st.n) break;
    await sleep(1000);
  }
  await ev(() => window.__app.world.stop());
  const books = await ev(() => window.__app.state.library.books.map((b) => ({ id: b.id, rel: (b.relPath || b.path || '').replace(/\\/g, '/'), language: b.language, isChess: !!b.isChess })));
  const bookOf = (rel) => books.find((b) => b.rel.endsWith(rel.split('/').pop()));
  // the voices of the test: Thorsten (mittel) in German, Michael in English (the English model only when it is there)
  await ev(() => window.api.settings.set({ tts: { germanVoice: 'de_DE-thorsten-medium', englishVoice: 'am_michael', speed: 1 } }));
  const english = await ev(() => window.__ttsClient.englishModel(true));
  console.log('INFO English model on this computer:', JSON.stringify(english));

  // ---- helpers ----------------------------------------------------------------------------------------------------
  async function openBook(id) {
    await ev(() => { window.__readerTts = null; });
    await ev((x) => window.__app.openPanel('reader', { id: x }), id);
    await page.waitForFunction(() => window.__readerTts && document.querySelector('.rd-root') && !document.querySelector('.rd-loading'), null, { timeout: 30000 }).catch(() => {});
    await sleep(1800);
  }
  async function closeAll() { await page.keyboard.press('Escape').catch(() => {}); await sleep(200); await ev(() => window.__app.closeAllPanels()); await sleep(500); }
  const trace = () => ev(() => (window.__ttsTrace || []).map((t) => ({ ...t })));
  /** the last entry per sentence of the newest reading (a retune makes a sentence again) */
  function lastPerSentence(entries) {
    const sid = entries.length ? entries[entries.length - 1].session : null;
    const by = new Map();
    for (const e of entries) if (e.session === sid) by.set(e.i, e);
    return [...by.values()].sort((a, b) => a.i - b.i);
  }
  async function startReading(dry = 0.12) {
    await ev((d) => { window.__ttsTrace = []; window.__ttsDryRun = d; window.__notes = []; const n = document.querySelector('.rd-notice'); if (n) new MutationObserver(() => { const t = n.textContent; if (t && window.__notes[window.__notes.length - 1] !== t) window.__notes.push(t); }).observe(n, { childList: true, characterData: true, subtree: true }); }, dry);
    await page.keyboard.press('v');
  }
  async function waitFor(fn, arg, ms = 30000) { const t0 = Date.now(); for (;;) { const v = await ev(fn, arg); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(200); } }

  // ================================================================================================================
  if (PARTS.includes('books') && BOOKS) {
    const cases = [];
    for (const [rel, t] of Object.entries(truth)) {
      if (rel.startsWith('web/')) continue;
      const b = bookOf(rel);
      if (!b) { check(`book ${rel} in the library`, false); continue; }
      cases.push({ rel, b, t, meta: undefined, ui: 'de' });
      if (rel === 'Sachbuch/Lesen am Fluss.pdf' || rel === 'Schach/Endspielkurs.pdf') {
        for (const meta of [null, 'en', '<¦', 'Germa', 'DE-DE']) cases.push({ rel, b, t, meta, ui: 'de' });
        cases.push({ rel, b, t, meta: null, ui: 'en' });
      }
    }
    let lastUi = 'de';
    const pdfSentences = {};
    for (const c of cases) {
      if (c.ui !== lastUi) { await ev((l) => window.api.settings.set({ language: l }), c.ui); lastUi = c.ui; await sleep(400); }
      if (c.meta !== undefined) await ev(([id, l]) => window.api.library.update(id, { language: l }), [c.b.id, c.meta]);
      const label = `${c.rel} (metadata ${c.meta === undefined ? 'as indexed: ' + JSON.stringify(c.b.language) : JSON.stringify(c.meta)}, app ${c.ui})`;
      await openBook(c.b.id);
      await startReading(c.t.junkPages ? 0.05 : 0.12);
      const want = c.t.first.length;
      // an English book without the English model on this computer: the bar asks before the download
      if (c.t.lang === 'en' && english.cached === false) {
        const offer = await waitFor(() => document.querySelector('.rd-ttsbar.offer')?.innerText || null, null, 15000);
        check(`${label}: the English voice is offered for download`, offer && /englische Stimme/.test(offer), offer);
        await closeAll();
        continue;
      }
      // the reading collects, plans and starts: wait for the first sentences (after the unreadable pages for the junk books)
      const need = c.t.afterJunk ? (t) => t.some((e) => norm(e.text) === norm(c.t.afterJunk[0])) : (t) => lastPerSentence(t).length >= Math.min(want, 4);
      let tr = [], noted = false;
      for (let i = 0; i < 150; i++) {
        tr = await trace(); if (need(tr)) break;
        // the note on a page without readable text, once on screen
        if (c.t.afterJunk && !noted && c.meta === undefined && await ev(() => /keinen lesbaren Text/.test(document.querySelector('.rd-notice:not(.hidden)')?.textContent || ''))) { noted = true; await shot('rtc-note-' + (c.rel.includes('Scan') || c.rel.includes('Gescannt') ? 'scan' : 'broken')); }
        await sleep(200);
      }
      const state = await ev(() => ({ plan: window.__readerTts?.plan, sentences: window.__readerTts?.sentences || [], notes: window.__notes || [] }));
      const spoken = lastPerSentence(tr);
      const firstTexts = (c.t.afterJunk ? [] : state.sentences).slice(0, want).map((s) => norm(s.text));
      check(`${label}: language of the reading ${c.t.lang}`, state.plan?.base === c.t.lang || (c.t.afterJunk && spoken.every((e) => e.lang === c.t.lang)), state.plan);
      if (!c.t.afterJunk) check(`${label}: first sentences`, firstTexts.join(' | ') === c.t.first.map(norm).join(' | '), { got: firstTexts, want: c.t.first });
      // every sentence in the language of its paragraph: the English one of the mixed book in English, all others in the book's
      const englishOnes = new Set((c.t.english || []).map(norm));
      const wrongLang = spoken.filter((e) => e.lang !== (englishOnes.has(norm(e.text)) ? 'en' : c.t.lang));
      check(`${label}: language of every sentence`, spoken.length > 0 && !wrongLang.length, wrongLang.slice(0, 3).map((e) => [e.text, e.lang]));
      const voiceOk = spoken.every((e) => e.skipped || (e.lang === 'en' && english.cached ? e.voice === 'am_michael' && e.engine === 'kokoro' : e.lang === 'de' ? e.voice === 'de_DE-thorsten-medium' : true));
      check(`${label}: voice of every sentence`, voiceOk, spoken.slice(0, 6).map((e) => [e.i, e.lang, e.engine, e.voice]));
      const junkSpoken = spoken.filter((e) => (c.t.never || []).some((w) => String(e.text).includes(w)) || /[\u0000-\u0008-一-鿿]/.test(e.text));
      check(`${label}: no junk reaches the voice`, !junkSpoken.length, junkSpoken.slice(0, 3).map((e) => e.text));
      if (c.t.spoken) {
        const all = spoken.map((e) => e.spoken).join(' ');
        check(`${label}: chess notation in words`, c.t.spoken.every((p) => all.includes(p)) && !/\b[KDTLS][a-h][1-8]\b/.test(all), c.t.spoken.filter((p) => !all.includes(p)).concat([all.slice(0, 300)]));
      }
      if (c.t.afterJunk) {
        check(`${label}: pages without readable text skipped with the note`, state.notes.some((n) => /keinen lesbaren Text|no readable text/.test(n)), state.notes);
        check(`${label}: reading goes on after them`, spoken.some((e) => norm(e.text) === norm(c.t.afterJunk[0])), spoken.slice(-3).map((e) => e.text));
      }
      if (c.t.poem) {
        // a poem with a <br> after every line: the lines keep a space between them ("gehen Das Licht", never "gehenDas")
        let poem = null;
        for (let i = 0; i < 100 && !poem; i++) { poem = (await trace()).find((e) => /Wellen/.test(e.text)); if (!poem) await sleep(200); }
        check(`${label}: lines broken with <br> keep their spaces`, poem && norm(poem.text) === norm(c.t.poem), poem && poem.text);
      }
      if (c.meta === undefined && c.rel.endsWith('.pdf')) pdfSentences[c.rel] = state.sentences;
      if (c.rel === 'Schach/Endspielkurs.pdf' && c.meta === undefined) await shot('rtc-chess-reading');
      await closeAll();
      if (c.meta !== undefined) await ev(([id, l]) => window.api.library.update(id, { language: l }), [c.b.id, c.b.language]);
    }
    if (lastUi !== 'de') await ev(() => window.api.settings.set({ language: 'de' }));
    fs.writeFileSync(path.join(process.env.SHOT_DIR || '.', 'reader-tts-pdf-sentences.json'), JSON.stringify(pdfSentences, null, 1));
  }

  // ================================================================================================================
  if (PARTS.includes('real') && BOOKS) {
    // the phonemes espeak-ng makes of the clean book text, computed here in Node with the same WebAssembly
    let espeak = null, normalizeGermanText = null;
    try {
      const { pathToFileURL } = require('url');
      const root = path.join(__dirname, '..', '..');
      const es = await import(pathToFileURL(path.join(root, 'app/src/workers/espeak-ng.js')).href);
      ({ normalizeGermanText } = await import(pathToFileURL(path.join(root, 'app/src/workers/piper-de.js')).href));
      const dir = path.join(root, 'app/vendor/espeak-ng');
      const files = {}; for (const f of es.ESPEAK_DE_FILES) files[f] = fs.readFileSync(path.join(dir, 'espeak-ng-data', ...f.split('/')));
      espeak = await es.createEspeak({ factory: require(path.join(root, 'node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.js')), wasm: fs.readFileSync(path.join(dir, 'piper_phonemize.wasm')), files });
    } catch (e) { console.log('INFO espeak-ng in Node not available:', e.message); }
    const realCases = [['Sachbuch/Lesen am Fluss.pdf', 'en'], ['Schach/Endspielkurs.pdf', null], ['Romane/Briefe aus zwei Ländern.epub', undefined]];
    for (const [rel, meta] of realCases) {
      const b = bookOf(rel); if (!b) continue;
      if (meta !== undefined) await ev(([id, l]) => window.api.library.update(id, { language: l }), [b.id, meta]);
      await openBook(b.id);
      await startReading(false);
      const want = rel.endsWith('.epub') || rel.startsWith('Schach') ? 5 : 3;
      let tr = [];
      for (let i = 0; i < 300; i++) { tr = await trace(); if (lastPerSentence(tr).filter((e) => e.phonemes?.length || e.engine === 'kokoro').length >= want) break; await sleep(300); }
      const spoken = lastPerSentence(tr);
      const german = spoken.filter((e) => e.lang === 'de' && e.phonemes?.length);
      check(`real ${rel}: German sentences through Thorsten (mittel) with phonemes of espeak-ng`, german.length >= 2 && german.every((e) => e.voice === 'de_DE-thorsten-medium'), spoken.slice(0, 4).map((e) => [e.text, e.engine, e.voice, (e.phonemes || []).join(' | ').slice(0, 80)]));
      if (espeak && german.length) {
        let same = 0;
        for (const e of german) {
          const [ph] = await espeak.phonemize([normalizeGermanText(e.spoken)]);
          if (norm(ph.join(' ').normalize('NFC')) === norm(e.phonemes.join(' ').normalize('NFC'))) same++;
          else console.log('INFO phonemes differ:', e.spoken, '\n   app:', e.phonemes.join(' | '), '\n  node:', ph.join(' | '));
        }
        check(`real ${rel}: the voice got the phonemes of the clean text`, same === german.length, `${same}/${german.length}`);
        // German sounds: the voice reads German (ç, ʃ, ɾ, the German vowels), no English diphthongs of a wrong language
        const ph = german.map((e) => e.phonemes.join(' ')).join(' ');
        check(`real ${rel}: German phonemes`, /[ʃɾ]/.test(ph) && /ˈ/.test(ph) && !/[ðθ]/.test(ph), ph.slice(0, 160));
      }
      if (rel.startsWith('Schach')) {
        const all = spoken.map((e) => (e.phonemes || []).join(' ')).join(' ');
        check(`real ${rel}: "Springer f drei" spoken as words`, /ʃpɾˈɪŋɜ ˈɛf dɾˈaɪ/.test(all) && /kˈ\?\?tsə rˈɔxɑːdə/.test(all), all.slice(0, 400));
      }
      if (rel.endsWith('.epub')) {
        const en = spoken.find((e) => e.lang === 'en');
        if (english.cached) check(`real ${rel}: the English paragraph through Kokoro`, en && en.engine === 'kokoro' && en.voice === 'am_michael', en);
        else check(`real ${rel}: without the English model the English paragraph stays with the German voice`, en && en.engine !== 'kokoro', en);
      }
      await closeAll();
      if (meta !== undefined) await ev(([id, l]) => window.api.library.update(id, { language: l }), [b.id, b.language]);
    }
  }

  // ================================================================================================================
  if (PARTS.includes('menu') && BOOKS) {
    const b = bookOf('Romane/Der Leuchtturm.epub');
    await openBook(b.id);
    await startReading(0.9);
    await waitFor(() => window.__readerTts?.current >= 1, null, 20000);
    // Shift+V opens the menu
    await page.keyboard.press('Shift+V');
    const menu = await waitFor(() => { const m = document.querySelector('.tts-menu'); if (!m || !m.querySelector('.tts-menu-item')) return null; return { items: [...m.querySelectorAll('.tts-menu-item')].map((x) => ({ key: x.dataset.key, on: x.getAttribute('aria-checked') === 'true', badge: x.querySelector('.tts-menu-badge')?.textContent || '' })), speeds: m.querySelectorAll('[data-key^="speed-"]').length, auto: m.querySelector('[data-key="auto"]')?.getAttribute('aria-checked'), focus: document.activeElement?.closest?.('.tts-menu') === m, model: !!m.querySelector('.tts-menu-model') }; }, null, 15000);
    check('menu: Shift+V opens the voice menu with the focus in it', menu && menu.focus, menu && { focus: menu.focus });
    const de = (menu?.items || []).filter((x) => x.key.startsWith('de-'));
    const installed = await ev(async () => (await window.api.invoke('tts:piperVoices')).voices.filter((v) => v.installed).map((v) => v.id));
    check('menu: the German voices with their state (here, or to download with the size)', de.length >= 10 && de.every((x) => installed.includes(x.key.slice(3)) ? x.badge === '✓' : /⇩ \d+ MB/.test(x.badge)), de.map((x) => [x.key, x.badge]));
    check('menu: the chosen voice is marked', de.find((x) => x.on)?.key === 'de-de_DE-thorsten-medium', de.filter((x) => x.on));
    check('menu: the English voices, the English model only offered when it is missing', (menu?.items || []).filter((x) => x.key.startsWith('en-')).length === 28 && menu.model === (english.cached === false), { model: menu?.model, cached: english.cached });
    check('menu: speed and "Sprache automatisch"', menu?.speeds === 6 && menu?.auto === 'true', { speeds: menu?.speeds, auto: menu?.auto });
    await shot('rtc-menu-reader');
    // another voice with the keyboard: it is saved and takes over from the next sentence
    const other = installed.find((id) => id !== 'de_DE-thorsten-medium' && id !== 'de_DE-thorsten-high' && id !== 'de_DE-martin-kokoro') || installed.find((id) => id !== 'de_DE-thorsten-medium');
    const at = await ev(() => window.__readerTts.current);
    await ev((id) => document.querySelector(`.tts-menu [data-key="de-${id}"]`)?.focus(), other);
    await page.keyboard.press('Enter');
    const saved = await waitFor(async (id) => (await window.api.settings.get()).tts?.germanVoice === id, other, 8000);
    check('menu: the chosen voice is saved like in the settings', !!saved, other);
    await waitFor(([id]) => (window.__ttsTrace || []).some((e) => e.voice === id), [other], 15000);
    await sleep(1500);
    const tr = lastPerSentence(await trace());
    const firstNew = tr.find((e) => e.voice === other);
    const before = tr.filter((e) => e.i <= at);
    check('menu: the new voice from the next sentence on', firstNew && firstNew.i <= at + 2 && before.every((e) => e.voice === 'de_DE-thorsten-medium') && tr.filter((e) => e.i >= firstNew.i).every((e) => e.voice === other), { at, firstNew: firstNew && [firstNew.i, firstNew.voice], seq: tr.map((e) => [e.i, e.voice.replace('de_DE-', '')]) });
    // speed
    await ev(() => document.querySelector('.tts-menu [data-key="speed-1.25"]')?.click());
    check('menu: speed saved', !!await waitFor(async () => (await window.api.settings.get()).tts?.speed === 1.25, null, 5000));
    // the language of the book: automatic off, English, the reading follows, and back
    await ev(() => document.querySelector('.tts-menu [data-key="auto"]')?.click());
    await sleep(300);
    await ev(() => document.querySelector('.tts-menu [data-key="lang-en"]')?.click());
    const stored = await waitFor(async (id) => (await window.api.settings.get()).tts?.bookLang?.[id] === 'en', b.id, 5000);
    await sleep(1500);
    const enNow = lastPerSentence(await trace());
    check('menu: German or English for this book, saved per book, the reading goes on in it', !!stored && enNow.length > 0 && enNow.every((e) => e.lang === 'en'), enNow.slice(0, 3).map((e) => [e.i, e.lang]));
    await ev(() => document.querySelector('.tts-menu [data-key="auto"]')?.click());
    const back = await waitFor(async (id) => (await window.api.settings.get()).tts?.bookLang?.[id] === null, b.id, 5000);
    await sleep(1500);
    check('menu: "Sprache automatisch" again: German from the text', !!back && lastPerSentence(await trace()).every((e) => e.lang === 'de'));
    // Escape closes the menu (the reading goes on), the focus goes back to the button
    await page.keyboard.press('Escape');
    await sleep(300);
    const after = await ev(() => ({ open: !!document.querySelector('.tts-menu'), reading: !!window.__readerTts?.active, focus: document.activeElement?.className || '' }));
    check('menu: Escape closes it, the reading goes on, the focus returns to the button', !after.open && after.reading && /rd-btn-ttsmenu/.test(after.focus), after);
    // a right click on the icon opens it as well
    await ev(() => { const b = [...document.querySelectorAll('.rd-top-right .rd-btn')].find((x) => x.textContent === '🔈'); b?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    check('menu: a right click on the read-aloud icon opens it', !!await waitFor(() => !!document.querySelector('.tts-menu'), null, 4000));
    await page.keyboard.press('Escape');
    // the language switch of the interface changes the texts of the menu at once
    await ev(() => window.api.settings.set({ language: 'en' }));
    await sleep(500);
    await page.keyboard.press('Shift+V');
    const enTexts = await waitFor(() => { const m = document.querySelector('.tts-menu'); return m && m.querySelector('.tts-menu-item') ? m.innerText : null; }, null, 8000);
    check('menu: English texts with the English interface', enTexts && /German voice/i.test(enTexts) && /Detect the language/.test(enTexts) && !/Deutsche Stimme|männlich|weiblich/i.test(enTexts), (enTexts || '').slice(0, 200));
    await shot('rtc-menu-reader-en');
    await page.keyboard.press('Escape');
    await ev(() => window.api.settings.set({ language: 'de', tts: { germanVoice: 'de_DE-thorsten-medium', speed: 1 } }));
    await closeAll();
  }

  // ================================================================================================================
  if (PARTS.includes('browser') && BOOKS) {
    const port = Number(process.env.TTS_WEB_PORT || 47322);
    const server = http.createServer((req, res) => {
      const f = path.join(BOOKS, 'web', decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, ''));
      if (!f.startsWith(path.join(BOOKS, 'web')) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(f));
    }).listen(port, '127.0.0.1');
    try {
      await ev(() => window.__app.ctx.openPanel('browser', {}));
      await page.waitForFunction(() => document.querySelector('.br-panel')?.__br, null, { timeout: 20000 });
      await ev((u) => document.querySelector('.br-panel').__br.navigate(u, { reader: true }), `http://127.0.0.1:${port}/wiki-de.html`);
      const ready = await waitFor(() => { const B = document.querySelector('.br-panel').__br; return B.reader?.article?.title ? true : null; }, null, 30000);
      check('browser: the encyclopedia page opens in reader mode', !!ready);
      await ev(() => { window.__ttsTrace = []; window.__ttsDryRun = 0.4; });
      await ev(() => document.querySelector('.br-panel').__br.tts.start());
      await waitFor(() => (window.__ttsTrace || []).length >= 6, null, 20000);
      await sleep(1500);
      const tr = lastPerSentence(await trace());
      const first = truth['web/wiki-de.html']?.first || [];
      const got = tr.slice(0, first.length).map((e) => norm(e.text));
      check('browser: the same first sentences as the book', got.join(' | ') === first.map(norm).join(' | '), { got, want: first });
      check('browser: German for every sentence, the German voice', tr.length >= 4 && tr.every((e) => e.lang === 'de' && e.voice === 'de_DE-thorsten-medium'), tr.slice(0, 4).map((e) => [e.lang, e.voice]));
      // the PDF of the same text gave the same sentences (books part)
      try {
        const pdf = JSON.parse(fs.readFileSync(path.join(process.env.SHOT_DIR || '.', 'reader-tts-pdf-sentences.json'), 'utf8'))['Sachbuch/Lesen am Fluss.pdf'];
        if (pdf) check('browser and PDF: the same sentences and languages for the same text', pdf.slice(0, first.length).map((s) => norm(s.text) + '/' + s.lang).join(' | ') === tr.slice(0, first.length).map((e) => norm(e.text) + '/' + e.lang).join(' | '), { pdf: pdf.slice(0, 3), web: tr.slice(0, 3).map((e) => [e.text, e.lang]) });
      } catch {}
      // the voice menu: Shift+V in the reading browser
      await ev(() => document.querySelector('.br-panel').focus?.());
      await page.keyboard.press('Shift+V');
      const m = await waitFor(() => { const x = document.querySelector('.tts-menu'); return x && x.querySelector('.tts-menu-item') ? { items: x.querySelectorAll('.tts-menu-item').length, speeds: x.querySelectorAll('[data-key^="speed-"]').length } : null; }, null, 8000);
      check('browser: Shift+V opens the voice menu', m && m.items >= 38 && m.speeds === 6, m);
      await shot('rtc-menu-browser');
      await ev(() => document.querySelector('.tts-menu [data-key="speed-1.1"]')?.click());
      check('browser: the speed of the reading browser changes', !!await waitFor(() => Math.abs((document.querySelector('.br-panel').__br.prefs.ttsSpeed || 0) - 1.1) < 0.01, null, 4000));
      await page.keyboard.press('Escape');
      await ev(() => document.querySelector('.br-panel').__br.tts.stop(true));
    } finally { server.close(); await closeAll(); }
  }

  // ================================================================================================================
  if (PARTS.includes('all')) {
    const port = Number(process.env.TTS_MOCK_PORT || 47321);
    const catalogue = require(path.join(__dirname, '..', '..', 'electron', 'tts', 'piper.js')).CATALOGUE;
    const sizes = new Map();
    for (const v of catalogue) {
      if (v.files) for (const f of v.files) sizes.set('/kokoro/' + f.path, f.bytes);
      else { sizes.set(`/piper/${v.dir}/${v.id}.onnx`, v.bytes); sizes.set(`/piper/${v.dir}/${v.id}.onnx.json`, -1); }
    }
    const log = [];
    const failOnce = new Set(['/piper/kerstin/low/de_DE-kerstin-low.onnx']);
    const slow = '/piper/thorsten/medium/de_DE-thorsten-medium.onnx';
    const zero = Buffer.alloc(1 << 20);
    const server = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      const size = sizes.get(url);
      log.push({ url, range: req.headers.range || null });
      if (size === undefined) { res.writeHead(404); res.end(); return; }
      if (failOnce.has(url)) { failOnce.delete(url); res.writeHead(404); res.end(); return; }
      if (size === -1) { const body = '{"audio":{"sample_rate":22050},"phoneme_id_map":{}}'; res.writeHead(200, { 'content-length': Buffer.byteLength(body), 'content-type': 'application/json' }); res.end(body); return; }
      const m = /bytes=(\d+)-/.exec(req.headers.range || '');
      const from = m ? Math.min(+m[1], size) : 0;
      res.writeHead(m ? 206 : 200, { 'content-length': size - from, 'accept-ranges': 'bytes', ...(m ? { 'content-range': `bytes ${from}-${size - 1}/${size}` } : {}) });
      let left = size - from, closed = false;
      res.on('close', () => { closed = true; });
      const pump = () => {
        while (left > 0 && !closed) {
          const n = Math.min(left, zero.length);
          left -= n;
          if (!res.write(n === zero.length ? zero : zero.subarray(0, n))) { res.once('drain', () => (url === slow ? setTimeout(pump, 40) : pump())); return; }
          if (url === slow) { setTimeout(pump, 40); return; }   // about 25 MB/s: time to cancel it
        }
        if (!closed) res.end();
      };
      pump();
    }).listen(port, '127.0.0.1');
    try {
      // the English model: a stand-in for its 90 to 330 MB download from Hugging Face (its own code path is the
      // worker cache of Transformers.js; nothing is downloaded here)
      await ev(() => {
        const c = window.__ttsClient;
        let cached = false;
        c.englishModel = async () => ({ cached, bytes: 92364770, dtype: 'q8' });
        c.installEnglish = async () => { for (let k = 1; k <= 5; k++) { await new Promise((r) => setTimeout(r, 120)); } cached = true; return { cached: true }; };
      });
      await ev(() => window.__app.openPanel('settings', { section: 'tts' }));
      const label = await waitFor(() => document.querySelector('.tts-all-start')?.textContent || null, null, 20000);
      const totalBytes = catalogue.reduce((n, v) => n + v.bytes, 0) + 92364770;
      const mib = totalBytes / 1048576;
      const size = mib >= 1000 ? (mib / 1024).toFixed(1).replace('.', ',') + ' GB' : Math.round(mib) + ' MB';
      check('all voices: the button names the total size of every missing voice', label && label.includes(`(${size})`), { label, size });
      await shot('rtc-all-before');
      await ev(() => document.querySelector('.tts-all-start').click());
      // cancel while Thorsten (mittel) loads
      await waitFor(() => (window.__ttsClient.downloads.items || []).some((x) => x.id === 'de_DE-thorsten-medium' && x.state === 'downloading' && x.received > 10e6), null, 120000);
      await shot('rtc-all-running');
      const running = await ev(() => ({ bar: !!document.querySelector('.tts-all-bar[role="progressbar"]'), items: document.querySelectorAll('.tts-all-item').length, cancel: [...document.querySelectorAll('.tts-all .btn')].some((b) => /Abbrechen/.test(b.textContent)) }));
      check('all voices: one bar for everything, one line per voice, a cancel button', running.bar && running.items === 11 && running.cancel, running);
      await ev(() => [...document.querySelectorAll('.tts-all .btn')].find((b) => /Abbrechen/.test(b.textContent))?.click());
      await waitFor(() => !window.__ttsClient.downloads.running, null, 30000);
      await sleep(800);
      const resume = await waitFor(() => document.querySelector('.tts-all-start')?.textContent || null, null, 10000);
      const partFile = path.join(process.env.COZYSHELVES_PIPER_DIR || '', 'de_DE-thorsten-medium.onnx.part');
      check('all voices: cancelled, the part file stays and the button offers to resume', resume && /fortsetzen/.test(resume) && fs.existsSync(partFile), { resume, part: fs.existsSync(partFile) });
      const ranges0 = log.length;
      await ev(() => document.querySelector('.tts-all-start').click());
      await waitFor(() => !window.__ttsClient.downloads.running && (window.__ttsClient.downloads.items || []).length, null, 300000);
      await sleep(800);
      const snap = await ev(() => window.__ttsClient.downloads);
      check('all voices: the cancelled voice goes on with a Range request', log.slice(ranges0).some((x) => x.url === slow && x.range && !/bytes=0-/.test(x.range)), log.slice(ranges0).filter((x) => x.url === slow));
      const failedOne = snap.items.find((x) => x.state === 'failed');
      const ui = await ev(() => ({ fail: document.querySelector('.tts-all-fail')?.textContent || '', retry: [...document.querySelectorAll('.tts-all .btn')].some((b) => /Erneut versuchen/.test(b.textContent)), text: document.querySelector('.tts-all')?.innerText || '' }));
      check('all voices: a failure is listed with a retry, the others still load', failedOne?.id === 'de_DE-kerstin-low' && ui.retry && /Kerstin/.test(ui.fail) && !/Alle 11 Stimmen/.test(ui.text) && snap.items.filter((x) => x.state === 'done').length >= 8, { failed: failedOne, ui, states: snap.items.map((x) => [x.id, x.state]) });
      await shot('rtc-all-failed');
      await ev(() => [...document.querySelectorAll('.tts-all .btn')].find((b) => /Erneut versuchen/.test(b.textContent))?.click());
      await waitFor(() => !window.__ttsClient.downloads.running && (window.__ttsClient.downloads.items || []).some((x) => x.id === 'de_DE-kerstin-low' && x.state === 'done'), null, 120000);
      await sleep(1500);
      const done = await waitFor(() => document.querySelector('.tts-all-sum')?.textContent || null, null, 10000);
      const inv = await ev(async () => (await window.api.invoke('tts:piperVoices')).voices.map((v) => [v.id, v.installed]));
      check('all voices: after the retry every voice is here', /Alle 11 Stimmen/.test(done || '') && inv.every((x) => x[1]), { done, inv });
      // a second run skips everything
      const again = await ev(async () => (await window.__ttsClient.downloadAllVoices()).items.map((x) => x.state));
      check('all voices: voices that are here are skipped', again.length === 11 && again.every((s) => s === 'skipped'), again);
      for (const v of catalogue) {
        const files = v.files ? v.files.map((f) => [v.id + f.ext, f.bytes]) : [[v.id + '.onnx', v.bytes]];
        for (const [f, bytes] of files) { const p = path.join(process.env.COZYSHELVES_PIPER_DIR || '', f); if (!fs.existsSync(p) || fs.statSync(p).size !== bytes) check(`all voices: ${f} complete`, false, fs.existsSync(p) ? fs.statSync(p).size : 'missing'); }
      }
      await shot('rtc-all-done');
    } finally { server.close(); await closeAll(); }
  }

  // ================================================================================================================
  // the first sentences of the books as the voices say them now, as WAV for a speech recognizer (nothing is played)
  if (PARTS.includes('wav') && BOOKS && process.env.TTS_WAV_DIR) {
    fs.mkdirSync(process.env.TTS_WAV_DIR, { recursive: true });
    const cases = [];
    for (const rel of Object.keys(truth)) if (!rel.startsWith('web/')) cases.push([rel, undefined]);
    cases.push(['Sachbuch/Lesen am Fluss.pdf', 'en'], ['Schach/Endspielkurs.pdf', 'en']);
    for (const [rel, meta] of cases) {
      const b = bookOf(rel); if (!b) continue;
      if (meta !== undefined) await ev(([id, l]) => window.api.library.update(id, { language: l }), [b.id, meta]);
      await openBook(b.id);
      await startReading(0.05);
      let tr = [];
      for (let i = 0; i < 100; i++) { tr = lastPerSentence(await trace()); if (tr.length >= 3) break; await sleep(200); }
      await closeAll();
      if (meta !== undefined) await ev(([id, l]) => window.api.library.update(id, { language: l }), [b.id, b.language]);
      const first = tr.filter((e) => !e.skipped).slice(0, 3);
      if (!first.length) continue;
      const lang = first[0].lang;
      const sents = first.filter((e) => e.lang === lang).map((e) => e.text);
      const out = await ev(async ([s, l, chess]) => { const o = await window.__ttsClient.render(s, { lang: l, chess }); return { rate: o.sampleRate, samples: Array.from(o.samples) }; }, [sents, lang, !!b.isChess]);
      const name = (rel.replace(/[\\/]/g, '_') + (meta !== undefined ? '-meta-' + meta : '') + '-' + lang).replace(/[^\w.-]+/g, '_');
      fs.writeFileSync(path.join(process.env.TTS_WAV_DIR, name + '.wav'), wav(out.samples, out.rate));
      fs.writeFileSync(path.join(process.env.TTS_WAV_DIR, name + '.txt'), sents.join(' '));
      console.log('INFO wav', name, first.map((e) => `${e.lang}:${e.engine}:${e.voice}`).join(' '));
    }
  }

  check('no page errors', errors.length === 0, errors.slice(0, 5));
  const passed = results.filter((r) => r.ok).length;
  console.log(`reader-tts-check: ${passed}/${results.length} passed`);
};

function wav(samples, rate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}
