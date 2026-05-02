const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");

const Event = require("../models/eventModel");
const Trill = require("../models/trillModel");
const { logger } = require("../core/logger");

const {
  TRILL_REASON,
  createTrillDraft,
  sendTrillNotifications,
} = require("../services/trillService");

function normalizeObjectId(value) {
  const id = String(value || "").trim();
  return mongoose.Types.ObjectId.isValid(id) ? id : null;
}

function getUserId(user) {
  return user?._id || user?.id || null;
}

function getUserRole(user) {
  return String(user?.role || "participant").toLowerCase();
}

function isAdmin(user) {
  return getUserRole(user) === "admin";
}

function canManageEvent(user, event) {
  const userId = getUserId(user);
  const organizerId = event?.organizer?._id || event?.organizer;

  if (!userId || !organizerId) return false;
  return isAdmin(user) || String(userId) === String(organizerId);
}

function normalizeLimit(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return 30;
  return Math.min(Math.max(n, 1), 100);
}

function serializeTrill(trill) {
  if (!trill) return null;

  return {
    id: trill._id,
    eventId: trill.eventId,
    organizerId: trill.organizerId,
    createdBy: trill.createdBy,
    createdByRole: trill.createdByRole,
    type: trill.type,
    status: trill.status,
    title: trill.title || "",
    message: trill.message,
    radiusMeters: trill.radiusMeters,
    targetingMode: trill.targetingMode,
    scheduledAt: trill.scheduledAt || null,
    sentAt: trill.sentAt || null,
    expiresAt: trill.expiresAt,
    recipientCount: trill.recipientCount || 0,
    deliveredCount: trill.deliveredCount || 0,
    openedCount: trill.openedCount || 0,
    clickedCount: trill.clickedCount || 0,
    checkInCount: trill.checkInCount || 0,
    promoCampaignId: trill.promoCampaignId || null,
    moderation: {
      isBlocked: trill.moderation?.isBlocked === true,
      blockedAt: trill.moderation?.blockedAt || null,
      reason: trill.moderation?.reason || "",
    },
    createdAt: trill.createdAt,
    updatedAt: trill.updatedAt,
  };
}

