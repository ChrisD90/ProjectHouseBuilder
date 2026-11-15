"""Open a local OS folder picker without passing user paths as executable code."""
import os
import shutil
import subprocess
import sys


def choose_folder(initial=''):
    env={**os.environ,'PHB_FOLDER_INITIAL':initial}
    if sys.platform=='darwin':
        script='''activate
try
    set initialPath to system attribute "PHB_FOLDER_INITIAL"
    if initialPath is "" then
        set selectedFolder to choose folder with prompt "Eingangsordner auswählen"
    else
        set selectedFolder to choose folder with prompt "Eingangsordner auswählen" default location (POSIX file initialPath)
    end if
    return POSIX path of selectedFolder
on error number -128
    return ""
end try'''
        command=['osascript','-e',script]
    elif sys.platform=='win32':
        script='''[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Eingangsordner auswählen'
$dialog.ShowNewFolderButton = $false
$dialog.SelectedPath = $env:PHB_FOLDER_INITIAL
try {
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        [Console]::Write($dialog.SelectedPath)
    }
} finally { $dialog.Dispose() }'''
        command=['powershell.exe','-NoProfile','-NonInteractive','-STA','-Command',script]
    elif shutil.which('zenity'):
        command=['zenity','--file-selection','--directory','--title=Eingangsordner auswählen']
        if initial:command.append('--filename='+initial.rstrip('/')+'/')
    elif shutil.which('kdialog'):
        command=['kdialog','--getexistingdirectory',initial or os.path.expanduser('~'),'--title','Eingangsordner auswählen']
    else:
        script="import os,tkinter as tk;from tkinter import filedialog;root=tk.Tk();root.withdraw();root.attributes('-topmost',True);print(filedialog.askdirectory(title='Eingangsordner auswählen',initialdir=os.environ.get('PHB_FOLDER_INITIAL') or None,mustexist=True));root.destroy()"
        command=[sys.executable,'-c',script]
    try:
        result=subprocess.run(command,env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=180,check=False)
    except (OSError,subprocess.TimeoutExpired) as exc:
        raise ValueError('Der System-Ordnerdialog konnte nicht geöffnet oder abgeschlossen werden. Bitte erneut versuchen oder den Pfad eingeben.') from exc
    if result.returncode:
        if result.returncode==1 and not result.stdout.strip() and not result.stderr.strip() and command[0] in ('zenity','kdialog'):return None
        raise ValueError('Der System-Ordnerdialog konnte nicht geöffnet werden. Bitte den Pfad eingeben.')
    return result.stdout.lstrip('\ufeff').strip() or None
