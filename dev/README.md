# ProjectHouseBuilder lokal testen (macOS, Windows, Linux)

**Kein eigener App-Code-Fork und kein zusätzlicher Entwicklungsbranch erforderlich.** Verwende `feature/synology-nas` für lokale Tests und für Synology; die Docker-Konfigurationen unterscheiden sich, der Anwendungscode nicht. Alle produktiven Features sind identisch. Die lokale Datenbank, Belege und Passwörter sind von der NAS vollständig getrennt.

## Voraussetzungen

- Docker Desktop (macOS/Windows) oder Docker Engine + Compose v2 (Linux)
- Docker muss gestartet sein.
- Für Docker Desktop mit ARM-Macs werden ARM64-Basisimages verwendet; auch x86_64 ist unterstützt.

## Start auf macOS / Linux

1. Branch `feature/synology-nas` klonen bzw. herunterladen.
2. Im Projektordner: `cp .env.dev.example .env.dev`.
3. In `.env.dev` drei **verschiedene, sichere** Werte für `DEV_POSTGRES_PASSWORD`, `DEV_APP_PASSWORD` und `DEV_APP_SECRET_KEY` vergeben. Der Datenbankwert sollte ausschließlich alphanumerische/URL-taugliche Zeichen enthalten. Der geheime Schlüssel sollte mindestens 32 zufällige Zeichen besitzen. Diese Datei ist gitignoriert.
4. `sh dev/start.sh` ausführen. Beim ersten Start lädt Docker die Images und installiert die OCR-Pakete; deshalb ist zunächst Internet erforderlich.
5. `http://localhost:5080` öffnen, mit `DEV_APP_PASSWORD` anmelden.
6. `sh dev/check.sh` prüft, ob die Login-Seite erreichbar ist.

**Windows PowerShell:** `Copy-Item .env.dev.example .env.dev`; Datei bearbeiten; `docker compose --env-file .env.dev -f compose.dev.yaml up --build -d`.

## Arbeiten und Testen

- Dateien unter `app.py`, `templates/` und `static/` werden in den Container eingebunden; Gunicorn `--reload` übernimmt Python-Änderungen automatisch.
- Änderungen an `requirements.txt` oder am `Dockerfile`: `sh dev/start.sh` erneut ausführen, damit das Image neu gebaut wird.
- Protokolle: `sh dev/logs.sh`.
- Stoppen: `sh dev/stop.sh`. **Stoppen löscht keine Daten**.
- Nur Testdaten komplett löschen: `sh dev/reset.sh --delete-test-data`, danach Sicherheitsabfrage. Dabei werden **nur** die beiden mit `projecthousebuilder-dev` benannten Volumes gelöscht, nicht die NAS-Volumes.
- Automatisierte Tests ohne Docker: `python -m unittest discover -s tests -v` (benötigt Python-Abhängigkeiten); mit Docker: `docker compose --env-file .env.dev -f compose.dev.yaml exec app python -m unittest discover -s tests -v`.

## Schutz und Grenzen

- Port wird ausschließlich auf `127.0.0.1` gebunden: **Andere Geräte im WLAN können diesen Testserver nicht erreichen.**
- Lokales HTTP ist **nur** für `localhost` vorgesehen. Kein Portforwarding, keine NAS-IP und keine Freigabe des Testservers ins Netzwerk.
- PostgreSQL besitzt **keine** veröffentlichte Host-Portfreigabe.
- Testdaten und private PDF-Belege werden ausschließlich in Docker-Volumes `projecthousebuilder-dev_dev_pgdata` und `projecthousebuilder-dev_dev_private` abgelegt.
- Die Produktions-NAS nutzt andere Projekt- und Volume-Namen. Keine Backups der NAS in dieses lokale Testsystem importieren, wenn sie echte persönliche Daten enthalten und nicht unbedingt benötigt werden.
- Browser-PWA auf `localhost` ist grundsätzlich möglich. Der lokale Service Worker cached statische Dateien; er liefert keine Offline-Kopie privater Belege.

