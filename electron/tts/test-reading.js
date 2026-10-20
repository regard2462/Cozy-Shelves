// Tests for what reaches the voices (0.7). Run by electron/tts/test-tts.js (npm test).
//   the language of a book and of its paragraphs (metadata valid, wrong, broken or missing × German, English, mixed
//   and undecidable text), the text of a PDF page from pdf.js-like items (spaces at line ends, hyphenation, reading
//   order of columns, running heads, page numbers, diagram rows), chess notation in words, the junk detector
//   (no false alarm on normal text, alarm on broken encodings) and the sentence splitter around chess moves.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const importApp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const DE_TEXT = 'Im März beginnt das Gartenjahr. Die Erde ist noch kalt, aber die ersten Schneeglöckchen blühen schon unter den Hecken. Wer jetzt Erbsen sät, kann im Juni ernten.';
const EN_TEXT = 'At the end of the headland stood an old lighthouse. Nobody had lived there for many years, yet every evening the light came on at exactly the same time.';
const CHESS_ONLY = '1. e4 e5 2. Sf3 Sc6 3. Lb5 a6 4. La4 Sf6 5. 0-0 Le7';
const shift = (s, k) => s.replace(/[a-z]/g, (c) => String.fromCharCode(97 + (c.charCodeAt(0) - 97 + k) % 26)).replace(/[A-Z]/g, (c) => String.fromCharCode(65 + (c.charCodeAt(0) - 65 + k) % 26));

