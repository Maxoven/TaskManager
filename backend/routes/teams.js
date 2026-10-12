const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { withTransaction } = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { sendTeamInvitation } = require('../services/email');
const { getTeamRole, isManager, canManageTeam, teamSeesProjectSql } = require('../services/access');

// Команды: пользователь может состоять в нескольких и переключаться между ними.
// Роли — owner (создатель: состав команды, роли, все проекты), admin (создаёт проекты и ведёт доступные ему),
// member (работает с задачами в доступных проектах).
const router = express.Router();
router.use(authMiddleware);

const requireNumericParam = (req, res, next, value) => {
  if (!/^\d{1,9}$/.test(value)) return res.status(404).json({ error: req.t('notFound') });
  next();
};
router.param('teamId', requireNumericParam);
router.param('userId', requireNumericParam);

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../storage/uploads');
const INVITE_ROLES = ['admin', 'member'];
const cleanName = (value) => (typeof value === 'string' ? value.trim().slice(0, 100) : '');

// Команды, где я подтверждённый участник, с моей ролью и счётчиками
async function listMyTeams(userId) {
  const { rows } = await pool.query(`
    SELECT t.id, t.name, t.created_by, tm.role,
      (SELECT u.name FROM team_memberships o JOIN users u ON u.id = o.user_id
       WHERE o.team_id = t.id AND o.role = 'owner' LIMIT 1) AS owner_name,
      (SELECT COUNT(*)::int FROM team_memberships m WHERE m.team_id = t.id AND m.status = 'approved') AS members_count,
      -- Считаем только проекты, которые видит сам пользователь
      (SELECT COUNT(*)::int FROM projects p WHERE p.team_id = t.id AND ${teamSeesProjectSql('p', '$1')}) AS projects_count
    FROM team_memberships tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = $1 AND tm.status = 'approved'
    ORDER BY (tm.role = 'owner') DESC, t.name
  `, [userId]);
  return rows;
}

async function createTeam(db, userId, name) {
  const { rows: [team] } = await db.query(
    'INSERT INTO teams (name, created_by) VALUES ($1, $2) RETURNING id, name, created_by', [name, userId]
  );
  await db.query(
    `INSERT INTO team_memberships (team_id, user_id, role, status) VALUES ($1, $2, 'owner', 'approved')`,
    [team.id, userId]
  );
  return team;
}

// Мои команды. У человека без единой команды создаём личную — чтобы было где завести проект.
router.get('/', async (req, res) => {
  try {
    let teams = await listMyTeams(req.userId);
    if (teams.length === 0) {
      const { rows: [me] } = await pool.query('SELECT name FROM users WHERE id = $1', [req.userId]);
      await withTransaction(async (client) => {
        // Два параллельных запроса не должны создать две личные команды
        await client.query('SELECT pg_advisory_xact_lock(4242, $1)', [req.userId]);
        const { rows: [{ count }] } = await client.query(
          `SELECT COUNT(*)::int AS count FROM team_memberships WHERE user_id = $1 AND status = 'approved'`, [req.userId]
        );
        if (count === 0) await createTeam(client, req.userId, req.t('defaultTeamName', { name: me.name }));
      });
      teams = await listMyTeams(req.userId);
    }
    res.json(teams);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('teamFetchError') });
  }
});

// Создать команду — я её владелец
router.post('/', async (req, res) => {
  try {
    const name = cleanName(req.body.name);
    if (!name) return res.status(400).json({ error: req.t('teamNameRequired') });
    const team = await withTransaction(client => createTeam(client, req.userId, name));
    res.status(201).json({ ...team, role: 'owner', members_count: 1, projects_count: 0 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('teamCreateError') });
  }
});

