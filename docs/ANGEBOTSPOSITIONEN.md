# Angebotspositionen

„Positionen“ ersetzt „Nachträge & Änderungen“ im Kopf der Angebotsbearbeitung. Der gestapelte Dialog erlaubt Positionen zu ergänzen, zu bearbeiten und zu entfernen. Menge × Einzelpreis aktualisiert den Positionsbetrag. Nettosumme, Umsatzsteuer und Bruttosumme werden gemeinsam gespeichert; optionale Positionen zählen nicht zur Angebotssumme. Gemischte Steuern unterstützen einen ausdrücklich eingegebenen Umsatzsteuerbetrag. Mögliche Eigenleistungen werden ebenfalls dort markiert. In der normalen Angebotsbearbeitung sind die Beträge nur noch lesbar.

Die Schnittstelle `PUT /api/offers/<id>/positions` prüft Projektzugehörigkeit, bestehende Positions-IDs, Zahlen, mindestens eine nicht optionale Position und einen Fingerabdruck gegen zwischenzeitliche Änderungen. Vorhandene Positions-IDs bleiben erhalten. In einer Förderplanung ausgewählte Positionen müssen dort zunächst abgewählt werden, bevor sie entfernt werden können. Speichern erfolgt atomar. Ein bereits verbindlich angenommener Auftragswert und bestehende Rechnungs-/Zahlungszuordnungen werden dadurch nicht überschrieben; der Dialog zeigt diesen Unterschied ausdrücklich an.

Migration `0043` ergänzt für Angebote ohne Positionen genau eine Sammelposition. Bestehende Positionen, Beträge, Originaldateien, Status, Bestätigungen und Versionshistorien bleiben erhalten. Fehlt das Netto, wird es nur aus bekannten Brutto- und Steuerbeträgen abgeleitet; ansonsten bleibt der Positionsbetrag offen. Es wird kein historischer Steuersatz geraten. Die Ergänzung ist wiederholbar, berücksichtigt die jeweilige Projekt-ID und läuft auch bei direktem App-Start sowie bei der Wiederherstellung älterer Projektbackups. Vor einer nötigen Ergänzung beim Start greift die bestehende Sicherheitskopie.

Validiert: vier gezielte Integritätsprüfungen zu Rundung/Positionssummen, stabilen Förderungsbezügen, veralteten oder projektfremden Eingaben, unverändertem verbindlichem Auftragswert und additiver Datenmigration. JavaScript-Syntax und Patchformat geprüft. Der dedizierte Unterseitenablauf ist inzwischen zusätzlich im isolierten Browser geprüft.


## Excel-/CSV-Import

Im Positionsdialog öffnet „Positionen importieren“ die lokale Prüfung. Dort stehen XLSX- und CSV-Vorlagen bereit. Die Kopfzeile ist verpflichtend und muss exakt folgende Reihenfolge enthalten:

1. Positionsnummer
2. Beschreibung
3. Menge
4. Einheit
5. Einzelpreis netto
6. Positionssumme netto
7. Leistungsgruppe
8. Optional
9. Eigenleistung

CSV: UTF-8, Semikolon (alternativ Komma oder Tab). XLSX: genau ein befülltes Blatt. Keine zusätzlichen Inhaltsspalten oder Formeln; Formelwerte zuvor als feste Werte exportieren. Höchstens 500 Positionen im Angebot. Menge erlaubt sechs, Beträge zwei Nachkommastellen. „Optional“ und „Eigenleistung“ verwenden Ja/Nein; leer entspricht Nein. Fehlt die Positionssumme, wird sie mit kaufmännischer Cent-Rundung aus Menge × Einzelpreis berechnet. Widersprechen sich diese Angaben, wird die Zeile als fehlerhaft markiert.

Die Vorschau erkennt doppelte Positionsnummern innerhalb der Datei, identische bestehende Positionen, abweichende Werte und gleiche Beschreibungen unter anderen Nummern. Bestehende Treffer werden nicht automatisch überschrieben. Je Zeile sind Überspringen, Hinzufügen mit eindeutiger Nummer oder Ersetzen eines eindeutigen vorhandenen Treffers möglich. Fehlerhafte Zeilen können ausschließlich übersprungen werden. Mehrfache Ersetzung derselben Position und neue Nummerndubletten werden abgewiesen.

Vorschau und Konfliktauflösung verändern keine Angebotsdaten. Ein signierter, eine Stunde gültiger Vorschauzustand bindet die Auswahl an Projekt, Angebot und den Stand der offenen Positionen. Zwischenzeitliche Änderungen führen zu einer erneuten Prüfung. Übernahme ergänzt den offenen Positionsdialog, erhält bei Ersetzungen Positions-ID und PDF-Seitenbezug und aktualisiert dessen Summenvorschau. Erst „Speichern“ nutzt die bestehende atomare Positionsschnittstelle. Unbetroffene Positionen bleiben erhalten. Die Importdatei wird nicht dauerhaft abgelegt; eine Datenmigration ist nicht erforderlich.

Zwei gezielte Integritätsprüfungen decken Konfliktentscheidungen, Erhalt der IDs, Schreiben erst beim endgültigen Speichern, veraltete Vorschauen, feste Spaltenreihenfolge, Formelabwehr, Vorlagen und Projekttrennung ab.


## Eigene Angebotsunterseite

Kachel und Stift öffnen `/p/<Projekt-ID>/angebote/<Angebots-ID>` im bestehenden App-Rahmen. Formular und Original-PDF nutzen die Inhaltsfläche der Seite; die Bearbeitung ist kein modales Popup mehr. Auf kleineren Bildschirmen stehen Formular und Vorschau untereinander. Speichern bleibt auf der Unterseite. „Zurück zu Angeboten“ führt zur Sammlung; ungespeicherte Änderungen werden weiterhin vor dem Verlassen abgefragt.

Positionen, Tabellenimport, Anhänge und Versionsverwaltung bleiben als untergeordnete Dialoge erreichbar. Alte Links mit `/angebote?offer_id=<ID>` leiten zur Unterseite weiter. Die Sidebar markiert weiterhin Angebote als aktiv. Projektfremde Angebote sind nicht zugänglich. Keine Datenmigration oder Änderung bestehender Beträge erforderlich.

Validierung dieser Umstellung: Produktionsbuild, eine gezielte Prüfung der projektbezogenen Route und `tests/browser_offer_subpage.cjs` für Öffnen, nicht modale Darstellung, Speichern, gestapelte Positionsbearbeitung, Zurücknavigation und alte Verlinkungen. Der Browsercheck läuft über `dev/ui_browser_smoke.py` mit temporärer Datenbank und eigenen Testdateien.
