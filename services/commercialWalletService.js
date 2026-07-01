// backend/services/commercialWalletService.js
// Commercial Foundation V1 - Wallet service
// Responsabilità: saldo operativo OPW + movimenti ledger.
// Non contiene logica specifica Trilli/Promo/Admin.

const OrganizerWallet = require("../models/organizerWalletModel");
const commercialLedgerService = require("./commercialLedgerService");

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
      "INVALID_WALLET_QUANTITY",
      400,
      "Wallet quantity must be a positive integer."
    );
  }

  return n;
}

function assertAllowed(value, allowed, code, fieldName) {
  if (!allowed.includes(value)) {
    throw buildCommercialError(code, 400, `${fieldName} is not supported.`);
  }
}

function normalizeResourceInput(input = {}) {
  const resourceType = normalizeString(input.resourceType);
  const scope = normalizeString(input.scope || "organizer");
  const geoScopeType = normalizeString(input.geoScopeType || "none");

  assertAllowed(
    resourceType,
    OrganizerWallet.RESOURCE_TYPES,
    "INVALID_WALLET_RESOURCE_TYPE",
    "resourceType"
  );

  assertAllowed(
    scope,
    OrganizerWallet.RESOURCE_SCOPES,
    "INVALID_WALLET_SCOPE",
    "scope"
  );

  assertAllowed(
    geoScopeType,
    OrganizerWallet.GEO_SCOPE_TYPES,
    "INVALID_WALLET_GEO_SCOPE_TYPE",
    "geoScopeType"
  );

  return {
    resourceType,
    scope,
    geoScopeType,
    isFree: Boolean(input.isFree),
    grantedByEventId: input.grantedByEventId || null,
    usableByEventId: input.usableByEventId || null,
    expiresAt: input.expiresAt || null,
    metadata: input.metadata || null,
  };
}

function sameObjectId(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return String(a) === String(b);
}

