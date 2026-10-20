// Makes an EPUB with scripted content for build/scripts/epub-script-check.js: an external script, an inline script
// and an event handler attribute, each of which would write into the window of the app if it ran.
//   node build/testlib/make_scripted_epub.js <folder>       → <folder>/Romane/Ein Buch mit Skript.epub
'use strict';
const fs = require('fs');
const path = require('path');
const { zip } = require('../../electron/catalog/epub');

function scriptedEpub() {
  const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="de" xml:lang="de"><head><meta charset="utf-8"/><title>Kapitel 1</title>
<script src="pwn.js"></script>
<script>try { parent.__epubInline = 'the inline script ran'; } catch (e) {}</script>
</head><body>
<h1>Ein Buch mit Skript</h1>
<p id="hallo">Hallo aus dem Buch. Dieser Satz steht im Buch, damit der Leser etwas zeigt.</p>
<img src="gibt-es-nicht.png" alt="" onerror="try { parent.__epubHandler = 'the handler ran'; } catch (e) {}"/>
<p><a href="javascript:parent.__epubLink='the link ran'">Ein Link</a></p>
</body></html>`;
  const js = "try { parent.__epubScript = 'the external script ran'; top.__epubScriptTop = 'the external script reached the top window'; } catch (e) {}\n";
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="de">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:cozy-shelves:test:scripted-epub</dc:identifier>
    <dc:title>Ein Buch mit Skript</dc:title>
    <dc:creator>Erika Muster</dc:creator>
    <dc:language>de</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml" properties="scripted"/>
    <item id="js" href="pwn.js" media-type="application/javascript"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`;
  const nav = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Inhalt</title></head><body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">Kapitel 1</a></li></ol></nav></body></html>`;
  return zip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/ch1.xhtml', data: xhtml },
    { name: 'OEBPS/pwn.js', data: js },
    { name: 'OEBPS/nav.xhtml', data: nav },
  ]);
}

if (require.main === module) {
  const folder = process.argv[2];
  if (!folder) { console.error('usage: node build/testlib/make_scripted_epub.js <folder>'); process.exit(2); }
  const dir = path.join(folder, 'Romane');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'Ein Buch mit Skript.epub');
  fs.writeFileSync(file, scriptedEpub());
  console.log(file);
}

module.exports = { scriptedEpub };
