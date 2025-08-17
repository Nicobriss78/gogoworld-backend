// backend/middleware/auth.js
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

/**
 * Verifica la presenza del token Bearer e decodifica il JWT.
 * Imposta req.user = { id, role, ... } se valido.
 */
function authRequired(req, res, next) {
  try {
    const hdr = req.headers.authorization || req.headers.Authorization;
    if (!hdr || !hdr.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing token" });
    }
    const token = hdr.slice("Bearer ".length).trim();
    const payload = jwt.verify(token, JWT_SECRET);

    // payload atteso: { id, email, role, iat, exp, ... }
    if (!payload || !payload.id) {
      return res.status(401).json({ error: "Invalid token" });
    }

    req.user = {
      id: String(payload.id),
      email: payload.email || "",
      role: payload.role || "participant",
    };
    next();
  } catch (err) {
    // token scaduto / non valido
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Richiede un certo ruolo applicativo.
 * Allineato alla logica di GoGo.World:
 * - se è richiesto "participant", **consentiamo** anche a chi ha ruolo "organizer"
 * (permette lo switch senza rifare login).
 * - se è richiesto "organizer", serve realmente organizer.
 */
function roleRequired(requiredRole) {
  return function (req, res, next) {
    const userRole = (req.user && req.user.role) || "";

    // Organizer eredita i permessi di Participant
    if (requiredRole === "participant") {
      if (userRole === "participant" || userRole === "organizer") {
        return next();
      }
      return res.status(403).json({ error: "Forbidden" });
    }

    // Ruoli "forti" devono combaciare
    if (userRole === requiredRole) {
      return next();
    }

    return res.status(403).json({ error: "Forbidden" });
  };
}

module.exports = {
  authRequired,
  roleRequired,
};

