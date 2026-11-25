const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/database');
const { withTransaction } = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { SUPPORTED } = require('../i18n/messages');
const {
  sendPasswordReset, sendEmailVerification,
  sendRegistrationRequest, sendRegistrationApproved, sendRegistrationRejected
} = require('../services/email');
const rateLimit = require('../middleware/rateLimit');
const mailAccounts = require('../services/mailAccounts');

const router = express.Router();

// Вход/регистрация — защита от перебора; письма — от рассылки спама на чужой адрес
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const emailLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });

// Email храним и ищем в нижнем регистре, иначе User@x.com и user@x.com — разные аккаунты
const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Почта из этих доменов регистрируется сразу; остальные — только по заявке, которую одобряет
// REGISTRATION_APPROVER_EMAIL (письмо со ссылкой на страницу заявки)
const OPEN_DOMAINS = (process.env.REGISTRATION_OPEN_DOMAINS || 'ecosana.club,ecoestate.tv')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
const APPROVER_EMAIL = (process.env.REGISTRATION_APPROVER_EMAIL || 'maksim.vakulenko@ecosana.club').trim().toLowerCase();
const needsApproval = (email) => !OPEN_DOMAINS.includes(email.split('@')[1]);
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const APPROVED_LINK_MS = 7 * 24 * 60 * 60 * 1000; // ссылка «заявка одобрена» — неделя: письмо могут открыть не сразу

async function approverRecipient() {
  const { rows: [u] } = await pool.query('SELECT email, name, language FROM users WHERE LOWER(email) = $1', [APPROVER_EMAIL]);
  return u || { email: APPROVER_EMAIL, name: '', language: 'ru' };
}

// Заявка вместо аккаунта. Повторная заявка с той же почтой обновляет прежнюю (новые имя и пароль).
// Одобряющему пишем не чаще раза в час, чтобы формой нельзя было завалить его письмами;
// в этом случае прежняя ссылка из письма остаётся рабочей.
const REMIND_APPROVER_MS = 60 * 60 * 1000;

async function createRegistrationRequest({ email, name, passwordHash, lang }) {
  const token = crypto.randomBytes(32).toString('hex');
  const { rows: [pending] } = await pool.query(
    `SELECT id, created_at FROM registration_requests WHERE LOWER(email) = $1 AND status = 'pending'`, [email]
  );
  const recent = pending && Date.now() - new Date(pending.created_at).getTime() < REMIND_APPROVER_MS;
  let request;
  if (pending && recent) {
    ({ rows: [request] } = await pool.query(
      `UPDATE registration_requests SET name = $2, password_hash = $3, language = $4
       WHERE id = $1 RETURNING id, email, name`, [pending.id, name, passwordHash, lang]
    ));
    return request;
  }
  if (pending) {
    ({ rows: [request] } = await pool.query(
      `UPDATE registration_requests SET name = $2, password_hash = $3, language = $4, token_hash = $5, created_at = NOW()
       WHERE id = $1 RETURNING id, email, name`, [pending.id, name, passwordHash, lang, sha256(token)]
    ));
  } else {
    ({ rows: [request] } = await pool.query(
      `INSERT INTO registration_requests (email, name, password_hash, language, token_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email, name`, [email, name, passwordHash, lang, sha256(token)]
    ));
  }
  sendRegistrationRequest(await approverRecipient(), request, token).catch(err =>
    console.error('Ошибка отправки заявки на регистрацию:', err)
  );
  return request;
}

const publicUser = (user) => ({ id: user.id, email: user.email, name: user.name, language: user.language, avatar: user.avatar || null });

// Регистрация
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    const email = normalizeEmail(req.body.email);
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';

    if (!name) {
      return res.status(400).json({ error: req.t('nameRequired') });
    }
    if (!EMAIL_RE.test(email) || email.length > 255) {
      return res.status(400).json({ error: req.t('emailInvalid') });
    }
    // Минимум 8 символов
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: req.t('passwordTooShort') });
    }

    const { rows: existing } = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ error: req.t('userExists') });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    if (needsApproval(email)) {
      await createRegistrationRequest({ email, name, passwordHash, lang: req.lang });
      return res.status(202).json({ message: req.t('registrationRequested'), pendingApproval: true });
    }

    const { rows: [user] } = await pool.query(
      `INSERT INTO users (email, password_hash, name, language, is_verified)
       VALUES ($1, $2, $3, $4, FALSE) RETURNING id, email, name, language`,
      [email, passwordHash, name, req.lang]
    );

    // Создаём токен верификации
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 часа
    await pool.query(
      'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, verifyToken, expiresAt]
    );

    // Отправляем письмо (не блокируем ответ если не дошло)
    sendEmailVerification(user, verifyToken).catch(err =>
      console.error('Ошибка отправки письма верификации:', err)
    );

    res.status(201).json({
      message: req.t('registerSuccess'),
      needsVerification: true
    });
  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ error: req.t('registerError') });
  }
});

