// Pruebas de la lógica pura de server.mjs (servidor-logica.mjs): argumentos de claude, títulos, historial, adjuntos y publicación.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toolDetail, nombreSeguro, tituloDe, contextoDe, argsClaude, pideConectores, pideProyecto, elegirProyecto, entradaHistorial, sumarAlHistorial, modoPublicacion, accionTrasTurno,
  motivosPublicar, hostDe, esGenericoEn, TOPE_HISTORIAL, TOPE_EVENTOS_HISTORIAL, marcasEn, resolverMarca, fraseMarca, pasosEn, masDe, renglonDe, buscarControl,
  TOPE_CARTEL, textoHablado, cortarHablable, partirFrases, esIpTailscale, accesoRemoto, claveDe, claveValida, leerChecks, checksDeploy, estadoDeploy, quedaAlAbrir,
  pareceDePantalla, ruedaDe,
  preguntaDePantalla,
  charlaDePantalla,
} from '../servidor-logica.mjs';

test('leerChecks: gh caído o respuesta rota no es «sin deploy»', () => {
  const vacio = { ok: true, out: '{"statuses":[]}' };
  const sinRuns = { ok: true, out: '{"check_runs":[]}' };
  assert.deepEqual(leerChecks(vacio, sinRuns), { valida: true, items: [] });
  assert.equal(leerChecks({ ok: false, out: '' }, sinRuns).valida, false);
  assert.equal(leerChecks(vacio, { ok: false, out: '' }).valida, false);
  assert.equal(leerChecks({ ok: true, out: '<html>' }, sinRuns).valida, false);
  const r = leerChecks({ ok: true, out: '{"statuses":[{"context":"Vercel","state":"pending"}]}' },
    { ok: true, out: '{"check_runs":[{"name":"build","status":"completed","conclusion":"success"}]}' });
  assert.deepEqual(r.items, [{ nombre: 'Vercel', fin: false, bien: false, cancelado: false }, { nombre: 'build', fin: true, bien: true, cancelado: false }]);
  const c = leerChecks({ ok: true, out: '{"statuses":[{"context":"Vercel","state":"error","description":"Deployment has been canceled"}]}' },
    { ok: true, out: '{"check_runs":[{"name":"deploy","status":"completed","conclusion":"cancelled"}]}' });
  assert.deepEqual(c.items.map((i) => i.cancelado), [true, true]);
});

test('checksDeploy: sin filtro sigue lo que parece deploy y aprende de ahí, no del primero', () => {
  const codeql = { nombre: 'CodeQL', fin: true, bien: true };
  const tests = { nombre: 'test (node 20)', fin: true, bien: false };
  const vercel = { nombre: 'Vercel – la-esquina', fin: false, bien: false };
  assert.deepEqual(checksDeploy([codeql, tests, vercel], ''), { items: [vercel], aprender: 'Vercel – la-esquina' });
  assert.deepEqual(checksDeploy([{ nombre: 'Vercel - Preview', fin: true, bien: true }], ''), { items: [{ nombre: 'Vercel - Preview', fin: true, bien: true }], aprender: 'Vercel' });
  // Ninguno parece deploy: se miran todos, sin aprender CodeQL.
  assert.deepEqual(checksDeploy([codeql, tests], ''), { items: [codeql, tests], aprender: '' });
  assert.deepEqual(checksDeploy([codeql, vercel], 'vercel'), { items: [vercel], aprender: '' });
});

test('estadoDeploy: cancelado no es «falló»', () => {
  const ok = { nombre: 'Vercel', fin: true, bien: true };
  const corre = { nombre: 'Netlify', fin: false, bien: false };
  const cancel = { nombre: 'Vercel', fin: true, bien: false, cancelado: true };
  const roto = { nombre: 'Railway', fin: true, bien: false, cancelado: false };
  assert.equal(estadoDeploy([roto, corre]).estado, 'fallo');
  assert.equal(estadoDeploy([cancel, corre]).estado, 'armando');
  assert.deepEqual(estadoDeploy([cancel]), { estado: 'cancelado', item: cancel });
  assert.equal(estadoDeploy([cancel, ok]).estado, 'publicado');
  assert.equal(estadoDeploy([ok]).estado, 'publicado');
});

test('claveDe: header de la app, cookie del navegador o el link de vinculación', () => {
  assert.equal(claveDe({ header: 'h', cookie: 'marito=c', query: 'q' }), 'h');
  assert.equal(claveDe({ cookie: 'otra=1; marito=c', query: 'q' }), 'c');
  assert.equal(claveDe({ cookie: 'arreglo=x', query: 'q' }), 'q');
  assert.equal(claveDe({}), '');
});

