-- Схема Task Manager для PostgreSQL
-- Скрипт идемпотентный: можно запускать повторно, существующие данные не трогает.
-- Запуск: npm run db:init   (или: psql -U taskuser -d taskmanager -f database-init.sql)

-- Пользователи
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    language VARCHAR(2) NOT NULL DEFAULT 'ru' CHECK (language IN ('ru', 'en')),
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Фото профиля: имя файла в storage/avatars (случайное — его нельзя угадать)
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR(64);

-- Токены подтверждения email
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Токены сброса пароля
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Проекты
CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    owner_id INT REFERENCES users(id) ON DELETE CASCADE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Участники проекта
CREATE TABLE IF NOT EXISTS project_members (
    id SERIAL PRIMARY KEY,
    project_id INT REFERENCES projects(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_member UNIQUE (project_id, user_id)
);

-- Статусы (колонки канбана). Статусы по умолчанию создаёт backend при создании проекта,
-- на языке пользователя (см. routes/projects.js).
CREATE TABLE IF NOT EXISTS statuses (
    id SERIAL PRIMARY KEY,
    project_id INT REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    position INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Задачи
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    project_id INT REFERENCES projects(id) ON DELETE CASCADE,
    status_id INT REFERENCES statuses(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Аналог MySQL "ON UPDATE CURRENT_TIMESTAMP"
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_set_updated_at ON tasks;
CREATE TRIGGER tasks_set_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Исполнители задач
CREATE TABLE IF NOT EXISTS task_assignees (
    id SERIAL PRIMARY KEY,
    task_id INT REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_assignee UNIQUE (task_id, user_id)
);

-- Связи между задачами
CREATE TABLE IF NOT EXISTS task_dependencies (
    id SERIAL PRIMARY KEY,
    task_id INT REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_task_id INT REFERENCES tasks(id) ON DELETE CASCADE,
    dependency_type VARCHAR(50) NOT NULL DEFAULT 'finish_to_start',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_dependency UNIQUE (task_id, depends_on_task_id),
    CONSTRAINT no_self_dependency CHECK (task_id <> depends_on_task_id)
);

-- Файлы задач
CREATE TABLE IF NOT EXISTS task_attachments (
    id SERIAL PRIMARY KEY,
    task_id INT REFERENCES tasks(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    file_size INT NOT NULL,
    uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Токены для отправки отчёта по magic link (создаёт планировщик в день дедлайна)
CREATE TABLE IF NOT EXISTS report_tokens (
    id SERIAL PRIMARY KEY,
    task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    deadline_notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    overdue_notified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Отчёты исполнителей
CREATE TABLE IF NOT EXISTS task_reports (
    id SERIAL PRIMARY KEY,
    task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    report_text TEXT NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_report UNIQUE (task_id, user_id)
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_statuses_project ON statuses(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status_id);
CREATE INDEX IF NOT EXISTS idx_tasks_end_date ON tasks(end_date);
CREATE INDEX IF NOT EXISTS idx_task_assignees_task ON task_assignees(task_id);
CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees(user_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id);
CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_report_tokens_task_user ON report_tokens(task_id, user_id);
CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);
-- Вход и приглашения ищут email без учёта регистра
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));

-- Переписка с ИИ-ассистентом. Сервер хранит последние 20 сообщений на пользователя
-- (см. routes/assistant.js).
CREATE TABLE IF NOT EXISTS ai_messages (
    id BIGSERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_user ON ai_messages(user_id, id);

-- ─── Команды ───────────────────────────────────────────────────────────────
-- Пользователь может состоять в нескольких командах и переключаться между ними.
-- Проекты принадлежат команде; доступ к проекту даёт членство в его команде.
-- Роли: owner — создатель (всё, включая удаление команды),
--       admin — создаёт и ведёт проекты, приглашает людей и меняет их роли,
--       member — видит проекты команды, создаёт и меняет задачи.
CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_memberships (
    id SERIAL PRIMARY KEY,
    team_id INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(10) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
    invited_by INT REFERENCES users(id) ON DELETE SET NULL,
    invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_team_membership UNIQUE (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_memberships_user ON team_memberships(user_id);

-- owner_id проекта остаётся как «кто создал»; права определяет роль в команде
ALTER TABLE projects ADD COLUMN IF NOT EXISTS team_id INT REFERENCES teams(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);

-- Переход со старой модели «одна глобальная команда на владельца» (таблица team_members).
-- Каждый владелец проектов получает свою команду; его проекты переходят в неё,
-- прежние участники становятся участниками (member) с теми же правами, что были.
-- Прямые приглашения в отдельный проект (project_members) остаются гостевым доступом.
-- Повторный запуск ничего не меняет: старая таблица переименовывается в team_members_legacy.
DO $$
DECLARE
    u RECORD;
    new_team INT;
    has_legacy BOOLEAN := to_regclass('public.team_members') IS NOT NULL;
BEGIN
    -- Запрос собирается строкой: после переименования team_members его нельзя упоминать напрямую
    FOR u IN EXECUTE
        'SELECT us.id, us.name, us.language FROM users us
         WHERE EXISTS (SELECT 1 FROM projects p WHERE p.owner_id = us.id AND p.team_id IS NULL)'
        || CASE WHEN has_legacy
                THEN ' OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.owner_id = us.id)'
                ELSE '' END
        || ' ORDER BY us.id'
    LOOP
        INSERT INTO teams (name, created_by)
        VALUES (CASE WHEN u.language = 'en' THEN u.name || '''s team' ELSE 'Команда ' || u.name END, u.id)
        RETURNING id INTO new_team;
        INSERT INTO team_memberships (team_id, user_id, role, status)
        VALUES (new_team, u.id, 'owner', 'approved');
        UPDATE projects SET team_id = new_team WHERE owner_id = u.id AND team_id IS NULL;

        IF has_legacy THEN
            EXECUTE 'INSERT INTO team_memberships (team_id, user_id, role, status, invited_by, invited_at)
                     SELECT $1, member_id, ''member'', status, owner_id, invited_at
                     FROM team_members WHERE owner_id = $2
                     ON CONFLICT (team_id, user_id) DO NOTHING'
                USING new_team, u.id;
            -- Доступ, выданный через команду, теперь даёт членство — гостевые записи не нужны
            EXECUTE 'DELETE FROM project_members pm
                     USING projects p, team_members tm
                     WHERE pm.project_id = p.id AND p.team_id = $1
                       AND tm.owner_id = $2 AND tm.member_id = pm.user_id AND tm.status = ''approved'''
                USING new_team, u.id;
        END IF;
    END LOOP;

    IF has_legacy THEN
        ALTER TABLE team_members RENAME TO team_members_legacy;
    END IF;
END $$;

-- ─── Кто видит проект внутри команды ──────────────────────────────────────
-- visibility = 'team'     — вся команда, включая тех, кто вступит позже (так работали все проекты до этой версии);
-- visibility = 'selected' — только отмеченные в project_access. Владелец команды видит все проекты всегда.
-- Существующие проекты получают 'team' (значение по умолчанию) — их доступ не меняется.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility VARCHAR(10) NOT NULL DEFAULT 'team';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_visibility_check') THEN
        ALTER TABLE projects ADD CONSTRAINT projects_visibility_check CHECK (visibility IN ('team', 'selected'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS project_access (
    project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_access_user ON project_access(user_id);
