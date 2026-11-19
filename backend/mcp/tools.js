// Инструменты MCP-сервера. Каждый вызывает тот же REST API, что и сайт, от имени вошедшего
// пользователя — поэтому все проверки прав (services/access.js) и валидация работают как обычно:
// ИИ может ровно то же, что этот человек в интерфейсе, не больше.
const jwt = require('jsonwebtoken');
const { z } = require('zod');

const id = (what) => z.number().int().positive().describe(`ID ${what}`);
const date = (what) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(`${what}, формат YYYY-MM-DD`);
const ids = (what) => z.array(z.number().int().positive()).describe(what);

// Запрос к REST API этого же сервера с коротким токеном пользователя
async function callApi(auth, method, path, body) {
  const token = jwt.sign({ userId: auth.extra.userId }, process.env.JWT_SECRET, { expiresIn: '2m' });
  const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3001}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Lang': auth.extra.language || 'ru',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const message = (data && data.error) || `HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data ?? { ok: true }, null, 2) }] });
const fail = (error) => ({ isError: true, content: [{ type: 'text', text: `Ошибка: ${error.message}` }] });

// Убираем undefined, чтобы PATCH менял только переданные поля
const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

const dependencySchema = z.array(z.object({
  depends_on_task_id: z.number().int().positive().describe('ID задачи того же проекта, от которой зависит эта'),
  dependency_type: z.enum(['finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish']).optional()
    .describe('Тип связи, по умолчанию finish_to_start')
})).describe('Связи с другими задачами проекта. При изменении задачи заменяет весь список');

const assigneeHoursSchema = z.record(z.string(), z.number().min(0).max(10000))
  .describe('Трудоёмкость в часах по исполнителям: { "<userId>": часы }');

