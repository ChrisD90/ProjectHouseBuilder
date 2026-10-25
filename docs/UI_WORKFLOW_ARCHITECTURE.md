# Gemeinsame Dialog- und Workflow-Architektur

Stand: 25.10.2026 · Zielbranch: `feature/synology-nas`

## Was jetzt tatsächlich implementiert ist

Die acht Fachseiten laden nach `ui.js` zusätzlich `static/phb-workflow.js` und `static/phb-workflow.css`. Die neue API `window.PHBFlow` enthält eine einzige Implementierung für native Dialoge und deren Lebenszyklus. Die vorhandene `PHBUI`-Messagebox wird weiterverwendet; alle Fachvalidierungen und API-Buchungen bleiben im jeweiligen Modul.

**Abgedeckte Dialoge:** Bauzeitenplan-Arbeitspaketliste, Firmenzuordnung, Entscheidungshistorie, Angebote importieren/prüfen/bearbeiten/annehmen, Rechnungen importieren/prüfen/buchen/bezahlen, Kredite und Eigenkapitalkonten, Kosteneditor und Kostenanhänge, allgemeine Dokumente importieren/bearbeiten, Firmenstammdaten, Backup-Zielordner und Wiederherstellung sowie die ChatGPT-Verbindungsmaske.

## Die zentrale API

```js
const flow = PHBFlow.manage({
  dialog: 'dialogId',
  forms: ['formId'],
  dismiss: ['cancelButtonId'],
  isBusy: () => requestPending,
  steps: ['Erfassen', 'Prüfen', 'Freigeben'],
  track: true,
  onClose: () => {},
  onError: error => PHBUI.alert(error.message),
});
flow.open({step: 0});     // Native showModal + korrektes Ausgangsabbild
flow.stage(1);           // Zeigt den aktuellen Schritt
flow.dirty();            // Unsaved-changes-Status
flow.snapshot();         // Nach bestätigtem Speichern / Datenladen
await flow.cancel();     // Einheitlicher Abbruch inkl. ggf. Verwerfen-Bestätigung
flow.finish();           // Erfolgreich abschließen, ohne erneuten Dialog
const result = await flow.run(async () => {
  // Bestehender API-Schreibvorgang
}, {button: submitButton});
```

Die Steuerung unterscheidet bewusst **Abbrechen** (kann ungespeicherte Daten verwerfen) von **erfolgreichem Abschluss**. Ein Klick auf die jeweilige Abbrechen-/Schließen-Aktion, Escape und ein Klick auf die Dialogkulisse durchlaufen denselben Abbruchschutz. Ein Seitenwechsel zeigt bei offenem, tatsächlich verändertem Formular die native Browser-Warnung. Bei erfolgreichem Abschluss wird der Fokus zum auslösenden Element zurückgegeben, sofern es noch existiert.

Der Status `busy` sperrt parallele Schreibvorgänge und das Schließen. Der optionale `isBusy`-Callback schützt bestehende asynchrone Prozesse, ohne vorhandene Datenlogik umzuschreiben. `run()` übernimmt diesen Status und die Fehlerbehandlung zentral. `signature()` erkennt auch Checkboxen, Mehrfachauswahl und Dateiänderungen; bei Eurofeldern werden Formatänderungen ohne Zahlenänderung normalisiert.

## Einheitliche Status-/Schrittführung

- **Angebote**: Erfassen → Prüfen. Verbindliche Auftragsannahme bleibt ein eigener geschützter Abschlussdialog mit wahlweiser Auftragsbestätigung.
- **Rechnungen**: Erfassen → Prüfen & buchen → Bezahlen. Die Buchung bleibt atomar; die Zahlung mit Finanzierungsquelle erfolgt danach separat.
- **Finanzierung**: Vertragsdaten und Kreditunterlagen im verwalteten Dialog, nicht-verlorengehende ChatGPT-Analyse. Ein unabhängiger persistenter Worker für Kreditanalysen ist *noch nicht* implementiert.
- **Projektdokumente**: Allgemeine Dokumente können bearbeitet werden. Angebote, Rechnungen, Kredit- und Kostenbelege bleiben zentral ausschließlich als lesbare Querverweise sichtbar.

## CSS

`phb-workflow.css` enthält gemeinsam gekapselte Regeln für Header, Aktionen, Felder, Fehlermeldungen, responsive Schrittanzeige und Busy-Zustand. Bestehende Fachseiten behalten ihre differenzierten Speziallayouts, insbesondere PDF/Formular nebeneinander. Die Regeln sind auf `body.phb-app .phb-flow-dialog` beschränkt und ersetzen keine fachlichen CSS-Ausnahmen. Sie stehen im Head hinter den bestehenden Styles, damit der gemeinsame Vertrag bei Überschneidungen zuverlässig greift.

## Neu zu entwickelnde Dialoge

- Das **Formular zunächst mit validierten Ausgangsdaten füllen**, danach `flow.open()` aufrufen. Wenn eine asynchrone API erst nach Öffnen die Eingaben füllt, **danach `flow.snapshot()`** aufrufen.
- Schließen-Button bei `dismiss` registrieren; keine zusätzliche direkte `close()`-Logik bei Abbrechen einbauen.
- Während einer ausstehenden Mutation `flow.run()` verwenden oder `isBusy` an einen bereits vorhandenen Busy-Zustand binden.
- Nach einer bestätigten Speicherung ohne Schließen `flow.snapshot()` aufrufen.
- Geschäftsentscheidungen weiterhin serverseitig validieren und nach Möglichkeit in einer Transaktion speichern. Ein Dialog-Fortschrittsindikator ersetzt keine Backendprüfung.
- Pro Dialog **eine** sichtbare Abbrechen/Schließen-Aktion und **eine** primäre Aktion je Bearbeitungsphase; Löschaktionen getrennt platzieren und mit `PHBUI.confirm` absichern.

## Tests und verbleibende Grenzen

`tests/workflow_runtime.test.cjs` testet die Steuerung zur Laufzeit mit simulierten DOM-Elementen, inklusive Verwerfen, Fokus, parallelen Vorgängen und Navigationswarnung. `tests/test_workflow_architecture.py` kontrolliert die Einbindung in sämtliche Fachseiten. CI führt zusätzlich alle Python-Regressionen, alle JS-Syntaxchecks und Docker-Compose-Validierung aus.

**Nicht enthalten:** ein vollautomatisches Playwright-Screenshot-Regressionssystem, ein eigener dauerhafter Hintergrundworker für Kredit-OCR sowie ein globaler Nachtragsassistent für fixierte Aufträge. Eine Prüfung auf einem echten Synology-Browser mit realen PDF-Vorschauen, kleinen Bildschirmgrößen und Dunkelmodus bleibt zur Abnahme erforderlich.
