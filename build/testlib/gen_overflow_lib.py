# A synthetic library too large for the walls of the book room, for fallback-check and room-views: 16 invented
# departments with 7 shelves each and 10 small PDFs per shelf (1120 books, about 48 cases: every shelf is a row of its
# own, three rows make a case, the walls hold about 35). Minimal two-page PDFs with title and author in the Info
# dictionary and on page 1; nothing in it refers to anyone.
#   python build/testlib/gen_overflow_lib.py <folder for the test library>
import os, sys, random

ROOT = sys.argv[1]
rnd = random.Random(72)
DEPARTMENTS = ['Astronomie', 'Botanik', 'Chemie', 'Drama', 'Ethik', 'Fotografie', 'Geologie', 'Handwerk',
               'Informatik', 'Jura', 'Kartografie', 'Linguistik', 'Mathematik', 'Nautik', 'Ornithologie', 'Zoologie']
SHELVES = ['01 Grundlagen', '02 Geschichte', '03 Methoden', '04 Praxis', '05 Essays', '06 Lexika', '07 Lehrbuecher']
WORDS = ['Einfuehrung', 'Handbuch', 'Grundriss', 'Streifzuege', 'Studien', 'Beobachtungen', 'Uebungen', 'Lesebuch', 'Wegweiser', 'Kompendium']
FIRST = ['Lena', 'Jonas', 'Mira', 'Tobias', 'Ida', 'Felix', 'Nora', 'Emil', 'Clara', 'Paul', 'Greta', 'Oskar']
LAST = ['Berg', 'Stein', 'Wald', 'Bach', 'Feld', 'Winter', 'Sommer', 'Hain', 'Moor', 'Tal', 'Brunn', 'Heide']

def pdf(title, author, pages):
    objs = []
    def add(s): objs.append(s); return len(objs)
    font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    page_ids = []
    kids_placeholder = add('')   # the pages tree, filled below
    for k in range(pages):
        text = f'({title})' if k == 0 else f'(Seite {k + 1})'
        sub = f'({author})' if k == 0 else '()'
        stream = f'BT /F1 28 Tf 60 700 Td {text} Tj 0 -40 Td /F1 18 Tf {sub} Tj ET'
        content = add(f'<< /Length {len(stream)} >>\nstream\n{stream}\nendstream')
        page_ids.append(add(f'<< /Type /Page /Parent {kids_placeholder} 0 R /MediaBox [0 0 420 640] /Resources << /Font << /F1 {font} 0 R >> >> /Contents {content} 0 R >>'))
    objs[kids_placeholder - 1] = f'<< /Type /Pages /Kids [{" ".join(f"{p} 0 R" for p in page_ids)}] /Count {pages} >>'
    catalog = add(f'<< /Type /Catalog /Pages {kids_placeholder} 0 R >>')
    info = add(f'<< /Title ({title}) /Author ({author}) >>')
    out = bytearray(b'%PDF-1.4\n')
    offsets = []
    for i, body in enumerate(objs):
        offsets.append(len(out))
        out += f'{i + 1} 0 obj\n{body}\nendobj\n'.encode('latin-1')
    xref = len(out)
    out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode()
    for o in offsets: out += f'{o:010d} 00000 n \n'.encode()
    out += f'trailer\n<< /Size {len(objs) + 1} /Root {catalog} 0 R /Info {info} 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return bytes(out)

n = 0
for d in DEPARTMENTS:
    for s in SHELVES:
        folder = os.path.join(ROOT, d, s)
        os.makedirs(folder, exist_ok=True)
        for i in range(10):
            title = f'{WORDS[i % len(WORDS)]} der {d} {i + 1}'
            author = f'{FIRST[rnd.randrange(len(FIRST))]} {LAST[rnd.randrange(len(LAST))]}'
            with open(os.path.join(folder, f'{title} - {author}.pdf'), 'wb') as f: f.write(pdf(title, author, 2 + rnd.randrange(3)))
            n += 1
print('books', n)
