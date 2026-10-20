# Lizenzen

Cozy Shelves ist freie Software unter der **GNU Affero General Public License, Version 3 oder (nach deiner Wahl) jeder späteren
Version** (AGPL-3.0-or-later). Den vollständigen Text enthält [LICENSE](LICENSE). Copyright © Cozy Shelves contributors.

Cozy Shelves enthält Bestandteile anderer Projekte, jeder mit seiner eigenen Lizenz. chessground (GPL-3.0-or-later),
Stockfish (GPL-3.0) und eSpeak NG (GPL-3.0-or-later) stehen unter der GPL. Cozy Shelves wird als Ganzes unter
der AGPL weitergegeben, was § 13 der GPL-3.0 erlaubt. Alle übrigen Lizenzen sind mit ihr vereinbar. Die vollständige Liste mit Versionen und Quellen
steht in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (englisch), die Lizenztexte aller Pakete mit ihren
Urheberrechtsvermerken in `THIRD_PARTY_LICENSES.txt` (wird von `npm run dist:win` erzeugt und liegt dem Programm bei).

| Bestandteil | Zweck | Lizenz |
|---|---|---|
| Electron 44 (mit Chromium und Node.js) | Desktop-Laufzeit | MIT; Chromium: `LICENSES.chromium.html` im Programmordner |
| Android-App: AndroidX (webkit 1.12, activity 1.9, core 1.15), Kotlin-Standardbibliothek 2.1, Android Gradle Plugin 8.7 | WebView-Hülle der Android-App (`android/`), nur im APK | Apache-2.0 |
| three.js r186 | 3D-Welt | MIT |
| Leaflet 1.9.4 | Weltkarte (zeigt die Kacheln von OpenStreetMap) | BSD-2-Clause |
| foliate-js (John Factotum) mit fflate und zip.js | Reader für EPUB, MOBI, AZW3, FB2, CBZ | MIT, MIT, BSD-3-Clause |
| PDF.js 5.5 (Mozilla) mit Adobe-CMaps, Foxit- und Liberation-Schriften | PDF-Darstellung | Apache-2.0, BSD-3-Clause, OFL-1.1 |
| chessground (lichess.org) mit den Figuren „cburnett“ (Colin M.L. Burnett) | 2D-Schachbrett | GPL-3.0-or-later, Figuren GPL-2.0-or-later |
| chess.js | Schachregeln | BSD-2-Clause |
| Stockfish 18 (stockfish.js) | Schach-Engine | GPL-3.0 |
| Netz der Diagrammerkennung (`app/src/ui/chess/diagram/net-weights.js`, 102 KB), eigene Arbeit | erkennt die Figuren in Schachdiagrammen; geübt mit `build/chess-net` an erzeugten Diagrammen mit den Figuren von chessground (cburnett), DejaVu Sans, den Schachzeichen der Windows-Schriften und erfundenen Figurensätzen; enthält keine Schriftdaten | wie Cozy Shelves |
| kokoro-js mit Transformers.js und phonemizer, Kokoro-Stilvektoren | englisches Vorlesen | Apache-2.0 |
| eSpeak NG (in phonemizer und in `@diffusionstudio/piper-wasm`) | Lautschrift für die Stimmen | GPL-3.0-or-later |
| piper-phonemize als WebAssembly (`@diffusionstudio/piper-wasm` 1.0.0) | deutsches Vorlesen | MIT |
| onnxruntime-web 1.22 und 1.30 (Microsoft) | Sprachmodelle auf Prozessor und Grafikkarte | MIT |
| hls.js | Streams der Mediathek | Apache-2.0 |
| hyphen mit den TeX-Trennmustern aus hyph-utf8 (Deutsch 1996, Englisch US) | Silbentrennung im Lesebrowser und in der Textansicht von PDFs | ISC, Trennmuster unter eigenen freien Lizenzen |
| @mozilla/readability, jsdom | Volltext von Artikeln, Lesemodus | Apache-2.0, MIT |
| rss-parser, chokidar, marked, mammoth, jszip | Feeds, Ordnerüberwachung, Markdown, DOCX | MIT, MIT, MIT, BSD-2-Clause, MIT (wahlweise GPL-3.0) |
| EB Garamond, Cormorant Garamond, Caveat, VT323, Playfair Display (Fontsource) | Typografie | OFL-1.1 |
| Literata (TypeTogether), Source Serif 4 (Adobe), Atkinson Hyperlegible Next (Braille Institute), aus Fontsource in `app/data/fonts` | Leseschriften im Reader | OFL-1.1 |
| SQLite mit FTS5 (im Node.js von Electron, über `node:sqlite`) | Index der Volltextsuche | gemeinfrei |
| Twemoji Country Flags (TalkJS, Teilmenge von Twemoji Mozilla) | Flaggen in der Weltkarte | Grafiken CC BY 4.0 (Twemoji, © Twitter, Inc. und weitere), Schrift Apache-2.0 (Mozilla), Teilmenge MIT (TalkJS) |
| Natural Earth 5.1 | Atlas der Weltkarte (Länder, Seen, Flüsse, Orte) und Steckbriefe | gemeinfrei |
| Wikidata | Amtssprachen, Währungen, Flächen, Einwohner der Städte | CC0 1.0 |

