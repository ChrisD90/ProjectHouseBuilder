# ProjectHouseBuilder – Sanierungsprojekt

**Aktuelle Version:** `feature/synology-nas` (eine Codebasis, lokal auf dem Mac oder optional auf der NAS). Die empfohlene Betriebsart ist **SQLite lokal auf dem Mac**, ohne dauerhaften Server.


## Belegprüfung und Firmen im Bauzeitenplan

- Bei **Angeboten** die hochgeladenen PDF-Dateien im Prüf-Dialog direkt neben den erkannten Beträgen und Positionen ansehen. Neue Versionen erhalten dieselbe Vorschau. Auch bei **Rechnungen & Belegen** wird das Original (PDF oder Foto) neben dem Eingabeformular angezeigt.
- Ein Arbeitspaket per Klick öffnen und mit **Abschließen** beenden. Die Anwendung setzt `Erledigt`, `100 %` und das aktuelle **Ist-Ende**, protokolliert den Abschluss aber ändert nicht die geplante Dauer.
- Bei **angenommenen Angeboten** erscheint ein Link **Firma im Bauzeitenplan zuordnen**. Im Bauzeitenplan listet **Firmenvorschläge** mögliche Gewerke/Firmen auf, abgeleitet aus akzeptierten Angeboten und beauftragten Kostenpositionen. Nur nach Bestätigung werden Zuordnungen gespeichert; Eigenleistungen und bestehende Zuordnungen bleiben unberührt.
- Euro-Eingabefelder verwenden deutsche Tausenderpunkte während des Tippens; gespeichert werden weiterhin reine Zahlen. Bestätigungen und Rückfragen erscheinen in einem kleinen Dialog innerhalb der App.

## Schnellstart in VS Code (macOS)

1. Das Projekt in VS Code öffnen; ggf. `git switch feature/synology-nas` ausführen.
2. Updates einspielen: `git pull origin feature/synology-nas` (vorher laufende App beenden).
3. **Einmalig** den Backupordner auswählen: `sh mac/backup-setup.sh` (z. B. in Proton Drive). Die aktive Datenbank bleibt **außerhalb** synchronisierter Ordner.
4. Starten: `sh start_mac_linux.sh`.

**Intel-Mac mit Python 3.13:** Seit `cryptography` 49 existieren keine vorgebauten macOS-x86_64-Pakete mehr.
ProjectHouseBuilder verwendet deshalb auf Intel-Macs automatisch die letzte kompatible 48.x-Version mit fertigem Wheel, ohne OpenSSL/Rust aus dem Quellcode bauen zu müssen.
Die RS256-Signaturprüfung für ChatGPT-OAuth bleibt aktiv. Der Start verweigert einen Quellcode-Build von `cryptography`, anstatt halb installiert weiterzulaufen.
Falls die Abhängigkeitsinstallation fehlschlägt: `git pull origin feature/synology-nas` und anschließend `sh start_mac_linux.sh` erneut ausführen.
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

`start_mac_linux.sh` richtet `.venv` ein, installiert ggf. Abhängigkeiten und führt vor dem Programmstart die **Alembic-Migrationen** aus. Beim Update einer bestehenden SQLite-Datenbank wird **vor jeder nötigen Schemaänderung** ein geprüftes Komplettbackup erzwungen; ohne Backup wird nicht migriert. Die Migrationen bis `0006` erhalten ältere Daten. `0004` entfernt Excel-Metadaten, `0005` ergänzt die Angebots-/Rechnungsüberwachung, `0006` die Zuordnung von Aufgaben zu Eigen-, Fremd- oder noch unbestimmter Ausführung und `0008` die explizite Rechnungszuordnung. Bereits bestehende Rechnungen bleiben erhalten; bisherige Zuordnungen zu Kostenpositionen werden übernommen und nicht automatisch als Eigenleistung deklariert. Echte Kosten-, Beleg-, Kontakt-, Kredit- und Angebotsdaten bleiben davon unberührt. `python schema_manager.py --check` zeigt den Datenbankstand.

Die Git-Regeln schließen unter anderem `sanierung.db`, `*.db`, `*.db-wal`, `*.db-shm`, `private/`, `backups/`, `.env`, `instance/` aus. Diese Dateien niemals in GitHub einchecken. Die Datenbank nie in einem Cloud-Sync-Ordner betreiben; nur vollständige Backups synchronisieren.

## Funktionen

- **Bauzeitenplan (`/`):** Ein ausdrücklich gestarteter, individuell auf die Altbausanierung zugeschnittener **Musterplan mit 69 Arbeitsschritten** (21 Eigenleistungen / 48 Fremdleistungen, 9 Bauphasen) inklusive Abhängigkeiten. Ein Import ist **nur in den leeren Bauzeitenplan** möglich; vorhandene Aufgaben werden niemals überschrieben. Aufgaben können danach bearbeitet, gelöscht, neu erstellt und nach Eigen-/Fremdleistung gefiltert werden. Das Gantt kennzeichnet die Ausführungsart unabhängig vom Fortschrittsstatus.
- **Kosten & Budget:** eigene Budgetpositionen und Schätzwerte, Beauftragungen, Förderungen und Kostenprognose.
- **Angebote (`/angebote`):** Zwei Erfassungswege: PDF hochladen, analysierte Werte prüfen und in die Angebotsliste übernehmen; oder ein Angebot direkt mit Anbieter, Kategorie und Bruttosumme manuell erfassen. Dort vergleichen, korrigieren, annehmen oder ablehnen. Nur angenommene Angebote beeinflussen die Kostenprognose. Rechnungen und Zahlungen bleiben im Belegjournal.
- **Kosten & Budget (`/kosten`):** Ausschließlich Kostenschätzungen und zusätzliche Ausgaben planen; keine zweite Angebotsverwaltung. Angenommene Angebote werden automatisch eingerechnet, aber nicht nochmals bearbeitbar als manuelle Kostenposition angezeigt.
- **Belege:** Rechnungen/Kassenzettel als PDF oder Foto importieren und wahlweise **lokal** (PDF-Text/Tesseract OCR) oder nach ausdrücklicher Freigabe mit **ChatGPT** analysieren. Belege anschließend prüfen und **genau einer Zuordnungsart** zuweisen: angenommenes Angebot, Betrieb oder Eigenleistung. Die Budgetposition bleibt separat auswählbar; keine automatische Buchung.
- **Finanzierung:** Kredite manuell erfassen oder Kreditunterlagen ausdrücklich mit ChatGPT auslesen und Vertragsfelder vor dem Speichern prüfen. Briefe, Vertrags-PDFs und gescannte Dokumente lassen sich am einzelnen Kredit anhängen; außerdem Eigenkapital, Kreditabrufe, Tilgungen, aufgeteilte Rechnungszahlungen und Liquiditätsvorschau.
- **Stammdaten (`/stammdaten`):** Firmen und automatisch aus PDF-Angeboten übernommene Betriebe zentral pflegen: Ansprechpartner, weitere Kontakte, Telefonnummern, E-Mail, Website, Adresse und Notizen. Separate Gewerke und gemeinsam genutzte Rechnungs-/Kostenkategorien anlegen, umbenennen und – falls unverknüpft – löschen.
- **Backup, Export & Datenverwaltung (`/daten`):** geprüfte vollständige Sicherungen einschließlich PDFs und Bildern, CSV-/JSON-Exporte, ZIP-Projektarchiv, Wiederherstellungshinweise. Der vollständige Reset ist hinter „Erweiterte Aktionen“ verborgen und bleibt nur nach Pflichtbackup möglich.

