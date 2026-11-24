// Utilidades sueltas: archivos JSON, config, procesos hijos (run/git/killTree), búsqueda de repos y carpetas de VS Code.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { esGenericoEn } from '../servidor-logica.mjs';
import { CONFIG_ARCHIVO, GENERICOS_ARCHIVO } from './constantes.mjs';

export function readJsonFile(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return fallback; }
}
export function writeJsonFile(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
export function readConfig() { return readJsonFile(CONFIG_ARCHIVO, { raiz: '', ultimo: '', proyectos: [] }); }

export function esGenerico(sitio) { return esGenericoEn(sitio, readJsonFile(GENERICOS_ARCHIVO, [])); }

// Al vencer el tope mata el árbol entero, no solo el programa: el hook pre-push de `git push` (armar la app y subirla
// a Play) seguiría solo y podría publicar algo cuyo push figura como fallado.
export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const TOPE_SALIDA = 16 * 1024 * 1024;
    let out = '', err = '', vencido = false, listo = false, tope = null;
    const fin = (code, extra = '') => {
      if (listo) return;
      listo = true;
      clearTimeout(tope);
      if (vencido) extra += `\nSe pasó del tope de ${Math.round((opts.timeout ?? 30000) / 1000)} s y lo corté.`;
      resolve({ ok: code === 0 && !vencido, code: vencido ? 'ETIMEDOUT' : code, out: out.trim(), err: (err + extra).trim() });
    };
    let proc;
    try { proc = spawn(cmd, args, { windowsHide: true, cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { fin(1, e.message); return; }
    tope = setTimeout(() => { vencido = true; killTree(proc.pid); }, opts.timeout ?? 30000);
    proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (d) => { if (out.length < TOPE_SALIDA) out += d; });
    proc.stderr.on('data', (d) => { if (err.length < TOPE_SALIDA) err += d; });
    proc.on('error', (e) => fin(1, e.message));
    proc.on('close', (code) => fin(code ?? 1));
  });
}
export function git(cwd, ...args) { return run('git', args, { cwd }); }

export function killTree(pid) {
  if (!pid) return;
  try { spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' }); } catch { /* ya no está */ }
}

export function findRepos(carpeta, nivel, out) {
  if (nivel > 3) return;
  if (fs.existsSync(path.join(carpeta, '.git'))) { out.push(carpeta); return; }
  let entradas = [];
  try { entradas = fs.readdirSync(carpeta, { withFileTypes: true }); } catch { return; }
  for (const e of entradas) {
    if (!e.isDirectory()) continue;
    if (['node_modules', '.next', 'dist', 'build', 'temporal'].includes(e.name) || e.name.startsWith('.')) continue;
    findRepos(path.join(carpeta, e.name), nivel + 1, out);
  }
}

// Carpetas que el usuario abre en VS Code (las ventanas abiertas primero, después todas las que abrió alguna vez).
export function vscodeFolders() {
  const st = readJsonFile(path.join(process.env.APPDATA || '', 'Code', 'User', 'globalStorage', 'storage.json'), {});
  const uris = [];
  const ws = st.windowsState || {};
  if (ws.lastActiveWindow?.folder) uris.push(ws.lastActiveWindow.folder);
  for (const w of ws.openedWindows || []) if (w.folder) uris.push(w.folder);
  for (const f of st.backupWorkspaces?.folders || []) if (f.folderUri) uris.push(f.folderUri);
  uris.push(...Object.keys(st.profileAssociations?.workspaces || {}));
  const vistos = new Set(); const out = [];
  for (const u of uris) {
    if (!/^file:\/\/\//i.test(u)) continue; // las de WSL o remotas no
    let p; try { p = fileURLToPath(u); } catch { continue; }
    p = p.replace(/[\\/]+$/, '');
    const k = p.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    if (/^[a-z]:$/i.test(p) || k === os.homedir().toLowerCase() || k.includes('\\program files')) continue;
    try { if (fs.statSync(p).isDirectory()) out.push(p); } catch { /* ya no existe */ }
  }
  return out;
}
