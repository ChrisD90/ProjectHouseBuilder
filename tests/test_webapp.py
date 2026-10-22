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
    def test_offer_requires_promotion_and_acceptance_before_changing_budget(self):
        with app.app_context():
            db.drop_all(); initialize()
            line=BudgetLine(code='DEMO',category='Elektro',title='Testinstallation',estimate=200,sort_order=9000)
            db.session.add(line); db.session.flush()
            parsed=parse_offer(['Test Handwerk GmbH Angebot-Nr.: ABC-7\nPHOTOVOLTAIKANLAGE\n1   1,00 Stk. PHOTOVOLTAIKANLAGE € 100,00 € 100,00\nSumme Photovoltaik: € 100,00\nListenpreis: € 100,00\nGesamtsumme: € 100,00'],'anonym.pdf')
            offer=add_parsed_offer(parsed,'a'*64)
            db.session.commit()
            oid=offer.id;section_id=offer.sections[0].id;line_id=line.id
        client=app.test_client()
        self.assertEqual(client.get('/kosten').status_code,200)
        self.assertEqual(client.get('/api/costs').json['summary']['planned'],200)
        self.assertEqual(client.patch(f'/api/offer-sections/{section_id}',json={'selected':True}).status_code,409)
        self.assertEqual(client.get('/api/costs').json['summary']['planned'],200)
        self.assertEqual(client.patch(f'/api/offers/{oid}/draft',json={'category':'Elektro','budget_line_id':line_id}).status_code,200)
        self.assertEqual(client.patch(f'/api/offers/{oid}',json={'status':'Angebot'}).status_code,200)
        self.assertEqual(client.get('/api/costs').json['summary']['planned'],200)
        self.assertEqual(client.patch(f'/api/offers/{oid}',json={'status':'Angenommen'}).status_code,200)
        self.assertEqual(client.get('/api/costs').json['summary']['planned'],100)
        with app.app_context():
            cost=db.session.scalar(select(CostItem).where(CostItem.offer_id==oid))
            self.assertIsNotNone(cost);item_id=cost.id
        self.assertEqual(client.patch(f'/api/offer-costs/{item_id}',json={'paid':30}).status_code,200)
        self.assertEqual(client.get('/api/costs').json['summary']['paid'],30)
        self.assertEqual(client.patch(f'/api/offers/{oid}',json={'status':'Abgelehnt'}).status_code,409)
        self.assertEqual(client.get('/api/costs').json['summary']['planned'],100)


if __name__=='__main__':unittest.main()


class AcceptedOfferTest(unittest.TestCase):
    def setUp(self):
        with app.app_context():
            db.drop_all(); initialize()
    def test_no_preloaded_offers(self):
        client=app.test_client()
        self.assertEqual(client.get('/api/offers').get_json()['offers'],[])
    def test_accept_without_manual_section_selection_counts_full_cost(self):
        parsed=parse_offer(['''Test Handwerk GmbH Angebot-Nr.: DEMO-8
PHOTOVOLTAIKANLAGE
1    1,00 Stk. PHOTOVOLTAIKANLAGE € 100,00 € 100,00
Summe Photovoltaik: € 100,00
Listenpreis: € 100,00
Gesamtsumme: € 100,00'''],'dummy.pdf')
        with app.app_context():
            offer=add_parsed_offer(parsed,'b'*64); db.session.commit();oid=offer.id
        client=app.test_client()
        before=client.get('/api/costs').get_json()['summary']
        self.assertEqual(client.patch(f'/api/offers/{oid}',json={'status':'Angebot'}).status_code,200)
        res=client.patch(f'/api/offers/{oid}',json={'status':'Angenommen'})
        self.assertEqual(res.status_code,200,res.get_json())
        after=client.get('/api/costs').get_json()['summary']
        self.assertAlmostEqual(after['planned']-before['planned'],100)
        self.assertAlmostEqual(after['committed']-before['committed'],100)
        self.assertEqual(client.get('/api/offers').get_json()['offers'][0]['status'],'Angenommen')
        # Re-applying status is idempotent, not another cost.
        self.assertEqual(client.patch(f'/api/offers/{oid}',json={'status':'Angenommen'}).status_code,200)
        self.assertEqual(client.get('/api/costs').get_json()['summary']['committed'],after['committed'])
    def test_revert_to_offer_clears_cost(self):
        parsed=parse_offer(['''Test Handwerk GmbH Angebot-Nr.: DEMO-9
PHOTOVOLTAIKANLAGE
1    1,00 Stk. PHOTOVOLTAIKANLAGE € 100,00 € 100,00
Summe Photovoltaik: € 100,00
Listenpreis: € 100,00
Gesamtsumme: € 100,00'''],'dummy.pdf')
        with app.app_context():
            offer=add_parsed_offer(parsed,'c'*64);db.session.commit();oid=offer.id
        c=app.test_client()
        self.assertEqual(c.patch(f'/api/offers/{oid}',json={'status':'Angebot'}).status_code,200)
        self.assertEqual(c.patch(f'/api/offers/{oid}',json={'status':'Angenommen'}).status_code,200)
        self.assertEqual(c.patch(f'/api/offers/{oid}',json={'status':'Angebot'}).status_code,200)
        self.assertEqual(c.get('/api/costs').get_json()['summary']['committed'],0)


class LanAuthenticationTest(unittest.TestCase):
    def test_password_protects_data_and_allows_login(self):
        from unittest.mock import patch
        with patch.dict(os.environ, {'APP_PASSWORD':'local-test-only'}):
            client=app.test_client()
            self.assertEqual(client.get('/api/project').status_code,401)
            self.assertEqual(client.get('/').status_code,302)
            self.assertEqual(client.get('/static/style.css').status_code,200)
            self.assertEqual(client.post('/login',data={'password':'wrong'}).status_code,401)
            self.assertEqual(client.post('/login',data={'password':'local-test-only'}).status_code,302)
            self.assertEqual(client.get('/api/project').status_code,200)
            self.assertEqual(client.post('/logout').status_code,302)
            self.assertEqual(client.get('/api/project').status_code,401)
    def test_pwa_manifest_and_worker(self):
        client=app.test_client()
        self.assertEqual(client.get('/manifest.webmanifest').status_code,200)
        self.assertEqual(client.get('/sw.js').status_code,200)