OCR von Bildern benötigt zusätzlich Tesseract und Poppler auf dem Mac; bei lesbaren PDF-Texten ist kein OCR erforderlich. Die Anwendung ist als lokale Einzelplatzsoftware konzipiert und wird **nicht** per Router-Portweiterleitung veröffentlicht.

## Alternative Betriebsarten

- **Lokale Docker-Tests:** `cp .env.dev.example .env.dev`, sichere Werte vergeben, `sh dev/start.sh`, aufrufen unter `http://127.0.0.1:5080`. Eigene PostgreSQL-Testdatenbank; siehe [dev/README.md](dev/README.md).
- **Synology NAS:** Container Manager mit `compose.synology.yaml`, getrennte PostgreSQL-Datenbank und TLS auf Port 8443; siehe [synology/README.md](synology/README.md). Der Mac-SQLite-Reset und dessen Migrationen gelten **nicht** für PostgreSQL.

## Tests

`python -m unittest discover -s tests -v` prüft die Geschäftslogik, Backups, Migrationen, Sidebar sowie API- und Reset-Sicherheitsbedingungen. GitHub Actions prüft zusätzlich JavaScript-Syntax und Docker Compose.

## Angebotsverwaltung: Einfacher Ablauf

1. In der **linken Sidebar → Angebote** öffnen (`http://127.0.0.1:5055/angebote`).
2. **PDF hochladen** → die App liest lokal aus und legt einen prüfbaren Entwurf an. Vor der Übernahme kannst du **jede erkannte Einzelposition aufklappen, ändern oder löschen** und **weitere Positionen etwa aus gesonderten Beiblättern hinzufügen**. Mengen, Einzelpreise, Netto-Positionsbeträge, Leistungsgruppen, optionale Positionen und PDF-Seiten lassen sich korrigieren. „Aus Menge × Einzelpreis berechnen“ schlägt auf Wunsch einen Betrag vor. Eine leere Positionsliste ist bei nicht lesbaren Scans erlaubt. Die Summe der nicht-optionalen Positionen wird mit dem geprüften Angebotsnetto verglichen; Differenzen und fehlende Beträge werden angezeigt, der **Bruttogesamtbetrag nie automatisch überschrieben**. Den Entwurf bei Bedarf zwischenspeichern und erst dann „Geprüft – in Liste übernehmen“ wählen. **Oder:** **Manuell erfassen** → Anbieter, Bruttosumme und Kategorie eintragen; direkt „Angebot speichern“ drücken.
3. Alle Angebote in einer Liste nach Gewerk und Gesamtbetrag vergleichen. **Annehmen** überträgt den Preis als beauftragten Wert in die Kostenprognose; Ablehnen behält das Angebot zum Vergleich ohne Kostenwirkung.
4. **Kosten & Budget** dient nur für Schätzungen, zusätzliche Ausgaben und die Gesamtübersicht. Wenn ein Angebot einer Planposition zugeordnet ist, ersetzt der angenommene Preis deren Schätzwert; ohne Zuordnung gilt es als zusätzlicher Auftrag.
5. **Rechnungen & Belege** erfasst tatsächliche Rechnungen, Zahlungen und Finanzierung.

Es ist **keine zusätzliche Datenbankmigration** für die einfache Bedienung oder den Positionseditor nötig. Bereits gespeicherte PDF-Einzelpositionen liegen in der bestehenden Angebotstabelle und bleiben erhalten. Nach der Übernahme in die Angebotsliste sind die Positionen gegen nachträgliche Änderungen gesperrt; zunächst ggf. vor der Annahme den PDF-Entwurf korrigieren. Vollständige Sicherungen umfassen weiterhin alle Angebote und privaten PDFs.


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


### Angebotsversionen (Historie statt Dubletten)
Auf der Seite `/angebote` kannst du bei einem bestehenden Angebot **Neue PDF-Version analysieren** auswählen.
Das PDF wird als **Versionsentwurf** eingelesen und kann inklusive Einzelpositionen
geprüft, ergänzt und korrigiert werden. Bis zum Klick auf **Als aktuelle Version übernehmen**
bleibt das vorherige Angebot gültig und als einziges in der Liste sichtbar.
Der Versionswechsel archiviert Original-PDF, Netto-/Bruttobeträge, Anbieter,
Notizen und alle bearbeiteten Positionen der bisherigen Version unveränderbar.
Unter **Versionshistorie** sind sämtliche Fassungen und PDFs einsehbar.
Bei bereits angenommenen Angeboten bleiben Angebots-ID, Aufträge und Rechnungen
verknüpft; die bestätigte neue Bruttosumme wird zum aktuellen Auftragswert.
Eine Änderung der Kostenplanposition ist bei bestehenden Rechnungen oder
Zahlungen aus Sicherheitsgründen gesperrt.
Vor der Schema-Migration `0007` wird automatisch ein vollständiges Backup verlangt.


## Optionales ChatGPT-Konto auf dem lokalen Mac (nur Plannutzung)

Das ChatGPT-Konto kann auf **http://127.0.0.1:5055/** über die Schaltfläche im Header
verbunden werden. Die Anmeldung verwendet die öffentlich dokumentierte dynamische
Open-Source-Registrierung von OpenAI mit PKCE/OIDC. Ein API-Schlüssel und ein
separater kostenpflichtiger API-Fallback sind weder erforderlich noch vorhanden.
OpenAI-Authentifizierung, Konto-/Workspace-Auswahl und Plannutzungsfreigabe erfolgen
im Systembrowser. Nur Plus-/Pro- beziehungsweise jeweils berechtigte Konten können
entsprechende KI-Funktionen verwenden; Verfügbarkeit variiert.

**Kostenhinweis:** Falls die Nutzung zusätzlicher Credits für Apps in ChatGPT
aktiviert ist, können nach Ende des Plankontingents Credits verbraucht werden.
Die Anwendung kann diese fremde Kontoeinstellung **nicht prüfen** und deshalb
auch keine absolute Zero-Cost-Garantie bieten. Vor jeder KI-Anfrage muss deshalb
bestätigt werden, dass die Nutzung zusätzlicher Credits in ChatGPT → Einstellungen
→ Nutzung deaktiviert ist. Bei Modell-/Nutzungsfehlern bricht die Anwendung ab,
ohne zusätzliche API-Schlüssel oder eine andere Rechnungsroute zu verwenden.