test('claveValida: igual y de al menos 16; sin clave configurada nadie entra', () => {
  const k = 'a'.repeat(32);
  assert.equal(claveValida(k, k), true);
  assert.equal(claveValida('b'.repeat(32), k), false);
  assert.equal(claveValida('a', k), false);
  assert.equal(claveValida('', ''), false);
  assert.equal(claveValida('corta', 'corta'), false);
});

// ---- acceso desde el celular ----
test('esIpTailscale: solo 100.64.0.0/10', () => {
  assert.equal(esIpTailscale('100.101.1.10'), true);
  assert.equal(esIpTailscale('100.64.0.1'), true);
  assert.equal(esIpTailscale('100.127.255.255'), true);
  assert.equal(esIpTailscale('100.63.0.1'), false);
  assert.equal(esIpTailscale('100.128.0.1'), false);
  assert.equal(esIpTailscale('192.168.0.10'), false);
  assert.equal(esIpTailscale(''), false);
});

const base = { ip: '100.101.1.10', host: '100.101.1.20:8790', origen: undefined, telefono: '100.101.1.10', ipLocal: '100.101.1.20', puerto: 8790 };
test('accesoRemoto: el teléfono entra por la IP o el nombre de Tailscale de la PC', () => {
  assert.equal(accesoRemoto(base), true);
  assert.equal(accesoRemoto({ ...base, ip: '::ffff:100.101.1.10' }), true);
  assert.equal(accesoRemoto({ ...base, host: 'mi-pc:8790' }), true);
  assert.equal(accesoRemoto({ ...base, host: 'mi-pc.tail1234.ts.net:8790' }), true);
  assert.equal(accesoRemoto({ ...base, origen: 'http://100.101.1.20:8790' }), true);
});
test('accesoRemoto: otro aparato, otro host, otro puerto u otra página no entran', () => {
  assert.equal(accesoRemoto({ ...base, ip: '100.101.1.30' }), false); // otro aparato de la misma red de Tailscale
  assert.equal(accesoRemoto({ ...base, ip: '127.0.0.1' }), false);
  assert.equal(accesoRemoto({ ...base, telefono: '' }), false);
  assert.equal(accesoRemoto({ ...base, telefono: '192.168.0.5', ip: '192.168.0.5' }), false); // la IP configurada tiene que ser de Tailscale
  assert.equal(accesoRemoto({ ...base, host: 'evil.com:8790' }), false); // DNS rebinding
  assert.equal(accesoRemoto({ ...base, host: '100.101.1.20:9999' }), false);
  assert.equal(accesoRemoto({ ...base, host: '100.101.1.20' }), false);
  assert.equal(accesoRemoto({ ...base, origen: 'http://evil.com' }), false);
  assert.equal(accesoRemoto({ ...base, origen: 'null' }), false);
});

// ---- marca en la pantalla ----
const captura = { pantalla: { x: -339, y: 1080, w: 2560, h: 1600 },
  controles: [{ n: 1, tipo: 'Button', nombre: 'New Tab', x: 78, y: 1080, w: 42, h: 62 }, { n: 2, tipo: 'Button', nombre: 'Reload', x: -222, y: 1149, w: 51, h: 51 }] };

test('marcasEn: encuentra las etiquetas completas y no las cortadas', () => {
  assert.deepEqual(marcasEn('Tocá el más.\n[MARCAR:2]').map((m) => m.valor), ['2']);
  assert.deepEqual(marcasEn('Tocá el más.\n[MARCAR:2'), []);
  assert.deepEqual(marcasEn('[MARCAR:0.1,0.2,0.05,0.03:Guardar] y [MARCAR:1]').map((m) => m.valor), ['0.1,0.2,0.05,0.03:Guardar', '1']);
});

test('resolverMarca: por número usa el rectángulo de Windows', () => {
  assert.deepEqual(resolverMarca('2', captura), { x: -222, y: 1149, w: 51, h: 51, nombre: 'Reload', tipo: 'Button' });
  assert.equal(resolverMarca('9', captura), null);
});

test('resolverMarca: una caja en fracciones pasa a píxeles de esa pantalla', () => {
  assert.deepEqual(resolverMarca('0.5, 0.25, 0.1, 0.05: Guardar', captura), { x: 941, y: 1480, w: 256, h: 80, nombre: 'Guardar' });
});

test('resolverMarca: descarta cajas inválidas o del tamaño de la ventana', () => {
  assert.equal(resolverMarca('0.1,0.1,0.8,0.8', captura), null);
  assert.equal(resolverMarca('1.5,0.1,0.1,0.1', captura), null);
  assert.equal(resolverMarca('0.1,0.1,0,0.1', captura), null);
  assert.equal(resolverMarca('none', captura), null);
  assert.equal(resolverMarca('1', {}), null);
});

test('resolverMarca: por nombre, pero no la plantilla copiada tal cual', () => {
  assert.deepEqual(resolverMarca('Reload', captura), { x: -222, y: 1149, w: 51, h: 51, nombre: 'Reload', tipo: 'Button' });
  assert.equal(resolverMarca('x,y,ancho,alto:Rectangle', captura), null);
});

