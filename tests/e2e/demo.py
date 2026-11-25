"""Prueba de punta a punta de la interfaz de Marito en modo demo (sin servidor de Marito).

Levanta `python -m http.server` sobre la raíz del repo, abre ui/index.html?demo&manual en Edge (viewport de la ventana,
472x700, esquema oscuro) y comprueba tres cosas que se rompieron:
  a) pestañas: elegir una de la fila de abajo la sube arriba;
  b) menú del historial: ancho completo y títulos enteros (sin «…»);
  c) botón Push: abre su menú y las casillas cambian la clase del botón.
  d) contexto y «Terminemos y seguir»: el chat nuevo arranca solo con el prompt;
  e) historial: los chats encadenados van juntos; f) botones de 32 px, 4 px entre ellos y 8 px de borde, sin salirse;
  g) dictado: escribe en vivo y al cortar no manda; h) voz de Marito: cada una suena y la nueva corta la anterior.
  n) marca que enseña: la lista de pasos resalta el que toca, tilda los hechos, el botón sale y vuelve al tutorial y,
     terminado, lo repite desde el paso 1.
  i) modo barra: una línea, la respuesta en la tarjeta y «Continuar →»; j) otro Alt+F2 sin «¿Abrir en X?»;
  l) «Carpeta de proyectos» en la configuración; o) «¿Publico igual?» no traba la pestaña al recargar;
  p) un mensaje que el servidor rebota (409: la otra pantalla mandó algo) vuelve a la cola y sale solo.
Sale con código distinto de 0 si algo falla. Tope total: 60 s.
"""
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

from playwright.sync_api import sync_playwright

RAIZ = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
TOPE_S = 60
fallas = []
srv = None


def puerto_libre():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def chequear(ok, mensaje):
    print(('  ok    ' if ok else '  FALLA ') + mensaje, flush=True)
    if not ok:
        fallas.append(mensaje)


def apagar_servidor():
    if srv and srv.poll() is None:
        srv.terminate()
        try:
            srv.wait(3)
        except subprocess.TimeoutExpired:
            srv.kill()


def perro_guardian():
    # Si algo se cuelga, no se queda esperando para siempre.
    print(f'FALLA: pasaron {TOPE_S} s y la prueba no terminó', flush=True)
    apagar_servidor()
    os._exit(2)


def activa_arriba(pg):
    return pg.evaluate("(() => { const t = document.querySelector('#tabs .tab'); return t ? t.dataset.id : '' })()")


def fila_abajo(pg):
    return pg.evaluate("[...document.querySelectorAll('#tabs2 .tab')].map(t => t.dataset.id)")


def prueba_pestanas(pg):
    print('a) pestañas', flush=True)
    pg.keyboard.press('Control+t')           # una tercera conversación (el demo arranca con dos)
    pg.wait_for_function("document.querySelectorAll('#tabs .tab, #tabs2 .tab').length === 3", timeout=5000)
    pg.wait_for_timeout(500)                 # que termine la animación de intercambio
    chequear(len(fila_abajo(pg)) == 2, f'con 3 chats hay 1 arriba y 2 abajo (abajo: {fila_abajo(pg)})')
    arriba0 = activa_arriba(pg)
    elegido = fila_abajo(pg)[0]
    chequear(elegido != arriba0, f'el de abajo ({elegido}) no es el de arriba ({arriba0})')
    pg.click(f'#tabs2 .tab[data-id="{elegido}"]')
    pg.wait_for_timeout(500)
    chequear(activa_arriba(pg) == elegido, f'al elegirlo sube arriba (arriba ahora: {activa_arriba(pg)})')
    chequear(arriba0 in fila_abajo(pg), 'el que estaba arriba baja a la fila')
    chequear(elegido not in fila_abajo(pg), 'el elegido ya no está en la fila de abajo')
    chequear(pg.evaluate("document.querySelectorAll('#tabs .tab, #tabs2 .tab').length") == 3, 'siguen las 3 pestañas')
    chequear(pg.evaluate("document.querySelector('#tabs .tab').getAttribute('aria-selected')") == 'true', 'la de arriba figura como seleccionada')


TITULOS = [
    'la altura predeterminada es etnre la barra de tareas y la barra de arriba de la ventana de Windows',
    'falta un botón en los 3 puntitos de cada ficha para dar de baja y que no se pueda volver a elegir por error',
    'ahi ajust el tamaño final. igual el fondo ahora se ve muy fuerte y no se lee bien lo de abajo',
]


def prueba_historial(pg):
    print('b) historial', flush=True)
    # El demo devuelve el historial vacío: se le pasan conversaciones con títulos largos por su misma API.
    pg.evaluate("""(titulos) => {
      const orig = window.__demo.api;
      window.__demo.api = (p, m, b) => p === '/api/historial'
        ? Promise.resolve(titulos.map((t, i) => ({ sessionId: 's' + i, proyecto: 'Marito', sitio: '', url: '', titulo: t, fecha: new Date().toISOString() })))
        : orig(p, m, b);
    }""", TITULOS)
    pg.click('#btn-hist')
    pg.wait_for_selector('#hist-menu .hist-item', timeout=5000)
    info = pg.evaluate("""() => {
      const m = document.getElementById('hist-menu'), r = m.getBoundingClientRect();
      return { left: r.left, right: r.right, vw: document.documentElement.clientWidth, hidden: m.hidden,
        items: [...m.querySelectorAll('.hist-title')].map(t => ({ texto: t.textContent, ch: t.clientHeight, sh: t.scrollHeight, sw: t.scrollWidth, cw: t.clientWidth,
          overflow: getComputedStyle(t).textOverflow, lineas: Math.round(t.clientHeight / parseFloat(getComputedStyle(t).lineHeight)) })) };
    }""")
    chequear(not info['hidden'], 'el menú está abierto')
    chequear(len(info['items']) == len(TITULOS), f"se dibujaron {len(info['items'])} ítems")
    chequear(info['left'] <= 12 and info['vw'] - info['right'] <= 12, f"el menú ocupa todo el ancho (de {info['left']:.0f} a {info['right']:.0f} de {info['vw']})")
    for it in info['items']:
        corto = it['texto'][:30]
        chequear(it['overflow'] != 'ellipsis', f'«{corto}…» no usa text-overflow: ellipsis')
        chequear(it['sw'] <= it['cw'] + 1, f'«{corto}…» no se corta a lo ancho')
        chequear(it['lineas'] <= 3, f"«{corto}…» entra en {it['lineas']} línea(s) (máximo 3)")
        chequear(it['sh'] <= it['ch'] + 1, f'«{corto}…» se ve entero (sin recorte vertical: {it["sh"]}/{it["ch"]} px)')
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(200)


