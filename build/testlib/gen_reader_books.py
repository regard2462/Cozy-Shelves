# Test books for the text view of PDFs (Cozy Shelves 0.7): a German and an English book laid out like printed books, so that
# the reflowed text can be compared with what was set. Every text here is invented for the tests.
#
#   python build/testlib/gen_reader_books.py <folder>
#       <folder>/lib/Sachbuch/Der Fluss im Jahreslauf.pdf   German, 15 pages (see below)
#       <folder>/lib/Englisch/The River Year.pdf            English, 7 pages, text in TJ arrays with kerning (LaTeX style)
#       <folder>/lib/Romane/Am Ufer.epub                    German EPUB with enough text for several pages
#       <folder>/reader-truth.json                          per book: pages, headings, paragraphs, notes, figures, lists
#
# The German book (word processor style: one string per line, justified with word spacing Tw, 6 x 9 inch):
#   a title page, running heads (book title on even pages, chapter on odd pages) and page numbers, chapter headings,
#   section headings in bold, italic and bold words inside paragraphs, hyphenation at line ends and one hyphenated word
#   split across a page break, footnotes with raised markers under a short rule, a bulleted and a numbered list, a
#   photo (raster image) and a bar chart (vector paths with labels) with captions, a chapter set in two columns, a
#   scanned page (only a picture of text), a page in a font with a broken ToUnicode map (the text layer is junk), an
#   outline (bookmarks) for the chapters.
import io, json, math, os, random, re, sys, zipfile, zlib

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib.colors import Color
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

PAGE_W, PAGE_H = 432, 648
M_IN, M_OUT, M_TOP, M_BOT = 54, 54, 72, 72
TEXT_W = PAGE_W - M_IN - M_OUT

