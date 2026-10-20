// Parameter sweep: paints the same test picture with several parameter sets and tiles the results.
// usage: node build/dev-shot.js watercolor simScale=0.5 --interact=app/src/ui/watercolor/tests/wc-variants.js
const VARIANTS = JSON.parse(process.env.WC_VARIANTS || '[{},{"eta":0.1},{"pscale":1,"relaxIters":20},{"diffusion":0.5}]');
const STEPS = +(process.env.WC_STEPS || 200);
module.exports = async ({ page, shot }) => {
  page.setDefaultTimeout(600000);
  const box = await page.evaluate(() => { const r = window.__wcSim.canvas.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const clips = [];
  for (let i = 0; i < VARIANTS.length; i++) {
    const stats = await page.evaluate(async ([v, steps]) => {
      const sim = window.__wcSim;
      sim.clear();
      sim.setParams({ evap: 0.004, eta: 0.05, evapS: 0.004, ...v });
      for (let y = 100; y < 250; y += 16) sim.strokeLine(80, y, 520, y + 4, { radius: 24, pigment: 5, water: 0.9, pressure: 0.7, load: 1 }, 0.25);
      sim.step(10);
      for (let y = 150; y < 200; y += 10) sim.strokeLine(220, y, 380, y, { radius: 14, pigment: 0, water: 0.8, pressure: 0.8, load: 1.5 }, 0.25);
      sim.strokeLine(60, 330, 540, 360, { radius: 14, pigment: 6, water: 0.45, pressure: 0.9, load: 1.2 }, 0.25);
      sim.step(Math.round(steps * 0.3));
      sim.strokeLine(300, 120, 330, 140, { radius: 22, pigment: null, water: 1, pressure: 1 }, 0.25);
      sim.step(Math.round(steps * 0.7));
      sim.render();
      const w = sim.readTexture('water'); let su = 0, sp = 0, n = 0, wet = 0;
      for (let i = 0; i < w.data.length; i += 4) { if (w.data[i] >= 0.5) { wet++; su += Math.abs(w.data[i + 1]) + Math.abs(w.data[i + 2]); sp += w.data[i + 3]; } n++; }
      return { wet, meanU: su / Math.max(1, wet), meanP: sp / Math.max(1, wet), err: sim.gl.getError() };
    }, [VARIANTS[i], STEPS]);
    console.log('variant', i, JSON.stringify(VARIANTS[i]), JSON.stringify(stats));
    await page.screenshot({ path: `shots/dev-wc-var-${i}.png`, clip: box });
    clips.push(`shots/dev-wc-var-${i}.png`);
  }
};
