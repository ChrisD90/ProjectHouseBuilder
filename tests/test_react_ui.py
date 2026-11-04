"""The new app frame and retained workflows share authenticated server APIs."""
import os
import unittest
from pathlib import Path
from unittest.mock import patch
from app import app

class ReactUITest(unittest.TestCase):
    def test_browser_routes_serve_built_react_app(self):
        with patch.dict(os.environ,{'PHB_UI':'react'}):
            client=app.test_client()
            for path in ('/','/kosten','/angebote','/belege','/finanzierung','/energieplanung','/stammdaten','/dokumente','/daten','/aufgaben'):
                with self.subTest(path=path):
                    response=client.get(path)
                    self.assertEqual(response.status_code,200)
                    self.assertIn('id="root"',response.text)
                    self.assertIn('/static/react/assets/',response.text)
                    self.assertNotIn('id="phbSidebar"',response.text)
                    self.assertIn('no-store',response.headers['Cache-Control'])

    def test_isolated_workflows_remain_available_without_nested_app_frame(self):
        with patch.dict(os.environ,{'PHB_UI':'react'}):
            response=app.test_client().get('/belege?_classic=1&_embedded=1')
            self.assertIn('id="receiptWorkflowDialog"',response.text)
            self.assertNotIn('id="root"',response.text)
            self.assertIn('/static/embed.js',response.text)
            self.assertIn('/static/embed.css',response.text)

    def test_classic_mode_is_explicit_and_does_not_change_api_contracts(self):
        with patch.dict(os.environ,{'PHB_UI':'classic'}):
            self.assertIn('id="phbSidebar"',app.test_client().get('/').text)
        source=(Path(__file__).resolve().parents[1]/'static/embed.js').read_text()
        self.assertNotIn('new Proxy',source)
        self.assertNotIn('eval(',source)
