; Inno Setup script. Build: ISCC /DVersion=0.2.0 packaging\windows\installer.iss  (expects dist\yt-research-scraper.exe)
[Setup]
AppName=YouTube Research Scraper
AppVersion={#Version}
AppPublisher=tanim913
AppPublisherURL=https://github.com/tanim913/yt-research-scraper
DefaultDirName={autopf}\YouTube Research Scraper
DefaultGroupName=YouTube Research Scraper
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2
SolidCompression=yes
OutputDir=..\..\dist
OutputBaseFilename=yt-research-scraper-setup-windows-x64
UninstallDisplayIcon={app}\yt-research-scraper.exe
WizardStyle=modern

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "..\..\dist\yt-research-scraper.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\YouTube Research Scraper"; Filename: "{app}\yt-research-scraper.exe"
Name: "{autodesktop}\YouTube Research Scraper"; Filename: "{app}\yt-research-scraper.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\yt-research-scraper.exe"; Description: "Start YouTube Research Scraper now"; Flags: postinstall nowait skipifsilent
