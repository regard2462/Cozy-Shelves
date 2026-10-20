# Strand `wip/android`: the Android app of Cozy Shelves

The browser version (`wip/web`, `docs/strands/web.md`) in a WebView: a small Kotlin project under `android/`, one
activity, the web build in the app's assets, the books of a folder the user picks through the Storage Access
Framework. The desktop app and the browser version are unchanged; the three share the sources. The plan this strand
followed: `docs/strands/android-plan.md`. The bridge between the page and the app: `docs/CONTRACTS.md`, "Android-App".

## What was built

* `android/`: Gradle 8.10.2 (wrapper), AGP 8.7.3, Kotlin 2.1.0, `minSdk` 26, `targetSdk`/`compileSdk` 35; the
  dependencies `androidx.webkit` 1.12.1, `androidx.activity` 1.9.3, `androidx.core` 1.15.0 (Apache-2.0, listed in
  `THIRD_PARTY_NOTICES.md` and `LIZENZEN.md`). App id `com.cozyshelves.app`, name "Cozy Shelves", the adaptive icon out of
  `assets/icon-foreground.png` (the logo `assets/logo.svg`, drawn by `build/logo-icons.py`, then `build/android-icons.py`; Pillow), `versionName` from `package.json`, `versionCode` =
  major·10000 + minor·100 + patch. R8 shrinks the release build; the bridge methods are kept.
* `MainActivity.kt`: the WebView (JavaScript, DOM storage, hardware layer, no file access, media without a gesture),
  `WebViewAssetLoader` with `WebAssetsHandler` (the assets with the right MIME types) and `BooksPathHandler`
  (`/books/<key>/<path>`), the page at `https://appassets.androidplatform.net/assets/web/index.html?platform=android`,
  immersive full screen (bars hidden, cutout used), `sensorLandscape` in the manifest with `configChanges` so that a
  rotation never rebuilds the page, a native start screen until the page says `ready()`, the back button through
  `window.__app.back()`, `onPause` → `flush()` of the page, `webView.onPause()` and the timers paused 500 ms later,
  `onResume` the reverse, links to the outside in the system browser, `<input type="file">` through the system picker,
  a dead renderer rebuilds the activity.
* `Folders.kt`: the picked folders (tree URIs with the persisted read permission) in SharedPreferences under short
  keys, the recursive listing through `DocumentsContract` (eight levels, hidden names skipped), the files opened only
  through that listing (nothing outside a folder is ever read), the MIME types of the book formats.
* `BooksBridge.kt` (`window.AndroidBooks`): `pickFolder`, `listFiles`, `hasFolder`, `folderName`, `forgetFolder`,
  `folders`, `keepScreenOn`, `setOrientation`, `openExternal`, `vibrate`, `ready`, `exit`, `info`, `version`.
* `src/debug` only: `DebugHooks.kt` (the `EVAL` and `USE_FOLDER` broadcasts, `window.CozyDebug`) and a manifest with
  `MANAGE_EXTERNAL_STORAGE` for the test folder; `src/release` has an empty `DebugHooks`.
* The page: the folder source kind `'bridge'` (`app/src/web/web-files.js`: `sourceFromBridge`, `pickBridgeFolder`,
  `bridgeFolderPicked`, `bridgeUrl`, the shared `fromFlat` filter; `web-library.js`: `init`, `addFolder`, `addSource`,
  `reopen`, `setFolders`, `attention` reason `'lost'`), `api.platform 'android'` and the app's `openExternal`,
  `quit` → `exit()`, full screen as a no-op (`core/api-web.js`), the hook `window.__cozyshelvesWeb.androidFolder`.
* Touch: `app/src/ui/touch-hud.js` (`TouchHud`: the stick bottom left on `TouchInput.stick`, a run toggle, the use,
  jump, read and info buttons bottom right, menu and department wheel top left; hidden while a panel is open),
  `app/styles/touch.css`, the touch glyphs and texts of the HUD hints (`input/pad-hints.js touchState`), no pointer
  lock on touch (`player.noLock`), the coarse-pointer block in `app/styles/ui.css` (targets of 44 px), the reader's
  page edges and foliate's swipes as they were. `window.__app.back()` also closes the wheel.
