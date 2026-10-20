# Test books for read-aloud (Cozy Shelves 0.7): German PDFs and EPUBs the way different producers make them, so that the
# text that reaches the voices can be checked. Every text here is invented for the tests.
#
#   python build/testlib/gen_tts_books.py <folder>
#       <folder>/lib/...            the library (COZYSHELVES_BOOKS="<folder>/lib|structured")
#       <folder>/web/wiki-de.html   a page like an encyclopedia article (the same text as "Lesen am Fluss")
#       <folder>/tts-truth.json     per book: the language of its text, its first sentences, what must never be read
#
# The PDFs are written by hand (no PDF library), so that the content streams look like those of real producers:
#   spaces.pdf     one string per line with real space characters (word processors)
#   tjkern         TJ arrays without spaces, the word gaps as kerning numbers, justified (LaTeX, InDesign)
#   perword        every word placed on its own with Tm (some printers and converters)
#   rowwise        two columns written line by line across both columns (wrong order in the content stream)
#   broken         a font whose ToUnicode map gives the wrong characters (the page looks right, the text is junk)
#   scan           pages that are only a picture
# plus hyphenation at line ends, the ligatures fi and fl, running heads and page numbers, chess notation with
# letters and with figurines, a diagram set in a chess diagram font, and wrong, broken or missing language entries.
import io, json, os, sys, zipfile, zlib

from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfbase import pdfmetrics

PAGE_W, PAGE_H = 595, 842
MARGIN = 64

# ------------------------------------------------------------------------------------------------------- texts
# '|' marks the places where a long word may be hyphenated at the end of a line.
FLUSS = [
    ('h', 'Lesen am Fluss'),
    ('p', 'Wer an einem warmen Nach|mit|tag mit einem Buch am Fluss sitzt, merkt schnell, wie ruhig die Gedanken werden. '
          'Das Wasser zieht gleich|mäßig vorbei, und die Seiten wenden sich fast von selbst.'),
    ('p', 'Schon im 18. Jahrhundert empfahlen Ärzte ihren Pa|ti|en|ten, täglich eine Stunde im Freien zu lesen. '
          'Sie glaubten, dass frische Luft und ein gutes Buch zusammen die Nerven stärken.'),
    ('p', 'Heute weiß man, dass regel|mäßiges Lesen die Konzen|tra|tion fördert. Eine Unter|su|chung aus dem Jahr 2019 '
          'zeigte, dass schon zwanzig Minuten am Tag genügen, um den Wort|schatz spürbar zu erweitern.'),
    ('p', 'Besonders geeignet sind Bücher, die man nicht in einem Zug lesen muss, etwa Ge|dicht|bände, Erzählungen und '
          'Brief|samm|lungen. Man kann sie aufschlagen, ein paar Seiten genießen und wieder schließen, ohne den Faden '
          'zu verlieren.'),
    ('p', 'Die Bibliothek am Marktplatz verleiht im Sommer Klapp|stühle und Decken. Wer möchte, findet dort auch eine '
          'Liste mit Empfeh|lungen für Anfänger und erfahrene Leserin|nen. Am Ufer fließt der Fluss weiter, und die '
          'Schiffe ziehen flussabwärts.'),
]
FLUSS_2 = [
    ('p', 'Im Herbst wird es am Wasser schneller kühl. Dann lohnt sich eine warme Decke, und eine Thermos|kanne mit Tee '
          'gehört in jede Tasche.'),
    ('p', 'Viele Leser nehmen auch ein kleines Notiz|buch mit. Sie schreiben schöne Sätze ab oder halten fest, was '
          'ihnen beim Lesen eingefallen ist.'),
    ('p', 'Am Abend, wenn das Licht nachlässt, klappt man das Buch zu und geht langsam nach Hause. Die Geschichte '
          'begleitet einen noch eine Weile.'),
]
GARTEN = [
    ('h', 'Das Gartenjahr'),
    ('p', 'Im März beginnt das Gartenjahr. Die Erde ist noch kalt, aber die ersten Schnee|glöckchen blühen schon unter '
          'den Hecken. Wer jetzt Erbsen sät, kann im Juni ernten.'),
    ('p', 'Im April werden die Beete umgegraben und mit Kompost versorgt. Ein Beet von zwei Metern Länge braucht etwa '
          'einen Eimer reifen Kompost.'),
    ('p', 'Im Mai kommen Tomaten, Bohnen und Zucchini ins Freie. Nachts kann es noch Frost geben, deshalb deckt man die '
          'jungen Pflanzen mit Vlies ab.'),
    ('p', 'Der Sommer ist die Zeit des Gießens. Am besten gießt man früh am Morgen, dann verdunstet weniger Wasser und '
          'die Blätter trocknen bis zum Mittag.'),
    ('p', 'Im Herbst sammelt man Samen für das nächste Jahr. Sie werden in Papier|tüten getrocknet und an einem kühlen '
          'Ort aufbewahrt.'),
    ('p', 'Im Winter ruht der Garten. Dann ist Zeit, Bücher über Pflanzen zu lesen und das nächste Gartenjahr zu planen.'),
]
SCHACH = [
    ('h', 'Der König im Endspiel'),
    ('p', 'Im Endspiel wird der König zu einer starken Figur. Er muss aktiv werden und in die Mitte des Brettes laufen.'),
    ('p', 'Betrachten wir die Stellung nach 1. e4 e5 2. Sf3 Sc6 3. Lb5 a6 4. La4 Sf6 5. 0-0 Le7. Weiß hat kurz rochiert, '
          'und Schwarz hat seine Figuren entwickelt.'),
    ('p', 'Nach 6. Te1 b5 7. Lb3 d6 8. c3 0-0 9. h3 Sb8 entsteht eine bekannte Stellung der Spanischen Partie.'),
    ('p', 'Im Turm|endspiel gilt eine einfache Regel. Türme gehören hinter die Frei|bauern. Nach 34. Txa7 Txa7 35. Lxa7 '
          'Kf7 36. Kf2 Ke6 ist das Endspiel ausgeglichen.'),
    ('p', 'Ein Bauer, der die letzte Reihe erreicht, wird umgewandelt, meistens in eine Dame. Nach 52. e8=D+ Kf6 53. Dh8+ '
          'gewinnt Weiß.'),
    ('p', 'Die Antwort 12...Sf6 ist am stärksten. Nach 12...Dd7? 13. Lxf7+! Kxf7 14. Sg5+ verliert Schwarz die Dame.'),
]
# the diagram of the starting position as a chess diagram font (Chess Merida, Alpha, Leipzig …) stores it in the text
DIAGRAM_ROWS = ['!""""""""#', '$tMvWlVmT%', '$OoOoOoOo%', '$ + + + +%', '$+ + + + %', '$ + + + +%', '$+ + + + %',
                '$pPpPpPpP%', '$RnBqKbNr%', '/(((((((()']
