const express = require('express');
const pool = require('../config/database');
const authMiddleware = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware);

router.post('/', async (req, res) => {
  try {
    const { projectId, statusId, title, description, startDate, endDate, assigneeIds } = req.body;
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
      [projectId, statusId, title, description, startDate, endDate]
    );

    if (assigneeIds && assigneeIds.length > 0) {
      const values = assigneeIds.map(uid => [result.insertId, uid]);
      await pool.query('INSERT INTO task_assignees (task_id, user_id) VALUES ?', [values]);
    }

    const [tasks] = await pool.query(`
      SELECT t.*, JSON_ARRAYAGG(JSON_OBJECT('id', u.id, 'name', u.name, 'email', u.email)) as assignees
      FROM tasks t
      LEFT JOIN task_assignees ta ON t.id = ta.task_id
      LEFT JOIN users u ON ta.user_id = u.id
      WHERE t.id = ?
      GROUP BY t.id
    `, [result.insertId]);

    res.status(201).json(tasks[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка создания задачи' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { statusId, title, description, startDate, endDate, assigneeIds } = req.body;

    const updates = [];
    const values = [];

    if (statusId !== undefined) { updates.push('status_id = ?'); values.push(statusId); }
    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (startDate !== undefined) { updates.push('start_date = ?'); values.push(startDate); }
    if (endDate !== undefined) { updates.push('end_date = ?'); values.push(endDate); }

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

    const [tasks] = await pool.query(`
      SELECT t.*, JSON_ARRAYAGG(JSON_OBJECT('id', u.id, 'name', u.name, 'email', u.email)) as assignees
      FROM tasks t
      LEFT JOIN task_assignees ta ON t.id = ta.task_id
      LEFT JOIN users u ON ta.user_id = u.id
      WHERE t.id = ?
      GROUP BY t.id
    `, [id]);

    res.json(tasks[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка обновления задачи' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM tasks WHERE id = ?', [req.params.id]);
    res.json({ message: 'Задача удалена' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка удаления задачи' });
  }
});

module.exports = router;
