<p align="center"><img src="assets/logo.svg" width="120" alt="Cozy Shelves"></p>

# Cozy Shelves

*English: [README.md](README.md)*

Cozy Shelves ist eine begehbare 3D-Bücherei für Windows und Linux, in der du durch deine eigenen Bücher gehst. Zur Halle
gehören ein Kamin, eine große Glasfront mit Türen zur Terrasse und in einen Garten mit See und Steg, dazu
Lesetische und Sessel. Im Garten wechseln die Jahreszeiten, Vögel fliegen über Wiese und See, Kois schwimmen im
Wasser, und Rehe, Hirsche und Füchse kommen aus dem Wald. Hinter einem kurzen Durchgang liegt **ein** großes
Bücherzimmer, in dem alle Abteilungen an den Wänden stehen, jede unter einem eigenen Schild. Deine Ordner sind die Abteilungen, ihre Unterordner die Regale. Mit einem runden Menü
(`Tab` halten, Maus bewegen, loslassen) gehst du direkt zu einer Abteilung. Die Bücher stehen auf Augenhöhe in
beleuchteten Regalen, Empfehlungen mit Cover liegen auf einem schrägen Brett davor. Du nimmst sie heraus, legst
sie in den Korb, setzt dich ans Feuer und liest im Vollbild, mit Lesezeichen, Notizen, Wörterbuch, Volltextsuche
über alle Bücher und Vorlesefunktion. Dazu kommen Hörbücher aus eigenen Ordnern, eine Weltkarte mit Steckbriefen
zu Ländern und Städten und Google Street View, Zeitungen und Magazine mit ganzen Artikeln, Wikipedia, Podcasts,
eine Mediathek mit Filmen und Sendungen öffentlich-rechtlicher und englischsprachiger Sender, ein Online-Katalog
mit freien Büchern, ein eingebauter Lesebrowser, ein Plattenspieler mit ruhiger Musik, ein Aquarell-Atelier, ein
Schachtisch mit Stockfish und Taktikaufgaben sowie zwei Computer am Eingang mit Katalog, Statistik und Spielen.
Alles lässt sich mit Tastatur und Maus oder mit einem Controller bedienen.

## Neu in 0.10.2

* **Schachdiagramme besser erkannt**: Das Diagramm-Werkzeug (`D`) liest Stellungen aus Büchern deutlich zuverlässiger.
  Sein Netz hat an über 160 echten Schachbüchern gelernt, an Diagrammen in vielen Figurensätzen und an Brettern von
  Bildschirmen. Auf Testbüchern, die es nie gesehen hat, liest es 95 von 100 Diagrammen ohne Fehler (vorher etwa 65),
  Bretter von Bildschirmen und Fotos ebenfalls weit öfter. Die angezeigte Sicherheit passt zum neuen Netz.
* **Flüssiger auf dem Handy**: Handys und Tablets starten mit der neuen Grafikstufe „Mobil“. Sie zeichnet nur, was
  durch die Türen und Fenster zu sehen ist, mit vier Lampen, ohne Kantenglättung und mit kürzerem Hall. Das spart auf
  der Grafikkarte ein Fünftel bis ein Drittel der Zeit. Wer schon eine frühere Version auf dem Handy hatte, bekommt
  die Stufe einmal automatisch.

## Neu in 0.10.0

* **Neuer Name**: Aus Cozystacks wird Cozy Shelves. Deine Daten bleiben: Liegen im Datenordner von Cozystacks oder
  von Lesesaal schon Einstellungen oder eine Bücherei, benutzt Cozy Shelves ihn weiter, mit allen Lesestellen,
  Notizen, Covern und dem Index der Volltextsuche. Auch die Download-Ordner `Cozystacks Mediathek` und
  `Lesesaal Mediathek` bleiben in Gebrauch. Das Programm heißt jetzt `CozyShelves.exe`, unter Linux `cozy-shelves`.
* **Android**: Die App hat eine neue Kennung und erscheint neben der bisherigen Cozystacks-App. Einstellungen und
  Lesestellen der bisherigen App übernimmt sie nicht, den Bücherordner wählst du einmal neu.

## Neu in 0.9.2

* **Weltkarte als ruhiger Atlas**: In der Übersicht zeigt die Weltkarte Länder in sanften Farben, Seen und große
  Flüsse, dazu die Namen von Ländern, Hauptstädten, Städten und Meeren auf Deutsch (oder Englisch). Kein Name
  überdeckt einen anderen. Unten wählst du die Ansicht: Länder, Kontinente, Bevölkerung oder Wohlstand, jeweils mit
  Legende. Der Tooltip nennt Hauptstadt und Einwohner. Erst beim Hineinzoomen in eine Region erscheint die Karte von
  OpenStreetMap mit Orten und Straßen, farblich gedämpft. Die Übersicht geht auch ohne Internet.
* **Neues Logo**: Das neue Logo „Mondregal“, ein Bücherregal unter Mond und Sternen, ist auch das Symbol der App unter
  Windows, Linux, Android und im Browser.

## Neu in 0.9.1

* **Weltkarte von OpenStreetMap**: Die Weltkarte zeigt jetzt die Karte von OpenStreetMap, mit Straßen, Orten und
  Landschaft bis hinunter zu einzelnen Häusern. Die selbst gezeichnete Karte blieb auf einem Windows-System seit 0.5
  unsichtbar. Die Kacheln sind gewöhnliche Bilder wie alle anderen in der Tafel. Steckbriefe, Suche, Verlauf und Street
  View bleiben wie bisher, das gewählte Land wird auf der Karte umrandet. Die Karte braucht eine Internetverbindung,
  ohne Verbindung erscheint ein Hinweis mit „Erneut versuchen“.
* **Android**: Beim Anvisieren steht auf Handy und Tablet kein Name mehr unter dem Fadenkreuz. Der Ring zeigt weiter,
  dass sich etwas benutzen lässt.

## Neu in 0.9.0

* **Weichere Lichtstrahlen**: Die Strahlen, die durch die Blätter fallen, schwimmen beim Gehen nicht mehr gegen das
  Laub, flackern beim Umsehen zwei- bis fünfmal weniger und laufen an Blatträndern nicht mehr über. Feine Farbverläufe
  am Himmel zeigen keine Stufen mehr.
* **Schneller bei gleichem Bild**: Auf der hohen Grafikstufe braucht ein Bild auf der Grafikkarte 17 bis 43 % weniger
  Zeit, auf der mittleren bis 45 %, auf der niedrigen 10 bis 20 % in den Räumen. Der Start dauert 2 bis 4 Sekunden
  weniger, die Bildpuffer belegen rund 70 MB weniger Speicher. Nur der allererste Start nach einem Update übersetzt
  die Shader etwa eine Sekunde länger.
* **Weiche Schritte**: Jeder Schritt ist ein weiches, gedämpftes Auftreten, draußen raschelt der Boden leise. Das
  Quietschen auf dem Gartenweg ist weg.
* **Browser-Version**: Zusätzlich zur Desktop-App gibt es Cozy Shelves als schlanke Webseite ohne Sprachmodelle (siehe
  *Browser-Version*).
* **Android-App**: Cozy Shelves gibt es als App für Android-Handys und -Tablets, mit Touch-Steuerung und Bücherordner
  vom Gerät (siehe *Android-App*).
* **Sicherheit**: Ein präpariertes EPUB konnte im Reader eigene Skripte ausführen und dabei die Schnittstelle zum
  Hauptprozess erreichen. Skripte aus Büchern sind jetzt gesperrt. Auch präparierte Einstellungen und lokale Adressen
  in Zeitungen, Podcasts und Fernleihe kommen nicht mehr durch.
* **Behoben**: Nach einem Absturz des Indexers wartete jedes weitere Buch eine Minute und mehr. `Tab` sprang aus offenen
  Tafeln auf versteckte Knöpfe des Mini-Players. „Alles zurückgeben“ ließ bei vielen Büchern im Korb einen Teil still
  verschwinden. Nach Gewitter oder Schnee blieben Vögel und Frösche minutenlang stumm. Katze und Schallplatte ließen
  Speicher zurück. Wer saß, wurde beim Wechsel der Abteilung auf Stehhöhe gesetzt. Im Fischgrätparkett saßen dunkle
  Pixel. Ein zweites `Enter` öffnete im Computer eine zweite Schachpartie. Weitere Fehler betrafen den Controller beim
  Hörbuch, Zahlen und Daten in der Sprache der Oberfläche, Stimmen-Downloads, Must-Read über Ordner-Links und den
  Eintrag „None“ in der Zeitung.

## Neu in 0.8.0

* **Neuer Name**: Aus Lesesaal wird Cozystacks. Deine Daten bleiben: Gibt es den Datenordner von Lesesaal schon,
  benutzt Cozystacks ihn weiter, mit allen Einstellungen, Lesestellen, Notizen, Covern und dem Index der
  Volltextsuche. Auch der Download-Ordner `Lesesaal Mediathek` bleibt in Gebrauch.
* **Linux**: Cozy Shelves gibt es jetzt auch für Linux (x64), als `.deb` für Debian, Ubuntu und Mint und als
  portables Archiv für andere Systeme (siehe *Schnellstart*).
* **Must-Read unter Linux**: Ein symbolischer Link auf ein Buch macht es zum Must-Read, wie eine Verknüpfung unter
  Windows.

## Neu in 0.7.2

* **Bücherzimmer wieder eingeschossig**: Die Galerie aus 0.7 ist weg. Das Zimmer ist wie in 0.6.2 fünf Meter hoch, mit
  den hohen Fenstern, zwei Stoffleuchten in der Mitte und Wandleuchten an den Seitenwänden. Alle Abteilungen stehen an
  den Wänden. Passt eine Bücherei nicht an die Wände, steht eine Abteilung im Zimmer, und das Abteilungsrad (`Tab`)
  wechselt sie. Der Ort „Galerie“ und die Bänke oben sind weg. Die Tafel im Durchgang zeigt die Abteilung im Zimmer
  mit ihrer Nummer aus der Liste.
* **Weltkarte**: Die Karte liegt jetzt auf der Leinwand der 3D-Welt. Auf einem Windows-System blieb die Kartenfläche
  bis 0.7.1 leer, ob sie als eigene Grafikebene oder zusammen mit der Tafel gemalt wurde, während die Welt selbst
  immer zu sehen war. Darum geht die Karte denselben Weg auf den Bildschirm wie die Welt: Sie wird im Hintergrund
  gezeichnet und als Bild auf die Leinwand der Welt gelegt, hinter der Tafel das Standbild der Welt, in der Tafel die
  Karte. Nach dem Öffnen vergleicht Cozy Shelves einmal das Bild auf dem Bildschirm mit der Karte und vermerkt das
  Ergebnis in `logs\renderer.log` im Datenordner. Stimmt es nicht, sagt ein Hinweis das.
* **Wildtiere**: Rehe, Hirsche und Füchse flüchten gemächlicher: in einem zügigen Trab statt im Galopp und nur ein
  Stück weit. Rehe bleiben in 16 bis 24 Metern Abstand zu dir stehen, Hirsche in 18 bis 26, Füchse in 12 bis 18,
  schauen sich nach dir um, beruhigen sich und fressen an einer anderen Stelle weiter.
* **Katze**: Die Bibliothekskatze ist neu modelliert: rundlich und dick wie bisher, aber mit Gesicht (Wangen,
  Schnauze, rosa Nase, Maul, Schnurrhaare, Bernsteinaugen mit Pupille und Glanzlicht, hellere Ohrinnenseiten),
  Tigerung mit dem „M“ auf der Stirn, Ringeln an Beinen und Schwanz, einem buschigen Schwanz mit dunkler Spitze,
  Pfoten mit Zehen und einem Bauch, der im Sitzen durchhängt. Im Schlaf sind die Augen geschlossen, wach blinzelt
  sie.
* **Orte im Abteilungsrad**: Das Rad (`Tab`) hat zwei Ringe. In seiner Mitte steht „Orte“: Bewegst du die Maus in die
  Mitte oder drückst `Q`, zeigt das Rad statt der Abteilungen alle Orte der Bücherei, nach Bereichen geordnet wie
  unter *Orte* (`G`). Loslassen, Klick, `Enter` oder eine Ziffer über einem Ort bringt dich sofort dorthin, ohne den
  Weg über das Menü. Noch einmal in die Mitte oder `Q` zeigt wieder die Abteilungen. Am Controller wechseln `LB` und
  `RB` zwischen den Ringen. Lange Namen im Rad werden jetzt an der Wortfuge getrennt („Glas-front“).
* **Das herausgezogene Buch und die Cover-Karte**: Das Buch, das sich aus dem Regal zieht, zeigt sein Cover jetzt
  ganz und nimmt dessen Proportionen an, nichts wird mehr beschnitten. Die Drehung hält kurz vor dir an, Buchrücken
  und Papierblock bleiben zu sehen, das Buch wirkt greifbar statt wie ein flaches Bild. Die Karte rechts zeigt das
  Cover ohne den weißen Rahmen, die Tasten stehen auf einer kleinen Leiste darunter.
* **Fehler auf dem Schirm**: Fehler der Oberfläche landen in `logs\renderer.log` im Datenordner (Zeit, Meldung, wo du
  gerade warst), höchstens 20 je Minute, die Datei bleibt klein.

## Neu in 0.7.1

* **Weltkarte**: Die Karte wird jetzt mit dem übrigen Inhalt der Tafel gemalt. Bisher war sie eine eigene
  Grafikebene, und auf manchen Windows-Systemen erschien diese Ebene nie, die Karte blieb dann leer. Beim Verschieben
  und Zoomen zeichnet sie mit halber Auflösung und danach wieder scharf, das läuft flüssiger als bisher. Hinter der
  Karte liegt ein weiches Standbild der Welt. (Seit 0.7.2 liegt die Karte auf der Leinwand der Welt, siehe oben.)
* **Nach einem Absturz der Grafik**: Endete der Grafikprozess, etwa bei einem Aussetzer des Treibers, blieb die Welt
  bisher schwarz. Jetzt baut sich Cozy Shelves neu auf und stellt dich an dieselbe Stelle, ein kurzer Hinweis sagt es.
  Ist eine Tafel offen, etwa ein Buch, geschieht das erst, wenn du sie schließt. Jedes solche Ereignis steht mit
  Uhrzeit in `logs\gpu.log` im Datenordner.
* **Regal „Gelesen“** ohne die Karte im leeren Regal und ohne das Messingschild auf dem Brett. Leseziel und
  Lesesträhne stehen in der Statistik am Computer.
* **Galerie** ohne Wendeltreppe und Lesebalkon. Hinauf und hinunter geht es über *Orte* (`G`), das Abteilungsrad und
  die Bänke oben. (In 0.7.2 wieder entfernt.)
* **Hörbuchregal**: Es steht in der Halle, auch bevor es einen Hörbuchordner gibt. `E` oder ein Klick öffnet die Tafel
  „Hörbücher“ mit „Hörbuchordner hinzufügen“.
* **Staffelei**: Sie ist jetzt eine Atelierstaffelei auf drei Beinen. Die beiden Vorderbeine stehen unten
  auseinander und treffen sich oben, das Hinterbein reicht hinten auf den Boden. Die weiße Leinwand ohne Schrift ruht
  auf der Leiste und lehnt am Mast. Sie zeigt das zuletzt gemalte Aquarell, auch nach einem Neustart.
* **Winter im Garten**: Im Schnee bleiben Spuren von dir, von Rehen, Hirschen, Füchsen, dem Wolf und den Vögeln, die
  nach einigen Minuten verwehen. Im Winter ist der See zugefroren und trägt dich, auf dem Eis rutschst du leicht. Auf
  dem Weg ist der Schnee in der Mitte festgetreten und an den Rändern locker, auf Terrasse und Steg zeichnen sich die
  Bretter ab, unter dem Vordach liegt kaum Schnee.
* **Wildtiere**: Kommst du Rehen, Hirschen oder Füchsen zu nahe, flüchten sie schnell, Rehe in weiten Sprüngen. Ein
  gutes Stück entfernt bleiben sie stehen, schauen sich nach dir um und beruhigen sich. Ihr Besuch geht an einer
  anderen Stelle weiter und endet erst zur vorgesehenen Zeit. (Seit 0.7.2 ein zügiger Trab, siehe oben.)
* **Cover an den Seiten der Bücher**: Am Anfang und am Ende jeder Reihe und neben jeder Lücke zeigt ein Buch sein
  Cover auch an der Seite, ein Buch ohne Cover seine Titelkarte. Das Bild ist wie ein Druck zugeschnitten und wird nie
  verzerrt.

## Neu in 0.7

* **Galerie**: Das Bücherzimmer ist zwei Geschosse hoch, mit einer Galerie. Sind die Wände unten voll, gehen die
  Abteilungen oben weiter. (In 0.7.2 wieder entfernt.)
* **Hörbücher** aus eigenen Ordnern mit Player, Kapiteln, Schlaftimer, Lesestand und einem Hörbuchregal in der Halle
  (`H`).
* **Volltextsuche** in allen Büchern mit Seite und Textstelle (`T` oder `Strg`+`F`).
* **Regal „Gelesen“**, dazu Leseziel und Lesesträhne in der Statistik, `C` markiert ein Buch als gelesen. Doppelte
  Bücher stehen nur einmal im Regal, die Bücher eines Regals lassen sich nach Autor, Jahr, Verlag, Reihe und mehr
  sortieren.
* **Cover und Metadaten** kommen schnell und genau aus vielen Buchkatalogen und drei Bildersuchen. „Alle Cover jetzt
  laden“ holt alle auf einmal, in der Buchinfo wählst du ein anderes Cover.
* **Lesen**: Textansicht für PDFs (`X`), einstellbare Seitenbreite, drei neue Leseschriften, Schriftgröße mit
  `Strg`+`+` und `Strg`+`−`.
* **Vorlesen**: Deutsche Bücher werden richtig vorgelesen (Sprache je Absatz, sauberer PDF-Text, Schachnotation in
  Worten). Das Stimmenmenü sitzt am Vorlese-Symbol (`Umschalt`+`V`), alle Stimmen lassen sich auf einmal laden.
* **Controller**: Xbox-, PlayStation- und andere Controller steuern die Welt, die Tafeln und die Bücher.
* **Himmel und Wetter**: Sternenhimmel mit Milchstraße und Mond, hellere Nächte, Nur Tag und Nur Nacht, einstellbare
  Länge eines Tages, Nebel und Wind zu jedem passenden Wetter, wechselndes Wetter und das echte Wetter eines Orts.
  Die Schatten der Bäume wandern gleitend, Lampen spiegeln sich kaum noch im Glas.
* **Garten**: Jahreszeiten, Seerosen mit rosa Blüten, Schilf und Rohrkolben, Bäume ohne Aufploppen, eine Feuerschale,
  Vögel im Flug, Kois und Frösche im See. Wildtiere kommen oft und zeigen sich vor jedem Fenster, an einer
  Futterstelle schaust du ihnen aus einem Beobachtungsstand zu.
* **Klang**: Regen, Wind und Donner nur bei passendem Wetter, Vögel, Frösche und Grillen im Garten, Schritte nach dem
  Boden, lautlose Glastüren. Jedes Geräusch lässt sich einzeln ausschalten.
* **Räume**: zehn Fußböden zur Wahl, Graffiti auf Englisch, jede Lampe einzeln schaltbar, eine kleinere Buchkarte,
  gleich hohe Pulte für Lesebrowser und Lexikon.
* **Mediathek**: englischsprachige Quellen und Nachrichtensender, die Qualität als Auflösung (1080p, 720p …),
  flüssiges Gehen, während ein Film auf der Leinwand läuft. Die Zeitung zeigt Zeitungen in der Sprache der Oberfläche.
* **Schach**: Buchdiagramme mit Schraffur, Koordinaten und Pfeilen werden erkannt, die angezeigte Sicherheit stimmt.
* **Für alle gleich**: Beim ersten Start trägt Cozy Shelves keinen Ordner von selbst ein, eine Willkommenskarte
  fragt danach. Cozy Shelves ist freie Software unter der GPL-3.0.
* **Behoben**: Schließen beendet Cozy Shelves ganz, auch während die Volltextsuche liest.

## Schnellstart

**Windows**: `CozyShelves-…-win64-portable.zip` entpacken (z. B. nach `C:\Programme\CozyShelves` oder auf den
Desktop) und `CozyShelves.exe` starten.