Die Zugangstokens werden **außerhalb** des Repositories und der vollständigen
Projektbackups in `~/.config/ProjectHouseBuilder/chatgpt/` als Dateien mit
Besitzerzugriff (0600) abgelegt. Browser-JavaScript erhält nie ein Token.
Sign-in- und KI-Endpunkte sind nur auf Loopback verfügbar; für LAN-/Docker-Zugriff
sind sie absichtlich nicht aktiviert. Die bestehenden lokalen Funktionen bleiben
jederzeit unabhängig von ChatGPT nutzbar.

- Angebote: Analyseart lokal oder ChatGPT auswählen; KI-Ergebnisse sind *Entwürfe*,
  die vor Übernahme geprüft und bearbeitet werden. Auch neue Angebotsversionen.
- Angebotsvergleich: Zwei bis acht geprüfte Angebote auswählen. Nur Angebotsdaten
  und Positionen, nicht die PDFs, werden übertragen; es entsteht ein Bericht,
  **keine** automatisch gebuchte Kostenzahl.
- Zeitplan: KI-Vorschläge für einen leeren Plan können nach Vorschau bestätigt
  übernommen werden; für bestehende Pläne gibt es zunächst Änderungsempfehlungen
  ohne automatische Änderung. Aufgaben werden wie vorher auf Zyklen geprüft.

Referenz: https://developers.openai.com/siwc/token-sharing-open-source/sign-in
und https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference

Die Anmeldung selbst benötigt eine echte Zustimmung im Browser und kann nicht in
CI simuliert werden. Automatisierte Tests verwenden keine echten Zugangsdaten.

## Rechnungen: lokale Erkennung, ChatGPT und eindeutige Zuordnung

Unter **Rechnungen & Belege** beim Hochladen zwischen „Lokal analysieren“ (Standard, keine Übertragung an ChatGPT) und „Mit ChatGPT analysieren“ wählen. Für ChatGPT muss die lokale Verbindung aktiv sein und die Bestätigung zur Nutzung des ChatGPT-Plans im Verbindungsdialog gesetzt sein. Bei ChatGPT gehen nur die explizit ausgewählte PDF-Datei oder das Foto an OpenAI. Beide Analysearten legen **nur einen Entwurf** an: erkannte Werte immer gegen das Original kontrollieren, danach ausdrücklich speichern und buchen. Ein fehlgeschlagener KI-Aufruf wird nicht unbemerkt durch einen anderen Anbieter ersetzt.

Im Prüfbereich ist die Zuordnungsart exklusiv:
- **Angenommenes Angebot**: eine der angenommenen und ausgewählten Angebotspositionen wählen; die bestehende Abrechnung einschließlich Abschlägen/Schlussrechnung bleibt erhalten.
- **Betrieb**: einen unter Stammdaten → Firmen & Ansprechpartner angelegten Betrieb wählen, ohne Angebotsverknüpfung.
- **Eigenleistung / Material**: Ausgaben ohne Betrieb und ohne Angebot zuordnen.

Die **Budgetposition** ist davon grundsätzlich unabhängig, soweit die Angebotsabrechnung nicht bereits eine feste Budgetverknüpfung vorgibt. Gebuchte Belege können erst nach Zurücknehmen der Buchung umgehängt werden. Für historische Rechnungen mit alten Kostenpositionsverknüpfungen bleibt diese Zuordnung bestehen, damit frühere Buchungen und Finanzierungszuordnungen unverändert bleiben.

Der Start auf dem Mac führt vor der neuen Schema-Migration `0008` wie gewohnt ein verifiziertes Backup aus. Ohne erreichbares Backup-Ziel wird die Migration aus Sicherheitsgründen abgebrochen. Die ChatGPT-Analyse nutzt ausschließlich die bereits verbundene Plannutzung; es gibt keinen kostenpflichtigen API-Key-Fallback.

## Kreditassistent, Dokumente und Rechnungs-Umsatzsteuer

In **Finanzierung → Darlehen → + Kredit** bleibt der manuelle Weg erhalten. Alternativ im Kreditdialog eine Vertrags-PDF oder ein Vertragsfoto auswählen und **„Mit ChatGPT vorausfüllen“** starten. Nur nach ChatGPT-Verbindung und bestätigter Plannutzung wird die Datei übertragen. ChatGPT liefert **einen Vorschlag**, niemals eine fertige Buchung. Fehlende oder unplausible Konditionen werden gekennzeichnet; Kreditsumme, Sollzins, Monatsrate, Tilgung, Sondertilgung und Datumsangaben unbedingt mit den Vertragsunterlagen abgleichen. Erst der ausdrückliche Klick auf **„Kredit speichern“** legt die Daten an.

Für bestehende Kredite erscheint darunter **„Kreditunterlagen & Schriftverkehr“**. PDF, JPG, PNG und WEBP bis 15 MB können mit optionaler Beschreibung angehängt, wieder heruntergeladen oder einzeln entfernt werden. Sie werden lokal unter `private/loans/` gespeichert, gehören zum vollständigen Projektbackup und werden nicht automatisch an ChatGPT weitergegeben. Ein Kredit mit Dokumenten lässt sich erst nach deren ausdrücklicher Entfernung löschen.

Unter **Rechnungen & Belege** gibt es bei der manuellen Änderung des Bruttobetrags die Auswahl **19 %**, **7 %**, **0 %** oder **„Gemischte Steuersätze / manuell“**. Bei festen Sätzen werden Nettobetrag und Umsatzsteuer auf Cent genau automatisch aus dem Brutto zurückgerechnet. Vorhandene erkannte Werte werden beim Öffnen eines Belegs nicht verändert. Bei gemischten Steuersätzen, Steuerbefreiungen oder Sonderfällen die Beträge selbst nach dem Originalbeleg erfassen und kontrollieren.

Die Datenbankmigration **`0009`** ergänzt lediglich die Dokumententabelle zu Krediten. Bestehende Kredite, Zahlungen und Rechnungen bleiben unverändert. Der Mac-Starter führt vor der Migration das obligatorische geprüfte Komplettbackup aus.

## Zentrale Stammdaten und Datenverwaltung (Migration 0010)

Unter **Stammdaten** (`/stammdaten`) lassen sich Firmen und Kontakte, Gewerke sowie die in Rechnungen, Angeboten und Kostenplanung verwendeten Kategorien pflegen. Beim PDF-Angebotsimport automatisch übernommene Firmen erscheinen in **derselben Firmenliste** und können dort ergänzt werden. Zusätzliche Stammdatenfelder sind weiterer Ansprechpartner, Mobiltelefon, zweite Telefonnummer und Website. Das Umbenennen eines Gewerks aktualisiert gleichlautende Gewerke bei Firmen und Gantt-Arbeitspaketen. Die Kategorien sind davon getrennt; ihre Umbenennung wird in Rechnungen, Angeboten und Kostenpositionen nachgeführt. Verwendete Einträge werden nicht ungeprüft gelöscht.

