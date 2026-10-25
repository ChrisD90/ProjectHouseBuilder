"""Server-side invariants for task editing, graph changes and Gantt movement."""
import io
import os
import unittest
from unittest.mock import patch
from datetime import date
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as backend
from app import app,db,initialize,Task,Dependency,CostItem,ImportJob,Contractor
from schedule_assistant import validate_changes


class TaskControlsTest(unittest.TestCase):
    def setUp(self):
        self.scope=app.app_context();self.scope.push()
        db.session.remove();db.drop_all();initialize()
        self.client=app.test_client()
        tasks=[Task(code=code,name='Arbeit '+code,phase='Bau',trade='Sonstiges',duration=days,
                    lag_days=0,status='Offen',progress=0,notes='',position=i,execution_type='Fremdleistung')
               for i,(code,days) in enumerate([('A',3),('B',2),('C',2),('D',1)])]
        db.session.add_all(tasks);db.session.flush()
        self.ids={t.code:t.id for t in tasks}
        db.session.add_all([Dependency(task_id=self.ids['B'],predecessor_id=self.ids['A']),
                            Dependency(task_id=self.ids['C'],predecessor_id=self.ids['B'])]);db.session.commit()
    def tearDown(self):
        db.session.remove();db.drop_all();self.scope.pop()
    def plan(self):return self.client.get('/api/project').json
    def task(self,code):return next(t for t in self.plan()['tasks'] if t['code']==code)
    def edit(self,code,data):return self.client.put('/api/tasks/'+str(self.ids[code]),json=data)
    def complete(self,code):return self.client.post('/api/tasks/'+str(self.ids[code])+'/complete')

    def test_completed_fields_cannot_change_even_in_full_payload(self):
        self.complete('B');before=self.task('B')
        payload={k:v for k,v in before.items() if k in backend.FIELDS}
        payload['notes']='Dokumentiert'
        self.assertEqual(self.edit('B',payload).status_code,200)
        for key,value in [('duration',10),('status','Offen'),('progress',0),('name','Anderer Name'),('actual_end','2027-01-01'),('company','Andere Firma')]:
            with self.subTest(key=key):
                response=self.edit('B',{key:value,'notes':'Nicht speichern'})
                self.assertEqual(response.status_code,400,response.json)
                self.assertEqual(self.task('B')[key],before[key])
                self.assertEqual(self.task('B')['notes'],'Dokumentiert')
        self.assertEqual(self.client.delete('/api/tasks/'+str(self.ids['B'])).status_code,409)
        self.assertEqual(self.task('B')['actual_end'],date.today().isoformat())

    def test_completed_allows_both_dependency_directions_and_notes(self):
        self.complete('B')
        saved=self.edit('B',{'predecessors':['D'],'successors':['C'],'notes':'Abhängigkeit geklärt'})
        self.assertEqual(saved.status_code,200,saved.json)
        self.assertEqual(self.task('B')['predecessors'],['D'])
        self.assertEqual(self.task('B')['successors'],['C'])
        self.assertEqual(self.task('C')['predecessors'],['B'])

    def test_successor_selection_updates_inverse_links_and_rejects_cycle_atomically(self):
        result=self.edit('A',{'successors':['B','D']})
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(self.task('D')['predecessors'],['A'])
        before=self.plan()['tasks']
        blocked=self.edit('C',{'successors':['A'],'notes':'Zyklus'})
        self.assertEqual(blocked.status_code,400)
        self.assertEqual(self.plan()['tasks'],before)
        self.assertEqual(self.edit('A',{'successors':['UNKNOWN']}).status_code,400)

    def test_delete_middle_rewires_graph_and_preserves_other_predecessors(self):
        self.edit('C',{'predecessors':['A','B','D']})
        result=self.client.delete('/api/tasks/'+str(self.ids['B']))
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(result.json['rewired'],1)
        self.assertEqual(set(self.task('C')['predecessors']),{'A','D'})
        self.assertEqual(len(self.task('C')['predecessors']),2)
        history=self.client.get('/api/schedule/history').json['history'][0]
        self.assertIn('predecessors',str(history['changes']))

    def test_delete_first_task_keeps_successor_and_cost_link_blocks_removal(self):
        result=self.client.delete('/api/tasks/'+str(self.ids['A']))
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(self.task('B')['predecessors'],[])
        db.session.add(CostItem(title='Verknüpft',task_id=self.ids['B']));db.session.commit()
        self.assertEqual(self.client.delete('/api/tasks/'+str(self.ids['B'])).status_code,409)
        self.assertEqual(self.task('C')['predecessors'],['B'])

    def test_move_preserves_duration_and_links_and_shifts_downstream(self):
        before=self.task('B')
        result=self.client.post('/api/tasks/'+str(self.ids['B'])+'/move',json={'start':'2027-03-10','plan_digest':self.plan()['plan_digest']})
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(self.task('B')['start'],'2027-03-10')
        self.assertEqual(self.task('B')['duration'],before['duration'])
        self.assertEqual(self.task('B')['predecessors'],['A'])
        self.assertEqual(self.task('C')['start'],'2027-03-12')
        self.assertEqual(self.task('A')['start'],'2027-03-01')
        self.assertEqual(self.client.get('/api/schedule/history').json['history'][0]['kind'],'Manuell')

    def test_move_rejects_dependency_violation_stale_plan_and_completed_task(self):
        before=self.plan();url='/api/tasks/'+str(self.ids['B'])+'/move'
        self.assertEqual(self.client.post(url,json={'start':'2027-03-02','plan_digest':before['plan_digest']}).status_code,409)
        self.assertEqual(self.plan()['tasks'],before['tasks'])
        self.edit('A',{'duration':4})
        self.assertEqual(self.client.post(url,json={'start':'2027-03-20','plan_digest':before['plan_digest']}).status_code,409)
        self.complete('B')
        self.assertEqual(self.client.post(url,json={'start':'2027-03-20','plan_digest':self.plan()['plan_digest']}).status_code,409)

    def test_ai_cannot_change_completed_task_or_remove_it(self):
        self.complete('B');existing=self.plan()['tasks']
        for operation in [{'action':'update','code':'B','fields':{'duration':20}},{'action':'remove','code':'B'}]:
            with self.assertRaisesRegex(ValueError,'Abgeschlossene'):validate_changes(existing,[operation])
        operations,_=validate_changes(existing,[{'action':'update','code':'B','fields':{'notes':'Ergänzung'}}])
        self.assertEqual(len(operations),1)

    def test_company_assignment_cannot_bypass_completion_lock(self):
        contractor=Contractor(name='Auftragnehmer',trade='Sonstiges');db.session.add(contractor);db.session.flush()
        db.session.add(CostItem(title='Beauftragt',state='Beauftragt',contractor_id=contractor.id,kind='Fremdleistung'));db.session.commit()
        self.complete('B')
        response=self.client.post('/api/tasks/assign-by-company',json={'assignments':[{'task_id':self.ids['B'],'contractor_id':contractor.id}]})
        self.assertEqual(response.status_code,409,response.json)
        self.assertIsNone(self.task('B')['contractor_id'])

    def test_batch_status_remains_available_after_archiving(self):
        job=ImportJob(batch_id='a'*32,kind='receipts',filename='Test.pdf',stored_name='test.pdf',analysis_mode='local',status='Übernommen')
        db.session.add(job);db.session.commit()
        response=self.client.get('/api/import-jobs/batches/'+'a'*32)
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['jobs'][0]['status'],'Übernommen')
        self.assertEqual(response.headers['Cache-Control'],'no-store')
        self.assertEqual(self.client.get('/api/import-jobs/batches/not-a-batch').status_code,400)
        self.assertEqual(self.client.get('/api/import-jobs/batches/'+'b'*32).status_code,404)
