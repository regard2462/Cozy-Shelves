// Finds objects that run into each other: every placed object (tight world AABB of its meshes, light decals
// left out) against every other one, against the walls and against the panelling. Pairs that belong together
// (a lamp on its table, a rug under the furniture, chairs at their table) are allowed.
// Prints OVERLAP lines with the overlap size in cm; exits the check with a summary line.
module.exports = async ({ page, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(1500);
  const res = await page.evaluate(() => {
    const THREE = window.__THREE || null;
    const w = window.__app.world;
    const L = w.layout;
    const boxOf = (obj) => {
      // tight box from the vertices of all meshes, without light decals and lights
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      obj.updateMatrixWorld(true);
      obj.traverse((o) => {
        // the static batch hides the original meshes (world.js #batchStatic): they still count here
        if (!o.isMesh || o.userData.glow) return;
        const pos = o.geometry.attributes.position; if (!pos) return;
        const e = o.matrixWorld.elements;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
          if (wx < min[0]) min[0] = wx; if (wy < min[1]) min[1] = wy; if (wz < min[2]) min[2] = wz;
          if (wx > max[0]) max[0] = wx; if (wy > max[1]) max[1] = wy; if (wz > max[2]) max[2] = wz;
        }
      });
      return { min, max };
    };
    const items = [];
    for (const obj of w.static.children) {
      const pl = obj.userData.placement; if (!pl) continue;
      if (['beam', 'screen'].includes(pl.kind)) continue;
      const b = boxOf(obj); if (!isFinite(b.min[0])) continue;
      items.push({ kind: pl.kind, x: +pl.x.toFixed(2), z: +pl.z.toFixed(2), y: pl.meta?.y || 0, box: b, id: pl.meta?.bookcase || pl.meta?.seat || pl.meta?.id || '' });
    }
    const ov = (a, b) => { const d = [0, 1, 2].map((k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k])); return d.every((v) => v > 0.004) ? d : null; };
    const surfaces = new Set(['table', 'desk', 'sidetable', 'sideboard', 'returncounter', 'displaytable']);
    const onTop = new Set(['bankerlamp', 'tablelamp', 'candle', 'recordplayer', 'records', 'radio', 'computer', 'chessboardprop']);
    const allowed = (a, b) => {
      if (a.kind === 'rug' || b.kind === 'rug') return true;
      // boxes that only meet as boxes: the bench stands below the glass (only its top reaches the sill line, 3 cm
      // lower), the clock hangs on the chimney breast above the mantel that sticks out further
      const pair = (k1, k2) => (a.kind === k1 && b.kind === k2) || (a.kind === k2 && b.kind === k1);
      if (pair('glazing', 'windowbench') || pair('fireplace', 'clock')) return true;
      // the terrace doors sit in the glass front's door bays
      if (pair('glazing', 'glassdoor')) return true;
      // things standing on a surface
      for (const [p, q] of [[a, b], [b, a]]) if (onTop.has(p.kind) && surfaces.has(q.kind) && p.y > 0) return true;
      // chairs at their table: the seat may slide under the top
      for (const [p, q] of [[a, b], [b, a]]) if (p.kind === 'chair' && (q.kind === 'table' || q.kind === 'sidetable')) return (Math.min(p.box.max[1], q.box.max[1]) - Math.max(p.box.min[1], q.box.min[1])) < 0.3 ? true : false;
      return false;
    };
    const out = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      const d = ov(a.box, b.box); if (!d || allowed(a, b)) continue;
      out.push({ a: `${a.kind}${a.id ? '#' + a.id : ''}@${a.x},${a.z}`, b: `${b.kind}${b.id ? '#' + b.id : ''}@${b.x},${b.z}`, cm: d.map((v) => Math.round(v * 100)) });
    }
    // walls (layout wall boxes) and the panelling runs
    const walls = L.walls.map((wl) => ({ min: [wl.x - wl.w / 2, wl.y - wl.h / 2, wl.z - wl.d / 2], max: [wl.x + wl.w / 2, wl.y + wl.h / 2, wl.z + wl.d / 2] }));
    const trims = [];
    for (const t of L.trim) {
      if (t.corniceOnly) { const th = 0.16, y0 = t.ceilingH - 0.24, y1 = t.ceilingH; trims.push(t.axis === 'x' ? { min: [t.mid - t.len / 2, y0, Math.min(t.at, t.at + t.dir * th)], max: [t.mid + t.len / 2, y1, Math.max(t.at, t.at + t.dir * th)], cornice: true } : { min: [Math.min(t.at, t.at + t.dir * th), y0, t.mid - t.len / 2], max: [Math.max(t.at, t.at + t.dir * th), y1, t.mid + t.len / 2], cornice: true }); continue; }
      const th = 0.145, top = t.skirtOnly ? 0.14 : 1.0;   // a skirting alone (under the world map) is 14 cm high
      trims.push(t.axis === 'x' ? { min: [t.mid - t.len / 2, 0, Math.min(t.at, t.at + t.dir * th)], max: [t.mid + t.len / 2, top, Math.max(t.at, t.at + t.dir * th)] } : { min: [Math.min(t.at, t.at + t.dir * th), 0, t.mid - t.len / 2], max: [Math.max(t.at, t.at + t.dir * th), top, t.mid + t.len / 2] });
    }
    const wallHits = [];
    const mounted = new Set(['painting', 'sconce', 'clock', 'glazing', 'glassdoor', 'door', 'fireplace', 'pendant']);
    for (const it of items) {
      if (mounted.has(it.kind) || it.kind === 'rug') continue;
      for (const wl of walls) { const d = ov(it.box, wl); if (d) wallHits.push({ a: `${it.kind}${it.id ? '#' + it.id : ''}@${it.x},${it.z}`, b: 'WALL', cm: d.map((v) => Math.round(v * 100)) }); }
      for (const tr of trims) { const d = ov(it.box, tr); if (d) wallHits.push({ a: `${it.kind}${it.id ? '#' + it.id : ''}@${it.x},${it.z}`, b: tr.cornice ? 'CORNICE' : 'PANELLING', cm: d.map((v) => Math.round(v * 100)) }); }
    }
    return { n: items.length, out, wallHits };
  });
  for (const o of res.out) console.log('OVERLAP ' + o.a + '  x  ' + o.b + '  ' + JSON.stringify(o.cm));
  for (const o of res.wallHits) console.log('WALLHIT ' + o.a + '  x  ' + o.b + '  ' + JSON.stringify(o.cm));
  console.log(`AUDIT objects=${res.n} overlaps=${res.out.length} wallhits=${res.wallHits.length}`);
};
