# Zahlungsübersicht angenommener Angebote

Die Angebotsübersicht zeigt sechs gleich große Kennzahlen: zu prüfen, im Vergleich,
angenommen, angenommene Summe, bereits bezahlt und noch offen. Sie beziehen sich
auf das gesamte Projekt, unabhängig vom Kachelfilter.

„Bereits bezahlt“ summiert die tatsächlichen Zahlungen gebuchter Rechnungen zu
angenommenen Angeboten. Entwürfe und stornierte Rechnungen zählen nicht mit.
„Noch offen“ summiert pro Auftrag den positiven Rest aus angenommenem Auftragswert
und Zahlungen. Überzahlungen eines Auftrags decken keinen anderen Auftrag ab.

„Als bezahlt markieren“ schließt den Zahlungsstand nach einer Bestätigung manuell
ab. Der offene Rest dieses Angebots zählt danach mit null. Tatsächliche Zahlungen,
Rechnungen, Finanzierungszuordnungen und Auftragswerte werden nicht verändert.
Bei Unter- oder Überschreitung müssen angenommene Summe, bezahlt und offen daher
nicht dieselbe rechnerische Gesamtsumme ergeben. Die Markierung lässt sich wieder
zurücknehmen. Auch bei exakt erreichter Auftragssumme erfolgt kein automatischer
Abschluss. Beim Zurücknehmen einer Angebotsannahme wird die Markierung aufgehoben.

Migration 0047 ergänzt `offer.payment_completed` ohne Änderungen an Altbeträgen.
Bestehende Angebote sowie alte Projektbackups beginnen ohne manuelle Markierung.
Aktuelle Backups bewahren die Markierung. Die Änderung ist projektbezogen und
verwendet die vorhandene Projektsperre und Konfliktprüfung.
