// models/userProfileModel.js — profilo esteso
const mongoose = require("mongoose");
const { Schema } = mongoose;

const socialSchema = new Schema(
  {
    instagram: { type: String, default: "" },
    facebook: { type: String, default: "" },
    website: { type: String, default: "" },
  },
  { _id: false }
);

const userProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", unique: true, required: true },

    // Contatti & geo
    phone: { type: String, default: "" },
    address: { type: String, default: "" },
    city: { type: String, default: "" },
    province: { type: String, default: "" },
    region: { type: String, default: "" },
    country: { type: String, default: "" },

    // Preferenze
    favoriteCategories: { type: [String], default: [] },
    availability: { type: [String], default: [] },
    travelWillingness: { type: String, default: "" },

    // Social
    social: { type: socialSchema, default: undefined },

    // Profilo
    languages: { type: [String], default: [] },
    bio: { type: String, default: "" },
    gender: { type: String, default: "" },
    birthDate: { type: Date, default: undefined },
    newsletterOptIn: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("UserProfile", userProfileSchema);

