const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// Настройка multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx|xls|xlsx|txt|zip|rar/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname || mimetype) {
      return cb(null, true);
    }
    cb(new Error('Неподдерживаемый формат файла'));
  }
});

// Создать задачу
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
    }

    if (dependencies && dependencies.length > 0) {
      const validDeps = dependencies.filter(d => d.depends_on_task_id);
      if (validDeps.length > 0) {
        const depValues = validDeps.map(d => [taskId, d.depends_on_task_id, d.dependency_type || 'finish_to_start']);
        await pool.query('INSERT INTO task_dependencies (task_id, depends_on_task_id, dependency_type) VALUES ?', [depValues]);
      }
    }

    const [tasksRaw] = await pool.query(`
      SELECT 
        t.*,
        GROUP_CONCAT(DISTINCT CONCAT(u.id, ':', u.name, ':', u.email) SEPARATOR '||') as assignees_raw,
        COUNT(DISTINCT ta_files.id) as attachments_count
      FROM tasks t
      LEFT JOIN task_assignees ta ON t.id = ta.task_id
      LEFT JOIN users u ON ta.user_id = u.id
      LEFT JOIN task_attachments ta_files ON t.id = ta_files.task_id
      WHERE t.id = ?
      GROUP BY t.id
    `, [taskId]);

    const task = tasksRaw[0];
    const assignees = [];
    if (task.assignees_raw) {
      const assigneesData = task.assignees_raw.split('||');
      assigneesData.forEach(assigneeStr => {
        const [userId, name, email] = assigneeStr.split(':');
        assignees.push({ id: parseInt(userId), name: name, email: email });
      });
    }

    const [deps] = await pool.query(
      'SELECT depends_on_task_id, dependency_type FROM task_dependencies WHERE task_id = ?',
      [taskId]
    );

    res.status(201).json({
      id: task.id,
      project_id: task.project_id,
      status_id: task.status_id,
      title: task.title,
      description: task.description,
      start_date: task.start_date,
      end_date: task.end_date,
      created_at: task.created_at,
      updated_at: task.updated_at,
      assignees: assignees,
      dependencies: deps,
      attachments_count: parseInt(task.attachments_count) || 0
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка создания задачи' });
  }
});

// Обновить задачу
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
      await pool.query('DELETE FROM task_assignees WHERE task_id = ?', [id]);
      if (assigneeIds.length > 0) {
        const vals = assigneeIds.map(uid => [id, uid]);
        await pool.query('INSERT INTO task_assignees (task_id, user_id) VALUES ?', [vals]);
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
      SELECT 
        t.*,
        GROUP_CONCAT(DISTINCT CONCAT(u.id, ':', u.name, ':', u.email) SEPARATOR '||') as assignees_raw,
        COUNT(DISTINCT ta_files.id) as attachments_count
      FROM tasks t
      LEFT JOIN task_assignees ta ON t.id = ta.task_id
      LEFT JOIN users u ON ta.user_id = u.id
      LEFT JOIN task_attachments ta_files ON t.id = ta_files.task_id
      WHERE t.id = ?
      GROUP BY t.id
    `, [id]);

    const task = tasksRaw[0];
    const assignees = [];
    if (task.assignees_raw) {
      const assigneesData = task.assignees_raw.split('||');
      assigneesData.forEach(assigneeStr => {
        const [userId, name, email] = assigneeStr.split(':');
        assignees.push({ id: parseInt(userId), name: name, email: email });
      });
    }

    const [deps] = await pool.query(
      'SELECT depends_on_task_id, dependency_type FROM task_dependencies WHERE task_id = ?',
      [id]
    );

    res.json({
      id: task.id,
      project_id: task.project_id,
      status_id: task.status_id,
      title: task.title,
      description: task.description,
      start_date: task.start_date,
      end_date: task.end_date,
      created_at: task.created_at,
      updated_at: task.updated_at,
      assignees: assignees,
      dependencies: deps,
      attachments_count: parseInt(task.attachments_count) || 0
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка обновления задачи' });
  }
});

// Удалить задачу
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [attachments] = await pool.query('SELECT filename FROM task_attachments WHERE task_id = ?', [id]);
    attachments.forEach(att => {
      const filePath = path.join(__dirname, '../uploads', att.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });

    await pool.query('DELETE FROM tasks WHERE id = ?', [id]);
    res.json({ message: 'Задача удалена' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка удаления задачи' });
  }
});

// Загрузить файл
router.post('/:id/attachments', upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }

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
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Ошибка загрузки файла' });
  }
});

// Список файлов
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

// Скачать файл
router.get('/:taskId/attachments/:fileId/download', async (req, res) => {
  try {
    const { taskId, fileId } = req.params;
    
    const [files] = await pool.query(
      'SELECT * FROM task_attachments WHERE id = ? AND task_id = ?',
      [fileId, taskId]
    );

    if (files.length === 0) {
      return res.status(404).json({ error: 'Файл не найден' });
    }

    const file = files[0];
    const filePath = path.join(__dirname, '../uploads', file.filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Файл не найден на сервере' });
    }

    res.download(filePath, file.original_name);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка скачивания файла' });
  }
});

// Удалить файл
router.delete('/:taskId/attachments/:fileId', async (req, res) => {
  try {
    const { taskId, fileId } = req.params;
    
    const [files] = await pool.query(
      'SELECT * FROM task_attachments WHERE id = ? AND task_id = ?',
      [fileId, taskId]
    );

    if (files.length === 0) {
      return res.status(404).json({ error: 'Файл не найден' });
    }

    const file = files[0];
    const filePath = path.join(__dirname, '../uploads', file.filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await pool.query('DELETE FROM task_attachments WHERE id = ?', [fileId]);

    res.json({ message: 'Файл удалён' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка удаления файла' });
  }
});

module.exports = router;
