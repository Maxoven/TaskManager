const cron = require('node-cron');
const crypto = require('crypto');
const pool = require('../config/database');
const {
  sendDeadlineWarning,
  sendReportRequest,
  sendOverdueNotification
} = require('./email');

// Задача не в последней колонке проекта (т.е. ещё не выполнена)
const TASK_NOT_DONE_SQL = `
  NOT EXISTS (
    SELECT 1 FROM statuses s
    WHERE s.id = t.status_id
      AND s.position = (SELECT MAX(s2.position) FROM statuses s2 WHERE s2.project_id = t.project_id)
  )
`;

function startScheduler() {
  // ─── Уведомление о приближающихся дедлайнах (за 1 и 3 дня) ───────────────
  cron.schedule('0 9 * * *', async () => {
    console.log('[Scheduler] Проверка приближающихся дедлайнов...');
    try {
      const { rows: tasks } = await pool.query(`
        SELECT t.id, t.title, t.end_date, t.project_id,
               (t.end_date - CURRENT_DATE) AS days_left,
               p.name AS project_name,
               u.id AS user_id, u.name AS user_name, u.email AS user_email, u.language AS user_language
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        JOIN task_assignees ta ON t.id = ta.task_id
        JOIN users u ON ta.user_id = u.id
        WHERE t.end_date IN (CURRENT_DATE + 1, CURRENT_DATE + 3)
          AND ${TASK_NOT_DONE_SQL}
      `);

      for (const task of tasks) {
        try {
          await sendDeadlineWarning(
            { email: task.user_email, name: task.user_name, language: task.user_language },
            task.title,
            task.project_name,
            task.end_date,
            task.days_left
          );
          console.log(`[Scheduler] Напоминание отправлено: ${task.user_email} / ${task.title}`);
        } catch (e) {
          console.error('[Scheduler] Ошибка отправки напоминания:', e.message);
        }
      }
    } catch (e) {
      console.error('[Scheduler] Ошибка проверки дедлайнов:', e.message);
    }
  });

  // ─── Запрос отчёта при наступлении дедлайна ──────────────────────────────
  cron.schedule('0 10 * * *', async () => {
    console.log('[Scheduler] Запрос отчётов по просроченным задачам...');
    try {
      // Задачи, дедлайн которых сегодня или вчера, у которых ещё нет токена
      const { rows: tasks } = await pool.query(`
        SELECT t.id, t.title, t.end_date, t.project_id,
               p.name AS project_name,
               u.id AS user_id, u.name AS user_name, u.email AS user_email, u.language AS user_language
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        JOIN task_assignees ta ON t.id = ta.task_id
        JOIN users u ON ta.user_id = u.id
        LEFT JOIN task_reports tr ON (tr.task_id = t.id AND tr.user_id = u.id)
        LEFT JOIN report_tokens rt ON (rt.task_id = t.id AND rt.user_id = u.id)
        WHERE t.end_date <= CURRENT_DATE
          AND t.end_date >= CURRENT_DATE - 1
          AND tr.id IS NULL
          AND rt.id IS NULL
      `);

      for (const task of tasks) {
        try {
          const token = crypto.randomBytes(32).toString('hex');
          const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h

          await pool.query(
            `INSERT INTO report_tokens (task_id, user_id, token, expires_at, deadline_notified_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [task.id, task.user_id, token, expiresAt]
          );

          await sendReportRequest(
            { email: task.user_email, name: task.user_name, language: task.user_language },
            task.title,
            task.project_name,
            token
          );
          console.log(`[Scheduler] Запрос отчёта отправлен: ${task.user_email} / ${task.title}`);
        } catch (e) {
          console.error('[Scheduler] Ошибка отправки запроса отчёта:', e.message);
        }
      }
    } catch (e) {
      console.error('[Scheduler] Ошибка проверки просроченных задач:', e.message);
    }
  });

  // ─── Уведомление создателю, если отчёт не пришёл за 24ч ─────────────────
  cron.schedule('0 11 * * *', async () => {
    console.log('[Scheduler] Проверка отсутствующих отчётов (24ч)...');
    try {
      const { rows: tokens } = await pool.query(`
        SELECT rt.id, rt.task_id, rt.user_id,
               t.title AS task_title, t.project_id,
               p.name AS project_name,
               p.owner_id,
               assignee.name AS assignee_name,
               owner.name AS owner_name, owner.email AS owner_email, owner.language AS owner_language
        FROM report_tokens rt
        JOIN tasks t ON rt.task_id = t.id
        JOIN projects p ON t.project_id = p.id
        JOIN users assignee ON rt.user_id = assignee.id
        JOIN users owner ON p.owner_id = owner.id
        LEFT JOIN task_reports tr ON (tr.task_id = rt.task_id AND tr.user_id = rt.user_id)
        WHERE rt.deadline_notified_at <= NOW() - INTERVAL '24 hours'
          AND rt.overdue_notified = FALSE
          AND tr.id IS NULL
      `);

      for (const row of tokens) {
        try {
          await sendOverdueNotification(
            { email: row.owner_email, name: row.owner_name, language: row.owner_language },
            row.task_title,
            row.project_name,
            row.assignee_name
          );
          await pool.query('UPDATE report_tokens SET overdue_notified = TRUE WHERE id = $1', [row.id]);
          console.log(`[Scheduler] Уведомление создателю: ${row.owner_email} / ${row.task_title}`);
        } catch (e) {
          console.error('[Scheduler] Ошибка уведомления создателя:', e.message);
        }
      }
    } catch (e) {
      console.error('[Scheduler] Ошибка проверки отсутствующих отчётов:', e.message);
    }
  });

  console.log('✅ Планировщик запущен');
}

module.exports = { startScheduler };
