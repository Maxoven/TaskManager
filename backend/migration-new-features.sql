-- МИГРАЦИЯ ДЛЯ НОВЫХ ФИЧ
-- Запустить в phpMyAdmin ПОСЛЕ уже существующего database-init.sql

-- 1. Токены сброса пароля
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_token (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Отчёты по задачам
CREATE TABLE IF NOT EXISTS task_reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    task_id INT NOT NULL,
    user_id INT NOT NULL,
    report_text TEXT NOT NULL,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Токены для запроса отчётов (magic link в письме)
CREATE TABLE IF NOT EXISTS report_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    task_id INT NOT NULL,
    user_id INT NOT NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    deadline_notified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    overdue_notified TINYINT(1) DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_report_token (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Порядок сортировки проектов
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
UPDATE projects SET sort_order = id WHERE sort_order = 0;

-- 5. Обновляем триггер: Бэклог -> Планы
DELIMITER $$
DROP TRIGGER IF EXISTS create_project_statuses$$
CREATE TRIGGER create_project_statuses
AFTER INSERT ON projects
FOR EACH ROW
BEGIN
    INSERT INTO statuses (project_id, name, position) VALUES
        (NEW.id, 'Планы', 1),
        (NEW.id, 'В работе', 2),
        (NEW.id, 'Готово', 3);
END$$
DELIMITER ;

-- 6. Переименовываем существующие "Бэклог" -> "Планы"
UPDATE statuses SET name = 'Планы' WHERE name = 'Бэклог';
