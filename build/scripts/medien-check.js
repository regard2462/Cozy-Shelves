// Strand "medien" of 0.7, end to end with real network data (runs muted and hidden like every harness script):
//   1. order: with English the English-language sources come first on Start, in Sender, in Live-TV and in the
//      search; switching to German puts the German broadcasters first at once
//   2. English sources: DW lists films, one plays in the panel (currentTime advances), its quality menu lists the real
//      sizes (1080p … 270p), switching keeps the position; NHK WORLD (HLS levels) and an Internet Archive film play
//   3. a German film (MediathekViewWeb): the menu lists real sizes, switching keeps the position; a live stream (HLS)
//      lists its levels as sizes; the setting "Bevorzugte Qualität" (720p) picks the closest size of a new film;
//      the download menu names sizes and preselects the closest one
//   4. the newspaper: English papers only in English, the switch "Also papers in other languages", German at once
// Parts: MC_PARTS=order,english,quality,news (default all). Screenshots mc-*.png in SHOT_DIR.
//   node build/screenshot.js medien-check   (COZYSHELVES_BOOKS=<small test library>|structured, COZYSHELVES_USERDATA fresh)
const path = require('path');
const os = require('os');
module.exports = async ({ app, page, shot, sleep }) => {
  // the download menu names its folder: a folder next to the test's user data, never the Videos folder of the user
  const downloadDir = process.env.MT_DOWNLOAD_DIR || path.join(path.dirname(process.env.COZYSHELVES_USERDATA || path.join(os.tmpdir(), 'x')), 'mt-downloads');
  const parts = new Set((process.env.MC_PARTS || 'order,english,quality,news').split(','));
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });
  const cc = (fn, arg) => page.evaluate(fn, arg);
  const waitFor = async (fn, arg, ms = 30000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
  const mp = () => cc(() => { const p = globalThis.__cozyshelvesMediaPlayer; return { mode: p.mode, t: +p.video.currentTime.toFixed(2), paused: p.video.paused, error: p.state.error, quality: p.state.quality, choice: p.state.choice, height: p.state.height, level: p.state.level, qualities: p.state.qualities.map((q) => q.id + (q.height ? ':' + q.height : '')), vh: p.video.videoHeight, src: (p.video.currentSrc || '').slice(0, 40), hls: !!p.hls }; });
  const playingPast = (min, ms = 60000) => waitFor((m) => { const p = globalThis.__cozyshelvesMediaPlayer; return p.current && p.video.currentTime > m && !p.video.paused; }, min, ms);
  const UNREACHABLE = { de: 'Dieser Sender ist gerade nicht erreichbar. Bitte später noch einmal versuchen.', en: 'This channel is not reachable right now. Please try again later.' };
  /** Start a live channel from the Live-TV page: 'plays', 'unreachable' (with the sentence shown) or 'nothing'. */
  const liveOutcome = async (id) => {
    await openMt({ section: 'live' });
    await page.waitForSelector(`.mt-live-card[data-live="${id}"]`, { timeout: 30000 }).catch(() => {});
    await sleep(600);
    await page.click(`.mt-live-card[data-live="${id}"]`);
    await waitFor(() => { const p = globalThis.__cozyshelvesMediaPlayer; return (p.current && p.video.currentTime > 2 && !p.video.paused) || !!p.state.error; }, null, 60000);
    const s2 = await mp();
    const shown = await cc(() => { const e = document.querySelector('.mt-detail:not(.hidden) .mt-stage-error:not(.hidden) p'); return e ? e.textContent : null; });
    return { outcome: s2.t > 2 && !s2.paused && !s2.error ? 'plays' : s2.error ? 'unreachable' : 'nothing', error: s2.error, shown, vh: s2.vh, qualities: s2.qualities };
  };
  const setLang = async (lang) => { await cc((l) => window.api.settings.set({ language: l }), lang); await waitFor((l) => document.documentElement.lang === l, lang, 10000); await sleep(700); };
  const openMt = async (params = {}) => { await cc((p) => window.__app.ctx.openPanel('mediathek', p), params); await page.waitForSelector('.mt-panel', { timeout: 30000 }); await sleep(800); };
  const closeAll = async () => { await cc(() => { globalThis.__cozyshelvesMediaPlayer.stop(); window.__app.closeAllPanels(); }); await sleep(900); };
  const nav = async (section) => { await page.click(`.mt-navitem:nth-child(${['start', 'search', 'channels', 'live', 'favorites', 'continue', 'downloads'].indexOf(section) + 1})`); await sleep(900); };
  const menuItems = () => cc(() => [...document.querySelectorAll('.mt-qmenu .mt-qitem')].map((b) => ({ q: b.dataset.q, text: b.firstChild?.textContent || b.textContent, on: b.classList.contains('on') })));
  // the controls fade out while a film plays (no pointer moves in a test window): wake them and click in one step
  const openQualityMenu = async () => {
    await cc(() => { const st = document.querySelector('.mt-detail .mt-stage'); st?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })); document.querySelector('.mt-detail .mt-qwrap .mt-cbtn').click(); });
    await sleep(500);
    return menuItems();
  };
  const pickQuality = (q) => cc((x) => { const st = document.querySelector('.mt-detail .mt-stage'); st?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })); document.querySelector(`.mt-qmenu .mt-qitem[data-q="${x}"]`)?.click(); }, q);

  // ---- boot ----------------------------------------------------------------------------------------------------------
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await cc(() => { document.querySelector('.menu-btn.primary').click(); });
  await sleep(2500);
  await cc(() => window.__app.world.stop());
  await cc((dir) => window.api.settings.set({ mediathek: { folder: dir } }), downloadDir);
  const defaults = await cc(async () => { const s = await window.api.settings.get(); return { quality: s.mediathek?.quality, others: s.news?.otherLanguages }; });
  check('defaults: preferred quality "auto", papers of other languages off', defaults.quality === 'auto' && defaults.others === false, defaults);

  // ================================================================ 1. order by language ==================================
  if (parts.has('order')) {
    await setLang('en');
    await openMt();
    await page.waitForSelector('.mt-start .mt-row', { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('.mt-start .mt-row .mt-card:not(.mt-skel)').length >= 6, null, { timeout: 60000 }).catch(() => {});
    await sleep(4000);
    const enStart = await cc(() => ({ first: document.querySelector('.mt-start').dataset.first, rows: [...document.querySelectorAll('.mt-start .mt-row[data-row]')].map((r) => r.dataset.row), groups: [...document.querySelectorAll('.mt-start-group')].map((g) => g.dataset.lang), sub: document.querySelector('.mt-brand-sub').textContent, cards: document.querySelectorAll('.mt-start .mt-card:not(.mt-skel)').length, pics: document.querySelectorAll('.mt-start .mt-img.loaded').length }));
    check('English: Start begins with the English-language sources, the German broadcasters follow under their heading', enStart.first === 'en' && enStart.rows[0]?.startsWith('en-') && enStart.rows.indexOf('latest') > enStart.rows.findIndex((r) => r.startsWith('en-')) && enStart.groups[0] === 'de' && /^DW/.test(enStart.sub), enStart);
    check('English rows show films with pictures', enStart.cards >= 12 && enStart.pics >= 4, { cards: enStart.cards, pics: enStart.pics });
    await shot('mc-01-start-en');
    await nav('channels');
    const enChan = await cc(() => [...document.querySelectorAll('.mt-chan-group')].map((g) => g.dataset.group));
    check('English: Sender begins with the English-language group', enChan[0] === 'en' && enChan.includes('ard'), enChan);
    await shot('mc-02-channels-en');
    await nav('live');
    await page.waitForSelector('.mt-live-card', { timeout: 30000 }).catch(() => {});
    await sleep(2500);
    const enLive = await cc(() => ({ groups: [...document.querySelectorAll('.mt-live-group')].map((g) => g.dataset.group), first: [...document.querySelectorAll('.mt-live-group')[0]?.querySelectorAll('.mt-live-card') || []].map((c) => c.dataset.live) }));
    check('English: Live-TV begins with the English news channels', enLive.groups[0] === 'en' && ['dw_en', 'france24_en', 'aljazeera_en', 'nhk_world'].every((id) => enLive.first.includes(id)), enLive);
    await shot('mc-03-live-en');
    await nav('search');
    const enSearch = await cc(() => ({ scope: [...document.querySelectorAll('.mt-scope .mt-seg-item')].map((b) => b.dataset.scope + (b.classList.contains('on') ? '*' : '')), chips: [...document.querySelectorAll('.mt-chips .mt-chip')].map((c) => c.dataset.channel || '') }));
    check('English: the search starts with the English-language sources', enSearch.scope[0] === 'en*' && enSearch.chips.includes('DW.EN') && enSearch.chips.includes('NASA'), enSearch);
    await page.fill('.mt-search-input', 'moon');
    await page.press('.mt-search-input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.mt-search .mt-grid .mt-card:not(.mt-skel)').length >= 4, null, { timeout: 60000 }).catch(() => {});
    await sleep(2500);
    const found = await cc(() => [...document.querySelectorAll('.mt-search .mt-grid .mt-card:not(.mt-skel)')].map((c) => c.querySelector('.mt-card-channel')?.textContent));
    check('English search "moon" finds films of several sources', new Set(found).size >= 2 && found.length >= 4, { n: found.length, channels: [...new Set(found)] });
    await shot('mc-04-search-en');
    // the switch to German reorders the sources at once, with the panel open
    await nav('start');
    await setLang('de');
    await sleep(1500);
    const deStart = await cc(() => ({ first: document.querySelector('.mt-start')?.dataset.first, rows: [...document.querySelectorAll('.mt-start .mt-row[data-row]')].map((r) => r.dataset.row), groups: [...document.querySelectorAll('.mt-start-group')].map((g) => g.dataset.lang), nav: document.querySelector('.mt-navitem[title]')?.title }));
    check('switching to German puts the German broadcasters first at once', deStart.first === 'de' && deStart.rows[0] === 'latest' && deStart.groups[0] === 'en' && deStart.rows.some((r) => r.startsWith('en-')) && deStart.nav === 'Start', deStart);
    await nav('channels');
    const deChan = await cc(() => [...document.querySelectorAll('.mt-chan-group')].map((g) => g.dataset.group));
    check('German: the English-language group comes last in Sender', deChan[deChan.length - 1] === 'en' && deChan[0] === 'ard', deChan);
    await nav('live');
    await page.waitForSelector('.mt-live-card', { timeout: 30000 }).catch(() => {});
    await sleep(1500);
    const deLive = await cc(() => [...document.querySelectorAll('.mt-live-group')].map((g) => g.dataset.group));
    check('German: the English news channels come last in Live-TV', deLive[deLive.length - 1] === 'en' && deLive[0] === 'main', deLive);
    await closeAll();
  }

  // ================================================================ 2. English sources play =================================
  if (parts.has('english')) {
    await setLang('en');
    // DW: the channel page lists films, one plays in the panel
    await openMt();
    await cc(() => window.__app.ctx.openPanel('mediathek', {}));
    await nav('channels');
    await page.click('.mt-chan-group[data-group="en"] .mt-chan:first-child');
    await page.waitForFunction(() => document.querySelectorAll('.mt-source .mt-grid .mt-card:not(.mt-skel)').length >= 8, null, { timeout: 60000 }).catch(() => {});
    await sleep(2500);
    const dwPage = await cc(() => ({ source: document.querySelector('.mt-source')?.dataset.source, cards: document.querySelectorAll('.mt-source .mt-grid .mt-card:not(.mt-skel)').length, tabs: [...document.querySelectorAll('.mt-source .mt-tabs .tab')].map((t) => t.dataset.tab), live: document.querySelectorAll('.mt-source .mt-chan-live').length }));
    check('DW English: the channel page lists films, has topics and a live button', dwPage.source === 'dw' && dwPage.cards >= 8 && dwPage.tabs.includes('topics') && dwPage.live === 1, dwPage);
    await shot('mc-05-dw-channel');
    // a DW film of a few minutes: open, resolve, play (4 min on the card: Weiterschauen keeps films from 3 minutes on,
    // and the card rounds to whole minutes)
    const pick = await cc(() => Math.max(0, [...document.querySelectorAll('.mt-source .mt-grid .mt-card:not(.mt-skel)')].findIndex((c) => { const d = c.querySelector('.mt-dur')?.textContent || ''; return /^\d+ min/.test(d) && parseInt(d, 10) >= 4; })));
    await page.locator('.mt-source .mt-grid .mt-card:not(.mt-skel)').nth(pick).click();
    await page.waitForSelector('.mt-detail:not(.hidden)', { timeout: 15000 });
    await sleep(2500);
    await page.click('.mt-act-watch');
    const dwPlays = await playingPast(3, 60000);
    let st = await mp();
    check('DW film plays in the panel (currentTime advances)', dwPlays && st.mode === 'panel' && /^media:\/\/proxy\//.test(st.src), st);
    const dwMenu = await openQualityMenu();
    await shot('mc-06-dw-quality-menu');
    check('DW film: the quality menu lists Automatic and the real sizes, biggest first', dwMenu[0]?.q === 'auto' && dwMenu.map((m) => m.text).slice(1).join(',') === '1080p,720p,540p,360p,288p,270p', dwMenu.map((m) => m.text + (m.on ? '*' : '')));
    await cc(() => globalThis.__cozyshelvesMediaPlayer.seek(30));
    await playingPast(31, 30000);
    const before = (await mp()).t;
    await pickQuality('h360');
    await waitFor((b) => { const p = globalThis.__cozyshelvesMediaPlayer; return p.state.quality === 'h360' && p.video.currentTime > b - 2 && !p.video.paused && p.video.videoHeight > 0; }, before, 40000);
    st = await mp();
    check('DW film: 360p keeps the position, the picture is 360 high', st.quality === 'h360' && !st.paused && st.t >= before - 2 && st.t < before + 15 && st.vh === 360 && st.height === 360, { before, ...st });
    const btn = await cc(() => document.querySelector('.mt-detail .mt-qwrap .mt-cbtn').textContent);
    check('the quality button shows the size that plays', btn === '360p', btn);
    await sleep(800);
    await shot('mc-07-dw-360p');
    await closeAll();
    // Weiterschauen: the DW film is kept with its position and starts there again
    const cont = await cc(async () => (await window.api.invoke('mediathek:continue')).filter((e) => e.id.startsWith('dw:')).map((e) => ({ id: e.id, position: e.position, item: e.item })));
    check('Weiterschauen keeps the DW film with its position', cont.length === 1 && cont[0].position >= 30, cont.map((e) => ({ id: e.id, position: e.position })));
    if (cont[0]) {
      await openMt({ play: cont[0].item });
      await waitFor(() => globalThis.__cozyshelvesMediaPlayer.video.currentTime > 1, null, 60000);
      const r = await mp();
      check('the DW film resumes where it stopped', r.t >= cont[0].position - 8 && r.t < cont[0].position + 20, { at: r.t, stored: cont[0].position });
      await closeAll();
    }

    // NHK WORLD-JAPAN: an episode is one HLS master, its levels are the sizes
    const nhk = await cc(async () => (await window.api.invoke('mediathek:query', { source: 'nhk', size: 12 })).items.find((x) => x.duration >= 300 && x.duration <= 1800));
    await openMt({ play: nhk });
    const nhkPlays = await playingPast(3, 60000);
    st = await mp();
    check('NHK WORLD-JAPAN episode plays (HLS through the proxy)', nhkPlays && st.hls && /^blob:/.test(st.src), { title: nhk?.title, ...st });
    const nhkMenu = await openQualityMenu();
    check('NHK: the menu lists the levels as sizes', nhkMenu.length >= 3 && nhkMenu.slice(1).every((m) => /^\d+p$/.test(m.text)) && nhkMenu.some((m) => m.text === '720p'), nhkMenu.map((m) => m.text));
    await pickQuality('h360');
    await waitFor(() => { const h = globalThis.__cozyshelvesMediaPlayer.hls; return h && h.levels[h.currentLevel]?.height === 360 && globalThis.__cozyshelvesMediaPlayer.video.videoHeight === 360; }, null, 40000);
    st = await mp();
    check('NHK: 360p switches the level and keeps playing', st.vh === 360 && !st.paused && st.quality === 'h360', st);
    await shot('mc-08-nhk');
    await closeAll();

    // Internet Archive: a public-domain film (the address leads to another archive.org server)
    const ia = await cc(async () => (await window.api.invoke('mediathek:query', { source: 'archive', topic: 'prelinger', size: 6 })).items[0]);
    await openMt({ play: ia });
    const iaPlays = await playingPast(2, 90000);
    st = await mp();
    check('Internet Archive film plays', iaPlays && /^media:\/\/proxy\//.test(st.src), { title: ia?.title, ...st });
    await sleep(800);
    await shot('mc-09-archive');
    await closeAll();

    // every other English-language source plays one film (NASA, TED, arte in English)
    for (const [source, query, label] of [['nasa', { topic: 'popular' }, 'NASA'], ['ted', {}, 'TED'], ['arte-en', { durationMin: 300 }, 'arte in English']]) {
      const it = await cc(async ([s, q]) => (await window.api.invoke('mediathek:query', { source: s, size: 8, ...q })).items[0], [source, query]);
      await openMt({ play: it });
      const ok = await playingPast(2, 90000);
      const s2 = await mp();
      check(`${label}: a film plays`, ok && !s2.error && s2.vh > 0, { title: it?.title, quality: s2.quality, height: s2.height, qualities: s2.qualities });
      if (source === 'nasa') await shot('mc-09b-nasa-film');
      await closeAll();
    }
    // the English news channels play live from the addresses their broadcasters publish (NHK looked up when the
    // channel starts)
    for (const id of ['aljazeera_en', 'nhk_world']) {
      const o = await liveOutcome(id);
      check(`live ${id} plays`, o.outcome === 'plays' && o.vh > 0, o);
      await closeAll();
    }
    // FRANCE 24 English: only its official master; while it refuses that, the player says so in English, and the next
    // channel plays as before
    const f24 = await liveOutcome('france24_en');
    await shot('mc-09e-france24-live-en');
    check('live france24_en: plays from its official master or says in English that it is not reachable right now', f24.outcome === 'plays' || (f24.error === UNREACHABLE.en && f24.shown === UNREACHABLE.en), f24);
    await closeAll();
    const after = await liveOutcome('aljazeera_en');
    check('after FRANCE 24 the next live channel plays as before', after.outcome === 'plays', after);
    await closeAll();

    // a download of a source film: the smallest size of a short DW clip, named with its size, played offline
    const clip = await cc(async () => (await window.api.invoke('mediathek:query', { source: 'dw', topic: 'short', size: 30 })).items.find((x) => x.duration && x.duration <= 180));
    if (!clip) check('a short DW clip to download (network)', false, 'none found');
    else {
      await openMt({ open: clip });
      await page.waitForSelector('.mt-detail:not(.hidden) .mt-act-dl', { timeout: 20000 });
      await sleep(1500);
      await page.click('.mt-detail:not(.hidden) .mt-act-dl');
      await page.waitForFunction(() => document.querySelectorAll('.mt-dlq-item').length >= 3, null, { timeout: 30000 }).catch(() => {});
      await sleep(500);
      const opts = await cc(() => [...document.querySelectorAll('.mt-dlq-item')].map((b) => ({ q: b.dataset.q, name: b.querySelector('.mt-dlq-name').textContent, size: b.querySelector('.mt-dlq-size').textContent })));
      await shot('mc-09c-dw-download-menu');
      // (how many sizes a DW clip has depends on the clip: usually five or six, 1080p down to 270p)
      const heights = opts.map((o) => parseInt(o.name, 10));
      check('DW download menu: the sizes with file sizes, biggest first', opts.length >= 4 && opts[0].name === '1080p' && heights.every((hgt, i) => i === 0 || hgt < heights[i - 1]) && opts.every((o) => /MB|kB/.test(o.size)), opts);
      const smallest = opts[opts.length - 1];
      await page.click('.mt-dlq-item >> nth=-1');
      let d = null;
      for (let i = 0; i < 120; i++) {
        d = (await cc(() => window.api.invoke('mediathek:downloads'))).find((x) => x.item.id === clip.id);
        if (d && (d.status === 'done' || d.status === 'error')) break;
        await sleep(1000);
      }
      check(`DW clip downloaded in the smallest size (${smallest?.name}) into the chosen folder`, d && d.status === 'done' && d.height === parseInt(smallest?.name, 10) && d.quality === smallest?.q && d.file.startsWith(downloadDir), d && { status: d.status, height: d.height, quality: d.quality, bytes: d.bytes, error: d.error });
      await closeAll();
      await openMt({ section: 'downloads' });
      await page.waitForSelector('.mt-dl', { timeout: 15000 }).catch(() => {});
      await sleep(1000);
      const list = await cc(() => [...document.querySelectorAll('.mt-dl .mt-dl-state')].map((e) => e.textContent));
      await shot('mc-09d-downloads');
      check('the download list names the size', list.some((t) => t.includes(smallest?.name || '270p')), list);
      if (d && d.status === 'done') await cc((id) => window.api.invoke('mediathek:remove', id, { files: true }), d.id);
      await closeAll();
    }
  }

  // ================================================================ 3. German films and live TV ================================
  if (parts.has('quality')) {
    await setLang('de');
    // a film of a few minutes with three different files (the seek to 20 s must stay inside it)
    const item = await cc(async () => {
      const ok = (x) => x?.video?.low && x.video.sd && x.video.hd && new Set([x.video.low, x.video.sd, x.video.hd]).size === 3 && x.duration >= 150;
      for (const q of [{ channels: ['ARD'], durationMin: 150, durationMax: 900, size: 20 }, { channels: ['ZDF'], durationMin: 150, durationMax: 900, size: 20 }]) {
        const r = await window.api.invoke('mediathek:query', q).catch(() => null);
        const it = (r?.items || []).find(ok);
        if (it) return it;
      }
      return null;
    });
    if (!item) check('a German film with three qualities (network)', false, 'none found');
    else {
      await openMt({ play: item });
      const plays = await playingPast(2, 60000);
      await sleep(1500);
      const menu = await openQualityMenu();
      await shot('mc-10-german-quality-menu');
      const sizes = menu.slice(1).map((m) => m.text);
      check('German film: the menu lists Automatisch and real sizes', plays && menu[0]?.text.startsWith('Automatisch') && sizes.length === 3 && sizes.every((s) => /^\d+p$/.test(s)) && +sizes[0].slice(0, -1) > +sizes[2].slice(0, -1), menu.map((m) => m.text + (m.on ? '*' : '')));
      await pickQuality('auto');   // closes the menu again
      await cc(() => globalThis.__cozyshelvesMediaPlayer.seek(20));
      await playingPast(21, 30000);
      const before = (await mp()).t;
      const smallest = menu[menu.length - 1].q;
      // by keyboard: Q opens the menu on the chosen entry, the arrows move, Enter chooses
      await page.keyboard.press('q');
      await sleep(400);
      const keyMenu = await cc(() => ({ open: !document.querySelector('.mt-qmenu').classList.contains('hidden'), focus: document.activeElement?.dataset?.q }));
      for (let i = 0; i < menu.length - 1; i++) await page.keyboard.press('ArrowDown');
      const focused = await cc(() => document.activeElement?.dataset?.q);
      await page.keyboard.press('Enter');
      await waitFor(([b, q]) => { const p = globalThis.__cozyshelvesMediaPlayer; return p.state.quality === q && p.video.currentTime > b - 2 && !p.video.paused && p.video.videoHeight > 0; }, [before, smallest], 40000);
      const st = await mp();
      check('keyboard: Q opens the quality menu, the arrows and Enter choose', keyMenu.open && keyMenu.focus === 'auto' && focused === smallest, { keyMenu, focused });
      check('German film: the smallest size keeps the position and plays on', st.quality === smallest && st.t >= before - 2 && st.t < before + 15 && !st.paused && st.vh > 0 && st.vh <= 400, { before, ...st });
      await closeAll();
      // the setting: 720p, a new film starts with the closest size
      await cc(() => window.__app.ctx.openPanel('settings', { section: 'mediathek' }));
      await sleep(1200);
      const seg = await cc(() => ({ label: document.querySelector('.settings-content .setting > label')?.textContent, opts: [...document.querySelectorAll('.settings-content .seg button')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')) }));
      check('Einstellungen → Mediathek: "Bevorzugte Qualität" Automatisch, 1080p, 720p, 480p, 360p', seg.label === 'Bevorzugte Qualität' && seg.opts.join('|') === 'Automatisch*|1080p|720p|480p|360p', seg);
      await page.click('.settings-content .seg button:nth-child(3)');
      await sleep(800);
      await shot('mc-11-settings-quality');
      const stored = await cc(async () => (await window.api.settings.get()).mediathek.quality);
      const marked = await cc(() => [...document.querySelectorAll('.settings-content .seg button.on')].map((b) => b.textContent));
      check('the setting is stored as a height and 720p is marked at once', stored === 720 && marked.join() === '720p', { stored, marked });
      await cc(() => window.__app.closeAllPanels()); await sleep(800);
      await openMt({ play: item });
      await playingPast(2, 60000);
      await sleep(1200);
      let q = await mp();
      const want = q.qualities.filter((x) => x !== 'auto').map((x) => +x.split(':')[1]).filter(Boolean);
      const closest = want.reduce((a, b) => (Math.abs(b - 720) < Math.abs(a - 720) ? b : a), want[0]);
      check('a new film starts with the size closest to 720p', q.choice === 720 && q.height === closest && q.vh === closest, { closest, ...q });
      // the download menu names sizes, the closest one is preselected
      await cc(() => globalThis.__cozyshelvesMediaPlayer.pause());
      await page.click('.mt-detail:not(.hidden) .mt-act-dl');
      await page.waitForFunction(() => document.querySelectorAll('.mt-dlq-item').length >= 2, null, { timeout: 30000 }).catch(() => {});
      await sleep(600);
      const dl = await cc(() => [...document.querySelectorAll('.mt-dlq-item')].map((b) => ({ name: b.querySelector('.mt-dlq-name').textContent, size: b.querySelector('.mt-dlq-size').textContent, def: b.classList.contains('default') })));
      await shot('mc-12-download-sizes');
      check('download menu: sizes with file sizes, the one closest to 720p preselected', dl.length === 3 && dl.every((d) => /^\d+p$/.test(d.name) && /MB|GB|kB/.test(d.size)) && dl.find((d) => d.def)?.name === closest + 'p', dl);
      await cc(() => window.api.settings.set({ mediathek: { quality: 'auto' } }));
      await closeAll();
    }
    // live TV: the levels of the master as sizes, a level keeps playing
    await openMt({ section: 'live' });
    await page.waitForSelector('.mt-live-card[data-live="dw_en"]', { timeout: 30000 }).catch(() => {});
    await sleep(1500);
    await page.click('.mt-live-card[data-live="dw_en"]');
    const live = await playingPast(2, 60000);
    await sleep(2000);
    const lmenu = await openQualityMenu();
    await shot('mc-13-live-quality-menu');
    check('live stream (DW English): the menu lists its levels as sizes', live && lmenu[0]?.q === 'auto' && lmenu.slice(1).map((m) => m.text).join(',') === '1080p,720p,540p,360p,270p', lmenu.map((m) => m.text + (m.on ? '*' : '')));
    await pickQuality('h540');
    await waitFor(() => globalThis.__cozyshelvesMediaPlayer.video.videoHeight === 540 && !globalThis.__cozyshelvesMediaPlayer.video.paused, null, 40000);
    const ls = await mp();
    check('live stream: 540p plays', ls.vh === 540 && ls.quality === 'h540' && !ls.paused, ls);
    await closeAll();
    // FRANCE 24 English: its official master only; while it refuses that, the sentence comes in German here
    const f24de = await liveOutcome('france24_en');
    await shot('mc-14-france24-live');
    check('FRANCE 24 English: plays from its official master or says in German that it is not reachable right now', f24de.outcome === 'plays' || (f24de.error === UNREACHABLE.de && f24de.shown === UNREACHABLE.de), f24de);
    await closeAll();
  }

  // ================================================================ 4. the newspaper ===================================================
  if (parts.has('news')) {
    await setLang('en');
    await cc(() => window.__app.ctx.openPanel('news', {}));
    await page.waitForSelector('.news-feed', { timeout: 30000 });
    await sleep(2500);
    const papers = () => cc(() => ({ langs: [...new Set([...document.querySelectorAll('.news-feeds .news-feed .news-lang')].map((e) => e.textContent))], cats: document.querySelectorAll('.news-cats .news-cat').length, toggle: document.querySelector('.news-langs input')?.checked, label: document.querySelector('.news-langs')?.textContent }));
    let p = await papers();
    check('English: the newspaper shows English papers only', p.langs.join() === 'EN' && p.cats >= 10 && p.toggle === false && /Also papers in other languages/.test(p.label), p);
    await page.waitForFunction(() => document.querySelectorAll('.news-item').length >= 5, null, { timeout: 60000 }).catch(() => {});
    await sleep(2000);
    await shot('mc-15-news-en');
    // the switch shows German papers as well, at once
    await page.click('.news-langs input');
    await waitFor(() => [...document.querySelectorAll('.news-feeds .news-feed .news-lang')].some((e) => e.textContent === 'DE'), null, 10000);
    p = await papers();
    const stored = await cc(async () => (await window.api.settings.get()).news?.otherLanguages);
    check('"Also papers in other languages": German papers appear at once, the setting is stored', p.langs.includes('DE') && p.langs.includes('EN') && p.toggle === true && stored === true, { ...p, stored });
    await page.click('.news-langs input');
    await waitFor(() => ![...document.querySelectorAll('.news-feeds .news-feed .news-lang')].some((e) => e.textContent === 'DE'), null, 10000);
    // German interface: German papers only, at once with the panel open
    await setLang('de');
    await sleep(1500);
    p = await papers();
    check('German: the newspaper switches to German papers at once', p.langs.join() === 'DE' && /Auch Zeitungen in anderen Sprachen/.test(p.label), p);
    await page.waitForFunction(() => document.querySelectorAll('.news-item').length >= 5, null, { timeout: 60000 }).catch(() => {});
    await sleep(1500);
    await shot('mc-16-news-de');
    await cc(() => window.__app.closeAllPanels());
    await sleep(600);
    // the switch in the settings (Allgemein)
    await cc(() => window.__app.ctx.openPanel('settings', { section: 'general' }));
    await sleep(1000);
    const row = await cc(() => [...document.querySelectorAll('.settings-content .setting > label')].map((l) => l.firstChild?.textContent || '').filter((t) => /Zeitungen/.test(t)));
    check('Einstellungen → Allgemein has the switch for papers in other languages', row.length === 1 && row[0] === 'Auch Zeitungen in anderen Sprachen', row);
    await cc(() => window.__app.closeAllPanels());
  }

  await cc(() => { globalThis.__cozyshelvesMediaPlayer.stop(); window.api.settings.set({ language: 'de', mediathek: { quality: 'auto' }, news: { otherLanguages: false } }); });
  check('no uncaught errors in the renderer', errors.length === 0, errors.slice(0, 5));
  const failed = results.filter((r) => !r.ok);
  console.log(`MEDIEN-CHECK ${results.length - failed.length}/${results.length} passed` + (failed.length ? ' · failed: ' + failed.map((f) => f.name).join(' | ') : ''));
};
