# Android: how the web build becomes an app (plan for a later strand)

Status: a plan, written by the web strand (`wip/web`). Nothing of the Android project exists yet. The web build
(`npm run build:web` → `dist/web/`) is prepared for it: a platform flag, touch hooks, a graphics preset, a back-button
hook, pausing in the background, a manifest. Everything else below is work for the Android strand.

## 1. The shell: a plain WebView project, not Capacitor

Recommendation: **a small Android project of its own (Kotlin, one Activity, one WebView) with `WebViewAssetLoader`**.

| | plain WebView + WebViewAssetLoader | Capacitor |
|---|---|---|
| dependencies | `androidx.webkit` only | `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` (npm), plugins for files, status bar, app lifecycle |
| the books folder | one `@JavascriptInterface` plus a `PathHandler` that serves SAF documents (about 150 lines of Kotlin) | `@capacitor/filesystem` has no document tree (SAF); a community plugin or a plugin of our own is needed anyway |
| control over the WebView | full (GPU, media, back button, pause) | through Capacitor's `BridgeActivity`, configurable, more layers |
| build | Gradle only | Gradle plus npm (`npx cap sync` copies `dist/web`) |
| size | web build (23 MB) + ~1 MB | web build + ~2 MB |

Capacitor saves little here (we need no plugin catalogue, only the folder access) and adds npm packages the project
rule discourages. The plain project is a few hundred lines and stays in one repository folder (`android/`).

Page address: `https://appassets.androidplatform.net/assets/web/index.html` through `WebViewAssetLoader` with an
`AssetsPathHandler` for `/assets/` (a secure context, so IndexedDB, the OPFS and `crypto.subtle` work; `file://` would
not give one). The web build is copied to `android/app/src/main/assets/web/` by a script (`build/android-assets.js`,
to be written: `npm run build:web` and a copy), never committed.

