// backend/src/middleware/auth.js
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change_me';
const DEFAULT_TTL = '7d';

function signUserToken({ user_id, name, role }) {
  const payload = {
    sub: Number(user_id),
    name: String(name || 'User'),
    role: role === 'admin' ? 'admin' : 'employee',
    typ: 'user',
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: DEFAULT_TTL });
}

function signViewerToken({ fkboardid }) {
  const payload = {
    typ: 'viewer',
    fkboardid: String(fkboardid),
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: DEFAULT_TTL });
}

// Soft auth: decode token if present and attach to req.user; don't block
function authMiddleware(req, _res, next) {
  const h = req.headers['authorization'];
  if (!h || !h.toLowerCase().startsWith('bearer ')) {
    req.user = null;
    return next();
  }
  const token = h.slice(7).trim();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
  } catch {
    req.user = null;
  }
  next();
}

// Hard check: require one of roles
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || req.user.typ !== 'user') {
      return res.status(401).json({ error: 'auth required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}

// Allow viewer token for a specific board (e.g., GET kanban)
// If no token, still allow (public read). If token is viewer, it must match fkboardid.
function allowViewerForBoard(req, res, next) {
  const { fkboardid } = req.params || {};
  const u = req.user;
  if (!u) return next();
  if (u.typ === 'viewer') {
    if (String(u.fkboardid) !== String(fkboardid)) {
      return res.status(403).json({ error: 'viewer token not for this board' });
    }
    return next();
  }
  // user/admin tokens ok
  return next();
}

module.exports = {
  signUserToken,
  signViewerToken,
  authMiddleware,
  requireRole,
  allowViewerForBoard,
};
