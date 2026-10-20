// Home cinema: the screen stays rolled up until a film plays in 'screen' mode, then rolls down, the
// picture appears, the hall dims, E on the screen pauses; stop rolls it up. 'cinema:watch' does not seat the
// player: they stay where they are. Sitting down on the sofa by hand raises the view to the screen.
// A canvas test pattern (captureStream) stands in for a Mediathek film, so no network is needed.
module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'cin';
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2500);
  }
  await sleep(2000);
  await page.evaluate(() => window.__app.world.stop());
  const frames = async (n, gap = 120) => { for (let i = 0; i < n; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(gap); } };
  const pose = async (x, z, yaw, pitch) => { await page.evaluate(([x, z, yaw, pitch]) => { const w = window.__app.world; if (w.actions.seatedId) w.actions.stand(); w.player.transition = null; w.player.setPose(x, z, yaw, pitch); }, [x, z, yaw, pitch]); };

  // idle: rolled up, projector dark
  const idle = await page.evaluate(() => { const c = window.__app.world.cinema; return { active: c.active, drop: c.drop, clothVisible: c.parts.cloth?.visible, picVisible: c.parts.pic?.visible, spill: c.spill.intensity }; });
  console.log('IDLE ' + JSON.stringify(idle));
  await pose(-0.6, 1.2, Math.PI / 2 + 0.05, 0.12);
  await frames(8);
  await shot(`${tag}-1-idle`);

  // start a "film"
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const g = c.getContext('2d');
    let t = 0;
    const draw = () => {
      t += 1;
      const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
      bars.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * 640 / 7, 0, 640 / 7 + 1, 250); });
      g.fillStyle = '#101010'; g.fillRect(0, 250, 640, 110);
      g.fillStyle = '#f0f0f0'; g.font = 'bold 44px Georgia'; g.fillText('Cozy Shelves Testbild', 130, 320);
      g.fillStyle = '#ffcf40'; g.beginPath(); g.arc(320 + Math.sin(t / 10) * 200, 125, 40, 0, Math.PI * 2); g.fill();
    };
    draw(); window.__testTimer = setInterval(draw, 40);
    const stream = c.captureStream(25);
    await window.__app.ctx.media.play({ id: 'test', title: 'Testbild', channel: 'Cozy Shelves', stream }, { mode: 'screen' });
    window.__app.ctx.bus.emit('cinema:watch');
  });
  await sleep(1500);
  const started = await page.evaluate(() => { const c = window.__app.world.cinema; const m = window.__app.ctx.media.state; const p = window.__app.world.player; return { active: c.active, mode: m.mode, playing: m.playing, seated: window.__app.world.actions.seatedId, x: +p.position.x.toFixed(2), z: +p.position.z.toFixed(2) }; });
  console.log('STARTED ' + JSON.stringify(started) + (started.seated === null && started.x === -0.6 && started.z === 1.2 ? ' · stays standing where it was: OK' : ' · moved or seated: BAD'));
  // half-way down
  for (let i = 0; i < 16; i++) await page.evaluate(() => window.__app.world.cinema.update(0.1));
  await frames(3);
  await shot(`${tag}-2-rolling`);
  // fully down, picture in
  for (let i = 0; i < 40; i++) await page.evaluate(() => window.__app.world.cinema.update(0.1));
  await frames(12, 150);
  const down = await page.evaluate(() => { const w = window.__app.world; const c = w.cinema; return { drop: c.drop, picture: c.picture, dim: c.dim.toFixed(2), spill: c.spill.intensity.toFixed(2), luma: c.luma.toFixed(2), tainted: c.tainted, pitch: w.player.pitch.toFixed(2), seated: w.actions.seatedId, target: w.actions.target && { type: w.actions.target.type, kind: w.actions.target.kind } }; });
  console.log('DOWN ' + JSON.stringify(down));
  await shot(`${tag}-3-screen`);
  // sitting down on the sofa by hand (E on the sofa): the view goes up to the screen
  await page.evaluate(() => { const w = window.__app.world; const s = w.seats.get('sofa'); w.player.transition = null; w.player.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0); w.actions.sit('sofa'); for (let i = 0; i < 30; i++) w.player.update(0.05); });
  await frames(6, 150);
  const sofa = await page.evaluate(() => { const w = window.__app.world; return { seated: w.actions.seatedId, pitch: w.player.pitch.toFixed(2) }; });
  console.log('SOFA ' + JSON.stringify(sofa));
  await shot(`${tag}-3b-sofa`);

  // E on the screen pauses, again resumes
  await page.evaluate(() => { const w = window.__app.world; w.actions.rayTimer = 0; w.actions.update(0.016); });
  const tgt = await page.evaluate(() => { const t = window.__app.world.actions.target; return t && { type: t.type, kind: t.kind }; });
  console.log('TARGET ' + JSON.stringify(tgt));
  await page.evaluate(() => window.__app.world.actions.act('E'));
  await sleep(400);
  const paused = await page.evaluate(() => window.__app.ctx.media.state.playing);
  await page.evaluate(() => window.__app.world.actions.act('E'));
  await sleep(400);
  const resumed = await page.evaluate(() => window.__app.ctx.media.state.playing);
  console.log('PAUSE ' + JSON.stringify({ afterFirstE: paused, afterSecondE: resumed }));
  // a click on the screen (mouse caught; simulated in the hidden test window) does the same as E
  const click = async () => page.evaluate(async () => {
    const w = window.__app.world; w.player.locked = true;
    w.renderer.domElement.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    w.player.locked = false;
    await new Promise((r) => setTimeout(r, 400));
    return window.__app.ctx.media.state.playing;
  });
  const clickPaused = await click(), clickResumed = await click();
  const ring = await page.evaluate(() => ({ ring: document.querySelector('#crosshair').classList.contains('active'), hintEl: !!document.querySelector('#hint') }));
  console.log('CLICK ' + JSON.stringify({ afterFirstClick: clickPaused, afterSecondClick: clickResumed, ...ring }) + (clickPaused === false && clickResumed === true && !ring.hintEl ? ' · click pauses and resumes: OK' : ' · click on the screen: BAD'));

  // wide view from the entrance side and sound falloff
  await pose(6.4, 0.4, Math.PI / 2, 0.08);
  await frames(8);
  await shot(`${tag}-4-hall`);
  const gains = [];
  for (const [x, z] of [[-4, 0], [2, 0], [7, 0], [0, -14]]) {
    await pose(x, z, Math.PI / 2, 0);
    // the cinema measures from the camera: move it along with the pose (no frame is drawn here)
    await page.evaluate(() => { const w = window.__app.world; w.player.update(0.001); w.cinema.update(0.016); });
    gains.push([x, z, (await page.evaluate(() => window.__app.ctx.media.state.spatialGain)).toFixed(2)]);
  }
  console.log('GAIN ' + JSON.stringify(gains));

  // the projector
  await pose(-0.4, 1.1, Math.PI / 2 + 0.55, -0.12);
  await frames(8);
  await shot(`${tag}-5-projector`);

  // stop → rolls up again
  await page.evaluate(() => window.__app.ctx.media.stop());
  for (let i = 0; i < 60; i++) await page.evaluate(() => window.__app.world.cinema.update(0.1));
  const after = await page.evaluate(() => { const c = window.__app.world.cinema; return { active: c.active, drop: c.drop, picture: c.picture, dim: c.dim, texture: !!c.texture, gain: window.__app.ctx.media.state.spatialGain }; });
  console.log('STOPPED ' + JSON.stringify(after));
  await pose(-0.6, 1.2, Math.PI / 2 + 0.05, 0.12);
  await frames(8);
  await shot(`${tag}-6-rolled-up`);

  // the e-reader stand for the reading browser
  await pose(-5.25, -3.8, 0, -0.35);
  await frames(8);
  await shot(`${tag}-7-ereader`);
  await page.evaluate(() => { clearInterval(window.__testTimer); });
  console.log('ERRORS ' + JSON.stringify(errors.slice(0, 8)));
};
