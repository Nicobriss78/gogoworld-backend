// controllers/eventController.js — gestione eventi
//
// Funzioni:
// - listEvents (con filtri da query)
// - getEventById
// - createEvent
// - updateEvent
// - deleteEvent
// - listMyEvents
// - joinEvent, leaveEvent (alias lato evento)
//
// Dipendenze: models/eventModel.js

const Event = require("../models/eventModel");

// @desc Lista eventi (con filtri)
// @route GET /api/events
async function listEvents(req, res) {
  try {
    const query = {};
    // Filtri principali
    if (req.query.title) query.title = new RegExp(req.query.title, "i");
    if (req.query.city) query.city = new RegExp(req.query.city, "i");
    if (req.query.region) query.region = new RegExp(req.query.region, "i");
    if (req.query.country) query.country = new RegExp(req.query.country, "i");
    if (req.query.category) query.category = req.query.category;
    if (req.query.subcategory) query.subcategory = req.query.subcategory;
    if (req.query.visibility) query.visibility = req.query.visibility;
    if (req.query.type) query.type = req.query.type;
    if (req.query.isFree !== undefined) query.isFree = req.query.isFree === "true";

    // Range date
    if (req.query.dateStart || req.query.dateEnd) {
      query.date = {};
      if (req.query.dateStart) query.date.$gte = new Date(req.query.dateStart);
      if (req.query.dateEnd) query.date.$lte = new Date(req.query.dateEnd);
    }

    const events = await Event.find(query).sort({ date: 1 });
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

// @desc Aggiorna evento
// @route PUT /api/events/:id
async function updateEvent(req, res) {
  try {
    const ev = await Event.findById(req.params.id);
    if (!ev) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    if (String(ev.organizer) !== String(req.user.id)) {
      return res.status(403).json({ ok: false, error: "NOT_OWNER" });
    }

    Object.assign(ev, req.body);
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

// @desc Lista miei eventi
// @route GET /api/events/mine/list
async function listMyEvents(req, res) {
  try {
    const events = await Event.find({ organizer: req.user.id }).sort({ date: 1 });
    res.json({ ok: true, events });
  } catch (err) {
    res.status(500).json({ ok: false, error: "MINE_FAILED", message: err.message });
  }
}

// @desc Join evento (alias lato evento)
// @route POST /api/events/:id/join
async function joinEvent(req, res) {
  try {
    const ev = await Event.findById(req.params.id);
    if (!ev) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    if (!ev.participants.includes(req.user.id)) {
      ev.participants.push(req.user.id);
      await ev.save();
    }
    res.json({ ok: true, joined: true, eventId: ev._id });
  } catch (err) {
    res.status(500).json({ ok: false, error: "JOIN_FAILED", message: err.message });
  }
}

// @desc Leave evento (alias lato evento)
// @route POST /api/events/:id/leave
async function leaveEvent(req, res) {
  try {
    const ev = await Event.findById(req.params.id);
    if (!ev) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    ev.participants = ev.participants.filter(
      (pid) => String(pid) !== String(req.user.id)
    );
    await ev.save();

    res.json({ ok: true, joined: false, eventId: ev._id });
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
