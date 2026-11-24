/* Marito v3 — Enviar, cola, adjuntos, lightbox, avisos chicos y caja de texto con borradores.
   Script clásico: comparte el ámbito global con los demás de ui/ (ver el orden en index.html). */
'use strict';

/* ---------- Enviar ---------- */

// `voz`: lo dijo en la charla por voz (la respuesta se lee en voz alta).
function send(tab, texto, voz) {
  tab = tab || state.active;
  if (!tab) return;
  var fromInput = texto === undefined;
  texto = (fromInput ? els.input.value : texto).trim();
  var atts = tab.attachments.slice();
  if (fromInput && tab.terminal) {
    if (!texto) return;
    els.input.value = ''; tab.draft = ''; saveDraft(tab, true); autosize(); updateSend();
    if (tab.busy || tab.waiting) {
      var qm = addUserMessage(tab, '> ' + texto, []);
      qm.classList.add('queued');
      tab.queue.push({ texto: texto, atts: [], el: qm, comando: true });
      return;
    }
    runCommand(tab, texto);
    return;
  }
  if (!texto && !atts.length) return;
  // Mientras corre un turno (o espera la confirmación de publicar), el mensaje queda en cola y sale al terminar.
  var queued = tab.busy || tab.waiting;
  if (queued && !fromInput) return;
  var m = addUserMessage(tab, texto, atts);
  if (fromInput) { els.input.value = ''; tab.draft = ''; autosize(); updateSend(); }
  tab.attachments = [];
  if (tab === state.active) renderThumbs();
  if (state.windowMode === 'barra' && tab === state.active) { state.cardTab = tab; cerrarRespuesta(false); paintCard(); }
  var item = { texto: texto, atts: atts, el: m, voz: !!voz };
  if (queued) { m.classList.add('queued'); tab.queue.push(item); }
  if (fromInput || queued) saveDraft(tab, true); // después de encolarlo: el borrador guardado lleva la cola
  if (!queued) dispatch(tab, texto, atts, voz, [item]);
}

function runCommand(tab, comando) {
  setBusy(tab, true);
  api('/api/comando', 'POST', { conv: tab.id, comando: comando }).catch(function (e) {
    setBusy(tab, false);
    onError(tab, e.status === 409 ? 'Esta conversación todavía está corriendo.' : (e.message || 'No pude correr el comando.'));
  });
}

function flushQueue(tab) {
  // Durante el replay todavía no se sabe si la pestaña está corriendo en el servidor: sale en `replay-fin`.
  clearTimeout(tab.retry);
  if (state.replaying || tab.busy || tab.waiting || !tab.queue.length || state.tabs.indexOf(tab) < 0) return;
  // Un comando sale solo; los mensajes seguidos salen juntos.
  if (tab.queue[0].comando) { var k = tab.queue.shift(); k.el.remove(); runCommand(tab, k.texto); return; }
  var n = 0;
  while (n < tab.queue.length && !tab.queue[n].comando) n++;
  var q = tab.queue.splice(0, n);
  var texto = q.map(function (x) { return x.texto; }).filter(Boolean).join('\n\n');
  var atts = [].concat.apply([], q.map(function (x) { return x.atts; }));
  q.forEach(function (x) { x.el.classList.remove('queued'); tab.feed.appendChild(x.el); });
  saveDraft(tab, true);
  toBottom(true, tab);
  dispatch(tab, texto, atts, q.some(function (x) { return x.voz; }), q);
}

