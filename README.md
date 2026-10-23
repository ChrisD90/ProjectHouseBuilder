# ProjectHouseBuilder – Sanierungsprojekt

**Aktuelle Version:** `feature/synology-nas` (eine Codebasis, lokal auf dem Mac oder optional auf der NAS). Die empfohlene Betriebsart ist **SQLite lokal auf dem Mac**, ohne dauerhaften Server.

## Schnellstart in VS Code (macOS)

1. Das Projekt in VS Code öffnen; ggf. `git switch feature/synology-nas` ausführen.
2. Updates einspielen: `git pull origin feature/synology-nas` (vorher laufende App beenden).
3. **Einmalig** den Backupordner auswählen: `sh mac/backup-setup.sh` (z. B. in Proton Drive). Die aktive Datenbank bleibt **außerhalb** synchronisierter Ordner.
4. Starten: `sh start_mac_linux.sh`.
5. In Chrome/Safari öffnen: **http://127.0.0.1:5055**.

Port **5055** ist absichtlich gewählt. macOS belegt **5000** häufig mit dem AirPlay-Empfänger; der Browser meldet dann eventuell 403 von AirPlay statt die Flask-App anzuzeigen. Wenn der Port geändert werden soll: `PORT=5056 sh start_mac_linux.sh`. Bei Bedarf belegte Ports mit `lsof -nP -iTCP:5000 -sTCP:LISTEN` oder `lsof -nP -iTCP:5055 -sTCP:LISTEN` prüfen. Die lokale App lauscht nur auf `127.0.0.1`.

## Datensicherheit & vollständiger Projekt-Reset

In der **linken Sidebar → Datenverwaltung & Reset**:

- **„Jetzt vollständiges Backup erstellen“**: Geprüfter SQLite-Snapshot **inklusive sämtlicher** Dateien aus `private/` (PDF-Angebote, Belege, Kassenzettel, Dokumente) in deinem gewählten Ordner. Kredit-, Zahlungs- und Angebotsdaten befinden sich vollständig in der Datenbank.
- **„Projekt vollständig zurücksetzen“**: Nach Ankreuzen einer Bestätigung und Eingabe von `ALLE DATEN LÖSCHEN` wird **zuerst zwingend ein geprüftes vollständiges Backup** erstellt. Nur bei Erfolg werden Aufgaben, Angebote, Kosten, Rechnungen, Finanzierung, eigene Kategorien, Kontakte, hochgeladene Dateien usw. aus der aktuellen Installation gelöscht. Übrig bleiben das Datenbankschema samt Alembic-Migrationshistorie, die eingebauten Standardkategorien und ein leeres Projektbudget. Nach Neustart erscheinen **keine alten Beispielaufgaben** erneut.
- Alle **Backup-ZIP-Dateien bleiben unangetastet**. Die Backup-Zielkonfiguration bleibt bestehen. Der vollständige Reset ist aus Sicherheitsgründen nur für **lokales SQLite** und Aufrufe auf diesem Rechner erlaubt; bei PostgreSQL/NAS wird er abgewiesen.
- Fehlt der Sicherungsordner, ist er nicht erreichbar, ist die DB beschädigt oder schlägt die ZIP-Prüfung fehl, wird **nichts gelöscht**.

**Wiederherstellung:** Anwendung beenden und `python3 backup_manager.py restore "/Pfad/zum/Backup.zip" --yes` ausführen, anschließend `sh start_mac_linux.sh`. Ein Backup sollte gelegentlich auf einem separaten Medium getestet werden. Für regelmäßige Backups auf dem Mac steht der per `sh mac/backup-setup.sh` eingerichtete tägliche LaunchAgent bereit (solange der Mac eingeschaltet ist). Die letzten 30 erfolgreichen Versionen bleiben normalerweise erhalten.

Die alten Excel-Kostenplanvorlagen und ihr automatischer Import sind **entfernt**. Der Kostenplan wird manuell gepflegt; bereits existierende Budgetpositionen werden durch den Code-Update **nicht automatisch gelöscht**. Ein vollständiger Reset leert auch diese Daten. Der CSV-Export des eigenen Kostenplans bleibt erhalten. Alte Backup-ZIPs lassen sich weiter prüfen; beim Restore wird die inzwischen überflüssige Excel-Initialdatei nicht wieder importiert.

## Datenbankschema und Updates

`start_mac_linux.sh` richtet `.venv` ein, installiert ggf. Abhängigkeiten und führt vor dem Programmstart die **Alembic-Migrationen** aus. Beim Update einer bestehenden SQLite-Datenbank wird **vor jeder nötigen Schemaänderung** ein geprüftes Komplettbackup erzwungen; ohne Backup wird nicht migriert. Neue Version `0004` entfernt nicht mehr benötigte Excel-Metadatentabellen/-spalten. Echte Kosten-, Beleg-, Kontakt-, Kredit- und Angebotsdaten bleiben davon unberührt. `python schema_manager.py --check` zeigt den Datenbankstand.

Die Git-Regeln schließen unter anderem `sanierung.db`, `*.db`, `*.db-wal`, `*.db-shm`, `private/`, `backups/`, `.env`, `instance/` aus. Diese Dateien niemals in GitHub einchecken. Die Datenbank nie in einem Cloud-Sync-Ordner betreiben; nur vollständige Backups synchronisieren.

## Funktionen

- **Bauzeitenplan:** Gantt mit Abhängigkeiten, Terminen, Status, Eigenleistungen und Firmen.
- **Kosten & Budget:** eigene Budgetpositionen und Schätzwerte, Beauftragungen, Förderungen und Kostenprognose.
- **Angebote:** PDF hochladen und auslesen, Entwurf bearbeiten, Kategorie und Gesamtbruttopreis prüfen, in Angebotsliste übernehmen und später annehmen/ablehnen. Nur angenommene Angebote wirken sich als Auftrag auf die Kosten aus.
- **Belege:** Rechnungen/Kassenzettel als PDF oder Foto importieren, optional lokal mit Tesseract OCR lesen, prüfen, kategorisieren und erst nach Freigabe buchen.
- **Finanzierung:** Kredite, Eigenkapital, Kreditabrufe, Tilgungen, aufgeteilte Rechnungszahlungen und Liquiditätsvorschau.
- **Datenverwaltung:** Backup auf Knopfdruck, vollständiger Projekt-Reset mit Pflichtbackup.

OCR von Bildern benötigt zusätzlich Tesseract und Poppler auf dem Mac; bei lesbaren PDF-Texten ist kein OCR erforderlich. Die Anwendung ist als lokale Einzelplatzsoftware konzipiert und wird **nicht** per Router-Portweiterleitung veröffentlicht.

## Alternative Betriebsarten

- **Lokale Docker-Tests:** `cp .env.dev.example .env.dev`, sichere Werte vergeben, `sh dev/start.sh`, aufrufen unter `http://127.0.0.1:5080`. Eigene PostgreSQL-Testdatenbank; siehe [dev/README.md](dev/README.md).
- **Synology NAS:** Container Manager mit `compose.synology.yaml`, getrennte PostgreSQL-Datenbank und TLS auf Port 8443; siehe [synology/README.md](synology/README.md). Der Mac-SQLite-Reset und dessen Migrationen gelten **nicht** für PostgreSQL.

## Tests

`python -m unittest discover -s tests -v` prüft die Geschäftslogik, Backups, Migrationen, Sidebar sowie API- und Reset-Sicherheitsbedingungen. GitHub Actions prüft zusätzlich JavaScript-Syntax und Docker Compose.
