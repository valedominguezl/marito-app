// Constantes del servidor: carpetas, topes de tiempo, modelos, voces y esfuerzos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AQUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // la carpeta de Marito (server.mjs), no servidor/
// La configuración (proyectos, último usado, modelo, voz) es de cada PC y la escribe el servidor: vive con los demás
// datos, no en la carpeta del programa (que en una instalación se pisa al actualizar). La de antes se copia una vez.
export const DATOS_DIR = path.join(process.env.LOCALAPPDATA || AQUI, 'arreglo');
export const CONFIG_ARCHIVO = path.join(DATOS_DIR, 'proyectos.json');
try {
  if (!fs.existsSync(CONFIG_ARCHIVO) && fs.existsSync(path.join(AQUI, 'proyectos.json'))) {
    fs.mkdirSync(DATOS_DIR, { recursive: true });
    fs.copyFileSync(path.join(AQUI, 'proyectos.json'), CONFIG_ARCHIVO);
  }
} catch { /* sin configuración arranca vacía (readConfig) */ }
export const UI_DIR = path.join(AQUI, 'ui');
// Solo contra un turno colgado: los pedidos grandes (cambios + tests + QA) pasan tranquilos de 15 min, como en VS Code.
export const TOPE_TURNO_MS = 2 * 60 * 60 * 1000;
export const TOPE_DEPLOY_MS = 12 * 60 * 1000;
export const SIN_NADA_MS = 4 * 60 * 1000;
export const TOPE_ADJUNTO = 60 * 1024 * 1024;
export const TOPE_BORRADORES = 60; // borradores guardados (uno por conversación del historial)

export const MODELOS = [
  { id: 'claude-opus-5-5', nombre: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', nombre: 'Sonnet 5.5' },
  { id: 'claude-fable-5-2', nombre: 'Fable 5.2' },
  { id: 'claude-fable-5-1', nombre: 'Fable 5.1' },
  { id: 'claude-haiku-5-5', nombre: 'Haiku 5.5' },
];
export const MODELO_INICIAL = 'claude-opus-5-5';
// La voz (voz.py) corre con el Python de su entorno, que arma instalar-voz.ps1. `voz` en proyectos.json: la elegida en
// la configuración de Marito; sin nada (o 'no'), sin voz.
export const VOCES = ['daniela', 'santa'];
export const VOZ_PY = path.join(process.env.LOCALAPPDATA || '', 'arreglo', 'voz', 'venv', 'Scripts', 'python.exe');
export const VOZ_SIESTA_MS = 10 * 60 * 1000; // sin hablar este rato, la voz se apaga y suelta la memoria (vuelve sola al próximo uso)
export const VOZ_AUDIO_MS = 5 * 60 * 1000;   // cada frase hablada vive en memoria este rato (para que la UI la baje) y se borra
export const PEDIDO_HABLADO = `

(Te hablo por voz y tu respuesta se lee en voz alta: contestá como hablando, corto y en oraciones, sin listas, tablas ni código salvo que haga falta; eso queda escrito en el chat.)`;
// Esfuerzo de razonamiento (claude --effort). '' = el que traiga el modelo.
export const ESFUERZOS = [
  { id: '', nombre: 'Auto' },
  { id: 'low', nombre: 'Low' },
  { id: 'medium', nombre: 'Medium' },
  { id: 'high', nombre: 'High' },
  { id: 'xhigh', nombre: 'Extra high' },
  { id: 'max', nombre: 'Max' },
];
export const TOPE_COMANDO_MS = 5 * 60 * 1000; // terminal: tope por comando

// Sitios que no son de ningún proyecto (Google Docs, GitHub, localhost…): no se aprenden ni sirven para reconocer uno.
// La lista está en genericos.json y la usa también abrir.ps1.
export const GENERICOS_ARCHIVO = path.join(AQUI, 'genericos.json');
