# Cozy Shelves: Modul-Schnittstellen (Contracts)

Cozy Shelves ist eine Electron-App (Electron 44, Chromium). Renderer = Vanilla-JS ES-Module, gebündelt mit esbuild
(`node build/bundle.js`), **keine Frameworks**. 3D über Three.js r186. Alles läuft über das `app://`-Schema
(`app://lesesaal/index.html`), Bücher über `book://<id>/<name>`, Cover über `cover://<id>/<id>.jpg`,
beliebige lokale Dateien (Bilder, Musik) über `lfile://…` (URLs liefert das Backend).

```
electron/            Hauptprozess (CommonJS)
  main.js            Fenster, Protokolle, IPC (settings, library, files, app)
  preload.js         window.api  ← DIE Schnittstelle des Renderers zum Backend (siehe unten)
  library/           Scanner, Indexer-Bridge, Klassifikation, JSON-DB, Cover und Metadaten, Regale, doppelte Bücher
  feeds/             feeds.js, podcasts.js, wiki.js, dict.js (register({ipcMain, …}))
  mediathek/         Mediathek: MediathekViewWeb, englische Quellen (sources/), Live-TV, Auflösungen, Downloads
  audiobooks/        Hörbücher: Tags, Scan, Cache, Lesestand (ab 0.7)
  search/            Volltextindex (node:sqlite, FTS5) und sein Lesefenster (ab 0.7)
  pad-input.js       Mauszeiger des Controllers (ab 0.7)
  tts/               piper.js (Stimmen, Downloads), sidecar.js (Python-Sidecar, altes Verfahren)
app/
  index.html         Haupt-App (lädt styles/*.css und dist/app.js)
  fulltext.html      unsichtbares Fenster, das die Bücher für die Volltextsuche liest (ab 0.7)
  src/main.js        Bootstrap (World + UI)
  src/core/          bus.js, i18n.js, dom.js, api.js (+ api-mock.js für Browser-Tests), cover-art.js
  src/world/         Three.js-Welt (Bibliothek, Spieler, Interaktion, Garten, Tiere, Himmel)
  src/ui/            panels.js (Panel-Manager) + ein Ordner pro Panel-Modul
  src/input/         Controller (gamepad.js, Tafeln, Bildschirmtastatur, Mauszeiger; ab 0.7)
  src/search/        Text der Bücher für die Volltextsuche (ab 0.7)
  src/media/         Film-Player, Fokus, Transport, Auflösungen
  src/audio/         Audio-Engine (Musik, Geräusche der Welt, SFX)
  src/workers/       Web Worker (tts-worker.js = Kokoro, stockfish-worker.js, floor-, sound-, diagram-worker …)
  data/fonts/        Leseschriften Literata, Source Serif 4, Atkinson Hyperlegible Next (OFL)
  styles/            ui.css (Theme/Tokens) + <modul>.css
  vendor/            foliate-js, fonts, chessground, stockfish, kokoro (per build/vendor.js kopiert)
```

## Konventionen
* ES-Module, `import { h, $, clear, escapeHtml } from '../../core/dom.js'` für DOM-Bau (`h('div.cls', {onclick}, kind…)`).
* Texte zweisprachig inline: `import { tr } from '../../core/i18n.js'; tr({ de: 'Öffnen', en: 'Open' })`.
  Sprache: `i18n.lang` ('de'|'en'), Änderung: `bus.on('i18n:change', lang => …)`.
* Event-Bus: `import { bus } from '../../core/bus.js'`, dann `bus.emit('name', payload)`, `bus.on('name', fn)`.
* Backend: `import { api } from '../../core/api.js'` (= `window.api`, im Browser ein Mock).
* Jedes Panel-Modul legt seine CSS-Datei in `app/styles/<modul>.css` (wird in index.html verlinkt), nur eigene
  Klassen-Präfixe verwenden (z. B. `.chess-…`). Theme-Tokens aus `styles/ui.css` nutzen (`var(--paper)`, `var(--amber)`,
  `var(--font-display)` …). Klassen `.panel`, `.panel.paper`, `.panel-header`, `.panel-body`, `.btn`, `.btn.primary`,
  `.input`, `.tabs/.tab`, `.list/.list-item`, `.toggle`, `.range` stehen bereit.
* Keine externen Netz-Ressourcen im Renderer (CSP/offline): keine CDN-Links, Fonts liegen in `vendor/fonts`.
  Netzwerkzugriffe von UI-Modulen laufen über `api.app.fetch(url, opts)` (Proxy im Hauptprozess, gibt `{ok,status,text,contentType}` zurück)
  oder über die Fach-APIs (`api.feeds`, `api.wiki`, …).
* Panels sind **2D-Overlays** über der 3D-Welt. Sie werden vom Panel-Manager (`src/ui/panels.js`) geöffnet:
  `openPanel('chess', params)`. Ein Panel-Modul exportiert:

```js
export async function mount(container, ctx, params) {
  // container: <div class="panel-layer"> (füllt den Bildschirm, zentriert Kinder)
  // Baue hinein: h('div.panel.paper', h('div.panel-header', …), h('div.panel-body', …))
  return {
    unmount() {},          // Aufräumen (Timer, Audio, WebGL-Kontexte …)
    onKey(e) { return false; } // true = Taste konsumiert (Escape schließt sonst das Panel)
  };
}
```

`ctx` enthält: `{ api, bus, i18n, audio, state, close(), openPanel(name, params), toast(msg), world }`
* `ctx.audio`: Audio-Engine (siehe unten), z. B. `ctx.audio.sfx('click')`.
* `ctx.state`: App-Zustand: `state.settings` (aktuelle Einstellungen), `state.basket` (Array von Buch-IDs),
  `state.library` (`{books, departments}`), `state.player` (Position).
* `ctx.world`: 3D-Welt (nur wenn nötig, z. B. um ein Bild aufzuhängen: `bus.emit('gallery:hang', {url})`).

## Backend-API (`window.api`, vollständig in `electron/preload.js`)
```
api.settings.get() / set(patch) / onChange(fn)
api.library.getState() → { books: Book[], departments: Department[], folders, scan }
api.library.onUpdate(fn) / onBook(fn) / onScan(fn)
api.library.book(id) / update(id, {lastLocation, progress, lastRead, bookmarks, annotations, positions, currentPageText})
api.library.open(id) (zählt Öffnung) / borrow(id, true|false) / history(limit) / stats()
api.library.search(q) / searchText(q) / bookUrl(id) → URL für foliate-js / readText(id) → {text|html}
api.library.coverUrl(id) → 'cover://…' (synchron)
api.library.addReadingTime(id, seconds)
api.files.pickFolder(title) / list(folder, ['.jpg']) → [{path,name,url}] / savePainting(dataUrl,name) / paintings()
api.app.fetch(url, {headers, binary}) / openExternal(url) / toggleFullscreen()
api.feeds.*  api.podcasts.*  api.wiki.*  api.dict.*  api.tts.*   (siehe preload.js)
```

### Book
```
{ id, path, relPath, folder, format: 'pdf'|'epub'|'mobi'|'azw3'|'fb2'|'cbz'|'txt'|'md'|'html'|'docx',
  title, author, language ('de'|'en'|…), isbn, publisher, year, subjects[], description,
  department, shelf, departmentSource: 'folder'|'auto'|'manual', hasCover, coverColor, pageCount,
  lastLocation (CFI-String o. ä.), progress (0..1), lastRead (ms), addedAt, bookmarks[], annotations[], positions[],
  readingSeconds, timesOpened, borrowed, borrowedAt, isChess }
bookmark   = { id, location, label, createdAt, page? }
annotation = { id, value (CFI), color, note, text, createdAt }
position   = { id, fen, label, location, createdAt }     // Schachstellungen zu einem Buch
```
### Department
`{ name, count, source, shelves: [{ name, bookIds: [] }] }`. Regale sind alphabetisch (numerisch) sortiert.

## Bus-Events (Auswahl)
```
'book:open'        { id, location? }        → Reader öffnet Buch (Reader-Panel)
'book:borrow'      { id }                   → in den Korb
'book:return'      { id }
'basket:change'    ids[]
'gallery:hang'     { url, title }           → Bild an eine Wand hängen (Welt; der Name stammt aus der Zeit vor der Galerie)
'painting:saved'   { path, url }
'music:record'     id                       → Plattenspieler wechselt Platte
'settings:change'  settings
'world:teleport'   placeId
'world:department' name                     → Bücherzimmer auf diese Abteilung umbauen
'world:sit'        seatId / 'world:stand'
'panel:open' name  / 'panel:close' name
'tts:speak'        { text, lang } / 'tts:stop'
ab 0.7:
'book:open-hit'    { id, hit }              → Reader öffnet ein Buch an einem Treffer der Volltextsuche
'reader:goto-hit'  { id, hit }              → der offene Reader springt zum Treffer
'audiobooks:change' { reason, id? }         Bestand oder Lesestand der Hörbücher (ab-store.js)
'audiobook:play' · 'audiobook:open' · 'audiobook:stop' · 'audiobook:ended' · 'audiobook:sleep-ended'   id
'tts:downloads'    { running, cancelled, current, items, total, received, progress, failed }   („Alle Stimmen“)
'firebowl:change'  { burning }
'floors:painting'  bool                     ein neuer Fußboden wird gemalt
'pad:connection'   { active, connected, family, name, vibration, standard }
'input:device'     'pad' | 'keys'
'welcome:folder'   folders[]                → der erste Bücherordner ist gewählt
```

## Audio-Engine (`src/audio/engine.js`)
```
audio.init()                       // nach erster Nutzergeste
audio.sfx(name, opts)              // 'click','page','book-pull','book-place','basket','sit','stand','footstep','type','chess-move','error','open'
                                   // (opts.dry: ohne den Hall des Raums, draußen von selbst; 'door' gibt es seit 0.7 nicht mehr)
audio.playRecord(id) / stopRecord() / records() → [{id, title, artist, procedural:true|false, url}]
audio.setVolumes({music, ambient, sfx})
audio.ambient.set(…)               // seit 0.7 ohne Wirkung; audio.ambient.state liefert die Pegel der Soundscape
audio.playUrl(url, {loop, volume, positional?})   // Podcasts / eigene Musik nutzen HTML5 <audio> selbst
audio.attachWorld(world)           // ab 0.7: main.js nach dem Bau der Welt, startet die Soundscape
audio.footstep({ run, speed, landing, impact })   // ab 0.7: aus onStep/onLand der Welt, Boden aus der Soundscape
```
Seit 0.7 bestimmt die Welt, was zu hören ist (`src/audio/soundscape.js`): Regen, Wind und Donner aus
`world.weatherState()` und `env.lightning` (der Donner kommt um Abstand/343 s nach dem Blitz), Kaminfeuer, Wanduhr und
Feuerschale (`world.fireBowl`) an ihrem Ort, gedämpft durch Wände und Glas (`acoustics.js`), die Tiere des Gartens nach
Tageszeit, Jahreszeit und Wetter (`voices.js`), die Schritte nach dem Boden unter den Füßen (`steps.js`,
`player.groundAt`, Fußboden aus `settings.floor`). Schwere Klänge rechnet `workers/sound-worker.js` (`offthread.js`).
`Soundscape`: `attach`, `update`, `stepInfo()` → `{ surface, outdoor, wet, … }`, `strike(at, { distance, unseen })`,
`state`, `levels`, `simulate`, `seed` (Prüfskript `sound-check`). Einzelne Geräusche lassen sich abschalten:
`settings.audio.sounds` (siehe *Einstellungen in 0.7*). Die Schalter `audio.fire`, `rain`, `wind` und `clock` aus 0.6
werden nicht mehr gelesen.

## Welt-Aufbau (seit 0.2)
Die Welt besteht aus **einer** Halle (`HALL`, 17 × 11 m), einem kurzen Durchgang (`PASSAGE`) und **einem**
Bücherzimmer (`ROOM`, 22 × 14 m). Ein Zimmer je Abteilung gibt es nicht mehr. Welche Abteilung im Zimmer steht,
entscheidet `buildLayout(departments, booksById, { department, recent })`:
* `world.setDepartment(name)` baut das Zimmer neu auf (Spielerpose, Korb und Sitzplatz bleiben erhalten).
* `world.setRecent(ids)` füllt das Regal „Zuletzt gelesen“ rechts vom Durchgang. Diese Bücher stehen
  dann **nicht** zusätzlich im Abteilungsregal.
* Jedes Regal zeigt zwei Exemplare mit dem Cover nach vorn (`bookcase.display`), der Präsentationstisch
  in der Raummitte weitere sechs.
* `app/src/ui/wheel.js` (`CategoryWheel`) ist das Radialmenü dazu; `main.js` verbindet es mit `setDepartment` (`onPick`) und
  `teleportTo` (`onTeleport`). Seit 0.7.2 hat es zwei Ringe: `wheel.ring` ist `'deps'` oder `'places'`, `wheel.toggleRing()`
  wechselt (die Mitte des Rads, `Q`, am Pad `LB`/`RB`), `#wheel[data-ring]` zeigt den Ring. Der Ortering liest
  `ctx.world.places()` (`id`, `label {de, en}`, `group`) in der Reihenfolge der Orte-Tafel (hall, entrance, rooms, garden,
  Rest) und ruft `opts.onTeleport(placeId)` wie die Tafel. Optionen: `{ onPick(name), onTeleport(placeId), onToggle(open) }`.
  Texte `wheel.hint` (Abteilungsring) und `wheel.hintPlaces` (Ortering), in `pad-hints.js` unter denselben Schlüsseln. Ab 13
  Sektoren rücken die Beschriftungen nach außen; die Silbentrennung kennt Anlautgruppen („Glas-front“).
* Geometrie-Regeln: alles aus dem Cache in `geo.js` ist `geometry.userData.shared` und darf beim Neubau
  **nicht** disposed werden; alles andere wird von `world.#clearStatic()` freigegeben. Materialien mit
  `userData.disposable` werden freigegeben, `userData.keepMap` schützt dabei eine gecachte Textur.

## Welt-Hooks (für Module, die die 3D-Welt brauchen)
`ctx.world` bietet: `world.teleport(placeId)`, `world.places()` → `[{id, label, group}]`, `world.hangPainting(url)`,
`world.setPaintings(list)`, `world.setWeather(name)`, `world.setLight({brightness, warmth})`, ab 0.7
`world.weatherState()` (das Wetter jetzt, siehe *Himmel, Wetter, Tageszeit*) und `world.readShelf()` → `{ count }` oder
`null` (das Regal „Gelesen“, gesetzt von `ui/shelves.js`), ab 0.7.1 `world.still(width)` (ein kleines Standbild der
Welt), `world.winter` und `world.tracks` (siehe *Winter*). `ctx.worldHour()`
liefert die Stunde des Himmels.
`setWeather(name)` schreibt das alte Wort `settings.weather`; beim festen Wetter übernimmt `fixedWeatherOf()`
(`sky-state.js`) es, wenn es nicht zu `settings.sky.base` passt. Nebel, Wind, wechselndes und echtes Wetter stehen seit
0.7 in `settings.sky`.

