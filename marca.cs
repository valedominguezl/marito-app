// Marca en la pantalla: Marito señala dónde tocar (lo usan marcar.ps1 y abrir.ps1; se compila una vez en lib\).
// La idea (lista de controles de Windows + el modelo elige uno por número, y un recuadro encima) viene de
// Nūs Companion (https://github.com/potlakai/nus-companion, Apache-2.0); el código es propio.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

public static class MarcaWin {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromRect(ref RECT r, uint flags);
    [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr mon, int type, out uint x, out uint y);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool UpdateLayeredWindow(IntPtr h, IntPtr dstDc, ref Point dst, ref Size size, IntPtr srcDc, ref Point src, int key, ref BLEND blend, int flags);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
    [StructLayout(LayoutKind.Sequential, Pack = 1)] struct BLEND { public byte op, flags, alpha, format; }
    public struct RECT { public int Left, Top, Right, Bottom; }

    // Píxeles reales en todas las pantallas (Per-Monitor v2). Con «system aware» una pantalla con otra escala
    // (2560 al 150 % al lado de una de 1920 al 100 %) da coordenadas virtualizadas y la marca cae corrida.
    // Va antes de crear cualquier ventana del proceso.
    public static void PerMonitor() { if (!SetProcessDpiAwarenessContext((IntPtr)(-4))) SetProcessDPIAware(); }
    // Escala de la pantalla donde está ese rectángulo (1 = 100 %).
    public static float ScaleAt(Rectangle r) {
        RECT q = new RECT { Left = r.Left, Top = r.Top, Right = r.Right, Bottom = r.Bottom };
        uint x, y;
        try { if (GetDpiForMonitor(MonitorFromRect(ref q, 2), 0, out x, out y) == 0) return x / 96f; } catch { }
        return 1f;
    }
    // La ventana de Marito (los clicks sobre ella no sacan la marca).
    public static IntPtr MaritoWindow() {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, l) => {
            if (IsWindowVisible(h) && Title(h) == "Marito" && ClassOf(h).StartsWith("WindowsForms10")) { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static string Title(IntPtr h) { StringBuilder s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
    public static string ClassOf(IntPtr h) { StringBuilder s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
    // Qué es un control Win32 que UI Automation da como «Pane» (los diálogos de Inventor: todos sus botones, casillas y
    // campos llegan así), por su clase y, en los botones, por su estilo. "" = no se toca (rótulos, marcos de grupo).
    public static string Win32Kind(IntPtr h, string cls) {
        switch (cls) {
            case "Button":
                switch (GetWindowLong(h, -16) & 0xF) {
                    case 2: case 3: case 5: case 6: return "CheckBox";
                    case 4: case 9: return "RadioButton";
                    case 7: return ""; // marco de grupo
                    default: return "Button";
                }
            case "Edit": case "RichEdit20W": case "RICHEDIT50W": return "Edit";
            case "ComboBox": return "ComboBox";
            case "msctls_trackbar32": return "Slider";
            default: return "";
        }
    }
    public static string ProcessOf(IntPtr h) {
        try { uint pid; GetWindowThreadProcessId(h, out pid); return System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
    }
    static bool IsShell(IntPtr h) {
        string c = ClassOf(h);
        return c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd" || c == "Progman" || c == "WorkerW"
            || c == "Windows.UI.Core.CoreWindow" || c == "TopLevelWindowForOverflowXamlIsland" || c == "XamlExplorerHostIslandWindow";
    }
    // La ventana de verdad de más arriba que no es Marito: lo que el usuario está usando (Marito queda al costado,
    // siempre arriba, así que se la saltea). Los cuadros de diálogo cuentan: «¿Guardar los cambios?» es la de adelante.
    public static IntPtr TopWindow() {
        IntPtr found = IntPtr.Zero; uint yo = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
        EnumWindows((h, l) => {
            if (!IsWindowVisible(h) || IsIconic(h) || IsShell(h) || Title(h).Length == 0) return true;
            if ((GetWindowLong(h, -20) & (0x80 | 0x20 | 0x08000000)) != 0) return true; // TOOLWINDOW, TRANSPARENT, NOACTIVATE
            int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
            uint pid; GetWindowThreadProcessId(h, out pid); if (pid == yo) return true;
            if (Title(h) == "Marito" && ClassOf(h).StartsWith("WindowsForms10")) return true;
            found = h; return false; // EnumWindows va de adelante hacia atrás
        }, IntPtr.Zero);
        return found;
    }
    // Todas las ventanas a la vista de la misma app que `top`, de adelante hacia atrás (la primera es `top`): la
    // principal, los diálogos y los paneles sueltos. Con un panel flotante adelante («Properties» de Inventor) la cinta
    // de la principal también cuenta.
    public static IntPtr[] AppWindows(IntPtr top) {
        var list = new System.Collections.Generic.List<IntPtr>(); uint app; GetWindowThreadProcessId(top, out app);
        EnumWindows((h, l) => {
            if (!IsWindowVisible(h) || IsIconic(h)) return true;
            uint pid; GetWindowThreadProcessId(h, out pid); if (pid != app) return true;
            int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
            if ((GetWindowLong(h, -20) & 0x20) != 0) return true; // TRANSPARENT: los clicks la atraviesan, no tapa nada
            Rectangle r = WindowRect(h); if (r.Width < 40 || r.Height < 20) return true;
            list.Add(h); return true;
        }, IntPtr.Zero);
        list.Remove(top); list.Insert(0, top);
        return list.ToArray();
    }
    // La ventana dueña de más arriba (la principal de un diálogo o de un panel suelto). Dos ventanas de Chrome no
    // comparten dueño aunque sean del mismo proceso.
    public static IntPtr RootOwner(IntPtr h) { return GetAncestor(h, 3); }
    public static Rectangle WindowRect(IntPtr h) {
        RECT r; DwmGetWindowAttribute(h, 9, out r, 16);
        return Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
    }
    // Pone el bitmap (alfa por píxel) en una ventana en capas, en `at` (píxeles reales de la pantalla).
    public static void PushLayered(IntPtr h, Bitmap bmp, Point at) {
        IntPtr screenDc = GetDC(IntPtr.Zero), memDc = CreateCompatibleDC(screenDc);
        IntPtr hbmp = bmp.GetHbitmap(Color.FromArgb(0)), old = SelectObject(memDc, hbmp);
        try {
            Point src = Point.Empty; Size size = bmp.Size;
            BLEND b = new BLEND { op = 0, flags = 0, alpha = 255, format = 1 }; // AC_SRC_ALPHA
            UpdateLayeredWindow(h, screenDc, ref at, ref size, memDc, ref src, 0, ref b, 2); // ULW_ALPHA
        } finally {
            SelectObject(memDc, old); DeleteObject(hbmp); DeleteDC(memDc); ReleaseDC(IntPtr.Zero, screenDc);
        }
    }
    public static bool Minimized(IntPtr h) { return IsIconic(h); }
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    // Dónde está la ventana para SetWindowPos (con su borde invisible, si tiene).
    public static Point Position(IntPtr h) { RECT r; GetWindowRect(h, out r); return new Point(r.Left, r.Top); }
    // Mueve una ventana (también de otro proceso: Marito) sin activarla ni cambiarle el orden.
    public static void MoveTo(IntPtr h, int x, int y) { SetWindowPos(h, IntPtr.Zero, x, y, 0, 0, 0x0001 | 0x0004 | 0x0010); } // NOSIZE, NOZORDER, NOACTIVATE
    // Arriba de las otras ventanas «siempre arriba», sin activarla.
    public static void Arriba(IntPtr h) { SetWindowPos(h, (IntPtr)(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010); } // NOSIZE, NOMOVE, NOACTIVATE
    // Que los clicks atraviesen la ventana (WS_EX_TRANSPARENT) o que los tome; lo demás queda igual.
    public static void ClickThrough(IntPtr h, bool through) {
        int ex = GetWindowLong(h, -20);
        SetWindowLong(h, -20, through ? ex | 0x20 : ex & ~0x20);
    }
    // La pantalla entera donde está esa ventana, tal cual se ve (con Marito al costado; la marca no sale).
    public static void Capture(Rectangle bounds, string path) {
        using (Bitmap b = new Bitmap(bounds.Width, bounds.Height))
        using (Graphics g = Graphics.FromImage(b)) {
            g.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, b.Size);
            b.Save(path, ImageFormat.Png);
        }
    }
}

// El recuadro sobre el lugar a tocar: una ventana en capas (alfa por píxel), arriba de todo, que no toma el foco ni
// los clics (los clics pasan a la app de abajo). Sale en las capturas (lo pidió el usuario el 23/11): cuando Marito
// mira la pantalla nunca hay una a la vista (un mensaje nuevo la saca y el paso siguiente se busca después del click). Entra cerrándose sobre el control, late
// mientras espera y se va cuando el usuario hace click (avisa si fue adentro), con Esc o a los 3 minutos.
// El cartel (la marca que enseña, elegida el 23/11): la frase corta con una barrita naranja abajo; con el mouse encima
// (o tocándolo) se abre con «PASO 2 DE 5», la explicación, «Al tocar: …» y «Salir del tutorial». Es lo único de la
// marca que toma clicks: mientras el mouse está encima se le saca WS_EX_TRANSPARENT (sigue sin robar el foco).
public class MarcaOverlay : Form {
    public event Action<string> Done; // "dentro" (tocó el recuadro), "salir" (el botón del cartel), "fuera" (otro click), "esc", "tope"
    readonly Rectangle target;      // en pantalla (píxeles físicos)
    readonly string text;
    readonly IntPtr ignore;         // clicks sobre esta ventana (Marito) no cuentan
    readonly float scale;
    readonly Timer timer;
    MarcaLinea line;                // de Marito (o del mouse) al recuadro; null si no hace falta
    readonly DateTime start = DateTime.Now;
    // La barra que tapa lo marcado se corre (Apartar): desde dónde, cuánto en vertical y cuándo empezó.
    Point moveFrom;
    int moveDy;
    DateTime? moveStart;
    // Lo del cartel abierto: MARCA_PASO, MARCA_TOTAL, MARCA_MAS y MARCA_ALTOCAR, y por stdin (una línea «clave<TAB>valor»)
    // a medida que Claude termina de escribir la lista.
    int paso, total;
    string mas = "", alTocar = "";
    Rectangle area;                 // lo que ocupa la ventana: el recuadro con su brillo + el cartel abierto (en pantalla)
    Rectangle closedLab, openLab;   // el cartel cerrado y abierto, en pantalla (vacíos si no hay frase)
    RectangleF buttonRel;           // «Salir del tutorial», relativo al cartel abierto
    float openT;                    // 0 cerrado, 1 abierto (se anima)
    bool open, clickable, hoverButton;
    DateTime? overSince, outSince, leaving;
    DateTime lastTick = DateTime.Now;
    bool wasDown, escDown, done;
    static readonly Color Accent = Color.FromArgb(217, 119, 87); // #d97757, el de Marito

    public MarcaOverlay(Rectangle target, string text, IntPtr ignore) {
        this.target = target; this.text = text ?? ""; this.ignore = ignore;
        scale = MarcaWin.ScaleAt(target);
        FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; StartPosition = FormStartPosition.Manual; TopMost = true;
        int.TryParse(Environment.GetEnvironmentVariable("MARCA_PASO") ?? "", out paso);
        int.TryParse(Environment.GetEnvironmentVariable("MARCA_TOTAL") ?? "", out total);
        mas = Environment.GetEnvironmentVariable("MARCA_MAS") ?? "";
        alTocar = Environment.GetEnvironmentVariable("MARCA_ALTOCAR") ?? "";
        DoLayout();
        Bounds = area;
        Apartar();
        if (moveStart == null) CrearLinea(); // si la barra se corre, la línea sale cuando llega
        timer = new Timer(); timer.Interval = 16; timer.Tick += delegate { Tick(); };
    }
    void CrearLinea() {
        Point? from = LineOrigin();
        if (from != null) line = MarcaLinea.Create(from.Value, RectangleF.Inflate(target, S(5), S(5)), scale);
    }

    // La barra de Marito (Alt+F2) encima de lo marcado o de su cartel se corre sola, para arriba o para abajo (lo más
    // cerca que entre en la pantalla), en 0,26 s, y la línea sale de donde quedó (24/11, pedido del usuario). La ventana
    // del costado (más alta que media pantalla) no se mueve. No cambia el lugar guardado: el próximo Alt+F2 la trae
    // adonde la dejó el usuario.
    void Apartar() {
        if (ignore == IntPtr.Zero || MarcaWin.Minimized(ignore)) return;
        Rectangle m = MarcaWin.WindowRect(ignore);
        if (m.IsEmpty) return;
        Rectangle work = Screen.FromRectangle(m).WorkingArea;
        if (m.Height > work.Height / 2) return;
        Rectangle ver = Rectangle.Inflate(target, S(10), S(10));
        if (!closedLab.IsEmpty) ver = Rectangle.Union(ver, closedLab);
        if (!m.IntersectsWith(ver)) return;
        int arriba = ver.Top - S(12) - m.Height, abajo = ver.Bottom + S(12);
        bool entraArriba = arriba >= work.Top, entraAbajo = abajo + m.Height <= work.Bottom;
        int y;
        if (entraArriba && entraAbajo) y = Math.Abs(arriba - m.Top) <= Math.Abs(abajo - m.Top) ? arriba : abajo;
        else if (entraArriba) y = arriba;
        else if (entraAbajo) y = abajo;
        else return;
        moveFrom = MarcaWin.Position(ignore); moveDy = y - m.Top; moveStart = DateTime.Now;
    }
    // Un cuadro de la animación de Apartar; al llegar, la línea.
    void Moverse(DateTime now) {
        double k = Math.Min(1, (now - moveStart.Value).TotalMilliseconds / 260);
        double e = 1 - Math.Pow(1 - k, 3); // sale rápido y frena
        MarcaWin.MoveTo(ignore, moveFrom.X, moveFrom.Y + (int)Math.Round(moveDy * e));
        if (k < 1) return;
        moveStart = null;
        CrearLinea();
        if (line != null) { line.Show(); MarcaWin.Arriba(Handle); } // la línea, abajo del recuadro
    }

    // Dónde va cada cosa. El cartel queda abajo del control si entra abierto (si no, arriba), pegado del mismo lado
    // cerrado y abierto, así crece sin taparlo.
    void DoLayout() {
        Rectangle box = Rectangle.Inflate(target, S(70), S(70)); // lugar para la entrada (el aro arranca grande) y el brillo
        closedLab = openLab = Rectangle.Empty;
        if (text.Length > 0) {
            Rectangle scr = Screen.FromRectangle(target).Bounds;
            using (Graphics g = Graphics.FromHwnd(IntPtr.Zero)) {
                Size c = ClosedSize(g);
                int ow = Math.Max(S(340), c.Width);
                Size o = new Size(ow, (int)Math.Ceiling(DrawOpen(g, 0, 0, ow, 0, false)));
                bool below = target.Bottom + S(14) + o.Height <= scr.Bottom - S(8) || target.Top - S(14) - o.Height < scr.Top + S(8);
                closedLab = Place(c, scr, below); openLab = Place(o, scr, below);
            }
        }
        area = closedLab.IsEmpty ? box : Rectangle.Union(box, Rectangle.Union(Rectangle.Inflate(closedLab, S(6), S(6)), Rectangle.Inflate(openLab, S(6), S(6))));
    }
    Rectangle Place(Size s, Rectangle scr, bool below) {
        int x = Math.Max(scr.Left + S(8), Math.Min(target.Left + target.Width / 2 - s.Width / 2, scr.Right - s.Width - S(8)));
        return new Rectangle(x, below ? target.Bottom + S(14) : target.Top - S(14) - s.Height, s.Width, s.Height);
    }
    Size ClosedSize(Graphics g) {
        using (Font f = LabelFont()) {
            SizeF sz = g.MeasureString(text, f, S(360));
            return new Size((int)Math.Ceiling(sz.Width) + S(28), (int)Math.Ceiling(sz.Height) + S(9) + S(6) + S(13));
        }
    }
    // Lo de adentro del cartel abierto, desde (ox, oy) con ese ancho. Con draw=false solo mide: devuelve el alto.
    float DrawOpen(Graphics g, float ox, float oy, int width, int alpha, bool draw) {
        float x = ox + S(14), w = width - S(28), y = oy + S(12);
        using (StringFormat sf = new StringFormat()) {
            using (Font k = new Font("Segoe UI Semibold", 11f * scale, FontStyle.Regular, GraphicsUnit.Pixel)) {
                string s = "PASO " + Math.Max(1, paso) + " DE " + Math.Max(Math.Max(1, paso), total);
                SizeF z = g.MeasureString(s, k, (int)w);
                if (draw) using (SolidBrush b = new SolidBrush(Color.FromArgb(alpha, Accent))) g.DrawString(s, k, b, new RectangleF(x, y, w, z.Height), sf);
                y += z.Height + S(3);
            }
            using (Font f = LabelFont()) {
                SizeF z = g.MeasureString(text, f, (int)w);
                if (draw) using (SolidBrush b = new SolidBrush(Color.FromArgb(alpha, 245, 244, 238))) g.DrawString(text, f, b, new RectangleF(x, y, w, z.Height), sf);
                y += z.Height;
            }
            using (Font f = new Font("Segoe UI", 13.5f * scale, FontStyle.Regular, GraphicsUnit.Pixel)) {
                if (mas.Length > 0) {
                    y += S(8);
                    SizeF z = g.MeasureString(mas, f, (int)w);
                    if (draw) using (SolidBrush b = new SolidBrush(Color.FromArgb(alpha, 220, 219, 212))) g.DrawString(mas, f, b, new RectangleF(x, y, w, z.Height), sf);
                    y += z.Height;
                }
                if (alTocar.Length > 0) {
                    y += S(10);
                    if (draw) using (Pen p = new Pen(Color.FromArgb(alpha, 61, 61, 58), Math.Max(1, scale))) g.DrawLine(p, x, y, x + w, y);
                    y += S(9);
                    // «Al tocar:» en negrita y el resto en gris en el mismo renglón: el resto arranca con espacios duros
                    // que ocupan lo de la negrita (GDI+ no mezcla estilos en un mismo texto).
                    using (Font fb = new Font("Segoe UI Semibold", 13.5f * scale, FontStyle.Regular, GraphicsUnit.Pixel))
                    using (StringFormat tight = new StringFormat(StringFormat.GenericTypographic) { FormatFlags = StringFormatFlags.MeasureTrailingSpaces }) {
                        string head = "Al tocar:";
                        float hw = g.MeasureString(head, fb, PointF.Empty, tight).Width;
                        float sp = Math.Max(1, g.MeasureString(" ", f, PointF.Empty, tight).Width);
                        string rest = new string(' ', (int)Math.Round(hw / sp) + 1) + alTocar;
                        SizeF z = g.MeasureString(rest, f, (int)w);
                        if (draw) {
                            using (SolidBrush b = new SolidBrush(Color.FromArgb(alpha, 163, 162, 156))) g.DrawString(rest, f, b, new RectangleF(x, y, w, z.Height), sf);
                            using (SolidBrush b = new SolidBrush(Color.FromArgb(alpha, 245, 244, 238))) g.DrawString(head, fb, b, x, y, sf);
                        }
                        y += z.Height;
                    }
                }
            }
            using (Font f = new Font("Segoe UI Semibold", 12.5f * scale, FontStyle.Regular, GraphicsUnit.Pixel)) {
                y += S(11);
                string s = "Salir del tutorial";
                SizeF z = g.MeasureString(s, f);
                RectangleF r = new RectangleF(x, y, (float)Math.Ceiling(z.Width) + S(20), (float)Math.Ceiling(z.Height) + S(10));
                buttonRel = new RectangleF(r.X - ox, r.Y - oy, r.Width, r.Height);
                if (draw) {
                    using (GraphicsPath bp = Rounded(r, S(8))) {
                        if (hoverButton) using (SolidBrush b = new SolidBrush(Color.FromArgb(alpha, 58, 57, 54))) g.FillPath(b, bp);
                        using (Pen p = new Pen(Color.FromArgb(alpha, 74, 73, 69), Math.Max(1, scale))) g.DrawPath(p, bp);
                    }
                    using (SolidBrush b = new SolidBrush(Color.FromArgb(alpha, 245, 244, 238)))
                    using (StringFormat c = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center }) g.DrawString(s, f, b, r, c);
                }
                y += r.Height;
            }
        }
        return y + S(12) - oy;
    }

    // Lo que manda server.mjs mientras la marca está a la vista: «paso», «total», «mas» o «altocar», un TAB y el valor.
    void ListenInput() {
        System.Threading.Thread th = new System.Threading.Thread(() => {
            try {
                System.IO.StreamReader input = new System.IO.StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
                string l;
                while ((l = input.ReadLine()) != null) {
                    string line = l;
                    try { BeginInvoke((Action)(() => Apply(line))); } catch { return; }
                }
            } catch { }
        });
        th.IsBackground = true; th.Start();
    }
    void Apply(string line) {
        int tab = line.IndexOf('\t'); if (tab < 0) return;
        string v = line.Substring(tab + 1).Trim();
        switch (line.Substring(0, tab)) {
            case "paso": int.TryParse(v, out paso); break;
            case "total": int.TryParse(v, out total); break;
            case "mas": mas = v; break;
            case "altocar": alTocar = v; break;
            default: return;
        }
        DoLayout();
    }
    // De dónde sale la línea: MARCA_DESDE = marito (por defecto: el borde de Marito más cerca del recuadro), mouse o no.
    Point? LineOrigin() {
        string desde = (Environment.GetEnvironmentVariable("MARCA_DESDE") ?? "").Trim().ToLowerInvariant();
        if (desde == "no") return null;
        if (desde == "mouse" || ignore == IntPtr.Zero || MarcaWin.Minimized(ignore)) return Cursor.Position;
        Rectangle m = MarcaWin.WindowRect(ignore);
        Point c = new Point(target.Left + target.Width / 2, target.Top + target.Height / 2);
        if (m.IsEmpty || m.Contains(c)) return null;
        int x = Math.Max(m.Left, Math.Min(c.X, m.Right)), y = Math.Max(m.Top, Math.Min(c.Y, m.Bottom));
        // Por el costado, que no salga de una esquina.
        if (x == m.Left || x == m.Right) y = Math.Max(m.Top + S(48), Math.Min(y, m.Bottom - S(48)));
        return new Point(x, y);
    }
    int S(float v) { return (int)Math.Round(v * scale); }
    Font LabelFont() { return new Font("Segoe UI Semibold", 15f * scale, FontStyle.Regular, GraphicsUnit.Pixel); }

    protected override CreateParams CreateParams {
        get {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= 0x80000 | 0x20 | 0x80 | 0x08000000 | 0x8; // LAYERED, TRANSPARENT, TOOLWINDOW, NOACTIVATE, TOPMOST
            return cp;
        }
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        wasDown = MarcaWin.GetAsyncKeyState(1) < 0;
        if (line != null) line.Show(); // antes que el recuadro: queda abajo de él
        if (Environment.GetEnvironmentVariable("MARCA_STDIN") == "1") ListenInput();
        Render(); timer.Start();
    }
    protected override void OnFormClosed(FormClosedEventArgs e) {
        timer.Stop(); timer.Dispose();
        if (line != null) line.Close();
        base.OnFormClosed(e);
    }

    // Se va sin avisar (otra marca, un mensaje nuevo, cerrar Marito).
    public void Dismiss() { done = true; if (leaving == null) leaving = DateTime.Now; }

    void Finish(string how) {
        if (done) return;
        done = true; leaving = DateTime.Now;
        SetClickable(false);
        Action<string> d = Done; if (d != null) { try { d(how); } catch { } }
    }
    void SetClickable(bool c) {
        if (c == clickable || !IsHandleCreated) return;
        clickable = c; MarcaWin.ClickThrough(Handle, !c);
    }
    RectangleF ButtonOnScreen() { return new RectangleF(openLab.X + buttonRel.X, openLab.Y + buttonRel.Y, buttonRel.Width, buttonRel.Height); }

    void Tick() {
        DateTime now = DateTime.Now;
        if (moveStart != null && !done) Moverse(now);
        Point p = Cursor.Position;
        // El cartel: con el mouse encima toma los clicks y, a los 0,22 s, se abre; al sacarlo se cierra a los 0,35 s.
        Rectangle lab = open ? openLab : closedLab;
        bool over = !done && !lab.IsEmpty && Rectangle.Inflate(lab, S(6), S(6)).Contains(p);
        SetClickable(over);
        if (over) {
            outSince = null;
            if (overSince == null) overSince = now;
            if (!open && (now - overSince.Value).TotalMilliseconds > 220) open = true;
        } else {
            overSince = null;
            if (open) { if (outSince == null) outSince = now; if ((now - outSince.Value).TotalMilliseconds > 350) open = false; }
        }
        hoverButton = over && open && openT >= 1 && ButtonOnScreen().Contains(p);        Cursor want = over && (hoverButton || !open) ? Cursors.Hand : Cursors.Default;
        if (Cursor != want) Cursor = want;
        float step = (float)((now - lastTick).TotalMilliseconds / 170); lastTick = now;
        openT = open ? Math.Min(1, openT + step) : Math.Max(0, openT - step);

        bool down = MarcaWin.GetAsyncKeyState(1) < 0 || MarcaWin.GetAsyncKeyState(2) < 0;
        if (down && !wasDown && !done) {
            if (over) {
                // Tocar el cartel no saca la marca: lo abre, y el botón sale del tutorial.
                if (hoverButton) Finish("salir");
                else if (!open) { open = true; overSince = now; }
            } else {
                IntPtr under = MarcaWin.GetAncestor(MarcaWin.WindowFromPoint(p), 2);
                if (under != ignore || ignore == IntPtr.Zero) Finish(Rectangle.Inflate(target, S(6), S(6)).Contains(p) ? "dentro" : "fuera");
            }
        }
        wasDown = down;
        bool esc = MarcaWin.GetAsyncKeyState(0x1B) < 0;
        if (esc && !escDown) Finish("esc");
        escDown = esc;
        if ((now - start).TotalMinutes > 3) Finish("tope");
        if (leaving != null && (now - leaving.Value).TotalMilliseconds > 180) { Close(); return; }
        Render();
    }

    internal static float EaseOut(float t) { t = Math.Max(0, Math.Min(1, t)); return 1 - (1 - t) * (1 - t) * (1 - t); }

    void Render() {
        double ms = (DateTime.Now - start).TotalMilliseconds;
        float enter = EaseOut((float)(ms / 320));
        float fade = leaving == null ? 1f : Math.Max(0f, 1f - (float)((DateTime.Now - leaving.Value).TotalMilliseconds / 180));
        if (line != null) line.Step(EaseOut((float)(ms / 420)), fade);
        using (Bitmap bmp = new Bitmap(area.Width, area.Height, PixelFormat.Format32bppArgb)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                Rectangle t = new Rectangle(target.X - area.X, target.Y - area.Y, target.Width, target.Height);
                // Entrada: el aro llega desde grande y se cierra sobre el control.
                float grow = (1 - enter) * S(56);
                RectangleF ring = RectangleF.Inflate(t, S(5) + grow, S(5) + grow);
                float radius = Math.Min(S(10), Math.Min(ring.Width, ring.Height) / 2);
                // Latido: un halo que sale del recuadro y se apaga, cada 1,4 s.
                if (enter >= 1) {
                    float ph = (float)((ms - 320) % 1400 / 1400.0);
                    float spread = S(4) + ph * S(16);
                    int a = (int)(150 * (1 - ph) * fade);
                    using (Pen halo = new Pen(Color.FromArgb(a, Accent), S(3)))
                    using (GraphicsPath hp = Rounded(RectangleF.Inflate(ring, spread, spread), radius + spread)) g.DrawPath(halo, hp);
                }
                using (GraphicsPath rp = Rounded(ring, radius)) {
                    using (SolidBrush tint = new SolidBrush(Color.FromArgb((int)(28 * enter * fade), Accent))) g.FillPath(tint, rp);
                    using (Pen glow = new Pen(Color.FromArgb((int)(70 * enter * fade), Accent), S(9))) g.DrawPath(glow, rp);
                    using (Pen pen = new Pen(Color.FromArgb((int)(255 * Math.Min(1, enter * 1.5f) * fade), Accent), S(3))) g.DrawPath(pen, rp);
                }
                if (!closedLab.IsEmpty) DrawLabel(g, enter * fade);
            }
            MarcaWin.PushLayered(Handle, bmp, area.Location);
        }
    }

    // El cartel: el fondo pasa del tamaño cerrado al abierto (openT) y lo de adentro se cambia a mitad de camino.
    void DrawLabel(Graphics g, float vis) {
        float e = EaseOut(openT);
        Rectangle c = Rel(closedLab), o = Rel(openLab);
        RectangleF r = new RectangleF(c.X + (o.X - c.X) * e, c.Y + (o.Y - c.Y) * e, c.Width + (o.Width - c.Width) * e, c.Height + (o.Height - c.Height) * e);
        float rad = Math.Min(S(16) + (S(14) - S(16)) * e, r.Height / 2);
        using (GraphicsPath lp = Rounded(r, rad)) {
            using (SolidBrush bg = new SolidBrush(Color.FromArgb((int)(240 * vis), 31, 30, 29))) g.FillPath(bg, lp);
            using (Pen edge = new Pen(Color.FromArgb((int)(200 * vis), Accent), S(1.5f))) g.DrawPath(edge, lp);
            Region clip = g.Clip; g.SetClip(lp);
            int closedA = (int)(255 * vis * Math.Max(0, 1 - openT * 2)), openA = (int)(255 * vis * Math.Max(0, openT * 2 - 1));
            if (closedA > 0) {
                using (Font f = LabelFont())
                using (SolidBrush fg = new SolidBrush(Color.FromArgb(closedA, 245, 244, 238)))
                using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center }) {
                    float th = c.Height - S(9) - S(6) - S(13);
                    g.DrawString(text, f, fg, new RectangleF(c.X + S(14), c.Y + S(9), c.Width - S(28), th + 2), sf);
                    // La barrita (como la del teclado del teléfono): 48×3, a 6 px del texto.
                    RectangleF bar = new RectangleF(c.X + (c.Width - S(48)) / 2f, c.Y + S(9) + th + S(6) + S(2), S(48), Math.Max(2, S(3)));
                    using (GraphicsPath bp = Rounded(bar, bar.Height / 2))
                    using (SolidBrush ab = new SolidBrush(Color.FromArgb(closedA, Accent))) g.FillPath(ab, bp);
                }
            }
            if (openA > 0) DrawOpen(g, o.X, o.Y, o.Width, openA, true);
            g.Clip = clip;
        }
    }
    Rectangle Rel(Rectangle r) { return new Rectangle(r.X - area.X, r.Y - area.Y, r.Width, r.Height); }

    static GraphicsPath Rounded(RectangleF r, float rad) {
        GraphicsPath p = new GraphicsPath();
        float d = Math.Max(1, rad * 2);
        p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }
}

// La línea que lleva la vista desde Marito (o desde el mouse) hasta el recuadro, también de una pantalla a la otra:
// una curva suave que se traza en 0,4 s y queda quieta. Es otra ventana en capas, del tamaño de la curva (puede
// cubrir las dos pantallas), así que se dibuja solo mientras entra y al irse; quieta no gasta nada.
public class MarcaLinea : Form {
    readonly Rectangle area;      // en pantalla (píxeles físicos)
    readonly PointF p0, p1, p2;   // inicio, control y fin de la curva, relativos a area
    readonly float scale;
    float drawnProgress = -1, drawnFade = -1;
    static readonly Color Accent = Color.FromArgb(217, 119, 87);

