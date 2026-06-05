// backend/models/campaignSnapshotModel.js
// Campaign Memory Engine V0 — snapshot storico immutabile delle promo concluse

const mongoose = require("mongoose");

const dailyMetricSchema = new mongoose.Schema(
  {
    day: { type: Date, required: true },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    ctr: { type: Number, default: 0 },
  },
  { _id: false }
);

const campaignSnapshotSchema = new mongoose.Schema(
  {
    bannerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Banner",
      required: true,
      unique: true,
      index: true,
    },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", index: true, default: null },
    organizerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, default: null },

    snapshotStatus: {
      type: String,
      enum: ["COMPLETED"],
      default: "COMPLETED",
      index: true,
    },

    metrics: {
      impressions: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
      ctr: { type: Number, default: 0 },
    },

    dailyMetrics: {
      type: [dailyMetricSchema],
      default: [],
    },

    placement: {
      code: { type: String, default: null, index: true },
      country: { type: String, default: null, index: true },
      region: { type: String, default: null, index: true },
      geoScope: { type: String, default: null },
    },

    schedule: {
      activeFrom: { type: Date, default: null },
      activeTo: { type: Date, default: null },
      completedAt: { type: Date, default: null, index: true },
      snapshottedAt: { type: Date, default: Date.now, index: true },
    },

    pricing: {
      estimatedPrice: { type: Number, default: 0 },
      currency: { type: String, default: "EUR" },
      pricingSnapshot: { type: Object, default: null },
    },

    demandSnapshot: {
      type: Object,
      default: null,
    },

    creativeSnapshot: {
      title: { type: String, default: "" },
      imageUrl: { type: String, default: "" },
      targetUrl: { type: String, default: "" },
      imageHash: { type: String, default: null },
      tags: { type: [String], default: [] },
    },

    outcome: {
      visibilityScore: { type: Number, default: null },
      engagementScore: { type: Number, default: null },
      participationScore: { type: Number, default: null },
      followerScore: { type: Number, default: null },
      overallScore: { type: Number, default: null },
    },
  },
  { timestamps: true }
);

campaignSnapshotSchema.index({ organizerId: 1, "schedule.completedAt": -1 });
campaignSnapshotSchema.index({ eventId: 1, "schedule.completedAt": -1 });
campaignSnapshotSchema.index({ "placement.code": 1, "placement.country": 1, "placement.region": 1 });

const CampaignSnapshot = mongoose.model("CampaignSnapshot", campaignSnapshotSchema);

module.exports = {
  CampaignSnapshot,
};
