// backend/models/organizerWalletLedgerModel.js
// Organizer Promotional Wallet Ledger - verità storica immutabile dei movimenti risorsa

const mongoose = require("mongoose");

const { Schema } = mongoose;

const MOVEMENT_TYPES = [
  "grant",
  "purchase",
  "reserve",
  "consume",
  "release",
  "refund",
  "expire",
  "admin_adjustment",
];

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

const SOURCE_TYPES = [
  "event_approval",
  "trill",
  "banner",
  "commercial_order",
  "admin",
  "system",
];

const organizerWalletLedgerSchema = new Schema(
  {
    organizerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    movementType: {
      type: String,
      enum: MOVEMENT_TYPES,
      required: true,
      index: true,
    },

    resourceType: {
      type: String,
      enum: RESOURCE_TYPES,
      required: true,
      index: true,
    },

    quantity: {
      type: Number,
      required: true,
      min: 0,
    },

    balanceImpact: {
      available: { type: Number, default: 0 },
      reserved: { type: Number, default: 0 },
      consumed: { type: Number, default: 0 },
      expired: { type: Number, default: 0 },
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

    isFree: {
      type: Boolean,
      default: false,
      index: true,
    },

    source: {
      type: {
        type: String,
        enum: SOURCE_TYPES,
        required: true,
        index: true,
      },
      eventId: {
        type: Schema.Types.ObjectId,
        ref: "Event",
        default: null,
        index: true,
      },
      trillId: {
        type: Schema.Types.ObjectId,
        ref: "Trill",
        default: null,
        index: true,
      },
      bannerId: {
        type: Schema.Types.ObjectId,
        ref: "Banner",
        default: null,
        index: true,
      },
      orderId: {
        type: Schema.Types.ObjectId,
        ref: "CommercialOrder",
        default: null,
        index: true,
      },
      adminId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
        index: true,
      },
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

    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    metadata: {
      type: Object,
      default: null,
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

organizerWalletLedgerSchema.index({ organizerId: 1, createdAt: -1 });
organizerWalletLedgerSchema.index({ organizerId: 1, resourceType: 1, createdAt: -1 });
organizerWalletLedgerSchema.index({ organizerId: 1, movementType: 1, createdAt: -1 });
organizerWalletLedgerSchema.index({ "source.eventId": 1, movementType: 1 });
organizerWalletLedgerSchema.index({ "source.bannerId": 1, movementType: 1 });
organizerWalletLedgerSchema.index({ "source.trillId": 1, movementType: 1 });

organizerWalletLedgerSchema.statics.MOVEMENT_TYPES = MOVEMENT_TYPES;
organizerWalletLedgerSchema.statics.RESOURCE_TYPES = RESOURCE_TYPES;
organizerWalletLedgerSchema.statics.RESOURCE_SCOPES = RESOURCE_SCOPES;
organizerWalletLedgerSchema.statics.GEO_SCOPE_TYPES = GEO_SCOPE_TYPES;
organizerWalletLedgerSchema.statics.SOURCE_TYPES = SOURCE_TYPES;

module.exports = mongoose.model("OrganizerWalletLedger", organizerWalletLedgerSchema);
