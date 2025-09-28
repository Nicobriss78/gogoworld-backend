// backend/models/bannerModel.js
// Modello Banner (B1/1 + estensioni UI Admin/Organizer) + BannerStatsDaily

const mongoose = require("mongoose");

/**
 * Tipologie:
 * - sponsor: vetrina pubblicitaria clienti generici (terze parti)
 * - event_promo: promozione di un evento della piattaforma (organizer)
 * - house: annunci interni della piattaforma (GoGoWorld)
 *
 * Placement iniziali:
 * - home_top
 * - events_list_inline
 *
 * Origine:
 * - admin_third_party (inserito da admin per clienti terzi)
 * - admin_house (annunci interni)
 * - organizer (richieste dagli organizzatori)
 *
 * Stati:
 * - DRAFT, PENDING_PAYMENT, PENDING_REVIEW, SCHEDULED,
 * ACTIVE, PAUSED, ENDED, REJECTED
 */

const ALLOWED_TYPES = ["sponsor", "event_promo", "house"];
const ALLOWED_PLACEMENTS = ["home_top", "events_list_inline"];
const ALLOWED_SOURCES = ["admin_third_party", "admin_house", "organizer"];
const ALLOWED_STATUSES = [
  "DRAFT",
  "PENDING_PAYMENT",
  "PENDING_REVIEW",
  "SCHEDULED",
  "ACTIVE",
  "PAUSED",
  "ENDED",
  "REJECTED",
];

const bannerSchema = new mongoose.Schema(
  {
    // Classificazione
    type: {
      type: String,
      enum: ALLOWED_TYPES,
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ALLOWED_SOURCES,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ALLOWED_STATUSES,
      default: "DRAFT",
      index: true,
    },

    // Collegamento evento (solo per type=event_promo)
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", index: true },

    // Creatività
    title: { type: String, trim: true, required: true },
    imageUrl: { type: String, trim: true, required: true },
    targetUrl: { type: String, trim: true, required: true },

    // Posizionamento UI
    placement: {
      type: String,
      enum: ALLOWED_PLACEMENTS,
      required: true,
      index: true,
    },

    // Target geografico (opzionale)
    country: { type: String, trim: true }, // ISO 3166-1 alpha-2 (es. "IT")
    region: { type: String, trim: true }, // es. "Basilicata"

    // Finestra di attività e stato legacy (compat)
    isActive: { type: Boolean, default: true, index: true },
    activeFrom: { type: Date, default: null, index: true },
    activeTo: { type: Date, default: null, index: true },

    // Ordinamento e rotazione
    priority: { type: Number, default: 100, index: true }, // più basso = più alto

    // Contatori cumulativi (diagnostica rapida)
    impressionsTotal: { type: Number, default: 0 },
    clicksTotal: { type: Number, default: 0 },

    // Audit
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

// Indici utili
bannerSchema.index({ placement: 1, isActive: 1, priority: 1 });
bannerSchema.index({ country: 1, region: 1, isActive: 1 });
bannerSchema.index({ activeFrom: 1, activeTo: 1 });
bannerSchema.index({ type: 1, source: 1, status: 1, placement: 1 });

// Attivo “nel tempo” se (from null|<=now) && (to null|>now)
bannerSchema.statics.timeActiveFilter = function (now = new Date()) {
  return {
    $and: [
      { $or: [{ activeFrom: null }, { activeFrom: { $lte: now } }] },
      { $or: [{ activeTo: null }, { activeTo: { $gt: now } }] },
    ],
  };
};

// ------------------------------------------------------------------
// Stats giornaliere light (B1/1)
// ------------------------------------------------------------------
const bannerStatsDailySchema = new mongoose.Schema(
  {
    banner: { type: mongoose.Schema.Types.ObjectId, ref: "Banner", index: true, required: true },
    day: { type: Date, required: true, index: true }, // 00:00:00 UTC
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
  },
  { timestamps: true }
);
bannerStatsDailySchema.index({ banner: 1, day: 1 }, { unique: true });

// Helper per normalizzare la data a mezzanotte UTC
function normalizeDay(d = new Date()) {
  const dt = new Date(d);
  dt.setUTCHours(0, 0, 0, 0);
  return dt;
}
bannerStatsDailySchema.statics.keyFor = function (bannerId, date = new Date()) {
  return { banner: bannerId, day: normalizeDay(date) };
};

const Banner = mongoose.model("Banner", bannerSchema);
const BannerStatsDaily = mongoose.model("BannerStatsDaily", bannerStatsDailySchema);

module.exports = {
  Banner,
  BannerStatsDaily,
  ALLOWED_TYPES,
  ALLOWED_PLACEMENTS,
  ALLOWED_SOURCES,
  ALLOWED_STATUSES,
};
