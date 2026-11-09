'use strict';

// CP002 C-01/C-02 — primitive atomiche per token hashed di verifica/reset.
// Campi legacy conservati; new issuance spento fino a cutover esplicito.
// NON contiene ingressi HTTP, invii email, configurazioni o log sensibili.
const crypto = require('crypto');
const User = require('../models/userModel');

const MAX_VALID = 3;
const MAX_RETRIES = 5;
const PURPOSE = Object.freeze({
  verify: {
    list: 'verificationTokens', legacyHash: 'verificationTokenHash',
    legacyExpires: 'verificationTokenExpires', ttl: 24 * 60 * 60 * 1000,
  },
  reset: {
    list: 'resetTokens', legacyHash: 'resetTokenHash',
    legacyExpires: 'resetTokenExpires', ttl: 60 * 60 * 1000,
  },
});

function purposeConfig(purpose) {
  const cfg = PURPOSE[purpose];
  if (!cfg) throw new Error('cp002_invalid_purpose');
  return cfg;
}

function boundedIssuanceEnabled() {
  // Due conferme esplicite; non sostituiscono le verifiche T2/T3.
  return process.env.CP002_BOUNDED_ISSUANCE === '1' &&
    process.env.CP002_LEGACY_COMPAT_CONFIRMED === '1';
}

function hashToken(raw) {
  if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/i.test(raw)) return null;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function asTime(value) {
  const n = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(n) ? n : 0;
}

function validExisting(doc, cfg, now) {
  const entries = [];
  const rawArray = Array.isArray(doc[cfg.list]) ? doc[cfg.list] : [];
  for (const entry of rawArray) {
    if (!entry || typeof entry.hash !== 'string') continue;
    const expires = asTime(entry.expiresAt);
    if (expires <= now) continue;
    const issued = asTime(entry.issuedAt);
    entries.push({
      hash: entry.hash,
      expiresAt: new Date(expires),
      issuedAt: new Date(issued > 0 ? issued : expires - cfg.ttl),
      source: 'bounded',
    });
  }

  const legacyExpiry = asTime(doc[cfg.legacyExpires]);
  if (typeof doc[cfg.legacyHash] === 'string' && legacyExpiry > now) {
    entries.push({
      hash: doc[cfg.legacyHash],
      expiresAt: new Date(legacyExpiry),
      issuedAt: new Date(legacyExpiry - cfg.ttl),
      source: 'legacy',
    });
  }
  return entries;
}

/**
 * Prima di chiamare questo metodo, il controller deve ricevere permesso positivo
 * da C-04. Mai loggare token raw, link o PII.
 */
async function issueBoundedToken({ userId, purpose, guardAuthorized }) {
  const cfg = purposeConfig(purpose);
  if (guardAuthorized !== true) return { ok: false, reason: 'guard_required' };
  if (!boundedIssuanceEnabled()) return { ok: false, reason: 'cutover_disabled' };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const doc = await User.findById(userId)
      .select('_id __v verified verificationTokens verificationTokenHash verificationTokenExpires resetTokens resetTokenHash resetTokenExpires')
      .lean();
    if (!doc || (purpose === 'verify' && doc.verified === true)) {
      return { ok: false, reason: 'account_not_eligible' };
    }

    const now = Date.now();
    const raw = crypto.randomBytes(32).toString('hex');
    const entry = {
      hash: hashToken(raw),
      expiresAt: new Date(now + cfg.ttl),
      issuedAt: new Date(now),
      source: 'bounded',
    };
    const all = validExisting(doc, cfg, now).concat(entry);
    all.sort((a, b) =>
      asTime(a.issuedAt) - asTime(b.issuedAt) ||
      a.hash.localeCompare(b.hash) ||
      a.source.localeCompare(b.source));
    const retained = all.slice(-MAX_VALID);
    const keepLegacy = retained.some((x) => x.source === 'legacy');
    const tokens = retained.filter((x) => x.source === 'bounded')
      .map(({ hash, expiresAt, issuedAt }) => ({ hash, expiresAt, issuedAt }));

    const version = Number.isSafeInteger(doc.__v) ? doc.__v : 0;
    const filter = {
      _id: doc._id,
      __v: Number.isSafeInteger(doc.__v) ? version : { $exists: false },
      ...(purpose === 'verify' ? { verified: { $ne: true } } : {}),
    };
    const update = {
      $set: { [cfg.list]: tokens },
      $inc: { __v: 1 },
      ...(!keepLegacy ? {
        $unset: { [cfg.legacyHash]: '', [cfg.legacyExpires]: '' },
      } : {}),
    };
    const result = await User.updateOne(filter, update, { runValidators: true });
    if (result.modifiedCount === 1) {
      return { ok: true, raw, hash: entry.hash, expiresAt: entry.expiresAt };
    }
    // Lost-update evitato via __v; su conflitto ricarica e ricalcola cap.
  }
  return { ok: false, reason: 'concurrent_retry_exhausted' };
}

function validTokenFilter(cfg, hash, now) {
  return {
    $or: [
      { [cfg.legacyHash]: hash, [cfg.legacyExpires]: { $gt: now } },
      { [cfg.list]: { $elemMatch: { hash, expiresAt: { $gt: now } } } },
    ],
  };
}

/** Consuma verify una sola volta, senza toccare reset. */
async function consumeVerifyToken(raw) {
  const hash = hashToken(raw);
  if (!hash) return false;
  const cfg = PURPOSE.verify;
  const result = await User.updateOne(
    { verified: { $ne: true }, ...validTokenFilter(cfg, hash, new Date()) },
    {
      $set: { verified: true, [cfg.list]: [] },
      $unset: { [cfg.legacyHash]: '', [cfg.legacyExpires]: '' },
      $inc: { __v: 1 },
    },
  );
  return result.modifiedCount === 1;
}

/**
 * Reset atomico: prima bcrypt, poi una transizione condizionata.
 * Gli update query NON invocano Mongoose pre-save.
 * L'hold persistente R-A dovra' essere verificato nella stessa operazione:
 * non collegare questo helper a /reset prima dell'integrazione R-A.
 */
async function consumeResetToken(_raw, _newPassword, _options = {}) {
  // CP002 C-03: BLOCCO TECNICO VOLONTARIO.
  // Non esiste ancora il predicato R-A persistente da includere
  // nella STESSA operazione CAS. Un callback di pre-check non basta:
  // fra check e update il blocco potrebbe diventare attivo.
  // La futura corsia R-A dovra' sostituire questa implementazione
  // con un filtro atomico verificato e coprire anche rollback/restore.
  return false;
}

/** Revoca una sola emissione certamente rifiutata, senza toccare concorrenti. */
async function revokeBoundedToken(userId, purpose, hash) {
  const cfg = purposeConfig(purpose);
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) return false;
  const filter = { _id: userId, [cfg.list + '.hash']: hash };
  const result = await User.updateOne(
    filter,
    { $pull: { [cfg.list]: { hash } }, $inc: { __v: 1 } },
  );
  return result.modifiedCount === 1;
}

module.exports = {
  boundedIssuanceEnabled,
  issueBoundedToken,
  consumeVerifyToken,
  consumeResetToken,
  revokeBoundedToken,
};
