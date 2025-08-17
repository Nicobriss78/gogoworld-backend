// backend/controllers/eventController.js
// Controller eventi – versione MongoDB (Mongoose)

const Event = require('../models/eventModel');

/* ---------- Helpers ---------- */
function toDateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizePayload(body, opts = {}) {
  const {
    title, description,
    // legacy
    date, location,

    // modern fields
    shortDescription, longDescription,
    dateStart, dateEnd, timezone,
    venueName, address, city, province, region, country, coords,
    category, subcategory, type, tags,
    capacity, isFree, priceMin, priceMax, currency,
    status, visibility,
    images, language, accessibility, ageRestriction,
    services, sourceName, sourceUrl, isThirdPartyListing,
    disclaimerNote, moderationStatus, notesInternal,
    registrationRequired, externalUrl, contactEmail, contactPhone,
    eventIdExt,
  } = body || {};

  const doc = {};

  // base legacy
  if (title !== undefined) doc.title = title;
  if (description !== undefined) doc.description = description;
  if (date !== undefined) doc.date = String(date);
  if (location !== undefined) doc.location = location;

  // modern
  if (shortDescription !== undefined) doc.shortDescription = shortDescription;
  if (longDescription !== undefined) doc.longDescription = longDescription;

  if (dateStart !== undefined) doc.dateStart = dateStart ? toDateOrNull(dateStart) : null;
  if (dateEnd !== undefined) doc.dateEnd = dateEnd ? toDateOrNull(dateEnd) : null;
  if (timezone !== undefined) doc.timezone = timezone;

  if (venueName !== undefined) doc.venueName = venueName;
  if (address !== undefined) doc.address = address;
  if (city !== undefined) doc.city = city;
  if (province !== undefined) doc.province = province;
  if (region !== undefined) doc.region = region;
  if (country !== undefined) doc.country = country;
  if (coords !== undefined && coords && typeof coords === 'object') doc.coords = coords;

  if (category !== undefined) doc.category = category;
  if (subcategory !== undefined) doc.subcategory = subcategory;
  if (type !== undefined) doc.type = type;
  if (tags !== undefined) doc.tags = Array.isArray(tags) ? tags : (tags ? [tags] : []);

  if (capacity !== undefined) doc.capacity = Number(capacity);
  if (isFree !== undefined) doc.isFree = !!isFree;
  if (priceMin !== undefined) doc.priceMin = Number(priceMin);
  if (priceMax !== undefined) doc.priceMax = Number(priceMax);
  if (currency !== undefined) doc.currency = currency;

  if (status !== undefined) doc.status = status;
  if (visibility !== undefined) doc.visibility = visibility;

  if (images !== undefined) doc.images = Array.isArray(images) ? images : (images ? [images] : []);
  if (language !== undefined) doc.language = language;
  if (accessibility !== undefined) doc.accessibility = Array.isArray(accessibility) ? accessibility : (accessibility ? [accessibility] : []);
  if (ageRestriction !== undefined) doc.ageRestriction = ageRestriction;

  if (services !== undefined) doc.services = Array.isArray(services) ? services : (services ? [services] : []);
  if (sourceName !== undefined) doc.sourceName = sourceName;
  if (sourceUrl !== undefined) doc.sourceUrl = sourceUrl;
  if (isThirdPartyListing !== undefined) doc.isThirdPartyListing = !!isThirdPartyListing;
  if (disclaimerNote !== undefined) doc.disclaimerNote = disclaimerNote;
  if (moderationStatus !== undefined) doc.moderationStatus = moderationStatus;
  if (notesInternal !== undefined) doc.notesInternal = notesInternal;

  if (registrationRequired !== undefined) doc.registrationRequired = !!registrationRequired;
  if (externalUrl !== undefined) doc.externalUrl = externalUrl;
  if (contactEmail !== undefined) doc.contactEmail = contactEmail;
  if (contactPhone !== undefined) doc.contactPhone = contactPhone;

  if (eventIdExt !== undefined) doc.eventIdExt = eventIdExt;

  if (opts.organizerId) doc.organizerId = String(opts.organizerId);

  return doc;
}

