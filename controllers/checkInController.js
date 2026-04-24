const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Event = require("../models/eventModel");
const CheckIn = require("../models/checkInModel");
const { logger } = require("../core/logger");

const {
  CHECKIN_REASON,
  getCheckInRadiusForEvent,
  isWithinCheckInWindow,
  isLocationFresh,
  isAccuracyAcceptable,
  computeDistanceFromEvent,
  deriveCheckInType,
  buildEventAccessFlags,
  resolveEventStatusForCheckIn,
} = require("../services/checkInService");

function normalizeSource(value) {
  const source = String(value || "").trim();
  if (["map", "event_page", "trill"].includes(source)) return source;
  return "event_page";
}

function normalizeGeoMode(value) {
  const geoMode = String(value || "").trim();
  if (["near_me", "explore", "unknown"].includes(geoMode)) return geoMode;
  return "unknown";
}

function parsePosition(body = {}) {
  const lat = Number(body?.position?.lat);
  const lng = Number(body?.position?.lng);
  const accuracy = Number(body?.position?.accuracy);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    lat,
    lng,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
  };
}
function buildBaseStatus({ access, existing, event, radiusMeters }) {
  return {
    canCheckIn: false,
    alreadyCheckedIn: Boolean(existing),
    checkInId: existing?._id || null,
    checkInType: existing?.type || null,
    checkInAt: existing?.checkedInAt || null,
    isParticipant: Boolean(access?.isParticipant),
    eventStatus: resolveEventStatusForCheckIn(event, new Date()),
    requiresFreshLocation: true,
    radiusMeters,
    reasonCode: existing ? CHECKIN_REASON.ALREADY_CHECKED_IN : null,
  };
}
async function buildSummary(eventId) {
  const [total, planned, spontaneous] = await Promise.all([
    CheckIn.countDocuments({ eventId }),
    CheckIn.countDocuments({ eventId, type: "planned_presence" }),
    CheckIn.countDocuments({ eventId, type: "spontaneous_presence" }),
  ]);

  return {
    total,
    planned,
    spontaneous,
  };
}