# ------------------------------------------------------------------------------------------------------- texts
# '|' marks where a long word may be hyphenated at a line end, *…* is italic, **…** bold, ^n a footnote marker.
DE_CHAPTERS = [
    ('Frühling am Fluss', [
        ('p', 'Wenn im März das Eis auf dem Fluss bricht, beginnt für die Menschen am Ufer ein neues Jahr. Die '
              'Strömung trägt große Schollen talwärts, und an den Rändern sammelt sich Treib|holz, das die Kinder des '
              'Dorfes mit langen Stangen herausfischen. Wer genau hinsieht, entdeckt schon die ersten grünen Spitzen '
              'im Schilf.'),
        ('p', 'Die alten Fischer nennen diese Wochen die *stille Zeit*, weil das Wasser noch zu kalt für die meisten '
              'Fische ist. Sie flicken ihre Netze, streichen die Boote und warten auf den ersten warmen Regen. Erst wenn '
              'die Weiden am Damm blühen, fahren sie wieder hinaus.^1'),
        ('h2', 'Was im Frühling zu tun ist'),
        ('p', 'Für den Garten am Fluss gilt eine einfache Regel: Man beginnt mit dem Boden und endet mit den Pflanzen. '
              'Die folgenden Arbeiten haben sich über viele Jahre bewährt.'),
        ('ul', 'Die Beete von altem Laub befreien und den Kompost verteilen.'),
        ('ul', 'Die Obst|bäume schneiden, solange die Knospen noch geschlossen sind.'),
        ('ul', 'Die Regentonne reinigen und an die Dach|rinne anschließen.'),
        ('p', 'Ein Garten am Wasser braucht im Frühling mehr Geduld als andere Gärten. Der Boden bleibt lange feucht und '
              'kalt, und wer zu früh sät, verliert die Saat an die Nässe. Erfahrene Gärtnerinnen warten deshalb, bis '
              'sich die Erde in der Hand krümelig anfühlt.'),
        ('fig', 'photo', 'Abb. 1: Der Fluss am Morgen, kurz nach der Schnee|schmelze.'),
        ('p', 'Am Morgen liegt oft Nebel über dem Wasser. Er hebt sich langsam, sobald die Sonne über den Hügel steigt, '
              'und gibt den Blick auf die gegenüber|liegenden Wiesen frei. In diesen Stunden ist der Fluss am '
              'schönsten, und viele Bewohner gehen vor der Arbeit eine Runde am Ufer entlang.'),
        ('p', 'Die Vögel kehren in dieser Zeit aus dem Süden zurück. Zuerst kommen die Stare, dann die Bach|stelzen und '
              'zuletzt die Schwalben, die unter den Brücken ihre Nester bauen. Wer ein Fernglas mitnimmt, kann an einem '
              'einzigen Vormittag ein Dutzend Arten beobachten.^2'),
        ('p', 'Mit den Vögeln kommen die Wanderer. Der Weg am Fluss ist im **Frühling** besonders beliebt, weil er eben '
              'verläuft und an vielen Stellen Bänke zum Ausruhen bietet. Die Gemeinde hat im letzten Jahr neue '
              'Hinweis|tafeln aufgestellt, die von der Geschichte der Mühlen und Brücken erzählen.'),
    ], {1: 'Schon im Mittelalter galt die Weidenblüte als Zeichen für den Beginn der Fischerei.',
        2: 'Eine Liste der Arten liegt in der Bibliothek am Marktplatz aus.'}),
    ('Sommer', [
        ('p', 'Im Sommer wird der Fluss zum Treffpunkt des ganzen Ortes. An den flachen Stellen baden die Kinder, auf den '
              'Wiesen liegen Decken, und am Abend riecht es nach Holzfeuer. Das Wasser ist dann warm genug, um eine '
              'Stunde darin zu schwimmen, ohne zu frieren.'),
        ('p', 'Die Temperatur des Wassers wird seit vielen Jahren an der alten Brücke gemessen. Die folgende Grafik zeigt '
              'die mittleren Werte der Sommer|monate. Der Juli ist meistens der wärmste Monat, doch in trockenen Jahren '
              'erreicht der August ähnliche Werte.^3'),
        ('fig', 'chart', 'Abb. 2: Mittlere Wasser|temperatur im Sommer, gemessen an der alten Brücke.'),
        ('p', 'Ein langer Sommer|abend am Fluss endet oft mit einem Gewitter. Die Wolken ziehen schnell über die Hügel, '
              'der Wind dreht, und innerhalb weniger Minuten fällt schwerer Regen. Danach ist die Luft klar und kühl, '
              'und über dem Wasser steigen feine Dampf|schwaden auf, die im Licht der Laternen schimmern. Die Fischer '
              'sagen, dass die Fische nach einem Gewitter besonders gut beißen, weil der Regen Insekten und kleine '
              'Tiere ins Wasser spült. Viele von ihnen fahren deshalb noch spät in der Nacht hinaus und kehren erst '
              'im Morgen|grauen zurück, wenn die ersten Vögel singen und die Bäcker im Dorf ihre Öfen anheizen.'),
        ('p', 'Wer im Sommer am Fluss zeltet, sollte einige Dinge beachten. Das Ufer gehört allen, und die '
              'Gemeinde bittet darum, die Wiesen so zu verlassen, wie man sie vorgefunden hat.'),
        ('ol', 'Feuer nur an den gemauerten Stellen entzünden.'),
        ('ol', 'Den Abfall wieder mitnehmen, auch kleine Reste.'),
        ('ol', 'Nach zehn Uhr am Abend leise sein, denn die Häuser liegen nah am Wasser.'),
        ('p', 'In manchen Jahren führt der Fluss im August so wenig Wasser, dass man ihn an der Furt zu Fuß durchqueren '
              'kann. Dann zeigen sich die Reste der alten Holz|brücke, die vor zweihundert Jahren bei einem Hochwasser '
              'zerstört wurde. Die Pfähle stehen noch immer im Grund und erinnern daran, wie mächtig der Fluss im '
              'Frühjahr werden kann.'),
        ('p', 'Zum Ende des Sommers werden die Tage merklich kürzer. Die Schwalben sammeln sich auf den Leitungen, und '
              'an den Abenden steigt früher Nebel aus den Wiesen auf. Die Kinder verabschieden sich vom Baden, und die '
              'Boote werden für den Herbst vorbereitet.'),
    ], {3: 'Die Messungen werden jeden Morgen um sieben Uhr in einem Meter Tiefe vorgenommen.'}),
    ('Herbst', [
        ('p', 'Der Herbst färbt die Bäume am Ufer in kurzer Zeit gelb und rot. Die Ahorne leuchten zuerst, später folgen '
              'die Eichen und die Weiden. An windigen Tagen treibt das Laub in dichten Teppichen auf dem Wasser und '
              'sammelt sich in den Buchten.'),
        ('p', 'Für die Fischer beginnt jetzt die beste Zeit des Jahres. Die Fische fressen sich für den Winter satt und '
              'stehen in den tieferen Gumpen, wo die Strömung langsamer ist. Mit etwas Glück fängt man an einem Tag '
              'genug für eine ganze Woche.^4'),
        ('p', 'In den Gärten wird geerntet, was der Sommer übrig gelassen hat. Äpfel und Birnen lagern in den Kellern, '
              'die Kürbisse trocknen auf den Fensterbänken, und aus den letzten Tomaten wird Soße gekocht. Die Beete '
              'bekommen eine Decke aus Laub, die den Boden im Winter schützt.'),
        ('p', 'Mit dem ersten Frost ändert sich der Klang des Flusses. Das Wasser wird klarer und dunkler, und an kalten '
              'Morgen liegt Raureif auf den Gräsern am Ufer. Die Zugvögel sind fort, und nur die Enten und Reiher '
              'bleiben über den Winter.'),
        ('p', 'Im Oktober feiert das Dorf das Fest der Mühlen. Die alten Wasser|räder werden noch einmal in Gang gesetzt, '
              'und die Besucher können zusehen, wie aus Korn Mehl wird. Am Abend gibt es Brot aus dem Holzofen und Musik '
              'auf dem Platz vor der Kirche.'),
        ('p', 'Wenn die Tage kürzer werden, kehrt Ruhe am Fluss ein. Die Bänke am Weg bleiben leer, die Boote liegen '
              'kopfüber am Ufer, und nur noch wenige Spazier|gänger sind unterwegs. Für viele Bewohner ist das die '
              'liebste Zeit, weil man den Fluss dann fast für sich allein hat.'),
    ], {4: 'Gefischt werden darf nur mit einem gültigen Schein der Gemeinde.'}),
    ('Winter', [
        ('p', 'Im Winter friert der Fluss nur in sehr kalten Jahren ganz zu. Meistens bildet sich lediglich am Rand eine '
              'dünne Eisschicht, die bei Sonne schnell wieder taut. Die Gemeinde warnt jedes Jahr davor, das Eis zu '
              'betreten, denn die Strömung darunter macht es unberechenbar.'),
        ('scan', ''),
        ('junk', ''),
        ('p', 'Wenn der Schnee liegt, verwandeln sich die Wiesen am Ufer in eine weiße Fläche, auf der man die Spuren '
              'der Tiere lesen kann. Füchse, Rehe und Hasen kommen bis an das Wasser, um zu trinken. Am Morgen nach '
              'einer Neuschnee|nacht sind ihre Wege besonders deutlich zu sehen.'),
        ('p', 'Die langen Abende verbringen viele Menschen im Dorf mit Büchern. Die Bibliothek am Marktplatz hat im '
              'Winter länger geöffnet und lädt jeden Donnerstag zu einer Lesung ein. Oft geht es dabei um den Fluss und '
              'die Geschichten, die man sich über ihn erzählt.'),
        ('p', 'So schließt sich der Kreis des Jahres. Wenn im März das Eis wieder bricht, beginnt alles von vorn, und '
              'die Menschen am Ufer freuen sich auf einen neuen Frühling.'),
    ], {}),
]

