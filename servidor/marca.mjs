// Marca en la pantalla y tutorial paso a paso (marcar.ps1; etiquetas [MARCAR]/[LUEGO]/[MAS] de la respuesta de claude).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buscarControl, fraseMarca, marcasEn, masDe, pasosEn, quedoIgual, renglonDe, resolverMarca, ruedaDe, textoHablado, zonasComparar } from '../servidor-logica.mjs';
import { contarCambios, leerPng } from './png.mjs';
import { AQUI } from './constantes.mjs';
import { difundir, emit } from './conversaciones.mjs';
import { convs, estado, log, pantallasDir } from './estado.mjs';
import { killTree, readJsonFile } from './utilidades.mjs';
import { cerrarLocucion, decir, motorVoz, nuevaLocucion } from './voz.mjs';

// ---- marca en la pantalla ----
// marcar.ps1 deja en pantallasDir una captura y la lista de controles (pN.png, pN.json) cada vez que Claude mira la
// pantalla; con la etiqueta de su respuesta se busca el lugar y se dibuja el recuadro (otro marcar.ps1, -Mostrar).
// Hay una sola marca a la vez. Claude piensa todos los pasos de una ([MARCAR:n] el primero, [LUEGO:nombre] los que
// siguen): cuando el usuario toca el recuadro, el servidor mira la pantalla nueva y marca solo el siguiente. Si no
// lo encuentra, o si Claude marcó un solo paso, la UI manda «Listo, ya lo toqué.» y Claude sigue.
// Esa lista es un **tutorial** (c.tuto, la marca que enseña): el cartel abierto muestra «PASO 2 DE 5», la explicación y
// qué pasa al tocar ([MAS:…] de cada renglón), y se puede salir (el botón del cartel, Esc, otro click, un mensaje
// nuevo, el chat) y volver al mismo paso desde el chat (`POST /api/tutorial`). La UI lo sigue con el SSE `tutorial`.

function ultimaCaptura() {
  let n = 0;
  try { for (const f of fs.readdirSync(pantallasDir)) { const m = /^p(\d+)\.json$/.exec(f); if (m) n = Math.max(n, Number(m[1])); } } catch { return null; }
  if (!n) return null;
  const d = readJsonFile(path.join(pantallasDir, `p${n}.json`), null);
  return d ? { ...d, n } : null;
}

// Saca el recuadro. El tutorial al que pertenecía queda en pausa (se vuelve desde el chat).
export function ocultarMarca() {
  if (!estado.marca) return;
  const m = estado.marca;
  m.sacada = true; killTree(m.proc.pid); estado.marca = null;
  pausarTuto(convs.get(m.conv), m.tu);
}

// c.tuto = { id, t, k, desde, inicio, paso, pausado, fin, primero: { lugar, captura, texto } }: `t` es el turno de
// Claude con la lista (el texto sigue llegando mientras se marca el primero), `k` cuál [MARCAR] del turno es (la UI
// resalta esos renglones), `desde` dónde siguen los [LUEGO], `paso` el que toca (0 = el del [MARCAR]).
const pasosDe = (tu) => pasosEn(tu.t.texto.slice(tu.desde));

function pasoDel(tu, i) {
  if (i === 0) return { nombre: tu.primero.lugar.nombre || '', texto: tu.primero.texto, ...masDe(tu.t.texto, tu.inicio), rueda: ruedaDe(tu.t.texto, tu.inicio) };
  return pasosDe(tu)[i - 1] || null;
}

// Lo del cartel abierto de ese paso.
function infoPaso(tu) {
  const p = pasoDel(tu, tu.paso) || {};
  return { paso: tu.paso + 1, total: 1 + pasosDe(tu).length, mas: p.mas || '', alTocar: p.alTocar || '', rueda: p.rueda || '' };
}

export function avisarTuto(c, tu, extra = {}) {
  if (!c || !convs.has(c.id)) return;
  emit(c, { tipo: 'tutorial', id: tu.id, marca: tu.k, paso: tu.paso + 1, total: 1 + pasosDe(tu).length,
    ...(tu.pausado ? { pausado: true } : {}), ...(tu.fin ? { fin: true } : {}), ...extra });
}

export function pausarTuto(c, tu) {
  if (!c || !tu || c.tuto !== tu || tu.fin || tu.pausado) return;
  tu.pausado = true;
  c.pasoGen = (c.pasoGen || 0) + 1; // si estaba buscando el paso siguiente, ya no
  avisarTuto(c, tu);
}

