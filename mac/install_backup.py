"""macOS: choose Proton Drive folder, register daily launchd backup."""
import argparse
import os
from pathlib import Path
import plistlib
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backup_manager import configure  # noqa: E402


def main():
    p=argparse.ArgumentParser()
    p.add_argument('folder', nargs='?')
    args=p.parse_args()
    folder=args.folder
    if folder is None:
        result=subprocess.run(['osascript','-e', 'POSIX path of (choose folder with prompt "Backup-Ordner für ProjectHouseBuilder auswählen")'],capture_output=True,text=True)
        if result.returncode:
            print('Ordnerauswahl abgebrochen.',file=sys.stderr)
            return 1
        folder=result.stdout.strip()
    target=configure(folder,keep=30)
    agent=Path.home()/'Library'/'LaunchAgents'/'local.projecthousebuilder.backup.plist'
    agent.parent.mkdir(parents=True,exist_ok=True)
    logdir=Path.home()/'Library'/'Logs'
    logdir.mkdir(parents=True,exist_ok=True)
    d={'Label':'local.projecthousebuilder.backup',
       'ProgramArguments':[sys.executable,str(ROOT/'backup_manager.py'),'backup'],
       'StartCalendarInterval':{'Hour':20,'Minute':0},'RunAtLoad':True,
       'StandardOutPath':str(logdir/'ProjectHouseBuilder-backup.log'),
       'StandardErrorPath':str(logdir/'ProjectHouseBuilder-backup-error.log')}
    with agent.open('wb') as f: plistlib.dump(d,f)
    domain='gui/'+str(os.getuid())
    subprocess.run(['launchctl','bootout',domain,str(agent)],capture_output=True)
    proc=subprocess.run(['launchctl','bootstrap',domain,str(agent)],capture_output=True,text=True)
    if proc.returncode:
        print('Backupziel gespeichert, aber LaunchAgent konnte nicht aktiviert werden: '+proc.stderr,file=sys.stderr)
        return 1
    print('Zielordner:',target)
    print('Automatische Sicherung: bei Anmeldung und täglich 20 Uhr (Mac muss eingeschaltet sein).')
    print('Manuell testen: python3 backup_manager.py backup')
    return 0

if __name__=='__main__':raise SystemExit(main())
