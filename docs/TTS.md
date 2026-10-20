# Vorlesen (Text-to-Speech) in Cozy Shelves

Cozy Shelves liest Bücher, Zeitungsartikel und Wikipedia-Seiten **vollständig lokal** vor. Python und CUDA sind nicht
nötig; die schweren deutschen Stimmen rechnen auf der Grafikkarte (WebGPU), die leichten auf dem Prozessor.

| Sprache  | Engine | Wo | Einrichtung |
|----------|--------|----|-------------|
| Englisch | **Kokoro** (82M, `kokoro-js` / Transformers.js / onnxruntime-web 1.22) | Web Worker `app/dist/tts-worker.js`, WebGPU, sonst WASM | keine: das Modell (`onnx-community/Kokoro-82M-v1.0-ONNX`) wird beim ersten Vorlesen von huggingface.co geladen und im Browser-Speicher abgelegt (einmalig ≈ 90 MB q8/WASM bzw. ≈ 330 MB fp32/WebGPU) |
| Deutsch  | **Kokoro / Martin** (StyleTTS2-ONNX aus `Godelaune/Kokoro-82M-ONNX-German-Martin`), **Standard** | Web Worker `app/dist/kokoro-de-worker.js`, WebGPU (onnxruntime-web 1.30), ohne WebGPU auf dem Prozessor | keine: 311 MB (Modell und Stimmvektor) werden einmalig nach `<userData>/piper-voices/` geladen |
| Deutsch  | **Piper** (VITS-ONNX aus `rhasspy/piper-voices`: Thorsten, Karlsson, Pavoque …) | Web Worker `app/dist/piper-worker.js`; die leichten Stimmen auf dem Prozessor (onnxruntime-web 1.22, `app/vendor/ort/`), Thorsten (hoch) auf WebGPU | keine: die gewählte Stimme (20 bis 110 MB) wird beim ersten Vorlesen einmalig nach `<userData>/piper-voices/` geladen |
| Deutsch  | *Kartoffelbox* (Chatterbox, Python-Sidecar) | `tts-server/server.py`, verwaltet von `electron/tts/sidecar.js` | **Altes Verfahren, optional**: nur wenn `tts-server/venv` eingerichtet **und** die Kartoffelbox-Stimme ausdrücklich gewählt ist. Startet nie von selbst. |

Die Phoneme beider deutschen Engines kommen von **espeak-ng**, genau so, wie die Stimmen trainiert wurden
(Abschnitt „Phonemisierung“).

## Deutsche Stimmen

Die Piper-Stimmen stammen aus `huggingface.co/rhasspy/piper-voices` (MIT bzw. die jeweilige Datensatzlizenz, siehe
`MODEL_CARD` im Repository), „Martin“ aus `huggingface.co/Godelaune/Kokoro-82M-ONNX-German-Martin` (Apache-2.0).
Beide laufen als ONNX-Graph im Renderer und werden vom selben Modul verwaltet (`electron/tts/piper.js`).

| ID | Stimme | rechnet auf | Download | Rate | Echtzeitfaktor¹ | Wortfehler² vorher → jetzt |
|----|--------|-------------|----------|------|-----------------|----------------------------|
| `de_DE-martin-kokoro` | **Martin (Kokoro)**, Standard seit 0.6 | WebGPU | 311 MB | 24 kHz | 0,12 bis 0,49 (Prozessor: 1,8 bis 2,7) | 55,1 % → **13,0 %** |
| `de_DE-thorsten-medium` | Thorsten (mittel) | Prozessor | 60 MB | 22,05 kHz | 0,20 bis 0,34 (WebGPU: 0,04) | 68,6 % → 37,6 % |
| `de_DE-thorsten-high` | Thorsten (hoch) | WebGPU | 109 MB | 22,05 kHz | 0,09 bis 0,10 (Prozessor: 1,6 bis 2,6) | 58,2 % → 34,5 % |
| `de_DE-thorsten-low` | Thorsten (schnell) | Prozessor | 60 MB | 16 kHz | nicht gemessen | nicht gemessen |
| `de_DE-thorsten_emotional-medium` | Thorsten emotional (8 Stimmungen) | Prozessor | 73 MB | 22,05 kHz | nicht gemessen | nicht gemessen |
| `de_DE-karlsson-low` | Karlsson, ruhige männliche Erzählstimme | Prozessor | 60 MB | 16 kHz | 0,15 bis 0,36 (WebGPU: 0,03) | 61,9 % → 29,4 % |
| `de_DE-pavoque-low` | Pavoque | Prozessor | 60 MB | 16 kHz | 0,14 bis 0,25 (WebGPU: 0,03) | 62,4 % → 16,4 % |
| `de_DE-kerstin-low` | Kerstin | Prozessor | 60 MB | 16 kHz | nicht gemessen | nicht gemessen |
| `de_DE-ramona-low` | Ramona | Prozessor | 60 MB | 16 kHz | nicht gemessen | nicht gemessen |
| `de_DE-eva_k-x_low` | Eva, kleinster Download | Prozessor | 20 MB | 16 kHz | nicht gemessen | nicht gemessen |

¹ Rechenzeit geteilt durch Sprechdauer im Renderer von Cozy Shelves (eine Desktop-Grafikkarte der Mittelklasse), gemessen mit
`build/scripts/tts-rtf-probe.js` und `tts-de-check.js` bei unterschiedlich starker Last durch andere Prozesse.
Unter 1 heißt schneller als Echtzeit; alles unter 0,5 liest ohne Lücken.
² Spracherkennung von Windows (System.Speech, de-DE, Diktat) auf 40 Sätzen mit Zahlen, Daten, Abkürzungen,
Komposita, Lehnwörtern und Namen, beide Spalten unter gleichen Bedingungen synthetisiert (onnxruntime-web auf dem
Prozessor); Zahlen werden vor dem Vergleich ausgeschrieben. „Vorher“ ist 0.5.0 (eigene Ausspracheregeln), „jetzt“
ist 0.6 (espeak-ng). Über die ganze Kette der App (`render()`, 60 Sätze, Martin und Thorsten hoch auf WebGPU):
Martin 12,0 %, Pavoque 18,6 %, Karlsson 29,1 %, Thorsten mittel 32,1 %, Thorsten hoch 32,5 %. Der Erkenner ist
kein Mensch, die Werte taugen für Vergleiche.

