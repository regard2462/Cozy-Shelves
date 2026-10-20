// Audit baseline: opens every 2D panel of the audit scope at three window sizes, takes screenshots and
// collects console errors / page errors per panel. SHOT_TAG prefixes the file names (before/after runs).
const kit = require('./audit-lib');

module.exports = async (env) => {
  const k = kit(env);
  const { page, shot, sleep, log } = k;
  const tag = process.env.SHOT_TAG || 'b-';
  const sizes = (process.env.AUDIT_SIZES || '1600x900,1024x640,2560x1440').split(',').map((s) => s.split('x').map(Number));
  await k.boot();
  const bookId = await page.evaluate(() => (window.__app.state.library.books.find((b) => b.format === 'epub') || window.__app.state.library.books[0])?.id);
  const panels = [
    ['menu', { tab: 'start' }], ['menu', { tab: 'guide' }], ['menu', { tab: 'places' }], ['menu', { tab: 'recent' }],
    ['computer', {}], ['computer', { section: 'catalog' }], ['computer', { section: 'history' }], ['computer', { section: 'diary' }],
    ['computer', { section: 'stats' }], ['computer', { section: 'games' }], ['computer', { section: 'system' }],
    ['news', {}], ['wiki', {}], ['podcasts', {}], ['catalog', {}],
    ['chess', { mode: 'play' }], ['chess', { mode: 'puzzles' }],
    ['watercolor', {}], ['gallery', {}], ['records', {}], ['basket', {}], ['bookinfo', { id: bookId }],
    ['settings', { section: 'general' }], ['settings', { section: 'graphics' }], ['settings', { section: 'light' }],
    ['settings', { section: 'audio' }], ['settings', { section: 'tts' }], ['settings', { section: 'library' }],
    ['reader', { id: bookId }],
  ];
  const only = process.env.AUDIT_ONLY ? new RegExp(process.env.AUDIT_ONLY) : null;
  for (const [w, hgt] of sizes) {
    await k.setSize(w, hgt);
    for (const [name, params] of panels) {
      const label = name + (params.tab ? '-' + params.tab : '') + (params.section ? '-' + params.section : '') + (params.mode ? '-' + params.mode : '');
      if (only && !only.test(label)) continue;
      k.newErrors();
      await k.open(name, params, name === 'reader' || name === 'news' || name === 'wiki' || name === 'podcasts' || name === 'catalog' ? 5000 : 2200);
      await shot(`${tag}${w}-${label}`);
      const ov = await k.overflow();
      const errs = k.newErrors();
      log(`PANEL ${w}x${hgt} ${label} errors=${errs.length}${errs.length ? ' ' + JSON.stringify(errs.slice(0, 4)) : ''}${ov.length ? ' OVERFLOW ' + JSON.stringify(ov.slice(0, 5)) : ''}`);
      await k.closeAll();
    }
  }
  log('ALL-ERRORS ' + JSON.stringify(k.errors.slice(0, 40), null, 1));
};
