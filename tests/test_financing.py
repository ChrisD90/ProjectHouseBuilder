"""Financing integration checks: anti-double-count, spending limits, cashflows, backups."""
from datetime import date, timedelta
from decimal import Decimal
import io
import json
import os
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
from app import app, db, initialize, Receipt, Loan, EquityAccount, FinancingEvent, ReceiptFinancingPayment


class FinanceWorkflowTest(unittest.TestCase):
    def setUp(self):
        self.ctx=app.app_context();self.ctx.push()
        db.session.remove();db.drop_all();initialize()
        self.client=app.test_client()

    def tearDown(self):
        db.session.remove();db.drop_all();self.ctx.pop()

    def post(self,path,data):
        return self.client.post(path,json=data)

    def loan(self,amount='1000',name='Testkredit'):
        response=self.post('/api/financing/loans',{'name':name,'principal':amount,
          'interest_rate':'3.760','monthly_payment':'100','initial_repayment_rate':'2.5',
          'extra_repayment_pct':'5','bank':'Testbank','fixed_until':'2036-10-22'})
        self.assertEqual(response.status_code,201,response.json)
        return response.json['id']

    def equity(self,amount='600',reserve='200'):
        r=self.post('/api/financing/equity',{'name':'Eigengeld','opening_balance':amount,'reserve':reserve})
        self.assertEqual(r.status_code,201,r.json)
        return r.json['id']

    def event(self,kind,amount,loan_id=None,equity_id=None):
        return self.post('/api/financing/events',{'kind':kind,'amount':amount,'loan_id':loan_id,
          'equity_id':equity_id,'event_date':'2026-10-22'})

    def receipt(self,gross='300',paid='0',due='2026-12-22'):
        receipt=Receipt(digest='b'*62+str(Receipt.query.count()%10).zfill(2),stored_name=f'test{Receipt.query.count()}.pdf',
           original_name='Rechnung Test.pdf',supplier='Test GmbH',document_date='2026-10-22',due_date=due,
           gross_amount=Decimal(gross),paid_amount=Decimal(paid),status='Gebucht',category='Elektro')
        db.session.add(receipt);db.session.commit()
        return receipt.id

    def pay(self,rid,amount,source,ref):
        return self.post('/api/financing/payments',{'receipt_id':rid,'source':source,
          'loan_id':ref if source=='loan' else None,'equity_id':ref if source=='equity' else None,
          'amount':amount,'payment_date':'2026-10-22'})

    def state(self):
        r=self.client.get('/api/financing')
        self.assertEqual(r.status_code,200,r.json)
        return r.json

    def test_initial_empty_and_page(self):
        self.assertEqual(self.client.get('/finanzierung').status_code,200)
        self.assertEqual(self.state()['summary']['loan_frame'],0)
        self.assertEqual(self.state()['summary']['equity_available'],0)

    def test_loan_terms_and_drawdowns(self):
        lid=self.loan()
        self.assertEqual(self.event('loan_drawdown','400',loan_id=lid).status_code,201)
        s=self.state()['summary']
        self.assertEqual(s['loan_frame'],1000)
        self.assertEqual(s['loan_drawn'],400)
        self.assertEqual(s['loan_undrawn'],600)
        self.assertEqual(s['loan_unallocated'],400)
        self.assertEqual(s['loan_debt'],400)
        self.assertEqual(self.event('loan_drawdown','601',loan_id=lid).status_code,400)
        self.assertEqual(self.event('loan_repayment','401',loan_id=lid).status_code,400)
        self.assertEqual(self.event('loan_repayment','100',loan_id=lid).status_code,201)
        self.assertEqual(self.event('loan_interest','10',loan_id=lid).status_code,201)
        self.assertEqual(self.state()['summary']['loan_debt'],300)
        self.assertEqual(self.state()['summary']['loan_unallocated'],400)

    def test_equity_account_reserve_and_overdraft(self):
        eid=self.equity()
        self.assertEqual(self.state()['summary']['equity_available'],600)
        self.assertEqual(self.event('equity_withdrawal','610',equity_id=eid).status_code,400)
        self.assertEqual(self.event('equity_deposit','200',equity_id=eid).status_code,201)
        self.assertEqual(self.event('equity_withdrawal','400',equity_id=eid).status_code,201)
        self.assertEqual(self.state()['summary']['equity_available'],400)
        self.assertEqual(self.state()['equity'][0]['balance']['after_reserve'],200)

    def test_split_paid_receipt_counts_once(self):
        loan=self.loan();equity=self.equity()
        self.assertEqual(self.event('loan_drawdown','500',loan_id=loan).status_code,201)
        rid=self.receipt('300')
        old=self.client.get('/api/costs').json['summary']
        p1=self.pay(rid,'180','loan',loan)
        self.assertEqual(p1.status_code,201,p1.json)
        p2=self.pay(rid,'120','equity',equity)
        self.assertEqual(p2.status_code,201,p2.json)
        new=self.client.get('/api/costs').json['summary']
        self.assertEqual(new['paid']-old['paid'],300)
        self.assertEqual(new['planned'],old['planned'])
        s=self.state()['summary']
        self.assertEqual(s['paid_loan'],180)
        self.assertEqual(s['paid_equity'],120)
        self.assertEqual(s['unassigned_paid_receipts'],0)
        self.assertEqual(s['loan_unallocated'],320)
        self.assertEqual(s['equity_available'],480)
        self.assertEqual(self.client.post(f'/api/receipts/{rid}/unbook').status_code,409)
        self.assertEqual(self.client.patch(f'/api/receipts/{rid}',json={'paid_amount':'0'}).status_code,400)
        self.assertEqual(self.pay(rid,'0.01','equity',equity).status_code,400)
        self.assertEqual(self.client.delete(f'/api/financing/payments/{p1.json["id"]}').status_code,200)
        self.assertEqual(self.state()['summary']['loan_unallocated'],500)
        self.assertEqual(float(db.session.get(Receipt,rid).paid_amount),120)

    def test_legacy_paid_receipt_cannot_be_paid_again(self):
        lid=self.loan()
        self.event('loan_drawdown','500',loan_id=lid)
        rid=self.receipt('300','100')
        self.assertEqual(self.pay(rid,'100','loan',lid).status_code,400)
        self.assertEqual(self.state()['summary']['unassigned_paid_receipts'],100)
        self.assertEqual(self.client.patch(f'/api/receipts/{rid}',json={'paid_amount':'0'}).status_code,200)
        self.assertEqual(self.pay(rid,'100','loan',lid).status_code,201)

    def test_do_not_spend_more_than_drawn_or_available(self):
        lid=self.loan();eid=self.equity('50','0');rid=self.receipt('400')
        self.event('loan_drawdown','100',loan_id=lid)
        self.assertEqual(self.pay(rid,'101','loan',lid).status_code,400)
        self.assertEqual(self.pay(rid,'51','equity',eid).status_code,400)
        self.assertEqual(self.pay(rid,'50','equity',eid).status_code,201)
        self.assertEqual(self.pay(rid,'100','loan',lid).status_code,201)
        draw=self.state()['events'][0]
        self.assertEqual(self.client.delete('/api/financing/events/'+str(draw['id'])).status_code,409)
        self.assertEqual(self.client.delete('/api/financing/loans/'+str(lid)).status_code,409)
        self.assertEqual(self.client.delete('/api/financing/equity/'+str(eid)).status_code,409)

    def test_open_invoice_forecast_and_warning(self):
        self.receipt('200',due=(date.today()-timedelta(days=3)).isoformat())
        s=self.state()['summary']
        self.assertEqual(s['overdue'],200)
        self.assertEqual(s['unpaid_booked'],200)
        self.assertTrue(s['financing_gap']>=200)
        self.assertTrue(len(s['warnings'])>=1)
        self.assertEqual(sum(m['due'] for m in s['months']),200)

    def test_validation_and_negative_amounts(self):
        self.assertEqual(self.post('/api/financing/loans',{'name':'x','principal':'-100'}).status_code,400)
        self.assertEqual(self.post('/api/financing/loans',{'name':'x','principal':'100','interest_rate':'3.8888'}).status_code,400)
        self.assertEqual(self.post('/api/financing/loans',{'name':'x','principal':'Infinity'}).status_code,400)
        lid=self.loan()
        self.assertEqual(self.event('loan_drawdown','0.001',loan_id=lid).status_code,400)
        self.assertEqual(self.event('loan_drawdown','10',loan_id=lid).status_code,201)
        self.assertEqual(self.client.patch(f'/api/financing/loans/{lid}',json={'principal':'5'}).status_code,400)

    def test_loan_document_upload_download_removal_and_delete_guard(self):
        lid=self.loan()
        first=self.client.post(f'/api/financing/loans/{lid}/documents',
            data={'file':(io.BytesIO(b'%PDF-1.4\\nTest-Brief'),'Bankbrief.pdf'),
                  'notes':'Zinsmitteilung'},content_type='multipart/form-data')
        self.assertEqual(first.status_code,201,first.json)
        did=first.json['id']
        self.assertEqual(first.json['filename'],'Bankbrief.pdf')
        loan=next(x for x in self.state()['loans'] if x['id']==lid)
        self.assertEqual(len(loan['documents']),1)
        self.assertEqual(loan['documents'][0]['notes'],'Zinsmitteilung')
        self.assertEqual(self.client.delete(f'/api/financing/loans/{lid}').status_code,409)
        stream=self.client.get(f'/api/financing/loans/{lid}/documents/{did}/download')
        self.assertEqual(stream.status_code,200)
        self.assertEqual(stream.data,b'%PDF-1.4\\nTest-Brief')
        self.assertEqual(stream.headers['Cache-Control'],'no-store')
        self.assertEqual(self.client.get(
            f'/api/financing/loans/{lid+999}/documents/{did}/download').status_code,404)
        self.assertEqual(self.client.post(f'/api/financing/loans/{lid}/documents',
            data={'file':(io.BytesIO(b'not a pdf'),'bad.pdf')},
            content_type='multipart/form-data').status_code,400)
        self.assertEqual(self.client.delete(
            f'/api/financing/loans/{lid}/documents/{did}').status_code,200)
        self.assertEqual(self.state()['loans'][0]['documents'],[])
        self.assertEqual(self.client.delete(f'/api/financing/loans/{lid}').status_code,200)

    def test_chatgpt_loan_proposal_requires_explicit_consent_and_never_autosaves(self):
        from chatgpt_local import chatgpt
        proposed=json.dumps({
            'name':'Kredit aus Vertrag','bank':'Beispielbank',
            'principal':'200.000,00','interest_rate':'3,760',
            'monthly_payment':'980,00','extra_repayment_pct':'5',
            'contract_date':'2026-10-22','fixed_until':'2036-10-22',
            'warnings':['Zinsbeginn gesondert prüfen']
        })
        def submit(extra=None,headers=None):
            return self.client.post('/api/financing/loans/ai/extract',
              data={'file':(io.BytesIO(b'%PDF-1.4\\nSensible Vertragsdaten'),'vertrag.pdf'),
                    'model':'m1',**(extra or {})},
              headers=headers or {},content_type='multipart/form-data',
              base_url='http://127.0.0.1:5055')
        with patch.object(chatgpt,'status',return_value={'sharing':True}), \
             patch.object(chatgpt,'run',return_value=proposed) as run:
            self.assertEqual(submit({'plan_only':'true'}).status_code,403)
            self.assertEqual(submit(headers={'X-PHB-AI':'1'}).status_code,403)
            res=submit({'plan_only':'true'},{'X-PHB-AI':'1'})
        self.assertEqual(res.status_code,200,res.json)
        self.assertEqual(run.call_count,1)
        self.assertEqual(res.json['fields']['principal'],'200000.00')
        self.assertEqual(res.json['fields']['interest_rate'],'3.760')
        self.assertEqual(res.json['fields']['monthly_payment'],'980.00')
        self.assertEqual(res.json['fields']['fixed_until'],'2036-10-22')
        self.assertTrue(res.json['warnings'])
        self.assertEqual(self.state()['loans'],[],
                         'KI-Auslesen darf keinen Kredit eigenständig speichern')
        manual=self.post('/api/financing/loans',{
             'name':res.json['fields']['name'],
             'principal':res.json['fields']['principal'],
             'interest_rate':res.json['fields']['interest_rate']})
        self.assertEqual(manual.status_code,201,manual.json)
        self.assertEqual(manual.json['principal'],200000)

    def test_loan_ai_rejects_bad_file_and_conflicting_values(self):
        from chatgpt_local import chatgpt
        with patch.object(chatgpt,'status',return_value={'sharing':True}), \
             patch.object(chatgpt,'run',return_value=json.dumps({
                 'principal':'not-an-amount','interest_rate':'999',
                 'fixed_until':'2030-99-77','bank':'Bank X',
                 'warnings':[] })):
            result=self.client.post('/api/financing/loans/ai/extract',
               data={'file':(io.BytesIO(b'%PDF-1.4\\nA'),'loan.pdf'),
                     'model':'m1','plan_only':'true'},
               headers={'X-PHB-AI':'1'},base_url='http://127.0.0.1:5055',
               content_type='multipart/form-data')
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(result.json['fields'],{'bank':'Bank X'})
        self.assertGreaterEqual(len(result.json['warnings']),3)
        self.assertEqual(self.state()['loans'],[])

    def test_backup_manual_endpoint(self):
        from unittest.mock import patch as mock
        with mock('backup_manager.make_backup',side_effect=ValueError('Backupziel offline')):
            res=self.client.post('/api/backup/create',json={})
        self.assertEqual(res.status_code,409)
        with tempfile.TemporaryDirectory() as td:
            f=Path(td)/'safe.zip';f.write_bytes(b'some bytes')
            with mock('backup_manager.make_backup',return_value=f):
                res=self.client.post('/api/backup/create',json={})
        self.assertEqual(res.status_code,201,res.json)
        self.assertTrue(res.json['verified'])


if __name__=='__main__':unittest.main()
