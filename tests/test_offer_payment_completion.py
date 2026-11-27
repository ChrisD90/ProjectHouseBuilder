"""Manual completion, actual payments, project isolation and backup compatibility."""
import os,json,hashlib,tempfile,unittest,zipfile
from pathlib import Path
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b
import project_backups

class OfferPaymentCompletionTest(unittest.TestCase):
    def setUp(self):
        self.ctx=b.app.app_context();self.ctx.push();b.db.session.remove();b.db.drop_all();b.initialize();self.client=b.app.test_client()
    def tearDown(self):b.db.session.remove();b.db.drop_all();self.ctx.pop()
    def offer(self):
        response=self.client.post('/api/offers/manual',json={'vendor':'Betrieb','gross':100,'category':'Sonstiges'})
        self.assertEqual(response.status_code,201,response.json);ident=response.json['id']
        self.assertEqual(self.client.patch('/api/offers/'+str(ident),json={'status':'Angenommen'}).status_code,200)
        return ident
    def listing(self):return self.client.get('/api/offers').json
    def mark(self,ident,value):
        response=self.client.post('/api/offers/'+str(ident)+'/payment-completion',json={'completed':value,'confirm':True})
        self.assertEqual(response.status_code,200,response.json);return response.json['offer']
    def test_completion_never_books_payments_and_overruns_do_not_cover_other_orders(self):
        ids=[self.offer() for _ in range(3)]
        for ident,amount in zip(ids,[60,120,100]):
            item=b.db.session.scalar(b.select(b.CostItem).where(b.CostItem.offer_id==ident))
            b.db.session.add(b.Receipt(digest=str(ident),original_name='Rechnung',stored_name=str(ident),status='Gebucht',gross_amount=amount,paid_amount=amount,cost_item_id=item.id))
        b.db.session.commit()
        before=[(x.id,x.paid_amount,x.gross_amount,x.status) for x in b.db.session.scalars(b.select(b.Receipt))]
        initial=self.listing();self.assertEqual(initial['payment_totals'],{'agreed':300,'paid':280,'open':40})
        self.assertTrue(all(not row['payment_completed'] for row in initial['offers']),'Even exactly paid or overpaid orders remain manually open')
        path='/api/offers/'+str(ids[0])+'/payment-completion'
        self.assertEqual(self.client.post(path,json={'completed':True}).status_code,400)
        self.assertEqual(self.client.post(path,json={'completed':'true','confirm':True}).status_code,400)
        stale=self.listing()['_versions']['/api/offers/'+str(ids[0])]
        self.assertTrue(self.mark(ids[0],True)['payment_completed']);self.mark(ids[0],True)
        self.assertEqual(self.listing()['payment_totals'],{'agreed':300,'paid':280,'open':0})
        self.assertEqual(self.client.post(path,headers={'If-Match':stale},json={'completed':False,'confirm':True}).status_code,409)
        self.assertFalse(self.mark(ids[0],False)['payment_completed']);self.assertEqual(self.listing()['payment_totals']['open'],40)
        other=self.client.post('/api/projects',json={'title':'Anderes Projekt'}).json['project']['id'];headers={'X-PHB-Project':str(other)}
        self.assertEqual(self.client.post(path,headers=headers,json={'completed':True,'confirm':True}).status_code,404)
        self.assertEqual(self.client.get('/api/offers',headers=headers).json['payment_totals'],{'agreed':0,'paid':0,'open':0})
        self.assertEqual([(x.id,x.paid_amount,x.gross_amount,x.status) for x in b.db.session.scalars(b.select(b.Receipt))],before)
        self.assertEqual(b.db.session.query(b.ReceiptFinancingPayment).count(),0)
    def test_backup_roundtrip_legacy_defaults_and_acceptance_reversal(self):
        ident=self.offer();self.mark(ident,True)
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);store=root/'backups';store.mkdir()
            archive=project_backups.create(b.db,root,1,{'folder':str(store),'keep':5})
            self.mark(ident,False);project_backups.restore(archive,b.db,root,1)
            self.assertTrue(self.listing()['offers'][0]['payment_completed'])
            with zipfile.ZipFile(archive) as z:contents={name:z.read(name) for name in z.namelist()}
            data=json.loads(contents['project-data.json'])
            for row in data['tables']['offer']:row.pop('payment_completed')
            contents['project-data.json']=json.dumps(data).encode();manifest=json.loads(contents['backup-manifest.json'])
            manifest['files']['project-data.json']={'sha256':hashlib.sha256(contents['project-data.json']).hexdigest(),'bytes':len(contents['project-data.json'])}
            contents['backup-manifest.json']=json.dumps(manifest).encode();legacy=root/'legacy.zip'
            with zipfile.ZipFile(legacy,'w') as z:
                for name,raw in contents.items():z.writestr(name,raw)
            project_backups.restore(legacy,b.db,root,1)
            self.assertFalse(self.listing()['offers'][0]['payment_completed'])
        self.mark(ident,True)
        self.assertEqual(self.client.post('/api/offers/'+str(ident)+'/reverse-acceptance',json={'confirm':True}).status_code,200)
        self.assertFalse(self.listing()['offers'][0]['payment_completed'])
        self.assertEqual(self.client.post('/api/offers/'+str(ident)+'/payment-completion',json={'completed':True,'confirm':True}).status_code,409)
