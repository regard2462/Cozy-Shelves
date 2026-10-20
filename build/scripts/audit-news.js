// Audit: newspaper. Every category loads, the feed check marks dead feeds, articles are extracted with images
// through img://, read state counts down, a feed is added (discovery on a web page) and removed again.
const kit = require('./audit-lib');

module.exports = async (env) => {
  const k = kit(env);
  const { page, shot, sleep, log } = k;
  page.on('dialog', (d) => d.accept().catch(() => {}));   // "Feed entfernen?"
  await k.boot();
  await k.open('news', {}, 3000);
  const waitLoaded = async (max = 60000) => {
    const t0 = Date.now();
    for (;;) {
      const st = await page.evaluate(() => ({ spinner: !!document.querySelector('.news-main .news-spinner'), bar: !!document.querySelector('.news-loading-bar'), items: document.querySelectorAll('.news-item').length, state: document.querySelector('.news-state p')?.textContent || null }));
      if ((!st.spinner && !st.bar) || Date.now() - t0 > max) return { ...st, ms: Date.now() - t0 };
      await sleep(600);
    }
  };
  const cats = await page.evaluate(() => [...document.querySelectorAll('.news-cat')].map((c) => c.querySelector('.news-cat-label')?.textContent));
  // AUDIT_QUICK=1: only the dialog part (adding and removing a feed)
  for (let i = 0; i < (process.env.AUDIT_QUICK ? 0 : cats.length); i++) {
    k.newErrors();
    await page.evaluate((n) => document.querySelectorAll('.news-cat')[n].click(), i);
    await sleep(400);
    const st = await waitLoaded();
    await sleep(1500);
    const imgs = await page.evaluate(() => { const im = [...document.querySelectorAll('.news-item img')]; return { shown: im.filter((x) => x.naturalWidth > 2).length, total: im.length }; });
    const broken = await page.evaluate(() => [...document.querySelectorAll('.news-feed .news-dot.broken')].map((d) => d.parentElement.querySelector('.news-feed-title')?.textContent));
    log(`CAT ${cats[i]} items=${st.items} ms=${st.ms} state=${st.state} imgs=${JSON.stringify(imgs)} brokenFeeds=${JSON.stringify(broken)} errors=${k.newErrors().length}`);
    if (i < 3) await shot(`n-cat-${i}`);
  }

  // ---- feed check ------------------------------------------------------------------------------------------------
  await page.evaluate(() => document.querySelectorAll('.news-cat')[0].click()); await waitLoaded();
  if (!process.env.AUDIT_QUICK) await k.clickText('.news-tools .btn', 'Prüfen', 1000);
  for (let t = 0; t < (process.env.AUDIT_QUICK ? 0 : 120); t++) {
    const running = await page.evaluate(() => /\d+\/\d+/.test([...document.querySelectorAll('.news-tools .btn')].map((b) => b.textContent).join(' ')));
    if (!running) break;
    await sleep(1500);
  }
  const health = await page.evaluate(async () => { const r = await window.api.feeds.list(); return r.feeds.filter((f) => f.health?.status === 'broken').map((f) => `${f.title} [${f.category}]: ${f.health.error}`); });
  log('HEALTH-BROKEN ' + health.length + ' ' + JSON.stringify(health, null, 1));

  // ---- articles: extraction, images, read state --------------------------------------------------------------------
  const unreadBefore = await page.evaluate(() => document.querySelector('.news-cat.active .news-cat-count')?.textContent);
  for (let n = 0; n < 3; n++) {
    await page.evaluate((i) => document.querySelectorAll('.news-item')[i]?.click(), n * 4);
    for (let t = 0; t < 40; t++) { const l = await page.evaluate(() => !!document.querySelector('.news-art-loading')); if (!l) break; await sleep(700); }
    await sleep(2500);   // images load after the text
    const art = await page.evaluate(() => ({ title: document.querySelector('.news-art-title')?.textContent.slice(0, 80), paras: document.querySelectorAll('.news-art-body p').length, chars: (document.querySelector('.news-art-body')?.innerText || '').length, imgs: [...document.querySelectorAll('.news-art img')].map((i) => ({ ok: i.naturalWidth > 2, proxied: i.src.startsWith('img://') })), bodyImgs: document.querySelectorAll('.news-art-body img').length, note: document.querySelector('.news-art-note')?.innerText.slice(0, 160) || null, links: document.querySelectorAll('.news-art-body a[href]').length }));
    log('ARTICLE ' + JSON.stringify(art));
    if (n === 0) await shot('n-article');
    await page.keyboard.press('Escape'); await sleep(800);
  }
  const unreadAfter = await page.evaluate(() => document.querySelector('.news-cat.active .news-cat-count')?.textContent);
  log(`UNREAD ${unreadBefore} → ${unreadAfter}`);

  // ---- add a feed by its web page, then remove it -------------------------------------------------------------------
  // a site that is already in the list: the dialog says where
  await k.clickText('.news-tools .btn', 'Feed', 700);
  await page.evaluate(() => { const i = document.querySelector('.news-dialog input.input'); i.value = 'https://www.heise.de/'; });
  await k.clickText('.news-dialog .btn', 'Prüfen', 12000);
  log('CHECK-KNOWN ' + await page.evaluate(() => document.querySelector('.news-dialog-result')?.innerText.replace(/\s+/g, ' ').slice(0, 300)));
  // a new site with a feed link on its page
  await page.evaluate(() => { const i = document.querySelector('.news-dialog input.input'); i.value = 'https://www.bildblog.de/'; });
  await k.clickText('.news-dialog .btn', 'Prüfen', 12000);
  const check = await page.evaluate(() => document.querySelector('.news-dialog-result')?.innerText.replace(/\s+/g, ' ').slice(0, 300));
  log('CHECK ' + check);
  await shot('n-add-dialog');
  await k.clickText('.news-dialog .btn.primary', 'Hinzufügen', 6000);
  const added = await page.evaluate(async () => (await window.api.feeds.list()).feeds.filter((f) => f.custom).map((f) => `${f.title} [${f.category}] ${f.url}`));
  log('ADDED ' + JSON.stringify(added));
  await shot('n-added');
  const removeBtn = await page.evaluate(() => { const b = document.querySelector('.news-feed-remove'); if (!b) return false; b.click(); return true; });
  await sleep(2500);
  const afterRemove = await page.evaluate(async () => (await window.api.feeds.list()).feeds.filter((f) => f.custom).length);
  log(`REMOVE clicked=${removeBtn} customLeft=${afterRemove}`);
  await k.closeAll();

  const imgFails = [...new Set(k.badResponses.filter((r) => /img:\/\//.test(r)))].map((r) => { const m = /img:\/\/cache\/([A-Za-z0-9_-]+)/.exec(r); let host = '?'; try { host = new URL(Buffer.from(m[1], 'base64url').toString('utf8')).hostname; } catch {} return r.split(' ')[0] + ' ' + host; });
  const byHost = {}; for (const f of imgFails) byHost[f] = (byHost[f] || 0) + 1;
  log('IMG-FAILS ' + JSON.stringify(byHost));
  log('ALL-ERRORS ' + JSON.stringify(k.errors.filter((e) => !/Failed to load resource/.test(e)).slice(0, 20), null, 1));
};
