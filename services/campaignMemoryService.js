// backend/services/campaignMemoryService.js
// Campaign Memory Engine V0 — creazione snapshot storico promo concluse

const { Banner, BannerStatsDaily } = require("../models/bannerModel");
const { CampaignSnapshot } = require("../models/campaignSnapshotModel");
const { buildCampaignOutcomeScore } = require("./campaignOutcomeScoreService");
function calculateCtr(clicks, impressions) {
  const safeClicks = Number(clicks || 0);
  const safeImpressions = Number(impressions || 0);

  if (!safeImpressions) return 0;

  return Number(((safeClicks / safeImpressions) * 100).toFixed(2));
}

function isEligibleCompletedPromo(banner, nowDate = new Date()) {
  if (!banner) return false;
  if (String(banner.type || "") !== "event_promo") return false;

  const status = String(banner.status || "").toUpperCase();
  const allowedStatuses = new Set(["SCHEDULED", "ACTIVE", "ENDED"]);

  if (!allowedStatuses.has(status)) return false;
  if (!banner.activeTo) return false;

  const activeTo = new Date(banner.activeTo);
  return activeTo <= nowDate;
}

function buildSnapshotPayload({ banner, dailyStats, nowDate }) {
  const impressions = Number(banner.impressionsTotal || 0);
  const clicks = Number(banner.clicksTotal || 0);

  const dailyMetrics = (dailyStats || []).map((stat) => {
    const dailyImpressions = Number(stat.impressions || 0);
    const dailyClicks = Number(stat.clicks || 0);

    return {
      day: stat.day,
      impressions: dailyImpressions,
      clicks: dailyClicks,
      ctr: calculateCtr(dailyClicks, dailyImpressions),
    };
  });

  return {
    bannerId: banner._id,
    snapshotVersion: 2,
    eventId: banner.eventId || null,
    organizerId: banner.createdBy || null,
    snapshotStatus: "COMPLETED",

    metrics: {
      impressions,
      clicks,
      ctr: calculateCtr(clicks, impressions),
    },

    dailyMetrics,

    placement: {
      code: banner.placement || null,
      country: banner.country || null,
      region: banner.region || null,
      geoScope: banner.geoScope || null,
    },

    schedule: {
      activeFrom: banner.activeFrom || null,
      activeTo: banner.activeTo || null,
      completedAt: banner.activeTo || nowDate,
      snapshottedAt: nowDate,
    },

    pricing: {
      estimatedPrice: Number(banner.estimatedPrice || 0),
      currency: banner.currency || "EUR",
      pricingSnapshot: banner.pricingSnapshot || null,
    },

    demandSnapshot: banner.demandSnapshot || null,

    creativeSnapshot: {
      title: banner.title || "",
      imageUrl: banner.imageUrl || "",
      targetUrl: banner.targetUrl || "",
      imageHash: null,
      tags: [],
    },

    outcome: buildCampaignOutcomeScore({
      metrics: {
        impressions,
        clicks,
        ctr: calculateCtr(clicks, impressions),
      },
      placement: {
        geoScope: banner.geoScope || null,
      },
    }),
  };
}

async function createCampaignSnapshotForBanner(bannerId, options = {}) {
  const nowDate = options.nowDate || new Date();

  const banner = await Banner.findById(bannerId).lean();

  if (!banner) {
    const err = new Error("Promo non trovata.");
    err.code = "PROMO_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }

  if (!isEligibleCompletedPromo(banner, nowDate)) {
    const err = new Error("La promo non è ancora eleggibile per lo snapshot storico.");
    err.code = "PROMO_SNAPSHOT_NOT_ELIGIBLE";
    err.statusCode = 409;
    throw err;
  }

  const existing = await CampaignSnapshot.findOne({ bannerId: banner._id }).lean();

  if (existing) {
    return {
      created: false,
      snapshot: existing,
    };
  }

  const dailyStats = await BannerStatsDaily.find({ banner: banner._id })
    .sort({ day: 1 })
    .lean();

  const payload = buildSnapshotPayload({ banner, dailyStats, nowDate });
  const snapshot = await CampaignSnapshot.create(payload);

  return {
    created: true,
    snapshot: snapshot.toObject(),
  };
}

async function processEndedCampaignSnapshots(options = {}) {
  const nowDate = options.nowDate || new Date();
  const limit = Math.max(1, Math.min(Number(options.limit) || 25, 100));

  const existingSnapshots = await CampaignSnapshot.find({})
    .select("bannerId")
    .lean();

  const alreadySnapshottedIds = existingSnapshots.map((item) => item.bannerId);

  const endedPromos = await Banner.find({
    _id: { $nin: alreadySnapshottedIds },
    type: "event_promo",
    status: { $in: ["SCHEDULED", "ACTIVE", "ENDED"] },
    activeTo: { $ne: null, $lte: nowDate },
  })
    .sort({ activeTo: 1 })
    .limit(limit)
    .lean();

  const results = [];

  for (const promo of endedPromos) {
    try {
      const result = await createCampaignSnapshotForBanner(promo._id, { nowDate });
      results.push({
        bannerId: String(promo._id),
        created: result.created,
        error: null,
      });
    } catch (err) {
      results.push({
        bannerId: String(promo._id),
        created: false,
        error: err.code || "SNAPSHOT_FAILED",
      });
    }
  }

  return {
    processed: results.length,
    created: results.filter((item) => item.created).length,
    results,
  };
}

module.exports = {
  calculateCtr,
  createCampaignSnapshotForBanner,
  processEndedCampaignSnapshots,
};