**Linux mit Debian, Ubuntu oder Mint**: `sudo apt install ./cozy-shelves_…_amd64.deb` im Ordner der Datei. Danach steht
Cozy Shelves im Anwendungsmenü, im Terminal startet es mit `cozy-shelves`.

**Linux, andere Systeme**: `CozyShelves-…-linux-x64.tar.gz` entpacken und im Programmordner `./cozy-shelves` starten.
`./install-desktop-entry.sh` legt einen Eintrag im Anwendungsmenü an. Bricht Cozy Shelves mit einer Meldung über
`chrome-sandbox` ab, erlaubt das System die Sandbox von Chromium nur über dieses Hilfsprogramm (Ubuntu ab 23.10).
Dann im Programmordner einmal `sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox` ausführen.

1. Beim ersten Start trägt Cozy Shelves keinen Ordner von selbst ein. Über dem Startmenü
   erscheint die Karte **„Willkommen in Cozy Shelves“**: Wähle dort, wie einsortiert wird, und dann mit **„Ordner mit
   Büchern wählen“** einen Ordner mit deinen Büchern (siehe *Erster Start*). **„Später“** schließt die Karte. Die
   Bücherei bleibt dann leer und aufgeräumt, und die Karte erscheint bei jedem Start wieder, solange kein Ordner
   gewählt ist. Weitere Ordner: *Einstellungen → Bücherordner*. Läuft Cozy Shelves schon, holt ein zweiter Start das
   offene Fenster nach vorn. Schließt du das Fenster, beendet sich Cozy Shelves ganz.
2. Die Bücher werden im Hintergrund einsortiert (Cover, Metadaten, ISBN). Bei etwa 750 PDFs dauert das beim
   ersten Mal einige Minuten, die Regale füllen sich währenddessen. Danach geht es sofort.
3. „Bücherei betreten“ wählen. Die Anleitung (Deutsch und Englisch) steht im Startmenü und jederzeit unter
   **Esc → Anleitung**.

Wenn Windows SmartScreen warnt („Unbekannter Herausgeber“): *Weitere Informationen → Trotzdem ausführen*.
Die App ist nicht signiert. Sie schickt keine persönlichen Daten irgendwohin. Internet wird nur für Zeitungen,
Wikipedia, Podcasts, die Mediathek, den Online-Katalog, den Lesebrowser, die Weltkarte (Wikipedia und Street View),
fehlende Cover und Buch-Metadaten (Buchkataloge und Bildersuche, siehe *Bücher & Ordner*), das Wetter „Wie draußen“
(Open-Meteo) und den einmaligen Download der Vorlese-Modelle gebraucht. Von dir gehen dabei nur Suchbegriffe hinaus,
etwa Titel, Autor und ISBN eines Buchs oder der Name eines Orts.

## Erster Start

Solange kein Bücherordner gesetzt ist (beim ersten Start und wenn alle Ordner entfernt wurden), zeigt Cozy Shelves
über dem Startmenü die Karte „Willkommen in Cozy Shelves“:

* **So wird einsortiert**: „Unterordner sind Abteilungen“ (jeder Ordner im gewählten Ordner wird eine Abteilung,
  seine Unterordner werden Regale) oder „Automatisch einsortieren“ (Cozy Shelves ordnet jedes Buch nach Titel,
  Schlagwörtern und ISBN einer Abteilung zu, etwa Romane oder Geschichte). Die Tasten `1` und `2` oder die
  Pfeiltasten wählen.
* **Ordner mit Büchern wählen** (`Enter`) öffnet die Ordnerauswahl von Windows. Danach schließt sich die Karte, ein
  kurzer Hinweis sagt, dass die Bücher eingelesen werden, und die Regale füllen sich nach und nach.
* **Später** (`Esc`) schließt die Karte. Im Bücherzimmer warten dann vier leere Regale an der linken Wand unter dem
  Schild „Deine Bücher“, mit Pflanzen, Vasen und Fotos auf den Böden. Eine Karte im ersten Regal und die Tafel im
  Durchgang sagen, wie Bücher hineinkommen. Auf der Startseite des Menüs steht „Noch kein Bücherordner gewählt“ mit
  dem Knopf „Ordner mit Büchern wählen“, der die Karte wieder öffnet.
* Unten auf der Karte schalten „Deutsch“ und „English“ die Sprache sofort um. `Tab` wandert über alle Knöpfe der
  Karte.

Einstellungen aus früheren Versionen behalten ihre Ordner. Für Tests setzt `COZYSHELVES_BOOKS` die Ordner beim ersten
Start mit einem frischen Datenordner (siehe *Entwicklung*), die Karte erscheint dann nicht.

## Steuerung

| Taste | Wirkung |
|---|---|
| `W A S D` / Pfeile, Maus | gehen und umsehen, mit `Shift` schneller. Ins Bild klicken, damit die Maus die Blickrichtung steuert. Im Sitzen stehst du mit diesen Tasten wieder auf, sobald das Hinsetzen fertig ist |
| Linksklick | benutzt, worauf du schaust: Ein Buch im Regal zeigt seine Buchinfo, ein Buch auf dem Tisch öffnet sich, ein Stuhl, Sessel, das Sofa oder eine Bank in bis zu 2,5 m Entfernung setzt dich hin, alles andere reagiert wie auf `E`. Der Klick, der die Maus erst fängt, löst nichts aus |
| `E` | benutzen: Buch in den Korb, hinsetzen (aus bis zu 2,5 m), Computer, Plattenspieler, Radio, Staffelei, Lexikon, Weltkarte (aus bis zu 6 m), Zeitungsständer, Rückgabe, Beamer (Mediathek), Lesegerät (Lesebrowser), das Hörbuchregal öffnen oder eine Box darin abspielen, Katze streicheln, Lampen aus- und einschalten, das Feuer in der Feuerschale anzünden und löschen; auf die heruntergelassene Leinwand gerichtet: Film anhalten und fortsetzen |
| `R` | Buch sofort lesen; `F` Buchinfo, ohne Buch im Blick der laufende Film im Vollbild; `B` öffnet den Korb (bis zu 12 Bücher) |
| `C` | ein Buch im Regal oder auf dem Tisch als gelesen markieren, noch einmal als ungelesen |
| **`Tab`** | **Abteilungsrad**: halten, Maus in die Richtung, loslassen, und du gehst vor das erste Regal dieser Abteilung. Kurz angetippt bleibt das Rad offen (Klick, Pfeiltasten und `Enter` oder Ziffern). „Zuletzt gelesen“ und „Gelesen“ führen zu ihren Regalen am Durchgang. In der Mitte des Rads steht „Orte“: Maus in die Mitte oder `Q`, und das Rad zeigt statt der Abteilungen alle Orte der Bücherei (Halle, Bücherzimmer, Garten), geordnet wie unter *Orte* (`G`). Loslassen über einem Ort bringt dich sofort dorthin. Noch einmal in die Mitte oder `Q` zeigt wieder die Abteilungen. Steht wegen der Größe der Bücherei nur eine Abteilung im Zimmer, wechselt das Rad sie |
| `Leertaste` | im Stehen springen, im Sitzen aufstehen. Ein Sprung trägt dich auf niedrige Möbel: Tische, Stühle, Sessel, das Sofa, die Fensterbank, das Sideboard, den Schreibtisch, die Liegestühle und die Pflanzkübel, im Winter auch vom Eis auf den Steg. Gehst du über eine Kante, fällst du hinunter. Stufen bis 20 cm nimmst du im Gehen. Auf Regale, Theken und alles über 0,9 m kommst du nicht. `G` Orte; `M` Plattenspieler; `Esc` Menü; `F11` Vollbild |
| `V` | Mediathek; `I` Lesebrowser; `H` Hörbücher; `T` oder `Strg`+`F` Volltextsuche |
| `K`, `J`, `L` | Film, Podcast oder Hörbuch anhalten und fortsetzen, zurück und vor (Film 10 Sekunden, Podcast 15 Sekunden, Hörbuch 15 Sekunden zurück und 30 Sekunden vor); es gilt, was zuletzt gestartet wurde. Die Medientasten der Tastatur tun dasselbe |
| `P`, `O`, `X` | Film, Podcast oder Hörbuch im kleinen Spieler: `P` Film auf die Leinwand und zurück zum Ton, `O` im Fenster der Mediathek (beim Podcast die Podcasts, beim Hörbuch der Player), `X` beenden |
| `Alt`+`←` / `Alt`+`→`, Maustasten 4 und 5 | in Tafeln mit eigener Navigation zurück und vor (Computer, Fernleihe, Mediathek, Zeitung, Podcasts, Lexikon, Lesebrowser, Weltkarte) |
| im Buch | `←`/`→` blättern, `B` Lesezeichen, `T` Inhalt, Notizen und Suche, `F` Suche im Buch, `Strg`+`F` Volltextsuche in allen Büchern, `V` vorlesen, `Umschalt`+`V` Stimmenmenü, `S` Darstellung (Menü Aa), `Strg`+`+`, `Strg`+`−` und `Strg`+`0` Schriftgröße (in der Seitenansicht eines PDFs der Zoom), `X` Textansicht eines PDFs, `C` Schachbrett, `D` Diagramm aufs Brett (bei offenem Schachbrett), `Alt`+`←` zurück. Markierter Text wird zur Notiz oder lässt sich im Wörterbuch, in der Übersetzung und in Wikipedia nachschlagen |

Der Punkt in der Bildmitte öffnet sich zu einem kleinen Ring, sobald du das Ding benutzen kannst. Zielst du auf ein
Buch im Regal, zieht es sich ein Stück heraus und dreht dir sein Cover zu, auch wenn du schräg davorstehst; schaust du
weg, gleitet es zurück. Die Drehung hält kurz vor dir an, so bleiben der Buchrücken und der Papierblock mit seinen
Seitenkanten zu sehen, und das Buch wirkt wie ein Buch in der Hand. Es nimmt dabei die Proportionen seines Covers an
und zeigt es ganz, nichts wird beschnitten oder verzerrt; Vorder- und Rückseite zeigen dasselbe Bild. Es zählt immer
das Fach unter dem Fadenkreuz: Wanderst du auf ein Nachbarbuch, auch auf eines hinter dem gedrehten Cover, ist sofort
dieses Buch dran, und das erste gleitet zurück. Rechts neben der Bildmitte steht das Cover frei im Bild, in seinen
eigenen Proportionen, zwei Fünftel so hoch wie das Fenster und senkrecht mittig, ohne Rahmen; sein linker Rand liegt
bei 60 % der Fensterbreite, Fadenkreuz und Buch bleiben frei. Ist „Hinweise einblenden“ an, stehen darunter auf einer
kleinen Leiste `E` In den Korb, `R` Lesen, `F` Info und `C` Als gelesen markieren. Bücher haben keine Beschriftung.
Alles andere, etwa die Katze, das Schachbrett, die Computer, eine Lampe oder ein Sessel, nennt eine kleine
Beschriftung unter dem Punkt mit dem Namen und, wenn „Hinweise einblenden“ an ist, der Taste, zum Beispiel „Katze · E
Streicheln“ oder „Stehlampe · E Licht aus“. Unten links zeigt der Korb seine Bücher, ihre Zahl und „B Korb öffnen“,
auch wenn er leer ist. Nimmst du ein Buch mit `E`, sagt ein kurzer Hinweis, dass `B` den Korb öffnet.

Wenn du dich hinsetzt (Tisch, Sessel, Sofa, Fensterbank, Bank), liegt nichts vor dir. Ist unter *Einstellungen →
Bücherordner* „Zuletzt geöffnetes Buch am Sitzplatz bereitlegen“ an, liegt das Buch bereit, das du zuletzt
geöffnet hast, auch wenn es nicht im Korb ist: `E` oder ein Klick öffnet es, `F` zeigt die Buchinfo, `R` stellt es
ins Regal zurück. Hast du am Platz gelesen, bleibt das Buch aufgeschlagen vor dir liegen.
Die Rückgabe-Theke am Eingang stellt alle Bücher zurück, und zwar in das Regal **„Zuletzt gelesen“** rechts
neben dem Durchgang. Wo du aufgehört hast, merkt sich die Bücherei auch nach einem Neustart.

## Controller

Cozy Shelves lässt sich ganz mit einem Controller bedienen: Xbox, PlayStation und jeder andere Controller, den das System
mit der Standardbelegung meldet. Er ist bereit, sobald er angeschlossen ist und eine seiner Tasten gedrückt wurde.
Solange du ihn benutzt, zeigen die Hinweise im Bild seine Tasten (bei PlayStation ✕ ○ □ △, L1, R1), sobald du Tastatur
oder Maus verwendest, wieder die Tasten der Tastatur. Die Maus muss dafür nicht gefangen sein. Ohne Controller läuft
für ihn nichts im Hintergrund.

| Taste | In der Bücherei |
|---|---|
| linker Stick | gehen, je weiter geneigt, desto schneller. Gedrückt: rennen, bis der Stick wieder ruht. Im Sitzen stehst du mit einem Schub auf |
| rechter Stick | umsehen. Gedrückt: hinsetzen (auf einen Sitz in Reichweite gerichtet), im Sitzen aufstehen |
| `A` | wie `E`: Buch in den Korb, hinsetzen, Computer, Plattenspieler, Weltkarte und alles andere benutzen |
| `B` | zurück, im Sitzen aufstehen |
| `X` | springen, im Sitzen aufstehen |
| `Y` | Korb öffnen |
| `LB`, `RB` | die zweite und dritte Taste der Buchkarte: Lesen und Info (am Tisch: Info und Ins Regal) |
| `LT`, `RT` | feiner zielen (der Blick dreht sich langsamer), heranzoomen |
| Steuerkreuz | auf ein Buch gerichtet: das Nachbarbuch links oder rechts im selben Fach, oben und unten das Fach darüber oder darunter; der Blick gleitet hin. Ohne Buch im Blick springen links und rechts im laufenden Film oder Podcast, unten führt in den kleinen Spieler (Steuerkreuz wählt, `A` drückt, `B` zurück) |
| `Start` | Menü |
| `View` | Orte. Gehalten: das Abteilungsrad, ein Stick zeigt auf die Abteilung, loslassen oder `A` geht hin, `B` bricht ab. Im Rad wechseln `LB` und `RB` zwischen Abteilungen und Orten |

In Tafeln und Menüs zeigt ein Rahmen die Auswahl. Das Steuerkreuz oder der linke Stick bewegen ihn, `A` drückt, `B`
geht zurück oder schließt, `LB` und `RB` wechseln die Reiter, der rechte Stick rollt. Schieberegler und Auswahllisten
ändern sich mit links und rechts. Ein Textfeld öffnet mit `A` eine Tastatur auf dem Bildschirm: `A` tippt, `X` löscht,
`Y` setzt ein Leerzeichen, `LT` schaltet auf Großbuchstaben, `LB` und `RB` bewegen den Cursor, `Start` ist Fertig (wie
Enter), `B` schließt sie. Der rechte Stick gedrückt zeigt einen Mauszeiger für alles, was für die Maus gemacht ist, etwa
das Schachbrett, die Staffelei, Webseiten im Lesebrowser und Street View: Der linke Stick bewegt ihn, das Steuerkreuz um
ein paar Pixel, `A` ist die linke Maustaste (gehalten: ziehen), der rechte Stick dreht das Mausrad, `B` beendet ihn.

* **Im Buch** blättern `LB` und `RB` sowie das Steuerkreuz links und rechts. `A` zeigt die Leisten oben und unten und
  setzt den Rahmen auf sie, `B` führt zur Seite zurück (eine offene Karte wie das Inhaltsverzeichnis schließt zuerst).
  `Y` liest vor, `X` setzt ein Lesezeichen oder nimmt es weg.
* **Film in der Mediathek und Podcast**: Der Rahmen steht auf dem Spieler. `A` hält an und setzt fort, links und rechts
  springen 10 Sekunden (Film) oder 15 Sekunden (Podcast), unten führt zu seinen Knöpfen. **Film im Vollbild**: `A`
  Pause, links und rechts sowie `LB` und `RB` 10 Sekunden, `Y` Untertitel, `B` zurück.
* **Weltkarte**: Der linke Stick verschiebt die Karte, `RT` und `LT` zoomen, ein Kreuz zeigt die Mitte, `A` öffnet dort
  den Steckbrief. `LB` und `RB` führen zurück und vor durch die Steckbriefe, `X` zoomt heran, `Y` zeigt die ganze Welt.
* **Computer**: In den Spielen ist das Steuerkreuz die Pfeiltasten, `A` ist Enter, `X` die Leertaste, `Y` Rückgängig.
  `LB` und `RB` erreichen die Knöpfe des Spiels (Neu, Rückgängig …).
* **Lesebrowser**: `LB` und `RB` blättern, der rechte Stick rollt, `X` schaltet den Lesemodus, `Y` liest vor.

*Einstellungen → Controller* zeigt, ob ein Controller verbunden ist und welcher, ein Bild, auf dem gedrückte Tasten
aufleuchten, und die Liste aller Tasten. Dort stellst du die Empfindlichkeit des Umsehens ein, „Y invertieren“ und die
Vibration: ein kurzes Rütteln, wenn du ein Buch nimmst, nur bei Controllern, die das können („Testen“ prüft es).

## Was wo ist

* **Halle**: Die Nordwand ist eine durchgehende Glasfront. In ihrer Mitte führen zwei Glastüren auf die
  Terrasse, links und rechts davon liegen Fensterbänke voller Kissen. In der Halle stehen der Kamin mit Sesseln
  und Sofa, an der Kaminwand die Leinwand für Filme aus der Mediathek (sie fährt erst herunter, wenn ein Film
  startet), hinter dem Sofa der Beamer (Mediathek), der Lesetisch, der Schachtisch an der Glasfront, das Radio
  (Podcasts) und die Uhr (sie zeigt die Uhrzeit deines Rechners). Bilder hängen an den Wänden und im Durchgang.
  Unter *Orte* (`G`) führen „Mitte der Halle“, „Kamin“, „Heimkino (Leinwand)“, „Glasfront“ und „Terrasse“ direkt
  dorthin. Der Ort „Mitte der Halle“ hieß bis 0.6 „Galerie“, nach den Bildern an den Wänden der Halle.
  Alle Lampen leuchten sichtbar: Die Stoffschirme glühen warm, Wandleuchten werfen Lichtfächer an die Wand, Steh-,
  Tisch- und Schreibtischlampen einen Lichtkreis auf Boden oder Tisch.
* **Lampen schalten**: Jede Lampe in Halle, Durchgang und Bücherzimmer lässt sich einzeln schalten. Schau sie an, und
  die Beschriftung unter dem Punkt nennt sie, etwa „Stehlampe · E Licht aus“. `E` oder ein Klick schaltet sie aus und
  wieder an. Licht, Lichtkreis und Schirm gehen gemeinsam aus, der Raum wird an dieser Stelle dunkler. Ausgeschaltete
  Lampen bleiben auch nach einem Neustart aus. Das Kaminfeuer brennt immer.
* **Terrasse und Garten**: Die Glastüren öffnen sich, sobald du auf sie zugehst, und schwingen immer von dir weg:
  nach außen, wenn du die Halle verlässt, nach innen, wenn du aus dem Garten kommst. Hinter dir schließen sie sich
  wieder. Draußen liegt eine Holzterrasse mit zwei Liegestühlen, Pflanzkübeln, Laternen und Lichterketten. Ein
  Kiesweg führt über den Rasen zum See und auf einen Holzsteg mit einer Bank am Ende. Am Ufer wachsen Schilf und
  Seerosen, neben dem Steg liegt ein Kiesstrand. Ein Trampelpfad führt am Ostufer entlang über die Wiese auf einen
  kleinen Hügel mit einer zweiten Bank und Blick über den See. Dichter Waldrand, Hecken, ein Holzzaun und das
  Wasser begrenzen den Garten. Auf den Bänken setzt du dich mit `E` oder einem Klick hin, die Leertaste lässt dich
  aufstehen. Der See spiegelt Himmel, Wolken, Waldrand und Steg, kräuselt sich im Wind und zeigt Ringe im Regen.
  Buchen, Eichen, Birken, Fichten, Kiefern, Sträucher, Gras und Schilf bewegen sich im Wind, die Hügel
  verschwinden in der Ferne im Dunst, bei Nebel in hellem Grau. Regen fällt in feinen Fäden schräg mit dem Wind
  und endet auf dem Boden, dem Wasser, dem Steg, der Terrasse und den Dächern, in den Räumen nie. Auf Wegen und
  Holz stehen dann Pfützen. Bei Schnee sind die Laubbäume kahl, die Nadelbäume verschneit und der See zugefroren.
  Unter *Orte* (`G`) führen „Steg am See“, „Feuerschale“, „Futterstelle“ und die Bänke direkt dorthin.
