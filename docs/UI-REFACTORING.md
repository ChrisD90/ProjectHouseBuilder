# UI- und Workflow-Bereinigung

Stand: 19.11.2026, Branch `feature/projektkalender`.

## Gemeinsame Bausteine

- `frontend/src/ui.tsx`: `ActionBar` ist die gemeinsame Footer-Aktionsleiste, auch für Projekte, Förderunterlagen, Förderplanung und To-Dos/Notizen. Primäre Aktionen stehen rechts; vorhandene sekundäre Aktionen bleiben links. Das parallele native `.actions`-CSS entfällt. Klassische eingebettete Seiten behalten ihren eigenen `.actions`-Vertrag.
- `ActionCount` und `.phb-corner-action`: gemeinsame Position, Größe und Abstände für die Zähler-/Icon-Aktionen der Eigenleistungen, zugehörigen To-Dos und offenen Rechnungen. Rot kennzeichnet Handlungsbedarf; Belegzähler verwenden weiterhin die Akzentfarbe. To-Do-Zähler berücksichtigen weiterhin ausschließlich offene, nicht archivierte To-Dos.
- `static/components.css`: gemeinsame Scrollregion für Stammdaten, Dokumente, Eigenleistungen, Werkstatt-Einträge und Zeiterfassung. Die fachlichen Bereiche bestimmen weiterhin ihre Raster und Höhen. Statuspillen übernehmen die tatsächliche Mantine-Statusfarbe und haben eine passende Mindesthöhe.
- Suchsymbole lassen den Klick zum Eingabefeld durch. Belegübersichten verwenden die zentralen Datumseinstellungen und richten Geldbeträge sowie die zugehörigen Tabellenüberschriften rechts aus.

## Prozesse und Altlasten

- Die normale Rechnungsbearbeitung ist der einzige sichtbare Weg, um fachliche Zuordnungen zu ändern. Der nie eingeblendete separate Zuordnungskorrekturmodus inklusive seiner drei Buttons, Handler und ungenutzten Zustandsvariable wurde entfernt. Die Backend-Schnittstelle bleibt für bestehende Clients erhalten.
- Ein redundanter Upload-Auswahllistener und der verbliebene Link zum ausgeblendeten Skonto-Werkzeug entfallen.
- Der gemeinsame Upload-Service schützt den Vordergrund-/Hintergrundwechsel davor, dass ein zweiter Aufruf den laufenden Controller überschreibt. Bereits eingereihte Hintergrundaufträge laufen weiter.
- Persistierte Ansichtspräferenzen wechseln beim Wechsel der Route korrekt mit und verwerfen gespeicherte Werte mit unpassendem Typ, einschließlich `null` und Array-/Objekt-Verwechslungen.
- 15 ungenutzte Imports und vier nachweislich unreferenzierte native CSS-Klassen wurden entfernt. Der TypeScript-Build prüft ungenutzte lokale Variablen und Parameter künftig verbindlich.
- Identische, später nochmals wirksame CSS-Deklarationen wurden in Angebote, Belege, Backups, altem Gantt und gemeinsamem klassischen UI entfernt. Abweichende Breakpoint-Regeln und Spezifitätskorrekturen bleiben bestehen.

## Bewusst erhalten

Historische Arbeitspakete/Bauphasen, Kostenplan-Verknüpfungen, frühere Zahlungen und ausgeblendete Werkstatt-Datensätze sind keine automatisch löschbaren Altlasten. Ihre Lesepfade, Projekttrennung, Backupdaten und Deep Links bleiben erhalten. Es gibt keine Datenmigration, keine Datenbereinigung und keine Änderung an Kosten- oder Finanzierungsberechnungen.

## Prüfung

Gezielt auf Prozessintegrität und Datensicherheit begrenzt:

- Produktionsbuild mit TypeScript-Prüfung, einschließlich ungenutzter Imports/Variablen/Parameter.
- Vier vorhandene Backend-Prüfungen: Zuordnungsänderung bei gebuchten/stornierten Belegen, atomarer Rollback einer fehlgeschlagenen Buchung, Wechsel der Eigenleistungszuordnung ohne Geldänderung und Isolation von Operationen/Revisionen zwischen Projekten.
- Vier vorhandene API-Grenzprüfungen sowie die vorhandene Workflow-Laufzeitprüfung für Dialogzustände/Sperren.
- Syntaxprüfung des geänderten klassischen Rechnungsskripts und `git diff --check`.

Keine vollständige visuelle Browser-Testserie; Layout und Ausrichtung wurden anhand der betroffenen Komponenten und der CSS-Kaskade geprüft.
