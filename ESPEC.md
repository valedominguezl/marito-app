# Marito (Arreglo rápido v3) — especificación

> La sección **v3** (al final) manda sobre lo anterior donde se contradicen: pestañas, Chat libre, VS Code,
> sitios genéricos, ventana redimensionable, adjuntos de cualquier tipo, avisos e ícono.

Nació como herramienta personal (Windows 11, castellano rioplatense: "vos", "dale", "mirá") y tiene una versión pública
con instalador (ver «Versión pública e instalador»).
Con **Alt+F2** (`Marito.exe` en la bandeja, o AutoHotkey v2 con `capturas.ahk` en la PC original) se abre una ventana
flotante tipo "Claude quick entry" para **preguntar** sobre la web que está mirando o **pedir un arreglo**,
que se hace con Claude Code local (`claude -p`) en la carpeta del proyecto, se publica y se sigue el deploy.

Hoy existe la v1, `arreglo.ps1` (misma carpeta): ventanita WinForms + globos. **Leerla**: la detección de
ventana/URL/proyecto, el prompt, la publicación y el seguimiento del deploy por GitHub ya están probados
ahí y se reutilizan tal cual (portados donde haga falta). `proyectos.json` es la configuración: desde el 24/11 vive en
`%LOCALAPPDATA%\arreglo\proyectos.json` (la escribe el servidor; la de la carpeta del programa se copia ahí una vez).
La v1 queda como respaldo; la v2 la reemplaza en el atajo.

## Piezas (todo en la carpeta de Marito)

| Archivo | Qué es | Quién lo hace |
|---|---|---|
| `abrir.ps1` | Al apretar Alt+F2: captura, URL, proyecto, arranca el servidor y muestra la ventana WebView2 sin marco | agente backend |
| `server.mjs` + `servidor\*.mjs` | Node 20+, **sin dependencias npm**. HTTP en 127.0.0.1, corre `claude`, publica, sigue el deploy. `server.mjs` es solo la entrada (desde el 24/11); el código va en `servidor\`, un módulo por tema: rutas → `rutas-*.mjs` + `http.mjs`, turnos → `turnos.mjs`, marca → `marca.mjs`, voz y dictado → `voz.mjs`, publicar y deploy → `publicacion.mjs`, celular y apagar → `ciclo.mjs`. Lo que se reasigna vive en el objeto `estado` de `servidor\estado.mjs` (un import no se puede reasignar) | agente backend |
| `lib\` | DLLs de WebView2 (del paquete NuGet `Microsoft.Web.WebView2`) | agente backend |
| `ui\index.html` (+ `ui\*.css`, `ui\*.js`, `ui\vendor\`) | La interfaz. Desde el 24/11 la lógica son scripts clásicos (sin módulos) que comparten el ámbito global y cargan **en este orden** en `index.html`, después de `md.js`: `estado`, `pestanas`, `historial-fondo`, `dibujo`, `publicacion`, `eventos` (incluye el modo barra y el SSE), `envio`, `audio`, `ventana`, `arranque` (último: arranca y carga `demo.js`) | agente UI |
| `capturas.ahk` (fuera del repo) o `lanzador\Marito.cs` | Alt+F1/F2/F3 llaman a `abrir.ps1`; registran cuándo se copió una imagen al portapapeles (para `-Recorte`) | agente backend |
| `instalador\` | `armar.ps1` + `marito.iss`: el instalador de la versión pública (ver «Versión pública e instalador») | agente backend |
| `publico\` | Lo que es solo del repo público (README, licencia, workflow) y `exportar.ps1`, que lo arma | agente backend |

## Flujo

1. Alt+F2 → AHK corre `powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File abrir.ps1 [-Recorte]`.
   `-Recorte` va si se copió una imagen al portapapeles hace menos de 2 minutos (AHK: `OnClipboardChange`, tipo 2 =
   no texto, guarda `A_TickCount`). Así: Shift+F1 (recorte de ZoomIt) y después Alt+F2 usa el recorte.
2. `abrir.ps1`, en este orden y antes de mostrar nada (la ventana de adelante tiene que seguir siendo el navegador):
   ventana de adelante → URL por UI Automation → captura solo si `-Recorte` (la imagen del portapapeles; sin recorte no
   adjunta nada: desde el 23/11 la ventana de adelante no se captura sola, las capturas las manda el usuario) → proyecto por sitio (`proyectos.json`, igual que v1). Escribe `contexto.json` en una carpeta de la
   sesión (`%LOCALAPPDATA%\arreglo\<stamp>\`), arranca `node server.mjs <carpeta-sesion>` oculto, espera que el
   servidor diga su puerto (por stdout o un archivo), y abre la ventana.
3. Si ya hay una ventana abierta (mutex con nombre), Alt+F2 le pasa lo nuevo (`/api/entrada`) y le pide mostrarse como
   barra (Alt+F1, como ventana) por WM_COPYDATA, sin abrir otra (ver «Modo barra»).
4. Ventana: WinForms `FormBorderStyle=None`, a la derecha, siempre del mismo tamaño a escala de la pantalla (~24,6% de ancho, desde justo debajo de la barra de favoritos
   del navegador de esa pantalla —el borde de arriba de su `Chrome_RenderWidgetHostHWND`; sin navegador, el 11,5% del alto—
   hasta la barra de tareas, pegada, y la sigue si aparece; ~4,4% libre a la derecha), sin reservar lugar (no es appbar), esquinas redondeadas nativas de Win11
   (`DwmSetWindowAttribute` 33 = 2) y sombra; apoyada en la barra, solo las de arriba (región `CreateRoundRectRgn`, sin sombra), con un WebView2 que ocupa todo y carga `http://127.0.0.1:<puerto>/`.
   Ventana de vidrio: marco DWM extendido a toda la ventana + `DwmEnableBlurBehindWindow` con región vacía, form
   negro y WebView2 con fondo transparente: vidrio transparente, sin acrílico (el
   acrílico de Windows difumina siempre igual, mucho, y no se puede regular). Lo de atrás se ve tal cual (sin difuminar: la capa que copiaba y difuminaba la pantalla se sacó, y con ella la
   exclusión de capturas, así que Marito sale en fotos y capturas). El tinte lo pone el CSS (`--glass-win`,
   `--glass-text` detrás de barra y mensajes, `--glass-input` en la caja de escribir). **Botón de deslizadores** arriba
   (al lado del historial): la configuración, por categorías que se abren y cierran. «Carpeta de proyectos» (abierta): la
   ruta (`raiz` de `proyectos.json`, `POST /api/raiz {raiz}`, «Elegir…» abre el diálogo de Windows por el host:
   `{tipo:'elegirCarpeta'}` → `{tipo:'carpeta', ruta}`); vacía = no se habla de proyectos (ver «Modo barra»).
   «La ventana»: oscuro, brillo y fondos, aplicados en el momento, con «Como venía»; se guarda con `POST /api/fondo` en
   `interfaz.json` y vuelve en `/api/contexto`.`fondo`. «La voz»: ver «La voz». **Tu último mensaje** que ya pasó para arriba queda fijo arriba
   del chat mientras bajás (como VS Code); tocarlo lleva hasta él. Mensajes de la UI al host por
   `window.chrome.webview.postMessage`: `{tipo:'arrastrar'}` (mover la ventana: ReleaseCapture + WM_NCLBUTTONDOWN
   HTCAPTION), `{tipo:'cerrar'}`, `{tipo:'minimizar'}`, `{tipo:'fijar'}` (botón 📌: alterna `TopMost`, se guarda en
   `ventana.json` y vuelve en `{tipo:'ventana', modo, fijada}`). Al cerrar la ventana: `POST /api/cerrar` y matar el
   servidor y cualquier `claude` hijo (árbol entero). Nada queda corriendo.
5. Arranque objetivo: ventana visible en < 2 s desde Alt+F2.

## API del servidor (contrato entre backend y UI)

