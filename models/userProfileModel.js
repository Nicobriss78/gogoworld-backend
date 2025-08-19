// models/userProfileModel.js
const mongoose = require("mongoose");

const userProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, required: true, unique: true },

    // Dati anagrafici/contatto
    phone: { type: String },
    city: { type: String },
    province: { type: String },
    region: { type: String },
    country: { type: String },

    // Preferenze & interessi
    favoriteCategories: [{ type: String }], // multi-select
    availability: { type: [String], default: [] }, // es: ["weekend","sera"]
    travelWillingness: { type: String }, // es: "città" | "provincia" | "regione" | "nazionale"

    // Social & connessioni
    social: {
      instagram: { type: String },
      facebook: { type: String },
      website: { type: String },
    },

    // Note & altro
    bio: { type: String, maxlength: 500 },
    languages: { type: [String], default: [] }, // es: ["it","en"]
    gender: { type: String }, // libero o con enum in futuro
    birthDate: { type: Date }, // opzionale
    newsletterOptIn: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("UserProfile", userProfileSchema);
