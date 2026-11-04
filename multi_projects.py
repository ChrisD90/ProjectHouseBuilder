"""Project ownership is enforced at the session boundary, including identity-map reads."""
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date, datetime, timezone
from flask import g, has_request_context, jsonify, request, session
from flask_sqlalchemy.model import Model
from flask_sqlalchemy.session import Session
from sqlalchemy import Column, ForeignKey, Integer, event, inspect, select
from sqlalchemy.orm import declared_attr, with_loader_criteria

_project_id = ContextVar('phb_project_id', default=1)
_unscoped = ContextVar('phb_project_unscoped', default=False)


def current_project_id():
    return _project_id.get()


@contextmanager
def project_context(project_id):
    token = _project_id.set(int(project_id)); bypass = _unscoped.set(False)
    try: yield
    finally: _unscoped.reset(bypass); _project_id.reset(token)


@contextmanager
def all_projects():
    token = _unscoped.set(True)
    try: yield
    finally: _unscoped.reset(token)


class ProjectModel(Model):
    __abstract__ = True

    @declared_attr
    def project_id(cls):
        if cls.__dict__.get('__global__', False): return None
        return Column(Integer, ForeignKey('project.id'), nullable=False, default=current_project_id,
                      server_default='1', index=True)


class ProjectSession(Session):
    def get(self, entity, ident, **kwargs):
        mapper = inspect(entity)
        if mapper.local_table.name == 'setting' and isinstance(ident, str):
            ident = {'key': ident, 'project_id': current_project_id()}
        if getattr(mapper.class_, 'project_id', None) is not None and not _unscoped.get():
            keys=list(mapper.primary_key)
            values=tuple(ident.get(column.key) for column in keys) if isinstance(ident,dict) else tuple(ident) if isinstance(ident,(tuple,list)) else (ident,)
            cached=self.identity_map.get(mapper.identity_key_from_primary_key(values))
            if cached is not None and 'project_id' not in cached.__dict__:
                statement=select(entity).where(*[column==value for column,value in zip(keys,values)],mapper.class_.project_id==current_project_id())
                return self.scalar(statement)
        item = super().get(entity, ident, **kwargs)
        if item is not None and not _unscoped.get():
            owner = getattr(item, 'project_id', None)
            if owner is not None and owner != current_project_id(): return None
        return item


