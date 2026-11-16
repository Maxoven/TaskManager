// Работа с почтовым ящиком пользователя для MCP: IMAP (чтение, поиск, флаги, папки) и SMTP (отправка).
// На каждый вызов инструмента — своё короткое подключение: открыть, сделать, закрыть.
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const { simpleParser } = require('mailparser');
const { imapClient, markError } = require('./mailAccounts');
const { readBuffer } = require('./fileReader');

const MAX_LIST = 50;
const MAX_BODY_CHARS = 30000;

class MailError extends Error {}

const plural = (list) => (Array.isArray(list) ? list : [list]).filter(Boolean);

// Открыть ящик, выполнить fn(client) и закрыть. Неверный пароль — понятная ошибка и отметка в базе
async function withImap(account, fn) {
  const client = imapClient(account);
  client.on('error', () => {});
  try {
    await client.connect();
  } catch (error) {
    if (error.authenticationFailed) {
      await markError(account.userId, 'auth_failed').catch(() => {});
      throw new MailError('Почтовый сервер не принял пароль. Возможно, пароль от почты сменили — переподключите коннектор (войдите заново).');
    }
    throw new MailError(`Почтовый сервер недоступен: ${error.message}`);
  }
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

async function withFolder(client, folder, fn) {
  const lock = await client.getMailboxLock(folder).catch(() => {
    throw new MailError(`Папка «${folder}» не найдена. Список папок — mail_list_folders.`);
  });
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

async function specialFolder(client, use) {
  const folders = await client.list();
  const found = folders.find(f => f.specialUse === use);
  if (found) return found.path;
  const names = { '\\Sent': /^(sent|sent items|sent messages|отправленные)$/i, '\\Trash': /^(trash|deleted|deleted items|корзина|удалённые)$/i, '\\Drafts': /^(drafts|черновики)$/i };
  return folders.find(f => names[use]?.test(f.name))?.path || null;
}

const address = (a) => (a ? (a.name ? `${a.name} <${a.address}>` : a.address) : null);
const addresses = (list) => (list || []).map(address).filter(Boolean);

function hasAttachments(structure) {
  if (!structure) return false;
  if (structure.disposition === 'attachment') return true;
  return (structure.childNodes || []).some(hasAttachments);
}

function summary(msg, folder) {
  return {
    folder,
    uid: msg.uid,
    date: msg.envelope?.date || msg.internalDate,
    from: addresses(msg.envelope?.from).join(', '),
    to: addresses(msg.envelope?.to).join(', '),
    subject: msg.envelope?.subject || '',
    seen: msg.flags?.has('\\Seen') || false,
    flagged: msg.flags?.has('\\Flagged') || false,
    answered: msg.flags?.has('\\Answered') || false,
    has_attachments: hasAttachments(msg.bodyStructure),
    size: msg.size
  };
}

// ─── Папки ─────────────────────────────────────────────────────────────────
async function listFolders(account) {
  return withImap(account, async (client) => {
    const folders = await client.list({ statusQuery: { messages: true, unseen: true } });
    return folders
      .filter(f => !f.flags?.has('\\Noselect'))
      .map(f => ({ path: f.path, special_use: f.specialUse || null, messages: f.status?.messages ?? null, unseen: f.status?.unseen ?? null }));
  });
}

// ─── Поиск ─────────────────────────────────────────────────────────────────
function criteria(q) {
  const c = {};
  if (q.query) c.or = [{ subject: q.query }, { from: q.query }, { to: q.query }, { body: q.query }];
  if (q.from) c.from = q.from;
  if (q.to) c.to = q.to;
  if (q.subject) c.subject = q.subject;
  if (q.text) c.body = q.text;
  if (q.since) c.since = new Date(`${q.since}T00:00:00`);
  if (q.before) c.before = new Date(`${q.before}T00:00:00`);
  if (q.unseen === true) c.seen = false;
  if (q.unseen === false) c.seen = true;
  if (q.flagged !== undefined) c.flagged = q.flagged;
  return Object.keys(c).length ? c : { all: true };
}

async function search(account, q = {}) {
  const folder = q.folder || 'INBOX';
  const limit = Math.min(Math.max(Number(q.limit) || 20, 1), MAX_LIST);
  const offset = Math.max(Number(q.offset) || 0, 0);
  return withImap(account, (client) => withFolder(client, folder, async () => {
    const uids = (await client.search(criteria(q), { uid: true })) || [];
    uids.sort((a, b) => b - a); // новые сверху
    const page = uids.slice(offset, offset + limit);
    const messages = [];
    if (page.length) {
      for await (const msg of client.fetch(page, { uid: true, envelope: true, flags: true, bodyStructure: true, size: true, internalDate: true }, { uid: true })) {
        messages.push(summary(msg, folder));
      }
    }
    messages.sort((a, b) => b.uid - a.uid);
    return { folder, total: uids.length, offset, returned: messages.length, messages };
  }));
}

// ─── Чтение ────────────────────────────────────────────────────────────────
function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function fetchParsed(client, folder, uid) {
  const msg = await client.fetchOne(String(uid), { uid: true, source: true, flags: true }, { uid: true });
  if (!msg || !msg.source) throw new MailError(`Письмо uid ${uid} в папке «${folder}» не найдено.`);
  return { parsed: await simpleParser(msg.source), flags: msg.flags, source: msg.source };
}

function attachmentList(parsed) {
  return (parsed.attachments || [])
    .filter(a => a.contentDisposition !== 'inline' || a.filename)
    .map((a, index) => ({ index, filename: a.filename || `attachment-${index + 1}`, content_type: a.contentType, size: a.size }));
}

async function read(account, { folder = 'INBOX', uid, markSeen = false }) {
  return withImap(account, (client) => withFolder(client, folder, async () => {
    const { parsed, flags } = await fetchParsed(client, folder, uid);
    if (markSeen && !flags?.has('\\Seen')) await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    let body = parsed.text || htmlToText(parsed.html);
    const truncated = body.length > MAX_BODY_CHARS;
    if (truncated) body = body.slice(0, MAX_BODY_CHARS);
    return {
      folder,
      uid: Number(uid),
      message_id: parsed.messageId || null,
      date: parsed.date || null,
      from: parsed.from?.text || '',
      to: parsed.to?.text || '',
      cc: parsed.cc?.text || '',
      reply_to: parsed.replyTo?.text || '',
      subject: parsed.subject || '',
      seen: markSeen || flags?.has('\\Seen') || false,
      flagged: flags?.has('\\Flagged') || false,
      body,
      body_truncated: truncated || undefined,
      attachments: attachmentList(parsed)
    };
  }));
}

async function getAttachment(account, { folder = 'INBOX', uid, index }) {
  return withImap(account, (client) => withFolder(client, folder, async () => {
    const { parsed } = await fetchParsed(client, folder, uid);
    const list = (parsed.attachments || []).filter(a => a.contentDisposition !== 'inline' || a.filename);
    const att = list[index];
    if (!att) throw new MailError(`У письма нет вложения с номером ${index}. Номера — в mail_read.`);
    return { filename: att.filename || `attachment-${index + 1}`, contentType: att.contentType, content: att.content };
  }));
}

async function readAttachment(account, args) {
  const att = await getAttachment(account, args);
  return { filename: att.filename, content_type: att.contentType, ...(await readBuffer(att.content, att.filename, att.contentType)) };
}

// ─── Флаги, папки, корзина ─────────────────────────────────────────────────
async function updateFlags(account, { folder = 'INBOX', uids, seen, flagged }) {
  return withImap(account, (client) => withFolder(client, folder, async () => {
    const set = uids.join(',');
    if (seen === true) await client.messageFlagsAdd(set, ['\\Seen'], { uid: true });
    if (seen === false) await client.messageFlagsRemove(set, ['\\Seen'], { uid: true });
    if (flagged === true) await client.messageFlagsAdd(set, ['\\Flagged'], { uid: true });
    if (flagged === false) await client.messageFlagsRemove(set, ['\\Flagged'], { uid: true });
    return { folder, uids, updated: true };
  }));
}

async function move(account, { folder = 'INBOX', uids, to }) {
  return withImap(account, async (client) => {
    const exists = (await client.list()).some(f => f.path === to);
    if (!exists) throw new MailError(`Папка «${to}» не найдена. Список папок — mail_list_folders.`);
    return withFolder(client, folder, async () => {
      await client.messageMove(uids.join(','), to, { uid: true });
      return { from: folder, to, uids, moved: true };
    });
  });
}

// Удаление — только в корзину; навсегда не удаляем
async function trash(account, { folder = 'INBOX', uids }) {
  return withImap(account, async (client) => {
    const trashPath = await specialFolder(client, '\\Trash');
    if (!trashPath) throw new MailError('В ящике не найдена папка «Корзина».');
    if (trashPath === folder) throw new MailError('Письма уже в корзине. Окончательно удалять через этот коннектор нельзя.');
    return withFolder(client, folder, async () => {
      await client.messageMove(uids.join(','), trashPath, { uid: true });
      return { from: folder, to: trashPath, uids, moved_to_trash: true };
    });
  });
}

// ─── Отправка ──────────────────────────────────────────────────────────────
const reSubject = (prefix, subject) => (new RegExp(`^${prefix}:`, 'i').test(subject || '') ? subject : `${prefix}: ${subject || ''}`.trim());

function quote(parsed) {
  const original = parsed.text || htmlToText(parsed.html);
  const header = `${parsed.date ? new Date(parsed.date).toLocaleString('ru-RU') : ''}, ${parsed.from?.text || ''}:`;
  return `\n\n${header}\n${original.split('\n').map(l => `> ${l}`).join('\n')}`;
}

// Собирает письмо: новое, ответ (reply) или пересылка (forward) на письмо из ящика
async function compose(client, account, args, { requireRecipients = true } = {}) {
  const mail = {
    from: account.email,
    to: plural(args.to),
    cc: plural(args.cc),
    bcc: plural(args.bcc),
    subject: args.subject || '',
    text: args.text || '',
    attachments: (args.attachments || []).map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType }))
  };

  if (args.replyTo || args.forward) {
    const ref = args.replyTo || args.forward;
    const folder = ref.folder || 'INBOX';
    const { parsed } = await withFolder(client, folder, () => fetchParsed(client, folder, ref.uid));
    if (args.replyTo) {
      const sender = parsed.replyTo?.value?.length ? parsed.replyTo.value : parsed.from?.value || [];
      if (!mail.to.length) mail.to = sender.map(a => a.address);
      if (args.replyTo.all) {
        const me = account.email.toLowerCase();
        const others = [...(parsed.to?.value || []), ...(parsed.cc?.value || [])]
          .map(a => a.address).filter(a => a && a.toLowerCase() !== me && !mail.to.includes(a));
        mail.cc = [...new Set([...mail.cc, ...others])];
      }
      mail.subject = args.subject || reSubject('Re', parsed.subject);
      mail.inReplyTo = parsed.messageId;
      mail.references = [...plural(parsed.references), parsed.messageId].filter(Boolean);
      mail.text = `${args.text || ''}${quote(parsed)}`;
    } else {
      mail.subject = args.subject || reSubject('Fwd', parsed.subject);
      mail.text = `${args.text || ''}\n\n---------- Пересылаемое сообщение ----------\nОт: ${parsed.from?.text || ''}\nДата: ${parsed.date ? new Date(parsed.date).toLocaleString('ru-RU') : ''}\nТема: ${parsed.subject || ''}\nКому: ${parsed.to?.text || ''}\n\n${parsed.text || htmlToText(parsed.html)}`;
      mail.attachments.push(...(parsed.attachments || []).map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType })));
    }
    mail.original = { folder, uid: ref.uid };
  }

  if (requireRecipients && !mail.to.length && !mail.cc.length && !mail.bcc.length) throw new MailError('Не указан ни один получатель.');
  return mail;
}

