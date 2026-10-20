# Synthetic test library with invented, neutral departments (titles, authors and publishers are made up).
# It has the structural features of a large real library: about 780 books in 11 departments, departments with up to
# 16 numbered shelves, books lying directly in a department folder, a deeper folder level, a "Sonstiges" and a
# "Gehört nicht hierher" folder (sorted last), "00 Must-Read" folders with .lnk shortcuts (made afterwards by
# make_lnk.ps1), files directly in the books folder ("Verschiedenes"), German and English books, short and very long
# titles, file names as "Titel - Autor.pdf", with underscores and in the multi-part scheme of download sites
# ("Title -- Author -- Year -- Publisher -- hash -- Source").
# PDFs: page 1 is a coloured cover (JPEG image) or, for the books without a cover, a plain text title page or a blank
# page; then N text pages (realistic page counts -> realistic spine widths). EPUBs with and without a cover image.
# A few broken PDFs (indexer error -> generated title card), saved web pages with "-Dateien" resource folders (the
# junk .htm inside must NOT become books), notes and scripts that are not books, a "$Temp" folder.
import io, os, random, shutil, sys, json, hashlib, zipfile
from PIL import Image, ImageDraw, ImageFont

# usage: python build/testlib/gen_lib.py <folder>   (then: powershell -File build/testlib/make_lnk.ps1 <folder>)
if len(sys.argv) < 2: sys.exit('usage: gen_lib.py <folder for the test library>')
ROOT = os.path.abspath(sys.argv[1])
rnd = random.Random(4711)
FONTS = r'C:\Windows\Fonts'

def F(name, size):
    # the Windows fonts when they are there, else Pillow's own font (other systems)
    try: return ImageFont.truetype(os.path.join(FONTS, name), size)
    except OSError:
        try: return ImageFont.load_default(size)
        except TypeError: return ImageFont.load_default()

AUTHORS_DE = ['Hanna Brückner', 'Jonas Wendland', 'Lea Kranich', 'Matthias Ebeling', 'Paul Ostermann', 'Greta Hollander',
              'Felix Rautenberg', 'Clara Winterfeld', 'Emil Sandvoss', 'Ida Kampmann', 'Marta Feldhaus', 'Leon Achterberg',
              'Nora Talheim', 'Theo Brandis', 'Frieda Holmgren', 'Arne Kiesewetter', 'Ruth Abendroth', 'Konrad Lindemeyer',
              'Johanna Steinmetz', 'Valentin Ruhland', 'Mira Osterkamp', 'Georg Fenske', 'Anni Bergfeld', 'Lukas Wedemeyer']
AUTHORS_EN = ['Margaret Ellison', 'Thomas Whitcombe', 'Alice Pemberley', 'George Hartley', 'Nathan Coleridge-Bray', 'Rachel Ainsworth',
              'Samuel Brookfield', 'Eleanor Mayhew', 'Daniel Fairley', 'Hugh Calloway', 'Isabel Thornbury', 'Oliver Ashdown',
              'Priya Ramanathan', 'Lucia Moreno Vidal', 'Pierre Lacombe-Rey', 'Kenji Arataki']
PUBLISHERS = ['Verlag Am Hang', 'Edition Lindenblatt', 'Kranich Verlag', 'Haus der Bücher', 'Northfield Press', 'Harbour Lane Books',
              'Edition Sonnenuhr', 'Weidenhof Verlag', 'Bluewater Publishing', 'Verlag Zum Leuchtturm']
SUBS_DE = ['Eine Einführung', 'Ein Praxisbuch', 'Methoden und Beispiele', 'Übungen mit Lösungen', 'Der Klassiker in Neuauflage',
           'Band 1', 'Band 2', 'Grundlagen und Anwendung', 'Das Handbuch', 'Ein Leitfaden', 'Kompakt erklärt', 'Für Fortgeschrittene',
           'Vom Anfänger zum Kenner', 'Mit vielen Abbildungen', 'Eine Spurensuche in zwölf Kapiteln']
SUBS_EN = ['An Introduction', 'A Practical Guide', 'Second Edition', 'Volume One', 'With Exercises and Answers', 'A Short History',
           'Essays and Sketches', 'The Illustrated Edition']

