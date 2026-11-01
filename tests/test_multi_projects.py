"""A project boundary must cover lists, identity-map hits, links, jobs and originals."""
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as backend
from app import app,db,initialize,Project,Setting,Task,BuildPhase,Contractor,Receipt,Offer,ImportJob,ProjectDocument,Category,CostItem,ProjectWork
from multi_projects import project_context,all_projects

class MultiProjectsTest(unittest.TestCase):
    def setUp(self):
        self.context=app.app_context();self.context.push()
        db.session.remove();db.drop_all();initialize();self.client=app.test_client()
        response=self.client.post('/api/projects',json={'title':'Garten','kind':'Garten','start_date':'2027-04-01'})
        self.assertEqual(response.status_code,201,response.json);self.other=response.json['project']['id']
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        p=patch.object(backend,'PROJECT_DOCUMENT_ROOT',Path(self.temp.name));p.start();self.addCleanup(p.stop)

    def tearDown(self):
        db.session.remove();db.drop_all();self.context.pop()

    def headers(self,ident=None):return {'X-PHB-Project':str(ident or self.other)}

    def offer(self,project=1):
        result=self.client.post('/api/offers/manual',json={'vendor':'Firma '+str(project),'gross':1000,'category':'Sonstiges'},headers=self.headers(project))
        self.assertEqual(result.status_code,201,result.json);return result.json['id']

    def test_empty_creation_settings_and_defaults_are_independent(self):
        with project_context(self.other):
            self.assertEqual(db.session.get(Setting,'start').value,'2027-04-01')
            self.assertEqual(db.session.query(Task).count(),0)
            self.assertEqual(db.session.query(Contractor).count(),0)
            self.assertGreater(db.session.query(Category).count(),0)
        self.assertEqual(db.session.get(Setting,'start').value,'2027-03-01')
        self.assertEqual(len(self.client.get('/api/projects').json['projects']),2)
        self.assertEqual(self.client.patch('/api/projects/'+str(self.other),json={'title':'Neuer Garten'}).status_code,200)
        self.assertEqual(self.client.get('/api/projects/'+str(self.other)).json['project']['title'],'Neuer Garten')

    def test_lists_projections_totals_and_identity_map_do_not_cross_projects(self):
        first=self.offer(1);second=self.offer(self.other)
        cached=db.session.get(Offer,first)
        db.session.expire(cached)
        with project_context(self.other):
            self.assertIsNone(db.session.get(Offer,first))
            self.assertEqual(db.session.scalars(db.select(Offer.id)).all(),[second])
            self.assertEqual(db.session.query(Offer).count(),1)
        self.assertEqual(cached.project_id,1)
        for project,identifier in ((1,first),(self.other,second),(1,first)):
            response=self.client.get('/api/offers',headers=self.headers(project))
            self.assertEqual([x['id'] for x in response.json['offers']],[identifier])
        self.assertEqual(self.client.patch('/api/offers/'+str(first)+'/draft',json={'notes':'Wrong'},headers=self.headers()).status_code,404)
        self.assertEqual(db.session.get(Offer,first).notes,'')
        self.client.post(f'/api/offers/{second}/accept',data={'mode':'offer','confirm':'true'},headers=self.headers())
        self.assertEqual(self.client.get('/api/costs').json['summary']['planned'],0)
        self.assertEqual(self.client.get('/api/costs',headers=self.headers()).json['summary']['planned'],1000)

    def test_identifiers_and_duplicate_detection_are_per_project(self):
        for project in (1,self.other):
            with project_context(project):
                db.session.add(Task(code='AP-001',name='Eigenes Paket'))
                db.session.add(BuildPhase(title='Vorbereitung',start_date=backend.date(2027,4,1)))
                db.session.add(Receipt(digest='same-file',original_name='Rechnung.pdf',stored_name=f'{project}-file.pdf'))
                db.session.commit()
        self.assertEqual(db.session.query(Task).count(),1)
        with project_context(self.other):self.assertEqual(db.session.query(Receipt).count(),1)

    def test_cross_project_links_and_reassigning_ownership_are_refused(self):
        offer=self.offer(1)
        result=self.client.post('/api/funding',json={'name':'Falsch','offer_id':offer},headers=self.headers())
        self.assertEqual(result.status_code,400,result.json)
        result=self.client.post('/api/project-work',json={'title':'Falsche Quelle','source_type':'offer','source_id':offer},headers=self.headers())
        self.assertEqual(result.status_code,400,result.json)
        item=db.session.get(Offer,offer)
        with project_context(self.other):
            item.project_id=self.other
            with self.assertRaises(ValueError):db.session.flush()
            db.session.rollback()
        self.assertEqual(db.session.get(Offer,offer).project_id,1)
        with self.assertRaises(ValueError):db.session.execute(db.update(Offer).where(Offer.id==offer).values(project_id=self.other))
        db.session.rollback()

    def test_core_and_orm_bulk_delete_only_current_project(self):
        for project in (1,self.other):
            with project_context(project):db.session.add(ProjectWork(title='Erhalten '+str(project)));db.session.commit()
        with project_context(self.other):
            db.session.execute(ProjectWork.__table__.delete());db.session.commit()
            self.assertEqual(db.session.query(ProjectWork).count(),0)
        self.assertEqual(db.session.query(ProjectWork).count(),1)
        with project_context(self.other):db.session.query(ProjectWork).delete();db.session.commit()
        self.assertEqual(db.session.query(ProjectWork).count(),1)

    def test_document_upload_preview_and_library_urls_have_owner_context(self):
        ids=[]
        for project in (1,self.other):
            response=self.client.post('/api/project-documents',headers=self.headers(project),data={'file':(io.BytesIO(b'Same content'),'isfp.txt'),'title':'Projekt '+str(project),'area':'Energetische Planung'})
            self.assertEqual(response.status_code,201,response.json);ids.append(response.json['document']['id'])
        self.assertEqual(self.client.get(f'/api/project-documents/{ids[1]}/preview').status_code,404)
        response=self.client.get(f'/api/project-documents/{ids[1]}/preview?project_id={self.other}')
        self.assertEqual(response.status_code,200);self.assertEqual(response.data,b'Same content');response.close()
        library=self.client.get('/api/document-library',headers=self.headers()).json['documents']
        self.assertEqual(len(library),1);self.assertIn('project_id='+str(self.other),library[0]['view_url'])
        self.assertEqual(self.client.delete(f'/api/project-documents/{ids[0]}',headers=self.headers()).status_code,404)

    def test_queued_import_keeps_owner_even_after_browser_switch(self):
        from queue import Queue
        with patch.object(backend,'_import_queue',Queue()),patch.object(backend,'_import_recovery_done',True),patch.object(backend,'_start_import_worker'),patch.object(backend,'IMPORT_QUEUE_ROOT',Path(self.temp.name)/'queue'):
            result=self.client.post('/api/import-jobs',headers=self.headers(),data={'kind':'documents','analysis_mode':'local','files':(io.BytesIO(b'Background garden document'),'garden.txt')})
            self.assertEqual(result.status_code,202,result.json);ident=result.json['jobs'][0]['id']
            self.assertEqual(self.client.get('/api/import-jobs').json['jobs'],[])
            # The worker is deliberately invoked while the caller is in project one.
            backend._run_import_job(ident)
            self.assertEqual(db.session.query(ProjectDocument).count(),0)
            with project_context(self.other):
                job=db.session.get(ImportJob,ident)
                self.assertEqual(job.status,'Fertig',job.error)
                self.assertEqual(db.session.get(ProjectDocument,job.result_id).project_id,self.other)
            self.assertEqual(self.client.get('/api/import-jobs/'+str(ident)+'/loan-review').status_code,404)

    def test_ids_are_not_reused_and_api_like_notes_remain_verbatim(self):
        first=self.offer(self.other)
        self.client.delete('/api/offers/'+str(first),headers=self.headers())
        second=self.offer(self.other)
        self.assertNotEqual(first,second)
        response=self.client.post('/api/project-work',headers=self.headers(),json={'title':'API-Notiz','body':'/api/example?keep=original'})
        self.assertEqual(response.status_code,201,response.json)
        self.assertEqual(response.json['item']['body'],'/api/example?keep=original')

    def test_planning_conversations_remain_independent_with_the_same_browser_cookie(self):
        import json
        second=self.client.application.test_client()
        cookie=self.client.get_cookie('session')
        second.set_cookie('session',cookie.value)
        answer=json.dumps({'answer':'Bitte den Umfang klären.','questions':['Welche Arbeiten sind geplant?'],'ready':False,'summary':'Vorhaben abgrenzen'})
        def headers(owner):return {'X-PHB-AI':'1','X-PHB-Project':str(owner)}
        with patch.object(backend.chatgpt,'status',return_value={'sharing':True,'credits_acknowledged':True}),patch.object(backend.chatgpt,'run',return_value=answer) as run:
            a=self.client.post('/api/ai/schedule/intake',headers=headers(1),json={'message':'Dach sanieren','plan_only':True})
            b=second.post('/api/ai/schedule/intake',headers=headers(self.other),json={'message':'Garten planen','plan_only':True})
            self.assertEqual(a.status_code,200,a.json);self.assertEqual(b.status_code,200,b.json)
            self.assertEqual(json.loads(run.call_args.args[0])['project']['kind'],'Garten')
            # Both clients deliberately retain their original cookie snapshot.
            own_a=second.get('/api/ai/schedule/intake',headers=headers(1)).json
            own_b=self.client.get('/api/ai/schedule/intake',headers=headers(self.other)).json
            self.assertEqual(own_a['turns'][0]['request'],'Dach sanieren')
            self.assertEqual(own_b['turns'][0]['request'],'Garten planen')
            reset=second.post('/api/ai/schedule/intake/reset',headers=headers(1),json={})
            self.assertEqual(reset.status_code,200,reset.json)
            self.assertEqual(len(self.client.get('/api/ai/schedule/intake',headers=headers(self.other)).json['turns']),1)
            self.assertEqual(self.client.get('/api/ai/schedule/intake',headers=headers(1)).json['turns'],[])

    def test_first_nas_migration_creates_verified_backup_without_overwriting_settings(self):
        import server_backups
        folder=Path(self.temp.name)/'mount';folder.mkdir()
        settings=Path(self.temp.name)/'not-configured.json';archive=folder/'test.zip'
        with patch.object(backend,'_backup_pg',return_value=True),patch.object(server_backups,'STORAGE_ROOT',folder),patch.object(server_backups,'SETTINGS',settings),patch.object(server_backups,'create',return_value=archive) as create,patch.object(server_backups,'verify',return_value={}) as verify:
            self.assertEqual(backend._backup_before_project_upgrade(),archive)
            verify.assert_called_once_with(archive)
            self.assertTrue((folder/'migration-safety').is_dir())
            self.assertEqual(create.call_args.kwargs['folder'],folder/'migration-safety')
            self.assertFalse(settings.exists())

    def test_runtime_schema_change_does_not_start_when_backup_fails(self):
        inspector=type('LegacyInspector',(),{'has_table':lambda self,name:True,'get_columns':lambda self,name:[{'name':'id'}]})()
        with patch.object(backend,'sa_inspect',return_value=inspector),patch.object(backend,'_backup_before_project_upgrade',side_effect=ValueError('Backup fehlgeschlagen')),patch.object(db,'create_all') as create:
            with self.assertRaisesRegex(ValueError,'Backup fehlgeschlagen'):initialize()
            create.assert_not_called()

    def test_oauth_returns_to_the_project_that_started_connection(self):
        with patch.object(backend.chatgpt,'begin',return_value='https://example.invalid/auth'),patch.object(backend.chatgpt,'finish',return_value={'sharing':True}):
            response=self.client.post('/api/ai/connect',json={},headers={'X-PHB-AI':'1',**self.headers()},base_url='http://127.0.0.1:5055')
            self.assertEqual(response.status_code,200,response.json)
            result=self.client.get('/auth/callback?code=test&state=test',base_url='http://127.0.0.1:5055')
            self.assertEqual(result.location,f'/p/{self.other}/angebote?ai=connected')

    def test_invalid_and_unknown_context_never_falls_back_to_project_one(self):
        self.offer(1)
        for raw in ('','0','-1','bad','99999999'):
            response=self.client.get('/api/offers',headers={'X-PHB-Project':raw})
            self.assertIn(response.status_code,(400,404));self.assertNotIn('offers',response.json)
        with patch.object(backend.chatgpt,'run') as run:
            response=self.client.post('/api/ai/schedule/intake',headers={'X-PHB-Project':'999999','X-PHB-AI':'1'},json={'message':'Nicht starten','plan_only':True})
            self.assertEqual(response.status_code,404,response.json);run.assert_not_called()
        for path in ('/','/p/1/','/p/'+str(self.other)+'/kosten'):
            response=self.client.get(path);self.assertEqual(response.status_code,200);response.close()

