const mongoose = require("mongoose");
const Event = require("../models/eventModel");
const Trill = require("../models/trillModel");

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
// T1-C: in questa fase il backend espone solo bozze base/admin.
// boost e promo restano modellati, ma non ancora attivabili senza piano/PromoCampaign.
const ENABLED_T1_DRAFT_TYPES = new Set(["base", "admin"]);
function normalizeObjectId(value) {
  const id = String(value || "").trim();
  return mongoose.Types.ObjectId.isValid(id) ? id : null;
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

  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

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
  const error = new Error(code);
  error.status = status;
  error.code = code;
  return error;
}

async function getEventForTrill(eventId) {
  return Event.findById(eventId)
    .select("title organizer approvalStatus dateStart dateEnd location visibility isPrivate participants revokedUsers")
    .lean();
}

async function createTrillDraft({ user, payload = {}, now = new Date() }) {
  const eventId = normalizeObjectId(payload.eventId);
  if (!eventId) throw buildTrillError(TRILL_REASON.INVALID_EVENT_ID, 400);

  const event = await getEventForTrill(eventId);
  if (!event) throw buildTrillError(TRILL_REASON.EVENT_NOT_FOUND, 404);
  if (!canManageEvent(user, event)) throw buildTrillError(TRILL_REASON.FORBIDDEN, 403);
  if (!isEventApproved(event)) throw buildTrillError(TRILL_REASON.EVENT_NOT_APPROVED, 409);

  const dates = getRequiredEventDates(event);
  if (!dates) throw buildTrillError(TRILL_REASON.EVENT_DATES_REQUIRED, 409);
  if (!isWithinTrillWindow(event, now)) {
    throw buildTrillError(TRILL_REASON.EVENT_OUTSIDE_TRILL_WINDOW, 409);
  }

  const type = normalizeTrillType(payload.type);
  if (!type) throw buildTrillError(TRILL_REASON.INVALID_TYPE, 400);
  if (type === "admin" && !isAdmin(user)) throw buildTrillError(TRILL_REASON.FORBIDDEN, 403);

  const targetingMode = normalizeTargetingMode(payload.targetingMode);
  if (!targetingMode) throw buildTrillError(TRILL_REASON.INVALID_TARGETING_MODE, 400);

  const message = normalizeMessage(payload.message);
  if (!message) throw buildTrillError(TRILL_REASON.INVALID_MESSAGE, 400);

  const radiusMeters = normalizeRadiusMeters(type, payload.radiusMeters);
  if (!radiusMeters) throw buildTrillError(TRILL_REASON.INVALID_RADIUS, 400);

  if (type === "promo" && payload.promoCampaignId) {
    throw buildTrillError(TRILL_REASON.PROMO_NOT_IMPLEMENTED, 409);
  }

  const userId = getUserId(user);

  return Trill.create({
    eventId,
    organizerId: event.organizer,
    createdBy: userId,
    createdByRole: getUserRole(user),
    type,
    status: "draft",
    title: normalizeTitle(payload.title),
    message,
    radiusMeters,
    targetingMode,
    scheduledAt: null,
    sentAt: null,
    expiresAt: dates.end,
    promoCampaignId: null,
    recipientCount: 0,
    deliveredCount: 0,
    openedCount: 0,
    clickedCount: 0,
    checkInCount: 0,
  });
}

module.exports = {
  TRILL_REASON,
  TRILL_WINDOW_BEFORE_START_MS,
  TYPE_DEFAULT_RADIUS,
  TYPE_MAX_RADIUS,
  normalizeObjectId,
  normalizeTrillType,
  normalizeTargetingMode,
  isWithinTrillWindow,
  createTrillDraft,
};
