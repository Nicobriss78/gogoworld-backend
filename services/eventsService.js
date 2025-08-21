// services/eventsService.js — logica eventi, filtri completi + ownerId
const Event = require("../models/eventModel");

// Costruisce il "where" in base ai parametri che il FE invia
function buildListWhere(q = {}) {
  const where = {};

  // 🔹 NUOVO: helper per regex esatta ma case-insensitive
  const rxEqI = (s) =>
    new RegExp("^" + String(s).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i");

  // campi diretti
  if (q.status) where.status = q.status;
  if (q.visibility) where.visibility = q.visibility;

  // 🔹 CAMBIO: campi geografici/categorici → match esatto, case-insensitive
  if (q.city) where.city = rxEqI(q.city);
  if (q.province) where.province = rxEqI(q.province);
  if (q.region) where.region = rxEqI(q.region);
  if (q.country) where.country = rxEqI(q.country);
  if (q.category) where.category = rxEqI(q.category);
  if (q.subcategory) where.subcategory = rxEqI(q.subcategory);
  if (q.type) where.type = rxEqI(q.type);

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
async function listMine(ownerId, query = {}) {
  const where = Object.assign({ ownerId }, buildListWhere(query));
  return Event.find(where).sort({ dateStart: 1, createdAt: -1 }).lean();
}

async function getById(id) {
  return Event.findById(id).lean();
}

async function create(ownerId, body) {
  const ev = await Event.create({
    ownerId,
    title: body.title,
    description: body.description || "",
    status: body.status || "draft",
    visibility: body.visibility || "public",
    type: body.type || "",
    category: body.category || "",
    subcategory: body.subcategory || "",
    tags: Array.isArray(body.tags) ? body.tags : [],
    dateStart: body.dateStart ? new Date(body.dateStart) : null,
    dateEnd: body.dateEnd ? new Date(body.dateEnd) : null,
    timezone: body.timezone || "Europe/Rome",
    venueName: body.venueName || "",
    address: body.address || "",
    city: body.city || "",
    province: body.province || "",
    region: body.region || "",
    country: body.country || "",
    isFree: !!body.isFree,
    priceMin: typeof body.priceMin === "number" ? body.priceMin : 0,
    priceMax: typeof body.priceMax === "number" ? body.priceMax : 0,
    currency: body.currency || "EUR",
    capacity: typeof body.capacity === "number" ? body.capacity : undefined,
    images: Array.isArray(body.images) ? body.images : (body.imageUrl ? [body.imageUrl] : []),
    externalUrl: body.externalUrl || "",
    contactEmail: body.contactEmail || "",
    contactPhone: body.contactPhone || "",
  });
  return ev.toObject();
}

async function update(id, userId, body) {
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
    priceMin: (typeof body.priceMin === "number" ? body.priceMin : ev.priceMin),
    priceMax: (typeof body.priceMax === "number" ? body.priceMax : ev.priceMax),
    currency: body.currency ?? ev.currency,
    type: body.type ?? ev.type,
    category: body.category ?? ev.category,
    subcategory: body.subcategory ?? ev.subcategory,
    dateStart: body.dateStart ? new Date(body.dateStart) : ev.dateStart,
    dateEnd: body.dateEnd ? new Date(body.dateEnd) : ev.dateEnd,
    timezone: body.timezone ?? ev.timezone,
    venueName: body.venueName ?? ev.venueName,
    address: body.address ?? ev.address,
    city: body.city ?? ev.city,
    province: body.province ?? ev.province,
    region: body.region ?? ev.region,
    country: body.country ?? ev.country,
    capacity: (typeof body.capacity === "number" ? body.capacity : ev.capacity),
    images: Array.isArray(body.images) ? body.images : ev.images,
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

