const express = require('express');

const { pool } = require('../config/db');
const { requireGuest, requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/signup', requireGuest, (req, res) => {
  res.render('signup', {
    error: req.query.error || '',
    success: req.query.success || ''
  });
});

router.post('/signup', requireGuest, async (req, res) => {
  const fullName = String(req.body.full_name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '').trim();

  if (!fullName || !email || !password) {
    return res.redirect('/signup?error=Please fill all fields.');
  }

  try {
    const [existingUserRows] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);

    if (existingUserRows.length > 0) {
      return res.redirect('/signup?error=Email already registered.');
    }

    const [result] = await pool.query(
      'INSERT INTO users (full_name, email, password) VALUES (?, ?, ?)',
      [fullName, email, password]
    );

    req.session.user = {
      id: result.insertId,
      full_name: fullName,
      email
    };

    return res.redirect('/?success=Account created successfully.');
  } catch (error) {
    return res.redirect('/signup?error=Unable to create account.');
  }
});

router.get('/login', requireGuest, (req, res) => {
  res.render('login', {
    error: req.query.error || '',
    success: req.query.success || ''
  });
});

router.post('/login', requireGuest, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '').trim();

  if (!email || !password) {
    return res.redirect('/login?error=Email and password are required.');
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, full_name, email, password FROM users WHERE email = ? LIMIT 1',
      [email]
    );

    const user = rows[0];

    if (!user || user.password !== password) {
      return res.redirect('/login?error=Invalid email or password.');
    }

    req.session.user = {
      id: user.id,
      full_name: user.full_name,
      email: user.email
    };

    return res.redirect('/?success=Login successful.');
  } catch (error) {
    return res.redirect('/login?error=Unable to login.');
  }
});

router.get('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login?success=Logged out successfully.');
  });
});

module.exports = router;