Musik, Geräusche, Texturen, Aquarelle und Graffiti erzeugt das Programm selbst, Fremdaufnahmen oder fremde Bilder sind
nicht enthalten. Die Aquarell-Simulation folgt Curtis, Anderson, Seims, Fleischer, Salesin: „Computer-Generated
Watercolor“ (SIGGRAPH 1997).

## Was erst bei Gebrauch geladen wird

| Was | Lizenz |
|---|---|
| Kokoro-82M (hexgrad), englische Stimme | Apache-2.0 |
| „Martin“, deutsche Stimme (Kokoro-82M-ONNX-German-Martin von Godelaune; kikiri-tts, dida-80b; Stimme von Martin Harbecke) | Apache-2.0 |
| Piper-Stimmen „Thorsten“ (schnell, mittel, hoch) und „Thorsten emotional“ | CC0 (Datensatz Thorsten-Voice) |
| Piper-Stimme „Kerstin“ | CC0 (Datensatz) |
| Piper-Stimmen „Karlsson“, „Ramona“, „Eva“ | Lizenz des M-AILABS Speech Dataset, siehe Modellkarte der Stimme |
| Piper-Stimme „Pavoque“ | CC BY-NC-SA 4.0 (Datensatz), nur nicht kommerzielle Nutzung |
| optionaler Python-Dienst (`tts-server`): chatterbox-tts (Resemble AI), Kartoffelbox (SebastianBodza) | MIT, CC-BY-4.0 |
| Wikipedia- und Wiktionary-Inhalte | CC BY-SA 4.0 |
| Zeitungen, Magazine, Podcasts | Rechte bei den Verlagen |
| Mediathek: Sendungsdaten von MediathekViewWeb, Filme, Untertitel und Vorschaubilder der Sender, Liste der Live-Streams aus Zapp | Programm MediathekView GPL-3.0 (nicht enthalten), Sendungen: Rechte bei den Sendern, Zapp MIT; Downloads nur für den privaten Gebrauch |
| freie Bücher aus Project Gutenberg, Standard Ebooks, Wikisource, Internet Archive, OAPEN/DOAB, LibriVox, arXiv, Open Library | je nach Quelle frei oder gemeinfrei |
| Buchcover und Metadaten aus dem Internet (Buchkataloge und Bildersuche, siehe unten) | Cover: Rechte bei Verlagen und Gestaltern, nur im lokalen Cover-Cache |
| Kartenkacheln von OpenStreetMap (`tile.openstreetmap.org`), nur solange die Weltkarte offen ist | Daten © OpenStreetMap-Mitwirkende, ODbL 1.0; Gestaltung der Kacheln CC BY-SA 2.0; der Vermerk steht in der Karte |
| Google Maps und Street View | Nutzungsbedingungen von Google |

