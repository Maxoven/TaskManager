const { Pool, types } = require('pg');
require('dotenv').config();

// DATE (oid 1082) отдаём строкой 'YYYY-MM-DD', а не JS Date:
// иначе дата сдвигается на день из-за часового пояса сервера при сериализации в JSON.
types.setTypeParser(1082, (value) => value);

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        max: 10,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
      }
);

pool.on('error', (err) => {
  console.error('❌ Ошибка соединения с PostgreSQL:', err.message);
});

pool.query('SELECT 1')
  .then(() => console.log('✅ Подключение к PostgreSQL установлено'))
  .catch(err => console.error('❌ Ошибка подключения к PostgreSQL:', err.message));

// Выполнить несколько запросов в одной транзакции
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = pool;
module.exports.withTransaction = withTransaction;
