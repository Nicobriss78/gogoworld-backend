const Event = require("../models/eventModel");
const Activity = require("../models/activityModel"); // A2.3 – Activity log
const User = require("../models/userModel");
const { awardForAttendance } = require("../services/awards");
const asyncHandler = require("express-async-handler");
const { config } = require("../config");
const { logger } = require("../core/logger"); // #CORE-LOGGER D1
const cache = require("../adapters/cache"); // #CACHE-ADAPTER
const { notify } = require("../services/notifications"); // #NOTIFY-ADAPTER
const { createNotification } = require("./notificationController"); // A9.2 – notifiche in-app eventi
const { normalizeEventForClient } = require("../utils/eventNormalizer");
// ---- Stato evento derivato dal tempo corrente ----
// Status possibili: "ongoing" (in corso), "imminent" (imminente... "concluded" (appena concluso), "past" (oltre finestra concluso)
// Usa ENV con default sicuri; timezone rimane un fallback concettuale (date salvate in UTC)
const IMMINENT_HOURS = Number(config.IMMINENT_HOURS || 72);
const SHOW_CONCLUDED_HOURS = Number(config.SHOW_CONCLUDED_HOURS || 12);
// const DEFAULT_TIMEZONE = "Europe/Rome"; // placeholder per evoluzioni future

function computeEventStatus(ev, now = new Date()) {
  try {
    const start = ev?.date || ev?.dateStart ? new Date(ev.date || ev.dateStart) : null;
    // endDate opzionale: se manca, usa start (evento monogiorno)
    const end = ev?.endDate || ev?.dateEnd ? new Date(ev.endDate || ev.dateEnd) : start;

    if (!start) {
      // senza date, trattiamo come futuro per non bloccare
      return "future";
    }

    const t = now.getTime();
    const ts = start.getTime();
    const te = (end ? end.getTime() : ts);
    const msImminent = IMMINENT_HOURS * 60 * 60 * 1000;
    const msConcluded = SHOW_CONCLUDED_HOURS * 60 * 60 * 1000;

    if (t < ts) {
      // futuro / imminente
      return (ts - t) <= msImminent ? "imminent" : "future";
    }
    if (t >= ts && t <= te) {
      return "ongoing";
    }
    // passato
    return (t - te) <= msConcluded ? "concluded" : "past";
  } catch {
    return "future";
  }
}

function attachStatusToArray(docs, now = new Date()) {
  if (!Array.isArray(docs)) return [];
  return docs.map(d => {
    const obj = (typeof d.toObject === "function") ? d.toObject() : d;
    return { ...obj, status: computeEventStatus(obj, now) };
  });
}

function attachStatusToOne(doc, now = new Date()) {
  if (!doc) return doc;
  const obj = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return { ...obj, status: computeEventStatus(obj, now) };
}

// P0-EVENTS-001 — Contratto dati della lista pubblica eventi.
// `participants` viene letto SOLO internamente per calcolare `isJoined` e non viene
// mai restituito dal DTO pubblico.
const PUBLIC_EVENT_PROJECTION = [
  "_id",
  "title",
  "category",
  "subcategory",
  "venueName",
  "address",
  "city",
  "region",
  "country",
  "lat",
  "lon",
  "dateStart",
  "dateEnd",
  "language",
  "target",
  "isFree",
  "price",
  "currency",
  "images",
  "coverImage",
  "participants",
].join(" ");

function sameObjectId(a, b) {
  if (!a || !b) return false;
  return String(a) === String(b);
}

function toPublicEventDto(doc, userId, now = new Date()) {
  const obj =
    typeof doc?.toObject === "function"
      ? doc.toObject()
      : { ...(doc || {}) };

  const isJoined =
    Boolean(userId) &&
    Array.isArray(obj.participants) &&
    obj.participants.some((participantId) =>
      sameObjectId(participantId, userId)
    );

  return {
    _id: obj._id,
    title: obj.title,
    category: obj.category,
    subcategory: obj.subcategory,
    venueName: obj.venueName,
    address: obj.address,
    city: obj.city,
    region: obj.region,
    country: obj.country,
    lat: obj.lat,
    lon: obj.lon,
    dateStart: obj.dateStart,
    dateEnd: obj.dateEnd,
    language: obj.language,
    target: obj.target,
    isFree: obj.isFree,
    price: obj.price,
    currency: obj.currency,
    images: Array.isArray(obj.images) ? obj.images : [],
    coverImage: obj.coverImage,
    status: computeEventStatus(obj, now),
    isJoined,
  };
}

// A2.3 – helper per creare Activity senza bloccare il flusso principale
async function safeCreateActivity(payload) {
  try {
    await Activity.create(payload);
} catch (err) {
    logger.warn("[Activity] create failed", err);
  }
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Costruisce filtri dinamici dalle query string
function buildFilters(q) {
  const query = {};

  if (q.q) {
    const rawSearch = String(q.q).trim().slice(0, 80);

    if (rawSearch) {
      const safeSearch = escapeRegex(rawSearch);
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { title: { $regex: safeSearch, $options: "i" } },
          { venueName: { $regex: safeSearch, $options: "i" } },
          { address: { $regex: safeSearch, $options: "i" } },
          { city: { $regex: safeSearch, $options: "i" } },
          { province: { $regex: safeSearch, $options: "i" } },
          { region: { $regex: safeSearch, $options: "i" } },
          { country: { $regex: safeSearch, $options: "i" } },
          { category: { $regex: safeSearch, $options: "i" } },
          { subcategory: { $regex: safeSearch, $options: "i" } }
        ]
      });
    }
  }

  if (q.visibility) {
    query.visibility = q.visibility;
  }

  if (q.title) {
    query.title = { $regex: q.title, $options: "i" };
  }

  if (q.city) {
    query.city = { $regex: q.city, $options: "i" };
  }

  if (q.region) {
    query.region = q.region;
  }

  if (q.country) {
    query.country = q.country;
  }

  if (q.category) {
    query.category = q.category;
  }

  if (q.subcategory) {
    query.subcategory = q.subcategory;
  }

  if (q.approvalStatus) {
    query.approvalStatus = q.approvalStatus;
  }

  if (q.language) {
    query.language = q.language;
  }

  if (q.target) {
    query.target = q.target;
  }

  if (q.isFree) {
    query.isFree = q.isFree === "true";
  }

  // Filtro dateStart con range
  if (q.dateStart || q.dateEnd) {
    query.dateStart = {};
    if (q.dateStart) {
      query.dateStart.$gte = new Date(q.dateStart);
    }
    if (q.dateEnd) {
      const end = new Date(q.dateEnd);
      if (/^\d{4}-\d{2}-\d{2}$/.test(q.dateEnd)) {
        const nextDay = new Date(end);
        nextDay.setDate(end.getDate() + 1);
        query.dateStart.$lt = nextDay;
      } else {
        query.dateStart.$lte = end;
      }
    }
  }

  return query;
}

function parseGeoNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function buildGeoPointFromLatLon(lat, lon) {
  const latNum = parseGeoNumber(lat);
  const lonNum = parseGeoNumber(lon);

  if (
    latNum === null ||
    lonNum === null ||
    latNum < -90 ||
    latNum > 90 ||
    lonNum < -180 ||
    lonNum > 180
  ) {
    return undefined;
  }

  return {
    type: "Point",
    coordinates: [lonNum, latNum],
  };
}
function parseGeoParams(q = {}) {
  const lat = parseGeoNumber(q.lat);
  const lng = parseGeoNumber(q.lng);
  const radius = parseGeoNumber(q.radius);

  const hasAnyGeo =
    q.lat !== undefined || q.lng !== undefined || q.radius !== undefined;

  if (!hasAnyGeo) {
    return {
      enabled: false,
      lat: null,
      lng: null,
      radius: null
    };
  }

  const allPresent =
    lat !== null && lng !== null && radius !== null;

  if (!allPresent) {
    return {
      enabled: false,
      invalid: true,
      reason: "GEO_PARAMS_INCOMPLETE"
    };
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return {
      enabled: false,
      invalid: true,
      reason: "GEO_PARAMS_OUT_OF_RANGE"
    };
  }

  if (radius <= 0 || radius > 100000) {
    return {
      enabled: false,
      invalid: true,
      reason: "GEO_RADIUS_INVALID"
    };
  }

  return {
    enabled: true,
    invalid: false,
    lat,
    lng,
    radius
  };
}
function parseBoundsParams(q = {}) {
  const north = parseGeoNumber(q.north);
  const south = parseGeoNumber(q.south);
  const east = parseGeoNumber(q.east);
  const west = parseGeoNumber(q.west);

  const hasAnyBounds =
    q.north !== undefined ||
    q.south !== undefined ||
    q.east !== undefined ||
    q.west !== undefined;

  if (!hasAnyBounds) {
    return {
      enabled: false,
      north: null,
      south: null,
      east: null,
      west: null
    };
  }

  const allPresent =
    north !== null &&
    south !== null &&
    east !== null &&
    west !== null;

  if (!allPresent) {
    return {
      enabled: false,
      invalid: true,
      reason: "BOUNDS_PARAMS_INCOMPLETE"
    };
  }

  if (
    north < -90 || north > 90 ||
    south < -90 || south > 90 ||
    east < -180 || east > 180 ||
    west < -180 || west > 180
  ) {
    return {
      enabled: false,
      invalid: true,
      reason: "BOUNDS_PARAMS_OUT_OF_RANGE"
    };
  }

  if (south > north) {
    return {
      enabled: false,
      invalid: true,
      reason: "BOUNDS_LAT_INVALID"
    };
  }

  if (west > east) {
    return {
      enabled: false,
      invalid: true,
      reason: "BOUNDS_LNG_INVALID"
    };
  }

  return {
    enabled: true,
    invalid: false,
    north,
    south,
    east,
    west
  };
}
// PATCH V1: validazione minima input evento
function validateEventInput(body, options = {}) {
  const errors = [];
  const reqStr = (v) => (typeof v === "string" && v.trim().length > 0);
  const isPartial = options.partial === true;

  if (!isPartial) {
    if (!reqStr(body.title)) errors.push("title obbligatorio");
    if (!reqStr(body.city)) errors.push("city obbligatoria");
    if (!reqStr(body.region)) errors.push("region obbligatoria");
    if (!reqStr(body.country)) errors.push("country obbligatorio");
  } else {
    if (Object.prototype.hasOwnProperty.call(body, "title") && !reqStr(body.title)) errors.push("title obbligatorio");
    if (Object.prototype.hasOwnProperty.call(body, "city") && !reqStr(body.city)) errors.push("city obbligatoria");
    if (Object.prototype.hasOwnProperty.call(body, "region") && !reqStr(body.region)) errors.push("region obbligatoria");
    if (Object.prototype.hasOwnProperty.call(body, "country") && !reqStr(body.country)) errors.push("country obbligatorio");
  }

  if (body.dateStart && isNaN(new Date(body.dateStart).getTime())) errors.push("dateStart non valida");

  const hasDateEnd = Object.prototype.hasOwnProperty.call(body, "dateEnd");
  if (!isPartial && (!hasDateEnd || !body.dateEnd)) {
    errors.push("dateEnd obbligatoria");
  } else if (hasDateEnd && body.dateEnd && isNaN(new Date(body.dateEnd).getTime())) {
    errors.push("dateEnd non valida");
  }

  if (body.dateStart && body.dateEnd) {
    const ds = new Date(body.dateStart);
    const de = new Date(body.dateEnd);
    if (!isNaN(ds.getTime()) && !isNaN(de.getTime()) && de.getTime() < ds.getTime()) {
      errors.push("dateEnd non può essere precedente a dateStart");
    }
  }

  if (body.price != null && Number(body.price) < 0) errors.push("price non può essere negativo");

  const vis = ["public", "private"];
  if (body.visibility && !vis.includes(String(body.visibility))) errors.push("visibility non valida");

  const appr = ["pending", "approved", "rejected", "blocked"];
  if (body.approvalStatus && !appr.includes(String(body.approvalStatus))) errors.push("approvalStatus non valido");

  return errors;
}

