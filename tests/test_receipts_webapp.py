"""End-to-end receipt tests with Flask's SQLite test client."""
import io
import json
import os
import unittest
from unittest.mock import patch
os.environ['DATABASE_URL']='sqlite:///:memory:'
from app import app,db,initialize,Receipt,CostItem,BudgetLine,Contractor

class ReceiptWebappTest(unittest.TestCase):
    def setUp(self):
        self.ctx=app.app_context();self.ctx.push();db.drop_all();initialize()
        self.client=app.test_client()
    def tearDown(self):
        db.session.remove();db.drop_all();self.ctx.pop()
    def upload(self,name='example.pdf',text='Elektro Muster GmbH\nRechnungsnummer 2026-99\nDatum 21.10.2026\nGesamtbetrag 120,00 EUR'):
        with patch('app.extract_text',return_value=(text,'PDF-Text')):
            return self.client.post('/api/receipts',data={'file':(io.BytesIO(b'%PDF-1.4\nTEST'),name)},content_type='multipart/form-data')
    def test_upload_review_book_paid_and_undo(self):
        start=self.client.get('/api/costs').json['summary']
        response=self.upload();self.assertEqual(response.status_code,201,response.json)
        rid=response.json['id'];self.assertEqual(response.json['status'],'Entwurf')
        self.assertEqual(self.client.get('/api/costs').json['summary']['paid'],start['paid'])
        self.assertEqual(self.upload().status_code,409)
        update=self.client.patch(f'/api/receipts/{rid}',json={'category':'Elektro','paid_amount':'120.00'})
        self.assertEqual(update.status_code,200,update.json)
        booked=self.client.post(f'/api/receipts/{rid}/book');self.assertEqual(booked.status_code,200,booked.json)
        after=self.client.get('/api/costs').json['summary']
        self.assertEqual(round(after['paid']-start['paid'],2),120)
        self.assertEqual(round(after['planned']-start['planned'],2),120)
        self.assertEqual(self.client.patch(f'/api/receipts/{rid}',json={'gross_amount':'999'}).status_code,409)
        self.assertEqual(self.client.delete(f'/api/receipts/{rid}').status_code,409)
        self.assertEqual(self.client.post(f'/api/receipts/{rid}/unbook').status_code,200)
        self.assertEqual(self.client.get('/api/costs').json['summary']['paid'],start['paid'])
        self.assertEqual(self.client.delete(f'/api/receipts/{rid}').status_code,200)
    def test_detected_labor_is_separate_editable_and_never_autobooked(self):
        invoice=('Elektro Muster GmbH\nRechnungsnummer 2026-99\n'
                 'Rechnungsdatum 21.10.2026\n'
                 'Lohnkosten brutto 357,00 EUR\n'
                 'Material 833,00 EUR\nGesamtbetrag 1.190,00 EUR')
        response=self.upload(text=invoice)
        self.assertEqual(response.status_code,201,response.json)
        rid=response.json['id']
        self.assertEqual(response.json['labor_amount'],357.0)
        self.assertEqual(response.json['labor_source'],'Erkannt')
        self.assertEqual(response.json['gross_amount'],1190.0)
        self.assertEqual(response.json['status'],'Entwurf')
        self.assertEqual(self.client.get('/api/receipts').json['receipts'][0]['labor_amount'],357.0)
        self.assertEqual(self.client.get('/api/costs').json['summary']['paid'],0)
        notes=self.client.patch(f'/api/receipts/{rid}',json={'notes':'Beleg geprüft'})
        self.assertEqual(notes.status_code,200,notes.json)
        self.assertEqual(notes.json['labor_source'],'Erkannt')
        edited=self.client.patch(f'/api/receipts/{rid}',json={'labor_amount':'400.00'})
        self.assertEqual(edited.status_code,200,edited.json)
        self.assertEqual(edited.json['labor_amount'],400.0)
        self.assertEqual(edited.json['labor_source'],'Manuell')
        rejected=self.client.patch(f'/api/receipts/{rid}',json={'labor_amount':'1200.00'})
        self.assertEqual(rejected.status_code,400,rejected.json)
        self.assertEqual(self.client.get(f'/api/receipts/{rid}').json['labor_amount'],400.0)
        self.assertEqual(self.client.post(f'/api/receipts/{rid}/book').status_code,200)
        self.assertEqual(self.client.patch(f'/api/receipts/{rid}',json={'labor_amount':'100'}).status_code,409)
        self.assertEqual(self.client.post(f'/api/receipts/{rid}/unbook').status_code,200)
        cleared=self.client.patch(f'/api/receipts/{rid}',json={'labor_amount':None})
        self.assertEqual(cleared.status_code,200,cleared.json)
        self.assertIsNone(cleared.json['labor_amount'])
        self.assertEqual(cleared.json['labor_source'],'')

    def test_labor_can_be_entered_manually_for_unrecognized_receipt(self):
        uploaded=self.upload()
        self.assertEqual(uploaded.status_code,201,uploaded.json)
        rid=uploaded.json['id']
        self.assertIsNone(uploaded.json['labor_amount'])
        updated=self.client.patch(f'/api/receipts/{rid}',json={'labor_amount':'48.95'})
        self.assertEqual(updated.status_code,200,updated.json)
        self.assertEqual(updated.json['labor_source'],'Manuell')
        self.assertEqual(updated.json['labor_amount'],48.95)
        wrong=self.client.patch(f'/api/receipts/{rid}',json={'gross_amount':'20'})
        self.assertEqual(wrong.status_code,400,wrong.json)
        self.assertEqual(self.client.get(f'/api/receipts/{rid}').json['gross_amount'],120.0)

    def test_exclusive_assignment_to_contractor_or_own_work(self):
        contractor=Contractor(name='Sanitärbetrieb Beispiel',trade='Sanitär')
        db.session.add(contractor);db.session.commit()
        rid=self.upload().json['id']
        contractor_link=self.client.patch(f'/api/receipts/{rid}',json={
            'assignment_type':'Betrieb','contractor_id':contractor.id,
            'cost_item_id':None,'category':'Sanitär'})
        self.assertEqual(contractor_link.status_code,200,contractor_link.json)
        self.assertEqual(contractor_link.json['contractor_id'],contractor.id)
        self.assertEqual(contractor_link.json['assignment_type'],'Betrieb')
        rejected=self.client.patch(f'/api/receipts/{rid}',json={
            'assignment_type':'Eigenleistung','cost_item_id':None,'contractor_id':contractor.id})
        self.assertEqual(rejected.status_code,400)
        self.assertEqual(db.session.get(Receipt,rid).assignment_type,'Betrieb')
        self.assertEqual(self.client.post(f'/api/receipts/{rid}/book').status_code,200)
        self.assertEqual(self.client.patch(f'/api/receipts/{rid}',json={
            'assignment_type':'Eigenleistung','contractor_id':None}).status_code,409)
        self.assertEqual(self.client.delete(f'/api/contractors/{contractor.id}').status_code,409)
        self.assertEqual(self.client.post(f'/api/receipts/{rid}/unbook').status_code,200)
        change=self.client.patch(f'/api/receipts/{rid}',json={
            'assignment_type':'Eigenleistung','contractor_id':None,'cost_item_id':None})
        self.assertEqual(change.status_code,200,change.json)
        self.assertEqual(change.json['assignment_type'],'Eigenleistung')
        self.assertIsNone(change.json['contractor_id'])
        self.assertEqual(self.client.post(f'/api/receipts/{rid}/book').status_code,200)

    def test_conflicting_assignment_is_rejected_atomically(self):
        contractor=Contractor(name='Firma Einbau');db.session.add(contractor);db.session.flush()
        item=CostItem(title='Bestand',category='Elektro',state='Beauftragt')
        db.session.add(item);db.session.commit()
        rid=self.upload().json['id']
        bad=self.client.patch(f'/api/receipts/{rid}',json={
            'assignment_type':'Betrieb','contractor_id':contractor.id,'cost_item_id':item.id})
        self.assertEqual(bad.status_code,400,bad.json)
        saved=db.session.get(Receipt,rid)
        self.assertIsNone(saved.contractor_id)
        self.assertIsNone(saved.cost_item_id)
        self.assertEqual(saved.assignment_type,'')

    def test_chatgpt_receipt_upload_explicit_consent_and_editable_draft(self):
        from chatgpt_local import chatgpt
        document=b'%PDF-1.4\nprivate-test-document'
        def make_upload(extra=None,headers=None):
            return self.client.post('/api/receipts',data={
                'file':(io.BytesIO(document),'rechnungsanalyse.pdf'),
                'analysis_mode':'ai','model':'m1',**(extra or {})
            },headers=headers or {},content_type='multipart/form-data',
                base_url='http://127.0.0.1:5055')
        start=self.client.get('/api/costs').json['summary']['paid']
        result=json.dumps({
            'supplier':'Baumarkt AI','invoice_number':'AI-11',
            'document_date':'2026-10-22','gross_amount':'1.190,00',
            'net_amount':'1.000,00','vat_amount':'190,00',
            'labor_amount':'595,00','category':'Werkzeug',
            'kind':'Rechnung','billing_type':'Normal','warnings':['Preis prüfen']
        })
        with patch.object(chatgpt,'status',return_value={'sharing':True,'credits_acknowledged':True}), \
             patch.object(chatgpt,'run',return_value=result) as run:
            no_header=make_upload({'plan_only':'true'})
            self.assertEqual(no_header.status_code,403,no_header.json)
            no_consent=make_upload(headers={'X-PHB-AI':'1'})
            self.assertEqual(no_consent.status_code,403,no_consent.json)
            yes=make_upload({'plan_only':'true'},headers={'X-PHB-AI':'1'})
        self.assertEqual(yes.status_code,201,yes.json)
        self.assertEqual(run.call_count,1)
        self.assertEqual(yes.json['source'],'ChatGPT')
        self.assertEqual(yes.json['supplier'],'Baumarkt AI')
        self.assertEqual(yes.json['gross_amount'],1190.0)
        self.assertEqual(yes.json['net_amount'],1000.0)
        self.assertEqual(yes.json['vat_amount'],190.0)
        self.assertEqual(yes.json['labor_amount'],595.0)
        self.assertEqual(yes.json['labor_source'],'Erkannt')
        self.assertEqual(yes.json['status'],'Entwurf')
        self.assertEqual(self.client.get('/api/costs').json['summary']['paid'],start)
        self.assertEqual(self.client.get('/api/receipts').json['drafts'],1)
        # A draft can still be reviewed, linked and corrected manually.
        edit=self.client.patch(f"/api/receipts/{yes.json['id']}",json={
            'assignment_type':'Eigenleistung','supplier':'Korrigierte Firma',
            'gross_amount':'125.00','labor_amount':'85.00'})
        self.assertEqual(edit.status_code,200,edit.json)

    def test_chatgpt_image_upload_uses_multimodal_input_without_local_ocr(self):
        import json
        from chatgpt_local import chatgpt
        from PIL import Image
        buffer=io.BytesIO();Image.new('RGB',(16,16),'white').save(buffer,format='PNG')
        blob=buffer.getvalue()
        data=json.dumps({'supplier':'Foto-Rechnung','invoice_number':'B-4',
                         'document_date':'2026-10-22','gross_amount':42,
                         'warnings':[]})
        with patch.object(chatgpt,'status',return_value={'sharing':True,'credits_acknowledged':True}), \
             patch.object(chatgpt,'run',return_value=data) as run, \
             patch('app.extract_text',side_effect=AssertionError('local OCR must not run')):
            response=self.client.post('/api/receipts',data={
                'file':(io.BytesIO(blob),'foto.png'),'analysis_mode':'ai',
                'plan_only':'true','model':'m1'
            },headers={'X-PHB-AI':'1'},content_type='multipart/form-data',
               base_url='http://127.0.0.1:5055')
        self.assertEqual(response.status_code,201,response.json)
        content=run.call_args.args[0][0]['content']
        self.assertEqual(content[1]['type'],'input_image')
        self.assertTrue(content[1]['image_url'].startswith('data:image/png;base64,'))

    def test_open_invoice_does_not_count_as_paid(self):
        rid=self.upload().json['id']
        self.assertEqual(self.client.post(f'/api/receipts/{rid}/book').status_code,200)
        self.assertEqual(self.client.get('/api/receipts').json['paid'],0)
    def test_existing_budget_prevents_double_forecast(self):
        base=self.client.get('/api/costs').json['summary']['planned']
        line=BudgetLine(code='RXTEST',category='Elektro',title='Prüfposition',estimate=200,sort_order=99999)
        db.session.add(line);db.session.commit()
        rid=self.upload().json['id']
        self.client.patch(f'/api/receipts/{rid}',json={'budget_line_id':line.id,'paid_amount':'120'})
        self.assertEqual(self.client.post(f'/api/receipts/{rid}/book').status_code,200)
        self.assertAlmostEqual(self.client.get('/api/costs').json['summary']['planned'],base+200)
        self.assertAlmostEqual(self.client.get('/api/costs').json['summary']['paid'],120)
    def test_cannot_double_pay_already_manual_paid_contract(self):
        item=CostItem(title='Already paid',category='Elektro',state='Beauftragt',committed=200,paid=50)
        db.session.add(item);db.session.commit()
        rid=self.upload().json['id']
        self.client.patch(f'/api/receipts/{rid}',json={'cost_item_id':item.id,'paid_amount':'50'})
        res=self.client.post(f'/api/receipts/{rid}/book')
        self.assertEqual(res.status_code,409)

if __name__=='__main__':unittest.main()