// Входящие приглашения в команды (до /:teamId, чтобы не перехватывалось)
router.get('/invitations', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT t.id AS team_id, t.name AS team_name, tm.role, tm.invited_at,
        inv.name AS inviter_name,
        (SELECT COUNT(*)::int FROM projects p WHERE p.team_id = t.id AND p.visibility = 'team') AS projects_count
      FROM team_memberships tm
      JOIN teams t ON t.id = tm.team_id
      LEFT JOIN users inv ON inv.id = tm.invited_by
      WHERE tm.user_id = $1 AND tm.status = 'pending'
      ORDER BY tm.invited_at DESC
    `, [req.userId]);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('invitationsFetchError') });
  }
});

// Принять или отклонить приглашение в команду
router.patch('/invitations/:teamId/:action', async (req, res) => {
  try {
    const { teamId, action } = req.params;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: req.t('invalidAction') });
    }
    const { rowCount } = action === 'approve'
      ? await pool.query(
        `UPDATE team_memberships SET status = 'approved' WHERE team_id = $1 AND user_id = $2 AND status = 'pending'`,
        [teamId, req.userId])
      : await pool.query(
        `DELETE FROM team_memberships WHERE team_id = $1 AND user_id = $2 AND status = 'pending'`,
        [teamId, req.userId]);
    if (rowCount === 0) return res.status(404).json({ error: req.t('invitationNotFound') });
    res.json({ message: req.t(action === 'approve' ? 'invitationAccepted' : 'invitationRejected') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('invitationProcessError') });
  }
});

// Команда и её состав — видно всем участникам; менять могут владелец и админы
router.get('/:teamId', async (req, res) => {
  try {
    const { teamId } = req.params;
    const role = await getTeamRole(pool, teamId, req.userId);
    if (!role) return res.status(403).json({ error: req.t('accessDenied') });
    const { rows: [team] } = await pool.query('SELECT id, name, created_by, created_at FROM teams WHERE id = $1', [teamId]);
    const { rows: members } = await pool.query(`
      SELECT u.id, u.name, u.email, u.avatar, tm.role, tm.status, tm.invited_at, inv.name AS invited_by_name
      FROM team_memberships tm
      JOIN users u ON u.id = tm.user_id
      LEFT JOIN users inv ON inv.id = tm.invited_by
      WHERE tm.team_id = $1
      ORDER BY tm.status = 'pending', CASE tm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name
    `, [teamId]);
    // Гости — приглашённые в отдельные проекты команды (видят только свой проект). Показываем тем, кто ведёт команду.
    const { rows: guests } = !canManageTeam(role) ? { rows: [] } : await pool.query(`
      SELECT u.id, u.name, u.email, u.avatar, pm.status, p.id AS project_id, p.name AS project_name
      FROM project_members pm
      JOIN projects p ON p.id = pm.project_id
      JOIN users u ON u.id = pm.user_id
      WHERE p.team_id = $1 AND NOT EXISTS (
        SELECT 1 FROM team_memberships tm WHERE tm.team_id = $1 AND tm.user_id = pm.user_id AND tm.status = 'approved'
      )
      ORDER BY u.name, p.name
    `, [teamId]);
    // can_manage — менять состав и роли (только владелец); can_create_projects — владелец и админы
    res.json({ ...team, role, can_manage: canManageTeam(role), can_create_projects: isManager(role), members, guests });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('teamFetchError') });
  }
});

// Переименовать команду — только владелец
router.patch('/:teamId', async (req, res) => {
  try {
    const { teamId } = req.params;
    if (!canManageTeam(await getTeamRole(pool, teamId, req.userId))) {
      return res.status(403).json({ error: req.t('onlyOwnerManageTeam') });
    }
    const name = cleanName(req.body.name);
    if (!name) return res.status(400).json({ error: req.t('teamNameRequired') });
    const { rows: [team] } = await pool.query('UPDATE teams SET name = $1 WHERE id = $2 RETURNING id, name', [name, teamId]);
    res.json(team);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('teamUpdateError') });
  }
});

// Удалить команду вместе с её проектами — только владелец
router.delete('/:teamId', async (req, res) => {
  try {
    const { teamId } = req.params;
    if ((await getTeamRole(pool, teamId, req.userId)) !== 'owner') {
      return res.status(403).json({ error: req.t('onlyOwnerDeleteTeam') });
    }
    const { rows: attachments } = await pool.query(`
      SELECT f.filename FROM task_attachments f
      JOIN tasks t ON t.id = f.task_id
      JOIN projects p ON p.id = t.project_id
      WHERE p.team_id = $1
    `, [teamId]);
    await pool.query('DELETE FROM teams WHERE id = $1', [teamId]);
    attachments.forEach(att => {
      fs.unlink(path.join(UPLOADS_DIR, att.filename), (err) => {
        if (err && err.code !== 'ENOENT') console.error('Не удалось удалить файл:', err.message);
      });
    });
    res.json({ message: req.t('teamDeleted') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('teamDeleteError') });
  }
});

// Пригласить в команду с ролью admin или member — только владелец
router.post('/:teamId/members', async (req, res) => {
  try {
    const { teamId } = req.params;
    if (!canManageTeam(await getTeamRole(pool, teamId, req.userId))) {
      return res.status(403).json({ error: req.t('onlyOwnerInviteToTeam') });
    }
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const role = INVITE_ROLES.includes(req.body.role) ? req.body.role : 'member';

    const { rows: users } = await pool.query(
      'SELECT id, name, email, language FROM users WHERE LOWER(email) = $1', [email]
    );
    if (users.length === 0) {
      return res.status(404).json({ error: req.t('userWithEmailNotFound') });
    }
    const member = users[0];
    if (member.id === req.userId) {
      return res.status(400).json({ error: req.t('cannotAddSelf') });
    }

    const { rows: existing } = await pool.query(
      'SELECT status FROM team_memberships WHERE team_id = $1 AND user_id = $2', [teamId, member.id]
    );
    if (existing.length > 0) {
      const key = existing[0].status === 'pending' ? 'teamInvitePending' : 'alreadyInTeam';
      return res.status(400).json({ error: req.t(key) });
    }

    await pool.query(
      `INSERT INTO team_memberships (team_id, user_id, role, status, invited_by) VALUES ($1, $2, $3, 'pending', $4)`,
      [teamId, member.id, role, req.userId]
    );

    const { rows: [info] } = await pool.query(`
      SELECT t.name AS team_name, u.name AS inviter_name FROM teams t, users u WHERE t.id = $1 AND u.id = $2
    `, [teamId, req.userId]);
    sendTeamInvitation(member, info.inviter_name, info.team_name, role)
      .catch(err => console.error('Ошибка отправки письма приглашения в команду:', err));

    res.status(201).json({
      message: req.t('invitationSent'),
      member: { id: member.id, name: member.name, email: member.email, role, status: 'pending' }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('invitationSendError') });
  }
});

// Сменить роль участника (admin ⇄ member). Роль владельца не меняется.
router.patch('/:teamId/members/:userId', async (req, res) => {
  try {
    const { teamId, userId } = req.params;
    if (!canManageTeam(await getTeamRole(pool, teamId, req.userId))) {
      return res.status(403).json({ error: req.t('onlyOwnerManageTeam') });
    }
    const role = req.body.role;
    if (!INVITE_ROLES.includes(role)) return res.status(400).json({ error: req.t('roleInvalid') });
    const { rowCount } = await pool.query(
      `UPDATE team_memberships SET role = $1 WHERE team_id = $2 AND user_id = $3 AND role <> 'owner'`,
      [role, teamId, userId]
    );
    if (rowCount === 0) return res.status(400).json({ error: req.t('cannotChangeOwnerRole') });
    res.json({ message: req.t('roleUpdated'), role });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('roleUpdateError') });
  }
});

// Убрать участника (или отменить приглашение). Себя — это «выйти из команды».
// Владельца убрать нельзя: команду он может только удалить.
router.delete('/:teamId/members/:userId', async (req, res) => {
  try {
    const { teamId } = req.params;
    const userId = Number(req.params.userId);
    const myRole = await getTeamRole(pool, teamId, req.userId);
    const self = userId === req.userId;
    if (!myRole) return res.status(403).json({ error: req.t('accessDenied') });
    if (!self && !canManageTeam(myRole)) return res.status(403).json({ error: req.t('onlyOwnerManageTeam') });

    const removed = await withTransaction(async (client) => {
      const { rowCount } = await client.query(
        `DELETE FROM team_memberships WHERE team_id = $1 AND user_id = $2 AND role <> 'owner'`, [teamId, userId]
      );
      if (rowCount === 0) return false;
      // Отметки «видит проект» в проектах этой команды больше не нужны
      await client.query(
        'DELETE FROM project_access WHERE user_id = $2 AND project_id IN (SELECT id FROM projects WHERE team_id = $1)',
        [teamId, userId]
      );
      // Снимаем с задач проектов команды — иначе бывший участник продолжит получать напоминания.
      // Гостевой доступ к отдельным проектам (если он был) сохраняется.
      await client.query(`
        DELETE FROM task_assignees
        WHERE user_id = $2 AND task_id IN (
          SELECT t.id FROM tasks t JOIN projects p ON p.id = t.project_id
          WHERE p.team_id = $1 AND NOT EXISTS (
            SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'approved'
          )
        )
      `, [teamId, userId]);
      return true;
    });
    if (!removed) {
      return res.status(400).json({ error: req.t(self ? 'ownerCannotLeaveTeam' : 'cannotRemoveOwner') });
    }
    res.json({ message: req.t(self ? 'leftTeam' : 'memberRemovedFromTeam') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('memberRemoveError') });
  }
});

module.exports = router;