`de_DE-thorsten_emotional-medium` ist ein Mehrsprecher-Modell; die Stimmung kommt aus `settings.tts.germanSpeaker`
(`amused`, `angry`, `disgusted`, `drunk`, `neutral`, `sleepy`, `surprised`, `whisper`; Standard `neutral`).

**Warum Martin der Standard ist.** Martin ist mit Abstand die verständlichste Stimme (12 bis 13 % Wortfehler, die
nächste ist Pavoque mit 16 bis 19 %) und klingt am natürlichsten. Auf WebGPU rechnet sie schneller als Echtzeit, auch wenn die
Grafikkarte nebenbei voll ausgelastet ist. Cozy Shelves braucht für die 3D-Welt ohnehin eine Grafikkarte. Ohne WebGPU
läuft Martin auf dem Prozessor, dort ist sie langsamer als Echtzeit; die Statusmeldung sagt das, und eine leichte
Stimme (Pavoque, Karlsson, Thorsten mittel) liest dann flüssig. Eine schon gewählte Stimme bleibt bei der
Aktualisierung erhalten.

## Warum die deutschen Stimmen in 0.5 schlecht klangen

1. **Falsche Phoneme.** Alle Stimmen wurden auf den Phonemen von espeak-ng trainiert. 0.5 erzeugte sie mit eigenen
   Ausspracheregeln in Lehrbuch-IPA: `ʁ` statt `r`/`ɾ`, ein Knacklaut `ʔ` vor jedem Vokal, `aː` statt `ɑː`, `ç` als
   ein Zeichen statt `c` + U+0327, `ɐ̯` statt `ɾ`, die Betonung vor der Silbe statt vor dem Vokal. Gegenüber
   espeak-ng wich jedes dritte bis zweite Symbol ab (42 % Editierabstand auf 1 423 Sätzen). Die Modell-IDs von `ʁ`,
   `ʔ` und `ç` kamen im Training nie vor; das Modell spricht dann Unsinn. Das betraf jede deutsche Stimme.
2. **Martin auf WebGPU rechnete falsch.** Der WebGPU-Pfad von onnxruntime-web 1.22 (JSEP) liefert für diesen Graphen
   falsche Lautdauern: die Sätze kamen ein Viertel kürzer und unverständlich heraus (die Windows-Spracherkennung
   verstand „. Er ist indes“ statt „Guten Tag, das ist ein Test“). Auf dem Prozessor stimmte das Ergebnis, war dort
   aber zwei- bis dreimal langsamer als Echtzeit.
3. **Thorsten (hoch) war zu langsam.** Auf dem Prozessor 1,6 bis 2,6 mal langsamer als Echtzeit; WebGPU scheiterte
   bei allen Piper-Graphen (GatherND auf int64 in 1.22).
4. **Lücken und Klicks.** Jeder Satz startete erst nach dem `onended` des vorigen plus einem Timer; dazu kam die
   eigene Stille jeder Stimme (40 bis 700 ms, je Stimme verschieden) und sehr unterschiedliche Lautstärken (Pavoque
   mit Spitzen von 0,15, Martin mit 0,9).

## Phonemisierung (espeak-ng)

**Der Baustein.** `@diffusionstudio/piper-wasm` 1.0.0 (npm) ist das Programm `piper_phonemize` (rhasspy/piper-
phonemize mit rhasspy/espeak-ng) mit emscripten 3.1.47 als WebAssembly gebaut. Auf 1 487 deutschen Testsätzen
(Faust, Wikipedia, README, eigene Sätze mit Zahlen, Daten, Abkürzungen, Komposita, Lehnwörtern und Namen) gibt es
**Zeichen für Zeichen** dasselbe aus wie das Python-Paket `piper-phonemize` 1.1.0, mit dem Piper 1.x seine Stimmen
trainiert und gesprochen hat (geprüft unter WSL). Das gilt auch für die Eigenheiten dieser Version, die die Stimmen
gelernt haben und die deshalb bleiben: `??` für den Vokal `ʊɐ` („wurde“ → `vˌ??də`) und `y` für das kurze ü.
Die Python-Bibliothek von piper-tts 1.3 schreibt hier `ʊɐ`, `ʏ` und in einigen Konsonantengruppen `r` statt `ɾ`;
auf der Verständlichkeit ändert das nichts (gleiche Wortfehler bei Thorsten, Karlsson und Pavoque).

**Die Daten.** Das Datenpaket der npm-Bibliothek enthält espeak-ng-data für über 100 Sprachen (18 MB).
`build/espeak-vendor.js` (von `build/vendor.js` aufgerufen) liest das Inhaltsverzeichnis aus dem emscripten-Lader und
kopiert nur den deutschen Teil nach `app/vendor/espeak-ng/espeak-ng-data/`:

| Datei | Bytes | wofür |
|---|---|---|
| `phontab`, `phonindex`, `phondata`, `intonations` | 55 796, 39 074, 550 424, 2 040 | Phonemtabellen, Intonation |
| `de_dict` | 68 276 | deutsches Wörterbuch und Regeln |
| `en_dict` | 166 944 | englische Lehnwörter („Laptop“, „E-Mail“, „Software“), die `de_dict` an Englisch weiterreicht |
| `lang/gmw/de` | 42 | die Stimme `de` |

Zusammen 862 KB, dazu `files.json` (die Liste), `piper_phonemize.wasm` (635 KB) und `piper_phonemize.mjs` (der
Lader als ES-Modul: der Originaltext plus `export default createPiperPhonemize;`). Ohne `en_dict` buchstabiert
espeak-ng englische Lehnwörter; mit genau diesen Dateien ist die Ausgabe gleich der mit dem vollen Paket.

