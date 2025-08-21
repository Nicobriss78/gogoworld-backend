// models/eventModel.js — schema completo, coerente con services, con ownerId e participants[]
const mongoose = require("mongoose");
const { Schema } = mongoose;

const EventSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },

    status: { type: String, enum: ["draft", "published", "cancelled"], default: "draft" },
    visibility: { type: String, enum: ["public", "private"], default: "public" },

    type: { type: String, default: "" },
    category: { type: String, default: "" },
    subcategory: { type: String, default: "" },
    tags: { type: [String], default: [] },

    dateStart: { type: Date, default: undefined },
    dateEnd: { type: Date, default: undefined },
    timezone: { type: String, default: "Europe/Rome" },

    venueName: { type: String, default: "" },
    address: { type: String, default: "" },
    city: { type: String, default: "" },
    province: { type: String, default: "" },
    region: { type: String, default: "" },
    country: { type: String, default: "" },

    capacity: { type: Number, default: 0 },
    isFree: { type: Boolean, default: true },
    priceMin: { type: Number, default: 0 },
    priceMax: { type: Number, default: 0 },
    currency: { type: String, default: "EUR" },

    images: { type: [String], default: [] },
    externalUrl: { type: String, default: "" },
    contactEmail: { type: String, default: "" },
    contactPhone: { type: String, default: "" },

    // Proprietà di ownership e partecipazione
    ownerId: { type: Schema.Types.ObjectId, ref: "User", index: true },
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


