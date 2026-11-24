// Marito: lógica pura de server.mjs (sin tocar disco, red ni procesos), separada para poder probarla (tests/).
// server.mjs la importa; no cambia el comportamiento.

import path from 'node:path';
import crypto from 'node:crypto';

export const TOPE_HISTORIAL = 60;          // conversaciones guardadas
export const TOPE_EVENTOS_HISTORIAL = 600; // eventos por conversación (para volver a dibujarla)

// Texto corto de lo que hizo una herramienta de claude, con rutas relativas a la carpeta del proyecto.
export function toolDetail(name, input, cwd) {
  input = input || {};
  const rel = (p) => {
    if (!p) return '';
    const n = String(p).replace(/\\/g, '/');
    const c = cwd.replace(/\\/g, '/').replace(/\/?$/, '/');
    return n.toLowerCase().startsWith(c.toLowerCase()) ? n.slice(c.length) : n;
  };
  const corto = (s, n = 90) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  if (input.file_path) return rel(input.file_path);
  if (input.notebook_path) return rel(input.notebook_path);
  if (name === 'Agent' || name === 'Task') return corto(input.description || input.prompt);
  if (input.pattern) return corto(input.pattern);
  if (input.command) return corto(input.command);
  if (input.description) return corto(input.description);
  if (input.url) return corto(input.url);
  if (input.query) return corto(input.query);
  if (input.path) return rel(input.path);
  return '';
}

// Nombre de adjunto sin rutas ni caracteres prohibidos en Windows (evita salirse de la carpeta de adjuntos).
export function nombreSeguro(n) {
  n = path.basename(String(n || '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').trim();
  return (n || 'archivo').slice(-90);
}

// Tokens de contexto que usó un llamado de claude (lo que entró, leído de caché o no, más lo que escribió).
export function contextoDe(usage) {
  if (!usage) return 0;
  return (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.output_tokens || 0);
}

// Título de la pestaña: el primer mensaje, en una línea y de hasta 60 caracteres.
export function tituloDe(texto) {
  return texto.replace(/\s+/g, ' ').slice(0, 60);
}

// Argumentos de `claude -p` para un turno.
// `sinMcp`: sin conectores (windows-mcp tarda 2 s en conectar en cada llamado); se cargan solo si Claude los pide.
// `entradaJson`: el mensaje va por stdin como stream-json (lleva la captura de la pantalla como imagen).
export function argsClaude({ modelo, instrucciones, esfuerzo, libre, discos, sessionId, sinMcp, entradaJson }) {
  // El push lo hace la ventana después del turno (con su tope y su confirmación): que Claude no pueda, además de no deber.
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', modelo,
    '--permission-mode', 'auto', '--disallowedTools', 'Bash(git push:*)', 'PowerShell(git push:*)', '--append-system-prompt', instrucciones];
  if (entradaJson) args.push('--input-format', 'stream-json');
  if (sinMcp) args.push('--strict-mcp-config');
  if (esfuerzo) args.push('--effort', esfuerzo);
  if (libre) args.push('--add-dir', ...discos);
  if (sessionId) args.push('--resume', sessionId);
  return args;
}

// ¿El mensaje es sobre lo que hay en la pantalla? Entonces el servidor la mira mientras arranca claude y se la pasa en el
// mensaje (lista de controles + captura). Las preguntas de «cómo hago / dónde está / cómo cierro», los pedidos de guía
// y lo que manda la marca al tocarla («Listo, ya lo toqué», volver a un paso). Un texto largo es otra cosa (un pedido
// de código con «cómo» adentro): ahí mira Claude si le hace falta.
export function pareceDePantalla(texto) {
  const t = String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/^(listo, ya lo toque|quiero volver al tutorial)/.test(t)) return true;
  if (t.length > 200) return false;
  return /\b(como|donde)\b|\b(mostrame|guiame|ensename|senalame|marcame)\b|\bque (toco|aprieto|boton)\b|\b(cierro|abro|activo|desactivo|apago|prendo|clic|click|toco)\b/.test(t);
}

// Claude pidió los conectores: la etiqueta [CONECTORES] sola en un renglón (mencionada en una frase no cuenta).
export function pideConectores(texto) {
  return /(^|\n)[ \t]*\[CONECTORES\][ \t]*(\n|$)/.test(String(texto || ''));
}

