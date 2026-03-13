-- Добавляем флаг верификации email
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified TINYINT(1) NOT NULL DEFAULT 0;

-- Таблица токенов верификации
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Существующих пользователей считаем верифицированными
UPDATE users SET is_verified = 1 WHERE is_verified = 0;
