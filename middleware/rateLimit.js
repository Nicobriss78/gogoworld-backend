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
// Limite scritture organizer: 20 richieste/min per IP
const writeLimiter = rateLimit({
windowMs: 60 * 1000,
max: 20,
standardHeaders: true,
legacyHeaders: false,
});

// Limite partecipazioni (join/leave): 10 richieste / 5 min per IP
const participationLimiter = rateLimit({
windowMs: 5 * 60 * 1000,
max: 10,
standardHeaders: true,
legacyHeaders: false,
});
module.exports = { loginLimiter, adminLimiter, writeLimiter, participationLimiter };
