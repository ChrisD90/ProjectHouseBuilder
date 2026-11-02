"""PostgreSQL 17 integration. Use only a fresh, disposable local phb_* database."""
from datetime import date
from decimal import Decimal
from pathlib import Path
import io
import os
import sys
import tempfile
from uuid import uuid4
import sqlalchemy as sa
from sqlalchemy.engine import make_url
import psycopg

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))


def main():
    supplied=os.environ.get('PHB_PG_TEST_URL','')
    if not supplied:raise RuntimeError('PHB_PG_TEST_URL must name a fresh disposable local database.')
    url=make_url(supplied)
    if not url.drivername.startswith('postgresql') or url.host not in ('127.0.0.1','localhost') or not (url.database or '').startswith('phb_'):
        raise RuntimeError('Refusing a non-local or non-test database.')
    engine=sa.create_engine(url)
    if sa.inspect(engine).get_table_names():raise RuntimeError('Refusing a nonempty test database. Start a fresh container/database.')
    with engine.connect() as connection:
        version=connection.scalar(sa.text('SHOW server_version'))
        assert version.startswith('17.'),version
    engine.dispose()
    os.environ['DATABASE_URL']=supplied
    with tempfile.TemporaryDirectory(prefix='phb-pg-projects-') as temp:
        os.environ['PHB_CHATGPT_HOME']=str(Path(temp)/'profile')
        import app as b
        from multi_projects import project_context
        from project_schema import upgrade_project_schema,SCOPED_UNIQUE
        b.ROOT=Path(temp)/'app';b.ROOT.mkdir()
        b.PROJECT_DOCUMENT_ROOT=b.ROOT/'private'/'project-documents'
        b.RECEIPT_ROOT=b.ROOT/'private'/'receipts'
        with b.app.app_context():
            b.initialize();client=b.app.test_client()
            result=client.post('/api/projects',json={'title':'Garten PostgreSQL','kind':'Garten','start_date':'2027-04-01'})
            assert result.status_code==201,result.json
            pid=result.json['project']['id'];assert pid==2,pid
            def headers(owner):return {'X-PHB-Project':str(owner)}
            offers=[];tasks=[]
            for owner in (1,pid):
                result=client.post('/api/offers/manual',headers=headers(owner),json={'vendor':'PG Firma '+str(owner),'gross':1000,'category':'Sonstiges'})
                assert result.status_code==201,result.json;offers.append(result.json['id'])
                result=client.post('/api/tasks',headers=headers(owner),json={'code':'AP-001','name':'Paket '+str(owner),'trade':'Sonstiges','duration':1,'execution_type':'Noch offen','predecessors':[]})
                assert result.status_code in (200,201),result.json
                tasks.append(client.get('/api/project',headers=headers(owner)).json['tasks'][0]['id'])
                with project_context(owner):
                    b.db.session.add(b.Receipt(digest='same-document',original_name='Beleg.pdf',stored_name='pg-'+str(owner)+'.pdf',gross_amount=Decimal('100'),paid_amount=0))
                    b.db.session.commit()
                    b.RECEIPT_ROOT.mkdir(parents=True,exist_ok=True)
                    (b.RECEIPT_ROOT/('pg-'+str(owner)+'.pdf')).write_bytes(b'%PDF-test-'+str(owner).encode())
            assert client.post(f'/api/offers/{offers[1]}/accept',headers=headers(pid),data={'mode':'offer','confirm':'true'}).status_code==201
            assert client.get('/api/costs').json['summary']['planned']==0
            assert client.get('/api/costs',headers=headers(pid)).json['summary']['planned']==1000
            assert client.patch(f'/api/offers/{offers[0]}/draft',headers=headers(pid),json={'notes':'Falsches Projekt'}).status_code==404
            assert client.post('/api/funding',headers=headers(pid),json={'name':'Falscher Bezug','offer_id':offers[0]}).status_code==400
            company=client.post('/api/contractors',json={'name':'Firma Projekt 1','trade':'Sonstiges'})
            assert company.status_code in (200,201),company.json
            company_id=company.json.get('id') or company.json.get('contractor',{}).get('id')
            if not company_id:company_id=client.get('/api/costs').json['contractors'][0]['id']
            with project_context(pid):
                task=b.db.session.get(b.Task,tasks[1]);task.contractor_id=company_id
                try:b.db.session.commit()
                except ValueError:b.db.session.rollback()
                else:raise AssertionError('Cross-project company link was accepted')
                assert b.db.session.query(b.Task).count()==1
            docs=[]
            for owner in (1,pid):
                result=client.post('/api/project-documents',headers=headers(owner),data={'file':(io.BytesIO(b'Identical file'),'owner.txt')})
                assert result.status_code==201,result.json;docs.append(result.json['document']['id'])
            assert client.get(f'/api/project-documents/{docs[1]}/preview').status_code==404
            viewed=client.get(f'/api/project-documents/{docs[1]}/preview?project_id={pid}')
            assert viewed.status_code==200 and viewed.data==b'Identical file';viewed.close()
            project_rows=client.get('/api/projects').json['projects']
            assert next(row for row in project_rows if row['id']==1)['forecast']==0
            assert next(row for row in project_rows if row['id']==pid)['forecast']==1000
            b.db.session.remove();b.db.engine.dispose()
            from unittest.mock import patch
            from funding_estimates import BAFA_URL
            import json
            plan_headers={**headers(pid),'X-PHB-AI':'1'}
            with patch.object(b.chatgpt,'status',return_value={'sharing':True,'credits_acknowledged':True}), patch.object(b.chatgpt,'run',return_value=json.dumps(dict(eligible=True,program_key='bafa_envelope',amount_min=100,amount_max=200,explanation='PostgreSQL Testbericht',sources=[{'title':'BAFA','url':BAFA_URL}]))):
                plan=client.post('/api/funding/plans',headers=plan_headers,json=dict(name='Fenster-Förderplan',plan_only=True,inputs=dict(program_key='bafa_envelope',measure='Fenster erneuern mit technischer Prüfung',postcode='80331',units=1,ownership='private_owner',usage='self',building_application='1990-01-01',application_date='2027-05-01',contract='not_signed',started='no',vat_deductible='no',used_budget=0,cumulation_reviewed='yes',isfp='no'),selections=[dict(offer_id=offers[1],position_ids=[],eligible_cost=1000)]) )
                assert plan.status_code==201,plan.json;plan_id=plan.json['id']
                checked=client.post(f'/api/funding/plans/{plan_id}/check',headers=plan_headers,json=dict(phase='estimate',consent=True,plan_only=True))
                assert checked.status_code==200,checked.json
                adopted=client.post(f'/api/funding/plans/{plan_id}/adopt',headers=plan_headers,json=dict(token=checked.json['report']['token'],amount=150,confirm=True,plan_only=True))
                assert adopted.status_code==200,adopted.json
                assert adopted.json['funding']['expected']==150 and adopted.json['funding']['confirmed']==0
            print('PASS PostgreSQL 17: persisted funding plan, official-source report and explicit adoption')
            lifecycle=client.post('/api/projects',json={'title':'Leeres PG-Projekt'}).json['project']
            empty_id=lifecycle['id'];assert lifecycle['can_delete']
            assert client.patch(f'/api/projects/{pid}',json={'archived':True}).json['project']['archived']
            assert client.delete(f'/api/projects/{pid}',json={'confirmed':True,'confirmation':'Garten PostgreSQL'}).status_code==409
            assert not client.patch(f'/api/projects/{pid}',json={'archived':False}).json['project']['archived']
            assert client.delete(f'/api/projects/{empty_id}',json={'confirmed':True,'confirmation':'Leeres PG-Projekt'}).status_code==200
            replacement=client.post('/api/projects',json={'title':'Neues PG-Projekt'}).json['project']
            assert replacement['id']>empty_id
            assert client.get('/api/project',headers=headers(pid)).json['tasks'][0]['id']==tasks[1]
            print('PASS PostgreSQL 17: archive/reopen, nonempty deletion blocked, empty deletion and monotonic project IDs')
            import project_backups
            store=Path(temp)/'backups';store.mkdir()
            cfg={'folder':store,'keep':3}
            before_first=client.get('/api/project').json
            with project_context(pid):
                archive=project_backups.create(b.db,b.ROOT,pid,cfg)
                current=b.db.session.get(b.Task,tasks[1]);current.name='Nach Sicherung geändert';b.db.session.commit()
                project_backups.restore(archive,b.db,b.ROOT,pid)
                assert b.db.session.get(b.Task,tasks[1]).name=='Paket '+str(pid)
                assert b.db.session.get(b.Funding,plan_id).expected==150
                assert b.db.session.get(b.FundingPlan,plan_id).adopted_amount==150
                # Explicit restored IDs must not move any PostgreSQL sequence backwards.
                new=b.Task(code='AP-002',name='Neu nach Restore',trade='Sonstiges',duration=1,phase='',company='',notes='',status='Offen',progress=0,lag_days=0,position=9)
                b.db.session.add(new);b.db.session.commit();assert new.id>max(tasks)
            assert client.get('/api/project').json==before_first
            assert (b.RECEIPT_ROOT/'pg-1.pdf').read_bytes()==b'%PDF-test-1'
            print('PASS PostgreSQL 17: project-only backup/restore, other project unchanged, stable IDs and sequences')
            print('PASS PostgreSQL '+version+': fresh startup, project sequence, scoped identifiers, totals, links and files')
            from concurrent.futures import ThreadPoolExecutor
            from threading import Barrier
            equity=b.EquityAccount(name='Paralleltest',opening_balance=100,reserve=0)
            b.db.session.add(equity);parallel=[]
            for index in range(2):
                receipt=b.Receipt(digest='parallel-'+str(index),original_name='r.pdf',stored_name='parallel-'+str(index)+'.pdf',supplier='Paralleltest',document_date='2026-11-02',status='Gebucht',gross_amount=100,paid_amount=0,assignment_type='Eigenleistung')
                b.db.session.add(receipt);parallel.append(receipt)
            b.db.session.commit();equity_id=equity.id;parallel_ids=[row.id for row in parallel]
            barrier=Barrier(2)
            def pay(ident):
                with b.app.test_client() as browser:
                    barrier.wait()
                    result=browser.post('/api/financing/payments',json=dict(receipt_id=ident,source='equity',equity_id=equity_id,amount=100,payment_date='2026-11-02'))
                    return result.status_code,result.json
            with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(pay,parallel_ids))
            assert sorted(status for status,_ in results)==[201,400],results
            b.db.session.expire_all()
            assert sum(b.db.session.get(b.Receipt,ident).paid_amount for ident in parallel_ids)==100
            print('PASS PostgreSQL 17: independent requests cannot consume the same account funds twice')
            target=next(ident for ident in parallel_ids if b.db.session.get(b.Receipt,ident).paid_amount==0)
            payment=dict(receipt_id=target,source='unassigned',amount=10,payment_date='2026-11-02')
            key={'Idempotency-Key':'postgres-repeat-operation-000001'}
            first=client.post('/api/financing/payments',json=payment,headers=key)
            repeated=client.post('/api/financing/payments',json=payment,headers=key)
            assert first.status_code==201 and repeated.json['id']==first.json['id'],(first.json,repeated.json)
            path='/api/receipts/'+str(target);etag=client.get(path).json['_versions'][path]
            assert client.patch(path,json={'notes':'Aktuell'},headers={'If-Match':etag}).status_code==200
            assert client.patch(path,json={'notes':'Veraltet'},headers={'If-Match':etag}).status_code==409
            print('PASS PostgreSQL 17: idempotent payment receipts and stale-write conflict protection')


        legacy_name='phb_legacy_'+uuid4().hex[:12]
        with psycopg.connect(host=url.host,port=url.port or 5432,user=url.username,password=url.password,dbname='postgres',autocommit=True) as admin:
            admin.execute(psycopg.sql.SQL('CREATE DATABASE {}').format(psycopg.sql.Identifier(legacy_name)))
        legacy_engine=sa.create_engine(url.set(database=legacy_name))
        from money_values import MONEY_COLUMNS,migrate_money
        old=sa.MetaData();tables={}
        for name,table in b.db.metadata.tables.items():
            if name in ('project','planning_browser_state'):continue
            tables[name]=sa.Table(name,old,*[column._copy() for column in table.columns if column.name!='project_id'])
            for field in MONEY_COLUMNS.get(name,()):tables[name].c[field].type=sa.Float()
            if name in SCOPED_UNIQUE:tables[name].append_constraint(sa.UniqueConstraint(SCOPED_UNIQUE[name],name='uq_legacy_'+name))
        with legacy_engine.begin() as connection:
            old.create_all(connection)
            connection.execute(tables['setting'].insert().values(key='start',value='2020-04-01'))
            connection.execute(tables['category'].insert().values(id=77,name='Historisch'))
            connection.execute(tables['task'].insert().values(id=88,code='AP-001',name='Altes Paket'))
            connection.execute(tables['cost_item'].insert().values(id=99,title='Alter Geldwert',estimate=1234.56789012))
            for name in ('category','task'):
                connection.execute(sa.text("SELECT setval(pg_get_serial_sequence(:table_name,'id'),(SELECT MAX(id) FROM "+name+"),true)"),{'table_name':name})
            upgrade_project_schema(connection)
            migrate_money(connection)
            assert isinstance(next(c['type'] for c in sa.inspect(connection).get_columns('cost_item') if c['name']=='estimate'),sa.Numeric)
            assert connection.scalar(sa.text('SELECT estimate FROM cost_item WHERE id=99'))==Decimal('1234.567890120000')
            assert connection.execute(sa.text('SELECT id,code,project_id FROM task')).all()==[(88,'AP-001',1)]
            assert connection.execute(sa.text('SELECT project_id,key,value FROM setting')).all()==[(1,'start','2020-04-01')]
            inserted=connection.execute(b.Project.__table__.insert().values(title='Neuer Garten',kind='Garten',description='')).inserted_primary_key[0]
            assert inserted==2,inserted
            connection.execute(b.Task.__table__.insert().values(project_id=2,code='AP-001',name='Neues Paket'))
            connection.execute(b.Setting.__table__.insert().values(project_id=2,key='start',value='2027-05-01'))
            assert connection.execute(sa.text('SELECT project_id FROM task ORDER BY id')).all()==[(1,),(2,)]
            assert connection.execute(sa.text("SELECT value FROM setting WHERE key='start' ORDER BY project_id")).all()==[('2020-04-01',),('2027-05-01',)]
        legacy_engine.dispose()
        print('PASS PostgreSQL 17: legacy schema and Float-to-Numeric migration preserve IDs, values and settings')


if __name__=='__main__':main()
