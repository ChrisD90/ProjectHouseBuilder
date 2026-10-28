"""Editable build phases, task deadlines and master-data company assignment."""
import os
import unittest
from datetime import date, timedelta
from pathlib import Path

os.environ['DATABASE_URL']='sqlite:///:memory:'
from app import app, db, initialize, Task, Contractor

ROOT=Path(__file__).resolve().parents[1]


class BuildPhaseTests(unittest.TestCase):
    def setUp(self):
        self.ctx=app.app_context();self.ctx.push()
        db.session.remove();db.drop_all();initialize()
        self.client=app.test_client()

    def tearDown(self):
        db.session.remove();db.drop_all();self.ctx.pop()

    def phase(self,**changes):
        body={'title':'Rohbau','start_date':'2027-04-01','end_date':'',
              'description':'Tragende Arbeiten'}
        body.update(changes)
        return self.client.post('/api/phases',json=body)

    def task(self,**changes):
        body={'code':'T-1','name':'Leitungen verlegen','trade':'Elektro',
              'execution_type':'Fremdleistung','duration':5,'status':'Offen'}
        body.update(changes)
        return self.client.post('/api/tasks',json=body)

    def test_phases_are_crud_entities_and_deletion_unassigns_tasks(self):
        created=self.phase();self.assertEqual(created.status_code,201,created.json)
        phase=created.json['phase']
        task=self.task(phase_id=phase['id']);self.assertEqual(task.status_code,201,task.json)
        project=self.client.get('/api/project').json
        saved=next(row for row in project['tasks'] if row['id']==task.json['id'])
        self.assertEqual(saved['phase'],'Rohbau');self.assertEqual(saved['phase_id'],phase['id'])
        self.assertEqual(saved['start'],'2027-04-01')
        renamed=self.client.put('/api/phases/'+str(phase['id']),json={
            'title':'Rohbau & Tragwerk','start_date':'2027-04-02',
            'end_date':'2027-05-10','description':'Aktualisiert'})
        self.assertEqual(renamed.status_code,200,renamed.json)
        self.assertEqual(self.client.get('/api/project').json['tasks'][0]['phase'],'Rohbau & Tragwerk')
        deleted=self.client.delete('/api/phases/'+str(phase['id']))
        self.assertEqual(deleted.status_code,200,deleted.json);self.assertEqual(deleted.json['unassigned_tasks'],1)
        project=self.client.get('/api/project').json
        self.assertEqual(project['phases'],[]);self.assertIsNone(project['tasks'][0]['phase_id'])
        self.assertEqual(project['tasks'][0]['phase'],'')

    def test_optional_planned_end_exposes_due_soon_and_overdue_states(self):
        soon=(date.today()+timedelta(days=5)).isoformat()
        created=self.task(planned_end=soon);self.assertEqual(created.status_code,201,created.json)
        row=self.client.get('/api/project').json['tasks'][0]
        self.assertEqual(row['planned_end'],soon);self.assertEqual(row['deadline_status'],'due-soon')
        overdue=(date.today()-timedelta(days=1)).isoformat()
        changed=self.client.put('/api/tasks/'+str(created.json['id']),json={'planned_end':overdue})
        self.assertEqual(changed.status_code,200,changed.json)
        self.assertEqual(self.client.get('/api/project').json['tasks'][0]['deadline_status'],'overdue')

    def test_company_must_come_from_matching_masterdata_trade(self):
        electrician=Contractor(name='Elektro GmbH',trade='Elektro')
        plumber=Contractor(name='Sanitär GmbH',trade='Sanitär')
        db.session.add_all([electrician,plumber]);db.session.commit()
        invalid=self.task(contractor_id=plumber.id)
        self.assertEqual(invalid.status_code,400,invalid.json)
        valid=self.task(code='T-2',contractor_id=electrician.id)
        self.assertEqual(valid.status_code,201,valid.json)
        row=self.client.get('/api/project').json['tasks'][0]
        self.assertEqual(row['contractor_id'],electrician.id);self.assertEqual(row['company'],'')

    def test_schedule_ui_uses_phase_and_masterdata_controls(self):
        html=self.client.get('/').get_data(as_text=True)
        form=html[html.index('id="taskForm"'):html.index('</form>',html.index('id="taskForm"'))]
        self.assertIn('name="phase_id"',form);self.assertIn('name="planned_end"',form)
        for removed in ('name="company"','name="lag_days"','name="earliest_start"','name="progress"'):
            self.assertNotIn(removed,form)
        self.assertIn('id="phaseDialog"',html);self.assertIn('id="managePhases"',html)
        script=(ROOT/'static/app.js').read_text()
        self.assertIn('refreshTaskContractors',script);self.assertIn('phase-bar',script)
        self.assertIn('deadline_status',script)


if __name__=='__main__':unittest.main()
