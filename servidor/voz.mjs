// La voz de Marito (voz.py: Daniela de Piper o Santa de Kokoro) y el transcriptor del dictado (transcribir.py).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cortarHablable, partirFrases, textoHablado } from '../servidor-logica.mjs';
import { AQUI, VOCES, VOZ_AUDIO_MS, VOZ_PY, VOZ_SIESTA_MS } from './constantes.mjs';
import { difundir } from './conversaciones.mjs';
import { audios, estado, fijo, log } from './estado.mjs';
import { killTree, readConfig } from './utilidades.mjs';

// La voz elegida en la configuración («Voz»): 'daniela', 'santa' o null (sin voz, lo de entrada). La charla por voz
// habla igual: con la elegida o, sin ninguna, con Daniela.
export function motorVoz() {
  const v = readConfig().voz;
  return VOCES.includes(v) ? v : null;
}

export function arrancarVoz(motor = motorVoz() || VOCES[0]) {
  if (estado.voz && !estado.voz.muerto && estado.voz.pidio === motor) return estado.voz;
  if (estado.voz && !estado.voz.muerto) killTree(estado.voz.proc.pid); // cambió de voz: la vieja se va (lo que esperaba se avisa como error)
  if (!fs.existsSync(VOZ_PY)) return null;
  const proc = spawn(VOZ_PY, ['-X', 'utf8', path.join(AQUI, 'voz.py'), '--servidor', '--motor', motor], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const v = { proc, pidio: motor, buf: '', listo: false, motor: '', error: '', cola: [], enCurso: null, muerto: false };
  proc.stdout.on('data', (d) => {
    v.buf += d.toString('utf8');
    let i;
    while ((i = v.buf.indexOf('\n')) >= 0) {
      const linea = v.buf.slice(0, i).trim(); v.buf = v.buf.slice(i + 1);
      let o; try { o = JSON.parse(linea); } catch { continue; }
      respuestaVoz(v, o);
    }
  });
  proc.stderr.on('data', (d) => { const s = d.toString().trim(); if (s) log('voz', s.slice(-300)); });
  const caida = () => {
    if (v.muerto) return;
    v.muerto = true;
    if (estado.voz === v) estado.voz = null;
    const pendientes = [...(v.enCurso ? [v.enCurso] : []), ...v.cola];
    v.cola = []; v.enCurso = null;
    for (const p of pendientes) { clearTimeout(p.tope); parteLista(p, null, v.error || 'La voz se cerró.'); }
  };
  proc.on('close', caida);
  proc.on('error', (e) => { v.error = `No pude arrancar la voz: ${e.message}`; caida(); });
  proc.stdin.on('error', () => {});
  estado.voz = v;
  log('voz arrancando', motor);
  return v;
}

function respuestaVoz(v, o) {
  if (o.listo !== undefined) {
    if (o.listo) { v.listo = true; v.motor = o.motor; log('voz lista', o.motor); siguienteVoz(v); }
    else v.error = String(o.error || 'No pude cargar la voz.'); // sale enseguida: `caida` avisa a las que esperaban
    return;
  }
  const p = v.enCurso;
  if (!p || p.id !== o.id) return;
  clearTimeout(p.tope); v.enCurso = null;
  parteLista(p, o.wav ? Buffer.from(o.wav, 'base64') : null, o.error);
  siguienteVoz(v);
}

export function siguienteVoz(v) {
  clearTimeout(estado.siestaVoz);
  if (!v.listo || v.enCurso || v.muerto) return;
  const p = v.cola.shift();
  if (!p) {
    estado.siestaVoz = setTimeout(() => { if (estado.voz === v && !v.enCurso && !v.cola.length) { log('voz a dormir'); killTree(v.proc.pid); } }, VOZ_SIESTA_MS);
    estado.siestaVoz.unref?.();
    return;
  }
  p.id = ++estado.vozPedidoN; v.enCurso = p;
  p.tope = setTimeout(() => { v.error = 'La voz tardó más de un minuto en una frase.'; killTree(v.proc.pid); }, 60000);
  v.proc.stdin.write(JSON.stringify({ id: p.id, texto: p.texto }) + '\n');
}

export function nuevaLocucion(c) {
  cortarVoz(c);
  c.loc = { id: ++estado.locN, conv: c.id, partes: 0, pendientes: 0, cerrada: false, cortada: false, avisada: false, error: '' };
  return c.loc;
}

// Texto ya pasado a «hablado» → frases a la cola de la voz.
export function decir(loc, texto) {
  let frases = partirFrases(texto);
  if (!frases.length || loc.cortada) return;
  // La primera de la locución, más corta (hasta una coma): cuanto antes suena algo, menos se nota la espera.
  if (!loc.partes && frases[0].length > 90) frases = [...partirFrases(frases[0], { corta: 0, larga: 90 }), ...frases.slice(1)];
  const v = arrancarVoz();
  if (!v) { loc.error ||= 'La voz no está instalada en esta compu (instalar-voz.ps1).'; return; }
  for (const f of frases) { loc.pendientes++; v.cola.push({ loc, texto: f, n: ++loc.partes }); }
  siguienteVoz(v);
}

function parteLista(p, wav, error) {
  const loc = p.loc;
  loc.pendientes--;
  if (!loc.cortada && wav) {
    const clave = `${loc.id}-${p.n}`;
    audios.set(clave, wav);
    setTimeout(() => audios.delete(clave), VOZ_AUDIO_MS).unref?.();
    difundir({ tipo: 'voz', conv: loc.conv, loc: loc.id, url: `/voz/${clave}.wav` }, true); // solo la PC: el celular no habla
  } else if (!loc.cortada && error) { loc.error = String(error); log('voz falló', loc.error.slice(-300)); }
  finLocucion(loc);
}

export function cerrarLocucion(loc) { if (loc) { loc.cerrada = true; finLocucion(loc); } }

// Cuando ya se mandó todo lo de una locución cerrada: la UI sabe que, al terminar de sonar, Marito terminó de hablar
// (en la charla por voz, vuelve a escuchar).
function finLocucion(loc) {
  if (!loc.cerrada || loc.pendientes > 0 || loc.cortada || loc.avisada) return;
  loc.avisada = true;
  difundir({ tipo: 'voz-fin', conv: loc.conv, loc: loc.id, ...(loc.error ? { error: loc.error } : {}) }, true);
}

export function cortarVoz(c) {
  const loc = c.loc;
  if (!loc) return;
  c.loc = null; loc.cortada = true;
  if (estado.voz) estado.voz.cola = estado.voz.cola.filter((p) => p.loc !== loc);
  difundir({ tipo: 'voz-cortar', conv: c.id, loc: loc.id }, true);
}

// Turno hablado: lo que ya llegó completo (hasta un fin de oración) va a la voz mientras Claude sigue escribiendo.
export function alimentarVoz(c, t, final) {
  const loc = c.loc;
  if (!t.hablar || !loc || loc.cortada) return;
  const resto = t.texto.slice(t.vozDesde);
  const n = final ? resto.length : cortarHablable(resto);
  if (!n) return;
  const hablado = textoHablado(resto.slice(0, n));
  if (!final && hablado.length < 40) return; // pedacitos sueltos («Mirá:») esperan a juntarse con lo que sigue
  t.vozDesde += n;
  decir(loc, hablado);
}

export function arrancarTranscriptor() {
  if (!estado.transcriptor || estado.transcriptor.proc.exitCode !== null) {
    // El entorno de la voz si ya trae faster-whisper (instalar-voz.ps1); si no, el Python de la PC.
    const conWhisper = fs.existsSync(path.join(path.dirname(path.dirname(VOZ_PY)), 'Lib', 'site-packages', 'faster_whisper'));
    const proc = spawn(conWhisper ? VOZ_PY : 'python', ['-X', 'utf8', path.join(AQUI, 'transcribir.py'), '--servidor'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const tr = { proc, buf: '', esperando: new Map(), n: 0 };
    proc.stdout.on('data', (d) => {
      tr.buf += d.toString('utf8');
      let i;
      while ((i = tr.buf.indexOf('\n')) >= 0) {
        const linea = tr.buf.slice(0, i).trim(); tr.buf = tr.buf.slice(i + 1);
        let o; try { o = JSON.parse(linea); } catch { continue; }
        const f = tr.esperando.get(o.id); tr.esperando.delete(o.id); if (f) f(o);
      }
    });
    proc.stderr.on('data', (d) => log('transcriptor', d.toString().trim().slice(-300)));
    const caido = () => { for (const f of tr.esperando.values()) f({ error: 'El transcriptor se cerró.' }); tr.esperando.clear(); };
    proc.on('close', caido); proc.on('error', caido);
    proc.stdin.on('error', () => {});
    estado.transcriptor = tr;
  }
  return estado.transcriptor;
}

export function transcribirAudio(ruta, parcial) {
  const tr = arrancarTranscriptor();
  if (fijo) {
    clearTimeout(estado.siestaTranscriptor);
    estado.siestaTranscriptor = setTimeout(() => { if (estado.transcriptor === tr && !tr.esperando.size) { killTree(tr.proc.pid); estado.transcriptor = null; } }, 10 * 60 * 1000);
    estado.siestaTranscriptor.unref?.();
  }
  const id = ++tr.n;
  return new Promise((resolve) => {
    // Colgado: atiende de a uno, así que todo dictado siguiente esperaría detrás. Se mata (los que esperaban reciben
    // «se cerró») y el próximo audio arranca otro.
    const tope = setTimeout(() => {
      tr.esperando.delete(id); resolve({ error: 'Tardó más de 3 minutos.' });
      if (estado.transcriptor === tr) estado.transcriptor = null;
      killTree(tr.proc.pid);
    }, 180000);
    tr.esperando.set(id, (o) => { clearTimeout(tope); resolve(o); });
    tr.proc.stdin.write(JSON.stringify({ id, ruta, parcial }) + '\n');
  });
}