// Claude pide pasar la conversación a otro proyecto: [PROYECTO:nombre o carpeta] sola en el último renglón con algo
// ([PROYECTO:] = Chat libre). Devuelve lo de adentro, o null si no la pidió (mencionada en una frase no cuenta).
export function pideProyecto(texto) {
  const m = /(?:^|\n)[ \t]*\[PROYECTO:([^\]\n]*)\][ \t]*$/.exec(String(texto || '').trimEnd());
  return m ? m[1].trim() : null;
}

// El proyecto que nombró Claude, entre los que hay (`lista`: [{ nombre, carpeta }]): por nombre (sin acentos ni
// mayúsculas), por carpeta o por el último pedazo de la carpeta. '' = Chat libre; null = no lo encontré.
export function elegirProyecto(pedido, lista) {
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\\/]+$/, '').trim();
  const q = norm(pedido);
  if (!q || q === 'chat libre' || q === 'ninguno') return '';
  const base = (c) => norm(c).split(/[\\/]/).pop();
  const p = lista.find((x) => norm(x.nombre) === q) || lista.find((x) => norm(x.carpeta) === q)
    || lista.find((x) => base(x.carpeta) === q || base(x.nombre) === q);
  return p ? p.nombre : null;
}

// Entrada del historial para una conversación (sin los pedidos de confirmación, con tope de eventos y sin `conv`).
export function entradaHistorial(c, ahora = new Date()) {
  return { sessionId: c.sessionId, proyecto: c.proyecto, sitio: c.sitio, url: c.url, titulo: c.titulo, fecha: ahora.toISOString(),
    cadena: c.cadena || '', modelo: c.modelo || '',
    eventos: c.historial.filter((ev) => ev.tipo !== 'publicar-confirmar').slice(-TOPE_EVENTOS_HISTORIAL).map(({ conv, ...ev }) => ev) };
}

// La conversación va primera (sin duplicar su sesión) y la lista tiene tope.
export function sumarAlHistorial(lista, entrada) {
  return [entrada, ...lista.filter((x) => x.sessionId !== entrada.sessionId)].slice(0, TOPE_HISTORIAL);
}

// Cómo se publica: 'deploy' (por defecto), 'github' (solo push) o 'no' (queda en la compu; también sin remoto «origin»).
export function modoPublicacion(proy, sinRemoto) {
  return sinRemoto ? 'no' : (['github', 'no'].includes(proy.publicar) ? proy.publicar : 'deploy');
}

// Al abrir la ventana con el servidor fijo, qué pestañas siguen (pedido del usuario el 24/11, como al arrancar el
// servidor): las que tienen algo escrito sin mandar, las que trabajan o esperan algo (turno, comando, «¿Publico igual?»,
// un deploy siguiéndose, commits para «Publicar ahora») y las que terminaron algo con la ventana cerrada (no se vio en la
// PC). El resto se cierra: queda en el historial.
const PASOS_FINALES = ['publicado', 'fallo', 'sin-deploy', 'tope', 'cancelado', 'local'];
export function quedaAlAbrir(c, { borrador = '', ventanaCerradaEn = 0 } = {}) {
  if (String(borrador).trim()) return true;
  if (c.turno || c.arrancando || c.confirmacion || c.comando || c.pendiente) return true;
  if (!c.finEn) return false; // ningún turno terminó en este arranque (vacía o reabierta del historial)
  // Un paso sin terminar que viene de otro arranque (se apagó a mitad de un deploy) no cuenta: finEn es de este.
  const pub = (c.historial || []).filter((ev) => ev.tipo === 'publicacion').pop();
  if (pub && !PASOS_FINALES.includes(pub.paso)) return true;
  return c.finEn > ventanaCerradaEn;
}

// Qué hacer cuando termina un turno: nada, dejar el commit sin push (manual) o publicar solo.
export function accionTrasTurno({ cambio, ok, cerrando, abierta, push }) {
  if (!(cambio && ok && !cerrando && abierta)) return 'nada';
  return push ? 'auto' : 'manual';
}