**Der Wrapper** (`app/src/workers/espeak-ng.js`): Das Programm ist eine Kommandozeile. Jeder Aufruf führt `main()`
mit `-l de --input <JSON> --espeak_data /espeak-ng-data --allow_missing_phonemes` aus und schreibt eine JSON-Zeile je
Text (`phonemes` als NFD-Codepunkte, `phoneme_ids` mit BOS/PAD/EOS je Satz). Der Lader bekommt über
`getPreloadedPackage` ein leeres Paket; die deutschen Dateien schreibt der Wrapper selbst ins MEMFS. Jeder Lauf von
`main()` verliert einige hundert Kilobyte des festen 16-MB-Speichers (nach 45 bis 70 kurzen Sätzen bricht emscripten
ab); der Wrapper ersetzt die Instanz deshalb nach 8 Läufen oder 12 000 Zeichen (5 ms, das kompilierte Modul und die
Daten bleiben). Die Satzgrenzen von espeak-ng liest er aus `phoneme_ids` (je Satz `[1, 0, (id, 0)*, 2]`), weil `?` als
Satzzeichen und als Teil von `??` vorkommt.

**Wie Piper spricht** (`piper-worker.js`): je espeak-ng-Satz ein Modelllauf mit den IDs der `phoneme_id_map` der
Stimme (BOS, PAD, je Phonem ID und PAD, EOS), dazwischen 0,2 s Stille wie `piper --sentence_silence`. Zeichen, die die
Stimme nicht kennt, fallen weg, wie bei Piper: die alten `low`-Modelle haben keine kombinierenden Zeichen, dort wird
`c` + U+0327 zu `c`, genau wie in ihrem Training.

**Vor espeak-ng** schreibt `normalizeGermanText()` (`app/src/workers/piper-de.js`) Zahlen aus, weil espeak-ng „3.“
als Satzende und „1990“ als „eintausendneunhundertneunzig“ liest: Jahre („neunzehnhundertneunzig“), Ordinalzahlen
mit Endung nach Artikel und Präposition („am dritten Oktober“, „an der dritten Stelle“, „aus dem siebzehnten und
achtzehnten Jahrhundert“), Datumsangaben, Uhrzeiten („14:30“, „8.30 Uhr“), Ergebnisse („2:1“ → „zwei zu eins“),
Geldbeträge („24,95 €“ → „vierundzwanzig Euro fünfundneunzig“), Einheiten nach Zahlen (km, m, kg, g, l, h, min …),
Brüche, Dezimalzahlen, Gliederungsnummern („3.2“ → „drei Punkt zwei“), römische Zahlen nach „Kapitel“, „Teil“ usw.
und bei Herrschern („Ludwig XIV.“ → „Ludwig der Vierzehnte“), „B12“, rund 60 Abkürzungen (z. B., u. a., d. h., bzw.,
ca., vgl., S. 12 ff., Dr., Prof., v. Chr. …). `normalizeForSpeech()` (`tts-lang.js`) fügt vorher Wörter zusammen, die
ein PDF am Zeilenende getrennt hat („Wör- ter“, aber nicht „Ein- und Ausgang“), entfernt weiche Trennzeichen und
Fußnotenzeichen und kürzt Webadressen auf die Domain.

**Rückfall.** Lässt sich espeak-ng nicht laden (fehlende Vendor-Dateien), sprechen die alten Regeln von `piper-de.js`
weiter, aber in die Zeichen von espeak-ng übersetzt (`germanPhonemesEspeakStyle()`: `r` statt `ʁ`, kein `ʔ`, `ɑː`,
`ɾ`, `ɜ`, NFD-`ç`, die Betonung vor dem Vokal). Der Abstand zu espeak-ng sinkt damit von 42 % auf 16 %. Die Worker
melden in `status`/`audio` das Feld `phonemizer: 'espeak'|'rules'`.

### Kokoro „Martin“

kikiri-tts hat Martin mit **misaki 0.9.4** (`misaki.espeak.EspeakG2P('de')`) auf espeak-ng 1.52 trainiert: espeak-ng
mit Bindebogen `^`, danach faltet misaki die gebundenen Paare in Kokoros Einzelzeichen (a^ɪ → `I`, a^ʊ → `W`,
ɔ^ɪ → `Y`, t^s → `ʦ`, t^ʃ → `ʧ`, d^ʒ → `ʤ` …) und das Tokenizer-Vokabular (178 Zeichen) wirft alles Unbekannte weg,
auch das kurze `ʏ`. `espeakToKokoro()` baut genau das aus der Ausgabe des Piper-Bausteins nach: NFC, `??` zurück zu
`ʊɐ`, kurzes `y` zu `ʏ` (fällt dann weg wie im Training), die Diphthonge gefaltet. Den Bindebogen kennt die Piper-
Ausgabe nicht; ob ein `ts` die Affrikate `ʦ` ist oder ein t mit s, entscheidet deshalb die Schreibung: z, tz, c vor
hellem Vokal und -tion sind `ʦ`, die Buchstaben t und s („nichts“, „Geburtstag“) zwei Phoneme, „tsch“ nur am
Wortanfang `ʧ` („Tschüss“, aber „Deutsch“ mit t und ʃ). Gegen misaki selbst (Python, espeakng-loader) sind auf den
Sätzen ohne Ziffern 97 % Wort für Wort gleich; der Rest unterscheidet sich in einer Affrikate oder einem
Nebenakzent der neueren espeak-Version.

| Kokoro | IPA | Token |
|---|---|---|
| `I` / `W` / `Y` | aɪ / aʊ / ɔɪ | 25 / 39 / 41 |
| `ʦ` / `ʧ` / `ʤ` | ts / tʃ / dʒ | 20 / 133 / 82 |
| `ɾ`, `ɜ`, `ɑ` | wie espeak-ng | 125, 87, 69 |
| `ʏ` | kurzes ü | fällt weg (nicht im Vokabular, auch im Training nicht) |

Texte über 510 Phoneme teilt `splitKokoroPhonemes()` an Satzzeichen, sonst an Leerzeichen.

