"""Full SQLite reset integration: real file DB, PDFs, finance, backups, security.

Use a subprocess to avoid sharing the in-memory DB used by other Flask tests.
"""
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

SCENARIO = r'''
import json, os, sys, shutil, sqlite3
from pathlib import Path
from decimal import Decimal
root = Path(sys.argv[1]); root.mkdir(parents=True, exist_ok=True)
import app as package
shutil.copy2(Path(package.__file__).parent/'seed.json',root/'seed.json')
import backup_manager as backup
import schema_manager
package.ROOT = root
package.DOCUMENT_ROOT = root/'private'/'documents'
package.RECEIPT_ROOT = root/'private'/'receipts'
backup.ROOT = root
backup.CONFIG_PATH = root/'backup-config.json'
# Real SQLite migration, not a mocked DB
schema_manager.upgrade_database()
with package.app.app_context():
    package.initialize()
    from app import db, Setting, Task, Category, BudgetLine, Contractor, Receipt, Loan, EquityAccount, ReceiptFinancingPayment, Offer, CostItem
    assert db.session.query(Task).count() == 0  # Fresh setup is opt-in now.
    initial = package.app.test_client().post('/api/tasks/initialize', json={'confirm':True})
    assert initial.status_code == 201, initial.json
    assert db.session.query(Task).count() == 69
    db.session.add(Contractor(name='Elektro Betrieb', trade='Elektro'))
    db.session.add(BudgetLine(code='USER',category='Elektro',title='Neue Verteilung',estimate=4321,sort_order=22))
    db.session.add(Category(name='Meine Spezialkategorie',sort_order=100))
    db.session.add(Loan(name='Kredit A',principal=Decimal('200000.00')))
    db.session.add(EquityAccount(name='Eigenkapital',opening_balance=Decimal('30000.00')))
    db.session.add(Receipt(digest='z'*64,original_name='Beleg.pdf',stored_name='beleg.pdf',supplier='Test',status='Gebucht',gross_amount=Decimal('150.00'),paid_amount=Decimal('0.00')))
    db.session.commit()
    receipt=db.session.query(Receipt).first()
    loan=db.session.query(Loan).first()
    db.session.add(ReceiptFinancingPayment(receipt_id=receipt.id,source='loan',loan_id=loan.id,amount=Decimal('50.00'),payment_date='2026-10-23'))
    db.session.commit()
receipt_file = root/'private'/'receipts'/'beleg.pdf'
receipt_file.parent.mkdir(parents=True,exist_ok=True)
receipt_file.write_bytes(b'%PDF Fake personal document')
(root/'private'/'documents').mkdir(parents=True,exist_ok=True)
(root/'private'/'documents'/'angebot.pdf').write_bytes(b'%PDF private offer')
client = package.app.test_client()
assert client.get('/daten').status_code == 200
assert client.get('/',headers={'User-Agent':'Mozilla/5.0 Chrome/131'}).status_code == 200
assert client.get('/api/project').status_code == 200
before = client.get('/api/costs').json
assert before['budget_lines'] and before['contractors']

if sys.argv[2]=='schedule-clear':
    url='/api/tasks/clear'
    token={'X-PHB-Schedule-Reset':'1'}
    payload={'confirmation':'BAUZEITPLAN LEEREN'}
    assert client.post(url,json=payload).status_code==403
    assert client.post(url,json={'confirmation':'no'},headers=token).status_code==400
    assert client.post(url,json=payload,headers={**token,'Origin':'http://attacker.invalid'}).status_code==403
    assert client.post(url,json=payload,headers=token,environ_overrides={'REMOTE_ADDR':'198.51.100.23'}).status_code==403
    assert client.post(url,json=payload,headers=token).status_code==409  # no backup configured
    with package.app.app_context():
        task=db.session.query(Task).first()
        protected=CostItem(title='Planverknüpfung',category='Elektro',task_id=task.id)
        db.session.add(protected)
        db.session.commit()
    sync=root.parent/'cloud'
    sync.mkdir()
    backup.configure(str(sync),keep=30)
    blocked=client.post(url,json=payload,headers=token)
    assert blocked.status_code==409,blocked.json  # no deletion while referenced
    with package.app.app_context():
        db.session.delete(db.session.query(CostItem).filter_by(title='Planverknüpfung').first())
        db.session.commit()
    success=client.post(url,json=payload,headers=token)
    assert success.status_code==200,success.json
    archive=Path(success.json['backup'])
    assert archive.is_file()
    backup.verify_backup(archive)
    with package.app.app_context():
        assert db.session.query(Task).count()==0
        assert db.session.query(Loan).count()==1
        assert db.session.query(Receipt).count()==1
        assert db.session.query(BudgetLine).count()==1
        assert db.session.query(Category).filter_by(name='Meine Spezialkategorie').count()==1
    assert receipt_file.is_file()
    assert (root/'private'/'documents'/'angebot.pdf').is_file()
    reinit=client.post('/api/tasks/initialize',json={'confirm':True})
    assert reinit.status_code==201,reinit.json
    assert len(client.get('/api/project').json['tasks'])==69
    print('OK isolated schedule reset, verified backup, retained finance, reimport')
    sys.exit(0)

RESET_URL = '/api/data/reset'
payload={'confirmation':'ALLE DATEN LÖSCHEN'}
headers={'X-PHB-Reset':'1'}
assert client.get(RESET_URL).status_code == 405
assert client.post(RESET_URL,json=payload).status_code == 403
assert client.post(RESET_URL,json={'confirmation':'Nein'},headers=headers).status_code == 400
assert client.post(RESET_URL,json=payload,headers={**headers, 'Origin':'http://angreifer.test'}).status_code == 403
assert client.post(RESET_URL,json=payload,headers=headers,environ_overrides={'REMOTE_ADDR':'198.51.100.23'}).status_code == 403
# No configured backup = no deletion.
refused=client.post(RESET_URL,json=payload,headers=headers)
assert refused.status_code == 409,refused.json
assert receipt_file.is_file()
with package.app.app_context():
    assert db.session.query(Loan).count()==1

if sys.argv[2]=='no-backup':
    print('OK no-backup security')
    sys.exit(0)

sync = root.parent/'cloud'
sync.mkdir()
backup.configure(str(sync),keep=30)
if sys.argv[2]=='unavailable':
    sync.rename(root.parent/'cloud-away')
    denied=client.post(RESET_URL,json=payload,headers=headers)
    assert denied.status_code==409,denied.json
    assert receipt_file.is_file()
    with package.app.app_context():
        assert db.session.query(Loan).count()==1
    print('OK unavailable folder guard')
    sys.exit(0)

reply=client.post(RESET_URL,json=payload,headers=headers)
assert reply.status_code==200, reply.json
assert reply.json.get('ok') is True
archive=Path(reply.json['backup'])
assert archive.exists()
manifest=backup.verify_backup(archive)
assert 'private/receipts/beleg.pdf' in manifest['files']
assert 'private/documents/angebot.pdf' in manifest['files']
assert 'data/initial_budget.json' not in manifest['files']
assert not receipt_file.exists()
with package.app.app_context():
    for model in [Task, BudgetLine, Contractor, Receipt, Loan, EquityAccount, ReceiptFinancingPayment, Offer, CostItem]:
        assert db.session.query(model).count()==0, model.__name__
    assert db.session.query(Category).count()>0
    assert db.session.query(Category).filter_by(name='Meine Spezialkategorie').count()==0
    assert db.session.get(Setting,'initial_budget').value=='0'
    assert db.session.get(Setting,'project_initialized').value=='1'
    package.initialize()
    assert db.session.query(Task).count()==0, 'sample Gantt tasks must not return'
    assert db.session.query(BudgetLine).count()==0, 'spreadsheet seed must not return'
assert client.get('/api/costs').json['summary']['budget']==0
with sqlite3.connect(root/'sanierung.db') as con:
    assert con.execute('SELECT version_num FROM alembic_version').fetchone()==('0009',)
print('OK reset and verified backup '+str(archive))
'''


