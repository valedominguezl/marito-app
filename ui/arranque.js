/* Marito v3 — Arranque: contexto inicial, conexión y carga de demo.js.
   Script clásico: comparte el ámbito global con los demás de ui/ (ver el orden en index.html). */
'use strict';

/* ---------- Arranque ---------- */

function start() {
  api('/api/contexto')
    .then(function (ctx) {
      REMOTO = !!ctx.remoto; FIJO = !!ctx.fijo;
      document.body.classList.toggle('remoto', REMOTO);
      // El micrófono del navegador necesita HTTPS fuera de la PC: en el celular graba la app (NATIVO) y solo dicta
      // (la charla por voz es de la PC: el usuario no quiere que el celular le hable). En el navegador del celular, no hay.
      if (NATIVO) els.btnMic.removeAttribute('aria-haspopup');
      else if (!window.isSecureContext || !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) els.btnMic.hidden = true;
      state.proyectos = ctx.proyectos || [];
      state.raiz = ctx.raiz || '';
      state.modelos = ctx.modelos || [];
      state.modelo = ctx.modelo || (state.modelos[0] && state.modelos[0].id) || '';
      els.model.innerHTML = '';
      state.modelos.forEach(function (m) {
        var o = el('option'); o.value = m.id; o.textContent = m.nombre; els.model.appendChild(o);
      });
      state.esfuerzos = ctx.esfuerzos || [{ id: '', nombre: 'Auto' }];
      state.esfuerzo = ctx.esfuerzo || '';
      els.effort.innerHTML = '';
      state.esfuerzos.forEach(function (x) {
        var o = el('option'); o.value = x.id; o.textContent = x.nombre; els.effort.appendChild(o);
      });
      // Cada una con su borrador (también las que volvieron después de un reinicio del servidor).
      (ctx.conversaciones || []).forEach(function (c) { var t = makeTab(c); if (c.borrador) t.draft = c.borrador; });
      var first = state.byId[ctx.inicial] || state.tabs[0];
      // Sin servidor fijo, el Alt+F2 que abrió la ventana ya trae la pestaña del proyecto reconocido: se pregunta igual.
      (ctx.adjuntos || []).forEach(function (a) { if (first) first.attachments.push(a); });
      if (first && ctx.borrador && !first.draft) first.draft = ctx.borrador; // lo que quedó escrito la última vez
      loadFondo(ctx.fondo);
      if (ctx.voz) { vozElegida = ctx.voz; paintVoz(); }
      if (ctx.push) { pubPrefs = { commit: ctx.push.commit !== false, push: ctx.push.push !== false }; renderPush(); }
      activate(first);
      // Alt+F2 con el servidor fijo: lo que tenías adelante. Va después del replay, cuando ya se sabe qué pestañas tienen mensajes.
      state.entradaPendiente = ctx.entrada || null;
      connect();
      if (DEMO && qs.has('barra')) setWindowMode('barra', true);
      if (DEMO && !qs.has('manual')) setTimeout(function () { els.input.value = '¿Por qué el botón Pedir queda cortado en el celular?'; send(); }, 500);
    })
    .catch(function (e) {
      var f = el('div', 'feed');
      f.appendChild(el('div', 'error-line', svg('warn') + '<span>No pude conectar con el servidor. ' + esc(e.message || '') + '</span>'));
      els.feeds.appendChild(f);
    });
}

function boot() {
  if (DEMO) {
    var s = document.createElement('script');
    s.src = '/ui/demo.js';
    s.onload = start;
    s.onerror = start;
    document.head.appendChild(s);
  } else start();
}
boot();
