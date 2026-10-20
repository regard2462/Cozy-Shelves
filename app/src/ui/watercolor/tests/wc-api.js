// API smoke test at full easel resolution: custom pigment, underdrawing, resize, undo/redo, toDataURL, readPixels.
const fs = require('fs');
module.exports = async ({ page, shot }) => {
  page.setDefaultTimeout(600000);
  const photo = process.env.PHOTO || 'shots/dev-wc-gen-meadow.png';
  const url = 'data:image/png;base64,' + fs.readFileSync(photo).toString('base64');
  const r = await page.evaluate(async (url) => {
    const sim = window.__wcSim, P = window.__wcPanel, gl = sim.gl;
    const out = { size: [sim.width, sim.height, sim.simWidth, sim.simHeight], float: sim.isFloat };
    const img = new Image(); await new Promise((r) => { img.onload = r; img.src = url; });
    P.st.refImg = img; P.st.refOpacity = 0.5; P.applyRef();
    P.addCustom('#c0392b'); out.customIdx = P.st.pigment; out.nPig = sim.pigments.length;
    sim.snapshot();
    sim.strokeLine(100, 100, 700, 140, { radius: 30, pigment: P.st.pigment, water: 0.7, pressure: 0.7 });
    sim.strokeLine(100, 300, 700, 340, { radius: 30, pigment: 11, water: 0.5, pressure: 0.7 });
    sim.strokeLine(100, 480, 700, 500, { radius: 20, pigment: 4, water: 0.2, pressure: 0.9, mode: 'dry' });
    sim.strokeLine(300, 80, 320, 520, { radius: 25, pigment: null, water: 0.5, pressure: 0.9, mode: 'lift' });
    const t0 = performance.now(); sim.step(20); sim.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); out.msPerStepFullRes = (performance.now() - t0) / 20;
    out.undo = sim.undo(); out.redo = sim.redo(); out.canUndo = sim.canUndo;
    sim.resize(800, 560); out.afterResize = [sim.width, sim.height, sim.simWidth, sim.simHeight];
    const px = sim.readPixels(); out.px = [px.width, px.height, px.data.length];
    out.dataUrlLen = sim.toDataURL().length;
    sim.setPaper('rough', 42); sim.render();
    out.err = gl.getError();
    return out;
  }, url);
  console.log(JSON.stringify(r));
  await shot('dev-wc-api');
};
