// «Сервисы»: что подключено помощнику и подключение новых в один клик.
// Сервис — это MCP-сервер в настройках OpenCode человека (~/.config/opencode/opencode.json). Вход в сервис
// (OAuth) OpenCode ведёт сам: выдаёт адрес страницы входа, мы открываем её в облачном браузере человека,
// он входит на «Экране помощника», а обратный адрес (127.0.0.1 внутри среды) ловит сам OpenCode.
const config = require('./config');
const containers = require('./containers');

const CONFIG_FILE = '/home/user/.config/opencode/opencode.json';
const NAMES_FILE = '/home/user/.config/opencode/portal-services.json';
const SECRETS_DIR = '/home/user/.secrets';
const BUILTIN = new Set(['browser', 'taskmanager']);

// Проверено с сервера: отдают страницу входа. Notion, GitHub, Miro, Zapier из России недоступны.
// Сервисы Google требуют своего OAuth-клиента (GOOGLE_OAUTH_CLIENT_ID) — пока его нет, показываем «скоро».
const CATALOG = [
  { id: 'gmail', name: 'Gmail', about: 'Почта Google: искать и читать письма, готовить черновики', google: true },
  { id: 'gcalendar', name: 'Google Календарь', about: 'Встречи и события', google: true },
  { id: 'gdrive', name: 'Google Диск', about: 'Документы и таблицы на Диске', google: true },
  { id: 'todoist', name: 'Todoist', about: 'Личные списки дел', url: 'https://ai.todoist.net/mcp' },
  { id: 'canva', name: 'Canva', about: 'Макеты, презентации, картинки', url: 'https://mcp.canva.com/mcp' },
  { id: 'atlassian', name: 'Jira и Confluence', about: 'Задачи и база знаний Atlassian', url: 'https://mcp.atlassian.com/v1/mcp' },
  { id: 'figma', name: 'Figma', about: 'Дизайн-макеты', url: 'https://mcp.figma.com/mcp' },
  { id: 'linear', name: 'Linear', about: 'Задачи команды разработки', url: 'https://mcp.linear.app/mcp' }
];
const byId = new Map(CATALOG.map(s => [s.id, s]));
const ID_RE = /^[a-z0-9][a-z0-9_-]{1,30}$/;

class ServiceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const basic = (ep) => 'Basic ' + Buffer.from(`opencode:${ep.password}`).toString('base64');

async function oc(ep, method, path, body) {
  const r = await fetch(`http://${ep.ip}:4096${path}`, {
    method,
    headers: { Authorization: basic(ep), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000)
  });
  let data = null;
  try { data = await r.json(); } catch { /* 204 */ }
  return { status: r.status, data: data && typeof data === 'object' && 'data' in data ? data.data : data };
}

async function writeFile(ep, file, text) {
  const r = await fetch(`http://${ep.ip}:4096/api/experimental/fs/write?path=${encodeURIComponent(file)}`, {
    method: 'POST', headers: { Authorization: basic(ep), 'Content-Type': 'application/octet-stream' }, body: text
  });
  if (!r.ok) throw new ServiceError('Не получилось сохранить настройки', 500);
}

async function readJson(userId, file) {
  const { code, stdout } = await containers.exec(userId, ['cat', file]);
  if (code !== 0 || !stdout.trim()) return {};
  try {
    return JSON.parse(stdout);
  } catch {
    throw new ServiceError('Настройки помощника повреждены. Попросите помощника: «исправь файл настроек opencode.json».', 500);
  }
}