// @desc Ottiene tutti gli eventi (pubblici) con filtri
// @route GET /api/events
// @access Public
const listEvents = asyncHandler(async (req, res) => {
  const filters = buildFilters(req.query);
  const userId = req.user?._id || null;

  // P0-EVENTS-001 — boundary pubblico non sovrascrivibile dal client.
  // `visibility` e `approvalStatus` possono ancora comparire nella query per
  // compatibilità con client esistenti, ma NON modificano il perimetro pubblico.
  filters.visibility = "public";
  filters.approvalStatus = "approved";

  const bounds = parseBoundsParams(req.query);
  const geo = parseGeoParams(req.query);

  if (bounds.invalid) {
    return res.status(400).json({
      ok: false,
      message: bounds.reason || "BOUNDS_PARAMS_INVALID"
    });
  }

  if (geo.invalid) {
    return res.status(400).json({
      ok: false,
      message: geo.reason || "GEO_PARAMS_INVALID"
    });
  }

  if (bounds.enabled) {
    filters.location = {
      $geoWithin: {
        $box: [
          [bounds.west, bounds.south],
          [bounds.east, bounds.north]
        ]
      }
    };
  } else if (geo.enabled) {
    filters.location = {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: [geo.lng, geo.lat]
        },
        $maxDistance: geo.radius
      }
    };
  }

  // Le risposte autenticate contengono `isJoined` e non devono essere condivise
  // nella cache anonima.
  const useCache = !userId;
  const cacheKey = "events:list:" + JSON.stringify(req.query || {});

  if (useCache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      logger.debug("[cache] HIT listEvents", cacheKey);
      return res.json({ ok: true, events: cached });
    }
  }

  const events = await Event.find(filters)
    .select(PUBLIC_EVENT_PROJECTION)
    .sort({ dateStart: 1 });

  const now = new Date();
  const payload = events.map((event) =>
    toPublicEventDto(event, userId, now)
  );

  if (useCache) {
    cache.set(cacheKey, payload, 60000); // TTL 60s
    logger.debug("[cache] MISS listEvents", cacheKey);
  }

  return res.json({ ok: true, events: payload });
});



// @desc Ottiene eventi creati dall’organizzatore corrente
// @route GET /api/events/mine/list
// @access Private (organizer)
const listMyEvents = asyncHandler(async (req, res) => {
  const filters = buildFilters(req.query);
  filters.organizer = req.user._id;
  const events = await Event.find(filters).sort({ dateStart: 1 }); // PATCH: ordinamento su dateStart
  const now = new Date();
  const payload = attachStatusToArray(events, now);
  res.json({ ok: true, events: payload });
});
// @desc Eventi creati dagli utenti che seguo
// @route GET /api/events/following
// @access Private (partecipante loggato)
const listFollowingEvents = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    res.status(401);
    throw new Error("Non autenticato");
  }

  // recupera la lista dei following
  const me = await User.findById(userId).select("following").lean();
  if (!me) {
    res.status(404);
    throw new Error("Utente non trovato");
  }

  const following = Array.isArray(me.following) ? me.following : [];

  // se non seguo nessuno → nessun evento
  if (!following.length) {
    return res.json({ ok: true, events: [] });
  }

  // filtri base (riuso dei filtri generali)
  const filters = buildFilters(req.query || {});
  filters.organizer = { $in: following };

  // Visibilità di default:
  // - includo sempre i public
  // - includo i private solo se partecipo
  if (!req.query.visibility) {
    delete filters.visibility;
    filters.$or = [
      { visibility: "public" },
      { visibility: "private", participants: userId }
    ];
  }

  // Solo eventi approvati, salvo override esplicito
  if (!req.query.approvalStatus) {
    filters.approvalStatus = "approved";
  }

const events = await Event.find(filters)
    .populate("organizer", "name")
    .sort({ dateStart: 1 });

  const now = new Date();
  const payload = attachStatusToArray(events, now);

  res.json({ ok: true, events: payload });

});

// @desc Evento singolo
// @route GET /api/events/:id
// @access Public
const getEventById = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id).populate("organizer", "name email");

  if (!event) {
    res.status(404);
    throw new Error("Evento non trovato");
  }

  // EVENTS-MODERATION-003 — boundary di moderazione sul dettaglio evento.
  // Admin e proprietario possono consultare l'evento in qualsiasi stato
  // per esigenze di moderazione/gestione.
  // Tutti gli altri possono vedere soltanto eventi approvati e realmente
  // pubblicabili (public/private), mai draft/pending/rejected/blocked.
  const moderationUserId = req.user?._id;
  const moderationRole = String(req.user?.role || "").toLowerCase();

  const moderationOrganizerId =
    event.organizer?._id || event.organizer;

  const moderationIsAdmin =
    moderationRole === "admin";

  const moderationIsOwner =
    Boolean(
      moderationOrganizerId &&
      moderationUserId &&
      String(moderationOrganizerId) === String(moderationUserId)
    );

  const moderationApprovalStatus =
    String(event.approvalStatus || "").toLowerCase();

  const moderationVisibility =
    String(event.visibility || "").toLowerCase();

  if (!moderationIsAdmin && !moderationIsOwner) {
    const isApproved =
      moderationApprovalStatus === "approved";

    const isParticipantVisible =
      moderationVisibility === "public" ||
      moderationVisibility === "private";

    if (!isApproved || !isParticipantVisible) {
      res.status(403);
      throw new Error("Evento non disponibile");
    }
  }

  // ✅ Protezione eventi privati: solo organizer/admin/participants
  if (event.visibility === "private") {
    const userId = req.user?._id;

    // se non loggato → no
    if (!userId) {
      res.status(401);
      throw new Error("Non autorizzato");
    }

    // ban hard (vale sempre)
    if (Array.isArray(event.revokedUsers)) {
      const isRevoked = event.revokedUsers.some((u) => String(u) === String(userId));
      if (isRevoked) {
        res.status(403);
        throw new Error("Accesso revocato dall’organizzatore");
      }
    }

    const organizerId = event.organizer?._id || event.organizer;
    const isOrganizer = organizerId && String(organizerId) === String(userId);
    const isParticipant = Array.isArray(event.participants)
      ? event.participants.some((p) => String(p) === String(userId))
      : false;

    // Admin: in questo controller lo deduciamo dal role nel token (se lo avete)
    const role = req.user?.role;
    const isAdmin = role === "admin";

    if (!isAdmin && !isOrganizer && !isParticipant) {
      res.status(403);
      throw new Error("Evento privato: accesso negato");
    }
  }

  const now = new Date();
  const payload = attachStatusToOne(event, now);
  // ============================
  // SECURITY: private access + field sanitization
  // ============================
  const userId = req.user?._id;
  const role = String(req.user?.role || "").toLowerCase();
  const isAdmin = role === "admin";

  const organizerId = event.organizer?._id || event.organizer;
  const isOwner = organizerId && userId && String(organizerId) === String(userId);

  const isPrivateEvent =
    event?.isPrivate === true ||
    (event?.visibility && String(event.visibility).toLowerCase() === "private");

  // 🔒 Private enforcement (autorizzati: admin, owner, participants) + ban
  if (isPrivateEvent) {
    const revoked = Array.isArray(event.revokedUsers) ? event.revokedUsers.map(String) : [];
    if (userId && revoked.includes(String(userId))) {
      res.status(403);
      throw new Error("Accesso revocato dall'organizzatore");
    }

    const participants = Array.isArray(event.participants) ? event.participants.map(String) : [];
    const isParticipant = userId && participants.includes(String(userId));

    if (!isAdmin && !isOwner && !isParticipant) {
      res.status(403);
      throw new Error("Evento privato: accesso non autorizzato");
    }
  }