// Вход
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    const email = normalizeEmail(req.body.email);
    if (!email || typeof password !== 'string') {
      return res.status(401).json({ error: req.t('invalidCredentials') });
    }
    const { rows: users } = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [email]);
    if (users.length === 0) {
      // Заявка ещё не рассмотрена — скажем об этом, но только тому, кто знает пароль из заявки
      const { rows: [pending] } = await pool.query(
        `SELECT password_hash FROM registration_requests WHERE LOWER(email) = $1 AND status = 'pending'`, [email]
      );
      if (pending && await bcrypt.compare(password, pending.password_hash)) {
        return res.status(403).json({ error: req.t('registrationPending'), pendingApproval: true });
      }
      return res.status(401).json({ error: req.t('invalidCredentials') });
    }
    const user = users[0];

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: req.t('invalidCredentials') });
    }

    // Проверяем верификацию
    if (!user.is_verified) {
      return res.status(403).json({
        error: req.t('emailNotVerified'),
        needsVerification: true
      });
    }

    // Запоминаем язык интерфейса — на нём будут приходить письма
    if (user.language !== req.lang) {
      await pool.query('UPDATE users SET language = $1 WHERE id = $2', [req.lang, user.id]);
      user.language = req.lang;
    }

    // AI-портал просит заодно подключить корпоративную почту (как страница входа MCP): пароль уже проверен,
    // на почтовый сервер он уходит только для доменов на one.com. Ошибки почты вход не ломают.
    let mail;
    if (req.body.linkMail === true) {
      const separate = typeof req.body.mailPassword === 'string' && req.body.mailPassword;
      try {
        // Уже подключённую почту не трогаем: её могли подключить с отдельным паролем, а неудачная
        // проверка паролем таскменеджера удалила бы это подключение. Перепроверяем, только если пароль от почты ввели явно.
        if (!separate && await mailAccounts.hasAccount(user.id)) mail = 'ok';
        else mail = (await mailAccounts.linkOnLogin(user.id, user.email.toLowerCase(), separate || password)).status;
      } catch (error) {
        console.error('Не удалось подключить почту при входе:', error.message);
      }
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ user: publicUser(user), token, ...(mail ? { mail } : {}) });
  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ error: req.t('loginError') });
  }
});

// Текущий пользователь — фронтенд обновляет по нему сохранённые данные (имя, фото)
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows: [user] } = await pool.query('SELECT id, email, name, language, avatar FROM users WHERE id = $1', [req.userId]);
    if (!user) return res.status(401).json({ error: req.t('invalidToken') });
    res.json(publicUser(user));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('serverError') });
  }
});

// Корпоративная почта для ИИ-помощника (AI-портал): подключена ли и подключение своим паролем от почты
router.get('/mail', authMiddleware, async (req, res) => {
  try {
    const { rows: [user] } = await pool.query('SELECT email FROM users WHERE id = $1', [req.userId]);
    if (!user) return res.status(401).json({ error: req.t('invalidToken') });
    res.json({ email: user.email, mail: await mailAccounts.status(req.userId, user.email.toLowerCase()) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('serverError') });
  }
});

router.post('/mail', authLimiter, authMiddleware, async (req, res) => {
  try {
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!password) return res.status(400).json({ error: req.t('mailPasswordRequired') });
    const { rows: [user] } = await pool.query('SELECT email FROM users WHERE id = $1', [req.userId]);
    if (!user) return res.status(401).json({ error: req.t('invalidToken') });
    const result = await mailAccounts.connect(req.userId, user.email.toLowerCase(), password);
    if (result.status === 'ok') return res.json({ mail: 'ok' });
    const key = { auth_failed: 'mailPasswordWrong', not_supported: 'mailNotSupported', disabled: 'mailNotSupported' }[result.status] || 'mailUnavailable';
    res.status(result.status === 'unavailable' ? 502 : 400).json({ mail: result.status, error: req.t(key) });
  } catch (error) {
    console.error('Ошибка подключения почты:', error.message);
    res.status(500).json({ error: req.t('serverError') });
  }
});

