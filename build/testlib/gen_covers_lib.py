# Test library for the covers from the internet (build/scripts/covers-check.js): PDFs named like public-domain classics whose
# page 1 is no cover (blank, a plain title page, a scanned leaf with a library stamp, one flat colour), a few made-up
# titles the search must not find, a text file (the indexer's title card) and two controls with a real cover on page 1.
#   python build/testlib/gen_covers_lib.py <folder>
import io, os, random, shutil, sys, json
from PIL import Image, ImageDraw, ImageFont, ImageFilter

if len(sys.argv) < 2: sys.exit('usage: gen_covers_lib.py <folder>')
ROOT = os.path.abspath(sys.argv[1])
FONTS = r'C:\Windows\Fonts'
F = lambda n, s: ImageFont.truetype(os.path.join(FONTS, n), s)
W, H = 420, 640          # page size in points

# (folder, file name without extension, kind of page 1, language, metadata title/author or None)
BOOKS = [
    ('Klassiker', 'Mary Shelley - Frankenstein', 'title', 'en', None),
    ('Klassiker', 'Johann Wolfgang von Goethe - Die Leiden des jungen Werthers', 'blank', 'de', ('Die Leiden des jungen Werthers', 'Johann Wolfgang von Goethe')),
    ('Klassiker', 'Gottfried Keller - Der grüne Heinrich', 'stamp', 'de', None),
    ('Klassiker', 'Theodor Storm - Der Schimmelreiter', 'pagenumber', 'de', None),
    ('Strategie', 'Friedrich Schiller - Kabale und Liebe', 'title', 'de', None),
    ('Strategie', 'Heinrich von Kleist - Michael Kohlhaas', 'blank', 'de', None),
    ('Strategie', 'Jean Dufresne - Kleines Lehrbuch des Schachspiels', 'scan', 'de', None),
    ('Finanzen', 'Adam Smith - Der Wohlstand der Nationen', 'title', 'de', None),
    ('Finanzen', 'Max Weber - Die protestantische Ethik und der Geist des Kapitalismus', 'uniform', 'de', None),
    ('Klassiker', 'Charles Darwin - The Voyage of the Beagle', 'title', 'en', None),
    ('Klassiker', 'Georg Büchner - Woyzeck', 'bodytext', 'de', None),
    # made up: nothing to find
    ('Klassiker', 'Hartmut Quellbrunn - Die vergessene Kartografie der Nebelinseln', 'title', 'de', None),
    ('Klassiker', 'Mabel Thornquist - Quantum Gardening for Retired Lighthouse Keepers', 'blank', 'en', None),
    ('Finanzen', 'Anna Lehmann - Das Haushaltsbuch', 'title', 'de', None),
    # controls: page 1 is a real cover
    ('Strategie', 'Peter Hoffmann - Strategien für jeden Tag', 'cover', 'de', None),
    ('Finanzen', 'Clara Winterfeld - Die Kunst des Sparens', 'darkcover', 'de', None),
]
TEXTS = [('Klassiker', 'Aesop - Fabeln', 'de')]

def ascii_text(s):
    return (s.replace('ä', 'ae').replace('ö', 'oe').replace('ü', 'ue').replace('Ä', 'Ae').replace('Ö', 'Oe').replace('Ü', 'Ue').replace('ß', 'ss')
             .encode('ascii', 'replace').decode().replace('\\', '').replace('(', '').replace(')', ''))

def pdf_str(s):
    return '<FEFF' + s.encode('utf-16-be').hex().upper() + '>'

def jpeg(im, q=82):
    b = io.BytesIO(); im.convert('RGB').save(b, 'JPEG', quality=q); return b.getvalue()

def paper(seed, tone=(232, 226, 210)):
    r = random.Random(seed)
    im = Image.new('RGB', (W * 2, H * 2), tone)
    px = im.load()
    for _ in range(9000):
        x, y = r.randrange(im.width), r.randrange(im.height)
        d = r.randint(-14, 10)
        px[x, y] = tuple(max(0, min(255, c + d)) for c in tone)
    return im.filter(ImageFilter.GaussianBlur(0.7))