Auf den Arbeitsseiten **Kosten & Budget** und **Rechnungen & Belege** sind keine separaten Firmen- oder Kategorien-Einstellungsbereiche mehr vorhanden. Für das Zuweisen einer Firma bleibt auf der jeweiligen Arbeitsseite ein Auswahlfeld mit einem Verweis zu den Stammdaten.

Unter **Backup, Export & Daten** (`/daten`) liegen sämtliche Download-Optionen (Bauzeitenplan-CSV, Kostenplan-CSV, Kosten-/Auftrags-CSV, strukturierte JSON-Daten und das Projekt-ZIP) sowie die geprüften vollständigen Sicherungen und Wiederherstellungsanleitung. CSV/JSON sind **keine** vollständige Datensicherung; für wiederherstellbare Uploads und Datenbank das geprüfte Komplettbackup verwenden. Die selten benötigte Löschfunktion ist eingeklappt. Bereits bestehende Daten, Firmen, Angebote und Buchungen bleiben bei der Umstellung erhalten.

Vor Datenbankmigration `0010` legt der lokale Starter wie bisher zwingend ein geprüftes Backup an. Die Anwendung darf dafür nicht parallel laufen.


## Gantt-Dialog mit ChatGPT und Entscheidungshistorie (Migration 0011)

Der **Bauzeitenplan** bietet nach einer Verbindung mit ChatGPT bei bereits vorhandenen Arbeitspaketen einen Dialog „Mit dem Bauzeitenplan sprechen“. Hier können neue Vorhaben, Eigenleistungen, Planungsänderungen oder Rückfragen in ganzen Sätzen besprochen werden. Beim Senden werden die aktuellen Arbeitsschritte einschließlich Abhängigkeiten, Projektstart und die jüngsten bestätigten Entscheidungen über die ausdrücklich freigegebene ChatGPT-Plannutzung übertragen. Bei unklaren Wünschen kann ChatGPT nachfragen, ohne einen Plan zu verändern.

Der Assistent liefert gegebenenfalls **strukturierte Änderungen**: Arbeitspakete hinzufügen, einzelne Daten anpassen oder unverknüpfte Aufgaben entfernen. Die Antwort wird auf erlaubte Felder, eindeutige Codes, fehlende Vorgänger und Zyklen geprüft. Danach erscheint eine **Vorschau jedes betroffenen Arbeitsschritts mit Alt-/Neuwerten**. Nichts wird beim Senden geändert. Erst der Klick auf **„Änderungen bestätigen und übernehmen“** speichert alle geprüften Änderungen zusammen und berechnet die Folgetermine neu. Der Vorschlag kann stattdessen verworfen werden. Wenn sich der Plan zwischen Vorschau und Freigabe verändert oder eine zu löschende Aufgabe inzwischen mit Kosten verknüpft ist, wird die Übernahme blockiert. Vorschläge sind an die lokale Browsersitzung gebunden und nach 15 Minuten nicht mehr freigabefähig.

Die **Entscheidungs- und Änderungshistorie** ist standardmäßig eingeklappt. Sie speichert Zeitpunkt, Nachricht, KI-Antwort, bestätigte Entscheidung, Status und die konkret geänderten Felder. Auch manuelle Änderungen an Arbeitspaketen, Projektstart und der ersten Planung werden erfasst. Die Historie befindet sich lokal in der Projektdatenbank und ist im verpflichtenden Komplettbackup enthalten. Eine Diskussion ohne Änderung wird als solche dokumentiert; abgelehnte Änderungen werden nicht angewendet.

Ist **noch kein Bauzeitenplan vorhanden**, erscheinen der Muster-Bauzeitenplan und – bei verbundener ChatGPT-Plannutzung – die alternative KI-Erstplanung. Bei einem **bestehenden** Plan verschwinden die beiden Erstplanungsbereiche; der ChatGPT-Dialog ist ausschließlich bei bestehender Verbindung sichtbar. Die optionale Historie bleibt unabhängig von der ChatGPT-Verbindung einsehbar. Das vollständige Leeren des Plans ist nur unter „Erweiterte Aktionen“ mit Pflichtbackup und gesonderter Bestätigung möglich.

Die Migration **`0011`** ergänzt nur die Historientabelle. Bereits bestehende Termine, Aufgaben, Firmen- und Kostenverknüpfungen bleiben beim Update erhalten. Für alle Termin- und Abhängigkeitsänderungen ist weiterhin fachliche Prüfung erforderlich.


## Einheitliches UI, Dark Mode und Ladefeedback (Oktober 2026)

Die sieben Hauptseiten verwenden jetzt dasselbe **Designsystem** (`static/ui.css`) mit gemeinsamen Farben, Abständen, Eingabefeldern, Karten, Buttons und Fokuszuständen. Die bisherige lokale Bootstrap-5-Basis sowie die vorhandenen Formulare und JavaScript-Workflows bleiben erhalten; eine zusätzliche Online-Abhängigkeit oder ein riskanter Wechsel der UI-Bibliothek ist nicht notwendig. Insbesondere auf kleinen Bildschirmen wurden die Abstände, Filterleisten, Formularfelder und Dialoge harmonisiert.

Über **Darstellung → System / Hell / Dunkel** in der oberen Leiste lässt sich das Erscheinungsbild umschalten. „System“ folgt der Betriebssystemeinstellung, die beiden expliziten Einstellungen bleiben lokal im Browser gespeichert (`localStorage`). Weder Kreditdaten noch Dokumente werden für die Designfunktion übertragen.

Der globale Request-Monitor (`static/ui.js`) erkennt asynchrone `/api/`-Aufrufe im Browser. Normale längere Ladeaktionen erhalten nach kurzer Verzögerung eine schlanke Aktivitätsleiste; Uploads, lokale Rechnungserkennung, ChatGPT-PDF-/Kredit-/Zeitplananalysen, Backups und andere längere Aktionen zeigen einen zusätzlichen Spinner mit Tätigkeitsbeschreibung. Die Ladeanzeige bleibt sichtbar, bis die jeweilige Anfrage tatsächlich beantwortet oder abgebrochen wurde; sie erfindet keinen Prozentfortschritt. Auslöser-Buttons erhalten während laufender Aktionen eine dezente Spinner-Markierung. Anmeldedaten und Dateiinhalte werden nicht in der Ladeanzeige dargestellt.

Die Dateien `static/ui.css` und `static/ui.js` sowie die Symbolgrafik werden über den bestehenden Service Worker lokal zwischengespeichert. Bei alten gecachten Ansichten gegebenenfalls den Browser hart neu laden (`Cmd+Shift+R`). Bestehende Projektdaten, Buchungen, Einstellungen der Sicherungen und Migrationshistorie bleiben unverändert; es ist **keine Datenbankmigration** erforderlich.


