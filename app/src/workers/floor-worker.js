// Paints the floors (app/src/world/floor-art.js) off the main thread: the three textures of a style as raw RGBA bytes
// (app/src/world/floors.js puts them on the graphics card a strip per frame), or a small picture of a style for the
// settings (floor-styles.js). { type: 'recycle' } brings uploaded bytes back: they are let go here, off the main thread.
import { paintFloor, paintFloorPreview } from '../world/floor-art.js';

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m?.type === 'paint') {
      const f = paintFloor(m.style, m.size);
      self.postMessage({ type: 'floor', id: m.id, style: m.style, ms: f.ms, w: f.w, h: f.h, rw: f.rw, rh: f.rh, color: f.color, normal: f.normal, rough: f.rough }, [f.color.buffer, f.normal.buffer, f.rough.buffer]);
    } else if (m?.type === 'preview') {
      // the picture as it is painted: no colour conversion
      const b = await createImageBitmap(new ImageData(paintFloorPreview(m.style, m.w, m.h), m.w, m.h), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      self.postMessage({ type: 'preview', id: m.id, bitmap: b }, [b]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m?.id, message: String(err?.stack || err) });
  }
};
