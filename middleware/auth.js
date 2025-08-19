// middleware/auth.js — JWT → req.user con registeredRole + sessionRole
const jwt = require("jsonwebtoken");

function authRequired(req, res, next) {
  try {
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: "NO_TOKEN" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // decoded contiene: { id, registeredRole, sessionRole, iat, exp }
    if (!decoded?.id) return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });

    req.user = {
      id: decoded.id,
      registeredRole: decoded.registeredRole || decoded.role || "participant",
      sessionRole: decoded.sessionRole || decoded.currentRole || decoded.role || "participant",
    };
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: "INVALID_TOKEN", details: err.message });
  }
}

function roleRequired(role) {
  return (req, res, next) => {
    // L’autorizzazione usa SEMPRE il sessionRole
    if (!req.user?.sessionRole) return res.status(403).json({ ok: false, error: "NO_SESSION_ROLE" });
    if (req.user.sessionRole !== role) return res.status(403).json({ ok: false, error: "FORBIDDEN_ROLE" });
    next();
  };
}

module.exports = { authRequired, roleRequired };
