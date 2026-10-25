# ProjectHouseBuilder auf einer Synology NAS

Die Synology-Version nutzt weiterhin **Flask/Gunicorn**, **PostgreSQL 17** und **Caddy (HTTPS/PWA)**. Sie ist fuer die **Project-Funktion von Synology Container Manager** konzipiert. Es gibt keine offenen PostgreSQL- oder Flask-Ports. **DSM bleibt auf 5000/5001 erreichbar; die App verwendet standardmaessig 8443**.

## Voraussetzungen

- Synology mit **Container Manager** und unterstuetzter Architektur/DSM-Version (bei vielen Modellen DSM 7.2+, nicht jedes NAS wird unterstuetzt). Im Paket-Zentrum pruefen, ob Container Manager installierbar ist.
- Ausreichend freier Speicher und RAM fuer drei Container sowie Internetzugang fuer den einmaligen Image-Download/Build.
- Lokale feste IP fuer die NAS, am besten per DHCP-Reservierung am Router. Beispiel: `192.168.178.20`.
- Keine Router-Portweiterleitung fuer Port 8443 einrichten. Am besten mit der DSM-Firewall Zugriff auf das Heimnetz beschraenken.

## Installation ueber Container Manager

1. Repo-Branch `feature/synology-nas` herunterladen (ZIP/Clone). **Alle Projektdateien**, nicht nur die Compose-Datei, in einen Ordner auf der NAS legen, z. B. unter `/volume1/docker/projecthousebuilder`. Mit Synology **File Station** entpacken/hochladen.
2. `.env.synology.example` nach `.env` kopieren, `LAN_HOST` auf die lokale NAS-IP setzen und alle Platzhalter durch sichere, voneinander unterschiedliche Geheimnisse ersetzen. Den `APP_SECRET_KEY` zufaellig generieren. Die `.env` enthaelt Zugangsdaten und darf nicht in Git/GitHub gespeichert werden.
3. **Container Manager → Projekt → Erstellen**. Als **Projektpfad** den Ordner mit `Dockerfile`, `app.py`, `Caddyfile`, `.env` und `compose.synology.yaml` waehlen. Als Projektname `projecthousebuilder` festlegen. In **Quelle** die Datei `compose.synology.yaml` auswaehlen oder ihren Text in den YAML-Editor kopieren. Bei manchen DSM-Versionen muss die Datei dafuer `docker-compose.yml` heissen. Achtung: Eine benutzte YAML-Datei muss relativ zum gewaehlten Projektordner bleiben (`build: .`).
4. Projekt **erstellen und starten**. Den Build der Flask-App und Download von PostgreSQL/Caddy abwarten. Im Bereich **Container** sicherstellen, dass `db`, `app`, `https` laufen. Falls etwas nicht startet, die Container-Logs pruefen.
5. Browser im Heimnetz: `https://NAS-IP:8443`, z. B. `https://192.168.178.20:8443`. Passwort aus `APP_PASSWORD` verwenden.
6. Das erste Zertifikat ist intern von Caddy ausgestellt. Fuer eine warnungsfreie Verbindung und PWA auf anderen Geraeten muss die lokale Root-CA auf jedem Geraet einmalig vertrauenswuerdig installiert werden (siehe unten).

**Hinweis zu Compose-Variablen:** Container Manager muss die `.env` im Projektordner lesen koennen. Falls Variablen als fehlend gemeldet werden, das Projekt mit `docker compose -f compose.synology.yaml config` ueber SSH pruefen oder die Variablen in den Compose-Projekteinstellungen hinterlegen. Niemals Geheimnisse in den oeffentlichen GitHub-Code schreiben.

## HTTPS und Installation als PWA

Caddy wird **intern** auf 443 und extern auf **8443** betrieben, damit Synologys DSM-Ports frei bleiben. Diese HTTPS-Verbindung ist mit einem lokalen Zertifikat nur dann vollstaendig vertrauenswuerdig, wenn die ausstellende CA auf dem Endgeraet installiert wird. Aus dem Projektordner (SSH mit Docker-Berechtigung):

