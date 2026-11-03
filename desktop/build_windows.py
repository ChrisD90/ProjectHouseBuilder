"""Build on Windows x64 with Python, Node, Conda and Inno Setup available."""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def run(*args):
    subprocess.run([str(a) for a in args], cwd=ROOT, check=True)


def main():
    if sys.platform != 'win32' or sys.maxsize <= 2**32:
        raise SystemExit('Der Installer muss mit 64-Bit-Python auf Windows gebaut werden.')
    generated = ROOT / 'desktop' / 'generated'
    generated.mkdir(parents=True, exist_ok=True)
    source = Path(os.environ['PHB_OCR_ENV'])
    vendor = ROOT / 'desktop' / 'vendor' / 'ocr'
    if vendor.exists():
        raise SystemExit('OCR-Buildordner existiert bereits. Bitte einen frischen Checkout verwenden.')
    shutil.copytree(source, vendor)
    tessdata = vendor / 'Library' / 'share' / 'tessdata'
    tessdata.mkdir(parents=True, exist_ok=True)
    sources = []
    for lang in ('deu', 'eng'):
        url = f'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/{lang}.traineddata'
        with urllib.request.urlopen(url, timeout=90) as response:
            data = response.read()
        (tessdata / (lang + '.traineddata')).write_bytes(data)
        sources.append({'url': url, 'sha256': hashlib.sha256(data).hexdigest()})
    manifest = {'languages': sources, 'packages': [json.loads(p.read_text(encoding='utf-8'))
                for p in sorted((vendor / 'conda-meta').glob('*.json'))]}
    (vendor / 'package-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    os.environ['PATH'] = str(vendor / 'Library' / 'bin') + os.pathsep + os.environ['PATH']
    os.environ['TESSDATA_PREFIX'] = str(tessdata)
    run(sys.executable, 'ocr_runtime.py', '--check')
    run(sys.executable, 'dev/ocr_smoke.py')
    from PIL import Image
    Image.open(ROOT / 'static' / 'icons' / 'icon-512.png').save(generated / 'app.ico', sizes=[(16,16),(32,32),(48,48),(256,256)])
    # Include installed Python license files and a version manifest in the bundle.
    notices = generated / 'licenses'
    notices.mkdir(exist_ok=True)
    packages = []
    for distribution in importlib.metadata.distributions():
        name = distribution.metadata['Name'] or 'unknown'
        packages.append({'name':name,'version':distribution.version,'license':distribution.metadata.get('License','')})
        for file in distribution.files or []:
            if any(part.lower().startswith(('license','copying','notice')) for part in file.parts):
                origin = distribution.locate_file(file)
                if origin.is_file():
                    target = notices / name / Path(str(file))
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(origin, target)
    (notices / 'python-packages.json').write_text(json.dumps(packages, indent=2), encoding='utf-8')
    run(sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', 'desktop/windows.spec')
    url = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703'
    with urllib.request.urlopen(url, timeout=90) as response:
        (generated / 'MicrosoftEdgeWebview2Setup.exe').write_bytes(response.read())
    compiler = shutil.which('ISCC.exe') or r'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
    run(compiler, '/DAppVersion=0.1.0', 'desktop/installer.iss')


if __name__ == '__main__':
    main()
