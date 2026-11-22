# Handwerk-Glossar

Stand der Quellenrecherche: **22.11.2026**. Der Grundbestand enthält **230 redaktionell zusammengefasste Begriffe**, jeweils mit einer direkt anklickbaren Quelle, Herausgeber/Anbieter, Artikeltitel und Prüfdatum.

| Kategorie | Begriffe |
| --- | ---: |
| Materialien & Baustoffe | 48 |
| Werkzeuge & Maschinen | 49 |
| Techniken & Verarbeitung | 31 |
| Bauteile & Konstruktion | 31 |
| Bauphysik & Energie | 25 |
| Allgemeine Begriffe & Planung | 20 |
| Haustechnik & Installation | 16 |
| Arbeitsschutz | 10 |

## Recherche

Die Quellen wurden tatsächlich abgerufen und inhaltlich zugeordnet; reine Suchergebnis-, Start- und Begriffsklärungsseiten dienen nicht als Fachbeleg. Grundlage waren das Fachglossar und die Fachartikel von **BauNetz Wissen**, passende technische Artikel von **Wikipedia** und für ausgewählte rechtliche Begriffe der Gesetzestext auf **Gesetze im Internet**. Bei Quellen mit mehreren Bedeutungen wurden die passende Fachseite beziehungsweise der passende Abschnitt ausgewählt. So verweisen Halbverband und Kreuzfuge auf Fliesen-Verlegemuster, EPS/XPS auf die jeweiligen Dämmstoffe und Abnahme/Mängelrechte auf das BGB.

Beispiele aus der Recherche:

- [BauNetz Wissen: Verlegemuster](https://www.baunetzwissen.de/fliesen-und-platten/fachwissen/verlegung/verlegemuster-156887)
- [BauNetz Wissen: Dünnbettverlegung](https://www.baunetzwissen.de/fliesen-und-platten/fachwissen/verlegung/duennbettverlegung-156895)
- [BauNetz Wissen: EPS](https://www.baunetzwissen.de/daemmstoffe/fachwissen/daemmstoffe/expandiertes-polystyrol-eps-152198) und [XPS](https://www.baunetzwissen.de/daemmstoffe/fachwissen/daemmstoffe/extrudiertes-polystyrol-xps-152204)
- [Wikipedia: Bohrhammer](https://de.wikipedia.org/wiki/Bohrhammer), [Drehmomentschlüssel](https://de.wikipedia.org/wiki/Drehmomentschl%C3%BCssel) und [Verschnittplanung](https://de.wikipedia.org/wiki/Verschnittplanung)
- [§ 640 BGB: Abnahme](https://www.gesetze-im-internet.de/bgb/__640.html), [§ 633 BGB: Mängel](https://www.gesetze-im-internet.de/bgb/__633.html), [§ 634 BGB: Mängelrechte](https://www.gesetze-im-internet.de/bgb/__634.html) und [§ 632a BGB: Abschläge](https://www.gesetze-im-internet.de/bgb/__632a.html)

Die Kurztexte sind eigene Zusammenfassungen und keine übernommenen Artikelauszüge. Sie erklären Begriffe und Unterschiede; produkt- oder aufbauspezifische Montagewerte werden nicht als allgemein gültige Vorgabe dargestellt. Das Prüfdatum bezeichnet den Abruf und die Zuordnung der Quelle, nicht eine Zertifizierung oder fortlaufende externe Überwachung. Alle konkreten Quellen stehen maschinenlesbar bei den jeweiligen Einträgen in [data/handwerk_glossary.json](../data/handwerk_glossary.json).

## Anwendung und Datenhaltung

- Kategorienfilter, alphabetische Reihenfolge und Suche über Titel, Erklärung und Synonyme, etwa „Schieblehre“, „Tiefgrund“, „FI-Schalter“ oder „Teppichmesser“.
- Höchstens 24 Einträge pro Ergebnisseite in der Werkstatt, zehn im schwebenden Schnellzugriff. Quellen sind nach Aufklappen eines Begriffs direkt verfügbar und öffnen in einem neuen Browser-Tab.
- Katalog und Erklärungen sind lokal verfügbar und benötigen weder Internet noch ChatGPT. Nur das Öffnen externer Quellen und die ausdrücklich gestartete ChatGPT-Erklärung benötigen eine Verbindung.
- Der Grundbestand wird aus einer versionierten JSON-Datei geladen und nicht in Projekte hineinkopiert. Er füllt deshalb weder neue Projekte noch Projektbackups mit künstlichen Datensätzen.
- Eigene Wissensnotizen bleiben projektbezogen. Kategorie und Quellenlink sind optionale Zusatzdaten; bereits vorhandene Notizen bleiben unverändert bearbeitbar. Die Übersicht kennzeichnet eigene Notizen ohne Fachquelle entsprechend.
- Neue Quellenlinks werden auf vollständige HTTP-/HTTPS-Adressen ohne eingebettete Zugangsdaten geprüft. Dieselbe Prüfung gilt bei einem Projekt-Restore. Das Backend ruft benutzerdefinierte Quellen nicht automatisch ab.

## Pflege

Neue Grundbegriffe erhalten eine eindeutige ID, Titel, kurze Erklärung, eine vorhandene Kategorie, optionale Synonyme und mindestens eine konkrete Quelle mit Prüfdatum. Die Fachseite vor Aufnahme lesen; bei veralteten oder unpassenden Links Quelle und Prüfdatum gemeinsam aktualisieren. Neue Kategorien haben stabile IDs; vorhandene IDs nicht umbenennen, da eigene Notizen darauf verweisen können.

Für die Änderung wurden der Produktionsbuild sowie gezielte Integritätsprüfungen für Quellen-Metadaten, atomare Ablehnung ungültiger Änderungen, Projekttrennung und Erhalt eigener Glossardaten beim Backup/Restore verwendet. Es ist keine Datenbankmigration erforderlich.
