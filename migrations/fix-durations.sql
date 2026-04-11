-- Fix negative durations and ensure data consistency
-- This migration corrects any corrupted duration values

-- Step 1: Fix any negative or NULL durations
UPDATE task_logs 
SET duration = GREATEST(TIMESTAMPDIFF(SECOND, start_time, COALESCE(end_time, NOW())), 0)
WHERE duration < 0 OR duration IS NULL;

-- Step 2: For logs with end_time before start_time, set end_time to NULL and duration to 0
-- (indicating still running)
UPDATE task_logs 
SET end_time = NULL, duration = 0 
WHERE end_time IS NOT NULL AND end_time < start_time;

-- Step 3: Recalculate all task total_time from scratch
UPDATE tasks t
SET total_time = (
  SELECT COALESCE(SUM(duration), 0)
  FROM task_logs tl
  WHERE tl.task_id = t.id AND tl.duration >= 0
)
WHERE total_time < 0 OR total_time IS NULL;

-- Verify the fixes
SELECT 
  t.id,
  t.task_name,
  t.total_time,
  COUNT(tl.id) as log_count,
  SUM(tl.duration) as calculated_total
FROM tasks t
LEFT JOIN task_logs tl ON t.id = tl.task_id
GROUP BY t.id, t.task_name, t.total_time
HAVING SUM(tl.duration) IS NULL OR SUM(tl.duration) != t.total_time
ORDER BY t.id DESC;
