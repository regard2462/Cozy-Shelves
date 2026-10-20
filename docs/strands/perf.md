# Strand "perf": faster without a loss of the picture (0.9)

Branch `wip/perf`, from `integ/0.9` (0d49523, the bug fixes, the smoother god rays, the
browser version and the Android app). Goal: less GPU and CPU time per frame, a quicker start, no stutter at the
shelves and the panels, and the same picture: every change is checked pixel by pixel against the pictures of the
build before it (noise of the dither and the rounding of half floats allowed, nothing else), and no default of the
settings, resolution, shadow size, sample count or distance is turned down.

## How it is measured (the scripts, all new)

* `perf-matrix` (`build/scripts/perf-matrix.js`): GPU time per frame with timer queries (`EXT_disjoint_timer_query_webgl2`)
  and the CPU time of `World#frame`, at fixed views and conditions (the hall towards the fire, the book room, 1.5 m in
  front of the fullest case, the terrace, the jetty, the garden through the glass front; day 11:00, night 23:00,
  rain, snow, the golden hour), for the tiers high, medium and low, at the window's drawing buffer (1584 × 861 of a
  1600 × 900 window) and at an emulated 2560 × 1391 (`PERF_EMU=2560x1440`, the composer told the ratio as the other
  checks do). The frames are drawn back to back, each with a query of its own, and the results read at the end: a
  frame waited for one at a time let the card's clocks drop between frames and the times spread by half (the first
  15 frames after a pause are not counted). The CPU time comes from separate frames, each finished on the card before
  the next (no frame waits for the card inside its own time). Medians of 60 frames (`PM_N`), p10/p90 beside them.
  Then, for the high tier: where the CPU time goes (the steps of `World#frame`, the passes of the composer), the GPU
  time of every pass (one query round each, the frames back to back) and of the two shadow maps (a frame with the
  sun's or the fire's map redrawn minus one without), and the memory (JS heap, textures, geometries, programs, an
  estimate of the bytes of the textures and the render targets). Everything as JSON into
  `SHOT_DIR/perf-matrix-<PM_TAG>.json`.
* `perf-probe`: the frame with parts of the world left out in turn (the garden, the sky, the books, the static
  furniture, the AO, the bloom, the rays, every material a plain one), the steps of the AO pass one by one, and the
  draw calls of a frame by pass and by object.
* `perf-shots` and `perf-diff`: the picture of every tier, view and condition at the window's size, made the same way
  every time (time standing still, the world's clocks at one moment, the wall clock at one time, the animals and the cat
  off, the rays' jitter started at the same frame, the drawing buffer read right after the frame, `COZYSHELVES_QUERY=
  nopaint=1` because the paintings are made by chance); `perf-diff <A> <B>` prints per picture the mean difference,
  the pixels over 1, 4 and 16 steps and the largest step, and writes the differences (× 8) as pictures.
* `perf-startup`: the milliseconds from the page's start to `window.__app`, the built world, the first frame and the
  start menu's button, the click on "Bücherei betreten" to the fade and the next frame, with the V8 sampling profiler
  running through the DevTools protocol (`startup-<tag>.cpuprofile`, the functions with the most self time printed).
* `perf-panels`: for every panel the time from `openPanel` to its mount and to two drawn frames, the long tasks, the
  time to close, and the CPU time of the world's frame while it is open.
* The existing checks `hover-perf`, `gpu-time`, `godrays-check` (perf part), `cinema-perf-check` stay as they are.
* Added later: `perf-matrix` `PM_HOLD=1` (no shadow map redrawn in the measured frames: their
  redraws once a second fall on a few frames by chance and spread the medians of the short frames); `perf-cpu` (the
  V8 profile of 300 frames at a view, self and total time per function inside `World#frame`, and the counts of one
  frame: draws, program switches, material switches, materials whose version moves, materials drawn in two passes,
  the scene graph); `perf-draws` (a timer query round every draw call of the scene and the AO's normal pass, summed
  per object); `perf-toggle` (two states of the running world set by snippets `PT_A`/`PT_B`, measured in alternating
  blocks, GPU or with `PT_CPU=1` CPU). `perf-compare` prints perf-matrix runs side by side (several runs
  per side joined with `+`); whole runs of two query strings (`?lampgate=0`) were alternated A B A B.

Every run has its own data folder, the library `testbooks4` (61 books, 7 cases) unless said otherwise, the window
1600 × 900 off screen, muted; no other instance of the app ran meanwhile (0 % other load on the graphics card before
and after each run). Card: a mid-range desktop graphics card, ANGLE Direct3D11.

## Baseline (integ/0.9 at 0d49523, run `base1`)

GPU time per frame (ms, median of 60; p10/p90 within ±2 % unless noted), CPU time of `World#frame` (ms, median of 30):

