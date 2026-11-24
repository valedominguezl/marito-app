# Marito v3: Alt+F2 la barra, Alt+F1 la ventana, Alt+F3 marcar una zona (desde capturas.ahk).
# Toma lo que tenés adelante (captura, pestaña del navegador, ventana de VS Code o carpeta del Explorador), reconoce el
# proyecto (o abre un «Chat libre»), arranca server.mjs y abre la ventana (WebView2 sin marco, redimensionable).
# Si ya hay una ventana abierta, le pasa lo nuevo (la interfaz decide si va a otra pestaña) y le dice cómo mostrarse.
#
#   (sin nada)      Alt+F1, el ícono fijado o una zona: la ventana del costado (lo de siempre)
#   -Barra          Alt+F2: la barra de una línea en el medio de la pantalla de adelante (modo compacto)
#   -Recorte        usar la imagen del portapapeles (recorte de ZoomIt) en vez de la ventana entera
#   -Ventana <hwnd> prueba: usar esa ventana en vez de la que tenés adelante
#   -Prueba         muestra qué leyó (página, sitio, proyecto, captura) y sale, sin servidor ni ventana
#   -SoloServidor   prueba: deja el servidor corriendo, sin ventana, y escribe puerto/token (no se apaga solo)
#   -Zona           Alt+F3: primero el usuario marca una zona de la pantalla (marcar.ps1 -Zona); va el recorte con
#                   dónde estaba, y el proyecto sale de la ventana que hay debajo. -DesdeMarito: lo pidió el botón de
#                   Marito (que ya se minimizó): si cancela, Marito vuelve igual.
param([switch]$Recorte, [long]$Ventana = 0, [switch]$Prueba, [switch]$SoloServidor, [switch]$Zona, [switch]$DesdeMarito, [switch]$Barra, [switch]$Grande) # -Grande: el de antes, igual que sin nada

# Continue: git, gh y node escriben en stderr aunque anden bien.
$ErrorActionPreference = 'Continue'
$reloj = [Diagnostics.Stopwatch]::StartNew()
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$lib = Join-Path $aqui 'lib'
$base = Join-Path $env:LOCALAPPDATA 'arreglo'
New-Item -ItemType Directory -Force $base | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$sesion = Join-Path $base $stamp
$script:logArchivo = Join-Path $base 'abrir.log'
function Write-Marca([string]$texto) {
    try { Add-Content -Path $script:logArchivo -Value ("{0} +{1}ms {2}" -f (Get-Date -Format 'HH:mm:ss.fff'), $reloj.ElapsedMilliseconds, $texto) -Encoding UTF8 } catch { }
}
Write-Marca "inicio $stamp recorte=$($Recorte.IsPresent) zona=$($Zona.IsPresent)"
$AUMID = 'Valedominguezl.Marito'

# Alt+F1 / botón de la zona: antes que nada, que la marque (la pantalla se congela tal como estaba).
$script:zonaElegida = $null
$script:zonaCancelada = $false
if ($Zona) {
    $pngZona = Join-Path $env:TEMP "marito-zona-$stamp.png"
    $argsZona = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', (Join-Path $aqui 'marcar.ps1'), '-Zona', $pngZona)
    if ($DesdeMarito) { $argsZona += '-EsperarMarito' }
    try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { } # marcar.ps1 escribe en UTF-8 (la nota tiene «×» y acentos)
    $salidaZona = & powershell.exe @argsZona
    Write-Marca "zona: $salidaZona"
    try { $script:zonaElegida = [string]($salidaZona | Select-Object -Last 1) | ConvertFrom-Json } catch { }
    if (-not $script:zonaElegida -or -not (Test-Path $pngZona)) {
        # Canceló: si lo pidió el botón, Marito vuelve como estaba, con el mismo pedido que una zona elegida pero sin
        # entrada (más abajo). Un ShowWindow suelto desde este proceso la dejaba adelante pero sin dibujar la barra:
        # invisible y sin tomar clicks (probado el 24/11).
        $script:zonaElegida = $null
        if (-not $DesdeMarito) { exit }
        $script:zonaCancelada = $true
    }
}

