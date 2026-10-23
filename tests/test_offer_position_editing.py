"""PDF offer review allows repairing the OCR position list before publication."""
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
from app import app, db, initialize, Offer, OfferPosition, OfferSection, CostItem
from sqlalchemy import select


def analysed_offer(positions=None, gross=1190.0, net=1000.0):
    return {'filename':'offer.pdf','family':'Andere','vendor':'Elektro Beispiel GmbH',
            'number':'E-20','issued':'23.10.2026','expires':'',
            'net':net,'gross':gross,'vat':190.0,'tax_rate':19.0,
            'positions':positions if positions is not None else [
                {'number':'1','section':'Elektro','description':'Kabel liefern',
                 'quantity':10.0,'unit':'m','unit_price':50.0,'net_amount':500.0,
                 'optional_amount':None,'optional':False,'page':1},
                {'number':'2','section':'Elektro','description':'Dosen setzen',
                 'quantity':5.0,'unit':'Stk.','unit_price':100.0,'net_amount':500.0,
                 'optional_amount':None,'optional':False,'page':2}],
            'groups':[{'name':'Elektro','net':1000.0,'gross':1190.0}],
            'reconciled':True,'warnings':[]}


class OfferPositionEditingTests(unittest.TestCase):
    def setUp(self):
        self.context=app.app_context();self.context.push()
        db.session.remove();db.drop_all();initialize()
        self.client=app.test_client()
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.dir=Path(self.temp.name)/'private_docs';self.dir.mkdir()
        self.patchpath=patch('app.DOCUMENT_ROOT',self.dir)
        self.patchpath.start();self.addCleanup(self.patchpath.stop)

    def tearDown(self):
        db.session.remove();db.drop_all();self.context.pop()

    def upload(self, positions=None, net=1000, gross=1190):
        with patch('app._analyse_pdf_offer',return_value=(analysed_offer(positions,net=net,gross=gross),'')):
            response=self.client.post('/api/offers/import',data={'file':(io.BytesIO(b'%PDF-test-line-items'), 'offer.pdf')},content_type='multipart/form-data')
        self.assertEqual(response.status_code,201,response.json)
        return response.json['id']

    def patch_positions(self, id, rows, **details):
        return self.client.patch(f'/api/offers/{id}/draft',json={**details,'positions':rows})

    def test_edit_add_delete_and_optional_positions_before_listing(self):
        oid=self.upload()
        initial=self.client.get(f'/api/offers').json['offers'][0]
        self.assertEqual(len(initial['positions']),2)
        self.assertEqual(initial['positions'][0]['page'],1)
        rows=[
            {'number':'1','section':'Elektro','description':'Kabel inkl. Verlegung (korrigiert)',
             'quantity':'10,5','unit':'m','unit_price':'50,00','net_amount':'525,00',
             'page':'1','optional':False},
            # The original second position was deliberately deleted.
            {'number':'Anlage-1','section':'Beiblatt 2','description':'Zusatz: Smart-Home Vorbereitung',
             'quantity':'1','unit':'Pauschal','unit_price':'475','net_amount':'475,00',
             'optional':False,'page':''},
            {'number':'O-1','section':'Beiblatt 2','description':'Optionale Steckdosen',
             'quantity':'2','unit':'Stk.','unit_price':'85','net_amount':'',
             'optional_amount':'170','optional':True},
        ]
        result=self.patch_positions(oid,rows,vendor='Elektro Neu GmbH')
        self.assertEqual(result.status_code,200,result.json)
        obj=db.session.get(Offer,oid)
        self.assertEqual(obj.vendor,'Elektro Neu GmbH')
        self.assertEqual(obj.gross,1190)
        self.assertEqual(obj.net,1000)
        self.assertTrue(obj.reconciled)
        self.assertEqual([p.description for p in obj.positions],
                         ['Kabel inkl. Verlegung (korrigiert)','Zusatz: Smart-Home Vorbereitung','Optionale Steckdosen'])
        self.assertEqual(obj.positions[0].quantity,10.5)
        self.assertEqual(obj.positions[1].section,'Beiblatt 2')
        self.assertIsNone(obj.positions[1].page)
        self.assertTrue(obj.positions[2].optional)
        self.assertEqual(obj.positions[2].optional_amount,170)
        self.assertEqual(len(obj.sections),2)
        self.assertEqual(self.client.get('/api/costs').json['summary']['committed'],0)
        self.assertEqual(self.client.patch(f'/api/offers/{oid}',json={'status':'Angebot'}).status_code,200)
        self.assertEqual(self.client.patch(f'/api/offers/{oid}',json={'status':'Angenommen'}).status_code,200)
        self.assertEqual(db.session.scalar(select(CostItem).where(CostItem.offer_id==oid)).committed,1190)

    def test_unreadable_pdf_can_start_without_lines_then_add_own_positions(self):
        oid=self.upload(positions=[],gross=None,net=None)
        rows=[{'number':'A1','description':'Fußbodenheizung aus Anlage 1','section':'Anlage 1',
               'quantity':'45,25','unit':'m²','unit_price':'30','net_amount':'1357,50',
               'optional':False}]
        res=self.patch_positions(oid,rows,vendor='Sanitär Meister GmbH',gross='1.615,43',net='1.357,50')
        self.assertEqual(res.status_code,200,res.json)
        self.assertEqual(res.json['offer']['positions'][0]['net_amount'],1357.50)
        self.assertEqual(self.client.patch(f'/api/offers/{oid}',json={'status':'Angebot'}).status_code,200)

    def test_amount_discrepancy_does_not_silently_change_gross_total(self):
        oid=self.upload()
        res=self.patch_positions(oid,[{'description':'Nicht vollständig lesbar','net_amount':'220',
                                       'optional':False}])
        self.assertEqual(res.status_code,200,res.json)
        obj=db.session.get(Offer,oid)
        self.assertFalse(obj.reconciled)
        self.assertEqual(obj.gross,1190)
        self.assertEqual(self.client.get('/api/costs').json['summary']['planned'],0)
        self.assertEqual(self.client.patch(f'/api/offers/{oid}',json={'status':'Angebot'}).status_code,200)
        self.assertEqual(self.client.patch(f'/api/offers/{oid}',json={'status':'Angenommen'}).status_code,200)
        self.assertEqual(self.client.get('/api/costs').json['summary']['planned'],1190)

    def test_full_replacement_allows_removing_every_position(self):
        oid=self.upload()
        res=self.patch_positions(oid,[])
        self.assertEqual(res.status_code,200,res.json)
        self.assertEqual(db.session.scalars(select(OfferPosition).where(OfferPosition.offer_id==oid)).all(),[])
        self.assertEqual(db.session.scalars(select(OfferSection).where(OfferSection.offer_id==oid)).all(),[])
        self.assertFalse(db.session.get(Offer,oid).reconciled)
        self.assertEqual(self.client.patch(f'/api/offers/{oid}',json={'status':'Angebot'}).status_code,200)

    def test_regular_detail_change_does_not_delete_positions(self):
        oid=self.upload()
        res=self.client.patch(f'/api/offers/{oid}/draft',json={'gross':'1.200,00','notes':'Beiblatt separat'})
        self.assertEqual(res.status_code,200,res.json)
        self.assertEqual(len(db.session.get(Offer,oid).positions),2)
        self.assertEqual(db.session.get(Offer,oid).gross,1200)

    def test_invalid_positions_roll_back_entire_update(self):
        oid=self.upload()
        wrong=[
            [dict(description='',net_amount='1',optional=False)],
            [dict(description='Test',net_amount='NaN',optional=False)],
            [dict(description='Test',net_amount='-1',optional=False)],
            [dict(description='Test',quantity='Infinity',optional=False)],
            [dict(description='Test',quantity='1,1234567',optional=False)],
            [dict(description='Test',page='0',optional=False)],
            [dict(description='Test',optional='nein')],
            [dict(description='a'*301,optional=False)],
            [{'description':'OK','optional':False},'not-an-object'],
            [{}]*501,
            {'description':'Keine Liste'},
        ]
        for positions in wrong:
            with self.subTest(positions=str(positions)[:70]):
                res=self.patch_positions(oid,positions,vendor='Darf nicht gespeichert werden')
                self.assertEqual(res.status_code,400,res.json)
                db.session.expire_all()
                offer=db.session.get(Offer,oid)
                self.assertEqual(offer.vendor,'Elektro Beispiel GmbH')
                self.assertEqual(len(offer.positions),2)

    def test_positions_locked_when_offer_is_listed_rejected_or_accepted(self):
        oid=self.upload()
        self.assertEqual(self.client.patch(f'/api/offers/{oid}',json={'status':'Angebot'}).status_code,200)
        for stage in ('Angebot','Abgelehnt','Angenommen'):
            if stage == 'Angenommen':
                # A rejected quote must first re-enter the list before acceptance.
                self.assertEqual(self.client.patch(f'/api/offers/{oid}',json={'status':'Angebot'}).status_code,200)
            if stage != 'Angebot':
                self.assertEqual(self.client.patch(f'/api/offers/{oid}',json={'status':stage}).status_code,200)
            res=self.patch_positions(oid,[],gross='123')
            self.assertEqual(res.status_code,409,res.json)
            self.assertEqual(len(db.session.get(Offer,oid).positions),2)
            self.assertEqual(db.session.get(Offer,oid).gross,1190)

    def test_offer_review_screen_contains_position_editor_and_reconciliation(self):
        html=self.client.get('/angebote').get_data(as_text=True)
        js=Path(__file__).resolve().parents[1].joinpath('static/offers.js').read_text()
        self.assertIn('PDF-Daten und Positionen prüfen',html)
        self.assertIn('data-position-add',js)
        self.assertIn('data-position-remove',js)
        self.assertIn('data-position-calculate',js)
        self.assertIn('collectDraft(form)',js)
        self.assertIn('offer-positions-reconcile',js)

if __name__=='__main__':
    unittest.main()
