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
