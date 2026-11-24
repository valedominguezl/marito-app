; Instalador de Marito (Inno Setup 6). Lo corre instalador\armar.ps1 con /DVersion=… y /DApp=<carpeta armada>.
; Instala para el usuario (sin pedir administrador) en %LOCALAPPDATA%\Programs\Marito. Si falta WebView2 (algún
; Windows 10 viejo), baja el instalador oficial de Microsoft. Los datos (%LOCALAPPDATA%\arreglo) quedan al desinstalar.
#ifndef Version
  #define Version "0.0.0"
#endif
#ifndef App
  #define App "salida\app"
#endif

[Setup]
AppId={{6F3B2C1A-8E4D-4B7A-9C2E-5D1F0A3B7C9E}
AppName=Marito
AppVersion={#Version}
AppVerName=Marito {#Version}
AppPublisher=valedominguezl
AppPublisherURL=https://github.com/valedominguezl/marito-app
AppSupportURL=https://github.com/valedominguezl/marito-app/issues
DefaultDirName={autopf}\Marito
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
OutputBaseFilename=Marito-Setup-{#Version}
SetupIconFile=..\marito.ico
UninstallDisplayIcon={app}\Marito.exe
UninstallDisplayName=Marito
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
CloseApplications=yes
#if FileExists(AddBackslash(SourcePath) + "..\LICENSE")
LicenseFile=..\LICENSE
#endif

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "inicio"; Description: "Abrir Marito al iniciar Windows (así Alt+F1, Alt+F2 y Alt+F3 andan siempre)"
Name: "escritorio"; Description: "{cm:CreateDesktopIcon}"; Flags: unchecked

[Files]
Source: "{#App}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Marito"; Filename: "{app}\Marito.exe"
Name: "{autodesktop}\Marito"; Filename: "{app}\Marito.exe"; Tasks: escritorio

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Marito"; ValueData: """{app}\Marito.exe"" --inicio"; Tasks: inicio; Flags: uninsdeletevalue

[Run]
Filename: "{app}\Marito.exe"; Description: "Abrir Marito"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; abrir.ps1 y marcar.ps1 compilan su código nativo en lib\ la primera vez.
Type: filesandordirs; Name: "{app}\lib"

[Code]
const
  WEBVIEW2_ID = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

var
  PaginaBajada: TDownloadWizardPage;

function VersionValida(Raiz: Integer; Clave: String): Boolean;
var
  V: String;
begin
  Result := RegQueryStringValue(Raiz, Clave, 'pv', V) and (V <> '') and (V <> '0.0.0.0');
end;

function HayWebView2: Boolean;
begin
  Result := VersionValida(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\' + WEBVIEW2_ID)
    or VersionValida(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\' + WEBVIEW2_ID)
    or VersionValida(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\' + WEBVIEW2_ID);
end;

procedure InitializeWizard;
begin
  PaginaBajada := CreateDownloadPage(SetupMessage(msgWizardPreparing), SetupMessage(msgPreparingDesc), nil);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Codigo: Integer;
begin
  Result := True;
  if (CurPageID = wpReady) and not HayWebView2 then begin
    PaginaBajada.Clear;
    PaginaBajada.Add('https://go.microsoft.com/fwlink/p/?LinkId=2124703', 'MicrosoftEdgeWebview2Setup.exe', '');
    PaginaBajada.Show;
    try
      try
        PaginaBajada.Download;
        Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, Codigo);
      except
        SuppressibleMsgBox('No pude instalar Microsoft Edge WebView2, que Marito necesita para su ventana. ' +
          'Instalalo desde https://developer.microsoft.com/microsoft-edge/webview2 y volvé a abrir Marito.', mbError, MB_OK, IDOK);
      end;
    finally
      PaginaBajada.Hide;
    end;
  end;
end;

// Cierra todo lo de Marito que corre desde {app}: la bandeja (Marito.exe), el Node propio y el PowerShell de
// abrir.ps1 / marcar.ps1 con su ventana. Con cerrar solo Marito.exe, la ventana abierta seguía andando después de
// desinstalar y dejaba lib\ y node\node.exe sin borrar (probado en Windows Sandbox el 24/11). Por la línea de comandos
// se cierran solo PowerShell y Python (los que corren abrir.ps1, marcar.ps1, voz.py): la copia temporal del
// desinstalador (_unins.tmp) también lleva {app} en la suya y no hay que matarla.
procedure CerrarMarito;
var
  Carpeta, Ps: String;
  Codigo: Integer;
begin
  Carpeta := AddBackslash(ExpandConstant('{app}'));
  StringChangeEx(Carpeta, '''', '''''', True);
  Ps := '$c = ''' + Carpeta + '''; ' +
    'Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.Name -notlike ''unins*'' -and (' +
    '('''' + $_.ExecutablePath).StartsWith($c, ''OrdinalIgnoreCase'') -or ' +
    '($_.Name -match ''^(powershell|pwsh|pythonw?)\.exe$'' -and ('''' + $_.CommandLine).IndexOf($c, [StringComparison]::OrdinalIgnoreCase) -ge 0)) } | ' +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 700';
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "' + Ps + '"',
    '', SW_HIDE, ewWaitUntilTerminated, Codigo);
end;

// Al instalar encima de una versión abierta, lo mismo (si no, Windows tiene tomados node.exe y las DLL de lib\).
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  CerrarMarito;
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    CerrarMarito;
  // «Iniciar con Windows» también se puede prender desde el ícono de la bandeja: se saca igual.
  if CurUninstallStep = usPostUninstall then
    RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'Marito');
end;