class MultiProjectFilesTest(unittest.TestCase):
    def test_project_archive_and_reset_preserve_other_project_and_global_backup(self):
        import subprocess,sys
        script=r'''
import io,json,os,sqlite3,tempfile,zipfile
from pathlib import Path
import app as b
import backup_manager as backup
import schema_manager
root=Path(os.environ['PHB_PROJECT_TEST_ROOT']);root.mkdir(parents=True,exist_ok=True)
b.ROOT=root;b.PROJECT_DOCUMENT_ROOT=root/'private'/'project-documents'
backup.ROOT=root;backup.CONFIG_PATH=root/'backup-config.json'
backup_folder=root.parent/(root.name+'-backups');backup_folder.mkdir()
backup.configure(str(backup_folder))
schema_manager.upgrade_database()
with b.app.app_context():
 b.initialize();c=b.app.test_client()
 pid=c.post('/api/projects',json={'title':'Garten'}).json['project']['id']
 docs=[]
 for owner in (1,pid):
  r=c.post('/api/project-documents',headers={'X-PHB-Project':str(owner)},data={'file':(io.BytesIO(('Owner '+str(owner)).encode()),'owner.txt')})
  assert r.status_code==201,r.json
  from multi_projects import project_context
  with project_context(owner):
   obj=b.db.session.get(b.ProjectDocument,r.json['document']['id']);docs.append((obj.id,obj.stored_name))
 export=c.get('/api/project-archive.zip',headers={'X-PHB-Project':str(pid)})
 assert export.status_code==200,export.data[:100]
 with zipfile.ZipFile(io.BytesIO(export.data)) as archive:
  names=archive.namelist()
  assert any(docs[1][1] in name for name in names),names
  assert not any(docs[0][1] in name for name in names),names
  assert json.loads(archive.read('export.json'))['project_id']==pid
  snapshot=root/'export.db';snapshot.write_bytes(archive.read('sanierung.db'))
 with sqlite3.connect(snapshot) as snap:
  assert snap.execute('SELECT id FROM project').fetchall()==[(pid,)]
  assert snap.execute('SELECT project_id FROM project_document').fetchall()==[(pid,)]
 result=c.post('/api/data/reset',json={'confirmation':'ALLE DATEN LÖSCHEN'},headers={'X-PHB-Reset':'1','X-PHB-Project':str(pid)})
 assert result.status_code==200,result.json
 assert len(c.get('/api/project-documents').json['documents'])==1
 assert c.get('/api/project-documents',headers={'X-PHB-Project':str(pid)}).json['documents']==[]
 assert (b.PROJECT_DOCUMENT_ROOT/docs[0][1]).is_file()
 assert not (b.PROJECT_DOCUMENT_ROOT/docs[1][1]).exists()
 assert len(c.get('/api/projects').json['projects'])==2
 manifest=backup.verify_backup(Path(result.json['backup']))
 assert 'private/project-documents/'+docs[0][1] in manifest['files']
 assert 'private/project-documents/'+docs[1][1] in manifest['files']
 print('PASS project-specific export/reset and complete global backup')
'''
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'app';root.mkdir()
            env=os.environ.copy();env.update(DATABASE_URL='sqlite:///'+str(root/'data.db'),PHB_PROJECT_TEST_ROOT=str(root),PHB_CHATGPT_HOME=directory+'/profile')
            env.pop('APP_PASSWORD',None)
            result=subprocess.run([sys.executable,'-c',script],cwd=Path(__file__).resolve().parents[1],env=env,capture_output=True,text=True,timeout=60)
            self.assertEqual(result.returncode,0,result.stderr+'\n'+result.stdout)
