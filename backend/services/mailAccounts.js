// Подключение корпоративной почты к MCP.
//
// У one.com нет OAuth: почтовый сервер принимает только адрес и пароль ящика. Поэтому при входе
// ИИ-клиента (страница входа MCP) тот же пароль проверяется на почтовом сервере и, если подошёл,
// сохраняется зашифрованным (AES-256-GCM). Ключ — MAIL_ENCRYPTION_KEY в .env, отдельно от базы:
// дамп базы без ключа пароль не раскрывает. Без ключа почта не подключается вовсе.
//
// Пароль отправляется на почтовый сервер только для доменов, чья почта действительно на one.com
// (MX-записи *.one.com) — пароль от Gmail и прочих ящиков никуда не уходит. Для тестов и других
// провайдеров сервер можно задать явно: MAIL_IMAP_HOST, MAIL_SMTP_HOST и MAIL_DOMAINS.
const crypto = require('crypto');
const dns = require('dns').promises;
const { ImapFlow } = require('imapflow');
const pool = require('../config/database');

const LOGIN_TIMEOUT_MS = 10000;
const MX_CACHE_MS = 60 * 60 * 1000;

const ONE_COM = {
  imap: { host: 'imap.one.com', port: 993, secure: true },
  smtp: { host: 'send.one.com', port: 465, secure: true }
};

function encryptionKey() {
  const raw = process.env.MAIL_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

const isEnabled = () => !!encryptionKey();

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function decrypt(value) {
  const [version, iv, tag, data] = String(value).split(':');
  if (version !== 'v1') throw new Error('Unknown encryption format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

const bool = (v, fallback) => (v === undefined ? fallback : !['0', 'false', 'no'].includes(String(v).toLowerCase()));

function configuredServers() {
  if (!process.env.MAIL_IMAP_HOST) return null;
  return {
    imap: {
      host: process.env.MAIL_IMAP_HOST,
      port: Number(process.env.MAIL_IMAP_PORT) || 993,
      secure: bool(process.env.MAIL_IMAP_SECURE, true)
    },
    smtp: {
      host: process.env.MAIL_SMTP_HOST || process.env.MAIL_IMAP_HOST,
      port: Number(process.env.MAIL_SMTP_PORT) || 465,
      secure: bool(process.env.MAIL_SMTP_SECURE, true)
    }
  };
}

const mxCache = new Map(); // домен → { oneCom, at }

async function domainOnOneCom(domain) {
  const cached = mxCache.get(domain);
  if (cached && Date.now() - cached.at < MX_CACHE_MS) return cached.oneCom;
  let oneCom = false;
  try {
    const records = await dns.resolveMx(domain);
    oneCom = records.some(r => /(^|\.)one\.com\.?$/i.test(r.exchange));
  } catch {
    oneCom = false;
  }
  mxCache.set(domain, { oneCom, at: Date.now() });
  return oneCom;
}

// Почтовые серверы для адреса или null, если почту этого домена мы не подключаем
async function serversFor(email) {
  const domain = String(email).split('@')[1]?.toLowerCase();
  if (!domain) return null;
  const configured = configuredServers();
  if (configured) {
    const domains = (process.env.MAIL_DOMAINS || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
    return domains.includes('*') || domains.includes(domain) ? configured : null;
  }
  return (await domainOnOneCom(domain)) ? ONE_COM : null;
}

function imapClient(account) {
  return new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure,
    auth: { user: account.email, pass: account.password },
    logger: false,
    connectionTimeout: LOGIN_TIMEOUT_MS,
    greetingTimeout: LOGIN_TIMEOUT_MS
  });
}

// 'ok' | 'auth_failed' | 'unavailable'
async function checkLogin(account) {
  const client = imapClient(account);
  client.on('error', () => {});
  try {
    await client.connect();
    await client.logout();
    return 'ok';
  } catch (error) {
    return error.authenticationFailed ? 'auth_failed' : 'unavailable';
  }
}

async function saveAccount(userId, account) {
  await pool.query(`
    INSERT INTO mail_accounts (user_id, email, password_enc, imap_host, imap_port, imap_secure,
                               smtp_host, smtp_port, smtp_secure, connected_at, last_error, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NULL, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      email = EXCLUDED.email, password_enc = EXCLUDED.password_enc,
      imap_host = EXCLUDED.imap_host, imap_port = EXCLUDED.imap_port, imap_secure = EXCLUDED.imap_secure,
      smtp_host = EXCLUDED.smtp_host, smtp_port = EXCLUDED.smtp_port, smtp_secure = EXCLUDED.smtp_secure,
      connected_at = NOW(), last_error = NULL, updated_at = NOW()
  `, [userId, account.email, encrypt(account.password), account.imap.host, account.imap.port, account.imap.secure,
    account.smtp.host, account.smtp.port, account.smtp.secure]);
}

async function deleteAccount(userId) {
  await pool.query('DELETE FROM mail_accounts WHERE user_id = $1', [userId]);
}

// Вызывается после успешного входа на странице MCP: тот же пароль пробуем на почтовом сервере.
// Ошибки почты вход в таскменеджер не ломают.
async function linkOnLogin(userId, email, password) {
  if (!isEnabled()) return 'disabled';
  const servers = await serversFor(email);
  if (!servers) return 'not_supported';
  const account = { email, password, ...servers };
  const result = await checkLogin(account);
  if (result === 'ok') await saveAccount(userId, account);
  // Пароль от почты другой — старое подключение (если было) больше не годится
  else if (result === 'auth_failed') await deleteAccount(userId);
  return result;
}

async function getAccount(userId) {
  if (!isEnabled()) return null;
  const { rows } = await pool.query('SELECT * FROM mail_accounts WHERE user_id = $1', [userId]);
  const row = rows[0];
  if (!row) return null;
  let password;
  try {
    password = decrypt(row.password_enc);
  } catch {
    return null; // ключ сменили — нужен повторный вход
  }
  return {
    userId,
    email: row.email,
    password,
    imap: { host: row.imap_host, port: row.imap_port, secure: row.imap_secure },
    smtp: { host: row.smtp_host, port: row.smtp_port, secure: row.smtp_secure },
    lastError: row.last_error
  };
}

async function hasAccount(userId) {
  if (!isEnabled()) return false;
  const { rows } = await pool.query('SELECT 1 FROM mail_accounts WHERE user_id = $1', [userId]);
  return rows.length > 0;
}

async function markError(userId, message) {
  await pool.query('UPDATE mail_accounts SET last_error = $2, updated_at = NOW() WHERE user_id = $1', [userId, message]);
}

module.exports = {
  isEnabled, serversFor, linkOnLogin, getAccount, hasAccount, deleteAccount, markError, imapClient,
  encrypt, decrypt
};