# per folder: [count, German titles, English titles]. The title is "<base>" or "<base>: <subtitle>".
T = {
  'Geschichte': [3, ['Kleine Geschichte der Welt', 'Zeitreisen durch Europa', 'Was von gestern bleibt'], ['A Brief Walk Through Time']],
  'Geschichte/01 Antike': [14, ['Das Leben in Athen', 'Rom und seine Straßen', 'Die Pharaonen am Nil', 'Handel im Mittelmeer', 'Alltag in der Antike', 'Die Seidenstraße', 'Götter und Tempel'], ['Daily Life in Ancient Rome', 'The Bronze Age World', 'Cities of the Ancient Mediterranean']],
  'Geschichte/02 Mittelalter': [13, ['Burgen und Klöster', 'Die Hanse', 'Ritter, Bauern und Mönche', 'Städte des Mittelalters', 'Handschriften und Buchmalerei', 'Pilgerwege'], ['The Medieval Village', 'Castles of Northern Europe']],
  'Geschichte/03 Frühe Neuzeit': [11, ['Das Zeitalter der Entdeckungen', 'Der Buchdruck verändert die Welt', 'Höfe und Residenzen', 'Kaufleute und Kontore'], ['The Age of Sail', 'Printing and the Early Modern Mind']],
  'Geschichte/04 Das 19. Jahrhundert': [12, ['Dampf und Eisen', 'Die Zeit der Eisenbahn', 'Auswanderer', 'Fabriken und Arbeiterviertel', 'Das lange Jahrhundert'], ['Steam and Steel', 'The Railway Century']],
  'Geschichte/05 Das 20. Jahrhundert': [16, ['Die Zwanzigerjahre', 'Wiederaufbau', 'Das geteilte Land', 'Mauerfall', 'Die Welt nach 1945', 'Wirtschaftswunder', 'Der lange Weg nach Europa'], ['Europe After the War', 'The Short Twentieth Century', 'Postwar Cities']],
  'Geschichte/06 Zeitgeschichte': [9, ['Die Welt seit 1990', 'Chroniken der Gegenwart', 'Das neue Jahrtausend'], ['Our Recent Past']],
  'Geschichte/07 Biografien': [12, ['Ein Leben für die Wissenschaft', 'Die Kartografin', 'Der Uhrmacher von Bremen', 'Briefe einer Reisenden', 'Die Brückenbauerin'], ['The Lighthouse Keeper’s Daughter', 'A Life in Maps']],
  'Geschichte/08 Archäologie': [7, ['Spuren im Sand', 'Ausgrabungen am Rhein', 'Was Scherben erzählen'], ['Digging Up the Past']],
  'Kochen': [8, ['Kochen für jeden Tag', 'Das Grundkochbuch', 'Suppen und Eintöpfe', 'Einfach gut essen', 'Aus der Vorratskammer'], ['The Everyday Kitchen', 'Soups for All Seasons']],
  'Kochen/Backen': [7, ['Brot backen', 'Kuchen vom Blech', 'Kleine Backschule', 'Sauerteig'], ['The Bread Book']],
  'Kochen/Vegetarisch': [6, ['Gemüse im Mittelpunkt', 'Vegetarisch kochen', 'Aus dem Garten auf den Teller'], ['Green Kitchen']],
  'Kochen/Länderküchen': [9, ['Die Küche Italiens', 'Japanisch kochen', 'Mezze und Tapas', 'Nordische Küche', 'Gewürze der Welt'], ['Flavours of the Levant', 'A Taste of Mexico']],
  'Kochen/Sonstiges': [2, ['Getränke selbst gemacht', 'Picknick'], []],
  'Kunst/Architektur': [9, ['Häuser lesen', 'Brücken der Welt', 'Bauen mit Holz', 'Die moderne Stadt'], ['Reading Buildings', 'The Architecture of Light']],
  'Kunst/Design': [6, ['Gutes Design', 'Schrift und Form', 'Farben im Alltag'], ['Shapes for Daily Use']],
  'Kunst/Fotografie': [8, ['Sehen lernen', 'Licht und Schatten', 'Fotografieren auf Reisen', 'Die Kamera verstehen'], ['Seeing with a Lens']],
  'Kunst/Malerei': [12, ['Aquarell für Einsteiger', 'Meisterwerke der Landschaftsmalerei', 'Farbenlehre', 'Malen im Freien', 'Die Kunst des Porträts'], ['Watercolour Basics', 'Painting the Sea']],
  'Kunst/Musik': [10, ['Musiktheorie', 'Die Geschichte der Oper', 'Klavier spielen', 'Rhythmus und Klang', 'Das Orchester'], ['Inside a Melody', 'Listening to Jazz']],
  'Naturwissenschaften/01 Astronomie': [14, ['Sterne über der Heide', 'Karten des Himmels', 'Planeten und Monde', 'Kometen und Meteore', 'Das Licht ferner Galaxien', 'Mit dem Fernrohr unterwegs'], ['A Field Guide to the Night Sky', 'The Expanding Universe', 'Moons of the Solar System']],
  'Naturwissenschaften/02 Physik': [16, ['Physik im Alltag', 'Die Welt der Teilchen', 'Wellen und Schwingungen', 'Wärme und Energie', 'Relativität verständlich', 'Das Experiment', 'Kräfte und Bewegung'], ['The Physics of Everyday Things', 'Waves and Fields', 'Quantum Ideas']],
  'Naturwissenschaften/03 Chemie': [10, ['Chemie in der Küche', 'Das Periodensystem', 'Moleküle des Lebens', 'Kristalle'], ['Elements on the Table']],
  'Naturwissenschaften/04 Biologie': [13, ['Die Zelle', 'Das Leben im Wassertropfen', 'Pilze', 'Vererbung', 'Ökosysteme'], ['The Living Cell', 'Life in a Pond']],
  'Naturwissenschaften/05 Evolution': [6, ['Die Entstehung der Arten erklärt', 'Fossilien', 'Der Stammbaum des Lebens'], ['Deep Time']],
  'Naturwissenschaften/06 Geologie': [7, ['Steine lesen', 'Vulkane', 'Gebirge der Erde', 'Höhlen'], ['Rocks and Minerals']],
  'Naturwissenschaften/07 Wetter & Klima': [8, ['Wolken bestimmen', 'Das Wetter verstehen', 'Klima im Wandel', 'Stürme'], ['The Weather Book']],
  'Naturwissenschaften/08 Meere': [6, ['Leben in der Tiefsee', 'Gezeiten', 'Korallenriffe'], ['The Open Ocean']],
  'Naturwissenschaften/09 Botanik': [9, ['Bäume bestimmen', 'Wildkräuter', 'Pflanzen am Wegrand', 'Blüten und Bestäuber'], ['A Guide to Wildflowers']],
  'Naturwissenschaften/10 Tiere': [12, ['Vögel am Futterhaus', 'Insekten', 'Säugetiere Europas', 'Tiere im Wald', 'Spuren im Schnee'], ['Birds of Field and Forest', 'Bees in the Meadow']],
  'Naturwissenschaften/11 Mathematik': [15, ['Zahlen erzählen', 'Geometrie mit Zirkel und Lineal', 'Das Unendliche', 'Rätsel und Beweise', 'Primzahlen', 'Analysis für Einsteiger'], ['The Joy of Numbers', 'Pictures of Proofs', 'A Tour of Geometry']],
  'Naturwissenschaften/12 Statistik': [5, ['Statistik verstehen', 'Zufall und Wahrscheinlichkeit'], ['Reading Data']],
  'Naturwissenschaften/13 Medizin': [9, ['Der menschliche Körper', 'Erste Hilfe', 'Schlaf', 'Das Immunsystem'], ['The Human Body Explained']],
  'Naturwissenschaften/14 Gehirn & Psychologie': [10, ['Wie wir denken', 'Das Gedächtnis', 'Gewohnheiten', 'Aufmerksamkeit'], ['The Curious Brain', 'Memory and Forgetting']],
  'Naturwissenschaften/15 Wissenschaftsgeschichte': [8, ['Forscherinnen und Forscher', 'Die großen Experimente', 'Instrumente der Wissenschaft'], ['Great Experiments']],
  'Naturwissenschaften/16 Lehrbücher & Nachschlagewerke': [7, ['Formelsammlung', 'Lexikon der Naturwissenschaften', 'Lehrbuch der Experimentalphysik'], ['A Dictionary of Science']],
  'Philosophie': [4, ['Philosophie für Einsteiger', 'Fragen ohne Ende', 'Die großen Denker'], ['Thinking Clearly']],
  'Philosophie/Antike Philosophie': [7, ['Die Vorsokratiker', 'Gespräche im Garten', 'Die Stoa'], ['Ancient Wisdom']],
  'Philosophie/Aufklärung': [6, ['Das Zeitalter der Vernunft', 'Licht und Freiheit'], ['The Enlightenment']],
  'Philosophie/Ethik': [8, ['Gut handeln', 'Was wir einander schulden', 'Ethik im Alltag'], ['Everyday Ethics']],
  'Philosophie/Logik & Erkenntnis': [6, ['Logik lernen', 'Was können wir wissen'], ['A Little Book of Logic']],
  'Philosophie/Philosophie des Geistes': [5, ['Bewusstsein', 'Der Geist und die Maschine'], ['Minds and Machines']],
  'Reisen/Afrika': [5, ['Am Rand der Wüste', 'Ostafrika'], ['Along the Rift Valley']],
  'Reisen/Amerika': [7, ['Quer durch Kanada', 'Die Anden', 'Nationalparks im Westen'], ['Route Across the Prairies']],
  'Reisen/Asien': [9, ['Mit dem Zug durch Japan', 'Die Inseln Indonesiens', 'Bergdörfer im Himalaja', 'Märkte in Vietnam'], ['Slow Travel in Asia']],
  'Reisen/Europa': [4, ['Europa mit dem Fahrrad', 'Kleine Städte, große Plätze'], ['Europe by Rail']],
  'Reisen/Europa/Alpen': [5, ['Hüttenwanderungen', 'Pässe und Täler'], ['Walking in the Alps']],
  'Reisen/Europa/Skandinavien': [6, ['Fjorde', 'Mittsommer', 'Die Schären'], ['Northern Lights']],
  'Reisen/Europa/Mittelmeer': [7, ['Inselsommer', 'Häfen am Mittelmeer', 'Olivenhaine'], ['Island Hopping']],
  'Reisen/Ozeanien': [4, ['Neuseeland zu Fuß', 'Die Südsee'], ['Across the Outback']],
  'Reisen/Polarregionen': [3, ['Eis und Licht', 'Spitzbergen'], []],
  'Romane/Abenteuer': [10, ['Die Insel im Nebel', 'Das Logbuch der Albatros', 'Der Pfad über den Pass', 'Die letzte Karawane'], ['The Lost Expedition', 'Beyond the Reef']],
  'Romane/Englische Romane': [15, [], ['The House on Willow Lane', 'Letters from the Coast', 'A Season in the Valley', 'The Clockmaker’s Apprentice', 'Winter at Hollow Farm', 'The Silent Harbour', 'Under a Paper Moon', 'The Orchard Keeper’s Promise']],
  'Romane/Fantasy': [14, ['Die Chronik der Glasberge', 'Das Lied der Drachenfeuer', 'Der Turm aus Salz', 'Die Kartenmacherin', 'Schattenwald'], ['The Ember Crown', 'The Lamp on the Last Hill']],
  'Romane/Klassiker': [22, ['Der Sommer am See', 'Die Erben des Hauses Lindenhof', 'Ein Winter in der Stadt', 'Die Briefe der Schwestern Hagen', 'Das Haus am Fluss', 'Der Weg nach Süden', 'Die Gesellschaft im Gartensaal', 'Abschied von der Mühle', 'Der Kapitän und das Mädchen'], ['The Inheritance', 'A Journey North', 'The Painter’s Wife']],
  'Romane/Krimis': [18, ['Tod am Deich', 'Die stille Zeugin', 'Mord im Lesesaal', 'Der dritte Schlüssel', 'Nebel über dem Hafen', 'Das Rätsel der verschlossenen Tür'], ['The Midnight Ferry', 'A Quiet Murder', 'The Locked Room']],
  'Romane/Kurzgeschichten': [8, ['Geschichten vom Meer', 'Zwölf Nächte', 'Kleine Fluchten'], ['Short Stories for Long Evenings']],
  'Romane/Science-Fiction': [16, ['Die Stadt unter dem Eis', 'Signale von Kepler', 'Das letzte Schiff', 'Die Gärten des Mars', 'Zeitfalten'], ['Starfall', 'The Quiet Machines', 'Orbit of Glass']],
  'Schach/01 Regeln & erste Schritte': [16, ['Schach von Anfang an', 'Die Figuren und ihre Züge', 'Mein erstes Schachbuch', 'Schach spielend lernen', 'Das kleine Schach-ABC', 'Matt in einem Zug'], ['Chess from the First Move', 'Your First Chess Games']],
  'Schach/02 Eröffnungen': [22, ['Eröffnungen im Überblick', 'Die Italienische Partie', 'Offene Spiele', 'Geschlossene Spiele', 'Gambits für jeden Tag', 'Die Prinzipien der Eröffnung', 'Ein Repertoire mit Weiß', 'Ein Repertoire mit Schwarz'], ['Opening Ideas in Plain Words', 'Opening Traps to Avoid', 'A Repertoire for Club Players']],
  'Schach/03 Mittelspiel': [14, ['Pläne im Mittelspiel', 'Das Mittelspiel verstehen', 'Angriff auf den König', 'Die Kunst der Verteidigung', 'Bauernstrukturen'], ['Plans After the Opening', 'Storming the Castle']],
  'Schach/04 Endspiel': [18, ['Endspiele für Einsteiger', 'Turmendspiele', 'Bauernendspiele', 'Leichtfigurenendspiele', 'Grundlagen der Endspieltechnik'], ['Endgames Step by Step', 'Rook Endings Made Simple']],
  'Schach/05 Taktik': [20, ['Taktiktraining', 'Kombinationen', 'Die Fesselung', 'Doppelangriff und Gabel', '500 Taktikaufgaben', 'Opfer und Gegenopfer', 'Matt in zwei Zügen'], ['Tactics Workbook', 'The Power of the Fork', 'Puzzles for Every Day']],
  'Schach/06 Strategie': [12, ['Strategie im Schach', 'Die starken und die schwachen Felder', 'Positionelles Denken', 'Der Läufer und der Springer'], ['Good Squares, Bad Squares']],
  'Schach/07 Partiensammlungen': [10, ['Hundert lehrreiche Partien', 'Turniere vergangener Zeiten', 'Partien aus dem Verein'], ['Memorable Games']],
  'Schach/08 Problemschach': [6, ['Schachprobleme', 'Studien und Rätsel'], ['Chess Problems for Pleasure']],
  'Schach/09 Geschichte des Schachs': [6, ['Die Geschichte des Schachspiels', 'Schach in Kunst und Literatur'], ['A History of Chess']],
  'Schach/Gehört nicht hierher': [1, ['Ein Kochbuch'], []],
  'Sprachen/Englisch': [8, ['Englisch für die Reise', 'Englische Grammatik', 'Wortschatz Englisch'], ['English Idioms in Use']],
  'Sprachen/Französisch': [6, ['Französisch lernen', 'Französische Grammatik'], []],
  'Sprachen/Italienisch': [4, ['Italienisch für die Reise', 'Italienische Grammatik'], []],
  'Sprachen/Latein': [5, ['Latein lernen', 'Kleine lateinische Grammatik'], []],
  'Sprachen/Spanisch': [6, ['Spanisch lernen', 'Spanische Grammatik'], []],
  'Sprachen/Wörterbücher': [6, ['Wörterbuch Deutsch–Englisch', 'Wörterbuch Deutsch–Französisch', 'Das Rechtschreibwörterbuch'], ['A Learner’s Dictionary']],
  'Technik/Elektronik': [8, ['Elektronik für Einsteiger', 'Löten lernen', 'Schaltungen verstehen'], ['Make Your Own Circuits']],
  'Technik/Handwerk': [9, ['Holzbearbeitung', 'Das Werkstattbuch', 'Reparieren statt wegwerfen', 'Möbel selbst bauen'], ['The Home Workshop']],
  'Technik/Informatik': [16, ['Programmieren lernen', 'Algorithmen verstehen', 'Datenbanken', 'Wie das Internet funktioniert', 'Rechner von innen', 'Sicher im Netz'], ['Learning to Program', 'Algorithms Explained', 'Inside the Machine Room']],
  'Technik/Maschinenbau': [6, ['Getriebe und Motoren', 'Technisches Zeichnen'], ['Engines and Gears']],
  'Technik/Raumfahrt': [7, ['Raketen', 'Leben auf der Raumstation', 'Der Weg zum Mond'], ['Spaceflight Basics']],
  'Wirtschaft/01 Volkswirtschaft': [10, ['Volkswirtschaft verstehen', 'Märkte und Preise', 'Wie Handel funktioniert', 'Die Wirtschaft in Zahlen'], ['Economics in Plain Words']],
  'Wirtschaft/02 Unternehmen': [9, ['Ein Unternehmen gründen', 'Der kleine Laden', 'Familienbetriebe', 'Projektarbeit'], ['Small Business Basics']],
  'Wirtschaft/03 Geld & Banken': [8, ['Eine kurze Geschichte des Geldes', 'Banken verstehen', 'Haushalten mit System'], ['Money Explained']],
  'Wirtschaft/04 Geschichte der Wirtschaft': [7, ['Kaufleute und Märkte', 'Die Industrialisierung', 'Handelswege'], ['A History of Trade']],
  'Wirtschaft/05 Arbeit & Gesellschaft': [6, ['Die Zukunft der Arbeit', 'Arbeit im Wandel'], ['Work and Life']],
  'Wirtschaft/06 Nachhaltigkeit': [5, ['Kreislaufwirtschaft', 'Nachhaltig wirtschaften'], ['The Circular Economy']],
  '': [3, ['Gebrauchsanleitung für den Lesesaal', 'Notizbuch der Bibliothek'], ['Untitled Collection']],   # directly in the books folder
}
# a few very long titles (the book card, the shelf labels and the spines must cope)
LONG = [
  ('Naturwissenschaften/01 Astronomie', 'Die Vermessung des Himmels: Wie Astronomen in dreitausend Jahren lernten, die Entfernungen der Sterne zu bestimmen, und was sie dabei über die Erde erfuhren', 'de'),
  ('Geschichte/05 Das 20. Jahrhundert', 'Zwischen Trümmern und Neubeginn: Alltag, Arbeit und Hoffnung in den Städten Mitteleuropas in den Jahren nach dem Zweiten Weltkrieg', 'de'),
  ('Romane/Englische Romane', 'The Remarkable and Entirely True Account of the Clockmaker’s Apprentice, Who Set Out One Winter Morning to Repair the Great Clock of the Northern Sea', 'en'),
  ('Schach/04 Endspiel', 'Das Endspiel-Lexikon: Alle wichtigen Stellungen mit König und Bauern, Turm, Läufer und Springer, erklärt für Vereinsspieler und solche, die es werden wollen', 'de'),
  ('Kochen', 'Kochen mit dem, was da ist: Hundertzwanzig einfache Rezepte für Reste, Vorräte und Gemüse aus dem eigenen Garten, durch das ganze Jahr', 'de'),
]
# saved web pages (Firefox, German: "<name>-Dateien" holds the page's resources, among them small .htm frames)
PAGES = {
  'Technik/Internet': ['How the Web Works _ Example Blog', 'Ein Router erklärt _ Technikseite', 'Backups richtig machen _ Ratgeber'],
  'Technik/Internet/Gespeicherte Artikel': ['Why Bridges Sing in the Wind _ Science Notes', 'Die Geschichte der Glühbirne _ Lexikon', 'Rain Sensors in Cars _ Tech Weekly',
                                            'Sourdough Starter Basics _ Kitchen Diary', 'Mapping Old Railway Lines _ Hobby Pages'],
  'Technik/Internet/Gespeicherte Artikel/Beispiele': ['_ - Lesetipps', 'Ein Leuchtturm wird versetzt - Wikipedia', 'Weather Station Build Log _ Forum', 'Tide Tables Explained _ Harbour Office'],
}

