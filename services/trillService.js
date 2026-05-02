const mongoose = require("mongoose");
const Event = require("../models/eventModel");
const Trill = require("../models/trillModel");
const User = require("../models/userModel");
const TrillDelivery = require("../models/trillDeliveryModel");
const CheckIn = require("../models/checkInModel");
const Notification = require("../models/notificationModel");

const TRILL_REASON = {
  INVALID_EVENT_ID: "INVALID_EVENT_ID",
  EVENT_NOT_FOUND: "EVENT_NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  EVENT_NOT_APPROVED: "EVENT_NOT_APPROVED",
  EVENT_DATES_REQUIRED: "EVENT_DATES_REQUIRED",
  EVENT_OUTSIDE_TRILL_WINDOW: "EVENT_OUTSIDE_TRILL_WINDOW",
  INVALID_TYPE: "INVALID_TYPE",
  INVALID_TARGETING_MODE: "INVALID_TARGETING_MODE",
  INVALID_MESSAGE: "INVALID_MESSAGE",
  INVALID_RADIUS: "INVALID_RADIUS",
  TYPE_NOT_AVAILABLE: "TYPE_NOT_AVAILABLE",
  DRAFT_ALREADY_EXISTS: "DRAFT_ALREADY_EXISTS",

  TRILL_NOT_FOUND: "TRILL_NOT_FOUND",
  TRILL_NOT_SENDABLE: "TRILL_NOT_SENDABLE",
  TARGETING_NOT_AVAILABLE: "TARGETING_NOT_AVAILABLE",
  NO_RECIPIENTS: "NO_RECIPIENTS",

  PROMO_NOT_IMPLEMENTED: "PROMO_NOT_IMPLEMENTED",
};

const TRILL_WINDOW_BEFORE_START_MS = 2 * 60 * 60 * 1000;

const TYPE_DEFAULT_RADIUS = {
  base: 1000,
  boost: 3000,
  promo: 3000,
  admin: 5000,
};

const TYPE_MAX_RADIUS = {
  base: 1000,
  boost: 5000,
  promo: 5000,
  admin: 5000,
};

// T1-C: solo base/admin
const ENABLED_T1_DRAFT_TYPES = new Set(["base", "admin"]);

function normalizeObjectId(value) {
  const id = String(value || "").trim();
  return mongoose.Types.ObjectId.isValid(id) ? id : null;
}

function normalizeIdList(list = []) {
  if (!Array.isArray(list)) return [];
  return list
    .map((value) => normalizeObjectId(value?._id || value))
    .filter(Boolean);
}

function uniqueIdList(list = []) {
  return [...new Set(list.map(String))];
}

function normalizeTrillType(value) {
  const type = String(value || "base").trim().toLowerCase();
  return ["base", "boost", "promo", "admin"].includes(type) ? type : null;
}

function normalizeTargetingMode(value) {
  const mode = String(value || "nearby").trim().toLowerCase();
  return ["nearby", "interested_not_checked_in", "both"].includes(mode) ? mode : null;
}

function normalizeMessage(value) {
  const message = String(value || "").trim();
  return message.length >= 4 && message.length <= 240 ? message : null;
}

