const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { withTransaction } = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { sendTaskAssigned } = require('../services/email');

const router = express.Router();
router.use(authMiddleware);

const requireNumericParam = (req, res, next, value) => {
  if (!/^\d{1,9}$/.test(value)) return res.status(404).json({ error: req.t('notFound') });
  next();
};
router.param('id', requireNumericParam);
router.param('taskId', requireNumericParam);
router.param('fileId', requireNumericParam);

// Файлы задач лежат вне папки, которую раздаёт nginx (/uploads/), —
// скачать их можно только через API с проверкой доступа к проекту
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../storage/uploads');

// Настройка multer
const ALLOWED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.zip', '.rar'
]);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    fs.mkdir(UPLOADS_DIR, { recursive: true }, (err) => cb(err, UPLOADS_DIR));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    // multer отдаёт имя файла в latin1 — без перекодировки кириллица превращается в «Ð¾Ñ‚Ñ‡Ñ‘Ñ‚»
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    // Проверяем именно расширение: MIME-тип присылает клиент, ему доверять нельзя
    if (ALLOWED_EXT.has(path.extname(file.originalname).toLowerCase())) {
      return cb(null, true);
    }
    const err = new Error('Unsupported file format');
    err.code = 'UNSUPPORTED_FILE';
    cb(err);
  }
});

// Поля задачи + исполнители, вложения, отчёт и связи одним запросом
const TASK_FIELDS = `
  t.id, t.project_id, t.status_id, t.title, t.description,
  t.start_date, t.end_date, t.created_at, t.updated_at,
  COALESCE((
    SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'email', u.email) ORDER BY u.name)
    FROM task_assignees ta JOIN users u ON ta.user_id = u.id
    WHERE ta.task_id = t.id
  ), '[]') AS assignees,
  (SELECT COUNT(*)::int FROM task_attachments f WHERE f.task_id = t.id) AS attachments_count,
  EXISTS (SELECT 1 FROM task_reports tr WHERE tr.task_id = t.id) AS has_report,
  COALESCE((
    SELECT json_agg(json_build_object('depends_on_task_id', d.depends_on_task_id, 'dependency_type', d.dependency_type))
    FROM task_dependencies d WHERE d.task_id = t.id
  ), '[]') AS dependencies
`;

// Удаление файла с диска — в фоне и без падения, если файла уже нет
function removeUploadedFile(filename) {
  fs.unlink(path.join(UPLOADS_DIR, filename), (err) => {
    if (err && err.code !== 'ENOENT') console.error('Не удалось удалить файл:', err.message);
  });
}

async function fetchTask(db, taskId) {
  const { rows } = await db.query(`SELECT ${TASK_FIELDS} FROM tasks t WHERE t.id = $1`, [taskId]);
  return rows[0];
}

// Есть ли у пользователя доступ к проекту (владелец или подтверждённый участник)
async function hasProjectAccess(projectId, userId) {
  const { rows } = await pool.query(`
    SELECT 1 FROM projects p
    WHERE p.id = $1 AND (
      p.owner_id = $2 OR EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'approved'
      )
    )
  `, [projectId, userId]);
  return rows.length > 0;
}

// Middleware: задача :id / :taskId существует и пользователь имеет доступ к её проекту
async function requireTaskAccess(req, res, next) {
  try {
    const taskId = req.params.id || req.params.taskId;
    const { rows } = await pool.query('SELECT project_id FROM tasks WHERE id = $1', [taskId]);
    if (rows.length === 0) return res.status(404).json({ error: req.t('taskNotFound') });
    if (!(await hasProjectAccess(rows[0].project_id, req.userId))) {
      return res.status(403).json({ error: req.t('accessDenied') });
    }
    req.taskProjectId = rows[0].project_id;
    next();
  } catch (error) {
    next(error);
  }
}

const DEPENDENCY_TYPES = ['finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish'];

const toIntArray = (value) =>
  Array.isArray(value) ? [...new Set(value.map(Number).filter(Number.isInteger))] : [];

// Связывать можно только задачи одного проекта (и не саму с собой)
async function saveDependencies(db, taskId, projectId, dependencies) {
  const validDeps = (Array.isArray(dependencies) ? dependencies : [])
    .map(d => ({ id: Number(d?.depends_on_task_id), type: d?.dependency_type }))
    .filter(d => Number.isInteger(d.id) && d.id !== Number(taskId));
  if (validDeps.length === 0) return;
  await db.query(`
    INSERT INTO task_dependencies (task_id, depends_on_task_id, dependency_type)
    SELECT $1, d.dep_id, d.dep_type
    FROM unnest($2::int[], $3::text[]) AS d(dep_id, dep_type)
    JOIN tasks dt ON dt.id = d.dep_id AND dt.project_id = $4
    ON CONFLICT (task_id, depends_on_task_id) DO NOTHING
  `, [
    taskId,
    validDeps.map(d => d.id),
    validDeps.map(d => (DEPENDENCY_TYPES.includes(d.type) ? d.type : 'finish_to_start')),
    projectId
  ]);
}

