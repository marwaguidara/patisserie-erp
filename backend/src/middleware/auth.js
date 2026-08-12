const jwt = require('jsonwebtoken');

// Environment-based JWT secret.
// A hardcoded fallback is provided ONLY for local development and automated
// tests; production REQUIRES JWT_SECRET to be set explicitly (see .env.example).
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_development_key';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET is not set in production. Define the JWT_SECRET environment variable (see .env.example).');
  process.exit(1);
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (req.user.role === 'ADMIN') {
      return next(); // ADMIN has full access
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Requires one of roles: [${allowedRoles.join(', ')}]`
      });
    }

    next();
  };
}

module.exports = { requireAuth, requireRole, JWT_SECRET };
