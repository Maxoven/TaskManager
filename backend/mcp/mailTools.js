// Инструменты почты для MCP. Регистрируются только тем, у кого при входе подключилась почта
// (services/mailAccounts.js). Каждый вызов берёт пароль из базы, расшифровывает и ходит в ящик.
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const mailAccounts = require('../services/mailAccounts');
const mail = require('../services/mail');

const folder = z.string().min(1).max(255).optional().describe('Папка (path из mail_list_folders), по умолчанию INBOX');
const uid = z.number().int().positive().describe('UID письма в папке (из mail_search)');
const uids = z.array(z.number().int().positive()).min(1).max(100).describe('UID писем в папке');
const emails = z.union([z.string().min(3), z.array(z.string().min(3)).max(50)]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
const SEND = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

const CONFIRM_SEND = 'Письмо уходит сразу и отозвать его нельзя: перед вызовом покажите пользователю получателей, тему, текст и вложения и дождитесь явного подтверждения.';

const json = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data ?? { ok: true }, null, 2) }] });

// Файлы задач — через REST API сайта от имени пользователя, со всеми проверками доступа
const API = () => `http://127.0.0.1:${process.env.PORT || 3001}/api`;
const userToken = (auth) => jwt.sign({ userId: auth.extra.userId }, process.env.JWT_SECRET, { expiresIn: '2m' });

async function apiError(res) {
  const text = await res.text();
  try { return JSON.parse(text).error || `HTTP ${res.status}`; } catch { return `HTTP ${res.status}`; }
}

async function downloadTaskFile(auth, taskId, fileId) {
  const headers = { Authorization: `Bearer ${userToken(auth)}`, 'X-Lang': auth.extra.language || 'ru' };
  const list = await fetch(`${API()}/tasks/${taskId}/attachments`, { headers });
  if (!list.ok) throw new Error(`Файлы задачи ${taskId}: ${await apiError(list)}`);
  const meta = (await list.json()).find(f => f.id === fileId);
  if (!meta) throw new Error(`У задачи ${taskId} нет файла ${fileId}`);
  const res = await fetch(`${API()}/tasks/${taskId}/attachments/${fileId}/download`, { headers });
  if (!res.ok) throw new Error(`Файл ${fileId}: ${await apiError(res)}`);
  return { filename: meta.original_name, content: Buffer.from(await res.arrayBuffer()) };
}

async function uploadToTask(auth, taskId, filename, content, contentType) {
  const form = new FormData();
  form.append('file', new Blob([content], { type: contentType || 'application/octet-stream' }), filename);
  const res = await fetch(`${API()}/tasks/${taskId}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken(auth)}`, 'X-Lang': auth.extra.language || 'ru' },
    body: form
  });
  if (!res.ok) throw new Error(await apiError(res));
  return res.json();
}

const taskFilesSchema = z.array(z.object({
  taskId: z.number().int().positive(),
  fileId: z.number().int().positive().describe('id файла из list_task_attachments')
})).max(10).optional().describe('Приложить файлы из задач таскменеджера');

async function taskAttachments(auth, list) {
  const out = [];
  for (const f of list || []) out.push(await downloadTaskFile(auth, f.taskId, f.fileId));
  return out;
}

