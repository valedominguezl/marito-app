// Estado compartido del servidor: lo que se calcula al arrancar (iniciarEstado), los contenedores y lo que se reasigna.
// Los export let de acá se asignan una sola vez en iniciarEstado(); los demás módulos los ven ya cargados.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { readJsonFile, writeJsonFile } from './utilidades.mjs';

// Contenedores compartidos (se mutan, nunca se reasignan).
export const clientes = new Set();
export const cancelables = [];
export const adjuntos = new Map();        // id -> { id, ruta, url, nombre, tipo, tamano, imagen, origen, usado }
export const convs = new Map();           // id -> conversación
export const audios = new Map();          // 'loc-n' -> Buffer wav
export const remoto = { server: null, ip: '', puerto: 8790 }; // el celular: una segunda puerta en la dirección de Tailscale

// Lo que se reasigna: un import de ES modules es de solo lectura, así que vive como propiedad de este objeto (estado.x = …).
export const estado = {
  puerto: 0, cerrando: false, convN: 0,
  entradaPendiente: null, // Alt+F2 con el servidor fijo y la ventana cerrada: nadie la escucha, así que la toma la ventana cuando abre
  ventanaCerradaEn: 0,
  marca: null,            // { proc, conv, sacada, salida, tu, info }
  voz: null,              // { proc, buf, listo, motor, error, cola: [{loc, texto, n}], enCurso, muerto }
  locN: 0, vozPedidoN: 0, siestaVoz: null,
  transcriptor: null, audioN: 0, siestaTranscriptor: null,
  server: null,           // el HTTP de la PC (127.0.0.1)
  primera: null,          // la pestaña con la que arrancó el servidor
};

export let sesionDir, parentPid, fijo, servidorArchivo, remotoArchivo, remotoCfg, adjDir, ctx, historialArchivo, inicioServidor, interfazArchivo, token, logFile, log, eventosLog, pantallasDir, abiertasArchivo;

export const leerHistorial = () => { const h = readJsonFile(historialArchivo, []); return Array.isArray(h) ? h : []; };
export const leerInterfaz = () => {
  const i = readJsonFile(interfazArchivo, {});
  return { push: i.push || null, fondo: i.fondo || null, ultimo: i.ultimo || null, borradores: i.borradores && typeof i.borradores === 'object' ? i.borradores : {} };
};
export const guardarInterfaz = (i) => { try { writeJsonFile(interfazArchivo, i); } catch (e) { log('no pude guardar interfaz.json', e.message); } };

export function iniciarEstado() {
  sesionDir = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'arreglo-sesion'));
  parentPid = Number(process.argv[3]) || 0;
  fijo = process.argv.includes('--fijo');
  // servidor.json: dónde está el servidor fijo (lo lee abrir.ps1 para engancharse). remoto.json: { telefono, puerto }.
  servidorArchivo = path.join(path.dirname(sesionDir), 'servidor.json');
  remotoArchivo = path.join(path.dirname(sesionDir), 'remoto.json');
  remotoCfg = fijo ? readJsonFile(remotoArchivo, null) : null;
  // La clave del celular se crea sola la primera vez (servidor-fijo.ps1 -Vincular la muestra y se la pasa a la app).
  if (remotoCfg?.telefono && !(String(remotoCfg.clave || '').length >= 16)) {
    remotoCfg.clave = crypto.randomBytes(24).toString('base64url');
    try { writeJsonFile(remotoArchivo, remotoCfg); } catch (e) { console.error('no pude guardar la clave en remoto.json', e.message); }
  }
  adjDir = path.join(sesionDir, 'adjuntos');
  fs.mkdirSync(adjDir, { recursive: true });
  ctx = readJsonFile(path.join(sesionDir, 'contexto.json'), {});
  historialArchivo = path.join(path.dirname(sesionDir), 'historial.json');
  // Lo que la interfaz recuerda entre aperturas (el puerto cambia cada vez, así que su localStorage no sirve):
  // opciones de Push, el fondo de la ventana, el último borrador de la caja y el borrador de cada conversación del historial.
  inicioServidor = Date.now();
  interfazArchivo = path.join(path.dirname(sesionDir), 'interfaz.json');
  token = ctx.token || crypto.randomBytes(16).toString('hex');
  logFile = path.join(sesionDir, 'server.log');
  log = (...a) => { try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${a.join(' ')}\n`); } catch { /* sin log no pasa nada */ } };
  eventosLog = path.join(sesionDir, 'eventos.jsonl');
  // Las pestañas abiertas con conversación (abiertas.json): si el servidor se apaga (Shift+× sin servidor fijo, un
  // reinicio del fijo, la PC que se reinicia), al arrancar vuelven como estaban, con su borrador. Cerrar una la saca.
  abiertasArchivo = path.join(path.dirname(sesionDir), 'abiertas.json');
  pantallasDir = path.join(sesionDir, 'pantallas');
  remoto.puerto = Number(remotoCfg?.puerto) || 8790;
}
