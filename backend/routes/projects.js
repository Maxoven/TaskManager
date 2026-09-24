const express = require('express');
const pool = require('../config/database');
const { withTransaction } = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { sendProjectInvitation } = require('../services/email');

const router = express.Router();
router.use(authMiddleware);

// Проверка доступа к проекту: владелец или подтверждённый участник
const PROJECT_ACCESS_SQL = `
  SELECT p.* FROM projects p
  WHERE p.id = $1 AND (
    p.owner_id = $2 OR EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'approved'
    )
  )
`;

// Получить все проекты пользователя — сгруппированные по владельцу
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, u.name AS owner_name,
        CASE WHEN p.owner_id = $1 THEN 'owner' ELSE 'member' END AS role,
        COALESCE(st.tasks_total, 0) AS tasks_total,
        COALESCE(st.tasks_done, 0) AS tasks_done,
        COALESCE(st.tasks_overdue, 0) AS tasks_overdue
      FROM projects p
      LEFT JOIN users u ON p.owner_id = u.id
      -- Статистика для карточки: всего / выполнено (последняя колонка) / просрочено
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS tasks_total,
          COUNT(*) FILTER (WHERE s.position = last.position)::int AS tasks_done,
          COUNT(*) FILTER (WHERE t.end_date < CURRENT_DATE
                             AND (s.position IS NULL OR s.position <> last.position))::int AS tasks_overdue
        FROM tasks t
        LEFT JOIN statuses s ON s.id = t.status_id
        CROSS JOIN (SELECT MAX(position) AS position FROM statuses WHERE project_id = p.id) last
        WHERE t.project_id = p.id
      ) st ON TRUE
      WHERE p.owner_id = $1 OR EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = p.id AND pm.user_id = $1 AND pm.status = 'approved'
      )
      ORDER BY p.owner_id ASC, p.sort_order ASC, p.created_at DESC
    `, [req.userId]);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('projectsFetchError') });
  }
});

// Создать проект (вместе с колонками по умолчанию на языке пользователя)
router.post('/', async (req, res) => {
  try {
    const { name, description } = req.body;
    const statusNames = req.t('defaultStatuses');

    const project = await withTransaction(async (client) => {
      const { rows: [created] } = await client.query(`
        INSERT INTO projects (name, description, owner_id, sort_order)
        VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM projects WHERE owner_id = $3))
        RETURNING *
      `, [name, description, req.userId]);

      await client.query(`
        INSERT INTO statuses (project_id, name, position)
        SELECT $1, s.name, s.position FROM unnest($2::text[]) WITH ORDINALITY AS s(name, position)
      `, [created.id, statusNames]);

      // Участники команды получают доступ ко всем проектам владельца, включая новые
      await client.query(`
        INSERT INTO project_members (project_id, user_id, status)
        SELECT $1, member_id, 'approved' FROM team_members
        WHERE owner_id = $2 AND status = 'approved'
        ON CONFLICT (project_id, user_id) DO NOTHING
      `, [created.id, req.userId]);

      return created;
    });

    res.status(201).json(project);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('projectCreateError') });
  }
});

// Обновить проект (название, описание)
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const { rows: updated } = await pool.query(
      'UPDATE projects SET name = $1, description = $2 WHERE id = $3 AND owner_id = $4 RETURNING *',
      [name, description, id, req.userId]
    );
    if (updated.length === 0) {
      return res.status(403).json({ error: req.t('onlyOwnerEdit') });
    }
    res.json(updated[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('projectUpdateError') });
  }
});

// Изменить порядок проектов
router.post('/reorder', async (req, res) => {
  try {
    const { projectIds } = req.body; // массив id в новом порядке
    if (!Array.isArray(projectIds)) {
      return res.status(400).json({ error: req.t('projectIdsArray') });
    }
    await pool.query(`
      UPDATE projects p SET sort_order = o.position
      FROM unnest($1::int[]) WITH ORDINALITY AS o(id, position)
      WHERE p.id = o.id AND p.owner_id = $2
    `, [projectIds, req.userId]);
    res.json({ message: req.t('orderSaved') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('orderError') });
  }
});

// Удалить проект
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query(
      'DELETE FROM projects WHERE id = $1 AND owner_id = $2', [id, req.userId]
    );
    if (rowCount === 0) {
      return res.status(403).json({ error: req.t('onlyOwnerDelete') });
    }
    res.json({ message: req.t('projectDeleted') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('projectDeleteError') });
  }
});

// Получить приглашения (до /:id, чтобы не перехватывалось)
router.get('/invitations/pending', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, u.name AS owner_name, pm.invited_at
      FROM project_members pm
      JOIN projects p ON pm.project_id = p.id
      JOIN users u ON p.owner_id = u.id
      WHERE pm.user_id = $1 AND pm.status = 'pending'
      ORDER BY pm.invited_at DESC
    `, [req.userId]);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('invitationsFetchError') });
  }
});

