# Marito

Una ventana flotante de Claude para Windows. Apretás un atajo sobre lo que tenés adelante (una página, VS Code, una
carpeta, cualquier programa) y le preguntás o le pedís un cambio: Marito mira la pantalla, reconoce el proyecto y corre
**Claude Code** en esa carpeta. Si le pedís un arreglo en una web tuya, lo hace, lo publica y sigue el deploy.

*A floating Claude window for Windows: press a hotkey over whatever you're looking at and ask or request a change.
It runs Claude Code locally on the project it recognizes. The interface is in Spanish.*

| Atajo | Qué abre |
|---|---|
| **Alt+F1** | La ventana al costado |
| **Alt+F2** | La barra de una línea, arriba |
| **Alt+F3** | Marcar una zona de la pantalla y preguntar por eso |

## Instalar

1. Bajá **`Marito-Setup-x.y.z.exe`** de [Releases](../../releases/latest) y abrilo. Se instala para tu usuario, sin
   pedir administrador. El instalador no está firmado: si Windows muestra «Windows protegió tu PC», tocá
   **Más información → Ejecutar de todas formas**.
2. Marito necesita **Claude Code** con tu cuenta (Pro, Max, Team, Enterprise o API key). Si no lo tenés, Marito te
   ofrece instalarlo con el instalador oficial; después corré `claude` una vez en una terminal para iniciar sesión.
3. Listo: el ícono de Marito queda en la bandeja y los atajos andan en cualquier programa.

### Qué necesita la PC

- Windows 10 u 11 de 64 bits. Lo demás viene con Windows o lo trae el instalador (Node.js, y WebView2 si falta).
- Anda bien en PCs comunes: la ventana y el servidor local usan poca memoria; Claude corre en la nube.
- **Opcional**: `git` y `gh` (GitHub CLI) para que Marito publique tus cambios; la **voz y el dictado** (~1,5 GB, corren
  en el procesador) se instalan desde el menú del ícono. En una PC lenta, la voz tarda más en contestar.

## Antes de usarlo

- Marito corre Claude Code con los **permisos automáticos** (`--permission-mode auto`): en un proyecto puede leer y
  cambiar archivos y hacer commits; en el «Chat libre», leer y escribir en toda la PC. Antes de publicar (push) pregunta.
  Si tu organización apagó el modo automático, Claude arranca en modo manual y no va a poder hacer cambios.
- Lo que hace se cuenta en tu plan de Claude. Las capturas de pantalla van a Claude solo cuando las pedís o marcás.
- Tus datos (configuración, historial, registros) quedan en `%LOCALAPPDATA%\arreglo`; desinstalar Marito no los borra.

## Por ahora, solo con Claude Code

Marito habla con `claude -p --output-format stream-json`. Otras IAs con CLI que edite archivos (Codex CLI, Gemini CLI)
se pueden sumar con un adaptador en `servidor/turnos.mjs`: los PR son bienvenidos.

## Desarrollar

- Sin instalar: `powershell -ExecutionPolicy Bypass -File abrir.ps1` (necesita Node 20+ en el PATH). La interfaz sola, sin
  servidor: abrí `ui/index.html?demo` desde el servidor.
- Pruebas: `npm test`. Cómo está armado: [`ESPEC.md`](ESPEC.md).
- Instalador: `instalador/armar.ps1 -Version 0.1.0` con Inno Setup 6. GitHub Actions lo arma y lo publica en cada tag `v*`.

## Licencia

[MIT](LICENSE)
