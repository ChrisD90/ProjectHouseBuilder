"""Factories share Gantt bindings without leaking them across page visits."""
import unittest
from app import app
from page_modules import PAGE_MODULES,page_module

class PageModulesTest(unittest.TestCase):
    def test_all_entries_are_factories_and_unknown_names_are_rejected(self):
        client=app.test_client()
        for name in PAGE_MODULES:
            with self.subTest(page=name):
                response=client.get('/page-modules/'+name+'.js')
                self.assertEqual(response.status_code,200)
                self.assertIn('export function mount(scope)',response.text)
                self.assertIn('text/javascript',response.content_type)
                self.assertEqual(client.get('/page-modules/'+name+'.js',headers={
                    'If-None-Match':response.headers['ETag']}).status_code,304)
        self.assertEqual(client.get('/page-modules/unknown.js').status_code,404)
        self.assertIsNone(page_module('../app'))

    def test_gantt_factory_includes_companions_in_dependency_order(self):
        source=page_module('zeitplan')
        self.assertLess(source.index('let project='),source.index('window.PHBTaskCompletion='))
        self.assertIn('window.reloadSchedule=reload',source)
        self.assertIn('phb-schedule-updated',source)