    // null si no hace falta: el origen ya está sobre el recuadro o muy cerca.
    public static MarcaLinea Create(Point from, RectangleF ring, float scale) {
        PointF c = new PointF(ring.X + ring.Width / 2, ring.Y + ring.Height / 2);
        float dx = from.X - c.X, dy = from.Y - c.Y;
        float len = (float)Math.Sqrt(dx * dx + dy * dy);
        if (ring.Contains(from) || len < 90 * scale) return null;
        // Termina un poco afuera del aro, en el lado que mira al origen.
        float k = Math.Min(dx == 0 ? float.MaxValue : ring.Width / 2 / Math.Abs(dx), dy == 0 ? float.MaxValue : ring.Height / 2 / Math.Abs(dy));
        float gap = 14 * scale;
        PointF end = new PointF(c.X + dx * k + dx / len * gap, c.Y + dy * k + dy / len * gap);
        return new MarcaLinea(from, end, scale);
    }

    MarcaLinea(PointF from, PointF end, float scale) {
        this.scale = scale;
        float vx = end.X - from.X, vy = end.Y - from.Y, len = (float)Math.Sqrt(vx * vx + vy * vy);
        // La curva se arquea hacia arriba (o hacia la izquierda si va casi vertical), lejos de Marito.
        float px = -vy / len, py = vx / len;
        if (Math.Abs(py) > 0.3f ? py > 0 : px > 0) { px = -px; py = -py; }
        float bow = Math.Min(len * 0.14f, 160 * scale);
        PointF ctrl = new PointF((from.X + end.X) / 2 + px * bow, (from.Y + end.Y) / 2 + py * bow);
        int pad = (int)Math.Ceiling(14 * scale);
        int l = (int)Math.Floor(Math.Min(from.X, Math.Min(ctrl.X, end.X))) - pad, t = (int)Math.Floor(Math.Min(from.Y, Math.Min(ctrl.Y, end.Y))) - pad;
        int r = (int)Math.Ceiling(Math.Max(from.X, Math.Max(ctrl.X, end.X))) + pad, b = (int)Math.Ceiling(Math.Max(from.Y, Math.Max(ctrl.Y, end.Y))) + pad;
        area = Rectangle.FromLTRB(l, t, r, b);
        p0 = new PointF(from.X - l, from.Y - t); p1 = new PointF(ctrl.X - l, ctrl.Y - t); p2 = new PointF(end.X - l, end.Y - t);
        FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; StartPosition = FormStartPosition.Manual; TopMost = true;
        Bounds = area;
    }

