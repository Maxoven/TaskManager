const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { withTransaction } = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { sendProjectInvitation } = require('../services/email');
const { canSeeProjectSql, teamSeesProjectSql, projectRoleSql, getProjectRole, getTeamRole, isManager } = require('../services/access');

const router = express.Router();
router.use(authMiddleware);

// Та же папка, что в routes/tasks.js
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../storage/uploads');

// Нечисловой id в адресе — это 404, а не ошибка SQL «invalid input syntax for integer»
const requireNumericParam = (req, res, next, value) => {
  if (!/^\d{1,9}$/.test(value)) return res.status(404).json({ error: req.t('notFound') });
  next();
};
router.param('id', requireNumericParam);
router.param('userId', requireNumericParam);

const cleanText = (value) => (typeof value === 'string' ? value.trim() : '');

// Проект + моя роль в нём; строки нет — доступа нет
const PROJECT_ACCESS_SQL = `
  SELECT p.*, t.name AS team_name, ${projectRoleSql('p', '$2')} AS my_role
  FROM projects p
  LEFT JOIN teams t ON t.id = p.team_id
  WHERE p.id = $1 AND ${canSeeProjectSql('p', '$2')}
`;

const VISIBILITIES = ['team', 'selected'];
const toIds = (value) => (Array.isArray(value) ? [...new Set(value.map(Number).filter(Number.isInteger))] : []);

// Записать, кто из команды видит проект с visibility = 'selected'. Берём только подтверждённых
// участников команды проекта; тот, кто меняет доступ, всегда остаётся в списке — иначе админ
// мог бы случайно закрыть проект от самого себя. Возвращает id тех, кто потерял доступ.
async function saveProjectAccess(db, projectId, teamId, visibility, memberIds, actorId) {
  const { rows: before } = await db.query(
    `SELECT tm.user_id FROM team_memberships tm, projects p
     WHERE p.id = $1 AND tm.team_id = p.team_id AND tm.status = 'approved' AND ${teamSeesProjectSql('p', 'tm.user_id')}`,
    [projectId]
  );
  await db.query('UPDATE projects SET visibility = $1 WHERE id = $2', [visibility, projectId]);
  await db.query('DELETE FROM project_access WHERE project_id = $1', [projectId]);
  if (visibility === 'selected') {
    await db.query(`
      INSERT INTO project_access (project_id, user_id)
      SELECT $1, tm.user_id FROM team_memberships tm
      WHERE tm.team_id = $2 AND tm.status = 'approved' AND tm.role <> 'owner'
        AND (tm.user_id = ANY($3::int[]) OR tm.user_id = $4)
      ON CONFLICT DO NOTHING
    `, [projectId, teamId, memberIds, actorId]);
  }
  const { rows: after } = await db.query(
    `SELECT tm.user_id FROM team_memberships tm, projects p
     WHERE p.id = $1 AND tm.team_id = p.team_id AND tm.status = 'approved' AND ${teamSeesProjectSql('p', 'tm.user_id')}`,
    [projectId]
  );
  const still = new Set(after.map(r => r.user_id));
  const lost = before.map(r => r.user_id).filter(id => !still.has(id));
  if (lost.length > 0) {
    // Потерявших доступ снимаем с задач проекта (если они не гости этого проекта)
    await db.query(`
      DELETE FROM task_assignees
      WHERE user_id = ANY($2::int[]) AND task_id IN (SELECT id FROM tasks WHERE project_id = $1)
        AND NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $1 AND pm.user_id = task_assignees.user_id AND pm.status = 'approved')
    `, [projectId, lost]);
  }
  return lost;
}

// Удалить с диска файлы задач проектов (записи в БД уходят каскадно)
function unlinkAttachments(attachments) {
  attachments.forEach(att => {
    fs.unlink(path.join(UPLOADS_DIR, att.filename), (err) => {
      if (err && err.code !== 'ENOENT') console.error('Не удалось удалить файл:', err.message);
    });
  });
}

