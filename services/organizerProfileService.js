// backend/services/organizerProfileService.js
// Organizer Profile Engine V0 — profilo sintetico prudente per GGW Consultant

const { Banner } = require("../models/bannerModel");
const Event = require("../models/eventModel");

const ORGANIZER_PROFILE_VERSION = "ORGANIZER_PROFILE_V0";

const PROFILE_MATURITY = {
  EMPTY: "EMPTY",
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
};

const PAID_OR_ACTIONABLE_PROMO_STATUSES = [
  "PENDING_PAYMENT",
  "AWAITING_PAYMENT",
  "SCHEDULED",
  "ACTIVE",
  "ENDED",
];

function emptyOrganizerProfile({ organizerId = null, note = "Dati insufficienti." } = {}) {
  return {
    version: ORGANIZER_PROFILE_VERSION,
    available: false,
    maturity: PROFILE_MATURITY.EMPTY,

    organizerId: organizerId ? String(organizerId) : null,

    eventStyle: null,
    promoBehavior: null,
    budgetProfile: null,
    preferredPlacement: null,
    preferredDuration: null,
    trillAffinity: null,

    signals: {
      eventsCount: 0,
      promosCount: 0,
      paidPromosCount: 0,
      averagePromoBudget: null,
      averagePromoDurationDays: null,
      preferredPlacements: [],
      eventCategories: [],
      geoAreas: [],
    },

    notes: [note],
  };
}

function normalizeId(value) {
  return value ? String(value) : "";
}

function daysBetweenInclusiveSafe(from, to) {
  const start = from ? new Date(from) : null;
  const end = to ? new Date(to) : null;

  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const startDay = new Date(start);
  const endDay = new Date(end);
  startDay.setUTCHours(0, 0, 0, 0);
  endDay.setUTCHours(0, 0, 0, 0);

  const diff = Math.round((endDay.getTime() - startDay.getTime()) / (24 * 60 * 60 * 1000));

  if (diff < 0) return null;

  return diff + 1;
}

function average(values = []) {
  const clean = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (!clean.length) return null;

  const total = clean.reduce((sum, value) => sum + value, 0);
  return Math.round((total / clean.length) * 100) / 100;
}

function buildRankedList(values = [], { limit = 5 } = {}) {
  const counts = new Map();

  values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .forEach((value) => {
      counts.set(value, (counts.get(value) || 0) + 1);
    });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function getMaturity({ eventsCount = 0, promosCount = 0 }) {
  if (eventsCount <= 0 && promosCount <= 0) return PROFILE_MATURITY.EMPTY;
  if (eventsCount >= 15 || promosCount >= 8) return PROFILE_MATURITY.HIGH;
  if (eventsCount >= 6 || promosCount >= 3) return PROFILE_MATURITY.MEDIUM;
  return PROFILE_MATURITY.LOW;
}

function getPreferredPlacement(preferredPlacements = []) {
  return preferredPlacements[0]?.value || null;
}

function getPreferredDuration(averageDuration) {
  if (!Number.isFinite(Number(averageDuration))) return null;

  if (averageDuration <= 5) return "SHORT";
  if (averageDuration <= 14) return "MEDIUM";
  return "LONG";
}
function buildBudgetProfile(averagePromoBudget) {
  const budget = Number(averagePromoBudget);

  if (!Number.isFinite(budget)) {
    return null;
  }

  if (budget < 25) {
    return {
      code: "LOW",
      label: "Budget prudente",
    };
  }

  if (budget < 75) {
    return {
      code: "MEDIUM",
      label: "Budget equilibrato",
    };
  }

  return {
    code: "HIGH",
    label: "Budget importante",
  };
}

function buildPromoBehavior({
  promosCount = 0,
  paidPromosCount = 0,
}) {
  if (!promosCount) {
    return null;
  }

  const conversionRate = paidPromosCount / promosCount;

  if (promosCount >= 10 && conversionRate >= 0.65) {
    return {
      code: "DECISIVE",
      label: "Deciso",
    };
  }

  if (conversionRate >= 0.70) {
    return {
      code: "SELECTIVE",
      label: "Selettivo",
    };
  }

  return {
    code: "EXPLORER",
    label: "Esploratore",
  };
}
async function buildOrganizerProfile({ organizerId } = {}) {
  const normalizedOrganizerId = normalizeId(organizerId);

  if (!normalizedOrganizerId) {
    return emptyOrganizerProfile({
      organizerId: null,
      note: "Organizer non identificato.",
    });
  }

  const [events, promos] = await Promise.all([
    Event.find({ organizer: normalizedOrganizerId })
      .select("category region country createdAt dateStart")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),

    Banner.find({
      source: "organizer",
      type: "event_promo",
      createdBy: normalizedOrganizerId,
    })
      .select("placement estimatedPrice status paymentStatus region country activeFrom activeTo createdAt")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
  ]);

  const eventsCount = events.length;
  const promosCount = promos.length;
  const paidPromosCount = promos.filter((promo) =>
    PAID_OR_ACTIONABLE_PROMO_STATUSES.includes(String(promo.status || "").toUpperCase())
  ).length;

  const averagePromoBudget = average(
    promos
      .map((promo) => promo.estimatedPrice)
      .filter((value) => Number(value) > 0)
  );

  const averagePromoDurationDays = average(
    promos
      .map((promo) => daysBetweenInclusiveSafe(promo.activeFrom, promo.activeTo))
      .filter((value) => Number(value) > 0)
  );

  const preferredPlacements = buildRankedList(
    promos.map((promo) => promo.placement),
    { limit: 5 }
  );

  const eventCategories = buildRankedList(
    events.map((event) => event.category),
    { limit: 5 }
  );

  const geoAreas = buildRankedList(
    [
      ...events.map((event) => [event.country, event.region].filter(Boolean).join(" / ")),
      ...promos.map((promo) => [promo.country, promo.region].filter(Boolean).join(" / ")),
    ],
    { limit: 5 }
  );

  const maturity = getMaturity({ eventsCount, promosCount });
  const available = maturity !== PROFILE_MATURITY.EMPTY;

  return {
    version: ORGANIZER_PROFILE_VERSION,
    available,
    maturity,

    organizerId: normalizedOrganizerId,

    eventStyle: null,
    promoBehavior: null,
    budgetProfile: null,
    preferredPlacement: getPreferredPlacement(preferredPlacements),
    preferredDuration: getPreferredDuration(averagePromoDurationDays),
    trillAffinity: null,

    signals: {
      eventsCount,
      promosCount,
      paidPromosCount,
      averagePromoBudget,
      averagePromoDurationDays,
      preferredPlacements,
      eventCategories,
      geoAreas,
    },

    notes: available
      ? ["Profilo V0 costruito da eventi e promozioni esistenti. Non influenza ancora le strategie."]
      : ["Dati storici insufficienti. Il profilo non influenza ancora le strategie."],
  };
}

module.exports = {
  ORGANIZER_PROFILE_VERSION,
  PROFILE_MATURITY,
  buildOrganizerProfile,
};
