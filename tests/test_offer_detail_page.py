"""Dedicated offer route must retain the project boundary and known edit workflow."""
import os,unittest
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b

class OfferDetailPageTest(unittest.TestCase):
    def setUp(self):
        self.ctx=b.app.app_context();self.ctx.push();b.db.session.remove();b.db.drop_all();b.initialize();self.client=b.app.test_client()
    def tearDown(self):b.db.session.remove();b.db.drop_all();self.ctx.pop()
    def test_detail_route_keeps_offer_workflow_and_denies_foreign_project(self):
        offer=self.client.post('/api/offers/manual',json={'vendor':'Eigener Betrieb','net':100,'vat':19,'gross':119,'category':'Sonstiges'}).json['offer']
        path='/angebote/'+str(offer['id'])+'?_classic=1&_embedded=1'
        response=self.client.get(path);self.assertEqual(response.status_code,200)
        html=response.get_data(as_text=True)
        self.assertIn('phb-offer-detail-page',html);self.assertIn('Zurück zu Angeboten',html)
        self.assertIn('offerPositionsDialog',html);self.assertIn('offerPositionImportDialog',html)
        self.assertIn('<h1 id="offerEditTitle">',html)
        other=self.client.post('/api/projects',json={'title':'Anderes Projekt'}).json['project']['id']
        self.assertEqual(self.client.get(path,headers={'X-PHB-Project':str(other)}).status_code,404)
        self.assertEqual(b.db.session.get(b.Offer,offer['id']).gross,119)
