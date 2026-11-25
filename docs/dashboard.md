# Anpassbare Projektübersicht

Unter **Übersicht → Übersicht anpassen** können Kacheln ergänzt, entfernt,
verschoben und vergrößert werden. Verschieben erfolgt am Kopfgriff, Vergrößern
an der unteren rechten Ecke. Beide Griffe unterstützen Pfeiltasten. In den
Kacheleinstellungen können Breite und Höhe außerdem numerisch eingegeben werden.
Die Mindestgröße hängt vom Inhalt ab. Andere Kacheln weichen bei Überschneidungen
nach unten aus. Auf schmalen Bildschirmen werden die Kacheln untereinander
angeordnet; die gespeicherte Desktop-Anordnung bleibt bestehen.

**Speichern** übernimmt die gesamte Übersicht. **Verwerfen** verwirft die lokale
Anordnung. **Standard** stellt die ursprünglichen vier Kacheln zunächst als
ungespeicherten Entwurf wieder her. Bei parallelen Änderungen in mehreren
Fenstern verhindert eine Revisionsprüfung das Überschreiben. Die lokale Anordnung
bleibt bei Fehlern erhalten; der gespeicherte Stand lässt sich bewusst neu laden.

Der Katalog enthält Termine, Minikalender, To-dos, angeheftete Notizen,
Rechnungen, Finanzkennzahlen, Angebote, Eigenleistungen, Einkauf, Stunden,
Dokumenteneingang, Fristen sowie Schnellzugriffe. Kacheln können mehrfach
verwendet werden. Der einfache Baukasten bietet Kennzahlen, Listen und
Fortschritte aus festen Datenquellen, mit Text-, Status-, Gewerk- bzw.
Personen-/Monatsfilter je nach Quelle. Es werden keine eigenen Programme,
Formeln oder Datenbankabfragen ausgeführt.

Finanzdefinitionen entsprechen der Finanzierungsübersicht:

- Restbudget Kredit: nicht abgerufenes Kapital plus abgerufenes, unverbrauchtes
  Kapital. Der grüne verbleibende Anteil ist rechts verankert; der verbrauchte
  Bereich wächst von links nach rechts.
- Eigenkapital: aktuell zugeordnete Rechnungszahlungsanteile, ohne manuelle
  Kontobewegungen oder doppelt gezählte Bruttosummen geteilter Zahlungen.
- Ausgaben: Eigenkapital-Rechnungszahlungen plus tatsächlich abgerufenes Kapital.
- Abrufe in Prüfung: noch offene Beträge eingereichter bzw. teilweise
  ausgezahlter Abrufe. Keine vorgezogene Buchung.
- Arbeitsstunden: geleistete Zeiten, ohne geplante Kalenderzeiten.

## Speicherung und Integrität

Die Konfiguration liegt in der projektbezogenen `setting`-Zeile
`dashboard_layout_v1`. Projektbackup, Wiederherstellung und vollständiger
Projektreset erfassen sie über die vorhandenen Projektregeln. Beim Import eines
Backups wird auch das Raster validiert. Migration **0044** erweitert lediglich
das Einstellungsfeld auf `Text`; SQLite benötigt dafür keinen Tabellenumbau.
Vorhandene Werte und Quelldaten bleiben erhalten.

`GET/PUT /api/dashboard/layout` verwendet eine Revision und die gemeinsame
Schreibsperre des Projekts. Der Server prüft Kachelarten, Kennungen, Mindestgrößen,
Rastergrenzen, Überschneidungen, erlaubte Filter und interne Schnellzugriffe.
Neue Notiz-/Personenreferenzen müssen zum aktuellen Projekt gehören. Fehlende,
bereits gespeicherte Referenzen können ersetzt werden, ohne andere Kacheln zu
verlieren.

`GET /api/dashboard/source/<quelle>` liefert nur die angeforderte Datenfamilie.
Gleiche Quellen mehrerer Kacheln teilen ihren Query-Cache. Aktive Kacheln werden
regelmäßig aktualisiert; Bearbeiten des Layouts verändert keine Rechnungen,
Zahlungen oder anderen Quellen. To-dos und Notizen öffnen die vorhandenen
Editoren; Rechnungen und Angebote ihre vorhandenen Detailseiten.