**Der Graph** (aus `kokoro-martin.onnx` ausgelesen, Opset 17, keine `metadata_props`):

```
tokens    int64   [1, tokens_len]   [0, …Phonem-IDs, 0]
style     float32 [1, 256]          Zeile des Stimmvektors
speed     float32 [1]               0,5 … 2 (höher = schneller, ohne Tonhöhenänderung)
waveform  float32 [num_samples]     1-D, 24 000 Hz mono
duration  int64   [T]               Frames je Token (wird nicht benutzt)
```

**Der Stimmvektor** `voices-martin.npz` ist ein ZIP mit genau einem unkomprimierten Mitglied `martin.npy`, `<f4`,
Form `(510, 1, 256)`; alle 510 Zeilen sind byteweise gleich. `kokoroStyle()` nimmt trotzdem Zeile `n-1` wie
kokoro-onnx.

## Rechenwerk (onnxruntime-web)

`app/src/workers/ort-runtime.js` lädt je nach Gerät eines von zwei Builds:

* **Prozessor:** onnxruntime-web 1.22 (dieselbe Version, die der englische Worker in Transformers.js mitbringt),
  WASM aus `app/vendor/ort/`. Startet in etwa zwei Sekunden und ist auf dem Prozessor der schnellere Build. Für die
  leichten Piper-Stimmen (Echtzeitfaktor 0,15 bis 0,35).
* **WebGPU:** onnxruntime-web **1.30** (als npm-Alias `onnxruntime-web-webgpu` installiert, damit der englische
  Worker bei 1.22 bleibt), der neue WebGPU-Ausführungsanbieter (`ort.webgpu.bundle.min.mjs`, WASM
  `ort-wasm-simd-threaded.asyncify.wasm` in `app/vendor/ort-webgpu/`, 27 MB). Er rechnet Martin richtig (gleiche
  Dauern wie auf dem Prozessor, von der Spracherkennung fehlerfrei verstanden) und alle Piper-Graphen.

