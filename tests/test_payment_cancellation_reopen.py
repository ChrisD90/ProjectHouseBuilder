"""Source-free payments, later assignment, retained cancellations and task reopening."""
import json
import os
from datetime import date
from decimal import Decimal
import unittest
os.environ['DATABASE_URL']='sqlite:///:memory:'
from app import (app,db,initialize,Receipt,ReceiptFinancingPayment,ReceiptCancellation,ReceiptCancellationReversal,
                 EquityAccount,Loan,FinancingEvent,Task,Offer,CostItem)


class PaymentCancellationTest(unittest.TestCase):
    def setUp(self):
        self.scope=app.app_context();self.scope.push()
        db.session.remove();db.drop_all();initialize();self.client=app.test_client()
        receipt=Receipt(digest='test',original_name='Original.pdf',stored_name='test.pdf',supplier='Beispiel GmbH',invoice_number='RE-1',
                        document_date='2026-10-26',gross_amount=100,paid_amount=0,status='Gebucht',assignment_type='Eigenleistung')
        db.session.add(receipt);db.session.commit();self.rid=receipt.id
    def tearDown(self):
        db.session.remove();db.drop_all();self.scope.pop()
    def payment(self,amount=100,**extra):
        return self.client.post('/api/financing/payments',json={'receipt_id':self.rid,'source':'unassigned','amount':amount,'payment_date':'2026-10-26',**extra})
    def receipt(self):return self.client.get('/api/receipts/'+str(self.rid)).json
    def state(self):return self.client.get('/api/financing').json
    def equity(self,amount=100):
        account=EquityAccount(name='Eigenkapital',opening_balance=amount,reserve=0);db.session.add(account);db.session.commit();return account.id
    def assign(self,pid,amount,eid):
        return self.client.post('/api/financing/payments/assign',json={'receipt_id':self.rid,'payment_id':pid,'source':'equity','equity_id':eid,'amount':amount,'payment_date':'2026-10-26'})
    def cancel(self,**extra):
        preview=self.client.get('/api/receipts/'+str(self.rid)+'/cancel-preview')
        self.assertEqual(preview.status_code,200,preview.json)
        return self.client.post('/api/receipts/'+str(self.rid)+'/cancel',json={'confirm':True,'plan_digest':preview.json['plan_digest'],'reason':'Doppelt erfasst',**extra})
    def reverse_cancel(self,**extra):
        preview=self.client.get('/api/receipts/'+str(self.rid)+'/cancel-reversal-preview')
        self.assertEqual(preview.status_code,200,preview.json)
        return self.client.post('/api/receipts/'+str(self.rid)+'/cancel-reversal',json={
            'confirm':True,'plan_digest':preview.json['plan_digest'],'reason':'Storno war irrtümlich',**extra})

    def test_paid_without_any_account_is_marked_unassigned(self):
        result=self.payment();self.assertEqual(result.status_code,201,result.json)
        self.assertEqual(self.receipt()['paid_amount'],100)
        self.assertEqual(self.receipt()['payment_assignment'],'Nicht zugewiesen')
        self.assertEqual(self.receipt()['unassigned_amount'],100)
        self.assertEqual(self.state()['summary']['unassigned_paid_receipts'],100)
        self.assertEqual(self.state()['receipts'][0]['open'],0)
        self.assertEqual(self.payment(1).status_code,400)

    def test_later_assignment_does_not_pay_twice(self):
        pid=self.payment().json['id'];eid=self.equity(200)
        result=self.assign(pid,100,eid);self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(self.receipt()['paid_amount'],100)
        self.assertEqual(self.receipt()['unassigned_amount'],0)
        self.assertEqual(self.state()['equity'][0]['balance']['available'],100)
        self.assertEqual(self.assign(pid,100,eid).status_code,400)
        self.assertEqual(self.client.get('/api/costs').json['summary']['paid'],100)

    def test_partial_assignment_and_capacity_failure_are_atomic(self):
        pid=self.payment().json['id'];eid=self.equity(60)
        self.assertEqual(self.assign(pid,40,eid).status_code,200)
        self.assertEqual(self.receipt()['unassigned_amount'],60)
        self.assertEqual(self.assign(pid,60,eid).status_code,400)
        self.assertEqual(self.receipt()['unassigned_amount'],60)
        self.assertEqual(self.receipt()['paid_amount'],100)
        self.assertEqual(float(db.session.get(ReceiptFinancingPayment,pid).amount),60)

    def test_legacy_payment_can_be_assigned_without_resetting_amount(self):
        r=db.session.get(Receipt,self.rid);r.paid_amount=100;db.session.commit()
        eid=self.equity(100)
        result=self.assign(None,40,eid);self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(self.receipt()['paid_amount'],100)
        self.assertEqual(self.receipt()['unassigned_amount'],60)
        self.assertEqual(self.state()['summary']['unassigned_paid_receipts'],60)

    def test_unassign_retains_payment_and_undo_returns_invoice_to_open(self):
        pid=self.payment().json['id'];eid=self.equity(100);self.assign(pid,100,eid)
        response=self.client.post('/api/financing/payments/'+str(pid)+'/unassign')
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.receipt()['paid_amount'],100)
        self.assertEqual(self.state()['equity'][0]['balance']['available'],100)
        self.assertEqual(self.client.delete('/api/financing/payments/'+str(pid)).status_code,200)
        self.assertEqual(self.receipt()['paid_amount'],0)

    def test_cancel_reverses_all_payments_and_retains_immutable_original_snapshot(self):
        pid=self.payment().json['id'];eid=self.equity(100);self.assign(pid,60,eid)
        result=self.cancel();self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(self.receipt()['status'],'Storniert')
        self.assertEqual(self.receipt()['paid_amount'],0)
        self.assertEqual(self.receipt()['gross_amount'],100)
        self.assertEqual(self.receipt()['filename'],'Original.pdf')
        self.assertEqual(db.session.query(ReceiptFinancingPayment).count(),0)
        self.assertEqual(self.state()['equity'][0]['balance']['available'],100)
        snapshot=json.loads(db.session.query(ReceiptCancellation).one().snapshot_json)
        self.assertEqual(Decimal(snapshot['receipt']['paid_amount']),100)
        self.assertEqual(len(snapshot['payments']),2)
        for suffix in ('book','unbook'):
            self.assertEqual(self.client.post(f'/api/receipts/{self.rid}/'+suffix).status_code,409)
        self.assertEqual(self.client.delete(f'/api/receipts/{self.rid}').status_code,409)
        self.assertEqual(self.client.patch(f'/api/receipts/{self.rid}',json={'gross_amount':120}).status_code,200)
        self.assertEqual(self.client.patch(f'/api/receipts/{self.rid}',json={'gross_amount':1}).status_code,409)
        self.assertEqual(self.state()['receipts'],[])

    def test_stale_cancel_preview_does_not_reverse_changed_payments(self):
        preview=self.client.get(f'/api/receipts/{self.rid}/cancel-preview').json
        self.payment(20)
        result=self.client.post(f'/api/receipts/{self.rid}/cancel',json={'confirm':True,'plan_digest':preview['plan_digest']})
        self.assertEqual(result.status_code,409)
        self.assertEqual(self.receipt()['paid_amount'],20)
        self.assertEqual(self.receipt()['status'],'Gebucht')
        self.assertEqual(db.session.query(ReceiptCancellation).count(),0)

    def test_cancellation_can_be_reversed_with_all_payments_and_audit_history(self):
        pid=self.payment().json['id'];eid=self.equity(100);self.assign(pid,60,eid)
        self.assertEqual(self.cancel().status_code,200)
        preview=self.client.get(f'/api/receipts/{self.rid}/cancel-reversal-preview')
        self.assertEqual(preview.status_code,200,preview.json)
        self.assertEqual(preview.json['restore_paid'],100)
        self.assertEqual(preview.json['payment_count'],2)
        self.assertEqual(preview.json['allocation_count'],1)
        restored=self.client.post(f'/api/receipts/{self.rid}/cancel-reversal',json={
            'confirm':True,'plan_digest':preview.json['plan_digest'],'reason':'Storno war irrtümlich'})
        self.assertEqual(restored.status_code,200,restored.json)
        current=self.receipt()
        self.assertEqual(current['status'],'Gebucht')
        self.assertEqual(current['paid_amount'],100)
        self.assertEqual(current['unassigned_amount'],40)
        self.assertEqual(len(db.session.query(ReceiptFinancingPayment).all()),2)
        self.assertEqual(self.state()['equity'][0]['balance']['available'],40)
        self.assertEqual(db.session.query(ReceiptCancellation).count(),0)
        reversal=db.session.query(ReceiptCancellationReversal).one()
        self.assertEqual(reversal.cancellation_reason,'Doppelt erfasst')
        self.assertEqual(reversal.reason,'Storno war irrtümlich')
        self.assertEqual(current['cancellation_reversal']['restored_paid'],100)
        self.assertEqual(current['cancellation_reversal']['reason'],'Storno war irrtümlich')
        # A reopened invoice can be cancelled again; the old reversal remains auditable.
        self.assertEqual(self.cancel().status_code,200)
        self.assertEqual(db.session.query(ReceiptCancellation).count(),1)
        self.assertEqual(db.session.query(ReceiptCancellationReversal).count(),1)

    def test_cancellation_reversal_is_atomic_when_financing_capacity_was_reused(self):
        pid=self.payment().json['id'];eid=self.equity(100);self.assign(pid,100,eid)
        self.assertEqual(self.cancel().status_code,200)
        other=Receipt(digest='other',original_name='Andere.pdf',stored_name='other.pdf',
                      supplier='Andere GmbH',document_date='2026-10-27',gross_amount=100,
                      paid_amount=0,status='Gebucht',assignment_type='Eigenleistung')
        db.session.add(other);db.session.commit()
        spent=self.client.post('/api/financing/payments',json={'receipt_id':other.id,'source':'equity',
            'equity_id':eid,'amount':100,'payment_date':'2026-10-27'})
        self.assertEqual(spent.status_code,201,spent.json)
        failed=self.reverse_cancel()
        self.assertEqual(failed.status_code,409,failed.json)
        self.assertIn('Verfügbarer Betrag reicht nicht aus',failed.json['error'])
        self.assertEqual(self.receipt()['status'],'Storniert')
        self.assertEqual(self.receipt()['paid_amount'],0)
        self.assertEqual(db.session.query(ReceiptCancellation).count(),1)
        self.assertEqual(db.session.query(ReceiptCancellationReversal).count(),0)

    def test_cancellation_reversal_refuses_a_deleted_financing_source(self):
        pid=self.payment().json['id'];eid=self.equity(100);self.assign(pid,100,eid)
        self.assertEqual(self.cancel().status_code,200)
        self.assertEqual(self.client.delete(f'/api/financing/equity/{eid}').status_code,200)
        failed=self.reverse_cancel()
        self.assertEqual(failed.status_code,409,failed.json)
        self.assertIn('Eigenkapitalkonto existiert nicht mehr',failed.json['error'])
        self.assertEqual(self.receipt()['status'],'Storniert')
        self.assertEqual(db.session.query(ReceiptFinancingPayment).count(),0)

    def test_cannot_cancel_installment_while_final_invoice_uses_it(self):
        offer=Offer(digest='offer',vendor='Firma',gross=1000,status='Angenommen',filename='Angebot.pdf')
        db.session.add(offer);db.session.flush()
        cost=CostItem(title='Auftrag',offer_id=offer.id,state='Beauftragt');db.session.add(cost);db.session.flush()
        r=db.session.get(Receipt,self.rid);r.cost_item_id=cost.id;r.billing_type='Abschlagsrechnung'
        final=Receipt(digest='final',original_name='Schluss.pdf',stored_name='final.pdf',supplier='Firma',gross_amount=1000,paid_amount=0,
                      advance_deduction=100,status='Gebucht',cost_item_id=cost.id,billing_type='Schlussrechnung')
        db.session.add(final);db.session.commit()
        self.assertEqual(self.client.get(f'/api/receipts/{self.rid}/cancel-preview').status_code,409)
        self.assertEqual(self.receipt()['status'],'Gebucht')


