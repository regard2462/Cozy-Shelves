// The floor painter (app/src/world/floor-art.js) in Node, without Electron: every style paints its tile without a NaN
// (a NaN height makes a normal whose blue channel is 0), every texel of colour and roughness is opaque, the sizes are
// right, and the herringbone covers every pixel at its real size: a pixel whose centre lay exactly on the seam between
// two strips fell between the two strip tests and was painted as a dark pit (85 of them on two diagonals of the tile).
//   node build/floor-art-check.js        exit code 1 when something fails
'use strict';
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
/** An ES module of the app bundled for Node (as the games tests do). */
function load(rel) {
  const out = esbuild.buildSync({ entryPoints: [path.join(root, rel)], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'error' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const { paintFloor, paintFloorPreview } = load('app/src/world/floor-art.js');
const { FLOOR_STYLES, FLOOR_SPECS } = load('app/src/world/floor-styles.js');

let passed = 0, failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (ok) passed++; else failed++; };

for (const style of FLOOR_STYLES) {
  if (FLOOR_SPECS[style].builtin) continue;   // the oak boards come from textures.js
  // the herringbone at its real size (the seams fall on pixel centres only at the sizes the tile is a multiple of), the
  // others small: their painters know no seams, a NaN would show at any size
  const size = style === 'herringbone' ? FLOOR_SPECS[style].size : 256;
  const t0 = Date.now();
  const f = paintFloor(style, size);
  const probs = [];
  let alpha = 0, blue = 0, pit = 0, rough = 0;
  for (let i = 0; i < f.color.length; i += 4) {
    if (f.color[i + 3] !== 255) alpha++;
    if (f.normal[i + 2] < 100) blue++;
    // the herringbone's fallback for a pixel no strip covers: a dark pit of this exact colour
    if (style === 'herringbone' && f.color[i] === 60 && f.color[i + 1] === 40 && f.color[i + 2] === 25) pit++;
  }
  for (let i = 0; i < f.rough.length; i += 4) if (f.rough[i + 3] !== 255) rough++;
  if (alpha) probs.push(alpha + ' texels not opaque');
  if (blue) probs.push(blue + ' normals with a blue channel under 100 (a NaN height or a cliff)');
  if (pit) probs.push(pit + ' pixels no strip of the herringbone covers');
  if (rough) probs.push(rough + ' roughness texels not opaque');
  if (f.w !== size || f.h !== size || f.rw !== size / 2 || f.rh !== size / 2) probs.push(`sizes ${f.w}x${f.h}, rough ${f.rw}x${f.rh}`);
  check(`floor ${style} at ${size}: opaque, finite normals${style === 'herringbone' ? ', every pixel covered' : ''}`, !probs.length, probs.length ? probs : { ms: Date.now() - t0 });
}
{
  const p = paintFloorPreview('oak', 84, 52);
  let bad = 0;
  for (let i = 0; i < p.length; i += 4) if (p[i + 3] !== 255 || (p[i] === 0 && p[i + 1] === 0 && p[i + 2] === 0)) bad++;
  check('the settings\' picture of the oak boards: opaque, no black texel', p.length === 84 * 52 * 4 && !bad, { bad });
}
console.log(`FLOOR-ART-CHECK ${failed ? 'FAILED' : 'OK'} passed=${passed} failed=${failed}`);
process.exitCode = failed ? 1 : 0;
