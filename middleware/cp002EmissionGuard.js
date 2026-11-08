'use strict';

// CP002 C-04: limite additivo esclusivo per le NUOVE emissioni di link.
// In produzione nessun fallback in memoria e nessun bypass su errore Redis.
// Non modifica la policy Redis globale o i limiter di login/reset-consume.
const crypto = require('crypto');
const { getRateLimitClient } = require('../core/rateLimitStore');

const REDIS_SCRIPT = `
local value = redis.call('INCR', KEYS[1])
if value == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return value
`;

const PROFILES = Object.freeze({
  register: { ipLimit: 5, ipWindowMs: 300000, subjectLimit: 3, subjectWindowMs: 3600000 },
  verify: { ipLimit: 3, ipWindowMs: 600000, subjectLimit: 3, subjectWindowMs: 3600000 },
  forgot: { ipLimit: 5, ipWindowMs: 600000, subjectLimit: 3, subjectWindowMs: 3600000 },
});

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function privateKey(scope, kind, identity) {
  const namespace = process.env.RATE_LIMIT_NAMESPACE || 'gw';
  const environment = process.env.RATE_LIMIT_ENV || process.env.NODE_ENV || 'production';
  // Hash anche l'identità IP/email: nessun indirizzo/PII nella chiave Redis.
  return `${namespace}:${environment}:CP002:ISSUE:${scope}:${kind}:${digest(identity)}`;
}

function sendUnavailable(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Retry-After', '60');
  return res.status(503).json({ ok: false, error: 'temporarily_unavailable', code: 'CP002_GUARD_UNAVAILABLE' });
}

function sendLimited(res, seconds) {
  const retryAfter = Math.max(1, Math.ceil(seconds));
  res.set('Cache-Control', 'no-store');
  res.set('Retry-After', String(retryAfter));
  return res.status(429).json({ ok: false, error: 'too_many_requests', code: 'CP002_RATE_LIMITED' });
}

// Un timeout non prova che la richiesta Redis non sia stata conteggiata;
// si preferisce negare un'emissione piuttosto che rischiare un passaggio incerto.
async function bounded(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('cp002_store_timeout')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function increment(client, key, windowMs) {
  const value = await bounded(
    client.eval(REDIS_SCRIPT, { keys: [key], arguments: [String(windowMs)] }),
    2500,
  );
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('cp002_store_invalid_result');
  return parsed;
}

function emissionGuard(scope, options = {}) {
  const profile = PROFILES[scope];
  if (!profile) throw new Error('cp002_unknown_scope');
  const clientProvider = options.clientProvider || getRateLimitClient;

  return async function guardNewTokenIssuance(req, res, next) {
    // Il guard è l'autorità: non considerare next() del limiter legacy un permesso.
    if (!process.env.RATE_LIMIT_REDIS_URL || ['1', 'true'].includes(String(process.env.RATE_LIMIT_DISABLE_REDIS || '').trim().toLowerCase())) {
      return sendUnavailable(res);
    }

    const email = normalizeEmail(req.user?.email || req.body?.email);
    const ip = typeof req.ip === 'string' && req.ip.length ? req.ip : 'unknown';

    try {
      const client = await bounded(Promise.resolve().then(() => clientProvider()), 2500);
      if (!client || client.isReady !== true || typeof client.eval !== 'function') {
        return sendUnavailable(res);
      }

      const ipCount = await increment(client, privateKey(scope, 'ip', ip), profile.ipWindowMs);
      if (ipCount > profile.ipLimit) {
        return sendLimited(res, profile.ipWindowMs / 1000);
      }

      // Quote per identificativo senza memorizzare l'email in Redis.
      // Applicate anche per account inesistenti: nessuna enumerazione.
      const subjectCount = await increment(
        client, privateKey(scope, 'email', email), profile.subjectWindowMs,
      );
      if (subjectCount > profile.subjectLimit) {
        return sendLimited(res, profile.subjectWindowMs / 1000);
      }

      // Solo qui è acquisito il consenso POSITIVO del controllo condiviso.
      req.cp002EmissionAuthorized = true;
      return next();
    } catch (_error) {
      // Niente dettagli errore, email, IP o stack nei sink diagnostici.
      return sendUnavailable(res);
    }
  };
}

module.exports = { emissionGuard };
