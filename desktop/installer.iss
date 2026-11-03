#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
[Setup]
AppId={{55E4E8FC-4F91-41DE-8132-D274052A35E3}
AppName=ProjectHouseBuilder
AppVersion={#AppVersion}
AppPublisher=ProjectHouseBuilder
DefaultDirName={localappdata}\Programs\ProjectHouseBuilder
DefaultGroupName=ProjectHouseBuilder
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir=..\dist\installer
OutputBaseFilename=ProjectHouseBuilder-Windows-x64-Setup
SetupIconFile=generated\app.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
SetupMutex=ProjectHouseBuilderSetup
UninstallDisplayIcon={app}\ProjectHouseBuilder.exe
InfoBeforeFile=INSTALLATION.txt

[Files]
Source: "..\dist\ProjectHouseBuilder\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "generated\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Tasks]
Name: "desktopicon"; Description: "Desktop-Verknüpfung erstellen"; Flags: unchecked

[Icons]
Name: "{group}\ProjectHouseBuilder"; Filename: "{app}\ProjectHouseBuilder.exe"
Name: "{autodesktop}\ProjectHouseBuilder"; Filename: "{app}\ProjectHouseBuilder.exe"; Tasks: desktopicon

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Microsoft WebView2 wird eingerichtet …"; Check: NeedsWebView2; Flags: waituntilterminated
Filename: "{app}\ProjectHouseBuilder.exe"; Description: "ProjectHouseBuilder starten"; Flags: nowait postinstall skipifsilent

[Code]
function NeedsWebView2: Boolean;
var Version: String;
begin
  Result := not ((RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM32, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')));
end;
