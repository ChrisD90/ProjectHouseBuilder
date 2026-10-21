"""Startbar ohne zusätzliche Pakete: python -m unittest discover -s tests -v"""
from datetime import date
from types import SimpleNamespace as Obj
import unittest
from scheduler import schedule
from financials import forecast_lines, monetary_totals


def task(i, duration, *, predecessor=None, lag=0, earliest=None):
    return Obj(id=i, duration=duration, lag_days=lag, earliest_start=earliest,
               dependencies=[Obj(predecessor_id=x) for x in (predecessor or [])])


def line(i, estimate, *, active=True, group=False):
    return Obj(id=i, estimate=estimate, active=active, is_group=group)


def item(i, line_id, *, state='Angebot', selected=False, estimate=0,
         offer=0, committed=0, paid=0):
    return Obj(id=i, budget_line_id=line_id, state=state, selected=selected,
               estimate=estimate, offer=offer, committed=committed, paid=paid)


class ScheduleTest(unittest.TestCase):
    def test_first_and_next_date(self):
        plan=schedule([task(1,4),task(2,2,predecessor=[1])],date(2027,3,1))
        self.assertEqual(plan[1],(date(2027,3,1),date(2027,3,4)))
        self.assertEqual(plan[2],(date(2027,3,5),date(2027,3,6)))

    def test_multiple_predecessors_lag(self):
        tasks=[task(1,4),task(2,8),task(3,2,predecessor=[1,2],lag=3)]
        self.assertEqual(schedule(tasks,date(2027,3,1))[3][0],date(2027,3,12))

    def test_earliest_date(self):
        self.assertEqual(schedule([task(1,1,earliest=date(2027,4,1))],date(2027,3,1))[1][0],date(2027,4,1))

    def test_cycle_rejected(self):
        with self.assertRaisesRegex(ValueError,'Zirkuläre'):
            schedule([task(1,1,predecessor=[2]),task(2,1,predecessor=[1])],date(2027,3,1))

    def test_missing_predecessor_rejected(self):
        with self.assertRaisesRegex(ValueError,'Vorgänger'):
            schedule([task(1,1,predecessor=[99])],date(2027,3,1))

    def test_negative_lag_rejected(self):
        with self.assertRaises(ValueError):
            schedule([task(1,1,lag=-1)],date(2027,3,1))


class FinancialTest(unittest.TestCase):
    def test_empty_budget_uses_estimates(self):
        s=monetary_totals([line(1,200),line(2,300)],[])
        self.assertEqual(s['forecast'],500)

    def test_selected_offer_replaces_estimate(self):
        entries=[item(1,1,selected=True,offer=350),item(2,1,offer=450)]
        s=monetary_totals([line(1,500)],entries)
        self.assertEqual(s['forecast'],350)

    def test_unselected_alternatives_do_not_double_count(self):
        entries=[item(1,1,selected=True,offer=350),item(2,1,state='Alternative',offer=900)]
        self.assertEqual(monetary_totals([line(1,500)],entries)['forecast'],350)

    def test_committed_overrides_offers(self):
        entries=[item(1,1,state='Beauftragt',committed=400),item(2,1,selected=True,offer=550)]
        self.assertEqual(monetary_totals([line(1,500)],entries)['forecast'],400)

    def test_partial_commissioned_sum(self):
        entries=[item(1,1,state='Beauftragt',committed=200),item(2,1,state='Beauftragt',committed=270)]
        self.assertEqual(monetary_totals([line(1,500)],entries)['forecast'],470)

    def test_group_inactive_and_extras(self):
        entries=[item(1,None,offer=77),item(2,1,selected=True,offer=100)]
        s=monetary_totals([line(1,200),line(2,1000,group=True),line(3,900,active=False)],entries)
        self.assertEqual(s['forecast'],177)

    def test_paid_never_hidden_and_no_double_count(self):
        entries=[item(1,1,state='Beauftragt',committed=400,paid=350),item(2,1,state='Alternative',paid=10)]
        s=monetary_totals([line(1,500)],entries)
        self.assertEqual(s['forecast'],400)
        self.assertEqual(s['paid'],360)
        self.assertEqual(s['committed'],400)


if __name__ == '__main__':
    unittest.main()
