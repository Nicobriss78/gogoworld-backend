// services/eventsService.js — listing filtri + CRUD organizer
const Event = require("../models/eventModel");

function buildListQuery(q = {}) {
  const where = {};

  if (q.status) where.status = q.status;
  if (q.visibility) where.visibility = q.visibility;
  if (q.city) where.city = q.city;
  if (q.region) where.region = q.region;
  if (q.country) where.country = q.country;
  if (q.category) where.category = q.category;
  if (typeof q.isFree !== "undefined") where.isFree = q.isFree === "true" || q.isFree === true;

  if (q.dateFrom || q.dateTo) {
    where.dateStart = {};
    if (q.dateFrom) where.dateStart.$gte = new Date(q.dateFrom);
    if (q.dateTo) where.dateStart.$lte = new Date(q.dateTo);
  }
  return where;
}

async function list(query) {
  const where = buildListQuery(query);
  const rows = await Event.find(where).sort({ dateStart: 1, createdAt: -1 }).lean();
  return rows;
}

async function listMine(ownerId, query) {
  const where = buildListQuery(query);
  where.ownerId = ownerId;
  const rows = await Event.find(where).sort({ createdAt: -1 }).lean();
  return rows;
}

async function getById(id) {
  const ev = await Event.findById(id).lean();
  return ev;
}

async function create(ownerId, body) {
  const payload = { ...body, ownerId, participants: [] };
  const ev = await Event.create(payload);
  return ev.toObject();
}

async function update(ownerId, id, body) {
  const ev = await Event.findById(id);
  if (!ev) { const e = new Error("EVENT_NOT_FOUND"); e.status = 404; throw e; }
  if (String(ev.ownerId) !== String(ownerId)) { const e = new Error("FORBIDDEN_OWNER"); e.status = 403; throw e; }

  Object.assign(ev, body || {});
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
