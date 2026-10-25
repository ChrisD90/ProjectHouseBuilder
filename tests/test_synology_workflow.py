"""Synology workflow tests: firm proposals, task completion and in-place previews."""
import os
import tempfile
import unittest
from datetime import date
import io
from pypdf import PdfWriter
from pathlib import Path

os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as backend
from app import app, db, initialize, Contractor, Task, Offer, OfferSection, Document, Receipt, ProjectDocument, OrderAcceptance, CostItem
from assignment_suggestions import suggestions


class AssignmentEngineTest(unittest.TestCase):
    def test_diy_and_existing_firms_are_never_suggested(self):
        source=[{'contractor_id':5,'contractor':'Solar Beispiel',
                 'category':'Photovoltaik','trade':'Elektro',
                 'details':'PV Wechselrichter installieren','reason':'Angenommenes Angebot'}]
        tasks=[
            {'id':1,'trade':'Elektro','name':'PV Wechselrichter','execution_type':'Fremdleistung','company':'','contractor_id':None},
            {'id':2,'trade':'Elektro','name':'PV Wechselrichter','execution_type':'Eigenleistung','company':'','contractor_id':None},
            {'id':3,'trade':'Elektro','name':'PV Wechselrichter','execution_type':'Fremdleistung','company':'','contractor_id':10},
        ]
        output=suggestions(tasks,source)
        self.assertEqual(output['1'][0]['contractor_id'],5)
        self.assertNotIn('2',output)
        self.assertNotIn('3',output)


