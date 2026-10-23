"""Regression: two simple entry methods and one single offer list / forecast source."""
import os
import unittest
from sqlalchemy import select

os.environ['DATABASE_URL']='sqlite:///:memory:'
from app import app, db, initialize, Offer, CostItem, BudgetLine, Category


class ManualOfferTests(unittest.TestCase):
    def setUp(self):
        self.ctx=app.app_context(); self.ctx.push()
        db.session.remove(); db.drop_all(); initialize()
        self.client=app.test_client()

    def tearDown(self):
        db.session.remove(); db.drop_all(); self.ctx.pop()

    def create(self, **changes):
        data={'vendor':'Sanitär Muster GmbH','gross':'8.500,00', 'category':'Sanitär'}
        data.update(changes)
        return self.client.post('/api/offers/manual',json=data)

    def test_manual_offer_can_be_compared_and_accepted_exactly_once(self):
        initial=self.client.get('/api/costs').json['summary']
        response=self.create()
        self.assertEqual(response.status_code,201,response.json)
        quote=response.json['offer']
        self.assertEqual(quote['status'],'Angebot')
        self.assertIsNone(quote['document_id'])
        self.assertEqual(quote['gross'],8500)
        self.assertEqual(self.client.get('/api/costs').json['summary']['planned'],initial['planned'])
        oid=quote['id']
        accepted=self.client.patch(f'/api/offers/{oid}',json={'status':'Angenommen'})
        self.assertEqual(accepted.status_code,200,accepted.json)
        self.assertEqual(self.client.get('/api/costs').json['summary']['planned']-initial['planned'],8500)
        self.assertEqual(self.client.patch(f'/api/offers/{oid}',json={'status':'Angenommen'}).status_code,200)
        self.assertEqual(self.client.get('/api/costs').json['summary']['committed']-initial['committed'],8500)
        rows=db.session.scalars(select(CostItem).where(CostItem.offer_id==oid)).all()
        self.assertEqual(len(rows),1)
        self.assertEqual(self.client.patch(f'/api/offers/{oid}',json={'status':'Abgelehnt'}).status_code,200)
        self.assertEqual(self.client.get('/api/costs').json['summary']['planned'],initial['planned'])

    def test_manual_offer_with_budget_line_replaces_estimate(self):
        line=BudgetLine(code='SAN-001',category='Sanitär',title='Neue Steigleitung',estimate=12000,active=True)
        db.session.add(line);db.session.commit()
        initial=self.client.get('/api/costs').json['summary']['planned']
        res=self.create(budget_line_id=line.id,gross='9.800,50')
        self.assertEqual(res.status_code,201,res.json)
        oid=res.json['id']
        self.assertEqual(self.client.get('/api/costs').json['summary']['planned'],initial)
        self.assertEqual(self.client.patch(f'/api/offers/{oid}',json={'status':'Angenommen'}).status_code,200)
        self.assertAlmostEqual(self.client.get('/api/costs').json['summary']['planned'],initial-12000+9800.5,2)
        self.assertEqual(len(db.session.scalars(select(CostItem).where(CostItem.offer_id==oid)).all()),1)

    def test_manual_offer_validates_amount_vendor_category_budget_and_type(self):
        for body in ({'vendor':'','gross':'150','category':'Sanitär'},
                     {'vendor':'A','gross':'-20','category':'Sanitär'},
                     {'vendor':'A','gross':'100','category':'Fantasiegewerk'},
                     {'vendor':'A','gross':'NaN','category':'Sanitär'},
                     {'vendor':'A','gross':'1.234','category':'Sanitär'},
                     {'vendor':'A','gross':'200','category':'Sanitär','budget_line_id':'abc'},
                     ['kein', 'Objekt']):
            with self.subTest(body=body):
                resp=self.client.post('/api/offers/manual',json=body)
                self.assertEqual(resp.status_code,400,resp.json)
        self.assertEqual(db.session.scalar(db.select(db.func.count(Offer.id))),0)

    def test_manual_offers_are_editable_before_but_not_after_acceptance(self):
        oid=self.create().json['id']
        self.assertEqual(self.client.patch(f'/api/offers/{oid}/draft',json={'vendor':'Sanitär Neu','gross':'9.100,00'}).status_code,200)
        self.assertEqual(db.session.get(Offer,oid).gross,9100)
        self.client.patch(f'/api/offers/{oid}',json={'status':'Angenommen'})
        self.assertEqual(self.client.patch(f'/api/offers/{oid}/draft',json={'gross':'1'}).status_code,409)
        self.assertEqual(db.session.get(Offer,oid).gross,9100)

    def test_simple_navigation_does_not_duplicate_offer_forms_in_costs(self):
        offers=self.client.get('/angebote').get_data(as_text=True)
        costs=self.client.get('/kosten').get_data(as_text=True)
        self.assertIn('id="offerManualForm"',offers)
        self.assertIn('id="offerImportForm"',offers)
        self.assertNotIn('id="offerManualForm"',costs)
        self.assertNotIn('id="offerImportForm"',costs)
        self.assertNotIn('PDF-Angebote · Entwürfe & Vergleich',costs)
        self.assertNotIn('Angebote, Aufträge & Ausgaben',costs)
        self.assertIn('href="/angebote"',costs)

    def test_custom_category_available_for_manual_quote(self):
        cat=self.client.post('/api/categories',json={'name':'Baustelleneinrichtung'})
        self.assertEqual(cat.status_code,201)
        resp=self.create(category='Baustelleneinrichtung')
        self.assertEqual(resp.status_code,201,resp.json)
        self.assertEqual(resp.json['offer']['category'],'Baustelleneinrichtung')


if __name__=='__main__':unittest.main()
