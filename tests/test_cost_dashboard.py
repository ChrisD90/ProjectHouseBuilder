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