def install_project_scope(app, db, Project):
    # Source links must not silently attach to a newly reused SQLite row ID.
    for mapper in db.Model.registry.mappers:
        primary=list(mapper.primary_key)
        if len(primary)==1 and isinstance(primary[0].type,Integer) and not primary[0].foreign_keys:
            mapper.local_table.dialect_options['sqlite']['autoincrement']=True
    models = [m.class_ for m in db.Model.registry.mappers if getattr(m.class_, 'project_id', None) is not None]
    tables = {m.__table__.name: m for m in models}

    @event.listens_for(ProjectSession, 'do_orm_execute')
    def filter_project(state):
        if _unscoped.get() or state.execution_options.get('project_scope') is False: return
        project_id = current_project_id()
        if state.is_select:
            candidates={mapper.class_ for mapper in state.all_mappers} or set(models)
            if not state.is_orm_statement:
                for source in state.statement.get_final_froms():
                    if getattr(source,'name',None) in tables and 'project_id' in source.c:
                        state.statement=state.statement.where(source.c.project_id==project_id)
            state.statement = state.statement.options(*[
                with_loader_criteria(model, lambda row: row.project_id == project_id, include_aliases=True)
                for model in candidates if model in models])
        elif state.is_update or state.is_delete:
            table = getattr(state.statement, 'table', None)
            if table is not None and 'project_id' in table.c:
                for key,value in (getattr(state.statement,'_values',None) or {}).items():
                    if getattr(key,'key',key)=='project_id' and getattr(value,'value',None)!=project_id:
                        raise ValueError('Die Projektzuordnung bestehender Daten darf nicht geändert werden.')
                state.statement = state.statement.where(table.c.project_id == project_id)

    @event.listens_for(ProjectSession, 'before_flush')
    def validate_project(session, flush_context, instances):
        if _unscoped.get(): return
        project_id = current_project_id()
        pending = list(session.new)
        owned=[item for item in list(session.new)+list(session.dirty)+list(session.deleted) if type(item) in models]
        if owned:
            from project_lifecycle import sqlite_write_lock
            sqlite_write_lock(session.connection())
        if owned and not any(isinstance(x,Project) and x.id==project_id for x in pending) and session.scalar(select(Project.id).where(Project.id==project_id)) is None:
            raise ValueError('Projekt nicht gefunden. Keine Daten gespeichert.')
        for item in list(session.new) + list(session.dirty) + list(session.deleted):
            model = type(item)
            if model not in models: continue
            if item.project_id is None and item in session.new: item.project_id = project_id
            if item not in session.new and inspect(item).attrs.project_id.history.has_changes():
                raise ValueError('Die Projektzuordnung bestehender Daten darf nicht geändert werden.')
            if item.project_id != project_id:
                raise ValueError('Dieser Datensatz gehört zu einem anderen Projekt.')
            for foreign in model.__table__.foreign_keys:
                if foreign.parent.name == 'project_id': continue
                value = getattr(item, foreign.parent.name, None)
                target = tables.get(foreign.column.table.name)
                if value is None or target is None: continue
                primary = list(target.__mapper__.primary_key)
                if len(primary) != 1: continue
                if not session.get(target, value) and not any(
                        isinstance(x, target) and getattr(x, primary[0].name, None) == value
                        and (x.project_id is None or x.project_id == project_id) for x in pending):
                    raise ValueError('Verknüpfte Daten sind nicht in diesem Projekt vorhanden.')

    @app.before_request
    def select_request_project():
        if request.path.startswith('/static/') or request.path in ('/sw.js','/manifest.webmanifest'): return
        if request.path.startswith('/api/projects') and not session.get('phb_planning_browser'):
            import secrets
            session['phb_planning_browser']=secrets.token_urlsafe(24)
        raw = request.headers.get('X-PHB-Project')
        if raw is None:raw=request.args.get('project_id')
        if raw is None:raw='1'
        if not isinstance(raw, str) or not raw.isdigit() or not 0 < int(raw) <= 2147483647:
            return jsonify(error='Ungültige Projekt-ID.'), 400
        ident = int(raw)
        g.phb_project_token = _project_id.set(ident)
        # Legacy tests/bootstrap can initialize their schema separately; requests never invent projects.
        global_api=request.path in ('/api/ai/status','/api/ai/connect','/api/ai/disconnect','/api/ai/models','/api/ai/diagnostics','/api/ai/acknowledge-credits') or request.path.startswith(('/api/ocr','/api/projects'))
        if request.path.startswith('/api/') and not global_api and db.session.get(Project, ident) is None:
            return jsonify(error='Projekt nicht gefunden.'), 404

    @app.after_request
    def scope_response(response):
        if request.path.startswith('/api/'):
            response.headers['Cache-Control']='no-store'
            response.vary.add('X-PHB-Project')
            if current_project_id()!=1 and response.is_json:
                from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
                def visit(value,key=''):
                    if isinstance(value,dict):return {k:visit(v,k) for k,v in value.items()}
                    if isinstance(value,list):return [visit(v,key) for v in value]
                    if key in ('download_url','view_url','preview_url','url','href','review_url') and isinstance(value,str) and value.startswith('/api/'):
                        parts=urlsplit(value); args=dict(parse_qsl(parts.query));args['project_id']=str(current_project_id())
                        return urlunsplit(('', '', parts.path, urlencode(args), parts.fragment))
                    return value
                response.set_data(app.json.dumps(visit(response.get_json())))
        return response

    @app.teardown_request
    def restore_request_project(error):
        token = getattr(g, 'phb_project_token', None)
        if token is not None:
            _project_id.reset(token); del g.phb_project_token

    @app.errorhandler(ValueError)
    def project_validation_error(error):
        db.session.rollback()
        return jsonify(error=str(error)), 400


