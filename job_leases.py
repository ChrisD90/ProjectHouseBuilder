"""Atomic import claims and expiring worker leases; running AI jobs are never retried silently."""
from datetime import datetime,timedelta
from uuid import uuid4
from sqlalchemy import inspect,text,update
from threading import Event,Thread
from multi_projects import project_context

def ensure_schema(connection):
    inspector=inspect(connection)
    if not inspector.has_table('import_job'):return
    names={c['name'] for c in inspector.get_columns('import_job')}
    if 'lease_owner' not in names:connection.execute(text("ALTER TABLE import_job ADD COLUMN lease_owner VARCHAR(80) NOT NULL DEFAULT ''"))
    if 'lease_until' not in names:connection.execute(text('ALTER TABLE import_job ADD COLUMN lease_until TIMESTAMP'))

def claim(db,Job,ident):
    token=uuid4().hex;now=datetime.utcnow()
    result=db.session.execute(update(Job).where(Job.id==ident,Job.status=='Wartend').values(
        status='Läuft',lease_owner=token,lease_until=now+timedelta(minutes=5),updated_at=now).returning(Job.id))
    claimed=result.scalar_one_or_none() is not None
    db.session.commit()
    return token if claimed else None

class Heartbeat:
    def __init__(self,app,db,Job,ident,owner,token):
        self.stop=Event()
        def run():
            while not self.stop.wait(30):
                try:
                    with app.app_context(),project_context(owner):
                        db.session.execute(update(Job).where(Job.id==ident,Job.status=='Läuft',Job.lease_owner==token).values(lease_until=datetime.utcnow()+timedelta(minutes=5)))
                        db.session.commit()
                except Exception:app.logger.exception('Import lease heartbeat failed')
        self.thread=Thread(target=run,daemon=True,name='phb-import-heartbeat');self.thread.start()
    def close(self):self.stop.set()


def install_fence(db,Project,Job):
    """A worker that lost ownership cannot commit domain changes or overwrite a retry."""
    from sqlalchemy import event,select
    from multi_projects import ProjectSession
    from project_lifecycle import sqlite_write_lock
    @event.listens_for(ProjectSession,'before_commit')
    def check(session):
        lease=session.info.get('phb_import_lease')
        if not lease:return
        ident,owner,token=lease;connection=session.connection()
        sqlite_write_lock(connection)
        connection.execute(select(Project.__table__.c.id).where(Project.__table__.c.id==owner).with_for_update()).first()
        row=connection.execute(select(Job.__table__.c.status,Job.__table__.c.lease_owner).where(Job.__table__.c.id==ident,Job.__table__.c.project_id==owner)).first()
        if not row or row.status!='Läuft' or row.lease_owner!=token:
            raise ValueError('Der Importauftrag gehört inzwischen einem anderen Lauf. Keine weiteren Änderungen gespeichert.')
