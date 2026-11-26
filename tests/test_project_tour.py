"""Project tour persistence must not affect data, deletion safety or folder permissions."""
import os
import tempfile
import unittest
from unittest.mock import patch
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b

class ProjectTourTest(unittest.TestCase):
    def setUp(self):
        self.ctx=b.app.app_context();self.ctx.push();b.db.session.remove();b.db.drop_all();b.initialize();self.client=b.app.test_client()
    def tearDown(self):b.db.session.remove();b.db.drop_all();self.ctx.pop()
    def test_new_project_resume_skip_restart_and_isolation_without_blocking_empty_deletion(self):
        self.assertEqual(self.client.get('/api/project-onboarding').json['status'],'not_started')
        response=self.client.post('/api/projects',json={'title':'Neues Vorhaben'});self.assertEqual(response.status_code,201,response.json)
        owner=response.json['project']['id'];headers={'X-PHB-Project':str(owner)}
        state=self.client.get('/api/project-onboarding',headers=headers).json;self.assertEqual(state['status'],'pending')
        changed=self.client.put('/api/project-onboarding',headers=headers,json={'action':'progress','step':2,'token':state['token']})
        self.assertEqual(changed.status_code,200,changed.json);self.assertEqual(self.client.get('/api/project-onboarding',headers=headers).json['step'],2)
        self.assertEqual(self.client.put('/api/project-onboarding',headers=headers,json={'action':'skip','token':state['token']}).status_code,409)
        self.assertEqual(self.client.get('/api/project-onboarding').json['status'],'not_started')
        skipped=self.client.put('/api/project-onboarding',headers=headers,json={'action':'skip','step':2,'token':changed.json['token']})
        self.assertEqual(skipped.json['status'],'skipped')
        restarted=self.client.put('/api/project-onboarding',headers=headers,json={'action':'start','token':skipped.json['token']})
        self.assertEqual(restarted.json['step'],0)
        done=self.client.put('/api/project-onboarding',headers=headers,json={'action':'finish','step':4,'token':restarted.json['token']})
        self.assertEqual(done.json['status'],'completed')
        self.assertTrue(self.client.get('/api/projects/'+str(owner)).json['project']['can_delete'],'A tour marker is not user project data')
    def test_backup_picker_stays_local_handles_cancellation_and_does_not_reconfigure(self):
        with tempfile.TemporaryDirectory() as folder, patch('native_folder_picker.choose_folder',return_value=folder) as picker,patch('backup_manager.configure') as configure:
            response=self.client.post('/api/backup/native-folder',json={})
            self.assertEqual(response.status_code,200,response.json);self.assertEqual(response.json['folder'],folder);picker.assert_called_once();configure.assert_not_called()
            picker.reset_mock()
            response=self.client.post('/api/backup/native-folder',json={},environ_base={'REMOTE_ADDR':'192.168.1.10'})
            self.assertEqual(response.status_code,409);picker.assert_not_called()
        with patch('native_folder_picker.choose_folder',return_value=None):
            self.assertEqual(self.client.post('/api/backup/native-folder',json={}).json,{'cancelled':True})
