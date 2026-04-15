const fs = require('fs');
const path = require('path');

const { pool } = require('../config/db');

function splitSqlStatements(sqlText) {
  const withoutLineComments = sqlText
    .split(/\r?\n/g)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  return withoutLineComments
    .split(/;\s*(?:\r?\n|$)/g)
    .map((part) => part.trim())
    .filter((part) => part);
}

async function run() {
  const relativeFile = process.argv[2];

  if (!relativeFile) {
    console.error('Usage: node migrations/run-sql-file.js migrations/recalculate-task-durations.sql');
    process.exit(1);
  }

  const absolutePath = path.resolve(process.cwd(), relativeFile);

  if (!fs.existsSync(absolutePath)) {
    console.error(`SQL file not found: ${absolutePath}`);
    process.exit(1);
  }

  const sqlText = fs.readFileSync(absolutePath, 'utf8');
  const statements = splitSqlStatements(sqlText);

  if (!statements.length) {
    console.log('No SQL statements found. Nothing to run.');
    await pool.end();
    return;
  }

  const connection = await pool.getConnection();

  try {
    for (const statement of statements) {
      await connection.query(statement);
    }

    console.log(`Migration executed successfully: ${relativeFile}`);
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

run();
