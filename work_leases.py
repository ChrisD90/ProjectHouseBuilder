"""Cross-process leases for costly AI work; no automatic resubmission after expiry."""
from datetime import datetime,timedelta
from uuid import uuid4
from threading import Event,Thread
from sqlalchemy import Table,Column,Integer,String,DateTime,select,delete
from request_safety import metadata

leases=Table('phb_work_lease',metadata,Column('key',String(200),primary_key=True),Column('project_id',Integer,nullable=False),Column('token',String(40),nullable=False),Column('expires_at',DateTime,nullable=False))

def claim(engine,key,owner):
    now=datetime.utcnow();token=uuid4().hex
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    insert=pg_insert if engine.dialect.name=='postgresql' else sqlite_insert
    with engine.begin() as connection:
        statement=insert(leases).values(key=key,project_id=owner,token=token,expires_at=now+timedelta(minutes=5))
        result=connection.execute(statement.on_conflict_do_update(index_elements=[leases.c.key],set_={'token':token,'expires_at':now+timedelta(minutes=5)},where=leases.c.expires_at<=now).returning(leases.c.token))
        return result.scalar_one_or_none()

def owns(connection,key,token):
    return connection.execute(select(leases.c.key).where(leases.c.key==key,leases.c.token==token,leases.c.expires_at>datetime.utcnow())).first() is not None

class Lease:
    def __init__(self,engine,key,token):
        self.engine=engine;self.key=key;self.token=token;self.stop=Event()
        def heartbeat():
            while not self.stop.wait(30):
                try:
                    with engine.begin() as connection:connection.execute(leases.update().where(leases.c.key==key,leases.c.token==token).values(expires_at=datetime.utcnow()+timedelta(minutes=5)))
                except Exception:pass # Expiry prevents this worker from committing if ownership is lost.
        Thread(target=heartbeat,daemon=True,name='phb-ai-lease').start()
    def close(self):
        self.stop.set()
        with self.engine.begin() as connection:connection.execute(delete(leases).where(leases.c.key==self.key,leases.c.token==self.token))
