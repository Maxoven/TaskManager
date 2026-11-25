// Шлюз ai.ecoestate.tv — простой чат с помощником для людей без технической подготовки.
//   /, /login, /static/*   — страницы портала
//   /api/login|logout|me|start|ping, /api/files/upload — своё API
//   /api/oc/*              — узкий список запросов к OpenCode в среде человека (разговоры, сообщения, события, файлы)
//   /screen/*              — экран облачного браузера из среды (noVNC)
// Интерфейс самого OpenCode наружу не отдаётся: он на английском и рассчитан на программистов.
// Вход — аккаунтом Task Manager (тот же email и пароль, те же правила регистрации).
const path = require('path');
const http = require('http');
const { Readable } = require('stream');
const express = require('express');
const jwt = require('jsonwebtoken');
const httpProxy = require('http-proxy');
const config = require('./config');
const containers = require('./containers');
const { startLlmProxy } = require('./llm');
const services = require('./services');

const COOKIE = 'aip_session';
const SESSION_DAYS = 30;
const PUBLIC = path.join(__dirname, '..', 'public');
const WORKSPACE = '/home/user/workspace';

// Страницы отдаём с номером версии в адресах скриптов и стилей: после выкладки браузер сразу берёт новые файлы
const VERSION = Date.now().toString(36);
const page = (name) => require('fs').readFileSync(path.join(PUBLIC, name), 'utf8').replaceAll('__V__', VERSION);
const PAGES = { login: page('login.html'), portal: page('portal.html') };

// ─── Сессия ────────────────────────────────────────────────────────────────
function readSession(cookieHeader) {
  const raw = String(cookieHeader || '').split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  try {
    return jwt.verify(decodeURIComponent(raw.slice(COOKIE.length + 1)), config.sessionSecret);
  } catch {
    return null;
  }
}

function setSession(res, user, tmToken) {
  const token = jwt.sign({ uid: user.id, name: user.name, email: user.email, tm: tmToken }, config.sessionSecret, { expiresIn: `${SESSION_DAYS}d` });
  res.cookie(COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: SESSION_DAYS * 86400000, path: '/' });
}

const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

