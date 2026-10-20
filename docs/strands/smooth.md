# Strand "smooth": smoother light shafts and other roughness in the world

Branch `wip/smooth`. Goal: the god rays through the foliage (and the rest of the world)
smoother, without losing image quality and without a noticeable rise in GPU time.

## How it is measured

`build/scripts/smooth-probe.js` (new). At fixed views in the golden hour the world is drawn for 12 frames with a fixed
step of time (1/60 s: the leaves sway, the dust drifts), each frame once with the rays and once more without at the
same instant (the pass's state left alone, nothing added to the picture). The rays' share is `on − off` of the linear
picture before tone mapping (the vignette off), so the numbers do not depend on the sky's brightness. Relative to the
mean share:

* `flick`: mean change of the share from one frame to the next (includes what moves with right: reeds and leaves)
* `still`: the same over the pixels whose picture without rays did not change (0.5 %): flicker where nothing moved
* `turn`: the same while the view turns 2 px per frame at the centre, the last frame reprojected exactly (a turn in
  place leaves the rays the same for every direction), so what is left is crawl, not motion
* `lowFlick`: the change of the rays' own low-resolution buffer; `rough`: fine detail of the share where the picture
  is smooth; `flick8`: the change of the 8-bit share (what the eye sees, with the sway)

Run: `SM_TIER=high SM_VIEWS=jetty,meadow,hall,south,shore node build/screenshot.js smooth-probe` with the usual
`COZYSHELVES_USERDATA`, `COZYSHELVES_BOOKS` and `SHOT_DIR` (`SM_EMU=2560x1440` for that size of drawing buffer,
`SM_FROZEN=1` for a still scene, `SM_REGION` for a part of the picture, `SM_DUMP` for raw low-buffer values). Pictures per view: the window, the share (×4), its change
between two frames, the low buffer and its change. GPU time: `GR_PARTS=perf PERF_EMU=2560x1440 node build/screenshot.js
godrays-check`, runs alternated old/new (medians of several runs, the card may be busy with other work).

The pictures and metrics of a run go to `SHOT_DIR` (`sm-<tier>-<view>-<static|turn>-<share|change|low|lowchange|on0..2>.png`,
`sm-<tier>-metrics.json`).

## What made the rays rough (findings)

1. **The rays were marched from where the eye stood a frame ago.** `GodRays#beforeRender` read `camera.matrixWorld`,
   which the renderer brings up to date only when it draws (`player.update` sets position and rotation but does not
   compose the matrix). Whenever the view moved, the rays lagged the picture by one frame and swam against the leaves
   (`godrays.js`, beforeRender: `cam.updateMatrixWorld()` now).
2. **One depth per low pixel.** The march read the full-resolution depth at one point of its 2 × 2 (high) or 4 × 4
   (medium) block; a reed, a twig or a leaf edge in the block made that depth flip between the thing and what lies
   behind it as it swayed or as the view moved, and the composite then chose, per full pixel, between a bilinear value
   and four depth-weighted taps (a hard switch). The result: light bleeding over leaf edges, speckle at reeds and
   crowns, crawl at every edge when turning. Now every low pixel keeps the light up to the nearest and up to the
   farthest surface of its block (two layers, `vec4(far, dFar, near, dNear)`), and the composite reads each of its
   four low pixels at the full pixel's own depth between the two layers (`grLayer`), weighted by how far the depth lies
   outside what the low pixel spans.
3. **A hashed dither with lines.** The step jitter was interleaved gradient noise, which has a strong diagonal
   structure that a radius-4 blur does not remove. Now a 64 × 64 blue-noise tile (`app/src/world/bluenoise.js`,
   written by `build/bluenoise.js`), moved on by the golden ratio each frame; the same tile replaces the hashed dither
   at the edge of the trees' half-shadow in the stamp.
4. **No memory between frames.** Each frame stood alone: a redrawn shadow map popped, the jitter could not average.
   Now the second blur pass blends with the last frame's result where the same surfaces stood (reprojected by depth,
   both layers, taken only where the history saw the same depth: `grHistory`), `uBlend` 0.85.

Not a cause: the diagonal arcs in the sky of the 8-bit share pictures are the 8-bit quantization of two smooth
gradients (on and off) beating against each other; the linear rays buffer there is a clean gradient (dump checked).

## Numbers (1600 × 900, high tier, 12 frames; relative to the mean share)

`still` = flicker where nothing moved, `turn still` = crawl when turning (exactly reprojected), lower is better.

| view   | old static still | new static still | old turn still | new turn still | old turn lowFlick | new turn lowFlick |
|--------|-----------------:|-----------------:|---------------:|---------------:|------------------:|------------------:|
| jetty  | 0.0005 | 0.0003 | 0.0009 | 0.0008 | 0.0138 | 0.0136 |
| meadow | 0.0006 | 0.0006 | 0.0058 | 0.0015 | 0.0205 | 0.0159 |
| hall   | 0.0005 | 0.0007 | 0.0029 | 0.0013 | 0.0232 | 0.0202 |
| south  | 0.0004 | 0.0006 | 0.0038 | 0.0010 | 0.0108 | 0.0066 |
| shore  | 0.0007 | 0.0007 | 0.0078 | 0.0014 | 0.0231 | 0.0156 |