## Tests
* Browser-Schnelltest ohne Electron: `app/dev.html?panel=<name>` (Mock-API). Start: `npx http-server app -p 8099`
  und mit Playwright/Chromium Screenshots machen (`node build/dev-shot.js <panel>`).
* Electron-Test unter Xvfb: `COZYSHELVES_BOOKS=/tmp/testbooks xvfb-run -s "-screen 0 1600x900x24" node build/screenshot.js <script>`

## Erweiterungen der API
* `api.invoke(channel, ...args)` / `api.on(channel, fn)`: generischer Zugriff auf eigene IPC-Handler, die ein
  Backend-Modul in seiner `register({ipcMain, …})`-Funktion anlegt (z. B. `ipcMain.handle('feeds:opml', …)`).
* `api.app.streamStart(url, opts) → id`, `api.app.onStream(fn)` (Payload `{id, type:'data'|'end'|'error', chunk}`), `api.app.streamStop(id)`:
  für ndjson-Streams (Lichess TV).

## TTS-Client (Vorlesen): `app/src/ui/reader/tts-client.js`
```js
import { ttsClient } from './tts-client.js';
await ttsClient.status()                    // { english: 'ready'|'loading'|'unavailable', german: 'ready'|'starting'|'unavailable'|'not-installed' }
const session = ttsClient.speak(sentences, { lang: 'de'|'en'|'auto', voice, speed,
  onSentence(i) {}, onEnd() {}, onError(e) {} });   // sentences: string[]; erzeugt Audio sequenziell mit Vorab-Puffer
session.pause(); session.resume(); session.stop(); session.skip(±1)
```
Englisch: Kokoro (kokoro-js) im Web Worker `app/src/workers/tts-worker.js` (WebGPU, sonst WASM).
Deutsch: Piper- und Kokoro-Stimmen in eigenen Web Workern, Kartoffelbox/Chatterbox über den Python-Sidecar nur als altes
Verfahren. Die vollständige Schnittstelle mit den Neuerungen von 0.7 (Sprache je Satz `langs`, Schachnotation,
Stimmenmenü, `downloadAllVoices()`) steht in `docs/TTS.md`.

## Schach-Komponente: `app/src/ui/chess/chess-board.js`
```js
import { createChessBoard } from '../chess/chess-board.js';
const board = createChessBoard(container, { mode: '2d'|'3d', orientation: 'white', free: true, fen });
board.setFen(fen); board.getFen(); board.setMode('3d'); board.flip(); board.destroy();
board.onChange((fen) => {});     // nach jeder Änderung (Zug / Editor)
board.playSan('1.e4 e5 2.Nf3');  // Züge aus dem Buch nachspielen (chess.js)
```
Engine (Stockfish, Worker `app/src/workers/stockfish-worker.js`) in `app/src/ui/chess/engine.js`:
```js
import { createEngine } from '../chess/engine.js';
const eng = await createEngine();  eng.analyse(fen, { depth: 14 }, ({ score, pv, depth }) => {});  eng.bestMove(fen, { movetime: 800 }) → Promise<'e2e4'>;  eng.stop(); eng.destroy();
```

## Medien: Mediathek, Hörmodus, Leinwand (ab 0.3)

Ein einziger Film-Player für die ganze App: `app/src/media/media-player.js` → `mediaPlayer`.

```js
mediaPlayer.video                         // das eine <video>-Element (crossOrigin='anonymous')
mediaPlayer.current                       // { id, title, topic?, channel?, description?, duration?, live?, poster?,
                                          //   src, hls?, subtitle?, stream? } oder null
mediaPlayer.mode                          // 'panel' | 'audio' | 'screen' | 'full' | null
mediaPlayer.onChange(fn) → off            // fn(snapshot): { current, mode, playing, buffering, position, duration,
                                          //                 volume, spatialGain, error, live }
mediaPlayer.play(item, { mode, startAt }) // mode 'panel' (im Mediathek-Panel), 'audio' (nur hören), 'screen' (Leinwand)
mediaPlayer.setMode(m) · toggle() · pause() · resume() · seek(s) · skip(Δs) · stop()
mediaPlayer.setVolume(v) · setSpatialGain(g)   // Lautstärke = volume × spatialGain (spatialGain nur im Modus 'screen':
                                               // Abstand zur Leinwand)
mediaPlayer.attach(container, mode = 'panel') · detach()   // ein Panel ('panel') oder das Vollbild ('full') zeigt das
                                                           // Video / gibt es wieder ab (es läuft weiter)
```

`'full'`: der Film im Vollbild über der ganzen App (`app/src/ui/film-fullscreen.js`). Es übernimmt das Video mit
`attach(container, 'full')` und gibt es beim Verlassen mit `setMode('screen')` oder `setMode('audio')` zurück. Untertitel
zeichnet der Browser in 'panel' und 'full' selbst, in 'screen' liest der HUD sie für seine Zeile.

* **CORS-sauber**: Die Leinwand rendert `mediaPlayer.video` als `THREE.VideoTexture`. WebGL lehnt Videos ohne CORS ab,
  daher laufen entfernte Quellen immer über den Proxy `media://` (Hauptprozess, `electron/mediathek`, mit Range und
  `Access-Control-Allow-Origin: *`), lokale Downloads über `lfile://`. HLS (`.m3u8`, Live-TV, arte) spielt hls.js ab
  (dynamischer Import von `hls.js`); auch dessen Playlist- und Segment-Abrufe gehen über `media://`.
* Bus: `media:change` (Snapshot), `media:mode`, `media:ended`, `media:stopped`.
  `cinema:watch` (Mediathek-Panel, Miniplayer → main.js): Panels schließen, die Leinwand fährt herunter. Niemand wird
  hingesetzt, man bleibt, wo man ist. Außerhalb der Halle (z < −5,5) sagt ein kurzer Hinweis, dass der Film auf der
  Leinwand in der Halle läuft. Wer schon auf dem Sofa sitzt, schaut zur Leinwand hoch.
  `media:fullscreen` (Miniplayer → main.js): der laufende Film ins Vollbild.
* Welt (`app/src/world/cinema.js`): Bei `mode === 'screen'` fährt die Leinwand an der Kaminwand herunter, der Beamer
  hinter dem Sofa geht an, das Hallenlicht wird gedimmt; ohne Film ist die Leinwand eingerollt. `E` auf die Leinwand =
  Pause/Weiter, `E` auf den Beamer = Mediathek.
* Tasten in der Welt: `V` Mediathek · `I` Lesebrowser · `K` Pause/Weiter · `J`/`L` zurück/vor (Film 10 s, Podcast 15 s),
  jeweils für die aktive Quelle (siehe unten) · `F` Vollbild für einen Film auf der Leinwand oder als Ton (auf ein Buch
  gerichtet bleibt `F` die Buchinfo) · `Leertaste` aufstehen (sonst nichts; `Q` steht nicht mehr auf).
* HUD-Miniplayer: `app/src/ui/media-bar.js` (+ `styles/media.css`, `styles/player.css`) für die aktive Quelle: ein Film
  in den Modi 'audio' und 'screen' (±10 s, Leinwand oder Ton, Vollbild, Im Fenster, Beenden) oder ein Podcast (Cover,
  Folge, Sendung, ±15 s, Podcasts, Beenden).

### Eine Quelle zur Zeit, Systemsteuerung, Vollbild
* `app/src/media/focus.js` → `mediaFocus`: Filme (`'film'`), Podcasts (`'podcast'`) und Vorlesen (`'tts'`) melden sich
  mit `register(id, { hold, loaded })` an und rufen `claim(id)`, sobald sie starten. Alle anderen Quellen pausieren dann
  (`hold`), nichts wird verworfen. Das Vorlesen pausiert ebenfalls (die Leisten von Reader, Lesebrowser und
  Vorlese-Knopf zeigen „Weiter vorlesen“). Die Hintergrundmusik ist keine Quelle, sie wird nur leiser (`audio.duck`).
  `active(ids?)` ist die Quelle, die zuletzt gestartet ist und noch etwas geladen hat; `onChange(fn)`, `changed()`.
* `app/src/media/transport.js` → `activeTransport()`: Film oder Podcast als eine Schnittstelle
  `{ id, step, info(), toggle(), play(), pause(), skip(Δs), seek(s), stop() }` für Miniplayer, `K`/`J`/`L` und die
  Systemsteuerung.
* `app/src/media/media-session.js`: `navigator.mediaSession` mit Titel, Sendung oder Sender und Bild der aktiven Quelle
  (Medien-Overlay von Windows), dazu Handler für Play, Pause, Stopp, Zurück und Vor (Medientasten der Tastatur springen
  wie `J`/`L`), Spulen und Springen; bei Live-TV nur Play, Pause und Stopp.
* `app/src/ui/film-fullscreen.js`: schwarze Fläche über allem, das Video mit `object-fit: contain`, Bedienung blendet
  sich aus. `Esc` oder `F` verlassen, `K` oder `Leertaste` Pause, `J`/`L` ±10 s, `←`/`→` ±5 s; keine Taste erreicht die
  Welt, die Maus wird freigegeben, die Render-Schleife ruht und läuft danach weiter. Die Fullscreen-API des Browsers
  kommt nur zum Einsatz, wenn `api.app.info()` `hidden: false` meldet; unsichtbare Testfenster (`COZYSHELVES_HIDDEN`)
  gehen nie ins Vollbild (Berechtigung und `app:setFullscreen` sind dort gesperrt).

### Mediathek-IPC (`api.invoke('mediathek:…')`, `electron/mediathek`)
`query(opts)` · `variants(item)` · `channels()` · `topics(channel)` · `live()` · `liveNow(ids)` · `diagnose(url)` ·
`sizes(item)` · `favorites()` · `setFavorite(item, on)` · `progress()` · `position(item, pos, dur)` · `startAt(id)` ·
`continue()` · `forget(id)` · `download(item, quality)` · `downloads()` · `pause(id)` · `resume(id)` ·
`remove(id, { files })` · `playable(id)` · `reveal(id)` · `folder()` · `pickFolder()` · `resetFolder()` · `stats()`;
Ereignis `mediathek:download` (Fortschritt).

Item: `{ id, channel, topic, title, description, timestamp (ms), duration (s), size, website, subtitle,
video: { low, sd, hd }, hls, variant, geo }`.

Player zusätzlich: `setQuality(q)`, `setSubtitles(on)`, `toggleMute()`, `setMuted(m)`, `retry()`; der Snapshot trägt
außerdem `quality`, `qualities`, `subtitles`, `hasSubtitles`, `cue`, `muted`, `buffered`, `errorKind`, `local`.
Bus `media:position`. Panel: `openPanel('mediathek', { section, query, play: item, open: item, show: 'player' })`.

#### Neu in 0.7: englische Quellen, Auflösungen, Live-Sender
```
mediathek:query(opts)            opts.source (eine Quelle) oder opts.sources: [ids] mit cursor { id: offset|null }
                                 → { items, total, totalRelation, offset, size, hasMore, received, cursor, failed[] }
mediathek:resolve(item)          → das Item mit seinen Dateien (nur Adressen auf den Hosts dieser Quelle)
mediathek:heights(item)          → { <key>: { width, height, p, label } }   (Auflösungen, media-player.js)
mediathek:sourceTopics(id)       → [{ id, title, sub? }]    (Themen, Sendungen, Sammlungen einer Quelle)
mediathek:downloadOptions(item)  → [{ quality, height, width, bytes, error? }]
mediathek:download(item, quality)   quality: jeder Schlüssel von item.video oder 'h<Höhe>' für einen HLS-Master
```
* Quellen in `electron/mediathek/sources/` (`dw`, `nhk`, `nasa`, `archive`, `ted`, gemeinsamer Teil `common`, Index
  `index.js` mit `list(opts)`, `resolve(item)`, `topics()` je Quelle); arte auf Englisch kommt über MediathekViewWeb.
  `channels()` hat die Gruppe `en` (DW.EN, NHK, ARTE.EN, NASA, IA, TED) mit `{ lang, source, search, long, note }`.
* Items tragen zusätzlich `source, ref, programme, programId, collectionId, speaker, lang, image, lazy, year, heights,
  hls`; die Schlüssel von `video` sind frei (`h1080` …). Download-Einträge und das Ereignis `mediathek:download` tragen
  `height`.
* Auflösungen: `electron/mediathek/heights.js` liest sie aus den Adressen, dem Kopf der MP4-Datei oder `RESOLUTION` der
  Playlist und merkt sie sich in `<userData>/mediathek/heights.json`. Renderer: `app/src/media/quality.js`
  (`preferenceOf()` übersetzt alte Werte), `media-player.js` mit den Werten `'auto' | 1080 | 720 | 480 | 360`, `Q`
  öffnet die Liste im Player.
* Live-TV (`live.js`, `live-channels.json`): Gruppe `en` mit DW English, FRANCE 24 English, Al Jazeera English und
  NHK WORLD-JAPAN, nur über Adressen, die die Sender selbst veröffentlichen. `resolve: { url, path }` liest die Adresse
  beim Start aus dem Dokument des Senders (DW, NHK), `now: 'dw'` nennt die laufende Sendung. Weist ein Sender seine
  Adresse ab, meldet der Player „nicht erreichbar“. Neue Wege im Protokoll `media://`: `media://image/<b64url>` und
  `media://live/<Sender-ID>/master.m3u8`.
* Zeitungen nach Sprache: `app/src/ui/news/news-lang.js` (`langOfFeed`, `feedsFor(feeds, lang, others, keep)`,
  `categoriesFor`, `filterKey`), Einstellung `news.otherLanguages`. Der Zeitungsständer der Welt folgt `i18n:change`.
  `build/feeds-lang-audit.js` prüft die Sprache aller Feeds (Netz) und schreibt
  `electron/feeds/fixtures/feed-languages.json`.
* Die Leinwand misst die Farbe ihres Lichts aus einem 16 × 9 Punkte großen Bild, das ein Worker nach einem Fence liest
  (`cinema.js`), statt das ganze Filmbild von der Grafikkarte zu kopieren.

### Heimkino in der Welt (`app/src/world/cinema.js`)
Leinwand vor dem Kaminschornstein (Platzierung `screen`), Beamer auf einem Sockel hinter dem Sofa (`projector`,
Interaktion `mediathek`). Die Leinwand reagiert nur auf `mediaPlayer.onChange`: bei `mode === 'screen'` rollt sie in
3,2 s herunter, danach blendet das Bild ein; die Hallenlampen werden auf 28 % gedimmt, ein Scheinwerfer an der Leinwand
nimmt die mittlere Bildfarbe an (Stichprobe alle 0,2 s aus dem CORS-sauberen Video), und `setSpatialGain` senkt die
Lautstärke mit dem Abstand (volle Lautstärke bis 5,5 m, im Bücherzimmer 20 %). `E` auf das Bild (auch vom Sofa aus,
Reichweite 18 m) = `onInteract('screen')` → Pause/Weiter. Das Lesegerät (`ereader`, Interaktion `browser`) steht an der
Südwand neben dem Lexikon-Pult.

