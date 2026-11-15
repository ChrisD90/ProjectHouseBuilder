import io,json,os,tempfile,unittest,zipfile,hashlib
from pathlib import Path
from unittest.mock import patch
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b
import project_backups as backups

class DocumentVersionTests(unittest.TestCase):
    def setUp(self):
        self.ctx=b.app.app_context();self.ctx.push();b.db.session.remove();b.db.drop_all();b.initialize()
        self.client=b.app.test_client();self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.docs=self.root/'private'/'project-documents';self.docs.mkdir(parents=True)
        for key,value in [('PROJECT_DOCUMENT_ROOT',self.docs),('IMPORT_QUEUE_ROOT',self.root/'private'/'import-queue')]:
            setting=patch.object(b,key,value);setting.start();self.addCleanup(setting.stop)
        response=self.client.post('/api/project-documents',data={'title':'Grundriss','category':'Bauplan','area':'Allgemein','status':'Überholt','description':'Wichtige Notiz','file':(io.BytesIO(b'Originalfassung'),'Original.txt')})
        self.assertEqual(response.status_code,201,response.json);self.id=response.json['document']['id'];self.path=f'/api/project-documents/{self.id}'
    def tearDown(self):
        b.db.session.remove();b.db.drop_all();self.ctx.pop()
    def upload(self,content=b'Neue Fassung',name='Neu.txt'):
        return self.client.post(self.path+'/versions',data={'file':(io.BytesIO(content),name)})
    def current(self):return self.client.get('/api/project-documents').json['documents'][0]
    def test_review_preserves_current_file_ids_metadata_and_immutable_history(self):
        funding=b.Funding(name='Bestehende Förderung');b.db.session.add(funding);b.db.session.flush();funding_id=funding.id
        b.db.session.add(b.FundingDocument(funding_id=funding_id,document_id=self.id));b.db.session.commit()
        original=self.current();created=self.upload();self.assertEqual(created.status_code,201,created.json)
        self.assertEqual(self.client.get(self.path+'/preview').data,b'Originalfassung')
        self.assertEqual(self.current()['current_version'],1)
        activated=self.client.post(self.path+'/versions/2/activate');self.assertEqual(activated.status_code,200,activated.json)
        self.assertIsNotNone(b.db.session.get(b.FundingDocument,(funding_id,self.id)))
        self.assertEqual(self.current()['id'],original['id']);self.assertEqual(self.current()['description'],'Wichtige Notiz')
        self.assertEqual(self.current()['current_version'],2);self.assertEqual(self.current()['status'],'Aktuell')
        self.assertEqual(self.client.get(self.path+'/preview').data,b'Neue Fassung')
        self.assertEqual(self.client.get(self.path+'/versions/1/preview').data,b'Originalfassung')
        parts,sources=b._selected_ai_document_context([self.id]);self.assertEqual(sources[0]['version'],2);self.assertIn('Neue Fassung',parts[-1]['text'])
        history=self.client.get(self.path+'/versions').json['versions'];self.assertEqual([r['state'] for r in history],['current','historical'])
        snapshot=json.loads(b.db.session.query(b.ProjectDocumentVersion).filter_by(version=1).one().snapshot_json)
        self.assertEqual(snapshot['status'],'Überholt')
        self.assertEqual(self.upload(b'Originalfassung').status_code,400)
        self.assertEqual(self.upload(b'Dritte Fassung').status_code,201)
        self.assertEqual(self.client.post(self.path+'/versions/3/discard').status_code,200)
        self.assertEqual(self.client.get(self.path+'/preview').data,b'Neue Fassung')
        self.assertEqual(self.client.get(self.path+'/versions/3/download').data,b'Dritte Fassung')
    def test_invalid_files_failed_commit_and_parallel_drafts_preserve_data(self):
        self.assertEqual(self.upload(name='bad.exe').status_code,400)
        self.assertEqual(self.upload(b'%PDF-invalid','bad.pdf').status_code,400)
        with patch.object(b.db.session,'commit',side_effect=RuntimeError('Offline')):
            self.assertEqual(self.upload().status_code,500)
        self.assertEqual(len(list(self.docs.iterdir())),1)
        self.assertEqual(self.upload().status_code,201)
        self.assertEqual(self.upload(b'Parallel').status_code,400)
        self.assertEqual(self.current()['filename'],'Original.txt')
        with patch.object(b.db.session,'commit',side_effect=RuntimeError('Offline')):
            self.assertEqual(self.client.post(self.path+'/versions/2/activate').status_code,500)
        self.assertEqual(self.current()['current_version'],1)
        self.assertEqual(self.client.get(self.path+'/preview').data,b'Originalfassung')
    def test_cross_project_access_and_stale_edits_are_rejected(self):
        before=self.client.get('/api/project-documents').json['_versions'][self.path]
        self.assertEqual(self.upload().status_code,201)
        self.assertEqual(self.client.patch(self.path,json={'title':'Stale'},headers={'If-Match':before}).status_code,409)
        other=self.client.post('/api/projects',json={'title':'Anderes Projekt'}).json['project']['id'];headers={'X-PHB-Project':str(other)}
        for endpoint in ('/versions','/versions/2/preview'):
            self.assertEqual(self.client.get(self.path+endpoint,headers=headers).status_code,404)
        self.assertEqual(self.client.post(self.path+'/versions/2/activate',headers=headers).status_code,404)
        self.assertEqual(self.current()['title'],'Grundriss')
    def test_queue_retains_pending_version_until_explicit_decision(self):
        with patch.object(b,'_start_import_worker'):
            result=self.client.post('/api/import-jobs',data={'kind':'documents','analysis_mode':'local','version_document_id':str(self.id),'files':(io.BytesIO(b'Asynchrone Version'),'Async.txt')})
        self.assertEqual(result.status_code,202,result.json);ident=result.json['jobs'][0]['id'];b._run_import_job(ident)
        jobs=self.client.get('/api/import-jobs').json['jobs'];job=next(row for row in jobs if row['id']==ident)
        self.assertEqual(job['status'],'Fertig');self.assertIn('document_version=2',job['review_url'])
        self.assertEqual(self.client.patch(self.path,json={'description':'Metadaten prüfen'}).status_code,200)
        self.assertTrue(any(row['id']==ident for row in self.client.get('/api/import-jobs').json['jobs']))
        self.assertEqual(self.client.post(self.path+'/versions/2/activate').status_code,200)
        self.assertFalse(any(row['id']==ident for row in self.client.get('/api/import-jobs').json['jobs']))
        self.assertEqual(self.current()['description'],'Metadaten prüfen')
    def test_backup_restore_and_delete_include_every_version_file(self):
        self.upload();self.client.post(self.path+'/versions/2/activate');self.upload(b'Draft retained')
        store=self.root/'backups';store.mkdir();config={'folder':store,'keep':2}
        archive=backups.create(b.db,self.root,1,config)
        self.assertEqual(self.client.delete(self.path).status_code,200)
        self.assertEqual(list(self.docs.iterdir()),[]);self.assertEqual(b.db.session.query(b.ProjectDocumentVersion).count(),0)
        backups.restore(archive,b.db,self.root,1)
        self.assertEqual(self.client.get(self.path+'/preview').data,b'Neue Fassung')
        self.assertEqual(self.client.get(self.path+'/versions/1/preview').data,b'Originalfassung')
        self.assertEqual(self.client.get(self.path+'/versions/3/preview').data,b'Draft retained')
    def test_previous_backup_without_version_table_or_column_is_accepted(self):
        store=self.root/'backups';store.mkdir();archive=backups.create(b.db,self.root,1,{'folder':store,'keep':2})
        with zipfile.ZipFile(archive) as source:contents={name:source.read(name) for name in source.namelist()}
        payload=json.loads(contents['project-data.json']);payload['tables'].pop('project_document_version')
        for row in payload['tables']['project_document']:row.pop('current_version')
        contents['project-data.json']=json.dumps(payload,ensure_ascii=False).encode();manifest=json.loads(contents['backup-manifest.json'])
        manifest['files']['project-data.json']={'bytes':len(contents['project-data.json']),'sha256':hashlib.sha256(contents['project-data.json']).hexdigest()}
        contents['backup-manifest.json']=json.dumps(manifest).encode();legacy=self.root/'legacy.zip'
        with zipfile.ZipFile(legacy,'w') as target:
            for name,raw in contents.items():target.writestr(name,raw)
        _,rows=backups.load_rows(legacy,b.db,1);self.assertEqual(rows['project_document_version'],[]);self.assertEqual(rows['project_document'][0]['current_version'],1)