// Motivos por los que hay que pedir confirmación antes de publicar (rama distinta o commits ajenos).
export function motivosPublicar({ proy, rama, ajenos }) {
  const motivos = [];
  if (proy.rama && rama !== proy.rama) motivos.push(`El repo está en la rama «${rama}», no en «${proy.rama}».`);
  // Proyecto nuevo (sin rama anotada) que publica en otra: el commit de «feature/x» saldría a «main» sin preguntar.
  else if (!proy.rama && proy.publicarEn && rama !== proy.publicarEn) motivos.push(`El repo está en la rama «${rama}» y se publica en «${proy.publicarEn}».`);
  if (ajenos.length) motivos.push(`Además del arreglo salen ${ajenos.length} commits que no estaban publicados:\n` + ajenos.slice(0, 12).join('\n'));
  return motivos;
}

// Host de un sitio o URL, en minúsculas y sin esquema, puerto ni «www.».
export function hostDe(sitio) {
  return String(sitio || '').toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/^www\./, '');
}

// Si el sitio es genérico (vacío, una IP o uno de la lista de genericos.json).
export function esGenericoEn(sitio, lista) {
  const host = hostDe(sitio);
  if (!host) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return true;
  return lista.some((g) => host === g || host.endsWith('.' + g));
}

// ---------- Acceso desde el celular (modo fijo, por Tailscale) ----------

// Direcciones de Tailscale: 100.64.0.0/10.
export function esIpTailscale(ip) {
  const m = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || ''));
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127 && Number(m[2]) <= 255 && Number(m[3]) <= 255;
}

// Si un pedido que llegó por la dirección de Tailscale de la PC se atiende: solo desde la IP del teléfono (Tailscale
// la ata a la clave del aparato, no se puede falsificar), con un Host que sea esta PC (la IP o su nombre de Tailscale,
// nunca un dominio ajeno: frena el DNS rebinding) y, si trae Origin, que sea el mismo sitio (frena pedidos de otras páginas).
export function accesoRemoto({ ip, host, origen, telefono, ipLocal, puerto }) {
  ip = String(ip || '').replace(/^::ffff:/, '');
  if (!telefono || !esIpTailscale(telefono) || ip !== telefono) return false;
  const m = /^([a-z0-9.-]+):(\d+)$/i.exec(String(host || ''));
  if (!m || Number(m[2]) !== Number(puerto)) return false;
  const nombre = m[1].toLowerCase();
  const esEstaPc = nombre === ipLocal || /^[a-z0-9-]+$/.test(nombre) || /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(nombre);
  if (!esEstaPc) return false;
  return !origen || origen === `http://${host}`;
}

// La clave del celular (remoto.json `clave`), además de la IP: cualquier app instalada en el teléfono sale por Tailscale
// con esa misma IP, así que la IP sola no alcanza. La trae la app de Android (header X-Clave) o el navegador del
// teléfono (cookie `marito`, que queda al abrir una vez el link de vinculación `/?c=<clave>`).
export function claveDe({ header, cookie, query }) {
  const m = /(?:^|;\s*)marito=([^;]+)/.exec(String(cookie || ''));
  return String(header || '') || (m ? m[1] : '') || String(query || '');
}
export function claveValida(dada, clave) {
  const a = Buffer.from(String(dada || '')), b = Buffer.from(String(clave || ''));
  return b.length >= 16 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Marca en la pantalla ([MARCAR:n] o [MARCAR:x,y,an,al:texto] al final de una respuesta) ----------

// Las etiquetas completas que hay en el texto de una respuesta, en orden: [{ inicio, fin, valor }].
export function marcasEn(texto) {
  const out = [];
  for (const m of String(texto || '').matchAll(/\[MARCAR:([^\]\n]{1,120})\]/g)) out.push({ inicio: m.index, fin: m.index + m[0].length, valor: m[1].trim() });
  return out;
}