## Volltextsuche (ab 0.7)
Der Index liegt in `<userData>/fulltext/index.sqlite` (node:sqlite aus Electron, FTS5 ohne Inhalt und Positionen, dazu
der Text jeder Seite mit deflate gepackt). Hauptprozess: `electron/search/fulltext.js` (welches Buch fehlt, Pausen, Status,
Anfragen), der Index-Thread `fulltext-worker.js` → `fulltext-db.js`, die Wortregeln `textnorm.js` (auch im Renderer
gebündelt). Gelesen werden die Bücher in einem eigenen unsichtbaren Fenster (`app/fulltext.html`,
`electron/preload-fulltext.js`, `app/src/search/extract.js`: PDF je Seite, sonst Abschnitte in Stücken von etwa
2000 Zeichen, `dom-text.js`); es besteht nur, solange es etwas zu lesen gibt, und wird nach 120 Büchern erneuert.
```
api.invoke('fulltext:status', { detail? })   → { enabled, total, done, notext, errors, bytes, running, paused, current, books? }
api.invoke('fulltext:search', { q, department?, language?: 'de'|'en'|'other', offset, limit, hits })
    → { ok, q, ms, totalBooks, totalHits, books: [{ id, hits, kind: 'pdf'|'flow',
          items: [{ u, page, pos?, chapter?, loc: { p } | { s, o, len }, snippet: { text, marks: [[a, b]], pre, post } }] }] }
api.invoke('fulltext:more', { q, id, offset, count }) → { id, total, items }
api.invoke('fulltext:activity', { reading, tts, film, busy })   (app/src/ui/search/activity.js, einmal je Änderung)
api.invoke('fulltext:rebuild') · api.invoke('fulltext:delete') (nur ausgeschaltet)    Ereignis 'fulltext:status'
```
Bus: `book:open-hit` `{ id, hit }` öffnet den Leser an einem Treffer (`hit = { q, u, kind, loc, page, pos }`,
Leser-Parameter `params.hit`, `app/src/ui/reader/reader-hit.js`), `reader:goto-hit` `{ id, hit }` springt im offenen
Leser desselben Buchs. Panel: `openPanel('search', { q?, from: 'reader', bookId? })`. `library.searchText` (Katalog des
Computers, Modus „Volltext“) fragt den Index, solange es einen gibt.

Im Status ist `paused` `null`, `'off'`, `'library'`, `'reading'`, `'tts'`, `'film'` oder `'busy'`, `current` =
`{ id, title, unit, units }`. `fulltext:size()` → Bytes (zurzeit ohne Aufrufer). Das Lesefenster spricht nur über
`window.fulltextApi` (`electron/preload-fulltext.js`): `fulltext:source(id)` → `{ text }` | `{ html }` | `null`,
`fulltext:units(jobId, units, next, …)` → `{ stop, open? }`, `fulltext:end(jobId, { state, units, error })` und
`fulltext:hello`; der Hauptprozess schickt ihm `fulltext-job`, `fulltext-gate` und `fulltext-abort`. Einstellung
`fulltext: { enabled: true }`. Für Prüfungen: `COZYSHELVES_FULLTEXT_DELAY` (ms bis zum Beginn, sonst 20000) und
`COZYSHELVES_FULLTEXT_PRIORITY=normal` (das Lesefenster behält die normale Priorität).

## Hörbücher (ab 0.7)
Hauptprozess `electron/audiobooks/`: `tags.js` liest die Tags (ID3 mit Kapiteln, MP4, FLAC, Ogg, WAV), `scan.js` macht
aus Ordnern und Dateien Hörbücher, `cache.js` merkt sich die Tags, `library.js` hält Bestand und Lesestand, `index.js`
registriert die IPC. Die Ordner stehen in `settings.audiobooks.folders` (`[{ path }]`), ihre Dateien sind über `lfile://`
erlaubt.
```
api.invoke('audiobooks:state')                → { folders: [{ path }], books: [Hörbuch], scan }
api.invoke('audiobooks:book', id)             → Hörbuch + { tracks: [{ url, name, title, duration, exact, start }],
                                                            chapters: [{ track, offset, title }] } | null
api.invoke('audiobooks:addFolder')            → [{ path }] | null   (Ordnerauswahl von Windows)
api.invoke('audiobooks:removeFolder', path)   → [{ path }]
api.invoke('audiobooks:rescan')               → true
api.invoke('audiobooks:progress', id, patch)  → progress | null     patch: { track, offset, position, duration, rate, finished, reset, touch }
api.invoke('audiobooks:trackDuration', id, index, seconds) → bool
api.invoke('audiobooks:reveal', id)           → bool                (im Explorer zeigen, nie in unsichtbaren Testfenstern)
Ereignisse: 'audiobooks:update' (state, gebündelt), 'audiobooks:progress' { id, progress },
            'audiobooks:scan' { active, phase: 'idle'|'walk'|'tags', done, total, unavailable[], files, at }
```
Hörbuch = `{ id, kind, title, author, narrator, series, seriesIndex, year, genre, description, duration, trackCount,
chapterCount, formats, size, mtime, added, path, folder, cover: { thumb, large, color } | null, progress: { track, offset,
position, duration, finished, lastPlayed, rate } | null }`.

Renderer `app/src/ui/audiobooks/`: `ab-store.js` (`abStore`, Bus `audiobooks:change` `{ reason, id? }`), `ab-panel.js`
(Panel `audiobooks`: `{ id }` öffnet den Player dieses Hörbuchs, `{ show: 'player' }` den des geladenen),
`ab-settings.js` (`openPanel('settings', { section: 'audiobooks' })`), `ab-card.js` (die Karte im HUD), `ab-player.js`:
```js
audiobookPlayer.open(idOrBook, { at, chapter, play }) · pause() · resume() · toggle() · stop()
audiobookPlayer.seek(sec, { play }) · skip(Δs) · seekChapter(i) · nextChapter() · prevChapter()
audiobookPlayer.setRate(r) (0,75 bis 2,5) · setVolume(v) · setSleep(mode) · markFinished(id, done)
audiobookPlayer.state · current · rate · onChange(fn) → off
```
Das Hörbuch ist eine dritte Quelle für `mediaFocus` (`'audiobook'`) und `media/transport.js` (`audiobookTransport` mit
`step` 15, `back` 15, `fwd` 30 und `previous()`/`next()` für die Kapitel; `J`/`L` nehmen `back`/`fwd`, wenn es sie gibt).
Bus: `audiobook:play`, `audiobook:open`, `audiobook:stop`, `audiobook:ended`, `audiobook:sleep-ended` (je mit der ID).
Welt: `world.audiobooks` (`world/audiobook-shelf.js`, `AudiobookShelf`: `setBooks(list, total)`, `pick(ray, far)`,
`setHover(i)`, `viewOf(i)`, höchstens `AB_CAPACITY` = 24 Boxen), Platzierung `'audiobooks'` an der Südwand der Halle
(seit 0.7.1 immer, ohne Hörbuchordner mit leeren Fächern: `applySettings(s)` setzt nur `enabled`, die Welt wird nicht
neu gebaut, `buildLayout` kennt die Option `audiobooks` nicht mehr), Ort `'audiobooks'`, Ziel
`{ type: 'audiobook', id, index }`, das Regal selbst `onInteract('audiobooks')` (Beschriftung „Hörbücher · E Öffnen“),
`onInteract('audiobook', { id, key: 'E'|'F' })`. Daten: `audiobooks.json`, `audiobook-tags.json` und
`audiobook-covers/` im Datenordner, `localStorage` `lesesaal.audiobook.rate`, `lesesaal.audiobook.volume`,
`lesesaal.audiobooks.sort`. Tests: `COZYSHELVES_AUDIOBOOKS=<Ordner>[;…]` füllt eine leere Liste der Hörbuchordner,
`audiobookPlayer.testTime` kürzt den Schlaftimer.

## Regale: „Gelesen“, Leseziel, doppelte Bücher, Sortierung (ab 0.7)
* `api.invoke('library:markRead', id, read)` → das Buch oder `null`, sendet `library:book`. In der Welt die Taste `C`
  (`toggleReadAimed()` in `ui/shelves.js`), in der Buchinfo „Als gelesen markieren“.
* Gelesen ist ein Buch ab 97 % (`FINISHED_AT`) oder von Hand markiert. Neue Felder im Book:
  `finishedAt, readMark, finished, series, seriesIndex, born, dupGroup, dupReasons, metaWeb`; `language` ist ein Code
  aus zwei Buchstaben oder `null`. `library:stats` liefert dazu `readToday` und `goal: { year, count, target, ids }`.
* Reine Module, auch im Renderer gebündelt: `electron/library/reading-log.js` (`isFinished`, `setReadMark`, `streakOf`
  mit `STREAK_SECONDS` = 300, `booksReadIn`, `readingGoal`), `duplicates.js` (`findDuplicates` →
  `{ groups: [{ id, ids, reasons: 'file'|'isbn'|'title' }], groupOf }`, `preferredCopy`), `shelf-order.js`
  (`SORT_MODES`, `parseSeries`, `sortIds`), `language.js` (`normalizeLanguage`).
* Welt: `world.rearrangeShelves()` ordnet die Bücher in den Regalen neu, ohne die Welt neu zu bauen. `layout.js`:
  `READ_SHELF` = `'room:read'` (links vom Durchgang), `arrangeFor(departments, booksById, shelves)`
  (`shelf-arrange.js`). Ort `'finished'`, im Rad der Eintrag `'finished'` (`ctx.world.readShelf()`). Seit 0.7.1 hat das
  Regal weder die Karte im leeren Regal noch das Schild mit Leseziel und Lesesträhne: `world.setReadingPlaque`,
  `read-plaque.js` und `plaqueText` (`ui/shelves.js`) sind entfallen, die Beschreibung des Regals trägt kein `plaque` und
  kein `displayX` mehr, auf dem schrägen Brett liegen die zwei zuletzt gelesenen Bücher mit Cover an den üblichen
  Plätzen. Leseziel und Lesesträhne zeigt die Statistik des Computers (`ui/computer/sections/stats.js`).
* Panel `duplicates` (`ui/duplicates.js`) aus *Einstellungen → Bücherordner* und am Computer unter *System*.
* Einstellung `shelves: { finishedShelf: true, readingGoal: 0, dedupe: true, sort: 'title' }`, `sort` ist
  `title|author|year|publisher|series|added|read`. Beim Start verwirft `library.js` unbrauchbare Sprachangaben (die
  Sprache wird dann aus dem Text geschätzt), Bücher ab 97 % bekommen ein `finishedAt`. Test-Hook
  `window.__app.shelves = { arrange(), check() }`.

## Cover und Metadaten (ab 0.7)
`electron/library/web-covers.js` (Ablauf und IPC), `cover-sources.js` (die Kataloge Open Library, Goodreads, Apple Books,
DNB, Internet Archive und Google Books, Amazon nach ISBN oder ASIN; Budget und Pausen je Host), `book-match.js` (welcher
Eintrag das Buch ist, `metadataFrom`), `image-engines.js` (Bing, Yandex; DuckDuckGo in `web-covers.js`), `cover-batch.js`
(„Alle Cover jetzt laden“, sechs Bücher zugleich), `cover-match.js`.
```
covers:status()                  zusätzlich metadata, waiting, lastMiss, meta, imageNext, batch, rests,
                                 engines: { bing, yandex, duckduckgo: { on, wait, searches } }
covers:candidates(id, { refresh, web })
                                 → { ok, items: [{ key, preview, source, engines?, site, title, info?, width?, height?, sites, current }],
                                     web: { state: 'none'|'done'|'off'|'wait'|'busy'|'offline', wait }, offline, own: { preview } | null }
covers:useCard(id)               → { ok, book }       das generierte Titelbild bleibt (coverChoice 'card')
covers:chooseFile(id)            → { ok, book } | { ok: false, error: 'canceled'|'unknown book'|'file'|'undecodable' }
covers:batch(cmd)                cmd: 'start'|'retry'|'pause'|'resume'|'cancel' → Status
Ereignis 'covers:batch'          { state: 'idle'|'running'|'paused'|'done'|'cancelled', total, done, found, missed, failed,
                                   skipped, later, current[], waiting, engineWait, startedAt, finishedAt, elapsed, perBook,
                                   perMinute, peak }
covers:choose · covers:useBook · covers:prioritize      wie bisher
```
Renderer: `ui/cover-picker.js` („Anderes Cover“ in der Buchinfo), `ui/cover-settings.js`. Neue Felder im Book: `series`,
`seriesIndex`, `asin`, `coverChoice`, `metaWeb = { at, q, src: { Feld: Quelle }, val: { Feld: Wert } }`. Einstellungen
`webCovers`, `webMetadata`, `coverEngines`, `googleBooksKey`. `web-covers.json` hält dazu `fast`, `rests`,
`placeholders`, `batch` (ein Lauf geht nach einem Neustart weiter) und die letzten Suchen bei DuckDuckGo. Für
Prüfungen: `COZYSHELVES_COVERS_FIXTURES`, `COZYSHELVES_COVERS_LIVE`, `COZYSHELVES_COVERS_RECORD` (neu dazu
`COZYSHELVES_COVERS_RECORD_DDG=1`), `COZYSHELVES_COVERS_SYNTH=1` mit `COZYSHELVES_COVERS_SYNTH_DELAY` (erfundene Antworten,
`cover-synth.js`), `COZYSHELVES_COVERS_PACE` (Pausen je Host) und `COZYSHELVES_COVERS_GAP` (ms zwischen zwei Büchern im
Hintergrund).

## Himmel, Wetter, Tageszeit (ab 0.7)
`world.sky` ist ein `SkyState` (`app/src/world/sky-state.js`); `sky.js` zeichnet Sterne, Milchstraße und Mond,
`celestial.js` rechnet (50° N, 10° O, Sternzeit, Mondphase, `sunPosition`, von `environment.js` weitergereicht).
```js
TIME_MODES = ['real', 'cycle', 'day', 'night', 'fixed', 'golden']   WEATHER_MODES = ['fixed', 'changing', 'live']
DAY_LENGTHS = [10, 20, 30, 60, 120]
world.sky.hour · skyHour · sun · phase · mix · live   // live: { status, place, phase, wind, at, code, temp, error }
world.sky.onChange(fn) → off   // fn(state): Wetter, Regen, Donner, Schnee, Wind oder Nebel wechseln, oder das echte Wetter ist da
world.sky.force(phase) · simulate(seconds, { allow, winter, seed, step, start }) · moonPhase()
world.weatherState() → { name, base, phase, mode, fog, wind, thunder, rain, snow, cloud, overcast, wet, cover, live }
```
Phasen: `clear, fair, overcast, rain, storm, snow, clearing, mist, fog, drizzle, snowfog`. `env.state.weather` direkt zu
setzen wählt kein Wetter mehr (dafür die Einstellungen oder `world.sky.force(phase)`), der Takt des Tag-Nacht-Wechsels
folgt nicht mehr `world.time`. Weitere Exporte: `searchPlaces(name, lang, fetch)` (Geocoding von Open-Meteo über
`api.app.fetch`), `fits` und `REASONS` (was nicht zusammenpasst und warum), `legacyWeather`, `fixedWeatherOf`.
`glass-reflect.js` (`RoomReflections`) legt nachts ein leises Spiegelbild des Raums ins Glas, `env.nightEye()` passt die
Belichtung draußen an die Nacht an. Einstellungen: `sky: { mode: 'fixed', base: 'clear', fog: false, wind: false,
allow: { rain, storm, fog, snow }, dayMinutes: 30, place: null }` (`place` = `{ name, lat, lon }`), `timeMode` dazu
`'day'` und `'night'`; `weather` bleibt als altes Wort. Übernahme (`sky.schema` = 1): `weather: 'fog'` wird
`base: 'overcast'` mit `fog: true`. Das echte Wetter fragt `api.open-meteo.com` alle 30 Minuten und merkt es sich in
`localStorage` `lesesaal.liveWeather`. Test: `?moon=<0…1>` setzt die Mondphase.