def prueba_push(pg):
    print('c) botón Push', flush=True)
    clases = lambda: pg.evaluate("document.getElementById('btn-push').className")
    oculto = lambda: pg.evaluate("document.getElementById('push-menu').hidden")
    chequear(oculto(), 'el menú de Push arranca cerrado')
    pg.click('#btn-push')
    chequear(not oculto(), 'al tocar el botón se abre el menú')
    chequear(pg.is_checked('#opt-commit') and pg.is_checked('#opt-push'), 'por defecto: commitear y push automático')
    chequear('manual' not in clases().split() and 'off' not in clases().split(), f'el botón arranca sin clase manual/off ({clases()!r})')
    pg.click('#opt-push')                    # destilda el push automático
    chequear('manual' in clases().split(), f'sin push automático el botón queda «manual» ({clases()!r})')
    pg.click('#opt-commit')                  # destilda commitear
    chequear('off' in clases().split() and 'manual' not in clases().split(), f'sin commit el botón queda «off» ({clases()!r})')
    chequear(pg.is_disabled('#opt-push'), 'sin commit la casilla de push se deshabilita')
    pg.click('#opt-commit')                  # vuelve a tildar commitear (el push sigue destildado)
    chequear('manual' in clases().split() and 'off' not in clases().split(), f'con commit y sin push vuelve a «manual» ({clases()!r})')
    pg.click('#opt-push')
    chequear('manual' not in clases().split() and 'off' not in clases().split(), f'todo tildado: sin clases ({clases()!r})')
    pg.mouse.click(236, 400)                 # tocar afuera cierra el menú
    pg.wait_for_timeout(150)
    chequear(oculto(), 'tocar afuera cierra el menú')


def prueba_tutorial(pg):
    print('n) marca que enseña: paso a paso en el chat, salir y volver', flush=True)
    pg.keyboard.press('Control+t')
    pg.wait_for_timeout(300)
    pg.fill('#input', 'guiame para revertir el zoom')
    pg.keyboard.press('Enter')
    pg.wait_for_selector('.feed:not([hidden]) .tuto-btn', timeout=8000)
    pg.wait_for_function("(() => { const f = [...document.querySelectorAll('.feed')].find(x => !x.hidden);"
                         " return f && f.querySelector('.meta'); })()", timeout=8000)  # terminó el turno
    estado = """() => { const f = [...document.querySelectorAll('.feed')].find(x => !x.hidden);
      const pasos = [...f.querySelectorAll('.paso')]; const b = f.querySelector('.tuto-btn');
      return { texto: f.innerText, pasos: pasos.map(p => (p.classList.contains('paso-hecho') ? 'hecho' : p.classList.contains('paso-ahora') ? 'ahora' : '-')),
        desde: pasos.map(p => getComputedStyle(p, '::after').content.includes('desde acá')),
        boton: b ? b.textContent : null, primario: b ? b.classList.contains('btn-primary') : false,
        ultimo: b ? (b.nextElementSibling ? b.nextElementSibling.className : 'fin') : null,
        antes: b ? (b.previousElementSibling || {}).className : null } }"""
    e = pg.evaluate(estado)
    chequear(not any(s in e['texto'] for s in ('[MARCAR', '[LUEGO', '[MAS', '[RUEDA', 'desde acá', '', '', 'Ahí están')), 'las etiquetas y la explicación del cartel no se ven en el chat')
    chequear(e['pasos'] == ['ahora', '-', '-'], f"los 3 renglones son pasos y el primero está resaltado ({e['pasos']})")
    chequear(e['boton'] == 'Salir del tutorial' and not e['primario'], f"«Salir del tutorial» ({e['boton']!r})")
    chequear(e['ultimo'] in ('meta', 'fin') and e['antes'] == 'md',
             f"el botón va abajo de todo del mensaje, después del texto que sigue a la lista (antes {e['antes']!r}, después {e['ultimo']!r})")
    pg.click('.feed:not([hidden]) .tuto-btn')
    pg.wait_for_function("document.querySelector('.feed:not([hidden]) .tuto-btn').textContent.startsWith('▶')", timeout=4000)
    e = pg.evaluate(estado)
    chequear(e['boton'] == '▶ Volver al tutorial (paso 1)' and e['primario'], f"en pausa: «▶ Volver al tutorial (paso 1)» naranja ({e['boton']!r})")
    chequear(e['desde'] == [True, True, True], f"en pausa, cada renglón muestra «▶ desde acá» ({e['desde']})")
    pg.click('.feed:not([hidden]) .tuto-btn')
    pg.wait_for_function("document.querySelector('.feed:not([hidden]) .tuto-btn').textContent === 'Salir del tutorial'", timeout=4000)
    chequear(True, 'volver: el botón vuelve a «Salir del tutorial»')
    e = pg.evaluate(estado)
    chequear(e['desde'] == [False, True, True], f"en marcha, «▶ desde acá» en todos menos el que corre ({e['desde']})")
    tid = pg.evaluate("[...document.querySelectorAll('#tabs .tab, #tabs2 .tab')].find(t => t.getAttribute('aria-selected') === 'true').dataset.id")
    tid = f'{tid}-t1'
    pg.evaluate(f"__demo.tocar('{tid}')")
    pg.wait_for_timeout(150)
    e = pg.evaluate(estado)
    chequear(e['pasos'] == ['hecho', 'ahora', '-'], f"al tocar el recuadro: el 1 tildado y el 2 resaltado ({e['pasos']})")
    pg.evaluate(f"__demo.tocar('{tid}'); __demo.tocar('{tid}')")
    pg.wait_for_timeout(150)
    e = pg.evaluate(estado)
    chequear(e['pasos'] == ['hecho', 'hecho', 'hecho'] and e['boton'] == '↻ Repetir el tutorial' and e['ultimo'] in ('meta', 'fin'),
             f"terminada la lista: todo tildado y «↻ Repetir el tutorial» abajo de todo ({e['pasos']}, {e['boton']!r})")
    pg.click('.feed:not([hidden]) .tuto-btn')
    pg.wait_for_function("document.querySelector('.feed:not([hidden]) .tuto-btn').textContent === 'Salir del tutorial'", timeout=4000)
    e = pg.evaluate(estado)
    chequear(e['pasos'] == ['ahora', '-', '-'], f"repetir: vuelve al paso 1 en el mismo chat ({e['pasos']})")
    pg.click('.feed:not([hidden]) .paso >> nth=2')
    pg.wait_for_function("(() => { const p = document.querySelectorAll('.feed:not([hidden]) .paso'); return p[2].classList.contains('paso-ahora'); })()", timeout=4000)
    e = pg.evaluate(estado)
    chequear(e['pasos'] == ['hecho', 'hecho', 'ahora'], f"tocar el renglón 3 lo marca de nuevo ({e['pasos']})")


