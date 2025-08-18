// backend/src/internal/middleware/idempotency.js
// Prevenzione doppie operazioni (in-memory). Per persistenza usare Redis o Mongo TTL.
const windowMs = parseInt(process.env.IDEMP_TTL_MS || '300000', 10); // default 5 min
const seen = new Map();

function withIdempotency(req, res, next) {
  const key = req.header('Idempotency-Key');
  if (!key) return next();
  const now = Date.now();

  // purge chiavi scadute
  for (const [k, t] of seen.entries()) {
    if (now - t > windowMs) seen.delete(k);
  }
  if (seen.has(key)) {
    return res.status(409).json({ ok: false, error: 'Duplicate request' });
  }
  seen.set(key, now);
  next();
}

module.exports = { withIdempotency };
