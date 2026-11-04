# Energetische Planung und Förderprüfung

## Umgesetzt

Die neue Seite `/energieplanung` übernimmt alle bestehenden Förderungen unverändert.
Erwartete, bewilligte und ausgezahlte Beträge werden getrennt manuell erfasst.
Hinzu kommen Fördergeber, Programm/Nummer, Status, Antragsfrist, Antragsdatum,
Aktenzeichen, Quellenlink und optionale Verknüpfungen zu Angebot oder Planposition.
Eine Zuordnung bescheinigt keine Förderfähigkeit. Bruttokosten und Projektbudget
werden dadurch nicht geändert; Förderauszahlungen erzeugen keine automatische
Einzahlung auf ein Eigenkapitalkonto. So werden Mittel nicht doppelt gezählt.

Angenommene Angebote bieten „Förderung prüfen“ als Einstieg in die verknüpfte
manuelle Förderplanung. Die Darstellung enthält bewusst keine fest hinterlegten
Fördersätze und keine automatische Berechnung eines Förderanspruchs.

## Fachliche Orientierung für die nächste Ausbaustufe

Dies ist eine Integrationsskizze, keine aktuell verifizierte Programmauskunft.
Beim Erstellen war der Live-Abruf der Fördergeber durch die Netzwerkfreigabe der
Entwicklungsumgebung gesperrt. Die folgenden offiziellen Einstiege sind vor einer
konkreten Entscheidung auf aktuelle Bedingungen zu prüfen:

| Themenfeld | Prüfansatz | Offizielle Quelle |
| --- | --- | --- |
| Heizungstausch | KfW-Heizungsförderung, technische Anforderungen, Antragsteller und Gebäudenutzung prüfen; mögliche Boni gesondert nachweisen. | [KfW – bestehende Immobilie](https://www.kfw.de/inlandsfoerderung/Privatpersonen/Bestehende-Immobilie/) |
| Dach, Fassade, Fenster und weitere Einzelmaßnahmen | BEG-Einzelmaßnahmen beim BAFA; technische Mindestanforderungen und notwendige Fachplanung prüfen. | [BAFA – effiziente Gebäude](https://www.bafa.de/DE/Energie/Effiziente_Gebaeude/effiziente_gebaeude_node.html) |
| Gesamtsanierung | Effizienzhaus-Finanzierung und gegebenenfalls Tilgungszuschuss prüfen; ein Förderkredit ist kein ausgezahlter Zuschuss. | [KfW](https://www.kfw.de/) |
| Energieberatung / Sanierungsfahrplan | Beratungsförderung, iSFP und mögliche Voraussetzungen für einzelne Maßnahmen prüfen. Ein iSFP-Bonus darf nicht pauschal auf jedes Angebot angewendet werden. | [BAFA](https://www.bafa.de/), [Expertenliste](https://www.energie-effizienz-experten.de/) |
| Regionale Ergänzungen | Bundesland, Postleitzahl, Kommune und gegebenenfalls örtlichen Versorger berücksichtigen; Kumulierbarkeit prüfen. | [Förderdatenbank](https://www.foerderdatenbank.de/FDB/DE/Home/home.html) |
| Steuerliche Alternative | § 35c EStG beziehungsweise getrennt ausgewiesene Arbeitskosten nach § 35a EStG prüfen; dieselbe Maßnahme nicht ungeprüft gleichzeitig öffentlich fördern und steuerlich ansetzen. | Aktuelle Gesetzesfassung und steuerliche Beratung |

Photovoltaik, Speicher, Wallboxen und barrierearmer Umbau benötigen jeweils einen
eigenen Prüfpfad; sie sind nicht automatisch BEG-Einzelmaßnahmen. Antragszeitpunkt,
Vorhabenbeginn und zulässige Vertragsbedingungen müssen **programmspezifisch**
geprüft werden. Eine pauschale Regel „nie vor Antrag unterschreiben“ wäre zu grob,
weil Programme unterschiedliche Bedingungen und Vertragsklauseln vorsehen können.

## Sinnvolle Integration in Angebote

1. Ein Angebot erhält künftig eine explizite **Förderprüfung** mit Status
   „Noch nicht geprüft / Unterlagen fehlen / Fachlich geprüft“. Das ist unabhängig
   von Angebotsannahme, Rechnungsbuchung und Zahlung.
2. Angebotspositionen werden konkreten Maßnahmen zugeordnet, z. B. Fenster oder
   Wärmepumpe. Fachlich prüfbare Merkmale wie U-Werte, Produktdaten,
   Ausführung durch einen Fachbetrieb und Beratungsnachweise werden dokumentiert.
3. Ein versionierter Programmdatensatz enthält Quelle, Prüftag, Gültigkeit,
   Förderart (Zuschuss/Kredit/Steuer), Bemessungsgrundlage, Höchstbeträge,
   Ausschlüsse, Antragsablauf und notwendige Nachweise. Änderungen erzeugen
   neue Fassungen statt bereits bestätigte Berechnungen rückwirkend zu verändern.
4. Nur geprüfte und belegte Kostenanteile werden einem Programm zugeordnet.
   Mischangebote, Eigenleistung, Material und Nebenkosten werden separat behandelt.
   Die vollständige Angebotssumme darf nicht automatisch als förderfähig gelten.
5. Überschneidungen zwischen Programmen und bereits erfassten Rechnungen werden
   als Prüfhinweise angezeigt. Förderkredite gehören weiterhin in Finanzierung;
   ihr Kapital darf nicht zusätzlich als Zuschuss gezählt werden.
6. ChatGPT kann nach ausdrücklicher Auswahl Angebote und aktuelle Quellen
   gegenüberstellen und fehlende Angaben benennen. Die Entscheidung und jede
   Übernahme eines Förderbetrags bleiben beim Benutzer beziehungsweise der
   qualifizierten Energieberatung.

Für diesen Ausbau wären Gebäude-/Standortdaten sowie echte technische Nachweise
nützlicher als eine reine Zuordnung nach Gewerk. Zunächst bleibt die neue manuelle
Förderplanung die verlässliche Grundlage.
