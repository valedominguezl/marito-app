/* Marito v3 — Pestañas, la otra pantalla (PC y celular) y el modo terminal.
   Script clásico: comparte el ámbito global con los demás de ui/ (ver el orden en index.html). */
'use strict';

/* ---------- Pestañas ---------- */

function makeTab(c) {
  var tab = {
    id: c.id, proyecto: c.proyecto || '', sitio: c.sitio || '', url: c.url || '', donde: c.donde || '',
    titulo: c.titulo || '', modelo: c.modelo || state.modelo, esfuerzo: state.esfuerzo, busy: !!c.ocupado, waiting: false, unseen: '',
    feed: el('div', 'feed'), turn: null, hasMessages: false, attachments: [], queue: [], terminal: false, cwd: '', term: null, stick: true, scrollTop: 0, draft: '',
    lastText: '', contexto: 0, chainNext: false
  };
  tab.feed.setAttribute('role', 'log');
  tab.feed.setAttribute('aria-live', 'polite');
  tab.feed.hidden = true;
  els.feeds.appendChild(tab.feed);
  state.tabs.push(tab);
  state.byId[tab.id] = tab;
  renderEmpty(tab);
  renderTabs();
  return tab;
}

function tabTitle(tab) { return tab.titulo || 'Chat nuevo'; }

