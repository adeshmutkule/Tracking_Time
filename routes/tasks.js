const express = require('express');

const { pool } = require('../config/db');
const {
  formatSeconds,
  buildRedirectMessage,
  normalizeReportDate,
  formatReportDate
} = require('../utils/formatters');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const TASK_LIST_PATH = '/tasks';
const APP_TIME_ZONE = process.env.APP_TIME_ZONE || 'Asia/Kolkata';

router.use(requireAuth);

function getDateTimePartsInAppTimeZone(dateValue = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(dateValue);

  const map = {};

  parts.forEach((part) => {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  });

  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second
  };
}

function getCurrentAppDateTime() {
  const { year, month, day, hour, minute, second } = getDateTimePartsInAppTimeZone();
  const safeHour = hour === '24' ? '00' : hour;
  return `${year}-${month}-${day} ${safeHour}:${minute}:${second}`;
}

function getCurrentAppDate() {
  const { year, month, day } = getDateTimePartsInAppTimeZone();
  return `${year}-${month}-${day}`;
}

function getCurrentUserId(req) {
  return Number(req.session.user?.id || 0);
}

function getTaskId(taskIdParam) {
  return Number(taskIdParam);
}

function ensureValidTaskIdOrRedirect(taskId, res) {
  if (taskId) {
    return true;
  }

  res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Invalid task ID.'));
  return false;
}

async function fetchTaskByUser(taskId, userId) {
  const [taskRows] = await pool.query('SELECT * FROM tasks WHERE id = ? AND user_id = ? LIMIT 1', [taskId, userId]);
  return taskRows[0] || null;
}

