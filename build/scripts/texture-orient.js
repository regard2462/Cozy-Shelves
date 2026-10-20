// Which way up a picture arrives on the graphics card by the way it was made (world/texture-store.js): a canvas, an
// ImageBitmap from pixels, an ImageBitmap from a PNG (with and without an orientation option), each with three's
// flipY on and off. A 4 × 4 picture with a red top row and a blue bottom row is drawn as a full-screen quad into a
// small render target and read back. Prints ORIENT lines: top and bottom pixel of the result (a canvas with flipY
// arrives upright, a bitmap only when it was made with imageOrientation 'flipY'; three's flipY does nothing for it).
//   node build/screenshot.js texture-orient
module.exports = async ({ page }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  const r = await page.evaluate(async () => {
    const w = window.__app.world, r = w.renderer, THREE = w.scene.constructor.__three || null;
    // three's classes through the world's objects (no import here)
    const RT = w.composer.renderTarget1.constructor, Tex = w.books.meshes[0]?.material.map?.constructor.__proto__.constructor || null;
    const c = document.createElement('canvas'); c.width = 4; c.height = 4;
    const g = c.getContext('2d'); g.fillStyle = '#00ff00'; g.fillRect(0, 0, 4, 4); g.fillStyle = '#ff0000'; g.fillRect(0, 0, 4, 1); g.fillStyle = '#0000ff'; g.fillRect(0, 3, 4, 1);
    const data = g.getImageData(0, 0, 4, 4);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const bitmaps = {
      canvas: c,
      pixels: await createImageBitmap(data, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }),
      pngNone: await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' }),
      pngDefault: await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }),
      pngFlip: await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'flipY' }),
    };
    // a quad with the texture: the AO's combine pass with its intensity at 0, which copies tScene as it is (the
    // composer's copy pass of the first session is gone with the bloom merged into the output pass)
    const quad = w.ao.combine, mat = quad.material, u = mat.uniforms, keep = u.uIntensity.value;
    u.uIntensity.value = 0;
    const rt = new RT(4, 4);
    const out = {};
    const px = new Uint8Array(4 * 4 * 4);
    for (const [name, img] of Object.entries(bitmaps)) {
      for (const flip of [true, false]) {
        const tex = new (w.books.meshes[0].material.map.constructor)(img);   // CanvasTexture
        tex.flipY = flip; tex.generateMipmaps = false; tex.minFilter = tex.magFilter = 1003; tex.needsUpdate = true;
        u.tScene.value = tex; u.tAO.value = tex;
        const prev = r.getRenderTarget();
        r.setRenderTarget(rt); quad.render(r);
        r.readRenderTargetPixels(rt, 0, 0, 4, 4, px);
        r.setRenderTarget(prev);
        // readRenderTargetPixels gives the bottom row first
        const bottom = [px[0], px[1], px[2]], top = [px[3 * 4 * 4], px[3 * 4 * 4 + 1], px[3 * 4 * 4 + 2]];
        out[`${name}:flipY=${flip}`] = { top, bottom };
        tex.dispose();
      }
    }
    rt.dispose(); u.uIntensity.value = keep;
    return out;
  });
  for (const [k, v] of Object.entries(r)) console.log(`ORIENT ${k} top=${v.top.join(',')} bottom=${v.bottom.join(',')}`);
};
