"""Server-side backup destination and portable PostgreSQL ZIP backup for the NAS.

The backup root is a container mount, not an arbitrary host-directory selector.
Legacy CLI (pg_dump + private.tar.gz) stays supported independently.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path, PurePosixPath
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile

ROOT=Path(__file__).resolve().parent
STORAGE_ROOT=Path(os.environ.get('PHB_BACKUP_ROOT','/app/backup-target' if Path('/app').is_dir() else str(ROOT/'backups')))
SETTINGS=ROOT/'private'/'backup-settings.json'
PREFIX='ProjectHouseBuilder_NAS_'
FORMAT='projecthousebuilder-postgres-backup'
VERSION=1
MAX_ENTRIES=20000
MAX_BYTES=8*1024**3

def _root():
    root=STORAGE_ROOT.expanduser().resolve()
    if not root.is_dir():
        raise ValueError('Backup-Speicher ist nicht eingebunden. Bitte den Docker-Volume-Pfad prüfen.')
    return root

def configure(folder,keep=30):
    if not isinstance(folder,str) or not folder.strip():
        raise ValueError('Bitte einen Zielunterordner angeben.')
    if isinstance(keep,bool) or not isinstance(keep,int) or not 2<=keep<=1000:
        raise ValueError('Aufbewahrung muss zwischen 2 und 1000 liegen.')
    root=_root()
    target=(root/folder).resolve() if not folder.startswith('/') else Path(folder).resolve()
    if not target.is_relative_to(root):
        raise ValueError('Nur Ordner innerhalb des eingebundenen Backup-Bereichs sind erlaubt.')
    if any(part.is_symlink() for part in [target,*target.parents] if part.is_relative_to(root)):
        raise ValueError('Symbolische Links sind als Backup-Ziel nicht erlaubt.')
    target.mkdir(mode=0o700,parents=True,exist_ok=True)
    try:
        with tempfile.NamedTemporaryFile(dir=target,prefix='.write-test-',delete=True):
            pass
    except OSError as exc:
        raise ValueError('Backup-Ordner ist nicht beschreibbar.') from exc
    SETTINGS.parent.mkdir(parents=True,exist_ok=True)
    payload={'folder':str(target.relative_to(root)), 'keep':keep,'version':VERSION}
    with tempfile.NamedTemporaryFile(mode='w',dir=SETTINGS.parent,prefix='.backup-settings-',delete=False,encoding='utf-8') as file:
        json.dump(payload,file,ensure_ascii=False);temp=Path(file.name)
    try:
        temp.chmod(0o600);os.replace(temp,SETTINGS)
    finally:temp.unlink(missing_ok=True)
    return target

def configuration():
    if not SETTINGS.is_file():
        raise ValueError('Backup-Ziel nicht eingerichtet.')
    data=json.loads(SETTINGS.read_text(encoding='utf-8'))
    target=_root()/data['folder']
    resolved=target.resolve()
    if not resolved.is_relative_to(_root()) or not resolved.is_dir() or any(
            part.is_symlink() for part in [target,*target.parents] if part.is_relative_to(_root())):
        raise ValueError('Konfiguriertes Backup-Ziel fehlt oder liegt außerhalb des Speicherbereichs.')
    return {'folder':resolved,'relative_folder':data['folder'],'keep':int(data.get('keep',30))}

def browse(subfolder=''):
    root=_root()
    target=(root/str(subfolder)).resolve()
    if not target.is_relative_to(root):
        raise ValueError('Ordner außerhalb des Backup-Bereichs.')
    if not target.is_dir():raise ValueError('Ordner nicht vorhanden.')
    entries=[{'name':p.name,'path':str(p.relative_to(root))}
             for p in sorted(target.iterdir(),key=lambda x:x.name.lower())
             if p.is_dir() and not p.is_symlink() and not p.name.startswith('.')]
    return {'root':str(root),'current':str(target.relative_to(root)),
            'parent':str(target.parent.relative_to(root)) if target!=root else None,'directories':entries[:300]}

def existing():
    cfg=configuration()
    archives=sorted(cfg['folder'].glob(PREFIX+'*.zip'),reverse=True)
    return [{'filename':a.name,'bytes':a.stat().st_size,
             'modified':datetime.fromtimestamp(a.stat().st_mtime).astimezone().isoformat()}
            for a in archives if a.is_file() and not a.is_symlink()]

def selected_archive(name):
    if not isinstance(name,str) or not re.fullmatch(r'ProjectHouseBuilder_NAS_[0-9_\-]+\.zip',name):
        raise ValueError('Ungültiger Sicherungsname.')
    path=configuration()['folder']/name
    if not path.is_file() or path.is_symlink():raise ValueError('Sicherung nicht im ausgewählten Ordner vorhanden.')
    return path

def _pg_env(engine_url):
    if not engine_url.drivername.startswith('postgresql'):
        raise ValueError('PostgreSQL-Verbindung erforderlich.')
    env=os.environ.copy()
    env.update(PGHOST=str(engine_url.host or 'localhost'),
               PGPORT=str(engine_url.port or 5432),
               PGUSER=str(engine_url.username or ''),
               PGPASSWORD=str(engine_url.password or ''),
               PGDATABASE=str(engine_url.database or ''))
    return env

def _run(command,env,timeout=600):
    try:
        proc=subprocess.run(command,env=env,capture_output=True,text=True,timeout=timeout,check=False)
    except (OSError,subprocess.TimeoutExpired) as exc:
        raise ValueError('PostgreSQL-Werkzeug nicht verfügbar oder Zeitlimit erreicht.') from exc
    if proc.returncode:
        # Do not leak database credentials or command arguments.
        raise ValueError('PostgreSQL-Sicherung/Wiederherstellung fehlgeschlagen. Serverprotokoll prüfen.')

def _hash(path):
    h=hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda:file.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def create(engine_url):
    cfg=configuration()
    directory=cfg['folder']
    timestamp=datetime.now().astimezone().strftime('%Y-%m-%d_%H-%M-%S_%f')
    path=directory/(PREFIX+timestamp+'.zip')
    partial=directory/('.'+path.name+'.partial')
    env=_pg_env(engine_url)
    with tempfile.TemporaryDirectory(prefix='phb-pgbackup-') as td:
        dump=Path(td)/'database.dump'
        _run(['pg_dump','--format=custom','--file',str(dump),'--no-owner','--no-acl'],env)
        sources=[(dump,'database.dump')]
        private=ROOT/'private'
        if private.is_dir():
            for file in sorted(private.rglob('*')):
                if file.is_symlink():raise ValueError('Symbolischer Link in privaten Daten: '+str(file))
                if file.is_file() and not any(part.startswith('.restore-') for part in file.relative_to(private).parts):
                    sources.append((file,file.relative_to(ROOT).as_posix()))
        try:
            manifest={'format':FORMAT,'version':VERSION,
                      'created':datetime.now().astimezone().isoformat(),'files':{}}
            with zipfile.ZipFile(partial,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as archive:
                for file,name in sources:
                    archive.write(file,name)
                    manifest['files'][name]={'sha256':_hash(file),'bytes':file.stat().st_size}
                archive.writestr('backup-manifest.json',json.dumps(manifest,ensure_ascii=False))
            verify(partial)
            os.replace(partial,path)
        finally:partial.unlink(missing_ok=True)
    archives=sorted(directory.glob(PREFIX+'*.zip'),reverse=True)
    for extra in archives[max(2,cfg['keep']):]:
        extra.unlink()
    return path

def verify(path):
    if not path.is_file() or path.is_symlink():raise ValueError('Sicherungsdatei nicht gefunden.')
    with zipfile.ZipFile(path) as archive:
        names=archive.namelist()
        if len(names)!=len(set(names)) or len(names)>MAX_ENTRIES:
            raise ValueError('Doppelte oder zu viele Archiveinträge.')
        if 'backup-manifest.json' not in names:
            raise ValueError('Manifest fehlt.')
        manifest=json.loads(archive.read('backup-manifest.json'))
        if manifest.get('format')!=FORMAT or manifest.get('version')!=VERSION:
            raise ValueError('Unbekanntes Backup-Format.')
        files=manifest.get('files')
        if not isinstance(files,dict) or 'database.dump' not in files or set(names)!=set(files)|{'backup-manifest.json'}:
            raise ValueError('Dateiliste im Backup ist ungültig.')
        total=0
        for name,props in files.items():
            pure=PurePosixPath(name)
            if pure.is_absolute() or '..' in pure.parts or '\\' in name or any(not x for x in pure.parts):
                raise ValueError('Unsicherer Dateipfad im Backup.')
            if name!='database.dump' and not name.startswith('private/'):
                raise ValueError('Nicht erlaubter Eintrag im Backup.')
            info=archive.getinfo(name)
            if info.is_dir() or info.file_size>MAX_BYTES:
                raise ValueError('Unzulässige Datei im Backup.')
            total+=info.file_size
            if total>MAX_BYTES:raise ValueError('Backup überschreitet die erlaubte Gesamtgröße.')
            h=hashlib.sha256();size=0
            with archive.open(info) as src:
                for part in iter(lambda:src.read(1024*1024),b''):
                    h.update(part);size+=len(part)
            if size!=props.get('bytes') or h.hexdigest()!=props.get('sha256'):
                raise ValueError('Prüfsumme falsch: '+name)
        with archive.open('database.dump') as dump_file:
            signature=dump_file.read(5)
        if signature!=b'PGDMP':
            raise ValueError('PostgreSQL-Dump ist nicht im Custom-Format.')
        return manifest

def extract(path,root):
    manifest=verify(path)
    with zipfile.ZipFile(path) as archive:
        for name in manifest['files']:
            target=root.joinpath(*PurePosixPath(name).parts)
            target.parent.mkdir(parents=True,exist_ok=True)
            with archive.open(name) as src,target.open('wb') as dst:
                shutil.copyfileobj(src,dst,1024*1024)
    return manifest

def restore_postgres(path,engine_url,dispose):
    """Stage and validate new DB before controlled swap; retain a rollback database.

    Only the database owner or a DBA with CREATEDB and TERMINATE rights can execute this.
    UI must guard concurrent requests during this operation.
    """
    import psycopg
    cfg=configuration()
    verify(path)
    # Always create a safety backup BEFORE any destructive operation.
    safety=create(engine_url)
    env=_pg_env(engine_url)
    database=env['PGDATABASE']
    if not re.fullmatch(r'[a-zA-Z][a-zA-Z0-9_]*',database):
        raise ValueError('Ungewöhnlicher Datenbankname: Restore über Terminal durchführen.')
    stamp=datetime.now().strftime('%Y%m%d%H%M%S')
    staging=f'phb_restore_{stamp}'
    previous=f'phb_before_{stamp}'
    with tempfile.TemporaryDirectory(prefix='phb-restore-') as td:
        unpack=Path(td)
        extract(path,unpack)
        # Connect to administrative database; never pass passwords as shell arguments.
        admin=dict(host=env['PGHOST'],port=env['PGPORT'],user=env['PGUSER'],
                   password=env['PGPASSWORD'],dbname='postgres',autocommit=True)
        with psycopg.connect(**admin) as maintenance:
            with maintenance.cursor() as cur:
                cur.execute(f'CREATE DATABASE "{staging}"')
            swapped=False
            try:
                environment=dict(env,PGDATABASE=staging)
                _run(['pg_restore','--no-owner','--no-acl','--exit-on-error',
                      '--dbname',staging,str(unpack/'database.dump')],environment,timeout=1200)
                with psycopg.connect(**{**admin,'dbname':staging}) as restored:
                    with restored.cursor() as cur:
                        cur.execute("SELECT to_regclass('public.task')")
                        if cur.fetchone()[0] is None:raise ValueError('Restore enthält keine Arbeitspakete-Tabelle.')
                # No new requests should be allowed from here onwards.
                dispose()
                with maintenance.cursor() as cur:
                    cur.execute('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=%s AND pid<>pg_backend_pid()', (database,))
                    cur.execute(f'ALTER DATABASE "{database}" RENAME TO "{previous}"')
                    try:
                        cur.execute(f'ALTER DATABASE "{staging}" RENAME TO "{database}"')
                        swapped=True
                    except Exception:
                        cur.execute(f'ALTER DATABASE "{previous}" RENAME TO "{database}"')
                        raise
                # Replace only project files; never replace the local backup settings.
                private=ROOT/'private'
                private.mkdir(parents=True,exist_ok=True)
                holding=private/('.restore-safety-'+stamp)
                holding.mkdir()
                moved=[]
                added=[]
                try:
                    current=[p for p in private.iterdir()
                             if p.name not in {holding.name,'backup-settings.json'} and
                             not p.name.startswith('.restore-')]
                    for p in current:
                        p.rename(holding/p.name);moved.append(p.name)
                    incoming=unpack/'private'
                    if incoming.is_dir():
                        for p in incoming.iterdir():
                            if p.name=='backup-settings.json' or p.name.startswith('.restore-'):continue
                            shutil.move(str(p),str(private/p.name));added.append(p.name)
                except Exception:
                    for name in added:
                        obj=private/name
                        if obj.is_dir():shutil.rmtree(obj)
                        else:obj.unlink(missing_ok=True)
                    for name in moved:(holding/name).rename(private/name)
                    with maintenance.cursor() as cur:
                        cur.execute('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=%s AND pid<>pg_backend_pid()',(database,))
                        cur.execute(f'ALTER DATABASE "{database}" RENAME TO "{staging}"')
                        cur.execute(f'ALTER DATABASE "{previous}" RENAME TO "{database}"')
                    raise
                # Keep rollback files until operator confirms the data.
                return {'restored':True,'safety_backup':safety.name,
                        'previous_database':previous,'previous_files':str(holding)}
            finally:
                if not swapped:
                    with maintenance.cursor() as cur:
                        cur.execute(f'DROP DATABASE IF EXISTS "{staging}" WITH (FORCE)')
