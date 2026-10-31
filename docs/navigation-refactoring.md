# Navigation: Befund und Umbauvorschlag

Stand: 31.10.2026. Die offiziellen Dokumentationen unten wurden abgerufen und geprüft.

## Ursache im Repository

Die Fachseiten sind eigenständige HTML-Dokumente. `_shell_open.html` vermeidet zwar doppelten Quelltext für die Sidebar, schafft aber keinen im Browser erhaltenen Container. Die Links in `shell.js` führen weiterhin normale Dokumentnavigation aus. `ui.js`, `shell.js`, `chatgpt.js` und `import_jobs.js` starten auf jeder Seite erneut; daneben laden die Fachmodule ihre Daten. Beispielsweise ruft `receipts.js` die Rechnungen und die Kostenübersicht ab. `chatgpt.js` lädt Verbindungsstatus und gegebenenfalls die Modellliste erneut. Der sichtbare Ladezustand verschwindet erst nach diesen separaten API-Aufrufen.

Die eingeführten View Transitions verändern die Darstellung des Dokumentwechsels in unterstützten Browsern. Sie verhindern weder die Navigation noch die erneute Initialisierung und sind daher keine Lösung für das Leistungsproblem. Ein CSS-Wechsel allein löst das ebenfalls nicht. Netzwerk- und Rendering-Zeiten auf dem betroffenen Mac sind noch nicht gemessen; aus dem Quelltext folgt keine belastbare Millisekunden-Angabe.

## Optionen

| Ansatz | Nutzen | Aufwand/Risiko im Bestand |
| --- | --- | --- |
| Turbo Drive | Beschleunigt serverseitige Navigation; hält JS-Laufzeit und bei geeigneter Struktur persistente Elemente | Mittel bis hoch: globale `let`/`const`, Dokument-Listener, Observer und Polling müssen zuerst auf kontrollierbare Lebenszyklen umgestellt werden. Turbo ersetzt standardmäßig den Body, ein dauerhafter Rahmen muss explizit vorgesehen werden. |
| htmx mit gezieltem Inhaltsaustausch | Sidebar und Rahmen bleiben bestehen; Flask kann Inhaltsfragmente liefern | Mittel: Fachmodule brauchen ebenfalls Mount/Unmount, Verlauf, Titel, Auth-Weiterleitungen, Dialoge und Formzustände müssen explizit behandelt werden. |
| React mit Router und bestehendem Flask-API | Dauerhafter App-Rahmen, klarer Komponenten-/Datenlebenszyklus; geeignet für langfristig komplexe Oberflächen | Hoch: schrittweise Migration der Fachseiten, Build-Prozess und Regressionstests erforderlich. Finanzworkflows sind erheblich komplexer als die reine Navigation. |
| Neue Komponentenbibliothek | Kann künftige Dialoge und Formulare vereinheitlichen | Behebt den Dokument-Neuaufbau nicht. Ein sofortiger Austausch aller Komponenten hätte ein hohes Regressionsrisiko. |

## Empfehlung

Zunächst einen persistenten Rahmen mit gezieltem Inhaltsaustausch auf Basis von htmx evaluieren; vorhandenes Flask und Fachlogik bleiben nutzbar. Turbo ist die Alternative, wenn möglichst viele vollständige Server-Templates bleiben sollen. Vor einer Bibliotheksentscheidung einen kleinen, gemessenen Pilot zwischen zwei lesenden Ansichten bauen. React ist sinnvoll, wenn zusätzlich ein langfristiger vollständiger UI-Umbau gewünscht ist, für diesen Fehler allein jedoch ein deutlich größerer Eingriff.

1. Im Browser Network/Performance für mehrfache Wechsel Bauzeitenplan → Rechnungen → Finanzierung erfassen; harte Reloads, API-Anzahl, Zeit bis Daten sichtbar, Layoutverschiebungen und Speicherentwicklung vergleichen.
2. Gemeinsamen Rahmen einmalig starten: Navigation, Theme, ChatGPT-Status, Warteschlange und globale Dialogdienste. Header und Sidebar bleiben erhalten. Kein erneutes Status-/Modellladen bei jedem Fachseitenwechsel.
3. Fachmodule in `mount(root)`/`unmount()` umstellen; Listener, Observer, Timer und laufende Fetches sauber mit AbortController beenden. Globale Selektoren und lexikalische Variablen isolieren. Skripte nicht einfach erneut in ausgetauschtes HTML injizieren.
4. Inhaltsfragmente und Routing mit Zurück/Vorwärts, Deep Links und Auth-Ablauf einführen. Alte Inhalte bis zur erfolgreichen Antwort stehen lassen, Fehler im bestehenden Rahmen anzeigen. Keine Finanz-API-Antworten oder Dokumente im Service Worker cachen.
5. Bearbeitungszustände schützen: Navigation bei ungespeicherten Änderungen bestätigen; laufende fachliche Buchungen schützen, unabhängige Hintergrundjobs weiterlaufen lassen; Dialoge und Fokus beim Wechsel kontrolliert abbauen.
6. Erst nach erfolgreichem Pilot auf die übrigen Fachseiten erweitern. Akzeptanz: Sidebar-DOM bleibt identisch, kein weißer Zwischenzustand, kein doppeltes Polling, keine mehrfachen Buchungsaktionen, funktionierende Historie und unveränderter Schutz von Entwürfen.