```sh
docker compose -f compose.synology.yaml cp https:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

`caddy-root.crt` ist **oeffentliches CA-Zertifikat**, aber die Vertrauensstellung ermoeglicht dem Inhaber des **privaten CA-Schluessels** das Ausstellen vertrauenswuerdiger Zertifikate. CA-Key immer auf der NAS behalten, NAS administrativ schuetzen und das Zertifikat nur auf eigenen vertrauenswuerdigen Geraeten installieren. Exportdatei nach erfolgreicher Einrichtung aus dem Projektordner entfernen oder sicher aufbewahren. Den privaten Schluessel **nie** exportieren.

- **macOS:** Zertifikat in Schluesselbundverwaltung importieren und als vertrauenswuerdig markieren.
- **iPhone/iPad:** Profil installieren und danach unter *Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen* das volle Vertrauen aktivieren.
- **Windows/Android:** Zertifikat in den jeweiligen vertrauenswuerdigen Stammzertifikatsspeicher aufnehmen (je nach Browser/Android-Version unterschiedlich).

Danach `https://NAS-IP:8443` ohne Warnung oeffnen, dann im Browser „Zum Home-Bildschirm“ beziehungsweise „App installieren“ verwenden. Offline werden nur statische App-Dateien gecacht; sensible Inhalte bleiben online-only. Auf der NAS und im Browser bleibt dennoch ein Passwort notwendig.

## Backups und Wiederherstellung direkt in der App

Nach dem Update unter **Backup, Export & Daten** den Zielordner konfigurieren. Die App speichert vollständige PostgreSQL-Dumps und private Originaldateien zusammen in einem verifizierbaren ZIP. Für eine Wiederherstellung kann ein vorhandenes ZIP ausgewählt oder ein solches ZIP hochgeladen werden. Nach Prüfung der Prüfsummen, doppelter Bestätigung und Erstellung einer Sicherheitssicherung erfolgt der Datenbankwechsel über eine separat wiederhergestellte und geprüfte PostgreSQL-Datenbank. Der alte Datenbankstand bleibt als `phb_before_…` bestehen und frühere private Dateien bleiben in `private/.restore-safety-…`, bis die Wiederherstellung überprüft wurde. **Währenddessen keine anderen Benutzeraktionen ausführen.** Je nach Archivgröße benötigt der Vorgang Zeit; anschließend Anwendung neu laden und Datensatz, Dokumente und Zahlungseinträge prüfen.

**Wichtig bei der ersten Einrichtung und beim Wechsel zwischen NAS-Freigaben:** Der Browser kann aus Sicherheitsgründen nicht auf beliebige DSM-Verzeichnisse zugreifen. Standardmäßig wird `./backups` unter dem Container-Manager-Projektordner als Basis eingebunden. Optional in `.env` `PHB_BACKUP_DIR=/volume1/DEINE_FREIGABE/DEIN_VERZEICHNIS` setzen und das Compose-Projekt **neu erstellen, ohne Daten-Volumes zu löschen**. Die App verwaltet anschließend frei wählbare Unterordner **innerhalb** dieser Freigabe; sie legt Unterordner bei Bedarf an. Der Compose-Hilfscontainer gibt nur dem Unterordner `projecthousebuilder` Schreibrechte für den App-Benutzer. Bei Änderungen der Mount-Basis erscheinen alte Archive nicht automatisch am neuen Ziel.

Die neue ZIP-Funktion ist **zusätzlich** zum bisherigen Terminal-Backup; beide bleiben verfügbar. Bisherige getrennte `db-*.dump` und `private-*.tar.gz` werden nicht als Komplett-ZIP erkannt und müssen weiterhin über die dokumentierten Shell-Schritte wiederhergestellt werden. Bei PostgreSQL müssen die Wartungsrechte zur Datenbankumschaltung vorhanden sein (in der Standard-Compose-Installation mit `POSTGRES_USER=sanierung` gegeben). **Vor dem ersten produktiven Restore mit Testdaten testen** und ein externes, vom NAS unabhängiges Backup bereithalten. Der automatisierte Web-Restore ersetzt kein extern geprüftes Disaster-Recovery-Konzept.

## Datenhaltung und Backups

Diese Compose-Datei verwendet **vier benannte persistente Docker-Volumes**: `db_data`, `private_data`, `caddy_data`, `caddy_config` (alle mit Projekt-Namensraum `projecthousebuilder`). Sie ueberleben einen normalen Neustart oder Image-Neubau. **Projekt bereinigen/loeschen** kann je nach Container-Manager-Aktion auch Volumes entfernen: vor solchen Aktionen unbedingt Backup erstellen.

Backup ueber SSH, im Projektordner:

```sh
sh synology/backup.sh
```

Es entstehen im Unterordner `backups/` ein PostgreSQL-Dump und ein TAR-Archiv von `private/` (hochgeladene PDFs, Vertrage, Kontakte in der Datenbank). **Beide** sichern. Die Dateien koennen auch durch Synologys Aufgabenplaner regelmaessig gesichert werden, sofern das Docker-Kommando fuer den ausgewaehlten Benutzer funktioniert. Besonders wichtig: Backup auf anderes Speichermedium/NAS/verschluesseltes Laufwerk, nicht nur auf das gleiche Volume.

