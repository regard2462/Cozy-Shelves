# Daten der Weltkarte

Die Weltkarte (Panel „Weltkarte“ und die Karte an der Wand des Bücherzimmers) arbeitet offline mit diesen Dateien.
Erzeugt werden sie mit `node build/worldmap-data.js <Ordner mit den Natural-Earth-Dateien>`.

| Datei | Inhalt | Quelle | Lizenz |
|---|---|---|---|
| `world.json` | Ländergrenzen als Topologie (jede Grenzlinie einmal), Küsten, große Seen und Flüsse, Kennzahlen je Land | Natural Earth 5.1: `ne_10m_admin_0_countries_deu` (Staatsgrenzen in deutscher Sichtweise), vereinfacht auf etwa 1:50 Mio.; `ne_50m_lakes`, `ne_50m_rivers_lake_centerlines` | gemeinfrei (Public Domain) |
| `world.json`, Felder `lang`, `cur`, `area` (wo `areaSrc` = `wd`) | Amtssprachen, Währungen, amtliche Fläche | Wikidata, abgefragt am Tag der Erzeugung | CC0 |
| `places.json` | rund 7 300 Städte mit Namen (deutsch, englisch, örtlich), Lage, Einwohnerzahl, Hauptstadtstatus, Region, Zeitzone, Wikidata-Kennung | Natural Earth 5.1: `ne_10m_populated_places` | gemeinfrei (Public Domain) |
| `TwemojiCountryFlags.woff2` | Flaggen-Emoji für Windows (Chromium zeigt dort sonst nur zwei Buchstaben) | „Twemoji Country Flags“ aus country-flag-emoji-polyfill (TalkJS), eine Teilmenge von Twemoji Mozilla | Grafiken: Twemoji © Twitter, Inc. und weitere, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); Schriftdatei: Apache-2.0 (Mozilla), Teilmenge MIT (TalkJS) |

Natural Earth: „Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.“

Bearbeitung:

- Grenzen: Natural Earth 1:10 Mio. in der deutschen Sichtweise (die Krim gehört zur Ukraine, Somaliland zu Somalia,
  Nordzypern zu Zypern, Westsahara ist ein eigenes Gebiet). Die Grenzlinien werden als gemeinsame Bögen gespeichert
  und nur einmal vereinfacht (Douglas-Peucker, 0,018°), damit Nachbarländer lückenlos aneinanderstoßen. Inseln unter
  30 km² entfallen, die drei größten Teile jedes Landes bleiben immer erhalten. Koordinaten in 0,01°.
- Fläche: amtliche Fläche aus Wikidata, wenn sie dasselbe Gebiet beschreibt (Abweichung unter 10 %); sonst die aus
  den ungekürzten Umrissen auf der Kugel berechnete Fläche (`areaSrc` = `ne`).
- Nachbarländer: Länder mit gemeinsamer Landgrenze in den ungekürzten Umrissen.
- Hauptstädte: die Admin-0-Hauptstadt von Natural Earth; wo Natural Earth von der deutschsprachigen Wikipedia
  abweicht, legt eine Tabelle in `build/worldmap-data.js` Hauptstadt und weitere Sitze von Staatsorganen fest.
- Einwohner und Wirtschaftsdaten der Länder stammen aus Natural Earth (Schätzungen, meist Stand 2019), die Einwohner
  der Städte sind Schätzungen für den Ballungsraum (`POP_MAX`).
