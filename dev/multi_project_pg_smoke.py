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
        b.PROJECT_DOCUMENT_ROOT=Path(temp)/'documents'
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
            print('PASS PostgreSQL '+version+': fresh startup, project sequence, scoped identifiers, totals, links and files')

        legacy_name='phb_legacy_'+uuid4().hex[:12]
        with psycopg.connect(host=url.host,port=url.port or 5432,user=url.username,password=url.password,dbname='postgres',autocommit=True) as admin:
            admin.execute(psycopg.sql.SQL('CREATE DATABASE {}').format(psycopg.sql.Identifier(legacy_name)))
        legacy_engine=sa.create_engine(url.set(database=legacy_name))
        old=sa.MetaData();tables={}
        for name,table in b.db.metadata.tables.items():
            if name in ('project','planning_browser_state'):continue
            tables[name]=sa.Table(name,old,*[column._copy() for column in table.columns if column.name!='project_id'])
            if name in SCOPED_UNIQUE:tables[name].append_constraint(sa.UniqueConstraint(SCOPED_UNIQUE[name],name='uq_legacy_'+name))
        with legacy_engine.begin() as connection:
            old.create_all(connection)
            connection.execute(tables['setting'].insert().values(key='start',value='2020-04-01'))
            connection.execute(tables['category'].insert().values(id=77,name='Historisch'))
            connection.execute(tables['task'].insert().values(id=88,code='AP-001',name='Altes Paket'))
            for name in ('category','task'):
                connection.execute(sa.text("SELECT setval(pg_get_serial_sequence(:table_name,'id'),(SELECT MAX(id) FROM "+name+"),true)"),{'table_name':name})
            upgrade_project_schema(connection)
            assert connection.execute(sa.text('SELECT id,code,project_id FROM task')).all()==[(88,'AP-001',1)]
            assert connection.execute(sa.text('SELECT project_id,key,value FROM setting')).all()==[(1,'start','2020-04-01')]
            inserted=connection.execute(b.Project.__table__.insert().values(title='Neuer Garten',kind='Garten',description='')).inserted_primary_key[0]
            assert inserted==2,inserted
            connection.execute(b.Task.__table__.insert().values(project_id=2,code='AP-001',name='Neues Paket'))
            connection.execute(b.Setting.__table__.insert().values(project_id=2,key='start',value='2027-05-01'))
            assert connection.execute(sa.text('SELECT project_id FROM task ORDER BY id')).all()==[(1,),(2,)]
            assert connection.execute(sa.text("SELECT value FROM setting WHERE key='start' ORDER BY project_id")).all()==[('2020-04-01',),('2027-05-01',)]
        legacy_engine.dispose()
        print('PASS PostgreSQL 17: legacy schema migration preserves IDs/settings and scopes unique keys')


if __name__=='__main__':main()
