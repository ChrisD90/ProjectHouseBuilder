"""No external OAuth or paid usage is ever executed by these tests."""
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs,urlsplit

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
from app import app,db,initialize,Offer,Task
from chatgpt_local import chatgpt, AIError, _write_secret, _read_secret
from sqlalchemy import select


class ChatGPTLocalTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.home=Path(self.temp.name)/'credentials'
        patcher=patch.dict(os.environ,{'PHB_CHATGPT_HOME':str(self.home)})
        patcher.start();self.addCleanup(patcher.stop)
        self.context=app.app_context();self.context.push()
        db.session.remove();db.drop_all();initialize()
        self.client=app.test_client()
        chatgpt._pending={}

    def tearDown(self):
        db.session.remove();db.drop_all();self.context.pop()

    def profile(self,sharing=True):
        _write_secret('profile.json',{'client_id':'oaiapp_test','subject':'subject-id','email':'local@example.test',
              'access_token':'very-secret-token','refresh_token':'never-in-browser',
              'id_token':'id-only-token','scopes':['openid','resource.invoke']+(['chatgpt.tokens.use.direct'] if sharing else []),
              'expires_at':9999999999})

    @staticmethod
    def headers():return {'X-PHB-AI':'1'}

    def test_no_credential_without_connect_and_read_only_status(self):
        response=self.client.get('/api/ai/status')
        self.assertEqual(response.status_code,200)
        self.assertFalse(response.json['connected'])
        self.assertNotIn('access_token',response.data.decode())
        self.assertFalse(self.home.exists() and (self.home/'profile.json').exists())
        self.assertEqual(self.client.post('/api/ai/connect',json={}).status_code,403)

    def test_local_dynamic_oauth_pkce_consent_callback_and_owner_only_tokens(self):
        result=self.client.post('/api/ai/connect',json={},headers=self.headers(),base_url='http://127.0.0.1:5055')
        self.assertEqual(result.status_code,200,result.json)
        url=result.json['authorize_url']
        self.assertTrue(url.startswith('https://auth.openai.com/api/accounts/authorize?'))
        params=parse_qs(urlsplit(url).query)
        self.assertEqual(params['client_id'],['dynamic_agent_client'])
        self.assertEqual(params['redirect_uri'],['http://127.0.0.1:5055/auth/callback'])
        self.assertEqual(params['code_challenge_method'],['S256'])
        self.assertIn('chatgpt.tokens.use.direct',params['scope'][0])
        with patch.object(chatgpt,'_token_request',return_value={
            'access_token':'sensitive-access','refresh_token':'sensitive-refresh',
            'id_token':'opaque-id','scope':'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
            'expires_in':3600}),patch.object(chatgpt,'_verify_identity',return_value={'sub':'subject-1','email':'owner@example.test'}):
            callback=self.client.get('/auth/callback?code=abc&state='+params['state'][0]+'&client_id=oaiapp_test',base_url='http://127.0.0.1:5055')
        self.assertEqual(callback.status_code,302)
        self.assertEqual(callback.headers['Location'],'/angebote?ai=connected')
        self.assertTrue(self.client.get('/api/ai/status').json['sharing'])
        self.assertNotIn('sensitive-access',json.dumps(self.client.get('/api/ai/status').json))
        self.assertEqual((self.home/'profile.json').stat().st_mode & 0o777,0o600)
        self.assertEqual(self.home.stat().st_mode & 0o777,0o700)
        self.assertEqual(self.client.get('/auth/callback?code=replay&state='+params['state'][0],base_url='http://127.0.0.1:5055').headers['Location'],'/angebote?ai=error')

    def test_untrusted_remote_and_origin_blocked_even_with_header(self):
        self.profile()
        res=self.client.post('/api/ai/connect',headers=self.headers(),json={},
                             base_url='http://192.168.1.12:5055',environ_base={'REMOTE_ADDR':'192.168.1.12'})
        self.assertEqual(res.status_code,403)
        r=self.client.post('/api/ai/connect',headers={**self.headers(),'Origin':'https://evil.invalid'},json={},
                           base_url='http://127.0.0.1:5055')
        self.assertEqual(r.status_code,403)
        r=self.client.post('/api/ai/connect',headers=self.headers(),json={},base_url='http://localhost:5055')
        self.assertEqual(r.status_code,403)

    def test_permission_and_confirmation_required_no_key_fallback(self):
        self.profile(sharing=False)
        self.assertFalse(self.client.get('/api/ai/status').json['sharing'])
        response=self.client.post('/api/ai/offers/compare',headers=self.headers(),json={'plan_only':True,'offer_ids':[1,2]})
        self.assertEqual(response.status_code,403)
        self.profile(sharing=True)
        no=self.client.post('/api/ai/offers/compare',headers=self.headers(),json={'offer_ids':[1,2]})
        self.assertEqual(no.status_code,403)
        self.assertIn('Credits',no.json['error'])

    def test_ai_pdf_only_explicit_consent_and_draft_not_forecast(self):
        self.profile()
        root=Path(self.temp.name)/'documents'
        blob=b'%PDF-1.4\nFile Content\n%%EOF'
        response_data=json.dumps({'vendor':'Elektro GmbH','number':'EL-999','gross':1190,'net':1000,'vat':190,
           'positions':[{'number':'1','description':'Schlitze und Kabel','section':'Elektro',
                        'quantity':2,'unit':'St','unit_price':500,'net_amount':1000,'optional':False,'page':1}],
            'warnings':['Positionen prüfen']})
        bad=self.client.post('/api/offers/import',data={'file':(io.BytesIO(blob),'a.pdf'),'analysis_mode':'ai','model':'m1'},content_type='multipart/form-data',headers=self.headers())
        self.assertEqual(bad.status_code,403,bad.json)
        with patch('app.DOCUMENT_ROOT',root), patch.object(chatgpt,'run',return_value=response_data) as run:
            good=self.client.post('/api/offers/import',data={'file':(io.BytesIO(blob),'a.pdf'),
                'analysis_mode':'ai','model':'m1','plan_only':'true'},content_type='multipart/form-data',headers=self.headers())
            self.assertEqual(good.status_code,201,good.json)
            self.assertEqual(good.json['offer']['status'],'Entwurf')
            self.assertEqual(good.json['offer']['gross'],1190)
            self.assertEqual(good.json['offer']['positions'][0]['description'],'Schlitze und Kabel')
            self.assertEqual(self.client.get('/api/costs').json['summary']['committed'],0)
            self.assertIn('input_file',str(run.call_args))

    def test_ai_compare_is_report_without_db_change(self):
        self.profile()
        ids=[]
        for vendor in ('Elektro A','Elektro B'):
            x=self.client.post('/api/offers/manual',json={'vendor':vendor,'gross':'1200','category':'Elektro'})
            self.assertEqual(x.status_code,201);ids.append(x.json['id'])
        with patch.object(chatgpt,'run',return_value='Analyse: B bietet mehr') as run:
            response=self.client.post('/api/ai/offers/compare',headers=self.headers(),json={'offer_ids':ids,'model':'m1','plan_only':True})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['analysis'],'Analyse: B bietet mehr')
        self.assertIn('Elektro B',str(run.call_args))
        self.assertEqual(self.client.get('/api/costs').json['summary']['committed'],0)

    def test_ai_schedule_preview_mutation_guard_and_confirmed_apply(self):
        self.profile()
        steps=[{'code':'KI01','name':'Haus entkernen','phase':'Rückbau','trade':'Rückbau','execution_type':'Eigenleistung',
               'duration':12,'lag_days':0,'notes':'Schadstoffe prüfen','predecessors':[]},
              {'code':'KI02','name':'Dach statisch prüfen','phase':'Dach','trade':'Statik','execution_type':'Fremdleistung',
               'duration':5,'lag_days':0,'notes':'Statiker','predecessors':['KI01']}]
        with patch.object(chatgpt,'run',return_value=json.dumps({'overview':'Eigenleistung prüfen','tasks':steps})):
            result=self.client.post('/api/ai/schedule/suggest',headers=self.headers(),json={'requirements':'Dachausbau','model':'m1','plan_only':True})
        self.assertEqual(result.status_code,200,result.json)
        self.assertTrue(result.json['can_apply'])
        self.assertEqual(self.client.get('/api/project').json['tasks'],[])
        tampered=[dict(x) for x in steps];tampered[0]['duration']=99
        no=self.client.post('/api/ai/schedule/apply',headers=self.headers(),json={'confirm':True,'tasks':tampered})
        self.assertEqual(no.status_code,409,no.json)
        good=self.client.post('/api/ai/schedule/apply',headers=self.headers(),json={'confirm':True,'tasks':result.json['tasks']})
        self.assertEqual(good.status_code,201,good.json)
        self.assertEqual(good.json['created'],2)
        self.assertEqual(len(self.client.get('/api/project').json['tasks']),2)
        self.assertEqual(self.client.post('/api/ai/schedule/apply',headers=self.headers(),json={'confirm':True,'tasks':steps}).status_code,409)

    def test_failed_stream_never_returns_partial_result(self):
        from chatgpt_local import ChatGPTLocal
        local=ChatGPTLocal()
        self.profile()
        class FakeResponse:
            status_code=200
            def __enter__(self):return self
            def __exit__(self,*_):return False
            def iter_lines(self,**_):
                yield b'data: {"type":"response.output_text.delta","delta":"partial"}'
        with patch.object(local,'models',return_value=[{'slug':'m1'}]),patch.object(local,'token',return_value='oauth'),patch('chatgpt_local.requests.post',return_value=FakeResponse()):
            with self.assertRaises(AIError):local.run('hi','instruction','m1')

if __name__=='__main__': unittest.main()
