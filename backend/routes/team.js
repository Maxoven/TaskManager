const express = require('express');
const pool = require('../config/database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// Получить команду (всех кого я добавил)
router.get('/', async (req, res) => {
  try {
    const [members] = await pool.query(`
      SELECT u.id, u.name, u.email, tm.invited_at
      FROM team_members tm
      JOIN users u ON tm.member_id = u.id
      WHERE tm.owner_id = ?
      ORDER BY tm.invited_at DESC
    `, [req.userId]);
    res.json(members);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения команды' });
  }
});

// Добавить участника в команду по email
router.post('/', async (req, res) => {
  try {
    const { email } = req.body;

    // Нельзя добавить себя
    const [self] = await pool.query('SELECT id FROM users WHERE id = ? AND email = ?', [req.userId, email]);
    if (self.length > 0) {
      return res.status(400).json({ error: 'Нельзя добавить себя в команду' });
    }

    const [users] = await pool.query('SELECT id, name, email FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'Пользователь с таким email не найден' });
    }

    const member = users[0];

    const [existing] = await pool.query(
      'SELECT id FROM team_members WHERE owner_id = ? AND member_id = ?',
      [req.userId, member.id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Этот пользователь уже в вашей команде' });
    }

    await pool.query(
      'INSERT INTO team_members (owner_id, member_id) VALUES (?, ?)',
      [req.userId, member.id]
    );

    // Автоматически добавляем участника во все существующие проекты владельца
    const [projects] = await pool.query(
      'SELECT id FROM projects WHERE owner_id = ?',
      [req.userId]
    );

    for (const project of projects) {
      const [existingMember] = await pool.query(
        'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
        [project.id, member.id]
      );
      if (existingMember.length === 0) {
        await pool.query(
          'INSERT INTO project_members (project_id, user_id, status) VALUES (?, ?, ?)',
          [project.id, member.id, 'approved']
        );
      }
    }

    res.status(201).json({ message: 'Участник добавлен в команду', member });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка добавления участника' });
  }
});

// Удалить участника из команды
router.delete('/:memberId', async (req, res) => {
  try {
    const { memberId } = req.params;

    await pool.query(
      'DELETE FROM team_members WHERE owner_id = ? AND member_id = ?',
      [req.userId, memberId]
    );

    // Удаляем из всех проектов владельца
    const [projects] = await pool.query(
      'SELECT id FROM projects WHERE owner_id = ?',
      [req.userId]
    );

    for (const project of projects) {
      await pool.query(
        'DELETE FROM project_members WHERE project_id = ? AND user_id = ?',
        [project.id, memberId]
      );
    }

    res.json({ message: 'Участник удалён из команды' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка удаления участника' });
  }
});

module.exports = router;