COLORS = [(31, 60, 92), (124, 38, 45), (46, 92, 70), (190, 120, 40), (60, 60, 70), (200, 70, 55), (23, 95, 118), (138, 79, 156), (230, 200, 120),
          (240, 235, 222), (70, 110, 160), (160, 60, 90), (30, 30, 30), (220, 110, 60), (90, 120, 60), (250, 250, 245)]

def pdf_str(s):
    b = s.encode('utf-16-be')
    return '<FEFF' + b.hex().upper() + '>'

def ascii_text(s):
    return (s.replace('ä', 'ae').replace('ö', 'oe').replace('ü', 'ue').replace('Ä', 'Ae').replace('Ö', 'Oe').replace('Ü', 'Ue').replace('ß', 'ss')
             .replace('’', "'").replace('–', '-').encode('ascii', 'replace').decode().replace('\\', '').replace('(', '').replace(')', ''))

def wrap(draw, text, font, maxw):
    words, lines, line = text.split(), [], ''
    for w in words:
        t = (line + ' ' + w).strip()
        if draw.textlength(t, font=font) > maxw and line: lines.append(line); line = w
        else: line = t
    if line: lines.append(line)
    return lines

def cover_jpeg(title, author, seed):
    r = random.Random(seed)
    W, H = 360, 540
    bg = COLORS[r.randrange(len(COLORS))]
    light = sum(bg) / 3 > 150
    ink = (30, 30, 30) if light else (245, 240, 230)
    im = Image.new('RGB', (W, H), bg)
    d = ImageDraw.Draw(im)
    style = r.randrange(4)
    acc = COLORS[r.randrange(len(COLORS))]
    if style == 0: d.ellipse([W * 0.35, H * 0.45, W * 1.1, H * 0.95], fill=acc)
    elif style == 1: d.rectangle([0, H * 0.62, W, H], fill=acc)
    elif style == 2:
        for k in range(6): d.rectangle([0, 40 + k * 14, W, 46 + k * 14], fill=acc)
    else: d.rectangle([24, 24, W - 24, H - 24], outline=acc, width=6)
    serif = r.random() < 0.5
    size = 40
    tf = F('georgiab.ttf' if serif else 'arialbd.ttf', size)
    lines = wrap(d, title, tf, W - 56)
    while len(lines) > 5 and size > 20:
        size -= 4; tf = F('georgiab.ttf' if serif else 'arialbd.ttf', size); lines = wrap(d, title, tf, W - 56)
    y = 70 if style != 2 else 140
    for ln in lines[:6]:
        d.text((28, y), ln, font=tf, fill=ink); y += int(size * 1.15)
    af = F('ariali.ttf' if serif else 'georgiai.ttf', 22)
    d.text((28, H - 60), author, font=af, fill=ink if style != 1 else ((30, 30, 30) if sum(acc) / 3 > 150 else (245, 240, 230)))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=78)
    return b.getvalue(), W, H

