"""E2E checks for PDF -> draft -> listing -> accept/reject -> single cost item."""
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
from app import (app, db, initialize, Offer, OfferVersion, OfferPosition, CostItem, BudgetLine, Category,
                 Document, Receipt, _analyse_pdf_offer)
from sqlalchemy import select,text


def parsed_offer(*, gross=119.0, vendor='Beispiel Elektro GmbH'):
    return {'filename':'handwerker.pdf','family':'Andere','vendor':vendor,'number':'EL-123',
            'issued':'22.10.2026','expires':'','gross':gross,'net':100.0,'vat':19.0,
            'tax_rate':19.0,'reconciled':False,'warnings':['Maschinell gelesen, prüfen'],
            'groups':[],'positions':[]}


class OfferReviewWorkflowTest(unittest.TestCase):
    def setUp(self):
        self.ctx=app.app_context();self.ctx.push()
        db.session.remove();db.drop_all();initialize()
        self.client=app.test_client()
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.files=Path(self.temp.name)/'pdf'
        self.files.mkdir()
        self.path_patch=patch('app.DOCUMENT_ROOT',self.files)
        self.path_patch.start();self.addCleanup(self.path_patch.stop)

    def tearDown(self):
        db.session.remove();db.drop_all();self.ctx.pop()

    def upload(self, contents, gross=119.0, vendor='Beispiel Elektro GmbH'):
        with patch('app._analyse_pdf_offer',return_value=(parsed_offer(gross=gross,vendor=vendor),'Elektro GmbH Installation Kabel')):
            return self.client.post('/api/offers/import',data={'file':(io.BytesIO(contents),'handwerker.pdf')},content_type='multipart/form-data')

    def forecast(self):
        return self.client.get('/api/costs').json['summary']

    def test_draft_listing_accept_reject_and_single_cost(self):
        baseline=self.forecast()
        response=self.upload(b'%PDF-test-offer-unique-1')
        self.assertEqual(response.status_code,201,response.json)
        offer=response.json['offer'];id_=offer['id']
        self.assertEqual(offer['status'],'Entwurf')
        self.assertEqual(offer['category'],'Elektro')
        self.assertEqual(self.forecast()['planned'],baseline['planned'])
        self.assertFalse(db.session.scalars(select(CostItem).where(CostItem.offer_id==id_)).all())
        self.assertEqual(self.client.patch(f'/api/offers/{id_}',json={'status':'Angenommen'}).status_code,409)
        self.assertEqual(self.client.patch(f'/api/offers/{id_}/draft',json={'vendor':'E-Montage GmbH','gross':'125,50','category':'Elektro'}).status_code,200)
        self.assertEqual(self.client.patch(f'/api/offers/{id_}',json={'status':'Angebot'}).status_code,200)
        self.assertEqual(self.forecast()['planned'],baseline['planned'])
        self.assertEqual(self.client.patch(f'/api/offers/{id_}',json={'status':'Angenommen'}).status_code,200)
        self.assertEqual(self.forecast()['committed']-baseline['committed'],125.5)
        self.assertEqual(self.forecast()['planned']-baseline['planned'],125.5)
        costs=db.session.scalars(select(CostItem).where(CostItem.offer_id==id_)).all()
        self.assertEqual(len(costs),1)
        self.assertEqual(costs[0].offer,125.5)
        self.assertEqual(self.client.patch(f'/api/offers/{id_}',json={'status':'Angenommen'}).status_code,200)
        self.assertEqual(self.forecast()['committed']-baseline['committed'],125.5)
        corrected=self.client.patch(f'/api/offers/{id_}/draft',json={'gross':'20'})
        self.assertEqual(corrected.status_code,200,corrected.json)
        self.assertEqual(self.forecast()['committed']-baseline['committed'],20)
        self.assertEqual(self.client.patch(f'/api/offers/{id_}',json={'status':'Abgelehnt'}).status_code,200)
        self.assertEqual(self.forecast()['planned'],baseline['planned'])
        self.assertEqual(self.forecast()['committed'],baseline['committed'])
        self.assertEqual(self.client.patch(f'/api/offers/{id_}',json={'status':'Angebot'}).status_code,200)
        self.assertEqual(self.forecast()['planned'],baseline['planned'])
        self.assertEqual(self.client.get('/api/offers').json['offers'][0]['vendor'],'E-Montage GmbH')
        self.assertEqual(len(list(self.files.iterdir())),1)

    def test_compare_same_budget_line_only_awarded_offer_counts(self):
        line=BudgetLine(code='COMPARE',category='Elektro',title='Verkabelung',estimate=500,active=True)
        db.session.add(line);db.session.commit()
        first=self.upload(b'%PDF-a-11',gross=430).json['id']
        second=self.upload(b'%PDF-b-12',gross=480).json['id']
        for offer_id in (first,second):
            r=self.client.patch(f'/api/offers/{offer_id}/draft',json={'budget_line_id':line.id,'category':'Elektro'})
            self.assertEqual(r.status_code,200,r.json)
            self.assertEqual(self.client.patch(f'/api/offers/{offer_id}',json={'status':'Angebot'}).status_code,200)
        self.assertEqual(self.forecast()['line_forecasts'][str(line.id)],500)
        self.assertEqual(self.client.patch(f'/api/offers/{first}',json={'status':'Angenommen'}).status_code,200)
        self.assertEqual(self.forecast()['line_forecasts'][str(line.id)],430)
        self.assertEqual(self.client.patch(f'/api/offers/{second}',json={'status':'Angenommen'}).status_code,409)
        self.assertEqual(self.client.get('/api/offers').json['offers'][0]['status'],'Angebot')
        self.assertEqual(self.client.patch(f'/api/offers/{second}',json={'status':'Abgelehnt'}).status_code,200)
        self.assertEqual(self.forecast()['line_forecasts'][str(line.id)],430)

    def test_paid_or_linked_order_cannot_be_unaccepted(self):
        rid=self.upload(b'%PDF-paid-13').json['id']
        self.client.patch(f'/api/offers/{rid}',json={'status':'Angebot'})
        self.client.patch(f'/api/offers/{rid}',json={'status':'Angenommen'})
        cost=db.session.scalar(select(CostItem).where(CostItem.offer_id==rid))
        cost.paid=10;db.session.commit()
        self.assertEqual(self.client.patch(f'/api/offers/{rid}',json={'status':'Abgelehnt'}).status_code,409)
        self.assertEqual(db.session.get(Offer,rid).status,'Angenommen')
        self.assertEqual(self.client.delete(f'/api/offers/{rid}').status_code,409)

    def test_custom_category_rename_propagates_to_offers(self):
        result=self.client.post('/api/categories',json={'name':'Außenanlagen'})
        self.assertEqual(result.status_code,201,result.json)
        rid=self.upload(b'%PDF-category-14').json['id']
        self.assertEqual(self.client.patch(f'/api/offers/{rid}/draft',json={'category':'Außenanlagen'}).status_code,200)
        self.assertEqual(self.client.delete(f"/api/categories/{result.json['id']}").status_code,409)
        self.assertEqual(self.client.patch(f"/api/categories/{result.json['id']}",json={'name':'Gartenbau'}).status_code,200)
        self.assertEqual(db.session.get(Offer,rid).category,'Gartenbau')
        self.assertEqual(self.client.patch(f'/api/offers/{rid}/draft',json={'category':'Gibts Nicht'}).status_code,400)

    def test_duplicate_and_unreadable_pdf_manual_correction(self):
        first=self.upload(b'%PDF-duplicate-15',gross=None,vendor='Firma nicht erkannt')
        self.assertEqual(first.status_code,201)
        oid=first.json['id']
        self.assertEqual(self.upload(b'%PDF-duplicate-15').status_code,409)
        self.assertEqual(self.client.patch(f'/api/offers/{oid}',json={'status':'Angebot'}).status_code,409)
        self.assertEqual(self.client.patch(f'/api/offers/{oid}/draft',json={'vendor':'Korrekt GmbH','gross':'300,00'}).status_code,200)
        self.assertEqual(self.client.patch(f'/api/offers/{oid}',json={'status':'Angebot'}).status_code,200)
        self.assertEqual(self.client.get('/api/costs').json['summary']['committed'],0)

    def test_german_thousands_format_in_review(self):
        id_=self.upload(b'%PDF-format-18').json['id']
        response=self.client.patch(f'/api/offers/{id_}/draft',json={'gross':'1.234,56'})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(db.session.get(Offer,id_).gross,1234.56)
        self.assertEqual(self.client.patch(f'/api/offers/{id_}',json={'status':'Angebot'}).status_code,200)
        self.assertEqual(self.client.get('/api/costs').json['summary']['committed'],0)

    def test_reject_bad_amount_and_keep_values(self):
        id_=self.upload(b'%PDF-amount-16').json['id']
        for invalid in ('NaN','Infinity','-2','1.234','100000000'):
            self.assertEqual(self.client.patch(f'/api/offers/{id_}/draft',json={'gross':invalid}).status_code,400)
        self.assertEqual(db.session.get(Offer,id_).gross,119)
        self.assertEqual(self.client.patch(f'/api/offers/{id_}/draft',json={'gross':'0.00'}).status_code,200)
        self.assertEqual(self.client.patch(f'/api/offers/{id_}',json={'status':'Angebot'}).status_code,409)

    def test_offer_and_original_are_completely_deleted(self):
        result=self.upload(b'%PDF-archived-17');self.assertEqual(result.status_code,201)
        oid=result.json['id'];docid=result.json['offer']['document_id']
        self.assertEqual(self.client.delete('/api/offers/'+str(oid)).status_code,200)
        self.assertIsNone(db.session.get(Document,docid))
        self.assertEqual(len(list(self.files.iterdir())),0)

    def test_listed_undecided_offer_can_be_deleted_with_positions_and_versions(self):
        result=self.upload(b'%PDF-delete-full');oid=result.json['id']
        self.assertEqual(self.client.patch(f'/api/offers/{oid}',json={'status':'Angebot'}).status_code,200)
        offer=db.session.get(Offer,oid)
        second=Document(original_name='revision.pdf',stored_name='revision.pdf',kind='Angebot')
        db.session.add(second);db.session.flush();(self.files/'revision.pdf').write_bytes(b'PDF revision')
        db.session.add(OfferVersion(offer_id=oid,version_number=2,state='draft',document_id=second.id,snapshot='{}'))
        db.session.add(OfferPosition(offer_id=oid,number='1',section='Test',description='Test'))
        db.session.commit()
        self.assertTrue(self.client.get('/api/offers').json['offers'][0]['can_delete'])
        self.assertEqual(self.client.delete(f'/api/offers/{oid}').status_code,200)
        self.assertIsNone(db.session.get(Offer,oid))
        self.assertEqual(db.session.query(OfferVersion).count(),0)
        self.assertEqual(db.session.query(OfferPosition).count(),0)
        self.assertEqual(db.session.query(Document).count(),0)
        self.assertEqual(list(self.files.iterdir()),[])

    def test_database_default_keeps_new_raw_insert_undecided(self):
        db.session.execute(text("INSERT INTO offer (digest,vendor,filename,status,category,notes,reconciled,warnings) VALUES ('raw','Raw quote','manual','Angebot','Elektro','',FALSE,'[]')"))
        db.session.commit()
        offer=db.session.scalar(select(Offer).where(Offer.digest=='raw'))
        self.assertFalse(offer.deletion_locked)
        self.assertEqual(self.client.delete(f'/api/offers/{offer.id}').status_code,200)

    def test_rejected_then_relisted_offer_stays_protected(self):
        oid=self.upload(b'%PDF-relisted-protected').json['id']
        for status in ('Angebot','Abgelehnt','Angebot'):
            self.assertEqual(self.client.patch(f'/api/offers/{oid}',json={'status':status}).status_code,200)
        self.client.patch(f'/api/offers/{oid}/draft',json={'deletion_locked':False})
        self.assertTrue(db.session.get(Offer,oid).deletion_locked)
        self.assertFalse(self.client.get('/api/offers').json['offers'][0]['can_delete'])
        self.assertEqual(self.client.delete(f'/api/offers/{oid}').status_code,409)
        self.assertEqual(len(list(self.files.iterdir())),1)

    def test_accepted_then_reversed_offer_stays_protected(self):
        oid=self.upload(b'%PDF-accepted-reversed').json['id']
        for status in ('Angebot','Angenommen','Angebot'):
            self.assertEqual(self.client.patch(f'/api/offers/{oid}',json={'status':status}).status_code,200)
        self.assertEqual(self.client.delete(f'/api/offers/{oid}').status_code,409)

    def test_any_linked_invoice_even_draft_prevents_deletion(self):
        oid=self.upload(b'%PDF-linked-draft').json['id']
        item=CostItem(offer_id=oid,title='Legacy link',committed=0,paid=0)
        db.session.add(item);db.session.flush()
        db.session.add(Receipt(digest='linked-draft',stored_name='draft.pdf',original_name='draft.pdf',cost_item_id=item.id,status='Entwurf'))
        db.session.commit()
        self.assertEqual(self.client.delete(f'/api/offers/{oid}').status_code,409)

    def test_delete_failure_restores_original_and_database(self):
        result=self.upload(b'%PDF-rollback-delete');oid=result.json['id'];docid=result.json['offer']['document_id']
        with patch.object(db.session,'commit',side_effect=RuntimeError('DB unavailable')):
            self.assertEqual(self.client.delete(f'/api/offers/{oid}').status_code,409)
        self.assertIsNotNone(db.session.get(Offer,oid))
        self.assertIsNotNone(db.session.get(Document,docid))
        self.assertEqual(len(list(self.files.iterdir())),1)

    def test_shared_original_protects_both_offers(self):
        result=self.upload(b'%PDF-shared');oid=result.json['id']
        other=Offer(digest='shared-original',vendor='Another',filename='same.pdf',status='Angebot',document_id=result.json['offer']['document_id'])
        db.session.add(other);db.session.commit()
        self.assertEqual(self.client.delete(f'/api/offers/{oid}').status_code,409)
        self.assertEqual(len(list(self.files.iterdir())),1)

    def test_parser_failure_results_in_manual_draft(self):
        with (patch('app.pdf_to_pages',side_effect=ValueError('Keine lesbare Textebene')),
              patch('app.extract_text',side_effect=ValueError('Tesseract fehlt'))):
            p, content=_analyse_pdf_offer(b'%PDF-...','scan.pdf')
        self.assertIsNone(p['gross']);self.assertEqual(content,'')
        self.assertTrue(any('OCR nicht verfügbar' in w for w in p['warnings']))


if __name__=='__main__':unittest.main()
