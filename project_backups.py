"""Portable, project-only backups and transactional restores for SQLite/PostgreSQL.

No database files, auth profiles, backup settings or other projects enter this format.
Record IDs stay stable; foreign-project ID/file collisions fail before any deletion.
"""
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path, PurePosixPath
import hashlib
import json
import math
import os
import re
import shutil
import stat
import tempfile
import zipfile
import sqlalchemy as sa

FORMAT = 'projecthousebuilder-project-backup'
VERSION = 1
MAX_BYTES = 8 * 1024**3
MAX_ROWS = 500000
FILE_TABLES = {
    'document': ('documents', True), 'receipt': ('receipts', True),
    'project_document': ('project-documents', True),
    'finance_loan_document': ('loans', True),
    'finance_event_document': ('financing-events', True),
    'finance_loan_usage': ('loan-usages', True),
    'finance_loan_drawdown': ('loan-drawdowns', False),
    'import_job': ('import-queue', False),
}
EPHEMERAL = {'planning_browser_state'}


def owned_tables(db):
    return {t.name: t for t in db.metadata.tables.values() if 'project_id' in t.c}


def _json(value):
    if isinstance(value, (date, datetime, Decimal)): return str(value)
    raise ValueError('Unbekannter Datentyp im Projektbackup.')


def _loads(raw):
    def pairs(entries):
        result = {}
        for key, value in entries:
            if key in result: raise ValueError('Doppelte Eigenschaften im Backup.')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Ungültige Zahl.')))


def file_refs(rows):
    refs = {}
    for table, (directory, required) in FILE_TABLES.items():
        for row in rows.get(table, []):
            for key in ('stored_name', 'preview_name'):
                value = row.get(key)
                if not value: continue
                if not isinstance(value, str) or value in ('.', '..') or '/' in value or '\\' in value or '\x00' in value:
                    raise ValueError('Ungültiger Dokumentpfad im Projekt.')
                name = 'private/' + directory + '/' + value
                refs[name] = refs.get(name, False) or (required and key == 'stored_name')
    return refs


def _path(root, name):
    path = root / name
    if not path.is_relative_to(root) or any(p.is_symlink() for p in [path, *path.parents] if p.is_relative_to(root)):
        raise ValueError('Symbolische Links oder unsichere Dokumentpfade sind nicht erlaubt.')
    return path


def _rows(connection, db, owner):
    return {name: [dict(r) for r in connection.execute(sa.select(table).where(table.c.project_id == owner)).mappings()]
            for name, table in owned_tables(db).items()}


def files_for_project(db, root, owner, *, strict=False):
    root = Path(root).resolve()
    refs = file_refs(_rows(db.session.connection(), db, owner))
    result = []
    for name, required in refs.items():
        path = _path(root, name)
        if path.is_file(): result.append(path)
        elif strict and required: raise ValueError('Projektdatei fehlt: ' + name)
    return result


def folder(config, owner, *, create=False):
    base = Path(config['folder']).resolve()
    target = base / ('project-' + str(owner))
    if not base.is_dir() or target.is_symlink(): raise ValueError('Projekt-Backupziel nicht verfügbar oder unsicher.')
    if create: target.mkdir(mode=0o700, exist_ok=True)
    return target


def existing(config, owner):
    directory = folder(config, owner)
    return [{'filename': p.name, 'bytes': p.stat().st_size}
            for p in sorted(directory.glob(f'PHB_Project_{owner}_*.zip'), reverse=True)
            if p.is_file() and not p.is_symlink()]


def selected(config, owner, name):
    if not isinstance(name, str) or not re.fullmatch(r'PHB_Project_' + str(owner) + r'_[0-9_-]+\.zip', name):
        raise ValueError('Sicherung gehört nicht zum geöffneten Projekt.')
    path = folder(config, owner) / name
    if not path.is_file() or path.is_symlink(): raise ValueError('Projektbackup nicht gefunden.')
    return path


def _digest(path):
    h = hashlib.sha256()
    with path.open('rb') as src:
        for block in iter(lambda: src.read(1024*1024), b''): h.update(block)
    return h.hexdigest()