// Исполнителем может быть только владелец или подтверждённый участник проекта —
// иначе через задачу можно узнать имя/email любого пользователя и слать ему письма
async function saveAssignees(db, taskId, projectId, assigneeIds) {
  const ids = toIntArray(assigneeIds);
  if (ids.length === 0) return [];
  const { rows } = await db.query(`
    INSERT INTO task_assignees (task_id, user_id)
    SELECT $1, u.id FROM users u
    WHERE u.id = ANY($2::int[]) AND (
      u.id = (SELECT owner_id FROM projects WHERE id = $3) OR EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = $3 AND pm.user_id = u.id AND pm.status = 'approved'
      )
    )
    ON CONFLICT DO NOTHING
    RETURNING user_id
  `, [taskId, ids, projectId]);
  return rows.map(r => r.user_id);
}

async function statusBelongsToProject(statusId, projectId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM statuses WHERE id = $1 AND project_id = $2', [statusId, projectId]
  );
  return rows.length > 0;
}

const datesInvalid = (start, end) => !!start && !!end && String(end) < String(start);

// Письма уходят в фоне: SMTP не должен задерживать ответ на сохранение задачи
function notifyAssigneesInBackground(userIds, taskTitle, projectId) {
  notifyAssignees(userIds, taskTitle, projectId)
    .catch(e => console.error('Ошибка отправки уведомлений:', e.message));
}

async function notifyAssignees(userIds, taskTitle, projectId) {
  if (!userIds || userIds.length === 0) return;
  const { rows: [project] } = await pool.query('SELECT name FROM projects WHERE id = $1', [projectId]);
  const { rows: users } = await pool.query(
    'SELECT id, name, email, language FROM users WHERE id = ANY($1::int[])', [userIds]
  );
  for (const user of users) {
    try {
      await sendTaskAssigned(user, taskTitle, project?.name || '', projectId);
    } catch (e) {
      console.error('Ошибка отправки уведомления:', e.message);
    }
  }
}

// ─── Мои задачи (назначенные мне) ─────────────────────────────────────────
router.get('/my', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT ${TASK_FIELDS},
        p.name AS project_name,
        s.name AS status_name,
        -- Задача выполнена, если стоит в последней колонке проекта
        (s.id IS NOT NULL AND s.position = (
          SELECT MAX(s2.position) FROM statuses s2 WHERE s2.project_id = t.project_id
        )) AS is_done
      FROM tasks t
      JOIN task_assignees ta_me ON t.id = ta_me.task_id AND ta_me.user_id = $1
      JOIN projects p ON t.project_id = p.id
      LEFT JOIN statuses s ON t.status_id = s.id
      ORDER BY t.end_date ASC NULLS LAST, t.created_at DESC
    `, [req.userId]);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('tasksFetchError') });
  }
});

// ─── Создать задачу ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { statusId, description, startDate, endDate, assigneeIds, dependencies } = req.body;
    const projectId = Number(req.body.projectId);
    const title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 255) : '';

    if (!Number.isInteger(projectId) || !(await hasProjectAccess(projectId, req.userId))) {
      return res.status(403).json({ error: req.t('accessDenied') });
    }
    if (!title) {
      return res.status(400).json({ error: req.t('taskTitleRequired') });
    }
    if (!Number.isInteger(Number(statusId)) || !(await statusBelongsToProject(statusId, projectId))) {
      return res.status(400).json({ error: req.t('statusInvalid') });
    }
    if (datesInvalid(startDate, endDate)) {
      return res.status(400).json({ error: req.t('datesInvalid') });
    }

    const { taskId, assigned } = await withTransaction(async (client) => {
      const { rows: [created] } = await client.query(
        `INSERT INTO tasks (project_id, status_id, title, description, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [projectId, statusId, title, description || null, startDate || null, endDate || null]
      );
      const added = await saveAssignees(client, created.id, projectId, assigneeIds);
      await saveDependencies(client, created.id, projectId, dependencies);
      return { taskId: created.id, assigned: added };
    });

    // Email уведомления о новой задаче
    notifyAssigneesInBackground(assigned, title, projectId);

    res.status(201).json(await fetchTask(pool, taskId));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('taskCreateError') });
  }
});

