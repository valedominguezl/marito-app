// Leer las capturas de marcar.ps1 (PNG de System.Drawing) y ver si la pantalla cambió después de un click, sin
// dependencias: zlib de Node y los filtros de cada fila del PNG.
import zlib from 'node:zlib';

const CANALES = { 0: 1, 2: 3, 4: 2, 6: 4 }; // gris, RGB, gris+alfa, RGBA (8 bits; las capturas son RGB o RGBA)

// { w, h, canales, data }: data son los bytes sin filtro, fila tras fila. Solo 8 bits por canal, sin entrelazado ni
// paleta (lo que deja System.Drawing); otra cosa tira error.
export function leerPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('no es un PNG');
  let i = 8, w = 0, h = 0, canales = 0;
  const idat = [];
  while (i < buf.length) {
    const largo = buf.readUInt32BE(i), tipo = buf.toString('latin1', i + 4, i + 8), datos = buf.subarray(i + 8, i + 8 + largo);
    if (tipo === 'IHDR') {
      w = datos.readUInt32BE(0); h = datos.readUInt32BE(4);
      if (datos[8] !== 8 || datos[12] !== 0 || !CANALES[datos[9]]) throw new Error('PNG de un formato que no leo');
      canales = CANALES[datos[9]];
    } else if (tipo === 'IDAT') idat.push(datos);
    else if (tipo === 'IEND') break;
    i += 12 + largo;
  }
  const crudo = zlib.inflateSync(Buffer.concat(idat));
  const fila = w * canales, data = Buffer.alloc(fila * h);
  for (let y = 0; y < h; y++) {
    const filtro = crudo[y * (fila + 1)], src = y * (fila + 1) + 1, dst = y * fila;
    for (let x = 0; x < fila; x++) {
      const a = x >= canales ? data[dst + x - canales] : 0;
      const b = y ? data[dst - fila + x] : 0;
      const c = y && x >= canales ? data[dst - fila + x - canales] : 0;
      let pred = 0;
      if (filtro === 1) pred = a;
      else if (filtro === 2) pred = b;
      else if (filtro === 3) pred = (a + b) >> 1;
      else if (filtro === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      data[dst + x] = (crudo[src + x] + pred) & 255;
    }
  }
  return { w, h, canales, data };
}

const dentro = (r, x, y) => r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const agrandar = (r, m) => r && { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };

// Cuánto cambió la imagen entre dos capturas de la misma pantalla, en `zona` (px de la imagen; sin zona, toda) y sin
// lo que tapa `sin` (Marito: su chat cambia solo). Cuenta por separado lo que cambió en `objetivo` (el control tocado:
// pasar el mouse lo resalta) y fuera de él. Mira un punto de cada 2×2 (un cambio de menos de 2 px no importa) y un
// punto cambia si algún canal se mueve más de 24 (el PNG no pierde nada: el umbral es para el parpadeo del suavizado).
export function contarCambios(a, b, { zona = null, sin = [], objetivo = null } = {}) {
  if (a.w !== b.w || a.h !== b.h) return { distinta: true, fuera: Infinity, dentro: 0, mirados: 0 };
  const z = zona ? { x: Math.max(0, zona.x), y: Math.max(0, zona.y), x2: Math.min(a.w, zona.x + zona.w), y2: Math.min(a.h, zona.y + zona.h) }
    : { x: 0, y: 0, x2: a.w, y2: a.h };
  const obj = agrandar(objetivo, 10);
  let fuera = 0, enObjetivo = 0, mirados = 0;
  for (let y = z.y; y < z.y2; y += 2) {
    for (let x = z.x; x < z.x2; x += 2) {
      if (sin.some((r) => dentro(r, x, y))) continue;
      mirados++;
      const ia = (y * a.w + x) * a.canales, ib = (y * b.w + x) * b.canales;
      let cambio = false;
      for (let k = 0; k < Math.min(3, a.canales, b.canales); k++) if (Math.abs(a.data[ia + k] - b.data[ib + k]) > 24) { cambio = true; break; }
      if (!cambio) continue;
      if (dentro(obj, x, y)) enObjetivo++; else fuera++;
    }
  }
  return { distinta: false, fuera, dentro: enObjetivo, mirados };
}
