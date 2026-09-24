const express = require('express');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();

const langMiddleware = require('./middleware/lang');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const taskRoutes = require('./routes/tasks');
const reportRoutes = require('./routes/reports');
const teamRoutes = require('./routes/team');
const { startScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(langMiddleware);

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
// Публичные маршруты отчётов (magic link из письма, без авторизации) — до taskRoutes
app.use('/api/tasks/report-token', reportRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/team', teamRoutes);

app.get('/api', (req, res) => {
  res.json({ message: req.t('apiRunning') });
});

app.use((err, req, res, next) => {
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
