# Strand: bug hunt in the user interface (`wip/bugs-ui`)

Scope: `app/src/ui/**`, `app/src/core/**`, `app/src/media/**`, `app/src/workers/**`, `app/styles/**`, `app/*.html` and the UI
parts of `app/src/main.js`. The 3D world, the main process, visual smoothness and the browser version belong to other strands.

## Plan
1. Read the panels, the reader, the media players, the input layer and the core helpers systematically; note every
   suspected defect with file and line.
2. Reproduce each suspicion (unit test under `app/src/ui/__tests__/`, a harness check or a `page.evaluate`), then fix it
   minimally and add a regression check where practical.
3. Measure growth over repeated open and close cycles of every panel (bus listeners, window and document listeners,
   DOM nodes, heap) with a harness check.
4. Push after every meaningful step; keep this document current.

## How to run the checks of this strand
- Unit tests: `node app/src/ui/__tests__/run.js` (texts, numbers, dates), `node app/src/ui/computer/games/__tests__/run.js`
  (games, Lichess helpers); both are part of `npm test`.
- Harness: `COZYSHELVES_USERDATA=<fresh folder> COZYSHELVES_BOOKS="<library>|structured" COZYSHELVES_AUDIOBOOKS=<folder with
  test audiobooks> SHOT_DIR=<folder> BU_PARTS=padbar,chessrace,tabs,lang,langlive,leaks,layout node build/screenshot.js
  bugs-ui-check` (`BU_SHOTS=0` takes no pictures, `BU_CYCLES` = cycles of the leak part, `BU_SIZES`, `BU_THEMES` and
  `BU_SHOT_THEME` = sizes, appearances and the pictured appearance of the layout part).

## Done
1. Texts: a placeholder value with a dollar sign (`core/i18n.js`). `t()`/`tr()` filled `{title}` with a string
   replacement, so a title such as "Rock $& Roll" came out garbled (`$&` repeated the placeholder, `$'` the rest of the
   sentence). One pass with a function replacer; a value is never read as a placeholder itself. Unit test in
   `app/src/ui/__tests__/run.js`.
2. Numbers and dates in the language of the interface: `catalog-panel.js` (word counts, downloads, file sizes with
   `toLocaleString`), `browser/util.js formatBytes(n, lang)` and `decimal(lang)`, `browser/reader.js formatDate(s, lang)`,
   `browser/sheets.js` (line height, download sizes), `browser/tts.js` (speed), `computer/sections/stats.js` (day labels),
   `podcasts/podcast-panel.js` (rate; the sleep timer's "N min" now re-renders every minute). One German dash sentence
   in the catalog rewritten. Unit tests for `formatBytes` and `formatDate`; a static test scans the German texts of
   `app/src/ui`, `app/src/i18n` and `app/src/input` for a dash as punctuation.
3. Mini player with the gamepad (`ui/media-bar.js`, `input/gamepad.js`): the audiobook's pad row stayed empty (an
   empty bordered strip) or kept the film's "10 s"; the D-pad skipped an audiobook 15 s both ways instead of 15 s back
   and 30 s forward like J and L. `bugs-ui-check` part `padbar` reproduced it (row `["10 s","Bedienen"]`, skips
   `[15,-15]`) and passes with the fix (`["15 s · 30 s","Bedienen"]`, `[30,-15]`).
4. Chess against Stockfish in the computer (`computer/games/chess-vs-engine.js`): the setup's keys stayed in force
   until the engine was up, so a second Enter started a second game over the first. Its board kept six listeners on
   the document and its claim on the shared engine was never released (the Stockfish worker lived on after the game).
   Leaving with "Neu" while the engine started left the claim behind too. The game's keys take over before the engine
   is awaited; a claim that arrives after the player left is released at once. `engine.js` exposes
   `window.__chessEngineRefs()` for the check. `bugs-ui-check` part `chessrace` reproduced both (6 listeners, refs 1)
   and passes with the fix (0, 0).
5. Lichess puzzles (`computer/games/lichess.js`): a puzzle starting with Black to move labelled Black's first move as
   White's ("12. Nf6" instead of "12… Nf6 13. Bxf6"). `moveLabel()` with unit tests; `splitPgn()` got tests as well.
6. Tab left the open panel (`ui/panels.js trapTab`, `main.js bindKeys`): the HUD and the mini player lie before the
   panels in the document, so Tab from a freshly opened panel (nothing focused yet) landed on the mini player's buttons
   behind the scrim, and Enter pressed them unseen (pause, "Film beenden", the Mediathek over the panel). The
   `tabs` part of `bugs-ui-check` reproduced it in 18 of 19 panels (worldmap has its own order); with the trap all 19
   pass, 60 Tab and 20 Shift+Tab presses each. The browser keeps its own order inside the panel; only the step out of
   it (at either end or from outside) goes to the first or last control of the panel. The welcome card's own Tab
   handling, the computer's catalog and diary sections, the voice menu and the department wheel are untouched
   (firststart-check 23/23, wheel-check open,keys 6/6, controller-check media,podcasts 15/15 after the change).
