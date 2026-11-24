// Adjuntos (capturas, archivos, planillas) y limpieza de lo viejo en la carpeta de la sesión.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { nombreSeguro } from '../servidor-logica.mjs';
import { adjDir, adjuntos, pantallasDir, sesionDir } from './estado.mjs';

// ---- adjuntos ----
const MIME_ADJ = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

export function addAdjunto(buf, nombre, origen, nota = '') {
  // Al azar: desde el celular no se pueden bajar todos probando a1, a2…, y uno nuevo después de reiniciar no
  // pisa la dirección de uno viejo que siga en el historial.
  const id = 'a' + crypto.randomBytes(9).toString('hex');
  nombre = nombreSeguro(nombre);
  const ruta = path.join(adjDir, `${id}-${nombre}`);
  fs.writeFileSync(ruta, buf);
  const ext = path.extname(nombre).toLowerCase();
  const a = { id, ruta, url: `/adjuntos/${id}`, nombre, tipo: MIME_ADJ[ext] || 'application/octet-stream', tamano: buf.length,
    imagen: /^\.(png|jpe?g|gif|webp|bmp)$/.test(ext), origen, nota: String(nota || '').slice(0, 300), usado: false };
  adjuntos.set(id, a);
  return a;
}

export const infoAdj = (a) => ({ id: a.id, url: a.url, nombre: a.nombre, tipo: a.tipo, tamano: a.tamano, imagen: a.imagen, origen: a.origen, ruta: a.ruta });

export const nombreCaptura = (origen) => (origen === 'recorte' ? 'recorte.png' : origen === 'zona' ? 'zona.png' : 'captura.png');

// El fijo puede quedar prendido semanas y su carpeta junta capturas: lo de más de 7 días se borra al arrancar y cada
// 6 h (las carpetas enteras las borran abrir.ps1 y servidor-fijo.ps1). También las PNG sueltas de la v1.
export function limpiarViejos() {
  const limite = Date.now() - 7 * 24 * 3600 * 1000;
  const borrar = (dir, filtro = () => true) => {
    let fs0 = [];
    try { fs0 = fs.readdirSync(dir); } catch { return; }
    for (const f of fs0.filter(filtro)) {
      const r = path.join(dir, f);
      try { if (fs.statSync(r).isFile() && fs.statSync(r).mtimeMs < limite) fs.unlinkSync(r); } catch { /* en uso o ya no está */ }
    }
  };
  borrar(pantallasDir);
  borrar(adjDir);
  for (const [id, a] of adjuntos) if (!fs.existsSync(a.ruta)) adjuntos.delete(id);
  // Solo en la carpeta de Marito: sin sesión en los argumentos, la de arriba sería %TEMP%.
  if (path.basename(path.dirname(sesionDir)).toLowerCase() === 'arreglo') borrar(path.dirname(sesionDir), (f) => /^\d{8}-\d{6}(-extra)?\.png$/.test(f));
}