// Los pasos que siguen, pensados de una con el primero: [LUEGO:nombre del control] al final de cada renglón. Cuando
// el usuario toca el recuadro, el servidor busca ese nombre en la pantalla nueva y marca solo, sin preguntarle a Claude.
// [{ nombre, texto, mas, alTocar }] en orden; `texto` es el renglón del paso sin el número ni la etiqueta.
export function pasosEn(texto) {
  const t = String(texto || '');
  const out = [];
  for (const m of t.matchAll(/\[LUEGO:([^\]\n]{1,120})\]/g)) {
    const nombre = m[1].trim().replace(/^[«"']+|[»"']+$/g, '').trim();
    if (nombre) out.push({ nombre, texto: renglonDe(t, m.index), ...masDe(t, m.index) });
  }
  return out;
}

// Lo que el cartel muestra al abrirse (la marca que enseña): [MAS:explicación | qué pasa al tocar] en el renglón del
// paso. Solo cuenta completa (con el corchete de cierre). { mas, alTocar }, vacíos si no está.
export function masDe(texto, i) {
  const t = String(texto || '');
  const ini = t.lastIndexOf('\n', i - 1) + 1;
  let fin = t.indexOf('\n', i); if (fin < 0) fin = t.length;
  const m = /\[MAS:([^\]\n]{1,700})\]/.exec(t.slice(ini, fin));
  if (!m) return { mas: '', alTocar: '' };
  const limpio = (s) => String(s || '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().replace(/^al tocar\s*:\s*/i, '');
  const [mas, ...resto] = m[1].split('|');
  return { mas: limpio(mas), alTocar: limpio(resto.join('|')) };
}

// El renglón donde está una etiqueta, sin el número de la lista, la viñeta ni las etiquetas: el paso. '' si la
// etiqueta está sola en su renglón (el paso es lo que escribió antes).
export function renglonDe(texto, i) {
  const t = String(texto || '');
  const ini = t.lastIndexOf('\n', i - 1) + 1;
  let fin = t.indexOf('\n', i); if (fin < 0) fin = t.length;
  return t.slice(ini, fin).replace(/\[(MARCAR|LUEGO|MAS|CONECTORES)[^\]\n]*(\]|$)/g, '') // también una a medio escribir
    .replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '').replace(/\*\*/g, '').trim();
}

// Un nombre para comparar: sin mayúsculas, acentos, comillas, «…», atajos («(Ctrl+S)») ni el & de las teclas de acceso.
export function normalizarNombre(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ').replace(/[&«»"'“”‘’…:]/g, '').replace(/\.{3}/g, '').replace(/\s+/g, ' ').trim();
}

