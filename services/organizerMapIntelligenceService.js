const Event = require("../models/eventModel");
const CheckIn = require("../models/checkInModel");
const Trill = require("../models/trillModel");
const Banner = require("../models/bannerModel");
const Room = require("../models/roomModel");

const MIN_PRIVACY_CLUSTER = 5;

function toId(value) {
  return String(value?._id || value?.id || value || "").trim();
}

function getEventPoint(event) {
  if (
    event?.location?.type === "Point" &&
    Array.isArray(event.location.coordinates) &&
    event.location.coordinates.length === 2
  ) {
    return {
      lat: Number(event.location.coordinates[1]),
      lon: Number(event.location.coordinates[0]),
    };
  }

  if (Number.isFinite(event.lat) && Number.isFinite(event.lon)) {
    return {
      lat: Number(event.lat),
      lon: Number(event.lon),
    };
  }

  return null;
}

function getParticipantsCount(event) {
  return Array.isArray(event?.participants) ? event.participants.length : 0;
}

function isPastEvent(event, now = new Date()) {
  const end = event?.dateEnd ? new Date(event.dateEnd) : null;
  const start = event?.dateStart ? new Date(event.dateStart) : null;
  const reference = end && !Number.isNaN(end.getTime()) ? end : start;

  return Boolean(reference && !Number.isNaN(reference.getTime()) && reference.getTime() < now.getTime());
}

function isSoonEvent(event, now = new Date()) {
  const start = event?.dateStart ? new Date(event.dateStart) : null;
  if (!start || Number.isNaN(start.getTime())) return false;

  const diffMs = start.getTime() - now.getTime();
  return diffMs >= 0 && diffMs <= 48 * 60 * 60 * 1000;
}

function getMapOperationalStatus({ event, checkInsCount, trillsCount, activePromosCount }) {
  const approvalStatus = String(event?.approvalStatus || "pending").toLowerCase();
  const participantsCount = getParticipantsCount(event);

  if (approvalStatus === "blocked" || approvalStatus === "rejected") {
    return {
      level: "critical",
      label: "Critico",
      reason: "Evento bloccato o respinto.",
    };
  }

  if (approvalStatus === "approved" && isSoonEvent(event) && checkInsCount === 0) {
    return {
      level: "critical",
      label: "Critico",
      reason: "Evento imminente senza check-in.",
    };
  }

  if (approvalStatus === "approved" && participantsCount > 0 && checkInsCount === 0) {
    return {
      level: "action",
      label: "Richiede azione",
      reason: "Partecipanti presenti ma check-in assenti.",
    };
  }

  if (approvalStatus === "approved" && trillsCount === 0 && activePromosCount === 0) {
    return {
      level: "monitor",
      label: "Da monitorare",
      reason: "Evento approvato senza trilli o promozioni attive.",
    };
  }

  if (approvalStatus === "pending") {
    return {
      level: "monitor",
      label: "Da monitorare",
      reason: "Evento in attesa di approvazione.",
    };
  }

  return {
    level: "ok",
    label: "Ok",
    reason: "Evento operativo.",
  };
}

function buildSuggestions({ event, checkInsCount, trillsCount, activePromosCount }) {
  const suggestions = [];
  const approvalStatus = String(event?.approvalStatus || "pending").toLowerCase();
  const participantsCount = getParticipantsCount(event);

  if (approvalStatus === "approved" && isSoonEvent(event) && checkInsCount === 0) {
    suggestions.push({
      type: "CREATE_TRILL",
      priority: "urgent",
      message: "Evento imminente con check-in assenti. Valuta un trillo geo.",
      cta: "create_trill",
    });
  }

  if (approvalStatus === "approved" && participantsCount > 0 && activePromosCount === 0) {
    suggestions.push({
      type: "CREATE_PROMO",
      priority: "medium",
      message: "Evento con partecipanti ma nessuna promozione attiva.",
      cta: "create_promo",
    });
  }

  if (approvalStatus === "approved" && trillsCount === 0) {
    suggestions.push({
      type: "TRILL_MISSING",
      priority: "medium",
      message: "Nessun trillo collegato a questo evento.",
      cta: "create_trill",
    });
  }

  return suggestions;
}