    protected override CreateParams CreateParams {
        get {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= 0x80000 | 0x20 | 0x80 | 0x08000000 | 0x8; // LAYERED, TRANSPARENT, TOOLWINDOW, NOACTIVATE, TOPMOST
            return cp;
        }
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        Step(0, 1);
    }

    PointF At(float u) {
        float a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
        return new PointF(a * p0.X + b * p1.X + c * p2.X, a * p0.Y + b * p1.Y + c * p2.Y);
    }

    // progress: cuánto de la curva está trazado (0 a 1); fade: 1 visible, 0 ida.
    public void Step(float progress, float fade) {
        if (!IsHandleCreated || (progress == drawnProgress && fade == drawnFade)) return;
        drawnProgress = progress; drawnFade = fade;
        using (Bitmap bmp = new Bitmap(area.Width, area.Height, PixelFormat.Format32bppArgb)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                int n = 64;
                PointF[] pts = new PointF[Math.Max(2, (int)Math.Ceiling(n * progress) + 1)];
                for (int i = 0; i < pts.Length; i++) pts[i] = At(Math.Min(progress, progress * i / (pts.Length - 1)));
                if (progress > 0.01f) {
                    // Más tenue en el origen, plena al llegar al recuadro.
                    using (LinearGradientBrush gl = new LinearGradientBrush(p0, p2, Color.FromArgb((int)(20 * fade), Accent), Color.FromArgb((int)(80 * fade), Accent)))
                    using (Pen glow = new Pen(gl, 9 * scale) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
                        g.DrawLines(glow, pts);
                    using (LinearGradientBrush gm = new LinearGradientBrush(p0, p2, Color.FromArgb((int)(110 * fade), Accent), Color.FromArgb((int)(255 * fade), Accent)))
                    using (Pen pen = new Pen(gm, 3 * scale) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
                        g.DrawLines(pen, pts);
                }
                // El punto de donde sale.
                float rd = 5 * scale;
                using (SolidBrush dot = new SolidBrush(Color.FromArgb((int)(230 * fade), Accent))) g.FillEllipse(dot, p0.X - rd, p0.Y - rd, rd * 2, rd * 2);
            }
            MarcaWin.PushLayered(Handle, bmp, area.Location);
        }
    }
}

// Marcar una zona (Alt+F1 o el botón de Marito): la pantalla queda congelada y oscura, el usuario arrastra un
// rectángulo y esa parte se ve clara con el borde naranja. Una ventana por pantalla (cada una con su escala). Esc o el
// botón derecho cancelan. Elegir() devuelve la zona en píxeles reales (vacía si canceló) y guarda el recorte.
public class MarcaZona : Form {
    static readonly Color Accent = Color.FromArgb(217, 119, 87);
    readonly Bitmap dim, clear;      // la parte de esta pantalla: oscurecida y tal cual
    readonly Rectangle screen;       // en píxeles reales
    readonly float scale;
    readonly Action<Rectangle> finish;
    Point? from; Rectangle sel = Rectangle.Empty;

