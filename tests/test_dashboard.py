"""Dashboard isolation, stale writes, backup safety and financial semantics only."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b
from dashboard import default_layout,KEY
import project_backups

class DashboardTest(unittest.TestCase):
    def setUp(self):
        self.ctx=b.app.app_context();self.ctx.push();b.db.session.remove();b.db.drop_all();b.initialize();self.client=b.app.test_client()
    def tearDown(self):b.db.session.remove();b.db.drop_all();self.ctx.pop()
    def post(self,path,**data):
        response=self.client.post(path,json=data);self.assertIn(response.status_code,(200,201),response.json);return response.json
    def test_layout_is_scoped_stale_safe_and_included_in_backup(self):
        other=self.post('/api/projects',title='Anderes Projekt')['project']['id']
        before=self.client.get('/api/dashboard/layout').json
        layout=default_layout();layout['widgets'][0]['config']={'title':'Meine Termine'}
        result=self.client.put('/api/dashboard/layout',json=dict(layout=layout,token=before['token']))
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(self.client.put('/api/dashboard/layout',json=dict(layout=default_layout(),token=before['token'])).status_code,409)
        self.assertEqual(self.client.get('/api/dashboard/layout',headers={'X-PHB-Project':str(other)}).json['layout'],default_layout())
        self.assertEqual(self.client.get('/api/dashboard/layout').json['layout'],layout)
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'backups').mkdir();archive=project_backups.create(b.db,root,1,{'folder':str(root/'backups'),'keep':5})
            # Public restore validation accepts the long setting and enforces project ownership.
            restored=project_backups.load_rows(archive,b.db,1)
            rows=restored[1]
            self.assertEqual(json.loads(next(x for x in rows['setting'] if x['key']==KEY)['value'])['layout'],layout)
            self.client.put('/api/dashboard/layout',json=dict(layout=default_layout(),token=result.json['token']))
            project_backups.restore(archive,b.db,root,1)
            self.assertEqual(self.client.get('/api/dashboard/layout').json['layout'],layout)
            self.assertEqual(self.client.get('/api/dashboard/layout',headers={'X-PHB-Project':str(other)}).json['layout'],default_layout())
        token=result.json['token'];invalid=default_layout();invalid['widgets'][1]['x']=0
        self.assertEqual(self.client.put('/api/dashboard/layout',json=dict(layout=invalid,token=token)).status_code,400)
        invalid=default_layout();invalid['widgets'][0]['config']={'links':['javascript:alert(1)']}
        self.assertEqual(self.client.put('/api/dashboard/layout',json=dict(layout=invalid,token=token)).status_code,400)
        self.assertEqual(self.client.get('/api/dashboard/layout').json,result.json)
    def test_source_aggregations_preserve_payment_shares_and_project_isolation(self):
        loan=self.post('/api/financing/loans',name='Bank',principal=1000)['id']
        equity=self.post('/api/financing/equity',name='Eigenkapital',opening_balance=500)['id']
        receipt=b.Receipt(digest='1'*64,stored_name='test.pdf',original_name='Test.pdf',supplier='Firma',gross_amount=100,paid_amount=0,status='Gebucht',document_date='2026-11-25')
        todo=b.ProjectWork(kind='todo',title='Nur dieses Projekt',body='Details')
        b.db.session.add_all([receipt,todo]);b.db.session.commit();ident=receipt.id
        self.post('/api/financing/events',kind='loan_drawdown',loan_id=loan,amount=150,event_date='2026-11-25')
        self.post('/api/financing/payments',receipt_id=ident,amount=40,source='equity',equity_id=equity,payment_date='2026-11-25')
        self.post('/api/financing/payments',receipt_id=ident,amount=30,source='loan',loan_id=loan,payment_date='2026-11-25')
        # Manual equity withdrawals are not receipt expenses.
        self.post('/api/financing/events',kind='equity_withdrawal',equity_id=equity,amount=10,event_date='2026-11-25')
        with patch.object(b,'budget_summary',side_effect=AssertionError('No unrelated cost aggregation')):
            finance=self.client.get('/api/dashboard/source/finance')
        self.assertEqual(finance.status_code,200,finance.json)
        self.assertEqual(finance.json['credit'],970);self.assertEqual(finance.json['equity'],40);self.assertEqual(finance.json['expenses'],190)
        rows=self.client.get('/api/dashboard/source/receipts').json['items'];self.assertEqual(rows[0]['remaining'],30)
        other=self.post('/api/projects',title='Leer')['project']['id']
        for source in ('receipts','todos','events','offers','self_work','hours','notes','deadlines','shopping','inbox','finance'):
            response=self.client.get('/api/dashboard/source/'+source,headers={'X-PHB-Project':str(other)})
            self.assertEqual(response.status_code,200,(source,response.json))
            self.assertEqual(response.json.get('items',[]),[],source)
        self.assertEqual(self.client.get('/api/dashboard/source/finance',headers={'X-PHB-Project':str(other)}).json['expenses'],0)
        # Dashboard reads neither rebook payments nor change original source records.
        b.db.session.expire_all();self.assertEqual(b.db.session.get(b.Receipt,ident).paid_amount,70)