## Garten: Jahreszeiten, Seerosen, Schilf, Feuerschale (ab 0.7)
* Die Jahreszeit kommt aus `settings.season` über `season.js` (`seasonOf`). `garden.setSeason(setting, opts)` → die
  Jahreszeit; `world.applySettings` ruft es vor `env.set` auf, die Reihenfolge muss bleiben. `seasons.js` tauscht nur
  Farben, Texturen und Anzahlen (`NATURE.uSeason`), gebaut wird nichts.
* `lilies.js` und `flora.js` (Seerosen, Blumen), `reeds.js` (Schilf und Rohrkolben). `garden.lilyPads` = `[{ x, z, y, r }]`
  ist ein festes Array, das je Jahreszeit neu gefüllt wird (bei Schneefall leer); die Frösche lesen es (`pond.js`).
  `LILY_PADS` gibt es nicht mehr.
* Die Bäume gehen zwischen 45 und 70 m gleitend in ihre einfachere Form über (`NATURE.uLodNear`, `uLodFar`), jenseits
  von 70 m tauscht `garden.js` die Vorlage.
* Feuerschale (`firebowl.js`): `world.fireBowl` mit `position`, `level`, `isBurning()`, `toggle()` → bool und
  `setBurning(true|false|null)`; Bus `firebowl:change` `{ burning }`; Interaktion `'firebowl'` (`E`), Platzierungen
  `'firebowl'` und `'stump'` (vier Sitze), `outdoor.js` `FIREBOWL`, Ort `'firebowl'`. Ihr Licht fällt über
  `NATURE.uFireLight` und `uFirePos` auf den Garten, die Zahl der Punktlichter bleibt.

## Tiere: Wildtiere, Futterstelle, Vögel, Kois, Frösche (ab 0.7)
* `wildlife.js`: bis zu drei Gruppen am Tag und in der Dämmerung, eine in der Nacht. Einstellung `wildlifeRate`
  `'rare'|'normal'|'often'` (Standard `'often'`, `'rare'` entspricht 0.6). `wildlife-views.js` (`WINDOW_SIDES`,
  `houseViews`, `lookingOut`) kennt die Fenster, neue Fenster brauchen dort einen Eintrag. Für Prüfungen:
  `simulate(seconds, { hour, weather, watching, step, mode, side })`, `focusFor(side)`, `hourOverride`,
  `weatherOverride`, `seasonOverride`, `modeOverride`.
* Die Flucht (ab 0.7.1, seit 0.7.2 ein zügiger Trab, `wildlife.js`, Abschnitt „the flight“): `SHY[kind]` = `[alert,
  flee]` in Metern (Reh und Kitz 24 und 14, Hirsch 28 und 17, Fuchs 18 und 10). Innerhalb von `alert` schaut ein Tier
  den gehenden Spieler an (`'alert'`, `#faceHalf`); kommt er weiter näher, geht es 3 bis 5 m weg (`#stepAway`); steht
  er 6 s still oder entfernt er sich, beruhigt es sich und macht weiter, was es tat. Innerhalb von `flee` flieht es
  (`#flee`, `#bolt`) nach `FLIGHT[kind]`: `stop` (Abstand zum Spieler, in dem es stehen bleibt, innerhalb seiner
  Alarmdistanz: Reh 16 bis 24 m, Hirsch 18 bis 26 m, Fuchs 12 bis 18 m), `watch` (wie lange es dann schaut: 7 bis 13
  s, Hirsch 8 bis 15 s, Fuchs 3 bis 6 s, länger nach jeder weiteren Flucht), `trot` (das Tempo der Flucht, ein zügiger
  Trab: Reh und Kitz 3,4 m/s, Hirsch 3,8 m/s, Fuchs 3,2 m/s, jeweils ±4 %, gleich ob der Spieler geht oder rennt),
  `accel` und `brake` (3 m/s²) und beim Fuchs `sit` (0,6: so oft setzt er sich zum Schauen hin). Einen Galopp gibt es
  in der Flucht nicht mehr; `GAIT.gallop` in `wildlife-models.js` bleibt als Testpose `'gallop'` (die Galopp-Pose
  setzt erst über dem 1,6-fachen Trab ein, das Kitz läuft höchstens mit dem 1,5-fachen Trab). Das Ziel ist offenes
  Gelände in Sichtweite des Spielers mit mindestens 8 m Laufweg (`#flightPath`, `#inView`, mit einem Budget an
  Rasterzellen für `Field.path`); über die letzten 4 m fällt das Tempo auf einen leichten Trab und Schritt
  (`#flightPace`), danach steht es (`'wary'`, `#wary`), beruhigt sich (`#relax`) und zieht zu Plätzen abseits vom
  Spieler (mindestens seine Alarmdistanz, der Weg kommt ihm nicht näher als der Standplatz) und fort vom Ort des
  Aufschreckens (mindestens 12 m und nicht näher als der Standplatz; `#moveOn`, `#replan`, `#refuge`, fünf Minuten
  lang `#shy`). Flucht und Schauen zählen nicht zur Dauer des Besuchs (`visit.lost`), was die Flucht unterbrach,
  frisst es danach fertig (`resume`). Die dritte Flucht innerhalb von `CHASE.window` = 300 s oder kein Fluchtziel (die
  Gruppe steht am Waldrand) schickt die Gruppe in den Wald. Das Kitz läuft etwa 3 m hinter der Mutter. Steht der
  Spieler draußen näher als 20 m an der Futterstelle (32 m nach einer Flucht von dort, `#byFeeder`) und sitzt nicht im
  Beobachtungsstand, kommt keine Gruppe an die Raufe. Der Wolf verhält sich wie bisher. Für Prüfungen: `visit.leftFor`
  (`'done'`, `'chased'`, `'cornered'`, `'storm'`, `'time'`, `'wolf'`, `'room'`, `'stuck'`), `visit.flights`,
  `visit.scare`, `planMs` (die längste Planung in ms), `sitOverride` (0 oder 1, sonst `null`) und die Testposen
  `'sit'` und `'gallop'`. Neue Einstellungen gibt es dafür nicht.
* `feeder.js` baut Heuraufe, Trog und Salzlecke (Platzierung `'feeder'`) und den Beobachtungsstand (`'feederhide'`).
  Wer auf dessen Bank sitzt (Sitz `'feederhide'`), gilt für die Tiere als versteckt. `outdoor.js` `FEEDER`, Ort
  `'feeder'`.
* `world.fauna` (`fauna.js`) mit `birds` (`birds.js`, `bird-models.js`, `bird-places.js`), `koi` (`koi.js`) und `frogs`
  (`frogs.js`, `pond.js`): `setEnabled(on)`, `update(dt)`, `prepareAll()`, `info()`, `splash(x, z, size)`; für Prüfungen
  `hourOverride`, `weatherOverride`, `seasonOverride`. Einstellung `fauna: true`. Der Shader der Tiere nutzt alle 16
  Vertex-Attribute, beim Aufwärmen kommen drei Programme dazu.

## Bücherzimmer eingeschossig (ab 0.7.2)
Das Bücherzimmer ist wieder 5 m hoch (`ROOM.h`), ohne Galerie (die Galerie von 0.7 und 0.7.1 ist entfallen). `gallery.js`
und `levels.js` gibt es nicht mehr, `player.floorAt(x, z)` liefert innen 0. Regale, Schilder, Sitze und Orte haben kein
`y` und kein `meta.floor` mehr. `player.groundAt(x, z, ref)`, `bounds.keep(p, r, feet)`, `bounds.free(x, z, r, feet)`,
`speedAt`, `noJumpAt` und `isFree(x, z, margin, floor)` bleiben als allgemeine Haken in `player.js`. Passt eine Bücherei
nicht an die Wände (`allocate` findet keine Verteilung), zeigt das Zimmer eine Abteilung (`L.allDepartments` false,
`L.department`), `world.setDepartment(name)` wechselt sie, `localStorage['lesesaal.department']` merkt sie sich. Die
Einträge der Tafel (`L.directory.entries`) tragen `id`, der Plan zeigt die Nummer der Liste. Der frühere Ort `'gallery'`
der Halle heißt seit 0.7 `'hall'` („Mitte der Halle“); der Ort `'gallery'` des Bücherzimmers und die Sitze `'gbench<n>'`
sind seit 0.7.2 entfallen.

## Böden, Graffiti, Lampen (ab 0.7)
* `world.floors` (`floors.js`, `FloorFinish`): ein Material für alle Böden (`M.floor()`), gemalt von
  `workers/floor-worker.js` (`floor-art.js`) und in Streifen hochgeladen (`texture-stream.js`); `apply(style)`, `info()`.
  Die Stile stehen in `floor-styles.js` (`FLOOR_STYLES`: `oak, herringbone, walnut, maple, marble, terracotta, stone,
  terrazzo, carpet, cement`), Einstellung `floor: 'oak'`, Bus `floors:painting` (bool). Waagerechte Böden nehmen
  `M.floor()`.
* Graffiti in der Sprache der Oberfläche: `wall-art.js` `MURAL_WORDS { de, en }`, `planMural(walls, seed, lang)`;
  `walls.js` malt bei `i18n:change` neu. `world.relabel()` beschriftet Schilder, Tafel und Regale in der neuen Sprache,
  ohne die Regale neu zu bauen.
* Lampen schalten: `world.lampSwitch` (`lamp-switch.js`, `LampSwitch`) mit `register(obj, id, world)` für Lampen, die ein
  Modul selbst baut, `toggle(id)`, `set(id, on)`, `isOn(id)`, `offList()`; die ID kommt aus dem Platz im Layout
  (`lampIdOf`). Ein Schalter ändert nur einen Texel (die Stufe der Lampe), nie die Zahl der Lichter. Ziel
  `{ type: 'lamp', lamp, lampKind, on }`, `world.opts.onLamps(ids)` speichert `settings.lampsOff`.
* Pulte: `LECTERN_TOP { y: 1.07, tilt: 0.33 }` gilt für Lexikon und Lesegerät. Die Buchkarte steht in `hud.css`
  (linker Rand bei 60 % der Breite, Cover zwei Fünftel der Höhe).

## Controller (ab 0.7)
`app/src/input/gamepad.js` (`GamepadInput`, `initGamepad({ world, wheel, ctx, filmFull })`) fragt den Controller nur ab,
solange einer verbunden ist. `pad-nav.js` und `pad-panels.js` (Verhalten je Panel, `MAKERS`) bewegen den Rahmen in
Tafeln, `pad-osk.js` ist die Bildschirmtastatur, `pad-cursor.js` der Mauszeiger, `pad-hints.js` (`padState`, `glyph`,
`hintText`) setzt die Tasten in die Hinweise, `pad-settings.js` baut *Einstellungen → Controller*.
```
api.invoke('pad:mouse', { type: 'mouseMove'|'mouseDown'|'mouseUp'|'mouseWheel', x, y, down?, dx?, dy? }) → bool
    // nur das Hauptfenster, nur für sich selbst; electron/pad-input.js gibt es mit webContents.sendInputEvent ein
Bus 'pad:connection'  { active, connected, family: 'xbox'|'playstation'|'nintendo', name, vibration, standard }
Bus 'input:device'    'pad' | 'keys'     (<html data-input="pad">, solange der Controller benutzt wird)
```
Dazu `player.pad` (analoges Gehen), `player.zoom`, `wheel.point(x, y)` und `wheel.toggleRing()` (`LB`/`RB` im Rad). Einstellung
`gamepad: { sensitivity: 1.0, invertY: false, vibration: true }`. Test-Hook `window.__app.pad` (`setActive`, `rumble`,
`step`, `pressed`, `down`, …), Unit-Test `electron/test-pad-input.js`.

## Reader: Textansicht, Schriften, Seitenbreite (ab 0.7)
* Textansicht für PDFs: `pdf-text-extract.js` (Zeilen aus pdf.js), `pdf-text-assemble.js` (Absätze, Trennungen,
  Überschriften, Listen, Fußnoten, Bilder), `pdf-text-view.js`, `reader-textview.js` (`createTextViewSwitch`, Test-Hooks
  `window.__readerText` und `window.__tvTrace`). Taste `X`; `settings.reader.textView` = `{ <Buch-ID>: true }`,
  `textViewHints` zählt die Hinweise. Die Stelle merkt sich `localStorage` `lesesaal.reader.textpos` (höchstens 300
  Bücher).
* `reader-styles.js`: `FONT_SIZES` 10 bis 48, `PAGE_WIDTHS` 45 bis 110, `pageLayout()`, `fontFaces(key)`; neue Schriften
  `literata`, `sourceserif` und `atkinson` aus `app/data/fonts`. `reader.pageWidth` (68) ersetzt `reader.margin`,
  einmal übernommen mit `reader.widthSchema` = 1: `narrow` → 90, `normal` → 68, `wide` → 54 (`migrateReader`, ebenso in
  `electron/settings.js`). Das Menü Aa baut `reader-aa.js`.
* `settings:set` mischt verschachtelte Objekte; ein gelöschter Schlüssel wird nie gespeichert, für „aus“ steht deshalb
  `false`.

## Schach: Diagrammerkennung (ab 0.7)
`app/src/ui/chess/diagram/`: `squares.js` (Felder und Schraffur), `arrows.js` (Pfeile und Linien), `net.js` mit
`net-weights.js` (ein eigenes kleines Netz, int8, 102 KB), `decode.js` und `openings.js` (Suche nach den Regeln, 285
Eröffnungsstellungen), `recognize.js` (`analyzeDiagram`, Entscheidung, `TUNE`). Die angezeigte Sicherheit ist die
Wahrscheinlichkeit, dass alle 64 Felder stimmen; gelb sind Felder unter 0,8. Ausschnitte erkennt
`workers/diagram-worker.js`: `{ id, type: 'recognize', data, width, height, hints, key, book, templates? }` →
`{ id, res }` | `{ id, need: 'templates' }` | `{ id, error }`; die alte Form `{ id, data, width, height }` →
`{ id, rects }` gilt weiter. Test-Hook `window.__lastRecognition = { via: 'worker'|'page', ms }`. Neu üben lässt sich
das Netz mit `build/chess-net/`.

