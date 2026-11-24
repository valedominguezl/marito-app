/* Marito v3 — Scroll y dibujo de la conversación: mensajes, texto, herramientas, marca y tutorial, voz de Marito y fin de turno.
   Script clásico: comparte el ámbito global con los demás de ui/ (ver el orden en index.html). */
'use strict';

/* ---------- Scroll ---------- */

function nearBottom() {
  var s = els.scroll;
  return s.scrollHeight - s.scrollTop - s.clientHeight < 80;
}
els.scroll.addEventListener('scroll', function () { if (state.active) state.active.stick = nearBottom(); paintPinned(); });

// Tu último mensaje que ya pasó para arriba queda fijo arriba (como en VS Code); tocarlo vuelve hasta él.
var pinnedMsg = null;
function paintPinned() {
  var feed = null, kids = els.feeds.children;
  for (var i = 0; i < kids.length; i++) if (!kids[i].hidden) feed = kids[i];
  var top = els.scroll.getBoundingClientRect().top, found = null;
  if (feed) {
    var msgs = feed.querySelectorAll('.msg-user');
    for (var j = msgs.length - 1; j >= 0; j--) {
      if (msgs[j].getBoundingClientRect().top < top) { found = msgs[j]; break; }
    }
  }
  if (found && found.getBoundingClientRect().bottom > top + 8) found = null; // todavía se ve
  pinnedMsg = found;
  var b = found && found.querySelector('.bubble');
  els.pinned.hidden = !b;
  if (b) els.pinned.textContent = b.textContent.trim();
}
els.pinned.addEventListener('click', function () {
  if (!pinnedMsg) return;
  els.scroll.scrollTop += pinnedMsg.getBoundingClientRect().top - els.scroll.getBoundingClientRect().top - 12;
  paintPinned();
});
function toBottom(force, tab) {
  tab = tab || state.active;
  if (tab !== state.active) return;
  if (force || tab.stick) {
    els.scroll.scrollTop = els.scroll.scrollHeight;
    if (force) tab.stick = true;
  }
}

/* ---------- Estado vacío ---------- */

function renderEmpty(tab) {
  var old = tab.feed.querySelector('.empty');
  if (tab.hasMessages) { if (old) old.remove(); return; }
  var node = old || el('div', 'empty');
  node.innerHTML = '<img class="empty-bot" src="/ui/marito.png" alt="">' +
    '<strong>¿En qué te ayudo?</strong>' +
    (tab.url ? '<span>' + esc(tab.url) + '</span>' : '') +
    (tab.donde ? '<span class="empty-where">' + esc(tab.donde) + '</span>' : '');
  if (!old) tab.feed.appendChild(node);
}

/* ---------- Dibujo de la conversación ---------- */

function resetFeed(tab) {
  tab.feed.innerHTML = '';
  tab.turn = null;
  tab.hasMessages = false;
  tab.lastText = '';
  renderEmpty(tab);
}

function attachmentView(a, small) {
  a = typeof a === 'string' ? { url: a, imagen: true } : a;
  if (a.imagen !== false && (a.imagen || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.nombre || a.url || ''))) {
    var b = el('button', 'thumb-btn');
    b.type = 'button';
    b.setAttribute('aria-label', 'Ver ' + (a.nombre || 'la imagen') + ' grande');
    var img = el('img');
    img.src = a.local || withToken(a.url);
    img.alt = a.nombre || 'Imagen adjunta';
    b.appendChild(img);
    b.addEventListener('click', function () { openLightbox(a.local || a.url); });
    return b;
  }
  var f = el('button', 'file-chip' + (small ? ' small' : ''));
  f.type = 'button';
  f.title = (a.nombre || 'archivo') + (a.ruta ? '\nAbrir con su programa' : '');
  f.innerHTML = svg(fileIcon(a)) + '<span class="fc-name"></span><span class="fc-size"></span>';
  f.querySelector('.fc-name').textContent = a.nombre || 'archivo';
  f.querySelector('.fc-size').textContent = fmtSize(a.tamano);
  f.addEventListener('click', function () { if (a.ruta) host({ tipo: 'abrirArchivo', ruta: a.ruta }); });
  return f;
}