Todo JSON, en `http://127.0.0.1:<puerto>`. Solo escucha en 127.0.0.1 y exige el token que `abrir.ps1` pasa en la URL
inicial (`/?t=<token>`); la UI lo manda en el header `X-Token` (y como `?t=` en el SSE y las imágenes).

- `GET /` → `ui/index.html`; `GET /ui/...` estáticos.
- `GET /api/contexto` →
  ```json
  { "proyecto": "La Esquina", "proyectos": ["La Esquina", "Taller Norte", "..."],
    "sitio": "laesquina.com", "url": "laesquina.com/admin?ver=...",
    "modelo": "claude-opus-5-5",
    "modelos": [ {"id":"claude-opus-5-5","nombre":"Opus 5.5"}, {"id":"claude-sonnet-5-5","nombre":"Sonnet 5.5"},
                 {"id":"claude-fable-5-2","nombre":"Fable 5.2"}, {"id":"claude-haiku-5-5","nombre":"Haiku 5.5"} ],
    "adjuntos": [ {"id":"a1","url":"/adjuntos/a1.png","origen":"ventana"} ],
    "ocupado": false }
  ```
  `proyectos` incluye los conocidos de `proyectos.json` y los repos descubiertos en la carpeta raíz (como v1).
  `modelo` = el de entrada de cada chat nuevo: siempre Opus 5.5 (desde el 23/11, lo pidió el usuario; antes Sonnet 5.5); el que se elige vale solo para ese chat.
- `POST /api/adjunto` `{ "png": "<base64>" }` (pegado con Ctrl+V en la UI) o `{ "ruta": "C:\\..." }` (desde el host)
  → `{ "id", "url" }`. `DELETE /api/adjunto/:id` lo saca.
- `GET /adjuntos/:id.png` → la imagen.
- `POST /api/mensaje` `{ "texto", "adjuntos": ["a1"], "modelo", "proyecto" }` → `{ok:true}` y arranca un turno.
  409 si hay un turno corriendo. Cambiar `proyecto` a mitad de conversación arranca una conversación nueva.
- `POST /api/detener` → corta el turno (mata el árbol de `claude`).
- `POST /api/publicar` `{ "confirmar": true|false }` → respuesta a una pregunta `publicar-confirmar`.
- `POST /api/nueva` → olvida la conversación (siguiente mensaje arranca sesión nueva).
- `POST /api/cerrar` → apaga todo.
- `GET /api/eventos` → **SSE** (`text/event-stream`), cada evento `data: <json>\n\n`:
  - `{"tipo":"turno-inicio","id":n}`
  - `{"tipo":"texto","delta":"..."}` — texto de la respuesta, a medida que llega (markdown).
  - `{"tipo":"herramienta","nombre":"Read","detalle":"app/menu/page.tsx"}` — una línea compacta por herramienta
    (Read/Grep/Glob/Bash/Edit/Write/Agent…; `detalle` = archivo, patrón, comando corto o descripción del agente).
  - `{"tipo":"turno-fin","id":n,"costoUsd":0.04,"segundos":31,"cambio":true|false}` — `cambio` = hubo commit nuevo.
  - `{"tipo":"error","texto":"..."}`
  - `{"tipo":"publicar-confirmar","motivos":["El repo está en la rama ...","Además salen 3 commits: ..."]}`; ya contestada,
    el historial la guarda con `"respondida":"si"|"no"` (una pantalla que recarga la dibuja sin botones y no espera; las
    que vuelven de `abiertas.json` sin contestar quedan en `"no"`). El `push` o `cancelado` que la siguen también la dan por contestada.
  - `{"tipo":"publicacion","paso":"push"|"armando"|"publicado"|"fallo"|"sin-deploy"|"tope","texto":"Publicado 21:40: ..."}` (`push` trae `pasos`: 2 sin deploy, 4 con deploy)
  Al conectar, el servidor reenvía el historial de eventos de la conversación (la UI puede recargarse).

## Turnos de Claude

- `claude -p --output-format stream-json --verbose --include-partial-messages --model <id>
  --permission-mode auto --disallowedTools "Bash(git push:*)" "PowerShell(git push:*)" --append-system-prompt
  <instrucciones>` (el push es de la ventana) con el mensaje por stdin; desde el segundo
  turno, `--resume <session_id>` (sale del evento `system`/`result` del primer turno). cwd = carpeta del proyecto.
  Ejecutable: `%APPDATA%\npm\claude.cmd` (en Node, `spawn` con `shell:true` o por `cmd.exe /c`).
  Verificar los flags con `claude --help` antes de usarlos.
- Adjuntos: el mensaje lleva las rutas de las imágenes ("Capturas: C:/.../a1.png — miralas con Read").
- Instrucciones (append-system-prompt), en castellano, adaptadas de la v1:
  - Es una ventana rápida: respuestas cortas y directas, en castellano rioplatense.
  - Si el usuario **pregunta**, responder leyendo el código, **sin cambiar archivos**. Si conviene un arreglo,
    decirlo en una frase y terminar con la línea exacta `¿Lo arreglo?`.
  - Si **pide un cambio** (o contesta "dale", "arreglalo"), hacerlo: cambio mínimo, verificación del proyecto
    (tipos/compilación), commit solo con sus archivos al estilo del repo y tag si el repo usa; **sin push**.
    Los pedidos grandes (columna/tabla nueva, plata, login) también se hacen, como en un chat normal; lo que toca
    datos reales o no tiene vuelta (migración sobre la base real, borrar datos, mails o cobros) se deja listo y se
    corre después del OK del usuario.
  - Puede usar agentes (herramienta Agent) para buscar en paralelo cuando ayude.
- Fin del turno: si HEAD cambió → el servidor corre la publicación (lógica de v1: rama esperada y commits ajenos
  → `publicar-confirmar` y espera `/api/publicar`; `git push origin HEAD:<publicarEn>` + tags del commit; seguir
  status/check-runs de GitHub del commit con `gh api`, filtro `deploy` del proyecto, topes 12 min / 4 min sin nada;
  aprender `deploy` en proyectos nuevos). Emite eventos `publicacion`. Sin filtro se siguen solo los checks que parecen
  de una plataforma (`checksDeploy`: Vercel, Netlify, Workers…; CodeQL o los tests no) y de ahí se aprende; si ninguno lo
  parece, se miran todos sin aprender. Un check cancelado (Vercel cancela el de un commit cuando llega otro) no es «falló»:
  si nada salió bien termina en `tope` «el deploy se canceló» (`estadoDeploy`). Un `gh` que falla no cuenta como «no hay
  deploy» (`leerChecks`): un minuto seguido así termina en `tope` con el error de `gh`. El tope del push (10 min) mata
  el árbol entero (`run` con `spawn` + `taskkill /T`), hook pre-push incluido, para que no suba a Play algo cuyo push
  falló. Los tags que salen son los del commit publicado, no los de `HEAD`.
- Topes: un turno se corta a los 15 min (evento `error`). Un solo turno a la vez por pestaña: `c.arrancando` se pone
  antes del primer `await` de `iniciarTurno` (PC y celular casi juntos daban dos `claude --resume`), y si la pestaña
  se cerró mientras se miraba git no arranca. Cerrar una pestaña con «¿Publico igual?» abierta pregunta antes (sería
  «No publicar»), y «Terminemos y seguir» la deja abierta para contestarla.
- El turno termina con el evento `result` de claude, no al cerrarse el proceso (tarda ~1 s más en salir; un `--resume`
  enseguida ya ve la conversación entera, probado el 23/11). `finTurno` corre una sola vez (`t.terminado`).
- Tiempos medidos el 23/11 (Opus·High, pregunta simple, Chat libre): proceso 0,8 s → `init` 2,9 s (2 s esperando que
  conecte **windows-mcp**; sin él 0,9 s) → primer texto ~4,5 s. El esfuerzo no cambia nada en algo simple; los hooks
  del usuario pesan <0,1 s. Los conectores de claude.ai suman ~5k tokens pero no tiempo; no se pueden dejar sin windows-mcp
  (`--strict-mcp-config` o `deniedMcpServers` sacan todos).
