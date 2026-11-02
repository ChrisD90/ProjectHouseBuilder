"""DIY planning stays project-owned and never writes existing workflows."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b
import project_backups
from multi_projects import project_context


class SelfWorkTest(unittest.TestCase):
    def setUp(self):
        self.ctx=b.app.app_context();self.ctx.push();b.db.session.remove();b.db.drop_all();b.initialize()
        self.client=b.app.test_client()
        status=patch.object(b.chatgpt,'status',return_value={'sharing':True,'connected':True,'credits_acknowledged':True})
        status.start();self.addCleanup(status.stop)
    def tearDown(self):b.db.session.remove();b.db.drop_all();self.ctx.pop()
    def create(self,**changes):
        return self.client.post('/api/self-work',json={'title':'Wohnzimmer streichen',**changes})
    def task(self,owner=1):
        result=self.client.post('/api/tasks',headers={'X-PHB-Project':str(owner)},json={'code':'E-1','name':'Wände streichen','trade':'Maler','execution_type':'Eigenleistung','duration':3})
        self.assertEqual(result.status_code,201,result.json);return result.json['id']
    def ai(self,path,body,answer):
        with patch.object(b.chatgpt,'run',return_value=json.dumps(answer,ensure_ascii=False)) as runner:
            result=self.client.post('/api/self-work/ai/'+path,headers={'X-PHB-AI':'1'},json={'plan_only':True,'consent':True,**body})
        return result,runner
    def context(self):return dict(title='Wohnzimmer streichen',description='20 m² auf festem Putz',location='Wohnzimmer',experience='Einsteiger',task_id=None)

    def test_manual_crud_rounding_and_independence(self):
        task=self.task();schedule=self.client.get('/api/project').json;budget=self.client.get('/api/costs').json
        made=self.create(task_id=task,steps=[dict(title='Vorbereiten',notes='Abkleben',done=False)],
            materials=[dict(title='Farbe',quantity=2.5,unit='l',unit_price=2.675,status='Benötigt')],
            tools=[dict(title='Rolle',source='Kaufen',cost=4.5,ready=False)])
        self.assertEqual(made.status_code,201,made.json);plan=made.json['plan'];path='/api/self-work/'+str(plan['id'])
        self.assertEqual(plan['estimated_cost'],11.20);self.assertEqual(plan['materials'][0]['unit_price'],2.68);self.assertTrue(plan['costs_complete']);self.assertIn('Wände streichen',plan['task_label'])
        plan['steps'][0]['done']=True
        updated=self.client.patch(path,json={'steps':plan['steps'],'status':'Erledigt','notes':'Fertig'})
        self.assertEqual(updated.status_code,200,updated.json)
        self.assertTrue(self.client.get(path).json['plan']['steps'][0]['done'])
        self.assertEqual(self.client.get('/api/project').json,schedule)
        self.assertEqual(self.client.get('/api/costs').json,budget)
        self.assertEqual(self.client.patch(path,json={'archived':True}).status_code,200)
        self.assertTrue(self.client.get('/api/self-work').json['plans'][0]['archived'])
        self.assertEqual(self.client.patch(path,json={'archived':False}).status_code,200)
        self.assertEqual(self.client.delete(path).status_code,200)
        self.assertEqual(self.client.get(path).status_code,404)
        self.assertEqual(self.client.get('/api/project').json,schedule)

    def test_invalid_lists_and_numbers_roll_back_and_unknown_prices_stay_unknown(self):
        made=self.create(materials=[dict(title='Farbe',quantity=None,unit_price=None)],tools=[dict(title='Leiter')])
        self.assertEqual(made.status_code,201,made.json);plan=made.json['plan'];self.assertFalse(plan['costs_complete'])
        path='/api/self-work/'+str(plan['id'])
        for body in ({'materials':[{'title':'X','quantity':'NaN'}]}, {'tools':[{'title':'X','cost':-1}]},
                     {'steps':[{'title':''}]}, {'steps':[{'id':'same','title':'A'},{'id':'same','title':'B'}]},
                     {'status':'Gebucht'}, {'archived':'true'}, {'task_id':True}, {'project_id':2}):
            response=self.client.patch(path,json={'notes':'Darf nicht bleiben',**body})
            self.assertEqual(response.status_code,400,response.json)
            self.assertEqual(self.client.get(path).json['plan']['notes'],'')

    def test_project_isolation_and_stale_edits(self):
        other=self.client.post('/api/projects',json={'title':'Garten'}).json['project']['id'];foreign=self.task(other)
        self.assertEqual(self.create(task_id=foreign).status_code,400)
        made=self.create();ident=made.json['plan']['id'];path='/api/self-work/'+str(ident);old=made.json['_versions'][path]
        self.assertEqual(self.client.get('/api/self-work',headers={'X-PHB-Project':str(other)}).json['plans'],[])
        for method in ('GET','PATCH','DELETE'):
            self.assertEqual(self.client.open(path,method=method,headers={'X-PHB-Project':str(other)},json={'title':'Fremd'}).status_code,404)
        self.assertEqual(self.client.patch(path,json={'notes':'Neu'},headers={'If-Match':old}).status_code,200)
        conflict=self.client.patch(path,json={'notes':'Alt'},headers={'If-Match':old})
        self.assertEqual(conflict.status_code,409);self.assertEqual(conflict.json['code'],'edit_conflict')

    def test_task_deletion_does_not_delete_or_block_independent_plan(self):
        task=self.task();made=self.create(task_id=task);path='/api/self-work/'+str(made.json['plan']['id'])
        self.assertEqual(self.client.delete('/api/tasks/'+str(task)).status_code,200)
        plan=self.client.get(path).json['plan'];self.assertTrue(plan['task_missing']);self.assertEqual(plan['task_label'],'')
        self.assertEqual(self.client.patch(path,json={'notes':'Bleibt bearbeitbar'}).status_code,200)
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'backups').mkdir()
            archive=project_backups.create(b.db,root,1,{'folder':root/'backups','keep':2})
            _,data=project_backups.load_rows(archive,b.db,1)
            self.assertEqual(data['self_work_plan'][0]['task_id'],task)

    def test_ai_requires_consent_connection_and_readiness(self):
        body={'context':self.context(),'history':[{'role':'user','content':'Los geht es'}]}
        response,runner=self.ai('consult',{**body,'consent':False},{})
        self.assertEqual(response.status_code,400);runner.assert_not_called()
        with patch.object(b.chatgpt,'status',return_value={'sharing':False}):
            response,runner=self.ai('consult',body,{})
            self.assertEqual(response.status_code,403);runner.assert_not_called()
        response,runner=self.ai('plan',{**body,'user_ready':True,'token':'invented'},{})
        self.assertEqual(response.status_code,400);runner.assert_not_called()
        response,runner=self.ai('consult',body,{'answer':'Welche Fläche?', 'questions':['Wie viele m²?'],'ready':True})
        self.assertEqual(response.status_code,200,response.json);self.assertFalse(response.json['ready']);self.assertEqual(response.json['token'],'')

    def test_research_can_answer_directly_and_long_answers_allow_follow_up(self):
        context=self.context();history=[dict(role='user',content='Recherchiere bitte, welche Werkzeuge ich benötigen könnte.')]
        answer='Werkzeuge und Einsatz: '+('Rolle, Pinsel und Abdeckmaterial. '*140)+' Quelle: https://example.org'
        result,runner=self.ai('consult',dict(context=context,history=history),dict(answer=answer,questions=[],ready=True))
        self.assertEqual(result.status_code,200,result.json);self.assertEqual(result.json['answer'],answer)
        self.assertTrue(runner.call_args.kwargs['web_search'])
        history += [dict(role='assistant',content=answer),dict(role='user',content='Welche Materialien kommen noch infrage?')]
        result,runner=self.ai('consult',dict(context=context,history=history),dict(answer='Grundierung abhängig vom Untergrund.',questions=[],ready=True))
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(self.client.get('/api/self-work').json['plans'],[])

    def test_ai_proposal_is_validated_project_bound_and_never_saved_implicitly(self):
        context=self.context();history=[{'role':'user','content':'20 m², Untergrund fest, zweimal streichen.'}]
        response,_=self.ai('consult',dict(context=context,history=history),dict(answer='Das reicht für den Vorschlag.',questions=[],ready=True))
        self.assertEqual(response.status_code,200,response.json)
        history.append(dict(role='assistant',content=response.json['answer']))
        body=dict(context=context,history=history,token=response.json['token'],user_ready=True)
        proposal=dict(summary='Vorbereiten, dann streichen.',assumptions=['Fest haftender Altanstrich.'],steps=[dict(title='Abkleben',done=True)],materials=[dict(title='Farbe',quantity=None,unit_price=None)],tools=[dict(title='Rolle')])
        changed,runner=self.ai('plan',{**body,'context':{**context,'description':'Anderer Untergrund'}},proposal)
        self.assertEqual(changed.status_code,400);runner.assert_not_called()
        self.assertEqual(self.client.post('/api/self-work/ai/plan',headers={'X-PHB-AI':'1'},json={'plan_only':True,'consent':True,**body},environ_base={'REMOTE_ADDR':'192.168.1.3'}).status_code,403)
        result,runner=self.ai('plan',body,proposal)
        self.assertEqual(result.status_code,200,result.json);self.assertFalse(result.json['proposal']['steps'][0]['done'])
        self.assertIsNone(result.json['proposal']['materials'][0]['unit_price']);self.assertEqual(self.client.get('/api/self-work').json['plans'],[])
        other=self.client.post('/api/projects',json={'title':'Garten'}).json['project']['id']
        with patch.object(b.chatgpt,'run') as runner:
            result=self.client.post('/api/self-work/ai/plan',headers={'X-PHB-AI':'1','X-PHB-Project':str(other)},json={'plan_only':True,'consent':True,**body})
        self.assertEqual(result.status_code,400);runner.assert_not_called()

    def test_project_backup_and_restore_keep_independent_plans_separated(self):
        other=self.client.post('/api/projects',json={'title':'Garten'}).json['project']['id']
        foreign=self.client.post('/api/self-work',headers={'X-PHB-Project':str(other)},json={'title':'Anderes Vorhaben'}).json['plan']
        made=self.create(steps=[{'title':'Abkleben'}]);ident=made.json['plan']['id'];path='/api/self-work/'+str(ident)
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);store=root/'backups';store.mkdir()
            archive=project_backups.create(b.db,root,1,{'folder':store,'keep':2})
            self.client.patch(path,json={'title':'Geändert'})
            project_backups.restore(archive,b.db,root,1)
        self.assertEqual(self.client.get(path).json['plan']['title'],'Wohnzimmer streichen')
        self.assertEqual(self.client.get('/api/self-work',headers={'X-PHB-Project':str(other)}).json['plans'][0]['title'],foreign['title'])
        row=self.client.get('/api/projects/1').json['project']
        self.assertFalse(row['can_delete']);self.assertIn('Eigenleistungen',row['delete_reason'])
        with b.db.engine.begin() as connection:project_backups.clear_rows(connection,b.db,1)
        b.db.session.remove()
        self.assertEqual(self.client.get('/api/self-work').json['plans'],[])
        self.assertEqual(self.client.get('/api/self-work',headers={'X-PHB-Project':str(other)}).json['plans'][0]['title'],foreign['title'])
