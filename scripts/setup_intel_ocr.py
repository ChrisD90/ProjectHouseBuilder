"""Project-local Intel macOS OCR. No Homebrew, sudo, or shell-profile changes."""
import hashlib
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[1]
VERSION='2.9.0-0'
URL='https://github.com/mamba-org/micromamba-releases/releases/download/'+VERSION+'/micromamba-osx-64'
SHA256='1e71054bb3ac9a076e21f7ec48acfef536f9b3f1408f371a942784bf5ef83d8a'


def ca_bundle():
    """Respect explicit CA bundles; otherwise use macOS roots rather than Python.org's missing bundle."""
    for variable in ('SSL_CERT_FILE','CURL_CA_BUNDLE','REQUESTS_CA_BUNDLE'):
        value=os.environ.get(variable)
        if value:
            if not Path(value).is_file():
                raise RuntimeError(variable+' verweist auf keine lesbare Zertifikatsdatei. Pfad korrigieren oder die Variable vor dem Start entfernen.')
            return str(Path(value).resolve())
    system_bundle=Path('/etc/ssl/cert.pem')
    if sys.platform=='darwin' and system_bundle.is_file():
        return str(system_bundle)
    return None


def download_verified(url,destination,expected_hash):
    """Verify the pinned release before executing or replacing the cached binary."""
    destination=Path(destination)
    destination.parent.mkdir(parents=True,exist_ok=True)
    if destination.is_file() and hashlib.sha256(destination.read_bytes()).hexdigest()==expected_hash:
        destination.chmod(0o755)
        return
    with tempfile.TemporaryDirectory(prefix='.download-',dir=destination.parent) as tmp:
        candidate=Path(tmp)/'micromamba'
        # Apple's curl uses macOS certificate trust independently of Python.org's
        # optional "Install Certificates.command" setup. Never use insecure TLS.
        command=['/usr/bin/curl','--fail','--show-error','--silent','--location',
                 '--proto','=https','--proto-redir','=https','--tlsv1.2',
                 '--connect-timeout','20','--max-time','120','--retry','2']
        bundle=ca_bundle()
        if bundle:command.extend(['--cacert',bundle])
        command.extend(['--output',str(candidate),url])
        subprocess.run(command,check=True,timeout=400)
        if hashlib.sha256(candidate.read_bytes()).hexdigest()!=expected_hash:
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
    command=[str(binary),'--no-rc','--root-prefix',str(runtime/'mamba'),action,
                    '--yes','--prefix',str(prefix),'--platform','osx-64',
                    '--override-channels','--channel','conda-forge',
                    'tesseract>=5,<6','poppler>=24']
    bundle=ca_bundle()
    if bundle:
        # The package manager also downloads over HTTPS. Its OpenSSL trust must
        # not depend on the broken default CA path of the invoking Python.
        command.extend(['--ssl-verify',bundle])
        environment.update(SSL_CERT_FILE=bundle,CURL_CA_BUNDLE=bundle,REQUESTS_CA_BUNDLE=bundle)
    subprocess.run(command,check=True,env=environment)


def main():
    if sys.platform!='darwin' or platform.machine()!='x86_64':
        raise SystemExit('Diese Einrichtung ist für Intel-macOS vorgesehen.')
    version=platform.mac_ver()[0]
    if not version or int(version.split('.')[0])<11:
        raise SystemExit('Die projektlokale Intel-OCR benötigt macOS 11 oder neuer.')
    print('Intel-Mac: Tesseract, Sprachdaten und Poppler werden lokal unter .runtime/ocr eingerichtet.',flush=True)
    try:
        install()
    except (OSError,RuntimeError,subprocess.SubprocessError) as error:
        raise SystemExit('Intel-OCR konnte nicht eingerichtet werden: '+str(error)) from error


if __name__=='__main__':
    main()
