# Umsetzung des freigegebenen Refactorings

Die Freigabe „setze alles um“ umfasst R01–R12 aus der [Bestandsaufnahme](REFACTORING_REVIEW_2026-11-02.md). Mantine, die Projekttrennung und die fachlichen Freigabeschritte bleiben bestehen. Eine neue UI-Bibliothek wurde nicht eingeführt.

| Punkt | Umsetzung |
|---|---|
| R01 | Gemeinsamer Transport in `static/request.js` für React und klassische Masken, JSON-API-Fehler einschließlich 413, verständliche Proxy-/Netzwerkfehler, Zeitgrenzen und Statusprüfung unbestätigter Finanzvorgänge. Keine automatische Wiederholung von Schreiboperationen. |
| R02 | `validation.py` definiert strikte Datumswerte und ausdrücklich erlaubte Import-Zeitstempel. Datumszusätze und ungültige Kalendertage werden abgewiesen. Finanzierungsformulare nutzen denselben Vertrag. |
| R03 | Datensatz-Fingerprints werden bei der Datenübertragung mitgeführt und beim Bearbeiten über `If-Match` geprüft. Der ursprüngliche Formularstand bleibt auch bei späteren Hintergrundabfragen erhalten. Konflikte zeigen aktuelle und eigene Werte; eigene Felder lassen sich gezielt übernehmen, gleichzeitige Änderungen am selben Feld benötigen eine ausdrückliche Auswahl. Alternativ können Eingaben kopiert oder verworfen und der aktuelle Stand geladen werden. Archivbefehle und Projekttitel-/Beschreibungsänderungen bleiben unabhängig. |
| R04 | Finanzanfragen bekommen dauerhafte Vorgangskennungen. Eine verlorene Antwort kann abgefragt und dieselbe Anfrage mit derselben Kennung wiederholt werden, ohne doppelt zu buchen. Gewollte neue Buchungen erhalten neue Kennungen. Schreibzugriffe auf gemeinsames Projektguthaben werden über Datenbanksperren serialisiert. Beim Zurücksetzen/Wiederherstellen werden alte Vorgangsbestätigungen ungültig statt blind wiederverwendet. |
| R05 | `frontend/src/ui.tsx`, `static/components.js` und `static/components.css` liefern gemeinsame Aktionsleisten, Status, Suche, Zeilenaktionen, Quellenbuttons und Dokumentvorschau. Bestehende Fachlayouts werden damit schrittweise vereinheitlicht; native und eingebettete Ansichten nutzen dieselben Farben und Abstände. |
| R06 | Gemeinsame fachliche Förderkriterien in `funding_rules.py` unterscheiden frühe Planung und antragsnahe Fachbestätigung. Formulare zeigen geänderte Geldwerte/Zuordnungen vor dem Speichern. Nach Anlegen einer Firma führt der Rückweg zum Rechnungsentwurf; bei leerem Lieferantenfeld wird die neue Firma vorgeschlagen, ohne automatisch zu buchen. |
| R07 | Arbeitspakete und Tabellen-Hauptaktionen sind echte Tastaturbuttons. Sichtbarer Fokus, beschriftete Quellenbuttons und korrekt geschlossene Konflikthinweise ergänzen die vorhandene Dialog-Fokusrückgabe. |
| R08 | `money_values.py` zentralisiert Decimal-Arithmetik und die Cent-Rundung nach `ROUND_HALF_UP`. Budget-, Prognose- und Kostensummen verwenden diesen Rechenweg. Ältere Float-Geldspalten werden in Numeric-Speicher überführt; zwölf Nachkommastellen behalten vorhandene Netto-/Einheitspreise bei. Stunden, Mengen und Prozentsätze werden nicht als Geld migriert. Bestehende Belege werden nicht neu kalkuliert. |
| R09 | Importaufträge werden atomar über die Datenbank übernommen. Laufzeitkennungen und Heartbeats verhindern parallele Ausführung; ein alter Worker kann nach Verlust seiner Kennung keine Fachdaten mehr schreiben. Wartende neue Aufträge können weiterverarbeitet werden; unterbrochene laufende KI-Aufträge werden nicht stillschweigend erneut gesendet. Auch Förderprüfungen haben prozessübergreifende Leases. Restore/Reset verwenden zusätzlich eine Betriebssystem-Dateisperre und atomar geteilte Statusmeldungen. Gunicorn startet die Queue-Verarbeitung nach dem Fork pro Worker. |
| R10 | Such-/Filterzustände werden projektspezifisch gespeichert. Quellenzähler behalten ihre bisherige Bedeutung und erklären im Tooltip ausdrücklich, dass erledigte, nicht archivierte To-dos mitgezählt werden. Das Dashboard zählt weiterhin ausdrücklich offene To-dos. |
| R11 | GitHub Actions führt die vorhandenen kritischen Browserwege sowie Bildvergleiche aus. Acht Referenzansichten decken Projekt- und Rechnungskacheln in Hell/Dunkel und bei 390/1440 px ab. Fehlerbilder und Traces werden als Artefakte gesammelt. |
| R12 | Datenmodelle liegen in `domain_models.py`; Planung, Angebote, Rechnungen, Dokumente, Kosten/Stammdaten, Importe und Administration in `services/`. `app.py` ist die deutlich kleinere Kompositionswurzel. Die früheren Einstiegspunkte bleiben für Tests und Integrationen erreichbar. Die große React-Seitendatei wurde in Fachmodule aufgeteilt; gemeinsame Layouts, UI-Bausteine und API-Fachtypen liegen separat. |

