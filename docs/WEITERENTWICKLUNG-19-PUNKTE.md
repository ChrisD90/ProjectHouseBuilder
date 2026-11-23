# Umsetzung der 19 freigegebenen Verbesserungen

Branch: `feature/weiterentwicklungen` · Datenbankschema: `0042`.

Die Reihenfolge war Datensicherheit und Buchungslogik, Hintergrundprozesse und Entwürfe, anschließend gemeinsame UI und Performance. Bestehende Daten werden additiv erweitert. Historische Arbeitszeitregeln und vollständig ausgezahlte Mittelabrufe bleiben kompatibel.

| Nr. | Umsetzung | Verhalten |
| --- | --- | --- |
| 1 | Arbeitszeiten mehrtägiger Termine | Tageszeitfenster oder durchgehender Zeitraum, Wochentage, Pausen und Ganztagsdauer sind einstellbar. Vorschau und gespeicherte Firmenstunden verwenden dieselbe Berechnung. Alttermine behalten ihre ursprüngliche Berechnung. |
| 2 | Löschfolgen für Stunden | Vor dem Löschen werden betroffene Termine und Stunden angezeigt. Bestätigte Stunden können als unabhängige Zeiteinträge erhalten bleiben; geplante Stunden entfallen mit dem Termin. Manuelle Einträge bleiben bestehen. |
| 3 | Teilauszahlungen | Tatsächlich eingegangenen Betrag mit konkreten Rechnungsanteilen bestätigen. Der Rest bleibt offen. EK wird nur anteilig entlastet. Wiederholte identische Bestätigungen buchen nicht doppelt. Rücknahme stellt alle Teilumbuchungen gemeinsam wieder her. Ein Abruf mit mehreren Auszahlungen zählt weiterhin als ein Mittelabruf. |
| 4 | Offene Rechnungen | Ladefehler werden mit Wiederholen angezeigt. Ein fehlgeschlagener Abruf behauptet nicht mehr, alle Rechnungen seien bezahlt. |
| 5 | Bestätigungsdialoge | Gleichzeitige Rückfragen werden eingereiht und nacheinander beantwortet. Keine offene Promise wird von einer späteren Rückfrage ersetzt. |
| 6 | Werkzeugkosten | „Vorhanden“ setzt einen eingegebenen Preis nicht mehr ungefragt auf null. |
| 7 | Mehrfachuploads | Die Warteschlange zeigt eine Zusammenfassung erfolgreicher und fehlgeschlagener Dateien. Einzelne Fehler verhindern nicht das Prüfen erfolgreicher Entwürfe. |
| 8 | Förderunterlagen | Metadaten und tatsächlich übermittelter Text werden unterschieden. Lokal extrahierte Textauszüge können geprüft, korrigiert und ausdrücklich für die KI freigegeben werden. Nicht lesbare Unterlagen müssen manuell ergänzt werden; die Funktion überträgt keine Dokumentbilder. |
| 9 | Dauerhafte KI-Aufträge | Förderprüfung, Eigenleistungsrecherche/-planung und Glossarerklärung laufen über gespeicherte Aufträge. Ergebnisse lassen sich über die Warteschlange erneut öffnen. Vordergrundverarbeitung kann in den Hintergrund übergeben werden. Bei Serverunterbrechung bleibt der Auftrag erhalten und ist ausdrücklich wiederholbar. |
| 10 | Unabhängige Uploadpakete | Ein Hintergrundauftrag sperrt nicht mehr sämtliche Uploads desselben Typs. Der unmittelbar absendende Workflow bleibt gegen Doppelklicks geschützt. |
| 11 | Formularentwürfe | Eigenleistungen, Räume und Verlegepläne können Eingaben ausdrücklich projektbezogen sichern, fortsetzen und löschen. Fortsetzen bucht und übernimmt nichts automatisch. Angebote, Belege und Förderplanungen nutzen weiter ihre vorhandenen fachlichen Entwürfe. Dateiinhalte gehören nicht in den Formularentwurf. |
| 12 | Terminserien | Einzeltermin, dieser und folgende oder ganze Serie bearbeiten/löschen. Gruppenänderungen zeigen Auswirkungen und prüfen vor dem Speichern einen Fingerabdruck gegen zwischenzeitliche Änderungen. |
| 13 | Raumvorlagen | Verlegepläne speichern die Revision des übernommenen Raums. Spätere Raumänderungen führen zu einem Hinweis und können ausdrücklich erneut übernommen werden. Historische Pläne ohne Revision bleiben eigenständige Kopien. |
| 14 | Planungsbezüge | Eigenleistungen können mit Kalenderterminen verknüpft werden. Historische Arbeitspaket-/Bauphasenbezüge bleiben erhalten; leere Alt-Auswahlen werden ausgeblendet. |
| 15 | Filter und Leermeldungen | Gemeinsamer Zähler aktiver Filter und Zurücksetzen in den überarbeiteten Sammlungsansichten. Die native Belegübersicht unterscheidet Laden, Fehler, leere Sammlung und keine Filtertreffer. |
| 16 | Darstellungsdichte | „Kompakt“ bleibt Standard. „Komfortabel“ ist in den Einstellungen auswählbar und wird lokal gespeichert. Eingebettete Formulare werden nicht doppelt skaliert. |
| 17 | Gezielt laden | Der unveränderliche Glossarkatalog hat einen eigenen gecachten Endpunkt. Räume und Verlegepläne laden benötigte Datensatzarten ohne die übrigen Werkstattbezüge. |
| 18 | Formatierung | DOM-Änderungen formatieren betroffene neue/veränderte Teilbäume. Vollständige Textdurchläufe bleiben auf Einstellungswechsel begrenzt; ursprüngliche Feldwerte bleiben erhalten. |
| 19 | React-Migrationsetappe | Die Belegsammlung einschließlich Suche, Filtern, Sortierung und Kacheln ist nativ in React. Der bestehende Belegworkflow öffnet in einem gemeinsamen React-Dialoghost und behält Fachlogik, Dirty-/Busy-Schutz und URL-Bereinigung. |

