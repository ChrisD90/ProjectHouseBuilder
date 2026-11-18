"""Project calendar CRUD, trade references, backup compatibility and scope."""
import os
import unittest
from datetime import date
os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
import app as b
from multi_projects import project_context


class ProjectCalendarTest(unittest.TestCase):
    def setUp(self):
        self.context = b.app.app_context(); self.context.push()
        b.db.session.remove(); b.db.drop_all(); b.initialize()
        self.client = b.app.test_client()
        self.other = self.client.post('/api/projects', json={'title': 'Garten'}).json['project']['id']
        self.trade = self.client.post('/api/trades', json={'name': 'Kalender Treppenbau'}).json['id']

    def tearDown(self):
        b.db.session.remove(); b.db.drop_all(); self.context.pop()

    def create(self, owner=1, **changes):
        result = self.client.post('/api/calendar-events', headers={'X-PHB-Project': str(owner)}, json={
            'title': 'Treppenbauer – Aufmaß', 'start_date': '2026-11-23', 'end_date': '2026-11-24',
            'trade_ids': [self.trade] if owner == 1 else [], **changes})
        self.assertEqual(result.status_code, 201, result.json)
        return result.json['event']

    def test_crud_dates_trades_and_inclusive_range(self):
        event = self.create(); path = '/api/calendar-events/' + str(event['id'])
        self.assertEqual(event['trades'][0]['name'], 'Kalender Treppenbau')
        self.assertIn(path, self.client.get('/api/calendar-events').json['_versions'])
        self.assertEqual(len(self.client.get('/api/calendar-events?from=2026-11-24&to=2026-11-24').json['events']), 1)
        self.assertEqual(self.client.get('/api/calendar-events?from=2026-11-25&to=2026-12-01').json['events'], [])
        result = self.client.patch(path, json={'all_day': False, 'start_time': '08:15', 'end_time': '10:00', 'trade_ids': [self.trade], 'notes': 'Klingeln'})
        self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(result.json['event']['start_time'], '08:15')
        self.assertEqual(self.client.patch(path, json={'all_day': True, 'trade_ids': []}).json['event']['start_time'], '')
        self.assertEqual(self.client.delete(path).status_code, 200)
        self.assertEqual(b.db.session.query(b.CalendarEventTrade).count(), 0)
        self.assertEqual(self.client.get(path).status_code, 404)

    def test_invalid_dates_times_links_do_not_change_stored_event(self):
        event = self.create(); path = '/api/calendar-events/' + str(event['id'])
        for changes in ({'title': ''}, {'title': 'a'*161}, {'start_date': '2026-02-30'}, {'start_date': '20261123'},
                        {'end_date': '2026-11-22'}, {'all_day': 'false'}, {'all_day': False, 'start_time': '08:00'},
                        {'all_day': False, 'start_time': '9:00', 'end_time': '10:00'},
                        {'all_day': False, 'start_time': '11:00', 'end_time': '10:00', 'end_date': '2026-11-23'},
                        {'trade_ids': [True]}, {'trade_ids': [self.trade, self.trade]}, {'trade_ids': [99999]},
                        {'project_id': self.other}, {'notes': 'a'*4001}):
            self.assertEqual(self.client.patch(path, json=changes).status_code, 400, changes)
        self.assertEqual(self.client.get(path).json['event'], event)
        self.assertEqual(self.client.get('/api/calendar-events?from=2026-11-24&to=2026-11-23').status_code, 400)
        self.assertEqual(self.client.get('/api/calendar-events?from=2026-11-24').status_code, 400)

    def test_project_isolation_lifecycle_and_legacy_schedule_untouched(self):
        own = self.create(); foreign = self.create(self.other)
        foreign_trade = self.client.post('/api/trades', headers={'X-PHB-Project': str(self.other)}, json={'name': 'Gartenbau'}).json['id']
        self.assertEqual([e['id'] for e in self.client.get('/api/calendar-events').json['events']], [own['id']])
        path = '/api/calendar-events/' + str(foreign['id'])
        for method in ('get', 'patch', 'delete'):
            self.assertEqual(getattr(self.client, method)(path, json={'title': 'Falsch'}).status_code, 404)
        self.assertEqual(self.client.patch('/api/calendar-events/' + str(own['id']), json={'trade_ids': [foreign_trade]}).status_code, 400)
        self.assertIn('Kalendertermine', self.client.get('/api/projects/' + str(self.other)).json['project']['delete_reason'])
        task = b.Task(code='BESTAND', name='Bestand', duration=3)
        # Existing work packages are separate entities, never converted/deleted by calendar operations.
        b.db.session.add(task); b.db.session.commit(); ident = task.id
        self.client.delete('/api/calendar-events/' + str(own['id']))
        self.assertIsNotNone(b.db.session.get(b.Task, ident))

    def test_linked_trade_rename_delete_and_defaults(self):
        event = self.create()
        self.assertEqual(self.client.patch('/api/trades/' + str(self.trade), json={'name': 'Treppenmontage'}).status_code, 200)
        self.assertEqual(self.client.get('/api/calendar-events').json['events'][0]['trades'][0]['name'], 'Treppenmontage')
        self.assertEqual(self.client.delete('/api/trades/' + str(self.trade)).status_code, 409)
        result = self.client.post('/api/trades/restore-defaults', json={'confirm': True})
        self.assertEqual(result.status_code, 200, result.json)
        self.assertIn('Treppenmontage', result.json['preserved'])
        self.client.delete('/api/calendar-events/' + str(event['id']))
        self.assertEqual(self.client.delete('/api/trades/' + str(self.trade)).status_code, 200)

    def test_stale_changes_are_rejected_including_trade_links(self):
        event = self.create(); path = '/api/calendar-events/' + str(event['id'])
        token = self.client.get(path).json['_versions'][path]
        self.client.patch(path, json={'trade_ids': []})
        self.assertEqual(self.client.patch(path, json={'title': 'Veraltet'}, headers={'If-Match': token}).status_code, 409)
        self.assertEqual(self.client.get(path).json['event']['title'], event['title'])
