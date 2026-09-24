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

// Файлы задач лежат вне папки, которую раздаёт nginx (/uploads/), —
// скачать их можно только через API с проверкой доступа к проекту
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../storage/uploads');

// Настройка multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    cb(null, UPLOADS_DIR);
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
    const allowed = /jpeg|jpg|png|pdf|doc|docx|xls|xlsx|txt|zip|rar/;
    if (allowed.test(path.extname(file.originalname).toLowerCase()) || allowed.test(file.mimetype)) {
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
    next();
  } catch (error) {
    next(error);
  }
}

async function saveDependencies(db, taskId, dependencies) {
  const validDeps = (dependencies || []).filter(d => d.depends_on_task_id);
  if (validDeps.length === 0) return;
  await db.query(`
    INSERT INTO task_dependencies (task_id, depends_on_task_id, dependency_type)
    SELECT $1, d.dep_id, d.dep_type
    FROM unnest($2::int[], $3::text[]) AS d(dep_id, dep_type)
    ON CONFLICT (task_id, depends_on_task_id) DO NOTHING
  `, [
    taskId,
    validDeps.map(d => d.depends_on_task_id),
    validDeps.map(d => d.dependency_type || 'finish_to_start')
  ]);
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
    const { projectId, statusId, title, description, startDate, endDate, assigneeIds, dependencies } = req.body;

    if (!(await hasProjectAccess(projectId, req.userId))) {
      return res.status(403).json({ error: req.t('accessDenied') });
    }

    const taskId = await withTransaction(async (client) => {
      const { rows: [created] } = await client.query(
        `INSERT INTO tasks (project_id, status_id, title, description, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [projectId, statusId, title, description, startDate || null, endDate || null]
      );
      if (assigneeIds && assigneeIds.length > 0) {
        await client.query(
          'INSERT INTO task_assignees (task_id, user_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING',
          [created.id, assigneeIds]
        );
      }
      await saveDependencies(client, created.id, dependencies);
      return created.id;
    });

    // Email уведомления о новой задаче
    await notifyAssignees(assigneeIds, title, projectId);

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
    const { statusId, title, description, startDate, endDate, assigneeIds, dependencies } = req.body;

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
        added = assigneeIds.filter(uid => !oldIds.includes(uid));

        await client.query('DELETE FROM task_assignees WHERE task_id = $1', [id]);
        if (assigneeIds.length > 0) {
          await client.query(
            'INSERT INTO task_assignees (task_id, user_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING',
            [id, assigneeIds]
          );
        }
      }

      if (dependencies !== undefined) {
        await client.query('DELETE FROM task_dependencies WHERE task_id = $1', [id]);
        await saveDependencies(client, id, dependencies);
      }
      return added;
    });

    const task = await fetchTask(pool, id);

    // Уведомляем только новых исполнителей
    await notifyAssignees(addedIds, task.title, task.project_id);

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
    attachments.forEach(att => {
      const filePath = path.join(UPLOADS_DIR, att.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
    await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
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
    const filePath = path.join(UPLOADS_DIR, files[0].filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await pool.query('DELETE FROM task_attachments WHERE id = $1', [fileId]);
    res.json({ message: req.t('fileDeleted') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('fileDeleteError') });
  }
});

module.exports = router;
