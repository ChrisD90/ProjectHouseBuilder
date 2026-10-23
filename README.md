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

`start_mac_linux.sh` richtet `.venv` ein, installiert ggf. Abhängigkeiten und führt vor dem Programmstart die **Alembic-Migrationen** aus. Beim Update einer bestehenden SQLite-Datenbank wird **vor jeder nötigen Schemaänderung** ein geprüftes Komplettbackup erzwungen; ohne Backup wird nicht migriert. Die Migrationen bis `0006` erhalten ältere Daten. `0004` entfernt Excel-Metadaten, `0005` ergänzt die Angebots-/Rechnungsüberwachung und `0006` die Zuordnung von Aufgaben zu Eigen-, Fremd- oder noch unbestimmter Ausführung. Echte Kosten-, Beleg-, Kontakt-, Kredit- und Angebotsdaten bleiben davon unberührt. `python schema_manager.py --check` zeigt den Datenbankstand.

Die Git-Regeln schließen unter anderem `sanierung.db`, `*.db`, `*.db-wal`, `*.db-shm`, `private/`, `backups/`, `.env`, `instance/` aus. Diese Dateien niemals in GitHub einchecken. Die Datenbank nie in einem Cloud-Sync-Ordner betreiben; nur vollständige Backups synchronisieren.

## Funktionen

- **Bauzeitenplan (`/`):** Ein ausdrücklich gestarteter, individuell auf die Altbausanierung zugeschnittener **Musterplan mit 69 Arbeitsschritten** (21 Eigenleistungen / 48 Fremdleistungen, 9 Bauphasen) inklusive Abhängigkeiten. Ein Import ist **nur in den leeren Bauzeitenplan** möglich; vorhandene Aufgaben werden niemals überschrieben. Aufgaben können danach bearbeitet, gelöscht, neu erstellt und nach Eigen-/Fremdleistung gefiltert werden. Das Gantt kennzeichnet die Ausführungsart unabhängig vom Fortschrittsstatus.
- **Kosten & Budget:** eigene Budgetpositionen und Schätzwerte, Beauftragungen, Förderungen und Kostenprognose.
- **Angebote (`/angebote`):** Zwei Erfassungswege: PDF hochladen, analysierte Werte prüfen und in die Angebotsliste übernehmen; oder ein Angebot direkt mit Anbieter, Kategorie und Bruttosumme manuell erfassen. Dort vergleichen, korrigieren, annehmen oder ablehnen. Nur angenommene Angebote beeinflussen die Kostenprognose. Rechnungen und Zahlungen bleiben im Belegjournal.
- **Kosten & Budget (`/kosten`):** Ausschließlich Kostenschätzungen und zusätzliche Ausgaben planen; keine zweite Angebotsverwaltung. Angenommene Angebote werden automatisch eingerechnet, aber nicht nochmals bearbeitbar als manuelle Kostenposition angezeigt.
- **Belege:** Rechnungen/Kassenzettel als PDF oder Foto importieren, optional lokal mit Tesseract OCR lesen, prüfen, kategorisieren und erst nach Freigabe buchen.
- **Finanzierung:** Kredite, Eigenkapital, Kreditabrufe, Tilgungen, aufgeteilte Rechnungszahlungen und Liquiditätsvorschau.
- **Datenverwaltung:** Backup auf Knopfdruck, vollständiger Projekt-Reset mit Pflichtbackup.

OCR von Bildern benötigt zusätzlich Tesseract und Poppler auf dem Mac; bei lesbaren PDF-Texten ist kein OCR erforderlich. Die Anwendung ist als lokale Einzelplatzsoftware konzipiert und wird **nicht** per Router-Portweiterleitung veröffentlicht.

## Alternative Betriebsarten

- **Lokale Docker-Tests:** `cp .env.dev.example .env.dev`, sichere Werte vergeben, `sh dev/start.sh`, aufrufen unter `http://127.0.0.1:5080`. Eigene PostgreSQL-Testdatenbank; siehe [dev/README.md](dev/README.md).
- **Synology NAS:** Container Manager mit `compose.synology.yaml`, getrennte PostgreSQL-Datenbank und TLS auf Port 8443; siehe [synology/README.md](synology/README.md). Der Mac-SQLite-Reset und dessen Migrationen gelten **nicht** für PostgreSQL.

