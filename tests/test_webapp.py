"""Integration smoke tests; run after installing requirements.txt."""
from decimal import Decimal
import os
import unittest

# The test DB is in-memory and contains no private documents.
os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
from app import app, db, initialize, BudgetLine, CostItem, add_parsed_offer, OfferSection
from offer_parser import parse_offer
from sqlalchemy import select


class OfferWebappTest(unittest.TestCase):
    def test_offer_does_not_change_budget_before_explicit_activation(self):
        with app.app_context():
            db.drop_all()
            initialize()
            line=BudgetLine(code='DEMO',category='Elektro',title='Testinstallation',estimate=200,sort_order=9000)
            db.session.add(line)
            db.session.flush()
            parsed=parse_offer(['''Test Handwerk GmbH Angebot-Nr.: ABC-7
PHOTOVOLTAIKANLAGE
1    1,00 Stk. PHOTOVOLTAIKANLAGE € 100,00 € 100,00
Summe Photovoltaik: € 100,00
Listenpreis: € 100,00
Gesamtsumme: € 100,00'''],'anonym.pdf')
            self.assertTrue(parsed['reconciled'])
            offer=add_parsed_offer(parsed,'a'*64)
            db.session.commit()
            section_id=offer.sections[0].id
            offer_id=offer.id
            line_id=line.id

        client=app.test_client()
        self.assertEqual(client.get('/').status_code,200)
        self.assertEqual(client.get('/kosten').status_code,200)
        payload=client.get('/api/costs').get_json()
        self.assertEqual(payload['summary']['planned'],200.0)
        self.assertEqual(len(payload['offers']),1)
        self.assertFalse(payload['offers'][0]['sections'][0]['selected'])

        res=client.patch(f'/api/offer-sections/{section_id}',json={'budget_line_id':line_id,'selected':True})
        self.assertEqual(res.status_code,200,res.get_json())
        self.assertEqual(client.get('/api/costs').get_json()['summary']['planned'],100.0)
        with app.app_context():
            imported=db.session.scalars(select(CostItem).where(CostItem.offer_id==offer_id)).all()
            self.assertEqual(len(imported),1)
            self.assertEqual(imported[0].offer,100)
            item_id=imported[0].id

        res=client.patch(f'/api/offer-costs/{item_id}',json={'paid':30})
        self.assertEqual(res.status_code,200,res.get_json())
        self.assertEqual(client.get('/api/costs').get_json()['summary']['paid'],30)
        res=client.patch(f'/api/offers/{offer_id}',json={'status':'Beauftragt'})
        self.assertEqual(res.status_code,200,res.get_json())
        self.assertEqual(client.get('/api/costs').get_json()['summary']['committed'],100)
        # A paid assignment must never be removed silently.
        res=client.patch(f'/api/offer-sections/{section_id}',json={'selected':False})
        self.assertEqual(res.status_code,409)
        self.assertEqual(client.get('/api/costs').get_json()['summary']['planned'],100)


if __name__=='__main__':unittest.main()
