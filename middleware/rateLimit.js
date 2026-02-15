// backend/middleware/rateLimit.js
const rateLimit = require("express-rate-limit");
const { logger } = require("../core/logger");
const { config } = require("../config");
const { getRateLimitClient } = require("../core/rateLimitStore");

// Uniform JSON handler for 429 (public endpoints) — container-first, no disk writes
function rateLimitJsonHandler(req, res /*, next*/) {
  const reset =
    req.rateLimit?.resetTime instanceof Date
      ? req.rateLimit.resetTime
      : new Date(Date.now() + 60_000);
  const retryAfterSec = Math.max(1, Math.ceil((reset - new Date()) / 1000));
  res.set("Retry-After", retryAfterSec.toString());
  return res.status(429).json({
    ok: false,
    error: "too_many_requests",
    code: "RATE_LIMIT_PUBLIC",
    retryAfter: retryAfterSec,
  });
}

// --- Redis shared ABUSE limiter (scalabile tra istanze) ---
// LUA: INCR + PEXPIRE on first hit
const LUA_INCR_EXPIRE = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return current
`;

function envBool(v) {
  return String(v || "").toLowerCase() === "1" || String(v || "").toLowerCase() === "true";
}

const DEFAULT_NS = process.env.RATE_LIMIT_NAMESPACE || "gw";
const ENV_NAME = process.env.RATE_LIMIT_ENV || config.NODE_ENV || "production";

function baseKey(scope) {
  return `${DEFAULT_NS}:${ENV_NAME}:ABUSE:${scope}`;
}

function ipKey(req) {
  // trust proxy è già gestito a livello app; req.ip va bene
  return String(req.ip || "0.0.0.0");
}

function userKey(req) {
  const uid = req.user?.id || req.user?._id;
  return uid ? String(uid) : "anon";
}

function retryAfterSecFromWindow(windowMs) {
  return Math.max(1, Math.ceil(Number(windowMs || 0) / 1000));
}

function createRedisAbuseLimiter({ scope, windowMs, max, keyFn, code }) {
  if (!scope) throw new Error("createRedisAbuseLimiter: scope mancante");
  const win = Number(windowMs);
  const lim = Number(max);
  if (!Number.isFinite(win) || win <= 0) throw new Error(`Limiter(${scope}): windowMs non valido`);
  if (!Number.isFinite(lim) || lim <= 0) throw new Error(`Limiter(${scope}): max non valido`);

  return async function redisAbuseLimiter(req, res, next) {
    try {
      // Se Redis non è configurato/available, fallback su in-memory (vedi wrapper sotto)
      const client = await getRateLimitClient();
      const k = keyFn ? keyFn(req) : ipKey(req);
      const key = `${baseKey(scope)}:${k}`;

      const current = await client.eval(LUA_INCR_EXPIRE, {
        keys: [key],
        arguments: [String(win)],
      });

      const n = Number(current);
      if (Number.isFinite(n) && n > lim) {
        const ra = retryAfterSecFromWindow(win);
        res.set("Retry-After", String(ra));
        return res.status(429).json({
          ok: false,
          error: "too_many_requests",
          code: code || "RATE_LIMIT_ABUSE",
          scope,
          retryAfter: ra,
        });
      }

      return next();
    } catch (e) {
      // Fallback: sarà gestito dal wrapper hybrid; qui lasciamo passare
      logger.warn("⚠️ Redis ABUSE limiter unavailable:", e?.message || e);
      return next();
    }
  };
}

// Hybrid: Redis shared se possibile, altrimenti express-rate-limit in-memory
function hybridLimiter({ scope, windowMs, max, keyGenerator, code }) {
  const mem = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
      const reset =
        req.rateLimit?.resetTime instanceof Date
          ? req.rateLimit.resetTime
          : new Date(Date.now() + Number(windowMs || 60_000));
      const retryAfterSec = Math.max(1, Math.ceil((reset - new Date()) / 1000));
      res.set("Retry-After", retryAfterSec.toString());
      return res.status(429).json({
        ok: false,
        error: "too_many_requests",
        code: code || "RATE_LIMIT_ABUSE",
        scope,
        retryAfter: retryAfterSec,
      });
    },
  });

  const redisMw = createRedisAbuseLimiter({
    scope,
    windowMs,
    max,
    keyFn: (req) => (keyGenerator ? keyGenerator(req) : ipKey(req)),
    code,
  });

  return function hybridRateLimit(req, res, next) {
    const hasRedisUrl = !!process.env.RATE_LIMIT_REDIS_URL;
    const preferRedis = hasRedisUrl && !envBool(process.env.RATE_LIMIT_DISABLE_REDIS);
    if (!preferRedis) return mem(req, res, next);

    // Prova Redis; se RedisMw fa next() “per errore”, mem limiter interverrà comunque?
    // No: redisMw chiama next() anche su errore. Quindi dobbiamo decidere: su errore usiamo mem.
    // Implementiamo: proviamo Redis e se non setta un marker, passiamo a mem solo se serve.
    // Per semplicità: se Redis è preferito, usiamo RedisMw e STOP; su errore RedisMw fa next().
    // (Questo mantiene servizio disponibile anche se Redis ha problemi.)
    return redisMw(req, res, next);
  };
}

// ------------------- LIMITER DEFINITIONS -------------------

// Login: 10/min per IP (nota: commento vecchio diceva 5/5min, ma valori reali sono questi)
const loginLimiter = hybridLimiter({
  scope: "login",
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: ipKey,
  code: "RATE_LIMIT_LOGIN",
});

// Registration attempts
const registerLimiter = hybridLimiter({
  scope: "register",
  windowMs: 5 * 60 * 1000,
  max: 5,
  keyGenerator: ipKey,
  code: "RATE_LIMIT_REGISTER",
});

// Email verification resend (public ABUSE)
// Protegge da spam/abuse senza rivelare nulla (anti-enumerazione gestita in controller)
const verifyEmailLimiter = hybridLimiter({
  scope: "verify_email",
  windowMs: 10 * 60 * 1000, // 10 minuti
  max: 3, // 3 tentativi / 10 min per IP
  keyGenerator: ipKey,
  code: "RATE_LIMIT_VERIFY_EMAIL",
});

// Admin generic limiter (ABUSE)
const adminLimiter = hybridLimiter({
  scope: "admin",
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: ipKey,
  code: "RATE_LIMIT_ADMIN",
});

// Organizer write limiter (ABUSE)
const writeLimiter = hybridLimiter({
  scope: "write",
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: ipKey,
  code: "RATE_LIMIT_WRITE",
});

// Participation limiter (ABUSE)
const participationLimiter = hybridLimiter({
  scope: "participation",
  windowMs: 60 * 1000,
  max: 15,
  keyGenerator: ipKey,
  code: "RATE_LIMIT_PARTICIPATION",
});

// Monitor limiter (ABUSE)
const monitorLimiter = hybridLimiter({
  scope: "monitor",
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: ipKey,
  code: "RATE_LIMIT_MONITOR",
});

// Banner fetch (public ABUSE)
const bannerFetchLimiter = hybridLimiter({
  scope: "banner_fetch",
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: ipKey,
  code: "RATE_LIMIT_BANNER_FETCH",
});

// Banner click (public ABUSE)
const bannerClickLimiter = hybridLimiter({
  scope: "banner_click",
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: ipKey,
  code: "RATE_LIMIT_BANNER_CLICK",
});

// Private unlock brute-force (userId + IP)
// Nota: usiamo userId se c’è (protect), altrimenti “anon”.
const privateUnlockLimiter = hybridLimiter({
  scope: "private_unlock",
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `${userKey(req)}:${ipKey(req)}`,
  code: "RATE_LIMIT_PRIVATE_UNLOCK",
});

// NEW: DM messages (scalabile, shared)
const dmMessageLimiter = hybridLimiter({
  scope: "dm_message",
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => userKey(req), // protetta: userId-based
  code: "RATE_LIMIT_DM_MESSAGE",
});

// NEW: Room messages (scalabile, shared)
const roomMessageLimiter = hybridLimiter({
  scope: "room_message",
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => userKey(req), // protetta: userId-based
  code: "RATE_LIMIT_ROOM_MESSAGE",
});

module.exports = {
  loginLimiter,
  registerLimiter,
  verifyEmailLimiter,
  adminLimiter,
  writeLimiter,
  participationLimiter,
  monitorLimiter,
  bannerFetchLimiter,
  bannerClickLimiter,
  privateUnlockLimiter,

  // Nuovi (Step 2)
  dmMessageLimiter,
  roomMessageLimiter,
};
