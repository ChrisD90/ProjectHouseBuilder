"""Local Windows entry point. Importing this module never opens a GUI or database."""
import argparse
import json
import logging
import os
from pathlib import Path
import secrets
import sys
import tempfile
import threading
from urllib.parse import urlencode, urlsplit


def configure(home):
    home = Path(home).resolve()
    for name in ('data', 'auth', 'logs', 'backups', 'webview'):
        (home / name).mkdir(parents=True, exist_ok=True)
    os.environ.update(PHB_APP_ROOT=str(home / 'data'),
        DATABASE_URL='sqlite:///' + (home / 'data' / 'sanierung.db').as_posix(),
        PHB_CHATGPT_HOME=str(home / 'auth'), PHB_BACKUP_CONFIG=str(home / 'backup-config.json'),
        PHB_BACKUP_ROOT=str(home / 'backups'), APP_PASSWORD='', PHB_UI='react', SECURE_COOKIES='0')
    bundle = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
    ocr = bundle / 'ocr' / 'Library'
    if ocr.exists():
        os.environ['PATH'] = str(ocr / 'bin') + os.pathsep + os.environ.get('PATH', '')
        os.environ['TESSDATA_PREFIX'] = str(ocr / 'share' / 'tessdata')
    logging.basicConfig(filename=home / 'logs' / 'desktop.log', encoding='utf-8',
                        level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s', force=True)
    logging.getLogger('werkzeug').setLevel(logging.ERROR)
    return home


def safe_next(value):
    value = value or '/'
    parsed = urlsplit(value)
    if not value.startswith('/') or value.startswith('//') or parsed.netloc or parsed.scheme or any(c in value for c in '\\\r\n'):
        return '/'
    return value


def install_desktop_guard(app, token):
    """A random per-launch cookie protects the loopback API from other websites."""
    from flask import abort, make_response, redirect, request
    cookie = 'phb_desktop'

    @app.before_request
    def desktop_access():
        if request.host.split(':')[0] != '127.0.0.1' or request.remote_addr != '127.0.0.1':
            abort(403)
        if request.path == '/_desktop/bootstrap':
            if not secrets.compare_digest(request.args.get('token', ''), token):
                abort(403)
            response = make_response(redirect(safe_next(request.args.get('next'))))
            response.set_cookie(cookie, token, httponly=True, samesite='Lax')
            response.headers['Cache-Control'] = 'no-store'
            response.headers['Referrer-Policy'] = 'no-referrer'
            return response
        if not secrets.compare_digest(request.cookies.get(cookie, ''), token):
            abort(403)
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            origin = request.headers.get('Origin')
            if origin and origin != request.host_url.rstrip('/'):
                abort(403)

    # Run before the existing React routing hook, which can itself return a page.
    hooks = app.before_request_funcs[None]
    hooks.insert(0, hooks.pop())

    @app.get('/_desktop/links.js')
    def desktop_links():
        # pywebview opens target=_blank links in the system browser. Bootstrap that
        # browser's local session before showing the original PDF or a ZIP export.
        bootstrap = '/_desktop/bootstrap?' + urlencode({'token': token}) + '&next='
        script = """(()=>{
          const local=value=>{const u=new URL(value,location.href);if(u.pathname==='/_desktop/bootstrap')return u.href;return u.origin===location.origin?
            %s+encodeURIComponent(u.pathname+u.search+u.hash):u.href;};
          document.addEventListener('click',e=>{const a=e.target.closest('a[target="_blank"]');
            if(a)a.href=local(a.href);},true);
          const open=window.open.bind(window);window.open=(url,...args)=>open(url?local(url):url,...args);
        })();""" % json.dumps(bootstrap)
        response = make_response(script)
        response.mimetype = 'text/javascript'
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.after_request
    def desktop_html(response):
        response.headers['Referrer-Policy'] = 'no-referrer'
        if response.mimetype == 'text/html' and response.status_code == 200:
            response.direct_passthrough = False
            response.set_data(response.get_data().replace(b'</body>', b'<script src="/_desktop/links.js"></script></body>'))
        return response


def prepare(home):
    import backup_manager
    if not backup_manager.CONFIG_PATH.exists():
        backup_manager.configure(str(home / 'backups'))
    from schema_manager import upgrade_database
    migration = upgrade_database()
    import app as backend
    with backend.app.app_context():
        backend.initialize()
        backend._ensure_import_recovery()
    return backend, migration


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--smoke-test', action='store_true')
    parser.add_argument('--smoke-output', type=Path)
    args = parser.parse_args(argv)
    temporary = tempfile.TemporaryDirectory(prefix='phb-desktop-smoke-') if args.smoke_test else None
    home = configure(temporary.name if temporary else Path(os.environ['LOCALAPPDATA']) / 'ProjectHouseBuilder')
    from process_lock import ProcessLock
    instance = ProcessLock(lambda: home / '.desktop.lock')
    server = None
    try:
        if not instance.acquire(blocking=False):
            raise RuntimeError('Die Anwendung läuft bereits. Bitte das vorhandene Fenster verwenden.')
        backend, migration = prepare(home)
        from ocr_runtime import ocr_diagnostics
        ocr = ocr_diagnostics()
        if not ocr['ready']:
            raise RuntimeError('Mitgelieferte OCR ist nicht einsatzbereit: ' + ocr['reason'])
        token = secrets.token_urlsafe(32)
        install_desktop_guard(backend.app, token)
        if args.smoke_test:
            client = backend.app.test_client()
            assert client.get('/', base_url='http://127.0.0.1').status_code == 403
            assert client.get('/_desktop/bootstrap?token=' + token, base_url='http://127.0.0.1').status_code == 302
            assert client.get('/', base_url='http://127.0.0.1').status_code == 200
            assert client.get('/api/projects', base_url='http://127.0.0.1').status_code == 200
            assert b'/_desktop/links.js' in client.get('/', base_url='http://127.0.0.1').data
            from PIL import Image, ImageDraw, ImageFont
            from receipt_parser import extract_text
            import io
            image = Image.new('RGB', (1400, 400), 'white')
            ImageDraw.Draw(image).text((70,100), 'WINDOWS OCR 12345', font=ImageFont.load_default(size=56), fill='black')
            pdf = io.BytesIO();image.save(pdf, format='PDF', resolution=150)
            text, mode = extract_text(pdf.getvalue(), 'windows-test.pdf')
            assert mode == 'OCR (PDF)' and 'WINDOWS' in text and '12345' in text, text
            result = {'ok': True, 'ocr': ocr, 'scanned_pdf':True, 'migration': migration['status']}
            if args.smoke_output:args.smoke_output.write_text(json.dumps(result), encoding='utf-8')
            return 0
        from werkzeug.serving import make_server
        server = make_server('127.0.0.1', 0, backend.app, threaded=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        import webview
        webview.settings['ALLOW_DOWNLOADS'] = True
        webview.settings['OPEN_EXTERNAL_LINKS_IN_BROWSER'] = True
        url = 'http://127.0.0.1:' + str(server.server_port) + '/_desktop/bootstrap?' + urlencode({'token': token})
        webview.create_window('ProjectHouseBuilder', url, width=1280, height=900, min_size=(900, 640))
        webview.start(gui='edgechromium', private_mode=False, storage_path=str(home / 'webview'))
        return 0
    except Exception as error:
        logging.exception('Desktop-Start fehlgeschlagen')
        if args.smoke_test:
            if args.smoke_output:args.smoke_output.write_text(json.dumps({'ok':False,'error':str(error)}), encoding='utf-8')
        elif sys.platform == 'win32':
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, str(error) + '\n\nProtokoll: ' + str(home / 'logs' / 'desktop.log'), 'Start fehlgeschlagen', 0x10)
        return 1
    finally:
        if server:server.shutdown();server.server_close()
        if instance.file:instance.release()
        if temporary:
            backend = sys.modules.get('app')
            if backend:
                with backend.app.app_context():
                    backend.db.session.remove()
                    backend.db.engine.dispose()
            logging.shutdown()
            temporary.cleanup()


if __name__ == '__main__':
    raise SystemExit(main())
