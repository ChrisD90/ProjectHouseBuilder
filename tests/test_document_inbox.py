"""Watched folders discover safely, isolate projects and dispatch into existing imports."""
import os
import io
import tempfile
import time
import unittest
from pathlib import Path
from datetime import timedelta
from unittest.mock import patch
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b
from multi_projects import project_context

class DocumentInboxTest(unittest.TestCase):
    def setUp(self):
        self.ctx=b.app.app_context();self.ctx.push();b.db.session.remove();b.db.drop_all();b.initialize()
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.folder=self.root/'input';self.folder.mkdir()
        for name,path in [('ROOT',self.root/'app'),('IMPORT_QUEUE_ROOT',self.root/'app/private/import-queue'),('RECEIPT_ROOT',self.root/'app/private/receipts'),('PROJECT_DOCUMENT_ROOT',self.root/'app/private/project-documents')]:
            stub=patch.object(b,name,path);stub.start();self.addCleanup(stub.stop)
        self.client=b.app.test_client();self.other=self.client.post('/api/projects',json={'title':'Anderes Projekt'}).json['project']['id']
    def tearDown(self):b.db.session.remove();b.db.drop_all();self.ctx.pop()
    def file(self,name='Rechnung.pdf',raw=b'%PDF-1.4\nTestdokument',stable=True):
        path=self.folder/name;path.write_bytes(raw)
        if stable:os.utime(path,(time.time()-60,time.time()-60))
        return path
    def configure(self,owner=1,**extra):
        result=self.client.post('/api/document-inbox/configure',json={'folder':str(self.folder),'interval_minutes':10,'enabled':True,**extra},headers={'X-PHB-Project':str(owner)})
        self.assertEqual(result.status_code,200,result.json);return result.json
    def status(self,owner=1):return self.client.get('/api/document-inbox',headers={'X-PHB-Project':str(owner)}).json
    def dispatch(self,item,**extra):
        with patch.object(b,'_start_import_worker'):
            return self.client.post('/api/document-inbox/items/'+str(item['id'])+'/import',json={'kind':'receipts','analysis_mode':'none','fields':{'receipt_kind':'Kassenzettel'},**extra})

    def test_discovery_dedup_rename_changes_and_stability_without_auto_upload(self):
        path=self.file();self.file('copy.pdf');self.file('ignored.exe',b'data');self.file('.hidden.pdf');self.file('empty.pdf',b'');self.file('not-finished.pdf',stable=False)
        self.configure();state=self.status();self.assertEqual(state['count'],1,state)
        self.assertEqual(b.db.session.query(b.ImportJob).count(),0)
        path.rename(self.folder/'renamed.pdf');self.client.post('/api/document-inbox/scan');self.assertEqual(self.status()['count'],1)
        self.file('changed.pdf',b'%PDF-1.4\nAnderer Inhalt');self.client.post('/api/document-inbox/scan');self.assertEqual(self.status()['count'],2)
        for source in self.folder.glob('*.pdf'):source.unlink()
        self.client.post('/api/document-inbox/scan');self.assertEqual(self.status()['count'],0)

    def test_dispatch_is_atomic_repeatable_and_uses_receipt_workflow_without_touching_source(self):
        path=self.file();self.configure();item=self.status()['items'][0]
        response=self.dispatch(item);self.assertEqual(response.status_code,202,response.json);ident=response.json['jobs'][0]['id']
        self.assertEqual(self.status()['count'],0)
        repeated=self.dispatch(item);self.assertEqual(repeated.json['jobs'][0]['id'],ident)
        self.assertEqual(b.db.session.query(b.ImportJob).count(),1);self.assertTrue(path.exists())
        b._run_import_job(ident);b.db.session.expire_all();job=b.db.session.get(b.ImportJob,ident)
        self.assertEqual(job.status,'Fertig',job.error)
        receipt=b.db.session.get(b.Receipt,job.result_id);self.assertEqual(receipt.kind,'Kassenzettel')
        self.assertIn('receipt_id=',self.status()['items'][0]['job']['review_url'])
        self.client.delete('/api/receipts/'+str(receipt.id));self.client.post('/api/document-inbox/scan')
        self.assertEqual(self.status()['count'],0);self.assertTrue(path.exists())

    def test_failed_validation_keeps_pending_and_changed_source_is_never_queued(self):
        path=self.file();self.configure();item=self.status()['items'][0]
        invalid=self.dispatch(item,kind='versions',analysis_mode='local',fields={'offer_id':99999})
        self.assertEqual(invalid.status_code,400,invalid.json);self.assertEqual(self.status()['count'],1)
        self.assertEqual(b.db.session.query(b.ImportJob).count(),0)
        self.assertEqual(list(b.IMPORT_QUEUE_ROOT.glob('*')),[])
        path.write_bytes(b'%PDF-1.4\nAndere Bytes')
        self.assertEqual(self.dispatch(item).status_code,400);self.assertEqual(b.db.session.query(b.ImportJob).count(),0)

    def test_interval_pause_errors_and_symlink_protection(self):
        self.file();outside=self.root/'outside.pdf';outside.write_bytes(b'%PDF-1.4\nsecret')
        (self.folder/'link.pdf').symlink_to(outside)
        self.configure();self.assertEqual(self.status()['count'],1)
        cfg=b.db.session.scalar(b.select(b.DocumentInboxConfig));first=cfg.last_scan
        self.file('new.pdf',b'%PDF-1.4\nnew')
        self.assertFalse(b.scan_document_inbox(now=first+timedelta(minutes=9)))
        self.assertTrue(b.scan_document_inbox(now=first+timedelta(minutes=10)));self.assertEqual(self.status()['count'],2)
        self.configure(enabled=False);self.file('paused.pdf',b'%PDF-1.4\npaused')
        self.assertFalse(b.scan_document_inbox(force=True));self.assertEqual(self.status()['count'],2)
        self.configure();self.assertEqual(self.status()['count'],3)
        moved=self.root/'moved';self.folder.rename(moved)
        self.client.post('/api/document-inbox/scan');self.assertIn('Ordner',self.status()['config']['error'])
        self.assertEqual(self.status()['count'],3)

    def test_project_scope_preview_ignored_and_same_content_in_another_project(self):
        path=self.file();self.configure();own=self.status()['items'][0]
        self.configure(self.other);foreign=self.status(self.other)['items'][0]
        self.assertNotEqual(own['id'],foreign['id'])
        self.assertEqual(self.client.get('/api/document-inbox/items/'+str(foreign['id'])+'/preview').status_code,404)
        self.assertEqual(self.dispatch(foreign).status_code,404)
        self.assertEqual(self.client.patch('/api/document-inbox/items/'+str(foreign['id']),json={'state':'ignored'}).status_code,404)
        result=self.client.get(own['preview_url']);self.assertEqual(result.data,path.read_bytes());self.assertEqual(result.headers['X-Content-Type-Options'],'nosniff')
        self.client.patch('/api/document-inbox/items/'+str(own['id']),json={'state':'ignored'})
        self.client.post('/api/document-inbox/scan');self.assertEqual(self.status()['count'],0);self.assertEqual(self.status(self.other)['count'],1)
        self.assertEqual(self.client.get('/api/document-inbox?ignored=1').json['items'][0]['state'],'ignored')
        self.client.patch('/api/document-inbox/items/'+str(own['id']),json={'state':'new'});self.assertEqual(self.status()['count'],1)

    def test_document_version_keeps_the_original_and_uses_the_existing_review(self):
        doc=self.client.post('/api/project-documents',data={'file':(io.BytesIO(b'Alter Plan'),'alt.txt'),'title':'Grundriss'}).json['document']
        self.file('neu.txt',b'Neuer Plan');self.configure();item=self.status()['items'][0]
        response=self.dispatch(item,kind='documents',analysis_mode='local',fields={'version_document_id':doc['id']})
        self.assertEqual(response.status_code,202,response.json)
        b._run_import_job(response.json['jobs'][0]['id']);b.db.session.expire_all()
        row=self.status()['items'][0];self.assertEqual(row['job']['status'],'Fertig',row)
        self.assertIn('document_version=2',row['job']['review_url'])
        self.assertEqual(b.db.session.get(b.ProjectDocument,doc['id']).current_version,1)

    def test_same_size_same_timestamp_content_change_is_detected(self):
        path=self.file(raw=b'%PDF-1.4 aaa');self.configure();before=path.stat()
        path.write_bytes(b'%PDF-1.4 bbb');os.utime(path,ns=(before.st_atime_ns,before.st_mtime_ns))
        self.client.post('/api/document-inbox/scan');self.assertEqual(self.status()['count'],1)
        old=b.db.session.scalars(b.select(b.DocumentInboxItem).order_by(b.DocumentInboxItem.id)).all()
        self.assertEqual(len(old),2);self.assertFalse(old[0].present);self.assertTrue(old[1].present)

    def test_folder_dialog_is_read_only_and_lists_directories_with_navigation(self):
        child=self.folder/'Unterordner';child.mkdir()
        (self.folder/'.versteckt').mkdir();self.file('Datei.txt',b'Text')
        (self.folder/'Verknuepfung').symlink_to(child,target_is_directory=True)
        private=b.ROOT/'private';private.mkdir(parents=True,exist_ok=True)
        (self.folder/'Interne Daten').symlink_to(private,target_is_directory=True)
        response=self.client.get('/api/document-inbox/folders',query_string={'folder':str(self.folder)})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['current'],str(self.folder))
        self.assertEqual(response.json['parent'],str(self.folder.parent))
        self.assertEqual([row['name'] for row in response.json['directories']],['Unterordner','Verknuepfung'])
        self.assertEqual(b.db.session.query(b.DocumentInboxConfig).count(),0)
        self.assertEqual(b.db.session.query(b.ImportJob).count(),0)
        self.configure()
        default=self.client.get('/api/document-inbox/folders').json
        self.assertEqual(default['current'],str(self.folder))
        self.assertTrue(default['roots'])
        self.assertEqual(self.client.get('/api/document-inbox/folders',query_string={'folder':str(child)}).json['parent'],str(self.folder))
        for bad in ('relative',str(self.folder/'Datei.txt'),str(self.folder/'missing'),str(private)):
            self.assertEqual(self.client.get('/api/document-inbox/folders',query_string={'folder':bad}).status_code,400)
        self.assertEqual(self.status()['config']['folder'],str(self.folder))

    def test_api_config_validation_and_ai_requires_explicit_connection(self):
        for changes in ({'folder':'relative'},{'interval_minutes':0},{'interval_minutes':True},{'enabled':'yes'}):
            result=self.client.post('/api/document-inbox/configure',json={'folder':str(self.folder),**changes});self.assertEqual(result.status_code,400,result.json)
        self.file();self.configure();item=self.status()['items'][0]
        result=self.dispatch(item,analysis_mode='ai',model='test',plan_only=True)
        self.assertNotEqual(result.status_code,202);self.assertEqual(b.db.session.query(b.ImportJob).count(),0)
        self.assertEqual(self.status()['count'],1)
