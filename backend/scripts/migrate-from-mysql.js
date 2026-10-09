// Перенос данных из старой MySQL-базы в PostgreSQL (одноразово).
//
// Запуск (схема в Postgres уже должна быть создана: npm run db:init):
//   npm install --no-save mysql2
//   MYSQL_HOST=127.0.0.1 MYSQL_USER=taskuser MYSQL_PASSWORD=... MYSQL_DATABASE=taskmanager \
//     node scripts/migrate-from-mysql.js [--dry-run] [--force]
//
//   --dry-run  только прочитать MySQL и показать количество строк
//   --force    очистить таблицы в Postgres перед переносом (иначе скрипт откажется, если там есть данные)
//
// id сохраняются, последовательности (SERIAL) сдвигаются на MAX(id).
const pool = require('../config/database');

const TABLES = [
  'users',
  'email_verification_tokens',
  'password_reset_tokens',
  'projects',
  'project_members',
  'team_members',
  'statuses',
  'tasks',
  'task_assignees',
  'task_dependencies',
  'task_attachments',
  'report_tokens',
  'task_reports'
];

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');

async function main() {
  let mysql;
  try {
    mysql = require('mysql2/promise');
  } catch {
    throw new Error('Нужен пакет mysql2: npm install --no-save mysql2');
  }

  const my = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || 'taskmanager',
    dateStrings: true, // DATE/DATETIME строками — без сдвигов часового пояса
    timezone: 'Z'
  });
  await my.query("SET time_zone = '+00:00'");

  const [myTablesRows] = await my.query('SHOW TABLES');
  const myTables = new Set(myTablesRows.map(r => Object.values(r)[0]));

  // Читаем всё из MySQL
  const data = {};
  for (const table of TABLES) {
    if (!myTables.has(table)) { data[table] = []; continue; }
    const [rows] = await my.query(`SELECT * FROM \`${table}\` ORDER BY id`);
    data[table] = rows;
  }
  await my.end();

  console.log('MySQL:', TABLES.map(t => `${t}=${data[t].length}`).join(', '));
  if (DRY_RUN) return;

  const { rows: existingTables } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
  );
  const pgTables = new Set(existingTables.map(r => r.table_name));
  const missing = TABLES.filter(t => !pgTables.has(t));
  if (missing.length) throw new Error(`В Postgres нет таблиц: ${missing.join(', ')}. Сначала: npm run db:init`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL TIME ZONE 'UTC'");

    const { rows: [{ total }] } = await client.query(
      `SELECT (${TABLES.map(t => `(SELECT COUNT(*) FROM ${t})`).join(' + ')})::int AS total`
    );
    if (total > 0) {
      if (!FORCE) throw new Error('В Postgres уже есть данные. Запустите с --force, чтобы перезаписать.');
      await client.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    }

    for (const table of TABLES) {
      const { rows: columns } = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1
      `, [table]);
      const colInfo = Object.fromEntries(columns.map(c => [c.column_name, c]));

      let inserted = 0;
      for (const row of data[table]) {
        const record = {};
        for (const [key, raw] of Object.entries(row)) {
          const col = colInfo[key];
          if (!col) continue; // колонки, которой нет в новой схеме
          let value = raw;
          if (col.data_type.startsWith('timestamp') && typeof value === 'string' && value.startsWith('0000')) value = null;
          if (value === null && col.is_nullable === 'NO' && col.column_default !== null) continue; // возьмём DEFAULT
          if (col.data_type === 'boolean' && value !== null) value = Boolean(Number(value));
          if (table === 'users' && key === 'language' && !['ru', 'en'].includes(value)) value = 'ru';
          record[key] = value;
        }
        const keys = Object.keys(record);
        const { rowCount } = await client.query(
          `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})
           ON CONFLICT DO NOTHING`,
          keys.map(k => record[k])
        );
        inserted += rowCount;
      }

      await client.query(
        `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`,
        [table]
      );
      const skipped = data[table].length - inserted;
      console.log(`  ${table}: ${inserted}${skipped ? ` (пропущено дублей: ${skipped})` : ''}`);
    }

    await client.query('COMMIT');
    console.log('✅ Перенос завершён');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch(err => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
