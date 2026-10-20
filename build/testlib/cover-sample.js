// The sample of books for the covers and metadata from the book catalogues (electron/library/test-cover-sources.js, the
// synthetic answers of electron/library/fixtures/make-fixtures.js and the online measurement of
// build/testlib/record-cover-sources.js): public-domain classics in German and English and invented titles, with the
// hard cases of the matching (a title cut off in its file name, subtitles, volumes, series, a different spelling of the
// author, summaries and lesser editions in the catalogues, only an ISBN, a note of a download site, made-up titles).
// `expect`: what the answers of make-fixtures.js must give (cover: the catalogue whose picture becomes the cover, and a
// piece of its address; null: better no cover than a wrong one). `web`: the same for the image search engines that are
// asked about the book in make-fixtures.js (the site of the picture each one gives, null for none).
module.exports = [
  // English
  // without an author an image search needs two sites with one picture
  { book: { title: "The Beekeeper's First Workbook Practical Exercises and", author: '', language: 'en', format: 'pdf', pageCount: 300 }, expect: { cover: 'amazon', image: '391147741', author: /Holloway/ },
    web: { bing: null, yandex: null, duckduckgo: null } },
  { book: { title: 'Frankenstein: or, The Modern Prometheus', author: 'Mary Shelley', language: 'en' }, expect: { cover: 'openlibrary', image: '/b/id/7100101-L' }, web: { bing: 'lantern-books.example' } },
  { book: { title: 'Pride and Prejudice', author: 'Jane Austen', language: 'en' }, expect: { cover: 'apple', yearMin: 2010 }, web: { yandex: 'buchladen-vier.example' } },
  { book: { title: 'Great Expectations, Annotated Edition', author: 'Charles Dickens', language: 'en' }, expect: { cover: 'openlibrary' } },
  { book: { title: 'Walden Life in the Woods', author: 'Henry David Thoreau', language: 'en' }, expect: { cover: 'amazon' } },
  { book: { title: 'Persuasion', author: 'Jane Austen', language: 'en' }, expect: { cover: 'amazon' } },
  { book: { title: 'The Time Machine_ An Invention', author: 'H. G. Wells', language: 'en' }, expect: { cover: 'openlibrary' } },
  { book: { title: 'Through the Looking-Glass, and What Alice Found There', author: 'Lewis Carroll', language: 'en' }, expect: { cover: 'amazon' } },
  { book: { title: 'The Sign of the Four (Sherlock Holmes, Book 2)', author: 'Arthur Conan Doyle', language: 'en' }, expect: { cover: 'goodreads', series: /Sherlock Holmes/, seriesIndex: 2 } },
  { book: { title: 'The Voyage of the Beagle', author: 'Charles Darwin', language: 'en' }, expect: { cover: 'amazon' } },
  { book: { title: 'The Call of the Wild', author: 'Jack London', language: 'en' }, expect: { cover: 'openlibrary' } },
  // a 3D picture of the book on white at the first catalogue: two more are asked, the flat cover of the second wins
  { book: { title: 'Moby-Dick', author: 'Herman Melville', language: 'en' }, expect: { cover: 'goodreads' } },
  { book: { title: 'Microsoft Word - manuscript_final', author: 'Microsoft Office User', isbn: '9783950590166', language: 'en' }, expect: { cover: 'amazon', author: /Darwin/ } },
  { book: { title: 'Quantum Gardening for Retired Lighthouse Keepers', author: 'Mabel Thornquist', language: 'en' }, expect: { cover: null }, web: { yandex: null } },
  // German
  { book: { title: 'Die Leiden des jungen Werthers', author: 'Goethe, Johann Wolfgang von', language: 'de' }, expect: { cover: 'dnb', image: '9783995713742' }, web: { bing: 'buchhandlung-eins.example' } },
  { book: { title: 'Maler Nolten', author: 'Eduard Mörike', language: 'de' }, expect: { cover: 'dnb' }, web: { bing: 'verlag-zwei.example' } },
  // school editions and prints on demand come last
  { book: { title: 'Der Schimmelreiter', author: 'Theodor Storm', language: 'de' }, expect: { cover: 'dnb', publisherNot: /books on demand|klett/i } },
  { book: { title: 'Michael Kohlhaas', author: 'Heinrich von Kleist', language: 'de' }, expect: { cover: 'dnb' }, web: { bing: 'buchladen-drei.example' } },
  { book: { title: 'Lotta Haldenbruck und die Glocke von Nebelstein', author: 'Ilse Brandhuber', language: 'de' }, expect: { cover: 'dnb', series: /Lotta.Haldenbruck/, seriesIndex: 3 } },
  { book: { title: 'Die Gezeiten von Morland Band 2 Die stille Bucht', author: 'Konrad Wieseneck', language: 'de' }, expect: { cover: 'openlibrary' } },
  // the DNB has no picture of its editions: Amazon's picture of the first one
  { book: { title: 'Der grüne Heinrich', author: 'Gottfried Keller', language: 'de' }, expect: { cover: 'amazon', image: '3945330343' } },
  { book: { title: 'Das Fräulein von Scuderi', author: 'E. T. A. Hoffmann', language: 'de' }, expect: { cover: 'dnb' } },
  { book: { title: 'Woyzeck', author: 'Georg Büchner', language: 'de' }, expect: { cover: 'dnb', publisher: /Lindenhof/, isbn: null }, web: { yandex: 'buchladen-vier.example' } },
  { book: { title: 'Effi Briest', author: 'Theodor Fontane', language: 'de' }, expect: { publisherNot: /klett/i } },
  { book: { title: 'Immensee', author: 'Theodor Storm', language: 'de' }, expect: { publisherNot: /klett/i }, web: { duckduckgo: 'buchladen-drei.example' } },
  // most shops write "Prozeß" (a portfolio site shows a designer's poster for it)
  { book: { title: 'Der Proceß', author: 'Franz Kafka', language: 'de' }, expect: { publisherNot: /books on demand/i, yearMin: 1925 }, web: { bing: 'verlag-zwei.example' } },
  { book: { title: 'Faust. Der Tragödie erster Teil', author: 'Johann Wolfgang von Goethe', language: 'de' }, expect: { publisherNot: /klett/i } },
  { book: { title: 'Der Hofmeister', author: 'Jakob Michael Reinhold Lenz', language: 'de' }, expect: { cover: 'dnb' } },
  { book: { title: 'Gespräche mit Goethe in den letzten Jahren seines', author: 'Johann Peter Eckermann', language: 'de' }, expect: { cover: 'dnb' } },
  // summaries of the book show another picture on two sites
  { book: { title: 'Peter Schlemihls wundersame Geschichte', author: 'Adelbert von Chamisso', language: 'de' }, expect: { cover: 'dnb' }, web: { bing: 'buchladen-drei.example' } },
  { book: { title: 'Kabale und Liebe. Ein bürgerliches Trauerspiel', author: 'Friedrich Schiller', language: 'de' }, expect: { cover: 'dnb' } },
  { book: { title: 'Der arme Spielmann', author: 'Franz Grillparzer', isbn: '9783997985857', language: 'de' }, expect: { cover: 'amazon', image: '3997985855' } },
  // a note of a download site in the file name
  { book: { title: 'Die Gezeiten von Morland 3. Brennende Flut (example.org)', author: 'Konrad Wieseneck', language: 'de' }, expect: { cover: 'dnb', series: /Morland/, seriesIndex: 3 } },
  { book: { title: 'Die vergessene Kartografie der Nebelinseln', author: 'Hartmut Quellbrunn', language: 'de' }, expect: { cover: null }, web: { bing: null } },
  { book: { title: 'Strategie', author: '', language: 'de' }, expect: { cover: null } },
  // a plain title without an author: two catalogues show the same picture
  { book: { title: 'Gartenbau', author: '', language: 'de' }, expect: { cover: 'goodreads' } },
];
