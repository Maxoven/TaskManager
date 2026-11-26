// Маленький безопасный рендер Markdown для ответов помощника: сначала всё экранируется,
// затем размечаются абзацы, списки, таблицы, код и ссылки (только http/https).
// Картинки показываются только из файлов человека: ![подпись](Мои файлы/Картинки/x.jpg) → <img data-file="…">,
// саму картинку подгружает portal.js. Картинки с чужих сайтов не загружаются.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const IMAGE_FILE = /\.(jpe?g|png|gif|webp)$/i;

function inline(text) {
  const codes = []; const images = [];
  const source = text.replace(/!\[([^\]\n]*)\]\(([^)\n]+)\)/g, (m, alt, src) => {
    const file = src.trim().replace(/^\.\//, '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(file) || file.startsWith('/') || file.split('/').includes('..') || !IMAGE_FILE.test(file)) return m;
    images.push({ alt, file });
    return `\u0001${images.length - 1}\u0001`;
  });
  let s = esc(source).replace(/`([^`\n]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[Number(i)]}</code>`)
    .replace(/\u0001(\d+)\u0001/g, (m, i) => `<img class="md-image" data-file="${esc(images[Number(i)].file)}" alt="${esc(images[Number(i)].alt || 'Картинка')}">`);
}

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
const isTableRule = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function renderMarkdown(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = /^\s*```/.test(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) { out.push(`<h3>${inline(heading[2])}</h3>`); i++; continue; }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { out.push('<hr>'); i++; continue; }

    if (line.includes('|') && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }

    const bullet = /^\s*[-*+]\s+/, numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const marker = ordered ? numbered : bullet;
      const items = [];
      while (i < lines.length && (marker.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (marker.test(lines[i])) items.push(lines[i].replace(marker, ''));
        else items[items.length - 1] += '\n' + lines[i].trim();
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map(t => `<li>${inline(t).replace(/\n/g, '<br>')}</li>`).join('')}</${tag}>`);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${inline(quote.join('\n')).replace(/\n/g, '<br>')}</blockquote>`);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) &&
           !bullet.test(lines[i]) && !numbered.test(lines[i]) && !/^\s*>\s?/.test(lines[i]) &&
           !(lines[i].includes('|') && i + 1 < lines.length && isTableRule(lines[i + 1]))) {
      para.push(lines[i++]);
    }
    out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }
  return out.join('');
}
