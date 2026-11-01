# Mehrere Projekte

Der Einstieg `/` zeigt die Projektübersicht. Jedes Projekt hat eine stabile ID, einen editierbaren Titel, eine Art und eine optionale Beschreibung. Die Kacheln zeigen abgeschlossene/gesamte Arbeitspakete, die bestehende Kostenprognose und offene To-dos. Neue Projekte erhalten eigene Standardgewerke/-kategorien und einen gewählten Projektstart; keine Firmen, Aufgaben, Angebote oder Buchungen werden aus anderen Projekten kopiert.

Der bisherige Arbeitsbereich bleibt erhalten und liegt unter `/p/<id>/`. Das Haus-Symbol bzw. der Projektname oben in der Sidebar führt zur Übersicht zurück. Beim Öffnen eines anderen Projekts wird ein neuer Arbeitsbereich geladen. Innerhalb desselben Projekts bleiben Rahmen und Navigation weiterhin bestehen. Dadurch können Query-Caches, geladene Fachmasken und Warteschlangen nicht von einem Projekt ins andere übernommen werden.

## Archivieren und leere Projekte löschen

Die Kachelaktionen erlauben Bearbeiten, Archivieren/Wiederherstellen und das Löschen eines leeren Projekts. Archivierte Projekte liegen in einer standardmäßig eingeklappten Liste; ihre Daten bleiben vollständig erhalten und der Arbeitsbereich bleibt zugänglich. Eine Kennzeichnung in der Sidebar zeigt den Archivstatus.

Löschen ist ausschließlich für eine leere Projekthülle möglich. Die unveränderten Standardgewerke, Standardkategorien sowie technische Start-/Initialisierungseinstellungen zählen nicht als eigene Daten. Eigene Stammdaten, Budget, Aufgaben, Bauphasen, Angebote, Rechnungen, Finanzierungsdaten, Dokumente, Förderungen, To-dos/Notizen (auch archivierte), Historien und Importaufträge blockieren die Löschung. Die Oberfläche zeigt den Grund an. Vor endgültigem Löschen muss der genaue Projekttitel eingegeben werden; der Server prüft die Leere unter einer Schreibsperre erneut. Mit vorhandenen Daten ist zuerst der ausdrücklich bestätigte Projekt-Reset nötig, soweit dieser verfügbar ist.

Revision **0030** ergänzt ausschließlich `project.archived_at`. Gelöschte Projekt-IDs werden niemals neu vergeben; auch nach Löschen des letzten Projekts und Neustart wird Projekt 1 nicht neu erzeugt. Vorhandene Backups bleiben erhalten und können nicht in ein neues Projekt mit anderer ID eingespielt werden. Löschen ist kein Mittel, um fachliche Datensätze ohne Reset-Bestätigung zu entfernen.

## Backend und Migration

Revision **0027** ergänzt die globale Tabelle `project` und ein `project_id`-Fremdschlüsselfeld an allen Fachtabellen, einschließlich Einstellungen, Stammdaten, Versions-/Zahlungshistorien, Förderunterlagen-Verknüpfungen und Importjobs. Vorhandene Datensätze erhalten Eigentümer 1 („Mein bestehendes Projekt“). Bestehende IDs, Beträge, Dokumentpfade und Beziehungen werden nicht umnummeriert. Titel/Art können anschließend in der Übersicht bearbeitet werden.

Einstellungsnamen, Arbeitspaketcodes, Bauphasentitel, Gewerke-/Kategorienamen und Upload-Prüfsummen sind künftig pro Projekt eindeutig. SQLite verwendet für automatische Datensatz-IDs AUTOINCREMENT, damit gelöschte Quellen nicht durch neue Datensätze unter derselben ID ersetzt werden. PostgreSQL-Sequenzen bleiben automatisch; die Sequenz des ersten Projekt-Datensatzes wird nach dessen initialem Anlegen angeglichen.

Der Mac-Migrationsstarter legt weiterhin ein geprüftes Komplettbackup vor einem bestehenden Schema-Upgrade an. Auch der direkte App-/Docker-Start erkennt das alte Schema und sichert es vor der Umstellung. Ist noch kein Backup-Ziel eingerichtet, liegt diese Sicherheitskopie auf dem NAS unter `migration-safety` im vorhandenen Backup-Mount, bei direktem lokalem SQLite-Start unter `~/.local/share/ProjectHouseBuilder/migration-backups`. Die Backup-Einstellungen werden dabei nicht überschrieben. Schlagen Backup oder Prüfung fehl, beginnt die Umstellung nicht. Keine Datenbank-Downgrades: Für eine Rückkehr zu älterem Code die vollständige Sicherung wiederherstellen.

## Projektgrenze

Eine Session-Erweiterung setzt Projektfilter für ORM-Abfragen, Projektionen, Aggregationen und Bulk-Änderungen. Direkte ID-Abfragen prüfen auch bereits geladene Objekte. Neue/geänderte ORM-Datensätze und ihre Fremdschlüssel müssen zum aktiven Projekt gehören; vorhandene Datensätze können ihre Projekt-ID nicht durch Bearbeiten wechseln. Administrative Systemsicherungen und die Start-Wiederherstellung der Jobzustände sind ausdrücklich globale Vorgänge. Die Backup-UI arbeitet dagegen immer im ausgewählten Projekt. Neue Backendfunktionen müssen diese Session nutzen; SQL über rohe Engine-Verbindungen ist nur für ausdrücklich globale Verwaltung/Migration oder die validierte Projektwiederherstellung mit expliziten Projektfiltern vorgesehen.