## Daten und Migration

Revision **0031** ergänzt technische Vorgangsbelege und Worker-Leases sowie den Numeric-Speicher für bisherige Float-Geldspalten. Die normalen Starter erstellen vor einem bestehenden Schema-Upgrade weiterhin eine geprüfte Systemsicherung. Ein direkter PostgreSQL-Start prüft vor der Geldspalten-Konvertierung ebenfalls die Sicherheitssicherung. Das ist eine administrative Systemsicherung; die Backup-UI bleibt strikt projektbezogen.

`phb_operation` und `phb_work_lease` sind technische Laufzeitdaten außerhalb der fachlichen Projektarchive. Projektbackups vor 0031 erhalten beim Lesen ausschließlich die bekannten fehlenden Import-Leasefelder mit leeren Standardwerten. Unbekannte Tabellen-/Spaltenabweichungen werden weiterhin abgewiesen. Fachliche IDs, Beziehungen und Historien bleiben erhalten.

## API-Vertrag

- JSON-Antworten können zusätzlich `_versions` enthalten: kanonischer Datensatzpfad → Fingerprint. Die gemeinsame UI-Transportschicht verarbeitet diese Metadaten und entfernt sie vor der Übergabe an bestehende Formularmodule.
- Bearbeitungen können den ursprünglichen Fingerprint als `If-Match` senden. Veraltete Inhalte ergeben HTTP 409 mit `code=edit_conflict`; Fremdprojekte werden auch in Vergleichsdaten nicht offengelegt. Bestehende API-Integrationen ohne den Header bleiben kompatibel.
- Finanzmutationen verwenden `Idempotency-Key`. Gleiche Kennung und Eingaben liefern denselben Erfolg samt ursprünglicher Revision. Eine Kennung mit anderen Eingaben wird abgewiesen. Ein noch ungeklärter Vorgang wird nicht ein zweites Mal ausgeführt.
- Erfolgreiches Speichern aktualisiert die Formularrevision auch bei unveränderten Eingabewerten. Das Zuordnen einer Förderunterlage liefert außerdem den exakten Versionsübergang der betroffenen Förderung; nur dazu passende offene Formulare übernehmen diese eigene Nebenwirkung. Fremde Änderungen bleiben konfliktpflichtig. Nicht gespeicherte Förderangaben bleiben beim Unterlagenupload erhalten.
- `GET /api/operations/<key>` liefert den projektspezifischen Ausgang. Ein Verbindungsabbruch ist kein Beweis für eine fehlgeschlagene Buchung; die UI fordert deshalb zur Status-/Bestandsprüfung auf.

## Projektstart im Gantt

