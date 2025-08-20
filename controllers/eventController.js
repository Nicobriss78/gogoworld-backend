// controllers/eventController.js — inoltra a eventsService (risposte semplici)
const eventsService = require("../services/eventsService");

// RITORNA direttamente un ARRAY di eventi (non wrappato), così è coerente con register.js
async function list(req, res, next) {
  try {
    const rows = await eventsService.list(req.query || {});
    return res.json(rows);
  } catch (err) { next(err); }
}

// RITORNA un ARRAY di eventi dell'organizzatore loggato
async function listMine(req, res, next) {
  try {
    const rows = await eventsService.listMine(req.user.id, req.query || {});
    return res.json(rows);
  } catch (err) { next(err); }
}

// RITORNA un singolo evento (oggetto, non wrappato)
async function get(req, res, next) {
  try {
    const item = await eventsService.getById(req.params.id);
    if (!item) return res.status(404).json({ ok: false, error: "EVENT_NOT_FOUND" });
    return res.json(item);
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const item = await eventsService.create(req.user.id, req.body || {});
    return res.status(201).json(item);
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const item = await eventsService.update(req.user.id, req.params.id, req.body || {});
    return res.json(item);
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    const out = await eventsService.remove(req.user.id, req.params.id);
    return res.json(out);
  } catch (err) { next(err); }
}

module.exports = { list, listMine, get, create, update, remove };