// Terminó la lista (`cortado`: la reemplazó otra antes de terminar).
function terminarTuto(c, tu, cortado = false) {
  if (!tu || tu.fin) return;
  tu.fin = true;
  avisarTuto(c, tu, cortado ? { cortado: true } : {});
}

export function marcar(c, t, m) {
  const captura = ultimaCaptura();
  const lugar = resolverMarca(m.valor, captura);
  if (!lugar) { log('marca sin lugar', c.id, m.valor, captura ? `p${captura.n}` : 'sin captura'); return; }
  // El paso: el renglón de la etiqueta (la lista de pasos) o, si está sola, lo que escribió desde que miró la
  // pantalla (su última herramienta) o desde la marca anterior.
  const paso = renglonDe(t.texto, m.inicio) || t.texto.slice(Math.max(t.bloque || 0, t.marcaFin || 0), m.inicio);
  t.marcaFin = m.fin;
  c.pasoGen = (c.pasoGen || 0) + 1; // si estaba buscando el paso siguiente de otra lista, ya no
  if (c.tuto) terminarTuto(c, c.tuto, true);
  const tu = c.tuto = { id: `${c.id}-${Date.now().toString(36)}`, t, k: marcasEn(t.texto).findIndex((x) => x.inicio === m.inicio),
    desde: m.fin, inicio: m.inicio, paso: 0, pausado: false, fin: false, primero: { lugar, captura, texto: paso } };
  avisarTuto(c, tu);
  // La voz dice el paso entero (el cartel lleva solo la primera oración). En un turno hablado ya lo está diciendo.
  mostrarMarca(c, { lugar, captura, texto: fraseMarca(paso) || (lugar.nombre ? `Acá: «${lugar.nombre}»` : ''),
    hablado: t.hablar ? null : paso, tu });
}

// Dibuja el recuadro (marcar.ps1 -Mostrar), lo manda a la UI y lo dice. `tu`: el tutorial (de ahí salen el paso, la
// explicación y los pasos que siguen); `deServidor`: la marcó el servidor, no Claude en su turno (la tarjeta lleva el paso).
function mostrarMarca(c, { lugar, captura, texto, hablado, tu, deServidor = false }) {
  ocultarMarca();
  const info = infoPaso(tu);
  // Un paso de ruedita: la marca no se va con el click y avisa «mueve» cada vez que el usuario deja de desplazarse. En el
  // primer paso el [RUEDA] suele llegar después de marcar: va por stdin (refrescarCartel) y cambia `actual.rueda`.
  const rueda = info.rueda;
  const proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-WindowStyle', 'Hidden', '-File', path.join(AQUI, 'marcar.ps1'),
    '-Mostrar', '-X', String(lugar.x), '-Y', String(lugar.y), '-W', String(lugar.w), '-H', String(lugar.h)],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, MARCA_TEXTO: texto, MARCA_STDIN: '1', MARCA_RUEDA: rueda,
      MARCA_PASO: String(info.paso), MARCA_TOTAL: String(info.total), MARCA_MAS: info.mas, MARCA_ALTOCAR: info.alTocar } });
  proc.stdin.on('error', () => {});
  const actual = { proc, conv: c.id, sacada: false, salida: '', tu, info, rueda };
  estado.marca = actual;
  tu.mostrada = { captura, lugar }; // la pantalla de antes del click: se compara con la de después (seguirPasos)
  proc.stdout.on('data', (d) => {
    const s = d.toString('utf8');
    actual.salida += s;
    for (const m of s.matchAll(/cartel\t(-?\d+),(-?\d+),(\d+),(\d+)/g)) actual.cartel = { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
    if (actual.rueda && /mueve/.test(s)) trasRueda(c, tu, actual).catch((e) => log('tras la ruedita', e.message));
  });
  proc.stderr.on('data', (d) => log('marca', d.toString().trim().slice(-300)));
  proc.on('error', (e) => log('marca no arrancó', e.message));
  proc.on('close', () => {
    if (estado.marca === actual) estado.marca = null;
    if (actual.sacada || !convs.has(c.id)) return;
    // Un click adentro (o apenas afuera: `cerca`) sigue con el paso siguiente; salir del cartel, Esc, otro click o el
    // tope lo dejan en pausa.
    if (/dentro|cerca/.test(actual.salida)) {
      if (/cerca/.test(actual.salida)) log('marca', c.id, 'click apenas afuera del recuadro: cuenta como adentro');
      seguirPasos(c, tu).catch((e) => log('paso siguiente', e.message));
    }
    else { log('marca', c.id, actual.salida.trim() || 'cerrada'); pausarTuto(c, tu); }
  });
  const p = captura.pantalla;
  emit(c, { tipo: 'marcar', texto, nombre: lugar.nombre, imagen: `/pantallas/p${captura.n}.png`,
    caja: { x: lugar.x - p.x, y: lugar.y - p.y, w: lugar.w, h: lugar.h }, ancho: p.w, alto: p.h, ...(deServidor ? { paso: info.paso } : {}) });
  if (hablado != null && motorVoz()) { const loc = nuevaLocucion(c); decir(loc, textoHablado(hablado) || texto); cerrarLocucion(loc); }
}

