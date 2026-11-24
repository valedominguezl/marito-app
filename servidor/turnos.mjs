// Turnos de claude (`claude -p --output-format stream-json --resume`): arranque, lectura del stream y cierre del turno.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { accionTrasTurno, argsClaude, contextoDe, marcasEn, pareceDePantalla, pideConectores, pideProyecto, tituloDe, toolDetail } from '../servidor-logica.mjs';
import { infoAdj } from './adjuntos.mjs';
import { CONFIG_ARCHIVO, ESFUERZOS, MODELOS, MODELO_INICIAL, PEDIDO_HABLADO, TOPE_TURNO_MS } from './constantes.mjs';
import { difundir, emit, guardarAbiertas, guardarEnHistorial, resumenConv } from './conversaciones.mjs';
import { adjuntos, convs, estado, log, pantallasDir, sesionDir } from './estado.mjs';
import {
  INSTRUCCIONES_LIBRE, INSTRUCCIONES_PROYECTO, SIN_COMMIT, SIN_CONECTORES, YA_MIRE, instruccionesMarcar, instruccionesProyectos
} from './instrucciones.mjs';
import { marcar, mirarParaClaude, ocultarMarca, pausarTuto, refrescarCartel } from './marca.mjs';
import { proyectoPedido, resolverProyecto } from './proyectos.mjs';
import { publicar } from './publicacion.mjs';
import { esGenerico, git, killTree, readConfig, writeJsonFile } from './utilidades.mjs';
import { alimentarVoz, arrancarVoz, cerrarLocucion, cortarVoz, motorVoz, nuevaLocucion } from './voz.mjs';

// ---- turnos de claude ----
// Donde lo deja cada forma de instalar Claude Code: el instalador oficial (~\.local\bin), npm, o cualquier carpeta del PATH.
function claudeExe() {
  const candidatos = [
    path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map((d) => path.join(d, 'claude.exe')),
  ];
  return candidatos.find((e) => { try { return fs.statSync(e).isFile(); } catch { return false; } }) || null;
}

function discos() {
  const out = [];
  for (const l of 'CDEFGH') { try { if (fs.existsSync(`${l}:\\`)) out.push(`${l}:\\`); } catch { /* idem */ } }
  return out;
}

// Deja anotado en proyectos.json lo aprendido (sitio nuevo no genérico, último usado, modelo), como en la v1.
async function anotarProyecto(c, cfg, proy) {
  const sitio = c.sitio || '';
  // Se aprende el sitio solo si no es de otro proyecto: abrir Marito sobre la web de X y elegir Y a mano no hace que
  // esa web pase a abrir Y.
  const deOtro = (cfg.proyectos || []).some((x) => x.nombre !== proy.nombre && (x.sitios || []).some((s) => sitio.includes(s)));
  if (sitio && !c.noAprenderSitio && /^[\w.-]+(:\d+)?$/.test(sitio) && !esGenerico(sitio) && !deOtro && !(proy.sitios || []).some((s) => sitio.includes(s))) proy.sitios = [...(proy.sitios || []), sitio];
  if (proy._nuevo) {
    const rama = (await git(proy.carpeta, 'branch', '--show-current')).out;
    const tieneMain = (await git(proy.carpeta, 'branch', '--list', 'main')).out || (await git(proy.carpeta, 'branch', '-r', '--list', 'origin/main')).out;
    proy.rama = rama; proy.publicarEn = tieneMain ? 'main' : rama; proy.deploy = '';
    delete proy._nuevo;
    cfg.proyectos = [...(cfg.proyectos || []), proy];
  } else {
    const i = (cfg.proyectos || []).findIndex((x) => x.nombre === proy.nombre);
    if (i >= 0) cfg.proyectos[i] = proy;
  }
  cfg.ultimo = proy.nombre;
  try { writeJsonFile(CONFIG_ARCHIVO, cfg); } catch (e) { log('no pude guardar config', e.message); }
}

