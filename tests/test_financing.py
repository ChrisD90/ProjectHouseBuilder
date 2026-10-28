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
import zipfile

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
from app import app, db, initialize, Receipt, Loan, EquityAccount, FinancingEvent, ReceiptFinancingPayment, LoanDrawdown


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

    def test_existing_loan_can_be_supplemented_without_changing_bookings(self):
        lid=self.loan()
        self.assertEqual(self.event('loan_drawdown','400',loan_id=lid).status_code,201)
        previous=self.state()
        loan_before=next(x for x in previous['loans'] if x['id']==lid)
        before_drawn=loan_before['balance']['drawn']

        # A patch may add individual terms without re-entering the entire contract.
        updated=self.client.patch(f'/api/financing/loans/{lid}',json={
            'bank':'Neue Bankbezeichnung',
            'notes':'Nachtrag laut Schreiben vom 23.10.2026',
            'reference':'AZ-4711',
            'interest_rate':'4.125',
            'fixed_until':'2037-10-23'})
        self.assertEqual(updated.status_code,200,updated.json)
        self.assertEqual(updated.json['bank'],'Neue Bankbezeichnung')
        self.assertEqual(updated.json['reference'],'AZ-4711')
        self.assertEqual(updated.json['notes'],'Nachtrag laut Schreiben vom 23.10.2026')
        self.assertEqual(updated.json['interest_rate'],4.125)
        self.assertEqual(updated.json['principal'],1000)
        self.assertEqual(updated.json['monthly_payment'],100)
        self.assertEqual(updated.json['fixed_until'],'2037-10-23')
        self.assertEqual(updated.json['balance']['drawn'],before_drawn)
        self.assertEqual(len(self.state()['events']),len(previous['events']))

        # Editing core terms must not invalidate committed drawdowns.
        rejected=self.client.patch(f'/api/financing/loans/{lid}',json={'principal':'399'})
        self.assertEqual(rejected.status_code,400,rejected.json)
        current=next(x for x in self.state()['loans'] if x['id']==lid)
        self.assertEqual(current['principal'],1000)
        self.assertEqual(current['notes'],'Nachtrag laut Schreiben vom 23.10.2026')
        self.assertEqual(current['balance']['drawn'],400)

    def test_financing_page_explicitly_offers_editing_and_additional_details(self):
        page=self.client.get('/finanzierung')
        self.assertEqual(page.status_code,200)
        self.assertIn(b'id="loanSaveStatus"',page.data)
        self.assertIn(b'id="loanSaveButton"',page.data)
        self.assertIn(b'id="loanAiOverwrite"',page.data)
        self.assertIn(b'id="loanDialogTitle"',page.data)
        self.assertIn(b'id="newDrawdown"',page.data)
        self.assertIn(b'id="drawdownDialog"',page.data)
        self.assertIn(b'id="drawdownHistory"',page.data)
        self.assertIn(b'id="drawdownPreviewStage"',page.data)
        self.assertIn(b'id="manualDrawdownDocument"',page.data)
        self.assertIn(b'id="loanDrawdownProfileForm"',page.data)
        self.assertIn(b'name="document_type"',page.data)

    def test_loan_drawdown_profile_is_reused_for_new_requests(self):
        lid=self.loan('1000','Kredit mit Abrufprofil')
        saved=self.client.patch(f'/api/financing/loans/{lid}/drawdown-profile',json={
            'borrower_names':'Erika und Max Beispiel','property_address':'Musterweg 1',
            'recipient_name':'Erika Beispiel','recipient_iban':'DE02 1203 0000 0000 2020 51',
            'location':'Musterstadt','notes':'Immer mit Rechnungsnachweisen'})
        self.assertEqual(saved.status_code,200,saved.json)
        self.assertEqual(saved.json['profile']['recipient_iban'],'DE02120300000000202051')
        self.assertEqual(self.client.patch(f'/api/financing/loans/{lid}/drawdown-profile',
            json={'recipient_iban':'DE123'}).status_code,400)
        loan=next(row for row in self.state()['loans'] if row['id']==lid)
        self.assertEqual(loan['drawdown_profile']['property_address'],'Musterweg 1')

        eid=self.equity('500','0');rid=self.receipt('100')
        self.assertEqual(self.pay(rid,'100','equity',eid).status_code,201)
        created=self.client.post('/api/financing/drawdowns/drafts',json={
            'loan_id':lid,'receipt_ids':[rid],'requested_date':'2026-10-28'})
        self.assertEqual(created.status_code,201,created.json)
        self.assertEqual(created.json['borrower_names'],'Erika und Max Beispiel')
        self.assertEqual(created.json['recipient_iban'],'DE02120300000000202051')
        drawdown=db.session.get(LoanDrawdown,created.json['id'])
        for name in (drawdown.preview_name,drawdown.stored_name):
            if name:self.addCleanup((Path(app.root_path)/'private'/'loan-drawdowns'/name).unlink,missing_ok=True)

    def test_equity_account_reserve_and_overdraft(self):
        eid=self.equity()
        self.assertEqual(self.state()['summary']['equity_available'],600)
        self.assertEqual(self.event('equity_withdrawal','610',equity_id=eid).status_code,400)
        self.assertEqual(self.event('equity_deposit','200',equity_id=eid).status_code,201)
        self.assertEqual(self.event('equity_withdrawal','400',equity_id=eid).status_code,201)
        self.assertEqual(self.state()['summary']['equity_available'],400)
        self.assertEqual(self.state()['equity'][0]['balance']['after_reserve'],200)

    def test_project_budget_comes_from_credit_and_equity_only(self):
        self.assertEqual(self.client.get('/api/costs').json['summary']['budget'],0)
        lid=self.loan('1000')
        eid=self.equity('600','200')
        first=self.client.get('/api/costs').json['summary']
        self.assertEqual(first['budget'],1600)
        self.assertEqual(self.state()['summary']['project_budget'],1600)
        self.assertEqual(self.event('equity_deposit','100',equity_id=eid).status_code,201)
        self.assertEqual(self.event('equity_withdrawal','50',equity_id=eid).status_code,201)
        self.assertEqual(self.client.get('/api/costs').json['summary']['budget'],1650)
        self.assertEqual(self.event('loan_drawdown','400',loan_id=lid).status_code,201)
        rid=self.receipt('200')
        self.assertEqual(self.pay(rid,'150','loan',lid).status_code,201)
        self.assertEqual(self.client.get('/api/costs').json['summary']['budget'],1650)
        self.assertEqual(self.state()['summary']['project_budget'],1650)
        self.assertEqual(self.client.patch('/api/budget/config',
            json={'budget':999999}).status_code,409)
        page=self.client.get('/finanzierung').get_data(as_text=True)
        self.assertIn('id="newLoan"',page)
        self.assertIn('id="newEquity"',page)
        self.assertNotIn('id="paymentForm"',page)
        self.assertNotIn('Liquiditätsvorschau',page)

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

    def test_drawdown_package_rebooks_equity_and_can_be_reversed_atomically(self):
        lid=self.loan('1000','Sanierungskredit')
        eid=self.equity('600','0')
        rid=self.receipt('300')
        receipt=db.session.get(Receipt,rid)
        receipt_path=Path(app.root_path)/'private'/'receipts'/receipt.stored_name
        receipt_path.parent.mkdir(parents=True,exist_ok=True)
        receipt_path.write_bytes(b'%PDF-1.4\nOriginalrechnung')
        self.addCleanup(receipt_path.unlink,missing_ok=True)
        paid=self.pay(rid,'200','equity',eid)
        self.assertEqual(paid.status_code,201,paid.json)
        template=self.client.post(f'/api/financing/loans/{lid}/documents',data={
            'file':(io.BytesIO(b'%PDF-1.4\nAbrufvorlage'),'Bank-Abruf.pdf'),
            'document_type':'drawdown_template','notes':'Vorlage der Bank'},content_type='multipart/form-data')
        self.assertEqual(template.status_code,201,template.json)
        self.assertEqual(template.json['document_type'],'drawdown_template')

        options=self.client.get(f'/api/financing/drawdowns/options?loan_id={lid}')
        self.assertEqual(options.status_code,200,options.json)
        selected=next(row for row in options.json['receipts'] if row['id']==rid)
        self.assertEqual(selected['rebookable'],200)
        self.assertEqual(selected['unpaid'],100)
        self.assertEqual(selected['submittable'],300)
        self.assertTrue(selected['eligible'])
        self.assertEqual(options.json['template']['filename'],'Bank-Abruf.pdf')

        denied=self.client.post('/api/financing/drawdowns/drafts',json={
            'loan_id':lid,'receipt_ids':[rid],'requested_date':'2026-10-28',
            'ai_prefill':True,'model':'m1','plan_only':'true'},base_url='http://127.0.0.1:5055')
        self.assertEqual(denied.status_code,403,denied.json)
        self.assertEqual(self.state()['summary']['loan_drawn'],0)
        self.assertEqual(db.session.get(ReceiptFinancingPayment,paid.json['id']).source,'equity')

        created=self.client.post('/api/financing/drawdowns/drafts',json={
            'loan_id':lid,'receipt_ids':[rid],'requested_date':'2026-10-28',
            'borrower_names':'Erika und Max Beispiel','property_address':'Musterweg 1',
            'recipient_name':'Erika Beispiel','recipient_iban':'DE02120300000000202051',
            'location':'Musterstadt','notes':'Erster Abruf','ai_prefill':False})
        self.assertEqual(created.status_code,201,created.json)
        self.assertEqual(created.json['status'],'Entwurf')
        drawdown_id=created.json['id']
        drawdown=db.session.get(LoanDrawdown,drawdown_id)
        self.addCleanup((Path(app.root_path)/'private'/'loan-drawdowns'/drawdown.preview_name).unlink,missing_ok=True)
        self.addCleanup((Path(app.root_path)/'private'/'loan-drawdowns'/drawdown.stored_name).unlink,missing_ok=True)
        self.assertEqual(self.state()['summary']['loan_drawn'],0)
        self.assertEqual(db.session.get(ReceiptFinancingPayment,paid.json['id']).source,'equity')
        preview=self.client.get(created.json['preview_url'])
        self.assertEqual(preview.status_code,200);preview.close()

        updated=self.client.patch(f'/api/financing/drawdowns/{drawdown_id}/draft',json={
            'requested_amount':'150','requested_date':'2026-10-28',
            'borrower_names':'Erika und Max Beispiel','property_address':'Musterweg 1',
            'recipient_name':'Erika Beispiel','recipient_iban':'DE02120300000000202051',
            'location':'Musterstadt','notes':'Erster Abruf',
            'positions':[{'receipt_id':rid,'supplier':'Test GmbH','invoice_number':'R-4711',
                          'document_date':'2026-10-22','amount':'150'}]})
        self.assertEqual(updated.status_code,200,updated.json)
        self.assertEqual(updated.json['requested_amount'],150)
        self.assertEqual(updated.json['positions'][0]['invoice_number'],'R-4711')

        package=self.client.post(f'/api/financing/drawdowns/{drawdown_id}/submit')
        self.assertEqual(package.status_code,200,repr(package.get_data()[:200]))
        with zipfile.ZipFile(io.BytesIO(package.data)) as archive:
            names=archive.namelist()
            self.assertIn('00_Mittelabruf-Uebersicht.txt',names)
            self.assertIn('01_Bank-Abruf.pdf',names)
            self.assertTrue(any(name.startswith('Rechnungen/01_') for name in names))
            overview=archive.read('00_Mittelabruf-Uebersicht.txt').decode()
            self.assertIn('150.00 EUR',overview)
            self.assertIn('Status: Eingereicht',overview)

        # Einreichung and ZIP generation are audit-only until the bank confirms.
        self.assertEqual(self.state()['summary']['loan_drawn'],0)
        self.assertEqual(db.session.get(ReceiptFinancingPayment,paid.json['id']).source,'equity')
        history=self.client.get('/api/financing/drawdowns').json['drawdowns']
        self.assertEqual(history[0]['status'],'Eingereicht')
        confirmed=self.client.post(f'/api/financing/drawdowns/{drawdown_id}/confirm',
                                   json={'confirmed_date':'2026-10-30'})
        self.assertEqual(confirmed.status_code,200,confirmed.json)
        self.assertEqual(confirmed.json['status'],'Bestätigt')
        state=self.state()
        self.assertEqual(state['summary']['loan_drawn'],150)
        self.assertEqual(state['summary']['paid_loan'],150)
        self.assertEqual(state['summary']['paid_equity'],50)
        payment=db.session.get(ReceiptFinancingPayment,paid.json['id'])
        self.assertEqual((payment.source,payment.loan_id,payment.equity_id,float(payment.amount)),('equity',None,eid,50))
        self.assertEqual(self.client.post(f'/api/financing/payments/{payment.id}/unassign').status_code,409)
        self.assertEqual(self.client.delete(f'/api/financing/payments/{payment.id}').status_code,409)
        self.assertEqual(self.client.get(f'/api/receipts/{rid}/cancel-preview').status_code,409)
        drawdown=db.session.get(LoanDrawdown,drawdown_id)
        self.assertIsNotNone(drawdown)
        self.assertEqual(self.client.delete(f'/api/financing/events/{drawdown.event_id}').status_code,409)
        history=self.client.get('/api/financing/drawdowns').json['drawdowns']
        self.assertEqual(history[0]['receipt_ids'],[rid])
        download=self.client.get(history[0]['download_url'])
        self.assertEqual(download.data,package.data);download.close()

        reversed_=self.client.delete(f'/api/financing/drawdowns/{drawdown.id}')
        self.assertEqual(reversed_.status_code,200,reversed_.json)
        state=self.state()
        self.assertEqual(state['summary']['loan_drawn'],0)
        self.assertEqual(state['summary']['paid_loan'],0)
        self.assertEqual(state['summary']['paid_equity'],200)
        payment=db.session.get(ReceiptFinancingPayment,paid.json['id'])
        self.assertEqual((payment.source,payment.loan_id,payment.equity_id,float(payment.amount)),('equity',None,eid,200))
        history=self.client.get('/api/financing/drawdowns').json['drawdowns']
        self.assertEqual(len(history),1)
        self.assertEqual(history[0]['status'],'Zurückgenommen')

    def test_drawdown_never_double_books_receipts_already_paid_from_target_loan(self):
        first=self.loan('1000','Kredit A');second=self.loan('1000','Kredit B')
        self.assertEqual(self.event('loan_drawdown','300',loan_id=first).status_code,201)
        rid=self.receipt('300');self.assertEqual(self.pay(rid,'300','loan',first).status_code,201)
        first_option=next(row for row in self.client.get(
            f'/api/financing/drawdowns/options?loan_id={first}').json['receipts'] if row['id']==rid)
        second_option=next(row for row in self.client.get(
            f'/api/financing/drawdowns/options?loan_id={second}').json['receipts'] if row['id']==rid)
        self.assertFalse(first_option['eligible']);self.assertEqual(first_option['already_target'],300)
        self.assertFalse(second_option['eligible']);self.assertEqual(second_option['other_loan'],300)
        rejected=self.client.post('/api/financing/drawdowns/drafts',json={
            'loan_id':first,'receipt_ids':[rid],'requested_date':'2026-10-28'})
        self.assertEqual(rejected.status_code,400,rejected.json)
        self.assertEqual(self.state()['summary']['loan_drawn'],300)

    def test_drawdown_accepts_unpaid_invoice_and_keeps_funds_unallocated(self):
        loan=self.loan('1000','Kredit für offene Rechnungen')
        receipt_id=self.receipt('300')
        receipt=db.session.get(Receipt,receipt_id)
        receipt_path=Path(app.root_path)/'private'/'receipts'/receipt.stored_name
        receipt_path.parent.mkdir(parents=True,exist_ok=True)
        receipt_path.write_bytes(b'%PDF-1.4\nOffene Originalrechnung')
        self.addCleanup(receipt_path.unlink,missing_ok=True)

        options=self.client.get(f'/api/financing/drawdowns/options?loan_id={loan}').json['receipts']
        option=next(row for row in options if row['id']==receipt_id)
        self.assertEqual(option['rebookable'],0)
        self.assertEqual(option['unpaid'],300)
        self.assertEqual(option['submittable'],300)
        self.assertTrue(option['eligible'])

        created=self.client.post('/api/financing/drawdowns/drafts',json={
            'loan_id':loan,'receipt_ids':[receipt_id],'requested_date':'2026-10-28'})
        self.assertEqual(created.status_code,201,created.json)
        drawdown_id=created.json['id']
        drawdown=db.session.get(LoanDrawdown,drawdown_id)
        self.addCleanup((Path(app.root_path)/'private'/'loan-drawdowns'/drawdown.stored_name).unlink,missing_ok=True)
        package=self.client.post(f'/api/financing/drawdowns/{drawdown_id}/submit')
        self.assertEqual(package.status_code,200,repr(package.data[:200]))
        confirmed=self.client.post(f'/api/financing/drawdowns/{drawdown_id}/confirm',
                                   json={'confirmed_date':'2026-10-30'})
        self.assertEqual(confirmed.status_code,200,confirmed.json)
        summary=self.state()['summary']
        self.assertEqual(summary['loan_drawn'],300)
        self.assertEqual(summary['paid_loan'],0)
        self.assertEqual(summary['loan_unallocated'],300)
        self.assertEqual(float(db.session.get(Receipt,receipt_id).paid_amount),0)

        reversed_=self.client.delete(f'/api/financing/drawdowns/{drawdown_id}')
        self.assertEqual(reversed_.status_code,200,reversed_.json)
        self.assertEqual(self.state()['summary']['loan_drawn'],0)

    def test_manual_drawdown_books_immediately_and_keeps_attached_form(self):
        lid=self.loan('1000','Manueller Kredit')
        response=self.client.post('/api/financing/manual-drawdowns',data={
            'loan_id':str(lid),'amount':'175.50','event_date':'2026-10-28',
            'notes':'Auszahlung laut Bankbestätigung',
            'file':(io.BytesIO(b'%PDF-1.4\nBestaetigtes Formular'),'Auszahlung.pdf')
        },content_type='multipart/form-data')
        self.assertEqual(response.status_code,201,response.json)
        self.assertEqual(response.json['kind'],'loan_drawdown')
        self.assertEqual(response.json['document']['filename'],'Auszahlung.pdf')
        self.assertEqual(self.state()['summary']['loan_drawn'],175.5)
        downloaded=self.client.get(response.json['document']['download_url'])
        self.assertEqual(downloaded.status_code,200)
        self.assertEqual(downloaded.data,b'%PDF-1.4\nBestaetigtes Formular');downloaded.close()
        self.assertEqual(self.client.delete('/api/financing/events/'+str(response.json['id'])).status_code,200)
        self.assertEqual(self.state()['summary']['loan_drawn'],0)

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
        with patch.object(chatgpt,'status',return_value={'sharing':True,'credits_acknowledged':True}), \
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
        with patch.object(chatgpt,'status',return_value={'sharing':True,'credits_acknowledged':True}), \
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
