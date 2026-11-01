# React-/Mantine-Migration

Testbranch: `feature/react-mantine-ui`, auf Basis von `feature/synology-nas` (`8c71fb5`). Der verworfene eigene Navigationsrouter ist keine Grundlage dieses Branches.

## Aktueller Umfang

Der Einstieg zeigt jetzt eine [Projektübersicht](multiple-projects.md); der folgende gemeinsame Rahmen gilt innerhalb eines Projekts.

Der gemeinsame Rahmen verwendet React, TypeScript, React Router und Mantine; Serverdaten werden über TanStack Query geladen. Sidebar, Header, Theme, ChatGPT-Verbindung und Warteschlange bleiben über die Navigation hinweg erhalten. Die Sidebar ist wieder in Projekt, Finanzen und Verwaltung gegliedert; eingeklappt trennen Linien die Gruppen. Native Ansichten und erhaltene Fachmasken verwenden im Dark Mode dieselbe blaugraue Farbpalette.

Bereits als native React-/Mantine-Komponenten umgesetzt:

- To-dos & Notizen: freie oder kontextbezogene Einträge, Quellenverknüpfung, Fälligkeit, Abschließen/Wiederöffnen und Bearbeiten. Angebote, Arbeitspakete und Bauphasen öffnen ihre Einträge über einen kompakten Button mit To-do-Zähler. Listen und Editor verwenden überall dieselben Dialoge. To-dos und Notizen lassen sich separat anlegen, archivieren, wiederherstellen und löschen; siehe [To-dos & Notizen](todos-and-notes.md).
- Stammdaten: Firmen mit allen Kontaktfeldern, Gewerke und Kategorien, Suchen, Umbenennen, Löschen und Standardlisten wiederherstellen. ChatGPT-Recherche bleibt eine ausdrückliche Aktion; Ergebnisse werden vor dem Speichern ausgewählt und geprüft. Rückkehr zu einem zwischengespeicherten Rechnungsentwurf bleibt möglich.
- Kosten & Budget: aggregierte Kennzahlen, Abrechnungskette, Hinweise, Gruppierung, Suche und Aufschlüsselung bis zu den Originalquellen. Keine neue Uploadstrecke und keine zusätzliche Buchungslogik.
- Energetische Planung: manuelle Förderdatenerfassung mit Beträgen, Status, Fristen, Quellen und Zuordnung zu Angebot/Budgetposition. Förderunterlagen nutzen den vorhandenen Dokumenten-Upload. Ein ausdrücklicher KI-Fördercheck mit Voraussetzungen und Quellen ist für BAFA-Gebäudehülle und KfW 458 verfügbar; siehe [Förderprüfung](funding-estimates.md).
- Dokumente: Projektunterlagen, Metadatenpflege, Suche und Filter sowie die verknüpfte Originalbibliothek. Lokaler Upload im Vorder- oder Hintergrund mit anschließender Metadatenprüfung und gemeinsamem Jobstatus.

Bauzeitenplan, Angebote, Rechnungen, Finanzierung sowie Datensicherung verwenden in dieser ersten Stufe ihre bestehenden Fachmasken. Sie laufen in getrennten Same-Origin-Dokumenten innerhalb des neuen Rahmens. Damit bleiben insbesondere Positionsprüfung, Angebotsannahme, Rechnungsbuchung, Zahlungen, Storno, Kreditverwendung, Mittelabruf samt PDF/ZIP und Wiederherstellung erhalten. **Diese Masken sind noch nicht auf native Mantine-Komponenten portiert.**

Die Übergangsgrenze ist explizit: kein Abfangen oder Ersetzen von `document`/`window`, kein zusammengesetztes Ausführen alter Skripte und kein Auswerten fremder HTML-Skripte. Jede Fachmaske hat ihr eigenes Dokument und ihre eigenen Variablen. Ein kleiner `embed.js`-Adapter vermittelt Navigation, Theme, Status und gemeinsame Uploaddienste. Bereits besuchte Masken bleiben geladen; eine andere Beleg-ID wird verborgen vorbereitet, bevor die Ansicht wechselt. Login und Dateidownloads bleiben serverseitig geschützt.

Die vorhandenen Flask-APIs validieren weiterhin alle fachlichen Änderungen. Der ursprüngliche Frontendumbau benötigte keine Datenmigration. Die Erweiterung um To-dos, Förderkontext und Annahmerücknahmen ergänzt mit Revision 0026 vier Tabellen; der bestehende Mac-Migrationsstarter sichert eine vorhandene Datenbank vor dem Upgrade. Der Förder-GET liefert zusätzlich die bereits bestehenden Recherchequellen für die neue Darstellung.

## Start und Build

Die gebauten Dateien unter `static/react/` sind im Branch enthalten. Der normale Python-/Mac-Starter benötigt für den Laufzeitbetrieb kein Node.js. Nach dem Branchwechsel Server neu starten und die Seite einmal vollständig neu laden.

Für Frontendentwicklung (Node.js 22 oder neuer):

```sh
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix frontend test
```

`build` prüft TypeScript und erzeugt die Produktionsdateien. Diese zusammen mit dem Quellcode committen. Der Docker-Build erzeugt das Frontend in einer separaten Node-Buildstufe; im Python-Laufzeitimage ist Node nicht erforderlich. Beim Entwicklungs-Compose mit Bind-Mount muss der lokale Build aktuell sein, da das Checkout die Image-Dateien überlagert.

