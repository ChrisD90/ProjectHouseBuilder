# ProjectHouseBuilder – lokal auf dem Mac mit SQLite

**Empfohlener Betrieb für eine Person:** Die Anwendung und die aktive `sanierung.db` laufen lokal auf dem Mac. Angebote, Rechnungen und OCR-Belege liegen im lokalen Unterordner `private/`. Ein Cloud-Synchronisationsordner (z. B. Proton Drive) dient ausschließlich als **Backupziel**, nicht als Speicherort der laufenden SQLite-Datenbank.

## Lokaler Start ohne Docker

1. macOS: Python 3.10+ installieren, bei Bedarf über python.org. Die Texterkennung von Scan-PDFs benötigt zusätzlich lokal installierte Systemprogramme `tesseract` mit Deutsch-Sprachdaten sowie `pdftoppm` (Poppler).
2. Im Projektordner `sh start_mac_linux.sh` ausführen (startet den Flask-Server unter `http://localhost:5000`).
3. Lokal im Browser öffnen. Alle Arbeitsschritte und Belege werden auf diesem Mac gespeichert.

## Automatische Sicherungen – mit freier Ordnerwahl

1. Einen lokalen Proton-Drive-Synchronisationsordner (oder einen anderen Ordner) im Finder vorbereiten. Er muss für den Mac lokal verfügbar und schreibbar sein, nicht nur als Cloud-Platzhalter.
2. Im Terminal **einmalig** ausführen: `sh mac/backup-setup.sh`. Dadurch öffnet sich der macOS-Ordnerauswahldialog. Alternativ: `sh mac/backup-setup.sh "/vollständiger/Pfad/Backups"`.
3. macOS richtet einen benutzerspezifischen **LaunchAgent** ein: Sicherung bei Anmeldung und täglich um **20:00 Uhr**, wenn der Mac läuft. Das Backupziel wird unter `~/Library/Application Support/ProjectHouseBuilder/backup-config.json` gespeichert, nicht im Git-Repository.
4. Testlauf: `python3 backup_manager.py backup`. Prüfen: `python3 backup_manager.py show` und `python3 backup_manager.py verify "/PFAD/ZU/ProjectHouseBuilder_Backup_....zip"`.

Ein Backup enthält einen **konsistenten SQLite-Snapshot**, sämtliche Dateien unter `private/` (PDF-Angebote, Belege, Verträge, OCR-Originale usw.) sowie eine gegebenenfalls vorhandene private Datei `data/initial_budget.json`. Ein Manifest führt SHA-256-Prüfsummen für alle Einträge. Die letzten **30 erfolgreichen Backups** bleiben im gewählten Zielordner erhalten. Alte Versionen werden nur gelöscht, wenn ein neues Backup vollständig und erfolgreich erstellt wurde.

**Wichtige Grenzen:** Bei ausgeschaltetem Mac läuft keine Sicherung. Wenn Proton Drive nicht erreichbar ist, schlägt das Backup sichtbar in den Logs fehl, statt heimlich woanders zu speichern. Die Live-Datenbank bleibt immer außerhalb des synchronisierten Ordners. Für ein wirklich belastbares Backup gelegentlich zusätzlich auf eine externe Festplatte sichern und die Wiederherstellung testen. Auch Löschungen im synchronisierten Ordner können in Proton Drive repliziert werden.

**Backup-Logs:** `~/Library/Logs/ProjectHouseBuilder-backup.log` sowie `ProjectHouseBuilder-backup-error.log`.

## Wiederherstellung auf einem neuen Mac

1. ProjectHouseBuilder auf den neuen Mac kopieren oder aus GitHub auschecken, Python installieren und die Anwendung **noch nicht starten**.
2. Ein vollständiges Backup-ZIP aus Proton Drive lokal verfügbar machen. Prüfen: `python3 backup_manager.py verify "/PFAD/ZUM/Backup.zip"`.
3. Während ProjectHouseBuilder nicht läuft: `python3 backup_manager.py restore "/PFAD/ZUM/Backup.zip" --yes`.
4. Anschließend mit `sh start_mac_linux.sh` starten. Alle Datenbankinhalte und Dokumente sollten wieder vorhanden sein. Mit `sh mac/backup-setup.sh` das Backupziel für den neuen Mac erneut auswählen.

Bei jeder Wiederherstellung erstellt die Software **vorher** eine lokale Sicherung des bisherigen Stands in `restore-safety-...` im Projektordner. Dieser Ordner ist privat und darf niemals in GitHub hochgeladen werden. Der Wiederherstellungsbefehl ersetzt die lokale Datenbank und den Ordner `private/`; daher unbedingt die Anwendung zuvor beenden.

## Synology und PostgreSQL als optionale Alternativen

Die Docker-Dateien `compose.synology.yaml` und `compose.dev.yaml` bleiben für alternative Umgebungen verfügbar, werden für den empfohlenen lokalen SQLite-Betrieb aber nicht benötigt. Diese Backup-Funktion sichert **nur SQLite**. Für eine separate PostgreSQL-Installation ist weiterhin `pg_dump`/`pg_restore` nötig.

