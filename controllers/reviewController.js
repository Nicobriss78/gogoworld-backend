// backend/controllers/reviewController.js

const mongoose = require("mongoose");
const Review = require("../models/reviewModel");
const Event = require("../models/eventModel");
const User = require("../models/userModel");
const { awardForApprovedReview } = require("../services/awards");
const { logger } = require("../core/logger"); // #CORE-LOGGER C1
const { notify } = require("../services/notifications"); // #NOTIFY-ADAPTER

/**
 * Helpers
 */
const nowUtc = () => new Date();
const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * GET /api/reviews
 * Query:
 * - event: <eventId> (lista recensioni per evento)
 * - organizer: <organizerId> (lista recensioni per organizzatore)
 * - status: approved|pending|rejected (default: approved per utenti non-admin)
 * - page, limit
 *
 * Protezione:
 * - Pubblico: solo approved
 * - Organizzatore/admin: può leggere le proprie anche pending/rejected passando status
 */
exports.listReviews = async (req, res) => {
  try {
    const { event, organizer, status, page = 1, limit = 20 } = req.query;

    if (!event && !organizer) {
      return res.status(400).json({ ok: false, error: "Missing query: event or organizer" });
    }
    const query = {};
    if (event) {
      if (!isObjectId(event)) return res.status(400).json({ ok: false, error: "Invalid event id" });
      query.event = event;
    }
    if (organizer) {
      if (!isObjectId(organizer)) return res.status(400).json({ ok: false, error: "Invalid organizer id" });
      query.organizer = organizer;
    }

    // visibilità: i non-admin vedono solo approved
    const isAdmin = req.user && (req.user.role === "admin");
    if (status) {
      if (!["approved", "pending", "rejected"].includes(status)) {
        return res.status(400).json({ ok: false, error: "Invalid status filter" });
      }
      // solo admin può chiedere stati non approved
      if (!isAdmin && status !== "approved") {
        return res.status(403).json({ ok: false, error: "Forbidden status for non-admin" });
      }
      query.status = status;
    } else if (!isAdmin) {
      query.status = "approved";
    }

    const skip = (Number(page) - 1) * Number(limit);
    const items = await Review.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const total = await Review.countDocuments(query);
    return res.json({ ok: true, total, page: Number(page), limit: Number(limit), reviews: items });
  } catch (err) {
    logger.error("[reviews:list] error", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

/**
 * POST /api/reviews
 * Body: { event, rating (1..5), comment? }
 *
 * Requisiti:
 * - Utente autenticato (participant)
 * - L'evento dev'essere concluso (dateEnd || dateStart < now)
 * - L'utente dev'essere tra i participants dell'evento
 * - Una sola recensione per (event, participant)
 * - status = pending (moderabile da admin)
 */
exports.createReview = async (req, res) => {
  try {
    const userId = req.user && req.user._id;
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const { event, rating, comment = "" } = req.body || {};
    if (!isObjectId(event)) return res.status(400).json({ ok: false, error: "Invalid event id" });

    const ratingNum = Number(rating);
    if (!Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ ok: false, error: "Rating must be 1..5" });
    }

    const ev = await Event.findById(event).lean();
    if (!ev) return res.status(404).json({ ok: false, error: "Event not found" });

// evento concluso? (coerente con join/close)
const now = nowUtc();
const hasEnded = (() => {
  if (ev.dateEnd) return new Date(ev.dateEnd) < now;
  if (ev.dateStart) {
    const endOfStart = new Date(ev.dateStart);
    endOfStart.setHours(23, 59, 59, 999);
    return now > endOfStart;
  }
  return false;
})();
if (!hasEnded) {
  return res.status(400).json({ ok: false, error: "You can review only after the event is finished" });
}

    // utente è tra i participants?
    // Nota: ev.participants può contenere ObjectId; confronto come stringhe
    const isParticipant = Array.isArray(ev.participants)
      ? ev.participants.map(String).includes(String(userId))
      : false;
    if (!isParticipant) {
      return res.status(403).json({ ok: false, error: "Only participants can review this event" });
    }

    // una sola review per event+participant
    const dup = await Review.findOne({ event, participant: userId }).lean();
    if (dup) {
      return res.status(409).json({ ok: false, error: "You have already reviewed this event" });
    }
// Snapshot status/score/nome autore
  let snapStatus = null;
  let snapScore = 0;
  let snapName = null;

  // 1) Prova a prendere da req.user ciò che c'è
  if (req.user) {
    if (req.user.status) snapStatus = req.user.status;
    if (typeof req.user.score === "number") snapScore = req.user.score;
    // prova a estrarre un nome utile
    snapName =
      (req.user.displayName && String(req.user.displayName).trim()) ||
      (req.user.name && String(req.user.name).trim()) ||
      (req.user.username && String(req.user.username).trim()) ||
      (req.user.email && String(req.user.email).split("@")[0]) ||
      null;
  }

  // 2) Se manca qualcosa (spec. il nome), completa dal DB
  if (snapName === null || snapStatus === null || typeof snapScore !== "number") {
    const u = await User.findById(userId)
      .select("status score displayName name username email")
      .lean();

    if (u) {
      if (snapStatus === null) snapStatus = u.status || null;
      if (!(typeof snapScore === "number")) snapScore = (typeof u.score === "number" ? u.score : 0);

      if (snapName === null) {
        snapName =
          (u.displayName && String(u.displayName).trim()) ||
          (u.name && String(u.name).trim()) ||
          (u.username && String(u.username).trim()) ||
          (u.email && String(u.email).split("@")[0]) ||
          null;
      }
    }
  }


        const doc = await Review.create({
        event,
        organizer: ev.organizer, // denormalizzato
        participant: userId,
        authorStatus: snapStatus,
        authorScore: Number(snapScore) || 0,
        authorName: snapName,
        rating: ratingNum,
        comment: String(comment || "").trim(),
        status: "pending",
  });
await notify("review_created_pending", {
  reviewId: doc?._id?.toString?.() || String(doc?._id || ""),
  eventId: doc?.event?.toString?.() || String(doc?.event || ""),
  participantId: req.user?._id?.toString?.() || String(req.user?._id || ""),
});

    return res.status(201).json({ ok: true, review: { _id: doc._id, status: doc.status } });
  } catch (err) {
    // Violazione indice unico (event+participant) → 11000
    if (err && err.code === 11000) {
      return res.status(409).json({ ok: false, error: "You have already reviewed this event" });
    }
    
logger.error("[reviews:create] error", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

/**
 * PATCH /api/reviews/:id
 * Body: { rating?, comment? }
 *
 * Requisiti:
 * - Autore loggato
 * - Modificabile entro 24h dalla creazione
 * - Se già moderata (approved/rejected), non modificabile
 */
exports.updateMyReview = async (req, res) => {
  try {
    const userId = req.user && req.user._id;
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ ok: false, error: "Invalid review id" });

    const doc = await Review.findById(id);
    if (!doc) return res.status(404).json({ ok: false, error: "Review not found" });

    if (String(doc.participant) !== String(userId)) {
      return res.status(403).json({ ok: false, error: "Not your review" });
    }

    if (doc.status !== "pending") {
      return res.status(400).json({ ok: false, error: "Reviewed already moderated" });
    }

    const ageMs = nowUtc() - doc.createdAt;
    const windowMs = 24 * 60 * 60 * 1000; // 24h
    if (ageMs > windowMs) {
      return res.status(400).json({ ok: false, error: "Edit window expired (24h)" });
    }

    const { rating, comment } = req.body || {};
    if (rating !== undefined) {
      const rNum = Number(rating);
      if (!Number.isFinite(rNum) || rNum < 1 || rNum > 5) {
        return res.status(400).json({ ok: false, error: "Rating must be 1..5" });
      }
      doc.rating = rNum;
    }
    if (comment !== undefined) {
      doc.comment = String(comment || "").trim();
    }

    await doc.save();
    return res.json({ ok: true, review: { _id: doc._id, rating: doc.rating, comment: doc.comment } });
  } catch (err) {
    
logger.error("[reviews:update] error", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

/**
 * PATCH /api/reviews/:id/approve
 * PATCH /api/reviews/:id/reject
 *
 * Requisiti:
 * - Admin
 */
exports.adminApprove = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ ok: false, error: "Invalid review id" });

    const doc = await Review.findByIdAndUpdate(
      id,
      { $set: { status: "approved" } },
      { new: true }
    );

    if (!doc) return res.status(404).json({ ok: false, error: "Review not found" });
    // PATCH awards: assegna punti al partecipante della recensione approvata
try {
  await awardForApprovedReview(doc.participant);
} catch (e) {
  logger.warn("[awards] adminApprove failed award:", e?.message || e);
}
    await notify("review_approved", {
  reviewId: doc?._id?.toString?.() || String(doc?._id || ""),
  eventId: doc?.event?.toString?.() || String(doc?.event || ""),
  participantId: doc?.participant?.toString?.() || String(doc?.participant || ""),
});

    return res.json({ ok: true, review: { _id: doc._id, status: doc.status } });
  } catch (err) {
logger.error("[reviews:approve] error", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

exports.adminReject = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ ok: false, error: "Invalid review id" });

    const doc = await Review.findByIdAndUpdate(
      id,
      { $set: { status: "rejected" } },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ ok: false, error: "Review not found" });
    await notify("review_rejected", {
  reviewId: doc?._id?.toString?.() || String(doc?._id || ""),
  eventId: doc?.event?.toString?.() || String(doc?.event || ""),
participantId: doc?.participant?.toString?.() || String(doc?.participant || ""),
});

    return res.json({ ok: true, review: { _id: doc._id, status: doc.status } });
  } catch (err) {
logger.error("[reviews:reject] error", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};
/**
 * GET /api/reviews/pending
 * Solo admin: lista tutte le recensioni pending (paginata)
 * Query opzionali: page, limit
 */
exports.adminListPending = async (req, res) => {
  try {
    const isAdmin = req.user && req.user.role === "admin";
    if (!isAdmin) return res.status(403).json({ ok: false, error: "Forbidden" });

    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const query = { status: "pending" };
    const items = await Review.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const total = await Review.countDocuments(query);
    return res.json({ ok: true, total, page: Number(page), limit: Number(limit), reviews: items });
  } catch (err) {
    
logger.error("[reviews:adminListPending] error", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};
