const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const taskRoutes = require('./routes/tasks');
const teamRoutes = require('./routes/team');
const { startScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/team', teamRoutes);

// Публичные маршруты для отчётов (без авторизации — magic link)
app.get('/api/tasks/report-token/:token', async (req, res) => {
  // Уже обрабатывается в taskRoutes, но без authMiddleware
  res.status(404).json({ error: 'Not found' });
});

app.get('/api', (req, res) => {
  res.json({ message: 'Task Manager API работает!' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  // Запускаем планировщик email-уведомлений
  startScheduler();
});
