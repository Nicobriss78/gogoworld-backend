// services/eventsService.js — logica eventi (completo)
const Event = require("../models/eventModel");

async function list({ status }) {
  const q = {};
  if (status) q.status = status; // es. published
  return Event.find(q).lean();
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
    priceMin: body.priceMin,
    priceMax: body.priceMax,
    currency: body.currency,
    type: body.type,
    category: body.category,
    subcategory: body.subcategory,
    capacity: body.capacity,
    dateStart: body.dateStart,
    dateEnd: body.dateEnd,
    venueName: body.venueName,
    address: body.address,
    city: body.city,
    region: body.region,
    country: body.country,
    images: body.images || [],
    contactEmail: body.contactEmail,
    contactPhone: body.contactPhone,
    externalUrl: body.externalUrl,
    owner: userId,
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
  if (String(ev.owner) !== String(userId)) {
    const e = new Error("NOT_OWNER");
    e.status = 403;
    throw e;
  }

  Object.assign(ev, body);
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
  if (String(ev.owner) !== String(userId)) {
    const e = new Error("NOT_OWNER");
    e.status = 403;
    throw e;
  }
  await ev.deleteOne();
  return ev;
}

module.exports = { list, getById, create, update, remove };