EN_CHAPTERS = [
    ('A Morning by the River', [
        ('p', 'The river wakes up slowly. In the first light the water is grey and still, and a thin mist hangs above '
              'the reeds. Then the sun climbs over the hills, the mist lifts, and the surface begins to *sparkle* like '
              'a field of small mirrors.'),
        ('p', 'An old ferryman has crossed this river every morning for forty years. He knows every stone on the bottom '
              'and every eddy near the bank, and he says that the water never looks the same on two days.^1'),
        ('fig', 'photo', 'Figure 1: The river in the early morning, seen from the ferry landing.'),
        ('p', 'Along the path on the eastern bank there are benches every few hundred metres. They were built by the '
              'village carpenter from oak that fell in a storm, and each of them carries a small brass plate with the '
              'name of a bird that lives nearby.'),
        ('h2', 'Things to take on a walk'),
        ('ul', 'A pair of binoculars for the herons and kingfishers.'),
        ('ul', 'A small notebook to write down what you see.'),
        ('ul', 'Warm socks, because the meadows stay wet until noon.'),
        ('p', 'Walking along the river is the best way to understand how the landscape changes with the seasons. In '
              'spring the meadows flood, in summer they turn yellow, and in autumn the first frost covers them with a '
              'fine white **crust** that melts by mid-morning.'),
    ], {1: 'The ferry was replaced by a bridge in the same year, but the ferryman still rows across for visitors.'}),
    ('Notes from the Library', [
        ('p', 'The village library keeps a shelf of books about the river. Some of them are more than a hundred years old '
              'and describe the mills, the floods and the fishing rights in great detail. Others are diaries of people '
              'who lived on the bank and wrote down the weather every day.'),
        ('p', 'Reading these diaries in winter is a quiet pleasure. The handwriting is often hard to decipher, but the '
              'small observations make the past feel close: a late frost that killed the blossoms, a heron that stood '
              'in the same place for a week, a child who fell through the ice and was rescued by a neighbour.'),
        ('p', 'The librarian has started to copy the diaries into a single volume, so that the stories are not lost. '
              'She works on it every Thursday evening, when the reading room is open for anyone who wants to help with '
              'the transcription or simply listen to the old entries being read aloud.'),
        ('p', 'Visitors who come in summer often ask why the library is so close to the water. The answer is simple: the '
              'building was once the miller\'s house, and the reading room was the place where the grain was weighed '
              'before it went to the stones.'),
    ], {}),
]

DE_EPUB = [
    'Am Ufer stand ein kleines Haus mit grünen Fensterläden. Seit vielen Jahren wohnte dort eine Bibliothekarin, die '
    'jeden Morgen mit einer Tasse Tee auf der Bank vor der Tür saß und dem Fluss zusah.',
    'Sie kannte die Geschichten aller Häuser am Wasser. Sie wusste, wer die alte Mühle gebaut hatte, warum die Brücke '
    'zweimal erneuert werden musste und welcher Fischer im großen Hochwasser drei Kühe gerettet hatte.',
    'Im Sommer kamen oft Kinder zu ihr, die Bücher über Tiere und Pflanzen suchten. Sie gab ihnen nicht nur die '
    'Bücher, sondern ging mit ihnen ans Ufer und zeigte ihnen, wo die Ringelnatter in der Sonne lag und wo der '
    'Eisvogel seine Höhle hatte.',
    'Im Herbst sortierte sie die Bücher neu. Sie stellte die Romane an die Wand mit dem Fenster, weil man dort am '
    'besten lesen konnte, und die Sachbücher in den hinteren Raum, wo es ruhig war und nach Papier roch.',
    'Im Winter las sie selbst am meisten. Sie zündete den Ofen an, legte eine Decke über die Knie und las Abend für '
    'Abend, bis das Feuer heruntergebrannt war und die Kälte langsam durch die Ritzen der Tür kroch.',
    'Eines Tages brachte ihr ein Junge ein altes Heft, das er unter den Dielen seines Elternhauses gefunden hatte. Es '
    'war das Tagebuch eines Müllers, der vor zweihundert Jahren am Fluss gelebt hatte, und es enthielt jeden Tag '
    'einen Satz über das Wetter und das Wasser.',
    'Die Bibliothekarin las das Heft in einer Nacht. Am Morgen ging sie zum Fluss und stellte fest, dass sich manches '
    'kaum verändert hatte: die Weiden, die Strömung an der Biegung, das Licht auf dem Wasser kurz vor Sonnenaufgang.',
    'Sie beschloss, das Tagebuch abzuschreiben und in der Bibliothek auszulegen. Bald kamen Leute aus dem ganzen Dorf, '
    'um darin zu lesen, und manche brachten eigene Hefte und Briefe mit, die sie auf Dachböden gefunden hatten.',
    'So entstand mit der Zeit eine kleine Sammlung über das Leben am Fluss. Sie füllte zuerst ein Regal, dann zwei, '
    'und schließlich bekam sie einen eigenen Raum mit einem großen Tisch, an dem man die alten Seiten ausbreiten konnte.',
    'Wer heute die Bibliothek besucht, kann dort an jedem Nachmittag sitzen und lesen. Durch das Fenster sieht man den '
    'Fluss, und manchmal, wenn es ganz still ist, hört man das Wasser an den Steinen der alten Mühle rauschen.',
]


def plain(t):
    return t.replace('|', '').replace('**', '').replace('*', '')


# ------------------------------------------------------------------------------------------------------- fonts
def find_font(names):
    for d in (r'C:\Windows\Fonts', '/usr/share/fonts/truetype/dejavu', '/usr/share/fonts/TTF', '/Library/Fonts'):
        for n in names:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return p
    return None