def stamp_scan(title, seed):
    # a scanned leaf: grey paper, a round library stamp in violet ink, a pencilled shelf mark
    im = paper(seed)
    d = ImageDraw.Draw(im)
    cx, cy, rr = im.width * 0.62, im.height * 0.3, 120
    ink = (92, 70, 150)
    d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=ink, width=7)
    d.ellipse([cx - rr + 22, cy - rr + 22, cx + rr - 22, cy + rr - 22], outline=ink, width=3)
    f = F('arialbd.ttf', 26)
    d.text((cx - 98, cy - 16), 'STADTBIBLIOTHEK', font=f, fill=ink)
    d.text((cx - 40, cy + 22), 'Nr. 4711', font=F('arial.ttf', 22), fill=ink)
    d.text((150, im.height - 260), 'Sig. 23 / 117 b', font=F('georgiai.ttf', 34), fill=(90, 90, 96))
    return im.rotate(0.6, fillcolor=(232, 226, 210))

def scanned_title(title, author, seed):
    # a scanned title page: yellowed paper with printed lines, no picture
    im = paper(seed, (226, 218, 196))
    d = ImageDraw.Draw(im)
    f1, f2, f3 = F('georgiab.ttf', 64), F('georgia.ttf', 40), F('georgia.ttf', 28)
    y = 300
    for ln in [author.upper()]:
        d.text(((im.width - d.textlength(ln, font=f2)) / 2, y), ln, font=f2, fill=(40, 36, 32)); y += 120
    d.text(((im.width - d.textlength(title, font=f1)) / 2, y), title, font=f1, fill=(30, 28, 26)); y += 140
    for ln in ['Eine Anleitung zum Selbstunterricht', 'mit zahlreichen Diagrammen']:
        d.text(((im.width - d.textlength(ln, font=f3)) / 2, y), ln, font=f3, fill=(50, 46, 40)); y += 48
    d.text(((im.width - d.textlength('LEIPZIG 1881', font=f3)) / 2, im.height - 200), 'LEIPZIG 1881', font=f3, fill=(50, 46, 40))
    return im

def real_cover(title, author, seed, dark=False):
    r = random.Random(seed)
    im = Image.new('RGB', (W * 2, H * 2), (24, 30, 44) if dark else (196, 72, 52))
    d = ImageDraw.Draw(im)
    if not dark:
        d.ellipse([im.width * 0.25, im.height * 0.42, im.width * 1.15, im.height * 1.1], fill=(240, 196, 80))
        d.rectangle([0, 0, im.width, 90], fill=(38, 64, 98))
    else:
        for k in range(40): d.line([(0, 600 + k * 9), (im.width, 520 + k * 11)], fill=(40 + k, 60 + k, 90 + k), width=3)
    f = F('arialbd.ttf', 70)
    y = 160
    for ln in title.split(' ')[:4]:
        d.text((60, y), ln, font=f, fill=(250, 246, 236)); y += 84
    d.text((60, im.height - 120), author, font=F('georgiai.ttf', 40), fill=(250, 246, 236))
    return im

