/* Marito v3 — Eventos del servidor (SSE), modo barra, conexión y estado ocupado.
   Script clásico: comparte el ámbito global con los demás de ui/ (ver el orden en index.html). */
'use strict';

/* ---------- Avisos: marca en la pestaña + aviso de Windows ---------- */

function notify(tab, kind, texto, error) {
  if (state.replaying) return;
  var mirando = tab === state.active && document.hasFocus() && !document.hidden;
  if (mirando) return;
  tab.unseen = kind;
  renderTabs();
  host({ tipo: 'avisar', conv: tab.id, titulo: 'Marito · ' + tabTitle(tab), texto: texto, error: !!error });
}

/* ---------- Eventos del servidor ---------- */

function onEvent(ev) {
  if (!ev || !ev.tipo) return;
  if (ev.tipo === 'replay-fin') {
    state.replaying = false;
    // Lo que quedó en cola mientras estaba desconectada sale ahora que se sabe qué pestañas siguen corriendo.
    state.tabs.forEach(function (t) { flushQueue(t); });
    if (state.entradaPendiente) { var en = state.entradaPendiente; state.entradaPendiente = null; onEntrada(en); }
    return;
  }
  if (ev.tipo === 'entrada') { if (!REMOTO) onEntrada(ev); return; }
  if (ev.tipo === 'convs') { syncTabs(ev.lista || []); return; }
  if (ev.tipo === 'conv-nueva') { onConvNueva(ev); return; }
  if (ev.tipo === 'conv-cerrada') { if (state.byId[ev.conv] && state.tabs.length > 1) dropTab(state.byId[ev.conv]); return; }
  var tab = state.byId[ev.conv];
  if (!tab) return;
  switch (ev.tipo) {
    // En vivo llega a todas las pantallas; la que lo mandó ya lo dibujó.
    case 'usuario': if (state.replaying || ev.cliente !== CLIENTE) addUserMessage(tab, ev.texto, ev.adjuntos || []); break;
    case 'conv-cambio': onConvCambio(tab, ev.resumen || {}, !!ev.seguir); break;
    case 'turno-inicio': beginTurn(tab); break;
    case 'texto': onText(tab, ev.delta || ''); break;
    case 'herramienta': onTool(tab, ev.nombre, ev.detalle); break;
    case 'marcar': onMark(tab, ev); break;
    case 'tutorial': onTutorial(tab, ev); break;
    // La marca y la voz son de la PC: en el celular no se contesta el toque ni se habla.
    case 'marca-tocada': if (!state.replaying && !REMOTO) onMarkTouched(tab, ev.texto); break;
    case 'voz': if (!state.replaying && !REMOTO) onVoz(ev); break;
    case 'voz-fin': if (!state.replaying && !REMOTO) onVozFin(ev); break;
    case 'voz-cortar': if (!state.replaying && !REMOTO) onVozCortar(ev); break;
    case 'turno-fin': onTurnEnd(tab, ev); break;
    case 'error': onError(tab, ev.texto); break;
    case 'publicar-confirmar': onPublishConfirm(tab, ev.motivos, ev.respondida); break;
    case 'publicacion': onPublication(tab, ev); break;
    case 'comando-inicio': onCommandStart(tab, ev); break;
    case 'comando-salida': onCommandOutput(tab, ev); break;
    case 'comando-fin': onCommandEnd(tab, ev); break;
  }
}

