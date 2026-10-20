// Tests for the shelves (0.7): the language field, finished books, the reading goal and the streak (time zones,
// midnight, daylight saving), duplicate books (true positives, and none for volumes of a series or editions of other
// years), series numbers in titles, the sort orders inside a shelf and the hooks in library.js.
// Plain Node – no Electron, no network.  Run:  node electron/library/test-shelves.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { normalizeLanguage } = require('./language');
const RL = require('./reading-log');
const { titleKey, authorParts, sameAuthor, isbnKey, findDuplicates, preferredCopy } = require('./duplicates');
const { parseSeries, seriesOf, sortIds, authorSortKey, publisherKey, SORT_MODES } = require('./shelf-order');
const { Library } = require('./library');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); }
}
/** Runs fn with the process in another time zone (Node re-reads TZ when it is set). */
function inZone(tz, fn) {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
}
const DAY = 86400000;

(async () => {
  console.log('language');
  await test('language values become two-letter codes or null', () => {
    const cases = [
      ['de', 'de'], ['DE-DE', 'de'], ['de_AT', 'de'], ['en-US', 'en'], ['EN', 'en'], ['eng', 'en'], ['ger', 'de'], ['deu', 'de'],
      ['German', 'de'], ['Deutsch', 'de'], ['english', 'en'], ['Englisch', 'en'], ['fre', 'fr'], ['fra', 'fr'], ['Français', 'fr'],
      ['zh-Hans-CN', 'zh'], ['de, en', 'de'], ['ger; eng', 'de'], ['de_DE.UTF-8', 'de'], ['iw', 'he'], [' nl ', 'nl'],
      // cut off by the indexer (it keeps five characters): only one language starts like that
      ['Germa', 'de'], ['Engli', 'en'], ['Franç', 'fr'], ['Deuts', 'de'],
      // no language at all
      ['<¦', null], ['ƒ*ªþ×', null], ['to˚‹j', null], ['und', null], ['mul', null], ['xx', null], ['x-default', null], ['', null],
      [null, null], [undefined, null], ['123', null], ['abc', null], ['Ger', 'de'], ['qq-QQ', null], ['Lorem', null],
    ];
    for (const [v, want] of cases) assert.strictEqual(normalizeLanguage(v), want, JSON.stringify(v));
  });

  console.log('finished books');
  await test('a book is read from 97 % on, or when it is marked by hand', () => {
    assert.strictEqual(RL.isFinished({ progress: 0.969 }), false);
    assert.strictEqual(RL.isFinished({ progress: 0.97 }), true);
    assert.strictEqual(RL.isFinished({ progress: 0.2, finishedAt: 5 }), true, 'marked by hand');
    assert.strictEqual(RL.isFinished({ progress: 1, readMark: false }), false, 'marked as unread wins');
    assert.strictEqual(RL.isFinished(null), false);
  });
  await test('reaching 97 % finishes a book once; going back to the start keeps it read', () => {
    const b = { progress: 0.5 };
    b.progress = 0.98;
    assert.strictEqual(RL.noteProgress(b, 0.5, 1000), true);
    assert.strictEqual(b.finishedAt, 1000);
    b.progress = 0.99;
    assert.strictEqual(RL.noteProgress(b, 0.98, 2000), false, 'no second crossing');
    assert.strictEqual(b.finishedAt, 1000, 'the day it was finished stays');
    b.progress = 0.05;
    assert.strictEqual(RL.noteProgress(b, 0.99, 3000), false);
    assert.strictEqual(RL.isFinished(b), true, 're-reading from the start does not unread it');
  });
  await test('"Als gelesen markieren" and "Als ungelesen markieren"', () => {
    const b = { progress: 0 };
    assert.strictEqual(RL.setReadMark(b, true, 100), true);
    assert.strictEqual(RL.isFinished(b), true);
    assert.strictEqual(RL.setReadMark(b, true, 200), false, 'marking twice changes nothing');
    assert.strictEqual(b.finishedAt, 100);
    assert.strictEqual(RL.setReadMark(b, false), true);
    assert.strictEqual(RL.isFinished(b), false);
    assert.strictEqual(b.readMark, undefined, 'below 97 % nothing has to be remembered');
    assert.strictEqual(b.finishedAt, undefined);
    // read to the end, then marked as unread: it stays unread until it is read to the end once more
    const c = { progress: 0.99, finishedAt: 50 };
    RL.setReadMark(c, false);
    assert.strictEqual(RL.isFinished(c), false);
    assert.strictEqual(c.readMark, false);
    c.progress = 0.995; RL.noteProgress(c, 0.99, 60);
    assert.strictEqual(RL.isFinished(c), false, 'still at the end: no new crossing');
    c.progress = 0.3; RL.noteProgress(c, 0.995, 70);
    c.progress = 0.98;
    assert.strictEqual(RL.noteProgress(c, 0.3, 80), true, 'read to the end again');
    assert.strictEqual(RL.isFinished(c), true);
    assert.strictEqual(c.readMark, undefined);
    assert.strictEqual(c.finishedAt, 80);
  });
  await test('records from before 0.7: a book read to the end gets the day it was last read', () => {
    const a = { progress: 0.99, lastRead: 777, addedAt: 5 };
    assert.strictEqual(RL.migrateFinished(a), true);
    assert.strictEqual(a.finishedAt, 777);
    assert.strictEqual(RL.migrateFinished(a), false, 'only once');
    const u = { progress: 0.99, readMark: false };
    assert.strictEqual(RL.migrateFinished(u), false, 'a book marked as unread stays unread');
    assert.strictEqual(RL.migrateFinished({ progress: 0.5 }), false);
  });

  console.log('streak and goal');
  const daysOf = (entries) => Object.fromEntries(entries.map(([d, s]) => [RL.localDay(d), { seconds: s, books: {} }]));
  await test('the streak counts local days with at least 5 minutes, today counts once it has them', () => {
    const now = new Date(2026, 9, 4, 18, 0);
    const d = (back, h = 20) => new Date(2026, 9, 4 - back, h, 0);
    assert.deepStrictEqual(RL.streakOf(daysOf([[d(0), 360], [d(1), 300], [d(2), 299], [d(3), 3600]]), now), { streak: 2, today: true, todaySeconds: 360 });
    // today not yet (2 minutes): the streak still counts from yesterday until midnight
    const s = RL.streakOf(daysOf([[d(0), 120], [d(1), 900], [d(2), 900]]), now);
    assert.strictEqual(s.streak, 2); assert.strictEqual(s.today, false);
    assert.strictEqual(RL.streakOf(daysOf([[d(2), 900]]), now).streak, 0, 'a whole day without reading ends it');
    assert.strictEqual(RL.streakOf({}, now).streak, 0);
    assert.strictEqual(RL.STREAK_SECONDS, 300);
  });
  await test('midnight: reading at 23:59 counts for that day, the streak goes on at 00:01', () => {
    const late = new Date(2026, 0, 31, 23, 59, 30);
    const days = daysOf([[late, 600], [new Date(2026, 0, 30, 12), 600]]);
    assert.strictEqual(RL.localDay(late), '2026-01-31');
    assert.strictEqual(RL.streakOf(days, new Date(2026, 1, 1, 0, 1)).streak, 2, 'just after midnight');
    assert.strictEqual(RL.streakOf(days, new Date(2026, 1, 2, 0, 1)).streak, 0, 'a day later without reading');
  });
  await test('time zones: the local day decides (Los Angeles, Auckland, Kolkata, Berlin, UTC)', () => {
    for (const tz of ['America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kolkata', 'Europe/Berlin', 'UTC']) inZone(tz, () => {
      // the same moment is a different day in different zones: the stats file records the local one
      const t = Date.UTC(2026, 0, 31, 23, 30);
      const local = new Date(t);
      assert.strictEqual(RL.localDay(t), `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`, tz);
      assert.strictEqual(RL.localDay(new Date(2026, 0, 31, 23, 59)), '2026-01-31', tz);
      assert.strictEqual(RL.localDay(new Date(2026, 1, 1, 0, 0)), '2026-02-01', tz);
      const now = new Date(2026, 2, 3, 9, 0);
      const days = daysOf([[new Date(2026, 2, 3, 0, 5), 300], [new Date(2026, 2, 2, 23, 55), 400], [new Date(2026, 2, 1, 12), 500], [new Date(2026, 1, 28, 12), 500]]);
      assert.strictEqual(RL.streakOf(days, now).streak, 4, tz + ' (over the end of February)');
      // the year of a finished book is its local year
      const books = [{ id: 'a', finishedAt: new Date(2026, 11, 31, 23, 30).getTime(), progress: 1 }, { id: 'b', finishedAt: new Date(2027, 0, 1, 0, 30).getTime(), progress: 1 }];
      assert.deepStrictEqual(RL.booksReadIn(books, 2026).ids, ['a'], tz);
      assert.deepStrictEqual(RL.booksReadIn(books, 2027).ids, ['b'], tz);
    });
  });
  await test('daylight saving: days of 23 and 25 hours are one day each', () => {
    inZone('Europe/Berlin', () => {
      // 29 March 2026: the clocks go forward, 25 October 2026: back
      const spring = daysOf([[new Date(2026, 2, 28, 22), 300], [new Date(2026, 2, 29, 1, 30), 300], [new Date(2026, 2, 30, 0, 30), 300]]);
      assert.strictEqual(RL.streakOf(spring, new Date(2026, 2, 30, 1, 30)).streak, 3);
      const autumn = daysOf([[new Date(2026, 9, 24, 23), 300], [new Date(2026, 9, 25, 2, 30), 300], [new Date(2026, 9, 26, 0, 10), 300]]);
      assert.strictEqual(RL.streakOf(autumn, new Date(2026, 9, 26, 0, 20)).streak, 3);
    });
    inZone('America/New_York', () => {
      const days = daysOf([[new Date(2026, 2, 7, 23), 600], [new Date(2026, 2, 8, 3), 600], [new Date(2026, 2, 9, 1), 600]]);
      assert.strictEqual(RL.streakOf(days, new Date(2026, 2, 9, 2)).streak, 3);
    });
  });
  await test('the books of a year: read ones only, a book that exists twice once, newest first', () => {
    const y = (m, d) => new Date(2026, m, d).getTime();
    const books = [
      { id: 'a', progress: 1, finishedAt: y(1, 1) }, { id: 'a2', progress: 1, finishedAt: y(1, 2) },   // two copies of one book
      { id: 'b', progress: 0.3, finishedAt: y(5, 1) },                                                 // marked by hand
      { id: 'c', progress: 1, finishedAt: y(6, 1), readMark: false },                                  // marked as unread
      { id: 'd', progress: 0.5 }, { id: 'e', progress: 1, finishedAt: new Date(2025, 11, 31).getTime() },
    ];
    const r = RL.booksReadIn(books, 2026, (id) => (id === 'a' || id === 'a2' ? 'g1' : null));
    assert.deepStrictEqual(r, { year: 2026, count: 2, ids: ['b', 'a2'] });
    assert.strictEqual(RL.readingGoal('20'), 20);
    assert.strictEqual(RL.readingGoal(0), 0);
    assert.strictEqual(RL.readingGoal(-3), 0);
    assert.strictEqual(RL.readingGoal('x'), 0);
    assert.strictEqual(RL.readingGoal(12.4), 12);
  });

  console.log('duplicates');
  const bk = (id, title, author, extra = {}) => ({ id, title, author, ...extra });
  const groupsOf = (books) => findDuplicates(books).groups.map((g) => g.ids.join('+') + ':' + g.reasons.join(','));
  await test('titles: file name parts, edition notes, umlauts and punctuation are set aside, numbers stay', () => {
    const same = [
      ['Maler Nolten', 'Maler Nolten (example.org)'], ['Maler Nolten', 'Maler Nolten [books.example.net]'], ['Maler Nolten', 'Maler Nolten example.org'],
      ['Die Räuber', 'Die Raeuber'], ['Die Räuber', 'Die Rauber'],
      ['Tidy Programs: A Handbook', 'Tidy Programs - A Handbook, Second Edition'], ['Faust', 'Faust (2. Auflage)'], ['Faust', 'Faust, 3., überarbeitete Auflage'],
      ['Walden', 'Walden -- Henry David Thoreau -- 1854 -- Ticknor -- 0123456789abcdef0123456789abcdef -- Example Archive'],
      ['Der Prozess', 'Prozess, Der'], ['Effi Briest', 'effi_briest'], ['Woyzeck', 'Woyzeck (German Edition)'], ['Immensee', 'Immensee - Kopie'],
    ];
    for (const [a, b] of same) assert.strictEqual(titleKey(a), titleKey(b), `${a} | ${b}`);
    const differ = [['Lotta Haldenbruck Band 1', 'Lotta Haldenbruck Band 2'], ['Krieg und Frieden, Teil I', 'Krieg und Frieden, Teil II'], ['Walden', 'Walden: Life in the Woods'], ['1848', '1849'],
      ['Reisebilder (St.Gallen)', 'Reisebilder'], ['Socket Notes in node.js', 'Socket Notes in node']];
    for (const [a, b] of differ) assert.notStrictEqual(titleKey(a), titleKey(b), `${a} | ${b}`);
  });
  await test('authors: "Surname, Given", "Given Surname" and initials are one person', () => {
    const h = authorParts('Ernst Theodor Amadeus Hoffmann');
    for (const a of ['Hoffmann, Ernst Theodor Amadeus', 'E. T. A. Hoffmann', 'Dr. Ernst Hoffmann', 'Ernst Theodor Amadeus Hoffmann (Autor)', 'Hoffmann, Ernst; Smith, John', 'Ernst Theodor Amadeus Hoffmann and John Smith']) assert(sameAuthor(h, authorParts(a)), a);
    assert(!sameAuthor(h, authorParts('Heinrich Hoffmann')), 'another first name');
    assert(!sameAuthor(h, authorParts('Theodor Fontane')));
    assert(sameAuthor(authorParts('Annette von Droste-Hülshoff'), authorParts('von Droste-Hülshoff, Annette')));
    assert(sameAuthor(authorParts('Eduard Mörike'), authorParts('Moerike, Eduard')), 'umlauts');
    assert.strictEqual(authorParts(''), null);
    assert.strictEqual(authorSortKey('Johann Wolfgang von Goethe'), 'goethe johann wolfgang');
  });
  await test('ISBN: ISBN-10 and ISBN-13 are the same number', () => {
    assert.strictEqual(isbnKey('3-16-148410-X'), '9783161484100');
    assert.strictEqual(isbnKey('978-3-16-148410-0'), '9783161484100');
    assert.strictEqual(isbnKey('12345'), null);
    assert.strictEqual(isbnKey(''), null);
  });
  await test('the same book: the same file, the same title and author, the same ISBN', () => {
    const books = [
      bk('h1', 'Immensee', 'Theodor Storm', { contentHash: 'abc', size: 9 }), bk('h2', 'Immensee', 'Theodor Storm', { contentHash: 'abc', size: 9 }),
      bk('t1', 'Maler Nolten', 'Eduard Mörike', { format: 'epub' }), bk('t2', 'Maler Nolten (example.org)', 'Mörike, Eduard', { format: 'pdf', year: 1832 }),
      bk('i1', 'Effi Briest', 'Theodor Fontane', { isbn: '3-16-148410-X', year: 1990 }), bk('i2', 'Effi Briest. Roman', 'Fontane, Theodor', { isbn: '9783161484100', year: 2012 }),
    ];
    assert.deepStrictEqual(groupsOf(books), ['h1+h2:file,title', 'i1+i2:isbn', 't1+t2:title']);
    const { groupOf } = findDuplicates(books);
    assert.strictEqual(groupOf.get('t2').id, 't1', 'the group is named after its smallest id');
  });
  await test('no false positives: volumes, other years, other authors, a missing author, an ISBN of another book', () => {
    const books = [
      bk('v1', 'Lotta Haldenbruck Band 1', 'Ilse Brandhuber'), bk('v2', 'Lotta Haldenbruck Band 2', 'Ilse Brandhuber'),
      bk('r1', 'Krieg und Frieden, Teil I', 'Leo Tolstoi'), bk('r2', 'Krieg und Frieden, Teil II', 'Leo Tolstoi'),
      bk('s1', 'Die Gezeiten von Morland 1', 'Konrad Wieseneck'), bk('s2', 'Die Gezeiten von Morland 2', 'Konrad Wieseneck'),
      bk('e1', 'Grundkurs Statistik', 'Eva Lorenz', { year: 2005 }), bk('e2', 'Grundkurs Statistik', 'Eva Lorenz', { year: 2019 }),
      bk('a1', 'Strategie', 'Anna Keller'), bk('a2', 'Strategie', 'Peter Brandt'),
      bk('n1', 'Königsindisch', ''), bk('n2', 'Königsindisch', 'Viktor Sokolow'),
      bk('x1', 'Das große Kochbuch', 'Karin Weiß', { isbn: '9783161484100' }), bk('x2', 'Mathematik für Ingenieure', 'Paul Richter', { isbn: '9783161484100' }),
      bk('y1', 'Effi Briest', 'Theodor Fontane', { isbn: '9780306406157' }), bk('y2', 'Effi Briest', 'Theodor Storm', { isbn: '9780306406157' }),
    ];
    assert.deepStrictEqual(groupsOf(books), []);
    // two editions of other years are the same book only by their file or their ISBN
    const ed = [bk('e1', 'Grundkurs Statistik', 'Eva Lorenz', { year: 2005, isbn: '9780306406157' }), bk('e2', 'Grundkurs Statistik, 2. Auflage', 'Eva Lorenz', { year: 2019, isbn: '978-0-306-40615-7' })];
    assert.deepStrictEqual(groupsOf(ed), ['e1+e2:isbn']);
  });
  await test('three copies in two kinds of evidence form one group', () => {
    const books = [bk('p', 'Woyzeck', 'Georg Büchner', { contentHash: 'q', size: 3, format: 'pdf' }), bk('q', 'Woyzeck', 'Georg Büchner', { contentHash: 'q', size: 3, format: 'pdf' }), bk('r', 'Woyzeck (German Edition)', 'Büchner, Georg', { format: 'epub' })];
    assert.deepStrictEqual(groupsOf(books), ['p+q+r:file,title']);
  });
  await test('the copy on the shelf: the one being read, else EPUB before PDF before the rest', () => {
    const pdf = { id: 'p', format: 'pdf' }, epub = { id: 'e', format: 'epub' }, mobi = { id: 'm', format: 'mobi' };
    assert.strictEqual(preferredCopy([pdf, mobi, epub]), epub);
    assert.strictEqual(preferredCopy([mobi, pdf]), pdf);
    const read = { id: 'p2', format: 'pdf', progress: 0.3, lastRead: 50 };
    assert.strictEqual(preferredCopy([epub, read]), read, 'the copy with progress');
    const later = { id: 'm2', format: 'mobi', progress: 0.1, lastRead: 90 };
    assert.strictEqual(preferredCopy([read, later, epub]), later, 'the one read last');
    assert.strictEqual(preferredCopy([{ id: 'b', format: 'pdf' }, { id: 'a', format: 'pdf' }]).id, 'a', 'deterministic');
  });

  console.log('series');
  await test('volumes from the title: Band, Bd., Vol., Teil, #, (Reihe Nr. 5), Roman numerals, ordinal words', () => {
    const cases = [
      ['Die Chroniken von Nebelstein, Band 3: Der Ritt nach Nebelstein', 'Die Chroniken von Nebelstein', 3], ['Sternenfahrer Bd. 12', 'Sternenfahrer', 12],
      ['Kalter Kaffee Vol. 2', 'Kalter Kaffee', 2], ['Krieg und Frieden - Teil 1', 'Krieg und Frieden', 1], ['Tower of Salt #4', 'Tower of Salt', 4],
      ['Der Ruf der Möwen (Küsten-Saga Nr. 5)', 'Küsten-Saga', 5], ['Krieg und Frieden, Teil II', 'Krieg und Frieden', 2],
      ['Die Mauern der Stadt Band IV', 'Die Mauern der Stadt', 4], ['Der grüne Heinrich. Erster Band', 'Der grüne Heinrich', 1],
      ['Ashfall, Book Three', 'Ashfall', 3], ['Der Ritt (Band 2)', 'Der Ritt', 2], ['Das Lied der Zeit [Das Lied der Zeit #7]', 'Das Lied der Zeit', 7],
      ['Der geduldige Anleger_ Band 1', 'Der geduldige Anleger', 1], ['Chronik Volume 10', 'Chronik', 10], ['Atlas Teil 2,5', 'Atlas', 2.5],
    ];
    for (const [title, name, index] of cases) assert.deepStrictEqual(parseSeries(title), { name, index }, title);
    for (const title of ['1848', 'Kilometer 451', 'Zimmer 13', 'Das Buch der Zahlen', 'Ticket-22', 'Teilchenphysik für Einsteiger', 'Ludwig XIV.', 'Schach für Kinder', 'Band', 'Epilog 2'])
      assert.strictEqual(parseSeries(title), null, title);
  });
  await test('the metadata of the book comes before its title', () => {
    assert.deepStrictEqual(seriesOf({ title: 'Glocken! Glocken!', series: 'Glockenwelt', seriesIndex: 8 }), { key: 'glockenwelt', name: 'Glockenwelt', index: 8 });
    assert.deepStrictEqual(seriesOf({ title: 'Reihe Band 3', series: 'Andere Reihe' }), { key: 'andere reihe', name: 'Andere Reihe', index: 3 });
    assert.strictEqual(seriesOf({ title: 'Ohne Reihe' }), null);
  });

  console.log('sort orders');
  const T = (id, title, o = {}) => ({ id, title, ...o });
  const shelf = [
    T('a', 'Zeit der Zauberei', { author: 'Anna Zeller', year: 2001, publisher: 'Rowohlt Verlag GmbH', born: 50, lastRead: 300 }),
    T('b', 'Saga Band 10', { author: 'Bruno Brandt', year: 1999, publisher: 'Suhrkamp Verlag', born: 10 }),
    T('c', 'Saga Band 2', { author: 'Bruno Brandt', year: 1995, publisher: 'Suhrkamp', born: 20, lastRead: 100 }),
    T('d', 'Anfang und Ende', { author: 'Carl Adler', born: 40 }),
    T('e', 'Saga Band 1', { author: 'Bruno Brandt', year: 1990, publisher: 'Suhrkamp', born: 30, lastRead: 200 }),
    T('f', 'Ohne Autor', { year: 2010, born: 60 }),
    T('g', 'Glockenwelt Gilde', { author: 'Paula Pfeiffer', series: 'Glockenwelt', seriesIndex: 8, publisher: 'Goldmann', born: 5 }),
    T('h', 'Glockenwelt Mond', { author: 'Paula Pfeiffer', series: 'Glockenwelt', seriesIndex: 4, publisher: 'Goldmann' }),
  ];
  const byId = Object.fromEntries(shelf.map((b) => [b.id, b]));
  const ids = shelf.map((b) => b.id);
  await test('every sort order puts a shelf in the expected order', () => {
    const want = {
      title: ['d', 'g', 'h', 'f', 'e', 'c', 'b', 'a'],
      author: ['d', 'e', 'c', 'b', 'h', 'g', 'a', 'f'],
      year: ['e', 'c', 'b', 'a', 'f', 'd', 'g', 'h'],
      publisher: ['h', 'g', 'a', 'e', 'c', 'b', 'd', 'f'],
      series: ['h', 'g', 'e', 'c', 'b', 'd', 'f', 'a'],
      added: ['f', 'a', 'd', 'e', 'c', 'b', 'g', 'h'],
      read: ['a', 'e', 'c', 'd', 'g', 'h', 'f', 'b'],
    };
    assert.deepStrictEqual(Object.keys(want).sort(), [...SORT_MODES].sort());
    for (const [mode, order] of Object.entries(want)) assert.deepStrictEqual(sortIds(ids, byId, mode), order, mode);
    assert.deepStrictEqual(sortIds(['zz', ...ids], byId, 'title').slice(-1), ['zz'], 'unknown ids stay at the end');
    assert.deepStrictEqual(sortIds(ids, byId, 'nonsense'), want.title, 'an unknown mode sorts by title');
    assert.strictEqual(publisherKey('Rowohlt Taschenbuch Verlag GmbH'), 'rowohlt taschenbuch');
  });
  await test('a series stands together in volume order also when the volumes come from the title only', () => {
    const books = ['Reihe A Band 3', 'Zwischenbuch', 'Reihe A Band 1', 'Reihe A, Teil II', 'Andere Saga #2', 'Andere Saga #1', 'Reihe A Band 10'].map((t, i) => T('s' + i, t));
    const by = Object.fromEntries(books.map((b) => [b.id, b]));
    const titles = sortIds(books.map((b) => b.id), by, 'series').map((id) => by[id].title);
    assert.deepStrictEqual(titles, ['Andere Saga #1', 'Andere Saga #2', 'Reihe A Band 1', 'Reihe A, Teil II', 'Reihe A Band 3', 'Reihe A Band 10', 'Zwischenbuch']);
  });

  console.log('arrangement (app/src/world/shelf-arrange.js, bundled with esbuild like the games tests)');
  const arrange = (() => {
    const esbuild = require('esbuild');
    const out = esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', '..', 'app', 'src', 'world', 'shelf-arrange.js')], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'error' });
    const mod = { exports: {} };
    new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
    return mod.exports;
  })();
  await test('the case "Gelesen" takes the books read, newest first; what it cannot hold stays in its department', () => {
    const books = {};
    const add = (id, o) => { books[id] = { id, title: id, ...o }; return id; };
    const deps = [{ id: 'd1', name: 'Romane', count: 6, shelves: [{ name: 'A', bookIds: ['a', 'b', 'c', 'd', 'e', 'f'] }] }];
    add('a', { progress: 1, finishedAt: 300 }); add('b', { progress: 0.2 }); add('c', { finishedAt: 500 }); add('d', { progress: 0.99, finishedAt: 100 });
    add('e', {}); add('f', { progress: 1, finishedAt: 400, readMark: false });
    const r = arrange.arrangeShelves(deps, books, {}, (ids) => Math.min(ids.length, 2));   // the case holds two
    assert.deepStrictEqual(r.finished, ['c', 'a'], 'newest first, as many as fit');
    assert.deepStrictEqual(r.departments[0].shelves[0].bookIds, ['b', 'd', 'e', 'f'], 'the oldest read one stays, an unread mark counts');
    assert.deepStrictEqual([...r.noPicks].sort(), ['a', 'c', 'd'], 'no read book on the display table');
    const off = arrange.arrangeShelves(deps, books, { finishedShelf: false });
    assert.deepStrictEqual(off.finished, []);
    assert.deepStrictEqual(off.departments[0].shelves[0].bookIds, ['a', 'b', 'c', 'd', 'e', 'f'], 'switched off: all in the department');
    assert.notStrictEqual(r.key, off.key);
  });
  await test('one copy of a book stands (dedupe), all with the setting off; the order inside a shelf, the title order kept', () => {
    const books = {
      p: { id: 'p', title: 'Woyzeck', format: 'pdf', dupGroup: 'e', author: 'Georg Büchner' }, e: { id: 'e', title: 'Woyzeck', format: 'epub', dupGroup: 'e', author: 'Georg Büchner' },
      z: { id: 'z', title: 'Zebra', author: 'Anna Adler', year: 1990 }, b: { id: 'b', title: 'Brücke', author: 'Zora Zeller', year: 1980 },
    };
    const deps = [{ id: 'd', name: 'D', count: 4, shelves: [{ name: 'S', bookIds: ['b', 'e', 'p', 'z'] }] }];
    const on = arrange.arrangeShelves(deps, books, { sort: 'author' });
    assert.deepStrictEqual([...on.hidden], ['p'], 'the PDF is the second copy');
    assert.strictEqual(on.shownAs.get('p'), 'e');
    assert.deepStrictEqual(on.departments[0].shelves[0].bookIds, ['z', 'e', 'b'], 'by surname: Adler, Büchner, Zeller');
    assert.deepStrictEqual(on.departments[0].shelves[0].canonical, ['b', 'e', 'z'], 'the rows are counted in title order');
    const all = arrange.arrangeShelves(deps, books, { dedupe: false, sort: 'year' });
    assert.deepStrictEqual(all.departments[0].shelves[0].bookIds, ['b', 'z', 'e', 'p'], 'every copy, by year (without a year last)');
    books.p.progress = 0.4;
    assert.deepStrictEqual([...arrange.arrangeShelves(deps, books, {}).hidden], ['e'], 'the copy being read stands');
    assert.deepStrictEqual(arrange.shelfOptions({ sort: 'nonsense', readingGoal: '7' }), { finishedShelf: true, dedupe: true, sort: 'title', readingGoal: 7 });
  });

  console.log('library');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-shelves-'));
  const userData = path.join(tmp, 'userData');
  const root = path.join(tmp, 'Buecher');
  fs.mkdirSync(userData, { recursive: true });
  const put = (rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, (text || rel).padEnd(2048, ' ')); return p; };
  put('Romane/Maler Nolten - Eduard Moerike.epub', 'nolten');
  put('Romane/Kopien/Maler Nolten - Eduard Moerike.epub', 'nolten');
  put('Romane/Woyzeck - Georg Buechner.pdf', 'woyzeck pdf');
  put('Romane/Woyzeck - Georg Buechner.epub', 'woyzeck epub');
  put('Sachbuch/Walden.pdf', 'walden 1');
  put('Sachbuch/Walden - Henry David Thoreau.epub', 'walden 2');
  put('Sachbuch/Grundkurs Band 1 - Eva Lorenz.pdf', 'g1');
  put('Sachbuch/Grundkurs Band 2 - Eva Lorenz.pdf', 'g2');
  let shelves = { readingGoal: 12 };
  const settings = { get: (k) => (k === 'folders' ? [{ path: root, mode: 'structured' }] : k === 'shelves' ? shelves : null) };
  const events = [];
  const lib = new Library({ userData, settings, emit: (ch, p) => events.push([ch, p]), getIndexer: () => null });
  await lib.scanAll();
  const byName = (n) => Object.values(lib.books).find((b) => path.basename(b.path) === n && !b.relPath.includes('Kopien'));
  const pub = (b) => lib.getState().books.find((x) => x.id === b.id);

  await test('getState marks the copies of a book (dupGroup, dupReasons), not two volumes or a missing author', () => {
    const st = lib.getState();
    const groups = {};
    for (const b of st.books) if (b.dupGroup) (groups[b.dupGroup] ||= []).push(path.basename(b.path) + (b.relPath.includes('Kopien') ? '*' : ''));
    const list = Object.values(groups).map((g) => g.sort().join(' + ')).sort();
    assert.deepStrictEqual(list, ['Maler Nolten - Eduard Moerike.epub + Maler Nolten - Eduard Moerike.epub*', 'Woyzeck - Georg Buechner.epub + Woyzeck - Georg Buechner.pdf']);
    const woyzeck = st.books.find((b) => /Woyzeck/.test(b.path));
    assert.deepStrictEqual(woyzeck.dupReasons, ['title']);
    assert(!st.books.find((b) => /Walden\.pdf/.test(b.path)).dupGroup, 'a copy without an author is no duplicate');
    for (const b of st.books) assert.strictEqual(typeof b.finished, 'boolean');
  });
  await test('markRead / markUnread, the goal of the year and the finished count', () => {
    const b = byName('Woyzeck - Georg Buechner.epub'), c = byName('Woyzeck - Georg Buechner.pdf');
    assert.strictEqual(lib.markRead(b.id, true).finished, true);
    assert(events.some(([ch, p]) => ch === 'library:book' && p.id === b.id && p.finished), 'the renderer hears of it');
    lib.markRead(c.id, true);
    let st = lib.getStats();
    assert.strictEqual(st.goal.year, new Date().getFullYear());
    assert.strictEqual(st.goal.count, 1, 'two copies of one book count once');
    assert.strictEqual(st.goal.target, 12);
    assert.strictEqual(st.finished, 2);
    lib.markRead(b.id, false); lib.markRead(c.id, false);
    st = lib.getStats();
    assert.strictEqual(st.goal.count, 0);
    assert.strictEqual(pub(b).finished, false);
    shelves = {}; assert.strictEqual(lib.getStats().goal.target, 0, 'no goal set');
  });
  await test('reading to 97 % finishes a book, going back keeps it, the day is kept', () => {
    const b = byName('Grundkurs Band 1 - Eva Lorenz.pdf');
    lib.updateBook(b.id, { progress: 0.5 });
    assert.strictEqual(pub(b).finished, false);
    lib.updateBook(b.id, { progress: 0.98, lastRead: Date.now() });
    const at = pub(b).finishedAt;
    assert(pub(b).finished && at > 0);
    lib.updateBook(b.id, { progress: 0.1 });
    assert.strictEqual(pub(b).finished, true);
    assert.strictEqual(pub(b).finishedAt, at);
  });
  await test('the streak needs 5 minutes a day', () => {
    const b = byName('Walden.pdf');
    lib.addReadingTime(b.id, 240);
    assert.strictEqual(lib.getStats().streak, 0, '4 minutes are not enough');
    lib.addReadingTime(b.id, 60);
    const st = lib.getStats();
    assert.strictEqual(st.streak, 1);
    assert.strictEqual(st.readToday, true);
  });
  await test('files carry the day they arrived (born), a moved book keeps it and its read state', async () => {
    for (const b of Object.values(lib.books)) assert(b.born > 0 && b.born <= Date.now(), b.path);
    const src = path.join(root, 'Sachbuch', 'Grundkurs Band 2 - Eva Lorenz.pdf');
    const old = Object.values(lib.books).find((b) => b.path === src);
    lib.markRead(old.id, true);
    const born = old.born, done = old.finishedAt;
    const dst = path.join(root, 'Romane', 'Grundkurs Band 2 - Eva Lorenz.pdf');
    fs.renameSync(src, dst);
    await lib.rescanQuiet();
    const moved = Object.values(lib.books).find((b) => b.path === dst);
    assert(moved && moved.id !== old.id);
    assert.strictEqual(moved.finishedAt, done, 'still read');
    assert.strictEqual(moved.born, born);
  });
  await test('index results: the language is normalised, the series of an EPUB is kept', async () => {
    const b = byName('Maler Nolten - Eduard Moerike.epub');
    lib.indexing = { id: b.id, started: Date.now() };
    await lib.onIndexResult(b.id, { metadata: { title: 'Maler Nolten', author: 'Eduard Mörike', language: 'Germa', series: 'Novellen', seriesIndex: 2 }, textSample: 'und der die das nicht ist mit sich auch eine wird' });
    assert.strictEqual(b.language, 'de');
    assert.strictEqual(b.series, 'Novellen');
    assert.strictEqual(b.seriesIndex, 2);
    const c = byName('Walden.pdf');
    lib.indexing = { id: c.id, started: Date.now() };
    await lib.onIndexResult(c.id, { metadata: { title: 'Walden', language: '<¦' }, textSample: 'the and of to is with that this are for not '.repeat(20) });
    assert.strictEqual(c.language, 'en', 'garbage gives way to the guess from the text');
    lib.updateBook(c.id, { language: 'DE-DE' });
    assert.strictEqual(c.language, 'de');
  });
  for (const w of lib.watchers) { try { w.close(); } catch {} }
  lib.flush();

  await test('on load: garbage languages become null (then a guess from the text), codes two letters, old finished books get a day', async () => {
    const ud = path.join(tmp, 'ud-load');
    fs.mkdirSync(path.join(ud, 'text'), { recursive: true });
    fs.writeFileSync(path.join(ud, 'text', 'g.txt'), 'Der Fuchs und der Hase sind nicht mit sich im Wald, das ist eine Geschichte die auch wird erzählt. '.repeat(10));
    const rec = (id, language, extra = {}) => ({ id, path: `C:/b/${id}.pdf`, relPath: `${id}.pdf`, folder: 'C:/b', departmentId: 'misc', department: 'Verschiedenes', bookmarks: [], annotations: [], language, ...extra });
    fs.writeFileSync(path.join(ud, 'library.json'), JSON.stringify({ schema: 3, history: [], onlineCache: {}, books: {
      a: rec('a', 'Germa'), b: rec('b', 'ƒ*ªþ×'), c: rec('c', 'DE-DE'), d: rec('d', 'en-US'), e: rec('e', 'eng'), g: rec('g', '<¦'),
      f: rec('f', 'de', { progress: 0.99, lastRead: 12345 }),
    } }));
    const l2 = new Library({ userData: ud, settings: { get: () => null }, emit: () => {}, getIndexer: () => null });
    const langs = Object.fromEntries(Object.values(l2.books).map((b) => [b.id, b.language]));
    assert.deepStrictEqual(langs, { a: 'de', b: null, c: 'de', d: 'en', e: 'en', g: null, f: 'de' });
    assert.strictEqual(l2.books.f.finishedAt, 12345);
    await new Promise((r) => setTimeout(r, 400));
    assert.strictEqual(l2.books.g.language, 'de', 'guessed from the text sample in the background');
    assert.strictEqual(l2.books.b.language, null, 'no text, no guess');
    l2.flush();
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
