# Contact sheets of the pictures the online sample found (build/testlib/record-cover-sources.js), for checking them by
# eye: per book the picture each catalogue had and the one the lookup picks (report.json), the picture each image
# search engine picks (engines-report.json), and what "Alle Cover jetzt laden" stored (batch-report.json,
# spread-report.json).
#   python build/testlib/cover-sheet.py <out folder of the recording>
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
TW, TH, LW = 110, 160, 330
font = ImageFont.truetype(os.path.join(r'C:\Windows\Fonts', 'arial.ttf'), 13)
ROWS = 18


def sheets(name, rows, cols, lines):
    """rows: [{ id, … }], cols: the picture names (<id>-<col>.jpg), lines(row): up to four lines of text."""
    for sheet in range(0, len(rows), ROWS):
        part = rows[sheet:sheet + ROWS]
        im = Image.new('RGB', (LW + len(cols) * (TW + 8), 26 + len(part) * (TH + 8)), (245, 243, 238))
        d = ImageDraw.Draw(im)
        for c, col in enumerate(cols):
            d.text((LW + c * (TW + 8) + 4, 6), col, fill=(60, 60, 60), font=font)
        for r, row in enumerate(part):
            y = 26 + r * (TH + 8)
            for i, (text, color) in enumerate(lines(row)):
                d.text((6, y + 4 + 18 * i), text, fill=color, font=font)
            for c, col in enumerate(cols):
                f = os.path.join(out, '%s-%s.jpg' % (row['id'], col))
                if not os.path.exists(f):
                    continue
                try:
                    t = Image.open(f).convert('RGB')
                    t.thumbnail((TW, TH))
                    im.paste(t, (LW + c * (TW + 8), y))
                except Exception:
                    pass
        im.save(os.path.join(out, '%s-%d.png' % (name, sheet // ROWS + 1)))
        print(name, sheet // ROWS + 1)


def read(name):
    f = os.path.join(out, name)
    return json.load(open(f, encoding='utf-8')) if os.path.exists(f) else None


report = read('report.json')
if report:
    def lines(row):
        pick, meta = row.get('pick'), row.get('meta') or {}
        return [(row['id'] + ' ' + row['title'][:44], (20, 20, 20)), ((row['author'] or '-')[:44], (90, 90, 90)),
                (('pick: %s %s' % (pick['via'], pick['level'])) if pick else 'pick: -', (40, 90, 40) if pick else (150, 40, 40)),
                (', '.join('%s=%s' % (k, str(v)[:22]) for k, v in meta.items())[:52], (80, 80, 120))]
    sheets('sheet', report, ['pick', 'replay', 'openlibrary', 'goodreads', 'apple', 'dnb', 'archive', 'amazon'], lines)

engines = read('engines-report.json')
if engines:
    books = {}
    for r in engines:
        books.setdefault(r['id'], {'id': r['id'], 'title': r['title'], 'picks': {}})['picks'][r['engine']] = r
    def lines(row):
        picks = ', '.join('%s: %s' % (e, (p['pick']['site'] + ' ' + p['pick']['confidence']) if p.get('pick') else ('-' if p['answered'] else 'no answer')) for e, p in row['picks'].items())
        return [(row['id'] + ' ' + row['title'][:44], (20, 20, 20)), (picks[:52], (40, 90, 40)), (picks[52:104], (40, 90, 40))]
    sheets('engines', list(books.values()), ['bing', 'yandex', 'duckduckgo'], lines)

def batch_lines(row):
    return [(row['id'] + ' ' + row['title'][:44], (20, 20, 20)), ((row.get('author') or '-')[:44], (90, 90, 90)),
            (('image search only, ' if row['image'] else '') + 'cover: %s %s' % (row['via'], row.get('site') or ''), (40, 90, 40) if row['via'] != '-' else (150, 40, 40))]


batch = read('batch-report.json')
if batch:
    sheets('batch', batch['list'], ['batch'], batch_lines)
spread = read('spread-report.json')
if spread:
    sheets('spread', spread['list'], ['batch'], batch_lines)
