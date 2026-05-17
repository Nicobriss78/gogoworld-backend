// backend/services/bannerPricingService.js
// Pricing minimale Promozioni/Banner V2 — payment-ready senza provider reale

const ALLOWED_GEO_SCOPES = ["REGION", "COUNTRY", "GLOBAL"];

const BASE_PRICE = 5;
const PLATFORM_FACTOR = 1;

const SCOPE_MULTIPLIERS = {
  REGION: 1,
  COUNTRY: 4,
  GLOBAL: 10,
};

const PLACEMENT_MULTIPLIERS = {
  events_list_inline: 1,
  home_top: 2.5,
};

function normalizeGeoScope(input) {
  const value = String(input || "REGION").trim().toUpperCase();
  return ALLOWED_GEO_SCOPES.includes(value) ? value : "REGION";
}

function normalizeGeoTarget(payload = {}) {
  const geoScope = normalizeGeoScope(payload.geoScope);

  const country = payload.country
    ? String(payload.country).trim().toUpperCase()
    : null;

  const region = payload.region
    ? String(payload.region).trim()
    : null;

  if (geoScope === "GLOBAL") {
    return {
      geoScope,
      country: null,
      region: null,
    };
  }

  if (geoScope === "COUNTRY") {
    if (!country) {
      const err = new Error("country is required for COUNTRY geoScope");
      err.statusCode = 400;
      err.code = "country_required";
      throw err;
    }

    return {
      geoScope,
      country,
      region: null,
    };
  }

  if (!country) {
    const err = new Error("country is required for REGION geoScope");
    err.statusCode = 400;
    err.code = "country_required";
    throw err;
  }

  if (!region) {
    const err = new Error("region is required for REGION geoScope");
    err.statusCode = 400;
    err.code = "region_required";
    throw err;
  }

  return {
    geoScope,
    country,
    region,
  };
}

function parseDate(value, fieldName) {
  if (!value) {
    const err = new Error(`${fieldName} is required`);
    err.statusCode = 400;
    err.code = `${fieldName}_required`;
    throw err;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const err = new Error(`${fieldName} is invalid`);
    err.statusCode = 400;
    err.code = `${fieldName}_invalid`;
    throw err;
  }

  return date;
}

function startOfUtcDay(date) {
const d = new Date(date);
d.setUTCHours(0, 0, 0, 0);
return d;
}

function addUtcDays(date, days) {
const d = new Date(date);
d.setUTCDate(d.getUTCDate() + Number(days || 0));
return d;
}

function calculateDurationDays(activeFrom, activeTo) {
const from = startOfUtcDay(parseDate(activeFrom, "activeFrom"));
const inclusiveTo = startOfUtcDay(parseDate(activeTo, "activeTo"));
const exclusiveTo = addUtcDays(inclusiveTo, 1);

if (exclusiveTo <= from) {
const err = new Error("activeTo must be same day or after activeFrom");
err.statusCode = 400;
err.code = "invalid_date_range";
throw err;
}

const ms = exclusiveTo.getTime() - from.getTime();
return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function estimateBannerPrice(payload = {}) {
  const target = normalizeGeoTarget(payload);

  const placement = String(payload.placement || "").trim();
  if (!placement) {
    const err = new Error("placement is required");
    err.statusCode = 400;
    err.code = "placement_required";
    throw err;
  }

  const placementMultiplier = PLACEMENT_MULTIPLIERS[placement];
  if (!placementMultiplier) {
    const err = new Error("unsupported placement");
    err.statusCode = 400;
    err.code = "unsupported_placement";
    throw err;
  }

  const durationDays = calculateDurationDays(payload.activeFrom, payload.activeTo);
  const durationMultiplier = durationDays;

  const scopeMultiplier = SCOPE_MULTIPLIERS[target.geoScope] || 1;

  const finalPrice = roundMoney(
    BASE_PRICE *
      scopeMultiplier *
      placementMultiplier *
      durationMultiplier *
      PLATFORM_FACTOR
  );

  return {
    estimatedPrice: finalPrice,
    currency: "EUR",
    pricingSnapshot: {
      geoScope: target.geoScope,
      scopeMultiplier,
      placement,
      placementMultiplier,
      durationDays,
      durationMultiplier,
      platformFactor: PLATFORM_FACTOR,
      basePrice: BASE_PRICE,
      finalPrice,
    },
    normalizedTarget: target,
  };
}

module.exports = {
  ALLOWED_GEO_SCOPES,
  estimateBannerPrice,
  normalizeGeoTarget,
};
