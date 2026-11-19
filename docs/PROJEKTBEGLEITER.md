# Projektbegleiter – erste integrierte Ausbaustufe

Branch: `feature/projektkalender`. Additive Migration **0040**. Die Anwendung nach dem Update über den üblichen Starter neu starten; dieser führt Migration und die vorhandene Sicherungslogik aus. Es gibt keine neue Cloud- oder Hostingabhängigkeit.

## Einstiege

- **Projektübersicht**: nächste Termine, offene To-dos, zu bezahlende Rechnungen, Fristen und Sicherungsstatus. Projektkacheln öffnen diese Übersicht; der Kalender bleibt direkt erreichbar.
- **Projektwerkstatt**: kompakte Bereichsauswahl für Einkauf, Bautagebuch, Mängel/Abnahme, Hausakte, Firmenchronik, Nachträge/Versionsvergleich, Skonto, Liquidität, Förderfristen/Nachweise, Wissen, Mengenrechner und Vorlagen.
- **Suche & Schnellerfassung** im Header, auch über **Strg/⌘ K**. Projektweite Suche in Terminen, Angeboten, Belegen, Unterlagen, Firmen, Eigenleistungen und To-dos/Notizen. Schnelle Erstellung von To-do, Notiz, Termin und Beleg; Mengenrechner und optionale Projektsicherung sind ebenfalls erreichbar. Favoriten und zuletzt geöffnete Treffer sind lokale Browserpräferenzen, getrennt nach Projekt.

## Kalender und Stunden

Der Termin bietet eine **Terminmappe**: Beschreibungen, Unterlagen/Fotos und eine verknüpfte Eigenleistung zur Vorbereitung. To-dos/Notizen sind direkt mit dem Termin verknüpfbar. Das druckbare Terminblatt enthält Zeitraum, Firma/Gewerke, Vorbereitungsaufgaben sowie Material-/Werkzeuglisten der verknüpften Eigenleistung. Unterlagen lassen sich als eigenes ZIP-Paket exportieren.

Neue Termine aus dem Dialog starten als **geplant**. Automatisch übernommene Firmenzeiten bleiben sichtbar, zählen aber getrennt von bestätigten Stunden. **Wie geplant durchgeführt** bestätigt die Zeiten am Termin. Änderungen bleiben mit den erzeugten Tageszeilen synchronisiert; manuelle Stundeneinträge werden nicht überschrieben. Bereits vor dieser Erweiterung vorhandene Termine behalten ihren bisherigen bestätigten Stand, bis sie ausdrücklich umgestellt werden. Ganztägige Zeiten bleiben mit **8 Std. pauschal** gekennzeichnet.

Unter **Termin wiederholen** können bis zu 52 weitere Termine im gewählten Tagesabstand angelegt werden. Die Erstellung erfolgt in einer Transaktion und wird je Ausgangstermin gegen Wiederholung geschützt. Jeder Folgetermin ist eigenständig bearbeitbar und startet geplant. Der **ICS-Export** enthält nur dieses Projekt, stabile Termin-IDs, korrekte exklusive Enddaten für ganztägige Termine und Erinnerungen. Die Kalenderdatei kann in eine andere Kalender-App importiert werden; sie ist kein automatisch synchronisiertes Kalenderabo.

In der Stundenerfassung sind **Monat und Person/Firma** für CSV sowie druckbare PDF-Vorlage auswählbar. Geplante Zeiten, bestätigte Zeiten und Pauschalen sind getrennt gekennzeichnet. Erinnerungen bei geschlossener Anwendung können über die importierten Kalendertermine erfolgen; die lokale Webanwendung betreibt keinen dauerhaften Benachrichtigungsdienst.

## Einkauf und Dokumentation

### Fliesen-Verlegeplan

Unter **Projektwerkstatt → Fliesen-Verlegeplan** lassen sich mehrere Pläne je Projekt anlegen. Raum- und Fliesenmaße werden in Zentimetern eingegeben, Fugenbreite und Randabstand in Millimetern. Die Draufsicht zeigt alle Maße in Millimetern. Neben Rechtecken stehen Vorlagen für L-Formen, schräge Wände sowie runde/ovale Räume (durch 48 Kanten angenähert) bereit. **Freie Kontur** unterstützt 3 bis 64 Eckpunkte, die in ihrer Reihenfolge den Raum umschließen. Punkte können zwischen bestehenden Punkten eingefügt, bearbeitet und gelöscht werden. X wächst nach rechts, Y nach unten. Der letzte Punkt verbindet sich automatisch mit dem ersten. Eine Änderung der Außenmaße skaliert die vorhandene Kontur proportional entlang der jeweiligen Achse; einzelne Punkte lassen sich danach präzise anpassen. Sich überschneidende oder selbst berührende Konturen werden abgewiesen.