## Rechnungen: gesonderter Arbeits-/Lohnkostenanteil (Migration 0012)

Beim Upload von Rechnungen und Belegen wird jetzt unabhängig von Brutto-, Netto- und Umsatzsteuerbetrag ein **Arbeits-/Lohnkostenanteil brutto** vorgeschlagen. Das funktioniert sowohl mit der lokalen PDF-Text-/OCR-Erkennung als auch mit der explizit bestätigten ChatGPT-Analyse. Beide Verfahren suchen nach gesondert ausgewiesenen Positionen (Arbeitslohn, Lohnkosten, Montagearbeiten und vergleichbare Begriffe) und schließen Materialpositionen aus. Ist eindeutig erkennbar, dass nur Netto-Lohnkosten angegeben sind, wird nur bei unzweideutig ausgewiesenem Umsatzsteuersatz auf brutto umgerechnet. Unklare Angaben erhalten eine Warnung. **Ein fehlender Wert bleibt NULL, nicht automatisch 0 €.**

Im Rechnungsentwurf findest du ein abgesetztes Eingabefeld **„Arbeits-/Lohnkostenanteil brutto (€)“**. Der Wert kann nach jeder Analyse korrigiert oder ohne automatische Erkennung eigenständig eingegeben werden. Die Belegübersicht weist vorhandene Lohnkosten gesondert aus; außerdem wird gezählt, in wie vielen Belegen ein Anteil hinterlegt ist. Ein gespeicherter automatisch vorgeschlagener Wert bleibt als solcher gekennzeichnet, bis er inhaltlich verändert wird. Nach der Buchung sind Lohnkosten wie andere Rechnungsbeträge geschützt; für Korrekturen die Buchung zuerst zurücknehmen. Der Lohnkostenanteil ist **nur eine Dokumentationsposition**, keine weitere Zahlung und keine eigenständige Kostenbuchung. Die normale Finanzierungs-, Abschlags- und Rechnungslogik wird davon nicht verändert.

**Steuerlicher Hinweis:** Lohnkosten müssen auf der Rechnung separat ausgewiesen sein; gegebenenfalls kommen Maschinen- und Fahrtkosten einschließlich der entsprechenden Umsatzsteuer hinzu. Materialkosten sind nicht begünstigt. Ob eine Steuerermäßigung nach § 35a EStG möglich ist, hängt u. a. vom eigenen Haushalt, unbarer Zahlung, Art der Maßnahme und gegebenenfalls bereits erhaltener öffentlicher Förderung ab. **Die Anwendung bewertet diese Anspruchsvoraussetzungen nicht automatisch.** Insbesondere vor dem eigenen Einzug oder bei geförderten Sanierungsmaßnahmen steuerlichen Rat einholen und keine automatisch erkannten Summen ungeprüft in die Steuererklärung übernehmen.

Die Migration `0012` ergänzt nur die optionalen Spalten `receipt.labor_amount` und `receipt.labor_source`. Bestehende Rechnungen behalten ihren Originalzustand; fehlende Lohnanteile werden nicht geschätzt oder pauschal auf null gesetzt. Der bewährte Starter prüft vor der Migration das obligatorische Komplettbackup.


## Projektdokumente (Migration 0013)

Unter /dokumente lassen sich Baupläne, technische Zeichnungen, Versicherungsunterlagen, Verträge und Genehmigungen zentral speichern, suchen und bearbeiten. PDF, DOCX, TXT, JPG, PNG und WEBP bis 12 MB sind möglich. Dateien liegen privat unter private/project-documents; die Datenbank speichert Titel, Kategorie, Bereich, Status, Schlagworte und Beschreibung. Originale und Metadaten gehören zum geprüften Komplettbackup.

Beim Hochladen wird vorhandener PDF-/DOCX-/TXT-Text ausschließlich lokal ausgelesen. Scans und Zeichnungen werden nicht automatisch oder ungefragt von ChatGPT interpretiert. Im Bauzeitenplan-Chat lassen sich je Nachricht bis zu drei aktuelle Dokumente explizit auswählen. Nur diese Dateien werden dann im Rahmen der bereits freigegebenen ChatGPT-Anfrage übertragen. Antworten sollen Dokumentquellen als DOK-ID bezeichnen; verwendete Dateiversionen mit Prüfsumme werden in der Entscheidungshistorie festgehalten. Änderungen am Bauzeitenplan bleiben bestätigungspflichtig.

Die separate Projektdokumentation verändert keine vorhandenen Angebots-PDFs, Rechnungen oder Kreditanhänge. Alte Dokumentfassungen können den Status Überholt erhalten. Die Auswahlfunktion ist serverseitig wiederverwendbar und kann später auch beim Angebotsvergleich oder anderen KI-Funktionen eingesetzt werden. Technische Fachprüfungen werden dadurch nicht ersetzt.


## Dezente Upload-Einstiege und durchgängige Bearbeitungsdialoge (Oktober 2026)

Datei-Uploads sind auf den Arbeitsseiten nicht mehr als dauerhaft große Formulare sichtbar. Für **Angebote**, **Rechnungen & Belege**, **Projektdokumente** und zugeordnete **Kostenunterlagen** gibt es einen kurzen Upload-Button. Der einheitliche, responsive Dialogstil liegt in `static/workflow-dialogs.css` und unterstützt Hell/Dunkel. Die bereits vorhandenen Kreditdialoge verwenden für optionale ChatGPT-Kreditdokumente und Kredit-Anhänge standardmäßig geschlossene, aufklappbare Abschnitte.

Bei **Angeboten** bleibt nach lokaler oder ChatGPT-PDF-Analyse derselbe Dialog geöffnet und zeigt den importierten Entwurf mit Korrekturen der Angebotsdaten und sämtlichen Einzelpositionen. Speichern, Prüfen, Freigeben und Hochladen überarbeiteter Versionen gehören zum bestehenden Ablauf; die Angebotsliste und das KI-Vergleichswerkzeug bleiben auf der Hauptseite. Über „Offene Entwürfe prüfen“ lässt sich der Bearbeitungsdialog erneut öffnen. Neue Versionen können an vorhandene Angebote angehängt und anschließend im Dialog geprüft werden.

Bei **Rechnungen** öffnet die Analyse den vollständigen Prüfschritt **im selben Modal**: Rechnungsbeträge, USt, Lohnkosten, Zuordnung zu Angebot/Betrieb/Eigenleistung, Notizen, Originalbeleg, Speichern und verbindliches Buchen funktionieren dort weiter. Klicks auf bestehende Belege in der Übersicht öffnen ebenfalls den Bearbeitungsdialog. Bereits gebuchte Beträge sind weiterhin geschützt.

