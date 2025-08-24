// models/userProfileModel.js — profilo utente esteso
//
// Non usato direttamente nelle dinamiche di base, ma previsto per dati aggiuntivi.
// Collega 1:1 a User tramite userId.

const mongoose = require("mongoose");

const userProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    bio: { type: String, trim: true },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    country: { type: String, trim: true },
    avatar: { type: String, trim: true }, // URL immagine
  },
  { timestamps: true }
);

module.exports = mongoose.model("UserProfile", userProfileSchema);