function addUserMessage(tab, texto, atts) {
  tab.hasMessages = true;
  renderEmpty(tab);
  var m = el('div', 'msg-user');
  if (atts && atts.length) {
    var box = el('div', 'imgs');
    atts.forEach(function (a) { box.appendChild(attachmentView(a, true)); });
    m.appendChild(box);
  }
  if (texto) {
    var b = el('div', 'bubble');
    b.textContent = texto;
    m.appendChild(b);
  }
  tab.feed.appendChild(m);
  if (!tab.titulo && texto) { tab.titulo = texto.replace(/\s+/g, ' ').slice(0, 60); renderTabs(); }
  toBottom(true, tab);
  return m;
}

function beginTurn(tab) {
  tab.hasMessages = true;
  renderEmpty(tab);
  var t = { el: el('div', 'turn'), cur: null, thinking: null, card: null, confirm: null, texts: [] };
  tab.turn = t;
  tab.feed.appendChild(t.el);
  setBusy(tab, true);
  showThinking(tab);
  toBottom(true, tab);
}
function ensureTurn(tab) { if (!tab.turn) beginTurn(tab); return tab.turn; }

// Al pie del turno, mientras trabaja: puntitos y un texto chiquito que va cambiando (lo último que hizo o
// una frase que rota cada pocos segundos) con los segundos que lleva, como en VS Code.
var FRASES = ['Pensando', 'Mirando el código', 'Atando cabos', 'Dándole forma', 'Masticándolo', 'Revisando', 'Cocinando', 'Acomodando las ideas'];
function showThinking(tab, actividad) {
  var t = tab.turn;
  if (!t) return;
  if (!t.thinking) {
    t.thinking = el('div', 'thinking');
    t.thinking.setAttribute('role', 'status');
    t.thinking.setAttribute('aria-label', 'Trabajando');
    t.thinking.innerHTML = '<span class="dots"><span></span><span></span><span></span></span><span class="thinking-text"></span><span class="thinking-time"></span>';
    t.start = t.start || Date.now();
    t.frase = Math.floor(Math.random() * FRASES.length);
  }
  if (actividad) { t.actividad = actividad; t.actividadAt = Date.now(); }
  if (t.thinking.parentNode !== t.el || t.el.lastChild !== t.thinking) t.el.appendChild(t.thinking); // siempre al final
  if (!t.tick) {
    paintThinking(t);
    t.tick = setInterval(function () { paintThinking(t); }, 1000);
  }
}
function paintThinking(t) {
  var seg = Math.floor((Date.now() - t.start) / 1000);
  var texto;
  if (t.actividad && Date.now() - t.actividadAt < 4000) texto = t.actividad;
  else {
    if (seg > 0 && seg % 3 === 0) t.frase = (t.frase + 1) % FRASES.length;
    texto = FRASES[t.frase];
  }
  var tx = t.thinking.querySelector('.thinking-text');
  if (tx.textContent !== texto + '…') { tx.textContent = texto + '…'; tx.classList.remove('swap'); void tx.offsetWidth; tx.classList.add('swap'); }
  t.thinking.querySelector('.thinking-time').textContent = seg >= 2 ? seg + ' s' : '';
}
function hideThinking(tab) {
  var t = tab.turn;
  if (!t) return;
  if (t.tick) { clearInterval(t.tick); t.tick = null; }
  if (t.thinking && t.thinking.parentNode) t.thinking.remove();
}

var dirtyTabs = [];
var renderQueued = false;
function queueRender(tab) {
  if (dirtyTabs.indexOf(tab) < 0) dirtyTabs.push(tab);
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(function () {
    renderQueued = false;
    var list = dirtyTabs; dirtyTabs = [];
    list.forEach(function (tb) {
      if (!tb.turn) return;
      tb.turn.texts.forEach(function (b) {
        if (b.dirty) { paintMd(b); }
      });
      paintTutorials(tb, tb.turn);
      toBottom(false, tb);
    });
  });
}

