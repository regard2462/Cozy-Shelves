// The world map's tiles in the checks (app/src/ui/worldmap/osm-view.js shows OpenStreetMap's tiles). A check never
// fetches them from tile.openstreetmap.org: its tile usage policy forbids automated bulk use, and a run must not depend
// on the network. serveTiles() answers every tile request through Playwright's routing with a small PNG made here
// (256 × 256 px, two light colours in a checkerboard of the tiles, a thin grey line along the top and the left edge:
// shots show the grid, and a pan or a zoom shows in them), or aborts the requests (mode 'offline', no connection).
//   const tiles = await serveTiles({ page, app });      Electron (build/screenshot.js), or { context } in a browser
//   tiles.mode = 'offline' | 'ok'; tiles.served, tiles.aborted, tiles.bad, tiles.unrouted(), tiles.colourOf(src),
//   await tiles.stop()
// An address no tile server has (a fractional zoom, a column outside the grid) is answered 404 as by OpenStreetMap
// and noted in tiles.bad.
// and for the picture on the screen: tileSpot (runs in the page), filtered(rgb, cssFilter), screenColour(app, rect),
// screenMode(app, rect) (the most common colour: the atlas's fills).
// Electron: only page.route reaches the window's requests (a route on electronApp.context() is never asked); every
// tile address the page asks for is noted, and tiles.unrouted() lists any the route did not see (a check expects
// none). No safety net in the session: a PAC script that sent the tile host to a dead proxy crashed Chromium's proxy
// resolver on Linux now and then (ERR_MANDATORY_PROXY_CONFIGURATION_FAILED for every request, the route got no tile
// any more), and webRequest.onBeforeRequest runs before Playwright's interception and would cancel the routed tiles as
// well. While a route is set, Playwright turns the HTTP cache of the page off.
const { encode } = require('./png-lite.js');

const HOST = 'tile.openstreetmap.org';
const PATTERN = `https://${HOST}/**`;
const COLOURS = [[226, 214, 188], [198, 222, 190]];      // beige and pale green, neither is the map's own background
const LINE = [128, 128, 128];

function tilePng(rgb) {
  const W = 256, data = Buffer.alloc(W * W * 4);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const c = x === 0 || y === 0 ? LINE : rgb, i = (y * W + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return encode({ width: W, height: W, data });
}
const PNGS = COLOURS.map(tilePng);
/** z/x/y of a tile address, or null */
const parse = (url) => { const m = /\/(\d+)\/(\d+)\/(\d+)\.png(?:$|\?)/.exec(url); return m ? { z: +m[1], x: +m[2], y: +m[3] } : null; };
/** a tile OpenStreetMap has: whole numbers, z 0 to 19, x and y inside the 2^z × 2^z grid */
const valid = (url) => { const m = /^https:\/\/[^/]+\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url); return !!m && +m[1] <= 19 && +m[2] < 2 ** +m[1] && +m[3] < 2 ** +m[1]; };
/** the colour a tile of this address has (the checkerboard) */
const colourOf = (url) => { const t = parse(url); return t ? COLOURS[(t.x + t.y) % 2] : null; };

async function serveTiles({ page, app, context }) {
  const st = { mode: 'ok', served: 0, aborted: 0, bad: [], requested: new Set(), handled: new Set() };
  const handler = (route) => {
    const url = route.request().url();
    st.handled.add(url);
    if (st.mode === 'offline') { st.aborted++; return route.abort('internetdisconnected'); }
    // an address no tile server has (a zoom like 2.25, a column outside the grid) gets what OpenStreetMap gives it
    if (!valid(url)) { st.bad.push(url); return route.fulfill({ status: 404, contentType: 'text/plain', body: 'no such tile' }); }
    const t = parse(url);
    st.served++;
    // no-store: an image the page has seen once must not come back from a cache when the check takes the tiles away
    return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }, body: PNGS[t ? (t.x + t.y) % 2 : 0] });
  };
  const target = page || context;
  target.on('request', (r) => { if (r.url().includes(HOST)) st.requested.add(r.url()); });
  await target.route(PATTERN, handler);
  return {
    get mode() { return st.mode; }, set mode(m) { st.mode = m; },
    get served() { return st.served; }, get aborted() { return st.aborted; },
    /** addresses that are no tile (answered 404 like the real server) */
    get bad() { return st.bad.slice(); },
    /** the route off again (for a check that goes on with other things: a route turns the page's HTTP cache off) */
    async stop() { await target.unroute(PATTERN, handler); },
    /** tile addresses the page asked for that the route never saw (should be none) */
    unrouted() { return [...st.requested].filter((u) => !st.handled.has(u)); },
    colourOf, parse, COLOURS, HOST,
  };
}

/** The colour a CSS filter makes of an RGB colour (the filter as getComputedStyle gives it: sepia, saturate,
 *  brightness, invert, hue-rotate, contrast; the matrices of Filter Effects Level 1, on sRGB values like Chromium). */
