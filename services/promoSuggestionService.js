// backend/services/promoSuggestionService.js
// Suggestion Engine V1 — consigli strategici eleganti per Promozioni Organizer V2

const {
  calculateDemandFromAvailability,
} = require("./promoDemandScarcityService");

const SUGGESTION_STATUS = {
  NEUTRAL: "NEUTRAL",
  HAS_BETTER_WINDOW: "HAS_BETTER_WINDOW",
  MICRO_OPTIMIZATION: "MICRO_OPTIMIZATION",
  TRILL_STRATEGY: "TRILL_STRATEGY",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CANDIDATE_SHIFT_DAYS = 30;
const MIN_SCORE_IMPROVEMENT = 15;

function startOfUtcDay(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next;
}

function formatUtcDay(date) {
  const normalized = startOfUtcDay(date);
  return normalized ? normalized.toISOString().slice(0, 10) : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function normalizeScore(value) {
  return clamp(Math.round(Number(value || 0)), 0, 100);
}

function buildNeutralSuggestion(constraints) {
  return {
    status: SUGGESTION_STATUS.NEUTRAL,
    tone: "soft",
    title: "",
    message: "",
    items: [],
    constraints,
    trillFallback: {
      recommended: false,
      message: "",
    },
  };
}

function buildConstraints({ availability = {}, eventStart, eventEnd }) {
  const activeFrom = availability.activeFrom || null;
  const activeTo = availability.activeTo || null;
  const maxSuggestedEnd = eventEnd ? formatUtcDay(eventEnd) : null;

  return {
    eventStart: eventStart ? eventStart.toISOString() : null,
    eventEnd: eventEnd ? eventEnd.toISOString() : null,
    maxSuggestedEnd,
    activeFrom,
    activeTo,
    respectsEventWindow: true,
  };
}

function getEventWindow({ payload = {}, availability = {} }) {
  const eventWindow = availability.eventWindow || {};

  return {
    eventStart: eventWindow.eventStart
      ? new Date(eventWindow.eventStart)
      : payload.eventStart
      ? new Date(payload.eventStart)
      : null,
    eventEnd: eventWindow.eventEnd
      ? new Date(eventWindow.eventEnd)
      : payload.eventEnd
      ? new Date(payload.eventEnd)
      : null,
  };
}

function getRequestedRange({ payload = {}, availability = {} }) {
  const activeFrom = startOfUtcDay(availability.activeFrom || payload.activeFrom);
  const activeTo = startOfUtcDay(availability.activeTo || payload.activeTo);

  if (!activeFrom || !activeTo) {
    return { activeFrom: null, activeTo: null, durationDays: 0 };
  }

  const durationDays = Math.max(
    1,
    Math.round((activeTo.getTime() - activeFrom.getTime()) / DAY_MS) + 1
  );

  return { activeFrom, activeTo, durationDays };
}

function shouldLookForBetterWindow({ availability = {}, demand = {} }) {
  const score = normalizeScore(demand.competitionScore);
  const status = String(availability.status || availability.availabilityLevel || "");

  return (
    score >= 65 ||
    status === "LOW_AVAILABILITY" ||
    status === "PARTIALLY_AVAILABLE" ||
    Number(availability.limitedDaysCount || availability.limitedCount || 0) > 0 ||
    Number(availability.blockedDaysCount || availability.blockedCount || 0) > 0
  );
}

function shouldSuggestTrills({ demand = {}, availability = {} }) {
  const score = normalizeScore(demand.competitionScore);
  const pressure = String(demand.periodPressure || "").toUpperCase();
  const status = String(availability.status || availability.availabilityLevel || "");

  return (
    score >= 65 ||
    pressure === "HIGH" ||
    pressure === "VERY_HIGH" ||
    status === "LOW_AVAILABILITY" ||
    status === "PARTIALLY_AVAILABLE"
  );
}

function buildCandidatePayload({ payload, from, to }) {
  return {
    ...payload,
    activeFrom: formatUtcDay(from),
    activeTo: formatUtcDay(to),
  };
}

async function findBetterWindow({
  payload,
  demand,
  requestedRange,
  eventEnd,
  checkAvailability,
}) {
  if (typeof checkAvailability !== "function") return null;
  if (!requestedRange.activeFrom || !requestedRange.activeTo) return null;
  if (!eventEnd) return null;

  const currentScore = normalizeScore(demand.competitionScore);
  const eventEndDay = startOfUtcDay(eventEnd);
  if (!eventEndDay) return null;

  let best = null;

  for (let shift = 1; shift <= MAX_CANDIDATE_SHIFT_DAYS; shift += 1) {
    const candidateFrom = addUtcDays(requestedRange.activeFrom, shift);
    const candidateTo = addUtcDays(
      candidateFrom,
      requestedRange.durationDays - 1
    );

    if (candidateTo > eventEndDay) break;

    try {
      const candidateAvailability = await checkAvailability(
        buildCandidatePayload({ payload, from: candidateFrom, to: candidateTo })
      );

      if (
  !candidateAvailability ||
  candidateAvailability.available === false ||
  candidateAvailability.status !== "AVAILABLE" ||
  Number(candidateAvailability.blockedCount || 0) > 0 ||
  Number(candidateAvailability.fullDaysCount || 0) > 0
) {
  continue;
}

      const candidateDemand = calculateDemandFromAvailability(candidateAvailability);
      const candidateScore = normalizeScore(candidateDemand.competitionScore);
      const improvement = currentScore - candidateScore;

      const hasBlockedCurrentDays =
  Number(demand?.signals?.blockedDaysCount || 0) > 0;

const minimumImprovement = hasBlockedCurrentDays
  ? 8
  : MIN_SCORE_IMPROVEMENT;

if (improvement < minimumImprovement) {
  continue;
}

      const candidate = {
        type: "BETTER_WINDOW",
        activeFrom: formatUtcDay(candidateFrom),
        activeTo: formatUtcDay(candidateTo),
        competitionScore: candidateScore,
        improvement,
        message:
        "Questa finestra resta entro la durata dell’evento e presenta una pressione promozionale più favorevole.",
      };

      if (!best || candidate.improvement > best.improvement) {
        best = candidate;
      }
    } catch (err) {
      // Le finestre candidate non valide vengono semplicemente ignorate:
      // Availability resta il punto autorevole per fattibilità e vincoli temporali.
    }
  }

  return best;
}

function buildBetterWindowSuggestion({ constraints, betterWindow }) {
  return {
    status: SUGGESTION_STATUS.HAS_BETTER_WINDOW,
    tone: "strategic",
    title: "Periodo consigliato",
    message:
"La parte iniziale del periodo scelto risulta particolarmente richiesta. Abbiamo individuato una finestra successiva, sempre entro la durata dell’evento, che può offrire condizioni più favorevoli per la visibilità.",
    items: [betterWindow],
    constraints,
    trillFallback: {
      recommended: false,
      message: "",
    },
  };
}

function buildMicroOptimizationSuggestion({ constraints }) {
  return {
    status: SUGGESTION_STATUS.MICRO_OPTIMIZATION,
    tone: "positive",
    title: "Periodo favorevole",
    message:
"Il periodo scelto appare favorevole. Una creatività chiara e riconoscibile può aiutare la promozione a ottenere risultati migliori.",
    items: [
      {
        type: "CREATIVE_CLARITY",
        message:
"Mantieni titolo, immagine e messaggio della promozione chiari e immediati: nei periodi più attivi la riconoscibilità conta ancora di più.",
      },
    ],
    constraints,
    trillFallback: {
      recommended: false,
      message: "",
    },
  };
}

function buildTrillStrategySuggestion({ constraints }) {
  return {
    status: SUGGESTION_STATUS.TRILL_STRATEGY,
    tone: "strategic",
    title: "Supporto strategico consigliato",
    message:
      "Il periodo selezionato risulta molto richiesto e non emergono finestre significativamente migliori entro la durata dell’evento. I Trilli possono aiutare a rafforzare la visibilità nei momenti più utili.",
    items: [
      {
        type: "TRILL_SUPPORT",
        message:
          "Attiva uno o più Trilli in prossimità dell’evento per aumentare richiamo e presenza.",
      },
    ],
    constraints,
    trillFallback: {
      recommended: false,
      message: "",
    },
  };
}

async function generatePromoSuggestions({
  payload = {},
  pricing = null,
  availability = {},
  demand = {},
  checkAvailability = null,
} = {}) {
  const { eventStart, eventEnd } = getEventWindow({ payload, availability });
  const constraints = buildConstraints({ availability, eventStart, eventEnd });
  const requestedRange = getRequestedRange({ payload, availability });
  const score = normalizeScore(demand.competitionScore);

  if (!requestedRange.activeFrom || !requestedRange.activeTo) {
    return buildNeutralSuggestion(constraints);
  }

  const betterWindow = shouldLookForBetterWindow({ availability, demand })
    ? await findBetterWindow({
        payload,
        demand,
        requestedRange,
        eventEnd,
        checkAvailability,
      })
    : null;

  if (betterWindow) {
    return buildBetterWindowSuggestion({ constraints, betterWindow });
  }

  if (shouldSuggestTrills({ demand, availability })) {
    return buildTrillStrategySuggestion({ constraints });
  }

  if (score >= 40) {
    return buildMicroOptimizationSuggestion({ constraints });
  }

  return buildNeutralSuggestion(constraints);
}

module.exports = {
  SUGGESTION_STATUS,
  generatePromoSuggestions,
};
