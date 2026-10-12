const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const authMiddleware = require('../middleware/auth');

// Фото профиля. Браузер заранее обрезает картинку до квадрата 256×256 (см. AccountMenu),
// сервер проверяет формат по сигнатуре файла и хранит его под случайным именем.
// Раздаём без авторизации (<img> не шлёт токен): имя из 32 случайных hex-символов не угадать.
const AVATARS_DIR = process.env.AVATARS_DIR || path.join(__dirname, '../storage/avatars');
const MAX_SIZE = 2 * 1024 * 1024;
const FILE_RE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// Формат по первым байтам: MIME и расширение присылает клиент — им не доверяем
function detectImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function removeFile(filename) {
  if (!filename || !FILE_RE.test(filename)) return;
  fs.unlink(path.join(AVATARS_DIR, filename), (err) => {
    if (err && err.code !== 'ENOENT') console.error('Не удалось удалить фото профиля:', err.message);
  });
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SIZE, files: 1 } });

// /api/auth/avatar — загрузить или удалить своё фото
const own = express.Router();
own.use(authMiddleware);

own.post('/', upload.single('avatar'), async (req, res) => {
  try {
    const ext = req.file && detectImage(req.file.buffer);
    if (!ext) return res.status(400).json({ error: req.t('avatarInvalid') });
    const filename = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    await fs.promises.mkdir(AVATARS_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(AVATARS_DIR, filename), req.file.buffer);
    const { rows: [old] } = await pool.query('SELECT avatar FROM users WHERE id = $1', [req.userId]);
    await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [filename, req.userId]);
    removeFile(old?.avatar);
    res.json({ avatar: filename });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('avatarSaveError') });
  }
});

own.delete('/', async (req, res) => {
  try {
    const { rows: [old] } = await pool.query('SELECT avatar FROM users WHERE id = $1', [req.userId]);
    await pool.query('UPDATE users SET avatar = NULL WHERE id = $1', [req.userId]);
    removeFile(old?.avatar);
    res.json({ avatar: null });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('avatarSaveError') });
  }
});

// /api/avatars/:file — отдать фото
const files = express.Router();
files.get('/:file', (req, res) => {
  const { file } = req.params;
  if (!FILE_RE.test(file)) return res.status(404).json({ error: req.t('notFound') });
  res.set({
    'Content-Type': TYPES[file.split('.').pop()],
    // Новое фото — новое имя файла, поэтому старое можно кэшировать навсегда
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff'
  });
  res.sendFile(path.join(AVATARS_DIR, file), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: req.t('notFound') });
  });
});

module.exports = { own, files };
