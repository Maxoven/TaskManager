const express = require('express');
const pool = require('../config/database');

// Публичные маршруты отчётов: доступ по токену из письма (magic link), без авторизации.
// Смонтированы в server.js на /api/tasks/report-token
const router = express.Router();

// Получить данные для страницы отправки отчёта
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { rows: tokens } = await pool.query(`
      SELECT rt.task_id, rt.user_id, t.title AS task_title, p.name AS project_name,
             u.name AS user_name,
             EXISTS (
               SELECT 1 FROM task_reports tr WHERE tr.task_id = rt.task_id AND tr.user_id = rt.user_id
             ) AS already_submitted
      FROM report_tokens rt
      JOIN tasks t ON rt.task_id = t.id
      JOIN projects p ON t.project_id = p.id
      JOIN users u ON rt.user_id = u.id
      WHERE rt.token = $1 AND rt.expires_at > NOW()
    `, [token]);

    if (tokens.length === 0) {
      return res.status(404).json({ error: req.t('linkInvalid') });
    }

    const info = tokens[0];
    res.json({
      taskId: info.task_id,
      taskTitle: info.task_title,
      projectName: info.project_name,
      userName: info.user_name,
      alreadySubmitted: info.already_submitted
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('genericError') });
  }
});

// Отправить отчёт по токену
router.post('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { reportText } = req.body;

    if (!reportText || reportText.trim().length === 0) {
      return res.status(400).json({ error: req.t('reportEmpty') });
    }

    const { rows: tokens } = await pool.query(
      'SELECT task_id, user_id FROM report_tokens WHERE token = $1 AND expires_at > NOW()', [token]
    );
    if (tokens.length === 0) {
      return res.status(404).json({ error: req.t('linkInvalid') });
    }

    const rt = tokens[0];
    const { rowCount } = await pool.query(
      `INSERT INTO task_reports (task_id, user_id, report_text) VALUES ($1, $2, $3)
       ON CONFLICT (task_id, user_id) DO NOTHING`,
      [rt.task_id, rt.user_id, reportText.trim()]
    );
    if (rowCount === 0) {
      return res.status(400).json({ error: req.t('reportAlreadySent') });
    }

    res.json({ message: req.t('reportSent') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('reportSendError') });
  }
});

module.exports = router;
