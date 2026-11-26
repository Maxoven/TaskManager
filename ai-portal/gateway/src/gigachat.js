// GigaChat (Сбер): переходник между форматом OpenAI, в котором пишет OpenCode, и форматом GigaChat API.
// Отличия Сбера: вход по ключу авторизации → токен на 30 минут; сертификат Минцифры; функции вместо tools
// (одна за ответ, аргументы объектом, результат — JSON-строкой в сообщении с ролью function); один системный
// промпт; у физлица один поток — поэтому запросы всех людей идут через общую очередь по одному.
// Картинки GigaChat рисует встроенной функцией text2image и отдаёт в тексте меткой <img src="номер файла"/> —
// файл забираем у Сбера, сохраняем человеку (saveImage) и ставим на место метки обычную картинку Markdown.
const https = require('https');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const crypto = require('crypto');

const CA = [...tls.rootCertificates, fs.readFileSync(path.join(__dirname, '..', 'certs', 'russian-trusted-ca.pem'), 'utf8')];
const agent = new https.Agent({ keepAlive: true, ca: CA });
const IDLE_MS = 5 * 60 * 1000; // столько ждём следующий кусок ответа, потом освобождаем очередь

function send(method, url, { headers, body, signal }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, agent, headers, signal }, resolve);
    req.on('error', reject);
    req.setTimeout(IDLE_MS, () => req.destroy(new Error('GigaChat не отвечает')));
    req.end(body);
  });
}
const post = (url, options) => send('POST', url, options);
async function readBuffer(res) {
  const chunks = []; for await (const c of res) chunks.push(Buffer.from(c)); return Buffer.concat(chunks);
}
const readAll = async (res) => (await readBuffer(res)).toString('utf8');

// ---------- Токен доступа ----------
let token = null; let pending = null;
function accessToken(provider, force) {
  if (!force && token && token.exp - Date.now() > 2 * 60 * 1000) return Promise.resolve(token.value);
  pending = pending || (async () => {
    const res = await post(provider.oauth, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', Authorization: `Basic ${provider.key}`, RqUID: crypto.randomUUID() },
      body: `scope=${encodeURIComponent(provider.scope)}`
    });
    const text = await readAll(res);
    if (res.statusCode !== 200) throw Object.assign(new Error(`GigaChat не принял ключ авторизации (${res.statusCode})`), { status: 502, detail: text.slice(0, 300) });
    const j = JSON.parse(text);
    token = { value: j.access_token, exp: j.expires_at };
    return token.value;
  })().finally(() => { pending = null; });
  return pending;
}

// ---------- Очередь: один запрос одновременно ----------
let tail = Promise.resolve(); let waiting = 0;
function inQueue(job) {
  waiting++;
  const run = tail.then(() => { waiting--; return job(); });
  tail = run.catch(() => {});
  return run;
}

// ---------- OpenAI → GigaChat ----------
const SCHEMA_KEYS = ['type', 'description', 'properties', 'required', 'items', 'enum'];
// GigaChat строго проверяет описание функций — оставляем только то, что он точно понимает
function cleanSchema(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { type: 'string' };
  let src = s;
  for (const k of ['anyOf', 'oneOf', 'allOf']) {
    if (!Array.isArray(src[k])) continue;
    const parts = src[k].filter(x => x && x.type !== 'null');
    src = k === 'allOf' ? Object.assign({}, src, ...parts, { properties: Object.assign({}, ...parts.map(p => p.properties || {})) }) : { ...src, ...(parts[0] || {}) };
  }
  const out = {};
  for (const k of SCHEMA_KEYS) if (src[k] !== undefined) out[k] = src[k];
  if (src.const !== undefined && !out.enum) out.enum = [src.const];
  if (Array.isArray(out.type)) out.type = out.type.find(t => t !== 'null') || 'string';
  if (!out.type) out.type = out.properties ? 'object' : out.items ? 'array' : out.enum ? (typeof out.enum[0] === 'number' ? 'number' : 'string') : 'string';
  if (out.type === 'object') {
    const props = {};
    for (const [k, v] of Object.entries(out.properties && typeof out.properties === 'object' ? out.properties : {})) props[k] = cleanSchema(v);
    out.properties = props;
    if (Array.isArray(out.required)) { out.required = out.required.filter(k => k in props); if (!out.required.length) delete out.required; } else delete out.required;
    delete out.items; delete out.enum;
  } else {
    delete out.properties; delete out.required;
    if (out.type === 'array') out.items = cleanSchema(out.items); else delete out.items;
    if (out.enum && !out.enum.length) delete out.enum;
  }
  if (typeof out.description !== 'string') delete out.description;
  return out;
}