// P0-EVENTS-002 — stato partecipazione viewer-specific.
// Calcolato PRIMA della rimozione di participants dal payload.
  const viewerParticipantIds = Array.isArray(event.participants)
    ? event.participants.map(String)
    : [];

  payload.isJoined = Boolean(
    userId && viewerParticipantIds.includes(String(userId))
  );

// 🧼 Sanitizzazione: i partecipanti NON devono vedere campi sensibili
  if (!isAdmin && !isOwner) {
    if (payload && typeof payload === "object") {
      delete payload.accessCode;
      delete payload.participants;
      delete payload.revokedUsers;
      delete payload.flaggedBy;
      delete payload.moderation;
    }
    if (payload?.organizer && typeof payload.organizer === "object") {
      delete payload.organizer.email;
    }
  }

  const normalized = normalizeEventForClient(payload);
  res.json({ ok: true, event: normalized });
});
// @desc Accesso evento privato tramite codice invito
// @route POST /api/events/access-code
// @access Private (utente loggato)
const accessPrivateEventByCode = asyncHandler(async (req, res) => {
  const code = (req.body && req.body.code ? String(req.body.code) : "").trim();

  if (!code) {
    res.status(400);
    throw new Error("Codice invito mancante");
  }

  // Evento privato, approvato, con quel codice
  const event = await Event.findOne({
    accessCode: code,
    visibility: "private",
    approvalStatus: "approved",
  }).populate("organizer", "name email");

  if (!event) {
    res.status(404);
    throw new Error("Evento privato non trovato o non più disponibile");
  }
  // ✅ BAN: se l'utente è in revokedUsers non può più sbloccare con il codice
  const userId = req.user?._id;
  // 🔒 Se l'utente è bannato/revocato non può rientrare nemmeno col codice
  const revoked = Array.isArray(event.revokedUsers) ? event.revokedUsers.map(String) : [];
  if (userId && revoked.includes(String(userId))) {
    res.status(403);
    throw new Error("Accesso revocato dall'organizzatore");
  }
  if (userId && Array.isArray(event.revokedUsers)) {
    const isRevoked = event.revokedUsers.some((u) => String(u) === String(userId));
    if (isRevoked) {
      res.status(403);
      throw new Error("Accesso revocato dall’organizzatore");
    }
  }

  // PRIVATE-UNLOCK-005 — validazione temporale PRIMA di qualsiasi mutazione.
  // Manteniamo invariata la semantica esistente:
  // "concluded" resta sbloccabile come prima, "past" no.
  const now = new Date();
  const unlockStatus = computeEventStatus(event, now);

  if (unlockStatus === "past") {
    res.status(410);
    throw new Error("Questo evento privato è già concluso");
  }

// ✅ Persistenza accesso: aggiungi l'utente tra i partecipanti (idempotente)

  if (userId) {
    const already = Array.isArray(event.participants)
      ? event.participants.some((p) => String(p) === String(userId))
      : false;

    if (!already) {
      event.participants = Array.isArray(event.participants) ? event.participants : [];
      event.participants.push(userId);
      await event.save();
    }
  }

  const now = new Date();
  const payload = attachStatusToOne(event, now);
// 🧼 Sanitizzazione: chi sblocca come partecipante NON deve ricevere accessCode / liste utenti
  const role = String(req.user?.role || "").toLowerCase();
  const isAdmin = role === "admin";
  const organizerId = event.organizer?._id || event.organizer;
  const isOwner = organizerId && userId && String(organizerId) === String(userId);

  if (!isAdmin && !isOwner) {
    if (payload && typeof payload === "object") {
      delete payload.accessCode;
      delete payload.participants;
      delete payload.revokedUsers;
      delete payload.flaggedBy;
      delete payload.moderation;
    }
    if (payload?.organizer && typeof payload.organizer === "object") {
      delete payload.organizer.email;
    }
  }

  // Se ormai è passato del tutto, non ha senso “sbloccarlo” come privato
  if (payload.status === "past") {
    res.status(410);
    throw new Error("Questo evento privato è già concluso");
  }

  res.json({ ok: true, event: payload });
});
// @desc Lista eventi privati a cui ho accesso (sbloccati / invitati)
// @route GET /api/events/private
// @access Private (utente loggato)
const listPrivateEvents = asyncHandler(async (req, res) => {
  const userId = req.user?._id;

  if (!userId) {
    res.status(401);
    throw new Error("Non autenticato");
  }

  const filters = buildFilters(req.query || {});
  filters.visibility = "private";
  filters.approvalStatus = "approved";
  filters.participants = userId;

  // MAPPA PRIVATI V2:
  // dataset autorizzato stabile.
  // Nessun filtro geo/bounds/radius.
  // La posizione utente resta riservata a check-in e navigazione esterna.

  const events = await Event.find(filters)
    .populate("organizer", "name")
    .sort({ dateStart: 1 });

  const now = new Date();
  const payload = attachStatusToArray(events, now);

  // coerenza con le altre schede: non mostrare i "past"
  const filtered = Array.isArray(payload)
    ? payload.filter((e) => e?.status !== "past")
    : [];

  // sanitizzazione lista privati per i partecipanti
  const sanitized = Array.isArray(filtered)
    ? filtered.map((e) => {
        if (e && typeof e === "object") {
          delete e.accessCode;
          delete e.participants;
          delete e.revokedUsers;
          delete e.flaggedBy;
          delete e.moderation;
          if (e.organizer && typeof e.organizer === "object") {
            delete e.organizer.email;
          }
        }
        return e;
      })
    : [];

  res.json({ ok: true, events: sanitized });
});
// --------------------------------------------------------
// Private Event Access Management + Banner (owner OR admin)
// --------------------------------------------------------
const canManageEventAsOwnerOrAdmin = (req, ev) => {
  const meId = req.user?._id;
  const role = req.user?.role;
  const isAdmin = role === "admin";
  const isOrganizerOwner = ev?.organizer && String(ev.organizer) === String(meId);
  return !!(isAdmin || isOrganizerOwner);
};

const normalizeEmail = (s) => String(s || "").trim().toLowerCase();