## Erster Start (ab 0.7)
Cozy Shelves trägt keinen Ordner mehr von selbst ein, nur `COZYSHELVES_BOOKS` setzt Ordner (Tests). Solange
`settings.folders` leer ist, öffnet sich bei jedem Start das Panel `welcome` (`ui/welcome.js`, Parameter `{}`). Es nutzt
`api.library.addFolder(mode)` (`'structured'|'auto'`) und sendet `welcome:folder` mit der Liste der Ordner (`menu.js`
hört zu). Die leere Bücherei baut `world/empty-library.js` (`WAITING_CASES`, `WAITING_NAME` „Deine Bücher“,
`waitingCard`), `layout.emptyLibrary`.

## Einstellungen in 0.7 (`electron/settings.js`, neue Schlüssel)
```
floor              'oak'                                  Fußboden (floor-styles.js)
lampsOff           []                                     ausgeschaltete Lampen (lampIdOf)
sky                { mode, base, fog, wind, allow, dayMinutes, place }   Himmel und Wetter (sky-state.js)
timeMode           dazu 'day' | 'night'
news               { otherLanguages: false }
reader             dazu pageWidth: 68, textView: {}, textViewHints: 0 (margin entfällt)
tts                dazu bookLang: {}                      Sprache je Buch aus dem Stimmenmenü ({ <Buch-ID>: 'de'|'en'|null })
wildlifeRate       'often'                                'rare' | 'normal' | 'often'
fauna              true                                   Vögel, Kois, Frösche
gamepad            { sensitivity: 1.0, invertY: false, vibration: true }
googleBooksKey     ''
coverEngines       { bing: true, yandex: true, duckduckgo: true }
webMetadata        true
audiobooks         { folders: [] }
shelves            { finishedShelf: true, readingGoal: 0, dedupe: true, sort: 'title' }
fulltext           { enabled: true }
mediathek.quality  'auto' | 1080 | 720 | 480 | 360      (aus 0.6: 'hd' → 1080, 'sd' → 480, 'low' → 360)
audio.sounds       { rain, wind, thunder, fire, firebowl, clock, birds, frogs, crickets, water, steps }, alle true
```
`audio.sounds` schaltet die Geräusche der Welt einzeln (*Einstellungen → Klang → Einzelne Geräusche*,
`app/src/ui/sound-settings.js`); `birds` gilt auch für Waldkauz, Enten und Teichhuhn. `audio.fire`, `audio.rain`,
`audio.wind` und `audio.clock` aus 0.6 werden nicht mehr gelesen. Fehlende Schlüssel füllt der Store aus `DEFAULTS`,
bevor `migrateSettings` läuft.

## Test-Hooks, Umgebung, Panels (neu in 0.7)
* Hauptprozess: `COZYSHELVES_AUDIOBOOKS`, `COZYSHELVES_FULLTEXT_DELAY`, `COZYSHELVES_FULLTEXT_PRIORITY`, `COZYSHELVES_COVERS_GAP`,
  `COZYSHELVES_COVERS_PACE`, `COZYSHELVES_COVERS_RECORD_DDG`, `COZYSHELVES_COVERS_SYNTH`, `COZYSHELVES_COVERS_SYNTH_DELAY`.
* Renderer: `window.__app.pad`, `window.__app.shelves`, `window.__readerText`, `window.__readerTts`, `window.__ttsTrace`,
  `window.__ttsDryRun`, `window.__tvTrace`, `window.__lastRecognition`; die Abfrage `?moon=<0…1>`.
* Neue Panels: `audiobooks`, `search`, `duplicates`, `welcome`; neue Bereiche der Einstellungen `audiobooks` und
  `controller`. Neue Orte: `hall`, `gallery` (nur in 0.7.0 und 0.7.1), `stairs` (nur in 0.7.0), `finished`, `audiobooks`, `feeder`, `firebowl`.
* Schließen beendet Cozy Shelves ganz (`window-all-closed` → `app.quit()`), auch während das Lesefenster der
  Volltextsuche arbeitet; nach 6 s beendet ein Sicherheitsnetz den Prozess (`before-quit` in `electron/main.js`).

## Weltkarte und Grafikprozess (ab 0.7.1, Karte von OpenStreetMap seit 0.9.1, Atlas seit 0.9.2)
* Atlas (0.9.2): bis Zoom 7,5 malt `osm-view.js` in einer SVG-Ebene (Leaflet-Pane `wm-fill`, z-index 350, über den
  Kacheln) das Meer (`path.wm-sea`), die Länder in den Farben der Ansicht, die Seen (`.wm-lake`) und die Flüsse der
  Ränge 1 und 2 (`.wm-river`) deckend; von 7,5 bis 8,5 blendet die Ebene aus (`map-style.js` `ATLAS_UNTIL`,
  `ATLAS_GONE`, `fillOpacity`), darunter liegen die Kacheln von OpenStreetMap, in CSS gedämpft (`.wm-tiles`).
  `map-style.js`: `MODES` = `countries` (Natural Earths MAPCOLOR7 `mc`), `continents`, `density` (Einwohner je km²),
  `wealth` (BIP je Einwohner), `fillOf(c, mode, dark)`, `legendOf(mode, dark)`, `modeName`. `view.setMode(m)`,
  `view.setDark(bool)` (die Tafel hört auf `onTheme`), `opts.onAtlas(shown)` blendet die Legende in der Detailkarte aus;
  die Tafel merkt sich die Ansicht in `localStorage` `lesesaal.worldmapMode`. `map-labels.js` (`LabelLayer`, Pane
  `wm-labels`, z-index 450): Namen als Elemente `.wm-l` (`wm-l-country`, `.caps` ab 12 px, `wm-l-sea`, `wm-l-city`,
  `.cap` für Hauptstädte, `.sel`), nach jedem Verschieben und Zoomen neu gesetzt, nach Rang (Meere, Länder nach
  Natural Earths `lr`/`minL`/`maxL`, Hauptstädte, Städte nach Einwohnern), ein Name, der einen gesetzten berührt,
  entfällt, ebenso unter `opts.reserved()` (Legende, Zoomknöpfe, Steckbrief); ab Zoom 8 (`DETAIL_ZOOM`) nur noch die
  Auswahl. `view.stats()` nennt dazu `mode` und `labels`. CARTOs ruhige Kacheln ohne Namen wurden zuerst probiert:
  seit 2026 verlangen sie einen API-Schlüssel und zeigen ohne ihn „API KEY REQUIRED“.
* `app/src/ui/worldmap/osm-view.js` (`OsmView(el, data, { onHover(hit, e), onClick(hit, e), onTiles({ loaded, failed }) })`)
  zeigt die Kacheln von OpenStreetMap (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) mit Leaflet 1.9.4 in einem
  `div.wm-canvas.wm-osm` im Körper der Tafel. Die Kacheln sind gewöhnliche Bilder der Seite: Die selbst gezeichnete
  Karte (2D-Canvas in der Seite bis 0.7.1, auf der WebGL-Leinwand der Welt von 0.7.2 bis 0.9.0) erreichte auf einem
  Windows-System den Bildschirm nie. `data.js` bleibt das Wissen hinter der Karte: `hitAt(pt)` findet unter einem Punkt
  (Pixel im Element) eine Stadt in 9 px (nur Orte mit `minZoom <= zoom + 0.5`; in einem Land unter 12 px nur der Punkt
  selbst in 3 px, ebenso eine Stadt eines anderen Landes als des Landes unter dem Punkt: in Singapur antwortet Johor
  Bahru nur auf seinem Punkt), sonst das Land (`countryAt`, knapp neben der Küste in 7 px das kleinste Land), sonst das
  Meer. Ein Klick darf um 8 px wackeln (`|dx| + |dy|`, Leaflets `clickTolerance`, von Haus aus 3), ehe er als Ziehen gilt.
  Gewählte und überfahrene Länder bekommen ihren Umriss aus Natural Earth (`wm-sel-shape`, `wm-hover-shape`), ein Land
  unter 12 px zusätzlich einen Ring, eine gewählte Stadt einen Kreis (`wm-sel-city`). Methoden: `zoom`, `center`
  (`[lon, lat]`), `hoverAt(x, y)`, `clickAt(x, y)`, `setSelected(sel)`, `fit()`, `flyToCountry(c, { right, maxZoom })`,
  `flyToCity(p, { right })`, `zoomIntoCity(p, { right })`, `zoomAt(f, x, y)` (sammelt kleine Schritte bis zu einer
  Viertelstufe), `panBy(dx, dy, animate)`, `resize()`, `reload()`, `stats()` (`{ loaded, failed, zoom, tiles }`),
  `destroy()`. `right` hält Platz für den Steckbrief frei.
* Ohne Verbindung: Scheitern 4 Kacheln, ohne dass eine kam, zeigt die Tafel `.wm-offline` mit „Erneut versuchen“
  (`view.reload()`); `__wm.state().offline`. `reload()` nimmt die Kachelebene ab und legt sie wieder an: `redraw()` von
  Leaflet 1.9.4 rundet den Zoom nicht und fragte beim Zoom 2,25 der ganzen Welt nach `/2.25/x/y.png`.
* Nutzungsrichtlinie der Kachelserver: `electron/main.js` `hardenSessions()` setzt für `https://tile.openstreetmap.org/*`
  den User-Agent `CozyShelves/<Version> (walkable 3D library)`. Der Vermerk
  „© OpenStreetMap“ steht unten links in der Karte (Leaflet-Attribution), dazu der Maßstab. Leaflets Stylesheet kopieren
  `build/vendor.js` und `build/web.js` nach `vendor/leaflet/leaflet.css`.
* CSS (`worldmap.css`): `.wm-osm` mit `z-index: 0`, damit Leaflets Ebenen (400 und mehr) unter Steckbrief, Tooltip und
  Knöpfen bleiben; die Erscheinungsbilder tönen die Kacheln (`.wm-tiles`: Sepia wärmer, Dunkel invertiert mit
  zurückgedrehten Farbtönen), Umrisse in `--accent`.
* Prüfungen: `__wm = { data, view, sv, find, select, state(), stats() }`; die Kartenprüfungen liefern die Kacheln selbst
  aus, damit sie die Server von OpenStreetMap nicht belasten und ohne Netz laufen. `build/scripts/osm-tiles.js`
  `serveTiles({ page, app })` (im Browser `{ context }`) beantwortet `https://tile.openstreetmap.org/**` über Playwright
  `page.route` mit einem eigenen PNG (256 px, zwei helle Farben im Schachbrett der Kacheln, graue Gitterlinie), eine
  Adresse ohne Kachel (gebrochener Zoom, außerhalb des Gitters) mit 404 (`tiles.bad`); `tiles.mode = 'offline'` bricht
  die Anfragen ab, `tiles.stop()` nimmt die Route wieder weg (sie schaltet den HTTP-Cache der Seite aus). In Electron
  erreicht nur die Route der Seite die Anfragen, die von `electronApp.context()` nie; `tiles.unrouted()` nennt
  Kacheladressen, die an der Route vorbeigingen (eine Prüfung erwartet keine). Kein Netz in der Sitzung: Eine
  PAC-Datei, die den Kachelserver an einen toten Proxy schickte, brachte unter Linux ab und zu den Proxy-Dienst von
  Chromium zum Absturz (danach scheiterte jede Anfrage), und `webRequest.onBeforeRequest` käme vor der Route und bräche
  auch die beantworteten Kacheln ab. Dazu `tileSpot`, `filtered(rgb, filter)` und `screenColour(app, rect)`:
  die Farbe einer Kachel im Fenster, wie der Hauptprozess es aufnimmt, gegen die Farbe des PNG im Filter des
  Erscheinungsbilds. `worldmap-check` hat dafür den Abschnitt `offline` (Hinweis, „Erneut versuchen“ ohne und mit
  Verbindung, auch in `build/ci/linux-test.sh`); `worldmap-real-check`, `controller-check` (Teil `map`) und `web-check`
  (Abschnitt 4c) nehmen dieselben Kacheln.
* Hinter der Karte ruht die Welt (`world.setBackground('paused')`). `world.still(width = 200)` zeichnet die Szene noch
  einmal und gibt sofort ein kleines Canvas davon zurück (oder `null`). `main.js` `stillBehind(layer)` legt es in
  `--panel-still` mit der Klasse `has-still` unter den Schleier der Tafel;
  `app/styles/worldmap.css` nimmt dafür den `backdrop-filter` weg, `--still-shade` dunkelt das Bild je nach
  Erscheinungsbild ab.
* `logs/renderer.log` (ab 0.7.2): `electron/main.js` `note(name, entry, maxKB)` hängt JSON-Zeilen mit Zeit und Version an
  `<userData>/logs/<name>` an (`gpu.log` 64 KB, `renderer.log` 256 KB, dann `.1`). IPC `app:log` (`api.app.log(entry)`,
  höchstens 24 Felder, Texte auf 600 Zeichen gekürzt) schreibt eine Zeile; `render-process-gone` wird vermerkt.
  `app/src/main.js` `watchErrors()` meldet `error` und `unhandledrejection` des Fensters (`noteError(entry)`, exportiert;
  höchstens 20 je Minute, der Rest wird gezählt) mit Tafel, Eintritt und Standort.
* Ende des Grafikprozesses: `main.js` `watchGpu()` hört auf `webglcontextlost` und `webglcontextrestored` am Canvas der
  Welt; kommt nach 6 s kein Kontext zurück, gilt er als wiederhergestellt. `restartAfterGpu()` schreibt in
  `sessionStorage` `lesesaal.gpuRestart` = `{ entered, pose: [x, z, yaw, pitch, ground] }` und `lesesaal.gpuRestartAt`
  und lädt das Fenster neu: sofort ohne offene Tafel, sonst sobald die letzte schließt (`syncPointer`), nie zweimal
  innerhalb einer Minute. Nach dem Laden betritt `resumeAfterGpu()` die Bücherei, setzt die Pose und zeigt den Hinweis
  „Die Grafik war kurz unterbrochen. Die Welt ist neu aufgebaut.“
* `electron/main.js` schreibt bei `child-process-gone` mit dem Typ `'GPU'` eine JSON-Zeile
  `{ t, reason, exitCode, version }` in `<userData>/logs/gpu.log`; über 64 KB wird die Datei zu `gpu.log.1`. Sonst
  kommt nichts in diese Datei.

