import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import backup_manager as m


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.work=tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.root=Path(self.work.name)/'application'
        self.root.mkdir()
        self.dest=Path(self.work.name)/'sync backup'
        self.dest.mkdir()
        self.config=Path(self.work.name)/'config.json'
        self.patches=[patch.object(m,'ROOT',self.root),patch.object(m,'CONFIG_PATH',self.config)]
        for x in self.patches:
            x.start();self.addCleanup(x.stop)
        self.db=self.root/'sanierung.db'
        with sqlite3.connect(self.db) as d:
            d.execute('CREATE TABLE expenses (name text, amount numeric)')
            d.execute("INSERT INTO expenses VALUES ('A', 12)")
        folder=self.root/'private'/'receipts'
        folder.mkdir(parents=True)
        (folder/'rechnung.pdf').write_bytes(b'%PDF-example')
        m.configure(str(self.dest),keep=2)

    def test_backup_and_restore_keeps_database_and_documents(self):
        archive=m.make_backup()
        self.assertEqual(len(m.verify_backup(archive)['files']),2)
        with sqlite3.connect(self.db) as d:d.execute("UPDATE expenses SET amount=99")
        (self.root/'private'/'receipts'/'rechnung.pdf').unlink()
        rollback=m.restore(archive,yes=True)
        with sqlite3.connect(self.db) as d:
            self.assertEqual(d.execute('SELECT amount FROM expenses').fetchone()[0],12)
        self.assertEqual((self.root/'private'/'receipts'/'rechnung.pdf').read_bytes(),b'%PDF-example')
        self.assertTrue((rollback/'sanierung.db').is_file())

    def test_corruption_rejected(self):
        archive=m.make_backup()
        edited=self.dest/'invalid.zip'
        with zipfile.ZipFile(archive) as src, zipfile.ZipFile(edited,'w') as dest:
            for name in src.namelist():
                data=src.read(name)
                if name=='sanierung.db':data=b'garbage'
                dest.writestr(name,data)
        with self.assertRaises(ValueError):m.verify_backup(edited)

    def test_missing_destination_refuses_backup(self):
        self.dest.rename(self.dest.with_name('gone'))
        with self.assertRaises(ValueError):m.make_backup()

    def test_no_restore_without_confirmation(self):
        archive=m.make_backup()
        with self.assertRaises(ValueError):m.restore(archive)

    def test_no_backup_without_existing_db(self):
        self.db.unlink()
        with self.assertRaises(ValueError):m.make_backup()


if __name__=='__main__':unittest.main()