## Tests

`python -m unittest discover -s tests -v` prüft die Geschäftslogik, Backups, Migrationen, Sidebar sowie API- und Reset-Sicherheitsbedingungen. GitHub Actions prüft zusätzlich JavaScript-Syntax und Docker Compose.

## Angebotsverwaltung: Einfacher Ablauf

1. In der **linken Sidebar → Angebote** öffnen (`http://127.0.0.1:5055/angebote`).
2. **PDF hochladen** → die App liest lokal aus und legt einen prüfbaren Entwurf an. Firma, Bruttosumme, Kategorie und optional Kostenplanposition kontrollieren und auf „Geprüft – in Liste übernehmen“ klicken. **Oder:** **Manuell erfassen** → Anbieter, Bruttosumme und Kategorie eintragen; direkt „Angebot speichern“ drücken.
3. Alle Angebote in einer Liste nach Gewerk und Gesamtbetrag vergleichen. **Annehmen** überträgt den Preis als beauftragten Wert in die Kostenprognose; Ablehnen behält das Angebot zum Vergleich ohne Kostenwirkung.
4. **Kosten & Budget** dient nur für Schätzungen, zusätzliche Ausgaben und die Gesamtübersicht. Wenn ein Angebot einer Planposition zugeordnet ist, ersetzt der angenommene Preis deren Schätzwert; ohne Zuordnung gilt es als zusätzlicher Auftrag.
5. **Rechnungen & Belege** erfasst tatsächliche Rechnungen, Zahlungen und Finanzierung.

Es ist **keine zusätzliche Datenbankmigration** für diese UI-Vereinfachung nötig. Die manuelle Angebotserfassung nutzt die bestehende Angebotstabelle. Vollständige Sicherungen umfassen weiterhin alle Angebote und privaten PDFs.


## Abschlags- und Schlussrechnungen zu angenommenen Angeboten

Im Bereich **Angebote** zeigt jedes angenommene Angebot eine Abrechnungsübersicht mit
ursprünglicher Brutto-Auftragssumme, gebuchtem Rechnungsstand, tatsächlich bezahlten
Beträgen, Rest und Warnungen ab 80 % beziehungsweise bei Überziehung. Nur gebuchte
Rechnungen gehen in die Abrechnung ein. Der Link **Rechnung zuordnen** öffnet das
Belegjournal mit der passenden Angebotsauswahl; **nur angenommene Angebote** dürfen
verknüpft werden. Auch direkte API-Aufrufe werden darauf geprüft.

Eine Rechnung hat eine Abrechnungsart: Normal, Abschlagsrechnung oder Schlussrechnung.
Enthält eine Schlussrechnung erneut bereits gebuchte Abschläge, werden diese über
**„bereits gebuchte Abschläge enthalten“** vom neuen Rechnungsanteil abgezogen.
Beispiel: Abschläge 8.000 € und 7.000 €, Schlussrechnung über die gesamten 20.000 €
mit 15.000 € Abzug -> 5.000 € zusätzlich abgerechnet. **Enthält eine Schlussrechnung
nur den noch offenen Restbetrag, den Abzug bei null lassen.** Das Originalbrutto bleibt
immer unverändert abrufbar. Ein weiterer Beleg wird nach gebuchter Schlussrechnung
gesperrt, bis diese korrigiert wird. Vorherige Abschläge lassen sich nicht zurücknehmen,
solange eine Schlussrechnung auf sie Bezug nimmt. Gebuchte Belege lassen sich nur
nach Zurücknehmen der Buchung umhängen. Zahlungen und Rechnungswerte bleiben getrennt.

Die neuen Spalten werden per Migration `0005` angelegt. Bei einer vorhandenen SQLite-DB
erstellt der Mac-Start vor der Migration wie gewohnt zwingend ein vollständiges,
geprüftes Backup einschließlich aller Originaldateien.


## Bauzeitenplan: optionalen Musterplan laden

