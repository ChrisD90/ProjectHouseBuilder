"""Transport, stale writes, payment receipts and worker ownership are domain guarantees."""
import os
os.environ['DATABASE_URL']='sqlite:///:memory:'
import unittest
from datetime import datetime,timedelta
from unittest.mock import patch
import app as b
from multi_projects import project_context
from job_leases import claim

class RequestSafetyTest(unittest.TestCase):
 def setUp(self):
  self.context=b.app.app_context();self.context.push();b.db.session.remove();b.db.drop_all();b.initialize();self.c=b.app.test_client()
  # Technical operation receipts are deliberately outside project export metadata.
  from request_safety import operations
  b.db.session.execute(operations.delete());b.db.session.commit()
 def tearDown(self):b.db.session.remove();b.db.drop_all();self.context.pop()
 def receipt(self):
  r=b.Receipt(digest='safe-test',original_name='r.pdf',stored_name='r.pdf',supplier='Test',document_date='2026-11-02',status='Gebucht',gross_amount=1000,paid_amount=0,assignment_type='Eigenleistung');b.db.session.add(r);b.db.session.commit();return r.id
 def test_stale_invoice_is_rejected_and_diff_is_returned(self):
  ident=self.receipt();path=f'/api/receipts/{ident}'
  version=self.c.get(path).json['_versions'][path]
  first=self.c.patch(path,json={'notes':'Aktueller Tab'},headers={'If-Match':version});self.assertEqual(first.status_code,200,first.json)
  second=self.c.patch(path,json={'notes':'Veralteter Tab'},headers={'If-Match':version})
  self.assertEqual(second.status_code,409,second.json);self.assertEqual(second.json['changes']['notes']['current'],'Aktueller Tab')
  self.assertEqual(b.db.session.get(b.Receipt,ident).notes,'Aktueller Tab')
 def test_repeat_same_operation_is_one_payment_and_new_key_is_new_payment(self):
  ident=self.receipt();body=dict(receipt_id=ident,source='unassigned',amount=100,payment_date='2026-11-02');path='/api/financing/payments'
  headers={'Idempotency-Key':'payment-operation-0001'}
  a=self.c.post(path,json=body,headers=headers);c=self.c.post(path,json=body,headers=headers)
  self.assertEqual(a.status_code,201,a.json);self.assertEqual(a.json['id'],c.json['id']);self.assertEqual(c.headers['Idempotency-Replayed'],'true')
  self.assertEqual(b.db.session.get(b.Receipt,ident).paid_amount,100)
  mismatch=self.c.post(path,json={**body,'amount':200},headers=headers);self.assertEqual(mismatch.status_code,409)
  self.assertEqual(self.c.post(path,json=body,headers={'Idempotency-Key':'payment-operation-0002'}).status_code,201)
  self.assertEqual(b.db.session.get(b.Receipt,ident).paid_amount,200)
  self.assertEqual(self.c.get('/api/operations/payment-operation-0001').json['state'],'done')
 def test_replayed_record_keeps_original_revision_instead_of_blessing_stale_values(self):
  headers={'Idempotency-Key':'loan-create-operation-0001'}
  body={'name':'Ursprünglicher Kredit','principal':100000,'interest_rate':3}
  first=self.c.post('/api/financing/loans',json=body,headers=headers)
  self.assertEqual(first.status_code,201,first.json)
  path='/api/financing/loans/'+str(first.json['id']);old=first.json['_versions'][path]
  changed=self.c.patch(path,json={'name':'Inzwischen geändert'})
  self.assertEqual(changed.status_code,200,changed.json)
  replay=self.c.post('/api/financing/loans',json=body,headers=headers)
  self.assertEqual(replay.json['name'],'Ursprünglicher Kredit')
  self.assertEqual(replay.json['_versions'][path],old)
  self.assertNotEqual(changed.json['_versions'][path],old)
  headers={'Idempotency-Key':'loan-edit-operation-000001','If-Match':changed.json['_versions'][path]}
  edit=self.c.patch(path,json={'name':'Einmalig bearbeitet'},headers=headers)
  repeated=self.c.patch(path,json={'name':'Einmalig bearbeitet'},headers=headers)
  self.assertEqual(edit.status_code,200,edit.json)
  self.assertEqual(repeated.status_code,200,repeated.json)
  self.assertEqual(repeated.headers['Idempotency-Replayed'],'true')
  self.assertEqual(repeated.json['_versions'],edit.json['_versions'])

 def test_operation_and_versions_do_not_leak_across_projects(self):
  ident=self.receipt();other=self.c.post('/api/projects',json={'title':'Andere Daten'}).json['project']['id']
  self.c.post('/api/financing/payments',json=dict(receipt_id=ident,source='unassigned',amount=10,payment_date='2026-11-02'),headers={'Idempotency-Key':'own-operation-000001'})
  self.assertEqual(self.c.get('/api/operations/own-operation-000001',headers={'X-PHB-Project':str(other)}).status_code,404)
  self.assertEqual(self.c.get(f'/api/receipts/{ident}',headers={'X-PHB-Project':str(other)}).status_code,404)
  foreign=self.c.patch(f'/api/receipts/{ident}',json={'notes':'Probe'},headers={'X-PHB-Project':str(other),'If-Match':'stale'})
  self.assertEqual(foreign.status_code,409);self.assertEqual(foreign.json['current'],{});self.assertEqual(foreign.json['changes'],{})
 def test_json_errors_and_strict_dates(self):
  with patch.dict(b.app.config,MAX_CONTENT_LENGTH=16):
   r=self.c.post('/api/receipts',data=b'x'*32,content_type='multipart/form-data; boundary=foo')
  self.assertEqual(r.status_code,413);self.assertTrue(r.is_json);self.assertIn('zu groß',r.json['error'])
  for bad in ('2027-03-01garbage','2027-02-29','2027-3-1',True):
   with self.assertRaises(ValueError):b.parse_date(bad)
  self.assertEqual(b.parse_date('2028-02-29').isoformat(),'2028-02-29')
  from validation import parse_date
  self.assertEqual(parse_date('2027-03-01T13:00:00Z',timestamps=True).isoformat(),'2027-03-01')
 def test_own_document_link_reports_exact_parent_revision_transition(self):
  funding=b.Funding(name='Förderentwurf')
  document=b.ProjectDocument(title='Nachweis',original_name='Nachweis.txt',stored_name='proof.txt',extension='.txt',digest='proof',size_bytes=1,category='Sonstiges',area='Energetische Planung')
  b.db.session.add_all([funding,document]);b.db.session.commit()
  path='/api/funding/'+str(funding.id)
  old=self.c.get('/api/energy-planning').json['_versions'][path]
  linked=self.c.patch('/api/project-documents/'+str(document.id),json={'funding_id':funding.id})
  self.assertEqual(linked.status_code,200,linked.json)
  transition=linked.json['_version_transitions'][path]
  self.assertEqual(transition['before'],old)
  fresh=self.c.get('/api/energy-planning').json['_versions'][path]
  self.assertEqual(transition['after'],fresh);self.assertNotEqual(old,fresh)
  self.assertEqual(self.c.put(path,json={'name':'Eigene Eingabe'},headers={'If-Match':old}).status_code,409)
  self.assertEqual(self.c.put(path,json={'name':'Eigene Eingabe'},headers={'If-Match':fresh}).status_code,200)
 def test_job_is_claimed_once_and_active_lease_survives_recovery(self):
  job=b.ImportJob(batch_id='a'*32,kind='offers',filename='x.pdf',stored_name='x.pdf',analysis_mode='ai',status='Wartend',lease_owner='queued');b.db.session.add(job);b.db.session.commit()
  token=claim(b.db,b.ImportJob,job.id);self.assertTrue(token);self.assertIsNone(claim(b.db,b.ImportJob,job.id))
  b._recover_interrupted_imports();b.db.session.refresh(job);self.assertEqual(job.status,'Läuft')
  job.lease_until=datetime.utcnow()-timedelta(seconds=1);b.db.session.commit();b._recover_interrupted_imports();self.assertEqual(job.status,'Unterbrochen')
 def test_lost_worker_cannot_commit_domain_writes(self):
  job=b.ImportJob(batch_id='a'*32,kind='offers',filename='x.pdf',stored_name='x.pdf',analysis_mode='ai',status='Läuft',lease_owner='new-owner');b.db.session.add(job);b.db.session.commit()
  b.db.session.info['phb_import_lease']=(job.id,1,'old-owner')
  b.db.session.add(b.Contractor(name='Darf nicht gespeichert werden',trade='Sonstiges'))
  try:
   with self.assertRaisesRegex(ValueError,'anderen Lauf'):b.db.session.commit()
   b.db.session.rollback()
  finally:b.db.session.info.pop('phb_import_lease',None)
  self.assertEqual(b.db.session.query(b.Contractor).count(),0)