async function taskmanager(pathname, { method = 'GET', body, token, ip } = {}) {
  const r = await fetch(`${config.taskmanagerApi}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json', 'X-Lang': 'ru',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(ip ? { 'X-Forwarded-For': ip } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  let data = null; try { data = await r.json(); } catch { /* пусто */ }
  return { status: r.status, data };
}

// ─── Прокси в среду ─────────────────────────────────────────────────────────
const proxy = httpProxy.createProxyServer({ ws: true, xfwd: false, proxyTimeout: 0, timeout: 0 });

proxy.on('proxyReq', (proxyReq, req) => {
  if (req.aipAuth) proxyReq.setHeader('Authorization', req.aipAuth);
  proxyReq.removeHeader('Cookie');
});
proxy.on('proxyReqWs', (proxyReq, req) => {
  if (req.aipAuth) proxyReq.setHeader('Authorization', req.aipAuth);
  proxyReq.removeHeader('Cookie');
});
proxy.on('proxyRes', (proxyRes) => {
  delete proxyRes.headers['set-cookie'];
  delete proxyRes.headers['www-authenticate'];
});
proxy.on('error', (err, req, res) => {
  console.error('[proxy]', req.url, err.message);
  if (res && typeof res.writeHead === 'function' && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Помощник сейчас недоступен' }));
  } else if (res && typeof res.destroy === 'function') {
    res.destroy();
  }
});

const basic = (ep) => 'Basic ' + Buffer.from(`opencode:${ep.password}`).toString('base64');

// Что браузеру можно спрашивать у OpenCode. Остального (настройки с ключами, терминал, запись куда угодно) нет.
const ID = '[A-Za-z0-9_-]+';
const OC_ALLOWED = [
  ['GET', new RegExp('^/session$')],
  ['POST', new RegExp('^/session$')],
  ['GET', new RegExp('^/session/active$')],
  ['GET', new RegExp(`^/session/${ID}$`)],
  ['PATCH', new RegExp(`^/session/${ID}$`)],
  ['DELETE', new RegExp(`^/session/${ID}$`)],
  ['GET', new RegExp(`^/session/${ID}/message$`)],
  ['POST', new RegExp(`^/session/${ID}/prompt$`)],
  ['POST', new RegExp(`^/session/${ID}/interrupt$`)],
  ['GET', new RegExp(`^/session/${ID}/permission$`)],
  ['POST', new RegExp(`^/session/${ID}/permission/${ID}/reply$`)],
  ['GET', new RegExp('^/event$')],
  ['GET', new RegExp('^/fs/list$')],
  ['GET', new RegExp('^/fs/read/.+')]
];

// ─── Приложение ─────────────────────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use('/static', express.static(path.join(PUBLIC, 'static'), { maxAge: 0 }));

const json = express.json({ limit: '20kb' });
const requireSession = (req, res, next) => {
  req.session = readSession(req.headers.cookie);
  if (!req.session) return res.status(401).json({ error: 'Нужно войти' });
  next();
};
// Запросы к API принимаем только со своих страниц
const sameOrigin = (req, res, next) => {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'Запрос с другого сайта' });
  next();
};
app.use('/api', sameOrigin);

// Раньше по этому адресу открывался интерфейс OpenCode, и он ставил в браузер service worker, который
// продолжал бы показывать старую страницу. Этот файл его снимает и чистит кэш.
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/javascript').send(
    "self.addEventListener('install', () => self.skipWaiting());\n" +
    "self.addEventListener('activate', (e) => e.waitUntil((async () => {\n" +
    "  for (const k of await caches.keys()) await caches.delete(k);\n" +
    "  await self.registration.unregister();\n" +
    "  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);\n" +
    "})()));\n");
});

app.get('/login', (req, res) => {
  if (readSession(req.headers.cookie)) return res.redirect('/');
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(PAGES.login);
});

app.get('/', (req, res) => {
  if (!readSession(req.headers.cookie)) return res.redirect('/login');
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(PAGES.portal);
});

app.post('/api/login', json, async (req, res) => {
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Введите email и пароль' });
  try {
    // linkMail: заодно подключить корпоративную почту (если она на one.com и пароль тот же), чтобы помощник мог с ней работать
    const r = await taskmanager('/auth/login', { method: 'POST', body: { email, password, linkMail: true }, ip: clientIp(req) });
    if (r.status !== 200 || !r.data?.user) {
      return res.status(r.status === 429 ? 429 : 401).json({ error: r.data?.error || 'Не удалось войти' });
    }
    setSession(res, r.data.user, r.data.token);
    res.json({ ok: true });
  } catch (e) {
    console.error('[login]', e.message);
    res.status(502).json({ error: 'Task Manager сейчас недоступен, попробуйте позже' });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', requireSession, (req, res) => {
  res.json({ user: { name: req.session.name, email: req.session.email }, taskmanagerUrl: config.taskmanagerUrl });
});

// Подготовить рабочее место (запускается само при входе и после сна). Заодно проверяем, что аккаунт ещё действует.
app.post('/api/start', requireSession, async (req, res) => {
  try {
    const me = await taskmanager('/auth/me', { token: req.session.tm });
    if (me.status === 401) {
      res.clearCookie(COOKIE, { path: '/' });
      return res.status(401).json({ error: 'Нужно войти заново' });
    }
    const user = me.data?.id ? me.data : { id: req.session.uid, name: req.session.name, email: req.session.email };
    const result = await containers.ensureRunning(user);
    if (result.state === 'busy') {
      return res.status(503).json({ state: 'busy', error: 'Сейчас помощником пользуются другие сотрудники, и свободных мест нет. Попробуйте через несколько минут.' });
    }
    res.json({ state: 'ready' });
  } catch (e) {
    console.error('[start]', req.session.uid, e);
    res.status(500).json({ error: 'Не получилось подготовить помощника. Попробуйте ещё раз через минуту.' });
  }
});

// Страница открыта и видна — рабочее место не засыпает
app.post('/api/ping', requireSession, (req, res) => {
  containers.touch(req.session.uid);
  res.json({ ok: true });
});

// Загрузка файла в рабочую папку: тело запроса — сам файл
const SAFE_SEGMENT = /^[^/\\\0]{1,200}$/;
function workspacePath(dir, name) {
  const segments = [...String(dir || '').split('/').filter(Boolean), String(name || '')];
  if (!segments.length || segments.some(s => !SAFE_SEGMENT.test(s) || s === '.' || s === '..' || s.startsWith('.'))) return null;
  return `${WORKSPACE}/${segments.join('/')}`;
}

app.post('/api/files/upload', requireSession, async (req, res) => {
  const target = workspacePath(req.query.dir, req.query.name);
  if (!target) return res.status(400).json({ error: 'Недопустимое имя файла' });
  if (Number(req.headers['content-length'] || 0) > config.maxUploadMb * 1024 * 1024) {
    return res.status(413).json({ error: `Файл больше ${config.maxUploadMb} МБ` });
  }
  try {
    const ep = await containers.endpoint(req.session.uid);
    if (!ep) return res.status(409).json({ state: 'asleep', error: 'Помощник спит' });
    containers.touch(req.session.uid);
    const r = await fetch(`http://${ep.ip}:4096/api/experimental/fs/write?path=${encodeURIComponent(target)}`, {
      method: 'POST',
      headers: { Authorization: basic(ep), 'Content-Type': 'application/octet-stream' },
      body: Readable.toWeb(req),
      duplex: 'half'
    });
    if (!r.ok) {
      console.error('[upload]', r.status, (await r.text()).slice(0, 200));
      return res.status(500).json({ error: 'Не получилось сохранить файл' });
    }
    res.json({ path: target.slice(WORKSPACE.length + 1) });
  } catch (e) {
    console.error('[upload]', e.message);
    res.status(500).json({ error: 'Не получилось сохранить файл' });
  }
});

