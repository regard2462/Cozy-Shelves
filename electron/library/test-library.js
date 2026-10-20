// Tests for the library backend: fixed department taxonomy, keyword classification,
// pre-sorted folders, scanner/indexer edge cases and the JSON store.
// Plain Node – no Electron, no network.  Run:  node electron/library/test-library.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { Library, titleFromFilename, authorFromFilename, localDay, watchIgnored, isChessBook } = require('./library');
const { classify, countHits, departmentIdFromFolder, findTaxonomyByName, lookupOnline } = require('./classify');
const { TAXONOMY, DEPARTMENTS, departmentById, legacyDepartmentId } = require('./taxonomy');
const { Store, deepDefaults } = require('../store');
const { rtfToText, extractTextAndMeta } = require('./textformats');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); }
}

// --- the corpus -----------------------------------------------------------------------------------
// [filename, expected department id | [acceptable ids]]: plausible German and English books, invented or public domain.
const CORPUS = [
  // Romane & Erzählungen
  ['Die Buddenbrooks - Verfall einer Familie.epub', ['fiction', 'poetry']],
  ['Effi Briest - Ein Roman.epub', 'fiction'],
  ['Der Lotse von Nebelstein - Roman.epub', 'fiction'],
  ['Sommer an der Oder - Roman.epub', ['fiction', 'kids']],
  ['Anna Karenina - Roman in acht Teilen.epub', 'fiction'],
  ['Great Expectations - A Novel.epub', 'fiction'],
  ['Harbour Lights - A Novel by Mabel Thornquist.epub', 'fiction'],
  ['Das Mädchen, das Wolken zählte - Roman.epub', 'fiction'],
  ['Kurzgeschichten aus Kanada - Erzählungen.epub', 'fiction'],
  ['Middlemarch - A Study of Provincial Life, a Novel.epub', 'fiction'],
  // Krimi & Thriller
  ['Der Fall Wendler - Kriminalroman.epub', 'crime'],
  ['Mordkommission Rhein - Ein Kommissar Berger Krimi.epub', 'crime'],
  ['Eisnebel - Ein Fjord-Thriller.epub', 'crime'],
  ['The Girl in the Lighthouse - A Thriller.epub', 'crime'],
  ['The Murder at Hollow Oak Station.epub', 'crime'],
  ['Der Alpen-Krimi - Tod am Watzmann.epub', 'crime'],
  ['Sherlock Holmes - The Complete Stories.epub', 'crime'],
  ['Spionage in Berlin - Ein Agententhriller.epub', 'crime'],
  ['True Crime - Die spektakulärsten Kriminalfälle.epub', 'crime'],
  ['Der Psychothriller - Nachtangst.epub', 'crime'],
  // Fantasy & Science-Fiction
  ['Der Drachenhort oder Hin und zurück.epub', 'fantasy'],
  ['Die Zwerge vom Nebelstein - Ein Fantasy-Roman.epub', 'fantasy'],
  ['Sandmeer - Ein Raumschiff-Roman.epub', 'fantasy'],
  ['The War of the Worlds - Science Fiction.epub', 'fantasy'],
  ['Die Mauern von Morland - Dystopie.epub', 'fantasy'],
  ['Neonregen - Cyberpunk Klassiker.epub', 'fantasy'],
  ['Die zwei Monde - Science Fiction aus Korea.epub', 'fantasy'],
  ['Der Zauberer vom Nebelmoor - Fantasy.epub', 'fantasy'],
  ['Zeitreise nach Avalon - Fantasy Roman.epub', 'fantasy'],
  ['The Glass Republic - A Dystopian Novel.epub', ['fantasy', 'fiction']],
  // Lyrik, Drama & Klassiker
  ['Faust - Eine Tragödie.epub', 'poetry'],
  ['Gesammelte Gedichte von Rainer Maria Rilke.epub', 'poetry'],
  ['Die Räuber - Ein Schauspiel.epub', 'poetry'],
  ['Hamlet - Prince of Denmark, a Tragedy.epub', 'poetry'],
  ['Deutsche Lyrik - Eine Anthologie.epub', 'poetry'],
  ['Die Ilias - Versepos.epub', 'poetry'],
  ['Antigone - Drama in einem Akt.epub', 'poetry'],
  ['Sämtliche Werke - Heinrich Heine.epub', 'poetry'],
  ['Der zerbrochne Krug - Ein Lustspiel.epub', ['poetry', 'misc']],
  ['Leaves of Grass - Poems.epub', 'poetry'],
  // Geschichte
  ['Der Zweite Weltkrieg - Eine Gesamtdarstellung.pdf', 'history'],
  ['Geschichte des Römischen Reiches.pdf', 'history'],
  ['Die Weimarer Republik 1918-1933.pdf', 'history'],
  ['A Brief History of the Northern Seas.epub', 'history'],
  ['The Art of Siege Warfare.pdf', 'history'],
  ['Vom Festungskrieg - Eine Militärgeschichte.pdf', 'history'],
  ['Das Mittelalter - Alltag und Herrschaft.pdf', 'history'],
  ['Die Schlacht von Stalingrad.pdf', 'history'],
  ['Die Hanse - Geschichte eines Städtebundes.pdf', 'history'],
  ['A History of the Cold War.epub', 'history'],
  ['Archäologie des Alten Ägypten.pdf', 'history'],
  // Politik & Gesellschaft
  ['Wie Demokratien sich erneuern.epub', 'society'],
  ['Die Gesellschaft der Pendler - Soziologie.epub', 'society'],
  ['Geopolitik der Gegenwart - Weltordnung im Wandel.pdf', 'society'],
  ['Propaganda und öffentliche Meinung.pdf', 'society'],
  ['Diplomatie - Staatskunst von Metternich bis heute.pdf', 'society'],
  ['Das Grundgesetz - Verfassung und Rechtsstaat.pdf', 'society'],
  ['Foreign Policy and International Relations.pdf', 'society'],
  ['Migration und Integration in Europa.pdf', 'society'],
  ['Feminismus heute - Eine Streitschrift.epub', 'society'],
  ['Medien und Desinformation im Netz.pdf', ['society', 'technology']],
  // Philosophie & Religion
  ['Kritik der reinen Vernunft.pdf', 'philosophy'],
  ['Also sprach Zarathustra - Friedrich Nietzsche.epub', ['philosophy', 'poetry']],
  ['Selbstbetrachtungen - Marc Aurel.epub', 'philosophy'],
  ['Die Bibel - Altes und Neues Testament.epub', 'philosophy'],
  ['Einführung in die Ethik.pdf', 'philosophy'],
  ['Der Stoizismus als Lebenskunst.epub', 'philosophy'],
  ['Meditation und Achtsamkeit im Buddhismus.epub', ['philosophy', 'psychology']],
  ['Platons Politeia - Eine Interpretation.pdf', 'philosophy'],
  ['Die Welt als Wille und Vorstellung - Arthur Schopenhauer.pdf', 'philosophy'],
  ['A Short History of Ancient Philosophy.epub', 'philosophy'],
  // Psychologie & Lebenskunst
  ['Better Habits - Small Steps, Lasting Change.epub', 'psychology'],
  ['Die 5 Schritte zur Gelassenheit - Persönlichkeitsentwicklung.epub', 'psychology'],
  ['Denkfallen im Alltag - Psychologie der Entscheidung.epub', 'psychology'],
  ['Körpersprache entschlüsseln - Menschenkenntnis.epub', 'psychology'],
  ['Verhandeln mit Erfolg - Negotiation.pdf', 'psychology'],
  ['Resilienz - Wie wir Krisen meistern.epub', 'psychology'],
  ['Ungestört arbeiten - Psychologie der Konzentration.epub', 'psychology'],
  ['Bindung und Beziehung in der Partnerschaft.epub', 'psychology'],
  ['Rhetorik für Führungskräfte - Leadership.pdf', 'psychology'],
  ['Trauma und Therapie - Ein Handbuch.pdf', ['psychology', 'language']],
  // Wissenschaft & Natur
  ['Eine kurze Geschichte des Lichts - Physik für alle.epub', ['science', 'history']],
  ['Das stille Leben im Wald - Ein Naturbuch.epub', 'science'],
  ['Quantenphysik für Einsteiger.pdf', 'science'],
  ['Evolution - Darwins Erbe.pdf', 'science'],
  ['Der Kosmos - Eine Reise durch das Universum.epub', ['science', 'travel']],
  ['Klimawandel - Fakten und Folgen.pdf', 'science'],
  ['Anatomie des Menschen - Lehrbuch der Medizin.pdf', 'science'],
  ['Die Vögel Mitteleuropas - Ein Naturführer.pdf', 'science'],
  ['Mathematik für Naturwissenschaftler.pdf', 'science'],
  ['The Restless Gene - Evolution and Biology.epub', 'science'],
  ['Insektensterben - Ökologie einer Krise.pdf', 'science'],
  // Technik & Informatik
  ['Tidy Programs - A Handbook of Software Craftsmanship.pdf', 'technology'],
  ['Python für Einsteiger - Programmieren lernen.pdf', 'technology'],
  ['Einführung in Algorithmen und Datenstrukturen.pdf', 'technology'],
  ['Linux Serveradministration - Das Handbuch.pdf', 'technology'],
  ['Maschinelles Lernen mit Python - Praxisbuch.pdf', 'technology'],
  ['Privatsphäre im Netz - Datenschutz für alle.epub', 'technology'],
  ['Kryptografie und Verschlüsselung verstehen.pdf', 'technology'],
  ['Hacking für Einsteiger - Sicherheit im Netz.pdf', 'technology'],
  ['Datenbanken und SQL - Grundlagen.pdf', 'technology'],
  ['Elektronik für Maker mit Arduino.pdf', 'technology'],
  ['The Patient Programmer.epub', 'technology'],
  // Wirtschaft & Finanzen
  ['Der geduldige Investor - Langfristig anlegen.pdf', 'business'],
  ['Gelassen investieren mit Indexfonds und ETFs.pdf', 'business'],
  ['Aktien und Börse verstehen - Geld anlegen.epub', 'business'],
  ['Chartanalyse - Aktien und Börse für Anleger.pdf', 'business'],
  ['Volkswirtschaftslehre - Eine Einführung.pdf', 'business'],
  ['Geldanlage für Familien - Was Eltern über Finanzen wissen sollten.epub', ['business', 'psychology']],
  ['Die Finanzkrise 2008 - Chronik eines Crashs.pdf', 'business'],
  ['Unternehmensbewertung und Bilanzanalyse.pdf', 'business'],
  ['Startup Marketing - Vom Gründer zum Unternehmen.pdf', 'business'],
  ['Betting on Probabilities - Investing and Decision Making.epub', ['business', 'psychology']],
  // Kunst, Musik & Design
  ['Kunstgeschichte - Von der Antike bis zur Moderne.pdf', 'art'],
  ['Aquarellmalerei - Techniken und Motive.pdf', 'art'],
  ['Bauhaus - Architektur und Design.pdf', 'art'],
  ['Die Fotografie - Handbuch der Bildgestaltung.pdf', 'art'],
  ['Harmonielehre für Musiker.pdf', 'art'],
  ['Vincent van Gogh - Die Gemälde.pdf', 'art'],
  ['Typografie und Grafikdesign.pdf', 'art'],
  ['Der Film - Regie und Drehbuch.pdf', 'art'],
  ['Klavierschule für Erwachsene.pdf', 'art'],
  ['Modern Architecture - A Short Survey.pdf', 'art'],
  // Biografien & Erinnerungen
  ['Ada Lovelace - Eine Biografie.epub', 'biography'],
  ['Mein Leben - Autobiografie.epub', 'biography'],
  ['Tagebuch eines Landarztes 1890.epub', 'biography'],
  ['Marie Curie - Eine Biographie.epub', 'biography'],
  ['Erinnerungen eines Bergsteigers - Memoiren.epub', 'biography'],
  ['Afterwards - A Memoir.epub', 'biography'],
  ['Briefe an einen jungen Dichter.epub', ['biography', 'poetry']],
  ['Das Leben des Galileo Galilei - Biographie.pdf', 'biography'],
  ['Konrad Adenauer - Biographie eines Kanzlers.pdf', 'biography'],
  ['A Long Walk Home - An Autobiography.epub', 'biography'],
  // Gesundheit, Sport & Küche
  ['Das große Kochbuch der deutschen Küche.pdf', 'health'],
  ['Brot backen wie der Bäcker.pdf', 'health'],
  ['Krafttraining - Der Trainingsplan für Einsteiger.pdf', 'health'],
  ['Laufen - Vom Anfänger zum Marathon.pdf', 'health'],
  ['Vegane Ernährung im Alltag.epub', 'health'],
  ['Yoga für den Rücken.pdf', 'health'],
  ['Intervallfasten - Gesund abnehmen.epub', 'health'],
  ['Der Gemüsegarten - Selbstversorgung im Jahreslauf.pdf', 'health'],
  ['Einkochen und Fermentieren - Vorräte anlegen.pdf', 'health'],
  ['The Joy of Baking Bread - Recipes.epub', 'health'],
  // Reisen & Länder
  ['Japan - Reiseführer für Einsteiger.pdf', 'travel'],
  ['Toskana - Reiseführer Italien.pdf', 'travel'],
  ['Wandern in den Alpen - Die schönsten Touren.pdf', 'travel'],
  ['Der Jakobsweg - Ein Reisebericht.epub', 'travel'],
  ['Survival - Überleben in der Wildnis.pdf', 'travel'],
  ['Bushcraft Handbuch - Draußen zu Hause.pdf', 'travel'],
  ['Mit dem Wohnmobil durch Norwegen.pdf', 'travel'],
  ['Patagonien - Expedition ans Ende der Welt.epub', 'travel'],
  ['Island - Reisen zu Vulkanen und Gletschern.pdf', ['travel', 'science']],
  ['Camping und Zelten mit Kindern.pdf', 'travel'],
  // Sprache & Nachschlagewerke
  ['Die deutsche Rechtschreibung - Regeln und Wörterbuch.pdf', 'language'],
  ['Englisch lernen für Anfänger - Sprachkurs.pdf', 'language'],
  ['Wörterbuch Spanisch-Deutsch.pdf', 'language'],
  ['Lateinische Grammatik - Ein Lehrbuch.pdf', 'language'],
  ['Kreatives Schreiben - Handbuch für Autoren.pdf', 'language'],
  ['Das große Lexikon des Allgemeinwissens.pdf', 'language'],
  ['Einführung in die Linguistik.pdf', 'language'],
  ['Japanisch für Reisende - Sprachführer.pdf', ['language', 'travel']],
  ['Das kleine Wörterbuch der Redewendungen.pdf', 'language'],
  ['English Dictionary - Concise Edition.pdf', 'language'],
  // Kinder & Jugend
  ['Die kleine Seejungfrau - Hans Christian Andersen.epub', 'kids'],
  ['Die Wolkenkinder fliegen zum Mond - Kinderbuch.epub', 'kids'],
  ['Grimms Märchen - Gesammelte Ausgabe.epub', 'kids'],
  ['Lotta und der Zauberstein - Kinderbuch ab 8.epub', 'kids'],
  ['Das Bilderbuch vom kleinen Bären - ab 3 Jahren.pdf', 'kids'],
  ['Erstlesebuch - Lesen lernen ab 6 Jahren.pdf', 'kids'],
  ['Jugendbuch - Sommer am See, ab 12 Jahren.epub', 'kids'],
  ['Gute Nacht Geschichten zum Vorlesen.epub', 'kids'],
  ['Frag mal - Wissen für Kinder.pdf', 'kids'],
  ['The Little Lighthouse - A Children\'s Classic.epub', 'kids'],
  // Comics & Graphic Novels
  ['Kapitän Kork und der Nebelschatz - Comic.pdf', 'comics'],
  ['Pip und Paul - Der blaue Hafen, Comic.pdf', 'comics'],
  ['Nightwatchers - Graphic Novel.pdf', 'comics'],
  ['Wolkenpiraten Band 1 - Manga.pdf', 'comics'],
  ['The Masked Owl - A Graphic Novel.pdf', 'comics'],
  ['Eine Kindheit am Meer, Graphic Novel.pdf', 'comics'],
  ['Max and the Tiger - The Complete Comic Strips.pdf', 'comics'],
  ['Cowboy Kurt - Der Weiße Ritter, Comic.pdf', 'comics'],
  ['Schattenninja Band 3 - Manga.pdf', 'comics'],
  ['Bunte Comics - Sammelband.pdf', 'comics'],
  // Spiele & Schach
  ['Positionsspiel - Schachstrategie für Vereinsspieler.pdf', 'games'],
  ['Schachtaktik für Fortgeschrittene.pdf', 'games'],
  ['Die Sizilianische Verteidigung - Eröffnungsrepertoire.pdf', 'games'],
  ['Endspieltraining für Vereinsspieler - Schach.pdf', 'games'],
  ['Die besten Schachpartien von Adolf Anderssen.pdf', 'games'],
  ['Schach für Kinder - Spielend lernen.pdf', ['games', 'kids']],
  ['Poker - Texas Hold\'em Strategie.pdf', 'games'],
  ['Brettspiele selbst entwickeln - Game Design.pdf', 'games'],
  ['Das große Buch der Denksport-Rätsel.pdf', 'games'],
  ['Skat und Doppelkopf - Die Spielregeln.pdf', 'games'],
  ['Chess Fundamentals - Capablanca.pdf', 'games'],
];

