"""Fail-closed schema upgrades with verified pre-migration backup.

Migrations are run before the Flask application starts. Never point the active
SQLite database at cloud sync storage, and never run concurrent app processes
while upgrading.
"""
from __future__ import annotations
import argparse
import os
from pathlib import Path
import sqlite3
import sys
from sqlalchemy.engine.url import make_url
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.runtime.migration import MigrationContext
import backup_manager

ROOT = Path(__file__).resolve().parent


def alembic_config(database_url: str) -> Config:
    cfg = Config(str(ROOT / 'alembic.ini'))
    cfg.set_main_option('sqlalchemy.url', database_url.replace('%', '%%'))
    return cfg


def upgrade_database(*, backup_function=None) -> dict:
    """Upgrade only SQLite; call backup first if an existing DB needs revisions."""
    database_url = os.environ.get('DATABASE_URL', 'sqlite:///' + str(ROOT / 'sanierung.db'))
    url = make_url(database_url)
    if url.drivername != 'sqlite' or url.database in (None, '', ':memory:'):
        raise ValueError('Der Mac-Migrationsstarter unterstützt ausschließlich dateibasierte SQLite-Datenbanken.')
    path = Path(url.database).expanduser().resolve()
    if backup_function is None:
        backup_function = backup_manager.make_backup
    cfg = alembic_config(database_url)
    script = ScriptDirectory.from_config(cfg)
    expected = script.get_current_head()
    if not expected:
        raise RuntimeError('Keine Migrationen im Repository gefunden.')
    existing = path.exists() and path.stat().st_size > 0
    if existing:
        with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as db:
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('SQLite-Integritätsprüfung fehlgeschlagen; kein Upgrade.')
            revisions = {r[0] for r in db.execute('SELECT name FROM sqlite_master WHERE type="table"')}
            if 'alembic_version' in revisions:
                current = db.execute('SELECT version_num FROM alembic_version').fetchone()
                revision = current[0] if current else None
            else:
                revision = None
        if revision == expected:
            return {'status': 'current', 'revision': revision, 'backup': None}
        # Ensure revision is known (also guards accidental checkout of older code).
        if revision is not None and script.get_revision(revision) is None:
            raise RuntimeError(f'Unbekannte Datenbankversion {revision}. Bitte passenden Programmstand verwenden.')
        if revision is not None and revision != expected:
            # Full ancestry check rather than allowing downgrades or divergent branches.
            predecessors = {r.revision for r in script.walk_revisions(base='base', head=expected)}
            if revision not in predecessors:
                raise RuntimeError('Die Datenbank ist neuer oder hat eine andere Migrationshistorie.')
        # A backup is compulsory BEFORE touching an existing database.
        archive = backup_function()
        backup_manager.verify_backup(Path(archive))
    else:
        archive = None
        path.parent.mkdir(parents=True, exist_ok=True)
    try:
        command.upgrade(cfg, 'head')
    except Exception as exc:
        raise RuntimeError('Migration fehlgeschlagen. Der Start wurde abgebrochen. '\
                           f'Backup: {archive or "(neue leere Datenbank)"}. '
                           'Vor Wiederherstellung Anwendung schließen.') from exc
    return {'status': 'upgraded', 'revision': expected, 'backup': str(archive) if archive else None}


def main(argv=None):
    parser = argparse.ArgumentParser(description='ProjectHouseBuilder SQLite-Migrationsstarter')
    parser.add_argument('--check', action='store_true', help='Schema ohne Migration prüfen')
    args = parser.parse_args(argv)
    if args.check:
        # Same verification as upgrade, but never changes DB; intentionally separate.
        url = make_url(os.environ.get('DATABASE_URL', 'sqlite:///' + str(ROOT / 'sanierung.db')))
        if url.drivername != 'sqlite' or not url.database:
            parser.error('Nur dateibasierte SQLite unterstützt')
        p = Path(url.database)
        if not p.exists():
            print('Datenbank noch nicht vorhanden')
            return 0
        with sqlite3.connect(p) as db:
            rows = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='alembic_version'").fetchall()
            rev = db.execute('SELECT version_num FROM alembic_version').fetchone()[0] if rows else '(Altbestand)'
            print('SQLite-Version:', rev, 'Integrität:', db.execute('PRAGMA integrity_check').fetchone()[0])
        return 0
    try:
        print(upgrade_database())
    except Exception as ex:
        print('Schema-Update abgebrochen:', ex, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
