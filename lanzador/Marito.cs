// Marito.exe: queda en la bandeja y abre Marito con Alt+F1 (la ventana), Alt+F2 (la barra) y Alt+F3 (marcar una zona),
// como hace capturas.ahk en la PC original. Corre abrir.ps1 (al lado del .exe o una carpeta arriba) con PowerShell 5.1.
// Se compila con el csc de .NET Framework que trae Windows (C# 5: sin $"", ?. ni =>): ver instalador\armar.ps1.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("Marito")]
[assembly: System.Reflection.AssemblyProduct("Marito")]
[assembly: System.Reflection.AssemblyVersion("0.1.0.0")]

static class Programa {
    [STAThread]
    static void Main(string[] args) {
        bool nuevo;
        using (var m = new Mutex(true, "Local\\MaritoLanzador", out nuevo)) {
            if (!nuevo) {
                // Ya está en la bandeja: abrir el .exe de nuevo (menú Inicio) abre la ventana, como Alt+F1.
                Lanzador.Correr(Lanzador.BuscarAbrir(), "", false);
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new Bandeja(Array.IndexOf(args, "--inicio") >= 0));
        }
    }
}

static class Lanzador {
    public static readonly string Datos = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "arreglo");

    public static void Log(string texto) {
        try {
            Directory.CreateDirectory(Datos);
            File.AppendAllText(Path.Combine(Datos, "lanzador.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + texto + Environment.NewLine);
        } catch { }
    }

    public static string Carpeta() { return Path.GetDirectoryName(Application.ExecutablePath); }

    // abrir.ps1 al lado del .exe (instalado) o una carpeta arriba (lanzador\Marito.exe en el repo).
    public static string BuscarAbrir() {
        var aqui = Carpeta();
        foreach (var c in new[] { Path.Combine(aqui, "abrir.ps1"), Path.Combine(Path.GetDirectoryName(aqui), "abrir.ps1") }) {
            if (File.Exists(c)) return c;
        }
        return null;
    }

    public static void Correr(string abrir, string extra, bool recorte) {
        if (abrir == null) {
            MessageBox.Show("No encuentro abrir.ps1 al lado de Marito.exe. Reinstalá Marito.", "Marito", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        var argumentos = "-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File \"" + abrir + "\"" + (recorte ? " -Recorte" : "") + extra;
        try {
            var psi = new ProcessStartInfo("powershell.exe", argumentos);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WorkingDirectory = Path.GetDirectoryName(abrir);
            Process.Start(psi);
            Log("abrir" + extra + (recorte ? " -Recorte" : ""));
        } catch (Exception e) {
            Log("no pude abrir: " + e.Message);
            MessageBox.Show("No pude abrir Marito: " + e.Message, "Marito", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    // Donde lo deja cada forma de instalar Claude Code (lo mismo que busca servidor\turnos.mjs).
    public static string BuscarClaude() {
        var lista = new System.Collections.Generic.List<string>();
        lista.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local\\bin\\claude.exe"));
        lista.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"));
        foreach (var d in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';')) {
            if (d.Trim().Length > 0) { try { lista.Add(Path.Combine(d.Trim(), "claude.exe")); } catch { } }
        }
        foreach (var c in lista) { if (File.Exists(c)) return c; }
        return null;
    }

    public static bool HayNode() {
        if (File.Exists(Path.Combine(Path.GetDirectoryName(BuscarAbrir() ?? Carpeta()), "node\\node.exe"))) return true;
        foreach (var d in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';')) {
            try { if (d.Trim().Length > 0 && File.Exists(Path.Combine(d.Trim(), "node.exe"))) return true; } catch { }
        }
        return false;
    }

    // Una ventana de PowerShell a la vista (instalar Claude Code, la voz): el usuario ve lo que pasa y la cierra él.
    public static void Consola(string comando) {
        try {
            var psi = new ProcessStartInfo("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -NoExit -Command \"" + comando.Replace("\"", "\\\"") + "\"");
            psi.UseShellExecute = true;
            Process.Start(psi);
        } catch (Exception e) { Log("consola: " + e.Message); }
    }
}

class Bandeja : ApplicationContext {
    const int WM_HOTKEY = 0x0312, WM_CLIPBOARDUPDATE = 0x031D;
    const uint MOD_ALT = 0x1, MOD_NOREPEAT = 0x4000;
    const string CLAVE_INICIO = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
    [DllImport("user32.dll")] static extern bool AddClipboardFormatListener(IntPtr h);

    readonly NotifyIcon icono = new NotifyIcon();
    readonly Receptor receptor;
    readonly string abrir = Lanzador.BuscarAbrir();
    DateTime ultimaImagen = DateTime.MinValue;
    ToolStripMenuItem itemInicio;

    // Ventana invisible que recibe los atajos y los avisos del portapapeles.
    class Receptor : NativeWindow {
        readonly Bandeja dueno;
        public Receptor(Bandeja d) { dueno = d; CreateHandle(new CreateParams()); }
        protected override void WndProc(ref Message m) {
            if (m.Msg == WM_HOTKEY) dueno.Atajo(m.WParam.ToInt32());
            else if (m.Msg == WM_CLIPBOARDUPDATE) dueno.Portapapeles();
            base.WndProc(ref m);
        }
    }

    public Bandeja(bool alIniciarWindows) {
        try { icono.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { icono.Icon = SystemIcons.Application; }
        icono.Text = "Marito: Alt+F1 ventana · Alt+F2 barra · Alt+F3 zona";
        icono.ContextMenuStrip = Menu();
        icono.DoubleClick += delegate { Lanzador.Correr(abrir, "", false); };
        icono.Visible = true;

        receptor = new Receptor(this);
        AddClipboardFormatListener(receptor.Handle);
        var ocupados = new System.Collections.Generic.List<string>();
        uint[] teclas = { 0x70, 0x71, 0x72 }; // F1, F2, F3
        for (int i = 0; i < 3; i++) {
            if (!RegisterHotKey(receptor.Handle, i + 1, MOD_ALT | MOD_NOREPEAT, teclas[i])) ocupados.Add("Alt+F" + (i + 1));
        }
        Lanzador.Log("arranque; atajos ocupados: " + (ocupados.Count == 0 ? "ninguno" : string.Join(", ", ocupados)));

        PrimeraVez();
        Revisar(alIniciarWindows);
        if (ocupados.Count > 0) {
            Aviso("Otro programa ya usa " + string.Join(", ", ocupados) + ": abrí Marito desde este ícono o cerrá ese programa y reiniciá Marito.");
        } else if (!alIniciarWindows) {
            Aviso("Marito está listo: Alt+F1 la ventana, Alt+F2 la barra, Alt+F3 marcar una zona.");
        }
    }

    ContextMenuStrip Menu() {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Abrir Marito (Alt+F1)", null, delegate { Lanzador.Correr(abrir, "", false); }).Font = new Font(menu.Font, FontStyle.Bold);
        menu.Items.Add("La barra (Alt+F2)", null, delegate { Lanzador.Correr(abrir, " -Barra", false); });
        menu.Items.Add("Marcar una zona (Alt+F3)", null, delegate { Lanzador.Correr(abrir, " -Zona", false); });
        menu.Items.Add(new ToolStripSeparator());
        itemInicio = new ToolStripMenuItem("Iniciar con Windows", null, delegate { CambiarInicio(!itemInicio.Checked); });
        itemInicio.Checked = ArrancaConWindows();
        menu.Items.Add(itemInicio);
        menu.Items.Add("Instalar la voz y el dictado (opcional, ~1,5 GB)…", null, delegate {
            if (abrir == null) return;
            Lanzador.Consola("& '" + Path.Combine(Path.GetDirectoryName(abrir), "instalar-voz.ps1") + "'");
        });
        menu.Items.Add("Ayuda y código (GitHub)", null, delegate { try { Process.Start("https://github.com/valedominguezl/marito-app"); } catch { } });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Salir", null, delegate { Salir(); });
        return menu;
    }

    void Atajo(int id) {
        // Una imagen copiada hace poco (un recorte): va esa en vez de la ventana entera, como en capturas.ahk.
        bool recorte = (DateTime.Now - ultimaImagen).TotalSeconds < 120;
        if (id == 1) Lanzador.Correr(abrir, "", recorte);
        else if (id == 2) Lanzador.Correr(abrir, " -Barra", recorte);
        else if (id == 3) Lanzador.Correr(abrir, " -Zona", false);
    }

    void Portapapeles() {
        try { if (Clipboard.ContainsImage()) ultimaImagen = DateTime.Now; } catch { /* otro programa lo tiene abierto */ }
    }

    void Aviso(string texto) {
        icono.BalloonTipTitle = "Marito";
        icono.BalloonTipText = texto;
        icono.ShowBalloonTip(5000);
    }

    // La primera vez: qué puede hacer Claude desde Marito, antes de que lo use.
    void PrimeraVez() {
        var marca = Path.Combine(Lanzador.Datos, "lanzador-aviso.txt");
        if (File.Exists(marca)) return;
        MessageBox.Show(
            "Marito abre Claude Code sobre lo que tenés en la pantalla.\n\n" +
            "• Corre con tu cuenta de Claude (suscripción o API key): lo que hace se cuenta en tu plan.\n" +
            "• Usa los permisos automáticos de Claude Code: en un proyecto puede leer y cambiar sus archivos y hacer commits; " +
            "en el «Chat libre» puede leer y escribir en toda la PC. Antes de publicar (push) te pregunta.\n" +
            "• Mira capturas de tu pantalla cuando se lo pedís, y las manda a Claude.\n\n" +
            "Atajos: Alt+F1 la ventana, Alt+F2 la barra, Alt+F3 marcar una zona.",
            "Marito: antes de empezar", MessageBoxButtons.OK, MessageBoxIcon.Information);
        try { Directory.CreateDirectory(Lanzador.Datos); File.WriteAllText(marca, DateTime.Now.ToString("o")); } catch { }
    }

    // Lo que hace falta para que ande: Claude Code (y Node, que trae el instalador).
    void Revisar(bool callado) {
        if (!Lanzador.HayNode()) {
            MessageBox.Show("Falta Node.js. Reinstalá Marito (el instalador lo trae) o instalalo desde https://nodejs.org.", "Marito", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        if (Lanzador.BuscarClaude() != null) return;
        if (callado) { Aviso("Falta Claude Code: abrí Marito desde este ícono para instalarlo."); return; }
        var r = MessageBox.Show(
            "Marito necesita Claude Code y no lo encuentro en esta PC.\n\n¿Lo instalo ahora? Se abre una ventana con el instalador oficial " +
            "(claude.ai/install.ps1) y al terminar Claude te pide iniciar sesión con tu cuenta. Después cerrá esa ventana y abrí Marito.",
            "Marito", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (r == DialogResult.Yes) {
            Lanzador.Consola("irm https://claude.ai/install.ps1 | iex; & (Join-Path $env:USERPROFILE '.local\\bin\\claude.exe')");
        }
    }

    static bool ArrancaConWindows() {
        try { using (var k = Registry.CurrentUser.OpenSubKey(CLAVE_INICIO)) return k != null && k.GetValue("Marito") != null; } catch { return false; }
    }

    void CambiarInicio(bool si) {
        try {
            using (var k = Registry.CurrentUser.CreateSubKey(CLAVE_INICIO)) {
                if (si) k.SetValue("Marito", "\"" + Application.ExecutablePath + "\" --inicio");
                else k.DeleteValue("Marito", false);
            }
            itemInicio.Checked = si;
        } catch (Exception e) { Lanzador.Log("inicio: " + e.Message); }
    }

    void Salir() {
        for (int i = 1; i <= 3; i++) UnregisterHotKey(receptor.Handle, i);
        icono.Visible = false;
        icono.Dispose();
        receptor.DestroyHandle();
        ExitThread();
    }
}
