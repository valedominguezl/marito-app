// servidor/png.mjs (leer capturas y contar cambios) y la decisión de «el click no hizo nada» (servidor-logica.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { leerPng, contarCambios } from '../servidor/png.mjs';
import { quedoIgual, zonasComparar } from '../servidor-logica.mjs';

// Un PNG RGB de w×h con cada fila filtrada con `filtros[y % n]` (0..4), como los que deja System.Drawing.
function armarPng(w, h, pixel, filtros = [0, 1, 2, 3, 4]) {
  const crudo = Buffer.alloc(h * (w * 3 + 1)), fila = w * 3;
  const px = (x, y) => (x < 0 || y < 0 ? [0, 0, 0] : pixel(x, y));
  for (let y = 0; y < h; y++) {
    const f = filtros[y % filtros.length];
    crudo[y * (fila + 1)] = f;
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < 3; k++) {
        const v = px(x, y)[k], a = px(x - 1, y)[k], b = px(x, y - 1)[k], c = px(x - 1, y - 1)[k];
        let pred = 0;
        if (f === 1) pred = a; else if (f === 2) pred = b; else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        crudo[y * (fila + 1) + 1 + x * 3 + k] = (v - pred) & 255;
      }
    }
  }
  const trozo = (tipo, datos) => { const l = Buffer.alloc(4); l.writeUInt32BE(datos.length); return Buffer.concat([l, Buffer.from(tipo, 'latin1'), datos, Buffer.alloc(4)]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo('IHDR', ihdr), trozo('IDAT', zlib.deflateSync(crudo)), trozo('IEND', Buffer.alloc(0))]);
}

const dibujo = (x, y) => [(x * 37 + y * 11) & 255, (x * y) & 255, (200 - x + y * 3) & 255];

test('leerPng: los cinco filtros de fila dan los mismos píxeles', () => {
  const img = leerPng(armarPng(23, 17, dibujo));
  assert.equal(img.w, 23); assert.equal(img.h, 17); assert.equal(img.canales, 3);
  for (const [x, y] of [[0, 0], [22, 0], [5, 4], [22, 16], [11, 13]]) {
    assert.deepEqual([...img.data.subarray((y * 23 + x) * 3, (y * 23 + x) * 3 + 3)], dibujo(x, y), `${x},${y}`);
  }
});

test('contarCambios: igual, un cambio dentro del control y uno fuera; Marito no cuenta', () => {
  const a = leerPng(armarPng(40, 30, dibujo));
  assert.deepEqual(contarCambios(a, a), { distinta: false, fuera: 0, dentro: 0, mirados: 300 });
  const conCuadro = (x0, y0) => leerPng(armarPng(40, 30, (x, y) => (x >= x0 && x < x0 + 4 && y >= y0 && y < y0 + 4 ? [255 - dibujo(x, y)[0], 0, 0] : dibujo(x, y))));
  const objetivo = { x: 0, y: 0, w: 4, h: 4 };
  const r = contarCambios(a, conCuadro(0, 0), { objetivo });
  assert.ok(r.dentro > 0 && r.fuera === 0, JSON.stringify(r));
  const f = contarCambios(a, conCuadro(30, 20), { objetivo });
  assert.ok(f.fuera > 0 && f.dentro === 0, JSON.stringify(f));
  assert.equal(contarCambios(a, conCuadro(30, 20), { objetivo, sin: [{ x: 28, y: 18, w: 12, h: 12 }] }).fuera, 0);
  assert.equal(contarCambios(a, conCuadro(30, 20), { zona: { x: 0, y: 0, w: 20, h: 30 } }).fuera, 0);
  assert.equal(contarCambios(a, leerPng(armarPng(41, 30, dibujo))).distinta, true);
});

test('zonasComparar: otra ventana adelante o la ventana movida = cambió; si no, la zona en px de la imagen', () => {
  const base = { ventana: 'Bloc', app: 'notepad', pantalla: { x: 1920, y: 0, w: 1920, h: 1080 }, rect: { x: 2000, y: 100, w: 800, h: 600 },
    marito: { x: 3400, y: 100, w: 400, h: 900 } };
  const lugar = { x: 2100, y: 150, w: 80, h: 30 };
  assert.deepEqual(zonasComparar(base, { ...base, marito: null }, lugar), {
    zona: { x: 80, y: 100, w: 800, h: 600 }, sin: [{ x: 1474, y: 94, w: 412, h: 912 }], objetivo: { x: 180, y: 150, w: 80, h: 30 } });
  assert.equal(zonasComparar(base, { ...base, ventana: 'Guardar como' }, lugar), null);
  assert.equal(zonasComparar(base, { ...base, rect: { ...base.rect, x: 2010 } }, lugar), null);
  assert.equal(zonasComparar(base, { ...base, pantalla: { x: 0, y: 0, w: 1920, h: 1080 } }, lugar), null);
  // Un texto del OCR es la letra, no el botón que la rodea (24/11: el resaltado del botón contaba como «fuera»):
  // 3 alturas a los costados y 1 arriba y abajo. Caso real: texto 93×15 en un botón de 178×34 que empieza 43 px antes.
  const z = zonasComparar(base, base, { x: 2388, y: 604, w: 93, h: 15, tipo: 'Texto' });
  assert.deepEqual(z.objetivo, { x: 423, y: 589, w: 183, h: 45 });
  assert.ok(z.objetivo.x - 10 <= 2345 - 1920 && z.objetivo.x + z.objetivo.w + 10 >= 2345 - 1920 + 178);
});

test('quedoIgual: el resaltado de un botón no cuenta; una casilla que se tilda, sí', () => {
  assert.ok(quedoIgual({ distinta: false, fuera: 3, dentro: 200 }, 'Button'));
  assert.ok(!quedoIgual({ distinta: false, fuera: 3, dentro: 200 }, 'CheckBox'));
  assert.ok(!quedoIgual({ distinta: false, fuera: 900, dentro: 0 }, 'Button'));
  assert.ok(!quedoIgual({ distinta: true, fuera: Infinity, dentro: 0 }, ''));
  assert.ok(!quedoIgual(null, 'Button'));
});
