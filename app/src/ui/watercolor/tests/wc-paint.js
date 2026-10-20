// Interaction test for the watercolor studio: paints with mouse events, then runs the generator for 3 motifs.
// usage: node build/dev-shot.js watercolor simScale=0.4 steps=2 drying=1 genQ=0.35 --interact=app/src/ui/watercolor/tests/wc-paint.js
module.exports = async ({ page, shot }) => {
  page.setDefaultTimeout(600000);
  const box = async () => { const r = await page.evaluate(() => { const c = document.querySelector('.wc-canvas').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; }); return r; };
  const b = await box();
  const at = (fx, fy) => [b.x + b.w * fx, b.y + b.h * fy];
  const pick = (idx) => page.click(`.wc-swatch[data-idx="${idx}"]`);
  const brush = (id) => page.click(`.wc-brush[data-id="${id}"]`);
  const drag = async (pts, steps = 12) => { await page.mouse.move(...at(...pts[0])); await page.mouse.down(); for (const p of pts.slice(1)) await page.mouse.move(...at(...p), { steps }); await page.mouse.up(); };
  const steps = async (n) => page.evaluate((n) => { window.__wcSim.step(n); window.__wcSim.render(); }, n);

  // 1. big ultramarine wash (zig-zag), wet
  await brush('round-l'); await pick(5);
  const zig = []; for (let i = 0; i <= 8; i++) zig.push([0.1 + 0.8 * (i % 2), 0.12 + i * 0.045]);
  await drag(zig, 16);
  await page.waitForTimeout(500); await steps(10);
  // 2. rose dropped into the wet wash (wet-in-wet bleeding)
  await brush('round-m'); await pick(0);
  await drag([[0.35, 0.25], [0.6, 0.28], [0.4, 0.35], [0.62, 0.38]], 10);
  await steps(15);
  // 3. clean water drops into the drying wash -> blooms / backruns
  await brush('water');
  await drag([[0.72, 0.2], [0.74, 0.22]], 3);
  await drag([[0.25, 0.42], [0.27, 0.43]], 3);
  await shot('dev-wc-paint-wet');
  // 4. cerulean (granulating) stroke + burnt sienna, medium wet, on dry paper; dry brush of payne's grey
  await brush('round-l'); await pick(4);
  await drag([[0.08, 0.68], [0.5, 0.66], [0.9, 0.7]], 14);
  await brush('round-m'); await pick(6);
  await drag([[0.1, 0.84], [0.9, 0.86]], 14);
  await brush('dry'); await pick(7);
  await drag([[0.1, 0.93], [0.9, 0.94]], 14);
  await steps(30);
  await shot('dev-wc-paint-mid');
  // 5. let everything dry (fast drying in the test) and screenshot
  await page.evaluate(() => { const s = window.__wcSim; s.setDryingSpeed(3); s.step(250); });
  await page.waitForFunction(() => !window.__wcSim.isActive(), null, { timeout: 300000, polling: 500 });
  await page.evaluate(() => { const s = window.__wcSim; s.render(); });
  await shot('dev-wc-paint-dry');
  // undo / redo through the keyboard
  await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
  await shot('dev-wc-undo');
  await page.keyboard.press('Control+y'); await page.waitForTimeout(200);

  // 6. generator: three motifs
  const motifs = ['mountain-lake', 'sunset-sea', 'lily-pond'];
  for (let i = 0; i < motifs.length; i++) {
    const t0 = Date.now();
    await page.selectOption('.wc-generator select.input', motifs[i]);
    await page.fill('.wc-seed', String(11 + i * 7)); await page.dispatchEvent('.wc-seed', 'input');
    await page.click('.wc-generator .btn.primary');
    await page.waitForFunction(() => !window.__wcPanel.st.genBusy && window.__wcPanel.st.genResult, null, { timeout: 500000, polling: 500 });
    console.log('generated', motifs[i], 'in', ((Date.now() - t0) / 1000).toFixed(1), 's');
    await shot('dev-wc-gen-' + (i + 1));
    const url = await page.evaluate(() => window.__wcPanel.st.genResult);
    require('fs').writeFileSync(`shots/dev-wc-gen-${i + 1}-img.png`, Buffer.from(url.split(',')[1], 'base64'));
  }
};
