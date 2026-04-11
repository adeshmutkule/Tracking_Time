# Smart Work Time Tracker

A server-rendered Node.js time-tracking app using Express, EJS, body-parser, and MySQL.

## Tech Stack

- Node.js
- Express.js
- body-parser
- EJS
- MySQL
- Bootstrap

## 1. Create Database

Run this SQL in MySQL:

```sql
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
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
```

## 2. Install Dependencies

```bash
npm install
```

## 3. Configure Database Connection (Optional)

The app reads these environment variables (defaults shown):

- `DB_HOST=localhost`
- `DB_USER=root`
- `DB_PASSWORD=`
- `DB_NAME=work_tracker`
- `PORT=3000`

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

- `http://localhost:3000`

## Reports and Export

Open the Daily Report page from the dashboard and choose a date to filter sessions for that day.

The report page also supports:

- Excel download for the selected date or all dates
- PDF download for the selected date or all dates

## Routes

- `GET /`
- `POST /add-task`
- `GET /delete/:id`
- `GET /start/:id`
- `GET /pause/:id`
- `GET /resume/:id`
- `GET /end/:id`
- `GET /report`
- `GET /report/export/excel`
- `GET /report/export/pdf`

All actions use form submissions/URL routes and redirect with `res.redirect()`.
"# Tracking_Time_App" 
"# Tracking_Time_App" 
