# ProjectHouseBuilder – lokale Projektsteuerung für Sanierungen

Eine lokal betriebene Webanwendung mit **Gantt-Plan**, Abhängigkeiten, Gewerken, Firmenkontakten, Kostenübersicht, Angeboten/Beauftragungen, Eigenleistungen, Förderungen und lokaler Dokumentenablage. Benutzeroberfläche auf Deutsch.

## Schnellstart auf macOS / Linux

Voraussetzung: Python 3.10+ und Internetzugang für den **einmaligen** Download der Python-Bibliotheken.

```bash
sh start_mac_linux.sh
```

Alternativ manuell:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```

Dann **http://127.0.0.1:5000** im Browser öffnen. Beenden mit `Ctrl+C` im Terminal.

Windows: `start_windows.bat` ausführen.

Die Daten werden in der lokalen SQLite-Datei `sanierung.db` gespeichert. Beim ersten Start erscheinen **44 anfängliche Arbeitspakete** mit geschätzten Zeitdauern und Abhängigkeiten; Startdatum voreingestellt auf **01.03.2027**. Beides ist frei bearbeitbar. Der Plan arbeitet mit **Kalendertagen**, nicht mit Arbeitstagen oder Feiertagen.

## Mit PostgreSQL / Docker

```bash
cp .env.example .env
# In .env POSTGRES_PASSWORD durch ein eigenes starkes Passwort ersetzen.
docker compose up --build -d
```

Danach ebenfalls **http://127.0.0.1:5000**. SQLite und PostgreSQL sind **alternative Installationen**. Ein Wechsel migriert vorhandene Daten nicht automatisch. `docker compose down` stoppt Container, ohne das Daten-Volume zu löschen; **`docker compose down -v` würde DB-Daten löschen**.

## Kostenübersicht und Excel-Import

Der **öffentliche GitHub-Code enthält absichtlich keinerlei persönliche Budget-/Vertragsdaten**.

Für den individuellen Sanierungsplan kann neben dem Programm eine lokale Datei `data/initial_budget.json` abgelegt werden (Schema siehe `data/initial_budget.example.json`). Nur beim **ersten Import** werden daraus Budgetzeilen, Förderungen, Vergleichsschätzungen und unverbindliche Firmenhinweise übernommen. `data/initial_budget.json` ist per `.gitignore` ausgeschlossen. Bei einer bereits initialisierten Datenbank wird die Datei **nicht erneut** eingespielt. Die personalisierte Download-Ausgabe enthält die aus einer bereitgestellten Excel-Vorlage konvertierte JSON-Datei und das Original unter `private/`.

Im Browser unter **„Kosten & Kontakte“**:

- Projektbudget, Prognose, Abweichung, beauftragte Summen, bezahlte Beträge und Eigenleistungsstunden
- Grobkostenplan mit Gruppen- und Detailzeilen, Bearbeitung und CSV-Export
- Je Planposition Schätzung, ausgewähltes Angebot und verbindlichen Auftrag unterscheiden. Alternativangebote und abgelehnte Angebote zählen nicht mit.
- Eigenleistungen mit Materialkosten und Stunden erfassen. Eigene Stunden werden separat kalkulatorisch ausgewiesen, nicht automatisch als Auszahlung gebucht.
- Förderungen als erwartet/bewilligt/ausgezahlt getrennt verwalten
- Mehrere Firmen und Kontakte mit Telefon/E-Mail, Verknüpfung von Firma und Gantt-Arbeitspaket
- PDF-/DOCX-/XLSX-/Bild-Dokumente zu Firmen, Budgetpositionen und Kostenpositionen lokal ablegen
- Projektarchiv als ZIP inklusive lokaler Dokumente und (bei SQLite) Datenbank-Sicherung herunterladen

**Kostenmethodik:** Jede aktive Budget-Detailzeile wird in der Prognose einmal gezählt. Ausgewählte Angebote ersetzen die Schätzung; eingetragene beauftragte Teilaufträge werden zusammengerechnet. Alternative und abgelehnte Angebote werden nicht addiert. Zusätzliche, unzugeordnete Kostenpositionen erhöhen die Prognose. Tatsächliche Zahlungen werden separat ausgewiesen. Die Eintragungen sind **keine automatische Vertragsprüfung**. Unverbindliche Schätzwerte sind als solche gekennzeichnet.

## Datenschutz / Backups

- Der Server bindet standardmäßig nur an **127.0.0.1**. **Nicht öffentlich ins Internet freigeben.** Es gibt keine Benutzeranmeldung.
- Private Unterlagen und lokale Daten werden **nicht zu GitHub übertragen**. `.gitignore` schützt `private/`, `sanierung.db`, `.env`, `data/initial_budget.json`. Vor Commits mit `git status` kontrollieren.
- Für Backups unter **„Projektarchiv ZIP“** herunterladen. Bei SQLite enthält das Archiv eine konsistente Kopie der Datenbank; bei PostgreSQL ist zusätzlich `pg_dump` erforderlich.
- Lokale Uploads stehen unter `private/documents/`. JSON-Export alleine enthält **nicht** die angehängten PDF-/Bilddateien.
- Die Anwendung verschlüsselt lokale Dateien nicht; Schutz erfolgt durch macOS-Benutzerkonto und ggf. FileVault.

## Termine / Grenzen

- Vorgänger-Beziehungen sind **Ende-zu-Anfang**. Nachfolger starten am Tag nach Vorgängerende plus eingestellter Kalendertags-Pufferzeit.
- Fehlende und zirkuläre Vorgänger werden abgefangen. Ist-Daten und Plantermine sind getrennt.
- **Nicht implementiert:** Feiertagskalender, Ressourcenkonflikte, kritischer Pfad, Rechnungs-PDF-Erkennung, Mehrbenutzerbetrieb, automatische Zahlungsabgleiche, Produktionsauthentifizierung.

## Entwicklung und Tests

```bash
python -m unittest discover -s tests -v
python -m compileall -q app.py scheduler.py financials.py
node --check static/app.js
node --check static/costs.js
```

Abhängigkeiten: Flask, Flask-SQLAlchemy, psycopg. Bei Neuinstallationen werden aktuelle kompatible Versionen aus den in `requirements.txt` angegebenen Bereichen aufgelöst.

## Verzeichnisstruktur

- `app.py`: Flask-API, Datenmodelle, Dokumentenablage, SQLite/PostgreSQL
- `scheduler.py`: berechnete Termine und Abhängigkeiten
- `financials.py`: Prognose-Berechnung ohne Doppelzählung
- `seed.json`: 44 initiale Arbeitspakete **ohne Kontakt- oder Vertragsdaten**
- `data/initial_budget.example.json`: Form der optionalen privaten Importdaten
- `templates/`, `static/`: Gantt und Kostenoberfläche
- `tests/`: Unit-Tests für Termin-/Kostenlogik
- `private/`, `sanierung.db`, `data/initial_budget.json`: persönliche Daten, **nicht committen**
