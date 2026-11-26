# Projekttour

Neue Projekte starten beim ersten Öffnen mit einer kurzen Tour:

1. Überblick über Projekt, Umsetzung und Finanzen.
2. Standardablauf für Upload, Analyse, Prüfung und Buchung.
3. Optionaler Dokumenteneingang mit Ordnerauswahl und Prüfintervall.
4. Optionales Sicherungsziel und Aufbewahrungsanzahl.
5. Einstieg in die anpassbare Projektübersicht.

Die Tour kann übersprungen und unter **Einstellungen → System → Projekttour
starten** wieder geöffnet werden. Bei einer Unterbrechung wird der zuletzt
bestätigte Schritt fortgesetzt. Bestehende Projekte starten nicht automatisch.

Der Eingangsordner gilt für das Projekt. Das Sicherungsziel ist eine Einstellung
der gesamten App; bestehende Ziele werden nur nach bewusstem Aktivieren der
Änderungsoption überschrieben. Die Sicherungen selbst bleiben projektbezogen.
Die Tour verschiebt keine Originale, bucht keine Dokumente und erstellt keine
Sicherung. Nicht eingerichtete Ordner können später nachgeholt werden.

Der Fortschritt liegt in der projektbezogenen Einstellung
`project_onboarding_v1`. Er wird mitgesichert und beim Projektreset entfernt.
Die technische Einstellung allein verhindert nicht das Löschen eines leeren
Projekts. Eine Revisionsprüfung verhindert, dass mehrere geöffnete Fenster sich
gegenseitig den Fortschritt überschreiben.

System-Ordnerdialoge sind nur bei direktem lokalen Zugriff verfügbar. Der
Sicherungsdialog verwendet wie der Dokumenteneingang den gemeinsamen Picker für
macOS, Windows und Linux. Auf einem NAS muss ein erreichbarer Serverpfad verwendet
werden. Die bestehende Einschränkung des NAS-Sicherungsziels bleibt erhalten.

Geprüft: Projekttrennung, Fortschritt/Überspringen/Neustart, Schutz vor veralteten
Schreibständen, Löschbarkeit leerer Projekte, lokale Picker-Zugriffsgrenzen und
Abbruch ohne Konfigurationsänderung. Ein isolierter Browsertest prüft die Tour
mit echter Eingangsordner-Konfiguration und unverändertem vorhandenem Backupziel;
der Systemdialog wird dabei simuliert.