def register_project_routes(app, db, Project, *, initialize, summary, Task, CostItem, ProjectWork, categories, trades, operation_busy):
    from project_lifecycle import content_status, sqlite_write_lock
    def describe(project):
        return dict(id=project.id,title=project.title,kind=project.kind,description=project.description,
                    created_at=project.created_at.isoformat() if project.created_at else '',
                    archived=bool(project.archived_at),archived_at=project.archived_at.isoformat() if project.archived_at else '',
                    **content_status(db,project.id,categories,trades))

    @app.get('/api/projects')
    def project_list():
        output = []
        for project in db.session.scalars(select(Project).order_by(Project.id)):
            row = describe(project)
            with project_context(project.id):
                tasks = db.session.scalars(select(Task)).all()
                totals = summary(db.session.scalars(select(CostItem)).all())
                row.update(tasks=len(tasks),completed=sum(t.status=='Erledigt' for t in tasks),
                    forecast=totals['planned'],open_todos=db.session.query(ProjectWork).filter(
                        ProjectWork.kind=='todo',ProjectWork.completed_at.is_(None),ProjectWork.archived_at.is_(None)).count())
            output.append(row)
        return jsonify(projects=output)

    @app.get('/api/projects/<int:project_id>')
    def project_info(project_id):
        project = db.session.get(Project, project_id)
        if project is None: return jsonify(error='Projekt nicht gefunden.'),404
        return jsonify(project=describe(project))

    @app.post('/api/projects')
    @app.patch('/api/projects/<int:project_id>')
    def project_save(project_id=None):
        body=request.get_json(silent=True)
        try:
            if not isinstance(body,dict): raise ValueError('Projektdaten fehlen.')
            fields={}
            for key,limit in [('title',160),('kind',80),('description',2000)]:
                if key in body:
                    value=body[key]
                    if not isinstance(value,str) or len(value)>limit: raise ValueError('Ungültiges Projektfeld: '+key)
                    fields[key]=value.strip()
            if project_id:
                sqlite_write_lock(db.session.connection())
                project=db.session.scalar(select(Project).where(Project.id==project_id).with_for_update())
            else:project=Project(title='',kind='Sonstiges',description='')
            if project is None: return jsonify(error='Projekt nicht gefunden.'),404
            for key,value in fields.items():setattr(project,key,value)
            if 'archived' in body:
                if type(body['archived']) is not bool:raise ValueError('Archiviert muss ein Wahrheitswert sein.')
                project.archived_at=(project.archived_at or datetime.now(timezone.utc)) if body['archived'] else None
            if not project.title:raise ValueError('Bitte einen Projekttitel eingeben.')
            start=body.get('start_date') or date.today().isoformat()
            if date.fromisoformat(start).isoformat()!=start: raise ValueError('Ungültiger Projektstart.')
            db.session.add(project);db.session.flush()
            if project_id is None:
                with project_context(project.id):
                    initialize(start)
                    db.session.flush()
            db.session.commit()
            return jsonify(project=describe(project)),201 if project_id is None else 200
        except (ValueError,TypeError) as error:
            db.session.rollback();return jsonify(error=str(error)),400

    @app.delete('/api/projects/<int:project_id>')
    def project_delete(project_id):
        body=request.get_json(silent=True) or {}
        if operation_busy(project_id):return jsonify(error='Für dieses Projekt läuft ein Reset oder eine Wiederherstellung.'),409
        sqlite_write_lock(db.session.connection())
        project=db.session.scalar(select(Project).where(Project.id==project_id).with_for_update())
        if project is None:return jsonify(error='Projekt nicht gefunden.'),404
        if not isinstance(body,dict) or body.get('confirmed') is not True or body.get('confirmation')!=project.title:
            return jsonify(error='Den genauen Projekttitel zur endgültigen Löschung bestätigen.'),400
        status=content_status(db,project_id,categories,trades)
        if not status['can_delete']:return jsonify(error='Projekt nicht leer. '+status['delete_reason']+' Zuerst die Projektdaten zurücksetzen.'),409
        try:
            from project_backups import clear_rows
            with project_context(project_id):
                clear_rows(db.session.connection(),db,project_id)
                db.session.delete(project);db.session.commit()
            return jsonify(ok=True,project_id=project_id)
        except Exception:
            db.session.rollback();app.logger.exception('Leeres Projekt konnte nicht gelöscht werden.')
            return jsonify(error='Projekt konnte nicht gelöscht werden. Keine Änderungen übernommen.'),409


