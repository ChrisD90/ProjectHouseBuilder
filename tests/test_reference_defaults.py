"""Default reference data and reviewed import queue behavior."""
import io
import os
import unittest
from unittest.mock import patch
os.environ['DATABASE_URL']='sqlite:///:memory:'
from app import (app,db,initialize,Trade,Category,Contractor,Receipt,Offer,Setting,ImportJob,
                 ProjectDocument,DEFAULT_TRADES,CATEGORIES,IMPORT_QUEUE_ROOT,
                 _run_import_job)


class ReferenceDefaultsTest(unittest.TestCase):
    def setUp(self):
        self.ctx=app.app_context();self.ctx.push()
        db.session.remove();db.drop_all();initialize()
        self.client=app.test_client()
    def tearDown(self):
        for j in db.session.query(ImportJob):
            (IMPORT_QUEUE_ROOT/j.stored_name).unlink(missing_ok=True)
        db.session.remove();db.drop_all();self.ctx.pop()

    def test_existing_custom_trades_are_kept_when_first_default_seed_runs(self):
        db.session.delete(db.session.get(Setting,'trades_initialized'))
        missing=db.session.query(Trade).filter_by(name='Elektroinstallation').one()
        db.session.delete(missing)
        db.session.add(Trade(name='Bestehendes Spezialgewerk'))
        db.session.commit()
        initialize()
        names={t.name for t in db.session.query(Trade)}
        self.assertIn('Elektroinstallation',names)
        self.assertIn('Bestehendes Spezialgewerk',names)
        self.assertEqual(len(names),len(DEFAULT_TRADES)+1)

    def test_trades_seeded_once_and_reset_restores_without_overwriting_used_custom(self):
        initial={x.name for x in db.session.query(Trade)}
        self.assertEqual(initial,set(DEFAULT_TRADES))
        chosen=db.session.query(Trade).filter_by(name='Trockenbau').one()
        r=self.client.patch('/api/trades/'+str(chosen.id),json={'name':'Spezial-Trockenbau'})
        self.assertEqual(r.status_code,200,r.json)
        self.assertNotIn('Trockenbau',[x.name for x in db.session.query(Trade)])
        self.client.post('/api/trades',json={'name':'Freier Altbau-Service'})
        used=self.client.post('/api/trades',json={'name':'Bestandsaufnahme Spezial'})
        self.assertEqual(used.status_code,201,used.json)
        contractor=Contractor(name='Betrieb',trade='Bestandsaufnahme Spezial')
        db.session.add(contractor);db.session.commit()
        self.assertEqual(self.client.post('/api/trades/restore-defaults',json={}).status_code,400)
        restored=self.client.post('/api/trades/restore-defaults',json={'confirm':True})
        self.assertEqual(restored.status_code,200,restored.json)
        self.assertIn('Trockenbau',restored.json['added'])
        self.assertIn('Freier Altbau-Service',restored.json['removed'])
        self.assertIn('Bestandsaufnahme Spezial',restored.json['preserved'])
        all_names={x.name for x in db.session.query(Trade)}
        self.assertTrue(set(DEFAULT_TRADES).issubset(all_names))
        self.assertNotIn('Freier Altbau-Service',all_names)
        self.assertIn('Bestandsaufnahme Spezial',all_names)
        again=self.client.post('/api/trades/restore-defaults',json={'confirm':True})
        self.assertEqual(again.json['added'],[])
        self.assertEqual(again.json['removed'],[])
        with app.app_context():initialize()
        self.assertNotIn('Freier Altbau-Service',[x.name for x in db.session.query(Trade)])

    def test_default_categories_restored_and_used_custom_survives(self):
        self.assertEqual({c.name for c in db.session.query(Category)},set(CATEGORIES))
        created=self.client.post('/api/categories',json={'name':'Spezialposition'})
        self.assertEqual(created.status_code,201,created.json)
        db.session.add(Receipt(digest='abc',original_name='test.pdf',stored_name='abc.pdf',
                               category='Spezialposition',source='Manuell'))
        db.session.commit()
        self.client.post('/api/categories',json={'name':'Unbenutzt'})
        removed=db.session.query(Category).filter_by(name='Fenster & Türen').one()
        self.assertEqual(self.client.delete('/api/categories/'+str(removed.id)).status_code,200)
        result=self.client.post('/api/categories/restore-defaults',json={'confirm':True})
        self.assertEqual(result.status_code,200,result.json)
        self.assertIn('Fenster & Türen',result.json['added'])
        self.assertIn('Unbenutzt',result.json['removed'])
        self.assertIn('Spezialposition',result.json['preserved'])
        self.assertEqual(db.session.query(Receipt).one().category,'Spezialposition')
        self.assertIn('Sonstiges',{x.name for x in db.session.query(Category)})

    def enqueue(self,kind,content,name):
        with patch('app._start_import_worker'):
            resp=self.client.post('/api/import-jobs',data={
                'kind':kind,'analysis_mode':'local',
                'files':[(io.BytesIO(content),name)]},content_type='multipart/form-data')
        self.assertEqual(resp.status_code,202,resp.json)
        return resp.json['jobs'][0]['id']

    def test_imported_offer_disappears_only_after_explicit_list_accept_or_reject(self):
        created=self.client.post('/api/offers/manual',json={
            'vendor':'Handwerksbetrieb','gross':'1190','category':'Elektro'})
        self.assertEqual(created.status_code,201,created.json)
        oid=created.json['id']
        offer=db.session.get(Offer,oid)
        offer.status='Entwurf'
        db.session.commit()
        # Simulate an already processed PDF whose editable offer draft now exists.
        job=ImportJob(batch_id='test',kind='offers',filename='offer.pdf',
                      stored_name='test-only.pdf',analysis_mode='local',
                      status='Fertig',stage='Bitte prüfen',result_id=oid)
        db.session.add(job);db.session.commit()
        self.assertEqual(len(self.client.get('/api/import-jobs').json['jobs']),1)
        listing=self.client.patch('/api/offers/'+str(oid),json={'status':'Angebot'})
        self.assertEqual(listing.status_code,200,listing.json)
        self.assertEqual(self.client.get('/api/import-jobs').json['jobs'],[])
        self.assertEqual(db.session.get(ImportJob,job.id).status,'Übernommen')
        self.assertIsNotNone(db.session.get(Offer,oid))

    def test_receipt_disappears_from_queue_only_after_explicit_editor_confirmation(self):
        job_id=self.enqueue('receipts',b'%PDF-1.4 test','rechnungsbeleg.pdf')
        with patch('app.extract_text',return_value=(
            'Rechnung\nFachbetrieb\nGesamtbetrag 150,00 EUR','PDF-Text')):
            _run_import_job(job_id)
        ready=self.client.get('/api/import-jobs').json['jobs'][0]
        self.assertEqual(ready['status'],'Fertig')
        rid=ready['result_id']
        # A background import is never accidentally treated as user-reviewed.
        self.assertEqual(db.session.get(ImportJob,job_id).status,'Fertig')
        saved=self.client.patch('/api/receipts/'+str(rid),
            json={'supplier':'Fachbetrieb','reviewed':True})
        self.assertEqual(saved.status_code,200,saved.json)
        self.assertEqual(self.client.get('/api/import-jobs').json['jobs'],[])
        self.assertEqual(db.session.get(ImportJob,job_id).status,'Übernommen')
        self.assertIsNotNone(db.session.get(Receipt,rid))

    def test_project_document_removed_from_active_queue_after_metadata_save(self):
        job_id=self.enqueue('documents',b'Original Zeichnung aus Text','zeichnung.txt')
        _run_import_job(job_id)
        job=db.session.get(ImportJob,job_id)
        self.assertEqual(job.status,'Fertig')
        document=self.client.patch('/api/project-documents/'+str(job.result_id),
            json={'title':'Geprüfte technische Zeichnung'})
        self.assertEqual(document.status_code,200,document.json)
        self.assertEqual(self.client.get('/api/import-jobs').json['jobs'],[])
        self.assertEqual(db.session.get(ProjectDocument,job.result_id).title,
                         'Geprüfte technische Zeichnung')

if __name__=='__main__':unittest.main()
