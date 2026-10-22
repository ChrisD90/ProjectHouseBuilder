"""Category CRUD; no losing linked documents or cost assignments."""
import os,unittest
os.environ['DATABASE_URL']='sqlite:///:memory:'
from app import app,db,initialize,Receipt,CostItem,BudgetLine

class CategoryTests(unittest.TestCase):
 def setUp(self):
  self.ctx=app.app_context();self.ctx.push();db.drop_all();initialize();self.c=app.test_client()
 def tearDown(self):
  db.session.remove();db.drop_all();self.ctx.pop()
 def test_custom_category_and_rename(self):
  response=self.c.post('/api/categories',json={'name':'Garten & Hof'})
  self.assertEqual(response.status_code,201,response.json)
  cid=response.json['id'];self.assertIn('Garten & Hof',self.c.get('/api/receipts').json['categories'])
  self.assertEqual(self.c.post('/api/categories',json={'name':'garten & hof'}).status_code,400)
  item=CostItem(category='Garten & Hof',title='Pflaster',estimate=500)
  db.session.add(item);db.session.commit()
  self.assertEqual(self.c.delete('/api/categories/'+str(cid)).status_code,409)
  self.assertEqual(self.c.patch('/api/categories/'+str(cid),json={'name':'Außenanlagen'}).status_code,200)
  self.assertEqual(db.session.get(CostItem,item.id).category,'Außenanlagen')
  db.session.delete(item);db.session.commit()
  self.assertEqual(self.c.delete('/api/categories/'+str(cid)).status_code,200)
 def test_defaults_and_protection(self):
  cats=self.c.get('/api/categories').json['categories']
  self.assertTrue(any(x['name']=='Werkzeug' for x in cats))
  other=next(x for x in cats if x['name']=='Sonstiges')
  self.assertEqual(self.c.delete('/api/categories/'+str(other['id'])).status_code,409)
  initialize()
  self.assertEqual(len(cats),len(self.c.get('/api/categories').json['categories']))

if __name__=='__main__':unittest.main()
