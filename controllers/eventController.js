// controllers/eventController.js — gestione eventi (versione allineata e fixata)
//
// Correzioni:
// - listMyEvents: applica gli stessi filtri di listEvents in AND con organizer
// - updateEvent: whitelist dei campi aggiornabili (niente organizer/participants/_id/...)
// - join/leave: update atomico con $addToSet / $pull (niente save del doc intero)

const Event = require("../models/eventModel");

// helper per costruire filtri comuni
function buildFilters(q) {
  const query = {};
  if (q.title) query.title = new RegExp(q.title, "i");
  if (q.city) query.city = new RegExp(q.city, "i");
  if (q.region) query.region = new RegExp(q.region, "i");
  if (q.country) query.country = new RegExp(q.country, "i");
  if (q.category) query.category = q.category;
  if (q.subcategory) query.subcategory = q.subcategory;
  if (q.visibility) query.visibility = q.visibility;
  if (q.type) query.type = q.type;
  if (q.isFree !== undefined) query.isFree = q.isFree === "true";

  if (q.dateStart || q.dateEnd) {
    query.date = {};
    if (q.dateStart) query.date.$gte = new Date(q.dateStart);
    if (q.dateEnd) query.date.$lte = new Date(q.dateEnd);
  }
  return query;
}

// @desc Lista eventi (con filtri)
// @route GET /api/events
async function listEvents(req, res) {
  try {
    const filters = buildFilters(req.query);
    const events = await Event.find(filters).sort({ date: 1 });
    res.json({ ok: true, events });
  } catch (err) {
    res.status(500).json({ ok: false, error: "LIST_FAILED", message: err.message });
  }
}

// @desc Dettaglio evento
// @route GET /api/events/:id
async function getEventById(req, res) {
  try {
    const ev = await Event.findById(req.params.id);
    if (!ev) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    res.json({ ok: true, event: ev });
  } catch (err) {
    res.status(500).json({ ok: false, error: "DETAIL_FAILED", message: err.message });
  }
}

// @desc Crea evento
// @route POST /api/events
async function createEvent(req, res) {
  try {
    const data = req.body;
    data.organizer = req.user.id;
    const ev = await Event.create(data);
    res.status(201).json({ ok: true, event: ev });
  } catch (err) {
    res.status(500).json({ ok: false, error: "CREATE_FAILED", message: err.message });
  }
}

// @desc Aggiorna evento (whitelist campi)
// @route PUT /api/events/:id
async function updateEvent(req, res) {
  try {
    const ev = await Event.findById(req.params.id);
    if (!ev) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    if (String(ev.organizer) !== String(req.user.id)) {
      return res.status(403).json({ ok: false, error: "NOT_OWNER" });
    }

    const allowed = [
      "title", "description",
      "city", "region", "country",
      "category", "subcategory",
      "type", "visibility",
      "date", "endDate",
      "isFree", "price",
      "coverImage", "images",
    ];

    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        ev[key] = req.body[key];
      }
    }

    await ev.save();
    res.json({ ok: true, event: ev });
  } catch (err) {
    res.status(500).json({ ok: false, error: "UPDATE_FAILED", message: err.message });
  }
}

// @desc Elimina evento
// @route DELETE /api/events/:id
async function deleteEvent(req, res) {
  try {
    const ev = await Event.findById(req.params.id);
    if (!ev) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    if (String(ev.organizer) !== String(req.user.id)) {
      return res.status(403).json({ ok: false, error: "NOT_OWNER" });
    }

    await ev.deleteOne();
    res.json({ ok: true, deleted: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: "DELETE_FAILED", message: err.message });
  }
}

// @desc Lista miei eventi (con filtri)
// @route GET /api/events/mine/list
async function listMyEvents(req, res) {
  try {
    const filters = buildFilters(req.query);
    const query = { ...filters, organizer: req.user.id };
    const events = await Event.find(query).sort({ date: 1 });
    res.json({ ok: true, events });
  } catch (err) {
    res.status(500).json({ ok: false, error: "MINE_FAILED", message: err.message });
  }
}

// @desc Join evento (update atomico)
// @route POST /api/events/:id/join
async function joinEvent(req, res) {
  try {
    const r = await Event.updateOne(
      { _id: req.params.id },
      { $addToSet: { participants: req.user.id } }
    );
    // In Mongoose 6/7: { acknowledged, matchedCount, modifiedCount }
    if (!r.matchedCount) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }
    return res.json({ ok: true, joined: true, eventId: req.params.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: "JOIN_FAILED", message: err.message });
  }
}

// @desc Leave evento (update atomico)
// @route POST /api/events/:id/leave
async function leaveEvent(req, res) {
  try {
    const r = await Event.updateOne(
      { _id: req.params.id },
      { $pull: { participants: req.user.id } }
    );
    if (!r.matchedCount) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }
    return res.json({ ok: true, joined: false, eventId: req.params.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: "LEAVE_FAILED", message: err.message });
  }
}

module.exports = {
  listEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  listMyEvents,
  joinEvent,
  leaveEvent,
};



