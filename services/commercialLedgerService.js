// backend/services/commercialLedgerService.js
// Commercial Foundation V1 - Ledger service
// Responsabilità: scrivere e leggere movimenti OPW immutabili.
// Non aggiorna il wallet. Non contiene logica Trilli/Promo/Admin.

const OrganizerWalletLedger = require("../models/organizerWalletLedgerModel");

function buildCommercialError(code, status = 400, message = code) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.statusCode = status;
  return err;
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeQuantity(quantity) {
  const n = Number(quantity);

  if (!Number.isInteger(n) || n <= 0) {
    throw buildCommercialError(
      "INVALID_LEDGER_QUANTITY",
      400,
      "Ledger quantity must be a positive integer."
    );
  }

  return n;
}

function assertAllowed(value, allowed, code, fieldName) {
  if (!allowed.includes(value)) {
    throw buildCommercialError(code, 400, `${fieldName} is not supported.`);
  }
}

function normalizeBalanceImpact(balanceImpact = {}) {
  return {
    available: Number(balanceImpact.available || 0),
    reserved: Number(balanceImpact.reserved || 0),
    consumed: Number(balanceImpact.consumed || 0),
    expired: Number(balanceImpact.expired || 0),
  };
}

async function existsByIdempotencyKey(idempotencyKey) {
  const key = normalizeString(idempotencyKey);

  if (!key) return false;

  const existing = await OrganizerWalletLedger.exists({ idempotencyKey: key });
  return Boolean(existing);
}

async function getByIdempotencyKey(idempotencyKey) {
  const key = normalizeString(idempotencyKey);

  if (!key) return null;

  return OrganizerWalletLedger.findOne({ idempotencyKey: key }).lean();
}

async function createLedgerEntry(payload = {}) {
  const organizerId = payload.organizerId;
  const movementType = normalizeString(payload.movementType);
  const resourceType = normalizeString(payload.resourceType);
  const idempotencyKey = normalizeString(payload.idempotencyKey);

  if (!organizerId) {
    throw buildCommercialError(
      "LEDGER_ORGANIZER_REQUIRED",
      400,
      "organizerId is required."
    );
  }

  if (!idempotencyKey) {
    throw buildCommercialError(
      "LEDGER_IDEMPOTENCY_KEY_REQUIRED",
      400,
      "idempotencyKey is required."
    );
  }

  assertAllowed(
    movementType,
    OrganizerWalletLedger.MOVEMENT_TYPES,
    "INVALID_LEDGER_MOVEMENT_TYPE",
    "movementType"
  );

  assertAllowed(
    resourceType,
    OrganizerWalletLedger.RESOURCE_TYPES,
    "INVALID_LEDGER_RESOURCE_TYPE",
    "resourceType"
  );

  const quantity = normalizeQuantity(payload.quantity);

  const scope = normalizeString(payload.scope || "organizer");
  assertAllowed(
    scope,
    OrganizerWalletLedger.RESOURCE_SCOPES,
    "INVALID_LEDGER_SCOPE",
    "scope"
  );

  const geoScopeType = normalizeString(payload.geoScopeType || "none");
  assertAllowed(
    geoScopeType,
    OrganizerWalletLedger.GEO_SCOPE_TYPES,
    "INVALID_LEDGER_GEO_SCOPE_TYPE",
    "geoScopeType"
  );

  const source = payload.source || {};
  const sourceType = normalizeString(source.type);

  assertAllowed(
    sourceType,
    OrganizerWalletLedger.SOURCE_TYPES,
    "INVALID_LEDGER_SOURCE_TYPE",
    "source.type"
  );

  const existing = await OrganizerWalletLedger.findOne({ idempotencyKey }).lean();
  if (existing) {
    return {
      entry: existing,
      created: false,
      idempotent: true,
    };
  }

  try {
    const entry = await OrganizerWalletLedger.create({
      organizerId,
      movementType,
      resourceType,
      quantity,

      balanceImpact: normalizeBalanceImpact(payload.balanceImpact),

      scope,
      geoScopeType,
      isFree: Boolean(payload.isFree),

      source: {
        type: sourceType,
        eventId: source.eventId || null,
        trillId: source.trillId || null,
        bannerId: source.bannerId || null,
        orderId: source.orderId || null,
        adminId: source.adminId || null,
      },

      grantedByEventId: payload.grantedByEventId || null,
      usableByEventId: payload.usableByEventId || null,
      expiresAt: payload.expiresAt || null,

      idempotencyKey,
      reason: payload.reason,
      metadata: payload.metadata || null,
    });

    return {
      entry: entry.toObject(),
      created: true,
      idempotent: false,
    };
  } catch (err) {
    if (err && err.code === 11000) {
      const duplicate = await OrganizerWalletLedger.findOne({ idempotencyKey }).lean();

      return {
        entry: duplicate,
        created: false,
        idempotent: true,
      };
    }

    throw err;
  }
}

async function listLedgerEntries({
  organizerId,
  resourceType,
  movementType,
  limit = 50,
  skip = 0,
} = {}) {
  if (!organizerId) {
    throw buildCommercialError(
      "LEDGER_ORGANIZER_REQUIRED",
      400,
      "organizerId is required."
    );
  }

  const query = { organizerId };

  if (resourceType) query.resourceType = normalizeString(resourceType);
  if (movementType) query.movementType = normalizeString(movementType);

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safeSkip = Math.max(Number(skip) || 0, 0);

  return OrganizerWalletLedger.find(query)
    .sort({ createdAt: -1 })
    .skip(safeSkip)
    .limit(safeLimit)
    .lean();
}

module.exports = {
  createLedgerEntry,
  existsByIdempotencyKey,
  getByIdempotencyKey,
  listLedgerEntries,
};
