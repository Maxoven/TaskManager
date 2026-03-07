const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/database');
const { sendPasswordReset } = require('../services/email');

const router = express.Router();

// Регистрация
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const [existing] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Пользователь уже существует' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
      [email, passwordHash, name]
    );
    const user = { id: result.insertId, email, name };
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ user, token });
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
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ user: { id: user.id, email: user.email, name: user.name }, token });
  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

// Запрос сброса пароля
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);

    // Всегда возвращаем 200 (не раскрываем существование email)
    if (users.length === 0) {
      return res.json({ message: 'Если такой email зарегистрирован, мы отправили письмо' });
    }

    const user = users[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 час

    // Инвалидируем старые токены
    await pool.query(
      'UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0',
      [user.id]
    );

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

    const [tokens] = await pool.query(
      `SELECT * FROM password_reset_tokens
       WHERE token = ? AND used = 0 AND expires_at > NOW()`,
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

// Проверка токена сброса (для фронтенда)
router.get('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const [tokens] = await pool.query(
      'SELECT id FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > NOW()',
      [token]
    );
    if (tokens.length === 0) {
      return res.status(400).json({ valid: false });
    }
    res.json({ valid: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка проверки токена' });
  }
});

module.exports = router;