Die Stimmen mit `gpu: true` im Katalog (Martin, Thorsten hoch) laufen auf WebGPU, sobald der Worker einen Adapter
bekommt; ohne Adapter oder wenn eine Sitzung dort scheitert, auf dem Prozessor. `voice.device` (`'webgpu'|'wasm'`)
erzwingt ein Gerät (Prüfskripte). Die leichten Stimmen bleiben bewusst auf dem Prozessor: dort sind sie flüssig,
starten schneller und belasten die Grafikkarte der 3D-Welt nicht. Ohne `crossOriginIsolated` (app://) rechnen beide
Builds einthreadig; mehr Threads brachten in Messungen ohnehin kaum etwas (4 Threads: 1,7 statt 1,9 bei Thorsten hoch).

## Wiedergabe

`tts-client.js` legt jeden Satz auf die Zeitleiste des einen `AudioContext`: sample-genau direkt nach dem vorigen,
mit fester Pause, unabhängig davon, wie spät die Timer des Renderers laufen (ein schwerer 3D-Frame, ein minimiertes
Fenster).

* **Vorlauf:** bis zu 3 Sätze werden voraus synthetisiert (`PREFETCH`), alle Teilstücke eines Satzes gehen auf einmal
  an den Worker. Jedes Teilstück kommt auf die Zeitleiste, sobald es fertig ist; geplant wird höchstens 6 s voraus
  (`HORIZON`). Ein Satz, der nicht rechtzeitig fertig war, beginnt sofort, wenn er da ist (in der Zeitleiste als
  `late` vermerkt).
* **Erster Ton:** Der erste Satz einer Lesung wird in Stücke von höchstens 90 Zeichen geteilt (sonst 300), am
  liebsten an einem Komma. Gemessen: mit geladener Stimme 0,5 bis 1,5 s bis zum ersten Ton, beim Kaltstart 2 bis 6 s
  (Modell laden, bei WebGPU Shader übersetzen).
* **Säubern** (`tts-audio.js`): die Stille vor und nach jedem Stück wird bis auf 30 bzw. 70 ms gekürzt, die Ränder
  werden weich ein- und ausgeblendet (4 bzw. 12 ms, keine Klicks), die Lautstärke wird von Stück zu Stück sanft auf
  einen gemeinsamen Pegel gezogen (RMS 0,075, Faktor 0,4 bis 4, nie über 0,95 Spitze).
* **Pausen:** 320 ms zwischen Sätzen, 120 ms zwischen den Stücken eines langen Satzes, beide geteilt durch das Tempo.
  `speak(…, { gap })` (ms) ersetzt die Satzpause.
* **Tempo:** Piper über `length_scale`, Kokoro über den Eingang `speed`, beide ohne Tonhöhenänderung; nur Kartoffelbox
  braucht `playbackRate`.
* Seitenzahlen und andere Stücke ohne Buchstaben bleiben stumm.

## Bücher vorlesen (ab 0.7)

Bis 0.6 lasen die deutschen Stimmen in vielen deutschen Büchern Unsinn. Fünf Ursachen, alle behoben:

1. **Die Sprache kam aus den Metadaten.** Ein deutsches PDF mit `en-US` im Dokument las die englische Kokoro-Stimme
   (96 bis 106 % Wortfehler). Jetzt entscheidet der Text, Absatz für Absatz (`tts-lang.js`: `normalizeLangCode()`,
   `chooseLanguage()`, `planLanguages()`). Die Sprachangabe des Buchs zählt nur, wenn der Text nichts Eindeutiges sagt,
   danach die Sprache der App, zuletzt Deutsch. Ein Absatz wechselt die Sprache nur bei klarem Befund (mindestens
   fünf Wörter und doppelt so viele Treffer wie die Sprache des Buchs). Fehlt das englische Modell, liest die deutsche
   Stimme den englischen Absatz, ein Download mitten im Buch geschieht nie.
2. **PDF-Text ohne Leerzeichen.** pdf.js legt je Textstück ein `<span>` ohne Zwischenraum in die Textebene; Wörter am
   Zeilenende liefen zusammen, Kopfzeilen und Seitenzahlen kamen mit, zwei Spalten wurden Zeile für Zeile gemischt.
   `tts-pdf.js` setzt die Seite aus den Positionen neu zusammen: Zeilen aus den Grundlinien, Spalten und Blöcke mit
   einem XY-Schnitt, Absätze aus dem Zeilenabstand, getrennte Wörter zusammengefügt, wiederkehrende Kopfzeilen,
   Seitenzahlen und Zeilen ohne lesbaren Text weggelassen. Jeder Satz behält seinen DOM-Bereich für die Markierung.
3. **Jedes neue Zeichnen einer PDF-Seite hängte ihren Text noch einmal an.** Behoben in
   `vendor-src/foliate-js/pdf.js`; `data-lesesaal="done"` sagt dem Vorlesen, dass die Textebene vollständig ist.
4. **Schachnotation ging roh an espeak-ng.** `tts-chess.js` (`hasChessNotation()`, `speakChess(text, lang)`) spricht
   die Züge in Worten, in der Sprache der Stimme: „Sf3“ wird „Springer f drei“ bzw. „knight F three“, „0-0“ „kurze
   Rochade“, Figurinen und die englischen Buchstaben von Figurinenschriften ebenso.
5. **Zeichensalat.** `tts-junk.js` (`inspectText()`, `isJunk()`) erkennt Text, der nie eine Stimme erreichen darf:
   kaputte Zeichenzuordnungen von Schriften (Buchstaben im falschen Häufigkeitsmuster, private Zeichen, fremde
   Schriften), Diagramme in Schachschriften, Symbolreihen. Eine Seite ohne lesbaren Text zeigt den Hinweis „Diese
   Seite hat keinen lesbaren Text“ und wird übersprungen; nach acht solchen Seiten hintereinander endet das Vorlesen
   (`MAX_UNREADABLE` in `reader-tts.js`).

Dazu zählt in EPUB und HTML ein `<br>` als Leerzeichen. Wortfehler vorher und nachher (Spracherkennung von Windows wie
oben, Testbücher aus `build/testlib/gen_tts_books.py`):

| Buch | 0.6 | 0.7 |
|---|---|---|
| deutsches PDF, als Englisch markiert | 106 % | 32 % |
| Schach-PDF, als Englisch markiert | 98 % | 50 % |
| deutsches EPUB, als Englisch markiert | 96 % | 12 % |
| englisches Buch, als Deutsch markiert | 81 % | 10 % |
| PDF mit zwei Spalten | 58 % | 38 % |

## Stimmenmenü und alle Stimmen (ab 0.7)

**Stimmenmenü** (`app/src/ui/reader/tts-voice-menu.js`, `openVoiceMenu(opts)`, `closeVoiceMenu()`): die deutschen und
die englischen Stimmen mit ihrem Zustand (vorhanden, zum Laden mit Größe, wird geladen), das Tempo (0,8 bis 1,5) und
„Sprache automatisch“. Geöffnet mit dem Pfeil neben 🔈, einem Rechtsklick auf 🔈 oder `Umschalt`+`V` im Reader und im
Lesebrowser, in Zeitung und Lexikon mit dem Pfeil neben „Vorlesen“ (`tts-button.js`). Eine gewählte Stimme wird wie in
den Einstellungen gespeichert (`tts.germanVoice`, `tts.englishVoice`) und spricht ab dem nächsten Satz
(`session.retune()`); eine fehlende Stimme wird zuerst geladen, bis dahin liest die bisherige weiter. Ist „Sprache
automatisch“ aus, liest das Buch nur auf Deutsch oder nur auf Englisch; die Wahl steht je Buch in `tts.bookLang`.

**Alle Stimmen herunterladen** (`app/src/ui/tts-all-voices.js` in *Einstellungen → Vorlesen*): jede deutsche Stimme über
den Hauptprozess (fortsetzbare `.part`-Dateien, wie immer) und das englische Modell über seinen Worker
(Transformers.js-Cache), eine nach der anderen. Vorhandene Stimmen werden übersprungen, ein abgebrochener Download geht
beim nächsten Mal weiter, ein Fehler hält die übrigen nicht auf und lässt sich wiederholen. Der Download läuft weiter,
wenn die Einstellungen geschlossen werden. Vor dem ersten englischen Vorlesen fragt die App nach dem englischen Modell
(88 MB, mit WebGPU 311 MB).

## Alle Dateien

```
app/src/workers/piper-worker.js      Piper-Worker (Prozessor oder WebGPU, Phoneme von espeak-ng)
app/src/workers/kokoro-de-worker.js  Kokoro-Worker Deutsch („Martin“)
app/src/workers/espeak-ng.js         espeak-ng als WebAssembly: Laden, Instanzen, Sätze
app/src/workers/de-phonemes.js       Text → espeak-ng-Sätze für beide Worker, Rückfall auf die Regeln
app/src/workers/ort-runtime.js       die beiden onnxruntime-web-Builds (1.22 Prozessor, 1.30 WebGPU)
app/src/workers/piper-de.js          Textnormalisierung, Regeln (Rückfall), Phonem→ID, Kokoro-Alphabet,
                                     espeakToKokoro(), ONNX-Eingaben, .npy/.npz-Parser (pur, testbar)
app/src/workers/tts-worker.js        Kokoro-Worker (Englisch)
app/src/ui/reader/tts-client.js      ttsClient: gemeinsame Schnittstelle aller Engines, Zeitleiste
app/src/ui/reader/tts-audio.js       Säubern, Pegel, Analyse (pur, testbar)
app/src/ui/reader/tts-lang.js        detectLanguage(), splitSentences(), normalizeForSpeech(), normalizeLangCode(),
                                     chooseLanguage(), planLanguages() (Sprache je Absatz)
app/src/ui/reader/tts-pdf.js         der Text einer PDF-Seite aus den Positionen (assemblePage(), pur, testbar)
app/src/ui/reader/tts-chess.js       Schachnotation in Worten (hasChessNotation(), speakChess())
app/src/ui/reader/tts-junk.js        Zeichensalat erkennen (inspectText(), isJunk())
app/src/ui/reader/tts-voice-menu.js  das Stimmenmenü am Vorlese-Symbol
app/src/ui/reader/tts-voice-id.js    Stimmen-IDs und ihre Engines
app/src/ui/reader/tts-button.js      Vorlese-Knopf von Zeitung und Lexikon
app/src/ui/tts-all-voices.js         „Alle Stimmen herunterladen“ in den Einstellungen
app/src/ui/reader/reader-tts.js      Vorlese-Leiste im Reader (Sprache je Buch, Seiten ohne lesbaren Text)
electron/tts/test-reading.js         Tests: Sprache, PDF-Seiten, Schachnotation, Zeichensalat, Sätze
electron/tts/piper.js                Stimmenkatalog, Download nach <userData>/piper-voices, IPC
electron/tts/sidecar.js              Kartoffelbox (altes Verfahren)
build/espeak-vendor.js               espeak-ng nach app/vendor/espeak-ng (von build/vendor.js aufgerufen)
app/vendor/espeak-ng/                piper_phonemize.mjs/.wasm, espeak-ng-data/ (deutscher Teil), README.txt
app/vendor/ort/ · app/vendor/ort-webgpu/   onnxruntime-web 1.22 bzw. 1.30 (WASM)
```

## Client-API (`app/src/ui/reader/tts-client.js`)

```js
import { ttsClient } from './tts-client.js';   // Default-Export ebenfalls vorhanden

await ttsClient.status()
// → { english, german, englishDetail, germanDetail, piperDetail: { … voices[] }, active, paused, index, total, lang, message }
await ttsClient.voices('de')
// → [{ id:'de_DE-martin-kokoro', name:'Martin (Kokoro)' bzw. '… (311 MB laden)', engine:'kokoro-de', installed, bytes, gpu:true, … },
//     { id:'de_DE-thorsten-medium', engine:'piper', gpu:false, … }, …]   (Kartoffelbox nur, wenn eingerichtet)
await ttsClient.installVoice(id) · await ttsClient.removeVoice(id) · ttsClient.cancelVoiceDownload(id)
await ttsClient.missingGermanVoice(id?)   // { id, name, bytes } wenn die Stimme erst geladen werden muss

const session = ttsClient.speak(sentences /* string[] */, {
  lang: 'de' | 'en' | 'auto', voice, speed,   // 0,5–2, Standard settings.tts.speed
  onSentence(i) {}, onEnd() {}, onError(err) {}, onStatus(status) {},
  gap: 320, volume: 1,                          // optional: Satzpause in ms, Lautstärke
});
session.pause(); session.resume(); session.stop(); session.skip(+1 | -1);
session.playing; session.paused; session.stopped; session.started; session.index; session.total; session.lang
session.timeline   // { firstAudioMs, entries: [{ index, start, end, late, pieceLate, synthMs, pieces, engine, phonemizer }] }

ttsClient.timeline                    // die Zeitleiste der laufenden oder der letzten Lesung
await ttsClient.render(sentences, { lang, voice, speed, gap })
// → { sampleRate, samples, marks: [{ index, start, end }], pieces: [{ lead, tail, level, peak, gain, phonemizer, phonemes }], synthMs }
//   synthetisiert wie speak() (gleiche Stücke, Säubern, Pegel, Pausen) in einen Puffer, ohne etwas abzuspielen
ttsClient.speakText(text, opts) · ttsClient.stopAll() · await ttsClient.warmup('en'|'de') · ttsClient.dispose()
ttsClient.engineForVoice(id)          // 'kokoro' | 'piper' | 'kokoro-de' | 'kartoffelbox' | null
window.__ttsClient                    // für die Prüfskripte (das Bundle exportiert nichts)

// ab 0.7
ttsClient.speak(sentences, { …, langs: ['de'|'en', …], chess })   // langs: die Sprache je Satz; chess: ein Schachbuch
session.langOf(i)                     // die Sprache von Satz i, 'de' oder 'en'
session.retune()                      // Stimmen oder Tempo der Einstellungen gelten ab dem nächsten Satz
session.update({ voice, speed })      // eine andere Stimme oder ein anderes Tempo nur für diese Lesung, ab dem nächsten Satz
ttsClient.speakText(text, { lang, force })   // Sprache je Absatz (planLanguages); force: alles in lang (Stimmenmenü)
ttsClient.englishModel(force?)        // → { cached: true|false|null, bytes, dtype }   lädt nichts
ttsClient.installEnglish() · ttsClient.cancelEnglish() · ttsClient.englishVoices()   // die 28 englischen Stimmen
ttsClient.voiceInventory()            // → [{ id, name, kind: 'de'|'en', bytes, received, installed }]
ttsClient.downloadAllVoices({ only? }) · ttsClient.cancelDownloads() · ttsClient.downloads
await ttsClient.missingVoice(lang, voiceId?)   // { id, name, bytes, lang } oder null
```

* `speak()` liefert die Session sofort; sie wartet intern auf den Einstellungs-Cache.
* `onSentence(i)` kommt, wenn Satz `i` hörbar beginnt (nicht wenn er geplant wird).
* `onEnd` nur bei natürlichem Ende (nicht nach `stop()`); Fehler kommen über `onError`.
* Fallback: Ist Kokoro (Englisch) nicht ladbar, spricht Kartoffelbox (falls eingerichtet). Fällt die gewählte deutsche
  Engine aus, werden die anderen in der Reihenfolge `piper` → `kokoro-de` → `kartoffelbox` probiert, eine andere
  ONNX-Engine aber **nur, wenn ihre Stimme schon auf der Platte liegt** (nie ein überraschender Download).
* Nach 2 Minuten ohne Vorlesen werden die Worker beendet, damit kein Modell im Speicher bleibt; die Stimmen auf der
  Grafikkarte (Martin, Thorsten hoch) bleiben 10 Minuten geladen, weil ihr Start 5 bis 10 s dauert.
* Bus: `bus.on('tts:speak', ({text, lang}))`, `bus.on('tts:stop')`, `bus.emit('tts:status', status)`, ab 0.7
  `bus.emit('tts:downloads', { running, cancelled, current, items, total, received, progress, failed })` für „Alle
  Stimmen herunterladen“.
* Ab 0.7 erreicht kein Zeichensalat eine Stimme (`tts-junk.js`), und Schachnotation wird in der Sprache der Stimme in
  Worten gesprochen (`tts-chess.js`), in `speak()` wie in `render()`.
* Test-Hooks: `window.__ttsTrace = []` sammelt je Satz Text, Gesprochenes, Sprache, Engine, Stimme und Phoneme;
  `window.__ttsDryRun = true` (oder eine Zahl in Sekunden) antwortet mit einem kurzen leisen Ton statt einer Stimme;
  `window.__readerTts` zeigt den Plan der Vorlese-Leiste (Sprache, Sätze, aktueller Satz).

## Worker-Protokolle

### Piper (`app/src/workers/piper-worker.js` → `app/dist/piper-worker.js`)

```
→ { type:'load',  voice: { id, name, modelUrl, config, speaker?, gpu?, device? } }
→ { type:'speak', id, text, speed?:1, voice, phonemes? }      (phonemes: fertige espeak-Phoneme, ein Satz)
← { type:'status', state:'idle'|'loading'|'ready'|'error', progress:0..1, message, voice, device, phonemizer }
← { type:'audio', id, sampleRate, samples:Float32Array (transferred), phonemes, phonemizer:'espeak'|'rules', synthMs }
← { type:'error', id, error }      ← { type:'cancelled', id }
→ { type:'cancel', id } | { type:'cancelAll' } | { type:'status' } | { type:'dispose' }
```

ONNX-Ein-/Ausgaben (`buildPiperInputs()`): `input` int64 [1, T], `input_lengths` int64 [1], `scales` float32
[noise_scale, length_scale / speed, noise_w], `sid` int64 [1] nur bei Mehrsprecher-Modellen, `output` float32 [1,1,N].

### Kokoro Deutsch (`app/src/workers/kokoro-de-worker.js`)

Dasselbe Protokoll; `voice` = `{ id, name, modelUrl, voicesUrl, voiceName, device? }`, `sampleRate` immer 24000.

### Kokoro Englisch (`app/src/workers/tts-worker.js`)

```
→ { type:'init', opts?: { device?:'webgpu'|'wasm', dtype?:'fp32'|'q8'|…, model?, wasmPaths?, localModelPath? } }
← { type:'status', state, progress, message, device, dtype, files }
→ { type:'speak', id, text, voice?:'af_heart', speed?:1 }    ← { type:'audio', id, sampleRate:24000, samples, text }
→ { type:'voices' } | { type:'cancel', id } | { type:'cancelAll' } | { type:'status' } | { type:'dispose' }
```

## Hauptprozess

```
api.invoke('tts:piperVoices')   → { voices:[{ id, name, gender, quality, sampleRate, bytes, note, engine, gpu, installed, downloading, speakers? }], dir, defaultVoice }
api.invoke('tts:piperEnsure', id, { download? })
                                → { ok:true, id, name, engine:'piper', path, modelUrl:'lfile://…', bytes, sampleRate, config, gpu }
                                | { ok:true, id, name, engine:'kokoro-de', path, modelUrl, voicesUrl, voiceName:'martin', bytes, sampleRate:24000, config:null, gpu:true }
                                | { error, code:'offline'|'not-installed'|'download-failed'|'unknown-voice'|'cancelled' }
api.invoke('tts:piperStatus') · ('tts:piperRemove', id) · ('tts:piperCancel', id) · ('tts:piperOpenFolder')
api.on('tts:piper', fn)         → Broadcast bei jedem Zustandswechsel
```

Der Download schreibt nach `<userData>/piper-voices/<id>.onnx(.json|.voices.npz)` über eine `.part`-Datei mit
`Range`-Requests (fortsetzbar, bis zu 4 Versuche) und prüft die exakte Dateigröße. `COZYSHELVES_PIPER_DIR` überschreibt
den Ablageort, `COZYSHELVES_PIPER_BASE` und `COZYSHELVES_KOKORO_DE_BASE` die Downloadquellen. Seit 0.7 nennen
`tts:piperVoices`, `tts:piperStatus` und `tts:piper` für jede Stimme auch `received`: was ein abgebrochener Download
schon auf der Platte liegen hat.

## Einstellungen (`settings.tts`)

```
englishVoice   'af_heart' …                      Kokoro-Stimme
germanVoice    'de_DE-martin-kokoro' (Standard), eine Piper-Stimme oder 'kartoffelbox:default' (altes Verfahren)
germanSpeaker  'neutral' | 'amused' | …          nur de_DE-thorsten_emotional-medium
speed          0.5 bis 2
bookLang       {}                                ab 0.7: Sprache je Buch aus dem Stimmenmenü ({ <Buch-ID>: 'de'|'en'|null },
                                                 null oder fehlend = „Sprache automatisch“)
autoLang       true                              seit 0.7 ungenutzt (die Sprache kommt je Absatz aus dem Text)
englishDevice / englishDtype                     Kokoro (Englisch): Backend erzwingen
germanPrompt / germanModel / germanDevice / pythonPath   nur Kartoffelbox
```

Werte älterer Builds (`'default'`, `'builtin'`, Pfade, englische IDs) werden beim ersten Start zur Standardstimme.
Eine gültige gespeicherte Wahl (z. B. `de_DE-karlsson-low`) bleibt.

## Tests

```
npm test                                               # u. a. electron/tts/test-tts.js mit test-phonemes.js und test-reading.js
COZYSHELVES_PIPER_DIR=<Stimmen> node build/screenshot.js tts-de-check    # alle installierten deutschen Stimmen
python build/testlib/gen_tts_books.py <Ordner>         # Testbücher zum Vorlesen (PDFs in den Stilen verschiedener Hersteller, EPUBs, eine Lexikonseite)
COZYSHELVES_BOOKS="<Ordner>/lib|structured" TTS_BOOKS=<Ordner> COZYSHELVES_PIPER_DIR=<Stimmen> node build/screenshot.js reader-tts-check
                                                       # Bücher vorlesen: Sprache je Absatz, Stimme, erste Sätze, Schachnotation,
                                                       # Seiten ohne lesbaren Text, Stimmenmenü, Lesebrowser (TTS_PARTS=books,real,menu,browser)
COZYSHELVES_PIPER_DIR=<Stimmen> node build/screenshot.js tts-rtf-probe   # Echtzeitfaktor je Stimme und Gerät
COZYSHELVES_PIPER_DIR=<Stimmen> WAV_DIR=<Ordner> WAV_CORPUS=<Sätze.json> node build/screenshot.js tts-wav-dump
node build/screenshot.js audit-tts | audit-tts-default | audit-tts-en | voices-check
```

* `electron/tts/test-phonemes.js`: espeak-ng gegen `piper-phonemize` 1.1.0 auf 150 Sätzen (Fixture
  `electron/tts/fixtures/de-phonemes.json`, Zeichen für Zeichen und Satz für Satz), die Vendor-Dateien, 300 Aufrufe
  hintereinander, `espeakToKokoro()` gegen misaki, die Normalisierung, Phonem-IDs, der Rückfall und `tts-audio.js`.
  Nutzt `app/vendor/espeak-ng`, sonst extrahiert es die Dateien selbst aus `node_modules`.
* `build/scripts/tts-de-check.js`: je Stimme `render()` von sechs Sätzen (Abtastrate, Phoneme von espeak-ng und gleich
  der Referenz, kein Übersteuern, Pausen von genau 320 ms, keine Aussetzer, Gerät), der warme Echtzeitfaktor, dann
  eine stumme Live-Lesung (erster Ton, kein Satz zu spät, alle Sätze in Reihenfolge, Pause/Weiter, Sprung +2 und −1).
  `TTS_CHECK_EN=1` liest zusätzlich englisch (das Modell muss in den Nutzerdaten liegen).
* Verständlichkeit: `tts-wav-dump` schreibt WAV-Dateien; die Windows-Spracherkennung (System.Speech, de-DE) erkennt
  sie, der Wortfehler gegen den ausgeschriebenen Text ist der Messwert der Tabelle oben. Für ganze Bücher schreibt
  `reader-tts-check` mit `TTS_PARTS=wav` und `TTS_WAV_DIR=<Ordner>` je Buch eine WAV-Datei und ihren Text.
* `electron/tts/test-reading.js`: Sprache von Buch und Absatz, der Text von PDF-Seiten (Fixture
  `electron/tts/fixtures/pdf-pages.json`), Schachnotation in Worten, die Erkennung von Zeichensalat, die Satzgrenzen.
* `reader-tts-check` mit `TTS_PARTS=all` prüft „Alle Stimmen herunterladen“ gegen einen lokalen Ersatz für Hugging
  Face: ein eigener Lauf mit leerem `COZYSHELVES_PIPER_DIR`, `COZYSHELVES_PIPER_BASE=http://127.0.0.1:47321/piper/` und
  `COZYSHELVES_KOKORO_DE_BASE=http://127.0.0.1:47321/kokoro/`. Er schreibt rund 875 MB Platzhalter, die danach gelöscht
  werden können.

## Lizenzen

espeak-ng (rhasspy/espeak-ng) steht unter der GPL-3.0-or-later, piper-phonemize unter MIT; der WebAssembly-Build
`@diffusionstudio/piper-wasm` enthält beides (Quellen und Bauanleitung: github.com/diffusion-studio/piper-wasm).
`app/vendor/espeak-ng/README.txt` nennt das im Paket. onnxruntime-web (1.22 und 1.30) ist MIT. Siehe `LIZENZEN.md`.

## Bekannte Grenzen

* Der erste Start je Sprache braucht Internet (Kokoro-Modell bzw. deutsche Stimme); danach offline.
* Martin und Thorsten (hoch) brauchen WebGPU, um flüssig zu lesen. Ohne Adapter rechnen sie auf dem Prozessor zwei-
  bis dreimal langsamer als Echtzeit; die Statusmeldung sagt das.
* Kaltstart: Martin lädt 325 MB (kurzzeitig rund 700 MB Arbeitsspeicher) und übersetzt beim ersten Satz WebGPU-
  Shader, der erste Ton kommt nach 4 bis 11 s (je nach Auslastung der Grafikkarte und ob Chromium die Shader schon
  zwischengespeichert hat); mit geladener Stimme nach 0,5 bis 2,5 s.
* espeak-ng spricht, wie es trainiert wurde, auch mit seinen Fehlern (z. B. „Kapitel“ mit Betonung auf der ersten
  Silbe). Eigennamen und seltene Fremdwörter liest es nach seinen Regeln.
* Seitenwechsel im PDF: der Reader sammelt die Sätze je Seite; am Seitenende entsteht eine kurze Pause, bis die
  nächste Seite gesammelt und ihr erstes Stück synthetisiert ist. Kopfzeilen und Seitenzahlen erkennt `tts-pdf.js`
  seit 0.7 am Rand der Seite: kleiner als der Text, deutlich abgesetzt, nur eine Zahl, der Buchtitel oder schon auf
  früheren Seiten gesehen. Eine Kopfzeile, auf die nichts davon zutrifft, wird gelesen.
* Seiten ohne lesbaren Text (Scans ohne Texterkennung, Schriften mit kaputter Zeichenzuordnung) bleiben stumm; der
  Cozy Shelves liest kein Bild vor.
* Bei Martin fällt das kurze ü (`ʏ`) aus der Phonemfolge, wie im Training (Kokoros Vokabular kennt es nicht).
* Kartoffelbox (altes Verfahren) braucht weiterhin Python 3.10 bis 3.12, PyTorch und möglichst eine NVIDIA-GPU.
