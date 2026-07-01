// backend/models/commercialProductModel.js
// Commercial Product - definisce prodotti/pacchetti come caricatori di risorse, non come verità del saldo

const mongoose = require("mongoose");

const { Schema } = mongoose;

const PRODUCT_TYPES = [
  "trill_pack",
  "promo_days_pack",
  "promo_qr",
  "promo_boost",
  "credits_pack",
  "external_ad_pack",
];

const OWNER_TYPES = ["organizer", "external_sponsor", "admin"];

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

    metadata: {
      type: Object,
      default: null,
    },
  },
  { _id: false }
);

const commercialProductSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 1000,
    },

    productType: {
      type: String,
      enum: PRODUCT_TYPES,
      required: true,
      index: true,
    },

    ownerType: {
      type: String,
      enum: OWNER_TYPES,
      default: "organizer",
      index: true,
    },

    channel: {
      type: String,
      enum: CHANNELS,
      required: true,
      index: true,
    },

    resources: {
      type: [resourceGrantSchema],
      default: [],
      validate: {
        validator(resources) {
          return Array.isArray(resources) && resources.length > 0;
        },
        message: "CommercialProduct must grant at least one resource.",
      },
    },

    price: {
      amount: {
        type: Number,
        required: true,
        min: 0,
      },
      currency: {
        type: String,
        default: "EUR",
        trim: true,
        uppercase: true,
      },
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    sortOrder: {
      type: Number,
      default: 0,
      index: true,
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

commercialProductSchema.index({ productType: 1, channel: 1, isActive: 1 });
commercialProductSchema.index({ ownerType: 1, channel: 1, isActive: 1 });

commercialProductSchema.statics.PRODUCT_TYPES = PRODUCT_TYPES;
commercialProductSchema.statics.OWNER_TYPES = OWNER_TYPES;
commercialProductSchema.statics.CHANNELS = CHANNELS;
commercialProductSchema.statics.RESOURCE_TYPES = RESOURCE_TYPES;
commercialProductSchema.statics.RESOURCE_SCOPES = RESOURCE_SCOPES;
commercialProductSchema.statics.GEO_SCOPE_TYPES = GEO_SCOPE_TYPES;

module.exports = mongoose.model("CommercialProduct", commercialProductSchema);