## Winter: Spuren, Eis, Schnee auf harten Flächen (ab 0.7.1)
`world.winter` (`winter.js`, `Winter`) entsteht in `build()` nach der Fauna und läuft in `update` nach ihr. Er hängt
die Spuren (`tracks.js`) und den zugefrorenen See (`ice.js`) an den Spieler: `player.onStep` und `onLand` stempeln
Abdrücke, solange der See trägt, kommen `player.floorAt` und `player.bounds` draußen aus `ice.js`, `player.gripAt`
immer. Dazu `frozenLake` (der See trägt und ist zu sehen), `settle()` (der frische Schnee auf dem Eis sofort fertig, für
Prüfungen und Bilder) und `info()` → `{ tracks, ice }`.
* Spuren (`world.tracks`, `Tracks`): `stamp(kind, x, z, angle, { side, size, strength, y, old })` → Index oder -1 (dort
  liegt kein Schnee). `kind` aus `PRINT_KINDS`: `boot`, `run`, `land`, `hoof`, `paw`, `bird`; `angle` wie
  `Math.atan2(dz, dx)` zu den Zehen, `side` 1 rechts, -1 links. Dazu `playerStep(run)` und `playerLand()`,
  `animal(deer, x, z, yaw, leg, size)` (nur die Vorderfüße; `wildlife.js` `#steps`, dessen altes Decal `prints` wird
  noch gebaut, aber nicht mehr benutzt), `bird(x, z, yaw, span, walk, y)` (`birds.js`: hüpfend ein Paar nebeneinander,
  schreitend einzeln), `coverAt(x, z)` (wie viel Schnee dort für einen Abdruck liegt: keiner im Haus, unter dem Vordach
  und um die Feuerschale, auf dem See der Schnee auf dem Eis), `list(kind)`, `clear()`, `info()` und `layOld()` (die
  alten Spuren früherer Spaziergänger auf Weg, Terrasse, Steg und Trampelpfad, sobald Schnee liegt). Budgets: Spieler
  512, Tiere 256, Vögel 256, alte Spuren 256; ein neuer Abdruck ersetzt den ältesten seiner Art. `TRACK_LIFE` = 480
  Sekunden Verschleiß, die Uhr läuft bei Schneefall viermal und bei Regen 2,5-mal so schnell, ab 45 % der Zeit verblasst
  ein Abdruck; unter `NATURE.uSnow` 0,25 sind alle weg. Die Abdrücke haben keine Geometrie, sie stehen in zwei
  Datentexturen (`TRACKS`: `uTrkData`, `uTrkCells` mit Zellen von 1 m und höchstens acht Abdrücken je Zelle,
  `uTrkGrid`, `uTrkTime`), die `natureMaterial` in den Arten `'ground'` und `'plain'` und das Eis lesen (`TRACKS_GLSL`,
  `trkApply`). Dafür kommt kein Programm dazu.
* Schnee auf harten Flächen (`snow-cover.js`): `natureMaterial('plain', …, { snowStyle: 'path' | 'deck' | 'jetty' })`
  wählt das Aussehen über die Uniform `uSnowStyle` (`SNOW_STYLES`, `SNOW_COVER`, `SNOW_COVER_GLSL` in jedem
  `'plain'`-Programm). Der Steg nimmt eine eigene Kopie `weatheredWood('jetty')`, Bänke und Zaun `weatheredWood()` wie
  bisher. Das Glitzern des Schnees (`nGlint`) kommt mit dem direkten Sonnenlicht, im Schatten glitzert nichts.
* Eis (`ice.js`, `FrozenLake`, `world.winter.ice`): ein eigenes Netz über dem See mit `natureMaterial('ground', …,
  { key: ':ice' })`, ein Programm mehr (90 → 91), beim Start mit einem verborgenen Dreieck vorgewärmt. `walkable` gilt in
  der Jahreszeit Winter (`garden.seasons.name === 'winter'`); Schneefall in einer anderen Jahreszeit friert den See nur
  dünn zu (`water.js` `uFrozen`), er trägt dann nicht. `shown` ist das Gewicht des Winters. `floorAt(x, z, ref)`
  (Terrasse, Steg, sonst `max(Gelände, ICE_Y)`), `gripAt(x, z, feet)` (1, auf blankem Eis 0,2, auf seinem Schnee bis
  0,4), `keep` und `free` mit `ICE_REGION` (der Garten bis zum Wasser des anderen Ufers) und den Hindernissen im Eis
  (Schilf, große Steine, die Leiter). Vom Eis aus ist der Steg eine Wand, wo seine Bretter mehr als 0,2 m höher liegen.
  Endet der Winter, während der Spieler auf dem Eis steht, setzt `update` ihn an den nächsten Rand des Gartens. Weitere
  Exporte: `ICE_Y`, `overIce(x, z)`, `iceSnow(x, z)`; `outdoor.js` exportiert dafür `EAST_EDGE`, `NORTH_EDGE` und
  `WEST_EDGE`.
* Spieler: `player.gripAt(x, z, feet)` (1 ohne Haken) multipliziert die Beschleunigung beim Gehen und Anhalten; wer ohne
  Taste über das Eis gleitet, macht keine Schritte.
* Klang: `steps.js` kennt die Fläche `'ice'`, `acoustics.surfaceAt` liefert sie auf dem See. Die Soundscape nimmt
  `world.winter.frozenLake` als zugefroren: keine Enten, kein Teichhuhn, keine Frösche, kein Plätschern am Steg.
* Die Wildtiere bleiben an Land (ihr Wegenetz kennt den See als Hindernis), die Kois stehen unter dem Eis und sind nicht
  zu sehen, die welken Seerosenblätter liegen 7 cm darunter.

## Staffelei (ab 0.7.1)
`furniture.js` exportiert `EASEL` = `{ lean: 0.21, footX: 0.3, frontZ: 0.335, rearZ: -0.335, apex: 1.72, mastTop: 2.0,
ledgeY: 0.86, canvas: [0.66, 0.52, 0.03] }`, die Maße einer A-Staffelei. Der Vorderrahmen ist um `lean` (12°)
zurückgelehnt, die Vorderfüße stehen bei ±`footX`, das Hinterbein hängt an einem Scharnier unter dem Kopf, eine Spreize
hält es am Mast. Die Leinwand steht auf der Leiste und lehnt am Mast, eine Klemme hält ihre Oberkante;
`userData.canvas` ist ihre Bildfläche, `footprint` 0,82 × 0,73 m bei 1,98 m Höhe. `actions.easelTexture()` ist ein
grundiertes Weiß (`#f6f3ec`) ohne Schrift. `main.js` legt beim Start das neueste Bild aus `api.files.paintings()` darauf
(`world.actions.setEaselImage`), danach jedes neu gespeicherte (`painting:saved`).

## Cover an den Buchseiten (ab 0.7.1)
`app/src/world/side-covers.js` (`SideCovers`, in `BookShelves` als `this.sides`) zeigt auf jedem Deckel, der offen zu
sehen ist, das Cover statt der Einbandfarbe. Offen sind die äußeren Deckel des ersten und des letzten sichtbaren Buchs
jeder Reihe (neben der Buchstütze, einer Pflanze oder der Seitenwand des Regals) und die Deckel neben einer Lücke von
mindestens `OPEN_GAP` = 1,2 cm (ein Buch im Korb, `hidden`, oder gerade herausgezogen, `preview`). Vom Raum aus liegt
die Vorderseite rechts vom Rücken, die Rückseite links; die Rückseite zeigt das Bild der Vorderseite ungespiegelt. Bücher
ohne Coverbild zeigen ihre Titelkarte (`book-art.js` `drawTypoCover`).
* Atlas: eine `THREE.FramebufferTexture` von 4096 px Breite mit 6 bis 16 Zeilen zu 192 px (`MIN_ROWS`, `MAX_ROWS`; so
  viele, wie die Bücher mit offenen Deckeln und 24 weitere mit einem Viertel Reserve brauchen, 24 bis 64 MB mit den
  Mip-Stufen), sRGB, Anisotropie 8. Jedes Buch hat eine Zelle für beide Deckel (`SIDE_CELL` = 128 × 192 px: 120 × 184 px
  Bild in einem Rand von 4 px, der seine Kante wiederholt), sie bringt ihre sieben Mip-Stufen selbst mit
  (`SIDE_LEVELS`), Mipmaps des ganzen Atlas entstehen nie. Wächst die
  Bücherei, übernimmt ein größerer Atlas die Bilder des alten auf der Grafikkarte (`copyTextureToTexture`). Eine Zelle
  gehört zu einem Buch, ein Neuaufbau der Regale behält sie; ist der Atlas voll, geben die fernsten Deckel ihre Zellen an
  nähere ab.
* Füllen: Alle 0,25 s bekommen die offenen Deckel, die dem Betrachter am nächsten sind, eine Zelle (`#plan`), die
  Nachbarn des Buchs unter dem Fadenkreuz zuerst (`anticipate`, drei Sekunden lang). Höchstens vier Bilder sind zugleich
  beim Worker, höchstens drei Zellen gehen je Bild und innerhalb von 1 ms auf die Grafikkarte (`FRAME_CELLS`,
  `FRAME_MS`). Ein erstes Bild blendet in `SIDE_FADE` = 0,25 s über die Einbandfarbe, ein neues ersetzt das alte sofort.
* Worker `app/src/workers/side-cover-worker.js` (Eintrag `side-cover-worker` in `build/bundle.js`):
  `{ type: 'cover', id, url, aspect }` | `{ type: 'typo', id, book, aspect }` → `{ type: 'cell', id, levels, mean }`
  (die Puffer übertragen) oder `{ type: 'error', id, message }`. Er lädt die Webschriften der Titelkarten selbst,
  `book-art.js` zeichnet dort auf `OffscreenCanvas`. Ohne Worker malt der Hauptthread die Zellen in Leerlaufzeit; ein
  Cover, das nicht lädt, bekommt die Titelkarte.
* `side-cell.js`: `SIDE_CELL`, `SIDE_LEVELS`, `CROP_TOP` = 0,4 (ein Bild, das höher ist als der Deckel, verliert 40 % des
  Überstands oben und 60 % unten), `cropOf(iw, ih, aspect)`, `paintCell(g, paint)` → `{ levels, mean }`,
  `paintCoverCell(g, bitmap, aspect)`. `side-covers.js` exportiert dazu `SIDE_UNIFORMS`, `SIDE_COLS`, `SIDE_FADE` und
  `sideCrop(rect, img, face)` (dasselbe Zuschneiden in UV).
* `books.js`: Das Material der Regale (`makeSpineMaterial`, Programmschlüssel `spine-atlas-sides` statt `spine-atlas`)
  liest `SIDE_UNIFORMS` (`uSideAtlas`, `uSideSize`, `uSideTime`) und je Buch das Attribut `aSide` = (Zelle, Beginn der
  Überblendung, sichtbar, 0); die UV der Deckel liegen bei 2 bis 3 (vorn) und 4 bis 5 (hinten). `BookShelves` ruft nach
  jedem Aufbau `sides.attach(entries, rowsOf)`, bei Korb, Herausziehen und Zurückstellen `rowChanged(entry)`, bei einem
  neuen oder gewählten Cover `updateBook(book)` (ohne Neuaufbau) und je Bild `update(dt, camera)`. Einträge tragen
  `slotX`, `bookDepth(book)` ist exportiert.
* Das herausgezogene Buch (`HoverSlot`) zeigt vorn und hinten dasselbe Material: das große Cover, sobald es auf der
  Grafikkarte ist, sonst die Titelkarte in den Proportionen des Deckels (`typoTexture`), bis dahin die kleine Zelle der
  Seite (`sides.cellFor(id, rect)`). Seit 0.7.2 wird das große Cover nicht mehr mit `sideCrop` auf den Deckel
  zugeschnitten: Der gedrehte Deckel nimmt die Proportionen des Bildes an (Breite = Höhe × Seitenverhältnis, begrenzt auf
  `COVER_ASPECT_MIN` = 0,55 bis `COVER_ASPECT_MAX` = 0,9); die Breite kommt mit der Drehung (Phase `b` in `#pose`) und
  geht beim Zurückgleiten zurück, bis dahin ist das Bild wie bisher zugeschnitten, nichts wird gestreckt. Die Drehung
  endet `TURN_SHORT` = 0,31 rad (18°) vor der Blickrichtung, nie über die Ruhelage hinaus, die Neigung `TILT_SHORT` =
  0,1 rad (6°) vor der Blickhöhe. Der Papierblock (Kopf, Fuß, Vorderschnitt) ist ein gemeinsames Material auf dem
  Programm des Rückens (`hover-spine|shelfglow0.55`): cremefarbenes Papier mit feinen Seitenlinien
  (`pageBlockMaterial()`, `userData.pageBlock = true`). `makeBookMesh` zeigt auf der Rückseite das Bild der Vorderseite
  (drei Zeichenaufrufe je Buch) und ein Cover, das schon auf der Grafikkarte liegt, vom ersten Bild an. Je Slot für
  Prüfungen: `kind` ('cover', 'typo', 'side', 'none'), `aspect`, `coverD`, `dAsp`, `dcur`.
* Kein neues Shader-Programm: Das Material der Regale ersetzt sein altes, die Deckel und der Papierblock des
  herausgezogenen Buchs nehmen das Programm seines Rückens (`hover-spine`), zwei Programme weniger. Neue Einstellungen
  gibt es nicht.
* Die Cover-Karte rechts (`.peek-card`, ab 0.7.2): kein Hintergrund, Rand und Polster mehr, das Cover (`.peek-cover`)
  steht frei mit Rundung, Schatten und Haarlinie; die Tasten (`.peek-keys`) stehen auf einer Pille (`--glass`); die
  Hörbuchkarte (`.ab-peek`) teilt die Klassen. Prüfung `peek-card-check` (`PC_SIZE`, `PC_AUDIOBOOKS`).
* Für Prüfungen: `window.__app.world.books.sideCovers` mit `info()`, `faces()`, `cellRect(id)`, `setEnabled(on)` (aus:
  alle Deckel in der Einbandfarbe, nichts wird geladen) und `reset()` (alle Zellen vergessen, alles neu laden).
  Prüfskript `side-cover-check` (`SC_PARTS=faces,atlas,render,newcover,gap,hover,spines,load,perf,rebuild,shots`,
  `SC_SHOTS=0`, `SC_SIZE`, `SC_PERF_SECONDS`).

## Test-Hooks, Umgebung, Prüfungen (neu in 0.7.1)
* Keine neuen Einstellungen.
* Testrahmen: `HARNESS_LOAD_TIMEOUT` (ms bis zum Laden des Fensters, sonst 30000) in `build/screenshot.js`.
* Renderer: `world.still()`, `world.winter` (`info()`, `settle()`), `world.tracks` (`list(kind)`, `info()`, `clear()`,
  `stamp(…)`), in `world.wildlife` `sitOverride` und `planMs`, je Besuch `leftFor`, `flights` und `scare`,
  `world.books.sideCovers`; die Schlüssel `lesesaal.gpuRestart` und `lesesaal.gpuRestartAt` in `sessionStorage`.
