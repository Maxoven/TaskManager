-- Добавляем статус приглашения в команду
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS status ENUM('pending','approved') NOT NULL DEFAULT 'pending';
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS inviter_name VARCHAR(255) DEFAULT NULL;

-- Обновляем существующие записи как approved
UPDATE team_members SET status = 'approved' WHERE status = 'pending';
