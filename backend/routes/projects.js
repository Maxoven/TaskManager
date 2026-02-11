const express = require('express');
const pool = require('../config/database');
const authMiddleware = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT p.*, u.name as owner_name,
      CASE WHEN p.owner_id = ? THEN 'owner' ELSE 'member' END as role
      FROM projects p
      LEFT JOIN users u ON p.owner_id = u.id
      LEFT JOIN project_members pm ON p.id = pm.project_id
      WHERE p.owner_id = ? OR (pm.user_id = ? AND pm.status = 'approved')
      ORDER BY p.created_at DESC
    `, [req.userId, req.userId, req.userId]);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения проектов' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, description } = req.body;
    const [result] = await pool.query(
      'INSERT INTO projects (name, description, owner_id) VALUES (?, ?, ?)',
      [name, description, req.userId]
    );
    const [projects] = await pool.query('SELECT * FROM projects WHERE id = ?', [result.insertId]);
    res.status(201).json(projects[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка создания проекта' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [access] = await pool.query(`
      SELECT p.* FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.project_id
      WHERE p.id = ? AND (p.owner_id = ? OR (pm.user_id = ? AND pm.status = 'approved'))
    `, [id, req.userId, req.userId]);

    if (access.length === 0) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const [statuses] = await pool.query('SELECT * FROM statuses WHERE project_id = ? ORDER BY position', [id]);
    const [tasks] = await pool.query(`
      SELECT t.*, 
      JSON_ARRAYAGG(
        JSON_OBJECT('id', u.id, 'name', u.name, 'email', u.email)
      ) as assignees
      FROM tasks t
      LEFT JOIN task_assignees ta ON t.id = ta.task_id
      LEFT JOIN users u ON ta.user_id = u.id
      WHERE t.project_id = ?
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `, [id]);
    
    const [members] = await pool.query(`
      SELECT u.id, u.name, u.email, pm.status, pm.invited_at,
      CASE WHEN p.owner_id = u.id THEN true ELSE false END as is_owner
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      JOIN projects p ON pm.project_id = p.id
      WHERE pm.project_id = ?
      UNION
      SELECT u.id, u.name, u.email, 'approved' as status, p.created_at as invited_at, true as is_owner
      FROM projects p
      JOIN users u ON p.owner_id = u.id
      WHERE p.id = ?
    `, [id, id]);

    res.json({
      ...access[0],
      statuses,
      tasks,
      members
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения проекта' });
  }
});

module.exports = router;
