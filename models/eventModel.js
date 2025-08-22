// models/eventModel.js — schema eventi
const mongoose = require("mongoose");
const { Schema } = mongoose;

const EventSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },

    status: { type: String, enum: ["draft", "published", "cancelled"], default: "draft" },
    visibility: { type: String, enum: ["public", "private", "unlisted"], default: "public" },

    type: { type: String, default: "" },
    category: { type: String, default: "" },
    subcategory: { type: String, default: "" },
    tags: { type: [String], default: [] },

    dateStart: { type: Date, default: null },
    dateEnd: { type: Date, default: null },
    timezone: { type: String, default: "Europe/Rome" },

    venueName: { type: String, default: "" },
    address: { type: String, default: "" },
    city: { type: String, default: "" },
    province: { type: String, default: "" },
    region: { type: String, default: "" },
    country: { type: String, default: "" },

    isFree: { type: Boolean, default: true },
    priceMin: { type: Number, default: 0 },
    priceMax: { type: Number, default: 0 },
    currency: { type: String, default: "EUR" },

    capacity: { type: Number, default: undefined },

    // 🔹 NUOVO
    coverImage: { type: String, default: "" },
    images: { type: [String], default: [] },

    externalUrl: { type: String, default: "" },
    contactEmail: { type: String, default: "" },
    contactPhone: { type: String, default: "" },

    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    participants: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
  },
  { timestamps: true }
);

// Indici utili
EventSchema.index({ status: 1, visibility: 1 });
EventSchema.index({ city: 1, region: 1, country: 1 });
EventSchema.index({ category: 1, subcategory: 1, type: 1 });
EventSchema.index({ dateStart: 1, dateEnd: 1 });

module.exports = mongoose.model("Event", EventSchema);




