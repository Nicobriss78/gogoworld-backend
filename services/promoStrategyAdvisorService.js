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

const PROMOTION_OBJECTIVE = {
  RECOVER_UNAVAILABLE_PERIOD: "RECOVER_UNAVAILABLE_PERIOD",
  USE_BETTER_WINDOW: "USE_BETTER_WINDOW",
  STRENGTHEN_PROMO_WITH_TRILLI: "STRENGTHEN_PROMO_WITH_TRILLI",
  SECURE_LIMITED_SPACE: "SECURE_LIMITED_SPACE",
  STAND_OUT_IN_COMPETITION: "STAND_OUT_IN_COMPETITION",
  FINAL_EVENT_PUSH: "FINAL_EVENT_PUSH",
  MAINTAIN_EXTENDED_VISIBILITY: "MAINTAIN_EXTENDED_VISIBILITY",
  FOCUS_VISIBILITY: "FOCUS_VISIBILITY",
  BUILD_EARLY_VISIBILITY: "BUILD_EARLY_VISIBILITY",
  BALANCED_VISIBILITY: "BALANCED_VISIBILITY",
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

const ALTERNATIVE_LIMIT = 3;

const STRATEGY_PRIORITY = {
  [STRATEGY_TYPE.NO_SLOT_AVAILABLE]: 100,
  [STRATEGY_TYPE.ALTERNATIVE_OPPORTUNITY]: 90,
  [STRATEGY_TYPE.PROMO_PLUS_TRILLI]: 80,
  [STRATEGY_TYPE.LIMITED_AVAILABILITY]: 70,
  [STRATEGY_TYPE.HIGH_COMPETITION]: 60,
  [STRATEGY_TYPE.FINAL_PUSH]: 50,
  [STRATEGY_TYPE.COVERAGE_EXTENDED]: 40,
  [STRATEGY_TYPE.FOCUSED_COVERAGE]: 30,
  [STRATEGY_TYPE.DISTRIBUTED_VISIBILITY]: 20,
  [STRATEGY_TYPE.STANDARD_VISIBILITY]: 10,
};

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

function normalizeText(value) {
  return String(value || "").trim();
}

function getRequestedRange({ payload = {}, availability = {} }) {
  return {
    activeFrom: availability.activeFrom || payload.activeFrom || null,
    activeTo: availability.activeTo || payload.activeTo || null,
    durationDays: Number(availability.durationDays || 0),
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
  const totalDays = Number(availability.totalDays || availability.requestedDays || 0);
  const blockedDays = Number(availability.blockedCount || availability.fullDaysCount || 0);
  const availableDays = Number(availability.availableCount || availability.availableDaysCount || 0);

  return (
    availability.available === false &&
    (
      status === "UNAVAILABLE" ||
      availableDays === 0 ||
      (totalDays > 0 && blockedDays >= totalDays)
    )
  );
}

function isLimitedAvailability(availability = {}) {
  if (isNoSlotAvailable(availability)) return false;

  const status = getAvailabilityStatus(availability);
  const threshold = Number(availability.lowAvailabilityThreshold || 0);
  const remainingMinSlots = Number(availability.remainingMinSlots || 0);

  return (
    status === "LOW_AVAILABILITY" ||
    status === "PARTIALLY_AVAILABLE" ||
    Number(availability.limitedDaysCount || availability.limitedCount || 0) > 0 ||
    (threshold > 0 && remainingMinSlots > 0 && remainingMinSlots <= threshold)
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

  if (isNoSlotAvailable(availability)) {
    factors.push({
      type: STRATEGY_TYPE.NO_SLOT_AVAILABLE,
      label: "Nessuno slot disponibile",
    });
  }

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
function buildPersonalizationLayer(organizerProfile = null) {
  const profileAvailable = Boolean(
    organizerProfile &&
    organizerProfile.available &&
    organizerProfile.maturity !== "EMPTY"
  );

  const budgetCode = organizerProfile?.budgetProfile?.code || null;
  const promoBehaviorCode = organizerProfile?.promoBehavior?.code || null;

  let tone = "NEUTRAL";
  let recommendationStyle = "STANDARD";

  if (promoBehaviorCode === "EXPLORER") {
    tone = "EXPLORATIVE";
    recommendationStyle = "GUIDED";
  }

  if (promoBehaviorCode === "SELECTIVE") {
    tone = "FOCUSED";
    recommendationStyle = "CONCISE";
  }

  if (promoBehaviorCode === "DECISIVE") {
    tone = "CONFIDENT";
    recommendationStyle = "ACTION_ORIENTED";
  }

  return {
    enabled: profileAvailable,
    budgetProfile: budgetCode,
    promoBehavior: promoBehaviorCode,
    tone,
    recommendationStyle,
  };
}
function buildObjective(strategy = {}) {
  switch (strategy.type) {
    case STRATEGY_TYPE.NO_SLOT_AVAILABLE:
      return {
        code: PROMOTION_OBJECTIVE.RECOVER_UNAVAILABLE_PERIOD,
        title: "Recuperare visibilità nonostante il periodo saturo",
        description:
          "L’obiettivo è aiutare l’organizer a non fermarsi davanti a una finestra non disponibile, orientandolo verso una scelta alternativa o di supporto.",
      };

    case STRATEGY_TYPE.ALTERNATIVE_OPPORTUNITY:
      return {
        code: PROMOTION_OBJECTIVE.USE_BETTER_WINDOW,
        title: "Sfruttare una finestra più favorevole",
        description:
          "L’obiettivo è ridurre lo sforzo decisionale proponendo una finestra più utile, disponibile e coerente con i vincoli dell’evento.",
      };

    case STRATEGY_TYPE.PROMO_PLUS_TRILLI:
      return {
        code: PROMOTION_OBJECTIVE.STRENGTHEN_PROMO_WITH_TRILLI,
        title: "Rafforzare la promo nei momenti più utili",
        description:
          "L’obiettivo è mantenere la promozione come strumento principale e affiancarle un supporto live quando la pressione del periodo lo rende utile.",
      };

    case STRATEGY_TYPE.LIMITED_AVAILABILITY:
      return {
        code: PROMOTION_OBJECTIVE.SECURE_LIMITED_SPACE,
        title: "Bloccare uno spazio promozionale residuo",
        description:
          "L’obiettivo è aiutare l’organizer a prendere una decisione quando lo spazio disponibile è ancora utilizzabile ma ridotto.",
      };

    case STRATEGY_TYPE.HIGH_COMPETITION:
      return {
        code: PROMOTION_OBJECTIVE.STAND_OUT_IN_COMPETITION,
        title: "Distinguersi in un periodo competitivo",
        description:
          "L’obiettivo è aiutare la promo a emergere anche quando sono presenti altre promozioni attive o programmate.",
      };

    case STRATEGY_TYPE.FINAL_PUSH:
      return {
        code: PROMOTION_OBJECTIVE.FINAL_EVENT_PUSH,
        title: "Concentrare l’attenzione vicino all’evento",
        description:
          "L’obiettivo è usare la promo come richiamo finale nei giorni più vicini alla data dell’evento.",
      };

    case STRATEGY_TYPE.COVERAGE_EXTENDED:
      return {
        code: PROMOTION_OBJECTIVE.MAINTAIN_EXTENDED_VISIBILITY,
        title: "Mantenere visibilità costante",
        description:
          "L’obiettivo è distribuire la presenza promozionale nel tempo per accompagnare l’evento fino alla fase finale.",
      };

    case STRATEGY_TYPE.FOCUSED_COVERAGE:
      return {
        code: PROMOTION_OBJECTIVE.FOCUS_VISIBILITY,
        title: "Concentrare la visibilità",
        description:
          "L’obiettivo è concentrare l’impatto della promo in una finestra più compatta e riconoscibile.",
      };

    case STRATEGY_TYPE.DISTRIBUTED_VISIBILITY:
      return {
        code: PROMOTION_OBJECTIVE.BUILD_EARLY_VISIBILITY,
        title: "Costruire visibilità anticipata",
        description:
          "L’obiettivo è iniziare a dare presenza all’evento con anticipo, preparando il pubblico prima della fase finale.",
      };

    default:
      return {
        code: PROMOTION_OBJECTIVE.BALANCED_VISIBILITY,
        title: "Mantenere una promozione equilibrata",
        description:
          "L’obiettivo è confermare una scelta coerente quando disponibilità e pressione risultano gestibili.",
      };
  }
}

function buildNoSlotAvailableStrategy({ payload = {}, suggestions = {} } = {}) {
  const betterWindow = getBetterWindow(suggestions);
  const hasAlternativeWindow = Boolean(betterWindow?.activeFrom && betterWindow?.activeTo);

  return {
    type: STRATEGY_TYPE.NO_SLOT_AVAILABLE,
    title: "Periodo non disponibile",
    summary: "La finestra selezionata non ha slot promozionali disponibili.",
    reason: hasAlternativeWindow
      ? "Il periodo scelto risulta saturo, ma il GGW Consultant ha individuato una finestra alternativa utilizzabile."
      : "Il periodo scelto risulta saturo per il placement selezionato. Il GGW Consultant può aiutarti a valutare una finestra alternativa, mantenendo la promo come strumento principale.",
    level: STRATEGY_LEVEL.STRONG,
    primaryAction: hasAlternativeWindow
      ? buildApplyFieldsAction({
          label: "Usa finestra alternativa",
          payload: {
            activeFrom: betterWindow.activeFrom,
            activeTo: betterWindow.activeTo,
            placement: payload.placement || null,
          },
        })
      : buildKeepAction("Valuta una finestra alternativa"),
    secondaryActions: hasAlternativeWindow ? [buildKeepAction("Mantieni il periodo scelto")] : [],
  };
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

function getStrategyPriority(strategy = {}) {
  return STRATEGY_PRIORITY[strategy.type] || 0;
}

function hasMeaningfulAction(action = {}) {
  return Boolean(normalizeText(action.label) && normalizeText(action.action));
}

function isMeaningfulStrategy(strategy = {}) {
  if (!strategy || typeof strategy !== "object") return false;

  const title = normalizeText(strategy.title);
  const summary = normalizeText(strategy.summary);
  const reason = normalizeText(strategy.reason);

  if (!strategy.type || !title) return false;
  if (title === "Strategia alternativa" && !summary && !reason) return false;

  return Boolean(summary || reason || hasMeaningfulAction(strategy.primaryAction));
}

function dedupeStrategies(strategies = []) {
  const seen = new Set();
  const result = [];

  strategies.forEach((strategy) => {
    const key = strategy?.type || strategy?.title;
    if (!key || seen.has(key)) return;

    seen.add(key);
    result.push(strategy);
  });

  return result;
}

function getStrategyDecisionScore(strategy = {}) {
return Number(strategy.weightedScore ?? strategy.priorityScore ?? getStrategyPriority(strategy));
}

function rankAlternativeStrategies(strategies = []) {
return strategies
.slice()
.sort((a, b) => getStrategyDecisionScore(b) - getStrategyDecisionScore(a))
.map((strategy, index) => ({
...strategy,
decisionScore: getStrategyDecisionScore(strategy),
alternativeRank: index + 1,
alternativeLabel: index === 0 ? "Alternativa consigliata" : "Altra opzione disponibile",
recommendedAlternative: index === 0,
}));
}

function buildAlternativeStrategies({
primaryType,
availability = {},
demand = {},
suggestions = {},
payload = {},
campaignAdvisor = null,
}) {
  const noSlotAvailable = isNoSlotAvailable(availability);

  const candidates = [
  buildAlternativeOpportunityStrategy({ payload, suggestions }),

  noSlotAvailable
    ? null
    : isLimitedAvailability(availability)
      ? buildLimitedAvailabilityStrategy()
      : null,

  isHighCompetition(demand) && hasSuggestionItem(suggestions, "TRILL_SUPPORT")
    ? buildPromoPlusTrilliStrategy()
    : null,

  isHighCompetition(demand)
    ? buildHighCompetitionStrategy()
    : null,

  buildFinalPushStrategy(),
  buildCoverageExtendedStrategy(),
  buildFocusedCoverageStrategy(),
  buildDistributedVisibilityStrategy(),
  buildStandardVisibilityStrategy({ availability, demand }),
];

  const filtered = dedupeStrategies(candidates)
    .filter(Boolean)
    .filter((strategy) => strategy.type !== primaryType)
    .filter((strategy) => strategy.type !== STRATEGY_TYPE.STANDARD_VISIBILITY)
    .filter(isMeaningfulStrategy);

  const weightedAlternatives = filtered.map((strategy) =>
scoreStrategyWithHistory(
{
...strategy,
priorityScore: getStrategyPriority(strategy),
},
campaignAdvisor
)
);

return rankAlternativeStrategies(weightedAlternatives).slice(0, ALTERNATIVE_LIMIT);
}

function selectPrimaryStrategy({
payload = {},
availability = {},
demand = {},
suggestions = {},
campaignAdvisor = null,
} = {}) {
if (isNoSlotAvailable(availability)) {
return buildNoSlotAvailableStrategy({ payload, suggestions });
}

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
buildStandardVisibilityStrategy({ availability, demand }),
];

const weightedCandidates = dedupeStrategies(candidates)
.filter(Boolean)
.filter(isMeaningfulStrategy)
.map((strategy) =>
scoreStrategyWithHistory(
{
...strategy,
priorityScore: getStrategyPriority(strategy),
},
campaignAdvisor
)
);

if (!weightedCandidates.length) {
return buildStandardVisibilityStrategy({ availability, demand });
}

weightedCandidates.sort(
(a, b) => Number(b.weightedScore || 0) - Number(a.weightedScore || 0)
);

return weightedCandidates[0];
}
function appendSentence(text, sentence) {
  const base = normalizeText(text);
  const extra = normalizeText(sentence);

  if (!extra) return base;
  if (!base) return extra;

  return `${base} ${extra}`;
}

function getBehaviorModifierText(personalization = {}) {
  if (!personalization || !personalization.enabled) return null;

  if (personalization.promoBehavior === "EXPLORER") {
    return "Considerando il tuo approccio orientato alla sperimentazione, questa configurazione può aiutarti a valutare nuove opportunità senza stravolgere la strategia principale.";
  }

  if (personalization.promoBehavior === "SELECTIVE") {
    return "Questa configurazione mantiene un’impostazione stabile e controllata, coerente con un approccio promozionale più selettivo.";
  }

  if (personalization.promoBehavior === "DECISIVE") {
    return "Questa configurazione è pronta per essere utilizzata in modo diretto, mantenendo il focus sull’azione principale.";
  }

  return null;
}

function applyBehaviorModifier(strategy = {}, personalization = {}) {
  const modifierText = getBehaviorModifierText(personalization);

  if (!modifierText) return strategy;

  return {
    ...strategy,
    reason: appendSentence(strategy.reason, modifierText),
    behaviorModifierApplied: true,
  };
}
function enrichAction(action = {}) {
  return {
    label: action.label || "Prosegui",
    action: action.action || ACTION_TYPE.KEEP_CURRENT_SELECTION,
    payload: action.payload || {},
    requiresOrganizerConfirmation: true,
  };
}
function getCampaignAdvisorSamples(campaignAdvisor = null) {
  return {
    personal: Number(campaignAdvisor?.sampleSize?.personal || 0),
    collective: Number(campaignAdvisor?.sampleSize?.collective || 0),
  };
}

function isCampaignAdvisorReliable(campaignAdvisor = null) {
  const confidence = String(campaignAdvisor?.confidence || "").toLowerCase();
  const samples = getCampaignAdvisorSamples(campaignAdvisor);

  return (
    confidence === "medium" &&
    (samples.personal > 0 || samples.collective > 0)
  );
}

function getCampaignAdvisorItems(campaignAdvisor = null, key) {
  return Array.isArray(campaignAdvisor?.[key]) ? campaignAdvisor[key] : [];
}

function findHistoricalRecommendation(campaignAdvisor = null) {
  const recommendations = getCampaignAdvisorItems(campaignAdvisor, "recommendations");

  return (
    recommendations.find((item) => item?.type === "DURATION_ALIGNMENT") ||
    recommendations.find((item) => item?.type === "PLACEMENT_ALIGNMENT") ||
    recommendations.find((item) => item?.type === "REGION_ALIGNMENT") ||
    recommendations[0] ||
    null
  );
}
function getHistoricalWeightMap(campaignAdvisor = null) {
  const recommendations = Array.isArray(campaignAdvisor?.recommendations)
    ? campaignAdvisor.recommendations
    : [];

  const confirmations = recommendations.filter(
    (item) =>
      item?.type === "PERSONAL_BEST_MATCH" ||
      item?.type === "COLLECTIVE_BEST_MATCH"
  );

  const durationAlignments = recommendations.filter(
    (item) => item?.type === "DURATION_ALIGNMENT"
  );

  const placementAlignments = recommendations.filter(
    (item) => item?.type === "PLACEMENT_ALIGNMENT"
  );

  const regionAlignments = recommendations.filter(
    (item) => item?.type === "REGION_ALIGNMENT"
  );

  return {
    confirmations: confirmations.length,
    durationAlignments: durationAlignments.length,
    placementAlignments: placementAlignments.length,
    regionAlignments: regionAlignments.length,
    opportunities: Array.isArray(campaignAdvisor?.opportunities)
      ? campaignAdvisor.opportunities.length
      : 0,
  };
}

function scoreStrategyWithHistory(strategy = {}, campaignAdvisor = null) {
  const baseScore = Number(strategy?.priorityScore || 50);
  const confidence = String(campaignAdvisor?.confidence || "none").toLowerCase();

  if (confidence === "none") {
    return {
      ...strategy,
      weightedScore: baseScore,
    };
  }

  const weights = getHistoricalWeightMap(campaignAdvisor);

  let weightedScore = baseScore;

  if (strategy?.type === "FINAL_PUSH") {
    weightedScore += weights.confirmations * 3;
    weightedScore += weights.opportunities * 2;
    weightedScore -= weights.durationAlignments * 4;
  }

  if (strategy?.type === "STANDARD_VISIBILITY") {
    weightedScore += weights.confirmations * 2;
    weightedScore += weights.placementAlignments * 4;
    weightedScore += weights.regionAlignments * 4;
  }

  if (strategy?.type === "FOCUSED_COVERAGE") {
    weightedScore += weights.regionAlignments * 5;
    weightedScore += weights.opportunities * 2;
  }

  if (strategy?.type === "DISTRIBUTED_VISIBILITY") {
    weightedScore += weights.opportunities * 3;
    weightedScore += weights.confirmations * 2;
  }

  return {
    ...strategy,
    weightedScore,
  };
}
function buildDecisionDelta(primaryStrategy = {}, alternativeStrategies = []) {
const primaryScore = getStrategyDecisionScore(primaryStrategy);

const alternatives = Array.isArray(alternativeStrategies)
? alternativeStrategies.map((strategy) => ({
type: strategy.type,
title: strategy.title,
decisionScore: getStrategyDecisionScore(strategy),
weightedScore: Number(strategy.weightedScore ?? getStrategyDecisionScore(strategy)),
priorityScore: Number(strategy.priorityScore ?? getStrategyPriority(strategy)),
deltaFromPrimary: getStrategyDecisionScore(strategy) - primaryScore,
recommendedAlternative: Boolean(strategy.recommendedAlternative),
}))
: [];

return {
primary: {
type: primaryStrategy.type,
title: primaryStrategy.title,
decisionScore: primaryScore,
weightedScore: Number(primaryStrategy.weightedScore ?? primaryScore),
priorityScore: Number(primaryStrategy.priorityScore ?? getStrategyPriority(primaryStrategy)),
},
alternatives,
closestAlternative: alternatives.length ? alternatives[0] : null,
};
}
function buildHistoricalFusionLayer(campaignAdvisor = null) {
  if (!isCampaignAdvisorReliable(campaignAdvisor)) {
    return {
      enabled: false,
      reason: null,
      source: "none",
      confidence: campaignAdvisor?.confidence || "none",
      sampleSize: getCampaignAdvisorSamples(campaignAdvisor),
    };
  }

  const historicalRecommendation = findHistoricalRecommendation(campaignAdvisor);
  const confirmations = getCampaignAdvisorItems(campaignAdvisor, "recommendations").filter(
    (item) =>
      item?.type === "PERSONAL_BEST_MATCH" ||
      item?.type === "COLLECTIVE_BEST_MATCH"
  );

  const opportunities = getCampaignAdvisorItems(campaignAdvisor, "opportunities");
  const samples = getCampaignAdvisorSamples(campaignAdvisor);

  if (historicalRecommendation?.message) {
    return {
      enabled: true,
      source: historicalRecommendation.source || "historical",
      confidence: campaignAdvisor.confidence,
      sampleSize: samples,
      reason: `In più, il consulente storico segnala: ${historicalRecommendation.message}`,
      recommendationType: historicalRecommendation.type || null,
      positiveSignalsCount: confirmations.length,
      opportunitiesCount: opportunities.length,
    };
  }

  if (confirmations.length) {
    return {
      enabled: true,
      source: "historical",
      confidence: campaignAdvisor.confidence,
      sampleSize: samples,
      reason: "In più, lo storico campagne conferma alcuni elementi positivi della configurazione scelta.",
      recommendationType: "HISTORICAL_CONFIRMATION",
      positiveSignalsCount: confirmations.length,
      opportunitiesCount: opportunities.length,
    };
  }

  if (opportunities.length) {
    return {
      enabled: true,
      source: "historical",
      confidence: campaignAdvisor.confidence,
      sampleSize: samples,
      reason: "In più, lo storico campagne mostra opportunità utili da considerare per rafforzare la visibilità.",
      recommendationType: "HISTORICAL_OPPORTUNITY",
      positiveSignalsCount: confirmations.length,
      opportunitiesCount: opportunities.length,
    };
  }

  return {
    enabled: false,
    reason: null,
    source: "none",
    confidence: campaignAdvisor.confidence,
    sampleSize: samples,
  };
}

function applyHistoricalFusion(strategy = {}, historicalFusion = null) {
  if (!historicalFusion?.enabled || !historicalFusion.reason) return strategy;

  return {
    ...strategy,
    reason: appendSentence(strategy.reason, historicalFusion.reason),
    historicalFusionApplied: true,
    historicalFusion,
  };
}
function enrichStrategy(strategy = {}, personalization = null) {
const personalizedStrategy = applyBehaviorModifier(strategy, personalization);

const advisorSelectionPayload = {
strategyType: personalizedStrategy.type || "",
decisionScore: getStrategyDecisionScore(personalizedStrategy),
weightedScore: Number(
personalizedStrategy.weightedScore ?? getStrategyDecisionScore(personalizedStrategy)
),
priorityScore: Number(
personalizedStrategy.priorityScore ?? getStrategyPriority(personalizedStrategy)
),
};

function enrichAdvisorSelectionAction(action = {}) {
const enriched = enrichAction(action);

return {
...enriched,
action:
enriched.action === ACTION_TYPE.KEEP_CURRENT_SELECTION
? ACTION_TYPE.APPLY_PROMO_FIELDS
: enriched.action,
payload: {
...(enriched.payload || {}),
...advisorSelectionPayload,
},
};
}

return {
...personalizedStrategy,
objective: buildObjective(personalizedStrategy),
primaryAction: enrichAdvisorSelectionAction(personalizedStrategy.primaryAction),
secondaryActions: Array.isArray(personalizedStrategy.secondaryActions)
? personalizedStrategy.secondaryActions.map(enrichAdvisorSelectionAction)
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
  organizerProfile = null,
  campaignAdvisor = null,
} = {}) {
  const normalizedMode = normalizeMode(mode);
  const normalizedPromoStatus = normalizePromoStatus(promoStatus);
  const requestedRange = getRequestedRange({ payload, availability });
  const eventWindow = getEventWindow({ payload, availability });

  const personalization = buildPersonalizationLayer(organizerProfile);
const historicalFusion = buildHistoricalFusionLayer(campaignAdvisor);

const primaryStrategy = enrichStrategy(
  applyHistoricalFusion(
    selectPrimaryStrategy({
payload,
availability,
demand,
suggestions,
campaignAdvisor,
}),
    historicalFusion
  ),
  personalization
);

  const alternativeStrategies = buildAlternativeStrategies({
primaryType: primaryStrategy.type,
availability,
demand,
suggestions,
payload,
campaignAdvisor,
}).map((strategy) => enrichStrategy(strategy, personalization));

const decisionDelta = buildDecisionDelta(primaryStrategy, alternativeStrategies);
  return {
    version: ADVISOR_VERSION,
    mode: normalizedMode,
    promoStatus: normalizedPromoStatus,
    generatedAt: new Date().toISOString(),
    objective: primaryStrategy.objective,
organizerProfile,
personalization,
historicalFusion,
decisionDelta,
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
    alternativeStrategies,
    knowledgeLinks: buildKnowledgeLinks(),
    ui: {
      showAdvisor: true,
      showAlternativeStrategiesCta: alternativeStrategies.length > 0,
      alternativeStrategiesCtaLabel: "Mostra strategie alternative",
      showConfidencePercentage: false,
    },
  };
}

module.exports = {
  ADVISOR_VERSION,
  ADVISOR_MODE,
  PROMO_STATUS,
  PROMOTION_OBJECTIVE,
  STRATEGY_TYPE,
  STRATEGY_LEVEL,
  ACTION_TYPE,
  buildPromotionStrategyAdvisor,
};
