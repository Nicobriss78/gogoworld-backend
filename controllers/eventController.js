// backend/controllers/eventController.js
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
  // legacy
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

/* filtri “tolleranti”: se city/province/region/country non sono popolati
   nei record, cerchiamo anche nel legacy `location` */
function buildFilters(qs = {}) {
  const whereAnd = [];
  const whereOr = [];

  if (qs.q && String(qs.q).trim()) {
    whereAnd.push({ $text: { $search: String(qs.q).trim() } });
  }

  const geoFields = [
    { key: 'city', field: 'city' },
    { key: 'province', field: 'province' },
    { key: 'region', field: 'region' },
    { key: 'country', field: 'country' },
  ];
  geoFields.forEach(({ key, field }) => {
    const val = qs[key];
    if (val) {
      whereOr.push({ [field]: String(val) });
      whereOr.push({ location: { $regex: new RegExp(String(val).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } });
    }
  });

  if (qs.category) whereAnd.push({ category: qs.category });
  if (qs.type) whereAnd.push({ type: qs.type });
  if (qs.tag) whereAnd.push({ tags: qs.tag });

  const from = toDateOrNull(qs.dateFrom);
  const to = toDateOrNull(qs.dateTo);
  if (from || to) {
    const cond = {};
    if (from) cond.$gte = from;
    if (to) cond.$lte = to;
    whereAnd.push({ dateStart: cond });
  }

  if (qs.isFree !== undefined) whereAnd.push({ isFree: String(qs.isFree) === 'true' });
  if (qs.priceMin !== undefined) whereAnd.push({ priceMin: { $gte: Number(qs.priceMin) } });
  if (qs.priceMax !== undefined) whereAnd.push({ priceMax: { $lte: Number(qs.priceMax) } });

  if (qs.status) whereAnd.push({ status: qs.status });
  if (qs.visibility) whereAnd.push({ visibility: qs.visibility });
  if (qs.organizerId) whereAnd.push({ organizerId: String(qs.organizerId) });

  const where = {};
  if (whereAnd.length && whereOr.length) where.$and = [...whereAnd, { $or: whereOr }];
  else if (whereAnd.length) where.$and = whereAnd;
  else if (whereOr.length) where.$or = whereOr;

  return where;
}

/* ---------- LISTA PUBBLICA (array) ---------- */
exports.list = async (req, res) => {
  try {
    const where = buildFilters(req.query);
    const sort = req.query.sort || '-createdAt';
    const events = await Event.find(where).sort(sort).lean();
    return res.json(events); // array (retro-compat)
  } catch (err) {
    console.error('events.list error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/* ---------- I MIEI EVENTI (organizer) ---------- */
exports.listMine = async (req, res) => {
  try {
    const where = buildFilters(req.query);
    where.$and = (where.$and || []).concat({ organizerId: String(req.user.id) });
    const sort = req.query.sort || '-createdAt';
    const events = await Event.find(where).sort(sort).lean();
    return res.json(events);
  } catch (err) {
    console.error('events.listMine error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/* ---------- SINGOLO ---------- */
exports.get = async (req, res) => {
  try {
    const ev = await Event.findById(req.params.id);
    if (!ev) return res.status(404).json({ error: 'Event not found' });
    return res.json(ev);
  } catch (err) {
    console.error('events.get error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/* ---------- CREATE ---------- */
exports.create = async (req, res) => {
  try {
    const { title } = req.body || {};
    if (!title) return res.status(400).json({ error: 'Missing required field: title' });
    const payload = normalizePayload(req.body, { organizerId: req.user.id });
    const ev = await Event.create(payload);
    return res.status(201).json(ev);
  } catch (err) {
    console.error('events.create error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/* ---------- UPDATE (solo owner) ---------- */
exports.update = async (req, res) => {
  try {
    const evCheck = await Event.findById(req.params.id);
    if (!evCheck) return res.status(404).json({ error: 'Event not found' });
    if (String(evCheck.organizerId) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Forbidden: not your event' });
    }
    const payload = normalizePayload(req.body);
    const ev = await Event.findByIdAndUpdate(req.params.id, payload, { new: true });
    return res.json(ev);
  } catch (err) {
    console.error('events.update error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/* ---------- DELETE (solo owner) ---------- */
exports.remove = async (req, res) => {
  try {
    const evCheck = await Event.findById(req.params.id);
    if (!evCheck) return res.status(404).json({ error: 'Event not found' });
    if (String(evCheck.organizerId) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Forbidden: not your event' });
    }
    await Event.findByIdAndDelete(req.params.id);
    return res.status(204).end();
  } catch (err) {
    console.error('events.remove error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};