def register_serif():
    """DejaVu Serif (embedded TrueType, names like DejaVuSerif-Bold) when it is installed, else the Times of PDF."""
    files = {'R': find_font(['DejaVuSerif.ttf']), 'B': find_font(['DejaVuSerif-Bold.ttf']),
             'I': find_font(['DejaVuSerif-Italic.ttf']), 'BI': find_font(['DejaVuSerif-BoldItalic.ttf'])}
    if all(files.values()):  # noqa
        for k, p in files.items():
            pdfmetrics.registerFont(TTFont('DVS-' + k, p))
        return {'R': 'DVS-R', 'B': 'DVS-B', 'I': 'DVS-I', 'BI': 'DVS-BI'}
    return None


TIMES = {'R': 'Times-Roman', 'B': 'Times-Bold', 'I': 'Times-Italic', 'BI': 'Times-BoldItalic'}


# ------------------------------------------------------------------------------------------------------- inline runs
def runs_of(text):
    """'a *b* **c** d^1' -> [(word, style, note)] with style R/I/B/BI; hyphenation marks kept in the words."""
    out = []
    style_i = style_b = False
    for raw in text.split(' '):
        w = raw
        note = None
        opens_b = w.startswith('**')
        if opens_b:
            style_b = True
            w = w[2:]
        opens_i = w.startswith('*') and not w.startswith('**')
        if opens_i:
            style_i = True
            w = w[1:]
        closes_b = '**' in w
        w = w.replace('**', '')
        closes_i = '*' in w
        w = w.replace('*', '')
        if '^' in w:
            w, n = w.split('^')
            note = int(n)
        style = ('B' if style_b else '') + ('I' if style_i else '') or 'R'
        out.append((w, style, note))
        if closes_b:
            style_b = False
        if closes_i:
            style_i = False
    return out


class Layout:
    """Lines of words in mixed styles, with hyphenation at the '|' marks."""

    def __init__(self, fonts, size, lead):
        self.fonts, self.size, self.lead = fonts, size, lead

    def width(self, word, style, size=None):
        return pdfmetrics.stringWidth(word.replace('|', ''), self.fonts[style], size or self.size)

    def break_runs(self, runs, max_w, first_indent=0.0, force_at=None):
        """-> [{'words': [(text, style, note)], 'hyph': bool}]; force_at: the index of a word with a hyphenation mark
        that ends its line hyphenated at its first mark"""
        lines, cur, cur_w = [], [], 0.0
        space = self.width(' ', 'R')
        note_w = self.width('0', 'R', self.size * 0.62)
        i = 0
        runs = list(runs)
        avail = max_w - first_indent
        while i < len(runs):
            word, style, note = runs[i]
            if i == force_at and '|' in word:
                head, rest = word.split('|', 1)
                cur.append((head + '-', style, None))
                lines.append({'words': cur, 'hyph': True, 'forced': True})
                runs[i] = (rest, style, note)
                cur, cur_w, avail, force_at = [], 0.0, max_w, None
                continue
            ww = self.width(word, style) + (note_w if note else 0)
            add = ww + (space if cur else 0)
            if cur_w + add <= avail:
                cur.append((word.replace('|', ''), style, note))
                cur_w += add
                i += 1
                continue
            parts = word.split('|')
            done = False
            for k in range(len(parts) - 1, 0, -1):
                head = ''.join(parts[:k]) + '-'
                hw = self.width(head, style) + (space if cur else 0)
                if cur_w + hw <= avail:
                    cur.append((head, style, None))
                    lines.append({'words': cur, 'hyph': True})
                    runs[i] = ('|'.join(parts[k:]), style, note)
                    cur, cur_w, avail = [], 0.0, max_w
                    done = True
                    break
            if done:
                continue
            if not cur:
                cur.append((word.replace('|', ''), style, note))
                i += 1
            lines.append({'words': cur, 'hyph': False})
            cur, cur_w, avail = [], 0.0, max_w
        if cur:
            lines.append({'words': cur, 'hyph': False})
        return lines


# ------------------------------------------------------------------------------------------------------- pictures
def landscape(w, h, rnd):
    img = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=(int(120 + 100 * t), int(160 + 60 * t), int(230 - 30 * t)))
    for k, col in enumerate([(96, 150, 92), (60, 120, 70)]):
        pts = [(0, h)]
        base = h * (0.45 + 0.1 * k)
        for x in range(0, w + 20, 20):
            pts.append((x, base - 30 * math.sin(x / (70 + 40 * k) + k) - rnd.uniform(0, 8)))
        pts.append((w, h))
        d.polygon(pts, fill=col)
    d.rectangle((0, int(h * 0.68), w, h), fill=(70, 120, 175))
    for i in range(30):
        y = rnd.uniform(h * 0.7, h)
        x = rnd.uniform(0, w)
        d.line([(x, y), (x + rnd.uniform(10, 40), y)], fill=(200, 220, 240), width=2)
    return img.filter(ImageFilter.GaussianBlur(0.8))


def text_image(lines, size_px, w, h):
    """A grey page with dark text, slightly blurred: a scan without OCR."""
    img = Image.new('L', (w, h), 238)
    d = ImageDraw.Draw(img)
    fp = find_font(['times.ttf', 'LiberationSerif-Regular.ttf', 'DejaVuSerif.ttf'])
    f = ImageFont.truetype(fp, size_px) if fp else ImageFont.load_default()
    y = int(h * 0.11)
    for line in lines:
        d.text((int(w * 0.13), y), line, fill=40, font=f)
        y += int(size_px * 1.45)
    return img.filter(ImageFilter.GaussianBlur(0.7))


