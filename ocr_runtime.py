"""Shared OCR discovery and startup check; standard library only (also runs before pip)."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

LOCAL_OCR=Path(__file__).resolve().parent/'.runtime'/'ocr'


def find_ocr_tool(name):
    """Use the same executable in diagnostics and extraction, including macOS GUI PATHs."""
    if name not in ('tesseract','pdftoppm'):
        raise ValueError('Unbekanntes OCR-Werkzeug')
    if sys.platform=='darwin':
        local=shutil.which(name,path=str(LOCAL_OCR/'bin'))
        if local:return local
    found=shutil.which(name)
    if not found and sys.platform=='darwin':
        found=shutil.which(name,path='/opt/homebrew/bin:/usr/local/bin')
    return found


def ocr_command(name):
    executable=find_ocr_tool(name) or name
    command=[executable]
    if name=='tesseract' and Path(executable)==LOCAL_OCR/'bin'/'tesseract':
        # conda's TESSDATA_PREFIX activation hook is not run by GUI/Python launches.
        command.extend(['--tessdata-dir',str(LOCAL_OCR/'share'/'tessdata')])
    return command


def ocr_diagnostics():
    """Report what the *running worker* can execute, not what the Dockerfile requests.

    Old images can serve new source files mounted from a NAS share, so checking
    the build-time image marker helps distinguish stale image from broken OCR.
    No secrets, paths to private documents or environment values are returned.
    """
    locations={name:find_ocr_tool(name) for name in ('tesseract','pdftoppm')}
    tools={name:bool(path) for name,path in locations.items()}
    languages=[]
    versions={}
    if tools['tesseract']:
        try:
            langs=subprocess.run(ocr_command('tesseract')+['--list-langs'],capture_output=True,
                                 text=True,timeout=8,check=False)
            languages=[line.strip() for line in (langs.stdout+'\n'+langs.stderr).splitlines()
                       if langs.returncode==0 and re.fullmatch(r'[a-z]{3}(?:_[A-Za-z0-9]+)?',line.strip())]
            ver=subprocess.run([locations['tesseract'],'--version'],capture_output=True,
                               text=True,timeout=8,check=False)
            tools['tesseract']=ver.returncode==0
            versions['tesseract']=(ver.stdout or ver.stderr).splitlines()[0][:110] if (
                ver.stdout or ver.stderr) else ''
        except (OSError,subprocess.TimeoutExpired):
            tools['tesseract']=False
    if tools['pdftoppm']:
        try:
            ver=subprocess.run([locations['pdftoppm'],'-v'],capture_output=True,
                               text=True,timeout=8,check=False)
            tools['pdftoppm']=ver.returncode==0
            versions['pdftoppm']=(ver.stderr or ver.stdout).splitlines()[0][:110] if (
                ver.stderr or ver.stdout) else ''
        except (OSError,subprocess.TimeoutExpired):
            tools['pdftoppm']=False
    docker=Path('/.dockerenv').exists() or bool(os.environ.get('PHB_OCR_IMAGE'))
    image=os.environ.get('PHB_OCR_IMAGE','')
    ready=all(tools.values()) and 'deu' in languages and 'eng' in languages
    if ready:
        reason='OCR im laufenden App-Prozess einsatzbereit.'
    elif docker and not image:
        reason=('Der laufende Container verwendet offenbar nicht das aktuelle OCR-geprüfte '
                'App-Image. App-Image ohne Cache neu bauen und App-Container neu erstellen.')
    elif docker:
        reason=('OCR-Pakete sind im laufenden App-Container nicht nutzbar. '
                'Build-/Startprotokoll und Sprachen prüfen; App-Image neu bauen.')
    elif sys.platform=='darwin':
        reason='OCR fehlt auf dem lokalen Mac. App beenden und sh start_mac_linux.sh ausführen; der Start richtet Tesseract, Sprachpakete und Poppler automatisch ein.'
    else:
        reason='Tesseract, Poppler und die Sprachdaten deu+eng auf dem App-Server installieren.'
    return {'tools':tools,'languages':languages,'ready':ready,'versions':versions,
            'environment':'container' if docker else 'local',
            'image_marker':image,'reason':reason,
            'hint':'OCR wird serverseitig geprüft; der Browser muss keine OCR-Pakete installieren.'}


def main(argv=None):
    parser=argparse.ArgumentParser(description='Tesseract, Poppler und deu+eng prüfen')
    parser.add_argument('--check',action='store_true',help='Startprüfung (Exit-Code 1 bei fehlender OCR)')
    parser.add_argument('--quiet',action='store_true')
    args=parser.parse_args(argv)
    state=ocr_diagnostics()
    if not args.quiet:
        if state['ready']:
            print('OCR einsatzbereit: Tesseract + Poppler, Deutsch + Englisch.')
        else:
            missing=[name for name,available in state['tools'].items() if not available]
            missing.extend(language for language in ('deu','eng') if language not in state['languages'])
            print('OCR-Startprüfung fehlgeschlagen: '+', '.join(missing),file=sys.stderr)
            print(state['reason'],file=sys.stderr)
            if os.environ.get('TESSDATA_PREFIX'):
                print('TESSDATA_PREFIX ist gesetzt: Sprachdatenpfad prüfen oder die Variable vor dem Start entfernen.',file=sys.stderr)
    return 0 if state['ready'] else 1


if __name__=='__main__':
    raise SystemExit(main())