function onText(tab, delta) {
  var t = ensureTurn(tab);
  if (!t.cur || t.cur.type !== 'text') {
    var block = { type: 'text', el: el('div', 'md'), raw: '', dirty: false };
    t.el.appendChild(block.el);
    t.texts.push(block);
    t.cur = block;
  }
  if (tab.busy) showThinking(tab, 'Escribiendo');
  t.cur.raw += delta;
  t.cur.dirty = true;
  queueRender(tab);
}

// Marito señaló algo en la pantalla: en el chat queda el pedazo de la captura agrandado con el lugar marcado
// (click = la captura entera). El recuadro de verdad lo dibuja el servidor encima de la app.
function onMark(tab, ev) {
  if (REMOTO) return; // el paso a paso es de la pantalla de la PC: en el celular no aparece (lo pidió el usuario el 23/11)
  var t = tab.turn;
  var W = ev.ancho, H = ev.alto, b = ev.caja;
  if (!W || !H || !b) return;
  var cw = Math.min(W, Math.max(b.w * 5, 520)), ch = Math.min(H, Math.max(Math.round(cw * 0.45), b.h * 3));
  var cx = Math.max(0, Math.min(b.x + b.w / 2 - cw / 2, W - cw)), cy = Math.max(0, Math.min(b.y + b.h / 2 - ch / 2, H - ch));
  var pct = function (v) { return (v * 100).toFixed(3) + '%'; };
  var card = el('button', 'mark-card'); card.type = 'button';
  card.title = 'Ver la captura entera';
  card.setAttribute('aria-label', 'Lugar marcado en la pantalla' + (ev.nombre ? ': ' + ev.nombre : '') + '. Ver la captura entera.');
  var shot = el('div', 'mark-shot');
  shot.style.aspectRatio = cw + ' / ' + ch;
  shot.style.backgroundImage = 'url("' + withToken(ev.imagen) + '")';
  shot.style.backgroundSize = pct(W / cw) + ' auto';
  shot.style.backgroundPosition = (W > cw ? pct(cx / (W - cw)) : '0%') + ' ' + (H > ch ? pct(cy / (H - ch)) : '0%');
  var box = el('div', 'mark-box');
  box.style.left = pct((b.x - cx) / cw); box.style.top = pct((b.y - cy) / ch);
  box.style.width = pct(b.w / cw); box.style.height = pct(b.h / ch);
  shot.appendChild(box);
  card.appendChild(shot);
  card.addEventListener('click', function () { openLightbox(ev.imagen); });
  // Los pasos que siguen los marca el servidor solo, fuera de un turno: van con su frase y sin abrir un turno nuevo
  // (que pondría «Pensando…» y la pestaña ocupada).
  if (ev.paso) {
    var cap = el('div', 'mark-caption', '');
    cap.textContent = ev.paso + '. ' + (ev.texto || ev.nombre || '');
    card.insertBefore(cap, shot);
  }
  if (t) {
    t.el.appendChild(card);
    t.cur = { type: 'mark', el: card };
  } else {
    var solo = el('div', 'turn');
    solo.appendChild(card);
    tab.feed.appendChild(solo);
  }
  toBottom(false, tab);
}

