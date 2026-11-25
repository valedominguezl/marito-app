/* Marito v3 — Estado compartido, utilidades, llamadas al servidor (api/upload/host) e íconos.
   Script clásico: comparte el ámbito global con los demás de ui/ (ver el orden en index.html). */
'use strict';

var qs = new URLSearchParams(location.search);
var DEMO = qs.has('demo');
var TOKEN = qs.get('t') || '';
var LIBRE = 'Chat libre';
// Esta pantalla (la ventana de la PC o el celular): el servidor le devuelve su propio mensaje con este id para no dibujarlo dos veces.
var CLIENTE = Math.random().toString(36).slice(2, 10);
var REMOTO = false; // abierta desde el celular (por Tailscale): sin ventana de Windows alrededor
var FIJO = false;   // el servidor queda prendido al cerrar la ventana
var TACTIL = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

function $(sel) { return document.querySelector(sel); }
var els = {
  btnPush: $('#btn-push'), pushMenu: $('#push-menu'), optCommit: $('#opt-commit'), optPush: $('#opt-push'),
  bar: $('#bar'), tabs: $('#tabs'), tabs2: $('#tabs2'), tabRow: $('#tab-row'), tabsPrev: $('#tabs-prev'), tabsNext: $('#tabs-next'), model: $('#model'), effort: $('#effort'),
  btnHist: $('#btn-hist'), histMenu: $('#hist-menu'), btnTerm: $('#btn-term'), composer: $('#composer'),
  scroll: $('#scroll'), feeds: $('#feeds'), input: $('#input'), send: $('#send'),
  thumbs: $('#thumbs'), lightbox: $('#lightbox'), lightboxImg: $('#lightbox-img'),
  btnNew: $('#btn-new'), btnPin: $('#btn-pin'), btnMin: $('#btn-min'), btnMax: $('#btn-max'), btnClose: $('#btn-close'),
  btnAttach: $('#btn-attach'), btnMic: $('#btn-mic'), micMenu: $('#mic-menu'), optDictar: $('#opt-dictar'), optCharla: $('#opt-charla'),file: $('#file'), dropzone: $('#dropzone'), edges: $('#edges'),
  ctxRow: $('#ctx-row'), ctx: $('#ctx'), ctxN: $('#ctx-n'), ctxFill: $('#ctx-fill'), btnChain: $('#btn-chain'),
  subRow: $('#sub-row'), pinned: $('#pinned'), btnFondo: $('#btn-fondo'), fondoPanel: $('#fondo-panel'),
  btnBarra: $('#btn-barra'), btnGrande: $('#btn-grande'), btnContinuar: $('#btn-continuar'), tarjeta: $('#tarjeta'), composerWrap: $('#composer-wrap')
};
var CTX_MAX = 200000;   // ventana de contexto de referencia (el aro se llena contra esto)
var CTX_AVISO = 150000; // desde acá conviene Terminemos

var state = {
  proyectos: [],
  modelos: [],
  modelo: '',
  esfuerzos: [],
  esfuerzo: '',
  tabs: [],           // pestañas en orden
  byId: {},
  active: null,
  replaying: false,   // mientras el servidor reenvía el historial no se avisa nada
  windowMode: 'normal',
  cardTab: null,      // modo barra: la pestaña cuya respuesta se ve en la tarjeta de abajo
  openCards: []      // tarjetas de publicación que todavía no terminaron
};

/* ---------- Utilidades ---------- */

// Mensajes al host (WebView2). Fuera del WebView2 no existe: no hace nada.
function host(msg) {
  try { if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(msg); } catch (e) { /* sin host */ }
}

function withToken(url) {
  if (!url || /^(data|blob):/.test(url) || !TOKEN) return url;
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + encodeURIComponent(TOKEN);
}

function handle(res) {
  return res.json().catch(function () { return null; }).then(function (data) {
    if (!res.ok) {
      var err = new Error((data && (data.error || data.texto)) || 'Error ' + res.status);
      err.status = res.status;
      throw err;
    }
    return data;
  });
}
function api(path, method, body) {
  if (DEMO) return window.__demo.api(path, method || 'GET', body);
  var headers = { 'X-Token': TOKEN };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(path, { method: method || 'GET', headers: headers, body: body !== undefined ? JSON.stringify(body) : undefined }).then(handle);
}
// Sube un archivo tal cual (sin base64): el nombre va en X-Nombre.
function upload(file, nombre, origen) {
  if (DEMO) return window.__demo.api('/api/adjunto', 'POST', { nombre: nombre, tipo: file.type, tamano: file.size, blob: file });
  return fetch('/api/adjunto', {
    method: 'POST',
    headers: { 'X-Token': TOKEN, 'X-Nombre': encodeURIComponent(nombre), 'X-Origen': origen || 'archivo', 'Content-Type': 'application/octet-stream' },
    body: file
  }).then(handle);
}

function el(tag, cls, html) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

var ICON = {
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/>',
  terminal: '<path d="m5 8 4 4-4 4"/><path d="M12 17h7"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  write: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M12 11v6M9 14h6"/>',
  agent: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  warn: '<path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/>',
  dot: '<circle cx="12" cy="12" r="2"/>',
  sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 13h7M8.5 16.5h5"/>',
  text: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 12h7M8.5 15h7M8.5 18h4"/>',
  max: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  restore: '<rect x="5" y="9" width="10" height="10" rx="2"/><path d="M9 9V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/>'
};
function svg(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[name] + '</svg>'; }

