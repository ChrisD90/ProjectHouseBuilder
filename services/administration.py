"""Administration services. Dependencies are supplied by the application composition root.

Original entry points stay exported on runtime for CLI integrations and tests.
No imports of app.py and no implicit application context are required.
"""
from types import ModuleType

def register(runtime: ModuleType):
    @runtime.app.get('/api/project-archive.zip')
    def project_archive():
        """Download a complete project backup without requiring a configured server folder."""
        import project_backups
        temporary = runtime.tempfile.TemporaryDirectory(prefix='phb-project-download-')
        try:
            path = project_backups.create(runtime.db, runtime.ROOT, runtime.current_project_id(), {'folder': runtime.Path(temporary.name), 'keep': 2})
            response = runtime.send_file(path, mimetype='application/zip', as_attachment=True, download_name=path.name)
            response.call_on_close(temporary.cleanup)
            return response
        except (ValueError, OSError, runtime.zipfile.BadZipFile) as exc:
            temporary.cleanup()
            return (runtime.jsonify(error='Projektbackup nicht erstellt: ' + str(exc)), 409)

    runtime.project_archive = project_archive

    @runtime.app.get('/daten')
    def data_management_page():
        return runtime.render_template('daten.html')

    runtime.data_management_page = data_management_page

    @runtime.app.post('/api/data/reset')
    def reset_all_project_data():
        """Clear only the selected project after a mandatory verified project backup.

        Keep schema and Alembic history so upgrades continue to work. Never touch
        backup archives or the backup configuration. Only permit calls from localhost.
        """
        if runtime.db.engine.url.get_backend_name() != 'sqlite' or runtime.db.engine.url.database in (None, ':memory:'):
            return (runtime.jsonify(error='Der vollständige Reset ist nur für die lokale SQLite-Version freigeschaltet.'), 409)
        try:
            localhost = runtime.ipaddress.ip_address(runtime.request.remote_addr or '').is_loopback
        except ValueError:
            localhost = False
        origin = runtime.request.headers.get('Origin')
        if not localhost or runtime.request.headers.get('X-PHB-Reset') != '1' or (origin and origin.rstrip('/') != runtime.request.host_url.rstrip('/')):
            return (runtime.jsonify(error='Reset nur über die lokale Datenverwaltung erlaubt.'), 403)
        body = runtime.request.get_json(silent=True)
        if not isinstance(body, dict) or body.get('confirmation') != 'ALLE DATEN LÖSCHEN':
            return (runtime.jsonify(error='Bitte den Bestätigungstext vollständig eingeben.'), 400)
        if not runtime._BACKUP_RESTORE_LOCK.acquire(blocking=False):
            return (runtime.jsonify(error='Es läuft bereits ein Reset oder eine Wiederherstellung.'), 409)
        owner = runtime.current_project_id()
        runtime.set_restore_state({'state': 'resetting', 'project_id': owner, 'message': 'Projekt wird gesichert und zurückgesetzt.', 'result': None})
        try:
            return runtime._reset_current_project()
        finally:
            runtime.set_restore_state({'state': 'idle', 'project_id': owner, 'message': '', 'result': None})
            runtime._BACKUP_RESTORE_LOCK.release()

    runtime.reset_all_project_data = reset_all_project_data

    def _reset_current_project():
        import backup_manager
        if runtime.Path(runtime.db.engine.url.database).resolve() != backup_manager.db_path().resolve():
            return (runtime.jsonify(error='Backup-Datenbank und aktive Datenbank stimmen nicht überein.'), 409)
        try:
            archive = runtime._project_backup_create()
            runtime._verify_project_backup(archive)
        except (ValueError, OSError, runtime.sqlite3.DatabaseError, runtime.zipfile.BadZipFile) as exc:
            return (runtime.jsonify(error='Keine Daten gelöscht: Projektbackup fehlgeschlagen: ' + str(exc)), 409)
        if runtime.db.session.scalar(runtime.select(runtime.ImportJob.id).where(runtime.ImportJob.status.in_(['Wartend', 'Läuft'])).limit(1)):
            return (runtime.jsonify(error='Bitte laufende Projekt-Uploads vor dem Zurücksetzen abwarten.'), 409)
        private = runtime.ROOT / 'private'
        quarantine = runtime.ROOT / ('.reset-quarantine-' + runtime.uuid4().hex)
        try:
            quarantine.mkdir(parents=True, exist_ok=False)
            for path in runtime.project_files(runtime.db, runtime.ROOT):
                if path.is_symlink():
                    raise ValueError('Unsicherer Dateilink im Projekt.')
                destination = quarantine / path.relative_to(private)
                destination.parent.mkdir(parents=True, exist_ok=True)
                path.replace(destination)
            import project_backups
            project_backups.clear_rows(runtime.db.session.connection(), runtime.db, runtime.current_project_id())
            runtime.db.session.add(runtime.Setting(key='start', value='2027-03-01'))
            runtime.db.session.add(runtime.Setting(key='initial_budget', value='0'))
            runtime.db.session.add(runtime.Setting(key='project_initialized', value='1'))
            for idx, name in enumerate(runtime.CATEGORIES):
                runtime.db.session.add(runtime.Category(name=name, sort_order=idx))
            runtime.db.session.commit()
        except Exception:
            runtime.db.session.rollback()
            if quarantine.exists():
                for path in quarantine.rglob('*'):
                    if path.is_file():
                        destination = private / path.relative_to(quarantine)
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        path.replace(destination)
                runtime.shutil.rmtree(quarantine)
            runtime.app.logger.exception('Projekt-Reset abgebrochen. Backup: %s', archive)
            return (runtime.jsonify(error='Reset fehlgeschlagen. Der Datenbankvorgang wurde zurückgenommen. Backup: ' + str(archive)), 500)
        warning = None
        if quarantine.exists():
            try:
                runtime.shutil.rmtree(quarantine)
            except OSError:
                warning = 'Die Daten sind zurückgesetzt. Alte Dateien konnten nicht bereinigt werden: ' + str(quarantine)
        return runtime.jsonify(ok=True, backup=str(archive), warning=warning)

    runtime._reset_current_project = _reset_current_project

    @runtime.app.errorhandler(500)
    def server_error(err):
        runtime.db.session.rollback()
        return (runtime.jsonify(error='Interner Fehler: Bitte Serverkonsole prüfen.'), 500)

    runtime.server_error = server_error

    def _backup_pg():
        return not runtime.DATABASE_URL.startswith('sqlite:')

    runtime._backup_pg = _backup_pg

    def _backup_config():
        if runtime._backup_pg():
            import server_backups
            return server_backups.configuration()
        import backup_manager
        cfg = backup_manager.load_config()
        return {'folder': cfg['folder'], 'keep': cfg['keep'], 'relative_folder': str(cfg['folder'])}

    runtime._backup_config = _backup_config

    def _backup_archive_by_name(name, owner=None):
        import project_backups
        return project_backups.selected(runtime._backup_config(), runtime.current_project_id() if owner is None else owner, name)

    runtime._backup_archive_by_name = _backup_archive_by_name

    def _project_backup_create():
        import project_backups
        return project_backups.create(runtime.db, runtime.ROOT, runtime.current_project_id(), runtime._backup_config())

    runtime._project_backup_create = _project_backup_create

    def _verify_project_backup(path, owner=None):
        import project_backups
        return project_backups.verify(path, runtime.current_project_id() if owner is None else owner)

    runtime._verify_project_backup = _verify_project_backup

    def _verify_selected_backup(path):
        if runtime._backup_pg():
            import server_backups
            return server_backups.verify(path)
        import backup_manager
        return backup_manager.verify_backup(path)

    runtime._verify_selected_backup = _verify_selected_backup

    def _backup_create():
        if runtime._backup_pg():
            import server_backups
            return server_backups.create(runtime.db.engine.url)
        import backup_manager
        return backup_manager.make_backup()

    runtime._backup_create = _backup_create

    def _backup_before_project_upgrade():
        """A first NAS upgrade must also work before the user has saved backup settings."""
        if runtime._backup_pg():
            import server_backups
            if server_backups.SETTINGS.is_file():
                archive = runtime._backup_create()
            else:
                folder = server_backups._root() / 'migration-safety'
                if folder.is_symlink():
                    raise ValueError('Sicherheitsbackup-Ziel darf kein Symlink sein.')
                folder.mkdir(mode=448, exist_ok=True)
                archive = server_backups.create(runtime.db.engine.url, folder=folder)
        else:
            import backup_manager
            if backup_manager.CONFIG_PATH.is_file():
                archive = runtime._backup_create()
            else:
                folder = runtime.Path.home() / '.local' / 'share' / 'ProjectHouseBuilder' / 'migration-backups'
                if folder.is_symlink():
                    raise ValueError('Sicherheitsbackup-Ziel darf kein Symlink sein.')
                folder.mkdir(mode=448, parents=True, exist_ok=True)
                archive = backup_manager.make_backup(folder=folder)
        runtime._verify_selected_backup(archive)
        runtime.app.logger.warning('Geprüftes Sicherheitsbackup vor Projektmigration: %s', archive)
        return archive

    runtime._backup_before_project_upgrade = _backup_before_project_upgrade

    @runtime.app.get('/api/ocr/status')
    def ocr_status():
        from receipt_parser import ocr_diagnostics
        return runtime.jsonify(ocr_diagnostics())

    runtime.ocr_status = ocr_status

    @runtime.app.get('/api/backup/status')
    def backup_status():
        try:
            cfg = runtime._backup_config()
            import project_backups
            entries = project_backups.existing(cfg, runtime.current_project_id())
            root = None
            if runtime._backup_pg():
                import server_backups
                root = str(server_backups._root())
            return runtime.jsonify(configured=True, backend='postgres' if runtime._backup_pg() else 'sqlite', folder=str(project_backups.folder(cfg, runtime.current_project_id())), relative_folder=cfg['relative_folder'], scope='project', project_id=runtime.current_project_id(), project_title=runtime.db.session.get(runtime.Project, runtime.current_project_id()).title, storage_root=root, keep=cfg['keep'], count=len(entries), latest=entries[0]['filename'] if entries else None, backups=entries)
        except (ValueError, OSError, KeyError, runtime.JSONDecodeError) as exc:
            return runtime.jsonify(configured=False, backend='postgres' if runtime._backup_pg() else 'sqlite', error=str(exc), backups=[])

    runtime.backup_status = backup_status

    @runtime.app.post('/api/backup/native-folder')
    def backup_native_folder():
        """Use macOS's native Choose Folder panel only on a directly local Mac.

        A web browser cannot reveal a NAS server directory selected on the client.
        """
        import sys
        import subprocess
        if runtime._backup_pg():
            return (runtime.jsonify(error='Auf der Synology ist keine lokale macOS-Ordnerauswahl verfügbar. Bitte den NAS-Ordnerbrowser verwenden.'), 409)
        peer = runtime.request.environ.get('werkzeug.proxy_fix.orig', {}).get('REMOTE_ADDR', runtime.request.remote_addr)
        if sys.platform != 'darwin' or peer not in ('127.0.0.1', '::1') or runtime.request.host.split(':', 1)[0] not in ('127.0.0.1', 'localhost'):
            return (runtime.jsonify(error='Der System-Ordnerdialog ist nur auf dem lokalen Mac verfügbar.'), 409)
        script = 'POSIX path of (choose folder with prompt "Backup-Ziel für ProjectHouseBuilder auswählen")'
        try:
            result = subprocess.run(['osascript', '-e', script], capture_output=True, text=True, timeout=90, check=False)
        except (OSError, subprocess.TimeoutExpired):
            return (runtime.jsonify(error='Der System-Ordnerdialog konnte nicht geöffnet werden.'), 409)
        if result.returncode:
            return (runtime.jsonify(error='Ordnerauswahl abgebrochen oder Systemdialog nicht verfügbar.'), 409)
        folder = result.stdout.strip()
        if not folder or not runtime.Path(folder).is_dir():
            return (runtime.jsonify(error='Ungültiger Ordner.'), 400)
        return runtime.jsonify(folder=folder)

    runtime.backup_native_folder = backup_native_folder

    @runtime.app.get('/api/backup/folders')
    def backup_folders():
        if not runtime._backup_pg():
            return (runtime.jsonify(error='Auf dem Mac den vollständigen lokalen Ordnerpfad eingeben.'), 409)
        import server_backups
        try:
            return runtime.jsonify(server_backups.browse(runtime.request.args.get('folder', '')))
        except (ValueError, OSError) as exc:
            return (runtime.jsonify(error=str(exc)), 400)

    runtime.backup_folders = backup_folders

    @runtime.app.post('/api/backup/configure')
    def backup_configure():
        body = runtime.request.get_json(silent=True) or {}
        try:
            folder = body.get('folder', '')
            keep = int(body.get('keep', 30))
            if runtime._backup_pg():
                import server_backups
                target = server_backups.configure(folder, keep)
            else:
                import backup_manager
                target = backup_manager.configure(folder, keep)
            return runtime.jsonify(ok=True, folder=str(target))
        except (ValueError, OSError, TypeError) as exc:
            return (runtime.jsonify(error='Backupziel nicht gespeichert: ' + str(exc)), 400)

    runtime.backup_configure = backup_configure

    @runtime.app.post('/api/backup/create')
    def create_manual_backup():
        if runtime._BACKUP_RESTORE_LOCK.locked():
            return (runtime.jsonify(error='Wiederherstellung läuft. Keine Sicherung möglich.'), 409)
        try:
            path = runtime._project_backup_create()
            return (runtime.jsonify(ok=True, scope='project', project_id=runtime.current_project_id(), filename=path.name, verified=True, bytes=path.stat().st_size), 201)
        except (ValueError, OSError, runtime.sqlite3.DatabaseError, runtime.zipfile.BadZipFile) as exc:
            return (runtime.jsonify(error='Backup nicht erstellt: ' + str(exc)), 409)

    runtime.create_manual_backup = create_manual_backup

    @runtime.app.post('/api/backup/inspect')
    def backup_inspect():
        try:
            if 'file' in runtime.request.files:
                upload = runtime.request.files['file']
                if not (upload.filename or '').lower().endswith('.zip'):
                    raise ValueError('Bitte ein ZIP-Backup auswählen.')
                runtime._BACKUP_RESTORE_UPLOADS.mkdir(mode=448, parents=True, exist_ok=True)
                if runtime._BACKUP_RESTORE_UPLOADS.is_symlink():
                    raise ValueError('Unsicherer Upload-Zielpfad.')
                runtime._BACKUP_RESTORE_UPLOADS.chmod(448)
                for old in runtime._BACKUP_RESTORE_UPLOADS.glob('*.zip'):
                    if old.is_file() and (not old.is_symlink()) and (runtime.time.time() - old.stat().st_mtime > 86400):
                        old.unlink(missing_ok=True)
                key = runtime.secrets.token_hex(16)
                archive = runtime._BACKUP_RESTORE_UPLOADS / (key + '.zip')
                try:
                    with archive.open('xb') as output:
                        size = 0
                        while True:
                            block = upload.stream.read(1024 * 1024)
                            if not block:
                                break
                            size += len(block)
                            if size > 1024 ** 3:
                                raise ValueError('Maximal 1 GB Uploadgröße.')
                            output.write(block)
                    manifest = runtime._verify_project_backup(archive)
                except Exception:
                    archive.unlink(missing_ok=True)
                    raise
                return runtime.jsonify(ok=True, ref='upload:' + key, created=manifest.get('created'), files=len(manifest.get('files', {})), verified=True, project_id=runtime.current_project_id(), project_title=manifest.get('project_title'), scope='project')
            body = runtime.request.get_json(silent=True) or {}
            archive = runtime._backup_archive_by_name(body.get('filename', ''))
            manifest = runtime._verify_project_backup(archive)
            return runtime.jsonify(ok=True, ref='stored:' + archive.name, created=manifest.get('created'), files=len(manifest.get('files', {})), verified=True, project_id=runtime.current_project_id(), project_title=manifest.get('project_title'), scope='project')
        except (ValueError, OSError, runtime.zipfile.BadZipFile, KeyError) as exc:
            return (runtime.jsonify(error='Sicherung nicht bestätigt: ' + str(exc)), 400)

    runtime.backup_inspect = backup_inspect

    def _restore_archive(ref, owner=None):
        if isinstance(ref, str) and ref.startswith('stored:'):
            return runtime._backup_archive_by_name(ref[7:], owner)
        if isinstance(ref, str) and ref.startswith('upload:'):
            import re
            key = ref[7:]
            if re.fullmatch('[a-f0-9]{32}', key):
                archive = runtime._BACKUP_RESTORE_UPLOADS / (key + '.zip')
                if archive.is_file() and (not archive.is_symlink()):
                    return archive
        raise ValueError('Bitte zuerst ein Backup prüfen.')

    runtime._restore_archive = _restore_archive

    def _run_restore(ref, owner):
        try:
            with runtime.app.app_context(), runtime.project_context(owner):
                import project_backups
                archive = runtime._restore_archive(ref, owner)
                with runtime.tempfile.TemporaryDirectory(prefix='phb-project-restore-source-') as temporary:
                    staged = runtime.Path(temporary) / 'project.zip'
                    runtime.shutil.copy2(archive, staged)
                    project_backups.load_rows(staged, runtime.db, owner)
                    safety = runtime._project_backup_create()
                    outcome = project_backups.restore(staged, runtime.db, runtime.ROOT, owner)
                    outcome['safety_backup'] = safety.name
            runtime.set_restore_state({'state': 'done', 'project_id': owner, 'message': 'Projekt wiederhergestellt. Andere Projekte bleiben unverändert.', 'result': outcome})
        except Exception:
            runtime.app.logger.exception('Projektwiederherstellung fehlgeschlagen.')
            runtime.set_restore_state({'state': 'failed', 'project_id': owner, 'message': 'Projektwiederherstellung fehlgeschlagen. Änderungen wurden zurückgenommen; Serverprotokoll enthält Details.', 'result': None})
        finally:
            if isinstance(ref, str) and ref.startswith('upload:'):
                try:
                    runtime._restore_archive(ref, owner).unlink(missing_ok=True)
                except Exception:
                    pass
            runtime._BACKUP_RESTORE_LOCK.release()

    runtime._run_restore = _run_restore

    @runtime.app.post('/api/backup/restore')
    def backup_restore_start():
        body = runtime.request.get_json(silent=True) or {}
        if body.get('confirmation') != 'BACKUP WIEDERHERSTELLEN':
            return (runtime.jsonify(error='Zur Bestätigung BACKUP WIEDERHERSTELLEN eingeben.'), 400)
        try:
            archive = runtime._restore_archive(body.get('ref', ''))
            runtime._verify_project_backup(archive)
            runtime._backup_config()
        except (ValueError, OSError, KeyError, runtime.zipfile.BadZipFile) as exc:
            return (runtime.jsonify(error='Keine Wiederherstellung gestartet: ' + str(exc)), 409)
        if runtime.db.session.scalar(runtime.select(runtime.ImportJob.id).where(runtime.ImportJob.status.in_(('Wartend', 'Läuft'))).limit(1)):
            return (runtime.jsonify(error='Es laufen noch Dokumentenimporte. Bitte zuerst abschließen und danach wiederherstellen.'), 409)
        if not runtime._BACKUP_RESTORE_LOCK.acquire(blocking=False):
            return (runtime.jsonify(error='Es läuft bereits eine Wiederherstellung.'), 409)
        runtime.set_restore_state({'state': 'running', 'project_id': runtime.current_project_id(), 'message': 'Sicherheitsbackup, Prüfung und Wiederherstellung laufen.', 'result': None})
        try:
            runtime.Thread(target=runtime._run_restore, args=(body['ref'], runtime.current_project_id()), daemon=True, name='phb-restore').start()
        except Exception:
            runtime._BACKUP_RESTORE_LOCK.release()
            runtime.set_restore_state(dict(state='failed',project_id=runtime.current_project_id(),message='Wiederherstellung konnte nicht gestartet werden.',result=None))
            return runtime.jsonify(error='Wiederherstellung konnte nicht gestartet werden. Keine Änderungen vorgenommen.'),500
        return (runtime.jsonify(started=True), 202)

    runtime.backup_restore_start = backup_restore_start

    @runtime.app.get('/api/backup/restore/status')
    def backup_restore_status():
        if runtime.get_restore_state().get('project_id') != runtime.current_project_id():
            return runtime.jsonify(state='idle', project_id=runtime.current_project_id(), message='', result=None)
        return runtime.jsonify(runtime.get_restore_state())

    runtime.backup_restore_status = backup_restore_status