const SUBJECT_HINTS = {};   // no online data in this test: title + filename only

(async () => {
  console.log('taxonomy');
  await test('the department set is fixed, ordered and complete', () => {
    assert.strictEqual(DEPARTMENTS.length, 20, 'department count ' + DEPARTMENTS.length);
    assert.deepStrictEqual(DEPARTMENTS.map((d) => d.id), TAXONOMY.map((t) => t.id));
    const ids = new Set();
    for (const t of TAXONOMY) {
      assert(!ids.has(t.id), 'duplicate id ' + t.id); ids.add(t.id);
      assert(t.de && t.en, 'missing label ' + t.id);
      assert(Array.isArray(t.aliases) && Array.isArray(t.keywords) && Array.isArray(t.shelves));
      for (const kw of t.keywords) assert(kw.trim().length >= 4, `keyword too short in ${t.id}: "${kw}"`);
      for (const kw of t.keywords) assert(kw === kw.trim() && kw === kw.toLowerCase(), `keyword not normalized in ${t.id}: "${kw}"`);
      for (const [name, kws] of t.shelves) { assert(typeof name === 'string' && name, t.id); assert(Array.isArray(kws) && kws.length, name); }
    }
    assert.strictEqual(DEPARTMENTS[DEPARTMENTS.length - 1].id, 'misc', 'Verschiedenes must stay last');
    assert.deepStrictEqual(DEPARTMENTS.map((d) => d.id), ['fiction', 'crime', 'fantasy', 'poetry', 'history', 'society', 'philosophy', 'psychology', 'science', 'technology', 'business', 'art', 'biography', 'health', 'travel', 'language', 'kids', 'comics', 'games', 'misc']);
  });

  await test('department names of earlier versions map into the fixed set, unknown names do not', () => {
    const cases = {
      'Technik & Programmierung': 'technology', 'Kunst, Architektur & Design': 'art', Biografien: 'biography',
      'Sprachen & Wörterbücher': 'language', Neuzugänge: 'misc', 'Verschiedenes': 'misc',
    };
    for (const [from, to] of Object.entries(cases)) assert.strictEqual(legacyDepartmentId(from), to, from);
    for (const d of DEPARTMENTS) assert.strictEqual(legacyDepartmentId(d.de), d.id, d.de);
    assert.strictEqual(legacyDepartmentId('Völlig eigener Ordner'), null);
  });

  console.log('classification');
  await test('word boundaries: short keywords no longer match inside words', () => {
    // the old scorer padded keywords with spaces – "The Art of Siege Warfare" ended up in Kunst
    const art = classify({ title: 'The Art of Siege Warfare', relPath: 'The Art of Siege Warfare.pdf' });
    assert.strictEqual(art.departmentId, 'history', JSON.stringify(art));
    assert.strictEqual(countHits('die operation gelang', 'oper', 3), 0, '"oper" must not match "operation"');
    assert.strictEqual(countHits('ein abend in der oper', 'oper', 3), 1);
    assert.strictEqual(countHits('schachtaktik im mittelspiel', 'schach', 3), 1, 'German compounds must still match');
    assert.strictEqual(countHits('menschenkunst', 'kunst', 3), 0, 'no match inside a compound tail');
    assert.strictEqual(countHits('kunstgeschichte der moderne', 'kunst', 3), 1);
  });

  await test('longer / multi-word keywords weigh more than short ones', () => {
    const { weightOf } = require('./classify');
    assert(weightOf('value investing') > weightOf('aktien'));
    assert(weightOf('künstliche intelligenz') > weightOf('cloud'));
    assert(weightOf('etf') < weightOf('fundamentalanalyse'));
  });

  await test(`corpus of ${CORPUS.length} book filenames is classified sensibly`, () => {
    const wrong = [];
    const perDep = {};
    for (const [file, expected] of CORPUS) {
      const acceptable = Array.isArray(expected) ? expected : [expected];
      const relPath = file;
      const res = classify({ title: titleFromFilename(file), author: authorFromFilename(file), relPath, subjects: SUBJECT_HINTS[file] || [] });
      perDep[res.departmentId] = (perDep[res.departmentId] || 0) + 1;
      if (!acceptable.includes(res.departmentId)) wrong.push(`${file} → ${res.departmentId} (erwartet ${acceptable.join('|')})`);
    }
    const hit = CORPUS.length - wrong.length;
    const rate = hit / CORPUS.length;
    console.log(`       ${hit}/${CORPUS.length} korrekt einsortiert (${(rate * 100).toFixed(1)} %)`);
    if (wrong.length) console.log(wrong.map((w) => '        · ' + w).join('\n'));
    assert(rate >= 0.9, `classification accuracy ${(rate * 100).toFixed(1)} %`);
    assert((perDep.misc || 0) <= CORPUS.length * 0.08, `${perDep.misc} books fell through to Verschiedenes`);
  });

  await test('classification is stable (same input → same department, order-independent)', () => {
    for (const [file] of CORPUS.slice(0, 40)) {
      const a = classify({ title: titleFromFilename(file), relPath: file });
      const b = classify({ title: titleFromFilename(file), relPath: file });
      assert.strictEqual(a.departmentId, b.departmentId, file);
      assert.strictEqual(a.shelf, b.shelf, file);
    }
  });

  await test('shelves come from the taxonomy of the chosen department', () => {
    const r = classify({ title: 'Die Sizilianische Verteidigung - Eröffnungsrepertoire', relPath: 'x.pdf' });
    assert.strictEqual(r.departmentId, 'games');
    assert.strictEqual(r.shelf, 'Schach · Eröffnungen', r.shelf);
    const k = classify({ title: 'Brot backen wie der Bäcker', relPath: 'x.pdf' });
    assert.strictEqual(k.shelf, 'Kochen & Backen', k.shelf);
  });

  await test('folder names map into the fixed set (aliases, names of earlier versions, unknown → misc)', () => {
    assert.strictEqual(departmentIdFromFolder('01 Schach'), 'games');
    assert.strictEqual(departmentIdFromFolder('Wandern & Draußen'), 'travel');
    assert.strictEqual(departmentIdFromFolder('Informatik'), 'technology');
    assert.strictEqual(departmentIdFromFolder('Biografien'), 'biography');
    assert.strictEqual(departmentIdFromFolder('Kochbücher'), 'health');
    assert.strictEqual(departmentIdFromFolder('Reiseführer'), 'travel');
    assert.strictEqual(departmentIdFromFolder('Hörbücher von Oma'), 'misc');
    assert.strictEqual(findTaxonomyByName('Schach').id, 'games');
  });

  await test('lookupOnline distinguishes "nothing found" from "service unreachable"', async () => {
    const C = require('../feeds/common');
    const realFetch = C.fetchText;
    C.fetchText = async () => { throw new Error('ENOTFOUND openlibrary.org'); };
    try {
      await assert.rejects(() => lookupOnline({ isbn: '9783161484100', title: 'Irgendein Buch' }), /reachable|ENOTFOUND/);
      C.fetchText = async () => ({ ok: true, status: 200, text: '{}' });
      const out = await lookupOnline({ isbn: '9783161484100', title: 'Irgendein Buch' });
      assert.strictEqual(out.source, null);
      assert.strictEqual(out.checked, true, 'a real "not found" is cacheable');
    } finally { C.fetchText = realFetch; }
  });

  console.log('filenames');
  await test('titleFromFilename keeps subtitles and only strips real author tails', () => {
    assert.strictEqual(titleFromFilename('Walden - Life in the Woods.pdf'), 'Walden - Life in the Woods');
    assert.strictEqual(titleFromFilename('Der Graf von Monte Christo - Alexandre Dumas.epub'), 'Der Graf von Monte Christo');
    assert.strictEqual(titleFromFilename('Moby-Dick - The Whale, a Novel.pdf'), 'Moby-Dick - The Whale, a Novel');
    assert.strictEqual(titleFromFilename('Effi Briest - Theodor Fontane.pdf'), 'Effi Briest');
    assert.strictEqual(titleFromFilename('Der Schimmelreiter -- Theodor Storm -- 1888 -- Paetel -- 0123456789abcdef0123456789abcdef -- Example Archive.epub'), 'Der Schimmelreiter');
    assert.strictEqual(authorFromFilename('Der Schimmelreiter -- Theodor Storm -- 1888 -- Paetel -- 0123456789abcdef0123456789abcdef -- Example Archive.epub'), 'Theodor Storm');
    assert.strictEqual(titleFromFilename('Der Schimmelreiter (example.org).epub'), 'Der Schimmelreiter', 'a download site\'s note');
    assert.strictEqual(titleFromFilename('Reisebilder (St.Gallen).epub'), 'Reisebilder (St.Gallen)', 'a place in brackets stays');
    assert.strictEqual(titleFromFilename('Effi_Briest.epub'), 'Effi Briest');
    assert.strictEqual(authorFromFilename('Der Graf von Monte Christo - Alexandre Dumas.epub'), 'Alexandre Dumas');
    assert.strictEqual(authorFromFilename('Walden - Life in the Woods.pdf'), null);
  });

  await test('chess books: folder, title or move notation, never the department "Spiele & Schach" alone', () => {
    assert(isChessBook({ title: 'Fernschach für Einsteiger' }));
    assert(isChessBook({ title: 'Studien 1', relPath: 'Schach/01 Eroeffnungen/Studien 1.pdf', department: 'Spiele & Schach' }));
    assert(isChessBook({ title: 'Positionsspiel' }, '1. e4 e5 2. Sf3 Sc6 3. Lb5 a6 4. La4 Sf6'));
    assert(!isChessBook({ title: 'Poker für Anfänger', relPath: 'Spiele/Poker.pdf', department: 'Spiele & Schach' }));
    assert(!isChessBook({ title: 'Die Schachtel' }));
    assert(!isChessBook({ title: 'Ein Roman' }, 'Er kam am 1. Mai an, am 3. Tag regnete es.'));
  });

  console.log('text formats');
  await test('RTF: umlauts (\\\'hh, \\uN), paragraphs, info group; tables and fields are not text', () => {
    const rtf = String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fswiss Arial;}{\f1 Times;}}{\colortbl ;\red0\green0\blue0;}` +
      String.raw`{\info{\title Ein Brief \'fcber B\'fccher}{\author Anna B\'e4r}}{\*\generator Riched20}\uc1\pard\b Gr\u252\'fc\u223\'dfe\b0\par ` +
      String.raw`Zweite Zeile mit \u8222?Zitat\u8220? und \'80.\line Umbruch{\field{\*\fldinst HYPERLINK "x"}{\fldrslt Linktext}}\par}`;
    const { text, info } = rtfToText(rtf);
    assert.strictEqual(info.title, 'Ein Brief über Bücher');
    assert.strictEqual(info.author, 'Anna Bär');
    assert(text.startsWith('Grüße\nZweite Zeile mit „Zitat“ und €.\nUmbruch'), JSON.stringify(text));
    assert(!/Arial|Times|Riched|HYPERLINK|\\|[{}]/.test(text), 'control data leaked: ' + JSON.stringify(text));
  });
  await test('DOCX: raw text and core properties (title, creator, language) for the text sample', async () => {
    const JSZip = require('jszip');
    const tmpd = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-docx-'));
    const file = path.join(tmpd, 'bericht.docx');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('docProps/core.xml', '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Ein Bericht &amp; mehr</dc:title><dc:creator>Hanna Muster</dc:creator><dc:language>de-DE</dc:language></cp:coreProperties>');
    zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Erster Absatz über Straßen.</w:t></w:r></w:p><w:p><w:r><w:t>Zweiter Absatz.</w:t></w:r></w:p></w:body></w:document>');
    fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
    const r = await extractTextAndMeta(file, 'docx');
    assert.strictEqual(r.metadata.title, 'Ein Bericht & mehr');
    assert.strictEqual(r.metadata.author, 'Hanna Muster');
    assert.strictEqual(r.metadata.language, 'de');
    assert(/Erster Absatz über Straßen\.\s+Zweiter Absatz\./.test(r.text), JSON.stringify(r.text));
    fs.rmSync(tmpd, { recursive: true, force: true });
  });

  console.log('store');
  await test('Store deep-merges nested defaults (new settings keys reach existing users)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-store-'));
    const file = path.join(tmp, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ language: 'de', reader: { fontSize: 19 } }));
    const s = new Store(file, { language: 'de', reader: { fontSize: 18, font: 'garamond', margin: 'normal' }, graphics: { fov: 72 } });
    assert.deepStrictEqual(s.get('reader'), { fontSize: 19, font: 'garamond', margin: 'normal' });
    assert.deepStrictEqual(s.get('graphics'), { fov: 72 });
    assert.deepStrictEqual(deepDefaults({ a: { b: 1 } }, { a: { c: 2 } }), { a: { b: 1, c: 2 } });
    assert.deepStrictEqual(deepDefaults({ a: [1, 2] }, { a: [3] }), { a: [3] }, 'arrays are replaced, not merged');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await test('Store flushes at the latest after the max wait, and writes compact JSON', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-store-'));
    const file = path.join(tmp, 'db.json');
    const s = new Store(file, { books: {} });
    const t0 = Date.now();
    while (Date.now() - t0 < 3200) { s.set('books', { ...s.get('books'), ['k' + Date.now()]: 1 }); await new Promise((r) => setTimeout(r, 50)); }
    assert(fs.existsSync(file), 'a continuous stream of writes postponed the flush forever');
    const raw = fs.readFileSync(file, 'utf8');
    assert(!/\n /.test(raw), 'library.json must not be pretty-printed');
    s.flush();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  console.log('scanner');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-lib-'));
  const userData = path.join(tmp, 'userData');
  const booksRoot = path.join(tmp, 'Buecher');
  fs.mkdirSync(userData, { recursive: true });
  const write = (rel, text) => {
    const p = path.join(booksRoot, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, (text || 'x').padEnd(2048, ' '));
    return p;
  };
  // a pre-sorted library as users have them: own top folders, own sub folders
  write('01 Musik/Klavier/Klavierschule.pdf', 'musik');
  write('01 Musik/Grundlagen/Noten lesen.pdf', 'musik');
  write('Schach/Eröffnungen/Sizilianisch.pdf', 'schach');
  write('Wandern & Draußen/Wasser/Wasser filtern.pdf', 'wandern');
  write('Kochbücher/Italien/Pasta Grundrezepte.pdf', 'kochen');
  write('Völlig eigener Ordner/Notizen.pdf', 'sonst');
  write('Romane/Die Buddenbrooks.epub', 'roman');
  const jobs = [];
  const events = [];
  const settings = { get: (k) => (k === 'folders' ? [{ path: booksRoot, mode: 'structured' }] : null) };
  const lib = new Library({
    userData, settings, emit: (ch, p) => events.push([ch, p]),
    getIndexer: () => ({ webContents: { send: (ch, job) => jobs.push(job) } }),
  });
  await lib.scanAll();

  await test('every top-level folder of a pre-sorted library is a department of its own, sub folders are shelves', () => {
    const byName = {};
    for (const b of Object.values(lib.books)) byName[path.basename(b.path)] = b;
    const musik = byName['Klavierschule.pdf'];
    assert.strictEqual(musik.departmentId, 'folder:musik');
    assert.strictEqual(musik.department, 'Musik', 'the numbering is not part of the name');
    assert.strictEqual(musik.departmentEn, 'Musik');
    assert.strictEqual(musik.departmentKey, '01 Musik', 'the raw folder name orders the departments');
    assert.strictEqual(musik.shelf, 'Klavier', 'the user sub folder becomes the shelf');
    assert.strictEqual(musik.departmentSource, 'folder');
    assert.strictEqual(byName['Noten lesen.pdf'].shelf, 'Grundlagen');
    assert.strictEqual(byName['Sizilianisch.pdf'].departmentId, 'folder:schach');
    assert.strictEqual(byName['Wasser filtern.pdf'].department, 'Wandern & Draußen', 'no mapping into the taxonomy ("Reisen & Länder")');
    assert.strictEqual(byName['Wasser filtern.pdf'].shelf, 'Wasser');
    assert.strictEqual(byName['Pasta Grundrezepte.pdf'].departmentId, 'folder:kochbücher');
    assert.strictEqual(byName['Die Buddenbrooks.epub'].departmentId, 'folder:romane');
    assert.strictEqual(byName['Die Buddenbrooks.epub'].shelf, null, 'a file directly in the top folder has no second label with the department name');
    assert.strictEqual(byName['Notizen.pdf'].department, 'Völlig eigener Ordner', 'an unknown folder is a department as well');
    const romane = lib.getState().departments.find((d) => d.id === 'folder:romane');
    assert.deepStrictEqual(romane.shelves.map((s) => [s.name, !!s.neutral]), [['Romane', true]], 'the loose books form the neutral shelf');
    assert.strictEqual(romane.kind, 'folder');
  });

  await test('departments follow the natural order of the folder names, never the book count', async () => {
    const state = lib.getState();
    const order = state.departments.map((d) => d.name);
    const expected = ['Musik', 'Kochbücher', 'Romane', 'Schach', 'Völlig eigener Ordner', 'Wandern & Draußen'];
    assert.deepStrictEqual(order, expected, order.join(','));
    // add a pile of books to the last department and check the order does not move
    for (let i = 0; i < 25; i++) write('Völlig eigener Ordner/Notiz ' + i + '.pdf', 'n' + i);
    await lib.rescanQuiet();
    const after = lib.getState().departments.map((d) => d.name);
    assert.deepStrictEqual(after, expected, 'the 3D rooms would have reshuffled: ' + after.join(','));
    assert(lib.getState().departments.every((d) => d.count > 0 && Array.isArray(d.shelves)));
  });

  await test('an unavailable folder does not mark the whole library missing', async () => {
    const before = lib.getState().books.length;
    const stash = booksRoot + '-offline';
    fs.renameSync(booksRoot, stash);
    await lib.rescanQuiet();
    assert.strictEqual(lib.getState().books.length, before, 'books vanished when the folder went offline');
    assert(lib.scanState.unavailable.includes(booksRoot), 'the UI is not told the folder is unreachable');
    fs.renameSync(stash, booksRoot);
    await lib.rescanQuiet();
    assert.strictEqual(lib.getState().books.length, before);
  });

  await test('a deleted book is marked missing once the folder is readable again', async () => {
    const victim = path.join(booksRoot, 'Romane', 'Die Buddenbrooks.epub');
    const id = Object.values(lib.books).find((b) => b.path === victim).id;
    fs.rmSync(victim);
    await lib.rescanQuiet();
    assert.strictEqual(lib.books[id].missing, true);
    assert(lib.books[id].missingSince > 0, 'missingSince is needed to purge old records');
  });

  await test('a moved book keeps its reading state (content hash, not just the file name)', async () => {
    const src = path.join(booksRoot, 'Schach', 'Eröffnungen', 'Sizilianisch.pdf');
    const old = Object.values(lib.books).find((b) => b.path === src);
    old.progress = 0.42; old.bookmarks = [{ id: 'b1', label: 'Seite 12' }]; old.readingSeconds = 900;
    // a decoy with the same name but different content
    write('Schach/Kopien/Sizilianisch.pdf', 'ein voellig anderer inhalt mit anderer laenge ' + 'z'.repeat(500));
    await lib.rescanQuiet();
    const dst = path.join(booksRoot, 'Schach', 'Klassiker', 'Sizilianisch.pdf');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    await lib.rescanQuiet();
    const moved = Object.values(lib.books).find((b) => b.path === dst);
    assert(moved, 'moved book not found');
    assert.strictEqual(moved.progress, 0.42);
    assert.strictEqual(moved.readingSeconds, 900);
    assert.strictEqual(moved.shelf, 'Klassiker', 'the shelf follows the new folder');
    const decoy = Object.values(lib.books).find((b) => b.path.includes('Kopien'));
    assert.strictEqual(decoy.progress, 0, 'reading state was grafted onto the wrong copy');
  });

  await test('scan progress does not accumulate across rescans', async () => {
    lib.scanState.done = 3;
    await lib.rescanQuiet();
    assert.strictEqual(lib.scanState.total, lib.scanState.done + lib.queue.length, JSON.stringify(lib.scanState));
  });

  await test('a transient index failure is retried, a permanent one is not', async () => {
    const id = Object.values(lib.books).find((b) => !b.missing).id;
    lib.queue = [id]; lib.indexing = null;
    lib.books[id].indexed = false; lib.books[id].indexAttempts = 0;
    lib.pumpIndex();
    assert.strictEqual(lib.indexing.id, id);
    await lib.onIndexResult(id, { error: 'timeout' });
    assert.strictEqual(lib.books[id].indexed, false, 'one timeout must not retire a book forever');
    assert(lib.queue.includes(id), 'the book was not re-queued');
    lib.books[id].indexAttempts = 2;
    lib.indexing = { id, started: Date.now() };
    await lib.onIndexResult(id, { error: 'timeout' });
    assert.strictEqual(lib.books[id].indexed, true, 'after 3 attempts we give up');
    lib.books[id].indexed = false; lib.books[id].indexAttempts = 0;
    lib.indexing = { id, started: Date.now() };
    await lib.onIndexResult(id, { error: 'unsupported format' });
    assert.strictEqual(lib.books[id].indexed, true, 'a deterministic failure is final');
  });

  await test('pumpIndex drains skipped entries without recursing', () => {
    lib.indexing = null;
    lib.queue = [];
    for (let i = 0; i < 20000; i++) lib.queue.push('missing-' + i);
    lib.pumpIndex();              // used to recurse once per entry → stack overflow
    assert.strictEqual(lib.queue.length, 0);
    assert.strictEqual(lib.indexing, null);
  });

  await test('index results store the text sample next to the DB, not inside it', async () => {
    const b = Object.values(lib.books).find((x) => !x.missing);
    lib.indexing = { id: b.id, started: Date.now() };
    await lib.onIndexResult(b.id, { metadata: { title: 'Ein Testbuch', author: 'A. Autor' }, textSample: 'Kapitel 1 '.repeat(3000) });
    assert.strictEqual(b.title, 'Ein Testbuch');
    assert.strictEqual(b.textSample, undefined, 'textSample must not live in library.json');
    assert(fs.existsSync(lib.textPath(b.id)), 'text sample file missing');
    assert(lib.readTextSample(b.id).startsWith('Kapitel 1'));
    assert.deepStrictEqual(lib.searchText('kapitel 1').length > 0, true);
    lib.flush();
    const raw = fs.readFileSync(path.join(userData, 'library.json'), 'utf8');
    assert(!raw.includes('Kapitel 1 Kapitel 1'), 'the 20 KB text sample is still being written into library.json');
  });

  await test('reading days are local, not UTC', () => {
    const d = new Date(2026, 0, 31, 23, 30, 0);   // 31.01. 23:30 local
    assert.strictEqual(localDay(d), '2026-01-31');
    assert.notStrictEqual(localDay(d), d.toISOString().slice(0, 10) === '2026-01-31' ? 'x' : localDay(d));
    const id = Object.values(lib.books).find((b) => !b.missing).id;
    lib.addReadingTime(id, 120);
    assert(lib.stats.get('days')[localDay()], 'reading time landed on the wrong day');
  });

  await test('manual shelving wins and survives a rescan', async () => {
    const b = Object.values(lib.books).find((x) => !x.missing && x.departmentId !== 'art');
    lib.setDepartment(b.id, 'Kunst, Musik & Design', 'Fotografie');
    assert.strictEqual(b.departmentId, 'art');
    assert.strictEqual(b.departmentSource, 'manual');
    await lib.rescanQuiet();
    assert.strictEqual(lib.books[b.id].departmentId, 'art', 'the scanner overwrote a manual decision');
    assert.strictEqual(lib.books[b.id].shelf, 'Fotografie');
  });

  await test('special characters, very long names, duplicate copies and empty folders', async () => {
    const odd = [
      'Romane/Gedichte #3 [Auswahl] 50% & mehr.epub',
      "Romane/Le Horla – Maupassant (1887).epub",
      'Romane/' + 'Sehr langer Titel '.repeat(9).trim() + '.epub',
      'Romane/日本の昔話.epub',
    ];
    for (const rel of odd) write(rel, 'odd ' + rel);
    // the same file twice: two books, the first copy is not treated as moved
    write('Romane/Doppelt/Der Zauberberg.epub', 'zauberberg');
    write('Romane/Zweitkopie/Der Zauberberg.epub', 'zauberberg');
    // empty folders: no shelf, no department of their own
    fs.mkdirSync(path.join(booksRoot, 'Leerer Ordner', 'Noch leerer'), { recursive: true });
    await lib.rescanQuiet();
    const byRel = (rel) => Object.values(lib.books).find((b) => b.path === path.join(booksRoot, rel));
    // the titles the UI gets (before indexing they come from the file name)
    const shown = (rel) => lib.getState().books.find((x) => x.id === byRel(rel)?.id);
    for (const rel of odd) {
      const b = byRel(rel);
      assert(b && !b.missing, 'not found: ' + rel);
      assert.strictEqual(b.departmentId, 'folder:romane', rel);
      assert(shown(rel)?.title && !/_/.test(shown(rel).title), 'title of ' + rel + ': ' + shown(rel)?.title);
    }
    assert.strictEqual(shown(odd[0]).title, 'Gedichte #3 [Auswahl] 50% & mehr');
    assert.strictEqual(shown(odd[3]).title, '日本の昔話');
    const a = byRel('Romane/Doppelt/Der Zauberberg.epub'), b = byRel('Romane/Zweitkopie/Der Zauberberg.epub');
    assert(a && b && a.id !== b.id, 'both copies are books of their own');
    assert.strictEqual(a.contentHash, b.contentHash);
    assert(!a.missing && !b.missing);
    const shelves = lib.getState().departments.flatMap((d) => d.shelves.map((s) => s.name));
    assert(!shelves.includes('Leerer Ordner') && !shelves.includes('Noch leerer'), shelves.join(', '));
    // a second scan changes nothing (stable ids for odd paths)
    const ids = Object.keys(lib.books).sort().join();
    await lib.rescanQuiet();
    assert.strictEqual(Object.keys(lib.books).sort().join(), ids);
  });

  await test('the watcher ignore list mirrors the scanner', () => {
    assert.strictEqual(watchIgnored('C:/x/node_modules'), true);
    assert.strictEqual(watchIgnored('C:/x/.git'), true);
    assert.strictEqual(watchIgnored('C:/x/Seite_files'), true);
    assert.strictEqual(watchIgnored('C:/x/~$Entwurf.docx'), true);
    assert.strictEqual(watchIgnored('C:/x/Buch.epub'), false);
    assert.strictEqual(watchIgnored('C:/x/Romane'), false);
  });

  await test('a book the watcher could not check while it was copied (EBUSY) is scanned once its size holds', async () => {
    const tmpW = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-watch-'));
    const books = path.join(tmpW, 'Bücher');
    fs.mkdirSync(path.join(books, 'Reisen'), { recursive: true });
    const file = path.join(books, 'Reisen', 'Großer Atlas.pdf');
    fs.writeFileSync(file, 'atlas'.padEnd(4096, ' '));   // there before the watcher: no add event of its own
    const folders = [{ path: books, mode: 'structured' }];
    const libW = new Library({ userData: path.join(tmpW, 'ud'), settings: { get: (k) => (k === 'folders' ? folders : null) }, emit: () => {}, getIndexer: () => null });
    libW.watchPollMs = 40;
    let rescans = 0;
    libW.rescanQuiet = async () => { rescans++; };
    libW.setupWatchers(folders);
    const w = libW.watchers[0];
    const busy = (p) => Object.assign(new Error('EBUSY: resource busy or locked, stat'), { code: 'EBUSY', path: p });
    const waitFor = async (cond, ms) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 25)); return cond(); };
    try {
      // a file that is gone by the next check ends the wait without a scan
      const gone = path.join(books, 'Reisen', 'Abgebrochen.pdf');
      assert.doesNotThrow(() => w.emit('error', busy(gone)), 'the error reached the process as an uncaught exception');
      assert(await waitFor(() => !libW.watchWaits.has(gone), 1000), 'the wait for a vanished file did not end');
      await new Promise((r) => setTimeout(r, 2800));
      assert.strictEqual(rescans, 0, 'a vanished file started a scan');
      // the copied file: chokidar's own wait for it is dropped, the size is checked until it holds, then one scan
      w._pendingWrites?.set(file, { lastChange: Date.now(), cancelWait: () => 'add' });
      w.emit('error', busy(file));
      assert(libW.watchWaits.has(file), 'the file is not checked again');
      if (w._pendingWrites) assert(!w._pendingWrites.has(file), "chokidar would keep ignoring the file's writes");
      w.emit('error', busy(file));
      assert.strictEqual(libW.watchWaits.size, 1, 'a second error for the same file started a second wait');
      assert(await waitFor(() => rescans === 1, 5000), 'no scan after the copy: ' + rescans);
      assert.strictEqual(libW.watchWaits.size, 0);
    } finally {
      for (const x of libW.watchers) { try { await x.close(); } catch {} }
      libW.flush();
      try { fs.rmSync(tmpW, { recursive: true, force: true }); } catch {}
    }
  });

  console.log('folders as departments');
  // a library like the ones the app is written for: numbered sub folders, loose books, shortcuts to must-reads,
  // saved web pages with their resource folders, notes and scripts next to the books, an empty "$Temp"
  const tmpF = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-folders-'));
  const rootF = path.join(tmpF, 'Bücher');
  const udF = path.join(tmpF, 'userData');
  fs.mkdirSync(udF, { recursive: true });
  const put = (rel, text = 'x') => { const p = path.join(rootF, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, (text + ' ' + rel).padEnd(2048, ' ')); return p; };
  put('Wirtschaft/02 Unternehmen/Der kleine Laden.pdf');
  put('Wirtschaft/10 Geschichte der Wirtschaft/Kaufleute und Märkte.pdf');
  const geld = put('Wirtschaft/03 Geld & Banken/Eine kurze Geschichte des Geldes.pdf');
  put('Wirtschaft/01 Volkswirtschaft/Märkte und Preise.pdf');
  put('Wirtschaft/_Hinweise.txt', 'notiz');
  put('Schach/01 Einstieg & Grundlagen/Schach lernen.pdf');
  put('Schach/_Gehört nicht hierher/Ein Kochbuch.pdf');
  put('Schach/16 Übungsblätter & Arbeitsmaterial/Blatt 1.pdf');
  put('Schach/Schach/Doppelt benannt.pdf');
  put('Schach/Aufräumen.bat', 'rem');
  put('Reisen/Die Kunst des Reisens.pdf');
  put('Reisen/Skandinavien/Fjorde.pdf');
  put('Philosophie/Fragen ohne Ende.pdf');
  put('Technik/Internet/Wie das Web funktioniert.htm', '<html><title>Web</title></html>');
  put('Technik/Internet/Wie das Web funktioniert-Dateien/a.htm', '<html>frame</html>');
  put('Technik/Internet/Wie das Web funktioniert-Dateien/anchor_data/a.htm', '<html>frame</html>');
  put('Technik/Anleitungen/Lesetipps/_ - Lesetipps.htm', '<html>tipps</html>');
  put('Technik/Steuer-Dateien/Beleg.pdf');      // no page next to it: a real folder
  put('Lose im Stamm.pdf');
  fs.mkdirSync(path.join(rootF, '$Temp', 'Trash'), { recursive: true });
  put('$Temp/Trash/Alt.pdf');
  // shortcuts: the stub reads the target from the file (shell.readShortcutLink does that in the app)
  const lnk = (rel, target) => { const p = path.join(rootF, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, target); return p; };
  const lnk1 = lnk('Wirtschaft/00 Must-Read/Geld.lnk', geld);
  lnk('Wirtschaft/00 Must-Read/Kaputt.lnk', path.join(rootF, 'gibt es nicht.pdf'));
  const readShortcut = (p) => { if (fs.lstatSync(p).isSymbolicLink()) return fs.realpathSync(p); const t = fs.readFileSync(p, 'utf8').trim(); return t || null; };
  const libF = new Library({ userData: udF, settings: { get: (k) => (k === 'folders' ? [{ path: rootF, mode: 'structured' }] : null) }, emit: () => {}, getIndexer: () => null, readShortcut });
  await libF.scanAll();
  const relOf = (b) => b.relPath.replace(/\\/g, '/');
  const findF = (rel) => Object.values(libF.books).find((b) => relOf(b) === rel);

  await test('folder departments: numbering stripped, natural folder order, shelves in their numeric order', () => {
    const deps = libF.getState().departments;
    assert.deepStrictEqual(deps.map((d) => d.name), ['Philosophie', 'Reisen', 'Schach', 'Technik', 'Wirtschaft', 'Verschiedenes'], deps.map((d) => d.name).join(','));
    const wirt = deps.find((d) => d.name === 'Wirtschaft');
    assert.strictEqual(wirt.id, 'folder:wirtschaft');
    assert.strictEqual(wirt.nameEn, 'Wirtschaft', 'the English name is the folder name');
    assert.deepStrictEqual(wirt.shelves.map((s) => s.name), ['Volkswirtschaft', 'Unternehmen', 'Geld & Banken', 'Geschichte der Wirtschaft']);
    assert.deepStrictEqual(wirt.shelves.map((s) => s.key), ['01 Volkswirtschaft', '02 Unternehmen', '03 Geld & Banken', '10 Geschichte der Wirtschaft']);
    const schach = deps.find((d) => d.name === 'Schach');
    assert.deepStrictEqual(schach.shelves.map((s) => s.name), ['Schach', 'Einstieg & Grundlagen', 'Übungsblätter & Arbeitsmaterial', 'Gehört nicht hierher'], 'the neutral shelf first, "_Gehört nicht hierher" last');
    assert(schach.shelves[0].neutral, 'a sub folder named like the department is no shelf of its own');
    const reisen = deps.find((d) => d.name === 'Reisen');
    assert.deepStrictEqual(reisen.shelves.map((s) => [s.name, !!s.neutral]), [['Reisen', true], ['Skandinavien', false]]);
    assert.strictEqual(findF('Lose im Stamm.pdf').departmentId, 'misc', 'a file directly in the books folder goes to Verschiedenes');
  });

  await test('not books: shortcuts, notes, scripts, "$" folders, resource folders of saved web pages', () => {
    const rels = Object.values(libF.books).map(relOf);
    assert(!rels.some((r) => /\.lnk$/i.test(r)), 'a shortcut became a book');
    assert(!rels.some((r) => /_Hinweise|\.bat$/i.test(r)), 'notes or scripts became books');
    assert(!rels.some((r) => r.startsWith('$Temp')), '"$Temp" was scanned');
    assert(!rels.some((r) => /-Dateien\//.test(r) && /\.htm$/.test(r)), 'frames of a saved web page became books: ' + rels.filter((r) => /-Dateien/.test(r)).join(', '));
    assert(findF('Technik/Internet/Wie das Web funktioniert.htm'), 'the saved page itself is a book');
    assert(findF('Technik/Anleitungen/Lesetipps/_ - Lesetipps.htm'), 'a book whose name starts with "_" is still a book');
    assert(findF('Technik/Steuer-Dateien/Beleg.pdf'), 'a folder that only looks like a resource folder is scanned');
    assert.strictEqual(findF('Technik/Anleitungen/Lesetipps/_ - Lesetipps.htm').shelf, 'Lesetipps', 'the folder the file sits in is its shelf');
  });

  await test('must-read: a shortcut marks the book it points to; removing it clears the mark', async () => {
    const k = findF('Wirtschaft/03 Geld & Banken/Eine kurze Geschichte des Geldes.pdf');
    assert.strictEqual(k.mustRead, true);
    assert.strictEqual(libF.publicBook(k).mustRead, true, 'mustRead is part of the public record');
    assert.strictEqual(Object.values(libF.books).filter((b) => b.mustRead).length, 1, 'a broken shortcut marks nothing');
    fs.rmSync(lnk1);
    await libF.rescanQuiet();
    assert.strictEqual(k.mustRead, undefined);
    lnk('Wirtschaft/00 Must-Read/Geld.lnk', geld);
    await libF.rescanQuiet();
    assert.strictEqual(k.mustRead, true);
    // Windows returns at most 260 characters of a target: a cut-off path still finds its book
    const long = put('Schach/01 Einstieg & Grundlagen/Ein sehr langer Titel -- Autorin -- 2024 -- Verlag -- 0123456789abcdef -- Archiv.pdf');
    lnk('Schach/00 Must-Read/Ein sehr langer Titel.lnk', long.slice(0, long.length - 25));
    await libF.rescanQuiet();
    assert.strictEqual(findF('Schach/01 Einstieg & Grundlagen/Ein sehr langer Titel -- Autorin -- 2024 -- Verlag -- 0123456789abcdef -- Archiv.pdf').mustRead, true, 'a truncated target');
  });

  await test('must-read: a symbolic link to a book marks it like a shortcut and is no book (Linux, macOS)', async () => {
    const k = findF('Reisen/Die Kunst des Reisens.pdf');
    const link = path.join(rootF, 'Reisen', '00 Must-Read', 'Die Kunst des Reisens.pdf');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    try { fs.symlinkSync(k.path, link); } catch (e) { console.log(`  (skipped: this system makes no symbolic links here, ${e.code})`); return; }
    try {
      await libF.rescanQuiet();
      assert.strictEqual(k.mustRead, true, 'the link marks its book');
      assert(!Object.values(libF.books).some((b) => /00 Must-Read/.test(relOf(b))), 'the link became a book');
    } finally { fs.rmSync(link, { force: true }); fs.rmSync(path.dirname(link), { recursive: true, force: true }); }
    await libF.rescanQuiet();
    assert.strictEqual(k.mustRead, undefined, 'removing the link clears the mark');
  });

  await test('must-read: a link to a folder marks no book (not even the single book in that folder)', async () => {
    // a symbolic link or junction to a sub folder is reported like a link to a file: its target is a folder, not a book
    const target = path.join(rootF, 'Reisen', 'Skandinavien');
    const only = Object.values(libF.books).filter((b) => b.path.startsWith(target + path.sep));
    assert.strictEqual(only.length, 1, 'the folder of this test holds one book');
    const link = path.join(rootF, 'Reisen', '00 Must-Read', 'Skandinavien');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    try { fs.symlinkSync(target, link, 'junction'); } catch (e) { console.log(`  (skipped: this system makes no links to folders here, ${e.code})`); return; }
    // a Windows shortcut to the same folder
    lnk('Reisen/00 Must-Read/Skandinavien.lnk', target);
    try {
      await libF.rescanQuiet();
      assert.strictEqual(only[0].mustRead, undefined, 'the single book of a linked folder became a must-read');
      assert(!Object.values(libF.books).some((b) => /00 Must-Read/.test(relOf(b))), 'the link became a book');
      assert.strictEqual(Object.values(libF.books).filter((b) => b.path.startsWith(target + path.sep)).length, 1, 'the books of the linked folder were scanned twice');
    } finally { fs.rmSync(path.dirname(link), { recursive: true, force: true }); }
    await libF.rescanQuiet();
  });

  await test('reindex: the book goes into the queue and counts in the scan total (the HUD shows done/total)', () => {
    const k = findF('Reisen/Die Kunst des Reisens.pdf');
    k.indexed = true; k.indexAttempts = 2;
    libF.scanState.done = 7; libF.scanState.total = 7;
    libF.reindex(k.id);
    assert.strictEqual(k.indexed, false);
    assert.strictEqual(k.indexAttempts, 0);
    assert(libF.queue.includes(k.id), 'the book is not queued');
    assert(libF.scanState.total >= libF.scanState.done + 1, `total ${libF.scanState.total} after done ${libF.scanState.done}`);
    libF.reindex(k.id);
    assert.strictEqual(libF.queue.filter((x) => x === k.id).length, 1, 'queued twice');
    // the indexer page died while it read a book (pumpIndex had taken it out of the queue): that try fails, the book is
    // queued again
    libF.queue = libF.queue.filter((x) => x !== k.id);
    libF.indexing = { id: k.id, started: Date.now() };
    libF.indexerGone('crashed');
    assert.strictEqual(libF.indexing, null);
    assert.strictEqual(k.indexAttempts, 1);
    assert(/crash/.test(k.indexError), k.indexError);
    assert.strictEqual(k.indexed, false, 'a crash is a transient failure: the book is read again');
    assert(libF.queue.includes(k.id), 'the book left the queue');
    assert.strictEqual(libF.scanState.total, libF.scanState.done + libF.queue.length, 'the failed try counts as done, the retry in the total');
    libF.queue = libF.queue.filter((x) => x !== k.id); k.indexed = true; k.indexAttempts = 0; k.indexError = null;
  });

  await test('manual departments: folder departments by name or id, the taxonomy, new names; sticky over a rescan', async () => {
    const b = findF('Philosophie/Fragen ohne Ende.pdf');
    libF.setDepartment(b.id, 'Schach', 'Einstieg & Grundlagen');
    assert.strictEqual(b.departmentId, 'folder:schach', 'the existing folder department wins over the taxonomy name "Schach"');
    assert.strictEqual(b.shelf, 'Einstieg & Grundlagen');
    assert.strictEqual(b.shelfKey, '01 Einstieg & Grundlagen', 'joins the shelf with its sort key');
    assert.strictEqual(b.departmentSource, 'manual');
    libF.setDepartment(b.id, 'folder:reisen', 'Reisen');
    assert.strictEqual(b.department, 'Reisen');
    assert.strictEqual(b.shelf, null, 'the department name as shelf means the neutral shelf');
    libF.setDepartment(b.id, 'history', '');
    assert.strictEqual(b.department, 'Geschichte');
    libF.setDepartment(b.id, 'Sammlung', 'Sommer');
    assert.strictEqual(b.departmentId, 'folder:sammlung', 'a new name is a department of its own');
    assert.strictEqual(b.shelf, 'Sommer');
    await libF.rescanQuiet();
    assert.strictEqual(b.department, 'Sammlung', 'the scanner overwrote a manual decision');
    const deps = libF.getState().departments.map((d) => d.name);
    assert(deps.indexOf('Sammlung') > deps.indexOf('Reisen') && deps.indexOf('Sammlung') < deps.indexOf('Schach'), deps.join(','));
  });

  await test('two books folders with "01 Schach" and "Schach": one department; auto folders keep the taxonomy', async () => {
    const second = path.join(tmpF, 'Zweiter Ordner');
    fs.mkdirSync(path.join(second, '01 Schach', 'Endspiel'), { recursive: true });
    fs.writeFileSync(path.join(second, '01 Schach', 'Endspiel', 'Turmendspiele.pdf'), 'turm'.padEnd(2048, ' '));
    const autoDir = path.join(tmpF, 'Automatisch');
    fs.mkdirSync(autoDir, { recursive: true });
    fs.writeFileSync(path.join(autoDir, 'Der Drachenhort.epub'), 'drachenhort'.padEnd(2048, ' '));
    const lib2 = new Library({ userData: path.join(tmpF, 'ud2'), settings: { get: (k) => (k === 'folders' ? [{ path: rootF, mode: 'structured' }, { path: second, mode: 'structured' }, { path: autoDir, mode: 'auto' }] : null) }, emit: () => {}, getIndexer: () => null, readShortcut });
    await lib2.scanAll();
    const deps = lib2.getState().departments;
    const schach = deps.filter((d) => d.name === 'Schach');
    assert.strictEqual(schach.length, 1, 'two Schach departments');
    assert(schach[0].shelves.some((s) => s.name === 'Endspiel'));
    const auto = Object.values(lib2.books).find((x) => /Drachenhort/.test(x.path));
    assert.strictEqual(auto.departmentSource, 'pending', 'an auto book waits for the classifier, in the taxonomy');
    assert(!String(auto.departmentId).startsWith('folder:'));
    assert.strictEqual(deps[deps.length - 1].name, 'Verschiedenes', 'the taxonomy departments follow the folders, Verschiedenes last');
    for (const w of lib2.watchers) { try { w.close(); } catch {} }
    lib2.flush();
  });

  await test('an existing library.json moves into the folder departments on the next start', () => {
    const tmp4 = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-mig3-'));
    const ud = path.join(tmp4, 'userData');
    fs.mkdirSync(ud, { recursive: true });
    const old = {
      f: { id: 'f', path: 'C:/b/Wirtschaft/02 Unternehmen/x.pdf', relPath: 'Wirtschaft\\02 Unternehmen\\x.pdf', folder: 'C:/b', folderMode: 'structured', departmentId: 'misc', department: 'Verschiedenes', departmentEn: 'Miscellaneous', shelf: 'Unternehmen', shelfKey: '02 Unternehmen', departmentSource: 'folder', bookmarks: [{ id: 1 }], annotations: [] },
      m: { id: 'm', path: 'C:/b/Reisen/y.pdf', relPath: 'Reisen\\y.pdf', folder: 'C:/b', folderMode: 'structured', departmentId: 'art', department: 'Kunst, Musik & Design', shelf: 'Fotografie', departmentSource: 'manual', bookmarks: [], annotations: [] },
      a: { id: 'a', path: 'C:/c/z.pdf', relPath: 'z.pdf', folder: 'C:/c', folderMode: 'auto', departmentId: 'history', department: 'Geschichte', departmentSource: 'auto', bookmarks: [], annotations: [] },
    };
    fs.writeFileSync(path.join(ud, 'library.json'), JSON.stringify({ books: old, history: [], onlineCache: {}, schema: 2 }));
    const lib4 = new Library({ userData: ud, settings: { get: () => [] }, emit: () => {}, getIndexer: () => null });
    assert.strictEqual(lib4.books.f.departmentId, 'folder:wirtschaft');
    assert.strictEqual(lib4.books.f.shelf, 'Unternehmen');
    assert.deepStrictEqual(lib4.books.f.bookmarks, [{ id: 1 }], 'reading data survives');
    assert.strictEqual(lib4.books.m.departmentId, 'art', 'a manual choice survives');
    assert.strictEqual(lib4.books.a.departmentId, 'history', 'auto books keep the taxonomy');
    assert.strictEqual(lib4.db.get('schema'), 3);
    lib4.flush();
    fs.rmSync(tmp4, { recursive: true, force: true });
  });
  for (const w of libF.watchers) { try { w.close(); } catch {} }
  libF.flush();
  try { fs.rmSync(tmpF, { recursive: true, force: true }); } catch {}

  console.log('migration');
  await test('an old library.json migrates onto the fixed departments; departments it no longer has are shelved again, nothing is lost', () => {
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-mig-'));
    const ud = path.join(tmp2, 'userData');
    fs.mkdirSync(ud, { recursive: true });
    const reading = { progress: 0.4, readingSeconds: 1200, lastLocation: 'epubcfi(/6/4!/4/2)', lastRead: 1700000000000, timesOpened: 3,
      bookmarks: [{ id: 1, location: 'epubcfi(/6/8)', label: 'Kapitel 2' }], annotations: [{ id: 2, value: 'epubcfi(/6/10)', color: 'yellow', note: 'Notiz', text: 'Satz' }],
      positions: [{ id: 3, fen: '8/8/8/8/8/8/8/K6k w - - 0 1', label: 'Stellung' }] };
    const legacyBooks = {
      a: { id: 'a', path: 'C:/b/a.pdf', relPath: 'a.pdf', folder: 'C:/b', department: 'Schach & Spiele', shelf: 'Turniere', departmentSource: 'folder', textSample: 'alter text '.repeat(400), bookmarks: [], annotations: [] },
      // a department of an earlier version that the fixed set no longer has: no id at all, or an id that is gone
      b: { id: 'b', path: 'C:/b/Schachtaktik für Fortgeschrittene.pdf', relPath: 'Schachtaktik für Fortgeschrittene.pdf', folder: 'C:/b', title: 'Schachtaktik für Fortgeschrittene', department: 'Eine Abteilung von früher', departmentSource: 'auto', ...structuredClone(reading) },
      e: { id: 'e', path: 'C:/b/Die Weimarer Republik 1918-1933.pdf', relPath: 'Die Weimarer Republik 1918-1933.pdf', folder: 'C:/b', title: 'Die Weimarer Republik 1918-1933', department: 'Zeitgeschehen', departmentId: 'oldtopic', departmentSource: 'auto', bookmarks: [], annotations: [] },
      c: { id: 'c', path: 'C:/b/c.pdf', relPath: 'c.pdf', folder: 'C:/b', department: 'Mein Eigener Kram', departmentSource: 'manual', shelf: 'Sonstiges', bookmarks: [], annotations: [] },
      d: { id: 'd', path: 'C:/b/d.pdf', relPath: 'd.pdf', folder: 'C:/b', department: 'Biografien', departmentSource: 'auto', missing: true, bookmarks: [], annotations: [] },
    };
    fs.writeFileSync(path.join(ud, 'library.json'), JSON.stringify({ books: legacyBooks, history: [], onlineCache: {} }));
    const lib2 = new Library({ userData: ud, settings: { get: () => [] }, emit: () => {}, getIndexer: () => null });
    assert.strictEqual(lib2.books.a.departmentId, 'games');
    assert.strictEqual(lib2.books.a.department, 'Spiele & Schach');
    assert.strictEqual(lib2.books.a.shelf, 'Turniere', 'the shelf the user had must survive');
    assert.strictEqual(lib2.books.b.departmentId, 'games', 'shelved again by the classifier');
    assert.strictEqual(lib2.books.b.departmentSource, 'auto');
    for (const [k, v] of Object.entries(reading)) assert.deepStrictEqual(lib2.books.b[k], v, 'reading data lost: ' + k);
    assert.strictEqual(lib2.books.e.departmentId, 'history', 'an id that is gone: shelved again as well');
    assert.strictEqual(lib2.books.e.departmentSource, 'auto');
    assert.strictEqual(lib2.books.c.departmentSource, 'manual');
    assert.strictEqual(lib2.books.c.departmentId, 'misc', 'an unknown manual department lands in Verschiedenes');
    assert.strictEqual(lib2.books.c.shelf, 'Sonstiges');
    assert.strictEqual(lib2.books.d.departmentId, 'biography', 'a name of an earlier version');
    assert(lib2.books.d.missingSince > 0);
    assert.strictEqual(Object.keys(lib2.books).length, 5, 'no book lost');
    assert.strictEqual(lib2.getState().books.length, 4, 'every present book is on the shelves');
    assert.strictEqual(lib2.books.a.textSample, undefined, 'the text blob must be moved out of library.json');
    for (const d of lib2.computeDepartments(lib2.getState().books)) assert(departmentById(d.id), 'unknown department ' + d.id);
    lib2.flush();
    fs.rmSync(tmp2, { recursive: true, force: true });
  });

  await test('books missing for more than 90 days are purged (unless they carry user data)', () => {
    const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-purge-'));
    const ud = path.join(tmp3, 'userData');
    fs.mkdirSync(ud, { recursive: true });
    const old = Date.now() - 200 * 24 * 3600 * 1000;
    fs.writeFileSync(path.join(ud, 'library.json'), JSON.stringify({
      books: {
        gone: { id: 'gone', path: 'C:/b/gone.pdf', department: 'Geschichte', missing: true, missingSince: old, bookmarks: [], annotations: [], progress: 0 },
        loved: { id: 'loved', path: 'C:/b/loved.pdf', department: 'Geschichte', missing: true, missingSince: old, bookmarks: [{ id: 'x' }], annotations: [], progress: 0.5 },
        here: { id: 'here', path: 'C:/b/here.pdf', department: 'Geschichte', bookmarks: [], annotations: [] },
      }, history: [], onlineCache: {},
    }));
    const lib3 = new Library({ userData: ud, settings: { get: () => [] }, emit: () => {}, getIndexer: () => null });
    assert.strictEqual(lib3.books.gone, undefined, 'stale record kept');
    assert(lib3.books.loved, 'a record with bookmarks must be kept');
    assert(lib3.books.here);
    lib3.flush();
    fs.rmSync(tmp3, { recursive: true, force: true });
  });

  for (const w of lib.watchers) { try { w.close(); } catch {} }
  lib.flush();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
