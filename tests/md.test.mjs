// Pruebas de ui/md.js (el markdown de las respuestas). No es un módulo: se carga en un contexto `vm` con un `window` falso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ventana = {};
vm.runInNewContext(fs.readFileSync(path.join(AQUI, '..', 'ui', 'md.js'), 'utf8'), { window: ventana });
const md = ventana.renderMarkdown;

test('md.js se expone como window.renderMarkdown', () => {
  assert.equal(typeof md, 'function');
});

test('una lista numerada que arranca en 2 sigue ese número (partida por la tarjeta de la marca)', () => {
  assert.equal(md('2. dos\n3. tres'), '<ol start="2"><li>dos</li><li>tres</li></ol>');
  assert.equal(md('1. uno\n2. dos'), '<ol><li>uno</li><li>dos</li></ol>');
});

test('párrafo, negrita, cursiva y tachado', () => {
  assert.equal(md('Hola **mundo**'), '<p>Hola <strong>mundo</strong></p>');
  assert.equal(md('*it* y ~~t~~'), '<p><em>it</em> y <del>t</del></p>');
});

test('los títulos bajan de nivel (# es h3, tope h5)', () => {
  assert.equal(md('# T'), '<h3>T</h3>');
  assert.equal(md('###### T'), '<h5>T</h5>');
});

test('código en línea: se escapa lo de adentro y no se interpreta markdown', () => {
  assert.equal(md('`a<b>` y **neg**'), '<p><code>a&lt;b&gt;</code> y <strong>neg</strong></p>');
  assert.equal(md('`**no**`'), '<p><code>**no**</code></p>');
});

test('bloque de código con lenguaje: escapa el HTML de adentro', () => {
  assert.equal(md('```js\n<b>x</b>\n```'), '<pre><code data-lang="js">&lt;b&gt;x&lt;/b&gt;</code></pre>');
});

test('bloque de código sin cerrar (streaming): toma hasta el final', () => {
  assert.equal(md('```\ncod abierto'), '<pre><code>cod abierto</code></pre>');
});

test('lista con viñetas y sublista', () => {
  assert.equal(md('- a\n- b\n  - c'), '<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul>');
});

test('lista numerada', () => {
  assert.equal(md('1. uno\n2. dos'), '<ol><li>uno</li><li>dos</li></ol>');
});

test('una lista numerada pegada a una de viñetas es otra lista', { todo: 'md.js la mete como un <li> más de la <ul> (no corta el tipo de lista al mismo nivel)' }, () => {
  assert.match(md('- a\n- b\n1. uno'), /<\/ul><ol>/);
});

test('links http(s) se convierten; los javascript: no', () => {
  assert.equal(md('[x](https://a.com/b)'), '<p><a href="https://a.com/b" rel="noopener">x</a></p>');
  const mal = md('[x](javascript:alert(1))');
  assert.ok(!mal.includes('<a '), mal);
});

test('URL suelta se vuelve link y no se lleva el punto final', () => {
  assert.equal(md('sitio https://a.com/x.'), '<p>sitio <a href="https://a.com/x" rel="noopener">https://a.com/x</a>.</p>');
});

test('escape de HTML: <script> no pasa como HTML', () => {
  const h = md('<script>alert(1)</script>');
  assert.ok(!h.includes('<script'), h);
  assert.equal(h, '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

test('escape de HTML también en títulos, listas, citas, tablas y links', () => {
  for (const src of ['# <img src=x onerror=1>', '- <img src=x onerror=1>', '> <img src=x onerror=1>',
    '| a |\n|---|\n| <img src=x onerror=1> |', '[<img src=x onerror=1>](https://a.com)']) {
    assert.ok(!md(src).includes('<img'), src + ' => ' + md(src));
  }
});

test('comillas en el link no se escapan del atributo href', () => {
  const h = md('[x](https://a.com" onmouseover="x)');
  assert.ok(!/<a [^>]*onmouseover=/.test(h), h);
});

test('tabla', () => {
  assert.equal(md('| a | b |\n|---|---|\n| 1 | 2 |'),
    '<div class="table-wrap"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>');
});

test('cita y regla horizontal', () => {
  assert.equal(md('> cita'), '<blockquote><p>cita</p></blockquote>');
  assert.equal(md('---'), '<hr>');
});

test('texto vacío y saltos de línea de Windows', () => {
  assert.equal(md(''), '');
  assert.equal(md('a\r\n\r\nb'), '<p>a</p><p>b</p>');
});
