// controllers/eventController.js — gestione eventi (completo)
const eventsService = require("../services/eventsService");

// GET /api/events → lista con filtri da req.query
async function list(req, res, next) {
  try {
    // ✅ INOLTRO TUTTI I FILTRI: non solo "status"
    const events = await eventsService.list(req.query || {});
    return res.json(events);
  } catch (err) {
    return next(err);
  }
}

// GET /api/events/mine/list (organizer)
async function listMine(req, res, next) {
  try {
    const events = await eventsService.listMine(req.user.id, req.query || {});
    return res.json(events);
  } catch (err) {
    return next(err);
  }
}

// GET /api/events/:id
async function getById(req, res, next) {
  try {
    const ev = await eventsService.getById(req.params.id);
    if (!ev) return res.status(404).json({ error: "NOT_FOUND" });
    return res.json(ev);
  } catch (err) {
    return next(err);
  }
}

// POST /api/events
async function create(req, res, next) {
  try {
    const ev = await eventsService.create(req.user.id, req.body || {});
    return res.status(201).json(ev);
  } catch (err) {
    return next(err);
  }
}

// PUT /api/events/:id
async function update(req, res, next) {
  try {
    const ev = await eventsService.update(req.params.id, req.user.id, req.body || {});
    return res.json(ev);
  } catch (err) {
    return next(err);
  }
}

// DELETE /api/events/:id
async function remove(req, res, next) {
  try {
    const ev = await eventsService.remove(req.params.id, req.user.id);
    return res.json({ ok: true, id: ev._id });
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, listMine, getById, create, update, remove };








