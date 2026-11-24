/* Renderer de markdown chico: párrafos, listas, negritas, código, links, citas, tablas.
   Todo se escapa; solo se permiten links http(s). Tolera texto a medias (streaming). */
(function () {
  'use strict';

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Inline: código, links, negrita, cursiva, tachado
  function inline(src) {
    var codes = [];
    var s = src.replace(/`([^`\n]+)`/g, function (m, c) {
      codes.push(c);
      return '\u0001' + (codes.length - 1) + '\u0002';
    });
    s = esc(s);
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, '$1<a href="$2" rel="noopener">$2</a>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?![\w*])/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    s = s.replace(/\u0001(\d+)\u0002/g, function (m, i) {
      return '<code>' + esc(codes[+i]) + '</code>';
    });
    return s;
  }

  function renderList(items) {
    var html = '';
    var stack = [];
    items.forEach(function (it) {
      var tag = it.ordered ? 'ol' : 'ul';
      while (stack.length && it.indent < stack[stack.length - 1].indent) {
        html += '</li></' + stack.pop().tag + '>';
      }
      var top = stack[stack.length - 1];
      if (!top || it.indent > top.indent) {
        // Una numerada que no arranca en 1 sigue su número (la lista partida por una tarjeta de la marca).
        var start = it.ordered && it.num > 1 ? ' start="' + it.num + '"' : '';
        html += '<' + tag + start + '><li>' + inline(it.text);
        stack.push({ indent: it.indent, tag: tag });
      } else {
        html += '</li><li>' + inline(it.text);
      }
    });
    while (stack.length) html += '</li></' + stack.pop().tag + '>';
    return html;
  }

  var RE_FENCE = /^\s*```\s*([\w+-]*)\s*$/;
  var RE_HEAD = /^(#{1,6})\s+(.*)$/;
  var RE_HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
  var RE_LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  var RE_QUOTE = /^\s*>\s?(.*)$/;
  var RE_TSEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  function splitRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
  }

  function startsBlock(line, next) {
    return RE_FENCE.test(line) || RE_HEAD.test(line) || RE_HR.test(line) || RE_LIST.test(line) ||
      RE_QUOTE.test(line) || (line.indexOf('|') >= 0 && next !== undefined && RE_TSEP.test(next));
  }

  function render(text) {
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      var m;

      if (!line.trim()) { i++; continue; }

      // Bloque de código (si no cierra, se toma hasta el final: streaming)
      if ((m = RE_FENCE.exec(line))) {
        var code = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        out.push('<pre><code' + (m[1] ? ' data-lang="' + esc(m[1]) + '"' : '') + '>' + esc(code.join('\n')) + '</code></pre>');
        continue;
      }

      if ((m = RE_HEAD.exec(line))) {
        var lvl = Math.min(m[1].length + 2, 5);
        out.push('<h' + lvl + '>' + inline(m[2]) + '</h' + lvl + '>');
        i++;
        continue;
      }

      if (RE_HR.test(line)) { out.push('<hr>'); i++; continue; }

      if (RE_QUOTE.test(line)) {
        var q = [];
        while (i < lines.length && RE_QUOTE.test(lines[i])) { q.push(RE_QUOTE.exec(lines[i])[1]); i++; }
        out.push('<blockquote>' + render(q.join('\n')) + '</blockquote>');
        continue;
      }

      if (line.indexOf('|') >= 0 && i + 1 < lines.length && RE_TSEP.test(lines[i + 1])) {
        var head = splitRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim()) { rows.push(splitRow(lines[i])); i++; }
        var t = '<div class="table-wrap"><table><thead><tr>' +
          head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
        rows.forEach(function (r) {
          t += '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
        });
        out.push(t + '</tbody></table></div>');
        continue;
      }

      if ((m = RE_LIST.exec(line))) {
        var items = [];
        while (i < lines.length) {
          var lm = RE_LIST.exec(lines[i]);
          if (lm) {
            items.push({ indent: lm[1].replace(/\t/g, '    ').length, ordered: /\d/.test(lm[2]), num: parseInt(lm[2], 10) || 0, text: lm[3] });
            i++;
          } else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) {
            items[items.length - 1].text += ' ' + lines[i].trim(); // continuación
            i++;
          } else if (!lines[i].trim() && i + 1 < lines.length && RE_LIST.test(lines[i + 1])) {
            i++; // línea en blanco entre ítems
          } else break;
        }
        out.push(renderList(items));
        continue;
      }

      // Párrafo
      var p = [line.trim()];
      i++;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) {
        p.push(lines[i].trim());
        i++;
      }
      out.push('<p>' + inline(p.join(' ')) + '</p>');
    }
    return out.join('');
  }

  window.renderMarkdown = render;
})();
