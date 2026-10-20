# Third-party notices

Cozy Shelves is free software, licensed under the **GNU Affero General Public License, version 3 or (at your option) any later
version** (AGPL-3.0-or-later). The full text is in [LICENSE](LICENSE). Copyright © Cozy Shelves contributors.

Cozy Shelves ships components of other projects. Each keeps its own license. Three of them are under the GPL:
chessground (GPL-3.0-or-later), Stockfish (GPL-3.0) and eSpeak NG (GPL-3.0-or-later). Cozy Shelves as a
whole is distributed under the AGPL, as section 13 of the GPL-3.0 permits. Everything else listed here is under a license that is compatible with it.

The texts of all these licenses, with the copyright notices of each package, are collected in
`THIRD_PARTY_LICENSES.txt`. `node build/third-party.js --text <file>` writes that file from the installed packages;
`npm run dist:win` puts it into the Windows package next to `CozyShelves.exe`. `node build/third-party.js --md` prints the
table at the end of this document.

## Components of the program

| Component | Version | License | Used for | Source |
|---|---|---|---|---|
| Electron (with Chromium and Node.js) | 44.3.0 | MIT; Chromium's components: see `LICENSES.chromium.html` in the program folder | desktop runtime | <https://github.com/electron/electron> |
| AndroidX webkit, activity, core (the Android app only, `android/`) | 1.12.1, 1.9.3, 1.15.0 | Apache-2.0 | the WebView shell of the Android app: asset loader, back dispatcher, window insets | <https://github.com/androidx/androidx> |
| Kotlin standard library, Android Gradle Plugin (the Android app only) | 2.1.0, 8.7.3 | Apache-2.0 | the language of the shell, the build | <https://github.com/JetBrains/kotlin>, <https://developer.android.com/build> |
| three.js | r186 (0.186.0) | MIT | 3D world | <https://github.com/mrdoob/three.js> |
| Leaflet | 1.9.4 | BSD-2-Clause | the world map (shows the tiles of OpenStreetMap) | <https://github.com/Leaflet/Leaflet> |
| foliate-js | vendored in `vendor-src/foliate-js` | MIT | reader for EPUB, MOBI, AZW3, FB2, CBZ | <https://github.com/johnfactotum/foliate-js> |
| PDF.js | 5.5.207 | Apache-2.0 | PDF pages | <https://github.com/mozilla/pdf.js> |
| Adobe CMaps, Foxit fonts, Liberation Sans (part of PDF.js) | | BSD-3-Clause, BSD-3-Clause, OFL-1.1 | PDF text encodings and standard fonts | <https://github.com/mozilla/pdf.js> |
| fflate, zip.js (part of foliate-js) | | MIT, BSD-3-Clause | compressed e-books | <https://github.com/101arrowz/fflate>, <https://github.com/gildas-lormeau/zip.js> |
| chessground | 9.2.1 | GPL-3.0-or-later | 2D chessboard | <https://github.com/lichess-org/chessground> |
| cburnett chess pieces (part of chessground) | | GPL-2.0-or-later, by Colin M.L. Burnett | chess pieces | <https://github.com/lichess-org/lila/blob/master/COPYING.md> |
| chess.js | 1.4.0 | BSD-2-Clause | chess rules | <https://github.com/jhlywa/chess.js> |
| Stockfish 18 (stockfish.js) | 18.0.8 | GPL-3.0 | chess engine | <https://github.com/nmrugg/stockfish.js>, <https://stockfishchess.org> |
| kokoro-js with Transformers.js and phonemizer | 1.2.1 | Apache-2.0 | English read-aloud | <https://github.com/hexgrad/kokoro> |
| eSpeak NG (in phonemizer and in piper-wasm) | | GPL-3.0-or-later | phonemes for the voices | <https://github.com/espeak-ng/espeak-ng>, <https://github.com/rhasspy/espeak-ng> |
| @diffusionstudio/piper-wasm (piper-phonemize as WebAssembly) | 1.0.0 | MIT (eSpeak NG inside: GPL-3.0-or-later) | German read-aloud | <https://github.com/diffusion-studio/piper-wasm> |
| onnxruntime-web | 1.22.0-dev and 1.30.0 | MIT | voice models on the processor and the graphics card | <https://github.com/microsoft/onnxruntime> |
| Kokoro voice style vectors (from kokoro-js) | | Apache-2.0 | English voices | <https://huggingface.co/hexgrad/Kokoro-82M> |
| hls.js (with the libraries it bundles) | 1.7.3 | Apache-2.0 | streams of the Mediathek | <https://github.com/video-dev/hls.js> |
| hyphen with TeX hyphenation patterns (hyph-utf8: German 1996, English US) | 1.14.1 | ISC; patterns under their own free licenses | hyphenation in the reading browser and in the text view of PDFs | <https://github.com/ytiurin/hyphen>, <https://ctan.org/pkg/hyph-utf8> |
| @mozilla/readability | 0.6.0 | Apache-2.0 | full articles, reading mode | <https://github.com/mozilla/readability> |
| jsdom, rss-parser, chokidar, marked, mammoth, jszip and their dependencies | see the table below | MIT, BSD, ISC, Apache-2.0, BlueOak-1.0.0, CC0-1.0, MIT-0 | feeds, folder watching, Markdown, DOCX | see the table below |
| EB Garamond, Cormorant Garamond, Caveat, VT323, Playfair Display (Fontsource) | 5.3.0 | OFL-1.1 | typography | <https://fontsource.org> |
| Literata (TypeTogether for Google), Source Serif 4 (Adobe), Atkinson Hyperlegible Next (Braille Institute) | Fontsource 5.3.0, kept in `app/data/fonts` with their `OFL.txt` | OFL-1.1 | reading fonts of the reader | <https://github.com/googlefonts/literata>, <https://github.com/adobe-fonts/source-serif>, <https://github.com/googlefonts/atkinson-hyperlegible-next> |
| SQLite with FTS5 (through `node:sqlite` of the Node.js inside Electron) | as built into Electron 44 | public domain | index of the full-text search | <https://sqlite.org> |
| Chess diagram recognition network (`app/src/ui/chess/diagram/net-weights.js`, 102 KB, int8) | | AGPL-3.0-or-later, like Cozy Shelves (own work) | recognises the pieces in chess diagrams; trained with `build/chess-net` on generated diagrams drawn with the cburnett pieces, DejaVu Sans, the chess symbols of the Windows fonts and invented piece sets; contains no font data | this repository |
| Twemoji Country Flags | | flag graphics CC BY 4.0 (Twemoji, © Twitter, Inc. and contributors); font Apache-2.0 (Mozilla), subset MIT (TalkJS) | flags on the world map | <https://github.com/talkjs/country-flag-emoji-polyfill> |
| Natural Earth | 5.1 | public domain | the world map's atlas (countries, lakes, rivers, places) and its profiles | <https://www.naturalearthdata.com> |
| Wikidata | queried 2026 | CC0-1.0 | languages, currencies, areas, city populations | <https://www.wikidata.org> |

