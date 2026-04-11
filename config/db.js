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
  await pool.query(
    `CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      full_name VARCHAR(120) NOT NULL,
      email VARCHAR(190) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  );

  const [userCountRows] = await pool.query('SELECT COUNT(*) AS total FROM users');

  if (Number(userCountRows[0]?.total || 0) === 0) {
    await pool.query(
      'INSERT INTO users (full_name, email, password) VALUES (?, ?, ?)',
      ['Default User', 'default@local.test', '1234']
    );
  }

  const [userIdColumnRows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'tasks'
       AND COLUMN_NAME = 'user_id'`
  );

  if (Number(userIdColumnRows[0]?.total || 0) === 0) {
    const [defaultUserRows] = await pool.query(
      'SELECT id FROM users ORDER BY id ASC LIMIT 1'
    );
    const defaultUserId = Number(defaultUserRows[0]?.id || 1);

    await pool.query('ALTER TABLE tasks ADD COLUMN user_id INT NULL AFTER id');
    await pool.query('UPDATE tasks SET user_id = ? WHERE user_id IS NULL', [defaultUserId]);
    await pool.query('ALTER TABLE tasks MODIFY COLUMN user_id INT NOT NULL');
    await pool.query('ALTER TABLE tasks ADD INDEX idx_tasks_user_id (user_id)');
    await pool.query(
      `ALTER TABLE tasks
       ADD CONSTRAINT fk_tasks_user
       FOREIGN KEY (user_id) REFERENCES users(id)
       ON DELETE CASCADE`
    );
  }

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
