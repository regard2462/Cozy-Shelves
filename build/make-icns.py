# Writes assets/icon.icns (the macOS icon) out of assets/icon-512.png. The ICNS container is written here, chunk by
# chunk, with PNG data inside (types icp4 to icp6, ic07 to ic09, ic13, ic14), so no tool of macOS is needed.
# The largest picture is 512 px: the 1024 px size (ic10) is left out instead of being scaled up.
#   python build/make-icns.py
import io
import os
import struct
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit('Pillow is needed: pip install pillow')

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = Image.open(os.path.join(root, 'assets', 'icon-512.png')).convert('RGBA')
if src.size != (512, 512):
    sys.exit('assets/icon-512.png must be 512 x 512 px')

# type, edge in px
CHUNKS = [('icp4', 16), ('icp5', 32), ('icp6', 64), ('ic07', 128), ('ic13', 256), ('ic08', 256), ('ic14', 512), ('ic09', 512)]
body = b''
for kind, edge in CHUNKS:
    buf = io.BytesIO()
    (src if edge == 512 else src.resize((edge, edge), Image.LANCZOS)).save(buf, 'PNG', optimize=True)
    data = buf.getvalue()
    body += kind.encode('ascii') + struct.pack('>I', len(data) + 8) + data
out = os.path.join(root, 'assets', 'icon.icns')
with open(out, 'wb') as f:
    f.write(b'icns' + struct.pack('>I', len(body) + 8) + body)
print(out, os.path.getsize(out), 'bytes')
