import json
import os
import unittest
from unittest.mock import patch

os.environ['DATABASE_URL']='sqlite:///:memory:'
from app import app,db,initialize,ScheduleHistory
from chatgpt_local import chatgpt


class InitialScheduleDialogTest(unittest.TestCase):
    def setUp(self):
        self.ctx=app.app_context();self.ctx.push()
        db.session.remove();db.drop_all();initialize()
        self.client=app.test_client();self.headers={'X-PHB-AI':'1'}

    def tearDown(self):
        db.session.remove();self.ctx.pop()

    def call_ai(self,path,response,payload):
        with patch.object(chatgpt,'status',return_value={'sharing':True,'credits_acknowledged':True}), \
             patch.object(chatgpt,'run',return_value=json.dumps(response,ensure_ascii=False)) as runner:
            result=self.client.post(path,headers=self.headers,json={'model':'m1','plan_only':True,**payload},
                                    base_url='http://127.0.0.1:5055')
        return result,runner

    def test_questions_block_generation_until_user_and_ai_are_ready(self):
        first,_=self.call_ai('/api/ai/schedule/intake',{
            'answer':'Zum Umfang fehlen noch Angaben.','questions':['Welche Räume werden saniert?'],
            'summary':'Einfamilienhaus, Umfang offen','ready':True,
        },{'message':'Wir sanieren ein Einfamilienhaus.','user_ready':False})
        self.assertEqual(first.status_code,200,first.json)
        self.assertFalse(first.json['ai_ready'])
        self.assertFalse(first.json['can_generate'])
        with patch.object(chatgpt,'status',return_value={'sharing':True,'credits_acknowledged':True}), \
             patch.object(chatgpt,'run') as runner:
            blocked=self.client.post('/api/ai/schedule/suggest',headers=self.headers,
                json={'model':'m1','plan_only':True},base_url='http://127.0.0.1:5055')
        self.assertEqual(blocked.status_code,409)
        runner.assert_not_called()

        second,_=self.call_ai('/api/ai/schedule/intake',{
            'answer':'Der Umfang ist für einen ersten Plan ausreichend.','questions':[],
            'summary':'Kernsanierung aller Räume, Eigenleistung beim Rückbau','ready':True,
        },{'message':'Alle Räume; Rückbau in Eigenleistung. Meine Angaben sind vollständig.',
           'user_ready':True})
        self.assertEqual(second.status_code,200,second.json)
        self.assertTrue(second.json['ai_ready'])
        self.assertTrue(second.json['user_ready'])
        self.assertTrue(second.json['can_generate'])
        records=db.session.query(ScheduleHistory).order_by(ScheduleHistory.id).all()
        self.assertEqual([row.kind for row in records],['KI-Startplanung','KI-Startplanung'])
        self.assertTrue(all(row.status=='Klärung' for row in records))

    def test_generated_tasks_must_reference_structured_phases(self):
        ready,_=self.call_ai('/api/ai/schedule/intake',{
            'answer':'Ausreichend.','questions':[],'summary':'Rückbau und Dach','ready':True,
        },{'message':'Rückbau und Dachsanierung, Angaben vollständig.','user_ready':True})
        self.assertTrue(ready.json['can_generate'])
        proposal={'overview':'Vorschlag','phases':[{
            'title':'Rückbau','description':'Entkernung','start_date':'2027-03-01','end_date':''}],
            'tasks':[{'code':'D01','name':'Dach prüfen','phase':'Dach','trade':'Dachdecker',
                      'execution_type':'Fremdleistung','duration':5,'planned_end':'',
                      'notes':'Fachbetrieb','predecessors':[]}]}
        result,_=self.call_ai('/api/ai/schedule/suggest',proposal,{})
        self.assertEqual(result.status_code,403,result.json)
        self.assertIn('Unbekannte Bauphase',result.json['error'])
        self.assertEqual(self.client.get('/api/project').json['tasks'],[])

    def test_new_conversation_turn_invalidates_an_older_preview(self):
        ready,_=self.call_ai('/api/ai/schedule/intake',{
            'answer':'Ausreichend.','questions':[],'summary':'Rückbau','ready':True,
        },{'message':'Rückbau in Eigenleistung; Angaben vollständig.','user_ready':True})
        self.assertTrue(ready.json['can_generate'])
        proposal={'overview':'Rückbauplan','phases':[{
            'title':'Rückbau','description':'Entkernung','start_date':'2027-03-01','end_date':''}],
            'tasks':[{'code':'R01','name':'Entkernen','phase':'Rückbau','trade':'Abbruch',
                      'execution_type':'Eigenleistung','duration':5,'planned_end':'',
                      'notes':'Schadstoffe prüfen','predecessors':[]}]}
        generated,_=self.call_ai('/api/ai/schedule/suggest',proposal,{})
        self.assertEqual(generated.status_code,200,generated.json)
        changed,_=self.call_ai('/api/ai/schedule/intake',{
            'answer':'Dann muss der Ablauf neu erstellt werden.','questions':['Welcher Bereich bleibt bewohnt?'],
            'summary':'Teilbewohnter Rückbau','ready':False,
        },{'message':'Ein Gebäudeteil bleibt währenddessen bewohnt.','user_ready':False})
        self.assertFalse(changed.json['can_generate'])
        stale=self.client.post('/api/ai/schedule/apply',headers=self.headers,json={
            'confirm':True,'phases':generated.json['phases'],'tasks':generated.json['tasks']},
            base_url='http://127.0.0.1:5055')
        self.assertEqual(stale.status_code,409)
        self.assertEqual(self.client.get('/api/project').json['tasks'],[])


if __name__=='__main__':unittest.main()
