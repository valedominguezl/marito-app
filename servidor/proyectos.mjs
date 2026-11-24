// Proyectos: los de proyectos.json, los repos de la carpeta raíz y las carpetas de VS Code que el servidor fue sumando.
import fs from 'node:fs';
import path from 'node:path';
import { elegirProyecto } from '../servidor-logica.mjs';
import { readConfig } from './utilidades.mjs';

// ---- proyectos: los de proyectos.json + repos de la carpeta raíz + carpetas de VS Code ----
let extras = [];                   // [{ nombre, carpeta }] que no están en proyectos.json

function nombreDeCarpeta(c, raiz, usados) {
  let n = raiz && c.toLowerCase().startsWith(raiz.toLowerCase() + path.sep) ? c.slice(raiz.length + 1) : path.basename(c);
  if (usados.has(n.toLowerCase())) n = `${path.basename(path.dirname(c))}${path.sep}${path.basename(c)}`;
  return n;
}

export function sumarExtra(carpeta) {
  if (!carpeta) return null;
  const cfg = readConfig();
  const k = carpeta.toLowerCase().replace(/[\\/]+$/, '');
  const conocido = (cfg.proyectos || []).find((p) => p.carpeta.toLowerCase() === k);
  if (conocido) return conocido.nombre;
  const ya = extras.find((e) => e.carpeta.toLowerCase() === k);
  if (ya) return ya.nombre;
  const usados = new Set([...(cfg.proyectos || []).map((p) => p.nombre.toLowerCase()), ...extras.map((e) => e.nombre.toLowerCase())]);
  const e = { nombre: nombreDeCarpeta(carpeta.replace(/[\\/]+$/, ''), cfg.raiz || '', usados), carpeta: carpeta.replace(/[\\/]+$/, '') };
  extras.push(e);
  return e.nombre;
}

export function listaProyectos() {
  const cfg = readConfig();
  if (!cfg.raiz) return []; // sin «Carpeta de proyectos» no se habla de proyectos
  const conocidas = new Set((cfg.proyectos || []).map((p) => p.carpeta.toLowerCase()));
  return [...(cfg.proyectos || []).map((p) => p.nombre), ...extras.filter((e) => !conocidas.has(e.carpeta.toLowerCase())).map((e) => e.nombre)];
}

// Lo que pidió Claude con [PROYECTO:…]: un nombre o una carpeta (también fuera de la raíz). '' = Chat libre, null = no está.
export function proyectoPedido(pedido) {
  const cfg = readConfig();
  const conocidas = new Set((cfg.proyectos || []).map((p) => p.carpeta.toLowerCase()));
  const lista = [...(cfg.proyectos || []), ...extras.filter((e) => !conocidas.has(e.carpeta.toLowerCase()))];
  const n = elegirProyecto(pedido, lista);
  if (n !== null) return n;
  // Una carpeta suelta solo si es un repo (un proyecto): no cualquier carpeta de la PC (ni C:\).
  if (path.isAbsolute(pedido) && fs.existsSync(path.join(pedido, '.git'))) return sumarExtra(pedido);
  return null;
}

export function resolverProyecto(nombre) {
  const cfg = readConfig();
  const p = (cfg.proyectos || []).find((x) => x.nombre === nombre);
  if (p) return { cfg, proy: p };
  const e = extras.find((x) => x.nombre === nombre);
  if (!e) return { cfg, proy: null };
  return { cfg, proy: { nombre: e.nombre, carpeta: e.carpeta, sitios: [], rama: '', publicarEn: '', deploy: '', _nuevo: true } };
}