| view, condition | high 1584×861 | high 2560×1391 | medium 1584 | medium 2560 | low 1584 | low 2560 |
|---|---:|---:|---:|---:|---:|---:|
| hall, day | 3.50 (cpu 4.2) | 8.90 (4.7) | 4.75 (3.4) | 3.79 (3.2) | 2.59 (3.4) | 2.09 (2.3) |
| hall, night | 3.28 (3.4) | 8.49 (4.4) | 2.79 (2.8) | 3.65 (3.0) | 0.97 (3.0) | 1.79 (2.5) |
| hall, golden hour | 3.47 (3.8) | 8.86 (5.3) | 2.61 (2.9) | 3.74 (2.8) | 2.93 (1.7) | 1.82 (2.5) |
| book room, day | 2.93 (2.5) | 7.73 (3.8) | 2.21 (1.9) | 3.45 (2.1) | 0.91 (1.1) | 1.33 (1.4) |
| book room, night | 2.81 (2.4) | 7.37 (3.6) | 1.68 (1.8) | 3.33 (2.3) | 0.89 (1.0) | 1.52 (1.6) |
| at the shelves, day | 3.94 (2.1) | 10.14 (3.5) | 2.32 (1.8) | 4.14 (2.0) | 1.39 (1.3) | 1.94 (1.5) |
| terrace, day | 2.64 (2.7) | 6.03 (3.1) | 2.00 (1.6) | 3.88 (2.3) | 1.29 (1.1) | 2.12 (1.7) |
| terrace, night | 2.42 (2.9) | 5.57 (3.2) | 1.72 (1.9) | 3.77 (2.2) | 1.29 (1.1) | 1.92 (1.5) |
| terrace, rain | 2.36 (2.7) | 5.46 (3.5) | 1.70 (1.5) | 3.67 (2.6) | 1.17 (1.6) | 1.79 (1.6) |
| terrace, snow | 2.70 (3.0) | 5.97 (3.5) | 1.94 (1.5) | 3.89 (2.3) | 1.31 (1.5) | 2.16 (1.9) |
| jetty, day | 2.42 (2.0) | 5.68 (2.6) | 1.71 (1.0) | 3.78 (1.6) | 1.08 (1.0) | 1.83 (1.0) |
| jetty, night | 2.23 (2.0) | 5.15 (2.7) | 1.63 (1.5) | 3.63 (1.9) | 1.07 (0.9) | 2.05 (1.1) |
| jetty, rain | 2.23 (2.1) | 5.24 (2.7) | 1.65 (1.6) | 3.73 (1.8) | 1.01 (1.0) | 2.05 (1.2) |
| jetty, snow | 2.46 (2.5) | 5.62 (2.6) | 1.68 (1.3) | 3.75 (1.9) | 1.12 (1.0) | 1.94 (1.1) |
| jetty, golden hour | 2.40 (2.1) | 5.75 (2.6) | 1.66 (1.4) | 3.73 (1.9) | 0.88 (1.0) | 2.12 (1.2) |
| glass front, day | 3.54 (3.0) | 7.73 (3.8) | 2.05 (2.5) | 4.18 (3.2) | 1.32 (2.3) | 2.37 (2.4) |

(The medium and low tiers at 1584 × 861 in the hall spread more, p10 to p90 of 2.1 to 6.4 ms: the frame is so short
there that the shadow maps' redraws and the card's clocks weigh; the 2560 columns are steady.)

Where it goes (high tier, GPU, ms; `base1` passes part and `probe1`):

| | hall 1584 | hall 2560 | shelves 2560 | jetty golden 2560 | terrace 2560 |
|---|---:|---:|---:|---:|---:|
| whole frame (no shadow map redrawn) | 4.17 | 8.85 | 9.47 | 5.96 | 6.41 |
| the scene (RenderPass) | 1.66 | 3.23 | 3.66 | 2.81 | 2.97 |
| AO (g-buffer, AO, denoise, copy, blend) | 1.10 | 3.67 | 3.99 | 1.18 | 1.32 |
| rays (march, two blurs) | 0.14 | 0.31 | 0.28 | 0.37 | 0.44 |
| bloom (bright, five mips, composite, blend) | 0.27 | 0.72 | 0.70 | 0.71 | 0.79 |
| vignette (with the rays' composite) | 0.23 | 0.71 | 0.68 | 0.72 | 0.75 |
| output (tone mapping, dither, to the canvas) | 0.07 | 0.20 | 0.20 | 0.21 | 0.21 |
| + the sun's map redrawn (every frame) | +0.24 | +0.10 | +0.23 | +0.21 | +0.21 |
| + the fire's cube map redrawn | +0.88 | +0.06 | +0.17 | +0.19 | +0.20 |

The AO pass at 2560 in the hall: g-buffer 0.10, the AO itself 1.90 (3.08 at the shelves), denoise 0.54, three's copy
of the scene 0.54, the blend 0.44 (at the jetty the AO itself costs 0.03: everything is far, its samples lie close
together; indoors they spread over hundreds of pixels). Left out in turn in the hall at 2560 (`probe1`): without the
garden −1.06 ms (790 000 of the 1.1 million triangles), without the AO −3.65, without bloom −0.77, without the rays
−0.42, without the static furniture −3.36; with every material replaced by a plain one (MeshNormalMaterial) the frame
costs the same (8.73): the shading is not the cost, the filling of the multisampled buffers is.

Draw calls of one frame in the hall (high): scene 233, AO's normal pass 157, the sun's map and the fire's six cube
faces together 541 (when redrawn); 152 shader programs after the start.

CPU per frame (hall, high, 1584 × 861, `base1` cpu part, ms averaged over 60 frames): `World#frame` 5.8 median, of
which the composer 5.25: RenderPass 3.77 (the sun's and the fire's maps redrawn in a few of the frames), AO 1.29, bloom
0.10, rays 0.04; the world's own work 0.6 (wildlife 0.2, fauna 0.16, env 0.06, cat 0.04, the rest under 0.02 each).

Memory after the start (high, 1584 × 861): JS heap 139 MB used; 369 textures (about 289 MB with mip levels), 677
geometries (35 MB), 229 programs; render targets 297 MB: the composer's two buffers 78 MB each (half float, 4 samples,
with depth), the trees' map 32 MB, the sun's map 32 MB, the AO's three buffers 36 MB, the side-cover atlas 18 MB, the
rays' four buffers 10 MB, bloom 7 MB.

