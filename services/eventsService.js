// services/eventsService.js — logica eventi, filtri completi + ownerId
const Event = require("../models/eventModel");

// Costruisce il "where" in base ai parametri che il FE invia
function buildListWhere(q = {}) {
  const where = {};

  // campi diretti
  if (q.status) where.status = q.status;
  if (q.visibility) where.visibility = q.visibility;
  if (q.city) where.city = q.city;
  if (q.province) where.province = q.province;
  if (q.region) where.region = q.region;
  if (q.country) where.country = q.country;
  if (q.category) where.category = q.category;
  if (q.subcategory) where.subcategory = q.subcategory;
  if (q.type) where.type = q.type;

  // booleano (arriva come stringa “true/false”)
  if (typeof q.isFree !== "undefined" && q.isFree !== "") {
    where.isFree = (q.isFree === true || q.isFree === "true");
  }

  // intervallo date (usa dateStart)
  if (q.dateFrom || q.dateTo) {
    where.dateStart = {};
    if (q.dateFrom) where.dateStart.$gte = new Date(q.dateFrom);
    if (q.dateTo) where.dateStart.$lte = new Date(q.dateTo);
  }

  // ricerca semplice su alcuni campi
  if (q.q) {
    const rx = new RegExp(String(q.q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    where.$or = [
      { title: rx },
      { description: rx },
      { city: rx },
      { region: rx },
      { country: rx },
      { category: rx },
      { type: rx },
    ];
  }

  return where;
}

async function list(query = {}) {
  const where = buildListWhere(query);
  // Ordina per data di inizio (prima gli eventi imminenti)
  return Event.find(where).sort({ dateStart: 1, createdAt: -1 }).lean();
}

// Elenco eventi dell'organizzatore loggato
async function listMine(ownerId) {
  return Event.find({ ownerId }).sort({ createdAt: -1 }).lean();
}

async function getById(id) {
  return Event.findById(id).lean();
}

async function create(userId, body = {}) {
  const ev = await Event.create({
    title: body.title || "Senza titolo",
    description: body.description || "",
    status: body.status || "draft",
    visibility: body.visibility || "public",
    isFree: !!body.isFree,
    priceMin: body.priceMin ?? 0,
    priceMax: body.priceMax ?? 0,
    currency: body.currency || "EUR",
    type: body.type || "",
    category: body.category || "",
    subcategory: body.subcategory || "",
    tags: Array.isArray(body.tags) ? body.tags : [],
    capacity: typeof body.capacity === "number" ? body.capacity : 0,
    dateStart: body.dateStart ? new Date(body.dateStart) : undefined,
    dateEnd: body.dateEnd ? new Date(body.dateEnd) : undefined,
    timezone: body.timezone || "Europe/Rome",
    venueName: body.venueName || "",
    address: body.address || "",
    city: body.city || "",
    region: body.region || "",
    country: body.country || "",
    images: Array.isArray(body.images) ? body.images : (body.imageUrl ? [body.imageUrl] : []),
    externalUrl: body.externalUrl || "",
    contactEmail: body.contactEmail || "",
    contactPhone: body.contactPhone || "",
    ownerId: userId,
    participants: [],
  });
  return ev.toObject();
}

async function update(id, userId, body = {}) {
  const ev = await Event.findById(id);
  if (!ev) {
    const e = new Error("EVENT_NOT_FOUND");
    e.status = 404;
    throw e;
  }
  if (String(ev.ownerId) !== String(userId)) {
    const e = new Error("NOT_OWNER");
    e.status = 403;
    throw e;
  }

  Object.assign(ev, {
    title: body.title ?? ev.title,
    description: body.description ?? ev.description,
    status: body.status ?? ev.status,
    visibility: body.visibility ?? ev.visibility,
    isFree: typeof body.isFree === "boolean" ? body.isFree : ev.isFree,
    priceMin: body.priceMin ?? ev.priceMin,
    priceMax: body.priceMax ?? ev.priceMax,
    currency: body.currency ?? ev.currency,
    type: body.type ?? ev.type,
    category: body.category ?? ev.category,
    subcategory: body.subcategory ?? ev.subcategory,
    tags: Array.isArray(body.tags) ? body.tags : ev.tags,
    capacity: typeof body.capacity === "number" ? body.capacity : ev.capacity,
    dateStart: body.dateStart ? new Date(body.dateStart) : ev.dateStart,
    dateEnd: body.dateEnd ? new Date(body.dateEnd) : ev.dateEnd,
    timezone: body.timezone ?? ev.timezone,
    venueName: body.venueName ?? ev.venueName,
    address: body.address ?? ev.address,
    city: body.city ?? ev.city,
    region: body.region ?? ev.region,
    country: body.country ?? ev.country,
    images: Array.isArray(body.images) ? body.images : (body.imageUrl ? [body.imageUrl] : ev.images),
    externalUrl: body.externalUrl ?? ev.externalUrl,
    contactEmail: body.contactEmail ?? ev.contactEmail,
    contactPhone: body.contactPhone ?? ev.contactPhone,
  });

  await ev.save();
  return ev.toObject();
}

async function remove(id, userId) {
  const ev = await Event.findById(id);
  if (!ev) {
    const e = new Error("EVENT_NOT_FOUND");
    e.status = 404;
    throw e;
  }
  if (String(ev.ownerId) !== String(userId)) {
    const e = new Error("NOT_OWNER");
    e.status = 403;
    throw e;
  }
  await ev.deleteOne();
  return ev;
}

module.exports = { list, listMine, getById, create, update, remove };