// @desc Access management: lista autorizzati + bannati (solo organizer owner o admin)
// @route GET /api/events/:id/access
// @access Private (organizer/admin)
const getEventAccess = asyncHandler(async (req, res) => {
  const ev = await Event.findById(req.params.id)
  .select("title visibility isPrivate accessCode organizer participants revokedUsers")
  .populate("participants", "name email role")
.populate("revokedUsers", "name email role")
.populate("organizer", "_id name email role");
  if (!ev) {
    res.status(404);
    throw new Error("Evento non trovato");
  }

  if (!canManageEventAsOwnerOrAdmin(req, ev)) {
    res.status(403);
    throw new Error("Non autorizzato");
  }

  // per coerenza: access management ha senso solo sui privati
if (ev.visibility !== "private") {
  return res.json({
    ok: true,
    note: "EVENT_NOT_PRIVATE",

    event: {
  _id: ev._id,
  title: ev.title,
  visibility: ev.visibility,
  isPrivate: Boolean(ev.isPrivate || ev.visibility === "private"),
  accessCode: ev.accessCode || null,
  organizer: ev.organizer,
},

    access: {
      allowedUsers: [],
      bannedUsers: [],
    },

    // legacy compatibility
    participants: [],
    revokedUsers: [],
  });
}

  const participants = Array.isArray(ev.participants) ? ev.participants : [];
const revokedUsers = Array.isArray(ev.revokedUsers) ? ev.revokedUsers : [];

res.json({
  ok: true,

  // V2 structure
  event: {
    _id: ev._id,
    title: ev.title,
    visibility: ev.visibility,
    isPrivate: Boolean(ev.isPrivate || ev.visibility === "private"),
    accessCode: ev.accessCode || null,
    organizer: ev.organizer,
  },

  access: {
    allowedUsers: participants,
    bannedUsers: revokedUsers,
  },

  // legacy compatibility
  participants,
  revokedUsers,
});
});

// @desc Invita utente via email (aggiunge a participants se non bannato)
// @route POST /api/events/:id/invite
// @access Private (organizer/admin)
const inviteToPrivateEvent = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);

  if (!email) {
    res.status(400);
    throw new Error("Email mancante");
  }

  const ev = await Event.findById(req.params.id).select("visibility organizer participants revokedUsers");
  if (!ev) {
    res.status(404);
    throw new Error("Evento non trovato");
  }

  if (!canManageEventAsOwnerOrAdmin(req, ev)) {
    res.status(403);
    throw new Error("Non autorizzato");
  }

  if (ev.visibility !== "private") {
    res.status(400);
    throw new Error("Evento non privato");
  }

  const user = await User.findOne({ email }).select("_id name email");
  if (!user) {
    res.status(404);
    throw new Error("Utente non trovato");
  }

  // non ha senso invitare l'organizer
  if (ev.organizer && String(ev.organizer) === String(user._id)) {
    return res.json({ ok: true, already: true });
  }

  // se bannato: non invitiamo (reinserimento esplicito via /unban)
  const isRevoked =
    Array.isArray(ev.revokedUsers) &&
    ev.revokedUsers.some((u) => String(u) === String(user._id));

  if (isRevoked) {
    res.status(409);
    throw new Error("Utente bannato: usa Reinserisci (unban)");
  }

  ev.participants = Array.isArray(ev.participants) ? ev.participants : [];
  const already = ev.participants.some((p) => String(p) === String(user._id));
  if (!already) {
    ev.participants.push(user._id);
    await ev.save();
  }

  res.json({ ok: true });
});

// @desc Ban (revoca) utente (pull da participants + add in revokedUsers)
// @route POST /api/events/:id/ban
// @access Private (organizer/admin)
const banFromPrivateEvent = asyncHandler(async (req, res) => {
  const targetUserId = req.body?.userId;

  if (!targetUserId) {
    res.status(400);
    throw new Error("userId mancante");
  }

  const ev = await Event.findById(req.params.id).select("visibility organizer participants revokedUsers");
  if (!ev) {
    res.status(404);
    throw new Error("Evento non trovato");
  }

  if (!canManageEventAsOwnerOrAdmin(req, ev)) {
    res.status(403);
    throw new Error("Non autorizzato");
  }

  if (ev.visibility !== "private") {
    res.status(400);
    throw new Error("Evento non privato");
  }

  // non bannare l'organizer
  if (ev.organizer && String(ev.organizer) === String(targetUserId)) {
    res.status(400);
    throw new Error("Non puoi escludere l’organizzatore");
  }
  // non bannare admin
const targetUser = await User.findById(targetUserId).select("role");

if (targetUser && String(targetUser.role || "").toLowerCase() === "admin") {
  res.status(400);
  throw new Error("Non puoi escludere un admin");
}
  ev.participants = Array.isArray(ev.participants) ? ev.participants : [];
  ev.revokedUsers = Array.isArray(ev.revokedUsers) ? ev.revokedUsers : [];

  ev.participants = ev.participants.filter((p) => String(p) !== String(targetUserId));

  const alreadyRevoked = ev.revokedUsers.some((u) => String(u) === String(targetUserId));
  if (!alreadyRevoked) ev.revokedUsers.push(targetUserId);

  await ev.save();
  res.json({ ok: true });
});
// @desc Rigenera codice accesso evento privato senza revocare utenti già autorizzati
// @route POST /api/events/:id/access/rotate-code
// @access Private (organizer/admin)
const rotatePrivateAccessCode = asyncHandler(async (req, res) => {
  const ev = await Event.findById(req.params.id).select("visibility organizer accessCode");

  if (!ev) {
    res.status(404);
    throw new Error("Evento non trovato");
  }

  if (!canManageEventAsOwnerOrAdmin(req, ev)) {
    res.status(403);
    throw new Error("Non autorizzato");
  }

  if (ev.visibility !== "private") {
    res.status(400);
    throw new Error("Evento non privato");
  }

  const newCode = generatePrivateCode();
  ev.accessCode = newCode;
  await ev.save();

  res.json({
    ok: true,
    eventId: ev._id,
    accessCode: newCode,
  });
});
// @desc Unban + reinserimento (pull da revokedUsers + add a participants)
// @route POST /api/events/:id/unban
// @access Private (organizer/admin)
const unbanToPrivateEvent = asyncHandler(async (req, res) => {
  const targetUserId = req.body?.userId;

  if (!targetUserId) {
    res.status(400);
    throw new Error("userId mancante");
  }

  const ev = await Event.findById(req.params.id).select("visibility organizer participants revokedUsers");
  if (!ev) {
    res.status(404);
    throw new Error("Evento non trovato");
  }

  if (!canManageEventAsOwnerOrAdmin(req, ev)) {
    res.status(403);
    throw new Error("Non autorizzato");
  }

  if (ev.visibility !== "private") {
    res.status(400);
    throw new Error("Evento non privato");
  }

  ev.participants = Array.isArray(ev.participants) ? ev.participants : [];
  ev.revokedUsers = Array.isArray(ev.revokedUsers) ? ev.revokedUsers : [];

  ev.revokedUsers = ev.revokedUsers.filter((u) => String(u) !== String(targetUserId));

  const alreadyParticipant = ev.participants.some((p) => String(p) === String(targetUserId));
  if (!alreadyParticipant) ev.participants.push(targetUserId);

  await ev.save();
  res.json({ ok: true });
});