async function getOrganizerMapSummary(organizerId) {
  const events = await Event.find({ organizer: organizerId })
    .select(
      "title approvalStatus visibility isPrivate dateStart dateEnd city region country venueName address lat lon location participants accessCode category subcategory"
    )
    .lean();

  const eventIds = events.map((event) => event._id);

  const [checkInRows, trills, promos, rooms] = await Promise.all([
    CheckIn.aggregate([
      { $match: { eventId: { $in: eventIds }, validationStatus: "valid" } },
      { $group: { _id: "$eventId", count: { $sum: 1 } } },
    ]),
    Trill.find({ organizerId, eventId: { $in: eventIds } })
      .select("eventId status recipientCount deliveredCount openedCount clickedCount checkInCount")
      .lean(),
    Banner.find({ source: "organizer", eventId: { $in: eventIds } })
      .select("eventId status paymentStatus placement")
      .lean(),
    Room.find({ type: "event", eventId: { $in: eventIds } })
      .select("eventId updatedAt")
      .lean(),
  ]);

  const checkInsByEvent = new Map(checkInRows.map((row) => [toId(row._id), Number(row.count || 0)]));

  const trillsByEvent = new Map();
  trills.forEach((trill) => {
    const key = toId(trill.eventId);
    const current = trillsByEvent.get(key) || [];
    current.push(trill);
    trillsByEvent.set(key, current);
  });

  const promosByEvent = new Map();
  promos.forEach((promo) => {
    const key = toId(promo.eventId);
    const current = promosByEvent.get(key) || [];
    current.push(promo);
    promosByEvent.set(key, current);
  });

  const roomsByEvent = new Map(rooms.map((room) => [toId(room.eventId), room]));

  const mapEvents = events.map((event) => {
    const eventId = toId(event._id);
    const point = getEventPoint(event);
    const eventTrills = trillsByEvent.get(eventId) || [];
    const eventPromos = promosByEvent.get(eventId) || [];
    const checkInsCount = checkInsByEvent.get(eventId) || 0;
    const activePromosCount = eventPromos.filter((promo) => promo.status === "ACTIVE").length;
    const operationalStatus = getMapOperationalStatus({
      event,
      checkInsCount,
      trillsCount: eventTrills.length,
      activePromosCount,
    });

    const privacySafePresence =
      checkInsCount >= MIN_PRIVACY_CLUSTER
        ? {
            visible: true,
            count: checkInsCount,
            band: checkInsCount >= 30 ? "high" : checkInsCount >= 12 ? "medium" : "low",
          }
        : {
            visible: false,
            count: 0,
            band: "hidden",
          };

    return {
      id: eventId,
      title: event.title || "Evento senza titolo",
      approvalStatus: event.approvalStatus || "pending",
      visibility: event.visibility || "public",
      isPrivate: event.isPrivate === true || event.visibility === "private",
      dateStart: event.dateStart || null,
      dateEnd: event.dateEnd || null,
      city: event.city || "",
      region: event.region || "",
      country: event.country || "",
      category: event.category || "",
      subcategory: event.subcategory || "",
      point,
      metrics: {
        participantsCount: getParticipantsCount(event),
        checkInsCount,
        trillsCount: eventTrills.length,
        sentTrillsCount: eventTrills.filter((trill) => trill.status === "sent").length,
        promosCount: eventPromos.length,
        activePromosCount,
        hasRoom: roomsByEvent.has(eventId),
      },
      privacySafePresence,
      operationalStatus,
      suggestions: buildSuggestions({
        event,
        checkInsCount,
        trillsCount: eventTrills.length,
        activePromosCount,
      }),
      ctas: {
        openEvent: `/pages/organizer-event-detail-v2.html?id=${encodeURIComponent(eventId)}`,
        createTrill: `/pages/organizer-trill-create-v2.html?eventId=${encodeURIComponent(eventId)}`,
        createPromo: `/pages/organizer-promo-create-v2.html?eventId=${encodeURIComponent(eventId)}`,
        manageAccess: `/pages/organizer-event-access-v2.html?id=${encodeURIComponent(eventId)}`,
        openRoom: eventId,
      },
    };
  });

  const kpis = mapEvents.reduce(
    (acc, event) => {
      acc.totalEvents += 1;
      acc.totalCheckIns += Number(event.metrics.checkInsCount || 0);
      acc.totalTrills += Number(event.metrics.trillsCount || 0);
      acc.totalPromos += Number(event.metrics.promosCount || 0);

      if (event.operationalStatus.level === "critical") acc.criticalEvents += 1;
      if (event.operationalStatus.level === "action") acc.actionEvents += 1;
      if (event.operationalStatus.level === "monitor") acc.monitorEvents += 1;
      if (event.operationalStatus.level === "ok") acc.okEvents += 1;

      return acc;
    },
    {
      totalEvents: 0,
      okEvents: 0,
      monitorEvents: 0,
      actionEvents: 0,
      criticalEvents: 0,
      totalCheckIns: 0,
      totalTrills: 0,
      totalPromos: 0,
    }
  );

  return {
    privacy: {
      mode: "privacy_safe_aggregate_only",
      minClusterSize: MIN_PRIVACY_CLUSTER,
      exposesUserIdentity: false,
      exposesUserCoordinates: false,
    },
    kpis,
    events: mapEvents,
  };
}

module.exports = {
  getOrganizerMapSummary,
};
