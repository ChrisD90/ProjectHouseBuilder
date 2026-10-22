"""End-to-end receipt tests with Flask's SQLite test client."""
import io
import os
import unittest
from unittest.mock import patch
os.environ['DATABASE_URL']='sqlite:///:memory:'
from app import app,db,initialize,Receipt,CostItem,BudgetLine

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