const createCheckIn = asyncHandler(async (req, res) => {
  const eventId = String(req.body?.eventId || "").trim();
  const userId = req.user?._id;

  if (!eventId) {
    res.status(400);
    throw new Error("EVENT_ID_REQUIRED");
  }

  const position = parsePosition(req.body);
  if (!position) {
    res.status(400);
    throw new Error(CHECKIN_REASON.LOCATION_REQUIRED);
  }

  const event = await Event.findById(eventId)
    .select("title organizer participants revokedUsers visibility isPrivate location date dateStart dateEnd endDate")
    .lean();

  if (!event) {
    res.status(404);
    throw new Error(CHECKIN_REASON.EVENT_NOT_FOUND);
  }

  const access = buildEventAccessFlags(event, req.user);
  if (!access.canAccess) {
    res.status(access.isRevoked ? 403 : 403);
    throw new Error(CHECKIN_REASON.FORBIDDEN);
  }

  const coords = event?.location?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) {
    res.status(400);
    throw new Error(CHECKIN_REASON.EVENT_HAS_NO_LOCATION);
  }

  if (!isWithinCheckInWindow(event, new Date())) {
    res.status(409);
    throw new Error(CHECKIN_REASON.EVENT_NOT_ACTIVE);
  }

  const locationTimestamp = req.body?.meta?.locationTimestamp || null;
  if (!isLocationFresh(locationTimestamp, new Date())) {
    res.status(400);
    throw new Error(CHECKIN_REASON.LOCATION_TOO_OLD);
  }

  if (!isAccuracyAcceptable(position.accuracy)) {
    res.status(400);
    throw new Error(CHECKIN_REASON.LOCATION_TOO_IMPRECISE);
  }

  const existing = await CheckIn.findOne({ eventId, userId }).lean();
  if (existing) {
    res.status(409);
    throw new Error(CHECKIN_REASON.ALREADY_CHECKED_IN);
  }

  const distanceMeters = computeDistanceFromEvent(event, position.lat, position.lng);
  if (!Number.isFinite(distanceMeters)) {
    res.status(400);
    throw new Error(CHECKIN_REASON.EVENT_HAS_NO_LOCATION);
  }

  const radiusMeters = getCheckInRadiusForEvent(event);
  if (distanceMeters > radiusMeters) {
    res.status(403);
    throw new Error(CHECKIN_REASON.OUTSIDE_RADIUS);
  }

  const checkIn = await CheckIn.create({
    eventId,
    userId,
    type: deriveCheckInType(event, userId),
    checkedInAt: new Date(),
    position: {
      type: "Point",
      coordinates: [position.lng, position.lat],
    },
    distanceFromEventMeters: distanceMeters,
    validationStatus: "valid",
    source: normalizeSource(req.body?.source),
    meta: {
      geoMode: normalizeGeoMode(req.body?.meta?.geoMode),
      accuracyMeters: position.accuracy,
      locationTimestamp: locationTimestamp ? new Date(locationTimestamp) : null,
    },
  });

  const summary = await buildSummary(eventId);

  logger.info("[checkin] created", {
    eventId: String(eventId),
    userId: String(userId),
    type: checkIn.type,
    distanceFromEventMeters: distanceMeters,
    source: checkIn.source,
  });

  return res.status(201).json({
    ok: true,
    checkIn: {
      id: checkIn._id,
      eventId: checkIn.eventId,
      userId: checkIn.userId,
      type: checkIn.type,
      checkedInAt: checkIn.checkedInAt,
      distanceFromEventMeters: checkIn.distanceFromEventMeters,
      source: checkIn.source,
    },
    summary,
  });
});

