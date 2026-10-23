"""Versioned PDF quotes: no lost originals, positions, decisions or invoices."""
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ['DATABASE_URL']='sqlite:///:memory:'
from app import app, db, initialize, Offer, OfferVersion, CostItem, Receipt, Document
from sqlalchemy import select


def parsed(version):
    price={2:12000,3:12500,4:14000}.get(version,10000)
    return {'filename':f'revision-{version}.pdf','family':'Andere','vendor':'Elektro Meisterbetrieb',
            'number':f'EL-{version}','issued':f'2026-10-{version+10:02d}',
            'expires':'','gross':price,'net':price/1.19,'vat':price-price/1.19,
            'tax_rate':19,'positions':[{'number':'1','section':'Elektro',
            'description':f'Verkabelung Variante {version}','quantity':1,'unit':'Pauschale',
            'unit_price':round(price/1.19,2),'net_amount':round(price/1.19,2),
            'optional':False,'optional_amount':None,'page':1}],
            'groups':[], 'reconciled':True,'warnings':[]}


class OfferVersionTests(unittest.TestCase):
    def setUp(self):
        self.ctx=app.app_context();self.ctx.push()
        db.session.remove();db.drop_all();initialize()
        self.client=app.test_client()
        self.t=tempfile.TemporaryDirectory();self.addCleanup(self.t.cleanup)
        self.root=Path(self.t.name)
        patcher=patch('app.DOCUMENT_ROOT',self.root)
        patcher.start();self.addCleanup(patcher.stop)

    def tearDown(self):
        db.session.remove();db.drop_all();self.ctx.pop()

    def manual(self, accepted=False):
        res=self.client.post('/api/offers/manual',json={
            'vendor':'Elektro Meisterbetrieb','gross':'10.000,00','category':'Elektro','number':'EL-1'})
        self.assertEqual(res.status_code,201,res.json)
        id=res.json['id']
        if accepted:
            res=self.client.patch(f'/api/offers/{id}',json={'status':'Angenommen'})
            self.assertEqual(res.status_code,200,res.json)
        return id

    def upload_revision(self,id,version,content=None):
        content=content or (b'%PDF-1.4\nPDF-version-'+str(version).encode())
        with patch('app._analyse_pdf_offer',return_value=(parsed(version),'recognised text')):
            return self.client.post(f'/api/offers/{id}/versions',data={
                'file':(io.BytesIO(content),f'angebot-v{version}.pdf')},content_type='multipart/form-data')

    def draft(self,id,version,**changes):
        payload={'vendor':'Elektro Meisterbetrieb',
                 'positions':[{'number':'A.1','description':f'Manual corrections v{version}',
                  'section':'Beiblatt','quantity':'2','unit':'Stück','unit_price':'2500',
                  'net_amount':'5000','optional':False,'page':'2'}]}
        payload.update(changes)
        return self.client.patch(f'/api/offers/{id}/versions/{version}/draft',json=payload)

    def current(self,id):
        return next(o for o in self.client.get('/api/offers').json['offers'] if o['id']==id)

    def test_pending_version_does_not_change_active_offer(self):
        id=self.manual()
        before=self.client.get('/api/costs').json['summary']['planned']
        up=self.upload_revision(id,2)
        self.assertEqual(up.status_code,201,up.json)
        current=self.current(id)
        self.assertEqual((current['gross'],current['number'],current['current_version']), (10000,'EL-1',1))
        self.assertEqual(self.client.get('/api/costs').json['summary']['planned'],before)
        self.assertEqual(len(self.client.get('/api/offers').json['offers']),1)
        self.assertEqual(len(self.client.get('/api/offers').json['draft_versions']),1)
        rows=self.client.get(f'/api/offers/{id}/versions').json['versions']
        self.assertEqual([(r['version'],r['state']) for r in rows],[(2,'draft'),(1,'current')])
        self.assertEqual(rows[-1]['snapshot']['gross'],10000)
        self.assertEqual(len(list(self.root.glob('*.pdf'))),1)

    def test_activate_revision_keeps_entire_original_and_custom_positions(self):
        id=self.manual()
        self.assertEqual(self.upload_revision(id,2).status_code,201)
        edit=self.draft(id,2,gross='13.500,00',number='EL-2-korrigiert')
        self.assertEqual(edit.status_code,200,edit.json)
        self.assertEqual(self.current(id)['gross'],10000)
        result=self.client.post(f'/api/offers/{id}/versions/2/activate')
        self.assertEqual(result.status_code,200,result.json)
        now=self.current(id)
        self.assertEqual((now['current_version'],now['gross'],now['number']), (2,13500,'EL-2-korrigiert'))
        self.assertEqual(now['positions'][0]['description'],'Manual corrections v2')
        self.assertEqual(len(self.client.get('/api/offers').json['offers']),1)
        history=self.client.get(f'/api/offers/{id}/versions').json['versions']
        self.assertEqual([(v['version'],v['state']) for v in history],[(2,'current'),(1,'historical')])
        self.assertEqual(history[1]['snapshot']['number'],'EL-1')
        self.assertEqual(history[1]['snapshot']['gross'],10000)
        self.assertEqual(history[0]['snapshot']['positions'][0]['description'],'Manual corrections v2')
        self.assertEqual(self.client.patch(f'/api/offers/{id}/versions/1/draft',json={'gross':7}).status_code,409)
        self.assertEqual(self.client.post(f'/api/offers/{id}/versions/2/activate').status_code,409)

    def test_multiple_pdf_revisions_and_document_protection(self):
        id=self.manual()
        self.assertEqual(self.upload_revision(id,2).status_code,201)
        v2=self.client.get(f'/api/offers/{id}/versions').json['versions'][0]
        document_id=v2['document_id']
        self.assertEqual(self.client.delete(f'/api/documents/{document_id}').status_code,409)
        self.assertEqual(self.client.post(f'/api/offers/{id}/versions/2/activate').status_code,200)
        self.assertEqual(self.upload_revision(id,3).status_code,201)
        self.assertEqual(self.client.post(f'/api/offers/{id}/versions/3/activate').status_code,200)
        v3=self.current(id)
        self.assertEqual(v3['gross'],12500)
        self.assertEqual(len(self.client.get('/api/offers').json['offers']),1)
        history=self.client.get(f'/api/offers/{id}/versions').json['versions']
        self.assertEqual([v['state'] for v in history],['current','historical','historical'])
        self.assertEqual(history[1]['snapshot']['gross'],12000)
        self.assertEqual(history[2]['snapshot']['gross'],10000)
        self.assertEqual(self.client.get(f'/api/documents/{document_id}/download').status_code,200)
        self.assertEqual(self.client.delete(f'/api/documents/{document_id}').status_code,409)
        self.assertEqual(len(list(self.root.glob('*.pdf'))),2)

    def test_accepted_offer_and_invoice_link_survive_revision_change(self):
        id=self.manual(accepted=True)
        item=db.session.scalar(select(CostItem).where(CostItem.offer_id==id))
        original_id=item.id
        receipt=Receipt(digest='b'*64,original_name='R1.pdf',stored_name='R1.pdf',
                        supplier='Elektro Meisterbetrieb',invoice_number='R-01',
                        document_date='2026-10-23',gross_amount=5000,paid_amount=3000,
                        category='Elektro',status='Gebucht',cost_item_id=original_id)
        db.session.add(receipt);db.session.commit()
        first=self.current(id)['billing']
        self.assertEqual((first['agreed'],first['billed'],first['paid']),(10000,5000,3000))
        upload=self.upload_revision(id,2)
        self.assertEqual(upload.status_code,201,upload.json)
        self.assertEqual(self.current(id)['billing']['agreed'],10000)
        response=self.client.post(f'/api/offers/{id}/versions/2/activate')
        self.assertEqual(response.status_code,200,response.json)
        after=self.current(id)
        self.assertEqual(after['status'],'Angenommen')
        self.assertEqual((after['billing']['agreed'],after['billing']['billed'],after['billing']['paid']),(12000,5000,3000))
        self.assertEqual(db.session.get(Receipt,receipt.id).cost_item_id,original_id)
        self.assertEqual(db.session.get(CostItem,original_id).committed,12000)
        self.assertEqual(db.session.get(CostItem,original_id).offer_id,id)
        self.assertEqual(len(db.session.scalars(select(CostItem).where(CostItem.offer_id==id)).all()),1)

    def test_bad_revision_data_rejected_atomically_and_history_unchanged(self):
        id=self.manual()
        self.assertEqual(self.upload_revision(id,2).status_code,201)
        invalid=self.draft(id,2,positions=[{'description':'','net_amount':'100'}],gross=14000)
        self.assertEqual(invalid.status_code,400,invalid.json)
        current=self.client.get(f'/api/offers/{id}/versions').json['versions'][0]
        self.assertEqual(current['snapshot']['gross'],12000)
        self.assertEqual(self.current(id)['gross'],10000)
        self.assertEqual(self.upload_revision(id,3).status_code,409)
        self.assertEqual(self.upload_revision(id,2).status_code,409)
        self.assertEqual(self.client.post(f'/api/offers/{id}/versions/2/discard').status_code,200)
        self.assertEqual(self.current(id)['gross'],10000)
        self.assertEqual(self.upload_revision(id,3).status_code,201)
        statuses=[v['state'] for v in self.client.get(f'/api/offers/{id}/versions').json['versions']]
        self.assertIn('discarded',statuses)
        self.assertIn('draft',statuses)

    def test_ui_exposes_review_form_and_history_without_old_versions_in_list(self):
        html=self.client.get('/angebote').get_data(as_text=True)
        js=Path(__file__).resolve().parents[1].joinpath('static/offers.js').read_text()
        self.assertIn('offerList',html)
        self.assertIn('data-version-upload',js)
        self.assertIn('data-version-review',js)
        self.assertIn('data-version-history',js)
        self.assertIn('versions/'+"'",js)


if __name__=='__main__': unittest.main()