// Mientras Claude sigue escribiendo la lista, el cartel recibe por stdin lo que cambió (cuántos pasos son, la
// explicación y el «al tocar» del suyo).
export function refrescarCartel(t) {
  if (!estado.marca || estado.marca.sacada || estado.marca.tu.t !== t) return;
  const antes = estado.marca.info, ahora = infoPaso(estado.marca.tu);
  let linea = '';
  for (const [k, clave] of [['paso', 'paso'], ['total', 'total'], ['mas', 'mas'], ['alTocar', 'altocar'], ['rueda', 'rueda']]) {
    if (antes[k] !== ahora[k]) linea += `${clave}\t${String(ahora[k]).replace(/[\r\n\t]+/g, ' ')}\n`;
  }
  estado.marca.info = ahora;
  if (ahora.rueda) estado.marca.rueda = ahora.rueda;
  if (linea) { try { estado.marca.proc.stdin.write(linea); } catch { /* ya se cerró */ } }
}

// Tocó adentro: si Claude dejó pasos pensados ([LUEGO:nombre]), se busca el que sigue en la pantalla nueva (la app
// tarda en reaccionar: se mira de nuevo un par de veces) y se marca sin Claude. Si el paso no aparece, la UI le manda a
// Claude «Listo, ya lo toqué. No encontré…» (SSE `marca-tocada`, solo en vivo). Un solo paso o la lista terminada: nada
// (24/11, pedido del usuario: avisarle a Claude que tocó el único paso lo ponía a pensar al pedo).
// Si el click no cambió nada en la pantalla (24/11, pedido del usuario), Claude se entera: en el último paso se mira de
// nuevo a los 0,8 y a los 2,3 s (la app puede tardar) y, si sigue igual, «Listo, ya lo toqué («X»), pero no pasó nada…».
async function seguirPasos(c, tu) {
  if (c.tuto !== tu) return;
  const pasos = pasosDe(tu);
  // El nombre del paso que escribió Claude («Guardar cambios»), no el del control que lo encontró (el OCR lo junta).
  const tocado = tu.mostrada && { ...tu.mostrada, nombre: pasoDel(tu, tu.paso)?.nombre || tu.mostrada.lugar?.nombre };
  if (!pasos.length || tu.paso >= pasos.length) {
    if (pasos.length) log('pasos terminados', c.id, pasos.length);
    terminarTuto(c, tu);
    if (await nadaCambio(c, tu, tocado)) avisarNada(c, tocado, '');
    return;
  }
  tu.paso++;
  tu.mirada = null;
  avisarTuto(c, tu);
  const r = await buscarPaso(c, tu, [500, 900, 1800], ultimaCaptura());
  if (r === null) { pausarTuto(c, tu); return; } // otra marca, un mensaje o salir: queda donde estaba
  if (r) return;
  const sig = pasoDel(tu, tu.paso);
  log('paso siguiente no encontrado', c.id, sig?.nombre);
  if (tocado && tu.mirada && pantallaIgual(tocado, tu.mirada)) { avisarNada(c, tocado, sig?.nombre); return; }
  difundir({ tipo: 'marca-tocada', conv: c.id, texto: `Listo, ya lo toqué. No encontré «${sig?.nombre}» en la pantalla para marcarlo: mirá de nuevo y seguí.` });
}

function avisarNada(c, tocado, siguiente) {
  const nombre = tocado.nombre;
  log('click sin efecto', c.id, nombre || '(caja)');
  difundir({ tipo: 'marca-tocada', conv: c.id, nada: true, texto: `Listo, ya lo toqué${nombre ? ` («${nombre}»)` : ''}, pero no pasó nada: la pantalla quedó igual${siguiente ? ` y no aparece «${siguiente}»` : ''}. Mirá de nuevo y decime qué hacer.` });
}

