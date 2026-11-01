"""Deleting a project is restricted to an empty shell, never another project's data."""
import os
import unittest
from datetime import datetime
from unittest.mock import patch
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b
from multi_projects import project_context


class ProjectLifecycleTest(unittest.TestCase):
    def setUp(self):
        self.context=b.app.app_context();self.context.push()
        b.db.session.remove();b.db.drop_all();b.initialize()
        self.client=b.app.test_client()

    def tearDown(self):
        b.db.session.remove();b.db.drop_all();self.context.pop()

    def info(self,owner=1):
        response=self.client.get(f'/api/projects/{owner}')
        self.assertEqual(response.status_code,200,response.json)
        return response.json['project']

    def remove(self,owner=1,**body):
        return self.client.delete(f'/api/projects/{owner}',json={'confirmed':True,'confirmation':self.info(owner)['title'],**body})

    def test_legacy_default_category_order_does_not_block_empty_project(self):
        for category in b.db.session.query(b.Category):category.sort_order=0
        b.db.session.commit()
        self.assertTrue(self.info()['can_delete'])
        self.assertEqual(self.remove().status_code,200)

    def test_archive_column_upgrade_preserves_existing_registry(self):
        import sqlalchemy as sa
        from project_lifecycle import ensure_project_lifecycle_schema
        engine=sa.create_engine('sqlite:///:memory:')
        with engine.begin() as connection:
            connection.execute(sa.text('CREATE TABLE project (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL)'))
            connection.execute(sa.text("INSERT INTO project (id,title) VALUES (17,'Bestehendes Projekt')"))
            ensure_project_lifecycle_schema(connection)
            ensure_project_lifecycle_schema(connection)
            self.assertEqual(connection.execute(sa.text('SELECT id,title,archived_at FROM project')).all(),[(17,'Bestehendes Projekt',None)])
        engine.dispose()

    def test_delete_requires_exact_confirmation_and_never_reuses_id(self):
        self.assertTrue(self.info()['can_delete'])
        for body in ({},{'confirmed':True},{'confirmation':self.info()['title']},{'confirmed':True,'confirmation':'wrong'}):
            response=self.client.delete('/api/projects/1',json=body)
            self.assertEqual(response.status_code,400,response.json)
        self.assertEqual(self.remove().status_code,200)
        b.initialize()
        self.assertEqual(self.client.get('/api/projects').json['projects'],[])
        new=self.client.post('/api/projects',json={'title':'Neu'}).json['project']
        self.assertGreater(new['id'],1)
        self.assertEqual(self.client.get('/api/project').status_code,404)
        self.assertEqual(self.client.get('/api/backup',headers={'X-PHB-Project':'1'}).status_code,404)

    def test_archive_reopen_is_reversible_and_preserves_data(self):
        note=b.ProjectWork(kind='note',title='Bleibt erhalten',body='Inhalt')
        b.db.session.add(note);b.db.session.commit();ident=note.id
        response=self.client.patch('/api/projects/1',json={'archived':True})
        self.assertEqual(response.status_code,200,response.json)
        row=response.json['project'];self.assertTrue(row['archived']);self.assertFalse(row['can_delete'])
        self.assertEqual(self.client.patch('/api/projects/1',json={'archived':True}).json['project']['archived_at'],row['archived_at'])
        self.assertEqual(len(self.client.get('/api/projects').json['projects']),1)
        self.assertEqual(self.client.get('/api/project').status_code,200)
        self.assertEqual(self.remove().status_code,409)
        self.assertFalse(self.client.patch('/api/projects/1',json={'archived':False}).json['project']['archived'])
        self.assertEqual(b.db.session.get(b.ProjectWork,ident).body,'Inhalt')
        for invalid in ('yes',1,None):
            self.assertEqual(self.client.patch('/api/projects/1',json={'archived':invalid,'title':'Falsch'}).status_code,400)
            self.assertNotEqual(self.info()['title'],'Falsch')

    def test_other_project_is_untouched_and_does_not_block(self):
        other=self.client.post('/api/projects',json={'title':'Anderes Projekt'}).json['project']['id']
        with project_context(other):
            note=b.ProjectWork(kind='note',title='Andere Daten',body='Behalten')
            b.db.session.add(note);b.db.session.commit();ident=note.id
        self.assertTrue(self.info()['can_delete'])
        self.assertFalse(self.info(other)['can_delete'])
        self.assertEqual(self.remove().status_code,200)
        with project_context(other):self.assertEqual(b.db.session.get(b.ProjectWork,ident).body,'Behalten')
        self.assertEqual(self.remove(other).status_code,409)

    def test_stale_empty_state_cannot_delete_new_or_archived_data(self):
        self.assertTrue(self.info()['can_delete'])
        note=b.ProjectWork(kind='todo',title='Archiviert',body='',completed_at=datetime.now(),archived_at=datetime.now())
        b.db.session.add(note);b.db.session.commit()
        self.assertEqual(self.remove().status_code,409)
        self.assertEqual(b.db.session.query(b.ProjectWork).count(),1)

    def test_custom_stammdaten_and_settings_block_deletion(self):
        factories=[lambda:b.Contractor(name='Eigene Firma',trade='Sonstiges'),lambda:b.Trade(name='Eigenes Gewerk'),
            lambda:b.Category(name='Eigene Kategorie',sort_order=999),lambda:b.Setting(key='own-setting',value=''),
            lambda:b.Loan(name='Leerer Kredit',principal=0)]
        for factory in factories:
            row=factory();b.db.session.add(row);b.db.session.commit()
            self.assertFalse(self.info()['can_delete'],type(row).__name__)
            self.assertEqual(self.remove().status_code,409)
            b.db.session.delete(row);b.db.session.commit()
            self.assertTrue(self.info()['can_delete'])
        category=b.db.session.query(b.Category).first();category.sort_order=999;b.db.session.commit()
        self.assertEqual(self.remove().status_code,409)

    def test_delete_is_blocked_during_own_restore(self):
        with patch.object(b,'_BACKUP_RESTORE_STATE',{'project_id':1}):
            b._BACKUP_RESTORE_LOCK.acquire()
            try:self.assertEqual(self.client.delete('/api/projects/1',json={'confirmed':True,'confirmation':'Mein bestehendes Projekt'}).status_code,503)
            finally:b._BACKUP_RESTORE_LOCK.release()

    def test_deleted_owner_cannot_write_from_stale_identity_map(self):
        b.db.session.get(b.Project,1)
        self.assertEqual(self.remove().status_code,200)
        b.db.session.add(b.ProjectWork(kind='note',title='Verwaist',body=''))
        with self.assertRaisesRegex(ValueError,'Projekt nicht gefunden'):b.db.session.commit()
        b.db.session.rollback()
