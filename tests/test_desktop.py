"""Portable desktop boundary tests; no GUI, credentials or live database required."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from flask import Flask, jsonify
from desktop_app import configure, install_desktop_guard, safe_next
from process_lock import ProcessLock


class DesktopTests(unittest.TestCase):
    def test_data_is_outside_program_and_paths_are_explicit(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ):
            root = configure(folder)
            self.assertEqual(Path(os.environ['PHB_APP_ROOT']), root/'data')
            self.assertEqual(Path(os.environ['PHB_CHATGPT_HOME']), root/'auth')
            self.assertEqual(Path(os.environ['PHB_BACKUP_CONFIG']), root/'backup-config.json')
            self.assertTrue((root/'backups').is_dir())
            # Close the file logger before deleting the temporary folder on Windows.
            import logging
            logging.shutdown()
            logging.getLogger().handlers.clear()

    def client(self):
        app = Flask(__name__)
        @app.before_request
        def existing_router():
            from flask import request
            if request.path=='/':return '<html><body>App</body></html>'
        @app.post('/write')
        def write():return jsonify(ok=True)
        install_desktop_guard(app, 'test-token')
        return app.test_client()

    def test_gate_precedes_existing_page_router_and_rejects_other_origins(self):
        client = self.client();base='http://127.0.0.1'
        self.assertEqual(client.get('/',base_url=base).status_code,403)
        self.assertEqual(client.get('/_desktop/bootstrap?token=wrong',base_url=base).status_code,403)
        response=client.get('/_desktop/bootstrap?token=test-token',base_url=base)
        self.assertEqual(response.status_code,302)
        self.assertIn('HttpOnly',response.headers['Set-Cookie'])
        self.assertIn(b'/_desktop/links.js',client.get('/',base_url=base).data)
        self.assertEqual(client.post('/write',base_url=base,headers={'Origin':'https://other.example'}).status_code,403)
        self.assertEqual(client.post('/write',base_url=base,headers={'Origin':base}).status_code,200)
        self.assertEqual(client.get('/',base_url='http://localhost').status_code,403)

    def test_download_bootstrap_cannot_redirect_outside_the_app(self):
        for value in ('//evil.example','https://evil.example','/\\evil.example','/\r\nevil'):
            self.assertEqual(safe_next(value),'/')
        self.assertEqual(safe_next('/api/receipts/1/preview?project_id=2'),'/api/receipts/1/preview?project_id=2')

    def test_single_instance_lock_across_processes(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'app.lock';lock=ProcessLock(lambda:path)
            code='from process_lock import ProcessLock; from pathlib import Path; import sys; l=ProcessLock(lambda:Path(sys.argv[1])); acquired=l.acquire(False); print(int(acquired)); l.release() if acquired else None'
            try:
                self.assertTrue(lock.acquire(False))
                result=subprocess.run([sys.executable,'-c',code,str(path)],capture_output=True,text=True,check=True)
                self.assertEqual(result.stdout.strip(),'0')
            finally:lock.release()
            result=subprocess.run([sys.executable,'-c',code,str(path)],capture_output=True,text=True,check=True)
            self.assertEqual(result.stdout.strip(),'1')


if __name__=='__main__':unittest.main()
