// backend/services/campaignAdvisorEngineService.js
// Campaign Advisor Engine V1 — traduce Campaign Memory/Intelligence in consigli operativi prudenti

const ENGINE_VERSION = "CAMPAIGN_ADVISOR_ENGINE_V1";

const CONFIDENCE = {
  NONE: "none",
  LOW: "low",
  MEDIUM: "medium",
};

const RECOMMENDATION_TYPE = {
  DURATION_ALIGNMENT: "DURATION_ALIGNMENT",
  PLACEMENT_ALIGNMENT: "PLACEMENT_ALIGNMENT",
  REGION_ALIGNMENT: "REGION_ALIGNMENT",
  CTR_OPPORTUNITY: "CTR_OPPORTUNITY",
  VISIBILITY_OPPORTUNITY: "VISIBILITY_OPPORTUNITY",
  PERSONAL_BEST_MATCH: "PERSONAL_BEST_MATCH",
  COLLECTIVE_BEST_MATCH: "COLLECTIVE_BEST_MATCH",
  LOW_DATA_WARNING: "LOW_DATA_WARNING",
};

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeKey(value) {
  return normalizeText(value) || "unknown";
}

function calculateDurationDays(payload = {}) {
  if (!payload.activeFrom || !payload.activeTo) return null;

  const from = new Date(payload.activeFrom);
  const to = new Date(payload.activeTo);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;

  const diffMs = to.getTime() - from.getTime();
  if (diffMs < 0) return null;

  return Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

function getDurationBucket(durationDays) {
  const days = Number(durationDays);
  if (!Number.isFinite(days) || days <= 0) return "unknown";
  if (days <= 1) return "1_day";
  if (days <= 3) return "2_3_days";
  if (days <= 7) return "4_7_days";
  if (days <= 14) return "8_14_days";
  return "15_plus_days";
}

function formatDurationBucket(bucket) {
  const labels = {
    "1_day": "1 giorno",
    "2_3_days": "2-3 giorni",
    "4_7_days": "4-7 giorni",
    "8_14_days": "8-14 giorni",
    "15_plus_days": "15+ giorni",
  };

  return labels[bucket] || "durata non classificata";
}

function getAnalytics(intelligence) {
  return intelligence && intelligence.analytics ? intelligence.analytics : intelligence;
}

function getInsights(intelligence) {
  const analytics = getAnalytics(intelligence);
  return analytics && analytics.insights ? analytics.insights : {};
}

function getTotals(intelligence) {
  const analytics = getAnalytics(intelligence);
  return analytics && analytics.totals ? analytics.totals : {};
}

function getSampleSize(intelligence) {
  const insights = getInsights(intelligence);
  const totals = getTotals(intelligence);
  return toNumber(insights.sampleSize, toNumber(totals.campaigns, 0));
}

function getInsightConfidence(intelligence) {
  const insights = getInsights(intelligence);
  return normalizeText(insights.confidence) || CONFIDENCE.NONE;
}

function hasEnoughData(intelligence) {
  const insights = getInsights(intelligence);
  return Boolean(insights.hasEnoughData);
}

function makeRecommendation({ type, source, level = "info", title, message, evidence = null, action = null }) {
  return {
    type,
    source,
    level,
    title,
    message,
    evidence,
    action,
  };
}

function buildLowDataWarning(source, sampleSize) {
  return makeRecommendation({
    type: RECOMMENDATION_TYPE.LOW_DATA_WARNING,
    source,
    level: "warning",
    title: source === "personal" ? "Storico personale ancora limitato" : "Storico collettivo ancora limitato",
    message:
      source === "personal"
        ? "Il campione storico di questo organizer è ancora ridotto: i consigli personali vanno letti come segnali preliminari."
        : "Il campione storico della piattaforma per questo contesto è ancora ridotto: i consigli collettivi vanno letti come segnali preliminari.",
    evidence: { sampleSize },
  });
}

function buildDurationRecommendation({ source, currentBucket, bestDuration }) {
  if (!bestDuration || !bestDuration.key || bestDuration.key === "unknown") return null;

  if (currentBucket === bestDuration.key) {
    return makeRecommendation({
      type:
        source === "personal"
          ? RECOMMENDATION_TYPE.PERSONAL_BEST_MATCH
          : RECOMMENDATION_TYPE.COLLECTIVE_BEST_MATCH,
      source,
      level: "positive",
      title: "Durata allineata allo storico migliore",
      message: `La durata scelta è allineata alla fascia che finora ha performato meglio: ${formatDurationBucket(bestDuration.key)}.`,
      evidence: bestDuration,
    });
  }

  return makeRecommendation({
    type: RECOMMENDATION_TYPE.DURATION_ALIGNMENT,
    source,
    level: "suggestion",
    title: "Valuta una durata più allineata allo storico",
    message: `Lo storico indica risultati migliori per promo da ${formatDurationBucket(bestDuration.key)}. La durata attuale ricade invece in ${formatDurationBucket(currentBucket)}.`,
    evidence: bestDuration,
    action: {
      kind: "CONSIDER_DURATION_BUCKET",
      targetBucket: bestDuration.key,
    },
  });
}

function buildPlacementRecommendation({ source, currentPlacement, bestPlacement }) {
  if (!bestPlacement || !bestPlacement.key || bestPlacement.key === "unknown") return null;
  if (!currentPlacement) return null;

  if (currentPlacement === bestPlacement.key) {
    return makeRecommendation({
      type:
        source === "personal"
          ? RECOMMENDATION_TYPE.PERSONAL_BEST_MATCH
          : RECOMMENDATION_TYPE.COLLECTIVE_BEST_MATCH,
      source,
      level: "positive",
      title: "Placement coerente con lo storico migliore",
      message: `Il placement scelto coincide con quello che finora ha dato segnali migliori: ${bestPlacement.key}.`,
      evidence: bestPlacement,
    });
  }

  return makeRecommendation({
    type: RECOMMENDATION_TYPE.PLACEMENT_ALIGNMENT,
    source,
    level: "suggestion",
    title: "Valuta un placement alternativo",
    message: `Lo storico segnala performance migliori sul placement ${bestPlacement.key}, mentre la promo attuale usa ${currentPlacement}.`,
    evidence: bestPlacement,
    action: {
      kind: "CONSIDER_PLACEMENT",
      placement: bestPlacement.key,
    },
  });
}

function buildRegionRecommendation({ source, currentRegion, bestRegion }) {
  if (!bestRegion || !bestRegion.key || bestRegion.key === "unknown") return null;
  if (!currentRegion) return null;

  if (currentRegion === bestRegion.key) {
    return makeRecommendation({
      type:
        source === "personal"
          ? RECOMMENDATION_TYPE.PERSONAL_BEST_MATCH
          : RECOMMENDATION_TYPE.COLLECTIVE_BEST_MATCH,
      source,
      level: "positive",
      title: "Area coerente con lo storico migliore",
      message: `La regione scelta coincide con quella che finora ha dato segnali migliori: ${bestRegion.key}.`,
      evidence: bestRegion,
    });
  }

  return makeRecommendation({
    type: RECOMMENDATION_TYPE.REGION_ALIGNMENT,
    source,
    level: "suggestion",
    title: "Segnale storico su un’altra area",
    message: `Lo storico segnala performance migliori in ${bestRegion.key}. Mantieni la regione attuale se è vincolata all’evento, ma considera questo dato per le prossime promo.`,
    evidence: bestRegion,
    action: {
      kind: "LEARN_FOR_NEXT_CAMPAIGN",
      region: bestRegion.key,
    },
  });
}

function buildPerformanceOpportunities({ source, insights }) {
  const out = [];

  if (insights.bestCtrRange && insights.bestCtrRange.key && insights.bestCtrRange.key !== "unknown") {
    out.push(
      makeRecommendation({
        type: RECOMMENDATION_TYPE.CTR_OPPORTUNITY,
        source,
        level: "info",
        title: "Fascia CTR storicamente più interessante",
        message: `Le campagne migliori per interazione ricadono nella fascia CTR ${insights.bestCtrRange.key}.`,
        evidence: insights.bestCtrRange,
      })
    );
  }

  if (
    insights.bestVisibilityRange &&
    insights.bestVisibilityRange.key &&
    insights.bestVisibilityRange.key !== "unknown"
  ) {
    out.push(
      makeRecommendation({
        type: RECOMMENDATION_TYPE.VISIBILITY_OPPORTUNITY,
        source,
        level: "info",
        title: "Fascia visibilità storicamente più interessante",
        message: `Le campagne migliori per visibilità ricadono nella fascia ${insights.bestVisibilityRange.key}.`,
        evidence: insights.bestVisibilityRange,
      })
    );
  }

  return out;
}

function buildRecommendationsFromIntelligence({ source, current, intelligence }) {
  const sampleSize = getSampleSize(intelligence);
  const insights = getInsights(intelligence);
  const recommendations = [];
  const warnings = [];
  const opportunities = [];

  if (!sampleSize || !hasEnoughData(intelligence)) {
    warnings.push(buildLowDataWarning(source, sampleSize));
  }

  const durationRecommendation = buildDurationRecommendation({
    source,
    currentBucket: current.durationBucket,
    bestDuration: insights.bestDuration,
  });
  if (durationRecommendation) recommendations.push(durationRecommendation);

  const placementRecommendation = buildPlacementRecommendation({
    source,
    currentPlacement: current.placement,
    bestPlacement: insights.bestPlacement,
  });
  if (placementRecommendation) recommendations.push(placementRecommendation);

  const regionRecommendation = buildRegionRecommendation({
    source,
    currentRegion: current.region,
    bestRegion: insights.bestRegion,
  });
  if (regionRecommendation) recommendations.push(regionRecommendation);

  opportunities.push(...buildPerformanceOpportunities({ source, insights }));

  return {
    sampleSize,
    confidence: getInsightConfidence(intelligence),
    recommendations,
    warnings: warnings.filter(Boolean),
    opportunities,
    topCampaign: insights.topCampaign || null,
  };
}

function calculateOverallConfidence(personal, collective) {
  if (personal.confidence === CONFIDENCE.MEDIUM) return CONFIDENCE.MEDIUM;
  if (collective.confidence === CONFIDENCE.MEDIUM) return CONFIDENCE.MEDIUM;
  if (personal.sampleSize > 0 || collective.sampleSize > 0) return CONFIDENCE.LOW;
  return CONFIDENCE.NONE;
}

function buildComparison(personal, collective) {
  return {
    personalSampleSize: personal.sampleSize,
    collectiveSampleSize: collective.sampleSize,
    personalConfidence: personal.confidence,
    collectiveConfidence: collective.confidence,
    preferredSource:
      personal.confidence === CONFIDENCE.MEDIUM
        ? "personal"
        : collective.confidence === CONFIDENCE.MEDIUM
          ? "collective"
          : "none",
  };
}

function buildCampaignAdvisorEngine({
  payload = {},
  personalIntelligence = null,
  collectiveIntelligence = null,
} = {}) {
  const durationDays = calculateDurationDays(payload);
  const current = {
    placement: normalizeKey(payload.placement),
    country: normalizeText(payload.country),
    region: normalizeText(payload.region),
    durationDays,
    durationBucket: getDurationBucket(durationDays),
  };

  const personal = buildRecommendationsFromIntelligence({
    source: "personal",
    current,
    intelligence: personalIntelligence,
  });

  const collective = buildRecommendationsFromIntelligence({
    source: "collective",
    current,
    intelligence: collectiveIntelligence,
  });

  const recommendations = [...personal.recommendations, ...collective.recommendations];
  const warnings = [...personal.warnings, ...collective.warnings];
  const opportunities = [...personal.opportunities, ...collective.opportunities];
  const confidence = calculateOverallConfidence(personal, collective);

  return {
    engineVersion: ENGINE_VERSION,
    generatedAt: new Date(),
    confidence,
    sampleSize: {
      personal: personal.sampleSize,
      collective: collective.sampleSize,
    },
    hasPersonalData: personal.sampleSize > 0,
    hasCollectiveData: collective.sampleSize > 0,
    currentCampaign: current,
    historicalSignals: {
      personal: {
        confidence: personal.confidence,
        topCampaign: personal.topCampaign,
      },
      collective: {
        confidence: collective.confidence,
        topCampaign: collective.topCampaign,
      },
    },
    recommendations,
    warnings,
    opportunities,
    comparison: buildComparison(personal, collective),
    ui: {
      visible: recommendations.length > 0 || warnings.length > 0 || opportunities.length > 0,
      title: "Consulente storico campagne",
      subtitle:
        confidence === CONFIDENCE.NONE
          ? "Non ci sono ancora dati storici sufficienti."
          : "Suggerimenti basati su storico personale e dati collettivi.",
      priority: warnings.length > 0 ? "warning" : recommendations.length > 0 ? "suggestion" : "info",
    },
  };
}

module.exports = {
  buildCampaignAdvisorEngine,
  ENGINE_VERSION,
  RECOMMENDATION_TYPE,
};
