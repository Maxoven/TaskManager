const nodemailer = require('nodemailer');
const { normalizeLang } = require('../i18n/messages');

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

// Все функции принимают получателя вида { email, name, language }.
// Письмо уходит на языке получателя (users.language), а не отправителя.

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout({ color = '#25b84c', title, paragraphs, button, note }) {
  return `
    <div style="font-family:sans-serif;max-width:500px;margin:auto">
      <h2 style="color:${color}">${title}</h2>
      ${paragraphs.map(p => `<p>${p}</p>`).join('\n      ')}
      ${button ? `<a href="${button.href}" style="display:inline-block;padding:12px 24px;background:${color};color:#fff;text-decoration:none;border-radius:6px;margin:16px 0">${button.label}</a>` : ''}
      ${note ? `<p style="color:#888;font-size:13px">${note}</p>` : ''}
    </div>
  `;
}

async function send(to, subject, html) {
  await transporter.sendMail({ from: FROM, to: to.email, subject, html });
}

// 'YYYY-MM-DD' → '19.03.2026' / 'Mar 19, 2026' без сдвига часового пояса
function formatDate(date, lang) {
  const iso = typeof date === 'string' ? date.slice(0, 10) : new Date(date).toISOString().slice(0, 10);
  const [y, m, d] = iso.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  return lang === 'en'
    ? utc.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
    : utc.toLocaleDateString('ru-RU', { timeZone: 'UTC' });
}

function pluralDaysRu(n) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
}

// ─── Сброс пароля ───────────────────────────────────────────────────────────
async function sendPasswordReset(to, resetToken) {
  const lang = normalizeLang(to.language);
  const name = escapeHtml(to.name);
  const href = `${FRONTEND_URL}/reset-password/${resetToken}`;
  const tpl = lang === 'en'
    ? {
        subject: 'Password reset — Task Manager',
        title: 'Password reset',
        paragraphs: [`Hi, ${name}!`, 'You requested a password reset. Click the button below — the link is valid for <strong>1 hour</strong>.'],
        button: { href, label: 'Reset password' },
        note: "If you didn't request a reset, just ignore this email."
      }
    : {
        subject: 'Сброс пароля — Task Manager',
        title: 'Сброс пароля',
        paragraphs: [`Привет, ${name}!`, 'Вы запросили сброс пароля. Нажмите кнопку ниже — ссылка действует <strong>1 час</strong>.'],
        button: { href, label: 'Сбросить пароль' },
        note: 'Если вы не запрашивали сброс — просто проигнорируйте это письмо.'
      };
  await send(to, tpl.subject, layout(tpl));
}

// ─── Уведомление о новой задаче ──────────────────────────────────────────────
async function sendTaskAssigned(to, taskTitle, projectName, projectId) {
  const lang = normalizeLang(to.language);
  const name = escapeHtml(to.name);
  const task = escapeHtml(taskTitle);
  const project = escapeHtml(projectName);
  const href = `${FRONTEND_URL}/project/${projectId}`;
  const taskLine = `<span style="font-size:18px;font-weight:bold;color:#333">${task}</span>`;
  const tpl = lang === 'en'
    ? {
        subject: `New task: ${taskTitle} — Task Manager`,
        title: 'You have been assigned a new task',
        paragraphs: [`Hi, ${name}!`, `You have been assigned a task in project <strong>${project}</strong>:`, taskLine],
        button: { href, label: 'Open project' },
        note: 'Sign in to see the details.'
      }
    : {
        subject: `Новая задача: ${taskTitle} — Task Manager`,
        title: 'Вам назначена новая задача',
        paragraphs: [`Привет, ${name}!`, `В проекте <strong>${project}</strong> вам назначена задача:`, taskLine],
        button: { href, label: 'Открыть проект' },
        note: 'Войдите в систему, чтобы посмотреть подробности.'
      };
  await send(to, tpl.subject, layout(tpl));
}