// ─── Обновить задачу ────────────────────────────────────────────────────────
router.patch('/:id', requireTaskAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { statusId, description, startDate, endDate, assigneeIds, dependencies } = req.body;
    const projectId = req.taskProjectId;
    const title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 255) : req.body.title;

    if (title !== undefined && !title) {
      return res.status(400).json({ error: req.t('taskTitleRequired') });
    }
    if (statusId !== undefined &&
        (!Number.isInteger(Number(statusId)) || !(await statusBelongsToProject(statusId, projectId)))) {
      return res.status(400).json({ error: req.t('statusInvalid') });
    }
    if (startDate !== undefined && endDate !== undefined && datesInvalid(startDate, endDate)) {
      return res.status(400).json({ error: req.t('datesInvalid') });
    }

    const addedIds = await withTransaction(async (client) => {
      const updates = [];
      const values = [];
      const set = (column, value) => { values.push(value); updates.push(`${column} = $${values.length}`); };
      if (statusId !== undefined) set('status_id', statusId);
      if (title !== undefined) set('title', title);
      if (description !== undefined) set('description', description);
      if (startDate !== undefined) set('start_date', startDate || null);
      if (endDate !== undefined) set('end_date', endDate || null);

      if (updates.length > 0) {
        values.push(id);
        await client.query(`UPDATE tasks SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
      }

      let added = [];
      if (assigneeIds !== undefined) {
        // Получаем старых исполнителей для сравнения
        const { rows: oldAssignees } = await client.query(
          'SELECT user_id FROM task_assignees WHERE task_id = $1', [id]
        );
        const oldIds = oldAssignees.map(a => a.user_id);

        await client.query('DELETE FROM task_assignees WHERE task_id = $1', [id]);
        const saved = await saveAssignees(client, id, projectId, assigneeIds);
        added = saved.filter(uid => !oldIds.includes(uid));
      }

      if (dependencies !== undefined) {
        await client.query('DELETE FROM task_dependencies WHERE task_id = $1', [id]);
        await saveDependencies(client, id, projectId, dependencies);
      }
      return added;
    });

    const task = await fetchTask(pool, id);

    // Уведомляем только новых исполнителей
    notifyAssigneesInBackground(addedIds, task.title, task.project_id);

    res.json(task);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('taskUpdateError') });
  }
});

// ─── Удалить задачу ─────────────────────────────────────────────────────────
router.delete('/:id', requireTaskAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: attachments } = await pool.query(
      'SELECT filename FROM task_attachments WHERE task_id = $1', [id]
    );
    // Сначала запись в БД, потом файлы: при сбое БД вложения не пропадут с диска
    await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
    attachments.forEach(att => removeUploadedFile(att.filename));
    res.json({ message: req.t('taskDeleted') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('taskDeleteError') });
  }
});

// ─── Отчёты ─────────────────────────────────────────────────────────────────
// Публичные маршруты по magic link — в routes/reports.js

// Получить отчёты по задаче (для авторизованных пользователей)
router.get('/:id/reports', requireTaskAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`
      SELECT tr.*, u.name AS user_name, u.email AS user_email
      FROM task_reports tr
      JOIN users u ON tr.user_id = u.id
      WHERE tr.task_id = $1
      ORDER BY tr.submitted_at DESC
    `, [id]);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('reportsFetchError') });
  }
});

// ─── Вложения ───────────────────────────────────────────────────────────────

router.post('/:id/attachments', requireTaskAccess, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: req.t('fileNotUploaded') });
    const { rows: [attachment] } = await pool.query(
      `INSERT INTO task_attachments (task_id, filename, original_name, file_size, uploaded_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [id, req.file.filename, req.file.originalname, req.file.size, req.userId]
    );
    res.status(201).json({
      id: attachment.id,
      filename: req.file.filename,
      original_name: req.file.originalname,
      file_size: req.file.size
    });
  } catch (error) {
    console.error(error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: req.t('fileUploadError') });
  }
});

router.get('/:id/attachments', requireTaskAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`
      SELECT ta.*, u.name AS uploader_name
      FROM task_attachments ta
      LEFT JOIN users u ON ta.uploaded_by = u.id
      WHERE ta.task_id = $1
      ORDER BY ta.uploaded_at DESC
    `, [id]);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('filesFetchError') });
  }
});

router.get('/:taskId/attachments/:fileId/download', requireTaskAccess, async (req, res) => {
  try {
    const { taskId, fileId } = req.params;
    const { rows: files } = await pool.query(
      'SELECT * FROM task_attachments WHERE id = $1 AND task_id = $2', [fileId, taskId]
    );
    if (files.length === 0) return res.status(404).json({ error: req.t('fileNotFound') });
    const filePath = path.join(UPLOADS_DIR, files[0].filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: req.t('fileMissingOnServer') });
    res.download(filePath, files[0].original_name);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('fileDownloadError') });
  }
});

router.delete('/:taskId/attachments/:fileId', requireTaskAccess, async (req, res) => {
  try {
    const { taskId, fileId } = req.params;
    const { rows: files } = await pool.query(
      'SELECT * FROM task_attachments WHERE id = $1 AND task_id = $2', [fileId, taskId]
    );
    if (files.length === 0) return res.status(404).json({ error: req.t('fileNotFound') });
    await pool.query('DELETE FROM task_attachments WHERE id = $1', [fileId]);
    removeUploadedFile(files[0].filename);
    res.json({ message: req.t('fileDeleted') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('fileDeleteError') });
  }
});

module.exports = router;