// `previo`: el turno que pidió los conectores; este lo sigue sin mensaje nuevo a la vista (mismo turno para la UI).
// La bandera se pone antes del primer `await`: dos mensajes casi juntos (la PC y el celular, o «Listo, ya lo toqué»)
// arrancaban dos `claude --resume` en la misma pestaña, porque `c.turno` se asigna recién después de mirar git.
export async function iniciarTurno(c, o) {
  c.arrancando = true;
  try { return await arrancarTurno(c, o); } finally { c.arrancando = false; }
}

async function arrancarTurno(c, { texto, ids, modelo, esfuerzo, commit, push, cliente, previo, hablar, cambioProyecto, desdeCelular }) {
  const exe = claudeExe();
  if (!exe) return { error: 'No encuentro Claude Code en esta PC. Instalalo (https://claude.com/claude-code), abrí una terminal, corré «claude» una vez para iniciar sesión y volvé a probar.', status: 500 };
  let proy = null;
  let cfg = readConfig();
  if (c.proyecto && !cfg.raiz) c.proyecto = ''; // sin «Carpeta de proyectos»: todo es Chat libre
  if (c.proyecto) {
    ({ cfg, proy } = resolverProyecto(c.proyecto));
    // Si el proyecto ya no existe, sigue como chat libre en vez de fallar.
    if (!proy || !fs.existsSync(proy.carpeta)) { proy = null; c.proyecto = ''; }
  }
  const libre = !proy;
  if (proy) await anotarProyecto(c, cfg, proy);
  // El modelo es de cada chat; los nuevos arrancan siempre en MODELO_INICIAL (Opus 5.5, lo pidió el usuario el 23/11)
  const modeloUsar = MODELOS.some((m) => m.id === modelo) ? modelo : (c.modelo || MODELO_INICIAL);
  // Se recuerda en la conversación: la ventana se recarga en cada Alt+F2 (y el celular) y tiene que volver con el suyo
  c.modelo = modeloUsar;
  const cwd = libre ? os.homedir() : proy.carpeta;
  const esfuerzoUsar = ESFUERZOS.some((x) => x.id && x.id === esfuerzo) ? esfuerzo : '';
  if (esfuerzo !== undefined && (cfg.esfuerzo || '') !== esfuerzoUsar) { cfg = readConfig(); cfg.esfuerzo = esfuerzoUsar; try { writeJsonFile(CONFIG_ARCHIVO, cfg); } catch { /* idem */ } }

  // Mensaje: texto + contexto de dónde estaba + rutas de los adjuntos.
  const usadas = (ids || []).map((id) => adjuntos.get(id)).filter(Boolean);
  let mensaje = texto;
  if (!c.primerTurnoHecho) {
    if (c.url) mensaje += `\n\nPágina abierta: ${c.url}`;
    if (c.archivo) mensaje += `\n\nEn VS Code tenía abierto: ${c.archivo}`;
    // Lo que tenía adelante al abrir Marito (VS Code, Explorador, Inventor…): sin esto Claude contestaba en general.
    // «Atrás, abiertas»: el foco puede estar en otra cosa (Copilot) y la pregunta ser del programa de atrás (Inventor).
    if (c.donde) mensaje += `\n\n${c.donde} Si la pregunta es de alguno de esos programas, contestá sobre ese: el de adelante, salvo que encaje mejor con uno de atrás; si no se sabe, preguntá cuál (podés mirar la pantalla con el script de la marca).`;
  }
  if (usadas.length) {
    const desc = (a) => `${a.ruta.replace(/\\/g, '/')}${a.origen === 'ventana' ? ' (captura de la ventana)' : a.origen === 'recorte' ? ' (recorte de pantalla)'
      : a.origen === 'zona' ? ` (zona de la pantalla que marcó el usuario${a.nota ? `: ${a.nota}` : ''}; lo que pregunta es sobre eso)` : ''}`;
    mensaje += `\n\nAdjuntos: ${usadas.map(desc).join(', ')} — leelos con Read antes de responder.`;
  }
  if (hablar) mensaje += PEDIDO_HABLADO;
  usadas.forEach((a) => { a.usado = true; });
  c.primerTurnoHecho = true;
  if (!c.titulo) c.titulo = tituloDe(texto);

  const id = previo ? previo.id : ++c.turnoN;
  // Si siguió en otro proyecto ([PROYECTO:…]), lo de git se mira en la carpeta nueva.
  const antes = previo?.antes !== undefined ? previo.antes : libre ? '' : (await git(cwd, 'rev-parse', 'HEAD')).out;
  const rama = previo?.rama !== undefined ? previo.rama : libre ? '' : (await git(cwd, 'branch', '--show-current')).out;
  // Un mensaje nuevo saca la marca (su tutorial queda en pausa: se vuelve desde el chat), deja de buscar el paso
  // siguiente y corta la voz.
  if (!previo) { ocultarMarca(); pausarTuto(c, c.tuto); cortarVoz(c); c.pasoGen = (c.pasoGen || 0) + 1; }
  if (hablar && !previo) nuevaLocucion(c);
  // Una pregunta sobre la pantalla (de la PC): se mira mientras arranca claude y va en el mensaje (ver mirarParaClaude).
  const verPantalla = !previo && !desdeCelular && pareceDePantalla(texto);
  const pantalla = verPantalla ? mirarParaClaude() : null;
  if (verPantalla && motorVoz()) arrancarVoz(); // como cuando Claude corre marcar.ps1: la voz carga mientras tanto
  // Con la pantalla ya en el mensaje, esfuerzo bajo (si el usuario no eligió otro): mismo paso y misma explicación en
  // 3 de 3 pruebas del 24/11, con el recuadro a los ~4 s en vez de ~6 (el usuario: «lo que ayude, mientras no se equivoque»).
  const esfuerzoTurno = verPantalla && !esfuerzoUsar ? 'low' : esfuerzoUsar;
  const args = argsClaude({ modelo: modeloUsar, instrucciones: (libre ? INSTRUCCIONES_LIBRE : INSTRUCCIONES_PROYECTO + (commit === false ? SIN_COMMIT : ''))
    + instruccionesProyectos(cfg.raiz || '', proy ? proy.nombre : '') + instruccionesMarcar(pantallasDir) + (c.mcp ? '' : SIN_CONECTORES),
    esfuerzo: esfuerzoTurno, libre, discos: libre ? discos() : [], sessionId: c.sessionId, sinMcp: !c.mcp, entradaJson: verPantalla });

  const env = { ...process.env };
  delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT;
  // Cerraron la pestaña (o se apaga el servidor) mientras se miraba git: no arranca un claude que nadie ve.
  if (estado.cerrando || !convs.has(c.id)) return { error: 'La pestaña se cerró.', status: 409 };
  const proc = spawn(exe, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const t = { proc, id, detenido: false, inicio: previo ? previo.inicio : Date.now(), proy, cwd, libre, antes, rama, push: push !== false, anyText: previo ? previo.anyText : false,
    vistos: new Set(), resultado: null, stderr: '', buf: '', texto: '', marcas: 0,
    // El pedido del usuario: el que sigue tras cargar los conectores lo hereda (su texto es «Ya tenés los conectores…»),
    // así un [PROYECTO:…] después vuelve a mandar lo que pidió de verdad, con sus adjuntos.
    pedido: previo?.pedido ? { ...previo.pedido, cambioProyecto: !!(cambioProyecto || previo.pedido.cambioProyecto) }
      : { texto, ids, modelo, esfuerzo, commit, push, hablar, cambioProyecto },
    hablar: !!hablar, vozDesde: 0, bloque: 0, marcaFin: 0, costoPrevio: previo ? previo.costo : 0 };
  c.turno = t;
  if (!previo) {
    const usuario = { tipo: 'usuario', conv: c.id, texto, adjuntos: usadas.map(infoAdj) };
    c.historial.push(usuario);
    // En vivo, para las otras pantallas (PC o celular); la que lo mandó ya lo dibujó y lo reconoce por `cliente`.
    difundir({ ...usuario, cliente: String(cliente || '') });
    emit(c, { tipo: 'turno-inicio', id });
  }
  log('turno', c.id, id, 'modelo', modeloUsar, 'esfuerzo', esfuerzoTurno || '-', 'pantalla', verPantalla ? 'sí' : 'no', 'mcp', c.mcp ? 'sí' : 'no', 'cwd', cwd, 'resume', c.sessionId || '-');

  const errLog = path.join(sesionDir, 'claude-stderr.log');
  proc.stderr.on('data', (d) => { const s = d.toString(); t.stderr = (t.stderr + s).slice(-4000); try { fs.appendFileSync(errLog, `[${c.id}] ${s}`); } catch { /* idem */ } });
  proc.stdin.on('error', () => {});
  if (!verPantalla) proc.stdin.end(mensaje);
  else {
    // claude arranca (~1 s) mientras marcar.ps1 mira (~1 s): el mensaje sale cuando están las dos cosas. Si no se pudo
    // mirar, va el texto solo y Claude corre el script como siempre.
    pantalla.then((v) => {
      const contenido = [{ type: 'text', text: v ? `${mensaje}\n\n${YA_MIRE}\n${v.lista}` : mensaje }];
      if (v) contenido.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: v.png } });
      if (!v) log('turno', c.id, id, 'no pude mirar la pantalla antes');
      proc.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content: contenido } }) + '\n');
    });
  }
  proc.stdout.on('data', (d) => {
    t.buf += d.toString('utf8');
    let i;
    while ((i = t.buf.indexOf('\n')) >= 0) {
      const linea = t.buf.slice(0, i).trim(); t.buf = t.buf.slice(i + 1);
      if (linea) procesarLinea(c, t, linea);
    }
  });
  const tope = setTimeout(() => { if (c.turno === t) { t.tope = true; killTree(proc.pid); } }, TOPE_TURNO_MS);
  proc.on('error', (e) => { emit(c, { tipo: 'error', texto: `No pude arrancar claude: ${e.message}` }); });
  proc.on('close', (code) => { clearTimeout(tope); finTurno(c, t, code); });
  return { ok: true };
}