Wiederherstellung nur in einer gestoppten oder separat vorbereiteten Testinstallation durchfuehren. PostgreSQL-Dump mit `pg_restore` zurueckspielen und `private/` aus dem Archiv in das Volume `private_data` zurueckkopieren. Vor dem produktiven Einsatz das Restore einmal testen. Die Volumes duerfen niemals unbedacht geloescht werden.

## Aktualisieren und alte Daten

- Vor jedem Update ein Backup erstellen.
- Git-Branch aktualisieren und das Container-Manager-Projekt neu **bauen/erstellen**, nicht auf „Bereinigen“ mit Volume-Entfernung klicken.
- Die alte SQLite-`sanierung.db` aus der lokalen Mac-Version wird **nicht automatisch** nach PostgreSQL migriert. Sie bleibt unangetastet; einen Umzug gesondert planen.
- Der neue Server hat bei einer frischen Installation **keine realen Angebote** und keine hinterlegten privaten PDFs. Angebote ueber die Oberflaeche selbst importieren und auf „Angenommen“ setzen.

## Diagnose

- Container startet nicht: in Container Manager die Logs von `db`, `app` und `https` pruefen.
- Port 8443 schon belegt: `HTTPS_PORT` in `.env` aendern, zum Beispiel `9443`, und mit diesem Port aufrufen.
- Anmeldung im Browser funktioniert, App-Installation nicht: Zertifikatsvertrauen pruefen, richtige NAS-IP/Port verwenden und HTTPS-Warnungen beseitigen.
- Datenbank-Passwort **nach** erstem Start geaendert: `POSTGRES_PASSWORD` in `.env` aendert ein bereits bestehendes Postgres-Volume nicht automatisch; Passwort muss im DB-Server ebenfalls geaendert werden.
- Reverse Proxy auf Synology: spaeter moeglich, aber nicht erforderlich. Keine zusaetzliche Exposition zum Internet vornehmen.

Die offizielle Synology-Dokumentation zur Projektverwaltung: https://kb.synology.com/en-global/DSM/help/ContainerManager/docker_project

## Rechnungen und Kassenzettel (lokales OCR)

Unter **Kosten → Rechnungen & Kassenzettel** können PDF, JPG, PNG und WEBP (bis 15 MB) hochgeladen werden. PDFs mit Textebene werden direkt gelesen; bei Scans/Fotos verwenden wir **Tesseract (Deutsch/Englisch)** und Poppler ausschließlich **lokal im App-Container**. Kein externer KI- oder OCR-Dienst erhält die Dateien. Die erste Container-Erstellung installiert deshalb Tesseract und Poppler; auf der DS223 mit 2 GB RAM können große Scans langsamer sein.

Der OCR-Vorschlag wird **immer erst als Entwurf gespeichert**. Lieferant, Datum, Referenz, Brutto/Nettobetrag, Steuern, Gewerk und Zuordnung lassen sich prüfen und korrigieren. Erst nach **Verbindlich buchen** zählt der Beleg in der Kostenübersicht. Ein gebuchter, aber unbezahlter Rechnungsbetrag erhöht nur die Ausgabe/den Ist-Kostenstand, **nicht** die schon gezahlten Beträge. Zahlungen werden getrennt als tatsächlich bezahlter Betrag eingetragen.

**Doppelzählung:** Die Zuordnung zu einer Planposition verhindert, dass das Angebot und die Rechnung zusätzlich voll gezählt werden. Der Planwert wird erst angehoben, wenn die Summe der verbuchten Belege darüber liegt. Belege ohne Zuordnung gelten als zusätzliche Ausgaben. Bei bereits manuell erfassten Zahlungen auf einem verknüpften Auftrag verlangt die Software vorherige Bereinigung. Für Rechnungsnummer und Lieferant sowie identische Upload-Dateien gibt es Dublettenprüfungen. Gutschriften sind zunächst nur als prüfbare Entwürfe möglich.

**Sicherheit / Backup:** Originalbelege und OCR-Texte sind privat unter `/app/private/receipts` beziehungsweise in der Datenbank gespeichert, also im bestehenden `private_data`-Volume. Sie werden vom bestehenden privaten TAR-Backup und vom PostgreSQL-Dump erfasst. JSON-Exporte allein ersetzen kein vollständiges Dateibackup. Bitte Backup und Wiederherstellung regelmäßig testen. Vor einem Update immer sichern.