def create(db, root, owner, config):
    directory = folder(config, owner, create=True)
    root = Path(root).resolve()
    connection = db.session.connection()
    project = connection.execute(sa.select(db.metadata.tables['project']).where(db.metadata.tables['project'].c.id == owner)).mappings().one_or_none()
    if project is None: raise ValueError('Projekt nicht gefunden.')
    rows = _rows(connection, db, owner)
    if any(r['status'] in ('Wartend', 'Läuft') for r in rows.get('import_job', [])):
        raise ValueError('Laufende Projekt-Uploads zuerst abschließen lassen.')
    rows = {name: value for name, value in rows.items() if name not in EPHEMERAL}
    refs = file_refs(rows)
    _foreign_files(connection, db, owner, refs)
    now = datetime.now(timezone.utc)
    path = directory / f'PHB_Project_{owner}_{now:%Y-%m-%d_%H-%M-%S_%f}.zip'
    partial = path.with_name('.' + path.name + '.partial')
    payload = json.dumps({'project': dict(project), 'tables': rows}, default=_json, ensure_ascii=False).encode('utf-8')
    manifest = {'format': FORMAT, 'version': VERSION, 'project_id': owner,
                'project_title': project['title'], 'created': now.isoformat(), 'files': {}}
    try:
        with zipfile.ZipFile(partial, 'w', compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
            archive.writestr('project-data.json', payload)
            manifest['files']['project-data.json'] = {'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)}
            for name, required in refs.items():
                source = _path(root, name)
                if not source.is_file():
                    if required: raise ValueError('Projektdatei fehlt: ' + name)
                    continue
                archive.write(source, name)
                manifest['files'][name] = {'sha256': _digest(source), 'bytes': source.stat().st_size}
            archive.writestr('backup-manifest.json', json.dumps(manifest, ensure_ascii=False))
        # A reset safety archive must be restorable, not merely checksum-correct.
        load_rows(partial, db, owner)
        os.replace(partial, path)
    finally: partial.unlink(missing_ok=True)
    # Retention belongs to this project; never inspect or prune sibling projects.
    for extra in existing(config, owner)[max(2, int(config['keep'])):]:
        selected(config, owner, extra['filename']).unlink()
    return path


def verify(path, owner):
    path = Path(path)
    if path.is_symlink() or not path.is_file(): raise ValueError('Sicherung nicht gefunden.')
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or len(names) > 20000: raise ValueError('Ungültige Archiveinträge.')
        if 'backup-manifest.json' not in names or archive.getinfo('backup-manifest.json').file_size > 2*1024**2:
            raise ValueError('Projektmanifest fehlt oder ist zu groß.')
        manifest = _loads(archive.read('backup-manifest.json'))
        if not isinstance(manifest, dict): raise ValueError('Ungültiges Projektmanifest.')
        if manifest.get('format') != FORMAT or manifest.get('version') != VERSION:
            raise ValueError('Bitte ein Projektbackup verwenden. Alte Systemsicherungen werden ausschließlich administrativ wiederhergestellt.')
        if type(manifest.get('project_id')) is not int or manifest['project_id'] != owner:
            raise ValueError('Dieses Backup gehört zu einem anderen Projekt. Bitte das zugehörige Projekt öffnen.')
        files = manifest.get('files')
        if not isinstance(files, dict) or 'project-data.json' not in files or set(names) != set(files) | {'backup-manifest.json'}:
            raise ValueError('Unvollständige Dateiliste im Projektbackup.')
        total = 0
        for name, props in files.items():
            pure = PurePosixPath(name)
            if pure.is_absolute() or any(p in ('..', '.') for p in pure.parts) or '\\' in name or '\x00' in name or str(pure) != name:
                raise ValueError('Unsicherer Dateipfad im Projektbackup.')
            if name != 'project-data.json' and not (len(pure.parts) == 3 and pure.parts[0] == 'private' and pure.parts[1] in {v[0] for v in FILE_TABLES.values()}):
                raise ValueError('Nicht erlaubte Datei im Projektbackup.')
            info = archive.getinfo(name)
            if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16) or not isinstance(props, dict): raise ValueError('Ungültige Datei.')
            total += info.file_size
            if total > MAX_BYTES or (name == 'project-data.json' and info.file_size > 128*1024**2): raise ValueError('Projektbackup ist zu groß.')
            h = hashlib.sha256()
            with archive.open(name) as src:
                for block in iter(lambda: src.read(1024*1024), b''): h.update(block)
            if info.file_size != props.get('bytes') or h.hexdigest() != props.get('sha256'): raise ValueError('Prüfsumme falsch: ' + name)
        payload = _loads(archive.read('project-data.json'))
        if not isinstance(payload, dict) or not isinstance(payload.get('project'), dict) or payload['project'].get('id') != owner or not isinstance(payload.get('tables'), dict):
            raise ValueError('Ungültige Projektdaten.')
        for rows in payload['tables'].values():
            if not isinstance(rows, list) or any(not isinstance(r, dict) or type(r.get('project_id')) is not int or r['project_id'] != owner for r in rows):
                raise ValueError('Backup enthält Daten eines anderen Projekts.')
        refs = file_refs(payload['tables'])
        if set(files) - {'project-data.json'} - set(refs): raise ValueError('Backup enthält projektfremde Dateien.')
        if any(required and name not in files for name, required in refs.items()): raise ValueError('Originaldatei fehlt im Projektbackup.')
        return manifest


def _value(column, value):
    if value is None:
        if not column.nullable: raise ValueError('Pflichtfeld fehlt: ' + str(column))
        return None
    kind = column.type
    if isinstance(kind, sa.Boolean):
        if type(value) is not bool: raise ValueError('Ungültiger Wahrheitswert.')
    elif isinstance(kind, sa.Integer):
        if type(value) is not int: raise ValueError('Ungültige ID oder Zahl.')
    elif isinstance(kind, sa.DateTime): value = datetime.fromisoformat(value)
    elif isinstance(kind, sa.Date): value = date.fromisoformat(value)
    elif isinstance(kind, sa.Numeric):
        value = Decimal(str(value))
        if not value.is_finite(): raise ValueError('Ungültiger Betrag.')
    elif isinstance(kind, sa.Float):
        if not isinstance(value, (int, float)) or not math.isfinite(value): raise ValueError('Ungültige Zahl.')
    elif isinstance(kind, sa.String):
        if not isinstance(value, str) or (kind.length and len(value) > kind.length): raise ValueError('Ungültiger Text: ' + str(column))
    return value


def load_rows(path, db, owner):
    verify(path, owner)
    with zipfile.ZipFile(path) as archive: payload = _loads(archive.read('project-data.json'))
    tables = owned_tables(db)
    expected = set(tables) - EPHEMERAL
    # Backups from revision 0028 predate both plan tables; they legitimately contain no plans.
    missing=expected-set(payload['tables'])
    # Revision 0032 adds an independent, initially empty planning area.
    if 'self_work_plan' in missing:
        payload['tables']['self_work_plan']=[]
        missing.remove('self_work_plan')
    if missing=={'funding_plan','funding_plan_offer'} and not (set(payload['tables'])-expected):
        for name in missing:payload['tables'][name]=[]
    if set(payload['tables']) != expected: raise ValueError('Backup-Schema passt nicht zur Anwendung. Bitte die passende App-Version verwenden.')
    result = {}; total = 0
    for name, rows in payload['tables'].items():
        table = tables[name]; restored = []; keys = set()
        total += len(rows)
        if total > MAX_ROWS: raise ValueError('Zu viele Datensätze im Backup.')
        for row in rows:
            if name=='import_job' and set(table.c.keys())-set(row)<= {'lease_owner','lease_until'}:
                row={**{'lease_owner':'','lease_until':None},**row}
            if set(row) != set(table.c.keys()): raise ValueError('Backup-Felder passen nicht zu ' + name)
            row = {key: _value(table.c[key], value) for key, value in row.items()}
            key = tuple(row[c.name] for c in table.primary_key)
            if key in keys: raise ValueError('Doppelte Datensätze im Backup.')
            keys.add(key); restored.append(row)
        result[name] = restored
    values = {(name, c.name): {r[c.name] for r in result.get(name, [])} for name, table in tables.items() for c in table.c if c.primary_key}
    for name, rows in result.items():
        for row in rows:
            for fk in tables[name].foreign_keys:
                value = row[fk.parent.name]
                if value is None: continue
                if fk.column.table.name == 'project':
                    if value != owner: raise ValueError('Projektfremde Verknüpfung.')
                elif value not in values.get((fk.column.table.name, fk.column.name), set()):
                    raise ValueError('Ungültige Verknüpfung in ' + name + '.' + fk.parent.name)
    if any(r['status'] in ('Wartend', 'Läuft') for r in result.get('import_job', [])): raise ValueError('Backup enthält laufende Uploads.')
    project = payload['project']
    for key in ('title', 'kind', 'description'):
        _value(db.metadata.tables['project'].c[key], project.get(key))
    return project, result


def _foreign_files(connection, db, owner, refs):
    foreign = {name: [dict(r) for r in connection.execute(sa.select(table).where(table.c.project_id != owner)).mappings()]
               for name, table in owned_tables(db).items() if name in FILE_TABLES}
    if set(refs) & set(file_refs(foreign)): raise ValueError('Dokumentdatei wird von einem anderen Projekt verwendet. Vorgang abgebrochen.')


def _order(tables):
    pending = dict(tables); ordered = []
    while pending:
        ready = [name for name, table in pending.items() if not any(
            fk.column.table.name in pending and not fk.parent.nullable for fk in table.foreign_keys)]
        if not ready: raise ValueError('Nicht unterstützte zirkuläre Pflichtverknüpfungen.')
        for name in ready: ordered.append(pending.pop(name))
    return ordered


def check_other_references(connection, db, owner, incoming=None):
    tables = owned_tables(db)
    current = _rows(connection, db, owner)
    # A malformed legacy cross-project FK must never cascade deletion or become rebound.
    for name, table in tables.items():
        other = list(connection.execute(sa.select(table).where(table.c.project_id != owner)).mappings())
        incoming_keys = {tuple(r[c.name] for c in table.primary_key) for r in (incoming or {}).get(name, [])}
        if incoming_keys & {tuple(r[c.name] for c in table.primary_key) for r in other}: raise ValueError('Backup-ID wird von einem anderen Projekt verwendet.')
        for fk in table.foreign_keys:
            target = fk.column.table.name
            ids = {r[fk.column.name] for r in current.get(target, [])}
            if any(r[fk.parent.name] is not None and r[fk.parent.name] in ids for r in other):
                raise ValueError('Projektübergreifende Altverknüpfung gefunden. Keine Daten geändert.')


def clear_rows(connection, db, owner):
    from request_safety import invalidate_operations
    invalidate_operations(connection,owner)
    tables = owned_tables(db)
    check_other_references(connection, db, owner)
    for table in tables.values():
        fields = {fk.parent.name: None for fk in table.foreign_keys if fk.parent.nullable}
        if fields: connection.execute(table.update().where(table.c.project_id == owner).values(**fields))
    for table in reversed(_order(tables)):
        connection.execute(table.delete().where(table.c.project_id == owner))


def restore(path, db, root, owner):
    project, rows = load_rows(path, db, owner)
    tables = owned_tables(db)
    root = Path(root).resolve(); private = _path(root, 'private'); private.mkdir(exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.project-restore-', dir=private))
    moved = []; installed = []
    try:
        manifest = verify(path, owner)
        with zipfile.ZipFile(path) as archive:
            for name in manifest['files']:
                if name == 'project-data.json': continue
                dest = staging / 'incoming' / name; dest.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(name) as src, dest.open('wb') as out: shutil.copyfileobj(src, out, 1024*1024)
        db.session.remove()
        try:
            with db.engine.begin() as connection:
                if connection.execute(sa.select(db.metadata.tables['project'].c.id).where(db.metadata.tables['project'].c.id == owner)).first() is None:
                    raise ValueError('Zielprojekt existiert nicht.')
                current = _rows(connection, db, owner)
                _foreign_files(connection, db, owner, {**file_refs(current), **file_refs(rows)})
                check_other_references(connection, db, owner, rows)
                clear_rows(connection, db, owner)
                for table in _order(tables):
                    nullable = {fk.parent.name for fk in table.foreign_keys if fk.parent.nullable}
                    entries = [{key: None if key in nullable else value for key, value in r.items()} for r in rows.get(table.name, [])]
                    if entries: connection.execute(table.insert(), entries)
                for name, entries in rows.items():
                    table = tables[name]
                    nullable = {fk.parent.name for fk in table.foreign_keys if fk.parent.nullable}
                    for row in entries:
                        if nullable: connection.execute(table.update().where(table.c.project_id == owner, *[c == row[c.name] for c in table.primary_key]).values(**{key: row[key] for key in nullable}))
                p = db.metadata.tables['project']
                connection.execute(p.update().where(p.c.id == owner).values(**{key: project[key] for key in ('title', 'kind', 'description')}))
                if connection.dialect.name == 'postgresql':
                    for table in tables.values():
                        if 'id' not in table.c or not table.c.id.primary_key or table.c.id.foreign_keys: continue
                        sequence = connection.scalar(sa.text("SELECT pg_get_serial_sequence(:t,'id')"), {'t': table.name})
                        if not sequence: continue
                        quoted = '.'.join(connection.dialect.identifier_preparer.quote(x) for x in sequence.split('.'))
                        maximum = connection.scalar(sa.select(sa.func.max(table.c.id))) or 1
                        last = connection.scalar(sa.text('SELECT last_value FROM ' + quoted))
                        connection.execute(sa.text('SELECT setval(:s,:v,true)'), {'s': sequence, 'v': max(last, maximum)})
                for name in file_refs(current):
                    source = _path(root, name)
                    if source.is_file():
                        dest = staging / 'previous' / name; dest.parent.mkdir(parents=True, exist_ok=True)
                        source.replace(dest); moved.append((source, dest))
                for name in manifest['files']:
                    if name == 'project-data.json': continue
                    dest = _path(root, name)
                    if dest.exists(): raise ValueError('Unbekannte Bestandsdatei würde überschrieben. Keine Wiederherstellung.')
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    (staging / 'incoming' / name).replace(dest); installed.append(dest)
        except Exception:
            for dest in installed: dest.unlink(missing_ok=True)
            for source, previous in moved: previous.replace(source)
            raise
        return {'restored': True, 'project_id': owner}
    finally:
        db.session.remove()
        shutil.rmtree(staging, ignore_errors=True)