    MarcaZona(Bitmap all, Rectangle virt, Rectangle screen, Action<Rectangle> finish) {
        this.screen = screen; this.finish = finish;
        scale = MarcaWin.ScaleAt(screen);
        Rectangle part = new Rectangle(screen.X - virt.X, screen.Y - virt.Y, screen.Width, screen.Height);
        clear = all.Clone(part, PixelFormat.Format32bppPArgb); // PArgb: se dibuja bastante más rápido
        dim = clear.Clone(new Rectangle(Point.Empty, clear.Size), PixelFormat.Format32bppPArgb);
        using (Graphics g = Graphics.FromImage(dim)) using (SolidBrush b = new SolidBrush(Color.FromArgb(120, 0, 0, 0))) g.FillRectangle(b, 0, 0, dim.Width, dim.Height);
        FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; StartPosition = FormStartPosition.Manual; TopMost = true;
        Bounds = screen; Cursor = Cursors.Cross; DoubleBuffered = true; KeyPreview = true;
    }

    public static Rectangle Elegir(string path) {
        Rectangle virt = SystemInformation.VirtualScreen;
        Rectangle result = Rectangle.Empty;
        using (Bitmap all = new Bitmap(virt.Width, virt.Height, PixelFormat.Format32bppArgb)) {
            using (Graphics g = Graphics.FromImage(all)) g.CopyFromScreen(virt.Left, virt.Top, 0, 0, all.Size);
            var forms = new System.Collections.Generic.List<MarcaZona>();
            bool ended = false;
            Action<Rectangle> finish = r => {
                if (ended) return; ended = true; result = r;
                foreach (MarcaZona f in forms) f.Close();
            };
            foreach (Screen s in Screen.AllScreens) forms.Add(new MarcaZona(all, virt, s.Bounds, finish));
            // Esc y el botón derecho se miran a mano: la ventana puede no tener el foco (la abre otro proceso).
            Timer t = new Timer(); t.Interval = 30;
            bool escWas = true, rightWas = true;
            DateTime start = DateTime.Now;
            t.Tick += delegate {
                bool esc = MarcaWin.GetAsyncKeyState(0x1B) < 0, right = MarcaWin.GetAsyncKeyState(2) < 0;
                if ((esc && !escWas) || (right && !rightWas) || (DateTime.Now - start).TotalMinutes > 2) finish(Rectangle.Empty);
                escWas = esc; rightWas = right;
            };
            forms[0].FormClosed += delegate { t.Stop(); };
            foreach (MarcaZona f in forms) if (f != forms[0]) f.Show();
            forms[0].Shown += delegate { t.Start(); forms[0].Activate(); };
            Application.Run(forms[0]);
            foreach (MarcaZona f in forms) { f.dim.Dispose(); f.clear.Dispose(); }
            if (!result.IsEmpty && path != null) {
                Rectangle src = new Rectangle(result.X - virt.X, result.Y - virt.Y, result.Width, result.Height);
                using (Bitmap crop = all.Clone(src, PixelFormat.Format32bppArgb)) crop.Save(path, ImageFormat.Png);
            }
        }
        return result;
    }

