// A real Mediathek film on the projection screen: search → play in 'screen' mode → the screen rolls down,
// the picture is a WebGL texture (must stay CORS-clean), E on the screen pauses, the sound fades with
// distance, stop rolls the screen up again. Needs the network. Muted like every test run.
module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'real';
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  await sleep(5000);
  await page.evaluate(() => window.__app.world.stop());
  const frames = async (n, gap = 150) => { for (let i = 0; i < n; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(gap); } };

  const item = await page.evaluate(async () => {
    const r = await window.api.invoke('mediathek:query', { text: 'tagesschau in 100 Sekunden', size: 8 });
    const it = (r.items || []).find((x) => x.video && (x.video.low || x.video.sd));
    return it ? { ...it } : null;
  });
  console.log('ITEM ' + JSON.stringify(item && { title: item.title, channel: item.channel, low: !!item.video?.low }));
  if (!item) return;

  await page.evaluate(async (it) => {
    await window.__app.ctx.media.play(it, { mode: 'screen', quality: 'low' });
    window.__app.ctx.bus.emit('cinema:watch');
    // cinema:watch no longer seats anybody: sit down on the sofa by hand, as a user would with E
    const w = window.__app.world; const s = w.seats.get('sofa');
    w.player.transition = null; w.player.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0); w.actions.sit('sofa');
  }, item);
  let t = 0;
  for (let i = 0; i < 40; i++) { t = await page.evaluate(() => window.__app.ctx.media.video.currentTime); if (t > 3) break; await sleep(1000); }
  console.log('PLAYING ' + JSON.stringify({ currentTime: +t.toFixed(1), state: await page.evaluate(() => { const s = window.__app.ctx.media.state; return { mode: s.mode, playing: s.playing, error: s.error, quality: s.quality }; }) }));

  for (let i = 0; i < 50; i++) await page.evaluate(() => window.__app.world.cinema.update(0.1));
  // let the sit-down transition finish (the player clamps dt to 0.05 s per frame)
  for (let i = 0; i < 40; i++) { const busy = await page.evaluate(() => { window.__app.world.frame(); return !!window.__app.world.player.transition; }); if (!busy) break; await sleep(80); }
  await page.evaluate(() => { const c = window.__app.world.cinema; for (let i = 0; i < 4; i++) { c.sampleTimer = 0; c.update(0.05); } });
  await frames(6);
  const down = await page.evaluate(() => {
    const w = window.__app.world, c = w.cinema;
    w.actions.rayTimer = 0; w.actions.update(0.016);
    const tg = w.actions.target;
    return { drop: c.drop, picture: c.picture, tainted: c.tainted, luma: +c.luma.toFixed(3), avg: c.avg.getHexString(), seated: w.actions.seatedId, pitch: +w.player.pitch.toFixed(2), target: tg && { type: tg.type, kind: tg.kind } };
  });
  console.log('SCREEN ' + JSON.stringify(down));
  await shot(`${tag}-sofa`);

  // E on the screen: pause, then resume
  const p1 = await page.evaluate(async () => { window.__app.world.actions.act('E'); await new Promise((r) => setTimeout(r, 500)); return window.__app.ctx.media.state.playing; });
  const p2 = await page.evaluate(async () => { window.__app.world.actions.act('E'); await new Promise((r) => setTimeout(r, 800)); return window.__app.ctx.media.state.playing; });
  console.log('E-TOGGLE ' + JSON.stringify({ afterFirst: p1, afterSecond: p2 }));

  // sound falls off with distance
  const gains = [];
  for (const [x, z] of [[-3.5, 0], [2, 0], [7, 0], [0, -14]]) {
    const g = await page.evaluate(([x, z]) => {
      const w = window.__app.world;
      if (w.actions.seatedId) w.actions.stand();
      w.player.transition = null; w.player.setPose(x, z, Math.PI / 2, 0); w.player.update(0.016);
      w.cinema.update(0.016);
      return window.__app.ctx.media.state.spatialGain;
    }, [x, z]);
    gains.push([x, z, +g.toFixed(2)]);
  }
  console.log('GAIN ' + JSON.stringify(gains));
  await page.evaluate(() => { const w = window.__app.world; w.player.transition = null; w.player.setPose(6.4, 0.4, Math.PI / 2, 0.1); });
  await frames(8);
  await shot(`${tag}-hall`);

  await page.evaluate(() => window.__app.ctx.media.stop());
  for (let i = 0; i < 60; i++) await page.evaluate(() => window.__app.world.cinema.update(0.1));
  console.log('STOPPED ' + JSON.stringify(await page.evaluate(() => { const c = window.__app.world.cinema; return { active: c.active, drop: c.drop, texture: !!c.texture, gain: window.__app.ctx.media.state.spatialGain }; })));
  console.log('ERRORS ' + JSON.stringify(errors.slice(0, 6)));
};
