// OAuth 2.1 для MCP-сервера: ИИ-клиент (Claude, Claude Managed Agents и др.) сам регистрируется,
// открывает страницу входа, человек вводит email и пароль от Task Manager — клиент получает токены.
// Пароль ИИ-клиенту не передаётся: он видит только токены, которые можно отозвать.
//
// Эндпоинты (стандартные обработчики из @modelcontextprotocol/sdk, хранилище — PostgreSQL):
//   /.well-known/oauth-authorization-server     — метаданные сервера авторизации (RFC 8414)
//   /.well-known/oauth-protected-resource/api/mcp — метаданные ресурса (RFC 9728)
//   /api/mcp/oauth/register  — регистрация клиента (RFC 7591)
//   /api/mcp/oauth/authorize — страница входа
//   /api/mcp/oauth/login     — проверка email/пароля, выдача кода
//   /api/mcp/oauth/token     — обмен кода и refresh-токена (PKCE обязателен)
//   /api/mcp/oauth/revoke    — отзыв refresh-токена
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const rateLimit = require('../middleware/rateLimit');
const { authorizationHandler } = require('@modelcontextprotocol/sdk/server/auth/handlers/authorize.js');
const { tokenHandler } = require('@modelcontextprotocol/sdk/server/auth/handlers/token.js');
const { clientRegistrationHandler } = require('@modelcontextprotocol/sdk/server/auth/handlers/register.js');
const { revocationHandler } = require('@modelcontextprotocol/sdk/server/auth/handlers/revoke.js');
const { metadataHandler } = require('@modelcontextprotocol/sdk/server/auth/handlers/metadata.js');
const { InvalidGrantError, InvalidTokenError, InvalidTargetError } = require('@modelcontextprotocol/sdk/server/auth/errors.js');

const ACCESS_TTL_SEC = 60 * 60;                 // access-токен — 1 час
const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000; // refresh-токен — 60 дней, при каждом обновлении новый
const CODE_TTL_MS = 5 * 60 * 1000;               // код авторизации — 5 минут, одноразовый
const PENDING_TTL = '15m';                       // сколько можно держать открытой страницу входа
const SCOPE = 'taskmanager';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');
const trimSlash = (url) => url.replace(/\/+$/, '');
const sameUrl = (a, b) => trimSlash(String(a).split('#')[0]) === trimSlash(String(b).split('#')[0]);

function urls() {
  const base = trimSlash(process.env.MCP_PUBLIC_URL || process.env.FRONTEND_URL || `http://localhost:${process.env.PORT || 3001}`);
  return {
    issuer: base,
    mcp: `${base}/api/mcp`,
    oauth: `${base}/api/mcp/oauth`,
    resourceMetadata: `${base}/.well-known/oauth-protected-resource/api/mcp`
  };
}

// ─── Хранилище клиентов ──────────────────────────────────────────────────────
const clientsStore = {
  async getClient(clientId) {
    const { rows } = await pool.query('SELECT info FROM mcp_oauth_clients WHERE client_id = $1', [clientId]);
    return rows[0]?.info;
  },
  async registerClient(client) {
    // client_id и секрет генерирует обработчик SDK; если вдруг нет — создаём сами
    const info = { ...client, client_id: client.client_id || crypto.randomUUID() };
    await pool.query('INSERT INTO mcp_oauth_clients (client_id, info) VALUES ($1, $2)', [info.client_id, info]);
    return info;
  }
};

