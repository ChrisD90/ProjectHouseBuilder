"""Conversational Gantt planning: consent, atomic approval and durable audit."""
import os
import json
import unittest
from unittest.mock import patch

os.environ['DATABASE_URL']='sqlite:///:memory:'
from app import app, db, initialize, Task, CostItem, ScheduleHistory
from chatgpt_local import chatgpt


class ScheduleChatTests(unittest.TestCase):
    def setUp(self):
        self.ctx=app.app_context();self.ctx.push()
        db.session.remove();db.drop_all();initialize()
        self.client=app.test_client()
        self.client.post('/api/tasks',json={'code':'A1','name':'Elektroinstallation',
            'duration':5,'lag_days':0,'execution_type':'Fremdleistung',
            'status':'Offen','progress':0,'predecessors':[]})
        self.client.post('/api/tasks',json={'code':'A2','name':'Innenausbau',
            'duration':8,'lag_days':0,'execution_type':'Eigenleistung',
            'status':'Offen','progress':0,'predecessors':['A1']})
        self.headers={'X-PHB-AI':'1'}
    def tearDown(self):
        db.session.remove();db.drop_all();self.ctx.pop()
    def tasks(self):
        return {t['code']:t for t in self.client.get('/api/project').json['tasks']}
    def ask(self,reply,message='Wir verlegen die Heizung selbst.'):
        with patch.object(chatgpt,'status',return_value={'sharing':True}), \
             patch.object(chatgpt,'run',return_value=json.dumps(reply,ensure_ascii=False)) as run:
            result=self.client.post('/api/ai/schedule/chat',json={
                'model':'m1','plan_only':True,'message':message},headers=self.headers,
                base_url='http://127.0.0.1:5055')
        return result,run
    def resolve(self,id,yes):
        return self.client.post('/api/ai/schedule/chat/'+str(id)+'/resolve',
            json={'confirm':yes},headers=self.headers,base_url='http://127.0.0.1:5055')

    def test_preview_never_writes_before_approval_and_logs_exact_fields(self):
        before=self.tasks()
        proposed={'answer':'Die Eigenleistung verändert den Ablauf.',
             'decision':'Heizung wird selbst verlegt',
             'warnings':['Fachabnahme weiterhin nötig'],
             'changes':[{'action':'update','code':'A2',
                         'fields':{'name':'Deckenheizung selbst verlegen',
                                   'duration':12,'notes':'Eigenleistung und Fachabnahme'}}]}
        res,run=self.ask(proposed)
        self.assertEqual(res.status_code,200,res.json)
        self.assertTrue(res.json['requires_approval'])
        self.assertEqual(self.tasks(),before)
        self.assertEqual(run.call_count,1)
        proposal_id=res.json['id']
        preview=res.json['preview']
        self.assertEqual(preview[0]['changes'][1]['before'],8)
        self.assertEqual(preview[0]['changes'][1]['after'],12)
        self.assertEqual(self.client.get('/api/schedule/history').json['history'][0]['status'],'Vorschlag')
        self.assertEqual(self.resolve(proposal_id,True).status_code,200)
        after=self.tasks()
        self.assertEqual(after['A2']['duration'],12)
        self.assertEqual(after['A2']['name'],'Deckenheizung selbst verlegen')
        self.assertEqual(after['A1']['duration'],before['A1']['duration'])
        self.assertNotEqual(after['A2']['end'],before['A2']['end'])
        history=self.client.get('/api/schedule/history').json['history']
        self.assertEqual(history[0]['status'],'Umgesetzt')
        self.assertEqual(history[0]['decision'],'Heizung wird selbst verlegt')
        self.assertIn('duration',str(history[0]['changes']))
        self.assertEqual(self.resolve(proposal_id,True).status_code,409)

    def test_invalid_dependency_cycle_is_rejected_without_changes(self):
        before=self.tasks()
        candidate={'answer':'Verstanden','changes':[{'action':'update','code':'A1',
                    'fields':{'predecessors':['A2']}}]}
        res,_=self.ask(candidate)
        self.assertEqual(res.status_code,422,res.json)
        self.assertIn('Zyklische',res.json['error'])
        self.assertEqual(self.tasks(),before)

    def test_decline_and_only_discuss_are_logged_without_mutating_plan(self):
        before=self.tasks()
        answer={'answer':'Die Wärmepumpe könnte später kommen.',
                'decision':'Wärmepumpe zeitlich prüfen','changes':[]}
        response,_=self.ask(answer,'Wann können wir die Wärmepumpe einbauen?')
        self.assertEqual(response.status_code,200)
        self.assertFalse(response.json['requires_approval'])
        self.assertEqual(self.client.get('/api/schedule/history').json['history'][0]['status'],'Besprochen')
        proposal,_=self.ask({'answer':'Zuerst Dach neu',
            'changes':[{'action':'update','code':'A1','fields':{'duration':20}}]})
        self.assertEqual(proposal.status_code,200)
        self.assertEqual(self.resolve(proposal.json['id'],False).status_code,200)
        self.assertEqual(self.tasks(),before)
        self.assertEqual(self.client.get('/api/schedule/history').json['history'][0]['status'],'Verworfen')

    def test_stale_proposal_cannot_overwrite_manual_edits(self):
        proposal,_=self.ask({'answer':'Dauer verlängern',
          'changes':[{'action':'update','code':'A1','fields':{'duration':10}}]})
        self.assertEqual(proposal.status_code,200)
        current=self.tasks()['A1']
        current['duration']=6
        res=self.client.put('/api/tasks/'+str(current['id']),json=current)
        self.assertEqual(res.status_code,200,res.json)
        blocked=self.resolve(proposal.json['id'],True)
        self.assertEqual(blocked.status_code,409)
        self.assertIn('seit der Vorschau geändert',blocked.json['error'])
        self.assertEqual(self.tasks()['A1']['duration'],6)
        self.assertTrue(any(x['kind']=='Manuell' for x in
                            self.client.get('/api/schedule/history').json['history']))

    def test_add_task_and_reject_deletion_of_cost_linked_task(self):
        proposed={'answer':'Neue Aufgabe hinzugefügt',
            'changes':[{'action':'add','task':{'code':'A3',
                 'name':'Wärmedämmung prüfen','duration':4,
                 'predecessors':['A2'],'execution_type':'Fremdleistung'}}]}
        created,_=self.ask(proposed)
        self.assertEqual(created.status_code,200,created.json)
        self.assertEqual(self.resolve(created.json['id'],True).status_code,200)
        self.assertEqual(self.tasks()['A3']['predecessors'],['A2'])
        task=db.session.query(Task).filter_by(code='A3').one()
        db.session.add(CostItem(title='Verknüpft',category='Dämmung',task_id=task.id))
        db.session.commit()
        remove,_=self.ask({'answer':'Dämmung entfernen',
                           'changes':[{'action':'remove','code':'A3'}]})
        self.assertEqual(remove.status_code,200,remove.json)
        blocked=self.resolve(remove.json['id'],True)
        self.assertEqual(blocked.status_code,409,blocked.json)
        self.assertIn('mit Kosten verknüpft',blocked.json['error'])
        self.assertIn('A3',self.tasks())

    def test_remove_task_after_updating_dependent_predecessors(self):
        response,_=self.ask({'answer':'Elektroarbeit entfällt, Innenausbau bleibt.',
            'decision':'Elektroinstallation entfällt',
            'changes':[
              {'action':'remove','code':'A1'},
              {'action':'update','code':'A2','fields':{
                  'predecessors':[],'notes':'Elektrik außerhalb des Bauzeitenplans'}}
            ]})
        self.assertEqual(response.status_code,200,response.json)
        approved=self.resolve(response.json['id'],True)
        self.assertEqual(approved.status_code,200,approved.json)
        tasks=self.tasks()
        self.assertNotIn('A1',tasks)
        self.assertEqual(tasks['A2']['predecessors'],[])
        self.assertEqual(tasks['A2']['notes'],'Elektrik außerhalb des Bauzeitenplans')
        self.assertEqual(self.client.get('/api/schedule/history').json['history'][0]['status'],'Umgesetzt')

    def test_no_plan_or_missing_credit_consent_blocks_model_request(self):
        response=self.client.post('/api/ai/schedule/chat',
                json={'message':'Bitte anpassen','plan_only':True},
                base_url='http://127.0.0.1:5055')
        self.assertEqual(response.status_code,403)
        with patch.object(chatgpt,'status',return_value={'sharing':True}), \
             patch.object(chatgpt,'run') as runner:
            no_consent=self.client.post('/api/ai/schedule/chat',
                headers=self.headers,json={'message':'Bitte anpassen'},
                base_url='http://127.0.0.1:5055')
            self.assertEqual(no_consent.status_code,403)
            runner.assert_not_called()
        db.session.query(Task).delete();db.session.commit()
        # Empty plan must go through the separate first-planning workflow.
        with patch.object(chatgpt,'status',return_value={'sharing':True}), \
             patch.object(chatgpt,'run') as runner:
            no_plan=self.client.post('/api/ai/schedule/chat',
                headers=self.headers,
                json={'message':'Bitte anpassen','plan_only':True},
                base_url='http://127.0.0.1:5055')
            self.assertEqual(no_plan.status_code,409)
            runner.assert_not_called()


if __name__=='__main__':
    unittest.main()
