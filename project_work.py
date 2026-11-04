"""Project-wide todos and notes with validated, optional source links."""
from datetime import date, datetime, timezone
from flask import jsonify, request
from sqlalchemy import inspect, select, text
from project_documents import plain


def ensure_work_archive_schema(connection):
    """Additive upgrade shared by Alembic and direct application startup."""
    inspector = inspect(connection)
    if inspector.has_table('project_work') and 'archived_at' not in {c['name'] for c in inspector.get_columns('project_work')}:
        connection.execute(text('ALTER TABLE project_work ADD COLUMN archived_at TIMESTAMP'))


def register_project_work(app, db, sources):
    class ProjectWork(db.Model):
        __tablename__ = 'project_work'
        id = db.Column(db.Integer, primary_key=True)
        kind = db.Column(db.String(8), nullable=False, default='todo')
        title = db.Column(db.String(200), nullable=False)
        body = db.Column(db.Text, nullable=False, default='')
        due_on = db.Column(db.String(10), nullable=False, default='')
        completed_at = db.Column(db.DateTime, nullable=True)
        archived_at = db.Column(db.DateTime, nullable=True)
        source_type = db.Column(db.String(20), nullable=False, default='')
        source_id = db.Column(db.Integer, nullable=True)
        source_label = db.Column(db.String(300), nullable=False, default='')
        created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    def source_info(kind, ident):
        spec = sources.get(kind)
        item = db.session.get(spec[0], ident) if spec and ident else None
        if item is None:
            return None
        return dict(type=kind, id=item.id, label=str(spec[1](item))[:300], url=spec[2](item))

    def serialize(item):
        source = source_info(item.source_type, item.source_id)
        return dict(id=item.id, kind=item.kind, title=item.title, body=item.body,
                    due_on=item.due_on, done=bool(item.completed_at),
                    archived=bool(item.archived_at),
                    archived_at=item.archived_at.isoformat() if item.archived_at else '',
                    completed_at=item.completed_at.isoformat() if item.completed_at else '',
                    source_type=item.source_type, source_id=item.source_id,
                    source_label=source['label'] if source else item.source_label,
                    source_url=source['url'] if source else '', source_missing=bool(item.source_type and not source))

    @app.get('/api/project-work')
    def project_work_list():
        query = select(ProjectWork).order_by(ProjectWork.id.desc())
        kind = request.args.get('source_type')
        if kind:
            if kind not in sources or not request.args.get('source_id', '').isdigit():
                return jsonify(error='Ungültige Quelle.'), 400
            query = query.where(ProjectWork.source_type == kind, ProjectWork.source_id == int(request.args['source_id']))
        result = jsonify(items=[serialize(x) for x in db.session.scalars(query)])
        result.headers['Cache-Control'] = 'no-store'
        return result

    @app.get('/api/project-work/sources')
    def project_work_sources():
        rows = []
        for kind, spec in sources.items():
            for item in db.session.scalars(select(spec[0]).order_by(spec[0].id.desc())):
                rows.append(source_info(kind, item.id))
        return jsonify(sources=rows)

    @app.post('/api/project-work')
    @app.route('/api/project-work/<int:work_id>', methods=['PATCH', 'DELETE'])
    def project_work_save(work_id=None):
        item = db.session.get(ProjectWork, work_id) if work_id else ProjectWork(kind='todo', title='', body='', due_on='', source_type='')
        if item is None:
            return jsonify(error='Eintrag nicht gefunden.'), 404
        if request.method == 'DELETE':
            db.session.delete(item); db.session.commit()
            return jsonify(ok=True)
        data = request.get_json(silent=True)
        try:
            if not isinstance(data, dict) or set(data) - {'kind', 'title', 'body', 'due_on', 'done', 'archived', 'source_type', 'source_id'}:
                raise ValueError('Ungültige Eigenschaften.')
            for key, limit in [('title', 200), ('body', 10000), ('kind', 8), ('due_on', 10)]:
                if key in data:
                    setattr(item, key, plain(data[key], key, limit, required=key in ('title', 'kind')))
            if not item.title or item.kind not in ('todo', 'note'):
                raise ValueError('Titel und gültige Eintragsart sind erforderlich.')
            if item.due_on:
                if date.fromisoformat(item.due_on).isoformat() != item.due_on:
                    raise ValueError('Ungültiges Fälligkeitsdatum.')
            if 'archived' in data:
                if type(data['archived']) is not bool:
                    raise ValueError('Archiviert muss ein Wahrheitswert sein.')
                item.archived_at = (item.archived_at or datetime.now(timezone.utc)) if data['archived'] else None
            if 'done' in data:
                if type(data['done']) is not bool:
                    raise ValueError('Erledigt muss ein Wahrheitswert sein.')
                item.completed_at = (item.completed_at or datetime.now(timezone.utc)) if data['done'] else None
            if item.kind == 'note':
                item.completed_at = None; item.due_on = ''
            if 'source_type' in data or 'source_id' in data:
                kind = data.get('source_type', item.source_type)
                ident = data.get('source_id', item.source_id)
                if not kind and ident in (None, ''):
                    item.source_type = ''; item.source_id = None; item.source_label = ''
                else:
                    if kind not in sources or type(ident) is not int or ident <= 0:
                        raise ValueError('Ungültige Quelle.')
                    source = source_info(kind, ident)
                    same = kind == item.source_type and ident == item.source_id
                    if not source and not same:
                        raise ValueError('Verknüpfte Quelle ist nicht mehr vorhanden.')
                    item.source_type = kind; item.source_id = ident
                    if source: item.source_label = source['label']
            db.session.add(item); db.session.commit()
            return jsonify(item=serialize(item)), 201 if work_id is None else 200
        except (ValueError, TypeError, OverflowError) as exc:
            db.session.rollback()
            return jsonify(error=str(exc)), 400

    return ProjectWork, serialize