// Все проекты, к которым у меня есть доступ: проекты моих команд и гостевые.
// Фронтенд показывает их по выбранной команде (team_id) или в разделе «Доступ к проектам» (my_role = guest).
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM (
        SELECT p.*, u.name AS owner_name, t.name AS team_name,
          ${projectRoleSql('p', '$1')} AS my_role,
          COALESCE(st.tasks_total, 0) AS tasks_total,
          COALESCE(st.tasks_done, 0) AS tasks_done,
          COALESCE(st.tasks_overdue, 0) AS tasks_overdue
        FROM projects p
        LEFT JOIN users u ON p.owner_id = u.id
        LEFT JOIN teams t ON t.id = p.team_id
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
      ) x
      WHERE x.my_role IS NOT NULL
      ORDER BY x.team_id ASC, x.sort_order ASC, x.created_at DESC
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
    const name = cleanText(req.body.name).slice(0, 255);
    const description = cleanText(req.body.description) || null;
    const teamId = Number(req.body.teamId);
    if (!name) {
      return res.status(400).json({ error: req.t('projectNameRequired') });
    }
    // Проекты создают владелец и админы команды
    if (!Number.isInteger(teamId) || !isManager(await getTeamRole(pool, teamId, req.userId))) {
      return res.status(403).json({ error: req.t('onlyAdminsCreateProjects') });
    }
    // Новый проект по умолчанию видят только отмеченные; «вся команда» — по выбору
    const visibility = VISIBILITIES.includes(req.body.visibility) ? req.body.visibility : 'selected';
    const memberIds = toIds(req.body.memberIds);
    const statusNames = req.t('defaultStatuses');

    const project = await withTransaction(async (client) => {
      const { rows: [created] } = await client.query(`
        INSERT INTO projects (name, description, owner_id, team_id, sort_order)
        VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM projects WHERE team_id = $4))
        RETURNING *
      `, [name, description, req.userId, teamId]);

      await client.query(`
        INSERT INTO statuses (project_id, name, position)
        SELECT $1, s.name, s.position FROM unnest($2::text[]) WITH ORDINALITY AS s(name, position)
      `, [created.id, statusNames]);

      await saveProjectAccess(client, created.id, teamId, visibility, memberIds, req.userId);
      return { ...created, visibility };
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
    const name = cleanText(req.body.name).slice(0, 255);
    const description = cleanText(req.body.description) || null;
    if (!name) {
      return res.status(400).json({ error: req.t('projectNameRequired') });
    }

    if (!isManager(await getProjectRole(pool, id, req.userId))) {
      return res.status(403).json({ error: req.t('onlyAdminsEdit') });
    }
    const { rows: updated } = await pool.query(
      'UPDATE projects SET name = $1, description = $2 WHERE id = $3 RETURNING *',
      [name, description, id]
    );
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
    if (!Array.isArray(projectIds) || !projectIds.every(Number.isInteger)) {
      return res.status(400).json({ error: req.t('projectIdsArray') });
    }
    await pool.query(`
      UPDATE projects p SET sort_order = o.position
      FROM unnest($1::int[]) WITH ORDINALITY AS o(id, position)
      WHERE p.id = o.id AND EXISTS (
        SELECT 1 FROM team_memberships tm
        WHERE tm.team_id = p.team_id AND tm.user_id = $2 AND tm.status = 'approved' AND tm.role IN ('owner', 'admin')
      )
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
    if (!isManager(await getProjectRole(pool, id, req.userId))) {
      return res.status(403).json({ error: req.t('onlyAdminsDelete') });
    }
    // Файлы задач каскадно удаляются из БД — запоминаем их, чтобы убрать и с диска
    const { rows: attachments } = await pool.query(`
      SELECT f.filename FROM task_attachments f
      JOIN tasks t ON t.id = f.task_id
      WHERE t.project_id = $1
    `, [id]);
    await pool.query('DELETE FROM projects WHERE id = $1', [id]);
    unlinkAttachments(attachments);
    res.json({ message: req.t('projectDeleted') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('projectDeleteError') });
  }
});

// Кто из команды видит проект: вся команда (всегда, включая новых) или только отмеченные
router.put('/:id/access', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isManager(await getProjectRole(pool, id, req.userId))) {
      return res.status(403).json({ error: req.t('onlyAdminsEdit') });
    }
    const visibility = req.body.visibility;
    if (!VISIBILITIES.includes(visibility)) return res.status(400).json({ error: req.t('visibilityInvalid') });
    const { rows: [project] } = await pool.query('SELECT team_id FROM projects WHERE id = $1', [id]);
    const lost = await withTransaction(client =>
      saveProjectAccess(client, id, project.team_id, visibility, toIds(req.body.memberIds), req.userId)
    );
    res.json({ message: req.t('accessSaved'), lost: lost.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('accessSaveError') });
  }
});

// Получить приглашения (до /:id, чтобы не перехватывалось)
router.get('/invitations/pending', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, u.name AS owner_name, t.name AS team_name, pm.invited_at
      FROM project_members pm
      JOIN projects p ON pm.project_id = p.id
      JOIN users u ON p.owner_id = u.id
      LEFT JOIN teams t ON t.id = p.team_id
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
          SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'avatar', u.avatar) ORDER BY u.name)
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

    // Участники: те из команды, кто видит проект, + гости, приглашённые только сюда
    const { rows: members } = await pool.query(`
      SELECT u.id, u.name, u.email, u.avatar, 'approved' AS status, tm.invited_at,
        tm.role, 'team' AS source, CASE WHEN tm.role = 'owner' THEN 1 ELSE 0 END AS is_owner
      FROM team_memberships tm
      JOIN users u ON u.id = tm.user_id
      JOIN projects p ON p.id = $1
      WHERE tm.team_id = $2 AND tm.status = 'approved' AND ${teamSeesProjectSql('p', 'tm.user_id')}
      UNION ALL
      SELECT u.id, u.name, u.email, u.avatar, pm.status, pm.invited_at,
        'guest' AS role, 'project' AS source, 0 AS is_owner
      FROM project_members pm
      JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = $1 AND NOT EXISTS (
        SELECT 1 FROM team_memberships tm2
        WHERE tm2.team_id = $2 AND tm2.user_id = pm.user_id AND tm2.status = 'approved'
      )
    `, [id, access[0].team_id]);

    // Тем, кто ведёт проект, — вся команда с отметкой «видит проект» (для галочек доступа)
    const canManage = isManager(access[0].my_role);
    const { rows: teamRoster } = !canManage ? { rows: [] } : await pool.query(`
      SELECT u.id, u.name, u.email, u.avatar, tm.role, ${teamSeesProjectSql('p', 'tm.user_id')} AS has_access
      FROM team_memberships tm
      JOIN users u ON u.id = tm.user_id
      JOIN projects p ON p.id = $1
      WHERE tm.team_id = $2 AND tm.status = 'approved'
      ORDER BY CASE tm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name
    `, [id, access[0].team_id]);

    res.json({ ...access[0], can_manage: canManage, statuses, tasks, members, team_roster: teamRoster });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('projectFetchError') });
  }
});

// Выйти из чужого проекта (участник сам покидает проект)
router.post('/:id/leave', async (req, res) => {
  try {
    const { id } = req.params;
    const role = await getProjectRole(pool, id, req.userId);
    // Тот же ответ, что и при отсутствии доступа, — не раскрываем существование чужих проектов
    if (!role) {
      return res.status(403).json({ error: req.t('accessDenied') });
    }
    // Участник команды выходит из команды целиком (в её настройках), а не из одного проекта
    if (role !== 'guest') {
      return res.status(400).json({ error: req.t('teamMemberCannotLeaveProject') });
    }
    const left = await withTransaction(async (client) => {
      const { rowCount } = await client.query(
        'DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [id, req.userId]
      );
      if (rowCount === 0) return false;
      // Снимаем себя с задач проекта — иначе напоминания продолжат приходить
      await client.query(`
        DELETE FROM task_assignees
        WHERE user_id = $2 AND task_id IN (SELECT id FROM tasks WHERE project_id = $1)
      `, [id, req.userId]);
      return true;
    });
    if (!left) {
      return res.status(403).json({ error: req.t('accessDenied') });
    }
    res.json({ message: req.t('leftProject') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: req.t('leaveError') });
  }
});

// Удалить участника из проекта
router.delete('/:id/members/:userId', async (req, res) => {
  try {
    const { id, userId } = req.params;
    if (!isManager(await getProjectRole(pool, id, req.userId))) {
      return res.status(403).json({ error: req.t('onlyAdminsRemoveMembers') });
    }
    // Здесь убирают только гостей проекта; участников команды — в настройках команды
    const targetRole = await getProjectRole(pool, id, userId);
    if (targetRole && targetRole !== 'guest') {
      return res.status(400).json({ error: req.t('removeTeamMemberInTeamSettings') });
    }
    await withTransaction(async (client) => {
      await client.query(
        'DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [id, userId]
      );
      // Снимаем с задач проекта — иначе бывший участник продолжит получать напоминания
      await client.query(`
        DELETE FROM task_assignees
        WHERE user_id = $2 AND task_id IN (SELECT id FROM tasks WHERE project_id = $1)
      `, [id, userId]);
    });
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
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!isManager(await getProjectRole(pool, id, req.userId))) {
      return res.status(403).json({ error: req.t('onlyAdminsInvite') });
    }
    const { rows: projects } = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    const { rows: users } = await pool.query(
      'SELECT id, name, email, language FROM users WHERE LOWER(email) = $1', [email]
    );
    if (users.length === 0) {
      return res.status(404).json({ error: req.t('userNotFound') });
    }
    const invitedUser = users[0];
    if (invitedUser.id === req.userId) {
      return res.status(400).json({ error: req.t('cannotInviteSelf') });
    }
    const { rows: inTeam } = await pool.query(
      `SELECT 1 FROM team_memberships WHERE team_id = $1 AND user_id = $2 AND status = 'approved'`,
      [projects[0].team_id, invitedUser.id]
    );
    if (inTeam.length > 0) {
      return res.status(400).json({ error: req.t('alreadyInTeamUseAccess') });
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

    // Получаем имя пригласившего и отправляем письмо
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