// El paso a paso de la marca (SSE `tutorial`, la marca que enseña): en la respuesta de Claude, el paso que toca queda
// resaltado y los hechos tildados; abajo de la lista, «Salir del tutorial» o, en pausa, «▶ Volver al tutorial (paso N)»,
// que lo marca de nuevo en la pantalla. `marca` dice cuál de las listas del turno es (la n-ésima con [MARCAR]).
function onTutorial(tab, ev) {
  tab.tutos = tab.tutos || {};
  var tu = tab.tutos[ev.id];
  if (!tu) {
    if (!tab.turn) return;
    tu = tab.tutos[ev.id] = { id: ev.id, el: tab.turn.el, marca: ev.marca || 0, btn: null };
    escucharPasos(tab, tu);
    tab.turn.tutos = (tab.turn.tutos || []).concat(tu);
    // Solo el último del chat se puede repetir (el servidor recuerda uno): los anteriores pierden el botón.
    var antes = tab.tutoActual && tab.tutos[tab.tutoActual];
    tab.tutoActual = ev.id;
    if (antes) paintTutorial(tab, antes);
  }
  tu.paso = ev.paso || 1; tu.pausado = !!ev.pausado; tu.fin = !!ev.fin; tu.cortado = !!ev.cortado;
  paintTutorial(tab, tu);
}
function paintTutorials(tab, t) { (t.tutos || []).forEach(function (tu) { paintTutorial(tab, tu); }); }
function pasosDelTutorial(tu) {
  var todos = Array.prototype.slice.call(tu.el.querySelectorAll('.paso'));
  var primeros = todos.filter(function (x) { return x.classList.contains('paso-1'); });
  var ini = primeros[tu.marca] ? todos.indexOf(primeros[tu.marca]) : -1;
  if (ini < 0) return [];
  var out = [todos[ini]];
  for (var i = ini + 1; i < todos.length && !todos[i].classList.contains('paso-1'); i++) out.push(todos[i]);
  return out;
}
// Tocar un renglón de la lista lo marca de nuevo en la pantalla (24/11, pedido del usuario): solo el último tutorial del
// chat (el servidor recuerda uno), en la PC y sin un turno corriendo. Los renglones se rehacen con cada pedazo de texto,
// por eso se escucha en el turno entero y no en cada renglón.
function pasoTocable(tab, tu) { return !REMOTO && !tu.cortado && tab.tutoActual === tu.id && !tab.busy; }
function escucharPasos(tab, tu) {
  function ir(e) {
    var li = e.target.closest && e.target.closest('.paso');
    if (!li || e.target.closest('a, button') || !pasoTocable(tab, tu)) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    if (e.type === 'click' && String(window.getSelection() || '')) return; // estaba eligiendo texto
    var n = pasosDelTutorial(tu).indexOf(li) + 1;
    if (!n) return;
    e.preventDefault();
    api('/api/tutorial', 'POST', { conv: tab.id, id: tu.id, accion: 'paso', n: n }).catch(function (err) {
      if (err.status === 409 && /ya no está/.test(err.message)) { tu.fin = true; tu.cortado = true; paintTutorial(tab, tu); }
      toast(err.message);
    });
  }
  tu.el.addEventListener('click', ir);
  tu.el.addEventListener('keydown', ir);
}
function paintTutorial(tab, tu) {
  var pasos = pasosDelTutorial(tu);
  var tocable = pasoTocable(tab, tu);
  pasos.forEach(function (x, i) {
    x.classList.toggle('paso-hecho', tu.fin && !tu.cortado ? true : i < tu.paso - 1);
    x.classList.toggle('paso-ahora', !tu.fin && i === tu.paso - 1);
    x.classList.toggle('paso-tocable', tocable);
    if (tocable) { x.tabIndex = 0; x.title = 'Marcar este paso en la pantalla'; }
    else { x.removeAttribute('tabindex'); x.removeAttribute('title'); }
  });
  // El paso a paso es de la pantalla de la PC: en el celular no hay botón. Terminado, «Repetir el tutorial» (solo el
  // último del chat; uno cortado por otra lista, no).
  var repetible = tu.fin && !tu.cortado && tab.tutoActual === tu.id;
  if ((tu.fin && !repetible) || REMOTO) { if (tu.btn) { tu.btn.remove(); tu.btn = null; } return; }
  if (!tu.btn) {
    tu.btn = el('button', 'btn tuto-btn'); tu.btn.type = 'button';
    tu.btn.addEventListener('click', function () {
      var b = tu.btn;
      b.disabled = true;
      api('/api/tutorial', 'POST', { conv: tab.id, id: tu.id, accion: tu.fin ? 'repetir' : tu.pausado ? 'volver' : 'salir' }).then(function () { b.disabled = false; }, function (e) {
        b.disabled = false;
        // Ya no está (el servidor se reinició o la reemplazó otra lista): queda como estaba, sin botón.
        if (e.status === 409 && /ya no está/.test(e.message)) { tu.fin = true; tu.cortado = true; paintTutorial(tab, tu); }
        toast(e.message);
      });
    });
  }
  tu.btn.textContent = tu.fin ? '↻ Repetir el tutorial' : tu.pausado ? '▶ Volver al tutorial (paso ' + tu.paso + ')' : 'Salir del tutorial';
  tu.btn.classList.toggle('btn-primary', tu.pausado && !tu.fin);
  // Abajo de todo del mensaje (pedido del usuario, 24/11: debajo de la lista quedaba arriba de la captura y del texto
  // de después); solo «Pensando…», el costo y «Arreglalo» van más abajo.
  var pie = tu.el.querySelector(':scope > .thinking, :scope > .meta, :scope > .actions');
  if (pie) { if (tu.btn.nextSibling !== pie) tu.el.insertBefore(tu.btn, pie); }
  else if (tu.el.lastChild !== tu.btn) tu.el.appendChild(tu.btn);
}

