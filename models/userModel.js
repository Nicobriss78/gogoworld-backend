// models/userModel.js — GoGoWorld.life
// NOTE: Modifica CHIRURGICA + estensione status/score/stats
// - Conservati: hash password, matchPassword, campi esistenti.
// - Aggiunti: score, status, stats{attended,reviewsApproved,lastScoreUpdateAt}.

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

    // ★ NEW: Gamification / Reputation
    score: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["novizio", "esploratore", "veterano", "ambassador"],
      default: "novizio",
      index: true
    },
    stats: {
      attended: { type: Number, default: 0 },
      reviewsApproved: { type: Number, default: 0 },
      lastScoreUpdateAt: { type: Date }
    }
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