// Lo que pasó en la prueba de Inventor (23/11): la lista de pasos pensada de una.
const plan = 'Estás en la pieza.\n\n1. Abrí la pestaña «Tools», arriba en la cinta. [MARCAR:36]\n2. **Tocá «Application Options»**, el primer botón. [LUEGO:Application Options]\n'
  + '3. Tocá la pestaña «Display» del diálogo. [LUEGO:«Display»]\n4. Elegí el color de fondo.\n\nSe abre un diálogo grande.';

test('pasosEn: los pasos que siguen con su renglón, en orden', () => {
  assert.deepEqual(pasosEn(plan), [
    { nombre: 'Application Options', texto: 'Tocá «Application Options», el primer botón.', mas: '', alTocar: '', rueda: '' },
    { nombre: 'Display', texto: 'Tocá la pestaña «Display» del diálogo.', mas: '', alTocar: '', rueda: '' },
  ]);
  assert.deepEqual(pasosEn('Tocá «Guardar».\n[MARCAR:3]'), []);
});

// Un paso de ruedita: [RUEDA:abajo] en su renglón; no se ve en el paso ni lo dice la voz.
const conRueda = '1. Tocá «Configuración». [MARCAR:4]\n2. Bajá con la ruedita hasta ver «POP e IMAP». [LUEGO:Reenvío e IMAP] [RUEDA:abajo] [MAS:La sección es larga. | Aparece más abajo.]\n'
  + '3. Prendé «Permitir IMAP». [LUEGO:Permitir que los dispositivos usen IMAP]';
test('ruedaDe y pasosEn: el paso de desplazarse lleva su dirección', () => {
  const p = pasosEn(conRueda);
  assert.deepEqual(p.map((x) => x.rueda), ['abajo', '']);
  assert.equal(p[0].texto, 'Bajá con la ruedita hasta ver «POP e IMAP».');
  assert.equal(p[0].mas, 'La sección es larga.');
  assert.equal(ruedaDe(conRueda, conRueda.indexOf('[MARCAR')), '');
  assert.equal(ruedaDe('1. Bajá. [MARCAR:2] [RUEDA: Arriba ]', 5), 'arriba');
  assert.equal(ruedaDe('1. Bajá. [MARCAR:2] [RUEDA:costado]', 5), '');
  assert.ok(!textoHablado(conRueda).includes('RUEDA'));
});

// La marca que enseña: cada paso trae su explicación y qué pasa al tocar, para el cartel abierto.
const conMas = '1. Abrí «Tools», arriba. [MARCAR:36] [MAS:Ahí están las **opciones** de Inventor. | Al tocar: se abre la cinta Tools.]\n'
  + '2. Tocá «Application Options». [MAS:Es el primer botón. | Se abre el diálogo.] [LUEGO:Application Options]\n'
  + '3. Tocá «OK». [LUEGO:OK] [MAS:Guarda y cierra.]\n4. Tocá «Apply». [LUEGO:Apply] [MAS:Sin cerrar';

test('masDe: explicación y «al tocar» del renglón, en cualquier orden y solo completa', () => {
  assert.deepEqual(masDe(conMas, conMas.indexOf('[MARCAR:36]')), { mas: 'Ahí están las opciones de Inventor.', alTocar: 'se abre la cinta Tools.' });
  assert.deepEqual(masDe(conMas, conMas.indexOf('[LUEGO:OK]')), { mas: 'Guarda y cierra.', alTocar: '' });
  assert.deepEqual(masDe(conMas, conMas.indexOf('[LUEGO:Apply]')), { mas: '', alTocar: '' });
  assert.deepEqual(pasosEn(conMas).map((p) => [p.nombre, p.texto, p.alTocar]), [
    ['Application Options', 'Tocá «Application Options».', 'Se abre el diálogo.'], ['OK', 'Tocá «OK».', ''], ['Apply', 'Tocá «Apply».', ''],
  ]);
  assert.equal(renglonDe(conMas, conMas.indexOf('[MARCAR:36]')), 'Abrí «Tools», arriba.');
  assert.equal(textoHablado('Abrí «Tools». [MARCAR:3] [MAS:Ahí están. | Se abre.]'), 'Abrí «Tools».');
});

test('renglonDe: el renglón de la etiqueta sin número ni etiqueta; vacío si la etiqueta está sola', () => {
  assert.equal(renglonDe(plan, plan.indexOf('[MARCAR:36]')), 'Abrí la pestaña «Tools», arriba en la cinta.');
  const solo = 'Tocá «Guardar».\n[MARCAR:3]';
  assert.equal(renglonDe(solo, solo.indexOf('[MARCAR')), '');
});

