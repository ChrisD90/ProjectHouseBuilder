"""Archive projects and delete only an unchanged empty project shell."""
from datetime import date
from decimal import Decimal, InvalidOperation
from sqlalchemy import inspect, select, func, text


def ensure_project_lifecycle_schema(connection):
    inspector=inspect(connection)
    if inspector.has_table('project') and 'archived_at' not in {c['name'] for c in inspector.get_columns('project')}:
        connection.execute(text('ALTER TABLE project ADD COLUMN archived_at TIMESTAMP'))


def sqlite_write_lock(connection):
    # Serialize the existence/emptiness check with writes; no FK PRAGMA change on legacy DBs.
    if connection.dialect.name=='sqlite' and not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql('BEGIN IMMEDIATE')


def content_status(db, owner, categories, trades):
    connection=db.session.connection();details=[]
    labels={'task':'Arbeitspakete','build_phase':'Bauphasen','contractor':'Firmen','category':'eigene Kategorien',
        'trade':'eigene Gewerke','setting':'Projekteinstellungen','project_work':'To-dos oder Notizen',
        'offer':'Angebote','receipt':'Rechnungen oder Belege','import_job':'Importdaten','schedule_history':'Planungshistorien',
        'project_document':'Dokumente','document':'Angebotsdokumente','funding':'Förderungen',
        'funding_plan':'Förderplanungen','planning_browser_state':'KI-Planungsentwürfe'}
    for table in db.metadata.tables.values():
        if 'project_id' not in table.c:continue
        query=select(table).where(table.c.project_id==owner)
        if table.name=='category' and not set(table.c.keys())-{'id','project_id','name','sort_order'}:
            defaults={name:index for index,name in enumerate(categories)}
            rows=list(connection.execute(query).mappings())
            # Before category ordering was introduced all built-in categories had sort_order=0.
            legacy_defaults=bool(rows) and all(r['name'] in defaults and r['sort_order']==0 for r in rows)
            count=0 if legacy_defaults else sum(r['name'] not in defaults or r['sort_order']!=defaults.get(r['name']) for r in rows)
        elif table.name=='trade' and not set(table.c.keys())-{'id','project_id','name'}:
            count=sum(r['name'] not in trades for r in connection.execute(query).mappings())
        elif table.name=='setting' and not set(table.c.keys())-{'project_id','key','value'}:
            def baseline(row):
                key=row['key'];value=row['value']
                if key in ('project_initialized','trades_initialized','build_phases_initialized'):return value=='1'
                if key=='start':
                    try:return date.fromisoformat(value).isoformat()==value
                    except (ValueError,TypeError):return False
                if key=='initial_budget':
                    try:return Decimal(value)==0
                    except (InvalidOperation,TypeError):return False
                return False
            count=sum(not baseline(r) for r in connection.execute(query).mappings())
        elif table.name=='planning_browser_state':
            count=sum(r['value'] not in ('null',None) for r in connection.execute(query).mappings())
        else:count=connection.scalar(select(func.count()).select_from(table).where(table.c.project_id==owner)) or 0
        if count:details.append(dict(table=table.name,label=labels.get(table.name,table.name.replace('_',' ')),count=count))
    names=list(dict.fromkeys(row['label'] for row in details))
    return dict(can_delete=not details,data_count=sum(row['count'] for row in details),
        delete_reason='Enthält noch '+', '.join(names[:3])+('.' if len(names)<=3 else ' und weitere Daten.') if names else '',
        data_sections=details)
