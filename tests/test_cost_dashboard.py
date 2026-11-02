import os
import unittest
from datetime import date
from decimal import Decimal

os.environ['DATABASE_URL']='sqlite:///:memory:'
from app import (app,db,initialize,BudgetLine,BuildPhase,Contractor,CostItem,
                 Receipt,Task)


class CostDashboardTest(unittest.TestCase):
    def setUp(self):
        self.ctx=app.app_context();self.ctx.push()
        db.session.remove();db.drop_all();initialize()
        self.client=app.test_client()

    def tearDown(self):
        db.session.remove();self.ctx.pop()

    def test_legacy_cleanup_preserves_linked_receipts_and_rejects_stale_writes(self):
        line=BudgetLine(code='OLD',title='Alter Kostenplan',category='Sonstiges',estimate=500)
        db.session.add(line);db.session.flush()
        receipt=Receipt(digest='old-plan',original_name='beleg.pdf',stored_name='old.pdf',gross_amount=80,status='Storniert',budget_line_id=line.id)
        db.session.add(receipt);db.session.commit()
        path=f'/api/budget/lines/{line.id}/cleanup'
        result=self.client.get(path)
        version=result.json['_versions'][f'/api/budget/lines/{line.id}']
        self.assertFalse(result.json['can_delete'])
        self.assertEqual(self.client.delete(path).status_code,409)
        ref=result.json['references'][0]
        body={k:ref[k] for k in ('table','id','field')}
        detached=self.client.post(path,json=body,headers={'If-Match':version})
        self.assertEqual(detached.status_code,200,detached.json)
        self.assertTrue(detached.json['can_delete'])
        self.assertEqual(self.client.delete(path,headers={'If-Match':version}).status_code,409)
        self.assertEqual(db.session.get(Receipt,receipt.id).status,'Storniert')
        self.assertIsNone(db.session.get(Receipt,receipt.id).budget_line_id)
        self.assertEqual(self.client.delete(path).status_code,200)
        self.assertIsNotNone(db.session.get(Receipt,receipt.id))

    def test_legacy_list_includes_hidden_rows_and_manual_payments_are_protected(self):
        line=BudgetLine(code='HIDDEN',title='Inaktive Gruppe',category='Sonstiges',estimate=400,is_group=True,active=False)
        item=CostItem(title='Direkt bezahlt',category='Sonstiges',paid=60)
        db.session.add_all([line,item]);db.session.commit()
        listing=self.client.get('/api/cost-dashboard/legacy').json['rows']
        self.assertTrue(any(x['id']==line.id and x['kind']=='line' and not x['active'] for x in listing))
        path=f'/api/costs/{item.id}/cleanup'
        self.assertFalse(self.client.get(path).json['can_delete'])
        self.assertEqual(self.client.delete(path).status_code,409)
        self.assertEqual(db.session.get(CostItem,item.id).paid,60)

    def test_legacy_funding_and_subposition_links_are_detached_without_deletion(self):
        from app import Funding,FundingDetail
        line=BudgetLine(code='GROUP',title='Gruppe',category='Sonstiges',is_group=True)
        child=BudgetLine(code='CHILD',title='Unterposition',category='Sonstiges',parent_code='GROUP')
        funding=Funding(name='Förderung Altbestand',confirmed=200)
        db.session.add_all([line,child,funding]);db.session.flush()
        db.session.add(FundingDetail(funding_id=funding.id,budget_line_id=line.id));db.session.commit()
        path=f'/api/budget/lines/{line.id}/cleanup'
        refs=self.client.get(path).json['references']
        self.assertEqual(len(refs),2)
        self.assertTrue(any('Förderung Altbestand' in r['label'] for r in refs))
        other=self.client.post('/api/projects',json={'title':'Anderes Projekt'}).json['project']['id']
        self.assertEqual(self.client.delete(path,headers={'X-PHB-Project':str(other)}).status_code,404)
        for ref in refs:
            response=self.client.post(path,json={k:ref[k] for k in ('table','id','field')})
            self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(self.client.delete(path).status_code,200)
        self.assertEqual(db.session.get(Funding,funding.id).confirmed,200)
        self.assertEqual(db.session.get(BudgetLine,child.id).parent_code,'')

    def test_assigned_invoice_enriches_order_without_double_counting_forecast(self):
        phase=BuildPhase(title='Innenausbau',start_date=date(2027,5,1),position=1)
        company=Contractor(name='Musterbau GmbH',trade='Trockenbau')
        line=BudgetLine(code='T-1',category='Innenausbau',title='Trockenbau',
                        estimate=1000,kind='Fremdleistung',active=True)
        db.session.add_all([phase,company,line]);db.session.flush()
        task=Task(code='AP-1',name='Wände stellen',phase='Innenausbau',phase_id=phase.id,
                  trade='Trockenbau',execution_type='Fremdleistung',contractor_id=company.id)
        db.session.add(task);db.session.flush()
        item=CostItem(title='Trockenbauauftrag',category='Innenausbau',kind='Fremdleistung',
                      state='Beauftragt',committed=1200,offer=1200,selected=True,
                      budget_line_id=line.id,task_id=task.id,contractor_id=company.id)
        db.session.add(item);db.session.flush()
        db.session.add(Receipt(digest='a'*64,original_name='rechnung.pdf',stored_name='rechnung-a.pdf',
            supplier=company.name,invoice_number='R-1',gross_amount=Decimal('1500'),
            paid_amount=Decimal('200'),status='Gebucht',category='Innenausbau',
            assignment_type='Angebot',cost_item_id=item.id,contractor_id=company.id))
        db.session.commit()

        data=self.client.get('/api/cost-dashboard').get_json()
        row=next(row for row in data['dashboard']['rows'] if row['id']==f'line:{line.id}')
        self.assertEqual(row['forecast'],1500)
        self.assertEqual(row['committed'],1200)
        self.assertEqual(row['invoiced'],1500)
        self.assertEqual(row['paid'],200)
        self.assertEqual(row['trade'],'Trockenbau')
        self.assertEqual(row['phase'],'Innenausbau')
        self.assertIn('AP-1',row['task'])
        self.assertEqual(row['company'],'Musterbau GmbH')
        self.assertEqual(data['dashboard']['totals']['forecast'],1500)

    def test_unassigned_booked_receipt_and_draft_create_action_items(self):
        db.session.add_all([
            Receipt(digest='b'*64,original_name='bar.pdf',stored_name='bar-b.pdf',supplier='Baumarkt',
                    gross_amount=Decimal('300'),paid_amount=Decimal('300'),status='Gebucht',category='Material'),
            Receipt(digest='c'*64,original_name='offen.pdf',stored_name='offen-c.pdf',supplier='Planer',
                    gross_amount=Decimal('50'),status='Entwurf',category='Planung'),
        ])
        db.session.commit()

        dashboard=self.client.get('/api/cost-dashboard').get_json()['dashboard']
        row=next(row for row in dashboard['rows'] if row['id'].startswith('receipt:'))
        self.assertEqual(row['forecast'],300)
        self.assertEqual(row['invoiced'],300)
        self.assertEqual(row['paid'],300)
        kinds={issue['kind']:issue['count'] for issue in dashboard['issues']}
        self.assertEqual(kinds['drafts'],1)
        self.assertEqual(kinds['unassigned'],1)


if __name__=='__main__':unittest.main()