1. **Bauzeitenplan** in der linken Sidebar öffnen: `http://127.0.0.1:5055/`.
2. Im Abschnitt **„Muster-Bauzeitplan übernehmen“** die neun Bauphasen sowie die Zahl von Eigen- und Fremdleistungen ansehen.
3. Einwilligung ankreuzen und **„Musterplan einfügen“** wählen. Es werden 69 Arbeitsschritte und ihre zeitlichen Abhängigkeiten hinzugefügt; alle sind anfänglich „Offen“.
4. Danach jede Aufgabe, Dauer, Vorgänger, Ausführungsart und gegebenenfalls Firma individuell bearbeiten. Über den Filter **„Eigenleistung / Fremdleistung“** kannst du den eigenen Arbeitsanteil isoliert betrachten; CSV-/JSON-Export enthält die Kennzeichnung.

Der Musterplan **wird auf neuen Installationen und nach einem Reset nicht mehr automatisch geladen**. Er wird nie auf einen vorhandenen Plan übertragen; eigene Aufgaben und reale Termine bleiben erhalten. Frühere Bestandsaufgaben werden durch Migration `0006` nicht gelöscht. Ihre Ausführungsart lautet zunächst „Noch offen“, wenn sie nicht eindeutig an der alten Gewerkbezeichnung zu erkennen ist. Vor jedem Schema-Upgrade vorhandener SQLite-Daten ist weiterhin das geprüfte vollständige Backup Pflicht.

Der Inhalt ist ein **unverbindlicher Planvorschlag** für das Haus mit Dach-/Kniestockerhöhung, Terrasse, teilweise gedämmter Fassade, Wärmepumpe, Elektro, Bädern, PV und Smart Home. Die **Dauerangaben sind grobe Kalendertag-Platzhalter**, keine verbindliche Termin- oder Baugenehmigungszusage. Sicherheit, Statik, Förderung, Trocknungszeiten sowie die Gewerke-Reihenfolge müssen anhand des tatsächlichen Bauzustands und der Architekten-/Fachplanung freigegeben werden. Bei Schadstoffen, tragenden Bauteilen, Elektroanschlüssen und Kältemittelanlagen sind entsprechende Fachbetriebe nötig. Baustellenkoordination und mögliche SiGeKo-Pflichten mit der Bauleitung abklären.

**Fachliche Grundlagen des allgemeinen Ablaufs (die individuellen Arbeiten sind daraus abgeleitet, nicht wortwörtlich übernommen):**

- Verbraucherzentrale, [individueller Sanierungsfahrplan / iSFP](https://www.verbraucherzentrale.de/wissen/energie/energetische-sanierung/individueller-sanierungsfahrplan-isfp-modernisieren-mit-koepfchen-59828)
- [Musterbericht Sanierungsfahrplan Baden-Württemberg](https://um.baden-wuerttemberg.de/fileadmin/redaktion/m-um/intern/Dateien/Dokumente/5_Energie/Beratung_und_Information/SanierungsfahrplanBW/Musterbericht_SFP_Anmerkungen_f%C3%BCr_Energieberater.pdf) – Maßnahmenpakete und technisch sinnvolle Abfolge
- BG BAU, [Baustellenverordnung und Koordination](https://bgbauaktuell.bgbau.de/bg-bau-aktuell-12021/artikel-12021/schwerpunkt-baustellenverordnung)
- [Altbausanierung und gewerkeübergreifende Reihenfolge](https://www.schulten-bau.de/blog/die-richtige-reihenfolge-bei-einer-sanierung-welche-gewerke-wann-kommen) – als nichtamtliche Ergänzung für Ausführungsabhängigkeiten

**Bereits alter Musterplan vorhanden?** Unter **Bauzeitenplan** kannst du **„Nur Bauzeitplan leeren (mit Backup)“** wählen. Voraussetzung: ein erreichbarer Backupordner und die Eingabe `BAUZEITPLAN LEEREN`. Bei Verknüpfungen zwischen Kostenpositionen und Aufgaben wird das Leeren verweigert. Die Funktion wirkt nur auf Aufgaben und Abhängigkeiten, nicht auf Finanzen, Angebote, Rechnungen oder hochgeladene PDFs. Sie ist aus Sicherheitsgründen nur lokal mit SQLite verfügbar. Anschließend kann der neue Musterplan eingefügt werden.