test('buscarControl: nombre igual, la ventana de adelante y lo que apareció al tocar', () => {
  const ctl = (n, nombre, extra = {}) => ({ n, tipo: 'Button', nombre, x: n * 50, y: 40, w: 40, h: 20, z: 0, ...extra });
  const antes = { controles: [ctl(1, 'OK'), ctl(2, 'Tools')] };
  const despues = { controles: [ctl(1, 'OK'), ctl(2, 'Tools'), ctl(3, 'OK'), ctl(4, 'Display', { tipo: 'Texto', z: 99 }),
    ctl(5, 'Application Options…', { z: 1 }), ctl(6, 'Save (Ctrl+S)'), ctl(7, 'Save As'), ctl(8, 'Save Copy As')] };
  assert.equal(buscarControl(despues, 'ok', antes).n, 3); // el OK que apareció al tocar
  assert.equal(buscarControl(despues, 'display').n, 4); // un texto leído por OCR también sirve
  assert.equal(buscarControl(despues, 'Application Options').n, 5); // sin «…»
  assert.equal(buscarControl(despues, 'Save').n, 6); // sin el atajo
  assert.equal(buscarControl(despues, 'Copy').n, 8); // una sola que lo tiene como palabra
  assert.equal(buscarControl(despues, 'As'), null); // dos lo tienen: no se adivina
  assert.equal(buscarControl(despues, 'Extrude'), null);
  assert.equal(buscarControl({ controles: [ctl(1, 'Displa y', { tipo: 'Texto' })] }, 'Display').n, 1); // el OCR la partió
  assert.equal(buscarControl({ controles: [ctl(1, 'Tools', { z: 1 }), ctl(2, 'Tools')] }, 'Tools').n, 2); // la de adelante
  // Volver a un paso ya marcado: el del mismo nombre que sigue en su lugar, aunque haya otro más adelante.
  const dos = { controles: [ctl(1, 'Chrome', { z: 1 }), ctl(2, 'Chrome')] };
  assert.equal(buscarControl(dos, 'Chrome', null, { x: 50, y: 41, w: 40, h: 20 }).n, 1);
  assert.equal(buscarControl(dos, 'Chrome', null, { x: 400, y: 40, w: 40, h: 20 }).n, 2); // se movió: el de siempre
});

test('fraseMarca: la primera oración del paso, sin markdown y sin cortar palabras', () => {
  assert.equal(fraseMarca('Tocá **Archivo**, arriba a la izquierda. Se abre un menú con Guardar.\n[MARCAR:3]'), 'Tocá Archivo, arriba a la izquierda.');
  assert.equal(fraseMarca(''), '');
  const larga = fraseMarca('Tocá el botón azul que dice «Configuración de la cuenta», arriba a la derecha, al lado de tu foto de perfil y del ícono de la campanita.');
  assert.ok(larga.length <= TOPE_CARTEL + 1 && larga.endsWith('…') && !/\s…$/.test(larga), larga);
  assert.ok(larga.startsWith('Tocá el botón azul'));
});

test('textoHablado: sin código, tablas, links ni etiquetas', () => {
  assert.equal(textoHablado('## Paso\n- Tocá **Guardar**.\n- Después `Ctrl+S`.'), 'Paso. Tocá Guardar. Después control S.');
  assert.equal(textoHablado('Mirá [esto](https://x.com) y https://y.com/a.\n```js\nlet a=1\n```\nListo.\n[MARCAR:4]'), 'Mirá esto y el link. Listo.');
  assert.equal(textoHablado('| a | b |\n|---|---|\nFin.'), 'Fin.');
  assert.equal(textoHablado('Usá Ctrl+S o Ctrl + Shift + Esc, y Alt+F2.'), 'Usá control S o control Shift escape, y Alt F2.');
  assert.equal(textoHablado('2+2 es 4.'), '2+2 es 4.'); // solo combinaciones que arrancan con una tecla de control
});

test('cortarHablable: hasta el último fin de oración, sin cortar un bloque de código abierto', () => {
  assert.equal(cortarHablable('Hola. Te cuen'), 'Hola.'.length);
  assert.equal(cortarHablable('Sin fin'), 0);
  assert.equal(cortarHablable('Uno.\n```\nlet a. b\n'), 'Uno.\n'.length);
  assert.equal(cortarHablable('Uno.\n```\na\n```\nDos. y'), 'Uno.\n```\na\n```\nDos.'.length);
});

test('partirFrases: de a una, juntando las cortas y partiendo las largas', () => {
  assert.deepEqual(partirFrases('Dale. Tocá «Archivo», arriba a la izquierda. Listo.'), ['Dale. Tocá «Archivo», arriba a la izquierda.', 'Listo.']);
  const largas = partirFrases('a'.repeat(10) + ', ' + 'palabra '.repeat(40) + 'fin.');
  assert.ok(largas.length >= 2 && largas.every((f) => f.length <= 222), JSON.stringify(largas));
  assert.deepEqual(partirFrases('¿Sí? ...'), ['¿Sí?']);
  assert.deepEqual(partirFrases(''), []);
});