def prueba_cadena(pg):
    print('d) contexto y «Terminemos y seguir»', flush=True)
    pg.click('.tab[data-id="c1"]')           # la de La Esquina (con proyecto)
    pg.wait_for_timeout(400)
    chequear(pg.evaluate("document.getElementById('ctx-row').hidden"), 'sin mensajes no se muestra la fila de contexto')
    pg.fill('#input', 'hola')
    pg.keyboard.press('Enter')
    pg.wait_for_function("!document.getElementById('ctx').hidden", timeout=8000)
    chequear(pg.inner_text('#ctx-n') == '41k', f"muestra el contexto del turno ({pg.inner_text('#ctx-n')!r})")
    chequear(pg.is_visible('#btn-chain'), 'aparece la flechita de Terminemos')
    antes = pg.evaluate("document.querySelectorAll('#tabs .tab, #tabs2 .tab').length")
    pg.click('#btn-chain')
    # Se abre el chat nuevo y se cierra el viejo (c1): quedan las mismas pestañas, sin c1.
    pg.wait_for_function("![...document.querySelectorAll('#tabs .tab')].some(t => t.dataset.id === 'c1')", timeout=8000)
    pg.wait_for_timeout(300)
    ids = pg.evaluate("[...document.querySelectorAll('#tabs .tab, #tabs2 .tab')].map(t => t.dataset.id)")
    chequear(len(ids) == antes, f'el chat viejo se cierra y queda solo el nuevo (antes {antes}, ahora {ids})')
    nuevo = pg.evaluate("""() => { const f = [...document.querySelectorAll('.feed')].find(x => !x.hidden);
      const b = f && f.querySelector('.msg-user .bubble'); return b ? b.textContent : ''; }""")
    chequear(nuevo.startswith('Retomamos el demo.'), f'el chat nuevo arranca solo con el prompt del bloque de código ({nuevo[:40]!r})')
    chequear(pg.evaluate("document.querySelector('#tabs .tab').dataset.id") != 'c1', 'queda elegido el chat nuevo')


def prueba_historial_cadena(pg):
    print('e) historial encadenado', flush=True)
    pg.evaluate("""() => {
      const orig = window.__demo.api, f = new Date().toISOString();
      window.__demo.api = (p, m, b) => p === '/api/historial' ? Promise.resolve([
        { sessionId: 's3', proyecto: 'Marito', titulo: 'tercero de la cadena', cadena: 's1', fecha: f },
        { sessionId: 'x', proyecto: 'Agenda', titulo: 'suelto', cadena: '', fecha: f },
        { sessionId: 's2', proyecto: 'Marito', titulo: 'segundo de la cadena', cadena: 's1', fecha: f },
        { sessionId: 's1', proyecto: 'Marito', titulo: 'primero de la cadena', cadena: '', fecha: f },
      ]) : orig(p, m, b);
    }""")
    pg.click('#btn-hist')
    pg.wait_for_selector('#hist-menu .hist-item', timeout=5000)
    grupos = pg.evaluate("[...document.querySelectorAll('#hist-menu .hist-chain')].map(g => [...g.querySelectorAll('.hist-title')].map(t => t.textContent))")
    chequear(grupos == [['tercero de la cadena', 'segundo de la cadena', 'primero de la cadena']], f'los tres encadenados van juntos y en orden ({grupos})')
    sueltos = pg.evaluate("[...document.querySelectorAll('#hist-menu > .hist-item .hist-title')].map(t => t.textContent)")
    chequear(sueltos == ['suelto'], f'el suelto queda afuera del grupo ({sueltos})')
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(200)