* Graphics on a phone: the fresh touch profile is `quality 'low'`, `resolutionScale 0.6`, `fov 80`, `frameCap 30`
  (`core/api-web.js`); `World.frameCap` in the render loop, `World.frameStats()` (the median of the last 120 frames),
  `main.js watchPhoneFrames()` lowers the resolution by a tenth (to 0.5 at most, twice at most) when the median stays
  above 1.5 × the cap's interval; `main-web.js fitPhoneViewport()` zooms the page out below 560 dp of height
  (a 411 dp phone shows it at 73 %) so that the panels fit, the world renders at the same number of device pixels.
  (Since 0.10.2 a phone starts with the quality `'mobile'` instead: `docs/CONTRACTS.md`.)
* Build and signing: `build/android.js` (`npm run build:android`: web build, copy into the assets, Gradle, the APKs
  into `dist/android/`; `--debug`, `--release`, `--no-web`, `--copy <dir>` for a path with characters outside ASCII),
  `build/android-keystore.js` (a keystore outside the repository with a password of its own, written only into its
  `keystore.properties`), `app/build.gradle.kts` reads `COZYSHELVES_SIGNING`, `-Pcozyshelves.signing`,
  `<repo>/.android-signing/keystore.properties` or the `COZYSHELVES_KEYSTORE_*` variables; `.android-signing/` is
  ignored by git. The key lies outside the repository; every later version must be signed with it.
* Check: `build/android-check.js` (`npm run test:android`), see below. Docs: both READMEs ("Android app"),
  `docs/CONTRACTS.md`, this file.

## Sizes (0.8.0)

Debug APK 17.8 MB, release APK 14.5 MB (signed, APK Signature Scheme v2, `versionCode` 800, permissions INTERNET and
VIBRATE only); the web build inside is 22.9 MB uncompressed (Stockfish 7 MB and the reading engines 5 MB load only
when used).

## How the check works

`node build/android-check.js` against a headless emulator (`ANDROID_SERIAL`, default `emulator-5600`; the strand
starts it by hand: `emulator -avd Medium_Phone_API_35 -read-only -port 5600 -no-window -no-audio -no-boot-anim -gpu
host -no-snapshot-load -no-snapshot-save -memory 4096`, or `ANDROID_START=1`; screenshots need `-gpu host`): the debug APK is installed,
`immersive_mode_confirmations` and the animations are switched off, the test library (`ANDROID_BOOKS`, here 238 TXT
books in six departments) goes to `/sdcard/Documents/Testbuecher` and is handed to the app through the `USE_FOLDER`
broadcast (the same listing and serving code as a picked folder, only the walk is `java.io.File` instead of
`DocumentsContract`), the page is driven through `EVAL` (the result in logcat), the touch controls through
`input swipe` and `input tap` at the device pixels of the HUD elements, the back button through `input keyevent 4`,
home through keyevent 3, the rotation through `user_rotation`, the restart through `am force-stop`. The release APK
is installed last and must start and draw; its `EVAL` must be refused.

## Test results (0.8.0, emulator Medium_Phone_API_35, Android 15, 1080 × 2400, host GPU, WebView 153)

`node build/android-check.js`: **ANDROID-CHECK OK 34 checks** (the runs before it found mistakes of the check itself
and one real one, see below).

