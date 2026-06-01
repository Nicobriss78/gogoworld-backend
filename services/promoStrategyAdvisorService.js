// backend/services/promoStrategyAdvisorService.js
// Promotion Strategy Advisor V1 — consulente operativo per Promozioni Organizer V2

const ADVISOR_VERSION = "PROMOTION_STRATEGY_ADVISOR_V1";

const ADVISOR_MODE = {
  CREATE: "CREATE",
  DRAFT: "DRAFT",
  APPROVED_UNPAID: "APPROVED_UNPAID",
  ACTIVE: "ACTIVE",
  ENDED: "ENDED",
};

const PROMO_STATUS = {
  DRAFT: "DRAFT",
  PENDING_REVIEW: "PENDING_REVIEW",
  PENDING_PAYMENT: "PENDING_PAYMENT",
  SCHEDULED: "SCHEDULED",
  ACTIVE: "ACTIVE",
  ENDED: "ENDED",
};

const STRATEGY_TYPE = {
  NO_SLOT_AVAILABLE: "NO_SLOT_AVAILABLE",
  ALTERNATIVE_OPPORTUNITY: "ALTERNATIVE_OPPORTUNITY",
  PROMO_PLUS_TRILLI: "PROMO_PLUS_TRILLI",
  LIMITED_AVAILABILITY: "LIMITED_AVAILABILITY",
  HIGH_COMPETITION: "HIGH_COMPETITION",
  FINAL_PUSH: "FINAL_PUSH",
  COVERAGE_EXTENDED: "COVERAGE_EXTENDED",
  FOCUSED_COVERAGE: "FOCUSED_COVERAGE",
  DISTRIBUTED_VISIBILITY: "DISTRIBUTED_VISIBILITY",
  STANDARD_VISIBILITY: "STANDARD_VISIBILITY",
};

const STRATEGY_LEVEL = {
  STRONG: "STRONG",
  MODERATE: "MODERATE",
  SOFT: "SOFT",
};