function sameDate(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

function findMatchingBalance(wallet, resource) {
  return (wallet.balances || []).find((balance) => {
    return (
      balance.resourceType === resource.resourceType &&
      balance.scope === resource.scope &&
      balance.geoScopeType === resource.geoScopeType &&
      Boolean(balance.isFree) === Boolean(resource.isFree) &&
      sameObjectId(balance.grantedByEventId, resource.grantedByEventId) &&
      sameObjectId(balance.usableByEventId, resource.usableByEventId) &&
      sameDate(balance.expiresAt, resource.expiresAt)
    );
  });
}

async function getOrCreateWallet(organizerId) {
  if (!organizerId) {
    throw buildCommercialError(
      "WALLET_ORGANIZER_REQUIRED",
      400,
      "organizerId is required."
    );
  }

  const wallet = await OrganizerWallet.findOneAndUpdate(
    { organizerId },
    {
      $setOnInsert: {
        organizerId,
        balances: [],
        version: 1,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );

  return wallet;
}

async function grantResource({
  organizerId,
  resourceType,
  quantity,
  scope = "organizer",
  geoScopeType = "none",
  isFree = false,
  grantedByEventId = null,
  usableByEventId = null,
  expiresAt = null,
  source,
  idempotencyKey,
  reason,
  metadata = null,
} = {}) {
  const qty = normalizeQuantity(quantity);
  const resource = normalizeResourceInput({
    resourceType,
    scope,
    geoScopeType,
    isFree,
    grantedByEventId,
    usableByEventId,
    expiresAt,
    metadata,
  });

  const existing = await commercialLedgerService.getByIdempotencyKey(idempotencyKey);
  if (existing) {
    const wallet = await getOrCreateWallet(organizerId);
    return {
      wallet: wallet.toObject(),
      ledgerEntry: existing,
      created: false,
      idempotent: true,
    };
  }

  const wallet = await getOrCreateWallet(organizerId);
  const balance = findMatchingBalance(wallet, resource);

  if (balance) {
    balance.quantityAvailable += qty;
    balance.status = "available";
    balance.metadata = resource.metadata || balance.metadata || null;
  } else {
    wallet.balances.push({
      ...resource,
      status: "available",
      quantityAvailable: qty,
      quantityReserved: 0,
      quantityConsumed: 0,
      quantityExpired: 0,
    });
  }

  await wallet.save();

  const ledgerResult = await commercialLedgerService.createLedgerEntry({
    organizerId,
    movementType: isFree ? "grant" : "purchase",
    resourceType: resource.resourceType,
    quantity: qty,
    balanceImpact: {
      available: qty,
      reserved: 0,
      consumed: 0,
      expired: 0,
    },
    scope: resource.scope,
    geoScopeType: resource.geoScopeType,
    isFree: resource.isFree,
    source,
    grantedByEventId: resource.grantedByEventId,
    usableByEventId: resource.usableByEventId,
    expiresAt: resource.expiresAt,
    idempotencyKey,
    reason,
    metadata,
  });

  return {
    wallet: wallet.toObject(),
    ledgerEntry: ledgerResult.entry,
    created: true,
    idempotent: false,
  };
}

async function reserveResource({
  organizerId,
  resourceType,
  quantity,
  scope = "organizer",
  geoScopeType = "none",
  isFree = false,
  usableByEventId = null,
  source,
  idempotencyKey,
  reason,
  metadata = null,
} = {}) {
  const qty = normalizeQuantity(quantity);
  const resource = normalizeResourceInput({
    resourceType,
    scope,
    geoScopeType,
    isFree,
    usableByEventId,
  });

  const existing = await commercialLedgerService.getByIdempotencyKey(idempotencyKey);
  if (existing) {
    const wallet = await getOrCreateWallet(organizerId);
    return {
      wallet: wallet.toObject(),
      ledgerEntry: existing,
      created: false,
      idempotent: true,
    };
  }

  const wallet = await getOrCreateWallet(organizerId);

  const candidates = (wallet.balances || [])
    .filter((balance) => {
      if (balance.resourceType !== resource.resourceType) return false;
      if (balance.scope !== resource.scope) return false;
      if (balance.geoScopeType !== resource.geoScopeType) return false;
      if (Boolean(balance.isFree) !== Boolean(resource.isFree)) return false;
      if (resource.usableByEventId && !sameObjectId(balance.usableByEventId, resource.usableByEventId)) {
        return false;
      }
      if (balance.expiresAt && new Date(balance.expiresAt).getTime() <= Date.now()) {
        return false;
      }
      return Number(balance.quantityAvailable || 0) > 0;
    })
    .sort((a, b) => {
      const aExp = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bExp = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aExp - bExp;
    });

  let remaining = qty;

  for (const balance of candidates) {
    if (remaining <= 0) break;

    const take = Math.min(Number(balance.quantityAvailable || 0), remaining);
    balance.quantityAvailable -= take;
    balance.quantityReserved += take;
    balance.status = balance.quantityAvailable > 0 ? "available" : "reserved";
    remaining -= take;
  }

  if (remaining > 0) {
    throw buildCommercialError(
      "INSUFFICIENT_WALLET_RESOURCES",
      409,
      "Not enough wallet resources available."
    );
  }

  await wallet.save();

  const ledgerResult = await commercialLedgerService.createLedgerEntry({
    organizerId,
    movementType: "reserve",
    resourceType: resource.resourceType,
    quantity: qty,
    balanceImpact: {
      available: -qty,
      reserved: qty,
      consumed: 0,
      expired: 0,
    },
    scope: resource.scope,
    geoScopeType: resource.geoScopeType,
    isFree: resource.isFree,
    source,
    usableByEventId: resource.usableByEventId,
    idempotencyKey,
    reason,
    metadata,
  });

  return {
    wallet: wallet.toObject(),
    ledgerEntry: ledgerResult.entry,
    created: true,
    idempotent: false,
  };
}

async function consumeReservedResource({
  organizerId,
  resourceType,
  quantity,
  scope = "organizer",
  geoScopeType = "none",
  isFree = false,
  usableByEventId = null,
  source,
  idempotencyKey,
  reason,
  metadata = null,
} = {}) {
  const qty = normalizeQuantity(quantity);
  const resource = normalizeResourceInput({
    resourceType,
    scope,
    geoScopeType,
    isFree,
    usableByEventId,
  });

  const existing = await commercialLedgerService.getByIdempotencyKey(idempotencyKey);
  if (existing) {
    const wallet = await getOrCreateWallet(organizerId);
    return {
      wallet: wallet.toObject(),
      ledgerEntry: existing,
      created: false,
      idempotent: true,
    };
  }

  const wallet = await getOrCreateWallet(organizerId);

  const candidates = (wallet.balances || []).filter((balance) => {
    if (balance.resourceType !== resource.resourceType) return false;
    if (balance.scope !== resource.scope) return false;
    if (balance.geoScopeType !== resource.geoScopeType) return false;
    if (Boolean(balance.isFree) !== Boolean(resource.isFree)) return false;
    if (resource.usableByEventId && !sameObjectId(balance.usableByEventId, resource.usableByEventId)) {
      return false;
    }
    return Number(balance.quantityReserved || 0) > 0;
  });

  let remaining = qty;

  for (const balance of candidates) {
    if (remaining <= 0) break;

    const take = Math.min(Number(balance.quantityReserved || 0), remaining);
    balance.quantityReserved -= take;
    balance.quantityConsumed += take;
    balance.status = balance.quantityReserved > 0 ? "reserved" : "consumed";
    remaining -= take;
  }

  if (remaining > 0) {
    throw buildCommercialError(
      "INSUFFICIENT_RESERVED_RESOURCES",
      409,
      "Not enough reserved wallet resources to consume."
    );
  }

  await wallet.save();

  const ledgerResult = await commercialLedgerService.createLedgerEntry({
    organizerId,
    movementType: "consume",
    resourceType: resource.resourceType,
    quantity: qty,
    balanceImpact: {
      available: 0,
      reserved: -qty,
      consumed: qty,
      expired: 0,
    },
    scope: resource.scope,
    geoScopeType: resource.geoScopeType,
    isFree: resource.isFree,
    source,
    usableByEventId: resource.usableByEventId,
    idempotencyKey,
    reason,
    metadata,
  });

  return {
    wallet: wallet.toObject(),
    ledgerEntry: ledgerResult.entry,
    created: true,
    idempotent: false,
  };
}

async function releaseReservedResource({
  organizerId,
  resourceType,
  quantity,
  scope = "organizer",
  geoScopeType = "none",
  isFree = false,
  usableByEventId = null,
  source,
  idempotencyKey,
  reason,
  metadata = null,
} = {}) {
  const qty = normalizeQuantity(quantity);
  const resource = normalizeResourceInput({
    resourceType,
    scope,
    geoScopeType,
    isFree,
    usableByEventId,
  });

  const existing = await commercialLedgerService.getByIdempotencyKey(idempotencyKey);
  if (existing) {
    const wallet = await getOrCreateWallet(organizerId);
    return {
      wallet: wallet.toObject(),
      ledgerEntry: existing,
      created: false,
      idempotent: true,
    };
  }

  const wallet = await getOrCreateWallet(organizerId);

  const candidates = (wallet.balances || []).filter((balance) => {
    if (balance.resourceType !== resource.resourceType) return false;
    if (balance.scope !== resource.scope) return false;
    if (balance.geoScopeType !== resource.geoScopeType) return false;
    if (Boolean(balance.isFree) !== Boolean(resource.isFree)) return false;
    if (resource.usableByEventId && !sameObjectId(balance.usableByEventId, resource.usableByEventId)) {
      return false;
    }
    return Number(balance.quantityReserved || 0) > 0;
  });

  let remaining = qty;

  for (const balance of candidates) {
    if (remaining <= 0) break;

    const take = Math.min(Number(balance.quantityReserved || 0), remaining);
    balance.quantityReserved -= take;
    balance.quantityAvailable += take;
    balance.status = "available";
    remaining -= take;
  }

  if (remaining > 0) {
    throw buildCommercialError(
      "INSUFFICIENT_RESERVED_RESOURCES",
      409,
      "Not enough reserved wallet resources to release."
    );
  }

  await wallet.save();

  const ledgerResult = await commercialLedgerService.createLedgerEntry({
    organizerId,
    movementType: "release",
    resourceType: resource.resourceType,
    quantity: qty,
    balanceImpact: {
      available: qty,
      reserved: -qty,
      consumed: 0,
      expired: 0,
    },
    scope: resource.scope,
    geoScopeType: resource.geoScopeType,
    isFree: resource.isFree,
    source,
    usableByEventId: resource.usableByEventId,
    idempotencyKey,
    reason,
    metadata,
  });

  return {
    wallet: wallet.toObject(),
    ledgerEntry: ledgerResult.entry,
    created: true,
    idempotent: false,
  };
}

async function expireAvailableResources({
  organizerId,
  now = new Date(),
  idempotencyPrefix = "lazy_expire",
  reason = "Lazy expiration of expired wallet resources.",
} = {}) {
  if (!organizerId) {
    throw buildCommercialError(
      "WALLET_ORGANIZER_REQUIRED",
      400,
      "organizerId is required."
    );
  }

  const wallet = await getOrCreateWallet(organizerId);
  const nowTime = new Date(now).getTime();
  const expiredMovements = [];

  for (const balance of wallet.balances || []) {
    const available = Number(balance.quantityAvailable || 0);

    if (!balance.expiresAt || available <= 0) continue;

    const expiresAtTime = new Date(balance.expiresAt).getTime();
    if (expiresAtTime > nowTime) continue;

    balance.quantityAvailable = 0;
    balance.quantityExpired += available;
    balance.status = "expired";

    const idempotencyKey = `${idempotencyPrefix}:${organizerId}:${balance._id}`;

    const ledgerResult = await commercialLedgerService.createLedgerEntry({
      organizerId,
      movementType: "expire",
      resourceType: balance.resourceType,
      quantity: available,
      balanceImpact: {
        available: -available,
        reserved: 0,
        consumed: 0,
        expired: available,
      },
      scope: balance.scope,
      geoScopeType: balance.geoScopeType || "none",
      isFree: Boolean(balance.isFree),
      source: {
        type: "system",
      },
      grantedByEventId: balance.grantedByEventId || null,
      usableByEventId: balance.usableByEventId || null,
      expiresAt: balance.expiresAt || null,
      idempotencyKey,
      reason,
      metadata: {
        walletBalanceId: String(balance._id),
      },
    });

    expiredMovements.push(ledgerResult.entry);
  }

  if (expiredMovements.length > 0) {
    await wallet.save();
  }

  return {
    wallet: wallet.toObject(),
    expiredCount: expiredMovements.length,
    expiredMovements,
  };
}

async function getWalletSnapshot(organizerId) {
  const wallet = await getOrCreateWallet(organizerId);
  return wallet.toObject();
}

module.exports = {
  getOrCreateWallet,
  getWalletSnapshot,
  grantResource,
  reserveResource,
  consumeReservedResource,
  releaseReservedResource,
  expireAvailableResources,
};
