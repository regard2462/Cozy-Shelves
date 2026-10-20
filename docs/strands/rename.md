# Strand `rename`: Cozystacks becomes Cozy Shelves (0.10.0)

## Mapping

| before | after | where |
|---|---|---|
| Cozystacks (the name people see) | Cozy Shelves | interface texts in German and English, window title, menu, notices, START.txt, READMEs, docs, licence notes, desktop entry `Name`, Android label, Windows version info, `productName` |
| Cozystacks contributors | Cozy Shelves contributors | copyright, `author`, CompanyName |
| Cozystacks (files and folders) | CozyShelves | `CozyShelves.exe`, `dist/CozyShelves-win64`, `CozyShelves-<v>-win64-portable.zip`, `CozyShelves-<v>-linux-x64.tar.gz`, `/opt/CozyShelves` |
| cozystacks | cozy-shelves | package name, `cozy-shelves_<v>_amd64.deb`, `/usr/bin/cozy-shelves`, desktop file and icon, APKs, temporary folders |
| Cozystacks/<v> (user agents) | CozyShelves/<v> (short description) | no address, no account in any user agent |
| `COZYSTACKS_*`, `__cozystacks*`, `Theme.Cozystacks` | `COZYSHELVES_*`, `__cozyshelves*`, `Theme.CozyShelves` | environment, test hooks, Android theme |
| `com.cozystacks.app` | `com.cozyshelves.app` | Android application id and Kotlin package (main, debug and release source sets) |
| German compounds | Cozy-Shelves-App, Cozy-Shelves-Einstellungen, Cozy-Shelves-Ausgabe | hyphens throughout |

Kept on purpose: the stored keys and schemes (`lesesaal.*`, `app://lesesaal`, `persist:lesesaal-browser`,
`urn:lesesaal:`, `lesesaal-kokoro` and the other IndexedDB names), the Android release key with its file name, alias
and certificate (`cozystacks-release.jks`, `cozystacks`), the logo and the icons, the history entries of README.de.md
that name the program as it was called then.

## Data folders

`productName` "Cozy Shelves" makes Electron's folder `<appData>/Cozy Shelves`. `electron/data-folder.js` uses the first
former folder with `settings.json` or `library.json` while the new one holds neither: `Cozystacks`, then `Lesesaal`.
The Mediathek's downloads: `Videos/Cozy Shelves Mediathek`, else an existing `Cozystacks Mediathek`, else `Lesesaal
Mediathek`. Unit test `electron/test-data-folder.js`; on Linux `build/ci/linux-test.sh` runs `datadir-check` for both
former names.

## Without traces of a person

No account name, e-mail address or repository name in the tree or the packages: `package.json` has no `homepage` or
`repository`, START.txt and the Debian copyright say that the source archive comes with each release, the Debian
maintainer is a placeholder address. The strand notes lost the work folders, dates of probes and the hardware of the
development machine. `npm run check:privacy` guards the account and the repository name through the local word list.

## Checks

All hidden and muted, each with its own data folder; test libraries testbooks4 (77 files) and testbooks2 (238 files).

* `npm run build`, `npm test` (every suite passed, among them DATA-FOLDER 16/16 and PACKAGE 6/6), `npm run check:privacy`.
* Source tree: `smoke` SMOKE-OK, `world-check` (the sweep without errors), `hud-check` 67/67, `worldmap-check`
  (`WM_ONLY=open,click,neighbour,city,search,theme,english,offline`) 103/103, `quit-check` 1/1.
* `npm run dist:win`: `CozyShelves.exe` with the product name "Cozy Shelves" and version 0.10.0.0; `pkg-check` (packaged,
  muted, the world, a film on the screen, the reading browser, no errors) and `smoke` SMOKE-OK on the packaged exe.
* `npm run dist:linux` (built on Windows): the tarball and `cozy-shelves_0.10.0_amd64.deb` (no Homepage, the placeholder
  maintainer, `/usr/bin/cozy-shelves` pointing at `/opt/CozyShelves/cozy-shelves`, chrome-sandbox 4755). The CI run of
  `build/ci/linux-test.sh` needs Linux and was not run here.
* `npm run build:web`, `npm run test:web`: WEB-CHECK OK 24 checks.
* `npm run build:android`: `com.cozyshelves.app` 0.10.0 (versionCode 1000), label "Cozy Shelves", the release APK signed
  with the same key as 0.9.2; `build/android-check.js` on a test emulator: ANDROID-CHECK OK 37 checks.
* The built outputs (the Windows folder, the Linux tarball and .deb, the web build, both APKs) hold no account name,
  repository name or path of the development machine (only placeholder paths in tests and third-party texts).
