const express = require('express');
const path = require('path');
const session = require('express-session');
const fileUpload = require('express-fileupload');

const { ensureSchema } = require('./config/db');
const { recalculateTaskDurations } = require('./migrations/recalculate-durations');
const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');
const reportRoutes = require('./routes/report');

const app = express();
const PORT = process.env.PORT || 3000;
const sessionCookie = {
  httpOnly: true,
  sameSite: process.env.SESSION_COOKIE_SAMESITE || 'lax'
};

if (process.env.SESSION_COOKIE_SECURE === 'true') {
  app.set('trust proxy', 1);
  sessionCookie.secure = true;
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.disable('x-powered-by');
app.set('view cache', process.env.NODE_ENV === 'production');

app.use(express.urlencoded({ extended: true }));
app.use(
  fileUpload({
    createParentPath: true,
    useTempFiles: false
  })
);
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'simple-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: sessionCookie
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

app.use('/', authRoutes);
app.use('/', taskRoutes);
app.use('/', reportRoutes);

app.use((req, res) => {
  if (req.session.user) {
    return res.redirect('/tasks');
  }

  return res.redirect('/login');
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  console.error('Unhandled server error:', error);

  return res.status(500).send('Something went wrong. Please try again.');
});

async function startServer() {
  try {
    await ensureSchema();

    if (process.env.AUTO_RUN_DURATION_MIGRATION === 'true') {
      await recalculateTaskDurations();
      console.log('Startup migration completed: task durations recalculated.');
    }

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();