FIGURINE = [
    ('h', 'Matt in zwei Zügen'),
    ('p', 'In dieser Aufgabe zieht Weiß und setzt im zweiten Zug matt. Die Lösung beginnt mit 1. \u2658f3, danach folgt '
          '1...\u265ae7 2. \u2655e2#.'),
    ('p', 'Eine zweite Aufgabe zeigt die lange Rochade. Nach 1. 0-0-0 \u265be8 2. \u2656d8# ist die Partie zu Ende.'),
    ('p', 'Wer die Aufgaben ohne Brett löst, trainiert das Vorstellungs|vermögen. Am Anfang hilft es, die Züge laut '
          'mitzusprechen.'),
]
LEUCHTTURM = [
    ('h', 'Der Leuchtturm'),
    ('p', 'Am Ende der Landzunge stand ein alter Leuchtturm. Seit vielen Jahren wohnte dort niemand mehr, doch jeden '
          'Abend ging das Licht pünktlich an.'),
    ('p', 'Die Kinder aus dem Dorf erzählten sich, dass ein Wärter heimlich zurückgekehrt sei. Niemand hatte ihn je '
          'gesehen, aber am Morgen lagen manchmal frische Muscheln auf der Treppe.'),
    ('p', 'Eines Tages nahm Lena ihren ganzen Mut zusammen und stieg die Stufen hinauf. Oben fand sie nur eine Uhr, '
          'eine Lampe und ein Buch mit leeren Seiten.'),
    # a poem: one line per <br>, as many converted books set their verses and line breaks
    ('poem', 'Die Wellen kommen und gehen|Das Licht wandert über das Wasser|Und niemand schaut zu.'),
]
POEM = 'Die Wellen kommen und gehen Das Licht wandert über das Wasser Und niemand schaut zu.'
MIXED = [
    ('h', 'Briefe aus zwei Ländern'),
    ('p', 'Die Briefe, die Anna aus London schickte, waren lang und voller kleiner Zeichnungen. Ihre Schwester las sie '
          'jeden Sonntag am Küchentisch vor.'),
    ('p', 'In einem Brief stand ein englischer Absatz, den Anna aus einer Zeitung abgeschrieben hatte.'),
    ('en', 'The weather in London has been grey for weeks, but the parks are still full of people. They walk their dogs, '
           'read the newspaper and wait for the sun to come back.'),
    ('p', 'Darunter hatte Anna geschrieben, dass sie das Wetter in Deutschland vermisse. Im nächsten Frühjahr wollte '
          'sie nach Hause kommen.'),
]
LIGHTHOUSE = [
    ('h', 'The Lighthouse'),
    ('p', 'At the end of the headland stood an old lighthouse. Nobody had lived there for many years, yet every evening '
          'the light came on at exactly the same time.'),
    ('p', 'The children from the village told each other that a keeper had secretly returned. Nobody had ever seen him, '
          'but in the morning there were sometimes fresh shells on the stairs.'),
]


