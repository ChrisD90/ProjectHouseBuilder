"""HTTP errors, optimistic record fingerprints and durable operation receipts.

Technical receipts never enter project exports. A per-project DB lock serializes
mutations across threads/processes, including shared financing availability.
"""
import hashlib
import json
import re
from datetime import datetime,timezone
from flask import g,jsonify,request
from werkzeug.exceptions import HTTPException
from sqlalchemy import MetaData,Table,Column,Integer,String,Text,DateTime,select,delete
from multi_projects import current_project_id
from project_lifecycle import sqlite_write_lock

class EditConflict(ValueError):pass

metadata=MetaData()
operations=Table('phb_operation',metadata,
    Column('project_id',Integer,primary_key=True),Column('key',String(80),primary_key=True),
    Column('path',String(500),nullable=False),Column('method',String(10),nullable=False),
    Column('digest',String(64),nullable=False),Column('state',String(20),nullable=False),
    Column('response',Text,nullable=False,default=''),Column('status',Integer,nullable=False,default=0),
    Column('created_at',DateTime,nullable=False))

def ensure_schema(connection):
    import work_leases  # Register the technical lease table in the shared metadata.
    metadata.create_all(connection)

def invalidate_operations(connection,owner):
    from sqlalchemy import inspect
    if inspect(connection).has_table('phb_operation'):
        connection.execute(operations.update().where(operations.c.project_id==owner).values(state='unknown',response='',status=409))