// `items`: los mensajes de la caja que van en este envío. Si el servidor dice que la pestaña está ocupada (lo mandó
// la otra pantalla un instante antes, o una pregunta de publicar que acá no llegó), vuelven a la cola en vez de perderse.
function dispatch(tab, texto, atts, voz, items) {
  // «/terminemos» escrito a mano hace lo mismo que la flechita: abre el chat nuevo y cierra este.
  if (/^\/terminemos\b/.test(texto) && tab.proyecto && !state.replaying) tab.chainNext = true;
  setBusy(tab, true);
  api('/api/mensaje', 'POST', {
    conv: tab.id,
    cliente: CLIENTE,
    texto: texto,
    adjuntos: atts.map(function (a) { return a.id; }),
    modelo: tab.modelo || els.model.value,
    esfuerzo: tab.esfuerzo || '',
    commit: pubPrefs.commit,
    push: pubPrefs.commit && pubPrefs.push,
    voz: !!voz
  }).catch(function (e) {
    if (voz) charla.esperaVoz = false; // no va a haber respuesta hablada: la charla vuelve a escuchar
    if (e.status === 409 && items && items.length && state.tabs.indexOf(tab) >= 0) {
      items.forEach(function (x) { x.el.classList.add('queued'); });
      tab.queue = items.concat(tab.queue);
      saveDraft(tab, true);
      // Sin setBusy(false): ese dispararía la cola enseguida y rebotaría de nuevo. Sale con el fin de lo que corre
      // (turno-fin, comando-fin, el push) o, si ese evento no llega a esta pantalla, al reintentar.
      tab.busy = false; renderTabs(); if (tab === state.active) setBusyUI();
      tab.retry = setTimeout(function () { flushQueue(tab); }, 3000);
      return;
    }
    setBusy(tab, false);
    onError(tab, e.status === 409 ? 'Esta conversación todavía está corriendo.' : (e.message || 'No se pudo enviar.'));
  });
}

function stop() {
  // Corta solo el turno actual: si hay mensajes en cola, salen solos al terminar (setBusy → flushQueue).
  if (state.active) api('/api/detener', 'POST', { conv: state.active.id }).catch(function () { /* ya terminó */ });
}

/* ---------- Adjuntos ---------- */

function addAttachment(tab, a) {
  if (tab.attachments.some(function (x) { return x.id === a.id; })) return;
  tab.attachments.push(a);
  if (tab === state.active) renderThumbs();
}

function renderThumbs() {
  var tab = state.active;
  els.thumbs.innerHTML = '';
  var list = tab ? tab.attachments : [];
  els.thumbs.hidden = list.length === 0;
  list.forEach(function (a) {
    var wrap = el('div', 'chip-att' + (a.pending ? ' pending' : ''));
    wrap.appendChild(attachmentView(a, false));
    var rm = el('button', 'rm', svg('x'));
    rm.type = 'button';
    rm.setAttribute('aria-label', 'Quitar ' + (a.nombre || 'adjunto'));
    rm.addEventListener('click', function () {
      tab.attachments = tab.attachments.filter(function (x) { return x !== a; });
      if (a.id) api('/api/adjunto/' + encodeURIComponent(a.id), 'DELETE').catch(function () { });
      renderThumbs();
      els.input.focus();
    });
    wrap.appendChild(rm);
    els.thumbs.appendChild(wrap);
  });
  updateSend();
}

