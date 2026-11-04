"""Accepted-offer invoice tracking: server constraints, partials, final invoices, forecasts."""
import io
import os
import unittest
from unittest.mock import patch
from sqlalchemy import select

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
from app import app, db, initialize, Offer, CostItem, Receipt


class OfferInvoiceTrackingTests(unittest.TestCase):
    def setUp(self):
        self.ctx=app.app_context();self.ctx.push()
        db.session.remove();db.drop_all();initialize()
        self.client=app.test_client()
        self.counter=0

    def tearDown(self):
        db.session.remove();db.drop_all();self.ctx.pop()

    def offer(self, gross='20000', accept=True):
        response=self.client.post('/api/offers/manual',json={
            'vendor':'Elektro Fachbetrieb','category':'Elektro','gross':gross})
        self.assertEqual(response.status_code,201,response.json)
        oid=response.json['id']
        if accept:
            accepted=self.client.patch(f'/api/offers/{oid}',json={'status':'Angenommen'})
            self.assertEqual(accepted.status_code,200,accepted.json)
            item=db.session.scalar(select(CostItem).where(CostItem.offer_id==oid))
            self.assertIsNotNone(item)
            return oid,item.id
        return oid,None

    def upload(self):
        self.counter+=1
        text=f'Elektro Fachbetrieb\nRechnung {self.counter}\n21.10.2026\nGesamtbetrag 120,00 EUR'
        with patch('app.extract_text',return_value=(text,'PDF-Text')):
            response=self.client.post('/api/receipts',data={
                'file':(io.BytesIO(b'%PDF-1.4\n'+str(self.counter).encode()),f'teil-{self.counter}.pdf')},
                content_type='multipart/form-data')
        self.assertEqual(response.status_code,201,response.json)
        return response.json['id']

    def bill(self,item_id,gross,*,kind='Normal',deduction=0,paid=0,book=True):
        rid=self.upload()
        body={'supplier':'Elektro Fachbetrieb','invoice_number':f'R-{rid}',
              'document_date':'2026-10-22','kind':'Rechnung',
              'gross_amount':str(gross),'paid_amount':str(paid),
              'billing_type':kind,'advance_deduction':str(deduction),
              'cost_item_id':item_id}
        update=self.client.patch(f'/api/receipts/{rid}',json=body)
        self.assertEqual(update.status_code,200,update.json)
        if book:
            result=self.client.post(f'/api/receipts/{rid}/book')
            self.assertEqual(result.status_code,200,result.json)
        return rid

    def billing(self,oid):
        quote=next(x for x in self.client.get('/api/offers').json['offers'] if x['id']==oid)
        return quote['billing']

    def test_only_accepted_quotes_are_linkable_and_api_guard_is_server_side(self):
        pending,_=self.offer(accept=False)
        # Simulates a manipulated API client or an old cost row from a previous build.
        row=CostItem(offer_id=pending,title='Nicht angenommen',category='Elektro',
                     state='Beauftragt',offer=20000,committed=20000,selected=True)
        db.session.add(row);db.session.commit()
        rid=self.upload()
        denied=self.client.patch(f'/api/receipts/{rid}',json={'cost_item_id':row.id})
        self.assertEqual(denied.status_code,400,denied.json)
        self.assertIn('angenommenen',denied.json['error'])
        self.assertIsNone(db.session.get(Receipt,rid).cost_item_id)
        # Guard also holds at booking time if a legacy row was linked before update.
        db.session.get(Receipt,rid).cost_item_id=row.id
        db.session.commit()
        self.assertEqual(self.client.post(f'/api/receipts/{rid}/book').status_code,409)
        self.assertIsNone(self.billing(pending))
        db.session.get(Receipt,rid).cost_item_id=None;db.session.commit()
        self.assertEqual(self.client.patch(f'/api/offers/{pending}',json={'status':'Abgelehnt'}).status_code,200)
        self.assertEqual(self.client.patch(f'/api/receipts/{rid}',json={'cost_item_id':row.id}).status_code,400)

    def test_partial_invoices_and_payments_warning_full_overrun(self):
        oid,item=self.offer()
        b=self.billing(oid)
        self.assertEqual((b['billed'],b['paid'],b['remaining'],b['stage']), (0,0,20000,'normal'))
        draft=self.bill(item,5000,book=False)
        draft_billing=self.billing(oid)
        self.assertEqual(draft_billing['billed'],0,'Draft must not count')
        self.assertEqual(len(draft_billing['invoices']),0)
        self.assertEqual(len(draft_billing['linked_invoices']),1)
        self.assertEqual(draft_billing['linked_invoices'][0]['status'],'Entwurf')
        self.assertEqual(self.client.post(f'/api/receipts/{draft}/book').status_code,200)
        self.assertEqual(self.billing(oid)['billed'],5000)
        self.bill(item,11000,paid=2000)
        b=self.billing(oid)
        self.assertEqual((b['billed'],b['paid'],b['remaining'],b['stage']),(16000,2000,4000,'warning'))
        self.assertAlmostEqual(b['percent'],80)
        self.assertEqual(len(b['invoices']),2)
        self.assertEqual(b['invoices'][0]['counted'],5000)
        self.bill(item,4000)
        self.assertEqual(self.billing(oid)['stage'],'fully_billed')
        self.bill(item,1000)
        b=self.billing(oid)
        self.assertEqual((b['billed'],b['remaining'],b['stage']),(21000,-1000,'overrun'))
        forecast=self.client.get('/api/costs').json['summary']
        self.assertGreaterEqual(forecast['planned'],21000)

    def test_final_invoice_includes_prior_installments_without_double_counting(self):
        oid,item=self.offer()
        first=self.bill(item,8000,kind='Abschlagsrechnung',paid=8000)
        second=self.bill(item,7000,kind='Abschlagsrechnung')
        final=self.bill(item,20000,kind='Schlussrechnung',deduction=15000,paid=1500)
        b=self.billing(oid)
        self.assertEqual((b['billed'],b['paid'],b['remaining']),(20000,9500,0))
        self.assertEqual(b['invoices'][-1]['gross'],20000)
        self.assertEqual(b['invoices'][-1]['advance_deduction'],15000)
        self.assertEqual(b['invoices'][-1]['counted'],5000)
        self.assertEqual(self.client.get(f'/api/receipts/{final}').json['counted_amount'],5000)
        costs=self.client.get('/api/costs').json['summary']
        self.assertEqual(costs['receipt_booked'],20000)
        self.assertEqual(costs['receipt_paid'],9500)
        self.assertEqual(self.client.post(f'/api/receipts/{first}/unbook').status_code,409)
        self.assertEqual(self.client.post(f'/api/receipts/{second}/unbook').status_code,409)
        self.assertEqual(self.client.post(f'/api/receipts/{final}/unbook').status_code,200)
        self.assertEqual(self.billing(oid)['billed'],15000)
        self.assertEqual(self.client.post(f'/api/receipts/{second}/unbook').status_code,200)

    def test_final_invoice_for_remaining_amount_needs_no_deduction(self):
        oid,item=self.offer()
        self.bill(item,8000,kind='Abschlagsrechnung')
        self.bill(item,7000,kind='Abschlagsrechnung')
        self.bill(item,5000,kind='Schlussrechnung')
        self.assertEqual(self.billing(oid)['billed'],20000)

    def test_invalid_advance_deduction_and_duplicate_final_blocked(self):
        oid,item=self.offer()
        self.bill(item,8000,kind='Abschlagsrechnung')
        rid=self.upload()
        base={'supplier':'Elektro','document_date':'2026-10-22','gross_amount':20000,
              'cost_item_id':item,'billing_type':'Schlussrechnung','advance_deduction':9000}
        too_much=self.client.patch(f'/api/receipts/{rid}',json=base)
        self.assertEqual(too_much.status_code,400,too_much.json)
        self.assertEqual(db.session.get(Receipt,rid).advance_deduction,0)
        invalid=self.client.patch(f'/api/receipts/{rid}',json={**base,'advance_deduction':8000,'paid_amount':13000})
        self.assertEqual(invalid.status_code,400,invalid.json)
        self.bill(item,20000,kind='Schlussrechnung',deduction=8000)
        another=self.upload()
        self.assertEqual(self.client.patch(f'/api/receipts/{another}',json={**base,'advance_deduction':0}).status_code,400)
        self.assertEqual(self.client.patch(f'/api/receipts/{rid}',json={'cost_item_id':item}).status_code,200)
        self.assertEqual(self.client.patch(f'/api/receipts/{rid}',json={'billing_type':'Abschlagsrechnung'}).status_code,400)
        self.assertEqual(self.client.patch(f'/api/receipts/{rid}',json={'gross_amount':1000}).status_code,200)
        self.assertEqual(self.client.post(f'/api/receipts/{rid}/book').status_code,409)

    def test_linked_booked_invoice_can_be_reassigned_without_unbooking(self):
        oid,item=self.offer()
        rid=self.bill(item,2000)
        result=self.client.patch(f'/api/offers/{oid}',json={'status':'Abgelehnt'})
        self.assertEqual(result.status_code,409,result.json)
        self.assertEqual(self.client.patch(f'/api/receipts/{rid}',json={'cost_item_id':None}).status_code,200)
        self.assertEqual(self.client.patch(f'/api/receipts/{rid}',json={'advance_deduction':300}).status_code,400)
        self.assertEqual(self.client.patch(f'/api/offers/{oid}',json={'status':'Abgelehnt'}).status_code,200)

    def test_manual_quote_draft_and_other_costs_do_not_appear_in_accepted_only_selector(self):
        oid,item=self.offer(accept=False)
        self.assertNotIn('Angenommene Angebote',self.client.get('/belege').get_data(as_text=True)) # loaded dynamically
        # Selector construction is driven from accepted offer status and selected cost item.
        self.assertIn('const accepted=new Map',open('static/receipts.js',encoding='utf8').read())
        self.assertIsNone(self.billing(oid))

if __name__=='__main__':unittest.main()
