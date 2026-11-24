/* Marito v3 — Terminemos, contexto, errores y tarjetas de confirmar y de publicación con pasos.
   Script clásico: comparte el ámbito global con los demás de ui/ (ver el orden en index.html). */
'use strict';

/* ---------- Terminemos: /terminemos acá y, si quedó algo pendiente, el chat nuevo arranca solo con su prompt ---------- */

// El prompt del chat nuevo es el último bloque de código de la respuesta de /terminemos (si no hay, no quedó nada).
function lastCodeBlock(md) {
  var re = /(^|\n)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\2[ \t]*(?=\n|$)/g, m, last = '';
  while ((m = re.exec(md))) last = m[3];
  return last.trim();
}
function startChain(tab) {
  if (!tab || tab.busy || tab.waiting || !tab.proyecto) return;
  tab.chainNext = true;
  send(tab, '/terminemos');
  paintCtx();
}
function continueChain(tab, t, ev) {
  var prompt = ev.ok === false || ev.detenido ? '' : lastCodeBlock(t.texts.map(function (b) { return b.raw; }).join('\n\n'));
  if (!prompt) {
    if (ev.detenido) { toast('Cortaste el terminemos: no abro el chat nuevo.'); return; }
    var error = ev.ok === false;
    notify(tab, error ? 'err' : 'ok', error ? 'Terminemos terminó con un error.' : summary(tab.lastText), error);
    return;
  }
  // El chat nuevo queda solo: el viejo se cierra (su historial sigue en la cadena). La publicación de su último
  // turno ya la decidió el servidor al terminarlo, así que cerrarlo no la corta.
  newTab({ proyecto: tab.proyecto, sitio: tab.sitio, url: tab.url, encadenadoDe: tab.id }).then(function (nt) {
    if (!nt) return;
    send(nt, prompt);
    if (state.byId[tab.id] && !tab.busy && !tab.waiting) closeTab(tab); // con «¿Publico igual?» abierta queda para contestarla
  });
}
els.btnChain.addEventListener('click', function () { startChain(state.active); });

function fmtTokens(n) { return n >= 1000 ? Math.round(n / 1000) + 'k' : String(n); }
function paintCtx() {
  var tab = state.active;
  var n = tab ? tab.contexto : 0;
  var showChain = !!(tab && tab.proyecto && tab.hasMessages);
  els.ctxRow.hidden = !n && !showChain;
  els.ctx.hidden = !n;
  if (n) {
    els.ctxN.textContent = fmtTokens(n);
    els.ctx.classList.toggle('alto', n >= CTX_AVISO);
    els.ctx.title = 'Contexto que ocupa esta conversación: ' + n.toLocaleString('es-AR') + ' de 200.000 tokens. Cada mensaje lo vuelve a leer entero' +
      (n >= CTX_AVISO ? '; conviene Terminemos (la flechita).' : '.');
    var c = 2 * Math.PI * 7.5;
    els.ctxFill.style.strokeDasharray = c + ' ' + c;
    els.ctxFill.style.strokeDashoffset = String(c * (1 - Math.min(1, n / CTX_MAX)));
  }
  els.btnChain.hidden = !showChain;
  els.btnChain.disabled = !!(tab && (tab.busy || tab.waiting));
  els.btnChain.classList.toggle('sugerido', n >= CTX_AVISO);
}

function summary(md) {
  var s = String(md || '').replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>|]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
  return s.length > 140 ? s.slice(0, 139) + '…' : (s || 'Terminó.');
}

function onError(tab, texto) {
  var t = ensureTurn(tab);
  hideThinking(tab);
  t.el.appendChild(el('div', 'error-line', svg('warn') + '<span>' + esc(texto || 'Algo falló') + '</span>'));
  t.cur = null;
  toBottom(false, tab);
}

/* Tarjeta de confirmar publicación */
function onPublishConfirm(tab, motivos, respondida) {
  var t = ensureTurn(tab);
  hideThinking(tab);
  var card = el('div', 'card card-confirm');
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', 'Confirmar publicación');
  card.innerHTML = '<div class="card-head"><span>¿Publico igual?</span></div>';
  var ul = el('ul');
  (motivos || []).forEach(function (m) { var li = el('li'); li.textContent = m; ul.appendChild(li); });
  card.appendChild(ul);
  var acts = el('div', 'actions');
  var yes = el('button', 'btn btn-primary', 'Publicar igual');
  var no = el('button', 'btn', 'No publicar');
  yes.type = no.type = 'button';
  function answer(ok) {
    yes.disabled = no.disabled = true;
    acts.remove();
    var note = el('div', 'card-note ' + (ok ? '' : 'is-warn'));
    note.textContent = ok ? 'Publicando…' : 'No se publica. El commit queda en tu compu.';
    card.appendChild(note);
    tab.waiting = false;
    setBusyUI();
    api('/api/publicar', 'POST', { conv: tab.id, confirmar: ok }).then(function () { flushQueue(tab); }).catch(function (e) { onError(tab, e.message); });
  }
  yes.addEventListener('click', function () { answer(true); });
  no.addEventListener('click', function () { answer(false); });
  acts.appendChild(yes); acts.appendChild(no);
  t.cur = null;
  // Ya contestada (llega así al recargar la ventana): solo el recuerdo, sin botones ni esperar.
  if (respondida) {
    var hecha = el('div', 'card-note ' + (respondida === 'si' ? '' : 'is-warn'));
    hecha.textContent = respondida === 'si' ? 'Elegiste publicar igual.' : 'No se publicó. El commit queda en tu compu.';
    card.appendChild(hecha);
    t.el.appendChild(card);
    return;
  }
  card.appendChild(acts);
  t.el.appendChild(card);
  t.confirm = card;
  tab.waiting = true;
  setBusyUI();
  toBottom(false, tab);
  if (tab === state.active) setTimeout(function () { yes.focus({ preventScroll: true }); }, 0);
  notify(tab, 'ok', '¿Publico igual? Necesita que lo confirmes.', false);
}

