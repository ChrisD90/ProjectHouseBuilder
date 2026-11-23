"""Focused transactional guarantees for the approved workflow changes."""
import json,os,unittest
from unittest.mock import patch
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b
from tests.test_financing import FinanceWorkflowTest
from tests.test_calendar_company_time import CalendarCompanyTimeTest

class UpgradedCalendarTest(CalendarCompanyTimeTest):
    # Only the new journeys are selected when running this file explicitly.
    def test_daily_work_preview_series_and_delete_preserve_confirmed_time(self):
        work={'mode':'daily','weekdays':[0,1,2,3,4],'break_minutes':30,'daily_minutes':480}
        event=self.event(start_date='2026-11-23',end_date='2026-11-29',start_time='08:00',end_time='16:00',work=work,performed=True)
        person=self.people()[0];self.assertEqual(person['total_minutes'],2250)
        preview=self.client.post('/api/calendar-hours/preview',json={**event,'work':work})
        self.assertEqual(preview.status_code,200,preview.json);self.assertEqual(preview.json['total_minutes'],2250)
        series=self.client.post('/api/calendar-events/'+str(event['id'])+'/repeat',json={'confirm':True,'count':2,'interval_days':7})
        self.assertEqual(series.status_code,201,series.json)
        path='/api/calendar-events/'+str(event['id']);impact=self.client.get(path+'/impact?scope=series').json
        self.assertEqual(impact['event_count'],3)
        moved=self.client.patch(path,json={'scope':'series','impact_token':impact['token'],'title':'Korrigierte Serie'})
        self.assertEqual(moved.status_code,200,moved.json);self.assertEqual(moved.json['affected'],3)
        stale=self.client.delete(path,json={'scope':'series','impact_token':impact['token'],'time_action':'delete'})
        self.assertEqual(stale.status_code,409)
        deleted=self.client.delete(path,json={'time_action':'keep'})
        self.assertEqual(deleted.status_code,200,deleted.json)
        entries=self.entries(person)
        self.assertEqual(sum(x['minutes'] for x in entries if not x['planned']),2250)
        self.assertTrue(any(x['calendar_event_id'] is None for x in entries))

class UpgradedFinanceTest(FinanceWorkflowTest):
    def test_partial_reimbursement_is_idempotent_and_reverses_all_parts(self):
        loan=self.loan('1000');equity=self.equity('600','0');receipt=self.receipt('300')
        paid=self.pay(receipt,'300','equity',equity);self.assertEqual(paid.status_code,201,paid.json)
        row=b.LoanDrawdown(loan_id=loan,requested_amount=300,requested_date='2026-11-23',stored_name='test-part.zip',status='Eingereicht',payout_type='reimbursement')
        b.db.session.add(row);b.db.session.flush()
        item=b.LoanDrawdownItem(drawdown_id=row.id,receipt_id=receipt,claimed_amount=300,snapshot_json='{}');b.db.session.add(item);b.db.session.commit()
        path='/api/financing/drawdowns/'+str(row.id)
        first=dict(confirmed_date='2026-11-23',amount=100,positions=[dict(receipt_id=receipt,amount=100)],confirmation_id='partial-confirmation-0001')
        result=self.client.post(path+'/confirm',json=first);self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(result.json['status'],'Teilweise ausgezahlt');self.assertEqual(result.json['remaining_amount'],200)
        repeat=self.client.post(path+'/confirm',json=first);self.assertEqual(repeat.status_code,200,repeat.json)
        self.assertEqual(self.state()['summary']['loan_drawn'],100)
        self.assertEqual(b.db.session.get(b.Receipt,receipt).paid_amount,300)
        invalid=self.client.post(path+'/confirm',json={**first,'amount':201,'confirmation_id':'partial-confirmation-bad2'})
        self.assertEqual(invalid.status_code,409)
        second={**first,'amount':200,'positions':[dict(receipt_id=receipt,amount=200)],'confirmation_id':'partial-confirmation-0002'}
        final=self.client.post(path+'/confirm',json=second);self.assertEqual(final.status_code,200,final.json)
        self.assertEqual(final.json['status'],'Ausgezahlt');self.assertEqual(self.state()['summary']['loan_drawn'],300)
        reverse=self.client.delete(path);self.assertEqual(reverse.status_code,200,reverse.json)
        self.assertEqual(self.state()['summary']['loan_drawn'],0)
        self.assertEqual(b.db.session.get(b.ReceiptFinancingPayment,paid.json['id']).source,'equity')
        self.assertEqual(b.db.session.get(b.ReceiptFinancingPayment,paid.json['id']).amount,300)

class DraftAndJobsTest(unittest.TestCase):
    def setUp(self):
        self.context=b.app.app_context();self.context.push();b.db.session.remove();b.db.drop_all();b.initialize();self.client=b.app.test_client()
    def tearDown(self):b.db.session.remove();b.db.drop_all();self.context.pop()
    def test_drafts_and_background_results_stay_project_local(self):
        other=self.client.post('/api/projects',json={'title':'Anderes Projekt'}).json['project']['id'];foreign={'X-PHB-Project':str(other)}
        path='/api/ui-drafts/room%3Anew';payload={'value':{'title':'Privater Entwurf','geometry':{'width':4000}}}
        self.assertEqual(self.client.put(path,json=payload).status_code,200)
        self.assertEqual(self.client.get(path).json['draft']['value'],payload['value'])
        self.assertIsNone(self.client.get(path,headers=foreign).json['draft'])
        job=b.ImportJob(batch_id='test-ai',kind='ai_actions',filename='Wissensantwort',stored_name='',analysis_mode='ai',status='Wartend',stage='',extra_json=json.dumps({'endpoint':'/api/companion/glossary/explain','payload':{'term':'Mörtel','context':'','consent':True},'action':'glossary_explain'}))
        b.db.session.add(job);b.db.session.commit();ident=job.id
        with patch.object(b,'_ai_request_required'),patch.object(b.chatgpt,'run',return_value='Gespeicherte Erklärung'):
            b._run_import_job(ident)
        b.db.session.expire_all()
        result=self.client.get('/api/ai-actions/'+str(ident));self.assertEqual(result.json['job']['status'],'Fertig',result.json)
        self.assertEqual(result.json['result']['answer'],'Gespeicherte Erklärung')
        self.assertEqual(self.client.get('/api/ai-actions/'+str(ident),headers=foreign).status_code,404)
        self.assertNotIn('glossary',self.client.get('/api/companion').json)

    def test_persistent_ai_job_rejects_tampered_financial_endpoint(self):
        job=b.ImportJob(batch_id='tampered-ai',kind='ai_actions',filename='Manipulierter Auftrag',stored_name='',analysis_mode='ai',status='Wartend',stage='',extra_json=json.dumps({'endpoint':'/api/financing/loans','payload':{'consent':True},'action':'glossary_explain'}))
        b.db.session.add(job);b.db.session.commit();ident=job.id
        with patch.object(b.chatgpt,'run') as run:
            b._run_import_job(ident)
        b.db.session.expire_all()
        result=self.client.get('/api/ai-actions/'+str(ident))
        self.assertEqual(result.json['job']['status'],'Fehler',result.json)
        run.assert_not_called()
        self.assertEqual(b.db.session.query(b.Loan).count(),0)
