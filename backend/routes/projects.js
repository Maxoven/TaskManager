const express = require('express');
const pool = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { sendProjectInvitation } = require('../services/email');

const router = express.Router();
router.use(authMiddleware);

// Получить все проекты пользователя — сгруппированные по владельцу
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT p.*, u.name as owner_name, u.id as owner_id,
      CASE WHEN p.owner_id = ? THEN 'owner' ELSE 'member' END as role
      FROM projects p
      LEFT JOIN users u ON p.owner_id = u.id
      LEFT JOIN project_members pm ON p.id = pm.project_id
      WHERE p.owner_id = ? OR (pm.user_id = ? AND pm.status = 'approved')
      ORDER BY p.owner_id ASC, p.sort_order ASC, p.created_at DESC
    `, [req.userId, req.userId, req.userId]);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения проектов' });
  }
});

// Создать проект
router.post('/', async (req, res) => {
  try {
    const { name, description } = req.body;
    // Получаем максимальный sort_order
    const [[maxRow]] = await pool.query('SELECT MAX(sort_order) as maxOrder FROM projects');
    const sortOrder = (maxRow.maxOrder || 0) + 1;

    const [result] = await pool.query(
      'INSERT INTO projects (name, description, owner_id, sort_order) VALUES (?, ?, ?, ?)',
      [name, description, req.userId, sortOrder]
    );
    const [projects] = await pool.query('SELECT * FROM projects WHERE id = ?', [result.insertId]);
    res.status(201).json(projects[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка создания проекта' });
  }
});

// Обновить проект (название, описание)
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const [projects] = await pool.query(
      'SELECT * FROM projects WHERE id = ? AND owner_id = ?',
      [id, req.userId]
    );
    if (projects.length === 0) {
      return res.status(403).json({ error: 'Только владелец может редактировать проект' });
    }

    await pool.query(
      'UPDATE projects SET name = ?, description = ? WHERE id = ?',
      [name, description, id]
    );
    const [updated] = await pool.query('SELECT * FROM projects WHERE id = ?', [id]);
    res.json(updated[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка обновления проекта' });
  }
});

// Изменить порядок проектов
router.post('/reorder', async (req, res) => {
  try {
    const { projectIds } = req.body; // массив id в новом порядке
    if (!Array.isArray(projectIds)) {
      return res.status(400).json({ error: 'projectIds должен быть массивом' });
    }
    const updates = projectIds.map((id, index) =>
      pool.query('UPDATE projects SET sort_order = ? WHERE id = ? AND owner_id = ?', [index, id, req.userId])
    );
    await Promise.all(updates);
    res.json({ message: 'Порядок обновлён' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка изменения порядка' });
  }
});

// Удалить проект
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [projects] = await pool.query(
      'SELECT * FROM projects WHERE id = ? AND owner_id = ?',
      [id, req.userId]
    );
    if (projects.length === 0) {
      return res.status(403).json({ error: 'Только владелец может удалить проект' });
    }
    await pool.query('DELETE FROM projects WHERE id = ?', [id]);
    res.json({ message: 'Проект удалён' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка удаления проекта' });
  }
});

// Получить один проект со всеми данными
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

    const [statuses] = await pool.query(
      'SELECT * FROM statuses WHERE project_id = ? ORDER BY position',
      [id]
    );
    
    const [tasksRaw] = await pool.query(`
      SELECT 
        t.*,
        GROUP_CONCAT(DISTINCT CONCAT(u.id, ':', u.name, ':', u.email) SEPARATOR '||') as assignees_raw,
        COUNT(DISTINCT ta_files.id) as attachments_count,
        (SELECT COUNT(*) FROM task_reports tr WHERE tr.task_id = t.id) as has_report
      FROM tasks t
      LEFT JOIN task_assignees ta ON t.id = ta.task_id
      LEFT JOIN users u ON ta.user_id = u.id
      LEFT JOIN task_attachments ta_files ON t.id = ta_files.task_id
      WHERE t.project_id = ?
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `, [id]);

    const tasks = tasksRaw.map(task => {
      const assignees = [];
      if (task.assignees_raw) {
        task.assignees_raw.split('||').forEach(str => {
          const [uid, name, email] = str.split(':');
          assignees.push({ id: parseInt(uid), name, email });
        });
      }
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
        attachments_count: parseInt(task.attachments_count) || 0,
        has_report: task.has_report > 0,
        dependencies: []
      };
    });

    const [dependencies] = await pool.query(`
      SELECT task_id, depends_on_task_id, dependency_type
      FROM task_dependencies
      WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)
    `, [id]);

    tasks.forEach(task => {
      task.dependencies = dependencies.filter(d => d.task_id === task.id);
    });
    
    const [members] = await pool.query(`
      SELECT u.id, u.name, u.email, pm.status, pm.invited_at,
        CASE WHEN p.owner_id = u.id THEN 1 ELSE 0 END as is_owner,
        CASE WHEN tm.id IS NOT NULL THEN 'team' ELSE 'project' END as source
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      JOIN projects p ON pm.project_id = p.id
      LEFT JOIN team_members tm ON tm.owner_id = p.owner_id AND tm.member_id = u.id AND tm.status = 'approved'
      WHERE pm.project_id = ?
      UNION
      SELECT u.id, u.name, u.email, 'approved' as status, p.created_at as invited_at, 1 as is_owner, 'owner' as source
      FROM projects p
      JOIN users u ON p.owner_id = u.id
      WHERE p.id = ?
    `, [id, id]);

    res.json({ ...access[0], statuses, tasks, members });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения проекта' });
  }
});

// Удалить участника из проекта
router.delete('/:id/members/:userId', async (req, res) => {
  try {
    const { id, userId } = req.params;
    const [projects] = await pool.query(
      'SELECT * FROM projects WHERE id = ? AND owner_id = ?',
      [id, req.userId]
    );
    if (projects.length === 0) {
      return res.status(403).json({ error: 'Только владелец может удалять участников' });
    }
    await pool.query(
      'DELETE FROM project_members WHERE project_id = ? AND user_id = ?',
      [id, userId]
    );
    res.json({ message: 'Участник удалён из проекта' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка удаления участника' });
  }
});

// Пригласить пользователя
router.post('/:id/invite', async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;
    const [projects] = await pool.query(
      'SELECT * FROM projects WHERE id = ? AND owner_id = ?',
      [id, req.userId]
    );
    if (projects.length === 0) {
      return res.status(403).json({ error: 'Только владелец может приглашать' });
    }
    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    const invitedUser = users[0];
    const [existing] = await pool.query(
      'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?',
      [id, invitedUser.id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Пользователь уже приглашён' });
    }
    await pool.query(
      'INSERT INTO project_members (project_id, user_id, status) VALUES (?, ?, ?)',
      [id, invitedUser.id, 'pending']
    );

    // Получаем имя владельца и отправляем письмо
    const [ownerRows] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId]);
    const inviterName = ownerRows[0]?.name || 'Пользователь';
    sendProjectInvitation(invitedUser.email, invitedUser.name, inviterName, projects[0].name)
      .catch(err => console.error('Ошибка отправки письма приглашения:', err));

    res.json({ message: 'Приглашение отправлено' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка отправки приглашения' });
  }
});

// Получить приглашения
router.get('/invitations/pending', async (req, res) => {
  try {
    const [invitations] = await pool.query(`
      SELECT p.*, u.name as owner_name, pm.invited_at
      FROM project_members pm
      JOIN projects p ON pm.project_id = p.id
      JOIN users u ON p.owner_id = u.id
      WHERE pm.user_id = ? AND pm.status = 'pending'
      ORDER BY pm.invited_at DESC
    `, [req.userId]);
    res.json(invitations);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка получения приглашений' });
  }
});

// Принять/отклонить приглашение
router.patch('/:id/invitation/:action', async (req, res) => {
  try {
    const { id, action } = req.params;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Неверное действие' });
    }
    if (action === 'approve') {
      await pool.query(
        'UPDATE project_members SET status = ? WHERE project_id = ? AND user_id = ?',
        ['approved', id, req.userId]
      );
      res.json({ message: 'Приглашение принято' });
    } else {
      await pool.query(
        'DELETE FROM project_members WHERE project_id = ? AND user_id = ?',
        [id, req.userId]
      );
      res.json({ message: 'Приглашение отклонено' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка обработки приглашения' });
  }
});

module.exports = router;
