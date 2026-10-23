"""Private project document library and opt-in multimodal planning safeguards."""
import io
import json
import os
import unittest
from unittest.mock import patch
os.environ['DATABASE_URL']='sqlite:///:memory:'
from app import app, db, initialize, ProjectDocument, ScheduleHistory, PROJECT_DOCUMENT_ROOT
from chatgpt_local import chatgpt
from project_documents import inspect_upload, matching_score

class ProjectDocumentTests(unittest.TestCase):
    def setUp(self):
        self.ctx=app.app_context();self.ctx.push()
        db.session.remove();db.drop_all();initialize()
        self.client=app.test_client()
    def tearDown(self):
        for d in db.session.query(ProjectDocument).all():
            (PROJECT_DOCUMENT_ROOT/d.stored_name).unlink(missing_ok=True)
        db.session.remove();db.drop_all();self.ctx.pop()
    def upload(self,blob=b'%PDF-1.4\nTest document\n',name='zeichnung.pdf',**meta):
        return self.client.post('/api/project-documents',data={
          'file':(io.BytesIO(blob),name),'title':'Elektroplan OG',
          'area':'Elektrik','category':'Technische Zeichnung','status':'Aktuell',
          'tags':'Elektro Leitungen','description':'Verteilung',**meta
        },content_type='multipart/form-data')

    def test_private_upload_edit_filter_download_duplicate_delete(self):
        from pypdf import PdfWriter
        writer=PdfWriter();writer.add_blank_page(width=600,height=800)
        pdf=io.BytesIO();writer.write(pdf)
        res=self.upload(pdf.getvalue())
        self.assertEqual(res.status_code,201,res.json)
        doc=res.json['document'];did=doc['id']
        self.assertEqual(doc['area'],'Elektrik')
        self.assertFalse(doc['has_searchable_text'])
        self.assertTrue(doc['extraction_note'])
        self.assertEqual(self.upload(pdf.getvalue()).status_code,409)
        records=self.client.get('/api/project-documents').json['documents']
        self.assertEqual(len(records),1)
        self.assertEqual(records[0]['title'],'Elektroplan OG')
        fetched=self.client.get('/api/project-documents/'+str(did)+'/download')
        self.assertEqual(fetched.data,pdf.getvalue())
        self.assertEqual(fetched.headers['Cache-Control'],'no-store')
        changed=self.client.patch('/api/project-documents/'+str(did),json={
            'title':'Elektroplanung – freigegeben','status':'Überholt','tags':'Altstand'})
        self.assertEqual(changed.status_code,200,changed.json)
        self.assertEqual(changed.json['document']['status'],'Überholt')
        self.assertEqual(self.client.get('/api/project-documents/suggest?q=Elektro').json['suggestions'],[])
        self.assertEqual(self.client.patch('/api/project-documents/'+str(did),
            json={'stored_name':'../attack'}).status_code,400)
        self.assertEqual(self.client.delete('/api/project-documents/'+str(did)).status_code,200)
        self.assertEqual(self.client.get('/api/project-documents/'+str(did)+'/download').status_code,404)

    def test_metadata_and_utf8_text_suggested_locally(self):
        uploaded=self.upload('Dachkonstruktion im OG'.encode(),name='notizen.txt',
            title='Treppenhinweise',area='Innenausbau',category='Protokoll',tags='Treppe Statik')
        self.assertEqual(uploaded.status_code,201,uploaded.json)
        result=self.client.get('/api/project-documents/suggest?q=Treppenhinweise').json
        self.assertEqual(result['suggestions'][0]['id'],uploaded.json['document']['id'])
        self.assertGreater(result['suggestions'][0]['score'],0)

    def test_malformed_and_large_documents_rejected(self):
        self.assertEqual(self.upload(b'not a pdf').status_code,400)
        self.assertEqual(self.upload(b'invalid',name='a.docx').status_code,400)
        self.assertEqual(self.upload(b'abc',name='evil.exe').status_code,400)
        self.assertEqual(self.upload(b'a'*(12*1024*1024+1),name='a.txt').status_code,400)
        self.assertEqual(self.client.get('/api/project-documents').json['documents'],[])

    def test_drawing_is_never_sent_without_selection_and_is_audited(self):
        from PIL import Image
        im=Image.new('RGB',(16,16),'white')
        src=io.BytesIO();im.save(src,format='PNG')
        selected=self.upload(src.getvalue(),name='treppe.png',title='Treppenplan',area='Innenausbau')
        self.assertEqual(selected.status_code,201,selected.json)
        did=selected.json['document']['id']
        created=self.client.post('/api/tasks',json={'code':'A1','name':'Treppenbau',
            'duration':5,'lag_days':0,'execution_type':'Fremdleistung',
            'predecessors':[],'status':'Offen','progress':0})
        self.assertEqual(created.status_code,201,created.json)
        response=json.dumps({'answer':'Treppe nach Bauplan prüfen (DOK-'+str(did)+').',
                             'decision':'Planungsstand beachten','changes':[]})
        def ask(ids):
            return self.client.post('/api/ai/schedule/chat',
                json={'plan_only':True,'model':'m1','message':'Treppe prüfen',
                      'document_ids':ids},headers={'X-PHB-AI':'1'},
                base_url='http://127.0.0.1:5055')
        with patch.object(chatgpt,'status',return_value={'sharing':True}),\
             patch.object(chatgpt,'run',return_value=response) as mock:
            none=ask([])
            self.assertEqual(none.status_code,200,none.json)
            self.assertIsInstance(mock.call_args.args[0],str)
            approved=ask([did])
        self.assertEqual(approved.status_code,200,approved.json)
        self.assertEqual(mock.call_count,2)
        payload=mock.call_args.args[0]
        self.assertEqual(payload[0]['content'][1]['type'],'input_text')
        self.assertEqual(payload[0]['content'][2]['type'],'input_image')
        self.assertIn('image/png;base64',payload[0]['content'][2]['image_url'])
        self.assertEqual(approved.json['source_documents'][0]['id'],did)
        self.assertEqual(self.client.get('/api/schedule/history').json['history'][0]['source_documents'][0]['id'],did)

    def test_noncurrent_or_invalid_selection_fails_before_model(self):
        result=self.upload('Geprüfte Zeichnung'.encode(),name='plan.txt')
        did=result.json['document']['id']
        created=self.client.post('/api/tasks',json={'code':'X','name':'Baustelle',
            'duration':3,'lag_days':0,'execution_type':'Fremdleistung',
            'predecessors':[],'status':'Offen','progress':0})
        self.assertEqual(created.status_code,201,created.json)
        def call(ids):
            return self.client.post('/api/ai/schedule/chat',json={
              'model':'m1','plan_only':True,'message':'Was nun?','document_ids':ids},
              headers={'X-PHB-AI':'1'},base_url='http://127.0.0.1:5055')
        with patch.object(chatgpt,'status',return_value={'sharing':True}),\
             patch.object(chatgpt,'run') as mocked:
            self.assertEqual(call([did,did]).status_code,400)
            self.assertEqual(call([123456]).status_code,400)
            self.assertEqual(call([did]*4).status_code,400)
            self.assertEqual(call(['1']).status_code,400)
            self.client.patch('/api/project-documents/'+str(did),json={'status':'Überholt'})
            self.assertEqual(call([did]).status_code,400)
            mocked.assert_not_called()

if __name__=='__main__': unittest.main()
