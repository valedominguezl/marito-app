/* Marito v3 — Ventana: arrastrar, bordes, mensajes con el host, atajos de teclado.
   Script clásico: comparte el ámbito global con los demás de ui/ (ver el orden en index.html). */
'use strict';

/* ---------- Ventana: arrastrar, maximizar, bordes ---------- */

var lastDown = 0;
function onBarDown(e) {
  if (e.button !== 0) return;
  // Sobre una pestaña: si se arrastra (más de 4 px) mueve la ventana; si no, es un click y la elige.
  if (e.target.closest('.tab') && !e.target.closest('.tab-close')) {
    var x0 = e.clientX, y0 = e.clientY;
    var move = function (m) {
      if (!(m.buttons & 1)) return stopWatch();
      if (Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) > 4) { stopWatch(); host({ tipo: 'arrastrar' }); }
    };
    var stopWatch = function () { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', stopWatch); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', stopWatch);
    return;
  }
  if (e.target.closest('button, select, label, a, .tab, .hist-menu, .fondo-panel')) return;
  var now = Date.now();
  if (now - lastDown < 380) { lastDown = 0; host({ tipo: 'maximizar' }); return; } // doble click
  lastDown = now;
  host({ tipo: 'arrastrar' });
}
els.bar.addEventListener('mousedown', onBarDown);
els.subRow.addEventListener('mousedown', onBarDown);
els.edges.addEventListener('mousedown', function (e) {
  var b = e.target.getAttribute('data-borde');
  if (e.button === 0 && b) { e.preventDefault(); host({ tipo: 'redimensionar', borde: Number(b) }); }
});
// La × cierra Marito (desde el 24/11, pedido del usuario; antes escondía y cerraba con Shift). Con el fijo el servidor y
// las conversaciones siguen; esconder es la rayita o Esc.
els.btnClose.addEventListener('click', tryClose);
els.btnMin.addEventListener('click', function () { host({ tipo: 'minimizar' }); });
// Fijada arriba de todo (TopMost) o suelta: lo decide la ventana y avisa con «ventana»; sin ventana (?demo), acá.
els.btnPin.addEventListener('click', function () {
  if (window.chrome && window.chrome.webview) host({ tipo: 'fijar' });
  else setPinned(!els.btnPin.classList.contains('on'));
});
function setPinned(on) {
  els.btnPin.classList.toggle('on', on);
  els.btnPin.setAttribute('aria-pressed', on ? 'true' : 'false');
  els.btnPin.setAttribute('aria-label', on ? 'Fijada arriba de todo' : 'Fijar arriba de todo');
  els.btnPin.title = on ? 'Fijada arriba de todo: tocá para soltarla' : 'Suelta: tocá para fijarla arriba de todo';
}
els.btnMax.addEventListener('click', function () { host({ tipo: state.windowMode === 'full' ? 'pantallaCompleta' : 'maximizar' }); });
els.btnNew.addEventListener('click', function () { newTab(); });

// Al abrir la barra, entra y un halo naranja (24/11, pedido del usuario: que se vea dónde apareció). En la ventana de
// Windows arranca tapada hasta que la página pinta: la animación espera a `mostrada`, si no corría sin verse.
var pulsoTimer = 0;
var mostrada = !(window.chrome && window.chrome.webview);
if (!mostrada) document.body.classList.add('tapada'); // la barra no se ve entera un cuadro antes de entrar
function pulsoBarra() {
  document.body.classList.remove('pulso');
  void document.body.offsetWidth; // vuelve a arrancar la animación si ya estaba
  document.body.classList.add('pulso');
  host({ tipo: 'entrar' }); // el host la baja desde afuera de la pantalla y oscurece el fondo unos segundos
  clearTimeout(pulsoTimer);
  pulsoTimer = setTimeout(function () { document.body.classList.remove('pulso'); }, 1200);
}
document.getElementById('btn-cerrar-barra').addEventListener('click', function () { tryClose(); });

// `abrir`: la barra la pidió un atajo (Alt+F2): arranca de cero, sin la tarjeta de la vez anterior.
function setWindowMode(m, abrir) {
  var antes = state.windowMode;
  state.windowMode = m;
  document.body.classList.toggle('barra', m === 'barra');
  document.body.classList.toggle('win-max', m === 'max' || m === 'full');
  els.edges.hidden = m !== 'normal';
  if (m === 'barra' && (antes !== 'barra' || abrir)) { state.cardTab = null; if (mostrada) pulsoBarra(); }
  autosize(); // la caja cambia de letra y de renglón entre la barra y la ventana
  paintCard();
  if (m === 'barra' && !TACTIL) els.input.focus();
  if (m !== 'barra' && antes === 'barra') toBottom(true);
  var restore = m !== 'normal';
  els.btnMax.innerHTML = svg(restore ? 'restore' : 'max');
  els.btnMax.setAttribute('aria-label', restore ? 'Restaurar' : 'Maximizar');
  els.btnMax.title = m === 'full' ? 'Salir de pantalla completa (F11)' : restore ? 'Restaurar' : 'Maximizar (doble click en la barra) · F11 pantalla completa';
}

