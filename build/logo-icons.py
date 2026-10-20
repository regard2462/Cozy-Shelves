# The app icons out of the logo "Mondregal" (assets/logo.svg): a shelf of books under the moon and the stars, drawn
# here from the same shapes (120 units, four times larger and scaled down for smooth edges). Writes
#   assets/icon.png (256 px), assets/icon-512.png, assets/icon.ico (16 to 256 px): window, Windows exe, Linux, web
#   assets/icon-foreground.png (512 px, the shelf and the moon without the tile, inside the safe zone of an Android
#   adaptive icon; build/android-icons.py makes the launcher icons of it, the tile colour is icon_background)
# Needs Pillow.   python build/logo-icons.py
import math
import os
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit('Pillow is needed: pip install pillow')

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
assets = os.path.join(root, 'assets')

TILE = '#1f2b3d'
CREAM = '#f3e7cf'
BOOKS = [  # x, y, w, h, radius, colour (the last one leans, see LEAN)
    (27, 64, 9, 28, 2, '#e39a32'), (37.5, 60, 8, 32, 2, '#7a9cc0'), (47, 66, 10, 26, 2, '#b4533a'),
    (58.5, 62, 8, 30, 2, '#e7d6b5'), (68, 67, 9, 25, 2, '#6f9b7c'),
]
LEAN = (80, 70, 7, 22, '#c58c5b', 14, (83, 92))   # x, y, w, h, colour, degrees, pivot
SHELF = (22, 92, 76, 5, 2.5, '#8a6a4f')
STARS = [(36, 30, 2), (48, 44, 1.4), (94, 56, 1.6)]


def draw(size, tile=True, scale=1.0):
    """The logo at `size` px; without the tile, `scale` shrinks the shapes about the middle (Android's safe zone)."""
    ss = 4
    S = size * ss
    k = S / 120 * scale
    off = S / 2 - 60 * k
    P = lambda x, y: (off + x * k, off + y * k)
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if tile:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=28 * S / 120, fill=TILE)
    # the moon: a disc with a smaller one taken out of it (on its own layer, so the cut is transparent)
    moon = Image.new('L', (S, S), 0)
    m = ImageDraw.Draw(moon)
    cx, cy = P(74, 38); r = 16 * k
    m.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    cx, cy = P(82, 32); r = 14 * k
    m.ellipse([cx - r, cy - r, cx + r, cy + r], fill=0)
    img.paste(Image.new('RGBA', (S, S), CREAM), (0, 0), moon)
    for x, y, r in STARS:
        cx, cy = P(x, y); r *= k
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=CREAM)
    for x, y, w, h, rad, col in BOOKS:
        x0, y0 = P(x, y); x1, y1 = P(x + w, y + h)
        d.rounded_rectangle([x0, y0, x1, y1], radius=rad * k, fill=col)
    x, y, w, h, col, deg, (px, py) = LEAN
    a = math.radians(deg)
    corners = []
    for cx_, cy_ in [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]:
        dx, dy = cx_ - px, cy_ - py
        corners.append(P(px + dx * math.cos(a) - dy * math.sin(a), py + dx * math.sin(a) + dy * math.cos(a)))
    d.polygon(corners, fill=col)
    x, y, w, h, rad, col = SHELF
    x0, y0 = P(x, y); x1, y1 = P(x + w, y + h)
    d.rounded_rectangle([x0, y0, x1, y1], radius=rad * k, fill=col)
    return img.resize((size, size), Image.LANCZOS)


draw(256).save(os.path.join(assets, 'icon.png'), optimize=True)
draw(512).save(os.path.join(assets, 'icon-512.png'), optimize=True)
big = draw(256)
big.save(os.path.join(assets, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
# Android: the shapes span about 76 of 120 units; at 0.85 they fill about 54 % of the 108 dp canvas, inside the 72 dp
# (66 %) circle every launcher mask keeps
draw(512, tile=False, scale=0.85).save(os.path.join(assets, 'icon-foreground.png'), optimize=True)
print('icons written to', assets)
