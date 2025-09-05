// middleware/auth.js — Auth & Role Guards (GoGoWorld.life)
// NOTE: Modifica CHIRURGICA per Opzione B (+ estensione admin)
// - Esteso `protect` per includere anche `role` e `canOrganize` (oltre a id/email/name).
// - Esteso `authorize(...roles)` per consentire gli endpoint "organizer"
// anche a `canOrganize === true` e a `role === "admin"`.
// - Nessuna altra logica alterata.

const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const User = require("../models/userModel");

// -----------------------------------------------------------------------------
// protect: richiede autenticazione Bearer JWT
// - Decodifica il token
// - Carica l'utente dal DB
// - Idrata req.user con: _id, id (alias), email, name, role, canOrganize
// -----------------------------------------------------------------------------
const protect = asyncHandler(async (req, res, next) => {
  let token;

  // Atteso header: Authorization: Bearer <token>
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // decoded.id atteso nel payload
      const user = await User.findById(decoded.id).select(
        "_id name email role canOrganize isBanned"
      );

      if (!user) {
        res.status(401);
        throw new Error("Not authorized");
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
        role: (user.role || "participant").toString().toLowerCase(), // PATCH: normalize
        canOrganize: user.canOrganize === true,
        isBanned: user.isBanned === true,
      };

      return next();
    } catch (err) {
      // Token invalido/expired
      res.status(401);
      throw new Error("Not authorized, token failed");
    }
  }

  res.status(401);
  throw new Error("Not authorized, no token");
});

// -----------------------------------------------------------------------------
// authorize(...roles): vincola l’accesso a specifici ruoli
// Uso: router.post("/", protect, authorize("organizer"), createEvent)
// -----------------------------------------------------------------------------
const authorize = (...roles) => {
  // PATCH: normalizza i ruoli richiesti in lowercase
  const allowed = new Set((roles || []).map((r) => String(r).toLowerCase()));
  return (req, res, next) => {
    try {
      if (!req.user || !req.user.role) {
        res.status(403);
        throw new Error("Forbidden");
      }

      // Estensione: se serve "organizer", accetta anche canOrganize === true e gli admin
      if (allowed.has("organizer")) {
        const role = String(req.user.role || "").toLowerCase();
        if (
          role === "organizer" ||
          role === "admin" ||
          req.user.canOrganize === true
        ) {
          return next();
        }
        res.status(403);
        throw new Error("Forbidden");
      }

      // Per "admin" (o altri ruoli), match diretto in lowercase
      const role = String(req.user.role || "").toLowerCase();
      if (!allowed.has(role)) {
        res.status(403);
        throw new Error("Forbidden");
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
};

module.exports = {
  protect,
  authorize,
};
