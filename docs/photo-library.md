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

## Räume und Baufortschritt

Unter **Projektwerkstatt → Räume & Grundrisse** zeigt jeder gespeicherte Raum
seine Bilder direkt im Bereich **Fotos & Baufortschritt**. Die Vorschau enthält
bis zu sechs Aufnahmen. **Fotos hochladen / zuordnen** öffnet die gemeinsame
Fotoverwaltung mit Upload, optionaler Komprimierung und Auswahl aus der Bibliothek.
Ein Klick auf eine Vorschau öffnet die Fotodetails; Raum- und Fotoansicht bleiben
dabei gestapelt erhalten.

Die Raumvorschau zeigt die neuesten Aufnahmen zuerst. Die Fotoverwaltung lässt
sich zusätzlich nach Aufnahmedatum auf- oder absteigend sortieren. Wenn kein
Aufnahmedatum eingetragen ist, wird das Upload-Datum verwendet und ausdrücklich
als **Upload** gekennzeichnet. Aufnahmedatum, Beschreibung und Tags lassen sich
in den Fotodetails pflegen. Bilder werden dabei nicht kopiert; andere
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
den Bildern gespeichert. Bei einem Fehler bleiben die Eingaben im Dialog stehen.
Ein identischer erneuter Upload ergänzt Tags und Verknüpfungen, ohne vorhandene
Angaben zu entfernen oder eine zweite Datei anzulegen.

Die Anzeige nennt die tatsächlich verfügbaren Formate samt Dateiendungen. Mit
den aktuellen Abhängigkeiten werden JPEG/JFIF, PNG, WEBP, HEIC/HEIF, AVIF, GIF,
TIFF, BMP/DIB, ICO und JPEG 2000 unterstützt. HEIC/HEIF verwendet `pillow-heif`.
Das Startskript installiert diese Abhängigkeit als Binärpaket, ohne einen lokalen
Homebrew-/libheif-Build zu benötigen. Fehlt der Decoder in einer älteren
Installation, zeigt der Dialog dies ausdrücklich an. Originale der neuen Formate
bleiben auch im Projektbackup erhalten; die Vorschau wird browserkompatibel
erzeugt. Das gilt auch für die Dokumentenansicht.

Die Dateien werden lokal geprüft und nicht automatisch analysiert oder an
ChatGPT gesendet. Beim Upload stehen zwei Optionen zur Verfügung:

- **Originalgröße beibehalten**: unveränderte Bilddatei speichern.
- **Komprimiert speichern**: Bildausrichtung berücksichtigen, auf höchstens 2560
  Pixel je Kante verkleinern und als WEBP mit Qualität 82 speichern. Wenn dies
  keine kleinere Datei ergibt, wird die ursprüngliche Datei verwendet.

Die Option ist in der Bibliothek und in jeder verknüpften Fotoansicht vorhanden.
Bei komprimierter Speicherung wird keine zweite große Originalkopie in der App
abgelegt. Die Quelldatei auf dem Rechner bleibt unverändert. Bereits gespeicherte
Fotos werden nicht nachträglich verändert. Die Uploadanzeige nennt die erzielte
Größenänderung. Ein fehlerhaftes Bild bricht den gesamten Upload ohne Teilablage ab.
Identische gespeicherte Bilddaten werden innerhalb des Projekts wiederverwendet.
Animationen und mehrseitige Dateien werden auch bei gewählter Komprimierung
unverändert gespeichert, damit keine weiteren Bilder oder Seiten verloren gehen.
Die Vorschau zeigt dabei das erste Bild.

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
Das Original bleibt anschließend unter Dokumente erhalten und kann dort nach den
vorhandenen Schutzregeln separat gelöscht werden.

Fotoänderungen verwenden Revisionskennungen gegen veraltete Schreibstände.
Schreiboperationen teilen die Projektsperre. Bilder eines anderen Projekts können
weder abgerufen noch zugeordnet werden. Die Originaldateien des Nutzers werden
nicht durch Tests oder Migrationen bearbeitet.
