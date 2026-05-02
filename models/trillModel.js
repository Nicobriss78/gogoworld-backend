const mongoose = require("mongoose");

const { Schema } = mongoose;

const trillSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    organizerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    createdByRole: {
      type: String,
      enum: ["participant", "organizer", "admin"],
      required: true,
    },
    type: {
      type: String,
      enum: ["base", "boost", "promo", "admin"],
      default: "base",
      index: true,
    },
    status: {
      type: String,
      enum: ["draft", "scheduled", "sent", "blocked", "cancelled", "expired", "failed"],
      default: "draft",
      index: true,
    },
    title: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
    },
    radiusMeters: {
      type: Number,
      required: true,
      min: 100,
      max: 5000,
    },
    targetingMode: {
      type: String,
      enum: ["nearby", "interested_not_checked_in", "both"],
      default: "nearby",
      index: true,
    },
    scheduledAt: { type: Date, default: null },
    sentAt: { type: Date, default: null, index: true },
    expiresAt: { type: Date, required: true, index: true },

    recipientCount: { type: Number, default: 0, min: 0 },
    deliveredCount: { type: Number, default: 0, min: 0 },
    openedCount: { type: Number, default: 0, min: 0 },
    clickedCount: { type: Number, default: 0, min: 0 },
    checkInCount: { type: Number, default: 0, min: 0 },

    promoCampaignId: {
      type: Schema.Types.ObjectId,
      ref: "PromoCampaign",
      default: null,
      index: true,
    },

    moderation: {
      isBlocked: { type: Boolean, default: false, index: true },
      blockedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      blockedAt: { type: Date, default: null },
      reason: { type: String, trim: true, maxlength: 240 },
      notes: { type: String, trim: true, maxlength: 1000 },
    },

    meta: {
      backendStage: { type: String, default: "T1_backend_base" },
    },
  },
  { timestamps: true }
);

trillSchema.index({ eventId: 1, createdAt: -1 });
trillSchema.index({ organizerId: 1, createdAt: -1 });
trillSchema.index({ status: 1, expiresAt: 1 });
trillSchema.index({ type: 1, targetingMode: 1 });

module.exports = mongoose.model("Trill", trillSchema);
