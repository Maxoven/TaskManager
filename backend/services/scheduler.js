const cron = require('node-cron');
const crypto = require('crypto');
const pool = require('../config/database');
const {
  sendDeadlineWarning,
  sendReportRequest,
  sendOverdueNotification
} = require('./email');

// Запускается каждый день в 09:00
function startScheduler() {
  // ─── Уведомление о приближающихся дедлайнах (за 1 и 3 дня) ───────────────
  cron.schedule('0 9 * * *', async () => {
    console.log('[Scheduler] Проверка приближающихся дедлайнов...');
    try {
      const [tasks] = await pool.query(`
        SELECT t.id, t.title, t.end_date, t.project_id,
               p.name as project_name,
               u.id as user_id, u.name as user_name, u.email as user_email
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        JOIN task_assignees ta ON t.id = ta.task_id
        JOIN users u ON ta.user_id = u.id
        WHERE t.end_date IN (
          DATE_ADD(CURDATE(), INTERVAL 1 DAY),
          DATE_ADD(CURDATE(), INTERVAL 3 DAY)
        )
      `);

      for (const task of tasks) {
        const daysLeft = Math.round(
          (new Date(task.end_date) - new Date()) / (1000 * 60 * 60 * 24)
        );
        try {
          await sendDeadlineWarning(
            task.user_email,
            task.user_name,
            task.title,
            task.project_name,
            task.end_date,
            daysLeft < 1 ? 1 : daysLeft
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
      const [tasks] = await pool.query(`
        SELECT t.id, t.title, t.end_date, t.project_id,
               p.name as project_name,
               u.id as user_id, u.name as user_name, u.email as user_email
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        JOIN task_assignees ta ON t.id = ta.task_id
        JOIN users u ON ta.user_id = u.id
        LEFT JOIN task_reports tr ON (tr.task_id = t.id AND tr.user_id = u.id)
        LEFT JOIN report_tokens rt ON (rt.task_id = t.id AND rt.user_id = u.id)
        WHERE t.end_date <= CURDATE()
          AND t.end_date >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
          AND tr.id IS NULL
          AND rt.id IS NULL
      `);

      for (const task of tasks) {
        try {
          const token = crypto.randomBytes(32).toString('hex');
          const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h

          await pool.query(
            `INSERT INTO report_tokens (task_id, user_id, token, expires_at)
             VALUES (?, ?, ?, ?)`,
            [task.id, task.user_id, token, expiresAt]
          );

          await sendReportRequest(
            task.user_email,
            task.user_name,
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
      const [tokens] = await pool.query(`
        SELECT rt.id, rt.task_id, rt.user_id,
               t.title as task_title, t.project_id,
               p.name as project_name,
               p.owner_id,
               assignee.name as assignee_name,
               owner.name as owner_name, owner.email as owner_email
        FROM report_tokens rt
        JOIN tasks t ON rt.task_id = t.id
        JOIN projects p ON t.project_id = p.id
        JOIN users assignee ON rt.user_id = assignee.id
        JOIN users owner ON p.owner_id = owner.id
        LEFT JOIN task_reports tr ON (tr.task_id = rt.task_id AND tr.user_id = rt.user_id)
        WHERE rt.deadline_notified_at <= DATE_SUB(NOW(), INTERVAL 24 HOUR)
          AND rt.overdue_notified = 0
          AND tr.id IS NULL
      `);

      for (const row of tokens) {
        try {
          await sendOverdueNotification(
            row.owner_email,
            row.owner_name,
            row.task_title,
            row.project_name,
            row.assignee_name
          );
          await pool.query(
            'UPDATE report_tokens SET overdue_notified = 1 WHERE id = ?',
            [row.id]
          );
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