def prueba_dictado(pg):
    print('g) dictado', flush=True)
    pg.fill('#input', 'antes')
    mensajes = pg.evaluate("document.querySelectorAll('.feed:not([hidden]) .msg-user').length")
    pg.click('#btn-mic')
    chequear(pg.is_visible('#mic-menu'), 'el micrófono abre el menú «Dictar» / «Charla por voz»')
    pg.click('#opt-dictar')
    pg.wait_for_function("document.getElementById('input').value === 'antes Esto lo'", timeout=6000)
    chequear(True, 'mientras se habla, el texto parcial se escribe después de lo que había')
    pg.click('#btn-mic')
    pg.wait_for_function("!document.getElementById('btn-mic').classList.contains('busy') && !document.getElementById('btn-mic').classList.contains('rec')", timeout=6000)
    valor = pg.input_value('#input')
    chequear(valor == 'antes Esto lo dije por audio.', f'al cortar queda el texto final en la caja ({valor!r})')
    despues = pg.evaluate("document.querySelectorAll('.feed:not([hidden]) .msg-user').length")
    chequear(despues == mensajes, f'cortar el audio no manda el mensaje ({mensajes} -> {despues})')


MIC_APP = """
window.__mic = [];
window.MaritoApp = {
  empezar: function () { __mic.push('empezar'); setTimeout(function () { window.maritoMic('grabando'); }, 50); },
  audio: function () { __mic.push('audio'); return btoa('OggS parcial ' + Date.now()); },
  terminar: function () { __mic.push('terminar'); return btoa('OggS final'); },
  cancelar: function () { __mic.push('cancelar'); }
};
"""


def prueba_dictado_app(b):
    print('m) dictado en la app del celular (graba la app)', flush=True)
    pg = b.new_page(viewport={'width': 412, 'height': 800}, color_scheme='dark')
    errores = []
    pg.on('pageerror', lambda e: errores.append(str(e)))
    pg.add_init_script(MIC_APP)
    pg.goto(URL + '&remoto')                # como lo ve el celular (body.remoto)
    pg.wait_for_selector('#tabs .tab', timeout=8000)
    caja = pg.locator('#btn-mic').bounding_box() if pg.is_visible('#btn-mic') else None
    chequear(bool(caja) and caja['x'] >= 0 and caja['x'] + caja['width'] <= 412 and caja['width'] >= 30,
             f'con MaritoApp el micrófono se ve, entero adentro de la pantalla ({caja})')
    pg.screenshot(path=os.path.join(os.environ.get('E2E_CAPTURAS', tempfile.gettempdir()), 'app-celular.png'))
    pg.fill('#input', 'antes')
    pg.click('#btn-mic')
    chequear(not pg.is_visible('#mic-menu'), 'en la app el micrófono dicta directo, sin el menú de la charla')
    pg.wait_for_function("document.getElementById('input').value === 'antes Esto lo'", timeout=6000)
    chequear(True, 'lo que va grabando la app se escribe como parcial')
    pg.click('#btn-mic')
    pg.wait_for_function("!document.getElementById('btn-mic').classList.contains('busy') && !document.getElementById('btn-mic').classList.contains('rec')", timeout=6000)
    valor = pg.input_value('#input')
    chequear(valor == 'antes Esto lo dije por audio.' and 'terminar' in pg.evaluate('__mic'), f'al cortar, la app entrega el audio y queda el texto final ({valor!r})')
    # Salir de la app corta la grabación: lo que hubo se pasa a texto igual
    pg.fill('#input', '')
    pg.click('#btn-mic')
    pg.wait_for_function("document.getElementById('btn-mic').classList.contains('rec')")
    pg.evaluate("__mic.length = 0; window.maritoMic('cortado')")
    pg.wait_for_function("document.getElementById('input').value === 'Esto lo dije por audio.'", timeout=6000)
    chequear(pg.evaluate('__mic').count('terminar') == 1, 'si sale de la app, lo grabado se pasa a texto')
    # Esc descarta
    pg.fill('#input', 'quedó')
    pg.click('#btn-mic')
    pg.wait_for_function("document.getElementById('btn-mic').classList.contains('rec')")
    pg.keyboard.press('Escape')
    pg.wait_for_function("!document.getElementById('btn-mic').classList.contains('rec')")
    chequear(pg.input_value('#input') == 'quedó' and 'cancelar' in pg.evaluate('__mic'), 'Esc descarta lo grabado en la app')
    pg.evaluate("window.maritoMic('negado')")
    chequear(pg.is_visible('.toast') or pg.evaluate("!!document.querySelector('.toast')"), 'sin permiso avisa')
    chequear(not errores, 'sin errores en la página de la app' + (f': {errores}' if errores else ''))
    pg.close()


def prueba_voz(pg):
    print('h) voz de Marito', flush=True)
    # Sin parlantes de verdad: se anota qué se reproduce y qué se corta; «ended» se dispara a mano.
    pg.evaluate("""(() => {
      window.__sonidos = []; window.__cortes = 0; window.__audios = [];
      HTMLMediaElement.prototype.play = function () { window.__sonidos.push(this.src); window.__audios.push(this); return Promise.resolve(); };
      HTMLMediaElement.prototype.pause = function () { window.__cortes++; };
    })()""")
    conv = activa_arriba(pg)
    # Un archivo que existe en el demo (el Audio lo pide igual aunque play no suene): sin 404 en la consola.
    pg.evaluate("c => { window.__demo.emit({ tipo: 'voz', conv: c, loc: 1, url: '/ui/marito.png?v=1' }); window.__demo.emit({ tipo: 'voz', conv: c, loc: 1, url: '/ui/marito.png?v=2' }); }", conv)
    sonidos = pg.evaluate('window.__sonidos.map(s => s.split("=").pop())')
    chequear(sonidos == ['1'], f'las frases de una respuesta suenan en fila, no encimadas ({sonidos})')
    pg.evaluate("window.__audios[0].dispatchEvent(new Event('ended'))")
    sonidos = pg.evaluate('window.__sonidos.map(s => s.split("=").pop())')
    chequear(sonidos == ['1', '2'], f'al terminar una frase suena la siguiente ({sonidos})')
    pg.evaluate("c => window.__demo.emit({ tipo: 'voz', conv: c, loc: 2, url: '/ui/marito.png?v=3' })", conv)
    chequear(pg.evaluate('window.__cortes') == 1, 'una respuesta nueva corta la anterior')
    pg.evaluate("c => window.__demo.emit({ tipo: 'voz-cortar', conv: c, loc: 2 })", conv)
    chequear(pg.evaluate('window.__cortes') == 2, 'voz-cortar la calla')


