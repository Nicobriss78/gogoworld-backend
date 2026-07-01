// backend/services/commercialPricingService.js
// Commercial Foundation V1 - Pricing / Resource Cost service
// Responsabilità: calcolare il costo in risorse commerciali.
// Non scrive wallet. Non scrive ledger. Non approva promo.

const PROMO_SCOPE_TYPES = [
  "single_region",
  "multi_region",
  "single_country",
  "multi_country",
  "global",
];

const PROMO_RESOURCE_TYPES = [
  "promo.region.days",
  "promo.country.days",
  "promo.global.days",
];

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

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => normalizeString(item))
    .filter(Boolean);
}

function normalizePositiveInteger(value, fieldName) {
  const n = Number(value);

  if (!Number.isInteger(n) || n <= 0) {
    throw buildCommercialError(
      "INVALID_COMMERCIAL_POSITIVE_INTEGER",
      400,
      `${fieldName} must be a positive integer.`
    );
  }

  return n;
}

function diffDaysInclusive(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw buildCommercialError(
      "INVALID_PROMO_DATE_RANGE",
      400,
      "Promo start and end dates must be valid."
    );
  }

  const startUtc = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate()
  );

  const endUtc = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate()
  );

  if (endUtc < startUtc) {
    throw buildCommercialError(
      "INVALID_PROMO_DATE_RANGE",
      400,
      "Promo end date cannot be before start date."
    );
  }

  return Math.floor((endUtc - startUtc) / 86400000) + 1;
}

function normalizePromoGeoScope(geoScope = {}) {
  const scopeType = normalizeString(geoScope.scopeType);

  if (!PROMO_SCOPE_TYPES.includes(scopeType)) {
    throw buildCommercialError(
      "INVALID_PROMO_GEO_SCOPE_TYPE",
      400,
      "Promo geo scope type is not supported."
    );
  }

  const regions = normalizeStringArray(geoScope.regions);
  const countries = normalizeStringArray(geoScope.countries);

  if (scopeType === "single_region") {
    if (regions.length !== 1) {
      throw buildCommercialError(
        "INVALID_PROMO_REGION_SELECTION",
        400,
        "single_region requires exactly one region."
      );
    }

    if (countries.length > 1) {
      throw buildCommercialError(
        "INVALID_PROMO_COUNTRY_SELECTION",
        400,
        "single_region cannot contain multiple countries."
      );
    }
  }

  if (scopeType === "multi_region") {
    if (regions.length < 2) {
      throw buildCommercialError(
        "INVALID_PROMO_REGION_SELECTION",
        400,
        "multi_region requires at least two regions."
      );
    }

    if (countries.length > 1) {
      throw buildCommercialError(
        "INVALID_PROMO_COUNTRY_SELECTION",
        400,
        "multi_region cannot contain multiple countries in V1."
      );
    }
  }

  if (scopeType === "single_country") {
    if (countries.length !== 1) {
      throw buildCommercialError(
        "INVALID_PROMO_COUNTRY_SELECTION",
        400,
        "single_country requires exactly one country."
      );
    }

    if (regions.length > 0) {
      throw buildCommercialError(
        "INVALID_PROMO_REGION_SELECTION",
        400,
        "single_country cannot contain regions."
      );
    }
  }

  if (scopeType === "multi_country") {
    if (countries.length < 2) {
      throw buildCommercialError(
        "INVALID_PROMO_COUNTRY_SELECTION",
        400,
        "multi_country requires at least two countries."
      );
    }

    if (regions.length > 0) {
      throw buildCommercialError(
        "INVALID_PROMO_REGION_SELECTION",
        400,
        "multi_country cannot contain regions."
      );
    }
  }

  if (scopeType === "global") {
    if (regions.length > 0 || countries.length > 0) {
      throw buildCommercialError(
        "INVALID_PROMO_GLOBAL_SELECTION",
        400,
        "global promo scope cannot contain regions or countries."
      );
    }
  }

  return {
    scopeType,
    regions,
    countries,
  };
}

