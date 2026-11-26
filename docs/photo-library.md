# Gemeinsame Fotobibliothek

Die **Fotobibliothek** steht in der Sidebar unter **Projekt**. Sie zeigt kompakte
Bildkacheln mit Vorschau, Titel, Datum, Tags und Zahl der Objektverknüpfungen.
Suche durchsucht Titel, Beschreibung, Dateiname und Tags. Mehrere ausgewählte Tags
filtern gemeinsam. Sortierung: neueste, älteste oder Titel A–Z.

## Ein Foto, mehrere Einträge

Fotos werden einmal in der Bibliothek gespeichert. Angebote, Rechnungen,
To-dos/Notizen, Bautagebuch und andere Werkstatteinträge, Termine, Eigenleistungen,
Förderungen, Firmen, Dokumente, Stundenübersichten und Finanzierungskonten können
auf dieselben Fotos verweisen. Jeder Eintrag kann mehrere Fotos haben.

Das Kamera-Icon im Kopf eines **gespeicherten** Eintrags öffnet immer dieselbe
Ansicht. Dort kann man Fotos direkt hochladen oder aus der Bibliothek auswählen.
Direkt hochgeladene Fotos werden dem geöffneten Eintrag sofort zugeordnet.
Die Fotos bleiben auch zentral sichtbar. In den Fotodetails können zusätzliche
Einträge zugeordnet und einzelne Verknüpfungen gelöst werden.

**Hier lösen** entfernt nur die gewählte Zuordnung. Das Original und alle anderen
Zuordnungen bleiben erhalten. Wird ein Objekt gelöscht, werden seine
Fotoverknüpfungen in derselben Transaktion entfernt; die Fotos bleiben bestehen.
Mehrfachauswahl beim Zuordnen wird atomar geprüft und gespeichert. Ein erneutes
Zuordnen erzeugt keine doppelten Verknüpfungen.

## Sammelbearbeitung

Über **Mehrere auswählen** lassen sich einzelne Kacheln markieren. **Alle Treffer
auswählen** markiert die aktuellen Such-/Filterergebnisse, bis zu 500 Fotos pro
Vorgang. Beim Ändern des Such- oder Tagfilters wird die Auswahl geleert; die
Sortierreihenfolge ändert die Auswahl nicht. Markierte Bilder sind mit Rahmen
und Häkchen gekennzeichnet.

**Auswahl bearbeiten** öffnet einen gemeinsamen Dialog. Tags, Räume und weitere
Objekte haben jeweils eine eigene Aktion **Hinzufügen** oder **Entfernen**.
Hinzufügen ergänzt die vorhandenen Angaben. Entfernen löst ausschließlich die
gewählten Tags oder Zuordnungen. Leere Felder verändern nichts. Die Originale,
Aufnahmedaten und alle übrigen Verknüpfungen bleiben erhalten.

Der Server prüft sämtliche Bilder und Ziele auf Projektzugehörigkeit und Existenz.
Die gesamte Sammeländerung erfolgt in einer Transaktion: Fehler führen zu keiner
Teiländerung. Erneutes Anwenden einer Hinzufüge-Aktion erzeugt keine Duplikate.
Nach dem Speichern zeigt die Übersicht die tatsächlich geänderte Bildanzahl.

## Räume und Baufortschritt

Unter **Projektwerkstatt → Räume & Grundrisse** zeigt jeder gespeicherte Raum
seine Bilder direkt im Bereich **Fotos & Baufortschritt**. Die Vorschau enthält
bis zu sechs Aufnahmen. **Fotos hochladen / zuordnen** öffnet die gemeinsame
Fotoverwaltung mit Upload, optionaler Komprimierung und Auswahl aus der Bibliothek.
Ein Klick auf eine Vorschau öffnet die Fotodetails; Raum- und Fotoansicht bleiben
dabei gestapelt erhalten.

Die Raumvorschau zeigt die neuesten Aufnahmen zuerst. Die Fotoverwaltung lässt
sich zusätzlich nach Aufnahmedatum auf- oder absteigend sortieren. Wenn kein
Aufnahmedatum in den Bildmetadaten vorliegt, wird das Upload-Datum verwendet und ausdrücklich
als **Upload** gekennzeichnet. Das Aufnahmedatum ist schreibgeschützt. Es wird
aus EXIF `DateTimeOriginal`, alternativ `DateTimeDigitized`, gelesen. Ein
Dateiänderungsdatum wird nicht als Aufnahmezeit ausgegeben. Beschreibung und Tags
bleiben in den Fotodetails bearbeitbar. Bilder werden dabei nicht kopiert; andere
Objektzuordnungen und die zentrale Bibliothek bleiben dieselben.

Neue Räume müssen zuerst gespeichert werden; danach erscheint der Fotobereich
sofort im noch geöffneten Raumdialog. Beim Löschen eines Raums bleiben die Bilder
und alle anderen Zuordnungen erhalten. Lediglich die Verknüpfung zum Raum entfällt.

## Tags und Upload

Tags sind frei anlegbar und unabhängig von Objektverknüpfungen. Sie lassen sich
am Foto vergeben sowie zentral anlegen, umbenennen und entfernen. Ein Tag wird
innerhalb eines Projekts ohne Beachtung der Groß-/Kleinschreibung wiederverwendet.
Eine Tagänderung erzeugt oder entfernt keine Objektzuordnung.