/* Tarjeta de publicación con pasos: Commit → Push → Armando → Publicado */
var STEPS = ['Commit', 'Push', 'Armando', 'Publicado'];
function hhmm() {
  var d = new Date();
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}

function onPublication(tab, ev) {
  var t = ensureTurn(tab);
  hideThinking(tab);
  if (t.confirm) {
    var n = t.confirm.querySelector('.card-note');
    if (n && /Publicando/.test(n.textContent)) n.remove();
    if (t.confirm.querySelector('.card-note') === null) t.confirm.remove();
    t.confirm = null;
  }
  // El push o el «cancelado» que siguen a la pregunta quieren decir que ya se contestó (aunque sea desde otra
  // pantalla). Solo esos dos: los pasos del deploy de una publicación anterior pueden llegar con la pregunta abierta.
  // La cola sale igual aunque esta pantalla no supiera de la pregunta (un mensaje rebotado mientras estaba abierta).
  if (ev.paso === 'push' || ev.paso === 'cancelado') { if (tab.waiting) { tab.waiting = false; setBusyUI(); } flushQueue(tab); }
  if (ev.paso === 'cancelado') return;
  if (!t.card) {
    var card = el('div', 'card');
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', 'Publicación');
    card.innerHTML = '<div class="card-head"><span>Publicación</span><time>' + hhmm() + '</time></div>' +
      '<ol class="steps"></ol><div class="card-note" role="status"></div>';
    t.card = { el: card, steps: card.querySelector('.steps'), note: card.querySelector('.card-note'), proyecto: tab.proyecto };
    t.el.appendChild(card);
    state.openCards.forEach(function (oc) {
      if (oc.proyecto !== tab.proyecto || oc.el.classList.contains('stale')) return;
      oc.el.classList.add('stale');
      oc.el.title = 'Siguió en una publicación más nueva';
    });
    state.openCards.push(t.card);
  }
  var paso = ev.paso;
  // Sin deploy la tarjeta muestra solo los pasos que existen (Commit → Push, o solo Commit).
  if (ev.pasos) t.card.pasos = ev.pasos;
  else if (paso === 'sin-deploy') t.card.pasos = 2;
  else if (paso === 'local') t.card.pasos = 1;
  var active = { push: 1, armando: 2, publicado: 4, 'sin-deploy': 4, local: 4, fallo: -1, tope: -1 }[paso];
  var states = ['done', 'pending', 'pending', 'pending'];
  var noteCls = '';
  if (paso === 'push') states[1] = 'active';
  else if (paso === 'armando') { states[1] = 'done'; states[2] = 'active'; }
  else if (paso === 'publicado') states = ['done', 'done', 'done', 'done'];
  else if (paso === 'sin-deploy') states = ['done', 'done', 'skip', 'skip'];
  else if (paso === 'local') states = ['done', 'skip', 'skip', 'skip'];
  else if (paso === 'fallo' || paso === 'tope') {
    var prev = t.card.last || 1;
    for (var i = 1; i < prev; i++) states[i] = 'done';
    states[prev] = paso === 'fallo' ? 'error' : 'active';
    noteCls = paso === 'fallo' ? 'is-err' : 'is-warn';
  }
  if (active > 0) t.card.last = Math.min(active, 3);
  if (paso === 'publicado') noteCls = 'is-ok';
  drawSteps(t.card, states);
  t.card.note.className = 'card-note ' + noteCls;
  t.card.note.textContent = ev.texto || '';
  if (ev.manual && !state.replaying) {
    var acts = el('div', 'actions');
    var go = el('button', 'btn btn-primary', 'Publicar ahora');
    go.type = 'button';
    go.addEventListener('click', function () {
      go.disabled = true;
      api('/api/publicar-ahora', 'POST', { conv: tab.id }).then(function () { acts.remove(); })
        .catch(function (e) { go.disabled = false; onError(tab, e.message); });
    });
    acts.appendChild(go);
    t.card.el.appendChild(acts);
  }
  t.cur = null;
  toBottom(false, tab);
  if (paso === 'publicado' || paso === 'sin-deploy' || paso === 'local' || paso === 'fallo' || paso === 'tope') {
    var card0 = t.card;
    card0.el.classList.remove('stale'); card0.el.title = '';
    state.openCards = state.openCards.filter(function (oc) { return oc !== card0; });
    notify(tab, paso === 'fallo' ? 'err' : 'ok', ev.texto || '', paso === 'fallo');
  }
}

function drawSteps(card, states) {
  var html = '';
  var n = card.pasos || STEPS.length;
  STEPS.slice(0, n).forEach(function (name, i) {
    var s = states[i];
    var icon = s === 'done' ? svg('check') : s === 'error' ? svg('x') : '';
    var label = s === 'done' ? ' (hecho)' : s === 'active' ? ' (en curso)' : s === 'error' ? ' (falló)' : '';
    html += '<li class="step ' + s + '"><span class="ico">' + icon + '</span><span>' + name + '<span class="sr">' + label + '</span></span></li>';
    if (i < n - 1) {
      html += '<li class="step-line ' + (states[i] === 'done' && states[i + 1] !== 'pending' ? 'done' : '') + '" aria-hidden="true"></li>';
    }
  });
  card.steps.innerHTML = html;
}