def write_pdf(path, title, author, kind, lang, meta, seed):
    objs = []
    def add(body):
        objs.append(body); return len(objs)
    add(b''); add(b'')
    font = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    bold = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
    times = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>')
    res_fonts = b'/Font << /F1 %d 0 R /F2 %d 0 R /F3 %d 0 R >>' % (font, bold, times)
    def stream(data):
        return add(b'<< /Length %d >>\nstream\n' % len(data) + data + b'\nendstream')
    page_ids = []
    def page(content, xobj=None):
        res = res_fonts + (b' /XObject << /Im0 %d 0 R >>' % xobj if xobj else b'')
        c = stream(content) if content is not None else None
        page_ids.append(add(b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Resources << %s >>%s >>' % (W, H, res, (b' /Contents %d 0 R' % c) if c else b'')))
    def image_page(im):
        data = jpeg(im)
        img = add(b'<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n' % (im.width, im.height, len(data)) + data + b'\nendstream')
        page(b'q %d 0 0 %d 0 0 cm /Im0 Do Q' % (W, H), img)
    def centred(text, size, y, f='F1'):
        t = ascii_text(text)
        width = len(t) * size * 0.5
        return ('BT /%s %d Tf %.1f %d Td (%s) Tj ET ' % (f, size, max(20, (W - width) / 2), y, t)).encode('latin-1')
    # page 1
    if kind == 'blank': page(None)
    elif kind == 'pagenumber': page(centred('1', 9, 30))
    elif kind == 'bodytext':
        # the book starts with its text: a heading and a full page of body type
        para = ascii_text(('Der Hauptmann kommt die Gasse herauf, der Wind geht ueber das Feld, und die Glocken schlagen die Stunde. ' if lang == 'de' else 'The captain walks up the lane while the wind crosses the field. ') * 40)
        rows = [para[i:i + 70] for i in range(0, len(para), 70)][:38]
        page(centred(title, 16, H - 60, 'F2') + ('BT /F3 10 Tf 36 %d Td 13 TL ' % (H - 100) + ' '.join('(%s) Tj T*' % r for r in rows) + ' ET').encode('latin-1'))
    elif kind == 'uniform': page(b'0.62 0.6 0.56 rg 0 0 %d %d re f' % (W, H))
    elif kind == 'title':
        c = centred(author, 16, H - 170) + centred(title, 22 if len(title) < 34 else 15, H - 230, 'F2')
        c += centred('Klassiker' if lang == 'de' else 'Classics', 12, H - 270, 'F3')
        c += centred('Verlag am Fluss' if lang == 'de' else 'Riverside Press', 11, 60, 'F3')
        page(c)
    elif kind == 'stamp': image_page(stamp_scan(title, seed))
    elif kind == 'scan': image_page(scanned_title(title, author, seed))
    elif kind == 'cover': image_page(real_cover(title, author, seed))
    elif kind == 'darkcover': image_page(real_cover(title, author, seed, dark=True))
    # body text
    body = ascii_text((f'{title}. ' + ('Erstes Kapitel. Dieses Buch handelt von ' if lang == 'de' else 'Chapter one. This book is about ') + title + '. ' +
                       ('Der Autor erklaert die wichtigsten Gedanken mit vielen Beispielen. ' if lang == 'de' else 'The author explains the main ideas with many examples. ') * 4))
    lines = [body[i:i + 64] for i in range(0, len(body), 64)][:30]
    txt = ('BT /F3 11 Tf 40 %d Td 15 TL ' % (H - 60) + ' '.join('(%s) Tj T*' % l for l in lines) + ' ET').encode('latin-1')
    for _ in range(39): page(txt)                 # book length: short PDFs are never looked up
    info = add(('<< /Title %s /Author %s /Language (%s) >>' % (pdf_str(meta[0]), pdf_str(meta[1]), lang) if meta else '<< /Language (%s) /Producer (Scanner) >>' % lang).encode('latin-1'))
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

def main():
    if os.path.exists(ROOT): shutil.rmtree(ROOT)
    manifest = []
    for i, (folder, name, kind, lang, meta) in enumerate(BOOKS):
        d = os.path.join(ROOT, folder); os.makedirs(d, exist_ok=True)
        author, title = name.split(' - ', 1)
        p = os.path.join(d, name + '.pdf')
        write_pdf(p, title, author, kind, lang, meta, 1000 + i)
        manifest.append({'rel': os.path.relpath(p, ROOT), 'title': title, 'author': author, 'kind': kind, 'lang': lang})
    for folder, name, lang in TEXTS:
        d = os.path.join(ROOT, folder); os.makedirs(d, exist_ok=True)
        p = os.path.join(d, name + '.txt')
        with open(p, 'w', encoding='utf-8') as f: f.write(('Der Fuchs und der Rabe. Ein Rabe sass mit einem Stueck Kaese auf dem Ast, und der Fuchs lobte seinen Gesang. ' * 60))
        author, title = name.split(' - ', 1)
        manifest.append({'rel': os.path.relpath(p, ROOT), 'title': title, 'author': author, 'kind': 'text', 'lang': lang})
    json.dump(manifest, open(os.path.join(ROOT, '..', os.path.basename(ROOT) + '-manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('books', len(manifest), '->', ROOT)

main()
