# Marito

Ventana flotante de Claude para Windows: Alt+F1 la ventana, Alt+F2 la barra, Alt+F3 marcar una zona (`Marito.exe`,
`lanzador/Marito.cs`). Ventana sin marco (WinForms + WebView2) que corre Claude Code local (`claude -p`) en la carpeta
del proyecto que reconoce, publica y sigue el deploy.

- `abrir.ps1`: captura, URL de la pestaña, proyecto, arranca `server.mjs` y abre la ventana.
- `server.mjs` + `servidor/`: Node sin dependencias npm, un módulo por tema (mapa en «Piezas» de `ESPEC.md`).
- `ui/`: la interfaz, scripts clásicos; el orden en `index.html` importa (`?demo` para verla sin backend).
- `instalador/`: `armar.ps1` + `marito.iss` (Inno Setup 6). `ESPEC.md`: la especificación; leerla antes de tocar nada.

Reglas: castellano rioplatense en textos y comentarios, nombres de código en inglés; `.ps1` con BOM UTF-8; al cerrar
la ventana no queda nada corriendo; `npm test` antes de cada PR.