Die Architekturänderung wurde in diesem Commit bewusst noch nicht aktiviert: Hier liegen konkrete Bedienkorrekturen und der recherchierte Vorschlag vor. Ein ungeprüfter globaler HTML-Austausch könnte insbesondere Zahlungs- und Importabläufe beschädigen.

## Quellen

- Turbo Drive: https://turbo.hotwired.dev/handbook/drive
- htmx, AJAX, Inhaltsaustausch und History: https://htmx.org/docs/
- React schrittweise in bestehende Projekte integrieren: https://react.dev/learn/add-react-to-an-existing-project
- View Transition API und Unterschied zwischen visuellen Übergängen und Navigation: https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API

## Testbranch: `feature/persistent-navigation`

Auf Basis von `feature/synology-nas`, Ausgangscommit `8c71fb5`, ist der persistente Rahmen jetzt als testbare Implementierung vorhanden. Für diesen Pilot war keine zusätzliche UI-Bibliothek nötig: Ein kleiner nativer ES-Modul-Router übernimmt gezielten Inhaltsaustausch und Browserhistorie. Flask liefert weiterhin dieselben Templates und unveränderte Fach-APIs. Der Browser extrahiert daraus ausschließlich den Fachinhalt; Sidebar, Header, Theme, ChatGPT und Importwarteschlange werden nicht ausgetauscht.

`page_modules.py` liefert explizit erlaubte Modul-Factories aus den vorhandenen lokalen Fachskripten. Jede Aktivierung erhält einen isolierten Scope mit eigenen Dokument-Listenern, Fetch-Abbruchcontrollern, Timern, Observern und Objekt-URLs. Gantt und seine Begleitskripte behalten dabei ihren gemeinsamen lexikalischen Kontext, ohne Variablen in die nächste Fachansicht zu übertragen. Es werden weder `eval` noch dynamische Inline-Skriptinjektionen verwendet. Globale Form-/Dialogdienste bleiben erhalten; ihre Registry gibt entfernte Dialoge wieder frei.

Die Zielansicht und ihre initialen Daten werden zunächst verborgen vorbereitet. Die aktuelle Ansicht bleibt stehen und ist während des Wechsels gegen weitere Eingaben gesperrt. Erst dann werden Inhalt und passende Styles gemeinsam umgeschaltet. Ladefehler lassen den bisherigen Inhalt erhalten. Neue Navigationsaufträge brechen überholte Leseanfragen ab. Formulare werden anhand echter Feldwerte geprüft; programmatische Befüllung und leere Dateifelder erzeugen keine künstlichen Änderungswarnungen. Offene Schreibvorgänge und Vordergrundimporte sperren den Seitenwechsel. Hintergrundjobs laufen im globalen Dienst weiter.

### Lokal testen

Normal über den vorhandenen Entwicklungsstarter starten. Keine Datenmigration erforderlich. Beim ersten Aufruf der neuen Version die Seite einmal neu laden, damit auch die gemeinsamen Skripte aktualisiert werden.

- Sidebar einklappen und mehrfach zwischen Bauzeitenplan, Rechnungen, Finanzierung und Angeboten wechseln. Die Sidebar darf sich nicht neu aufbauen.
- Zurück/Vorwärts und direkte Links mit `receipt_id`, `offer_id`, `loan_id` oder `schedule_job` prüfen.
- Ein Formular ändern und zu einer anderen Ansicht wechseln: Abbrechen erhält Formular und Adresse, Bestätigen verwirft den Entwurf im geöffneten Dialog.
- Nach mehreren Wechseln eine Firma oder ein Arbeitspaket speichern und kontrollieren, dass die Aktion nur einmal ausgeführt wird.
- Einen Hintergrundimport starten, währenddessen navigieren und das Ergebnis aus der globalen Warteschlange öffnen.
- Theme und ChatGPT-Verbindung wechseln; beides muss beim Seitenwechsel erhalten bleiben. Keine zusätzliche KI-Statusabfrage pro Fachseitenwechsel.

Automatisierte Browserprüfung: `PHB_TEST_URL=http://127.0.0.1:5056 node tests/browser_navigation.cjs` mit lokal installiertem Playwright und Chromium. **Nur gegen eine Wegwerf-Testdatenbank starten:** Die Prüfung legt eine Testfirma an. `CHROMIUM_PATH` kann den Browserpfad überschreiben. Die Prüfung kontrolliert wiederholte Seitenwechsel, DOM-Identität der Sidebar, einmalig bestehende globale Dienste, Browserhistorie, Entwurfswarnungen, verzögerte und fehlerhafte Zielseiten sowie einen echten Speichervorgang.

Chromium wurde automatisiert geprüft; Safari auf dem betroffenen Mac und die realen NAS-/Netzwerklatenzen sind noch durch den Testbranch zu validieren. Vollständige HTML-Antworten werden weiterhin übertragen; optimierte Server-Fragmente oder ein späterer Komponentenumbau sind mögliche nächste Schritte, ohne den jetzt bestehenden Rahmen zu ersetzen.