// Названия функций у GigaChat — только латиница, цифры и подчёркивание
function nameMap(tools) {
  const toGiga = new Map(); const fromGiga = new Map();
  for (const t of tools) {
    const orig = t.function?.name; if (!orig) continue;
    let n = orig.replace(/[^A-Za-z0-9_]/g, '_'); if (/^[0-9]/.test(n)) n = 'f_' + n;
    while (fromGiga.has(n) && fromGiga.get(n) !== orig) n += '_';
    toGiga.set(orig, n); fromGiga.set(n, orig);
  }
  return { toGiga: (n) => toGiga.get(n) || String(n).replace(/[^A-Za-z0-9_]/g, '_'), fromGiga: (n) => fromGiga.get(n) || n };
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : String(content);
  return content.map(p => {
    if (typeof p === 'string') return p;
    if (p.type === 'text') return p.text || '';
    if (p.type === 'image_url' || p.type === 'image') return '[Здесь была картинка. Эта модель картинки не видит — скажи об этом человеку, если без неё не обойтись.]';
    return '';
  }).filter(Boolean).join('\n');
}

// Результат функции GigaChat принимает только как JSON-объект в строке
function resultJson(content) {
  const text = textOf(content);
  try { const v = JSON.parse(text); if (v && typeof v === 'object' && !Array.isArray(v)) return text; } catch { /* обычный текст */ }
  return JSON.stringify({ result: text });
}
function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { const v = JSON.parse(raw || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : { value: v }; } catch { return { value: String(raw) }; }
}
const STATE_PREFIX = 'gigas_'; // в номере вызова возим functions_state_id, который GigaChat просит вернуть
const stateOf = (id) => (typeof id === 'string' && id.startsWith(STATE_PREFIX) ? id.slice(STATE_PREFIX.length) : undefined);

function toGiga(body) {
  const tools = (body.tools || []).filter(t => t?.type === 'function' && t.function?.name);
  const names = nameMap(tools);
  const src = Array.isArray(body.messages) ? body.messages : [];
  const results = new Map();
  for (const m of src) if (m.role === 'tool' && m.tool_call_id) results.set(m.tool_call_id, m);

  const system = []; const messages = [];
  for (const m of src) {
    if (m.role === 'system' || m.role === 'developer') { const t = textOf(m.content); if (t) system.push(t); continue; }
    if (m.role === 'tool') continue; // ставится сразу за своим вызовом
    if (m.role === 'assistant') {
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls.filter(c => c?.function?.name) : [];
      const text = textOf(m.content);
      if (!calls.length) { if (text) messages.push({ role: 'assistant', content: text }); continue; }
      // Несколько вызовов в одном ответе (остались от другой модели) раскладываем по одному
      calls.forEach((c, i) => {
        const name = names.toGiga(c.function.name);
        const state = stateOf(c.id);
        messages.push({ role: 'assistant', content: i === 0 ? text : '', function_call: { name, arguments: parseArgs(c.function.arguments) }, ...(state ? { functions_state_id: state } : {}) });
        const r = results.get(c.id);
        messages.push({ role: 'function', name, content: r ? resultJson(r.content) : JSON.stringify({ error: 'Результата нет: действие было прервано' }) });
      });
      continue;
    }
    const t = textOf(m.content);
    if (t) messages.push({ role: 'user', content: t });
  }
  // Рисование включаем только основному помощнику (у него есть инструменты) — не заголовкам и пересказам
  const canDraw = tools.length > 0 && body.tool_choice !== 'none' && !tools.some(t => t.function.name === DRAW);
  if (canDraw) system.push(DRAW_HINT);
  if (system.length) messages.unshift({ role: 'system', content: system.join('\n\n') });

  const out = { model: body.model, messages, stream: !!body.stream };
  if (tools.length) {
    out.functions = tools.map(t => ({ name: names.toGiga(t.function.name), description: t.function.description || t.function.name, parameters: cleanSchema(t.function.parameters || { type: 'object' }) }));
    for (const f of out.functions) if (f.parameters.type !== 'object') f.parameters = { type: 'object', properties: {} };
    if (canDraw) out.functions.push({ name: DRAW }); // встроенная функция: достаточно названия
    const choice = body.tool_choice;
    out.function_call = choice === 'none' ? 'none' : choice?.function?.name ? { name: names.toGiga(choice.function.name) } : 'auto';
  }
  for (const k of ['temperature', 'top_p']) if (typeof body[k] === 'number') out[k] = body[k];
  const max = body.max_tokens ?? body.max_completion_tokens;
  if (typeof max === 'number') out.max_tokens = max;
  if (out.stream) out.update_interval = 0;
  return { payload: out, names };
}

