const { pool } = require('../config/db');

async function recalculateTaskDurations() {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.query(
      `UPDATE task_logs
       SET duration = GREATEST(TIMESTAMPDIFF(SECOND, start_time, end_time), 0)
       WHERE end_time IS NOT NULL`
    );

    await connection.query(
      `UPDATE task_logs
       SET duration = 0
       WHERE end_time IS NULL`
    );

    await connection.query(
      `UPDATE tasks t
       LEFT JOIN (
         SELECT task_id, COALESCE(SUM(duration), 0) AS total_seconds
         FROM task_logs
         GROUP BY task_id
       ) l ON l.task_id = t.id
       SET t.total_time = COALESCE(l.total_seconds, 0)`
    );

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  recalculateTaskDurations
};
