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
