# Refactoring-Vorschläge zur Auswahl

Stand: 02.11.2026 · Branch `feature/react-mantine-ui`

## Umfang und bereits ausgeführte Änderung

Nur der ausdrücklich gewünschte Rechnungsbutton wurde umgesetzt: To-dos/Notizen stehen innerhalb der Rechnungskachel direkt rechts neben dem Status, mit dem bisherigen Zähler und dem bisherigen Dialog. Status und Button sind gemeinsam ausgerichtet; es gibt keine ineinander verschachtelten Buttons.

**Historische Bestandsaufnahme vor Freigabe.** Alle Punkte wurden anschließend freigegeben; der aktuelle Stand ist in [Umsetzung R01–R12](REFACTORING_IMPLEMENTATION_2026-11-02.md) dokumentiert. „Nachgewiesen“ bedeutet durch Code und einen isolierten Lauf bestätigt. „Risiko“ bezeichnet eine konkrete technische Schwachstelle ohne nachgewiesenen Schaden an Nutzerdaten. „Verbesserung“ ist eine Änderung an Gestaltung, Ablauf oder Wartbarkeit.

Die Bestandsaufnahme umfasst Projekte und Backups, Bauzeitenplan, Angebote, Rechnungen, Finanzierung/Mittelabrufe, Förderplanung, Stammdaten, Dokumente, To-dos/Notizen sowie die gemeinsamen UI-, API- und Jobmechanismen. Geprüft wurden Quellcode, vorhandene Tests und isolierte Abläufe. Reale Bankvorgänge, eine echte ChatGPT-Verbindung und die konkrete Mac-/NAS-Installation waren nicht Teil dieser Prüfung.

## R01 – Verständliche Fehler und Wiederherstellung bei Verbindungsproblemen

**Priorität: hoch · Nachgewiesener Fehler und ergänzende Verbesserung**

Ein übergroßer Upload kann HTTP 413 als HTML liefern. Der React-API-Client ruft dagegen ohne Prüfung `r.json()` auf. Damit kann eine technische JSON-Fehlermeldung die eigentliche Erklärung „Datei zu groß“ verdecken. Isoliert reproduziert durch Herabsetzen des Uploadlimits: `/api/receipts` liefert `413 text/html`.

Vorschlag: einheitliche JSON-Fehler für API-Endpunkte einschließlich 413/500, robuste Behandlung nicht als JSON gelieferter Proxyfehler und klarer Status bei unterbrochenen Verbindungen. Zeitgrenzen und „Status erneut prüfen“ ergänzen. Schreiboperationen bei unklarem Ergebnis **nicht automatisch erneut absenden**; zunächst ihren Zustand ermitteln. Dafür ist R04 relevant.

Belege: `frontend/src/core.tsx` (`api`), `app.py` (`MAX_CONTENT_LENGTH` und Fehlerbehandlung). Abnahme: zu große Datei, Proxy-HTML, Verbindungsabbruch und verspätete Antwort verständlich anzeigen; Formularinhalt erhalten.

## R02 – Datums- und Feldvalidierung vereinheitlichen

**Priorität: hoch · Nachgewiesene Validierungslücke**

`parse_date` schneidet Eingaben auf zehn Zeichen ab. `2027-03-01unerwarteter-Text` wird dadurch als gültiges Datum akzeptiert. Andere Module prüfen ihre Datumswerte strenger.

Vorschlag: klare Verträge für Datum und Zeitstempel, dieselben Feldregeln in Formular und API sowie Fehlermeldungen unmittelbar am betreffenden Feld. Bestehende Importe, die echte Zeitstempel liefern, ausdrücklich berücksichtigen, statt überall blind die Parser auszutauschen.

Belege: `app.py` (`parse_date`), `financing.py` (`iso_date`), `funding_plans.py`. Abnahme: ungültige Tage, Schaltjahre, Datumszusätze, leere optionale Felder und bestehende Importformate.

## R03 – Gleichzeitiges Bearbeiten in mehreren Tabs absichern

**Priorität: hoch · Risiko**

Der Gantt-Plan und Förderberichte verfügen bereits über Prüfungen ihrer Bearbeitungsgrundlage. Gewöhnliche Formularänderungen, etwa bei Stammdaten oder Rechnungsdaten, nutzen dagegen nicht durchgängig eine Versionsprüfung. Ein späteres Speichern eines älteren Formularstands kann neuere Änderungen überschreiben. Die Korrektur des Archivstatus aus dem vorherigen Update schützt einen speziellen Fall, ersetzt aber keinen allgemeinen Konfliktschutz.

Vorschlag: Änderungsnummer oder ETag beim Laden/Speichern; bei Konflikten Unterschiede anzeigen und gezielt neu laden oder übernehmen lassen. Keine stillschweigende Überschreibung.

