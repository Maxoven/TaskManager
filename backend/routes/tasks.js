const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { sendTaskAssigned } = require('../services/email');

const router = express.Router();
router.use(authMiddleware);

// Настройка multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    cb(null, uploadsDir);
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
    cb(new Error('Неподдерживаемый формат файла'));
  }
});

// Хелпер: форматировать задачу из raw
function formatTask(task, assignees, deps) {
  return {
    id: task.id,
    project_id: task.project_id,
    status_id: task.status_id,
    title: task.title,
    description: task.description,
    start_date: task.start_date,
    end_date: task.end_date,
    created_at: task.created_at,
    updated_at: task.updated_at,
    assignees,
    dependencies: deps || [],
    attachments_count: parseInt(task.attachments_count) || 0
  };
}

function parseAssignees(raw) {
  if (!raw) return [];
  return raw.split('||').map(str => {
    const [id, name, email] = str.split(':');
    return { id: parseInt(id), name, email };
  });
}

// ─── Мои задачи (назначенные мне) ─────────────────────────────────────────
router.get('/my', async (req, res) => {
  try {
    const [tasksRaw] = await pool.query(`
      SELECT 
        t.*,
        p.name as project_name,
        s.name as status_name,
        GROUP_CONCAT(DISTINCT CONCAT(u.id, ':', u.name, ':', u.email) SEPARATOR '||') as assignees_raw,
        COUNT(DISTINCT ta_files.id) as attachments_count,
        (SELECT COUNT(*) FROM task_reports tr WHERE tr.task_id = t.id) as has_report
      FROM tasks t
      JOIN task_assignees ta_me ON t.id = ta_me.task_id AND ta_me.user_id = ?
      JOIN projects p ON t.project_id = p.id
      LEFT JOIN statuses s ON t.status_id = s.id
      LEFT JOIN task_assignees ta ON t.id = ta.task_id
      LEFT JOIN users u ON ta.user_id = u.id
      LEFT JOIN task_attachments ta_files ON t.id = ta_files.task_id
      GROUP BY t.id
      ORDER BY t.end_date ASC, t.created_at DESC
    `, [req.userId]);

    const tasks = tasksRaw.map(task => ({
      ...formatTask(task, parseAssignees(task.assignees_raw), []),
      project_name: task.project_name,
      status_name: task.status_name,
      has_report: task.has_report > 0
    }));

    res.json(tasks);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения задач' });
  }
});

// ─── Создать задачу ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { projectId, statusId, title, description, startDate, endDate, assigneeIds, dependencies } = req.body;
    
    const [access] = await pool.query(`
      SELECT * FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.project_id
      WHERE p.id = ? AND (p.owner_id = ? OR (pm.user_id = ? AND pm.status = 'approved'))
    `, [projectId, req.userId, req.userId]);

    if (access.length === 0) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const [result] = await pool.query(
      'INSERT INTO tasks (project_id, status_id, title, description, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)',
      [projectId, statusId, title, description, startDate || null, endDate || null]
    );
    const taskId = result.insertId;

    if (assigneeIds && assigneeIds.length > 0) {
      const values = assigneeIds.map(uid => [taskId, uid]);
      await pool.query('INSERT INTO task_assignees (task_id, user_id) VALUES ?', [values]);

      // Email уведомления о новой задаче
      const [projectInfo] = await pool.query('SELECT name FROM projects WHERE id = ?', [projectId]);
      const projectName = projectInfo[0]?.name || '';
      const [assignees] = await pool.query(
        'SELECT u.id, u.name, u.email FROM users u WHERE u.id IN (?)',
        [assigneeIds]
      );
      for (const assignee of assignees) {
        try {
          await sendTaskAssigned(assignee.email, assignee.name, title, projectName, projectId);
        } catch (e) {
          console.error('Ошибка отправки уведомления:', e.message);
        }
      }
    }

    if (dependencies && dependencies.length > 0) {
      const validDeps = dependencies.filter(d => d.depends_on_task_id);
      if (validDeps.length > 0) {
        const depValues = validDeps.map(d => [taskId, d.depends_on_task_id, d.dependency_type || 'finish_to_start']);
        await pool.query('INSERT INTO task_dependencies (task_id, depends_on_task_id, dependency_type) VALUES ?', [depValues]);
      }
    }

    const [tasksRaw] = await pool.query(`
      SELECT t.*,
        GROUP_CONCAT(DISTINCT CONCAT(u.id, ':', u.name, ':', u.email) SEPARATOR '||') as assignees_raw,
        COUNT(DISTINCT ta_files.id) as attachments_count
      FROM tasks t
      LEFT JOIN task_assignees ta ON t.id = ta.task_id
      LEFT JOIN users u ON ta.user_id = u.id
      LEFT JOIN task_attachments ta_files ON t.id = ta_files.task_id
      WHERE t.id = ? GROUP BY t.id
    `, [taskId]);

    const [deps] = await pool.query(
      'SELECT depends_on_task_id, dependency_type FROM task_dependencies WHERE task_id = ?',
      [taskId]
    );

    res.status(201).json(formatTask(tasksRaw[0], parseAssignees(tasksRaw[0].assignees_raw), deps));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка создания задачи' });
  }
});

