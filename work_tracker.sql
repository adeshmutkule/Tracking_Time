-- Smart Work Time Tracker - MySQL setup
-- Import this file in MySQL Workbench and execute.

CREATE DATABASE IF NOT EXISTS work_tracker;
USE work_tracker;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  task_name VARCHAR(255) NOT NULL,
  task_date DATE NOT NULL,
  status ENUM('idle', 'running', 'paused', 'completed') NOT NULL DEFAULT 'idle',
  total_time INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tasks_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
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
-- INSERT INTO users (full_name, email, password) VALUES
-- ('Demo User', 'demo@example.com', '1234');
--
-- INSERT INTO tasks (user_id, task_name, task_date, status, total_time) VALUES
-- (1, 'Design UI', CURDATE(), 'idle', 0),
-- (1, 'Client Call', CURDATE(), 'paused', 1200),
-- (1, 'Bug Fix', CURDATE(), 'completed', 3600);
--
-- INSERT INTO task_logs (task_id, start_time, end_time, duration) VALUES
-- (2, NOW() - INTERVAL 30 MINUTE, NOW() - INTERVAL 10 MINUTE, 1200),
-- (3, NOW() - INTERVAL 2 HOUR, NOW() - INTERVAL 1 HOUR, 3600);