// ---------- Картинки ----------
const DRAW = 'text2image';
const DRAW_HINT = 'Ты умеешь рисовать картинки. Если человек просит нарисовать, сгенерировать или придумать изображение (картинку, иллюстрацию, логотип, открытку) — вызови встроенную функцию text2image, не пиши код и не ищи картинку в интернете. Готовая картинка сама сохранится в папку «Мои файлы/Картинки» и покажется человеку в ответе — ссылку на неё не выдумывай.';
const IMAGE_FAILED = '\n\n(Картинка нарисована, но сохранить её не получилось. Попросите нарисовать ещё раз.)\n\n';

async function downloadImage(provider, fileId, signal) {
  const res = await send('GET', `${provider.base}/files/${fileId}/content`, { headers: { Accept: 'application/jpg', Authorization: `Bearer ${await accessToken(provider)}` }, signal });
  const buf = await readBuffer(res);
  if (res.statusCode !== 200) throw new Error(`файл картинки: ${res.statusCode} ${buf.toString('utf8').slice(0, 200)}`);
  return buf;
}

// Пропускает текст ответа, а метки <img src="…"/> меняет на сохранённые картинки. Метка может прийти по кускам.
function imageFilter(replace) {
  let hold = '';
  const partial = (s) => { for (let n = Math.min(4, s.length); n > 0; n--) if ('<img'.startsWith(s.slice(-n))) return s.length - n; return s.length; };
  return {
    async push(text) {
      hold += text; let out = '';
      for (;;) {
        const i = hold.indexOf('<img');
        if (i < 0) { const cut = partial(hold); out += hold.slice(0, cut); hold = hold.slice(cut); break; }
        const j = hold.indexOf('>', i);
        if (j < 0) { out += hold.slice(0, i); hold = hold.slice(i); break; }
        const id = /src="([0-9a-fA-F-]{36})"/.exec(hold.slice(i, j + 1));
        out += hold.slice(0, i) + (id ? await replace(id[1]) : '');
        hold = hold.slice(j + 1);
      }
      return out;
    },
    flush() { const rest = hold; hold = ''; return rest; }
  };
}

// ---------- GigaChat → OpenAI ----------
const FINISH = { function_call: 'tool_calls', stop: 'stop', length: 'length', blacklist: 'content_filter', error: 'stop' };
const BLACKLIST_TEXT = 'На этот запрос GigaChat не отвечает: тема попала под его ограничения. Выберите другую модель в поле ввода.';
const BAD_ARGS_TEXT = 'Не получилось составить действие — попробуйте ещё раз или выберите другую модель.';

function toolCalls(msg, names) {
  const fc = msg.function_call; if (!fc?.name) return undefined;
  const id = msg.functions_state_id ? STATE_PREFIX + msg.functions_state_id : 'call_' + crypto.randomUUID().replace(/-/g, '');
  return [{ index: 0, id, type: 'function', function: { name: names.fromGiga(fc.name), arguments: JSON.stringify(fc.arguments ?? {}) } }];
}
function usageOf(u) {
  if (!u) return undefined;
  return { prompt_tokens: u.prompt_tokens || 0, completion_tokens: u.completion_tokens || 0, total_tokens: u.total_tokens || 0,
    prompt_tokens_details: { cached_tokens: u.precached_prompt_tokens || 0 } };
}

function errorText(status, text) {
  if (status === 402) return 'Бесплатный лимит GigaChat закончился. Выберите другую модель в поле ввода.';
  if (status === 429) return 'GigaChat сейчас занят. Повторите через минуту или выберите другую модель.';
  if (status === 413 || status === 422) return 'GigaChat не принял запрос (возможно, разговор стал слишком длинным). Начните новый разговор или выберите другую модель.';
  let detail = ''; try { detail = JSON.parse(text).message || ''; } catch { /* не JSON */ }
  return `GigaChat ответил ошибкой ${status}${detail ? ': ' + detail : ''}`;
}

async function callGiga(provider, payload, signal) {
  const data = JSON.stringify(payload);
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await post(`${provider.base}/chat/completions`, {
      headers: { 'Content-Type': 'application/json', Accept: payload.stream ? 'text/event-stream' : 'application/json', Authorization: `Bearer ${await accessToken(provider, attempt > 0 && res?.statusCode === 401)}` },
      body: data, signal
    });
    if (res.statusCode === 401 && attempt < 1) { await readAll(res); continue; }      // токен отозван раньше срока
    if (res.statusCode === 429 && attempt < 4) { await readAll(res); await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
    return res;
  }
}

