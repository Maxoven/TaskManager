const express = require('express');
const pool = require('../config/database');
const { withTransaction } = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { sendTeamInvitation } = require('../services/email');

const router = express.Router();
router.use(authMiddleware);

// Получить мою команду (все — и approved и pending)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.email, tm.invited_at, tm.status
      FROM team_members tm
      JOIN users u ON tm.member_id = u.id
      WHERE tm.owner_id = $1
      ORDER BY tm.invited_at DESC
    `, [req.userId]);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('teamFetchError') });
  }
});

// Получить входящие приглашения в команду (мне прислали)
router.get('/invitations', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT tm.id, tm.owner_id, tm.invited_at,
             u.name AS owner_name, u.email AS owner_email
      FROM team_members tm
      JOIN users u ON tm.owner_id = u.id
      WHERE tm.member_id = $1 AND tm.status = 'pending'
      ORDER BY tm.invited_at DESC
    `, [req.userId]);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('invitationsFetchError') });
  }
});

// Принять или отклонить приглашение в команду
router.patch('/invitations/:ownerId/:action', async (req, res) => {
  try {
    const { ownerId, action } = req.params;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: req.t('invalidAction') });
    }

    if (action === 'approve') {
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE team_members SET status = 'approved' WHERE owner_id = $1 AND member_id = $2`,
          [ownerId, req.userId]
        );
        // Добавляем во все проекты владельца
        await client.query(`
          INSERT INTO project_members (project_id, user_id, status)
          SELECT id, $2, 'approved' FROM projects WHERE owner_id = $1
          ON CONFLICT (project_id, user_id) DO UPDATE SET status = 'approved'
        `, [ownerId, req.userId]);
      });
      res.json({ message: req.t('invitationAccepted') });
    } else {
      await pool.query(
        'DELETE FROM team_members WHERE owner_id = $1 AND member_id = $2', [ownerId, req.userId]
      );
      res.json({ message: req.t('invitationRejected') });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('invitationProcessError') });
  }
});

// Пригласить участника в команду (создаём pending)
router.post('/', async (req, res) => {
  try {
    const { email } = req.body;

    const { rows: [owner] } = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [req.userId]);
    if (owner.email === email) {
      return res.status(400).json({ error: req.t('cannotAddSelf') });
    }

    const { rows: users } = await pool.query(
      'SELECT id, name, email, language FROM users WHERE email = $1', [email]
    );
    if (users.length === 0) {
      return res.status(404).json({ error: req.t('userWithEmailNotFound') });
    }
    const member = users[0];

    const { rows: existing } = await pool.query(
      'SELECT id, status FROM team_members WHERE owner_id = $1 AND member_id = $2',
      [req.userId, member.id]
    );
    if (existing.length > 0) {
      const key = existing[0].status === 'pending' ? 'teamInvitePending' : 'alreadyInTeam';
      return res.status(400).json({ error: req.t(key) });
    }

    await pool.query(
      `INSERT INTO team_members (owner_id, member_id, status, inviter_name) VALUES ($1, $2, 'pending', $3)`,
      [req.userId, member.id, owner.name]
    );

    // Отправляем письмо
    sendTeamInvitation(member, owner.name)
      .catch(err => console.error('Ошибка отправки письма приглашения в команду:', err));

    res.status(201).json({
      message: req.t('invitationSent'),
      member: { id: member.id, name: member.name, email: member.email }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('invitationSendError') });
  }
});

// Удалить участника из команды
router.delete('/:memberId', async (req, res) => {
  try {
    const { memberId } = req.params;
    await withTransaction(async (client) => {
      await client.query(
        'DELETE FROM team_members WHERE owner_id = $1 AND member_id = $2', [req.userId, memberId]
      );
      await client.query(`
        DELETE FROM project_members
        WHERE user_id = $2 AND project_id IN (SELECT id FROM projects WHERE owner_id = $1)
      `, [req.userId, memberId]);
    });
    res.json({ message: req.t('memberRemovedFromTeam') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('memberRemoveError') });
  }
});

module.exports = router;