Vor dem Upload öffnet sich ein gemeinsamer Dialog für alle Fotoansichten. Hier
lassen sich Bilder auswählen, freie Tags vergeben und mehrere Projektobjekte
zuordnen. Die Angaben gelten für den gesamten gewählten Stapel. Beim Aufruf aus
einem Eintrag ist dieser vorausgewählt. Tags und Zuordnungen werden atomar mit
den erfolgreich lesbaren Bildern gespeichert. Ungültige gemeinsame Tags oder
Zuordnungen verwerfen den gesamten Stapel; Eingaben bleiben im Dialog erhalten.
Ein identischer erneuter Upload ergänzt Tags und Verknüpfungen, ohne vorhandene
Angaben zu entfernen oder eine zweite Datei anzulegen.

Die Anzeige nennt die tatsächlich verfügbaren Formate samt Dateiendungen. Mit
den aktuellen Abhängigkeiten werden JPEG/JFIF, JPEG mit MPO-Zusatzbildern, PNG, WEBP, HEIC/HEIF, AVIF, GIF,
TIFF, BMP/DIB, ICO und JPEG 2000 unterstützt. HEIC/HEIF verwendet `pillow-heif`.
Das Startskript installiert diese Abhängigkeit als Binärpaket, ohne einen lokalen
Homebrew-/libheif-Build zu benötigen. Fehlt der Decoder in einer älteren
Installation, zeigt der Dialog dies ausdrücklich an. Originale der neuen Formate
bleiben auch im Projektbackup erhalten; die Vorschau wird browserkompatibel
erzeugt. Bilder sind ausschließlich in den Fotoansichten sichtbar. Projektunterlagen
und Dokument-Gesamtübersicht blenden Bilddateien aus; bestehende Dateiverweise bleiben erhalten.

Die Dateien werden lokal geprüft und nicht automatisch analysiert oder an
ChatGPT gesendet. Beim Upload stehen zwei Optionen zur Verfügung:

- **Originalgröße beibehalten**: unveränderte Bilddatei speichern.
- **Komprimiert speichern**: Bildausrichtung berücksichtigen, auf höchstens 2560
  Pixel je Kante verkleinern und als WEBP mit Qualität 82 speichern. Wenn dies
  keine kleinere Datei ergibt, wird die ursprüngliche Datei verwendet.

Die Option ist in der Bibliothek und in jeder verknüpften Fotoansicht vorhanden.
Bei komprimierter Speicherung wird keine zweite große Originalkopie in der App
abgelegt. Die Quelldatei auf dem Rechner bleibt unverändert. Bereits gespeicherte
Fotos werden nicht nachträglich verändert. Nach dem Upload bleibt ein Bericht
mit dem Ergebnis pro Dateiname sichtbar: gespeichert, bereits vorhanden oder
übersprungen. Nicht lesbare Bilder werden einzeln mit erkanntem Format und Grund
übersprungen; die übrigen werden gespeichert. Speicher- oder Datenbankfehler
rollen weiterhin die gesamte Speicherung zurück.
Identische gespeicherte Bilddaten werden innerhalb des Projekts wiederverwendet.
Seit Migration **0046** merkt sich `photo_fingerprint` zusätzlich den Fingerabdruck
der Quelldatei, damit erneute Uploads auch bei wechselnder Komprimierungsoption
denselben Bibliothekseintrag verwenden. Diese Zuordnung ist projektbezogen und
wird gesichert und wiederhergestellt. Frühere Quelldaten bereits komprimierter
Bilder lassen sich daraus nicht nachträglich rekonstruieren.
MPO-Dateien mit Zusatzbildern, Animationen und mehrseitige Dateien werden auch bei gewählter Komprimierung
unverändert gespeichert, damit keine weiteren Bilder oder Seiten verloren gehen.
Die Vorschau zeigt dabei das erste Bild. Bei komprimierten Bildern bleiben die
Aufnahmezeit-Metadaten erhalten; eine bereits angewandte Bilddrehung wird dabei
nicht nochmals als EXIF-Orientierung gespeichert. Bereits vorhandene Originale
werden für die Datumsanzeige ebenfalls ausgelesen. Historische manuelle
Datumsangaben bleiben intern und in Backups erhalten, beeinflussen die Anzeige
und Reihenfolge jedoch nicht mehr.

## Daten und Backups

`project_photo` hält Fotometadaten und verweist auf das Original im vorhandenen
Projekt-Dokumentenspeicher. `photo_tag`, `photo_tagging` und `project_photo_link`
verwalten Tags und Zuordnungen. Alles gehört zum jeweiligen Projekt. Das Original
wird im Projektbackup einmal über `project_document` gesichert; Vorschaubilder
werden bei Bedarf erzeugt und benötigen keine zusätzlichen Sicherungsdateien.

Migration **0045** ergänzt die Tabellen und übernimmt vorhandene JPEG-/PNG-/WEBP-
Projektdokumente sowie ihre bisherigen Zuordnungen aus der Projektdokumentation.
Originale und bestehende Dokumentverweise werden dabei nicht verändert. Beim
Wiederherstellen eines älteren Backups wird diese Metadatenübernahme nur für das
wiederhergestellte Projekt ausgeführt. Backupvalidierung prüft sowohl Dateiverweise
als auch die Ziele der generischen Fotoverknüpfungen.

Solange ein Foto in der Bibliothek liegt, kann sein Original nicht über den
Dokumentenbereich gelöscht oder durch eine Dokumentversion ersetzt werden.
**Aus Bibliothek entfernen** ist erst nach Lösen aller Fotoverknüpfungen möglich.
Das gespeicherte Original bleibt anschließend intern im Dokumentenspeicher und
in den Projektbackups erhalten. Es wird dadurch nicht wieder in den
Dokumentenübersichten eingeblendet.

Fotoänderungen verwenden Revisionskennungen gegen veraltete Schreibstände.
Schreiboperationen teilen die Projektsperre. Bilder eines anderen Projekts können
weder abgerufen noch zugeordnet werden. Die Originaldateien des Nutzers werden
nicht durch Tests oder Migrationen bearbeitet.