// ─── Сервисы ────────────────────────────────────────────────────────────────
async function withSandbox(req, res, fn) {
  try {
    const ep = await containers.endpoint(req.session.uid);
    if (!ep) return res.status(409).json({ state: 'asleep', error: 'Помощник спит' });
    containers.touch(req.session.uid);
    res.json(await fn(ep));
  } catch (e) {
    if (e instanceof services.ServiceError) return res.status(e.status).json({ error: e.message });
    console.error('[services]', req.path, e);
    res.status(500).json({ error: 'Не получилось. Попробуйте ещё раз.' });
  }
}

const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const slug = (name) => String(name).toLowerCase().replace(/[а-яё]/g, c => TRANSLIT[c] ?? '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

app.get('/api/services', requireSession, (req, res) => withSandbox(req, res, async (ep) => {
  const [list, mail] = await Promise.all([
    services.list(req.session.uid, ep),
    taskmanager('/auth/mail', { token: req.session.tm }).catch(() => null)
  ]);
  return {
    // Почту показываем, только если её вообще можно подключить (корпоративный адрес)
    mail: mail?.status === 200 && ['ok', 'none'].includes(mail.data?.mail) ? { state: mail.data.mail, email: mail.data.email } : null,
    services: list
  };
}));

app.post('/api/services/mail', requireSession, json, async (req, res) => {
  try {
    const r = await taskmanager('/auth/mail', { method: 'POST', token: req.session.tm, body: { password: String(req.body?.password || '') }, ip: clientIp(req) });
    if (r.status !== 200) return res.status(r.status === 401 ? 401 : 400).json({ error: r.data?.error || 'Не получилось подключить почту' });
    const ep = await containers.endpoint(req.session.uid);
    if (ep) await services.refreshTaskmanager(ep);
    res.json({ state: 'ok' });
  } catch (e) {
    console.error('[mail]', e.message);
    res.status(502).json({ error: 'Task Manager сейчас недоступен, попробуйте позже' });
  }
});

app.delete('/api/services/mail', requireSession, async (req, res) => {
  try {
    await taskmanager('/auth/mail', { method: 'DELETE', token: req.session.tm });
    const ep = await containers.endpoint(req.session.uid);
    if (ep) await services.refreshTaskmanager(ep);
    res.json({ state: 'none' });
  } catch (e) {
    res.status(502).json({ error: 'Task Manager сейчас недоступен, попробуйте позже' });
  }
});

app.post('/api/services/custom', requireSession, json, (req, res) => withSandbox(req, res, (ep) => {
  const name = String(req.body?.name || '').trim();
  const id = slug(name);
  if (!name || id.length < 2) throw new services.ServiceError('Напишите название сервиса (буквами или цифрами).');
  return services.connect(req.session.uid, ep, id, { name, url: String(req.body?.url || '').trim(), key: String(req.body?.key || '').trim() });
}));

app.post('/api/services/:id/connect', requireSession, (req, res) => withSandbox(req, res, (ep) => {
  if (!services.ID_RE.test(req.params.id)) throw new services.ServiceError('Сервис не найден.', 404);
  return services.connect(req.session.uid, ep, req.params.id);
}));

app.post('/api/services/:id/disconnect', requireSession, (req, res) => withSandbox(req, res, (ep) =>
  services.disconnect(req.session.uid, ep, req.params.id)));

const ATTEMPT = /^[A-Za-z0-9_-]{4,80}$/;
app.get('/api/services/attempt/:integrationID/:attemptID', requireSession, (req, res) => withSandbox(req, res, (ep) => {
  if (!ATTEMPT.test(req.params.integrationID) || !ATTEMPT.test(req.params.attemptID)) throw new services.ServiceError('Не найдено', 404);
  return services.attemptStatus(ep, req.params.integrationID, req.params.attemptID);
}));
app.delete('/api/services/attempt/:integrationID/:attemptID', requireSession, (req, res) => withSandbox(req, res, async (ep) => {
  if (!ATTEMPT.test(req.params.integrationID) || !ATTEMPT.test(req.params.attemptID)) throw new services.ServiceError('Не найдено', 404);
  await services.cancelAttempt(ep, req.params.integrationID, req.params.attemptID);
  return { ok: true };
}));

app.use('/api/oc', requireSession, async (req, res) => {
  if (!OC_ALLOWED.some(([method, re]) => method === req.method && re.test(req.path))) {
    return res.status(404).json({ error: 'Не найдено' });
  }
  try {
    const ep = await containers.endpoint(req.session.uid);
    if (!ep) return res.status(409).json({ state: 'asleep', error: 'Помощник спит' });
    containers.touch(req.session.uid);
    req.url = `/api${req.url}`;
    req.aipAuth = basic(ep);
    proxy.web(req, res, { target: `http://${ep.ip}:4096` });
  } catch (e) {
    console.error('[oc]', e.message);
    res.status(502).json({ error: 'Помощник сейчас недоступен' });
  }
});

// Экран облачного браузера: статические файлы noVNC из среды
app.use('/screen', requireSession, async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const ep = await containers.endpoint(req.session.uid);
    if (!ep) return res.status(409).json({ state: 'asleep' });
    proxy.web(req, res, { target: `http://${ep.ip}:6080` });
  } catch (e) {
    res.status(502).end();
  }
});