function normalizeTitle(value) {
  const title = String(value || "").trim();
  return title ? title.slice(0, 120) : undefined;
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

function isEventApproved(event) {
  return String(event?.approvalStatus || "").toLowerCase() === "approved";
}

function getRequiredEventDates(event) {
  const start = event?.dateStart ? new Date(event.dateStart) : null;
  const end = event?.dateEnd ? new Date(event.dateEnd) : null;

  if (!start || !end) return null;
  return { start, end };
}

function isWithinTrillWindow(event, now = new Date()) {
  const dates = getRequiredEventDates(event);
  if (!dates) return false;

  const from = dates.start.getTime() - TRILL_WINDOW_BEFORE_START_MS;
  const to = dates.end.getTime();
  const t = now.getTime();

  return t >= from && t <= to;
}

function normalizeRadiusMeters(type, value) {
  const raw = Number(value);
  const fallback = TYPE_DEFAULT_RADIUS[type] || TYPE_DEFAULT_RADIUS.base;
  const max = TYPE_MAX_RADIUS[type] || TYPE_MAX_RADIUS.base;

  const radius = Number.isFinite(raw) ? raw : fallback;
  if (radius < 100 || radius > max) return null;

  return Math.round(radius);
}

function buildTrillError(code, status = 400) {
  const err = new Error(code);
  err.code = code;
  err.status = status;
  return err;
}

async function getEventForTrill(eventId) {
  return Event.findById(eventId)
    .select("title organizer approvalStatus dateStart dateEnd participants revokedUsers")
    .lean();
}

/* =========================
   RECIPIENTS
========================= */

async function getCheckedInUserIds(eventId) {
  const checkIns = await CheckIn.find({ eventId }).select("userId").lean();
  return new Set(checkIns.map((c) => String(c.userId)));
}

async function getInterestedNotCheckedInRecipients(event) {
  const participants = uniqueIdList(normalizeIdList(event.participants));
  const revoked = new Set(uniqueIdList(normalizeIdList(event.revokedUsers)));
  const checkedIn = await getCheckedInUserIds(event._id);

  return participants.filter((id) => {
    if (revoked.has(id)) return false;
    if (checkedIn.has(id)) return false;
    if (String(event.organizer) === id) return false;
    return true;
  });
}

async function getNearbyFallbackRecipients(event) {
  const revoked = new Set(uniqueIdList(normalizeIdList(event.revokedUsers)));
  const checkedIn = await getCheckedInUserIds(event._id);

  const users = await User.find({
    role: "participant",
  })
    .select("_id")
    .limit(500)
    .lean();

  return users
    .map((u) => String(u._id))
    .filter((id) => {
      if (revoked.has(id)) return false;
      if (checkedIn.has(id)) return false;
      if (String(event.organizer) === id) return false;
      return true;
    });
}

async function resolveTrillRecipients({ trill, event }) {
  if (trill.targetingMode === "interested_not_checked_in") {
    return getInterestedNotCheckedInRecipients(event);
  }

  if (trill.targetingMode === "nearby") {
    return getNearbyFallbackRecipients(event);
  }

  if (trill.targetingMode === "both") {
    const a = await getInterestedNotCheckedInRecipients(event);
    const b = await getNearbyFallbackRecipients(event);
    return uniqueIdList([...a, ...b]);
  }

  throw buildTrillError(TRILL_REASON.TARGETING_NOT_AVAILABLE, 409);
}

/* =========================
   NOTIFICATION PAYLOAD
========================= */

function buildTrillNotificationPayload({ trill, event, recipientId }) {
  return {
    user: recipientId,
    actor: trill.createdBy,
    event: event._id,
    type: "trill",
    title: trill.title || "Trillo evento",
    message: trill.message,
    data: {
      trillId: String(trill._id),
      eventId: String(event._id),
    },
  };
}

/* =========================
   CREATE DRAFT
========================= */

async function createTrillDraft({ user, payload = {}, now = new Date() }) {
  const eventId = normalizeObjectId(payload.eventId);
  if (!eventId) throw buildTrillError(TRILL_REASON.INVALID_EVENT_ID);

  const event = await getEventForTrill(eventId);
  if (!event) throw buildTrillError(TRILL_REASON.EVENT_NOT_FOUND, 404);
  if (!canManageEvent(user, event)) throw buildTrillError(TRILL_REASON.FORBIDDEN, 403);
  if (!isEventApproved(event)) throw buildTrillError(TRILL_REASON.EVENT_NOT_APPROVED, 409);
  if (!isWithinTrillWindow(event, now)) throw buildTrillError(TRILL_REASON.EVENT_OUTSIDE_TRILL_WINDOW, 409);

  const type = normalizeTrillType(payload.type);
  if (!type) throw buildTrillError(TRILL_REASON.INVALID_TYPE);
  if (!ENABLED_T1_DRAFT_TYPES.has(type)) throw buildTrillError(TRILL_REASON.TYPE_NOT_AVAILABLE, 409);

  const targetingMode = normalizeTargetingMode(payload.targetingMode);
  if (!targetingMode) throw buildTrillError(TRILL_REASON.INVALID_TARGETING_MODE);

  const message = normalizeMessage(payload.message);
  if (!message) throw buildTrillError(TRILL_REASON.INVALID_MESSAGE);

  const radiusMeters = normalizeRadiusMeters(type, payload.radiusMeters);
  if (!radiusMeters) throw buildTrillError(TRILL_REASON.INVALID_RADIUS);

  const existing = await Trill.findOne({
    eventId,
    createdBy: getUserId(user),
    status: { $in: ["draft", "scheduled"] },
  }).lean();

  if (existing) throw buildTrillError(TRILL_REASON.DRAFT_ALREADY_EXISTS, 409);

  return Trill.create({
    eventId,
    organizerId: event.organizer,
    createdBy: getUserId(user),
    createdByRole: getUserRole(user),
    type,
    status: "draft",
    message,
    radiusMeters,
    targetingMode,
    expiresAt: event.dateEnd,
  });
}

/* =========================
   SEND
========================= */

async function sendTrillNotifications({ user, trillId, now = new Date() }) {
  const id = normalizeObjectId(trillId);
  if (!id) throw buildTrillError(TRILL_REASON.INVALID_EVENT_ID);

  const trill = await Trill.findById(id);
  if (!trill) throw buildTrillError(TRILL_REASON.TRILL_NOT_FOUND, 404);

  if (trill.moderation?.isBlocked === true || String(trill.status) === "blocked") {
    throw buildTrillError(TRILL_REASON.TRILL_NOT_SENDABLE, 409);
  }

  if (!["draft", "scheduled"].includes(trill.status)) {
    throw buildTrillError(TRILL_REASON.TRILL_NOT_SENDABLE, 409);
  }

  const event = await getEventForTrill(trill.eventId);
  if (!event) throw buildTrillError(TRILL_REASON.EVENT_NOT_FOUND, 404);
  if (!canManageEvent(user, event)) throw buildTrillError(TRILL_REASON.FORBIDDEN, 403);
  if (!isEventApproved(event)) throw buildTrillError(TRILL_REASON.EVENT_NOT_APPROVED, 409);
  if (!isWithinTrillWindow(event, now)) {
    throw buildTrillError(TRILL_REASON.EVENT_OUTSIDE_TRILL_WINDOW, 409);
  }

  const recipients = await resolveTrillRecipients({ trill, event });
  if (!recipients.length) throw buildTrillError(TRILL_REASON.NO_RECIPIENTS, 409);

  let delivered = 0;

  for (const userId of recipients) {
    const notif = await Notification.create(
      buildTrillNotificationPayload({ trill, event, recipientId: userId })
    );

    await TrillDelivery.create({
      trillId: trill._id,
      eventId: event._id,
      userId,
      notificationId: notif._id,
      deliveredAt: now,
      status: "delivered",
    });

    delivered++;
  }

  trill.status = "sent";
  trill.sentAt = now;
  trill.recipientCount = recipients.length;
  trill.deliveredCount = delivered;

  await trill.save();

  return {
    trill,
    recipientCount: recipients.length,
    deliveredCount: delivered,
  };
}

module.exports = {
  TRILL_REASON,
  createTrillDraft,
  sendTrillNotifications,
};