Bei **Projektdokumenten** folgt auf den Upload unmittelbar der Bearbeitungsdialog für Titel, Klassifikation, Schlagworte und aktuellen Dokumentstatus. Die zentrale Bibliothek bleibt ohne Uploadformular sichtbar. Bei **Kosten & Budget** wurden die bestehenden Dokumenten-Zuordnungsfelder zusammen mit dem Dateiupload in einen Dialog verlegt. Dateien werden nur nach der bisherigen bewussten Benutzeraktion verarbeitet.

Alle Uploaddialoge behalten Lade- und Fehlermeldungen sichtbar, während ein Vorgang läuft; die Schließen-Aktion wird während eines aktiven Uploads blockiert. Es wurden keine Datenbanktabellen, Endpunkte, Backups oder fachlichen Beleg-/Angebots-Freigaberegeln verändert. Die vorhandene UI-Bibliothek musste nicht gewechselt werden.


## Serielle Dokumentenverarbeitung im Hintergrund (Migration 0014)

Unter **Angebote**, **Rechnungen & Belege** und **Projektdokumente** können jetzt bis zu **acht Dateien auf einmal** ausgewählt werden. Angebote akzeptieren PDF; Rechnungen PDF und Bilddateien; Projektdokumente PDF, DOCX, TXT und Bilder. Der jeweilige Dialog lädt die Dateien zuerst auf den lokalen ProjectHouseBuilder-Server und fügt sie einer **einzigen seriellen Warteschlange** hinzu. Pro Datei gelten weiterhin die ursprünglichen Größenlimits (i. d. R. 15 MB bei Angeboten/Rechnungen, 12 MB bei Projektdokumenten), insgesamt maximal 75 MB je Anfrage. Die Dateien werden dort nacheinander ausgeführt; es gibt keine parallelen ChatGPT-Auswertungen durch diese Warteschlange.

Angebote und Rechnungen unterstützen die Wahl **lokal / ChatGPT** wie bisher. ChatGPT wird ausschließlich nach expliziter Freigabe der Plannutzung und mit dem gewählten Modell gestartet. Keine API-Schlüssel, kein kostenpflichtiger Fallback, keine automatische Buchung. Die Hintergrundaufträge verwenden dieselben bestehenden geprüften Importfunktionen, sodass PDF-Entwürfe, Einzelpositionen, Lohnkosten und Rechnungszuordnungen nach Abschluss **unverändert manuell geprüft** werden können.

Unten links im App-Layout erscheint eine kleine **Importübersicht** mit Warteschlangen- und Bearbeitungsstatus für jede Datei. Bei ChatGPT werden echte Übergänge sichtbar: Anfrage vorbereiten, Verbindung zu ChatGPT, Prüfung, eintreffende Antwort, Speicherung des Entwurfs. Es wird kein fiktiver Prozentfortschritt behauptet. Die Aufgaben laufen serverseitig weiter, wenn du zwischen Projektseiten wechselst; der lokale Python-Prozess muss geöffnet bleiben. Die auslösende Uploadfunktion bleibt bis zum tatsächlichen Ergebnis gesperrt, auch wenn die Warteschlange den Upload bereits angenommen hat. Ein laufender Analysedialog lässt sich bis dahin nicht schließen. Nach Fertigstellung führt die Benachrichtigung mit **„Prüfen und bearbeiten“** direkt in den jeweiligen Prüf- bzw. Metadaten-Dialog. Optional sind Browser-Benachrichtigungen möglich, sofern der Browser die Erlaubnis dafür erhalten hat.

Aufträge, Metadaten und die temporären Originaldateien bleiben lokal unter `private/import-queue/` beziehungsweise in der Datenbank gespeichert. Bei einem Anwendungsneustart werden gerade laufende oder wartende Aufträge **als unterbrochen markiert und niemals heimlich wiederholt** (wichtig bei KI-Nutzungsgrenzen und möglichen schon angelegten Entwürfen). Fehler und unterbrochene Aufträge können vom Nutzer bewusst erneut gestartet werden, solange die temporäre Datei vorhanden ist. Ein erfolgreich abgeschlossener Auftrag entfernt diese temporäre Kopie, während das Original in der regulären Dokumentenablage verbleibt. Temporäre und reguläre Originale sind Bestandteil eines vollständigen Projektbackups.

Migration `0014` ergänzt ausschließlich die lokale Import-Warteschlangentabelle. Die verpflichtende Vorab-Sicherung wird weiterhin durch `schema_manager.py` durchgeführt. Kein externer Dienst oder separater Queue-Server ist notwendig; in der vorgesehenen lokalen Einprozess-Ausführung genügt der Daemon-Worker.


## Abgeschlossene Importe, Angebotskacheln und Standard-Stammdaten (Oktober 2026)

Die Importübersicht zeigt nur noch offene, laufende, fehlerhafte und **noch nicht fachlich geprüfte** Dateien. Nach der bewussten Übernahme eines Angebots in „Deine Angebote“ (oder nach Ablehnung), nach Freigabe/Verwerfen einer neuen Angebotsversion, nach explizitem Speichern eines geprüften Belegs beziehungsweise dessen Buchung sowie nach Speichern der Metadaten eines Projektdokuments wird der Importauftrag auf **„Übernommen“** gesetzt und aus der **aktiven** Warteschlange ausgeblendet. Der Datensatz des Importauftrags und der Originalbeleg bleiben zu Nachweiszwecken bestehen; es werden keine Projektunterlagen gelöscht. Falls ein Import noch nicht entschieden wurde, bleibt die Prüfen-Schaltfläche erhalten.

„Deine Angebote“ zeigt kompakte, responsive Kacheln mit Anbieter, Gewerk, Status und Bruttosumme. Annehmen, Ablehnen und Bearbeiten bleiben direkte Schnellaktionen, sofern der fachliche Status dies erlaubt. Ein Klick auf den Kachelkopf öffnet zusätzliche Angaben, Positionsübersicht, Versionshistorie und – bei beauftragten Angeboten – den Rechnungsfortschritt. Bestehende Regeln zum Schutz angenommener Angebote gelten unverändert.

Die primären Upload-/Erfassungsbuttons befinden sich bei Angeboten, Rechnungen, Kostenunterlagen und Projektdokumenten sowie „+ Kredit erfassen“ in der **rechten Ecke des jeweiligen Seiten-Headers** (gemeinsame Klasse `phb-action-header`); sekundäre Aktionen bleiben verfügbar.

Beim ersten Initialisieren der Stammdaten werden die üblichen Renovierungsgewerke genau **einmal** angelegt. Manuelle Änderungen oder Löschungen erscheinen nicht beim Neustart wieder. Unter Stammdaten gibt es für **Gewerke** und für **Rechnungs-/Kostenkategorien** jeweils eine ausdrücklich bestätigte Schaltfläche zur Wiederherstellung der Standards. Die bestehenden Anfangskategorien stammen unverändert aus `receipt_parser.CATEGORIES`. Die Rücksetzung fügt fehlende Standardbezeichnungen hinzu und entfernt nur unbenutzte eigene Einträge. Bereits mit Firmen, Bauzeitenplanaufgaben, Rechnungen, Angeboten oder Kostenpositionen verknüpfte Bezeichnungen werden nicht entfernt, sondern im Ergebnis als erhalten ausgewiesen. Bestehende Zuordnungen, Buchungen und Beträge bleiben erhalten.