// Otro Alt+F2 con la ventana abierta. Un recorte o una zona marcada (Alt+F1, botón), o lo mismo que la pestaña
// actual, se suma a esa pestaña; si la pestaña está vacía, pasa a ser de lo nuevo; si no, se abre otra.
// Modo barra (Alt+F2): una línea en el medio de la pantalla y la respuesta en una tarjeta debajo, con lo que va
// haciendo. Solo «Continuar →», ⤢ o Alt+F1 pasan a la ventana del costado (24/11, pedido del usuario: antes pasaba sola
// en cuanto Claude se ponía a trabajar). La ventana crece y se achica con lo que se ve (`barraAlto`).
function continuar() {
  if (window.chrome && window.chrome.webview) host({ tipo: 'continuar' }); else setWindowMode('normal');
}
function paintCard() {
  var on = state.windowMode === 'barra' && !!state.cardTab && state.cardTab === state.active;
  document.body.classList.toggle('con-tarjeta', on);
  if (on) toBottom(true);
  sendAlto();
}
var altoPedido = 0;
function sendAlto() {
  if (state.windowMode !== 'barra') { altoPedido = 0; return; }
  requestAnimationFrame(function () {
    // Hasta lo último que se ve: la barra, la tarjeta o el menú del micrófono (se abre para abajo).
    var cajas = [els.composerWrap];
    if (document.body.classList.contains('con-tarjeta')) cajas.push(els.tarjeta);
    if (!els.micMenu.hidden) cajas.push(els.micMenu);
    var abajo = Math.max.apply(null, cajas.map(function (c) { return c.getBoundingClientRect().bottom; }));
    var alto = Math.ceil(abajo + parseFloat(getComputedStyle(document.body).paddingBottom || 0));
    if (alto !== altoPedido) { altoPedido = alto; host({ tipo: 'barraAlto', alto: alto }); }
  });
}
// En la barra la página nunca se corre: la ventana crece con lo que se ve, y algo que pide verse (un foco, un menú que
// abre para abajo) antes de que crezca la dejaba corrida, con la barra fuera de la vista.
document.body.addEventListener('scroll', function () { if (state.windowMode === 'barra' && document.body.scrollTop) document.body.scrollTop = 0; });
if (window.ResizeObserver) {
  var ro = new ResizeObserver(sendAlto);
  ro.observe(els.composerWrap); ro.observe(els.tarjeta); ro.observe(els.feeds); ro.observe(els.micMenu);
}
// Mover la barra (pedido del usuario): desde los 6 puntitos de la izquierda o un lugar vacío (el borde, el pie de la
// tarjeta) se arrastra enseguida; en cualquier otro lado (lo escrito, la respuesta, un botón), dejándola apretada un
// momento. El temblor de la mano al apretar no lo corta (hasta 8 px; con 4 se cortaba casi siempre): si se mueve más
// antes de tiempo, es elegir texto o un click común. Si arrancó sobre un botón, ese click no cuenta.
var LARGO_MS = 350, LARGO_PX = 8;
// El alto de la respuesta en la barra: se arrastra desde el pie de la tarjeta (24/11, pedido del usuario). La ventana
// crece sola con lo que se ve (`barraAlto`). Se recuerda en el navegador (vale mientras el servidor no cambie de puerto).
var ALTO_RESPUESTA = 'marito.altoRespuesta';
function altoRespuesta(px) { document.body.style.setProperty('--alto-respuesta', Math.round(px) + 'px'); }
try { var altoGuardado = Number(localStorage.getItem(ALTO_RESPUESTA)); if (altoGuardado >= 120) altoRespuesta(altoGuardado); } catch (e) { /* sin almacenamiento */ }
(function () {
  var tirador = document.getElementById('tarjeta-tirador'), y0 = 0, alto0 = 0, ultimo = 0;
  tirador.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    tirador.setPointerCapture(e.pointerId);
    y0 = e.screenY; alto0 = els.scroll.getBoundingClientRect().height; ultimo = alto0;
  });
  tirador.addEventListener('pointermove', function (e) {
    if (!tirador.hasPointerCapture(e.pointerId)) return;
    var max = Math.max(160, (window.screen.availHeight || 900) * 0.75);
    ultimo = Math.max(120, Math.min(max, alto0 + (e.screenY - y0)));
    altoRespuesta(ultimo);
  });
  tirador.addEventListener('pointerup', function (e) {
    // Un toque sin arrastrar cierra la respuesta (queda la barrita, para ver la pantalla) o la vuelve a abrir (pedido
    // del usuario, 24/11). Un mensaje nuevo la abre sola (envio.js).
    if (Math.abs(e.screenY - y0) < 4) { cerrarRespuesta(!document.body.classList.contains('respuesta-cerrada')); return; }
    try { localStorage.setItem(ALTO_RESPUESTA, String(Math.round(ultimo))); } catch (er) { /* idem */ }
  });
})();
function cerrarRespuesta(si) {
  document.body.classList.toggle('respuesta-cerrada', !!si);
  var t = document.getElementById('tarjeta-tirador');
  t.title = si ? 'Tocá para ver la respuesta' : 'Arrastrá para agrandar o achicar la respuesta; tocá para cerrarla';
  t.setAttribute('aria-expanded', si ? 'false' : 'true');
  sendAlto();
}

