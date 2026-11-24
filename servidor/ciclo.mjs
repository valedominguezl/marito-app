// Ciclo de vida: apagar el servidor y la segunda puerta del celular por Tailscale.
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { esIpTailscale, pideConectores, pideProyecto } from '../servidor-logica.mjs';
import { guardarAbiertas, guardarEnHistorial } from './conversaciones.mjs';
import { cancelables, clientes, convs, estado, fijo, log, remoto, remotoCfg, servidorArchivo } from './estado.mjs';
import { atender } from './http.mjs';
import { ocultarMarca } from './marca.mjs';
import { killTree, readJsonFile } from './utilidades.mjs';

export function apagar() {
  if (estado.cerrando) return;
  // Un turno a medias (un -Reiniciar del fijo, Shift+× con algo corriendo) se guarda cortado: el historial solo se
  // escribía en finTurno y se perdía el último pedido. Queda cerrado (`turno-fin`) para que al volver no parezca corriendo.
  // También uno que ya terminó pero todavía no dio su `turno-fin`: finTurno mirando git, o el puente de
  // [CONECTORES]/[PROYECTO] mientras arranca el que sigue (`c.turno` sigue siendo el viejo). `t.cerrado` lo frena ahí.
  for (const c of convs.values()) {
    const t = c.turno;
    if (!t || t.cerrado) continue;
    // Respuesta entera (finTurno mirando git, sin puente que siga): se guarda bien terminada, no «Se cortó».
    const r = t.terminado ? t.resultado : null;
    const entera = !!r && !r.is_error && !t.detenido && !t.tope && !pideConectores(t.texto)
      && (t.pedido.cambioProyecto || pideProyecto(t.texto) === null);
    t.terminado = true; t.cerrado = true; // finTurno ya no lo cierra de nuevo cuando muera el proceso
    if (!entera) c.historial.push({ tipo: 'error', conv: c.id, texto: 'Se cortó: Marito se apagó en medio de la respuesta.' });
    c.historial.push({ tipo: 'turno-fin', conv: c.id, id: t.id, costoUsd: t.costoPrevio + (entera ? r.total_cost_usd ?? 0 : 0), segundos: Math.round((Date.now() - t.inicio) / 1000),
      cambio: false, ok: entera, detenido: !entera, contexto: t.contexto || 0 });
    guardarEnHistorial(c);
  }
  guardarAbiertas(); // la primera respuesta de una pestaña todavía no la había anotado
  estado.cerrando = true;
  log('apagando');
  if (estado.transcriptor) killTree(estado.transcriptor.proc.pid);
  ocultarMarca();
  if (estado.voz) killTree(estado.voz.proc.pid);
  for (const c of convs.values()) {
    if (c.confirmacion) c.confirmacion.resolve(false);
    if (c.turno) killTree(c.turno.proc.pid);
    if (c.comando) { c.comando.detenido = true; killTree(c.comando.proc.pid); } // lo lanzado desde la terminal (un npm run dev) no queda huérfano
  }
  cancelables.forEach((f) => f());
  for (const r of clientes) { try { r.end(); } catch { /* idem */ } }
  estado.server.close();
  if (remoto.server) remoto.server.close();
  if (fijo && readJsonFile(servidorArchivo, {}).pid === process.pid) { try { fs.unlinkSync(servidorArchivo); } catch { /* ya no está */ } }
  setTimeout(() => process.exit(0), 400);
}

function ipTailscale() {
  for (const lista of Object.values(os.networkInterfaces())) for (const a of lista || []) if (a.family === 'IPv4' && esIpTailscale(a.address)) return a.address;
  return '';
}

// Tailscale puede arrancar después que nosotros (al iniciar Windows) o cambiar de dirección: se revisa cada 30 s.
export function vigilarRemoto() {
  if (estado.cerrando) return;
  const ip = ipTailscale();
  if (remoto.server && remoto.ip === ip) return;
  if (remoto.server) { log('remoto: cambió la IP de Tailscale', remoto.ip, '->', ip || '(ninguna)'); remoto.server.close(); remoto.server = null; }
  if (!ip) return;
  const s = http.createServer((req, res) => atender(req, res, true));
  s.on('error', (e) => { log('remoto: no pude escuchar en', ip, remoto.puerto, e.message); if (remoto.server === s) remoto.server = null; });
  s.listen(remoto.puerto, ip, () => { log('remoto: escuchando en', ip, remoto.puerto, 'solo para', remotoCfg.telefono); });
  remoto.server = s; remoto.ip = ip;
}
