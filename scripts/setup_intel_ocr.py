"""Project-local Intel macOS OCR. No Homebrew, sudo, or shell-profile changes."""
import hashlib
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
VERSION='2.9.0-0'
URL='https://github.com/mamba-org/micromamba-releases/releases/download/'+VERSION+'/micromamba-osx-64'
SHA256='1e71054bb3ac9a076e21f7ec48acfef536f9b3f1408f371a942784bf5ef83d8a'


def download_verified(url,destination,expected_hash):
    """Verify the pinned release before executing or replacing the cached binary."""
    destination=Path(destination)
    destination.parent.mkdir(parents=True,exist_ok=True)
    if destination.is_file() and hashlib.sha256(destination.read_bytes()).hexdigest()==expected_hash:
        destination.chmod(0o755)
        return
    with tempfile.TemporaryDirectory(prefix='.download-',dir=destination.parent) as tmp:
        candidate=Path(tmp)/'micromamba'
        digest=hashlib.sha256()
        with urllib.request.urlopen(url,timeout=60) as response,candidate.open('wb') as target:
            while True:
                chunk=response.read(1024*1024)
                if not chunk:break
                target.write(chunk);digest.update(chunk)
        if digest.hexdigest()!=expected_hash:
            raise RuntimeError('Prüfsumme des OCR-Paketmanagers stimmt nicht; Installation abgebrochen.')
        candidate.chmod(0o755)
        os.replace(candidate,destination)


def install(runtime_root=None):
    runtime=Path(runtime_root) if runtime_root else ROOT/'.runtime'
    binary=runtime/'bin'/'micromamba'
    prefix=runtime/'ocr'
    download_verified(URL,binary,SHA256)
    action='install' if (prefix/'conda-meta'/'history').exists() else 'create'
    environment={**os.environ,'CONDA_PKGS_DIRS':str(runtime/'mamba'/'pkgs'),
                 'XDG_CACHE_HOME':str(runtime/'cache')}
    subprocess.run([str(binary),'--no-rc','--root-prefix',str(runtime/'mamba'),action,
                    '--yes','--prefix',str(prefix),'--platform','osx-64',
                    '--override-channels','--channel','conda-forge',
                    'tesseract>=5,<6','poppler>=24'],check=True,env=environment)


def main():
    if sys.platform!='darwin' or platform.machine()!='x86_64':
        raise SystemExit('Diese Einrichtung ist für Intel-macOS vorgesehen.')
    version=platform.mac_ver()[0]
    if not version or int(version.split('.')[0])<11:
        raise SystemExit('Die projektlokale Intel-OCR benötigt macOS 11 oder neuer.')
    print('Intel-Mac: Tesseract, Sprachdaten und Poppler werden lokal unter .runtime/ocr eingerichtet.',flush=True)
    try:
        install()
    except (OSError,RuntimeError,subprocess.CalledProcessError) as error:
        raise SystemExit('Intel-OCR konnte nicht eingerichtet werden: '+str(error)) from error


if __name__=='__main__':
    main()
