// Puts big textures painted in a worker (raw RGBA bytes) onto the graphics card a strip per frame, about a megabyte
// each (texSubImage2D through three.js copyTextureToTexture). A floor texture is 16 MB, a mural wall up to 9 MB: in one
// piece such an upload held up a frame for 20 to 100 ms, and much longer on a busy graphics card. A texture gets its
// storage in a frame of its own (every mip level at once, empty: several textures arrive together, and their storage
// in one frame cost as much as an upload); its mip levels are made after the last strip. The bytes, once uploaded, go
// back to their owner (release): handed back to the worker, the tens of megabytes of a floor or a mural are let go
// there and never wait for the main thread's garbage collector. Textures no longer shown are let go later as well, one
// a frame and thirty frames after the swap (retire, tidy), never in the frame of the swap itself.
import * as THREE from 'three';

const _at = new THREE.Vector2();

export class TextureStream {
  constructor(renderer, { bytesPerFrame = 1 << 20 } = {}) {
    this.renderer = renderer;
    this.bytesPerFrame = bytesPerFrame;
    this.queue = [];          // { tex, data, w, h, y (-1: no storage yet), done, release }
    this.trash = [];          // { tex, wait (frames) }: textures to dispose of (retire)
  }

  /**
   * A texture for `data` (Uint8Array or Uint8ClampedArray, w × h RGBA, its first row at v = 0: no flip), given its
   * storage and filled over the next frames by step(). `opts`: srgb, wrap (THREE wrapping), anisotropy. done(tex) runs
   * after the last strip. `channel`: the uv set the texture is read with (three.js Texture.channel). release(data) gets
   * the bytes back once they are on the card or the texture is dropped (for a caller whose buffer is its own: its worker
   * may take it back).
   */
  add(data, w, h, { srgb = false, wrap = THREE.ClampToEdgeWrapping, anisotropy = 1, channel = 0, done = null, release = null } = {}) {
    const tex = new THREE.DataTexture(null, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.channel = channel;
    tex.wrapS = tex.wrapT = wrap;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = anisotropy;
    tex.flipY = false; tex.unpackAlignment = 4;
    tex.userData.bytes = Math.round(w * h * 4 * 4 / 3);
    const item = { tex, data: data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength), w, h, y: -1, done, release };
    this.queue.push(item);
    return tex;
  }

  /** One step of the oldest texture in the queue: its storage, or a strip. Returns the texture when it has just been
   *  completed. */
  step() {
    const it = this.queue[0];
    if (!it) return null;
    if (it.y < 0) {
      const tex = it.tex;
      tex.generateMipmaps = true;               // storage for every level
      tex.source.dataReady = false;             // allocate only: the data comes in strips
      tex.needsUpdate = true;
      this.renderer.initTexture(tex);
      tex.generateMipmaps = false;              // no mip levels after every strip, only after the last one
      it.y = 0;
      return null;
    }
    const rows = Math.max(1, Math.min(it.h - it.y, Math.floor(this.bytesPerFrame / (it.w * 4))));
    const src = new THREE.DataTexture(it.data.subarray(it.y * it.w * 4, (it.y + rows) * it.w * 4), it.w, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    const last = it.y + rows >= it.h;
    it.tex.generateMipmaps = last;
    this.renderer.copyTextureToTexture(src, it.tex, null, _at.set(0, it.y));
    it.tex.generateMipmaps = true;
    it.y += rows;
    if (!last) return null;
    this.queue.shift();
    const data = it.data; it.data = null;
    it.release?.(data);
    it.done?.(it.tex);
    return it.tex;
  }

  get busy() { return this.queue.length > 0; }

  /** A texture that is not drawn any more: disposed of `wait` frames later (tidy). */
  retire(tex, wait = 30) { if (tex) this.trash.push({ tex, wait }); }
  /** Every frame: the retired textures wait their frames, then one a frame is disposed of. */
  tidy() {
    if (!this.trash.length) return;
    for (const t of this.trash) t.wait--;
    const i = this.trash.findIndex((t) => t.wait <= 0);
    if (i >= 0) this.trash.splice(i, 1)[0].tex.dispose();
  }
  /** Drops what is not uploaded yet (the textures are disposed, the bytes go back). */
  clear() {
    for (const it of this.queue) { it.tex.dispose(); const data = it.data; it.data = null; if (data) it.release?.(data); }
    this.queue.length = 0;
  }
  /** Everything at once: the queue and the retired textures (the world goes). */
  dispose() { this.clear(); for (const t of this.trash) t.tex.dispose(); this.trash.length = 0; }
}