function addFiles(files, origen) {
  var tab = state.active;
  if (!tab) return;
  Array.prototype.forEach.call(files, function (f) {
    var nombre = f.name || 'archivo';
    if (/^image\.(png|jpe?g|gif|webp)$/i.test(nombre)) nombre = 'pegado.' + nombre.split('.').pop();
    // Se muestra enseguida (con su vista previa si es imagen) mientras sube.
    var tmp = { pending: true, nombre: nombre, tamano: f.size, imagen: /^image\//.test(f.type), local: /^image\//.test(f.type) ? URL.createObjectURL(f) : null };
    tab.attachments.push(tmp);
    if (tab === state.active) renderThumbs();
    upload(f, nombre, origen).then(function (r) {
      var i = tab.attachments.indexOf(tmp);
      if (i < 0) { api('/api/adjunto/' + encodeURIComponent(r.id), 'DELETE').catch(function () { }); return; }
      r.local = tmp.local;
      tab.attachments[i] = r;
      if (tab === state.active) renderThumbs();
    }).catch(function (e) {
      tab.attachments = tab.attachments.filter(function (x) { return x !== tmp; });
      if (tab === state.active) renderThumbs();
      toast((e && e.message) || 'No se pudo adjuntar ' + nombre + '.');
    });
  });
}

els.btnAttach.addEventListener('click', function () { els.file.click(); });
// Marcar una zona: la ventana se minimiza, el host la marca (como Alt+F1) y vuelve con el recorte por «entrada».
$('#btn-zona').addEventListener('click', function () { host({ tipo: 'zona' }); });
els.file.addEventListener('change', function () {
  if (els.file.files.length) addFiles(els.file.files, 'archivo');
  els.file.value = '';
  els.input.focus();
});

els.input.addEventListener('paste', function (e) {
  var cd = e.clipboardData;
  var files = cd && cd.files && cd.files.length ? cd.files : null;
  if (files) { e.preventDefault(); addFiles(files, 'pegado'); return; }
  // Archivos copiados en el Explorador: el WebView no siempre los ve; el host los lee del portapapeles.
  var types = cd ? Array.prototype.slice.call(cd.types || []) : [];
  if (types.indexOf('text/plain') < 0) host({ tipo: 'pegarArchivos' });
});

// Arrastrar archivos a cualquier parte de la ventana.
var dragDepth = 0;
function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
document.addEventListener('dragenter', function (e) { if (hasFiles(e)) { dragDepth++; els.dropzone.hidden = false; } });
document.addEventListener('dragleave', function (e) { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; els.dropzone.hidden = true; } });
document.addEventListener('dragover', function (e) { e.preventDefault(); });
document.addEventListener('drop', function (e) {
  e.preventDefault();
  dragDepth = 0;
  els.dropzone.hidden = true;
  if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files, 'archivo');
});

/* ---------- Lightbox ---------- */

var lastFocus = null;
function openLightbox(url) {
  lastFocus = document.activeElement;
  els.lightboxImg.src = /^blob:/.test(url) ? url : withToken(url);
  els.lightbox.hidden = false;
}
function closeLightbox() {
  els.lightbox.hidden = true;
  els.lightboxImg.removeAttribute('src');
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
els.lightbox.addEventListener('click', closeLightbox);

/* ---------- Aviso chico dentro de la ventana ---------- */

var toastTimer = null;
function toast(texto) {
  var t = $('.toast') || document.body.appendChild(el('div', 'toast'));
  t.setAttribute('role', 'status');
  t.textContent = texto;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3500);
}

/* ---------- Caja de texto ---------- */

function autosize() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 200) + 'px';
}
els.input.addEventListener('input', function () {
  autosize(); updateSend();
  if (state.active) { state.active.draft = els.input.value; saveDraft(state.active); }
});

// Lo escrito se guarda en el servidor (interfaz.json) a medida que se escribe: si la ventana se cierra, vuelve al
// abrirla; si era de una conversación con sesión, también al reabrirla del historial.
var draftTimers = {};
// Lo que está en cola vive solo en esta página: va al borrador guardado delante de lo escrito, así una ventana que se
// recarga (cerrar con la × y reabrir, con el turno corriendo en el fijo) lo trae de vuelta en la caja en vez de perderlo.
function draftWithQueue(tab) {
  var cola = tab.queue.filter(function (x) { return !x.comando && x.texto; }).map(function (x) { return x.texto; });
  return cola.concat(tab.draft ? [tab.draft] : []).join('\n\n');
}
function saveDraft(tab, now) {
  clearTimeout(draftTimers[tab.id]);
  var go = function () { delete draftTimers[tab.id]; api('/api/borrador', 'POST', { conv: tab.id, texto: draftWithQueue(tab) }).catch(function () { }); };
  if (now) go(); else draftTimers[tab.id] = setTimeout(go, 400);
}
els.input.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});
els.send.addEventListener('click', function () { if (state.active && state.active.busy) stop(); else send(); });
