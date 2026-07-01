// backend/models/organizerWalletModel.js
// Organizer Promotional Wallet (OPW) - saldo operativo organizer
// Il ledger resta la verità storica. Questo model serve per letture veloci e controlli operativi.

const mongoose = require("mongoose");

const { Schema } = mongoose;

const RESOURCE_TYPES = [
  "free.trill.base",
  "paid.trill.live",
  "paid.trill.urgent",
  "paid.trill.final_call",

  "promo.region.days",
  "promo.country.days",
  "promo.global.days",
  "promo.qr",
  "promo.boost",

  "generic.credits",
];

const RESOURCE_SCOPES = ["event", "organizer"];

const GEO_SCOPE_TYPES = [
  "none",
  "single_region",
  "multi_region",
  "single_country",
  "multi_country",
  "global",
];

const BALANCE_STATUSES = ["available", "reserved", "consumed", "released", "expired", "frozen"];

const balanceSchema = new Schema(
  {
    resourceType: {
      type: String,
      enum: RESOURCE_TYPES,
      required: true,
      index: true,
    },

    scope: {
      type: String,
      enum: RESOURCE_SCOPES,
      required: true,
      default: "organizer",
      index: true,
    },

    geoScopeType: {
      type: String,
      enum: GEO_SCOPE_TYPES,
      default: "none",
      index: true,
    },

    status: {
      type: String,
      enum: BALANCE_STATUSES,
      default: "available",
      index: true,
    },

    quantityAvailable: {
      type: Number,
      default: 0,
      min: 0,
    },

    quantityReserved: {
      type: Number,
      default: 0,
      min: 0,
    },

    quantityConsumed: {
      type: Number,
      default: 0,
      min: 0,
    },

    quantityExpired: {
      type: Number,
      default: 0,
      min: 0,
    },

    isFree: {
      type: Boolean,
      default: false,
      index: true,
    },

    grantedByEventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      default: null,
      index: true,
    },

    usableByEventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      default: null,
      index: true,
    },

    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    metadata: {
      type: Object,
      default: null,
    },
  },
  { _id: true }
);

const organizerWalletSchema = new Schema(
  {
    organizerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    balances: {
      type: [balanceSchema],
      default: [],
    },

    version: {
      type: Number,
      default: 1,
      min: 1,
    },

    meta: {
      backendStage: {
        type: String,
        default: "commercial_foundation_v1_models",
      },
    },
  },
  { timestamps: true }
);

organizerWalletSchema.index({ organizerId: 1, "balances.resourceType": 1 });
organizerWalletSchema.index({ organizerId: 1, "balances.usableByEventId": 1 });
organizerWalletSchema.index({ organizerId: 1, "balances.expiresAt": 1 });

organizerWalletSchema.statics.RESOURCE_TYPES = RESOURCE_TYPES;
organizerWalletSchema.statics.RESOURCE_SCOPES = RESOURCE_SCOPES;
organizerWalletSchema.statics.GEO_SCOPE_TYPES = GEO_SCOPE_TYPES;
organizerWalletSchema.statics.BALANCE_STATUSES = BALANCE_STATUSES;

module.exports = mongoose.model("OrganizerWallet", organizerWalletSchema);
