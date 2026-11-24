"""Import previews and conflict resolution must not silently overwrite offer data."""
import csv,io,os,unittest
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b
from openpyxl import Workbook,load_workbook
from offer_position_imports import HEADERS

class OfferPositionImportTest(unittest.TestCase):
    def setUp(self):
        self.ctx=b.app.app_context();self.ctx.push();b.db.session.remove();b.db.drop_all();b.initialize();self.client=b.app.test_client()
        self.offer=self.client.post('/api/offers/manual',json={'vendor':'Importfirma','net':100,'vat':19,'gross':119,'category':'Sonstiges'}).json['offer']
        self.path='/api/offers/'+str(self.offer['id'])+'/positions/'
    def tearDown(self):b.db.session.remove();b.db.drop_all();self.ctx.pop()
    def csv(self,rows,headers=HEADERS):
        out=io.StringIO(newline='');writer=csv.writer(out,delimiter=';');writer.writerow(headers);writer.writerows(rows);return out.getvalue().encode('utf-8-sig')
    def preview(self,raw,name='test.csv',**kwargs):
        return self.client.post(self.path+'import-preview',data={'file':(io.BytesIO(raw),name),'positions':b.json.dumps(self.offer['positions']),'positions_token':self.offer['positions_token']},**kwargs)
    def apply(self,token,decisions):
        return self.client.post(self.path+'import-apply',json={'token':token,'positions':self.offer['positions'],'decisions':decisions})
    def test_conflicts_require_selection_preserve_ids_and_only_final_save_changes_totals(self):
        raw=self.csv([('1','Korrigiert',2,'Stk.','25,00','50,00','','Nein','Ja'),('2','Neu',3,'m','10,00','30,00','','Nein','Nein'),('2','Doppelt',1,'m',1,1,'','Nein','Nein')])
        response=self.preview(raw);self.assertEqual(response.status_code,200,response.json)
        preview=response.json;self.assertEqual([r['status'] for r in preview['rows']],['conflict','duplicate','duplicate'])
        invalid=self.apply(preview['token'],[{'action':'add'},{'action':'add'},{'action':'add'}]);self.assertEqual(invalid.status_code,400)
        result=self.apply(preview['token'],[{'action':'replace'},{'action':'add'},{'action':'skip'}]);self.assertEqual(result.status_code,200,result.json)
        rows=result.json['positions'];self.assertEqual(rows[0]['id'],self.offer['positions'][0]['id']);self.assertTrue(rows[0]['own_work'])
        self.assertEqual(b.db.session.get(b.Offer,self.offer['id']).net,100)
        saved=self.client.put(self.path.rstrip('/'),json={'positions':rows,'tax_rate':19,'positions_token':self.offer['positions_token']})
        self.assertEqual(saved.status_code,200,saved.json);self.assertEqual(saved.json['offer']['net'],80);self.assertEqual(saved.json['offer']['gross'],95.2)
        stale=self.apply(preview['token'],[{'action':'replace'},{'action':'add'},{'action':'skip'}]);self.assertEqual(stale.status_code,409)
    def test_fixed_columns_formulas_templates_and_project_isolation(self):
        bad=self.preview(self.csv([],tuple(reversed(HEADERS))));self.assertEqual(bad.status_code,400)
        book=Workbook();sheet=book.active;sheet.append(HEADERS);sheet.append(('3','Formel',1,'Stk.',50,'=C2*E2','','Nein','Nein'));out=io.BytesIO();book.save(out);book.close()
        response=self.preview(out.getvalue(),'test.xlsx');self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['rows'][0]['status'],'invalid');self.assertIn('Formeln',response.json['rows'][0]['message'])
        result=self.apply(response.json['token'],[{'action':'add'}]);self.assertEqual(result.status_code,400)
        other=self.client.post('/api/projects',json={'title':'Anderes Projekt'}).json['project']['id']
        foreign=self.preview(self.csv([('1','Privat',1,'Stk.',5,5,'','Nein','Nein')]),headers={'X-PHB-Project':str(other)})
        self.assertEqual(foreign.status_code,404)
        template=self.client.get('/api/offers/positions/import-template.xlsx');self.assertEqual(template.status_code,200)
        workbook=load_workbook(io.BytesIO(template.data),read_only=True);self.assertEqual(tuple(cell.value for cell in next(workbook.active.iter_rows())),HEADERS);workbook.close()
        self.assertEqual(b.db.session.get(b.Offer,self.offer['id']).net,100)
