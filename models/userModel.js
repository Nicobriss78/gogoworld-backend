// models/userModel.js — GoGoWorld.life
// NOTE: Modifica CHIRURGICA
// - Aggiunti: bcrypt, hook pre('save') per hash password (solo se modificata),
// e metodo d’istanza matchPassword(entered) per il confronto in login.
// - Nessun altro comportamento alterato.

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["participant", "organizer", "admin"], default: "participant" },
// Admin moderation flags
    isBanned: { type: Boolean, default: false },
    // PATCH: libertà iniziale per tutti di organizzare eventi
    canOrganize: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Hash password solo se modificata/nuova
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (err) {
    return next(err);
  }
});

// Confronto password per login
userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model("User", userSchema);
module.exports = User;

