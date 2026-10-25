# ProjectHouseBuilder – Code-, CSS- und Workflow-Review
Stand: 25.10.2026 · Basis: `feature/synology-nas` · Schwerpunkt: produktive Synology-Version

## Prüfumfang und Einschränkungen

Querschnittsprüfung der acht Anwendungsseiten (Bauzeitenplan, Angebote, Belege, Finanzierung, Kosten, Projektdokumente, Stammdaten, Backup/Daten), ihrer JavaScript- und CSS-Dateien sowie der relevanten Flask-/PostgreSQL-/Backup-/Importpfade. Statische Prüfung von Dialog-IDs und Formularreferenzen, Ereignisbehandlung, Zustandswechseln, Backendvalidierung und CSS-Sichtbarkeit; Python-, JS- und Compose-Tests über GitHub Actions. Diese Prüfung ist **kein Nachweis**, dass alle Ausführungspfade fehlerfrei sind: Es gibt hier keine echte Browser-Session mit deinen Daten, keinen Docker-Image-Build auf der Synology, keinen vollständigen PostgreSQL-Restore-Test und keine automatisierten visuellen Screenshotvergleiche.

## Tatsächlich korrigiert

| Priorität | Befund | Änderung | Nachweis |
| --- | --- | --- | --- |
| Hoch | Kreditdialog konnte während laufender ChatGPT-Analyse geschlossen werden: `loanAiBusy` wurde nie aktiviert. | Busy-Status inklusive `Escape`, Schließen, Speichern, Löschen und wiederholtem Klick abgesichert. | `static/finanzierung.js`, `tests/test_dialog_audit.py` |
| Hoch | Beim Buchen wurden Rechnungskorrekturen und Buchungsstatus in zwei Requests gespeichert. Nach fehlgeschlagener Buchung blieben bereits geänderte Entwurfsfelder stehen. | `PATCH /api/receipts/:id` akzeptiert optional `book_now:true`: sämtliche Felder, Prüfungen, Doppelbuchungsschutz und Buchungsstatus werden **in einer Transaktion** gespeichert oder gemeinsam zurückgerollt. Alter `POST /book` bleibt kompatibel. Bestätigungsdialog liegt vor jeder Änderung. | `app.py`, `static/receipts.js`, `tests/test_receipts_webapp.py` |
| Mittel | Geschlossene Elemente wurden durch CSS-Regeln mit `display:grid/flex` sichtbar, obwohl `hidden` gesetzt war. | Globaler Vorrang für `[hidden]` im App-Scope. | `static/ui.css` |
| Mittel | Kosteneditor und Angebotsbearbeitung konnten mehrfach gespeichert oder während einer laufenden Änderung geschlossen werden. | Busy-Sperre, deaktivierte Aktionen, Fehler im Dialog statt stiller Verlust. | `static/costs.js`, `static/offers.js` |
| Mittel | Mehrere Dialoge hatten keinen zugänglichen Namen, obwohl sichtbare Titel vorhanden waren. | `aria-labelledby` und eindeutige Titel-IDs für Dialoge in Finanzierung, Kosten, Daten, Projektdokumenten und Stammdaten. | `templates/*.html`, `tests/test_dialog_audit.py` |

## Workflow-Audit: Ist-Zustand und empfohlene einheitliche UX

