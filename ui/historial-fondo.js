/* Marito v3 — Historial de conversaciones, opciones de publicar y configuración (fondo, raíz, voz).
   Script clásico: comparte el ámbito global con los demás de ui/ (ver el orden en index.html). */
'use strict';

/* ---------- Historial: conversaciones anteriores (se siguen con la misma sesión de claude) ---------- */

function fmtWhen(iso) {
  var d = new Date(iso);
  if (isNaN(d)) return '';
  var hoy = new Date();
  var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  if (d.toDateString() === hoy.toDateString()) return hm;
  return d.getDate() + '/' + (d.getMonth() + 1) + ' ' + hm;
}
function closeHistory() { els.histMenu.hidden = true; els.btnHist.setAttribute('aria-expanded', 'false'); }
function openHistory() {
  els.histMenu.innerHTML = '<div class="hist-empty">Cargando…</div>';
  els.histMenu.style.top = Math.round(els.btnHist.getBoundingClientRect().bottom + 6) + 'px'; // ocupa todo el ancho de la ventana
  els.histMenu.hidden = false;
  els.btnHist.setAttribute('aria-expanded', 'true');
  api('/api/historial').then(function (list) {
    els.histMenu.innerHTML = '';
    if (!list || !list.length) { els.histMenu.innerHTML = '<div class="hist-empty">Todavía no hay conversaciones guardadas.</div>'; return; }
    historyGroups(list).forEach(function (g) {
      var box = els.histMenu;
      if (g.length > 1) {
        box = el('div', 'hist-chain');
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', 'Conversaciones encadenadas');
        box.appendChild(el('div', 'hist-chain-head', 'Encadenadas · ' + g.length + ' chats'));
        els.histMenu.appendChild(box);
      }
      g.forEach(function (h) {
        var b = el('button', 'hist-item');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        var dot = el('span', 'tab-mark'); dot.style.background = dotColor(h.proyecto || '');
        var name = el('span', 'hist-title'); name.textContent = h.titulo || projectLabel(h.proyecto);
        var meta = el('span', 'hist-meta'); meta.textContent = projectLabel(h.proyecto) + ' · ' + fmtWhen(h.fecha);
        b.appendChild(dot); b.appendChild(name); b.appendChild(meta);
        b.addEventListener('click', function () { closeHistory(); reopen(h.sessionId); });
        box.appendChild(b);
      });
    });
  }).catch(function (e) { els.histMenu.innerHTML = ''; els.histMenu.appendChild(el('div', 'hist-empty', esc(e.message || 'No pude leer el historial.'))); });
}
// Las conversaciones que siguieron una a otra con «Terminemos y seguir» van juntas (la cadena es la sesión del
// primer chat, que la tiene vacía: su clave es su propia sesión), en el lugar de la más reciente; adentro, de la
// más nueva a la más vieja.
function historyGroups(list) {
  var groups = [], byKey = {};
  list.forEach(function (h) {
    var key = h.cadena || h.sessionId;
    if (!byKey[key]) { byKey[key] = []; groups.push(byKey[key]); }
    byKey[key].push(h);
  });
  return groups;
}
function reopen(sessionId) {
  api('/api/conversacion', 'POST', { reabrir: sessionId }).then(function (c) {
    if (state.byId[c.id]) { activate(state.byId[c.id]); return; }
    var tab = makeTab(c);
    tab.draft = c.borrador || '';
    var was = state.replaying;
    state.replaying = true;
    (c.eventos || []).forEach(onEvent);
    state.replaying = was;
    setBusy(tab, false);
    tab.stick = true;
    activate(tab);
  }).catch(function (e) { toast(e.message || 'No pude abrir esa conversación.'); });
}
els.btnHist.addEventListener('click', function () { if (els.histMenu.hidden) openHistory(); else closeHistory(); });

// Push: commitear o no, y push automático o manual. Se recuerda en el servidor (interfaz.json): el puerto cambia
// en cada apertura y con él el localStorage.
var pubPrefs = { commit: true, push: true };
function renderPush() {
  var off = !pubPrefs.commit, manual = pubPrefs.commit && !pubPrefs.push;
  els.btnPush.classList.toggle('off', off);
  els.btnPush.classList.toggle('manual', manual);
  els.btnPush.title = off ? 'Sin commit: los cambios quedan sin commitear' : manual ? 'Push manual: commitea y lo publicás vos con «Publicar ahora»' : 'Push automático: commitea, pushea y sigue el deploy';
  els.optCommit.checked = pubPrefs.commit;
  els.optPush.checked = pubPrefs.commit && pubPrefs.push;
  els.optPush.disabled = !pubPrefs.commit;
}
function savePush() { api('/api/push', 'POST', pubPrefs).catch(function () { /* queda para esta vez */ }); renderPush(); }
els.optCommit.addEventListener('change', function () { pubPrefs.commit = els.optCommit.checked; savePush(); });
els.optPush.addEventListener('change', function () { pubPrefs.push = els.optPush.checked; savePush(); });
els.btnPush.addEventListener('click', function () {
  var abrir = els.pushMenu.hidden;
  els.pushMenu.hidden = !abrir;
  els.btnPush.setAttribute('aria-expanded', abrir ? 'true' : 'false');
});
document.addEventListener('mousedown', function (e) {
  if (!els.pushMenu.hidden && !e.target.closest('.push-wrap')) { els.pushMenu.hidden = true; els.btnPush.setAttribute('aria-expanded', 'false'); }
});
renderPush();
document.addEventListener('mousedown', function (e) { if (!els.histMenu.hidden && !e.target.closest('.hist-wrap')) closeHistory(); });