WebView settings: `javaScriptEnabled`, `domStorageEnabled`, `allowFileAccess = false`, `mediaPlaybackRequiresUserGesture
= false` (the sounds start after the first tap anyway), `setLayerType(LAYER_TYPE_HARDWARE)`, `WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)` (chrome://inspect from the PC).
The page itself reads `?platform=android` (core/platform.js) or the WebView's user agent; load the page with
`index.html?platform=android` so that `platform === 'android'` without sniffing.

## 2. The books folder: Storage Access Framework and a JS bridge

Android's WebView has neither `showDirectoryPicker()` nor `<input webkitdirectory>`. The folder comes through the
system picker and a bridge:

1. `ACTION_OPEN_DOCUMENT_TREE` → a tree URI; `takePersistableUriPermission(FLAG_GRANT_READ_URI_PERMISSION)`, the URI kept
   in `SharedPreferences`. One folder is enough for 1.0; several folders are a list.
2. A `@JavascriptInterface` object `window.AndroidBooks` with
   * `pickFolder()` (starts the picker; the result comes back through `evaluateJavascript("window.__cozyshelvesWeb.androidFolder(<json>)")`),
   * `listFiles(treeUri)` → JSON `[{ relPath, name, size, mtime }]`, walked with `DocumentsContract` (`buildChildDocumentsUriUsingTree`,
     columns document id, display name, mime type, size, last modified), at most the 8 levels the desktop walks,
   * `folderName(treeUri)`.
3. The files are **served, not copied**: a `PathHandler` in the `WebViewAssetLoader` for `/books/<folderId>/<relPath>`
   opens the document through `contentResolver.openInputStream(DocumentsContract.buildDocumentUriUsingTree(...))` and
   answers with a `WebResourceResponse` (mime type, stream). Range requests are not needed: the page reads whole files
   (foliate-js takes a File, pdf.js takes bytes).
4. In the page: a third kind of folder source in `app/src/web/web-files.js`, `kind: 'bridge'`, with
   `listBooks()` → the JSON of `listFiles` and `file: async () => new File([await (await fetch(url)).blob()], name)`.
   `WebLibrary.addSource(sourceFromBridge(...))` does the rest (web-library.js knows nothing about where a File comes from).
   The ids of the books stay stable (folder name + relative path, `hashId`).
5. After a restart `init()` finds the folder entry (`kind: 'bridge'`) and asks the bridge for the list again; the
   persistable permission needs no new click (unlike Chromium's handles).

Everything in IndexedDB (settings, library, covers, text samples, paintings) persists in the WebView's profile like in a
browser; Android may clear it only when the user clears the app's storage.

## 3. Touch controls

`app/src/input/touch.js` (`TouchInput`) is in the web build and attached when `platform.touch` is true (a coarse pointer,
or `?touch=1`): a finger drags the view (yaw, pitch), a tap uses what the crosshair rests on (`act('E')`), and
`touch.stick.set(x, y, run)` feeds `player.pad` like the gamepad's left stick. What the Android strand adds, as HTML over
the canvas (`#hud`), only when `platform.touch`:

* **left half**: a virtual stick (a ring, a knob; pointer events; `stick.set(dx / r, -dy / r, run)`, `run` when the knob is
  pushed beyond 85 %); release → `stick.set(0, 0)`.
* **right half**: looking by dragging (already in `TouchInput`; the stick's pointer id must not be the look pointer:
  the stick element stops propagation of its pointer events).
* **buttons** (bottom right, 52 px, with the glyphs of the hints): E/use (`world.actions.act('E')`), R/read (`act('R')`),
  F/info (`act('F')`), jump (`act('Space')`), basket (`openPanel('basket')`), wheel (`wheel.show(false)` toggles), menu
  (`openPanel('menu')`). The hints of the HUD (`input/pad-hints.js`) already switch between keyboard and gamepad glyphs;
  a third set `touch` with the button pictures is the clean way (`padState`).
* The pointer lock hint "Klicken, um dich umzusehen" (`hud.js showClickHint`) and the key hints of the cover card are
  hidden on touch (`platform.touch`).
* Panels (reader, computer, settings) are plain HTML and already work with touch; the reader turns pages by tapping the
  page edges and swiping (foliate-js); the world map drags and pinches (map-view.js uses pointer events). Texts and
  buttons need 44 px targets on a phone: a `@media (pointer: coarse)` block in `app/styles/ui.css`.
* Pointer lock does not exist in the WebView: `player.lock()` is a no-op there (the `?nolock=1` query of player.js does
  that; `platform.touch` should set `player.noLock`).

## 4. Graphics on a phone GPU

* The fresh profile of the web build already starts a touch device low (`api-web.js freshProfileOverrides`): quality
  `low`, no bloom, shadows, ambient occlusion or god rays, `resolutionScale` 0.75. `core/platform.js graphicsPreset()`
  says the same for code that wants it.
* Recommended for the app: `resolutionScale` 0.6 to 0.75 on 1080p phones (the canvas is drawn at 650 to 800 px wide),
  `fov` 80 (the screen is small and far), the frame rate capped at 30 fps in the background music's interest (world.js
  `start()` runs at the display rate; a `setFrameCap(30)` hook would be new).
* Adaptive: measure the frame time for the first 10 s (`world.renderer.info`, `requestAnimationFrame` deltas) and lower
  `resolutionScale` by 0.1 when the median is above 40 ms; the search activity module (`ui/search/activity.js`) has the
  frame-time window code to borrow.
* The fonts of the title cards and the side covers come from workers with `OffscreenCanvas`; Android WebView 100+ has
  it. The wall-art worker and the floor worker paint large textures (4096 px): on phones halve them (`floors.js`,
  `walls.js` take the size from settings quality `low` already; check memory on a 3 GB device).
* Test on the emulator with `-gpu host` only (SwiftShader gave white frames in the tests, see below); real phones with
  Mali-G52 and Adreno 610 are the floor.

## 5. Back button, lifecycle

* `onBackPressedDispatcher`: `webView.evaluateJavascript("window.__app.back()") { handled -> if (handled == "false") moveTaskToBack(true) }`.
  `window.__app.back()` (main.js) closes the topmost panel, opens the menu in the world, and answers `false` on the start
  menu before the library was entered.
* `onPause`: `webView.onPause(); webView.pauseTimers()`. The page itself stops the world on `visibilitychange`
  (main.js, web platform only) and starts it again when visible; the audio engine already handles `document.hidden`.
  `onResume`: `webView.onResume(); webView.resumeTimers()`.
* `onDestroy`: nothing to save, IndexedDB writes are flushed within 2.5 s of every change (`WebStore`); a
  `beforeunload` is not fired by WebView, so call `window.__cozyshelvesWeb.flush()` from `onPause` through
  `evaluateJavascript` and wait up to 500 ms.
* Screen: `FLAG_KEEP_SCREEN_ON` while reading (the reader panel is open) through a bridge call, else the screen dims as usual.
* Orientation: landscape for the world, the reader may rotate; `android:configChanges="orientation|screenSize"` so the
  WebView is not recreated (the world would rebuild).

## 6. Building and signing

* SDK: an Android SDK with platform-tools, emulator, build-tools, platform android-35 and cmdline-tools; JDK 17.
  Gradle through the wrapper of the project (AGP 8.x, Gradle 8.x).
* **Build on an ASCII path**: the Android Gradle Plugin fails on a path with an umlaut. When the checkout lies on such
  a path, the build copies `android/` and the web build to a short folder in the temporary directory, builds there and
  copies the APK back.
* `gradlew.bat :app:assembleRelease` (`minSdk` 26, `targetSdk` 35, `compileSdk` 35; `androidx.webkit:webkit:1.12+`
  for `WebViewAssetLoader`). Debug builds for the emulator with `assembleDebug`.
* Signing: a keystore of the project's own (`keytool -genkeypair` with RSA, `-keysize 4096 -validity 36500`), kept
  outside the repository; `signingConfigs.release` reads the password from `~/.gradle/gradle.properties` or an
  environment variable, never from a committed file. `apksigner verify --print-certs` as the last step.
* The web build goes in as assets: `npm run build:web`, then copy `dist/web` → `android/app/src/main/assets/web`
  (`build/android-assets.js`). 23 MB of assets; `aaptOptions { noCompress 'wasm', 'woff2' }` keeps the big files
  uncompressed (faster loading, the APK is zip-compressed anyway).
* The app id: `com.cozyshelves.app` or the like; nothing personal in the manifest, no network permission beyond
  `INTERNET` (Wikipedia, dictionary, Open-Meteo, Lichess).

## 7. Testing in the emulator

* An AVD such as `Medium_Phone_API_35` (1080 × 2400, API 35). Start headless and silent: `emulator -avd Medium_Phone_API_35
  -no-window -no-audio -gpu host -no-snapshot-load -no-snapshot-save -memory 4096`. Screenshots work only with
  `-gpu host` (`swiftshader_indirect` gave white pictures in the tests).
* Wait for `adb shell pm path android` before installing (`sys.boot_completed` is too early); install with
  `adb install -r app-debug.apk`; start with `adb shell am start -n <id>/.MainActivity`.
* Screenshots: `adb exec-out screencap -p > shot.png` (in Git Bash with `MSYS_NO_PATHCONV=1` for device paths); several
  in a row inside one `adb shell "…"`.
* Logs: `adb logcat -s chromium:I AndroidBooks:D` (console.log of the page arrives under `chromium`). Checks of the
  page's state: `adb shell` cannot evaluate JavaScript; the app exposes a debug broadcast (`am broadcast -a
  com.cozyshelves.app.EVAL --es js "…"`) that calls `evaluateJavascript` and logs the result, debug builds only. Alternatively
  Chrome DevTools remote debugging from the PC (`chrome://inspect`, needs a visible browser, so only by hand).
* A test library on the device: `adb push <testbooks> /sdcard/Download/testbooks`, then pick it in the SAF picker by
  hand once, or in a debug build pre-grant through `adb shell content` … simplest is the broadcast above calling
  `window.__cozyshelvesWeb.useFiles` is not possible (no FileList): add a debug path `AndroidBooks.useFolder("/sdcard/Download/testbooks")`
  that lists a plain directory (File API) and serves it through the same `PathHandler`.
* What to check (the same as `build/scripts/web-check.js`): the page loads, the world builds at the low preset in under
  20 s on the emulator, the folder goes through the bridge, the shelves fill, covers come out of the books, the reader
  opens, position and settings survive `am force-stop` and a restart, the back button, `onPause` stops the frames.

## 8. Open points for the Android strand

* `kind: 'bridge'` source in web-files.js and the `androidFolder` hook in api-web.js (small).
* Touch HUD (stick, buttons) and the coarse-pointer CSS.
* A frame cap and the adaptive resolution.
* The sounds: the audio engine starts after the first tap (`audio.init()` in `enterLibrary`), which a tap on "Enter the
  library" is. Vibration (`navigator.vibrate`) for the taking of a book is a small extra.
* Speech output: `speechSynthesis` exists in the WebView (Google TTS); the voice list arrives late, `tts-client-web.js`
  waits 1.5 s for it.
