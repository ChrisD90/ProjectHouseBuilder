# Mehrere Projekte

Der Einstieg `/` zeigt die Projektübersicht. Jedes Projekt hat eine stabile ID, einen editierbaren Titel, eine Art und eine optionale Beschreibung. Die Kacheln zeigen abgeschlossene/gesamte Arbeitspakete, die bestehende Kostenprognose und offene To-dos. Neue Projekte erhalten eigene Standardgewerke/-kategorien und einen gewählten Projektstart; keine Firmen, Aufgaben, Angebote oder Buchungen werden aus anderen Projekten kopiert.

Der bisherige Arbeitsbereich bleibt erhalten und liegt unter `/p/<id>/`. Das Haus-Symbol bzw. der Projektname oben in der Sidebar führt zur Übersicht zurück. Beim Öffnen eines anderen Projekts wird ein neuer Arbeitsbereich geladen. Innerhalb desselben Projekts bleiben Rahmen und Navigation weiterhin bestehen. Dadurch können Query-Caches, geladene Fachmasken und Warteschlangen nicht von einem Projekt ins andere übernommen werden.

## Backend und Migration

Revision **0027** ergänzt die globale Tabelle `project` und ein `project_id`-Fremdschlüsselfeld an allen Fachtabellen, einschließlich Einstellungen, Stammdaten, Versions-/Zahlungshistorien, Förderunterlagen-Verknüpfungen und Importjobs. Vorhandene Datensätze erhalten Eigentümer 1 („Mein bestehendes Projekt“). Bestehende IDs, Beträge, Dokumentpfade und Beziehungen werden nicht umnummeriert. Titel/Art können anschließend in der Übersicht bearbeitet werden.

Einstellungsnamen, Arbeitspaketcodes, Bauphasentitel, Gewerke-/Kategorienamen und Upload-Prüfsummen sind künftig pro Projekt eindeutig. SQLite verwendet für automatische Datensatz-IDs AUTOINCREMENT, damit gelöschte Quellen nicht durch neue Datensätze unter derselben ID ersetzt werden. PostgreSQL-Sequenzen bleiben automatisch; die Sequenz des ersten Projekt-Datensatzes wird nach dessen initialem Anlegen angeglichen.

Der Mac-Migrationsstarter legt weiterhin ein geprüftes Komplettbackup vor einem bestehenden Schema-Upgrade an. Auch der direkte App-/Docker-Start erkennt das alte Schema und sichert es vor der Umstellung. Ist noch kein Backup-Ziel eingerichtet, liegt diese Sicherheitskopie auf dem NAS unter `migration-safety` im vorhandenen Backup-Mount, bei direktem lokalem SQLite-Start unter `~/.local/share/ProjectHouseBuilder/migration-backups`. Die Backup-Einstellungen werden dabei nicht überschrieben. Schlagen Backup oder Prüfung fehl, beginnt die Umstellung nicht. Keine Datenbank-Downgrades: Für eine Rückkehr zu älterem Code die vollständige Sicherung wiederherstellen.

## Projektgrenze

Eine Session-Erweiterung setzt Projektfilter für ORM-Abfragen, Projektionen, Aggregationen und Bulk-Änderungen. Direkte ID-Abfragen prüfen auch bereits geladene Objekte. Neue/geänderte ORM-Datensätze und ihre Fremdschlüssel müssen zum aktiven Projekt gehören; vorhandene Datensätze können ihre Projekt-ID nicht durch Bearbeiten wechseln. Interne globale Vorgänge wie Backup und Start-Wiederherstellung der Jobzustände sind ausdrücklich ausgenommen. Neue Backendfunktionen müssen diese Session nutzen; SQL über rohe Engine-Verbindungen ist ausschließlich für ausdrücklich globale Verwaltung/Migration vorgesehen.

API-Anfragen erhalten `X-PHB-Project`. Dokumentlinks, PDF-/Bildvorschauen und Downloads führen `project_id` in der URL mit. Es gibt kein globales „aktives Projekt“-Cookie: Zwei Browser-Tabs können unabhängig verschiedene Projekte bearbeiten. Für alte Integrationen ohne Kontext bleibt Projekt 1 der Standard; ungültige bzw. unbekannte IDs liefern einen Fehler und fallen nicht auf ein anderes Projekt zurück. Hintergrundimporte binden sich an die ID ihres gespeicherten Jobs, auch wenn die Oberfläche inzwischen ein anderes Projekt zeigt. Projektbezogene KI-Gespräche und offene Vorschläge werden zusätzlich an den Browser gebunden in `planning_browser_state` gespeichert; sie verwenden keine miteinander konkurrierenden Projektzustände im gemeinsamen Cookie. Die ChatGPT-Verbindung ist global; die übermittelten Fachdaten stammen jeweils aus dem ausgewählten Projekt. Nach der Anmeldung führt der Rückruf zum ursprünglichen Projekt zurück.

## Sicherungen und Exporte

- **Komplettes Backup / Wiederherstellung:** umfasst alle Projekte, die zentrale Datenbank und sämtliche privaten Dateien. Nach einer Wiederherstellung alle geöffneten App-Fenster neu laden.
- **Projektarchiv / einzelne Fach-Exporte:** umfasst nur die aktuellen Projektdaten und zugehörigen Originale. Auch die SQLite-Kopie im Projektarchiv enthält keine Zeilen anderer Projekte.
- **Projekt zurücksetzen:** leert nur das geöffnete Projekt nach einem vorherigen vollständigen, geprüften Backup. Das Projekt selbst bleibt als leere Kachel erhalten. Laufende Uploads dieses Projekts verhindern den Reset; andere Projekte und ihre Dateien bleiben erhalten.

Dies erweitert die bestehende Anwendung für mehrere Vorhaben derselben Anwendung/Anmeldung. Separate Benutzerrollen oder Zugriffskontrollen je Projekt sind kein Bestandteil dieser Änderung.

## Prüfung

Python-Tests prüfen Migration und Datenerhalt, Projektionen/Identitätscache, wiederverwendbare Kennungen, Summen, unzulässige Verknüpfungen, direkte Dateizugriffe, Hintergrundjobs sowie Projektarchiv und Reset einschließlich gemeinsamer Sicherung.

```sh
PHB_TEST_URL=http://127.0.0.1:5075 npm --prefix frontend run test:browser:projects
```

Nur gegen ein Wegwerfprojekt ausführen. Der Browserlauf legt zwei Projekte an, prüft den leeren Einstieg, Phase abschließen/wieder öffnen, Dialogaktionen, zwei parallele Tabs, getrennte Firmen, Hintergrund-Upload und Dateivorschau. Die übrigen vorhandenen Browserläufe bleiben verfügbar. Zusätzlich wurde PostgreSQL 17.11 in einer isolierten Datenbank geprüft: frischer Start, Projektsequenz, wiederverwendbare Kennungen, Summen, Fremdbezüge, Dateien und die Migration des vorherigen Schemas. Dieser Lauf ist als CI-Job mit PostgreSQL 17 hinterlegt. SQLite und Chromium sind ebenfalls automatisiert geprüft; Safari und die konkrete NAS-Installation bleiben Bestandteil des Nutzertests.

Der zusätzliche PostgreSQL-Lauf ist lokal über `dev/multi_project_pg_smoke.py` verfügbar. Er benötigt `PHB_PG_TEST_URL` auf eine **leere lokale** Datenbank mit dem Namenspräfix `phb_`; andere bzw. vorhandene Datenbanken werden abgewiesen. Es werden ausschließlich synthetische Testdaten verwendet.