// La voz de Marito: el servidor manda frase por frase (wav en memoria, `voz`) de una «locución» (la respuesta hablada o
// el paso de una marca) y suenan en fila. Una locución nueva corta la anterior. `voz-fin`: ya no vienen más frases de
// esa; cuando termina de sonar la última, Marito terminó de hablar (la charla por voz vuelve a escuchar).
var voice = { loc: null, queue: [], audio: null, fin: null, done: null };
// Charla por voz (ver «Audio» más abajo): estado = cargando | escuchando | oyendo (ya habló) | pensando.
var charla = { on: false, tab: null, stream: null, audioCtx: null, analyser: null, rec: null, chunks: [], estado: '',
  aviso: '', oido: '', timer: 0, inflight: false, n: 0 };
function stopVoice() {
  if (voice.audio) { voice.audio.onended = voice.audio.onerror = null; voice.audio.pause(); }
  voice.audio = null; voice.queue = [];
  setMicUI();
}
function onVoz(ev) {
  if (voice.loc !== ev.loc) { stopVoice(); voice.loc = ev.loc; }
  voice.queue.push(ev.url);
  playVoice();
}
function onVozFin(ev) {
  if (voice.loc !== ev.loc && !voice.audio) { voice.queue = []; voice.loc = ev.loc; } // no llegó a sonar nada
  voice.fin = ev.loc;
  if (ev.error && charla.on) toast(ev.error);
  playVoice();
}
function onVozCortar(ev) { if (voice.loc === ev.loc) { stopVoice(); voice.loc = null; } }
function playVoice() {
  if (voice.audio) return;
  var url = voice.queue.shift();
  if (!url) {
    if (voice.fin === voice.loc && voice.done !== voice.loc) { voice.done = voice.loc; setMicUI(); afterSpeaking(); }
    return;
  }
  var a = new Audio(withToken(url));
  voice.audio = a;
  a.onended = a.onerror = function () { if (voice.audio === a) { voice.audio = null; playVoice(); } };
  a.play().catch(function () { if (voice.audio === a) { voice.audio = null; playVoice(); } }); // sin permiso para sonar: sigue
  setMicUI();
}

// Tocó adentro del recuadro y el servidor no marcó solo el paso siguiente: se lo pide a Claude (si el turno todavía
// corre, queda en cola). `texto`: lo que manda el servidor cuando no encontró el paso que Claude había pensado.
function onMarkTouched(tab, texto) {
  texto = texto || 'Listo, ya lo toqué.';
  if (tab.busy || tab.waiting) {
    var m = addUserMessage(tab, texto, []);
    m.classList.add('queued');
    tab.queue.push({ texto: texto, atts: [], el: m });
    return;
  }
  send(tab, texto);
}