const ACTION_TYPE = {
  APPLY_PROMO_FIELDS: "APPLY_PROMO_FIELDS",
  KEEP_CURRENT_SELECTION: "KEEP_CURRENT_SELECTION",
  OPEN_TRILL_SUPPORT: "OPEN_TRILL_SUPPORT",
  OPEN_KNOWLEDGE_CENTER: "OPEN_KNOWLEDGE_CENTER",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function normalizeScore(value) {
  return clamp(Math.round(Number(value || 0)), 0, 100);
}

function normalizeMode(value) {
  const mode = String(value || ADVISOR_MODE.CREATE).toUpperCase();
  return Object.values(ADVISOR_MODE).includes(mode) ? mode : ADVISOR_MODE.CREATE;
}

function normalizePromoStatus(value) {
  const status = String(value || PROMO_STATUS.DRAFT).toUpperCase();
  return Object.values(PROMO_STATUS).includes(status) ? status : PROMO_STATUS.DRAFT;
}

function startOfUtcDay(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function getUtcDayDistance(from, to) {
  const start = startOfUtcDay(from);
  const end = startOfUtcDay(to);

  if (!start || !end) return null;

  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

function getRequestedRange({ payload = {}, availability = {} }) {
  const activeFrom = availability.activeFrom || payload.activeFrom || null;
  const activeTo = availability.activeTo || payload.activeTo || null;
  const durationDays = Number(availability.durationDays || 0);

  return {
    activeFrom,
    activeTo,
    durationDays,
  };
}

function getEventWindow({ payload = {}, availability = {} }) {
  const eventWindow = availability.eventWindow || {};

  return {
    eventStart: eventWindow.eventStart || payload.eventStart || null,
    eventEnd: eventWindow.eventEnd || payload.eventEnd || null,
  };
}

function getSuggestionItem(suggestions = {}, type) {
  const items = Array.isArray(suggestions.items) ? suggestions.items : [];
  return items.find((item) => String(item?.type || "") === type) || null;
}

function hasSuggestionItem(suggestions = {}, type) {
  return Boolean(getSuggestionItem(suggestions, type));
}

function getBetterWindow(suggestions = {}) {
  return getSuggestionItem(suggestions, "BETTER_WINDOW");
}

function getAvailabilityStatus(availability = {}) {
  return String(
    availability.status || availability.availabilityLevel || availability.availabilityStatus || ""
  ).toUpperCase();
}
function isNoSlotAvailable(availability = {}) {
  const status = getAvailabilityStatus(availability);

  return (
    availability.available === false &&
    (
      status === "UNAVAILABLE" ||
      Number(availability.availableCount || availability.availableDaysCount || 0) === 0 ||
      Number(availability.blockedCount || availability.fullDaysCount || 0) >=
        Number(availability.totalDays || availability.requestedDays || 1)
    )
  );
}
function isLimitedAvailability(availability = {}) {
  const status = getAvailabilityStatus(availability);

  return (
    status === "LOW_AVAILABILITY" ||
    status === "PARTIALLY_AVAILABLE" ||
    Number(availability.limitedDaysCount || availability.limitedCount || 0) > 0 ||
    Number(availability.remainingMinSlots || 0) <= Number(availability.lowAvailabilityThreshold || 0)
  );
}

function isHighCompetition(demand = {}) {
  const score = normalizeScore(demand.competitionScore);
  const pressure = String(demand.periodPressure || "").toUpperCase();
  const scarcity = String(demand.scarcityLevel || "").toUpperCase();

  return (
    score >= 65 ||
    pressure === "HIGH" ||
    pressure === "VERY_HIGH" ||
    scarcity === "HIGH" ||
    scarcity === "VERY_HIGH"
  );
}

function isVeryHighCompetition(demand = {}) {
  const score = normalizeScore(demand.competitionScore);
  const pressure = String(demand.periodPressure || "").toUpperCase();
  const scarcity = String(demand.scarcityLevel || "").toUpperCase();

  return score >= 85 || pressure === "VERY_HIGH" || scarcity === "VERY_HIGH";
}

function buildKnowledgeLinks() {
  return [
    {
      label: "Guida alle strategie promozionali",
      target: "/organizer/knowledge-center.html#promo-strategies",
    },
    {
      label: "Come funzionano i Trilli",
      target: "/organizer/knowledge-center.html#trilli",
    },
  ];
}

function buildApplyFieldsAction({ label, payload }) {
  return {
    label,
    action: ACTION_TYPE.APPLY_PROMO_FIELDS,
    payload: payload || {},
  };
}

function buildKeepAction(label = "Mantieni questa strategia") {
  return {
    label,
    action: ACTION_TYPE.KEEP_CURRENT_SELECTION,
    payload: {},
  };
}

function buildTrillAction(label = "Valuta supporto Trilli") {
  return {
    label,
    action: ACTION_TYPE.OPEN_TRILL_SUPPORT,
    payload: {},
  };
}

function buildDetectedFactors({ availability = {}, demand = {}, suggestions = {} }) {
  const factors = [];

  if (isHighCompetition(demand)) {
    factors.push({
      type: STRATEGY_TYPE.HIGH_COMPETITION,
      label: isVeryHighCompetition(demand) ? "Periodo molto richiesto" : "Periodo competitivo",
    });
  }

  if (isLimitedAvailability(availability)) {
    factors.push({
      type: STRATEGY_TYPE.LIMITED_AVAILABILITY,
      label: "Disponibilità limitata",
    });
  }

  if (hasSuggestionItem(suggestions, "TRILL_SUPPORT")) {
    factors.push({
      type: STRATEGY_TYPE.PROMO_PLUS_TRILLI,
      label: "Trilli consigliati come supporto",
    });
  }

  if (hasSuggestionItem(suggestions, "FINAL_PUSH")) {
    factors.push({
      type: STRATEGY_TYPE.FINAL_PUSH,
      label: "Richiamo finale vicino all’evento",
    });
  }

  if (hasSuggestionItem(suggestions, "COVERAGE_EXTENSION")) {
    factors.push({
      type: STRATEGY_TYPE.COVERAGE_EXTENDED,
      label: "Copertura estesa",
    });
  }

  if (hasSuggestionItem(suggestions, "COVERAGE_COMPACT")) {
    factors.push({
      type: STRATEGY_TYPE.FOCUSED_COVERAGE,
      label: "Copertura concentrata",
    });
  }

  if (hasSuggestionItem(suggestions, "EARLY_VISIBILITY")) {
    factors.push({
      type: STRATEGY_TYPE.DISTRIBUTED_VISIBILITY,
      label: "Visibilità distribuita",
    });
  }

  return factors;
}

function buildAlternativeOpportunityStrategy({ payload = {}, suggestions = {} }) {
  const betterWindow = getBetterWindow(suggestions);

  if (!betterWindow?.activeFrom || !betterWindow?.activeTo) return null;

  return {
    type: STRATEGY_TYPE.ALTERNATIVE_OPPORTUNITY,
    title: "Periodo consigliato",
    summary: "Abbiamo individuato una finestra alternativa con condizioni più favorevoli.",
    reason:
      betterWindow.message ||
      "La finestra proposta rispetta i vincoli dell’evento e presenta una pressione promozionale più favorevole.",
    level: STRATEGY_LEVEL.STRONG,
    primaryAction: buildApplyFieldsAction({
      label: "Usa questa finestra",
      payload: {
        activeFrom: betterWindow.activeFrom,
        activeTo: betterWindow.activeTo,
        placement: payload.placement || null,
      },
    }),
    secondaryActions: [buildKeepAction("Mantieni il periodo scelto")],
  };
}

function buildPromoPlusTrilliStrategy() {
  return {
    type: STRATEGY_TYPE.PROMO_PLUS_TRILLI,
    title: "Promo rafforzata",
    summary: "La promo può essere rafforzata con il supporto dei Trilli.",
    reason:
      "Il periodo scelto è competitivo e non emergono alternative realmente più favorevoli. I Trilli possono supportare la promo nei momenti più utili senza sostituirla.",
    level: STRATEGY_LEVEL.STRONG,
    primaryAction: buildKeepAction("Mantieni la promo e valuta i Trilli"),
    secondaryActions: [buildTrillAction()],
  };
}

function buildLimitedAvailabilityStrategy() {
  return {
    type: STRATEGY_TYPE.LIMITED_AVAILABILITY,
    title: "Disponibilità limitata",
    summary: "Lo spazio promozionale selezionato ha pochi slot residui.",
    reason:
      "La selezione resta utilizzabile, ma alcuni giorni presentano una disponibilità ridotta. Confermare ora può aiutare a bloccare la finestra scelta.",
    level: STRATEGY_LEVEL.STRONG,
    primaryAction: buildKeepAction("Mantieni e prosegui"),
    secondaryActions: [],
  };
}

function buildHighCompetitionStrategy() {
  return {
    type: STRATEGY_TYPE.HIGH_COMPETITION,
    title: "Periodo competitivo",
    summary: "Il periodo scelto presenta una buona attività promozionale.",
    reason:
      "Sono già presenti altre promozioni attive o in programmazione. Una creatività chiara e riconoscibile può aiutare la promo a distinguersi meglio.",
    level: STRATEGY_LEVEL.MODERATE,
    primaryAction: buildKeepAction("Mantieni questa strategia"),
    secondaryActions: [],
  };
}

function buildFinalPushStrategy() {
  return {
    type: STRATEGY_TYPE.FINAL_PUSH,
    title: "Spinta finale",
    summary: "La promo lavora come richiamo vicino alla data dell’evento.",
    reason:
      "La finestra scelta è vicina all’evento e può aiutare a concentrare l’attenzione negli ultimi momenti utili.",
    level: STRATEGY_LEVEL.MODERATE,
    primaryAction: buildKeepAction("Usa come spinta finale"),
    secondaryActions: [buildTrillAction("Valuta Trilli in prossimità dell’evento")],
  };
}

function buildCoverageExtendedStrategy() {
  return {
    type: STRATEGY_TYPE.COVERAGE_EXTENDED,
    title: "Copertura estesa",
    summary: "La promo offre una presenza distribuita nel tempo.",
    reason:
      "Questa scelta può essere efficace se l’obiettivo è mantenere visibilità costante prima dell’evento.",
    level: STRATEGY_LEVEL.SOFT,
    primaryAction: buildKeepAction("Mantieni copertura estesa"),
    secondaryActions: [],
  };
}

function buildFocusedCoverageStrategy() {
  return {
    type: STRATEGY_TYPE.FOCUSED_COVERAGE,
    title: "Copertura concentrata",
    summary: "La promo concentra la visibilità in pochi giorni.",
    reason:
      "Questa scelta può essere utile per messaggi chiari, mirati e facilmente riconoscibili.",
    level: STRATEGY_LEVEL.SOFT,
    primaryAction: buildKeepAction("Mantieni copertura concentrata"),
    secondaryActions: [],
  };
}

function buildDistributedVisibilityStrategy() {
  return {
    type: STRATEGY_TYPE.DISTRIBUTED_VISIBILITY,
    title: "Visibilità distribuita",
    summary: "La promo parte con largo anticipo rispetto all’evento.",
    reason:
      "Questa strategia può aiutare a costruire presenza nel tempo prima della fase finale dell’evento.",
    level: STRATEGY_LEVEL.SOFT,
    primaryAction: buildKeepAction("Mantieni visibilità distribuita"),
    secondaryActions: [],
  };
}

function buildStandardVisibilityStrategy({ availability = {}, demand = {} }) {
  const availabilityMessage = availability.message || "La finestra selezionata risulta utilizzabile.";
  const demandMessage = demand.message || "La pressione promozionale appare gestibile.";

  return {
    type: STRATEGY_TYPE.STANDARD_VISIBILITY,
    title: "Strategia equilibrata",
    summary: "La selezione attuale appare coerente con una promozione standard.",
    reason: `${availabilityMessage} ${demandMessage}`.trim(),
    level: STRATEGY_LEVEL.SOFT,
    primaryAction: buildKeepAction("Mantieni questa selezione"),
    secondaryActions: [],
  };
}

function buildAlternativeStrategies({ primaryType, availability = {}, demand = {}, suggestions = {}, payload = {} }) {
  const candidates = [
    buildAlternativeOpportunityStrategy({ payload, suggestions }),
    isHighCompetition(demand) && hasSuggestionItem(suggestions, "TRILL_SUPPORT")
      ? buildPromoPlusTrilliStrategy()
      : null,
    isLimitedAvailability(availability) ? buildLimitedAvailabilityStrategy() : null,
    isHighCompetition(demand) ? buildHighCompetitionStrategy() : null,
    hasSuggestionItem(suggestions, "FINAL_PUSH") ? buildFinalPushStrategy() : null,
    hasSuggestionItem(suggestions, "COVERAGE_EXTENSION") ? buildCoverageExtendedStrategy() : null,
    hasSuggestionItem(suggestions, "COVERAGE_COMPACT") ? buildFocusedCoverageStrategy() : null,
    hasSuggestionItem(suggestions, "EARLY_VISIBILITY") ? buildDistributedVisibilityStrategy() : null,
  ].filter(Boolean);

  return candidates.filter((strategy) => strategy.type !== primaryType);
}

function selectPrimaryStrategy({ payload = {}, availability = {}, demand = {}, suggestions = {} }) {
  const alternativeOpportunity = buildAlternativeOpportunityStrategy({ payload, suggestions });
  if (alternativeOpportunity) return alternativeOpportunity;

  if (isHighCompetition(demand) && hasSuggestionItem(suggestions, "TRILL_SUPPORT")) {
    return buildPromoPlusTrilliStrategy();
  }

  if (isLimitedAvailability(availability)) {
    return buildLimitedAvailabilityStrategy();
  }

  if (isHighCompetition(demand)) {
    return buildHighCompetitionStrategy();
  }

  if (hasSuggestionItem(suggestions, "FINAL_PUSH")) {
    return buildFinalPushStrategy();
  }

  if (hasSuggestionItem(suggestions, "COVERAGE_EXTENSION")) {
    return buildCoverageExtendedStrategy();
  }

  if (hasSuggestionItem(suggestions, "COVERAGE_COMPACT")) {
    return buildFocusedCoverageStrategy();
  }

  if (hasSuggestionItem(suggestions, "EARLY_VISIBILITY")) {
    return buildDistributedVisibilityStrategy();
  }

  return buildStandardVisibilityStrategy({ availability, demand });
}

function enrichAction(action = {}) {
  return {
    label: action.label || "Prosegui",
    action: action.action || ACTION_TYPE.KEEP_CURRENT_SELECTION,
    payload: action.payload || {},
    requiresOrganizerConfirmation: true,
  };
}

function enrichStrategy(strategy = {}) {
  return {
    ...strategy,
    primaryAction: enrichAction(strategy.primaryAction),
    secondaryActions: Array.isArray(strategy.secondaryActions)
      ? strategy.secondaryActions.map(enrichAction)
      : [],
  };
}

function buildPromotionStrategyAdvisor({
  mode = ADVISOR_MODE.CREATE,
  promoStatus = PROMO_STATUS.DRAFT,
  payload = {},
  pricing = null,
  availability = {},
  demand = {},
  suggestions = {},
} = {}) {
  const normalizedMode = normalizeMode(mode);
  const normalizedPromoStatus = normalizePromoStatus(promoStatus);
  const requestedRange = getRequestedRange({ payload, availability });
  const eventWindow = getEventWindow({ payload, availability });
  const primaryStrategy = enrichStrategy(
    selectPrimaryStrategy({ payload, availability, demand, suggestions })
  );

  return {
    version: ADVISOR_VERSION,
    mode: normalizedMode,
    promoStatus: normalizedPromoStatus,
    generatedAt: new Date().toISOString(),
    context: {
      placement: payload.placement || availability.placement || null,
      geoTarget:
        pricing?.normalizedTarget ||
        pricing?.geoTarget ||
        availability.geoTarget ||
        null,
      requestedRange,
      eventWindow,
    },
    primaryStrategy,
    detectedFactors: buildDetectedFactors({ availability, demand, suggestions }),
    alternativeStrategies: buildAlternativeStrategies({
      primaryType: primaryStrategy.type,
      availability,
      demand,
      suggestions,
      payload,
    }).map(enrichStrategy),
    knowledgeLinks: buildKnowledgeLinks(),
    ui: {
      showAdvisor: true,
      showAlternativeStrategiesCta: true,
      alternativeStrategiesCtaLabel: "Mostra strategie alternative",
      showConfidencePercentage: false,
    },
  };
}

module.exports = {
  ADVISOR_VERSION,
  ADVISOR_MODE,
  PROMO_STATUS,
  STRATEGY_TYPE,
  STRATEGY_LEVEL,
  ACTION_TYPE,
  buildPromotionStrategyAdvisor,
};