// ---- argumentos de claude ----
test('argsClaude: proyecto sin esfuerzo ni sesión', () => {
  const a = argsClaude({ modelo: 'claude-sonnet-5-5', instrucciones: 'INS', esfuerzo: '', libre: false, discos: [], sessionId: null });
  assert.deepEqual(a, ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', 'claude-sonnet-5-5',
    '--permission-mode', 'auto', '--disallowedTools', 'Bash(git push:*)', 'PowerShell(git push:*)', '--append-system-prompt', 'INS']);
});

test('argsClaude: esfuerzo y --resume van al final, en ese orden', () => {
  const a = argsClaude({ modelo: 'm', instrucciones: 'I', esfuerzo: 'high', libre: false, discos: [], sessionId: 'abc' });
  assert.deepEqual(a.slice(-4), ['--effort', 'high', '--resume', 'abc']);
});

test('argsClaude: sin MCP agrega --strict-mcp-config (y con MCP no)', () => {
  const a = argsClaude({ modelo: 'm', instrucciones: 'I', esfuerzo: 'high', libre: false, discos: [], sessionId: 'abc', sinMcp: true });
  assert.ok(a.includes('--strict-mcp-config'));
  assert.deepEqual(a.slice(-4), ['--effort', 'high', '--resume', 'abc']);
  assert.ok(!argsClaude({ modelo: 'm', instrucciones: 'I', esfuerzo: '', libre: false, discos: [], sessionId: null }).includes('--strict-mcp-config'));
});

test('argsClaude: con la captura en el mensaje, la entrada va como stream-json', () => {
  const a = argsClaude({ modelo: 'm', instrucciones: 'I', esfuerzo: '', libre: false, discos: [], sessionId: null, entradaJson: true });
  assert.deepEqual(a.slice(a.indexOf('--input-format'), a.indexOf('--input-format') + 2), ['--input-format', 'stream-json']);
  assert.ok(!argsClaude({ modelo: 'm', instrucciones: 'I', esfuerzo: '', libre: false, discos: [], sessionId: null }).includes('--input-format'));
});

test('pareceDePantalla: «cómo hago», «dónde está», guiame y lo que manda la marca; no un pedido de código', () => {
  for (const t of ['como cierro esto', '¿Cómo revierto el zoom?', 'dónde está la configuración', 'guiame para exportar', 'qué toco para guardar',
    'Listo, ya lo toqué.', 'Listo, ya lo toqué. No encontré «OK» en la pantalla para marcarlo: mirá de nuevo y seguí.',
    'Quiero volver al tutorial, al paso 2 («Aceptar»), pero no lo encuentro en la pantalla: mirá de nuevo y seguí desde ahí.']) {
    assert.ok(pareceDePantalla(t), t);
  }
  for (const t of ['arreglá el botón Pedir', 'hola', '¿por qué falla el build?', 'dale', 'commiteá esto',
    'Necesito que el endpoint de pedidos devuelva también el total con descuento y que se vea en la tabla del admin; fijate cómo lo hace el de facturas y copiá esa idea, con sus pruebas y la migración que haga falta en la base.']) {
    assert.ok(!pareceDePantalla(t), t);
  }
});

test('preguntaDePantalla: lo que señala la pantalla siempre; lo que no dice de qué habla, solo si la charla venía de ahí', () => {
  for (const t of ['¿qué es esto?', 'lo de ahora. mira esta pantalla y fijate por que falla', 'qué dice este cartel', 'por qué sale este error']) {
    assert.equal(preguntaDePantalla(t, false), 'senala', t);
  }
  for (const t of ['por que falla', '¿Qué pasó?', 'no anda', 'esta tod obien aca?', 'pero dice que no encontró ningún mensaje', 'y ahora?', 'no pasa nada']) {
    assert.equal(preguntaDePantalla(t, true), 'sin-tema', t);
    assert.equal(preguntaDePantalla(t, false), '', t);
  }
  for (const t of ['dale', 'gracias', 'commiteá esto', 'hola']) assert.equal(preguntaDePantalla(t, true), '', t);
  assert.equal(preguntaDePantalla('¿por qué falla el build?', false), '');
});

