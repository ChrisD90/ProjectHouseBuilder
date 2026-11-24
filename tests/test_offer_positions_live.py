"""Position edits preserve project boundaries, selected IDs and binding order values."""
import json,os,unittest
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b
from multi_projects import project_context

class OfferPositionsLiveTest(unittest.TestCase):
    def setUp(self):
        self.ctx=b.app.app_context();self.ctx.push();b.db.session.remove();b.db.drop_all();b.initialize();self.client=b.app.test_client()
    def tearDown(self):b.db.session.remove();b.db.drop_all();self.ctx.pop()
    def create(self):
        response=self.client.post('/api/offers/manual',json={'vendor':'Testfirma','gross':119,'net':100,'vat':19,'category':'Sonstiges'})
        self.assertEqual(response.status_code,201,response.json);return response.json['offer']
    def save(self,offer,rows,**extra):
        return self.client.put('/api/offers/'+str(offer['id'])+'/positions',json={'positions':rows,'tax_rate':19,'positions_token':offer['positions_token'],**extra})
    def test_positions_drive_totals_and_preserve_selected_ids(self):
        offer=self.create();ident=offer['positions'][0]['id']
        funding=b.Funding(name='Förderplanung');b.db.session.add(funding);b.db.session.flush()
        b.db.session.add(b.FundingPlan(funding_id=funding.id));b.db.session.flush()
        link=b.FundingPlanOffer(funding_id=funding.id,offer_id=offer['id'],position_ids=json.dumps([ident]));b.db.session.add(link);b.db.session.commit()
        rows=[{**offer['positions'][0],'description':'Leistung korrigiert','net_amount':'105.55'},dict(description='Zusatzleistung',net_amount='10.01',optional=False),dict(description='Option',net_amount='900',optional=True)]
        response=self.save(offer,rows,tax_rate=7);self.assertEqual(response.status_code,200,response.json)
        changed=response.json['offer'];self.assertEqual((changed['net'],changed['vat'],changed['gross']),(115.56,8.09,123.65))
        self.assertEqual(changed['positions'][0]['id'],ident);self.assertEqual(json.loads(link.position_ids),[ident])
        blocked=self.save(changed,[dict(description='Ersatz',net_amount='100')]);self.assertEqual(blocked.status_code,400)
        self.assertIn('Förderplanung',blocked.json['error'])
        stale=self.save(offer,rows);self.assertEqual(stale.status_code,409)
        self.assertEqual(self.client.patch('/api/offers/'+str(offer['id'])+'/draft',json={'gross':'999'}).status_code,409)
    def test_invalid_or_foreign_edits_do_not_change_data_and_order_value_stays_fixed(self):
        offer=self.create();original=offer['positions'][0]
        accepted=self.client.post('/api/offers/'+str(offer['id'])+'/accept',data={'confirm':'true','mode':'offer'})
        self.assertEqual(accepted.status_code,201,accepted.json)
        offer=accepted.json['offer']
        for rows in ([],[dict(description='Nur optional',net_amount='1',optional=True)],[{**original,'id':999999}],[{**original,'net_amount':'NaN'}]):
            result=self.save(offer,rows);self.assertEqual(result.status_code,400,result.json)
        other=self.client.post('/api/projects',json={'title':'Anderes Projekt'}).json['project']['id']
        response=self.client.put('/api/offers/'+str(offer['id'])+'/positions',headers={'X-PHB-Project':str(other)},json={})
        self.assertEqual(response.status_code,404)
        result=self.save(offer,[{**original,'net_amount':'200'}]);self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(result.json['offer']['gross'],238);self.assertEqual(result.json['offer']['agreed_gross'],119)
        item=b.db.session.scalar(b.select(b.CostItem).where(b.CostItem.offer_id==offer['id']));self.assertEqual(item.committed,119)
    def test_backfill_only_adds_missing_rows_preserving_all_projects_and_amounts(self):
        first=self.create();second=self.create()
        owner=self.client.post('/api/projects',json={'title':'Garten'}).json['project']['id']
        response=self.client.post('/api/offers/manual',headers={'X-PHB-Project':str(owner)},json={'vendor':'Gartenfirma','gross':119,'net':100,'vat':19,'category':'Sonstiges'})
        self.assertEqual(response.status_code,201,response.json);foreign=response.json['offer']
        b.db.session.commit()
        from offer_positions import backfill
        with b.db.engine.begin() as connection:
            table=b.OfferPosition.__table__
            connection.execute(table.delete().where(table.c.offer_id.in_([first['id'],foreign['id']])))
            self.assertEqual(backfill(connection,owner=1),1)
            self.assertEqual(backfill(connection),1);self.assertEqual(backfill(connection),0)
        b.db.session.expire_all()
        self.assertEqual([p.id for p in b.db.session.get(b.Offer,second['id']).positions],[second['positions'][0]['id']])
        self.assertEqual(b.db.session.get(b.Offer,first['id']).gross,119)
        with project_context(owner):
            obj=b.db.session.get(b.Offer,foreign['id']);self.assertEqual(obj.gross,119);self.assertEqual(len(obj.positions),1);self.assertEqual(obj.positions[0].project_id,owner)