Belege: `multi_projects.py`, `app.py` (Belegbearbeitung), `frontend/src/projects.tsx`, vorhandene Gantt-/Förder-Fingerprints. Abnahme: zwei Tabs mit demselben Datensatz; unabhängige Änderungen verschiedener Projekte bleiben unbeeinflusst.

## R04 – Wiederholte Finanzanfragen eindeutig erkennen

**Priorität: hoch · Nachgewiesenes Verhalten mit Wiederholungsrisiko**

Zwei identische Teilzahlungs-POSTs über jeweils 100 € für eine offene 1.000-€-Rechnung werden als zwei Zahlungen gespeichert: beide antworten mit 201, bezahlt sind danach 200 €. Das kann zwei gewollte Zahlungen darstellen. Bei einer Wiederholung nach verlorener Antwort ist es jedoch derselbe fachliche Vorgang, den der Server ohne Vorgangskennung nicht unterscheiden kann. Die vorhandenen Rechnungs-Sperren und Überzahlungsprüfungen bleiben wichtig, lösen diese Unterscheidung aber nicht.

Vorschlag: eine eindeutige Vorgangskennung pro Buchungsaktion, die bei Wiederholungen dasselbe Ergebnis zurückgibt. Gewollte weitere Zahlungen erhalten neue Kennungen. Zusätzlich Parallelfälle prüfen, in denen verschiedene Rechnungen dasselbe Kredit-/Eigenkapitalguthaben beanspruchen; die bisherige Ledger-Prüfung beibehalten und bei Bedarf gemeinsame Kontosperren ergänzen.

Belege: `financing.py` (`finance_payment_create`, `validate_ledger`, Kreditverwendungen), `loan_drawdowns.py`. Der Parallelzugriff auf gemeinsame Konten ist ein Prüfauftrag, kein bereits reproduzierter Fehlbestand. Abnahme: Wiederholung nach Antwortverlust, zwei echte identische Teilzahlungen, konkurrierende Verwendungen unter PostgreSQL und SQLite, Rücknahme und Storno.

## R05 – Gemeinsame UI-Bausteine statt weiterer CSS-Sonderfälle

**Priorität: mittel · Architektur und Verbesserung**

Mantine/React stellt den Rahmen und mehrere Fachbereiche bereit; Angebote, Rechnungen, Gantt und Finanzierung verwenden teilweise weiterhin eingebettete klassische Seiten und eigene Dialogsteuerungen. Mehrere Stylesheets überschreiben dieselben Komponenten. Die erneute Rechnungskachel-Korrektur zeigte beispielsweise eine ältere Status-Margin, die mit der neuen Ausrichtung kollidierte.

Vorschlag: gemeinsame Bausteine für Kachelkopf, Status, Quellenbutton/Zähler, Dialogkopf, Aktionsleiste, Suche und PDF-Vorschau. Einheitliche Größen, Abstände, Breakpoints und Farben festlegen. Klassische Seiten schrittweise darauf umstellen; größere React-Migrationen jeweils separat auswählen. **Mantine beibehalten**, kein weiterer Bibliothekswechsel und kein Komplettneubau in einem Schritt.

Belege: `frontend/src/shell.tsx`, `frontend/src/core.tsx`, `static/embed.js`, `static/buttons.css`, `static/ui.css` und Fachstyles. Abnahme: Desktop/Mobil, Hell/Dunkel, lange Texte, gestapelte Dialoge und unveränderte Buchungsabläufe.

## R06 – Eingabeabläufe und Folgewirkungen konsistent führen

**Priorität: mittel · Workflow-Verbesserung**

Es gibt bereits funktionierende Entwürfe, Schritte und Rücksprünge. Die Details werden aber pro Fachbereich separat organisiert. Auch die frühe Förderplanung und die Schätzung bei einer manuell erfassten Förderung verwenden unterschiedliche Prüfoberflächen und unterschiedlich strenge Voraussetzungen.

Vorschlag: einheitliches Muster „Entwurf → Prüfen → Verbindliche Aktion“, klare Trennung zwischen fehlenden Pflichtangaben und fachlichen Vorbehalten, konsistenter Rückweg nach dem Anlegen einer Firma sowie eine verständliche Vorschau bei Änderungen mit Auswirkungen auf Kosten oder Zahlungen. Förderregeln nach Prüfphase gemeinsam definieren; frühe Orientierung nicht versehentlich durch Anforderungen für eine spätere Antragstellung blockieren.

Belege: `static/receipts.js`, `static/offers.js`, `frontend/src/funding-plan.tsx`, `frontend/src/funding-check.tsx`, `funding_plans.py`, `funding_estimates.py`. Abnahme: Entwurf verlassen und fortsetzen, neue Firma anlegen und zurückkehren, bestehende Zuordnungen und eingegebene Werte behalten.

