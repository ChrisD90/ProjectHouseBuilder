# Finanzszenarien

Unter **Finanzen → Szenarien** werden unabhängige Varianten gespeichert. Erstellen,
Bearbeiten, Vorschau, Kopieren und Löschen schreiben ausschließlich in
`finance_scenario`. Es werden keine Angebote angenommen, Rechnungen geändert,
Kredite abgerufen oder Zahlungen und Finanzierungszuordnungen gebucht.

## Ausgangsstand

Ein neues Szenario übernimmt einen festen Stand aus dem aktuellen Projekt:

- angenommene Angebote, geplante Eigenleistungen und übrige gebuchte Rechnungen;
- offene Angebote als zunächst ausgeschaltete Alternativen;
- bereits bezahlte Rechnungsbeträge und aktive manuelle Kreditverwendungen;
- die verbleibenden Kreditrahmen sowie Eigenkapitalsalden und deren Reserven.

Rechnungen zu einem Angebot oder einer Eigenleistung werden nicht zusätzlich als
separate Planpositionen gezählt. Ein bereits gezahlter Betrag bleibt Teil der
Basis, auch wenn eine Planposition ausgeschaltet wird. Bei manuell abgeschlossenen
Angeboten werden keine weiteren Restkosten angesetzt. Bereits gezahlte Beträge
sind im Szenario nicht editierbar.

Verfügbarer Kredit = noch nicht abgerufen + ausgezahlt, aber noch nicht verbraucht.
Ein Mittelabruf erhöht den Planrahmen dadurch nicht noch einmal. Zahlungen ohne
Finanzierungszuordnung werden ausdrücklich angezeigt, da sie noch keinen
Kontosaldo reduziert haben.

## Planen und Finanzieren

Planbeträge sind Gesamtbeträge inklusive der im Ausgangsstand bereits bezahlten
Anteile. Nur die Differenz wird als zukünftiger Bedarf finanziert. Freie
Planpositionen können beispielsweise Innenausbau oder Garten enthalten.
Positionen lassen sich zuschalten, Preise bearbeiten und die zukünftigen Kosten
anteilig auf mehrere Kredite und Eigenkapitalkonten verteilen. Eine feste oder
prozentuale Reserve für die offene Planung kann ebenfalls finanziert werden.

Die vier Kennzahlen zeigen Gesamtkosten, noch zu finanzieren, verbleibendes EK
und verbleibenden Kredit. Unzugeordnete Planbeträge, überschrittene Kreditrahmen,
unterschrittene EK-Reserven und die Gesamtfinanzierungslücke werden separat
kenntlich gemacht. Eine Überschreitung des Kontorahmens ist in einem Planspiel
erlaubt; eine Aufteilung über den offenen Betrag einer Position hinaus wird
abgewiesen. Geld wird centgenau mit Decimal berechnet.

## Varianten, Aktualität und Speichern

Eine Kopie erhält dieselbe Basis und dieselben Positionen; danach sind beide
Varianten unabhängig. Auf der Übersicht lassen sich zwei Szenarien für einen
Vergleich auswählen. Der Vergleich zeigt offene Planpositionen, Reserve, bereits
bezahlte Kosten und die Auswirkungen auf EK und Kredit.

Veränderte oder gelöschte Angebote überschreiben keine Szenariodaten. Ein aktueller
Angebotswert kann ausdrücklich in eine gespeicherte Planposition übernommen
werden; eingefrorene Zahlungen und Kontosalden bleiben dabei unverändert. Bei
Änderungen an echten Zahlungen oder Finanzierung weist die Ansicht darauf hin.
Für eine neue Finanzierungsbasis wird ein neues Szenario erstellt. Eine Kopie
behält bewusst die bisherige Basis.

Ungespeicherte Änderungen bleiben bei Fehlern erhalten. Revisionskennungen
verhindern veraltete Schreibzugriffe. Eine Vorschau validiert und berechnet nur;
sie speichert nichts und blockiert die Navigation nicht als Finanzbuchung.

Migration **0048** ergänzt nur die eigenständige Tabelle. Projektbackups enthalten
Szenarien; alte Backups werden mit leerer Szenarioliste akzeptiert. Die Prüfung von
Szenariodaten erfolgt vor einer Wiederherstellung. Projekttrennung, Zurücksetzen
und Löschschutz verwenden die bestehende Projektverwaltung.

Beim lokalen Start werden Datenbankprüfung, obligatorisches Sicherheitsbackup und
Migration jetzt sichtbar angekündigt. Viele Fotos können das Backup verlängern;
die Sicherung und ihre Integritätsprüfung werden weiterhin vollständig ausgeführt.