* Neue Prüfskripte: `flee-check` (`FL_PARTS=doe,alert,stag,fox,feeder,chase,home,hide,programs,shots`, `FL_SHOTS`,
  `SHOT_TAG`; Kopie einer kleinen Testbücherei), `winter-check` (`WT_PARTS=prints,animals,ice,snow,programs,perf,shots`,
  `WT_SHOTS=1`), `easel-check` (danach `EASEL_PHASE=restart` mit derselben `COZYSHELVES_USERDATA`; `EASEL_SHOTS=0`),
  `gpu-recovery-check` (beendet den Grafikprozess der eigenen Testinstanz zweimal) und `side-cover-check` (die große
  Testbücherei oder eine kleine mit echten Covern; `SC_PARTS`, `SC_SHOTS=0`). Geändert: `feeder-check` (ein Besuch an
  der Futterstelle darf bis zu 20 Minuten dauern, weil eine unterbrochene Mahlzeit zu Ende gefressen wird), `shelves-check` (ohne Karte und Schild am Regal „Gelesen“),
  `audiobooks-check` (das Regal ohne Ordner; `AB_PHASE=restart` entfernt am Ende den Ordner), `worldmap-check` (seit 0.7.2 die
  Karte auf der Leinwand der Welt, Standbild, halbe Auflösung beim Bewegen), `wildlife-check` (die Flucht), `interior-check` (die
  Schattenkante an der Südwand um 10:15 Uhr gemessen), `outdoor-check` und `outdoor2-check` (stellen im Winter nach
  Kalender den Herbst ein, damit kein Eis liegt).
* Orte und Sitze: `stairs`, `gallery1` und `gallery2` sind entfallen.

## Name, Datenordner und Linux (ab 0.8.0)

* Bis 0.7.2 hieß das Programm Lesesaal, von 0.8.0 bis 0.9.2 Cozystacks, seit 0.10.0 Cozy Shelves (`productName`, daher
  Electrons Ordner `<appData>/Cozy Shelves`). `electron/data-folder.js` (`dataFolder`, `keptFolder`) entscheidet vor
  allem anderen in `electron/main.js`: Ohne `--user-data-dir` nimmt das Programm den ersten früheren Ordner mit
  `settings.json` oder `library.json`, `<appData>/Cozystacks` vor `<appData>/Lesesaal`, solange in
  `<appData>/Cozy Shelves` keine der beiden Dateien liegt. Electron legt den Ordner unter dem neuen Namen schon vor
  dem Hauptskript an (nur mit `Local State`), deshalb zählt sein Inhalt und nicht, ob es ihn gibt. Ebenso bleibt
  `Videos/Cozystacks Mediathek` oder `Videos/Lesesaal Mediathek` der Download-Ordner der Mediathek, solange es
  `Videos/Cozy Shelves Mediathek` nicht gibt.
* Gespeicherte Schlüssel tragen weiter den alten Namen, damit nichts verloren geht: der Ursprung `app://lesesaal`
  (localStorage, IndexedDB, Caches), die Schlüssel `lesesaal.*` im localStorage, die Partition
  `persist:lesesaal-browser` des Lesebrowsers, `urn:lesesaal:` in erzeugten EPUBs und der Cache `lesesaal-kokoro`.
  Der Release-Schlüssel der Android-App behält Datei, Alias und Zertifikat (`cozystacks-release.jks`, `cozystacks`).
  Umgebungsvariablen und Test-Hooks heißen `COZYSHELVES_*` und `__cozyshelves*`; Programmordner und Archive
  `CozyShelves`, Befehl, Debian-Paket und Menüeintrag `cozy-shelves`, die Android-App `com.cozyshelves.app`.
* Must-Read: `walk(dir, out, depth, links)` sammelt symbolische Links mit; `scanFolder` behandelt sie wie
  `.lnk`-Verknüpfungen, `readShortcut` in `electron/main.js` löst beide auf (`fs.realpathSync` bzw.
  `shell.readShortcutLink`).
* Linux: `build/package-linux.js` (über `build/package-common.js` mit `package-win.js` geteilt) schreibt tar, gzip und
  ar selbst und baut damit auch unter Windows `CozyShelves-<v>-linux-x64.tar.gz` und `cozy-shelves_<v>_amd64.deb`
  (`/opt/CozyShelves`, `/usr/bin/cozy-shelves`, Menüeintrag, Symbole; `chrome-sandbox` mit Modus 4755 und root als
  Besitzer, `postinst` wiederholt das). Unter Linux schaltet `electron/main.js` nur `WebGPU` ein, ohne `Vulkan`.
* `HARNESS_NO_USERDATA=1` startet den Testrahmen ohne `--user-data-dir` (nur mit einem Test-`XDG_CONFIG_HOME`),
  `build/scripts/datadir-check.js` prüft damit den Datenordner nach einem Update. `build/ci/linux-test.sh` läuft in
  `.github/workflows/linux.yml` auf Ubuntu 24.04, nur von Hand gestartet (`workflow_dispatch`); mit der Eingabe
  `release` lädt der Lauf die geprüften Pakete zu einem bestehenden Release hoch.
* Die Wortliste von `build/privacy-check.js` liegt nur lokal (`.privacy-words.json` oder `PRIVACY_WORDS`), mit
  eigenem Salz; ohne sie prüft der Lauf Benutzerordner in Pfaden.

## Test-Hooks und Prüfungen (neu in 0.7.2)
* `fallback-check` (`FB_PHASE=restart` mit demselben Datenordner, `FB_STATE=<Datei>`): eine zu große Bücherei, eine Abteilung im
  Zimmer, die Tafel mit Nummer, der Wechsel über das Rad, die Wahl über den Neustart; eine passende Bücherei wird
  sechsfach aufgeblasen, `build/testlib/gen_overflow_lib.py <Ordner>` erzeugt eine, die nicht passt (1120 Bücher in 16
  Abteilungen). `room-views` (`SHOT_TAG`, `RV_SIZE`, Uhrzeit über `COZYSHELVES_QUERY`): Bilder des Bücherzimmers.
  `gallery-check` ist entfallen.
* `wheel-check` (`WHEEL_PARTS=open,centre,pick,keys,pad,fit,english,shots`): die zwei Ringe des Abteilungsrads (ui/wheel.js).
* `peek-card-check` (`PC_SIZE`, `PC_AUDIOBOOKS=<Hörbuchordner>` oder `0`): die Cover-Karte ohne Rahmen und die Hörbuchkarte.
* `cat-check` prüft dazu Augen und Blinzeln, Bauch, Schwanz, Fellatlas und die Bildzeit (`CATPERF`, höchstens 8
  Zeichenaufrufe und 14 000 Dreiecke); `cat-views` (`CV_HOURS`, `SHOT_TAG`) macht Bilder der Katze. `cat.tailTip` heißt
  `cat.tailRings`; neu `cat.belly`, `cat.tailP`, `cat.blinkIn`, `cat.blink`.
* `worldmap-check` prüft die Karte auf der Leinwand der Welt (`__wm.screen()`, `__wm.check()`); `gpu-recovery-check`
  unverändert. `flee-check` erwartet den Trab (`FL_SHOTS=trot-behind,trot-side,calm-watch,calm-graze,stag-trot,fox-sit`).

## Browser-Version (Strang `wip/web`)
Ein zweites Bauziel neben der Electron-App: `node build/web.js` (`npm run build:web`) schreibt eine statische Seite nach
`dist/web/` (relative Adressen; `index.html`, `theme-boot.js`, `styles/`, `data/`, `vendor/` ohne die Sprachmodelle,
`dist/` mit dem Bündel aus `app/src/main-web.js` und den Workern). Die Desktop-App bleibt, wie sie ist; beide teilen die
Quellen. Plan, Bewertung je Funktion, Größen und Prüfergebnisse: `docs/strands/web.md`; die Android-App darauf:
`docs/strands/android-plan.md`.
* `app/src/main-web.js` setzt `window.api` aus `app/src/core/api-web.js` und lädt danach `main.js` dynamisch (ein
  statischer Import würde `core/api.js` vor dem Backend auswerten und den Mock nehmen). `api.isElectron` ist `false`,
  `api.platform` `'web'`, `api.features` nennt, was fehlt (`feeds, podcasts, catalog, mediathek, browser, audiobooks,
  fulltext, webCovers, quit, revealFile, pickFolder, musicFolder, paintingsFolder, ttsDownloads, streetview`: `false`).
* `app/src/core/platform.js`: `platform` (`'desktop' | 'web' | 'android'`, auch `?platform=`), `isWeb`, `touch`
  (`?touch=1` oder grober Zeiger), `has(feature)` (die Desktop-App hat alles), `UNAVAILABLE` (der zweisprachige Hinweis),
  `graphicsPreset()`. Tafeln und Welt fragen `has()`, statt `window.api` zu prüfen; `panels.js` öffnet `search` ohne
  Volltextindex als Katalog des Computers.
* Reine Module, von beiden Seiten gebündelt: `electron/library/shelving.js` (Dateinamen, Abteilungen und Regale,
  `computeDepartments`, `assignFromFolder`, `moveBook`, `applyIndexMeta`, `searchBooks`; `library.js` delegiert),
  `electron/settings-defaults.js` (`DEFAULTS`, `migrateSettings`, `deepMerge`, `THEMES`), `app/src/core/index-book.js`
  (`indexBook(job)` mit `job.url` oder `job.file`, `imageJob`; `app/src/indexer.js` ist nur noch der Fensterkleber).
* `app/src/web/`: `idb.js` (Datenbank `lesesaal-web` mit `kv`, `covers`, `text`, `handles`, `paintings`; `WebStore` wie
  `electron/store.js`), `web-files.js` (Ordnerquellen `'handle'` aus `showDirectoryPicker()` und `'files'` aus
  `<input webkitdirectory>`, `listBooks`, Berechtigungen), `web-library.js` (`WebLibrary`: Scan, Index in der Seite,
  Cover als Blobs mit `blob:`-Adressen, Lesestand, Verlauf, Statistik, `attention()` = Ordner, die einen Klick brauchen,
  `reopen(id)`), `common-web.js` (Ersatz für `electron/feeds/common.js`: fetch, DOMParser, der Sanitizer des Renderers,
  ein Speicher-Cache), `path-stub.js`, `hls-stub.js`.
* Buch-IDs der Browser-Version: `hashId(ordnername|relPath)` (16 Hex), bleiben über eine neue Wahl des Ordners gleich.
  Feld dazu: `folderId`; `settings.folders` trägt `{ id, path (der Name), mode, kind }`. DOCX und RTF bleiben außen vor.
* Vorlesen: `app/src/ui/reader/tts-client-web.js` (`speechSynthesis`, dieselbe Schnittstelle wie `tts-client.js`,
  Stimmen-IDs `web:<voiceURI>`), vom Bündler an Stelle von `tts-client.js` eingesetzt.
* Touch: `app/src/input/touch.js` (`TouchInput`: Ziehen sieht sich um, Tippen benutzt, `stick.set(x, y, run)` füllt
  `player.pad`), in `main.js` bei `touch`. `window.__app.back()` (Zurück-Taste), `window.__app.touch`. Im Hintergrund
  (`visibilitychange`) ruht die Welt nur in der Browser-Version.
* Test-Hooks: `window.__cozyshelvesWeb` (`library`, `settings`, `idb`, `useHandle(handle, mode)`, `useFiles(fileList,
  mode)`, `reopen(id)`, `flush()`), IPC-Kanal `web:reopen`. Prüfung: `node build/web-shot.js web-check`
  (`build/scripts/web-check.js`; Edge headless und stumm über `channel: 'msedge'`, sonst das neueste `msedge.exe` unter
  `EdgeCore`; `WEB_BOOKS`, `WEB_INPUT=1`, `WEB_PROFILE`, `SHOT_DIR`, `WEB_URL`, `WEB_SCAN_TIMEOUT`).

## Android-App (Strang `wip/android`)
Die Browser-Version in einem WebView: `android/` (Kotlin, AGP 8.7, `minSdk` 26, `targetSdk` 35, nur `androidx.webkit`,
`androidx.activity` und `androidx.core`). `node build/android.js` (`npm run build:android`) baut die Webseite, kopiert
`dist/web` nach `android/app/src/main/assets/web` (nie eingecheckt) und baut die APKs nach `dist/android/`. Stand und
Prüfergebnisse: `docs/strands/android.md`.
* **Seite**: `https://appassets.androidplatform.net/assets/web/index.html?platform=android` über `WebViewAssetLoader`
  (ein sicherer Kontext: IndexedDB, Worker, `crypto.subtle`). `WebAssetsHandler` setzt die MIME-Typen, die der
  Standard-Handler nicht kennt (`js`, `wasm`, `woff2`, `webmanifest` …). `api.platform` ist `'android'`, `api.android`
  `true`, sobald `window.AndroidBooks` da ist; `core/platform.js isAndroid` sagt dasselbe. `api.features` wie im Browser.
* **Brücke `window.AndroidBooks`** (`BooksBridge.kt`, alle Methoden synchron auf dem Bridge-Thread):
  `version()`, `info()` (JSON: `version`, `versionCode`, `sdk`, `debug`), `folders()` (JSON `[{ key, name, available }]`),
  `hasFolder(key)`, `folderName(key)`, `pickFolder(requestId)` (öffnet `ACTION_OPEN_DOCUMENT_TREE`; die Antwort kommt
  über `window.__cozyshelvesWeb.androidFolder({ requestId, key, name })`, bei Abbruch `key: null`), `forgetFolder(key)`
  (gibt die Berechtigung zurück), `listFiles(key)` (JSON `[{ relPath, name, size, mtime }]` bis acht Ebenen tief, ohne
  Punktnamen; `null`, wenn der Ordner nicht lesbar ist), `keepScreenOn(bool)`, `setOrientation('landscape' | 'any')`,
  `openExternal(url)`, `vibrate(ms)`, `ready()` (der Startbildschirm der App geht weg), `exit()` (die App tritt in den
  Hintergrund).
* **Dateien**: `/books/<key>/<relPath>` (jedes Segment URL-kodiert) liefert `BooksPathHandler` aus dem gewählten Ordner
  (`Folders.kt`: die Datei wird nur über die Liste des Ordners gefunden, nie über einen Pfad der Anfrage; außerhalb des
  Ordners wird nichts gelesen). Antwort: der MIME-Typ nach Endung, `Content-Length`, `Cache-Control: no-store`.
* **Ordnerquelle `'bridge'`** (`web-files.js`): `sourceFromBridge({ id, key, name, mode })`, `listBooks` filtert die
  Liste der App mit denselben Regeln wie den Dateidialog (`fromFlat`), `file()` holt die Datei per `fetch()` als `File`.
  `settings.folders` trägt `{ id, path, mode, kind: 'bridge', key }`. `WebLibrary.addFolder` nimmt zuerst die Brücke,
  `reopen(id)` wählt den Ordner neu (Grund `'lost'` in `attention()`: die Berechtigung ist weg), `setFolders` ruft
  `forgetFolder`. Buch-IDs wie im Browser (`hashId(ordnername|relPath)`).
* **Seite → App**: `window.__app.back()` (Zurück-Taste: Rad, oberste Tafel, sonst Menü; `false` auf dem Startmenü, dann
  `moveTaskToBack`), `window.__cozyshelvesWeb.flush()` in `onPause` (die Timer der Seite halten 500 ms später an;
  `document.hidden` lässt die Welt ruhen), `androidReading(on)` in `main.js` (Reader offen: `setOrientation('any')`,
  `keepScreenOn(true)`), `androidReady()` nach dem ersten Bild.
