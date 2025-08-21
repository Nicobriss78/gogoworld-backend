// controllers/eventController.js — gestione eventi (completo)
const eventsService = require("../services/eventsService");

// GET /api/events?status=published
async function list(req, res, next) {
  try {
    const { status } = req.query;
    const events = await eventsService.list({ status });
    return res.json(events);
  } catch (err) {
    return next(err);
  }
}

// GET /api/events/:id
async function getById(req, res, next) {
  try {
    const event = await eventsService.getById(req.params.id);
    if (!event) {
      const e = new Error("EVENT_NOT_FOUND");
      e.status = 404;
      throw e;
    }
    return res.json(event); // oggetto diretto (coerente con evento.js FE)
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

module.exports = { list, getById, create, update, remove };





