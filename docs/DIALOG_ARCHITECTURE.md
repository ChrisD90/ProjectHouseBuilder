# Gemeinsame Dialog- und Workflow-Architektur

Die Anwendung nutzt den in `static/ui.js` bereitgestellten `PHBUI.dialogs`-Controller. Die Einführung ist bewusst kompatibel zu den bestehenden fachlichen APIs und Dialogen. Der Controller ist rein clientseitig; serverseitige Autorisierung, Validierung und Finanztransaktionen bleiben unverändert verbindlich.

## Konventionen

- `<dialog data-phb-dialog aria-labelledby="...">` registriert einen Dialog bei der gemeinsamen Steuerung.
- `<form data-phb-dirty>` markiert den fachlichen Editor, dessen Formwerte auf ungespeicherte Änderungen geprüft werden. Datei-Eingaben und Checkboxen werden mit berücksichtigt.
- `<button type="button" data-phb-close>` ist eine gemeinsame Abbrechen-/Schließen-Aktion. Ein dirty Editor erfragt vor dem Schließen das Verwerfen. Escape wird analog behandelt.
- `PHBUI.dialogs.busy(dialog, true/false)` verhindert Schließen während eines laufenden Vorgangs. Bei fachlichen asynchronen Speichervorgängen ist weiterhin auf `try/finally` und das Sperren der Submit-Aktion zu achten.
- `PHBUI.dialogs.saved(dialog)` setzt nach erfolgreichem Speichern die Dirty-Basis zurück, wenn der Dialog offenbleibt.
- `PHBUI.dialogs.notice(dialog, message, error)` liefert einen konsistenten dynamischen Statusbereich, wenn keine bestehende fachliche Meldung vorhanden ist.
- Gemeinsame CSS-Komponenten: `static/workflow-dialogs.css` lädt auf allen Hauptseiten und enthält Scoped-Regeln für `.phb-managed-dialog`. Seitenspezifische Dialoglayouts und die bereits bestehenden Schrittansichten behalten ihre Struktur.

## Fachliche Prozessgrenzen

Die gemeinsame Dialogschicht **bucht keine Rechnungen, übernimmt keine Angebote und ersetzt keine serverseitigen Prüfungen**. Angebote bleiben mit Original und fixiertem Auftragswert getrennt; Rechnungsprüfung/Buchung erfolgt atomar, Zahlung separat; Kreditdokumente und allgemeine Projektdokumente haben unterschiedliche Eigentümer. Die Importwarteschlange ist unabhängig vom Dialog.

## Nächste Erweiterungsschritte

1. Gemeinsam verwendbare, deklarative Schrittanzeige für Upload/Prüfen/Freigeben, sobald alle Fachbereiche konsistente Statusfelder besitzen.
2. Auch ältere komplexe Review-Dialoge mit asynchron nachgeladenen Formwerten schrittweise auf `data-phb-dirty` umstellen, nachdem ihre Baseline ausdrücklich nach dem Laden gesetzt wird.
3. Echte Browser- und Screenshot-Regressionstests für 360/768/1440 Pixel, Dunkelmodus, Tastatur, Escape, PDF-Vorschauen und Dialogfokus.
4. Einen eigenständigen persistenten Hintergrundworker für Kreditanalyse und Importe vorsehen; nicht Teil der Dialogschicht.

Die bestehende Synology-App benötigt nach dem Merge einen Neubau des App-Images; Daten-Volumes nicht löschen.