// ─── Обновить задачу ────────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { statusId, title, description, startDate, endDate, assigneeIds, dependencies } = req.body;

    const updates = [];
    const values = [];
    if (statusId !== undefined) { updates.push('status_id = ?'); values.push(statusId); }
    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (startDate !== undefined) { updates.push('start_date = ?'); values.push(startDate || null); }
    if (endDate !== undefined) { updates.push('end_date = ?'); values.push(endDate || null); }

    if (updates.length > 0) {
      values.push(id);
      await pool.query(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, values);
    }

    if (assigneeIds !== undefined) {
      // Получаем старых исполнителей для сравнения
      const [oldAssignees] = await pool.query(
        'SELECT user_id FROM task_assignees WHERE task_id = ?', [id]
      );
      const oldIds = oldAssignees.map(a => a.user_id);
      const newIds = assigneeIds;
      const addedIds = newIds.filter(uid => !oldIds.includes(uid));

      await pool.query('DELETE FROM task_assignees WHERE task_id = ?', [id]);
      if (newIds.length > 0) {
        const vals = newIds.map(uid => [id, uid]);
        await pool.query('INSERT INTO task_assignees (task_id, user_id) VALUES ?', [vals]);
      }

      // Уведомляем только новых исполнителей
      if (addedIds.length > 0) {
        const [taskInfo] = await pool.query(`
          SELECT t.title, p.name as project_name, t.project_id
          FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.id = ?
        `, [id]);
        if (taskInfo.length > 0) {
          const [newAssignees] = await pool.query(
            'SELECT name, email FROM users WHERE id IN (?)', [addedIds]
          );
          for (const a of newAssignees) {
            try {
              await sendTaskAssigned(a.email, a.name, taskInfo[0].title, taskInfo[0].project_name, taskInfo[0].project_id);
            } catch (e) {
              console.error('Ошибка уведомления:', e.message);
            }
          }
        }
      }
    }

    if (dependencies !== undefined) {
      await pool.query('DELETE FROM task_dependencies WHERE task_id = ?', [id]);
      const validDeps = dependencies.filter(d => d.depends_on_task_id);
      if (validDeps.length > 0) {
        const depValues = validDeps.map(d => [id, d.depends_on_task_id, d.dependency_type || 'finish_to_start']);
        await pool.query('INSERT INTO task_dependencies (task_id, depends_on_task_id, dependency_type) VALUES ?', [depValues]);
      }
    }

    const [tasksRaw] = await pool.query(`
      SELECT t.*,
        GROUP_CONCAT(DISTINCT CONCAT(u.id, ':', u.name, ':', u.email) SEPARATOR '||') as assignees_raw,
        COUNT(DISTINCT ta_files.id) as attachments_count
      FROM tasks t
      LEFT JOIN task_assignees ta ON t.id = ta.task_id
      LEFT JOIN users u ON ta.user_id = u.id
      LEFT JOIN task_attachments ta_files ON t.id = ta_files.task_id
      WHERE t.id = ? GROUP BY t.id
    `, [id]);

    const [deps] = await pool.query(
      'SELECT depends_on_task_id, dependency_type FROM task_dependencies WHERE task_id = ?', [id]
    );

    res.json(formatTask(tasksRaw[0], parseAssignees(tasksRaw[0].assignees_raw), deps));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка обновления задачи' });
  }
});

