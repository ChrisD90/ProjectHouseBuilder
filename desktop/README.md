# Windows-Testinstallation

Branch: `feature/windows-desktop`, abgezweigt von `feature/react-mantine-ui`.

Dieser Prototyp nutzt **pywebview mit Microsoft WebView2**, PyInstaller und Inno
Setup. Damit wird das bestehende Python-Backend direkt im Desktop-Prozess
betrieben; eine zusätzliche Rust-/Tauri-Anwendung ist für diesen Test nicht nötig.
React und die bisherigen Arbeitsabläufe bleiben erhalten.

## Installer herunterladen

1. Im GitHub-Repository **Actions → Windows Desktop Testbuild** öffnen.
2. Den erfolgreichen Lauf auf `feature/windows-desktop` auswählen.
3. Das Artefakt **ProjectHouseBuilder-Windows-x64-Testbuild** herunterladen und
   entpacken. Die Datei `ProjectHouseBuilder-Windows-x64-Setup.exe` starten.
4. Windows 10/11 **x64** verwenden. Der Testbuild ist nicht signiert; SmartScreen
   kann daher warnen. Bei fehlendem WebView2 benötigt dessen Ersteinrichtung Internet.

Der Installer benötigt keine Python-, Node-, Docker- oder OCR-Installation beim
Nutzer. Er installiert nur für den aktuellen Windows-Benutzer und kann eine
Desktop-Verknüpfung anlegen. Er benötigt keine administrativen Rechte.

## Lokaler Betrieb

- Daten: `%LOCALAPPDATA%\ProjectHouseBuilder\data`
- Backups: `%LOCALAPPDATA%\ProjectHouseBuilder\backups`
- ChatGPT-Zugangsdaten: `%LOCALAPPDATA%\ProjectHouseBuilder\auth`
- Fensterprofil: `%LOCALAPPDATA%\ProjectHouseBuilder\webview`
- Fehlerprotokoll: `%LOCALAPPDATA%\ProjectHouseBuilder\logs\desktop.log`

Das Backend bindet ausschließlich an `127.0.0.1` auf einem freien Port und beendet
sich mit dem App-Fenster. Ein zufälliges Start-Token schützt den lokalen Zugang;
Schreibzugriffe von fremden Websites werden abgewiesen. Ein zweiter Start wird
durch eine betriebssystemweite Dateisperre verhindert. Bestehende Browser-/NAS-
Installationen und deren Daten werden nicht übernommen oder überschrieben.
Nutzerdaten bleiben bei Updates und bei der Deinstallation erhalten.

PDFs in neuen Fenstern öffnen über einen lokalen Anmeldeschritt im Standardbrowser.
ChatGPT ist optional; dessen bestehende OAuth-Anmeldung läuft im App-Fenster.
Ob OpenAI die Anmeldung in dieser eingebetteten Laufzeit zulässt, muss auf einem
echten Windows-Rechner geprüft werden. Falls der Anbieter die Anmeldung im Fenster
ablehnt: **Ansicht → Im Browser öffnen**, dort anmelden, anschließend im App-Fenster
**Ansicht → Projektübersicht** wählen, um den Verbindungsstatus neu zu laden.
Für diesen Test ist die Anmeldung noch nicht als verifiziert zugesagt. Ohne
ChatGPT bleiben alle lokalen Funktionen verfügbar.

## Was der Build automatisch prüft

Der Windows-Runner baut das React-Frontend, testet die Windows-Dateisperre und den
Zugriffsschutz, führt echte Foto-/PDF-OCR aus und baut ein eigenständiges Programm.
Das verpackte Programm startet anschließend mit bereinigtem PATH in einem frischen
temporären Datenordner: Migrationen, lokale Seiten/API und OCR eines gescannten
PDFs müssen funktionieren. Es verwendet dabei keine Nutzerdaten und öffnet kein GUI.

Der Bericht `desktop-smoke.json` liegt im Download. Diese Prüfung ersetzt nicht den
manuellen Test des Installers, des Fensters und der Anmeldung auf einem echten PC.

## Selbst bauen

Auf Windows x64 Python 3.12, Node 22, Conda und Inno Setup 6 installieren, dann:

```powershell
python -m pip install -r desktop/requirements.txt
npm --prefix frontend ci
npm --prefix frontend run build
conda create --yes --prefix "$env:TEMP\phb-ocr-build" --override-channels -c conda-forge tesseract poppler
$env:PHB_OCR_ENV = "$env:TEMP\phb-ocr-build"
python desktop/build_windows.py
```

Zum erneuten Bauen einen frischen Checkout verwenden. Der Build bündelt nur
explizit ausgewählte Programmdateien, keine Datenbanken, `private/`, Backups oder
lokale Anmeldedaten. Das Buildverfahren lädt Python-Pakete, OCR-Pakete, Sprachdaten
und Microsofts WebView2-Installer aus dem Internet. Versionen/Quellen werden im
Programm mitgeliefert. Vor einer öffentlichen Veröffentlichung müssen Lizenz- und
Signierungsfragen separat abgeschlossen werden; siehe `THIRD_PARTY.md`.