def plain(t):
    return t.replace('|', '')


def sentences_of(blocks, n):
    """The first n sentences of the text (only for the expectations in the truth file)."""
    out = []
    for kind, t in blocks:
        if kind == 'poem':
            continue
        t = plain(t)
        if kind == 'h':
            out.append(t)
        else:
            cur = ''
            for word in t.split(' '):
                cur = (cur + ' ' + word).strip()
                if word.endswith(('.', '!', '?')) and not word[:-1].isdigit() and not cur.endswith(('...', '1.', 'e4.')):
                    out.append(cur)
                    cur = ''
            if cur:
                out.append(cur)
        if len(out) >= n:
            break
    return out[:n]


# ------------------------------------------------------------------------------------------------ raw PDF writer
def pdf_str(b):
    out = []
    for c in b:
        if c in (0x28, 0x29, 0x5C):
            out.append('\\' + chr(c))
        elif 32 <= c < 127:
            out.append(chr(c))
        else:
            out.append('\\%03o' % c)
    return '(' + ''.join(out) + ')'


LIG = {'fi': b'\x80', 'fl': b'\x81'}


def enc(text, ligatures=False):
    """WinAnsi bytes of a text; with `ligatures` the letter pairs fi and fl become the ligature glyphs."""
    b = text.encode('cp1252')
    if ligatures:
        for k, v in LIG.items():
            b = b.replace(k.encode(), v)
    return b


def width(text, size, font='Helvetica'):
    return pdfmetrics.stringWidth(text, font, size)


class RawPdf:
    def __init__(self):
        self.objs = []

    def add(self, body):
        self.objs.append(body if isinstance(body, bytes) else body.encode('latin-1'))
        return len(self.objs)

    def stream(self, data, extra=''):
        if isinstance(data, str):
            data = data.encode('latin-1')
        return self.add(('<< /Length %d %s >>\nstream\n' % (len(data), extra)).encode('latin-1') + data + b'\nendstream')

    def write(self, path, pages, fonts, info=None, images=None):
        """pages: [(content bytes, [font names used], [image names])]; fonts: name -> object number"""
        images = images or {}
        pages_num = len(self.objs) + 1
        self.objs.append(None)   # the Pages object, filled in below
        kids = []
        font_res = ' '.join('/%s %d 0 R' % (k, v) for k, v in fonts.items())
        img_res = ' '.join('/%s %d 0 R' % (k, v) for k, v in images.items())
        for content in pages:
            c = self.stream(content)
            res = '/Font << %s >>' % font_res + (' /XObject << %s >>' % img_res if img_res else '')
            kids.append(self.add('<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %d %d] /Resources << %s >> /Contents %d 0 R >>'
                                 % (pages_num, PAGE_W, PAGE_H, res, c)))
        self.objs[pages_num - 1] = ('<< /Type /Pages /Kids [%s] /Count %d >>' % (' '.join('%d 0 R' % k for k in kids), len(kids))).encode('latin-1')
        root = self.add('<< /Type /Catalog /Pages %d 0 R >>' % pages_num)
        info_num = None
        if info:
            parts = []
            for k, v in info.items():
                parts.append('/%s %s' % (k, pdf_str(v if isinstance(v, bytes) else v.encode('cp1252'))))
            info_num = self.add('<< %s >>' % ' '.join(parts))
        out = io.BytesIO()
        out.write(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
        offsets = []
        for i, body in enumerate(self.objs):
            offsets.append(out.tell())
            out.write(b'%d 0 obj\n' % (i + 1) + body + b'\nendobj\n')
        xref = out.tell()
        out.write(b'xref\n0 %d\n0000000000 65535 f \n' % (len(self.objs) + 1))
        for o in offsets:
            out.write(b'%010d 00000 n \n' % o)
        trailer = '<< /Size %d /Root %d 0 R%s >>' % (len(self.objs) + 1, root, (' /Info %d 0 R' % info_num) if info_num else '')
        out.write(b'trailer\n' + trailer.encode('latin-1') + b'\nstartxref\n%d\n%%%%EOF\n' % xref)
        with open(path, 'wb') as f:
            f.write(out.getvalue())


def std_fonts(pdf, broken=None):
    fonts = {
        'F1': pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding '
                      '/BaseEncoding /WinAnsiEncoding /Differences [128 /fi /fl] >> >>'),
        'F2': pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
        'F3': pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>'),
    }
    if broken:
        cmap = tounicode_cmap(broken)
        tu = pdf.stream(cmap)
        fonts['F4'] = pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode %d 0 R >>' % tu)
    return fonts


