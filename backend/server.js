const express = require('express');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();

const langMiddleware = require('./middleware/lang');
const { translate } = require('./i18n/messages');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const taskRoutes = require('./routes/tasks');
const reportRoutes = require('./routes/reports');
const teamRoutes = require('./routes/team');
const assistantRoutes = require('./routes/assistant');
const { startScheduler } = require('./services/scheduler');

// Без секрета jwt.sign/verify падают на каждом запросе — лучше не стартовать вовсе
if (!process.env.JWT_SECRET) {
  console.error('❌ Не задан JWT_SECRET (см. .env.example)');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// За nginx: настоящий IP клиента берём из X-Forwarded-For (нужен для лимита запросов)
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');

app.use(cors());
app.use(express.json());
app.use(langMiddleware);

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
// Публичные маршруты отчётов (magic link из письма, без авторизации) — до taskRoutes
app.use('/api/tasks/report-token', reportRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/assistant', assistantRoutes);

app.get('/api', (req, res) => {
  res.json({ message: req.t('apiRunning') });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: req.t('notFound') });
});

app.use((err, req, res, next) => {
  if (!req.t) req.t = (key) => translate('ru', key); // ошибка возникла до langMiddleware
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: req.t('invalidJson') });
  }
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: req.t('fileTooLarge') });
  }
  if (err.code === 'UNSUPPORTED_FILE') {
    return res.status(400).json({ error: req.t('fileUnsupported') });
  }
  console.error(err.stack);
  res.status(500).json({ error: req.t('serverError') });
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  // Запускаем планировщик email-уведомлений
  startScheduler();
});