app.use((req, res) => {
  if (req.method === 'GET' && req.accepts('html') && !req.path.startsWith('/api/')) return res.redirect('/');
  res.status(404).json({ error: 'Не найдено' });
});

const server = http.createServer(app);
server.requestTimeout = 0;
server.headersTimeout = 60000;

// WebSocket нужен только экрану облачного браузера
server.on('upgrade', async (req, socket, head) => {
  const session = readSession(req.headers.cookie);
  const origin = req.headers.origin;
  if (!session || req.url !== '/screen/websockify' || (origin && origin !== config.publicUrl)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return socket.destroy();
  }
  try {
    const ep = await containers.endpoint(session.uid);
    if (!ep) { socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return socket.destroy(); }
    containers.touch(session.uid);
    // Человек двигает мышь или печатает в облачном браузере — рабочее место активно
    let last = 0;
    socket.on('data', () => { const now = Date.now(); if (now - last > 30000) { last = now; containers.touch(session.uid); } });
    req.url = '/websockify';
    proxy.ws(req, socket, head, { target: `http://${ep.ip}:6080` });
  } catch (e) {
    console.error('[ws]', e.message);
    socket.destroy();
  }
});

server.listen(config.port, '127.0.0.1', () => console.log(`🚀 Портал: 127.0.0.1:${config.port}`));
startLlmProxy();
containers.startReaper();