/* ---------- Fondo de la ventana: deslizadores que se aplican en el momento ---------- */

// El tinte y los fondos de cada parte (variables CSS); lo de atrás se ve tal cual, sin difuminar.
// Se guarda en interfaz.json (POST /api/fondo) porque el localStorage cambia con el puerto.
var FONDO_INICIAL = { tinte: 45, brillo: 6, texto: 30, caja: 0 };
var FONDO_CAMPOS = [
  { k: 'tinte', t: 'Oscuro de la ventana', min: 0, max: 95, u: ' %' },
  { k: 'brillo', t: 'Brillo arriba', min: 0, max: 25, u: ' %' },
  { k: 'texto', t: 'Fondo de la barra y los mensajes', min: 0, max: 90, u: ' %' },
  { k: 'caja', t: 'Fondo de la caja de escribir', min: 0, max: 90, u: ' %' }
];
var fondo = Object.assign({}, FONDO_INICIAL);
var fondoEls = {};
var fondoTimer = 0;

function applyFondo() {
  var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var root = document.documentElement.style;
  var tint = dark ? '4, 4, 4' : '250, 249, 245', bg = dark ? '38, 38, 36' : '250, 249, 245', surf = dark ? '48, 48, 46' : '255, 255, 255';
  root.setProperty('--glass-win', 'linear-gradient(180deg, rgba(255, 255, 255, ' + fondo.brillo / 100 + '), rgba(255, 255, 255, 0)), rgba(' + tint + ', ' + fondo.tinte / 100 + ')');
  root.setProperty('--glass-text', 'rgba(' + bg + ', ' + fondo.texto / 100 + ')');
  root.setProperty('--glass-input', 'rgba(' + surf + ', ' + fondo.caja / 100 + ')');
}
function paintFondoPanel() {
  FONDO_CAMPOS.forEach(function (c) {
    var f = fondoEls[c.k]; if (!f) return;
    f.input.value = fondo[c.k];
    f.out.textContent = fondo[c.k] + c.u;
  });
}
function changeFondo(k, v) {
  fondo[k] = v;
  applyFondo();
  paintFondoPanel();
  clearTimeout(fondoTimer);
  fondoTimer = setTimeout(function () { api('/api/fondo', 'POST', fondo).catch(function () { /* queda para esta vez */ }); }, 400);
}
function buildFondoPanel() {
  var p = els.fondoPanel;
  p.innerHTML = '';
  // Cada categoría se abre y se cierra (queda como la dejaste mientras la ventana está abierta).
  function seccion(titulo, abierta) {
    var d = document.createElement('details');
    d.className = 'conf-sec'; d.open = abierta;
    d.appendChild(el('summary', '', esc(titulo)));
    p.appendChild(d);
    return d;
  }
  // Dónde están los proyectos: Marito busca ahí primero (y después en el resto de la PC) el de lo que tenés adelante.
  // Vacía = no se habla de proyectos (todo es Chat libre): para quien usa Marito para aprender.
  var secProy = seccion('Carpeta de proyectos', true);
  var fila = el('div', 'raiz-fila');
  var raiz = document.createElement('input');
  raiz.type = 'text'; raiz.className = 'raiz-input'; raiz.id = 'raiz'; raiz.placeholder = 'Sin carpeta: no se habla de proyectos';
  raiz.setAttribute('aria-label', 'Carpeta de proyectos'); raiz.spellcheck = false;
  raiz.value = state.raiz || '';
  raiz.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); guardarRaiz(raiz.value); } });
  raiz.addEventListener('change', function () { guardarRaiz(raiz.value); });
  fila.appendChild(raiz);
  if (window.chrome && window.chrome.webview) {
    var elegir = el('button', 'conf-reset', 'Elegir…');
    elegir.type = 'button';
    elegir.addEventListener('click', function () { host({ tipo: 'elegirCarpeta', ruta: raiz.value }); });
    fila.appendChild(elegir);
  }
  secProy.appendChild(fila);
  secProy.appendChild(el('div', 'raiz-nota', 'Marito busca ahí primero el proyecto de lo que tenés adelante. Vacía: todo es Chat libre.'));
  var ventana = seccion('La ventana', false);
  FONDO_CAMPOS.forEach(function (c) {
    var box = el('label', 'fondo-field');
    var out = el('output', '');
    var input = document.createElement('input');
    input.type = 'range'; input.min = c.min; input.max = c.max; input.step = 1;
    input.addEventListener('input', function () { changeFondo(c.k, Number(input.value)); });
    box.appendChild(el('span', '', esc(c.t)));
    box.appendChild(out);
    box.appendChild(input);
    fondoEls[c.k] = { box: box, input: input, out: out };
    ventana.appendChild(box);
  });
  // La voz de Marito: opcional (lee los pasos de la marca). La charla por voz habla igual, con Daniela si no hay elegida.
  var secVoz = seccion('La voz', false);
  var opts = el('div', 'voz-opts');
  opts.setAttribute('role', 'radiogroup');
  opts.setAttribute('aria-label', 'Voz de Marito');
  [['no', 'Sin voz'], ['daniela', 'Daniela'], ['santa', 'Santa']].forEach(function (o) {
    var b = el('button', '', o[1]);
    b.type = 'button'; b.dataset.voz = o[0];
    b.setAttribute('role', 'radio');
    b.addEventListener('click', function () {
      var antes = vozElegida;
      vozElegida = o[0]; paintVoz();
      api('/api/voz', 'POST', { elegir: o[0] }).catch(function (e) { vozElegida = antes; paintVoz(); toast(e.message || 'No pude cambiar la voz.'); });
    });
    opts.appendChild(b);
  });
  secVoz.appendChild(opts);
  paintVoz();
  // «Como venía» vuelve solo los colores: va adentro de «La ventana».
  var reset = el('button', 'conf-reset', 'Como venía');
  reset.type = 'button';
  reset.addEventListener('click', function () { Object.keys(FONDO_INICIAL).forEach(function (k) { fondo[k] = FONDO_INICIAL[k]; }); changeFondo('tinte', FONDO_INICIAL.tinte); });
  ventana.appendChild(reset);
  var foot = el('div', 'fondo-foot');
  var ok = el('button', '', 'Listo');
  ok.type = 'button';
  ok.addEventListener('click', closeFondo);
  foot.appendChild(ok);
  p.appendChild(foot);
  paintFondoPanel();
}
function guardarRaiz(v) {
  v = String(v || '').trim();
  if (v === (state.raiz || '')) return;
  api('/api/raiz', 'POST', { raiz: v }).then(function (r) {
    state.raiz = r.raiz; state.proyectos = r.proyectos || [];
    var i = $('#raiz'); if (i) i.value = r.raiz;
    toast(r.raiz ? 'Carpeta de proyectos guardada.' : 'Sin carpeta de proyectos: todo es Chat libre.');
  }).catch(function (e) { var i = $('#raiz'); if (i) i.value = state.raiz || ''; toast(e.message || 'No pude guardar la carpeta.'); });
}
var vozElegida = 'no';
function paintVoz() {
  [].forEach.call(els.fondoPanel.querySelectorAll('.voz-opts button'), function (b) {
    var on = b.dataset.voz === vozElegida;
    b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}
function closeFondo() { els.fondoPanel.hidden = true; els.btnFondo.setAttribute('aria-expanded', 'false'); }
els.btnFondo.addEventListener('click', function () {
  if (!els.fondoPanel.hidden) { closeFondo(); return; }
  if (!els.fondoPanel.firstChild) buildFondoPanel();
  var arriba = Math.round(els.btnFondo.getBoundingClientRect().bottom + 6);
  els.fondoPanel.style.top = arriba + 'px';
  els.fondoPanel.style.maxHeight = (window.innerHeight - arriba - 10) + 'px'; // si no entra, se corre adentro: nunca se corta
  els.fondoPanel.hidden = false;
  els.btnFondo.setAttribute('aria-expanded', 'true');
});
document.addEventListener('mousedown', function (e) { if (!els.fondoPanel.hidden && !e.target.closest('.fondo-wrap')) closeFondo(); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyFondo);
function loadFondo(f) {
  if (f && typeof f === 'object') Object.keys(FONDO_INICIAL).forEach(function (k) { if (typeof f[k] === typeof FONDO_INICIAL[k]) fondo[k] = f[k]; });
  applyFondo();
  if (els.fondoPanel.firstChild) paintFondoPanel();
}

// La fila de abajo: la rueda la corre de costado.
els.tabs2.addEventListener('wheel', function (e) {
  if (els.tabs2.scrollWidth <= els.tabs2.clientWidth) return;
  e.preventDefault();
  els.tabs2.scrollLeft +=(Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX);
}, { passive: false });