// ¿La pantalla de después es igual a la del paso tocado? (la ventana de adelante, sin Marito; ver zonasComparar)
function pantallaIgual(tocado, despues) {
  const z = zonasComparar(tocado.captura, despues, tocado.lugar);
  if (!z) return false;
  try {
    const cuenta = contarCambios(leerPng(fs.readFileSync(tocado.captura.png)), leerPng(fs.readFileSync(despues.png)), z);
    log('click: cambios', `p${tocado.captura.n}→p${despues.n}`, `fuera ${cuenta.fuera}`, `en el control ${cuenta.dentro}`);
    return quedoIgual(cuenta, tocado.lugar.tipo);
  } catch (e) { log('comparar capturas', e.message); return false; }
}

// Después de tocar el último paso: mira dos veces y dice si todo quedó igual. false si cambió, no se pudo mirar o dejó
// de hacer falta (un mensaje nuevo, otra marca, otro tutorial).
async function nadaCambio(c, tu, tocado) {
  if (!tocado?.captura?.png) return false;
  const gen = c.pasoGen = (c.pasoGen || 0) + 1;
  const vigente = () => c.pasoGen === gen && c.tuto === tu && convs.has(c.id) && !c.turno && !estado.marca && !estado.cerrando;
  for (const espera of [800, 1500]) {
    await new Promise((r) => setTimeout(r, espera));
    if (!vigente()) return false;
    const cap = await mirarPantalla();
    if (!vigente() || !cap || !pantallaIgual(tocado, cap)) return false;
  }
  return true;
}

// Mira la pantalla (después de cada espera) y marca el paso que toca del tutorial si encuentra su control. true si lo
// marcó, false si no apareció, null si dejó de hacer falta (otro paso, otra marca, un turno, salir del tutorial).
async function buscarPaso(c, tu, esperas, anterior) {
  const sig = pasoDel(tu, tu.paso);
  if (!sig?.nombre) return false;
  const gen = c.pasoGen = (c.pasoGen || 0) + 1;
  const vigente = () => c.pasoGen === gen && c.tuto === tu && !tu.pausado && !tu.fin && convs.has(c.id) && !c.turno && !estado.marca && !estado.cerrando;
  const inicio = Date.now();
  for (const espera of esperas) {
    await new Promise((r) => setTimeout(r, espera));
    if (!vigente()) return null;
    const captura = await mirarPantalla();
    if (!vigente()) return null;
    if (captura) tu.mirada = captura; // la última que se miró: si el paso no aparece, se compara con la de antes
    // Un paso de ruedita cuyo control siguiente ya se ve (ya bajó, o no hacía falta): se salta y se marca ese.
    if (captura && sig.rueda && marcarSiguiente(c, tu, captura)) return true;
    const ctl = captura && buscarControl(captura, sig.nombre, anterior, tu.paso === 0 ? tu.primero.lugar : null);
    if (ctl) {
      log('paso', c.id, tu.paso + 1, sig.nombre, `p${captura.n}`, `${Date.now() - inicio} ms`);
      mostrarMarca(c, { lugar: ctl, captura, texto: fraseMarca(sig.texto) || `Tocá «${ctl.nombre}».`, hablado: sig.texto || null, tu, deServidor: true });
      return true;
    }
  }
  return false;
}

const centroEn = (r, x) => !!r && x.x + x.w / 2 >= r.x && x.x + x.w / 2 <= r.x + r.w && x.y + x.h / 2 >= r.y && x.y + x.h / 2 <= r.y + r.h;

// Si el control del paso que sigue al que toca ya está en esta captura, lo marca (avanza un paso) y devuelve true.
function marcarSiguiente(c, tu, captura) {
  const sig = pasoDel(tu, tu.paso + 1);
  const ctl = sig?.nombre && buscarControl(captura, sig.nombre);
  if (!ctl) return false;
  log('paso', c.id, tu.paso + 2, sig.nombre, `p${captura.n}`, 'después de la ruedita');
  tu.paso++;
  avisarTuto(c, tu);
  mostrarMarca(c, { lugar: ctl, captura, texto: fraseMarca(sig.texto) || `Tocá «${ctl.nombre}».`, hablado: sig.texto || null, tu, deServidor: true });
  return true;
}