7. Fernleihe (`catalog/catalog-panel.js`): Gutenberg names its format "EPUB (mit Bildern)" in the main process, and the
   English interface showed it in German. The `lang` part of `bugs-ui-check` (every panel opened in English, its
   labels, titles, placeholders and headings scanned for German) found it; the panel now says "EPUB (with images)".
   22/22 with the fix; the other hits of the first run were content (programme titles of the Mediathek with
   "(Originalversion mit Untertitel)", audiobook titles, hits of the full-text search), now left out of the scan.
8. Watercolour (`watercolor/watercolor-panel.js`): a reference picture is fetched as a blob and shown through a blob URL
   that was never revoked, so every picked picture stayed in memory for the session. Revoked when replaced, cleared or
   left with the panel. Verified by reading only (the file dialog has no stand-in in the harness).
9. The language switched while a panel is open (`ui/nav-history.js`, `computer/computer-panel.js`,
   `audiobooks/ab-panel.js`, `duplicates.js`): the computer's system section switches the language itself, and the
   settings open over the menu and over the audiobooks panel. The history buttons of six panels kept their German
   names ("Zurück (Alt+←)"), the computer's close button and the audiobooks' search field their German screen-reader
   names, the dialogs of the audiobooks and the duplicates their German label. The history buttons now follow
   `i18n:change` (released with the panel), the others re-label in their language handlers. The `langlive` part of
   `bugs-ui-check` found it (the first run scanned every panel: the ones that cannot be open while the language
   changes, chess, watercolour, reader, browser, worldmap, Mediathek, Fernleihe, news, podcasts, keep their header
   texts until they are opened again, which is how they are reached anyway; the part now covers menu, settings,
   computer and audiobooks).

## Suspected and not reproduced or left as they are
- `wiki-panel.js` figcaption uses " — " between caption and artist: decorative, not a sentence; left.
- Settings sliders show "1.25×" with a decimal point in German (graphics, controller, TTS): consistent across the
  settings, left.
- `welcome.js`: Shift+Tab from outside the card lands on the first button: trivial, left.
- `reader-panel.js stepSize`: the notice shows even at the limit of the font size: cosmetic, left.
- `tts-voice-menu.js`: unhandled letter keys bubble to the panel: ambiguous, left.
- `reader-tts.js showHint`: an untracked 8 s timer: harmless after unmount, left.
- HUD weather icon map verified (`nameOfMix` only returns clear/overcast/rain/storm/snow/fog).
- Solitaire: an ace on a foundation can be moved to another empty foundation (counts a move): a quirk, left.
- Audiobooks panel at 1024×640: the search field's placeholder is cut ("Titel, Autc"): cosmetic, left.
- News: a ZEIT ONLINE article arrived with the summary "None" (the feed's own text), shown with a drop cap as "N one";
  feed data, the parser lives in the main process; left.
- Dark appearance at 1600×900 (pictures of all 19 panels, `BU_THEMES=dark BU_SHOT_THEME=dark`): nothing wrong found.

## Open
- Styles (`app/styles/**`) were only checked through the layout part (sizes 1024×640 and 2560×1440, three themes) and
  the pictures of the small size in sepia, not read line by line.
- `hud-check` could not run on the test library of this strand (its copy of testbooks4 has no book with a real cover
  image: "CARD real {missing:true}", the script then stops); nothing of this strand touches `ui/hud.js`.
- Tab inside the reading browser's `<webview>` pages is the guest page's own; the trap only sees keys of the host page.

## Measured numbers
- Leak part, 4 open and close cycles per panel (test library of 240 books, other checks running at the same time, so
  heap numbers are noisy): every panel dBus 0, dWin 0, dNodes 0, layers 0. Heap growth (MB, from the second to the fourth
  cycle): menu 0.9, settings 2.5, settings:tts 2.4, settings:library 0.9, basket 0, bookinfo 0, records 0.2, computer -0.1,
  computer:stats 0.1, catalog -0.2, news -0.2, podcasts 0, wiki 0.4, chess -0.1, watercolor 0, gallery -0.1, mediathek 0.5,
  browser 0.1, worldmap 0.1, audiobooks 0, duplicates 0, search -0.1, reader 0.1. The settings' 2.5 MB over three cycles is
  the largest; with no listener or node left behind it is most likely cache (previews, voice lists) and is not pursued.
- Layout part: 115/115 passed (19 panels × 3 themes × 2 sizes; the harness window reports 1040×679 for the 1024×640
  request, so the small size is measured at that viewport).
- Chess race part: before the fix 6 stray document and window listeners and 1 engine claim after "Neu"; after it 0 and 0.
- Tabs part: before the trap 18 of 19 panels let Tab reach the mini player within 4 presses; after it 21/21 (19 panels,
  60 Tab and 20 Shift+Tab each).
- Lang part: 22/22 (HUD, 20 panels, 3 to 180 texts each) after the Fernleihe label; langlive part 4/4 (menu, settings,
  computer, audiobooks) after the history buttons and the screen-reader names follow the language; the leak part run
  again after that change: every panel dBus 0, dWin 0, dNodes 0 (the history buttons release their listener).
- Regression after the changes: unit tests 6/6 (ui), 62/62 (games) and 22/22 (reader), firststart-check 23/23,
  wheel-check (open, keys) 6/6, controller-check (media, podcasts) 15/15, media-focus-check 27/27, audiobooks-check
  40/41 (the one failure is the timing criterion "no long frame while the first folder fills the cabinet": 154.6 ms
  with other checks running at the same time; the cabinet is world code, nothing of this strand).