* **Der Garten in den Jahreszeiten**: Unter *Einstellungen → Licht & Wetter* steht die Zeile „Jahreszeit“: Nach
  Kalender, Frühling, Sommer, Herbst oder Winter. Nach Kalender gilt die Nordhalbkugel: März bis Mai Frühling, Juni
  bis August Sommer, September bis November Herbst, Dezember bis Februar Winter. Der Wechsel geht ohne Ruckeln, die
  Farben gleiten in wenigen Sekunden hinüber.
  * Frühling: hellgrünes Laub, die Obstbäume auf dem Rasen blühen weiß und rosa, auf der Wiese blühen weiße, gelbe,
    blaue und rosa Blumen in kleinen Inseln, die Seerosen treiben junge rötliche Blätter und Knospen, im Schilf
    stehen noch trockene Halme vom Vorjahr.
  * Sommer: sattes Grün, Mohn und Kornblumen auf der Wiese, die Seerosen blühen, nachts fliegen Glühwürmchen.
  * Herbst: Buchen kupferrot, Birken gelb, Eichen braun, die Sträucher rot, jeder Baum etwas anders. Laub liegt auf
    Rasen, Wegen, Terrasse und Steg, ab und zu segelt ein Blatt herab. Die Seerosenblätter vergilben, das Schilf
    wird golden.
  * Winter: Die Laubbäume sind kahl, Schnee liegt auf dem Boden, den Nadelbäumen, den Dächern, dem Weg, der Terrasse
    und dem Steg. Schilf und Rohrkolben stehen strohfarben. Der See ist zugefroren. Auf dem Eis liegt Schnee in
    langen Wehen und am Ufer, dazwischen milchiges Eis und dunkles, klares Eis mit feinen Rissen und eingeschlossenen
    Luftbläschen, darin spiegeln sich matt der Himmel und der Waldrand. Ein paar welke Seerosenblätter sind
    eingefroren.

  Schneefall (Wetter „Schnee“) bringt wie bisher in jeder Jahreszeit Schnee und kahle Bäume. Außerhalb des Winters
  friert der See dabei nur dünn zu und trägt nicht.
* **Schnee auf Weg, Terrasse und Steg**: Auf dem Kiesweg ist der Schnee in der Mitte festgetreten und etwas grauer.
  An den Rändern liegt er locker und höher. Wo er dünn ist, schaut der Kies durch. Auf der Terrasse liegt eine
  gleichmäßige Schicht, in der sich die Fugen der Bretter abzeichnen, dicht am Haus unter dem Vordach bleiben die
  Bretter fast frei. Auf dem Steg liegt auf jedem Brett ein Polster aus Schnee, an den Enden und Kanten dünner. In der
  Sonne glitzert der Schnee wie auf dem Rasen.
* **Spuren im Schnee**: Wo Schnee liegt, hinterlässt du Fußabdrücke, links und rechts im Wechsel und in deine
  Gehrichtung gedreht. Beim Rennen (`Shift`) werden sie länger und liegen weiter auseinander, wo du nach einem Sprung
  landest, bleibt eine aufgewühlte Stelle. Rehe und Hirsche hinterlassen Hufabdrücke, Füchse und der Wolf
  Pfotenabdrücke. Spatzen, Finken, Meisen und Amseln hüpfen und setzen ihre kleinen Abdrücke paarweise nebeneinander,
  Krähen und Dohlen schreiten und setzen sie einzeln hintereinander. Jeder Abdruck ist eine flache Mulde mit einem
  kleinen Wall aus Schnee am Rand, im schrägen Licht von Sonne oder Mond fällt ein Schatten hinein. Nach einigen
  Minuten verblassen die Spuren, nach etwa acht Minuten sind sie verweht, bei Schneefall schon nach zwei, bei Regen
  nach gut drei. Taut der Schnee, verschwinden sie sofort. Auf dem Weg, der Terrasse, dem Steg und dem Trampelpfad
  zum Hügel sind ältere Spuren von Spaziergängern zu sehen. Im Haus, unter dem Vordach und rund um die Feuerschale
  bleiben keine Abdrücke, auf dem Eis nur schwache.
* **Der zugefrorene See**: In der Jahreszeit Winter, nach Kalender also von Dezember bis Februar, trägt dich das Eis.
  Du gehst vom Ufer aufs Eis oder steigst vom Steg hinunter. Auf dem Eis rutschst du leicht. Du kommst langsamer in
  Gang, gleitest beim Anhalten ein Stück weiter und wirst in Kurven nach außen getragen, auf blankem Eis mehr als auf
  Schnee. Vom Eis aus ist der Steg zu hoch zum Hinaufgehen, mit der Leertaste springst du hinauf. Schilf, große
  Steine und die Leiter am Steg stehen im Weg. Deine Schritte klingen auf dem Eis fest und etwas hohl. Die Kois
  stehen tief unter dem Eis, Enten und Teichhuhn schweigen, am Steg plätschern keine Wellen, und die Wildtiere
  bleiben an Land. Endet der Winter, während du auf dem Eis bist, kommst du ans Ufer zurück.
* **Seerosen**: In drei Buchten des Sees schwimmen Seerosen in lockeren Gruppen: runde Blätter mit schmaler Kerbe,
  manche mit aufgebogenem rotbraunem Rand, teils übereinander. Dazwischen stehen rosa Blüten mit mehreren Kränzen
  spitzer Blütenblätter um eine gelbe Mitte, offen, halb offen oder als Knospe. Abends schließen sich die Blüten,
  morgens öffnen sie sich wieder.
* **Schilf und Rohrkolben**: Am Ufer stehen Schilfhorste mit langen, wechselständigen Blättern, die sich überneigen,
  und federigen braunen Rispen, dazwischen Rohrkolben mit braunen Kolben. Sie wiegen sich im Wind des Wetters, bei
  Sturm stärker.
* **Bäume ohne Aufploppen**: Zwischen 45 und 70 Metern gehen die Bäume gleitend in eine einfachere Form über. Beide
  Formen stammen aus demselben Baum, deshalb erscheinen beim Gehen keine Blätter mehr ruckartig.
* **Feuerschale**: Westlich des Rasens, zwischen Haus und See, steht eine geschmiedete Feuerschale auf drei Beinen,
  um sie herum vier Baumstümpfe zum Sitzen (`E` setzt dich, die Leertaste steht auf). Von der Dämmerung bis zum
  Morgen brennt das Feuer von selbst. `E` an der Schale zündet es an oder löscht es, das gilt bis zur nächsten
  Dämmerung oder zum nächsten Morgen. Flammen, Glut und Funken leuchten, ihr Licht fällt auf den Boden und die Sitze,
  bei ruhigem Wetter steigt etwas Rauch auf. Unter *Orte* (`G`) führt „Feuerschale“ dorthin.
* **Wildtiere**: Rehe mit Kitz, Hirsche, Füchse und ganz selten ein Wolf kommen aus dem Wald und ziehen über die
  Wiesen, oft mehrere Gruppen zugleich, jede an einem eigenen Platz. Rehe und Hirsche bleiben eine Weile und äsen.
  Auf „Oft“ ist bei Tag und in der Dämmerung fast immer ein Tier zu sehen, nachts seltener: Dann kommen Füchse und
  Rehe an den Waldrand. Regen und Nebel halten sie etwas zurück, ein Sturm deutlich. Du siehst sie von der Terrasse,
  durch die Glasfront und aus jedem Fenster des Bücherzimmers. Solange du im Haus bist oder im Beobachtungsstand
  sitzt, bleiben sie ruhig. Gehst du draußen auf sie zu, heben sie den Kopf und schauen dich an. Kommst du näher,
  gehen sie ein paar Schritte weg. Bleibst du eine Weile stehen, beruhigen sie sich wieder. Kommst du ihnen zu nahe,
  laufen Rehe in einem zügigen Trab davon, etwas schneller als ihr gewöhnlicher Trab und nie im Galopp, das Kitz dicht
  bei der Mutter. Ein Hirsch trabt ebenso davon, auch wenn du auf ihn zuläufst. Ein Fuchs trabt eilig weg. Sie laufen
  nur ein Stück: Rehe bleiben in etwa 16 bis 24 Metern Abstand zu dir stehen, ein Hirsch in 18 bis 26 Metern, ein
  Fuchs in 12 bis 18 Metern, an einer Stelle, an der du sie noch siehst. Dort drehen sie sich halb nach dir um und
  beobachten dich eine Weile, ein Fuchs setzt sich dabei oft hin. Dann beruhigen sie sich, fressen ein wenig, wo sie
  stehen, und ziehen an einen anderen Platz, weiter weg von dir und fort von der Stelle, an der du sie aufgeschreckt
  hast. Ihr Besuch dauert so lange wie vorgesehen, erst dann gehen sie zurück in den Wald. Gehst du nach der Flucht
  einfach weiter auf sie zu, laufen sie bald wieder. Treibst du eine Gruppe bis an den Waldrand oder scheuchst du sie
  innerhalb von fünf Minuten dreimal auf, verschwindet sie früher im Wald. Der Wolf schaut dich erst eine Weile an und
  geht dann. In der Dämmerung und nachts leuchten ihre Augen auf, wenn sie zu dir schauen. Im Schnee tragen Rehe und
  Hirsche ihr graues Winterfell, und alle Tiere hinterlassen Spuren (siehe *Spuren im Schnee*). In den Einstellungen
  wählst du unter „Häufigkeit der Wildtiere“ Selten, Normal oder Oft, mit „Wildtiere im Garten“ schaltest du sie aus.
* **Futterstelle**: Auf der Wiese östlich des Rasens steht eine Heuraufe mit Dach und Trog, daneben eine Salzlecke
  auf einem Pfahl. Rehe und Hirsche fressen dort Heu, das Kitz frisst aus dem Trog, und sie lecken am Salz. Etwa
  15 m davor steht ein kleiner Beobachtungsstand mit Bank. Setz dich mit `E` hinein und schau ihnen zu. Stehst du
  draußen bei der Futterstelle, kommen keine Rehe und Hirsche an die Raufe, im Beobachtungsstand störst du sie nicht.
  Unter *Orte* (`G`) bringt dich „Futterstelle“ direkt dorthin.
* **Vögel und Tiere am See**: Im Garten leben Vögel. Spatzen, Buchfinken, Kohl- und Blaumeisen ziehen in kleinen
  Schwärmen zwischen Sträuchern, Bäumen, Terrasse und Rasen umher, Amseln hüpfen über den Rasen und picken im Gras,
  Krähen und Dohlen schreiten über die Wiese und sitzen auf dem Dach, den Baumspitzen und den Pfählen am Steg. Bei
  schönem Wetter kreist hoch über dem Garten ein Mäusebussard, im Frühling und Sommer jagen Rauchschwalben dicht über
  Wiese und See und rasten auf den Leinen der Lichterketten. Die Vögel sitzen auf Ästen und kahlen Zweigen der
  Bäume, auf der Dachkante, dem Zaun, den Pfosten der Terrasse, den Bänken und den großen Steinen. Sie schauen sich
  um, putzen ihr Gefieder, hüpfen ein Stück den Ast entlang und fliegen auf, wenn du ihnen draußen zu nahe kommst.
  Im Flug schlagen sie mit den Flügeln: Spatzen, Finken und Meisen legen sie zwischendurch an und fliegen in Bögen,
  Amseln und Krähen gleiten ein Stück, der Bussard segelt. Zum Landen richten sie sich auf, spreizen Flügel und
  Schwanz und strecken die Füße vor. Nachts schweigen die Singvögel, in der Dämmerung streicht manchmal eine
  Schleiereule über die Wiese. Im Winter sind es weniger Vögel und keine Schwalben, bei Sturm suchen alle Schutz.

  Im See schwimmen zehn Kois in Orange, Weiß, Rotweiß, Schwarzgold und Platin dicht unter der Oberfläche. Stehst du
  auf dem Steg, kommen sie heran und sammeln sich neben dir, ein Platschen scheucht sie auseinander. Im Winter stehen
  sie tief unter dem Eis und sind nicht zu sehen. Auf den Seerosenblättern und am Ufer sitzen in der warmen Jahreszeit
  Frösche, am meisten in der Dämmerung. Kommst du ihnen nahe, springen sie ins Wasser, Ringe laufen über die
  Oberfläche, und nach einer Weile tauchen sie wieder auf. In den Einstellungen schaltet „Vögel und Tiere am See“
  Vögel, Fische und Frösche aus.
* **Eingang** (Osten): zwei Computer. Die Übersicht zeigt, was du gerade liest, mit Cover und Fortschritt, und
  für jeden Bereich den aktuellen Stand. Der Katalog hat Cover, sortiert nach jeder Spalte und filtert nach
  Status (ungelesen, angefangen, beendet, im Korb), Abteilung und Format. Dazu Ausleihe und Verlauf,
  Lesetagebuch, Statistik (Lesezeit je Tag und je Wochentag über 7, 30 oder 90 Tage, meistgelesene Bücher,
  Bestand, Leseziel des Jahres mit den gelesenen Büchern, Lesesträhne), Spiele, System, Lesebrowser und Mediathek.
  Außerdem Rückgabe-Theke, Zeitungsständer und die Kartei „Fernleihe“ (Online-Katalog).
* **Südwand**: links vom Durchgang das Lesegerät (Lesebrowser) und das Lexikon-Pult (Wikipedia), beide mit dem
  Lesebrett in derselben Höhe und Neigung, rechts die Staffelei (Aquarell) mit einer weißen Leinwand, auf der das
  zuletzt gemalte Aquarell steht, das Hörbuchregal (siehe *Hörbücher*) und das Sideboard mit dem Plattenspieler
  (Musik).
* **Bücherzimmer**: ein großer, offener Raum. An den Wänden stehen Regale aus heller Eiche mit
  allen Abteilungen, vom Eingang aus links beginnend und im Uhrzeigersinn. Jede Abteilung beginnt mit einem eigenen
  Regal unter einem Schild mit ihrem Namen, jedes Regal (Unterordner) auf einem neuen Regalboden mit einem kleinen
  Namensschild. Die Tafel im Durchgang zeigt auf einem Plan, an welcher Wand welche Abteilung steht, oben rechts im
  Bild steht die Abteilung vor dir. In den Regalen stehen nur deine echten Bücher. Unter jedem Regalboden leuchtet
  eine LED-Leiste. Wo du ein Buch von der Seite siehst, zeigt sein Deckel das Cover: am Anfang und am Ende jeder
  Reihe, neben der Buchstütze, einer Pflanze oder der Seitenwand des Regals, und neben jeder Lücke, etwa wenn ein
  Buch im Korb liegt oder gerade herausgezogen ist. Rechts vom Buchrücken liegt die Vorderseite, links die Rückseite
  mit demselben Bild. Das Bild ist wie ein Druck auf das Format des Buchs zugeschnitten, nichts wird verzerrt. Bücher
  ohne Cover zeigen dort ihre Titelkarte. Auf dem schrägen Brett vor den Regalen liegen Empfehlungen, nur Bücher mit
  echtem Cover und zuerst deine Must-Read-Bücher. Wo keine Regale gebraucht werden, hängen Bilder, und es stehen
  Leseecken mit Sessel, Lampe und Pflanze. Links vom großen Fenster hängt die Weltkarte. In der Mitte stehen ein
  Präsentationstisch mit Empfehlungen, ein Lesetisch auf einem großen Teppich und zwei Sessel vor dem Fenster.
  Rechts vom Durchgang steht das Regal „Zuletzt gelesen“, links davon das Regal „Gelesen“. Ist die Bücherei zu groß
  für die Wände (je nach Zahl der Regale etwa ab 800 Büchern), steht eine Abteilung im Zimmer, und das Rad (`Tab`)
  wechselt sie. Die Tafel im Durchgang zählt dann alle Abteilungen auf, nennt bei der Abteilung im Zimmer die Wände,
  an denen sie steht, und zeigt sie im Plan mit ihrer Nummer. Die gewählte Abteilung bleibt über einen Neustart
  erhalten. Ohne Bücher stehen an der linken Wand vier leere Regale unter dem Schild „Deine Bücher“ (siehe *Erster
  Start*).
* **Katze**: Die Bibliothekskatze schläft auf den Sesseln, dem Sofa und der Fensterbank und wechselt ab und zu
  den Platz. Dabei läuft sie um alle Möbel herum. Sie ist eine rundliche getigerte Katze mit dem „M“ auf der Stirn,
  Ringeln an Beinen und Schwanz, heller Brust, hellem Bauch und hellen Pfoten, Bernsteinaugen und Schnurrhaaren.
  Wach blinzelt sie ab und zu, im Schlaf sind die Augen geschlossen, und wenn sie sitzt, hängt ihr Bauch auf den
  Boden. Schau sie an und drücke `E` oder klicke sie an, dann streichelst du sie; sie schnurrt lauter und bleibt
  danach eine Weile liegen. In den Einstellungen lässt sie sich ausschalten.

## Himmel, Wetter und Licht

* **Tageszeit** (*Einstellungen → Licht & Wetter*): Echte Uhrzeit folgt der Uhr des Computers. Beim Tag-Nacht-Wechsel
  wechseln sich Tag und Nacht ab, unter „Dauer eines Tages“ stehen 10, 20 oder 30 Minuten, 1 oder 2 Stunden zur Wahl
  (vorgegeben: 30 Minuten). Bei Nur Tag zieht die Sonne vom Morgen bis zum Abend, nach einer kurzen Dämmerung folgt
  gleich der nächste Morgen. Bei Nur Nacht geht es von der Abenddämmerung bis zum Morgengrauen, dann beginnt die
  nächste Nacht, und die Sterne drehen sich ohne Sprung weiter. Die gewählte Dauer gilt dort für einen Tag oder eine
  Nacht (die Zeile heißt dann „Dauer einer Nacht“). Feste Uhrzeit hält eine Stunde nach Wahl, Goldene Stunde eine
  tief stehende Abendsonne.
* **Wetter** (*Einstellungen → Licht & Wetter*): Klar, Bewölkt, Regen, Gewitter oder Schnee, dazu die Schalter Nebel
  und Wind. Klar mit Nebel ist ein Morgendunst, Bewölkt mit Nebel der dichte graue Nebel, Regen mit Nebel ein
  Nieselregen, auch Schnee fällt im Nebel. Bei Wind schwanken die Bäume stärker, Regen und Schnee fallen schräg. Was
  nicht zusammenpasst, ist ausgegraut, darunter steht der Grund: Bei Gewitter gibt es keinen dichten Nebel, ein
  Gewitter bringt seinen Wind mit, Wind vertreibt den Nebel. Ältere Einstellungen bleiben erhalten, aus Nebel wird
  bewölkt mit Nebel.
* **Wechselndes Wetter** (*Wetter → Wechselnd*): Das Wetter wechselt alle 10 bis 30 Minuten von selbst, in einer
  natürlichen Folge: klar, Wolken, Regen, Aufklaren. Zuerst ziehen die Wolken auf, dann setzt der Regen ein. Die
  Schalter Regen, Gewitter, Nebel und Schnee legen fest, was kommen darf. Schnee fällt nur im Winter. Gewitter kommen
  zu jeder Tageszeit, auch bei Nur Tag und Nur Nacht. Regen und Gewitter sind dabei auch zu hören.
* **Wie draußen** (*Wetter → Wie draußen*): Das echte Wetter an einem Ort. Den Ort ins Feld schreiben, „Suchen“
  drücken und den richtigen Ort aus der Liste wählen. Das Wetter kommt von Open-Meteo (ohne Konto) und wird alle 30
  Minuten neu abgefragt, dafür braucht die App eine Internetverbindung. An den Dienst gehen nur der gesuchte
  Ortsname und die Koordinaten des gewählten Orts, ein Standort wird nicht ermittelt. Ohne Verbindung bleibt das
  zuletzt abgefragte Wetter.
* **Sternenhimmel** (nachts bei klarem Wetter): Rund 5300 Sterne stehen am Himmel, die hellen an ihren echten Orten und
  in ihren Farben von bläulich weiß bis orange, so wie auf 50° nördlicher Breite: Großer Wagen, Kassiopeia, im Winter
  Orion. Helle Sterne sind etwas größer, nahe am Horizont funkeln sie leicht. Die Milchstraße zieht als weiches Band
  mit dunklen Staubbahnen und helleren Sternwolken über den Himmel. Der Himmel dreht sich mit der Uhrzeit langsam um
  den Polarstern. In der Abenddämmerung erscheinen die Sterne nach und nach, im Morgengrauen verblassen sie. Wolken
  verdecken sie, bei bedecktem Himmel, Regen und Nebel ist keiner zu sehen. Der Mond zeigt die Phase des heutigen
  Datums, geht auf und unter und spiegelt sich im See. Am schönsten zu sehen von der Terrasse und vom Steg, auch
  durch die Glasfront und die Fenster.
