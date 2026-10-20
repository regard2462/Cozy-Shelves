// Paints the procedural textures of the rooms (world/texture-paint.js) off the main thread at a first start
// (world/texture-store.js): { kind, opts, key } → { key, images: { name: ImageBitmap } } (the pictures, made from the
// pixels and transferred, so the build can go on). The canvases are kept; { encode: true } (the store, a few seconds
// after the start, so that the encoding does not take the processor from the shaders' compile) answers with
// { key, blobs: { name: Blob } } for every painting kept, the PNGs for the store.
import { PAINTERS } from '../world/texture-paint.js';

const held = [];   // [key, canvases] painted here, until the store asks for their PNGs
self.onmessage = async (e) => {
  if (e.data.encode) {
    while (held.length) {
      const [key, canvases] = held.shift();
      try {
        const blobs = {};
        for (const [name, c] of Object.entries(canvases)) blobs[name] = await c.convertToBlob({ type: 'image/png' });
        self.postMessage({ key, blobs });
      } catch (err) { self.postMessage({ key, error: String(err?.message || err) }); }
    }
    return;
  }
  const { kind, opts, key } = e.data;
  try {
    const paint = PAINTERS[kind];
    if (!paint) throw new Error('unknown texture ' + kind);
    const canvases = paint(opts);
    const images = {}, transfer = [];
    for (const [name, c] of Object.entries(canvases)) {
      // (from the pixels, not from the canvas: a bitmap of a worker's canvas lives on the graphics card and does not
      // arrive in the page's WebGL context under ANGLE; turned over here, because WebGL ignores three's flipY for a
      // bitmap and a canvas is turned over at its upload)
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      const b = await createImageBitmap(data, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'flipY' });
      images[name] = b; transfer.push(b);
    }
    held.push([key, canvases]);
    self.postMessage({ key, images }, transfer);
  } catch (err) {
    self.postMessage({ key, error: String(err?.message || err) });
  }
};