## Spätere Synchronisierung

Der Code für Test und NAS liegt im **selben Branch** `feature/synology-nas`. Du testest Änderungen zuerst lokal und startest nach einem Backup später denselben Commit auf der NAS. Die Testdaten bleiben auf dem Mac und werden **nicht** mit GitHub oder der NAS synchronisiert.


## Browser-Regressionsprüfung (optional)

Die OCR-Pakete und beide Sprachen werden beim Docker-Build und vor jedem
Containerstart geprüft. `python ocr_runtime.py --check` prüft eine native Installation;
`sh scripts/ensure_ocr.sh` richtet fehlende Systempakete ein. Nach Installation der
Python-Abhängigkeiten testet `python dev/ocr_smoke.py` echte Foto- und PDF-OCR mit
synthetischen Daten. GitHub Actions prüft dies auch auf macOS und Linux.
Intel-Macs ab macOS 11 verwenden `.runtime/ocr` mit Micromamba/conda-forge;
Apple Silicon verwendet Homebrew. Beide Architekturen besitzen einen eigenen CI-Lauf.

`python3 dev/browser_regressions.py` prüft Drag-and-drop, geschützte abgeschlossene
Aufgaben, beide Abhängigkeitsrichtungen, Uploads bis zum endgültigen Ergebnis,
Fehlerfreigabe, Wiederaufnahme nach Navigation und die neun Seiten bei
360/768/1440 Pixeln. Voraussetzung: Playwright im ausführenden Python und ein
installiertes Chromium (`chromium` im PATH), außerdem die Projektabhängigkeiten
in `.venv`. Der Testserver bindet einen automatisch vergebenen freien Loopback-Port und
verwendet ausschließlich temporäre synthetische Daten. Optional speichert
`PHB_BROWSER_SCREENSHOTS=/tmp/phb-ui-review python3 dev/browser_regressions.py`
Screenshots für die visuelle Kontrolle.
ChatGPT- und Importantworten werden für die Verzögerungs-/Fehlerprüfungen simuliert.
Für echte OCR- und ChatGPT-Ergebnisse weiterhin Originaldateien fachlich prüfen.

`python3 dev/css_regressions.py` kontrolliert zusätzlich die gemeinsamen Buttons,
gefüllte Budgettabellen und Kostenformulare sowie den geöffneten/geschlossenen
Chat bei 360/768/1024/1440 Pixeln in beiden Farbschemata. Kurze Browserfenster
und mobiles Querformat prüfen die Erreichbarkeit des Chat-Eingabebereichs.
Voraussetzungen und Datenisolation entsprechen dem Browser-Test oben. Screenshots
liegen standardmäßig unter `/tmp/phb-css-review`; `PHB_CSS_SCREENSHOTS` ändert den Zielordner.

## Gemeinsame Button- und Layoutregeln

`static/buttons.css` definiert normale Aktionsbuttons (40 px Mindesthöhe),
kompakte Tabellen-/Listenaktionen (32 px, mobil 40 px), Primär-/Löschaktionen
sowie Hover-, Fokus-, Lade- und deaktivierte Zustände. `ui.js` ergänzt die
Klasse `phb-button` auch in dynamisch erzeugten Inhalten. Navigations-, Karten-,
Symbol- und Floating-Controls behalten ihre eigene Geometrie. Seiten-CSS regelt
die Anordnung der Aktionen; Buttonfarben, Schrift und Innenabstände gehören in
die gemeinsame Datei.

`kosten.css` gilt ausschließlich für Kosten & Budget. `gantt.css` ordnet
Planaktionen und Filter an. `schedule_chat.css` besitzt die Floating-Button- und
Chatfenster-Regeln; frühere Toolbar- und Kreis-Varianten nicht wieder in `ui.css`
ergänzen. Diese Komponenten-CSS-Dateien werden vor `buttons.css` geladen.
