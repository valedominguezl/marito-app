# Arma el instalador de Marito (Marito-Setup-<versión>.exe en instalador\salida\):
#   1. copia a salida\app solo lo que Marito usa para correr (no android\, ni pruebas, ni lo personal);
#   2. le suma su propio Node (node.exe de nodejs.org, con el SHA-256 verificado) para no pedir que lo instalen;
#   3. compila Marito.exe (lanzador\Marito.cs) con el csc de .NET Framework que trae Windows;
#   4. corre Inno Setup (ISCC.exe) con marito.iss.
# Lo usa GitHub Actions (.github\workflows\instalador.yml) en cada tag v*, y anda igual en cualquier PC con Inno Setup 6.
#   -Version 0.1.0   la versión que muestra el instalador (sin la «v»)
#   -Iscc <ruta>     ISCC.exe si no está en los lugares de siempre
param([string]$Version = '0.0.0', [string]$Iscc = '')
$ErrorActionPreference = 'Stop'
$NODE_VERSION = 'v22.16.0'

$instalador = $PSScriptRoot
$raiz = Split-Path -Parent $instalador
$salida = Join-Path $instalador 'salida'
$app = Join-Path $salida 'app'
if (Test-Path $app) { Remove-Item -Recurse -Force $app }
New-Item -ItemType Directory -Force $app | Out-Null

# 1. Lo que Marito usa para correr (ver «Piezas» en ESPEC.md).
$archivos = @('abrir.ps1', 'marcar.ps1', 'marca.cs', 'server.mjs', 'servidor-logica.mjs', 'genericos.json', 'marito.ico',
    'voz.py', 'transcribir.py', 'instalar-voz.ps1', 'LICENSE', 'README.md')
foreach ($a in $archivos) {
    $origen = Join-Path $raiz $a
    if (Test-Path $origen) { Copy-Item $origen $app } elseif ($a -notin @('LICENSE', 'README.md')) { throw "Falta $a" }
}
foreach ($d in @('servidor', 'ui')) { Copy-Item -Recurse (Join-Path $raiz $d) (Join-Path $app $d) }
New-Item -ItemType Directory -Force (Join-Path $app 'lib') | Out-Null
foreach ($dll in @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll')) {
    Copy-Item (Join-Path $raiz "lib\$dll") (Join-Path $app 'lib')
}

# 2. Node propio (solo node.exe: el servidor no usa paquetes de npm).
$cacheNode = Join-Path $instalador 'node'
$nodeExe = Join-Path $cacheNode "node-$NODE_VERSION.exe"
if (-not (Test-Path $nodeExe)) {
    New-Item -ItemType Directory -Force $cacheNode | Out-Null
    $zipNombre = "node-$NODE_VERSION-win-x64.zip"
    $zip = Join-Path $cacheNode $zipNombre
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Write-Host "Bajando $zipNombre…"
    Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$NODE_VERSION/$zipNombre" -OutFile $zip
    $sumas = (Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt").Content
    $esperado = ($sumas -split "`n" | Where-Object { $_ -match "\s$([regex]::Escape($zipNombre))$" } | Select-Object -First 1) -replace '\s.*$', ''
    $real = (Get-FileHash $zip -Algorithm SHA256).Hash
    if (-not $esperado -or $real -ne $esperado.ToUpper()) { Remove-Item $zip; throw "El SHA-256 de $zipNombre no coincide." }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [IO.Compression.ZipFile]::OpenRead($zip)
    try { [IO.Compression.ZipFileExtensions]::ExtractToFile(($z.Entries | Where-Object { $_.FullName -like '*/node.exe' } | Select-Object -First 1), $nodeExe) } finally { $z.Dispose() }
    Remove-Item $zip
}
New-Item -ItemType Directory -Force (Join-Path $app 'node') | Out-Null
Copy-Item $nodeExe (Join-Path $app 'node\node.exe')

# 3. Marito.exe (la bandeja y los atajos).
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:winexe /optimize+ "/win32icon:$(Join-Path $raiz 'marito.ico')" "/out:$(Join-Path $app 'Marito.exe')" `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll (Join-Path $raiz 'lanzador\Marito.cs')
if ($LASTEXITCODE -ne 0) { throw 'No compiló Marito.exe.' }

# 4. El instalador.
if (-not $Iscc) {
    $Iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Iscc) { throw 'No encuentro Inno Setup 6 (ISCC.exe): instalalo o pasá -Iscc.' }
& $Iscc /Q "/DVersion=$Version" "/DApp=$app" "/O$salida" (Join-Path $instalador 'marito.iss')
if ($LASTEXITCODE -ne 0) { throw 'Falló Inno Setup.' }
$setup = Join-Path $salida "Marito-Setup-$Version.exe"
Write-Host ("Listo: {0} ({1:N1} MB)" -f $setup, ((Get-Item $setup).Length / 1MB))
