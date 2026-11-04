"""Local, versioned SQLite + document backups for ProjectHouseBuilder.

All backups use SQLite's online backup API (safe against a concurrent DB writer).
The live SQLite file must never be placed in a file-sync directory.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = Path.home() / 'Library' / 'Application Support' / 'ProjectHouseBuilder' / 'backup-config.json'
PREFIX = 'ProjectHouseBuilder_Backup_'
VERSION = 1


def db_path() -> Path:
    url = os.environ.get('DATABASE_URL', '')
    if url and not url.startswith('sqlite:'):
        raise ValueError('Nur SQLite wird unterstützt. Für PostgreSQL bitte pg_dump nutzen.')
    if url and not url.startswith('sqlite:///' ):
        raise ValueError('SQLite-URL muss einen absoluten Dateipfad verwenden.')
    return Path(url.removeprefix('sqlite:///')) if url else ROOT / 'sanierung.db'


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        raise ValueError('Backup-Ziel nicht konfiguriert. Zuerst: python3 backup_manager.py configure --folder /PFAD')
    data = json.loads(CONFIG_PATH.read_text(encoding='utf-8'))
    p = Path(data['folder']).expanduser()
    if not p.is_dir():
        raise ValueError(f'Backup-Ziel nicht erreichbar: {p}. Kein Ersatzordner verwendet.')
    return {**data, 'folder': p}


def configure(folder: str, keep: int = 30) -> Path:
    p = Path(folder).expanduser().resolve()
    if not p.is_dir():
        raise ValueError(f'Ordner existiert nicht: {p}')
    if p == ROOT or ROOT in p.parents:
        raise ValueError('Backup-Ordner darf nicht im Quellprojekt liegen.')
    if keep < 2 or keep > 1000:
        raise ValueError('keep muss zwischen 2 und 1000 liegen.')
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {'folder': str(p), 'keep': keep, 'version': VERSION}
    tmp = CONFIG_PATH.with_suffix('.tmp')
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')
    os.chmod(tmp, 0o600)
    os.replace(tmp, CONFIG_PATH)
    return p


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source_files():
    private = ROOT / 'private'
    if private.exists():
        for file in sorted(private.rglob('*')):
            if file.is_symlink():
                raise ValueError(f'Symlinks werden nicht gesichert: {file}')
            if file.is_file():
                yield file, file.relative_to(ROOT).as_posix()


def make_backup(folder: Path | None = None, *, keep: int | None = None) -> Path:
    config = load_config() if folder is None else {'folder': folder, 'keep': 30}
    target_dir = config['folder']
    if not target_dir.is_dir():
        raise ValueError('Backup-Ziel ist nicht verfügbar. Sicherung abgebrochen.')
    keep = config['keep'] if keep is None else keep
    source = db_path()
    if not source.is_file():
        raise ValueError(f'Keine SQLite-Datenbank gefunden: {source}; Projekt einmal starten.')
    now = datetime.now().astimezone()
    stamp = now.strftime('%Y-%m-%d_%H-%M-%S_%f')
    dest = target_dir / (PREFIX + stamp + '.zip')
    partial = target_dir / ('.' + dest.name + '.partial')
    with tempfile.TemporaryDirectory(prefix='phb-snapshot-') as td:
        snapshot = Path(td) / 'sanierung.db'
        with sqlite3.connect(f'file:{source}?mode=ro', uri=True, timeout=20) as s, sqlite3.connect(snapshot) as d:
            s.backup(d, pages=200, sleep=0.1)
        with sqlite3.connect(snapshot) as db:
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Datenbankintegritätsprüfung fehlgeschlagen.')
        files = [(snapshot, 'sanierung.db'), *source_files()]
        entries = {}
        try:
            with zipfile.ZipFile(partial, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
                for path, rel in files:
                    raw = path.read_bytes()
                    z.writestr(rel, raw)
                    entries[rel] = {'sha256': digest(raw), 'bytes': len(raw)}
                manifest = {'format': 'projecthousebuilder-sqlite-backup', 'version': VERSION,
                            'created': now.isoformat(), 'files': entries}
                z.writestr('backup-manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
            verify_backup(partial)
            os.replace(partial, dest)
        finally:
            partial.unlink(missing_ok=True)
    backups = sorted(target_dir.glob(PREFIX + '*.zip'), reverse=True)
    for old in backups[max(2, keep):]:
        old.unlink()
    return dest


def verify_backup(archive: Path) -> dict:
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None:
            raise ValueError('Beschädigtes ZIP-Archiv.')
        manifest = json.loads(z.read('backup-manifest.json'))
        if manifest.get('format') != 'projecthousebuilder-sqlite-backup' or manifest.get('version') != VERSION:
            raise ValueError('Unbekanntes Sicherungsformat.')
        entries = manifest.get('files', {})
        if not isinstance(entries, dict) or 'sanierung.db' not in entries:
            raise ValueError('Datenbank fehlt im Sicherungsarchiv.')
        if set(z.namelist()) != set(entries) | {'backup-manifest.json'}:
            raise ValueError('Unerwartete Dateien im Archiv.')
        for name, props in entries.items():
            path = PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts or '\\' in name:
                raise ValueError('Unsicherer Archiv-Dateipfad.')
            if name != 'sanierung.db' and not (name.startswith('private/') or name == 'data/initial_budget.json'):
                raise ValueError(f'Unzulässiger Eintrag: {name}')
            raw = z.read(name)
            if len(raw) != props['bytes'] or digest(raw) != props['sha256']:
                raise ValueError(f'Prüfsumme falsch: {name}')
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / 'check.db'
            path.write_bytes(z.read('sanierung.db'))
            with sqlite3.connect(path) as db:
                if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise ValueError('Datenbank im Archiv beschädigt.')
        return manifest


def restore(archive: Path, *, yes: bool = False):
    if not yes:
        raise ValueError('Wiederherstellung erfordert --yes. ProjectHouseBuilder zuvor beenden.')
    manifest = verify_backup(archive)
    source = db_path()
    if source.exists():
        try:
            with sqlite3.connect(f'file:{source}?mode=rw', uri=True, timeout=0) as con:
                con.execute('BEGIN EXCLUSIVE')
                con.rollback()
        except sqlite3.OperationalError as ex:
            raise ValueError('SQLite-Datenbank ist gesperrt. Anwendung beenden.') from ex
    if (ROOT / '.private-prerestore').exists():
        raise ValueError('Vorherige Wiederherstellung nicht abgeschlossen (.private-prerestore).')
    rollback = ROOT / ('restore-safety-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    rollback.mkdir(parents=True, exist_ok=False)
    # Copy old project state before touching the files. Keep it until user verifies recovery.
    if source.exists():
        with sqlite3.connect(f'file:{source}?mode=ro', uri=True) as old, sqlite3.connect(rollback / 'sanierung.db') as target:
            old.backup(target)
    if (ROOT / 'private').exists():
        shutil.copytree(ROOT / 'private', rollback / 'private')
    with tempfile.TemporaryDirectory(prefix='phb-restore-') as td:
        staging = Path(td)
        with zipfile.ZipFile(archive) as z:
            for name in manifest['files']:
                output = staging.joinpath(*PurePosixPath(name).parts)
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(z.read(name))
        # Swap directories/files only after all files are staged and verified.
        source.parent.mkdir(parents=True, exist_ok=True)
        tmp_db = source.with_suffix('.restoring')
        shutil.copy2(staging / 'sanierung.db', tmp_db)
        os.replace(tmp_db, source)
        for extra in (source.with_name(source.name+'-wal'), source.with_name(source.name+'-shm')):
            extra.unlink(missing_ok=True)
        private = ROOT / 'private'
        old_private = ROOT / '.private-prerestore'
        if private.exists():
            private.rename(old_private)
        if (staging / 'private').exists():
            shutil.copytree(staging / 'private', private)
        else:
            private.mkdir(parents=True, exist_ok=True)
        if old_private.exists():
            shutil.rmtree(old_private)
    return rollback


def main(argv=None):
    p = argparse.ArgumentParser(description='ProjectHouseBuilder SQLite Datensicherung')
    sub = p.add_subparsers(dest='action', required=True)
    cfg = sub.add_parser('configure', help='Backup-Ziel festlegen')
    cfg.add_argument('--folder', required=True)
    cfg.add_argument('--keep', type=int, default=30)
    sub.add_parser('backup', help='Backup erstellen')
    sub.add_parser('show', help='Backup-Konfiguration anzeigen')
    v = sub.add_parser('verify', help='ZIP-Sicherung prüfen')
    v.add_argument('archive', type=Path)
    r = sub.add_parser('restore', help='Backup wiederherstellen; App vorher beenden')
    r.add_argument('archive', type=Path)
    r.add_argument('--yes', action='store_true')
    args = p.parse_args(argv)
    try:
        if args.action == 'configure':
            print('Backup-Ziel:', configure(args.folder, args.keep))
        elif args.action == 'backup':
            print('Backup erstellt:', make_backup())
        elif args.action == 'show':
            print(json.dumps({k: str(v) for k,v in load_config().items()}, ensure_ascii=False, indent=2))
        elif args.action == 'verify':
            info = verify_backup(args.archive)
            print('Backup gültig:', len(info['files']), 'Dateien von', info['created'])
        elif args.action == 'restore':
            print('Wiederhergestellt. Alter Stand gesichert unter:', restore(args.archive, yes=args.yes))
    except (ValueError, OSError, zipfile.BadZipFile, sqlite3.Error) as ex:
        print('FEHLER:', ex, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
