// Builds the browser version into dist/web/: a static site with relative addresses that runs from any static host
// (http://localhost counts as a secure context, which the folder picker needs). `node build/web.js` or `npm run build:web`.
// The desktop build (build/bundle.js, build/vendor.js) is untouched by this; the two share the sources.
//   dist/web/index.html, theme-boot.js, styles/, data/   as in app/
//   dist/web/vendor/                                     fonts (latin only), chessground, stockfish, foliate-js
//   dist/web/dist/                                       the bundle: app.js (app/src/main-web.js) and the workers
// Left out on purpose: the TTS workers and their models (Kokoro, Piper, espeak-ng, onnxruntime: hundreds of MB), the
// indexer and full-text windows of the desktop, the source maps.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = path.join(root, 'app');
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'dist', 'web');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const quiet = process.argv.includes('--quiet');

function copy(src, dst, filter = null) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, force: true, filter: filter ? (s) => filter(s) : undefined });
}
function sizeOf(p) {
  if (!fs.existsSync(p)) return 0;
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  let n = 0;
  for (const e of fs.readdirSync(p)) n += sizeOf(path.join(p, e));
  return n;
}
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

// ---- vendor: the parts the renderer loads unbundled, without the speech models --------------------------------------
function vendor() {
  const v = path.join(out, 'vendor');
  // fonts: only the latin and latin-ext files of the weights the UI uses, and a fonts.css that names only them
  const fonts = {
    'eb-garamond': ['400', '400-italic', '500', '600', '700'],
    'cormorant-garamond': ['400', '400-italic', '500', '600', '700'],
    caveat: ['400', '500', '600', '700'],
    vt323: ['400'],
    'playfair-display': ['400', '400-italic', '700', '900'],
  };
  // only the latin ranges and only woff2 (every browser of the web build reads it): a quarter of the desktop's fonts
  const LATIN = /-(latin|latin-ext)-/;
  const fontCss = [];
  for (const [name, weights] of Object.entries(fonts)) {
    const src = path.join(nm, '@fontsource', name);
    if (!fs.existsSync(src)) { console.warn('WARNING: font missing', name); continue; }
    const dst = path.join(v, 'fonts', name);
    copy(path.join(src, 'files'), path.join(dst, 'files'), (s) => fs.statSync(s).isDirectory() || (LATIN.test(path.basename(s)) && s.endsWith('.woff2')));
    for (const w of weights) {
      const f = path.join(src, `${w}.css`);
      if (!fs.existsSync(f)) continue;
      // one @font-face block per unicode range: keep the blocks whose file we copied, without their woff fallback
      const blocks = fs.readFileSync(f, 'utf8').split(/(?=\/\* [a-z-]+ \*\/\s*@font-face)/g).filter((b) => /@font-face/.test(b));
      const kept = blocks.filter((b) => LATIN.test(b)).map((b) => b.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, ''));
      fs.mkdirSync(dst, { recursive: true });
      fs.writeFileSync(path.join(dst, `${w}.css`), kept.join('\n'));
      fontCss.push(`@import url("./${name}/${w}.css");`);
    }
  }
  fs.writeFileSync(path.join(v, 'fonts', 'fonts.css'), fontCss.join('\n') + '\n');
  // chessground assets (CSS + piece SVGs)
  copy(path.join(nm, 'chessground', 'assets'), path.join(v, 'chessground'));
  // Leaflet's stylesheet (the world map; the script is bundled)
  copy(path.join(nm, 'leaflet', 'dist', 'leaflet.css'), path.join(v, 'leaflet', 'leaflet.css'));
  // stockfish lite single-threaded engine (loaded only when the chess engine is asked for)
  for (const f of ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm']) copy(path.join(nm, 'stockfish', 'bin', f), path.join(v, 'stockfish', f));
  // foliate-js (EPUB/MOBI/AZW3/FB2/CBZ + pdf.js) ships in vendor-src/
  const foliate = path.join(root, 'vendor-src', 'foliate-js');
  if (fs.existsSync(foliate)) copy(foliate, path.join(v, 'foliate-js'), (s) => !/[\\/](\.git|rollup\.config\.js|eslint\.config\.js|package\.json|reader\.html|reader\.js|ui)$/.test(s) && !/[\\/]ui[\\/]/.test(s));
  else console.warn('WARNING: vendor-src/foliate-js is missing - EPUB/PDF reading will not work.');
}

// ---- the bundle ----------------------------------------------------------------------------------------------------
const WEB_SWAPS = [
  // the backend helpers of the desktop that the bundled wiki/dict/classify modules require
  { test: /[\\/]feeds[\\/]common(\.js)?$/, to: path.join(app, 'src', 'web', 'common-web.js'), when: () => true },
  // the browser's speech output in place of the local voices
  { test: /(^|[\\/])tts-client\.js$/, to: path.join(app, 'src', 'ui', 'reader', 'tts-client-web.js'), when: (args) => !/tts-client-web\.js$/.test(args.importer) },
];
// node's `path` for the bundled backend modules; hls.js is only for the Mediathek's streams, which the browser version
// has not (2.8 MB that would never load)
const NODE_STUBS = { path: path.join(app, 'src', 'web', 'path-stub.js'), 'hls.js': path.join(app, 'src', 'web', 'hls-stub.js'), 'hls.js/dist/hls.js': path.join(app, 'src', 'web', 'hls-stub.js') };
const webPlugin = {
  name: 'cozy-shelves-web',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === 'entry-point') return null;
      if (NODE_STUBS[args.path]) return { path: NODE_STUBS[args.path] };
      // relative requires ('./common') are tested as the file they name
      const full = /^\.\.?[\\/]/.test(args.path) ? path.resolve(args.resolveDir, args.path) : args.path;
      for (const s of WEB_SWAPS) if (s.test.test(full) && s.when(args)) return { path: s.to };
      return null;
    });
  },
};

