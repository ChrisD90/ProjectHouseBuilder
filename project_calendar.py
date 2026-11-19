"""Independent project appointments; existing construction schedules remain untouched.

Dates/times are local wall-clock values. End dates are inclusive, like the UI.
"""
from datetime import date, time, timedelta
from flask import jsonify, request
from sqlalchemy import select
from sqlalchemy.orm import selectinload


def register_project_calendar(app, db, Trade, Contractor, TimePerson, TimeEntry):
    class CalendarEvent(db.Model):
        __tablename__ = 'calendar_event'
        __table_args__ = (
            db.CheckConstraint('end_date >= start_date', name='ck_calendar_event_dates'),
        )
        id = db.Column(db.Integer, primary_key=True)
        title = db.Column(db.String(160), nullable=False)
        start_date = db.Column(db.Date, nullable=False, index=True)
        end_date = db.Column(db.Date, nullable=False, index=True)
        all_day = db.Column(db.Boolean, nullable=False, default=True)
        start_time = db.Column(db.Time, nullable=True)
        end_time = db.Column(db.Time, nullable=True)
        notes = db.Column(db.String(4000), nullable=False, default='')
        trades = db.relationship('CalendarEventTrade', cascade='all, delete-orphan', lazy='selectin')
        company = db.relationship('CalendarEventCompany', cascade='all, delete-orphan', uselist=False, lazy='selectin')
        time_links = db.relationship('CalendarCompanyTime', cascade='all, delete-orphan', lazy='selectin', back_populates='event')
        preferences = db.relationship('CalendarPreferences', cascade='all, delete-orphan', uselist=False, lazy='selectin')

    class CalendarEventTrade(db.Model):
        __tablename__ = 'calendar_event_trade'
        __table_args__ = (db.UniqueConstraint('event_id', 'trade_id', name='uq_calendar_event_trade'),)
        id = db.Column(db.Integer, primary_key=True)
        event_id = db.Column(db.Integer, db.ForeignKey('calendar_event.id'), nullable=False, index=True)
        trade_id = db.Column(db.Integer, db.ForeignKey('trade.id'), nullable=False, index=True)
        trade = db.relationship(Trade, lazy='joined')

    class CalendarEventCompany(db.Model):
        __tablename__ = 'calendar_event_company'
        id = db.Column(db.Integer, primary_key=True)
        event_id = db.Column(db.Integer, db.ForeignKey('calendar_event.id'), nullable=False, unique=True)
        contractor_id = db.Column(db.Integer, db.ForeignKey('contractor.id'), nullable=False, index=True)
        contractor = db.relationship(Contractor)

    class CalendarCompanyTime(db.Model):
        __tablename__ = 'calendar_company_time'
        __table_args__ = (db.UniqueConstraint('event_id', 'worked_on', name='uq_calendar_company_day'),)
        id = db.Column(db.Integer, primary_key=True)
        event_id = db.Column(db.Integer, db.ForeignKey('calendar_event.id'), nullable=False, index=True)
        entry_id = db.Column(db.Integer, db.ForeignKey('time_entry.id'), nullable=False, unique=True)
        worked_on = db.Column(db.Date, nullable=False)
        flat_rate = db.Column(db.Boolean, nullable=False, default=False)
        event = db.relationship(CalendarEvent, back_populates='time_links')
        entry = db.relationship(TimeEntry, back_populates='calendar_source', single_parent=True, cascade='all, delete-orphan')

    def sync_hours(event):
        if not event.company:
            event.time_links.clear()
            return
        if (event.end_date - event.start_date).days >= 366:
            raise ValueError('Ein Firmentermin darf höchstens 366 Kalendertage umfassen.')
        contractor = db.session.get(Contractor, event.company.contractor_id)
        person = db.session.scalar(select(TimePerson).where(TimePerson.kind == 'company',
            TimePerson.contractor_id == contractor.id).order_by(TimePerson.id).limit(1))
        if person is None:
            person = TimePerson(kind='company', name=contractor.name[:160], contractor_id=contractor.id, role='', notes='')
            db.session.add(person)
        expected = {}
        for offset in range((event.end_date - event.start_date).days + 1):
            current = event.start_date + timedelta(days=offset)
            if event.all_day:
                minutes = 480
            else:
                first = event.start_time.hour * 60 + event.start_time.minute if current == event.start_date else 0
                last = event.end_time.hour * 60 + event.end_time.minute if current == event.end_date else 1440
                minutes = last - first
            if minutes > 0:
                expected[current] = minutes
        event.time_links[:] = [link for link in event.time_links if link.worked_on in expected]
        existing = {link.worked_on: link for link in event.time_links}
        for worked_on, minutes in expected.items():
            link = existing.get(worked_on)
            if link is None:
                link = CalendarCompanyTime(worked_on=worked_on, entry=TimeEntry(worked_on=worked_on))
                event.time_links.append(link)
            link.flat_rate = event.all_day
            link.entry.person_id = person.id if person.id else None
            # A relationship also handles a newly created company card in this transaction.
            if link.entry not in person.entries:
                person.entries.append(link.entry)
            link.entry.minutes = minutes
            link.entry.description = event.title

    def text(value, label, limit, required=False):
        if not isinstance(value, str) or len(value.strip()) > limit or (required and not value.strip()):
            raise ValueError(label + ' fehlt oder ist zu lang.')
        return value.strip()

    def day(value):
        if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
            raise ValueError('Bitte ein gültiges Datum angeben (JJJJ-MM-TT).')
        return date.fromisoformat(value)

    def clock(value):
        if not isinstance(value, str) or len(value) != 5 or time.fromisoformat(value).strftime('%H:%M') != value:
            raise ValueError('Bitte eine gültige Uhrzeit angeben (HH:MM).')
        return time.fromisoformat(value)

    def serialize(event):
        return dict(id=event.id, title=event.title, performed=event.preferences.performed if event.preferences else True, series=event.preferences.series if event.preferences else '', start_date=event.start_date.isoformat(),
                    end_date=event.end_date.isoformat(), all_day=event.all_day,
                    start_time=event.start_time.strftime('%H:%M') if event.start_time else '',
                    end_time=event.end_time.strftime('%H:%M') if event.end_time else '',
                    notes=event.notes, contractor_id=event.company.contractor_id if event.company else None,
                    company_name=event.company.contractor.name if event.company else '',
                    company_trade=event.company.contractor.trade if event.company else '', trade_ids=[link.trade_id for link in event.trades],
                    trades=[dict(id=link.trade_id, name=link.trade.name) for link in event.trades if link.trade])

    @app.get('/api/calendar-events')
    def calendar_list():
        query = select(CalendarEvent).options(selectinload(CalendarEvent.trades))
        try:
            if 'from' in request.args or 'to' in request.args:
                first, last = day(request.args.get('from')), day(request.args.get('to'))
                if last < first or (last - first).days > 366:
                    raise ValueError('Bitte einen Zeitraum von höchstens einem Jahr auswählen.')
                query = query.where(CalendarEvent.start_date <= last, CalendarEvent.end_date >= first)
        except (ValueError, TypeError) as exc:
            return jsonify(error=str(exc)), 400
        response = jsonify(events=[serialize(e) for e in db.session.scalars(query.order_by(
            CalendarEvent.start_date, CalendarEvent.start_time, CalendarEvent.title, CalendarEvent.id))],
            companies=[dict(id=c.id, name=c.name) for c in db.session.scalars(select(Contractor).order_by(Contractor.name, Contractor.id))])
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/api/calendar-events/<int:event_id>')
    def calendar_detail(event_id):
        event = db.session.get(CalendarEvent, event_id)
        if event is None:
            return jsonify(error='Termin nicht gefunden.'), 404
        return jsonify(event=serialize(event))

    @app.post('/api/calendar-events')
    @app.route('/api/calendar-events/<int:event_id>', methods=['PATCH', 'DELETE'])
    def calendar_save(event_id=None):
        event = db.session.get(CalendarEvent, event_id) if event_id else CalendarEvent(all_day=True, notes='')
        if event is None:
            return jsonify(error='Termin nicht gefunden.'), 404
        if request.method == 'DELETE':
            db.session.delete(event); db.session.commit()
            return jsonify(ok=True)
        try:
            data = request.get_json(silent=True)
            if not isinstance(data, dict) or set(data) - {'title','start_date','end_date','all_day','start_time','end_time','notes','trade_ids','contractor_id','performed'}:
                raise ValueError('Ungültige Termineingaben.')
            event.title = text(data.get('title', event.title), 'Titel', 160, True)
            event.start_date = day(data.get('start_date', event.start_date.isoformat() if event.start_date else None))
            event.end_date = day(data.get('end_date') or (event.end_date.isoformat() if event.end_date else event.start_date.isoformat()))
            if event.end_date < event.start_date:
                raise ValueError('Das Ende darf nicht vor dem Beginn liegen.')
            event.all_day = data.get('all_day', event.all_day)
            if type(event.all_day) is not bool:
                raise ValueError('Ganztägig muss ein Wahrheitswert sein.')
            if event.all_day:
                event.start_time = event.end_time = None
            else:
                event.start_time = clock(data.get('start_time', event.start_time.strftime('%H:%M') if event.start_time else None))
                event.end_time = clock(data.get('end_time', event.end_time.strftime('%H:%M') if event.end_time else None))
                if (event.end_date, event.end_time) <= (event.start_date, event.start_time):
                    raise ValueError('Das Terminende muss nach dem Beginn liegen.')
            event.notes = text(data.get('notes', event.notes), 'Notizen', 4000)
            if 'trade_ids' in data:
                ids = data['trade_ids']
                if not isinstance(ids, list) or len(ids) > 50 or any(type(x) is not int or x < 1 for x in ids) or len(ids) != len(set(ids)):
                    raise ValueError('Bitte gültige Gewerke auswählen.')
                if any(db.session.get(Trade, ident) is None for ident in ids):
                    raise ValueError('Bitte Gewerke aus diesem Projekt auswählen.')
                # Keep existing links to avoid delete/insert conflicts on unchanged pairs.
                event.trades[:] = [link for link in event.trades if link.trade_id in ids]
                current = {link.trade_id for link in event.trades}
                event.trades.extend(CalendarEventTrade(trade_id=ident) for ident in ids if ident not in current)
            if 'contractor_id' in data:
                ident = data['contractor_id']
                if ident is not None and (type(ident) is not int or ident < 1 or db.session.get(Contractor, ident) is None):
                    raise ValueError('Bitte eine Firma aus diesem Projekt auswählen.')
                if ident is None:
                    event.company = None
                elif event.company:
                    event.company.contractor_id = ident
                else:
                    event.company = CalendarEventCompany(contractor_id=ident)
            if event.company and event.trades:
                raise ValueError('Bitte entweder eine Firma oder Gewerke verknüpfen.')
            if 'performed' in data:
                if type(data['performed']) is not bool:raise ValueError('Durchführung ausdrücklich bestätigen oder als geplant markieren.')
                if event.preferences:event.preferences.performed=data['performed']
                else:
                    model=db.Model.registry._class_registry['CalendarPreferences']
                    event.preferences=model(performed=data['performed'])
            db.session.add(event)
            # Save the appointment and its derived daily entries in one transaction.
            with db.session.no_autoflush:
                sync_hours(event)
            db.session.commit()
            return jsonify(event=serialize(event)), 200 if event_id else 201
        except (ValueError, TypeError) as exc:
            db.session.rollback()
            return jsonify(error=str(exc)), 400

    return CalendarEvent, CalendarEventTrade, CalendarEventCompany, CalendarCompanyTime, serialize, sync_hours
