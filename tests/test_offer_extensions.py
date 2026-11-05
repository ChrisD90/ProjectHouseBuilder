import io
import hashlib
import json
import os
import tempfile
import unittest
import zipfile
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b
import project_backups as backups

class OfferExtensionsTests(unittest.TestCase):
    def setUp(self):
        self.ctx=b.app.app_context();self.ctx.push();b.db.session.remove();b.db.drop_all();b.initialize()
        self.client=b.app.test_client();self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.docs=self.root/'private'/'documents';self.docs.mkdir(parents=True)
        p=patch.object(b,'DOCUMENT_ROOT',self.docs);p.start();self.addCleanup(p.stop)
        offer=b.Offer(vendor='Firma',filename='Angebot.pdf',digest='test-offer',status='Entwurf',net=1000,gross=1190,vat=190,tax_rate=19,category='Sonstiges')
        b.db.session.add(offer);b.db.session.flush();self.oid=offer.id
        for i,amount in enumerate((500,500)):
            b.db.session.add(b.OfferPosition(offer_id=offer.id,number=str(i+1),section='Leistungen',description='Arbeiten '+str(i+1),net_amount=amount,optional=False))
        b.db.session.commit();self.path='/api/offers/'+str(self.oid)
    def tearDown(self):
        b.db.session.remove();b.db.drop_all();self.ctx.pop()
    def offer(self):return next(row for row in self.client.get('/api/offers').json['offers'] if row['id']==self.oid)
    def attachment(self,name='Zusatz.txt'):
        return self.client.post(self.path+'/attachments',data={'file':(io.BytesIO(b'Zusatzdokument'),name)},content_type='multipart/form-data')

    def test_saved_draft_acknowledges_revision_before_status_transition(self):
        before=self.client.get('/api/offers').json['_versions'][self.path]
        draft=self.client.patch(self.path+'/draft',headers={'If-Match':before},json={'notes':'Geprüft','positions':self.offer()['positions']})
        self.assertEqual(draft.status_code,200,draft.json)
        after=draft.json['_versions'][self.path];self.assertNotEqual(before,after)
        listed=self.client.patch(self.path,headers={'If-Match':after},json={'status':'Angebot'})
        self.assertEqual(listed.status_code,200,listed.json)
        stale=self.client.patch(self.path+'/draft',headers={'If-Match':before},json={'notes':'Nicht überschreiben'})
        self.assertEqual(stale.status_code,409);self.assertEqual(self.offer()['notes'],'Geprüft')

    def test_diy_selection_preserves_order_and_financial_totals(self):
        self.assertEqual(self.client.patch(self.path,json={'status':'Angebot'}).status_code,200)
        accepted=self.client.patch(self.path,json={'status':'Angenommen'});self.assertEqual(accepted.status_code,200,accepted.json)
        position=self.offer()['positions'][0]['id']
        selected=self.client.patch(self.path+'/diy',json={'position_ids':[position]})
        self.assertEqual(selected.status_code,200,selected.json)
        offer=selected.json['offer'];self.assertEqual(offer['diy_estimate']['remaining_gross'],595)
        self.assertEqual(offer['gross'],1190);self.assertEqual(offer['agreed_gross'],1190)
        self.assertEqual(float(b.db.session.query(b.CostItem).filter_by(offer_id=self.oid).one().committed),1190)
        self.assertEqual(self.client.patch(self.path+'/diy',json={'position_ids':[999999]}).status_code,400)
        self.assertEqual(self.client.patch(self.path+'/diy',json={'position_ids':[]}).json['offer']['diy_estimate']['remaining_gross'],1190)

    def test_optional_missing_prices_and_unknown_tax_never_invent_savings(self):
        rows=self.offer()['positions'];rows[0]['own_work']=True;rows[0]['net_amount']=None
        result=self.client.patch(self.path+'/draft',json={'positions':rows})
        self.assertEqual(result.status_code,200,result.json);self.assertIsNone(result.json['offer']['diy_estimate']['remaining_gross'])
        rows[0]['net_amount']=500;rows[0]['optional']=True
        result=self.client.patch(self.path+'/draft',json={'positions':rows})
        self.assertEqual(result.json['offer']['diy_estimate']['remaining_gross'],1190)
        rows[0]['optional']=False
        result=self.client.patch(self.path+'/draft',json={'positions':rows,'net':None})
        self.assertIsNone(result.json['offer']['diy_estimate']['remaining_gross'])
        rows[0]['own_work']='false'
        self.assertEqual(self.client.patch(self.path+'/draft',json={'positions':rows}).status_code,400)

    def test_new_pdf_revision_keeps_positions_without_diy_metadata(self):
        positions=self.offer()['positions']
        for position in positions:position.pop('own_work',None)
        snapshot=b._reviewed_version_from_pdf(b.db.session.get(b.Offer,self.oid),{'positions':positions},'new-digest',SimpleNamespace(id=None),'new.pdf','Sonstiges')
        self.assertEqual(len(snapshot['positions']),2)
        self.assertTrue(all(position['own_work'] is False for position in snapshot['positions']))

    def test_attachments_are_project_scoped_and_listed_in_documents(self):
        response=self.attachment();self.assertEqual(response.status_code,201,response.json)
        self.assertEqual(self.attachment().status_code,200)
        self.assertEqual(len(self.offer()['attachments']),1)
        document=response.json['offer']['attachments'][0];did=document['id']
        preview=self.client.get(document['view_url']);self.assertEqual(preview.data,b'Zusatzdokument');preview.close()
        self.assertEqual(next(d for d in self.client.get('/api/document-library').json['documents'] if d['id']=='file-'+str(did))['source'],'Angebote')
        other=self.client.post('/api/projects',json={'title':'Anderes Projekt'}).json['project']['id'];headers={'X-PHB-Project':str(other)}
        self.assertEqual(self.client.get(document['view_url'],headers=headers).status_code,404)
        self.assertEqual(self.client.delete(self.path+'/attachments/'+str(did),headers=headers).status_code,404)
        self.assertEqual(self.client.delete(self.path+'/attachments/'+str(did)).status_code,200)
        self.assertEqual(list(self.docs.iterdir()),[])

    def test_attachment_failure_is_atomic_and_offer_deletion_removes_files(self):
        self.assertEqual(self.attachment('bad.exe').status_code,400)
        with patch.object(b.db.session,'commit',side_effect=RuntimeError('DB offline')):
            self.assertEqual(self.attachment().status_code,500)
        b.db.session.rollback();self.assertEqual(list(self.docs.iterdir()),[]);self.assertEqual(b.db.session.query(b.Document).count(),0)
        self.assertEqual(self.attachment().status_code,201)
        self.assertEqual(self.client.delete(self.path).status_code,200)
        self.assertEqual(b.db.session.query(b.Document).count(),0);self.assertEqual(list(self.docs.iterdir()),[])

    def test_backup_restores_diy_and_attachment_links_with_original_files(self):
        self.assertEqual(self.attachment().status_code,201)
        first=self.offer()['positions'][0]['id'];self.client.patch(self.path+'/diy',json={'position_ids':[first]})
        store=self.root/'backups';store.mkdir();archive=backups.create(b.db,self.root,1,{'folder':store,'keep':2})
        self.client.patch(self.path+'/diy',json={'position_ids':[]})
        backups.restore(archive,b.db,self.root,1)
        result=self.offer();self.assertEqual(result['diy_estimate']['remaining_gross'],595)
        self.assertEqual(len(result['attachments']),1)
        doc=b.db.session.get(b.Document,result['attachments'][0]['id']);self.assertEqual((self.docs/doc.stored_name).read_bytes(),b'Zusatzdokument')

    def test_pre_0034_backup_adds_only_known_attachment_and_diy_defaults(self):
        doc=b.Document(original_name='Original.pdf',stored_name='original.pdf',kind='Angebot');b.db.session.add(doc);b.db.session.flush()
        b.db.session.get(b.Offer,self.oid).document_id=doc.id;b.db.session.commit();(self.docs/'original.pdf').write_bytes(b'%PDF-original')
        store=self.root/'backups';store.mkdir();archive=backups.create(b.db,self.root,1,{'folder':store,'keep':2})
        with zipfile.ZipFile(archive) as source:files={name:source.read(name) for name in source.namelist()}
        data=json.loads(files['project-data.json']);manifest=json.loads(files['backup-manifest.json'])
        for row in data['tables']['document']:row.pop('offer_id')
        for row in data['tables']['offer_position']:row.pop('own_work')
        raw=json.dumps(data).encode();files['project-data.json']=raw;manifest['files']['project-data.json']={'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
        files['backup-manifest.json']=json.dumps(manifest).encode()
        with zipfile.ZipFile(archive,'w') as target:
            for name,content in files.items():target.writestr(name,content)
        _,rows=backups.load_rows(archive,b.db,1)
        self.assertIsNone(rows['document'][0]['offer_id']);self.assertTrue(all(row['own_work'] is False for row in rows['offer_position']))
