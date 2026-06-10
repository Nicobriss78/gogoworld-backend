// backend/services/campaignAnalyticsService.js
// Campaign Analytics Engine V1.5 — lettura on-demand e insight personali dagli snapshot storici promo

const mongoose = require("mongoose");
const { CampaignSnapshot } = require("../models/campaignSnapshotModel");

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const TOP_LIMIT = 5;
const MIN_SAMPLE_SIZE_FOR_RANKING = 1;
const MIN_SAMPLE_SIZE_FOR_CONFIDENT_INSIGHT = 3;

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMetric(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(2));
}

function normalizeLimit(value) {
  const parsed = Number(value || DEFAULT_LIMIT);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(parsed, MAX_LIMIT));
}

function normalizeText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeObjectId(value, fieldName) {
  if (!value) return null;
  if (!mongoose.Types.ObjectId.isValid(value)) {
    const err = new Error(`${fieldName} non valido.`);
    err.code = "INVALID_ANALYTICS_FILTER";
    err.statusCode = 400;
    throw err;
  }
  return new mongoose.Types.ObjectId(value);
}

function calculateDurationDays(schedule = {}) {
  if (!schedule.activeFrom || !schedule.activeTo) return null;

  const from = new Date(schedule.activeFrom);
  const to = new Date(schedule.activeTo);

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

function getCtrBucket(ctr) {
  const value = Number(ctr);
  if (!Number.isFinite(value) || value <= 0) return "0_ctr";
  if (value < 1) return "0_1_ctr";
  if (value < 3) return "1_3_ctr";
  if (value < 5) return "3_5_ctr";
  if (value < 10) return "5_10_ctr";
  return "10_plus_ctr";
}

function getVisibilityBucket(impressions) {
  const value = Number(impressions);
  if (!Number.isFinite(value) || value <= 0) return "0_impressions";
  if (value <= 50) return "1_50_impressions";
  if (value <= 200) return "51_200_impressions";
  if (value <= 500) return "201_500_impressions";
  if (value <= 1000) return "501_1000_impressions";
  return "1000_plus_impressions";
}

function buildFilter(filters = {}) {
  const query = { snapshotStatus: "COMPLETED" };

  const organizerId = normalizeObjectId(filters.organizerId, "organizerId");
  if (organizerId) query.organizerId = organizerId;

  const eventId = normalizeObjectId(filters.eventId, "eventId");
  if (eventId) query.eventId = eventId;

  const country = normalizeText(filters.country);
  if (country) query["placement.country"] = country;

  const region = normalizeText(filters.region);
  if (region) query["placement.region"] = region;

  const placement = normalizeText(filters.placement);
  if (placement) query["placement.code"] = placement;

  return query;
}

function summarizeCampaign(snapshot) {
  return {
    snapshotId: String(snapshot._id),
    bannerId: snapshot.bannerId ? String(snapshot.bannerId) : null,
    eventId: snapshot.eventId ? String(snapshot.eventId) : null,
    organizerId: snapshot.organizerId ? String(snapshot.organizerId) : null,
    title: snapshot.creativeSnapshot?.title || "",
    placement: snapshot.placement?.code || null,
    country: snapshot.placement?.country || null,
    region: snapshot.placement?.region || null,
    geoScope: snapshot.placement?.geoScope || null,
    activeFrom: snapshot.schedule?.activeFrom || null,
    activeTo: snapshot.schedule?.activeTo || null,
    completedAt: snapshot.schedule?.completedAt || null,
    durationDays: calculateDurationDays(snapshot.schedule),
    impressions: toNumber(snapshot.metrics?.impressions),
    clicks: toNumber(snapshot.metrics?.clicks),
    ctr: roundMetric(snapshot.metrics?.ctr),
    visibilityScore: snapshot.outcome?.visibilityScore ?? null,
    engagementScore: snapshot.outcome?.engagementScore ?? null,
    overallScore: snapshot.outcome?.overallScore ?? null,
    snapshotVersion: snapshot.snapshotVersion || 1,
  };
}

function buildTotals(campaigns) {
  const totals = campaigns.reduce(
    (acc, campaign) => {
      acc.impressions += campaign.impressions;
      acc.clicks += campaign.clicks;

      if (Number.isFinite(Number(campaign.overallScore))) {
        acc.overallScoreSum += Number(campaign.overallScore);
        acc.overallScoreCount += 1;
      }

      return acc;
    },
    {
      campaigns: campaigns.length,
      impressions: 0,
      clicks: 0,
      overallScoreSum: 0,
      overallScoreCount: 0,
    }
  );

  return {
    campaigns: totals.campaigns,
    impressions: totals.impressions,
    clicks: totals.clicks,
    ctr: totals.impressions > 0 ? roundMetric((totals.clicks / totals.impressions) * 100) : 0,
    averageOverallScore:
      totals.overallScoreCount > 0 ? roundMetric(totals.overallScoreSum / totals.overallScoreCount) : null,
  };
}

function topBy(campaigns, field, topLimit = TOP_LIMIT) {
  return campaigns
    .filter((campaign) => Number.isFinite(Number(campaign[field])))
    .sort((a, b) => Number(b[field]) - Number(a[field]))
    .slice(0, topLimit);
}

function buildGroupAnalytics(campaigns, keyGetter) {
  const groups = new Map();

  for (const campaign of campaigns) {
    const key = keyGetter(campaign) || "unknown";
    const existing = groups.get(key) || {
      key,
      campaigns: 0,
      impressions: 0,
      clicks: 0,
      overallScoreSum: 0,
      overallScoreCount: 0,
    };

    existing.campaigns += 1;
    existing.impressions += campaign.impressions;
    existing.clicks += campaign.clicks;

    if (Number.isFinite(Number(campaign.overallScore))) {
      existing.overallScoreSum += Number(campaign.overallScore);
      existing.overallScoreCount += 1;
    }

    groups.set(key, existing);
  }

  return Array.from(groups.values())
    .map((group) => ({
      key: group.key,
      campaigns: group.campaigns,
      impressions: group.impressions,
      clicks: group.clicks,
      ctr: group.impressions > 0 ? roundMetric((group.clicks / group.impressions) * 100) : 0,
      averageOverallScore:
        group.overallScoreCount > 0 ? roundMetric(group.overallScoreSum / group.overallScoreCount) : null,
      sampleSizeReliable: group.campaigns >= MIN_SAMPLE_SIZE_FOR_RANKING,
    }))
    .sort((a, b) => {
      const scoreA = Number.isFinite(Number(a.averageOverallScore)) ? Number(a.averageOverallScore) : -1;
      const scoreB = Number.isFinite(Number(b.averageOverallScore)) ? Number(b.averageOverallScore) : -1;

      if (scoreB !== scoreA) return scoreB - scoreA;
      return b.ctr - a.ctr;
    });
}

function pickBestGroup(groups = []) {
  return groups.find((group) => group.key !== "unknown" && group.campaigns > 0) || null;
}

function buildInsight(kind, group) {
  if (!group) return null;

  return {
    kind,
    key: group.key,
    campaigns: group.campaigns,
    impressions: group.impressions,
    clicks: group.clicks,
    ctr: group.ctr,
    averageOverallScore: group.averageOverallScore,
    confidence: group.campaigns >= MIN_SAMPLE_SIZE_FOR_CONFIDENT_INSIGHT ? "medium" : "low",
  };
}

function buildCampaignInsights(campaigns, groups) {
  const bestOverallCampaign = topBy(campaigns, "overallScore", 1)[0] || null;
  const bestCtrCampaign = topBy(campaigns, "ctr", 1)[0] || null;
  const sampleSize = campaigns.length;

  return {
    sampleSize,
    confidence: sampleSize >= MIN_SAMPLE_SIZE_FOR_CONFIDENT_INSIGHT ? "medium" : "low",
    hasEnoughData: sampleSize >= MIN_SAMPLE_SIZE_FOR_CONFIDENT_INSIGHT,
    bestDuration: buildInsight("best_duration_bucket", pickBestGroup(groups.byDurationBucket)),
    bestRegion: buildInsight("best_region", pickBestGroup(groups.byRegion)),
    bestPlacement: buildInsight("best_placement", pickBestGroup(groups.byPlacement)),
    bestCtrRange: buildInsight("best_ctr_range", pickBestGroup(groups.byCtrRange)),
    bestVisibilityRange: buildInsight("best_visibility_range", pickBestGroup(groups.byVisibilityRange)),
    topCampaign: bestOverallCampaign || bestCtrCampaign,
    notes:
      sampleSize >= MIN_SAMPLE_SIZE_FOR_CONFIDENT_INSIGHT
        ? []
        : ["Campione storico ancora ridotto: gli insight sono osservazioni preliminari, non regole definitive."],
  };
}

async function buildCampaignAnalytics(filters = {}) {
  const query = buildFilter(filters);
  const limit = normalizeLimit(filters.limit);

  const snapshots = await CampaignSnapshot.find(query)
    .sort({ "schedule.completedAt": -1 })
    .limit(limit)
    .lean();

  const campaigns = snapshots.map(summarizeCampaign);

  const groups = {
    byRegion: buildGroupAnalytics(campaigns, (campaign) => campaign.region),
    byPlacement: buildGroupAnalytics(campaigns, (campaign) => campaign.placement),
    byDurationBucket: buildGroupAnalytics(campaigns, (campaign) => getDurationBucket(campaign.durationDays)),
    byCtrRange: buildGroupAnalytics(campaigns, (campaign) => getCtrBucket(campaign.ctr)),
    byVisibilityRange: buildGroupAnalytics(campaigns, (campaign) => getVisibilityBucket(campaign.impressions)),
  };

  return {
    generatedAt: new Date(),
    filters: {
      organizerId: filters.organizerId || null,
      eventId: filters.eventId || null,
      country: filters.country || null,
      region: filters.region || null,
      placement: filters.placement || null,
      limit,
    },
    totals: buildTotals(campaigns),
    insights: buildCampaignInsights(campaigns, groups),
    topCampaigns: {
      byCtr: topBy(campaigns, "ctr"),
      byVisibility: topBy(campaigns, "visibilityScore"),
      byEngagement: topBy(campaigns, "engagementScore"),
      byOverall: topBy(campaigns, "overallScore"),
    },
    groups,
  };
}

module.exports = {
  buildCampaignAnalytics,
  calculateDurationDays,
  getDurationBucket,
  getCtrBucket,
  getVisibilityBucket,
};
