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

// A2.3 – helper per creare Activity senza bloccare il flusso principale
async function safeCreateActivity(payload) {
  try {
    await Activity.create(payload);
  } catch (err) {
    if (logger && typeof logger.warn === "function") {
      logger.warn("[Activity] create failed", err);
    } else {
      // fallback minimale se il logger non è disponibile
      console.warn("[Activity] create failed", err);
    }
  }
}

// Costruisce filtri dinamici dalle query string
function buildFilters(q) {
  const query = {};

  if (q.title) {
    query.title = { $regex: q.title, $options: "i" };
  }
  if (q.city) {
    query.city = { $regex: q.city, $options: "i" };
  }
  if (q.region) {
    query.region = { $regex: q.region, $options: "i" };
  }
  if (q.country) {
    query.country = { $regex: q.country, $options: "i" };
  }
  if (q.category) {
    query.category = q.category;
  }
  if (q.subcategory) {
    query.subcategory = q.subcategory;
  }
  if (q.visibility) {
    query.visibility = q.visibility;
  }
  // --- Admin: filtro stato approvazione (opzionale da query) ---
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
      // Se formato solo-data (YYYY-MM-DD), includi tutta la giornata
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

// PATCH V1: validazione minima input evento
function validateEventInput(body) {
  const errors = [];
  const reqStr = (v) => (typeof v === "string" && v.trim().length > 0);

  if (!reqStr(body.title)) errors.push("title obbligatorio");
  if (!reqStr(body.city)) errors.push("city obbligatoria");
  if (!reqStr(body.region)) errors.push("region obbligatoria");
  if (!reqStr(body.country)) errors.push("country obbligatorio");

  if (body.dateStart && isNaN(new Date(body.dateStart).getTime())) errors.push("dateStart non valida");
  if (body.dateEnd && isNaN(new Date(body.dateEnd).getTime())) errors.push("dateEnd non valida");

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
  const userId = req.user?._id;

  // Visibilità di default:
  // - se NON loggato: solo "public"
  // - se loggato: tutti i "public" + i "private" dove l'utente è tra i partecipanti
  if (!req.query.visibility) {
    if (userId) {
      // niente filtro diretto su visibility: usiamo un $or
      delete filters.visibility;
      filters.$or = [
        { visibility: "public" },
        { visibility: "private", participants: userId }
      ];
    } else {
      filters.visibility = "public";
    }
  }

  // default: solo eventi approvati, salvo override esplicito
  if (!req.query.approvalStatus) {
    filters.approvalStatus = "approved";
  }

  // Cache: solo per utenti NON loggati (così non mischiamo i risultati per utente)
  const useCache = !userId;
  const cacheKey = "events:list:" + JSON.stringify(req.query || {});
  if (useCache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      logger.debug("[cache] HIT listEvents", cacheKey);
      return res.json({ ok: true, events: cached });
    }
  }

  const events = await Event.find(filters).sort({ dateStart: 1 });
  const now = new Date();
  const payload = attachStatusToArray(events, now);

  if (useCache) {
    cache.set(cacheKey, payload, 60000); // TTL 60s
    logger.debug("[cache] MISS listEvents", cacheKey);
  }

  res.json({ ok: true, events: payload });
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

  // Escludi subito i "past" (richiesta per scheda Eventi seguiti)
  const filtered = Array.isArray(payload) ? payload.filter(e => e?.status !== "past") : [];

  res.json({ ok: true, events: filtered });

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
  const now = new Date();
  const payload = attachStatusToOne(event, now);
  res.json({ ok: true, event: payload });
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
// ✅ Persistenza accesso: aggiungi l'utente tra i partecipanti (idempotente)
  const userId = req.user?._id;
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

  const events = await Event.find({
    visibility: "private",
    approvalStatus: "approved",
    participants: userId,
  })
    .populate("organizer", "name")
    .sort({ dateStart: 1 });

  const now = new Date();
  const payload = attachStatusToArray(events, now);

  // (coerenza con altre schede: non mostrare i "past")
  const filtered = Array.isArray(payload) ? payload.filter((e) => e?.status !== "past") : [];

  res.json({ ok: true, events: filtered });
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
const event = new Event({
    ...body,
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
  const vErr = validateEventInput(req.body || {});
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

// @desc Aggiunge partecipante
// @route POST /api/events/:id/join
// @access Private
const joinEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event) {
    res.status(404);
    throw new Error("Evento non trovato");
  }

  // 🔒 Blocca partecipazione se evento già concluso
  const now = new Date();
// Evento "concluso" se:
// - esiste dateEnd e now > dateEnd
// - altrimenti (no dateEnd): now > fine giornata di dateStart
const hasEnded = (() => {
if (event.dateEnd) return new Date(event.dateEnd) < now;
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

if (!event.participants.some((p) => p.toString() === req.user._id.toString())) {
    event.participants.push(req.user._id);
    await event.save();

    await notify("event_joined", {
      eventId: event?._id?.toString?.() || String(event?._id || ""),
      participantId: req.user?._id?.toString?.() || String(req.user?._id || ""),
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

  res.json({ ok: true, event });
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
  event.participants = event.participants.filter(
    (p) => p.toString() !== req.user._id.toString()
  );
  await event.save();
  await notify("event_left", {
  eventId: event?._id?.toString?.() || String(event?._id || ""),
  participantId: req.user?._id?.toString?.() || String(req.user?._id || ""),
});

  res.json({ ok: true, event });
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
    console.error("getPrivateAccessCodeAdmin error", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
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
    console.error("rotatePrivateAccessCodeAdmin error", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
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
};



