// [имя, описание, схема входа, аннотации, (args, auth) => результат]
const TOOLS = [
  // ── Профиль ──
  ['whoami', 'Текущий пользователь: id, имя, email, язык.', {}, READ,
    (a, auth) => callApi(auth, 'GET', '/auth/me')],

  // ── Команды ──
  ['list_teams', 'Команды пользователя с его ролью (owner/admin/member), числом участников и проектов. С этого стоит начинать: проекты принадлежат командам.', {}, READ,
    (a, auth) => callApi(auth, 'GET', '/teams')],
  ['get_team', 'Команда и её состав с ролями и статусами приглашений.', { teamId: id('команды') }, READ,
    (a, auth) => callApi(auth, 'GET', `/teams/${a.teamId}`)],
  ['create_team', 'Создать команду; пользователь становится её владельцем.', { name: z.string().min(1).max(100) }, WRITE,
    (a, auth) => callApi(auth, 'POST', '/teams', { name: a.name })],
  ['rename_team', 'Переименовать команду (владелец или админ).', { teamId: id('команды'), name: z.string().min(1).max(100) }, WRITE,
    (a, auth) => callApi(auth, 'PATCH', `/teams/${a.teamId}`, { name: a.name })],
  ['delete_team', 'Удалить команду вместе со всеми её проектами и задачами (только владелец). Необратимо — спросите пользователя перед вызовом.', { teamId: id('команды') }, DESTRUCTIVE,
    (a, auth) => callApi(auth, 'DELETE', `/teams/${a.teamId}`)],
  ['invite_team_member', 'Пригласить человека в команду по email (только владелец). Ему уйдёт письмо.', {
    teamId: id('команды'), email: z.string().email(), role: z.enum(['admin', 'member']).optional().describe('По умолчанию member')
  }, WRITE, (a, auth) => callApi(auth, 'POST', `/teams/${a.teamId}/members`, compact({ email: a.email, role: a.role }))],
  ['set_team_member_role', 'Сменить роль участника команды (только владелец).', {
    teamId: id('команды'), userId: id('пользователя'), role: z.enum(['admin', 'member'])
  }, WRITE, (a, auth) => callApi(auth, 'PATCH', `/teams/${a.teamId}/members/${a.userId}`, { role: a.role })],
  ['remove_team_member', 'Исключить участника из команды (только владелец).', { teamId: id('команды'), userId: id('пользователя') }, DESTRUCTIVE,
    (a, auth) => callApi(auth, 'DELETE', `/teams/${a.teamId}/members/${a.userId}`)],
  ['list_team_invitations', 'Приглашения в команды, ожидающие ответа пользователя.', {}, READ,
    (a, auth) => callApi(auth, 'GET', '/teams/invitations')],
  ['respond_team_invitation', 'Принять или отклонить приглашение в команду.', {
    teamId: id('команды'), accept: z.boolean()
  }, WRITE, (a, auth) => callApi(auth, 'PATCH', `/teams/invitations/${a.teamId}/${a.accept ? 'approve' : 'reject'}`)],

  // ── Проекты ──
  ['list_projects', 'Все проекты, доступные пользователю, во всех его командах.', {}, READ,
    (a, auth) => callApi(auth, 'GET', '/projects')],
  ['get_project', 'Проект целиком (с датой начала start_date и ожидаемой датой завершения due_date): колонки (statuses — id нужны для создания и перемещения задач; последняя колонка = «выполнено»), все задачи с исполнителями и сроками, участники и моя роль.', { projectId: id('проекта') }, READ,
    (a, auth) => callApi(auth, 'GET', `/projects/${a.projectId}`)],
  ['create_project', 'Создать проект в команде (владелец или админ). Колонки создаются по умолчанию.', {
    teamId: id('команды'),
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    visibility: z.enum(['team', 'selected']).optional().describe('team — видит вся команда; selected (по умолчанию) — только memberIds'),
    memberIds: ids('Кто из команды видит проект при visibility = selected').optional(),
    startDate: date('Дата начала проекта').optional(),
    dueDate: date('Ожидаемая дата завершения проекта').optional()
  }, WRITE, (a, auth) => callApi(auth, 'POST', '/projects', compact(a))],
  ['update_project', 'Изменить название, описание, дату начала и/или ожидаемую дату завершения проекта (владелец или админ). Непереданные поля не меняются.', {
    projectId: id('проекта'), name: z.string().min(1).max(255).optional(), description: z.string().optional().describe('Пустая строка — убрать описание'),
    startDate: date('Дата начала').nullable().optional().describe('null — убрать дату начала'),
    dueDate: date('Ожидаемая дата завершения').nullable().optional().describe('null — убрать срок')
  }, WRITE, async (a, auth) => {
    // API требует оба поля и стирает описание, если его не передать, — подставляем текущие значения
    const current = await callApi(auth, 'GET', `/projects/${a.projectId}`);
    return callApi(auth, 'PATCH', `/projects/${a.projectId}`, {
      name: a.name ?? current.name,
      description: a.description ?? current.description ?? '',
      ...(a.startDate !== undefined ? { startDate: a.startDate } : {}),
      ...(a.dueDate !== undefined ? { dueDate: a.dueDate } : {})
    });
  }],
  ['list_project_attachments', 'Файлы, прикреплённые к самому проекту (не к задачам): имена, размеры, кто и когда загрузил.', { projectId: id('проекта') }, READ,
    (a, auth) => callApi(auth, 'GET', `/projects/${a.projectId}/attachments`)],
  ['delete_project_attachment', 'Удалить файл проекта (может тот, кто загрузил, или владелец/админ). Необратимо — спросите пользователя перед вызовом.', {
    projectId: id('проекта'), fileId: id('файла проекта')
  }, DESTRUCTIVE, (a, auth) => callApi(auth, 'DELETE', `/projects/${a.projectId}/attachments/${a.fileId}`)],
  ['delete_project', 'Удалить проект со всеми задачами и файлами (владелец или админ). Необратимо — спросите пользователя перед вызовом.', { projectId: id('проекта') }, DESTRUCTIVE,
    (a, auth) => callApi(auth, 'DELETE', `/projects/${a.projectId}`)],
  ['set_project_access', 'Кто из команды видит проект (владелец или админ). Заменяет весь список.', {
    projectId: id('проекта'), visibility: z.enum(['team', 'selected']), memberIds: ids('Участники команды с доступом (для selected)').optional()
  }, WRITE, (a, auth) => callApi(auth, 'PUT', `/projects/${a.projectId}/access`, { visibility: a.visibility, memberIds: a.memberIds || [] })],
  ['invite_to_project', 'Пригласить в проект гостя по email (видит только этот проект).', {
    projectId: id('проекта'), email: z.string().email()
  }, WRITE, (a, auth) => callApi(auth, 'POST', `/projects/${a.projectId}/invite`, { email: a.email })],
  ['remove_project_member', 'Убрать гостя из проекта.', { projectId: id('проекта'), userId: id('пользователя') }, DESTRUCTIVE,
    (a, auth) => callApi(auth, 'DELETE', `/projects/${a.projectId}/members/${a.userId}`)],
  ['leave_project', 'Покинуть проект, куда пользователь приглашён гостем.', { projectId: id('проекта') }, DESTRUCTIVE,
    (a, auth) => callApi(auth, 'POST', `/projects/${a.projectId}/leave`)],
  ['list_project_invitations', 'Приглашения в проекты, ожидающие ответа пользователя.', {}, READ,
    (a, auth) => callApi(auth, 'GET', '/projects/invitations/pending')],
  ['respond_project_invitation', 'Принять или отклонить приглашение в проект.', {
    projectId: id('проекта'), accept: z.boolean()
  }, WRITE, (a, auth) => callApi(auth, 'PATCH', `/projects/${a.projectId}/invitation/${a.accept ? 'approve' : 'reject'}`)],

  // ── Задачи ──
  ['list_my_tasks', 'Задачи, где пользователь — исполнитель, по всем проектам, с названием проекта и колонки; is_done — задача в последней колонке.', {}, READ,
    (a, auth) => callApi(auth, 'GET', '/tasks/my')],
  ['create_task', 'Создать задачу в проекте. statusId — колонка из get_project. Исполнители получат письмо.', {
    projectId: id('проекта'),
    statusId: id('колонки (statuses из get_project)'),
    title: z.string().min(1).max(255),
    description: z.string().optional(),
    startDate: date('Дата начала').optional(),
    endDate: date('Срок').optional(),
    assigneeIds: ids('Исполнители — участники проекта (members из get_project)').optional(),
    assigneeHours: assigneeHoursSchema.optional(),
    dependencies: dependencySchema.optional()
  }, WRITE, (a, auth) => callApi(auth, 'POST', '/tasks', compact(a))],
  ['update_task', 'Изменить задачу: поля, колонку (перемещение / закрытие — statusId последней колонки), сроки, исполнителей, связи. Непереданные поля не меняются. assigneeIds заменяет весь список исполнителей (и сбрасывает часы тех, кого нет в assigneeHours); dependencies заменяет все связи.', {
    taskId: id('задачи'),
    statusId: id('колонки').optional(),
    title: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    startDate: date('Дата начала').nullable().optional().describe('null — убрать'),
    endDate: date('Срок').nullable().optional().describe('null — убрать'),
    assigneeIds: ids('Полный новый список исполнителей').optional(),
    assigneeHours: assigneeHoursSchema.optional(),
    dependencies: dependencySchema.optional()
  }, WRITE, ({ taskId, ...rest }, auth) => callApi(auth, 'PATCH', `/tasks/${taskId}`, compact(rest))],
  ['delete_task', 'Удалить задачу с вложениями. Необратимо — спросите пользователя перед вызовом.', { taskId: id('задачи') }, DESTRUCTIVE,
    (a, auth) => callApi(auth, 'DELETE', `/tasks/${a.taskId}`)],
  ['get_task_reports', 'Отчёты исполнителей по задаче.', { taskId: id('задачи') }, READ,
    (a, auth) => callApi(auth, 'GET', `/tasks/${a.taskId}/reports`)],
  ['list_task_attachments', 'Список файлов задачи (имена, размеры, кто загрузил).', { taskId: id('задачи') }, READ,
    (a, auth) => callApi(auth, 'GET', `/tasks/${a.taskId}/attachments`)],
  ['get_workload', 'Загрузка людей команды в часах за период (владелец и админы видят всех, участник — себя).', {
    teamId: id('команды'), from: date('Начало периода'), to: date('Конец периода')
  }, READ, (a, auth) => callApi(auth, 'GET', `/tasks/workload?${new URLSearchParams({ teamId: a.teamId, from: a.from, to: a.to })}`)],

  // ── Входящие ──
  ['list_inbox', 'Личные «Входящие» пользователя — быстро записанные задачи без проекта.', {
    includeCompleted: z.boolean().optional()
  }, READ, (a, auth) => callApi(auth, 'GET', `/inbox${a.includeCompleted ? '?completed=1' : ''}`)],
  ['add_to_inbox', 'Записать одну или несколько задач. Без projectId — во «Входящие», с projectId — сразу в первую колонку проекта.', {
    items: z.array(z.object({
      title: z.string().min(1).max(255),
      description: z.string().optional(),
      dueDate: date('Срок').optional(),
      projectId: z.number().int().positive().optional()
    })).min(1).max(50)
  }, WRITE, (a, auth) => callApi(auth, 'POST', '/inbox/capture', { items: a.items, source: 'text' })],
  ['update_inbox_item', 'Изменить запись во «Входящих» или отметить выполненной.', {
    itemId: id('записи'), title: z.string().min(1).max(255).optional(), description: z.string().optional(),
    dueDate: date('Срок').nullable().optional(), completed: z.boolean().optional()
  }, WRITE, ({ itemId, ...rest }, auth) => callApi(auth, 'PATCH', `/inbox/${itemId}`, compact(rest))],
  ['delete_inbox_item', 'Удалить запись из «Входящих».', { itemId: id('записи') }, DESTRUCTIVE,
    (a, auth) => callApi(auth, 'DELETE', `/inbox/${a.itemId}`)],
  ['move_inbox_to_project', 'Перенести записи из «Входящих» в проект — они станут задачами в выбранной колонке.', {
    ids: ids('ID записей').min(1).max(50),
    projectId: id('проекта'),
    statusId: id('колонки'),
    startDate: date('Дата начала').optional(),
    dueDate: date('Срок для всех (иначе — свой у каждой записи)').optional(),
    assigneeIds: ids('Исполнители').optional()
  }, WRITE, (a, auth) => callApi(auth, 'POST', '/inbox/move', compact(a))]
];

function registerTools(server) {
  for (const [name, description, inputSchema, annotations, run] of TOOLS) {
    server.registerTool(name, { description, inputSchema, annotations }, async (args, extra) => {
      try {
        return ok(await run(args || {}, extra.authInfo));
      } catch (error) {
        return fail(error);
      }
    });
  }
}

module.exports = { registerTools, TOOLS };
