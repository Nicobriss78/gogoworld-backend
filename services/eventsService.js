// services/eventsService.js
// Strato servizi per Event: usato da controller e (in futuro) da /internal

const Event = require("../models/eventModel");

function normalizeCreatePayload(p = {}) {
  const out = {
    title: (p.title || "").trim(),
    description: (p.description || "").trim(),
    // compat legacy: date || dateStart
    dateStart: p.dateStart || p.date || null,
    dateEnd: p.dateEnd || null,
    timezone: p.timezone || undefined,

    // luogo (compat: location -> city)
    venueName: p.venueName || undefined,
    address: p.address || undefined,
    city: p.city || p.location || undefined,
    province: p.province || undefined,
    region: p.region || undefined,
    country: p.country || undefined,
    coords: p.coords || undefined,

    // classificazione
    category: p.category || undefined,
    subcategory: p.subcategory || undefined,
    type: p.type || undefined,
    tags: p.tags || undefined,

    // prezzi/capienza
    isFree: p.isFree === true || p.isFree === "true",
    price: p.price !== undefined && p.price !== "" ? Number(p.price) : undefined,
    currency: p.currency || undefined,
    capacity: p.capacity !== undefined && p.capacity !== "" ? Number(p.capacity) : undefined,

    // stato/visibilità
    status: (p.status || "draft").trim(),
    visibility: (p.visibility || "public").trim(),

    // media/meta
    coverUrl: p.coverUrl || undefined,
    website: p.website || undefined,
    contacts: p.contacts || undefined,

    // ownership
    organizerId: p.organizerId, // impostato a livello controller da req.user.id
  };

  // pulizia campi undefined per evitare override indesiderati
  Object.keys(out).forEach(k => out[k] === undefined && delete out[k]);
  return out;
}

function normalizeUpdatePayload(p = {}) {
  // simile a create ma senza forzare organizerId
  const base = normalizeCreatePayload(p);
  delete base.organizerId;
  return base;
}

function buildFilters(q = {}) {
  const f = {};

  // testo generico
  if (q.q) {
    f.$or = [
      { title: new RegExp(q.q, "i") },
      { description: new RegExp(q.q, "i") },
      { city: new RegExp(q.q, "i") },
      { region: new RegExp(q.q, "i") },
      { country: new RegExp(q.q, "i") },
    ];
  }

  // geografia
  ["city", "province", "region", "country"].forEach(k => {
    if (q[k]) f[k] = new RegExp(String(q[k]), "i");
  });

  // date range
  const dt = {};
  if (q.dateFrom) dt.$gte = new Date(q.dateFrom);
  if (q.dateTo) dt.$lte = new Date(q.dateTo);
  if (Object.keys(dt).length) f.dateStart = dt;

  // status/visibility/type/category
  ["status", "visibility", "type", "category"].forEach(k => {
    if (q[k]) f[k] = String(q[k]);
  });

  // gratuiti/paid
  if (q.isFree === "true" || q.isFree === true) f.isFree = true;
  if (q.isFree === "false") f.isFree = { $ne: true };

  return f;
}

async function list(query = {}, { page = 1, limit = 50 } = {}) {
  const filters = buildFilters(query);
  const skip = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));
  return Event.find(filters).sort({ dateStart: 1 }).skip(skip).limit(Number(limit));
}

async function listMine(organizerId) {
  return Event.find({ organizerId }).sort({ dateStart: 1 });
}

async function getById(id) {
  return Event.findById(id);
}

async function create(payload) {
  const doc = await Event.create(normalizeCreatePayload(payload));
  return doc;
}

async function update(id, payload, { organizerId } = {}) {
  const data = normalizeUpdatePayload(payload);
  const query = organizerId ? { _id: id, organizerId } : { _id: id };
  const updated = await Event.findOneAndUpdate(query, data, { new: true });
  return updated;
}

async function remove(id, { organizerId } = {}) {
  const query = organizerId ? { _id: id, organizerId } : { _id: id };
  return Event.findOneAndDelete(query);
}

module.exports = {
  list,
  listMine,
  getById,
  create,
  update,
  remove,
};
