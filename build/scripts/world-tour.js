module.exports = async ({ page, shot, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 120000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(1500);
  const views = [
    ['hall-entrance', 9.5, 0.4, -Math.PI / 2 + 0.2, 0.0],
    ['hall-fireplace', 3.0, 0.2, Math.PI / 2, -0.02],
    ['hall-windows', 0, -4.5, 0, 0.05],
    ['hall-tables', -8, -6, -Math.PI / 4, -0.05],
    ['gallery-arches', 0, 3, Math.PI, 0.02],
    ['corridor', -3.2, -10.3, Math.PI / 2, 0],
  ];
  for (const [name, x, z, yaw, pitch] of views) {
    await page.evaluate(([x, z, yaw, pitch]) => { const w = window.__app.world; w.stop(); const p = w.player; p.transition = null; p.setPose(x, z, yaw, pitch); w.frame(); w.frame(); }, [x, z, yaw, pitch]);
    await sleep(500);
    await shot('world-' + name);
  }
  // inside the first department room, looking at the shelves
  const info = await page.evaluate(() => { const w = window.__app.world; const r = w.layout.rooms[0]; return r ? { cx: (r.x0 + r.x1) / 2, z: r.z1 - 1.5, name: r.name, n: w.layout.rooms.length } : null; });
  console.log('rooms', info);
  if (info) { await page.evaluate(([x, z]) => { const w = window.__app.world; const p = w.player; p.setPose(x, z, Math.PI, -0.05); w.frame(); w.frame(); }, [info.cx, info.z]); await sleep(500); await shot('world-room'); }
  const stats = await page.evaluate(() => { const w = window.__app.world; return { books: w.books.entries.size, meshes: w.books.meshes.length, colliders: w.colliders.length, seats: w.seats.size, places: w.places.length, drawCalls: w.renderer.info.render.calls, tris: w.renderer.info.render.triangles }; });
  console.log(JSON.stringify(stats));
};