* **Nachts** ist der Garten heller: Blausilbernes Licht von Himmel und Mond liegt über Rasen, Wegen und Bäumen, bei
  Vollmond kräftiger, bei Neumond schwächer, aber nie ganz dunkel. Draußen gewöhnt sich das Auge an die Dunkelheit.
  Aus den Fenstern fällt warmes Lampenlicht in den Garten, der See spiegelt den Nachthimmel. Drinnen bleibt das warme
  Licht der Lampen, und die Fenster zeigen den Garten.
* **Goldene Stunde** (*Einstellungen → Licht & Wetter → Tageszeit*): Die Sonne steht still, tief über dem See im
  Nordwesten, etwa 8° über dem Horizont. Sie wirft lange Schatten und scheint schräg durch die Glasfront und die
  Glastüren weit in die Halle. Am Horizont ist der Himmel orange und rosa, darüber zart blauviolett. Die Luft ist warm
  und leicht dunstig, helle Stellen leuchten etwas weicher. Die Lampen der Halle bleiben an und leuchten gedämpft,
  Lichterketten und Laternen im Garten glimmen sanft. Bei echter Uhrzeit und beim Tag-Nacht-Wechsel sieht das Licht um
  Sonnenaufgang und Sonnenuntergang genauso aus, und beim Tag-Nacht-Wechsel sinkt die Sonne ohne Sprung unter den
  Horizont.
* **Lichtstrahlen** (*Einstellungen → Grafik*, an): Das Sonnenlicht wird in der Luft sichtbar. In der Halle fallen
  Strahlen durch die Glasfront und die Glastüren, im Staub zeichnen sich helle Bahnen ab, und einzelne Staubkörnchen
  glitzern dort, wo die Sonne sie trifft. Draußen fällt das Licht in Bahnen durch die Baumkronen und den Waldrand, im
  Dunst und am schönsten im Nebel. Am kräftigsten sind die Strahlen bei tiefer Sonne. Bewölkung schwächt sie, bei
  Regen, Gewitter und nachts gibt es keine. Die Bäume werfen Schatten auf Rasen, Wege und Steg und durch die Glasfront
  bis in die Halle (ab Qualität „Mittel“ mit eingeschalteten Schatten). Auf „Hoch“ rechnet die App die Strahlen in
  halber Auflösung, auf „Mittel“ in einem Viertel. Auf „Niedrig“ gibt es keine, dort bleiben die einfachen Lichtbahnen
  an den Fenstern. Am schönsten zu sehen unter *Orte* (`G`): „Glasfront“, „Terrasse“ und „Steg am See“.
* **Schatten**: Die Schatten der Bäume wandern gleichmäßig mit der Sonne, ohne Sprünge.
* **Fenster**: Die Lampen spiegeln sich nur noch als schwacher, weicher Schein im Glas. Nachts zeigt das Glas ein
  leises Spiegelbild des Raums, der Blick nach draußen bleibt klar.

## Klang

Unter *Einstellungen → Klang* haben Musik, Umgebung und Effekte je eine Lautstärke. Was zu hören ist, bestimmt die
Welt. In der Gruppe „Einzelne Geräusche“ lässt sich jedes Geräusch der Welt einzeln ausschalten: Regen, Wind, Donner,
Kaminfeuer, Feuerschale, Wanduhr, Vögel (mit Waldkauz, Enten und Teichhuhn), Frösche, Grillen, Wasser am Steg und
Schritte. Anfangs sind alle an. Ein ausgeschaltetes Geräusch verstummt sofort und bleibt still, auch wenn die Welt es
bringt; wieder eingeschaltet ist es zu hören, sobald Wetter, Tageszeit und Ort es verlangen. Die Schalter aus 0.6
(Kaminknistern, Regen am Fenster, Wind, Uhrticken) werden nicht übernommen.

* **Wetter**: Regen hörst du nur, wenn es regnet: draußen voll, drinnen leiser und gedämpft, an der Glasfront und an
  den Fenstern mit Tropfen an der Scheibe, auf dem Steg mit Ringen im Wasser. Wind weht mit dem Wetter, bei Sturm
  kräftig und drinnen als dumpfes Brausen mit einem Pfeifen an den Fenstern, bei klarem Wetter rauscht nur das Laub
  draußen. Bei Gewitter folgt der Donner dem Blitz, so viel später, wie der Schall braucht (etwa drei Sekunden je
  Kilometer). Bei Schnee ist es fast still.
* **Feuer und Uhr**: Das Kaminfeuer knistert am Kamin, die Feuerschale im Garten, solange sie brennt, die Wanduhr
  tickt leise in ihrer Nähe. Alles wird mit dem Abstand leiser und hinter Wänden und Glas gedämpft.
* **Im Garten** singen am Tag Amsel, Rotkehlchen, Kohlmeise, Buchfink, Zilpzalp, Zaunkönig, Ringeltaube, Spatzen und
  Krähen, im Frühling auch der Kuckuck, um Sonnenaufgang der Morgenchor. Im Frühling und Frühsommer singen die
  meisten, im Winter wenige, bei Sturm keiner. Nachts ruft der Waldkauz. In der Dämmerung und in warmen Nächten quaken
  Frösche am See, im Winter keine. In Sommernächten zirpen Grillen, auf dem See rufen ab und zu Enten oder ein
  Teichhuhn, am Steg plätschern Wellen. Ist der See zugefroren, schweigen Enten und Teichhuhn, und am Steg plätschern
  keine Wellen.
* **Schritte**: Deine Schritte klingen nach dem Boden: Parkett und Holz, Stein und Fliesen je nach gewähltem
  Fußboden, Teppich fast lautlos, Terrasse, die hohlen Bohlen des Stegs, Kies, Kiesstrand, Rasen, Pfad, Schnee, auf
  dem zugefrorenen See Eis, im Regen Pfützen. Alle Schritte sind ein weiches, gedämpftes Auftreten, draußen raschelt der Boden leise.
  Das Tempo folgt der Geschwindigkeit. Die Glastüren schwingen lautlos.

„Hintergrundmusik pausieren“ (an) hält die Musik des Plattenspielers an, solange ein Film, ein Podcast oder ein
Hörbuch läuft. Mehr dazu unter *Mediathek*.

## Bücher & Ordner

* Formate: PDF, EPUB, MOBI/AZW/AZW3/PRC, FB2, CBZ, TXT, Markdown, HTML, DOCX, RTF.
* **Vorsortierter Ordner** („Unterordner sind Abteilungen“, z. B. `Bücher`): Jeder Ordner der obersten Ebene wird zu einer eigenen
  **Abteilung**, seine Unterordner zu **Regalen** darin (bei tieferen Ebenen gibt der Ordner, in dem das Buch
  liegt, das Regal vor). Führende Nummern wie `06 ` bestimmen nur die Reihenfolge. Bücher direkt im
  Abteilungsordner stehen am Anfang der Abteilung ohne eigenes Regalschild. Ordner wie „Sonstiges“ oder „Gehört
  nicht hierher“ kommen ans Ende, Dateien direkt im Bücherordner zu „Verschiedenes“.
* **Automatischer Ordner** („Automatisch einsortieren“, z. B. `Neue Bücher`): alles, was du hineinkopierst, wird anhand von Titel,
  Metadaten, Schlagwörtern und im Hintergrund per ISBN-Abfrage (Open Library, Google Books) in feste Abteilungen
  einsortiert (Romane, Krimi & Thriller, Geschichte …). Sie stehen im Bücherzimmer nach deinen Ordner-Abteilungen.
* **Must-Read**: Eine Verknüpfung in einem Bücherordner, etwa im Ordner `00 Must-Read`, macht das Buch, auf das sie
  zeigt, zum Must-Read: unter Windows eine Verknüpfung (`.lnk`), unter Linux ein symbolischer Link. Must-Read-Bücher mit Cover liegen bevorzugt auf dem Brett vor ihrem Regal
  und auf dem Präsentationstisch. Verknüpfungen sind keine Bücher, ein Ordner nur mit Verknüpfungen wird keine
  Abteilung.
* Keine Bücher sind Ordner, deren Name mit `$` oder `.` beginnt, die Begleitordner gespeicherter Webseiten
  (`Seite_files`, `Seite-Dateien`), Office-Sperrdateien (`~$…`) und Notizen, deren Name mit `_` beginnt (`.txt`,
  `.md`).
* Abteilung ändern: `F` am Buch oder am Computer → *Abteilung ändern*. Zur Wahl stehen die Abteilungen deiner
  Bücherei und ihre Regale. Die Wahl bleibt, auch wenn die Datei in ihrem Ordner liegen bleibt.
* Neue Dateien werden automatisch erkannt (Ordnerüberwachung). Umbenannte oder verschobene Bücher behalten
  Lesestand, Lesezeichen und Notizen.
* **Cover**: eingebettete Cover bzw. Seite 1 bei PDFs. Ist Seite 1 kein Cover (leer, nur eine Farbe, nur Text wie
  eine Titelseite oder ein gescanntes Blatt mit Bibliotheksstempel) oder hat das Buch keins, zeigt es eine schlichte
  Titelkarte in seiner Einbandfarbe und bekommt im Hintergrund ein Cover aus dem Internet. Neue Cover erscheinen
  sofort im Regal, an den Seiten der Bücher, auf der Karte rechts und im Katalog.
* **Cover und Metadaten aus dem Internet**: Bücher ohne echtes Cover bekommen eines aus dem Internet. Zuerst fragt der
  Cozy Shelves die Buchkataloge Open Library, Goodreads, Apple Books, die Deutsche Nationalbibliothek, das Internet Archive
  und Google Books (nur mit eigenem Schlüssel). Für Ausgaben mit ISBN kommt Amazons Bild dazu, eine ASIN im Dateinamen
  gilt wie eine ISBN. Jeder Katalog hat ein eigenes kleines Budget, und jedes Buch fragt den Katalog, der gerade frei
  ist: Ein Lauf nutzt so alle Kataloge zugleich. Ein Eintrag zählt nur, wenn er wirklich das Buch ist (ISBN, oder Titel
  und Autor passen, in der Sprache des Buchs und beim richtigen Band). Lieber kein Cover als ein falsches. Kennt kein
  Katalog das Buch, fragt Cozy Shelves die Bildersuche von Bing, Yandex und DuckDuckGo (strenger Jugendschutzfilter),
  jede mit eigenem kleinem Budget und mit Pause bei jedem Anzeichen einer Drosselung. Das Bild, das die meisten
  Treffer zeigen, wird zum Cover. Bilder kommen aus dem Bildspeicher der Suchmaschine oder über den Bildproxy von
  DuckDuckGo, die Websites dahinter sehen deine Adresse nicht. Gesendet werden nur Titel, Autor, ISBN oder ASIN, und
  nur für Bücher (PDF ab 24 Seiten, EPUB, MOBI, AZW3, FB2, CBZ), nie für Notizen oder Dokumente. Bücher ohne Treffer
  kommen nach einer Woche wieder dran, danach in wachsenden Abständen.
* **Alle Cover jetzt laden** (*Einstellungen → Bücherordner*) fragt sechs Bücher zugleich, mit Fortschritt, Pause,
  Fortsetzen und Abbrechen. Nach einem Neustart geht der Lauf weiter. 850 Bücher brauchen etwa zehn Minuten, wenn die
  Kataloge die meisten kennen. Bücher, die nur die Bildersuche findet, kommen mit etwa zehn in der Minute dazu.
* **Anderes Cover** (Buchinfo): „Cover von …“ nennt den Katalog oder die Website (sie öffnet sich im Lesebrowser).
  „Anderes Cover“ zeigt die Bilder aller Kataloge, auf Wunsch die der Bildersuche („Im Web suchen“), dazu „Eigenes
  Bild wählen“, „Generiertes Titelbild“ und „Cover aus dem Buch“. Die Wahl bleibt, keine Suche ersetzt sie.
* **Metadaten**: Mit „Metadaten aus dem Internet ergänzen“ (an) füllen die Kataloge aus, was ein Buch nicht selbst
  nennt: Autor, Jahr, Verlag, ISBN, Sprache, Reihe und Band. Was die Datei oder du selbst angibst, bleibt. Der
  Cozy Shelves merkt sich, woher jeder Wert stammt.
* **Schlüssel für Google Books** (*Einstellungen → Bücherordner*): freiwillig, ein kostenloser API-Schlüssel aus der
  Google Cloud Console. Ohne Schlüssel antwortet Google Books zurzeit nicht.
* Unter *Einstellungen → Bücherordner* stehen dazu „Fehlende Cover aus dem Internet laden“ (an), „Bildersuche mit“
  Bing, Yandex und DuckDuckGo (je ein Schalter, alle an) und „Metadaten aus dem Internet ergänzen“ (an).
* **Doppelte Bücher**: Cozy Shelves erkennt, wenn dasselbe Buch mehrfach vorliegt: dieselbe Datei in zwei Ordnern,
  dieselbe ISBN oder derselbe Titel und Autor, auch wenn Zusätze von Download-Seiten in Dateinamen (etwa
  „(example.org)“ oder die Teile nach „ -- “ mit Autor, Jahr, Verlag und Prüfsumme), Auflagenvermerke wie „2. Auflage“,
  Umlaute oder Satzzeichen abweichen. Zwei Bände einer Reihe sind nie dasselbe
  Buch, zwei Ausgaben aus verschiedenen Jahren nur bei gleicher Datei oder gleicher ISBN. Ins Regal kommt von jedem
  Buch die Ausgabe, in der du liest, sonst das EPUB vor dem PDF („Doppelte Bücher nur einmal ins Regal stellen“, an).
  Die Liste „Doppelte Bücher“ (*Einstellungen → Bücherordner* oder am Computer unter *System*) zeigt jede Gruppe mit
  Format, Größe und Ordner jeder Datei und einem Knopf „Im Explorer zeigen“. Die Buchinfo nennt unter „Auch vorhanden
  als“ die anderen Ausgaben. Gelöscht wird nichts.
* **Sortierung im Regal** (*Einstellungen → Bücherordner*): „Bücher im Regal sortieren nach“ Titel (Standard), Autor
  (Nachname), Erscheinungsjahr, Verlag, Reihe, Zuletzt hinzugefügt oder Zuletzt gelesen. Die Abteilungen und ihre
  Regale bleiben, wo sie sind, nur die Bücher in jedem Regal ordnen sich neu, ohne dass die Welt neu aufgebaut wird.
  Bei „Reihe“ stehen die Bände jeder Reihe in ihrer Reihenfolge, danach die übrigen Bücher nach Titel. Die Reihe kommt
  aus den Metadaten (bei EPUB die Reihe von Calibre oder EPUB 3) oder aus dem Titel: „Band 3“, „Bd. 3“, „Vol. 2“,
  „Teil 1“, „Teil II“, „#4“, „(Reihe Nr. 5)“, „Zweiter Band“. Auch nach Autor und nach Verlag stehen die Bände einer
  Reihe in ihrer Reihenfolge. „Zuletzt hinzugefügt“ richtet sich nach dem Tag, an dem die Datei in den Ordner kam.
* **Sprache eines Buchs**: Sie steht als zweistelliger Code in der Bibliothek (de, en, fr …). Unbrauchbare Angaben aus
  den Metadaten eines PDFs werden beim Einlesen und beim Start verworfen, die Sprache wird dann aus dem Text
  geschätzt. „eng“, „DE-DE“ oder „German“ werden zu „en“ und „de“.

## Lesen

* **Schrift und Seitenbreite**: Das Menü Aa (`S`) zeigt jede Schrift in ihrer eigenen Gestalt: EB Garamond, Literata,
  Source Serif, Palatino, Atkinson Hyperlegible Next und Segoe UI. Literata, Source Serif und Atkinson liegen der App
  bei und laden ohne Internet. Die Schriftgröße reicht von 10 bis 48 Pixel und ändert sich über den Schieber, die
  Knöpfe − und + oder mit `Strg`+`+` und `Strg`+`−`, `Strg`+`0` stellt 19 Pixel wieder her. In der Seitenansicht
  eines PDFs ändern dieselben Tasten den Zoom. Die Seitenbreite legt fest, wie viele Zeichen eine Zeile fasst, von 45
  bis 110. Beim Ziehen folgt die Seite sofort. Passen zwei Spalten dieser Breite ins Fenster, steht das Buch als
  Doppelseite da. Die Ränder schmal, normal und breit aus 0.6 werden zu 90, 68 und 54 Zeichen. Schrift, Größe und
  Breite gelten für alle Bücher.
* **Textansicht für PDFs**: Ein PDF mit Textebene lässt sich als Fließtext lesen, mit Schrift, Schriftgröße,
  Seitenbreite, Zeilenabstand und Seitenfarbe wie ein E-Book. Der Schalter steht im Menü Aa, die Taste ist `X`. Die
  ersten drei Male bietet ein Hinweis die Textansicht an. Die App setzt den Text aus den Zeilen des PDFs neu: Absätze
  laufen über Zeilen und Seiten weiter, Trennstriche am Zeilenende verschwinden, die Silbentrennung passt sich der
  neuen Zeilenlänge an. Überschriften, fette und kursive Wörter, Listen und Fußnoten bleiben erhalten, Kopfzeilen und
  Seitenzahlen fallen weg. Bilder, Grafiken und Schachdiagramme stehen als Bild an ihrer Stelle, das
  Diagramm-Werkzeug (`D`) liest sie auch dort. Gescannte Seiten und Seiten mit unlesbarer Textebene erscheinen als
  Bild der Seite. Seitenangabe, Fortschritt, Lesezeichen, „Zuletzt gelesen“, Suche und Vorlesen zählen in PDF-Seiten,
  `X` führt zurück zur selben Seite des Originals. Die App merkt sich je Buch, ob es in der Textansicht gelesen wird.
  Markierungen gehören zu der Ansicht, in der sie gesetzt wurden, aus der Liste führt ein Klick zu ihrer Seite.
* **Seitenfarbe**: Das Menü Aa stellt sie ein, Weiß, Papier, Sepia oder Nacht. Sie gilt für alle Formate, auch für
  PDF- und Comicseiten. Papier und Sepia färben das Papier warm, die Schrift bleibt dunkel. Nacht macht PDF-Seiten
  dunkel mit heller Schrift; Bilder und Schachdiagramme behalten ihre Farben und werden nur etwas gedämpft,
  Comicseiten werden abgedunkelt. Solange keine Seitenfarbe gewählt ist, folgen die Seiten dem Erscheinungsbild
  (Hell: Papier, Sepia: Sepia, Dunkel: Nacht). Der Schalter „Wie das Erscheinungsbild“ stellt das wieder her. Eine
  vor 0.6 gewählte Seitenfarbe wird beim ersten Start einmal zurückgesetzt, damit die Seiten dem Erscheinungsbild
  folgen.

## Volltextsuche

Die Volltextsuche findet Wörter im Text aller Bücher. `T` öffnet sie in der Bücherei, ebenso `Strg`+`F` und im Menü
„Volltextsuche“. Im Buch öffnet sie `Strg`+`F` oder die Lupe oben rechts, `F` allein sucht weiter nur im offenen Buch.

* Den Text liest Cozy Shelves im Hintergrund, ein Buch nach dem anderen, in einem unsichtbaren Fenster mit niedriger
  Priorität. Beim ersten Mal dauert das eine Weile, gesucht werden kann sofort in den Büchern, die schon gelesen
  sind. Oben in der Tafel steht, wie weit der Index ist, etwa „312 von 850 Büchern durchsucht, 14 ohne Text“. Das
  Lesen pausiert, solange du ein Buch liest, dir etwas vorlesen lässt, einen Film schaust oder die Welt Bilder
  verliert, und geht nach einem Neustart an derselben Seite weiter. Neue und geänderte Bücher kommen von selbst
  dazu, gelöschte verschwinden aus dem Index, verschobene behalten ihn.
