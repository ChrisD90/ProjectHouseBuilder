"""Parser test fixtures are synthetic: no private client documents in Git."""
import unittest
from offer_parser import parse_offer


class OfferParserTest(unittest.TestCase):
    def test_optional_position_is_not_part_of_total(self):
        page='''Demo Energie GmbH                Angebot-Nr.: D-42
Datum: 01.01.2026
Gültig bis: 31.01.2026
PHOTOVOLTAIKANLAGE
Pos. Menge Einheit Bezeichnung E-Preis G-Preis
1   1,00 Stk. PHOTOVOLTAIKANLAGE  € 100,00     € 100,00
2   1,00 Stk. GERÜSTSTELLUNG      € 75,00      € 75,00
Optionalposition – zählt nicht in die Angebotssumme
Summe Photovoltaik: € 100,00
Listenpreis: € 100,00
Mehrwertsteuer (MwSt.: 0%): € 0,00
Gesamtsumme: € 100,00'''
        parsed=parse_offer([page],'anonym.pdf')
        self.assertEqual(parsed['vendor'],'Demo Energie GmbH')
        self.assertTrue(parsed['reconciled'])
        self.assertEqual(len(parsed['positions']),2)
        self.assertEqual(parsed['positions'][0]['net_amount'],100)
        self.assertEqual(parsed['positions'][1]['net_amount'],0)
        self.assertEqual(parsed['positions'][1]['optional_amount'],75)
        self.assertFalse(parsed['groups'][0]['selected'])

    def test_p3_style_joined_columns_and_ep(self):
        page='''Beispiel Elektro GmbH
Angebot 99/001A
Elektroverteilungen
1.1 1,00StckSchaltschrank                                         250,00 € 250,00 €
4.15145,00StckGeräteverbindungsdose UP                          7,00 € 1.015,00 €
4.16 1,00StckOptionale Steckdose                                16,00 € E.P.
Nettosumme                                        1.265,00 €
Umsatzsteuer 19 %                                   240,35 €
Gesamtsumme                                       1.505,35 €'''
        parsed=parse_offer([page],'anonym.pdf')
        self.assertTrue(parsed['reconciled'])
        self.assertEqual(len(parsed['positions']),3)
        self.assertEqual(parsed['positions'][1]['number'],'4.15')
        self.assertEqual(parsed['positions'][1]['quantity'],145.0)
        self.assertEqual(sum(p['net_amount'] for p in parsed['positions']),1265)

    def test_sum_mismatch_blocks_activation(self):
        page='''Angebot-Nr.: D-12
PHOTOVOLTAIKANLAGE
1   1,00 Stk. PHOTOVOLTAIKANLAGE  € 100,00 € 100,00
Summe Photovoltaik: € 100,00
Listenpreis: € 120,00
Gesamtsumme: € 120,00'''
        parsed=parse_offer([page],'document.pdf')
        self.assertFalse(parsed['reconciled'])
        self.assertTrue(parsed['warnings'])

    def test_taxed_sections_reconcile_to_gross(self):
        page='''Demo Energie GmbH       Angebot-Nr.: X-2
Summe Wärmepumpe & Speicher: € 50,00
FUßBODENHEIZUNG
1 1,00 Stk. Wärmepumpe  € 50,00 € 50,00
13 1,00 Stk. Fußbodenheizung  € 50,00 € 50,00
Listenpreis: € 100,00
Mehrwertsteuer (MwSt.: 19%): € 19,00
Gesamtsumme: € 119,00'''
        p=parse_offer([page],'document.pdf')
        self.assertTrue(p['reconciled'])
        self.assertEqual(sum(x['gross'] for x in p['groups']),119)


if __name__=='__main__':unittest.main()
