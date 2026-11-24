// Rutas HTTP de los medios: capturas de la marca, voz, adjuntos y dictado de audio.
import fs from 'node:fs';
import path from 'node:path';
import { addAdjunto, infoAdj } from './adjuntos.mjs';
import { CONFIG_ARCHIVO, TOPE_ADJUNTO, VOCES } from './constantes.mjs';
import { adjuntos, audios, convs, estado, log, pantallasDir, sesionDir } from './estado.mjs';
import { NO_ATENDIDA, readBody, readRaw, sendFile, sendJson } from './http.mjs';
import { killTree, readConfig, writeJsonFile } from './utilidades.mjs';
import { arrancarVoz, cortarVoz, motorVoz, siguienteVoz, transcribirAudio } from './voz.mjs';

// Devuelve NO_ATENDIDA si el pedido no es de este grupo; cualquier otra cosa (undefined) quiere decir que ya respondió.
export async function rutasMedios(q) {
  const { req, res, esRemoto, url, p } = q;
  // Las capturas de la marca son de la PC (el celular no muestra sus tarjetas) y se numeran p1, p2…: al celular, no.
  if (req.method === 'GET' && /^\/pantallas\/p\d+\.png$/.test(p)) return esRemoto ? (res.writeHead(403), res.end()) : sendFile(res, path.join(pantallasDir, path.basename(p)));
  if (req.method === 'GET' && /^\/voz\/\d+-\d+\.wav$/.test(p)) {
    const wav = audios.get(path.basename(p, '.wav'));
    if (!wav) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'Cache-Control': 'no-store' });
    return res.end(wav);
  }
  if (req.method === 'POST' && p === '/api/voz') {
    // La UI elige la voz (configuración: 'daniela', 'santa' o 'no'), avisa que va a hacer falta (arranca la charla
    // por voz: que se vaya cargando) o corta lo que suena.
    const b = await readBody(req);
    if (b.cortar) { const c = convs.get(String(b.cortar)); if (c) cortarVoz(c); return sendJson(res, 200, { ok: true }); }
    if (b.elegir !== undefined) {
      const cfg = readConfig();
      cfg.voz = VOCES.includes(b.elegir) ? b.elegir : 'no';
      try { writeJsonFile(CONFIG_ARCHIVO, cfg); } catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
      if (estado.voz && !estado.voz.muerto && estado.voz.pidio !== (motorVoz() || VOCES[0])) killTree(estado.voz.proc.pid); // la próxima arranca con la nueva
      return sendJson(res, 200, { ok: true, voz: motorVoz() || 'no' });
    }
    const v = arrancarVoz();
    if (!v) return sendJson(res, 200, { ok: false, error: 'La voz no está instalada en esta compu: corré instalar-voz.ps1.' });
    if (v.listo) siguienteVoz(v); // vuelve a contar la siesta desde ahora
    return sendJson(res, 200, { ok: true, lista: v.listo, motor: v.motor });
  }
  if (req.method === 'GET' && p.startsWith('/adjuntos/')) {
    const a = adjuntos.get(path.basename(p).replace(/\.[^.]+$/, ''));
    return a ? sendFile(res, a.ruta, { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.nombre)}` }, a.tipo) : (res.writeHead(404), res.end());
  }
  if (req.method === 'POST' && p === '/api/adjunto') {
    // Archivo crudo (botón, arrastrar, Ctrl+V) con su nombre en X-Nombre, o JSON {ruta} desde el host.
    const ct = String(req.headers['content-type'] || '');
    let a;
    if (!ct.startsWith('application/json')) {
      const buf = await readRaw(req, TOPE_ADJUNTO);
      if (!buf.length) return sendJson(res, 400, { ok: false, error: 'El archivo está vacío.' });
      const nombre = decodeURIComponent(String(req.headers['x-nombre'] || 'archivo'));
      a = addAdjunto(buf, nombre, String(req.headers['x-origen'] || 'archivo'));
    } else {
      const b = await readBody(req);
      if (b.png) a = addAdjunto(Buffer.from(String(b.png).replace(/^data:[^,]*,/, ''), 'base64'), 'pegado.png', b.origen || 'pegado');
      else if (b.ruta && fs.existsSync(b.ruta) && fs.statSync(b.ruta).size <= TOPE_ADJUNTO) a = addAdjunto(fs.readFileSync(b.ruta), b.nombre || path.basename(b.ruta), b.origen || 'archivo');
      else return sendJson(res, 400, { ok: false, error: 'Falta el archivo.' });
    }
    return sendJson(res, 200, infoAdj(a));
  }
  if (req.method === 'POST' && p === '/api/audio') {
    // Botón del micrófono: lo grabado hasta ahora pasa a texto en esta compu (transcribir.py, faster-whisper).
    // Mientras se habla llegan pedidos ?parcial=1 con todo lo grabado; al cortar, uno final.
    const buf = await readRaw(req, 25 * 1024 * 1024);
    if (!buf.length) return sendJson(res, 400, { ok: false, error: 'El audio está vacío.' });
    const parcial = url.searchParams.get('parcial') === '1';
    const archivo = path.join(sesionDir, `audio-${Date.now()}-${++estado.audioN}.webm`);
    // La voz del usuario toca el disco solo mientras se transcribe: se borra pase lo que pase.
    let r;
    try {
      fs.writeFileSync(archivo, buf);
      r = await transcribirAudio(archivo, parcial);
    } catch (e) {
      r = { error: e.message };
    } finally {
      try { fs.unlinkSync(archivo); } catch { /* ya no está */ }
    }
    if (!parcial || r.error) log('audio', buf.length, 'bytes', r.error ? 'falló: ' + r.error.slice(-300) : 'ok');
    if (r.error) return sendJson(res, 500, { ok: false, error: 'No pude pasar el audio a texto.' });
    return sendJson(res, 200, { ok: true, texto: r.texto || '' });
  }
  if (req.method === 'DELETE' && p.startsWith('/api/adjunto/')) {
    const a = adjuntos.get(path.basename(p));
    if (a && !a.usado) { adjuntos.delete(a.id); try { fs.unlinkSync(a.ruta); } catch { /* idem */ } }
    return sendJson(res, 200, { ok: true });
  }
  return NO_ATENDIDA;
}
