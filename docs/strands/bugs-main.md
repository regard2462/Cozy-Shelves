# Strand: bug hunt in the main process and the build tooling (`wip/bugs-main`)

Scope: `electron/**` (main.js, preload, settings and store, data folder, library scanning and watching, covers and
metadata, feeds and podcasts, catalogue downloads, Mediathek, full-text search, TTS, browser hardening, gamepad pointer)
and `build/**` (package-common.js, package-win.js, package-linux.js, privacy-check.js, third-party.js).
Rule of the strand: reproduce first (a failing unit test in `electron/**/test-*.js`), fix minimally, keep the test.

## Plan
1. Read every module of the scope with an eye on: path and URL trust at the IPC and protocol boundary, data safety of
   the JSON stores, races and leaks around quit, network budgets and encodings, Linux and Windows path rules, the
   tar/ar writer of the Linux package.
2. For every suspicion: a unit test that shows it, then the smallest fix.
3. `npm test` and `npm run check:privacy` before every push; Electron checks where the main process changed.

## Done (each with its test)
* `electron/settings.js` deepMerge: a settings patch with the keys `__proto__`, `constructor` or `prototype` (an own
  key after JSON.parse and the structured clone of the IPC) merged into `Object.prototype` of the main process.
  Fix: those keys are skipped, only own keys of the target are merged into. Test: `electron/test-settings.js` (new, in
  `npm test`).
