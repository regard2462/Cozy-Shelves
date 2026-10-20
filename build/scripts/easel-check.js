// The easel of the watercolour studio in the hall (furniture.js easel, 0.7.1): a real A-frame studio easel. Its two
// front legs stand apart on the floor and meet at the top, the rear leg reaches the floor behind, all three feet stand on
// the floor, the centre of mass lies inside their triangle, the canvas leans back by 10 to 15 degrees, stands on the
// ledge and rests against the mast; nothing of it reaches into the wall, the panelling or the furniture next to it, and
// it fits its collider. The canvas is plain white (no writing on it); a watercolour saved in the studio shows on it, and
// after a restart it is still there. E on the easel opens the studio, the collider stops you. Pictures from the front,
// both sides, behind, above and from where a visitor stands in the hall.
//   node build/screenshot.js easel-check        (COZYSHELVES_BOOKS = a small test library, a fresh COZYSHELVES_USERDATA,
//   SHOT_DIR; then EASEL_PHASE=restart with the same COZYSHELVES_USERDATA: the painting saved in the first run is on the
//   canvas at once; EASEL_SHOTS=0 takes no pictures)
module.exports = async ({ page, shot, sleep }) => {
  const phase = process.env.EASEL_PHASE || 'main';
  const shots = process.env.EASEL_SHOTS !== '0';
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/pointer lock|ERR_|net::|favicon|Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });
  const waitFor = async (fn, arg, ms = 20000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };

  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(1000);
  }
  await waitFor(() => !!window.__app.world.easel?.parent, null, 30000);
  await page.evaluate(() => { window.__app.world.stop(); window.__app.closeAllPanels(); });
  /** The canvas' picture (world-actions.js easelTexture): how far its pixels are from the plain white, the mean colour. */
  const canvasPixels = () => page.evaluate(() => {
    const c = window.__app.world.actions._easelCanvas; if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let sum = [0, 0, 0], off = 0, n = 0;
    const w = [d[0], d[1], d[2]];
    for (let i = 0; i < d.length; i += 4 * 7) { for (let k = 0; k < 3; k++) sum[k] += d[i + k]; off = Math.max(off, Math.abs(d[i] - w[0]) + Math.abs(d[i + 1] - w[1]) + Math.abs(d[i + 2] - w[2])); n++; }
    return { mean: sum.map((v) => Math.round(v / n)), maxOff: off, corner: w, onEasel: window.__app.world.easel.userData.canvas.material.map === window.__app.world.actions._easel };
  });

  if (phase === 'restart') {
    // the watercolour saved in the first run is on the canvas from the start (main.js asks api.files.paintings)
    const ok = await waitFor(() => { const c = window.__app.world.actions._easelCanvas; if (!c) return false; const g = c.getContext('2d'), p = g.getImageData(c.width / 2, c.height / 2, 1, 1).data, q = g.getImageData(c.width / 2, 20, 1, 1).data; return p[0] > 200 && p[2] < 120 && q[2] > 150; }, null, 20000);
    const px = await canvasPixels();
    check('after a restart the canvas shows the watercolour painted last', ok && px?.onEasel, px);
    if (shots) { await view('restart-front'); }
    check('no renderer errors', errors.length === 0, errors.slice(0, 5));
    return summary();
  }

  // ---- the shape: measured from the vertices of the easel, in its own frame -------------------------------------------
  const geo = await page.evaluate(() => {
    const w = window.__app.world, e = w.easel;
    e.updateMatrixWorld(true);
    const inv = e.matrixWorld.clone().invert();
    const V = e.position.constructor;
    const frame = [], canvas = [];
    let vol = 0; const cen = [0, 0, 0];
    const a = new V(), b = new V(), c = new V(), m = e.matrixWorld.clone();
    e.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      m.multiplyMatrices(inv, o.matrixWorld);
      const pos = o.geometry.attributes.position, idx = o.geometry.index;
      const inCanvas = (() => { for (let p = o; p; p = p.parent) if (p.name === 'easel-canvas') return true; return false; })();
      const list = inCanvas ? canvas : frame;
      for (let i = 0; i < pos.count; i++) { a.fromBufferAttribute(pos, i).applyMatrix4(m); list.push([a.x, a.y, a.z]); }
      if (o.geometry.type === 'PlaneGeometry') return;            // the picture on the canvas: a surface, no volume
      const tri = idx ? idx.count / 3 : pos.count / 3;
      for (let t = 0; t < tri; t++) {
        const [i0, i1, i2] = idx ? [idx.getX(3 * t), idx.getX(3 * t + 1), idx.getX(3 * t + 2)] : [3 * t, 3 * t + 1, 3 * t + 2];
        a.fromBufferAttribute(pos, i0).applyMatrix4(m); b.fromBufferAttribute(pos, i1).applyMatrix4(m); c.fromBufferAttribute(pos, i2).applyMatrix4(m);
        const v = a.dot(new V().crossVectors(b, c)) / 6;
        vol += v; cen[0] += v * (a.x + b.x + c.x) / 4; cen[1] += v * (a.y + b.y + c.y) / 4; cen[2] += v * (a.z + b.z + c.z) / 4;
      }
    });
    const all = frame.concat(canvas);
    const span = (pts, y0, y1) => { const s = pts.filter((p) => p[1] >= y0 && p[1] <= y1).map((p) => p[0]); return s.length ? [Math.min(...s), Math.max(...s)] : null; };
    // the feet: what touches the floor, in clusters
    const low = frame.filter((p) => p[1] < 0.002), feet = [];
    for (const p of low) { const f = feet.find((q) => Math.hypot(q[0] - p[0], q[1] - p[2]) < 0.12); if (f) { f[2]++; } else feet.push([p[0], p[2], 1]); }
    // the canvas: its front normal (lean), its lowest point, its back against the mast
    const pic = e.getObjectByName('easel-canvas');
    const q = pic.quaternion.clone();
    const normal = new V(0, 0, 1).applyQuaternion(q);
    const E = w.easel.userData;
    const minY = Math.min(...canvas.map((p) => p[1]));
    return {
      minY: Math.min(...all.map((p) => p[1])), maxY: Math.max(...all.map((p) => p[1])),
      box: [0, 2].map((k) => [Math.min(...all.map((p) => p[k])), Math.max(...all.map((p) => p[k]))]),
      bottom: span(frame, 0.005, 0.05), top: span(frame, 1.55, 1.72),   // the feet with the legs' ends; the head
      feet: feet.map((f) => [+f[0].toFixed(3), +f[1].toFixed(3), f[2]]),
      lean: +(Math.asin(normal.y) * 180 / Math.PI).toFixed(2), normalZ: +normal.z.toFixed(3),
      canvasLow: +minY.toFixed(4), ledgeY: 0.86,
      com: vol ? cen.map((v) => +(v / vol).toFixed(4)) : null, volume: +vol.toFixed(5),
      footprint: E.footprint, canvasW: +(Math.max(...canvas.map((p) => p[0])) - Math.min(...canvas.map((p) => p[0]))).toFixed(3),
    };
  });
  console.log('GEO ' + JSON.stringify(geo));
  check('nothing below the floor, the easel about 2 m high', geo.minY > -0.001 && geo.maxY > 1.8 && geo.maxY < 2.1, { minY: geo.minY, maxY: geo.maxY });
  const front = geo.feet.filter((f) => f[1] > 0.2), rear = geo.feet.filter((f) => f[1] < -0.2);
  check('three feet stand on the floor: two in front, apart from each other, one behind', geo.feet.length === 3 && front.length === 2 && rear.length === 1 && Math.abs(front[0][0] - front[1][0]) > 0.5 && Math.abs(rear[0][0]) < 0.05, geo.feet);
  check('the front legs stand apart at the floor and meet at the top (an A, not a V)', geo.bottom && geo.top && geo.bottom[1] - geo.bottom[0] > 0.55 && geo.top[1] - geo.top[0] < 0.2, { bottom: geo.bottom, top: geo.top });
  check('the canvas leans back by 10 to 15 degrees', geo.lean >= 10 && geo.lean <= 15 && geo.normalZ > 0.95, { lean: geo.lean });
  check('the canvas stands on the ledge (its lowest point on the ledge, not in the air)', geo.canvasLow >= geo.ledgeY - 0.001 && geo.canvasLow <= geo.ledgeY + 0.008, { low: geo.canvasLow, ledge: geo.ledgeY });
  // the centre of mass, seen from above, inside the triangle of the three feet (with a margin)
  const inTri = (p, t) => {
    const s = (a, b, c) => (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
    const d1 = s(p, t[0], t[1]), d2 = s(p, t[1], t[2]), d3 = s(p, t[2], t[0]);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  const tri = geo.feet.map((f) => [f[0], f[1]]);
  const com = geo.com ? [geo.com[0], geo.com[2]] : null;
  const margin = (p, t) => Math.min(...t.map((a, i) => { const b = t[(i + 1) % 3], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); return Math.abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / len; }));
  check('the centre of mass lies inside the footprint of the three feet (at least 8 cm from its edges)', tri.length === 3 && com && inTri(com, tri) && margin(com, tri) > 0.08, { com: geo.com, margin: com && tri.length === 3 ? +margin(com, tri).toFixed(3) : null });
  const fp = geo.footprint;
  check('the easel fits its collider (the footprint box round the origin)', geo.box[0][0] >= -fp.w / 2 - 0.01 && geo.box[0][1] <= fp.w / 2 + 0.01 && geo.box[1][0] >= -fp.d / 2 - 0.01 && geo.box[1][1] <= fp.d / 2 + 0.01, { box: geo.box, footprint: fp });

  // the canvas against the mast: a ray from the middle of the canvas' back meets the mast within a few millimetres
  const rest = await page.evaluate(() => {
    const w = window.__app.world, e = w.easel, pic = e.getObjectByName('easel-canvas');
    const V = e.position.constructor;
    e.updateMatrixWorld(true);
    const frame = e.getObjectByName('easelframe');
    const ray = new (window.__THREE_Raycaster || w.actions.raycaster.constructor)();
    const out = [];
    for (const y of [-0.12, 0, 0.12]) {
      const back = new V(0, y, -0.013).applyMatrix4(pic.matrixWorld), dir = new V(0, 0, -1).transformDirection(pic.matrixWorld);
      ray.set(back, dir); ray.far = 0.2;
      const hit = ray.intersectObject(frame, true)[0];
      out.push(hit ? +hit.distance.toFixed(4) : null);
    }
    return out;
  });
  check('the canvas rests against the mast (its back touches the mast along its height)', rest.every((d) => d != null && d < 0.004), rest);

  // ---- in the hall: nothing of it in the wall, the panelling or the furniture next to it -------------------------------
  const clash = await page.evaluate(() => {
    const w = window.__app.world, L = w.layout;
    const tight = (obj) => {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      obj.updateMatrixWorld(true);
      obj.traverse((o) => { if (!o.isMesh || o.userData.glow) return; const pos = o.geometry.attributes.position, e = o.matrixWorld.elements; for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const v = [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]; for (let k = 0; k < 3; k++) { if (v[k] < min[k]) min[k] = v[k]; if (v[k] > max[k]) max[k] = v[k]; } } });
      return { min, max };
    };
    const ov = (a, b) => [0, 1, 2].every((k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]) > 0.002);
    const me = tight(w.easel);
    const near = [];
    for (const obj of w.static.children) {
      const pl = obj.userData.placement; if (!pl || obj === w.easel || ['rug', 'beam'].includes(pl.kind)) continue;
      if (Math.hypot(pl.x - w.easel.position.x, pl.z - w.easel.position.z) > 3) continue;
      const b = tight(obj); near.push({ kind: pl.kind, gap: +Math.max(b.min[0] - me.max[0], me.min[0] - b.max[0], b.min[2] - me.max[2], me.min[2] - b.max[2]).toFixed(3), hit: ov(me, b) });
    }
    const walls = L.walls.filter((b) => ov(me, { min: [b.x - b.w / 2, b.y - b.h / 2, b.z - b.d / 2], max: [b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2] })).length;
    const trims = L.trim.filter((t) => !t.corniceOnly).map((t) => { const th = 0.145, y0 = t.y0 || 0, top = t.skirtOnly ? 0.14 : 1.0; return t.axis === 'x' ? { min: [t.mid - t.len / 2, y0, Math.min(t.at, t.at + t.dir * th)], max: [t.mid + t.len / 2, y0 + top, Math.max(t.at, t.at + t.dir * th)] } : { min: [Math.min(t.at, t.at + t.dir * th), y0, t.mid - t.len / 2], max: [Math.max(t.at, t.at + t.dir * th), y0 + top, t.mid + t.len / 2] }; }).filter((b) => ov(me, b)).length;
    // the wall behind it: how far the easel stays from the panelling
    const wallGap = +(me.min[2] - (-5.5 + 0.145)).toFixed(3);
    return { box: me, near, walls, trims, wallGap };
  });
  console.log('CLASH ' + JSON.stringify(clash));
  check('nothing of the easel reaches into the wall, the panelling or the furniture next to it (the audiobook cabinet among them)', !clash.walls && !clash.trims && clash.near.every((n) => !n.hit) && clash.near.some((n) => n.kind === 'audiobooks') && clash.wallGap > 0.1, clash);

  // ---- the canvas: plain white, no writing ----------------------------------------------------------------------------
  const blank = await canvasPixels();
  check('the canvas is plain white: no writing on it', blank && blank.maxOff <= 3 && blank.mean.every((v) => v > 235) && blank.onEasel, blank);

  // ---- E, the collider ----------------------------------------------------------------------------------------------------
  const use = await page.evaluate(() => {
    const w = window.__app.world, p = w.player, e = w.easel;
    const fx = Math.sin(e.rotation.y), fz = Math.cos(e.rotation.y);
    p.transition = null; p.setPose(e.position.x + fx * 1.6, e.position.z + fz * 1.6, Math.atan2(fx, fz), -0.12);
    p.update(0.016); w.scene.updateMatrixWorld(); w.camera.updateMatrixWorld();
    w.actions.rayTimer = 0; w.actions.update(0.016);
    const t = w.actions.target;
    return { type: t?.type, kind: t?.kind, label: document.querySelector('#look-label')?.textContent || '' };
  });
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e', bubbles: true })));
  const opened = await waitFor(() => [...document.querySelectorAll('.panel-layer:not(.closing)')].some((l) => l.dataset.panel === 'watercolor'), null, 10000);
  await sleep(600);
  await page.evaluate(() => window.__app.closeAllPanels());
  await sleep(600);
  check('aimed at the easel: "Staffelei · E Malen", E opens the watercolour studio', use.type === 'interact' && use.kind === 'watercolor' && /Staffelei/.test(use.label) && opened, { use, opened });
  const walk = await page.evaluate(() => {
    const w = window.__app.world, p = w.player, e = w.easel;
    const fx = Math.sin(e.rotation.y), fz = Math.cos(e.rotation.y);
    p.transition = null; p.setPose(e.position.x + fx * 1.6, e.position.z + fz * 1.6, Math.atan2(fx, fz), 0);
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
    for (let i = 0; i < 180; i++) p.update(1 / 60);
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
    const d = Math.hypot(p.position.x - e.position.x, p.position.z - e.position.z);
    return { dist: +d.toFixed(3), collider: w.colliders.some((c) => e.position.x >= c.min[0] && e.position.x <= c.max[0] && e.position.z >= c.min[2] && e.position.z <= c.max[2] && c.max[1] > 1.5) };
  });
  check('its collider stops you in front of it (walking into it for 3 s)', walk.collider && walk.dist > 0.55, walk);

  // ---- a watercolour saved in the studio goes onto the canvas ---------------------------------------------------------
  const saved = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const g = c.getContext('2d'); g.fillStyle = '#2f6fb3'; g.fillRect(0, 0, 320, 240); g.fillStyle = '#e8c23a'; g.beginPath(); g.arc(160, 120, 60, 0, Math.PI * 2); g.fill();
    const r = await window.__app.ctx.api.files.savePainting(c.toDataURL('image/png'), 'easel-check');
    if (r?.url) window.__app.ctx.bus.emit('painting:saved', { path: r.path, url: r.url, title: 'easel-check' });
    return !!r?.url;
  });
  const shown = await waitFor(() => { const c = window.__app.world.actions._easelCanvas; const p = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data; const q = c.getContext('2d').getImageData(c.width / 2, 20, 1, 1).data; return p[0] > 200 && p[2] < 120 && q[2] > 150; }, null, 15000);
  check('a watercolour saved in the studio shows on the canvas', saved && shown, { saved, shown });

  // ---- pictures: the white canvas first (put back), then the painting ---------------------------------------------------
  if (shots) {
    await page.evaluate(() => { const a = window.__app.world.actions, c = a._easelCanvas, g = c.getContext('2d'); a.__painted = g.getImageData(0, 0, c.width, c.height); g.fillStyle = '#f6f3ec'; g.fillRect(0, 0, c.width, c.height); a._easel.needsUpdate = true; });
    await page.evaluate(() => document.querySelector('#hud')?.style.setProperty('opacity', '0'));
    for (const v of ['front', 'left', 'right', 'behind', 'above', 'hall', 'side-low', 'hall-wide']) await view(v);
    await page.evaluate(() => { const a = window.__app.world.actions, c = a._easelCanvas; c.getContext('2d').putImageData(a.__painted, 0, 0); a._easel.needsUpdate = true; });
    await view('painted');
    await page.evaluate(() => document.querySelector('#hud')?.style.setProperty('opacity', '1'));
  }
  check('no renderer errors', errors.length === 0, errors.slice(0, 5));
  summary();

  /** A picture of the easel from one side: front, left, right, behind, above, the hall as a visitor sees it. */
  async function view(name) {
    await page.evaluate((name) => {
      const w = window.__app.world, p = w.player, e = w.easel;
      const r = e.rotation.y, fx = Math.sin(r), fz = Math.cos(r), rx = Math.cos(r), rz = -Math.sin(r);   // front, right
      const X = e.position.x, Z = e.position.z;
      const at = (along, side, y, look) => { const x = X + fx * along + rx * side, z = Z + fz * along + rz * side; const dx = look[0] - x, dz = look[2] - z; p.transition = null; p.setPose(x, z, Math.atan2(-dx, -dz), Math.atan2(look[1] - y, Math.hypot(dx, dz)), 0); p.position.y = y; };
      const mid = [X, 1.05, Z];
      const views = {
        front: () => at(2.2, 0, 1.5, mid), 'restart-front': () => at(2.2, 0, 1.5, mid),
        left: () => at(0.1, -1.9, 1.45, mid), right: () => at(0.5, 1.45, 1.45, mid),
        behind: () => at(-0.55, -0.25, 2.35, [X + fx * 0.25, 0.9, Z + fz * 0.25]),
        above: () => at(0.55, 0.05, 3.3, [X, 0.9, Z]),
        hall: () => at(3.6, -1.1, 1.62, [X + 0.6, 1.0, Z]), 'side-low': () => at(0.9, -1.25, 1.3, [X, 0.9, Z]),
        'hall-wide': () => at(5.2, 0.4, 1.62, [X + 0.9, 1.1, Z]), painted: () => at(1.9, 0.2, 1.4, mid),
      };
      views[name]();
      p.update(0.001);
      // (the camera follows the player's pose; update() put it at the eye, the height of the picture wins)
      w.camera.position.y = p.position.y;
    }, name);
    for (let i = 0; i < 8; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(40); }
    await shot('easel-' + name);
  }
  function summary() {
    const failed = results.filter((r) => !r.ok);
    console.log(`SUMMARY easel-check (${phase}): ${results.length - failed.length} passed, ${failed.length} failed`);
  }
};