Startup (`startup-base` cold, `startup-base-warm` with the same data folder, so with Chromium's shader cache filled;
ms from the page's start): cold: `window.__app` at 1140, the world built at 11518, the start menu's button at 11870;
warm: built at 8753, the menu at 8870. The build itself 9769 ms cold and 7144 warm: layout 5, structure 533,
**placements 4640** (the procedural textures of the rooms painted on the main thread: 57 pictures, 4752 ms in all, the
value noise closure alone 2.9 s of the profile), shelves 148, environment 60, batch 26, **warm-up 4350 cold / 1713
warm** (the shader programs: `getProgramInfoLog` 4187 ms of self time in the cold profile, the link of 92 programs
under ANGLE; the disk cache halves it). "Bücherei betreten": the fade gone after 114 ms, the menu after 378, the next
frame drawn after 485. The library (61 books) indexed and the shelves at rest 46 s after the start (cold) and 10 s
(warm, the index kept).

Panels (`panels-base`, median of 3 opens, ms): mounted / two frames drawn / closed: menu 1.1 / 11 / 17, settings 1.6 /
11 / 13, basket 1.1 / 11 / 15, book card 1.6 / 11 / 17, records 1.5 / 10 / 14, computer 5.9 / 11 / 19, catalogue 2.3 /
32 / 27, search 2.4 / 11 / 17, world map 20 / 47 / 13, chess 4.1 / 10 / 16, watercolour 35 / 39 / 17, audiobooks 1.5 /
10 / 16, gallery 1.6 / 11 / 14. The first open of each is slower by its import and layout (settings 77, computer 84,
chess 118, world map 142, watercolour 72); no long task anywhere; the world's frame behind a panel 4.1 ms. Nothing to
win here worth a change.

## Changes

### 1. The post-processing chain without multisampling (world.js `#setupPost`, `SoftAO`, `#renderComposed`; godrays.js)

Finding: only the scene needs the multisampled buffer, but the composer's second buffer was multisampled as well, so
every full-screen pass after the scene wrote all four samples of every pixel and three.js resolved them again
afterwards: the AO's copy of the scene (0.54 ms at 2560 × 1391), its blend (0.44), the bloom's blend, the vignette
(0.71), each a 2560 × 1391 picture copied for 0.1 ms worth of arithmetic. Now:
* `renderTarget1` stays multisampled (4 samples on high, 2 on medium) and holds the scene with its depth; `renderTarget2`
  is a plain half-float buffer without depth; every frame starts with the same buffers (`#renderComposed`: the
  passes swap them as they go, and the output pass no longer swaps).
* `SoftAO` writes the AO and its denoised copy into one-channel buffers (R16F: the same values as the four-channel
  ones held; the denoise weighs `a.r` instead of the luminance of (ao, ao, ao), which is the same number) and
  darkens the resolved scene into the plain buffer with one pass (`scene × mix(1, ao, 0.8)`, the same arithmetic as
  three's copy + multiply blend, in fp32 instead of fp16 blending). three's own output stays available for the debug
  outputs of `ao-debug` and `ao-tune`.
* Without the AO (medium) a copy pass (`resolve`, three's CopyShader) resolves the scene into the plain buffer.
* The vignette and the warmth tint moved into the output pass (`mergeVignette`: the same formula before the tone
  mapping; the pass of its own and its fp16 round trip are gone), the rays' composite goes there too
  (`GodRays.mergeInto` knows the output shader's hook).
* The denoise's rotation noise is seeded (`#seededNoise`; three seeds it from `Math.random`, so the AO's fine speckle
  differed from start to start, which made the pictures of two starts differ by up to 2 % of the pixels).
Programs: 92 after the start (93 before): the vignette, the AO's copy and blend gone, the combine and the copy added
(both compiled in `#warmUp`, `#warmPost`); no program compiles later (perf-shots: 92 at every view and tier).
Memory: the second buffer 78 → 10 MB at 1584 × 861 (at 2560 × 1391 about 200 MB less).

GPU time per frame, ms, high tier (`base1` → `new1`):

| view, condition | 1584×861 before | after | 2560×1391 before | after |
|---|---:|---:|---:|---:|
| hall, day | 3.50 | 2.97 (passes part) | 8.90 | 6.67 |
| hall, night | 3.28 | | 8.49 | 6.27 |
| hall, golden hour | 3.47 | | 8.86 | 6.67 |
| book room, day | 2.93 | | 7.73 | 5.76 |
| book room, night | 2.81 | | 7.37 | 5.35 |
| at the shelves, day | 3.94 | 3.33 | 10.14 | 8.33 |
| terrace, day | 2.64 | 2.22 | 6.03 | 3.92 |
| terrace, night | 2.42 | | 5.57 | 3.48 |
| terrace, rain | 2.36 | | 5.46 | 3.37 |
| terrace, snow | 2.70 | | 5.97 | 4.14 |
| jetty, day | 2.42 | | 5.68 | 3.63 |
| jetty, night | 2.23 | | 5.15 | 3.26 |
| jetty, rain | 2.23 | | 5.24 | 3.25 |
| jetty, snow | 2.46 | | 5.62 | 4.20 |
| jetty, golden hour | 2.40 | 1.82 | 5.75 | 3.54 |
| glass front, day | 3.54 | | 7.73 | 6.44 |

Medium tier at 2560 × 1391: hall 3.79 → 2.94, book room 3.45 → 2.74, shelves 4.14 → 3.43, terrace 3.88 → 3.02,
jetty 3.78 → 2.94, glass front 4.18 → 3.34. The passes at 2560 (hall): AO 3.67 → 2.66, bloom 0.72 → 0.23, vignette
+ output 0.91 → 0.24. The low tier draws straight to the canvas and is unchanged.

The picture: medium and low pictures of the old and the new build are the same to the pixel where the scene is
still (room, shelves: 0 pixels differ; the sparkle of water, rain and snow differ between any two runs, under
0.1 % of the pixels). The high tier's AO had the random speckle described above, so its pictures differ between two
runs of the old build as much as between the old and the new (hall, day: 1.94 % of the pixels over 4 steps between
two old runs, 1.92 % old against new; the mean difference 0.37 against 0.39 of 255). With the seeded noise the new
build's pictures repeat (see the runs `shots-new3`, `shots-new4`).

### 1b. The bloom's glow added in the output pass (world.js `SoftBloom`, `mergeBloom`)

three's bloom ends with a full-screen additive blend of its composite onto the scene's buffer; without the AO
(medium) that buffer is the multisampled one, which then had to be resolved once more, and with the AO it was a
pass over the plain buffer. Now the bloom only composites its mips (`SoftBloom`, three's render without the last
step) and the output pass adds `bloom.texture` right where it reads the picture (the same addition, in fp32). The
copy pass that resolved the scene without the AO is gone with it: the output pass reads the scene's buffer itself
(three resolves it once). One pass and one program less in each tier. The bloom at 2560 × 1391: 0.23 → 0.16 ms
(`final` against `ab-gate`, passes part). Pictures `shots-final` against `shots-1b`: the same to 1 step except the
places that differ between any two runs (below); in the bright garden behind the glass about 1 % of the pixels
move by 1 or 2 steps, the rounding of the sum in half floats (three's blend) against single floats (the output pass).

### 2. The textures of the rooms kept and painted ahead (texture-paint.js, texture-store.js, texture-worker.js, textures.js, main.js)

Finding: 4.7 of the 9.8 s of the first build (and of the 7.1 s of a warm one) went into painting the 57 procedural
textures of the rooms on the main thread (value noise per pixel: the planks 548 ms, 17 kinds of wood 155 ms each,
rugs, marble, plaster, leather, brick, coffers, paint, fabric). They are the same at every start.
* `texture-paint.js` holds the painters as pure canvas work (the page's canvas or an OffscreenCanvas; no three.js),
  with a key per painting and its inverse (`keyOf`, `optsOf`); `textures.js` makes the three.js textures of the
  pictures (`make`: memory → the store → paint) with the same filters, wraps, colour spaces and anisotropy as before.
* `texture-store.js`: at the first start four workers (`texture-worker.js`) paint the standard set of 57 keys while
  the main thread loads the settings and the library; the pictures arrive as ImageBitmaps (transferred), the PNGs
  for the store follow from the same workers. Whatever is painted at a start (by the workers or, for a key outside
  the standard set, by the main thread) goes into IndexedDB `lesesaal-textures` in idle time a few seconds after the
  start (134 PNGs, 53 MB on disk), keyed with the hash of `texture-paint.js` that the build writes into the bundle;
  at the next start they are restored (`createImageBitmap` without colour-space conversion or premultiplication: the
  pictures are opaque and PNG lossless, so the pixels are the painted ones) before the world is made.
* main.js: `textureStore.start()` first, `await textureStore.ready()` before `new World()` (the floor asks for the
  boards at once), `settle()` 4 s after the start; `window.__app.textures` for the checks.
Browser and Android share it (the web bundle gets the worker and the hash too, `build/web.js`); without IndexedDB,
workers or OffscreenCanvas the main thread paints as before.

Start (ms from the page's start, `startup-tex3-*`; the warm-up of the shaders unchanged):

| | cold (empty profile) before | after | warm (second start) before | after |
|---|---:|---:|---:|---:|
| the world built | 11518 | 9440 | 8753 | 5605 |
| the start menu's button | 11870 | 9689 | 8870 | 5754 |
| build: placements | 4640 | 1036 | 4645 | 1001 |
| build: structure | 533 | 11 | 526 | 6 |
| build: warm-up (shaders) | 4350 | 4277 | 1713 | 2254 |

(In these two runs the boards' texture was still painted on the main thread, 550 ms, because the floor asks for it
in the World's constructor, before the build waited for the store; the wait moved in front of the constructor
afterwards, see the final table.) The standard set's painting in the workers took 2.4 s cold (the PNGs were encoded
before the pictures were sent; now they follow), restoring 131 pictures 1.46 s (overlapping the loading of the
library).

With the pictures sent before the PNGs are encoded (the workers keep their canvases until `settle()` asks; the
encoding took the processor from the shaders' compile and made the warm-up 6 s), and the wait for the store in front
of the World's constructor (`startup-tex5-*`):

| | cold before | after | warm before | after |
|---|---:|---:|---:|---:|
| the world built | 11518 | 7831 | 8753 | 4311 |
| the start menu's button | 11870 | 8114 | 8870 | 4428 |
| build: placements | 4640 | 960 | 4645 | 957 |
| build: warm-up (shaders) | 4350 | 4099 | 1713 | 1584 |
| the store: workers painted / restored | | 57 in 1296 ms | | 131 pictures in 530 ms |

The quick sketches of the frames (`ui/paintings.js`, fifteen 640 × 460 canvases drawn and JPEG-encoded on the main
thread at every start: 335 ms of drawing and 698 ms of `toDataURL` in the profile) are painted by the same workers and
kept in the same store (`sketch:<seed>:<motif>`), and the world takes them as pictures (`#applyPaintingTexture` with
`item.image`: a texture at once) instead of data URLs to decode; the proper watercolours replace them as before.

Traps on the way: a bitmap taken from a worker's canvas with `transferToImageBitmap()` lives on the graphics card,
and under ANGLE it never arrived in the page's WebGL context ("GL_INVALID_OPERATION: texture is not a shared image",
"invalid mailbox name"): 125 of 147 such textures were empty, the sofa, the rug and the fireplace black (run
`shots-cold`). The pictures restored from PNGs were whole. Now the worker makes its bitmaps from the pixels
(`getImageData` on a canvas with `willReadFrequently`, `createImageBitmap(imageData, { premultiplyAlpha: 'none',
colorSpaceConversion: 'none' })`, as the floor worker does), which reach the card as a plain upload. And WebGL
ignores three's `flipY` for a bitmap (a canvas is turned over at its upload, a bitmap is taken as it is: `texture-
orient` tried every way), so the bitmaps are made turned over (`imageOrientation: 'flipY'`, in the worker and when
restoring); `texture-pixels` compares every texture in the scene with a fresh painting of its key on the main thread:
all 131 pictures are the painted ones pixel for pixel, after a cold start (the workers) and after a warm one (the
PNGs), except the five rugs (corrected later: the check then printed its numbers without a verdict,
and the rugs' differed; see 2b).

The picture of the rooms after this change (`shots-base5` against `shots-final`, both from fresh data folders): the
same, except the rug of the book room, whose painted lines had their anti-aliased edges a little different (13 000
pixels by 2 steps, 150 by more than 4, at most 34, only along the lines): the base build painted it on the page's
canvas, the workers on an OffscreenCanvas, and Chromium rasterises the edge of a path on the two a little differently.

### 2b. The rugs painted on the main thread (texture-store.js `STANDARD`)

`texture-pixels` (with a verdict now: a bitmap must be the painting turned over, a canvas painted on the main thread
the painting as it is; textures keyed by other modules, the world map's, are skipped) found the five rugs of the
standard set differing from a fresh painting: 4 to 6 % of their pixels, up to 186 steps, along the lines of the
pattern, the edges of paths drawn by a worker's canvas (software) against the page's (on the graphics card). All other
textures are pixel arithmetic and were the same. The rugs left the standard set: the main thread paints them at a
first start as the base build did (473 ms for the five, `startup-rug-cold`: placements 1270 instead of about 800 ms)
and keeps them in the store, from where every later start restores exactly that painting. `texture-pixels` passes
after a cold and a warm start (128 textures), and the book room's pictures are the base build's to the step
(`shots-base7` against `shots-rug`, taken minutes apart: room by day and night on the low tier max 1, on the high tier
at night max 1). (The quick sketches of the frames stay with the workers: the base build showed them as JPEGs, so
they were never the same picture; now they are the canvas without the JPEG's loss.)

### 1c. Measured on the build of 1, 1b and 2 (the run `final`, e7963aa without 1b)

`verify-final` (smoke, godrays-check 24/24, hover-perf, gpu-perf, walls-check 20/20 and restart 2/2, world-check,
perf-panels, perf-startup cold and warm) all passed; `web-check` OK (20 checks). perf-matrix `final` against `base1`
in the table at the end.

### 3. The lamps only where they reach (world/light-loop.js)

Finding (`perf-draws`, GPU time of every draw call at 2560 × 1391): 1.4 ms of the 2.9 ms of the scene at the shelves
went to 14 draws of the bookcases, 0.6 ms in the hall to the three draws of the walls. Every lit shader loops over all
point lights of the house (some twenty) and evaluates the whole BRDF for each, also where a lamp's light has fallen
to nothing: three's `getPointLightInfo` multiplies its colour by `getDistanceAttenuation`, which is exactly 0 beyond
the light's `distance` (3.5 to 18 m here), and `RE_Direct` then adds `dotNL × 0 × BRDF`. Now `RE_Direct` runs only
when `directLight.visible` (three's own flag, colour != 0, with which it already skips the shadow lookup), for the
point lights and the spot light. Patched once into `THREE.ShaderChunk.lights_fragment_begin` before any program is
built; `materials.js` and `nature.js` import it first because they cut parts out of the chunk. Same programs, same
count (90 / 147 / 202 after the three tiers, as before); `?lampgate=0` leaves the chunk alone for comparisons.

A/B in alternating runs of the same bundle (`ab-gate`, two rounds each, `PM_HOLD=1`, GPU ms, medians):

| 2560 × 1391, high | without | with |
|---|---:|---:|
| hall, day | 6.56 | 5.98 |
| hall, night | 6.21 | 5.64 |
| book room, day | 5.68 | 5.13 |
| book room, night | 5.27 | 4.60 |
| shelves, day | 7.91 | 7.03 |
| shelves, night | 7.54 | 6.51 |
| terrace, day | 3.73 | 3.68 |
| passes, shelves: the scene | 3.65 | 2.53 |
| passes, hall: the scene | 3.22 | 2.69 |

(The native size and the low tier move by a few tenths either way between runs: frames of 1 to 2 ms, where the card's
clocks decide.) Pictures: `shots-gate0` (`?lampgate=0`) against `shots-gate1`: every picture the same to 1 step,
except those that differ between any two runs (the day views of the hall and the book room through the windows,
see the note on noise below).

The price: ANGLE's D3D compiler takes longer over the twenty branches. Cold starts (an empty profile, so Chromium's
cache of compiled programs is empty too; `gate-startup` and `loop-ab`, six starts each way, alternating): the shaders'
warm-up 4.0 to 4.7 s without the gate, 4.9 to 5.9 s with it, about 0.95 s more; warm starts (the programs from the
cache) the same (1.0 to 1.9 s either way). A first start after an update pays it once. A variant with only the
shadow-casting light unrolled and the other lamps in a real loop (one copy of the BRDF instead of twenty) drew as fast
but compiled no faster (5.1 to 6.2 s), and was dropped. Decided: the gate stays (every frame indoors against a second
once per version); `?lampgate=0` is the switch to compare.

### 4. The scene's depth resolved only for the rays (world.js `#renderComposed`)

three resolves the depth of the multisampled scene buffer with its colour (`blitFramebuffer` with the depth bit; under
ANGLE a shader pass over the whole buffer) because the rays read it. When the rays are off (night, rain, a low sun
behind clouds, the setting) nothing reads it: `renderTarget1.resolveDepthBuffer = godrays.active`. `perf-toggle` at
night, 2560 × 1391, five alternating rounds of 40 frames: hall 5.67 → 5.50, shelves 6.77 → 6.61, terrace 3.67 → 3.47 ms.
(Telling three not to keep the multisampled depth, `storeMultisampledDepthBuffer = false`, changed nothing on this
card and would make three invalidate the resolved depth the rays read; left out.)

### 5. The AO's normal pass grouped by the kind of object (world.js `SoftAO._renderOverride`, `byKind`)

The normal pass draws every opaque thing with one material; three looks its program up again (parameters, key,
uniform list) whenever the kind of object changes (plain, instanced, instanced with colours, batched), which in
three's order (by the things' own materials) happened some thirty times a frame in the hall. Sorted by kind before
the material (`renderer.setOpaqueSort` for that pass only) the kinds change three times. The depth test decides what
is seen, so normals and depth are the same (pictures of the high tier the same, `shots-b2`).

### 6. Transparent things seen from both sides as two meshes (world/two-sided.js)

Finding (`perf-cpu`, counts of one frame): three draws a transparent double-sided material in two passes, back faces
and then front faces, and sets `needsUpdate` before each, so every frame, for every such thing in view, it computes
the program's parameters and key twice, builds the uniform list anew and uploads every uniform: about 40 µs a pass
on the test machine. In the hall four panes of glass were drawn that way, at day on the low tier the light shafts of
the windows, in rain the drops and splashes, at night the fire's flames, with a film the projector's beam.
`twoSided(mesh)` gives the mesh a back-side copy of its material and adds a child with a front-side copy: three's own
two programs (its key for a pass is the key of a material with that side), the same order (the child stands where
the mesh stands, at the same distance, with a later id: three's order of transparent things puts it right after),
the same uniform objects (a shader material's copies share them; the shafts' opacity is copied each frame), the
shadow side kept, rays find only the mesh. Used for the glass (windows, the glazing of the hall, the doors), the
shafts, the hall's fire, the rain and its splashes, the beam (the fire bowl's instanced flames stay as they were).
After it no material changes its version during a frame and no mesh is drawn in two passes (`perf-cpu`
`drawnTwice: []`); the programs are the same (90 / 147 / 202).

CPU of `World#frame`, profiled over 300 frames, the base build (integ/0.9) and the build of this strand run one after
the other (`cpu-base-*`, `cpu-new-*` in final2; the profiler's sum, ms per frame; three's program look-ups and
uniform uploads inside it):

| 1584 × 861 | low: base | new | look-ups | uploads | high: base | new | look-ups |
|---|---:|---:|---:|---:|---:|---:|---:|
| hall | 2.29 | 2.25 | 0.11 → 0.04 | 0.44 → 0.41 | 3.42 | 3.26 | 0.11 → 0.06 |
| shelves | 1.33 | 1.24 | 0.07 → 0 | 0.24 → 0.19 | 2.37 | 2.05 | 0.05 → 0.04 |
| terrace | 1.72 | 1.44 | 0.07 → 0 | 0.32 → 0.26 | 2.33 | 2.14 | 0.04 → 0.01 |
| jetty | 0.92 | 0.95 | 0.03 → 0 | 0.14 → 0.15 | 1.89 | 1.52 | 0.04 → 0.02 |
| glass front | 2.03 | 1.77 | 0.12 → 0 | 0.45 → 0.38 | 3.50 | 3.03 | 0.13 → 0.09 |

(The remaining look-ups in the hall were the cat: its body and its instanced legs and tail shared one material; they
have a copy of it since, cat.js. Two runs of the same build at different hours differ by more than these columns in
the views with the sun in them: the shafts of the windows on the low tier come and go with the sun's direction. The
comparison is the one made at the same time.)

### 7. The koi's warm-up fish (koi.js)

The pond makes all ten fish at once, so `#draw` never had a free instance for the warm-up fish (`n < N` was always
false): `prewarmAgain()` (called by fauna.js when the render path changes) did nothing, and the koi's program met its
vertex layout only when the first fish came into sight. The mesh has one instance more now.

### 8. Two noise loops of the start (nature.js `tileNoise`, texture-paint.js `paperGrain`)

The profile of a warm start (`startup-final-warm`, the textures of the rooms restored) still had 190 ms in the paper
grain of the newspaper rack's nine front pages (two octaves of value noise per pixel, 1.8 million pixels) and 60 ms
in the tileable noise of the garden (the sky's, water's and ground's noise texture, the bark). Both worked out the
cell and the eased fraction of their noise per pixel and octave; now per column and row, once per octave, with the
same expressions in the same order. The results are the same to the bit (two throwaway
tests: ten sizes and seeds of each, old against new, every value equal), the loops 4 and 10 times
faster (60 → 14 ms, 165 → 16 ms in Node). (texture-paint.js has a new hash with it: the stored textures of the rooms
are painted once more at the next start.)

### Noise between two runs of the pictures

`perf-shots` fixes the world's clocks, but something still follows the wall clock (where exactly was not looked
for; the differences sit in the garden and in the sunlight it lets through): the day views through the windows (the garden, the dappled sunlight on the walls and the
floor, the rays' edges) differ between two runs of the same build by up to some 4000 pixels over 4 steps, more the
longer apart the runs are; a dozen pixels at the left edge of the terrace, 700 at the left edge of the shelves and
about 100 in the middle of the hall on the low tier differ between any two runs as well. Every comparison above was
made against a run of the build before, the same day, with these places known; the night pictures, rain and snow,
the jetty and the book room at night repeat to 1 step.

## Before and after (final2 and final3)

The base is integ/0.9 at 0d49523 with only the seeded AO noise added (a second checkout, so that its
pictures repeat), the new build `wip/perf` at 9d418c8 (all changes above except the cat's material copy). Every
number from runs of the two alternating, on the quiet card (0 % other load before and after; no other instance of the
app running), library testbooks4, window 1600 × 900 (drawing buffer 1584 × 861) and the emulated 2560 × 1391.

GPU time per frame, ms, median of 2 × 60 frames back to back (2560) and of 2 × 120 frames after 300 frames of warm-up
(1584: frames of 1 to 2 ms let the card's clocks drop between measurements, `PM_WARM`), no shadow map redrawn during
the measured frames (`PM_HOLD=1`; a redraw adds 0.1 to 0.2 ms to its frame once a second):

| view, condition | high 1584 base | new | high 2560 base | new | medium 1584 base | new | medium 2560 base | new | low 1584 base | new | low 2560 base | new |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| hall, day | 3.45 | 2.58 | 8.82 | 5.84 | 1.90 | 1.76 | 3.75 | 2.68 | 2.30 | 1.50 | 1.77 | 1.87 |
| hall, night | 3.27 | 2.38 | 8.43 | 5.51 | 1.79 | 1.70 | 3.57 | 2.31 | 1.49 | 1.51 | 1.66 | 1.65 |
| hall, golden hour | 3.43 | 2.51 | 8.78 | 5.85 | 1.80 | 1.81 | 3.67 | 2.56 | 1.58 | 1.45 | 1.57 | 1.61 |
| book room, day | 2.87 | 1.91 | 7.68 | 4.97 | 2.17 | 1.12 | 3.44 | 2.06 | 1.02 | 0.91 | 1.53 | 1.23 |
| book room, night | 2.73 | 1.74 | 7.15 | 4.51 | 1.45 | 1.07 | 3.33 | 1.82 | 0.90 | 0.87 | 1.45 | 1.24 |
| at the shelves, day | 3.96 | 2.80 | 10.09 | 6.86 | 1.81 | 1.18 | 4.14 | 2.56 | 1.06 | 0.88 | 1.92 | 1.55 |
| terrace, day | 2.60 | 1.81 | 6.03 | 3.79 | 1.78 | 1.33 | 3.91 | 2.77 | 1.23 | 1.09 | 1.99 | 1.98 |
| terrace, night | 2.38 | 1.70 | 5.53 | 3.27 | 1.69 | 1.28 | 3.77 | 2.59 | 1.29 | 1.24 | 2.18 | 2.02 |
| terrace, rain | 2.33 | 1.82 | 5.42 | 3.14 | 1.66 | 1.28 | 3.83 | 2.46 | 1.22 | 1.59 | 1.83 | 1.97 |
| terrace, snow | 2.69 | 1.97 | 5.92 | 4.01 | 1.85 | 1.55 | 3.92 | 3.01 | 1.31 | 1.24 | 2.44 | 2.12 |
| jetty, day | 2.40 | 1.65 | 5.65 | 3.45 | 1.62 | 1.25 | 3.78 | 2.66 | 1.08 | 1.03 | 1.80 | 1.79 |
| jetty, night | 2.17 | 1.45 | 5.14 | 3.01 | 1.62 | 1.22 | 3.63 | 2.54 | 1.20 | 1.05 | 2.02 | 2.00 |
| jetty, rain | 2.20 | 1.44 | 5.24 | 3.01 | 1.62 | 1.22 | 3.71 | 2.54 | 1.19 | 1.04 | 2.18 | 2.21 |
| jetty, snow | 2.43 | 1.72 | 5.62 | 3.67 | 1.64 | 1.31 | 3.73 | 2.80 | 1.13 | 1.08 | 1.93 | 2.12 |
| jetty, golden hour | 2.39 | 1.64 | 5.54 | 3.42 | 1.62 | 1.26 | 3.70 | 2.67 | 1.10 | 1.04 | 2.09 | 2.00 |
| garden through the glass front | 3.48 | 2.89 | 8.39 | 5.67 | 1.97 | 1.66 | 4.17 | 2.88 | 1.67 | 1.48 | 2.03 | 2.01 |

So: high 30 to 43 % less at 2560, 17 to 36 % at 1584; medium 23 to 45 % at 2560, 0 to 48 % at 1584; low (no
composer: only the lamp gate and the twins touch it) 10 to 20 % less in the rooms, the same outside. The low column at
1584 still moves by a few tenths between runs in single cells (hall day 2.30 → 1.50, terrace rain 1.22 → 1.59: one run
of the two each time, animals in view or the card's clock).

Where the frame goes now (high, 2560 × 1391, the passes part of final2, ms): hall: scene 2.72 (3.20 before), AO 2.62
(3.66), rays 0.32 (0.31), bloom 0.16 (0.72), the vignette pass gone (0.71), output 0.23 (0.20); shelves: scene 2.54
(3.66), AO 3.87 (4.95).

CPU of `World#frame`: the table of section 6 (high 5 to 20 % less, low up to 16 %).

Start (ms from the page's start, perf-startup, two runs of each; cold = a fresh profile, warm = the second start):

| | cold base | new | warm base | new |
|---|---:|---:|---:|---:|
| the world built (first frame) | 11288, 11347 | 7975, 8800 | 8295, 8723 | 3895, 5706 |
| the start menu's button | 11628, 11661 | 8263, 9075 | 8392, 8775 | 3992, 5804 |
| build: placements | 4365, 4677 | 785, 826 | 4322, 4403 | 769, 774 |
| build: structure | 496, 534 | 6, 5 | 562, 547 | 5, 7 |
| build: shader warm-up | 4339, 4188 | 4838, 5564 | 1637, 2009 | 1755, 3441 |
| "Bücherei betreten": the next frame (ms after the click) | 360, 361 | 464, 368 | 514, 507 | 562, 518 |
| the library indexed | 45640, 45572 | 47996, 48541 | 9628, 10036 | 5288, 7051 |

(The warm-up varies by a second or more between runs of the same build; `loop-ab` and `gate-startup` with six cold
and six warm starts of one build put the lamp gate's share at 0.95 s of a cold start and nothing of a warm one. The
library is indexed some 2 s later at a first start: the four texture workers share the processor with the indexer
then; at a warm start 3 to 4 s earlier.)

Memory (high, 1584 × 861, after the start): render targets 296 → 229 MB by the estimate of perf-matrix (the composer's
second buffer 78 → 10 MB; the AO's two buffers are one channel now, which the estimate does not count: 10.4 → 2.6 MB
each; at 2560 × 1391 the second buffer alone is some 185 MB less); textures 289 MB, geometries 35 MB, unchanged; the
JS heap after the start 128 to 165 MB in base runs, 133 to 224 MB in new ones (the stored textures as bitmaps until
`settle()` releases them, and when the garbage is collected); programs after the three tiers 229 → 226, 93 → 90 after
the start.

Panels: as before (`panels-new2`: every panel mounted in 1 to 6 ms, the world map 14 ms and the watercolour 33 ms,
two frames drawn after 10 to 11 ms, the world map 49 ms; no long task except one of 56 ms at the world map's first
open in one of three rounds).

Pictures: `shots-base6` against `shots-new6` and `shots-new6` against `shots-new7`: the same to 1
step except the rug of the book room (the canvas, section 2) and the places that differ between any two runs.

## Checks on the final build

`npm test` passed (unit tests, geometry, floors, package, privacy). The world's checks one after the other on the
quiet card, all passed: smoke, world-check, flow-check, stress-check, cat-check, cat-views,
books-check, side-cover-check (both libraries), peek-card-check, hover-perf (and warm), controls-check,
interior-check, interior2-check (and restart), rebuild-seated-check, rebuild-stall-check, overlap-audit, easel-check
(and restart), room-views, outdoor-check, outdoor2-check (31/31), weather-check, sky-check 41/41, godrays-check
24/24, wildlife-check, window-check, feeder-check, flee-check, winter-check 39/39, hud-check 67/67, wheel-check
21/21, walls-check 20/20 (and restart), theme-check, firststart-check (three phases), gpu-recovery-check 9/9,
shelves-check 42/42, shelves-perf, look-state, cinema-check, cinema-real, cinema-perf-check 17/17, worldmap-check
81/81, hidden-check, gpu-perf, texture-orient; the browser version: `npm run build:web`, `web-check` OK (20) and with
the file input OK (21). Not passing at first, and why:
* **fauna-check**, "with them the whole frame takes under 1 ms more on the graphics card": the check timed one frame
  at a time and waited for each query; with the lighter frames the card's clocks dropped between them (the terrace's
  2 ms frame measured 12.9 ms, the animals' 0.05 ms with it over 1 ms). Measured back to back (`perf-toggle`, fauna on
  and off): 0.05 ms in the base build, 0.08 ms in this one. The check now draws two frames without a query before
  each timed one (fauna-check.js); it passes (terrace 2.0 ms, the animals 0.1 ms). "At dusk a barn owl glides by
  within ten minutes" failed in two of four runs of this build and passed in the base's two: the owl is drawn by
  chance (seen after 24 to 460 simulated seconds in the passing runs), nothing here touches the birds.
* **cinema-perf-check**, the proof that the measurement would see the stall of 0.6: the re-enacted stall waits for
  the card's frame, a third shorter now (99 % at 9.6 ms instead of over 10); its threshold is 5 ms now
  (cinema-perf-check.js, with the reason in a comment).
* **texture-pixels**: the rugs (2b), and the world map's texture, which is keyed by another module (skipped now).
* outdoor2-check failed once by 0.3 ms (standing p95 8.3 ms against 8) and passed afterwards; the base build failed it
  the same way (8.4 ms) in one of two runs.
The Android app was not built or run: nothing Android-specific changed, and its WebView runs the web bundle whose
check passed.
After the rugs' change (2b), on the very last bundle: smoke, world-check, firststart-check (three phases), `build:web`
and `web-check` again, all passed.

## Open

* **The AO is now the largest part of a frame indoors** (2.6 ms in the hall, 2.9 to 3.9 ms at the shelves at 2560 ×
  1391): 24 depth reads per pixel spread over hundreds of pixels near a wall (texture cache misses), and the denoise's
  37 reads per pixel. Cheaper only with a different picture (half resolution, fewer samples, a depth pyramid), which
  this strand does not do.
* **Shadow map redraws, CPU**: in a frame that redraws the sun's map and the fire's cube map, three's shared depth
  materials change between plain and instanced things about twenty times (the books, the stones, the shelf decor),
  each a program look-up of some 40 µs, about 0.8 ms in that frame (once a second; `perf-cpu PC_SHADOWS=1` counts
  them). Fixable with a `customDepthMaterial` / `customDistanceMaterial` per kind of instanced thing, but the depth
  programs then depend on the map each first meets (three does not recompile its depth materials when the map comes
  and goes): new programs to warm, left for now.
* **The fire bowl's flames and smoke** are instanced and still drawn in three's two passes (two-sided.js leaves
  instanced meshes alone): at night by the fire bowl only.
* **Matrices**: `updateMatrixWorld` costs 0.25 to 0.4 ms of every frame (1290 objects, all with `matrixAutoUpdate`,
  460 of them hidden: the furniture merged into the batch). Freezing the matrices of things that never move would
  save most of it, but which things never move is not written down anywhere; left out.
* **Uniform uploads**: three uploads every uniform of a material when the material changes (100 to 180 times a
  frame): 0.2 to 0.45 ms. Fewer distinct materials would help (a content change).
* **Start**: the shaders' compile is 4.2 s of a first start and 1.2 s of a warm one (ANGLE's D3D compiler; the warm
  one mostly waits for the cached programs to link). The foliage of the trees (100 ms) is drawn with canvas paths on
  the main thread; a worker's canvas rasterises paths a little differently (the rug, section 2), so it stays.
* **Noise between runs of the pictures**: some of the garden and the sunlight it lets through follows the wall clock
  in perf-shots (section "Noise"); finding what would make day pictures repeat exactly.