// ─── Токены ─────────────────────────────────────────────────────────────────
async function issueTokens(clientId, userId, scopes) {
  const scope = scopes.length ? scopes.join(' ') : SCOPE;
  const accessToken = jwt.sign(
    { userId, typ: 'mcp', cid: clientId, scope },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TTL_SEC, audience: urls().mcp }
  );
  const refreshToken = randomToken();
  await pool.query(
    `INSERT INTO mcp_oauth_refresh_tokens (token_hash, client_id, user_id, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [sha256(refreshToken), clientId, userId, scope, new Date(Date.now() + REFRESH_TTL_MS)]
  );
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SEC,
    refresh_token: refreshToken,
    scope
  };
}

function checkResource(resource) {
  if (resource && !sameUrl(resource.href, urls().mcp)) {
    throw new InvalidTargetError(`Unknown resource: ${resource.href}`);
  }
}

const provider = {
  clientsStore,

  // Страница входа. Параметры запроса подписываем — форма не может их подменить
  async authorize(client, params, res) {
    checkResource(params.resource);
    const pending = jwt.sign({
      cid: client.client_id,
      ru: params.redirectUri,
      cc: params.codeChallenge,
      st: params.state,
      sc: params.scopes || []
    }, process.env.JWT_SECRET, { expiresIn: PENDING_TTL, audience: 'mcp-authorize' });
    sendLoginPage(res, res.req?.lang, { clientName: client.client_name, pending });
  },

  async challengeForAuthorizationCode(client, code) {
    const { rows } = await pool.query(
      `SELECT code_challenge FROM mcp_oauth_codes
       WHERE code_hash = $1 AND client_id = $2 AND used = FALSE AND expires_at > NOW()`,
      [sha256(code), client.client_id]
    );
    if (rows.length === 0) throw new InvalidGrantError('Invalid or expired authorization code');
    return rows[0].code_challenge;
  },

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
    checkResource(resource);
    // Одноразовость: помечаем код использованным одним UPDATE — повторный обмен не пройдёт
    const { rows } = await pool.query(
      `UPDATE mcp_oauth_codes SET used = TRUE
       WHERE code_hash = $1 AND client_id = $2 AND used = FALSE AND expires_at > NOW()
       RETURNING user_id, redirect_uri, scopes`,
      [sha256(code), client.client_id]
    );
    if (rows.length === 0) throw new InvalidGrantError('Invalid or expired authorization code');
    const row = rows[0];
    if (redirectUri !== undefined && redirectUri !== row.redirect_uri) {
      throw new InvalidGrantError('redirect_uri does not match');
    }
    return issueTokens(client.client_id, row.user_id, row.scopes ? row.scopes.split(' ') : []);
  },

  async exchangeRefreshToken(client, refreshToken, _scopes, resource) {
    checkResource(resource);
    // Ротация: старый refresh-токен гасим, выдаём новый
    const { rows } = await pool.query(
      `UPDATE mcp_oauth_refresh_tokens SET revoked_at = NOW()
       WHERE token_hash = $1 AND client_id = $2 AND revoked_at IS NULL AND expires_at > NOW()
       RETURNING user_id, scopes`,
      [sha256(refreshToken), client.client_id]
    );
    if (rows.length === 0) throw new InvalidGrantError('Invalid or expired refresh token');
    const { rows: users } = await pool.query('SELECT id FROM users WHERE id = $1 AND is_verified = TRUE', [rows[0].user_id]);
    if (users.length === 0) throw new InvalidGrantError('User not found');
    return issueTokens(client.client_id, rows[0].user_id, rows[0].scopes ? rows[0].scopes.split(' ') : []);
  },

  async verifyAccessToken(token) {
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET, { audience: urls().mcp });
    } catch {
      throw new InvalidTokenError('Invalid or expired token');
    }
    if (payload.typ !== 'mcp' || !Number.isInteger(payload.userId)) {
      throw new InvalidTokenError('Invalid token');
    }
    const { rows } = await pool.query(
      'SELECT id, language FROM users WHERE id = $1 AND is_verified = TRUE', [payload.userId]
    );
    if (rows.length === 0) throw new InvalidTokenError('User not found');
    return {
      token,
      clientId: payload.cid,
      scopes: String(payload.scope || SCOPE).split(' '),
      expiresAt: payload.exp,
      resource: new URL(urls().mcp),
      extra: { userId: payload.userId, language: rows[0].language }
    };
  },

  // Отзываем refresh-токен (access-токен живёт не дольше часа)
  async revokeToken(client, request) {
    await pool.query(
      `UPDATE mcp_oauth_refresh_tokens SET revoked_at = NOW()
       WHERE token_hash = $1 AND client_id = $2 AND revoked_at IS NULL`,
      [sha256(request.token), client.client_id]
    );
  }
};

// ─── Страница входа ──────────────────────────────────────────────────────────
const TEXTS = {
  ru: {
    title: 'Вход в Task Manager',
    lead: (app) => `<b>${app}</b> просит доступ к вашему аккаунту Task Manager. Он сможет от вашего имени смотреть, создавать, менять и удалять команды, проекты и задачи — всё, что можете вы.`,
    email: 'Email', password: 'Пароль', submit: 'Войти и разрешить доступ',
    note: 'Пароль останется здесь — приложение получит только токен доступа. Отозвать доступ можно, сменив пароль через «Забыли пароль?».',
    invalid: 'Неверный email или пароль',
    unverified: 'Email не подтверждён — откройте ссылку из письма после регистрации',
    expired: 'Страница входа устарела. Вернитесь в приложение и начните подключение заново.',
    tooMany: 'Слишком много попыток. Попробуйте позже.',
    unknownApp: 'ИИ-приложение'
  },
  en: {
    title: 'Sign in to Task Manager',
    lead: (app) => `<b>${app}</b> is asking for access to your Task Manager account. On your behalf it will be able to view, create, change and delete teams, projects and tasks — everything you can do.`,
    email: 'Email', password: 'Password', submit: 'Sign in and allow access',
    note: 'Your password stays here — the app only gets an access token. Resetting your password ("Forgot password?") revokes access.',
    invalid: 'Wrong email or password',
    unverified: 'Email is not verified — open the link from the sign-up email',
    expired: 'This sign-in page has expired. Go back to the app and connect again.',
    tooMany: 'Too many attempts. Try again later.',
    unknownApp: 'An AI app'
  }
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function sendLoginPage(res, lang, { clientName, pending, error, email, status = 200 }) {
  const t = TEXTS[lang] || TEXTS.ru;
  const app = escapeHtml(clientName ? String(clientName).slice(0, 100) : t.unknownApp);
  res.status(status);
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    // Страницу нельзя встроить в чужой сайт (кликджекинг) и подгружать на неё сторонние скрипты
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  });
  res.send(`<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'ru'}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #f4f5f7; color: #1f2328; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  main { background: #fff; width: 100%; max-width: 380px; margin: 16px; padding: 28px; border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06); box-sizing: border-box; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { margin: 0 0 18px; color: #57606a; }
  label { display: block; font-weight: 600; margin: 0 0 4px; }
  input { width: 100%; box-sizing: border-box; padding: 10px 12px; margin: 0 0 14px; font: inherit;
    border: 1px solid #d0d7de; border-radius: 8px; background: inherit; color: inherit; }
  button { width: 100%; padding: 11px; font: inherit; font-weight: 600; color: #fff; background: #2563eb;
    border: 0; border-radius: 8px; cursor: pointer; }
  .error { background: #fdecec; color: #a40e26; padding: 10px 12px; border-radius: 8px; margin: 0 0 14px; }
  small { display: block; margin-top: 14px; color: #6e7781; }
  @media (prefers-color-scheme: dark) {
    body { background: #0d1117; color: #e6edf3; } main { background: #161b22; box-shadow: none; }
    p, small { color: #9198a1; } input { border-color: #30363d; } .error { background: #3d1418; color: #ffa198; }
  }
</style></head><body><main>
<h1>${t.title}</h1>
${pending ? `<p>${t.lead(app)}</p>` : ''}
${error ? `<div class="error" role="alert">${escapeHtml(t[error] || error)}</div>` : ''}
${pending ? `<form method="post" action="${escapeHtml(urls().oauth)}/login">
  <input type="hidden" name="pending" value="${escapeHtml(pending)}">
  <label for="email">${t.email}</label>
  <input id="email" name="email" type="email" autocomplete="username" required value="${escapeHtml(email)}" ${email ? '' : 'autofocus'}>
  <label for="password">${t.password}</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required ${email ? 'autofocus' : ''}>
  <button type="submit">${t.submit}</button>
</form>
<small>${t.note}</small>` : ''}
</main></body></html>`);
}

// Как и обычный вход — не больше 30 попыток за 15 минут с одного IP
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, keyFn: (req) => `mcp-login:${req.ip}` });

async function handleLogin(req, res) {
  const lang = req.lang;
  let pending;
  try {
    pending = jwt.verify(String(req.body.pending || ''), process.env.JWT_SECRET, { audience: 'mcp-authorize' });
  } catch {
    return sendLoginPage(res, lang, { error: 'expired', status: 400 });
  }
  const client = await clientsStore.getClient(pending.cid);
  if (!client || !client.redirect_uris.includes(pending.ru)) {
    return sendLoginPage(res, lang, { error: 'expired', status: 400 });
  }

  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const retry = (error, status) => sendLoginPage(res, lang, {
    clientName: client.client_name, pending: req.body.pending, error, email, status
  });

  const { rows } = await pool.query('SELECT id, password_hash, is_verified FROM users WHERE LOWER(email) = $1', [email]);
  const user = rows[0];
  if (!user || !password || !(await bcrypt.compare(password, user.password_hash))) return retry('invalid', 401);
  if (!user.is_verified) return retry('unverified', 403);

  const code = randomToken();
  await pool.query(
    `INSERT INTO mcp_oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [sha256(code), client.client_id, user.id, pending.ru, pending.cc, (pending.sc || []).join(' '), new Date(Date.now() + CODE_TTL_MS)]
  );
  const target = new URL(pending.ru);
  target.searchParams.set('code', code);
  if (pending.st) target.searchParams.set('state', pending.st);
  res.set('Cache-Control', 'no-store');
  res.redirect(302, target.href);
}

// ─── Маршруты ───────────────────────────────────────────────────────────────
function oauthMetadata() {
  const u = urls();
  return {
    issuer: u.issuer,
    authorization_endpoint: `${u.oauth}/authorize`,
    token_endpoint: `${u.oauth}/token`,
    registration_endpoint: `${u.oauth}/register`,
    revocation_endpoint: `${u.oauth}/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    revocation_endpoint_auth_methods_supported: ['client_secret_post'],
    scopes_supported: [SCOPE]
  };
}

function protectedResourceMetadata() {
  const u = urls();
  return {
    resource: u.mcp,
    authorization_servers: [u.issuer],
    scopes_supported: [SCOPE],
    resource_name: 'Task Manager',
    bearer_methods_supported: ['header']
  };
}

// Метаданные — в корне сайта (так их ищут клиенты); nginx должен проксировать /.well-known/oauth-*
function wellKnownRouter() {
  const router = express.Router();
  const asHandler = metadataHandler(oauthMetadata());
  const prHandler = metadataHandler(protectedResourceMetadata());
  // RFC 8414 / 9728: путь ресурса дописывается после /.well-known/... — отвечаем и на короткий вариант
  router.use(['/.well-known/oauth-authorization-server/api/mcp/oauth', '/.well-known/oauth-authorization-server'], asHandler);
  router.use(['/.well-known/oauth-protected-resource/api/mcp', '/.well-known/oauth-protected-resource'], prHandler);
  return router;
}

function oauthRouter() {
  const router = express.Router();
  router.use('/authorize', authorizationHandler({ provider }));
  router.post('/login', express.urlencoded({ extended: false, limit: '20kb' }), loginLimiter, (req, res, next) => {
    handleLogin(req, res).catch(next);
  });
  router.use('/token', tokenHandler({ provider }));
  router.use('/register', clientRegistrationHandler({ clientsStore }));
  router.use('/revoke', revocationHandler({ provider }));
  return router;
}

module.exports = { provider, oauthRouter, wellKnownRouter, urls, oauthMetadata, protectedResourceMetadata };
