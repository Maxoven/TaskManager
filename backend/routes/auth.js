const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/database');
const { sendPasswordReset, sendEmailVerification } = require('../services/email');

const router = express.Router();

// Регистрация
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Минимум 8 символов
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Пароль должен содержать минимум 8 символов' });
    }

    const [existing] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Пользователь уже существует' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (email, password_hash, name, is_verified) VALUES (?, ?, ?, 0)',
      [email, passwordHash, name]
    );

    // Создаём токен верификации
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 часа
    await pool.query(
      'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [result.insertId, verifyToken, expiresAt]
    );

    // Отправляем письмо (не блокируем ответ если не дошло)
    sendEmailVerification(email, name, verifyToken).catch(err =>
      console.error('Ошибка отправки письма верификации:', err)
    );

    res.status(201).json({
      message: 'Регистрация прошла успешно! Проверьте email для подтверждения аккаунта.',
      needsVerification: true
    });
  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ error: 'Ошибка регистрации' });
  }
});

// Вход
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    const user = users[0];

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    // Проверяем верификацию
    if (!user.is_verified) {
      return res.status(403).json({
        error: 'Email не подтверждён. Проверьте почту и перейдите по ссылке из письма.',
        needsVerification: true
      });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ user: { id: user.id, email: user.email, name: user.name }, token });
  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

// Подтверждение email
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const [tokens] = await pool.query(
      'SELECT * FROM email_verification_tokens WHERE token = ? AND used = 0 AND expires_at > NOW()',
      [token]
    );

    if (tokens.length === 0) {
      return res.status(400).json({ error: 'Ссылка недействительна или истекла' });
    }

    const vToken = tokens[0];
    await pool.query('UPDATE users SET is_verified = 1 WHERE id = ?', [vToken.user_id]);
    await pool.query('UPDATE email_verification_tokens SET used = 1 WHERE id = ?', [vToken.id]);

    // Сразу выдаём JWT чтобы пользователь попал в приложение
    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [vToken.user_id]);
    const user = users[0];
    const jwtToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({ message: 'Email подтверждён!', user: { id: user.id, email: user.email, name: user.name }, token: jwtToken });
  } catch (error) {
    console.error('Ошибка верификации:', error);
    res.status(500).json({ error: 'Ошибка подтверждения email' });
  }
});

// Повторная отправка письма верификации
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    const [users] = await pool.query('SELECT * FROM users WHERE email = ? AND is_verified = 0', [email]);
    if (users.length === 0) {
      return res.json({ message: 'Если аккаунт существует и не подтверждён — письмо отправлено' });
    }
    const user = users[0];

    // Инвалидируем старые токены
    await pool.query('UPDATE email_verification_tokens SET used = 1 WHERE user_id = ? AND used = 0', [user.id]);

    const verifyToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, verifyToken, expiresAt]
    );

    await sendEmailVerification(user.email, user.name, verifyToken);
    res.json({ message: 'Письмо отправлено повторно' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка отправки письма' });
  }
});

// Запрос сброса пароля
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.json({ message: 'Если такой email зарегистрирован, мы отправили письмо' });
    }
    const user = users[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await pool.query('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0', [user.id]);
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, token, expiresAt]
    );
    await sendPasswordReset(user.email, user.name, token);
    res.json({ message: 'Если такой email зарегистрирован, мы отправили письмо' });
  } catch (error) {
    console.error('Ошибка сброса пароля:', error);
    res.status(500).json({ error: 'Ошибка отправки письма' });
  }
});

// Установка нового пароля
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Пароль должен содержать минимум 8 символов' });
    }

    const [tokens] = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > NOW()',
      [token]
    );
    if (tokens.length === 0) {
      return res.status(400).json({ error: 'Ссылка недействительна или истекла' });
    }

    const resetToken = tokens[0];
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, resetToken.user_id]);
    await pool.query('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [resetToken.id]);
    res.json({ message: 'Пароль успешно изменён' });
  } catch (error) {
    console.error('Ошибка установки пароля:', error);
    res.status(500).json({ error: 'Ошибка изменения пароля' });
  }
});

// Проверка токена сброса
router.get('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const [tokens] = await pool.query(
      'SELECT id FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > NOW()',
      [token]
    );
    if (tokens.length === 0) return res.status(400).json({ valid: false });
    res.json({ valid: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка проверки токена' });
  }
});

module.exports = router;