// body — запрос OpenCode в формате OpenAI. onDone({status, usage, error}) — для учёта расхода.
// saveImage(buffer) сохраняет картинку человеку и возвращает путь к ней от его рабочей папки.
async function handle({ provider, body, res, signal, onChunk, onDone, saveImage }) {
  const { payload, names } = toGiga(body);
  const images = imageFilter(async (fileId) => {
    try {
      const where = await saveImage(await downloadImage(provider, fileId, signal));
      return `\n\n![Картинка](${where})\n\n`;
    } catch (e) { console.error('[giga] картинка:', e.message); return IMAGE_FAILED; }
  });
  const send = (status, message) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message, type: 'aiportal' } })); };

  await inQueue(async () => {
    if (signal.aborted) return;
    let up;
    try { up = await callGiga(provider, payload, signal); } catch (e) {
      if (signal.aborted) return;
      console.error('[giga]', e.message, e.detail || '');
      onDone({ error: e.message }); return send(e.status || 502, `GigaChat недоступен: ${e.message}`);
    }
    if (up.statusCode !== 200) {
      const text = await readAll(up);
      console.error('[giga] ошибка', up.statusCode, text.slice(0, 500));
      onDone({ status: up.statusCode }); return send(up.statusCode, errorText(up.statusCode, text));
    }

    const id = 'chatcmpl-' + crypto.randomUUID().replace(/-/g, ''); const created = Math.floor(Date.now() / 1000);
    if (!payload.stream) {
      const j = JSON.parse(await readAll(up)); const c = j.choices?.[0] || {}; const msg = c.message || {};
      const calls = toolCalls(msg, names);
      let content = msg.content || '';
      content = (await images.push(content)) + images.flush();
      if (c.finish_reason === 'blacklist' && !content) content = BLACKLIST_TEXT;
      if (c.finish_reason === 'error' && !content && !calls) content = BAD_ARGS_TEXT;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, object: 'chat.completion', created, model: body.model, usage: usageOf(j.usage),
        choices: [{ index: 0, finish_reason: calls ? 'tool_calls' : FINISH[c.finish_reason] || 'stop', message: { role: 'assistant', content: content || null, ...(calls ? { tool_calls: calls.map(({ index, ...rest }) => rest) } : {}) } }] }));
      return onDone({ status: 200, usage: j.usage });
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    const emit = (delta, finish, extra) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta, finish_reason: finish || null }], ...extra })}\n\n`);
    let usage = null; let finished = false; let sawText = false; let sawCall = false; let first = true; let buf = '';
    const onEvent = async (line) => {
      if (!line.startsWith('data:')) return;
      const raw = line.slice(5).trim(); if (!raw || raw === '[DONE]') return;
      let j; try { j = JSON.parse(raw); } catch { return; }
      if (j.usage) usage = j.usage;
      const c = j.choices?.[0]; if (!c) return;
      const d = c.delta || {}; const delta = {};
      if (d.role === 'function_in_progress') return; // «осталось 00:19», пока рисуется картинка
      if (first) { delta.role = 'assistant'; first = false; }
      let text = d.content ? await images.push(d.content) : '';
      if (c.finish_reason) text += images.flush();
      if (text) { delta.content = text; sawText = true; }
      const calls = toolCalls(d, names);
      if (calls) { delta.tool_calls = calls; sawCall = true; }
      if (c.finish_reason === 'blacklist' && !sawText) delta.content = BLACKLIST_TEXT;
      if (c.finish_reason === 'error' && !sawText && !sawCall) delta.content = BAD_ARGS_TEXT;
      const finish = c.finish_reason ? (sawCall ? 'tool_calls' : FINISH[c.finish_reason] || 'stop') : null;
      if (Object.keys(delta).length || finish) emit(delta, finish);
      if (finish) finished = true;
    };
    try {
      up.setEncoding('utf8');
      for await (const chunk of up) {
        onChunk();
        buf += chunk; let i;
        while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); await onEvent(line); }
      }
      if (buf.trim()) await onEvent(buf.trim());
    } catch (e) {
      if (!signal.aborted) console.error('[giga] поток оборвался:', e.message);
    }
    if (!finished) { const rest = images.flush(); emit(rest ? { content: rest } : {}, sawCall ? 'tool_calls' : 'stop'); }
    if (usage) res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: body.model, choices: [], usage: usageOf(usage) })}\n\n`);
    res.end('data: [DONE]\n\n');
    onDone({ status: 200, usage });
  });
}

module.exports = { handle, toGiga, cleanSchema, queueLength: () => waiting };