## Datenerhalt und technische Grenzen

- Migration `0042` ergänzt drei Felder; weder Bestandstabellen noch historische Zuordnungen werden entfernt. Direkte `initialize`-Startwege erstellen vor einer nötigen Erweiterung eine Sicherheitskopie mit dem bestehenden Backupmechanismus.
- Projektbackups berücksichtigen die neuen Felder und akzeptieren ältere Backups mit kompatiblen Standardwerten. Aktive Teilbuchungen werden auf projektzugehörige Finanzereignisse und Rechnungen sowie passende Summen geprüft.
- Bestätigte Bankbeträge werden atomar umgebucht. Die Bestätigung und Rücknahme serialisieren SQLite-Schreibzugriffe; PostgreSQL sperrt den Abrufdatensatz.
- KI-Aufträge dürfen ausschließlich die freigegebenen KI-Endpunkte aufrufen. Manipulierte gespeicherte Endpunkte werden abgewiesen. Ein KI-Ergebnis speichert keine Finanzbuchung und übernimmt keinen Eigenleistungsplan automatisch.
- Punkt 19 ist die freigegebene erste Migrationsetappe. Das Belegformular läuft weiterhin gekapselt als klassisches Formular. Angebote, Finanzierungsformulare und Backupdialoge sind noch nicht vollständig als native React-Formulare umgesetzt.
- Es gibt keine automatische Wiederaufnahme einer bereits laufenden externen KI-Anfrage nach Serverabbruch. Der erhaltene Auftrag wird als unterbrochen angezeigt und kann kontrolliert neu gestartet werden.

## Gezielte Validierung

Geprüft wurden Kalender-/Stundenintegrität, veraltete Serienänderungen, Teilauszahlungen samt Doppelsendesicherheit und vollständiger Rücknahme, Projekttrennung von Entwürfen und KI-Ergebnissen, Ablehnung manipulierter KI-Aufträge, additive Migration, Backup-Roundtrip und Schutz vor einem veralteten Förderbericht. Kleine vorhandene Prüfungen decken Formatierung/API-Verhalten und die Mittelabrufzählung ab.

Produktionsbuild einschließlich TypeScript-Prüfung erfolgreich. Ein isolierter Browser-Prozesscheck prüft die neue Belegsammlung, Projektkontext, Öffnen/Schließen/erneutes Öffnen und den Kassenzettel-Einstieg. Bei der kompakten Skalierung projiziert Playwright Klickpositionen innerhalb des eingebetteten Fensters falsch; der Test prüft die sichtbare Buttonlage und löst dessen Klick direkt aus. Keine breite visuelle Testsuite und keine Änderungen an einer Benutzerdatenbank.
