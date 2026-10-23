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
        self.root = Path(self.temp.name) / 'application'
        self.root.mkdir()
        self.db = self.root / 'sanierung.db'
        self.backups = Path(self.temp.name) / 'sync'
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
        self.assertEqual(result['revision'], '0013')
        self.assertEqual(self.db_rows('SELECT version_num FROM alembic_version'), [('0013',)])
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
        self.assertEqual(self.db_rows('SELECT version_num FROM alembic_version'), [('0013',)])

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

    def test_upgrade_from_previous_version_keeps_paid_receipt(self):
        self.setup_backup()
        schema_manager.upgrade_database()
        with sqlite3.connect(self.db) as con:
            con.execute("INSERT INTO receipt (digest,original_name,stored_name,supplier,document_date,status,paid_amount,gross_amount,category,kind,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        ('a'*64,'rechnung.pdf','alt.pdf','Sanitärfirma','2026-10-21','Gebucht',100,200,'Sanitär','Rechnung','2026-10-22 12:00:00'))
            con.execute("UPDATE alembic_version SET version_num = '0001'")
            con.execute("DROP TABLE finance_receipt_payment")
            con.execute("DROP TABLE finance_event")
            con.execute("DROP TABLE finance_equity")
            con.execute("DROP TABLE finance_loan")
        state = schema_manager.upgrade_database()
        self.assertEqual(state['status'], 'upgraded')
        self.assertIsNotNone(state['backup'])
        self.assertEqual(self.db_rows('SELECT supplier,paid_amount,gross_amount FROM receipt'), [('Sanitärfirma',100,200)])
        self.assertEqual(self.db_rows('SELECT version_num FROM alembic_version'), [('0013',)])
        self.assertIn(('finance_loan',), self.db_rows("SELECT name FROM sqlite_master WHERE name='finance_loan'"))

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


class OfferSchemaMigrationTests(unittest.TestCase):
    """A real file DB at Alembic revision 0002 remains intact after 0004."""

    def test_upgrade_preserves_existing_quotes_and_disables_legacy_preaccept_selections(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)/'app';root.mkdir()
            db_file=root/'sanierung.db';sync=Path(td)/'cloud';sync.mkdir()
            with sqlite3.connect(db_file) as con:
                con.execute('CREATE TABLE alembic_version (version_num TEXT PRIMARY KEY)')
                con.execute("INSERT INTO alembic_version VALUES ('0002')")
                con.execute('CREATE TABLE offer (id INTEGER PRIMARY KEY, status TEXT NOT NULL, vendor TEXT)')
                con.execute("INSERT INTO offer (id,status,vendor) VALUES (1,'Angebot','Testfirma'),(2,'Angenommen','Andere Firma')")
                con.execute('CREATE TABLE cost_item (id INTEGER PRIMARY KEY, offer_id INTEGER, selected INTEGER, state TEXT, paid REAL, committed REAL)')
                con.execute("INSERT INTO cost_item VALUES (11,1,1,'Angebot',0,0),(12,2,1,'Beauftragt',0,300)")
            import backup_manager, schema_manager
            with (patch.dict(os.environ,{'DATABASE_URL':'sqlite:///'+str(db_file)}),
                  patch.object(backup_manager,'ROOT',root),
                  patch.object(backup_manager,'CONFIG_PATH',root/'backup_config.json')):
                backup_manager.configure(str(sync))
                result=schema_manager.upgrade_database()
                self.assertEqual(result['revision'],'0013')
                backup_manager.verify_backup(Path(result['backup']))
            with sqlite3.connect(db_file) as con:
                self.assertEqual(con.execute('SELECT version_num FROM alembic_version').fetchone()[0],'0013')
                offer_columns={row[1] for row in con.execute('PRAGMA table_info(offer)')}
                self.assertTrue({'category','budget_line_id','notes'} <= offer_columns)
                self.assertEqual(con.execute('SELECT vendor FROM offer WHERE id=1').fetchone()[0],'Testfirma')
                self.assertEqual(con.execute('SELECT selected,state FROM cost_item WHERE id=11').fetchone(),(0,'Alternative'))
                self.assertEqual(con.execute('SELECT selected,state,committed FROM cost_item WHERE id=12').fetchone(),(1,'Beauftragt',300))


class RetiredSpreadsheetMigrationTests(unittest.TestCase):
    def test_old_spreadsheet_tables_are_removed_but_budget_lines_survive(self):
        with tempfile.TemporaryDirectory() as td:
            project=Path(td)/'project';project.mkdir()
            db_file=project/'sanierung.db'
            sync=Path(td)/'cloud';sync.mkdir()
            import backup_manager, schema_manager
            with (patch.dict(os.environ, {'DATABASE_URL':'sqlite:///'+str(db_file)}),
                  patch.object(backup_manager,'ROOT',project),
                  patch.object(backup_manager,'CONFIG_PATH',project/'config.json')):
                schema_manager.upgrade_database()  # fresh at revision 0004
                with sqlite3.connect(db_file) as con:
                    con.execute("INSERT INTO budget_line (code, category, title, estimate, kind, active, is_group, sort_order) VALUES ('ABC','Elektro','Manueller Posten',153.2,'Fremdleistung',1,0,9)")
                    con.execute("ALTER TABLE budget_line ADD COLUMN marker TEXT")
                    con.execute("ALTER TABLE budget_line ADD COLUMN source_row INTEGER")
                    con.execute('CREATE TABLE historical_estimate (id INTEGER PRIMARY KEY, name TEXT)')
                    con.execute("INSERT INTO historical_estimate VALUES (1,'alte Vorlage')")
                    con.execute("INSERT INTO setting (key,value) VALUES ('excel_budget_initialized','1')")
                    con.execute("UPDATE alembic_version SET version_num='0003'")
                backup_manager.configure(str(sync))
                result=schema_manager.upgrade_database()
                self.assertEqual(result['revision'],'0013')
                self.assertTrue(Path(result['backup']).exists())
                with sqlite3.connect(db_file) as con:
                    cols={row[1] for row in con.execute('PRAGMA table_info(budget_line)')}
                    self.assertNotIn('marker',cols)
                    self.assertNotIn('source_row',cols)
                    self.assertEqual(con.execute("SELECT title,estimate FROM budget_line WHERE code='ABC'").fetchone(),('Manueller Posten',153.2))
                    self.assertFalse(con.execute("SELECT name FROM sqlite_master WHERE name='historical_estimate'").fetchall())
                    self.assertFalse(con.execute("SELECT value FROM setting WHERE key='excel_budget_initialized'").fetchall())
