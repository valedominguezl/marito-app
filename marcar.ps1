# Mira la pantalla para que Marito pueda señalar dónde tocar: la ventana que el usuario está usando (la de más
# arriba que no es Marito), una captura de esa pantalla y la lista numerada de sus controles (botones, menús,
# pestañas, links, campos) con su lugar, sacado de Windows (UI Automation). Lo corre Claude durante un turno; con la
# etiqueta [MARCAR:n] de su respuesta, server.mjs busca el control n en el .json y la ventana dibuja el recuadro.
#   -Salida <carpeta>  donde dejar pN.png y pN.json (la de la sesión de Marito: <sesión>\pantallas)
#   -Max <n>           tope de controles en la lista (180); -MaxTextos, de textos leídos por OCR (120)
# Con -Mostrar dibuja el recuadro (lo arranca server.mjs): -X -Y -W -H en píxeles reales de la pantalla y el texto del
# cartel en la variable de entorno MARCA_TEXTO (y lo del cartel abierto en MARCA_PASO, MARCA_TOTAL, MARCA_MAS y MARCA_ALTOCAR;
# con MARCA_STDIN=1 los cambios llegan por stdin, «clave<TAB>valor»). Escribe cómo terminó y sale: «dentro» (tocó el
# recuadro), «salir» (el botón «Salir del tutorial» del cartel), «fuera» (otro click), «esc» o «tope» (3 min).
#   -Ventana <hwnd>    para probar: lee esa ventana aunque no esté adelante (la captura es la pantalla como está)
# Con -Zona <ruta.png> (lo corre abrir.ps1 -Zona: Alt+F1 o el botón de Marito) el usuario marca una zona arrastrando;
# guarda el recorte e imprime un JSON con la zona y la ventana que hay debajo, o «cancelado». -EsperarMarito: antes de
# congelar la pantalla espera que Marito termine de minimizarse (lo pidió desde su botón).
param([string]$Salida, [int]$Max = 180, [int]$MaxTextos = 120, [long]$Ventana, [switch]$Mostrar, [int]$X, [int]$Y, [int]$W, [int]$H,
    [string]$Zona, [switch]$EsperarMarito)
$ErrorActionPreference = 'Stop'
$reloj = [Diagnostics.Stopwatch]::StartNew()
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -AssemblyName System.Windows.Forms, System.Drawing, UIAutomationClient, UIAutomationTypes
# marca.cs se compila una vez por versión y queda en lib\ (lo comparte con abrir.ps1).
$fuente = [IO.File]::ReadAllText((Join-Path $aqui 'marca.cs'))
$hash = [BitConverter]::ToString((New-Object Security.Cryptography.SHA1Managed).ComputeHash([Text.Encoding]::UTF8.GetBytes($fuente))).Replace('-', '').Substring(0, 8)
$dll = Join-Path $aqui "lib\marca-native-$hash.dll"
if (-not (Test-Path $dll)) {
    Add-Type -TypeDefinition $fuente -ReferencedAssemblies System.Windows.Forms, System.Drawing -OutputAssembly $dll
    # Las de versiones anteriores ya no sirven (si alguna está en uso, queda para la próxima).
    Get-ChildItem (Join-Path $aqui 'lib') -Filter 'marca-native-*.dll' | Where-Object { $_.FullName -ne $dll } | ForEach-Object { try { Remove-Item $_.FullName -ErrorAction Stop } catch { } }
}
Add-Type -Path $dll
[MarcaWin]::PerMonitor() # píxeles reales en todas las pantallas: la lista y el recuadro hablan de lo mismo

