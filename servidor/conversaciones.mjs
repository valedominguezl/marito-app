// Conversaciones (una por pestaña): alta, cierre, vuelta desde el historial, pestañas abiertas, eventos en vivo (SSE) y el historial guardado.
import fs from 'node:fs';
import { entradaHistorial, quedaAlAbrir, sumarAlHistorial } from '../servidor-logica.mjs';
import { MODELOS } from './constantes.mjs';
import {
  abiertasArchivo, clientes, convs, estado, eventosLog, historialArchivo, inicioServidor, leerHistorial, leerInterfaz, log
} from './estado.mjs';
import { ocultarMarca } from './marca.mjs';
import { killTree, writeJsonFile } from './utilidades.mjs';
import { cortarVoz } from './voz.mjs';

// Guarda la conversación (por su sesión de claude) para poder reabrirla desde el historial.
export function guardarEnHistorial(c) {
  if (!c.sessionId || !c.historial.length) return;
  const h = sumarAlHistorial(leerHistorial(), entradaHistorial(c));
  try { writeJsonFile(historialArchivo, h); } catch (e) { log('no pude guardar el historial', e.message); }
}

export function nuevaConv({ proyecto = '', sitio = '', url = '', donde = '' } = {}) {
  const id = 'c' + (++estado.convN);
  const c = { id, proyecto: proyecto || '', sitio, url, donde, titulo: '', historial: [], sessionId: null, turno: null,
    confirmacion: null, primerTurnoHecho: false, turnoN: 0, cancelar: [] };
  convs.set(id, c);
  return c;
}

export function olvidar(c) {
  if (c.confirmacion) c.confirmacion.resolve(false);
  if (c.turno) { c.turno.detenido = true; killTree(c.turno.proc.pid); }
  if (c.comando) { c.comando.detenido = true; killTree(c.comando.proc.pid); }
  c.cancelar.forEach((f) => f()); c.cancelar = [];
  if (estado.marca && estado.marca.conv === c.id) ocultarMarca();
  c.tuto = null;
  cortarVoz(c);
  c.sessionId = null; c.historial = []; c.primerTurnoHecho = false; c.titulo = ''; c.cadena = ''; c.noAprenderSitio = false; c.pendiente = null;
  guardarAbiertas(); // cerrada o de cero: ya no vuelve
}

export const ocupada = (c) => !!(c.turno || c.arrancando || c.confirmacion || c.comando);

export const resumenConv = (c) => ({ id: c.id, proyecto: c.proyecto, sitio: c.sitio, url: c.url, donde: c.donde, titulo: c.titulo, modelo: c.modelo || '',
  ocupado: ocupada(c) });

// Una conversación del historial en una pestaña nueva, que sigue esa sesión de claude (`--resume`).
export function convDelHistorial(h, donde = '') {
  const c = nuevaConv({ proyecto: h.proyecto || '', sitio: h.sitio || '', url: h.url || '', donde });
  c.sessionId = h.sessionId; c.titulo = h.titulo || ''; c.primerTurnoHecho = true; c.cadena = h.cadena || '';
  if (MODELOS.some((m) => m.id === h.modelo)) c.modelo = h.modelo;
  // Una pregunta de publicar que quedó sin contestar (se apagó el servidor) ya no espera a nadie: no publicó.
  c.historial = (h.eventos || []).map((ev) => ({ ...ev, conv: c.id, ...(ev.tipo === 'publicar-confirmar' && !ev.respondida ? { respondida: 'no' } : {}) }));
  return c;
}

export function guardarAbiertas() {
  if (estado.cerrando) return; // al apagar no se toca: es lo que tiene que volver
  const lista = [...convs.values()].filter((c) => c.sessionId).map((c) => ({ sessionId: c.sessionId, donde: c.donde || '' }));
  try { writeJsonFile(abiertasArchivo, lista); } catch (e) { log('no pude guardar abiertas.json', e.message); }
}

// ---- eventos (SSE) ----
// Cada cliente es una pantalla conectada: la ventana de la PC o el celular (r.remoto). Las dos ven lo mismo en vivo.
export function difundir(ev, soloLocales = false) {
  const data = `data: ${JSON.stringify(ev)}\n\n`;
  for (const r of clientes) { if (soloLocales && r.remoto) continue; try { r.write(data); } catch { clientes.delete(r); } }
}

// Se abre la ventana de la PC con el servidor fijo (`/api/entrada` con `abrir`): quedan solo las pestañas que dice
// `quedaAlAbrir` (pedido del usuario el 24/11); el resto pasa al historial, también en el celular. Si no queda ninguna,
// una vacía para lo que había adelante.
export function limpiarAlAbrir() {
  const i = leerInterfaz();
  const cerrar = [...convs.values()].filter((c) => {
    const ultimo = i.ultimo && i.ultimo.conv === c.id && i.ultimo.arranque === inicioServidor ? i.ultimo.texto : '';
    const borrador = (c.sessionId && i.borradores[c.sessionId]) || ultimo;
    return !quedaAlAbrir(c, { borrador, ventanaCerradaEn: estado.ventanaCerradaEn });
  });
  // Si no queda ninguna, la vacía va antes de cerrar: una pantalla conectada (la ventana escondida que se trae, el
  // celular) no saca su última pestaña y la seguía usando ya cerrada; la entrada de Alt+F1 caía ahí y abría otra más.
  if (cerrar.length === convs.size) { const c = nuevaConv(); difundir({ tipo: 'conv-nueva', conv: c.id, resumen: resumenConv(c) }); }
  for (const c of cerrar) { olvidar(c); convs.delete(c.id); difundir({ tipo: 'conv-cerrada', conv: c.id }); }
  if (cerrar.length) log('al abrir se cerraron', cerrar.length, 'pestañas sin nada escrito');
}

export function emit(c, ev) {
  ev = { ...ev, conv: c.id };
  try { fs.appendFileSync(eventosLog, JSON.stringify(ev) + '\n'); } catch { /* idem */ }
  if (!convs.has(c.id)) return; // pestaña cerrada: no se dibuja
  const ultimo = c.historial[c.historial.length - 1];
  if (ev.tipo === 'texto' && ultimo && ultimo.tipo === 'texto') ultimo.delta += ev.delta;
  else c.historial.push({ ...ev });
  difundir(ev);
}