* `electron/feeds/common.js` fetchRaw and `electron/catalog/net.js` attempt: Electron's `net.fetch` answers `file:`
  and the app's own schemes (`app:`, `book:`, `lfile:`), so `feeds:article(url)`, `podcasts:episodes(feedUrl)`,
  `catalog:readUrl` and every catalogue fetch would have read a local file for an address that is no web address.
  `app:fetch` in main.js already refused that. Fix: both helpers throw `not a web address` for anything but http(s)
  before any request. Tests: test-feeds.js ("fetchRaw fetches web addresses only"), test-catalog.js ("net: only web
  addresses reach the network").
* `electron/library/library.js` applyMustRead: a symbolic link, a junction or a Windows shortcut to a *folder* was
  taken for a cut-off book path (the 260-character rule), and the single book in that folder became a must-read (two
  books: nothing). Fix: a target that is a directory marks nothing. Test: test-library.js ("a link to a folder marks
  no book"), made with a junction on Windows and a symbolic link on Linux.
* `electron/tts/piper.js` downloadFile: resuming a voice download on a server that ignores the Range header (a plain
  mirror through `COZYSHELVES_PIPER_BASE`) appended the whole file to the part. A voice file of known size was then
  thrown away and downloaded once more, a `.onnx.json` (size unknown) stayed corrupt ("Stimmkonfiguration ist
  beschädigt"). Fix: a 200 answer to a Range request replaces the part. Test: test-tts.js ("voice downloads", a local
  http server with and without Range support).

* `electron/main.js` CSP (security): foliate-js renders every section of a book in an iframe of the app's own origin
  with `allow-same-origin allow-scripts` and hands every resource of the book to it as a `blob:` URL, scripts included.
  The app's policy allowed `script-src blob:`, so an EPUB with `<script src="pwn.js">` ran inside the app and reached
  `window.api` through its parent window (reproduced: `build/scripts/epub-script-check.js` with the EPUB of
  `build/testlib/make_scripted_epub.js`, 4/8 before the fix). Fix: two policies, the documents (`mainFrame`,
  `subFrame`, and with them the blob: iframes, which inherit) without `blob:` scripts, every other `app://` response
  with it (Kokoro's onnxruntime imports its WebAssembly glue as a blob: module inside its worker). Verified: the check
  8/8 (the blob script is refused, the book still renders), a scan of the mixed library (77 books, 34 PDFs, all indexed
  with real covers: pdf.js in the indexer works), cinema-check (the blob worker of the screen, no errors), and an
  Electron experiment: a worker loaded from a custom scheme imports a blob: module under the strict document policy.
* `electron/main.js` createIndexerWindow and `library.js` indexerGone: when the renderer of the hidden indexer window
  died (out of memory on a broken PDF, a crash), the window kept its dead page; every later book ran into the index
  timeout (a minute and more each) and was given up after three of them, and the covers from the internet had no
  decoder any more. Fix: `render-process-gone` fails the current job as a transient error (the book is read again), the
  page is reloaded and says `indexer:ready` when it is back; `getIndexer` never hands out a crashed page. Check:
  `build/scripts/indexer-crash-check.js` (3/8 before, 9/9 after; also 9/9 on the mixed library). `reindex()` counts
  the book in the scan total and a retried book grows the total (the HUD showed 239/238).

* `electron/tts/piper.js` httpGet followed redirects without a limit: a mirror that redirects in circles kept the
  voice download running for good (the retry logic never got its turn, the button spun forever). Ten hops at most,
  then "Zu viele Weiterleitungen" (`download-failed`); a redirect to anything but http(s) ends the same way. Test in
  test-tts.js (a local server with `/loop`); without the fix the test runs until the time limit.
* `electron/feeds/feeds.js` normalizeItem and `podcasts.js` (from the UI strand): a feed written by a program that
  prints its missing values ("None" from Python, also "null", "undefined", "NaN", "n/a", a dash, or an HTML body
  without text) reached the newspaper as the summary of the item, and the panel showed it with a drop cap ("N one").
  `common.js isPlaceholderText` counts such a field as missing; the next field with a text stands in (the full text of
  a ZEIT ONLINE item, say), else the summary stays empty. Tests in test-feeds.js (an RSS feed with "None", "null", an
  empty body, a real summary and a full text; a podcast with "None" descriptions).
* `build/package-common.js` makeStage copied every entry of `docs/` as a file: with the strand notes in `docs/strands`
  the build ended with EPERM (Windows) or EISDIR (Linux). `copyDocs` copies the files only (the notes stay out of the
  package). `build/package-linux.js` exports its writers when required; `build/test-package.js` (in `npm test`) reads a
  tar.gz of a small tree back (PAX for long and non-ASCII names, modes, the setuid helper of the .deb, a symlink, a
  file of 2 MB, checksums, root ownership, the fixed mtime), the ar members of a .deb and the desktop entry.

## Checked and found right (no change)
* `electron/mediathek/downloads.js` remove() of a running download: the suspicion was that Windows refuses to delete
  the open `.part` and leaves it behind. Node opens files with FILE_SHARE_DELETE, the file goes; the test "removing a
  running download … leaves no .part behind" (a trickling fake stream) passes with the code as it is and stays as a guard.
* `app.setPath('userData', …)` before `ready` moves `sessionData` with it (an Electron experiment: localStorage and
  the browser partition of a window landed in the folder set, nothing in the one Electron made): an update from
  Lesesaal keeps the recent books, the text view positions and the logins of the reading browser.
* Linux: the tar writer's non-ASCII names, PAX records and modes (see below); `install-desktop-entry.sh`.
* `build/package-linux.js`: the tar writer (ustar name/prefix split, PAX records for long and non-ASCII paths,
  checksum, setuid 4755 on chrome-sandbox in the .deb, symlinks, 2 MB files across write chunks) and the ar writer of
  the .deb were exercised with a copy of the code: GNU tar 1.35 and Python's tarfile list and extract everything,
  the ar members have the right headers and padding.
* `electron/main.js` protocols: `app:` (join + normalize + isInside), `book:`/`cover:` (ids `[\w-]{1,64}` from the
  library only), `lfile:` (base64url path, allowed roots, NUL check), Range handling of serveFile (suffix ranges,
  416 for start > end or start >= size).
* `electron/store.js`: atomic writes with a temporary file per write, debounce with an upper bound; a corrupt file
  is kept as `.corrupt-<time>`.
* `electron/mediathek/proxy.js` and `allowlist.js`: only hosts that came out of the Mediathek, playlists rewritten,
  `media://local` only inside the download roots, relative URIs of a local playlist may not leave their folder.
* `electron/catalog/epub.js`: resource names inside a built EPUB are checked (`safeResourceName`), nothing of a zip is
  ever written to disk by entry name.
* `electron/browser/index.js`: guest navigation http(s) only, `appendChapter` only inside the two library folders,
  article HTML sanitized again in the main process.

## Suspected, not changed (why)
* Library ids lowercase the path on every platform (`idFor`, `libraryIdFor`, audiobooks `idFor`): on Linux two files
  that differ only in case share one record. Rare in practice; changing the formula would re-key every Linux library
  (reading state would be carried over by `inheritFromMissing`, covers and the full-text rows by their re-key paths),
  so it is left as it is and noted here.
* `electron/store.js` keeps the temporary file of a write that crashed (`<file>.<pid>-<n>.tmp`); nothing cleans it.
  Harmless clutter, left alone because a second instance might be writing its own.
* A renderer that has been taken over can widen the allowed roots through `library:setFolders` and `files:list`; that
  is the design (the renderer manages the folders), so no IPC handler was hardened beyond the web-address rule above.

## Suspected, not changed (why), continued
* `app:fetch` in main.js has no timeout (a server that accepts and never answers leaves the renderer's promise
  pending). Its only caller is the Lichess page of the computer; adding a deadline needs an Electron check with a
  hanging local server to show it, which was not written.
* The portable Linux archive leaves `chrome-sandbox` a plain file (mode 644; `modeOf` gives 4755 only in the .deb).
  Chromium needs it executable only where it uses the setuid sandbox, and START.txt tells to `chmod 4755` it then; the
  test records the rule as it is.
* The policy of the workers: the lenient `script-src blob:` for them was shown with an Electron experiment (a worker
  from a custom scheme imports a blob: module under the strict document policy, and `onHeadersReceived` did not even
  fire for the worker script, so a worker had no policy of the app before either). The real Kokoro voice was not run
  (its model would have to be downloaded); `audit-tts-en` is the check for that.

## Measured
* Electron checks run on this branch (Windows, on the graphics card, other checks running at the same time):
  `quit-check` 1/1, `quit-close-check` (3 windows, the process ended), `indexer-crash-check` 9/9 on testbooks2 and on
  the mixed library (77 books, 34 PDFs, every one indexed with a real cover, 0 index errors), `epub-script-check` 8/8,
  `cinema-check` without errors. `npm test` passes (all suites, privacy check 948 files).
* Reading a 5 KB text book again after the indexer page died: 0.5 s with the fix (the index timeout of a minute before).

## Open
* `audit-tts-en` (Kokoro in its worker, downloads the model) on this branch, to see the blob: import of onnxruntime at
  work under the two policies.
* `search-check` on this branch (the full-text window reads PDFs under the new document policy; needs the library of
  `gen_search_lib.py`).

## How to continue
Branch `wip/bugs-main`; `npm test` runs every unit test of the scope (about five minutes), `npm run check:privacy`
before a push. Electron checks: `COZYSHELVES_USERDATA=<new folder> COZYSHELVES_BOOKS="<library>|structured"
SHOT_DIR=<folder> node build/screenshot.js <check>`; never with a visible window.