if ($Mostrar) {
    $marca = New-Object MarcaOverlay((New-Object System.Drawing.Rectangle($X, $Y, $W, $H)), [string]$env:MARCA_TEXTO, [MarcaWin]::MaritoWindow())
    $script:resultado = 'fuera'
    $marca.add_Done([Action[string]] { param($como) $script:resultado = $como })
    [System.Windows.Forms.Application]::Run($marca)
    $script:resultado
    exit 0
}
if ($Zona) {
    if ($EsperarMarito) {
        $m = [MarcaWin]::MaritoWindow()
        $espera = [Diagnostics.Stopwatch]::StartNew()
        while ($m -ne [IntPtr]::Zero -and -not [MarcaWin]::Minimized($m) -and $espera.ElapsedMilliseconds -lt 1500) { Start-Sleep -Milliseconds 30 }
        Start-Sleep -Milliseconds 250 # la animación de minimizar
    }
    $r = [MarcaZona]::Elegir($Zona)
    if ($r.IsEmpty) { 'cancelado'; exit 0 }
    # La ventana que hay debajo del centro de la zona (sin la marca, que ya se cerró): de ella sale el proyecto.
    $debajo = [MarcaWin]::GetAncestor([MarcaWin]::WindowFromPoint((New-Object System.Drawing.Point(($r.X + [int]($r.Width / 2)), ($r.Y + [int]($r.Height / 2))))), 2)
    $pantallas = @([System.Windows.Forms.Screen]::AllScreens)
    $pant = [System.Windows.Forms.Screen]::FromRectangle($r)
    $tituloDebajo = [MarcaWin]::Title($debajo); $appDebajo = [MarcaWin]::ProcessOf($debajo)
    $nota = "{0}×{1} px en x={2}, y={3}" -f $r.Width, $r.Height, $r.X, $r.Y
    if ($pantallas.Count -gt 1) { $nota += " (en la pantalla de $($pant.Bounds.Width)×$($pant.Bounds.Height))" }
    if ($tituloDebajo) { $nota += "; está sobre «$tituloDebajo» ($appDebajo)" }
    [ordered]@{ x = $r.X; y = $r.Y; w = $r.Width; h = $r.Height; ruta = $Zona; hwnd = [int64]$debajo; ventana = $tituloDebajo; app = $appDebajo; nota = $nota } | ConvertTo-Json -Compress
    exit 0
}
if (-not $Salida) { 'Falta -Salida <carpeta>.'; exit 1 }

$h = if ($Ventana) { [IntPtr]$Ventana } else { [MarcaWin]::TopWindow() }
if ($h -eq [IntPtr]::Zero) { 'No encontré ninguna ventana abierta además de Marito.'; exit 1 }
$titulo = [MarcaWin]::Title($h)
$app = [MarcaWin]::ProcessOf($h)
$pantalla = [System.Windows.Forms.Screen]::FromHandle($h).Bounds

New-Item -ItemType Directory -Force $Salida | Out-Null
# El siguiente al mayor (no la cantidad + 1): el servidor fijo borra las de más de una semana y la cuenta pisaría una nueva.
$n = 1 + (@(0) + @(Get-ChildItem $Salida -Filter 'p*.json' -ErrorAction SilentlyContinue | ForEach-Object { if ($_.BaseName -match '^p(\d+)$') { [int]$Matches[1] } }) | Measure-Object -Maximum).Maximum
$png = Join-Path $Salida "p$n.png"

# Controles de las ventanas de la app (la de adelante, la principal, diálogos y paneles sueltos): visibles y de los
# tipos que se tocan. Lo que queda tapado por otra ventana suya no cuenta.
$AE = [System.Windows.Automation.AutomationElement]
$CT = [System.Windows.Automation.ControlType]
$tipos = [ordered]@{
    'Button' = 'Botón'; 'SplitButton' = 'Botón'; 'MenuItem' = 'Menú'; 'TabItem' = 'Pestaña'; 'Hyperlink' = 'Link';
    'CheckBox' = 'Casilla'; 'RadioButton' = 'Opción'; 'ComboBox' = 'Lista desplegable'; 'Edit' = 'Campo';
    'ListItem' = 'Ítem'; 'TreeItem' = 'Ítem del árbol'; 'DataItem' = 'Fila'; 'Slider' = 'Deslizador'
}
$nombresTipo = $tipos + @{ 'Texto' = 'Texto' } # los del OCR no son un tipo de Windows
# Controles Win32 que Windows da como «Pane» (ver Win32Kind) y que no tienen nada adentro: no se les piden hijos.
$hojasWin32 = 'Button', 'Static', 'Edit', 'ComboBox', 'msctls_trackbar32', 'msctls_updown32', 'ScrollBar'
$cache = New-Object System.Windows.Automation.CacheRequest
foreach ($p in $AE::NameProperty, $AE::ControlTypeProperty, $AE::BoundingRectangleProperty, $AE::IsEnabledProperty, $AE::IsOffscreenProperty, $AE::ClassNameProperty, $AE::NativeWindowHandleProperty) { $cache.Add($p) }
$cache.TreeScope = [System.Windows.Automation.TreeScope]::Element -bor [System.Windows.Automation.TreeScope]::Children
$controles = New-Object System.Collections.Generic.List[object]
$vistos = @{}
$areaPantalla = [double]$pantalla.Width * $pantalla.Height
$fuera = { param($r) $r.IsEmpty -or $r.Right -le $pantalla.Left -or $r.Left -ge $pantalla.Right -or $r.Bottom -le $pantalla.Top -or $r.Top -ge $pantalla.Bottom }