function resolvePromoResourceType(scopeType) {
  if (scopeType === "single_region" || scopeType === "multi_region") {
    return "promo.region.days";
  }

  if (scopeType === "single_country" || scopeType === "multi_country") {
    return "promo.country.days";
  }

  if (scopeType === "global") {
    return "promo.global.days";
  }

  throw buildCommercialError(
    "INVALID_PROMO_GEO_SCOPE_TYPE",
    400,
    "Promo geo scope type is not supported."
  );
}

function resolvePromoGeoUnitCount(normalizedGeoScope) {
  const { scopeType, regions, countries } = normalizedGeoScope;

  if (scopeType === "single_region") return 1;
  if (scopeType === "multi_region") return regions.length;
  if (scopeType === "single_country") return 1;
  if (scopeType === "multi_country") return countries.length;
  if (scopeType === "global") return 1;

  throw buildCommercialError(
    "INVALID_PROMO_GEO_SCOPE_TYPE",
    400,
    "Promo geo scope type is not supported."
  );
}

function calculatePromoResourceCost({
  startDate,
  endDate,
  days,
  geoScope,
  placement = null,
  metadata = null,
} = {}) {
  const durationDays =
    days == null ? diffDaysInclusive(startDate, endDate) : normalizePositiveInteger(days, "days");

  const normalizedGeoScope = normalizePromoGeoScope(geoScope);
  const geoUnitCount = resolvePromoGeoUnitCount(normalizedGeoScope);
  const resourceType = resolvePromoResourceType(normalizedGeoScope.scopeType);
  const quantity = durationDays * geoUnitCount;

  return {
    resourceType,
    quantity,
    scope: "organizer",
    geoScopeType: normalizedGeoScope.scopeType,
    durationDays,
    geoUnitCount,
    geoScope: normalizedGeoScope,
    placement,
    metadata,
  };
}

function calculatePromoResourcesForOrder(input = {}) {
  const cost = calculatePromoResourceCost(input);

  return [
    {
      resourceType: cost.resourceType,
      quantity: cost.quantity,
      scope: cost.scope,
      geoScopeType: cost.geoScopeType,
      validityDays: null,
      metadata: {
        durationDays: cost.durationDays,
        geoUnitCount: cost.geoUnitCount,
        geoScope: cost.geoScope,
        placement: cost.placement || null,
        backendStage: "commercial_foundation_v1_pricing",
        ...(cost.metadata || {}),
      },
    },
  ];
}

function normalizeLegacyPromoGeoScope({ geoScope, country, region } = {}) {
  const legacyScope = normalizeString(geoScope).toUpperCase();
  const normalizedCountry = normalizeString(country);
  const normalizedRegion = normalizeString(region);

  if (legacyScope === "REGION") {
    if (!normalizedRegion) {
      throw buildCommercialError(
        "INVALID_LEGACY_PROMO_REGION",
        400,
        "Legacy REGION promo requires region."
      );
    }

    return {
      scopeType: "single_region",
      regions: [normalizedRegion],
      countries: normalizedCountry ? [normalizedCountry] : [],
    };
  }

  if (legacyScope === "COUNTRY") {
    if (!normalizedCountry) {
      throw buildCommercialError(
        "INVALID_LEGACY_PROMO_COUNTRY",
        400,
        "Legacy COUNTRY promo requires country."
      );
    }

    return {
      scopeType: "single_country",
      regions: [],
      countries: [normalizedCountry],
    };
  }

  if (legacyScope === "GLOBAL") {
    return {
      scopeType: "global",
      regions: [],
      countries: [],
    };
  }

  throw buildCommercialError(
    "INVALID_LEGACY_PROMO_GEO_SCOPE",
    400,
    "Legacy promo geo scope is not supported."
  );
}

module.exports = {
  PROMO_SCOPE_TYPES,
  PROMO_RESOURCE_TYPES,
  calculatePromoResourceCost,
  calculatePromoResourcesForOrder,
  normalizeLegacyPromoGeoScope,
  normalizePromoGeoScope,
};
