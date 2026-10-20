// Photo -> watercolor test (+ "use on easel" + byte fallback smoke). PHOTO env = path to an image.
const fs = require('fs');
module.exports = async ({ page, shot }) => {
  page.setDefaultTimeout(900000);
  const photo = process.env.PHOTO || 'shots/dev-wc-gen-meadow.png';
  const url = 'data:image/png;base64,' + fs.readFileSync(photo).toString('base64');
  let t0 = Date.now();
  await page.evaluate(async (url) => { const img = new Image(); await new Promise((r) => { img.onload = r; img.src = url; }); window.__photo = img; await window.__wcPanel.runFromPhoto(img); }, url);
  console.log('from photo in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  await shot('dev-wc-photo');
  const res = await page.evaluate(() => window.__wcPanel.st.genResult);
  fs.writeFileSync('shots/dev-wc-photo-img.png', Buffer.from(res.split(',')[1], 'base64'));
  // use on the easel (re-runs on the easel sim)
  t0 = Date.now();
  await page.evaluate(async () => { await window.__wcPanel.useGenerated(); });
  console.log('use on easel in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  await page.evaluate(() => { window.__wcSim.render(); });
  await shot('dev-wc-photo-easel');
  console.log('gl error', await page.evaluate(() => window.__wcSim.gl.getError()), 'float', await page.evaluate(() => window.__wcSim.isFloat));
};