* Alle Wörter müssen auf derselben Seite stehen. Groß- und Kleinschreibung zählt nicht, Umlaute dürfen ausgeschrieben
  sein (Müller findet Mueller), Plural und einfache Endungen werden mitgefunden (Bücher findet Buch, books findet
  book). Wörter in Anführungszeichen stehen genau so im Buch, `Schach*` findet Wörter, die so beginnen.
* Die Treffer stehen nach Büchern geordnet, die Bücher mit den meisten Treffern zuerst, mit Cover, Titel, Autor,
  Abteilung und der Zahl der Treffer. Jeder Treffer nennt die Seite (bei PDFs die Seitenzahl, bei E-Books mit
  Seitenliste die Seite der Druckausgabe, sonst die Position wie unten im Leser und das Kapitel) und zeigt die
  Textstelle mit den markierten Wörtern. Filter für Abteilung und Sprache grenzen die Suche ein, die Ergebnisse
  erscheinen beim Tippen.
* Ein Klick oder `Enter` öffnet das Buch an dieser Seite, die Wörter sind dort markiert. Oben im Leser führt
  „‹ Suche“ zurück zu den Treffern, ebenso `Esc`, das ✕ daneben entfernt die Markierungen. Schaust du nur nach, bleibt
  deine Lesestelle, wo sie war. Blätterst du von dort weiter, merkt sich Cozy Shelves die neue Stelle.
* Gescannte Bücher ohne Textebene lassen sich nicht durchsuchen, sie zählen als „ohne Text“. Der Katalog der Computer
  sucht im Modus „Volltext“ ebenfalls im Index.
* *Einstellungen → Bücherordner*: „Volltextsuche“ an oder aus, wie weit der Index ist, seine Größe und „Index neu
  aufbauen“. Ausgeschaltet lässt sich der Index löschen. Er liegt im Ordner `fulltext` des Datenordners, für 745 Bücher
  mit 216.000 Textseiten belegt er rund 300 MB.

## Vorlesen

* **Deutsch**: Piper/VITS-Stimmen laufen direkt in der App (ONNX, kein Python), darunter **Thorsten-Voice**
  (low, medium, high und die emotionalen Varianten), Karlsson, Pavoque, Kerstin, Ramona, Eva und „Martin“
  (Kokoro). Alle sprechen mit den Lauten, auf denen sie trainiert wurden (espeak-ng wie in Piper). Voreingestellt
  ist für neue Nutzer „Martin“, die natürlichste und am besten verständliche Stimme. Martin und „Thorsten (hoch)“
  rechnen auf der Grafikkarte (WebGPU), die übrigen Stimmen auf dem Prozessor. Ohne passende Grafikkarte ist
  Martin langsamer als Echtzeit, dann klingt Pavoque am besten. Vor dem ersten Vorlesen fragt die App, ob sie die
  Stimme (20 bis 311 MB) einmalig von Hugging Face laden soll, danach arbeitet sie ohne Internet. Die Sätze folgen
  ohne Lücken mit gleich langen Pausen, alle Stimmen sind gleich laut. Zahlen, Daten, Uhrzeiten, Geldbeträge,
  Einheiten und gängige Abkürzungen werden ausgeschrieben, Trennungen am Zeilenende eines PDFs zusammengefügt.
  Auswahl: *Einstellungen → Vorlesen*.
* **Englisch**: Kokoro läuft ebenfalls direkt in der App, das Modell wird einmalig geladen. Vor dem ersten englischen
  Vorlesen fragt die App, ob sie das englische Modell laden soll (88 MB, mit WebGPU 311 MB).
* **Sprache je Absatz**: Jeder Absatz wird in der Sprache vorgelesen, in der er geschrieben ist. Die Sprachangabe des
  Buchs zählt nur, wenn der Text nichts Eindeutiges sagt, danach die Sprache der App, zuletzt Deutsch. Ein englisches
  Zitat in einem deutschen Buch liest die englische Stimme, sobald das englische Modell auf dem Rechner ist.
* **PDF-Text**: Die Seiten werden aus den Positionen ihres Textes zusammengesetzt. Wörter am Zeilenende bekommen ihr
  Leerzeichen, getrennte Wörter werden zusammengefügt, zwei Spalten werden nacheinander gelesen, Kopfzeilen und
  Seitenzahlen bleiben stumm. Hat eine Seite keinen lesbaren Text (ein Scan ohne Texterkennung, eine Schrift mit
  kaputter Zeichenzuordnung, ein Diagramm in einer Schachschrift), erscheint „Diese Seite hat keinen lesbaren Text“,
  und das Vorlesen geht auf der nächsten Seite weiter. Nach acht solchen Seiten hintereinander endet es.
* **Schachnotation** wird in Worten gesprochen: „1. e4“ als „eins, e vier“, „Sf6“ als „Springer f sechs“, „Lxe5+“ als
  „Läufer schlägt e fünf, Schach“, „0-0“ als „kurze Rochade“, „e8=D“ als „e acht, wird Dame“, „1-0“ als „Weiß
  gewinnt“. Figurinen (♘f3) und die englischen Buchstaben von Figurinenschriften (Nf3) gehen ebenso. Zeichen wie „!“
  oder „?“ hinter einem Zug bleiben stumm.
* **Stimme am Vorlese-Symbol**: Der Pfeil neben 🔈 im Reader, ein Rechtsklick auf 🔈 oder `Umschalt`+`V` öffnet ein
  Menü mit den deutschen und den englischen Stimmen (vorhanden, zum Laden mit Größe, wird geladen), dem Tempo und dem
  Schalter „Sprache automatisch“. Ist er aus, liest das Buch nur auf Deutsch oder nur auf Englisch, die Wahl gilt für
  dieses Buch. Eine gewählte Stimme spricht ab dem nächsten Satz und gilt wie in den Einstellungen. Eine Stimme, die
  noch fehlt, wird erst geladen, bis dahin liest die bisherige weiter. Im Lesebrowser öffnet der Stimmenknopf der
  Vorleseleiste dasselbe Menü, ebenso `Umschalt`+`V`, in Zeitung und Lexikon der Pfeil neben „Vorlesen“.
* **Alle Stimmen herunterladen** (*Einstellungen → Vorlesen*) lädt jede deutsche Stimme und das englische Modell
  nacheinander, mit der Gesamtgröße, einem Balken für alles und einem je Stimme. Vorhandene Stimmen werden
  übersprungen. „Abbrechen“ behält das Geladene, „Download fortsetzen“ macht dort weiter. Eine Stimme, die nicht
  geladen werden konnte, steht mit „Erneut versuchen“ in der Liste. Der Download läuft weiter, wenn die Einstellungen
  geschlossen werden.
* Auch Zeitungsartikel und Wikipedia-Seiten lassen sich vorlesen. Während vorgelesen wird, spielt die Musik leiser.
  Film, Podcast und Hörbuch halten dabei an. Startet ein Film, ein Podcast oder ein Hörbuch, pausiert das Vorlesen
  und lässt sich danach fortsetzen.

## Hörbücher

Unter *Einstellungen → Hörbücher* fügst du einen oder mehrere Ordner mit Hörbüchern hinzu („Hörbuchordner
hinzufügen“). Cozy Shelves liest sie im Hintergrund ein und erkennt neue Dateien von selbst.

* **Ordner und Dateien**: Jeder Ordner mit Audiodateien ist ein Hörbuch, seine Dateien stehen in natürlicher
  Reihenfolge („Teil 2“ vor „Teil 10“, „10“ nach „9“). Unterordner wie `CD1`, `CD2`, `Disc 3` oder `Teil 4` gehören
  zum Hörbuch darüber. Eine einzelne M4B-Datei oder eine Datei mit eigenen Kapiteln ist ein Hörbuch für sich, auch
  wenn mehrere davon in einem Ordner liegen. Nummerierte Unterordner („Reihe/01 Band eins/…“) werden zu einer Reihe.
  Formate: MP3, M4A, M4B, AAC, OGG, OPUS, FLAC und WAV.
* **Angaben**: Titel, Autor, Sprecher, Reihe, Jahr und Kapitel kommen aus den Tags der Dateien, sonst aus den Ordner-
  und Dateinamen („Autor - Titel“). Das Cover ist das Bild in den Dateien oder ein Bild im Ordner wie `cover.jpg` oder
  `folder.jpg`. Ohne Kapitel ist jede Datei ein Kapitel. Eingelesen werden nur die Tags, nie der Ton. Was sich nicht
  geändert hat, liest Cozy Shelves beim nächsten Start nicht noch einmal.
* **Die Tafel Hörbücher** (Taste `H`, im Menü oder am Hörbuchregal): oben „Weiterhören“ mit den angefangenen
  Hörbüchern, darunter alle Hörbücher mit Cover, Autor und Fortschritt, mit Suche und Sortierung (zuletzt gehört,
  Titel und Reihe, Autor, neu hinzugefügt). Ein Klick öffnet den Player: Cover, Titel, Autor, Sprecher, Reihe, ein
  Regler über das ganze Hörbuch und einer über das Kapitel, 15 Sekunden zurück, 30 Sekunden vor, voriges und nächstes
  Kapitel, Geschwindigkeit von 0,75 bis 2,5, Schlaftimer und die Kapitel (ein Klick springt dorthin). Tasten:
  `Leertaste` Pause und Weiter, `←` 15 Sekunden zurück, `→` 30 Sekunden vor, `Esc` zurück zur Liste.
* **Schlaftimer**: 15, 30, 45 oder 60 Minuten Hörzeit oder bis zum Ende des Kapitels. In den letzten 20 Sekunden wird
  es leiser, dann hält das Hörbuch an.
* **Lesestand**: Für jedes Hörbuch merkt sich Cozy Shelves die Stelle und die Geschwindigkeit, alle paar Sekunden und
  bei jeder Pause, auch über einen Neustart hinweg. Beim Weiterhören beginnt es ein paar Sekunden früher, nach einer
  kurzen Pause 3 Sekunden, nach einer langen bis zu 15 Sekunden.
* **Unterwegs hören**: Ein Hörbuch läuft weiter, während du durch die Bücherei gehst oder andere Tafeln offen hast.
  Der kleine Spieler unten rechts zeigt Cover, Titel, Autor und Kapitel. `K` hält an und setzt fort, `J` springt 15
  Sekunden zurück, `L` 30 Sekunden vor, `O` öffnet den Player, `X` beendet das Hörbuch. Die Medientasten der Tastatur
  wirken ebenso, „vorheriger“ und „nächster Titel“ springen zum vorigen und nächsten Kapitel. Es läuft immer nur
  eines: Ein Hörbuch hält einen Film oder Podcast an und umgekehrt, die Hintergrundmusik pausiert dabei.
* **Das Hörbuchregal**: An der Südwand der Halle steht zwischen Staffelei und Plattenspieler ein Regal für
  Hörbuch-Boxen, auch bevor es einen Hörbuchordner gibt. Dann sind seine Fächer leer, die Beschriftung sagt
  „Hörbücher · E Öffnen“, und `E` oder ein Klick öffnet die Tafel „Hörbücher“ mit „Hörbuchordner hinzufügen“. Mit
  dem ersten Ordner füllt es sich mit Boxen, die zuletzt gehörten und die neuesten vorn. Schaust du eine Box an,
  kippt sie dir entgegen, und rechts erscheint ihr Cover. `E` oder ein Klick spielt das Hörbuch ab oder hält es an,
  `F` öffnet seine Seite in der Tafel. Bei mehr als 24 Hörbüchern liegt im letzten Fach die Karte „Alle Hörbücher“,
  sie öffnet wie das Regal selbst die Tafel. Entfernst du den letzten Hörbuchordner, bleibt das Regal leer stehen.
  Unter *Orte* (`G`) führt „Hörbücher“ direkt davor.

## Fernleihe, Lesebrowser, Mediathek & Spiele

* Die **Fernleihe** durchsucht arXiv, Open Library, OAPEN/DOAB, Internet Archive, Projekt Gutenberg (DE/EN),
  Standard Ebooks, Wikisource, Wikibooks, Zeno.org, LibriVox und beliebige Webseiten. Jeder Treffer hat einen
  **„Jetzt lesen“-Knopf**; Bücher ohne Volltext werden dafür kurz geladen.