function buildFilters(qs = {}) {
  const where = {};

  // testo
  if (qs.q && String(qs.q).trim()) {
    where.$text = { $search: String(qs.q).trim() };
  }

  // geo/classificazione
  if (qs.city) where.city = qs.city;
  if (qs.province) where.province = qs.province;
  if (qs.region) where.region = qs.region;
  if (qs.country) where.country = qs.country;

  if (qs.category) where.category = qs.category;
  if (qs.type) where.type = qs.type;
  if (qs.tag) where.tags = qs.tag;

  // date range (su dateStart moderne; gli eventi legacy senza dateStart non verranno filtrati)
  const from = toDateOrNull(qs.dateFrom);
  const to = toDateOrNull(qs.dateTo);
  if (from || to) {
    where.dateStart = {};
    if (from) where.dateStart.$gte = from;
    if (to) where.dateStart.$lte = to;
  }

  // isFree / prezzi
  if (qs.isFree !== undefined) where.isFree = String(qs.isFree) === 'true';
  if (qs.priceMin !== undefined) where.priceMin = { $gte: Number(qs.priceMin) };
  if (qs.priceMax !== undefined) where.priceMax = Object.assign(where.priceMax || {}, { $lte: Number(qs.priceMax) });

  // stato/visibilità – solo se richiesto (nessun default, per non nascondere eventi legacy)
  if (qs.status) where.status = qs.status;
  if (qs.visibility) where.visibility = qs.visibility;

  // organizerId (facoltativo, es. per FE future)
  if (qs.organizerId) where.organizerId = String(qs.organizerId);

  return where;
}

/* ---------- LISTA PUBBLICA (array) ---------- */
// GET /api/events
exports.list = async (req, res) => {
  try {
    const where = buildFilters(req.query);
    const sort = req.query.sort || '-createdAt';
    const events = await Event.find(where).sort(sort).lean();
    return res.json(events); // array (retro-compat con FE attuale)
  } catch (err) {
    console.error('events.list error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/* ---------- I MIEI EVENTI (organizer) ---------- */
// GET /api/events/mine
exports.listMine = async (req, res) => {
  try {
    const where = buildFilters(req.query);
    where.organizerId = String(req.user.id);
    const sort = req.query.sort || '-createdAt';
    const events = await Event.find(where).sort(sort).lean();
    return res.json(events);
  } catch (err) {
    console.error('events.listMine error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/* ---------- SINGOLO EVENTO (pubblico) ---------- */
// GET /api/events/:id
exports.get = async (req, res) => {
  try {
    const { id } = req.params;
    const ev = await Event.findById(id);
    if (!ev) return res.status(404).json({ error: 'Event not found' });
    return res.json(ev);
  } catch (err) {
    console.error('events.get error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/* ---------- CREA EVENTO (organizer) ---------- */
// POST /api/events
exports.create = async (req, res) => {
  try {
    const { title } = req.body || {};
    if (!title) return res.status(400).json({ error: 'Missing required field: title' });

    const payload = normalizePayload(req.body, { organizerId: req.user.id });
    // Compat: se arriva solo legacy 'date'/'location' va comunque bene
    const ev = await Event.create(payload);
    return res.status(201).json(ev);
  } catch (err) {
    console.error('events.create error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/* ---------- UPDATE EVENTO (solo owner) ---------- */
// PUT /api/events/:id
exports.update = async (req, res) => {
  try {
    const { id } = req.params;

    const evCheck = await Event.findById(id);
    if (!evCheck) return res.status(404).json({ error: 'Event not found' });

    if (String(evCheck.organizerId) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Forbidden: not your event' });
    }

    const payload = normalizePayload(req.body);
    const ev = await Event.findByIdAndUpdate(id, payload, { new: true });
    return res.json(ev);
  } catch (err) {
    console.error('events.update error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/* ---------- DELETE EVENTO (solo owner) ---------- */
// DELETE /api/events/:id
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;

    const evCheck = await Event.findById(id);
    if (!evCheck) return res.status(404).json({ error: 'Event not found' });

    if (String(evCheck.organizerId) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Forbidden: not your event' });
    }

    await Event.findByIdAndDelete(id);
    return res.status(204).end();
  } catch (err) {
    console.error('events.remove error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

