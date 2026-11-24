// Rutas HTTP de lo que se manda a hacer: mensajes, comandos, detener, tutorial, publicar y cerrar.
import { apagar } from './ciclo.mjs';
import { emit, ocupada, olvidar } from './conversaciones.mjs';
import { estado, log } from './estado.mjs';
import { NO_ATENDIDA, convDe, readBody, sendJson } from './http.mjs';
import { avisarTuto, irAlPaso, ocultarMarca, pausarTuto, volverAlPaso } from './marca.mjs';
import { publicarPendiente } from './publicacion.mjs';
import { correrComando } from './terminal.mjs';
import { iniciarTurno } from './turnos.mjs';
import { killTree } from './utilidades.mjs';
import { cortarVoz } from './voz.mjs';

// Devuelve NO_ATENDIDA si el pedido no es de este grupo; cualquier otra cosa (undefined) quiere decir que ya respondió.
export async function rutasTurnos(q) {
  const { req, res, esRemoto, p } = q;
  if (req.method === 'POST' && p === '/api/mensaje') {
    const b = await readBody(req);
    const c = convDe(b);
    if (!c) return sendJson(res, 404, { ok: false, error: 'Esa pestaña ya no existe.' });
    const texto = String(b.texto || '').trim();
    if (!texto && !(b.adjuntos || []).length) return sendJson(res, 400, { ok: false, error: 'Mensaje vacío.' });
    if (ocupada(c)) return sendJson(res, 409, { ok: false, error: 'Esta conversación todavía está corriendo.' });
    if (b.proyecto !== undefined && String(b.proyecto) !== c.proyecto) { olvidar(c); c.proyecto = String(b.proyecto); }
    const r = await iniciarTurno(c, { texto: texto || 'Mirá los adjuntos.', ids: b.adjuntos, modelo: b.modelo, esfuerzo: b.esfuerzo, commit: b.commit, push: b.push, cliente: b.cliente,
      hablar: b.voz === true, desdeCelular: !!esRemoto });
    return r.ok ? sendJson(res, 200, { ok: true }) : sendJson(res, r.status || 500, { ok: false, error: r.error });
  }
  if (req.method === 'POST' && p === '/api/comando') {
    const b = await readBody(req);
    const c = convDe(b);
    if (!c) return sendJson(res, 404, { ok: false, error: 'Esa pestaña ya no existe.' });
    const comando = String(b.comando || '').trim();
    if (!comando) return sendJson(res, 400, { ok: false, error: 'Comando vacío.' });
    if (ocupada(c)) return sendJson(res, 409, { ok: false, error: 'Esta conversación todavía está corriendo.' });
    correrComando(c, comando);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && p === '/api/detener') {
    const c = convDe(await readBody(req));
    if (c) cortarVoz(c);
    if (c?.comando) { c.comando.detenido = true; killTree(c.comando.proc.pid); return sendJson(res, 200, { ok: true }); }
    if (!c?.turno) return sendJson(res, 200, { ok: false });
    c.turno.detenido = true; killTree(c.turno.proc.pid);
    return sendJson(res, 200, { ok: true });
  }
  // El tutorial de la marca (botón de la lista de pasos en el chat): salir (queda en pausa), volver al mismo paso,
  // terminado, repetirlo desde el paso 1 (pedido del usuario el 23/11: sin un turno nuevo, en el mismo chat) o ir a un
  // paso cualquiera tocando su renglón (`paso`, con `n` desde 1; 24/11).
  if (req.method === 'POST' && p === '/api/tutorial') {
    const b = await readBody(req);
    const c = convDe(b);
    const tu = c?.tuto;
    const salto = b.accion === 'repetir' || b.accion === 'paso';
    if (!tu || tu.id !== b.id || (tu.fin && !salto)) return sendJson(res, 409, { ok: false, error: 'Ese paso a paso ya no está.' });
    if (salto) {
      if (b.accion === 'repetir' && !tu.fin) return sendJson(res, 409, { ok: false, error: 'Ese paso a paso todavía no terminó.' });
      if (ocupada(c)) return sendJson(res, 409, { ok: false, error: 'Esperá que termine la respuesta.' });
      if (!irAlPaso(c, tu, b.accion === 'repetir' ? 1 : Number(b.n))) return sendJson(res, 400, { ok: false, error: 'Ese paso no está en la lista.' });
      return sendJson(res, 200, { ok: true });
    }
    if (b.accion === 'salir') {
      if (estado.marca?.tu === tu) ocultarMarca(); else pausarTuto(c, tu);
      return sendJson(res, 200, { ok: true });
    }
    if (b.accion !== 'volver') return sendJson(res, 400, { ok: false, error: 'Falta qué hacer.' });
    if (ocupada(c)) return sendJson(res, 409, { ok: false, error: 'Esperá que termine la respuesta.' });
    // Solo desde la pausa: un doble click (o volver mientras busca el paso) no arranca otra búsqueda que corte la primera.
    if (estado.marca?.tu !== tu && tu.pausado) {
      ocultarMarca();
      tu.pausado = false;
      avisarTuto(c, tu);
      volverAlPaso(c, tu).catch((e) => log('volver al tutorial', e.message));
    }
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && p === '/api/publicar') {
    const b = await readBody(req);
    const c = convDe(b);
    if (!c?.confirmacion) return sendJson(res, 409, { ok: false, error: 'No hay nada que confirmar.' });
    c.confirmacion.resolve(b.confirmar === true);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && p === '/api/publicar-ahora') {
    const c = convDe(await readBody(req));
    if (!c?.pendiente) return sendJson(res, 409, { ok: false, error: 'No hay commits sin publicar en esta conversación.' });
    if (c.turno || c.arrancando || c.confirmacion) return sendJson(res, 409, { ok: false, error: 'Esta conversación todavía está corriendo.' });
    publicarPendiente(c).catch((e) => emit(c, { tipo: 'publicacion', paso: 'fallo', texto: `Falló la publicación: ${e.message}` }));
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && p === '/api/cerrar') {
    if (esRemoto) return sendJson(res, 403, { ok: false, error: 'Desde el celular no se apaga Marito.' });
    sendJson(res, 200, { ok: true }); setTimeout(apagar, 50); return;
  }
  return NO_ATENDIDA;
}