async function fetchOpenTaskLog(taskId, includeStartTime = false) {
  const columns = includeStartTime ? 'id, start_time' : 'id';
  const [activeRows] = await pool.query(
    `SELECT ${columns} FROM task_logs WHERE task_id = ? AND end_time IS NULL ORDER BY id DESC LIMIT 1`,
    [taskId]
  );

  return activeRows[0] || null;
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

function getLocalTodayDate() {
  return getCurrentAppDate();
}

async function refreshTaskTotalTime(taskId) {
  const [sumRows] = await pool.query(
    'SELECT IFNULL(SUM(duration), 0) AS total_time FROM task_logs WHERE task_id = ?',
    [taskId]
  );

  let totalTime = Number(sumRows[0].total_time || 0);
  // Ensure total_time is never negative
  if (totalTime < 0) {
    totalTime = 0;
  }
  await pool.query('UPDATE tasks SET total_time = ? WHERE id = ?', [totalTime, taskId]);
}

router.get('/', async (req, res) => {
  const userId = getCurrentUserId(req);
  const selectedDate = normalizeReportDate(req.query.date) || getLocalTodayDate();
  const appNow = getCurrentAppDateTime();
  const todayDate = getCurrentAppDate();

  try {
    const [suggestionRows] = await pool.query(
      `SELECT recent.task_name
       FROM (
         SELECT task_name, MAX(created_at) AS last_used_at
         FROM tasks
         WHERE user_id = ?
         GROUP BY task_name
       ) recent
       ORDER BY recent.last_used_at DESC
       LIMIT 8`,
      [userId]
    );

    const [todayTotalRows] = await pool.query(
      `SELECT
         COALESCE(
           SUM(
             CASE
               WHEN l.end_time IS NULL THEN GREATEST(TIMESTAMPDIFF(SECOND, l.start_time, ?), 0)
               ELSE GREATEST(IFNULL(l.duration, 0), 0)
             END
           ),
           0
         ) AS total_seconds,
         COALESCE(SUM(CASE WHEN l.end_time IS NULL THEN 1 ELSE 0 END), 0) AS active_session_count
       FROM task_logs l
       INNER JOIN tasks t ON t.id = l.task_id
       WHERE t.user_id = ? AND DATE(t.task_date) = ?`,
      [appNow, userId, todayDate]
    );

    const todayTotalSeconds = Number(todayTotalRows[0]?.total_seconds || 0);
    const activeSessionCount = Number(todayTotalRows[0]?.active_session_count || 0);

    return res.render('index', {
      selectedDate,
      formatSeconds,
      taskNameSuggestions: suggestionRows.map((row) => row.task_name).filter(Boolean),
      todayTotalSeconds,
      activeSessionCount,
      error: req.query.error || '',
      success: req.query.success || ''
    });
  } catch (error) {
    return res.status(500).send('Unable to load dashboard. Check database connection.');
  }
});

router.get('/tasks', async (req, res) => {
  const userId = getCurrentUserId(req);
  const selectedDate = normalizeReportDate(req.query.date) || getLocalTodayDate();
  const appNow = getCurrentAppDateTime();
  const rawStatus = String(req.query.status || 'all').trim().toLowerCase();
  const searchTerm = String(req.query.search || '').trim();
  const allowedStatuses = new Set(['all', 'idle', 'running', 'paused', 'completed']);
  const selectedStatus = allowedStatuses.has(rawStatus) ? rawStatus : 'all';

  try {
    const queryParams = [userId, selectedDate];
    const statusClause = selectedStatus === 'all' ? '' : ' AND t.status = ?';
    const searchClause = searchTerm ? ' AND t.task_name LIKE ?' : '';

    if (selectedStatus !== 'all') {
      queryParams.push(selectedStatus);
    }

    if (searchTerm) {
      queryParams.push(`%${searchTerm}%`);
    }

    queryParams.unshift(appNow);

    const [tasks] = await pool.query(
      `SELECT
         t.*,
         (
           SELECT TIME_FORMAT(l.start_time, '%H:%i')
           FROM task_logs l
           WHERE l.task_id = t.id
           ORDER BY l.id DESC
           LIMIT 1
         ) AS latest_start_time,
         (
           SELECT TIME_FORMAT(l.end_time, '%H:%i')
           FROM task_logs l
           WHERE l.task_id = t.id
           ORDER BY l.id DESC
           LIMIT 1
         ) AS latest_end_time,
         GREATEST(
           t.total_time + IFNULL(
             (
               SELECT SUM(GREATEST(TIMESTAMPDIFF(SECOND, l.start_time, ?), 0))
               FROM task_logs l
               WHERE l.task_id = t.id AND l.end_time IS NULL
             ),
             0
           ),
           0
         ) AS display_total_time
       FROM tasks t
       WHERE t.user_id = ? AND DATE(t.task_date) = ?${statusClause}${searchClause}
       ORDER BY t.created_at DESC, t.id DESC`,
      queryParams
    );

    res.render('tasks', {
      tasks,
      formatSeconds,
      formatReportDate,
      selectedDate,
      selectedStatus,
      searchTerm,
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
    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Task name cannot be empty.'));
  }

  if (!taskDate) {
    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Task date is required.'));
  }

  if (!startTime || !startDateTime) {
    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Valid start time is required.'));
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

    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'success', 'Task added and started successfully.'));
  } catch (error) {
    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Failed to add task.'));
  }
});

router.get('/task/:id/edit', async (req, res) => {
  const userId = getCurrentUserId(req);
  const taskId = Number(req.params.id);

  if (!taskId) {
    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Invalid task ID.'));
  }

  try {
    const [taskRows] = await pool.query('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);
    const task = taskRows[0];

    if (!task) {
      return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Task not found.'));
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
    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Unable to open edit form.'));
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
    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Invalid task ID.'));
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
        return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Task not found.'));
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
    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'success', 'Task updated successfully.'));
  } catch (error) {
    return res.redirect(buildRedirectMessage(`/task/${taskId}/edit`, 'error', 'Failed to update task.'));
  }
});

router.get('/delete/:id', async (req, res) => {
  const userId = getCurrentUserId(req);
  const taskId = getTaskId(req.params.id);

  if (!ensureValidTaskIdOrRedirect(taskId, res)) {
    return;
  }

  try {
    const task = await fetchTaskByUser(taskId, userId);

    if (!task) {
      return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Task not found.'));
    }

    await pool.query('DELETE FROM task_logs WHERE task_id = ?', [taskId]);
    await pool.query('DELETE FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);

    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'success', 'Task deleted successfully.'));
  } catch (error) {
    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Failed to delete task.'));
  }
});

