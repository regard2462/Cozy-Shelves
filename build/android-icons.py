# The launcher icon of the Android app out of assets/icon-foreground.png (build/logo-icons.py: the shelf and the moon
# of the logo without its tile, already inside the 72 dp safe zone of the 108 dp canvas, so they survive every mask)
# at the five densities. The background is the tile's night blue (res/values/colors.xml icon_background). Needs Pillow.
#   python build/logo-icons.py && python build/android-icons.py
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit('Pillow is needed: pip install pillow')

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(root, 'assets', 'icon-foreground.png')
res = os.path.join(root, 'android', 'app', 'src', 'main', 'res')
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

icon = Image.open(src).convert('RGBA')
for name, factor in DENSITIES.items():
    size = int(108 * factor)
    canvas = icon.resize((size, size), Image.LANCZOS)
    folder = os.path.join(res, 'mipmap-' + name)
    os.makedirs(folder, exist_ok=True)
    canvas.save(os.path.join(folder, 'ic_launcher_foreground.png'), optimize=True)
    print(name, size, 'px')
print('icons written to', res)
