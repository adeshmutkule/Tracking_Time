const express = require('express');

const { pool } = require('../config/db');
const {
  formatSeconds,
  buildRedirectMessage,
  normalizeReportDate
} = require('../utils/formatters');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

function getCurrentUserId(req) {
  return Number(req.session.user?.id || 0);
}

function normalizeTimeValue(timeValue) {
  const value = String(timeValue || '').trim();

  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
    return '';
  }

  return value;
}

function buildStartDateTime(taskDate, startTime) {
  if (!taskDate || !startTime) {
    return '';
  }

  return `${taskDate} ${startTime}:00`;
}

function buildEndDateTime(taskDate, endTime) {
  if (!taskDate || !endTime) {
    return '';
  }

  return `${taskDate} ${endTime}:00`;
}

function toTimeInputValue(dateValue) {
  if (!dateValue) {
    return '';
  }

  const parsed = new Date(dateValue);

  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
}

function toDateInputValue(dateValue) {
  if (!dateValue) {
    return '';
  }

  if (typeof dateValue === 'string') {
    const isoDate = dateValue.slice(0, 10);

    if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
      return isoDate;
    }
  }

  const parsed = new Date(dateValue);

  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function refreshTaskTotalTime(taskId) {
  const [sumRows] = await pool.query(
    'SELECT IFNULL(SUM(duration), 0) AS total_time FROM task_logs WHERE task_id = ?',
    [taskId]
  );

  const totalTime = Number(sumRows[0].total_time || 0);
  await pool.query('UPDATE tasks SET total_time = ? WHERE id = ?', [totalTime, taskId]);
}

router.get('/', async (req, res) => {
  const userId = getCurrentUserId(req);

  try {
    const [tasks] = await pool.query(
      'SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC, id DESC',
      [userId]
    );

    res.render('index', {
      tasks,
      formatSeconds,
      error: req.query.error || '',
      success: req.query.success || ''
    });
  } catch (error) {
    res.status(500).send('Unable to load dashboard. Check database connection.');
  }
});