Gerade Verlegung und Halbverband, 90°-Drehung sowie Start oben links, mittig oder mit eigenem Rasterversatz bleiben verfügbar. Der Rasterbezug ist das umschließende Rechteck der belegbaren Fläche. Beim mittigen Start werden zwei Rasterlagen dieses Rechtecks verglichen; an unregelmäßigen Wänden können dennoch schmale Zuschnitte entstehen. Randabstände werden an jeder Wand berücksichtigt, auch an Innenecken und schrägen Wänden. Die Flächen- und Mengenermittlung verwendet die tatsächliche Kontur, nicht nur den Planrahmen.

Ganze Fliesen sind grün, Zuschnitte schraffiert. Ein Klick auf ein Feld zeigt dessen Reihe, Position und Zuschnittmaße. Bei schrägen oder L-förmigen Zuschnitten sind dies **Außenmaße**, keine rechteckige Schnittanweisung. Der tatsächliche Schnittverlauf wird gezeichnet; relative Schnittpunkte (X/Y ab der linken oberen Zuschnittkante) stehen bei Auswahl und im Druckexport. Konturzuschnitte mit gleichen Außenmaßen, aber anderer Schnittform werden getrennt aufgelistet. Schmale Stücke unter einem Drittel des jeweiligen Fliesenmaßes werden gemeldet. Eine zusammengefasste Zuschnittliste sowie **Drucken / PDF** und **SVG** ermöglichen die Nutzung außerhalb der App. Die Bestellschätzung zählt vorsichtig eine neue Fliese je Rasterfeld plus Reserve; Reststücke werden nicht automatisch wiederverwendet. Einheiten und tatsächliches Kaliber vor Ort prüfen. Innere Aussparungen (z. B. Säulen), Bewegungsfugen und eine Zuschnittoptimierung sind noch nicht enthalten.

Gespeichert werden die Eingaben als projektbezogener `tile_plan` in der bestehenden Dokumentationstabelle. Projektbackup, Wiederherstellung und Zurücksetzen erfassen diese Pläne mit; eine weitere Datenbankmigration ist nicht nötig. Gleichzeitiges Überschreiben oder Löschen eines inzwischen geänderten Plans wird über den vorhandenen Versionsschutz abgefangen. Die Berechnung erfolgt lokal im Browser und benötigt keine ChatGPT-Verbindung. Bei mehr als 5.000 Rasterfeldern wird vor dem Berechnen abgebrochen.

- **Einkauf** aggregiert Materialien aktiver Eigenleistungen nach Bezeichnung, Einheit, Status und Materialhinweisen. Mengen mit verschiedenen Einheiten oder abweichenden Hinweisen werden nicht blind zusammengezählt. Beschaffungsstatus lässt sich gesammelt aktualisieren; aktuelle Mengen/Preise werden dabei nicht überschrieben. Werkzeuge aus Eigenleistungen und eigene Rückgabefristen stehen daneben. Einkaufsliste ist druckbar.
- **Mengenrechner** berechnet Fläche/Volumen, Verschnitt und Packungsbedarf. Das Ergebnis ist kopierbar und kann nach Auswahl eines Vorhabens als Material übernommen werden.
- **Bautagebuch** speichert Datum, Ort, Text und Bilder/Unterlagen. Eine ausdrücklich angeforderte Vorlage aus Terminen und bestätigten Stunden kann ergänzt werden; Planungsstand bleibt als solcher benannt. Druck/PDF und Unterlagenpaket stehen bereit.
- **Mängel & Abnahme**: Ort, zuständige Firma bzw. anderer Bezug, Beschreibung/Vorbehalte, Frist, Status und Nachweisfotos. Einträge lassen sich als To-do vorbereiten, archivieren und als Protokoll drucken.
- **Hausakte**: Bauteile/Räume, Wartungs- und Garantiefristen, Beschreibungen und verknüpfte Originalunterlagen. Ein bewusst ausgewähltes Übergabepaket enthält die Dokumente und ein lesbares Inhaltsverzeichnis; es ersetzt kein vollständiges Projektbackup.
- **Firmenchronik** bündelt Kontaktdaten, Termine, Angebote, Rechnungen und den Einstieg zu Stunden. Verknüpfte Originale bleiben in ihren bisherigen Bereichen.
- **Wissen** enthält ein lokales Starterglossar mit Begriffen/Werkzeugen und eigene Wissensnotizen. Eine kontextbezogene ChatGPT-Erklärung ist optional, benötigt die bestehende Verbindung/Freigabe und eine ausdrückliche Bestätigung. Eingaben werden nicht automatisch übertragen oder als geprüfte technische Vorgaben gespeichert.

## Angebote und Geld

**Nachträge** werden einem angenommenen Angebot zugeordnet und zunächst als Entwurf dokumentiert. Nur eine ausdrücklich bestätigte Freigabe erhöht den bestehenden Auftragsansatz; es entsteht kein zweiter paralleler Kostenansatz. Ursprüngliches Angebot, PDF und Annahmenachweis bleiben unverändert. Mehrfaches Freigeben verdoppelt den Betrag nicht. Nach einer Änderung der Angebotsgrundlage muss ein Entwurf erneut geprüft/gespeichert werden. Eine bestätigte Rücknahme entfernt den Zusatz aus dem Auftragsansatz; vorhandene Belege und Geldbewegungen bleiben erhalten und können weiterhin eine Überschreitung zeigen. Eine Angebotsannahme mit freigegebenen Nachträgen kann erst nach deren Rücknahme aufgehoben werden.