function procesarLinea(c, t, linea) {
  let o; try { o = JSON.parse(linea); } catch { return; } // líneas sueltas que no son JSON (avisos)
  if (o.session_id && o.type === 'system' && o.subtype === 'init') c.sessionId = o.session_id;
  if (o.type === 'stream_event' && !o.parent_tool_use_id) {
    const e = o.event || {};
    if (e.type === 'content_block_start' && e.content_block?.type === 'text' && t.anyText) { t.texto += '\n\n'; emit(c, { tipo: 'texto', delta: '\n\n' }); }
    // Lo que escribe después de su última herramienta (mirar la pantalla) es el paso de una marca sin lista. No se
    // cuenta desde cada bloque de texto: a veces parte una respuesta en dos y el cartel se quedaba con el segundo.
    if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') t.bloque = t.texto.length;
    if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text) {
      t.anyText = true; t.texto += e.delta.text; emit(c, { tipo: 'texto', delta: e.delta.text });
      // Cada etiqueta [MARCAR:...] que se completa se dibuja en el momento, sin esperar el fin del turno.
      const marcas = marcasEn(t.texto);
      while (t.marcas < marcas.length) marcar(c, t, marcas[t.marcas++]);
      refrescarCartel(t);
      alimentarVoz(c, t, false);
    }
  } else if (o.type === 'assistant' && !o.parent_tool_use_id) {
    const usado = contextoDe(o.message?.usage);
    if (usado) t.contexto = usado;
    for (const b of o.message?.content || []) {
      if (b.type === 'tool_use' && !t.vistos.has(b.id)) {
        t.vistos.add(b.id);
        emit(c, { tipo: 'herramienta', nombre: b.name, detalle: toolDetail(b.name, b.input, t.cwd) });
        // Va a mirar la pantalla para marcar: la voz se va cargando (Santa tarda ~8 s) mientras Claude mira la captura.
        const entrada = JSON.stringify(b.input || {});
        if (entrada.includes('marcar.ps1') && !entrada.includes('-Mostrar') && motorVoz()) arrancarVoz();
      }
    }
  } else if (o.type === 'result') {
    t.resultado = o;
    if (o.session_id) c.sessionId = o.session_id;
    // El turno termina acá: claude tarda ~1 s más en cerrarse y no hace falta esperarlo (medido el 23/11; un
    // --resume enseguida ya ve la conversación entera).
    setImmediate(() => finTurno(c, t, 0));
  }
}

