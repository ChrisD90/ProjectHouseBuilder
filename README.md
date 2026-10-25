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

## Belegprüfung und Bauzeitenplanung

- Beim PDF-Angebotsimport und beim Hochladen von Rechnungen und weiteren PDF-Belegen wird das Original rechts neben dem Formular angezeigt. Gespeicherte PDFs lassen sich ohne zusätzliches Fenster überprüfen.
- Mit **Abschließen** setzt die Anwendung ein Arbeitspaket auf `Erledigt`, den Fortschritt auf `100 %` und das Ist-Ende auf den aktuellen Tag.
- Angenommene Angebote und beauftragte Kostenpositionen dienen als Quelle für Firmenvorschläge. In der Bauzeitenplanung können passende Firmen einzeln oder gesammelt bestätigt werden. Bereits zugeordnete Firmen bleiben unverändert.
- Euro-Felder formatieren Eingaben mit Tausenderpunkten. Rückfragen und Fehlermeldungen erscheinen in App-Dialogen statt Browser-Popups.

## Entwicklung und Tests

```bash
python -m unittest discover -s tests -v
python -m compileall -q app.py scheduler.py financials.py
node --check static/app.js
node --check static/costs.js
node --check static/offers.js
node --check static/ui.js
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

## PDF-Angebote automatisch auswerten (V5)

Unter **Kosten & Kontakte → PDF-Angebote automatisch auswerten** ein *durchsuchbares* PDF auswählen. Die Analyse findet **ausschließlich auf dem eigenen Rechner** mit `pypdf` statt; es wird nichts an eine KI oder einen externen Server geschickt.

1. Die Anwendung liest – soweit im PDF als Text vorhanden – Anbieter, Angebotsnummer, Datum, Nettosumme, MwSt., Bruttosumme sowie Einzelpositionen und Preise.
2. Einzelpositionen werden nach Leistungsgruppen sortiert. **Optional- und Bedarfspositionen** (z. B. `E.P.`) erscheinen getrennt und werden nicht in den Vertragsbetrag summiert.
3. Die errechnete Summe der enthaltenen Positionen wird mit der **Nettosumme des PDF** abgeglichen. Nicht abgeglichene PDFs dürfen nicht in den Budgetplan übernommen werden.
4. Für jede Gruppe eine aktive Budgetzeile wählen, dann die Checkbox „Prognose“ aktivieren. **Erst dann** wird der Angebotsbetrag anstelle der bisherigen Budgetschätzung berücksichtigt. Mehrere Gruppen derselben PDF auf derselben Budgetzeile ergeben genau **eine** zusammengefasste Kostenposition; so entstehen keine Doppelbuchungen.
5. „Beauftragt“ nur auswählen, wenn der Auftrag tatsächlich erteilt wurde. Die Software kann das **nicht** anhand eines Angebots erkennen. Zahlungen für importierte Angebote können in der Tabelle „Angebote, Aufträge & Ausgaben“ mit dem Button „Zahlung“ erfasst werden.

**Unterstützte PDF-Layouts:** getestet mit textbasierten Positionslisten mit `€`-Spalten (u. a. klassische Angebote mit Positionen und `E.P.`). PDF-Layout und Begriffe variieren zwischen Betrieben stark. **Nicht jedes beliebige Angebot** lässt sich automatisch korrekt analysieren. Bei unlesbaren oder nicht abgeglichenen Dateien: PDF manuell prüfen und das Angebot wie bisher als Kostenposition erfassen. Gescannten PDFs fehlt ohne vorgelagertes OCR die auswertbare Textebene; eine OCR-Funktion ist nicht enthalten. Die Software ist eine Verwaltungshilfe und prüft nicht die rechtliche Bindungswirkung eines Vertrags.

### Datenschutz und Updates

Privat bleiben `private/`, die SQLite-Datei `sanierung.db` und `data/initial_budget.json`  (alle in `.gitignore`). Das **öffentliche** Repository enthält ausschließlich die Software, synthetische Tests und Beispieldaten. ZIP-Versionen können zusätzlich persönlich importierte lokale PDFs enthalten; solche ZIPs bitte **nicht** öffentlich teilen.

Für ein Update der bisherigen lokalen V4-Installation vorher unter **Projektarchiv ZIP** eine Datensicherung erstellen, dann die neuen Quelldateien übernehmen und die bisherige `sanierung.db` und `private/` behalten. SQLAlchemy ergänzt die neue Datenbankstruktur automatisch. Für PostgreSQL zusätzlich `pg_dump` nutzen. Ein Python-Test lässt sich nach Installation der Abhängigkeiten mit `python -m unittest discover -s tests -v` ausführen.

### Individuelle Initialdaten (optional)

Es werden **keine Angebote vorinstalliert oder beim ersten Start automatisch importiert**. PDFs importierst du ausschließlich selbst über „Kosten & Kontakte“. Ein als **Angenommen** markiertes Angebot übernimmt sämtliche regulären (nicht optionalen) Leistungsgruppen als beauftragte Kosten. Unzugeordnete Gruppen werden zusätzlich als eigene Kostenposition erfasst. Bei konkurrierenden Angebotszuordnungen erfolgt keine automatische Überschreibung. Bereits existierende lokale Datenbanken werden niemals beim Start geleert.


### Version 6: leere Angebotsverwaltung

Die Anwendung enthält keine vorinstallierten Angebote, PDF-Beispiele aus echten Firmen oder automatische Erstimporte. Selbst importierte Angebote werden in der lokalen Datenbank abgelegt. Der Status **Angenommen** übernimmt alle regulären Positionen als beauftragte Kosten in die Prognose; bislang nicht zugeordnete Positionen zählen zusätzlich. Um Doppelzählungen gegenüber deiner Grobschätzung zu vermeiden, ordne vor der Annahme möglichst sämtliche Leistungsgruppen den Budgetzeilen zu. Die Anwendung löscht niemals stillschweigend Angebote aus einer bestehenden Datenbank. Bei einem Upgrade behältst du deine vorhandene Datenbank unverändert.
