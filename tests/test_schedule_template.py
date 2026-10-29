"""Safety and behavior of the opt-in, categorized renovation schedule."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from app import app, db, initialize, Task, Dependency, Setting, CostItem
from sample_schedule import load_schedule_template
from sqlalchemy import select


class ScheduleTemplateTests(TestCase):
    def setUp(self):
        self.appctx=app.app_context()
        self.appctx.push()
        db.drop_all()
        initialize()
        self.client=app.test_client()

    def tearDown(self):
        db.session.remove()
        self.appctx.pop()

    def test_new_app_is_empty_until_user_explicitly_initializes(self):
        self.assertEqual(self.client.get('/api/project').json['tasks'],[])
        preview=self.client.get('/api/tasks/template')
        self.assertEqual(preview.status_code,200)
        content=preview.json
        self.assertEqual(content['count'],69)
        self.assertEqual(content['execution_types'],{'Eigenleistung':21,'Fremdleistung':48})
        self.assertEqual(len(content['phases']),9)
        self.assertTrue(content['can_initialize'])
        self.assertEqual(db.session.scalar(select(db.func.count(Task.id))),0)

    def test_confirmation_is_required_and_template_is_atomic(self):
        for data in ({},{'confirm':False},{'confirm':'true'}):
            response=self.client.post('/api/tasks/initialize',json=data)
            self.assertEqual(response.status_code,400)
        self.assertEqual(db.session.scalar(select(db.func.count(Task.id))),0)
        response=self.client.post('/api/tasks/initialize',json={'confirm':True})
        self.assertEqual(response.status_code,201,response.json)
        self.assertEqual(response.json['created'],69)
        tasks=self.client.get('/api/project').json['tasks']
        self.assertEqual(len(tasks),69)
        self.assertEqual(sum(t['execution_type']=='Eigenleistung' for t in tasks),21)
        self.assertEqual(sum(t['execution_type']=='Fremdleistung' for t in tasks),48)
        self.assertEqual(len(set(t['code'] for t in tasks)),69)
        self.assertGreater(sum(len(t['predecessors']) for t in tasks),65)
        self.assertTrue(all(t['start'] and t['end'] and t['end']>=t['start'] for t in tasks))
        self.assertEqual(db.session.scalar(select(db.func.count(Dependency.id))),sum(len(t['predecessors']) for t in tasks))

    def test_never_merge_or_reinitialize_existing_schedule(self):
        first=self.client.post('/api/tasks/initialize',json={'confirm':True})
        self.assertEqual(first.status_code,201)
        project=self.client.get('/api/project').json
        task=next(t for t in project['tasks'] if t['code']=='S01')
        change=self.client.put(f"/api/tasks/{task['id']}",json={**task,'name':'Meine eigene Planung'})
        self.assertEqual(change.status_code,200,change.json)
        blocked=self.client.post('/api/tasks/initialize',json={'confirm':True})
        self.assertEqual(blocked.status_code,409)
        self.assertEqual(db.session.scalar(select(db.func.count(Task.id))),69)
        self.assertEqual(db.session.get(Task,task['id']).name,'Meine eigene Planung')
        self.assertFalse(self.client.get('/api/tasks/template').json['can_initialize'])

    def test_one_manual_task_prevents_automatic_merge(self):
        response=self.client.post('/api/tasks',json={
            'code':'CUSTOM','name':'Eigene Aufgabe','phase':'Vorbereitung',
            'trade':'Bauherrschaft','execution_type':'Eigenleistung',
            'duration':3,'lag_days':0,'progress':0,'status':'Offen'})
        self.assertEqual(response.status_code,201,response.json)
        self.assertEqual(self.client.post('/api/tasks/initialize',json={'confirm':True}).status_code,409)
        self.assertEqual([x.code for x in db.session.scalars(select(Task))],['CUSTOM'])

    def test_execution_type_validation_edit_and_export(self):
        self.client.post('/api/tasks/initialize',json={'confirm':True})
        task=db.session.scalar(select(Task).where(Task.code=='S01'))
        bad=self.client.put(f'/api/tasks/{task.id}',json={'execution_type':'Fantasie'})
        self.assertEqual(bad.status_code,400)
        self.assertEqual(db.session.get(Task,task.id).execution_type,'Fremdleistung')
        good=self.client.put(f'/api/tasks/{task.id}',json={'execution_type':'Eigenleistung'})
        self.assertEqual(good.status_code,200,good.json)
        self.assertEqual(db.session.get(Task,task.id).execution_type,'Eigenleistung')
        csv=self.client.get('/api/export.csv')
        self.assertEqual(csv.status_code,200)
        self.assertIn('execution_type',csv.data.decode('utf-8-sig').splitlines()[0])
        self.assertIn('Eigenleistung',csv.data.decode('utf-8-sig'))
        backup=self.client.get('/api/backup.json').json
        self.assertIn('execution_type',backup['tasks'][0])
        self.assertEqual(self.client.get('/').status_code,200)
        html=self.client.get('/').data.decode('utf-8')
        self.assertNotIn('id="initializeTemplate"',html)
        self.assertIn('id="aiSchedulePanel"',html)
        self.assertIn('Bauzeitenplan gemeinsam vorbereiten',html)
        self.assertIn('id="initialScheduleDialog"',html)
        self.assertIn('name="execution_type"',html)
        self.assertIn('id="workType"',html)

    def test_corrupt_template_does_not_write_partial_schedule(self):
        with patch('app.load_schedule_template',side_effect=ValueError('Vorlage beschädigt')):
            resp=self.client.post('/api/tasks/initialize',json={'confirm':True})
        self.assertEqual(resp.status_code,400)
        self.assertEqual(db.session.scalar(select(db.func.count(Task.id))),0)

    def test_restart_and_reset_like_empty_schedule_remain_empty(self):
        # The old auto-seed was retired: deleted tasks must not spontaneously return.
        initialize()
        self.assertEqual(db.session.scalar(select(db.func.count(Task.id))),0)
        self.assertEqual(db.session.get(Setting,'project_initialized').value,'1')

    def test_template_validation_rejects_unknown_dependencies_and_cycles(self):
        sample=[{'code':'S01','name':'Probe','phase':'Vorbereitung','trade':'Planung','notes':'',
                 'execution_type':'Eigenleistung','duration':1,'lag_days':0,'predecessors':['BAD']}]
        with TemporaryDirectory() as temp:
            path=Path(temp)/'template.json'
            path.write_text(json.dumps(sample))
            with self.assertRaisesRegex(ValueError,'Vorgänger'):
                load_schedule_template(path)
            sample[0]['predecessors']=['S02']
            sample.append({**sample[0],'code':'S02','predecessors':['S01']})
            path.write_text(json.dumps(sample))
            with self.assertRaisesRegex(ValueError,'Zyklische'):
                load_schedule_template(path)


if __name__=='__main__':
    import unittest
    unittest.main()
