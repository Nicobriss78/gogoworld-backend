// backend/services/campaignOutcomeScoreService.js
// Campaign Memory Engine V2 — scoring derivato da dati storici già misurati

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Number(number.toFixed(2))));
}

function getVisibilityReferenceByGeoScope(geoScope) {
  const normalized = String(geoScope || "REGION").toUpperCase();

  if (normalized === "GLOBAL") return 5000;
  if (normalized === "COUNTRY") return 2000;

  return 500;
}

function calculateVisibilityScore({ impressions, geoScope }) {
  const safeImpressions = Number(impressions || 0);
  if (safeImpressions <= 0) return 0;

  const reference = getVisibilityReferenceByGeoScope(geoScope);
  return clampScore((safeImpressions / reference) * 100);
}

function calculateEngagementScore({ ctr }) {
  const safeCtr = Number(ctr || 0);
  if (safeCtr <= 0) return 0;

  // CTR storico in percentuale. In questa V2 iniziale 10% equivale al punteggio pieno.
  return clampScore((safeCtr / 10) * 100);
}

function calculateOverallScore(scores) {
  const measurableScores = scores
    .map((score) => Number(score))
    .filter((score) => Number.isFinite(score));

  if (!measurableScores.length) return null;

  const total = measurableScores.reduce((sum, score) => sum + score, 0);
  return clampScore(total / measurableScores.length);
}

function buildCampaignOutcomeScore({ metrics, placement } = {}) {
  const impressions = Number(metrics?.impressions || 0);
  const ctr = Number(metrics?.ctr || 0);
  const geoScope = placement?.geoScope || null;

  const visibilityScore = calculateVisibilityScore({ impressions, geoScope });
  const engagementScore = calculateEngagementScore({ ctr });

  // Non vengono inventati dati non presenti nello snapshot V0/V1.
  const participationScore = null;
  const followerScore = null;

  const overallScore = calculateOverallScore([
    visibilityScore,
    engagementScore,
    participationScore,
    followerScore,
  ]);

  return {
    visibilityScore,
    engagementScore,
    participationScore,
    followerScore,
    overallScore,
  };
}

module.exports = {
  buildCampaignOutcomeScore,
  calculateVisibilityScore,
  calculateEngagementScore,
  calculateOverallScore,
};
