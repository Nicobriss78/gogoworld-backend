// backend/models/eventModel.js

const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },

    // Tassonomia
    category: { type: String, trim: true, required: true },
    subcategory: { type: String, trim: true },
    type: { type: String, trim: true },

    // Localizzazione separata
    venueName: { type: String, trim: true },
    address: { type: String, trim: true },
    street: { type: String, trim: true },
    streetNumber: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    city: { type: String, trim: true },
    province: { type: String, trim: true },
    region: { type: String, trim: true, required: true },
    country: { type: String, trim: true, required: true }, // ISO 3166-1 alpha-2
    lat: { type: Number },
    lon: { type: Number },
location: {
type: { type: String, enum: ['Point'] },
coordinates: { type: [Number] } // [lon, lat]
},

    // Date e orari
    dateStart: { type: Date, required: true },
    dateEnd: { type: Date },

    // Visibilità / lingua / target
    visibility: {
      type: String,
      enum: ["public", "draft", "private"],
      default: "public",
      index: true,
    },
    language: {
      type: String, // ISO 639-1 (es. "it")
      default: "it",
      trim: true,
    },
    target: {
      type: String, // "tutti" | "famiglie" | "18+" | "professionisti"
      default: "tutti",
      trim: true,
    },
    // Moderazione / stato approvazione
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected", "blocked"],
      default: "pending",
      index: true,
    },
    moderation: {
      reason: { type: String, trim: true },
      notes: { type: String, trim: true },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      updatedAt: { type: Date },
    },
    flagsCount: { type: Number, default: 0, min: 0 },
    flaggedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    
    // Prezzo e valuta
    isFree: { type: Boolean, default: false },
    price: { type: Number, min: 0 },
    currency: { type: String, trim: true, default: "EUR" }, // ISO 4217

    // Media e tag
    tags: { type: [String], default: [] },
    images: { type: [String], default: [] },
    coverImage: { type: String, trim: true },
    timezone: { type: String, trim: true, default: "Europe/Rome" },
    // Relazioni
    organizer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

// Indici utili
eventSchema.index({ dateStart: 1 });
eventSchema.index({ organizer: 1, dateStart: -1 });
eventSchema.index({ region: 1, category: 1 });
eventSchema.index({ language: 1 });
eventSchema.index({ target: 1 });
eventSchema.index({ approvalStatus: 1 });
eventSchema.index({ location: '2dsphere' });

// PATCH IDX: indici aggiuntivi per query più frequenti
eventSchema.index({ approvalStatus: 1, visibility: 1, dateStart: 1 });
eventSchema.index({ "participants._id": 1 });
// (facoltativo, se usi ricerche testuali su titolo/città/categoria)
// eventSchema.index({ title: "text", city: "text", category: "text" });

module.exports = mongoose.model("Event", eventSchema);






