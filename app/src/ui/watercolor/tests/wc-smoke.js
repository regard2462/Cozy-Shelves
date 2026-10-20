// Smoke test for the watercolor simulation: paints strokes via the sim API and checks for GL errors.
module.exports = async ({ page, shot }) => {
  page.setDefaultTimeout(240000);
  const t0 = Date.now();
  const info = await page.evaluate(async () => {
    const sim = window.__wcSim;
    const gl = sim.gl;
    const sync = () => { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); };
    sim.setParams({ evap: 0.004, eta: 0.05, evapS: 0.004 });   // fast drying for the test
    let t = performance.now();
    sim.snapshot();
    // wash: horizontal zig-zag with ultramarine, then rose dropped in wet
    for (let y = 100; y < 250; y += 22) sim.strokeLine(80, y, 520, y + 6, { radius: 24, pigment: 5, water: 0.9, pressure: 0.7, load: 1 }, 0.3);
    sim.step(10);
    for (let y = 150; y < 200; y += 14) sim.strokeLine(220, y, 380, y, { radius: 14, pigment: 0, water: 0.8, pressure: 0.8, load: 1.5 }, 0.3);
    // burnt sienna, medium wet, on dry paper
    sim.strokeLine(60, 330, 540, 360, { radius: 14, pigment: 6, water: 0.45, pressure: 0.9, load: 1.2 }, 0.3);
    // dry brush
    sim.strokeLine(60, 390, 540, 395, { radius: 12, pigment: 7, water: 0.1, pressure: 0.8, load: 1.5, mode: 'dry' }, 0.3);
    sim.render(); sync();
    const tStroke = performance.now() - t;
    t = performance.now();
    sim.step(30); sim.render(); sync();
    const tStep = (performance.now() - t) / 30;
    return { float: sim.isFloat, size: [sim.simWidth, sim.simHeight], tStroke, tStep, err: gl.getError(), slots: sim.slots };
  });
  console.log('smoke', JSON.stringify(info), 'wall', Date.now() - t0, 'ms');
  await shot('dev-wc-smoke-1');
  await page.evaluate(async () => { const sim = window.__wcSim; sim.step(60); sim.strokeLine(300, 120, 330, 140, { radius: 22, pigment: null, water: 1, pressure: 1 }, 0.3); sim.step(40); sim.render(); });
  await shot('dev-wc-smoke-2');
  await page.evaluate(async () => { const sim = window.__wcSim; sim.step(250); sim.render(); });
  await shot('dev-wc-smoke-3');
  await page.evaluate(async () => { const sim = window.__wcSim; sim.dry(); sim.render(); });
  await shot('dev-wc-smoke-dry');
};