`npm --prefix frontend run dev` startet Vite unter einer lokalen Adresse und leitet API-, Auth- und Logout-Anfragen an Flask auf Port 5055 weiter. Für einen realistischen Test der lokalen ChatGPT-Anmeldung die von Flask bereitgestellte Produktionsoberfläche über `127.0.0.1` verwenden.

Fallback für Vergleiche: Server mit `PHB_UI=classic` starten. Einzelne bestehende Fachseiten sind über `?_classic=1` erreichbar; `&_embedded=1` ist ausschließlich für die interne Einbettung vorgesehen. Ohne vorhandenen Frontend-Build bleibt ein reiner Quellcode-Checkout in der bestehenden Oberfläche lauffähig.

## Prüfungen

```sh
PHB_CHATGPT_HOME=/tmp/phb-test-profile .venv/bin/python -m unittest discover -s tests
npm --prefix frontend test
```

Die vorhandenen HTML-Vertragstests prüfen jetzt ausdrücklich die erhaltenen Fachmasken über `_classic=1`; neue Tests prüfen zusätzlich die React-Auslieferung. Fachliche API-Tests bleiben unverändert aktiv.

Browserprüfung mit Playwright und einem **separaten, wegwerfbaren SQLite-Projekt**:

```sh
npm --prefix frontend exec -- playwright install chromium
PHB_TEST_URL=http://127.0.0.1:5058 npm --prefix frontend run test:browser
```

Der Browserlauf legt Firmen, Förderungen, Projektdokumente, Arbeitspakete, Kredite und eine lokal eingelesene und gebuchte Testrechnung an. Er darf nicht gegen das echte Bauprojekt laufen. `CHROMIUM_PATH` kann einen bereits installierten Browser angeben. Geprüft werden wiederholte Navigation mit derselben Sidebar-/Dienstinstanz, Entwurfswarnung bei Zurück, Native-Speichervorgänge, echter lokaler Upload mit anschließender Prüfung, erhaltene Arbeitspaket-/Kreditaktionen, Browserhistorie, Dark Mode und mobile Navigation ohne horizontales Überlaufen. Weitere Fälle prüfen einen fehlgeschlagenen Ansichtsaufruf mit erneutem Laden sowie den ChatGPT-Verbindungsdialog über einem Firmenentwurf. Vorder- und Hintergrundverarbeitung werden beide geprüft. Die Angebotsprüfung deckt außerdem das vollständige Schließen nach erfolgreichem Entwurfs-Löschen, den Erhalt bei Abbruch/Fehler und den direkten Link zur Kategorienverwaltung ab. OAuth und reale ChatGPT-Anfragen werden dabei nicht ausgelöst; der Verbindungstest nutzt simulierte Antworten.

Automatisiert geprüft ist Chromium. Safari auf dem Intel-Mac sowie reale NAS-/Netzwerklatenzen bleiben Bestandteil des Nutzertests. Der nächste Migrationsschritt kann einzelne erhaltene Fachmasken durch React-Komponenten ersetzen, ohne den Rahmen oder die Server-APIs erneut umzubauen.

Zusätzlicher Browserlauf für die neuen Fachaktionen (ebenfalls nur Wegwerfprojekt):

```sh
PHB_TEST_URL=http://127.0.0.1:5059 npm --prefix frontend run test:browser:features
```

Er prüft Angebot ↔ zentrale To-dos, Annahmerücknahme im Editor, Förderunterlagen mit Rückkehr nach Metadatenprüfung, vorausgesetzte Zustimmung und explizite Übernahme einer simulierten KI-Schätzung. Reale ChatGPT-Aufrufe erfolgen dabei nicht.

Die gemeinsame Farbpalette liegt in `static/palette.css` und gilt für React und eingebettete Abläufe. Die Mantine-Grünabstufungen sind in `frontend/src/main.tsx` hinterlegt. Logos für beide Darstellungen können direkt in `static/branding/logo-light.svg` und `static/branding/logo-dark.svg` ersetzt werden; Hinweise stehen in [static/branding/README.md](../static/branding/README.md).

Revision `0028` ergänzt den optionalen Archivzeitpunkt bestehender To-dos und Notizen. Inhalte, Verknüpfungen und Erledigt-Status bleiben erhalten. `npm --prefix frontend run test:browser:work` prüft die Buttons, Zähler, gemeinsamen Dialoge, Archivierung, Wiederherstellung, Löschung und verschachtelte Dialoge gegen einen separaten Testserver (`PHB_TEST_URL`).

„Daten & Sicherung“ verwendet projektbezogene Backups und Wiederherstellungen einschließlich Originaldateien; administrative Systemsicherungen bleiben außerhalb dieses Projektablaufs. Siehe [Projektbackups](project-backups.md).

Förderunterlagen werden im Header des Förderbereichs hochgeladen und dort geprüft; Hintergrundjobs speichern diesen Rücksprung als Teil ihres projektbezogenen Jobs. Allgemeine Dokument-Uploads behalten ihren bisherigen Ablauf. [Förderplanung: Umsetzungsvorschlag](funding-planning-proposal.md).