// @desc Aggiorna banner (coverImage) - organizer owner o admin
// @route PATCH /api/events/:id/banner
// @access Private (organizer/admin)
const updateEventBanner = asyncHandler(async (req, res) => {
  const bannerUrl = String(req.body?.bannerUrl || "").trim();

  if (!bannerUrl) {
    res.status(400);
    throw new Error("bannerUrl mancante");
  }

  const ev = await Event.findById(req.params.id).select("organizer coverImage");
  if (!ev) {
    res.status(404);
    throw new Error("Evento non trovato");
  }

  if (!canManageEventAsOwnerOrAdmin(req, ev)) {
    res.status(403);
    throw new Error("Non autorizzato");
  }

  ev.coverImage = bannerUrl;
  await ev.save();

  res.json({ ok: true, coverImage: ev.coverImage });
});

// @desc Crea un nuovo evento
// @route POST /api/events
// @access Private (organizer)
const createEvent = asyncHandler(async (req, res) => {
  // 🔒 PATCH Step B: enforcement canOrganize
  if (req.user.role !== "admin" && req.user.canOrganize !== true) {
    res.status(403);
    throw new Error("Non sei autorizzato a creare eventi");
  }

  const body = { ...req.body };
// Guardrail server-side: validazione input evento (incl. dateEnd >= dateStart)
  const vErr = validateEventInput(body || {});
  if (vErr.length) {
    return res.status(400).json({ ok: false, code: "VALIDATION_ERROR", errors: vErr });
  }
  // boolean robusto
  const isFree =
    body.isFree === true ||
    body.isFree === "true" ||
    body.isFree === 1 ||
    body.isFree === "1";

  // prezzo/valuta normalizzati
  let price = Number(body.price);
  if (Number.isNaN(price) || price < 0) price = 0;

  let currency = (body.currency || "").toString().trim().toUpperCase();

  if (isFree) {
    price = 0;
    currency = undefined; // niente currency negli eventi gratuiti
  } else {
    if (!currency) currency = "EUR"; // default concordata
  }
// Normalizza coordinate se arrivate come stringhe ("41,902" o "41.902")
  if (body.lat != null && !isNaN(Number(String(body.lat).replace(",", ".")))) {
    body.lat = Number(String(body.lat).replace(",", "."));
  }
  if (body.lon != null && !isNaN(Number(String(body.lon).replace(",", ".")))) {
    body.lon = Number(String(body.lon).replace(",", "."));
  }

  const geoPoint = buildGeoPointFromLatLon(body.lat, body.lon);

  const event = new Event({
    ...body,
    ...(geoPoint ? { location: geoPoint } : {}),
    isFree,
    price,
    ...(currency ? { currency } : {}),
    organizer: req.user._id,
  });

const created = await event.save();

  await notify("event_created", {
    eventId: created?._id?.toString?.() || String(created?._id || ""),
    organizerId: req.user?._id?.toString?.() || String(req.user?._id || ""),
  });

  cache.delByPrefix("events:list:");
  res.status(201).json({ ok: true, event: created });
});


// @desc Aggiorna un evento
// @route PUT /api/events/:id
// @access Private (organizer)
const updateEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event) {
    res.status(404);
    throw new Error("Evento non trovato");
  }
  if (event.organizer.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Non autorizzato");
  }
  // 🔒 PATCH Step B: enforcement canOrganize
  if (req.user.role !== "admin" && req.user.canOrganize !== true) {
    res.status(403);
    throw new Error("Non sei autorizzato a modificare eventi");
  }
  // Policy Moderazione: evento bloccato → non modificabile dall'organizer
  if (String(event.approvalStatus || "").toLowerCase() === "blocked") {
    res.status(403);
    throw new Error("Evento bloccato dall’amministratore");
  }
  // PATCH V3: validazione input (parziale)
  const vErr = validateEventInput(req.body || {}, { partial: true });
  if (vErr.length) {
    return res.status(400).json({ ok: false, code: "VALIDATION_ERROR", errors: vErr });
  }

  const body = { ...req.body };

  const isFree =
    body.isFree === true ||
    body.isFree === "true" ||
    body.isFree === 1 ||
    body.isFree === "1";

  let price = Number(body.price);
  if (Number.isNaN(price) || price < 0) price = 0;

  let currency = (body.currency || "").toString().trim().toUpperCase();

  if (isFree) {
    price = 0;
    currency = undefined;
  } else {
    if (!currency) currency = "EUR";
  }

  const allowed = {
    // meta
    title: body.title,
    description: body.description,
    status: body.status,
    visibility: body.visibility,
    type: body.type,
    category: body.category,
    subcategory: body.subcategory,
    tags: Array.isArray(body.tags) ? body.tags : undefined,

    // location
    venueName: body.venueName,
    address: body.address,
    street: body.street,
    streetNumber: body.streetNumber,
    postalCode: body.postalCode,
    city: body.city,
    province: body.province,
    region: body.region,
    country: body.country,
    lat: (body.lat != null && !isNaN(Number(String(body.lat).replace(",", "."))))
      ? Number(String(body.lat).replace(",", "."))
      : undefined,
    lon: (body.lon != null && !isNaN(Number(String(body.lon).replace(",", "."))))
      ? Number(String(body.lon).replace(",", "."))
      : undefined,
    location: buildGeoPointFromLatLon(
      (body.lat != null && !isNaN(Number(String(body.lat).replace(",", "."))))
        ? Number(String(body.lat).replace(",", "."))
        : undefined,
      (body.lon != null && !isNaN(Number(String(body.lon).replace(",", "."))))
        ? Number(String(body.lon).replace(",", "."))
        : undefined
    ),

    // date
    dateStart: body.dateStart ? new Date(body.dateStart) : undefined,
    dateEnd: body.dateEnd ? new Date(body.dateEnd) : undefined,
    timezone: body.timezone,

    // prezzo
    isFree,
    price,
    ...(currency ? { currency } : { currency: undefined }),

    // media / extra
    coverImage: typeof body.coverImage === "string" ? body.coverImage : undefined,
    images: Array.isArray(body.images) ? body.images : undefined,

    // link & contatti (se presenti nello schema)
    ticketUrl: body.ticketUrl,
    externalUrl: body.externalUrl,
    contactEmail: body.contactEmail,
    contactPhone: body.contactPhone,

    // capienza
    capacity: typeof body.capacity === "number" ? body.capacity : undefined,
  };

  // Rimuovi chiavi undefined per non sovrascrivere valori esistenti
  Object.keys(allowed).forEach((k) => allowed[k] === undefined && delete allowed[k]);

  Object.assign(event, allowed);
  // Policy Moderazione: se l'evento era approved o rejected, un edit lo riporta in revisione
  {
    const prev = String(event.approvalStatus || "").toLowerCase();
    if (prev === "approved" || prev === "rejected") {
      event.approvalStatus = "pending";
      event.moderation = {
        reason: undefined,
        notes: undefined,
        updatedBy: req.user._id,
        updatedAt: new Date(),
      };
    }
  }
