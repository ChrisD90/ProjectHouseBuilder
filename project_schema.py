"""Add project ownership and scoped business identifiers without changing legacy IDs."""
from alembic.migration import MigrationContext
from alembic.operations import Operations
import sqlalchemy as sa

SCOPED_UNIQUE = {'category':'name','trade':'name','build_phase':'title','task':'code',
                 'budget_line':'code','offer':'digest','receipt':'digest','cost_plan_import':'digest'}

def upgrade_project_schema(connection):
    from app import db, Project
    Project.__table__.create(bind=connection,checkfirst=True)
    if connection.execute(sa.select(Project.__table__.c.id).where(Project.__table__.c.id==1)).first() is None:
        from datetime import datetime
        connection.execute(Project.__table__.insert().values(id=1,title='Mein bestehendes Projekt',kind='Sanierung',description='Bisherige Projektdaten',created_at=datetime.utcnow()))
    if connection.dialect.name=='postgresql':
        connection.execute(sa.text("SELECT setval(pg_get_serial_sequence('project','id'), COALESCE((SELECT MAX(id) FROM project),1), true)"))
    db.metadata.create_all(bind=connection,checkfirst=True)
    operations=Operations(MigrationContext.configure(connection))
    names=set(sa.inspect(connection).get_table_names())
    for table in db.metadata.tables.values():
        if table.name=='project' or table.name not in names:continue
        inspector=sa.inspect(connection)
        old_columns={c['name'] for c in inspector.get_columns(table.name)}
        uniques=inspector.get_unique_constraints(table.name)
        legacy_unique=[u for u in uniques if u['column_names']==[SCOPED_UNIQUE.get(table.name)]]
        pk=inspector.get_pk_constraint(table.name)
        setting_pk=table.name=='setting' and 'project_id' not in pk['constrained_columns']
        if 'project_id' in old_columns and not legacy_unique and not setting_pk:continue
        convention={'pk':'pk_%(table_name)s','uq':'uq_%(table_name)s_%(column_0_name)s','fk':'fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s'}
        with operations.batch_alter_table(table.name,naming_convention=convention,table_kwargs={'sqlite_autoincrement':True} if connection.dialect.name=='sqlite' and table.dialect_options['sqlite'].get('autoincrement') else {}) as batch:
            if 'project_id' not in old_columns:
                batch.add_column(sa.Column('project_id',sa.Integer(),nullable=False,server_default='1'))
                batch.create_foreign_key('fk_'+table.name+'_project_id_project','project',['project_id'],['id'])
                batch.create_index('ix_'+table.name+'_project_id',['project_id'])
            for unique in legacy_unique:
                field=SCOPED_UNIQUE[table.name]
                batch.drop_constraint(unique['name'] or 'uq_'+table.name+'_'+field,type_='unique')
                batch.create_unique_constraint('uq_'+table.name+'_project_'+field,['project_id',field])
            if setting_pk:
                batch.drop_constraint(pk['name'] or 'pk_setting',type_='primary')
                batch.create_primary_key('pk_setting',['project_id','key'])
