"""Sequential background uploads, durable job progress, retry and AI consent."""
import io
import json
import os
import unittest
from unittest.mock import patch
os.environ['DATABASE_URL']='sqlite:///:memory:'
from app import (app,db,initialize,ImportJob,Receipt,ProjectDocument,Loan,
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
    def enqueue(self,kind='receipts',names=('one.pdf',),mode='local',extra=None,content=None):
        data={'kind':kind,'analysis_mode':mode,'files':[
            (io.BytesIO(content or b'%PDF-1.4\nMinimal PDF'),filename) for filename in names
        ]}
        if mode=='ai':
            data.update(model='test-model',plan_only='true')
        data.update(extra or {})
        with patch('app._start_import_worker'):
            return self.client.post('/api/import-jobs',data=data,
                content_type='multipart/form-data',
                headers={'X-PHB-AI':'1'} if mode=='ai' else {})
    def test_funding_documents_keep_review_context_and_attach_only_after_confirmation(self):
        from app import FundingDocument
        funding=self.client.post('/api/funding',json={'name':'Fensterförderung'}).json['id']
        response=self.enqueue(kind='documents',names=('isfp.txt',),extra={'review_context':'funding','funding_id':str(funding),'area':'Allgemein','category':'iSFP'})
        self.assertEqual(response.status_code,202,response.json)
        job_id=response.json['jobs'][0]['id'];_run_import_job(job_id)
        job=db.session.get(ImportJob,job_id);self.assertEqual(job.status,'Fertig',job.error)
        doc=db.session.get(ProjectDocument,job.result_id)
        self.assertEqual(doc.area,'Energetische Planung')
        self.assertEqual(db.session.query(FundingDocument).count(),0)
        jobs=self.client.get('/api/import-jobs').json['jobs']
        result=next(x for x in jobs if x['id']==job_id)
        self.assertEqual(result['review_url'],f'/energieplanung?funding_document={doc.id}&document_funding_id={funding}')
        for _ in range(2):
            saved=self.client.patch(f'/api/project-documents/{doc.id}',json={'title':'Geprüfter iSFP','funding_id':funding})
            self.assertEqual(saved.status_code,200,saved.json)
        self.assertEqual(db.session.query(FundingDocument).count(),1)
        self.assertEqual(self.client.get('/api/energy-planning').json['funding'][0]['document_ids'],[doc.id])
        self.assertTrue(any(x['id']==doc.id for x in self.client.get('/api/project-documents').json['documents']))
        self.assertEqual(db.session.get(ImportJob,job_id).status,'Übernommen')

    def test_funding_document_queue_rejects_foreign_target_and_invalid_context(self):
        from app import Funding,Project
        from multi_projects import project_context
        other=self.client.post('/api/projects',json={'title':'Andere Baustelle'}).json['project']['id']
        with project_context(other):
            row=Funding(name='Andere Förderung');db.session.add(row);db.session.commit();ident=row.id
        for extra in ({'review_context':'funding','funding_id':str(ident)},{'review_context':'unknown'}):
            response=self.enqueue(kind='documents',names=('isfp.txt',),extra=extra)
            self.assertEqual(response.status_code,400,response.json)
        self.assertEqual(db.session.query(ImportJob).count(),0)
        response=self.enqueue(kind='documents',names=('local.txt',))
        _run_import_job(response.json['jobs'][0]['id'])
        job=db.session.get(ImportJob,response.json['jobs'][0]['id'])
        doc_id=job.result_id
        result=self.client.patch(f'/api/project-documents/{doc_id}',json={'title':'Nicht speichern','funding_id':ident})
        self.assertEqual(result.status_code,400)
        self.assertNotEqual(db.session.get(ProjectDocument,doc_id).title,'Nicht speichern')
        self.assertEqual(db.session.get(ImportJob,job.id).status,'Fertig')
        jobs=self.client.get('/api/import-jobs').json['jobs']
        self.assertEqual(next(x for x in jobs if x['id']==job.id)['review_url'],f'/dokumente?document_id={doc_id}')

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

    def test_receipts_without_analysis_keep_originals_and_never_book_or_pay(self):
        from app import ReceiptFinancingPayment
        for kind in ('Rechnung','Kassenzettel'):
            with self.subTest(kind=kind):
                # Distinct originals retain duplicate detection across both upload paths.
                queued=self.enqueue(names=(kind+'.pdf',),mode='none',extra={'receipt_kind':kind},content=b'%PDF-1.4\n'+kind.encode())
                self.assertEqual(queued.status_code,202,queued.json)
                jid=queued.json['jobs'][0]['id']
                with patch('app.extract_text',side_effect=AssertionError('OCR must not run')), patch('app._ai_receipt_guess',side_effect=AssertionError('AI must not run')):
                    _run_import_job(jid)
                job=db.session.get(ImportJob,jid)
                self.assertEqual(job.status,'Fertig',job.error)
                receipt=db.session.get(Receipt,job.result_id)
                self.assertEqual(receipt.status,'Entwurf')
                self.assertEqual(receipt.source,'Ohne Analyse')
                self.assertEqual(receipt.kind,kind)
                self.assertEqual(receipt.supplier,'')
                self.assertIsNone(receipt.gross_amount)
                self.assertEqual(receipt.paid_amount,0)
                self.assertTrue((__import__('app').RECEIPT_ROOT/receipt.stored_name).is_file())
        self.assertEqual(db.session.query(ReceiptFinancingPayment).count(),0)
        rejected=self.enqueue(kind='offers',mode='none')
        self.assertEqual(rejected.status_code,400)

    def test_recognized_till_receipt_uses_same_defaults_as_explicit_till_upload(self):
        queued=self.enqueue()
        jid=queued.json['jobs'][0]['id']
        with patch('app.extract_text',return_value=('Bauhaus GmbH\nKassenbon 123\nDatum 04.11.2026\nGesamtbetrag 119,00 EUR','PDF-Text')):
            _run_import_job(jid)
        job=db.session.get(ImportJob,jid)
        self.assertEqual(job.status,'Fertig',job.error)
        receipt=db.session.get(Receipt,job.result_id)
        self.assertEqual(receipt.kind,'Kassenzettel')
        self.assertEqual(receipt.assignment_type,'Eigenleistung')
        self.assertEqual(receipt.category,'Eigenleistungen / Material')
        self.assertEqual(receipt.billing_type,'Normal')
        self.assertEqual(receipt.due_date,'')
        self.assertEqual(receipt.status,'Entwurf')
        self.assertEqual(receipt.paid_amount,0)

    def test_till_upload_defaults_and_atomic_paid_booking_without_account(self):
        from app import ReceiptFinancingPayment
        queued=self.enqueue(extra={'receipt_kind':'Kassenzettel'})
        self.assertEqual(queued.status_code,202,queued.json)
        jid=queued.json['jobs'][0]['id']
        self.assertEqual(json.loads(db.session.get(ImportJob,jid).extra_json)['receipt_kind'],'Kassenzettel')
        with patch('app.extract_text',return_value=('OBI\nBon 1234\nGesamtbetrag 119,00 EUR','PDF-Text')):
            _run_import_job(jid)
        job=db.session.get(ImportJob,jid);self.assertEqual(job.status,'Fertig',job.error)
        rid=job.result_id;path='/api/receipts/'+str(rid)
        initial=self.client.get(path).json
        self.assertEqual(initial['kind'],'Kassenzettel');self.assertEqual(initial['assignment_type'],'Eigenleistung')
        self.assertEqual(initial['category'],'Eigenleistungen / Material');self.assertEqual(initial['paid_amount'],0)
        invalid=self.client.patch(path,json={'book_now':True,'document_date':''})
        self.assertEqual(invalid.status_code,400)
        self.assertEqual(db.session.query(ReceiptFinancingPayment).count(),0)
        self.assertEqual(self.client.get(path).json['status'],'Entwurf')
        result=self.client.patch(path,json={'supplier':'OBI','invoice_number':'BON-1234','document_date':'2026-11-03','gross_amount':119,'net_amount':100,'vat_amount':19,'book_now':True})
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(result.json['paid_amount'],119);self.assertEqual(result.json['payment_assignment'],'Nicht zugewiesen')
        payments=list(db.session.scalars(db.select(ReceiptFinancingPayment).where(ReceiptFinancingPayment.receipt_id==rid)))
        self.assertEqual(len(payments),1);self.assertEqual(payments[0].source,'unassigned');self.assertEqual(payments[0].payment_date,'2026-11-03')
        self.assertEqual(self.client.post(path+'/book').status_code,200)
        self.assertEqual(db.session.query(ReceiptFinancingPayment).count(),1)
        preview=self.client.get(path+'/cancel-preview').json
        cancelled=self.client.post(path+'/cancel',json={'confirm':True,'plan_digest':preview['plan_digest']})
        self.assertEqual(cancelled.status_code,200,cancelled.json)
        self.assertEqual(self.client.get(path).json['paid_amount'],0)
        self.assertEqual(db.session.query(ReceiptFinancingPayment).count(),0)
        reversal=self.client.get(path+'/cancel-reversal-preview').json
        restored=self.client.post(path+'/cancel-reversal',json={'confirm':True,'plan_digest':reversal['plan_digest']})
        self.assertEqual(restored.status_code,200,restored.json)
        self.assertEqual(self.client.get(path).json['paid_amount'],119)
        self.assertEqual(db.session.query(ReceiptFinancingPayment).count(),1)

    def test_invoice_booking_keeps_payment_step_and_till_type_is_validated(self):
        r=Receipt(digest='normal-invoice',original_name='Rechnung.pdf',stored_name='normal.pdf',supplier='Firma',document_date='2026-11-03',gross_amount=50,status='Entwurf',kind='Rechnung',assignment_type='Eigenleistung')
        db.session.add(r);db.session.commit()
        response=self.client.post('/api/receipts/'+str(r.id)+'/book')
        self.assertEqual(response.status_code,200,response.json);self.assertEqual(response.json['paid_amount'],0)
        self.assertEqual(self.enqueue(extra={'receipt_kind':'Unbekannt'}).status_code,400)
        with patch('app.extract_text',return_value=('Gutschrift','PDF-Text')),patch('app.parse_receipt',return_value={'kind':'Gutschrift','warnings':[]}):
            rejected=self.client.post('/api/receipts',data={'receipt_kind':'Kassenzettel','file':(io.BytesIO(b'%PDF-1.4\nCredit'),'retoure.pdf')})
        self.assertEqual(rejected.status_code,400,rejected.json)

    def test_till_financing_default_override_limits_and_project_boundaries(self):
        from app import ReceiptFinancingPayment
        first=self.client.post('/api/financing/equity',json={'name':'Konto A','opening_balance':100,'reserve':20}).json['id']
        second=self.client.post('/api/financing/equity',json={'name':'Konto B','opening_balance':200,'reserve':0}).json['id']
        def receipt(code,amount):
            row=Receipt(digest=code,original_name=code+'.pdf',stored_name=code+'.pdf',kind='Kassenzettel',assignment_type='Eigenleistung',status='Entwurf',supplier='Baumarkt',document_date='2026-11-03',gross_amount=amount)
            db.session.add(row);db.session.commit();return row.id
        rid=receipt('default-equity',30)
        default=self.client.post('/api/receipts/'+str(rid)+'/book')
        self.assertEqual(default.status_code,200,default.json)
        payment=db.session.scalar(db.select(ReceiptFinancingPayment).where(ReceiptFinancingPayment.receipt_id==rid))
        self.assertEqual(payment.equity_id,first)
        chosen=receipt('chosen-equity',50)
        saved=self.client.patch('/api/receipts/'+str(chosen),json={'book_now':True,'till_financing':{'source':'equity','equity_id':second}})
        self.assertEqual(saved.status_code,200,saved.json)
        payment=db.session.scalar(db.select(ReceiptFinancingPayment).where(ReceiptFinancingPayment.receipt_id==chosen))
        self.assertEqual(payment.equity_id,second)
        failed=receipt('too-much',80)
        response=self.client.patch('/api/receipts/'+str(failed),json={'book_now':True,'till_financing':{'source':'equity','equity_id':first}})
        self.assertEqual(response.status_code,400,response.json)
        self.assertEqual(self.client.get('/api/receipts/'+str(failed)).json['status'],'Entwurf')
        self.assertEqual(self.client.get('/api/receipts/'+str(failed)).json['paid_amount'],0)
        other=self.client.post('/api/projects',json={'title':'Anderes Projekt'}).json['project']['id']
        foreign=self.client.post('/api/financing/equity',headers={'X-PHB-Project':str(other)},json={'name':'Fremdes Konto','opening_balance':500,'reserve':0}).json['id']
        denied=self.client.patch('/api/receipts/'+str(failed),json={'book_now':True,'till_financing':{'source':'equity','equity_id':foreign}})
        self.assertEqual(denied.status_code,400,denied.json)
        deferred=self.client.patch('/api/receipts/'+str(failed),json={'book_now':True,'till_financing':{'source':'unassigned'}})
        self.assertEqual(deferred.status_code,200,deferred.json)
        payment=db.session.scalar(db.select(ReceiptFinancingPayment).where(ReceiptFinancingPayment.receipt_id==failed))
        self.assertEqual(payment.source,'unassigned');self.assertIsNone(payment.equity_id)
        balances=self.client.get('/api/financing').json['equity']
        self.assertEqual(next(x for x in balances if x['id']==first)['balance']['available'],70)
        self.assertEqual(next(x for x in balances if x['id']==second)['balance']['available'],150)

    def test_till_credit_requires_confirmed_available_funds(self):
        from app import ReceiptFinancingPayment
        loan=self.client.post('/api/financing/loans',json={'name':'Kredit','principal':500,'interest_rate':3,'monthly_payment':10,'initial_repayment_rate':2,'extra_repayment_pct':0}).json['id']
        row=Receipt(digest='credit-bon',original_name='bon.pdf',stored_name='credit-bon.pdf',kind='Kassenzettel',assignment_type='Eigenleistung',status='Entwurf',supplier='Baumarkt',document_date='2026-11-03',gross_amount=50)
        db.session.add(row);db.session.commit();rid=row.id
        path='/api/receipts/'+str(rid)
        body={'book_now':True,'till_financing':{'source':'loan','loan_id':loan}}
        self.assertEqual(self.client.patch(path,json=body).status_code,400)
        self.assertEqual(self.client.get(path).json['paid_amount'],0)
        event=self.client.post('/api/financing/events',json={'kind':'loan_drawdown','amount':100,'loan_id':loan,'event_date':'2026-11-03'})
        self.assertEqual(event.status_code,201,event.json)
        result=self.client.patch(path,json=body);self.assertEqual(result.status_code,200,result.json)
        payment=db.session.scalar(db.select(ReceiptFinancingPayment).where(ReceiptFinancingPayment.receipt_id==rid))
        self.assertEqual(payment.loan_id,loan);self.assertEqual(payment.source,'loan')

    def test_till_source_also_applies_to_an_already_paid_draft(self):
        from app import ReceiptFinancingPayment
        account=self.client.post('/api/financing/equity',json={'name':'Baukonto','opening_balance':1000,'reserve':0}).json['id']
        row=Receipt(digest='paid-draft',original_name='bon.pdf',stored_name='paid-draft.pdf',kind='Kassenzettel',assignment_type='Eigenleistung',status='Entwurf',supplier='Baumarkt',document_date='2026-11-03',gross_amount=119,paid_amount=119)
        db.session.add(row);db.session.commit();rid=row.id
        result=self.client.patch('/api/receipts/'+str(rid),json={'book_now':True,'till_financing':{'source':'equity','equity_id':account}})
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(result.json['payment_assignment'],'Zugewiesen')
        payments=list(db.session.scalars(db.select(ReceiptFinancingPayment).where(ReceiptFinancingPayment.receipt_id==rid)))
        self.assertEqual(len(payments),1);self.assertEqual(payments[0].equity_id,account)
        self.assertEqual(result.json['paid_amount'],119)
        for index,(paid,recorded) in enumerate([(119,119),(40,40),(40,0)]):
            row=Receipt(digest='paid-draft-'+str(index),original_name='bon.pdf',stored_name='paid-draft-'+str(index)+'.pdf',kind='Kassenzettel',assignment_type='Eigenleistung',status='Entwurf',supplier='Baumarkt',document_date='2026-11-03',gross_amount=119,paid_amount=paid)
            db.session.add(row);db.session.flush();ident=row.id
            old=None
            if recorded:
                old=ReceiptFinancingPayment(receipt_id=ident,source='unassigned',amount=recorded,payment_date='2026-11-03')
                db.session.add(old);db.session.flush()
            old_id=old.id if old else None;db.session.commit()
            response=self.client.post('/api/receipts/'+str(ident)+'/book-till',json={'kind':'Kassenzettel','till_financing':{'source':'equity','equity_id':account}})
            self.assertEqual(response.status_code,200,response.json)
            self.assertEqual(response.json['payment_assignment'],'Zugewiesen');self.assertEqual(response.json['paid_amount'],119)
            entries=list(db.session.scalars(db.select(ReceiptFinancingPayment).where(ReceiptFinancingPayment.receipt_id==ident)))
            self.assertEqual(sum(float(p.amount) for p in entries),119)
            self.assertTrue(all(p.equity_id==account for p in entries))
            if old_id:self.assertIn(old_id,[p.id for p in entries])

    def test_self_work_receipt_context_survives_background_processing(self):
        from app import Task,SelfWorkReceipt
        task=Task(code='DIY',name='Malerarbeiten',trade='Sonstiges',execution_type='Eigenleistung')
        db.session.add(task);db.session.commit()
        plan=self.client.post('/api/self-work',json={'title':'Zimmer streichen','location':'OG','task_id':task.id}).json['plan']
        plan_path='/api/self-work/'+str(plan['id'])
        old_version=self.client.get(plan_path).json['_versions'][plan_path]
        response=self.enqueue(extra={'self_work_id':str(plan['id'])})
        self.assertEqual(response.status_code,202,response.json)
        ident=response.json['jobs'][0]['id']
        self.assertEqual(json.loads(db.session.get(ImportJob,ident).extra_json)['self_work_id'],plan['id'])
        with patch('app.extract_text',return_value=('Rechnung\nBaumarkt\nGesamtbetrag 125,00 EUR','PDF-Text')):
            _run_import_job(ident)
        job=db.session.get(ImportJob,ident);self.assertEqual(job.status,'Fertig',job.error)
        receipt=db.session.get(Receipt,job.result_id)
        self.assertEqual(receipt.assignment_type,'Eigenleistung');self.assertEqual(receipt.trade,'Sonstiges')
        self.assertEqual(receipt.category,'Sonstiges');self.assertEqual(receipt.status,'Entwurf')
        self.assertIn('Zimmer streichen',receipt.notes);self.assertIn('OG',receipt.notes)
        link=db.session.scalar(db.select(SelfWorkReceipt).where(SelfWorkReceipt.receipt_id==receipt.id))
        self.assertEqual(link.plan_id,plan['id'])
        stale=self.client.patch(plan_path,json={'notes':'Veralteter Tab','receipt_ids':[]},headers={'If-Match':old_version})
        self.assertEqual(stale.status_code,409,stale.json)
        self.assertEqual(self.client.get('/api/self-work/'+str(plan['id'])).json['plan']['actual_cost'],0)
        other=self.client.post('/api/projects',json={'title':'Fremdes Projekt'}).json['project']['id']
        with patch('app._start_import_worker'):
            denied=self.client.post('/api/import-jobs',headers={'X-PHB-Project':str(other)},data={'kind':'receipts','self_work_id':str(plan['id']),'files':[(io.BytesIO(b'%PDF-1.4\nForeign'),'foreign.pdf')]})
        self.assertEqual(denied.status_code,400,denied.json)

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
        running=db.session.get(ImportJob,ident);running.status='Läuft';running.lease_owner='expired-worker';running.lease_until=None;db.session.commit()
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

    def test_loan_scan_is_durable_but_does_not_create_financing_until_reviewed_save(self):
        from flask import jsonify
        with patch('app._ai_request_required'):
            result=self.enqueue(kind='loans',mode='ai',extra={'loan_values':json.dumps({'name':'Eigene Bezeichnung'}),'overwrite':'false'})
        self.assertEqual(result.status_code,202,result.json)
        jid=result.json['jobs'][0]['id']
        self.assertEqual(self.client.get(f'/api/import-jobs/{jid}/loan-review').status_code,409)
        with patch.dict(app.view_functions,{'loan_ai_extract':lambda:jsonify(fields={'principal':100000,'interest_rate':3.5},warnings=['Vertrag prüfen'])}):
            _run_import_job(jid)
        self.assertEqual(db.session.query(Loan).count(),0)
        review=self.client.get(f'/api/import-jobs/{jid}/loan-review')
        self.assertEqual(review.status_code,200,review.json)
        self.assertEqual(review.json['fields']['principal'],100000)
        self.assertEqual(review.json['values']['name'],'Eigene Bezeichnung')
        job=self.client.get('/api/import-jobs').json['jobs'][0]
        self.assertEqual(job['review_url'],f'/finanzierung?loan_scan={jid}')
        bad=self.client.post('/api/financing/loans',json={'name':'Bad','principal':0,'scan_job_id':jid})
        self.assertEqual(bad.status_code,400)
        self.assertEqual(db.session.get(ImportJob,jid).status,'Fertig')
        fields={'name':'Geprüfter Kredit','principal':100000,'interest_rate':3.5,'monthly_payment':500,'scan_job_id':jid}
        saved=self.client.post('/api/financing/loans',json=fields)
        self.assertEqual(saved.status_code,201,saved.json)
        self.assertEqual(db.session.get(ImportJob,jid).status,'Übernommen')
        again=self.client.get(f'/api/import-jobs/{jid}/loan-review').json
        self.assertTrue(again['reviewed']);self.assertEqual(again['loan_id'],saved.json['id'])
        self.assertEqual(self.client.post('/api/financing/loans',json=fields).status_code,400)
        self.assertEqual(db.session.query(Loan).count(),1)

    def test_loan_scan_requires_ai_permission_and_valid_context(self):
        self.assertEqual(self.enqueue(kind='loans',mode='local').status_code,400)
        self.assertEqual(self.enqueue(kind='loans',mode='ai').status_code,403)
        with patch('app._ai_request_required'):
            self.assertEqual(self.enqueue(kind='loans',mode='ai',names=('one.pdf','two.pdf')).status_code,400)
            self.assertEqual(self.enqueue(kind='loans',mode='ai',extra={'loan_id':'9999'}).status_code,400)
            self.assertEqual(self.enqueue(kind='loans',mode='ai',extra={'loan_values':'[]'}).status_code,400)
            self.assertEqual(self.enqueue(kind='loans',mode='ai',extra={'loan_values':'{"unexpected":1}'}).status_code,400)

    def test_existing_loan_scan_cannot_be_saved_on_another_loan(self):
        from flask import jsonify
        first=self.client.post('/api/financing/loans',json={'name':'First','principal':500}).json['id']
        second=self.client.post('/api/financing/loans',json={'name':'Second','principal':500}).json['id']
        with patch('app._ai_request_required'):
            result=self.enqueue(kind='loans',mode='ai',extra={'loan_id':str(first)})
        jid=result.json['jobs'][0]['id']
        with patch.dict(app.view_functions,{'loan_ai_extract':lambda:jsonify(fields={'principal':700},warnings=[])}):_run_import_job(jid)
        invalid=self.client.patch(f'/api/financing/loans/{second}',json={'principal':700,'scan_job_id':jid})
        self.assertEqual(invalid.status_code,400,invalid.json)
        self.assertEqual(float(db.session.get(Loan,second).principal),500)
        self.assertEqual(self.client.patch(f'/api/financing/loans/{first}',json={'principal':700,'scan_job_id':jid}).status_code,200)

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
