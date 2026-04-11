-- Smart Work Time Tracker - MySQL setup
-- Import this file in MySQL Workbench and execute.

CREATE DATABASE IF NOT EXISTS work_tracker;
USE work_tracker;

CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_name VARCHAR(255) NOT NULL,
  task_date DATE NOT NULL,
  status ENUM('idle', 'running', 'paused', 'completed') NOT NULL DEFAULT 'idle',
  total_time INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NULL,
  duration INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_task_logs_task
    FOREIGN KEY (task_id) REFERENCES tasks(id)
    ON DELETE CASCADE
);

-- Optional sample data (uncomment if needed)
-- INSERT INTO tasks (task_name, status, total_time) VALUES
-- ('Design UI', 'idle', 0),
-- ('Client Call', 'paused', 1200),
-- ('Bug Fix', 'completed', 3600);
--
-- INSERT INTO task_logs (task_id, start_time, end_time, duration) VALUES
-- (2, NOW() - INTERVAL 30 MINUTE, NOW() - INTERVAL 10 MINUTE, 1200),
-- (3, NOW() - INTERVAL 2 HOUR, NOW() - INTERVAL 1 HOUR, 3600);
