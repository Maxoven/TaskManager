const express = require('express');
const pool = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { sendTeamInvitation } = require('../services/email');

const router = express.Router();
router.use(authMiddleware);

// Получить мою команду (все — и approved и pending)
router.get('/', async (req, res) => {
  try {
    const [members] = await pool.query(`
      SELECT u.id, u.name, u.email, tm.invited_at, tm.status
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

// Получить входящие приглашения в команду (мне прислали)
router.get('/invitations', async (req, res) => {
  try {
    const [invitations] = await pool.query(`
      SELECT tm.id, tm.owner_id, tm.invited_at,
             u.name as owner_name, u.email as owner_email
      FROM team_members tm
      JOIN users u ON tm.owner_id = u.id
      WHERE tm.member_id = ? AND tm.status = 'pending'
      ORDER BY tm.invited_at DESC
    `, [req.userId]);
    res.json(invitations);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения приглашений' });
  }
});

// Принять или отклонить приглашение в команду
router.patch('/invitations/:ownerId/:action', async (req, res) => {
  try {
    const { ownerId, action } = req.params;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Неверное действие' });
    }

    if (action === 'approve') {
      await pool.query(
        'UPDATE team_members SET status = ? WHERE owner_id = ? AND member_id = ?',
        ['approved', ownerId, req.userId]
      );
      // Добавляем во все проекты владельца
      const [projects] = await pool.query(
        'SELECT id FROM projects WHERE owner_id = ?', [ownerId]
      );
      for (const project of projects) {
        const [existing] = await pool.query(
          'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
          [project.id, req.userId]
        );
        if (existing.length === 0) {
          await pool.query(
            'INSERT INTO project_members (project_id, user_id, status) VALUES (?, ?, ?)',
            [project.id, req.userId, 'approved']
          );
        }
      }
      res.json({ message: 'Приглашение принято' });
    } else {
      await pool.query(
        'DELETE FROM team_members WHERE owner_id = ? AND member_id = ?',
        [ownerId, req.userId]
      );
      res.json({ message: 'Приглашение отклонено' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка обработки приглашения' });
  }
});

// Пригласить участника в команду (создаём pending)
router.post('/', async (req, res) => {
  try {
    const { email } = req.body;

    const [ownerRows] = await pool.query('SELECT id, name FROM users WHERE id = ?', [req.userId]);
    const owner = ownerRows[0];

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
      'SELECT id, status FROM team_members WHERE owner_id = ? AND member_id = ?',
      [req.userId, member.id]
    );
    if (existing.length > 0) {
      const msg = existing[0].status === 'pending'
        ? 'Приглашение уже отправлено, ожидает подтверждения'
        : 'Этот пользователь уже в вашей команде';
      return res.status(400).json({ error: msg });
    }

    await pool.query(
      'INSERT INTO team_members (owner_id, member_id, status) VALUES (?, ?, ?)',
      [req.userId, member.id, 'pending']
    );

    // Отправляем письмо
    sendTeamInvitation(member.email, member.name, owner.name)
      .catch(err => console.error('Ошибка отправки письма приглашения в команду:', err));

    res.status(201).json({ message: 'Приглашение отправлено', member });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка отправки приглашения' });
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
    const [projects] = await pool.query('SELECT id FROM projects WHERE owner_id = ?', [req.userId]);
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