// Arriba, sola, la conversación elegida; abajo, en una fila que se corre de costado, las demás. Al cambiar de
// conversación, la elegida sube y la que estaba arriba baja a su lugar, con una animación de intercambio.
function findTabEl(box, id) {
  for (var i = 0; i < box.children.length; i++) if (box.children[i].dataset.id === id) return box.children[i];
  return null;
}
function renderTabs() {
  // Puntito naranja en el ícono de la barra de tareas mientras alguna pestaña tenga algo sin ver.
  var hay = state.tabs.some(function (t) { return !!t.unseen; });
  if (hay !== !!state.hayNuevos) { state.hayNuevos = hay; host({ tipo: 'nuevos', hay: hay }); }
  var prevTop = els.tabs.querySelector('.tab');
  var prevId = prevTop ? prevTop.dataset.id : '';
  var newId = state.active ? state.active.id : '';
  var swap = null;
  if (prevTop && newId && prevId !== newId && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var src = findTabEl(els.tabs2, newId);
    if (src) swap = { up: src.cloneNode(true), upFrom: src.getBoundingClientRect(), down: prevTop.cloneNode(true), downFrom: prevTop.getBoundingClientRect() };
  }
  els.tabs.innerHTML = '';
  els.tabs2.innerHTML = '';
  state.tabs.forEach(function (tab, i) {
    if (tab === state.active) els.tabs.appendChild(tabEl(tab, i, false));
    else els.tabs2.appendChild(tabEl(tab, i, true));
  });
  els.tabRow.hidden = state.tabs.length < 2;
  if (swap) {
    var down = findTabEl(els.tabs2, prevId);
    if (down && down.scrollIntoView) down.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    flyTab(swap.up, swap.upFrom, els.tabs.querySelector('.tab'));
    flyTab(swap.down, swap.downFrom, down);
  }
  updateTabArrows();
  document.title = state.active ? 'Marito · ' + tabTitle(state.active) : 'Marito';
}
// Una copia de la pestaña viaja de donde estaba a donde quedó; la de verdad aparece al llegar.
function flyTab(ghost, from, target) {
  if (!target) return;
  var to = target.getBoundingClientRect();
  ghost.classList.add('tab-ghost');
  ghost.style.cssText = 'left:' + from.left + 'px;top:' + from.top + 'px;width:' + from.width + 'px;height:' + from.height + 'px';
  document.body.appendChild(ghost);
  target.style.visibility = 'hidden';
  var a = ghost.animate([
    { transform: 'translate(0, 0)', width: from.width + 'px' },
    { transform: 'translate(' + (to.left - from.left) + 'px, ' + (to.top - from.top) + 'px)', width: to.width + 'px' }
  ], { duration: 280, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
  a.onfinish = a.oncancel = function () { ghost.remove(); target.style.visibility = ''; };
}

function tabEl(tab, i, inRow) {
    var b = el('div', 'tab' + (tab === state.active ? ' active' : ''));
    b.dataset.id = tab.id;
    b.setAttribute('role', 'tab');
    b.setAttribute('tabindex', '0');
    b.setAttribute('aria-selected', tab === state.active ? 'true' : 'false');
    b.title = tabTitle(tab) + (i < 9 ? '  (Ctrl+' + (i + 1) + ')' : '');
    var mark = el('span', 'tab-mark' + (tab.busy ? ' busy' : tab.unseen ? ' ' + tab.unseen : ''));
    if (!tab.busy && !tab.unseen) mark.style.background = dotColor(tab.proyecto);
    b.appendChild(mark);
    var name = el('span', 'tab-name');
    name.textContent = tabTitle(tab);
    b.appendChild(name);
    var x = el('button', 'tab-close', svg('x'));
    x.type = 'button';
    x.tabIndex = -1;
    x.setAttribute('aria-label', 'Cerrar conversación');
    x.addEventListener('click', function (e) { e.stopPropagation(); closeTab(tab); });
    b.appendChild(x);
    b.addEventListener('mousedown', function (e) { if (e.button === 1) { e.preventDefault(); closeTab(tab); } });
    // Desde la fila de abajo: la elegida y la de arriba intercambian lugares.
    var pick = function () { if (inRow) swapWithActive(tab); activate(tab); };
    b.addEventListener('click', pick);
    b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    return b;
}

// Flechitas a los costados de la fila: aparecen solo si hay para dónde correrla.
function updateTabArrows() {
  var t = els.tabs2, max = t.scrollWidth - t.clientWidth;
  els.tabsPrev.hidden = t.scrollLeft <= 1;
  els.tabsNext.hidden = t.scrollLeft >= max - 1;
}
function scrollTabs(dir) { els.tabs2.scrollBy({ left: dir * els.tabs2.clientWidth * 0.7, behavior: 'smooth' }); }
els.tabsPrev.addEventListener('click', function () { scrollTabs(-1); });
els.tabsNext.addEventListener('click', function () { scrollTabs(1); });
els.tabs2.addEventListener('scroll', updateTabArrows);
window.addEventListener('resize', updateTabArrows);

function swapWithActive(tab) {
  var i = state.tabs.indexOf(tab), j = state.tabs.indexOf(state.active);
  if (i < 0 || j < 0 || i === j) return;
  state.tabs[i] = state.active; state.tabs[j] = tab;
}

function activate(tab) {
  if (!tab) return;
  var prev = state.active;
  if (prev && prev !== tab) {
    prev.draft = els.input.value;
    prev.scrollTop = els.scroll.scrollTop;
    prev.feed.hidden = true;
  }
  state.active = tab;
  tab.feed.hidden = false;
  if (tab.unseen) tab.unseen = '';
  els.input.value = tab.draft || '';
  autosize();
  els.model.value = tab.modelo || state.modelo;
  els.effort.value = tab.esfuerzo || '';
  paintTerminal();
  renderThumbs();
  paintCard();
  setBusyUI();
  renderTabs();
  paintCtx();
  if (prev !== tab) {
    if (tab.stick) toBottom(true); else els.scroll.scrollTop = tab.scrollTop;
    setTimeout(paintPinned, 0);
  }
  if (!TACTIL) els.input.focus(); // en el celular abriría el teclado cada vez que cambiás de pestaña
}

function newTab(opts) {
  opts = opts || {};
  var base = state.active || {};
  var body = {
    proyecto: opts.proyecto !== undefined ? opts.proyecto : (base.proyecto || ''),
    sitio: opts.sitio !== undefined ? opts.sitio : (opts.proyecto !== undefined ? '' : base.sitio || ''),
    url: opts.url !== undefined ? opts.url : (opts.proyecto !== undefined ? '' : base.url || ''),
    donde: opts.donde || '',
    encadenadoDe: opts.encadenadoDe || undefined
  };
  return api('/api/conversacion', 'POST', body).then(function (c) {
    var tab = state.byId[c.id] || makeTab(c); // el aviso del servidor (conv-nueva) puede llegar antes que la respuesta
    tab.modelo = c.modelo || state.modelo; // cada chat nuevo arranca en el de entrada (Opus 5.5), no en el de la pestaña de adelante
    tab.esfuerzo = base.esfuerzo !== undefined ? base.esfuerzo : state.esfuerzo;
    activate(tab);
    return tab;
  }).catch(function (e) { toast(e.message || 'No pude abrir otra conversación.'); });
}

function closeTab(tab) {
  if (state.tabs.length === 1) { host({ tipo: 'minimizar' }); return; } // la última no se cierra: se esconde la ventana
  if (tab.busy && !window.confirm('Esta conversación todavía está corriendo. ¿La corto y cierro la pestaña?')) return;
  // Cerrarla con «¿Publico igual?» abierta es contestar «No publicar» sin decirlo: se pregunta.
  if (!tab.busy && tab.waiting && !window.confirm('Falta contestar «¿Publico igual?». Si la cerrás no se publica (el commit queda en tu compu). ¿La cierro igual?')) return;
  api('/api/conversacion/' + encodeURIComponent(tab.id), 'DELETE').catch(function () { });
  dropTab(tab);
}
// Saca la pestaña de esta pantalla (la cerró esta o la otra: PC o celular).
function dropTab(tab) {
  var i = state.tabs.indexOf(tab);
  if (i < 0) return;
  state.tabs.splice(i, 1);
  delete state.byId[tab.id];
  tab.feed.remove();
  if (state.active === tab) {
    state.active = null;
    if (state.tabs.length) activate(state.tabs[Math.min(i, state.tabs.length - 1)]);
  } else renderTabs();
}

/* ---------- La otra pantalla (PC ↔ celular): pestañas que abrió, cambió o cerró ---------- */

// Al conectar: qué pestañas hay en el servidor. Suma las que se abrieron y saca las que se cerraron mientras tanto.
function syncTabs(lista) {
  var ids = {};
  lista.forEach(function (c) { ids[c.id] = true; if (!state.byId[c.id]) makeTab(c); });
  state.tabs.slice().forEach(function (t) { if (!ids[t.id]) dropTab(t); });
  if (!state.tabs.length) { newTab(); return; }
  if (!state.active) activate(state.tabs[0]);
}
function onConvNueva(ev) {
  if (state.byId[ev.conv]) return;
  var tab = makeTab(ev.resumen || { id: ev.conv });
  if (!ev.eventos || !ev.eventos.length) return;
  // Reabierta del historial: se dibuja lo que ya tenía.
  var was = state.replaying;
  state.replaying = true;
  ev.eventos.forEach(onEvent);
  state.replaying = was;
  setBusy(tab, false);
}
// `seguir`: Claude pasó la conversación a otro proyecto ([PROYECTO:…]) y sigue la misma charla: no se borra nada.
function onConvCambio(tab, r, seguir) {
  if (r.proyecto !== undefined && r.proyecto !== tab.proyecto) {
    tab.proyecto = r.proyecto;
    if (!seguir) { tab.titulo = ''; if (tab.hasMessages) resetFeed(tab); renderEmpty(tab); }
  }
  ['sitio', 'url', 'donde'].forEach(function (k) { if (r[k] !== undefined) tab[k] = r[k]; });
  renderTabs();
  if (tab === state.active) paintTerminal();
}

function cycleTab(dir) {
  var i = state.tabs.indexOf(state.active);
  var n = state.tabs.length;
  activate(state.tabs[(i + dir + n) % n]);
}

/* ---------- Terminal: la caja manda comandos de PowerShell en vez de mensajes ---------- */

function paintTerminal() {
  var tab = state.active;
  var on = !!(tab && tab.terminal);
  els.composer.classList.toggle('is-term', on);
  els.btnTerm.classList.toggle('on', on);
  els.btnTerm.setAttribute('aria-pressed', on ? 'true' : 'false');
  if (on) els.input.placeholder = 'PS ' + (tab.cwd || tab.proyecto || '~') + '> comando…';
  else els.input.placeholder = tab && tab.proyecto ? 'Preguntá o pedí un arreglo…' : 'Preguntá o pedí lo que quieras…';
  if (!on && charla.on && tab === charla.tab) els.input.placeholder = charla.aviso; // la charla por voz dice en qué está
}
function toggleTerminal() {
  if (!state.active) return;
  state.active.terminal = !state.active.terminal;
  paintTerminal();
  els.input.focus();
}
els.btnTerm.addEventListener('click', toggleTerminal);

function onCommandStart(tab, ev) {
  tab.hasMessages = true;
  renderEmpty(tab);
  hideThinking(tab);
  tab.turn = null;
  var box = el('div', 'term');
  var head = el('div', 'term-cmd');
  var where = el('span', 'term-cwd'); where.textContent = 'PS ' + (ev.cwd || '') + '>';
  var cmd = el('span'); cmd.textContent = ' ' + (ev.comando || '');
  head.appendChild(where); head.appendChild(cmd);
  var out = el('pre', 'term-out');
  box.appendChild(head); box.appendChild(out);
  tab.feed.appendChild(box);
  tab.term = { el: box, out: out };
  tab.cwd = ev.cwd || tab.cwd;
  if (!tab.titulo) { tab.titulo = '> ' + String(ev.comando || '').slice(0, 50); renderTabs(); }
  setBusy(tab, true);
  toBottom(true, tab);
}
function onCommandOutput(tab, ev) {
  if (!tab.term) return;
  var s = el('span', ev.error ? 'term-err' : '');
  s.textContent = ev.texto || '';
  tab.term.out.appendChild(s);
  toBottom(false, tab);
}
function onCommandEnd(tab, ev) {
  if (tab.term) {
    if (!tab.term.out.textContent) tab.term.out.remove();
    var meta = el('div', 'meta');
    var bits = [];
    if (ev.tope) bits.push('<span class="term-err">Cortado: pasó los 5 minutos</span>');
    else if (ev.detenido) bits.push('<span>Detenido</span>');
    else if (ev.codigo) bits.push('<span class="term-err">Salió con código ' + esc(ev.codigo) + '</span>');
    if (typeof ev.segundos === 'number') bits.push('<span>' + ev.segundos + ' s</span>');
    if (bits.length) { meta.innerHTML = bits.join(''); tab.term.el.appendChild(meta); }
    tab.term = null;
  }
  if (ev.cwd) tab.cwd = ev.cwd;
  if (tab === state.active) paintTerminal();
  setBusy(tab, false);
  toBottom(false, tab);
}
els.model.addEventListener('change', function () {
  if (state.active) state.active.modelo = els.model.value;
  els.input.focus();
});
els.effort.addEventListener('change', function () {
  if (state.active) state.active.esfuerzo = els.effort.value;
  state.esfuerzo = els.effort.value;
  els.input.focus();
});