function filtered(rgb, filter) {
  let [r, g, b] = rgb.map((v) => v / 255);
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const mat = (m) => { [r, g, b] = [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b].map(clamp); };
  for (const [, fn, arg] of String(filter || '').matchAll(/([a-z-]+)\(([^)]*)\)/g)) {
    const v = parseFloat(arg), a = /%/.test(arg) ? v / 100 : v;
    if (fn === 'sepia') { const k = 1 - Math.min(1, a); mat([0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k, 0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k, 0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k]); }
    else if (fn === 'saturate') mat([0.213 + 0.787 * a, 0.715 - 0.715 * a, 0.072 - 0.072 * a, 0.213 - 0.213 * a, 0.715 + 0.285 * a, 0.072 - 0.072 * a, 0.213 - 0.213 * a, 0.715 - 0.715 * a, 0.072 + 0.928 * a]);
    else if (fn === 'brightness') [r, g, b] = [r, g, b].map((x) => clamp(x * a));
    else if (fn === 'contrast') [r, g, b] = [r, g, b].map((x) => clamp((x - 0.5) * a + 0.5));
    else if (fn === 'invert') [r, g, b] = [r, g, b].map((x) => a * (1 - x) + (1 - a) * x);
    else if (fn === 'hue-rotate') {
      const t = (/rad/.test(arg) ? v : /turn/.test(arg) ? v * 2 * Math.PI : v * Math.PI / 180), c = Math.cos(t), s = Math.sin(t);
      mat([0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
        0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
        0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072]);
    }
  }
  return [r, g, b].map((v) => Math.round(v * 255));
}

/** Runs in the page: a spot of 24 × 24 px inside a loaded tile, clear of the panel's overlays, of the app's names and
 *  of the selected or hovered outline: { rect, src, filter } (rect in page px for capturePage), or { none: [the first
 *  tiles], atlas } (why not). In the overview the atlas (the SVG of pane wm-fill, osm-view.js) covers every tile: a
 *  spot of a tile exists only where that pane is gone (zoom 8.5 and closer). */
function tileSpot() {
  const body = document.querySelector('.wm-body')?.getBoundingClientRect(); if (!body) return null;
  const fill = document.querySelector('.wm-osm .leaflet-wm-fill-pane');
  const atlas = fill && fill.querySelector('path') ? +getComputedStyle(fill).opacity : 0;
  if (atlas > 0) return { none: 'the atlas covers the tiles', atlas };
  const covers = [...document.querySelectorAll('.wm-hint:not([hidden]), .wm-legend:not([hidden]), .wm-zoom, .wm-card:not([hidden]), .wm-osm .leaflet-control, .wm-tip:not([hidden]), .wm-offline:not([hidden]), .wm-pad-aim, .wm-osm .leaflet-overlay-pane path, .wm-labels .wm-l')].map((e) => e.getBoundingClientRect());
  for (const img of document.querySelectorAll('.wm-osm img.leaflet-tile-loaded')) {
    // Leaflet marks a tile that failed as loaded as well: only a picture that came (and an address of a tile) counts
    const r = img.getBoundingClientRect();
    if (!img.complete || img.naturalWidth !== 256 || !/\/\d+\/\d+\/\d+\.png/.test(img.src) || r.width < 120 || getComputedStyle(img).opacity !== '1') continue;
    const x = Math.round(r.left + 30), y = Math.round(r.top + 30), s = 24;
    if (x < body.left + 8 || y < body.top + 8 || x + s > body.right - 8 || y + s > body.bottom - 8) continue;
    if (covers.some((a) => x < a.right && x + s > a.left && y < a.bottom && y + s > a.top)) continue;
    return { rect: { x, y, width: s, height: s }, src: img.src, filter: getComputedStyle(img.closest('.wm-tiles') || img).filter };
  }
  return { none: [...document.querySelectorAll('.wm-osm img.leaflet-tile')].slice(0, 6).map((i) => { const r = i.getBoundingClientRect(); return [i.className.replace(/leaflet-/g, ''), i.complete, i.naturalWidth, getComputedStyle(i).opacity, Math.round(r.left), Math.round(r.top), Math.round(r.width), i.src.slice(-14)]; }) };
}

/** The window as the main process copies it (what reaches the screen): a rect of the page as a decoded PNG. */
async function screenImage(app, rect) {
  const { decode } = require('./png-lite.js');
  const b64 = await app.evaluate(async ({ BrowserWindow }, r) => {
    const w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL()));
    try { w.webContents.incrementCapturerCount(undefined, false, false); } catch {}
    try { w.webContents.invalidate(); await new Promise((res) => setTimeout(res, 300)); return (await w.webContents.capturePage(r)).toPNG().toString('base64'); }
    finally { try { w.webContents.decrementCapturerCount(false, false); } catch {} }
  }, rect);
  return decode(Buffer.from(b64, 'base64'));
}

/** The mean colour of a rect of the page as it reaches the screen. */
async function screenColour(app, rect) {
  const { region } = require('./png-lite.js');
  const img = await screenImage(app, rect);
  // a margin of 3 px: the copy of a rect may be scaled by the device pixel ratio
  return region(img, 3, 3, img.width - 6, img.height - 6).mean;
}

/** The most common colour of a rect of the page as it reaches the screen, and the share of the pixels within 3 of it:
 *  the colour of a filled area even where a fine line (a river of the atlas) or the halo of a name crosses the rect. */
async function screenMode(app, rect) {
  const img = await screenImage(app, rect);
  const count = new Map(), d = img.data, n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; count.set(k, (count.get(k) || 0) + 1); }
  let top = 0, key = 0;
  for (const [k, v] of count) if (v > top) { top = v; key = k; }
  const rgb = [(key >> 16) & 255, (key >> 8) & 255, key & 255];
  let near = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - rgb[0]) <= 3 && Math.abs(d[i + 1] - rgb[1]) <= 3 && Math.abs(d[i + 2] - rgb[2]) <= 3) near++;
  return { rgb, share: +(near / n).toFixed(2) };
}

module.exports = { serveTiles, colourOf, parse, filtered, tileSpot, screenColour, screenMode, COLOURS, HOST };