// La marca de un paso de ruedita avisó que el usuario dejó de desplazarse: se mira la pantalla y, si ya apareció el
// control del paso siguiente, se marca ese (la de la ruedita se va sin pausar el tutorial). Si no, se sigue esperando;
// un aviso que llega mientras se mira hace mirar otra vez al terminar.
async function trasRueda(c, tu, actual) {
  if (actual.buscando) { actual.otraVez = true; return; }
  actual.buscando = true;
  const vigente = () => estado.marca === actual && !actual.sacada && c.tuto === tu && !tu.pausado && !tu.fin && convs.has(c.id) && !c.turno && !estado.cerrando;
  try {
    do {
      actual.otraVez = false;
      if (!vigente()) return;
      const mirada = await mirarPantalla();
      if (!vigente() || !mirada) return;
      // Lo que el OCR leyó en el cartel de la marca («Bajá … hasta ver «X»») no es el control.
      const captura = { ...mirada, controles: (mirada.controles || []).filter((x) => !centroEn(actual.cartel, x)) };
      const sig = pasoDel(tu, tu.paso + 1);
      if (!sig?.nombre || !buscarControl(captura, sig.nombre)) continue;
      actual.sacada = true; killTree(actual.proc.pid); estado.marca = null; // sin pausar: el tutorial sigue
      marcarSiguiente(c, tu, captura);
      return;
    } while (actual.otraVez);
  } finally { actual.buscando = false; }
}

// «Volver al tutorial» desde el chat: el mismo paso, buscado en la pantalla como está ahora. El primero, si Claude lo
// marcó sin nombre (una caja), va donde estaba. Si no aparece, Claude mira de nuevo y sigue desde ahí.
// Ir a un paso cualquiera de la lista (`n` desde 1): tocar un renglón en el chat (24/11, pedido del usuario) o «↻ Repetir
// el tutorial» (el 1). Vale en marcha, en pausa o terminado; lo marca de nuevo como «volver». false si no existe.
export function irAlPaso(c, tu, n) {
  if (!Number.isInteger(n) || n < 1 || n > 1 + pasosDe(tu).length) return false;
  ocultarMarca();
  Object.assign(tu, { fin: false, pausado: false, paso: n - 1 });
  c.pasoGen = (c.pasoGen || 0) + 1;
  avisarTuto(c, tu);
  volverAlPaso(c, tu).catch((e) => log('ir al paso', n, e.message));
  return true;
}

export async function volverAlPaso(c, tu) {
  const r = await buscarPaso(c, tu, [0], null);
  if (r !== false) { if (r === null) pausarTuto(c, tu); return; }
  const sig = pasoDel(tu, tu.paso);
  if (tu.paso === 0 && !sig.nombre) {
    mostrarMarca(c, { lugar: tu.primero.lugar, captura: tu.primero.captura, texto: fraseMarca(sig.texto) || 'Acá.', hablado: sig.texto || null, tu, deServidor: true });
    return;
  }
  pausarTuto(c, tu);
  difundir({ tipo: 'marca-tocada', conv: c.id, texto: `Quiero volver al tutorial, al paso ${tu.paso + 1} («${sig?.nombre || sig?.texto}»), pero no lo encuentro en la pantalla: mirá de nuevo y seguí el tutorial desde ahí, con la lista marcada (si hay que bajar o subir para verlo, el paso de la ruedita).` });
}

// Corre marcar.ps1 como lo hace Claude (captura + controles + textos) y devuelve lo que dejó, con `salida` = la lista
// que imprime (la que leería Claude). null si falla.
function mirarPantalla() {
  return new Promise((resolve) => {
    const antes = ultimaCaptura()?.n || 0;
    const proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(AQUI, 'marcar.ps1'), '-Salida', pantallasDir],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const tope = setTimeout(() => killTree(proc.pid), 15000);
    let salida = '';
    proc.stdout.on('data', (d) => { salida += d.toString('utf8'); });
    proc.stderr.on('data', (d) => log('mirar pantalla', d.toString().trim().slice(-300)));
    proc.on('error', (e) => { clearTimeout(tope); log('mirar pantalla no arrancó', e.message); resolve(null); });
    proc.on('close', () => { clearTimeout(tope); const cap = ultimaCaptura(); resolve(cap && cap.n > antes ? { ...cap, salida: salida.trim() } : null); });
  });
}

// La pantalla para el mensaje de Claude (pregunta de «cómo hago…» o «Listo, ya lo toqué»): la lista de marcar.ps1 y la
// captura en base64, así no gasta dos vueltas (correr el script y mirar la captura con Read). Medido el 24/11 con
// «como cierro esto»: el recuadro a los ~5,7 s en vez de ~12. Si tarda más de `topeMs`, null y Claude mira él.
export async function mirarParaClaude(topeMs = 6000) {
  let vencido;
  const cap = await Promise.race([mirarPantalla(), new Promise((r) => { vencido = setTimeout(() => r(null), topeMs); })]);
  clearTimeout(vencido);
  if (!cap?.salida) return null;
  try { return { lista: cap.salida, png: fs.readFileSync(path.join(pantallasDir, `p${cap.n}.png`)).toString('base64') }; } catch { return null; }
}