The music, all sounds, the textures, the watercolour paintings and the graffiti are generated by the program itself;
no recordings or pictures of others are included. The watercolour simulation follows Curtis, Anderson, Seims,
Fleischer and Salesin, "Computer-Generated Watercolor" (SIGGRAPH 1997).

## Downloaded when you use them (not shipped)

| What | License | Notes |
|---|---|---|
| Kokoro-82M (hexgrad), English voice | Apache-2.0 | <https://huggingface.co/hexgrad/Kokoro-82M> |
| "Martin", German voice (Kokoro-82M-ONNX-German-Martin by Godelaune; kikiri-tts, dida-80b; voice of Martin Harbecke) | Apache-2.0 | <https://huggingface.co/Godelaune/Kokoro-82M-ONNX-German-Martin> |
| Piper voices "Thorsten" (low, medium, high) and "Thorsten emotional" | CC0 (Thorsten-Voice dataset) | <https://huggingface.co/rhasspy/piper-voices> |
| Piper voice "Kerstin" | CC0 (dataset) | as above |
| Piper voices "Karlsson", "Ramona", "Eva K" | the license of the M-AILABS Speech Dataset | as above; see the model card of each voice |
| Piper voice "Pavoque" | CC BY-NC-SA 4.0 (dataset): non-commercial use only | as above |
| Optional Python sidecar (`tts-server`): chatterbox-tts (Resemble AI), Kartoffelbox (SebastianBodza) | MIT / CC-BY-4.0 | installed only on request |
| Wikipedia and Wiktionary content | CC BY-SA 4.0 | encyclopedia, dictionary |
| Newspapers, magazines, podcasts | rights of the publishers | fetched from their feeds |
| Mediathek: programme data from MediathekViewWeb, films, subtitles and thumbnails of the broadcasters, live stream list of Zapp | MediathekView: GPL-3.0 (program, not included); broadcasts: rights of the broadcasters; Zapp: MIT | downloads for private use only |
| Free books from Project Gutenberg, Standard Ebooks, Wikisource, Internet Archive, OAPEN/DOAB, LibriVox, arXiv, Open Library | as stated by each source | online catalogue |
| Book covers and metadata from the internet (the book catalogues and image searches listed below) | covers: rights of publishers and designers | kept only in the local cover cache |
| Map tiles of OpenStreetMap (`tile.openstreetmap.org`) | data © OpenStreetMap contributors, ODbL 1.0; cartography of the tiles CC BY-SA 2.0 | the world map, loaded while it is open; the attribution stands in the map |
| Google Maps and Street View | Google's terms of service | opened from the world map and in the reading browser |

