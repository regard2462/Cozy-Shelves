// Runs the generator for a list of motifs (env WC_MOTIFS, comma separated) and saves the pictures to shots/.
// usage: WC_MOTIFS=mountain-lake,sunset-sea node build/dev-shot.js watercolor genQ=0.35 --interact=app/src/ui/watercolor/tests/wc-gen.js
module.exports = async ({ page, shot }) => {
  page.setDefaultTimeout(900000);
  const motifs = (process.env.WC_MOTIFS || 'mountain-lake,sunset-sea,lily-pond').split(',');
  const seed = +(process.env.WC_SEED || 11);
  for (let i = 0; i < motifs.length; i++) {
    const t0 = Date.now();
    await page.selectOption('.wc-generator select.input', motifs[i]);
    await page.fill('.wc-seed', String(seed + i * 7)); await page.dispatchEvent('.wc-seed', 'input');
    await page.click('.wc-generator .btn.primary');
    await page.waitForFunction(() => !window.__wcPanel.st.genBusy && window.__wcPanel.st.genResult, null, { timeout: 800000, polling: 500 });
    console.log('generated', motifs[i], 'in', ((Date.now() - t0) / 1000).toFixed(1), 's');
    const url = await page.evaluate(() => window.__wcPanel.st.genResult);
    require('fs').writeFileSync(`shots/dev-wc-gen-${motifs[i]}.png`, Buffer.from(url.split(',')[1], 'base64'));
  }
  await shot('dev-wc-gen-panel');
};
