// backend/middleware/rateLimit.js
const rateLimit = require("express-rate-limit");

// Limite login: 5 tentativi ogni 5 minuti per IP
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, code: "RATE_LIMIT", error: "Troppi tentativi di login. Riprova più tardi." },
});

// Limite azioni admin: 60 richieste/min per IP
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginLimiter, adminLimiter };
