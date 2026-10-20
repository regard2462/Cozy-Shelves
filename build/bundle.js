// Bundles the renderer with esbuild. `node build/bundle.js [--watch]`
const esbuild = require('esbuild');
const path = require('path');

const root = path.join(__dirname, '..');
const watch = process.argv.includes('--watch');

const entries = {
  app: 'app/src/main.js',            // main 3D application
  indexer: 'app/src/indexer.js',     // hidden window: metadata + cover extraction
  fulltext: 'app/src/search/fulltext-window.js',   // hidden window: the text of the books for the full-text search
  'tts-worker': 'app/src/workers/tts-worker.js',
  'piper-worker': 'app/src/workers/piper-worker.js',   // German Piper/VITS voices (Thorsten-Voice)
  'kokoro-de-worker': 'app/src/workers/kokoro-de-worker.js', // German Kokoro/StyleTTS2 voice (Martin)
  'chess-worker': 'app/src/workers/stockfish-worker.js',
  'wall-art-worker': 'app/src/workers/wall-art-worker.js',   // graffiti murals for the walls (world/walls.js)
  'sound-worker': 'app/src/workers/sound-worker.js',         // rain, leaves, crickets and footsteps made ahead (audio/offthread.js)
  'floor-worker': 'app/src/workers/floor-worker.js',         // the floors of the rooms (world/floors.js) and their pictures in the settings
  'diagram-worker': 'app/src/workers/diagram-worker.js',   // chess diagrams on night pages (reader)
  'side-cover-worker': 'app/src/workers/side-cover-worker.js',   // the cover pictures on the sides of the books (world/side-covers.js)
  'texture-worker': 'app/src/workers/texture-worker.js',     // the textures of the rooms painted ahead at a first start (world/texture-store.js)
  dev: 'app/src/dev.js',
};

// the store of painted textures is keyed by the painters' source: new painters, new pictures (world/texture-store.js)
const texturesHash = require('crypto').createHash('sha1').update(require('fs').readFileSync(path.join(root, 'app/src/world/texture-paint.js'))).digest('hex').slice(0, 12);

const opts = {
  entryPoints: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, path.join(root, v)])),
  outdir: path.join(root, 'app', 'dist'),
  bundle: true,
  format: 'esm',
  splitting: true,
  sourcemap: true,
  target: ['chrome132'],
  logLevel: 'info',
  // foliate-js is loaded unbundled at runtime (dynamic import with a URL string)
  external: ['../vendor/*', './vendor/*', '/vendor/*'],
  loader: { '.glsl': 'text', '.vert': 'text', '.frag': 'text', '.wgsl': 'text', '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"', COZYSHELVES_TEXTURES: JSON.stringify(texturesHash) },
};

(async () => {
  // content-hashed chunks pile up otherwise, and every stale chunk ends up in the package
  if (!watch) { try { require('fs').rmSync(opts.outdir, { recursive: true, force: true }); } catch {} }
  if (watch) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
    console.log('watching…');
  } else {
    await esbuild.build(opts);
  }
})().catch((e) => { console.error(e); process.exit(1); });
