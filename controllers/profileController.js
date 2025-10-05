// controllers/profileController.js — C1 Profilo (users.profile subdoc)
const mongoose = require("mongoose");
const User = require("../models/userModel");

// Utils -------------------------------------------------------------
/**
 * Restituisce SOLO i campi permessi per l'update del profilo utente.
 * Scarta tutto il resto.
 */
function pickProfileUpdate(body = {}) {
  const out = {};
  const allowRoot = ["nickname", "birthYear", "region", "city", "avatarUrl", "bio"];
  const allowArrays = ["socials", "interests", "languages"];
  const allowPrivacy = { optInDM: "boolean", dmsFrom: ["everyone", "followers", "nobody"] };

  // campi semplici
  for (const k of allowRoot) {
    if (Object.prototype.hasOwnProperty.call(body, k)) {
      out[k] = body[k];
    }
  }

  // array stringa
  for (const k of allowArrays) {
    if (Array.isArray(body[k])) {
      out[k] = body[k].filter((v) => typeof v === "string").slice(0, 50);
    }
  }

  // privacy
  if (body && typeof body.privacy === "object") {
    out.privacy = {};
    if (typeof body.privacy.optInDM === "boolean") out.privacy.optInDM = body.privacy.optInDM;
    if (typeof body.privacy.dmsFrom === "string" && allowPrivacy.dmsFrom.includes(body.privacy.dmsFrom)) {
      out.privacy.dmsFrom = body.privacy.dmsFrom;
    }
  }

  return out;
}

/**
 * Versione "pubblica" del profilo: mai dati sensibili o email.
 */
function toPublicProfile(userDoc) {
  const u = userDoc;
  const p = (u && u.profile) || {};
  return {
    id: String(u._id),
    nickname: p.nickname || null,
    region: p.region || null,
    city: p.city || null,
    avatarUrl: p.avatarUrl || null,
    bio: p.bio || null,
    socials: Array.isArray(p.socials) ? p.socials : [],
    interests: Array.isArray(p.interests) ? p.interests : [],
    languages: Array.isArray(p.languages) ? p.languages : [],
    // stato utente utile in UI (già presente nello schema)
    status: u.status || "novizio",
    // privacy (solo flags necessari al client per UI)
    privacy: {
      optInDM: !!(p.privacy && p.privacy.optInDM),
      dmsFrom: (p.privacy && p.privacy.dmsFrom) || "everyone",
    },
    // NON includere: email, role, isBanned, ecc.
  };
}

// Controllers --------------------------------------------------------

/**
 * GET /api/profile/me
 * Profilo dell'utente autenticato (completo lato client, ma sempre senza email/role ecc).
 */
exports.getMyProfile = async (req, res, next) => {
  try {
    const meId = req.user && req.user.id;
    if (!meId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const me = await User.findById(meId).lean();
    if (!me) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const pub = toPublicProfile(me);
    // opzionale: includi qualche metadato self-only (non sensibile)
    return res.json({ ok: true, data: pub });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/profile/me
 * Aggiorna il subdocumento users.profile dell'utente autenticato.
 */
exports.updateMyProfile = async (req, res, next) => {
  try {
    const meId = req.user && req.user.id;
    if (!meId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const patch = pickProfileUpdate(req.body && req.body.profile ? req.body.profile : req.body || {});
    // Minimal validation lato server
    if (patch.birthYear && (patch.birthYear < 1900 || patch.birthYear > 2100)) {
      return res.status(400).json({ ok: false, error: "INVALID_BIRTH_YEAR" });
    }

    const updated = await User.findByIdAndUpdate(
      meId,
      { $set: Object.fromEntries(Object.entries(patch).map(([k, v]) => [`profile.${k}`, v])) },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    return res.json({ ok: true, data: toPublicProfile(updated) });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/profile/:userId
 * Profilo pubblico di un utente (rispetta la natura “pubblica”: niente email/role).
 * Per ora non applichiamo filtri sui DM: quelli saranno enforce lato DM (C2/C4).
 */
exports.getPublicProfile = async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ ok: false, error: "INVALID_USER_ID" });
    }
    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    return res.json({ ok: true, data: toPublicProfile(user) });
  } catch (err) {
    next(err);
  }
};
