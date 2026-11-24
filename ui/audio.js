/* Marito v3 — Micrófono: dictado, charla por voz y menú del micrófono.
   Script clásico: comparte el ámbito global con los demás de ui/ (ver el orden en index.html). */
'use strict';

/* ---------- Audio: dictar. Se va escribiendo en la caja mientras hablás; al cortar queda escrito, sin mandarse ---------- */

var mic = { rec: null, chunks: [], busy: false, cancel: false, tab: null, base: '', inflight: false, n: 0 };
function setMicUI() {
  var on = !!mic.rec, ch = charla.on;
  var estado = ch ? (voice.audio ? 'hablando' : charla.estado) : '';
  els.btnMic.classList.toggle('rec', on);
  els.btnMic.classList.toggle('busy', mic.busy);
  els.btnMic.classList.toggle('charla', ch);
  ['escuchando', 'oyendo', 'pensando', 'hablando'].forEach(function (k) { els.btnMic.classList.toggle(k, estado === k); });
  els.btnMic.setAttribute('aria-pressed', on || ch ? 'true' : 'false');
  els.btnMic.title = mic.busy ? 'Terminando de pasar el audio a texto…'
    : on ? 'Dictando: tocá para cortar (queda escrito, sin mandarse; Esc lo descarta)'
    : ch ? 'Charla por voz: tocá para terminarla (o Esc)'
    : NATIVO ? 'Dictar: se escribe en la caja; no se manda' : 'Micrófono: dictar o charlar por voz';
  if (ch) {
    var aviso = estado === 'hablando' ? 'Marito está hablando… (tocá el micrófono para terminar)'
      : estado === 'pensando' ? 'Marito está pensando…'
      : estado === 'cargando' ? 'Cargando la voz…'
      : charla.oido ? '«' + charla.oido + '»' : 'Te escucho: hablá y, cuando te calles, se manda solo.';
    if (aviso !== charla.aviso) { charla.aviso = aviso; paintTerminal(); }
  }
}
// Lo dictado va después de lo que ya estaba escrito, en la pestaña donde se empezó a dictar.
function putDictation(texto) {
  var tab = mic.tab;
  if (!tab || state.tabs.indexOf(tab) < 0) return;
  tab.draft = mic.base + (mic.base && texto ? ' ' : '') + texto;
  if (tab === state.active) { els.input.value = tab.draft; autosize(); updateSend(); els.input.scrollTop = els.input.scrollHeight; }
  saveDraft(tab);
}
function partialDictation() {
  if (mic.inflight || !mic.rec || !mic.chunks.length) return;
  var n = mic.chunks.length;
  mic.inflight = true;
  transcribe(new Blob(mic.chunks, { type: mic.rec.mimeType || 'audio/webm' }), true).then(function (r) {
    // Si ya se cortó, manda el final (más preciso): este parcial no se escribe.
    if (mic.rec && !mic.cancel && n > mic.n) { mic.n = n; putDictation((r && r.texto || '').trim()); }
  }).catch(function () { /* el final lo vuelve a intentar */ }).then(function () { mic.inflight = false; });
}
function startDictation(rec) {
  mic.rec = rec; mic.chunks = []; mic.cancel = false; mic.n = 0;
  mic.tab = state.active;
  mic.base = els.input.value.replace(/\s+$/, '');
  setMicUI();
}
// Al cortar: la versión final (más precisa que los parciales) queda escrita; con Esc vuelve a lo que estaba escrito.
function finishDictation(blob) {
  mic.rec = null;
  if (mic.cancel) { putDictation(''); setMicUI(); return; }
  if (!blob || !blob.size) { setMicUI(); return; }
  mic.busy = true; setMicUI();
  transcribe(blob, false).then(function (r) {
    var texto = (r && r.texto || '').trim();
    if (texto) putDictation(texto); else toast('No se entendió nada en el audio.');
  }).catch(function (e) {
    toast(e.message || 'No pude pasar el audio a texto.');
  }).then(function () {
    mic.busy = false; setMicUI();
    if (mic.tab === state.active && !TACTIL) els.input.focus();
  });
}
function toggleMic() {
  if (mic.busy) return;
  if (mic.rec) { mic.rec.stop(); return; }
  if (NATIVO) { startNativeMic(); return; }
  if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Este navegador no deja grabar audio.'); return; }
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
    var rec = new MediaRecorder(stream);
    startDictation(rec);
    // Cada medio segundo llega un pedazo y se pasa a texto todo lo grabado hasta ahí (de a un pedido por vez): como se
    // vuelve a transcribir entero, lo ya escrito se corrige solo con el contexto de lo que sigue.
    rec.ondataavailable = function (e) { if (e.data && e.data.size) { mic.chunks.push(e.data); partialDictation(); } };
    rec.onstop = function () {
      stream.getTracks().forEach(function (t) { t.stop(); });
      finishDictation(new Blob(mic.chunks, { type: rec.mimeType || 'audio/webm' }));
    };
    rec.start(500);
  }).catch(function () { toast('No pude usar el micrófono.'); });
}
/* En la app del celular graba la app (window.MaritoApp, Microfono.java): la página llega por HTTP y ahí el WebView
   no da getUserMedia. Devuelve el audio en base64 (Opus en OGG); los cambios de estado vienen por window.maritoMic. */