router.delete('/mail', authMiddleware, async (req, res) => {
  try {
    await mailAccounts.deleteAccount(req.userId);
    res.json({ mail: 'none' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('serverError') });
  }
});

// Смена языка (писем и ответов API) для текущего пользователя
router.patch('/language', authMiddleware, async (req, res) => {
  try {
    const { language } = req.body;
    if (!SUPPORTED.includes(language)) {
      return res.status(400).json({ error: req.t('languageInvalid') });
    }
    await pool.query('UPDATE users SET language = $1 WHERE id = $2', [language, req.userId]);
    res.json({ message: req.t('languageSaved'), language });
  } catch (error) {
    console.error('Ошибка смены языка:', error);
    res.status(500).json({ error: req.t('serverError') });
  }
});

// ─── Заявки на регистрацию ───────────────────────────────────────────────────
// Ссылка из письма одобряющему — сама по себе пропуск (как ссылка сброса пароля): токен из 32 случайных
// байт, в базе только его хеш. Решение — только POST, чтобы почтовые сканеры, открывающие ссылки, ничего не нажали.
async function findRequest(token, client = pool, lock = false) {
  if (!/^[a-f0-9]{64}$/.test(String(token))) return null;
  const { rows: [r] } = await client.query(
    `SELECT * FROM registration_requests WHERE token_hash = $1${lock ? ' FOR UPDATE' : ''}`, [sha256(token)]
  );
  return r || null;
}

const publicRequest = (r) => ({ name: r.name, email: r.email, created_at: r.created_at, status: r.status, decided_at: r.decided_at });

router.get('/registration-requests/:token', authLimiter, async (req, res) => {
  try {
    const request = await findRequest(req.params.token);
    if (!request) return res.status(404).json({ error: req.t('registrationRequestNotFound') });
    res.json(publicRequest(request));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('serverError') });
  }
});

router.post('/registration-requests/:token/approve', authLimiter, async (req, res) => {
  try {
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const result = await withTransaction(async (client) => {
      const request = await findRequest(req.params.token, client, true);
      if (!request) return { status: 404, error: 'registrationRequestNotFound' };
      if (request.status !== 'pending') return { status: 409, error: 'registrationAlreadyDecided', request };
      const { rows: existing } = await client.query('SELECT id FROM users WHERE LOWER(email) = $1', [request.email.toLowerCase()]);
      if (existing.length) return { status: 409, error: 'userExists', request };

      // Почту заявитель ещё не подтверждал: аккаунт создаётся неподтверждённым, ссылка в письме подтверждает и входит
      const { rows: [user] } = await client.query(
        `INSERT INTO users (email, password_hash, name, language, is_verified)
         VALUES ($1, $2, $3, $4, FALSE) RETURNING id, email, name, language`,
        [request.email.toLowerCase(), request.password_hash, request.name, request.language]
      );
      await client.query(
        'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [user.id, verifyToken, new Date(Date.now() + APPROVED_LINK_MS)]
      );
      const { rows: [updated] } = await client.query(
        `UPDATE registration_requests SET status = 'approved', decided_at = NOW() WHERE id = $1 RETURNING *`, [request.id]
      );
      return { user, request: updated };
    });
    if (result.error) {
      return res.status(result.status).json({ error: req.t(result.error), ...(result.request ? { request: publicRequest(result.request) } : {}) });
    }
    sendRegistrationApproved(result.user, verifyToken).catch(err =>
      console.error('Ошибка отправки письма об одобрении заявки:', err)
    );
    res.json(publicRequest(result.request));
  } catch (error) {
    console.error('Ошибка одобрения заявки:', error);
    res.status(500).json({ error: req.t('serverError') });
  }
});

router.post('/registration-requests/:token/reject', authLimiter, async (req, res) => {
  try {
    const request = await findRequest(req.params.token);
    if (!request) return res.status(404).json({ error: req.t('registrationRequestNotFound') });
    const { rows: [updated] } = await pool.query(
      `UPDATE registration_requests SET status = 'rejected', decided_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING *`, [request.id]
    );
    if (!updated) {
      return res.status(409).json({ error: req.t('registrationAlreadyDecided'), request: publicRequest(request) });
    }
    sendRegistrationRejected(updated).catch(err => console.error('Ошибка отправки письма об отказе:', err));
    res.json(publicRequest(updated));
  } catch (error) {
    console.error('Ошибка отклонения заявки:', error);
    res.status(500).json({ error: req.t('serverError') });
  }
});

