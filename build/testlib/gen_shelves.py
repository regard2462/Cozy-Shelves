# A small test library for the shelves of 0.7 (shelves-check.js): invented books in three departments with real covers,
# authors, years and publishers, series volumes named in several ways (Band, #, (Band 3), Teil II, EPUB series metadata),
# copies of the same book (the same file twice, EPUB and PDF, file names in the multi-part scheme of download sites, the
# same ISBN) next to books that must not count as copies (two volumes, two editions of other years, a title without an
# author), and PDFs whose language field is garbage. Everything is invented; nothing refers to a real library.
#   usage: python build/testlib/gen_shelves.py <folder>      (writes <folder> and <folder>/../shelves-manifest.json)
import io, os, sys, json, random, shutil, zipfile, hashlib
from PIL import Image, ImageDraw, ImageFont

if len(sys.argv) < 2: sys.exit('usage: gen_shelves.py <folder for the test library>')
ROOT = os.path.abspath(sys.argv[1])
FONTS = r'C:\Windows\Fonts'
def F(name, size):
    try: return ImageFont.truetype(os.path.join(FONTS, name), size)
    except Exception: return ImageFont.load_default()

COLORS = [(31, 60, 92), (124, 38, 45), (46, 92, 70), (190, 120, 40), (60, 60, 70), (200, 70, 55), (23, 95, 118), (138, 79, 156),
          (230, 200, 120), (70, 110, 160), (160, 60, 90), (220, 110, 60), (90, 120, 60)]

def wrap(d, text, font, maxw):
    words, lines, line = text.split(), [], ''
    for w in words:
        t = (line + ' ' + w).strip()
        if d.textlength(t, font=font) > maxw and line: lines.append(line); line = w
        else: line = t
    if line: lines.append(line)
    return lines

def cover_jpeg(title, author, seed):
    r = random.Random(seed)
    W, H = 360, 540
    bg = COLORS[r.randrange(len(COLORS))]
    ink = (30, 30, 30) if sum(bg) / 3 > 150 else (245, 240, 230)
    im = Image.new('RGB', (W, H), bg)
    d = ImageDraw.Draw(im)
    acc = COLORS[r.randrange(len(COLORS))]
    style = r.randrange(3)
    if style == 0: d.ellipse([W * 0.35, H * 0.45, W * 1.1, H * 0.95], fill=acc)
    elif style == 1: d.rectangle([0, H * 0.62, W, H], fill=acc)
    else: d.rectangle([24, 24, W - 24, H - 24], outline=acc, width=6)
    tf = F('georgiab.ttf', 40)
    lines = wrap(d, title, tf, W - 56)
    while len(lines) > 5 and tf.size > 20:
        tf = F('georgiab.ttf', tf.size - 4); lines = wrap(d, title, tf, W - 56)
    y = 70
    for ln in lines[:6]:
        d.text((28, y), ln, font=tf, fill=ink); y += int(tf.size * 1.15)
    d.text((28, H - 60), author or '', font=F('georgiai.ttf', 22), fill=ink)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=80)
    return b.getvalue(), W, H

def pdf_str(s):
    return '<FEFF' + s.encode('utf-16-be').hex().upper() + '>'

def ascii_text(s):
    return (s.replace('ä', 'ae').replace('ö', 'oe').replace('ü', 'ue').replace('Ä', 'Ae').replace('Ö', 'Oe').replace('Ü', 'Ue').replace('ß', 'ss')
             .encode('ascii', 'replace').decode().replace('\\', '').replace('(', '').replace(')', ''))

