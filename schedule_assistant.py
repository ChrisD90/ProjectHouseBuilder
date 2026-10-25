"""Validate AI schedule-change proposals without touching the live database.

Only an explicit, version-checked approval may cause schedule mutations.
"""
from datetime import date

EDITABLE = frozenset({
    'name', 'phase', 'trade', 'execution_type', 'duration', 'lag_days',
    'notes', 'predecessors', 'earliest_start', 'status', 'progress'
})
STATES = {'Offen', 'In Arbeit', 'Pausiert', 'Erledigt'}
TYPES = {'Eigenleistung', 'Fremdleistung', 'Noch offen'}


def _text(value, label, maximum):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(label + ' fehlt oder ist zu lang.')
    return value.strip()


def _validate_field(key, value):
    if key not in EDITABLE:
        raise ValueError('Unzulässige Änderung am Arbeitspaket: ' + str(key))
    if key in ('name', 'phase', 'trade'):
        return _text(value, key, 300 if key == 'name' else 140)
    if key == 'notes':
        if not isinstance(value, str) or len(value) > 3000:
            raise ValueError('Notizen sind zu lang.')
        return value
    if key in ('duration', 'lag_days', 'progress'):
        if type(value) is not int:
            raise ValueError(key + ' muss eine ganze Zahl sein.')
        lo, hi = {'duration': (1, 365), 'lag_days': (0, 180), 'progress': (0, 100)}[key]
        if not lo <= value <= hi:
            raise ValueError('Ungültiger Bereich für ' + key)
        return value
    if key == 'execution_type':
        if value not in TYPES:
            raise ValueError('Ungültige Eigen-/Fremdleistung.')
        return value
    if key == 'status':
        if value not in STATES:
            raise ValueError('Unbekannter Arbeitspaketstatus.')
        return value
    if key == 'earliest_start':
        if value in (None, ''):
            return ''
        if not isinstance(value, str) or len(value) != 10:
            raise ValueError('Frühester Start muss YYYY-MM-DD sein.')
        try:
            return date.fromisoformat(value).isoformat()
        except ValueError as exc:
            raise ValueError('Ungültiges Startdatum.') from exc
    if key == 'predecessors':
        if (not isinstance(value, list) or len(value) > 30
                or any(not isinstance(x, str) or len(x) > 40 for x in value)
                or len(set(value)) != len(value)):
            raise ValueError('Ungültige Vorgänger-Liste.')
        return list(value)
    raise ValueError('Nicht unterstütztes Feld.')


def validate_changes(existing, proposal):
    """Return canonical operations and human-readable before/after differences.

    Rejections are atomic: no changes to existing SQLAlchemy objects occur.
    """
    if not isinstance(proposal, list) or len(proposal) > 35:
        raise ValueError('Maximal 35 Änderungen pro Vorschlag.')
    before = {t['code']: dict(t) for t in existing}
    future = {key: dict(value) for key, value in before.items()}
    seen = set()
    canonical = []
    preview = []
    for item in proposal:
        if not isinstance(item, dict):
            raise ValueError('Ungültiger Änderungseintrag.')
        action = item.get('action')
        if action not in ('add', 'update', 'remove'):
            raise ValueError('Unbekannte Aktion in der KI-Antwort.')
        if action == 'add':
            task = item.get('task')
            if not isinstance(task, dict):
                raise ValueError('Beim Hinzufügen fehlen Aufgabenfelder.')
            code = _text(task.get('code'), 'Arbeitspaket-ID', 30)
            if code in future or code in seen:
                raise ValueError('Arbeitspaket-ID existiert bereits: ' + code)
            unknown = set(task) - EDITABLE - {'code'}
            if unknown:
                raise ValueError('Nicht erlaubte Eigenschaften neuer Aufgaben.')
            fields = {key: _validate_field(key, value)
                      for key, value in task.items() if key != 'code'}
            if not fields.get('name'):
                raise ValueError('Neue Aufgabe braucht einen Namen.')
            new = {
                'code': code, 'name': fields['name'],
                'phase': 'Allgemein', 'trade': 'Sonstiges',
                'execution_type': 'Noch offen', 'duration': 7,
                'lag_days': 0, 'status': 'Offen', 'progress': 0,
                'notes': '', 'earliest_start': '', 'predecessors': [],
            }
            new.update(fields)
            future[code] = new
            canonical.append({'action': 'add', 'code': code, 'fields': fields})
            preview.append({'action': 'add', 'code': code, 'name': new['name'],
                            'changes': [{'field': k, 'before': None, 'after': v}
                                        for k, v in new.items() if k != 'code']})
        else:
            code = _text(item.get('code'), 'Arbeitspaket-ID', 30)
            if code not in before or code in seen:
                raise ValueError('Arbeitspaket nicht vorhanden oder doppelt geändert: ' + code)
            if future[code].get('status')=='Erledigt':
                if action=='remove' or any(key not in ('notes','predecessors') and value!=future[code].get(key) for key,value in (item.get('fields') if isinstance(item.get('fields'),dict) else {}).items()):
                    raise ValueError('Abgeschlossene Arbeitspakete: nur Notizen und Abhängigkeiten ändern.')
            if action == 'remove':
                old = future.pop(code)
                canonical.append({'action': 'remove', 'code': code})
                preview.append({'action': 'remove', 'code': code, 'name': old['name'],
                                'changes': [{'field': 'Arbeitspaket',
                                             'before': old['name'], 'after': None}]})
            else:
                fields = item.get('fields')
                if not isinstance(fields, dict) or not fields:
                    raise ValueError('Beim Ändern fehlen Felder.')
                revised = {key: _validate_field(key, val) for key, val in fields.items()}
                changed = [{'field': key, 'before': future[code].get(key), 'after': value}
                           for key, value in revised.items() if future[code].get(key) != value]
                if changed:
                    future[code].update(revised)
                    canonical.append({'action': 'update', 'code': code, 'fields': revised})
                    preview.append({'action': 'update', 'code': code,
                                    'name': future[code]['name'], 'changes': changed})
        seen.add(code)
    if not canonical:
        return [], []
    for code, task in future.items():
        predecessors = task.get('predecessors', [])
        if code in predecessors:
            raise ValueError('Eine Aufgabe kann nicht ihr eigener Vorgänger sein: ' + code)
        if any(pred not in future for pred in predecessors):
            raise ValueError('Abhängigkeit zu gelöschter oder unbekannter Aufgabe: ' + code)
    state = {}
    def visit(code):
        if state.get(code) == 1:
            raise ValueError('Zyklische Abhängigkeiten im Vorschlag.')
        if state.get(code) == 2:
            return
        state[code] = 1
        for pred in future[code].get('predecessors', []):
            visit(pred)
        state[code] = 2
    for code in future:
        visit(code)
    return canonical, preview
