// Токен среды для прокси моделей: u<ID>.<HMAC>. Без состояния — переживает перезапуск шлюза.
// Настоящие ключи DeepSeek/GLM в среды не попадают: прокси подставляет их сам.
const crypto = require('crypto');
const config = require('./config');

const sign = (id) => crypto.createHmac('sha256', config.sessionSecret).update(`llm:${id}`).digest('base64url');

function userToken(userId) {
  return `u${Number(userId)}.${sign(Number(userId))}`;
}

function verifyToken(token) {
  const m = /^u(\d{1,9})\.([A-Za-z0-9_-]{43})$/.exec(String(token || ''));
  if (!m) return null;
  const expected = Buffer.from(sign(Number(m[1])));
  const given = Buffer.from(m[2]);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? Number(m[1]) : null;
}

module.exports = { userToken, verifyToken };