## R07 – Tastaturbedienung und Fokus vervollständigen

**Priorität: mittel · Nachgewiesene Bedienlücke**

Einige Gantt-Beschriftungen und Tabellenzeilen öffnen Details über Klickhandler auf `div`/`tr`, ohne entsprechende eigene Tastaturaktion. Andere Elemente, insbesondere Gantt-Balken und Bauphasenbuttons, sind bereits über die Tastatur erreichbar. Hier besteht eine uneinheitliche Abdeckung, kein vollständiges Fehlen der Tastaturbedienung.

Vorschlag: echte Buttons/Links für die Hauptaktion, sichtbarer Fokus, nachvollziehbare Beschriftungen der Iconbuttons und Rückgabe des Fokus nach dem Schließen gestapelter Dialoge. Status und Fehler auch ohne Farbe verständlich machen.

Belege: `static/app.js` (`renderTable`, Gantt-Beschriftungen), `frontend/src/core.tsx`, `static/phb-workflow.js`. Abnahme: vollständiger Durchlauf mit Tab, Enter, Leertaste und Escape; keine verschluckten Eingaben oder Fokusverluste.

## R08 – Geldberechnungen zentralisieren

**Priorität: mittel · Risiko und technische Verbesserung**

Finanzbuchungen nutzen an vielen Stellen bereits Decimal/Numeric. Ältere Kostenfelder sind dagegen noch Float, und die Budgetaggregation wandelt Beträge teilweise in Float um. Das ist kein Nachweis einer falschen vorhandenen Buchung, schafft aber unterschiedliche Rundungswege.

Vorschlag: verbindliche Rundungsregeln und eine gemeinsame Berechnungsschicht; anschließend, falls gewünscht, kontrollierte Migration der betroffenen Geldfelder. Stunden/Dauern nicht pauschal als Geld behandeln. Historische Beträge nicht ungeprüft neu berechnen.

Belege: `app.py` (`CostItem`, `budget_summary`), `financing.py`, `financials.py`. Abnahme: Netto/Brutto, Teilzahlungen, Abschlagsverrechnung, Summen vieler Positionen, Storno und identische Ergebnisse über alle Übersichten. Schemaänderung separat mit geprüftem Backup.

## R09 – Hintergrundverarbeitung bei mehreren Serverprozessen absichern

**Priorität: später, vor Skalierung · Betriebsrisiko**

Importaufträge sind gespeichert, ihre Ausführung wird aber über eine prozesslokale Queue, Threads und Locks gesteuert. Der Dockerstandard verwendet bewusst einen Gunicorn-Worker. Mehrere Threads sind nicht dasselbe wie mehrere Prozesse; die bestehende Konfiguration ist daher nicht pauschal als fehlerhaft zu bewerten.

Vorschlag: vor einer Erhöhung der Workerzahl atomare Jobübernahme über die Datenbank, Besitzer-/Laufzeitkennung und nachvollziehbare Wiederaufnahme oder Abbruchzustände ergänzen. Bereits ausgelöste KI-Anfragen nicht automatisch erneut kostenpflichtig ausführen. Erst danach entscheiden, ob eine separate Worker-Infrastruktur überhaupt nötig ist.

Belege: `app.py` (`_import_queue`, `_import_guard`, `_start_import_worker`), `Dockerfile`, `funding_plans.py` (`_running`). Abnahme: Neustart während OCR, zwei Prozesse, unterbrochene KI-Antwort und konsequente Projektbindung.

## R10 – Filter, Zähler und Begriffe vereinheitlichen

**Priorität: mittel · Produktentscheidung**

Die Quellenbuttons zählen derzeit nicht archivierte To-dos einschließlich erledigter Einträge; das Dashboard zählt offene To-dos. Beide Definitionen sind implementiert, wirken ohne Erklärung aber unterschiedlich. Rechnungsfilter liegen in lokalen UI-Variablen und überstehen nicht jede vollständige Neuladung.

Vorschlag: Zählerbedeutung im Tooltip klar benennen oder nach Entscheidung überall nur offene To-dos zählen. Such-/Filterzustände und Listenauswahl je Projekt in URL oder projektspezifischem Speicher erhalten. Gemeinsame Begriffe für Entwurf, gebucht, bezahlt, nicht zugewiesen, eingereicht und bankbestätigt verwenden, ohne fachlich verschiedene Status zusammenzuwerfen.

Belege: `static/project_work.js`, `multi_projects.py` (Dashboardzähler), `static/receipts.js` (Filter), `frontend/src/work.tsx`. Abnahme: Reload, Zurücknavigation, Archiv/Erledigt-Filter und zwei Projekte in separaten Tabs.

## R11 – Browser- und Bildprüfungen fest in CI integrieren

**Priorität: hoch, vor größeren UI-Änderungen · Nachgewiesene Testlücke in CI**