function sendKnownTrillError(res, error) {
  if (!error?.code || !Object.values(TRILL_REASON).includes(error.code)) {
    return false;
  }

  return res.status(error.status || 400).json({
    ok: false,
    error: error.code,
  });
}
function auditTrill(action, req, details = {}) {
  try {
    logger.info("[trills:audit]", {
      action,
      userId: getUserId(req.user) ? String(getUserId(req.user)) : null,
      role: getUserRole(req.user),
      path: req.originalUrl,
      ip: req.ip,
      ...details,
    });
  } catch (_) {}
}
// POST /api/trills
// T1-B: crea SOLO una bozza validata. Non invia notifiche e non crea delivery.
const createTrillDraftController = asyncHandler(async (req, res) => {
  try {
    const trill = await createTrillDraft({
      user: req.user,
      payload: req.body || {},
      now: new Date(),
    });

    auditTrill("draft_created", req, {
      trillId: String(trill._id),
      eventId: String(trill.eventId),
      type: trill.type,
      targetingMode: trill.targetingMode,
      status: trill.status,
    });

    return res.status(201).json({
      ok: true,
      mode: "draft_only",
      trill: serializeTrill(trill),
    });
  } catch (error) {
    if (error?.code && Object.values(TRILL_REASON).includes(error.code)) {
      auditTrill("draft_rejected", req, {
        reason: error.code,
        status: error.status || 400,
        eventId: req.body?.eventId ? String(req.body.eventId) : null,
      });
      return res.status(error.status || 400).json({
        ok: false,
        error: error.code,
      });
    }

    logger.error("[trills] create draft failed", {
      path: req.originalUrl,
      userId: getUserId(req.user) ? String(getUserId(req.user)) : null,
      message: error?.message || "unknown_error",
    });
    throw error;
  }
});
// POST /api/trills/:id/send
// T2: invia notifiche in-app e crea delivery. Nessun frontend, nessuna push, nessun QR.
const sendTrillController = asyncHandler(async (req, res) => {
  try {
    const result = await sendTrillNotifications({
      user: req.user,
      trillId: req.params.id,
      now: new Date(),
    });

    auditTrill("notifications_sent", req, {
      trillId: String(result.trill._id),
      eventId: String(result.trill.eventId),
      recipientCount: result.recipientCount,
      deliveredCount: result.deliveredCount,
    });

    return res.json({
      ok: true,
      mode: "notification_only",
      trill: serializeTrill(result.trill),
      recipientCount: result.recipientCount,
      deliveredCount: result.deliveredCount,
    });
  } catch (error) {
    if (error?.code && Object.values(TRILL_REASON).includes(error.code)) {
      auditTrill("send_rejected", req, {
        reason: error.code,
        status: error.status || 400,
        trillId: req.params.id ? String(req.params.id) : null,
      });

      return res.status(error.status || 400).json({
        ok: false,
        error: error.code,
      });
    }

    logger.error("[trills] send failed", {
      path: req.originalUrl,
      userId: getUserId(req.user) ? String(getUserId(req.user)) : null,
      message: error?.message || "unknown_error",
    });

    throw error;
  }
});
// GET /api/trills/mine
const listMyTrills = asyncHandler(async (req, res) => {
  const userId = getUserId(req.user);
  if (!userId) {
    return res.status(401).json({ ok: false, error: "not_authorized" });
  }

  const limit = normalizeLimit(req.query.limit);

  const trills = await Trill.find({
    $or: [
      { createdBy: userId },
      { organizerId: userId },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("eventId", "title dateStart dateEnd city region approvalStatus")
    .lean();

  auditTrill("list_mine", req, {
    count: trills.length,
    limit,
  });

  return res.json({
    ok: true,
    trills: trills.map(serializeTrill),
  });
});
// GET /api/trills/admin
// T3: storico/moderazione admin backend-only.
const listAdminTrills = asyncHandler(async (req, res) => {
  const limit = normalizeLimit(req.query.limit);
  const query = {};

  if (req.query.status) query.status = String(req.query.status);
  if (req.query.type) query.type = String(req.query.type);

  const eventId = normalizeObjectId(req.query.eventId);
  if (eventId) query.eventId = eventId;

  const organizerId = normalizeObjectId(req.query.organizerId);
  if (organizerId) query.organizerId = organizerId;

  const trills = await Trill.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("eventId", "title dateStart dateEnd approvalStatus")
    .populate("organizerId", "name email role")
    .lean();

  auditTrill("admin_list", req, {
    count: trills.length,
    limit,
  });

  return res.json({
    ok: true,
    trills: trills.map(serializeTrill),
  });
});

// PATCH /api/trills/admin/:id/block
// T3: blocco moderazione admin. Non cancella notifiche già create.
const blockTrillAdmin = asyncHandler(async (req, res) => {
  const id = normalizeObjectId(req.params.id);

  if (!id) {
    return res.status(400).json({
      ok: false,
      error: TRILL_REASON.INVALID_EVENT_ID,
    });
  }

  const reason = String(req.body?.reason || "admin_block").trim().slice(0, 240);
  const notes = String(req.body?.notes || "").trim().slice(0, 1000);

  const trill = await Trill.findById(id);

  if (!trill) {
    return res.status(404).json({
      ok: false,
      error: TRILL_REASON.TRILL_NOT_FOUND || "TRILL_NOT_FOUND",
    });
  }

  trill.status = "blocked";
  trill.moderation = {
    ...(trill.moderation || {}),
    isBlocked: true,
    blockedBy: getUserId(req.user),
    blockedAt: new Date(),
    reason,
    notes,
  };

  await trill.save();

  auditTrill("admin_block", req, {
    trillId: String(trill._id),
    eventId: String(trill.eventId),
    reason,
  });

  return res.json({
    ok: true,
    trill: serializeTrill(trill),
  });
});
// GET /api/trills/event/:eventId
const listEventTrills = asyncHandler(async (req, res) => {
  const eventId = normalizeObjectId(req.params.eventId);

  if (!eventId) {
    return res.status(400).json({
      ok: false,
      error: TRILL_REASON.INVALID_EVENT_ID,
    });
  }

  const event = await Event.findById(eventId)
    .select("organizer title dateStart dateEnd approvalStatus")
    .lean();

  if (!event) {
    return res.status(404).json({
      ok: false,
      error: TRILL_REASON.EVENT_NOT_FOUND,
    });
  }

  if (!canManageEvent(req.user, event)) {
    return res.status(403).json({
      ok: false,
      error: TRILL_REASON.FORBIDDEN,
    });
  }

  const limit = normalizeLimit(req.query.limit);

  const trills = await Trill.find({ eventId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  auditTrill("list_event", req, {
    eventId: String(event._id),
    count: trills.length,
    limit,
  });

  return res.json({
    ok: true,
    event: {
      id: event._id,
      title: event.title,
      dateStart: event.dateStart,
      dateEnd: event.dateEnd,
      approvalStatus: event.approvalStatus,
    },
    trills: trills.map(serializeTrill),
  });
});

module.exports = {
  createTrillDraftController,
  sendTrillController,
  listMyTrills,
  listEventTrills,
};