function anyBusy() { return state.tabs.some(function (t) { return t.busy; }); }
function tryClose() {
  // Fijo: cerrar la ventana no corta nada (el servidor sigue y las conversaciones también).
  if (!FIJO && anyBusy() && !window.confirm('Hay conversaciones corriendo. ¿Cerrar Marito igual? Se cortan.')) return;
  // Lo escrito que todavía no se guardó, antes de que se apague el servidor.
  state.tabs.forEach(function (t) { if (draftTimers[t.id]) saveDraft(t, true); });
  host({ tipo: 'cerrar' });
}

// Mensajes del host: modo de la ventana, archivos pegados, ir a una pestaña (click en el aviso).
if (window.chrome && window.chrome.webview) {
  window.chrome.webview.addEventListener('message', function (e) {
    var m = e.data || {};
    if (m.tipo === 'ventana') {
      setWindowMode(m.modo || 'normal', !!m.abrir);
      if (typeof m.fijada === 'boolean') setPinned(m.fijada);
      // Ya con el modo puesto, se avisa en el cuadro siguiente al pintado para que el host la destape.
      if (!mostrada) requestAnimationFrame(function () { requestAnimationFrame(function () { host({ tipo: 'pintada' }); }); });
    }
    else if (m.tipo === 'mostrada') {
      mostrada = true;
      requestAnimationFrame(function () {
        if (state.windowMode === 'barra') pulsoBarra();
        document.body.classList.remove('tapada');
      });
    }
    else if (m.tipo === 'carpeta') { var ri = $('#raiz'); if (ri) ri.value = m.ruta || ''; guardarRaiz(m.ruta); }
    else if (m.tipo === 'ir' && state.byId[m.conv]) activate(state.byId[m.conv]);
    else if (m.tipo === 'escondida' && m.si) {
      // Escondida (Esc, la rayita): lo escrito se guarda ya y el servidor anota desde cuándo no se ve, así al traerla con
      // Alt+F1/F2 cierra lo ya visto sin nada escrito y deja lo que terminó mientras tanto (como al abrirla de nuevo).
      state.tabs.forEach(function (t) { if (draftTimers[t.id]) saveDraft(t, true); });
      api('/api/escondida', 'POST', {}).catch(function () { });
    }
    else if (m.tipo === 'archivos') {
      var tab = state.active;
      (m.rutas || []).forEach(function (ruta) {
        api('/api/adjunto', 'POST', { ruta: ruta, origen: 'archivo' })
          .then(function (r) { addAttachment(tab, r); })
          .catch(function (er) { toast(er.message || 'No pude adjuntar ' + ruta); });
      });
    }
  });
  host({ tipo: 'lista' });
}

// Los links se abren en el navegador, no dentro de la ventana.
els.feeds.addEventListener('click', function (e) {
  var a = e.target.closest('a[href]');
  if (!a) return;
  if (!(window.chrome && window.chrome.webview)) { a.target = '_blank'; a.rel = 'noopener'; return; } // celular: lo abre el navegador
  e.preventDefault();
  host({ tipo: 'abrir', url: a.href });
});

document.addEventListener('keydown', function (e) {
  var ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    if (!els.lightbox.hidden) { closeLightbox(); return; }
    if (!els.histMenu.hidden) { closeHistory(); return; }
    if (!els.fondoPanel.hidden) { closeFondo(); return; }
    if (!els.micMenu.hidden) { closeMicMenu(); els.btnMic.focus(); return; }
    if (mic.rec) { mic.cancel = true; mic.rec.stop(); return; } // descarta la grabación
    if (charla.on) { var cb = charla.tab; stopCharla(); if (cb && cb.busy) stop(); return; } // termina la charla (y el turno)
    // En la barra, Esc cierra Marito como la × (24/11, pedido del usuario; antes la escondía). Con el fijo la respuesta
    // sigue en el servidor y se ve con Alt+F1.
    if (state.windowMode === 'barra') { tryClose(); return; }
    if (state.windowMode === 'full') { host({ tipo: 'pantallaCompleta' }); return; }
    if (state.active && state.active.busy) { e.preventDefault(); stop(); return; } // como en VS Code: corta el turno
    host({ tipo: 'minimizar' }); // se esconde, no se cierra: lo escrito y las conversaciones quedan
  } else if (ctrl && (e.key === '`' || e.code === 'Backquote')) {
    e.preventDefault(); toggleTerminal();
  } else if (ctrl && (e.key === 'm' || e.key === 'M') && !els.btnMic.hidden) {
    e.preventDefault(); closeMicMenu();
    if (charla.on) stopCharla();
    else if (e.shiftKey) startCharla();
    else toggleMic();
  } else if (e.key === 'F11') {
    e.preventDefault(); host({ tipo: 'pantallaCompleta' });
  } else if (ctrl && (e.key === 't' || e.key === 'T' || e.key === 'n' || e.key === 'N')) {
    e.preventDefault(); newTab();
  } else if (ctrl && (e.key === 'w' || e.key === 'W')) {
    e.preventDefault(); if (state.active) closeTab(state.active);
  } else if (ctrl && e.key === 'Tab') {
    e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1);
  } else if (ctrl && /^[1-9]$/.test(e.key)) {
    var t = state.tabs[Number(e.key) - 1];
    if (t) { e.preventDefault(); activate(t); }
  }
});

// Al volver a la ventana: foco a la caja y se limpia la marca de la pestaña que estás mirando.
window.addEventListener('focus', function () {
  if (!TACTIL) els.input.focus();
  if (state.active && state.active.unseen) { state.active.unseen = ''; renderTabs(); }
});
