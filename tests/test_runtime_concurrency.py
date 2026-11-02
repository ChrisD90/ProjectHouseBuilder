"""Cross-process file ownership and two independent DB sessions are real, not mocked locks."""
import os,sys,subprocess,tempfile,unittest
from pathlib import Path
from process_lock import ProcessLock

class RuntimeConcurrencyTest(unittest.TestCase):
 def test_process_lock_is_visible_to_an_independent_process(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'restore.lock';lock=ProcessLock(lambda:path)
   code="from process_lock import ProcessLock;import sys;print(ProcessLock(lambda:sys.argv[1]).locked())"
   lock.acquire()
   try:
    result=subprocess.check_output([sys.executable,'-c',code,str(path)],text=True).strip();self.assertEqual(result,'True')
   finally:lock.release()
   result=subprocess.check_output([sys.executable,'-c',code,str(path)],text=True).strip();self.assertEqual(result,'False')
 def test_two_sqlite_requests_cannot_spend_the_same_equity_twice(self):
  with tempfile.TemporaryDirectory() as folder:
   code=r'''
import app as b
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
with b.app.app_context():
 b.initialize();account=b.EquityAccount(name='Gemeinsames Konto',opening_balance=100,reserve=0)
 b.db.session.add(account);receipts=[]
 for index in range(2):
  row=b.Receipt(digest='parallel-'+str(index),original_name='r.pdf',stored_name='r'+str(index)+'.pdf',supplier='Test',document_date='2026-11-02',status='Gebucht',gross_amount=100,paid_amount=0,assignment_type='Eigenleistung')
  b.db.session.add(row);receipts.append(row)
 b.db.session.commit();aid=account.id;ids=[row.id for row in receipts]
barrier=Barrier(2)
def pay(ident):
 with b.app.test_client() as client:
  barrier.wait()
  return client.post('/api/financing/payments',json=dict(receipt_id=ident,source='equity',equity_id=aid,amount=100,payment_date='2026-11-02')).status_code
with ThreadPoolExecutor(max_workers=2) as pool:statuses=list(pool.map(pay,ids))
assert sorted(statuses)==[201,400],statuses
with b.app.app_context():
 assert b.db.session.query(b.ReceiptFinancingPayment).count()==1
 assert sum(row.paid_amount for row in b.db.session.query(b.Receipt))==100
print('PASS independent SQLite sessions: one funded payment, no negative equity')
'''
   env={**os.environ,'DATABASE_URL':'sqlite:///'+folder+'/parallel.db','PHB_CHATGPT_HOME':folder+'/auth','APP_PASSWORD':''}
   result=subprocess.run([sys.executable,'-c',code],env=env,capture_output=True,text=True,timeout=30)
   self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
