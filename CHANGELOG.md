# Cambios

Lo que cambia en cada versión de Marito. El instalador de cada una está en
[Releases](https://github.com/valedominguezl/marito-app/releases).

## 0.1.2 — 2026-11-24

### Nuevo
- **Las preguntas sin tema miran la pantalla.** Si venías siguiendo algo en la pantalla (un paso a paso, una zona
  marcada) y preguntás «¿por qué falla?», «¿qué pasó?» o «no anda», Marito mira lo que tenés adelante y contesta por
  eso, no por el tema de antes. «¿Qué es esto?» o «este error» miran la pantalla siempre.
- **Pasos de ruedita.** Si lo que hay que tocar está más abajo (o más arriba, o al costado), el paso a paso marca la
  parte que se desplaza con una flecha. Cuando dejás de mover la ruedita (o las teclas AvPág, flechas, espacio) y
  aparece el botón, Marito lo marca solo.
- **El click que no hizo nada.** Si tocás lo que te marcó y la pantalla queda igual, Marito se da cuenta y le avisa a
  Claude, que mira de nuevo y te dice qué hacer. Tocar apenas afuera del recuadro cuenta como tocarlo.
- **Retomar el paso a paso desde cualquier paso**: cada renglón de la lista tiene un «▶ desde acá».

### Arreglado
- La barra (Alt+F2) entra bajando desde el borde de arriba y el fondo oscurecido se va tan despacio como llegó.
- Achicar la ventana a la barra deja la conversación abierta abajo, en la tarjeta.
- Si te vas del paso a paso y volvés, Claude sigue marcando los pasos en la pantalla en vez de explicarlos solo en texto.

## 0.1.1 — 2026-11-24

### Arreglado
- Desinstalar, o instalar encima de una versión abierta, cierra también la ventana de Marito (antes quedaba
  corriendo y no se borraban algunos archivos).

### Documentación
- README con privacidad y la política de firma de código.

## 0.1.0 — 2026-11-24

Primera versión pública: `Marito.exe` en la bandeja con Alt+F1, Alt+F2 y Alt+F3, instalador por usuario sin
administrador (Inno Setup, trae Node.js y baja WebView2 si falta), y Claude Code buscado donde lo deja su instalador
oficial.
