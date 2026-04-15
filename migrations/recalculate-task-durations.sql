-- Recalculate durations for historical records after timezone/timestamp fixes
-- Run this once on production DB.

START TRANSACTION;

-- 1) Rebuild duration for completed log entries.
UPDATE task_logs
SET duration = GREATEST(TIMESTAMPDIFF(SECOND, start_time, end_time), 0)
WHERE end_time IS NOT NULL;

-- 2) Keep open sessions at zero duration (live time is calculated dynamically).
UPDATE task_logs
SET duration = 0
WHERE end_time IS NULL;

-- 3) Rebuild each task total from logs.
UPDATE tasks t
LEFT JOIN (
  SELECT task_id, COALESCE(SUM(duration), 0) AS total_seconds
  FROM task_logs
  GROUP BY task_id
) l ON l.task_id = t.id
SET t.total_time = COALESCE(l.total_seconds, 0);

COMMIT;