    int S(float v) { return (int)Math.Round(v * scale); }

    protected override void OnMouseDown(MouseEventArgs e) {
        if (e.Button == MouseButtons.Left) { from = e.Location; Capture = true; Invalidate(); } // se va el cartel de arriba
        base.OnMouseDown(e);
    }
    protected override void OnMouseMove(MouseEventArgs e) {
        if (from != null) {
            Point a = from.Value, b = new Point(Math.Max(0, Math.Min(e.X, Width - 1)), Math.Max(0, Math.Min(e.Y, Height - 1)));
            Rectangle old = sel;
            sel = Rectangle.FromLTRB(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y), Math.Max(a.X, b.X), Math.Max(a.Y, b.Y));
            Rectangle dirty = Rectangle.Union(old.IsEmpty ? sel : old, sel);
            dirty.Inflate(S(140), S(60)); // el borde y el cartel con la medida
            Invalidate(dirty);
        }
        base.OnMouseMove(e);
    }
    protected override void OnMouseUp(MouseEventArgs e) {
        if (e.Button == MouseButtons.Left && from != null) {
            from = null; Capture = false;
            if (sel.Width >= S(8) && sel.Height >= S(8)) { Rectangle r = sel; r.Offset(screen.Location); finish(r); return; }
            sel = Rectangle.Empty; Invalidate(); // un click suelto: sigue esperando
        }
        base.OnMouseUp(e);
    }