def tounicode_cmap(kind):
    """A ToUnicode map that maps every code to a wrong character: 'shift' (letters moved by 7 places), 'pua' (the
    private use area), 'cjk' (CJK ideographs) – as broken PDFs from some converters do."""
    pairs = []
    for code in range(0x20, 0x100):
        if code == 0x20:
            u = 0x20
        elif kind == 'shift':
            ch = bytes([code]).decode('cp1252', errors='replace')
            if 'a' <= ch <= 'z':
                u = ord('a') + (ord(ch) - ord('a') + 7) % 26
            elif 'A' <= ch <= 'Z':
                u = ord('A') + (ord(ch) - ord('A') + 7) % 26
            else:
                u = 0x00A0 + (code * 7) % 0x5F   # umlauts and punctuation land on Latin-1 symbols
        elif kind == 'pua':
            u = 0xE000 + code
        else:
            u = 0x4E00 + code * 37
        pairs.append('<%02X> <%04X>' % (code, u))
    chunks = []
    for i in range(0, len(pairs), 100):
        part = pairs[i:i + 100]
        chunks.append('%d beginbfchar\n%s\nendbfchar' % (len(part), '\n'.join(part)))
    return ('/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n'
            '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n'
            '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n'
            + '\n'.join(chunks) + '\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n')


# ------------------------------------------------------------------------------------------------ line breaking
def break_lines(text, size, max_w, font='Helvetica'):
    """Greedy line breaking with hyphenation at the '|' marks. Returns [(words, hyphenated_end)]."""
    words = text.split(' ')
    lines, cur = [], []
    space = width(' ', size, font)
    i = 0
    while i < len(words):
        w = words[i]
        trial = cur + [plain(w)]
        if width(' '.join(trial), size, font) <= max_w:
            cur = trial
            i += 1
            continue
        # try a hyphenation point of this word
        parts = w.split('|')
        done = False
        for k in range(len(parts) - 1, 0, -1):
            head = ''.join(parts[:k]) + '-'
            if width(' '.join(cur + [head]), size, font) <= max_w:
                lines.append((cur + [head], True))
                words[i] = '|'.join(parts[k:])
                cur = []
                done = True
                break
        if done:
            continue
        if not cur:   # a single word wider than the line
            cur = [plain(w)]
            i += 1
        lines.append((cur, False))
        cur = []
    if cur:
        lines.append((cur, False))
    return lines


def layout(blocks, size=11, lead=15.5, x0=MARGIN, col_w=PAGE_W - 2 * MARGIN, top=PAGE_H - 96, bottom=80):
    """Lays the blocks out into pages of lines: [[(x, y, words, font, size, justify)]]."""
    pages, cur, y = [], [], top
    for kind, text in blocks:
        if kind == 'pb':   # a page break
            if cur:
                pages.append(cur)
            cur, y = [], top
            continue
        font = 'Helvetica-Bold' if kind == 'h' else 'Helvetica'
        fs = 16 if kind == 'h' else size
        lines = break_lines(text, fs, col_w, font)
        for li, (words, hyph) in enumerate(lines):
            if y < bottom:
                pages.append(cur)
                cur, y = [], top
            last = li == len(lines) - 1
            cur.append({'x': x0, 'y': y, 'words': words, 'font': font, 'size': fs, 'justify': kind != 'h' and not last, 'w': col_w})
            y -= (fs + 8) if kind == 'h' else lead
        y -= 8 if kind == 'h' else 7
    if cur:
        pages.append(cur)
    return pages


FONT_KEY = {'Helvetica': 'F1', 'Helvetica-Bold': 'F2', 'Courier': 'F3'}