Der **Versionsvergleich** stellt vorhandene Fassungen gegenüber, einschließlich geänderter Mengen, Beschreibungen, Nettopreise sowie hinzugefügter/entfallener Positionen. Der Einstieg liegt auch im Angebotseditor.

**Skonto** wird als dokumentierte Zahlungskondition mit Prozentsatz und Frist erfasst. Eine separate, ausdrücklich bestätigte Skontozahlung bucht ausschließlich den tatsächlichen Zahlbetrag auf die gewählte Finanzierungsquelle; der bestätigte Skontoabzug wird getrennt gespeichert. Originale Brutto-/Netto-/Lohnkostenangaben bleiben Dokumentdaten. Offene Beträge und finanzierbare Zahlungsanteile berücksichtigen den bestätigten Abzug. Überholte Vorschauen, doppelte Zahlung, Fremdprojektkonten oder fehlendes Guthaben werden zurückgewiesen. Vor dem Löschen einer einzelnen Zahlung muss die Skontoverrechnung ausdrücklich zurückgenommen werden. Gemeinsames Rechnungsstorno und dessen Rücknahme erhalten die Zuordnung. Steuerübersichten bleiben eine Dokumentationshilfe und sind keine automatische Berechnung einer steuerlichen Anspruchsgrundlage.

Die **Liquiditätsvorschau** zeigt acht Wochen bekannter Rechnungsfälligkeiten, frei verfügbare bestätigte Mittel nach EK-Reserve und Rechnungen ohne Zahlungsziel. Noch nicht ausgezahlte Förderungen und eingereichte Mittelabrufe erscheinen separat; sie erhöhen verfügbares Guthaben nicht.

**Förderfristen & Nachweise** ergänzen eigene Fristen mit Förderbezug und vorbereitbaren To-dos. Ausgewählte Unterlagen und gebuchte Rechnungen werden zu einem ZIP mit Inhaltsverzeichnis zusammengestellt. Bestehende Antragsfristen sowie Skontofristen erscheinen auch im Tagescockpit.

## Aufgaben, Vorlagen und Sicherungen

- Ein To-do kann einen Wiederholungsabstand erhalten. Beim ersten Abschluss entsteht genau ein neuer fälliger Eintrag; erneute Abschlussaufrufe erzeugen keine Dubletten. Nachfolger bleiben eigenständige Aufgaben und werden bei Rücknahme eines früheren Abschlusses nicht ungefragt gelöscht.
- Erledigen und Archivieren einfacher To-dos/Notizen bieten **Rückgängig**. Zwischenzeitlich geänderte Inhalte werden dabei nicht überschrieben. Finanzbuchungen werden damit nicht zurückgenommen.
- Neue Projekte können Vorlagen für **Garten, Dach oder Renovierung** übernehmen; bestehende Projekte nutzen dieselben Vorlagen über die Werkstatt. Übernommen werden Checklisten und ein Eigenleistungsvorhaben, keine Firmen, Rechnungen, Zahlungen oder fremden Projektdaten. Wiederholtes Anwenden derselben Vorlage wird verhindert.
- Der **Sicherungsstatus** vergleicht projektbezogene Datensätze mit der letzten Sicherung. Ein **Wiederherstellungspunkt** erstellt ein echtes Projektbackup über den bestehenden geprüften Ablauf. Das ist auch über die Schnellerfassung vor größeren Importen möglich; es gibt keine ungefragte Sicherung bei jedem Upload.

## Daten und gezielte Prüfung

Neue projektbezogene Tabellen: `companion_record`, `calendar_preferences`, `work_recurrence`, `receipt_terms`. Alle werden in Projektbackups aufgenommen; ältere bekannte Backups werden für diese Tabellen leer ergänzt. Vorhandene Tabellen werden nicht gelöscht oder neu befüllt. Dokumente verwenden weiterhin den bestehenden Upload, die vorhandene Versionsverwaltung und die üblichen Originaldateien. Referenzen und Exportauswahlen werden auf die aktuelle Projekt-ID geprüft; dokumentierte Unterlagen lassen sich erst nach Lösen ihrer Verknüpfungen löschen.

Prüfung beschränkt auf Datensicherheit und Prozessintegrität: gezielte Tests für Projekttrennung/Exportauswahl, atomare Materialupdates, geplante/bestätigte Stunden, wiederholte Termine/To-dos, Nachtragsprognose ohne Doppelzählung, echte Skonto-Geldbewegung samt Storno/Rücknahme und projektgetrennten Backup-Roundtrip. Zusätzlich Typecheck/Produktionsbuild und Syntaxprüfung geänderter JavaScript-Dateien. Keine vollständige Browser- oder Bildvergleichssuite für diese Erweiterung.
