const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const { ensureSchema } = require('./config/db');
const taskRoutes = require('./routes/tasks');
const reportRoutes = require('./routes/report');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', taskRoutes);
app.use('/', reportRoutes);

async function startServer() {
  try {
    await ensureSchema();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();