def prueba_charla(pg):
    print('k) charla por voz', flush=True)
    pg.click('#btn-mic')
    pg.click('#opt-charla')
    pg.wait_for_function("document.getElementById('btn-mic').classList.contains('charla')", timeout=6000)
    pg.wait_for_function("/Te escucho/.test(document.getElementById('input').placeholder)", timeout=6000)
    chequear(True, 'arranca escuchando y lo dice en la caja')
    chequear(pg.is_hidden('#mic-menu'), 'el menú se cierra')
    pg.keyboard.press('Escape')
    pg.wait_for_function("!document.getElementById('btn-mic').classList.contains('charla')", timeout=4000)
    ph = pg.evaluate("document.getElementById('input').placeholder")
    chequear('escucho' not in ph, f'Esc la termina y la caja vuelve a lo de siempre ({ph!r})')
    pg.keyboard.press('Control+Shift+M')
    pg.wait_for_function("document.getElementById('btn-mic').classList.contains('charla')", timeout=6000)
    pg.click('#btn-mic')
    pg.wait_for_function("!document.getElementById('btn-mic').classList.contains('charla')", timeout=4000)
    chequear(pg.is_hidden('#mic-menu'), 'Ctrl+Shift+M la arranca y tocar el micrófono la termina (sin abrir el menú)')


def fila(pg, sel_caja, hijos, borde=1):
    """Medidas de una fila de botones: altos, separaciones y bordes hasta la caja (sin su borde de `borde` px)."""
    return pg.evaluate("""([caja, hijos, borde]) => {
      const c = document.querySelector(caja).getBoundingClientRect();
      const r = [...document.querySelectorAll(hijos)].filter(e => e.offsetParent !== null && getComputedStyle(e).display !== 'none')
        .map(e => ({ id: e.id || e.className.split(' ')[0], b: e.getBoundingClientRect() })).sort((a, b) => a.b.left - b.b.left);
      const red = (v) => Math.round(v * 10) / 10;
      return { ids: r.map(x => x.id), altos: r.map(x => red(x.b.height)),
        gaps: r.slice(1).map((x, i) => red(x.b.left - r[i].b.right)),
        izq: red(r[0].b.left - c.left - borde), der: red(c.right - borde - r[r.length - 1].b.right), abajo: red(c.bottom - borde - r[0].b.bottom) }; }""", [sel_caja, hijos, borde])


def parejo(m, desde=0, hasta=None):
    gaps = m['gaps'][desde:hasta]
    return all(abs(g - 4) < 0.6 for g in gaps)


def prueba_botones(pg):
    print('f) botones de 32 px, 4 px entre ellos y 8 px de borde', flush=True)
    izq = fila(pg, '.composer', '.tools-row > .icon-btn')
    der = fila(pg, '.composer', '.tools-row > .pick, .tools-row > .push-wrap, .tools-row > .mic-wrap, .tools-row > .send')
    chequear(all(abs(h - 32) < 0.6 for h in izq['altos'] + der['altos']), f"abajo todos miden 32 de alto ({izq['altos']} {der['altos']})")
    chequear(parejo(izq) and parejo(der), f"abajo, 4 px entre uno y otro ({izq['gaps']} {der['gaps']})")
    chequear(abs(izq['izq'] - 8) < 0.6 and abs(der['der'] - 8) < 0.6 and abs(izq['abajo'] - 8) < 0.6,
             f"abajo, 8 px hasta el borde de la caja (izq {izq['izq']}, der {der['der']}, abajo {der['abajo']})")
    arriba = fila(pg, '#bar', '#bar > .spacer ~ .icon-btn, #bar > .spacer ~ div > .icon-btn', 0)
    arriba['arriba'] = pg.evaluate("(() => { const b = document.querySelector('#bar').getBoundingClientRect(), x = document.querySelector('#btn-close').getBoundingClientRect(); return Math.round((x.top - b.top) * 10) / 10; })()")
    chequear(all(abs(h - 32) < 0.6 for h in arriba['altos']) and parejo(arriba) and abs(arriba['der'] - 8) < 0.6 and abs(arriba['abajo'] - 8) < 0.6 and abs(arriba['arriba'] - 8) < 0.6,
             f"arriba: 32 px, 4 entre ellos y 8 al borde ({arriba['altos']} {arriba['gaps']} der {arriba['der']} arriba {arriba['arriba']} abajo {arriba['abajo']})")
    fuera = pg.evaluate("""() => { const r = document.querySelector('.tools-row').getBoundingClientRect();
      return [...document.querySelectorAll('.tools-row > *:not([hidden]):not(input)')].filter(e => e.getBoundingClientRect().right > r.right + 1).map(e => e.id || e.className); }""")
    chequear(not fuera, f'todo entra en la fila sin salirse ({fuera})')


