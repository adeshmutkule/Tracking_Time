const express = require('express');
const path = require('path');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const fileUpload = require('express-fileupload');

const { ensureSchema } = require('./config/db');
const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');
const reportRoutes = require('./routes/report');

const app = express();
const PORT = process.env.PORT || 3000;

// Session configuration
const sessionCookieName = 'sessionId';
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});
const sessionCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Lax',
  maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
};

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.disable('x-powered-by');
app.set('view cache', process.env.NODE_ENV === 'production');

app.use(express.urlencoded({ extended: true }));
app.use(
  fileUpload({
    limits: { fileSize: 2 * 1024 * 1024 },
    abortOnLimit: true,
    createParentPath: true,
    useTempFiles: false
  })
);
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    name: sessionCookieName,
    secret: process.env.SESSION_SECRET || 'simple-session-secret',
    store: sessionStore,
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

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();