| Fachbereich | Ist-Zustand | Konsistenz-/Verbesserungspotenzial |
| --- | --- | --- |
| Bauzeitenplan | Gantt; Gesamtliste und Historie über separate Dialoge; firmenseitige, suchbare Arbeitspaketzuordnung. | Primäre Aktion oben; sekundäre Aktionen als Menü; Filter und Suchtext beim Wechsel zwischen Gantt und Tabelle bewahren. |
| Angebote | PDF/Manuell importieren; Entwurf prüfen; Angebot bearbeiten; verbindliche Annahme mit optionaler Auftragsbestätigung; Original und endgültiger Bruttoauftragswert getrennt. | Ein gemeinsamer Assistent mit **Datei/Erfassung → Prüfung → Angebot → verbindliche Annahme**, klaren Status-Badges und einem späteren Nachtrags-/Korrekturprozess für bereits fixierte Aufträge. |
| Rechnungen | Upload/Warteschlange; Prüfung/Buchung; anschließend Zahlung mit Finanzierungsquelle. | Einheitlicher Fortschritt **Importiert → Geprüft → Gebucht → Teilbezahlt/Bezahlt**; jeweils nur nächste gültige Aktion anbieten. Legacy-Einträge mit alten, nicht einer Finanzierungsquelle zugeordneten Zahlungen benötigen einen geführten Migrationsdialog. |
| Kredite/Finanzierung | Kreditformular, ChatGPT-Vorausfüllung, Vertragsdokumente, Eigenkapital und Buchungen. Kredit-ChatGPT-Aufruf bleibt innerhalb des Dialogs synchron. | Kredit-Vertragsextraktion als dauerhafter Importauftrag in derselben Warteschlange wie Angebote/Belege; Zwischenergebnisse speichern und beim Seitenwechsel wiederherstellen. Bestehende direkte Formularbearbeitung bleibt Alternative. |
| Kosten | Budgetzeilen, zusätzliche Kosten, Eigenleistung, Förderungen, zugeordnete Dokumente. | Weniger gleichwertige Hauptbuttons; Verbindlichkeiten aus Angeboten klar von manuellen Zusatzpositionen trennen; niemals automatisch doppelt zählen. |
| Dokumente | Allgemeine Unterlagen bearbeitbar; verknüpfte Angebote, Rechnungen, Kredite und Kostenbelege nur ansehen/herunterladen. | Einheitliche PDF-Vorschau/Original-Download-Aktionen; auf Fachunterlagen keine Bearbeiten/Löschen-Steuerung. Dateityp, Herkunft, Datum in allen Listen gleich darstellen. |
| Stammdaten | Firmen/Gewerke/Kategorien mit eigenen Dialogen und Schutz verwendeter Datensätze. | Gleiche Dialogkopf-, Fehler- und Bestätigungspositionen wie in Angeboten/Finanzierung; keine Destruktion ohne Messagebox. |
| Backups/Daten | Zielordnerwahl innerhalb NAS-Mount, ZIP-Backup, Prüfen und Wiederherstellung mit Bestätigungsphrase. | Restore als expliziter geführter Ablauf **Archiv → Integritätsprüfung → Konsequenzen → Wiederherstellen → Abschlusskontrolle** mit deutlich vom normalen Speichern unterschiedlicher Gefahrendarstellung. |

### Einheitlicher Interaktionsvertrag (empfohlen)

1. **Einheitlicher Kopf**: Titel, verständlicher Zweck und Status. Kein zusätzliches X, wenn „Abbrechen/Schließen“ vorhanden ist.
2. **Ein primärer Button** pro Schritt rechts unten (`Prüfen`, `Speichern`, `Verbindlich buchen`); sekundär `Abbrechen`. Löschen räumlich getrennt, mit app-interner Messagebox.
3. **Schrittweise Freigabe statt paralleler Eingabe** bei kosten- oder rechtswirksamen Aktionen. Vor jedem Commit Zusammenfassung und klare Bestätigung.
4. **Busy-Zustand** deaktiviert Submit, Escape/Schließen sowie konkurrierende destruktive Aktionen. Fehler erscheinen im Dialog; bei Erfolg schließen und Liste aktualisieren.
5. **Unsaved-changes-Schutz**: Schließen bei geänderten, aber noch nicht gespeicherten Formularen fordert ausdrücklich „Verwerfen“ an. Das ist **noch nicht global umgesetzt**.
6. **Nur Anzeige an einer Stelle, Bearbeitung am Eigentümer**: Die Dokumentenbibliothek verweist auf Angebote, Rechnungen, Finanzierung und Kosten; dort bleiben alle mutierenden Aktionen.
7. **Status und Beträge**: gleiche Schreibweise und Begriffe überall (`Entwurf`, `Geprüft`, `Angenommen`, `Beauftragt`, `Gebucht`, `Teilbezahlt`, `Bezahlt`). Brutto-Original, Auftragswert, gebuchte Rechnungen, gezahlte Summe und Restbetrag strikt getrennt.

### CSS-Architektur

Die Oberfläche nutzt gleichzeitig `style.css`, `shell.css`, `ui.css`, `workflow-dialogs.css` sowie seitenspezifische Styles. Darin liegen übergreifende `header`, `.panel`, `.modalhead`, `.actions`, `button` und `[hidden]`-Regeln. Genau diese Überschneidungen erklären wiederholte Darstellungsprobleme. Der aktuelle Fix stärkt den sichtbaren Zustand, ist aber keine vollständige CSS-Neustrukturierung.

