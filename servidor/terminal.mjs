// Terminal de cada pestaña: un comando de PowerShell en la carpeta del proyecto.
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { TOPE_COMANDO_MS } from './constantes.mjs';
import { emit } from './conversaciones.mjs';
import { resolverProyecto } from './proyectos.mjs';
import { killTree } from './utilidades.mjs';

// Cómo se publica cada proyecto («publicar» en proyectos.json):
//   'deploy' (o nada): push y seguir el deploy hasta que la web nueva está en línea.
//   'github': solo push (herramientas locales, librerías: no hay web que armar).
//   'no': ni push; el commit queda en la compu. También si el repo no tiene remoto «origin».
// Terminal: un comando de PowerShell en la carpeta de la pestaña. La carpeta se sigue entre comandos (cd).
const MARCA_CWD = '__MARITO_CWD__';

const MARCA_ERR = '__MARITO_ERR__';

export function correrComando(c, comando) {
  let cwd = c.cwdTerminal;
  if (!cwd || !fs.existsSync(cwd)) {
    const { proy } = c.proyecto ? resolverProyecto(c.proyecto) : { proy: null };
    cwd = proy && fs.existsSync(proy.carpeta) ? proy.carpeta : os.homedir();
  }
  // -EncodedCommand (UTF-16) para que los acentos lleguen bien; al final, la carpeta en la que quedó y el código de salida.
  // El comando va en base64 y se arma con [scriptblock]::Create: un error de sintaxis queda como error del comando.
  // Los errores salen por stdout con MARCA_ERR (si no, PowerShell los manda en CLIXML).
  const b64 = Buffer.from(comando, 'utf8').toString('base64');
  const script = [
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ProgressPreference = 'SilentlyContinue'; $__c = 0; $__e = $Error.Count",
    `$__m = { process { if ($_ -is [System.Management.Automation.ErrorRecord]) { ($_ | Out-String -Stream -Width 160) | Where-Object { $_ } | ForEach-Object { '${MARCA_ERR}' + $_ } } else { $_ } } }`,
    'try {',
    `  $__sb = [scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))`,
    '  & $__sb 2>&1 | & $__m | Out-String -Stream -Width 160',
    '  if ($LASTEXITCODE) { $__c = $LASTEXITCODE } elseif ($Error.Count -gt $__e) { $__c = 1 }',
    `} catch { ($_ | Out-String -Stream -Width 160) | Where-Object { $_ } | ForEach-Object { '${MARCA_ERR}' + $_ }; $__c = 1 }`,
    `finally { [Console]::Out.WriteLine('${MARCA_CWD}' + (Get-Location).Path) }`,
    'exit $__c',
  ].join('\n');
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const k = { proc, detenido: false, tope: false, buf: '', inicio: Date.now(), emitido: 0, cortado: false };
  c.comando = k;
  emit(c, { tipo: 'comando-inicio', comando, cwd });
  // Cada renglón queda en el historial de la pestaña (y se reenvía en cada recarga): un comando que escupe megas lo
  // inflaría. Pasado el tope se avisa una vez y lo demás se descarta (el comando sigue).
  const TOPE_SALIDA = 200 * 1024;
  const emitirSalida = (ev) => {
    if (k.cortado) return;
    k.emitido += ev.texto.length;
    if (k.emitido > TOPE_SALIDA) { k.cortado = true; emit(c, { tipo: 'comando-salida', texto: '… (corté la salida acá: pasó los 200 KB; el comando sigue corriendo)\n', error: true }); return; }
    emit(c, ev);
  };
  const salida = (s) => {
    k.buf += s;
    // Un renglón larguísimo sin salto también se corta.
    if (k.buf.length > 64 * 1024 && k.buf.indexOf('\n') < 0) k.buf += '\n';
    let i;
    while ((i = k.buf.indexOf('\n')) >= 0) {
      const linea = k.buf.slice(0, i + 1); k.buf = k.buf.slice(i + 1);
      const j = linea.indexOf(MARCA_CWD);
      if (j >= 0) {
        c.cwdTerminal = linea.slice(j + MARCA_CWD.length).trim();
        if (j > 0) emitirSalida({ tipo: 'comando-salida', texto: linea.slice(0, j) + '\n' });
        continue;
      }
      const err = linea.startsWith(MARCA_ERR);
      emitirSalida({ tipo: 'comando-salida', texto: (err ? linea.slice(MARCA_ERR.length) : linea).replace(/\r/g, ''), error: err || undefined });
    }
  };
  proc.stdout.on('data', (d) => salida(d.toString('utf8')));
  proc.stderr.on('data', (d) => {
    let t = d.toString('utf8');
    if (/#< CLIXML|<Objs /.test(t)) {
      t = [...t.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) => m[1]).join('')
        .replace(/_x000D_/g, '').replace(/_x000A_/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      if (!t.trim()) return;
    }
    emitirSalida({ tipo: 'comando-salida', texto: t.replace(/\r/g, ''), error: true });
  });
  const tope = setTimeout(() => { if (c.comando === k) { k.tope = true; killTree(proc.pid); } }, TOPE_COMANDO_MS);
  const fin = (code) => {
    if (c.comando !== k) return;
    clearTimeout(tope);
    if (k.buf.includes(MARCA_CWD)) c.cwdTerminal = k.buf.slice(k.buf.indexOf(MARCA_CWD) + MARCA_CWD.length).trim();
    else if (k.buf) emitirSalida({ tipo: 'comando-salida', texto: k.buf });
    c.comando = null;
    emit(c, { tipo: 'comando-fin', codigo: code, cwd: c.cwdTerminal || cwd, detenido: k.detenido, tope: k.tope,
      segundos: Math.round((Date.now() - k.inicio) / 1000) });
  };
  proc.on('error', (e) => { emitirSalida({ tipo: 'comando-salida', texto: `No pude abrir PowerShell: ${e.message}\n`, error: true }); fin(-1); });
  proc.on('close', fin);
}
