"""Minute-accurate time sheets, scoped links, validation and safe CRUD."""
import os
import unittest
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b
from multi_projects import project_context

class TimeTrackingTest(unittest.TestCase):
    def setUp(self):
        self.context=b.app.app_context();self.context.push()
        b.db.session.remove();b.db.drop_all();b.initialize();self.client=b.app.test_client()
        self.other=self.client.post('/api/projects',json={'title':'Anderes Projekt'}).json['project']['id']

    def tearDown(self):
        b.db.session.remove();b.db.drop_all();self.context.pop()

    def person(self,owner=1,**changes):
        result=self.client.post('/api/time-people',json={'name':'Helferin',**changes},headers={'X-PHB-Project':str(owner)})
        self.assertEqual(result.status_code,201,result.json);return result.json['person']

    def entry(self,person,minutes=90,owner=1,day='2026-11-11'):
        response=self.client.post('/api/time-entries',json={'person_id':person['id'],'worked_on':day,'minutes':minutes,'description':'Wände vorbereiten'},headers={'X-PHB-Project':str(owner)})
        self.assertEqual(response.status_code,201,response.json);return response.json['entry']

    def test_totals_edit_delete_and_empty_person(self):
        person=self.person();self.assertEqual(person['total_minutes'],0)
        entry=self.entry(person,95);self.entry(person,35,day='2026-11-10')
        listing=self.client.get('/api/time-tracking').json['people'][0]
        self.assertEqual((listing['total_minutes'],listing['entry_count'],listing['last_date']),(130,2,'2026-11-11'))
        self.assertIn('/api/time-people/'+str(person['id']),self.client.get('/api/time-tracking').json['_versions'])
        detail=self.client.get('/api/time-people/'+str(person['id'])).json
        self.assertEqual(detail['entries'][0]['minutes'],95)
        self.assertEqual(self.client.patch('/api/time-entries/'+str(entry['id']),json={'minutes':65}).status_code,200)
        self.assertEqual(self.client.get('/api/time-tracking').json['people'][0]['total_minutes'],100)
        self.assertEqual(self.client.delete('/api/time-entries/'+str(entry['id'])).status_code,200)
        self.assertEqual(self.client.get('/api/time-tracking').json['people'][0]['total_minutes'],35)
        self.assertEqual(self.client.delete('/api/time-people/'+str(person['id'])).status_code,200)
        self.assertEqual(b.db.session.query(b.TimeEntry).count(),0)

    def test_company_mode_links_master_data_and_blocks_company_deletion(self):
        company=self.client.post('/api/contractors',json={'name':'Architekturbüro','trade':'Sonstiges'}).json['contractor']
        person=self.person(kind='company',name='',contractor_id=company['id'])
        self.assertEqual(person['name'],'Architekturbüro')
        self.entry(person,900);self.entry(person,900)  # Multiple staff can work on the same day.
        self.assertEqual(self.client.get('/api/time-tracking').json['people'][0]['total_minutes'],1800)
        self.assertEqual(self.client.delete('/api/contractors/'+str(company['id'])).status_code,409)
        personal=self.person(contractor_id=company['id'],name='Architektin Anna')
        self.assertEqual(personal['company_name'],'Architekturbüro')
        self.assertEqual(self.client.patch('/api/time-people/'+str(person['id']),json={'kind':'person','name':'Bürohistorie','contractor_id':None}).status_code,200)

    def test_project_boundaries_cover_ids_aggregates_and_foreign_links(self):
        own=self.person();foreign=self.person(self.other,name='Anderer Helfer');entry=self.entry(foreign,210,owner=self.other)
        self.entry(own,60)
        self.assertEqual(self.client.get('/api/time-tracking').json['people'][0]['total_minutes'],60)
        headers={'X-PHB-Project':str(self.other)}
        self.assertEqual(self.client.get('/api/time-tracking',headers=headers).json['people'][0]['total_minutes'],210)
        for method,path,data in [('get','/api/time-people/'+str(foreign['id']),None),('patch','/api/time-people/'+str(foreign['id']),{'name':'Falsch'}),('delete','/api/time-people/'+str(foreign['id']),None),('patch','/api/time-entries/'+str(entry['id']),{'minutes':5}),('delete','/api/time-entries/'+str(entry['id']),None)]:
            self.assertEqual(getattr(self.client,method)(path,json=data).status_code,404)
        self.assertEqual(self.client.post('/api/time-entries',json={'person_id':foreign['id'],'worked_on':'2026-11-11','minutes':20}).status_code,400)
        company=self.client.post('/api/contractors',headers=headers,json={'name':'Fremde Firma'}).json['contractor']
        self.assertEqual(self.client.post('/api/time-people',json={'name':'X','contractor_id':company['id']}).status_code,400)

    def test_invalid_entries_rollback_without_losing_old_values(self):
        person=self.person();entry=self.entry(person,60)
        for changes in ({'minutes':0},{'minutes':-2},{'minutes':True},{'minutes':1.5},{'minutes':'20'},{'minutes':1441},{'worked_on':'2026-02-31'},{'worked_on':'20261111'},{'person_id':99999},{'project_id':self.other},{'description':'x'*2001}):
            result=self.client.patch('/api/time-entries/'+str(entry['id']),json=changes)
            self.assertEqual(result.status_code,400,(changes,result.json))
        self.assertEqual(self.client.get('/api/time-people/'+str(person['id'])).json['entries'][0]['minutes'],60)
        self.assertEqual(self.client.post('/api/time-entries',json={'person_id':person['id'],'worked_on':'2026-11-11','minutes':1400}).status_code,400)
        self.assertEqual(self.client.get('/api/time-tracking').json['people'][0]['entry_count'],1)

    def test_stale_edits_detect_changed_entries_and_keep_existing_data(self):
        person=self.person();entry=self.entry(person)
        path='/api/time-people/'+str(person['id'])
        token=self.client.get(path).json['_versions'][path]
        self.client.patch('/api/time-entries/'+str(entry['id']),json={'minutes':120})
        response=self.client.delete(path,headers={'If-Match':token})
        self.assertEqual(response.status_code,409)
        self.assertEqual(self.client.get(path).json['person']['total_minutes'],120)

    def test_person_validation_and_project_deletion_guard(self):
        for data in ({'name':''},{'kind':'company'},{'name':'X','kind':'unknown'},{'name':'X','contractor_id':True},{'name':'X','role':'a'*81},{'name':'X','project_id':self.other}):
            self.assertEqual(self.client.post('/api/time-people',json=data).status_code,400)
        self.assertEqual(self.client.get('/api/time-tracking').json['people'],[])
        person=self.person(self.other)
        state=self.client.get('/api/projects/'+str(self.other)).json['project']
        self.assertFalse(state['can_delete']);self.assertIn('Stundenerfassung',state['delete_reason'])
        self.assertEqual(self.client.get('/api/time-people/'+str(person['id']),headers={'X-PHB-Project':str(self.other)}).status_code,200)