class SynologyWorkflowTest(unittest.TestCase):
    def setUp(self):
        self.scope=app.app_context();self.scope.push()
        db.drop_all();initialize()
        self.client=app.test_client()
        company=Contractor(name='Solar Beispiel GmbH',trade='Photovoltaik')
        task=Task(code='SOLAR-DEMO',phase='Haustechnik',trade='PV / Elektro',
                  name='Photovoltaikanlage mit Wechselrichter montieren',
                  execution_type='Fremdleistung',position=999)
        db.session.add_all([company,task]);db.session.flush()
        quote=Offer(digest='d'*64,contractor_id=company.id,vendor=company.name,
                    filename='beispiel.pdf',status='Angebot',
                    category='Photovoltaik',gross=119,net=100,vat=19)
        db.session.add(quote);db.session.flush()
        db.session.add(OfferSection(offer_id=quote.id,name='Photovoltaikanlage mit Wechselrichter',
                                    net=100,gross=119))
        db.session.commit()
        self.cid,self.tid,self.oid=company.id,task.id,quote.id

    def tearDown(self):
        db.session.remove();self.scope.pop()

    def test_accept_offer_then_assign_after_confirmation(self):
        self.assertFalse(self.client.get('/api/project').json['contractor_suggestions'])
        result=self.client.patch(f'/api/offers/{self.oid}',json={'status':'Angenommen'})
        self.assertEqual(result.status_code,200,result.json)
        options=self.client.get('/api/project').json['contractor_suggestions']
        self.assertEqual(options[str(self.tid)][0]['contractor_id'],self.cid)
        self.assertIsNone(db.session.get(Task,self.tid).contractor_id)
        result=self.client.post('/api/tasks/assign-contractors',json={'assignments':[
            {'task_id':self.tid,'contractor_id':self.cid}]})
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(db.session.get(Task,self.tid).contractor_id,self.cid)
        result=self.client.post('/api/tasks/assign-contractors',json={'assignments':[
            {'task_id':self.tid,'contractor_id':self.cid}]})
        self.assertEqual(result.status_code,409)

    def test_explicit_company_first_bulk_assignment_without_keyword_filter(self):
        # Old matching logic would reject this unrelated but intentionally chosen task.
        task=Task(code='MISC-DEMO',phase='Abschluss',trade='Malerarbeiten',
                  name='Innenwände abschließend prüfen',execution_type='Noch offen',position=1000)
        diy=Task(code='DIY-DEMO',phase='Innenausbau',trade='Eigenleistung',
                 name='Dielen selbst schleifen',execution_type='Eigenleistung',position=1001)
        db.session.add_all([task,diy]);db.session.commit()
        self.client.patch(f'/api/offers/{self.oid}',json={'status':'Angenommen'})
        companies=self.client.get('/api/project').json['contracted_companies']
        self.assertTrue(any(c['contractor_id']==self.cid for c in companies))
        response=self.client.post('/api/tasks/assign-by-company',json={'assignments':[
            {'task_id':self.tid,'contractor_id':self.cid},
            {'task_id':task.id,'contractor_id':self.cid}]})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['assigned'],2)
        self.assertEqual(db.session.get(Task,task.id).contractor_id,self.cid)
        self.assertEqual(db.session.get(Task,task.id).execution_type,'Fremdleistung')
        blocked=self.client.post('/api/tasks/assign-by-company',json={'assignments':[
            {'task_id':diy.id,'contractor_id':self.cid}]})
        self.assertEqual(blocked.status_code,409)
        self.assertIsNone(db.session.get(Task,diy.id).contractor_id)

    def test_explicit_company_duplicate_task_rejected_atomically(self):
        self.client.patch(f'/api/offers/{self.oid}',json={'status':'Angenommen'})
        duplicate=self.client.post('/api/tasks/assign-by-company',json={'assignments':[
            {'task_id':self.tid,'contractor_id':self.cid},
            {'task_id':self.tid,'contractor_id':self.cid}]})
        self.assertEqual(duplicate.status_code,409)
        self.assertIsNone(db.session.get(Task,self.tid).contractor_id)

    def test_accept_quote_without_confirmation_keeps_original_price(self):
        response=self.client.post(f'/api/offers/{self.oid}/accept',
                                  data={'confirm':'true','mode':'offer'})
        self.assertEqual(response.status_code,201,response.json)
        self.assertEqual(response.json['offer']['agreed_gross'],119)
        self.assertEqual(response.json['offer']['gross'],119)
        self.assertEqual(response.json['offer']['acceptance']['mode'],'offer')
        self.assertIsNone(response.json['offer']['acceptance']['document_id'])
        self.assertEqual(db.session.get(Offer,self.oid).status,'Angenommen')
        item=db.session.scalar(db.select(CostItem).where(CostItem.offer_id==self.oid))
        self.assertEqual(item.committed,119)
        self.assertEqual(self.client.post(f'/api/offers/{self.oid}/accept',
                         data={'confirm':'true','mode':'offer'}).status_code,409)

    def test_accept_confirmation_preserves_quote_and_fixes_new_contract_value(self):
        writer=PdfWriter();writer.add_blank_page(width=600,height=800)
        buffer=io.BytesIO();writer.write(buffer)
        with tempfile.TemporaryDirectory() as temp:
            root=backend.DOCUMENT_ROOT
            backend.DOCUMENT_ROOT=Path(temp)
            try:
                response=self.client.post(f'/api/offers/{self.oid}/accept',data={
                    'confirm':'true','mode':'confirmation',
                    'agreed_gross':'125,50',
                    'confirmation':(io.BytesIO(buffer.getvalue()),'Bestätigung.pdf')},
                    content_type='multipart/form-data')
                self.assertEqual(response.status_code,201,response.json)
                offer=response.json['offer']
                self.assertEqual(offer['gross'],119)
                self.assertEqual(offer['agreed_gross'],125.50)
                self.assertEqual(offer['acceptance']['quoted_gross'],119)
                doc_id=offer['acceptance']['document_id']
                doc=db.session.get(Document,doc_id)
                self.assertEqual(doc.kind,'Auftragsbestätigung')
                self.assertEqual((Path(temp)/doc.stored_name).read_bytes(),buffer.getvalue())
                self.assertEqual(db.session.scalar(db.select(CostItem).where(
                    CostItem.offer_id==self.oid)).committed,125.50)
                self.assertEqual(self.client.get('/api/offers').json['offers'][0]['billing']['agreed'],125.50)
                library=self.client.get('/api/document-library').json['documents']
                self.assertTrue(any(row['filename']=='Bestätigung.pdf' and
                    row['source']=='Angebote' for row in library))
                blocked=self.client.patch(f'/api/offers/{self.oid}',json={'status':'Angebot'})
                self.assertEqual(blocked.status_code,409)
                self.assertEqual(db.session.get(Offer,self.oid).status,'Angenommen')
            finally:backend.DOCUMENT_ROOT=root

    def test_acceptance_cannot_change_price_without_confirmation(self):
        response=self.client.post(f'/api/offers/{self.oid}/accept',
                                  data={'confirm':'true','mode':'offer','agreed_gross':'200'})
        self.assertEqual(response.status_code,409)
        self.assertIsNone(db.session.scalar(db.select(OrderAcceptance).where(
            OrderAcceptance.offer_id==self.oid)))
        self.assertEqual(db.session.get(Offer,self.oid).status,'Angebot')

    def test_invalid_confirmation_keeps_offer_open(self):
        with tempfile.TemporaryDirectory() as temp:
            root=backend.DOCUMENT_ROOT
            backend.DOCUMENT_ROOT=Path(temp)
            try:
                response=self.client.post(f'/api/offers/{self.oid}/accept',
                    data={'confirm':'true','mode':'confirmation','agreed_gross':'800',
                          'confirmation':(io.BytesIO(b'%PDF-garbage'),'Bestätigung.pdf')},
                    content_type='multipart/form-data')
                self.assertEqual(response.status_code,400)
                self.assertEqual(db.session.get(Offer,self.oid).status,'Angebot')
                self.assertEqual(list(Path(temp).iterdir()),[])
            finally:backend.DOCUMENT_ROOT=root

    def test_close_task_sets_actual_end(self):
        response=self.client.post(f'/api/tasks/{self.tid}/complete')
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['actual_end'],date.today().isoformat())
        t=db.session.get(Task,self.tid)
        self.assertEqual(t.status,'Erledigt')
        self.assertEqual(t.progress,100)
        self.assertEqual(t.actual_end,date.today())
        self.assertEqual(self.client.post(f'/api/tasks/{self.tid}/complete').status_code,200)

    def test_task_completion_preserves_original_date(self):
        task=db.session.get(Task,self.tid)
        previous=date(2026,3,5)
        task.status='Erledigt'
        task.progress=60
        task.actual_end=previous
        db.session.commit()
        response=self.client.post(f'/api/tasks/{self.tid}/complete',json={})
        self.assertEqual(response.status_code,200,response.get_json())
        self.assertEqual(response.json['actual_end'],previous.isoformat())
        self.assertEqual(db.session.get(Task,self.tid).progress,100)

    def test_document_library_includes_originals_from_each_module(self):
        project=ProjectDocument(title='Bauplan',
            original_name='grundriss.pdf',stored_name='project-plan.pdf',
            extension='.pdf',digest='e'*64,size_bytes=13,category='Bauplan',
            area='Erdgeschoss',status='Aktuell',tags='',description='Raumaufteilung',
            extracted_text='',extraction_note='')
        offer_doc=Document(original_name='PV_Angebot.pdf',stored_name='solar.pdf',kind='Angebot')
        other_doc=Document(original_name='Vertrag.pdf',stored_name='vertrag.pdf',kind='Vertrag')
        receipt=Receipt(digest='1'*64,original_name='Rechnung.pdf',stored_name='rechnung.pdf',
                        supplier='Solar Beispiel',kind='Rechnung',status='Entwurf')
        db.session.add_all([project,offer_doc,other_doc,receipt]);db.session.flush()
        db.session.get(Offer,self.oid).document_id=offer_doc.id
        db.session.commit()
        response=self.client.get('/api/document-library')
        self.assertEqual(response.status_code,200,response.get_json())
        items=response.json['documents']
        self.assertEqual(len(items),4)
        by_filename={item['filename']:item for item in items}
        self.assertEqual(by_filename['PV_Angebot.pdf']['source'],'Angebote')
        self.assertEqual(by_filename['Rechnung.pdf']['module_url'],
                         '/belege?receipt_id='+str(receipt.id))
        self.assertEqual(by_filename['grundriss.pdf']['source'],'Projektdokumente')
        self.assertEqual(by_filename['Vertrag.pdf']['source'],'Weitere Projektunterlagen')
        self.assertTrue(by_filename['PV_Angebot.pdf']['view_url'].endswith('/preview'))
        self.assertEqual(self.client.get('/api/document-library').headers['Cache-Control'],'no-store')

    def test_pdf_preview_for_receipt_stays_inline(self):
        old=backend.RECEIPT_ROOT
        with tempfile.TemporaryDirectory() as tmp:
            backend.RECEIPT_ROOT=Path(tmp)
            try:
                (Path(tmp)/'receipt.pdf').write_bytes(b'%PDF-1.4\\n%%EOF')
                item=Receipt(digest='2'*64,original_name='Kassenbon.pdf',
                             stored_name='receipt.pdf',supplier='Testladen',kind='Rechnung')
                db.session.add(item);db.session.commit()
                response=self.client.get(f'/api/receipts/{item.id}/preview')
                self.assertEqual(response.status_code,200,response.get_json() if response.is_json else response.mimetype)
                self.assertEqual(response.mimetype,'application/pdf')
                self.assertIn('inline',response.headers.get('Content-Disposition',''))
            finally:backend.RECEIPT_ROOT=old

    def test_pdf_preview_stays_inline(self):
        root=backend.DOCUMENT_ROOT
        with tempfile.TemporaryDirectory() as tmp:
            backend.DOCUMENT_ROOT=Path(tmp)
            try:
                (Path(tmp)/'example.pdf').write_bytes(b'%PDF-1.4\n%%EOF')
                doc=Document(original_name='example.pdf',stored_name='example.pdf',kind='Angebot')
                db.session.add(doc);db.session.commit()
                response=self.client.get(f'/api/documents/{doc.id}/preview')
                self.assertEqual(response.status_code,200)
                self.assertEqual(response.mimetype,'application/pdf')
                self.assertIn('inline',response.headers.get('Content-Disposition',''))
            finally:
                backend.DOCUMENT_ROOT=root


if __name__=='__main__':
    unittest.main()