const getCheckInStatus = asyncHandler(async (req, res) => {
  const eventId = req.params.id;
  const userId = req.user?._id;

  const event = await Event.findById(eventId)
    .select("title organizer participants revokedUsers visibility isPrivate location date dateStart dateEnd endDate")
    .lean();

  if (!event) {
    res.status(404);
    throw new Error(CHECKIN_REASON.EVENT_NOT_FOUND);
  }

  const access = buildEventAccessFlags(event, req.user);
  if (!access.canAccess) {
    res.status(403);
    throw new Error(CHECKIN_REASON.FORBIDDEN);
  }

  const existing = await CheckIn.findOne({ eventId, userId }).lean();
  const radiusMeters = getCheckInRadiusForEvent(event);
  const eventStatus = resolveEventStatusForCheckIn(event, new Date());

  const status = buildBaseStatus({
    access,
    existing,
    event,
    radiusMeters,
  });

  if (existing) {

    return res.json({ ok: true, status });
  }

  const coords = event?.location?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) {
    status.reasonCode = CHECKIN_REASON.EVENT_HAS_NO_LOCATION;
    return res.json({ ok: true, status });
  }

  if (!isWithinCheckInWindow(event, new Date())) {
    status.reasonCode = CHECKIN_REASON.EVENT_NOT_ACTIVE;
    return res.json({ ok: true, status });
  }

  status.canCheckIn = true;
  status.reasonCode = CHECKIN_REASON.VALID;

  return res.json({ ok: true, status });
});
const getCheckInPrecheck = asyncHandler(async (req, res) => {
  const eventId = req.params.id;
  const userId = req.user?._id;

  const event = await Event.findById(eventId)
    .select("title organizer participants revokedUsers visibility isPrivate location date dateStart dateEnd endDate")
    .lean();

  if (!event) {
    res.status(404);
    throw new Error(CHECKIN_REASON.EVENT_NOT_FOUND);
  }

  const access = buildEventAccessFlags(event, req.user);
  if (!access.canAccess) {
    res.status(403);
    throw new Error(CHECKIN_REASON.FORBIDDEN);
  }

  const existing = await CheckIn.findOne({ eventId, userId }).lean();
  const radiusMeters = getCheckInRadiusForEvent(event);

  const preview = buildBaseStatus({
    access,
    existing,
    event,
    radiusMeters,
  });

  if (existing) {
    return res.json({ ok: true, preview });
  }

  const coords = event?.location?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) {
    preview.reasonCode = CHECKIN_REASON.EVENT_HAS_NO_LOCATION;
    return res.json({ ok: true, preview });
  }

  if (!isWithinCheckInWindow(event, new Date())) {
    preview.reasonCode = CHECKIN_REASON.EVENT_NOT_ACTIVE;
    return res.json({ ok: true, preview });
  }

  const position = parsePosition(req.body || {});
  if (!position) {
    preview.reasonCode = CHECKIN_REASON.LOCATION_REQUIRED;
    return res.json({ ok: true, preview });
  }

  const locationTimestamp = req.body?.meta?.locationTimestamp || null;
  if (!isLocationFresh(locationTimestamp, new Date())) {
    preview.reasonCode = CHECKIN_REASON.LOCATION_TOO_OLD;
    return res.json({ ok: true, preview });
  }

  if (!isAccuracyAcceptable(position.accuracy)) {
    preview.reasonCode = CHECKIN_REASON.LOCATION_TOO_IMPRECISE;
    return res.json({ ok: true, preview });
  }

  const distanceMeters = computeDistanceFromEvent(event, position.lat, position.lng);
  if (!Number.isFinite(distanceMeters)) {
    preview.reasonCode = CHECKIN_REASON.EVENT_HAS_NO_LOCATION;
    return res.json({ ok: true, preview });
  }

  preview.distanceFromEventMeters = distanceMeters;

  if (distanceMeters > radiusMeters) {
    preview.reasonCode = CHECKIN_REASON.OUTSIDE_RADIUS;
    return res.json({ ok: true, preview });
  }

  preview.canCheckIn = true;
  preview.reasonCode = CHECKIN_REASON.VALID;

  return res.json({ ok: true, preview });
});
const getEventCheckInSummary = asyncHandler(async (req, res) => {
  const eventId = req.params.id;

  const event = await Event.findById(eventId)
    .select("organizer participants revokedUsers visibility isPrivate")
    .lean();

  if (!event) {
    res.status(404);
    throw new Error(CHECKIN_REASON.EVENT_NOT_FOUND);
  }

  const access = buildEventAccessFlags(event, req.user);
  if (!access.canAccess) {
    res.status(403);
    throw new Error(CHECKIN_REASON.FORBIDDEN);
  }

  const summary = await buildSummary(eventId);
  return res.json({ ok: true, summary });
});

const listEventCheckIns = asyncHandler(async (req, res) => {
  const eventId = req.params.id;

  const event = await Event.findById(eventId)
    .select("organizer")
    .lean();

  if (!event) {
    res.status(404);
    throw new Error(CHECKIN_REASON.EVENT_NOT_FOUND);
  }

  const userId = req.user?._id;
  const role = String(req.user?.role || "").toLowerCase();
  const isAdmin = role === "admin";
  const isOwner = event.organizer && String(event.organizer) === String(userId);

  if (!isAdmin && !isOwner) {
    res.status(403);
    throw new Error(CHECKIN_REASON.FORBIDDEN);
  }

  const rows = await CheckIn.find({ eventId })
    .select("userId type checkedInAt distanceFromEventMeters source meta")
    .sort({ checkedInAt: -1 })
    .lean();

  return res.json({
    ok: true,
    checkIns: Array.isArray(rows) ? rows : [],
  });
});

module.exports = {
  createCheckIn,
  getCheckInStatus,
  getCheckInPrecheck,
  getEventCheckInSummary,
  listEventCheckIns,
};
