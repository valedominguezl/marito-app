// Marca en la pantalla y tutorial paso a paso (marcar.ps1; etiquetas [MARCAR]/[LUEGO]/[MAS] de la respuesta de claude).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buscarControl, fraseMarca, marcasEn, masDe, pasosEn, renglonDe, resolverMarca, textoHablado } from '../servidor-logica.mjs';
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
  if (i === 0) return { nombre: tu.primero.lugar.nombre || '', texto: tu.primero.texto, ...masDe(tu.t.texto, tu.inicio) };
  return pasosDe(tu)[i - 1] || null;
}

// Lo del cartel abierto de ese paso.
function infoPaso(tu) {
  const p = pasoDel(tu, tu.paso) || {};
  return { paso: tu.paso + 1, total: 1 + pasosDe(tu).length, mas: p.mas || '', alTocar: p.alTocar || '' };
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
  const proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-WindowStyle', 'Hidden', '-File', path.join(AQUI, 'marcar.ps1'),
    '-Mostrar', '-X', String(lugar.x), '-Y', String(lugar.y), '-W', String(lugar.w), '-H', String(lugar.h)],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, MARCA_TEXTO: texto, MARCA_STDIN: '1',
      MARCA_PASO: String(info.paso), MARCA_TOTAL: String(info.total), MARCA_MAS: info.mas, MARCA_ALTOCAR: info.alTocar } });
  proc.stdin.on('error', () => {});
  const actual = { proc, conv: c.id, sacada: false, salida: '', tu, info };
  estado.marca = actual;
  proc.stdout.on('data', (d) => { actual.salida += d.toString('utf8'); });
  proc.stderr.on('data', (d) => log('marca', d.toString().trim().slice(-300)));
  proc.on('error', (e) => log('marca no arrancó', e.message));
  proc.on('close', () => {
    if (estado.marca === actual) estado.marca = null;
    if (actual.sacada || !convs.has(c.id)) return;
    // Un click adentro sigue con el paso siguiente; salir del cartel, Esc, otro click o el tope lo dejan en pausa.
    if (/dentro/.test(actual.salida)) seguirPasos(c, tu).catch((e) => log('paso siguiente', e.message));
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
  for (const [k, clave] of [['paso', 'paso'], ['total', 'total'], ['mas', 'mas'], ['alTocar', 'altocar']]) {
    if (antes[k] !== ahora[k]) linea += `${clave}\t${String(ahora[k]).replace(/[\r\n\t]+/g, ' ')}\n`;
  }
  estado.marca.info = ahora;
  if (linea) { try { estado.marca.proc.stdin.write(linea); } catch { /* ya se cerró */ } }
}

// Tocó adentro: si Claude dejó pasos pensados ([LUEGO:nombre]), se busca el que sigue en la pantalla nueva (la app
// tarda en reaccionar: se mira de nuevo un par de veces) y se marca sin Claude. Si el paso no aparece, la UI le manda a
// Claude «Listo, ya lo toqué. No encontré…» (SSE `marca-tocada`, solo en vivo). Un solo paso o la lista terminada: nada
// (24/11, pedido del usuario: avisarle a Claude que tocó el único paso lo ponía a pensar al pedo).
async function seguirPasos(c, tu) {
  if (c.tuto !== tu) return;
  const pasos = pasosDe(tu);
  if (!pasos.length) { terminarTuto(c, tu); return; }
  if (tu.paso >= pasos.length) { log('pasos terminados', c.id, pasos.length); terminarTuto(c, tu); return; }
  tu.paso++;
  avisarTuto(c, tu);
  const r = await buscarPaso(c, tu, [500, 900, 1800], ultimaCaptura());
  if (r === null) { pausarTuto(c, tu); return; } // otra marca, un mensaje o salir: queda donde estaba
  if (r) return;
  const sig = pasoDel(tu, tu.paso);
  log('paso siguiente no encontrado', c.id, sig?.nombre);
  difundir({ tipo: 'marca-tocada', conv: c.id, texto: `Listo, ya lo toqué. No encontré «${sig?.nombre}» en la pantalla para marcarlo: mirá de nuevo y seguí.` });
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
    const ctl = captura && buscarControl(captura, sig.nombre, anterior, tu.paso === 0 ? tu.primero.lugar : null);
    if (ctl) {
      log('paso', c.id, tu.paso + 1, sig.nombre, `p${captura.n}`, `${Date.now() - inicio} ms`);
      mostrarMarca(c, { lugar: ctl, captura, texto: fraseMarca(sig.texto) || `Tocá «${ctl.nombre}».`, hablado: sig.texto || null, tu, deServidor: true });
      return true;
    }
  }
  return false;
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
  difundir({ tipo: 'marca-tocada', conv: c.id, texto: `Quiero volver al tutorial, al paso ${tu.paso + 1} («${sig?.nombre || sig?.texto}»), pero no lo encuentro en la pantalla: mirá de nuevo y seguí desde ahí.` });
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
