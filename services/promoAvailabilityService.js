// backend/services/promoAvailabilityService.js
// Availability Engine V1 — capacità reale promozioni Organizer V2

const mongoose = require("mongoose");
const { Banner } = require("../models/bannerModel");
const Event = require("../models/eventModel");
const { normalizeGeoTarget } = require("./bannerPricingService");

const OCCUPYING_STATUSES = [
  "PENDING_REVIEW",
  "PENDING_PAYMENT",
  "SCHEDULED",
  "ACTIVE",
];

const PLACEMENT_RULES = {
  events_list_inline: {
    defaultCapacity: 6,
    lowAvailabilityThreshold: 2,
  },
  home_top: {
    defaultCapacity: 2,
    lowAvailabilityThreshold: 1,
  },
};

const PLACEMENT_CAPACITY = Object.entries(PLACEMENT_RULES).reduce(
  (acc, [placement, rule]) => {
    acc[placement] = rule.defaultCapacity;
    return acc;
  },
  {}
);

const MIN_DURATION_DAYS = 1;
const MAX_DURATION_DAYS = 30;
const MAX_BOOKING_WINDOW_DAYS = 90;

function makeValidationError(code, message, statusCode = 400) {
  const err = new Error(message || code);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function parseDate(value, fieldName) {
  if (!value) {
    throw makeValidationError(
      `${fieldName.toUpperCase()}_REQUIRED`,
      `${fieldName} is required`
    );
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw makeValidationError("INVALID_DATE_RANGE", `${fieldName} is invalid`);
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

function formatUtcDay(date) {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

function calculateDurationDays(activeFrom, activeTo) {
  const ms = activeTo.getTime() - activeFrom.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function normalizeInclusivePromoRange(activeFromRaw, activeToRaw) {
  const activeFrom = startOfUtcDay(activeFromRaw);
  const inclusiveActiveTo = startOfUtcDay(activeToRaw);
  const exclusiveActiveTo = addUtcDays(inclusiveActiveTo, 1);

  return {
    activeFrom,
    inclusiveActiveTo,
    exclusiveActiveTo,
  };
}

function buildDays(activeFrom, activeTo) {
  const days = [];
  let cursor = startOfUtcDay(activeFrom);
  const end = startOfUtcDay(activeTo);

  while (cursor < end) {
    days.push(formatUtcDay(cursor));
    cursor = addUtcDays(cursor, 1);
  }

  return days;
}

function getPlacementRule(placement) {
  const rule = PLACEMENT_RULES[placement];

  if (!rule || !Number(rule.defaultCapacity)) {
    throw makeValidationError("UNSUPPORTED_PLACEMENT", "unsupported placement");
  }

  return {
    defaultCapacity: Number(rule.defaultCapacity),
    lowAvailabilityThreshold: Math.max(
      1,
      Number(rule.lowAvailabilityThreshold || 1)
    ),
  };
}

function getPlacementCapacity(placement) {
  return getPlacementRule(placement).defaultCapacity;
}

function buildGeoCompetitionFilter(target) {
  if (target.geoScope === "GLOBAL") {
    return {
      geoScope: "GLOBAL",
    };
  }

  if (target.geoScope === "COUNTRY") {
    return {
      $or: [
        { geoScope: "GLOBAL" },
        { geoScope: "COUNTRY", country: target.country },
      ],
    };
  }

  return {
    $or: [
      { geoScope: "GLOBAL" },
      { geoScope: "COUNTRY", country: target.country },
      { geoScope: "REGION", country: target.country, region: target.region },
    ],
  };
}

function buildOverlapFilter(activeFrom, activeTo) {
  return {
    $and: [
      { $or: [{ activeFrom: null }, { activeFrom: { $lt: activeTo } }] },
      { $or: [{ activeTo: null }, { activeTo: { $gt: activeFrom } }] },
    ],
  };
}

async function loadEventForValidation(eventId) {
  if (!eventId) {
    throw makeValidationError("EVENT_ID_REQUIRED", "eventId is required");
  }

  if (!mongoose.Types.ObjectId.isValid(eventId)) {
    throw makeValidationError("INVALID_EVENT_ID", "eventId is invalid");
  }

  const event = await Event.findById(eventId)
    .select("dateStart dateEnd country region category subcategory")
    .lean();

  if (!event) {
    throw makeValidationError("EVENT_NOT_FOUND", "event not found", 404);
  }

  return event;
}

function validateTemporalRules({ activeFrom, activeTo, inclusiveActiveTo, event, now = new Date() }) {  if (activeTo <= activeFrom) {
    throw makeValidationError(
      "INVALID_DATE_RANGE",
      "activeTo must be after activeFrom"
    );
  }

  const durationDays = calculateDurationDays(activeFrom, activeTo);

if (activeFrom < startOfUtcDay(now)) {
  throw makeValidationError(
    "EVENT_ALREADY_STARTED",
    "promo cannot start in a past day"
  );
}

if (durationDays < MIN_DURATION_DAYS) {
    throw makeValidationError(
      "MIN_DURATION_NOT_MET",
      "minimum promo duration is 1 day"
    );
  }

  if (durationDays > MAX_DURATION_DAYS) {
    throw makeValidationError(
      "MAX_DURATION_EXCEEDED",
      "maximum promo duration exceeded"
    );
  }

  const maxBookingTo = addUtcDays(
    startOfUtcDay(now),
    MAX_BOOKING_WINDOW_DAYS + 1
  );

  if (activeFrom >= maxBookingTo) {
    throw makeValidationError(
      "BOOKING_WINDOW_EXCEEDED",
      "booking window exceeded"
    );
  }

  const eventEnd = event && event.dateEnd ? new Date(event.dateEnd) : null;

  if (eventEnd && eventEnd < now) {
    throw makeValidationError("EVENT_ALREADY_ENDED", "event already ended");
  }

if (eventEnd) {
  const eventEndDay = startOfUtcDay(eventEnd);
  const promoEndDay = startOfUtcDay(inclusiveActiveTo || addUtcDays(activeTo, -1));

  if (promoEndDay > eventEndDay) {
    throw makeValidationError(
      "PROMO_AFTER_EVENT_END",
      "promo cannot end after event end day"
    );
  }
}

  return { durationDays };
}

function buildBaseFilter({ placement, target, activeFrom, activeTo, excludeBannerId }) {
  const filter = {
    placement,
    status: { $in: OCCUPYING_STATUSES },
    ...buildGeoCompetitionFilter(target),
  };

  const overlap = buildOverlapFilter(activeFrom, activeTo);

  filter.$and = Array.isArray(filter.$and)
    ? filter.$and.concat(overlap.$and)
    : overlap.$and;

  if (excludeBannerId && mongoose.Types.ObjectId.isValid(excludeBannerId)) {
    filter._id = { $ne: excludeBannerId };
  }

  return filter;
}

function countUsageByDay({ requestedDays, occupyingBanners }) {
  const usageByDay = new Map(requestedDays.map((day) => [day, 0]));

  occupyingBanners.forEach((banner) => {
    const bannerFrom = banner.activeFrom ? new Date(banner.activeFrom) : null;
    const bannerTo = banner.activeTo ? new Date(banner.activeTo) : null;

    requestedDays.forEach((day) => {
      const dayStart = new Date(`${day}T00:00:00.000Z`);
      const dayEnd = addUtcDays(dayStart, 1);

      const overlapsDay =
        (!bannerFrom || bannerFrom < dayEnd) &&
        (!bannerTo || bannerTo > dayStart);

      if (overlapsDay) {
        usageByDay.set(day, (usageByDay.get(day) || 0) + 1);
      }
    });
  });

  return usageByDay;
}

function buildAvailabilityResult({
  requestedDays,
  capacity,
  usageByDay,
  lowAvailabilityThreshold,
}) {
  const threshold = Math.max(1, Number(lowAvailabilityThreshold || 1));

  const days = requestedDays.map((date) => {
    const used = usageByDay.get(date) || 0;
    const remaining = Math.max(0, capacity - used);

    let status = "AVAILABLE";

    if (remaining <= 0) {
      status = "UNAVAILABLE";
    } else if (remaining <= threshold) {
      status = "LOW_AVAILABILITY";
    }

    return {
      date,
      capacity,
      used,
      remaining,
      status,
    };
  });

  const blockedDays = days.filter((day) => day.remaining <= 0);
  const limitedDays = days.filter(
    (day) => day.remaining > 0 && day.remaining <= threshold
  );
  const availableDays = days.filter((day) => day.remaining > 0);

  const remainingSlotsAverage = days.length
    ? Math.round(
        (days.reduce((sum, day) => sum + day.remaining, 0) / days.length) * 100
      ) / 100
    : 0;

  const remainingMinSlots = days.length
    ? Math.min(...days.map((day) => day.remaining))
    : 0;

  let status = "AVAILABLE";

  if (!days.length || blockedDays.length === days.length) {
    status = "UNAVAILABLE";
  } else if (blockedDays.length > 0) {
    status = "PARTIALLY_AVAILABLE";
  } else if (limitedDays.length > 0) {
    status = "LOW_AVAILABILITY";
  }

  const legacyAvailabilityStatus =
    status === "AVAILABLE"
      ? "COMPLETELY_AVAILABLE"
      : status === "LOW_AVAILABILITY"
      ? "PARTIALLY_AVAILABLE"
      : status;

  const messageByStatus = {
    AVAILABLE: "Disponibilità buona nel periodo selezionato.",
    LOW_AVAILABILITY: "Ultimi slot disponibili per alcuni giorni selezionati.",
    PARTIALLY_AVAILABLE: "Alcuni giorni del periodo selezionato risultano già pieni.",
    UNAVAILABLE: "Periodo non disponibile per il placement selezionato.",
  };

  return {
    available: status !== "UNAVAILABLE",
    status,
    availabilityStatus: legacyAvailabilityStatus,
    availabilityLevel: status,
    totalDays: days.length,
    requestedDays: days.length,
    availableCount: availableDays.length,
    availableDaysCount: availableDays.length,
    blockedCount: blockedDays.length,
    fullDaysCount: blockedDays.length,
    limitedCount: limitedDays.length,
    limitedDaysCount: limitedDays.length,
    availableDays,
    limitedDays,
    blockedDays,
    fullDays: blockedDays,
    remainingSlotsAverage,
    remainingMinSlots,
    lowAvailabilityThreshold: threshold,
    message: messageByStatus[status],
    days,
  };
}

async function checkPromoAvailability(payload = {}) {
  const placement = String(payload.placement || "").trim();

  if (!placement) {
    throw makeValidationError("PLACEMENT_REQUIRED", "placement is required");
  }

  const placementRule = getPlacementRule(placement);
const capacity = placementRule.defaultCapacity;
const target = normalizeGeoTarget(payload);

  const parsedActiveFrom = parseDate(payload.activeFrom, "activeFrom");
  const parsedActiveTo = parseDate(payload.activeTo, "activeTo");

  const {
    activeFrom,
    inclusiveActiveTo,
    exclusiveActiveTo,
  } = normalizeInclusivePromoRange(parsedActiveFrom, parsedActiveTo);

  const event = await loadEventForValidation(payload.eventId);

  const temporal = validateTemporalRules({
  activeFrom,
  activeTo: exclusiveActiveTo,
  inclusiveActiveTo,
  event,
  now: payload.now ? new Date(payload.now) : new Date(),
});
  const requestedDays = buildDays(activeFrom, exclusiveActiveTo);

  if (!requestedDays.length) {
    throw makeValidationError(
      "INVALID_DATE_RANGE",
      "date range must include at least one day"
    );
  }

  const filter = buildBaseFilter({
    placement,
    target,
    activeFrom,
    activeTo: exclusiveActiveTo,
    excludeBannerId: payload.excludeBannerId,
  });

  const occupyingBanners = await Banner.find(filter)
    .select("_id status geoScope country region activeFrom activeTo")
    .lean();

  const usageByDay = countUsageByDay({ requestedDays, occupyingBanners });
  const result = buildAvailabilityResult({ requestedDays, capacity, usageByDay });

  return {
    ...result,
    capacity,
    placement,
    geoTarget: target,
    occupyingStatuses: OCCUPYING_STATUSES.slice(),
    durationDays: temporal.durationDays,
    dateRangeMode: "USER_INCLUSIVE_BACKEND_EXCLUSIVE",
    activeFrom: formatUtcDay(activeFrom),
    activeTo: formatUtcDay(inclusiveActiveTo),
    exclusiveActiveTo: formatUtcDay(exclusiveActiveTo),
  };
}

module.exports = {
  OCCUPYING_STATUSES,
  PLACEMENT_CAPACITY,
  checkPromoAvailability,
};
