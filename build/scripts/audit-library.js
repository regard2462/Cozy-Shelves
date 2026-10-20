// Audit: the folder watcher of the library. A new file appears on the shelves without a rescan, a renamed file
// keeps its reading progress, a deleted file disappears. Needs COZYSHELVES_BOOKS pointing at a scratch copy of a
// test library (the script writes into its first folder).
const fs = require('fs');
const path = require('path');
const kit = require('./audit-lib');

module.exports = async (env) => {
  const k = kit(env);
  const { page, sleep, log } = k;
  const root = String(process.env.COZYSHELVES_BOOKS || '').split(';')[0].split('|')[0];
  if (!root || !fs.existsSync(root)) { log('SKIP: COZYSHELVES_BOOKS is not a folder'); return; }
  await k.boot();
  const books = () => page.evaluate(() => window.__app.state.library.books.map((b) => ({ id: b.id, title: b.title, path: b.path, progress: b.progress })));
  const waitFor = async (fn, ms = 25000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = await fn(); if (r) return r; await sleep(500); } return null; };
  const before = await books();
  log('START books=' + before.length);

  // a new file
  const dir = path.join(root, 'Neu');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'Ärger im Ölhafen – Ein Bericht.txt');
  fs.writeFileSync(file, 'Ärger im Ölhafen\n\n' + 'Der Hafen lag still. '.repeat(400));
  const t0 = Date.now();
  const added = await waitFor(async () => (await books()).find((b) => b.path === file));
  log(`ADDED after ${Date.now() - t0} ms: ${JSON.stringify(added)}`);

  // reading progress, then a rename
  if (added) await page.evaluate(async (id) => window.api.library.update(id, { progress: 0.5, lastLocation: '3' }), added.id);
  await sleep(600);
  const renamed = path.join(dir, 'Ärger im Ölhafen (Neuausgabe).txt');
  fs.renameSync(file, renamed);
  const moved = await waitFor(async () => (await books()).find((b) => b.path === renamed));
  const oldStill = (await books()).some((b) => b.path === file);
  log(`RENAMED ${JSON.stringify(moved)} oldEntryVisible=${oldStill}`);

  // delete
  fs.rmSync(renamed);
  const gone = await waitFor(async () => !(await books()).some((b) => b.path === renamed));
  log(`DELETED gone=${!!gone} books=${(await books()).length}`);
  fs.rmSync(dir, { recursive: true, force: true });
  log('ERRORS ' + JSON.stringify(k.errors.slice(0, 10)));
};
