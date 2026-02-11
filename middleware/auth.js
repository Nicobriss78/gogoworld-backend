// middleware/auth.js — Auth & Role Guards (GoGoWorld.life)
// NOTE: Modifica CHIRURGICA per Opzione B (+ estensione admin)
// - Esteso `protect` per includere anche `role` e `canOrganize` (oltre a id/email/name).
// - Esteso `authorize(...roles)` per consentire gli endpoint "organizer"
// anche a `canOrganize === true` e a `role === "admin"`.
// - PATCH Step B: blocco immediato degli utenti bannati (isBanned).
// - PATCH Hardening: in `protect` risposte JSON 401/403 auto-contenute (no throw).
// - Nessuna altra logica alterata.

const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const User = require("../models/userModel");
const { logger } = require("../core/logger");
function authWarn(req, code) {
  try {
    logger.warn("[auth] deny", { code, path: req.originalUrl, ip: req.ip });
  } catch (_) {}
}

// -----------------------------------------------------------------------------
// protect: richiede autenticazione Bearer JWT
// - Decodifica il token
// - Carica l'utente dal DB
// - Idrata req.user con: _id, id (alias), email, name, role, canOrganize, isBanned
// -----------------------------------------------------------------------------
const protect = asyncHandler(async (req, res, next) => {
  let token;
// Fail-closed: se JWT_SECRET non è configurato, non possiamo validare token.
  // Evita risposte ambigue (401) su un errore di configurazione server.
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ ok: false, error: "internal_error" });
  }

  // Header Authorization: Bearer <token> (case-insensitive, spazi tollerati)
  const auth = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1] || !match[1].trim()) {
    authWarn(req, "token_invalid");
    return res.status(401).json({ ok: false, error: "not_authorized_no_token" });
  }

  try {
    token = match[1].trim();
    if (!token) {
      authWarn(req, "token_invalid");
      return res.status(401).json({ ok: false, error: "not_authorized_empty_token" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // decoded.id atteso nel payload
    const user = await User.findById(decoded.id).select(
      "_id name email role canOrganize isBanned"
    );

    if (!user) {
      authWarn(req, "token_invalid");
      return res.status(401).json({ ok: false, error: "not_authorized_user_not_found" });
    }

    // Idratazione coerente con i controller esistenti:
    // - molti punti leggono req.user._id
    // - altri leggono req.user.id
    // - aggiungiamo anche role e canOrganize per i guard di autorizzazione
    req.user = {
      _id: user._id,
      id: user._id, // alias compatibilità
      email: user.email,
      name: user.name,
      role: (user.role || "participant").toString().toLowerCase(), // normalize
      canOrganize: user.canOrganize === true,
      isBanned: user.isBanned === true,
    };

    // 🔒 PATCH Step B: blocca subito gli account bannati
    if (req.user.isBanned) {
      return res.status(403).json({ ok: false, error: "account_banned" });
    }

    return next();
  } catch (err) {
    if (err?.name === "TokenExpiredError") {
      authWarn(req, "token_invalid");
      return res.status(401).json({ ok: false, error: "token_expired" });
    }
    if (err?.name === "JsonWebTokenError") {
      authWarn(req, "token_invalid");
      return res.status(401).json({ ok: false, error: "token_invalid" });
    }
    authWarn(req, "token_invalid");
    return res.status(401).json({ ok: false, error: "token_failed" });
  }
});

// -----------------------------------------------------------------------------
// authorize(...roles): vincola l’accesso a specifici ruoli
// Uso: router.post("/", protect, authorize("organizer"), createEvent)
// -----------------------------------------------------------------------------
const authorize = (...roles) => {
  // normalizza i ruoli richiesti in lowercase
  const allowed = new Set((roles || []).map((r) => String(r).toLowerCase()));
  return (req, res, next) => {
    // Fail-closed: niente throw/try/catch, risposte intenzionali e coerenti.
    // Se manca req.user, vuol dire che protect non è stato applicato (o ha fallito).
    if (!req.user) {
      authWarn(req, "token_invalid");
      return res.status(401).json({ ok: false, error: "not_authorized" });
    }

    // Ruolo mancante → deny esplicito
    const role = String(req.user.role || "").toLowerCase();
    if (!role) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    // authorize chiamato senza ruoli → deny-by-default
    if (!allowed.size) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    // Estensione Opzione B: se serve "organizer", accetta anche canOrganize === true e gli admin
    if (allowed.has("organizer")) {
      if (role === "organizer" || role === "admin" || req.user.canOrganize === true) {
        return next();
      }
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    // Per "admin" (o altri ruoli), match diretto in lowercase
    if (!allowed.has(role)) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    return next();
  };
};


module.exports = {
  protect,
  authorize,
};
