const express = require('express');
const path = require('path');

const { pool } = require('../config/db');
const { requireGuest, requireAuth } = require('../middleware/auth');

const router = express.Router();
const sessionCookieName = process.env.SESSION_COOKIE_NAME || 'work_tracker.sid';

function createSession(req, userData, onSuccess, onFailure) {
  req.session.regenerate((regenerateError) => {
    if (regenerateError) {
      onFailure();
      return;
    }

    req.session.user = userData;
    req.session.save((saveError) => {
      if (saveError) {
        onFailure();
        return;
      }

      onSuccess();
    });
  });
}

function saveProfileImage(file) {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];

  if (!file || !file.name) {
    return { ok: true, path: null };
  }

  if (!allowedMimeTypes.includes(file.mimetype)) {
    return { ok: false, error: 'Only JPG, PNG, or WEBP images are allowed.' };
  }

  const fileExtByType = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp'
  };
  const safeFileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${fileExtByType[file.mimetype] || '.jpg'}`;
  const relativePath = `/uploads/profiles/${safeFileName}`;
  const absolutePath = path.join(__dirname, '..', 'public', 'uploads', 'profiles', safeFileName);

  return {
    ok: true,
    path: relativePath,
    move: () => file.mv(absolutePath)
  };
}

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
  const profileImage = req.files?.profile_image;

  if (!fullName || !email || !password) {
    return res.redirect('/signup?error=Please fill all fields.');
  }

  const uploadResult = saveProfileImage(profileImage);

  if (!uploadResult.ok) {
    return res.redirect(`/signup?error=${encodeURIComponent(uploadResult.error)}`);
  }

  if (uploadResult.move) {
    try {
      await uploadResult.move();
    } catch (uploadError) {
      return res.redirect('/signup?error=Unable to upload profile image.');
    }
  }

  try {
    const [existingUserRows] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);

    if (existingUserRows.length > 0) {
      return res.redirect('/signup?error=Email already registered.');
    }

    const [result] = await pool.query(
      'INSERT INTO users (full_name, email, password, profile_image) VALUES (?, ?, ?, ?)',
      [fullName, email, password, uploadResult.path]
    );

    createSession(
      req,
      {
        id: result.insertId,
        full_name: fullName,
        email,
        profile_image: uploadResult.path
      },
      () => res.redirect('/?success=Account created successfully.'),
      () => res.redirect('/signup?error=Unable to create account.')
    );
    return;
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
      'SELECT id, full_name, email, password, profile_image FROM users WHERE email = ? LIMIT 1',
      [email]
    );

    const user = rows[0];

    if (!user || user.password !== password) {
      return res.redirect('/login?error=Invalid email or password.');
    }

    createSession(
      req,
      {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        profile_image: user.profile_image || null
      },
      () => res.redirect('/?success=Login successful.'),
      () => res.redirect('/login?error=Unable to login.')
    );
    return;
  } catch (error) {
    return res.redirect('/login?error=Unable to login.');
  }
});

router.get('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie(sessionCookieName);
    res.redirect('/login?success=Logged out successfully.');
  });
});

router.get('/profile', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, full_name, email, profile_image, created_at FROM users WHERE id = ? LIMIT 1',
      [req.session.user.id]
    );

    const user = rows[0];

    if (!user) {
      req.session.destroy(() => {
        res.redirect('/login?error=Session expired. Please login again.');
      });
      return;
    }

    req.session.user = {
      ...req.session.user,
      full_name: user.full_name,
      email: user.email,
      profile_image: user.profile_image || null
    };

    return res.render('profile', {
      user,
      error: req.query.error || '',
      success: req.query.success || ''
    });
  } catch (error) {
    return res.redirect('/tasks?error=Unable to load profile.');
  }
});

router.post('/profile/image', requireAuth, async (req, res) => {
  const profileImage = req.files?.profile_image;

  if (!profileImage || !profileImage.name) {
    return res.redirect('/profile?error=Please select an image to upload.');
  }

  const uploadResult = saveProfileImage(profileImage);

  if (!uploadResult.ok) {
    return res.redirect(`/profile?error=${encodeURIComponent(uploadResult.error)}`);
  }

  try {
    await uploadResult.move();

    await pool.query('UPDATE users SET profile_image = ? WHERE id = ?', [
      uploadResult.path,
      req.session.user.id
    ]);

    req.session.user = {
      ...req.session.user,
      profile_image: uploadResult.path
    };

    return res.redirect('/profile?success=Profile image updated successfully.');
  } catch (error) {
    return res.redirect('/profile?error=Unable to update profile image.');
  }
});

module.exports = router;