// ─── Удалить задачу ─────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [attachments] = await pool.query('SELECT filename FROM task_attachments WHERE task_id = ?', [id]);
    attachments.forEach(att => {
      const filePath = path.join(__dirname, '../uploads', att.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
    await pool.query('DELETE FROM tasks WHERE id = ?', [id]);
    res.json({ message: 'Задача удалена' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка удаления задачи' });
  }
});

// ─── Отчёты ─────────────────────────────────────────────────────────────────

// Получить отчёт по токену (страница отправки отчёта)
router.get('/report-token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const [tokens] = await pool.query(`
      SELECT rt.*, t.title as task_title, p.name as project_name,
             u.name as user_name
      FROM report_tokens rt
      JOIN tasks t ON rt.task_id = t.id
      JOIN projects p ON t.project_id = p.id
      JOIN users u ON rt.user_id = u.id
      WHERE rt.token = ? AND rt.expires_at > NOW()
    `, [token]);

    if (tokens.length === 0) {
      return res.status(404).json({ error: 'Ссылка недействительна или истекла' });
    }

    // Проверяем, не отправлен ли уже отчёт
    const [reports] = await pool.query(
      'SELECT id FROM task_reports WHERE task_id = ? AND user_id = ?',
      [tokens[0].task_id, tokens[0].user_id]
    );

    res.json({
      taskId: tokens[0].task_id,
      taskTitle: tokens[0].task_title,
      projectName: tokens[0].project_name,
      userName: tokens[0].user_name,
      alreadySubmitted: reports.length > 0
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Отправить отчёт по токену (без авторизации — по magic link)
router.post('/report-token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { reportText } = req.body;

    if (!reportText || reportText.trim().length === 0) {
      return res.status(400).json({ error: 'Текст отчёта не может быть пустым' });
    }

    const [tokens] = await pool.query(
      'SELECT * FROM report_tokens WHERE token = ? AND expires_at > NOW()',
      [token]
    );
    if (tokens.length === 0) {
      return res.status(404).json({ error: 'Ссылка недействительна или истекла' });
    }

    const rt = tokens[0];

    // Проверяем дубликат
    const [existing] = await pool.query(
      'SELECT id FROM task_reports WHERE task_id = ? AND user_id = ?',
      [rt.task_id, rt.user_id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Отчёт уже был отправлен' });
    }

    await pool.query(
      'INSERT INTO task_reports (task_id, user_id, report_text) VALUES (?, ?, ?)',
      [rt.task_id, rt.user_id, reportText.trim()]
    );

    res.json({ message: 'Отчёт успешно отправлен' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка отправки отчёта' });
  }
});

// Получить отчёты по задаче (для авторизованных пользователей)
router.get('/:id/reports', async (req, res) => {
  try {
    const { id } = req.params;
    const [reports] = await pool.query(`
      SELECT tr.*, u.name as user_name, u.email as user_email
      FROM task_reports tr
      JOIN users u ON tr.user_id = u.id
      WHERE tr.task_id = ?
      ORDER BY tr.submitted_at DESC
    `, [id]);
    res.json(reports);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения отчётов' });
  }
});

// ─── Вложения ───────────────────────────────────────────────────────────────

router.post('/:id/attachments', upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const [result] = await pool.query(
      'INSERT INTO task_attachments (task_id, filename, original_name, file_size, uploaded_by) VALUES (?, ?, ?, ?, ?)',
      [id, req.file.filename, req.file.originalname, req.file.size, req.userId]
    );
    res.status(201).json({
      id: result.insertId,
      filename: req.file.filename,
      original_name: req.file.originalname,
      file_size: req.file.size
    });
  } catch (error) {
    console.error(error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Ошибка загрузки файла' });
  }
});

router.get('/:id/attachments', async (req, res) => {
  try {
    const { id } = req.params;
    const [attachments] = await pool.query(`
      SELECT ta.*, u.name as uploader_name
      FROM task_attachments ta
      LEFT JOIN users u ON ta.uploaded_by = u.id
      WHERE ta.task_id = ?
      ORDER BY ta.uploaded_at DESC
    `, [id]);
    res.json(attachments);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения файлов' });
  }
});

router.get('/:taskId/attachments/:fileId/download', async (req, res) => {
  try {
    const { taskId, fileId } = req.params;
    const [files] = await pool.query(
      'SELECT * FROM task_attachments WHERE id = ? AND task_id = ?',
      [fileId, taskId]
    );
    if (files.length === 0) return res.status(404).json({ error: 'Файл не найден' });
    const filePath = path.join(__dirname, '../uploads', files[0].filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Файл не найден на сервере' });
    res.download(filePath, files[0].original_name);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка скачивания файла' });
  }
});

router.delete('/:taskId/attachments/:fileId', async (req, res) => {
  try {
    const { taskId, fileId } = req.params;
    const [files] = await pool.query(
      'SELECT * FROM task_attachments WHERE id = ? AND task_id = ?',
      [fileId, taskId]
    );
    if (files.length === 0) return res.status(404).json({ error: 'Файл не найден' });
    const filePath = path.join(__dirname, '../uploads', files[0].filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await pool.query('DELETE FROM task_attachments WHERE id = ?', [fileId]);
    res.json({ message: 'Файл удалён' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка удаления файла' });
  }
});

module.exports = router;