// [имя, описание, схема, аннотации, (args, account, auth) => результат MCP]
const TOOLS = [
  ['mail_status', 'Подключённый почтовый ящик: адрес и сервер. Почта подключается при входе в коннектор.', {}, READ,
    async (a, account) => json({ email: account.email, imap: account.imap.host, smtp: account.smtp.host, last_error: account.lastError })],

  ['mail_list_folders', 'Папки ящика: путь (path — его передавать в другие инструменты), назначение (\\Sent, \\Trash, \\Drafts, \\Junk), всего писем и непрочитанных.', {}, READ,
    async (a, account) => json(await mail.listFolders(account))],

  ['mail_search', 'Поиск писем в папке, новые сверху. Без условий — последние письма. Возвращает uid, дату, отправителя, тему, флаги и наличие вложений; текст письма — mail_read.', {
    folder,
    query: z.string().max(200).optional().describe('Слово или фраза: ищется в теме, отправителе, получателях и тексте'),
    from: z.string().max(200).optional(),
    to: z.string().max(200).optional(),
    subject: z.string().max(200).optional(),
    text: z.string().max(200).optional().describe('Только в тексте письма'),
    since: isoDate.optional().describe('С даты (YYYY-MM-DD)'),
    before: isoDate.optional().describe('До даты, не включая (YYYY-MM-DD)'),
    unseen: z.boolean().optional().describe('true — только непрочитанные, false — только прочитанные'),
    flagged: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional().describe('По умолчанию 20'),
    offset: z.number().int().min(0).optional()
  }, READ, async (a, account) => json(await mail.search(account, a))],

  ['mail_read', 'Прочитать письмо: заголовки, текст (HTML превращается в текст), список вложений с номерами. По умолчанию письмо не отмечается прочитанным.', {
    folder, uid, markSeen: z.boolean().optional().describe('Отметить прочитанным')
  }, READ, async (a, account) => json(await mail.read(account, a))],

  ['mail_read_attachment', 'Открыть вложение письма: текст .pdf, .docx, .xlsx, .txt, .csv, картинки .png/.jpg — как изображение, .zip — список файлов.', {
    folder, uid, index: z.number().int().min(0).describe('Номер вложения из mail_read')
  }, READ, async (a, account) => {
    const r = await mail.readAttachment(account, a);
    if (r.kind === 'image') {
      return { content: [{ type: 'text', text: `Вложение «${r.filename}»` }, { type: 'image', data: r.base64, mimeType: r.mime }] };
    }
    if (r.kind === 'text') return { content: [{ type: 'text', text: `Вложение «${r.filename}»${r.truncated ? ' (показано начало)' : ''}:\n\n${r.text}` }] };
    return { content: [{ type: 'text', text: `Вложение «${r.filename}» (${r.content_type}) прочитать не получилось: ${r.reason}` }] };
  }],

  ['mail_update_flags', 'Отметить письма прочитанными/непрочитанными или поставить/снять флажок.', {
    folder, uids, seen: z.boolean().optional(), flagged: z.boolean().optional()
  }, WRITE, async (a, account) => json(await mail.updateFlags(account, a))],

  ['mail_move', 'Переместить письма в другую папку.', {
    folder, uids, to: z.string().min(1).max(255).describe('Папка назначения (path из mail_list_folders)')
  }, WRITE, async (a, account) => json(await mail.move(account, a))],

  ['mail_delete', 'Удалить письма — переместить в «Корзину» (окончательно не удаляет). Перед вызовом подтвердите у пользователя, какие письма удалить.', {
    folder, uids
  }, DESTRUCTIVE, async (a, account) => json(await mail.trash(account, a))],

  ['mail_send', `Отправить новое письмо от имени пользователя. Копия сохраняется в «Отправленных». ${CONFIRM_SEND}`, {
    to: emails.describe('Получатель или список'),
    cc: emails.optional(), bcc: emails.optional(),
    subject: z.string().max(500),
    text: z.string().max(100000).describe('Текст письма'),
    taskFiles: taskFilesSchema
  }, SEND, async (a, account, auth) => json(await mail.send(account, { ...a, attachments: await taskAttachments(auth, a.taskFiles) }))],

  ['mail_reply', `Ответить на письмо (цитата исходного добавляется сама). replyAll — ответить всем. ${CONFIRM_SEND}`, {
    folder, uid,
    text: z.string().max(100000).describe('Текст ответа'),
    replyAll: z.boolean().optional(),
    cc: emails.optional(),
    taskFiles: taskFilesSchema
  }, SEND, async (a, account, auth) => json(await mail.send(account, {
    text: a.text, cc: a.cc,
    replyTo: { folder: a.folder || 'INBOX', uid: a.uid, all: !!a.replyAll },
    attachments: await taskAttachments(auth, a.taskFiles)
  }))],

  ['mail_forward', `Переслать письмо вместе с его вложениями. ${CONFIRM_SEND}`, {
    folder, uid, to: emails, cc: emails.optional(),
    text: z.string().max(100000).optional().describe('Комментарий перед пересылаемым письмом')
  }, SEND, async (a, account) => json(await mail.send(account, {
    to: a.to, cc: a.cc, text: a.text || '', forward: { folder: a.folder || 'INBOX', uid: a.uid }
  }))],

  ['mail_save_draft', 'Сохранить черновик в «Черновики», не отправляя. Подходит, когда пользователь хочет сам проверить и отправить письмо из своей почты.', {
    to: emails.optional(), cc: emails.optional(),
    subject: z.string().max(500).optional(),
    text: z.string().max(100000).optional(),
    replyToUid: z.number().int().positive().optional().describe('Черновик ответа на письмо с этим uid'),
    replyToFolder: z.string().max(255).optional(),
    taskFiles: taskFilesSchema
  }, WRITE, async (a, account, auth) => json(await mail.saveDraft(account, {
    to: a.to, cc: a.cc, subject: a.subject, text: a.text,
    replyTo: a.replyToUid ? { folder: a.replyToFolder || 'INBOX', uid: a.replyToUid } : undefined,
    attachments: await taskAttachments(auth, a.taskFiles)
  }))],

  ['mail_attachment_to_task', 'Сохранить вложение письма в файлы задачи таскменеджера (форматы и размер — как при обычной загрузке: до 10 МБ).', {
    folder, uid, index: z.number().int().min(0).describe('Номер вложения из mail_read'),
    taskId: z.number().int().positive()
  }, WRITE, async (a, account, auth) => {
    const att = await mail.getAttachment(account, a);
    return json({ task_id: a.taskId, ...(await uploadToTask(auth, a.taskId, att.filename, att.content, att.contentType)) });
  }]
];

function registerMailTools(server) {
  for (const [name, description, inputSchema, annotations, run] of TOOLS) {
    server.registerTool(name, { description, inputSchema, annotations }, async (args, extra) => {
      try {
        const account = await mailAccounts.getAccount(extra.authInfo.extra.userId);
        if (!account) {
          return { isError: true, content: [{ type: 'text', text: 'Почта не подключена. Она подключается при входе в коннектор: если пароль от корпоративной почты не такой, как от таскменеджера, его нужно ввести в поле «Пароль от корпоративной почты» на странице входа (отключите и подключите коннектор заново).' }] };
        }
        return await run(args || {}, account, extra.authInfo);
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${error.message}` }] };
      }
    });
  }
}

module.exports = { registerMailTools, TOOLS };
