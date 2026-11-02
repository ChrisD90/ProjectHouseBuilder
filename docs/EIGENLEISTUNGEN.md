# Eigenleistungen – erste Ausbaustufe

Der neue Bereich **Eigenleistungen** steht in der Sidebar unter „Projekt“ und unter `/p/<Projekt-ID>/eigenleistungen`. Er verwendet eigene Projektdatensätze. Bestehende Angebote, Rechnungen, To-dos, Kosten, Kreditbewegungen und Bauzeitenpläne werden durch seine Bedienung nicht verändert.

## Manuell planen

1. „Eigenleistung planen“ öffnen und Bezeichnung, Vorhaben, Ort und eigene Erfahrung erfassen.
2. Optional ein bestehendes Arbeitspaket verknüpfen. Der Link dient der Orientierung und führt zum Arbeitspaket; er übernimmt weder Termine noch Fortschritt und ändert dessen Ausführungsart nicht.
3. Im Reiter „Schritte“ das Vorgehen beschreiben, die Reihenfolge ändern und einzelne Schritte abhaken.
4. Im Reiter „Material“ Mengen, Einheiten, Einzelpreise, Hinweise und Beschaffungsstatus festhalten. Mengen und Preise dürfen zunächst offenbleiben.
5. Im Reiter „Werkzeuge“ zwischen „Noch offen“, „Vorhanden“, „Kaufen“, „Mieten“ und „Ausleihen“ wählen, Kosten schätzen und die Einsatzbereitschaft markieren.
6. „Eigenleistung speichern“ übernimmt den Entwurf. Der Status des Vorhabens wird unabhängig vom Bauzeitenplan gepflegt.

Die kompakte Kachel zeigt Status, Schrittfortschritt und eine Kostenschätzung. Unbekannte Preise werden ausdrücklich als offen behandelt; eine Teilsumme wird als „bisher geschätzt“ bezeichnet. Geldwerte werden auf Cent gerundet und die Summe mit Decimal berechnet. Es entstehen daraus keine Budgetpositionen oder Buchungen. Archivieren, Zurückholen und endgültiges Löschen betreffen ausschließlich die jeweilige Eigenleistung.

Wird ein verknüpftes Arbeitspaket gelöscht oder der Zeitplan geleert, bleibt die Eigenleistung erhalten. Eine nicht mehr verfügbare Verknüpfung wird entsprechend angezeigt und kann entfernt oder geändert werden. Sie blockiert die bisherigen Löschwege nicht.

## Optional mit ChatGPT planen

Die manuelle Erfassung funktioniert ohne ChatGPT. Bei freigegebener Verbindung erscheint „Mit ChatGPT planen“; Modellwahl und Credit-Bestätigung nutzen die vorhandene Verbindungskonfiguration.

Der eigene Planungsdialog beginnt mit der ausdrücklichen Zustimmung zur Übermittlung von Vorhabensangaben und Gespräch. Es werden ausschließlich die angegebenen Vorhabensdaten sowie Name und Gewerk eines bewusst verknüpften Arbeitspakets verwendet, keine Angebote, Rechnungen oder sonstigen Projektdaten.

ChatGPT stellt zunächst Rückfragen. Erst wenn die KI ausreichend Informationen sieht **und** der Benutzer dies bestätigt, kann ein Planvorschlag erstellt werden. Die Bereitschaft ist signiert, zeitlich begrenzt und an Projekt, Kontext und Gespräch gebunden. Veränderte Grundlagen erfordern eine erneute Abstimmung. Während einer Anfrage bleibt der Planungsdialog gesperrt; es gibt keine automatischen KI-Wiederholungen.

Der Vorschlag zeigt Arbeitsschritte, Materialien, Werkzeuge und Annahmen. Unbekannte Mengen und Preise bleiben offen. „Vorschlag übernehmen & bearbeiten“ überträgt ihn in den manuellen Entwurf. Bestehende Listen werden nur nach einer Bestätigung ersetzt. Danach können alle Einträge korrigiert werden; dauerhaft gespeichert wird erst über „Eigenleistung speichern“. Erledigt-/Beschaffungsmarkierungen werden von KI-Vorschlägen nicht automatisch gesetzt. Änderungen an fachlicher Planung, Termine oder Buchungen erfolgen nicht.

## Daten und Betrieb

- Neues Modell: `self_work_plan`, serverseitig strikt nach Projekt getrennt. Bearbeitung nutzt den vorhandenen Konfliktschutz für mehrere Tabs.
- Migration **0032** legt ausschließlich die neue Tabelle an. Die normalen Starter verwenden weiterhin die bestehende Sicherung vor Schema-Upgrades.
- Projektbackups und Projektreset erfassen die neuen Datensätze. Andere Projekte bleiben erhalten. Ältere Projektarchive ohne diesen Bereich werden mit einer leeren Eigenleistungsliste eingelesen; unbekannte Schemaabweichungen werden weiter abgewiesen.
- Ein Projekt mit Eigenleistungen gilt als nicht leer und lässt sich erst nach Entfernen dieser Daten löschen.
- API: `GET/POST /api/self-work`, `GET/PATCH/DELETE /api/self-work/<ID>`, sowie die ausdrücklich freizugebenden KI-Schritte `/api/self-work/ai/consult` und `/api/self-work/ai/plan`.

## Prüfung

```sh
DATABASE_URL=sqlite:///:memory: PHB_CHATGPT_HOME=/tmp/phb-test-auth .venv/bin/python -m unittest tests.test_self_work
npm --prefix frontend run build
.venv/bin/python dev/ui_browser_smoke.py tests/browser_self_work.cjs
```

Der Browserlauf nutzt eine temporäre Projektdatenbank und simulierte KI. Er prüft Offline-Erfassung, fehlende Verbindung, ausdrückliche Einwilligung, Rückfragen, Busy State, beidseitige Bereitschaft, Vorschau, Ersetzung, manuelle Korrektur, Archiv/Löschen sowie Mobil/Desktop in Hell/Dunkel. Weitere Prüfungen decken Projektgrenzen, veraltete Bearbeitungen, ungültige Werte, verwaiste Arbeitspaketlinks, Migration und Backup/Restore/Reset ab. Bildvergleiche sichern die neuen Kacheln in vier Ansichten ab. Es wurden keine echten KI-Anfragen ausgelöst.

Abschlussstand: 453 Python-Tests, Typecheck/Produktionsbuild, 7 Frontend-Tests, 5 Workflow-Tests, alle kritischen Browserabläufe und 12 Bildvergleiche erfolgreich. PostgreSQL 17 bestätigt neue Eigenleistungsdatensätze, Rundung, Projektgrenzen sowie die bisherigen Backup-, Finanzierungs- und Migrationsabläufe. Die acht bisherigen Bildreferenzen mussten nicht geändert werden.

Glossar, gemeinsame Einkaufsliste, Materialbestand, Fotodokumentation, automatische To-do-Erzeugung und Kostenübernahme sind spätere Ausbaustufen. Die erste Runde bleibt bewusst eigenständig.
