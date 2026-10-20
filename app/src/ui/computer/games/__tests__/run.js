#!/usr/bin/env node
/* eslint-disable no-console */
// Runs the pure-logic tests. The app sources are ES modules inside a CommonJS package, so the test
// file is bundled with esbuild (already a dev dependency) and then executed.
//
//   node app/src/ui/computer/games/__tests__/run.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const esbuild = require('esbuild');
const { execFileSync } = require('child_process');

const here = __dirname;
const entry = path.join(here, 'game-logic.test.mjs');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-tests-')), 'tests.cjs');

esbuild.buildSync({
  entryPoints: [entry],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  logLevel: 'warning',
});
try {
  execFileSync(process.execPath, [out], { stdio: 'inherit', env: { ...process.env, COZYSHELVES_ROOT: path.resolve(here, '..', '..', '..', '..', '..', '..') } });
} catch (e) {
  process.exit(e.status || 1);
} finally {
  try { fs.rmSync(path.dirname(out), { recursive: true, force: true }); } catch { /* ignore */ }
}