## Finanzierung, Rechnungszahlungen und Importmeldungen (Oktober 2026)

**Projektbudget = Summe der vereinbarten Darlehensrahmen + Eigenkapital-Startbestände + spätere Eigenkapitaleinzahlungen − Entnahmen.** Kreditabrufe sind keine zusätzlichen Mittel, Zahlungen und Tilgungen werden nicht ein zweites Mal vom Projektbudget abgezogen. Die Kostenansicht zeigt diese verfügbare Finanzierungsbasis im Vergleich zur aktuellen Kostenprognose. Unter **Finanzierung** liegen „+ Kredit erfassen“ und „+ Konto“ nebeneinander im Seitenkopf; der bisherige manuelle Budget-Ändern-Button ist entfernt. Ältere gespeicherte freie Budgetwerte sind nicht mehr maßgeblich, und direkte Änderungen über `/api/budget/config` werden mit einem Hinweis abgelehnt. Kreditraten, Abrufe, Eigenkapitalreserve und verfügbare Zahlungsmittel werden weiterhin separat geführt.

Der Bereich **„Rechnungen bezahlen“** liegt jetzt im bestehenden Belegbearbeitungsdialog unter **Rechnungen & Belege**. Nach Klick auf eine **gebuchte Rechnung** öffnet die Aktion „Rechnung bezahlen“ einen vierstufigen Ablauf: Kredit/Eigenkapital wählen, konkrete Finanzierungsquelle auswählen, Betrag (auch Teilzahlung) und Datum ergänzen, Zahlung bestätigen. Angezeigt werden offene Summe, bereits bezahlte Beträge sowie bisherige Zuordnungen. Einzelne Zahlungszuordnungen können dort storniert werden. Verwendet werden weiterhin die geprüften Endpunkte `/api/financing/payments` – keine neue oder doppelte Kostenbuchung. Zahlungen ohne Quelle können als „Nicht zugewiesen“ bestehen bleiben und später ohne erneute Zahlung zugeordnet werden. Kreditzahlungen setzen tatsächlich abgerufene und noch ungebundene Kreditmittel voraus. Die bisherige Liquiditätsvorschau wurde vorläufig aus der Finanzierungsoberfläche entfernt.

Die globale **Importwarteschlange** bietet pro abgeschlossenem/fehlgeschlagenem/unterbrochenem Auftrag „Ausblenden“ sowie die Sammelaktion „Erledigte ausblenden“. Offene und gerade laufende Aufträge sind geschützt. Die Jobs bleiben für die technische Nachvollziehbarkeit als archivierte Datensätze erhalten, verschwinden aber aus der aktiven Übersicht; Originaldokumente, Angebote und Rechnungen werden **nicht** gelöscht. Für fehlgeschlagene Aufträge wird die temporäre Warteschlangendatei beim endgültigen manuellen Ausblenden entfernt; eine erneute Analyse erfordert dann einen neuen Upload. Bereits fachlich übernommene Aufträge verschwinden ebenfalls aus der aktiven Liste.

## Kostenplan importieren, energetische Planung und Firmenergänzung (Migration 0015)

Unter **Kosten & Budget → Kostenplanung** kannst du weiterhin Positionen manuell
anlegen oder eine Kostenaufstellung aus PDF, XLSX, CSV, DOCX, TXT oder Bildern
hochladen. Bis zu acht Dateien werden über dieselbe serielle Hintergrundwarteschlange
wie Angebote und Rechnungen analysiert: lokal oder ausdrücklich mit ChatGPT.
Excel-/CSV-Tabellen sollten Spalten wie **Position**, **Gewerk**, **Schätzung** oder
**Gesamtpreis** besitzen. XLSX-Formeln brauchen gespeicherte Ergebniswerte; alte
`.xls`-Dateien bitte vorher als `.xlsx` oder CSV speichern.

Nach der Analyse führt **Prüfen und bearbeiten** zum Entwurf. Beträge, Gewerke,
Leistungsart, Firmenhinweise und Notizen lassen sich ändern; Zeilen lassen sich
entfernen und ergänzen. Summen-/Gruppenzeilen zählen nicht zur Prognose.
Vollständigkeit und **Bruttobeträge** ausdrücklich prüfen. Entwürfe können ohne
Kostenwirkung gespeichert werden. Erst die bestätigte Übernahme ergänzt die
bestehende Planung um neue **Schätzungen**, ohne alte Positionen zu überschreiben.
Bereits manuell erfasste Positionen vorher aus dem Entwurf entfernen, um doppelte
Ansätze zu vermeiden. Das Original bleibt geschützt in der Dokumentenbibliothek
und im Komplettbackup erhalten. Ein identisches Dokument wird nicht erneut importiert.
Die lokale Extraktion ist ein Hilfsmittel; beliebige Architektenlayouts können
nicht zuverlässig automatisch rekonstruiert werden.

**Energetische Planung** ist ein eigener Sidebar-Bereich. Bestehende Förderungen
bleiben erhalten. Fördergeber, Programm, Status, Fristen, Quellen und Verknüpfungen
zu Angeboten oder Planpositionen lassen sich manuell ergänzen. Erwartete,
bewilligte und ausgezahlte Beträge bleiben getrennt; Bruttokosten und
Finanzierungskapital werden nicht automatisch umgebucht. Angenommene Angebote
bieten den Einstieg **Förderung prüfen**. Offizielle Recherchequellen und ein
Vorschlag für die spätere fachliche Angebotsprüfung stehen in
[docs/ENERGETISCHE_PLANUNG.md](docs/ENERGETISCHE_PLANUNG.md).

Unter **Stammdaten** befinden sich Hinzufügen und Standardwiederherstellung im
jeweiligen Abschnittskopf, optisch getrennt. Die früheren Eingabezeilen filtern
nun Gewerke beziehungsweise Kategorien; neue Einträge entstehen in Dialogen.
Beim Anlegen einer Firma erscheint nach Eingabe des Namens **nur bei bestehender
ChatGPT-Verbindung** die Frage nach einer Ergänzung. Erst Zustimmung überträgt
Firmenname und optional Ort für eine Webrecherche. Mehrere Treffer werden mit
Quellen angezeigt. Die Auswahl ergänzt leere Kontaktdaten und bleibt vor dem
Speichern bearbeitbar. Es gibt keine Google-Integration und keinen zusätzlichen
Suchdienst-Schlüssel. Wenn Konto oder Modell keine Websuche unterstützen, wird
dies angezeigt; es werden keine Firmendaten aus reinem Modellgedächtnis übernommen.
Die bestehende Beschränkung von ChatGPT auf direkten lokalen Zugriff bleibt bestehen.

