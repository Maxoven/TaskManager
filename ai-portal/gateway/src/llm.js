// Прокси моделей для сред: /deepseek/v1/chat/completions, /zai/v1/chat/completions и /giga/v1/chat/completions (GigaChat, через gigachat.js),
// а также /mcp/taskmanager (Task Manager и почта) и выход сред на сайты (egress.js):
// среды используют этот же порт как обычный веб-прокси.
// Проверяет токен среды и модель из разрешённого списка, подставляет настоящий ключ, пишет расход по людям.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const config = require('./config');
const { verifyToken } = require('./tokens');
const containers = require('./containers');
const { handleTaskmanagerMcp } = require('./taskmanagerMcp');
const egress = require('./egress');
const gigachat = require('./gigachat');

const MAX_BODY = 30 * 1024 * 1024;
const ALLOWED_PATHS = new Set(['chat/completions']);

function send(res, status, error) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: error, type: 'aiportal' } }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Запрос слишком большой'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

fs.mkdirSync(path.dirname(config.llm.usageLog), { recursive: true });
function logUsage(entry) {
  fs.appendFile(config.llm.usageLog, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', () => {});
}

// Ищем usage в потоке SSE (последний чанк при stream_options.include_usage) или в обычном JSON
function usageScanner() {
  let tail = ''; let usage = null;
  return {
    push(text) {
      tail = (tail + text).slice(-20000);
      const re = /"usage"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g;
      let m; while ((m = re.exec(tail))) { try { usage = JSON.parse(m[1]); } catch { /* неполный */ } }
    },
    get usage() { return usage; }
  };
}

const bearer = (req) => verifyToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));

async function handle(req, res) {
  if (egress.handleHttp(req, res)) return; // среда открывает сайт по http:// через прокси
  if (req.url === '/mcp/taskmanager') {
    const uid = bearer(req);
    if (uid === null) return send(res, 401, 'Неверный токен среды');
    containers.touch(uid);
    let raw;
    try { raw = await readBody(req); } catch (e) { return send(res, e.status || 400, e.message); }
    return handleTaskmanagerMcp(req, res, uid, raw);
  }
  const m = /^\/(deepseek|zai|giga)\/v1\/(.+?)(\?.*)?$/.exec(req.url);
  if (!m) return send(res, 404, 'Not found');
  const [, providerId, apiPath] = m;
  const provider = config.llm.providers[providerId];
  if (req.method !== 'POST' || !ALLOWED_PATHS.has(apiPath)) return send(res, 404, 'Not found');

  const userId = bearer(req);
  if (userId === null) return send(res, 401, 'Неверный токен среды');
  if (!provider.key) return send(res, 503, `Ключ ${providerId} не настроен`);

  let body;
  try {
    body = JSON.parse((await readBody(req)).toString('utf8'));
  } catch (e) {
    return send(res, e.status || 400, e.status ? e.message : 'Некорректный JSON');
  }
  if (!provider.models.includes(body.model)) {
    return send(res, 403, `Модель ${body.model} недоступна. Разрешены: ${provider.models.join(', ')}`);
  }
  if (body.stream) body.stream_options = { ...(body.stream_options || {}), include_usage: true };

  containers.touch(userId);
  const started = Date.now();
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ac.abort(); });

  if (provider.adapter === 'gigachat') {
    // У GigaChat свой формат и очередь по одному запросу; пока человек ждёт очереди, среду не усыпляем
    const waiting = setInterval(() => containers.touch(userId), 30000);
    try {
      return await gigachat.handle({
        provider, body, res, signal: ac.signal,
        onChunk: () => containers.touch(userId),
        onDone: ({ status, usage, error }) => logUsage({
          user: userId, provider: providerId, model: body.model, status, error, ms: Date.now() - started,
          prompt_tokens: usage?.prompt_tokens, completion_tokens: usage?.completion_tokens, cached_tokens: usage?.precached_prompt_tokens
        })
      });
    } finally { clearInterval(waiting); }
  }

  let upstream;
  try {
    upstream = await fetch(`${provider.base}/${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}` },
      body: JSON.stringify(body),
      signal: ac.signal
    });
  } catch (e) {
    logUsage({ user: userId, provider: providerId, model: body.model, error: e.message });
    return send(res, 502, `Модель недоступна: ${e.message}`);
  }

  const headers = { 'Content-Type': upstream.headers.get('content-type') || 'application/json' };
  if (body.stream) Object.assign(headers, { 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
  res.writeHead(upstream.status, headers);

  const scan = usageScanner();
  const decoder = new TextDecoder();
  const stream = Readable.fromWeb(upstream.body);
  stream.on('data', chunk => {
    scan.push(decoder.decode(chunk, { stream: true }));
    containers.touch(userId);
    res.write(chunk);
  });
  stream.on('end', () => {
    res.end();
    const u = scan.usage || {};
    logUsage({
      user: userId, provider: providerId, model: body.model, status: upstream.status, ms: Date.now() - started,
      prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens,
      cached_tokens: u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens
    });
  });
  stream.on('error', e => {
    if (!res.headersSent) send(res, 502, e.message); else res.end();
  });
}

function startLlmProxy() {
  const server = http.createServer((req, res) => {
    handle(req, res).catch(e => {
      console.error('[llm]', e);
      if (!res.headersSent) send(res, 500, 'Ошибка прокси моделей'); else res.end();
    });
  });
  egress.startEgress(server); // выход сред в интернет: CONNECT на этом же порту
  server.requestTimeout = 0;
  server.headersTimeout = 60000;
  server.listen(config.llm.port, config.llm.host, () =>
    console.log(`[llm] прокси моделей на ${config.llm.host}:${config.llm.port}`));
  server.on('error', e => {
    // Сеть aiportal поднимает Docker; если шлюз стартовал раньше — пробуем снова
    console.error('[llm] не удалось открыть порт:', e.message, '— повтор через 5 с');
    setTimeout(() => server.listen(config.llm.port, config.llm.host), 5000);
  });
}

module.exports = { startLlmProxy };
