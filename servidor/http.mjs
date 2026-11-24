// Servidor HTTP: lectura de pedidos, archivos, puerta de la PC (token) y del celular (IP + clave) y el reparto a los grupos de rutas.
import fs from 'node:fs';
import path from 'node:path';
import { accesoRemoto, claveDe, claveValida } from '../servidor-logica.mjs';
import { UI_DIR } from './constantes.mjs';
import { convs, estado, log, remoto, remotoCfg, token } from './estado.mjs';
import { rutasInterfaz } from './rutas-interfaz.mjs';
import { rutasMedios } from './rutas-medios.mjs';
import { rutasTurnos } from './rutas-turnos.mjs';

// ---- HTTP ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json', '.mp3': 'audio/mpeg' };

export const sendJson = (res, status, obj) => { const b = JSON.stringify(obj); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); };

export function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    let n = 0; const partes = [];
    req.on('data', (d) => { n += d.length; if (n > max) { reject(new Error('El archivo es muy grande (máximo 60 MB).')); req.destroy(); } else partes.push(d); });
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

export async function readBody(req, max = 40 * 1024 * 1024) {
  const s = (await readRaw(req, max)).toString('utf8').replace(/^﻿/, '');
  return s ? JSON.parse(s) : {};
}

export function sendFile(res, file, extra = {}, tipo) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('no está'); return; }
    res.writeHead(200, { 'Content-Type': tipo || MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(data);
  });
}

function cookieToken(req) {
  const m = /(?:^|;\s*)arreglo=([^;]+)/.exec(req.headers.cookie || '');
  return m ? m[1] : '';
}

export const convDe = (b) => convs.get(String(b.conv || '')) || null;

export const NO_ATENDIDA = Symbol('no atendida'); // lo que devuelve un grupo de rutas cuando el pedido no es suyo

// esRemoto: llegó por la puerta del celular. Ahí la llave es la IP del teléfono (accesoRemoto) en vez del token;
// a cualquier otro se le corta la conexión sin responder nada.
export async function atender(req, res, esRemoto) {
  try {
    const host = req.headers.host || '';
    const origen = req.headers.origin;
    if (esRemoto) {
      if (!accesoRemoto({ ip: req.socket.remoteAddress, host, origen, telefono: remotoCfg?.telefono, ipLocal: remoto.ip, puerto: remoto.puerto })) {
        log('remoto: rechazado', req.socket.remoteAddress, host, origen || '');
        req.socket.destroy(); return;
      }
      const u = new URL(req.url, `http://${host}`);
      const dada = claveDe({ header: req.headers['x-clave'], cookie: req.headers.cookie, query: u.searchParams.get('c') });
      if (!claveValida(dada, remotoCfg.clave)) {
        log('remoto: sin clave', req.method, u.pathname);
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Falta vincular este teléfono con Marito.'); return;
      }
      // El link de vinculación deja la clave en una cookie (400 días, lo más que guarda Chrome) y vuelve a la página limpia.
      if (req.method === 'GET' && u.pathname === '/' && u.searchParams.has('c')) {
        res.writeHead(302, { Location: '/', 'Set-Cookie': `marito=${dada}; Path=/; Max-Age=34560000; HttpOnly; SameSite=Strict`, 'Cache-Control': 'no-store' });
        res.end(); return;
      }
    } else {
      if (host !== `127.0.0.1:${estado.puerto}` && host !== `localhost:${estado.puerto}`) { res.writeHead(403); res.end(); return; }
      if (origen && origen !== `http://127.0.0.1:${estado.puerto}` && origen !== `http://localhost:${estado.puerto}`) { res.writeHead(403); res.end(); return; }
    }
    const url = new URL(req.url, `http://${host}`);
    if (!esRemoto) {
      const dado = req.headers['x-token'] || url.searchParams.get('t') || cookieToken(req);
      if (dado !== token) { res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('sin token'); return; }
    }
    const p = decodeURIComponent(url.pathname);
    const cookie = esRemoto ? {} : { 'Set-Cookie': `arreglo=${token}; Path=/; HttpOnly; SameSite=Strict` };

      const q = { req, res, esRemoto, url, p, cookie };
      if ((await rutasInterfaz(q)) !== NO_ATENDIDA) return;
      if ((await rutasMedios(q)) !== NO_ATENDIDA) return;
      if ((await rutasTurnos(q)) !== NO_ATENDIDA) return;
    if (req.method === 'GET') {
      // Estáticos de la interfaz: /ui/x o, por comodidad, /x directo.
      const rel = p.replace(/^\/ui\//, '/').replace(/^\/+/, '');
      const file = path.resolve(UI_DIR, rel);
      if (file.startsWith(UI_DIR + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(res, file);
    }
    res.writeHead(404); res.end('no está');
  } catch (e) {
    log('error http', e.stack || e.message);
    try { sendJson(res, 400, { ok: false, error: e.message }); } catch { /* ya respondido */ }
  }
}
