"""Regression: two simple entry methods and one single offer list / forecast source."""
import os
import io
import tempfile
from pathlib import Path
from unittest.mock import patch
import unittest
from sqlalchemy import select

os.environ['DATABASE_URL']='sqlite:///:memory:'
from app import app, db, initialize, Offer, CostItem, BudgetLine, Category, Contractor, Document


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

    @staticmethod
    def pdf():
        from pypdf import PdfWriter
        writer=PdfWriter();writer.add_blank_page(width=595,height=842)
        output=io.BytesIO();writer.write(output);return output.getvalue()

    def test_manual_pdf_is_attached_without_ocr_or_changing_entered_amounts(self):
        with tempfile.TemporaryDirectory() as tmp,patch('app.DOCUMENT_ROOT',Path(tmp)),patch('app.extract_text',side_effect=AssertionError('manual attachment must not run OCR')),patch('app._analyse_offer_with_mode',side_effect=AssertionError('manual attachment must not run AI')):
            result=self.client.post('/api/offers/manual',data={'vendor':'Manuelle Firma','gross':'1234,56','category':'Elektro','file':(io.BytesIO(self.pdf()),'angebot.pdf')})
            self.assertEqual(result.status_code,201,result.json)
            offer=result.json['offer'];self.assertEqual(offer['gross'],1234.56)
            self.assertEqual(offer['status'],'Angebot')
            doc=db.session.get(Document,offer['document_id'])
            self.assertEqual((Path(tmp)/doc.stored_name).read_bytes(),self.pdf())
            download=self.client.get(f'/api/documents/{doc.id}/download');self.assertEqual(download.status_code,200);download.close()
            self.assertEqual(self.client.delete(f"/api/offers/{offer['id']}").status_code,200)
            self.assertEqual(list(Path(tmp).iterdir()),[])

    def test_invalid_or_duplicate_manual_pdf_is_atomic(self):
        with tempfile.TemporaryDirectory() as tmp,patch('app.DOCUMENT_ROOT',Path(tmp)):
            for name,data in [('wrong.txt',b'%PDF-1.4'),('broken.pdf',b'%PDF-broken'),('oversized.pdf',b'%PDF-'+b'x'*(15*1024*1024))]:
                result=self.client.post('/api/offers/manual',data={'vendor':'Bad','gross':500,'category':'Elektro','file':(io.BytesIO(data),name)})
                self.assertEqual(result.status_code,400,result.json)
                self.assertEqual(db.session.query(Offer).count(),0)
                self.assertEqual(db.session.query(Document).count(),0)
                self.assertEqual(list(Path(tmp).iterdir()),[])
            for expected in (201,400):
                result=self.client.post('/api/offers/manual',data={'vendor':'Valid','gross':500,'category':'Elektro','file':(io.BytesIO(self.pdf()),'valid.pdf')})
                self.assertEqual(result.status_code,expected,result.json)
            self.assertEqual(db.session.query(Offer).count(),1)
            self.assertEqual(len(list(Path(tmp).iterdir())),1)

    def test_attachment_is_removed_when_offer_transaction_fails(self):
        with tempfile.TemporaryDirectory() as tmp,patch('app.DOCUMENT_ROOT',Path(tmp)),patch.object(db.session,'commit',side_effect=RuntimeError('DB unavailable')):
            result=self.client.post('/api/offers/manual',data={'vendor':'Unstored','gross':500,'category':'Elektro','file':(io.BytesIO(self.pdf()),'original.pdf')})
            self.assertEqual(result.status_code,500)
            self.assertEqual(list(Path(tmp).iterdir()),[])
        self.assertEqual(db.session.query(Offer).count(),0)
        self.assertEqual(db.session.query(Document).count(),0)

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

    def test_selected_masterdata_company_controls_offer_vendor(self):
        company=Contractor(name='Elektro Stammdaten GmbH',trade='Elektro')
        db.session.add(company);db.session.commit()
        response=self.client.post('/api/offers/manual',json={
            'vendor':'Nicht maßgeblicher Freitext','contractor_id':company.id,
            'gross':'7500','category':'Elektro'})
        self.assertEqual(response.status_code,201,response.json)
        offer=db.session.get(Offer,response.json['id'])
        self.assertEqual(offer.contractor_id,company.id)
        self.assertEqual(offer.vendor,company.name)
        invalid=self.client.post('/api/offers/manual',json={
            'contractor_id':999999,'gross':'100','category':'Elektro'})
        self.assertEqual(invalid.status_code,400,invalid.json)

    def test_manual_offers_remain_editable_after_acceptance(self):
        oid=self.create().json['id']
        self.assertEqual(self.client.patch(f'/api/offers/{oid}/draft',json={'vendor':'Sanitär Neu','gross':'9.100,00'}).status_code,200)
        self.assertEqual(db.session.get(Offer,oid).gross,9100)
        self.client.patch(f'/api/offers/{oid}',json={'status':'Angenommen'})
        changed=self.client.patch(f'/api/offers/{oid}/draft',json={'gross':'1','notes':'Korrigiert'})
        self.assertEqual(changed.status_code,200,changed.json)
        self.assertEqual(db.session.get(Offer,oid).gross,1)
        self.assertEqual(db.session.get(Offer,oid).notes,'Korrigiert')

    def test_simple_navigation_does_not_duplicate_offer_forms_in_costs(self):
        offers=self.client.get('/angebote').get_data(as_text=True)
        costs=self.client.get('/kosten').get_data(as_text=True)
        self.assertIn('id="offerManualForm"',offers)
        self.assertIn('id="offerManualContractor"',offers)
        self.assertIn('id="offerCompanyDialog"',offers)
        self.assertIn('id="offerImportForm"',offers)
        self.assertIn('id="offersAcceptedTotal"',offers)
        self.assertIn('id="rejectedOffersSection"',offers)
        self.assertIn('id="rejectedOfferList"',offers)
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