var NATIVO = !!(window.MaritoApp && window.MaritoApp.empezar);
function base64Blob(b64) {
  var s = atob(b64), a = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return new Blob([a], { type: 'audio/ogg' });
}
function startNativeMic() {
  window.maritoMic = function (estado) {
    if (estado === 'grabando') {
      if (mic.rec) return;
      var rec = { mimeType: 'audio/ogg', stop: function () {
        clearInterval(rec.timer);
        if (mic.cancel) { window.MaritoApp.cancelar(); finishDictation(null); return; }
        var b = window.MaritoApp.terminar();
        finishDictation(b ? base64Blob(b) : null);
      } };
      startDictation(rec);
      // Cada segundo, todo lo grabado hasta ahí (como en la PC, pero menos seguido: puede ir por datos móviles)
      rec.timer = setInterval(function () {
        if (mic.inflight || mic.rec !== rec) return;
        var b = window.MaritoApp.audio();
        if (!b || b.length <= mic.n) return;
        var n = b.length;
        mic.inflight = true;
        transcribe(base64Blob(b), true).then(function (r) {
          if (mic.rec === rec && !mic.cancel && n > mic.n) { mic.n = n; putDictation((r && r.texto || '').trim()); }
        }).catch(function () { /* el final lo vuelve a intentar */ }).then(function () { mic.inflight = false; });
      }, 1000);
    } else if (estado === 'cortado') {
      if (mic.rec) mic.rec.stop(); // salió de la app: pasa a texto lo que hubo
    } else if (estado === 'negado') {
      toast('Marito no tiene permiso para el micrófono: dáselo en los ajustes de la app.');
    } else {
      toast('No pude usar el micrófono.');
    }
  };
  window.MaritoApp.empezar();
}
function transcribe(blob, parcial) {
  if (DEMO) return window.__demo.api('/api/audio', 'POST', { blob: blob, parcial: parcial });
  return fetch('/api/audio' + (parcial ? '?parcial=1' : ''), {
    method: 'POST',
    headers: { 'X-Token': TOKEN, 'Content-Type': 'application/octet-stream' },
    body: blob
  }).then(handle);
}
/* ---------- Audio: charla por voz. Hablás; al callarte un momento se manda solo, Marito contesta en voz alta y vuelve
   a escuchar. Se termina tocando el micrófono o con Esc. ---------- */