// Подтверждение email
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { rows: tokens } = await pool.query(
      'SELECT * FROM email_verification_tokens WHERE token = $1 AND used = FALSE AND expires_at > NOW()',
      [token]
    );

    if (tokens.length === 0) {
      return res.status(400).json({ error: req.t('linkInvalid') });
    }

    const vToken = tokens[0];
    await withTransaction(async (client) => {
      await client.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [vToken.user_id]);
      await client.query('UPDATE email_verification_tokens SET used = TRUE WHERE id = $1', [vToken.id]);
    });

    // Сразу выдаём JWT чтобы пользователь попал в приложение
    const { rows: [user] } = await pool.query('SELECT * FROM users WHERE id = $1', [vToken.user_id]);
    const jwtToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({ message: req.t('emailVerified'), user: publicUser(user), token: jwtToken });
  } catch (error) {
    console.error('Ошибка верификации:', error);
    res.status(500).json({ error: req.t('verifyError') });
  }
});

// Повторная отправка письма верификации
router.post('/resend-verification', emailLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { rows: users } = await pool.query(
      'SELECT * FROM users WHERE LOWER(email) = $1 AND is_verified = FALSE', [email]
    );
    if (users.length === 0) {
      return res.json({ message: req.t('resendGeneric') });
    }
    const user = users[0];

    // Инвалидируем старые токены
    await pool.query(
      'UPDATE email_verification_tokens SET used = TRUE WHERE user_id = $1 AND used = FALSE', [user.id]
    );

    const verifyToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, verifyToken, expiresAt]
    );

    await sendEmailVerification({ ...user, language: req.lang }, verifyToken);
    res.json({ message: req.t('resendDone') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('emailSendError') });
  }
});

// Запрос сброса пароля
router.post('/forgot-password', emailLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { rows: users } = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [email]);
    if (users.length === 0) {
      return res.json({ message: req.t('forgotGeneric') });
    }
    const user = users[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await pool.query(
      'UPDATE password_reset_tokens SET used = TRUE WHERE user_id = $1 AND used = FALSE', [user.id]
    );
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt]
    );
    // Пользователь сейчас на странице сброса — пишем на языке этой страницы
    await sendPasswordReset({ ...user, language: req.lang }, token);
    res.json({ message: req.t('forgotGeneric') });
  } catch (error) {
    console.error('Ошибка сброса пароля:', error);
    res.status(500).json({ error: req.t('emailSendError') });
  }
});

// Установка нового пароля
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;

    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: req.t('passwordTooShort') });
    }

    const { rows: tokens } = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE token = $1 AND used = FALSE AND expires_at > NOW()',
      [token]
    );
    if (tokens.length === 0) {
      return res.status(400).json({ error: req.t('linkInvalid') });
    }

    const resetToken = tokens[0];
    const passwordHash = await bcrypt.hash(password, 10);
    await withTransaction(async (client) => {
      // Ссылка из письма подтверждает владение почтой — заодно считаем email подтверждённым
      await client.query(
        'UPDATE users SET password_hash = $1, is_verified = TRUE WHERE id = $2',
        [passwordHash, resetToken.user_id]
      );
      await client.query(
        'UPDATE password_reset_tokens SET used = TRUE WHERE user_id = $1 AND used = FALSE',
        [resetToken.user_id]
      );
      // Новый пароль отключает подключённые ИИ-клиенты (MCP): их refresh-токены больше не обновятся
      await client.query(
        'UPDATE mcp_oauth_refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
        [resetToken.user_id]
      );
      // И сохранённый для MCP пароль от почты: при следующем входе подключится заново
      await client.query('DELETE FROM mail_accounts WHERE user_id = $1', [resetToken.user_id]);
    });
    res.json({ message: req.t('passwordChanged') });
  } catch (error) {
    console.error('Ошибка установки пароля:', error);
    res.status(500).json({ error: req.t('passwordChangeError') });
  }
});

// Проверка токена сброса
router.get('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { rows: tokens } = await pool.query(
      'SELECT id FROM password_reset_tokens WHERE token = $1 AND used = FALSE AND expires_at > NOW()',
      [token]
    );
    if (tokens.length === 0) return res.status(400).json({ valid: false });
    res.json({ valid: true });
  } catch (error) {
    res.status(500).json({ error: req.t('tokenCheckError') });
  }
});

module.exports = router;