def register(app,db,Project,models):
    specs={path:models[name] for path,name in {
        'projects':'Project','tasks':'Task','phases':'BuildPhase','contractors':'Contractor',
        'categories':'Category','trades':'Trade','receipts':'Receipt','offers':'Offer',
        'project-documents':'ProjectDocument','project-work':'ProjectWork','funding':'Funding',
        'costs':'CostItem','budget/lines':'BudgetLine','financing/loans':'Loan',
        'financing/equity':'EquityAccount','self-work':'SelfWorkPlan'}.items() if name in models}
    fields={'project':'projects','projects':'projects','tasks':'tasks','phases':'phases',
        'contractors':'contractors','categories':'categories','trades':'trades','receipts':'receipts',
        'offers':'offers','documents':'project-documents','funding':'funding','loans':'financing/loans',
        'equity_accounts':'financing/equity','accounts':'financing/equity','budget_lines':'budget/lines'}
    children={'offer':{'offer_position','offer_section','order_acceptance'},
              'receipt':{'finance_receipt_payment','receipt_cancellation','receipt_cancellation_reversal'},
              'funding':{'funding_plan','funding_plan_offer','funding_document','funding_assessment'}}
    for table in db.metadata.tables.values():
        for fk in table.foreign_keys:
            if fk.column.table.name in ('budget_line','cost_item'):
                children.setdefault(fk.column.table.name,set()).add(table.name)
    def resource(path):
        match=re.match(r'^/api/(.+?)/(\d+)(?:/|$)',path)
        if not match:return None
        family,ident=match.groups()
        if family=='funding/plans':family='funding'
        if family=='offer-costs':family='costs'
        return (family,int(ident)) if family in specs else None
    def fingerprint(family,ident):
        table=specs[family].__table__;connection=db.session.connection()
        query=select(table).where(table.c.id==ident)
        if 'project_id' in table.c:query=query.where(table.c.project_id==current_project_id())
        row=connection.execute(query).mappings().one_or_none()
        if row is None:return None
        record=dict(row)
        # Archive commands are idempotent and independent of project metadata edits.
        if family=='projects':record.pop('archived_at',None)
        values=[record]
        for name in sorted(children.get(table.name,set())):
            child=db.metadata.tables.get(name)
            if child is None:continue
            for fk in child.foreign_keys:
                if fk.column.table.name==table.name:
                    q=select(child).where(fk.parent==ident)
                    if 'project_id' in child.c:q=q.where(child.c.project_id==current_project_id())
                    values.extend(sorted((dict(r) for r in connection.execute(q).mappings()),key=lambda x:json.dumps(x,sort_keys=True,default=str)))
        return hashlib.sha256(json.dumps(values,sort_keys=True,default=str).encode()).hexdigest()
    def body_digest():
        if request.mimetype=='multipart/form-data':
            body=[sorted(request.form.lists())]
            for key in sorted(request.files):
                for upload in request.files.getlist(key):
                    h=hashlib.sha256()
                    while block:=upload.stream.read(1024*1024):h.update(block)
                    upload.stream.seek(0);body.append([key,upload.filename,h.hexdigest()])
        else:
            body=request.get_json(silent=True) if request.is_json else request.get_data().hex()
        return hashlib.sha256(json.dumps(body,sort_keys=True,default=str).encode()).hexdigest()

    @app.errorhandler(HTTPException)
    def http_error(error):
        if not request.path.startswith('/api/'):return error
        messages={413:'Die Dateien sind zu groß. Bitte Dateigröße und Anzahl reduzieren.',
                  404:'Eintrag oder Schnittstelle nicht gefunden.',405:'Diese Aktion ist hier nicht verfügbar.',
                  500:'Die Anfrage konnte nicht sicher abgeschlossen werden. Bitte zuerst den aktuellen Stand prüfen.'}
        return jsonify(error=messages.get(error.code,error.description),code='http_'+str(error.code)),error.code

    @app.before_request
    def guard_write():
        g.pop('phb_operation',None)
        g.phb_version_checked=False
        g.pop('phb_edit_conflict',None)
        if not request.path.startswith('/api/') or request.method in ('GET','HEAD','OPTIONS'):return
        if request.path.startswith(('/api/ai/','/api/ocr','/api/backup/')):return
        owner=current_project_id()
        expensive=(request.mimetype=='multipart/form-data' and not request.path.startswith('/api/financing/')) or '/ai/' in request.path or request.path.endswith(('/import','/check','/estimate','/research','/compare','/suggest'))
        if expensive:return
        sqlite_write_lock(db.session.connection())
        # The same lock is used for every financial writer, not only the invoice being paid.
        db.session.execute(select(Project.id).where(Project.id==owner).with_for_update()).first()
        # Replay identifies a completed command before checking its old record version.
        # Its successful first execution has, by definition, changed that version.
        key=request.headers.get('Idempotency-Key')
        financial=bool(key and request.path.startswith('/api/financing/'))
        if financial:
            if not re.fullmatch(r'[A-Za-z0-9_-]{16,80}',key):return jsonify(error='Ungültige Vorgangskennung.'),400
            digest=body_digest();connection=db.session.connection()
            previous=connection.execute(select(operations).where(operations.c.project_id==owner,operations.c.key==key)).mappings().one_or_none()
            if previous:
                if previous['digest']!=digest or previous['path']!=request.path or previous['method']!=request.method:
                    return jsonify(error='Diese Vorgangskennung gehört zu anderen Eingaben.',code='operation_mismatch'),409
                if previous['state']=='done':
                    response=jsonify(json.loads(previous['response']));response.status_code=previous['status']
                    response.headers['Idempotency-Replayed']='true';return response
                return jsonify(error='Der Vorgang wurde bereits gestartet. Bitte seinen Status prüfen, bevor du erneut buchst.',code='operation_pending',operation_key=key),409
        target=resource(request.path);expected=request.headers.get('If-Match')
        if expected and target:
            actual=fingerprint(*target)
            if actual!=expected.strip('"'):
                table=specs[target[0]].__table__
                query=select(table).where(table.c.id==target[1])
                if 'project_id' in table.c:query=query.where(table.c.project_id==owner)
                current=db.session.connection().execute(query).mappings().one_or_none()
                body=request.get_json(silent=True) or {}
                changes={key:{'current':value,'incoming':body[key]} for key,value in (current or {}).items() if key in body and str(value)!=str(body[key])}
                db.session.rollback()
                return jsonify(current={key:value for key,value in (current or {}).items() if key in body},changes=changes,error='Dieser Eintrag wurde inzwischen geändert. Deine Eingaben bleiben erhalten. Bitte den aktuellen Stand laden und die Änderungen vergleichen.',
                    code='edit_conflict',resource=request.path,expected=expected,actual=actual),409
        if expected and target:g.phb_version_checked=True
        if not financial:return
        connection.execute(operations.insert().values(project_id=owner,key=key,path=request.path,method=request.method,
            digest=digest,state='processing',response='',status=0,created_at=datetime.now(timezone.utc)))
        g.phb_operation=(owner,key)

    from sqlalchemy import event
    from multi_projects import ProjectSession
    from flask import has_request_context
    @event.listens_for(ProjectSession,'before_flush')
    def guarded_flush(session,context,instances):
        if not has_request_context() or not request.path.startswith('/api/'):return
        expected=request.headers.get('If-Match');target=resource(request.path)
        if not expected or not target or getattr(g,'phb_version_checked',False):return
        sqlite_write_lock(session.connection())
        session.connection().execute(select(Project.__table__.c.id).where(Project.__table__.c.id==current_project_id()).with_for_update()).first()
        if fingerprint(*target)!=expected.strip('"'):
            g.phb_edit_conflict=dict(error='Dieser Eintrag wurde inzwischen geändert. Deine Eingaben bleiben erhalten. Bitte den aktuellen Stand vergleichen.',code='edit_conflict',resource=request.path)
            raise EditConflict(g.phb_edit_conflict['error'])
        g.phb_version_checked=True

    @app.errorhandler(EditConflict)
    def changed_record(error):
        db.session.rollback()
        return jsonify(error=str(error),code='edit_conflict',resource=request.path),409

    @app.get('/api/operations/<key>')
    def operation_status(key):
        row=db.session.connection().execute(select(operations).where(operations.c.project_id==current_project_id(),operations.c.key==key)).mappings().one_or_none()
        if not row:return jsonify(state='not_found',message='Noch kein bestätigter Vorgang mit dieser Kennung gefunden. Bitte den fachlichen Stand prüfen.'),404
        return jsonify(state=row['state'],status=row['status'],path=row['path'],result=json.loads(row['response']) if row['response'] else None)

    @app.after_request
    def finish(response):
        conflict=g.pop('phb_edit_conflict',None)
        if conflict:
            db.session.rollback()
            response=jsonify(conflict);response.status_code=409
        operation=g.pop('phb_operation',None)
        if request.path.startswith('/api/') and response.is_json and response.status_code<300 and response.headers.get('Idempotency-Replayed')!='true':
            data=response.get_json();versions={};target=resource(request.path)
            def visit(value,family=None):
                if isinstance(value,list):
                    for entry in value:visit(entry,family)
                elif isinstance(value,dict):
                    ident=value.get('id')
                    if family in specs and type(ident) is int:
                        token=fingerprint(family,ident)
                        if token:versions['/api/'+family+'/'+str(ident)]=token
                    for key,entry in value.items():
                        next_family=fields.get(key)
                        if key in ('plan','plans') and request.path.startswith('/api/self-work'):next_family='self-work'
                        if key in ('items','entries') and request.path.startswith('/api/project-work'):next_family='project-work'
                        if key=='items' and request.path.startswith('/api/costs'):next_family='costs'
                        if key=='documents' and request.path.startswith('/api/offers'):next_family=None
                        visit(entry,next_family)
            if isinstance(data,dict):
                family=target[0] if target else request.path.removeprefix('/api/').rstrip('/')
                visit(data,family)
                if versions:
                    data['_versions']=versions;response.set_data(app.json.dumps(data))
        if operation:
            owner,key=operation;connection=db.session.connection()
            where=(operations.c.project_id==owner,operations.c.key==key)
            if response.is_json and 200<=response.status_code<300:
                connection.execute(operations.update().where(*where).values(state='done',status=response.status_code,response=json.dumps(response.get_json(),default=str)))
                db.session.commit()
            elif response.status_code<500:
                connection.execute(delete(operations).where(*where));db.session.commit()
            else:
                connection.execute(operations.update().where(*where).values(state='unknown',status=response.status_code));db.session.commit()
        return response
    return fingerprint
