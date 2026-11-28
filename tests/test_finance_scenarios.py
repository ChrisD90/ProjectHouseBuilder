"""Simulation integrity: frozen basis, no real writes, scoping and backup restore."""
import copy,hashlib,json,os,tempfile,unittest,zipfile
from pathlib import Path
from uuid import uuid4
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b
import project_backups
from finance_scenarios import validate_snapshot

class FinanceScenarioTest(unittest.TestCase):
    def setUp(self):
        self.ctx=b.app.app_context();self.ctx.push();b.db.session.remove();b.db.drop_all();b.initialize();self.client=b.app.test_client()
    def tearDown(self):b.db.session.remove();b.db.drop_all();self.ctx.pop()
    def post(self,path,body,headers=None):
        out=self.client.post(path,json=body,headers=headers);self.assertIn(out.status_code,(200,201),out.json);return out.json
    def setup_finance(self):
        first=self.post('/api/financing/loans',dict(name='Kredit A',principal=1000))['id'];second=self.post('/api/financing/loans',dict(name='Kredit B',principal=500))['id']
        equity=self.post('/api/financing/equity',dict(name='Eigenkapital',opening_balance=1000,reserve=100))['id']
        self.post('/api/financing/events',dict(kind='loan_drawdown',loan_id=first,amount=400,event_date='2026-11-28'))
        return first,second,equity
    def offer(self,gross,accepted=True):
        ident=self.post('/api/offers/manual',dict(vendor='Betrieb',category='Sonstiges',gross=gross))['id']
        if accepted:self.assertEqual(self.client.patch('/api/offers/'+str(ident),json={'status':'Angenommen'}).status_code,200)
        return ident
    def create(self,title='Plan'):return self.post('/api/finance-scenarios',dict(title=title))['scenario']
    def payload(self,row):
        return dict(revision=row['revision'],title=row['title'],notes=row['notes'],reserve=copy.deepcopy(row['data']['reserve']),lines=[{k:v for k,v in x.items() if k not in ('paid','source')} for x in copy.deepcopy(row['data']['lines'])])
    def operational(self):
        return {name:[dict(x) for x in b.db.session.connection().execute(table.select()).mappings()] for name,table in b.db.metadata.tables.items() if name not in ('finance_scenario',) and not name.startswith('phb_')}
    def test_basis_paid_costs_allocations_reserve_and_no_operational_mutations(self):
        loan,second,equity=self.setup_finance();oid=self.offer(400);alternative=self.offer(900,False)
        item=b.db.session.scalar(b.select(b.CostItem).where(b.CostItem.offer_id==oid))
        invoice=b.Receipt(digest='1',original_name='Teilrechnung',stored_name='fixture-one',status='Gebucht',gross_amount=200,paid_amount=150,cost_item_id=item.id)
        outside=b.Receipt(digest='2',original_name='Weitere Rechnung',stored_name='fixture-two',status='Gebucht',gross_amount=100,paid_amount=50)
        b.db.session.add_all([invoice,outside]);b.db.session.flush()
        b.db.session.add(b.ReceiptFinancingPayment(receipt_id=invoice.id,source='loan',loan_id=loan,amount=150,payment_date='2026-11-28'))
        b.db.session.add(b.ReceiptFinancingPayment(receipt_id=outside.id,source='equity',equity_id=equity,amount=50,payment_date='2026-11-28'));b.db.session.commit()
        before=self.operational();row=self.create()
        self.assertEqual(row['summary']['total'],500);self.assertEqual(row['summary']['paid'],200);self.assertEqual(row['summary']['required'],300)
        self.assertEqual(row['summary']['credit_remaining'],1350,'Drawn cash must not be counted in addition to the loan frame')
        self.assertEqual(row['summary']['equity_remaining'],950)
        pending=next(x for x in row['data']['lines'] if x['source'].get('id')==alternative and x['source']['kind']=='offer');self.assertFalse(pending['enabled'])
        data=self.payload(row);line=next(x for x in data['lines'] if x['id']==next(y['id'] for y in row['data']['lines'] if y['source']['kind']=='offer' and y['source']['id']==oid))
        line['amount']=500;line['allocations']={'loan:'+str(loan):250,'equity:'+str(equity):100}
        data['reserve']=dict(mode='percent',value=10,allocations={'loan:'+str(second):40})
        path='/api/finance-scenarios/'+str(row['id'])
        preview=self.post(path+'/preview',data)['summary'];self.assertEqual(preview['total'],640);self.assertEqual(preview['required'],440);self.assertEqual(preview['unassigned'],50)
        self.assertEqual(self.client.get(path).json['scenario']['summary']['total'],500,'Previews must never persist')
        response=self.client.put(path,json=data);self.assertEqual(response.status_code,200,response.json);saved=response.json['scenario']
        self.assertEqual(saved['summary'],preview);self.assertEqual(self.operational(),before)
        self.assertEqual(self.client.put(path,json=data).status_code,409,'Stale scenario writes must be rejected')
        bad=self.payload(saved);bad['lines'][0]['allocations']={'loan:999999':1}
        self.assertEqual(self.client.put(path,json=bad).status_code,400)
        self.assertEqual(self.client.get(path).json['scenario']['revision'],saved['revision'])
        bad=self.payload(saved);bad['lines'][0]['amount']=-1
        self.assertEqual(self.client.put(path,json=bad).status_code,400);self.assertEqual(self.operational(),before)
        bad=self.payload(saved);bad['lines'][0]['paid']=0
        self.assertEqual(self.client.put(path,json=bad).status_code,400,'Already paid snapshots cannot be changed by a client')
        bad=self.payload(saved);bad['basis']={}
        self.assertEqual(self.client.put(path,json=bad).status_code,400,'Financing snapshots cannot be replaced by a client')
    def test_copy_project_scope_source_updates_and_overallocation_are_simulations_only(self):
        loan,second,equity=self.setup_finance();oid=self.offer(119,False);row=self.create();path='/api/finance-scenarios/'+str(row['id'])
        other=self.post('/api/projects',{'title':'Andere Baustelle'})['project']['id'];headers={'X-PHB-Project':str(other)}
        self.assertEqual(self.client.get(path,headers=headers).status_code,404)
        self.assertEqual(self.client.post('/api/finance-scenarios',headers=headers,json={'title':'Fremde Kopie','copy_id':row['id']}).status_code,404)
        data=self.payload(row);data['lines'][0].update(enabled=True,amount=3000,allocations={'loan:'+str(loan):2000})
        changed=self.client.put(path,json=data);self.assertEqual(changed.status_code,200,changed.json);row=changed.json['scenario'];self.assertGreater(row['summary']['gap'],0);self.assertTrue(row['summary']['warnings'])
        clone=self.post('/api/finance-scenarios',{'title':'Kopie','copy_id':row['id']})['scenario'];self.assertEqual(clone['data'],row['data']);self.assertNotEqual(clone['revision'],row['revision'])
        # The original quote changes; simulations only notice it until explicit adoption.
        obj=b.db.session.get(b.Offer,oid);obj.gross=200;b.db.session.commit()
        live=self.client.get(path).json['scenario'];self.assertEqual(live['data']['lines'][0]['amount'],3000);self.assertEqual(live['changes'][0]['current_amount'],200)
        data=self.payload(live);data['lines'][0]['allocations']={};live=self.client.put(path,json=data).json['scenario']
        adopted=self.post(path+'/offer-price',{'revision':live['revision'],'line_id':live['data']['lines'][0]['id']})['scenario']
        self.assertEqual(adopted['data']['lines'][0]['amount'],200);self.assertEqual(b.db.session.get(b.Offer,oid).gross,200)
        self.assertEqual(self.client.get('/api/finance-scenarios/'+str(clone['id'])).json['scenario']['data']['lines'][0]['amount'],3000)
        self.assertEqual(self.client.delete(path,json={'revision':adopted['revision'],'confirm':True}).status_code,200)
        self.assertEqual(b.db.session.get(b.Offer,oid).gross,200)
    def test_project_backup_roundtrip_legacy_archives_and_tampered_simulation_validation(self):
        self.setup_finance();self.offer(119);row=self.create()
        other=self.post('/api/projects',{'title':'Andere Baustelle'})['project']['id'];headers={'X-PHB-Project':str(other)}
        foreign=self.post('/api/finance-scenarios',{'title':'Unberührte Variante'},headers)['scenario']
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);store=root/'backups';store.mkdir();archive=project_backups.create(b.db,root,1,{'folder':str(store),'keep':5})
            self.client.delete('/api/finance-scenarios/'+str(row['id']),json={'revision':row['revision'],'confirm':True})
            project_backups.restore(archive,b.db,root,1)
            restored=self.client.get('/api/finance-scenarios/'+str(row['id'])).json['scenario'];self.assertEqual(restored['data'],row['data'])
            bad=copy.deepcopy(row['data']);bad['basis']['accounts'][0]['available']='NaN'
            with self.assertRaises(ValueError):validate_snapshot(json.dumps(bad))
            with zipfile.ZipFile(archive) as z:files={name:z.read(name) for name in z.namelist()}
            data=json.loads(files['project-data.json']);data['tables'].pop('finance_scenario')
            files['project-data.json']=json.dumps(data).encode();manifest=json.loads(files['backup-manifest.json']);manifest['files']['project-data.json']={'sha256':hashlib.sha256(files['project-data.json']).hexdigest(),'bytes':len(files['project-data.json'])};files['backup-manifest.json']=json.dumps(manifest).encode()
            legacy=root/'legacy.zip'
            with zipfile.ZipFile(legacy,'w') as z:
                for name,raw in files.items():z.writestr(name,raw)
            project_backups.restore(legacy,b.db,root,1);self.assertEqual(self.client.get('/api/finance-scenarios').json['scenarios'],[])
            self.assertEqual(b.db.session.query(b.Offer).count(),1)
            self.assertEqual(self.client.get('/api/finance-scenarios/'+str(foreign['id']),headers=headers).json['scenario']['data'],foreign['data'])
