; ===========================================================================
;  Yoink - Inno Setup installer script
; ===========================================================================
;  Builds a traditional Windows installer that bundles the full portable
;  build (Node.js, ffmpeg, yt-dlp.exe, the Next.js server) and registers
;  Yoink with Windows so it shows up in Search, in Add/Remove Programs,
;  and in the Start Menu.
;
;  Build:  ISCC /DAppVersion=2.2.0 installer\yoink.iss
;          (build-portable.ps1 -Installer handles this automatically)
;
;  Expects `dist\ytdlp-gui-full\` to already exist - that's the full
;  portable build with yt-dlp bundled.
; ===========================================================================

#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif

[Setup]
; Stable GUID - do NOT change between releases or Windows will treat each
; version as a separate app and refuse clean upgrades.
AppId={{8B2A9F5D-3E47-4C2B-A8D1-7F9E1C3B5A02}
AppName=Yoink
AppVersion={#AppVersion}
AppVerName=Yoink {#AppVersion}
AppPublisher=HesNotTheGuy
AppPublisherURL=https://github.com/HesNotTheGuy/Yoink
AppSupportURL=https://github.com/HesNotTheGuy/Yoink/issues
AppUpdatesURL=https://github.com/HesNotTheGuy/Yoink/releases
DefaultDirName={autopf}\Yoink
DefaultGroupName=Yoink
DisableProgramGroupPage=yes
DisableDirPage=no
AllowNoIcons=yes
OutputDir=..\dist
OutputBaseFilename=Yoink-Setup-{#AppVersion}
SetupIconFile=..\yoink.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern

; Per-user OR per-machine install - user picks at runtime.
; lowest = installs to %LOCALAPPDATA% with no UAC prompt by default;
; user can elevate at the install dialog to install for all users.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

UninstallDisplayIcon={app}\yoink.ico
UninstallDisplayName=Yoink

; Make Add/Remove Programs entry more informative
VersionInfoVersion={#AppVersion}
VersionInfoCompany=HesNotTheGuy
VersionInfoDescription=Yoink - a clean GUI for yt-dlp
VersionInfoProductName=Yoink

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "quicklaunchicon"; Description: "{cm:CreateQuickLaunchIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Bundle everything from the full portable build
Source: "..\dist\ytdlp-gui-full\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Start Menu entry - this is what makes Yoink appear in Windows Search
Name: "{autoprograms}\Yoink"; Filename: "{app}\ytdlp-gui.exe"; IconFilename: "{app}\yoink.ico"; Comment: "Open Yoink"
Name: "{autodesktop}\Yoink"; Filename: "{app}\ytdlp-gui.exe"; IconFilename: "{app}\yoink.ico"; Tasks: desktopicon
Name: "{userappdata}\Microsoft\Internet Explorer\Quick Launch\Yoink"; Filename: "{app}\ytdlp-gui.exe"; IconFilename: "{app}\yoink.ico"; Tasks: quicklaunchicon

[Run]
; Offer to launch right after install
Filename: "{app}\ytdlp-gui.exe"; Description: "{cm:LaunchProgram,Yoink}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Remove any runtime files that Yoink may have written next to the install
; (yt-dlp.exe auto-updates, log files, etc). User data in %APPDATA%\Yoink
; is intentionally LEFT in place - history & settings survive uninstall.
Type: filesandordirs; Name: "{app}\yt-dlp\yt-dlp.exe"
