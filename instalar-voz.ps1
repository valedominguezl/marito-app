# La voz de Marito en esta compu: arma una sola vez el entorno de Python de voz.py en %LOCALAPPDATA%\arreglo\voz\ (~1,3 GB):
#   Piper con la voz es_AR Daniela y Kokoro-82M con la voz Santa, las dos en el procesador (torch sin placa), y
#   faster-whisper para el dictado (transcribir.py; baja su modelo la primera vez que se dicta).
#   -Desinstalar: borra el entorno, la voz de Piper y el modelo de Kokoro (no queda nada ocupando lugar).
# La voz es opcional: se elige en la configuración de Marito («La voz»). Después de instalar no hace falta reiniciar nada.
param([switch]$Desinstalar)
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'arreglo\voz'
$venv = Join-Path $dir 'venv'
$py = Join-Path $venv 'Scripts\python.exe'
$modeloKokoro = Join-Path $env:USERPROFILE '.cache\huggingface\hub\models--hexgrad--Kokoro-82M'

if ($Desinstalar) {
    foreach ($x in @($venv, (Join-Path $dir 'es_AR-daniela-high.onnx'), (Join-Path $dir 'es_AR-daniela-high.onnx.json'), $modeloKokoro)) {
        if (Test-Path $x) { Remove-Item -Recurse -Force $x; Write-Host "Borrado: $x" }
    }
    Write-Host 'Listo: la voz quedó desinstalada (Marito sigue andando, sin voz).'
    exit 0
}

New-Item -ItemType Directory -Force $dir | Out-Null

# uv arma el entorno rápido y reusa lo ya bajado; si no está, se instala con winget.
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host 'Instalando uv (administrador de paquetes de Python)…'
    winget install --id astral-sh.uv -e --accept-source-agreements --accept-package-agreements | Out-Host
    $env:PATH = [Environment]::GetEnvironmentVariable('PATH', 'User') + ';' + [Environment]::GetEnvironmentVariable('PATH', 'Machine')
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'No pude instalar uv. Instalalo a mano (https://docs.astral.sh/uv/) y volvé a correr esto.' }
}

$ErrorActionPreference = 'Continue' # uv escribe su progreso en stderr
if (-not (Test-Path $py)) { & uv venv --python 3.11 $venv | Out-Host }
Write-Host 'Instalando Piper, Kokoro y el dictado (faster-whisper), con torch para el procesador…'
& uv pip install --python $py kokoro 'piper-tts==1.*' soundfile faster-whisper --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación de los paquetes.' }
$ErrorActionPreference = 'Stop'

$base = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_AR/daniela/high/'
foreach ($f in @('es_AR-daniela-high.onnx', 'es_AR-daniela-high.onnx.json')) {
    $destino = Join-Path $dir $f
    if (-not (Test-Path $destino)) { Write-Host "Bajando $f…"; Invoke-WebRequest -UseBasicParsing ($base + $f) -OutFile $destino }
}

# Prueba: una frase con cada voz (la primera vez Kokoro baja su modelo). El audio se borra.
$prueba = Join-Path $env:TEMP 'marito-voz-prueba.wav'
$ok = $true
foreach ($m in @('daniela', 'santa')) {
    & $py -X utf8 (Join-Path $PSScriptRoot 'voz.py') --motor $m --probar 'Hola, soy Marito.' --salida $prueba
    $ok = $ok -and ($LASTEXITCODE -eq 0) -and (Test-Path $prueba)
    Remove-Item -Force $prueba -ErrorAction SilentlyContinue
}
Remove-Item -Force $prueba -ErrorAction SilentlyContinue
if (-not $ok) { throw 'La voz no anduvo: mirá los mensajes de arriba.' }
Write-Host 'Listo: elegí la voz en la configuración de Marito («La voz»).'