# ------------------------------------------------------------------------------------------------------- the book writer
class Book:
    def __init__(self, path, fonts, title, lang, size=10.5, lead=14.2, head_fonts=None):
        self.c = canvas.Canvas(path, pagesize=(PAGE_W, PAGE_H))
        self.c.setTitle(title)
        self.c.setAuthor('Testautorin' if lang == 'de' else 'Test Author')
        self.c.setSubject('Testbuch')
        self.c._doc.info.title = title
        self.fonts = fonts
        self.title = title
        self.lang = lang
        self.L = Layout(fonts, size, lead)
        self.size, self.lead = size, lead
        self.page = 0              # 1-based number of the current page
        self.y = None
        self.chapter = ''
        self.notes_here = []       # footnotes waiting for the foot of this page
        self.truth = {'title': title, 'lang': lang, 'pages': [], 'headings': [], 'paragraphs': [], 'notes': [],
                      'figures': [], 'lists': []}
        self.columns = None        # (x0, width) of the column in use, or None for the full text width
        self.col_index = 0
        self.rnd = random.Random(11)
        self.junk = []             # (page index, lines) of the pages with the broken font
        self.path = path

    # ---- pages
    def new_page(self, kind='text', head=True):
        if self.page:
            self.finish_page()
        self.page += 1
        self.y = PAGE_H - M_TOP
        self.notes_here = []
        self.truth['pages'].append({'page': self.page, 'kind': kind})
        self.page_head = head
        self.page_chapter = self.chapter

    def finish_page(self):
        c = self.c
        if self.notes_here:
            # the footnotes: a short rule, then the notes in a smaller size
            y = M_BOT + 4 + len(self.notes_here) * 11
            c.setLineWidth(0.5)
            c.line(M_IN, y + 8, M_IN + 90, y + 8)
            for n, text in self.notes_here:
                c.setFont(self.fonts['R'], 5.5)
                c.drawString(M_IN, y + 2.5, str(n))
                c.setFont(self.fonts['R'], 8.5)
                c.drawString(M_IN + 6, y, text)
                y -= 11
        if self.page_head and self.page > 1:
            head = self.title if self.page % 2 == 0 else self.page_chapter
            c.setFont(self.fonts['I'], 8.5)
            if self.page % 2 == 0:
                c.drawString(M_IN, PAGE_H - 44, head)
            else:
                c.drawRightString(PAGE_W - M_OUT, PAGE_H - 44, head)
            c.setFont(self.fonts['R'], 9)
            c.drawCentredString(PAGE_W / 2, 40, str(self.page))
        c.showPage()

    def space_left(self):
        return self.y - (M_BOT + (len(self.notes_here) * 11 + 18 if self.notes_here else 0))

    def need(self, h):
        if self.space_left() < h:
            if self.columns and self.col_index == 0:
                self.col_index = 1
                self.y = self.col_top
            else:
                self.col_index = 0
                self.new_page()
                if self.columns:
                    self.col_top = self.y

    def col(self):
        if not self.columns:
            return M_IN, TEXT_W
        gap = 18
        w = (TEXT_W - gap) / 2
        return M_IN + self.col_index * (w + gap), w

    # ---- text
    def draw_line(self, x, y, words, width, justify, size=None):
        """One line as one string per style segment, justified with Tw (word spacing), markers raised."""
        c = self.c
        size = size or self.size
        space = self.L.width(' ', 'R', size)
        natural = sum(self.L.width(w, s, size) for w, s, n in words) + space * (len(words) - 1)
        notes_w = sum(self.L.width('0', 'R', size * 0.62) for w, s, n in words if n)
        tw = (width - natural - notes_w) / max(1, len(words) - 1) if justify and len(words) > 1 else 0
        t = c.beginText()
        t.setTextOrigin(x, y)
        t.setWordSpace(tw)
        seg_style, seg = None, []

        def flush():
            if seg:
                t.setFont(self.fonts[seg_style], size)
                t.textOut(' '.join(seg))

        for i, (w, s, n) in enumerate(words):
            if s != seg_style:
                flush()
                if seg_style is not None:
                    t.setFont(self.fonts[seg_style], size)
                    t.textOut(' ')
                seg_style, seg = s, []
            seg.append(w)
            if n:
                flush()
                seg = []
                t.setFont(self.fonts['R'], size * 0.62)
                t.setRise(size * 0.38)
                t.textOut(str(n))
                t.setRise(0)
                if i < len(words) - 1:
                    t.setFont(self.fonts[s], size)
                    t.textOut(' ')
                    seg_style = None
        flush()
        t.setWordSpace(0)   # the word spacing is part of the graphics state and would stretch the next text
        c.drawText(t)

    def paragraph(self, text, indent=True, kind='p', break_in_word=False):
        runs = runs_of(text)
        x0, w = self.col()
        first_indent = 12 if indent else 0
        force = None
        lines = self.L.break_runs(list(runs), w, first_indent)
        if break_in_word:
            # the last line that fits on this page ends with the first part of a hyphenated word, its rest starts the
            # next page: the first word of the following line is split where its first part still fits
            room = int(self.space_left() // self.lead)
            if 1 <= room < len(lines):
                t = room - 1
                j0 = sum(len(l['words']) for l in lines[:t]) - sum(1 for l in lines[:t] if l['hyph'])
                for idx in reversed(range(1, len(lines[t]['words']))):
                    j = j0 + idx
                    word, style, note = runs[j]
                    letters = word.replace('|', '')
                    if len(letters) >= 7 and letters.isalpha():
                        runs = list(runs)
                        runs[j] = (letters[:len(letters) // 2] + '|' + letters[len(letters) // 2:], style, note)
                        lines = self.L.break_runs(runs, w, first_indent, j)
                        break
        start_page = self.page
        cut = next((i for i, l in enumerate(lines) if l.get('forced')), None)
        for i, line in enumerate(lines):
            if cut is not None and i == cut + 1:
                self.y = -1000
            self.need(self.lead)
            x0, w = self.col()
            last = i == len(lines) - 1
            ind = first_indent if i == 0 else 0
            self.draw_line(x0 + ind, self.y - self.size, line['words'], w - ind, not last)
            for w_, s, n in line['words']:
                if n:
                    self.notes_here.append((n, self.notes[n]))
                    self.truth['notes'].append({'n': n, 'page': self.page, 'text': self.notes[n]})
            self.y -= self.lead
        self.y -= 2
        self.truth['paragraphs'].append({'page': start_page, 'text': re.sub(r'\^\d+', '', plain(text)), 'kind': kind,
                                         'endPage': self.page})

    def heading(self, text, level):
        size = 17 if level == 1 else 12.5
        style = 'B'
        x0, w = self.col()
        if level == 1:
            self.y -= 34
        else:
            self.need(size + self.lead * 3)
            self.y -= 8
        self.c.setFont(self.fonts[style], size)
        self.c.drawString(x0, self.y - size, text)
        self.y -= size + (18 if level == 1 else 8)
        self.truth['headings'].append({'page': self.page, 'text': text, 'level': level})

    def list_item(self, text, number=None):
        bullet = '•' if number is None else f'{number}.'
        x0, w = self.col()
        hang = 16
        lines = self.L.break_runs(runs_of(text), w - hang)
        self.need(self.lead * min(2, len(lines)))
        x0, w = self.col()
        self.c.setFont(self.fonts['R'], self.size)
        self.c.drawString(x0 + 3, self.y - self.size, bullet)
        for i, line in enumerate(lines):
            if i:
                self.need(self.lead)
                x0, w = self.col()
            self.draw_line(x0 + hang, self.y - self.size, line['words'], w - hang, False)
            self.y -= self.lead
        self.y -= 1
        self.truth['lists'].append({'page': self.page, 'text': plain(text), 'ordered': number is not None})

    def caption(self, text):
        x0, w = self.col()
        lines = self.L.break_runs([(t, 'I', None) for t in text.split(' ')], w - 20)
        for line in lines:
            ww = sum(self.L.width(t, 'I', 9) for t, s, n in line['words']) + self.L.width(' ', 'R', 9) * (len(line['words']) - 1)
            self.draw_line(x0 + (w - ww) / 2, self.y - 9, line['words'], ww, False, size=9)
            self.y -= 12
        self.y -= 8

    def figure(self, kind, caption):
        x0, w = self.col()
        if kind == 'photo':
            fw = w * 0.9
            fh = fw * 0.56
            self.need(fh + 40)
            x0, w = self.col()
            img = landscape(800, int(800 * 0.56), self.rnd)
            buf = io.BytesIO()
            img.save(buf, 'JPEG', quality=86)
            fx = x0 + (w - fw) / 2
            self.c.drawImage(ImageReader(io.BytesIO(buf.getvalue())), fx, self.y - 6 - fh, fw, fh)
            rect = [fx, PAGE_H - (self.y - 6), fw, fh]
            self.y -= fh + 16
        else:
            fw, fh = w * 0.8, 120
            self.need(fh + 50)
            x0, w = self.col()
            fx = x0 + (w - fw) / 2
            top = self.y - 6
            c = self.c
            c.setLineWidth(0.8)
            c.setStrokeColor(Color(0.2, 0.2, 0.2))
            base = top - fh + 18
            c.line(fx + 24, base, fx + fw, base)
            c.line(fx + 24, base, fx + 24, top)
            vals = [(('Juni' if self.lang == 'de' else 'June'), 17.5), (('Juli' if self.lang == 'de' else 'July'), 21.0), ('August', 20.2), (('September'), 16.1)]
            bw = (fw - 40) / len(vals)
            for i, (label, v) in enumerate(vals):
                bh = (fh - 30) * v / 22
                c.setFillColor(Color(0.25 + 0.15 * i, 0.45, 0.7))
                c.rect(fx + 32 + i * bw, base, bw * 0.7, bh, stroke=0, fill=1)
                c.setFillColor(Color(0, 0, 0))
                c.setFont(self.fonts['R'], 7)
                c.drawCentredString(fx + 32 + i * bw + bw * 0.35, base - 9, label)
                c.drawCentredString(fx + 32 + i * bw + bw * 0.35, base + bh + 3, ('%.1f' % v).replace('.', ',' if self.lang == 'de' else '.'))
            for k in range(0, 25, 5):
                y = base + (fh - 30) * k / 22
                c.drawRightString(fx + 20, y - 2, str(k))
            rect = [fx, PAGE_H - top, fw, fh]
            self.y -= fh + 14
        self.truth['figures'].append({'page': self.page, 'kind': kind, 'rect': [round(v, 1) for v in rect], 'caption': plain(caption)})
        self.caption(caption)

    def scan_page(self, texts):
        """A page that is only a picture of text."""
        self.new_page('scan', head=False)
        lines = []
        for t in texts:
            for line in self.L.break_runs(runs_of(t), TEXT_W):
                lines.append(' '.join(w for w, s, n in line['words']))
            lines.append('')
        img = text_image(lines, 26, 1080, 1620)
        buf = io.BytesIO()
        img.save(buf, 'JPEG', quality=72)
        self.c.drawImage(ImageReader(io.BytesIO(buf.getvalue())), 0, 0, PAGE_W, PAGE_H)
        self.y = M_BOT - 1   # nothing more on this page
        self.truth['figures'].append({'page': self.page, 'kind': 'scan', 'rect': [0, 0, PAGE_W, PAGE_H], 'caption': ''})

    def junk_page(self, texts):
        """A page set in a font whose ToUnicode map moves every letter by seven places: it looks right, its text is
        junk. reportlab leaves an empty page here; fix_junk_pages() writes the font and the text into it."""
        self.new_page('junk', head=False)
        lines = []
        for t in texts:
            for line in self.L.break_runs(runs_of(t), TEXT_W):
                lines.append(' '.join(w for w, st, n in line['words']))
            lines.append('')
        self.junk.append((self.page - 1, lines))
        self.y = M_BOT - 1

    def finish(self, outline):
        self.finish_page()
        self.c.save()
        fix_junk_pages(self.path, self.junk, self.size, self.lead)


def pdf_str(b):
    out = []
    for ch in b:
        if ch in (0x28, 0x29, 0x5C):
            out.append('\\' + chr(ch))
        elif 32 <= ch < 127:
            out.append(chr(ch))
        else:
            out.append('\\%03o' % ch)
    return '(' + ''.join(out) + ')'


def broken_cmap():
    """A ToUnicode CMap that maps every letter seven places further (umlauts and signs onto Latin-1 symbols)."""
    pairs = []
    for code in range(0x20, 0x100):
        ch = bytes([code]).decode('cp1252', errors='replace')
        if 'a' <= ch <= 'z':
            u = ord('a') + (ord(ch) - ord('a') + 7) % 26
        elif 'A' <= ch <= 'Z':
            u = ord('A') + (ord(ch) - ord('A') + 7) % 26
        elif code == 0x20:
            u = 0x20
        else:
            u = 0x00A0 + (code * 7) % 0x5F
        pairs.append('<%02X> <%04X>' % (code, u))
    chunks = []
    for i in range(0, len(pairs), 100):
        part = pairs[i:i + 100]
        chunks.append('%d beginbfchar\n%s\nendbfchar' % (len(part), '\n'.join(part)))
    return ('/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n'
            '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n'
            '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n'
            + '\n'.join(chunks) + '\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n')


def fix_junk_pages(path, junk, size, lead):
    """Writes the broken font and the text into the pages reportlab left empty (PyMuPDF, raw objects)."""
    if not junk:
        return
    import fitz
    doc = fitz.open(path)
    cmap = doc.get_new_xref()
    doc.update_object(cmap, '<< >>')
    doc.update_stream(cmap, broken_cmap().encode('latin-1'))
    font = doc.get_new_xref()
    doc.update_object(font, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode %d 0 R >>' % cmap)
    for index, lines in junk:
        page = doc[index]
        y = PAGE_H - M_TOP
        ops = []
        for line in lines:
            if line:
                ops.append('BT /FB %g Tf 1 0 0 1 %.2f %.2f Tm %s Tj ET' % (size, M_IN, y - size, pdf_str(line.encode('cp1252', 'replace'))))
            y -= lead
        content = doc.get_new_xref()
        doc.update_object(content, '<< >>')
        doc.update_stream(content, '\n'.join(ops).encode('latin-1'))
        doc.xref_set_key(page.xref, 'Contents', '%d 0 R' % content)
        doc.xref_set_key(page.xref, 'Resources', '<< /Font << /FB %d 0 R >> >>' % font)
    doc.save(path + '.tmp', garbage=0)
    doc.close()
    os.replace(path + '.tmp', path)


# ------------------------------------------------------------------------------------------------------- books
def german_book(path, fonts):
    b = Book(path, fonts, 'Der Fluss im Jahreslauf', 'de')
    c = b.c
    # title page
    b.new_page('title', head=False)
    c.setFont(fonts['B'], 24)
    c.drawCentredString(PAGE_W / 2, PAGE_H - 220, 'Der Fluss im Jahreslauf')
    c.setFont(fonts['I'], 13)
    c.drawCentredString(PAGE_W / 2, PAGE_H - 252, 'Beobachtungen am Wasser')
    c.setFont(fonts['R'], 11)
    c.drawCentredString(PAGE_W / 2, PAGE_H - 300, 'Testautorin')
    b.truth['headings'].append({'page': 1, 'text': 'Der Fluss im Jahreslauf', 'level': 1})
    outline = []
    split_done = False
    for ci, (title, blocks, notes) in enumerate(DE_CHAPTERS):
        b.notes = notes
        b.chapter = title
        b.columns = None
        b.new_page()
        c.bookmarkPage('ch%d' % ci)
        c.addOutlineEntry(title, 'ch%d' % ci, level=0)
        outline.append({'title': title, 'page': b.page})
        b.heading(f'{ci + 1}  {title}', 1)
        if title == 'Herbst':
            b.columns = True
            b.col_index = 0
            b.col_top = b.y
        nums = 0
        for blk in blocks:
            kind = blk[0]
            if kind == 'p':
                text = blk[1]
                split = title == 'Sommer' and not split_done and 'Gewitter' in text
                split_done = split_done or split
                b.paragraph(text, break_in_word=split)
            elif kind == 'h2':
                b.heading(blk[1], 2)
            elif kind == 'ul':
                b.list_item(blk[1])
            elif kind == 'ol':
                nums += 1
                b.list_item(blk[1], nums)
            elif kind == 'fig':
                b.figure(blk[1], blk[2])
            elif kind == 'scan':
                b.scan_page([DE_EPUB[0], DE_EPUB[1], DE_EPUB[2]])
                b.truth['scanText'] = [DE_EPUB[0], DE_EPUB[1], DE_EPUB[2]]
            elif kind == 'junk':
                b.junk_page([DE_EPUB[3], DE_EPUB[4]])
                b.new_page()
    b.finish(outline)
    b.truth['outline'] = outline
    b.truth['pageCount'] = b.page
    return b.truth


def english_book(path, fonts):
    """TJ arrays with kerning numbers instead of spaces (LaTeX style): the words of a line are one TJ array per style
    segment, the gaps are negative numbers."""
    b = Book(path, fonts, 'The River Year', 'en', size=10.5, lead=14)
    c = b.c
    tj_book(b)
    b.new_page('title', head=False)
    c.setFont(fonts['B'], 24)
    c.drawCentredString(PAGE_W / 2, PAGE_H - 220, 'The River Year')
    c.setFont(fonts['R'], 11)
    c.drawCentredString(PAGE_W / 2, PAGE_H - 260, 'Test Author')
    b.truth['headings'].append({'page': 1, 'text': 'The River Year', 'level': 1})
    outline = []
    for ci, (title, blocks, notes) in enumerate(EN_CHAPTERS):
        b.notes = notes
        b.chapter = title
        b.columns = ci == 1
        b.col_index = 0
        b.new_page()
        c.bookmarkPage('en%d' % ci)
        c.addOutlineEntry(title, 'en%d' % ci, level=0)
        outline.append({'title': title, 'page': b.page})
        b.columns = None
        b.heading(f'{ci + 1}  {title}', 1)
        if ci == 1:
            b.columns = True
            b.col_top = b.y
        for blk in blocks:
            kind = blk[0]
            if kind == 'p':
                b.paragraph(blk[1])
            elif kind == 'h2':
                b.heading(blk[1], 2)
            elif kind == 'ul':
                b.list_item(blk[1])
            elif kind == 'fig':
                b.figure(blk[1], blk[2])
    b.finish(outline)
    b.truth['outline'] = outline
    b.truth['pageCount'] = b.page
    return b.truth


def tj_book(b):
    """Replaces draw_line by a writer that sets every line as TJ arrays: no space characters, the word gaps are
    kerning numbers, footnote markers raised with Ts (the way LaTeX and typesetting programs write their text)."""
    def draw_line(x, y, words, width, justify, size=None):
        size = size or b.size
        c = b.c
        space = b.L.width(' ', 'R', size)
        small = size * 0.62
        note_w = lambda n: b.L.width(str(n), 'R', small) if n else 0
        natural = sum(b.L.width(w, s, size) + note_w(n) for w, s, n in words) + space * (len(words) - 1)
        gap = space + ((width - natural) / max(1, len(words) - 1) if justify and len(words) > 1 else 0)
        name = lambda s: c._doc.getInternalFontName(b.fonts[s])
        ops = ['BT 1 0 0 1 %.2f %.2f Tm' % (x, y)]
        cur = None
        for i, (w, s, n) in enumerate(words):
            if cur != s:
                ops.append('%s %g Tf' % (name(s), size))
                cur = s
            last = i == len(words) - 1
            word = w.encode('cp1252', 'replace')
            # a little kerning inside some words, as typesetting programs write it
            body = '%s 40 %s' % (pdf_str(word[:1]), pdf_str(word[1:])) if len(word) > 3 and word[:1] in b'WTVY' else pdf_str(word)
            if n:
                ops.append('[%s] TJ' % body)
                ops.append('%s %g Tf %g Ts %s Tj 0 Ts' % (name('R'), small, size * 0.38, pdf_str(str(n).encode())))
                cur = None
                if not last:
                    ops.append('%s %g Tf [%d] TJ' % (name(s), size, round(-gap * 1000 / size)))
                    cur = s
            else:
                ops.append('[%s%s] TJ' % (body, '' if last else ' %d' % round(-gap * 1000 / size)))
        ops.append('ET')
        c._code.append(' '.join(ops))
    b.draw_line = draw_line


def make_epub(path, title, paras):
    body = ''.join('<p>%s</p>' % p for p in paras)
    body = '<h1>%s</h1>%s<h2>Zweiter Teil</h2>%s' % (title, body, body)
    xhtml = ('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" lang="de" '
             'xml:lang="de"><head><title>%s</title></head><body>%s</body></html>' % (title, body))
    nav = ('<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" '
           'xmlns:epub="http://www.idpf.org/2007/ops"><head><title>%s</title></head><body><nav epub:type="toc"><ol>'
           '<li><a href="text.xhtml">%s</a></li></ol></nav></body></html>' % (title, title))
    opf = ('<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" '
           'unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
           '<dc:identifier id="id">urn:uuid:lesesaal-reader-test-%s</dc:identifier><dc:title>%s</dc:title>'
           '<dc:creator>Testautorin</dc:creator><dc:language>de</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>'
           '</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
           '<item id="text" href="text.xhtml" media-type="application/xhtml+xml"/></manifest>'
           '<spine><itemref idref="text"/></spine></package>' % (zlib.crc32(title.encode('utf-8')) % 100000, title))
    container = ('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                 '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
                 '</rootfiles></container>')
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml', container, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('OEBPS/content.opf', opf, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('OEBPS/nav.xhtml', nav, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('OEBPS/text.xhtml', xhtml.encode('utf-8'), compress_type=zipfile.ZIP_DEFLATED)


def main(out):
    lib = os.path.join(out, 'lib')
    for d in ('Sachbuch', 'Englisch', 'Romane'):
        os.makedirs(os.path.join(lib, d), exist_ok=True)
    truth = {}
    truth['Sachbuch/Der Fluss im Jahreslauf.pdf'] = german_book(os.path.join(lib, 'Sachbuch', 'Der Fluss im Jahreslauf.pdf'), TIMES)
    serif = register_serif() or TIMES
    truth['Englisch/The River Year.pdf'] = english_book(os.path.join(lib, 'Englisch', 'The River Year.pdf'), TIMES if serif is TIMES else TIMES)
    make_epub(os.path.join(lib, 'Romane', 'Am Ufer.epub'), 'Am Ufer', DE_EPUB)
    truth['Romane/Am Ufer.epub'] = {'title': 'Am Ufer', 'lang': 'de', 'paragraphs': DE_EPUB}
    with open(os.path.join(out, 'reader-truth.json'), 'w', encoding='utf-8') as f:
        json.dump(truth, f, ensure_ascii=False, indent=1)
    print('books in', lib, {k: v.get('pageCount') for k, v in truth.items()})


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: python build/testlib/gen_reader_books.py <folder>')
        sys.exit(1)
    main(sys.argv[1])