# ---------- código nativo (se compila una vez y queda guardado en lib\) ----------
$fuenteNativa = @'
using System; using System.Text; using System.Runtime.InteropServices; using System.Windows.Forms;
public static class ArregloWin {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ReleaseCapture();
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool FlashWindowEx(ref FLASHWINFO f);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr LoadLibrary(string path);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] public static extern int SetCurrentProcessExplicitAppUserModelID(string id);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h, int a, ref int v, int s);
    [DllImport("dwmapi.dll")] public static extern int DwmExtendFrameIntoClientArea(IntPtr h, ref MARGINS m);
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("dwmapi.dll")] public static extern int DwmEnableBlurBehindWindow(IntPtr h, ref BLURBEHIND b);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int l, int t, int r, int b);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateRoundRectRgn(int l, int t, int r, int b, int w, int h);
    [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr h, IntPtr rgn, bool redraw);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
    public struct MARGINS { public int l, r, t, b; }
    public struct BLURBEHIND { public int flags; public bool enable; public IntPtr region; public bool transitionOnMaximized; }
    [StructLayout(LayoutKind.Sequential)] public struct FLASHWINFO { public uint cbSize; public IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout; }
    // Mover la ventana desde la barra de la interfaz: es como arrastrar el título.
    public static void Drag(IntPtr h) { ReleaseCapture(); SendMessage(h, 0xA1, (IntPtr)2, IntPtr.Zero); }
    // Cambiar el tamaño desde un borde de la interfaz (10..17 = HTLEFT..HTBOTTOMRIGHT).
    public static void Resize(IntPtr h, int borde) { ReleaseCapture(); SendMessage(h, 0xA1, (IntPtr)borde, IntPtr.Zero); }
    public static string Title(IntPtr h) { StringBuilder s = new StringBuilder(1024); GetWindowText(h, s, 1024); return s.ToString(); }
    public static string ClassOf(IntPtr h) { StringBuilder s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
    // Que la barra de tareas titile hasta que se mire la ventana.
    public static void Flash(IntPtr h) { FLASHWINFO f = new FLASHWINFO(); f.cbSize = (uint)Marshal.SizeOf(f); f.hwnd = h; f.dwFlags = 2 | 12; f.uCount = 3; f.dwTimeout = 0; FlashWindowEx(ref f); }
    public static void Corners(IntPtr h, bool round) { int v = round ? 2 : 1; DwmSetWindowAttribute(h, 33, ref v, 4); }
    // Tapada (DWMWA_CLOAK): existe y se dibuja, pero no se ve. Así no aparece vacía mientras carga la página.
    public static void Cloak(IntPtr h, bool on) { int v = on ? 1 : 0; DwmSetWindowAttribute(h, 13, ref v, 4); }
    // Fijada en la barra de tareas: sin esto Windows guarda un acceso a powershell.exe pelado (sin ícono ni abrir.ps1).
    // Se le dice a la ventana su identidad, con qué comando volver a abrirla, su ícono y su nombre.
    [StructLayout(LayoutKind.Sequential)] public struct PROPERTYKEY { public Guid fmtid; public uint pid; }
    [StructLayout(LayoutKind.Explicit, Size = 24)] public struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore {
        [PreserveSig] int GetCount(out uint c);
        [PreserveSig] int GetAt(uint i, out PROPERTYKEY k);
        [PreserveSig] int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
        [PreserveSig] int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v);
        [PreserveSig] int Commit();
    }
    [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore ps);
    public static bool SetRelaunch(IntPtr h, string id, string command, string icon, string name) {
        Guid iid = typeof(IPropertyStore).GUID; IPropertyStore ps;
        if (SHGetPropertyStoreForWindow(h, ref iid, out ps) != 0 || ps == null) return false;
        Guid fmt = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"); // PKEY_AppUserModel_*
        string[] vals = { id, command, icon, name }; uint[] pids = { 5, 2, 3, 4 }; bool ok = true;
        try {
            for (int i = 0; i < 4; i++) {
                PROPERTYKEY k = new PROPERTYKEY(); k.fmtid = fmt; k.pid = pids[i];
                PROPVARIANT v = new PROPVARIANT(); v.vt = 31; v.p = Marshal.StringToCoTaskMemUni(vals[i]); // VT_LPWSTR
                try { ok &= ps.SetValue(ref k, ref v) == 0; } finally { Marshal.FreeCoTaskMem(v.p); }
            }
            ok &= ps.Commit() == 0;
        } finally { Marshal.ReleaseComObject(ps); }
        return ok;
    }
    // Sin el borde fino que Windows 11 dibuja alrededor (se ve blanco cuando la ventana no tiene el foco).
    public static void NoBorder(IntPtr h) { int v = -2; DwmSetWindowAttribute(h, 34, ref v, 4); } // DWMWA_COLOR_NONE
    // El marco extendido a toda la ventana da la sombra nativa. En la barra no va: la sombra y las esquinas las dibuja
    // el CSS (la barra y la tarjeta son dos cajas con aire transparente entre ellas).
    public static void Frame(IntPtr h, bool on) { MARGINS m = new MARGINS(); int v = on ? -1 : 0; m.l = v; m.r = v; m.t = v; m.b = v; DwmExtendFrameIntoClientArea(h, ref m); }
    // Otro abrir.ps1 (Alt+F2 de nuevo, Alt+F1) le pasa a la ventana abierta cómo mostrarse (WM_COPYDATA, texto JSON).
    // Antes le cede el permiso de pasar adelante: el que apretó el atajo es él.
    public struct COPYDATASTRUCT { public IntPtr dwData; public int cbData; public IntPtr lpData; }
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, int msg, IntPtr w, ref COPYDATASTRUCT l, uint flags, uint timeout, out IntPtr res);
    [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int pid);
    public static bool SendText(IntPtr h, string s) {
        COPYDATASTRUCT cd = new COPYDATASTRUCT(); cd.lpData = Marshal.StringToHGlobalUni(s); cd.cbData = (s.Length + 1) * 2;
        try { IntPtr r; return SendMessageTimeout(h, 0x4A, IntPtr.Zero, ref cd, 2, 3000, out r) != IntPtr.Zero && r == (IntPtr)1; }
        finally { Marshal.FreeHGlobal(cd.lpData); }
    }
    // Minimizada: vuelve directo al lugar pedido (sin aparecer un instante donde estaba). Las coordenadas de
    // WINDOWPLACEMENT son del área de trabajo de la pantalla principal.
    public struct WINDOWPLACEMENT { public int length, flags, showCmd; public System.Drawing.Point min, max; public RECT normal; }
    [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT p);
    [DllImport("user32.dll")] static extern bool SetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT p);
    public static void RestoreTo(IntPtr h, System.Drawing.Rectangle r) {
        WINDOWPLACEMENT p = new WINDOWPLACEMENT(); p.length = Marshal.SizeOf(p); GetWindowPlacement(h, ref p);
        Screen pri = Screen.PrimaryScreen; int dx = pri.WorkingArea.Left - pri.Bounds.Left, dy = pri.WorkingArea.Top - pri.Bounds.Top;
        p.normal.Left = r.Left - dx; p.normal.Top = r.Top - dy; p.normal.Right = r.Right - dx; p.normal.Bottom = r.Bottom - dy;
        p.showCmd = 9; p.flags = 0; SetWindowPlacement(h, ref p);
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    // Dónde termina lo libre abajo: el borde de arriba de la barra de tareas si está a la vista (también la que se
    // oculta sola, mientras aparece), o el área de trabajo.
    public static int FreeBottom(Screen s) {
        int b = s.WorkingArea.Bottom;
        RECT r; IntPtr t = FindWindow("Shell_TrayWnd", null);
        if (t != IntPtr.Zero && GetWindowRect(t, out r) && r.Left <= s.Bounds.Left + 2 && r.Right >= s.Bounds.Right - 2
            && r.Bottom >= s.Bounds.Bottom - 2 && r.Top > s.Bounds.Top + s.Bounds.Height / 2 && r.Top < s.Bounds.Bottom - 4)
            b = Math.Min(b, r.Top);
        return b;
    }
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    // Dónde empieza la página en el navegador de más arriba de esa pantalla (debajo de la barra de favoritos): el
    // borde de arriba de su Chrome_RenderWidgetHostHWND. -1 si no hay ninguno a la vista.
    public static int BrowserContentTop(Screen s) {
        int top = -1;
        EnumWindows((h, l) => {
            if (!IsWindowVisible(h) || IsIconic(h) || ClassOf(h) != "Chrome_WidgetWin_1") return true;
            RECT w; if (!GetWindowRect(h, out w) || w.Right - w.Left < 200) return true;
            if (!Screen.FromHandle(h).Bounds.Equals(s.Bounds)) return true;
            string proc = "";
            try { uint pid; GetWindowThreadProcessId(h, out pid); proc = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.ToLower(); } catch { }
            if (proc != "chrome" && proc != "msedge" && proc != "brave" && proc != "vivaldi" && proc != "opera") return true;
            int t = -1, ancho = w.Right - w.Left;
            EnumChildWindows(h, (c, l2) => {
                RECT q;
                if (IsWindowVisible(c) && ClassOf(c) == "Chrome_RenderWidgetHostHWND" && GetWindowRect(c, out q) && q.Right - q.Left > ancho / 2 && (t < 0 || q.Top < t)) t = q.Top;
                return true;
            }, IntPtr.Zero);
            if (t < 0) return true;
            top = t; return false; // EnumWindows va de adelante hacia atrás: el primero es el que se ve
        }, IntPtr.Zero);
        return top;
    }
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
    static bool IsShell(IntPtr h) {
        string c = ClassOf(h);
        return c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd" || c == "Progman" || c == "WorkerW"
            || c == "Windows.UI.Core.CoreWindow" || c == "TopLevelWindowForOverflowXamlIsland" || c == "XamlExplorerHostIslandWindow";
    }
    // Abierta desde el ícono de la barra de tareas, el menú Inicio o el escritorio, lo de adelante es eso y no lo que
    // estabas usando: se toma la ventana de verdad de más arriba (visible, con título, ni de herramientas ni oculta).
    public static IntPtr WorkWindow(IntPtr fg) {
        if (fg != IntPtr.Zero && !IsShell(fg)) return fg;
        IntPtr found = IntPtr.Zero; uint yo = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
        EnumWindows((h, l) => {
            if (!IsWindowVisible(h) || IsIconic(h) || IsShell(h) || Title(h).Length == 0) return true;
            if ((GetWindowLong(h, -20) & (0x80 | 0x20 | 0x08000000)) != 0) return true; // TOOLWINDOW, TRANSPARENT, NOACTIVATE
            int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
            uint pid; GetWindowThreadProcessId(h, out pid); if (pid == yo) return true;
            if (Title(h) == "Marito" && ClassOf(h).StartsWith("WindowsForms10")) return true; // otra ventana de Marito
            found = h; return false; // EnumWindows va de adelante hacia atrás
        }, IntPtr.Zero);
        return found != IntPtr.Zero ? found : fg;
    }
    // Las ventanas de atrás que se ven (una por programa, hasta max), «título<TAB>programa»: con Copilot adelante y
    // Inventor atrás, «¿cómo revierto el zoom?» era de Inventor y Claude contestaba de Copilot.
    public static string[] Behind(IntPtr fg, int max) {
        var res = new System.Collections.Generic.List<string>(); var vistos = new System.Collections.Generic.HashSet<uint>();
        uint yo = (uint)System.Diagnostics.Process.GetCurrentProcess().Id, pfg; GetWindowThreadProcessId(fg, out pfg);
        vistos.Add(yo); vistos.Add(pfg);
        EnumWindows((h, l) => {
            if (h == fg || !IsWindowVisible(h) || IsIconic(h) || IsShell(h) || Title(h).Length == 0) return true;
            if ((GetWindowLong(h, -20) & (0x80 | 0x20 | 0x08000000)) != 0) return true;
            int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
            RECT r; if (!GetWindowRect(h, out r) || r.Right - r.Left < 300 || r.Bottom - r.Top < 200) return true;
            if (Title(h) == "Marito" && ClassOf(h).StartsWith("WindowsForms10")) return true;
            uint pid; GetWindowThreadProcessId(h, out pid); if (!vistos.Add(pid)) return true;
            string proc = ""; try { proc = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { }
            res.Add(Title(h) + "\t" + proc);
            return res.Count < max;
        }, IntPtr.Zero);
        return res.ToArray();
    }
    // Puntito naranja en el ícono de la barra de tareas (Windows 11 lo pone arriba a la derecha): hay algo sin ver.
    static System.Drawing.Icon badge;
    public static void Badge(IntPtr h, bool on) {
        try {
            if (on && badge == null) {
                using (System.Drawing.Bitmap b = new System.Drawing.Bitmap(16, 16))
                using (System.Drawing.Graphics g = System.Drawing.Graphics.FromImage(b))
                using (System.Drawing.SolidBrush naranja = new System.Drawing.SolidBrush(System.Drawing.Color.FromArgb(249, 115, 22))) {
                    g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                    g.FillEllipse(naranja, 2, 2, 12, 12);
                    badge = System.Drawing.Icon.FromHandle(b.GetHicon());
                }
            }
            ITaskbarList3 t = (ITaskbarList3)new TaskbarList(); t.HrInit();
            t.SetOverlayIcon(h, on ? badge.Handle : IntPtr.Zero, on ? "Hay algo nuevo" : null);
        } catch { }
    }

}
[ComImport, Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ITaskbarList3 {
    void HrInit(); void AddTab(IntPtr h); void DeleteTab(IntPtr h); void ActivateTab(IntPtr h); void SetActiveAlt(IntPtr h);
    void MarkFullscreenWindow(IntPtr h, bool f);
    void SetProgressValue(IntPtr h, ulong a, ulong b); void SetProgressState(IntPtr h, int f);
    void RegisterTab(IntPtr a, IntPtr b); void UnregisterTab(IntPtr a); void SetTabOrder(IntPtr a, IntPtr b); void SetTabActive(IntPtr a, IntPtr b, uint f);
    void ThumbBarAddButtons(IntPtr h, uint n, IntPtr b); void ThumbBarUpdateButtons(IntPtr h, uint n, IntPtr b); void ThumbBarSetImageList(IntPtr h, IntPtr l);
    void SetOverlayIcon(IntPtr h, IntPtr icon, [MarshalAs(UnmanagedType.LPWStr)] string desc);
}
[ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090")] class TaskbarList { }
// El velo que oscurece la pantalla mientras entra la barra: negro semitransparente, deja pasar los clicks (0x20), no
// toma el foco (0x08000000), sin botón en la barra de tareas (0x80) y fuera de las capturas (WDA_EXCLUDEFROMCAPTURE).
public class DimForm : Form {
    [DllImport("user32.dll")] static extern bool SetWindowDisplayAffinity(IntPtr h, uint a);
    public DimForm() {
        FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; StartPosition = FormStartPosition.Manual;
        BackColor = System.Drawing.Color.Black; Opacity = 0; TopMost = true;
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
        get { CreateParams cp = base.CreateParams; cp.ExStyle |= 0x80000 | 0x20 | 0x08000000 | 0x80; return cp; }
    }
    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); SetWindowDisplayAffinity(Handle, 0x11); }
}
public class ArregloForm : Form {
    // Separación de abajo (por encima de la barra de tareas, sin tapar el scroll de abajo de la app de atrás).
    public int Gap = 20;
    int lastTarget = -1;
    Timer follow;
    // Mientras está apoyada abajo, acompaña a la barra de tareas cuando aparece o se va (cuadro a cuadro, con su
    // animación). Si la movieron o maximizaron (el borde de abajo ya no está donde se la dejó), no la toca.
    void FollowTaskbar() {
        if (WindowState != FormWindowState.Normal) return;
        int target = ArregloWin.FreeBottom(Screen.FromHandle(Handle)) - Gap;
        if (lastTarget >= 0 && target != lastTarget && Bottom == lastTarget) Top += target - lastTarget;
        lastTarget = target;
        ApplyShape(target);
    }
    // Normal y flotando: las cuatro esquinas redondeadas (DWM). Apoyada sobre la barra de tareas (o el borde de
    // abajo): solo las de arriba, para que parezca que sale de la barra (región; DWM no redondea esquinas sueltas).
    // Maximizada o pantalla completa (Floating = false): cuadrada.
    public bool Floating = true;
    int shape = -1; System.Drawing.Size shapeSize;
    void ApplyShape(int freeBottom) {
        if (WindowState != FormWindowState.Normal) return;
        int s = !Floating ? 0 : Bottom == freeBottom ? 1 : 2;
        if (s == shape && (s != 1 || Size == shapeSize)) return;
        shape = s; shapeSize = Size;
        foreach (IntPtr h in new IntPtr[] { Handle }) {
            ArregloWin.Corners(h, s == 2);
            if (s == 1) {
                int d = (int)(16 * ArregloWin.GetDpiForWindow(Handle) / 96);
                ArregloWin.SetWindowRgn(h, ArregloWin.CreateRoundRectRgn(0, 0, Width + 1, Height + d + 1, d, d), true);
            } else ArregloWin.SetWindowRgn(h, IntPtr.Zero, true);
        }
    }
    // Minimizable desde la barra de tareas (0x20000 | 0x80000) y con marco redimensionable (0x40000): sin ese estilo
    // Windows no deja cambiar el tamaño desde los bordes de la interfaz.
    protected override CreateParams CreateParams {
        get { CreateParams cp = base.CreateParams; cp.Style |= 0x20000 | 0x80000 | 0x40000; return cp; }
    }
    // El marco no se dibuja: todo el rectángulo de la ventana es la interfaz (WM_NCCALCSIZE sin borde).
    // Al perder el foco Windows pintaba encima su barra de título clásica (borde blanco, ícono y título, botones
    // estilo XP): WM_NCACTIVATE con lParam -1 no repinta el marco, y los dibujos de título de uxtheme (0xAE/0xAF) se saltean.
    // Cambiar el tamaño desde un borde de la interfaz. Mientras dura, el borde de enfrente no se mueve: si no,
    // al llevar el de abajo hasta la barra de tareas Windows la estira a todo el alto (también arriba).
    int sizingEdge; int anchorTop, anchorBottom;
    public void BeginResize(int borde) {
        sizingEdge = borde; anchorTop = Top; anchorBottom = Bottom;
        try { ArregloWin.Resize(Handle, borde); } finally { sizingEdge = 0; }
    }
    public struct WINDOWPOS { public IntPtr hwnd, after; public int x, y, cx, cy; public uint flags; }
    // Lo que manda otro abrir.ps1 (ArregloWin.SendText): se atiende después, así el que lo mandó no espera.
    public event Action<string> Pedido;
    protected override void WndProc(ref Message m) {
        if (m.Msg == 0x4A) { // WM_COPYDATA
            ArregloWin.COPYDATASTRUCT cd = (ArregloWin.COPYDATASTRUCT)Marshal.PtrToStructure(m.LParam, typeof(ArregloWin.COPYDATASTRUCT));
            string s = Marshal.PtrToStringUni(cd.lpData, Math.Max(0, cd.cbData / 2 - 1));
            Action<string> f = Pedido;
            if (f != null) BeginInvoke(f, s);
            m.Result = (IntPtr)1; return;
        }
        if (m.Msg == 0x46 && sizingEdge != 0) { // WM_WINDOWPOSCHANGING
            WINDOWPOS wp = (WINDOWPOS)Marshal.PtrToStructure(m.LParam, typeof(WINDOWPOS));
            if ((wp.flags & 3) == 0) { // ni SWP_NOSIZE ni SWP_NOMOVE
                if (sizingEdge >= 15 && sizingEdge <= 17) { int b = wp.y + wp.cy; wp.y = anchorTop; wp.cy = b - anchorTop; }
                else if (sizingEdge >= 12 && sizingEdge <= 14) wp.cy = anchorBottom - wp.y;
                Marshal.StructureToPtr(wp, m.LParam, false);
            }
        }
        if (m.Msg == 0x83 && m.WParam != IntPtr.Zero) { m.Result = IntPtr.Zero; return; }
        if (m.Msg == 0xAE || m.Msg == 0xAF) { m.Result = IntPtr.Zero; return; }
        if (m.Msg == 0x86) m.LParam = new IntPtr(-1);
        base.WndProc(ref m);
    }
    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        ArregloWin.Corners(Handle, true); // esquinas redondeadas de Windows 11
        // Ventana de vidrio: el marco extendido a toda la ventana da la sombra nativa, y el «blur behind» con una
        // región vacía hace que el fondo negro del form sea transparente (alfa por píxel), sin el acrílico de Windows:
        // El tinte y la transparencia de cada parte los pone el CSS.
        ArregloWin.MARGINS m = new ArregloWin.MARGINS(); m.l = -1; m.r = -1; m.t = -1; m.b = -1;
        ArregloWin.DwmExtendFrameIntoClientArea(Handle, ref m);
        ArregloWin.BLURBEHIND b = new ArregloWin.BLURBEHIND(); b.flags = 3; b.enable = true; b.region = ArregloWin.CreateRectRgn(0, 0, -1, -1);
        ArregloWin.DwmEnableBlurBehindWindow(Handle, ref b);
        ArregloWin.NoBorder(Handle);
        follow = new Timer(); follow.Interval = 15; follow.Tick += delegate { FollowTaskbar(); }; follow.Start();
    }
    protected override void OnFormClosed(FormClosedEventArgs e) {
        if (follow != null) follow.Stop();
        base.OnFormClosed(e);
    }
}
'@
$hashNativo = [BitConverter]::ToString((New-Object Security.Cryptography.SHA1Managed).ComputeHash([Text.Encoding]::UTF8.GetBytes($fuenteNativa))).Replace('-', '').Substring(0, 8)
$dllNativa = Join-Path $lib "arreglo-native-$hashNativo.dll"
if (-not (Test-Path $dllNativa)) {
    Add-Type -TypeDefinition $fuenteNativa -ReferencedAssemblies System.Windows.Forms, System.Drawing -OutputAssembly $dllNativa
    # Las de versiones anteriores ya no sirven (si otra ventana vieja la tiene abierta, queda para la próxima).
    Get-ChildItem $lib -Filter 'arreglo-native-*.dll' | Where-Object { $_.FullName -ne $dllNativa } | ForEach-Object { try { Remove-Item $_.FullName -ErrorAction Stop } catch { } }
}
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, UIAutomationClient, UIAutomationTypes
Add-Type -Path $dllNativa
Write-Marca 'nativo listo'

