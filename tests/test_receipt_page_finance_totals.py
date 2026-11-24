"""Lean receipt context and financing projections retain project/payment integrity."""
import os,unittest
from unittest.mock import patch
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b

class ReceiptPageFinanceTest(unittest.TestCase):
    def setUp(self):
        self.ctx=b.app.app_context();self.ctx.push();b.db.session.remove();b.db.drop_all();b.initialize();self.client=b.app.test_client()
    def tearDown(self):b.db.session.remove();b.db.drop_all();self.ctx.pop()
    def receipt(self,number,amount):
        row=b.Receipt(digest=str(number)*64,stored_name=str(number)+'.pdf',original_name='Test.pdf',supplier='Testbetrieb',document_date='2026-11-24',gross_amount=amount,paid_amount=0,status='Gebucht',category='Elektro')
        b.db.session.add(row);b.db.session.commit();return row.id
    def post(self,path,**data):
        response=self.client.post(path,json=data);self.assertIn(response.status_code,(200,201),response.json);return response.json
    def test_editor_loads_only_requested_receipt_without_cost_dashboard_and_stays_project_local(self):
        ident=self.receipt(1,120);self.receipt(2,80)
        with patch.object(b,'budget_summary',side_effect=AssertionError('Keine Kostenaggregation im Editor')):
            response=self.client.get('/api/receipts/'+str(ident)+'/editor')
        self.assertEqual(response.status_code,200,response.json);self.assertEqual(response.json['receipt']['id'],ident)
        self.assertNotIn('receipts',response.json);self.assertNotIn('summary',response.json['context'])
        self.assertEqual(self.client.get('/belege/'+str(ident)+'?_classic=1').status_code,200)
        other=self.post('/api/projects',title='Fremdprojekt')['project']['id']
        self.assertEqual(self.client.get('/api/receipts/'+str(ident)+'/editor',headers={'X-PHB-Project':str(other)}).status_code,404)
    def test_overview_sums_only_assigned_payments_and_remaining_credit(self):
        loan=self.post('/api/financing/loans',name='Kredit 1',principal=1000)['id'];self.post('/api/financing/loans',name='Kredit 2',principal=500)
        first=self.post('/api/financing/equity',name='EK1',opening_balance=600,reserve=100)['id'];second=self.post('/api/financing/equity',name='EK2',opening_balance=400)['id']
        self.post('/api/financing/events',kind='loan_drawdown',loan_id=loan,amount=100,event_date='2026-11-24')
        r1=self.receipt(1,120);r2=self.receipt(2,80)
        for ident,amount,source,ref in [(r1,120,'equity',first),(r2,50,'equity',second),(r2,30,'loan',loan)]:
            self.post('/api/financing/payments',receipt_id=ident,amount=amount,source=source,**({'equity_id':ref} if source=='equity' else {'loan_id':ref}),payment_date='2026-11-24')
        self.post('/api/financing/events',kind='equity_withdrawal',equity_id=first,amount=20,event_date='2026-11-24')
        finance=self.client.get('/api/financing').json
        self.assertEqual(finance['summary']['loan_remaining_budget'],1470)
        self.assertEqual(finance['summary']['equity_receipt_spent'],170)
        self.assertEqual([e['balance']['paid_for_project'] for e in finance['equity']],[120,50])
        with patch.object(b,'budget_summary',side_effect=AssertionError('Keine Kostenaggregation für Finanzierungsquellen')):
            sources=self.client.get('/api/financing/sources')
        self.assertEqual(sources.status_code,200);self.assertEqual(sources.json['equity'][0]['reserve'],100);self.assertEqual(sources.json['loans'][0]['balance']['receipt_spent'],30)
