; Openray per-user installer (docs/updates.md). Built by .github/workflows/release.yml with
; ISCC /DAppVersion=<tag>; Inno Setup 6 is preinstalled on the GitHub windows runners.
;
; Per-user by design (PrivilegesRequired=lowest, {localappdata}\Programs\Openray): no admin
; prompt, matching Raycast's install model, and the uninstaller only touches this directory.
; The payload is the self-contained app root — Openray.exe + dlls, backend/ (with the bundled
; portable node.exe under backend/runtime), frontend/dist, flowkey/ — exactly the layout the
; host resolves at runtime (App.xaml.cs FindAppRoot).

#define AppName "Openray"
#ifndef AppVersion
#define AppVersion "0.0.0"
#endif

[Setup]
AppId={{8E5B7F4A-1D2C-4E6B-9A0F-3C5D7E8F9A1B}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Openray
DefaultDirName={localappdata}\Programs\Openray
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=.
OutputBaseFilename=Openray-{#AppVersion}-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\Openray.exe
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "..\..\stage\app\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Openray"; Filename: "{app}\Openray.exe"
Name: "{autodesktop}\Openray"; Filename: "{app}\Openray.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Openray.exe"; Description: "Launch Openray"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Stop a running instance so the uninstaller can remove the files.
Filename: "{cmd}"; Parameters: "/C taskkill /IM Openray.exe /F"; Flags: runhidden; RunOnceId: "KillOpenray"
