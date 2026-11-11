"""Project-owned people/company time sheets. Durations are stored as whole minutes."""
from datetime import date, datetime, timezone
from flask import jsonify, request
from sqlalchemy import select, func


def register_time_tracking(app, db, Contractor):
    class TimePerson(db.Model):
        __tablename__ = 'time_person'
        __table_args__ = (db.CheckConstraint("kind IN ('person','company')", name='ck_time_person_kind'),)
        id = db.Column(db.Integer, primary_key=True)
        kind = db.Column(db.String(12), nullable=False, default='person')
        name = db.Column(db.String(160), nullable=False)
        role = db.Column(db.String(80), nullable=False, default='')
        notes = db.Column(db.String(3000), nullable=False, default='')
        contractor_id = db.Column(db.Integer, db.ForeignKey('contractor.id'), nullable=True)
        created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
        entries = db.relationship('TimeEntry', cascade='all, delete-orphan', lazy='select')

    class TimeEntry(db.Model):
        __tablename__ = 'time_entry'
        __table_args__ = (db.CheckConstraint('minutes > 0 AND minutes <= 1440', name='ck_time_entry_minutes'),)
        id = db.Column(db.Integer, primary_key=True)
        person_id = db.Column(db.Integer, db.ForeignKey('time_person.id'), nullable=False, index=True)
        worked_on = db.Column(db.Date, nullable=False)
        minutes = db.Column(db.Integer, nullable=False)
        description = db.Column(db.String(2000), nullable=False, default='')
        created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    def text(value, label, limit, required=False):
        if not isinstance(value, str) or len(value.strip()) > limit or (required and not value.strip()):
            raise ValueError(label + ' fehlt oder ist zu lang.')
        return value.strip()

    def ident(value):
        if type(value) is not int or value <= 0:
            raise ValueError('Ungültige Zuordnung.')
        return value

    def body(allowed):
        value = request.get_json(silent=True)
        if not isinstance(value, dict) or set(value) - allowed:
            raise ValueError('Ungültige Eingaben.')
        return value

    def person_dict(person, totals=None):
        company = db.session.get(Contractor, person.contractor_id) if person.contractor_id else None
        if totals is None:
            entries = db.session.scalars(select(TimeEntry).where(TimeEntry.person_id == person.id)).all()
            totals = (sum(x.minutes for x in entries), len(entries), max((x.worked_on for x in entries), default=None))
        return dict(id=person.id, kind=person.kind, name=company.name if person.kind == 'company' and company else person.name,
                    role=person.role, notes=person.notes, contractor_id=person.contractor_id,
                    company_name=company.name if company else '', total_minutes=totals[0], entry_count=totals[1],
                    last_date=totals[2].isoformat() if totals[2] else '')

    def entry_dict(entry):
        return dict(id=entry.id, person_id=entry.person_id, worked_on=entry.worked_on.isoformat(),
                    minutes=entry.minutes, description=entry.description)

    @app.get('/api/time-tracking')
    def list_people():
        totals = {row.person_id: (row.minutes, row._mapping['count'], row.last_date) for row in db.session.execute(
            select(TimeEntry.person_id, func.sum(TimeEntry.minutes).label('minutes'),
                   func.count(TimeEntry.id).label('count'), func.max(TimeEntry.worked_on).label('last_date')).group_by(TimeEntry.person_id))}
        result = jsonify(people=[person_dict(p, totals.get(p.id, (0, 0, None))) for p in db.session.scalars(select(TimePerson).order_by(TimePerson.name, TimePerson.id))],
                         companies=[dict(id=c.id, name=c.name) for c in db.session.scalars(select(Contractor).order_by(Contractor.name))])
        result.headers['Cache-Control'] = 'no-store'
        return result

    @app.get('/api/time-people/<int:person_id>')
    def person_detail(person_id):
        person = db.session.get(TimePerson, person_id)
        if person is None:
            return jsonify(error='Person oder Firma nicht gefunden.'), 404
        return jsonify(person=person_dict(person), entries=[entry_dict(e) for e in db.session.scalars(
            select(TimeEntry).where(TimeEntry.person_id == person_id).order_by(TimeEntry.worked_on.desc(), TimeEntry.id.desc()))])

    @app.post('/api/time-people')
    @app.route('/api/time-people/<int:person_id>', methods=['PATCH', 'DELETE'])
    def save_person(person_id=None):
        person = db.session.get(TimePerson, person_id) if person_id else TimePerson(kind='person', name='', role='', notes='')
        if person is None:
            return jsonify(error='Person oder Firma nicht gefunden.'), 404
        if request.method == 'DELETE':
            db.session.delete(person); db.session.commit()
            return jsonify(ok=True)
        try:
            data = body({'kind', 'name', 'role', 'notes', 'contractor_id'})
            for key, limit in [('kind', 12), ('name', 160), ('role', 80), ('notes', 3000)]:
                if key in data:
                    setattr(person, key, text(data[key], key, limit))
            if person.kind not in ('person', 'company'):
                raise ValueError('Bitte Person oder Firma auswählen.')
            if 'contractor_id' in data:
                person.contractor_id = None if data['contractor_id'] is None else ident(data['contractor_id'])
            company = db.session.get(Contractor, person.contractor_id) if person.contractor_id else None
            if person.contractor_id and company is None:
                raise ValueError('Firma nicht gefunden. Bitte eine Firma aus diesem Projekt auswählen.')
            if person.kind == 'company':
                if company is None:
                    raise ValueError('Bitte eine Firma aus den Stammdaten auswählen.')
                person.name = company.name[:160]
            person.name = text(person.name, 'Name', 160, required=True)
            db.session.add(person); db.session.commit()
            return jsonify(person=person_dict(person)), 200 if person_id else 201
        except (ValueError, TypeError) as exc:
            db.session.rollback()
            return jsonify(error=str(exc)), 400

    @app.post('/api/time-entries')
    @app.route('/api/time-entries/<int:entry_id>', methods=['PATCH', 'DELETE'])
    def save_entry(entry_id=None):
        entry = db.session.get(TimeEntry, entry_id) if entry_id else TimeEntry(description='')
        if entry is None:
            return jsonify(error='Stundeneintrag nicht gefunden.'), 404
        if request.method == 'DELETE':
            db.session.delete(entry); db.session.commit()
            return jsonify(ok=True)
        try:
            data = body({'person_id', 'worked_on', 'minutes', 'description'})
            person_id = ident(data.get('person_id', entry.person_id))
            if db.session.get(TimePerson, person_id) is None:
                raise ValueError('Person oder Firma nicht gefunden.')
            raw_date = data.get('worked_on', entry.worked_on.isoformat() if entry.worked_on else '')
            if not isinstance(raw_date, str) or date.fromisoformat(raw_date).isoformat() != raw_date:
                raise ValueError('Bitte ein gültiges Datum angeben.')
            day = date.fromisoformat(raw_date)
            minutes = data.get('minutes', entry.minutes)
            if type(minutes) is not int or not 1 <= minutes <= 1440:
                raise ValueError('Bitte eine Dauer zwischen einer Minute und 24 Stunden angeben.')
            used = db.session.scalar(select(func.coalesce(func.sum(TimeEntry.minutes), 0)).where(
                TimeEntry.person_id == person_id, TimeEntry.worked_on == day, TimeEntry.id != (entry_id or 0)))
            if used + minutes > 1440 and db.session.get(TimePerson, person_id).kind == 'person':
                raise ValueError('Für diese Person sind an diesem Tag insgesamt mehr als 24 Stunden erfasst.')
            entry.person_id = person_id; entry.worked_on = day; entry.minutes = minutes
            if 'description' in data:
                entry.description = text(data['description'], 'Tätigkeit', 2000)
            db.session.add(entry); db.session.commit()
            return jsonify(entry=entry_dict(entry)), 200 if entry_id else 201
        except (ValueError, TypeError) as exc:
            db.session.rollback()
            return jsonify(error=str(exc)), 400

    return TimePerson, TimeEntry
