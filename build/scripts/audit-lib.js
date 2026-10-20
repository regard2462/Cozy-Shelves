// Shared helpers for the audit-*.js Electron scripts (build/screenshot.js runs them).
// Every run is silent: build/screenshot.js starts Electron with --mute-audio, and audio is checked through
// state (paused, currentTime, AudioContext.state), never by ear.
module.exports = function auditKit({ app, page, shot, sleep }) {
  const errors = [];
  const ignore = [/root document of this element is not valid for pointer lock/i, /THREE\.Clock/];
  page.on('pageerror', (e) => {
    if (ignore.some((r) => r.test(e.message))) return;
    errors.push('pageerror: ' + e.message);
    if (process.env.AUDIT_STACKS) console.log('[stack] ' + String(e.stack || '').split('\n').slice(0, 6).join(' | '));
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (ignore.some((r) => r.test(t))) return;
    errors.push('console: ' + t.slice(0, 300));
  });
  const log = (...a) => console.log(...a);
  // "Failed to load resource" console lines carry no URL: remember the failing responses themselves
  const badResponses = [];
  page.on('response', (r) => { const s = r.status(); if (s >= 400) badResponses.push(`${s} ${r.url().slice(0, 160)}`); });
  page.on('requestfailed', (r) => badResponses.push(`failed ${r.failure()?.errorText || ''} ${r.url().slice(0, 160)}`));
  let mark = 0;
  /** errors since the last call */
  const newErrors = () => { const e = errors.slice(mark); mark = errors.length; return e; };

  async function boot({ enter = true } = {}) {
    await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
    await page.evaluate(() => window.__app.world.stop());
    if (enter) { await page.evaluate(() => document.querySelector('.menu-btn.primary').click()); await sleep(900); }
    for (let i = 0; i < 90; i++) {
      const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
      if (!st.active && st.n > 0) break;
      await sleep(1500);
    }
    await page.evaluate(() => window.__app.world.stop());
  }
  async function open(name, params = {}, wait = 1500) {
    await page.evaluate(([n, p]) => window.__app.openPanel(n, p), [name, params]);
    await sleep(wait);
  }
  const closeAll = async () => { await page.evaluate(() => window.__app.closeAllPanels()); await sleep(350); };
  const text = (sel = '#panels') => page.evaluate((s) => (document.querySelector(s)?.innerText || '').replace(/\s+/g, ' ').trim(), sel);
  const exists = (sel) => page.evaluate((s) => !!document.querySelector(s), sel);
  const count = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
  const click = async (sel, wait = 400) => { const ok = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel); await sleep(wait); return ok; };
  /** click the first element matching `sel` whose text contains `needle` */
  const clickText = async (sel, needle, wait = 400) => {
    const ok = await page.evaluate(([s, n]) => { const el = [...document.querySelectorAll(s)].find((x) => (x.textContent || '').includes(n)); if (!el) return false; el.click(); return true; }, [sel, needle]);
    await sleep(wait); return ok;
  };
  const setSize = async (width, height) => { await page.setViewportSize({ width, height }); await sleep(400); };
  /** elements that stick out of the viewport or overflow their box horizontally (layout bugs) */
  const overflow = (root = '#panels') => page.evaluate((r) => {
    const out = [];
    const W = window.innerWidth, H = window.innerHeight;
    for (const el of document.querySelectorAll(r + ' *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      if (b.right > W + 1 || b.left < -1) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} x:${Math.round(b.left)}..${Math.round(b.right)} (W=${W})`);
      if (out.length > 12) break;
    }
    return out;
  }, root);
  return { errors, badResponses, newErrors, log, boot, open, closeAll, text, exists, count, click, clickText, setSize, overflow, shot, sleep, page, app };
};
