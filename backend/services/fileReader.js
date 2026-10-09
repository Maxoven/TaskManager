// Чтение содержимого файлов задач для ИИ-ассистента.
// Возвращает { kind: 'text', text } | { kind: 'image', mime, base64 } | { kind: 'unsupported', reason }.
const fs = require('fs/promises');
const path = require('path');
const { unzipSync, strFromU8 } = require('fflate');

const MAX_TEXT_CHARS = 60000;                 // на один файл — чтобы не раздувать запрос к модели
const MAX_UNPACKED_BYTES = 50 * 1024 * 1024;  // защита от «zip-бомб»

const limitText = (text) => {
  const clean = String(text || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return { kind: 'unsupported', reason: 'The file contains no readable text (it may be a scan or an empty document).' };
  return clean.length > MAX_TEXT_CHARS
    ? { kind: 'text', text: clean.slice(0, MAX_TEXT_CHARS), truncated: true }
    : { kind: 'text', text: clean };
};

const decodeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

// Распаковываем только нужные части архива и не больше MAX_UNPACKED_BYTES
function unzip(buffer, wanted) {
  let total = 0;
  return unzipSync(new Uint8Array(buffer), {
    filter: (file) => {
      if (!wanted(file.name)) return false;
      total += file.originalSize;
      return total <= MAX_UNPACKED_BYTES;
    }
  });
}

// .docx — это zip с XML: абзацы <w:p>, текст в <w:t>
function readDocx(buffer) {
  const files = unzip(buffer, (name) => name === 'word/document.xml');
  const xml = files['word/document.xml'];
  if (!xml) return { kind: 'unsupported', reason: 'The .docx file is damaged.' };
  const text = strFromU8(xml).split(/<\/w:p>/).map(paragraph =>
    decodeXml(
      paragraph
        .replace(/<w:tab\/>/g, '\t')
        .replace(/<w:br[^>]*\/>/g, '\n')
        .replace(/<\/w:tc>/g, '\t')
        .replace(/<[^>]+>/g, '')
    )
  ).join('\n');
  return limitText(text);
}

// .xlsx — zip с XML: общая таблица строк + листы; отдаём строки через « | »
function readXlsx(buffer) {
  const files = unzip(buffer, (name) =>
    name === 'xl/sharedStrings.xml' || name === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  const shared = files['xl/sharedStrings.xml']
    ? (strFromU8(files['xl/sharedStrings.xml']).match(/<si>[\s\S]*?<\/si>/g) || []).map(si =>
        decodeXml((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('')))
    : [];
  const names = files['xl/workbook.xml']
    ? (strFromU8(files['xl/workbook.xml']).match(/<sheet [^>]*name="([^"]*)"/g) || []).map(s => decodeXml(s.match(/name="([^"]*)"/)[1]))
    : [];
  const sheetFiles = Object.keys(files).filter(n => n.startsWith('xl/worksheets/'))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  const parts = sheetFiles.map((file, index) => {
    const rows = (strFromU8(files[file]).match(/<row[^>]*>[\s\S]*?<\/row>/g) || []).map(row =>
      (row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).map(cell => {
        const type = (cell.match(/ t="([^"]+)"/) || [])[1];
        if (type === 'inlineStr') return decodeXml((cell.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '');
        const value = (cell.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (value === undefined) return '';
        return type === 's' ? (shared[Number(value)] ?? '') : decodeXml(value);
      }).join(' | ')
    ).filter(line => line.replace(/[ |]/g, ''));
    return `# ${names[index] || `Sheet ${index + 1}`}\n${rows.join('\n')}`;
  });
  return limitText(parts.join('\n\n'));
}

function listZip(buffer) {
  const names = [];
  unzipSync(new Uint8Array(buffer), { filter: (file) => { names.push(`${file.name} (${file.originalSize} bytes)`); return false; } });
  return limitText(`ZIP archive, ${names.length} entries (contents of the entries are not read):\n${names.join('\n')}`);
}

async function readPdf(buffer) {
  // Подключаем модуль напрямую: корневой index.js у pdf-parse при запуске пытается читать тестовый файл
  const pdfParse = require('pdf-parse/lib/pdf-parse.js');
  const { text } = await pdfParse(buffer);
  return limitText(text);
}

async function readAttachment(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  const buffer = await fs.readFile(filePath);
  try {
    switch (ext) {
      case '.txt': return limitText(buffer.toString('utf8'));
      case '.pdf': return await readPdf(buffer);
      case '.docx': return readDocx(buffer);
      case '.xlsx': return readXlsx(buffer);
      case '.zip': return listZip(buffer);
      case '.png': return { kind: 'image', mime: 'image/png', base64: buffer.toString('base64') };
      case '.jpg':
      case '.jpeg': return { kind: 'image', mime: 'image/jpeg', base64: buffer.toString('base64') };
      default:
        return { kind: 'unsupported', reason: `Files of type ${ext || 'unknown'} cannot be read here (old Word/Excel formats and RAR archives are not supported). Suggest saving the file as .docx, .xlsx or .pdf.` };
    }
  } catch (e) {
    console.error('[AI] Не удалось прочитать файл', originalName, e.message);
    return { kind: 'unsupported', reason: 'The file could not be read (it may be damaged or password-protected).' };
  }
}

module.exports = { readAttachment };