def line_ops(line, style, ligatures=True, font_key=None):
    """The content stream operators of one line in the given producer style."""
    words, size, font = line['words'], line['size'], line['font']
    fk = font_key or FONT_KEY[font]
    lig = ligatures and fk == 'F1'
    ww = [width(w, size, font) for w in words]
    natural = width(' ', size, font)
    gap = natural
    if line['justify'] and len(words) > 1:
        gap = max(natural, (line['w'] - sum(ww)) / (len(words) - 1))
    x, y = line['x'], line['y']
    if style == 'spaces':
        if line['justify'] and len(words) > 1:
            # word spacing operator Tw stretches the real spaces
            tw = gap - natural
            return 'BT /%s %g Tf %.3f Tw 1 0 0 1 %.2f %.2f Tm %s Tj ET\n' % (fk, size, tw, x, y, pdf_str(enc(' '.join(words), lig)))
        return 'BT /%s %g Tf 0 Tw 1 0 0 1 %.2f %.2f Tm %s Tj ET\n' % (fk, size, x, y, pdf_str(enc(' '.join(words), lig)))
    if style == 'tjkern':
        parts = []
        for i, w in enumerate(words):
            # a little kerning inside some words ("W" + "ort"), as typesetting programs write it
            if len(w) > 3 and w[0] in 'WTVY':
                parts.append('%s 60 %s' % (pdf_str(enc(w[0], lig)), pdf_str(enc(w[1:], lig))))
            else:
                parts.append(pdf_str(enc(w, lig)))
            if i < len(words) - 1:
                parts.append('%d' % round(-gap * 1000 / size))
        return 'BT /%s %g Tf 1 0 0 1 %.2f %.2f Tm [%s] TJ ET\n' % (fk, size, x, y, ' '.join(parts))
    if style == 'perword':
        out = ['BT /%s %g Tf' % (fk, size)]
        for i, w in enumerate(words):
            out.append('1 0 0 1 %.2f %.2f Tm %s Tj' % (x, y, pdf_str(enc(w, lig))))
            x += ww[i] + gap
        out.append('ET\n')
        return ' '.join(out)
    raise ValueError(style)


def head_foot(page_no, head, size=9):
    ops = ''
    if head:
        ops += 'BT /F1 %g Tf 1 0 0 1 %.2f %.2f Tm %s Tj ET\n' % (size, MARGIN, PAGE_H - 52, pdf_str(enc(head)))
    num = str(page_no)
    ops += 'BT /F1 %g Tf 1 0 0 1 %.2f %.2f Tm %s Tj ET\n' % (size, PAGE_W / 2 - width(num, size) / 2, 40, pdf_str(enc(num)))
    return ops


def make_pdf(path, blocks, style, info=None, head=None, extra_pages=None, ligatures=True, col_w=PAGE_W - 2 * MARGIN):
    pdf = RawPdf()
    fonts = std_fonts(pdf)
    pages = []
    for n, lines in enumerate(layout(blocks, col_w=col_w)):
        ops = head_foot(n + 1, head(n + 1) if callable(head) else head)
        for line in lines:
            ops += line_ops(line, style, ligatures)
        pages.append(ops.encode('latin-1'))
    for p in extra_pages or []:
        pages.append(p)
    pdf.write(path, pages, fonts, info=info)


def chess_pdf(path):
    """German chess text set like a typesetting program (TJ without spaces), then a diagram in a diagram font with a
    caption, then more text."""
    pdf = RawPdf()
    fonts = std_fonts(pdf)
    pages = []
    lines = layout(SCHACH)
    assert len(lines) == 1, 'the chess text fits on one page'
    ops = head_foot(1, 'Endspielkurs für Einsteiger')
    for line in lines[0]:
        ops += line_ops(line, 'tjkern')
    pages.append(ops.encode('latin-1'))
    # page 2: the diagram (Courier stands in for the diagram font), its caption, and two sentences of text
    ops = head_foot(2, 'Endspielkurs für Einsteiger')
    y = PAGE_H - 120
    for row in DIAGRAM_ROWS:
        ops += 'BT /F3 18 Tf 1 0 0 1 %.2f %.2f Tm %s Tj ET\n' % (200, y, pdf_str(enc(row)))
        y -= 18
    ops += 'BT /F1 10 Tf 1 0 0 1 %.2f %.2f Tm %s Tj ET\n' % (200, y - 8, pdf_str(enc('Diagramm 1. Die Grundstellung')))
    y -= 50
    rest = layout([('p', 'In der Grundstellung stehen alle Figuren auf ihren Ausgangsfeldern. Weiß beginnt, meistens mit '
                         'dem Königsbauern.')], top=y)
    for line in rest[0]:
        ops += line_ops(line, 'tjkern')
    pages.append(ops.encode('latin-1'))
    pdf.write(path, pages, fonts, info={'Title': 'Endspielkurs', 'Producer': 'Testsatz 1.0'})


def rowwise_pdf(path, info):
    """Two columns; the content stream writes the lines across both columns, row by row (wrong reading order), every
    word on its own (perword)."""
    pdf = RawPdf()
    fonts = std_fonts(pdf)
    col_w = (PAGE_W - 2 * MARGIN - 24) / 2
    half = (len(GARTEN) + 1) // 2
    left = layout(GARTEN[:half], x0=MARGIN, col_w=col_w)
    right = layout(GARTEN[half:], x0=MARGIN + col_w + 24, col_w=col_w)
    assert len(left) == 1 and len(right) == 1
    ops = head_foot(1, None)
    L, R = left[0], right[0]
    for i in range(max(len(L), len(R))):
        for col in (L, R):
            if i < len(col):
                ops += line_ops(col[i], 'perword')
    pdf.write(path, [ops.encode('latin-1')], fonts, info=info)