(runs `base3-high` and `new5-high`; `uBlend` 0.9. With 0.85 the static still was about twice the old one, the
jitter's residue; at 0.9 it is level with the old code, and the crawl when turning is 2 to 5 times smaller.)

Medium tier (a quarter of the resolution, 16 steps; runs `base3-medium`, `new5-medium`):

| view   | old static still | new static still | old turn still | new turn still | old turn lowFlick | new turn lowFlick |
|--------|-----------------:|-----------------:|---------------:|---------------:|------------------:|------------------:|
| jetty  | 0.0012 | 0.0018 | 0.0109 | 0.0027 | 0.0378 | 0.0235 |
| meadow | 0.0008 | 0.0010 | 0.0104 | 0.0025 | 0.0330 | 0.0224 |
| hall   | 0.0006 | 0.0014 | 0.0067 | 0.0023 | 0.0255 | 0.0169 |
| south  | 0.0005 | 0.0012 | 0.0074 | 0.0023 | 0.0225 | 0.0124 |
| shore  | 0.0008 | 0.0012 | 0.0135 | 0.0029 | 0.0310 | 0.0179 |

The `godrays-check` (all parts) passes with the new code (22 of 23; the GPU line was measured with the card 57 % busy
with other work, see the A/B runs below); no shader is compiled after the warm-up (204 programs as before).

## GPU time (godrays-check, GR_PARTS=perf, PERF_EMU=2560x1440, high tier)

`pass` = a whole frame with the rays minus one without (median of 60 pairs), `alone` = a timer query round the march
and the blur (median of 40), in ms at 2560 × 1391. Old (A: godrays.js and world.js from main) and new (B) in turn,
on an idle card (0 to 9 % other load, runs `perf-A1`, `perf-B1`, `perf-A2`, `perf-B2`); the two
rounds agree within 0.01 ms.

| view    | old pass | new pass | old alone | new alone | frame (off) |
|---------|---------:|---------:|----------:|----------:|------------:|
| hall    | 0.365 | 0.399 | 0.274 | 0.305 | 8.7 |
| south   | 0.364 | 0.401 | 0.293 | 0.326 | 8.8 |
| terrace | 0.375 | 0.432 | 0.368 | 0.406 | 5.9 |
| jetty   | 0.338 | 0.396 | 0.307 | 0.348 | 5.5 |

The new pass costs 0.03 to 0.06 ms more per frame (a tenth of the pass, under 1 % of the frame; the budget of the
check is 1.45 ms at this size). The extra work: four depth reads per low pixel, the second layer in the blur, one or
two history reads with a reprojection in the second blur pass, and the composite's four-tap path on more pixels (every
block with an edge in it). An earlier set of rounds with the card 51 to 63 % busy with other work was unusable: the old
code's `alone` was bimodal (0.31 or 0.9 ms for the same view) as outside work landed inside the timer windows.

## Also done

* The output pass dithers its 8-bit rounding with the blue-noise tile (`ditherOutput` in world.js): the dusk sky
  stepped every 3 to 4 pixels along a column (seen in contrast-stretched crops), and
  the haze along a shaft is as smooth a gradient. Half a step of noise, no visible grain, one texture read per pixel.

## The rest of the world: where the picture itself crawls (survey)

`SM_FROZEN=1` (time still) and the view turning 2 px a frame, the picture without rays reprojected exactly: what is
left is the shimmer of edges and the sparkle of highlights, relative to the mean of the picture, per frame (run
`scene2-frozen`, pictures `sm-high-<view>-turn-scene.png`):

| view   | whole | lower right (lake, grass) |
|--------|------:|--------------------------:|
| jetty  | 0.047 | 0.065 |
| shore  | 0.039 | 0.062 |
| meadow | 0.045 | 0.095 |
| hall   | 0.019 | 0.007 |
| south  | 0.016 | 0.014 |

Outdoors the picture crawls two to three times more than indoors; the pictures put it at the backlit crowns against
the bright sky (the silhouettes of the leaves), the reeds and the grass (thin geometry), not at the water. Part of
that is the floor of the measure itself (a sharp edge moved 2 px and resampled bilinearly differs from the one drawn
anew), so these numbers only rank the places; none of it was changed in this strand. The rays, for comparison, crawl
by 0.001 to 0.002 of their mean now (the `turn still` numbers above).

Animals, weather and light all advance with `dt` (koi, birds, frogs, the cat, the weather blends of sky-state.js, the
rays' fade of 2.5/s), no stepped timers were found in the code; the trees morph over a band of distance before their
templates swap (trees.js), the sun's shadow frustum moves in whole texels (environment.js).

## Open

* The GPU rounds cover the high tier (the check's perf part sets quality high); medium runs at a quarter of the
  resolution with the same extra work per low pixel, so its rise is smaller still, not measured separately.
* Foliage silhouettes against the sky and the reeds crawl most when the view turns (the survey above); a measure with
  a supersampled reference would be needed before changing the alpha-to-coverage edge or the grass.
* The water's glint (`pow(sp, 900 - 700 * uWind)` in water.js) is a candidate for sparkle in a calm golden hour, not
  seen in the survey's region numbers; untouched.
* The history is bilinear at the previous position, so at an edge whose depth the history does not match the blend
  falls back to the frame's own value (a touch more jitter residue along silhouettes); a four-tap depth-weighted
  history fetch would take that out at one more read per low pixel.