def vacia(pg):
    """Lo que dice la pantalla vacía de la pestaña de arriba."""
    return pg.evaluate("""() => { const f = [...document.querySelectorAll('.feed')].find(x => !x.hidden);
      const e = f && f.querySelector('.empty');
      return { titulo: e ? e.querySelector('strong').textContent : '', texto: e ? e.textContent : '', pregunta: !!(e && e.querySelector('.empty-ask')) }; }""")


def entrada(pg, proyecto):
    pg.evaluate("p => window.__demo.emit({ tipo: 'entrada', proyecto: p, sitio: p.toLowerCase().replace(/ /g, '') + '.com', url: '', donde: '' })", proyecto)
    pg.wait_for_timeout(300)


def prueba_barra(pg):
    print('i) modo barra (Alt+F2): una línea, la respuesta en la tarjeta y «Continuar →»', flush=True)
    pg.keyboard.press('Control+t')
    pg.wait_for_timeout(300)
    pg.click('#btn-barra')
    pg.wait_for_timeout(250)
    e = pg.evaluate("""() => ({ barra: document.body.classList.contains('barra'), arriba: getComputedStyle(document.getElementById('bar')).display,
      tarjeta: getComputedStyle(document.getElementById('tarjeta')).display, proyecto: !!document.querySelector('.pick-project, #project') })""")
    chequear(e['barra'] and e['arriba'] == 'none' and e['tarjeta'] == 'none' and not e['proyecto'], f'el botón naranja la achica a la barra, sin la cara ni el proyecto ({e})')
    m = fila(pg, '.composer', '.composer .btn-mover, .composer textarea, .composer .tools-row > .icon-btn, .composer .mic-wrap, .composer .send')
    chequear(m['ids'] == ['btn-mover', 'input', 'mic-wrap', 'btn-zona', 'send', 'btn-grande', 'btn-cerrar-barra'], f"6 puntitos, caja, micrófono, zona, enviar, ⤢ y cerrar (sin adjuntar) ({m['ids']})")
    chequear(all(abs(h - 32) < 0.6 for h in m['altos']) and parejo(m) and abs(m['izq'] - 8) < 0.6 and abs(m['der'] - 8) < 0.6 and abs(m['abajo'] - 8) < 0.6,
             f"todo de 32 px, 4 entre uno y otro y 8 al borde ({m['altos']} {m['gaps']} izq {m['izq']} der {m['der']} abajo {m['abajo']})")
    # El ancho desde los costados de la caja: una franja sobre cada borde que le pide al host `redimensionar` (10 y 11)
    # sin arrastrar la barra (el host se simula juntando los mensajes).
    b = pg.evaluate("""() => { const msgs = []; window.chrome.webview = { postMessage: m => msgs.push(m), addEventListener() {} };
      const c = document.querySelector('.composer').getBoundingClientRect();
      const r = [...document.querySelectorAll('.borde-barra')].map(e => { const x = e.getBoundingClientRect();
        e.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
        return { izq: Math.round(x.left - c.left), der: Math.round(c.right - x.right), alto: Math.round(c.height - x.height), cursor: getComputedStyle(e).cursor }; });
      delete window.chrome.webview; return { r, msgs }; }""")
    chequear(b['msgs'] == [{'tipo': 'redimensionar', 'borde': 10}, {'tipo': 'redimensionar', 'borde': 11}], f"los costados piden cambiar el ancho, sin arrastrar ({b['msgs']})")
    # 10 px de ancho centrados sobre el borde (lo absoluto se mide desde adentro del borde de 1 px: -5 y 6+6+1+1 de alto).
    chequear(b['r'][0]['izq'] == -5 and b['r'][1]['der'] == -5 and all(x['alto'] == 14 and x['cursor'] == 'ew-resize' for x in b['r']),
             f"una franja sobre cada borde de la caja, con el cursor ↔ ({b['r']})")
    pg.set_viewport_size({'width': 400, 'height': 700})   # el ancho mínimo que deja el host
    pg.wait_for_timeout(150)
    m = fila(pg, '.composer', '.composer .btn-mover, .composer textarea, .composer .tools-row > .icon-btn, .composer .mic-wrap, .composer .send')
    caja = pg.evaluate("document.getElementById('input').getBoundingClientRect().width")
    chequear(len(m['ids']) == 7 and parejo(m) and abs(m['der'] - 8) < 0.6 and caja >= 100, f"a 400 px la fila entra entera (caja {caja:.0f} px, {m['gaps']})")
    pg.set_viewport_size({'width': 472, 'height': 700})
    pg.wait_for_timeout(150)
    pg.fill('#input', '¿Qué hace el botón Exportar?')
    pg.keyboard.press('Enter')
    pg.wait_for_function("document.body.classList.contains('con-tarjeta')", timeout=4000)
    pg.wait_for_function("[...document.querySelectorAll('.feed')].find(x => !x.hidden).textContent.includes('exportar.ts')", timeout=6000)
    t = pg.evaluate("""() => { const c = document.querySelector('.composer').getBoundingClientRect(), t = document.getElementById('tarjeta').getBoundingClientRect(),
      b = document.getElementById('btn-continuar').getBoundingClientRect();
      return { separacion: Math.round(t.top - c.bottom), barra: document.body.classList.contains('barra'), continuar: b.height > 0 && b.right > t.right - 40,
        anchos: [Math.round(c.width), Math.round(t.width)] }; }""")
    chequear(t['barra'] and t['separacion'] == 8 and t['continuar'] and t['anchos'][0] == t['anchos'][1],
             f'la respuesta corta queda en la tarjeta, 8 px debajo y del mismo ancho, con «Continuar →» abajo a la derecha ({t})')
    pg.click('#btn-continuar')
    pg.wait_for_timeout(200)
    chequear(not pg.evaluate("document.body.classList.contains('barra')"), '«Continuar →» pasa a la ventana')
    pg.click('#btn-barra')
    pg.wait_for_timeout(200)
    e = pg.evaluate("""() => ({ tarjeta: document.body.classList.contains('con-tarjeta'),
      respuesta: [...document.querySelectorAll('.feed')].find(x => !x.hidden).textContent.includes('exportar.ts') })""")
    chequear(e['tarjeta'] and e['respuesta'], f'achicada con el botón, el chat sigue abajo en la tarjeta ({e})')
    pg.evaluate("setWindowMode('normal'); setWindowMode('barra', true)")   # lo que hace Alt+F2 con la ventana abierta
    pg.wait_for_timeout(200)
    chequear(not pg.evaluate("document.body.classList.contains('con-tarjeta')"), 'Alt+F2 la abre sin la tarjeta de antes')
    pg.fill('#input', '¿Por qué el botón Pedir queda cortado?')   # en el demo contesta con herramientas
    pg.keyboard.press('Enter')
    pg.wait_for_function("document.querySelectorAll('.feed:not([hidden]) .tool').length >= 2", timeout=4000)
    e = pg.evaluate("""() => ({ barra: document.body.classList.contains('barra'), tarjeta: document.body.classList.contains('con-tarjeta'),
      tools: [...document.querySelectorAll('.feed:not([hidden]) .tools')].some(x => x.getBoundingClientRect().height > 0) })""")
    chequear(e['barra'] and e['tarjeta'] and e['tools'], f'si Claude se pone a trabajar sigue en la barra y las herramientas se ven en la tarjeta ({e})')
    pg.wait_for_function("!document.querySelector('.tab.active .tab-mark.busy')", timeout=8000)
    chequear(pg.evaluate("document.body.classList.contains('barra')"), 'terminado el turno, sigue en la barra (solo «Continuar →» la pasa)')
    pg.click('#btn-continuar')
    pg.wait_for_timeout(200)


