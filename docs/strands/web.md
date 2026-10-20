# Strand `wip/web`: the browser version of Cozy Shelves

A second build target next to the Electron desktop app: `npm run build:web` writes a static site to `dist/web/` that
runs from any static host (and from `http://localhost`), reads a books folder the user picks in the browser, and keeps
everything the desktop keeps in its data folder in IndexedDB. The desktop app is unchanged in what it does; the two
share the sources. The Android app is planned on top of it: `docs/strands/android-plan.md`.

## What runs in a browser (the assessment)

| Feature | In the browser | How |
|---|---|---|
| the 3D world: hall, book room, garden, animals, weather, sky, seasons, winter, cat, lamps, floors, murals | as is | three.js, the workers (floor, wall art, sound, side covers) are in the bundle |
| walking and looking with mouse and keyboard, the gamepad | as is | pointer lock, Gamepad API |
| touch | hooks | `input/touch.js`: a finger looks around, a tap uses; `touch.stick.set()` for an on-screen stick (Android strand) |
| the books folder | browser implementation | `showDirectoryPicker()` (Chromium, Edge, Opera; the handle is kept in IndexedDB, the permission is asked once after a reload), else `<input webkitdirectory>` (Firefox, Safari; picked again after a reload, the books keep their ids) |
| scanning, departments and shelves from the folders, "Verschiedenes", manual shelving, duplicates, the read shelf, sort orders | browser implementation on the shared rules | `electron/library/shelving.js` (new, pure) is used by `electron/library/library.js` and `app/src/web/web-library.js` alike |
| metadata, covers, page count, text sample out of the books | browser implementation | `core/index-book.js` (the indexer's code, shared with the desktop's hidden window) runs in the page on a `File`: foliate-js for EPUB/MOBI/AZW3/FB2/CBZ, pdf.js for PDF; covers as blobs in IndexedDB, `coverUrl()` gives `blob:` URLs |
| the reader (EPUB, PDF, MOBI, AZW3, FB2, CBZ, TXT, MD, HTML), bookmarks, notes, positions, chess board, diagrams | as is | the book comes as a `blob:` URL; `library.update` writes to IndexedDB |
| reading time, history, statistics, borrowing, the basket | as is | `WebLibrary` keeps `library`, `stats`, `history` documents |
| settings | as is | `WebStore('settings')`, the same defaults and migrations (`electron/settings-defaults.js`, new, pure) |
| the computer: catalogue, loans, diary, statistics, system, all games, Lichess (puzzles, TV stream, studies) | as is | Lichess allows CORS; `app.fetch` and `streamStart` are the browser's fetch |
| chess against Stockfish | as is | `vendor/stockfish` (7 MB, loaded only when the engine is asked for) |
| world map with profiles, Wikipedia summaries | as is | offline data in `data/worldmap`; Wikipedia and Wikidata allow CORS |
| Street View on the map | left out | needs the `<webview>` |
| Wikipedia (the lectern), dictionary and translation in the reader | as is | `electron/feeds/wiki.js` and `dict.js` run in the page on `app/src/web/common-web.js` (fetch, DOMParser, the renderer's sanitizer) |
| watercolour easel, the gallery, hanging pictures | as is | paintings in IndexedDB; "export" is a download; a reference photo comes from the file picker |
| generated watercolours on the walls | as is | own picture folder left out |
| record player, generated music, the sounds of the world | as is | own music folder left out |
| read-aloud | browser implementation | `ui/reader/tts-client-web.js`: `speechSynthesis` with the same surface (reader, buttons, voice menu); no Kokoro, Piper, espeak-ng, onnxruntime |
| the weather "Like outside" (Open-Meteo) | as is | CORS |
| newspapers (feeds), podcasts | left out | the feed XML of the big German publishers does carry CORS headers (tagesschau, heise), the articles behind them do not; the podcast catalogue (iTunes) allows CORS, the episode feeds mostly not; the backend (rss-parser, jsdom, readability) is Node |
| Fernleihe (online catalogue) | left out | the downloads of Gutenberg, Wikisource and the Internet Archive need the proxy |
| Mediathek, live TV, the projection screen | left out | the MediathekViewWeb API allows CORS, the broadcasters' videos do not (WebGL needs CORS for the screen); the backend is Node |
| reading browser (`<webview>`) | left out | no webview, iframes of foreign sites are blocked |
| audiobooks | left out | tags and scan are Node; a second folder handle would do it later |
| full-text search | left out | node:sqlite; `T` and Ctrl+F open the computer's catalogue, whose text mode searches the text samples of the books |
| covers and metadata from the internet | left out | Open Library allows CORS and would do for ISBN covers later; the whole machinery (image engines, batch) is Node |
| Explorer ("Datei zeigen"), quit, music and picture folders, voice downloads | left out | hidden through `api.features` and `has()` |
| DOCX and RTF books | left out | mammoth and the RTF reader are in the main process; the files stay out of the scan |

A CORS probe (generic requests, no user data): Wikipedia REST and
API, Wiktionary, Wikidata, MyMemory, Open Library (search and covers), Open-Meteo, Lichess, MediathekViewWeb,
iTunes search, archive.org and the tagesschau and heise feeds answer with `Access-Control-Allow-Origin`; gutendex timed
out.

## What was built

* `build/web.js` (`npm run build:web`): vendor subset (fonts latin woff2 only, chessground, stockfish, foliate-js),
  esbuild bundle of `app/src/main-web.js` and six workers into `dist/web/dist/`, the page, styles, data, a manifest
  and an icon. An esbuild plugin swaps `electron/feeds/common.js` → `app/src/web/common-web.js`, `path` →
  `app/src/web/path-stub.js`, `hls.js` → `app/src/web/hls-stub.js`, `ui/reader/tts-client.js` →
  `ui/reader/tts-client-web.js`, and fails when a desktop-only module (kokoro, onnxruntime, jsdom …) ends up in the bundle.
  Writes `dist/web/build-info.json` with the sizes.
* `app/src/main-web.js`: installs `window.api` (`core/api-web.js`) and then imports `main.js`.
* `app/src/core/api-web.js`: the backend of the page (`api.platform = 'web'`, `api.features`, `invoke` dispatcher,
  settings, library, files, app, wiki, dict; stubs that reject for the rest), test hooks `window.__cozyshelvesWeb`.
* `app/src/web/`: `idb.js` (IndexedDB stores, `WebStore`), `web-files.js` (folder sources, pickers, permissions, the
  walk), `web-library.js` (`WebLibrary`), `common-web.js`, `path-stub.js`, `hls-stub.js`.
* `app/src/core/index-book.js` (shared indexer), `app/src/core/platform.js` (`platform`, `isWeb`, `touch`, `has()`,
  `graphicsPreset()`), `app/src/input/touch.js` (`TouchInput`), `app/src/ui/reader/tts-client-web.js`.
* Shared pure modules: `electron/library/shelving.js` (library.js delegates to it), `electron/settings-defaults.js`
  (settings.js requires it).
* UI gated by `has()`: menu (programmes, quit, the folder-permission row), HUD labels ("Nur in der Desktop-App"),
  settings (sections, folder pickers, covers, full text, voice downloads), computer (apps, Explorer), book info (cover
  picker), shelf info, records (music folder), welcome card (a note); main.js (interactions, keys V/I/H, `T` → catalogue,
  `window.__app.back()`, pause when hidden); panels.js (`search` → computer catalogue without the index).
* Tests: `build/web-shot.js` (static server on a free port, the installed Edge headless and muted with its own
  profile, `WEB_INPUT=1` for the webkitdirectory path) and `build/scripts/web-check.js` (20 checks: the page and its
  backend, the welcome card, the folder through the hook, scan and index, shelves, departments, covers, the picture,
  `T` as the catalogue, the settings without the desktop sections, the read-aloud client, the reader and a page turn,
  settings and position after a reload, the folder after a reload, the menu, the console).
* Automatic shelving ("Automatisch einsortieren") classifies offline in the browser (title, keywords, ISBN, text
  sample); the desktop's refinement through the book catalogues is not ported.
* npm scripts `build:web`, `test:web`.

## Sizes (0.8.0)

`dist/web` 22.9 MB on disk: bundle 6.6 MB (three.js, the app, the panels as chunks, the German hyphenation
patterns), fonts 1.9 MB, foliate-js with pdf.js 5.1 MB, Stockfish 7.0 MB (loaded only for the chess engine), world map
and reading fonts 1.9 MB, styles 0.4 MB. No source maps.

## Test results

`node build/web-shot.js web-check` in Edge 155 (headless, ANGLE D3D11 on the graphics card):

* OPFS handle path: `WEB-CHECK OK 17 checks`. 77 books of `testbooks4` (34 PDF, 43 EPUB) scanned and indexed in
  about 14 s, 7 cases with 61 books on them, 5 departments from the folders, 37 real covers out of the books (the rest
  title cards), the world draws (66 % of the picture varied), the reader opens an EPUB (2574 characters in the page
  frame) and four page turns are saved as a CFI, settings (language, font size) and the reading position survive a
  reload, the folder is found again without a new pick, the menu shows no desktop-only programme, no console errors.
* webkitdirectory path (`WEB_INPUT=1`): `WEB-CHECK OK 18 checks`; after the reload the folder asks to be picked again
  (`attention: repick`), the books and covers are still there, and the folder picked again joins its records without a
  new index run (`reindexed: 0`).
* The desktop: `npm test` 96 of 97 while the browser checks ran (the one failure is the timing test of the cover
  batch, "faster than one catalogue alone"; `node electron/library/test-covers.js` alone passes); `node build/bundle.js`
  builds; `node build/screenshot.js smoke` with `testbooks2` indexes 238 books through the shared `core/index-book.js`
  in the hidden window and reaches `SMOKE-OK` (the world with 9 cases, the computer panel).
* Other checks ran at the same time; timings above are not measurements.

## Browsers

Chromium browsers (Edge, Chrome, Opera, Brave): everything above including the kept folder handle. Firefox and
Safari: the folder through `<input webkitdirectory>`, picked again after every reload (the records and covers stay);
`speechSynthesis` where the system has voices. A secure context is required for the folder picker (https or localhost).
WebGL 2 is required for the world.

## Decisions taken by the strand

* A second entry (`main-web.js`) that installs `window.api` and then imports `main.js`, in place of a build-time
  define in `core/api.js`: the desktop bundle does not change, and the mock stays for `dev.html`.
* The browser library keeps the desktop's data model (records, `publicBook`, departments) so every panel works
  unchanged; what differs (files, covers, text) sits behind the same method names.
* Book ids are a hash of the folder name and the relative path (not of a content hash as on the desktop), so a folder
  picked again after a reload keeps every reading position without reading the files.
* The wiki and dictionary backends of the desktop run in the page through a stand-in for `feeds/common.js` rather
  than a second implementation; the renderer's own sanitizer replaces the jsdom one.
* Feeds, podcasts, catalogue, Mediathek, audiobooks, full text and the cover search are left out rather than half
  ported; the UI hides them through `has()` and the props in the world say "Nur in der Desktop-App".
* `speechSynthesis` for read-aloud with the client's full surface, so the reader, the buttons and the voice menu need
  no branches.
* The checks fill the Origin Private File System with the test books and hand its directory handle to the library,
  which is the same code path as a folder from `showDirectoryPicker()`; the `webkitdirectory` path is driven through
  Playwright's `setInputFiles` with a directory.
* The Android shell is recommended as a plain WebView project with `WebViewAssetLoader`, not Capacitor (no npm
  packages, the folder needs a bridge of our own either way).

## Open

* A `kind: 'bridge'` folder source for Android (android-plan.md), the touch HUD, a frame cap.
* Covers by ISBN from Open Library (CORS) for books without a cover of their own.
* Newspapers from feeds with CORS headers (headlines and summaries only, no full articles).
* Audiobooks from a second folder handle (the tag reader of `electron/audiobooks/tags.js` is pure enough to bundle).
* A service worker for offline use of the page itself (the books are local anyway).
* `webkitdirectory` on Firefox/Safari was exercised through Edge's input only; a run in a real Firefox is open.
