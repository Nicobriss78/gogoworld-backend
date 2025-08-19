// controllers/eventController.js
// Controller eventi: delega ai services e usa next(err) per l'error handler

const eventsService = require("../services/eventsService");

async function list(req, res, next) {
  try {
    const { page, limit, ...filters } = req.query || {};
    const data = await eventsService.list(filters, { page, limit });
    res.json(data);
  } catch (err) { next(err); }
}

async function listMine(req, res, next) {
  try {
    const organizerId = req.user?.id;
    const data = await eventsService.listMine(organizerId);
    res.json(data);
  } catch (err) { next(err); }
}

async function get(req, res, next) {
  try {
    const data = await eventsService.getById(req.params.id);
    if (!data) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    res.json(data);
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const organizerId = req.user?.id;
    const payload = { ...req.body, organizerId };
    const created = await eventsService.create(payload);
    res.status(201).json(created);
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const organizerId = req.user?.id;
    const updated = await eventsService.update(req.params.id, req.body, { organizerId });
    if (!updated) return res.status(404).json({ ok: false, error: "NOT_FOUND_OR_NOT_OWNER" });
    res.json(updated);
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    const organizerId = req.user?.id;
    const removed = await eventsService.remove(req.params.id, { organizerId });
    if (!removed) return res.status(404).json({ ok: false, error: "NOT_FOUND_OR_NOT_OWNER" });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = {
  list,
  listMine,
  get,
  create,
  update,
  remove,
};