def prueba_entrada(pg):
    print('j) otro Alt+F2: la pestaña toma lo nuevo sin preguntar ni mostrar el proyecto', flush=True)
    pg.keyboard.press('Control+t')           # pestaña vacía
    pg.wait_for_timeout(400)
    entrada(pg, 'Taller Norte')
    p = vacia(pg)
    chequear(not p['pregunta'] and 'Taller Norte' not in p['texto'] and p['titulo'] == '¿En qué te ayudo?', f'sin «¿Abrir en X?» ni el nombre del proyecto ({p})')
    # Alt+F2 desde un programa (Inventor) con la pestaña vacía: toma el «dónde».
    antes = pg.evaluate("document.querySelectorAll('#tabs .tab, #tabs2 .tab').length")
    pg.evaluate("() => window.__demo.emit({ tipo: 'entrada', proyecto: '', sitio: '', url: '', donde: 'Tenía adelante «Part1» (programa Inventor).' })")
    pg.wait_for_timeout(300)
    p = vacia(pg)
    chequear('Inventor' in p['texto'] and pg.evaluate("document.querySelectorAll('#tabs .tab, #tabs2 .tab').length") == antes,
             f'la pestaña vacía toma el programa de adelante ({p["texto"]!r})')
    entrada(pg, 'Clima Sur')
    pg.fill('#input', 'hola')
    pg.keyboard.press('Enter')
    pg.wait_for_timeout(300)
    antes = pg.evaluate("document.querySelectorAll('#tabs .tab, #tabs2 .tab').length")
    entrada(pg, 'Agenda')                    # la de arriba ya tiene mensajes: pestaña nueva
    pg.wait_for_function(f"document.querySelectorAll('#tabs .tab, #tabs2 .tab').length === {antes + 1}", timeout=5000)
    pg.wait_for_timeout(300)
    entrada(pg, 'Agenda')                    # el mismo proyecto otra vez: se queda donde está, sin otra pestaña
    chequear(pg.evaluate("document.querySelectorAll('#tabs .tab, #tabs2 .tab').length") == antes + 1, 'otro proyecto abre otra pestaña; el mismo, no')


def prueba_config_carpeta(pg):
    print('l) «Carpeta de proyectos» en la configuración', flush=True)
    pg.click('#btn-fondo')
    pg.wait_for_selector('#raiz', timeout=3000)
    v = pg.input_value('#raiz')
    secs = pg.evaluate("[...document.querySelectorAll('.conf-sec > summary')].map(s => s.textContent)")
    chequear(v == 'C:\\Users\\demo\\proyectos' and secs[0] == 'Carpeta de proyectos' and 'El proyecto' not in secs,
             f'muestra la carpeta y ya no la lista de proyectos ({v!r} {secs})')
    pg.fill('#raiz', '')
    pg.keyboard.press('Enter')
    pg.wait_for_function("document.querySelector('.toast') && document.querySelector('.toast').textContent.includes('Chat libre')", timeout=3000)
    chequear(True, 'vaciarla avisa que todo es Chat libre')
    if os.environ.get('E2E_CAPTURA'): pg.screenshot(path=os.environ['E2E_CAPTURA'])
    caja = pg.evaluate("(() => { const r = document.querySelector('#fondo-panel').getBoundingClientRect(); return { abajo: r.bottom, alto: innerHeight }; })()")
    chequear(caja['abajo'] <= caja['alto'], f'el panel no se corta abajo ({caja})')
    pg.click('.fondo-foot button:last-child')