# ---------- 1. Lo que tenés adelante, antes que nada (que no cambie) ----------
[ArregloWin]::SetProcessDPIAware() | Out-Null
$hwnd = if ($Ventana) { [IntPtr]$Ventana } elseif ($script:zonaElegida -and $script:zonaElegida.hwnd) { [IntPtr][int64]$script:zonaElegida.hwnd } else { [ArregloWin]::WorkWindow([ArregloWin]::GetForegroundWindow()) }
# La configuración vive con los datos (la escribe el servidor); la de la carpeta del programa es la de antes.
$config = $null
foreach ($c in @((Join-Path $base 'proyectos.json'), (Join-Path $aqui 'proyectos.json'))) {
    if (-not $config -and (Test-Path $c)) { try { $config = Get-Content $c -Raw -Encoding UTF8 | ConvertFrom-Json } catch { } }
}
if (-not $config) { $config = [pscustomobject]@{ raiz = ''; ultimo = ''; proyectos = @() } }
$genericos = @()
try { $genericos = @(Get-Content (Join-Path $aqui 'genericos.json') -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { }

$activoArchivo = Join-Path $base 'activo.json'
$nuevo = $false
$mutex = $null
if (-not $Prueba -and -not $SoloServidor) {
    $mutex = New-Object System.Threading.Mutex($true, 'Local\ArregloRapidoV2', [ref]$nuevo)
}

function Save-Captura([bool]$delPortapapeles, [string]$destino) {
    # Devuelve @{ ruta; origen } o $null. Solo el recorte que el usuario copió (Shift+F1 y Alt+F2): la ventana de
    # adelante ya no se captura sola (pedido del usuario 23/11: las capturas las manda él cuando quiere).
    if ($script:zonaElegida) {
        try { Move-Item $script:zonaElegida.ruta $destino -Force; return @{ ruta = $destino; origen = 'zona'; nota = [string]$script:zonaElegida.nota } } catch { return $null }
    }
    if (-not $delPortapapeles) { return $null }
    try {
        $img = [System.Windows.Forms.Clipboard]::GetImage()
        if ($img) { $img.Save($destino, [System.Drawing.Imaging.ImageFormat]::Png); $img.Dispose(); return @{ ruta = $destino; origen = 'recorte' } }
    } catch { }
    return $null
}

function Test-Generico([string]$sitio) {
    $h = ($sitio -replace ':\d+$', '').ToLower()
    if (-not $h -or $h -match '^\d+\.\d+\.\d+\.\d+$') { return $true }
    foreach ($g in $genericos) { if ($h -eq $g -or $h.EndsWith(".$g")) { return $true } }
    return $false
}

# Proyecto conocido para una carpeta: la carpeta es la del proyecto o está adentro; o adentro hay uno solo.
function Find-ProyectoPorCarpeta([string]$carpeta) {
    $k = $carpeta.TrimEnd('\').ToLower()
    foreach ($p in @($config.proyectos)) {
        $c = ([string]$p.carpeta).TrimEnd('\').ToLower()
        if ($k -eq $c -or $k.StartsWith("$c\")) { return $p.nombre }
    }
    $dentro = @($config.proyectos | Where-Object { ([string]$_.carpeta).ToLower().StartsWith("$k\") })
    if ($dentro.Count -eq 1) { return $dentro[0].nombre }
    return $null
}

# Carpetas que VS Code tiene abiertas (o abrió alguna vez), de su storage.json.
function Get-CarpetasVSCode {
    $st = $null
    try { $st = Get-Content (Join-Path $env:APPDATA 'Code\User\globalStorage\storage.json') -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return @() }
    $uris = New-Object System.Collections.Generic.List[string]
    $ws = $st.windowsState
    if ($ws.lastActiveWindow.folder) { $uris.Add($ws.lastActiveWindow.folder) }
    foreach ($w in @($ws.openedWindows)) { if ($w.folder) { $uris.Add($w.folder) } }
    foreach ($f in @($st.backupWorkspaces.folders)) { if ($f.folderUri) { $uris.Add($f.folderUri) } }
    if ($st.profileAssociations.workspaces) { foreach ($n in $st.profileAssociations.workspaces.PSObject.Properties.Name) { $uris.Add($n) } }
    $out = @()
    foreach ($u in $uris) {
        if ($u -notlike 'file:///*') { continue }
        # file:///c%3A/Users/... → c:\Users\... ([Uri] no decodifica el %3A del disco)
        try { $out += [Uri]::UnescapeDataString($u.Substring(8)).Replace('/', '\').TrimEnd('\') } catch { }
    }
    return $out
}

function Find-RaizGit([string]$carpeta) {
    $d = $carpeta
    while ($d) {
        if (Test-Path (Join-Path $d '.git')) { return $d }
        $padre = Split-Path -Parent $d
        if (-not $padre -or $padre -eq $d) { break }
        $d = $padre
    }
    return $null
}

# Todo lo que se sabe de lo que hay adelante: proyecto (o '' = Chat libre), carpeta, página, dónde estaba, captura.
function Get-Contexto([string]$destinoCaptura) {
    $r = [ordered]@{ proyecto = ''; carpeta = ''; sitio = ''; url = ''; donde = ''; app = ''; captura = $null; origenCaptura = 'ventana'; notaCaptura = '' }
    $cap = Save-Captura $Recorte.IsPresent $destinoCaptura
    if ($cap) { $r.captura = $cap.ruta; $r.origenCaptura = $cap.origen; if ($cap.nota) { $r.notaCaptura = $cap.nota } }
    Write-Marca $(if ($cap) { "captura $($cap.origen)" } else { 'sin captura' })

    $proc = ''
    try { $pidVentana = 0; [ArregloWin]::GetWindowThreadProcessId($hwnd, [ref]$pidVentana) | Out-Null; $proc = (Get-Process -Id $pidVentana -ErrorAction Stop).ProcessName } catch { }
    $titulo = [ArregloWin]::Title($hwnd)

    if ($proc -match '^(chrome|msedge|firefox|brave|opera|vivaldi|arc)$') {
        # Navegador: la dirección por UI Automation y el proyecto por el sitio (los genéricos no cuentan).
        $r.app = 'navegador'
        try {
            $el = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
            $cond = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
            $edit = $el.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
            if ($edit) { $r.url = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value }
        } catch { }
        $r.url = $r.url -replace '^[a-z]+://', ''
        $r.sitio = (($r.url -split '[/?#]')[0]) -replace '^www\.', ''
        if ($r.sitio -and -not (Test-Generico $r.sitio)) {
            $p = @($config.proyectos) | Where-Object { $q = $_; @($q.sitios) | Where-Object { $_ -and $r.sitio -like "*$_*" } } | Select-Object -First 1
            if ($p) { $r.proyecto = $p.nombre }
        }
    } elseif ($proc -match '^Code( - Insiders)?$') {
        # VS Code: el título es «archivo - carpeta - Visual Studio Code»; la carpeta se busca entre las que abrió.
        $r.app = 'vscode'
        $partes = @(($titulo -replace '^●\s*', '') -split ' - ')
        if ($partes.Count -ge 2 -and $partes[-1] -like 'Visual Studio Code*') {
            $raiz = if ($partes.Count -ge 3) { $partes[-2] } else { $partes[0] }
            $raiz = $raiz -replace '\s*\[[^\]]*\]$', ''
            $archivo = if ($partes.Count -ge 3) { ($partes[0..($partes.Count - 3)] -join ' - ') } else { '' }
            $carpeta = Get-CarpetasVSCode | Where-Object { (Split-Path -Leaf $_) -eq $raiz -and (Test-Path $_) } | Select-Object -First 1
            if ($carpeta) {
                $nombre = Find-ProyectoPorCarpeta $carpeta
                if ($nombre) { $r.proyecto = $nombre } else { $r.carpeta = $carpeta }
                $r.donde = if ($archivo) { "En VS Code tenía abierto «$archivo» (carpeta $carpeta)." } else { "En VS Code tenía abierta la carpeta $carpeta." }
            }
        }
    } elseif ($proc -eq 'explorer' -and [ArregloWin]::ClassOf($hwnd) -eq 'CabinetWClass') {
        # Explorador: la carpeta abierta; si es de un repo, ese proyecto.
        $r.app = 'explorador'
        try {
            foreach ($w in (New-Object -ComObject Shell.Application).Windows()) {
                if ([int64]$w.HWND -eq [int64]$hwnd) {
                    $carpeta = $w.Document.Folder.Self.Path
                    if ($carpeta -and (Test-Path $carpeta)) {
                        $r.donde = "En el Explorador tenía abierta la carpeta $carpeta."
                        $nombre = Find-ProyectoPorCarpeta $carpeta
                        if ($nombre) { $r.proyecto = $nombre } else { $git = Find-RaizGit $carpeta; if ($git) { $r.carpeta = $git } }
                    }
                    break
                }
            }
        } catch { }
    } elseif ($proc -and $titulo) {
        # Cualquier otro programa (Inventor, Excel…): que Claude sepa qué tenías adelante, así «¿cómo revierto el
        # zoom?» es de ese programa y no una respuesta general.
        $r.app = $proc
        $r.donde = "Tenía adelante «$titulo» (programa $proc)."
    }
    # Lo de atrás que se ve: la pregunta puede ser de eso aunque el foco estuviera en otra cosa (Copilot adelante, Inventor atrás).
    $atras = @()
    try { $atras = @([ArregloWin]::Behind($hwnd, 3) | ForEach-Object { $t, $p = $_ -split "`t", 2; "«$t» ($p)" }) } catch { }
    if ($atras.Count) { $r.donde = ("$($r.donde) Atrás, abiertas: $($atras -join ', ').").Trim() }
    Write-Marca "contexto app=$($r.app) proyecto=$($r.proyecto) carpeta=$($r.carpeta) url=$($r.url)"
    return $r
}

# ---------- Segunda vez: no abrir otra ventana; pasarle lo nuevo y traerla ----------
if ($mutex -and -not $nuevo) {
    Write-Marca 'ya hay una ventana'
    $activo = $null
    try { $activo = Get-Content $activoArchivo -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
    if ($activo) {
        if (-not $script:zonaCancelada -and ($activo.hwnd -ne [int64]$hwnd -or $script:zonaElegida)) { # una zona va aunque esté sobre Marito
            $png = Join-Path $env:TEMP "marito-$stamp.png"
            $c = Get-Contexto $png
            $cuerpo = @{ proyecto = $c.proyecto; carpeta = $c.carpeta; sitio = $c.sitio; url = $c.url; donde = $c.donde; ruta = $c.captura; origen = $c.origenCaptura; nota = $c.notaCaptura }
            # Con el fijo, traerla escondida con Alt+F1/F2 limpia las pestañas como abrirla de nuevo (pedido del usuario,
            # 24/11). Una zona no: la del botón esconde a Marito a propósito y vuelve a lo que estabas haciendo.
            if (-not $Zona -and (Test-Path (Join-Path $base 'remoto.json')) -and [ArregloWin]::IsIconic([IntPtr][int64]$activo.hwnd)) { $cuerpo.abrir = $true }
            try {
                Invoke-RestMethod -Uri "http://127.0.0.1:$($activo.puerto)/api/entrada" -Method Post -TimeoutSec 4 `
                    -Headers @{ 'X-Token' = $activo.token } -ContentType 'application/json; charset=utf-8' `
                    -Body ([Text.Encoding]::UTF8.GetBytes(($cuerpo | ConvertTo-Json))) | Out-Null
            } catch { Write-Marca "no pude pasar la entrada: $($_.Exception.Message)" }
            Remove-Item $png -ErrorAction SilentlyContinue
        }
        $h = [IntPtr][int64]$activo.hwnd
        # Cómo se muestra: Alt+F2 la barra (en la pantalla de lo que tenías adelante), Alt+F1 la ventana, una zona
        # como estaba. La ventana se acomoda y pasa adelante sola; si no contesta, se la trae como antes.
        $modoPedido = if ($Barra) { 'barra' } elseif ($Zona) { '' } else { 'ventana' }
        $pedido = @{ modo = $modoPedido; ventana = [int64]$hwnd } | ConvertTo-Json -Compress
        if ($activo.pid) { [ArregloWin]::AllowSetForegroundWindow([int]$activo.pid) | Out-Null }
        if (-not [ArregloWin]::SendText($h, $pedido)) {
            Write-Marca 'la ventana no contestó el pedido'
            if ([ArregloWin]::IsIconic($h)) { [ArregloWin]::ShowWindow($h, 9) | Out-Null }
            [ArregloWin]::SetForegroundWindow($h) | Out-Null
        }
    }
    exit
}
if ($script:zonaCancelada) { exit } # Marito ya no estaba abierto: no hay a quién volver

New-Item -ItemType Directory -Force $sesion | Out-Null
$ctx = Get-Contexto (Join-Path $sesion 'captura.png')

$bytes = New-Object byte[] 16
(New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($bytes)
$token = ([BitConverter]::ToString($bytes) -replace '-', '').ToLower()
$contexto = [ordered]@{ token = $token }
foreach ($k in $ctx.Keys) { $contexto[$k] = $ctx[$k] }
$contexto | ConvertTo-Json | Set-Content (Join-Path $sesion 'contexto.json') -Encoding UTF8

if ($Prueba) {
    $quien = if ($ctx.proyecto) { $ctx.proyecto } elseif ($ctx.carpeta) { "carpeta $($ctx.carpeta)" } else { 'Chat libre' }
    "app: $($ctx.app) | página: $($ctx.url) | sitio: $($ctx.sitio) | proyecto: $quien | captura: $($ctx.captura) ($($ctx.origenCaptura))"
    if ($ctx.donde) { "dónde: $($ctx.donde)" }
    "ms hasta tener todo el contexto: $($reloj.ElapsedMilliseconds)"
    "sesión: $sesion"
    exit
}

# ---------- 2. Servidor ----------
# Modo fijo (remoto.json, ver servidor-fijo.ps1): el servidor ya corre o se arranca para quedar; la ventana se engancha
# a él y le pasa lo que tenés adelante (la toma al abrir). Si no arranca, sigue como siempre, con uno propio.
$fijo = $false
if (-not $SoloServidor -and (Test-Path (Join-Path $base 'remoto.json'))) {
    $info = $null
    try { $json = & (Join-Path $aqui 'servidor-fijo.ps1'); if ($json) { $info = $json | ConvertFrom-Json } } catch { Write-Marca "servidor fijo: $($_.Exception.Message)" }
    $srv = if ($info) { Get-Process -Id $info.pid -ErrorAction SilentlyContinue } else { $null }
    if ($srv) {
        $fijo = $true
        $token = $info.token
        $puertoArchivo = Join-Path $info.sesion 'puerto.txt'
        # abrir = ventana nueva: el servidor cierra las pestañas sin nada escrito (como al arrancar; quedan en el historial)
        $cuerpo = @{ abrir = $true; proyecto = $ctx.proyecto; carpeta = $ctx.carpeta; sitio = $ctx.sitio; url = $ctx.url; donde = $ctx.donde; ruta = $ctx.captura; origen = $ctx.origenCaptura; nota = $ctx.notaCaptura }
        try {
            Invoke-RestMethod -Uri "http://127.0.0.1:$($info.puerto)/api/entrada" -Method Post -TimeoutSec 4 `
                -Headers @{ 'X-Token' = $token } -ContentType 'application/json; charset=utf-8' `
                -Body ([Text.Encoding]::UTF8.GetBytes(($cuerpo | ConvertTo-Json))) | Out-Null
        } catch { Write-Marca "no pude pasar la entrada: $($_.Exception.Message)" }
        Remove-Item $sesion -Recurse -Force -ErrorAction SilentlyContinue # la captura ya la copió el servidor
        Write-Marca "servidor fijo pid=$($info.pid) puerto=$($info.puerto)"
    } else { Write-Marca 'el servidor fijo no arrancó: sigo con uno propio' }
}
if (-not $fijo) {
    # El instalador trae su Node en node\; si no, el de la PC.
    $nodeExe = Join-Path $aqui 'node\node.exe'
    if (-not (Test-Path $nodeExe)) { $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source }
    $padre = if ($SoloServidor) { 0 } else { $PID }
    $srv = Start-Process -FilePath $nodeExe -WindowStyle Hidden -PassThru `
        -ArgumentList @("`"$aqui\server.mjs`"", "`"$sesion`"", $padre) `
        -RedirectStandardOutput (Join-Path $sesion 'server.out') -RedirectStandardError (Join-Path $sesion 'server.err')
    Write-Marca "node arrancado pid=$($srv.Id)"
    $puertoArchivo = Join-Path $sesion 'puerto.txt'
}

if ($SoloServidor) {
    $t = [Diagnostics.Stopwatch]::StartNew(); $puerto = 0
    while ($t.ElapsedMilliseconds -lt 8000 -and -not $puerto) {
        if (Test-Path $puertoArchivo) { $txt = (Get-Content $puertoArchivo -Raw).Trim(); if ($txt) { $puerto = [int]$txt } }
        if ($srv.HasExited) { break }
        [Threading.Thread]::Sleep(25)
    }
    "puerto=$puerto token=$token sesion=$sesion nodePid=$($srv.Id)"
    exit
}

function Stop-Todo {
    # Apaga el servidor con gusto y, si no, a la fuerza (con todo su árbol: claude y compañía).
    # El fijo no: sigue con las conversaciones (y para el celular).
    if ($fijo) { Remove-Item $activoArchivo -ErrorAction SilentlyContinue; return }
    try {
        if ($script:puerto) {
            Invoke-RestMethod -Uri "http://127.0.0.1:$($script:puerto)/api/cerrar" -Method Post -TimeoutSec 2 -Headers @{ 'X-Token' = $token } -ContentType 'application/json' -Body '{}' | Out-Null
        }
    } catch { }
    try { if (-not $srv.WaitForExit(1500)) { & taskkill.exe /T /F /PID $srv.Id 2>$null | Out-Null } } catch { }
    Remove-Item $activoArchivo -ErrorAction SilentlyContinue
}

# ---------- 3. Ventana ----------
$ventanaArchivo = Join-Path $base 'ventana.json'
try {
    # Identidad propia en la barra de tareas y en los avisos (si no, se agrupa con PowerShell y usa su ícono).
    [ArregloWin]::SetCurrentProcessExplicitAppUserModelID($AUMID) | Out-Null
    try {
        $reg = "HKCU:\Software\Classes\AppUserModelId\$AUMID"
        if (-not (Test-Path $reg)) { New-Item -Path $reg -Force | Out-Null }
        Set-ItemProperty -Path $reg -Name DisplayName -Value 'Marito'
        Set-ItemProperty -Path $reg -Name IconUri -Value (Join-Path $aqui 'ui\marito.png')
    } catch { }

    Add-Type -Path (Join-Path $lib 'Microsoft.Web.WebView2.Core.dll')
    Add-Type -Path (Join-Path $lib 'Microsoft.Web.WebView2.WinForms.dll')
    [ArregloWin]::LoadLibrary((Join-Path $lib 'WebView2Loader.dll')) | Out-Null
    Write-Marca 'webview2 cargado'


    # La ventana del costado se abre siempre igual, a escala de la pantalla (medida en 1920×1032: 472 de ancho, 85 libres
    # a la derecha, arriba, debajo de los favoritos): a la derecha y pegada a la barra de tareas, con un margen a la
    # derecha para no tapar los botones ni el scroll de la app de atrás. En pantallas chicas no baja del mínimo.
    $scrIni = [System.Windows.Forms.Screen]::FromHandle($hwnd)
    $gfx = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero); $escala = $gfx.DpiX / 96.0; $gfx.Dispose()
    $minAncho = [int](440 * $escala); $minAlto = [int](380 * $escala)
    function Get-RectCostado($scr) {
        $pantalla = $scr.WorkingArea
        $abajo = [ArregloWin]::FreeBottom($scr) # pegada a la barra de tareas, sin margen abajo
        $ancho = [Math]::Max([int]($pantalla.Width * 0.2458), $minAncho)
        $margenDer = [Math]::Max([int]($pantalla.Width * 0.0443), [int](20 * $escala))
        $ancho = [Math]::Min($ancho, $pantalla.Width - $margenDer)
        # Arriba: justo debajo de la barra de favoritos del navegador de esa pantalla; si no hay, 11,5 % del alto.
        $arriba = [ArregloWin]::BrowserContentTop($scr)
        if ($arriba -le $pantalla.Top -or $arriba -ge $abajo) { $arriba = $pantalla.Top + [int]($pantalla.Height * 0.115) }
        if ($abajo - $arriba -lt $minAlto) { $arriba = [Math]::Max($pantalla.Top, $abajo - $minAlto) }
        New-Object System.Drawing.Rectangle(($pantalla.Right - $margenDer - $ancho), $arriba, $ancho, ($abajo - $arriba))
    }
    # La barra (modo compacto, Alt+F2): en el medio de la pantalla, a un 28 % de arriba (como la maqueta elegida). Su
    # alto lo dice la interfaz (`barraAlto`, en px de CSS): la barra sola o con la tarjeta de la respuesta debajo.
    $script:barraAlto = 84
    $script:barraLugar = $null
    # El ancho (px de CSS): de entrada 600, corta como la entrada rápida de Claude (el usuario: «muy larga al pedo»).
    # Se alarga o acorta desde los costados de la caja y se recuerda en ventana.json. Menos de 400 no entra la fila
    # (6 puntitos, la caja y los 5 botones).
    $script:barraAncho = 600
    $barraMin = 400
    function Get-RectBarra($scr) {
        $wa = $scr.WorkingArea
        $w = [int][Math]::Min([Math]::Max($script:barraAncho, $barraMin) * $escala, $wa.Width - 32 * $escala)
        # Si la moviste en esta pantalla, vuelve adonde la dejaste (mientras Marito siga abierto), sin salirse por la
        # derecha si desde entonces la alargaste.
        $l = $script:barraLugar
        if ($l -and $l.pantalla.Equals($scr.Bounds)) {
            $x = [Math]::Max($wa.Left, [Math]::Min($l.x, $wa.Right - $w))
            return New-Object System.Drawing.Rectangle($x, $l.y, $w, [int]($script:barraAlto * $escala))
        }
        # De entrada, arriba y centrada (24/11, pedido del usuario; antes a un 28 % de arriba): a la altura de la barra de
        # direcciones del navegador, donde se mira.
        New-Object System.Drawing.Rectangle(($wa.Left + [int](($wa.Width - $w) / 2)), ($wa.Top + [int]($wa.Height * 0.045)), $w, [int]($script:barraAlto * $escala))
    }
    # El modo «grande» (normal, max o full) se recuerda; la barra no: Alt+F1 vuelve a cómo estaba la ventana.
    $script:modoGrande = 'normal'
    $script:fijada = $true # arriba de todo, salvo que la hayan soltado con el botón del alfiler
    try {
        $guardado = Get-Content $ventanaArchivo -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($guardado.modo -in 'max', 'full') { $script:modoGrande = $guardado.modo }
        if ($guardado.fijada -eq $false) { $script:fijada = $false }
        if ($guardado.barraAncho -ge $barraMin -and $guardado.barraAncho -le 8000) { $script:barraAncho = [int]$guardado.barraAncho }
    } catch { }
    $modoInicial = if ($Barra) { 'barra' } else { $script:modoGrande }

    $form = New-Object ArregloForm
    $form.Text = 'Marito'
    $form.FormBorderStyle = 'None'
    $form.StartPosition = 'Manual'
    $script:normal = Get-RectCostado $scrIni
    if ($modoInicial -eq 'barra') { $form.Bounds = Get-RectBarra $scrIni }
    else { $form.MinimumSize = New-Object System.Drawing.Size($minAncho, $minAlto); $form.Bounds = $script:normal }
    $form.Gap = 0
    $form.BackColor = [System.Drawing.Color]::Black # negro = transparente con el vidrio de DWM
    $form.ShowInTaskbar = $true
    $form.TopMost = $script:fijada -or $modoInicial -eq 'barra' # fijada (botón 📌): arriba de todo, no se esconde al hacer click en lo de abajo
    $iconoArchivo = Join-Path $aqui 'marito.ico'
    if (Test-Path $iconoArchivo) { $form.Icon = New-Object System.Drawing.Icon $iconoArchivo }
    # Para fijarla en la barra de tareas con su ícono, y que el acceso fijado abra Marito (no PowerShell).
    # Por conhost --headless: el acceso fijado arranca con ventana normal y Windows Terminal (la terminal por defecto)
    # abre su ventana aunque PowerShell pida -WindowStyle Hidden, y queda en la barra mientras Marito esté abierto.
    $relanzar = '"{0}\System32\conhost.exe" --headless "{0}\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "{1}"' -f $env:SystemRoot, (Join-Path $aqui 'abrir.ps1')
    if (-not [ArregloWin]::SetRelaunch($form.Handle, $AUMID, $relanzar, "$iconoArchivo,0", 'Marito')) { Write-Marca 'no pude poner los datos para fijar en la barra' }

    $props = New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
    $props.UserDataFolder = Join-Path $env:LOCALAPPDATA 'arreglo\webview'
    $wv = New-Object Microsoft.Web.WebView2.WinForms.WebView2
    $wv.CreationProperties = $props
    $wv.DefaultBackgroundColor = [System.Drawing.Color]::Transparent
    $wv.Dock = 'Fill'
    $form.Controls.Add($wv)

    function Send-AlaUI($obj) {
        try { if ($wv.CoreWebView2) { $wv.CoreWebView2.PostWebMessageAsJson(($obj | ConvertTo-Json -Compress -Depth 4)) } } catch { }
    }

    # Tapada hasta que la página pinte (24/11, video del usuario: entre «ventana visible» y «página cargada» se veía
    # ~0,3 s un rectángulo vacío y la animación de la barra corría sin verse). La destapa el aviso `pintada` de la
    # interfaz; si no llega, un tope. Recién entonces se le dice `mostrada` y arranca la animación.
    [ArregloWin]::Cloak($form.Handle, $true)
    $script:tapada = $true
    $script:timerDestapar = New-Object System.Windows.Forms.Timer
    $script:timerDestapar.Interval = 3000
    function Show-Destapada([string]$por) {
        # Ya destapada (la página se recargó): solo se le avisa, que si no la barra queda transparente.
        if (-not $script:tapada) { if ($por -eq 'pintada') { Send-AlaUI @{ tipo = 'mostrada' } }; return }
        $script:tapada = $false
        $script:timerDestapar.Stop()
        if ($script:modo -eq 'barra') { Set-Fuera } # entra bajando desde afuera (ver Start-Entrada)
        [ArregloWin]::Cloak($form.Handle, $false)
        Write-Marca "destapada ($por)"
        Send-AlaUI @{ tipo = 'mostrada' }
    }
    $script:timerDestapar.Add_Tick({ Show-Destapada 'tope' })

    # La entrada de la barra (24/11, pedido del usuario): baja desde afuera de la pantalla mientras un velo oscurece la
    # pantalla unos segundos. `Set-Fuera` la deja arriba, afuera, antes de que se vea; `entrar` (lo manda la interfaz
    # cuando arranca su animación) la baja hasta donde iba y prende el velo.
    $script:velo = $null
    $script:entradaDestino = $null
    function Set-Fuera {
        # Apagada hasta arreglarla (24/11): con una pantalla arriba de la de la barra, «afuera» se ve en la otra, y la
        # bajada medida saltó de una vez (983 → 1126) en vez de deslizarse. Ver el handoff.
        if (-not $script:bajarDesdeAfuera) { return }
        $script:entradaDestino = $form.Bounds
        $scr = [System.Windows.Forms.Screen]::FromRectangle($form.Bounds)
        $form.Top = $scr.Bounds.Top - $form.Height - [int](8 * $escala)
        $script:timerFuera.Stop(); $script:timerFuera.Start()
    }
    # Si la interfaz no manda `entrar`, que no quede afuera de la pantalla.
    $script:timerFuera = New-Object System.Windows.Forms.Timer
    $script:timerFuera.Interval = 1500
    $script:timerFuera.Add_Tick({ $script:timerFuera.Stop(); if ($script:entradaDestino -and -not $script:timerEntrada.Enabled) { Start-Entrada } })
    $script:timerEntrada = New-Object System.Windows.Forms.Timer
    $script:timerEntrada.Interval = 10
    $script:relojEntrada = New-Object System.Diagnostics.Stopwatch
    function Start-Entrada {
        $script:timerFuera.Stop()
        Write-Marca "entrada (desde y=$($form.Top))"
        $donde = if ($script:entradaDestino) { $script:entradaDestino } else { $form.Bounds }
        if (-not $script:velo -or $script:velo.IsDisposed) { $script:velo = New-Object DimForm }
        $script:velo.Opacity = 0
        $script:velo.Bounds = [System.Windows.Forms.Screen]::FromRectangle($donde).Bounds
        if (-not $script:velo.Visible) { $script:velo.Show() }
        # Justo debajo de la barra (SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE).
        [ArregloWin]::SetWindowPos($script:velo.Handle, $form.Handle, 0, 0, 0, 0, 0x13) | Out-Null
        $script:entradaDesde = $form.Top
        $script:entradaY = $form.Top
        $script:relojEntrada.Restart()
        $script:timerEntrada.Start()
    }
    $script:timerEntrada.Add_Tick({
        $t = $script:relojEntrada.ElapsedMilliseconds
        $barra = $script:modo -eq 'barra'
        # Bajada: 550 ms, frenando al final. Se corta si la arrastraron o dejó de ser la barra.
        $d = $script:entradaDestino
        if ($d) {
            if (-not $barra -or $form.Top -ne $script:entradaY) { $script:entradaDestino = $null }
            else {
                $p = [Math]::Min(1, $t / 550); $e = 1 - [Math]::Pow(1 - $p, 4)
                $y = [int][Math]::Round($script:entradaDesde + ($d.Top - $script:entradaDesde) * $e)
                $form.Top = $y; $script:entradaY = $y
                if ($p -ge 1) { $script:entradaDestino = $null }
            }
        }
        # Velo (24/11, pedido del usuario: corto, el fondo ya lleva la vista): sube al 45 % en 200 ms, queda y se va
        # entre los 1,2 y los 1,7 s (o enseguida si ya no es la barra).
        $o = if (-not $barra) { 0 } elseif ($t -lt 200) { 0.45 * $t / 200 } elseif ($t -lt 1200) { 0.45 } else { 0.45 * [Math]::Max(0, 1 - ($t - 1200) / 500) }
        $script:velo.Opacity = $o
        if (($t -ge 1700 -or -not $barra) -and -not $script:entradaDestino) { $script:timerEntrada.Stop(); $script:velo.Hide(); Write-Marca "entrada terminada (y=$($form.Top))" }
    })

    # Normal (el costado) / barra / maximizada (área de trabajo) / pantalla completa (toda la pantalla). Se maneja a
    # mano porque la ventana no tiene marco: el «Maximized» de WinForms taparía la barra de tareas.
    # `$junto`: la ventana de cuya pantalla se trata (la de adelante al apretar Alt+F2); si no, donde está Marito.
    # `$abrir`: la pidió un atajo (la interfaz arranca la barra de cero, sin la tarjeta de antes).
    $script:modo = $modoInicial
    function Set-Modo([string]$m, [IntPtr]$junto = [IntPtr]::Zero, [bool]$abrir = $false) {
        if ($script:modo -eq 'normal' -and -not [ArregloWin]::IsIconic($form.Handle)) { $script:normal = $form.Bounds }
        $scr = if ($junto -ne [IntPtr]::Zero) { [System.Windows.Forms.Screen]::FromHandle($junto) } else { [System.Windows.Forms.Screen]::FromHandle($form.Handle) }
        if ($m -notin 'barra', 'max', 'full') { $m = 'normal' }
        # De la barra a la ventana en otra pantalla: la del costado de esa pantalla.
        if ($m -eq 'normal' -and $script:modo -eq 'barra' -and -not [System.Windows.Forms.Screen]::FromRectangle($script:normal).Bounds.Equals($scr.Bounds)) { $script:normal = Get-RectCostado $scr }
        $rect = switch ($m) {
            'barra' { $script:barraAlto = 84; Get-RectBarra $scr }
            'max' { $scr.WorkingArea }
            'full' { $scr.Bounds }
            default { $script:normal }
        }
        if ($m -ne 'barra') { $script:modoGrande = $m }
        $script:modo = $m
        $form.MinimumSize = if ($m -eq 'normal') { New-Object System.Drawing.Size($minAncho, $minAlto) } else { [System.Drawing.Size]::Empty }
        $form.Floating = ($m -eq 'normal') # las esquinas las pone el form (ApplyShape); en la barra, el CSS
        [ArregloWin]::Frame($form.Handle, $m -ne 'barra')
        $form.TopMost = $script:fijada -or $m -eq 'barra'
        if ([ArregloWin]::IsIconic($form.Handle)) { [ArregloWin]::RestoreTo($form.Handle, $rect) } else { $form.Bounds = $rect }
        if ($m -eq 'barra' -and $abrir) { Set-Fuera }
        Send-AlaUI @{ tipo = 'ventana'; modo = $m; fijada = $script:fijada; abrir = $abrir }
    }
    # Escondida o vuelta a la vista (Esc, la rayita, la barra de tareas, Alt+F1/F2): se le avisa a la interfaz, que le
    # dice al servidor desde cuándo no se ve (lo que termine mientras tanto no se vio en la PC).
    $script:escondida = $false
    $form.Add_Resize({
        $e = [ArregloWin]::IsIconic($form.Handle)
        if ($e -ne $script:escondida) { $script:escondida = $e; Send-AlaUI @{ tipo = 'escondida'; si = $e } }
    })
    # Otro abrir.ps1 (Alt+F2, Alt+F1, una zona) con la ventana abierta: `{modo: 'barra'|'ventana'|'', ventana: hwnd}`.
    $form.add_Pedido([Action[string]]{
        param($texto)
        $p = $null; try { $p = $texto | ConvertFrom-Json } catch { }
        if (-not $p) { return }
        Write-Marca "pedido $texto"
        switch ([string]$p.modo) {
            'barra' { Set-Modo 'barra' ([IntPtr][int64]$p.ventana) $true }
            'ventana' { if ($script:modo -eq 'barra' -or [ArregloWin]::IsIconic($form.Handle)) { Set-Modo $script:modoGrande ([IntPtr][int64]$p.ventana) } }
        }
        if ([ArregloWin]::IsIconic($form.Handle)) { [ArregloWin]::ShowWindow($form.Handle, 9) | Out-Null }
        [ArregloWin]::SetForegroundWindow($form.Handle) | Out-Null
        $form.Activate(); $wv.Focus() | Out-Null
    })

    $script:puerto = 0
    $script:esperaPuerto = [Diagnostics.Stopwatch]::StartNew()

    $wv.Add_CoreWebView2InitializationCompleted({
        param($s, $e)
        if (-not $e.IsSuccess) { Write-Marca "webview2 falló: $($e.InitializationException.Message)"; $form.Close(); return }
        Write-Marca 'webview2 listo'
        $cw = $wv.CoreWebView2
        $cw.Settings.IsStatusBarEnabled = $false
        $cw.Settings.IsZoomControlEnabled = $false
        $cw.Settings.AreBrowserAcceleratorKeysEnabled = $false
        $cw.add_NewWindowRequested({
            param($s2, $e2)
            $e2.Handled = $true
            if ($e2.Uri -match '^https?://') { Start-Process $e2.Uri }
        })
        # El micrófono (botón de audio) se permite solo para la interfaz de Marito, sin preguntar cada vez.
        $cw.add_PermissionRequested({
            param($s2, $e2)
            if ($e2.PermissionKind -eq [Microsoft.Web.WebView2.Core.CoreWebView2PermissionKind]::Microphone -and $e2.Uri -match '^http://127\.0\.0\.1:\d+/') {
                $e2.State = [Microsoft.Web.WebView2.Core.CoreWebView2PermissionState]::Allow
            }
        })
        $cw.add_WebMessageReceived({
            param($s2, $e2)
            $msg = $null
            try { $msg = $e2.WebMessageAsJson | ConvertFrom-Json } catch { }
            if (-not $msg) { return }
            switch ([string]$msg.tipo) {
                'abrir' { if ([string]$msg.url -match '^https?://') { Start-Process ([string]$msg.url) } }
                'abrirArchivo' {
                    # Solo los adjuntos de las sesiones de Marito. Imágenes y documentos se abren; cualquier otra cosa
                    # (un .bat, un .exe adjuntado) se muestra en el Explorador: un click no la ejecuta.
                    $ruta = [string]$msg.ruta
                    $llena = if ($ruta) { [IO.Path]::GetFullPath($ruta) } else { '' }
                    if ($llena -and $llena.StartsWith($base + '\', [StringComparison]::OrdinalIgnoreCase) -and
                        ([IO.Path]::GetFileName([IO.Path]::GetDirectoryName($llena)) -eq 'adjuntos') -and (Test-Path -LiteralPath $llena -PathType Leaf)) {
                        if ([IO.Path]::GetExtension($llena).ToLower() -in @('.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.pdf', '.txt', '.md', '.csv', '.json', '.xlsx', '.xls', '.docx')) {
                            Start-Process -FilePath $llena
                        } else {
                            Start-Process -FilePath 'explorer.exe' -ArgumentList "/select,`"$llena`""
                        }
                    }
                }
                'arrastrar' {
                    if ($script:modo -eq 'barra') {
                        # La barra se mueve adonde la dejes (apretada y arrastrando) y vuelve ahí en ese monitor.
                        [ArregloWin]::Drag($form.Handle)
                        $script:barraLugar = @{ x = $form.Left; y = $form.Top; pantalla = [System.Windows.Forms.Screen]::FromHandle($form.Handle).Bounds }
                        return
                    }
                    if ($script:modo -ne 'normal') {
                        # Arrastrar estando maximizada: vuelve al tamaño normal debajo del mouse, como cualquier ventana.
                        $cur = [System.Windows.Forms.Cursor]::Position
                        $prop = ($cur.X - $form.Left) / [double]$form.Width
                        $n = $script:normal
                        $script:normal = New-Object System.Drawing.Rectangle(([int]($cur.X - $n.Width * $prop)), ($cur.Y - [int](20 * $escala)), $n.Width, $n.Height)
                        Set-Modo 'normal'
                    }
                    [ArregloWin]::Drag($form.Handle)
                }
                'redimensionar' {
                    $borde = [int]$msg.borde
                    if ($script:modo -eq 'normal') { $form.BeginResize($borde) }
                    elseif ($script:modo -eq 'barra' -and $borde -in 10, 11) {
                        # El ancho de la barra desde los costados de la caja: entre lo que necesita la fila y el ancho
                        # de la pantalla. El alto lo sigue diciendo la interfaz (`barraAlto`). El tope de alto va
                        # grande: WinForms achica la ventana al asignar un MaximumSize, y con alto 0 la dejaría en 0.
                        $wa = [System.Windows.Forms.Screen]::FromHandle($form.Handle).WorkingArea
                        $form.MinimumSize = New-Object System.Drawing.Size([int]($barraMin * $escala), 0)
                        $form.MaximumSize = New-Object System.Drawing.Size(($wa.Width - [int](32 * $escala)), 20000)
                        try { $form.BeginResize($borde) }
                        finally { $form.MinimumSize = [System.Drawing.Size]::Empty; $form.MaximumSize = [System.Drawing.Size]::Empty }
                        $script:barraAncho = [int][Math]::Round($form.Width / $escala)
                        $script:barraLugar = @{ x = $form.Left; y = $form.Top; pantalla = [System.Windows.Forms.Screen]::FromHandle($form.Handle).Bounds }
                    }
                }
                'maximizar' { if ($script:modo -eq 'max') { Set-Modo 'normal' } else { Set-Modo 'max' } }
                'pantallaCompleta' { if ($script:modo -eq 'full') { Set-Modo 'normal' } else { Set-Modo 'full' } }
                'cerrar' { $form.Close() }
                'minimizar' { $form.WindowState = 'Minimized' }
                # Modo compacto: «Continuar →» o ⤢ pasan a la ventana; el botón naranja de arriba (o Alt+F2) a la barra.
                'continuar' { if ($script:modo -eq 'barra') { Set-Modo $script:modoGrande } }
                'barra' { if ($script:modo -ne 'barra') { Set-Modo 'barra' } }
                'barraAlto' {
                    # La barra crece hacia abajo con la tarjeta de la respuesta (o con los adjuntos); arriba no se mueve.
                    $a = [int]$msg.alto
                    if ($script:modo -eq 'barra' -and $a -ge 40 -and $a -le 1200 -and $a -ne $script:barraAlto) {
                        $script:barraAlto = $a; $form.Height = [int]($a * $escala)
                    }
                }
                'elegirCarpeta' {
                    # «Carpeta de proyectos» de la configuración: el diálogo de Windows para elegirla.
                    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
                    $dlg.Description = 'Carpeta de proyectos'
                    if ($msg.ruta -and (Test-Path ([string]$msg.ruta))) { $dlg.SelectedPath = [string]$msg.ruta }
                    if ($dlg.ShowDialog($form) -eq 'OK') { Send-AlaUI @{ tipo = 'carpeta'; ruta = $dlg.SelectedPath } }
                    $dlg.Dispose()
                }
                'zona' {
                    # Botón de la zona: Marito se esconde y la marca la hace otro abrir.ps1 (como Alt+F1), que se la
                    # pasa por /api/entrada y lo vuelve a traer. Sin consola (CREATE_NO_WINDOW: ni Windows Terminal).
                    $form.WindowState = 'Minimized'
                    $psi = New-Object System.Diagnostics.ProcessStartInfo (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
                    $psi.Arguments = '-NoProfile -ExecutionPolicy Bypass -STA -File "{0}" -Zona -DesdeMarito' -f (Join-Path $aqui 'abrir.ps1')
                    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
                    try { [void][System.Diagnostics.Process]::Start($psi) } catch { Write-Marca "zona: $($_.Exception.Message)"; $form.WindowState = 'Normal' }
                }
                'fijar' {
                    $script:fijada = -not $script:fijada
                    $form.TopMost = $script:fijada -or $script:modo -eq 'barra'
                    Send-AlaUI @{ tipo = 'ventana'; modo = $script:modo; fijada = $script:fijada }
                }
                'pegarArchivos' {
                    # Ctrl+V de archivos copiados en el Explorador: el WebView no siempre los ve, se leen del portapapeles.
                    try {
                        if ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {
                            $rutas = @([System.Windows.Forms.Clipboard]::GetFileDropList() | Where-Object { Test-Path $_ -PathType Leaf })
                            if ($rutas.Count) { Send-AlaUI @{ tipo = 'archivos'; rutas = $rutas } }
                        }
                    } catch { }
                }
                'avisar' {
                    Write-Marca "aviso ($([string]$msg.conv))"
                    if ([ArregloWin]::GetForegroundWindow() -ne $form.Handle) { [ArregloWin]::Flash($form.Handle) }
                }
                # Puntito naranja en la barra de tareas mientras haya una pestaña con algo sin ver.
                'nuevos' { [ArregloWin]::Badge($form.Handle, [bool]$msg.hay) }
                'lista' {
                    Send-AlaUI @{ tipo = 'ventana'; modo = $script:modo; fijada = $script:fijada }
                    # Si la página no avisa que pintó (tapada podría no pintar), se destapa igual enseguida.
                    if ($script:tapada) { $script:timerDestapar.Stop(); $script:timerDestapar.Interval = 400; $script:timerDestapar.Start() }
                }
                'pintada' { Show-Destapada 'pintada' }
                'entrar' { Start-Entrada }
            }
        })
        # Cuando el servidor dice su puerto, se navega. Se mira cada 30 ms sin trabar la ventana.
        $script:timerPuerto = New-Object System.Windows.Forms.Timer
        $script:timerPuerto.Interval = 30
        $script:timerPuerto.Add_Tick({
            $p = 0
            if (Test-Path $puertoArchivo) { $txt = (Get-Content $puertoArchivo -Raw).Trim(); if ($txt) { $p = [int]$txt } }
            if ($p -gt 0) {
                $script:timerPuerto.Stop()
                $script:puerto = $p
                @{ puerto = $p; token = $token; hwnd = [int64]$form.Handle; pid = $PID; nodePid = $srv.Id } | ConvertTo-Json | Set-Content $activoArchivo -Encoding UTF8
                $wv.CoreWebView2.Navigate("http://127.0.0.1:$p/?t=$token")
                Write-Marca "navegando a puerto $p"
            } elseif ($srv.HasExited -or $script:esperaPuerto.ElapsedMilliseconds -gt 10000) {
                $script:timerPuerto.Stop(); Write-Marca 'el servidor no arrancó'; $form.Close()
            }
        })
        $script:timerPuerto.Start()
    })
    $wv.Add_NavigationCompleted({
        param($s, $e)
        if ($e.IsSuccess -and -not $script:primeraVez) { $script:primeraVez = $true; Write-Marca 'página cargada'; $wv.Focus() | Out-Null }
    })

    # Si el servidor se muere solo, no dejamos una ventana muda.
    $vigia = New-Object System.Windows.Forms.Timer
    $vigia.Interval = 2000
    $vigia.Add_Tick({ if ($srv.HasExited) { $vigia.Stop(); $form.Close() } })
    $vigia.Start()

    $form.Add_Shown({
        Write-Marca 'ventana visible (tapada)'
        $script:timerDestapar.Start()
        if ($modoInicial -ne 'normal') { Set-Modo $modoInicial $hwnd }
        $form.Activate(); $wv.EnsureCoreWebView2Async($null) | Out-Null
    })
    $form.Add_FormClosing({
        # Se recuerda si estaba maximizada o a pantalla completa (el tamaño normal es siempre el mismo; la barra no
        # cuenta: Alt+F1 vuelve a la ventana como estaba), si estaba fijada y el ancho de la barra.
        try {
            @{ modo = $script:modoGrande; fijada = $script:fijada; barraAncho = $script:barraAncho } | ConvertTo-Json | Set-Content $ventanaArchivo -Encoding UTF8
        } catch { }
        $form.Hide(); $vigia.Stop(); Stop-Todo
    })

    [System.Windows.Forms.Application]::Run($form)
} catch {
    Write-Marca "error: $($_.Exception.Message)"
    Stop-Todo
}

# Limpieza: ningún proceso queda, y se borran las sesiones de más de una semana.
try { if ($wv) { $wv.Dispose() } } catch { }
if (-not $fijo) { try { $srv.Refresh(); if (-not $srv.HasExited) { & taskkill.exe /T /F /PID $srv.Id 2>$null | Out-Null } } catch { } }
Remove-Item $activoArchivo -ErrorAction SilentlyContinue
Get-ChildItem $base -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\d{8}-\d{6}$' -and $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
    ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
try { $mutex.ReleaseMutex() } catch { }
Write-Marca 'fin'
[Environment]::Exit(0)
