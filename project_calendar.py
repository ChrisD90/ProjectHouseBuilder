"""Independent project appointments; existing construction schedules remain untouched.

Dates/times are local wall-clock values. End dates are inclusive, like the UI.
"""
from datetime import date, time
from flask import jsonify, request
from sqlalchemy import select
from sqlalchemy.orm import selectinload


def register_project_calendar(app, db, Trade):
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

    class CalendarEventTrade(db.Model):
        __tablename__ = 'calendar_event_trade'
        __table_args__ = (db.UniqueConstraint('event_id', 'trade_id', name='uq_calendar_event_trade'),)
        id = db.Column(db.Integer, primary_key=True)
        event_id = db.Column(db.Integer, db.ForeignKey('calendar_event.id'), nullable=False, index=True)
        trade_id = db.Column(db.Integer, db.ForeignKey('trade.id'), nullable=False, index=True)
        trade = db.relationship(Trade, lazy='joined')

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
        return dict(id=event.id, title=event.title, start_date=event.start_date.isoformat(),
                    end_date=event.end_date.isoformat(), all_day=event.all_day,
                    start_time=event.start_time.strftime('%H:%M') if event.start_time else '',
                    end_time=event.end_time.strftime('%H:%M') if event.end_time else '',
                    notes=event.notes, trade_ids=[link.trade_id for link in event.trades],
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
            CalendarEvent.start_date, CalendarEvent.start_time, CalendarEvent.title, CalendarEvent.id))])
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
            if not isinstance(data, dict) or set(data) - {'title','start_date','end_date','all_day','start_time','end_time','notes','trade_ids'}:
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
            db.session.add(event); db.session.commit()
            return jsonify(event=serialize(event)), 200 if event_id else 201
        except (ValueError, TypeError) as exc:
            db.session.rollback()
            return jsonify(error=str(exc)), 400

    return CalendarEvent, CalendarEventTrade
