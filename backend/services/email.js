const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'send.one.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: { rejectUnauthorized: false }
});

const FROM = `"Task Manager" <${process.env.SMTP_USER}>`;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// ─── Сброс пароля ───────────────────────────────────────────────────────────
async function sendPasswordReset(toEmail, userName, resetToken) {
  const link = `${FRONTEND_URL}/reset-password/${resetToken}`;
  await transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: 'Сброс пароля — Task Manager',
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:auto">
        <h2 style="color:#25b84c">Сброс пароля</h2>
        <p>Привет, ${userName}!</p>
        <p>Вы запросили сброс пароля. Нажмите кнопку ниже — ссылка действует <strong>1 час</strong>.</p>
        <a href="${link}" style="display:inline-block;padding:12px 24px;background:#25b84c;color:#fff;text-decoration:none;border-radius:6px;margin:16px 0">
          Сбросить пароль
        </a>
        <p style="color:#888;font-size:13px">Если вы не запрашивали сброс — просто проигнорируйте это письмо.</p>
      </div>
    `
  });
}

// ─── Уведомление о новой задаче ──────────────────────────────────────────────
async function sendTaskAssigned(toEmail, userName, taskTitle, projectName, taskId) {
  const link = `${FRONTEND_URL}/project/${taskId}`;
  await transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: `Новая задача: ${taskTitle} — Task Manager`,
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:auto">
        <h2 style="color:#25b84c">Вам назначена новая задача</h2>
        <p>Привет, ${userName}!</p>
        <p>В проекте <strong>${projectName}</strong> вам назначена задача:</p>
        <p style="font-size:18px;font-weight:bold;color:#333">${taskTitle}</p>
        <p style="color:#888;font-size:13px">Войдите в систему, чтобы посмотреть подробности.</p>
      </div>
    `
  });
}

// ─── Уведомление о скором дедлайне (за N дней) ───────────────────────────────
async function sendDeadlineWarning(toEmail, userName, taskTitle, projectName, deadlineDate, daysLeft) {
  await transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: `⏰ Дедлайн через ${daysLeft} дн.: ${taskTitle}`,
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:auto">
        <h2 style="color:#ff9800">Приближается дедлайн</h2>
        <p>Привет, ${userName}!</p>
        <p>По задаче <strong>${taskTitle}</strong> (проект: ${projectName}) дедлайн через <strong>${daysLeft} ${daysLeft === 1 ? 'день' : 'дней'}</strong>.</p>
        <p>Дата дедлайна: <strong>${new Date(deadlineDate).toLocaleDateString('ru-RU')}</strong></p>
      </div>
    `
  });
}

// ─── Запрос отчёта при наступлении дедлайна ──────────────────────────────────
async function sendReportRequest(toEmail, userName, taskTitle, projectName, reportToken) {
  const link = `${FRONTEND_URL}/report/${reportToken}`;
  await transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: `Отчёт по задаче: ${taskTitle}`,
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:auto">
        <h2 style="color:#25b84c">Дедлайн по задаче наступил</h2>
        <p>Привет, ${userName}!</p>
        <p>Наступил дедлайн по задаче <strong>${taskTitle}</strong> (проект: ${projectName}).</p>
        <p>Пожалуйста, отправьте отчёт о выполненной работе, нажав кнопку ниже:</p>
        <a href="${link}" style="display:inline-block;padding:12px 24px;background:#25b84c;color:#fff;text-decoration:none;border-radius:6px;margin:16px 0">
          Отправить отчёт
        </a>
        <p style="color:#888;font-size:13px">Ссылка действительна 48 часов. Если отчёт не будет получен в течение 24 часов — об этом будет уведомлён создатель задачи.</p>
      </div>
    `
  });
}

// ─── Уведомление создателю об отсутствии отчёта ──────────────────────────────
async function sendOverdueNotification(toEmail, creatorName, taskTitle, projectName, assigneeName) {
  await transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: `⚠️ Нет отчёта по задаче: ${taskTitle}`,
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:auto">
        <h2 style="color:#ef5350">Отчёт не получен</h2>
        <p>Привет, ${creatorName}!</p>
        <p>Прошло более 24 часов с момента дедлайна по задаче <strong>${taskTitle}</strong> (проект: ${projectName}).</p>
        <p>Исполнитель <strong>${assigneeName}</strong> ещё не прислал отчёт.</p>
      </div>
    `
  });
}


// ─── Верификация email ────────────────────────────────────────────────────────
async function sendEmailVerification(toEmail, userName, verifyToken) {
  const link = `${FRONTEND_URL}/verify-email/${verifyToken}`;
  await transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: 'Подтвердите email — Task Manager',
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:auto">
        <h2 style="color:#25b84c">Добро пожаловать, ${userName}!</h2>
        <p>Для завершения регистрации подтвердите ваш email:</p>
        <a href="${link}" style="display:inline-block;padding:12px 24px;background:#25b84c;color:#fff;text-decoration:none;border-radius:6px;margin:16px 0">
          Подтвердить email
        </a>
        <p style="color:#888;font-size:13px">Ссылка действует <strong>24 часа</strong>. Если вы не регистрировались — проигнорируйте это письмо.</p>
      </div>
    `
  });
}

module.exports = {
  sendPasswordReset,
  sendTaskAssigned,
  sendDeadlineWarning,
  sendReportRequest,
  sendOverdueNotification,
  sendEmailVerification
};