* Der eingebaute **Lesebrowser** (`I`, nach dem Vorbild von [einkbro](https://github.com/plateaukao/einkbro))
  hat einen Lesemodus mit ruhiger Typografie, Lesezeichen, Verlauf und „als Buch speichern“. Links in
  Zeitungsartikeln, Podcasts, Wikipedia-Seiten und der Fernleihe öffnen sich dort. Links in Büchern öffnen die
  Seite in der Leseansicht, `Alt`+`←` führt zurück. Den Systembrowser öffnet die App nur auf ausdrücklichen
  Wunsch (Knopf ↗).
* Die **Mediathek** (`V`) zeigt Filme und Sendungen von ARD, ZDF, arte, 3sat und weiteren Sendern, dazu Filme und
  Nachrichtensender auf Englisch. Du kannst sie ansehen, nur anhören, herunterladen oder auf der Leinwand an der
  Kaminwand zeigen.
* Die **Zeitung** am Zeitungsständer zeigt Zeitungen und Magazine mit ganzen Artikeln in der Sprache der Oberfläche,
  mit Englisch nur englische, mit Deutsch nur deutsche. „Auch Zeitungen in anderen Sprachen“ unten in der
  Seitenleiste der Zeitung oder unter *Einstellungen → Allgemein* zeigt alle. Ein Wechsel der Sprache gilt sofort,
  auch für die Titelseiten am Zeitungsständer in der Halle.
* Am **Radio** hörst du Podcasts. Ein laufender Podcast erscheint im kleinen Spieler unten rechts mit Cover, Folge
  und Sendung. Dort hältst du ihn an, springst 15 Sekunden zurück oder vor, öffnest die Podcasts oder beendest
  ihn. In der Bibliothek geht das auch mit `K`, `J` und `L`, `O` öffnet die Podcasts und `X` beendet die Folge.
  Die Medientasten der Tastatur und das Medien-Overlay von Windows wirken ebenso.
* **Zurück und Vor**: Im Computer, in der Fernleihe, der Mediathek, der Zeitung, bei den Podcasts, im Lexikon, im
  Lesebrowser und auf der Weltkarte führen die zwei Pfeile oben links, `Alt`+`←` und `Alt`+`→` sowie die Seitentasten der Maus durch
  die bisherigen Schritte. Am Computer ist jeder Bereich, jede Buchansicht, jeder Filter, jede Sortierung, jedes
  Spiel und der Zeitraum der Statistik ein Schritt. `Esc` führt dort eine Ebene nach oben, die Rücktaste einen
  Schritt zurück.
* Am **Schachtisch** spielst du gegen Stockfish (die Stärke gilt ab dem nächsten Zug), löst Taktikaufgaben aus
  einer mitgelieferten Sammlung von 232 geprüften Stellungen oder spielst Züge aus Schachbüchern nach. An den
  **Computern** gibt es Schach, Go, Mühle, Dame, Reversi, Mastermind, Sudoku, 2048, Minensuche, Schlange,
  Blöcke, Solitär, Memory und Lichess (Rätsel, Live-Partien, Studien).
* **Diagramm aufs Brett**: Ist im Buch das Schachbrett offen (`C`), schneidet die Taste `D` oder der Knopf
  „Diagramm“ eine Stellung aus dem Buch aus, wie mit dem Snipping Tool: Die Seite wird abgedunkelt, du ziehst einen
  Rahmen um das Diagramm, `Esc` bricht ab. Cozy Shelves liest die Stellung ohne Internet und stellt sie auf das
  Brett. Er kennt die üblichen Buchdiagramme: schraffierte, graue oder gepunktete dunkle Felder, Rahmen und
  Koordinaten am Rand, Pfeile und Linien über dem Brett (sie zählen nicht als Figuren, auch nicht, wenn sie durch eine
  Figur laufen), klassische Diagrammschriften auch klein, unscharf, eingescannt oder auf getönten Seiten. Die Figuren
  erkennt ein kleines neuronales Netz, das an Tausenden erzeugter Diagramme mit vielen Figurensätzen geübt hat.
  Danach muss die Stellung zu den Regeln passen: ein König je Seite, höchstens acht Bauern und keiner auf der ersten
  oder letzten Reihe, umgewandelte Figuren nur für fehlende Bauern. Gleiche Zeichen im Diagramm sind dieselbe Figur.
  Eine bekannte Eröffnungsstellung gewinnt gegen dieselbe Stellung mit einer verschobenen Figur, wenn nur unsichere
  Felder dagegen sprechen. Die Prozentzahl auf der Karte ist die Wahrscheinlichkeit, dass alle 64 Felder stimmen,
  gemessen an Hunderten erzeugter Buchdiagramme. Unsichere Felder sind gelb. Ein Klick auf ein Feld öffnet die
  Auswahl der Figuren. Eine Korrektur ändert gleiche Zeichen im selben Diagramm mit, sonst bleibt alles stehen.
  Korrekturen merkt sich Cozy Shelves für das Buch, die nächsten Diagramme desselben Buchs gelingen dadurch besser.
  Weiß oder Schwarz am Zug kommt aus der Bildunterschrift, sonst Weiß; „Von Schwarz aus“ dreht ein gedrehtes
  Diagramm. Rochaderechte ergeben sich aus der Stellung. Die Karte und die Zugeingabe sprechen die Sprache der App,
  auch wenn sie bei offener Karte umgestellt wird. Das Beispiel im Eingabefeld zeigt die Züge in den Buchstaben
  dieser Sprache.

## Weltkarte

An der Rückwand des Bücherzimmers hängt eine große Weltkarte. Schau sie an, auch aus ein paar Schritten Abstand
(bis 6 m), und drücke `E` oder klicke. Ruht das Fadenkreuz auf einem Land, öffnet die Tafel gleich mit dessen
Steckbrief, sonst mit der ganzen Welt. Unter *Orte* (`G`) bringt dich „Weltkarte“ direkt davor. Ein kurzer Hinweis
sagt beim Öffnen, was sich anklicken lässt.

In der Übersicht, von der ganzen Welt bis zu einem Land, ist die Karte ein ruhiger Atlas: Länder in sanften Farben, Seen
und große Flüsse, dazu die Namen von Ländern, Hauptstädten, Städten und Meeren in der Sprache der Oberfläche. Es
stehen nur so viele Namen da, wie Platz haben, wichtige zuerst, und keiner überdeckt einen anderen. Unten wählst du
die Ansicht: *Länder* (die politische Karte), *Kontinente*, *Bevölkerung* (Einwohner je km² in sechs Stufen) oder
*Wohlstand* (Wirtschaftsleistung je Einwohner in US-Dollar), jeweils mit Legende; die Wahl bleibt beim nächsten
Öffnen. Zoomst du weiter in eine Region, geht der Atlas in die Karte von OpenStreetMap über, mit Orten, Straßen und
Landschaft bis zu einzelnen Häusern, farblich gedämpft. Über Ländern und Städten wird der Zeiger zur Hand, das Land
wird umrandet, ein sehr kleines Land bekommt einen Ring, und der Tooltip nennt Hauptstadt und Einwohner (in den
Ansichten Bevölkerung und Wohlstand den Wert des Landes, bei einer Stadt Land und Einwohner). Ein Klick knapp neben die Küste eines Inselstaats wählt ihn, in kleinen Ländern öffnet nur der Punkt
selbst die Hauptstadt. Die Pfeile ‹ › oben links, `Alt`+`←`/`→` und die Maustasten 4 und 5 führen zurück und vor
durch die geöffneten Steckbriefe, in Street View durch dessen Seiten.
Ziehen verschiebt die Karte, das Mausrad, die Knöpfe unten rechts und die Tasten `+` und `−` vergrößern und
verkleinern, die Pfeiltasten verschieben, `0` zeigt die ganze Welt, `/` springt in die Suche, `Enter` zoomt zum
gewählten Land oder zur gewählten Stadt. Ein Klick auf ein Land öffnet seinen Steckbrief mit Flagge, Hauptstadt,
Kontinent und Region, Einwohnern, Fläche, Bevölkerungsdichte, Bruttoinlandsprodukt gesamt und pro Kopf,
Einkommensgruppe, Amtssprachen, Währung, Nachbarländern und den größten Städten. Hauptstädte und große Städte lassen
sich schon in der Weltansicht anklicken, kleinere beim Heranzoomen. Ein Klick auf eine Stadt zeigt Land, Region,
Einwohner, Koordinaten und Ortszeit. Nachbarländer, Hauptstädte und Städte im Steckbrief lassen sich anklicken. Die
Suche findet Länder und Städte auf Deutsch und Englisch, auch ohne Akzente und Umlaute (Sao Paulo, Muenchen). Mit
Internetverbindung zeigt der Steckbrief den Anfang des Wikipedia-Artikels, „Im Lexikon lesen“ öffnet den ganzen
Artikel. „Street View“ und „Heranzoomen“ stehen oben im Steckbrief direkt unter dem Namen. Street View zeigt Google
Street View an der Stadt (beim Land an der Hauptstadt) mit Umschaltern für Karte und Satellit. Gibt es dort keine
Aufnahmen, erscheint nach einigen Sekunden die Karte der Umgebung. Beim ersten Aufruf fragt Google nach Cookies, die
Wahl gilt danach auch im Lesebrowser. `Esc` schließt nacheinander Street View, den Steckbrief und die Karte. Hinter
der Tafel steht die Welt still, dort liegt ein Standbild von ihr.

Der Atlas und die Steckbriefe gehören zum Programm und gehen auch ohne Internet (Natural Earth, gemeinfrei,
Staatsgrenzen in deutscher Sichtweise; Sprachen, Währungen, Flächen und Einwohner der Städte aus Wikidata; erneuert
mit `node build/worldmap-data.js <Ordner>`). Die Detailkarte kommt von den Kachelservern von OpenStreetMap. Cozy Shelves
lädt nur die Kacheln des sichtbaren Ausschnitts und meldet sich dabei als Cozy Shelves, wie es die Nutzungsrichtlinie
der Server verlangt. Daten über dich oder deine Bücher gehen nicht mit. Ohne Verbindung sagt ein kleiner Hinweis oben,
dass nur die Übersicht zu sehen ist, mit „Erneut versuchen“. Kartendaten © OpenStreetMap-Mitwirkende (ODbL), der
Vermerk steht unten links in der Karte. Im Erscheinungsbild Dunkel hat der Atlas eigene dunkle Farben.

## Mediathek

Die Mediathek (Taste `V`) zeigt die Sendungen der öffentlich-rechtlichen Sender: Das Erste und die
Landesrundfunkanstalten (BR, hr, MDR, NDR, Radio Bremen, rbb, SR, SWR, WDR), ZDF, ZDFinfo, ZDFneo, ZDFtivi,
arte, 3sat, phoenix, KiKA, tagesschau24, ONE, ARD alpha, funk, DW, ORF und SRF. Die Angaben zu den Sendungen
kommen von MediathekViewWeb (Projekt MediathekView), die Filme selbst von den Servern der Sender.

**Englischsprachige Mediatheken**: Neben den deutschen Sendern zeigt die Mediathek Filme auf Englisch: DW (Deutsche
Welle), NHK WORLD-JAPAN, arte auf Englisch, die NASA Image and Video Library, gemeinfreie Filme aus dem Internet
Archive (Prelinger Archives, Spielfilme, Stummfilme, Film noir, Science-Fiction und Horror, Komödien,
Fernsehklassiker, Zeichentrick) und TED-Vorträge. Mit Englisch als Sprache stehen die englischsprachigen Quellen auf
der Startseite, unter Sender, im Live-TV und in der Suche zuerst, die deutschen Sender folgen darunter. Mit Deutsch
ist es umgekehrt. In der Suche wechselt ein Schalter zwischen „Deutsche Sender“ und „Englischsprachig“. Jede Quelle
hat eine eigene Seite mit den neuesten Filmen und ihren Themen: bei NHK die Kategorien, bei der NASA Themen wie
Artemis oder Mars, beim Internet Archive die Sammlungen. Alle Filme lassen sich ansehen, anhören, auf der Leinwand
zeigen, merken, weiterschauen und herunterladen. NASA-Aufnahmen und die Filme aus dem Internet Archive sind
gemeinfrei, die TED-Vorträge stehen unter CC BY-NC-ND 4.0. TED veröffentlicht seit Mai 2025 keine neuen Vorträge
mehr als Video-Podcast, die rund 150 Vorträge daraus bleiben abrufbar.

* **Start** zeigt die neuesten Sendungen, tagesschau, heute journal, je eine Reihe für Das Erste, ZDF, arte,
  3sat und phoenix sowie Terra X, arte Dokumentationen, Tatort, Spielfilme, Kinder, Kultur, Wissen und
  Dokumentationen. Angefangene Filme stehen oben unter **Weiterschauen**.
* **Suche** mit Senderauswahl, Länge und Sortierung. Wie bei MediathekViewWeb grenzt `!arte` auf einen Sender
  ein, `#Tatort` auf eine Sendung und `>60` auf Filme ab 60 Minuten.
* **Sender** führt zu jedem Sender, zu seinen neuen Folgen nach Sendungen geordnet und zu allen Sendungen von
  A bis Z.
* **Live-TV** bietet 32 Programme live: 28 deutsche mit der Sendung, die gerade läuft, und vier englischsprachige
  Nachrichtensender. Die Liste der deutschen Streams stammt aus der App Zapp und wird beim Öffnen mit deren aktueller
  Liste abgeglichen. Live laufen auf Englisch DW English, FRANCE 24 English, Al Jazeera English und NHK WORLD-JAPAN,
  jeweils über die Adresse, die der Sender selbst veröffentlicht oder sein eigener Player abspielt. Antwortet ein
  Sender unter dieser Adresse nicht, zeigt der Player, dass er gerade nicht erreichbar ist. FRANCE 24 English lehnt
  den Abruf seiner Adresse zurzeit ab.
* **Merkliste**, **Weiterschauen** und **Downloads** sammeln gemerkte, angefangene und gespeicherte Filme.

Ein Film lässt sich auf vier Arten nutzen:

* **Ansehen** im Fenster, mit Auflösung (siehe unten), Untertiteln und Vollbild im Fenster.
  Tasten: `Leertaste` oder `K` Pause, `J` und `L` 10 Sekunden zurück und vor, `←` und `→` 5 Sekunden,
  `F` Vollbild, `M` Ton aus, `Q` Qualität. `Esc` schließt erst das Vollbild, dann die Ansicht des Films.
* **Auf der Leinwand zeigen**: An der Kaminwand fährt die Leinwand herunter, der Beamer geht an und das Licht
  in der Halle wird gedimmt. Du bleibst dabei, wo du bist. Außerhalb der Halle sagt ein kurzer Hinweis, wo der
  Film läuft. Vom Sofa aus schaust du direkt auf die Leinwand. Die Leinwand färbt den Raum in der Farbe des Bildes.
  Richtest du den Blick auf die Leinwand, hält `E` den Film an und setzt ihn fort. Je weiter du dich entfernst,
  desto leiser wird der Ton, im Bücherzimmer ist er noch leise zu hören. Endet der Film, rollt die Leinwand
  wieder ein. Läuft ein Film auf der Leinwand, ruckelt das Herumlaufen in der Halle nicht. Die Farbe des Lichts,
  das die Leinwand in den Raum wirft, misst Cozy Shelves, ohne dass das Bild darauf wartet: Die Grafikkarte
  verkleinert das Filmbild auf 16 × 9 Punkte, ein eigener Worker liest nur diese. Bis 0.6 kopierte Cozy Shelves
  dafür fünfmal in der Sekunde das ganze Filmbild von der Grafikkarte, mit einem 1080p-Film im Mittel 18 ms und bis
  über 200 ms lang.
* **Anhören**: Der Ton läuft weiter, auch wenn die Mediathek geschlossen ist. Der kleine Spieler unten rechts
  zeigt, was läuft, und an jeder Schaltfläche ihre Taste, denn in der Bibliothek steuert die Maus den Blick: `K`
  Pause, `J` und `L` 10 Sekunden, `P` auf die Leinwand und zurück zum Ton, `F` Vollbild, `O` im Fenster, `X`
  beenden, `V` Mediathek. Wer die Mediathek während eines Films schließt, hört ihn auf dieselbe Weise weiter.
* **Herunterladen**: Alle Auflösungen eines Films stehen mit ihrer Dateigröße zur Wahl, vorgewählt ist die
  nächstgelegene zur bevorzugten Qualität, bei Automatisch die größte. Die Filme landen in
  `Videos\Cozy Shelves Mediathek` (ein Ordner `Cozystacks Mediathek` oder `Lesesaal Mediathek` bleibt in Gebrauch); der
  Ordner lässt sich unter *Downloads* ändern. Abgebrochene Downloads lassen
  sich fortsetzen, auch nach einem Neustart. Filme, die die Sender als HLS anbieten (SRF, ORF), werden als eine
  `.ts`-Datei mit einer passenden Playlist gespeichert, Untertitel als `.vtt`. Heruntergeladene Filme laufen
  ohne Internet.

Einen Film auf der Leinwand oder im Hörmodus zeigt `F` (solange kein Buch im Blick ist) oder „Vollbild“ im
kleinen Spieler bildschirmfüllend, im Sitzen wie im Stehen und mit Untertiteln. `Esc` oder `F` führen zurück,
der Film läuft weiter. Im Vollbild hält `K` oder die `Leertaste` an, `J` und `L` springen 10 Sekunden, `←` und
`→` 5 Sekunden.

*Einstellungen → Mediathek → Bevorzugte Qualität* legt fest, mit welcher Auflösung ein Film startet: Automatisch,
1080p, 720p, 480p oder 360p. Jeder Film spielt die Auflösung, die der gewählten am nächsten liegt. Automatisch spielt
die größte Auflösung, die zur Fenstergröße passt, und geht eine Stufe niedriger, wenn das Bild stockt. Live-TV passt
sich bei Automatisch der Leitung selbst an. Im Player zeigt die Qualitätstaste die Auflösung, die gerade läuft (etwa
„Auto · 720p“), und listet alle Auflösungen des Films, die größte zuerst. `Q` öffnet die Liste, die Pfeiltasten und
`Enter` wählen. Der Film läuft an derselben Stelle weiter. Die Auflösungen liest Cozy Shelves aus den Adressen der
Sender, aus dem Kopf der Videodatei oder aus der Playlist und merkt sie sich. Als Ton lädt ein Film die kleinste
Auflösung. Eine Einstellung aus älteren Versionen wird übernommen: Hoch wird 1080p, Mittel 480p, Niedrig 360p.

Es läuft immer nur eine Wiedergabe. Startet ein Film, halten ein laufender Podcast und ein Hörbuch an, startet ein
Podcast oder ein Hörbuch, hält der Film an. Alle bleiben geladen und gehen später an derselben Stelle weiter.
Solange ein Film, ein Podcast oder ein Hörbuch läuft, pausiert die Musik des Plattenspielers. Zweieinhalb Sekunden
nach dem Ende oder einer Pause spielt sie weiter, eigene Musikdateien an derselben Stelle. Eine Platte, die du
währenddessen auflegst, spielt trotzdem. „Hintergrundmusik pausieren“ unter *Einstellungen → Klang* oder
*Mediathek* schaltet das ab, dann wird die Musik nur leiser. Beim Vorlesen wird sie weiterhin nur leiser.

Manche Sendungen dürfen die Sender nur in Deutschland, Österreich oder der Schweiz zeigen (Geoblocking). Läuft
ein Film nicht, nennt die Mediathek den Grund, etwa Geoblocking oder eine Sendung, die nicht mehr in der
Mediathek ist. Die Sender bieten ihre Filme nur für eine begrenzte Zeit an.

Zur Mediathek gehören die Tests `node electron/mediathek/test-mediathek.js` (ohne Netz, mit Fixtures, auch für die
englischsprachigen Quellen), `node build/screenshot.js mediathek-check` (mit echten Daten, Wiedergabe, Leinwand und
Downloads, stumm) und `node build/screenshot.js medien-check` (englischsprachige Quellen, Auflösungen, Zeitungen nach
Sprache, Netz nötig).

## Lesebrowser

Der Lesebrowser ist nach dem Vorbild von [EinkBro](https://github.com/plateaukao/einkbro) gebaut, dem Browser für
E-Book-Reader aus F-Droid. Du öffnest ihn mit der Taste `I`, am Lesegerät an der Südwand der Halle, über das Menü
und die Computer. Außerdem öffnen ihn die Fernleihe und Links in Büchern und Artikeln.

* **Blättern**: Leertaste, Bild ab und Bild auf, die Pfeiltasten links und rechts und die Leisten am Rand blättern
  eine Bildschirmseite weiter. Zwei Zeilen der vorigen Seite bleiben stehen, eine gestrichelte Linie zeigt, wo sie
  endete. Die Statuszeile zeigt „Seite 3 von 12“.
* **Lesemodus** (Taste R): Der Artikel wird mit Mozilla Readability aus der geladenen Seite gelöst und wie in einem
  E-Reader in Seiten gesetzt, in breiten Fenstern zweispaltig. Einstellbar sind Schrift, Schriftgröße, Zeilenabstand,
  Textbreite, Ränder, Spalten, Blocksatz, Silbentrennung, fette Schrift, Tiefschwarz und Bilder. Die Farbschemata
  Papier, Sepia, E-Ink (schwarz auf weiß, ohne Animationen) und Nacht gelten auf Wunsch auch für Webseiten.
* **Vorlesen** (Taste V) mit den Stimmen der App. Der gesprochene Satz ist markiert, die Seite blättert mit. Fehlt
  noch eine deutsche Stimme, bietet die Leiste an, sie einmalig zu laden. Der Stimmenknopf der Vorleseleiste und
  Umschalt+V öffnen das Stimmenmenü (siehe *Vorlesen*).
* **Tabs** mit Übersicht und Startseite (Suche, Leseliste, Lesezeichen, Verlauf, zuletzt geschlossene Tabs). Links,
  die ein neues Fenster verlangen, öffnen einen Tab. Der Systembrowser öffnet sich nur über den Menüpunkt
  „Im Systembrowser öffnen“.
* **Sammlung**: Lesezeichen mit Ordnern, Leseliste („Später lesen“) mit Lesefortschritt, Verlauf mit Suche.
* **Schutz und Schalter**: Werbe- und Trackerblocker mit Ausnahmen je Website, JavaScript an oder aus (auch je
  Website), Bilder, Cookie-Hinweise ausblenden, Nur Text, Mobilansicht. Tracking-Parameter wie `utm_source` werden
  aus den Adressen entfernt.
* **Seite behalten**: als Buch (EPUB mit Bildern) im Ordner `Online-Katalog/Webseite als Buch`, als neues Kapitel
  eines Sammelbands in `Online-Katalog/Sammelbände` oder als PDF (die Seite oder der Lesemodus). Bietet eine Seite
  ein PDF oder EPUB zum Herunterladen an, legt „Ins Regal legen“ die Datei in die Bibliothek.
* **Übersetzen** mit Google Übersetzer, nur auf Anforderung. Das Menü führt zurück zum Original.
* **Karten**: Google Maps, Google Earth und OpenStreetMap laufen als Kartenanwendung. Tasten, Mausrad und
  Darstellung gehören der Seite, Blätterleisten, Seitenzähler und Lesemodus entfallen, und „Bilder aus“ und „Nur
  Text“ lassen die Kartenbilder durch. Webseiten dürfen in den Vollbildmodus wechseln, etwa ein Film oder Street
  View.
* **Tasten**: Strg+T neuer Tab, Strg+W Tab schließen, Strg+Umschalt+T wieder öffnen, Strg+Tab nächster Tab,
  Strg+L Adresse, Strg+D Lesezeichen, Strg+F Suchen, Strg+H Verlauf, Strg+S als Buch speichern, Strg+P PDF,
  Strg+Plus und Strg+Minus Zoom (im Lesemodus die Schriftgröße), Alt+Pfeil links und rechts zurück und vor.
  Esc schließt zuerst Menüs und Leisten, danach den Lesebrowser.

Lesezeichen, Leseliste, Verlauf und die offenen Tabs liegen in `browser-data.json` im Datenordner, die Einstellungen
in `settings.json` unter `browser`. Test gegen echte Websites:
`node build/screenshot.js browser-check` (mit `COZYSHELVES_BOOKS`, `COZYSHELVES_USERDATA` und `SHOT_DIR`; einzelne
Abschnitte über `BR_ONLY=reader,tabs,…`).

## Einstellungen

**Erscheinungsbild**: Hell, Sepia oder Dunkel für alle Tafeln, Menüs und Anzeigen, unter *Einstellungen →
Allgemein* oder am Computer unter *System*. Sepia ist ein warmer Papierton und der Standard, Dunkel ein ruhiges
Anthrazit mit Petrol. Die Wahl gilt sofort und beim nächsten Start vom ersten Bild an. Im Lesebrowser folgen
Leisten und Startseite dem Erscheinungsbild, Papier und Sepia färben nur die Leseseite, E-Ink und Nacht den ganzen
Browser.

**Wandgestaltung** (*Einstellungen → Allgemein*): Die Wände über der Vertäfelung in Halle, Durchgang und
Bücherzimmer sind weiß, creme, salbeigrün, taubenblau oder terrakotta, oder sie tragen ein Graffiti. Das Graffiti
malt die App selbst: Schriftzüge wie LESESAAL und BÜCHER in runden oder spitzen Buchstaben mit Farbverlauf, Umriss,
Glanzlichtern und 3D-Schatten, dazu die Bibliothekskatze, eine Eule auf Büchern, ein Bücherwurm und ein fliegendes
Buch, kleine Schriftzüge in Chrom, Sterne, Pfeile, Farbspritzer und Farbe, die vom Gesims läuft. Türen, Fenster,
Bilder, Lampen und der Kamin bleiben frei, Bilder, Schilder und Lampen hängen sichtbar davor. „Neu sprühen“ malt eine
andere Variante mit eigenen Farben, Wörtern und Figuren. Ist die Oberfläche auf Englisch gestellt, sprüht die App
englische Wörter wie LIBRARY, BOOKS und STORYTIME. Wechselst du die Sprache, entsteht das Bild im Hintergrund neu,
und das alte bleibt so lange an der Wand. Die Wahl gilt sofort und bleibt nach einem Neustart erhalten.

**Fußboden** (*Einstellungen → Allgemein*, gleich nach der Wandgestaltung): Halle, Durchgang und Bücherzimmer
bekommen einen von zehn Böden: Eichendielen (Standard), Fischgrätparkett, dunkles Nussholz, heller Ahorn, ein
Schachbrett aus Marmor, Terrakottafliesen, Natursteinplatten, Terrazzo, Teppichboden oder bunte Zementfliesen, die
gut zum Graffiti passen. Jede Wahl zeigt ein kleines Bild ihres Bodens. Die App malt die Böden selbst, mit Fugen,
Maserung, Glanz und Struktur im Licht, und versetzt jede Reihe von Dielen oder Platten, damit sich kein Muster
sichtbar wiederholt. Die Teppiche liegen obenauf, die Terrasse bleibt aus Holz. Ein neuer Boden entsteht in ein bis
zwei Sekunden im Hintergrund, bis dahin bleibt der alte liegen. Die Wahl bleibt nach einem Neustart erhalten.

**Auflösung**: Der Regler wirkt jetzt auch, wenn Bloom, Umgebungsverdeckung oder Lichtstrahlen an sind. Bis 0.5
rechneten diese Effekte immer mit einem Pixel je Bildschirmpunkt. Ein Wert über 1 aus einer früheren Version wird
deshalb beim ersten Start einmal auf 1 gesetzt, damit die Bildrate gleich bleibt. Höher gestellt kostet er
entsprechend mehr Rechenzeit (1,4 etwa die doppelte Pixelzahl).

**Grafikqualität**: Auf „Hoch“ mit Kantenglättung und Umgebungsverdeckung, die Ecken und Regalböden plastischer
macht. Die Grafikstufe schaltet keine Lampe aus: Auf „Niedrig“ werfen die großen Pendelleuchten und das Kaminfeuer
echtes Licht, auf „Mittel“ auch Steh- und Tischlampen, auf „Hoch“ zusätzlich die Leselampen. Kleinere Lampen ohne
echtes Licht werfen dann einen kräftigeren Lichtkreis, Wandleuchten und Regal-LEDs leuchten auf jeder Stufe. Auf
mittlerer Stufe zeichnet der Garten halb so viel Gras, auf niedriger keines, das Laub hat dort harte Ränder.

**Alle Einstellungen** (`Esc` → Einstellungen):

* *Allgemein*: Erscheinungsbild, Wandgestaltung, Fußboden, Sprache (Deutsch, English), „Auch Zeitungen in anderen
  Sprachen“ (aus), Hinweise einblenden, Bibliothekskatze, Wildtiere im Garten, „Häufigkeit der Wildtiere“ (Selten,
  Normal, Oft; vorgegeben: Oft), „Vögel und Tiere am See“, Vollbild, Bilder an den Wänden (generierte Aquarelle,
  eigener Bilderordner, keine).
* *Grafik*: Qualität, Schatten, Bloom, Lichtstrahlen, Renderauflösung, Helligkeit, Lichtwärme, Blickfeld,
  Mausempfindlichkeit.
* *Licht & Wetter*: Helligkeit und Lichtwärme, Tageszeit (Echte Uhrzeit, Tag-Nacht-Wechsel, Nur Tag, Nur Nacht,
  Feste Uhrzeit, Goldene Stunde) mit der Dauer eines Tages oder der Uhrzeit, Wetter (Klar, Bewölkt, Regen, Gewitter,
  Schnee, dazu Nebel und Wind, oder Wechselnd und Wie draußen), Jahreszeit (Nach Kalender, Frühling, Sommer, Herbst,
  Winter).
* *Klang*: Musik, Umgebung und Effekte; „Einzelne Geräusche“ (Regen, Wind, Donner, Kaminfeuer, Feuerschale, Wanduhr,
  Vögel, Frösche, Grillen, Wasser am Steg, Schritte, alle an); unter „Musik“ „Hintergrundmusik pausieren“ (an) und
  Plattenspieler und eigene Musik.
* *Mediathek*: „Bevorzugte Qualität“ (Automatisch, 1080p, 720p, 480p, 360p) und „Hintergrundmusik pausieren“.
* *Vorlesen*: deutsche Stimme (bei Thorsten emotional mit Stimmung), englische Stimme, Sprechtempo, „Alle Stimmen
  herunterladen“.
* *Bücherordner*: die Ordner; Cover und Metadaten („Fehlende Cover aus dem Internet laden“, „Bildersuche mit“,
  „Metadaten aus dem Internet ergänzen“, „Schlüssel für Google Books“, „Alle Cover jetzt laden“); Regale (Sortierung,
  Regal „Gelesen“, Leseziel pro Jahr, doppelte Bücher nur einmal, Liste „Doppelte Bücher“); Volltextsuche (an, Index
  neu aufbauen); „Zuletzt geöffnetes Buch am Sitzplatz bereitlegen“ (aus).
* *Hörbücher*: Hörbuchordner hinzufügen und entfernen, neu einlesen.
* *Controller*: Verbindung, Empfindlichkeit, „Y invertieren“, Vibration mit „Testen“, ein Bild des Controllers und
  die Liste aller Tasten.

Eigene Musik: am Plattenspieler einen Ordner mit MP3, OGG, WAV, FLAC, M4A oder OPUS wählen.

Daten (Einstellungen, Lesestände, Notizen, Cover-Cache, Zeitungs-Cache, Vorlese-Modelle) liegen im Datenordner,
unter Windows `%APPDATA%\Cozy Shelves\`, unter Linux `~/.config/Cozy Shelves/`. Wer Cozystacks (0.8.0 bis 0.9.2) oder
Lesesaal (bis 0.7.2) benutzt hat, behält dessen Ordner `%APPDATA%\Cozystacks\` oder `%APPDATA%\Lesesaal\`. Dort liegen auch die Cover aus dem Internet mit ihrer Herkunft und dem Stand von „Alle Cover
jetzt laden“ in `web-covers.json`, das ersetzte Cover aus dem Buch als `covers\<id>.book.jpg`, die Hörbücher mit
ihrem Lesestand in `audiobooks.json`, ihre Tags in `audiobook-tags.json` und ihre Cover in `audiobook-covers\`, der
Index der Volltextsuche in `fulltext\`, die Auflösungen der Mediathek in `mediathek\heights.json` und in
`logs\gpu.log` jedes Ende des Grafikprozesses mit Zeit, Grund und Version, `logs\renderer.log` Fehler der Oberfläche.
Löschen = Werkseinstellungen.

## Browser-Version

Cozy Shelves läuft auch als schlanke Webseite: `npm run build:web` schreibt nach `dist/web/` eine statische Seite, die jeder
einfache Webserver ausliefern kann (auch `http://localhost`, das zählt als sicherer Kontext). Die Seite liest einen
Bücherordner, den du im Browser wählst, und merkt sich Einstellungen, Lesepositionen, Lesezeichen, Notizen, Cover und
die Bilder der Staffelei in der IndexedDB des Browsers. Deine Bücher bleiben auf deinem Rechner, die Seite liest sie nur.

* **Browser**: Edge, Chrome, Opera und andere Chromium-Browser merken sich den Ordner und fragen nach einem Neustart
  einmal nach der Erlaubnis. Firefox und Safari lesen den Ordner über den Dateidialog und brauchen ihn nach jedem Neustart
  erneut (die Bücher behalten ihre Positionen). WebGL 2 wird vorausgesetzt.
* **Im Browser dabei**: die ganze Welt (Halle, Bücherzimmer, Garten, Tiere, Wetter, Jahreszeiten), die Regale aus deinen
  Ordnern, Cover aus den Büchern, der Reader mit Lesezeichen und Notizen, Schachbücher und Stockfish, der Computer mit
  allen Spielen und Lichess, die Weltkarte mit Wikipedia, Lexikon und Wörterbuch, Staffelei und Galerie, der
  Plattenspieler, Vorlesen mit der Sprachausgabe des Browsers.
* **Nicht im Browser**: Zeitungen und Podcasts, die Fernleihe, Mediathek und Leinwand, Lesebrowser und Street View,
  Hörbücher, der Volltextindex (`T` öffnet den Katalog des Computers, dessen Volltext-Modus die ersten Seiten der Bücher
  durchsucht), Cover und Metadaten aus dem Internet, Word- und RTF-Dateien, eigene Musik- und Bilderordner, die lokalen
  Stimmen (Martin, Thorsten, Kokoro). Diese Einträge sind ausgeblendet oder sagen „Nur in der Desktop-App“.
* **Bauen und hosten**: `npm run build:web`, dann `dist/web/` auf den Server kopieren (etwa 23 MB, davon 7 MB Stockfish
  und 5 MB die EPUB- und PDF-Engines, beide werden erst bei Gebrauch geladen). Nur relative Adressen, keine Serverlogik.
  Zum Anschauen auf diesem Rechner: `npx http-server dist/web -p 8099` und `http://localhost:8099/` öffnen.
* **Prüfung**: `npm run test:web` liefert `dist/web` aus und steuert die Seite im installierten Microsoft Edge, unsichtbar
  und stumm (`WEB_BOOKS=<Testbücherei>`, `WEB_INPUT=1` für den Weg von Firefox über den Dateidialog, `SHOT_DIR`,
  `WEB_PROFILE`).

## Android-App

Cozy Shelves gibt es auch als Android-App, gebaut auf der Browser-Version: `android/` enthält ein kleines Kotlin-Projekt,
dessen einziger Bildschirm ein WebView ist. Er zeigt die Webseite aus den Assets der App und liefert ihr die Bücher aus
einem Ordner, den du einmal wählst. Was die Browser-Version kann, kann auch das Handy; der Touchscreen bekommt eigene
Bedienelemente.

* **Installieren**: `cozy-shelves-<Version>-release.apk` von der Release-Seite laden, die Installation aus dieser Quelle
  einmal erlauben, öffnen. Android 8.0 (API 26) oder neuer, ein Handy oder Tablet mit OpenGL ES 3.0. Die App verlangt
  außer dem Internet (Wikipedia, Wörterbuch, Wetter, Lichess) keine Berechtigung.
* **Der Bücherordner**: Beim ersten Start öffnet die Willkommenskarte die Ordnerauswahl des Systems; wähle den Ordner
  mit deinen Büchern (seine Unterordner werden Abteilungen und Regale wie auf dem Desktop). Android behält die
  Erlaubnis, der Ordner wird bei jedem Start ohne neue Wahl gelesen; wer den Ordner in den Einstellungen entfernt, gibt
  sie zurück. Die Bücher verlassen das Handy nie: nichts wird kopiert, nichts verschickt.
* **Steuerung**: Der Stick unten links geht (weit nach außen gedrückt läuft er; die Läuferfigur darüber hält das
  Laufen fest), Ziehen auf der rechten Hälfte sieht sich um, die große Hand benutzt, worauf das Fadenkreuz liegt, die
  Knöpfe daneben lesen, öffnen die Infokarte und springen, Menü und Abteilungsrad sitzen oben links, der Korb-Chip
  öffnet den Korb. Die Zurück-Taste des Handys schließt die offene Tafel, verlässt den Reader, öffnet in der Welt das
  Menü und verlässt die App auf dem Startmenü. Im Reader blättert ein Tipp auf den Seitenrand oder ein Wischen; dort
  darf sich das Handy drehen, die Welt bleibt quer.
* **Was anders ist**: Es fehlt dasselbe wie in der Browser-Version (Zeitungen, Podcasts, Fernleihe, Mediathek,
  Hörbücher, Volltextindex, Cover aus dem Internet, Word- und RTF-Dateien, die lokalen Stimmen; Vorlesen nutzt die
  Stimmen von Android). Die Grafik startet auf der niedrigen Stufe mit 30 Bildern pro Sekunde und verringerter
  Renderauflösung, und die App senkt die Auflösung von selbst weiter, wenn das Handy nicht nachkommt; die eigene Wahl
  in den Einstellungen gilt immer. Auf einem Handy ist die Seite etwas verkleinert, damit die Tafeln auf den Bildschirm
  passen.
* **Bauen**: `npm run build:android` baut die Webseite, kopiert sie nach `android/app/src/main/assets/web` und baut
  Debug- und Release-APK nach `dist/android/` (JDK 17 und ein Android-SDK mit Plattform 35; der Gradle-Wrapper holt
  Gradle selbst). Das Release-APK wird signiert, sobald ein Schlüssel eingerichtet ist: `node build/android-keystore.js`
  legt einen außerhalb des Repositories an (`.android-signing/`, von git ignoriert), und `android/app/build.gradle.kts`
  liest ihn von dort, aus `COZYSHELVES_SIGNING` oder `-Pcozyshelves.signing`, oder aus den Variablen `COZYSHELVES_KEYSTORE_*`
  (CI). Jede Version muss mit demselben Schlüssel signiert sein, sonst lehnt Android das Update ab.
* **Prüfung**: `npm run test:android` installiert das Debug-APK auf einem unsichtbaren Emulator (`ANDROID_SERIAL`,
  Vorgabe `emulator-5600`; `ANDROID_START=1` startet `Medium_Phone_API_35` selbst), schiebt eine Testbücherei hinüber und
  prüft Start, Ordner über die Brücke, Regale, Bild, Touch-Steuerung, Reader, Zurück-Taste, Home und zurück, Drehung,
  erzwungenen Stopp und das Release-APK (`ANDROID_BOOKS`, `SHOT_DIR`).

Stand des Android-Strangs und die Brücke zwischen App und Seite: `docs/strands/android.md` und `docs/CONTRACTS.md`; der
ursprüngliche Plan: `docs/strands/android-plan.md`.

## Entwicklung / Quellcode

```
npm install            # holt Electron, three.js, Bibliotheken
npm run build          # kopiert Vendor-Dateien (inkl. vendor-src/foliate-js), bündelt den Renderer (esbuild)
npx electron .         # startet die App (COZYSHELVES_BOOKS=<Ordner>[|structured|auto][;…] für Testordner)
npm run dist:win       # portable Windows-Version nach dist/
npm run dist:linux     # Linux-Pakete nach dist/: .deb und portables .tar.gz (baut auch unter Windows)
npm run build:web      # die Browser-Version als statische Seite nach dist/web/ (siehe oben)
```

Auf GitHub baut `.github/workflows/linux.yml` die Linux-Pakete auf Ubuntu und prüft sie mit `build/ci/linux-test.sh`:
das installierte `.deb` mit der Sandbox von Chromium, einige Prüfungen unter Xvfb mit Software-Grafik, den
Datenordner nach einem Update von Cozystacks oder Lesesaal und das portable Archiv. Der Lauf startet nur von Hand
(`gh workflow run linux.yml -f release=<Tag>`), weil er rund eine halbe Stunde der freien Actions-Minuten braucht.

Tests & Screenshots (die Electron-Läufe sind stumm und öffnen ihr Fenster außerhalb des Bildschirms, ohne
Taskleisten-Eintrag; `SHOW_WINDOW=1` zeigt es. Sie rendern auf der Grafikkarte, `SWIFTSHADER=1` in Software). Jeder
Lauf braucht einen eigenen Datenordner (`COZYSHELVES_USERDATA`) und eine Testbücherei (`COZYSHELVES_BOOKS`), nie die eigenen
Bücher. `HARNESS_LOAD_TIMEOUT=<ms>` lässt den Testrahmen beim Start länger warten (große Büchereien, sonst 30000):

```
npm test                                   # Fernleihe, Datenordner, Einstellungen, Feeds, Bibliothek, Regale und doppelte Bücher, Cover und Metadaten, Hörbücher, Mediathek, Spiele, Vorlesen mit Lautschrift, Buchtext und Stimmdownloads, Controller-Zeiger, Volltextsuche, Textansicht von PDFs, Paketskripte, Datenschutz (ohne Fenster)
npm run check:privacy                      # keine Namen, Konten, E-Mail-Adressen oder Benutzerordner im Projekt (auch in PDF, EPUB, PNG, Schriften)
node build/third-party.js                  # alle Fremdbestandteile mit Version und Lizenz (--md: Tabelle, --text <Datei>: Lizenztexte)
node build/screenshot.js wheel-check       # Abteilungsrad: Mitte wechselt zu den Orten, Ort wählen teleportiert, Q, Controller LB/RB, Lesbarkeit der Beschriftungen, Englisch, Bilder beider Ringe (WHEEL_PARTS=open,centre,pick,keys,pad,fit,english,shots)
node build/screenshot.js peek-card-check   # Cover-Karte: das Cover frei im Bild ohne Rahmen, die Tasten auf einer Leiste darunter, Fortschritt und Gelesen-Abzeichen, drei Erscheinungsbilder, 2560 × 1440, die Hörbuchkarte (PC_SIZE, PC_AUDIOBOOKS=<Hörbuchordner> oder 0)
node build/screenshot.js world-check       # Halle, Bücherzimmer, Rad, Hover-Karte, Sitzplätze, Katze
node build/screenshot.js flow-check        # Buch nehmen, lesen, abgeben, alle Panels
node build/screenshot.js stress-check      # Erreichbarkeit, Kollisionen, Speicher, Nahaufnahmen
node build/screenshot.js cinema-real       # echter Mediathek-Film auf der Leinwand (Netz nötig)
node build/screenshot.js mediathek-check   # Mediathek mit Wiedergabe, Live-TV und Downloads
node build/screenshot.js browser-check     # Lesebrowser gegen echte Websites
node build/screenshot.js look-check        # feste Kamerapositionen für die Grafikprüfung
node build/screenshot.js views             # freie Kamerapositionen (VIEWS='[["name",x,z,yaw,pitch]]')
node build/screenshot.js overlap-audit     # Möbel, Pflanzen und Lampen gegeneinander, gegen Wände und Vertäfelung
node build/screenshot.js gpu-perf          # Bildzeiten auf der Grafikkarte (Mittel, 95 %, 99 %, Hänger)
node build/screenshot.js books-check       # Bücherzimmer: Abteilungen an den Wänden, Schilder, Wegweiser, Aufbauzeit, Hover, Rad, Abteilung ändern, Empfehlungen (BOOKS_PARTS=layout,perf,shots,hover,wheel,manual,picks)
node build/screenshot.js side-cover-check  # Cover an den Seiten der Bücher: offene Seiten an Reihenenden und Lücken, Zellen im Atlas gegen das Bild, vorn und hinten aufrecht und ungespiegelt, neues Cover ohne Neuaufbau, Korb und herausgezogenes Buch, Bildzeit und Neuaufbau mit und ohne Bilder (große Testbücherei oder eine kleine mit echten Covern; SC_PARTS=faces,atlas,render,newcover,gap,hover,spines,load,perf,rebuild,shots; SC_SHOTS=0)
node build/screenshot.js hover-perf        # Bildzeiten beim Überstreichen ganzer Regale (zweimal mit derselben COZYSHELVES_USERDATA: kalt, warm)
node build/screenshot.js perf-matrix       # GPU- und CPU-Zeit je Bild nach Ansicht, Stufe und Größe (PM_TIERS, PM_SIZES, PERF_EMU=2560x1440, PM_N), dazu die Teile des Bildes, die Pässe und der Speicher (PM_PARTS=matrix,cpu,passes,memory)
node build/screenshot.js perf-probe        # Wo die Zeit eines Bildes hingeht: Teile der Welt der Reihe nach weggelassen, die Schritte des AO-Passes, die Zeichenaufrufe je Pass und Objekt (PB_VIEWS, PB_TIER)
node build/screenshot.js perf-shots        # Bilder jeder Stufe, Ansicht und Wetterlage, jedes Mal gleich gemacht (COZYSHELVES_QUERY=nopaint=1); node build/scripts/perf-diff.js <A> <B> vergleicht zwei Läufe Pixel für Pixel
node build/screenshot.js perf-startup      # Der Start in Millisekunden (Welt gebaut, erstes Bild, Menü, Bücherei betreten) mit CPU-Profil; zweimal mit derselben COZYSHELVES_USERDATA: kalt, warm
node build/screenshot.js perf-panels       # Öffnen und Schließen jeder Tafel in Millisekunden, lange Aufgaben, die Bildzeit der Welt dahinter
node build/screenshot.js controls-check    # Springen (auch auf Möbel), Kopffreiheit, Aufstehen mit WASD, Klick auf Dinge, Beschriftungen beim Hinsehen, Leertaste im Buch und in Panels
node build/screenshot.js interior-check    # Ecken am Durchgang, Schattenkante an der Südwand, scharfe Schilder, Hover auf das Nachbarbuch, Springen auf Möbel, Uhr, Buch am Sitzplatz (IX_PARTS=corners,signs,hover,jump,clock,tablebooks)
node build/screenshot.js hud-check         # Buchkarte (zwei Fünftel der Fensterhöhe, linker Rand bei 60 %), Tasten, Beschriftungen, Miniplayer-Tasten, Auflösung im Player, Musikpause (HQ_NET=0 ohne Netz)
node build/screenshot.js walls-check       # Wandgestaltung: jede Wahl sofort und ohne Neuaufbau, Bildzeiten beim Wechsel, Graffiti (Zeit, Speicher, Neu sprühen); WALLS_PHASE=restart mit derselben COZYSHELVES_USERDATA prüft den Neustart
node build/screenshot.js rebuild-seated-check  # Neuaufbau der Welt im Sitzen: Sitzhöhe und laufendes Hinsetzen bleiben erhalten
node build/screenshot.js quit-check        # Schließen des Fensters beendet die App ganz (auch die unsichtbaren Fenster, die die Bücher einlesen und die Volltextsuche aufbauen)
node build/screenshot.js quit-close-check  # Schließen, während die Volltextsuche ein Buch liest: der Prozess endet (COZYSHELVES_FULLTEXT_DELAY=0)
node build/screenshot.js indexer-crash-check  # die Seite des unsichtbaren Einlesefensters stirbt und kommt wieder: die Bücher werden weiter eingelesen, Bilder wieder entschlüsselt (beendet den Renderer des Einlesefensters der Testinstanz)
node build/screenshot.js epub-script-check # ein Buch mit Skripten: nichts davon läuft in der App (Testbücherei: node build/testlib/make_scripted_epub.js <Ordner>)
node build/screenshot.js outdoor-check     # Glastüren, Hinausgehen, Grenzen des Gartens, Liegestühle
node build/screenshot.js outdoor2-check    # Garten zu Fuß: Steg und Bänke, Grenzen, Türen in beide Richtungen, Regen am Boden und nie in den Räumen, Bildzeiten draußen (OD2_PARTS=walk,bounds,doors,rain,perf,shots)
node build/screenshot.js outdoor-views     # Bilder vom Garten bei jedem Wetter und zu mehreren Tageszeiten (OV_VIEWS, OV_COND)
node build/screenshot.js outdoor-perf      # Bildzeiten auf einem festen Weg durch den Garten (PERF_WEATHER)
node build/screenshot.js wildlife-check    # Wildtiere: Vorbereitung hinter dem Menü, Auftauchen ohne Ruckler, Bodenkontakt, Hindernisse, Aufschauen und Flucht, Häufigkeit über simulierte Stunden (Oft, Normal, Selten), Fenster des Bücherzimmers, Schnee (WL_SHOTS=name,… oder none, WL_HOURS)
node build/screenshot.js flee-check        # Flucht der Wildtiere: Aufschauen und Schritte weg, zügiger Trab der Rehe mit Kitz und des Hirsches, schneller Trab des Fuchses, Stehenbleiben in Sichtweite, Beruhigen, neuer Platz, Besuch endet zur vorgesehenen Zeit, Futterstelle, Jagen, Heimweg, Beobachtungsstand, Shader, Bilder (Kopie einer kleinen Testbücherei; FL_PARTS=doe,alert,stag,fox,feeder,chase,home,hide,programs,shots; FL_SHOTS=name,… oder none)
node build/screenshot.js window-check      # Wildtiere aus jedem Fenster: Anteil der Zeit mit einem Tier im Blick, geprüft mit Strahlen gegen Haus und Bäume (WC_MINUTES, WC_SIDES)
node build/screenshot.js feeder-check      # Futterstelle: Aufbau, Hindernisse, Beobachtungsstand und Ort, Sichtlinien, Fressen an Raufe, Trog und Salz, Bilder (FD_SHOTS=name,… oder none)
node build/screenshot.js fauna-check       # Vögel, Kois und Frösche: Flug, Sitzplätze, Haus, Flucht, Kois am Steg, Frösche, Jahreszeiten, Schalter, Shader, Bildzeiten (FA_PARTS=birds,perches,house,flee,koi,frogs,seasons,setting,programs,perf,shots; FA_SHOTS=none)
node build/screenshot.js garden-check      # Seerosen, Schilf, Jahreszeiten, Feuerschale, Zeile „Jahreszeit“ (GC_PARTS=lilies,reeds,seasons,fire,settings,shots; GC_SHOTS=1)
node build/screenshot.js winter-check      # Winter: Spuren im Schnee (Schritte, links und rechts, Richtung, Rennen, Sprung, keine im Haus und ohne Schnee, Verblassen, Budget), Spuren von Reh, Fuchs, Amsel und Krähe, der zugefrorene See (nur im Winter begehbar, vom Ufer und vom Steg, Steg als Wand, Schilf, Rutschen gemessen, Schritte auf Eis, keine Enten), Schnee auf Weg, Terrasse und Steg, keine neuen Shader, Kosten (WT_PARTS=prints,animals,ice,snow,programs,perf,shots; WT_SHOTS=1 speichert Bilder)
node build/screenshot.js lod-check         # Bäume ohne Aufploppen: Pixel beim Wechsel der Form, Wechsel je Bild auf dem Weg (LOD_INFO=1 mit APP_DIR für ältere Versionen)
node build/screenshot.js garden-perf       # Grafikzeit im Garten je Ausstattung (GP_CONF=base,nolilies,noreeds,lod40,autumn,fire …; VIEWS, PERF_EMU)
node build/screenshot.js garden-views      # Bilder vom Garten je Jahreszeit, Wetter und Stunde (GV_VIEWS, GV_COND, GV_FIRE)
node build/screenshot.js sky-check         # Himmel, Tageszeit und Wetter: Einstellungen, alte Einstellungen, Tageszeiten, Wetter, Sterne und Mond, Glas, Schatten, echtes Wetter, Bildzeiten, Shader (SK_PARTS=settings,migrate,time,weather,sky,glass,shadows,live,perf,programs,shots; SK_SHOTS; SK_NET=1 fragt Open-Meteo; der Teil migrate braucht vorher ein settings.json mit {"weather":"fog","timeMode":"cycle","firstRun":false} in COZYSHELVES_USERDATA)
node build/screenshot.js sky-views         # Bilder von Himmel, Garten und Fenstern (SV_COND, SV_VIEWS, SV_SIZE, SV_SCALE)
node build/screenshot.js sound-check       # Geräusche der Welt, Garten, Tür, Schritte, Schalter für einzelne Geräusche, Klänge offline mit WAV-Dateien (SND_PARTS, SOUND_DIR)
node build/screenshot.js worldmap-check    # Wandkarte, Kacheln von OpenStreetMap (von der Prüfung selbst geliefert, keine Anfragen an OpenStreetMap), Länder und Städte, kleine Inselstaaten, Suche, Zoom, Wikipedia, Street View (nur „Alle ablehnen“), Farbthemen, ohne Verbindung, Karten im Lesebrowser, Standbild statt Weichzeichner
node build/screenshot.js worldmap-real-check  # die Weltkarte nur mit echter Maus und Tastatur, 2560 × 1440, zweimal: zu Fuß bis gut 4 m vor die Karte, Klick und E, Ziehen, Mausrad, kleine Länder, Küste, Städte, Street View, Suche, Zurück und Vor
node build/screenshot.js gpu-recovery-check  # Absturz des Grafikprozesses: Neuaufbau an derselben Stelle, Hinweis, Warten bei offener Tafel, Notiz in logs\gpu.log (beendet den Grafikprozess der Testinstanz)
node build/screenshot.js covers-check      # Cover und Metadaten aus Katalogen und Bildersuche, Buchinfo, Einstellungen (Testbücherei: python build/testlib/gen_covers_lib.py <Ordner>\lib); ohne COZYSHELVES_COVERS_FIXTURES oder COZYSHELVES_COVERS_LIVE=1 bleibt jeder Testlauf offline
node build/screenshot.js covers-batch-check  # „Alle Cover jetzt laden“ ohne Netz mit erfundenen Antworten: sechs zugleich, Fortschritt, Pause, Abbrechen, Neustart (Kopie der großen Testbücherei; COZYSHELVES_COVERS_FIXTURES=<leerer Ordner> COZYSHELVES_COVERS_SYNTH=1 COZYSHELVES_COVERS_SYNTH_DELAY=250 COZYSHELVES_COVERS_GAP=60000; BATCH_PHASE=restart mit derselben COZYSHELVES_USERDATA, BATCH_PHASE=speed mit COZYSHELVES_COVERS_PACE=1 und COZYSHELVES_COVERS_SYNTH_DELAY=300)
node build/screenshot.js covers-upgrade-check  # eine Bücherei aus 0.5: Seite 1 wird geprüft, ohne neu einzulesen
node build/screenshot.js tts-de-check      # alle deutschen Stimmen: Lautschrift, Pausen, Lautstärke, lautloses Vorlesen
node build/screenshot.js tts-rtf-probe     # Echtzeitfaktor je Stimme und Gerät (WebGPU, Prozessor)
node build/screenshot.js theme-check       # Erscheinungsbild über einen Neustart hinweg (zwei Starts mit derselben COZYSHELVES_USERDATA)
node build/screenshot.js gpu-time          # Grafikzeit pro Bild mit Timer-Queries, genauer als gpu-perf (dessen Bildzeiten an die Bildwiederholrate gebunden sind)
node build/screenshot.js startup-time      # Aufbauzeit von Himmel und Garten
node build/screenshot.js cat-check         # Katze: Wege, Sprünge, Streicheln, Neuaufbau, Zeichenaufrufe und Dreiecke, Augen und Blinzeln, Bauch, Schwanz, Fellatlas, Bildzeit (CATPERF)
node build/screenshot.js cat-views         # Katze: Bilder von vorn, von der Seite, von hinten, nah und aus einigen Metern, sitzend, schlafend, laufend, gestreichelt (CV_HOURS=11,20 feste Uhrzeiten, SHOT_TAG)
node build/screenshot.js media-focus-check # eine Wiedergabe zur Zeit, Miniplayer mit Podcast, Medientasten, Leertaste
node build/screenshot.js film-fullscreen-check  # Film im Vollbild: F, Tasten, Untertitel, zurück zur Leinwand
node build/screenshot.js page-color-check  # Seitenfarben auf PDF, EPUB und Comic, Folgen des Erscheinungsbilds, Umblätterzeit
node build/screenshot.js chess-snip-check  # Diagramm ausschneiden in PDF und E-Book, ein Buchdiagramm mit Schraffur und Pfeilen genau, Texte deutsch und englisch (auch beim Umschalten), Korrektur, Lernen pro Buch (CHESS_DUMP=<Datei> schreibt die Vorlagen für die Messung)
node build/screenshot.js rebuild-stall-check  # Neuaufbau nach einer Änderung der Bücherei (wachsen, tauschen, schrumpfen, zurück): kein Shader wird neu übersetzt, kein langes Bild
node build/screenshot.js godrays-check     # Goldene Stunde und Lichtstrahlen: Einstellung, Strahlen drinnen und draußen, keine bei Nacht und Regen, Nebel, Qualitätsstufen, keine Shader nach dem Aufwärmen, Grafikzeit (PERF_EMU=2560x1440; GR_PARTS=settings,rays,weather,tiers,programs,perf,shots)
node build/screenshot.js firststart-check  # erster Start ohne COZYSHELVES_BOOKS: Willkommenskarte, Später, leere Bücherei, Ordner wählen (Dialog ersetzt), zweiter Start (FS_PHASE=first, restart, again mit demselben COZYSHELVES_USERDATA; FS_LIB=<kleine Testbücherei>)
node build/screenshot.js fallback-check    # zu große Bücherei: eine Abteilung im Zimmer, Schild, Tafel mit Nummer, Rad wechselt, Wahl gespeichert (FB_PHASE=restart mit demselben Datenordner und SHOT_DIR; eine passende Bücherei wird sechsfach aufgeblasen; python build/testlib/gen_overflow_lib.py <Ordner> erzeugt eine, die nicht passt)
node build/screenshot.js room-views        # Bilder des Bücherzimmers: Eingang, Rückwand, Durchgang, Tafel, Weltkarte, Seitenwände (SHOT_TAG, RV_SIZE, COZYSHELVES_QUERY="hour=21")
node build/screenshot.js interior2-check   # Fußböden, Graffiti in beiden Sprachen, Lampen, Buchkarte in drei Fenstergrößen, Pulte (Kopie einer Testbücherei mit echten Covern; danach IX2_PHASE=restart mit denselben Nutzerdaten; IX2_PARTS=floors,graffiti,lectern,lamps,card,shots)
node build/screenshot.js easel-check       # Staffelei: drei Füße auf dem Boden, Vorderbeine unten gespreizt und oben vereint, Schwerpunkt über der Standfläche, Leinwand 10 bis 15° zurückgelehnt auf der Leiste und am Mast, nichts in Wand, Vertäfelung oder Möbeln, weiße Leinwand ohne Schrift, ein gespeichertes Aquarell darauf, E und Kollision, Bilder von allen Seiten (danach EASEL_PHASE=restart mit derselben COZYSHELVES_USERDATA; EASEL_SHOTS=0)
node build/screenshot.js shelves-check     # Regal „Gelesen“ (C, 97 %, Schalter, ohne Karte und Messingschild, leer und voll, Deutsch und Englisch, Leseziel aus der Statistik), doppelte Bücher, jede Sortierung, Buchinfo, Liste „Doppelte Bücher“, Sprachfeld (Testbücherei: python build/testlib/gen_shelves.py <Ordner>\lib; SH_PARTS=…)
node build/screenshot.js shelves-perf      # große Testbücherei: Anordnung, Neuaufbau bei neuer Sortierung, Zeichenaufrufe (SHP_READ=60)
node build/screenshot.js refresh-frames    # längstes Bild nach einem Neuaufbau der Regale (läuft auch mit älteren Versionen, als Vergleich)
node build/screenshot.js search-check      # Volltextsuche: Index, Anfragen, Filter, Tafel, Treffer im Leser, Strg+F, geänderte Bücher, Pause beim Lesen, Einstellungen (Testbücherei: python build/testlib/gen_search_lib.py small <Ordner>, COZYSHELVES_FULLTEXT_DELAY=0; danach SEARCH_PHASE=restart mit derselben COZYSHELVES_USERDATA; SEARCH_PHASE=shots, perf, mem; SEARCH_LIB=large)
node build/screenshot.js reader-text-check # Textansicht von PDFs, Schrift, Schriftgröße, Seitenbreite, alte Ränder (Bücher von python build/testlib/gen_reader_books.py <Ordner>; TV_PARTS, TV_SIZE)
node build/screenshot.js reader-tts-check  # Vorlesen von Büchern: Sprache je Absatz, Stimme, erste Sätze, Schachnotation, Seiten ohne lesbaren Text, Stimmenmenü, Lesebrowser, Alle Stimmen (Testbücher: python build/testlib/gen_tts_books.py <Ordner>; TTS_BOOKS=<Ordner>, COZYSHELVES_PIPER_DIR mit Thorsten mittel; TTS_PARTS=all mit einem lokalen Ersatz für Hugging Face, siehe Kopf des Skripts)
node build/screenshot.js audiobooks-check  # Hörbücher: Ordner, Tafel, Wiedergabe, Kapitel, Geschwindigkeit, Schlaftimer, Miniplayer, Medientasten, Hörbuchregal, das leere Hörbuchregal ohne Ordner, Füllen ohne Neuaufbau, Entfernen des letzten Ordners (AB_LIB, sonst erzeugt mit gen_audiobooks.js; AB_PHASE=restart mit derselben COZYSHELVES_USERDATA; AB_SHOTS=0)
node build/screenshot.js controller-check  # Controller mit einem simulierten Gamepad: Welt, Hinweise, Menü, Einstellungen, Buch, Mediathek, Weltkarte, Computer, Mauszeiger, Tafeln, PlayStation, Englisch (CC_PARTS=world,hints,menu,settings,reader,media,map,computer,pointer,podcasts,panels,ps,english,live)
node build/screenshot.js medien-check      # englischsprachige Quellen, Reihenfolge nach Sprache, Auflösungen im Player und beim Herunterladen, Zeitungen nach Sprache (Netz nötig, MC_PARTS=order,english,quality,news)
node build/screenshot.js cinema-perf-check # Herumlaufen in der Halle mit und ohne Film auf der Leinwand, bei 1600 × 900 und 2560 × 1440, Vergleich mit dem Farbmuster von 0.6 (CP_ROUNDS=5 für ruhigere Werte)
node build/screenshot.js audit-<bereich>   # Prüfskripte je Panel (menu, reader, computer, chess, catalog …)
```

Eine große Testbücherei mit erfundenen Abteilungen, Titeln und Autoren (784 Bücher in 11 Abteilungen, bis zu 16
nummerierte Regale, Bücher direkt im Abteilungsordner, eine tiefere Ordnerebene, „00 Must-Read“-Ordner mit
Verknüpfungen, PDFs und EPUBs mit und ohne Cover, deutsche und englische, kurze und sehr lange Titel, Dateinamen nach
„Titel - Autor“ und im mehrteiligen Schema mancher Download-Seiten, kaputte PDFs, gespeicherte Webseiten mit Ressourcenordnern, Notizen
und Skripte, die keine Bücher sind) für `books-check`, `hover-perf`, `overlap-audit`, `fallback-check`,
`covers-upgrade-check`, `worldmap-real-check` und `side-cover-check`:

```
python build/testlib/gen_lib.py <Ordner>\lib
powershell -File build/testlib/make_lnk.ps1 <Ordner>\lib
```

Weitere Testbüchereien und Messungen (Python mit PIL, PyMuPDF, python-chess und numpy; gen_reader_books.py braucht
dazu reportlab, gen_search_lib.py python-docx, build/chess-net/train.py PyTorch):

```
python build/testlib/gen_covers_lib.py <Ordner>\lib        # Bücher ohne echtes Cover für covers-check
python build/testlib/gen_shelves.py <Ordner>\lib           # drei Abteilungen mit Reihen, doppelten Büchern und kaputten Sprachangaben für shelves-check
python build/testlib/gen_search_lib.py small <Ordner>       # Bücher und erwartete Treffer für search-check (large <Ordner> <Quellbücherei> für die Messung)
python build/testlib/gen_reader_books.py <Ordner>           # PDFs wie gedruckte Bücher und ein EPUB für reader-text-check
python build/testlib/gen_tts_books.py <Ordner>              # Bücher und eine Lexikonseite zum Vorlesen für reader-tts-check
node build/testlib/gen_audiobooks.js <Ordner> [--extra N]   # erfundene Hörbücher in allen Formaten und Ordnerformen für audiobooks-check
node build/testlib/make_scripted_epub.js <Ordner>           # ein EPUB mit Skripten und Ereignisattributen für epub-script-check
node build/testlib/audiobook-scan-bench.js <Ordner>         # Tempo und Speicher des Hörbuch-Scanners an einer großen erzeugten Sammlung
node electron/library/fixtures/make-fixtures.js            # erfundene Antworten der Kataloge und Bildersuchen und gezeichnete Bilder für die Cover-Tests
npx electron build/testlib/record-cover-sources.js <Ordner> # misst die echten Kataloge und Bildersuchen an der Stichprobe (Netz), Antworten nur im Ordner
node build/feeds-lang-audit.js                              # Sprache aller Zeitungen prüfen (Netz), schreibt electron/feeds/fixtures/feed-languages.json
python build/testlib/gen_chess.py lib <Ordner> [<EPUB-Ordner>]   # Schachbücher für page-color-check und chess-snip-check
python build/testlib/gen_chess.py bench <Ordner> 3          # 1170 Diagramme in vielen Buchstilen
python build/testlib/gen_chess.py book <Ordner> 320         # 320 klassische Buchdiagramme mit Schraffur, Pfeilen und getönten Seiten
python build/testlib/gen_chess.py fixtures                  # die drei gezeichneten Diagramme in build/testlib/fixtures
node build/chess-bench.js <Ordner> --templates <Datei> [--loo]  # Erkennungsrate je Stil (--loo: Figurensatz unbekannt)
node build/chess-bench.js <Ordner> --templates <Datei> --fixtures build/testlib/fixtures [--lib <Ordner>]  # Felder, ganze Stellungen und Kalibrierung der Sicherheit; --lib misst eine andere Version
```

Das Netz der Diagrammerkennung (`app/src/ui/chess/diagram/net-weights.js`) entsteht mit `build/chess-net`:
`extract.js` schneidet Übungsfelder aus erzeugten Diagrammen, `train.py` übt das Netz, `tune.js` stimmt die
Entscheidung ab und eicht die angezeigte Sicherheit. Die Aufrufe stehen im Kopf der drei Dateien.

Aufbau: `electron/` (Hauptprozess: Scanner, Klassifikation, Cover und Metadaten, Feeds, Wikipedia, Podcasts,
Katalog, Mediathek, Hörbücher, Volltextindex, TTS), `app/src/world` (3D-Welt), `app/src/ui` (Reader, Computer,
Zeitung, Schach, Aquarell, Browser, Rad, Hörbücher, Volltextsuche …), `app/src/input` (Controller), `app/src/audio`
(prozedurale Musik und die Geräusche der Welt), `app/data/fonts` (Leseschriften), `vendor-src/` (foliate-js + pdf.js,
wird beim Build nach `app/vendor` kopiert), `docs/CONTRACTS.md` (Modul-Schnittstellen), `docs/TTS.md`.

## Mitmachen

* Texte immer auf Deutsch und Englisch (`app/src/i18n/de.js` und `en.js` oder `tr({ de, en })` im Modul), kurz und
  sachlich, ohne Gedankenstriche als Satzzeichen. Alles Anklickbare ist auch mit der Tastatur erreichbar.
* Jede neue Funktion und jeder behobene Fehler bekommt eine Prüfung in `build/scripts/` (Zeilen `PASS …`/`FAIL …` und
  eine Zusammenfassung). Prüfungen laufen stumm und unsichtbar und nur mit Testbüchereien.
* Keine persönlichen Daten in Code, Kommentaren, Tests oder Testdaten: `npm test` schließt `npm run check:privacy` ein.
  Die Liste verbotener Wörter liegt nur auf dem eigenen Rechner in `.privacy-words.json` (Aufbau im Kopf von
  `build/privacy-check.js`), ohne sie sucht die Prüfung nach Benutzerordnern in Pfaden.
  Beispielpfade in Tests sind `C:\Bücher` oder `D:\Hörbücher`.
* Neue Abhängigkeiten nur aus der npm-Registry und mit einer Lizenz, die zur GPL-3.0 passt. `node build/third-party.js`
  zeigt sie mit Version und Lizenz, `node build/third-party.js --md` liefert die Tabelle für `THIRD_PARTY_NOTICES.md`.

## Lizenz

Cozy Shelves ist freie Software unter der GNU General Public License, Version 3 oder neuer (GPL-3.0-or-later, siehe
`LICENSE`). Die verwendeten Bibliotheken, Schriften, Daten und Stimmen mit ihren Lizenzen nennt `LIZENZEN.md`, die
vollständige Liste `THIRD_PARTY_NOTICES.md`.