// ─── Уведомление о скором дедлайне (за N дней) ───────────────────────────────
async function sendDeadlineWarning(to, taskTitle, projectName, deadlineDate, daysLeft) {
  const lang = normalizeLang(to.language);
  const name = escapeHtml(to.name);
  const task = escapeHtml(taskTitle);
  const project = escapeHtml(projectName);
  const date = formatDate(deadlineDate, lang);
  const tpl = lang === 'en'
    ? {
        subject: `⏰ Deadline in ${daysLeft} day${daysLeft === 1 ? '' : 's'}: ${taskTitle}`,
        title: 'Deadline is approaching',
        color: '#ff9800',
        paragraphs: [
          `Hi, ${name}!`,
          `The task <strong>${task}</strong> (project: ${project}) is due in <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>.`,
          `Deadline: <strong>${date}</strong>`
        ]
      }
    : {
        subject: `⏰ Дедлайн через ${daysLeft} ${pluralDaysRu(daysLeft)}: ${taskTitle}`,
        title: 'Приближается дедлайн',
        color: '#ff9800',
        paragraphs: [
          `Привет, ${name}!`,
          `По задаче <strong>${task}</strong> (проект: ${project}) дедлайн через <strong>${daysLeft} ${pluralDaysRu(daysLeft)}</strong>.`,
          `Дата дедлайна: <strong>${date}</strong>`
        ]
      };
  await send(to, tpl.subject, layout(tpl));
}

// ─── Запрос отчёта при наступлении дедлайна ──────────────────────────────────
async function sendReportRequest(to, taskTitle, projectName, reportToken) {
  const lang = normalizeLang(to.language);
  const name = escapeHtml(to.name);
  const task = escapeHtml(taskTitle);
  const project = escapeHtml(projectName);
  const href = `${FRONTEND_URL}/report/${reportToken}?lang=${lang}`;
  const tpl = lang === 'en'
    ? {
        subject: `Task report: ${taskTitle}`,
        title: 'Task deadline has arrived',
        paragraphs: [
          `Hi, ${name}!`,
          `The deadline for task <strong>${task}</strong> (project: ${project}) has arrived.`,
          'Please submit a report on the work done by clicking the button below:'
        ],
        button: { href, label: 'Submit report' },
        note: 'The link is valid for 48 hours. If no report is received within 24 hours, the project owner will be notified.'
      }
    : {
        subject: `Отчёт по задаче: ${taskTitle}`,
        title: 'Дедлайн по задаче наступил',
        paragraphs: [
          `Привет, ${name}!`,
          `Наступил дедлайн по задаче <strong>${task}</strong> (проект: ${project}).`,
          'Пожалуйста, отправьте отчёт о выполненной работе, нажав кнопку ниже:'
        ],
        button: { href, label: 'Отправить отчёт' },
        note: 'Ссылка действительна 48 часов. Если отчёт не будет получен в течение 24 часов — об этом будет уведомлён создатель задачи.'
      };
  await send(to, tpl.subject, layout(tpl));
}

// ─── Уведомление создателю об отсутствии отчёта ──────────────────────────────
async function sendOverdueNotification(to, taskTitle, projectName, assigneeName) {
  const lang = normalizeLang(to.language);
  const name = escapeHtml(to.name);
  const task = escapeHtml(taskTitle);
  const project = escapeHtml(projectName);
  const assignee = escapeHtml(assigneeName);
  const tpl = lang === 'en'
    ? {
        subject: `⚠️ No report for task: ${taskTitle}`,
        title: 'Report not received',
        color: '#ef5350',
        paragraphs: [
          `Hi, ${name}!`,
          `More than 24 hours have passed since the deadline for task <strong>${task}</strong> (project: ${project}).`,
          `Assignee <strong>${assignee}</strong> has not submitted a report yet.`
        ]
      }
    : {
        subject: `⚠️ Нет отчёта по задаче: ${taskTitle}`,
        title: 'Отчёт не получен',
        color: '#ef5350',
        paragraphs: [
          `Привет, ${name}!`,
          `Прошло более 24 часов с момента дедлайна по задаче <strong>${task}</strong> (проект: ${project}).`,
          `Исполнитель <strong>${assignee}</strong> ещё не прислал отчёт.`
        ]
      };
  await send(to, tpl.subject, layout(tpl));
}