def prueba_publicar_igual(pg):
    print('o) «¿Publico igual?» no traba la pestaña al recargar', flush=True)
    antes = activa_arriba(pg)
    pg.keyboard.press('Control+t')           # una pestaña quieta (la de antes puede seguir en un turno del demo)
    pg.wait_for_function("(a) => document.querySelector('#tabs .tab').dataset.id !== a", arg=antes, timeout=5000)
    conv = activa_arriba(pg)
    # Un turno que terminó con un commit: la pregunta llega después del turno-fin.
    pg.evaluate("""(c) => { window.__demo.emit({ tipo: 'turno-inicio', conv: c, id: 1 });
      window.__demo.emit({ tipo: 'turno-fin', conv: c, id: 1, ok: true, cambio: true, segundos: 1 }); }""", conv)
    pg.fill('#input', 'algo para mandar')
    enviar = lambda: pg.evaluate("document.getElementById('send').disabled")
    pg.evaluate("(c) => window.__demo.emit({ tipo: 'publicar-confirmar', conv: c, motivos: ['otra rama'] })", conv)
    chequear(enviar(), 'con la pregunta abierta no se puede mandar')
    # Lo que ve una ventana recargada: la pregunta (sin contestar en su copia) y después el paso del push.
    pg.evaluate("(c) => window.__demo.emit({ tipo: 'publicacion', conv: c, paso: 'push', pasos: 2, texto: 'Publicando…' })", conv)
    chequear(not enviar(), 'un paso de publicación después de la pregunta destraba la pestaña')
    pg.evaluate("(c) => window.__demo.emit({ tipo: 'publicar-confirmar', conv: c, motivos: ['otra rama'], respondida: 'si' })", conv)
    sin_botones = pg.evaluate("[...document.querySelectorAll('.card-confirm')].pop().querySelectorAll('button').length === 0")
    chequear(sin_botones and not enviar(), 'la pregunta ya contestada vuelve sin botones y no traba')
    pg.fill('#input', '')

    print('p) un mensaje rebotado (409) vuelve a la cola y sale después', flush=True)
    antes = activa_arriba(pg)
    pg.keyboard.press('Control+t')
    pg.wait_for_function("(a) => document.querySelector('#tabs .tab').dataset.id !== a", arg=antes, timeout=5000)
    conv = activa_arriba(pg)
    pg.evaluate("(c) => window.__demo.ocupar(c, true)", conv)
    pg.fill('#input', 'mandado justo cuando el celular')
    pg.keyboard.press('Enter')
    pg.wait_for_timeout(300)
    ultimo = "(() => { const m = [...document.querySelectorAll('.msg-user')].pop(); return m ? m.className : '' })()"
    errores_vistos = "document.querySelectorAll('.error-line').length"
    borrador = lambda: pg.evaluate("(c) => window.__demo.borrador(c)", conv)
    chequear('queued' in pg.evaluate(ultimo), 'el mensaje rebotado queda en cola')
    chequear(borrador() == 'mandado justo cuando el celular', f'lo que está en cola va al borrador guardado ({borrador()!r})')
    sin_error = pg.evaluate(errores_vistos)
    pg.evaluate("(c) => window.__demo.ocupar(c, false)", conv)
    try:
        pg.wait_for_function("() => { const m = [...document.querySelectorAll('.msg-user')].pop(); return m && !m.classList.contains('queued') }", timeout=5000)
        salio = True
    except Exception:
        salio = False
    chequear(salio and pg.evaluate(errores_vistos) == sin_error, 'cuando se libera sale solo, sin error')
    chequear(borrador() == '', f'ya mandado, sale del borrador ({borrador()!r})')


def main():
    global srv
    guardian = threading.Timer(TOPE_S, perro_guardian)
    guardian.daemon = True
    guardian.start()
    puerto = puerto_libre()
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(puerto), '--bind', '127.0.0.1', '--directory', RAIZ],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        global URL
        url = URL = f'http://127.0.0.1:{puerto}/ui/index.html?demo&manual'
        for _ in range(50):                  # espera a que el servidor de archivos conteste
            try:
                urllib.request.urlopen(url, timeout=1).close()
                break
            except Exception:
                time.sleep(0.2)
        else:
            chequear(False, 'el servidor de archivos no arrancó')
            return
        errores = []
        with sync_playwright() as p:
            b = p.chromium.launch(channel='msedge', args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
            try:
                pg = b.new_page(viewport={'width': 472, 'height': 700}, color_scheme='dark')
                pg.set_default_timeout(8000)
                pg.on('pageerror', lambda e: errores.append(str(e)))
                pg.on('console', lambda m: errores.append('console.error: ' + m.text) if m.type == 'error' else None)
                pg.goto(url)
                pg.wait_for_selector('#tabs .tab', timeout=8000)
                pg.wait_for_timeout(600)
                prueba_pestanas(pg)
                prueba_historial(pg)
                prueba_push(pg)
                prueba_botones(pg)
                prueba_cadena(pg)
                prueba_historial_cadena(pg)
                prueba_dictado(pg)
                prueba_voz(pg)
                prueba_charla(pg)
                prueba_barra(pg)
                prueba_entrada(pg)
                prueba_config_carpeta(pg)
                prueba_publicar_igual(pg)
                prueba_tutorial(pg)
                prueba_dictado_app(b)
            finally:
                b.close()
        print('errores de página', flush=True)
        chequear(not errores, 'sin errores de página' + (f': {errores}' if errores else ''))
    except Exception as e:                   # un timeout de Playwright o un selector que no está también es una falla
        chequear(False, f'se cortó la prueba: {type(e).__name__}: {str(e)[:300]}')
    finally:
        apagar_servidor()
        guardian.cancel()


if __name__ == '__main__':
    t0 = time.time()
    main()
    print(f"{'FALLÓ' if fallas else 'TODO BIEN'} ({len(fallas)} falla(s), {time.time() - t0:.1f} s)", flush=True)
    sys.exit(1 if fallas else 0)