router.get('/start/:id', async (req, res) => {
  const userId = getCurrentUserId(req);
  const taskId = getTaskId(req.params.id);

  if (!ensureValidTaskIdOrRedirect(taskId, res)) {
    return;
  }

  try {
    const task = await fetchTaskByUser(taskId, userId);

    if (!task) {
      return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Task not found.'));
    }

    if (task.status === 'running') {
      return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Task is already running.'));
    }

    if (task.status === 'completed') {
      return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Completed task cannot be started again.'));
    }

    const activeLog = await fetchOpenTaskLog(taskId);

    if (activeLog) {
      return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Only one active session is allowed per task.'));
    }

    const appNow = getCurrentAppDateTime();

    await pool.query('INSERT INTO task_logs (task_id, start_time) VALUES (?, ?)', [taskId, appNow]);
    await pool.query('UPDATE tasks SET status = ? WHERE id = ?', ['running', taskId]);

    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'success', 'Task started.'));
  } catch (error) {
    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Failed to start task.'));
  }
});

router.get('/pause/:id', async (req, res) => {
  const userId = getCurrentUserId(req);
  const taskId = getTaskId(req.params.id);

  if (!ensureValidTaskIdOrRedirect(taskId, res)) {
    return;
  }

  try {
    const task = await fetchTaskByUser(taskId, userId);

    if (!task) {
      return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Task not found.'));
    }

    if (task.status !== 'running') {
      return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Cannot pause a task that is not running.'));
    }

    const activeLog = await fetchOpenTaskLog(taskId, true);

    if (!activeLog) {
      return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'No active session to pause.'));
    }

    const logId = activeLog.id;
    const appNow = getCurrentAppDateTime();

    await pool.query(
      'UPDATE task_logs SET end_time = ?, duration = GREATEST(TIMESTAMPDIFF(SECOND, start_time, ?), 0) WHERE id = ?',
      [appNow, appNow, logId]
    );

    await refreshTaskTotalTime(taskId);
    await pool.query('UPDATE tasks SET status = ? WHERE id = ?', ['paused', taskId]);

    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'success', 'Task paused.'));
  } catch (error) {
    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Failed to pause task.'));
  }
});

router.get('/resume/:id', async (req, res) => {
  const userId = getCurrentUserId(req);
  const taskId = getTaskId(req.params.id);

  if (!ensureValidTaskIdOrRedirect(taskId, res)) {
    return;
  }

  try {
    const task = await fetchTaskByUser(taskId, userId);

    if (!task) {
      return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Task not found.'));
    }

    if (task.status === 'running') {
      return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Task is already running.'));
    }

    if (task.status !== 'paused') {
      return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Cannot resume a task that is not paused.'));
    }

    const activeLog = await fetchOpenTaskLog(taskId);

    if (activeLog) {
      return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Only one active session is allowed per task.'));
    }

    const appNow = getCurrentAppDateTime();

    await pool.query('INSERT INTO task_logs (task_id, start_time) VALUES (?, ?)', [taskId, appNow]);
    await pool.query('UPDATE tasks SET status = ? WHERE id = ?', ['running', taskId]);

    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'success', 'Task resumed.'));
  } catch (error) {
    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Failed to resume task.'));
  }
});

router.get('/end/:id', async (req, res) => {
  const userId = getCurrentUserId(req);
  const taskId = getTaskId(req.params.id);

  if (!ensureValidTaskIdOrRedirect(taskId, res)) {
    return;
  }

  try {
    const task = await fetchTaskByUser(taskId, userId);

    if (!task) {
      return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Task not found.'));
    }

    if (task.status === 'idle') {
      return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Cannot end a task that has not been started.'));
    }

    if (task.status === 'completed') {
      return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Task is already completed.'));
    }

    const activeLog = await fetchOpenTaskLog(taskId);

    if (activeLog) {
      const appNow = getCurrentAppDateTime();

      await pool.query(
        'UPDATE task_logs SET end_time = ?, duration = GREATEST(TIMESTAMPDIFF(SECOND, start_time, ?), 0) WHERE id = ?',
        [appNow, appNow, activeLog.id]
      );
    }

    await refreshTaskTotalTime(taskId);
    await pool.query('UPDATE tasks SET status = ? WHERE id = ?', ['completed', taskId]);

    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'success', 'Task ended and marked as completed.'));
  } catch (error) {
    return res.redirect(buildRedirectMessage(TASK_LIST_PATH, 'error', 'Failed to end task.'));
  }
});

module.exports = router;
