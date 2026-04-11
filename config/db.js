const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'b6birk9jserfwl5snuay-mysql.services.clever-cloud.com',
  user: process.env.DB_USER || 'uphcqrugzynhsltf',
  password: process.env.DB_PASSWORD || 'VEHRk304SVjsRRpndZmE',
  database: process.env.DB_NAME || 'b6birk9jserfwl5snuay',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function ensureSchema() {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'tasks'
       AND COLUMN_NAME = 'task_date'`
  );

  if (Number(rows[0]?.total || 0) === 0) {
    await pool.query('ALTER TABLE tasks ADD COLUMN task_date DATE NULL AFTER task_name');
    await pool.query('UPDATE tasks SET task_date = DATE(created_at) WHERE task_date IS NULL');
    await pool.query('ALTER TABLE tasks MODIFY COLUMN task_date DATE NOT NULL');
  }
}

module.exports = {
  pool,
  ensureSchema
};