API-Anfragen erhalten `X-PHB-Project`. Dokumentlinks, PDF-/Bildvorschauen und Downloads führen `project_id` in der URL mit. Es gibt kein globales „aktives Projekt“-Cookie: Zwei Browser-Tabs können unabhängig verschiedene Projekte bearbeiten. Für alte Integrationen ohne Kontext bleibt Projekt 1 der Standard; ungültige bzw. unbekannte IDs liefern einen Fehler und fallen nicht auf ein anderes Projekt zurück. Hintergrundimporte binden sich an die ID ihres gespeicherten Jobs, auch wenn die Oberfläche inzwischen ein anderes Projekt zeigt. Projektbezogene KI-Gespräche und offene Vorschläge werden zusätzlich an den Browser gebunden in `planning_browser_state` gespeichert; sie verwenden keine miteinander konkurrierenden Projektzustände im gemeinsamen Cookie. Die ChatGPT-Verbindung ist global; die übermittelten Fachdaten stammen jeweils aus dem ausgewählten Projekt. Nach der Anmeldung führt der Rückruf zum ursprünglichen Projekt zurück.

## Sicherungen und Exporte

- **Projektbackup / Wiederherstellung in der UI:** enthält nur das geöffnete Projekt einschließlich Stammdaten, Zahlungen, Historien und Originaldateien. Jeder Projekt-ID ist ein eigener Sicherungsunterordner zugeordnet; Liste und Aufbewahrung sind getrennt. Ein fremdes Projektbackup wird zurückgewiesen. Die Wiederherstellung ersetzt ausschließlich den ausgewählten Projektstand und erstellt vorher ein weiteres Projektbackup. Datensatz-IDs bleiben erhalten; Kollisionen und projektfremde Verknüpfungen werden vor Änderungen zurückgewiesen. SQLite und PostgreSQL verwenden dasselbe portable ZIP-Format.
- **Projektarchiv herunterladen:** lädt dasselbe vollständige Projektbackup herunter, auch ohne eingerichteten Sicherungsordner. Es enthält keine komplette Datenbankdatei, keine anderen Projektmetadaten und keine Zugangsdaten. Einzelne CSV-/JSON-Fachexporte bleiben ebenfalls projektbezogen.
- **Projekt zurücksetzen:** leert nur das geöffnete Projekt nach einem vorherigen vollständigen, geprüften Projektbackup. Das Projekt selbst bleibt als leere Kachel erhalten. Laufende Uploads dieses Projekts verhindern den Reset; andere Projekte und ihre Dateien bleiben erhalten. Der Reset ist weiterhin nur für lokales SQLite freigeschaltet.
- **Administrative Systemsicherung:** bisherige CLI-/NAS-Sicherungen und automatische Sicherheitskopien vor Schema-Upgrades umfassen weiterhin die gesamte Installation. Sie sind separat gekennzeichnet und werden nicht über die Projekt-UI wiederhergestellt. Bestehende Systemsicherungen bleiben erhalten.

Details und Prüfungen: [Projektbackups](project-backups.md).

Dies erweitert die bestehende Anwendung für mehrere Vorhaben derselben Anwendung/Anmeldung. Separate Benutzerrollen oder Zugriffskontrollen je Projekt sind kein Bestandteil dieser Änderung.

## Prüfung

Python-Tests prüfen Migration und Datenerhalt, Projektionen/Identitätscache, wiederverwendbare Kennungen, Summen, unzulässige Verknüpfungen, direkte Dateizugriffe, Hintergrundjobs sowie Projektarchiv, Reset und Wiederherstellung einschließlich isolierter Sicherung, Dateisicherheit und Rücknahme bei Fehlern.

```sh
PHB_TEST_URL=http://127.0.0.1:5075 npm --prefix frontend run test:browser:projects
```

Nur gegen ein Wegwerfprojekt ausführen. Der Browserlauf legt zwei Projekte an, prüft den leeren Einstieg, Phase abschließen/wieder öffnen, Dialogaktionen, zwei parallele Tabs, getrennte Firmen, Hintergrund-Upload und Dateivorschau. Die übrigen vorhandenen Browserläufe bleiben verfügbar. Zusätzlich wurde PostgreSQL 17.11 in einer isolierten Datenbank geprüft: frischer Start, Projektsequenz, wiederverwendbare Kennungen, Summen, Fremdbezüge, Dateien und die Migration des vorherigen Schemas. Dieser Lauf ist als CI-Job mit PostgreSQL 17 hinterlegt. SQLite und Chromium sind ebenfalls automatisiert geprüft; Safari und die konkrete NAS-Installation bleiben Bestandteil des Nutzertests.

Der zusätzliche PostgreSQL-Lauf ist lokal über `dev/multi_project_pg_smoke.py` verfügbar. Er benötigt `PHB_PG_TEST_URL` auf eine **leere lokale** Datenbank mit dem Namenspräfix `phb_`; andere bzw. vorhandene Datenbanken werden abgewiesen. Es werden ausschließlich synthetische Testdaten verwendet.

Die ergänzenden Tests `tests/test_project_lifecycle.py` und `tests/browser_project_lifecycle.cjs` prüfen Archivieren, Wiederherstellen, Leerprüfung, Sicherheitsabfrage, unveränderte andere Projekte und nicht wiederverwendete IDs.
