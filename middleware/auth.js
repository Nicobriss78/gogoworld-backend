// middleware/auth.js — autenticazione JWT e chiavi interne
//
// Esporta:
// - protect: richiede JWT valido; imposta req.user { id, email, name }.
// - optionalAuth: non obbliga JWT; se presente, popola req.user.
// - requireInternalKey: richiede header X-Internal-Key === process.env.INTERNAL_API_KEY.
//
// Dipendenze: models/userModel.js, process.env.JWT_SECRET

const jwt = require("jsonwebtoken");
const User = require("../models/userModel");

function extractToken(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function hydrateUser(userId) {
  // Carica dati minimi per evitare payload obesi
  const user = await User.findById(userId).select("_id email name");
  if (!user) return null;
  return { id: String(user._id), email: user.email, name: user.name || null };
}

async function protect(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ ok: false, error: "NO_TOKEN" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || !decoded.id) {
      return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
    }

    const u = await hydrateUser(decoded.id);
    if (!u) return res.status(401).json({ ok: false, error: "USER_NOT_FOUND" });

    req.user = u;
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: "AUTH_FAILED", message: err.message });
  }
}

async function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded && decoded.id) {
      const u = await hydrateUser(decoded.id);
      if (u) req.user = u;
    }
  } catch {
    // ignora errori su optional
  }
  next();
}

function requireInternalKey(req, res, next) {
  const key = req.headers["x-internal-key"] || req.query.internalKey;
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN_INTERNAL" });
  }
  next();
}

module.exports = { protect, optionalAuth, requireInternalKey };


