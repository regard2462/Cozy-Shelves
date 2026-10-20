# Strand: bug hunt in the 3D world (`wip/bugs-world`)

Scope: `app/src/world/**`, `app/src/audio/**`, `app/src/input/**` and the world-related parts of `app/src/main.js`
(world setup, GPU recovery, places, wheel and teleport glue). Other strands: UI panels, the main process, visual
smoothness of effects, the browser version.

Branch `wip/bugs-world` (from `main` = 0.8.0). The harness checks ran one after the other, each with its own data
folder.

## Plan
1. Read every module of the scope systematically (done: world, audio, input, main.js glue; in a second pass the
   GLSL-heavy modules and the model builders as well, see below; godrays.js is the smoothness strand's).
2. Run the existing checks of the area on the unchanged code as a baseline.
3. Reproduce every suspected defect (a check, a page.evaluate), fix it minimally, verify, add a regression check.
4. Keep this document current; commit small; push after every step.

## Baseline (unchanged code, library testbooks4, other checks running at the same time)
controls-check 68/0 · rebuild-seated-check 3/0 · rebuild-stall-check 7/0 · world-check (sweep, no PASS lines) ·
wheel-check 21/21 · sound-check 71/0 · gpu-recovery-check 9/0 · cat-check 30/0.
The unfixed code against the new `world-bugs-check`: 5/6 (the six expected failures).

## Fixed build (other checks ran at the same time)
world-bugs-check 11/0 (testbooks4) and 11/0 (`lib-generic`, 784 books, 15 places, 26 seats) · rebuild-seated-check 3/0 ·
controls-check 68/0 · sound-check 71/0 · fauna-check 24/0 · cat-check 30/0 · controller-check 86/86 ·
world-edge-check 8/0 (testbooks4, new; see below) · fallback-check on `lib-generic`: first start 12/0 with the new
seated-switch section (the sofa keeps the reader seated, `dy` 0, no glide, no sitting sound; the nook `nook0` stands
elsewhere in the other room and the reader stands up at 1.62 m), restart 2/0.
Two things about `fallback-check` on the big library: 784 books fill 33 cases and still fit the walls of 0.8.0, so the
check inflates the library (six copies, 8 cases of Geschichte with 582 books in the room); the copies now carry
`hasCover: false`, because a cover request for an id the main process does not know (`main.js idFromUrl`) is answered
with 400 and the check's error count saw 34 of them (a check artefact, the same on main).

## Bugs found and fixed
1. **`world-actions.js` `returnAll()`: the decision whether the books fly back was taken per book.** `returnBook`
   takes each book out of the basket, so `this.basket.length < 6` became true for the last five books of a full
   basket: with eight books the first three went back silently and the last five flew. Fixed: one decision for the whole
   basket. Check: `world-bugs-check` (eight books: no animation; five books: five animations).
2. **`audio/soundscape.js` `weatherOf()` and `world/fauna.js` `weatherNow()`: a trace of thunder or snow counted as a
   storm or snowfall.** The weather mix is continuous and eases out over minutes (`sky-state.js` EASE: thunder 25 s,
   snow 60 s to 1/e; a part reaches 1e-4 only after ~4 and ~9 minutes). `!!ws.thunder` and `!!ws.snow` were true for a
   value of 0.001, so after a storm had passed (phase `clearing`) the songbirds, the owl, the frogs and the garden's birds
   stayed silent and in storm or snow mode for minutes while the sky showed a clear weather. Fixed with the thresholds of
   `nameOfMix` (thunder > 0.5, snow > 0.15). Check: `world-bugs-check` (mix with thunder 0.01 and snow 0.02: the soundscape
   reports no storm and no snowfall, `fauna.weatherNow()` says `clear`, the songbirds sing).
3. **`world/cat.js` `dispose()`: the instance buffers of the legs and the tail stayed on the graphics card.** Every rebuild
   of the world makes a new cat and disposes the old one; three.js frees an `instanceMatrix` buffer only through
   `InstancedMesh.dispose()`, which the cat never called (world.js `disposeTree` does it for the static parts). Three
   small GPU buffers per rebuild. Fixed. Check: `world-bugs-check` counts `gl.deleteBuffer` during `dispose()` of a test
   cat after its geometries were freed by hand: exactly its three instanced meshes.
4. **`main.js` `onLibraryUpdate()`: a library update that left the shelves as they were kept `world.library` on the state
   of the first build.** Only `world.booksById` took the new records. `refreshDisplayTable` reads `world.library.books`
   (the stale borrowed flags decided the recommendations) and `build()` compares the state object with `this.library`.
   Fixed: the world takes the new state too. Check: `world-bugs-check` (after `library:rescan`, `world.library ===
   state.library`).
5. **`world.js` `setDepartment()` (the book room with one department at a time, a library too big for the walls): a
   seated reader was put back at standing height and glided down into the seat again, with the sound of sitting down.**
   `setDepartment` had its own copy of the rebuild logic (setPose, then `sit()` again) instead of `#rebuildInPlace`,
   which keeps a seated reader seated (the fix of rebuild-seated-check never reached this path). A seat that the new
   layout does not have at the same place (a reading nook of the book room moves with the cases, its number stays)
   left the reader seated in the air. Fixed: `setDepartment` uses `#rebuildInPlace(opts)`; a seat gone or moved makes
   the reader stand up where it stood. Check: `fallback-check` (new section "seated through the switch": the sofa keeps
   the reader seated without a glide or a sitting sound; a nook that is gone or elsewhere stands them up).
6. **`audio/records.js` Meeresstille: two oscillators of the surf's breathing were started and never stopped.** Every
   change of the record left them running in the audio context for good. Fixed: stopped with the record.
7. **`input/gamepad.js`: a run toggled on with L3 survived the pad's disconnection.** `#leaveWorld()` cleared the stick
   but not `run`; the next pad set off running at the first tilt. Fixed: `run` is cleared when the last pad goes.
8. **`world/floor-art.js` `herringbone()`: dark pits on two diagonals of the parquet tile.** The painter finds the strip
   under a pixel with half-open tests (`qx >= k && qx < k + n`) in a frame turned by 45°; a pixel whose centre lies
   exactly on the seam between two strips (every 64th diagonal of the tile, the pattern's period being a multiple of the
   pixel) landed a hair outside both tests through floating point rounding, and the fallback painted it as a dark pit
   (85 pixels at the real size of 2048, 22 at 512, always on the same two diagonals). Fixed: the tests are a hair wider
   (`SEAM`, 1e-9 strip widths, closed on both sides). Reproduced and verified in Node: `build/floor-art-check.js` (new,
   part of `npm test`) paints every style, the herringbone at its real size, and counts uncovered pixels, NaN normals
   and transparent texels (10/0 after the fix, the pits before it).

## Suspected, looked at, not a defect (or not reproducible)
* `CoverStore` eviction disposing a texture a table book still uses: three re-uploads a disposed texture from its
  ImageBitmap on the next draw, so nothing goes missing (an upload, not a bug).
* `signs.js`: the textures of signs are shared through the cache and protected by `keepMap`; `end(group)` frees only
  what the newest build did not ask for.
* `ambient.js` `Layer.stop()` leaves `parts` behind, but every layer life is a new instance (`soundscape.js #layer`).
* `Player` keys: cleared on panel open and close (`syncPointer`), on blur, by the wheel's keyup; the pointer-lock exit
  does not leave a key pressed.
* GPU recovery: the minute guard, the pose, the panel wait all behave as described in CONTRACTS.md.
* Time boundaries (midnight, year end, DST, season change) in sky-state.js, celestial.js, seasons.js, soundscape.js: the
  real clock and the sky time wrap and roll over as intended; `clockTime` ignores a DST switch within a day in the
  non-real modes (the stars stand an hour off on that one day), cosmetic.
* Libraries at the edges (`world-edge-check`, new): no books at all (the waiting run), a single book, departments
  without shelves, a department with a count but no shelves, a shelf of ids without books, every book without a cover,
  a title of 400 letters, an empty title and author, page counts of -5, NaN, 0 and 1e9, a recent list with an unknown
  id, then the real library again: every build runs without an error or a NaN in the layout, the seats, the scene or
  the player, one shelf entry per book. No defect.
* `layout.js` puts a book twice on the "recently read" case when the recent list repeats an id (the shelf then has one
  entry for two meshes). Not reachable: main.js `loadRecent` and `noteRecent` are the only callers and remove repeats.
* `world-actions.js` `returnBook()` of a book whose department is not in the room (one department at a time): handled
  (`!e`, the book is only taken out of the basket).
* `fallback-check` on a small library (testbooks4, 77 books) fails from the start: six copies still fit the walls, so
  the room never shows one department at a time. The check is written for `books3\lib-generic` (see its header); it was
  rerun there.

## Second pass: the modules read line by line afterwards
nature.js (uniforms, natureMaterial, the textures, the planters), water.js, trees.js, flora.js, lilies.js, reeds.js,
bird-models.js, wildlife-models.js, wall-art.js (planner and painter), floor-art.js, furniture.js, textures.js,
snow-cover.js, side-cell.js, shelf-light.js, wall-styles.js, floor-styles.js, audio/theory.js, instruments.js, synth.js
and the workers side-cover, wall-art, floor, sound, diagram. Looked at on the way and found sound: the program cache
keys of `natureMaterial` (every variation of the shader source has a key of its own: :terrain, :lawn, :ice, :creatures,
:wildlife, :flora; the 'plain' materials differ in uniforms only), `trunkSkin` (its weights are never all zero),
`reachFor` (its cache grows only with the few fixed feeding heights), the Markov chains of theory.js (every reachable
degree has a row), the herringbone of textures.js (another algorithm, no seams), the newspaper atlas, the textures of
the lectern and the e-reader.
Reproduction in Node, without Electron: `build/world-geometry-check.js` (new, part of `npm test`) builds every tree
(four seeds, both levels), every bird (both levels, the hens paired into the cocks' mesh), the frog, every wild animal
(each coat, posed walking, galloping and sitting, the muzzle coming down as it grazes), the lilies in every season, the
reeds from several camera spots, the planters' grass and the lake, and plans every mural (each palette seed, both
languages): finite attributes and instance matrices, indices inside the vertex count, real bounds, normalised skin
weights, pieces on the wall and off the doors and windows, no overlaps, each word once (53/0). The same scan over the
floors found the herringbone's pits (bug 8).

## Noted for other strands (not fixed here)
* `koi.js` `prewarmAgain()` never draws its prewarm fish: `#draw` adds it only while `n < this.N`, and `prepare()` makes
  all N fish at once (update returns before any draw while the fish do not exist). The koi program is compiled by
  world.js `#warmUp` (compileAsync) anyway; the prewarm's vertex-layout purpose on Direct3D is lost (perf strand).

## Open
* Not read: godrays.js (the smoothness strand's). The GLSL bodies of nature.js, water.js, flora.js, snow-cover.js and
  tracks.js were read on their JavaScript side (uniforms, keys, attributes), not shaded through.
* The 400 artefact of `fallback-check` was not rerun on `main` (the cause is read from `main.js idFromUrl` and the check's
  inflated ids; the fix is in the check only).
* Timing numbers (buildMs, frame times) in the logs were measured while other checks ran on the same GPU:
  not to be tuned from these runs.