Es existieren zahlreiche ausführbare Browserprüfungen, darunter Projektgrenzen, Förderplanung und Rechnungsabläufe. Der aktuelle GitHub-Workflow führt Python, Frontend-Unit-Tests, Build, JS-Syntax, PostgreSQL-Integration, OCR und Compose-Prüfungen aus, aber nicht diese Playwright-Browserabläufe. Das bedeutet nicht, dass Browserprüfungen fehlen; ihre automatische Ausführung bei jedem Update fehlt.

Vorschlag: einen isolierten Browserjob mit eigenem Testserver hinzufügen. Kritische Wege und ausgewählte Bildvergleiche bei mobilen und großen Ansichten in Hell/Dunkel festschreiben. Wenige stabile Referenzansichten bevorzugen; volatile KI-/Datumsinhalte gezielt ersetzen.

Belege: `.github/workflows/tests.yml`, `tests/browser_*.cjs`, `dev/funding_plan_browser_smoke.py`. Abnahme: absichtlich verschobener Button, offener falscher Dialog und gebrochener Rücksprung werden vor Veröffentlichung erkannt.

## R12 – Backend und Fachseiten in überprüfbaren Schritten zerlegen

**Priorität: nach Absicherung durch R11 · Wartbarkeit**

`app.py` umfasst derzeit rund 5.400 Zeilen und `frontend/src/pages.tsx` rund 1.700. Viele Formulardaten werden mit dem allgemeinen Typ `Row` statt konkreten Fachtypen transportiert. Ältere Architekturdokumente beschreiben teilweise noch Zustände vor der React-Umstellung und späteren Workflow-Erweiterungen.

Vorschlag: Fachmodule für Planung, Angebote, Belege, Dokumente und Administration mit klaren Transaktionsgrenzen extrahieren. Fachtypen und gemeinsame API-Verträge einführen. Veraltete Architekturhinweise konsolidieren. Erst mechanisch ohne Funktionsänderung aufteilen, anschließend getrennt fachliche Verbesserungen vornehmen.

Belege: `app.py`, `frontend/src/pages.tsx`, `frontend/src/core.tsx` (`Row`), `docs/UI_WORKFLOW_ARCHITECTURE.md`, `docs/CODE_UX_REVIEW_2026-10-25.md`. Abnahme: dieselben APIs, Ergebnisse, Projektgrenzen und Nutzerwege vor und nach jedem Teilschritt.

## Bereichsübergreifende Einordnung

| Bereich | Beibehalten | Passende Vorschläge |
|---|---|---|
| Projekte, Archiv, Backups | Projektbindung, Sicherheitsabfragen, geprüfte Sicherung vor Reset/Restore | R03, R05, R11, R12 |
| Bauzeitenplan | Phasenhierarchie, Abhängigkeiten, Plan-Fingerprint, bestehende Titel | R02, R05, R07, R10 |
| Angebote | Bearbeitbarkeit, Annahme/Rücknahme, Zuordnungen und Quellen-To-dos | R03, R05, R06 |
| Rechnungen | Entwurf, verbindliche Buchung und Zahlung als getrennte Vorgänge | R01–R08, R10 |
| Kredite/Eigenkapital/Mittelabrufe | Keine Buchung vor Bankbestätigung, manuelle Alternative, Ledger-Prüfung | R03, R04, R06, R08 |
| Förderplanung | Einwilligung, unverbindliche Schätzung, Checklisten-Sprünge und Aktualitätsprüfung | R01, R05, R06, R09 |
| Dokumente/Uploads | Projektbezogene Originale, Vorder-/Hintergrundwahl und Prüfung vor Übernahme | R01, R05, R09 |
| Firmen/Stammdaten | Getrennte Projektlisten, Gewerkabhängigkeit und optionale KI-Ergänzung | R02, R03, R06 |
| To-dos/Notizen | Verknüpfungen, Erledigen, Archivieren und zentraler Zugriff | R05, R07, R10 |
| ChatGPT und Betrieb | Verbindungs-/Einwilligungsprüfung, bestehende Diagnosen | R01, R09, R11 |

## Empfohlene Reihenfolge zur Entscheidung

1. **Zuverlässigkeit:** R01, R02, R03, R04; R11 als begleitende Absicherung.
2. **Einheitliche Bedienung:** R05, R06, R07, R10, jeweils pro Bereich abnehmen.
3. **Größere technische Arbeit:** R08, R09, R12 getrennt auswählen und planen; Datenmigrationen und Betriebsänderungen nicht mit CSS-Fixes vermischen.

Keine neue UI-Bibliothek erforderlich. Die bestehenden Schutzregeln und bewährten Abläufe sollen bei jedem ausgewählten Schritt erhalten bleiben. Die Auswahl der Nummern bestimmt erst den nachfolgenden Implementierungsumfang.