test('charlaDePantalla: hubo marca, tutorial o zona', () => {
  assert.ok(!charlaDePantalla([{ tipo: 'usuario', texto: 'hola', adjuntos: [] }, { tipo: 'texto', delta: 'x' }]));
  assert.ok(charlaDePantalla([{ tipo: 'tutorial', paso: 1 }]));
  assert.ok(charlaDePantalla([{ tipo: 'marcar', texto: 'x' }]));
  assert.ok(charlaDePantalla([{ tipo: 'usuario', texto: 'mirá', adjuntos: [{ origen: 'zona' }] }]));
  assert.ok(!charlaDePantalla(undefined));
  // Solo desde los dos últimos pedidos: una marca vieja no cuenta.
  const u = (texto) => ({ tipo: 'usuario', texto, adjuntos: [] });
  assert.ok(charlaDePantalla([u('guiame'), { tipo: 'marcar' }, { tipo: 'texto' }, u('listo'), { tipo: 'texto' }]));
  assert.ok(!charlaDePantalla([u('guiame'), { tipo: 'marcar' }, u('otra cosa'), { tipo: 'texto' }, u('y esto'), { tipo: 'texto' }]));
});

test('pideConectores: la etiqueta sola en un renglón', () => {
  assert.ok(pideConectores('Para eso necesito Notion.\n[CONECTORES]'));
  assert.ok(pideConectores('[CONECTORES]'));
  assert.ok(!pideConectores('Escribí [CONECTORES] en tu mensaje si querés.'));
  assert.ok(!pideConectores('Listo, ya está.'));
});

test('pideProyecto: la etiqueta sola en el último renglón', () => {
  assert.equal(pideProyecto('Esto es de La Esquina: me paso ahí.\n[PROYECTO:La Esquina]'), 'La Esquina');
  assert.equal(pideProyecto('No es de ningún proyecto.\n[PROYECTO:]\n'), '');
  assert.equal(pideProyecto('Escribí [PROYECTO:X] si querés.'), null);
  assert.equal(pideProyecto('[PROYECTO:X]\nY sigo hablando.'), null);
  assert.equal(pideProyecto('Listo.'), null);
});

test('elegirProyecto: por nombre, carpeta o el final de la carpeta', () => {
  const lista = [{ nombre: 'La Esquina', carpeta: 'C:\\p\\la-esquina' }, { nombre: 'Clima Sur', carpeta: 'C:\\p\\clima-sur' }];
  assert.equal(elegirProyecto('la esquina', lista), 'La Esquina');
  assert.equal(elegirProyecto('C:\\p\\clima-sur\\', lista), 'Clima Sur');
  assert.equal(elegirProyecto('clima-sur', lista), 'Clima Sur');
  assert.equal(elegirProyecto('', lista), '');
  assert.equal(elegirProyecto('Chat libre', lista), '');
  assert.equal(elegirProyecto('Agenda', lista), null);
});

test('argsClaude: chat libre agrega todos los discos con --add-dir', () => {
  const a = argsClaude({ modelo: 'm', instrucciones: 'I', esfuerzo: '', libre: true, discos: ['C:\\', 'D:\\'], sessionId: null });
  assert.deepEqual(a.slice(-3), ['--add-dir', 'C:\\', 'D:\\']);
  assert.ok(!a.includes('--effort') && !a.includes('--resume'));
});

// ---- títulos ----
test('tituloDe: una línea y hasta 60 caracteres', () => {
  assert.equal(tituloDe('hola\n\n  qué   tal'), 'hola qué tal');
  assert.equal(tituloDe('x'.repeat(100)).length, 60);
});

// ---- historial y topes ----
const conv = (extra = {}) => ({ sessionId: 's1', proyecto: 'Marito', sitio: 'a.com', url: 'a.com/x', titulo: 'T', historial: [], ...extra });

test('entradaHistorial: saca publicar-confirmar y el campo conv', () => {
  const e = entradaHistorial(conv({ historial: [
    { tipo: 'usuario', conv: 'c1', texto: 'hola' },
    { tipo: 'publicar-confirmar', conv: 'c1', motivos: ['x'] },
    { tipo: 'texto', conv: 'c1', delta: 'ok' },
  ] }), new Date('2026-11-20T10:00:00Z'));
  assert.deepEqual(e.eventos, [{ tipo: 'usuario', texto: 'hola' }, { tipo: 'texto', delta: 'ok' }]);
  assert.equal(e.fecha, '2026-11-20T10:00:00.000Z');
  assert.equal(e.sessionId, 's1');
  assert.equal(e.titulo, 'T');
  assert.equal(e.modelo, '');
});

test('entradaHistorial: guarda el modelo del chat (vuelve con el suyo al reabrirlo)', () => {
  assert.equal(entradaHistorial(conv({ modelo: 'claude-opus-5-5' })).modelo, 'claude-opus-5-5');
});

test('entradaHistorial: se queda con los últimos TOPE_EVENTOS_HISTORIAL eventos', () => {
  const historial = Array.from({ length: TOPE_EVENTOS_HISTORIAL + 50 }, (_, i) => ({ tipo: 'texto', delta: String(i) }));
  const e = entradaHistorial(conv({ historial }));
  assert.equal(e.eventos.length, TOPE_EVENTOS_HISTORIAL);
  assert.equal(e.eventos[0].delta, '50');
  assert.equal(e.eventos.at(-1).delta, String(TOPE_EVENTOS_HISTORIAL + 49));
});

