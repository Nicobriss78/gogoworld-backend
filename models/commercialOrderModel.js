// backend/models/commercialOrderModel.js
// Commercial Order - ordine mock/manuale/futuro payment adapter per caricare risorse commerciali

const mongoose = require("mongoose");

const { Schema } = mongoose;

const OWNER_TYPES = ["organizer", "external_sponsor", "admin"];

const CUSTOMER_TYPES = ["organizer", "external_sponsor", "admin"];

const ORDER_STATUSES = [
  "draft",
  "pending_payment",
  "paid",
  "completed",
  "cancelled",
  "refunded",
  "failed",
];

const PAYMENT_PROVIDERS = ["mock", "manual_admin", "stripe", "paypal", "none"];

const PAYMENT_STATUSES = [
  "not_required",
  "pending",
  "paid",
  "failed",
  "refunded",
  "cancelled",
];

const CHANNELS = [
  "organizer_trill",
  "organizer_promo",
  "participant_external_ad",
  "organizer_external_ad",
  "admin_house",
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

const resourceGrantSchema = new Schema(
  {
    resourceType: {
      type: String,
      enum: RESOURCE_TYPES,
      required: true,
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
    },

    scope: {
      type: String,
      enum: RESOURCE_SCOPES,
      default: "organizer",
    },

    geoScopeType: {
      type: String,
      enum: GEO_SCOPE_TYPES,
      default: "none",
    },

    validityDays: {
      type: Number,
      default: null,
      min: 1,
    },

    expiresAt: {
      type: Date,
      default: null,
    },

    metadata: {
      type: Object,
      default: null,
    },
  },
  { _id: false }
);

const commercialOrderSchema = new Schema(
  {
    ownerType: {
      type: String,
      enum: OWNER_TYPES,
      required: true,
      default: "organizer",
      index: true,
    },

    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    customerType: {
      type: String,
      enum: CUSTOMER_TYPES,
      required: true,
      default: "organizer",
      index: true,
    },

    channel: {
      type: String,
      enum: CHANNELS,
      required: true,
      index: true,
    },

    productCode: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
    },

    productSnapshot: {
      type: Object,
      default: null,
    },

    status: {
      type: String,
      enum: ORDER_STATUSES,
      default: "draft",
      index: true,
    },

    paymentProvider: {
      type: String,
      enum: PAYMENT_PROVIDERS,
      default: "mock",
      index: true,
    },

    paymentStatus: {
      type: String,
      enum: PAYMENT_STATUSES,
      default: "pending",
      index: true,
    },

    paymentIntentId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },

    amount: {
      type: Number,
      default: 0,
      min: 0,
    },

    currency: {
      type: String,
      default: "EUR",
      trim: true,
      uppercase: true,
    },

    resourcesToGrant: {
      type: [resourceGrantSchema],
      default: [],
    },

    related: {
      eventId: {
        type: Schema.Types.ObjectId,
        ref: "Event",
        default: null,
        index: true,
      },
      bannerId: {
        type: Schema.Types.ObjectId,
        ref: "Banner",
        default: null,
        index: true,
      },
      trillId: {
        type: Schema.Types.ObjectId,
        ref: "Trill",
        default: null,
        index: true,
      },
    },

    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    createdByAdminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    refundedAt: {
      type: Date,
      default: null,
    },

    failureReason: {
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

commercialOrderSchema.index({ ownerType: 1, ownerId: 1, createdAt: -1 });
commercialOrderSchema.index({ customerType: 1, status: 1, createdAt: -1 });
commercialOrderSchema.index({ channel: 1, status: 1, createdAt: -1 });
commercialOrderSchema.index({ "related.bannerId": 1, status: 1 });
commercialOrderSchema.index({ "related.eventId": 1, status: 1 });

commercialOrderSchema.statics.OWNER_TYPES = OWNER_TYPES;
commercialOrderSchema.statics.CUSTOMER_TYPES = CUSTOMER_TYPES;
commercialOrderSchema.statics.ORDER_STATUSES = ORDER_STATUSES;
commercialOrderSchema.statics.PAYMENT_PROVIDERS = PAYMENT_PROVIDERS;
commercialOrderSchema.statics.PAYMENT_STATUSES = PAYMENT_STATUSES;
commercialOrderSchema.statics.CHANNELS = CHANNELS;
commercialOrderSchema.statics.RESOURCE_TYPES = RESOURCE_TYPES;
commercialOrderSchema.statics.RESOURCE_SCOPES = RESOURCE_SCOPES;
commercialOrderSchema.statics.GEO_SCOPE_TYPES = GEO_SCOPE_TYPES;

module.exports = mongoose.model("CommercialOrder", commercialOrderSchema);