var SILENCIO_MS = 1300, PASO_MS = 60, ESPERA_MAX_MS = 2 * 60 * 1000;
function startCharla() {
  if (charla.on || mic.rec || mic.busy || !state.active) return;
  if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Este navegador no deja grabar audio.'); return; }
  charla.on = true; charla.tab = state.active; charla.estado = 'cargando'; charla.oido = '';
  setMicUI();
  // Que la voz se vaya cargando mientras habla (Chatterbox tarda unos segundos la primera vez).
  var voz = api('/api/voz', 'POST', { preparar: true }).catch(function () { return { ok: false, error: 'No pude preparar la voz.' }; });
  var micro = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  Promise.all([voz, micro]).then(function (r) {
    var stream = r[1];
    if (!charla.on) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
    if (r[0] && r[0].ok === false) toast(r[0].error + ' Te contesto por escrito.');
    charla.stream = stream;
    charla.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    charla.analyser = charla.audioCtx.createAnalyser();
    charla.analyser.fftSize = 1024;
    charla.audioCtx.createMediaStreamSource(stream).connect(charla.analyser);
    listen();
  }, function () { stopCharla(); toast('No pude usar el micrófono.'); });
}
function stopCharla() {
  if (!charla.on) return;
  var tab = charla.tab;
  charla.on = false; charla.estado = ''; charla.oido = ''; charla.esperaVoz = false;
  clearInterval(charla.timer); clearTimeout(charla.espera);
  if (charla.rec && charla.rec.state !== 'inactive') { charla.rec.onstop = null; charla.rec.stop(); }
  charla.rec = null;
  if (charla.stream) charla.stream.getTracks().forEach(function (t) { t.stop(); });
  if (charla.audioCtx) charla.audioCtx.close().catch(function () {});
  charla.stream = charla.audioCtx = charla.analyser = null;
  stopVoice();
  if (tab && voice.loc) api('/api/voz', 'POST', { cortar: tab.id }).catch(function () {});
  setMicUI(); paintTerminal();
}
// Escuchar una vez: graba hasta que hablás y te callás SILENCIO_MS; lo de mientras se ve como aviso en la caja.
function listen() {
  if (!charla.on) return;
  var tab = charla.tab;
  if (state.tabs.indexOf(tab) < 0) { stopCharla(); return; }
  // Mientras Marito piensa o habla, no se escucha (si no, se oiría a sí mismo). Se espera su `voz-fin`; si no llega
  // (el turno no arrancó), a los 20 s de quedar todo quieto se vuelve a escuchar igual.
  var quieto = !tab.busy && !tab.waiting && !voice.audio && !voice.queue.length;
  if (quieto && charla.esperaVoz) {
    charla.quietoDesde = charla.quietoDesde || Date.now();
    if (Date.now() - charla.quietoDesde > 20000) charla.esperaVoz = false;
  } else charla.quietoDesde = 0;
  if (!quieto || charla.esperaVoz) { charla.estado = 'pensando'; setMicUI(); clearTimeout(charla.espera); charla.espera = setTimeout(listen, 300); return; }
  var rec = new MediaRecorder(charla.stream);
  charla.rec = rec; charla.chunks = []; charla.n = 0; charla.oido = ''; charla.estado = 'escuchando';
  var buf = new Float32Array(charla.analyser.fftSize);
  var piso = 0.01, voz = 0, silencio = 0, espera = 0, hablo = false;
  rec.ondataavailable = function (e) { if (e.data && e.data.size) { charla.chunks.push(e.data); if (hablo) partialCharla(); } };
  rec.onstop = function () { finishUtterance(rec); };
  rec.start(500);
  clearInterval(charla.timer);
  charla.timer = setInterval(function () {
    // Volumen (RMS) contra el ruido de fondo, que se va midiendo mientras no hablás.
    charla.analyser.getFloatTimeDomainData(buf);
    var s = 0;
    for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    var rms = Math.sqrt(s / buf.length), umbral = Math.max(0.018, piso * 3);
    if (rms > umbral) { voz += PASO_MS; silencio = 0; if (voz >= 180 && !hablo) { hablo = true; charla.estado = 'oyendo'; setMicUI(); } }
    else {
      voz = 0;
      if (!hablo) piso = piso * 0.95 + rms * 0.05;
      if (hablo) silencio += PASO_MS;
    }
    espera += PASO_MS;
    if (hablo && (silencio >= SILENCIO_MS || espera >= 90000)) { clearInterval(charla.timer); rec.stop(); }
    else if (!hablo && espera >= ESPERA_MAX_MS) { stopCharla(); toast('Corté la charla por voz: no te escuché nada.'); }
  }, PASO_MS);
  setMicUI();
}
function partialCharla() {
  if (charla.inflight || !charla.rec || !charla.chunks.length) return;
  var n = charla.chunks.length, rec = charla.rec;
  charla.inflight = true;
  transcribe(new Blob(charla.chunks, { type: rec.mimeType || 'audio/webm' }), true).then(function (r) {
    if (charla.rec === rec && n > charla.n) { charla.n = n; charla.oido = (r && r.texto || '').trim(); setMicUI(); }
  }).catch(function () {}).then(function () { charla.inflight = false; });
}
function finishUtterance(rec) {
  if (!charla.on || charla.rec !== rec) return;
  charla.rec = null; charla.estado = 'pensando'; setMicUI();
  var tab = charla.tab;
  transcribe(new Blob(charla.chunks, { type: rec.mimeType || 'audio/webm' }), false).then(function (r) {
    var texto = (r && r.texto || '').trim();
    if (!charla.on) return;
    charla.oido = '';
    if (!texto || state.tabs.indexOf(tab) < 0) { listen(); return; }
    charla.esperaVoz = true; charla.quietoDesde = 0;
    send(tab, texto, true);
    listen(); // queda esperando que Marito termine de hablar
    setMicUI();
  }).catch(function (e) { if (charla.on) { toast(e.message || 'No pude pasar el audio a texto.'); listen(); } });
}
// Marito terminó de decir todo: si la charla sigue, vuelve a escuchar.
function afterSpeaking() { charla.esperaVoz = false; if (charla.on && !charla.rec) listen(); }

/* ---------- Menú del micrófono ---------- */
function closeMicMenu() { els.micMenu.hidden = true; els.btnMic.setAttribute('aria-expanded', 'false'); }
els.btnMic.addEventListener('click', function () {
  if (mic.rec || mic.busy || NATIVO) { toggleMic(); return; } // dictando: corta; en la app del celular solo se dicta
  if (charla.on) { stopCharla(); return; }                    // charlando: termina
  var abrir = els.micMenu.hidden;
  els.micMenu.hidden = !abrir;
  els.btnMic.setAttribute('aria-expanded', abrir ? 'true' : 'false');
  // Sin correr la página: en la barra el menú se abre para abajo, afuera de la ventana hasta que el host la agranda, y
  // el foco la corría hasta él (la barra quedaba arriba, fuera de la vista; 24/11).
  if (abrir) els.optCharla.focus({ preventScroll: true });
});
els.optDictar.addEventListener('click', function () { closeMicMenu(); toggleMic(); });
els.optCharla.addEventListener('click', function () { closeMicMenu(); startCharla(); });
els.micMenu.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); (document.activeElement === els.optDictar ? els.optCharla : els.optDictar).focus({ preventScroll: true }); }
});
document.addEventListener('mousedown', function (e) { if (!els.micMenu.hidden && !e.target.closest('.mic-wrap')) closeMicMenu(); });
