"""Review-before-apply imports, funding continuity and opt-in company research."""
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
import app as backend
from app import app, db, initialize, BudgetLine, Funding, FundingDetail, CostPlanImport, Document, ImportJob, Offer
from cost_plan_parser import amount, local_plan
from chatgpt_local import chatgpt, ChatGPTLocal, AIError

CSV = 'Position;Gewerk;Schätzung\nDämmung;Fassade;12.345,67\nFenster;Fenster;5000,00\nGesamtsumme;Sonstiges;17.345,67\n'.encode()


class PlanningTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for key in ('DOCUMENT_ROOT', 'IMPORT_QUEUE_ROOT'):
            p = patch.object(backend, key, self.root / key); p.start(); self.addCleanup(p.stop)
        self.scope = app.app_context(); self.scope.push()
        db.session.remove(); db.drop_all(); initialize()
        self.client = app.test_client()

    def tearDown(self):
        db.session.remove(); db.drop_all(); self.scope.pop()

    def upload(self, data=CSV, filename='Architekt.csv', **fields):
        return self.client.post('/api/cost-plan-imports', data={
            'file': (io.BytesIO(data), filename), **fields}, content_type='multipart/form-data',
            headers={'X-PHB-AI': '1'} if fields.get('analysis_mode') == 'ai' else {})

    def test_csv_review_edit_apply_and_duplicate_prevention(self):
        existing = self.client.post('/api/budget/lines', json={'title':'Vorhanden','category':'Dach','kind':'Fremdleistung','estimate':100})
        self.assertEqual(existing.status_code, 200)
        draft = self.upload(); self.assertEqual(draft.status_code, 201, draft.json)
        iid = draft.json['id']; self.assertTrue(draft.json['rows'][-1]['is_group'])
        self.assertEqual(self.client.get('/api/costs').json['summary']['planned'], 100)
        rows = draft.json['rows']; rows[0]['estimate'] = '10.000,00'
        edited = self.client.patch(f'/api/cost-plan-imports/{iid}', json={'rows':rows})
        self.assertEqual(edited.status_code, 200, edited.json)
        self.assertEqual(self.client.get('/api/costs').json['summary']['planned'], 100)
        self.assertEqual(self.client.post(f'/api/cost-plan-imports/{iid}/apply', json={'rows':rows}).status_code,400)
        applied = self.client.post(f'/api/cost-plan-imports/{iid}/apply', json={'rows':rows,'confirm':True,'amount_basis':'gross'})
        self.assertEqual(applied.status_code,200,applied.json)
        self.assertEqual(self.client.get('/api/costs').json['summary']['planned'],15100)
        self.assertEqual(db.session.query(BudgetLine).count(),4)
        self.assertEqual(self.client.post(f'/api/cost-plan-imports/{iid}/apply',json={'rows':rows,'confirm':True,'amount_basis':'gross'}).status_code,409)
        self.assertEqual(self.upload().status_code,409)

    def test_invalid_row_rolls_back_whole_apply(self):
        draft=self.upload().json;rows=draft['rows'];rows[1]['estimate']='NaN'
        result=self.client.post(f"/api/cost-plan-imports/{draft['id']}/apply",json={'rows':rows,'confirm':True,'amount_basis':'gross'})
        self.assertEqual(result.status_code,400)
        self.assertEqual(db.session.query(BudgetLine).count(),0)
        self.assertEqual(db.session.get(CostPlanImport,draft['id']).status,'Entwurf')

    def test_original_is_in_readonly_library_and_cannot_be_deleted(self):
        draft=self.upload().json
        original=next(x for x in self.client.get('/api/document-library').json['documents'] if x['source']=='Kostenplanung')
        self.assertEqual(original['legacy_document_id'],None)
        self.assertIn('cost_plan_import=',original['module_url'])
        self.assertEqual(self.client.delete(f"/api/documents/{draft['document_id']}").status_code,409)
        response=self.client.get(draft['download_url']);self.assertEqual(response.data,CSV);response.close()

    def test_empty_local_extraction_remains_manually_editable(self):
        result=self.upload(b'Architekt Kostenplan ohne lesbare Betragszeilen','notiz.txt')
        self.assertEqual(result.status_code,201,result.json)
        self.assertEqual(result.json['rows'],[])
        iid=result.json['id']
        row={'title':'Manuell ergänzt','category':'Sonstiges','estimate':123}
        applied=self.client.post(f'/api/cost-plan-imports/{iid}/apply',json={'rows':[row],'confirm':True,'amount_basis':'gross'})
        self.assertEqual(applied.status_code,200,applied.json)

    def test_excel_and_pdf_like_text_with_sum_rows(self):
        from openpyxl import Workbook
        book=Workbook();sheet=book.active
        sheet.append(['Position','Gewerk','Gesamtpreis']);sheet.append(['Fenster','Gebäudehülle',1234.56]);sheet.append(['Summe','Gebäudehülle',1234.56])
        stream=io.BytesIO();book.save(stream);book.close()
        result=self.upload(stream.getvalue(),'kosten.xlsx')
        self.assertEqual(result.status_code,201,result.json)
        self.assertEqual(result.json['rows'][0]['estimate'],1234.56)
        self.assertTrue(result.json['rows'][1]['is_group'])
        parsed=local_plan('Fassade 12.345,67 €\nGesamtsumme 12.345,67 €'.encode(),'liste.txt')
        self.assertEqual(len(parsed['rows']),2);self.assertTrue(parsed['rows'][1]['is_group'])

    def test_ai_pdf_does_not_require_local_ocr_and_never_books(self):
        with patch.object(chatgpt,'status',return_value={'sharing':True,'credits_acknowledged':True}), patch.object(chatgpt,'run',return_value=json.dumps({'rows':[{'title':'Heizung','category':'Heizung','estimate':1000}],'warnings':[]})) as run:
            result=self.upload(b'%PDF-1.4\nAI test input','scan.pdf',analysis_mode='ai',model='test',plan_only='true')
            self.assertEqual(result.status_code,201,result.json)
            self.assertIn('input_file',str(run.call_args))
            self.assertEqual(db.session.query(BudgetLine).count(),0)
        self.assertEqual(self.upload(b'%PDF-1.4\nother','no-consent.pdf',analysis_mode='ai').status_code,403)

    def test_actual_text_pdf_extracts_positions_and_excludes_totals_and_tax_lines(self):
        from pypdf import PdfWriter
        from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
        writer=PdfWriter();page=writer.add_blank_page(width=595,height=842)
        font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
        page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):font})})
        content=DecodedStreamObject();content.set_data(b'BT /F1 12 Tf 50 750 Td (Architektenplanung Beispiel) Tj 0 -20 Td (Fenster 1.000,00 EUR) Tj 0 -20 Td (Nettosumme 1.000,00 EUR) Tj 0 -20 Td (MwSt 190,00 EUR) Tj 0 -20 Td (Gesamtsumme 1.190,00 EUR) Tj ET')
        page[NameObject('/Contents')]=writer._add_object(content)
        stream=io.BytesIO();writer.write(stream)
        with patch('receipt_parser._ocr',side_effect=AssertionError('Text-PDF benötigt keine OCR')):
            result=self.upload(stream.getvalue(),'architekt.pdf')
        self.assertEqual(result.status_code,201,result.json)
        rows=result.json['rows'];self.assertEqual(len(rows),4)
        self.assertEqual(rows[0]['estimate'],1000)
        self.assertFalse(rows[0]['is_group'])
        self.assertTrue(all(row['is_group'] for row in rows[1:]))
        self.assertIsNotNone(result.json['preview_url'])

    def test_queue_reuses_cost_plan_import_and_archives_only_after_review(self):
        with patch('app._start_import_worker'):
            response=self.client.post('/api/import-jobs',data={'kind':'costplans','files':(io.BytesIO(CSV),'plan.csv')},content_type='multipart/form-data')
        self.assertEqual(response.status_code,202,response.json)
        jid=response.json['jobs'][0]['id'];backend._run_import_job(jid)
        job=db.session.get(ImportJob,jid);self.assertEqual(job.status,'Fertig')
        draft=self.client.get('/api/cost-plan-imports/'+str(job.result_id)).json
        feed=self.client.get('/api/import-jobs').json['jobs']
        self.assertIn('cost_plan_import=',feed[0]['review_url'])
        self.client.post(f"/api/cost-plan-imports/{draft['id']}/apply",json={'rows':draft['rows'],'confirm':True,'amount_basis':'gross'})
        self.assertEqual(db.session.get(ImportJob,jid).status,'Übernommen')

    def test_funding_create_saves_amounts_and_links_in_one_request(self):
        offer=Offer(digest='demo',vendor='Heizung GmbH',gross=20000,filename='test.pdf',status='Angebot');db.session.add(offer);db.session.commit()
        result=self.client.post('/api/funding',json={'name':'Heizung prüfen','program':'458','provider':'KfW','status':'Beantragt','offer_id':offer.id,'deadline':'2027-03-01','expected':5000,'confirmed':3000,'received':1000})
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(result.json['expected'],5000)
        energy=self.client.get('/api/energy-planning').json
        self.assertEqual(energy['received'],1000);self.assertEqual(energy['funding'][0]['offer_id'],offer.id)
        costs=self.client.get('/api/costs').json['summary']
        self.assertEqual(costs['planned'],0);self.assertEqual(costs['budget'],0)
        self.assertEqual(costs['funding_confirmed'],3000)
        self.assertEqual(self.client.delete('/api/offers/'+str(offer.id)).status_code,409)

    def test_existing_funding_is_preserved_and_invalid_edit_rolls_back(self):
        legacy=Funding(name='Bestehende Förderung',expected=2000,confirmed=1000,received=100,notes='Altbestand')
        db.session.add(legacy);db.session.commit();iid=legacy.id
        self.assertEqual(self.client.get('/api/energy-planning').json['funding'][0]['notes'],'Altbestand')
        bad=self.client.put('/api/funding/'+str(iid),json={'name':'Nicht übernehmen','expected':-1})
        self.assertEqual(bad.status_code,400);self.assertEqual(db.session.get(Funding,iid).name,'Bestehende Förderung')
        self.assertEqual(db.session.query(FundingDetail).count(),0)
        self.assertEqual(self.client.put('/api/funding/'+str(iid),json={'source_url':'javascript:alert(1)'}).status_code,400)

    def test_funding_reference_protects_budget_line(self):
        line=BudgetLine(code='TEST',title='Dämmung',category='Fassade',estimate=1000,kind='Fremdleistung');db.session.add(line);db.session.commit()
        funding=self.client.post('/api/funding',json={'name':'Dämmung','budget_line_id':line.id}).json
        self.assertEqual(self.client.delete('/api/budget/lines/'+str(line.id)).status_code,400)
        self.assertEqual(self.client.delete('/api/funding/'+str(funding['id'])).status_code,200)
        self.assertEqual(self.client.delete('/api/budget/lines/'+str(line.id)).status_code,200)

    def test_energy_page_and_funding_moved_from_costs(self):
        page=self.client.get('/energieplanung');self.assertEqual(page.status_code,200)
        self.assertIn(b'energyFundingForm',page.data)
        costs=self.client.get('/kosten').data
        self.assertNotIn(b'id="fundingrows"',costs)
        self.assertNotIn(b'planUploadForm',costs)
        self.assertIn(b'costOverviewRows',costs)
        self.assertIn(b'tradeSearch',self.client.get('/stammdaten').data)

    def test_company_research_needs_connection_and_explicit_consent(self):
        with patch.object(chatgpt,'run') as run:
            result=self.client.post('/api/contractors/research',json={'query':'Musterfirma','consent':True})
            self.assertGreaterEqual(result.status_code,400);run.assert_not_called()
        with patch.object(chatgpt,'status',return_value={'sharing':True,'credits_acknowledged':True}),patch.object(chatgpt,'run') as run:
            result=self.client.post('/api/contractors/research',headers={'X-PHB-AI':'1'},json={'query':'Musterfirma','plan_only':True})
            self.assertEqual(result.status_code,400);run.assert_not_called()

    def test_company_candidates_are_unsaved_and_invalid_sources_rejected(self):
        candidates={'results':[{'name':'Musterfirma A','source_url':'https://example.org/impressum','website':'https://example.org','phone':'123'},
                              {'name':'Unsicher','source_url':'javascript:alert(1)'}]}
        with patch.object(chatgpt,'status',return_value={'sharing':True,'credits_acknowledged':True}),patch.object(chatgpt,'run',return_value=json.dumps(candidates)) as run:
            response=self.client.post('/api/contractors/research',headers={'X-PHB-AI':'1'},json={'query':'Musterfirma Berlin','model':'test','plan_only':True,'consent':True})
        self.assertEqual(response.status_code,200,response.json);self.assertEqual(len(response.json['results']),1)
        self.assertTrue(run.call_args.kwargs['web_search'])
        self.assertEqual(self.client.get('/api/costs').json['contractors'],[])

    def test_money_parser_rejects_nonfinite_and_preserves_cents(self):
        self.assertEqual(amount('12.345,67 €'),12345.67)
        for value in ('NaN','Infinity',-1,True,None,'1,234'):
            with self.subTest(value=value),self.assertRaises(ValueError):amount(value)


class CompanyWebSearchTest(unittest.TestCase):
    def test_research_requires_confirmed_web_search_not_model_memory(self):
        local=ChatGPTLocal()
        class Stream:
            status_code=200
            events=[]
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def iter_lines(self,**kwargs):
                for event in self.events:yield 'data: '+json.dumps(event)
        response=Stream()
        response.events=[{'type':'response.output_text.delta','delta':'{"results":[]}'},{'type':'response.completed'}]
        with patch.object(local,'models',return_value=[{'slug':'test'}]),patch.object(local,'token',return_value='test-token'),patch('chatgpt_local.requests.post',return_value=response) as post:
            with self.assertRaises(AIError):local.run('Firmenname','Suche','test',web_search=True)
            self.assertEqual(post.call_args.kwargs['json']['tools'],[{'type':'web_search'}])
            response.events.insert(0,{'type':'response.output_item.done','item':{'type':'web_search_call','status':'completed'}})
            self.assertEqual(local.run('Firmenname','Suche','test',web_search=True),'{"results":[]}')