router.post('/add-task', async (req, res) => {
  const userId = getCurrentUserId(req);
  const taskName = (req.body.task_name || '').trim();
  const taskDate = normalizeReportDate(req.body.task_date);
  const startTime = normalizeTimeValue(req.body.start_time);
  const startDateTime = buildStartDateTime(taskDate, startTime);

  if (!taskName) {
    return res.redirect(buildRedirectMessage('/', 'error', 'Task name cannot be empty.'));
  }

  if (!taskDate) {
    return res.redirect(buildRedirectMessage('/', 'error', 'Task date is required.'));
  }

  if (!startTime || !startDateTime) {
    return res.redirect(buildRedirectMessage('/', 'error', 'Valid start time is required.'));
  }

  try {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [taskResult] = await connection.query(
        'INSERT INTO tasks (user_id, task_name, task_date, status, total_time) VALUES (?, ?, ?, ?, ?)',
        [userId, taskName, taskDate, 'running', 0]
      );

      await connection.query('INSERT INTO task_logs (task_id, start_time) VALUES (?, ?)', [taskResult.insertId, startDateTime]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return res.redirect(buildRedirectMessage('/', 'success', 'Task added and started successfully.'));
  } catch (error) {
    return res.redirect(buildRedirectMessage('/', 'error', 'Failed to add task.'));
  }
});

router.get('/task/:id/edit', async (req, res) => {
  const userId = getCurrentUserId(req);
  const taskId = Number(req.params.id);

  if (!taskId) {
    return res.redirect(buildRedirectMessage('/', 'error', 'Invalid task ID.'));
  }

  try {
    const [taskRows] = await pool.query('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);
    const task = taskRows[0];

    if (!task) {
      return res.redirect(buildRedirectMessage('/', 'error', 'Task not found.'));
    }

    const [latestLogRows] = await pool.query(
      'SELECT id, start_time, end_time FROM task_logs WHERE task_id = ? ORDER BY id DESC LIMIT 1',
      [taskId]
    );

    res.render('edit-task', {
      task,
      latestLog: latestLogRows[0] || null,
      taskDateValue: toDateInputValue(task.task_date),
      startTimeValue: toTimeInputValue(latestLogRows[0]?.start_time),
      endTimeValue: toTimeInputValue(latestLogRows[0]?.end_time),
      error: req.query.error || ''
    });
  } catch (error) {
    return res.redirect(buildRedirectMessage('/', 'error', 'Unable to open edit form.'));
  }
});

router.post('/task/:id/edit', async (req, res) => {
  const userId = getCurrentUserId(req);
  const taskId = Number(req.params.id);
  const taskName = (req.body.task_name || '').trim();
  const taskDate = normalizeReportDate(req.body.task_date);
  const startTime = normalizeTimeValue(req.body.start_time);
  const hasEndTime = String(req.body.end_time || '').trim() !== '';
  const endTime = hasEndTime ? normalizeTimeValue(req.body.end_time) : '';
  const startDateTime = buildStartDateTime(taskDate, startTime);
  const endDateTime = buildEndDateTime(taskDate, endTime);

  if (!taskId) {
    return res.redirect(buildRedirectMessage('/', 'error', 'Invalid task ID.'));
  }

  if (!taskName) {
    return res.redirect(buildRedirectMessage(`/task/${taskId}/edit`, 'error', 'Task name cannot be empty.'));
  }

  if (!taskDate) {
    return res.redirect(buildRedirectMessage(`/task/${taskId}/edit`, 'error', 'Task date is required.'));
  }

  if (!startTime || !startDateTime) {
    return res.redirect(buildRedirectMessage(`/task/${taskId}/edit`, 'error', 'Valid start time is required.'));
  }

  if (hasEndTime && (!endTime || !endDateTime)) {
    return res.redirect(buildRedirectMessage(`/task/${taskId}/edit`, 'error', 'Valid end time is required.'));
  }

  if (hasEndTime && endDateTime < startDateTime) {
    return res.redirect(buildRedirectMessage(`/task/${taskId}/edit`, 'error', 'End time must be greater than or equal to start time.'));
  }

  try {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [taskRows] = await connection.query(
        'SELECT id FROM tasks WHERE id = ? AND user_id = ? FOR UPDATE',
        [taskId, userId]
      );

      if (!taskRows[0]) {
        await connection.rollback();
        return res.redirect(buildRedirectMessage('/', 'error', 'Task not found.'));
      }

      await connection.query('UPDATE tasks SET task_name = ?, task_date = ? WHERE id = ?', [taskName, taskDate, taskId]);

      const [latestLogRows] = await connection.query(
        'SELECT id, end_time FROM task_logs WHERE task_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
        [taskId]
      );

      if (latestLogRows[0]) {
        const effectiveEndDateTime = hasEndTime ? endDateTime : latestLogRows[0].end_time;

        await connection.query(
          `UPDATE task_logs
           SET start_time = ?,
               end_time = ?,
               duration = CASE
                 WHEN ? IS NULL THEN 0
                 ELSE GREATEST(TIMESTAMPDIFF(SECOND, ?, ?), 0)
               END
           WHERE id = ?`,
          [startDateTime, effectiveEndDateTime, effectiveEndDateTime, startDateTime, effectiveEndDateTime, latestLogRows[0].id]
        );
      } else {
        await connection.query(
          `INSERT INTO task_logs (task_id, start_time, end_time, duration)
           VALUES (?, ?, ?, CASE WHEN ? IS NULL THEN 0 ELSE GREATEST(TIMESTAMPDIFF(SECOND, ?, ?), 0) END)`,
          [taskId, startDateTime, hasEndTime ? endDateTime : null, hasEndTime ? endDateTime : null, startDateTime, hasEndTime ? endDateTime : null]
        );
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await refreshTaskTotalTime(taskId);
    return res.redirect(buildRedirectMessage('/', 'success', 'Task updated successfully.'));
  } catch (error) {
    return res.redirect(buildRedirectMessage(`/task/${taskId}/edit`, 'error', 'Failed to update task.'));
  }
});

router.get('/delete/:id', async (req, res) => {
  const userId = getCurrentUserId(req);
  const taskId = Number(req.params.id);

  if (!taskId) {
    return res.redirect(buildRedirectMessage('/', 'error', 'Invalid task ID.'));
  }

  try {
    const [taskRows] = await pool.query('SELECT id FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);

    if (!taskRows[0]) {
      return res.redirect(buildRedirectMessage('/', 'error', 'Task not found.'));
    }

    await pool.query('DELETE FROM task_logs WHERE task_id = ?', [taskId]);
    await pool.query('DELETE FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);

    return res.redirect(buildRedirectMessage('/', 'success', 'Task deleted successfully.'));
  } catch (error) {
    return res.redirect(buildRedirectMessage('/', 'error', 'Failed to delete task.'));
  }
});

router.get('/start/:id', async (req, res) => {
  const userId = getCurrentUserId(req);
  const taskId = Number(req.params.id);

  if (!taskId) {
    return res.redirect(buildRedirectMessage('/', 'error', 'Invalid task ID.'));
  }

  try {
    const [taskRows] = await pool.query('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);
    const task = taskRows[0];

    if (!task) {
      return res.redirect(buildRedirectMessage('/', 'error', 'Task not found.'));
    }

    if (task.status === 'running') {
      return res.redirect(buildRedirectMessage('/', 'error', 'Task is already running.'));
    }

    if (task.status === 'completed') {
      return res.redirect(buildRedirectMessage('/', 'error', 'Completed task cannot be started again.'));
    }

    const [activeRows] = await pool.query(
      'SELECT id FROM task_logs WHERE task_id = ? AND end_time IS NULL ORDER BY id DESC LIMIT 1',
      [taskId]
    );

    if (activeRows.length > 0) {
      return res.redirect(buildRedirectMessage('/', 'error', 'Only one active session is allowed per task.'));
    }

    await pool.query('INSERT INTO task_logs (task_id, start_time) VALUES (?, NOW())', [taskId]);
    await pool.query('UPDATE tasks SET status = ? WHERE id = ?', ['running', taskId]);

    return res.redirect(buildRedirectMessage('/', 'success', 'Task started.'));
  } catch (error) {
    return res.redirect(buildRedirectMessage('/', 'error', 'Failed to start task.'));
  }
});

router.get('/pause/:id', async (req, res) => {
  const userId = getCurrentUserId(req);
  const taskId = Number(req.params.id);

  if (!taskId) {
    return res.redirect(buildRedirectMessage('/', 'error', 'Invalid task ID.'));
  }

  try {
    const [taskRows] = await pool.query('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);
    const task = taskRows[0];

    if (!task) {
      return res.redirect(buildRedirectMessage('/', 'error', 'Task not found.'));
    }

    if (task.status !== 'running') {
      return res.redirect(buildRedirectMessage('/', 'error', 'Cannot pause a task that is not running.'));
    }

    const [activeRows] = await pool.query(
      'SELECT id, start_time FROM task_logs WHERE task_id = ? AND end_time IS NULL ORDER BY id DESC LIMIT 1',
      [taskId]
    );

    if (activeRows.length === 0) {
      return res.redirect(buildRedirectMessage('/', 'error', 'No active session to pause.'));
    }

    const logId = activeRows[0].id;

    await pool.query(
      'UPDATE task_logs SET end_time = NOW(), duration = TIMESTAMPDIFF(SECOND, start_time, NOW()) WHERE id = ?',
      [logId]
    );

    await refreshTaskTotalTime(taskId);
    await pool.query('UPDATE tasks SET status = ? WHERE id = ?', ['paused', taskId]);

    return res.redirect(buildRedirectMessage('/', 'success', 'Task paused.'));
  } catch (error) {
    return res.redirect(buildRedirectMessage('/', 'error', 'Failed to pause task.'));
  }
});

router.get('/resume/:id', async (req, res) => {
  const userId = getCurrentUserId(req);
  const taskId = Number(req.params.id);

  if (!taskId) {
    return res.redirect(buildRedirectMessage('/', 'error', 'Invalid task ID.'));
  }

  try {
    const [taskRows] = await pool.query('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);
    const task = taskRows[0];

    if (!task) {
      return res.redirect(buildRedirectMessage('/', 'error', 'Task not found.'));
    }

    if (task.status === 'running') {
      return res.redirect(buildRedirectMessage('/', 'error', 'Task is already running.'));
    }

    if (task.status !== 'paused') {
      return res.redirect(buildRedirectMessage('/', 'error', 'Cannot resume a task that is not paused.'));
    }

    const [activeRows] = await pool.query(
      'SELECT id FROM task_logs WHERE task_id = ? AND end_time IS NULL ORDER BY id DESC LIMIT 1',
      [taskId]
    );

    if (activeRows.length > 0) {
      return res.redirect(buildRedirectMessage('/', 'error', 'Only one active session is allowed per task.'));
    }

    await pool.query('INSERT INTO task_logs (task_id, start_time) VALUES (?, NOW())', [taskId]);
    await pool.query('UPDATE tasks SET status = ? WHERE id = ?', ['running', taskId]);

    return res.redirect(buildRedirectMessage('/', 'success', 'Task resumed.'));
  } catch (error) {
    return res.redirect(buildRedirectMessage('/', 'error', 'Failed to resume task.'));
  }
});

router.get('/end/:id', async (req, res) => {
  const userId = getCurrentUserId(req);
  const taskId = Number(req.params.id);

  if (!taskId) {
    return res.redirect(buildRedirectMessage('/', 'error', 'Invalid task ID.'));
  }

  try {
    const [taskRows] = await pool.query('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);
    const task = taskRows[0];

    if (!task) {
      return res.redirect(buildRedirectMessage('/', 'error', 'Task not found.'));
    }

    if (task.status === 'idle') {
      return res.redirect(buildRedirectMessage('/', 'error', 'Cannot end a task that has not been started.'));
    }

    if (task.status === 'completed') {
      return res.redirect(buildRedirectMessage('/', 'error', 'Task is already completed.'));
    }

    const [activeRows] = await pool.query(
      'SELECT id FROM task_logs WHERE task_id = ? AND end_time IS NULL ORDER BY id DESC LIMIT 1',
      [taskId]
    );

    if (activeRows.length > 0) {
      await pool.query(
        'UPDATE task_logs SET end_time = NOW(), duration = TIMESTAMPDIFF(SECOND, start_time, NOW()) WHERE id = ?',
        [activeRows[0].id]
      );
    }

    await refreshTaskTotalTime(taskId);
    await pool.query('UPDATE tasks SET status = ? WHERE id = ?', ['completed', taskId]);

    return res.redirect(buildRedirectMessage('/', 'success', 'Task ended and marked as completed.'));
  } catch (error) {
    return res.redirect(buildRedirectMessage('/', 'error', 'Failed to end task.'));
  }
});

module.exports = router;
