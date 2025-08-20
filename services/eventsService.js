// services/eventsService.js — listing con filtri + CRUD organizer
const Event = require("../models/eventModel");

function buildListQuery(q = {}) {
  const where = {};

  // campi di filtro espliciti
  if (q.status) where.status = q.status;
  if (q.visibility) where.visibility = q.visibility;
  if (q.city) where.city = q.city;
  if (q.province) where.province = q.province;
  if (q.region) where.region = q.region;
  if (q.country) where.country = q.country;
  if (q.category) where.category = q.category;
  if (q.subcategory) where.subcategory = q.subcategory;
  if (q.type) where.type = q.type;
  if (typeof q.isFree !== "undefined") {
    where.isFree = (q.isFree === true || q.isFree === "true");
  }

  // range date
  if (q.dateFrom || q.dateTo) {
    where.dateStart = {};
    if (q.dateFrom) where.dateStart.$gte = new Date(q.dateFrom);
    if (q.dateTo) where.dateStart.$lte = new Date(q.dateTo);
  }

  // ricerca semplice
  if (q.q) {
    const rx = new RegExp(String(q.q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    where.$or = [{ title: rx }, { description: rx }, { city: rx }, { region: rx }, { country: rx }, { category: rx }];
  }

  return where;
}

async function list(query) {
  const where = buildListQuery(query || {});
  // ordinamento: eventi futuri prima (per data), poi più recenti
  return Event.find(where).sort({ dateStart: 1, createdAt: -1 }).lean();
}

async function listMine(ownerId, query) {
  const where = buildListQuery(query || {});
  where.ownerId = ownerId;
  return Event.find(where).sort({ createdAt: -1 }).lean();
}

async function getById(id) {
  return Event.findById(id).lean();
}

async function create(ownerId, body) {
  const payload = {
    title: body.title,
    description: body.description || "",
    status: body.status || "draft",
    visibility: body.visibility || "public",
    type: body.type || "",
    category: body.category || "",
    subcategory: body.subcategory || "",
    tags: Array.isArray(body.tags) ? body.tags : [],
    dateStart: body.dateStart ? new Date(body.dateStart) : undefined,
    dateEnd: body.dateEnd ? new Date(body.dateEnd) : undefined,
    timezone: body.timezone || "Europe/Rome",
    venueName: body.venueName || "",
    address: body.address || "",
    city: body.city || "",
    province: body.province || "",
    region: body.region || "",
    country: body.country || "",
    capacity: Number.isFinite(+body.capacity) ? +body.capacity : 0,
    isFree: !!body.isFree,
    priceMin: Number.isFinite(+body.priceMin) ? +body.priceMin : 0,
    priceMax: Number.isFinite(+body.priceMax) ? +body.priceMax : 0,
    currency: body.currency || "EUR",
    images: Array.isArray(body.images) ? body.images : (body.imageUrl ? [body.imageUrl] : []),
    externalUrl: body.externalUrl || "",
    contactEmail: body.contactEmail || "",
    contactPhone: body.contactPhone || "",
    ownerId,
    participants: []
  };
  const ev = await Event.create(payload);
  return ev.toObject();
}

async function update(ownerId, id, body) {
  const ev = await Event.findById(id);
  if (!ev) { const e = new Error("EVENT_NOT_FOUND"); e.status = 404; throw e; }
  if (String(ev.ownerId) !== String(ownerId)) { const e = new Error("FORBIDDEN_OWNER"); e.status = 403; throw e; }

  const fields = [
    "title","description","status","visibility","type","category","subcategory","tags",
    "dateStart","dateEnd","timezone","venueName","address","city","province","region","country",
    "capacity","isFree","priceMin","priceMax","currency","images","externalUrl","contactEmail","contactPhone"
  ];

  for (const k of fields) {
    if (typeof body[k] !== "undefined") {
      ev[k] = (k === "dateStart" || k === "dateEnd") && body[k] ? new Date(body[k]) : body[k];
    }
  }
  // imageUrl comodo dal form
  if (body.imageUrl) {
    ev.images = Array.isArray(ev.images) ? ev.images : [];
    if (!ev.images.length) ev.images.push(body.imageUrl);
    else ev.images[0] = body.imageUrl;
  }

  await ev.save();
  return ev.toObject();
}

async function remove(ownerId, id) {
  const ev = await Event.findById(id);
  if (!ev) { const e = new Error("EVENT_NOT_FOUND"); e.status = 404; throw e; }
  if (String(ev.ownerId) !== String(ownerId)) { const e = new Error("FORBIDDEN_OWNER"); e.status = 403; throw e; }

  await ev.deleteOne();
  return { ok: true };
}

module.exports = { list, listMine, getById, create, update, remove };