test('sumarAlHistorial: la conversación va primera y no se duplica su sesión', () => {
  const lista = [{ sessionId: 'a' }, { sessionId: 's1', viejo: true }, { sessionId: 'b' }];
  const h = sumarAlHistorial(lista, { sessionId: 's1', nuevo: true });
  assert.deepEqual(h.map((x) => x.sessionId), ['s1', 'a', 'b']);
  assert.equal(h[0].nuevo, true);
});

test('sumarAlHistorial: tope de conversaciones guardadas', () => {
  const lista = Array.from({ length: TOPE_HISTORIAL }, (_, i) => ({ sessionId: 'x' + i }));
  const h = sumarAlHistorial(lista, { sessionId: 'nueva' });
  assert.equal(h.length, TOPE_HISTORIAL);
  assert.equal(h[0].sessionId, 'nueva');
  assert.ok(!h.some((x) => x.sessionId === 'x' + (TOPE_HISTORIAL - 1)), 'la más vieja se cae');
});

// ---- adjuntos ----
test('nombreSeguro: sin rutas (no se sale de la carpeta de adjuntos)', () => {
  assert.equal(nombreSeguro('..\\..\\Windows\\system32\\cmd.exe'), 'cmd.exe');
  assert.equal(nombreSeguro('../../etc/passwd'), 'passwd');
  assert.equal(nombreSeguro('C:\\Users\\Ana\\foto.png'), 'foto.png');
});

test('nombreSeguro: reemplaza caracteres prohibidos, saca puntos del inicio y no devuelve vacío', () => {
  assert.equal(nombreSeguro('a<b>c:d"e|f?g*h.txt'), 'a_b_c_d_e_f_g_h.txt');
  assert.equal(nombreSeguro('...oculto'), 'oculto');
  assert.equal(nombreSeguro(''), 'archivo');
  assert.equal(nombreSeguro(null), 'archivo');
  assert.equal(nombreSeguro('..'), 'archivo');
});

test('nombreSeguro: nombres larguísimos quedan en 90 caracteres y conservan la extensión', () => {
  const n = nombreSeguro('a'.repeat(200) + '.pdf');
  assert.equal(n.length, 90);
  assert.ok(n.endsWith('.pdf'));
});

// ---- publicar ----
test('modoPublicacion: deploy por defecto, github y no según el proyecto, no si no hay remoto', () => {
  assert.equal(modoPublicacion({}, false), 'deploy');
  assert.equal(modoPublicacion({ publicar: 'deploy' }, false), 'deploy');
  assert.equal(modoPublicacion({ publicar: 'github' }, false), 'github');
  assert.equal(modoPublicacion({ publicar: 'no' }, false), 'no');
  assert.equal(modoPublicacion({ publicar: 'rarisimo' }, false), 'deploy');
  assert.equal(modoPublicacion({ publicar: 'github' }, true), 'no');
});

test('accionTrasTurno: push automático o manual solo si hubo commit y salió bien', () => {
  const base = { cambio: true, ok: true, cerrando: false, abierta: true, push: true };
  assert.equal(accionTrasTurno(base), 'auto');
  assert.equal(accionTrasTurno({ ...base, push: false }), 'manual');
  assert.equal(accionTrasTurno({ ...base, cambio: false }), 'nada');
  assert.equal(accionTrasTurno({ ...base, ok: false }), 'nada');
  assert.equal(accionTrasTurno({ ...base, cerrando: true }), 'nada');
  assert.equal(accionTrasTurno({ ...base, abierta: false }), 'nada');
});

test('motivosPublicar: pide confirmación por rama distinta o por commits ajenos', () => {
  assert.deepEqual(motivosPublicar({ proy: { rama: 'main' }, rama: 'main', ajenos: [] }), []);
  assert.deepEqual(motivosPublicar({ proy: { rama: '' }, rama: 'x', ajenos: [] }), []);
  assert.deepEqual(motivosPublicar({ proy: { rama: '', publicarEn: 'main' }, rama: 'main', ajenos: [] }), []);
  assert.match(motivosPublicar({ proy: { rama: '', publicarEn: 'main' }, rama: 'feature/x', ajenos: [] })[0], /«feature\/x» y se publica en «main»/);
  const m = motivosPublicar({ proy: { rama: 'main' }, rama: 'feature/x', ajenos: ['a1 uno', 'b2 dos'] });
  assert.equal(m.length, 2);
  assert.match(m[0], /«feature\/x», no en «main»/);
  assert.match(m[1], /salen 2 commits/);
  assert.match(m[1], /a1 uno\nb2 dos$/);
});