// Получить один проект со всеми данными
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: access } = await pool.query(PROJECT_ACCESS_SQL, [id, req.userId]);
    if (access.length === 0) {
      return res.status(403).json({ error: req.t('accessDenied') });
    }

    const { rows: statuses } = await pool.query(
      'SELECT * FROM statuses WHERE project_id = $1 ORDER BY position', [id]
    );

    const { rows: tasks } = await pool.query(`
      SELECT t.id, t.project_id, t.status_id, t.title, t.description,
        t.start_date, t.end_date, t.created_at, t.updated_at,
        COALESCE((
          SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'email', u.email) ORDER BY u.name)
          FROM task_assignees ta JOIN users u ON ta.user_id = u.id
          WHERE ta.task_id = t.id
        ), '[]') AS assignees,
        (SELECT COUNT(*)::int FROM task_attachments f WHERE f.task_id = t.id) AS attachments_count,
        EXISTS (SELECT 1 FROM task_reports tr WHERE tr.task_id = t.id) AS has_report,
        COALESCE((
          SELECT json_agg(json_build_object(
            'task_id', d.task_id,
            'depends_on_task_id', d.depends_on_task_id,
            'dependency_type', d.dependency_type
          ))
          FROM task_dependencies d WHERE d.task_id = t.id
        ), '[]') AS dependencies
      FROM tasks t
      WHERE t.project_id = $1
      ORDER BY t.created_at DESC
    `, [id]);

    const { rows: members } = await pool.query(`
      SELECT u.id, u.name, u.email, pm.status, pm.invited_at,
        CASE WHEN p.owner_id = u.id THEN 1 ELSE 0 END AS is_owner,
        CASE WHEN tm.id IS NOT NULL THEN 'team' ELSE 'project' END AS source
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      JOIN projects p ON pm.project_id = p.id
      LEFT JOIN team_members tm ON tm.owner_id = p.owner_id AND tm.member_id = u.id AND tm.status = 'approved'
      WHERE pm.project_id = $1 AND pm.user_id <> p.owner_id
      UNION ALL
      SELECT u.id, u.name, u.email, 'approved' AS status, p.created_at AS invited_at, 1 AS is_owner, 'owner' AS source
      FROM projects p
      JOIN users u ON p.owner_id = u.id
      WHERE p.id = $1
    `, [id]);

    res.json({ ...access[0], statuses, tasks, members });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('projectFetchError') });
  }
});

// Удалить участника из проекта
router.delete('/:id/members/:userId', async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { rows: projects } = await pool.query(
      'SELECT id FROM projects WHERE id = $1 AND owner_id = $2', [id, req.userId]
    );
    if (projects.length === 0) {
      return res.status(403).json({ error: req.t('onlyOwnerRemoveMembers') });
    }
    await pool.query(
      'DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [id, userId]
    );
    res.json({ message: req.t('memberRemovedFromProject') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('memberRemoveError') });
  }
});

// Пригласить пользователя
router.post('/:id/invite', async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;
    const { rows: projects } = await pool.query(
      'SELECT * FROM projects WHERE id = $1 AND owner_id = $2', [id, req.userId]
    );
    if (projects.length === 0) {
      return res.status(403).json({ error: req.t('onlyOwnerInvite') });
    }
    const { rows: users } = await pool.query(
      'SELECT id, name, email, language FROM users WHERE email = $1', [email]
    );
    if (users.length === 0) {
      return res.status(404).json({ error: req.t('userNotFound') });
    }
    const invitedUser = users[0];
    if (invitedUser.id === req.userId) {
      return res.status(400).json({ error: req.t('cannotInviteSelf') });
    }
    const { rows: existing } = await pool.query(
      'SELECT id FROM project_members WHERE project_id = $1 AND user_id = $2', [id, invitedUser.id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: req.t('userAlreadyInvited') });
    }
    await pool.query(
      'INSERT INTO project_members (project_id, user_id, status) VALUES ($1, $2, $3)',
      [id, invitedUser.id, 'pending']
    );

    // Получаем имя владельца и отправляем письмо
    const { rows: ownerRows } = await pool.query('SELECT name FROM users WHERE id = $1', [req.userId]);
    const inviterName = ownerRows[0]?.name || 'Task Manager';
    sendProjectInvitation(invitedUser, inviterName, projects[0].name)
      .catch(err => console.error('Ошибка отправки письма приглашения:', err));

    res.json({ message: req.t('invitationSent') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('invitationSendError') });
  }
});

// Принять/отклонить приглашение
router.patch('/:id/invitation/:action', async (req, res) => {
  try {
    const { id, action } = req.params;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: req.t('invalidAction') });
    }
    if (action === 'approve') {
      await pool.query(
        'UPDATE project_members SET status = $1 WHERE project_id = $2 AND user_id = $3',
        ['approved', id, req.userId]
      );
      res.json({ message: req.t('invitationAccepted') });
    } else {
      await pool.query(
        'DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [id, req.userId]
      );
      res.json({ message: req.t('invitationRejected') });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('invitationProcessError') });
  }
});

module.exports = router;
