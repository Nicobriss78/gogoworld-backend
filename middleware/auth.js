// backend/middleware/auth.js
// Middleware di autenticazione (JWT) e controllo ruoli

const jwt = require('jsonwebtoken');

// Estrae il token Bearer dall'header Authorization
function getBearerToken(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// Richiede un JWT valido, altrimenti 401
function authRequired(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    const secret = process.env.JWT_SECRET || 'dev-change-me';
    const payload = jwt.verify(token, secret);
    // payload tipico: { id, role }
    req.user = { id: payload.id, role: payload.role };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Richiede che l'utente autenticato abbia uno dei ruoli indicati, altrimenti 403
function roleRequired(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { authRequired, roleRequired };