    protected override void OnPaint(PaintEventArgs e) {
        Graphics g = e.Graphics;
        Rectangle c = e.ClipRectangle;
        g.DrawImage(dim, c, c, GraphicsUnit.Pixel);
        if (!sel.IsEmpty) {
            g.DrawImage(clear, sel, sel, GraphicsUnit.Pixel);
            float w = Math.Max(2, 2 * scale);
            using (Pen p = new Pen(Accent, w)) g.DrawRectangle(p, sel.X - w / 2, sel.Y - w / 2, sel.Width + w, sel.Height + w);
            string size = sel.Width + " × " + sel.Height;
            using (Font f = new Font("Segoe UI Semibold", 12f * scale, FontStyle.Regular, GraphicsUnit.Pixel)) {
                SizeF sz = g.MeasureString(size, f);
                float x = sel.X, y = sel.Bottom + S(8);
                if (y + sz.Height + S(6) > Height) y = sel.Y - sz.Height - S(14);
                using (SolidBrush bg = new SolidBrush(Color.FromArgb(220, 32, 32, 30))) g.FillRectangle(bg, x, y, sz.Width + S(12), sz.Height + S(6));
                g.DrawString(size, f, Brushes.White, x + S(6), y + S(3));
            }
        } else if (from == null) {
            string tip = "Arrastrá para marcar la zona  ·  Esc cancela";
            using (Font f = new Font("Segoe UI Semibold", 15f * scale, FontStyle.Regular, GraphicsUnit.Pixel)) {
                SizeF sz = g.MeasureString(tip, f);
                RectangleF r = new RectangleF((Width - sz.Width) / 2 - S(16), S(28), sz.Width + S(32), sz.Height + S(14));
                if (r.IntersectsWith(c)) {
                    using (SolidBrush bg = new SolidBrush(Color.FromArgb(230, 32, 32, 30))) g.FillRectangle(bg, r);
                    using (Pen p = new Pen(Accent, Math.Max(1, scale))) g.DrawRectangle(p, r.X, r.Y, r.Width, r.Height);
                    g.DrawString(tip, f, Brushes.White, r.X + S(16), r.Y + S(7));
                }
            }
        }
        base.OnPaint(e);
    }
}