async function run(test) {
  const L = await importApp('app/src/ui/reader/tts-lang.js');
  const C = await importApp('app/src/ui/reader/tts-chess.js');
  const J = await importApp('app/src/ui/reader/tts-junk.js');
  const P = await importApp('app/src/ui/reader/tts-pdf.js');

  console.log('the language of a book and its paragraphs (tts-lang.js)');
  await test('normalizeLangCode: valid tags and names, garbage and undetermined entries', () => {
    const cases = { 'de': 'de', 'de-DE': 'de', 'DE': 'de', 'DE-DE': 'de', 'de-AT': 'de', 'de-CH': 'de', 'Germa': 'de', 'ger': 'de', 'deu': 'de', 'Deutsch': 'de', 'German': 'de',
      'en': 'en', 'eng': 'en', 'en-US': 'en', 'English': 'en', 'fr-FR': 'fr', 'pl': 'pl',
      '<¦': null, 'ƒ*ªþ×': null, 'to˚‹j': null, '·Ð\f7\b': null, '|ãp+`': null, 'und': null, 'x-default': null, '': null, null: null };
    for (const [raw, want] of Object.entries(cases)) assert.strictEqual(L.normalizeLangCode(raw === 'null' ? null : raw), want, raw);
  });
  // book language valid / wrong / garbage / missing × text German / English / undecidable
  const metas = { valid: 'de', 'valid (de-DE)': 'de-DE', wrong: 'en-US', garbage: '<¦', missing: null };
  for (const [what, meta] of Object.entries(metas)) {
    await test(`book language ${what}: German text is read in German, English text in English`, () => {
      assert.strictEqual(L.chooseLanguage(DE_TEXT, { meta, ui: 'en' }).lang, 'de');
      assert.strictEqual(L.chooseLanguage(EN_TEXT, { meta, ui: 'de' }).lang, 'en');
      assert.strictEqual(L.chooseLanguage(DE_TEXT, { meta }).source, 'text');
    });
  }
  await test('undecidable text (chess notation, a title): the valid book language, then the app language, then German', () => {
    assert.deepStrictEqual([L.chooseLanguage(CHESS_ONLY, { meta: 'en' }).lang, L.chooseLanguage(CHESS_ONLY, { meta: 'en' }).source], ['en', 'meta']);
    assert.deepStrictEqual([L.chooseLanguage(CHESS_ONLY, { meta: '<¦', ui: 'en' }).lang, L.chooseLanguage(CHESS_ONLY, { meta: '<¦', ui: 'en' }).source], ['en', 'ui']);
    assert.deepStrictEqual([L.chooseLanguage('Endspielkurs', { meta: null, ui: null }).lang, L.chooseLanguage('Endspielkurs', {}).source], ['de', 'default']);
    assert.strictEqual(L.chooseLanguage(CHESS_ONLY, { meta: 'Germa', ui: 'en' }).lang, 'de');
  });
  await test('mixed book: the German base stays, a clear English paragraph is read in English, short lines stay German', () => {
    const paras = ['Briefe aus zwei Ländern', 'Die Briefe, die Anna aus London schickte, waren lang und voller kleiner Zeichnungen.', 'The weather in London has been grey for weeks, but the parks are still full of people.', 'Thank you!', 'Darunter hatte Anna geschrieben, dass sie das Wetter in Deutschland vermisse.'];
    for (const meta of ['de', 'en', null, '<¦']) {
      const plan = L.planLanguages(paras, { meta, ui: 'en' });
      assert.strictEqual(plan.base, 'de', String(meta));
      assert.deepStrictEqual(plan.langs, ['de', 'de', 'en', 'de', 'de'], String(meta));
    }
  });
  await test('an English book marked German is read in English, with a German quote in German', () => {
    const plan = L.planLanguages(['The Lighthouse', EN_TEXT, 'Der Wärter hatte in sein Buch geschrieben, dass die See ruhig war und die Schiffe ohne Mühe vorbeizogen.', EN_TEXT], { meta: 'de' });
    assert.strictEqual(plan.base, 'en');
    assert.deepStrictEqual(plan.langs, ['en', 'en', 'de', 'en']);
  });
  await test('a base decided on an earlier page is kept (base option)', () => {
    const plan = L.planLanguages(['Kapitel 3', CHESS_ONLY], { meta: 'en', base: 'de' });
    assert.deepStrictEqual([plan.base, ...plan.langs], ['de', 'de', 'de']);
  });

  console.log('sentences around chess notation');
  await test('splitSentences keeps moves together ("2. Sf3", "12... Sf6", "Dd7? 13. Lxf7+! Kxf7")', () => {
    const got = L.splitSentences('Die Antwort 12... Sf6 ist am stärksten. Nach 12...Dd7? 13. Lxf7+! Kxf7 14. Sg5+ verliert Schwarz die Dame. Betrachten wir 1. e4 e5 2. Sf3 Sc6 3. Lb5 a6. Gut!', 'de');
    assert.deepStrictEqual(got, ['Die Antwort 12... Sf6 ist am stärksten.', 'Nach 12...Dd7? 13. Lxf7+! Kxf7 14. Sg5+ verliert Schwarz die Dame.', 'Betrachten wir 1. e4 e5 2. Sf3 Sc6 3. Lb5 a6.', 'Gut!']);
  });
  await test('normal sentences still end at "?" and "!" before a capital', () => {
    assert.deepStrictEqual(L.splitSentences('Wer kommt? Anna kommt! Danach gehen wir.', 'de'), ['Wer kommt?', 'Anna kommt!', 'Danach gehen wir.']);
  });

  console.log('chess notation in words (tts-chess.js)');
  const de = (t) => C.speakChess(t, 'de');
  await test('German: move numbers, pieces, captures, castling, check, mate, promotion', () => {
    assert.strictEqual(de('Nach 1. e4 e5 2. Sf3 gewinnt Weiß.'), 'Nach 1, e vier, e fünf, 2, Springer f drei, gewinnt Weiß.');
    assert.strictEqual(de('Die Antwort 12...Sf6 ist am stärksten.'), 'Die Antwort 12, Springer f sechs, ist am stärksten.');
    assert.strictEqual(de('Nach 5. 0-0 Le7 und 9. 0-0-0 folgt exd5.'), 'Nach 5, kurze Rochade, Läufer e sieben, und 9, lange Rochade, folgt e schlägt d fünf.');
    assert.strictEqual(de('Nach 52.e8=D+ Kf6 53. Dh8+ gewinnt Weiß.'), 'Nach 52, e acht, wird Dame, Schach, König f sechs, 53, Dame h acht, Schach, gewinnt Weiß.');
    assert.strictEqual(de('Am Ende 13. Lxf7#.'), 'Am Ende 13, Läufer schlägt f sieben, matt.');
    // the signs of a book that judge a move (!, ?, !?) are left out: a "?" would make the voice ask a question
    assert.strictEqual(de('Nach 12...Dd7? 13. Lxf7+! Kxf7 verliert Schwarz.'), 'Nach 12, Dame d sieben, 13, Läufer schlägt f sieben, Schach, König schlägt f sieben, verliert Schwarz.');
    assert.strictEqual(de('Nach 1. Sbd7 Tfe8'), 'Nach 1, Springer b d sieben, Turm f e acht');
  });
  await test('figurines, English letters of figurine fonts, long notation, results and evaluation signs', () => {
    assert.strictEqual(de('Die Lösung beginnt mit 1. ♘f3, danach folgt 1...♚e7 2. ♕e2#.'), 'Die Lösung beginnt mit 1, Springer f drei, danach folgt 1, König e sieben, 2, Dame e zwei, matt.');
    assert.strictEqual(de('Nach 2. Nf3 Nc6 3. Bb5 a6'), 'Nach 2, Springer f drei, Springer c sechs, 3, Läufer b fünf, a sechs');
    assert.strictEqual(de('Weiß zog 1. Sg1-f3 und Lb5xc6.'), 'Weiß zog 1, Springer g eins f drei, und Läufer b fünf schlägt c sechs.');
    assert.strictEqual(de('Nach 34. Txa7 ± und 1-0'), 'Nach 34, Turm schlägt a sieben, Weiß steht besser und Weiß gewinnt');
  });
  await test('English: words and letter names for the English voice', () => {
    assert.strictEqual(C.speakChess('After 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. O-O White is fine.', 'en'), 'After 1, E four, E five, 2, knight F three, knight C six, 3, bishop B five, A six, 4, castles kingside, White is fine.');
    assert.strictEqual(C.speakChess('Then 30. exd8=Q+ Kxd8 wins.', 'en'), 'Then 30, E takes D eight, promotes to queen, check, king takes D eight, wins.');
  });
  await test('no chess in normal text: "Vitamin B12", "ein A4-Blatt", "Bd. 2", "S. 12", "am 3. Mai", a single "Le3"', () => {
    for (const t of ['Er nahm Vitamin B12 und D3 ein.', 'Ein A4-Blatt reicht.', 'Siehe Bd. 2, S. 12.', 'Wir treffen uns am 3. Mai in Raum 2.', 'Die Firma heißt Le3 GmbH.', 'Das Spiel endete 2:1.']) {
      assert.strictEqual(C.hasChessNotation(t), false, t);
      assert.strictEqual(C.speakChess(t, 'de'), t, t);
    }
  });
  await test('chess tokens are recognised (for the junk detector and the splitter)', () => {
    for (const t of ['Sf3', 'exd5', '1.e4', '12...Sf6', '0-0', '0-0-0', 'e8=D+', '♘f3', '±', 'Lxf7+!', '(Sf3)', 'Txa7,']) assert(C.isChessToken(t), t);
    for (const t of ['Haus', 'B12', 'A4', '2019', 'S.', 'Sf']) assert(!C.isChessToken(t), t);
  });

  console.log('junk detector (tts-junk.js)');
  const NORMAL = {
    de: DE_TEXT, en: EN_TEXT,
    fr: 'Le petit prince était assis sur une pierre et regardait le ciel. Il pensait à sa rose, qui était restée seule sur sa planète, et il se demandait si elle avait froid pendant la nuit.',
    es: 'En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor.',
    toc: 'Inhalt Vorwort 7 Einleitung 9 Kapitel 1 Grundlagen 15 Kapitel 2 Die Eröffnung 43 Kapitel 3 Das Mittelspiel 89 Kapitel 4 Das Endspiel 131 Register 187 Literatur 191',
    bib: 'Müller, H. (2019): Grundlagen der Didaktik. Berlin: Springer. Schmidt, K.; Weber, J. (2020): Lernen im Alter. München: Beck. Wagner, P. (2018): Lesekompetenz. Stuttgart: Klett.',
    chess: 'Betrachten wir die Stellung nach 1. e4 e5 2. Sf3 Sc6 3. Lb5 a6 4. La4 Sf6 5. 0-0 Le7 6. Te1 b5 7. Lb3 d6 8. c3 0-0 9. h3 Sb8 10. d4 Sbd7 11. Sbd2 Lb7 12. Lc2 Te8',
    moves: CHESS_ONLY, figurine: '1. ♘f3 ♚e7 2. ♕e2#',
    numbers: 'Tabelle 3: 1990 4,5 % 1995 5,1 % 2000 6,0 % 2005 7,2 % 2010 8,4 %',
    names: 'Aachen, Bamberg, Chemnitz, Dresden, Erfurt, Frankfurt, Göttingen, Hamburg, Ingolstadt, Jena, Karlsruhe, Leipzig, München, Nürnberg, Oldenburg, Potsdam, Regensburg, Stuttgart, Trier, Ulm',
    caps: 'WLAN, DNA, USB und PDF sind Abkürzungen. Die NASA und die ESA arbeiten zusammen. McDonald und iPhone sind Namen.',
    short: 'Kapitel 3', footnote: 'Das ist ein Satz mit einer Fußnote¹ und ½ Liter Milch, 3 × 4 Meter groß.',
  };
  for (const [what, t] of Object.entries(NORMAL)) {
    await test(`no false alarm: ${what}`, () => { const r = J.inspectText(t); assert.strictEqual(r.junk, false, JSON.stringify(r)); });
  }
  await test('letters moved by a broken font map are junk, for every shift of German and English text', () => {
    const long = DE_TEXT + ' ' + DE_TEXT.split('').reverse().join('').replace(/[.,]/g, '') + ' ' + EN_TEXT;
    for (let k = 1; k < 26; k++) {
      for (const t of [long, EN_TEXT + ' ' + EN_TEXT]) { const r = J.inspectText(shift(t, k)); assert.strictEqual(r.junk, true, `shift ${k}: ${JSON.stringify(r)}`); }
    }
  });
  await test('private use characters, CJK from a broken map, control characters, symbols of a broken map are junk', () => {
    const pua = Array.from(DE_TEXT, (c) => (c === ' ' ? ' ' : String.fromCharCode(0xE000 + (c.charCodeAt(0) & 0xff)))).join('');
    const cjk = Array.from(DE_TEXT, (c) => (c === ' ' ? ' ' : String.fromCharCode(0x4E00 + c.charCodeAt(0) * 37))).join('');
    const ctrl = Array.from(DE_TEXT, (c) => (c === ' ' ? ' ' : String.fromCharCode(c.charCodeAt(0) % 30 + 1))).join('');
    for (const [what, t] of Object.entries({ pua, cjk, ctrl, latin1: 'ƒ*ªþ× ¦¸º ÞðÐ ¤¨÷ ªþ' })) assert.strictEqual(J.inspectText(t).junk, true, what);
  });
  await test('the rows of a chess diagram font and symbol rows are junk', () => {
    for (const t of ['!""""""""#', '$tMvWlVmT%', '$OoOoOoOo%', '$ + + + +%', '$pPpPpPpP%', '$RnBqKbNr%', '/(((((((()', '* * * * *', '———————']) assert.strictEqual(J.inspectText(t).junk, true, t);
  });

  console.log('the text of a PDF page (tts-pdf.js)');
  const item = (text, x, y, size = 11, w) => ({ text, x, y, w: w ?? text.length * size * 0.5, h: size, size });
  const page = { width: 595, height: 842 };
  const texts = (r) => r.paragraphs.map((p) => p.text);
  await test('words at line ends get a space, a heading stays its own paragraph, the page number goes', () => {
    const items = [item('Lesen am Fluss', 64, 100, 16), item('Wer an einem warmen Tag am Fluss sitzt, merkt, wie ruhig die', 64, 130), item('Gedanken werden. Das Wasser zieht vorbei.', 64, 145), item('12', 290, 800, 9)];
    const r = P.assemblePage(items, page);
    assert.deepStrictEqual(texts(r), ['Lesen am Fluss', 'Wer an einem warmen Tag am Fluss sitzt, merkt, wie ruhig die Gedanken werden. Das Wasser zieht vorbei.']);
    assert.deepStrictEqual(r.dropped, ['12']);
  });
  await test('hyphenated words are joined, a real hyphen before a capital and "Ein- und" stay', () => {
    const items = [item('Ein Nach-', 64, 100), item('mittag am Fluss und die Schach-', 64, 115), item('Bundesliga mit Ein- und', 64, 130), item('Ausgang.', 64, 145)];
    assert.deepStrictEqual(texts(P.assemblePage(items, page)), ['Ein Nachmittag am Fluss und die Schach-Bundesliga mit Ein- und Ausgang.']);
  });
  await test('two columns in a content stream that writes line by line across both: left column first', () => {
    const items = [];
    const left = ['Erste Spalte, Zeile eins mit Text', 'Erste Spalte, Zeile zwei mit Text', 'Erste Spalte, Zeile drei, Ende.'];
    const right = ['Zweite Spalte, Zeile eins mit Text', 'Zweite Spalte, Zeile zwei mit Text', 'Zweite Spalte, Zeile drei, Ende.'];
    for (let i = 0; i < 3; i++) { items.push(item(left[i], 64, 100 + i * 15, 11, 200)); items.push(item(right[i], 300, 100 + i * 15, 11, 200)); }
    assert.deepStrictEqual(texts(P.assemblePage(items, page)), [left.join(' '), right.join(' ')]);
  });
  await test('a move table in narrow columns is read row by row', () => {
    const items = [];
    const rows = [['1.', 'e4', 'e5'], ['2.', 'Sf3', 'Sc6'], ['3.', 'Lb5', 'a6']];
    rows.forEach((r, i) => r.forEach((t, k) => items.push(item(t, 64 + k * 40, 100 + i * 15, 11, 20))));
    assert.deepStrictEqual(texts(P.assemblePage(items, page)).join(' '), '1. e4 e5 2. Sf3 Sc6 3. Lb5 a6');
  });
  await test('a running head seen on an earlier page goes, the book title as a head goes, small footnote markers go', () => {
    const items = [item('Kapitel 2 · Am Wasser', 64, 52, 11), item('Ein Satz mit einer Fußnote', 64, 140), item('1', 200, 136, 6), item('und noch etwas Text danach.', 64, 155)];
    const r = P.assemblePage(items, page, { heads: new Set([P.headKey('Kapitel 1 · Am Wasser')]) });
    assert.deepStrictEqual(texts(r), ['Ein Satz mit einer Fußnote und noch etwas Text danach.']);
    const t = P.assemblePage([item('Lesen am Fluss', 64, 52, 11), item('Text auf der Seite, der vorgelesen wird.', 64, 140)], page, { title: 'Lesen am Fluss' });
    assert.deepStrictEqual(texts(t), ['Text auf der Seite, der vorgelesen wird.']);
  });
  await test('a heading at the top of the page stays, also when it is the title of the book', () => {
    const r = P.assemblePage([item('Lesen am Fluss', 64, 70, 16), item('Wer an einem warmen Tag am Fluss sitzt, liest.', 64, 110)], page, { title: 'Lesen am Fluss' });
    assert.deepStrictEqual(texts(r), ['Lesen am Fluss', 'Wer an einem warmen Tag am Fluss sitzt, liest.']);
  });
  await test('sentences keep the positions of their first and last character', () => {
    const items = [item('Der erste Satz endet hier. Der zwei-', 64, 100), item('te Satz geht weiter.', 64, 115)];
    const [para] = P.assemblePage(items, page).paragraphs;
    const s = P.paragraphSentences(para, 'de');
    assert.deepStrictEqual(s.map((x) => x.text), ['Der erste Satz endet hier.', 'Der zweite Satz geht weiter.']);
    assert.deepStrictEqual([s[0].start.item.text, s[0].start.offset, s[0].end.offset], ['Der erste Satz endet hier. Der zwei-', 0, 26]);
    assert.deepStrictEqual([s[1].start.offset, s[1].end.item.text, s[1].end.offset], [27, 'te Satz geht weiter.', 20]);
  });
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pdf-pages.json'), 'utf8')).pages;
  await test('pdf.js items: two columns written row by row come out column by column', () => {
    const r = P.assemblePage(fixture[0].items, fixture[0]);
    const all = texts(r).join(' ');
    assert(all.startsWith('Das Gartenjahr Im März beginnt das Gartenjahr. Die Erde ist noch kalt'), all.slice(0, 120));
    assert(all.indexOf('Im Mai kommen Tomaten') < all.indexOf('Der Sommer ist die Zeit des Gießens'), 'left column before the right one');
    assert(/Im Winter ruht der Garten\..*zu planen\.$/.test(all), all.slice(-120));
  });
  await test('pdf.js items: hyphenated line ends joined, page number left out', () => {
    const r = P.assemblePage(fixture[1].items, fixture[1]);
    const all = texts(r).join(' ');
    for (const w of ['Konzentration', 'Wortschatz', 'Nachmittag']) assert(all.includes(w), w);
    assert(!/\b(Konzentra|Wort)-/.test(all));
    assert.deepStrictEqual(r.dropped, ['1']);
    assert.strictEqual(texts(r)[0], 'Lesen am Fluss');
  });
  await test('pdf.js items: the running head of the second page is recognised (it is the book title)', () => {
    const r = P.assemblePage(fixture[2].items, fixture[2], { title: 'Lesen am Fluss' });
    assert.deepStrictEqual(r.dropped, ['Lesen am Fluss', '2']);
    assert(texts(r)[0].startsWith('Im Herbst wird es am Wasser schneller kühl.'));
  });
  await test('pdf.js items: the rows of the diagram font are left out, the caption and the text stay', () => {
    const r = P.assemblePage(fixture[3].items, fixture[3]);
    assert(r.dropped.includes('$tMvWlVmT%') && r.dropped.includes('$RnBqKbNr%'), JSON.stringify(r.dropped));
    const all = texts(r).join(' ');
    assert(!/[$%!"]/.test(all), all);
    assert(all.includes('Diagramm 1. Die Grundstellung') && all.includes('In der Grundstellung stehen alle Figuren'), all);
  });
}

module.exports = { run };
