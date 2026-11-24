// Arranque del servidor: prepara el estado, las pestañas que vuelven, el HTTP y los avisos de cierre.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { addAdjunto, limpiarViejos, nombreCaptura } from './adjuntos.mjs';
import { apagar, vigilarRemoto } from './ciclo.mjs';
import { convDelHistorial, nuevaConv } from './conversaciones.mjs';
import {
  abiertasArchivo, clientes, convs, ctx, estado, fijo, iniciarEstado, leerHistorial, leerInterfaz, log, parentPid, remotoCfg,
  servidorArchivo, sesionDir, token
} from './estado.mjs';
import { atender } from './http.mjs';
import { sumarExtra } from './proyectos.mjs';
import { findRepos, readConfig, readJsonFile, vscodeFolders, writeJsonFile } from './utilidades.mjs';
import { arrancarTranscriptor } from './voz.mjs';

export function main() {
  iniciarEstado();
  if (ctx.carpeta) ctx.proyecto = sumarExtra(ctx.carpeta) || ctx.proyecto;
  setImmediate(() => {
    // Las carpetas de VS Code que contienen proyectos conocidos o la carpeta raíz (Escritorio, «La Esquina» con su
    // «Web\Repo» adentro) no suman: abrir.ps1 ya las lleva al proyecto de adentro.
    try {
      const cfg = readConfig();
      const debajo = [cfg.raiz, ...(cfg.proyectos || []).map((p) => p.carpeta)].filter(Boolean).map((c) => c.toLowerCase());
      for (const c of vscodeFolders()) {
        const k = c.toLowerCase() + path.sep;
        if (!debajo.some((d) => d.startsWith(k))) sumarExtra(c);
      }
    } catch (e) { log('vscode', e.message); }
    const out = []; const cfg = readConfig();
    if (cfg.raiz) findRepos(cfg.raiz, 0, out);
    for (const c of out) sumarExtra(c);
  });
  // Solo vuelven las que tienen algo escrito sin mandar (borrador o cola): las demás quedan en el historial y se
  // arranca con un chat nuevo (pedido del usuario el 24/11).
  {
    const abiertas = readJsonFile(abiertasArchivo, []);
    const historial = Array.isArray(abiertas) && abiertas.length ? leerHistorial() : [];
    const borradores = Array.isArray(abiertas) && abiertas.length ? leerInterfaz().borradores || {} : {};
    for (const a of Array.isArray(abiertas) ? abiertas : []) {
      if (!String(borradores[a?.sessionId] || '').trim()) continue;
      const h = historial.find((x) => x.sessionId === a?.sessionId);
      if (h && ![...convs.values()].some((x) => x.sessionId === h.sessionId)) convDelHistorial(h, String(a.donde || ''));
    }
    if (convs.size) log('pestañas que vuelven', convs.size);
  }
  if (!readConfig().raiz) ctx.proyecto = '';
  estado.primera = nuevaConv({ proyecto: ctx.proyecto || '', sitio: ctx.sitio || '', url: String(ctx.url || ''), donde: ctx.donde || '' });
  if (ctx.captura && fs.existsSync(ctx.captura)) addAdjunto(fs.readFileSync(ctx.captura), nombreCaptura(ctx.origenCaptura), ctx.origenCaptura || 'ventana', ctx.notaCaptura);
  limpiarViejos();
  setInterval(limpiarViejos, 6 * 3600 * 1000).unref?.();
  estado.server = http.createServer((req, res) => atender(req, res, false));
  estado.server.listen(0, '127.0.0.1', () => {
    estado.puerto = estado.server.address().port;
    fs.writeFileSync(path.join(sesionDir, 'puerto.txt'), String(estado.puerto));
    console.log(`PUERTO ${estado.puerto}`);
    log('escuchando', estado.puerto, fijo ? '(fijo)' : '');
    if (fijo) {
      writeJsonFile(servidorArchivo, { puerto: estado.puerto, token, pid: process.pid, sesion: sesionDir });
      if (remotoCfg?.telefono) { vigilarRemoto(); setInterval(vigilarRemoto, 30000).unref?.(); }
    } else arrancarTranscriptor(); // con la ventana recién abierta conviene tenerlo listo; fijo, se carga al primer audio
  });
  // Si quien nos abrió desaparece (la ventana se cerró de golpe), no quedamos colgados.
  if (parentPid) {
    setInterval(() => { try { process.kill(parentPid, 0); } catch { apagar(); } }, 3000).unref?.();
  }
  setInterval(() => { for (const r of clientes) { try { r.write(': ka\n\n'); } catch { clientes.delete(r); } } }, 15000).unref?.();
  process.on('SIGINT', apagar); process.on('SIGTERM', apagar);
  process.on('uncaughtException', (e) => { log('uncaught', e.stack || e.message); });
}