---

## Ältere Docker-/PWA-Installationshinweise (optional)

# ProjectHouseBuilder – Heimnetz-PWA

Die bestehende Sanierungsplanung mit Gantt, Angeboten, Annahme-/Kostenlogik, Eigenleistungen und Kontakten ist als responsive PWA verfügbar. Für lokale Entwicklung weiterhin `sh start_mac_linux.sh` mit SQLite, für den Heimnetzbetrieb Docker Compose mit PostgreSQL, Caddy und HTTPS.

## Heimnetz-Installation (Mac, Linux, Windows mit Docker Desktop)

1. Docker Desktop installieren und starten. Stelle sicher, dass kein anderer Dienst die Ports 80 und 443 belegt.
2. Den Rechner, auf dem Docker läuft, per Router-DHCP-Reservierung auf eine feste interne IP setzen (Beispiel: `192.168.178.50`). **Kein Portforwarding am Router einrichten!**
3. `cp .env.example .env` ausführen und `LAN_HOST`, `POSTGRES_PASSWORD`, `APP_PASSWORD`, `APP_SECRET_KEY` anpassen. Für `APP_SECRET_KEY` mindestens 32 zufällige Bytes verwenden, z. B. `python3 -c 'import secrets; print(secrets.token_urlsafe(48))'`. Ändere die beispielhaften Werte vollständig. Die `.env` ist privat und nicht für GitHub bestimmt.
4. `sh start_lan.sh` ausführen (oder unter Windows nach Erstellung der `.env`: `docker compose up --build -d`). Bei Unix für `PUID` und `PGID` ggf. die Werte deiner Benutzerkennung in `.env` ergänzen. Die Datenbank wird beim Erststart automatisch angelegt.
5. Am eigenen Rechner die Anwendung über `https://<LAN_HOST>` öffnen, z. B. `https://192.168.178.50`. Passwort aus `.env` eingeben.
6. **Zertifikat vertrauen:** Caddy stellt eine lokale HTTPS-Zertifizierungsstelle bereit. Das Root-Zertifikat exportieren:

   `docker compose cp https:/data/caddy/pki/authorities/local/root.crt ./private/caddy-root.crt`

   Dieses Zertifikat auf dem Mac, PC, iPhone oder Android-Gerät, auf dem die App genutzt werden soll, **nach bewusster Prüfung** als vertrauenswürdige Stammzertifizierungsstelle installieren. Auf iOS muss unter „Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen“ die vollständige Vertrauensstellung zusätzlich aktiviert werden. Ohne Vertrauensstellung ist zwar eventuell Browserzugriff mit Zertifikatswarnung möglich, aber die PWA-/Service-Worker-Funktion nicht zuverlässig nutzbar. **Den privaten CA-Schlüssel niemals exportieren oder weitergeben.**
7. Anschließend im Browser „Zum Home-Bildschirm“/„App installieren“ wählen. iOS: Safari → Teilen → Zum Home-Bildschirm.

Die App ist ausschließlich im Heimnetz über die IP-Adresse erreichbar, sofern der Router keine Portweiterleitung nutzt und der Host nicht anders öffentlich erreichbar ist. Änderungen an der `LAN_HOST`-IP können eine neue Zertifikatskonfiguration erfordern.

## Backup (wichtig)

`sh backup.sh` erstellt im lokalen, nicht versionierten Ordner `backups/` einen PostgreSQL-Dump **und** ein Archiv von `private/`, also auch hochgeladenen PDF-Dokumenten. Beide Dateien zusammen sicher auf einem zweiten Speichermedium sichern. Eine Wiederherstellung benötigt PostgreSQL `pg_restore` sowie den Inhalt von `private/`. Vor einem Update zuerst ein Backup machen.

## Aktualisieren

`git pull && docker compose up --build -d` (nur wenn das bisherige Arbeitsverzeichnis bereits die richtige `.env` und `private/` enthält). Keine Daten in das öffentliche GitHub-Repository hochladen; `.env`, `private/`, `backups/` und `data/initial_budget.json` werden ignoriert.

## Bestehende SQLite-Daten übernehmen

Ein automatischer SQLite-zu-PostgreSQL-Umzug ist **noch nicht implementiert**. Ein neuer PostgreSQL-Container erhält die unverfänglichen Startaufgaben sowie optional die lokal bereitgestellte Budget-Datei. Für bestehende produktive Daten ist ein gesonderter Migrationsschritt nötig; die alte `sanierung.db` unbedingt sichern und nicht löschen.

## PWA-Einschränkungen

Die App funktioniert auf macOS, Windows, Linux, Android und iOS im Browser. Die PWA speichert lediglich statische CSS-, Icon- und JS-Dateien im Cache; sensible API-Antworten, Verträge, Finanzdaten und HTML-Seiten bleiben **online-only** und sind bei Verbindungsverlust nicht verfügbar. Es gibt keinen Push-Sync und keine Offline-Bearbeitung.

## Sicherheit