test('motivosPublicar: lista como mucho 12 commits ajenos pero cuenta todos', () => {
  const ajenos = Array.from({ length: 20 }, (_, i) => `h${i} c${i}`);
  const [m] = motivosPublicar({ proy: { rama: 'main' }, rama: 'main', ajenos });
  assert.match(m, /salen 20 commits/);
  assert.equal(m.split('\n').length, 1 + 12);
});

// ---- sitios genéricos ----
test('hostDe: sin esquema, puerto, www ni ruta', () => {
  assert.equal(hostDe('HTTPS://www.Ejemplo.com:8080/a?b#c'), 'ejemplo.com');
  assert.equal(hostDe('docs.google.com/spreadsheets/d/1'), 'docs.google.com');
  assert.equal(hostDe(undefined), '');
});

test('esGenericoEn: vacío, IPs y subdominios de la lista', () => {
  const lista = ['google.com', 'github.com', 'localhost'];
  assert.equal(esGenericoEn('', lista), true);
  assert.equal(esGenericoEn('192.168.0.5:3000', lista), true);
  assert.equal(esGenericoEn('docs.google.com', lista), true);
  assert.equal(esGenericoEn('localhost:3000', lista), true);
  assert.equal(esGenericoEn('laesquina.com', lista), false);
  assert.equal(esGenericoEn('notgoogle.com', lista), false, 'no alcanza con terminar igual: tiene que ser subdominio');
});

// ---- detalle de herramientas ----
test('toolDetail: rutas relativas a la carpeta del proyecto', () => {
  assert.equal(toolDetail('Read', { file_path: 'C:\\Proy\\src\\a.ts' }, 'C:\\Proy'), 'src/a.ts');
  assert.equal(toolDetail('Read', { file_path: 'C:\\Proy\\src\\a.ts' }, 'c:/proy/'), 'src/a.ts');
  assert.equal(toolDetail('Read', { file_path: 'D:\\otro\\b.txt' }, 'C:\\Proy'), 'D:/otro/b.txt');
});

test('toolDetail: comandos, agentes y entradas vacías', () => {
  assert.equal(toolDetail('Bash', { command: 'npx   tsc\n--noEmit' }, 'C:\\P'), 'npx tsc --noEmit');
  assert.equal(toolDetail('Agent', { description: 'Buscar algo', prompt: 'largo' }, 'C:\\P'), 'Buscar algo');
  assert.equal(toolDetail('Grep', { pattern: 'x'.repeat(200) }, 'C:\\P').length, 90);
  assert.equal(toolDetail('Raro', null, 'C:\\P'), '');
});

// ---- contexto y cadena ----
test('contextoDe: suma lo que entró (con y sin caché) y lo escrito', () => {
  assert.equal(contextoDe({ input_tokens: 5, cache_creation_input_tokens: 20000, cache_read_input_tokens: 21000, output_tokens: 300 }), 41305);
  assert.equal(contextoDe(null), 0);
  assert.equal(contextoDe({}), 0);
});

test('quedaAlAbrir: siguen las que tienen algo escrito, trabajan o terminaron sin verse en la PC', () => {
  const cerrada = 1000;
  assert.equal(quedaAlAbrir({}, { ventanaCerradaEn: cerrada }), false, 'vacía');
  assert.equal(quedaAlAbrir({ finEn: 900 }, { ventanaCerradaEn: cerrada }), false, 'terminó antes de cerrar la ventana: ya se vio');
  assert.equal(quedaAlAbrir({ finEn: 900 }, { borrador: '  sin mandar ', ventanaCerradaEn: cerrada }), true);
  assert.equal(quedaAlAbrir({ finEn: 900 }, { borrador: '   ', ventanaCerradaEn: cerrada }), false, 'solo espacios no cuenta');
  assert.equal(quedaAlAbrir({ finEn: 1500 }, { ventanaCerradaEn: cerrada }), true, 'terminó con la ventana cerrada');
  for (const k of ['turno', 'arrancando', 'confirmacion', 'comando', 'pendiente']) assert.equal(quedaAlAbrir({ [k]: {} }, { ventanaCerradaEn: cerrada }), true, k);
  const pub = (paso, finEn = 900) => ({ finEn, historial: [{ tipo: 'publicacion', paso: 'push' }, { tipo: 'publicacion', paso }] });
  assert.equal(quedaAlAbrir(pub('armando'), { ventanaCerradaEn: cerrada }), true, 'siguiendo el deploy');
  assert.equal(quedaAlAbrir(pub('publicado'), { ventanaCerradaEn: cerrada }), false);
  assert.equal(quedaAlAbrir(pub('armando', 0), { ventanaCerradaEn: cerrada }), false, 'un deploy a medias de otro arranque no la retiene');
});

test('entradaHistorial: guarda la cadena (vacía si no sigue a otro chat)', () => {
  assert.equal(entradaHistorial(conv({ cadena: 's0' })).cadena, 's0');
  assert.equal(entradaHistorial(conv()).cadena, '');
});
