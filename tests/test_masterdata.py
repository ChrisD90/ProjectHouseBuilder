"""Master-data CRUD and propagation to existing linked project records."""
import os
import unittest

os.environ['DATABASE_URL']='sqlite:///:memory:'
from app import app,db,initialize,Contractor,Trade,Task,_get_or_add_contractor,add_parsed_offer


class MasterDataTest(unittest.TestCase):
    def setUp(self):
        self.ctx=app.app_context();self.ctx.push()
        db.session.remove();db.drop_all();initialize()
        self.client=app.test_client()

    def tearDown(self):
        db.session.remove();db.drop_all();self.ctx.pop()

    def test_master_page_and_contact_details_from_auto_import(self):
        self.assertEqual(self.client.get('/stammdaten').status_code,200)
        contractor=_get_or_add_contractor('Automatisch Heizung GmbH','WP')
        db.session.commit()
        cid=contractor.id
        entries=self.client.get('/api/costs').json['contractors']
        self.assertTrue(any(c['id']==cid for c in entries))
        self.assertTrue(any(t['name']=='Wärmepumpe / Heizung'
                            for t in self.client.get('/api/trades').json['trades']))
        saved=self.client.put('/api/contractors/'+str(cid),json={
            'contact':'Herr Mustermann','contact_secondary':'Frau Beispiel',
            'phone':'+49 6221 1234','mobile':'+49 170 1234',
            'phone_other':'+49 6221 5678','email':'mail@beispiel.test',
            'website':'https://beispiel.test','address':'Hauptstr. 10',
            'notes':'Zusätzliche Unterlagen erhalten'})
        self.assertEqual(saved.status_code,200,saved.json)
        record=next(c for c in self.client.get('/api/costs').json['contractors']
                    if c['id']==cid)
        self.assertEqual(record['name'],'Automatisch Heizung GmbH')
        self.assertEqual(record['contact'],'Herr Mustermann')
        self.assertEqual(record['contact_secondary'],'Frau Beispiel')
        self.assertEqual(record['mobile'],'+49 170 1234')
        self.assertEqual(record['phone_other'],'+49 6221 5678')
        self.assertEqual(record['website'],'https://beispiel.test')

    def test_trade_rename_updates_contractors_and_schedule(self):
        created=self.client.post('/api/trades',json={'name':'Altbau Spezial'})
        self.assertEqual(created.status_code,201,created.json)
        tid=created.json['id']
        self.assertIn('Altbau Spezial',self.client.get('/api/project').json['trades'])
        self.assertEqual(self.client.post('/api/trades',json={'name':'altbau spezial'}).status_code,400)
        contractor=Contractor(name='Beispielhandwerker',trade='Altbau Spezial')
        task=Task(code='T-100',name='Mauer ausbessern',trade='Altbau Spezial',phase='Rohbau')
        db.session.add_all([contractor,task]);db.session.commit()
        rename=self.client.patch('/api/trades/'+str(tid),json={'name':'Mauerwerksarbeiten'})
        self.assertEqual(rename.status_code,200,rename.json)
        db.session.refresh(contractor);db.session.refresh(task)
        self.assertEqual(contractor.trade,'Mauerwerksarbeiten')
        self.assertEqual(task.trade,'Mauerwerksarbeiten')
        self.assertEqual(self.client.delete('/api/trades/'+str(tid)).status_code,409)
        self.assertEqual(self.client.get('/api/trades').status_code,200)

    def test_offer_analysis_never_silently_creates_masterdata_company(self):
        parsed={'vendor':'Neue OCR Firma GmbH','family':'Andere','number':'A-1',
            'issued':'','expires':'','gross':1000,'net':None,'vat':None,'tax_rate':None,
            'reconciled':False,'warnings':[],'filename':'angebot.pdf','groups':[],
            'positions':[]}
        offer=add_parsed_offer(parsed,'a'*64)
        db.session.commit()
        self.assertIsNone(offer.contractor_id)
        self.assertEqual(db.session.query(Contractor).count(),0)
        existing=Contractor(name='Bestehende Firma GmbH',trade='Elektro')
        db.session.add(existing);db.session.commit()
        parsed['vendor']='bestehende firma gmbh'
        linked=add_parsed_offer(parsed,'b'*64)
        db.session.commit()
        self.assertEqual(linked.contractor_id,existing.id)
        self.assertEqual(db.session.query(Contractor).count(),1)

    def test_legacy_contacts_can_be_deleted_only_when_unused(self):
        firm=self.client.post('/api/contractors',json={
            'name':'Testbetrieb','trade':'Trockenbau','phone':'123'})
        self.assertEqual(firm.status_code,200,firm.json)
        self.assertIn('Trockenbau', [x['name'] for x in
                      self.client.get('/api/trades').json['trades']])
        rows=self.client.get('/api/costs').json['contractors']
        fid=next(c['id'] for c in rows if c['name']=='Testbetrieb')
        self.assertEqual(self.client.delete('/api/contractors/'+str(fid)).status_code,200)

if __name__=='__main__':
    unittest.main()