def project_files(db, root):
    """Physical originals stay at their legacy paths; ownership comes from scoped records."""
    from project_backups import files_for_project
    return files_for_project(db,root,current_project_id())


def project_snapshot(source, destination, project_id):
    """A project export must never contain other projects' rows in its SQLite snapshot."""
    import sqlite3
    with sqlite3.connect(str(source)) as old,sqlite3.connect(str(destination)) as snapshot:
        old.backup(snapshot)
        snapshot.execute('PRAGMA foreign_keys=OFF')
        tables=[name for name, in snapshot.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        for name in tables:
            quoted='"'+name.replace('"','""')+'"'
            columns={r[1] for r in snapshot.execute('PRAGMA table_info('+quoted+')')}
            if 'project_id' in columns:snapshot.execute('DELETE FROM '+quoted+' WHERE project_id != ?',(project_id,))
        if 'project' in tables:snapshot.execute('DELETE FROM project WHERE id != ?',(project_id,))


def register_planning_state(db):
    """Project-specific AI conversations must not race through a shared session cookie."""
    import json
    import secrets
    from flask import session
    class PlanningBrowserState(db.Model):
        __tablename__='planning_browser_state'
        __table_args__=(db.UniqueConstraint('project_id','browser_id','name',name='uq_planning_state_project_browser_name'),)
        id=db.Column(db.Integer,primary_key=True)
        browser_id=db.Column(db.String(80),nullable=False)
        name=db.Column(db.String(80),nullable=False)
        value=db.Column(db.Text,nullable=False,default='null')

    def cache():return request.environ.setdefault('phb.planning.values',{})
    def get(name,default=None):
        browser=session.get('phb_planning_browser')
        key=(current_project_id(),browser,name)
        if key not in cache():
            row=db.session.scalar(select(PlanningBrowserState).where(PlanningBrowserState.browser_id==browser,PlanningBrowserState.name==name)) if browser else None
            # Preserve a pre-upgrade conversation in the original project; cleared
            # values have explicit tombstones and can never revive an old cookie.
            value=json.loads(row.value) if row else session.get(name) if current_project_id()==1 else None
            cache()[key]=value
        value=cache()[key]
        return default if value is None else value
    def put(name,value):
        browser=session.get('phb_planning_browser')
        if not browser:
            browser=secrets.token_urlsafe(24);session['phb_planning_browser']=browser
        row=db.session.scalar(select(PlanningBrowserState).where(PlanningBrowserState.browser_id==browser,PlanningBrowserState.name==name))
        if row is None:row=PlanningBrowserState(browser_id=browser,name=name);db.session.add(row)
        row.value=json.dumps(value,ensure_ascii=False,allow_nan=False)
        db.session.commit();cache()[(current_project_id(),browser,name)]=value
    def pop(name,default=None):
        previous=get(name,default);put(name,None);return previous
    return PlanningBrowserState,get,put,pop