Das Bestätigungsfenster erscheint beim Verlassen des Datumsfelds. Es nennt die konkrete Tagesdifferenz einschließlich Richtung, zum Beispiel „12 Tage nach hinten (+12 Tage)“. Nach Bestätigung verschiebt der Server Start und optionales Ende aller Bauphasen sowie früheste Starts und geplante Enden aller Arbeitspakete um dieses Delta. Die berechneten Arbeitspakettermine folgen entsprechend; Dauer und Abhängigkeiten bleiben erhalten. Auch Arbeitspakete ohne Bauphase werden berücksichtigt. Ist-Termine, Abschlussdaten und andere Projekte werden nicht geändert.

Die Verschiebung ist nun auch ohne explizites `shift_plan` der Standard von `PATCH /api/project`. Bestehende Integrationen können weiterhin ausdrücklich `shift_plan: false` angeben. Abbrechen verändert keine Daten. API- und Browserprüfungen decken positive/negative Deltas, Schalttage, offene Enden, abgeschlossene Pakete, Projektgrenzen und den Rückweg zum ursprünglichen Start ab.

## Wiederholbare Prüfungen

```sh
DATABASE_URL=sqlite:///:memory: PHB_CHATGPT_HOME=/tmp/phb-test-auth .venv/bin/python -m unittest discover -s tests
npm --prefix frontend test
npm --prefix frontend run build
node --test tests/workflow_runtime.test.cjs
.venv/bin/python dev/ui_browser_smoke.py
.venv/bin/python dev/funding_plan_browser_smoke.py
```

Die Browserstarter erzeugen eigene temporäre Datenbanken, Dokumente und Backupziele. `tests/browser_request_safety.cjs` prüft zwei echte Tabs, Feldkonflikte, das bewusste Übernehmen eines Feldes, einen serverseitig gespeicherten Zahlungsvorgang mit verlorener HTTP-Antwort und die anschließende sichere Wiederholung. `tests/test_runtime_concurrency.py` prüft getrennte SQLite-Sitzungen und eine unabhängige Prozesssperre. Der PostgreSQL-17-Lauf prüft zusätzlich gemeinsame Kontoguthaben, Wiederholungskennungen und veraltete Schreibstände.

Referenzbilder werden nur bewusst mit `UPDATE_SCREENSHOTS=1 .venv/bin/python dev/ui_browser_smoke.py visual` erneuert. Der normale CI-Lauf vergleicht und verändert sie nicht. Die Bildtests verwenden eine feste Schrift und synthetische Daten, damit Uhrzeit, OCR, KI und zufällige Datensatz-IDs die Prüfung nicht verfälschen.

Echte Bankeinreichungen und echte KI-Aufrufe werden durch die Tests nicht ausgelöst. Die konkrete Mac-/NAS-Installation benötigt nach dem Update weiterhin den normalen Neustart und das Schema-Upgrade; sie wurde in dieser Umgebung nicht fernbedient.

## Ergebnis der Abschlussprüfung

- 444 Python-Tests erfolgreich, einschließlich alter Projektarchive, Projektgrenzen, konkurrierender Buchungen und des Projektstart-Deltas.
- Frontend-Typecheck/Produktionsbuild, 7 Frontend-Tests und 5 Workflow-Runtime-Tests erfolgreich; JavaScript-Syntax und Patch-Format geprüft.
- Kritische Browserwege für Navigation, Projekte/Archiv/Löschen, Rechnungen, Förderunterlagen/-planung, Projektbackups/Restore/Reset und Bearbeitungskonflikte erfolgreich. Der neue Projektstart-Test bestätigt Blur, Abbruch, positive/negative Verschiebung und Schalttag im tatsächlichen Gantt.
- Alle 8 Bildvergleiche ohne Erneuern der Referenzen erfolgreich, in Hell/Dunkel und Mobil/Desktop.
- PostgreSQL 17: frische Initialisierung, Altschema einschließlich Float-zu-Numeric-Konvertierung, Projektsicherung/-wiederherstellung, gemeinsame Kontoguthaben, Vorgangskennungen und veraltete Formularstände erfolgreich geprüft.
- Der vollständige Docker-Image-Build konnte hier wegen fehlgeschlagener Debian-Paketdownloads nicht abgeschlossen werden. Der Frontend-Build ist lokal erfolgreich; die Docker-Stufe kopiert nun zusätzlich die gemeinsam importierten statischen Ressourcen. Der bestehende Docker-/OCR-CI-Job bleibt aktiv.