Die Sprachmodelle werden nicht mitgeliefert. Sie werden bei Bedarf einmalig von Hugging Face geladen und lokal
abgelegt.

## Dienste, die Cozy Shelves fragt

An diese Dienste gehen nur Suchbegriffe (Titel, Autor, ISBN oder ASIN eines Buchs, der Name eines Orts) oder die
Adresse dessen, was geladen wird. Was sie liefern, gehört nicht zum Programm.

| Dienst | wofür | Lizenz oder Bedingungen |
|---|---|---|
| Kachelserver von OpenStreetMap (OpenStreetMap Foundation) | Weltkarte: nur die Kacheln des sichtbaren Ausschnitts, angefragt als „Cozy Shelves“ (Nutzungsrichtlinie der Kachelserver) | Daten ODbL 1.0, Gestaltung CC BY-SA 2.0, © OpenStreetMap-Mitwirkende |
| Open-Meteo (Wetter und Ortssuche) | Wetter „Wie draußen“ | Daten CC BY 4.0 (Open-Meteo.com), frei für nicht kommerzielle Nutzung |
| Open Library | Cover, Metadaten, Einsortieren neuer Bücher | Bedingungen von Open Library; Cover: Rechte bei Verlagen und Gestaltern |
| Goodreads | Cover, Reihen | Nutzungsbedingungen von Goodreads; Cover: Rechte bei Verlagen und Gestaltern |
| Apple Books (iTunes Search API) | Cover | Bedingungen von Apple; Cover: Rechte bei Verlagen und Gestaltern |
| Deutsche Nationalbibliothek (Katalog, Coverdienst) | Metadaten, Cover | Katalogdaten CC0 1.0; Cover: Rechte bei den Verlagen |
| Internet Archive (Buchkatalog, eingescannte Cover) | Cover, Metadaten | je Eintrag angegeben |
| Google Books API (Cover nur mit eigenem Schlüssel; ISBN-Abfrage beim automatischen Einsortieren) | Cover, Metadaten | Nutzungsbedingungen der Google APIs |
| Bilder von Amazon nach ISBN oder ASIN | Cover | Rechte bei Verlagen und Amazon |
| Bildersuche von Bing, Yandex und DuckDuckGo (strenger Jugendschutzfilter; Bilder aus dem Bildspeicher der Suchmaschine oder über den Bildproxy von DuckDuckGo) | Cover, die kein Katalog kennt | Bedingungen der Suchmaschinen; Bilder: Rechte bei ihren Urhebern |
| DW, NHK WORLD-JAPAN, arte auf Englisch (über MediathekViewWeb), FRANCE 24 English und Al Jazeera English (Live-Streams über die Adressen, die die Sender veröffentlichen) | Filme und Live-TV auf Englisch | Rechte bei den Sendern; Downloads nur für den privaten Gebrauch |
| NASA Image and Video Library | Filme | NASA-Aufnahmen sind in den USA in der Regel urheberrechtsfrei (Richtlinien der NASA) |
| Internet Archive (Moving Image Archive) | Filme | gemeinfrei: die Prelinger Archives nach den Bedingungen der Sammlung, aus den übrigen Sammlungen nur als gemeinfrei markierte Filme |
| TED-Vorträge (Video-Podcasts von TED) | Vorträge | CC BY-NC-ND 4.0 |

## Quellcode

Den vollständigen Quellcode mit allen Bauskripten enthält das Repository des Projekts. Zu jeder Veröffentlichung gibt
es neben dem Windows-Paket das Quellcode-Archiv genau dieser Version. Wer Cozy Shelves weitergibt, muss die Bedingungen
der AGPL einhalten und den Quellcode mitgeben oder zugänglich machen. Die Quellen von eSpeak NG und piper-phonemize
nennt `app/vendor/espeak-ng/README.txt`.
