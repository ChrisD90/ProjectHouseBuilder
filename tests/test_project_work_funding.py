"""Shared todo records, auditable order correction, and bounded opt-in grant estimates."""
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as backend
from app import app, db, initialize, Offer, CostItem, Receipt, Funding, ProjectDocument, ProjectWork, FundingDocument, FundingAssessment, OfferAcceptanceReversal, OrderAcceptance
from funding_estimates import BAFA_URL, readiness

class ProjectWorkFundingTest(unittest.TestCase):
    def setUp(self):
        self.scope=app.app_context(); self.scope.push()
        db.session.remove(); db.drop_all(); initialize()
        self.client=app.test_client()
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        for key in ('DOCUMENT_ROOT','PROJECT_DOCUMENT_ROOT'):
            patched=patch.object(backend,key,Path(self.tmp.name)/key);patched.start();self.addCleanup(patched.stop)

    def tearDown(self):
        db.session.remove();db.drop_all();self.scope.pop()

    def offer(self):
        response=self.client.post('/api/offers/manual',json={'vendor':'Fensterbau Beispiel','gross':20000,'category':'Sonstiges'})
        self.assertEqual(response.status_code,201,response.json)
        return response.json['id']

    def inputs(self):
        return dict(program_key='bafa_envelope',postcode='80331',building_application='1990-01-01',application_date='2027-02-01',
            measure='Fenster austauschen, technische Werte fachlich bestätigt',units=1,eligible_cost=15000,used_budget=0,
            ownership='private_owner',usage='self',technical_verified='yes',expert_involved='yes',proof='prepared',
            contract='not_signed',started='no',cumulation_reviewed='yes',vat_deductible='no',isfp='no')

    def body(self):
        return dict(offer_id=self.offer(),assessment_inputs=self.inputs(),document_ids=[],consent=True,plan_only=True,model='test')

    def test_linked_work_is_one_record_can_complete_reopen_and_survive_removed_source(self):
        ident=self.offer()
        response=self.client.post('/api/project-work',json={'title':'Rückfrage zu Fenstern','body':'U-Werte klären','source_type':'offer','source_id':ident})
        self.assertEqual(response.status_code,201,response.json);iid=response.json['item']['id']
        linked=self.client.get(f'/api/project-work?source_type=offer&source_id={ident}').json['items']
        self.assertEqual(linked[0]['id'],self.client.get('/api/project-work').json['items'][0]['id'])
        for done in (True,False):
            self.assertEqual(self.client.patch(f'/api/project-work/{iid}',json={'done':done}).json['item']['done'],done)
        self.assertEqual(self.client.delete(f'/api/offers/{ident}').status_code,200)
        self.assertTrue(self.client.get('/api/project-work').json['items'][0]['source_missing'])
        result=self.client.patch(f'/api/project-work/{iid}',json={'body':'Angebot neu anfordern'})
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(result.json['item']['source_url'],'')
        self.assertEqual(self.client.delete(f'/api/project-work/{iid}').status_code,200)

    def test_notes_and_validation_do_not_create_partial_records(self):
        response=self.client.post('/api/project-work',json={'title':'Idee','kind':'note','done':True,'due_on':'2027-01-01'})
        self.assertEqual(response.status_code,201,response.json)
        self.assertFalse(response.json['item']['done']);self.assertEqual(response.json['item']['due_on'],'')
        for data in ({'title':''},{'title':'X','source_type':'offer','source_id':99999},{'title':'X','done':'yes'},{'title':'X','due_on':'2026-02-31'},{'title':'X','kind':'unsupported'}):
            self.assertEqual(self.client.post('/api/project-work',json=data).status_code,400,data)
        self.assertEqual(db.session.query(ProjectWork).count(),1)
        self.assertEqual(self.client.get('/api/project-work?source_type=offer&source_id=bad').status_code,400)

    def test_reversal_removes_only_unencumbered_order_and_preserves_history(self):
        ident=self.offer()
        result=self.client.post(f'/api/offers/{ident}/accept',data={'mode':'offer','confirm':'true'})
        self.assertEqual(result.status_code,201,result.json)
        self.assertEqual(self.client.post(f'/api/offers/{ident}/reverse-acceptance',json={}).status_code,400)
        result=self.client.post(f'/api/offers/{ident}/reverse-acceptance',json={'confirm':True})
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(result.json['offer']['status'],'Angebot')
        self.assertIsNone(result.json['offer']['acceptance'])
        self.assertEqual(len(result.json['offer']['acceptance_reversals']),1)
        self.assertEqual(db.session.query(CostItem).filter_by(offer_id=ident).count(),0)
        self.assertFalse(result.json['offer']['can_delete'])
        self.assertEqual(self.client.post(f'/api/offers/{ident}/reverse-acceptance',json={'confirm':True}).status_code,409)
        self.assertEqual(self.client.post(f'/api/offers/{ident}/accept',data={'mode':'offer','confirm':'true'}).status_code,201)
        self.assertEqual(db.session.query(OfferAcceptanceReversal).count(),1)

    def test_reversal_refuses_linked_invoice_even_if_unpaid(self):
        ident=self.offer();self.client.post(f'/api/offers/{ident}/accept',data={'mode':'offer','confirm':'true'})
        cost=db.session.query(CostItem).filter_by(offer_id=ident).one()
        db.session.add(Receipt(digest='keep',original_name='Original.pdf',stored_name='invoice.pdf',cost_item_id=cost.id,gross_amount=100,status='Gebucht'));db.session.commit()
        response=self.client.post(f'/api/offers/{ident}/reverse-acceptance',json={'confirm':True})
        self.assertEqual(response.status_code,409,response.json)
        self.assertEqual(db.session.get(Offer,ident).status,'Angenommen')
        self.assertEqual(db.session.query(OfferAcceptanceReversal).count(),0)

    def test_invalid_legacy_amount_is_reported_without_removing_order(self):
        ident=self.offer();obj=db.session.get(Offer,ident);obj.status='Angenommen';obj.gross=None;db.session.commit()
        result=self.client.post(f'/api/offers/{ident}/reverse-acceptance',json={'confirm':True})
        self.assertEqual(result.status_code,409,result.json)
        self.assertEqual(db.session.get(Offer,ident).status,'Angenommen')
        self.assertEqual(db.session.query(OfferAcceptanceReversal).count(),0)

    def test_reversed_confirmation_remains_viewable_and_protected(self):
        from pypdf import PdfWriter
        pdf=io.BytesIO();writer=PdfWriter();writer.add_blank_page(200,200);writer.write(pdf);pdf.seek(0)
        ident=self.offer()
        response=self.client.post(f'/api/offers/{ident}/accept',data={'mode':'confirmation','confirm':'true','agreed_gross':'19000','confirmation':(pdf,'Bestätigung.pdf')})
        self.assertEqual(response.status_code,201,response.json);did=response.json['offer']['acceptance']['document_id']
        self.assertEqual(self.client.post(f'/api/offers/{ident}/reverse-acceptance',json={'confirm':True}).status_code,200)
        view=self.client.get(f'/api/documents/{did}/preview');self.assertEqual(view.status_code,200);self.assertIn('inline',view.headers['Content-Disposition']);view.close()
        self.assertEqual(self.client.delete(f'/api/documents/{did}').status_code,409)

    def test_funding_documents_and_inputs_saved_transactionally_without_duplicating_files(self):
        document=self.client.post('/api/project-documents',data={'file':(io.BytesIO(b'ISFP example'),'isfp.txt'),'area':'Energetische Planung','category':'iSFP'}).json['document']
        self.assertEqual(self.client.get('/api/energy-planning').json['documents'][0]['id'],document['id'])
        data={'name':'Fenster','offer_id':self.offer(),'document_ids':[document['id']],'assessment_inputs':self.inputs()}
        response=self.client.post('/api/funding',json=data);self.assertEqual(response.status_code,200,response.json);fid=response.json['id']
        self.assertEqual(response.json['document_ids'],[document['id']]);self.assertEqual(response.json['assessment_inputs']['units'],1)
        bad=self.client.put(f'/api/funding/{fid}',json={'name':'Nicht speichern','document_ids':[99999]})
        self.assertEqual(bad.status_code,400);self.assertEqual(db.session.get(Funding,fid).name,'Fenster')
        self.assertEqual(self.client.delete(f'/api/funding/{fid}').status_code,200)
        self.assertIsNotNone(db.session.get(ProjectDocument,document['id']));self.assertEqual(db.session.query(FundingDocument).count(),0);self.assertEqual(db.session.query(FundingAssessment).count(),0)

    def test_deleted_funding_document_detaches_link_without_deleting_funding(self):
        doc=self.client.post('/api/project-documents',data={'file':(io.BytesIO(b'Proof'),'proof.txt'),'area':'Energetische Planung'}).json['document']
        fid=self.client.post('/api/funding',json={'name':'Nachweis','document_ids':[doc['id']]}).json['id']
        self.assertEqual(self.client.delete('/api/project-documents/'+str(doc['id'])).status_code,200)
        self.assertEqual(self.client.get('/api/energy-planning').json['funding'][0]['document_ids'],[])
        self.assertIsNotNone(db.session.get(Funding,fid))

    def test_missing_prerequisites_never_invoke_ai(self):
        with patch.object(backend.chatgpt,'run') as run:
            response=self.client.post('/api/funding/estimate',json={'assessment_inputs':{}},headers={'X-PHB-AI':'1'})
            self.assertEqual(response.status_code,400,response.json);self.assertTrue(response.json['missing']);run.assert_not_called()
        inputs=self.inputs();inputs.update(contract='unconditional',started='yes',isfp='yes')
        gaps=readiness(inputs,db.session.get(Offer,self.offer()),[])
        self.assertTrue(any('vertrag' in x.casefold() for x in gaps));self.assertTrue(any('Ausführung' in x for x in gaps));self.assertTrue(any('iSFP' in x for x in gaps))

    def test_estimate_requires_consent_current_official_sources_and_never_saves_amount(self):
        body=self.body();body['assessment_inputs']['household_income']=42000;fid=self.client.post('/api/funding',json={'name':'Plan','expected':10}).json['id']
        answer={'eligible':True,'amount':3000,'explanation':'Nur Vorschlag','missing':[],'assumptions':['Technik bestätigen'],'sources':[{'title':'BAFA','url':BAFA_URL}]}
        with patch.object(backend.chatgpt,'status',return_value={'sharing':True,'credits_acknowledged':True}),patch.object(backend.chatgpt,'run',return_value=json.dumps(answer)) as run:
            no=dict(body,consent=False)
            self.assertEqual(self.client.post('/api/funding/estimate',json=no,headers={'X-PHB-AI':'1'}).status_code,400);run.assert_not_called()
            response=self.client.post('/api/funding/estimate',json=body,headers={'X-PHB-AI':'1'})
            self.assertEqual(response.status_code,200,response.json);self.assertEqual(response.json['amount'],3000)
            self.assertTrue(run.call_args.kwargs['web_search']);self.assertIn('ohne Gewähr',response.json['notice'])
            self.assertEqual(db.session.get(Funding,fid).expected,10)
            sent=json.loads(run.call_args.args[0]);self.assertEqual(sent['offer']['id'],body['offer_id']);self.assertNotIn('household_income',sent['inputs'])
            for invalid in (dict(answer,amount=999999),dict(answer,sources=[{'url':'https://example.com/kfw.de'}]),dict(answer,amount=True)):
                run.return_value=json.dumps(invalid)
                self.assertEqual(self.client.post('/api/funding/estimate',json=body,headers={'X-PHB-AI':'1'}).status_code,400)
            run.return_value=json.dumps(dict(answer,missing=['Technischer Nachweis unklar']))
            result=self.client.post('/api/funding/estimate',json=body,headers={'X-PHB-AI':'1'}).json
            self.assertIsNone(result['amount']);self.assertFalse(result['eligible'])

    def test_estimate_bounds_costs_by_confirmation_amount_for_accepted_offer(self):
        body=self.body();obj=db.session.get(Offer,body['offer_id']);obj.status='Angenommen'
        db.session.add(OrderAcceptance(offer_id=obj.id,mode='confirmation',quoted_gross=20000,agreed_gross=12000));db.session.commit()
        self.assertFalse(self.client.post('/api/funding/estimate-readiness',json=body).json['ready'])
        body['assessment_inputs']['eligible_cost']=10000
        self.assertTrue(self.client.post('/api/funding/estimate-readiness',json=body).json['ready'])

    def test_heating_requires_program_specific_details(self):
        body=self.body();body['assessment_inputs']['program_key']='kfw_458'
        response=self.client.post('/api/funding/estimate-readiness',json=body)
        self.assertFalse(response.json['ready']);self.assertTrue(any('Heizung' in s for s in response.json['missing']))
        body['assessment_inputs'].update(old_heating='Gas',new_heating='Luft-Wasser-Wärmepumpe',old_heating_year=1999,natural_refrigerant='yes',bonus_requested='no')
        self.assertTrue(self.client.post('/api/funding/estimate-readiness',json=body).json['ready'])

if __name__=='__main__':unittest.main()
