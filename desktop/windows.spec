"""Only application assets are bundled; no checkout databases, private/ or .env."""
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules

root = Path(SPECPATH).parent
data, binaries, hidden = collect_all('webview')
data += [(str(root / name), name) for name in ('templates', 'static', 'migrations')]
data += [(str(root / 'alembic.ini'), '.'), (str(root / 'desktop' / 'vendor' / 'ocr'), 'ocr')]
data += [(str(root / 'desktop' / 'THIRD_PARTY.md'), '.')]
data += [(str(root / 'desktop' / 'generated' / 'licenses'), 'third-party')]
a = Analysis([str(root / 'desktop_app.py')], pathex=[str(root)], binaries=binaries,
    datas=data, hiddenimports=hidden + collect_submodules('services') + ['sqlalchemy.dialects.sqlite'],
    excludes=['gunicorn','psycopg','pytest','tkinter'])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='ProjectHouseBuilder',
    console=False, icon=str(root / 'desktop' / 'generated' / 'app.ico'))
coll = COLLECT(exe, a.binaries, a.datas, name='ProjectHouseBuilder')