Die Heimnetz-Variante verlangt ein Passwort (`APP_PASSWORD`) und ein eigenes Secret (`APP_SECRET_KEY`), setzt sichere Cookies und verwendet HTTPS mit privater CA. Nutze ein ausreichend langes Passwort. Für Zugriff außerhalb des Heimnetzes wäre zusätzliche Absicherung erforderlich. Die öffentliche GitHub-Version enthält keinerlei reale Angebotsunterlagen, private Kontakte oder `.env`.

## Tests

`python -m unittest discover -s tests -v`. Auch GitHub Actions führt die Tests und JavaScript-Syntaxprüfungen aus.

## Synology NAS (separater Feature-Branch)

Fuer Synology Container Manager liegt die passende Compose-Konfiguration unter
[`compose.synology.yaml`](compose.synology.yaml); die genaue Installation steht in
[`synology/README.md`](synology/README.md). Die App nutzt Port **8443 statt 443**,
PostgreSQL und getrennte persistente Docker-Volumes. Keine Router-Portweiterleitung
konfigurieren. Das Projekt ist ein **Feature-Branch** und aendert `main` nicht.

### Neu: Belegjournal mit lokaler OCR

Über `/belege` können Rechnungen und Kassenzettel im PDF-, JPG-, PNG- oder WEBP-Format importiert werden. Lesbare PDF-Texte werden direkt extrahiert, Fotos und Scan-PDFs verarbeitet Tesseract lokal (Dockerfile installiert `tesseract-ocr`, `tesseract-ocr-deu`, `tesseract-ocr-eng` und `poppler-utils`). Bei einer lokalen Python-Installation sind diese Systempakete separat erforderlich. Jeder Beleg beginnt als **Entwurf**, OCR-Vorschläge dürfen manuell bearbeitet werden und zählen erst nach **Verbindlich buchen** zu den Projektkosten. Bezahlungen werden getrennt erfasst. Plan- und Auftragszuordnung hilft gegen Doppelzählung. Originale bleiben im privaten Docker-Volume. Keine Beispiel-Belege und keine Rechnungsdaten in GitHub.

## Eigene Belegkategorien

Unter **Belege & Rechnungen → Eigene Kategorien verwalten** kannst du Kategorien
hinzufügen, umbenennen und unbenutzte Kategorien löschen. Alle Kategorien werden
in PostgreSQL/SQLite gespeichert und im Zuordnungsmenü angezeigt. Bei Umbenennung
werden bereits vorhandene Zuordnungen in Belegen, Budgetzeilen und Kostenpositionen
übernommen. Verwendete Kategorien können nicht gelöscht werden. Die Kategorie
`Sonstiges` ist als sicherer OCR-Fallback geschützt.

Die automatische OCR-Kategorisierung erkennt vorerst die eingebauten Schlüsselwörter;
selbst angelegte Kategorien wählst du manuell aus. Der Import erfasst weiterhin nur
Entwürfe; Kosten werden erst nach deiner Buchungsfreigabe verändert.

## Lokaler Entwicklungs- und Testbetrieb

Ohne Synology kannst du die **gleiche** Anwendung auf dem Mac mit Docker und einer isolierten PostgreSQL-Testdatenbank betreiben. Anleitung: [`dev/README.md`](dev/README.md). Start mit `sh dev/start.sh`, anschließend `http://localhost:5080`. Der Synology-Betrieb bleibt davon unberührt.

## VS Code: lokal starten und DB-Schema sicher aktualisieren

In VS Code das Projekt öffnen, Anwendung vor dem Update beenden, dann:

```sh
git pull
sh start_mac_linux.sh
```

Der Mac-Starter installiert die Python-Abhängigkeiten, prüft anschließend das SQLite-Schema und wendet ausstehende **Alembic-Migrationen** an. **Bei einer vorhandenen Datenbank wird vor jeder notwendigen Migration zwingend ein gültiges ZIP-Backup erstellt (inklusive `private/`), bevor das Schema geändert wird.** Das Backupziel muss zuvor mit `sh mac/backup-setup.sh` konfiguriert werden. Ohne erreichbares Backupziel wird das Upgrade verweigert. Ein frisches, leeres System benötigt noch kein Backup.

Versionsskripte stehen in `migrations/versions/`; `alembic_version` speichert die bereits angewendete Revision. `python schema_manager.py --check` zeigt den Stand. Updates ohne ausstehende Migration erzeugen keine zusätzlichen Zwangsbackups (die täglichen Backups bleiben davon unabhängig).

Ein fehlgeschlagenes Upgrade stoppt den App-Start und meldet das Backup. **Keine automatische Wiederherstellung bei laufenden Prozessen**: Anwendung beenden, Backup prüfen und gezielt mittels `python backup_manager.py restore "/Pfad/Backup.zip" --yes` einspielen.

Das Schema-Update ist **nur im direkten Mac-/SQLite-Startweg** integriert. Docker-/NAS-Container mit PostgreSQL nutzen weiterhin den bisherigen Initialisierer und sind von diesem SQLite-Migrationsbefehl ausgenommen. Datenbankdateien, `instance/` und `private/` sind gitignoriert.