* **Touch**: `app/src/ui/touch-hud.js` (`TouchHud`: Stick, Laufen-Schalter, Benutzen, Springen, Lesen, Info, Menü,
  Abteilungsrad; `#hud.touch`, `styles/touch.css`, versteckt bei `panel-open`), `input/pad-hints.js touchState` und die
  Touch-Hinweise (`{USE} {READ} {INFO} {BASKET} {STICK}`), `useGlyph()`. `player.noLock` bei `touch`.
  `app/styles/ui.css` `@media (pointer: coarse)`: Ziele ab 44 px. `main-web.js fitPhoneViewport()`: unter 560 dp
  kurzer Seite wird die Seite auf `max(0.72, kurz / 560)` verkleinert (`initial-scale`).
* **Grafik**: `settings.graphics.frameCap` (0 = Bildrate der Anzeige; frisches Touch-Profil 30), `World.frameCap`,
  `World.frameStats()` → `{ median, work, n, cap }` (`work`: Median der Zeit von `World#frame` im Hauptfaden),
  `resetFrameStats()`. Frisches Touch-Profil (`PHONE_GRAPHICS` in `electron/settings-defaults.js`): `quality 'mobile'`,
  `resolutionScale 1`, `fov 80`, `frameCap 30`. Ein Handy-Profil von 0.10.1 (`quality 'low'`) wird beim Start einmal
  auf `'mobile'` mit `resolutionScale 1` gestellt (`migratePhoneGraphics`, Marke `graphics.tierSchema`); andere
  Entscheidungen bleiben. `main.js watchPhoneFrames()`: bei `'mobile'` −0,1 (bis 0,7, höchstens dreimal), wenn der
  Median über 1,15 × Cap-Intervall liegt und `work` unter drei Vierteln davon (sonst hilft die Auflösung nicht); bei
  den anderen Qualitäten wie bisher (über 1,5 × Intervall, bis 0,5, zweimal).
* **Qualität `'mobile'`** (seit 0.10.2): zeichnet wie `'low'` (`World.quality` ist `'low'`,
  `World.mobile` `true`; dieselben Pässe) und spart dazu:
  * höchstens `MOBILE_PIXELS × resolutionScale²` Bildpunkte im Zeichenpuffer (Handy 0,6 Mio., ab 600 dp kurzer
    Bildschirmseite 0,9 Mio.; nie mehr, als die Anzeige hat); ohne Mehrfachabtastung, wenn `'mobile'` beim Start gilt
    (`new World(canvas, { antialias })` aus `main.js`; der Kontext behält es bis zum nächsten Start);
  * anisotrope Filterung bis 4 (`renderer.capabilities.getMaxAnisotropy` liefert dann 4; Texturen auf der Karte bekommen
    den Wert an ihrem Sampler, `World.maxAnisotropy` ist das echte Maximum);
  * das ferne Niveau der Bäume schon ab 25 bis 40 m (`NATURE.uLodNear/uLodFar`, sonst 45 bis 70 m;
    `garden.setQuality(q, { mobile })`), die Zweige der Vögel in den Kronen nur bis 40 m (`birds.js #twigsNear`);
  * `world/mobile.js` (`World.mobileTier`): vier Zonen (Garten, Halle, Durchgang, Bücherzimmer), die einander nur durch
    ihre Öffnungen sehen (Glasfront, Fenster des Bücherzimmers aus `layout.openings`, die beiden Bögen des Durchgangs).
    Vor jedem Bild werden die Öffnungen projiziert; was nur in Zonen ohne sichtbare Öffnung steht oder außerhalb des
    Rechtecks seiner Öffnungen, bleibt für dieses Bild unsichtbar (die Platzierungen der Einrichtung, die Stapel von
    `#batchStatic`, die Teile der Regale und des Gartens, die Bäume je Baum über `setVisibleAt`, Vögel und Wildtiere,
    wenn der Garten ganz verdeckt ist); gleich nach dem Bild ist alles wieder sichtbar. Wände werden nicht gefragt,
    das Bild verliert nichts (`mobileTier.cull = false` zeichnet alles, zum Vergleich). Unsichtbare Tiere werden nur
    weitergerechnet, nicht posiert (`mobileTier.posed`);
  * vier echte Punktlichter (`MOBILE_LIGHTS`): die Lichter der Lampen sind auf keiner Ebene (`layers`), ein Vorrat von
    vier Lichtern übernimmt die Lampen, die am Auge am meisten wirken (dieselbe Zone zuerst), mit einer Viertelsekunde
    Überblendung; eigene Programme mit vier Lichtern, mit der Aufwärmung übersetzt; ein Wechsel von oder zu `'mobile'`
    baut die Welt neu (`builtMobile`);
  * die undurchsichtigen Dinge nach Programm sortiert (`setOpaqueSort`), die Stapel ohne Trennung nach Schatten, die
    Matrizen der in Stapel verschmolzenen Einrichtung eingefroren (`userData.batched`), keine Spiegelung der Räume in
    den Fenstern bei Nacht (`glass-reflect.js`).
  Auf einem Touch-Gerät (`core/platform.js touch`): die Musik ohne Hall, Garten und Räume mit einem gemeinsamen kurzen
  Hall (`impulseResponse({ length })`, 0,9 s), der Ticker der Klangwelt alle 200 statt 120 ms, Schleier ohne
  Weichzeichner über der Welt (`styles/touch.css`). Messung: `node build/web-shot.js phone-perf` mit `WEB_DEVICE=phone`.
* **Debug-Builds** (`src/debug`, nie im Release): Broadcast `com.cozyshelves.app.EVAL` (`--es id`, `--es js64 <Base64>`;
  das Ergebnis in logcat `CozyEval: <id> <JSON>`, Promises über `window.CozyDebug.result(id, json)`),
  `com.cozyshelves.app.USE_FOLDER --es path <Ordner>` (ein einfacher Ordner als Bücherordner; das Debug-Manifest
  verlangt `MANAGE_EXTERNAL_STORAGE`, die Prüfung gewährt es per `appops`), `WebView.setWebContentsDebuggingEnabled`.
  Prüfung: `node build/android-check.js` (`npm run test:android`; `ANDROID_SERIAL`, `ANDROID_APK`,
  `ANDROID_RELEASE_APK`, `ANDROID_BOOKS`, `SHOT_DIR`, `ANDROID_START=1`, `ANDROID_AVD`).
* **Signatur**: `build/android-keystore.js` legt `.android-signing/cozystacks-release.jks` mit `keystore.properties`
  außerhalb jedes Repositories an; `app/build.gradle.kts` liest `COZYSHELVES_SIGNING`, `-Pcozyshelves.signing`,
  `<repo>/.android-signing/keystore.properties` oder `COZYSHELVES_KEYSTORE_FILE/_PASSWORD`, `COZYSHELVES_KEY_ALIAS/_PASSWORD`.
  `versionName` aus `package.json`, `versionCode` = Major·10000 + Minor·100 + Patch.

## Zeichnen und Start (Strang `wip/perf`, 0.9)
* **Nachbearbeitung ohne Mehrfachabtastung**: Nur `composer.renderTarget1` ist mehrfach abgetastet (4 Proben auf
  `high`, 2 auf `medium`) und trägt die Szene mit ihrer Tiefe (`depthTexture`, die Lichtstrahlen lesen sie);
  `renderTarget2` ist ein einfacher Halbgleitkomma-Puffer ohne Tiefe. Jedes Bild beginnt mit denselben Puffern
  (`World#renderComposed`: `readBuffer` = 1, `writeBuffer` = 2; der Ausgabepass tauscht nicht mehr). Reihenfolge der
  Pässe: `renderPass`, `tap` (godrays.js), `ao`, `rays`, `bloom`, `output`. Nach der Szene schreibt kein Pass mehr in
  den ersten Puffer: `SoftAO` rechnet AO und Entrauschung in einkanaligen R16F-Puffern
  (`pdMaterial.defines.SAMPLE_LUMINANCE = 'a.r'`) und schreibt `Szene × mix(1, ao, blendIntensity)` mit einem eigenen
  Pass (`combine`) in den zweiten Puffer; `ao.output` bleibt für die Debug-Ausgaben der Prüfungen (`ao-debug`,
  `ao-tune`). Das Rauschen der Entrauschung ist gesät (`#seededNoise`), damit Bilder zweier Starts gleich sind.
  `SoftBloom` (three's UnrealBloomPass ohne seinen letzten Pass) setzt das Leuchten in `bloom.texture` zusammen; der
  Ausgabepass liest das Bild (ohne AO den aufgelösten ersten Puffer, sonst den zweiten) und addiert das Leuchten
  (`mergeBloom`: `tBloom`, `uBloomOn`) und die Lichtstrahlen (`GodRays.mergeInto` kennt den Haken des OutputShaders);
  Vignette und Wärmeton stehen ebenfalls dort (`mergeVignette`, vor dem Tone-Mapping;
  `world.vignette.uniforms.uStrength/uWarm` bleiben die Stellen dafür). Programme: der Kombinierpass wird in
  `#warmUp` (`#warmPost`) mitübersetzt; kein Programm kommt später dazu.
  Die Tiefe der Szene wird nur aufgelöst, solange die Lichtstrahlen sie lesen
  (`renderTarget1.resolveDepthBuffer = godrays.active` in `#renderComposed`); ein neuer Leser der Tiefe muss das
  berücksichtigen. Der Normalenpass der AO sortiert die undurchsichtigen Dinge zuerst nach ihrer Art (einfach,
  instanziert, instanziert mit Farben, gebündelt; `byKind`), damit three das Programm des Überschreibmaterials nicht
  bei jedem Wechsel neu nachschlägt.
* **Lampen nur, wo sie hinreichen** (`world/light-loop.js`): Der Beleuchtungsbaustein von three
  (`THREE.ShaderChunk.lights_fragment_begin`) ruft `RE_Direct` für Punkt- und Spotlichter nur auf, wenn
  `directLight.visible` (Farbe nach dem Abfall mit der Entfernung ungleich null); jenseits der `distance` einer Lampe
  trug sie genau null bei. Das Bild bleibt gleich, die Rechnung entfällt. Der Baustein wird beim Laden gepatcht,
  bevor ein Programm gebaut wird; `materials.js` und `nature.js` importieren das Modul zuerst, weil sie Teile des
  Bausteins herausschneiden (die Marken `#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )` und
  `#if ( NUM_SPOT_LIGHTS > 0 )` bleiben). Wer den Baustein selbst ersetzt, übernimmt die Abfrage. `?lampgate=0` lässt
  ihn unverändert (Vergleiche von Bild und Zeit). Die Zahl der Programme ändert sich nicht.
  Preis: Der D3D-Compiler von ANGLE braucht für die Verzweigungen länger, ein erster Start (leerer Programm-Cache)
  wärmt die Shader etwa 1 s länger auf; ein späterer Start nicht.
* **Durchsichtig von beiden Seiten** (`world/two-sided.js`): three zeichnet ein durchsichtiges Material mit
  `side: DoubleSide` in zwei Durchgängen und setzt davor jeweils `needsUpdate` (in jedem Bild zweimal das Programm neu
  nachgeschlagen, alle Uniforms neu hochgeladen). `twoSided(mesh)` macht daraus das Mesh mit einer Rückseiten-Kopie des
  Materials und ein Kind mit einer Vorderseiten-Kopie: dieselben Programme, dieselbe Reihenfolge, kein `needsUpdate`.
  Neue durchsichtige beidseitige Meshes laufen über `twoSided` (Glas `twoSidedAll` in furniture.js, Lichtschächte und
  Feuer in environment.js, Regen in weather.js, Projektorstrahl in cinema.js). Die Kopien eines Shader-Materials teilen
  dessen Uniform-Objekte; bei einem eingebauten Material (Glas, Lichtschacht) folgen sie späteren Änderungen der
  Eigenschaften nicht: wer `opacity` oder `color` im Lauf ändert, setzt sie auch an `sidesOf(material).back/front`
  (wie environment.js für die Schächte). Instanzierte Meshes bleiben, wie sie sind.
* **Texturen der Räume** (`world/texture-paint.js`, `texture-store.js`, `workers/texture-worker.js`): die Maler der
  prozeduralen Texturen (Holz, Dielen, Parkett, Putz, Tapete, Kassetten, Ziegel, Stoff, Leder, Teppiche, Marmor,
  Papier) sind reine Canvas-Funktionen ohne three.js (`PAINTERS[kind](opts)` → `{ map, normalMap?, roughnessMap? }`,
  `keyOf(kind, opts)`, `optsOf(key)`); `textures.js` macht daraus die Texturen und merkt sie sich je Schlüssel.
  `textureStore` (Singleton): `start()` zu Beginn von `main()` (liest die IndexedDB `lesesaal-textures`, Store
  `images`, und lässt die Standardmenge `STANDARD` von bis zu vier Workern malen, nur was nicht gespeichert ist),
  `ready()` vor `world.build()`, `take(key)` aus `textures.js`, `remember(key, images)` für selbst Gemaltes,
  `settle()` einige Sekunden nach dem Start (PNG-Blobs in die Datenbank, in Leerlaufzeit; etwa 50 MB), `info()`
  (`restored`, `painted`, `took`, `kept`, `startMs`, `stats` je Schlüssel in ms) für die Prüfungen
  (`window.__app.textures`). Der Schlüssel der Datenbank trägt den Hash von `texture-paint.js`, den der Bau als
  `COZYSHELVES_TEXTURES` ins Bündel schreibt (`build/bundle.js`, `build/web.js`): neue Maler, neue Bilder. Die PNGs
  sind verlustfrei und die Bilder deckend, ein wiederhergestelltes Bild ist Pixel für Pixel das gemalte
  (`createImageBitmap` ohne Farbraumwandlung und ohne Vormultiplikation). Ohne IndexedDB oder Worker (ein Browser ohne
  OffscreenCanvas) malt der Hauptfaden wie bisher. Die Standardmenge sind die Schlüssel eines Starts mit den
  Vorgaben (`perf-startup` druckt sie als `TEXTURES`) ohne die Teppiche: was mit Pfaden gezeichnet wird, kantet die
  Leinwand eines Workers anders als die der Seite, die Teppiche malt deshalb der Hauptfaden beim ersten Start und
  speichert sie, wie die Texturen aus Einstellungen des Nutzers (eine Wandfarbe). Nur reine Pixelrechnung gehört in
  die Standardmenge; `texture-pixels` vergleicht jede Textur mit einem frischen Bild des Hauptfadens.
* **Prüfungen**: `perf-matrix` (`PM_HOLD=1`: keine Schattenkarte neu gezeichnet), `perf-probe`, `perf-shots` mit
  `build/scripts/perf-diff.js`, `perf-startup`, `perf-panels`, `perf-cpu` (CPU-Profil je Bild und die Zähler eines
  Bildes), `perf-draws` (GPU-Zeit je Zeichenaufruf), `perf-toggle` (A/B zweier Zustände in einem Lauf)
  (`docs/strands/perf.md`).