Empfohlene dauerhafte Reihenfolge: **Tokens & Reset → Shell/Navigation → gemeinsame UI-Komponenten → seitenbezogene Komponenten**. Für Dialoge einen einzigen Stilvertrag (`.phb-dialog`, `.phb-dialog__header`, `.phb-dialog__body`, `.phb-dialog__footer`), einheitliche Responsive-Breakpoints, `min-width:0` für verschachtelte Grids und eine kleine Komponentenbibliothek statt immer neuer CSS-Sonderfälle. Langfristig CSS-Duplikate entfernen und visuelle Browser-Regressionstests für Desktop, Tablet, Mobil und Dunkelmodus ergänzen.

## Verbleibende Risiken – bewusst nicht ohne weitere Integrationsnachweise geändert

**P1 – vor produktiven Wiederherstellungen:**
- `server_backups.restore_postgres`: Datenbank-Swap und Datei-Quarantäne sind sicherheitskritisch. Bisher fehlen CI-Integrationstests mit echtem PostgreSQL 17, während andere Worker/Browser aktiv sind, sowie ein realer Disaster-Recovery-Probedurchlauf.
- `app.py` / Import-Warteschlange: Ein In-Process-Thread hält die Jobs ab. Beim App-Neustart werden laufende Jobs als „Unterbrochen“ markiert; bei mehreren Gunicorn-Workern ist die Eigentümerschaft der Warteschlange pro Prozess zu klären. Standardmäßig ist `WEB_CONCURRENCY=1`; eine robuste, persistente Worker-Architektur bleibt offen.
- Für bereits manuell bezahlte Alt-Rechnungen kennt die neue Zahlungsansicht keinen automatischen Zuordnungsassistenten. Vorhandene Werte dürfen nicht blind auf ein Konto umgebucht werden.

**P2 – geplante UX-/Wartbarkeitsverbesserungen:**
- Konsistente `dirty-form`-Warnung bei ungespeicherten Änderungen in **allen** Editoren. Derzeit verhindern Busy-Sperren nur den Verlust **während** des Speicherns.
- Kredit-Dokumentanalyse in die persistente Hintergrundwarteschlange überführen; aktueller Dialog muss bis zum Ergebnis geöffnet bleiben.
- Angebote mit geänderter Auftragsbestätigung: kontrollierter Nachtragsprozess einschließlich Änderungshistorie statt manuelles Entsperren.
- Betragsberechnung weiter auf `Decimal` zentrieren: Einige Kostenplan-Spalten sind noch `Float`; dies ist ein Migrationsprojekt, kein sicherer CSS-Hotfix.
- Dynamische End-to-End-Browsertests für Dialogöffnung, Schließen per Escape, Scrollverhalten und PDF-Vorschau; aktuelle Tests prüfen hauptsächlich API, DOM-Struktur und JS-Syntax.
- Barrierefreiheit: Fokus-Rückgabe und Meldungen für dynamisch erzeugte Dialoge testen sowie Tastaturbedienung von Listen, Suche und Wizards.

## Release-/Abnahmekriterien

- GitHub-Actions: Python-Regressionstests, JS-Syntax, Docker-Compose-Struktur.
- Synology: OCR-Komponenten/Sprachen auf dem **laufenden** App-Image prüfen, echte PDFs aus Angebot und Rechnung lesen und Ergebnisse manuell gegen das Original validieren.
- Finanzen: Testdatensatz mit **Entwurf → fehlerhafte Buchung (Rollback) → erfolgreiche Buchung → Teilzahlung → Restzahlung → Storno**.
- Angebote: **Prüfen → 1:1 annehmen** und **Auftragsbestätigung mit anderem Betrag → Kostenprognose/Rechnungsabgleich** testen.
- UI: 360, 768 und 1440 px, Hell/Dunkel; alle Dialoge, PDF-Split-Views, Schließen/Abbrechen, Fokus und Fehlermeldungen.
- Backup: vollständige Sicherung und **getestete** Wiederherstellung auf einem isolierten Testsystem vor produktivem Restore.

**Wichtig:** Ein grüner CI-Lauf ersetzt weder die echte Synology-Containerprüfung noch den visuellen Test mit deinen Belegen.