def body_text(title, lang):
    return ascii_text(f'{title}. ' + ('Kapitel 1. Dieses Buch handelt von ' if lang == 'de' else 'Chapter 1. This book is about ') + title + '. ' +
                      ('Der Autor erklaert die wichtigsten Grundlagen und zeigt Beispiele aus der Praxis. ' if lang == 'de' else 'The author explains the basics with many examples. ') * 3)

def write_pdf(path, title, author, pages, seed, lang='de', first='image', publisher=''):
    """first: 'image' (a cover picture), 'text' (a plain title page, no cover) or 'blank' (an empty first page)."""
    W, H = 360, 540
    objs = []
    def add(body):
        objs.append(body); return len(objs)
    # reserve catalog(1), pages(2)
    add(b''); add(b'')
    font = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    bold = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
    page_ids = []
    if first == 'image':
        jpg, W, H = cover_jpeg(title, author, seed)
        img = add(b'<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n' % (W, H, len(jpg)) + jpg + b'\nendstream')
        cs = b'q %d 0 0 %d 0 0 cm /Im0 Do Q' % (W, H)
        c1 = add(b'<< /Length %d >>\nstream\n' % len(cs) + cs + b'\nendstream')
        page_ids.append(add(b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>' % (W, H, img, c1)))
    else:
        cs = ''
        if first == 'text':
            # a title page as many scanned or self-made PDFs have it: title, author and publisher in plain type
            t = ascii_text(title)
            lines = [t[i:i + 34] for i in range(0, min(len(t), 136), 34)]
            cs = 'BT /F2 17 Tf 36 %d Td 22 TL ' % (H - 150) + ' '.join('(%s) Tj T*' % l for l in lines) + ' ET '
            cs += 'BT /F1 13 Tf 36 %d Td (%s) Tj ET ' % (H - 170 - 22 * len(lines), ascii_text(author))
            cs += 'BT /F1 10 Tf 36 60 Td (%s) Tj ET' % ascii_text(publisher or 'Verlag')
        c1 = add(b'<< /Length %d >>\nstream\n' % len(cs) + cs.encode('latin-1') + b'\nendstream')
        page_ids.append(add(b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Resources << /Font << /F1 %d 0 R /F2 %d 0 R >> >> /Contents %d 0 R >>' % (W, H, font, bold, c1)))
    body = body_text(title, lang)
    lines = [body[i:i + 60] for i in range(0, len(body), 60)][:14]
    txt = 'BT /F1 11 Tf 36 %d Td 14 TL ' % (H - 60) + ' '.join('(%s) Tj T*' % l for l in lines) + ' ET'
    c2 = add(b'<< /Length %d >>\nstream\n' % len(txt) + txt.encode('latin-1') + b'\nendstream')
    for _ in range(max(0, pages - 1)):
        page_ids.append(add(b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>' % (W, H, font, c2)))
    info = add(('<< /Title %s /Author %s /Language (%s) >>' % (pdf_str(title), pdf_str(author), lang)).encode('latin-1'))
    objs[0] = b'<< /Type /Catalog /Pages 2 0 R >>'
    objs[1] = ('<< /Type /Pages /Kids [%s] /Count %d >>' % (' '.join('%d 0 R' % p for p in page_ids), len(page_ids))).encode('latin-1')
    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out)); out += b'%d 0 obj\n' % i + o + b'\nendobj\n'
    x = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1)
    for o in offs: out += b'%010d 00000 n \n' % o
    out += b'trailer\n<< /Size %d /Root 1 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, info, x)
    with open(path, 'wb') as f: f.write(out)

def xml_escape(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')

def write_epub(path, title, author, lang, seed, cover=True, chapters=6):
    """EPUB 3 (with the EPUB 2 cover meta as well): a cover image or none, a few chapters of text."""
    uid = 'urn:uuid:' + hashlib.md5((title + author).encode()).hexdigest()
    items, spine, nav = [], [], []
    xhtml = lambda head, body, extra='': ('<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="%s">'
                                         '<head><title>%s</title></head><body>%s%s</body></html>') % (lang, xml_escape(head), extra, body)
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml', '<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                   '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', compress_type=zipfile.ZIP_DEFLATED)
        if cover:
            jpg, _, _ = cover_jpeg(title, author, seed)
            z.writestr('OEBPS/cover.jpg', jpg, compress_type=zipfile.ZIP_STORED)
            items.append('<item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>')
            z.writestr('OEBPS/cover.xhtml', xhtml('Cover', '<div><img src="cover.jpg" alt="%s"/></div>' % xml_escape(title)), compress_type=zipfile.ZIP_DEFLATED)
            items.append('<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>')
            spine.append('<itemref idref="cover"/>')
        for c in range(1, chapters + 1):
            head = ('Kapitel %d' if lang == 'de' else 'Chapter %d') % c
            para = ('<p>Dieses Kapitel erzählt von %s. Es beginnt an einem stillen Morgen und endet am Abend.</p>' if lang == 'de'
                    else '<p>This chapter tells of %s. It begins on a quiet morning and ends in the evening.</p>') % xml_escape(title)
            z.writestr('OEBPS/ch%d.xhtml' % c, xhtml(head, para * 40, '<h1>%s</h1>' % head), compress_type=zipfile.ZIP_DEFLATED)
            items.append('<item id="ch%d" href="ch%d.xhtml" media-type="application/xhtml+xml"/>' % (c, c))
            spine.append('<itemref idref="ch%d"/>' % c)
            nav.append('<li><a href="ch%d.xhtml">%s</a></li>' % (c, head))
        z.writestr('OEBPS/nav.xhtml', xhtml(title, '<nav epub:type="toc"><ol>%s</ol></nav>' % ''.join(nav)), compress_type=zipfile.ZIP_DEFLATED)
        items.append('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>')
        opf = ('<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">'
               '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">%s</dc:identifier><dc:title>%s</dc:title><dc:creator>%s</dc:creator>'
               '<dc:language>%s</dc:language>%s<meta property="dcterms:modified">2024-01-01T00:00:00Z</meta></metadata>'
               '<manifest>%s</manifest><spine>%s</spine></package>') % (uid, xml_escape(title), xml_escape(author), lang,
                                                                        '<meta name="cover" content="cover-image"/>' if cover else '', ''.join(items), ''.join(spine))
        z.writestr('OEBPS/content.opf', opf, compress_type=zipfile.ZIP_DEFLATED)

def safe(s):
    return ''.join('_' if c in '<>:"/\\|?*' else c for c in s)

def html_page(title):
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>%s</title></head><body><h1>%s</h1>' % (title, title) +
            '<p>' + ('A saved article about a small technical subject, kept for later reading. ' * 40) + '</p></body></html>')

def file_name(title, author, ext):
    style = rnd.random()
    if style < 0.15:
        return f'{safe(title)[:110]} -- {author} -- {rnd.randint(1990, 2024)} -- {PUBLISHERS[rnd.randrange(len(PUBLISHERS))]} -- {hashlib.md5(title.encode()).hexdigest()} -- Example Archive.{ext}'
    if style < 0.25: return safe(title)[:120].replace(' ', '_') + '.' + ext
    return f'{safe(title)[:150]} - {author}.{ext}'

def main():
    if os.path.exists(ROOT): shutil.rmtree(ROOT)
    os.makedirs(ROOT)
    manifest = []
    used = set()
    long_by_folder = {}
    for folder, title, lang in LONG: long_by_folder.setdefault(folder, []).append((title, lang))
    for folder, (n, de, en) in T.items():
        d = os.path.join(ROOT, *folder.split('/')) if folder else ROOT
        os.makedirs(d, exist_ok=True)
        extra = long_by_folder.get(folder, [])
        for i in range(n):
            if i < len(extra): title, lang = extra[i]
            else:
                lang = 'en' if (not de) or (en and rnd.random() < 0.25) else 'de'
                pool = en if lang == 'en' else de
                base = pool[i % len(pool)]
                subs = SUBS_EN if lang == 'en' else SUBS_DE
                title = base if base not in used else f'{base}: {subs[(i * 7 + len(folder)) % len(subs)]}'
            if title in used: title = f'{title} ({i})'
            used.add(title)
            authors = AUTHORS_EN if lang == 'en' else AUTHORS_DE
            author = authors[rnd.randrange(len(authors))]
            pages = int(rnd.choice([rnd.randint(60, 180), rnd.randint(180, 360), rnd.randint(300, 620)]))
            seed = int(hashlib.md5(title.encode()).hexdigest()[:6], 16)
            k = rnd.random()
            # most books are PDFs with a cover; some PDFs start with a title page or an empty page (no cover), a few are
            # broken; EPUBs with a cover image and without
            kind = 'pdf' if k < 0.78 else 'titlepage' if k < 0.86 else 'blank' if k < 0.875 else 'broken' if k < 0.905 else 'epub' if k < 0.965 else 'epub-nocover'
            ext = 'epub' if kind.startswith('epub') else 'pdf'
            p = os.path.join(d, file_name(title, author, ext))
            if kind == 'broken':
                with open(p, 'wb') as f: f.write(b'%PDF-1.4\n' + bytes(rnd.getrandbits(8) for _ in range(3000)))   # broken -> title card
            elif ext == 'pdf':
                write_pdf(p, title, author, pages, seed, lang, first={'pdf': 'image', 'titlepage': 'text', 'blank': 'blank'}[kind], publisher=PUBLISHERS[seed % len(PUBLISHERS)])
            else:
                write_epub(p, title, author, lang, seed, cover=kind == 'epub', chapters=4 + seed % 6)
            manifest.append({'rel': os.path.relpath(p, ROOT), 'title': title, 'kind': kind, 'pages': pages, 'lang': lang})
    for folder, names in PAGES.items():
        d = os.path.join(ROOT, *folder.split('/'))
        os.makedirs(d, exist_ok=True)
        for name in names:
            with open(os.path.join(d, name + '.htm'), 'w', encoding='utf-8') as f: f.write(html_page(name))
            res = os.path.join(d, name + '-Dateien')
            os.makedirs(os.path.join(res, 'anchor_data'), exist_ok=True)
            for junk in ['a.htm', 'anchor.htm', 'button.htm', 'anchor_data/a.htm']:
                with open(os.path.join(res, *junk.split('/')), 'w', encoding='utf-8') as f: f.write('<html><body>' + 'x' * 900 + '</body></html>')
            for asset in ['app.js', 'style.css']:
                with open(os.path.join(res, asset), 'w') as f: f.write('/* */' + ' ' * 800)
            manifest.append({'rel': os.path.relpath(os.path.join(d, name + '.htm'), ROOT), 'title': name, 'kind': 'html'})
    # notes and scripts that are not books
    for folder in ['Naturwissenschaften', 'Schach']:
        for n in ['_Hinweise.txt', '_Doppelte.txt', '_Noch-pruefen.txt']:
            with open(os.path.join(ROOT, folder, n), 'w', encoding='utf-8') as f: f.write('Notiz ' * 200)
    for n in ['Aufräumen.bat', 'aufraeumen.ps1', '_Liste.csv']:
        with open(os.path.join(ROOT, 'Schach', n), 'w', encoding='utf-8') as f: f.write('rem ' * 300)
    os.makedirs(os.path.join(ROOT, '$Temp', 'Trash'), exist_ok=True)
    # must-read picks for the shortcuts (20 per folder, books with a cover)
    lnk = []
    for top in ['Naturwissenschaften', 'Schach']:
        cands = [m for m in manifest if m['rel'].startswith(top + os.sep) and m['kind'] == 'pdf' and 'Gehört nicht hierher' not in m['rel']]
        picks = random.Random(top).sample(cands, 20)
        os.makedirs(os.path.join(ROOT, top, '00 Must-Read'), exist_ok=True)
        for m in picks:
            lnk.append({'lnk': os.path.join(ROOT, top, '00 Must-Read', safe(m['title'])[:80] + '.lnk'), 'target': os.path.join(ROOT, m['rel'])})
    json.dump({'books': manifest, 'lnk': lnk}, open(os.path.join(os.path.dirname(ROOT), 'manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    kinds = {}
    for m in manifest: kinds[m['kind']] = kinds.get(m['kind'], 0) + 1
    deps = sorted({m['rel'].split(os.sep)[0] for m in manifest if os.sep in m['rel']})
    print('books', len(manifest), 'kinds', json.dumps(kinds), 'departments', len(deps), 'english', sum(1 for m in manifest if m.get('lang') == 'en'), 'lnk', len(lnk))

main()