* The page starts with the Android backend in about 18 s from `am start` (`api.platform 'android'`, the bridge, a
  secure context on `https://appassets.androidplatform.net`, WebGL through the emulator's translator); the phone
  preset is in force (low, 30 fps cap, resolution 0.6, fov 80); the page is zoomed out to 1236 × 556 CSS px on the
  411 dp phone (visual scale 0.74).
* The test library (238 TXT books in six departments) through the bridge: listed, filtered and indexed in 36 s, every
  file served to the page with its size and type; nine cases with 238 books in six departments; the world draws
  (81 % of the picture varied).
* Frame time: median 33.3 ms over 120 frames, which is the 30 fps cap (the emulator with the host GPU renders faster
  than the cap; no measurement of a real phone yet).
* Memory with the library open (right after the index, in the world): the app process 204 MB PSS, the WebView's
  renderer (a sandboxed process of the WebView provider) 474 MB PSS; a phone with 3 GB should manage a library of
  this size, bigger ones are untested.
* Touch: a drag on the right half turns the view (yaw by 0.7 rad), the stick walks the player 1.5 to 1.7 m in 1.5 s
  and rests when released, the read button opens the book under the crosshair in the reader (5077 characters in the
  page), a tap on the page edge turns the page and saves the position (20 %), the HUD is hidden while the reader is
  open and the world rests behind it.
* The reader turns with the phone (556 × 1235 in portrait) and the page survives the rotation; the back button
  closes the reader (landscape again), opens the menu in the world, closes the menu (the HUD comes back).
* Home: the page is hidden and the world rests; back from the home screen it runs on with its 238 books. A font size
  set before survives `am force-stop`, so do the folder (kind `bridge`), the 238 indexed books without a new index run
  and the reading position (a CFI).
* The release APK installs, starts and draws, and has no `EVAL` hook; the page's console shows no errors (the
  WebView's `android-webview-video-poster` CORS line is filtered).
* Screenshots of the run: `android-start`, `android-world`, `android-reader`, `android-reader-portrait`,
  `android-menu`, `android-resumed`, `android-release` (in `SHOT_DIR`).
* `node build/web-shot.js web-check`: WEB-CHECK OK 20 checks with the same sources (the browser version is unchanged in
  what it does); `npm test` all suites passed, `node build/bundle.js` builds, `npm run check:privacy` passes.

What the runs before found: the `load` answers of the page had `\r` at the end on Windows (the check's regex), the
all-files grant of the debug build is reset by the install a moment after it reports success (the check sets and
verifies it), `devicePixelRatio` does not carry the page's zoom (`visualViewport.scale` does), and the real one:
`shouldOverrideUrlLoading` answered `true` for every address that was not the page's own, which cancelled the `blob:`
documents of the reader's iframes and left the reader on "Buch wird geöffnet" for ever (fixed: the page's own frames,
`blob:`, `data:` and `about:` load as they are, only http(s) in the main frame goes outside).

## Decisions taken by the strand

* A plain WebView project, as the plan recommended; no Capacitor, no npm packages.
* The test folder of debug builds is a plain directory (`java.io.File`) with `MANAGE_EXTERNAL_STORAGE` granted through
  `appops`: the system's picker cannot be driven reliably without a visible UI, and the listing, the filtering in the
  page, the serving and everything after it are the same code for both kinds. The `DocumentsContract` walk itself is
  exercised only by hand (a real pick).
* The page is zoomed out on a phone (`initial-scale` below 1) instead of relaying every panel out for 411 dp of height.
* The frame cap is a graphics setting (`frameCap`, 0 = off) with 30 as the phone's default and no entry in the
  settings panel yet; the adaptive resolution writes into the same settings.
* The `android-webview-video-poster` CORS line the WebView logs for a `<video>` element is noise and filtered by the check.

## Open

* An entry for the frame cap in the graphics settings.
* Vibration when a book is taken (`AndroidBooks.vibrate` is there, nothing calls it).
* The easel's reference photo through `<input type="file">` is wired (`onShowFileChooser`) but untested.
* A real pick in the system's folder picker (`DocumentsContract` walk) on a device by hand.
* Tablets: the HUD positions are tuned for a phone in landscape; a 10" tablet gets the same sizes.
* `speechSynthesis` of the WebView (Google TTS) is untested in the emulator (no voices there).
* A Play Store or F-Droid build (reproducible build, metadata) is not prepared.
