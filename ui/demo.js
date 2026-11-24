/* Servidor simulado para ?demo: mismos eventos que el real (con su conversación en `conv`), sin backend.
   ?fast acelera los tiempos; ?manual no manda la primera pregunta sola. */
(function () {
  'use strict';
  var qs = new URLSearchParams(location.search);
  var SPEED = qs.has('fast') ? 0.1 : 1;
  var handler = null;
  var history = [];
  var convs = { c1: { busy: false, turn: 0, timers: [] }, c2: { busy: false, turn: 0, timers: [] } };
  var nextConv = 3;
  var borradores = {}; // conv → lo último que la UI guardó con /api/borrador
  var nextAtt = 2;

  // Captura de mentira (SVG) para las miniaturas
  function mockShot(label, hue) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#f4f1ea"/>' +
      '<rect x="0" y="0" width="320" height="26" fill="hsl(' + hue + ',45%,45%)"/>' +
      '<rect x="24" y="48" width="130" height="14" rx="4" fill="#cfc9b8"/><rect x="24" y="72" width="200" height="8" rx="4" fill="#ddd8c8"/>' +
      '<rect x="24" y="90" width="170" height="8" rx="4" fill="#ddd8c8"/><rect x="24" y="130" width="140" height="40" rx="10" fill="#d97757"/>' +
      '<text x="38" y="155" font-family="Segoe UI,Arial" font-size="15" fill="#fff">' + label + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  var ctx = {
    proyectos: ['La Esquina', 'Taller Norte', 'Clima Sur', 'Agenda'],
    raiz: 'C:\\Users\\demo\\proyectos',
    modelo: 'claude-opus-5-5',
    modelos: [
      { id: 'claude-opus-5-5', nombre: 'Opus 5.5' }, { id: 'claude-sonnet-5-5', nombre: 'Sonnet 5.5' },
      { id: 'claude-fable-5-2', nombre: 'Fable 5.2' }, { id: 'claude-fable-5-1', nombre: 'Fable 5.1' }, { id: 'claude-haiku-5-5', nombre: 'Haiku 5.5' }
    ],
    esfuerzo: '',
    esfuerzos: [{ id: '', nombre: 'Auto' }, { id: 'low', nombre: 'Low' }, { id: 'medium', nombre: 'Medium' }, { id: 'high', nombre: 'High' }, { id: 'xhigh', nombre: 'Extra high' }, { id: 'max', nombre: 'Max' }],
    conversaciones: [
      { id: 'c1', proyecto: 'La Esquina', sitio: 'laesquina.com', url: 'laesquina.com/admin?ver=pedidos&mesa=12', donde: '', titulo: '', ocupado: false },
      { id: 'c2', proyecto: '', sitio: 'docs.google.com', url: 'docs.google.com/spreadsheets/d/…', donde: '', titulo: '', ocupado: false }
    ],
    inicial: 'c1',
    remoto: qs.has('remoto'), // `?demo&remoto`: como lo ve el celular
    adjuntos: [
      { id: 'a1', url: mockShot('Pedir', 18), nombre: 'captura.png', imagen: true, origen: 'ventana' },
      { id: 'a0', url: '#', nombre: 'precios-noviembre.xlsx', imagen: false, tamano: 48213, origen: 'archivo' }
    ]
  };

  function later(c, ms, fn) { c.timers.push(setTimeout(fn, ms * SPEED)); }
  function emit(ev) { history.push(ev); if (handler) handler(ev); }

  function play(conv, steps) {
    var c = convs[conv];
    var t = 0;
    steps.forEach(function (s) {
      t += s[0];
      later(c, t, function () { s[1].conv = conv; emit(s[1]); });
    });
    return t;
  }

  function stream(text, gap) {
    var out = [];
    var i = 0;
    while (i < text.length) {
      var n = 3 + Math.floor((i * 7) % 6);
      out.push([gap, { tipo: 'texto', delta: text.slice(i, i + n) }]);
      i += n;
    }
    return out;
  }

  var ANSWER_1 =
    'El botón queda cortado porque el contenedor tiene un **ancho fijo de 320 px** y `overflow-hidden`:\n\n' +
    '```tsx\n<div className="w-[320px] overflow-hidden">\n  <BotonPedir />\n</div>\n```\n\n' +
    'En `components/menu/BotonPedir.tsx` (línea 42):\n\n' +
    '- el ancho no se adapta a pantallas de menos de 360 px\n' +
    '- el padding lateral suma 24 px de más\n\n' +
    'Con `max-w-full` y `px-3` se resuelve. ¿Lo arreglo?';
  var ANSWER_2 = 'Listo: ancho adaptable y menos padding en el botón. Tipos OK, commit `a1b2c3d`.';
  // La marca que enseña: la lista de pasos con sus etiquetas (la UI las esconde y resalta los renglones).
  var GUIA_1 = 'Son tres pasos:\n\n1. Tocá «Tools», arriba en la cinta. [MARCAR:12] [MAS:Ahí están las opciones generales. | Se abre la cinta Tools.]\n';
  var GUIA_2 = '2. Tocá «Application Options», a la izquierda. [LUEGO:Application Options] [MAS:Es el primer botón. | Se abre un diálogo.]\n' +
    '3. Tocá «OK». [LUEGO:OK] [MAS:Guarda y cierra. | Se cierra el diálogo.]\n\nDespués la rueda hace zoom al revés.';
  var tutos = {}; // id → { conv, paso, pausado }
  function avisoTuto(id) { var t = tutos[id]; emit({ tipo: 'tutorial', conv: t.conv, id: id, marca: 0, paso: t.paso, total: 3, pausado: t.pausado || undefined, fin: t.fin || undefined }); }

  function turn(conv, kind) {
    var c = convs[conv];
    c.busy = true;
    var id = ++c.turn;
    var steps = [[200, { tipo: 'turno-inicio', id: id }]];
    if (kind === 'fix') {
      steps.push([700, { tipo: 'herramienta', nombre: 'Read', detalle: 'components/menu/BotonPedir.tsx' }]);
      steps.push([350, { tipo: 'herramienta', nombre: 'Edit', detalle: 'components/menu/BotonPedir.tsx' }]);
      steps.push([350, { tipo: 'herramienta', nombre: 'Bash', detalle: 'npx tsc --noEmit' }]);
      steps.push([600, { tipo: 'herramienta', nombre: 'Bash', detalle: 'git commit -m "fix(menú): el botón Pedir entra en pantallas chicas"' }]);
      steps = steps.concat(stream(ANSWER_2, 25));
      steps.push([300, { tipo: 'turno-fin', id: id, costoUsd: 0.06, segundos: 18, cambio: true, ok: true }]);
      steps.push([500, { tipo: 'publicar-confirmar', motivos: ['El repo está en la rama feature/web-cliente y se publica desde main.'] }]);
    } else if (kind === 'ask') {
      steps.push([600, { tipo: 'herramienta', nombre: 'Grep', detalle: 'BotonPedir' }]);
      steps.push([400, { tipo: 'herramienta', nombre: 'Glob', detalle: 'components/menu/**/*.tsx' }]);
      steps.push([400, { tipo: 'herramienta', nombre: 'Read', detalle: 'components/menu/BotonPedir.tsx' }]);
      steps.push([300, { tipo: 'herramienta', nombre: 'Agent', detalle: 'Buscar estilos del contenedor del menú' }]);
      steps = steps.concat(stream(ANSWER_1, 22));
      steps.push([250, { tipo: 'turno-fin', id: id, costoUsd: 0.04, segundos: 31, cambio: false, ok: true }]);
    } else if (kind === 'guia') {
      var tid = conv + '-t' + id;
      tutos[tid] = { conv: conv, paso: 1 };
      steps.push([500, { tipo: 'herramienta', nombre: 'PowerShell', detalle: 'marcar.ps1' }]);
      steps = steps.concat(stream(GUIA_1, 8));
      steps.push([100, { tipo: 'marcar', texto: 'Tocá «Tools», arriba en la cinta.', nombre: 'Tools', imagen: mockShot('Tools', 210), caja: { x: 120, y: 120, w: 80, h: 40 }, ancho: 320, alto: 240 }]);
      steps.push([10, { tipo: 'tutorial', id: tid, marca: 0, paso: 1, total: 1 }]);
      steps = steps.concat(stream(GUIA_2, 8));
      steps.push([200, { tipo: 'turno-fin', id: id, costoUsd: 0.03, segundos: 9, cambio: false, ok: true, contexto: 52000 }]);
    } else if (kind === 'corta') {
      // Una pregunta que se contesta sin herramientas: en el modo barra queda en la tarjeta.
      steps = steps.concat(stream('Baja los pedidos de hoy en un Excel (`pedidos-2026-11-23.xlsx`), con los filtros que tengas puestos arriba. Está en `app/admin/pedidos/exportar.ts`.', 12));
      steps.push([200, { tipo: 'turno-fin', id: id, costoUsd: 0.01, segundos: 3, cambio: false, ok: true, contexto: 41000 }]);
    } else if (kind === 'terminemos') {
      steps.push([300, { tipo: 'herramienta', nombre: 'Bash', detalle: 'git log --oneline -5' }]);
      steps = steps.concat(stream('Listo, todo commiteado. Para el chat nuevo:\n\n```\nRetomamos el demo. Vengo del terminemos de demo-1: sigue el botón Pedir.\n```', 6));
      steps.push([200, { tipo: 'turno-fin', id: id, costoUsd: 0.05, segundos: 40, cambio: false, ok: true, contexto: 168000 }]);
    } else {
      steps.push([500, { tipo: 'herramienta', nombre: 'Read', detalle: 'C:/Users/Ana/Documents/precios-noviembre.xlsx' }]);
      steps = steps.concat(stream('Es una demo: acá respondería Claude con lo que le pidas.', 25));
      steps.push([200, { tipo: 'turno-fin', id: id, costoUsd: 0.01, segundos: 4, cambio: false, ok: true, contexto: 41200 }]);
    }
    var total = play(conv, steps);
    later(c, total + 5, function () { c.busy = false; });
  }

  function publish(conv) {
    play(conv, [
      [300, { tipo: 'publicacion', paso: 'push', texto: 'Subiendo a origin/main…' }],
      [1100, { tipo: 'publicacion', paso: 'armando', texto: 'Vercel está armando el sitio…' }],
      [1800, { tipo: 'publicacion', paso: 'publicado', texto: 'Publicado: laesquina.com ya tiene el cambio.' }]
    ]);
  }

  function api(path, method, body) {
    body = body || {};
    if (path === '/api/contexto') return ctx;
    if (path === '/api/historial') return [];
    if (path === '/api/conversacion' && method === 'POST') {
      if (body.id) return { id: body.id, proyecto: body.proyecto };
      var id = 'c' + (nextConv++);
      convs[id] = { busy: false, turn: 0, timers: [] };
      return { id: id, proyecto: body.proyecto || '', sitio: body.sitio || '', url: body.url || '', donde: body.donde || '', titulo: '', ocupado: false };
    }
    if (path === '/api/mensaje') {
      var c = convs[body.conv];
      if (c.busy) { var e = new Error('Esta conversación todavía está corriendo.'); e.status = 409; throw e; }
      var t = body.texto || '';
      turn(body.conv, t === '/terminemos' ? 'terminemos' : /arregl|dale/i.test(t) ? 'fix' : /guiame|guíame/i.test(t) ? 'guia' : /^¿qué hace/i.test(t) ? 'corta' : /por qu|bot/i.test(t) ? 'ask' : 'other');
      return { ok: true };
    }
    if (path === '/api/detener') {
      var cd = convs[body.conv];
      cd.timers.forEach(clearTimeout); cd.timers = []; cd.busy = false;
      emit({ tipo: 'turno-fin', conv: body.conv, id: cd.turn, costoUsd: 0.01, segundos: 3, cambio: false, detenido: true });
      return { ok: true };
    }
    if (path === '/api/publicar') { if (body.confirmar) publish(body.conv); return { ok: true }; }
    if (path === '/api/tutorial') {
      var tu = tutos[body.id];
      var salto = body.accion === 'repetir' || body.accion === 'paso';
      if (!tu || (tu.fin && !salto)) { var et = new Error('Ese paso a paso ya no está.'); et.status = 409; throw et; }
      if (salto) { tu.fin = false; tu.paso = body.accion === 'paso' ? body.n : 1; }
      tu.pausado = body.accion === 'salir';
      setTimeout(function () { avisoTuto(body.id); }, 50);
      return { ok: true };
    }
    if (path === '/api/borrador') { borradores[body.conv] = body.texto || ''; return { ok: true }; }
    if (path === '/api/audio') return { ok: true, texto: body.parcial ? 'Esto lo' : 'Esto lo dije por audio.' };
    if (path === '/api/voz') return { ok: true, lista: true, motor: 'demo' };
    if (path === '/api/raiz') { ctx.raiz = body.raiz || ''; return { ok: true, raiz: ctx.raiz, proyectos: ctx.raiz ? ctx.proyectos : [] }; }
    if (path === '/api/adjunto') {
      var aid = 'a' + (nextAtt++);
      var img = /^image\//.test(body.tipo || '');
      return { id: aid, url: img && body.blob ? URL.createObjectURL(body.blob) : mockShot('Pegada', 200), nombre: body.nombre || 'archivo', imagen: img || !body.nombre, tamano: body.tamano };
    }
    return { ok: true };
  }

  window.__demo = {
    api: function (p, m, b) {
      try { return Promise.resolve(api(p, m, b)); } catch (e) { return Promise.reject(e); }
    },
    emit: emit,
    // La pestaña ocupada en el servidor sin que la UI lo sepa (la otra pantalla mandó algo un instante antes).
    ocupar: function (conv, b) { convs[conv].busy = b; },
    borrador: function (conv) { return borradores[conv] || ''; },
    // Simula tocar el recuadro: el paso siguiente (o el fin de la lista).
    tocar: function (id) { var t = tutos[id]; if (!t) return; if (t.paso >= 3) t.fin = true; else t.paso++; avisoTuto(id); },
    connect: function (h) { handler = h; history.forEach(h); }
  };
})();