async function finTurno(c, t, code) {
  if (c.turno !== t || t.terminado) return; // llega dos veces: con el `result` y al cerrarse el proceso
  t.terminado = true;
  if (t.buf.trim()) procesarLinea(c, t, t.buf.trim());
  const r = t.resultado;
  // Si no llegaron deltas (modo raro), se manda el resultado entero.
  if (r && !t.anyText && r.result && !r.is_error) {
    emit(c, { tipo: 'texto', delta: String(r.result) });
    t.texto = String(r.result); marcasEn(t.texto).slice(t.marcas).forEach((m) => marcar(c, t, m));
    refrescarCartel(t);
  }
  if (t.tope) emit(c, { tipo: 'error', texto: `Se pasó el tope de ${TOPE_TURNO_MS / 3600000} horas y lo corté.` });
  else if (!t.detenido && r?.is_error) emit(c, { tipo: 'error', texto: String(r.result || 'Claude terminó con error.') });
  else if (!t.detenido && !r) emit(c, { tipo: 'error', texto: `Claude se cortó sin respuesta (código ${code}). ${t.stderr.split('\n').filter(Boolean).slice(-2).join(' ')}`.trim() });
  const despues = t.libre ? '' : (await git(t.cwd, 'rev-parse', 'HEAD')).out;
  if (t.cerrado) return; // se apagó mientras se miraba git: `apagar` ya lo dejó cerrado en el historial
  const cambio = !!(t.antes && despues && despues !== t.antes);
  c.turno = null;
  const ok = !t.detenido && !t.tope && !r?.is_error && !!r;
  if (ok && !c.mcp && !estado.cerrando && convs.has(c.id) && pideConectores(t.texto)) {
    // Pidió los conectores: se cargan y el mismo turno sigue (para la UI es uno solo).
    c.mcp = true;
    c.turno = t; // sigue ocupada mientras arranca el que sigue (si no, un mensaje podría colarse en el medio)
    emit(c, { tipo: 'herramienta', nombre: 'Conectores', detalle: 'Notion, Drive, Vercel, Figma, Windows…' });
    const p = t.pedido;
    const r2 = await iniciarTurno(c, { texto: 'Ya tenés los conectores cargados: seguí con lo que te pedí.', modelo: p.modelo, esfuerzo: p.esfuerzo, commit: p.commit, push: p.push, hablar: p.hablar,
      previo: { id: t.id, antes: t.antes, rama: t.rama, inicio: t.inicio, anyText: t.anyText, costo: t.costoPrevio + (r?.total_cost_usd ?? 0), pedido: t.pedido } });
    if (t.cerrado) return;
    if (!r2?.error) {
      // Lo cortaron (Esc, detener o cerrar la pestaña) mientras arrancaba: se corta también el que sigue.
      if ((t.detenido || !convs.has(c.id)) && c.turno && c.turno !== t) { c.turno.detenido = true; killTree(c.turno.proc.pid); }
      return;
    }
    c.turno = null;
    emit(c, { tipo: 'error', texto: r2.error });
  }
  // Pidió otro proyecto ([PROYECTO:…]): la conversación pasa ahí (sesión de claude nueva, en su carpeta) y el mismo
  // pedido sigue (para la UI es un solo turno, sin borrar lo que se ve). Una vez por mensaje.
  const pedidoProy = ok && !estado.cerrando && convs.has(c.id) && !t.pedido.cambioProyecto ? pideProyecto(t.texto) : null;
  if (pedidoProy !== null) {
    const nuevo = proyectoPedido(pedidoProy);
    if (nuevo === null) emit(c, { tipo: 'error', texto: `No encontré el proyecto «${pedidoProy}».` });
    else if (nuevo !== c.proyecto) {
      c.proyecto = nuevo; c.sessionId = null; c.primerTurnoHecho = false; c.pendiente = null; // el push manual era del repo de antes
      c.noAprenderSitio = true; // la página abierta era de lo de antes: no pasa a ser de este proyecto
      difundir({ tipo: 'conv-cambio', conv: c.id, resumen: resumenConv(c), seguir: true });
      c.turno = t; // sigue ocupada mientras arranca el que sigue
      emit(c, { tipo: 'herramienta', nombre: 'Proyecto', detalle: nuevo || 'Chat libre' });
      const p = t.pedido;
      const r2 = await iniciarTurno(c, { texto: p.texto, ids: p.ids, modelo: p.modelo, esfuerzo: p.esfuerzo, commit: p.commit, push: p.push, hablar: p.hablar,
        cambioProyecto: true, previo: { id: t.id, inicio: t.inicio, anyText: t.anyText, costo: t.costoPrevio + (r?.total_cost_usd ?? 0) } });
      if (t.cerrado) return;
      if (!r2?.error) {
        if ((t.detenido || !convs.has(c.id)) && c.turno && c.turno !== t) { c.turno.detenido = true; killTree(c.turno.proc.pid); }
        return;
      }
      c.turno = null;
      emit(c, { tipo: 'error', texto: r2.error });
    }
  }
  // Turno hablado: lo último que faltaba decir y se cierra la locución (si lo cortaron, ya se cortó la voz).
  if (t.hablar && c.loc) { if (ok) alimentarVoz(c, t, true); cerrarLocucion(c.loc); }
  t.cerrado = true;
  c.finEn = Date.now();
  emit(c, { tipo: 'turno-fin', id: t.id, costoUsd: t.costoPrevio + (r?.total_cost_usd ?? 0), segundos: Math.round((Date.now() - t.inicio) / 1000), cambio, ok, detenido: t.detenido,
    contexto: t.contexto || 0 });
  if (convs.has(c.id)) { guardarEnHistorial(c); guardarAbiertas(); }
  const accion = accionTrasTurno({ cambio, ok, cerrando: estado.cerrando, abierta: convs.has(c.id), push: t.push });
  if (accion !== 'nada') {
    // Push manual: el commit queda en la compu hasta que toque «Publicar ahora». Si se juntan varios, se publican
    // juntos desde el primero (así no cuentan como commits ajenos).
    const base = c.pendiente && c.pendiente.t.proy.carpeta === t.proy.carpeta ? { ...t, antes: c.pendiente.antes } : t;
    if (accion === 'manual') {
      c.pendiente = { t: base, antes: base.antes };
      emit(c, { tipo: 'publicacion', paso: 'local', manual: true, texto: 'Commit hecho, sin push (push manual). Publicalo cuando quieras.' });
    } else {
      c.pendiente = null;
      publicar(c, base, despues).catch((e) => emit(c, { tipo: 'publicacion', paso: 'fallo', texto: `Falló la publicación: ${e.message}` }));
    }
  }
}
