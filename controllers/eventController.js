const Event = require("../models/eventModel");
const asyncHandler = require("express-async-handler");

// ---- Stato evento derivato dal tempo corrente ----
// Status possibili: "ongoing" (in corso), "imminent" (imminente), "future" (futuro), "concluded" (appena concluso), "past" (oltre finestra concluso)
// Usa ENV con default sicuri; timezone rimane un fallback concettuale (date salvate in UTC)
const IMMINENT_HOURS = Number(process.env.IMMINENT_HOURS || 72);
const SHOW_CONCLUDED_HOURS = Number(process.env.SHOW_CONCLUDED_HOURS || 12);
// const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || "Europe/Rome"; // placeholder per evoluzioni future

function computeEventStatus(ev, now = new Date()) {
  try {
    const start = ev?.date || ev?.dateStart ? new Date(ev.date || ev.dateStart) : null;
    // endDate opzionale: se manca, usa start (evento monogiorno)
    const end = ev?.endDate || ev?.dateEnd ? new Date(ev.endDate || ev.dateEnd) : start;

    if (!start) return "future"; // senza date, trattiamo come futuro per non bloccare

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
    const obj = typeof d.toObject === "function" ? d.toObject() : d;
    return { ...obj, status: computeEventStatus(obj, now) };
  });
}

function attachStatusToOne(doc, now = new Date()) {
  if (!doc) return doc;
  const obj = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return { ...obj, status: computeEventStatus(obj, now) };
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
  // --- PATCH: nuovi filtri ---
  if (q.language) {
    query.language = q.language;
  }
  if (q.target) {
    query.target = q.target;
  }
  // --------------------------

  if (q.isFree) {
    query.isFree = q.isFree === "true";
  }

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

// @desc Ottiene tutti gli eventi (pubblici) con filtri
// @route GET /api/events
// @access Public
const listEvents = asyncHandler(async (req, res) => {
  const filters = buildFilters(req.query);
  if (!req.query.visibility) {
    filters.visibility = "public";
  }
  const listEvents = asyncHandler(async (req, res) => {
const filters = buildFilters(req.query);
if (!req.query.visibility) {
filters.visibility = "public";
}
if (!req.query.approvalStatus) { filters.approvalStatus = "approved"; }
const events = await Event.find(filters).sort({ dateStart: 1 });
const now = new Date();
const payload = attachStatusToArray(events, now);
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

// @desc Ottiene un evento singolo
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

// @desc Crea un nuovo evento
// @route POST /api/events
// @access Private (organizer)
const createEvent = asyncHandler(async (req, res) => {
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

  const event = new Event({
    ...body,
    isFree,
    price,
    ...(currency ? { currency } : {}),
    organizer: req.user._id,
  });

  const created = await event.save();
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

 // Applichiamo SOLO i campi ammessi (anti mass-assignment)
const allowed = {
  // base
  title: body.title,
  description: body.description,
  status: body.status,
  visibility: body.visibility,

  // tassonomia
  type: body.type,
  category: body.category,
  subcategory: body.subcategory,
  tags: Array.isArray(body.tags) ? body.tags : undefined,

  // localizzazione (coerente con eventModel)
  venueName: body.venueName,
  address: body.address,
  street: body.street,
  streetNumber: body.streetNumber,
  postalCode: body.postalCode,
  city: body.city,
  province: body.province,
  region: body.region,
  country: body.country,
  lat: typeof body.lat === "number" ? body.lat : undefined,
  lon: typeof body.lon === "number" ? body.lon : undefined,

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


  const updated = await event.save();
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

  // Mongoose v7: remove() non esiste più
  await event.deleteOne();

  res.json({ ok: true, message: "Evento eliminato" });
});
// @desc Aggiunge partecipante a un evento
// @route POST /api/events/:id/join
// @access Private (participant)
const joinEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event) {
    res.status(404);
    throw new Error("Evento non trovato");
  }
if (!event.participants.some((p) => p.toString() === req.user._id.toString())) {    event.participants.push(req.user._id);
    await event.save();
  }
  res.json({ ok: true, event });
});

// @desc Rimuove partecipante da un evento
// @route POST /api/events/:id/leave
// @access Private (participant)
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
  res.json({ ok: true, event });
});

module.exports = {
  listEvents,
  listMyEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  joinEvent,
  leaveEvent,
};







