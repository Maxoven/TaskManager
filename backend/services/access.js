// Права доступа к проектам и командам — одно место для всех маршрутов.
//
// Проект принадлежит команде. Видеть проект и работать с задачами может
// подтверждённый участник команды (любая роль) или гость — человек, которого
// пригласили только в этот проект (project_members). Вести сам проект
// (переименовать, удалить, приглашать гостей) могут владелец и админы команды.

const MANAGER_ROLES = ['owner', 'admin'];

// SQL-условие «пользователь видит проект». p — псевдоним таблицы projects, u — параметр ($2 и т. п.)
const canSeeProjectSql = (p, u) => `(
  EXISTS (
    SELECT 1 FROM team_memberships tm_a
    WHERE tm_a.team_id = ${p}.team_id AND tm_a.user_id = ${u} AND tm_a.status = 'approved'
  ) OR EXISTS (
    SELECT 1 FROM project_members pm_a
    WHERE pm_a.project_id = ${p}.id AND pm_a.user_id = ${u} AND pm_a.status = 'approved'
  )
)`;

// Роль пользователя в проекте: owner / admin / member (через команду) или guest; NULL — нет доступа
const projectRoleSql = (p, u) => `COALESCE(
  (SELECT tm_r.role FROM team_memberships tm_r
   WHERE tm_r.team_id = ${p}.team_id AND tm_r.user_id = ${u} AND tm_r.status = 'approved'),
  (SELECT 'guest' FROM project_members pm_r
   WHERE pm_r.project_id = ${p}.id AND pm_r.user_id = ${u} AND pm_r.status = 'approved')
)`;

// Роль в проекте или null
async function getProjectRole(db, projectId, userId) {
  const { rows } = await db.query(
    `SELECT ${projectRoleSql('p', '$2')} AS role FROM projects p WHERE p.id = $1`,
    [projectId, userId]
  );
  return rows[0]?.role || null;
}

// Роль в команде (только подтверждённое членство) или null
async function getTeamRole(db, teamId, userId) {
  const { rows } = await db.query(
    `SELECT role FROM team_memberships WHERE team_id = $1 AND user_id = $2 AND status = 'approved'`,
    [teamId, userId]
  );
  return rows[0]?.role || null;
}

const isManager = (role) => MANAGER_ROLES.includes(role);

module.exports = { canSeeProjectSql, projectRoleSql, getProjectRole, getTeamRole, isManager, MANAGER_ROLES };
