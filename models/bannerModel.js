// backend/models/bannerModel.js
// Modello Banner (B1/1) + BannerStatsDaily per conteggi giornalieri light

const mongoose = require("mongoose");

/**
 * Tipologie supportate in B1:
 * - sponsor: vetrina pubblicitaria clienti generici
 * - event_promo: grandi eventi a pagamento messi in primo piano
 * - house: annunci interni della piattaforma (fallback)
 *
 * Placement iniziali:
 * - home_top
 * - events_list_inline
 */

const bannerSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["sponsor", "event_promo", "house"],
      required: true,
      index: true,
    },
    title: { type: String, trim: true, required: true },

    // Asset e destinazione
    imageUrl: { type: String, trim: true, required: true },
    targetUrl: { type: String, trim: true, required: true },

    // Posizionamento UI
    placement: {
      type: String,
      enum: ["home_top", "events_list_inline"],
      required: true,
      index: true,
    },

    // Target geografico (opzionale). In B1 useremo country/region per filtrare.
    country: { type: String, trim: true }, // ISO 3166-1 alpha-2 (es. "IT")
    region: { type: String, trim: true }, // es. "Basilicata"

    // Finestra di attività e stato
    isActive: { type: Boolean, default: true, index: true },
    activeFrom: { type: Date, default: null, index: true },
    activeTo: { type: Date, default: null, index: true },

    // Ordinamento e rotazione
    priority: { type: Number, default: 100, index: true }, // più basso = più alto in lista

    // Contatori cumulativi (diagnostica rapida)
    impressionsTotal: { type: Number, default: 0 },
    clicksTotal: { type: Number, default: 0 },

    // Audit minimale
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

// Indici compositi utili alle query attive per placement/area/finestra
bannerSchema.index({ placement: 1, isActive: 1, priority: 1 });
bannerSchema.index({ country: 1, region: 1, isActive: 1 });
bannerSchema.index({ activeFrom: 1, activeTo: 1 });

// Facile controllo finestre: consideriamo "attivo nel tempo" se
// (activeFrom null o <= now) && (activeTo null o > now).
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
    day: { type: Date, required: true, index: true }, // normalizzato a 00:00:00 UTC
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
};