# Las ventanas, de adelante hacia atrás; cada una con lo que la tapa (las de la app que están más adelante).
$ventanas = New-Object System.Collections.Generic.List[object]
$tapan = @()
$raiz = [MarcaWin]::RootOwner($h)
foreach ($v in [MarcaWin]::AppWindows($h)) {
    $rv = [MarcaWin]::WindowRect($v)
    if (-not $rv.IntersectsWith($pantalla)) { continue }
    $ventanas.Add(@{ h = $v; z = $ventanas.Count; tapan = $tapan; propia = [MarcaWin]::RootOwner($v) -eq $raiz })
    $tapan += $rv
}

# El árbol se recorre por niveles y a mano, no con FindAll: cada elemento se le pregunta a la app, y en algunas eso es
# lento (la cinta de Inventor: ~6 ms por elemento, 1000 elementos, 8 s para 40 botones). Así se saltean las ramas que
# no se ven (fuera de la pantalla o vacías: otras pestañas de la cinta o de un diálogo) y lo que está adentro de un
# botón o un link (casi siempre su texto o su ícono) va en una segunda tanda, solo mientras sobre tiempo. Las ventanas
# de la misma familia (diálogos, paneles de esa ventana) van en la primera; otras ventanas del mismo programa (otra de
# Chrome atrás), en la segunda: casi todo queda tapado. Medido el 23/11: Inventor 8,4 s → ~1,6 s; Chrome y VS Code
# igual que antes (~0,1 s) y con los mismos controles.
# En la primera tanda cada ventana tiene su cola y va entera antes que la de atrás: con un diálogo abierto sobre la
# cinta, el diálogo (lo que se va a tocar) queda leído aunque la cinta llegue al tope. UIA3 (COM, como FlaUI), varios
# hilos o pedir menos propiedades no lo bajan: medido el 23/11, ~7 ms por pregunta a Inventor igual.
$hasta2 = 1500  # ms del reloj: la segunda tanda sigue solo hasta acá
$hasta1 = 4000  # tope de todo: una app muy lenta queda con lo leído hasta ahí (y el OCR completa)
$adentro = 'Button', 'SplitButton', 'Hyperlink', 'TabItem' # los ítems de listas y árboles llevan otros ítems adentro
$tanda1 = New-Object System.Collections.Generic.List[object] # una cola por ventana, de adelante hacia atrás
$tanda2 = New-Object System.Collections.Generic.Queue[object]
$cache.Push()
try {
    foreach ($vv in $ventanas) {
        try { $e = $AE::FromHandle($vv.h) } catch { continue }
        $vv.cola = New-Object System.Collections.Generic.Queue[object]
        if ($vv.propia) { $vv.cola.Enqueue(@($e, $vv)); $vv.enLista = $true; $tanda1.Add($vv) }
        else { $tanda2.Enqueue(@($e, $vv)) }
    }
    # Lo que sale de la segunda tanda (adentro de un botón, otra ventana del programa) vuelve a la cola de su ventana,
    # que vuelve a su lugar entre las otras (de adelante hacia atrás).
    $aLaCola = {
        param($it) $w = $it[1]; $w.cola.Enqueue($it)
        if (-not $w.enLista) { $w.enLista = $true; $i = 0; while ($i -lt $tanda1.Count -and $tanda1[$i].z -lt $w.z) { $i++ }; $tanda1.Insert($i, $w) }
    }
    while ($reloj.ElapsedMilliseconds -lt $hasta1) {
        while ($tanda1.Count -and -not $tanda1[0].cola.Count) { $tanda1[0].enLista = $false; $tanda1.RemoveAt(0) }
        if ($tanda1.Count) { $item = $tanda1[0].cola.Dequeue() }
        elseif ($tanda2.Count -and $reloj.ElapsedMilliseconds -lt $hasta2) { $item = $tanda2.Dequeue() }
        else { break }
        $vv = $item[1]
        $hijos = $null
        try { $hijos = $item[0].CachedChildren } catch { }
        if ($null -eq $hijos) { try { $hijos = $item[0].GetUpdatedCache($cache).CachedChildren } catch { continue } }
        foreach ($e in $hijos) {
            try {
                $c = $e.Cached
                $r = $c.BoundingRectangle
                if ($c.IsOffscreen -or (& $fuera $r)) { continue }
                $tipo = $c.ControlType.ProgrammaticName -replace '^ControlType\.', ''
                if ($tipo -eq 'Pane' -and $c.NativeWindowHandle -and $c.ClassName -in $hojasWin32) {
                    $tipo = [MarcaWin]::Win32Kind([IntPtr]$c.NativeWindowHandle, $c.ClassName)
                    if (-not $tipo) { continue }
                    $sinHijos = $true
                } else { $sinHijos = $tipo -in 'Edit', 'CheckBox', 'RadioButton' } # adentro no tienen nada que se toque
                if ($sinHijos) { }
                elseif ($tipo -in $adentro) { $tanda2.Enqueue(@($e, $vv)) }
                else { & $aLaCola @($e, $vv) }
                if (-not $tipos.Contains($tipo)) { continue }
                if ($r.Width -lt 4 -or $r.Height -lt 4) { continue }
                if ($r.Width * $r.Height -gt $areaPantalla * 0.25) { continue } # un «control» así de grande es la ventana
                $cx = $r.X + $r.Width / 2; $cy = $r.Y + $r.Height / 2
                if (@($vv.tapan | Where-Object { $_.Contains([int]$cx, [int]$cy) }).Count) { continue }
                $nombre = ($c.Name -replace '\s+', ' ').Trim()
                if (-not $nombre -and $tipo -notin 'Edit', 'ComboBox') { continue }
                if ($nombre.Length -gt 70) { $nombre = $nombre.Substring(0, 69) + '…' }
                $clave = "$tipo|$nombre|$([int]$r.X)|$([int]$r.Y)"
                if ($vistos[$clave]) { continue }
                $vistos[$clave] = $true
                $controles.Add([ordered]@{ tipo = $tipo; nombre = $nombre; habilitado = [bool]$c.IsEnabled
                    x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height; z = $vv.z })
            } catch { }
        }
    }
} finally { $cache.Pop() }
$sinTerminar = @($tanda1 | Where-Object { $_.cola.Count }).Count -gt 0 # se cortó por el tope: la lista puede estar incompleta