Migration `0015` ergänzt zwei Tabellen für Importentwürfe und Förderdetails.
Bestehende Budget- und Förderdaten werden nicht gelöscht oder umgeschrieben.
Der SQLite-Starter verlangt bei bestehenden Datenbanken weiterhin ein geprüftes
Vorabbackup. Auf NAS/Docker werden die neuen Tabellen beim Initialisieren angelegt;
für die neue Excel-Abhängigkeit ist ein Image-Neubau erforderlich. Die Caddy-
Konfiguration erlaubt Originalvorschauen innerhalb derselben Herkunft (`SAMEORIGIN`),
während Einbettung durch fremde Websites gesperrt bleibt.


## Geschützte Arbeitspakete, Gantt-Verschiebung und Uploads

- **Abgeschlossene Arbeitspakete:** Nach Status „Erledigt“ bleiben ausschließlich
  Notizen, Vorgänger und Nachfolger bearbeitbar. Name, Firma, Ausführungsart,
  Dauer, Status, Fortschritt und Ist-Daten sind auch bei direkten API-Aufrufen
  und KI-Vorschlägen geschützt. Abgeschlossene Pakete können nicht gelöscht
  oder im Gantt verschoben werden.
- **Abhängigkeitsrichtung:** „Vorgänger – muss vorher fertig sein“ und
  „Nachfolger – beginnt danach“ sind zwei getrennte Auswahlen. Beide bearbeiten
  denselben gerichteten Graphen; Selbstbezüge und Zyklen werden abgewiesen.
- **Einzelne Arbeitspakete löschen:** Vorhandene Nachfolger verhindern das
  Löschen nicht mehr. Sie werden mit den bisherigen Vorgängern des gelöschten
  Pakets verbunden; andere Abhängigkeiten bleiben erhalten und doppelte
  Verbindungen werden vermieden. Verknüpfte Kosten verhindern weiterhin das
  Löschen. Die Änderung wird protokolliert.
- **Gantt:** Offene Balken horizontal ziehen und loslassen, um ihren Start
  tageweise zu verschieben. Dauer und Abhängigkeiten bleiben erhalten,
  Nachfolger werden neu berechnet. Escape bricht die Geste ab. Alternativ
  einen Balken fokussieren und Alt + Pfeil links/rechts verwenden
  (mit Umschalt sieben Tage). Ein Termin vor Projektstart oder vor dem Ende
  seiner Vorgänger inklusive Abstand wird mit einer Meldung abgewiesen.
  Zwischenzeitlich veränderte Pläne werden nicht überschrieben.
- **Upload-/Analysesicherung:** Angebote, Angebotsversionen, Belege,
  Projektdokumente und Kostenpläne warten auf das endgültige Ergebnis jeder
  Datei. HTTP 202 bedeutet lediglich „eingereiht“ und hebt die Sperre nicht auf.
  Fehler geben die Aktion frei und bleiben sichtbar; erfolgreiche Dateien eines
  teilweise fehlgeschlagenen Durchgangs bleiben zur Prüfung erhalten.
  Nach einem Seitenwechsel wird die Sperre aus dem Serverstatus wiederhergestellt.
  Andere Bereiche bleiben erreichbar. Direkte Analysen, z. B. Kreditdokumente,
  sperren ihre auslösende Aktion bis zum vollständigen Ergebnis oder Fehler.

Die Änderungen benötigen keine zusätzliche Datenbankmigration. Der Service-Worker-
Cache wurde aktualisiert. Die Datenprüfung erfolgt weiter auf dem Server;
Oberflächensperren ersetzen keine Fachvalidierung.


## Bezahlt ohne Finanzierungsquelle, Rechnungsstorno und Abschluss zurücknehmen

- Eine **gebuchte Rechnung** kann mit **Als bezahlt markieren** vollständig oder
  über **Zahlung erfassen → Später zuordnen** teilweise bezahlt werden, auch ohne
  angelegtes Konto oder Darlehen. Diese Beträge erscheinen als **Nicht zugewiesen**.
- Unter **Zahlung erfassen → Erfasste Zahlungen → Finanzierung zuordnen** wird
  später ein Kredit oder Eigenkapitalkonto gewählt. Teilzuordnungen sind möglich.
  Dabei ändert sich der bereits bezahlte Betrag nicht. Das gilt auch für ältere,
  direkt am Beleg gespeicherte Zahlbeträge. **Zuordnung lösen** erhält die Zahlung;
  **Zahlung zurücknehmen** macht den Betrag wieder offen.
- **Rechnung stornieren** zeigt zuerst die betroffenen Rechnungs- und Zahlbeträge.
  Nach Bestätigung werden Buchung, Zahlungsvermerke und Finanzierungszuordnungen
  zusammen zurückgenommen. Der Beleg bleibt mit Status **Storniert**, Original,
  Grund und unveränderlicher Stornohistorie erhalten. Eine echte Rücküberweisung
  erfolgt dadurch nicht. Ein Storno lässt sich nicht als neuer Entwurf bearbeiten;
  eine korrigierte Rechnung separat erfassen. Eine verrechnete Abschlagsrechnung
  kann erst nach Rücknahme/Storno der zugehörigen Schlussrechnung storniert werden.
- **Buchung zurücknehmen** bleibt für normale Entwurfskorrekturen verfügbar;
  vorhandene Zahlungszuordnungen müssen dafür weiterhin zuerst zurückgenommen werden.
- Abgeschlossene Arbeitspakete bieten **Abschluss zurücknehmen**. Dabei werden
  vorheriger Status/Fortschritt und Ist-Ende aus der Historie wiederhergestellt.
  Bei alten Paketen ohne Abschlussereignis gilt Offen / 0 % / kein Ist-Ende.
  Notizen und Abhängigkeiten bleiben erhalten. Bei abgeschlossenen Paketen sind
  Speichern und Löschen ausgeblendet; Notizen, Vorgänger und Nachfolger werden
  automatisch gespeichert. Fehler werden sichtbar angezeigt.
- Die **ChatGPT-Planung** liegt wieder als Floating Button rechts unten. Sie ist
  nur bei bestehender ChatGPT-Verbindung und vorhandenem Bauzeitenplan sichtbar.
  Die Schaltfläche zum Verbinden im Kopfbereich bleibt verfügbar.

Migration `0016` ergänzt ausschließlich die Tabelle für Stornohistorien. Bestehende
Rechnungen, Zahlungen, Kredit- und Eigenkapitaldaten werden nicht umgeschrieben.
Beim lokalen SQLite-Update erstellt der Starter zuvor wie bisher ein verifiziertes
Komplettbackup; bei NAS/Docker wird die neue Tabelle beim Initialisieren angelegt.
