# Smart Work Time Tracker

Smart Work Time Tracker is a server-rendered web application for managing tasks, running timers, and generating daily reports.

The app supports multi-user authentication and isolates each user's tasks and logs.

## Stack

- Node.js + Express
- EJS templates
- MySQL (mysql2)
- Bootstrap + custom CSS
- ExcelJS and PDFKit for exports

## 1. Create Database

Run this SQL in MySQL:

```sql
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
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NULL,
  duration INT NOT NULL DEFAULT 0,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
```

## 2. Install Dependencies

```bash
npm install
```

## 3. Configure Environment

The app reads these environment variables:

- DB_HOST=localhost
- DB_USER=root
- DB_PASSWORD=
- DB_NAME=work_tracker
- PORT=3000
- SESSION_SECRET=simple-session-secret

Example (PowerShell):

```powershell
$env:DB_HOST="localhost"
$env:DB_USER="root"
$env:DB_PASSWORD="your_password"
$env:DB_NAME="work_tracker"
$env:PORT="3000"
```

## 4. Run Project

```bash
npm start
```

Then open:

- http://localhost:3000

For development mode:

```bash
npm run dev
```

## Features

- Add tasks with start time
- Start, pause, resume, and end task sessions
- Edit task details and latest session time
- Filter tasks by date, status, and text search
- Daily report with total duration
- Export selected date report to Excel and PDF

## Reports and Export

Open the Daily Report page from the dashboard and choose a date to filter sessions for that day.

The report page also supports:

- Excel download for the selected date or all dates
- PDF download for the selected date or all dates

## Main Routes

- GET /
- GET /signup
- POST /signup
- GET /login
- POST /login
- GET /logout
- GET /tasks
- POST /add-task
- GET /task/:id/edit
- POST /task/:id/edit
- GET /delete/:id
- GET /start/:id
- GET /pause/:id
- GET /resume/:id
- GET /end/:id
- GET /report
- GET /report/export/excel
- GET /report/export/pdf

All actions are server-rendered and redirect-based.
