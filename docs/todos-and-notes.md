# To-dos & Notizen

Im zentralen Bereich stehen „Neues To-do“ und „Neue Notiz“ unabhängig vom aktuellen Reiter zur Verfügung. Beide verwenden denselben Editor mit Titel, Details und optionaler Verknüpfung. To-dos haben zusätzlich ein optionales Fälligkeitsdatum und den Erledigt-Status.

Angebotskacheln haben neben dem Rechnungsbutton einen To-do-Button. Rechnungen haben denselben Button direkt neben ihrem Eintrag in der Übersicht. Im Angebotsdetail und Rechnungsdialog wird kein zusätzlicher To-do-/Notizbereich angezeigt. Im Gantt sowie in den Details von Arbeitspaketen und Bauphasen ist derselbe Button verfügbar. Er öffnet die verknüpfte Liste, ohne die aktuelle Ansicht oder darunterliegende Dialoge zu schließen. Auch Förderungen und Dokumente verwenden dieselbe Liste.

Der Zähler zeigt alle nicht archivierten To-dos der jeweiligen Quelle, einschließlich erledigter To-dos. Bei null To-dos entfällt das Badge. Notizen werden über den Notizen-Reiter der Liste verwaltet und erhöhen den To-do-Zähler nicht. Änderungen aktualisieren die Zähler der geöffneten Ansichten.

„Archivieren“ blendet einen Eintrag aus der aktiven Liste aus. Unter „Archiv anzeigen“ lässt er sich wiederherstellen oder nach Bestätigung endgültig löschen. Die Archivierung verändert weder Inhalt noch Verknüpfung oder Erledigt-Status. Erledigte To-dos sind weiterhin über „Erledigte anzeigen“ zugänglich. Das Projekt-Dashboard zählt nur offene, nicht archivierte To-dos.

Alle Einträge sind projektgebunden. Die API `/api/project-work` liefert aktive und archivierte Datensätze mit `archived` und `archived_at`; PATCH mit `archived: true/false` archiviert oder stellt wieder her. Revision `0028` ergänzt die nullable Spalte `archived_at` ohne Änderungen an bestehenden Einträgen. Auch der direkte App-Start unterstützt dieses additive Upgrade.
