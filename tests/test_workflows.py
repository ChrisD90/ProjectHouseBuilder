"""Regressionsfälle für Firmenvorschläge, Aufgabenabschluss und PDF-Vorschau."""
import os
os.environ['DATABASE_URL']='sqlite:///:memory:'
import tempfile
import unittest
from datetime import date
from pathlib import Path

import app as backend
from app import app, db, initialize, Task, Contractor, Offer, OfferSection, Document


class WorkflowTest(unittest.TestCase):
    def setUp(self):
        self.ctx=app.app_context()
        self.ctx.push()
        db.drop_all()
        initialize()
        self.client=app.test_client()

    def tearDown(self):
        db.session.remove()
        self.ctx.pop()

    def add_offer(self):
        company=Contractor(name='Solarfirma Demo',trade='Photovoltaik')
        db.session.add(company);db.session.flush()
        offer=Offer(digest='c'*64,contractor_id=company.id,
                    vendor=company.name,number='DEMO-42',filename='demo.pdf',
                    status='Angebot',reconciled=True,net=100,gross=119,vat=19)
        db.session.add(offer);db.session.flush()
        db.session.add(OfferSection(offer_id=offer.id,name='Photovoltaikanlage und Wechselrichter',
                                    net=100,gross=119,selected=False))
        db.session.commit()
        return company.id,offer.id

    def test_accepted_offer_suggests_but_does_not_automatically_assign(self):
        company_id,offer_id=self.add_offer()
        task=db.session.query(Task).filter_by(code='T37').one()
        self.assertNotIn(str(task.id),self.client.get('/api/project').get_json()['suggestions'])
        result=self.client.patch(f'/api/offers/{offer_id}',json={'status':'Angenommen'})
        self.assertEqual(result.status_code,200,result.get_json())
        proposal=self.client.get('/api/project').get_json()['suggestions'][str(task.id)]
        self.assertEqual(proposal[0]['contractor_id'],company_id)
        self.assertIsNone(db.session.get(Task,task.id).contractor_id)
        result=self.client.post('/api/tasks/assign-suggestions',json={
            'assignments':[{'task_id':task.id,'contractor_id':company_id}]})
        self.assertEqual(result.status_code,200,result.get_json())
        self.assertEqual(db.session.get(Task,task.id).contractor_id,company_id)

    def test_existing_company_is_not_overwritten(self):
        company_id,offer_id=self.add_offer()
        self.client.patch(f'/api/offers/{offer_id}',json={'status':'Angenommen'})
        other=Contractor(name='Bereits beauftragte Firma',trade='Elektro')
        db.session.add(other);db.session.flush()
        task=db.session.query(Task).filter_by(code='T37').one()
        task.contractor_id=other.id
        db.session.commit()
        self.assertNotIn(str(task.id),self.client.get('/api/project').get_json()['suggestions'])
        response=self.client.post('/api/tasks/assign-suggestions',json={
            'assignments':[{'task_id':task.id,'contractor_id':company_id}]})
        self.assertEqual(response.status_code,409)
        self.assertEqual(db.session.get(Task,task.id).contractor_id,other.id)

    def test_complete_sets_actual_end_and_is_idempotent(self):
        task=db.session.query(Task).filter_by(code='T09').one()
        self.assertIsNone(task.actual_end)
        result=self.client.post(f'/api/tasks/{task.id}/complete')
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.get_json()['actual_end'],date.today().isoformat())
        task=db.session.get(Task,task.id)
        self.assertEqual((task.status,task.progress,task.actual_end),('Erledigt',100,date.today()))
        self.assertEqual(self.client.post(f'/api/tasks/{task.id}/complete').status_code,200)

    def test_pdf_can_be_embedded_but_other_files_cannot(self):
        original=backend.DOCUMENT_ROOT
        with tempfile.TemporaryDirectory() as tmp:
            backend.DOCUMENT_ROOT=Path(tmp)
            try:
                (Path(tmp)/'demo.pdf').write_bytes(b'%PDF-1.4\n%%EOF')
                (Path(tmp)/'demo.txt').write_text('beleg',encoding='utf-8')
                pdf=Document(original_name='demo.pdf',stored_name='demo.pdf',kind='Angebot')
                txt=Document(original_name='demo.txt',stored_name='demo.txt',kind='Sonstiges')
                db.session.add_all([pdf,txt]);db.session.commit()
                result=self.client.get(f'/api/documents/{pdf.id}/view')
                self.assertEqual(result.status_code,200)
                self.assertIn('inline',result.headers['Content-Disposition'])
                self.assertEqual(result.mimetype,'application/pdf')
                self.assertEqual(self.client.get(f'/api/documents/{txt.id}/view').status_code,415)
            finally:
                backend.DOCUMENT_ROOT=original


if __name__=='__main__':
    unittest.main()