const mcpList = async (ep) => { const r = await oc(ep, 'GET', '/api/mcp'); return Array.isArray(r.data) ? r.data : []; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// После изменения настроек OpenCode перечитывает их и заново подключает сервисы — ждём, пока статус устоится
async function reloadAndWait(ep, name, present = true) {
  await oc(ep, 'POST', '/api/location/reload');
  const until = Date.now() + 25000;
  let entry;
  while (Date.now() < until) {
    await sleep(1200);
    entry = (await mcpList(ep)).find(s => s.name === name);
    if (!present && !entry) return null;
    if (present && entry && entry.status?.status !== 'pending') return entry;
  }
  return entry || null;
}

function stateOf(entry) {
  const s = entry?.status?.status;
  if (s === 'connected') return 'connected';
  if (s === 'needs_auth') return 'signin';
  if (s === 'pending') return 'pending';
  return entry ? 'failed' : 'off';
}

async function list(userId, ep) {
  const [live, names] = await Promise.all([mcpList(ep), readJson(userId, NAMES_FILE).catch(() => ({}))]);
  const liveByName = new Map(live.map(s => [s.name, s]));
  const googleReady = !!config.google.clientId;
  const services = CATALOG.map(s => ({
    id: s.id, name: s.name, about: s.about,
    state: s.google && !googleReady ? 'soon' : stateOf(liveByName.get(s.id))
  }));
  for (const s of live) {
    if (BUILTIN.has(s.name) || byId.has(s.name)) continue;
    services.push({ id: s.name, name: names[s.name]?.name || s.name, about: 'Добавлен вручную', state: stateOf(s), custom: true });
  }
  return services;
}

function serverConfig(def) {
  if (def.google) throw new ServiceError('Этот сервис ещё не настроен администратором.');
  return { type: 'remote', url: def.url };
}

async function ensureConfigured(userId, ep, id, server) {
  const cfg = await readJson(userId, CONFIG_FILE);
  cfg.mcp = cfg.mcp && typeof cfg.mcp === 'object' ? cfg.mcp : {};
  cfg.mcp.servers = cfg.mcp.servers && typeof cfg.mcp.servers === 'object' ? cfg.mcp.servers : {};
  if (JSON.stringify(cfg.mcp.servers[id]) === JSON.stringify(server)) return false;
  cfg.mcp.servers[id] = server;
  await writeFile(ep, CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n');
  return true;
}

// Начать вход в сервис: получить адрес страницы входа и открыть её в облачном браузере человека
async function beginSignin(userId, ep, entry) {
  const integrationID = entry.integrationID;
  if (!integrationID) throw new ServiceError('Сервис не поддерживает вход. Проверьте адрес или укажите ключ.');
  const info = await oc(ep, 'GET', `/api/integration/${integrationID}`);
  const method = (info.data?.methods || []).find(m => m.type === 'oauth');
  if (!method) throw new ServiceError('Сервис не поддерживает вход. Проверьте адрес или укажите ключ.');
  const attempt = await oc(ep, 'POST', `/api/integration/${integrationID}/connect/oauth`, { methodID: method.id || integrationID });
  if (attempt.status !== 200 || !attempt.data?.url) {
    console.error('[services] oauth', entry.name, attempt.status, JSON.stringify(attempt.data).slice(0, 300));
    throw new ServiceError('Сервис не дал страницу входа. Попробуйте позже.', 502);
  }
  const opened = await containers.exec(userId, ['curl', '-s', '-m', '10', '-X', 'PUT',
    `http://127.0.0.1:9222/json/new?${encodeURIComponent(attempt.data.url)}`]);
  if (opened.code !== 0) throw new ServiceError('Не получилось открыть страницу входа на экране помощника.', 500);
  return { state: 'signin', attemptID: attempt.data.attemptID, integrationID };
}

async function connect(userId, ep, id, custom) {
  let server;
  if (custom) {
    if (!ID_RE.test(id) || BUILTIN.has(id) || byId.has(id)) throw new ServiceError('Такое название уже занято, выберите другое.');
    let url;
    try { url = new URL(custom.url); } catch { throw new ServiceError('Адрес сервиса должен начинаться с https://'); }
    if (url.protocol !== 'https:') throw new ServiceError('Адрес сервиса должен начинаться с https://');
    server = { type: 'remote', url: url.href };
    if (custom.key) {
      await writeFile(ep, `${SECRETS_DIR}/${id}`, String(custom.key).trim());
      server.oauth = false;
      server.headers = { Authorization: `Bearer {file:~/.secrets/${id}}` };
    }
    const names = await readJson(userId, NAMES_FILE).catch(() => ({}));
    names[id] = { name: String(custom.name || id).slice(0, 60) };
    await writeFile(ep, NAMES_FILE, JSON.stringify(names, null, 2) + '\n');
  } else {
    const def = byId.get(id);
    if (def) server = serverConfig(def);
  }

  let entry = (await mcpList(ep)).find(s => s.name === id);
  if (server) {
    if (await ensureConfigured(userId, ep, id, server) || !entry) entry = await reloadAndWait(ep, id);
  }
  if (!entry) throw new ServiceError('Сервис не найден.', 404);

  const state = stateOf(entry);
  if (state === 'connected') return { state: 'connected' };
  if (state === 'signin') return beginSignin(userId, ep, entry);
  if (state === 'pending') return { state: 'pending' };
  console.error('[services] connect', id, JSON.stringify(entry.status).slice(0, 300));
  throw new ServiceError('Не получилось подключиться к сервису. Проверьте адрес или попробуйте позже.', 502);
}

async function attemptStatus(ep, integrationID, attemptID) {
  const r = await oc(ep, 'GET', `/api/integration/${integrationID}/connect/oauth/${attemptID}`);
  if (r.status !== 200) return { status: 'expired' };
  return { status: r.data?.status || 'pending' };
}

async function cancelAttempt(ep, integrationID, attemptID) {
  await oc(ep, 'DELETE', `/api/integration/${integrationID}/connect/oauth/${attemptID}`).catch(() => {});
}

async function disconnect(userId, ep, id) {
  if (BUILTIN.has(id) || !ID_RE.test(id)) throw new ServiceError('Этот сервис отключить нельзя.');
  const entry = (await mcpList(ep)).find(s => s.name === id);
  // Сохранённый вход в сервис тоже убираем, иначе при повторном подключении он вернётся без спроса
  if (entry?.integrationID) {
    const creds = await oc(ep, 'GET', '/api/credential').catch(() => ({ data: [] }));
    for (const c of Array.isArray(creds.data) ? creds.data : []) {
      if (c.integrationID === entry.integrationID && c.id) await oc(ep, 'DELETE', `/api/credential/${c.id}`).catch(() => {});
    }
  }
  const cfg = await readJson(userId, CONFIG_FILE);
  if (cfg.mcp?.servers?.[id]) {
    delete cfg.mcp.servers[id];
    await writeFile(ep, CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n');
  }
  await containers.exec(userId, ['rm', '-f', `${SECRETS_DIR}/${id}`]).catch(() => {});
  await reloadAndWait(ep, id, false);
  return { state: 'off' };
}

// Task Manager перечитывает список инструментов (после подключения почты в нём появляются инструменты почты)
async function refreshTaskmanager(ep) {
  await oc(ep, 'POST', '/api/location/reload').catch(() => {});
}

module.exports = { list, connect, disconnect, attemptStatus, cancelAttempt, refreshTaskmanager, ServiceError, ID_RE };
