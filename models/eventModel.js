// models/eventModel.js — evento (versione allineata con indici)
//
// Correzioni:
// - indici su organizer e date per prestazioni di /mine/list e ordinamenti

const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    organizer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // Localizzazione
    city: { type: String, trim: true },
    region: { type: String, trim: true },
    country: { type: String, trim: true },

    // Tipologie/filtri
    category: { type: String, trim: true },
    subcategory: { type: String, trim: true },
    type: { type: String, trim: true }, // pubblico/privato/ibrido
    visibility: { type: String, default: "public" }, // public/private

    // Date e orari
    date: { type: Date, required: true },
    endDate: { type: Date },

    // Costi
    isFree: { type: Boolean, default: true },
    price: { type: Number, default: 0 },

    // Immagini
    coverImage: { type: String, trim: true }, // locandina
    images: [{ type: String, trim: true }], // galleria

    // Partecipanti
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

// Indici utili
eventSchema.index({ organizer: 1 });
eventSchema.index({ date: 1 });

module.exports = mongoose.model("Event", eventSchema);