// Markdown de un bloque de texto, con un botón «Copiar» en cada bloque de código (como en VS Code).
// Las etiquetas [MARCAR:...] y [LUEGO:...] son para la ventana (dibuja el recuadro en la pantalla, ahora o en el paso
// siguiente), [MAS:…] para su cartel, [RUEDA:…] para un paso de desplazarse y [CONECTORES] para el servidor (carga los MCP): no se muestran; tampoco una que se
// está escribiendo. Las de la marca completas dejan un carácter invisible (PASO_1 / PASO_N) para encontrar después
// los renglones del paso a paso (`marcarPasos`).
var PASO_1 = '', PASO_N = '';
function sinMarcas(s) {
  return s.replace(/\n?[ \t]*\[(MARCAR|LUEGO):[^\]\n]*(\])?/g, function (m, tipo, cierre) { return cierre ? (tipo === 'MARCAR' ? PASO_1 : PASO_N) : ''; })
    .replace(/[ \t]*\[MAS:[^\]\n]*\]?/g, '').replace(/[ \t]*\[RUEDA:[^\]\n]*\]?/g, '').replace(/\n?[ \t]*\[CONECTORES\]/g, '')
    .replace(/\[(?:M(?:A(?:R(?:C(?:A(?:R)?)?)?|S)?)?)?$/, '').replace(/\[L(?:U(?:E(?:G(?:O)?)?)?)?$/, '').replace(/\[R(?:U(?:E(?:D(?:A)?)?)?)?$/, '')
    .replace(/\[C(?:O(?:N(?:E(?:C(?:T(?:O(?:R(?:E(?:S)?)?)?)?)?)?)?)?)?$/, '');
}
// Los renglones (o párrafos) que llevaban una etiqueta de la marca quedan con la clase `paso` (`paso-1` el del
// [MARCAR], donde arranca cada lista) y sin el carácter invisible.
function marcarPasos(root) {
  if (!/[]/.test(root.textContent)) return;
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n, nodos = [];
  while ((n = walker.nextNode())) if (/[]/.test(n.nodeValue)) nodos.push(n);
  nodos.forEach(function (nodo) {
    var host = nodo.parentNode.closest('li, p');
    if (!host || !root.contains(host)) host = nodo.parentNode;
    host.classList.add('paso');
    if (nodo.nodeValue.indexOf(PASO_1) >= 0) host.classList.add('paso-1');
    nodo.nodeValue = nodo.nodeValue.replace(/[]/g, '');
  });
}
function paintMd(b) {
  b.el.innerHTML = window.renderMarkdown(sinMarcas(b.raw)); b.dirty = false;
  marcarPasos(b.el);
  Array.prototype.forEach.call(b.el.querySelectorAll('pre'), function (pre) {
    var w = el('div', 'code-block'); pre.parentNode.insertBefore(w, pre); w.appendChild(pre);
    var btn = el('button', 'code-copy', svg('copy')); btn.type = 'button'; btn.title = 'Copiar'; btn.setAttribute('aria-label', 'Copiar código');
    w.appendChild(btn);
  });
}
document.addEventListener('click', function (e) {
  var btn = e.target.closest && e.target.closest('.code-copy');
  if (!btn) return;
  var texto = btn.parentNode.querySelector('pre').innerText.replace(/\n$/, '');
  var hecho = function () { btn.innerHTML = svg('check'); btn.classList.add('done'); setTimeout(function () { btn.innerHTML = svg('copy'); btn.classList.remove('done'); }, 1200); };
  if (navigator.clipboard) navigator.clipboard.writeText(texto).then(hecho, function () { toast('No pude copiar.'); });
});

var TOOLS = {
  Read: ['Leyendo', 'file'], Grep: ['Buscando', 'search'], Glob: ['Buscando archivos', 'search'],
  Bash: ['Ejecutando', 'terminal'], PowerShell: ['Ejecutando', 'terminal'], Edit: ['Editando', 'edit'], MultiEdit: ['Editando', 'edit'],
  Write: ['Escribiendo', 'write'], Agent: ['Agente', 'agent'], Task: ['Agente', 'agent'],
  Conectores: ['Cargando conectores', 'dot'], WebFetch: ['Leyendo web', 'search'], WebSearch: ['Buscando en la web', 'search'], NotebookEdit: ['Editando', 'edit']
};

function projectLabel(p) { return p ? p : LIBRE; }

var DOT_COLORS = ['#d97757', '#6a9bcc', '#788c5d', '#b08bd0', '#c9a227', '#4fa3a5'];
function dotColor(name) {
  if (!name) return 'var(--text-3)';
  var h = 0;
  for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return DOT_COLORS[h % DOT_COLORS.length];
}

function fmtSize(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}
function fileIcon(a) {
  var n = (a.nombre || '').toLowerCase();
  if (/\.pdf$/.test(n)) return 'pdf';
  if (/\.(xlsx?|csv|ods)$/.test(n)) return 'sheet';
  if (/\.(txt|md|json|docx?|rtf|log|xml|html?|js|ts|py)$/.test(n)) return 'text';
  return 'file';
}
