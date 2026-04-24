const checkInPolicy = require("../utils/checkInPolicy");

const CHECKIN_REASON = {
  VALID: "VALID",
  INVALID_EVENT_ID: "INVALID_EVENT_ID",
  EVENT_NOT_FOUND: "EVENT_NOT_FOUND",
  EVENT_HAS_NO_LOCATION: "EVENT_HAS_NO_LOCATION",
  EVENT_NOT_ACTIVE: "EVENT_NOT_ACTIVE",
  LOCATION_REQUIRED: "LOCATION_REQUIRED",
  LOCATION_TOO_OLD: "LOCATION_TOO_OLD",
  LOCATION_TOO_IMPRECISE: "LOCATION_TOO_IMPRECISE",
  OUTSIDE_RADIUS: "OUTSIDE_RADIUS",
  ALREADY_CHECKED_IN: "ALREADY_CHECKED_IN",
  FORBIDDEN: "FORBIDDEN",
};

function getCheckInRadiusForEvent(_event) {
  return checkInPolicy.defaultRadiusMeters;
}

function getEffectiveEventEnd(event) {
  if (event?.dateEnd) return new Date(event.dateEnd);
  if (event?.endDate) return new Date(event.endDate);
  if (!event?.dateStart && !event?.date) return null;

  const base = new Date(event.dateStart || event.date);
  base.setHours(23, 59, 59, 999);
  return base;
}

function getEffectiveEventStart(event) {
  if (event?.dateStart) return new Date(event.dateStart);
  if (event?.date) return new Date(event.date);
  return null;
}

function isWithinCheckInWindow(event, now = new Date()) {
  const start = getEffectiveEventStart(event);
  const end = getEffectiveEventEnd(event);

  if (!start || !end) return false;

  return (
    now.getTime() >= start.getTime() - checkInPolicy.allowBeforeStartMs &&
    now.getTime() <= end.getTime() + checkInPolicy.allowAfterEndMs
  );
}

function isLocationFresh(locationTimestamp, now = new Date()) {
  if (!locationTimestamp) return false;

  const ts = new Date(locationTimestamp);
  if (Number.isNaN(ts.getTime())) return false;

  return now.getTime() - ts.getTime() <= checkInPolicy.maxLocationAgeMs;
}

function isAccuracyAcceptable(accuracyMeters) {
  const accuracy = Number(accuracyMeters);
  if (!Number.isFinite(accuracy)) return false;
  return accuracy <= checkInPolicy.maxAccuracyMeters;
}

function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function computeDistanceFromEvent(event, lat, lng) {
  const coords = event?.location?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return null;

  const [eventLng, eventLat] = coords;
  if (![eventLng, eventLat, lat, lng].every(Number.isFinite)) return null;

  return haversineDistanceMeters(eventLat, eventLng, lat, lng);
}

function deriveCheckInType(event, userId) {
  const participants = Array.isArray(event?.participants) ? event.participants : [];
  const target = String(userId);

  const alreadyParticipant = participants.some((p) => String(p) === target);
  return alreadyParticipant ? "planned_presence" : "spontaneous_presence";
}

function buildEventAccessFlags(event, user) {
  const userId = user?._id || user?.id;
  const role = String(user?.role || "").toLowerCase();
  const isAdmin = role === "admin";

  const organizerId = event?.organizer?._id || event?.organizer;
  const isOwner = organizerId && userId && String(organizerId) === String(userId);

  const participants = Array.isArray(event?.participants) ? event.participants : [];
  const isParticipant = userId
    ? participants.some((p) => String(p) === String(userId))
    : false;

  const revokedUsers = Array.isArray(event?.revokedUsers) ? event.revokedUsers : [];
  const isRevoked = userId
    ? revokedUsers.some((u) => String(u) === String(userId))
    : false;

  const isPrivateEvent =
    event?.isPrivate === true ||
    String(event?.visibility || "").toLowerCase() === "private";

  return {
    isAdmin,
    isOwner,
    isParticipant,
    isRevoked,
    isPrivateEvent,
    canAccess: !isPrivateEvent || (!!userId && !isRevoked && (isAdmin || isOwner || isParticipant)),
  };
}

function resolveEventStatusForCheckIn(event, now = new Date()) {
  const start = getEffectiveEventStart(event);
  const end = getEffectiveEventEnd(event);

  if (!start || !end) return "unknown";
  if (now.getTime() < start.getTime()) return "upcoming";
  if (now.getTime() > end.getTime()) return "past";
  return "ongoing";
}

module.exports = {
  CHECKIN_REASON,
  getCheckInRadiusForEvent,
  getEffectiveEventStart,
  getEffectiveEventEnd,
  isWithinCheckInWindow,
  isLocationFresh,
  isAccuracyAcceptable,
  haversineDistanceMeters,
  computeDistanceFromEvent,
  deriveCheckInType,
  buildEventAccessFlags,
  resolveEventStatusForCheckIn,
};