def broken_pdf(path):
    """Page 1 readable, pages 2–4 with a broken ToUnicode map (shift, private use area, CJK), page 5 readable again."""
    pages, fonts = [], None
    pdfs = {}
    pdf = RawPdf()
    fonts = std_fonts(pdf)
    # one broken font per kind
    for kind, key in (('shift', 'F4'), ('pua', 'F5'), ('cjk', 'F6')):
        tu = pdf.stream(tounicode_cmap(kind))
        fonts[key] = pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode %d 0 R >>' % tu)
    body = layout(FLUSS)[0]
    ops = head_foot(1, None)
    for line in body:
        ops += line_ops(line, 'spaces')
    pages.append(ops.encode('latin-1'))
    for n, key in ((2, 'F4'), (3, 'F5'), (4, 'F6')):
        ops = head_foot(n, None)
        for line in layout(GARTEN)[0]:
            ops += line_ops(line, 'spaces', ligatures=False, font_key=key)
        pages.append(ops.encode('latin-1'))
    ops = head_foot(5, None)
    for line in layout(FLUSS_2)[0]:
        ops += line_ops(line, 'spaces')
    pages.append(ops.encode('latin-1'))
    pdf.write(path, pages, fonts, info={'Title': 'Kaputte Schrift'})


def scan_pdf(path):
    """Page 1 a title as text, pages 2–4 only pictures of text (a scan without OCR), page 5 text again."""
    pdf = RawPdf()
    fonts = std_fonts(pdf)
    font_path = None
    for cand in (r'C:\Windows\Fonts\DejaVuSans.ttf', r'C:\Windows\Fonts\arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if os.path.exists(cand):
            font_path = cand
            break
    images = {}
    for n in range(3):
        img = Image.new('L', (1240, 1754), 245)
        d = ImageDraw.Draw(img)
        f = ImageFont.truetype(font_path, 30) if font_path else ImageFont.load_default()
        y = 180
        for kind, text in GARTEN[1 + n:3 + n]:
            for words, hyph in break_lines(text, 11, PAGE_W - 2 * MARGIN):
                d.text((140, y), ' '.join(words), fill=30, font=f)
                y += 44
            y += 20
        buf = io.BytesIO()
        img.save(buf, 'JPEG', quality=70)
        data = buf.getvalue()
        num = pdf.add(b'<< /Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceGray /BitsPerComponent 8 '
                      b'/Filter /DCTDecode /Length %d >>\nstream\n' % len(data) + data + b'\nendstream')
        images['Im%d' % n] = num
    pages = []
    ops = head_foot(1, None) + 'BT /F2 20 Tf 1 0 0 1 %.2f %.2f Tm %s Tj ET\n' % (MARGIN, PAGE_H - 140, pdf_str(enc('Gescanntes Heft')))
    ops += 'BT /F1 11 Tf 1 0 0 1 %.2f %.2f Tm %s Tj ET\n' % (MARGIN, PAGE_H - 170, pdf_str(enc('Die folgenden Seiten sind eingescannt.')))
    pages.append(ops.encode('latin-1'))
    for n in range(3):
        pages.append(('q %d 0 0 %d 0 0 cm /Im%d Do Q\n' % (PAGE_W, PAGE_H, n)).encode('latin-1'))
    ops = head_foot(5, None)
    for line in layout(FLUSS_2)[0]:
        ops += line_ops(line, 'spaces')
    pages.append(ops.encode('latin-1'))
    pdf.write(path, pages, fonts, info={'Title': 'Gescanntes Heft'}, images=images)


def figurine_pdf(path):
    """Figurine notation set with a TrueType font that has the chess symbols (reportlab embeds it with a ToUnicode
    map), real spaces between the words."""
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase.ttfonts import TTFont
    font_path = None
    for cand in (r'C:\Windows\Fonts\DejaVuSans.ttf', r'C:\Windows\Fonts\seguisym.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if os.path.exists(cand):
            font_path = cand
            break
    if not font_path:
        print('no font with chess symbols found, Matt in zwei Zügen.pdf is skipped')
        return False
    pdfmetrics.registerFont(TTFont('Figurine', font_path))
    c = canvas.Canvas(path, pagesize=(PAGE_W, PAGE_H))
    c.setTitle('Matt in zwei Zügen')
    y = PAGE_H - 96
    for kind, text in FIGURINE:
        fs = 16 if kind == 'h' else 11
        for words, hyph in break_lines(text, fs, PAGE_W - 2 * MARGIN, 'Figurine'):
            c.setFont('Figurine', fs)
            c.drawString(MARGIN, y, ' '.join(words))
            y -= fs + 6
        y -= 8
    c.setFont('Figurine', 9)
    c.drawCentredString(PAGE_W / 2, 40, '1')
    c.showPage()
    c.save()
    return True


# ------------------------------------------------------------------------------------------------ EPUB
def make_epub(path, title, lang, blocks, html_lang=None):
    """lang: the dc:language of the package (None = none at all); html_lang: the lang of the XHTML file."""
    body = []
    for kind, text in blocks:
        t = plain(text).replace('&', '&amp;').replace('<', '&lt;')
        if kind == 'h':
            body.append('<h1>%s</h1>' % t)
        elif kind == 'poem':
            body.append('<p>%s</p>' % '<br/>'.join(text.split('|')))
        elif kind == 'en':
            body.append('<p>%s</p>' % t)
        else:
            body.append('<p>%s</p>' % t)
    lang_attr = (' lang="%s" xml:lang="%s"' % (html_lang, html_lang)) if html_lang else ''
    xhtml = ('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"%s>'
             '<head><title>%s</title></head><body>%s</body></html>' % (lang_attr, title, '\n'.join(body)))
    nav = ('<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" '
           'xmlns:epub="http://www.idpf.org/2007/ops"><head><title>%s</title></head><body><nav epub:type="toc"><ol>'
           '<li><a href="text.xhtml">%s</a></li></ol></nav></body></html>' % (title, title))
    lang_el = ('<dc:language>%s</dc:language>' % lang) if lang is not None else ''
    opf = ('<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" '
           'unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
           '<dc:identifier id="id">urn:uuid:lesesaal-test-%s</dc:identifier><dc:title>%s</dc:title>'
           '<dc:creator>Testautorin</dc:creator>%s<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>'
           '</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
           '<item id="text" href="text.xhtml" media-type="application/xhtml+xml"/></manifest>'
           '<spine><itemref idref="text"/></spine></package>' % (zlib.crc32(title.encode('utf-8')) % 100000, title, lang_el))
    container = ('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                 '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
                 '</rootfiles></container>')
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml', container, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('OEBPS/content.opf', opf, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('OEBPS/nav.xhtml', nav, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('OEBPS/text.xhtml', xhtml.encode('utf-8'), compress_type=zipfile.ZIP_DEFLATED)


def wiki_html(path):
    paras = ''.join('<h1 id="firstHeading">%s</h1>' % plain(t) if k == 'h' else '<p>%s</p>' % plain(t) for k, t in FLUSS)
    html = ('<!DOCTYPE html><html lang="de" dir="ltr"><head><meta charset="utf-8"><title>Lesen am Fluss – Testlexikon'
            '</title></head><body><div id="content"><main id="bodyContent"><div class="mw-parser-output">%s</div></main>'
            '</div></body></html>' % paras)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)


# ------------------------------------------------------------------------------------------------ main
def main(out):
    lib = os.path.join(out, 'lib')
    for d in ('Schach', 'Sachbuch', 'Romane', 'Englisch'):
        os.makedirs(os.path.join(lib, d), exist_ok=True)
    os.makedirs(os.path.join(out, 'web'), exist_ok=True)
    truth = {}

    def add(rel, lang, first, **kw):
        truth[rel.replace('\\', '/')] = {'lang': lang, 'first': first, **kw}

    # a word processor: real spaces, ligatures, hyphenation, running head and page numbers, a wrong language entry
    make_pdf(os.path.join(lib, 'Sachbuch', 'Lesen am Fluss.pdf'), FLUSS + [('pb', '')] + FLUSS_2, 'spaces',
             info={'Title': 'Lesen am Fluss', 'Author': 'Testautorin', 'Language': 'en-US', 'Producer': 'Textverarbeitung 1.0'},
             head=lambda n: None if n == 1 else 'Lesen am Fluss', col_w=300)
    add('Sachbuch/Lesen am Fluss.pdf', 'de', sentences_of(FLUSS, 5), meta='en-US')
    # a typesetting program: TJ arrays without spaces, justified, kerning inside words, running heads
    make_pdf(os.path.join(lib, 'Sachbuch', 'Am Wasser lesen.pdf'), FLUSS + [('pb', '')] + FLUSS_2, 'tjkern',
             info={'Title': 'Am Wasser lesen', 'Producer': 'Satzprogramm 2.1'}, head=lambda n: 'Kapitel 1 \u00b7 Am Wasser' if n % 2 else 'Am Wasser lesen')
    add('Sachbuch/Am Wasser lesen.pdf', 'de', sentences_of(FLUSS, 5))
    # every word on its own, two columns written row by row, a broken language entry
    rowwise_pdf(os.path.join(lib, 'Sachbuch', 'Das Gartenjahr.pdf'), info={'Title': 'Das Gartenjahr', 'Language': b'<\xa6'})
    add('Sachbuch/Das Gartenjahr.pdf', 'de', sentences_of(GARTEN, 5), meta='garbage', columns=2)
    broken_pdf(os.path.join(lib, 'Sachbuch', 'Kaputte Schrift.pdf'))
    add('Sachbuch/Kaputte Schrift.pdf', 'de', sentences_of(FLUSS, 3), junkPages=[2, 3, 4], afterJunk=sentences_of(FLUSS_2, 2))
    scan_pdf(os.path.join(lib, 'Sachbuch', 'Gescanntes Heft.pdf'))
    add('Sachbuch/Gescanntes Heft.pdf', 'de', ['Gescanntes Heft', 'Die folgenden Seiten sind eingescannt.'], junkPages=[2, 3, 4], afterJunk=sentences_of(FLUSS_2, 2))
    chess_pdf(os.path.join(lib, 'Schach', 'Endspielkurs.pdf'))
    add('Schach/Endspielkurs.pdf', 'de', ['Der König im Endspiel', 'Im Endspiel wird der König zu einer starken Figur.',
        'Er muss aktiv werden und in die Mitte des Brettes laufen.',
        'Betrachten wir die Stellung nach 1. e4 e5 2. Sf3 Sc6 3. Lb5 a6 4. La4 Sf6 5. 0-0 Le7.'],
        chess=True, spoken=['Springer f drei', 'kurze Rochade', 'Läufer b fünf'],
        never=['tMvWlVmT', 'OoOoOoOo', 'pPpPpPpP', 'RnBqKbNr', 'Einsteiger'])
    if figurine_pdf(os.path.join(lib, 'Schach', 'Matt in zwei Zügen.pdf')):
        add('Schach/Matt in zwei Zügen.pdf', 'de', ['Matt in zwei Zügen', 'In dieser Aufgabe zieht Weiß und setzt im zweiten Zug matt.',
            'Die Lösung beginnt mit 1. ♘f3, danach folgt 1...♚e7 2. ♕e2#.'], chess=True,
            spoken=['Springer f drei', 'König e sieben', 'Dame e zwei'])
    # EPUBs: the right language, a wrong one, none, a broken one, German with an English paragraph, English marked German
    make_epub(os.path.join(lib, 'Romane', 'Der Leuchtturm.epub'), 'Der Leuchtturm', 'de', LEUCHTTURM, 'de')
    add('Romane/Der Leuchtturm.epub', 'de', sentences_of(LEUCHTTURM, 4), meta='de', poem=POEM)
    make_epub(os.path.join(lib, 'Romane', 'Der Leuchtturm (falsch englisch).epub'), 'Der Leuchtturm (falsch englisch)', 'en', LEUCHTTURM, 'en')
    add('Romane/Der Leuchtturm (falsch englisch).epub', 'de', sentences_of(LEUCHTTURM, 4), meta='en')
    make_epub(os.path.join(lib, 'Romane', 'Der Leuchtturm (ohne Sprache).epub'), 'Der Leuchtturm (ohne Sprache)', None, LEUCHTTURM)
    add('Romane/Der Leuchtturm (ohne Sprache).epub', 'de', sentences_of(LEUCHTTURM, 4), meta=None)
    make_epub(os.path.join(lib, 'Romane', 'Der Leuchtturm (Unsinn).epub'), 'Der Leuchtturm (Unsinn)', '\u0192*\u00aa\u00fe\u00d7', LEUCHTTURM)
    add('Romane/Der Leuchtturm (Unsinn).epub', 'de', sentences_of(LEUCHTTURM, 4), meta='garbage')
    make_epub(os.path.join(lib, 'Romane', 'Briefe aus zwei Ländern.epub'), 'Briefe aus zwei Ländern', 'de', MIXED, 'de')
    add('Romane/Briefe aus zwei Ländern.epub', 'de', sentences_of(MIXED, 4), meta='de', english=[s.strip() + ('' if s.strip().endswith('.') else '.') for s in plain(MIXED[3][1]).split('. ')])
    make_epub(os.path.join(lib, 'Englisch', 'The Lighthouse.epub'), 'The Lighthouse', 'de', LIGHTHOUSE, 'de')
    add('Englisch/The Lighthouse.epub', 'en', sentences_of(LIGHTHOUSE, 3), meta='de')
    wiki_html(os.path.join(out, 'web', 'wiki-de.html'))
    truth['web/wiki-de.html'] = {'lang': 'de', 'first': sentences_of(FLUSS, 5), 'meta': 'de'}
    with open(os.path.join(out, 'tts-truth.json'), 'w', encoding='utf-8') as f:
        json.dump(truth, f, ensure_ascii=False, indent=1)
    print('%d books and a web page in %s' % (len(truth) - 1, out))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__ or 'usage: python build/testlib/gen_tts_books.py <folder>')
        sys.exit(1)
    main(sys.argv[1])