// El control (o texto leído) de una captura que se llama así. Primero los de nombre igual, después los que lo tienen
// como palabras enteras (solo si hay uno). Entre varios iguales: el de la ventana de más adelante (`z`), el que no
// estaba en la captura anterior (lo que apareció al tocar: un menú, un diálogo), el habilitado y el control antes que
// el texto leído. null si no está: mejor preguntarle a Claude que marcar cualquier cosa.
// `lugar` (volver a un paso ya marcado): si el de ese nombre sigue en el mismo lugar, es ese.
export function buscarControl(captura, nombre, anterior = null, lugar = null) {
  const buscado = normalizarNombre(nombre);
  if (!buscado) return null;
  const lista = (captura?.controles || []).filter((c) => c.w > 0 && c.h > 0 && c.nombre);
  const quieto = lugar && lista.find((c) => normalizarNombre(c.nombre) === buscado && Math.abs(c.x - lugar.x) <= 3 && Math.abs(c.y - lugar.y) <= 3
    && Math.abs(c.w - lugar.w) <= 3 && Math.abs(c.h - lugar.h) <= 3);
  if (quieto) return quieto;
  const antes = new Set((anterior?.controles || []).map((c) => `${normalizarNombre(c.nombre)}|${c.x}|${c.y}`));
  const puntaje = (c) => (c.z ?? 0) * 4 + (antes.has(`${normalizarNombre(c.nombre)}|${c.x}|${c.y}`) ? 2 : 0)
    + (c.habilitado === false ? 1 : 0) + (c.tipo === 'Texto' ? 0.5 : 0);
  const mejor = (xs) => xs.sort((a, b) => puntaje(a) - puntaje(b))[0];
  const junto = buscado.replace(/ /g, ''); // el OCR a veces parte o junta palabras
  const iguales = lista.filter((c) => { const n = normalizarNombre(c.nombre); return n === buscado || n.replace(/ /g, '') === junto; });
  if (iguales.length) return mejor(iguales);
  const palabras = new RegExp(`(^| )${buscado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
  const contienen = lista.filter((c) => palabras.test(normalizarNombre(c.nombre)));
  return contienen.length === 1 ? contienen[0] : null;
}

// El lugar en la pantalla (píxeles reales) de una etiqueta, con la lista de la última captura (pN.json de marcar.ps1):
// un número de la lista, una caja en fracciones de la captura o el nombre del control. null si no sirve: señalar mal
// es peor que no señalar.
export function resolverMarca(valor, captura) {
  const p = captura?.pantalla;
  if (!p || !(p.w > 0) || !(p.h > 0)) return null;
  const v = String(valor || '').trim();
  if (/^\d+$/.test(v)) {
    const c = (captura.controles || []).find((x) => x.n === Number(v));
    return c && c.w > 0 && c.h > 0 ? { x: c.x, y: c.y, w: c.w, h: c.h, nombre: c.nombre || '' } : null;
  }
  const m = /^([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?::\s*(.*))?$/.exec(v);
  if (!m) {
    // Un nombre («[MARCAR:Rectangle]»), pero no la plantilla copiada tal cual («x,y,ancho,alto:…»).
    if (/^x\s*,/i.test(v)) return null;
    const c = buscarControl(captura, v);
    return c ? { x: c.x, y: c.y, w: c.w, h: c.h, nombre: c.nombre } : null;
  }
  let [fx, fy, fw, fh] = m.slice(1, 5).map(Number);
  if (![fx, fy, fw, fh].every(Number.isFinite) || fx > 1 || fy > 1 || fw <= 0 || fh <= 0) return null;
  fw = Math.min(fw, 1 - fx); fh = Math.min(fh, 1 - fy);
  if (fw * fh > 0.25) return null; // una «caja» así de grande es la ventana entera
  const x = Math.round(p.x + fx * p.w), y = Math.round(p.y + fy * p.h);
  return { x, y, w: Math.max(8, Math.round(fw * p.w)), h: Math.max(8, Math.round(fh * p.h)), nombre: (m[5] || '').trim() };
}

// El texto del cartel: la primera oración del paso (la acción: «Tocá «Archivo», arriba a la izquierda.»); el resto lo
// dice la voz y queda en el chat. Si es muy larga se corta en una coma o entre palabras, nunca a mitad de palabra.
export const TOPE_CARTEL = 110;
export function fraseMarca(paso) {
  const t = textoHablado(paso);
  const m = /^.+?[.!?…](?=\s|$)/.exec(t);
  let f = (m ? m[0] : t).trim();
  if (f.length <= TOPE_CARTEL) return f;
  f = f.slice(0, TOPE_CARTEL);
  const coma = f.lastIndexOf(', ');
  return (coma > 40 ? f.slice(0, coma) : f.slice(0, f.lastIndexOf(' '))).replace(/[,;:]$/, '') + '…';
}

// ---------- La voz: qué se lee en voz alta y en qué pedazos ----------

// Markdown → lo que se dice: sin bloques de código ni tablas (quedan en el chat), sin etiquetas, links por su texto.
export function textoHablado(md) {
  return String(md || '')
    .replace(/```[\s\S]*?(```|$)/g, '\n')
    .replace(/\[(MARCAR|LUEGO|MAS|CONECTORES)[^\]\n]*\]/g, '')
    .split('\n').filter((l) => !/^\s*\|/.test(l)).join('\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'el link')
    // Atajos de teclado como se dicen («Ctrl+S» → «control S»): si no, la voz lee cualquier cosa.
    .replace(/\b(?:Ctrl|Control|Alt|Shift|Mayús|Win|Cmd)(?:\s*\+\s*(?:Ctrl|Control|Alt|Shift|Mayús|Win|Cmd|Esc|Enter|Tab|F\d{1,2}|[A-Za-z0-9]))+\b/g,
      (m) => m.split(/\s*\+\s*/).map((k) => ({ Ctrl: 'control', Control: 'control', Esc: 'escape', Win: 'Windows', Cmd: 'comando' }[k] || k)).join(' '))
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/[*_`~]/g, '')
    // Cada renglón (título, viñeta, párrafo) termina en pausa: si no trae su punto, se le pone.
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
    .map((l) => (/[.!?…:;,]["»”)]*$/.test(l) ? l : l + '.')).join(' ')
    .trim();
}

// Cuánto del texto que va llegando ya se puede decir: hasta el último fin de oración o de renglón, sin cortar un bloque
// de código abierto. Devuelve la longitud del pedazo listo (0 = todavía nada).
export function cortarHablable(md) {
  const s = String(md || '');
  let fin = 0;
  for (const m of s.matchAll(/[.!?…:](?=\s)|\n/g)) {
    const corte = m.index + m[0].length;
    if (((s.slice(0, corte).match(/```/g) || []).length % 2) === 0) fin = corte;
  }
  return fin;
}

// Texto ya hablado → frases para la voz, de a una por pedido (así la primera suena mientras se arma la siguiente).
// Las muy cortas se juntan con la que sigue (cada pedido tiene su costo fijo) y las muy largas se parten en comas.
export function partirFrases(texto, { corta = 30, larga = 220 } = {}) {
  const base = String(texto || '').match(/[^.!?…]+[.!?…]+["»”)]*|[^.!?…]+$/g) || [];
  const out = [];
  let junta = '';
  for (let f of base.map((x) => x.trim()).filter((x) => /[\p{L}\p{N}]/u.test(x))) {
    while (f.length > larga) {
      const i = Math.max(f.lastIndexOf(', ', larga), f.lastIndexOf(': ', larga), f.lastIndexOf('; ', larga));
      const cut = i > 40 ? i + 1 : f.lastIndexOf(' ', larga) > 0 ? f.lastIndexOf(' ', larga) : larga;
      out.push(((junta ? junta + ' ' : '') + f.slice(0, cut)).trim()); junta = '';
      f = f.slice(cut).trim();
    }
    junta = junta ? junta + ' ' + f : f;
    if (junta.length >= corta) { out.push(junta); junta = ''; }
  }
  if (junta) out.push(junta);
  return out;
}

// Lo que GitHub dice de un commit (`gh api …/status` y `…/check-runs`, cada uno { ok, out }). `valida` es falso si
// alguna de las dos consultas falló o vino rota: una lista vacía por un `gh` caído no quiere decir «no hay deploy».
export function leerChecks(st, cr) {
  const items = [];
  try {
    if (!st.ok) throw new Error('status');
    // `cancelado`: no es que falló (Vercel cancela el deploy de un commit cuando llega uno más nuevo).
    for (const s of JSON.parse(st.out || '{}').statuses || []) {
      items.push({ nombre: s.context, fin: s.state !== 'pending', bien: s.state === 'success', cancelado: s.state !== 'success' && /cancel/i.test(s.description || '') });
    }
    if (!cr.ok) throw new Error('check-runs');
    for (const c of JSON.parse(cr.out || '{}').check_runs || []) {
      items.push({ nombre: c.name, fin: c.status === 'completed', bien: ['success', 'neutral', 'skipped'].includes(c.conclusion), cancelado: c.conclusion === 'cancelled' });
    }
  } catch { return { valida: false, items: [] }; }
  return { valida: true, items };
}

// Qué checks son el deploy. Con filtro (aprendido o puesto a mano), los que lo nombran. Sin filtro, si hay alguno que
// parece de una plataforma de deploy se siguen solo esos (CodeQL o los tests no son el deploy) y de ahí sale el nombre que
// se aprende; si ninguno lo parece se miran todos pero no se aprende nada (antes se aprendía el primero, fuera lo que fuera).
const PARECE_DEPLOY = /vercel|netlify|railway|render|cloudflare|workers|pages|fly\.io|heroku|firebase|amplify|deploy/i;
export function checksDeploy(items, filtro) {
  if (filtro) return { items: items.filter((i) => i.nombre.toLowerCase().includes(filtro.toLowerCase())), aprender: '' };
  const dep = items.filter((i) => PARECE_DEPLOY.test(i.nombre));
  return dep.length ? { items: dep, aprender: dep[0].nombre.split(/:| - /)[0].trim() } : { items, aprender: '' };
}

// En qué quedó el deploy: 'fallo' (alguno falló de verdad: se avisa sin esperar a los demás), 'cancelado' (terminaron
// todos, ninguno bien y alguno cancelado), 'publicado' (terminaron todos; los cancelados no cuentan si otro salió bien)
// o 'armando'. `item`: el que da el nombre del aviso.
export function estadoDeploy(items) {
  const falla = items.find((i) => i.fin && !i.bien && !i.cancelado);
  if (falla) return { estado: 'fallo', item: falla };
  if (items.some((i) => !i.fin)) return { estado: 'armando' };
  if (!items.some((i) => i.bien)) return { estado: 'cancelado', item: items.find((i) => i.cancelado) };
  return { estado: 'publicado' };
}