// ─── Верификация email ────────────────────────────────────────────────────────
async function sendEmailVerification(to, verifyToken) {
  const lang = normalizeLang(to.language);
  const name = escapeHtml(to.name);
  const href = `${FRONTEND_URL}/verify-email/${verifyToken}`;
  const tpl = lang === 'en'
    ? {
        subject: 'Confirm your email — Task Manager',
        title: `Welcome, ${name}!`,
        paragraphs: ['To complete registration, please confirm your email:'],
        button: { href, label: 'Confirm email' },
        note: "The link is valid for <strong>24 hours</strong>. If you didn't sign up, just ignore this email."
      }
    : {
        subject: 'Подтвердите email — Task Manager',
        title: `Добро пожаловать, ${name}!`,
        paragraphs: ['Для завершения регистрации подтвердите ваш email:'],
        button: { href, label: 'Подтвердить email' },
        note: 'Ссылка действует <strong>24 часа</strong>. Если вы не регистрировались — проигнорируйте это письмо.'
      };
  await send(to, tpl.subject, layout(tpl));
}

// ─── Приглашение в проект ─────────────────────────────────────────────────────
async function sendProjectInvitation(to, inviterName, projectName) {
  const lang = normalizeLang(to.language);
  const name = escapeHtml(to.name);
  const inviter = escapeHtml(inviterName);
  const project = escapeHtml(projectName);
  const href = `${FRONTEND_URL}/`;
  const tpl = lang === 'en'
    ? {
        subject: `${inviterName} invites you to project "${projectName}"`,
        title: 'Project invitation',
        paragraphs: [
          `Hi, ${name}!`,
          `<strong>${inviter}</strong> invites you to project <strong>"${project}"</strong>.`,
          'Sign in to Task Manager to accept or decline the invitation:'
        ],
        button: { href, label: 'Open Task Manager' },
        note: "If you weren't expecting this invitation, just ignore this email."
      }
    : {
        subject: `${inviterName} приглашает вас в проект «${projectName}»`,
        title: 'Приглашение в проект',
        paragraphs: [
          `Привет, ${name}!`,
          `<strong>${inviter}</strong> приглашает вас в проект <strong>«${project}»</strong>.`,
          'Войдите в Task Manager, чтобы принять или отклонить приглашение:'
        ],
        button: { href, label: 'Открыть Task Manager' },
        note: 'Если вы не ожидали этого приглашения — просто проигнорируйте письмо.'
      };
  await send(to, tpl.subject, layout(tpl));
}

// ─── Приглашение в команду ────────────────────────────────────────────────────
async function sendTeamInvitation(to, inviterName) {
  const lang = normalizeLang(to.language);
  const name = escapeHtml(to.name);
  const inviter = escapeHtml(inviterName);
  const href = `${FRONTEND_URL}/`;
  const tpl = lang === 'en'
    ? {
        subject: `${inviterName} invites you to their team`,
        title: 'Team invitation',
        color: '#7b1fa2',
        paragraphs: [
          `Hi, ${name}!`,
          `<strong>${inviter}</strong> invites you to their team.`,
          `Once you accept, you will automatically get access to all of ${inviter}'s projects.`
        ],
        button: { href, label: 'Accept invitation' },
        note: "If you weren't expecting this invitation, just ignore this email."
      }
    : {
        subject: `${inviterName} приглашает вас в свою команду`,
        title: 'Приглашение в команду',
        color: '#7b1fa2',
        paragraphs: [
          `Привет, ${name}!`,
          `<strong>${inviter}</strong> приглашает вас в свою команду.`,
          `После принятия вы автоматически получите доступ ко всем проектам ${inviter}.`
        ],
        button: { href, label: 'Принять приглашение' },
        note: 'Если вы не ожидали этого приглашения — просто проигнорируйте письмо.'
      };
  await send(to, tpl.subject, layout(tpl));
}

module.exports = {
  sendPasswordReset,
  sendTaskAssigned,
  sendDeadlineWarning,
  sendReportRequest,
  sendOverdueNotification,
  sendEmailVerification,
  sendProjectInvitation,
  sendTeamInvitation
};