class DataManagementTest(unittest.TestCase):
    def scenario(self, name):
        with tempfile.TemporaryDirectory(prefix='phb-reset-test-') as folder:
            root = Path(folder)/'project'
            env = os.environ.copy()
            env['DATABASE_URL'] = 'sqlite:///' + str(root/'sanierung.db')
            env.pop('APP_PASSWORD', None)
            proc = subprocess.run([sys.executable, '-c', SCENARIO, str(root), name],
                                  env=env, cwd=ROOT, capture_output=True, text=True, timeout=45)
            self.assertEqual(proc.returncode,0, proc.stderr + '\n' + proc.stdout)
            self.assertIn('OK',proc.stdout)

    def test_complete_reset_preserves_backup_and_schema(self):
        self.scenario('reset')

    def test_reset_backup_can_restore_everything_on_new_mac(self):
        with tempfile.TemporaryDirectory(prefix='phb-restore-test-') as folder:
            root=Path(folder)/'project'
            env=os.environ.copy()
            env['DATABASE_URL']='sqlite:///'+str(root/'sanierung.db')
            env.pop('APP_PASSWORD',None)
            creation=subprocess.run([sys.executable,'-c',SCENARIO,str(root),'reset'],env=env,
                                   cwd=ROOT,capture_output=True,text=True,timeout=45)
            self.assertEqual(creation.returncode,0,creation.stderr)
            archive=next((Path(folder)/'cloud').glob('ProjectHouseBuilder_Backup_*.zip'))
            restore_code="""import backup_manager as b,sys,sqlite3
from pathlib import Path
b.ROOT=Path(sys.argv[1]); b.restore(Path(sys.argv[2]),yes=True)
with sqlite3.connect(b.ROOT/'sanierung.db') as c:
    assert c.execute('SELECT name FROM finance_loan').fetchone()[0]=='Kredit A'
    assert c.execute('SELECT supplier FROM receipt').fetchone()[0]=='Test'
    assert c.execute('SELECT COUNT(*) FROM task').fetchone()[0]>0
assert (b.ROOT/'private'/'receipts'/'beleg.pdf').read_bytes()==b'%PDF Fake personal document'
print('RESTORED')
"""
            restored=subprocess.run([sys.executable,'-c',restore_code,str(root),str(archive)],
                                    env=env,cwd=ROOT,capture_output=True,text=True,timeout=45)
            self.assertEqual(restored.returncode,0,restored.stderr)
            self.assertIn('RESTORED',restored.stdout)

    def test_schedule_only_reset_preserves_finances_and_requires_backup(self):
        self.scenario('schedule-clear')

    def test_no_backup_configuration_prevents_reset(self):
        self.scenario('no-backup')

    def test_missing_sync_folder_prevents_reset(self):
        self.scenario('unavailable')

    def test_local_mac_uses_new_default_port(self):
        content = (ROOT/'start_mac_linux.sh').read_text()
        self.assertIn('5055', content)
        self.assertIn("port=int(os.environ.get('PORT','5055'))",(ROOT/'app.py').read_text())

    def test_excel_import_and_download_removed(self):
        code = (ROOT/'app.py').read_text()
        for removed in ('/api/excel-original', 'initialize_budget(', 'HistoricalEstimate('):
            self.assertNotIn(removed,code)
        self.assertFalse((ROOT/'data'/'initial_budget.example.json').exists())
        self.assertNotIn('Excel', (ROOT/'templates'/'kosten.html').read_text())

if __name__ == '__main__':
    unittest.main()