- **La pantalla, antes de preguntar** (24/11, pedido del usuario: «¿cómo cierro esto?» tardaba 14 s en tres vueltas:
  correr `marcar.ps1`, mirar la captura con Read y recién contestar). Si el mensaje parece de la pantalla
  (`pareceDePantalla`: «cómo / dónde», guiame, «qué toco», cierro/abro/…, hasta 200 letras; o lo que manda la marca:
  «Listo, ya lo toqué», «Quiero volver al tutorial») y no viene del celular, el servidor corre `marcar.ps1` mientras
  arranca claude (`mirarParaClaude`, tope 6 s) y manda el mensaje por stdin como `--input-format stream-json`: el texto
  con «Ya miré la pantalla por vos…» y la lista, y la captura como imagen. Si no pudo mirar, va el texto solo y Claude
  corre el script como antes. Medido por la API con un servidor de prueba (Opus, esfuerzo por defecto, la misma
  pregunta): antes 17 y 12,6 s (recuadro a los 12,2 s), después 8,0 y 8,5 s (recuadro a los 6,6 s), mismo costo
  (~US$0,26). **Esos turnos van con esfuerzo bajo** si el usuario no eligió otro (24/11, «lo que ayude, mientras no
  se equivoque»): 3 de 3 con el mismo paso y la misma explicación, recuadro a los 3,7–4,2 s y fin a los 5,3–5,8 s. Se
  descartó: Sonnet (~6,7 s, más lento que Opus bajo), Haiku (no ganaba tiempo y se equivocó de programa) y agentes con
  otro modelo para leer (ya no hay nada que leer: la lista y la captura llegan en el mensaje; serían una vuelta más).
- **Conectores a pedido** (desde el 23/11, lo eligió el usuario): cada conversación arranca **sin MCP**
  (`--strict-mcp-config` + `SIN_CONECTORES` en las instrucciones: primer texto ~2,8 s en vez de ~4,5). Si Claude necesita
  uno responde una frase y `[CONECTORES]` solo en el último renglón (`pideConectores`); el servidor emite `herramienta`
  `Conectores`, pone `c.mcp = true` y sigue el mismo turno (`iniciarTurno` con `previo`: sin `usuario` ni `turno-inicio`
  nuevos, mismo id, costo sumado) con «Ya tenés los conectores cargados: seguí con lo que te pedí.» (hereda el pedido
  original, `t.pedido`: un `[PROYECTO:…]` después manda lo que pidió de verdad, con sus adjuntos). La conversación
  queda con MCP hasta cerrarla (reabierta del historial arranca sin). La UI no muestra la etiqueta.
- Registro de cada sesión en su carpeta (`eventos.jsonl`, stderr de claude) para diagnosticar.

## Interfaz (agente UI)

Inspirada en el Claude flotante de la app de escritorio / Claude Code: limpia, moderna, cálida.
- Tokens en `:root` con modo claro y oscuro (`prefers-color-scheme`). Paleta tipo Claude: claro fondo `#faf9f5`,
  superficie `#ffffff`, texto `#1f1e1d`, secundario `#6b6a65`, bordes `#e8e6dc`, acento `#d97757`; oscuro fondo
  `#262624`, superficie `#30302e`, texto `#f5f4ee`, secundario `#a3a29c`, bordes `#3d3d3a`, acento `#d97757`.
  Fuente `"Segoe UI Variable", "Segoe UI", system-ui`; código en `"Cascadia Code", Consolas`.
- Arriba, una barra fina que sirve para arrastrar (`mousedown` → postMessage `arrastrar`): punto del proyecto +
  selector de proyecto (discreto) + sitio, selector de modelo a la derecha, botones minimizar/cerrar.
