// backend/middleware/rateLimit.js
const rateLimit = require("express-rate-limit");
// Uniform JSON handler for 429 (public endpoints) — container-first, no disk writes
function rateLimitJsonHandler(req, res /*, next*/) {
  const reset = req.rateLimit?.resetTime instanceof Date ? req.rateLimit.resetTime : new Date(Date.now() + 60_000);
  const retryAfterSec = Math.max(1, Math.ceil((reset - new Date()) / 1000));
  res.set('Retry-After', retryAfterSec.toString());
  return res.status(429).json({
    ok: false,
    error: 'too_many_requests',
    code: 'RATE_LIMIT_PUBLIC',
    retryAfter: retryAfterSec
  });
}
// Limite login: 5 tentativi ogni 5 minuti per IP
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitJsonHandler,
});

// Limit registration attempts to reduce abuse
const registerLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitJsonHandler,
});

// Limite azioni admin: 60 richieste/min per IP
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitJsonHandler,
});
// Limite scritture organizer: 20 richieste/min per IP
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitJsonHandler,
});


// Limite partecipazioni (join/leave): 10 richieste / 5 min per IP
const participationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitJsonHandler,
});

module.exports = { loginLimiter, registerLimiter, adminLimiter, writeLimiter, participationLimiter };
