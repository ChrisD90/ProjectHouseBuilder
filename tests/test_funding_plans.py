"""Persistent draft -> checklist -> opt-in AI report -> explicit expected amount."""
import io
import json
import os
from datetime import date,timedelta
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b
from multi_projects import project_context
from funding_estimates import BAFA_URL,KFW_URL


class FundingPlansTest(unittest.TestCase):
    def setUp(self):
        self.ctx=b.app.app_context();self.ctx.push();b.db.session.remove();b.db.drop_all();b.initialize();self.client=b.app.test_client()
        status=patch.object(b.chatgpt,'status',return_value={'sharing':True,'connected':True,'credits_acknowledged':True});status.start();self.addCleanup(status.stop)
        self.offer=self.client.post('/api/offers/manual',json={'vendor':'Fensterbau','gross':10000,'category':'Sonstiges'}).json['id']
        obj=b.db.session.get(b.Offer,self.offer);obj.net=10000/1.19;obj.vat=10000-obj.net
        b.db.session.add_all([b.OfferPosition(offer_id=obj.id,number='1',section='',description='Fenster Nord',net_amount=5000/1.19,optional=False),b.OfferPosition(offer_id=obj.id,number='2',section='',description='Fenster Süd',net_amount=5000/1.19,optional=False)]);b.db.session.commit()
        self.positions=[p.id for p in obj.positions]
        self.headers={'X-PHB-AI':'1'}

    def tearDown(self):
        b.db.session.remove();b.db.drop_all();self.ctx.pop()

    def inputs(self):
        return dict(program_key='bafa_envelope',measure='Dreifachverglaste Fenster erneuern, technische Kennwerte liegen vor',postcode='80331',units=1,ownership='private_owner',usage='self',building_application='1990-01-01',application_date=date.today().replace(year=date.today().year+1).isoformat(),contract='not_signed',started='no',vat_deductible='no',used_budget=0,cumulation_reviewed='yes',isfp='no',technical_verified='unknown',expert_involved='no',proof='missing')

    def create(self,full=True,positions=None,cost=10000):
        data={'name':'Fenster planen','inputs':self.inputs() if full else {'measure':'Fenster im Altbau erneuern'},'selections':[{'offer_id':self.offer,'position_ids':self.positions if positions is None else positions,'eligible_cost':cost}] if full else [],'document_ids':[],'plan_only':True}
        result=self.client.post('/api/funding/plans',headers=self.headers,json=data)
        self.assertEqual(result.status_code,201,result.json);return result.json

    def answer(self,phase='estimate',**changes):
        return dict(eligible=True,program_key='bafa_envelope',programs=[{'key':'bafa_envelope','reason':'Gebäudehülle fachlich prüfen.'}],amount_min=1000,amount_max=2000,explanation='Unverbindliche Einschätzung anhand der aktuellen Programmquelle.',missing=[],questions=[],assumptions=['Fachliche Bestätigung steht noch aus.'],sources=[{'title':'BAFA Gebäudehülle','url':BAFA_URL}],**changes)

    def check(self,ident,phase='estimate',answer=None):
        with patch.object(b.chatgpt,'run',return_value=json.dumps(answer or self.answer())) as run:
            result=self.client.post(f'/api/funding/plans/{ident}/check',headers=self.headers,json={'phase':phase,'consent':True,'plan_only':True,'model':'test'})
            return result,run

    def adopt(self,data,value=1500):
        return self.client.post(f"/api/funding/plans/{data['id']}/adopt",headers=self.headers,json={'token':data['report']['token'],'amount':value,'confirm':True,'plan_only':True})

    def test_draft_without_offer_or_formal_proof_is_saved_and_can_be_resumed_offline(self):
        data=self.create(full=False);ident=data['id']
        self.assertEqual(data['funding']['status'],'Geplant');self.assertEqual(data['funding']['expected'],0)
        self.assertTrue(data['checklist']['orientation_ready']);self.assertFalse(data['checklist']['estimate_ready'])
        with patch.object(b.chatgpt,'status',return_value={'sharing':False,'credits_acknowledged':False}):
            self.assertEqual(self.client.post('/api/funding/plans',json={'name':'Offline','plan_only':True},headers=self.headers).status_code,403)
            response=self.client.put(f'/api/funding/plans/{ident}',json={'name':'Später fortsetzen','answers':'Baujahr wird geklärt'})
            self.assertEqual(response.status_code,200,response.json)
            self.assertEqual(self.client.post(f'/api/funding/plans/{ident}/check',headers=self.headers,json={'phase':'orientation','consent':True,'plan_only':True}).status_code,403)
        self.assertEqual(self.client.get(f'/api/funding/plans/{ident}').json['answers'],'Baujahr wird geklärt')

    def test_orientation_returns_questions_but_never_a_monetary_proposal(self):
        data=self.create(full=False)
        answer=self.answer();answer.update(eligible=None,missing=['Gebäudealter'],questions=['Wann wurde der Bauantrag gestellt?'])
        response,run=self.check(data['id'],'orientation',answer)
        self.assertEqual(response.status_code,200,response.json)
        report=response.json['report'];self.assertIsNone(report['amount_min']);self.assertTrue(report['questions'])
        self.assertEqual(response.json['funding']['expected'],0)
        self.assertEqual(self.adopt(response.json).status_code,400)
        self.assertTrue(run.call_args.kwargs['web_search'])

    def test_checklist_allows_missing_tpb_and_expert_but_blocks_missing_costs_and_started_work(self):
        data=self.create();self.assertTrue(data['checklist']['estimate_ready'])
        warnings={c['key'] for c in data['checklist']['items'] if c['status']=='confirm'}
        self.assertTrue({'expert','proof','technical'}<=warnings)
        for updates in ({'started':'yes'},{'contract':'unconditional'},{'cumulation_reviewed':'no'}):
            inputs={**self.inputs(),**updates}
            self.client.put(f"/api/funding/plans/{data['id']}",json={'inputs':inputs})
            result,run=self.check(data['id']);self.assertEqual(result.status_code,422,result.json);run.assert_not_called()
        self.client.put(f"/api/funding/plans/{data['id']}",json={'selections':[]})
        result,run=self.check(data['id']);self.assertEqual(result.status_code,422);run.assert_not_called()

    def test_report_is_persisted_and_adoption_changes_only_expected_amount(self):
        data=self.create();response,_=self.check(data['id']);self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['funding']['expected'],0)
        self.assertFalse(response.json['report_stale'])
        self.assertTrue(any('TPB' in s for s in response.json['report']['assumptions']))
        before=[b.db.session.query(m).count() for m in (b.FinancingEvent,b.ReceiptFinancingPayment,b.Loan)]
        result=self.adopt(response.json);self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(result.json['funding']['expected'],1500);self.assertEqual(result.json['funding']['status'],'In Prüfung')
        self.assertEqual(result.json['funding']['confirmed'],0);self.assertEqual(result.json['funding']['received'],0)
        self.assertEqual([b.db.session.query(m).count() for m in (b.FinancingEvent,b.ReceiptFinancingPayment,b.Loan)],before)
        resumed=self.client.get(f"/api/funding/plans/{data['id']}").json
        self.assertEqual(resumed['adopted_report']['report']['token'],response.json['report']['token'])
        self.assertEqual(resumed['adopted_report']['amount'],1500)

    def test_cost_and_position_selection_is_bounded_and_only_selected_text_is_sent(self):
        data=self.create(positions=self.positions[:1],cost=5000)
        result,run=self.check(data['id']);self.assertEqual(result.status_code,200,result.json)
        payload=json.loads(run.call_args.args[0]);self.assertEqual([p['id'] for p in payload['plan']['offers'][0]['positions']],self.positions[:1])
        for selection in ({'offer_id':self.offer,'position_ids':[999999],'eligible_cost':5},{'offer_id':self.offer,'position_ids':self.positions,'eligible_cost':10001}):
            response=self.client.put(f"/api/funding/plans/{data['id']}",json={'selections':[selection]})
            self.assertEqual(response.status_code,400)
        self.assertEqual(self.adopt(result.json,value=9999).status_code,400)
        self.assertEqual(self.client.get(f"/api/funding/plans/{data['id']}").json['selections'][0]['eligible_cost'],5000)

    def test_changed_inputs_offers_or_old_report_block_adoption_but_preserve_previous_expected(self):
        data=self.create();response,_=self.check(data['id']);self.assertEqual(self.adopt(response.json).status_code,200)
        obj=b.db.session.get(b.Offer,self.offer);obj.current_version+=1;b.db.session.commit()
        resumed=self.client.get(f"/api/funding/plans/{data['id']}").json
        self.assertTrue(resumed['report_stale']);self.assertTrue(resumed['adopted_stale'])
        self.assertEqual(resumed['funding']['expected'],1500);self.assertEqual(self.adopt(resumed).status_code,400)
        response,_=self.check(data['id']);self.assertEqual(response.status_code,200)
        plan=b.db.session.get(b.FundingPlan,data['id']);report=json.loads(plan.report);report['checked_on']=(date.today()-timedelta(days=8)).isoformat();plan.report=json.dumps(report);b.db.session.commit()
        self.assertEqual(self.adopt(response.json).status_code,400)

    def test_overlapping_costs_cannot_be_adopted_twice_but_disjoint_positions_can(self):
        first=self.create(positions=self.positions[:1],cost=5000);checked,_=self.check(first['id']);self.assertEqual(self.adopt(checked.json,1000).status_code,200)
        duplicate=self.create(positions=self.positions[:1],cost=5000);checked,_=self.check(duplicate['id']);self.assertEqual(self.adopt(checked.json,1000).status_code,400)
        separate=self.create(positions=self.positions[1:],cost=5000);checked,_=self.check(separate['id']);self.assertEqual(self.adopt(checked.json,1000).status_code,200)

    def test_invalid_or_unsubstantiated_ai_results_do_not_create_usable_reports(self):
        data=self.create()
        for changes in ({'sources':[]},{'amount_max':10001},{'amount_min':-1},{'program_key':'kfw_458'},{'eligible':'yes'}):
            answer=self.answer();answer.update(changes)
            result,_=self.check(data['id'],answer=answer);self.assertEqual(result.status_code,400,result.json)
        self.assertEqual(self.client.get(f"/api/funding/plans/{data['id']}").json['report'],{})
        answer=self.answer();answer.update(eligible=None,amount_min=None,amount_max=None,missing=['Technik fehlt'])
        result,_=self.check(data['id'],answer=answer);self.assertEqual(result.status_code,200,result.json)
        self.assertIsNone(result.json['report']['amount_min']);self.assertEqual(self.adopt(result.json).status_code,400)

    def test_changed_basis_during_network_call_does_not_overwrite_report(self):
        data=self.create()
        def change(*args,**kwargs):
            row=b.db.session.get(b.Funding,data['id']);row.notes='Zwischenzeitlich geändert';b.db.session.commit();return json.dumps(self.answer())
        with patch.object(b.chatgpt,'run',side_effect=change):
            result=self.client.post(f"/api/funding/plans/{data['id']}/check",headers=self.headers,json={'phase':'estimate','consent':True,'plan_only':True})
        self.assertEqual(result.status_code,409,result.json)
        self.assertEqual(self.client.get(f"/api/funding/plans/{data['id']}").json['report'],{})
        result,_=self.check(data['id']);self.assertEqual(result.status_code,200,result.json)

    def test_foreign_project_plans_offers_and_documents_are_rejected(self):
        data=self.create();other=self.client.post('/api/projects',json={'title':'Anderes Projekt'}).json['project']['id'];headers={**self.headers,'X-PHB-Project':str(other)}
        self.assertEqual(self.client.get(f"/api/funding/plans/{data['id']}",headers=headers).status_code,404)
        self.assertEqual(self.client.put(f"/api/funding/plans/{data['id']}",headers=headers,json={'name':'Falsch'}).status_code,404)
        self.assertEqual(self.client.post('/api/funding/plans',headers=headers,json={'name':'Fremde Angebote','selections':[{'offer_id':self.offer,'position_ids':[],'eligible_cost':1}],'plan_only':True}).status_code,400)
        self.assertEqual(self.client.get('/api/funding/plans/options',headers=headers).json['offers'],[])
        self.assertEqual(self.client.post(f"/api/funding/plans/{data['id']}/check",headers=headers,json={'phase':'orientation','consent':True,'plan_only':True}).status_code,404)

    def test_multiple_offers_share_one_plan_and_cost_basis(self):
        data=self.create()
        other=self.client.post('/api/offers/manual',json={'vendor':'Zweiter Betrieb','gross':5000,'category':'Sonstiges'}).json['id']
        response=self.client.put(f"/api/funding/plans/{data['id']}",json={'selections':[{'offer_id':self.offer,'position_ids':self.positions,'eligible_cost':10000},{'offer_id':other,'position_ids':[],'eligible_cost':5000}]})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['checklist']['eligible_cost'],15000)
        self.assertEqual(len(response.json['selections']),2)
        result,run=self.check(data['id']);self.assertEqual(result.status_code,200)
        self.assertEqual(len(json.loads(run.call_args.args[0])['plan']['offers']),2)
        self.assertEqual(self.client.delete(f'/api/offers/{other}').status_code,409)

    def test_consent_gate_and_heating_only_personal_fields(self):
        data=self.create()
        response=self.client.post(f"/api/funding/plans/{data['id']}/check",headers=self.headers,json={'phase':'estimate','plan_only':True})
        self.assertEqual(response.status_code,400)
        i=self.inputs();i.update(program_key='kfw_458',old_heating='Ölheizung',new_heating='Wärmepumpe',old_heating_year=1995,natural_refrigerant='yes',bonus_requested='no',household_income=25000,children=1)
        saved=self.client.put(f"/api/funding/plans/{data['id']}",json={'inputs':i})
        self.assertTrue(saved.json['checklist']['estimate_ready'])
        self.assertNotIn('household_income',saved.json['inputs']);self.assertNotIn('isfp',saved.json['inputs'])
        answer=self.answer();answer.update(program_key='kfw_458',sources=[{'title':'KfW','url':KFW_URL}])
        result,_=self.check(data['id'],answer=answer);self.assertEqual(result.status_code,200,result.json)
        with patch.object(b.chatgpt,'status',return_value={'sharing':False,'credits_acknowledged':False}):
            self.assertEqual(self.adopt(result.json).status_code,403)
        self.assertEqual(self.client.get(f"/api/funding/plans/{data['id']}").json['funding']['expected'],0)

    def test_project_backup_restores_plan_selection_report_and_accepted_basis(self):
        import project_backups
        data=self.create();checked,_=self.check(data['id']);self.assertEqual(self.adopt(checked.json).status_code,200)
        expected=self.client.get(f"/api/funding/plans/{data['id']}").json
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)/'app';root.mkdir();store=Path(temporary)/'backups';store.mkdir()
            archive=project_backups.create(b.db,root,1,{'folder':store,'keep':2})
            self.client.put(f"/api/funding/plans/{data['id']}",json={'notes':'Nachträglich geändert','selections':[]})
            project_backups.restore(archive,b.db,root,1)
        restored=self.client.get(f"/api/funding/plans/{data['id']}").json
        self.assertEqual(restored['selections'],expected['selections'])
        self.assertEqual(restored['report'],expected['report']);self.assertEqual(restored['adopted_report'],expected['adopted_report'])
        self.assertFalse(restored['report_stale']);self.assertFalse(restored['adopted_stale'])
        self.assertEqual(restored['funding']['expected'],1500)

    def test_plan_links_block_offer_delete_and_are_removed_with_funding(self):
        data=self.create();self.assertEqual(self.client.delete(f'/api/offers/{self.offer}').status_code,409)
        self.assertEqual(self.client.delete(f"/api/funding/{data['id']}").status_code,200)
        self.assertEqual(b.db.session.query(b.FundingPlanOffer).count(),0);self.assertEqual(b.db.session.query(b.FundingPlan).count(),0)
        self.assertEqual(self.client.delete(f'/api/offers/{self.offer}').status_code,200)
