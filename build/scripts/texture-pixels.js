// The textures of the rooms as they stand in the scene (painted by the texture workers at a first start, restored from
// the texture store at a later one: world/texture-store.js) against a fresh painting of the same key on the main
// thread: every pixel must be the painted one (the bitmaps are made turned over, because WebGL ignores three's flipY
// for a bitmap, so they match the painting turned over). Run twice with the same COZYSHELVES_USERDATA: cold (the
// workers), warm (the store). Prints a PIXELS line per texture and PASS/FAIL lines. TP_N limits the textures.
//   node build/screenshot.js texture-pixels
module.exports = async ({ page, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await sleep(4000);
  const r = await page.evaluate(async (N) => {
    const st = window.__app.textures, w = window.__app.world;
    const seen = new Map();
    w.scene.traverse((o) => { for (const m of (o.material ? [o.material].flat() : [])) for (const k of ['map', 'normalMap', 'roughnessMap']) { const t = m?.[k]; if (t?.userData?.key && !seen.has(t.userData.key + '|' + k)) seen.set(t.userData.key + '|' + k, t); } });
    const pixelsOf = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const out = [];
    let n = 0;
    for (const [id, t] of seen) {
      if (N && n++ >= N) break;
      const [key, name] = id.split('|');
      // (a texture keyed by another module, the world map's, is none of the painter's)
      const spec = st.optsOf(key); if (!spec) { out.push({ id, skipped: 'not a painter key' }); continue; }
      const fresh = st.painters[spec.kind](spec.opts)[name]; if (!fresh) { out.push({ id, error: 'no picture' }); continue; }
      const a = pixelsOf(t.image), b = pixelsOf(fresh), W = fresh.width, H = fresh.height;
      if (a.length !== b.length) { out.push({ id, error: `sizes ${t.image.width}x${t.image.height} vs ${W}x${H}` }); continue; }
      let same = 0, flipped = 0, maxd = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, j = ((H - 1 - y) * W + x) * 4;
        const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        if (d === 0) same++; if (d > maxd) maxd = d;
        if (a[j] === b[i] && a[j + 1] === b[i + 1] && a[j + 2] === b[i + 2]) flipped++;
      }
      out.push({ id, kind: t.image.constructor.name, px: W * H, same, flipped, maxd });
    }
    return { info: { ...st.info(), stats: undefined }, out };
  }, +process.env.TP_N || 0);
  console.log('PIXINFO ' + JSON.stringify(r.info));
  for (const o of r.out) console.log('PIXELS ' + JSON.stringify(o));
  // a picture painted on the main thread (a canvas: the rugs, a user's wall colour) is the painting as it is; a bitmap
  // (the workers', the store's) the painting turned over
  const bad = r.out.filter((o) => !o.skipped && (o.error || (o.kind === 'HTMLCanvasElement' ? o.same !== o.px : o.flipped !== o.px)));
  console.log(`${bad.length ? 'FAIL' : 'PASS'} every texture of the rooms is the painted one pixel for pixel (${r.out.filter((o) => !o.skipped).length} textures, ${r.info.restored} restored, ${r.info.painted} from the workers)${bad.length ? ' ' + JSON.stringify(bad.slice(0, 5)) : ''}`);
  console.log(`SUMMARY texture-pixels ${bad.length ? 0 : 1} passed, ${bad.length ? 1 : 0} failed`);
};