- Centro: la conversación. Mensajes del usuario con sus miniaturas; respuestas en markdown (renderer propio
  chico o una librería guardada en `ui/vendor/`, **sin CDN**: tiene que andar offline); las herramientas como
  líneas compactas grises (ícono + "Leyendo app/menu/page.tsx"), agrupables; indicador de "pensando" animado
  sutil mientras no llega texto. Si la respuesta termina en `¿Lo arreglo?`, botón **"Arreglalo"** (manda "Dale,
  arreglalo."). La publicación como una tarjeta de progreso con pasos (Commit → Push → Armando → Publicado) y
  la hora; `publicar-confirmar` como tarjeta con los motivos y botones "Publicar igual" / "No publicar".
- Abajo, la caja de texto (auto-crece, Enter envía, Shift+Enter salto de línea, foco al abrir) con las
  miniaturas de adjuntos encima (cada una con ✕; click = verla grande). Ctrl+V de una imagen la adjunta.
  Botón enviar / detener (mientras corre). Esc: si corre, nada; si no, cierra la ventana. Ctrl+N conversación nueva.
- Placeholder: "Preguntá o pedí un arreglo…". Sin textos de relleno ni explicaciones.
- Sin animaciones de más: transiciones cortas (150–200 ms) en opacidad/transform, `prefers-reduced-motion`.
- Mientras se desarrolla sin backend: un modo `?demo` con eventos simulados para poder verla en Chrome.

## Reglas comunes

- Comentarios y textos en castellano rioplatense; nombres de variables/funciones en inglés.
- Nada queda corriendo al cerrar la ventana. Nada de servicios de fondo. **Salvo el modo fijo** (ver «Modo fijo y
  celular»), que el usuario eligió el 23/11/2026: con `remoto.json` el servidor queda prendido a propósito.
- No publicar nada real en las pruebas (no hacer commits/push en repos reales para probar). Para probar turnos de
  Claude, preguntas que no cambian archivos.
- PowerShell 5.1: archivos `.ps1` con BOM UTF-8 (tienen acentos); `$ErrorActionPreference='Continue'` con `git`.

## Cambios al contrato (backend)

- **Auth**: además de `X-Token` y `?t=`, el servidor acepta una cookie `arreglo=<token>` (HttpOnly, SameSite=Strict) que pone al servir `/?t=`. Así los estáticos (`/ui/...`) cargan sin token en la URL. También exige `Host` = `127.0.0.1:<puerto>` y, si hay `Origin`, que sea el mismo.
- **Estáticos**: `GET /ui/x` y también `GET /x` (se busca en `ui\`).
- **SSE `usuario`**: `{"tipo":"usuario","texto":"...","adjuntos":[...],"cliente":"..."}`. Va en el replay (la UI reconstruye los mensajes al recargarse) y, desde el modo fijo, también en vivo para la otra pantalla: la que lo mandó (`cliente` = el que puso en `/api/mensaje`) no lo vuelve a dibujar.
- **SSE `adjunto`** (en vivo, no va al historial): `{"tipo":"adjunto","id":"a2","url":"/adjuntos/a2.png","origen":"ventana"}` cuando entra una captura por `POST /api/adjunto {ruta}` (segundo Alt+F2).
- **`POST /api/adjunto`** acepta además `origen` opcional (`"ventana"` | `"recorte"` | `"pegado"`); por defecto `"pegado"` con `png` y `"ventana"` con `ruta`.
- **`publicacion.paso`**: se suma `"cancelado"` (el usuario eligió "No publicar": "Quedó commiteado sin publicar.").
- **`turno-fin`** sale siempre al terminar un turno, también después de un `error`, y al detener (`cambio` = HEAD cambió). Si un turno se detuvo o terminó con error no se publica aunque haya commit.
- **`/api/contexto`.adjuntos** lista solo los que todavía no se mandaron en un mensaje.
- **Host (WebView2 a abrir.ps1)**: además de `arrastrar`, `cerrar`, `minimizar`, atiende `{tipo:'abrir', url}` (abre en el navegador por defecto, solo http/https). Los links nuevos (`target=_blank`) también se abren afuera.
- **abrir.ps1** solo lee la dirección si la ventana de adelante es un navegador (chrome/msedge/firefox/brave/opera/vivaldi/arc); en otras apps el "primer campo de texto" podía ser cualquier cosa.

## v3

### Qué hay adelante (abrir.ps1 → `contexto.json`)
- **Navegador**: dirección por UI Automation y proyecto por sitio, salvo los **genéricos** (`genericos.json`: Google,
  GitHub, localhost, Vercel/Netlify, IPs…), que no reconocen ni se aprenden.
- **VS Code** (`Code.exe`): el título es «archivo - carpeta - Visual Studio Code»; la carpeta se busca por nombre entre las
  de `%APPDATA%\Code\User\globalStorage\storage.json` (ventanas abiertas, backups y `profileAssociations`). Si es un
  proyecto conocido (o está adentro, o adentro hay uno solo) → ese; si no, la carpeta misma (`carpeta`).
- **Explorador**: la carpeta abierta (Shell.Application); si está en un proyecto o en un repo git, ese.
- Si nada coincide → **Chat libre** (`proyecto: ''`). Nunca hay «no encontré el proyecto».
- **Lo de atrás** (desde el 23/11): `donde` suma «Atrás, abiertas: «título» (programa), …», hasta 3 ventanas no minimizadas
  de otros programas (`Behind` en `abrir.ps1`). Con Copilot adelante e Inventor atrás, «¿cómo revierto el zoom?» se
  contestaba de Copilot: Claude elige el de adelante salvo que la pregunta encaje mejor con uno de atrás, y si no se sabe, pregunta.
- Campos: `proyecto`, `carpeta`, `sitio`, `url`, `donde` (frase para Claude: «En VS Code tenía abierto…»), `app`,
  `captura`, `origenCaptura`.

### Conversaciones (pestañas)
- Cada pestaña es una conversación del servidor (`c1`, `c2`…), con su proyecto, sesión de claude, turno, publicación y
  modelo. Corren a la vez. Todos los eventos SSE llevan `conv`; al conectar se reenvía el historial de todas y después
  `{"tipo":"replay-fin"}`.
- **Chat libre**: cwd = carpeta del usuario, `--add-dir` con los discos, instrucciones propias (todo permitido salvo
  publicar; preguntar antes de borrar o pisar archivos ajenos). No hay git ni publicación.
- API nueva o cambiada:
  - `GET /api/contexto` → `{ proyectos, modelo, modelos, esfuerzo, esfuerzos, conversaciones:[{id,proyecto,sitio,url,donde,titulo,ocupado}], inicial, adjuntos }`
  - `POST /api/conversacion {id?, proyecto, sitio, url, donde}` → crea (sin id) o cambia una (otro proyecto = de cero).
  - `DELETE /api/conversacion/:id` → corta su turno y la olvida.
  - `POST /api/mensaje {conv, texto, adjuntos, modelo, esfuerzo, proyecto}` (`esfuerzo` → `claude --effort`, '' = el del modelo;
    queda como último en `proyectos.json`); `POST /api/detener {conv}`; `POST /api/publicar {conv, confirmar}`.
  - **Push** (al lado del esfuerzo, se recuerda en `localStorage`): casillas «Commitear los cambios» y «Push
    automático». `/api/mensaje` lleva `commit` y `push`: sin commit, a Claude se le pide no commitear; con push manual,
    el commit queda en la compu (`publicacion` `paso:'local'`, `manual:true`, botón «Publicar ahora» →
    `POST /api/publicar-ahora {conv}`, que publica todo lo juntado desde el primer commit sin publicar).
  - `POST /api/audio[?parcial=1]` (cuerpo crudo: todo lo grabado hasta ahora con el botón del micrófono, webm) → `{ok, texto}`:
    `transcribir.py --servidor` (faster-whisper local, placa de video o procesador; un solo proceso con el modelo cargado,
    se arranca al abrir la ventana —carga el modelo antes del primer dictado— y se mata al apagar; en la placa usa las DLL de
    los paquetes pip `nvidia-cublas-cu12` y `nvidia-cudnn-cu12`). **Dictado**: mientras grabás, cada medio segundo la UI manda
    todo lo grabado como parcial (se retranscribe entero, así lo anterior se corrige con el contexto) y el texto se va escribiendo en la caja (después de lo que ya había); al cortar, la versión final queda
    escrita y **no se manda**. Esc descarta lo dictado.
  - **Historial**: al terminar cada turno la conversación se guarda en `%LOCALAPPDATA%\arreglo\historial.json` (por
    `sessionId`, las últimas 60, hasta 600 eventos cada una). `GET /api/historial` → `[{sessionId,proyecto,sitio,url,titulo,fecha}]`;
    `POST /api/conversacion {reabrir: sessionId}` → pestaña nueva que sigue esa sesión (`--resume`) con `eventos` para
    dibujarla (o `yaAbierta` si ya hay una pestaña con esa sesión).
  - **Las pestañas vuelven** (desde el 23/11): `%LOCALAPPDATA%\arreglo\abiertas.json` = `[{sessionId, donde}]` de las pestañas
    abiertas con conversación, en orden (se escribe al terminar un turno, al reabrir del historial y al cerrar o empezar de
    cero una; al apagar no se toca). Al arrancar, el servidor vuelve a abrir desde el historial **solo las que tienen algo
    escrito sin mandar** (borrador o cola; desde el 24/11, pedido del usuario: lo demás queda en el historial y se arranca
    con un chat nuevo), antes de la pestaña nueva del Alt+F2 (que sigue siendo `inicial`): Shift+× sin servidor fijo, un
    `-Reiniciar` del fijo o la PC que se reinicia no pierden lo escrito. `/api/contexto`.`conversaciones[].borrador`: el borrador de cada una (por sesión; no al celular).
  - **Cómo se publica** cada proyecto: `publicar` en `proyectos.json` = `deploy` (por defecto: push y seguir el deploy),
    `github` (solo push, la tarjeta termina en «Subido a GitHub») o `no` (solo commit, paso `local`). Sin remoto `origin` → `no`.
  - **Terminal**: botón `>_` (o Ctrl+`) en la caja: lo que se escribe corre en PowerShell en la carpeta del proyecto
    (`POST /api/comando {conv, comando}`, tope 5 min, `cd` se recuerda). Eventos `comando-inicio {comando,cwd}`,
    `comando-salida {texto,error?}` (hasta 200 KB por comando: después un aviso y se descarta, el comando sigue),
    `comando-fin {codigo,cwd,detenido,tope,segundos}`; `/api/detener` también lo corta.
  - Tarjetas de publicación: si sale otra del mismo proyecto, la anterior sin terminar queda atenuada y quieta (`stale`).
  - UI: mientras corre un turno, Enter deja el mensaje «en cola» y sale al terminar; Esc corta el turno (y sigue la cola).
    Un mensaje que el servidor rebota con 409 (la otra pantalla mandó algo un instante antes, o una pregunta de publicar
    que esta no vio) vuelve a la cola: sale con el fin de lo que corre o reintenta a los 3 s. Al reconectar, la cola
    espera a `replay-fin`. Lo encolado va al borrador guardado delante de lo escrito: una ventana recargada lo trae en la caja.
    Las pestañas no se achican de más: se corren con la rueda. Ventana arriba de todo (`TopMost`) salvo que la suelten con 📌.
  - `POST /api/entrada {proyecto, carpeta, sitio, url, donde, ruta, origen}` (segundo Alt+F2) → SSE
    `{"tipo":"entrada", proyecto, proyectos, sitio, url, donde, adjunto}`. La UI: recorte o mismo proyecto → se suma a la
    pestaña actual; pestaña vacía → pasa a ser de lo nuevo; si no → pestaña nueva.
  - **El proyecto no se ve** (desde el 23/11, reemplaza al «¿Abrir en X?» y al selector de la caja): ver «Modo barra».
  - `turno-fin` suma `ok`, `detenido` y `contexto` (tokens del último llamado de claude: entrada con y sin caché + salida).
  - **Contexto y Terminemos**: debajo de los botones de arriba, pegados a la derecha (en la fila de los otros chats), un
    aro que se llena contra 200k con el número al lado («41k», naranja desde 150k) y, en conversaciones con proyecto, una
    flechita: manda `/terminemos`; si la respuesta deja un bloque de código (quedó algo pendiente), es el prompt de una
    pestaña nueva del mismo proyecto que arranca sola y la vieja se cierra (también con `/terminemos` escrito a mano); si no, termina ahí
    (`POST /api/conversacion {..., encadenadoDe: conv}`). El historial guarda `cadena` (la sesión del primer chat) y
    muestra los encadenados juntos.
  - **Borradores y opciones**: lo escrito en la caja va a `POST /api/borrador {conv, texto}` (vacío = se mandó) y se guarda
    en `%LOCALAPPDATA%\arreglo\interfaz.json`: el último vuelve en `/api/contexto`.`borrador` al abrir, y el de cada
    sesión al reabrirla del historial (`borrador` en la respuesta). Las opciones de Push van ahí también
    (`POST /api/push`, `/api/contexto`.`push`): el puerto cambia en cada apertura y con él el `localStorage`.
  - **La × cierra Marito** (desde el 24/11, pedido del usuario; antes escondía y cerraba con Shift+×), igual que cerrar
    desde la barra de tareas; con el fijo el servidor y las conversaciones siguen. **Esc y la rayita la esconden**
    (minimizar: queda en la barra de tareas con todo). Cerrar la última pestaña también la esconde. Con el fijo, traerla
    escondida con Alt+F1/F2 limpia las pestañas como abrirla (ver «Modo fijo y celular»).
- Lista de proyectos: `proyectos.json` + repos de la raíz + carpetas de VS Code (menos las que contienen proyectos
  conocidos o la raíz, p. ej. el Escritorio).

### Adjuntos
- `POST /api/adjunto` con el archivo crudo (`application/octet-stream`, nombre en `X-Nombre` codificado, `X-Origen`), o JSON
  `{ruta}` / `{png}`. Hasta 60 MB. Se guardan como `<id>-<nombre>` (id al azar, `a` + 18 hex: no se adivinan desde el celular); `GET /adjuntos/:id` los sirve con su tipo.
- Info de un adjunto: `{id, url, nombre, tipo, tamano, imagen, origen, ruta}`. Imágenes con miniatura; el resto, chip con
  ícono (PDF, planilla, texto), nombre y tamaño; click = abrir con su programa (host `abrirArchivo`, solo rutas de
  `%LOCALAPPDATA%\arreglo`).
- Entran por el botón del clip, arrastrando a la ventana o con Ctrl+V (imágenes y archivos; si el WebView no ve los
  archivos copiados en el Explorador, la UI le pide al host `pegarArchivos` y este responde `{tipo:'archivos', rutas}`).

### Ventana
- Sin marco pero con estilo redimensionable (`WS_THICKFRAME` + `WM_NCCALCSIZE` sin borde): bordes y esquinas de la UI
  (`.edges`) mandan `{tipo:'redimensionar', borde: 10..17}`.
- `maximizar` (botón o doble click en la barra) = área de trabajo; `pantallaCompleta` (F11) = pantalla entera; Esc sale de
  pantalla completa. El host avisa el modo con `{tipo:'ventana', modo}`; arrastrar estando maximizada la restaura.
- El modo (normal, maximizada, pantalla completa), si está fijada y el ancho de la barra se guardan en
  `%LOCALAPPDATA%\arreglo\ventana.json` al cerrar y se usan al abrir.
- Ícono propio (`marito.ico`, `ui\marito.png`, los arma `icono.py` desde `marito-cara.png`), AppUserModelID `Valedominguezl.Marito` registrado
  en `HKCU\Software\Classes\AppUserModelId` (nombre e ícono en la barra de tareas y en los avisos). La ventana lleva
  además `RelaunchCommand`/`RelaunchIconResource`/`RelaunchDisplayNameResource` (`SetRelaunch`): fijada en la barra,
  guarda un acceso que abre `abrir.ps1` con el ícono de Marito (sin eso fijaba `powershell.exe` pelado).

### Avisos
- Cuando una conversación termina (o pide confirmar, o termina su publicación) y no la estás mirando: marca en la
  pestaña (naranja = terminó, rojo = error) y la UI manda `{tipo:'avisar', conv, titulo, texto, error}`; el host hace
  titilar la barra de tareas si la ventana no está adelante. Sin notificaciones de Windows (molestaban).
- Mientras alguna pestaña tenga la marca sin ver, la UI manda `{tipo:'nuevos', hay:true}` (y `hay:false` cuando ya no
  queda ninguna): el host pone un puntito naranja en el ícono de la barra de tareas (`ITaskbarList3::SetOverlayIcon`;
  Windows 11 lo dibuja arriba a la derecha). La marca se va al mirar esa pestaña con la ventana adelante.

### Marca en la pantalla
- Idea tomada de Nūs Companion (github.com/potlakai/nus-companion, Apache-2.0): el modelo elige el control por número de
  una lista que da Windows, así el recuadro cae justo.
- `marcar.ps1 -Salida <sesión>\pantallas` (lo corre Claude, según `instruccionesMarcar` en `server.mjs`): la ventana de más
  arriba que no es Marito y **todas las ventanas de la misma app** (`AppWindows`: principal, diálogos, paneles sueltos; lo
  tapado por una ventana suya de más adelante no cuenta; cada control lleva `z`, 0 = la de adelante), sus controles por UI
  Automation y, después, la captura de esa pantalla (`pN.png`: después, para que coincida si la app estaba cambiando).
  El árbol se recorre por niveles, cada ventana entera antes que la de atrás (un diálogo antes que la cinta), con tope
  de 4 s. Los controles Win32 que Windows da como `Pane` (los diálogos de Inventor: todos así) se reconocen por su clase y
  estilo (`Win32Kind` en `marca.cs`: botón, casilla, opción, campo, lista, deslizador). UIA3 (COM, como FlaUI), varios
  hilos o menos propiedades no lo aceleran: en Inventor cada pregunta cuesta ~7 ms igual (medido el 23/11, ~1,3–2 s).
  `-Ventana <hwnd>` lee otra ventana para probar (la captura es la pantalla como está).
  Suma los **textos que lee el OCR de Windows** (`Windows.Media.Ocr`, en-US/es-MX, ~120 ms) que no caen adentro de un
  control con nombre, tipo `Texto`, `z` 99: cintas y diálogos que no le dicen nada a Windows (Inventor) tienen letras. Una
  línea del OCR se parte en los huecos grandes y se junta donde las palabras están pegadas («Displa»+«y»). Todo en `pN.json`
  (píxeles reales: Per-Monitor v2); imprime la lista numerada con el centro en fracción (~1 s en total).
- **Todos los pasos de una** (desde el 23/11, pedido del usuario: un turno por paso era lento): Claude responde la lista
  numerada, un paso por renglón; el primero con `[MARCAR:n]` (o `[MARCAR:x,y,an,al]` en fracciones, o el nombre) y los que
  siguen con `[LUEGO:nombre del control]`. Mira la captura con Read solo si la lista no le alcanza. `server.mjs` ve la
  primera etiqueta en cuanto se completa, la resuelve contra la última `pN.json` (`resolverMarca`) y arranca
  `marcar.ps1 -Mostrar -X -Y -W -H` (texto del cartel en `MARCA_TEXTO`): ventana en capas, click-through, que late
  hasta un click, Esc o 3 min. **Sale en las capturas** (desde el 23/11, pedido del usuario; antes se excluía con WDA_EXCLUDEFROMCAPTURE):
  cuando Marito mira la pantalla nunca hay una a la vista. Una sola marca a la vez; un mensaje nuevo, cerrar la pestaña o apagar la
  sacan (y cortan la lista: `c.pasoGen`).
- **Click adentro** (`seguirPasos`): si quedan pasos `[LUEGO:…]`, el servidor corre `marcar.ps1` él mismo (a los 0,5 s; si
  no aparece, de nuevo a +0,9 y +1,8 s), busca el nombre (`buscarControl`: igual sin acentos, «…», atajos ni espacios; si no,
  el único que lo tiene como palabras; entre varios, la ventana de adelante, lo que no estaba antes del click, el habilitado)
  y marca solo, con la frase de su renglón (medido: 1,8 s del click al recuadro, en vez de un turno de ~10 s). Si no lo
  encuentra, `marca-tocada` con `texto` («Listo, ya lo toqué. No encontré «X»…») y Claude sigue. Un solo paso o la
  lista terminada: nada, el tutorial queda terminado (24/11, pedido del usuario: antes un paso solo mandaba «Listo, ya lo
  toqué.» y Claude pensaba un turno entero al pedo).
- **La línea**: una curva del borde de Marito más cerca del recuadro hasta el recuadro, aunque esté en la otra pantalla
  (`MarcaLinea`: otra ventana en capas del tamaño de la curva, que se traza en 0,4 s y después queda quieta sin redibujarse).
  `MARCA_DESDE=mouse` la hace salir del mouse y `no` la saca; si Marito está minimizado sale del mouse. Se va con el recuadro.
- **El paso**: el renglón de la etiqueta (`renglonDe`, sin número ni etiqueta) o, si está sola, lo que escribió desde su
  última herramienta. La primera oración va al cartel pegado al recuadro (`fraseMarca`: si pasa de 110 letras se corta en
  una coma o entre palabras); el paso entero lo dice la voz.
- SSE `marcar` `{texto, nombre, imagen:'/pantallas/pN.png', caja:{x,y,w,h}, ancho, alto, paso?}` (va al historial): la UI
  muestra el recorte agrandado con el recuadro (click = la captura entera). Los que marca el servidor llevan `paso` (2, 3…):
  la tarjeta va con su frase arriba y fuera de un turno (sin «Pensando…»). Las etiquetas no se muestran en el texto.
- SSE `marca-tocada` `{texto?}` (solo en vivo): la UI manda `texto` o «Listo, ya lo toqué.» (en cola si el turno sigue) y
  Claude mira de nuevo y sigue.
- **La marca que enseña** (desde el 23/11; el usuario eligió la variante A de `temporal/maquetas/marca-que-ensena.html`):
  - **Cartel**: la frase corta con una **barrita naranja** abajo (48×3, radio 1,5, a 6 px del texto). Con el mouse encima
    (0,22 s, sin click) o tocándolo se abre: «PASO 2 DE 5» chiquito en naranja, la frase, la explicación, una raya, «**Al
    tocar:** …» y el botón **«Salir del tutorial»**; al sacar el mouse se cierra (0,35 s). Crece pegado del mismo lado del
    control (abajo si entra abierto; si no, arriba), así no lo tapa. Es lo único de la marca que toma clicks: mientras el
    mouse está encima se le saca `WS_EX_TRANSPARENT` (sigue `NOACTIVATE`: no roba el foco, medido); tocarlo no saca la marca.
  - **Qué dice**: cada renglón con etiqueta lleva `[MAS:explicación | qué pasa al tocar]` (`masDe`; la UI y la voz no lo
    muestran ni lo dicen). `marcar.ps1 -Mostrar` lo recibe en `MARCA_PASO`, `MARCA_TOTAL`, `MARCA_MAS`, `MARCA_ALTOCAR` y,
    con `MARCA_STDIN=1`, por stdin (`clave<TAB>valor`: `paso`, `total`, `mas`, `altocar`) mientras Claude termina de escribir la
    lista (`refrescarCartel`: el primer paso se marca antes de que lleguen los otros). Al irse imprime cómo: `dentro`, `salir`
    (el botón), `fuera` (otro click), `esc` o `tope`.
  - **Salir y volver** (pedido del usuario): la lista es un tutorial (`c.tuto`: el turno, cuál `[MARCAR]` es, el paso que
    toca). Todo lo que no es tocar adentro lo deja **en pausa** (el botón del cartel, Esc, otro click, los 3 min, un mensaje
    nuevo, otra marca); en pausa tocar el programa no avanza. `POST /api/tutorial {conv, id, accion:'salir'|'volver'|'repetir'|'paso', n}` (409 si
    ya no está o si hay un turno; `repetir` solo con el tutorial terminado: vuelve al paso 1, sin turno nuevo; `paso` va al
    paso `n` (desde 1) en marcha, en pausa o terminado: `irAlPaso`, 24/11): volver busca el mismo paso en la pantalla como está (el primero, si sigue en su lugar,
    ese: `buscarControl(…, lugar)`; si era una caja sin nombre, donde estaba) y lo marca de nuevo; si no aparece, Claude mira
    y sigue (`marca-tocada`). Una lista nueva corta la anterior (`fin` + `cortado`).
  - SSE `tutorial` `{id, marca, paso, total, pausado?, fin?, cortado?}` (va al historial). La UI: los renglones que llevaban
    `[MARCAR]`/`[LUEGO]` (los marca `sinMarcas` con un carácter invisible → clase `paso`, `paso-1` donde arranca cada lista)
    muestran el que toca resaltado (fondo naranja suave, número naranja) y los hechos con ✓ en gris; **abajo de todo del
    mensaje** (24/11, pedido del usuario: debajo de la lista quedaba arriba de la captura y del texto de después; solo
    «Pensando…», el costo y «Arreglalo» van más abajo) «Salir del tutorial» y, en pausa, **«▶ Volver al tutorial (paso N)»** naranja. Terminada, todo tildado y **«↻ Repetir el tutorial»** (pedido
    del 23/11; solo en el último tutorial del chat: el servidor recuerda uno, `c.tuto`), que lo marca de nuevo desde el
    paso 1 como «volver». **Cada renglón se puede tocar** (click o Enter; 24/11, pedido del usuario) y marca ese paso
    (`accion:'paso'`), solo en el último tutorial del chat y sin un turno corriendo; con texto elegido no cuenta. En el
    celular, sin botón ni renglones que se tocan.
  - **La barra se corre** (24/11, pedido del usuario): si la ventana de Marito (solo la barra: la que mide menos de media
    pantalla de alto) tapa el control marcado o su cartel cerrado, `marca.cs` (`Apartar`) la mueve para arriba o para
    abajo, lo más cerca que entre, en 0,26 s (sale rápido y frena), y la línea sale de donde quedó. No cambia
    `barraLugar`: el próximo Alt+F2 la trae adonde la dejó el usuario. Probado con una ventana «Marito» de prueba de
    600×90 sobre el recuadro: subió de y=300 a y=218, arriba del recuadro. `md.js` respeta el número con que arranca una lista (la tarjeta de la captura la parte en dos).
- `marca.cs` (ventanas y recuadro) se compila una vez por versión en `lib\marca-native-<hash>.dll`.
- **Marcar una zona** (desde el 23/11, pedido del usuario): **Alt+F3** (`capturas.ahk` → `abrir.ps1 -Zona`) o el botón de
  la barra de arriba (mensaje `{tipo:'zona'}`: el host minimiza Marito y lanza `abrir.ps1 -Zona -DesdeMarito` sin consola).
  `marcar.ps1 -Zona <png>` (`MarcaZona`): congela la pantalla, la oscurece y el usuario arrastra un rectángulo (una ventana
  por pantalla, Esc o botón derecho cancelan, sola a los 2 min); imprime `{x,y,w,h,ruta,hwnd,ventana,app,nota}` o
  `cancelado`. El recorte entra como captura `origen:'zona'` con `nota` («400×200 px en x=…, y=… (en la pantalla de
  2560×1600); está sobre «título» (app)»), por `contexto.json` (`notaCaptura`) o `/api/entrada {…, nota}`; el proyecto sale
  de la ventana de debajo. Claude la recibe como «zona de la pantalla que marcó el usuario: …; lo que pregunta es sobre
  eso». La UI la suma a la pestaña de adelante (como un recorte). Si cancela desde el botón, Marito vuelve igual.

### La voz
Local, sin cuentas y **opcional** (el usuario, 23/11: edge-tts «robótica», Chatterbox descartado por pesado, ~6 GB).
- **Dos voces, en el procesador**: **Daniela** (Piper `es_AR-daniela-high`, carga 1,3 s, 0,8 s para 4 s de audio) y **Santa**
  (Kokoro-82M `em_santa`, `lang_code='e'`, carga 7,5 s, 1,6 s para 5 s). Se elige en la configuración de Marito (panel de
  deslizadores, categoría «La voz»: Sin voz / Daniela / Santa; `POST /api/voz {elegir}` → `voz` en `proyectos.json`;
  vuelve en `/api/contexto`.`voz`). **De entrada, sin voz**: la marca no habla. La charla por voz habla igual, con la
  elegida o con Daniela.
- **`voz.py --servidor --motor daniela|santa`** queda prendido con la voz cargada (como `transcribir.py`). Protocolo: una
  línea JSON por pedido `{id, texto}` → `{id, wav: base64, seg}` o `{id, error}`; al cargar, `{listo, motor}`. **El audio
  no toca el disco**: el servidor guarda cada wav en memoria 5 minutos y lo sirve en `GET /voz/<loc>-<n>.wav` (con token).
  Cambiar de voz apaga el proceso; el próximo uso arranca la nueva.
- **Entorno**: `%LOCALAPPDATA%\arreglo\voz\venv` (Python 3.11, ~1,1 GB), lo arma una sola vez **`instalar-voz.ps1`** (uv, torch
  para procesador, baja la voz de Piper y prueba las dos; `-Desinstalar` borra todo). Sin entorno, Marito anda igual, mudo.
- **Cuándo arranca**: al primer uso, cuando Claude corre `marcar.ps1` con una voz elegida (se carga mientras mira la captura) o con
  `POST /api/voz {preparar:true}` (al empezar la charla por voz) → `{ok, lista, motor}` u `{ok:false, error}`. Se apaga a
  los 10 min sin hablar y al apagar el servidor.
- **Locución** (`c.loc`): lo que se dice de una vez, partido en frases (`textoHablado`: sin código, tablas ni links, atajos
  «control S»; `partirFrases`: las cortas se juntan, las largas se parten en comas) que van a la cola de a una: la primera
  suena mientras se arma la siguiente. Es la respuesta entera de un turno hablado (se le da a medida que llega, hasta cada
  fin de oración: `cortarHablable`) o el paso de una marca. Un mensaje nuevo, `/api/detener`, `POST /api/voz {cortar: conv}`
  o cerrar la pestaña la cortan.
- SSE (solo en vivo, solo la PC): `voz` `{conv, loc, url}` por frase; `voz-fin` `{conv, loc, error?}` cuando ya no vienen
  más; `voz-cortar` `{conv, loc}`. La UI las pone en fila (una locución nueva corta la anterior).
- **Micrófono** (menú al tocarlo): **«Dictar»** (Ctrl+M, como antes: escribe y no manda) y **«Charla por voz»**
  (Ctrl+Shift+M): escucha; cuando hablaste y te callás 1,3 s, pasa lo dicho a texto y lo manda con `voz: true`
  (`/api/mensaje`: el servidor abre una locución y le pide a Claude contestar como hablando, sin listas ni código); Marito
  contesta en voz alta y, al terminar de sonar el `voz-fin`, vuelve a escuchar. Mientras piensa o habla no escucha. La
  caja dice en qué está («Te escucho…», lo que va oyendo, «Marito está hablando…»). Se termina tocando el micrófono o con
  Esc (también corta el turno); sola a los 2 min sin oír nada. El volumen se compara con el ruido de fondo que va midiendo.

### Modo barra (compacto)
Desde el 23/11 (variante C de `temporal/maquetas/modo-compacto.html`, con los cambios que pidió el usuario).
- **Atajos globales** (`capturas.ahk`): **Alt+F2** la barra (`abrir.ps1 -Barra`; con Marito abierto lo achica a la barra),
  **Alt+F1** la ventana del costado (`abrir.ps1` sin nada: lo predeterminado, también el ícono fijado), **Alt+F3** marcar una zona (`-Zona`).
- **La barra**: una línea arriba y centrada en la pantalla de lo que tenías adelante (600 px de ancho de entrada, a un
  4,5 % de arriba, a la altura de la barra de direcciones; antes 28 %; 24/11, pedido del usuario), con una entrada al
  abrirla (el fondo de la pantalla se oscurece al 45 % con un velo del host, `DimForm`: entra en 0,2 s, queda hasta
  1,2 s y sale en 0,5 s; deja pasar los clicks y no sale en capturas; un halo naranja de hasta 8 px late una vez en
  0,9 s, mandado por `entrar`; la bajada desde afuera de la pantalla está escrita pero apagada, `bajarDesdeAfuera`; 24/11, video del
  usuario: antes se veía ~0,3 s un rectángulo vacío y del pulso solo la cola, recortada contra el borde). **La ventana
  nueva arranca tapada** (`DWMWA_CLOAK`, en cualquier modo): la interfaz avisa `pintada` cuando ya tiene el modo puesto
  (dos cuadros después del `ventana` que contesta a `lista`), el host la destapa y le manda `mostrada`, y recién ahí
  entra la barra (`body.tapada` la deja transparente hasta entonces). Si `pintada` no llega, se destapa igual a los 400 ms
  de `lista` o a los 3 s de mostrarse. Medido en la ventana real (CDP): la animación arranca en el primer cuadro que
  WebView2 dibuja de verdad (~0,5 s después de navegar, igual con o sin tapado) y corre entera. Después: la caja, micrófono, marcar zona, enviar, ⤢ y × (cierra Marito); sin adjuntar (Ctrl+V y arrastrar siguen); todo de 32 px, 4 px entre botones y 8 px de
  borde. **El ancho se cambia desde los costados de la caja** (24/11, pedido del usuario): una franja de 10 px centrada
  sobre cada borde (`.borde-barra`, cursor ↔ y una rayita al pasar el mouse) manda `redimensionar` 10 o 11; en la barra el
  host solo atiende esos dos, entre 400 px (lo que necesita la fila: la caja queda en ~134) y el ancho de la pantalla
  menos 32. Se recuerda en `ventana.json` (`barraAncho`, px de CSS) y vale para la próxima vez; el lugar también se
  actualiza (estirar desde la izquierda corre la barra). Probado en la ventana real con el mouse simulado (izquierda,
  derecha, el mínimo, cerrar y reabrir con el ancho guardado). Sin la cara ni el proyecto; modelo, esfuerzo y Push se usan como estén. La ventana es transparente alrededor (sin
  el marco extendido de DWM: ni sombra ni esquinas de Windows; la sombra y las esquinas las pone el CSS, `body.barra`).
- **La respuesta** va en una tarjeta 8 px debajo (`.tarjeta`, en la ventana es `display: contents`): el último pedido
  chiquito arriba, lo que va haciendo (las dos últimas herramientas, «Pensando…», la tarjeta de publicar, los botones
  del tutorial), la respuesta y abajo a la derecha **«Continuar →»**, que pasa a la ventana del costado (igual que ⤢ y
  Alt+F1). **No pasa sola** (24/11, pedido del usuario: antes se abría la ventana del costado en cuanto Claude se ponía
  a trabajar); la captura de la marca, la terminal y el costo quedan para la ventana. **La barrita de abajo** de la
  tarjeta (24/11, pedidos del usuario): arrastrada cambia el alto de la respuesta (de entrada 360 px, antes 190; entre
  120 y el 75 % de la pantalla; se guarda en `localStorage`, `marito.altoRespuesta`); un toque la cierra (queda la
  barrita sola, para ver la pantalla) y otro la abre; un mensaje nuevo la abre sola. Apretar sobre la barra de
  desplazamiento de la respuesta (los 12 px de la derecha, si hay para dónde bajar) desplaza y no mueve la barra.
  La ventana crece con lo que se ve: la UI manda `{tipo:'barraAlto', alto}` (px de CSS) y el host cambia el alto sin mover
  la parte de arriba. Volver a abrir la barra la trae sin la tarjeta anterior.
- **Esc** cierra Marito, como la × (24/11, pedido del usuario; antes la escondía): con el fijo la respuesta sigue y se ve con Alt+F1; sin el fijo y con conversaciones corriendo, pregunta. **Moverla** (24/11, pedido del
  usuario): desde los **6 puntitos** de la izquierda (`#btn-mover`, 32 px, antes de la caja) o un lugar vacío se arrastra
  enseguida; en cualquier otro lado (lo escrito, la respuesta, un botón) dejándola apretada 0,35 s. Hasta 8 px de
  temblor no cortan la espera (con 4 se cortaba casi siempre); más que eso antes de tiempo es elegir texto o un click.
  El click de un botón que terminó en arrastre no cuenta (`sinClick`). Vuelve adonde la dejaste en esa pantalla
  mientras Marito siga abierto. **Con texto ya seleccionado** (24/11): apretar encima hace que Chromium espere a ver si
  lo vas a arrastrar (drag and drop) y deja de pasarle los movimientos a la página, así que elegir texto rápido movía la
  barra a los 0,35 s. Por eso el apretón sobre texto (sin Shift, click simple) saca antes la selección: en la barra no se
  arrastra texto seleccionado. Medido en la barra real (WebView2 con `--remote-debugging-port` por
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, eventos registrados y `mouse_event` relativo cada 8 ms): antes 0 de 4 con
  selección, después 12 de 12 (elegir rápido no la mueve; apretada quieta o temblando, sí).
- **Marcar zona desde la barra y cancelar**: `abrir.ps1 -Zona -DesdeMarito` vuelve a traer a Marito con el mismo pedido
  (`WM_COPYDATA {modo:''}`) que una zona elegida, sin entrada. Un `ShowWindow` suelto desde ese proceso la dejaba
  adelante pero sin dibujar el WebView: invisible y sin tomar clicks (reproducido 2 de 2 el 24/11).
- **Host**: `$script:modo` = `barra` | `normal` | `max` | `full`; `modoGrande` es el último que no es barra (Alt+F1 vuelve ahí y
  es lo que se guarda en `ventana.json`). Mensajes de la UI: `continuar`, `barra` (botón naranja de arriba), `barraAlto`,
  `arrastrar`. El host avisa `{tipo:'ventana', modo, fijada, abrir}`. Un segundo `abrir.ps1` le pasa a la ventana abierta
  `{modo:'barra'|'ventana'|'', ventana: hwnd}` por **WM_COPYDATA** (antes le cede el permiso de pasar adelante con
  `AllowSetForegroundWindow`); si no contesta, la trae como antes. Minimizada, vuelve directo al lugar pedido (`RestoreTo`).
- **El proyecto, sin elegirlo**: no se muestra en ningún lado (ni selector, ni cartelito, ni «¿Abrir en X?»; las pestañas
  vacías se llaman «Chat nuevo»). Lo elige el servidor por lo que había adelante (`abrir.ps1`, como siempre) y Claude lo
  sabe por las instrucciones (`instruccionesProyectos`): si el pedido es de otro proyecto, o de ninguno, responde una frase y
  `[PROYECTO:<nombre o carpeta>]` sola en el último renglón (`[PROYECTO:]` = Chat libre; `pideProyecto`, `elegirProyecto`).
  El servidor pasa la conversación ahí (sesión de claude nueva en su carpeta) y sigue **el mismo pedido** en el mismo turno
  (`conv-cambio` con `seguir: true`: la UI no borra lo que se ve; una vez por mensaje). Si no lo encuentra, `error`.
  `/api/mensaje` ya no lleva `proyecto`. **Sin «Carpeta de proyectos»** (`raiz` vacía): todo es Chat libre, la lista de
  proyectos queda vacía y Claude no habla de proyectos.

### Atajos
Alt+F2 la barra · Alt+F1 la ventana · Alt+F3 marcar una zona (los tres globales) · Ctrl+T / Ctrl+N pestaña nueva · Ctrl+W
cerrarla · Ctrl+Tab / Ctrl+1…9 cambiar · F11 pantalla completa · Ctrl+M dictar · Ctrl+Shift+M charla por voz · Esc termina
la charla o el dictado; en la barra cierra Marito; en la ventana corta el turno si corre y si no la esconde (la × la
cierra; sin el fijo y con conversaciones corriendo pide confirmación).

### Versión pública e instalador
Desde el 24/11 hay una versión pública: el repo `valedominguezl/marito-app` (MIT), sin historial y sin lo personal. Este
repo (privado) sigue siendo el único código: `publico\exportar.ps1` lo copia allá desde `HEAD` (no lo sin commitear), sin
`android\`, `.claude\`, `CLAUDE.md`, `arreglo.ps1`, `servidor-fijo.ps1`, `scripts\` ni las herramientas del ícono; saca de
`ESPEC.md` «Modo fijo y celular» y «App de Android»; cambia los proyectos de ejemplo (demo, tests) por nombres inventados;
y suma `publico\` (README, LICENSE, CLAUDE.md, workflow). Al terminar busca rutas o nombres personales y frena si queda
alguno.
- **Qué necesita la PC de otro**: Windows 10/11 x64, WebView2 (viene con Windows 11; si falta, el instalador lo baja),
  PowerShell 5.1 y .NET Framework 4 (vienen con Windows), Claude Code con sesión iniciada. Node lo trae el instalador
  (`node\node.exe`, que `abrir.ps1` prefiere al de la PC). git y gh, solo para publicar. La voz y el dictado son opcionales
  (`instalar-voz.ps1`, ~1,5 GB, desde el menú de la bandeja).
- **`Marito.exe`** (`lanzador\Marito.cs`, C# 5 para el csc de .NET Framework): ícono en la bandeja, una sola instancia,
  registra Alt+F1/F2/F3 (si otro programa ya los tiene, lo avisa y se usa el menú), escucha el portapapeles para
  `-Recorte`, la primera vez avisa qué puede hacer Claude, y si no encuentra Claude Code ofrece el instalador oficial.
  Deja su registro en `%LOCALAPPDATA%\arreglo\lanzador.log`. «Iniciar con Windows» va en `HKCU\…\Run`.
- **Claude Code** se busca en `~\.local\bin\claude.exe` (instalador oficial), en `%APPDATA%\npm` y en el PATH
  (`claudeExe` en `servidor\turnos.mjs`, lo mismo en el lanzador).
- **El instalador** (`instalador\armar.ps1` + `marito.iss`, Inno Setup 6.7.4): por usuario, sin administrador, en
  `%LOCALAPPDATA%\Programs\Marito`. Lo arma GitHub Actions en el repo público con cada tag `v*` y lo sube al release.
  No está firmado: Windows SmartScreen avisa la primera vez («Más información» → «Ejecutar de todas formas»).


## Pruebas

- `npm test`: unitarias (`node:test`, sin dependencias) de `ui/md.js` y de la lógica pura del servidor (`servidor-logica.mjs`). El e2e mide también la fila de la barra (6 puntitos, caja y botones: 32 px, 4 entre uno y otro, 8 al borde), los costados que cambian el ancho y que a 400 px la fila entre entera.
- `npm run e2e`: de punta a punta con Playwright (Edge) sobre `ui/index.html?demo&manual`: pestañas, historial (también encadenado), botón Push, botones de 32 px con 4 de separación y 8 de borde, «Terminemos y seguir», el paso a paso de la marca («guiame…» en el demo; `__demo.tocar(id)` simula tocar el recuadro), el modo barra («¿Qué hace…» contesta sin herramientas), la entrada sin «¿Abrir en X?» y la carpeta de proyectos. `?demo&barra` abre el demo en la barra. Tope de 60 s.