function onTool(tab, nombre, detalle) {
  var t = ensureTurn(tab);
  if (!t.cur || t.cur.type !== 'tools') {
    var group = { type: 'tools', el: el('div', 'tools'), list: el('div', 'tool-list'), more: null, n: 0 };
    group.el.appendChild(group.list);
    t.el.appendChild(group.el);
    t.cur = group;
  }
  var g = t.cur;
  // De un conector: mcp__claude_ai_Notion__notion-search → «Notion» · «notion search».
  var mcp = /^mcp__(?:claude_ai_)?([^_]+(?:_[^_]+)*)__(.+)$/.exec(nombre || '');
  if (mcp && !detalle) detalle = mcp[2].replace(/[-_]+/g, ' ');
  var info = TOOLS[nombre] || (mcp ? [mcp[1].replace(/_/g, ' '), 'dot'] : [nombre, 'dot']);
  var line = el('div', 'tool', svg(info[1]) + '<span class="tool-verb">' + esc(info[0]) + '</span>');
  var det = el('span', 'tool-detail');
  det.textContent = detalle || '';
  det.title = detalle || '';
  line.appendChild(det);
  g.list.appendChild(line);
  g.n++;
  if (g.n > 2) {
    if (!g.more) {
      g.more = el('button', 'tools-more');
      g.more.type = 'button';
      g.more.addEventListener('click', function () { g.list.classList.toggle('open'); updateMore(g); });
      g.el.insertBefore(g.more, g.list);
    }
    updateMore(g);
  }
  var corto = String(detalle || '').split(/[\\/]/).pop();
  if (corto.length > 40) corto = corto.slice(0, 39) + '…';
  showThinking(tab, info[0] + (corto ? ' ' + corto : ''));
  toBottom(false, tab);
}
function updateMore(g) {
  var open = g.list.classList.contains('open');
  g.more.textContent = open ? 'Ocultar anteriores' : 'Ver ' + (g.n - 2) + ' anteriores';
  g.more.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function fmtCost(usd) { return 'US$' + Number(usd).toFixed(2).replace('.', ','); }

function onTurnEnd(tab, ev) {
  var t = ensureTurn(tab);
  hideThinking(tab);
  t.texts.forEach(paintMd);
  paintTutorials(tab, t);
  var meta = el('div', 'meta');
  var bits = [];
  if (ev.cambio) bits.push('<span class="chip">' + svg('check') + 'Commit hecho</span>');
  if (typeof ev.segundos === 'number') bits.push('<span>' + Math.round(ev.segundos) + ' s</span>');
  if (typeof ev.costoUsd === 'number') bits.push('<span>' + fmtCost(ev.costoUsd) + '</span>');
  if (bits.length) { meta.innerHTML = bits.join(''); t.el.appendChild(meta); }

  var last = t.texts.length ? t.texts[t.texts.length - 1] : null;
  tab.lastText = last ? last.raw : '';
  var endsAsking = last && t.cur === last && /¿Lo arreglo\?\s*[*_`]*\s*$/.test(last.raw);
  if (endsAsking && !ev.cambio) {
    var acts = el('div', 'actions');
    var b = el('button', 'btn btn-primary', 'Arreglalo');
    b.type = 'button';
    b.setAttribute('aria-label', 'Arreglalo: mandar «Dale, arreglalo.»');
    b.addEventListener('click', function () { acts.remove(); send(tab, 'Dale, arreglalo.'); });
    acts.appendChild(b);
    t.el.appendChild(acts);
  }
  if (ev.contexto) tab.contexto = ev.contexto;
  var chain = tab.chainNext && !state.replaying;
  tab.chainNext = false;
  setBusy(tab, false);
  paintTutorials(tab, t); // libre otra vez: los renglones del tutorial se pueden tocar
  toBottom(false, tab);
  if (chain) { continueChain(tab, t, ev); return; }
  if (!ev.detenido) {
    var error = ev.ok === false && !ev.cambio;
    notify(tab, error ? 'err' : 'ok', error ? 'Terminó con un error.' : summary(tab.lastText), error);
  }
}