async function buildRaw(mail) {
  const { original, ...message } = mail;
  return new MailComposer(message).compile().build();
}

async function appendTo(client, use, raw, flags) {
  const path = await specialFolder(client, use);
  if (path) await client.append(path, raw, flags);
  return path;
}

async function send(account, args) {
  return withImap(account, async (client) => {
    const mail = await compose(client, account, args);
    const transport = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: { user: account.email, pass: account.password },
      connectionTimeout: 15000
    });
    const raw = await buildRaw(mail);
    let info;
    try {
      info = await transport.sendMail({ envelope: { from: account.email, to: [...mail.to, ...mail.cc, ...mail.bcc] }, raw });
    } catch (error) {
      throw new MailError(`Сервер отправки не принял письмо: ${error.message}`);
    }
    // one.com не кладёт отправленное в «Отправленные» сам — делаем это, как почтовые программы
    const sentFolder = await appendTo(client, '\\Sent', raw, ['\\Seen']).catch(() => null);
    if (mail.original && args.replyTo) {
      await withFolder(client, mail.original.folder, () =>
        client.messageFlagsAdd(String(mail.original.uid), ['\\Answered'], { uid: true })).catch(() => {});
    }
    return {
      sent: true,
      message_id: info.messageId || null,
      to: mail.to, cc: mail.cc, bcc: mail.bcc,
      subject: mail.subject,
      attachments: mail.attachments.map(a => a.filename),
      saved_to: sentFolder
    };
  });
}

async function saveDraft(account, args) {
  return withImap(account, async (client) => {
    // У черновика может ещё не быть получателей
    const mail = await compose(client, account, args, { requireRecipients: false });
    const raw = await buildRaw(mail);
    const draftsFolder = await appendTo(client, '\\Drafts', raw, ['\\Draft', '\\Seen']);
    if (!draftsFolder) throw new MailError('В ящике не найдена папка «Черновики».');
    return { saved: true, folder: draftsFolder, subject: mail.subject, to: mail.to };
  });
}

module.exports = {
  MailError, listFolders, search, read, readAttachment, getAttachment, updateFlags, move, trash, send, saveDraft
};