class TaskReopenTest(unittest.TestCase):
    def setUp(self):
        self.scope=app.app_context();self.scope.push();db.session.remove();db.drop_all();initialize();self.client=app.test_client()
    def tearDown(self):db.session.remove();db.drop_all();self.scope.pop()
    def test_restore_prior_status_progress_and_allow_editing_again(self):
        task=Task(code='TEST',name='Weiterarbeiten',duration=2,lag_days=0,status='In Arbeit',progress=45,actual_start=date(2026,10,25),notes='',execution_type='Eigenleistung')
        db.session.add(task);db.session.commit();tid=task.id
        self.assertEqual(self.client.post(f'/api/tasks/{tid}/complete').status_code,200)
        self.assertEqual(self.client.post(f'/api/tasks/{tid}/reopen',json={}).status_code,400)
        response=self.client.post(f'/api/tasks/{tid}/reopen',json={'confirm':True})
        self.assertEqual(response.status_code,200,response.json)
        db.session.refresh(task);self.assertEqual(task.status,'In Arbeit');self.assertEqual(task.progress,45);self.assertIsNone(task.actual_end)
        self.assertEqual(task.actual_start,date(2026,10,25))
        self.assertEqual(self.client.put(f'/api/tasks/{tid}',json={'duration':4}).status_code,200)
        self.assertEqual(self.client.post(f'/api/tasks/{tid}/reopen',json={'confirm':True}).status_code,409)
    def test_completed_legacy_task_without_history_reopens_as_open(self):
        task=Task(code='ALT',name='Altbestand',duration=1,lag_days=0,status='Erledigt',progress=100,actual_end=date(2026,10,25))
        db.session.add(task);db.session.commit()
        response=self.client.post(f'/api/tasks/{task.id}/reopen',json={'confirm':True})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['status'],'Offen');self.assertEqual(response.json['progress'],0)
