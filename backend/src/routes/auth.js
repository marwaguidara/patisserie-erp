const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const { requireAuth, requireRole, JWT_SECRET } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { loginSchema } = require('../validators/auth.schema');

const router = express.Router();

const { recordAudit } = require('../middleware/auditHelper');

// POST /api/auth/login
router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await db('users').where({ email }).first();
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Audit de la connexion réussie (LOGIN)
    await recordAudit(req, {
      action: 'LOGIN',
      entity_type: 'user',
      entity_id: user.id,
      user_id: user.id,
      new_values: { email: user.email, role: user.role }
    });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    // Audit de la déconnexion (LOGOUT)
    await recordAudit(req, {
      action: 'LOGOUT',
      entity_type: 'user',
      entity_id: req.user.id,
      user_id: req.user.id
    });

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await db('users').where({ id: req.user.id }).select('id', 'name', 'email', 'role').first();
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/users
router.get('/users', requireAuth, requireRole(['ADMIN']), async (req, res, next) => {
  try {
    const users = await db('users').select('id', 'name', 'email', 'role');
    res.json(users);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
