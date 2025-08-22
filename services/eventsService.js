// services/eventsService.js — logica eventi + filtri + validazione date
const Event = require("../models/eventModel");

function rxEqI(s) {
  return new RegExp("^" + String(s).trim().replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "$", "i");
}

function parseImages(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map(String).map(s => s.trim()).filter(Boolean);
  }
  const text = String(input);
  return text
    .split(/\r?\n|,/g)
    .map(s => s.trim())
    .filter(Boolean);
}

// 🔒 Validazione server-side sul range date
function assertValidDateRange(dateStart, dateEnd) {
  if (!dateStart || !dateEnd) return; // uno dei due manca: non validiamo qui
  const s = new Date(dateStart).getTime();
  const e = new Date(dateEnd).getTime();
  if (Number.isFinite(s) && Number.isFinite(e) && e < s) {
    const err = new Error("INVALID_DATE_RANGE");
    err.status = 400;
    throw err;
  }
}

// Costruisce il "where" in base ai parametri che il FE invia
function buildListWhere(q = {}) {
  const where = {};
  if (q.status) where.status = q.status;
  if (q.visibility) where.visibility = q.visibility;

  if (q.city) where.city = rxEqI(q.city);
  if (q.province) where.province = rxEqI(q.province);
  if (q.region) where.region = rxEqI(q.region);
  if (q.country) where.country = rxEqI(q.country);
  if (q.category) where.category = rxEqI(q.category);
  if (q.subcategory) where.subcategory = rxEqI(q.subcategory);
  if (q.type) where.type = rxEqI(q.type);

  if (typeof q.isFree !== "undefined" && q.isFree !== "") {
    where.isFree = (q.isFree === true || q.isFree === "true");
  }

  if (q.dateFrom || q.dateTo) {
    where.dateStart = {};
    if (q.dateFrom) where.dateStart.$gte = new Date(q.dateFrom);
    if (q.dateTo) where.dateStart.$lte = new Date(q.dateTo);
  }

  if (q.q) {
    const rx = new RegExp(String(q.q).trim().replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&"), "i");
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
  return Event.find(where).sort({ dateStart: 1, createdAt: -1 }).lean();
}

async function listMine(ownerId, query = {}) {
  const where = Object.assign({ ownerId }, buildListWhere(query));
  return Event.find(where).sort({ dateStart: 1, createdAt: -1 }).lean();
}

async function getById(id) {
  return Event.findById(id).lean();
}

async function create(ownerId, body) {
  // validazione date
  assertValidDateRange(body.dateStart, body.dateEnd);

  const imagesFromText = parseImages(body.imagesText || body.images);
  const singleImageFallback = body.imageUrl ? [String(body.imageUrl).trim()] : [];

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

    coverImage: (body.coverImage || body.imageUrl || "").trim(),
    images: imagesFromText.length ? imagesFromText : singleImageFallback,

    externalUrl: body.externalUrl || "",
    contactEmail: body.contactEmail || "",
    contactPhone: body.contactPhone || "",
  });
  return ev.toObject();
}

async function update(id, userId, body) {
  // validazione date
  assertValidDateRange(body.dateStart, body.dateEnd);

  const ev = await Event.findById(id);
  if (!ev) { const e = new Error("EVENT_NOT_FOUND"); e.status = 404; throw e; }
  if (String(ev.ownerId) !== String(userId)) { const e = new Error("NOT_OWNER"); e.status = 403; throw e; }

  const imagesFromText = parseImages(body.imagesText || body.images);

  Object.assign(ev, {
    title: body.title ?? ev.title,
    description: body.description ?? ev.description,
    status: body.status ?? ev.status,
    visibility: body.visibility ?? ev.visibility,
    isFree: (typeof body.isFree === "boolean") ? body.isFree : ev.isFree,
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

    coverImage: (typeof body.coverImage === "string") ? body.coverImage.trim() : ev.coverImage,
    images: imagesFromText.length ? imagesFromText : (Array.isArray(body.images) ? body.images : ev.images),

    externalUrl: body.externalUrl ?? ev.externalUrl,
    contactEmail: body.contactEmail ?? ev.contactEmail,
    contactPhone: body.contactPhone ?? ev.contactPhone,
  });

  await ev.save();
  return ev.toObject();
}

async function remove(id, userId) {
  const ev = await Event.findById(id);
  if (!ev) { const e = new Error("EVENT_NOT_FOUND"); e.status = 404; throw e; }
  if (String(ev.ownerId) !== String(userId)) { const e = new Error("NOT_OWNER"); e.status = 403; throw e; }
  await ev.deleteOne();
  return ev;
}

module.exports = { list, listMine, getById, create, update, remove };


