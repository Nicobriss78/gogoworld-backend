// gogoworld-backend/middleware/securityRateLimit.js
// Shared SECURITY rate-limit (Redis-compatible) — baseline Step 1.4
// - Chiave: {ns}:{env}:SECURITY:{scope}:{userId}
// - Atomicità: LUA (INCR + PEXPIRE on first hit)
// - Zero leak: 429 minimale

const { config } = require("../config");
const { logger } = require("../core/logger");
const { getRateLimitClient } = require("../core/rateLimitStore");

const DEFAULT_NS = process.env.RATE_LIMIT_NAMESPACE || "gw";
const ENV_NAME = process.env.RATE_LIMIT_ENV || config.NODE_ENV || "production";

// LUA: incrementa e, se è il primo hit, imposta TTL (ms)
const LUA_INCR_EXPIRE = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return current
`;

function getUserId(req) {
  // protect idrata req.user.id (alias) e req.user._id
  const uid = req.user?.id || req.user?._id;
  return uid ? String(uid) : "";
}

function buildKey({ scope, userId }) {
  return `${DEFAULT_NS}:${ENV_NAME}:SECURITY:${scope}:${userId}`;
}

function computeRetryAfterSec(windowMs) {
  return Math.max(1, Math.ceil(Number(windowMs || 0) / 1000));
}

function securityRateLimit({ scope, windowMs, max }) {
  if (!scope || typeof scope !== "string") {
    throw new Error("securityRateLimit: scope mancante o non valido");
  }
  const win = Number(windowMs);
  const lim = Number(max);

  if (!Number.isFinite(win) || win <= 0) {
    throw new Error(`securityRateLimit(${scope}): windowMs non valido`);
  }
  if (!Number.isFinite(lim) || lim <= 0) {
    throw new Error(`securityRateLimit(${scope}): max non valido`);
  }

  return async function securityRateLimitMiddleware(req, res, next) {
    try {
      const userId = getUserId(req);

      // Deny-by-default: SECURITY è su userId. Se manca, è configurazione sbagliata
      // (es. middleware applicato prima di protect, o route non coerente).
      if (!userId) {
        return res.status(401).json({ ok: false, error: "not_authorized" });
      }

      const key = buildKey({ scope, userId });
      const client = await getRateLimitClient();

      // Valore corrente dopo l'incremento atomico
      const current = await client.eval(LUA_INCR_EXPIRE, {
        keys: [key],
        arguments: [String(win)],
      });

      // current può arrivare come number o string, normalizziamo
      const n = Number(current);

      if (Number.isFinite(n) && n > lim) {
        const retryAfterSec = computeRetryAfterSec(win);
        res.set("Retry-After", String(retryAfterSec));
        return res.status(429).json({
          ok: false,
          error: "too_many_requests",
          code: "RATE_LIMIT_SECURITY",
          scope,
          retryAfter: retryAfterSec,
        });
      }

      return next();
    } catch (e) {
      // Fail-closed? In produzione meglio NON bloccare tutto per un problema Redis.
      // Manteniamo comportamento non bloccante ma tracciabile.
      logger.warn("⚠️ SECURITY rate-limit middleware error:", e?.message || e);
      return next();
    }
  };
}

module.exports = { securityRateLimit };