GERMAN = 'Das ist eine Geschichte, die nicht mit dem Anfang beginnt. Der Leser wird sich auch in der Mitte zurechtfinden, und die Welt ist mit sich im Reinen. '
def write_pdf(path, title, author, pages, seed, year=None, lang=None, isbn=None):
    jpg, W, H = cover_jpeg(title, author, seed)
    objs = []
    def add(body): objs.append(body); return len(objs)
    add(b''); add(b'')
    img = add(b'<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n' % (W, H, len(jpg)) + jpg + b'\nendstream')
    cs = b'q %d 0 0 %d 0 0 cm /Im0 Do Q' % (W, H)
    c1 = add(b'<< /Length %d >>\nstream\n' % len(cs) + cs + b'\nendstream')
    font = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    body = ascii_text(f'{title}. ' + ('ISBN ' + isbn + '. ' if isbn else '') + GERMAN * 3)
    lines = [body[i:i + 60] for i in range(0, len(body), 60)][:14]
    txt = 'BT /F1 11 Tf 36 %d Td 14 TL ' % (H - 60) + ' '.join('(%s) Tj T*' % l for l in lines) + ' ET'
    c2 = add(b'<< /Length %d >>\nstream\n' % len(txt) + txt.encode('latin-1') + b'\nendstream')
    page_ids = [add(b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>' % (W, H, img, c1))]
    for _ in range(max(0, pages - 1)):
        page_ids.append(add(b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>' % (W, H, font, c2)))
    info = '<< /Title %s' % pdf_str(title)
    if author: info += ' /Author %s' % pdf_str(author)
    if year: info += ' /CreationDate (D:%d0315120000)' % year
    info += ' >>'
    info_id = add(info.encode('latin-1'))
    lang_entry = (' /Lang %s' % pdf_str(lang)) if lang else ''
    objs[0] = ('<< /Type /Catalog /Pages 2 0 R%s >>' % lang_entry).encode('latin-1')
    objs[1] = ('<< /Type /Pages /Kids [%s] /Count %d >>' % (' '.join('%d 0 R' % p for p in page_ids), len(page_ids))).encode('latin-1')
    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out)); out += b'%d 0 obj\n' % i + o + b'\nendobj\n'
    x = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1)
    for o in offs: out += b'%010d 00000 n \n' % o
    out += b'trailer\n<< /Size %d /Root 1 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, info_id, x)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f: f.write(out)

def esc(s): return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
def write_epub(path, title, author, seed, year=None, publisher=None, isbn=None, series=None, index=None, chapters=3):
    jpg, _, _ = cover_jpeg(title, author, seed)
    meta = [f'<dc:identifier id="bookid">{"urn:isbn:" + isbn if isbn else "urn:uuid:" + hashlib.md5((title + str(seed)).encode()).hexdigest()}</dc:identifier>',
            f'<dc:title>{esc(title)}</dc:title>', '<dc:language>de</dc:language>', '<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>',
            '<meta name="cover" content="cover-img"/>']
    if author: meta.append(f'<dc:creator>{esc(author)}</dc:creator>')
    if year: meta.append(f'<dc:date>{year}</dc:date>')
    if publisher: meta.append(f'<dc:publisher>{esc(publisher)}</dc:publisher>')
    if series:
        meta.append(f'<meta name="calibre:series" content="{esc(series)}"/>')
        if index is not None: meta.append(f'<meta name="calibre:series_index" content="{index}"/>')
    items = ''.join(f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(chapters))
    spine = ''.join(f'<itemref idref="c{i}"/>' for i in range(chapters))
    opf = ('<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">'
           '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' + ''.join(meta) + '</metadata>'
           '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
           '<item id="cover-img" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>' + items + '</manifest>'
           '<spine>' + spine + '</spine></package>')
    nav = ('<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Inhalt</title></head>'
           '<body><nav epub:type="toc"><ol>' + ''.join(f'<li><a href="c{i}.xhtml">Kapitel {i + 1}</a></li>' for i in range(chapters)) + '</ol></nav></body></html>')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('OEBPS/content.opf', opf, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('OEBPS/nav.xhtml', nav, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('OEBPS/cover.jpg', jpg, compress_type=zipfile.ZIP_STORED)
        for i in range(chapters):
            z.writestr(f'OEBPS/c{i}.xhtml', f'<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Kapitel {i + 1}</title></head><body><h1>Kapitel {i + 1}</h1><p>{esc(title)}. {GERMAN * 12}</p></body></html>', compress_type=zipfile.ZIP_DEFLATED)

def safe(s): return ''.join('_' if c in '<>:"/\\|?*' else c for c in s)

def main():
    if os.path.exists(ROOT): shutil.rmtree(ROOT)
    os.makedirs(ROOT)
    man = []
    seed = [100]
    def pdf(rel, title, author, pages=120, **kw):
        seed[0] += 1
        p = os.path.join(ROOT, *rel.split('/'))
        write_pdf(p, title, author, pages, seed[0], **kw)
        man.append({'rel': rel, 'title': title, 'author': author, 'format': 'pdf', **{k: v for k, v in kw.items() if k in ('year', 'isbn', 'lang')}})
        return p
    def epub(rel, title, author, **kw):
        seed[0] += 1
        p = os.path.join(ROOT, *rel.split('/'))
        write_epub(p, title, author, seed[0], **kw)
        man.append({'rel': rel, 'title': title, 'author': author, 'format': 'epub', **{k: v for k, v in kw.items() if k in ('year', 'isbn', 'series', 'index', 'publisher')}})
        return p
    # --- Romane: authors and years for the sort orders ---------------------------------------------------------------
    novels = [
        ('Abendrot über dem Fjord', 'Clara Winter', 2014), ('Zwölf Briefe an Johanna', 'Bruno Albers', 1998), ('Die stille Werkstatt', 'Henrike Vogt', 2021),
        ('Mondlicht in Lissabon', 'Anton Zeller', 2003), ('Der Uhrmacher von Brügge', 'Greta Brandt', 1987), ('Kaffee mit Konstantin', 'Felix Ostermann', 2010),
        ('Ein Sommer am Haff', 'Ida Lorenz', 2019), ('Nachtzug nach Triest', 'Bruno Albers', 2007), ('Das Haus der Schwestern', 'Clara Winter', 2001),
    ]
    for i, (t, a, y) in enumerate(novels):
        pdf(f'Romane/Klassiker/{safe(t)} - {a}.pdf', t, a, pages=80 + i * 37, year=y)
    pubs = ['Nordlicht Verlag', 'Brückenhaus GmbH', 'Atlas Publishing', 'Edition Mohn']
    krimis = [('Tod am Deich', 'Jonas Reuter', 2016), ('Die siebte Spur', 'Marta Heinz', 2012), ('Schweigen im Moor', 'Jonas Reuter', 2009), ('Blaue Stunde', 'Lea Petersen', 2020), ('Der Fall Kessler', 'Marta Heinz', 1999)]
    for i, (t, a, y) in enumerate(krimis):
        epub(f'Romane/Krimis/{safe(t)} - {a}.epub', t, a, year=y, publisher=pubs[i % len(pubs)])
    # --- Reihen: volumes named in different ways; the title order is not the volume order -----------------------------
    pdf('Reihen/Sternenfahrer/Sternenfahrer, Band 1_ Aufbruch - Paula Weber.pdf', 'Sternenfahrer, Band 1: Aufbruch', 'Paula Weber', year=2015)
    pdf('Reihen/Sternenfahrer/Sternenfahrer #2_ Die Leere - Paula Weber.pdf', 'Sternenfahrer #2: Die Leere', 'Paula Weber', year=2016)
    pdf('Reihen/Sternenfahrer/Heimkehr (Sternenfahrer, Band 3) - Paula Weber.pdf', 'Heimkehr (Sternenfahrer, Band 3)', 'Paula Weber', year=2017)
    pdf('Reihen/Sternenfahrer/Sternenfahrer - Teil IV_ Das Echo - Paula Weber.pdf', 'Sternenfahrer - Teil IV: Das Echo', 'Paula Weber', year=2018)
    pdf('Reihen/Sternenfahrer/Sternenfahrer Band 10 - Paula Weber.pdf', 'Sternenfahrer Band 10', 'Paula Weber', year=2023)
    pdf('Reihen/Sternenfahrer/Abseits der Bahnen - Paula Weber.pdf', 'Abseits der Bahnen', 'Paula Weber', year=2020)
    for t, idx, y in [('Der Winter kommt', 2, 2011), ('Das Erbe', 1, 2010), ('Am Ende des Eises', 3, 2013)]:
        epub(f'Reihen/Chroniken/{safe(t)} - Ole Hansen.epub', t, 'Ole Hansen', year=y, series='Chroniken des Nordens', index=idx, publisher='Nordlicht Verlag')
    pdf('Reihen/Chroniken/Begleitbuch zur Welt - Ole Hansen.pdf', 'Begleitbuch zur Welt', 'Ole Hansen', year=2014)
    # --- Sachbücher: copies of one book, and books that only look alike ------------------------------------------------
    a = pdf('Sachbücher/Geschichte/Die Römer - Clara Hoffmann.pdf', 'Die Römer', 'Clara Hoffmann', pages=210, year=2011)
    os.makedirs(os.path.join(ROOT, 'Sachbücher', 'Kopien'), exist_ok=True)
    shutil.copyfile(a, os.path.join(ROOT, 'Sachbücher', 'Kopien', 'Die Römer - Clara Hoffmann.pdf'))
    man.append({'rel': 'Sachbücher/Kopien/Die Römer - Clara Hoffmann.pdf', 'title': 'Die Römer', 'author': 'Clara Hoffmann', 'format': 'pdf', 'year': 2011, 'copyOf': 'Sachbücher/Geschichte/Die Römer - Clara Hoffmann.pdf'})
    epub('Sachbücher/Geschichte/Die Römer -- Clara Hoffmann -- 2011 -- Verlag -- 5f2a9c0e7d4b1a3c8e6f0d2b4a6c8e0f -- Example Archive.epub', 'Die Römer', 'Clara Hoffmann', year=2011, publisher='Atlas Publishing')
    pdf('Sachbücher/Wissenschaft/Das Gehirn - Moritz Lang.pdf', 'Das Gehirn', 'Moritz Lang', pages=160)
    epub('Sachbücher/Wissenschaft/Das Gehirn - Moritz Lang.epub', 'Das Gehirn (2. Auflage)', 'Lang, Moritz', publisher='Brückenhaus GmbH')
    epub('Sachbücher/Wissenschaft/Kleine Geschichte des Meeres.epub', 'Kleine Geschichte des Meeres', 'Svenja Kühn', isbn='9783161484100', year=2008)
    epub('Sachbücher/Geschichte/Kleine Geschichte des Meeres_ Sachbuch.epub', 'Kleine Geschichte des Meeres: Sachbuch', 'Kühn, Svenja', isbn='978-3-16-148410-0', year=2015)
    # not copies: two volumes, two editions of other years, a title without an author
    pdf('Sachbücher/Geschichte/Rom Band 1 - Clara Hoffmann.pdf', 'Rom Band 1', 'Clara Hoffmann', year=2012)
    pdf('Sachbücher/Geschichte/Rom Band 2 - Clara Hoffmann.pdf', 'Rom Band 2', 'Clara Hoffmann', year=2013)
    pdf('Sachbücher/Wissenschaft/Grundkurs Statistik - Eva Lorenz.pdf', 'Grundkurs Statistik', 'Eva Lorenz', year=2005)
    epub('Sachbücher/Wissenschaft/Grundkurs Statistik - Eva Lorenz.epub', 'Grundkurs Statistik', 'Eva Lorenz', year=2019, publisher='Edition Mohn')
    pdf('Sachbücher/Wissenschaft/Königsindisch.pdf', 'Königsindisch', '', year=2001)
    pdf('Sachbücher/Wissenschaft/Königsindisch - Viktor Sokolow.pdf', 'Königsindisch', 'Viktor Sokolow', year=2004)
    # a language field that names no language (the text is German)
    pdf('Sachbücher/Geschichte/Die Hanse - Jörg Brenner.pdf', 'Die Hanse', 'Jörg Brenner', year=2017, lang='<¦')
    pdf('Sachbücher/Geschichte/Burgen am Rhein - Jörg Brenner.pdf', 'Burgen am Rhein', 'Jörg Brenner', year=2018, lang='ƒ*ªþ×')
    pdf('Sachbücher/Geschichte/Die Wikinger - Jörg Brenner.pdf', 'Die Wikinger', 'Jörg Brenner', year=2019, lang='DE-DE')
    json.dump({'books': man}, open(os.path.join(os.path.dirname(ROOT), 'shelves-manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('books', len(man))

main()
