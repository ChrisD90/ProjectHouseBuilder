"""Integration coverage for schema upgrades and fail-closed backups."""
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import backup_manager
import schema_manager


class SchemaUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db = self.root / 'sanierung.db'
        self.backups = self.root / 'sync'
        self.backups.mkdir()
        self.patcher = patch.dict(os.environ, {'DATABASE_URL': 'sqlite:///' + str(self.db)})
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.root_patcher = patch.object(backup_manager, 'ROOT', self.root)
        self.root_patcher.start()
        self.addCleanup(self.root_patcher.stop)
        self.config_patch = patch.object(backup_manager, 'CONFIG_PATH', self.root / 'config.json')
        self.config_patch.start()
        self.addCleanup(self.config_patch.stop)

    def setup_backup(self):
        backup_manager.configure(str(self.backups))

    def db_rows(self, sql):
        with sqlite3.connect(self.db) as conn:
            return conn.execute(sql).fetchall()

    def test_fresh_database_creates_tables_without_backup(self):
        result = schema_manager.upgrade_database()
        self.assertEqual(result['status'], 'upgraded')
        self.assertEqual(result['revision'], '0001')
        self.assertEqual(self.db_rows('SELECT version_num FROM alembic_version'), [('0001',)])
        self.assertIn(('receipt',), self.db_rows("SELECT name FROM sqlite_master WHERE type='table' AND name='receipt'"))
        self.assertFalse(list(self.backups.glob('*.zip')))

    def test_idempotent_start_does_not_need_backup(self):
        schema_manager.upgrade_database()
        result = schema_manager.upgrade_database()
        self.assertEqual(result['status'], 'current')
        self.assertIsNone(result['backup'])

    def make_legacy_database(self):
        with sqlite3.connect(self.db) as conn:
            conn.execute('CREATE TABLE task (id INTEGER PRIMARY KEY, code TEXT)')
            conn.execute("INSERT INTO task (id,code) VALUES (41,'LEGACY')")
            conn.execute('CREATE TABLE cost_item (id INTEGER PRIMARY KEY, title TEXT)')
            conn.execute("INSERT INTO cost_item (id,title) VALUES (19,'alte Schätzung')")
        docs = self.root / 'private' / 'receipts'
        docs.mkdir(parents=True)
        (docs / 'rechnung.pdf').write_bytes(b'PDF legacy data')

    def test_legacy_database_preserved_and_backed_up(self):
        self.make_legacy_database()
        self.setup_backup()
        r = schema_manager.upgrade_database()
        self.assertEqual(r['status'], 'upgraded')
        self.assertEqual(self.db_rows('SELECT code FROM task WHERE id=41'), [('LEGACY',)])
        self.assertEqual(self.db_rows('SELECT title FROM cost_item WHERE id=19'), [('alte Schätzung',)])
        self.assertIn('contractor_id', [row[1] for row in self.db_rows('PRAGMA table_info(task)')])
        self.assertIn('selected', [row[1] for row in self.db_rows('PRAGMA table_info(cost_item)')])
        info = backup_manager.verify_backup(Path(r['backup']))
        self.assertIn('private/receipts/rechnung.pdf', info['files'])
        self.assertEqual(self.db_rows('SELECT version_num FROM alembic_version'), [('0001',)])

    def test_existing_database_without_backup_target_is_untouched(self):
        self.make_legacy_database()
        with self.assertRaises(ValueError):
            schema_manager.upgrade_database()
        self.assertEqual(self.db_rows('SELECT code FROM task'), [('LEGACY',)])
        self.assertEqual(self.db_rows("SELECT name FROM sqlite_master WHERE type='table' AND name='alembic_version'"), [])

    def test_unavailable_sync_folder_blocks_upgrade(self):
        self.make_legacy_database()
        self.setup_backup()
        self.backups.rename(self.root / 'gone')
        with self.assertRaises(ValueError):
            schema_manager.upgrade_database()
        self.assertEqual(self.db_rows('SELECT code FROM task'), [('LEGACY',)])

    def test_future_revision_blocks_downgrade(self):
        with sqlite3.connect(self.db) as conn:
            conn.execute('CREATE TABLE alembic_version (version_num TEXT PRIMARY KEY)')
            conn.execute("INSERT INTO alembic_version VALUES ('2099_future_version')")
        with self.assertRaises(RuntimeError):
            schema_manager.upgrade_database()

    def test_reject_postgresql_in_mac_migrator(self):
        with patch.dict(os.environ, {'DATABASE_URL': 'postgresql://user:pass@localhost/test'}):
            with self.assertRaises(ValueError):
                schema_manager.upgrade_database()

    def test_reject_corrupt_database_before_backup(self):
        self.db.write_bytes(b'not sqlite')
        self.setup_backup()
        with self.assertRaises(sqlite3.DatabaseError):
            schema_manager.upgrade_database()
        self.assertFalse(list(self.backups.glob('*.zip')))


if __name__ == '__main__':
    unittest.main()