async function bundle() {
  const entries = {
    app: 'app/src/main-web.js',                                 // the app, with the backend of the page
    'chess-worker': 'app/src/workers/stockfish-worker.js',
    'wall-art-worker': 'app/src/workers/wall-art-worker.js',   // graffiti murals for the walls (world/walls.js)
    'sound-worker': 'app/src/workers/sound-worker.js',         // rain, leaves, crickets and footsteps made ahead
    'floor-worker': 'app/src/workers/floor-worker.js',         // the floors of the rooms (world/floors.js)
    'diagram-worker': 'app/src/workers/diagram-worker.js',     // chess diagrams on night pages (reader)
    'side-cover-worker': 'app/src/workers/side-cover-worker.js',   // the covers on the sides of the books
    'texture-worker': 'app/src/workers/texture-worker.js',     // the textures of the rooms painted ahead at a first start
  };
  // the store of painted textures is keyed by the painters' source (world/texture-store.js), as in build/bundle.js
  const texturesHash = require('crypto').createHash('sha1').update(fs.readFileSync(path.join(root, 'app/src/world/texture-paint.js'))).digest('hex').slice(0, 12);
  const result = await esbuild.build({
    entryPoints: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, path.join(root, v)])),
    outdir: path.join(out, 'dist'),
    bundle: true,
    format: 'esm',
    splitting: true,
    sourcemap: false,
    minify: false,
    platform: 'browser',
    target: ['chrome110', 'firefox115', 'safari16.4'],
    logLevel: quiet ? 'warning' : 'info',
    metafile: true,
    external: ['../vendor/*', './vendor/*', '/vendor/*'],
    loader: { '.glsl': 'text', '.vert': 'text', '.frag': 'text', '.wgsl': 'text', '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"', COZYSHELVES_VERSION: JSON.stringify(pkg.version), COZYSHELVES_TEXTURES: JSON.stringify(texturesHash) },
    plugins: [webPlugin],
  });
  // the modules of the desktop that must never be in the page
  const forbidden = Object.keys(result.metafile.inputs).filter((f) => /kokoro|onnxruntime|piper-wasm|tts-worker|piper-worker|kokoro-de-worker|jsdom|rss-parser|electron[\\/]main\.js/.test(f));
  if (forbidden.length) throw new Error('desktop-only code in the web bundle: ' + forbidden.join(', '));
  return result;
}

// ---- the page --------------------------------------------------------------------------------------------------------
function page() {
  let html = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
  html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">\n  <meta name="color-scheme" content="light dark">\n  <link rel="manifest" href="./manifest.webmanifest">\n  <link rel="icon" href="./icon.png" type="image/png">\n  <meta name="theme-color" content="#e3dccf">');
  fs.writeFileSync(path.join(out, 'index.html'), html);
  fs.copyFileSync(path.join(app, 'theme-boot.js'), path.join(out, 'theme-boot.js'));
  copy(path.join(app, 'styles'), path.join(out, 'styles'));
  copy(path.join(app, 'data'), path.join(out, 'data'));
  for (const f of ['icon.png', 'icon-512.png']) if (fs.existsSync(path.join(root, 'assets', f))) fs.copyFileSync(path.join(root, 'assets', f), path.join(out, f));
  // a web app manifest: "add to home screen" on a phone gives a full-screen page (the Android app is another matter)
  fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({
    name: 'Cozy Shelves', short_name: 'Cozy Shelves', description: pkg.description, start_url: './index.html', scope: './', display: 'fullscreen', orientation: 'landscape',
    background_color: '#e3dccf', theme_color: '#e3dccf', icons: [{ src: './icon.png', sizes: '256x256', type: 'image/png' }, { src: './icon-512.png', sizes: '512x512', type: 'image/png' }],
  }, null, 2));
  // a static host that knows nothing about the files: the types it needs (GitHub Pages and the like know them anyway)
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
}

(async () => {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  vendor();
  await bundle();
  page();
  const parts = ['dist', 'vendor/fonts', 'vendor/foliate-js', 'vendor/stockfish', 'vendor/chessground', 'styles', 'data'].map((p) => [p, sizeOf(path.join(out, p))]);
  const total = sizeOf(out);
  const info = { version: pkg.version, builtAt: new Date().toISOString(), bytes: total, parts: Object.fromEntries(parts) };
  fs.writeFileSync(path.join(out, 'build-info.json'), JSON.stringify(info, null, 2));
  console.log(`web build ${pkg.version} → ${out}`);
  for (const [p, n] of parts) console.log(`  ${p.padEnd(20)} ${mb(n)}`);
  console.log(`  ${'total'.padEnd(20)} ${mb(total)}`);
})().catch((e) => { console.error(e); process.exit(1); });