## Online services asked at run time

Cozy Shelves sends these services only search terms (title, author, ISBN or ASIN of a book, the name of a place) or the
address of the item it fetches. Nothing they return is shipped with the program.

| Service | Used for | Terms of what comes back |
|---|---|---|
| OpenStreetMap tile servers (OpenStreetMap Foundation) | the world map: only the tiles of the area on the screen, requested as "Cozy Shelves" (tile usage policy) | data ODbL 1.0, cartography CC BY-SA 2.0, © OpenStreetMap contributors |
| Open-Meteo (weather and geocoding API) | the weather "Like outside" | data under CC BY 4.0 (Open-Meteo.com), free for non-commercial use |
| Open Library (search, covers, ISBN look-up) | covers, metadata, shelving new books | Open Library's terms; covers: rights of publishers and designers |
| Goodreads (suggestions of its search) | covers, series | Goodreads' terms of use; covers: rights of publishers and designers |
| Apple Books (iTunes Search API) | covers | Apple's terms for the iTunes Search API; artwork: rights of publishers and designers |
| Deutsche Nationalbibliothek (SRU catalogue, cover service by ISBN) | metadata, covers | catalogue data CC0 1.0; covers: rights of publishers |
| Internet Archive (book catalogue, scanned covers of copies) | covers, metadata | as stated for each item |
| Google Books API (covers only with the reader's own key; the ISBN look-up of the automatic shelving) | covers, metadata | Google APIs terms of service |
| Amazon product pictures by ISBN or ASIN | covers | rights of publishers and Amazon |
| Bing, Yandex and DuckDuckGo image search (strict safe search; pictures from the engines' caches or through DuckDuckGo's image proxy) | covers the catalogues do not know | the engines' terms; pictures: rights of their owners |
| DW, NHK WORLD-JAPAN, arte in English (through MediathekViewWeb), FRANCE 24 English and Al Jazeera English (live streams at the addresses the broadcasters publish) | films and live TV in English | rights of the broadcasters; downloads for private use only |
| NASA Image and Video Library | films | NASA media are generally not subject to copyright in the United States (NASA media usage guidelines) |
| Internet Archive (Moving Image Archive) | films | public domain: the Prelinger Archives by the collection's terms, other collections only items marked as public domain |
| TED Talks (TED's video podcast feeds) | talks | CC BY-NC-ND 4.0 |

## Source code

Cozy Shelves' complete source code, including the build scripts, is in its repository. Every release offers the
source archive of exactly that version next to the Windows package. `vendor-src/` holds the source of foliate-js
as it is used; the other components come from the npm registry in the versions of `package-lock.json`.

## Every npm package in the program

Bundled into `app/dist`, copied into `app/vendor` by `build/vendor.js`, or installed for the main process by
`build/package-win.js`. Generated with `node build/third-party.js --md` (after `npm run build`).

| Package | Version | License | Where | Source |
|---|---|---|---|---|
| @asamuzakjp/css-color | 6.0.7 | MIT | main process (installed into the package) | <https://github.com/asamuzaK/cssColor> |
| @asamuzakjp/dom-selector | 8.3.2 | MIT | main process (installed into the package) | <https://github.com/asamuzaK/domSelector> |
| @bramus/specificity | 2.4.2 | MIT | main process (installed into the package) | <https://github.com/bramus/specificity> |
| @csstools/color-helpers | 6.1.1 | MIT-0 | main process (installed into the package) | <https://github.com/csstools/postcss-plugins> |
| @csstools/css-calc | 3.4.0 | MIT | main process (installed into the package) | <https://github.com/csstools/postcss-plugins> |
| @csstools/css-color-parser | 4.2.3 | MIT | main process (installed into the package) | <https://github.com/csstools/postcss-plugins> |
| @csstools/css-parser-algorithms | 4.0.0 | MIT | main process (installed into the package) | <https://github.com/csstools/postcss-plugins> |
| @csstools/css-syntax-patches-for-csstree | 1.1.14 | MIT-0 | main process (installed into the package) | <https://github.com/csstools/postcss-plugins> |
| @csstools/css-tokenizer | 4.0.0 | MIT | main process (installed into the package) | <https://github.com/csstools/postcss-plugins> |
| @diffusionstudio/piper-wasm | 1.0.0 | MIT | app/vendor: piper-phonemize with eSpeak NG as WebAssembly and the German eSpeak NG data (GPL-3.0-or-later) | <https://github.com/diffusion-studio/piper-wasm> |
| @exodus/bytes | 1.15.1 | MIT | main process (installed into the package) | <https://github.com/ExodusOSS/bytes> |
| @fontsource/caveat | 5.3.0 | OFL-1.1 | app/vendor: font files | <https://github.com/fontsource/font-files> |
| @fontsource/cormorant-garamond | 5.3.0 | OFL-1.1 | app/vendor: font files | <https://github.com/fontsource/font-files> |
| @fontsource/eb-garamond | 5.3.0 | OFL-1.1 | app/vendor: font files | <https://github.com/fontsource/font-files> |
| @fontsource/playfair-display | 5.3.0 | OFL-1.1 | app/vendor: font files | <https://github.com/fontsource/font-files> |
| @fontsource/vt323 | 5.3.0 | OFL-1.1 | app/vendor: font files | <https://github.com/fontsource/font-files> |
| @mozilla/readability | 0.6.0 | Apache-2.0 | bundled into app/dist; main process (installed into the package) | <https://github.com/mozilla/readability> |
| @xmldom/xmldom | 0.8.15 | MIT | main process (installed into the package) | <https://github.com/xmldom/xmldom> |
| argparse | 1.0.10 | MIT | main process (installed into the package) | <https://github.com/nodeca/argparse> |
| base64-js | 1.5.1 | MIT | main process (installed into the package) | <https://github.com/beatgammit/base64-js> |
| bidi-js | 1.1.0 | MIT | main process (installed into the package) | <https://github.com/lojjic/bidi-js> |
| bluebird | 3.4.7 | MIT | main process (installed into the package) | <https://github.com/petkaantonov/bluebird> |
| chess.js | 1.4.0 | BSD-2-Clause | bundled into app/dist | <https://github.com/jhlywa/chess.js> |
| chessground | 9.2.1 | GPL-3.0-or-later | bundled into app/dist; app/vendor: board styles and the cburnett chess pieces (Colin M.L. Burnett, GPL-2.0-or-later) | <https://github.com/lichess-org/chessground> |
| chokidar | 5.0.0 | MIT | main process (installed into the package) | <https://github.com/paulmillr/chokidar> |
| core-util-is | 1.0.3 | MIT | main process (installed into the package) | <https://github.com/isaacs/core-util-is> |
| css-tree | 3.2.1 | MIT | main process (installed into the package) | <https://github.com/csstree/csstree> |
| data-urls | 7.0.0 | MIT | main process (installed into the package) | <https://github.com/jsdom/data-urls> |
| decimal.js | 10.6.0 | MIT | main process (installed into the package) | <https://github.com/MikeMcl/decimal.js> |
| dingbat-to-unicode | 1.0.1 | BSD-2-Clause | main process (installed into the package) | <https://github.com/mwilliamson/dingbat-to-unicode> |
| duck | 0.1.12 | BSD | main process (installed into the package) | <https://github.com/mwilliamson/duck.js> |
| entities | 2.2.0 | BSD-2-Clause | main process (installed into the package) | <https://github.com/fb55/entities> |
| entities | 8.1.0 | BSD-2-Clause | main process (installed into the package) | <https://github.com/fb55/entities> |
| hls.js | 1.7.3 | Apache-2.0 | bundled into app/dist | <https://github.com/video-dev/hls.js> |
| html-encoding-sniffer | 6.0.0 | MIT | main process (installed into the package) | <https://github.com/jsdom/html-encoding-sniffer> |
| hyphen | 1.14.1 | ISC | bundled into app/dist | <https://github.com/ytiurin/hyphen> |
| immediate | 3.0.6 | MIT | main process (installed into the package) | <https://github.com/calvinmetcalf/immediate> |
| inherits | 2.0.4 | ISC | main process (installed into the package) | <https://github.com/isaacs/inherits> |
| is-potential-custom-element-name | 1.0.1 | MIT | main process (installed into the package) | <https://github.com/mathiasbynens/is-potential-custom-element-name> |
| isarray | 1.0.0 | MIT | main process (installed into the package) | <https://github.com/juliangruber/isarray> |
| jsdom | 30.0.1 | MIT | main process (installed into the package) | <https://github.com/jsdom/jsdom> |
| jszip | 3.10.2 | (MIT OR GPL-3.0-or-later) | main process (installed into the package) | <https://github.com/Stuk/jszip> |
| kokoro-js | 1.2.1 | Apache-2.0 | bundled into app/dist; app/vendor: kokoro.web.js (with Transformers.js, phonemizer and eSpeak NG data) and the voice style vectors | <https://github.com/hexgrad/kokoro> |
| leaflet | 1.9.4 | BSD-2-Clause | bundled into app/dist; app/vendor: its stylesheet (the world map) | <https://github.com/Leaflet/Leaflet> |
| lie | 3.3.0 | MIT | main process (installed into the package) | <https://github.com/calvinmetcalf/lie> |
| lop | 0.4.2 | BSD-2-Clause | main process (installed into the package) | <https://github.com/mwilliamson/lop> |
| lru-cache | 11.5.2 | BlueOak-1.0.0 | main process (installed into the package) | <https://github.com/isaacs/node-lru-cache> |
| mammoth | 1.12.3 | BSD-2-Clause | main process (installed into the package) | <https://github.com/mwilliamson/mammoth.js> |
| marked | 16.4.2 | MIT | main process (installed into the package) | <https://github.com/markedjs/marked> |
| mdn-data | 2.27.1 | CC0-1.0 | main process (installed into the package) | <https://github.com/mdn/data> |
| onnxruntime-common | 1.21.0 | MIT | bundled into app/dist | <https://github.com/Microsoft/onnxruntime> |
| onnxruntime-web | 1.22.0-dev.20250409-89f8206ba4 | MIT | bundled into app/dist; app/vendor: WebAssembly runtime | <https://github.com/Microsoft/onnxruntime> |
| onnxruntime-web | 1.30.0 | MIT | bundled into app/dist; app/vendor: WebAssembly runtime (WebGPU build) | <https://github.com/Microsoft/onnxruntime> |
| option | 0.2.4 | BSD-2-Clause | main process (installed into the package) | <https://github.com/mwilliamson/node-options> |
| pako | 1.0.11 | (MIT AND Zlib) | main process (installed into the package) | <https://github.com/nodeca/pako> |
| parse5 | 8.0.1 | MIT | main process (installed into the package) | <https://github.com/inikulin/parse5> |
| path-is-absolute | 1.0.1 | MIT | main process (installed into the package) | <https://github.com/sindresorhus/path-is-absolute> |
| phonemizer | 1.2.1 | Apache-2.0 | bundled into app/dist | <https://github.com/xenova/phonemizer.js> |
| process-nextick-args | 2.0.1 | MIT | main process (installed into the package) | <https://github.com/calvinmetcalf/process-nextick-args> |
| punycode | 2.3.1 | MIT | main process (installed into the package) | <https://github.com/mathiasbynens/punycode.js> |
| readable-stream | 2.3.8 | MIT | main process (installed into the package) | <https://github.com/nodejs/readable-stream> |
| readdirp | 5.1.1 | MIT | main process (installed into the package) | <https://github.com/paulmillr/readdirp> |
| require-from-string | 2.0.2 | MIT | main process (installed into the package) | <https://github.com/floatdrop/require-from-string> |
| rss-parser | 3.13.0 | MIT | main process (installed into the package) | <https://github.com/bobby-brennan/rss-parser> |
| safe-buffer | 5.1.2 | MIT | main process (installed into the package) | <https://github.com/feross/safe-buffer> |
| sax | 1.6.1 | BlueOak-1.0.0 | main process (installed into the package) | <https://github.com/isaacs/sax-js> |
| saxes | 6.0.0 | ISC | main process (installed into the package) | <https://github.com/lddubeau/saxes> |
| setimmediate | 1.0.5 | MIT | main process (installed into the package) | <https://github.com/YuzuJS/setImmediate> |
| source-map-js | 1.2.1 | BSD-3-Clause | main process (installed into the package) | <https://github.com/7rulnik/source-map-js> |
| sprintf-js | 1.0.3 | BSD-3-Clause | main process (installed into the package) | <https://github.com/alexei/sprintf.js> |
| stockfish | 18.0.8 | GPL-3.0 | app/vendor: Stockfish 18 lite, single-threaded (JavaScript and WebAssembly) | <https://github.com/nmrugg/stockfish.js> |
| string_decoder | 1.1.1 | MIT | main process (installed into the package) | <https://github.com/nodejs/string_decoder> |
| symbol-tree | 3.2.4 | MIT | main process (installed into the package) | <https://github.com/jsdom/js-symbol-tree> |
| three | 0.186.0 | MIT | bundled into app/dist | <https://github.com/mrdoob/three.js> |
| tldts | 7.4.13 | MIT | main process (installed into the package) | <https://github.com/remusao/tldts> |
| tldts-core | 7.4.13 | MIT | main process (installed into the package) | <https://github.com/remusao/tldts> |
| tough-cookie | 6.0.2 | BSD-3-Clause | main process (installed into the package) | <https://github.com/salesforce/tough-cookie> |
| tr46 | 6.0.0 | MIT | main process (installed into the package) | <https://github.com/jsdom/tr46> |
| underscore | 1.13.8 | MIT | main process (installed into the package) | <https://github.com/jashkenas/underscore> |
| undici | 8.10.2 | MIT | main process (installed into the package) | <https://github.com/nodejs/undici> |
| util-deprecate | 1.0.2 | MIT | main process (installed into the package) | <https://github.com/TooTallNate/util-deprecate> |
| w3c-xmlserializer | 5.0.0 | MIT | main process (installed into the package) | <https://github.com/jsdom/w3c-xmlserializer> |
| webidl-conversions | 8.0.1 | BSD-2-Clause | main process (installed into the package) | <https://github.com/jsdom/webidl-conversions> |
| whatwg-mimetype | 5.0.0 | MIT | main process (installed into the package) | <https://github.com/jsdom/whatwg-mimetype> |
| whatwg-url | 16.0.1 | MIT | main process (installed into the package) | <https://github.com/jsdom/whatwg-url> |
| whatwg-url | 17.1.1 | MIT | main process (installed into the package) | <https://github.com/jsdom/whatwg-url> |
| xml-name-validator | 5.0.0 | Apache-2.0 | main process (installed into the package) | <https://github.com/jsdom/xml-name-validator> |
| xml2js | 0.5.0 | MIT | main process (installed into the package) | <https://github.com/Leonidas-from-XIV/node-xml2js> |
| xmlbuilder | 10.1.1 | MIT | main process (installed into the package) | <https://github.com/oozcitak/xmlbuilder-js> |
| xmlbuilder | 11.0.1 | MIT | main process (installed into the package) | <https://github.com/oozcitak/xmlbuilder-js> |
| xmlchars | 2.2.0 | MIT | main process (installed into the package) | <https://github.com/lddubeau/xmlchars> |