const updated = await event.save();


  cache.delByPrefix("events:list:");
  res.json({ ok: true, event: updated });
});

// @desc Elimina un evento
// @route DELETE /api/events/:id
// @access Private (organizer)
const deleteEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event) {
    res.status(404);
    throw new Error("Evento non trovato");
  }
  if (event.organizer.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Non autorizzato");
  }
  // 🔒 PATCH Step B: enforcement canOrganize
  if (req.user.role !== "admin" && req.user.canOrganize !== true) {
    res.status(403);
    throw new Error("Non sei autorizzato a eliminare eventi");
  }

  await event.deleteOne();
cache.delByPrefix("events:list:");
res.json({ ok: true, message: "Evento eliminato" });
});

// P0-EVENTS-002 — payload sicuro per le mutazioni di partecipazione.
// Le route join/leave non devono restituire il documento Event completo.
function buildParticipationEventPayload(event, userId, now = new Date()) {
  const payload = attachStatusToOne(event, now);

  const participantIds = Array.isArray(event?.participants)
    ? event.participants.map(String)
    : [];

  payload.isJoined = Boolean(
    userId && participantIds.includes(String(userId))
  );

  delete payload.accessCode;
  delete payload.participants;
  delete payload.revokedUsers;
  delete payload.flaggedBy;
  delete payload.moderation;

  if (payload?.organizer && typeof payload.organizer === "object") {
    delete payload.organizer.email;
  }

  return normalizeEventForClient(payload);
}

// @desc Aggiunge partecipante
// @route POST /api/events/:id/join
// @access Private
const joinEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);

  if (!event) {
    res.status(404);
    throw new Error("Evento non trovato");
  }

  const userId = req.user?._id;
  const visibility = String(event.visibility || "").toLowerCase();
  const approvalStatus = String(event.approvalStatus || "").toLowerCase();

  // P0-EVENTS-002 — la partecipazione è consentita solo a eventi approvati
  // e appartenenti ai due flussi supportati (public/private).
  if (approvalStatus !== "approved") {
    res.status(403);
    throw new Error("Evento non disponibile per la partecipazione");
  }

  if (visibility !== "public" && visibility !== "private") {
    res.status(403);
    throw new Error("Evento non disponibile per la partecipazione");
  }

  const revoked = Array.isArray(event.revokedUsers)
    ? event.revokedUsers.map(String)
    : [];

  if (userId && revoked.includes(String(userId))) {
    res.status(403);
    throw new Error("Accesso revocato dall'organizzatore");
  }

  const participants = Array.isArray(event.participants)
    ? event.participants.map(String)
    : [];

  const isParticipant = Boolean(
    userId && participants.includes(String(userId))
  );

  // Un evento privato NON può usare /join per creare un nuovo access grant.
  // L'accesso nasce solo dai flussi intenzionali
  // (codice/invito/gestione organizer).
  if (visibility === "private" && !isParticipant) {
    res.status(403);
    throw new Error("Evento privato: accesso non autorizzato");
  }

  // Blocca partecipazione se evento già concluso.
  const now = new Date();

  // Evento "concluso" se:
  // - esiste dateEnd e now > dateEnd
  // - altrimenti (no dateEnd): now > fine giornata di dateStart
  const hasEnded = (() => {
    if (event.dateEnd) {
      return new Date(event.dateEnd) < now;
    }

    if (event.dateStart) {
      const endOfStart = new Date(event.dateStart);
      endOfStart.setHours(23, 59, 59, 999);
      return now > endOfStart;
    }

    return false;
  })();

  if (hasEnded) {
    res.status(403);
    throw new Error("Non puoi partecipare a un evento già concluso");
  }

  // Solo il flusso pubblico può creare una nuova partecipazione tramite /join.
  if (visibility === "public" && !isParticipant) {
    event.participants = Array.isArray(event.participants)
      ? event.participants
      : [];

    event.participants.push(userId);

    await event.save();

    await notify("event_joined", {
      eventId:
        event?._id?.toString?.() ||
        String(event?._id || ""),
      participantId:
        req.user?._id?.toString?.() ||
        String(req.user?._id || ""),
    });

    // A2.3 – log Activity: partecipazione ad evento
    safeCreateActivity({
      user: req.user._id,
      type: "joined_event",
      event: event._id,
      payload: {
        title: event.title,
        city: event.city,
        region: event.region,
        country: event.country,
        dateStart: event.dateStart,
        dateEnd: event.dateEnd,
      },
    });
  }

  const payload = buildParticipationEventPayload(
    event,
    userId,
    now
  );

  res.json({
    ok: true,
    event: payload,
  });
});
// @desc Rimuove partecipante
// @route POST /api/events/:id/leave
// @access Private
const leaveEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);

  if (!event) {
    res.status(404);
    throw new Error("Evento non trovato");
  }

  const userId = req.user?._id;
  const visibility = String(event.visibility || "").toLowerCase();
  const approvalStatus = String(event.approvalStatus || "").toLowerCase();

  if (approvalStatus !== "approved") {
    res.status(403);
    throw new Error("Evento non disponibile");
  }

  if (visibility !== "public" && visibility !== "private") {
    res.status(403);
    throw new Error("Evento non disponibile");
  }

  const revoked = Array.isArray(event.revokedUsers)
    ? event.revokedUsers.map(String)
    : [];

  if (userId && revoked.includes(String(userId))) {
    res.status(403);
    throw new Error("Accesso revocato dall'organizzatore");
  }

  const wasParticipant =
    Array.isArray(event.participants) &&
    event.participants.some(
      (p) => String(p) === String(userId)
    );

  // Per un privato, anche /leave deve essere accessibile soltanto
  // a chi possiede davvero il grant corrente.
  // Impedisce l'uso della route come lettura laterale.
  if (visibility === "private" && !wasParticipant) {
    res.status(403);
    throw new Error("Evento privato: accesso non autorizzato");
  }

  if (wasParticipant) {
    event.participants = event.participants.filter(
      (p) => String(p) !== String(userId)
    );

    await event.save();

    await notify("event_left", {
      eventId:
        event?._id?.toString?.() ||
        String(event?._id || ""),
      participantId:
        req.user?._id?.toString?.() ||
        String(req.user?._id || ""),
    });
  }

  const payload = buildParticipationEventPayload(
    event,
    userId
  );

  res.json({
    ok: true,
    event: payload,
  });
});

