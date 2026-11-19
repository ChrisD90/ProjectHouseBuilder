# OSB-Verlegeplaner

Der OSB-Verlegeplan steht neben dem Fliesen-Verlegeplan in der Projektwerkstatt und im Werkstatt-Schnellzugriff zur Verfügung. Beide Werkzeuge nutzen dieselben Raumkonturen, Kantenmaße, Zuschnittdarstellung, Bild-/Produktliste und PDF-/SVG-Ausgabe. Datensätze bleiben getrennt (`osb_plan` bzw. `tile_plan`), einschließlich Projekttrennung und Backups. Räume werden wie bisher als unabhängige Kopie übernommen.

## Recherche und Planungsprofil

Geprüft am 19.11.2026:

- [EGGER TLBP104, OSB-Nut-und-Feder-Verlegeplatten, Revision 03, 02.09.2026](https://binary.egger.link/pis/70fce4de-778e-4cb9-9e7b-5d00d300ffd2/TL-TLBP104-EGGER-OSB-tg-basic-installation-guideline-de), insbesondere S. 2–6. Die Produktübersicht verlinkt dieses Merkblatt unter [EGGER OSB 3](https://www.egger.com/de/bauprodukte/sortiment/produkte/osb3).
- [OBI: OSB-Platten verlegen](https://www.obi.de/magazin/bauen/boden/osb-platten-verlegen), insbesondere Randfuge, Akklimatisierung und versetzte Reihen bei schwimmender Verlegung.

Die Quellen beschreiben unterschiedliche Aufbauten. Der Planer verwendet deshalb ein ausdrücklich benanntes Boden-Planungsprofil und behandelt Werte nicht als universell gültige Freigabe aller OSB-Produkte.

| Thema | Umsetzung |
| --- | --- |
| Randabstand | EGGER verlangt mehr als 10 mm; Vorgabe im Planer 15 mm an der tatsächlichen Raumkontur. Kleinere Werte werden zurückgewiesen. |
| Nut/Feder | Modelliert wird ein Profil mit integrierter Dehnungsfuge. Eingegeben wird das Deckmaß, Zusatzfuge 0 mm. |
| Gerade Kanten | Eigene Herstellerfuge, Startwert 3 mm. Diese Kanten werden nur beim vollflächigen Untergrund angeboten; auf Balken fehlt die dafür notwendige Unterstützung aller Kanten. |
| Stoßversatz | Keine Kreuzfugen. Bei durchgehendem Untergrund wird 400 mm als anpassbarer Ausgangswert nach OBI verwendet. Der tatsächlich erzeugte Versatz muss mindestens dem eingestellten Wert entsprechen. |
| Balkenlage | Hauptachse der Platten quer zu den Balken. Innere kurze Stöße liegen auf Balkenachsen. Versatz mindestens ein Achsraster und mindestens der eingestellte Mindestwert. |
| Nicht passendes Format | Die nutzbare Plattenlänge wird auf ein ganzzahliges Vielfaches des eingegebenen Balkenrasters gekürzt; diese Felder zählen als Zuschnitte. Es werden mindestens zwei Rasterfelder benötigt. |
| Ungestützte Rand-/Schrägkanten | In der Zeichnung rot gestrichelt markiert und in den Planungshinweisen genannt. Erforderliche Rand-/Querabfangungen müssen vor Ort ergänzt werden. |
| Flächen über 10 m | Automatisch 15 mm breite Feldfugen spätestens alle 10 m in beiden Richtungen. Diese Bänder werden tatsächlich aus dem Materialraster ausgespart. Vorhandene Bauwerksfugen und Türübergänge sind zusätzlich zu berücksichtigen. |
| Drehung | Dreht das komplette Raster einschließlich Stoßversatz und Balkenlage, nicht nur die Maße einzelner Platten. |
| Menge und Preise | Konservative Einkaufsmenge mit Reserve; keine automatische Reststückverwendung. Varianten sind unabhängige Preisvergleiche, keine Kostenbuchungen. |

## Grenzen

Erste Version: geometrische Bodenplanung für **eine Plattenlage**. Keine automatische Bemessung von Plattendicke, zulässiger Spannweite, Nutzlasten, Befestigungsmitteln, Brand- oder Feuchteschutz. Der Vorgabewert 22 mm ist keine statische Empfehlung. Für den konkreten Aufbau freigegebene OSB/3- bzw. OSB/4-Produkte wählen; OSB ersetzt keine Abdichtung. Akklimatisierung (OBI: mindestens 48 Stunden), Ebenheit, Trockenheit, Profilverleimung und Behandlung zugeschnittener Kanten sind nach Herstellerangaben zu prüfen. Zweilagige Konstruktionen, Dach-/Wandbeplankungen und innere Aussparungen sind noch nicht modelliert.

Der Pfeil zeigt die Hauptachse, graue gestrichelte Linien die Balkenachsen, ockerfarbene Streifen Feldfugen und rote Linien erforderliche zusätzliche Auflager. Quellen und Hinweise werden auch in der Druck-/PDF-Ansicht ausgegeben. Eine gespeicherte Skizze mit roten Kanten ist ein Planungsentwurf, keine Ausführungsfreigabe.

## Gemeinsames Layout und UI-Skalierung

Auf breiten Ansichten: schmale Angaben links, Vorschau/Raumkanten/Berechnungen in der Mitte, rechts Zuschnitte und Materialvarianten in zwei gleich hohen, jeweils scrollbar Bereichen. Das Öffnen der Listen verändert die Vorschaugröße nicht. Auf schmaleren Ansichten werden die Listen unterhalb bzw. untereinander angeordnet. Produkt-URLs werden platzsparend über ein Linksymbol bearbeitet.

Die Anwendung verwendet eine gemeinsame 80%-UI-Grundskalierung bei 100% Browserzoom. Pixel- und rem-Maße werden zusammen reduziert; Fensterhöhen und responsive Schwellen sind darauf abgestimmt. Eingebettete klassische Ansichten skalieren über ihren äußeren Frame und werden nicht erneut verkleinert. Druckausgaben verwenden keine UI-Verkleinerung. Angebote zeigen auf Desktopbreite fünf Spalten und drei vollständig sichtbare Reihen; kleinere Fenster reduzieren die Spaltenzahl.
