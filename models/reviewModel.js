// backend/models/reviewModel.js

const mongoose = require("mongoose");
const { Schema } = mongoose;

const reviewSchema = new Schema(
  {
    // riferimento all'evento recensito
    event: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },

    // organizzatore "titolare" dell'evento (denormalizzato per query veloci)
    organizer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // utente che lascia la recensione (partecipante)
    participant: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // voto 1..5
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },

    // commento testuale (opzionale)
    comment: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },

    // stato moderazione
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },

    // eventuali flag/utility future
    flagsCount: {
      type: Number,
      default: 0,
    },
    flaggedBy: {
      type: [Schema.Types.ObjectId], // utenti che hanno segnalato
      default: [],
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

// Una sola recensione per (evento + partecipante)
reviewSchema.index({ event: 1, participant: 1 }, { unique: true });

// Query comuni
reviewSchema.index({ event: 1, status: 1, createdAt: -1 });
reviewSchema.index({ organizer: 1, status: 1, createdAt: -1 });

module.exports = mongoose.models.Review || mongoose.model("Review", reviewSchema);