var largo = null;
function cortarLargo() { if (largo) { clearTimeout(largo.t); largo = null; } }
function onBarraDown(e) {
  if (state.windowMode !== 'barra' || e.button !== 0) return;
  if (e.target.closest('.push-menu, .code-block, .lightbox, .borde-barra, .tarjeta-tirador')) return; // menús y código: ahí se elige o se copia; los costados y el pie cambian el tamaño
  var t = e.target;
  // Sobre la barra de desplazamiento de la respuesta: es para bajar, no para mover (24/11, pedido del usuario).
  // (la barra va encima del texto y no ocupa lugar propio: cuenta la franja de la derecha, si hay para dónde bajar)
  var sc = els.scroll;
  if (sc.contains(t) && sc.scrollHeight > sc.clientHeight + 1 && e.clientX >= sc.getBoundingClientRect().right - 12) return;
  if (t.closest('#btn-mover') || !t.closest('textarea, .md, .msg-user, button, a, .chip-att')) {
    e.preventDefault(); host({ tipo: 'arrastrar' }); return;
  }
  // Apretar sobre texto ya seleccionado hace que Chromium espere a ver si lo arrastrás (drag and drop) y deja de
  // pasarle los movimientos a la página: la espera no se cortaba y elegir texto rápido movía la barra (medido en la
  // barra real el 24/11). Se saca la selección antes de que la mire; el click la deja donde cae, como siempre.
  if (!e.shiftKey && e.detail < 2 && t.closest('textarea, .md, .msg-user')) {
    var ta = t.closest('textarea'), sel = window.getSelection();
    if (ta) { if (ta.selectionStart !== ta.selectionEnd) ta.setSelectionRange(ta.selectionEnd, ta.selectionEnd); }
    else if (sel && !sel.isCollapsed) sel.removeAllRanges();
  }
  largo = { x: e.screenX, y: e.screenY, t: setTimeout(function () { largo = null; sinClick(); host({ tipo: 'arrastrar' }); }, LARGO_MS) };
}
// El click que llega al soltar después de mover (si Windows se lo pasa a la página) no aprieta el botón de abajo. Dura
// hasta ese click o hasta el próximo apretón, así no se come uno de verdad.
function sinClick() {
  var tragar = function (ev) { ev.stopPropagation(); ev.preventDefault(); listo(); };
  var listo = function () { document.removeEventListener('click', tragar, true); document.removeEventListener('mousedown', listo, true); };
  document.addEventListener('click', tragar, true);
  document.addEventListener('mousedown', listo, true);
}
document.addEventListener('mousedown', onBarraDown);
// Alargar o acortar la barra desde los costados de la caja (pedido del usuario): el host la estira como un borde de la
// ventana (10 izquierdo, 11 derecho), con un mínimo para que la fila entre, y recuerda el ancho.
document.querySelectorAll('.borde-barra').forEach(function (b) {
  b.addEventListener('mousedown', function (e) {
    if (state.windowMode !== 'barra' || e.button !== 0) return;
    e.preventDefault(); host({ tipo: 'redimensionar', borde: Number(b.getAttribute('data-borde')) });
  });
});
document.addEventListener('mousemove', function (e) { if (largo && Math.hypot(e.screenX - largo.x, e.screenY - largo.y) > LARGO_PX) cortarLargo(); });
document.addEventListener('mouseup', cortarLargo);
els.btnContinuar.addEventListener('click', continuar);
els.btnGrande.addEventListener('click', continuar);
els.btnBarra.addEventListener('click', function () {
  if (window.chrome && window.chrome.webview) host({ tipo: 'barra' }); else setWindowMode('barra', true);
});

function onEntrada(ev) {
  if (ev.proyectos) state.proyectos = ev.proyectos;
  var tab = state.active;
  var att = ev.adjunto;
  var mismo = tab && tab.proyecto === (ev.proyecto || '') && (!ev.sitio || ev.sitio === tab.sitio || !!ev.proyecto);
  var vacia = tab && !tab.hasMessages && !tab.busy;
  // Una pestaña vacía siempre toma lo nuevo: en Chat libre, Inventor «es lo mismo» (sin proyecto ni sitio) y se
  // perdía el «Tenía adelante… (programa Inventor)», así Claude contestaba en general.
  if (tab && !vacia && (mismo || (att && (att.origen === 'recorte' || att.origen === 'zona')))) {
    if (att) addAttachment(tab, att);
    return;
  }
  if (vacia) {
    tab.proyecto = ev.proyecto || ''; tab.sitio = ev.sitio || ''; tab.url = ev.url || ''; tab.donde = ev.donde || '';
    tab.attachments = tab.attachments.filter(function (a) { return a.origen !== 'ventana'; });
    api('/api/conversacion', 'POST', { id: tab.id, proyecto: tab.proyecto, sitio: tab.sitio, url: tab.url, donde: tab.donde }).catch(function () { });
    if (att) addAttachment(tab, att);
    renderEmpty(tab);
    activate(tab);
    return;
  }
  newTab({ proyecto: ev.proyecto || '', sitio: ev.sitio || '', url: ev.url || '', donde: ev.donde || '' }).then(function (t) {
    if (!t) return;
    if (att) addAttachment(t, att);
    renderEmpty(t);
  });
}

var es = null;
var firstOpen = true;
function connect() {
  if (DEMO) { window.__demo.connect(onEvent); return; }
  es = new EventSource(withToken('/api/eventos'));
  es.onopen = function () {
    state.replaying = true;
    // Al reconectar el servidor reenvía todo el historial: se dibuja de cero.
    if (!firstOpen) state.tabs.forEach(function (t) { resetFeed(t); setBusy(t, false); });
    firstOpen = false;
  };
  es.onmessage = function (m) {
    try { onEvent(JSON.parse(m.data)); } catch (e) { /* línea rota */ }
  };
}

/* ---------- Estado ocupado ---------- */

function setBusy(tab, b) {
  tab.busy = b;
  renderTabs();
  if (tab === state.active) setBusyUI();
  if (!b && tab.queue.length) setTimeout(function () { flushQueue(tab); }, 0);
}
function setBusyUI() {
  var tab = state.active;
  var b = !!(tab && tab.busy);
  paintCtx();
  els.send.classList.toggle('stop', b);
  els.send.setAttribute('aria-label', b ? 'Detener' : 'Enviar');
  els.send.title = b ? 'Detener' : 'Enviar (Enter)';
  els.send.innerHTML = b
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  updateSend();
}
function updateSend() {
  var tab = state.active;
  var has = els.input.value.trim() || (tab && tab.attachments.length);
  els.send.disabled = !!tab && !tab.busy && (!has || tab.waiting);
}