# La captura va después de leer los controles: si la app todavía estaba cambiando (abriendo una pieza), así coinciden.
[MarcaWin]::Capture($pantalla, $png)

# Los textos que se leen en la captura (OCR de Windows, sin internet) que no están adentro de un control con nombre:
# muchas apps (cintas, diálogos dibujados a mano) no le dicen a Windows qué tienen, pero sus botones tienen letras.
# Una línea del OCR se parte donde hay un hueco grande (en una cinta, «Sweep Emboss Decal» son tres botones).
$textos = New-Object System.Collections.Generic.List[object]
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    $asTask = @([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    # Con tope: si no terminó, .Result esperaría para siempre.
    function Wait-Winrt($op, [Type]$tipo) { $t = $asTask.MakeGenericMethod($tipo).Invoke($null, @($op)); if (-not $t.Wait(5000)) { throw 'El OCR tardó demasiado.' }; $t.Result }
    $motor = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    $archivo = Wait-Winrt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($png)) ([Windows.Storage.StorageFile])
    $flujo = Wait-Winrt ($archivo.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $deco = Wait-Winrt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($flujo)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bmp = Wait-Winrt ($deco.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $ocr = Wait-Winrt ($motor.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    $flujo.Dispose()
    $conNombre = @($controles | Where-Object { $_.nombre })
    foreach ($linea in $ocr.Lines) {
        $grupo = @()
        foreach ($p in $linea.Words) {
            $b = $p.BoundingRect
            if ($grupo.Count) {
                $u = $grupo[-1].BoundingRect
                if ($b.X - ($u.X + $u.Width) -gt [Math]::Max(12, 1.2 * $u.Height)) { $textos.Add($grupo); $grupo = @() }
            }
            $grupo += $p
        }
        if ($grupo.Count) { $textos.Add($grupo) }
    }
    $sueltos = New-Object System.Collections.Generic.List[object]
    foreach ($g in $textos) {
        $x1 = ($g | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum
        $y1 = ($g | ForEach-Object { $_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
        $x2 = ($g | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
        $y2 = ($g | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
        # Palabras pegadas son una sola: el OCR parte «Display» en «Displa» + «y» por la cola de la y.
        $texto = $g[0].Text
        for ($k = 1; $k -lt $g.Count; $k++) {
            $u = $g[$k - 1].BoundingRect
            $texto += $(if ($g[$k].BoundingRect.X - ($u.X + $u.Width) -lt 0.35 * $u.Height) { '' } else { ' ' }) + $g[$k].Text
        }
        $texto = $texto.Trim()
        if ($texto.Length -lt 2 -or $texto -notmatch '\p{L}') { continue }
        if ($texto.Length -gt 50) { $texto = $texto.Substring(0, 49) + '…' }
        # Con un margen chico alrededor: un recuadro pegado a las letras queda apretado.
        $x = [int]($pantalla.X + $x1 - 4); $y = [int]($pantalla.Y + $y1 - 3); $w = [int]($x2 - $x1 + 8); $hh = [int]($y2 - $y1 + 6)
        $cx = $x + $w / 2; $cy = $y + $hh / 2
        if (@($conNombre | Where-Object { $cx -ge $_.x -and $cx -le $_.x + $_.w -and $cy -ge $_.y -and $cy -le $_.y + $_.h }).Count) { continue }
        $sueltos.Add([ordered]@{ tipo = 'Texto'; nombre = $texto; habilitado = $true; x = $x; y = $y; w = $w; h = $hh; z = 99 })
    }
    $textos = $sueltos
} catch { $textos = @() }

# De arriba hacia abajo y de izquierda a derecha, como se lee la pantalla. Los textos completan lo que falta.
$enOrden = { [int]($_.y / 12) }, { $_.x }
$lista = @(@($controles | Sort-Object $enOrden | Select-Object -First $Max) + @($textos | Sort-Object $enOrden | Select-Object -First $MaxTextos) | Sort-Object $enOrden)
for ($i = 0; $i -lt $lista.Count; $i++) { $lista[$i].n = $i + 1 }

[ordered]@{
    png = $png; ventana = $titulo; app = $app
    pantalla = [ordered]@{ x = $pantalla.X; y = $pantalla.Y; w = $pantalla.Width; h = $pantalla.Height }
    controles = $lista
} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Salida "p$n.json") -Encoding UTF8

"Captura de la pantalla: $png ($($pantalla.Width)x$($pantalla.Height)). Mirala con Read solo si la lista no te alcanza."
"Ventana de adelante: «$titulo» ($app). Marito es el panel de la derecha: no lo cuentes."
if ($sinTerminar) { 'La app tardó en decir sus controles y la lista quedó cortada: puede faltar alguno (los «Texto» sí están todos).' }
if ($lista.Count) {
    "Controles y textos de la pantalla (número. tipo «nombre» — centro x,y en fracción de la captura; «Texto» = letras leídas en la captura, el lugar es exacto):"
    foreach ($c in $lista) {
        $cx = (($c.x + $c.w / 2) - $pantalla.X) / $pantalla.Width; $cy = (($c.y + $c.h / 2) - $pantalla.Y) / $pantalla.Height
        $nom = if ($c.nombre) { "«$($c.nombre)»" } else { '(sin nombre)' }
        $off = if (-not $c.habilitado) { ' [deshabilitado]' } else { '' }
        '{0}. {1} {2} — {3:0.00},{4:0.00}{5}' -f $c.n, $nombresTipo[$c.tipo], $nom, $cx, $cy, $off
    }
} else {
    'No encontré controles ni textos: si el lugar se ve en la captura, marcalo con una caja.'
}
"($([int]$reloj.ElapsedMilliseconds) ms)"
