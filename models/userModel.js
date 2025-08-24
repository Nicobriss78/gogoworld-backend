// models/userModel.js — utente base (autenticazione)
//
// Campi principali:
// - name, email, password (hashed)
// - role (statistico, non vincolante)
// - timestamps

const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, default: "participant" }, // solo statistico
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
