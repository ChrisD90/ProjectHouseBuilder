"""Security-focused tests for NAS backup setup and ChatGPT acknowledgement."""
import hashlib
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

os.environ['DATABASE_URL']='sqlite:///:memory:'
import server_backups
import chatgpt_local
from app import app


class BackupFolderTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.settings=self.root/'private'/'backup-settings.json'
        self.store=self.root/'mount'
        self.store.mkdir()
        self.storage=patch.object(server_backups,'STORAGE_ROOT',self.store)
        self.settings_patch=patch.object(server_backups,'SETTINGS',self.settings)
        self.storage.start();self.settings_patch.start()

    def tearDown(self):
        self.settings_patch.stop();self.storage.stop();self.temp.cleanup()

    def test_folder_change_is_persisted_under_mount(self):
        one=server_backups.configure('Erste Sicherung',keep=8)
        self.assertTrue(one.is_dir())
        self.assertEqual(server_backups.configuration()['keep'],8)
        self.assertEqual(server_backups.configuration()['relative_folder'],'Erste Sicherung')
        two=server_backups.configure('Zweite Sicherung',keep=10)
        self.assertTrue(two.is_dir())
        self.assertEqual(server_backups.configuration()['folder'],two)
        self.assertTrue(one.is_dir(),'Alte Backups dürfen nicht gelöscht werden.')

    def test_escape_is_rejected(self):
        for invalid in ['../../..',str(self.root/'outside'),'', '../private']:
            with self.subTest(folder=invalid):
                with self.assertRaises(ValueError):
                    server_backups.configure(invalid)
        self.assertFalse(self.settings.exists())

    def test_zip_verify_rejects_tampering(self):
        folder=server_backups.configure('Backups')
        dump=b'PGDMP-synthetic-archive-data'
        body={'format':server_backups.FORMAT,'version':1,'created':'2026-10-25',
              'files':{'database.dump':{'sha256':hashlib.sha256(dump).hexdigest(),'bytes':len(dump)}}}
        archive=folder/(server_backups.PREFIX+'2026-10-25_10-00-00.zip')
        with zipfile.ZipFile(archive,'w') as z:
            z.writestr('database.dump',dump)
            z.writestr('backup-manifest.json',json.dumps(body))
        self.assertEqual(server_backups.verify(archive)['version'],1)
        self.assertEqual(server_backups.selected_archive(archive.name),archive)
        with zipfile.ZipFile(archive,'w') as z:
            z.writestr('database.dump',dump+b'changed')
            z.writestr('backup-manifest.json',json.dumps(body))
        with self.assertRaises(ValueError):
            server_backups.verify(archive)

    def test_folder_browser_does_not_leave_root(self):
        server_backups.configure('Sicherungen/Heute')
        self.assertTrue(server_backups.browse('Sicherungen')['directories'])
        with self.assertRaises(ValueError):
            server_backups.browse('../')


class ChatGPTConsentTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.path=Path(self.temp.name)
        self.home=patch.object(chatgpt_local,'_profile_home',lambda:self.path)
        self.home.start()

    def tearDown(self):
        self.home.stop();self.temp.cleanup()

    def test_consent_is_saved_for_verified_connected_identity(self):
        identity=chatgpt_local.ChatGPTLocal()
        record={'subject':'example-user','email':'example@example.test','client_id':'dummy',
                'refresh_token':'dummy-test', 'scopes':list(chatgpt_local.REQUIRED_SCOPES)}
        chatgpt_local._write_secret('profile.json',record)
        self.assertFalse(identity.status()['credits_acknowledged'])
        self.assertTrue(identity.acknowledge_credits()['credits_acknowledged'])
        self.assertTrue(chatgpt_local.ChatGPTLocal().status()['credits_acknowledged'])
        self.assertEqual((self.path/'profile.json').stat().st_mode & 0o777,0o600)

    def test_no_anonymous_consent(self):
        with self.assertRaises(chatgpt_local.AIError):
            chatgpt_local.ChatGPTLocal().acknowledge_credits()


if __name__=='__main__':
    unittest.main()
