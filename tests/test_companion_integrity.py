"""Focused project isolation and financial/process integrity for the companion tools."""
import io
import json
import os
import unittest
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b


class CompanionIntegrityTest(unittest.TestCase):
    def setUp(self):
        self.ctx=b.app.app_context();self.ctx.push();b.db.session.remove();b.db.drop_all();b.initialize();self.c=b.app.test_client()
        self.other=self.c.post('/api/projects',json={'title':'Fremdes Projekt'}).json['project']['id']
        self.foreign={'X-PHB-Project':str(self.other)}

    def tearDown(self):
        b.db.session.remove();b.db.drop_all();self.ctx.pop()

    def record(self,**changes):
        result=self.c.post('/api/companion/records',json={'kind':'journal','title':'Dokumentation','data':{'document_ids':[]},**changes})
        self.assertEqual(result.status_code,201,result.json);return result.json['record']

    def receipt(self,amount=1000):
        uploaded=self.c.post('/api/receipts',data={'analysis_mode':'none','file':(io.BytesIO(b'%PDF-1.4\ncompanion invoice'),'Rechnung.pdf')},content_type='multipart/form-data')
        self.assertEqual(uploaded.status_code,201,uploaded.json);ident=uploaded.json['id']
        response=self.c.patch('/api/receipts/'+str(ident),json={'supplier':'Testfirma','document_date':'2026-11-19','gross_amount':amount,'assignment_type':'Eigenleistung','book_now':True})
        self.assertEqual(response.status_code,200,response.json);return ident

    def test_foreign_links_and_packages_do_not_leak(self):
        company=self.c.post('/api/contractors',headers=self.foreign,json={'name':'Fremd'}).json['contractor']['id']
        result=self.c.post('/api/companion/records',json={'kind':'defect','title':'Mangel','source_type':'company','source_id':company})
        self.assertEqual(result.status_code,400)
        from multi_projects import project_context
        with project_context(self.other):
            document=b.ProjectDocument(title='Fremde Unterlage',original_name='fremd.txt',stored_name='foreign-companion.txt',extension='.txt',digest='1'*64,size_bytes=1,category='Sonstiges',area='Allgemein')
            b.db.session.add(document);b.db.session.commit();did=document.id
        result=self.c.post('/api/companion/records',headers=self.foreign,json={'kind':'house','title':'Hausakte fremd','data':{'document_ids':[did]}})
        self.assertEqual(result.status_code,201,result.json)
        self.assertEqual(self.c.delete('/api/project-documents/'+str(did),headers=self.foreign).status_code,409)
        self.assertEqual(self.c.post('/api/companion/package',json={'document_ids':[did]}).status_code,400)
        own=self.record();path='/api/companion/records/'+str(own['id'])
        self.assertEqual(self.c.patch(path,headers=self.foreign,json={'title':'Falsch'}).status_code,404)
        self.assertEqual(len(self.c.get('/api/companion',headers=self.foreign).json['records']),1)
        self.assertEqual(self.c.post('/api/companion/package',json={'document_ids':[999999]}).status_code,400)

    def test_material_status_bulk_update_is_atomic(self):
        p=self.c.post('/api/self-work',json={'title':'Streichen','materials':[{'id':'a','title':'Farbe','quantity':2,'unit':'l','unit_price':10,'status':'Benötigt','notes':''}]}).json['plan']
        result=self.c.post('/api/companion/shopping/status',json={'status':'Vorhanden','items':[{'plan_id':p['id'],'row_id':'a'},{'plan_id':p['id'],'row_id':'missing'}]})
        self.assertEqual(result.status_code,400)
        self.assertEqual(self.c.get('/api/self-work/'+str(p['id'])).json['plan']['materials'][0]['status'],'Benötigt')
        self.assertEqual(self.c.post('/api/companion/shopping/status',json={'status':'Bestellt','items':[{'plan_id':p['id'],'row_id':'a'}]}).status_code,200)
        self.assertEqual(self.c.get('/api/companion/shopping').json['materials'][0]['status'],'Bestellt')

    def test_tile_plan_is_scoped_and_invalid_or_stale_updates_preserve_saved_plan(self):
        settings=dict(width=4000,height=3000,tileWidth=600,tileHeight=300,joint=3,edge=5,reserve=10,
                      rotated=False,pattern='half',start='center',offsetX=0,offsetY=0)
        row=self.record(kind='tile_plan',title='Bad',data={'settings':settings})
        path='/api/companion/records/'+str(row['id'])
        snapshot=self.c.get('/api/companion').json
        token=snapshot['_versions'][path]
        self.assertEqual(self.c.patch(path,headers=self.foreign,json={'title':'Fremd'}).status_code,404)
        invalid={**settings,'width':1}
        self.assertEqual(self.c.patch(path,json={'title':'Ungültig','data':{'settings':invalid}}).status_code,400)
        self.assertEqual(self.c.get('/api/companion').json['records'][0]['title'],'Bad')
        self.assertEqual(self.c.patch(path,json={'title':'Bad neu'},headers={'If-Match':token}).status_code,200)
        self.assertEqual(self.c.patch(path,json={'title':'Veraltet'},headers={'If-Match':token}).status_code,409)
        self.assertEqual(self.c.delete(path,headers={'If-Match':token}).status_code,409)
        own=self.c.get('/api/companion').json['records'][0]
        self.assertEqual(own['title'],'Bad neu');self.assertEqual(own['data']['settings'],settings)
        self.assertFalse(any(x['kind']=='tile_plan' for x in self.c.get('/api/companion',headers=self.foreign).json['records']))

    def test_planned_confirmed_hours_and_repeat_are_separate_and_no_duplicates(self):
        company=self.c.post('/api/contractors',json={'name':'Terminbetrieb'}).json['contractor']['id']
        response=self.c.post('/api/calendar-events',json={'title':'Arbeit','start_date':'2026-11-20','end_date':'2026-11-20','contractor_id':company,'performed':False})
        self.assertEqual(response.status_code,201,response.json);ident=response.json['event']['id']
        person=self.c.get('/api/time-tracking').json['people'][0]
        self.assertEqual((person['total_minutes'],person['planned_minutes']),(0,480))
        self.assertEqual(self.c.patch('/api/calendar-events/'+str(ident),json={'performed':True}).status_code,200)
        person=self.c.get('/api/time-tracking').json['people'][0];self.assertEqual((person['total_minutes'],person['planned_minutes']),(480,0))
        route='/api/calendar-events/'+str(ident)+'/repeat'
        response=self.c.post(route,json={'confirm':True,'count':2,'interval_days':7});self.assertEqual(response.status_code,201,response.json)
        self.assertEqual(self.c.post(route,json={'confirm':True,'count':2,'interval_days':7}).status_code,400)
        person=self.c.get('/api/time-tracking').json['people'][0];self.assertEqual((person['total_minutes'],person['planned_minutes']),(480,960))
        own=self.c.get('/api/calendar.ics').data.decode();foreign=self.c.get('/api/calendar.ics',headers=self.foreign).data.decode()
        self.assertEqual(own.count('BEGIN:VEVENT'),3);self.assertNotIn('SUMMARY:Arbeit',foreign)

    def test_addenda_change_one_order_without_double_counting(self):
        offer=self.c.post('/api/offers/manual',json={'vendor':'Testfirma','gross':1000,'category':'Sonstiges'}).json['offer']
        response=self.c.post('/api/offers/'+str(offer['id'])+'/accept',data={'mode':'offer','confirm':'true'})
        self.assertEqual(response.status_code,201,response.json)
        row=self.record(kind='addendum',source_type='offer',source_id=offer['id'],amount=100,status='Entwurf')
        route='/api/companion/records/'+str(row['id'])+'/decision'
        response=self.c.post(route,json={'approve':True,'confirm':True});self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(self.c.post(route,json={'approve':True,'confirm':True}).status_code,200)
        costs=self.c.get('/api/costs').json
        self.assertEqual(costs['summary']['planned'],1100);self.assertEqual(len(costs['items']),1)
        receipt=self.receipt(1100)
        response=self.c.patch('/api/receipts/'+str(receipt),json={'assignment_type':'Angebot','cost_item_id':costs['items'][0]['id']})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(self.c.get('/api/costs').json['summary']['planned'],1100)
        self.assertEqual(self.c.post('/api/offers/'+str(offer['id'])+'/reverse-acceptance',json={'confirm':True}).status_code,409)
        self.assertEqual(self.c.post(route,json={'approve':False,'confirm':True}).status_code,200)
        self.assertEqual(self.c.get('/api/costs').json['summary']['planned'],1100) # Actual invoice still exceeds original order.

    def test_discount_only_spends_cash_once_and_keeps_original(self):
        ident=self.receipt();terms='/api/receipts/'+str(ident)+'/terms'
        response=self.c.put(terms,json={'percent':2,'until':'2026-11-30'});self.assertEqual(response.status_code,200,response.json)
        account=self.c.post('/api/financing/equity',json={'name':'Baukonto','opening_balance':1000,'reserve':0}).json['id']
        route='/api/receipts/'+str(ident)+'/pay-discount';body={'confirm':True,'source':'equity','account_id':account,'payment_date':'2026-11-19','expected_payment':980,'expected_discount':20}
        self.assertEqual(self.c.post(route,json={**body,'expected_payment':979}).status_code,400)
        response=self.c.post(route,json=body);self.assertEqual(response.status_code,201,response.json)
        self.assertEqual(response.json['paid'],980);self.assertEqual(response.json['discount'],20)
        self.assertEqual(self.c.post(route,json=body).status_code,400)
        receipt=self.c.get('/api/receipts/'+str(ident)).json
        self.assertEqual(receipt['gross_amount'],1000);self.assertEqual(receipt['paid_amount'],980);self.assertEqual(receipt['counted_amount'],980)
        state=self.c.get('/api/financing').json;self.assertEqual(state['receipts'][0]['open'],0)
        self.assertEqual(sum(x['amount'] for x in state['payments']),980)
        self.assertEqual(state['equity'][0]['balance']['available'],20)
        self.assertEqual(self.c.delete('/api/financing/payments/'+str(state['payments'][0]['id'])).status_code,409)
        cancel='/api/receipts/'+str(ident)
        preview=self.c.get(cancel+'/cancel-preview').json
        response=self.c.post(cancel+'/cancel',json={'confirm':True,'plan_digest':preview['plan_digest']})
        self.assertEqual(response.status_code,200,response.json)
        preview=self.c.get(cancel+'/cancel-reversal-preview').json
        response=self.c.post(cancel+'/cancel-reversal',json={'confirm':True,'plan_digest':preview['plan_digest']})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(self.c.get('/api/financing').json['receipts'][0]['open'],0)
        self.assertEqual(self.c.post('/api/receipts/'+str(ident)+'/discount-reverse',json={'confirm':True}).status_code,200)
        self.assertEqual(self.c.get('/api/financing').json['receipts'][0]['open'],20)

    def test_recurrence_and_undo_do_not_duplicate_or_overwrite_later_edits(self):
        result=self.c.post('/api/project-work',json={'kind':'todo','title':'Wartung','repeat_days':30})
        self.assertEqual(result.status_code,201,result.json);ident=result.json['item']['id'];path='/api/project-work/'+str(ident)
        done=self.c.patch(path,json={'done':True}).json['item'];self.c.patch(path,json={'done':True})
        self.assertEqual(len(self.c.get('/api/project-work').json['items']),2)
        result=self.c.post(path+'/undo',json={'expected':done,'done':False});self.assertEqual(result.status_code,200,result.json)
        self.c.patch(path,json={'done':True});self.assertEqual(len(self.c.get('/api/project-work').json['items']),2)
        self.c.patch(path,json={'title':'Neu'})
        self.assertEqual(self.c.post(path+'/undo',json={'expected':done,'done':False}).status_code,409)
        self.assertEqual(self.c.delete(path).status_code,200)

    def test_templates_are_additive_scoped_and_idempotent(self):
        result=self.c.post('/api/projects',json={'title':'Garten mit Vorlage','template':'garten'})
        self.assertEqual(result.status_code,201,result.json);owner=result.json['project']['id'];headers={'X-PHB-Project':str(owner)}
        self.assertEqual(len(self.c.get('/api/project-work',headers=headers).json['items']),4)
        self.assertEqual(self.c.get('/api/project-work').json['items'],[])
        self.assertEqual(self.c.post('/api/companion/templates/apply',headers=headers,json={'template':'garten','confirm':True}).status_code,400)
        self.assertEqual(len(self.c.get('/api/self-work',headers=headers).json['plans']),1)
        self.assertEqual(self.c.get('/api/costs',headers=headers).json['summary']['planned'],0)
