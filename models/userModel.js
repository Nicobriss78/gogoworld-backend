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
    // Email verification
verified: { type: Boolean, default: false },
verificationTokenHash: { type: String },
verificationTokenExpires: { type: Date },
// Password reset
resetTokenHash: { type: String },
resetTokenExpires: { type: Date },
    // Admin moderation flags
    isBanned: { type: Boolean, default: false },
    // PATCH: libertà iniziale per tutti di organizzare eventi
    canOrganize: { type: Boolean, default: true },
// ★ NEW: Profilo utente (C1)
    profile: {
      nickname: { type: String, trim: true, maxlength: 40 },
      birthYear: { type: Number, min: 1900, max: 2100 }, // opzionale
      region: { type: String, trim: true, maxlength: 60 }, // es. "Calabria"
      city: { type: String, trim: true, maxlength: 120 },// opzionale
      avatarUrl: { type: String, trim: true },
      socials: [{ type: String, trim: true }], // opzionale: link social
      bio: { type: String, trim: true, maxlength: 1000 },
      interests: [{ type: String, trim: true }],
      languages: [{ type: String, trim: true }],

      // Privacy messaggi diretti (C4, enforcement in /api/dm/*)
      privacy: {
        optInDM: { type: Boolean, default: false }, // consenso esplicito ai DM
        dmsFrom: { type: String, enum: ["everyone","followers","nobody"], default: "everyone" }
      }
    },
    
    // Blocchi utente (31.1) — elenco degli utenti che questo utente ha bloccato
    // Usato per:
    // - vietare DM se A ha bloccato B o B ha bloccato A
    // - in futuro, nascondere contenuti di utenti bloccati (recensioni / chat, ecc.)
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // ★ NEW: Gamification / Reputation
    score: { type: Number, default: 0 },
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
// Indici utili per filtri admin e ordering recente
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ status: 1, createdAt: -1 });
userSchema.index({ isBanned: 1, createdAt: -1 });
userSchema.index({ "profile.nickname": 1 });
userSchema.index({ "profile.region": 1 });
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





