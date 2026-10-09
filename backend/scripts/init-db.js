// Создаёт/обновляет таблицы в PostgreSQL по database-init.sql
// Запуск: npm run db:init
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../database-init.sql'), 'utf8');
  try {
    await pool.query(sql);
    const { rows } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    console.log('✅ Схема применена. Таблицы:', rows.map(r => r.table_name).join(', '));
  } catch (err) {
    console.error('❌ Ошибка применения схемы:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
