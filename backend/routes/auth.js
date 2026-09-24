const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { SUPPORTED } = require('../i18n/messages');
const { sendPasswordReset, sendEmailVerification } = require('../services/email');

const router = express.Router();

const publicUser = (user) => ({ id: user.id, email: user.email, name: user.name, language: user.language });

// Регистрация
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Минимум 8 символов
    if (!password || password.length < 8) {
      return res.status(400).json({ error: req.t('passwordTooShort') });
    }

    const { rows: existing } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ error: req.t('userExists') });
    }

    const passwordHash = await bcrypt.hash(password, 10);
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
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows: users } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (users.length === 0) {
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

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ user: publicUser(user), token });
  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ error: req.t('loginError') });
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
    await pool.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [vToken.user_id]);
    await pool.query('UPDATE email_verification_tokens SET used = TRUE WHERE id = $1', [vToken.id]);

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
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    const { rows: users } = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_verified = FALSE', [email]
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
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const { rows: users } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
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
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!password || password.length < 8) {
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
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, resetToken.user_id]);
    await pool.query('UPDATE password_reset_tokens SET used = TRUE WHERE id = $1', [resetToken.id]);
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
