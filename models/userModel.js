// models/userModel.js — GoGo.World — 2025-08-24
// Schema allineato ai controller attuali con compatibilità legacy.
// - name: richiesto
// - email: unico, lowercase
// - passwordHash: nuovo standard (bcrypt)
// - password: legacy (plain). Viene svuotato alla migrazione in login.
// - registeredRole: statistico ("participant"|"organizer")
// - role: legacy alias del vecchio registeredRole (manteniamo per compat)
// - joinedEvents: lista di eventi a cui l'utente partecipa (persistenza per il lato Partecipante)

const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    // Nuovo standard
    passwordHash: { type: String, default: "" },

    // Legacy (plain). Viene mantenuto per compat/migrazione.
    password: { type: String, default: "" },

    // Ruolo statistico memorizzato nel profilo
    registeredRole: {
      type: String,
      enum: ["participant", "organizer"],
      default: "participant",
    },

    // Legacy alias del vecchio campo
    role: {
      type: String,
      enum: ["participant", "organizer"],
      default: "participant",
    },

    // Eventi a cui l'utente partecipa (persistenza lato Partecipante)
    joinedEvents: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Event",
      },
    ],
  },
  { timestamps: true }
);

// Indice unico su email
UserSchema.index({ email: 1 }, { unique: true });

// Normalizzazioni leggere
UserSchema.pre("save", function (next) {
  if (this.isModified("email") && typeof this.email === "string") {
    this.email = this.email.toLowerCase().trim();
  }
  if (this.isModified("name") && typeof this.name === "string") {
    this.name = this.name.trim();
  }
  // Allinea registeredRole se mancasse ma esiste role legacy
  if (!this.registeredRole && this.role) {
    this.registeredRole = this.role;
  }
  next();
});

module.exports = mongoose.models.User || mongoose.model("User", UserSchema);