// 🔎 PATCH S6: stato partecipazione (diagnostica per FE)
// @desc Ritorna se l'utente corrente partecipa all'evento
// @route GET /api/events/:id/participation
// @access Private
const getParticipation = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id).select("_id participants");
  if (!event) {
    res.status(404);
    throw new Error("Evento non trovato");
  }
  const inList = Array.isArray(event.participants)
    && event.participants.some((p) => p.toString() === req.user._id.toString());
  res.json({ ok: true, in: inList });
});
// ---------------------------------------------------------------------
// Admin: recupera codice evento privato
// ---------------------------------------------------------------------
async function getPrivateAccessCodeAdmin(req, res) {
  try {
    const eventId = req.params.id;
    const event = await Event.findById(eventId);

    if (!event) {
      return res.status(404).json({ ok: false, error: "EVENT_NOT_FOUND" });
    }

    if (event.visibility !== "private") {
      return res.status(400).json({
        ok: false,
        error: "EVENT_NOT_PRIVATE",
      });
    }

    return res.json({
      ok: true,
      eventId: event._id,
      accessCode: event.accessCode || null,
    });
} catch (err) {
  logger.error("getPrivateAccessCodeAdmin error", err);
  return res.status(500).json({ ok: false, error: "internal_error" });
}

}

// ---------------------------------------------------------------------
// Admin: rigenera codice evento privato
// ---------------------------------------------------------------------
async function rotatePrivateAccessCodeAdmin(req, res) {
  try {
    const eventId = req.params.id;
    const event = await Event.findById(eventId);

    if (!event) {
      return res.status(404).json({ ok: false, error: "EVENT_NOT_FOUND" });
    }

    if (event.visibility !== "private") {
      return res.status(400).json({
        ok: false,
        error: "EVENT_NOT_PRIVATE",
      });
    }

    const newCode = generatePrivateCode();
    event.accessCode = newCode;
    await event.save();

    return res.json({
      ok: true,
      eventId: event._id,
      newCode,
    });
} catch (err) {
  logger.error("rotatePrivateAccessCodeAdmin error", err);
  return res.status(500).json({ ok: false, error: "internal_error" });
}

}

// @desc Chiude evento e assegna punti ai partecipanti
// @route PUT /api/events/:id/close
// @access Private (admin)
const closeEventAndAward = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const event = await Event.findById(id);
  if (!event) {
    res.status(404);
    throw new Error("Evento non trovato");
  }
// Idempotenza: se già premiato, non riassegnare
  if (event.awardedClosed === true) {
    return res.json({ ok: true, message: "Evento già chiuso e premi assegnati", awarded: 0, already: true, eventId: id });
  }
  const now = new Date();
 // Considera evento concluso SE:
// - esiste dateEnd ed è nel passato
// - OPPURE non c'è dateEnd ma esiste dateStart ed è nel passato
const hasEnded = (() => {
if (event.dateEnd) return new Date(event.dateEnd) < now;
if (event.dateStart) {
const endOfStart = new Date(event.dateStart);
endOfStart.setHours(23, 59, 59, 999);
return now > endOfStart;
}
return false;
})();

if (!hasEnded) {
  res.status(400);
  throw new Error("L'evento non risulta ancora concluso");
}


  const participants = Array.isArray(event.participants) ? event.participants : [];
  if (!participants.length) {
    return res.json({ ok: true, message: "Nessun partecipante da premiare", awarded: 0 });
  }

try {
    const count = await awardForAttendance(participants);

    // Flag idempotenza su evento
    event.awardedClosed = true;
    event.awardedClosedAt = new Date();
    await event.save({ validateModifiedOnly: true });

// A2.3 – log Activity: evento effettivamente “frequentato”
    // Una Activity per ogni partecipante
    participants.forEach((userId) => {
      safeCreateActivity({
        user: userId,
        type: "attended_event",
        event: event._id,
        payload: {
          title: event.title,
          city: event.city,
          region: event.region,
          country: event.country,
          dateStart: event.dateStart,
          dateEnd: event.dateEnd,
        },
      });
    });

    return res.json({ ok: true, message: "Premi assegnati", awarded: count, eventId: id });
  } catch (err) {
    logger.error("[closeEventAndAward] error:", err);
    res.status(500);
    throw new Error("Errore nella chiusura evento");
  }
});

// ---------------------------------------------------------------------
// Utility interna: genera codice privato sicuro (admin rotation)
// ---------------------------------------------------------------------
function generatePrivateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const length = 8;
  let out = "";
  const crypto = require("crypto");
  const buf = crypto.randomBytes(length);

  for (let i = 0; i < length; i++) {
    out += alphabet[buf[i] % alphabet.length];
  }
  return out;
}

module.exports = {
  listEvents,
  listMyEvents,
  listFollowingEvents,
  getEventById,
  accessPrivateEventByCode, // ← NEW
  listPrivateEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  joinEvent,
  leaveEvent,
  getParticipation, // ← PATCH S6 export
  closeEventAndAward, // ← NEW export
  getPrivateAccessCodeAdmin,
  rotatePrivateAccessCodeAdmin,
  getEventAccess,
  inviteToPrivateEvent,
  banFromPrivateEvent,
  rotatePrivateAccessCode,
  unbanToPrivateEvent,
  updateEventBanner,
};





































