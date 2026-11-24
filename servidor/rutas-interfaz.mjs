// Rutas HTTP de la ventana: página, contexto, eventos en vivo, borradores y opciones, entrada del Alt+F2, carpeta raíz, historial y pestañas.
import fs from 'node:fs';
import path from 'node:path';
import { addAdjunto, infoAdj, nombreCaptura } from './adjuntos.mjs';
import { CONFIG_ARCHIVO, ESFUERZOS, MODELOS, MODELO_INICIAL, TOPE_BORRADORES, UI_DIR } from './constantes.mjs';
import { convDelHistorial, difundir, guardarAbiertas, limpiarAlAbrir, nuevaConv, olvidar, resumenConv } from './conversaciones.mjs';
import { adjuntos, clientes, convs, estado, fijo, guardarInterfaz, inicioServidor, leerHistorial, leerInterfaz, log } from './estado.mjs';
import { NO_ATENDIDA, convDe, readBody, sendFile, sendJson } from './http.mjs';
import { listaProyectos, sumarExtra } from './proyectos.mjs';
import { findRepos, readConfig, writeJsonFile } from './utilidades.mjs';
import { motorVoz } from './voz.mjs';

// Devuelve NO_ATENDIDA si el pedido no es de este grupo; cualquier otra cosa (undefined) quiere decir que ya respondió.
export async function rutasInterfaz(q) {
  const { req, res, esRemoto, p, cookie } = q;
  if (req.method === 'GET' && p === '/') return sendFile(res, path.join(UI_DIR, 'index.html'), cookie);
  if (req.method === 'GET' && p === '/api/ping') return sendJson(res, 200, { ok: true, fijo, pid: process.pid });
  if (req.method === 'GET' && p === '/api/contexto') {
    const cfg = readConfig();
    // El último borrador vuelve en la primera pestaña: desde ahora es de ella (si lo manda, se borra).
    const interfaz0 = leerInterfaz();
    if (!esRemoto && interfaz0.ultimo?.texto && interfaz0.ultimo.arranque !== inicioServidor) {
      guardarInterfaz({ ...interfaz0, ultimo: { ...interfaz0.ultimo, conv: estado.primera.id, arranque: inicioServidor } });
    }
    // Lo que trajo el Alt+F2 (captura, proyecto) es de la ventana de la PC, no del celular.
    const entrada = esRemoto ? null : estado.entradaPendiente;
    if (!esRemoto) estado.entradaPendiente = null;
    return sendJson(res, 200, {
      proyectos: listaProyectos(), modelo: MODELO_INICIAL, modelos: MODELOS,
      esfuerzo: cfg.esfuerzo || '', esfuerzos: ESFUERZOS,
      // Cada una con su borrador (por sesión de claude): la ventana se recarga en cada Alt+F2 y la pestaña que volvió
      // tras un reinicio no tiene otro lugar de dónde sacarlo. Al celular no le van los borradores de la PC.
      conversaciones: [...convs.values()].map((c) => ({ ...resumenConv(c),
        ...(!esRemoto && c.sessionId && interfaz0.borradores[c.sessionId] ? { borrador: interfaz0.borradores[c.sessionId] } : {}) })),
      inicial: convs.has(estado.primera.id) ? estado.primera.id : '',
      // Fijo: la captura de cada Alt+F2 llega con `entrada`; las viejas sin mandar no se vuelven a pegar.
      adjuntos: esRemoto || fijo ? [] : [...adjuntos.values()].filter((a) => !a.usado).map(infoAdj),
      push: interfaz0.push, fondo: interfaz0.fondo, voz: motorVoz() || 'no', borrador: esRemoto ? '' : interfaz0.ultimo?.texto || '',
      remoto: esRemoto, fijo, entrada, raiz: cfg.raiz || '',
    });
  }
  if (req.method === 'POST' && p === '/api/borrador') {
    // Lo escrito en la caja, para que no se pierda si se cierra la ventana: el último (vuelve al abrir) y el de
    // cada conversación con sesión (vuelve al reabrirla del historial). Texto vacío = se mandó o se borró.
    const b = await readBody(req);
    const c = convDe(b);
    const texto = String(b.texto || '').slice(0, 100000);
    const i = leerInterfaz();
    if (texto) i.ultimo = { conv: b.conv || '', arranque: inicioServidor, texto };
    else if (i.ultimo && i.ultimo.conv === (b.conv || '') && i.ultimo.arranque === inicioServidor) i.ultimo = null;
    if (c && c.sessionId) {
      if (texto) i.borradores[c.sessionId] = texto; else delete i.borradores[c.sessionId];
      const claves = Object.keys(i.borradores);
      if (claves.length > TOPE_BORRADORES) for (const k of claves.slice(0, claves.length - TOPE_BORRADORES)) delete i.borradores[k];
    }
    guardarInterfaz(i);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && p === '/api/push') {
    const b = await readBody(req);
    const i = leerInterfaz();
    i.push = { commit: b.commit !== false, push: b.push !== false };
    guardarInterfaz(i);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && p === '/api/fondo') {
    // Lo elegido en los deslizadores del fondo (números y el nombre del efecto; nada más).
    const b = await readBody(req);
    const fondo = {};
    for (const [k, v] of Object.entries(b || {})) {
      if (typeof v === 'number' && Number.isFinite(v)) fondo[k] = v;
      else if (k === 'efecto' && /^[a-z]{1,20}$/.test(String(v))) fondo[k] = String(v);
    }
    const i = leerInterfaz();
    i.fondo = fondo;
    guardarInterfaz(i);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'GET' && p === '/api/eventos') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': ok\n\n');
    // Primero qué pestañas hay (otra pantalla pudo abrir o cerrar alguna mientras esta estaba desconectada).
    // `servidor` dice de qué arranque son: los ids (c1, turno 1…) vuelven a empezar con cada uno, y la app del celular
    // solo usa lo que guardó de los turnos ya vistos si es el mismo servidor.
    res.write(`data: ${JSON.stringify({ tipo: 'convs', servidor: `${inicioServidor}-${process.pid}`, lista: [...convs.values()].map(resumenConv) })}\n\n`);
    for (const c of convs.values()) for (const ev of c.historial) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    res.write(`data: ${JSON.stringify({ tipo: 'replay-fin' })}\n\n`);
    res.remoto = esRemoto;
    clientes.add(res);
    req.on('close', () => {
      clientes.delete(res);
      // Se cerró la ventana de la PC: lo que termine desde ahora no se vio ahí (ver `quedaAlAbrir`).
      if (!esRemoto && ![...clientes].some((r) => !r.remoto)) estado.ventanaCerradaEn = Date.now();
    });
    return;
  }
  if (req.method === 'POST' && p === '/api/escondida') {
    // La ventana de la PC se escondió (Esc, la rayita): lo que termine desde ahora no se vio ahí, igual que con la
    // ventana cerrada (ver `quedaAlAbrir`). Al traerla con Alt+F1/F2, abrir.ps1 manda `abrir` y se limpia como al abrirla.
    if (esRemoto) return sendJson(res, 403, { ok: false });
    estado.ventanaCerradaEn = Date.now();
    log('ventana escondida');
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && p === '/api/entrada') {
    // Otro Alt+F2 con la ventana abierta: lo que hay adelante ahora (proyecto, página, captura). La UI decide la pestaña.
    const b = await readBody(req);
    // `abrir`: abrir.ps1 abre la ventana enganchada al servidor fijo, o la trae escondida con Alt+F1/F2 (no un segundo
    // Alt+F2 con ella a la vista).
    if (b.abrir === true && !esRemoto) limpiarAlAbrir();
    let proyecto = String(b.proyecto || '');
    if (b.carpeta) proyecto = sumarExtra(String(b.carpeta)) || proyecto;
    if (!readConfig().raiz) proyecto = ''; // sin «Carpeta de proyectos»: todo es Chat libre
    let a = null;
    if (b.ruta && fs.existsSync(b.ruta)) a = addAdjunto(fs.readFileSync(b.ruta), nombreCaptura(b.origen), b.origen || 'ventana', b.nota);
    const ev = { tipo: 'entrada', proyecto, proyectos: listaProyectos(), sitio: String(b.sitio || ''), url: String(b.url || ''),
      donde: String(b.donde || ''), adjunto: a ? infoAdj(a) : null };
    if ([...clientes].some((r) => !r.remoto)) difundir(ev, true); else estado.entradaPendiente = ev;
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && p === '/api/raiz') {
    // «Carpeta de proyectos» (configuración): donde se buscan primero. Vacía = Marito no habla de proyectos.
    if (esRemoto) return sendJson(res, 403, { ok: false, error: 'Eso se cambia desde la PC.' });
    const b = await readBody(req);
    const raiz = String(b.raiz || '').trim().replace(/[\\/]+$/, '');
    if (raiz) { try { if (!fs.statSync(raiz).isDirectory()) throw new Error(); } catch { return sendJson(res, 400, { ok: false, error: 'Esa carpeta no existe.' }); } }
    const cfg = readConfig(); cfg.raiz = raiz;
    try { writeJsonFile(CONFIG_ARCHIVO, cfg); } catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
    if (raiz) { const out = []; findRepos(raiz, 0, out); for (const x of out) sumarExtra(x); }
    return sendJson(res, 200, { ok: true, raiz, proyectos: listaProyectos() });
  }
  if (req.method === 'GET' && p === '/api/historial') {
    return sendJson(res, 200, leerHistorial().map(({ eventos, ...x }) => x));
  }
  if (req.method === 'POST' && p === '/api/conversacion') {
    // Sin id: pestaña nueva. Con id: cambia su proyecto/contexto (otro proyecto = conversación de cero).
    // Con «reabrir» (sessionId del historial): pestaña nueva que sigue esa sesión de claude.
    const b = await readBody(req);
    if (b.reabrir) {
      const h = leerHistorial().find((x) => x.sessionId === String(b.reabrir));
      if (!h) return sendJson(res, 404, { ok: false, error: 'Esa conversación ya no está en el historial.' });
      const ya = [...convs.values()].find((x) => x.sessionId === h.sessionId);
      if (ya) return sendJson(res, 200, { ...resumenConv(ya), yaAbierta: true });
      const c = convDelHistorial(h);
      guardarAbiertas();
      difundir({ tipo: 'conv-nueva', conv: c.id, resumen: resumenConv(c), eventos: c.historial });
      return sendJson(res, 200, { ...resumenConv(c), eventos: c.historial, borrador: leerInterfaz().borradores[h.sessionId] || '' });
    }
    let c = convDe({ conv: b.id });
    if (!c) {
      c = nuevaConv({ proyecto: String(b.proyecto || ''), sitio: String(b.sitio || ''), url: String(b.url || ''), donde: String(b.donde || '') });
      // Chat que sigue a otro (botón «Terminemos»): queda en la misma cadena del historial que el de origen.
      const origen = b.encadenadoDe ? convs.get(String(b.encadenadoDe)) : null;
      if (origen) c.cadena = origen.cadena || origen.sessionId || '';
      difundir({ tipo: 'conv-nueva', conv: c.id, resumen: resumenConv(c) });
    } else {
      if (b.proyecto !== undefined && String(b.proyecto) !== c.proyecto) { olvidar(c); c.proyecto = String(b.proyecto); }
      for (const k of ['sitio', 'url', 'donde']) if (b[k] !== undefined) c[k] = String(b[k]);
      difundir({ tipo: 'conv-cambio', conv: c.id, resumen: resumenConv(c) });
    }
    return sendJson(res, 200, resumenConv(c));
  }
  if (req.method === 'DELETE' && p.startsWith('/api/conversacion/')) {
    const c = convs.get(path.basename(p));
    if (c) { olvidar(c); convs.delete(c.id); difundir({ tipo: 'conv-cerrada', conv: c.id }); }
    return sendJson(res, 200, { ok: true });
  }
  return NO_ATENDIDA;
}
