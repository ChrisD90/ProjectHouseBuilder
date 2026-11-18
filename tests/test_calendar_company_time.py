"""Calendar/company hours stay atomic, project-owned and distinct from manual entries."""
import os
import unittest
os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
import app as b


class CalendarCompanyTimeTest(unittest.TestCase):
    def setUp(self):
        self.context = b.app.app_context(); self.context.push()
        b.db.session.remove(); b.db.drop_all(); b.initialize()
        self.client = b.app.test_client()
        self.company = self.client.post('/api/contractors', json={'name': 'Treppenbau Zeit'}).json['contractor']['id']
        self.second = self.client.post('/api/contractors', json={'name': 'Putzer Zeit'}).json['contractor']['id']

    def tearDown(self):
        b.db.session.remove(); b.db.drop_all(); self.context.pop()

    def event(self, **changes):
        response = self.client.post('/api/calendar-events', json={
            'title': 'Montage', 'start_date': '2026-11-23', 'end_date': '2026-11-23',
            'all_day': False, 'start_time': '08:15', 'end_time': '10:45',
            'contractor_id': self.company, **changes})
        self.assertEqual(response.status_code, 201, response.json)
        return response.json['event']

    def people(self):
        return self.client.get('/api/time-tracking').json['people']

    def entries(self, person):
        return self.client.get('/api/time-people/'+str(person['id'])).json['entries']

    def test_reuses_company_card_updates_in_place_and_preserves_manual_entries(self):
        person = self.client.post('/api/time-people', json={'kind': 'company', 'contractor_id': self.company}).json['person']
        manual = self.client.post('/api/time-entries', json={'person_id': person['id'], 'worked_on': '2026-11-23', 'minutes': 60, 'description': 'Manuell'}).json['entry']
        event = self.event(); path = '/api/calendar-events/'+str(event['id'])
        self.assertEqual(len(self.people()), 1)
        self.assertEqual(self.people()[0]['total_minutes'], 210)
        linked = next(e for e in self.entries(person) if e['calendar_event_id'])
        self.assertEqual(linked['minutes'], 150); self.assertFalse(linked['calendar_flat_rate'])
        for _ in range(2):
            self.assertEqual(self.client.patch(path, json={'title': 'Montage korrigiert', 'end_time': '11:15'}).status_code, 200)
        self.assertEqual(len(self.entries(person)), 2)
        same = next(e for e in self.entries(person) if e['calendar_event_id'])
        self.assertEqual(same['id'], linked['id']); self.assertEqual(same['minutes'], 180)
        self.assertEqual(same['description'], 'Montage korrigiert')
        self.assertEqual(self.client.delete(path).status_code, 200)
        self.assertEqual([e['id'] for e in self.entries(person)], [manual['id']])
        self.assertFalse(self.people()[0]['has_calendar_entries'])

    def test_ganztags_pauschale_multiday_move_and_company_reassignment(self):
        event = self.event(all_day=True, end_date='2026-11-25')
        person = self.people()[0]
        self.assertEqual(person['total_minutes'], 1440)
        self.assertEqual([e['minutes'] for e in self.entries(person)], [480]*3)
        self.assertTrue(all(e['calendar_flat_rate'] for e in self.entries(person)))
        path = '/api/calendar-events/'+str(event['id'])
        response = self.client.patch(path, json={'start_date': '2026-12-01', 'end_date': '2026-12-01', 'contractor_id': self.second})
        self.assertEqual(response.status_code, 200, response.json)
        cards = self.people(); self.assertEqual(next(p for p in cards if p['contractor_id'] == self.company)['total_minutes'], 0)
        new = next(p for p in cards if p['contractor_id'] == self.second)
        self.assertEqual(new['total_minutes'], 480)
        self.assertEqual(self.entries(new)[0]['worked_on'], '2026-12-01')
        self.assertEqual(response.json['event']['company_name'], 'Putzer Zeit')

    def test_overnight_midnight_and_daily_minutes(self):
        event = self.event(start_time='23:30', end_time='01:15', end_date='2026-11-24')
        entries = self.entries(self.people()[0]); self.assertEqual([e['minutes'] for e in entries], [75, 30])
        response = self.client.patch('/api/calendar-events/'+str(event['id']), json={'end_date': '2026-11-25', 'end_time': '00:00'})
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual([e['minutes'] for e in self.entries(self.people()[0])], [1440, 30])

    def test_switch_to_trade_removes_only_generated_time_and_locks_linked_edits(self):
        event = self.event(); person = self.people()[0]; entry = self.entries(person)[0]
        self.assertEqual(self.client.patch('/api/time-entries/'+str(entry['id']), json={'minutes': 2}).status_code, 409)
        self.assertEqual(self.client.delete('/api/time-entries/'+str(entry['id'])).status_code, 409)
        self.assertEqual(self.client.delete('/api/time-people/'+str(person['id'])).status_code, 409)
        self.assertEqual(self.client.patch('/api/time-people/'+str(person['id']), json={'contractor_id': self.second}).status_code, 400)
        self.assertEqual(self.client.delete('/api/contractors/'+str(self.company)).status_code, 409)
        trade = self.client.get('/api/trades').json['trades'][0]['id']
        path = '/api/calendar-events/'+str(event['id'])
        self.assertEqual(self.client.patch(path, json={'trade_ids': [trade]}).status_code, 400)
        response = self.client.patch(path, json={'contractor_id': None, 'trade_ids': [trade]})
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(self.entries(person), [])
        self.assertEqual(self.client.delete('/api/time-people/'+str(person['id'])).status_code, 200)

    def test_foreign_company_rejected_and_failed_update_is_atomic(self):
        other = self.client.post('/api/projects', json={'title': 'Anderes Projekt'}).json['project']['id']
        headers = {'X-PHB-Project': str(other)}
        foreign = self.client.post('/api/contractors', headers=headers, json={'name': 'Fremd'}).json['contractor']['id']
        event = self.event(); path = '/api/calendar-events/'+str(event['id'])
        for value in (True, '1', foreign, -1):
            self.assertEqual(self.client.patch(path, json={'contractor_id': value}).status_code, 400)
        self.assertEqual(self.client.patch(path, json={'end_date': '2029-01-01'}).status_code, 400)
        self.assertEqual(self.client.get(path).json['event'], event)
        self.assertEqual(self.people()[0]['total_minutes'], 150)
        self.assertEqual(self.client.get('/api/time-tracking', headers=headers).json['people'], [])
        self.assertEqual(self.client.get('/api/calendar-events', headers=headers).json['events'], [])

    def test_separate_appointments_do_not_overwrite_each_other(self):
        first = self.event(); second = self.event(title='Besprechung')
        self.assertEqual(len(self.people()), 1); person = self.people()[0]
        self.assertEqual(len(self.entries(person)), 2); self.assertEqual(person['total_minutes'], 300)
        self.client.delete('/api/calendar-events/'+str(first['id']))
        self.assertEqual(self.entries(person)[0]['calendar_event_id'], second['id'])
