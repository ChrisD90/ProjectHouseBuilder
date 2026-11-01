"""Project-only backup/restore must preserve every other row and original file."""
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import sqlalchemy as sa
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b
import project_backups as backups
from multi_projects import project_context


class ProjectBackupTest(unittest.TestCase):
    def setUp(self):
        self.context=b.app.app_context();self.context.push()
        b.db.session.remove();b.db.drop_all();b.initialize()
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'app';self.root.mkdir()
        self.store=Path(self.temp.name)/'backups';self.store.mkdir()
        self.config={'folder':self.store,'keep':2,'relative_folder':str(self.store)}
        for key,value in [('ROOT',self.root),('_BACKUP_RESTORE_UPLOADS',self.root/'private'/'restore-staging')]:
            p=patch.object(b,key,value);p.start();self.addCleanup(p.stop)
        p=patch.object(b,'_backup_config',return_value=self.config);p.start();self.addCleanup(p.stop)
        self.client=b.app.test_client()
        self.other=self.client.post('/api/projects',json={'title':'Anderes Projekt'}).json['project']['id']
        self.ids={}
        for owner in (1,self.other):
            with project_context(owner):
                company=b.Contractor(name='Firma '+str(owner),trade='Sonstiges')
                loan=b.Loan(name='Kredit '+str(owner),principal=1000)
                doc=b.Document(original_name='Angebot.pdf',stored_name=f'offer-{owner}.pdf',kind='Angebot')
                receipt=b.Receipt(digest='same',original_name='Rechnung.pdf',stored_name=f'receipt-{owner}.pdf',supplier='Lieferant '+str(owner),status='Gebucht',gross_amount=100,paid_amount=20)
                b.db.session.add_all([company,loan,doc,receipt]);b.db.session.flush()
                offer=b.Offer(vendor=company.name,digest='same',filename='Angebot.pdf',document_id=doc.id,contractor_id=company.id,gross=100,status='Angebot')
                b.db.session.add(offer);b.db.session.flush()
                cost=b.CostItem(title='Kosten '+str(owner),category='Sonstiges',offer_id=offer.id,contractor_id=company.id)
                b.db.session.add(cost);b.db.session.flush();doc.cost_item_id=cost.id;receipt.cost_item_id=cost.id
                payment=b.ReceiptFinancingPayment(receipt_id=receipt.id,source='loan',loan_id=loan.id,amount=20,payment_date='2026-11-01')
                todo=b.ProjectWork(kind='todo',title='Notieren '+str(owner),body='Details',source_type='offer',source_id=offer.id)
                b.db.session.add_all([payment,todo]);b.db.session.commit()
                self.ids[owner]={'doc':doc.id,'receipt':receipt.id,'loan':loan.id,'todo':todo.id,'cost':cost.id}
                for directory,name in [('documents',doc.stored_name),('receipts',receipt.stored_name)]:
                    path=self.root/'private'/directory/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(('Original '+str(owner)+' '+directory).encode())
        (self.root/'private'/'backup-settings.json').write_text('GLOBAL SETTINGS')
        (self.root/'private'/'auth.json').write_text('GLOBAL AUTH')

    def tearDown(self):
        b.db.session.remove();b.db.drop_all();self.context.pop()

    def headers(self,owner=1):return {'X-PHB-Project':str(owner)}

    def snapshot(self,owner):
        b.db.session.remove()
        with b.db.engine.connect() as c:
            return {name:[dict(r) for r in c.execute(sa.select(table).where(table.c.project_id==owner)).mappings()] for name,table in backups.owned_tables(b.db).items()}

    def create(self,owner=1):
        response=self.client.post('/api/backup/create',headers=self.headers(owner),json={})
        self.assertEqual(response.status_code,201,response.json)
        self.assertEqual(response.json['project_id'],owner)
        return backups.selected(self.config,owner,response.json['filename'])

    def start_restore(self,path,owner=1):
        inspect=self.client.post('/api/backup/inspect',headers=self.headers(owner),json={'filename':path.name})
        self.assertEqual(inspect.status_code,200,inspect.json)
        with patch.object(b,'Thread') as worker:
            response=self.client.post('/api/backup/restore',headers=self.headers(owner),json={'ref':inspect.json['ref'],'confirmation':'BACKUP WIEDERHERSTELLEN'})
            self.assertEqual(response.status_code,202,response.json)
            self.assertEqual(self.client.get('/api/project',headers=self.headers(owner)).status_code,503)
            other=self.other if owner==1 else 1
            self.assertEqual(self.client.get('/api/project',headers=self.headers(other)).status_code,200)
            self.assertEqual(self.client.get('/api/backup/restore/status',headers=self.headers(other)).json['state'],'idle')
            values=worker.call_args.kwargs
        values['target'](*values['args'])
        return self.client.get('/api/backup/restore/status',headers=self.headers(owner)).json

    def rewrite(self,path,edit):
        with zipfile.ZipFile(path) as z:
            files={name:z.read(name) for name in z.namelist()}
        data=json.loads(files['project-data.json']);edit(data)
        files['project-data.json']=json.dumps(data).encode()
        manifest=json.loads(files['backup-manifest.json'])
        manifest['files']['project-data.json']={'bytes':len(files['project-data.json']),'sha256':hashlib.sha256(files['project-data.json']).hexdigest()}
        files['backup-manifest.json']=json.dumps(manifest).encode()
        with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:
            for name,value in files.items():z.writestr(name,value)

    def test_archives_lists_and_retention_contain_only_selected_project(self):
        other=self.create(self.other)
        for _ in range(4):path=self.create()
        with zipfile.ZipFile(path) as z:
            self.assertEqual(set(z.namelist()),{'project-data.json','backup-manifest.json','private/documents/offer-1.pdf','private/receipts/receipt-1.pdf'})
            payload=json.loads(z.read('project-data.json'))
            self.assertEqual(payload['project']['id'],1)
            self.assertTrue(all(r['project_id']==1 for rows in payload['tables'].values() for r in rows))
        self.assertTrue(other.exists())
        for owner,count in ((1,2),(self.other,1)):
            response=self.client.get('/api/backup/status',headers=self.headers(owner)).json
            self.assertEqual(response['scope'],'project');self.assertEqual(response['count'],count)
            self.assertTrue(all(x['filename'].startswith(f'PHB_Project_{owner}_') for x in response['backups']))
        self.assertEqual(self.client.post('/api/backup/inspect',json={'filename':other.name}).status_code,400)
        with other.open('rb') as f:
            self.assertEqual(self.client.post('/api/backup/inspect',data={'file':(f,'other.zip')}).status_code,400)
        self.assertEqual(self.client.post('/api/backup/create',headers=self.headers(9999),json={}).status_code,404)

    def test_restore_replaces_only_owner_and_preserves_other_project_money_and_files(self):
        path=self.create()
        expected=self.snapshot(1);other=self.snapshot(self.other)
        with project_context(1):
            row=b.db.session.get(b.ProjectWork,self.ids[1]['todo']);row.title='Nach Backup geändert'
            b.db.session.add(b.ProjectWork(title='Später hinzugefügt',kind='note'))
            b.db.session.get(b.Loan,self.ids[1]['loan']).principal=9999
            b.db.session.commit()
        # Retention prunes the selected oldest backup while creating the safety snapshot.
        self.create()
        result=self.start_restore(path)
        self.assertEqual(result['state'],'done',result)
        self.assertEqual(self.snapshot(1),expected)
        self.assertEqual(self.snapshot(self.other),other)
        self.assertEqual((self.root/f'private/receipts/receipt-{self.other}.pdf').read_bytes(),f'Original {self.other} receipts'.encode())
        self.assertEqual((self.root/'private'/'auth.json').read_text(),'GLOBAL AUTH')
        self.assertEqual(len(self.client.get('/api/projects').json['projects']),2)

    def test_second_project_worker_keeps_owner_and_does_not_default_to_first(self):
        path=self.create(self.other);expected=self.snapshot(self.other);first=self.snapshot(1)
        with project_context(self.other):
            b.db.session.get(b.Loan,self.ids[self.other]['loan']).principal=5555;b.db.session.commit()
        result=self.start_restore(path,self.other)
        self.assertEqual(result['state'],'done',result)
        self.assertEqual(self.snapshot(self.other),expected);self.assertEqual(self.snapshot(1),first)

    def test_primary_key_collision_is_rejected_even_without_a_foreign_key(self):
        path=self.create();before=self.snapshot(1);other=self.snapshot(self.other)
        category=other['category'][0]['id']
        self.rewrite(path,lambda data:data['tables']['category'][0].update({'id':category}))
        result=self.start_restore(path)
        self.assertEqual(result['state'],'failed',result)
        self.assertEqual(self.snapshot(1),before);self.assertEqual(self.snapshot(self.other),other)

    def test_cross_project_ids_and_foreign_keys_fail_before_deletion(self):
        for field in ('id','cost_item_id'):
            path=self.create();before=self.snapshot(1);other=self.snapshot(self.other)
            self.rewrite(path,lambda data:data['tables']['document'][0].update({field:self.ids[self.other]['doc' if field=='id' else 'cost']}))
            result=self.start_restore(path)
            self.assertEqual(result['state'],'failed',result)
            self.assertEqual(self.snapshot(1),before);self.assertEqual(self.snapshot(self.other),other)

    def test_file_failure_rolls_back_records_and_originals(self):
        path=self.create();before=self.snapshot(1);other=self.snapshot(self.other)
        real=Path.replace
        def fail(source,target):
            if '/incoming/' in str(source) and str(source).endswith('receipt-1.pdf'):raise OSError('synthetic write failure')
            return real(source,target)
        with patch.object(Path,'replace',fail):
            with self.assertRaises(OSError):backups.restore(path,b.db,self.root,1)
        self.assertEqual(self.snapshot(1),before);self.assertEqual(self.snapshot(self.other),other)
        self.assertEqual((self.root/'private/documents/offer-1.pdf').read_bytes(),b'Original 1 documents')
        self.assertEqual((self.root/'private/receipts/receipt-1.pdf').read_bytes(),b'Original 1 receipts')

    def test_same_basename_in_other_document_area_is_not_owned(self):
        with project_context(self.other):
            row=b.db.session.get(b.Document,self.ids[self.other]['doc']);row.stored_name='receipt-1.pdf';b.db.session.commit()
        foreign=self.root/'private/documents/receipt-1.pdf';foreign.write_bytes(b'OTHER PROJECT')
        paths=backups.files_for_project(b.db,self.root,1)
        self.assertNotIn(foreign,paths)
        path=self.create()
        with zipfile.ZipFile(path) as z:self.assertNotIn('private/documents/receipt-1.pdf',z.namelist())

    def test_required_missing_file_and_symlink_refuse_backup(self):
        file=self.root/'private/receipts/receipt-1.pdf';file.unlink()
        self.assertEqual(self.client.post('/api/backup/create',json={}).status_code,409)
        file.symlink_to(self.root/f'private/receipts/receipt-{self.other}.pdf')
        self.assertEqual(self.client.post('/api/backup/create',json={}).status_code,409)
        self.assertEqual(backups.existing(self.config,1),[])

    def test_revision_0028_project_backup_restores_without_new_empty_planning_tables(self):
        path=self.create();expected=self.snapshot(1);other=self.snapshot(self.other)
        self.rewrite(path,lambda data:[data['tables'].pop(name) for name in ('funding_plan','funding_plan_offer')])
        result=self.start_restore(path)
        self.assertEqual(result['state'],'done',result)
        self.assertEqual(self.snapshot(1),expected);self.assertEqual(self.snapshot(self.other),other)

    def test_tampered_and_full_system_archives_are_rejected(self):
        path=self.create()
        with zipfile.ZipFile(path,'a') as z:z.writestr('private/auth.json','FORBIDDEN')
        with self.assertRaises(ValueError):backups.verify(path,1)
        with zipfile.ZipFile(path,'w') as z:z.writestr('backup-manifest.json',json.dumps({'format':'projecthousebuilder-sqlite-backup','version':1}))
        response=self.client.post('/api/backup/inspect',json={'filename':path.name})
        self.assertEqual(response.status_code,400)
        self.assertIn('Systemsicherungen',response.json['error'])
