// Tests for the full-text search: folding, tokens and stemming, the cleaned page text (hyphens at line ends, the map
// back to the pieces), the query language, matches and excerpts, the SQLite index (AND, phrases, prefixes, resume,
// changed and removed books) and the main-process manager with a simulated indexer window (what gets read when, the
// gate, a book that changes, leaves or moves).
// Plain Node, no Electron, no network.  Run:  node electron/search/test-fulltext.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

// Node 22 announces node:sqlite as experimental on every run (Electron's Node does not): keep the output clean
const emitWarning = process.emitWarning;
process.emitWarning = (w, ...rest) => (/SQLite/.test(String(w)) ? undefined : emitWarning.call(process, w, ...rest));

const T = require('./textnorm');
const { FulltextDB, UNIT } = require('./fulltext-db');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 5).join('\n       ')); }
}
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-fts-'));
const stemOf = (w) => T.stem(T.fold(w));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('text rules');

  await test('folding: case, umlauts written out, accents, ligatures, apostrophes', () => {
    assert.strictEqual(T.fold('Müller'), 'mueller');
    assert.strictEqual(T.fold('MUELLER'), 'mueller');
    assert.strictEqual(T.fold('Straße'), 'strasse');
    assert.strictEqual(T.fold('STRAẞE'), 'strasse');
    assert.strictEqual(T.fold('Café'), 'cafe');
    assert.strictEqual(T.fold('ﬁnden'), 'finden');
    assert.strictEqual(T.fold('Mu\u0308ller'), 'mueller', 'a decomposed umlaut');
    assert.strictEqual(T.fold("don't"), 'dont');
    assert.strictEqual(T.fold('Øresund'), 'oresund');
  });

  await test('stemming: plurals and simple endings in German and English', () => {
    const same = (...ws) => { const s = new Set(ws.map(stemOf)); assert.strictEqual(s.size, 1, `${ws.join(', ')} → ${[...s].join(', ')}`); };
    same('Buch', 'Bücher', 'Büchern', 'Buches', 'Buchs');
    same('Haus', 'Häuser', 'Hauses', 'Häusern');
    same('Müller', 'Mueller', 'Muller');
    same('Stadt', 'Städte', 'Städten');
    same('Turm', 'Türme', 'Türmen');
    same('Zug', 'Züge');
    same('Kind', 'Kinder', 'Kindern');
    same('Mutter', 'Mütter', 'Müttern');
    same('Problem', 'Probleme', 'Problemen');
    same('Familie', 'Familien');
    same('schön', 'schöne', 'schöner', 'schönsten');
    same('Feuer', 'Feuers', 'feuern');
    same('book', 'books');
    same('story', 'stories');
    same('play', 'plays', 'played', 'playing');
    same('run', 'running');
    same('opening', 'openings');
    same('glass', 'glasses');
    same('Auto', 'Autos');
    // what must stay apart
    assert.notStrictEqual(stemOf('Haus'), stemOf('Hase'));
    assert.notStrictEqual(stemOf('Bücherei'), stemOf('Buch'));
    assert.strictEqual(stemOf('1945'), '1945');
    assert.strictEqual(stemOf('e4'), 'e4');
    assert.strictEqual(stemOf('speed'), 'speed');
  });

  await test('index terms: stop words and single letters stay out, every term once', () => {
    assert.strictEqual(T.termOf('und'), null);
    assert.strictEqual(T.termOf('the'), null);
    assert.strictEqual(T.termOf('a'), null);
    assert.strictEqual(T.termOf('Bücher'), 'buch');
    const terms = T.indexTerms('Die Bücher und das Buch, the books and a book. 1.e4 e5!').split(' ');
    assert.deepStrictEqual(terms.sort(), ['book', 'buch', 'e4', 'e5']);
  });

  await test('cleaned text: a word hyphenated at a line end is one word again', () => {
    const t = (pieces) => T.cleanText(pieces).text;
    assert.strictEqual(t([{ str: 'die alten Bü-', eol: true }, { str: 'cher im Regal' }]), 'die alten Bücher im Regal');
    assert.strictEqual(t([{ str: 'Ost-', eol: true }, { str: 'und Westeuropa' }]), 'Ost-\nund Westeuropa', 'a conjunction keeps the hyphen');
    assert.strictEqual(t([{ str: 'Die Schach-', eol: true }, { str: 'Weltmeisterschaft' }]), 'Die Schach-Weltmeisterschaft');
    assert.strictEqual(t([{ str: 'Silben\u00ADtrennung' }]), 'Silbentrennung');
    assert.strictEqual(t([{ str: 'Wort\u00AD', eol: true }, { str: 'ende' }]), 'Wortende');
    assert.strictEqual(t([{ str: '  zwei   Leer  ' }, { str: '\n' }, { str: '\n' }, { str: 'zeilen\t!' }]), 'zwei Leer\nzeilen !');
    assert.strictEqual(t([{ str: 'a - b' }]), 'a - b', 'a dash between words stays');
  });

  await test('cleaned text: the map leads back to the pieces', () => {
    const pieces = [{ str: 'Der weiße ' }, { str: 'Läu-', eol: true }, { str: '  fer opfert sich' }];
    const cl = T.cleanText(pieces, { map: true });
    assert.strictEqual(cl.text, 'Der weiße Läufer opfert sich');
    const at = cl.text.indexOf('Läufer');
    const [p0, o0] = T.pieceAt(cl.starts, cl.src[at]);
    const [p1, o1] = T.pieceAt(cl.starts, cl.src[at + 'Läufer'.length - 1]);
    assert.deepStrictEqual([p0, o0], [1, 0]);
    assert.deepStrictEqual([p1, o1], [2, 4], 'the last letter lies in the next line');
    assert.strictEqual(pieces[2].str[o1], 'r');
  });

  await test('queries: words, phrases in all quote styles, prefixes, hyphenated words', () => {
    let q = T.parseQuery('Bücher "der weiße Läufer" Schach*');
    assert.deepStrictEqual(q.items.map((i) => i.kind), ['phrase', 'word', 'word']);
    assert.deepStrictEqual(q.items[0].tokens.map((t) => t.f), ['der', 'weisse', 'laeufer']);
    assert.strictEqual(q.items[2].pre, 'schach');
    assert.strictEqual(T.ftsMatch(q), '"weiss" AND "lauf" AND "buch" AND ("schach"* OR "schach")');
    q = T.parseQuery('„Die Reise“ »Ferne Länder«');
    assert.deepStrictEqual(q.items.map((i) => i.raw), ['Die Reise', 'Ferne Länder']);
    q = T.parseQuery('Caro-Kann');
    assert.strictEqual(q.items[0].kind, 'phrase');
    assert.deepStrictEqual(q.items[0].tokens.map((t) => t.f), ['caro', 'kann']);
    assert(T.parseQuery('der die das').common, 'only stop words');
    assert(T.parseQuery('   ').empty);
    assert(!T.parseQuery('ab*').items[0].pre, 'a prefix needs three letters');
    assert.strictEqual(T.parseQuery('Bücher*').items[0].pre, 'bucher', 'prefixes are compared without umlauts');
    q = T.parseQuery('"Bücher"');
    assert.strictEqual(q.items[0].kind, 'phrase', 'a quoted word must stand as written');
  });

  await test('matches: any form of a word, phrases word for word, prefixes', () => {
    const text = 'Das Buch über den weißen Läufer. Der weiße Läufer steht. Die Bücherei und die Bücher, Caro-Kann!';
    const marks = (query) => T.findMatches(text, T.parseQuery(query)).map((m) => text.slice(m.a, m.b));
    assert.deepStrictEqual(marks('Bücher'), ['Buch', 'Bücher']);
    assert.deepStrictEqual(marks('"weiße Läufer"'), ['weiße Läufer']);
    assert.deepStrictEqual(marks('Bücher*'), ['Buch', 'Bücherei', 'Bücher']);
    assert.deepStrictEqual(marks('Caro-Kann'), ['Caro-Kann']);
    assert.deepStrictEqual(marks('"Bücher"'), ['Bücher']);
    const m = T.findMatches(text, T.parseQuery('Bücher'));
    assert.deepStrictEqual(m.map((x) => x.exact), [false, true]);
    assert(T.hasPhrases(text, T.parseQuery('"Der weiße Läufer" Buch')));
    assert(!T.hasPhrases(text, T.parseQuery('"weißer Läufer"')));
  });

  await test('phrases: the quick test on the folded page never drops a real hit', () => {
    const cases = [
      ['"weiße Läufer"', 'Der WEISSE Laeufer zieht.', true],
      ['"weisse Laeufer"', '„Der weiße Läufer“, sagte er.', true],
      ['"Café am Meer"', 'Ein cafe am meer', true],
      ['"москва иод"', 'Москва́ йод', true],
      ['"x2 y"', 'x² y', true],
      ['"don’t stop"', "Please don't stop now", true],
      ['"weiße Läufer"', 'Der weiße, schwarze Läufer', false],
      ['"der Turm"', 'Der Turmbau zu Babel', false],
    ];
    for (const [q, text, want] of cases) assert.strictEqual(T.hasPhrases(text, T.parseQuery(q)), want, `${q} in ${text}`);
  });

  await test('excerpts: around the best place, marks inside, cut marks', () => {
    const long = 'Anfang. '.repeat(60) + 'Hier steht der Quastenflosser neben dem Leuchtturm am Meer. ' + 'Ende. '.repeat(60);
    const s = T.snippet(long, T.parseQuery('Quastenflosser Leuchtturm'), 160);
    assert(s.pre && s.post);
    assert.strictEqual(s.marks.length, 2);
    assert.deepStrictEqual(s.marks.map(([a, b]) => s.text.slice(a, b)), ['Quastenflosser', 'Leuchtturm']);
    assert(s.text.length <= 170);
    const none = T.snippet('Kurzer Text ohne Treffer', T.parseQuery('Zebra'), 160);
    assert.strictEqual(none.marks.length, 0);
  });

  console.log('the index');
  const dir = tmpDir();
  const file = path.join(dir, 'fulltext', 'index.sqlite');
  const pages = (texts, from = 0) => texts.map((text, i) => ({ u: from + i, text, terms: T.indexTerms(text) }));
  const db = new FulltextDB(file).open();

  await test('building: pages of several books, AND on one page, phrases, prefixes', () => {
    db.begin('b1', 'k1', 'pdf');
    db.add('b1', pages(['Der weiße Läufer opfert sich.', 'Der König flieht vor dem Turm.', 'Läufer und Turm gegen König.', 'Bücher über Schachbretter.']), 4);
    db.finish('b1', { units: 4 });
    db.begin('b2', 'k2', 'flow');
    db.add('b2', [{ u: 0, text: 'Ein Turm am Meer, darin alte Bücher.', terms: T.indexTerms('Ein Turm am Meer, darin alte Bücher.'), s: 0, o: 0, len: 40, chapter: 'Kapitel 1', pos: 1 },
      { u: 1, text: 'Der Leuchtturm warf sein Licht.', terms: T.indexTerms('Der Leuchtturm warf sein Licht.'), s: 1, o: 12, len: 31, chapter: 'Kapitel 2', pos: 3, page: '17' }], 2);
    db.finish('b2', { units: 2 });
    const hits = (q) => Object.fromEntries(db.match(T.parseQuery(q)).books.map((b) => [b.id, db.unitsOf(T.parseQuery(q), b.id)]));
    assert.deepStrictEqual(hits('Turm'), { b1: [1, 2], b2: [0] });
    assert.deepStrictEqual(hits('Turm König'), { b1: [1, 2] });
    assert.deepStrictEqual(hits('Läufer Turm'), { b1: [2] });
    assert.deepStrictEqual(hits('"weiße Läufer"'), { b1: [0] });
    assert.deepStrictEqual(hits('"weißer Läufer"'), {});
    assert.deepStrictEqual(hits('Buch'), { b1: [3], b2: [0] });
    assert.deepStrictEqual(hits('Schach*'), { b1: [3] });
    assert.deepStrictEqual(hits('Leucht*'), { b2: [1] });
    assert.deepStrictEqual(hits('Zebra'), {});
    const sn = db.snippets(T.parseQuery('Leuchtturm'), 'b2', [1]);
    assert.strictEqual(sn[0].chapter, 'Kapitel 2');
    assert.strictEqual(sn[0].page, '17');
    assert.deepStrictEqual([sn[0].s, sn[0].o, sn[0].len], [1, 12, 31]);
    assert.strictEqual(sn[0].snippet.text.slice(...sn[0].snippet.marks[0]), 'Leuchtturm');
    // merging the segments in small steps changes nothing that can be found
    for (let i = 0; i < 50 && db.merge(20); i++);
    assert.strictEqual(db.merge(20), false, 'nothing left to merge');
    assert.deepStrictEqual(hits('Turm König'), { b1: [1, 2] });
  });

  await test('resume: a book half read goes on at its next page, nothing twice', () => {
    db.begin('long', 'kl', 'pdf');
    db.add('long', pages(['Seite eins mit Anker.', 'Seite zwei mit Anker.']), 2);
    // the app closes; at the next start the same file resumes
    const again = db.begin('long', 'kl', 'pdf', { resume: true });
    assert.strictEqual(again.next, 2);
    db.add('long', pages(['Seite eins mit Anker.', 'Seite zwei mit Anker.', 'Seite drei mit Anker.']), 3);   // a resend of 0 and 1 is skipped
    db.finish('long', { units: 3 });
    assert.deepStrictEqual(db.unitsOf(T.parseQuery('Anker'), 'long'), [0, 1, 2]);
    assert.strictEqual(db.list().find((r) => r.id === 'long').pages, 3);
  });

  await test('a changed file is read again: its old pages leave the index', () => {
    db.begin('b2', 'k2-changed', 'flow');
    db.add('b2', [{ u: 0, text: 'Nur noch ein Zitronenfalter.', terms: T.indexTerms('Nur noch ein Zitronenfalter.'), s: 0, o: 0, len: 28 }], 1);
    db.finish('b2', { units: 1 });
    assert.deepStrictEqual(db.match(T.parseQuery('Leuchtturm')).books, []);
    assert.deepStrictEqual(db.match(T.parseQuery('Zitronenfalter')).books.map((b) => b.id), ['b2']);
  });

  await test('a removed book leaves the index, a moved one keeps its pages', () => {
    assert(db.remove('long'));
    assert.deepStrictEqual(db.match(T.parseQuery('Anker')).books, []);
    assert(db.rekey('b1', 'b1-moved'));
    assert.deepStrictEqual(db.match(T.parseQuery('"weiße Läufer"')).books.map((b) => b.id), ['b1-moved']);
    assert.strictEqual(db.unitText('b1-moved', 0), 'Der weiße Läufer opfert sich.');
  });

  await test('a book without text (a scan) is marked as such', () => {
    db.begin('scan', 'ks', 'pdf');
    db.add('scan', pages(['12']), 40);
    const row = db.finish('scan', { units: 40 });
    assert.strictEqual(row.state, 'notext');
    db.begin('short', 'kt', 'flow');
    db.add('short', [{ u: 0, text: 'Ein kurzer Text, aber ein echter Text mit Wörtern. '.repeat(6), terms: 'kurz text', s: 0, o: 0, len: 300 }], 1);
    assert.strictEqual(db.finish('short', { units: 1 }).state, 'done');
  });

  await test('the index survives closing and opening, a new version of the rules starts over', () => {
    db.close();
    const db2 = new FulltextDB(file).open();
    assert.deepStrictEqual(db2.match(T.parseQuery('Zitronenfalter')).books.map((b) => b.id), ['b2']);
    assert(db2.list().some((r) => r.id === 'b1-moved' && r.state === 'done'));
    assert(db2.size() > 0);
    db2.db.prepare("UPDATE meta SET v = '0.0' WHERE k = 'version'").run();
    db2.close();
    const db3 = new FulltextDB(file).open();
    assert.deepStrictEqual(db3.list(), [], 'old rules: nothing kept');
    db3.clear();
    assert.deepStrictEqual(db3.list(), []);
    db3.close();
  });

  await test('a damaged file is replaced by a new index', () => {
    const bad = path.join(dir, 'bad', 'index.sqlite');
    fs.mkdirSync(path.dirname(bad), { recursive: true });
    fs.writeFileSync(bad, 'this is no database at all, just text '.repeat(200));
    const dbb = new FulltextDB(bad).open();
    dbb.begin('x', 'k', 'pdf'); dbb.add('x', pages(['Neu angelegt.']), 1); dbb.finish('x', { units: 1 });
    assert.deepStrictEqual(dbb.match(T.parseQuery('angelegt')).books.map((b) => b.id), ['x']);
    dbb.close();
  });

  console.log('the manager (simulated indexer window)');
  await test('reads what is missing, one book at a time; follows changes, removals and moves; the gate holds it', async () => {
    process.env.COZYSHELVES_FULLTEXT_DELAY = '0';
    const { register } = require('./fulltext');
    const ud = tmpDir();
    const handlers = {}, listeners = {}, quitHandlers = [], sent = [];
    // the stand-in of the reading window: it says hello once loaded, its messages land in `sent`
    let windows = 0;
    const sender = { send: (ch, payload) => sent.push([ch, payload]), getOSProcessId: () => 0, on: () => {} };
    const makeTextWindow = () => {
      windows++;
      let gone = false;
      return { webContents: sender, isDestroyed: () => gone, destroy: () => { gone = true; }, on: () => {}, loadURL: () => setTimeout(() => listeners['fulltext:hello']?.({ sender }), 10) };
    };
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { listeners[ch] = fn; } };
    const app = { getPath: () => ud, on: (ev, fn) => { if (ev === 'before-quit') quitHandlers.push(fn); } };
    const settingsData = { fulltext: { enabled: true } };
    const settingsListeners = [];
    const settings = { get: (k) => settingsData[k], onChange: (fn) => settingsListeners.push(fn) };
    const book = (id, extra = {}) => ({ id, path: `C:/Bücher/${id}.pdf`, format: 'pdf', title: id, size: 1000, mtime: 1, contentHash: 'h-' + id, indexed: true, department: 'Sachbuch', language: 'de', ...extra });
    const library = { books: { a: book('a'), b: book('b', { format: 'epub', path: 'C:/Bücher/b.epub' }), c: book('c', { indexed: false }) }, queue: [], indexing: null, onIdle: () => {}, publicBook: (b) => ({ id: b.id, title: b.title }) };
    register({ ipcMain, app, settings, library, broadcast: () => {}, makeTextWindow });
    const ev = { sender };
    // the simulated indexer window answers every job: one page with the book's id as a word
    const served = [];
    const serve = async () => {
      for (;;) {
        const i = sent.findIndex(([ch]) => ch === 'fulltext-job');
        if (i < 0) return;
        const [, job] = sent.splice(i, 1)[0];
        served.push(job.id);
        const text = `Seite über das Buch ${job.id} mit dem Wort Anker${job.id}.`;
        await handlers['fulltext:units'](ev, job.jobId, [{ u: 0, text, terms: T.indexTerms(text) }], 1, { units: 1 });
        await handlers['fulltext:end'](ev, job.jobId, { state: 'done', units: 1 });
      }
    };
    const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { await serve(); if (await fn()) return true; await sleep(100); } return false; };
    const search = async (q) => (await handlers['fulltext:search'](null, { q })).books.map((x) => x.id).sort();
    try {
      assert(await until(async () => (await handlers['fulltext:status']()).done === 2), 'two books read');
      assert.deepStrictEqual(served.sort(), ['a', 'b'], 'c is not read before the library has read it');
      assert.strictEqual(windows, 1, 'one reading window for both books');
      assert.deepStrictEqual(await search('Buch'), ['a', 'b']);
      // c is ready now; the reader is open: nothing is read until it closes
      await handlers['fulltext:activity'](null, { reading: true });
      library.books.c.indexed = true;
      await sleep(6500);
      await serve();
      assert(!served.includes('c'), 'nothing is read while the user reads');
      assert.strictEqual((await handlers['fulltext:status']()).paused, 'reading');
      await handlers['fulltext:activity'](null, { reading: false });
      assert(await until(async () => served.includes('c')), 'c is read after the reader closed');
      // a changed file is read again, a removed one leaves the index, a moved one keeps its pages
      library.books.a = book('a', { mtime: 2 });
      delete library.books.b;
      library.books.c2 = { ...library.books.c, id: 'c2', path: 'C:/Bücher/Neu/c.pdf' };
      library.books.c.missing = true;
      const before = served.length;
      assert(await until(async () => served.length > before && (await search('Buch')).join() === 'a,c2'), 'after the changes: ' + (await search('Buch')).join());
      assert.deepStrictEqual(served.slice(before), ['a'], 'only the changed book is read again (the moved one keeps its pages)');
      assert.deepStrictEqual(await search('Ankerc'), ['c2']);
      // the computer's catalogue ("Volltext") gets its answer from the index as well
      const cat = await library.textSearch('Ankerc', 40);
      assert.deepStrictEqual(cat.map((x) => x.book.id), ['c2']);
      assert(/Ankerc[.]/.test(cat[0].excerpt), cat[0].excerpt);
      assert.strictEqual(await library.textSearch('und der', 40), null, 'only stop words: the samples answer');
      const st = await handlers['fulltext:status']();
      assert.strictEqual(st.total, 2); assert.strictEqual(st.done, 2);
      // switched off: no more reading, searching says so
      settingsData.fulltext.enabled = false; settingsListeners.forEach((fn) => fn());
      const off = await handlers['fulltext:search'](null, { q: 'Buch' });
      assert(off.off, 'search while off');
    } finally {
      quitHandlers.forEach((fn) => fn());
      await sleep(300);
      try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
    }
  });

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
