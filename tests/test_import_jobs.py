"""Sequential background uploads, durable job progress, retry and AI consent."""
import io
import os
import unittest
from unittest.mock import patch
os.environ['DATABASE_URL']='sqlite:///:memory:'
from app import (app,db,initialize,ImportJob,Receipt,ProjectDocument,
                 IMPORT_QUEUE_ROOT,_run_import_job,_recover_interrupted_imports)


class ImportJobsTest(unittest.TestCase):
    def setUp(self):
        self.ctx=app.app_context();self.ctx.push()
        db.session.remove();db.drop_all();initialize()
        self.client=app.test_client()
    def tearDown(self):
        for job in db.session.query(ImportJob).all():
            (IMPORT_QUEUE_ROOT/job.stored_name).unlink(missing_ok=True)
        db.session.remove();db.drop_all();self.ctx.pop()
    def enqueue(self,kind='receipts',names=('one.pdf',),mode='local',extra=None):
        data={'kind':kind,'analysis_mode':mode,'files':[
            (io.BytesIO(b'%PDF-1.4\nMinimal PDF'),filename) for filename in names
        ]}
        if mode=='ai':
            data.update(model='test-model',plan_only='true')
        data.update(extra or {})
        with patch('app._start_import_worker'):
            return self.client.post('/api/import-jobs',data=data,
                content_type='multipart/form-data',
                headers={'X-PHB-AI':'1'} if mode=='ai' else {})
    def test_multiple_jobs_are_queued_and_executed_in_order(self):
        result=self.enqueue(kind='offers',names=('one.pdf','two.pdf','three.pdf'))
        self.assertEqual(result.status_code,202,result.json)
        ids=[j['id'] for j in result.json['jobs']]
        self.assertEqual(len(ids),3)
        self.assertEqual(len(set(ids)),3)
        stages=[]
        from flask import jsonify
        def fake_offer():
            from flask import request
            stages.append(request.files['file'].filename)
            return jsonify(id=100+len(stages)),201
        with patch('app.offers_import',side_effect=fake_offer):
            _run_import_job(ids[0])
            self.assertEqual(db.session.get(ImportJob,ids[1]).status,'Wartend')
            _run_import_job(ids[1]);_run_import_job(ids[2])
        self.assertEqual(stages,['one.pdf','two.pdf','three.pdf'])
        feed=self.client.get('/api/import-jobs')
        self.assertEqual(feed.status_code,200)
        self.assertEqual(feed.headers['Cache-Control'],'no-store')
        jobs=feed.json['jobs']
        self.assertEqual([j['status'] for j in jobs],['Fertig']*3)
        self.assertTrue(all(j['review_url'].startswith('/angebote?offer_draft=') for j in jobs))
        self.assertFalse((IMPORT_QUEUE_ROOT/db.session.get(ImportJob,ids[0]).stored_name).exists())

    def test_dismiss_single_and_all_completed_import_notifications_only(self):
        from flask import jsonify
        result=self.enqueue(kind='offers',names=('a.pdf','b.pdf','c.pdf'))
        ids=[j['id'] for j in result.json['jobs']]
        # No waiting/running job may be dismissed.
        blocked=self.client.post('/api/import-jobs/'+str(ids[1])+'/dismiss')
        self.assertEqual(blocked.status_code,409,blocked.json)
        with patch('app.offers_import',return_value=(jsonify(id=123),201)):
            _run_import_job(ids[0])
            _run_import_job(ids[2])
        self.assertEqual(self.client.get('/api/import-jobs').status_code,200)
        single=self.client.post('/api/import-jobs/'+str(ids[0])+'/dismiss')
        self.assertEqual(single.status_code,200,single.json)
        self.assertEqual(single.json['removed'],1)
        self.assertEqual(db.session.get(ImportJob,ids[0]).status,'Ausgeblendet')
        self.assertEqual([x['id'] for x in self.client.get('/api/import-jobs').json['jobs']],
                         [ids[2],ids[1]])
        all_=self.client.post('/api/import-jobs/dismiss-completed')
        self.assertEqual(all_.status_code,200,all_.json)
        self.assertEqual(all_.json['removed'],1)
        self.assertEqual([x['id'] for x in self.client.get('/api/import-jobs').json['jobs']],
                         [ids[1]])
        self.assertEqual(db.session.get(ImportJob,ids[2]).result_id,123)
        self.assertEqual(self.client.post('/api/import-jobs/999999/dismiss').status_code,404)

    def test_real_receipt_parser_runs_after_request_has_returned(self):
        r=self.enqueue(names=('bill.pdf',))
        self.assertEqual(r.status_code,202,r.json)
        job=r.json['jobs'][0]
        self.assertEqual(job['status'],'Wartend')
        with patch('app.extract_text',return_value=(
                'Rechnung\nElektroservice\nGesamtbetrag 125,00 EUR','PDF-Text')):
            _run_import_job(job['id'])
        final=self.client.get('/api/import-jobs').json['jobs'][0]
        self.assertEqual(final['status'],'Fertig',final)
        self.assertTrue(final['review_url'].startswith('/belege?receipt_id='))
        receipt=db.session.get(Receipt,final['result_id'])
        self.assertEqual(receipt.status,'Entwurf')

    def test_failed_import_retained_with_visible_reason_and_retry(self):
        r=self.enqueue(kind='offers')
        ident=r.json['jobs'][0]['id']
        from flask import jsonify
        with patch('app.offers_import',return_value=(jsonify(error='ChatGPT konnte das PDF nicht auslesen.'),422)):
            _run_import_job(ident)
        failed=self.client.get('/api/import-jobs').json['jobs'][0]
        self.assertEqual(failed['status'],'Fehler')
        self.assertIn('ChatGPT konnte',failed['error'])
        self.assertTrue((IMPORT_QUEUE_ROOT/db.session.get(ImportJob,ident).stored_name).exists())
        with patch('app._start_import_worker'):
            response=self.client.post('/api/import-jobs/'+str(ident)+'/retry',json={})
        self.assertEqual(response.status_code,202,response.json)
        self.assertEqual(response.json['job']['status'],'Wartend')

    def test_recovery_does_not_silently_repeat_ai_uploads(self):
        r=self.enqueue()
        ident=r.json['jobs'][0]['id']
        _recover_interrupted_imports()
        obj=db.session.get(ImportJob,ident)
        self.assertEqual(obj.status,'Unterbrochen')
        self.assertIn('erneut starten',obj.error)
        self.assertTrue((IMPORT_QUEUE_ROOT/obj.stored_name).exists())

    def test_invalid_batches_and_ai_without_consent_fail(self):
        self.assertEqual(self.enqueue(names=()).status_code,400)
        self.assertEqual(self.enqueue(names=('bad.exe',)).status_code,400)
        self.assertEqual(self.enqueue(names=('bad.pdf',),extra={'kind':'offers'}).status_code,202)
        resp=self.enqueue(mode='ai')
        self.assertEqual(resp.status_code,403)
        self.assertEqual(self.client.get('/api/import-jobs').status_code,200)

    def test_offer_revision_uses_serial_worker_and_returns_original_offer_link(self):
        created=self.client.post('/api/offers/manual',json={
            'vendor':'Elektrobetrieb','gross':'1190','category':'Elektro'})
        self.assertEqual(created.status_code,201,created.json)
        oid=created.json['id']
        data={'kind':'versions','analysis_mode':'local','offer_id':str(oid),
              'files':[(io.BytesIO(b'%PDF-1.4\nRevision'), 'aenderung.pdf')]}
        with patch('app._start_import_worker'):
            enqueued=self.client.post('/api/import-jobs',data=data,content_type='multipart/form-data')
        self.assertEqual(enqueued.status_code,202,enqueued.json)
        from flask import jsonify
        with patch('app.upload_offer_version',
                   return_value=(jsonify(offer_id=oid,version={'version':2}),201)) as mocked:
            _run_import_job(enqueued.json['jobs'][0]['id'])
            mocked.assert_called_once_with(oid)
        ready=self.client.get('/api/import-jobs').json['jobs'][0]
        self.assertEqual(ready['status'],'Fertig',ready)
        self.assertEqual(ready['review_url'],'/angebote?offer_draft='+str(oid))

    def test_multifile_project_docs_produce_distinct_editable_library_records(self):
        raw={'kind':'documents','analysis_mode':'local','area':'Elektrik',
             'category':'Technische Zeichnung','status':'Aktuell','tags':'Leitungsführung',
             'files':[(io.BytesIO(b'Elektroplan Erdgeschoss'),'eg.txt'),
                      (io.BytesIO(b'Elektroplan Dachgeschoss'),'dg.txt')]}
        with patch('app._start_import_worker'):
            r=self.client.post('/api/import-jobs',data=raw,content_type='multipart/form-data')
        self.assertEqual(r.status_code,202,r.json)
        for task in r.json['jobs']:_run_import_job(task['id'])
        docs=db.session.query(ProjectDocument).all()
        self.assertEqual(len(docs),2)
        self.assertEqual({d.title for d in docs},{'eg','dg'})
        self.assertTrue(all(d.area=='Elektrik' for d in docs))
        self.assertTrue(all(d.status=='Aktuell' for d in docs))


if __name__=='__main__':unittest.main()
